// Discord Quest Auto Client Application (ReactBits Edition)

// --- License Key Protection Guard ---
(function verifyLicenseGuard() {
  const isVerified = localStorage.getItem('license_verified') === 'true';
  const savedKey = (localStorage.getItem('license_key') || '').trim().toUpperCase();
  if (!isVerified || !savedKey.startsWith('J3ADQ-')) {
    window.location.replace('/license.html');
  }
})();

let currentQuests = [];
let activeTab = 'active';
let isRunning = false;
let statusPollInterval = null;
let questRefreshInterval = null;
let isFetchingQuests = false;

// DOM Elements
const tokenInput = document.getElementById('tokenInput');
const btnToggleToken = document.getElementById('btnToggleTokenVisibility');
const btnAutoToken = document.getElementById('btnAutoToken');
const btnConnect = document.getElementById('btnConnect');
const btnRefresh = document.getElementById('btnRefresh');
const btnOpenDiscord = document.getElementById('btnOpenDiscord');
const btnShutdown = document.getElementById('btnShutdown');
const btnStartAuto = document.getElementById('btnStartAuto');
const btnStopAuto = document.getElementById('btnStopAuto');
const btnToggleHelp = document.getElementById('btnToggleHelp');
const tokenHelpBox = document.getElementById('tokenHelpBox');
const btnCopySnippet = document.getElementById('btnCopySnippet');

// Modal Elements
const tokenConfirmModal = document.getElementById('tokenConfirmModal');
const btnCancelAutoToken = document.getElementById('btnCancelAutoToken');
const btnApproveAutoToken = document.getElementById('btnApproveAutoToken');

// Guide Modal Elements
const guideModal = document.getElementById('guideModal');
const btnOpenGuide = document.getElementById('btnOpenGuide');
const btnCloseGuide = document.getElementById('btnCloseGuide');
const chkDontShowGuideAgain = document.getElementById('chkDontShowGuideAgain');

// Update Modal Elements
const updateModal = document.getElementById('updateModal');
const btnCheckUpdate = document.getElementById('btnCheckUpdate');
const updateBadge = document.getElementById('updateBadge');
const btnCheckUpdateAgain = document.getElementById('btnCheckUpdateAgain');
const btnAutoUpdate = document.getElementById('btnAutoUpdate');
const btnDownloadUpdate = document.getElementById('btnDownloadUpdate');
const btnCloseUpdateModal = document.getElementById('btnCloseUpdateModal');
const currentVersionTag = document.getElementById('currentVersionTag');
const latestVersionTag = document.getElementById('latestVersionTag');
const updateStatusBanner = document.getElementById('updateStatusBanner');
const updateStatusText = document.getElementById('updateStatusText');
const changelogList = document.getElementById('changelogList');
let latestReleaseUrl = '/api/download-latest';

// Account Switcher Elements
const accountModal = document.getElementById('accountModal');
const btnAccountHistory = document.getElementById('btnAccountHistory');
const accountCountBadge = document.getElementById('accountCountBadge');
const accountListContainer = document.getElementById('accountListContainer');
const btnCloseAccountModal = document.getElementById('btnCloseAccountModal');
let savedAccountsList = [];

// Global Loader Elements
const globalLoader = document.getElementById('globalLoader');
const loaderTitle = document.getElementById('loaderTitle');
const loaderSubtext = document.getElementById('loaderSubtext');
const loaderTimer = document.getElementById('loaderTimer');
let loaderStartTime = 0;
let loaderTimerInterval = null;

function showLoader(title = 'กำลังดำเนินการ...', subtext = 'กรุณารอสักครู่') {
  if (!globalLoader) return;
  loaderTitle.textContent = title;
  loaderSubtext.textContent = subtext;
  loaderStartTime = Date.now();
  loaderTimer.textContent = '0.0s';
  globalLoader.classList.remove('hidden');

  if (loaderTimerInterval) clearInterval(loaderTimerInterval);
  loaderTimerInterval = setInterval(() => {
    const elapsed = ((Date.now() - loaderStartTime) / 1000).toFixed(1);
    loaderTimer.textContent = `${elapsed}s`;
  }, 100);
}

function hideLoader() {
  if (!globalLoader) return;
  if (loaderTimerInterval) {
    clearInterval(loaderTimerInterval);
    loaderTimerInterval = null;
  }
  globalLoader.classList.add('hidden');
}

// User Profile Elements
const userBadge = document.getElementById('userBadge');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');

// Stats Elements
const statTotalQuests = document.getElementById('statTotalQuests');
const statCompletedQuests = document.getElementById('statCompletedQuests');
const statReadyToClaimSub = document.getElementById('statReadyToClaimSub');
const statPendingQuests = document.getElementById('statPendingQuests');
const statTotalOrbs = document.getElementById('statTotalOrbs');
const statClaimableOrbs = document.getElementById('statClaimableOrbs');
const statPendingOrbs = document.getElementById('statPendingOrbs');

// Tab counters
const countTabActive = document.getElementById('countTabActive');
const countTabEnrolled = document.getElementById('countTabEnrolled');
const countTabVideo = document.getElementById('countTabVideo');
const countTabDesktop = document.getElementById('countTabDesktop');
const countTabCompleted = document.getElementById('countTabCompleted');
const countTabExpired = document.getElementById('countTabExpired');

// Runner Elements
const runnerPulse = document.getElementById('runnerPulse');
const runnerSubtext = document.getElementById('runnerSubtext');
const runnerProgressArea = document.getElementById('runnerProgressArea');
const activeQuestTitle = document.getElementById('activeQuestTitle');
const activeQuestETA = document.getElementById('activeQuestETA');
const activeQuestProgressText = document.getElementById('activeQuestProgressText');
const activeProgressBar = document.getElementById('activeProgressBar');
const chkOnlyEnrolled = document.getElementById('chkOnlyEnrolled');
const chkSkipGameQuests = document.getElementById('chkSkipGameQuests');
const btnOpenDiscordNotice = document.getElementById('btnOpenDiscordNotice');

// Quests Container
const questsContainer = document.getElementById('questsContainer');
const questSearchInput = document.getElementById('questSearchInput');
const tabButtons = document.querySelectorAll('.tab-btn');

// Console Elements
const consoleLogContainer = document.getElementById('consoleLogContainer');
const chkAutoScroll = document.getElementById('chkAutoScroll');
const btnClearLogs = document.getElementById('btnClearLogs');
const btnCopyLogs = document.getElementById('btnCopyLogs');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved token
  const savedToken = localStorage.getItem('discord_quest_token') || '';
  if (savedToken) {
    tokenInput.value = savedToken;
    fetchData(savedToken);
  }

  // Setup Real-time SSE Logs
  setupSSELogs();

  // Setup Event Listeners
  setupEventListeners();

  // Setup ReactBits: Interactive Spotlight Effect
  setupSpotlightEngine();

  // Start polling runner status (every 1s)
  startStatusPolling();

  // Start auto-refreshing quests strictly every 5 seconds!
  startQuestAutoRefresh();

  // Load account history
  loadAccountsHistory();

  // Load app settings
  loadSettings();

  // Check for updates silently in the background
  checkForUpdates(false);

  // Check if first-time user guide should be shown
  const hasSeenGuide = localStorage.getItem('discord_quest_guide_seen');
  if (!hasSeenGuide) {
    setTimeout(openGuideModal, 600);
  }
});

// ReactBits: Smooth Number Counter
function animateNumber(element, targetVal) {
  if (!element) return;
  const currentVal = parseInt(element.textContent, 10) || 0;
  if (currentVal === targetVal) return;
  const startTime = performance.now();
  const duration = 400;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = Math.floor(currentVal + (targetVal - currentVal) * ease);
    element.textContent = val;
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = targetVal;
    }
  }
  requestAnimationFrame(update);
}

// ReactBits: High-Performance Spotlight Tracking Engine (Butter-Smooth 60FPS, Zero Layout Thrashing)
function setupSpotlightEngine() {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.spotlight-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, { passive: true });
}

// Setup Server-Sent Events (SSE)
function setupSSELogs() {
  const evtSource = new EventSource('/api/logs');

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      appendLog(data);
    } catch (e) {
      console.error('Error parsing SSE data', e);
    }
  };

  evtSource.onerror = () => {
    // Reconnects automatically
  };
}

function appendLog(entry) {
  const row = document.createElement('div');
  row.className = `log-entry ${entry.type || 'info'}`;
  row.innerHTML = `<span class="log-time">[${entry.time}]</span> <span class="log-text">${escapeHtml(entry.message)}</span>`;
  consoleLogContainer.appendChild(row);

  if (chkAutoScroll.checked) {
    consoleLogContainer.scrollTop = consoleLogContainer.scrollHeight;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Setup Event Listeners
function setupEventListeners() {
  btnToggleToken.addEventListener('click', () => {
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
  });

  btnToggleHelp.addEventListener('click', () => {
    tokenHelpBox.classList.toggle('hidden');
  });

  btnCopySnippet.addEventListener('click', () => {
    const code = "(()=>{let t;webpackChunkdiscord_app.push([[Symbol()],{},r=>{for(let k in r.c){let m=r.c[k]?.exports;for(let o of[m,m?.default,m?.Z,m?.ZP,m?.A])try{if(typeof o?.getToken==='function'){t=o.getToken();if(t)break;}}catch(e){}}if(t)break;}]);webpackChunkdiscord_app.pop();copy(t);console.log('%cTOKEN COPIED: %c'+t,'color:#00ffcc;font-weight:bold;','color:#ffff00;font-weight:bold;');return t;})()";
    navigator.clipboard.writeText(code);
    btnCopySnippet.textContent = 'คัดลอกแล้ว!';
    setTimeout(() => { btnCopySnippet.textContent = 'คัดลอกโค้ด'; }, 2000);
  });

  // 1. OPEN DISCORD WEB
  btnOpenDiscord.addEventListener('click', async () => {
    window.open('https://discord.com/app', '_blank');
    try {
      await fetch('/api/open-discord', { method: 'POST' });
    } catch (e) {}
  });

  if (btnOpenDiscordNotice) {
    btnOpenDiscordNotice.addEventListener('click', async () => {
      window.open('https://discord.com/app', '_blank');
      try {
        await fetch('/api/open-discord', { method: 'POST' });
      } catch (e) {}
    });
  }

  // 1.1 LICENSE STATUS & LOGOUT BUTTON
  const btnLicenseStatus = document.getElementById('btnLicenseStatus');
  if (btnLicenseStatus) {
    const rawKey = (localStorage.getItem('license_key') || '').trim().toUpperCase();
    const maskedKey = rawKey.length > 8 ? `${rawKey.slice(0, 7)}****${rawKey.slice(-4)}` : rawKey;
    const navLicenseText = document.getElementById('navLicenseText');
    if (navLicenseText && rawKey) {
      navLicenseText.textContent = maskedKey;
    }

    btnLicenseStatus.addEventListener('click', () => {
      const currentKey = localStorage.getItem('license_key') || 'ไม่มีข้อมูล';
      const promptLogout = confirm(
        `🔑 ข้อมูล License Key ของคุณ\n\n` +
        `• คีย์ปัจจุบัน: ${currentKey}\n` +
        `• สถานะ: เปิดใช้งานแล้ว (J3A Discord AutoQuest)\n\n` +
        `ต้องการออกจากระบบเพื่อสลับเปลี่ยน License Key หรือไม่?`
      );
      if (promptLogout) {
        localStorage.removeItem('license_verified');
        localStorage.removeItem('license_key');
        window.location.href = '/license.html';
      }
    });
  }

  // 2. AUTO TOKEN BUTTON (Prompt modal)
  btnAutoToken.addEventListener('click', () => {
    tokenConfirmModal.classList.remove('hidden');
  });

  btnCancelAutoToken.addEventListener('click', () => {
    tokenConfirmModal.classList.add('hidden');
  });

  btnApproveAutoToken.addEventListener('click', async () => {
    tokenConfirmModal.classList.add('hidden');
    btnAutoToken.disabled = true;
    btnAutoToken.innerHTML = '<span class="sync-dot"></span> กำลังดึง...';
    showLoader('กำลังสแกนหา Discord Token...', 'กำลังถอดรหัส Master Key และค้นหาจากเครื่องของคุณ...');

    try {
      const res = await fetch('/api/auto-token', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'ไม่พบ Token');

      tokenInput.value = data.token;
      localStorage.setItem('discord_quest_token', data.token);

      showLoader('ดึง Token สำเร็จ!', 'กำลังซิงค์ข้อมูลเควสต์และคำนวณ Discord Orbs...');

      // Fetch immediately (non-blocking)
      try {
        await fetchData(data.token);
      } catch (e) {
        console.warn('Initial fetch caught:', e);
      }

      btnAutoToken.innerHTML = '✅ สำเร็จ!';
      setTimeout(() => {
        btnAutoToken.disabled = false;
        btnAutoToken.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ดึง Token อัตโนมัติ';
      }, 2500);
    } catch (err) {
      appendLog({ time: new Date().toLocaleTimeString('th-TH'), message: `❌ ดึง Token ไม่สำเร็จ: ${err.message}`, type: 'error' });
      btnAutoToken.disabled = false;
      btnAutoToken.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ดึง Token อัตโนมัติ';
    } finally {
      setTimeout(hideLoader, 600);
    }
  });

  // 3. MANUAL CONNECT
  btnConnect.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      alert('กรุณากรอก Discord User Token หรือกดปุ่ม "ดึง Token อัตโนมัติ"');
      return;
    }
    localStorage.setItem('discord_quest_token', token);
    showLoader('กำลังซิงค์เควสต์...', 'กำลังเชื่อมต่อกับ Discord API และคำนวณ Orbs...');
    try {
      await fetchData(token, true);
    } finally {
      setTimeout(hideLoader, 500);
    }
  });

  btnRefresh.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (token) {
      showLoader('กำลังรีเฟรชเควสต์...', 'กำลังตรวจสอบสถานะล่าสุดจาก Discord...');
      try {
        await fetchData(token, true);
      } finally {
        setTimeout(hideLoader, 500);
      }
    }
  });

  // 4. START AUTO RUNNER
  btnStartAuto.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      alert('กรุณากรอก Token หรือกด "ดึง Token อัตโนมัติ" ก่อนเริ่ม');
      return;
    }
    localStorage.setItem('discord_quest_token', token);
    showLoader('กำลังเริ่มต้นระบบ...', 'เตรียมตัวรันเควสต์ทั้งหมดแบบอัตโนมัติ...');
    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRunnerActive(true);
    } catch (e) {
      alert(`ไม่สามารถเริ่มได้: ${e.message}`);
    } finally {
      setTimeout(hideLoader, 600);
    }
  });

  // 5. STOP AUTO RUNNER
  btnStopAuto.addEventListener('click', async () => {
    try {
      await fetch('/api/stop', { method: 'POST' });
      setRunnerActive(false);
    } catch (e) {
      alert(`หยุดไม่สำเร็จ: ${e.message}`);
    }
  });

  // 6. SHUTDOWN
  btnShutdown.addEventListener('click', async () => {
    if (confirm('คุณต้องการปิดระบบเซิร์ฟเวอร์ LocalHost ใช่หรือไม่?')) {
      try {
        await fetch('/api/shutdown', { method: 'POST' });
        document.body.innerHTML = '<div style="padding: 40px; text-align: center; color: #fff; font-family: sans-serif;"><h2>เซิร์ฟเวอร์ถูกปิดเรียบร้อยแล้ว</h2><p>คุณสามารถปิดหน้านี้ได้เลย</p></div>';
      } catch (e) {}
    }
  });

  btnClearLogs.addEventListener('click', async () => {
    consoleLogContainer.innerHTML = '';
    await fetch('/api/clear-logs', { method: 'POST' });
  });

  btnCopyLogs.addEventListener('click', () => {
    const text = consoleLogContainer.innerText;
    navigator.clipboard.writeText(text);
    btnCopyLogs.textContent = 'คัดลอกแล้ว!';
    setTimeout(() => { btnCopyLogs.textContent = 'คัดลอก Log'; }, 2000);
  });

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      renderQuests();
    });
  });

  // Real-Time Search Filter
  if (questSearchInput) {
    questSearchInput.addEventListener('input', () => {
      renderQuests();
    });
  }

  // 7. USER GUIDE MODAL
  if (btnOpenGuide) {
    btnOpenGuide.addEventListener('click', openGuideModal);
  }
  if (btnCloseGuide) {
    btnCloseGuide.addEventListener('click', closeGuideModal);
  }

  // 8. UPDATE CHECKER MODAL
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => checkForUpdates(true));
  }
  if (btnCheckUpdateAgain) {
    btnCheckUpdateAgain.addEventListener('click', () => checkForUpdates(true));
  }
  if (btnDownloadUpdate) {
    btnDownloadUpdate.addEventListener('click', () => {
      if (latestReleaseUrl) window.open(latestReleaseUrl, '_blank');
    });
  }
  if (btnAutoUpdate) {
    btnAutoUpdate.addEventListener('click', async () => {
      if (!confirm('ยืนยันเริ่มการอัปเดตระบบอัตโนมัติ? (โปรแกรมจะดาวน์โหลดไฟล์และรีสตาร์ทตัวมันเองอัตโนมัติในไม่กี่วินาที)')) {
        return;
      }
      btnAutoUpdate.disabled = true;
      if (btnDownloadUpdate) btnDownloadUpdate.classList.add('hidden');
      updateStatusBanner.className = 'update-status-banner info';
      updateStatusText.innerHTML = '<span class="sync-dot"></span> กำลังดาวน์โหลดและติดตั้งเวอร์ชันล่าสุด... กรุณารอสักครู่';

      try {
        const res = await fetch('/api/auto-update', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'ดาวน์โหลดไม่สำเร็จ');

        updateStatusBanner.className = 'update-status-banner success';
        updateStatusText.textContent = '🚀 กำลังรีสตาร์ทโปรแกรมเป็นเวอร์ชันใหม่...';

        let retries = 0;
        const poll = setInterval(async () => {
          retries++;
          try {
            const ver = await fetch('/api/version');
            if (ver.ok) {
              clearInterval(poll);
              location.reload();
            }
          } catch (e) {
            if (retries > 30) {
              clearInterval(poll);
              location.reload();
            }
          }
        }, 1200);
      } catch (err) {
        updateStatusBanner.className = 'update-status-banner error';
        updateStatusText.textContent = `❌ อัปเดตไม่สำเร็จ: ${err.message}`;
        btnAutoUpdate.disabled = false;
        if (btnDownloadUpdate) btnDownloadUpdate.classList.remove('hidden');
      }
    });
  }
  if (btnCloseUpdateModal) {
    btnCloseUpdateModal.addEventListener('click', () => {
      updateModal.classList.add('hidden');
    });
  }

  // 9. ACCOUNT SWITCHER MODAL
  if (btnAccountHistory) {
    btnAccountHistory.addEventListener('click', openAccountModal);
  }
  if (btnCloseAccountModal) {
    btnCloseAccountModal.addEventListener('click', () => {
      accountModal.classList.add('hidden');
    });
  }

  // 10. ONLY ENROLLED QUESTS TOGGLE
  if (chkOnlyEnrolled) {
    chkOnlyEnrolled.addEventListener('change', async () => {
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onlyEnrolledQuests: chkOnlyEnrolled.checked })
        });
        appendLog({
          time: new Date().toLocaleTimeString('th-TH'),
          message: chkOnlyEnrolled.checked
            ? '🛡️ เปิดใช้งาน: ทำเฉพาะเควสต์ที่กดรับใน Discord แล้ว (ข้ามเควสต์ที่มองไม่เห็น/นอกภูมิภาค)'
            : '🌐 ปิดใช้งาน: อนุญาตให้ลองทำเควสต์ทั้งหมด (พยายาม Auto-Enroll อัตโนมัติ)',
          type: 'info'
        });
      } catch (e) {}
    });
  }

  // 11. SKIP GAME QUESTS TOGGLE
  if (chkSkipGameQuests) {
    chkSkipGameQuests.addEventListener('change', async () => {
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipGameQuests: chkSkipGameQuests.checked })
        });
        appendLog({
          time: new Date().toLocaleTimeString('th-TH'),
          message: chkSkipGameQuests.checked 
            ? '⚡ เปิดใช้งาน: ข้ามเควสต์เล่นเกม (ทำเฉพาะเควสต์ดูเวลา/คลิป)' 
            : '🎮 เปิดใช้งาน: โหมด Auto Fake Game (จำลองเล่นเกม 0% CPU เพื่อทำเควสต์เล่นเกมอัตโนมัติ)',
          type: 'info'
        });
      } catch (e) {}
    });
  }
}

// Load backend settings
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (chkSkipGameQuests && typeof data.skipGameQuests === 'boolean') {
        chkSkipGameQuests.checked = data.skipGameQuests;
      }
      if (chkOnlyEnrolled && typeof data.onlyEnrolledQuests === 'boolean') {
        chkOnlyEnrolled.checked = data.onlyEnrolledQuests;
      }
    }
  } catch (e) {}
}

// --- Guide Modal Functions ---
function openGuideModal() {
  if (!guideModal) return;
  const hasSeen = localStorage.getItem('discord_quest_guide_seen');
  if (chkDontShowGuideAgain) {
    chkDontShowGuideAgain.checked = !!hasSeen;
  }
  guideModal.classList.remove('hidden');
}

function closeGuideModal() {
  if (!guideModal) return;
  if (chkDontShowGuideAgain && chkDontShowGuideAgain.checked) {
    localStorage.setItem('discord_quest_guide_seen', 'true');
  } else {
    localStorage.removeItem('discord_quest_guide_seen');
  }
  guideModal.classList.add('hidden');
}

// --- Check for Updates Functions ---
async function checkForUpdates(openModalOnResult = false) {
  if (openModalOnResult) {
    updateModal.classList.remove('hidden');
    updateStatusBanner.className = 'update-status-banner info';
    updateStatusText.textContent = 'กำลังตรวจสอบเวอร์ชันล่าสุด...';
    btnCheckUpdateAgain.disabled = true;
  }

  try {
    const res = await fetch('/api/check-update');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ตรวจสอบไม่สำเร็จ');

    currentVersionTag.textContent = `v${data.currentVersion}`;
    latestVersionTag.textContent = `v${data.latestVersion}`;
    latestReleaseUrl = data.downloadUrl || data.releaseUrl || '/api/download-latest';

    // Populate Changelog
    changelogList.innerHTML = '';
    const notes = Array.isArray(data.releaseNotes) && data.releaseNotes.length > 0
      ? data.releaseNotes
      : ['ไม่มีรายละเอียดการเปลี่ยนแปลง'];
    notes.forEach(note => {
      const li = document.createElement('li');
      li.textContent = note;
      changelogList.appendChild(li);
    });

    if (data.hasUpdate) {
      // Show badge on button
      if (updateBadge) updateBadge.classList.remove('hidden');
      updateStatusBanner.className = 'update-status-banner has-update';
      updateStatusText.innerHTML = `🚀 ตรวจพบเวอร์ชันใหม่ <b>v${data.latestVersion}</b> พร้อมให้อัปเดต!`;
      if (btnAutoUpdate) btnAutoUpdate.classList.remove('hidden');
      if (btnDownloadUpdate) btnDownloadUpdate.classList.remove('hidden');
    } else {
      if (updateBadge) updateBadge.classList.add('hidden');
      updateStatusBanner.className = 'update-status-banner success';
      updateStatusText.textContent = '✨ คุณกำลังใช้งานเวอร์ชันล่าสุดแล้ว ไม่จำเป็นต้องอัปเดต';
      if (btnAutoUpdate) btnAutoUpdate.classList.add('hidden');
      if (btnDownloadUpdate) btnDownloadUpdate.classList.add('hidden');
    }
  } catch (err) {
    console.warn('Update check failed:', err);
    if (openModalOnResult) {
      updateStatusBanner.className = 'update-status-banner info';
      updateStatusText.textContent = `ไม่สามารถเช็คอัปเดตได้: ${err.message}`;
    }
  } finally {
    btnCheckUpdateAgain.disabled = false;
  }
}

// --- Accounts History & Switcher Functions ---
async function loadAccountsHistory() {
  try {
    const res = await fetch('/api/accounts');
    if (!res.ok) return;
    const data = await res.json();
    savedAccountsList = data.accounts || [];

    // Update count badge
    if (accountCountBadge) {
      if (savedAccountsList.length > 0) {
        accountCountBadge.textContent = savedAccountsList.length;
        accountCountBadge.classList.remove('hidden');
      } else {
        accountCountBadge.classList.add('hidden');
      }
    }
  } catch (e) {
    console.warn('Failed to load accounts history:', e);
  }
}

function openAccountModal() {
  if (!accountModal) return;
  renderAccountList();
  accountModal.classList.remove('hidden');
}

function renderAccountList() {
  if (!accountListContainer) return;
  accountListContainer.innerHTML = '';

  if (savedAccountsList.length === 0) {
    accountListContainer.innerHTML = `
      <div class="empty-state">
        <p>ยังไม่มีประวัติบัญชีที่บันทึกไว้</p>
        <span class="text-muted" style="font-size: 0.8rem;">กด "ดึง Token อัตโนมัติ" หรือใส่ Token บัญชีจะถูกบันทึกที่นี่โดยอัตโนมัติ</span>
      </div>
    `;
    return;
  }

  const currentToken = tokenInput.value.trim();

  savedAccountsList.forEach(acc => {
    const isActive = (acc.token === currentToken);
    const item = document.createElement('div');
    item.className = `account-item ${isActive ? 'active' : ''}`;

    const avatarUrl = acc.avatar 
      ? `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png?size=64`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    const lastUsedText = acc.lastUsed ? new Date(acc.lastUsed).toLocaleString('th-TH') : '';

    item.innerHTML = `
      <div class="account-item-left">
        <img src="${avatarUrl}" class="account-item-avatar" alt="Avatar">
        <div class="account-item-info">
          <div class="account-item-name">
            ${escapeHtml(acc.global_name || acc.username)}
            ${isActive ? '<span class="account-item-active-tag">ใช้งานอยู่</span>' : ''}
          </div>
          <span class="account-item-user">@${escapeHtml(acc.username)}</span>
          <span class="account-item-time">ใช้งานล่าสุด: ${lastUsedText}</span>
        </div>
      </div>
      <div class="account-item-actions">
        ${!isActive ? `<button class="btn btn-small btn-primary btn-switch-acc" data-id="${acc.id}">สลับใช้</button>` : ''}
        <button class="btn btn-small btn-danger-outline btn-delete-acc" data-id="${acc.id}" title="ลบออกจากประวัติ">ลบ</button>
      </div>
    `;

    // Switch handler
    const btnSwitch = item.querySelector('.btn-switch-acc');
    if (btnSwitch) {
      btnSwitch.addEventListener('click', async () => {
        await switchAccount(acc);
      });
    }

    // Delete handler
    const btnDelete = item.querySelector('.btn-delete-acc');
    if (btnDelete) {
      btnDelete.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`คุณต้องการลบบัญชี @${acc.username} ออกจากประวัติใช่หรือไม่?`)) {
          await deleteAccount(acc.id);
        }
      });
    }

    accountListContainer.appendChild(item);
  });
}

async function switchAccount(acc) {
  accountModal.classList.add('hidden');
  showLoader(`กำลังสลับไปยัง @${acc.username}...`, 'กำลังโหลดเควสต์และคำนวณ Discord Orbs...');
  try {
    const res = await fetch('/api/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: acc.id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'สลับบัญชีไม่สำเร็จ');

    tokenInput.value = acc.token;
    localStorage.setItem('discord_quest_token', acc.token);

    await fetchData(acc.token, true);
    await loadAccountsHistory();
  } catch (err) {
    alert(`สลับบัญชีไม่สำเร็จ: ${err.message}`);
  } finally {
    setTimeout(hideLoader, 500);
  }
}

async function deleteAccount(id) {
  try {
    const res = await fetch('/api/accounts/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      await loadAccountsHistory();
      renderAccountList();
    }
  } catch (err) {
    alert(`ลบบัญชีไม่สำเร็จ: ${err.message}`);
  }
}

// Fetch user profile and quests
async function fetchData(token, showToast = false) {
  if (isFetchingQuests) return;
  isFetchingQuests = true;

  try {
    // 1. Fetch User Profile
    const userRes = await fetch(`/api/user?token=${encodeURIComponent(token)}`);
    if (userRes.ok) {
      const userData = await userRes.json();
      const u = userData.user;
      userBadge.classList.remove('hidden');
      userName.textContent = u.global_name || u.username;
      const avatarUrl = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
      userAvatar.src = avatarUrl;
      // Refresh accounts list & badge
      loadAccountsHistory();
    }

    // 2. Fetch Quests & Calculations
    const questsRes = await fetch(`/api/quests?token=${encodeURIComponent(token)}`);
    const qData = await questsRes.json();
    if (!questsRes.ok) throw new Error(qData.error);

    const syncLabel = document.querySelector('.sync-badge span:last-child');
    if (qData.rateLimited) {
      if (syncLabel) syncLabel.textContent = `คูลดาวน์ ${qData.retryAfter || 5}s`;
      rateLimitCooldownUntil = Date.now() + ((qData.retryAfter || 5) * 1000) + 1500;
    } else {
      if (syncLabel) syncLabel.textContent = 'ซิงค์สดอัตโนมัติ';
    }

    currentQuests = qData.quests || [];
    const stats = qData.stats || {};

    // Animated Numbers (ReactBits style)
    animateNumber(statTotalQuests, stats.totalQuests || 0);
    animateNumber(statCompletedQuests, stats.completedQuests || 0);
    animateNumber(statPendingQuests, stats.pendingQuests || 0);
    statReadyToClaimSub.textContent = `(รอเคลมใน Discord: ${stats.readyToClaimQuests || 0})`;

    // Orbs Calculation Display with animation
    const orbs = stats.orbs || {};
    animateNumber(statTotalOrbs, orbs.total || 0);
    animateNumber(statClaimableOrbs, orbs.readyToClaim || 0);
    animateNumber(statPendingOrbs, orbs.pending || 0);

    // Update Tab Counts
    updateTabCounts();

    // Render Quests Grid
    renderQuests();

    if (showToast) {
      appendLog({ time: new Date().toLocaleTimeString('th-TH'), message: `🔄 อัปเดตข้อมูลเควสต์แล้ว (${currentQuests.length} เควสต์, ${orbs.total} Orbs)`, type: 'info' });
    }

  } catch (err) {
    if (showToast) {
      appendLog({ time: new Date().toLocaleTimeString('th-TH'), message: `⚠️ ดึงข้อมูลเควสต์ไม่สำเร็จ: ${err.message}`, type: 'warn' });
    }
  } finally {
    isFetchingQuests = false;
  }
}

// Smart Auto-Refresh Loop (Respects Rate Limit cooldowns)
let rateLimitCooldownUntil = 0;
function startQuestAutoRefresh() {
  questRefreshInterval = setInterval(() => {
    const token = tokenInput.value.trim();
    if (token && !isFetchingQuests && Date.now() >= rateLimitCooldownUntil) {
      fetchData(token, false);
    }
  }, 12000);
}

function updateTabCounts() {
  if (countTabActive) countTabActive.textContent = currentQuests.filter(q => !q.isExpired && !q.isCompleted).length;
  if (countTabEnrolled) countTabEnrolled.textContent = currentQuests.filter(q => !q.isExpired && q.isEnrolled && !q.isCompleted).length;
  if (countTabVideo) countTabVideo.textContent = currentQuests.filter(q => !q.isExpired && (q.taskType.includes('VIDEO') || q.taskType.includes('WATCH')) && !q.isCompleted).length;
  if (countTabDesktop) countTabDesktop.textContent = currentQuests.filter(q => !q.isExpired && (!q.taskType.includes('VIDEO') && !q.taskType.includes('WATCH')) && !q.isCompleted).length;
  if (countTabCompleted) countTabCompleted.textContent = currentQuests.filter(q => q.isCompleted).length;
  if (countTabExpired) countTabExpired.textContent = currentQuests.filter(q => q.isExpired).length;
}

// Render Quests Grid
function renderQuests() {
  questsContainer.innerHTML = '';

  let filtered = currentQuests;
  if (activeTab === 'active') {
    filtered = currentQuests.filter(q => !q.isExpired && !q.isCompleted);
  } else if (activeTab === 'enrolled') {
    filtered = currentQuests.filter(q => !q.isExpired && q.isEnrolled && !q.isCompleted);
  } else if (activeTab === 'video') {
    filtered = currentQuests.filter(q => !q.isExpired && (q.taskType.includes('VIDEO') || q.taskType.includes('WATCH')) && !q.isCompleted);
  } else if (activeTab === 'desktop') {
    filtered = currentQuests.filter(q => !q.isExpired && (!q.taskType.includes('VIDEO') && !q.taskType.includes('WATCH')) && !q.isCompleted);
  } else if (activeTab === 'completed') {
    filtered = currentQuests.filter(q => q.isCompleted);
  } else if (activeTab === 'expired') {
    filtered = currentQuests.filter(q => q.isExpired);
  }

  // Real-Time Search Filter
  const query = (questSearchInput?.value || '').trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(q => 
      (q.name && q.name.toLowerCase().includes(query)) ||
      (q.gameTitle && q.gameTitle.toLowerCase().includes(query)) ||
      (q.taskType && q.taskType.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    questsContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" stroke-width="1.5" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <p>ไม่พบเควสต์ในหมวดนี้</p>
      </div>
    `;
    return;
  }

  filtered.forEach(q => {
    const card = document.createElement('div');
    card.className = `quest-card spotlight-card ${q.isExpired ? 'quest-card-expired' : ''}`;

    // Type Badge
    let typeBadgeClass = 'badge-desktop';
    let typeLabel = q.taskType;
    if (q.taskType.includes('VIDEO') || q.taskType.includes('WATCH')) {
      typeBadgeClass = 'badge-video';
      typeLabel = '🎬 ดูคลิป (Auto)';
    } else if (q.taskType.includes('STREAM')) {
      typeBadgeClass = 'badge-stream';
      typeLabel = '📡 สตรีม';
    } else if (q.taskType.includes('PLAY')) {
      typeBadgeClass = 'badge-desktop';
      typeLabel = (chkSkipGameQuests && !chkSkipGameQuests.checked) ? '🎮 เล่นเกม (Fake Game)' : '🎮 เล่นเกม';
    }

    // Status Badge
    let statusBadge = '';
    if (q.isExpired) {
      statusBadge = '<span class="badge badge-status-expired">⏳ หมดอายุแล้ว</span>';
    } else if (q.statusText === 'CLAIMED') {
      statusBadge = '<span class="badge badge-status-completed">🎁 เคลมแล้ว</span>';
    } else if (q.statusText === 'READY_TO_CLAIM') {
      statusBadge = '<span class="badge badge-status-ready">✨ เสร็จแล้ว (พร้อมรับรางวัล)</span>';
    } else if (q.isEnrolled) {
      statusBadge = '<span class="badge badge-status-enrolled">✅ รับใน Discord แล้ว</span>';
    } else {
      statusBadge = '<span class="badge badge-status-not-enrolled" title="กรุณาเปิด Discord แล้วกดรับเควสต์นี้">⚠️ ยังไม่ได้รับใน Discord</span>';
    }

    // Progress Bar percentage
    const cur = q.currentSeconds || 0;
    const tgt = q.targetSeconds || 1;
    const pct = Math.min(100, Math.floor((cur / tgt) * 100));

    // Orb rewards tag
    let orbsHtml = '';
    if (q.orbs > 0) {
      orbsHtml = `<div class="reward-orb-tag">✨ +${q.orbs} Orbs</div>`;
    }

    card.innerHTML = `
      <div class="quest-card-header">
        <div>
          <div class="quest-title-text">${escapeHtml(q.name)}</div>
          <div class="quest-game-text">${escapeHtml(q.gameTitle)}</div>
        </div>
        <span class="badge ${typeBadgeClass}">${typeLabel}</span>
      </div>

      <div class="quest-rewards-row">
        ${orbsHtml}
        <span class="text-muted" style="font-size: 0.75rem;">เป้าหมาย: ${q.targetSeconds}s</span>
      </div>

      <div class="quest-progress-block">
        <div class="quest-progress-labels">
          <span>ความคืบหน้า</span>
          <span>${cur}s / ${tgt}s (${pct}%)</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${pct}%;">
            <span class="progress-bar-glow"></span>
          </div>
        </div>
      </div>

      <div class="quest-card-footer">
        ${statusBadge}
        ${q.statusText === 'READY_TO_CLAIM' ? '<button class="btn btn-small btn-success" onclick="window.open(\'https://discord.com/app\', \'_blank\')" style="padding: 2px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;">🎁 รับของรางวัลใน Discord</button>' : ''}
      </div>
    `;

    questsContainer.appendChild(card);
  });
}

// Runner Status Polling
function startStatusPolling() {
  statusPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const state = await res.json();
        updateRunnerUI(state);
      }
    } catch (e) {}
  }, 1000);
}

function playSuccessChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);
  } catch {}
}

function updateRunnerUI(state) {
  const previouslyRunning = isRunning;
  isRunning = state.isRunning;
  setRunnerActive(isRunning);

  // Check if automation just concluded
  if (previouslyRunning && !isRunning && state.progress.total > 0 && state.progress.done >= state.progress.total) {
    playSuccessChime();
    appendLog({
      time: new Date().toLocaleTimeString('th-TH'),
      message: '🎉 กระบวนการเควสต์อัตโนมัติทั้งหมดเสร็จสิ้นเรียบร้อยแล้ว!',
      type: 'success'
    });
  }

  if (isRunning && state.currentQuest) {
    runnerSubtext.textContent = `กำลังรันเควสต์: "${state.progress.currentName}" [${state.progress.currentType}]`;
    runnerProgressArea.classList.remove('hidden');
    activeQuestTitle.textContent = `${state.progress.currentName} (${state.progress.currentType})`;
    activeQuestProgressText.textContent = `${state.progress.currentSeconds}s / ${state.progress.targetSeconds}s (${state.progress.percent}%)`;
    activeProgressBar.style.width = `${state.progress.percent}%`;

    // Smart ETA Calculation
    if (activeQuestETA) {
      const remainingSec = Math.max(0, (state.progress.targetSeconds || 0) - (state.progress.currentSeconds || 0));
      if (remainingSec <= 0) {
        activeQuestETA.textContent = '✨ ใกล้เสร็จสิ้น...';
      } else if (remainingSec < 60) {
        activeQuestETA.textContent = `⏱️ เหลืออีก ~${remainingSec}s`;
      } else {
        const remainingMin = Math.ceil(remainingSec / 60);
        activeQuestETA.textContent = `⏱️ เหลืออีก ~${remainingMin} นาที (${remainingSec}s)`;
      }
    }
  } else {
    runnerProgressArea.classList.add('hidden');
    runnerSubtext.textContent = isRunning 
      ? 'ระบบกำลังเตรียมเควสต์ถัดไป...' 
      : 'ระบบพร้อมทำงาน กด "เริ่มทำเควสต์อัตโนมัติ" เพื่อเริ่มต้น';
  }
}

function setRunnerActive(active) {
  if (active) {
    runnerPulse.className = 'pulse-indicator running';
    btnStartAuto.classList.add('hidden');
    btnStopAuto.classList.remove('hidden');
  } else {
    runnerPulse.className = 'pulse-indicator idle';
    btnStartAuto.classList.remove('hidden');
    btnStopAuto.classList.add('hidden');
  }
}
