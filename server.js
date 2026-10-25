const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { exec } = require('node:child_process');
const {
  PRIMARY_API_URL,
  FALLBACK_API_URL,
  STORE_WEB_URL,
  APP_DATA_DIR,
  LICENSE_FILE,
  getMachineHWID,
  verifyOrActivateKey,
  checkStartupLicense,
  loadLocalLicense,
  saveLocalLicense,
  clearLocalLicense,
  getLicenseBadge,
} = require('./license');
const { findLocalDiscordToken } = require('./token_extractor');
const {
  ensureDummyStub,
  isDiscordDesktopRunning,
  findExecutableForQuest,
  spawnFakeGame,
  killFakeGame
} = require('./fake_game_spawner');

let isLicenseActive = false;
let currentLicenseData = null;

function isLicensed() {
  return isLicenseActive;
}

function maskKey(key) {
  if (!key) return '';
  const clean = key.trim().toUpperCase();
  const parts = clean.split('-');
  if (parts.length >= 4) {
    return `${parts[0]}-${parts[1]}-****-${parts[parts.length - 1]}`;
  }
  if (clean.length > 8) {
    return `${clean.slice(0, 6)}****${clean.slice(-4)}`;
  }
  return '****';
}

const PORT = 4545;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- State Management ---
const VERSION_FILE = path.join(__dirname, 'version.json');
let currentConfig = {
  token: '',
  autoEnroll: true,
  videoSpeed: 7, // seconds increment per pulse
  skipGameQuests: true, // Only do watch/video quests, skip game playing quests
  onlyEnrolledQuests: true, // Only run quests accepted in Discord client, skip invisible/untargeted
  accounts: []
};



function getLocalVersionInfo() {
  if (fs.existsSync(VERSION_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    } catch {}
  }
  return {
    version: "2.5.0",
    name: "Discord Quest Auto",
    githubRepo: "https://github.com/Newwee/discordquest",
    releaseNotes: ["เวอร์ชันปัจจุบัน 2.5.0"]
  };
}

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    currentConfig = { ...currentConfig, ...JSON.parse(raw) };
    if (!Array.isArray(currentConfig.accounts)) {
      currentConfig.accounts = [];
    }
  } catch (e) {
    console.error('Failed to load config.json:', e.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save config.json:', e.message);
  }
}

function upsertAccount(user, token) {
  if (!user || !user.id || !token) return;
  if (!Array.isArray(currentConfig.accounts)) currentConfig.accounts = [];
  const cleanToken = token.trim();
  const existingIdx = currentConfig.accounts.findIndex(a => a.id === user.id);
  const accountData = {
    id: user.id,
    username: user.username || 'User',
    global_name: user.global_name || user.username || 'User',
    avatar: user.avatar || '',
    token: cleanToken,
    lastUsed: Date.now()
  };

  if (existingIdx >= 0) {
    currentConfig.accounts[existingIdx] = accountData;
  } else {
    currentConfig.accounts.unshift(accountData);
  }

  // Keep max 20 accounts
  if (currentConfig.accounts.length > 20) {
    currentConfig.accounts = currentConfig.accounts.slice(0, 20);
  }
  saveConfig();
}

function compareSemver(v1, v2) {
  const p1 = (v1 || '').replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = (v2 || '').replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num2 > num1) return 1; // v2 is newer
    if (num2 < num1) return -1; // v1 is newer
  }
  return 0;
}

// Logs buffer and SSE subscribers
const MAX_LOGS = 300;
const logsBuffer = [];
const sseClients = new Set();

function log(message, type = 'info', extra = null) {
  const timestamp = new Date().toLocaleTimeString('th-TH');
  const entry = { id: Date.now() + Math.random(), time: timestamp, message, type, extra };
  logsBuffer.push(entry);
  if (logsBuffer.length > MAX_LOGS) logsBuffer.shift();

  console.log(`[${entry.time}] [${type.toUpperCase()}] ${message}`);

  const sseData = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(sseData);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Runner State
const runnerState = {
  isRunning: false,
  shouldStop: false,
  currentQuest: null,
  progress: {
    total: 0,
    done: 0,
    currentName: '',
    currentType: '',
    currentSeconds: 0,
    targetSeconds: 0,
    percent: 0
  }
};

let activeFakeGame = null;

// Rate Limit & Cache Shield for Quests (Per-Token Map)
const questsCacheMap = new Map();

function getOrCreateTokenCache(token) {
  const key = (token || '').trim();
  if (!questsCacheMap.has(key)) {
    questsCacheMap.set(key, {
      raw: [],
      parsed: [],
      stats: null,
      lastFetched: 0,
      retryAfterUntil: 0
    });
  }
  return questsCacheMap.get(key);
}

// Discord Web Client Build Number & Super Properties Cache
let cachedBuildNumber = 643186;
let lastBuildFetchTime = 0;

async function refreshDiscordBuildNumber() {
  const now = Date.now();
  if (cachedBuildNumber && (now - lastBuildFetchTime) < 3600000) {
    return cachedBuildNumber;
  }
  try {
    const res = await fetch('https://discord.com/app', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36' }
    });
    const html = await res.text();
    const scriptMatches = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(m => 'https://discord.com' + m[1]);
    for (const scriptUrl of scriptMatches) {
      if (scriptUrl.includes('web.') || scriptUrl.includes('app.')) {
        const sRes = await fetch(scriptUrl);
        const code = await sRes.text();
        const m = code.match(/buildNumber:"(\d+)"/i) || code.match(/BUILD_NUMBER:"?(\d+)"?/i) || code.match(/build_number:"?(\d+)"?/i);
        if (m && m[1]) {
          cachedBuildNumber = parseInt(m[1], 10);
          lastBuildFetchTime = now;
          break;
        }
      }
    }
  } catch (e) {
    // Keep fallback 643186
  }
  return cachedBuildNumber;
}

function getSuperPropertiesBase64() {
  const superProps = {
    os: 'Windows',
    browser: 'Chrome',
    device: '',
    system_locale: 'th-TH',
    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    browser_version: '133.0.0.0',
    os_version: '10',
    referrer: '',
    referring_domain: '',
    referrer_current: '',
    referring_domain_current: '',
    release_channel: 'stable',
    client_build_number: cachedBuildNumber || 643186,
    client_event_source: null
  };
  return Buffer.from(JSON.stringify(superProps)).toString('base64');
}

function getDiscordHeaders(token) {
  return {
    "Authorization": token.trim(),
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Content-Type": "application/json",
    "X-Super-Properties": getSuperPropertiesBase64()
  };
}

const DISCORD_CLIENT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9265 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';

function getDiscordClientSuperPropsBase64() {
  const superProps = {
    os: 'Windows',
    browser: 'Discord Client',
    release_channel: 'stable',
    client_version: '1.0.9265',
    os_version: '10.0.19045',
    os_arch: 'x64',
    app_arch: 'x64',
    system_locale: 'en-US',
    has_client_mods: false,
    client_launch_id: 'e3b0c442-98fc-1c14-9af0-2a3b9a1e0b61',
    browser_user_agent: DISCORD_CLIENT_UA,
    browser_version: '37.6.0',
    os_sdk_version: '19045',
    client_build_number: 471091,
    native_build_number: 72186,
    client_event_source: null
  };
  return Buffer.from(JSON.stringify(superProps)).toString('base64');
}

function getDiscordClientHeaders(token) {
  return {
    "Authorization": token.trim(),
    "Content-Type": "application/json",
    "User-Agent": DISCORD_CLIENT_UA,
    "X-Super-Properties": getDiscordClientSuperPropsBase64(),
    "X-Discord-Locale": "en-US",
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/channels/@me"
  };
}

// --- Discord API Helper Functions ---
async function fetchDiscordUser(token) {
  if (!token) throw new Error('Token is missing');
  const res = await fetch('https://discord.com/api/v9/users/@me', {
    headers: getDiscordHeaders(token)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord User API Error (${res.status}): ${text}`);
  }
  return await res.json();
}

function computeQuestStats(parsed) {
  let totalOrbs = 0;
  let readyToClaimOrbs = 0;
  let claimedOrbs = 0;
  let pendingOrbs = 0;

  let completedCount = 0;
  let readyToClaimCount = 0;
  let pendingCount = 0;
  let activeCount = 0;
  let expiredCount = 0;
  let enrolledCount = 0;

  for (const q of parsed) {
    if (q.isExpired) {
      expiredCount++;
      continue; // Filter out expired campaigns from active stats to prevent ghost numbers
    }

    activeCount++;
    totalOrbs += q.orbs;
    if (q.isEnrolled) enrolledCount++;

    if (q.statusText === 'CLAIMED') {
      claimedOrbs += q.orbs;
      completedCount++;
    } else if (q.statusText === 'READY_TO_CLAIM') {
      readyToClaimOrbs += q.orbs;
      readyToClaimCount++;
      completedCount++;
    } else {
      pendingOrbs += q.orbs;
      pendingCount++;
    }
  }

  return {
    totalQuests: parsed.length,
    activeQuests: activeCount,
    expiredQuests: expiredCount,
    enrolledQuests: enrolledCount,
    completedQuests: completedCount,
    readyToClaimQuests: readyToClaimCount,
    pendingQuests: pendingCount,
    orbs: {
      total: totalOrbs,
      readyToClaim: readyToClaimOrbs,
      claimed: claimedOrbs,
      pending: pendingOrbs
    }
  };
}

// Smart Quests Fetcher with Rate-Limit Shield (Per-Token Cache)
async function getOrFetchQuests(token, force = false) {
  if (!token) throw new Error('Token is missing');
  const cache = getOrCreateTokenCache(token);
  const now = Date.now();

  // 1. If currently in Rate-Limit window
  if (now < cache.retryAfterUntil) {
    const remainingSec = Math.ceil((cache.retryAfterUntil - now) / 1000);
    // Return cached data if available
    if (cache.parsed.length > 0) {
      return {
        quests: cache.parsed,
        stats: cache.stats || computeQuestStats(cache.parsed),
        rateLimited: true,
        retryAfter: remainingSec
      };
    }
    // If no cache and forced, wait for rate limit to expire
    if (force && remainingSec <= 15) {
      log(`⏳ รอให้คูลดาวน์ Discord หมดเวลา (${remainingSec}s) เพื่อโหลดข้อมูลเควสต์ชุดใหม่...`, 'info');
      await new Promise(r => setTimeout(r, (remainingSec * 1000) + 1200));
    } else {
      return {
        quests: cache.parsed,
        stats: cache.stats || computeQuestStats(cache.parsed),
        rateLimited: true,
        retryAfter: remainingSec
      };
    }
  }

  // 2. Return cache if fetched within 12 seconds (unless forced)
  if (!force && cache.parsed.length > 0 && (now - cache.lastFetched) < 12000) {
    return {
      quests: cache.parsed,
      stats: cache.stats || computeQuestStats(cache.parsed),
      rateLimited: false
    };
  }

  // 3. Make Discord API request
  try {
    await refreshDiscordBuildNumber();
    const res = await fetch('https://discord.com/api/v9/quests/@me', {
      headers: getDiscordHeaders(token)
    });

    if (res.status === 429) {
      const errJson = await res.json().catch(() => ({}));
      const retryAfter = errJson.retry_after || 8;
      cache.retryAfterUntil = Date.now() + Math.ceil(retryAfter * 1000) + 1500;
      log(`⏳ Discord แจ้ง Rate Limit คูลดาวน์ ${Math.ceil(retryAfter)} วินาที...`, 'warn');
      return {
        quests: cache.parsed,
        stats: cache.stats || computeQuestStats(cache.parsed),
        rateLimited: true,
        retryAfter: Math.ceil(retryAfter)
      };
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord Quests API Error (${res.status}): ${text}`);
    }

    const data = await res.json();
    const rawList = data.quests ?? [];
    const parsed = rawList.map(parseQuestInfo);
    const stats = computeQuestStats(parsed);

    cache.raw = rawList;
    cache.parsed = parsed;
    cache.stats = stats;
    cache.lastFetched = Date.now();
    cache.retryAfterUntil = 0;

    return {
      quests: parsed,
      stats,
      rateLimited: false
    };
  } catch (err) {
    if (cache.parsed.length > 0) {
      return {
        quests: cache.parsed,
        stats: cache.stats || computeQuestStats(cache.parsed),
        error: err.message
      };
    }
    throw err;
  }
}

// Parse Orbs and Quest Details accurately (supports both snake_case and camelCase)
function parseQuestInfo(quest) {
  const config = quest.config || {};
  const messages = config.messages || {};
  const questName = messages.quest_name || messages.questName || config.application?.name || quest.id;
  const gameTitle = messages.game_title || messages.gameTitle || questName;
  const expiresAt = config.expires_at || config.expiresAt;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  // Task configuration (v2 or v1, snake_case or camelCase)
  const taskConfig = config.task_config_v2 || config.task_config || config.taskConfigV2 || config.taskConfig || {};
  const tasks = taskConfig.tasks || {};
  const taskKeys = Object.keys(tasks);

  // Supported task detection
  let taskType = "UNKNOWN";
  let targetSeconds = 0;
  let currentSeconds = 0;

  const priorityTasks = [
    "WATCH_VIDEO",
    "WATCH_VIDEO_ON_MOBILE",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "PLAY_ON_XBOX",
    "PLAY_ON_PLAYSTATION"
  ];
  const matchedKey = priorityTasks.find(t => taskKeys.includes(t)) || taskKeys[0] || "UNKNOWN";
  taskType = matchedKey;
  targetSeconds = tasks[matchedKey]?.target || (tasks.WATCH_VIDEO ? tasks.WATCH_VIDEO.target : (tasks.WATCH_VIDEO_ON_MOBILE ? tasks.WATCH_VIDEO_ON_MOBILE.target : 0));

  // Read current progress
  const userStatus = quest.user_status || quest.userStatus || {};
  const progressObj = userStatus.progress || {};
  if (progressObj[matchedKey] && typeof progressObj[matchedKey].value === 'number') {
    currentSeconds = progressObj[matchedKey].value;
  } else if (progressObj.WATCH_VIDEO && typeof progressObj.WATCH_VIDEO.value === 'number') {
    currentSeconds = progressObj.WATCH_VIDEO.value;
  } else if (progressObj.WATCH_VIDEO_ON_MOBILE && typeof progressObj.WATCH_VIDEO_ON_MOBILE.value === 'number') {
    currentSeconds = progressObj.WATCH_VIDEO_ON_MOBILE.value;
  } else if (typeof userStatus.stream_progress_seconds === 'number') {
    currentSeconds = userStatus.stream_progress_seconds;
  } else if (typeof userStatus.streamProgressSeconds === 'number') {
    currentSeconds = userStatus.streamProgressSeconds;
  }

  // Completion flags
  const isEnrolled = !!(userStatus.enrolled_at || userStatus.enrolledAt);
  const isCompleted = !!(userStatus.completed_at || userStatus.completedAt) || (targetSeconds > 0 && currentSeconds >= targetSeconds);
  const isClaimed = !!(userStatus.claimed_at || userStatus.claimedAt);

  // Orbs Calculation & Rewards
  const rewardsConfig = config.rewards_config || config.rewardsConfig || {};
  const rewards = rewardsConfig.rewards || [];
  let orbs = 0;
  const rewardItems = [];

  for (const r of rewards) {
    const rMessages = r.messages || {};
    const name = rMessages.name || rMessages.name_with_article || rMessages.nameWithArticle || "Reward";
    const type = r.type; // 4 = ORBS, 1 = IN_GAME, 3 = DECORATION
    let orbCount = 0;

    if (type === 4 || (rMessages.name && /orb/i.test(rMessages.name))) {
      orbCount = r.orb_quantity || r.orbQuantity || r.premium_orb_quantity || r.amount || r.quantity || 700;
      orbs += orbCount;
    }

    rewardItems.push({
      type,
      name,
      orbCount,
      asset: r.asset
    });
  }

  // Status mapping
  let statusText = "AVAILABLE";
  if (isClaimed) {
    statusText = "CLAIMED";
  } else if (isCompleted) {
    statusText = "READY_TO_CLAIM";
  } else if (isExpired) {
    statusText = "EXPIRED";
  } else if (isEnrolled) {
    statusText = "IN_PROGRESS";
  } else {
    statusText = "NOT_ENROLLED";
  }

  return {
    id: quest.id,
    name: questName,
    gameTitle,
    applicationId: config.application?.id || null,
    rawConfig: config,
    expiresAt,
    isExpired,
    taskType,
    targetSeconds,
    currentSeconds,
    isEnrolled,
    isCompleted,
    isClaimed,
    statusText,
    orbs,
    rewards: rewardItems,
    banner: config.assets?.hero || config.assets?.quest_bar_hero || config.assets?.questBarHero || null
  };
}

// Enroll Quest
async function enrollQuest(token, questId) {
  const res = await fetch(`https://discord.com/api/v9/quests/${questId}/enroll`, {
    method: 'POST',
    headers: getDiscordClientHeaders(token),
    body: JSON.stringify({
      location: 11,
      is_targeted: false,
      metadata_sealed: null,
      traffic_metadata_sealed: null
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = '';
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.message || '';
    } catch {}
    const err = new Error(`Enroll failed (${res.status}): ${msg || errText}`);
    err.status = res.status;
    err.raw = errText;
    throw err;
  }
  return await res.json();
}

// Update Video Progress
async function sendVideoProgress(token, questId, timestamp) {
  const res = await fetch(`https://discord.com/api/v9/quests/${questId}/video-progress`, {
    method: 'POST',
    headers: getDiscordClientHeaders(token),
    body: JSON.stringify({ timestamp })
  });
  if (!res.ok) {
    const errText = await res.text();
    let retryAfter = null;
    try {
      const parsed = JSON.parse(errText);
      retryAfter = parsed.retry_after;
    } catch {}
    const err = new Error(`Video progress error (${res.status}): ${errText}`);
    err.status = res.status;
    err.retryAfter = retryAfter;
    throw err;
  }
  return await res.json();
}

// Send Desktop Game Heartbeat directly to Discord Server
async function sendGameHeartbeat(token, questId, applicationId, terminal = false) {
  const res = await fetch(`https://discord.com/api/v9/quests/${questId}/heartbeat`, {
    method: 'POST',
    headers: getDiscordClientHeaders(token),
    body: JSON.stringify({
      application_id: applicationId,
      terminal: !!terminal
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    let retryAfter = null;
    try {
      const parsed = JSON.parse(errText);
      retryAfter = parsed.retry_after;
    } catch {}
    const err = new Error(`Heartbeat failed (${res.status}): ${errText}`);
    err.status = res.status;
    err.retryAfter = retryAfter;
    throw err;
  }
  return await res.json();
}

// Main Automation Runner Loop
async function runAutoQuests(token) {
  if (runnerState.isRunning) {
    log('ระบบกำลังทำงานอยู่แล้ว ไม่สามารถเริ่มซ้ำได้', 'warn');
    return;
  }

  runnerState.isRunning = true;
  runnerState.shouldStop = false;
  log('🚀 เริ่มต้นการรัน Discord Quest อัตโนมัติ (No AutoClaim Mode)...', 'info');
  log('💡 คำแนะนำ: สำหรับเควสต์เล่นเกม กรุณากดปุ่ม "รับเควสต์ (Accept Quest)" ในแอป Discord ก่อนเสมอ เพื่อเปิดรับคะแนน', 'info');

  try {
    // 1. Fetch current quest list safely with cache shield
    log('กำลังดึงข้อมูลเควสต์จาก Discord...', 'info');
    let questResult = await getOrFetchQuests(token, true);

    if (questResult.rateLimited && (!questResult.quests || questResult.quests.length === 0)) {
      log(`⏳ กำลังติด Rate Limit รอก่อน ${questResult.retryAfter} วินาที...`, 'warn');
      await new Promise(r => setTimeout(r, (questResult.retryAfter * 1000) + 1000));
      questResult = await getOrFetchQuests(token, true);
    }

    const parsedList = questResult.quests || [];
    const nonExpiredQuests = parsedList.filter(q => !q.isExpired);
    const pendingQuests = nonExpiredQuests.filter(q => !q.isCompleted);
    const readyToClaimCount = nonExpiredQuests.filter(q => q.statusText === 'READY_TO_CLAIM').length;

    log(`พบเควสต์ที่เปิดอยู่: ${nonExpiredQuests.length} รายการ (ทำเสร็จรอเคลม: ${readyToClaimCount}, ต้องทำต่อ: ${pendingQuests.length}, หมดอายุ/ไม่นำมาคิด: ${parsedList.length - nonExpiredQuests.length} รายการ)`, 'info');

    if (readyToClaimCount > 0) {
      log(`💡 มี ${readyToClaimCount} เควสต์ที่ทำเสร็จแล้ว สามารถเข้าไปกดรับของรางวัลใน Discord ได้เลย (ข้ามการเคลมอัตโนมัติเพื่อความปลอดภัย)`, 'warn');
    }

    if (pendingQuests.length === 0) {
      log('🎉 ไม่มีเควสต์ที่ต้องทำค้างแล้ว! ทุกอย่างเสร็จสมบูรณ์', 'success');
      runnerState.isRunning = false;
      return;
    }

    // Filter: Only run quests accepted/enrolled in Discord client if enabled
    let candidateQuests = pendingQuests;
    if (currentConfig.onlyEnrolledQuests !== false) {
      const unenrolled = pendingQuests.filter(q => !q.isEnrolled);
      candidateQuests = pendingQuests.filter(q => q.isEnrolled);
      if (unenrolled.length > 0) {
        log(`🛡️ เปิดโหมดกรอง: ข้ามเควสต์ที่ยังไม่ได้กดรับใน Discord ${unenrolled.length} รายการ (ทำเฉพาะเควสต์ที่กดรับแล้ว ${candidateQuests.length} รายการ เพื่อป้องกันเควสต์ผี/นอกภูมิภาค)`, 'info');
      }
      if (candidateQuests.length === 0) {
        log('⚠️ ไม่พบเควสต์ที่คุณกดรับไว้ใน Discord เลย! กรุณาเปิดแอป Discord -> Discover -> Quests แล้วกดปุ่ม "รับเควสต์ (Accept Quest)" ในเควสต์ที่ต้องการก่อนเริ่ม', 'warn');
        runnerState.isRunning = false;
        return;
      }
    }

    // Identify Watch/Video quests vs Game Playing quests
    const isWatchQuest = (q) => q.taskType.includes('VIDEO') || q.taskType.includes('WATCH') || q.taskType.includes('STREAM');
    const watchQuests = candidateQuests.filter(isWatchQuest);
    const gameQuests = candidateQuests.filter(q => !isWatchQuest(q));

    let questsToRun = candidateQuests;
    if (currentConfig.skipGameQuests !== false) {
      questsToRun = watchQuests;
      log(`⚡ การตั้งค่า: ข้ามเควสต์เล่นเกมทั้งหมด (${gameQuests.length} เควสต์) • ทำเฉพาะเควสต์ดูเวลา/วิดีโอ (${watchQuests.length} เควสต์)`, 'info');

      // Auto Enroll all game quests so they are marked as accepted in Discord
      if (currentConfig.autoEnroll && gameQuests.length > 0) {
        log(`📝 กำลังกดรับ (Accept/Enroll) เควสต์เล่นเกม ${gameQuests.length} รายการให้อัตโนมัติ...`, 'info');
        for (const gq of gameQuests) {
          if (!gq.isEnrolled) {
            try {
              await enrollQuest(token, gq.id);
              gq.isEnrolled = true;
              log(`  -> กดรับเควสต์: "${gq.name}" (${gq.gameTitle}) สำเร็จ`, 'info');
              await new Promise(r => setTimeout(r, 600));
            } catch (e) {}
          }
        }
      }

      if (watchQuests.length === 0) {
        log(`🎉 เควสต์ดูวิดีโอ/เวลาเสร็จสิ้นครบหมดแล้ว! (ข้ามเควสต์เล่นเกม ${gameQuests.length} รายการตามที่คุณต้องการ)`, 'success');
        runnerState.isRunning = false;
        return;
      }
    } else {
      log(`⚡ การตั้งค่า: ทำทุกเควสต์รวมถึงเควสต์เล่นเกม (${candidateQuests.length} เควสต์: ดูคลิป ${watchQuests.length} + เล่นเกม ${gameQuests.length}) ด้วย Fake Game Spawner 🎮`, 'info');
    }

    // Sort: Video quests first, then game quests
    questsToRun.sort((a, b) => {
      const aIsVid = a.taskType.includes('VIDEO') ? 1 : 0;
      const bIsVid = b.taskType.includes('VIDEO') ? 1 : 0;
      return bIsVid - aIsVid;
    });

    runnerState.progress.total = questsToRun.length;
    runnerState.progress.done = 0;

    for (let i = 0; i < questsToRun.length; i++) {
      if (runnerState.shouldStop) {
        log('⏹️ ผู้ใช้สั่งหยุดการทำงาน', 'warn');
        break;
      }

      const q = questsToRun[i];
      runnerState.currentQuest = q;
      runnerState.progress.currentName = q.name;
      runnerState.progress.currentType = q.taskType;
      runnerState.progress.currentSeconds = q.currentSeconds;
      runnerState.progress.targetSeconds = q.targetSeconds;
      runnerState.progress.percent = Math.floor((q.currentSeconds / (q.targetSeconds || 1)) * 100);

      log(`\n📌 [${i + 1}/${questsToRun.length}] เริ่มเควสต์: "${q.name}" (${q.taskType}) | เป้าหมาย: ${q.targetSeconds}s`, 'info');

      // 1. Auto Enroll
      if (!q.isEnrolled) {
        try {
          await enrollQuest(token, q.id);
          q.isEnrolled = true;
          log(`✅ เข้าร่วมเควสต์สำเร็จ (Enrolled): ${q.name}`, 'success');
          await new Promise(r => setTimeout(r, 1200));
        } catch (err) {
          log(`⚠️ ไม่สามารถกดรับเควสต์ "${q.name}": ${err.message}`, 'warn');
          log(`⏭️ ข้ามเควสต์ "${q.name}" (กรุณากดรับในแอป Discord ก่อน หากต้องการทำเควสต์นี้)`, 'warn');
          runnerState.progress.done++;
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
      }

      // 2. Execute Task
      if (q.taskType.includes('VIDEO')) {
        let secDone = q.currentSeconds;
        const target = q.targetSeconds;
        const step = currentConfig.videoSpeed || 7;

        log(`▶️ กำลังจำลองการดูคลิปวิดีโอ (${secDone}/${target}s)...`, 'info');

        while (secDone < target) {
          if (!isLicensed()) {
            log('🔒 License หมดอายุหรือถูกระงับ: หยุดการทำงานทันที', 'error');
            runnerState.shouldStop = true;
            break;
          }
          if (runnerState.shouldStop) break;

          await new Promise(r => setTimeout(r, step * 1000));
          secDone = Math.min(target, secDone + step);
          const timestampPayload = Math.min(target, secDone + (Math.random() * 0.5));

          try {
            const res = await sendVideoProgress(token, q.id, timestampPayload);
            const serverVal = res?.progress?.[q.taskType]?.value ?? res?.progress?.WATCH_VIDEO?.value ?? res?.progress?.WATCH_VIDEO_ON_MOBILE?.value;
            if (typeof serverVal === 'number' && serverVal > secDone) {
              secDone = Math.min(target, serverVal);
            }
            runnerState.progress.currentSeconds = secDone;
            runnerState.progress.percent = Math.floor((secDone / target) * 100);

            log(`📺 ดูคลิป [${q.name}]: ${secDone}/${target}s (${runnerState.progress.percent}%)`, 'video');

            if (res.completed_at || secDone >= target) {
              log(`✨ เควสต์วิดีโอ "${q.name}" ทำสำเร็จแล้ว 100%! (รอไปกดรับรางวัลใน Discord)`, 'success');
              // Update local cache
              q.isCompleted = true;
              q.statusText = 'READY_TO_CLAIM';
              break;
            }
          } catch (err) {
            if (err.retryAfter) {
              const waitSec = Math.ceil(err.retryAfter);
              log(`⏳ ติด Rate Limit รอก่อน ${waitSec} วินาที...`, 'warn');
              await new Promise(r => setTimeout(r, (waitSec * 1000) + 1000));
            } else {
              log(`❌ Video heartbeat error: ${err.message}`, 'error');
              await new Promise(r => setTimeout(r, 4000));
            }
          }
        }
      } else if (q.taskType === 'PLAY_ON_DESKTOP') {
        const appId = q.applicationId || q.rawConfig?.task_config_v2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id || q.rawConfig?.application?.id;
        const target = q.targetSeconds || 900;
        let secDone = q.currentSeconds || 0;

        log(`🎮 รันเควสต์เล่นเกม: "${q.name}" (App ID: ${appId}) | เป้าหมาย: ${target}s (${Math.ceil(target / 60)} นาที)...`, 'info');

        // Optional background process simulation
        let exeName = 'game.exe';
        try {
          exeName = await findExecutableForQuest(q);
          activeFakeGame = spawnFakeGame(exeName, q.gameTitle || q.name);
          log(`🚀 จำลองโปรเซส [${exeName}] (PID: ${activeFakeGame.pid}) เรียบร้อย (กิน CPU/RAM 0%)`, 'info');
        } catch (e) {}

        log(`⚡ เริ่มระบบ Direct Heartbeat Engine ยิงตรงสู่เซิร์ฟเวอร์ Discord ทุก 20 วินาที...`, 'info');

        try {
          while (secDone < target) {
            if (!isLicensed()) {
              log('🔒 License หมดอายุหรือถูกระงับ: หยุดการทำงานทันที', 'error');
              runnerState.shouldStop = true;
              break;
            }
            if (runnerState.shouldStop) {
              log('⏹️ ผู้ใช้สั่งหยุดการทำงาน', 'warn');
              break;
            }

            try {
              const hbRes = await sendGameHeartbeat(token, q.id, appId, false);
              const serverProgress = hbRes?.progress?.PLAY_ON_DESKTOP?.value;

              if (typeof serverProgress === 'number') {
                secDone = serverProgress;
              } else {
                secDone = Math.min(target, secDone + 20);
              }

              runnerState.progress.currentSeconds = secDone;
              runnerState.progress.percent = Math.floor((secDone / target) * 100);

              log(`🎮 ความคืบหน้าเควสต์ [${q.name}]: ${secDone}/${target}s (${Math.floor(secDone / 60)}/${Math.ceil(target / 60)} นาที - ${runnerState.progress.percent}%)`, 'info');

              if (hbRes.completed_at || secDone >= target) {
                // Send final terminal heartbeat to finalize completion
                try {
                  await sendGameHeartbeat(token, q.id, appId, true);
                } catch {}
                log(`✨ เควสต์เล่นเกม "${q.name}" ทำสำเร็จแล้ว 100%! (ปุ่มใน Discord จะเปลี่ยนเป็น Claim Reward ทันที)`, 'success');
                q.isCompleted = true;
                q.statusText = 'READY_TO_CLAIM';
                break;
              }
            } catch (hbErr) {
              if (hbErr.status === 404 || hbErr.message.includes('expired') || hbErr.message.includes('260017')) {
                log(`⚠️ เควสต์ "${q.name}" หมดอายุหรือถูกปิดจากเซิร์ฟเวอร์ Discord แล้ว (ข้าม)`, 'warn');
                break;
              }
              if (hbErr.retryAfter) {
                const waitSec = Math.ceil(hbErr.retryAfter);
                log(`⏳ ติด Rate Limit รอก่อน ${waitSec} วินาที...`, 'warn');
                await new Promise(r => setTimeout(r, (waitSec * 1000) + 1000));
              } else {
                log(`⚠️ Heartbeat notice: ${hbErr.message}`, 'warn');
              }
            }

            // Discord expects heartbeats every 20 seconds
            await new Promise(r => setTimeout(r, 20000));
          }
        } catch (fakeErr) {
          log(`❌ เกิดข้อผิดพลาดในการทำเควสต์: ${fakeErr.message}`, 'error');
        } finally {
          if (activeFakeGame) {
            killFakeGame(activeFakeGame);
            log(`🛑 ปิด Process จำลอง [${exeName}] เรียบร้อยแล้ว`, 'info');
            activeFakeGame = null;
          }
        }
      } else if (q.taskType.includes('STREAM')) {
        log(`ℹ️ เควสต์ "${q.name}" เป็นประเภท [สตรีมหน้าจอ] ต้องสตรีมให้เพื่อนในห้องเสียงดู (ระบบข้ามให้อัตโนมัติ)`, 'info');
      } else if (q.taskType.includes('ACHIEVEMENT') || q.taskType.includes('ACTIVITY')) {
        log(`ℹ️ เควสต์ "${q.name}" เป็นประเภท [ภารกิจในกิจกรรม/เกม] ซึ่งต้องเล่นในเกมจริง (ระบบข้ามให้อัตโนมัติ)`, 'info');
      } else {
        log(`ℹ️ เควสต์ "${q.name}" เป็นประเภท [${q.taskType}] ซึ่งยังไม่รองรับระบบบอทอัตโนมัติ (ข้าม)`, 'info');
      }

      runnerState.progress.done++;
      await new Promise(r => setTimeout(r, 2000));
    }

    log('\n🏁 กระบวนการทำงานอัตโนมัติทั้งหมดเสร็จสิ้น!', 'success');
  } catch (err) {
    log(`❌ เกิดข้อผิดพลาดในการรันเควสต์: ${err.message}`, 'error');
  } finally {
    if (activeFakeGame) {
      killFakeGame(activeFakeGame);
      activeFakeGame = null;
    }
    runnerState.isRunning = false;
    runnerState.currentQuest = null;
    runnerState.progress.currentName = '';
  }
}

// --- HTTP Request Router ---
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // --- API Routes ---

  // License API Protection Gate
  const publicApiRoutes = [
    '/api/status',
    '/api/hwid',
    '/api/license/status',
    '/api/license/activate',
    '/api/license/logout',
    '/api/version',
    '/api/check-update',
    '/api/download-latest',
    '/api/auto-update',
    '/api/shutdown'
  ];
  if (pathname.startsWith('/api/') && !publicApiRoutes.includes(pathname)) {
    if (!isLicensed()) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: 'กรุณาเปิดใช้งาน License Key ก่อนเริ่มใช้งานระบบ',
        licenseRequired: true
      }));
    }
  }

  // 1. SSE Logs Stream
  if (pathname === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    // Send history
    for (const entry of logsBuffer) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 2. Auto-Extract Token from Local Storage
  if (pathname === '/api/auto-token' && req.method === 'POST') {
    log('🔍 เริ่มค้นหา Discord Token อัตโนมัติจาก Local Client/Browser...', 'info');
    try {
      const extracted = await findLocalDiscordToken();
      if (extracted.success && extracted.token) {
        currentConfig.token = extracted.token;
        if (Array.isArray(extracted.allAccounts)) {
          for (const acc of extracted.allAccounts) {
            upsertAccount(acc.user, acc.token);
          }
        } else if (extracted.user) {
          upsertAccount(extracted.user, extracted.token);
        }
        saveConfig();
        log(`🔑 ตรวจพบและยืนยัน Token ของผู้ใช้ @${extracted.user?.username || 'User'} จาก ${extracted.source || 'Web Browser'} สำเร็จ!`, 'success');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          token: extracted.token,
          user: extracted.user,
          source: extracted.source,
          accountsCount: extracted.allAccounts?.length || 1
        }));
      } else {
        log(`⚠️ ดึง Token อัตโนมัติไม่สำเร็จ: ${extracted.message}`, 'warn');
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: extracted.message }));
      }
    } catch (e) {
      log(`❌ ข้อผิดพลาดในการค้นหา Token: ${e.message}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // 3. Open Discord Web in Default Browser
  if (pathname === '/api/open-discord' && req.method === 'POST') {
    log('🌐 กำลังเปิด Discord Web ใน Default Browser...', 'info');
    const targetUrl = 'https://discord.com/app';
    exec(`start "" "${targetUrl}"`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, url: targetUrl }));
  }

  // 4. Fetch User Profile
  if (pathname === '/api/user' && req.method === 'GET') {
    const token = parsedUrl.searchParams.get('token') || currentConfig.token;
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'กรุณาระบุ Discord Token' }));
    }
    try {
      const user = await fetchDiscordUser(token);
      currentConfig.token = token.trim();
      upsertAccount(user, token);
      saveConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, user }));
    } catch (e) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // 4.1 Get Saved Accounts History
  if (pathname === '/api/accounts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      accounts: currentConfig.accounts || [],
      currentToken: currentConfig.token || ''
    }));
  }

  // 4.2 Switch Saved Account
  if (pathname === '/api/accounts/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      const targetId = data.id;
      const targetToken = data.token;
      const account = (currentConfig.accounts || []).find(a => (targetId && a.id === targetId) || (targetToken && a.token === targetToken));
      if (!account) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'ไม่พบบัญชีนี้ในประวัติ' }));
      }
      currentConfig.token = account.token;
      account.lastUsed = Date.now();
      saveConfig();
      log(`🔄 สลับไปใช้บัญชี @${account.username} เรียบร้อยแล้ว`, 'info');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, account }));
    });
    return;
  }

  // 4.3 Delete Saved Account
  if (pathname === '/api/accounts/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      const targetId = data.id;
      if (Array.isArray(currentConfig.accounts)) {
        currentConfig.accounts = currentConfig.accounts.filter(a => a.id !== targetId);
        saveConfig();
      }
      log(`🗑️ ลบบัญชีออกจากประวัติเรียบร้อยแล้ว`, 'info');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // 4.3.1 Get Settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      skipGameQuests: currentConfig.skipGameQuests !== false,
      autoEnroll: currentConfig.autoEnroll !== false,
      onlyEnrolledQuests: currentConfig.onlyEnrolledQuests !== false,
      videoSpeed: currentConfig.videoSpeed || 7
    }));
  }

  // 4.3.2 Update Settings
  if (pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      if (typeof data.skipGameQuests === 'boolean') {
        currentConfig.skipGameQuests = data.skipGameQuests;
      }
      if (typeof data.autoEnroll === 'boolean') {
        currentConfig.autoEnroll = data.autoEnroll;
      }
      if (typeof data.onlyEnrolledQuests === 'boolean') {
        currentConfig.onlyEnrolledQuests = data.onlyEnrolledQuests;
      }
      if (typeof data.videoSpeed === 'number') {
        currentConfig.videoSpeed = data.videoSpeed;
      }
      saveConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        settings: {
          skipGameQuests: currentConfig.skipGameQuests,
          autoEnroll: currentConfig.autoEnroll,
          onlyEnrolledQuests: currentConfig.onlyEnrolledQuests,
          videoSpeed: currentConfig.videoSpeed
        }
      }));
    });
    return;
  }

  // 4.3.3 Get Machine HWID
  if (pathname === '/api/hwid' && req.method === 'GET') {
    const hwid = getMachineHWID();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ hwid }));
  }

  // 4.3.4 Get License Status
  if (pathname === '/api/license/status' && req.method === 'GET') {
    const cached = loadLocalLicense();
    const hwid = getMachineHWID();
    const badge = getLicenseBadge(currentLicenseData || cached);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      activated: isLicenseActive,
      hwid: hwid,
      key: (currentLicenseData?.key || cached?.key) ? maskKey(currentLicenseData?.key || cached?.key) : '',
      tier: currentLicenseData?.tier || cached?.tier || '',
      tierName: currentLicenseData?.tierName || cached?.tierName || '',
      remainingDays: currentLicenseData?.remainingDays ?? cached?.remainingDays,
      expiresAt: currentLicenseData?.expiresAt || cached?.expiresAt,
      badge: badge.text,
      badgeData: badge,
      storeUrl: STORE_WEB_URL
    }));
  }

  // 4.3.5 Activate License via Web UI
  if (pathname === '/api/license/activate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      const result = await verifyOrActivateKey(data.key);
      if (result.success) {
        currentLicenseData = result;
        isLicenseActive = true;
        const badge = getLicenseBadge(result);
        log(`🔑 เปิดใช้งาน License Key สำเร็จ: ${badge.text}`, 'success');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: true,
          ...result,
          badge: badge.text,
          badgeData: badge
        }));
      } else {
        log(`❌ เปิดใช้งาน License Key ล้มเหลว: ${result.error}`, 'error');
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          success: false,
          error: result.error || 'License Key ไม่ถูกต้องหรือหมดอายุ'
        }));
      }
    });
    return;
  }

  // 4.3.6 Logout / Remove License Key
  if (pathname === '/api/license/logout' && req.method === 'POST') {
    clearLocalLicense();
    isLicenseActive = false;
    currentLicenseData = null;
    log('🚪 ออกจากระบบและลบสิทธิ์ License Key บนเครื่องนี้เรียบร้อยแล้ว', 'info');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ success: true, message: 'ออกจากระบบเรียบร้อยแล้ว' }));
  }

  // 4.4 Get Version Info
  if (pathname === '/api/version' && req.method === 'GET') {
    const v = getLocalVersionInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(v));
  }

  // 4.5 Check for Updates (GitHub Releases + raw version.json)
  if (pathname === '/api/check-update' && req.method === 'GET') {
    const localInfo = getLocalVersionInfo();
    const repo = "Newwee/discordquest";
    let latestVersion = localInfo.version;
    let releaseNotes = localInfo.releaseNotes || [];
    let releaseUrl = `https://github.com/${repo}/releases`;
    let releaseName = "";
    let publishedAt = "";

    try {
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          'User-Agent': 'DiscordQuestAuto-Updater/2.1'
        }
      });

      if (ghRes.ok) {
        const ghData = await ghRes.json();
        latestVersion = (ghData.tag_name || ghData.name || '').replace(/^v/i, '').trim();
        releaseName = ghData.name || ghData.tag_name || `v${latestVersion}`;
        releaseUrl = ghData.html_url || releaseUrl;
        publishedAt = ghData.published_at || "";
        if (ghData.body) {
          releaseNotes = ghData.body.split('\n').map(l => l.trim()).filter(Boolean);
        }
      } else {
        const rawRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/version.json`);
        if (rawRes.ok) {
          const rawData = await rawRes.json();
          latestVersion = (rawData.version || '').replace(/^v/i, '').trim();
          if (Array.isArray(rawData.releaseNotes) && rawData.releaseNotes.length > 0) {
            releaseNotes = rawData.releaseNotes;
          }
        }
      }
    } catch (e) {
      log(`⚠️ ตรวจสอบอัปเดตจาก GitHub ไม่สำเร็จ: ${e.message}`, 'warn');
    }

    const hasUpdate = compareSemver(localInfo.version, latestVersion) > 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      currentVersion: localInfo.version,
      latestVersion,
      hasUpdate,
      releaseName: releaseName || `v${latestVersion}`,
      releaseNotes,
      downloadUrl: '/api/download-latest',
      publishedAt
    }));
  }

  // 4.6 Direct Download Latest Release (Raw GitHub Direct Link)
  if (pathname === '/api/download-latest' && req.method === 'GET') {
    const directZipUrl = 'https://raw.githubusercontent.com/Newwee/discordquest/main/DiscordQuestAuto_Setup.zip';
    res.writeHead(302, { 'Location': directZipUrl });
    return res.end();
  }

  // 4.7 1-Click In-App Auto-Update & Patcher
  if (pathname === '/api/auto-update' && req.method === 'POST') {
    log('⚡ เริ่มกระบวนการ Auto-Update: กำลังดาวน์โหลดเวอร์ชันล่าสุด...', 'info');
    try {
      const zipUrl = 'https://raw.githubusercontent.com/Newwee/discordquest/main/DiscordQuestAuto_Setup.zip';
      const fetchRes = await fetch(zipUrl);
      if (!fetchRes.ok) {
        throw new Error(`ดาวน์โหลดล้มเหลว (HTTP ${fetchRes.status})`);
      }

      const tempDir = path.join(process.env.TEMP || os.tmpdir(), 'DiscordQuestAuto_Update');
      if (fs.existsSync(tempDir)) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
      fs.mkdirSync(tempDir, { recursive: true });

      const zipPath = path.join(tempDir, 'setup_update.zip');
      const arrayBuf = await fetchRes.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(arrayBuf));

      log('📦 ดาวน์โหลดเสร็จเรียบร้อย กำลังแตกไฟล์และติดตั้งอัปเดตแบบเงียบ...', 'info');

      // Extract Setup.exe via PowerShell and run /silent
      const extractScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = "${zipPath.replace(/\\/g, '\\\\')}"
$dest = "${tempDir.replace(/\\/g, '\\\\')}"
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
$setup = Join-Path $dest "Setup.exe"
if (Test-Path $setup) {
  Start-Process $setup -ArgumentList "/silent", "/dir=\`"${__dirname.replace(/\\/g, '\\\\')}\`""
}
`;
      const scriptPath = path.join(tempDir, 'do_update.ps1');
      fs.writeFileSync(scriptPath, extractScript, 'utf8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'กำลังติดตั้งอัปเดตและรีสตาร์ทระบบ...' }));

      // Run updater script detached and terminate current process so files can be replaced
      setTimeout(() => {
        exec(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`);
        setTimeout(() => {
          process.exit(0);
        }, 800);
      }, 400);
      return;
    } catch (updateErr) {
      log(`❌ อัปเดตอัตโนมัติไม่สำเร็จ: ${updateErr.message}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: updateErr.message }));
    }
  }

  // 5. Fetch Quests & Calculations (Cached & Rate-Limit Shielded)
  if (pathname === '/api/quests' && req.method === 'GET') {
    const token = parsedUrl.searchParams.get('token') || currentConfig.token;
    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'กรุณาระบุ Discord Token' }));
    }
    try {
      const result = await getOrFetchQuests(token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        stats: result.stats,
        quests: result.quests,
        rateLimited: result.rateLimited,
        retryAfter: result.retryAfter
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // 6. Start Auto Runner
  if (pathname === '/api/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch {}
      const token = data.token || currentConfig.token;
      if (!token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'กรุณาระบุ Discord Token' }));
      }
      currentConfig.token = token.trim();
      saveConfig();

      if (runnerState.isRunning) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'ระบบกำลังทำงานอยู่แล้ว' }));
      }

      // Start in background
      runAutoQuests(token);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'เริ่มทำงานแล้ว' }));
    });
    return;
  }

  // 7. Stop Auto Runner
  if (pathname === '/api/stop' && req.method === 'POST') {
    runnerState.shouldStop = true;
    if (activeFakeGame) {
      killFakeGame(activeFakeGame);
      activeFakeGame = null;
    }
    log('⏹️ ได้รับคำสั่งหยุดการทำงานจากผู้ใช้...', 'warn');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: 'สั่งหยุดการทำงานแล้ว' }));
  }

  // 8. Current Runner Status
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(runnerState));
  }

  // 9. Clear Logs
  if (pathname === '/api/clear-logs' && req.method === 'POST') {
    logsBuffer.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // 10. Shutdown Server
  if (pathname === '/api/shutdown' && req.method === 'POST') {
    log('🔴 กำลังปิดเซิร์ฟเวอร์ตามคำสั่งผู้ใช้...', 'warn');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    return;
  }

  // --- Static File Serving & Dynamic License Routing ---
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    if (!isLicensed()) {
      safePath = '/license.html';
    } else {
      safePath = '/index.html';
    }
  }
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

// --- Server Startup (Instant Port Binding & Non-Blocking License Check) ---
server.listen(PORT, '127.0.0.1', () => {
  log(`🌟 Discord Quest Auto Server พร้อมทำงานที่ http://localhost:${PORT}`, 'success');
  console.log(`Server running at http://localhost:${PORT}`);

  checkStartupLicense().then(result => {
    if (!result.requiredActivation && result.license && result.license.success) {
      currentLicenseData = result.license;
      isLicenseActive = true;
      const badge = getLicenseBadge(result.license);
      log(`🔑 ตรวจสอบสิทธิ์ License สำเร็จ: ${badge.text}`, 'success');
    } else {
      isLicenseActive = false;
      currentLicenseData = null;
      log('🔒 ยังไม่ได้เปิดใช้งาน License Key หรือคีย์หมดอายุ กรุณาเปิดใช้งานที่หน้าต่างโปรแกรม', 'warn');
    }
  });

  // Background Heartbeat Checker: ตรวจสอบสิทธิ์ซ้ำทุกๆ 30 นาที
  setInterval(async () => {
    const cached = loadLocalLicense();
    if (!cached || !cached.key) {
      if (isLicenseActive) {
        handleLicenseRevoked('ไม่พบ License Key ในเครื่อง');
      }
      return;
    }

    try {
      const checkRes = await verifyOrActivateKey(cached.key);
      if (!checkRes.success) {
        handleLicenseRevoked(checkRes.error || 'คีย์หมดอายุหรือถูกระงับสิทธิ์');
      } else {
        currentLicenseData = checkRes;
        isLicenseActive = true;
      }
    } catch (_) {}
  }, 30 * 60 * 1000);
});

function handleLicenseRevoked(reason) {
  isLicenseActive = false;
  currentLicenseData = null;
  clearLocalLicense();
  log(`🔒 [HEARTBEAT EXPIRED] License หมดอายุหรือถูกระงับ: ${reason}`, 'error');
  if (runnerState.isRunning) {
    runnerState.shouldStop = true;
    runnerState.isRunning = false;
    if (activeFakeGame) {
      killFakeGame(activeFakeGame);
      activeFakeGame = null;
    }
    log('🛑 ระบบหยุดการทำงานของ Bot เควสต์ทันทีเนื่องจากสิทธิ์หมดอายุ', 'warn');
  }
}
