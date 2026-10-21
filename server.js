const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { findLocalDiscordToken } = require('./token_extractor');

const PORT = 4545;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- State Management ---
const VERSION_FILE = path.join(__dirname, 'version.json');
let currentConfig = {
  token: '',
  autoEnroll: true,
  videoSpeed: 7, // seconds increment per pulse
  accounts: []
};

function getLocalVersionInfo() {
  if (fs.existsSync(VERSION_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    } catch {}
  }
  return {
    version: "2.1.0",
    name: "Discord Quest Auto",
    githubRepo: "https://github.com/Newwee/discordquest",
    releaseNotes: ["เวอร์ชันปัจจุบัน 2.1.0"]
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

function getDiscordHeaders(token) {
  return {
    "Authorization": token.trim(),
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Content-Type": "application/json"
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

  for (const q of parsed) {
    totalOrbs += q.orbs;
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
  targetSeconds = tasks[matchedKey]?.target || 0;

  // Read current progress
  const userStatus = quest.user_status || quest.userStatus || {};
  const progressObj = userStatus.progress || {};
  if (progressObj[matchedKey] && typeof progressObj[matchedKey].value === 'number') {
    currentSeconds = progressObj[matchedKey].value;
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
  } else if (isEnrolled) {
    statusText = "IN_PROGRESS";
  }

  return {
    id: quest.id,
    name: questName,
    gameTitle,
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
    headers: getDiscordHeaders(token),
    body: JSON.stringify({ location: 1 })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Enroll failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

// Update Video Progress
async function sendVideoProgress(token, questId, timestamp) {
  const res = await fetch(`https://discord.com/api/v9/quests/${questId}/video-progress`, {
    method: 'POST',
    headers: getDiscordHeaders(token),
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

// Main Automation Runner Loop
async function runAutoQuests(token) {
  if (runnerState.isRunning) {
    log('ระบบกำลังทำงานอยู่แล้ว ไม่สามารถเริ่มซ้ำได้', 'warn');
    return;
  }

  runnerState.isRunning = true;
  runnerState.shouldStop = false;
  log('🚀 เริ่มต้นการรัน Discord Quest อัตโนมัติ (No AutoClaim Mode)...', 'info');

  try {
    // 1. Fetch current quest list safely with cache shield
    log('กำลังดึงข้อมูลเควสต์จาก Discord...', 'info');
    let questResult = await getOrFetchQuests(token);

    if (questResult.rateLimited && (!questResult.quests || questResult.quests.length === 0)) {
      log(`⏳ กำลังติด Rate Limit รอก่อน ${questResult.retryAfter} วินาที...`, 'warn');
      await new Promise(r => setTimeout(r, (questResult.retryAfter * 1000) + 1000));
      questResult = await getOrFetchQuests(token, true);
    }

    const parsedList = questResult.quests || [];
    const pendingQuests = parsedList.filter(q => !q.isCompleted && !q.isExpired);
    const readyToClaimCount = parsedList.filter(q => q.statusText === 'READY_TO_CLAIM').length;

    log(`พบเควสต์ทั้งหมด: ${parsedList.length} รายการ (ทำเสร็จรอเคลม: ${readyToClaimCount}, ต้องทำต่อ: ${pendingQuests.length})`, 'info');

    if (readyToClaimCount > 0) {
      log(`💡 มี ${readyToClaimCount} เควสต์ที่ทำเสร็จแล้ว สามารถเข้าไปกดรับของรางวัลใน Discord ได้เลย (ข้ามการเคลมอัตโนมัติเพื่อความปลอดภัย)`, 'warn');
    }

    if (pendingQuests.length === 0) {
      log('🎉 ไม่มีเควสต์ที่ต้องทำค้างแล้ว! ทุกอย่างเสร็จสมบูรณ์', 'success');
      runnerState.isRunning = false;
      return;
    }

    // Sort: Video quests first
    pendingQuests.sort((a, b) => {
      const aIsVid = a.taskType.includes('VIDEO') ? 1 : 0;
      const bIsVid = b.taskType.includes('VIDEO') ? 1 : 0;
      return bIsVid - aIsVid;
    });

    runnerState.progress.total = pendingQuests.length;
    runnerState.progress.done = 0;

    for (let i = 0; i < pendingQuests.length; i++) {
      if (runnerState.shouldStop) {
        log('⏹️ ผู้ใช้สั่งหยุดการทำงาน', 'warn');
        break;
      }

      const q = pendingQuests[i];
      runnerState.currentQuest = q;
      runnerState.progress.currentName = q.name;
      runnerState.progress.currentType = q.taskType;
      runnerState.progress.currentSeconds = q.currentSeconds;
      runnerState.progress.targetSeconds = q.targetSeconds;
      runnerState.progress.percent = Math.floor((q.currentSeconds / (q.targetSeconds || 1)) * 100);

      log(`\n📌 [${i + 1}/${pendingQuests.length}] เริ่มเควสต์: "${q.name}" (${q.taskType}) | เป้าหมาย: ${q.targetSeconds}s`, 'info');

      // 1. Auto Enroll
      if (!q.isEnrolled) {
        try {
          await enrollQuest(token, q.id);
          log(`✅ เข้าร่วมเควสต์สำเร็จ (Enrolled): ${q.name}`, 'success');
          await new Promise(r => setTimeout(r, 1200));
        } catch (err) {
          log(`⚠️ เข้าร่วมเควสต์ไม่ผ่าน (${q.name}): ${err.message}`, 'warn');
        }
      }

      // 2. Execute Task
      if (q.taskType.includes('VIDEO')) {
        let secDone = q.currentSeconds;
        const target = q.targetSeconds;
        const step = currentConfig.videoSpeed || 7;

        log(`▶️ กำลังจำลองการดูคลิปวิดีโอ (${secDone}/${target}s)...`, 'info');

        while (secDone < target) {
          if (runnerState.shouldStop) break;

          await new Promise(r => setTimeout(r, step * 1000));
          secDone = Math.min(target, secDone + step);
          const timestampPayload = Math.min(target, secDone + (Math.random() * 0.5));

          try {
            const res = await sendVideoProgress(token, q.id, timestampPayload);
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
      } else {
        // Desktop / Game / Stream Quest
        log(`ℹ️ เควสต์ "${q.name}" เป็นประเภท [${q.taskType}]`, 'info');
        log(`💡 สำหรับเควสต์เกม/สตรีม Discord จำเป็นต้องใช้การตรวจจับจากโปรแกรม Discord Desktop หรือเปิด Stream ในห้องเสียง`, 'warn');
        log(`⏩ กำลังข้ามไปเควสต์ถัดไป... (คุณสามารถเปิดสตรีมในดิสแล้วรอให้เวลาเควสขึ้นได้)`, 'info');
      }

      runnerState.progress.done++;
      await new Promise(r => setTimeout(r, 2000));
    }

    log('\n🏁 กระบวนการทำงานอัตโนมัติทั้งหมดเสร็จสิ้น!', 'success');
  } catch (err) {
    log(`❌ เกิดข้อผิดพลาดในการรันเควสต์: ${err.message}`, 'error');
  } finally {
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
      releaseUrl,
      publishedAt
    }));
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

  // --- Static File Serving ---
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';
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

server.listen(PORT, '127.0.0.1', () => {
  log(`🌟 Discord Quest Auto Server พร้อมทำงานที่ http://localhost:${PORT}`, 'success');
  console.log(`Server running at http://localhost:${PORT}`);
});
