// Discord Quest Auto Client Application (ReactBits Edition)

// --- License Key Protection & Sync Engine ---
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
const btnCloseUpdateModal = document.getElementById('btnCloseUpdateModal');
const currentVersionTag = document.getElementById('currentVersionTag');
const latestVersionTag = document.getElementById('latestVersionTag');
const updateStatusBanner = document.getElementById('updateStatusBanner');
const updateStatusText = document.getElementById('updateStatusText');
const changelogList = document.getElementById('changelogList');
let latestReleaseUrl = '/api/download-latest';
let isUpdatingApp = false;

// Emergency Red Alert & Strobe Elements
const screenStrobeOverlay = document.getElementById('screenStrobeOverlay');
const emergencyTopSirenBanner = document.getElementById('emergencyTopSirenBanner');
const topBannerVersion = document.getElementById('topBannerVersion');
const topBannerCurrentVersion = document.getElementById('topBannerCurrentVersion');
const btnTopBannerUpdate = document.getElementById('btnTopBannerUpdate');
const btnTopBannerDetails = document.getElementById('btnTopBannerDetails');
const btnUrgentAutoUpdate = document.getElementById('btnUrgentAutoUpdate');
const updateModalCard = document.getElementById('updateModalCard');
const updateHazardBar = document.getElementById('updateHazardBar');
const policeStrobeBar = document.getElementById('policeStrobeBar');
const btnToggleSirenSound = document.getElementById('btnToggleSirenSound');
const sirenSoundIcon = document.getElementById('sirenSoundIcon');
const sirenSoundText = document.getElementById('sirenSoundText');

// --- Emergency Police Siren Synthesizer (Web Audio API) ---
let audioCtx = null;
let sirenOsc = null;
let sirenGain = null;
let sirenActive = false;
let sirenMuted = false;

function startEmergencySiren() {
  if (sirenMuted || sirenActive) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    sirenOsc = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();

    sirenOsc.type = 'sawtooth';
    sirenGain.gain.setValueAtTime(0.06, audioCtx.currentTime);

    // Siren modulation: alternate between 620Hz and 980Hz (police siren whoop)
    const now = audioCtx.currentTime;
    const cycles = 8;
    for (let i = 0; i < cycles; i++) {
      const t = now + i * 0.6;
      sirenOsc.frequency.setValueAtTime(620, t);
      sirenOsc.frequency.linearRampToValueAtTime(980, t + 0.3);
      sirenOsc.frequency.linearRampToValueAtTime(620, t + 0.6);
    }

    sirenOsc.connect(sirenGain);
    sirenGain.connect(audioCtx.destination);
    sirenOsc.start();
    sirenActive = true;

    // Auto ramp down gain at end
    const totalDuration = cycles * 0.6;
    sirenGain.gain.setValueAtTime(0.06, now + totalDuration - 0.4);
    sirenGain.gain.linearRampToValueAtTime(0.001, now + totalDuration);

    setTimeout(() => {
      stopEmergencySiren();
    }, totalDuration * 1000);
  } catch (e) {
    console.warn('Web Audio Siren notice:', e);
  }
}

function stopEmergencySiren() {
  if (sirenOsc) {
    try {
      sirenOsc.stop();
      sirenOsc.disconnect();
    } catch (_) {}
    sirenOsc = null;
  }
  sirenActive = false;
}

function toggleSirenMute() {
  sirenMuted = !sirenMuted;
  if (sirenMuted) {
    stopEmergencySiren();
    if (sirenSoundIcon) sirenSoundIcon.textContent = '🔇';
    if (sirenSoundText) sirenSoundText.textContent = 'เสียงไซเรน: ปิดอยู่ (คลิกเพื่อเปิด)';
  } else {
    if (sirenSoundIcon) sirenSoundIcon.textContent = '🔊';
    if (sirenSoundText) sirenSoundText.textContent = 'เสียงไซเรน: เปิดอยู่ (คลิกเพื่อปิด)';
    startEmergencySiren();
  }
}

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
const chkAutoFakeRoblox = document.getElementById('chkAutoFakeRoblox');
const fakeRobloxStatusBadge = document.getElementById('fakeRobloxStatusBadge');
const btnToggleFakeRoblox = document.getElementById('btnToggleFakeRoblox');
const fakeRobloxBtnIcon = document.getElementById('fakeRobloxBtnIcon');
const fakeRobloxBtnText = document.getElementById('fakeRobloxBtnText');
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

  // Check if program was just updated (แสดงรายละเอียด Release Notes เมื่อเปิดกลับขึ้นมา)
  checkJustUpdated();

  // Check for updates silently in the background
  checkForUpdates(false);

  // Sync Fake Roblox status
  syncFakeRobloxStatus();

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

  // 1.1 J3A STORE LICENSE & ACTIVATION MODAL ENGINE
  const headerLicenseBadge = document.getElementById('headerLicenseBadge');
  const headerBadgeText = document.getElementById('headerBadgeText');
  const lbStatusText = document.getElementById('lbStatusText');
  const lbPackageText = document.getElementById('lbPackageText');
  const lbRemainingText = document.getElementById('lbRemainingText');
  const lbStatusPill = document.getElementById('lbStatusPill');

  const licenseActivationModal = document.getElementById('licenseActivationModal');
  const modalHwidText = document.getElementById('modalHwidText');
  const btnModalCopyHwid = document.getElementById('btnModalCopyHwid');
  const modalCopyIcon = document.getElementById('modalCopyIcon');
  const modalLicenseInput = document.getElementById('modalLicenseInput');
  const btnModalActivate = document.getElementById('btnModalActivate');
  const modalLicenseError = document.getElementById('modalLicenseError');
  const modalLicenseSuccess = document.getElementById('modalLicenseSuccess');

  const licenseExpiredModal = document.getElementById('licenseExpiredModal');
  const btnSwitchExpiredKey = document.getElementById('btnSwitchExpiredKey');

  let activeLicenseInfo = null;

  async function syncLicenseStatus() {
    try {
      const res = await fetch('/api/license/status');
      if (res.ok) {
        const data = await res.json();
        activeLicenseInfo = data;

        if (modalHwidText && data.hwid) {
          modalHwidText.textContent = data.hwid;
        }

        // ระบบจำ Key: โหลดใส่ช่องกรอกใน Modal อัตโนมัติหากยังว่าง
        const rememberedKey = data.fullKey || data.rememberedKey || localStorage.getItem('remembered_license_key') || localStorage.getItem('license_key') || '';
        if (modalLicenseInput && rememberedKey && !modalLicenseInput.value) {
          modalLicenseInput.value = rememberedKey;
        }

        if (data.activated && !data.expired) {
          // ซิงค์สิทธิ์ลงใน LocalStorage
          localStorage.setItem('license_verified', 'true');
          const validKey = data.fullKey || data.key || rememberedKey;
          if (validKey) {
            localStorage.setItem('license_key', validKey);
            localStorage.setItem('remembered_license_key', validKey);
          }

          // สิทธิ์ถูกต้อง: ปิด Activation Modal และอัปเดต Header Badge
          if (licenseActivationModal && !licenseActivationModal.classList.contains('hidden')) {
            licenseActivationModal.classList.add('hidden');
          }
          if (licenseExpiredModal && !licenseExpiredModal.classList.contains('hidden')) {
            licenseExpiredModal.classList.add('hidden');
          }

          if (headerBadgeText) {
            headerBadgeText.textContent = data.badge || data.tierName || '🟢 License Active';
          }

          if (lbStatusText) lbStatusText.textContent = 'สถานะ: ใช้งานได้';
          if (lbPackageText) lbPackageText.textContent = `[${data.tierName || 'Standard'}]`;
          if (lbRemainingText) {
            const rem = typeof data.remainingDays === 'number' ? `${data.remainingDays} วัน` : '--';
            lbRemainingText.textContent = `[เหลืออีก ${rem}]`;
          }

          if (lbStatusPill) {
            const dot = lbStatusPill.querySelector('.status-dot');
            if (dot) dot.classList.remove('expired');
          }
        } else {
          // ยังไม่ได้ Activate หรือหมดอายุ: ห้ามเข้าหน้าหลัก
          localStorage.removeItem('license_verified');

          if (headerBadgeText) {
            headerBadgeText.textContent = '🔒 ยังไม่ได้เปิดใช้งาน';
          }
          if (lbStatusText) lbStatusText.textContent = 'สถานะ: ยังไม่เปิดใช้งาน';
          if (lbPackageText) lbPackageText.textContent = '[Unlicensed]';
          if (lbRemainingText) lbRemainingText.textContent = '[--]';

          if (lbStatusPill) {
            const dot = lbStatusPill.querySelector('.status-dot');
            if (dot) dot.classList.add('expired');
          }

          // แสดง Modal แจ้งเตือนสิทธิ์
          if (data.expired) {
            if (licenseExpiredModal && licenseExpiredModal.classList.contains('hidden')) {
              licenseExpiredModal.classList.remove('hidden');
            }
          } else {
            if (licenseActivationModal && licenseActivationModal.classList.contains('hidden')) {
              licenseActivationModal.classList.remove('hidden');
            }
          }
        }
      }
    } catch (_) {}
  }

  // Initial check & interval every 20 seconds
  syncLicenseStatus();
  setInterval(syncLicenseStatus, 20000);

  // Copy HWID from Modal
  if (btnModalCopyHwid) {
    btnModalCopyHwid.addEventListener('click', async () => {
      const hwidToCopy = modalHwidText?.textContent || '';
      try {
        await navigator.clipboard.writeText(hwidToCopy);
      } catch {
        const t = document.createElement('input');
        t.value = hwidToCopy;
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
      }

      btnModalCopyHwid.innerHTML = '<span>✓</span> คัดลอกแล้ว';
      setTimeout(() => {
        btnModalCopyHwid.innerHTML = '<span id="modalCopyIcon">📋</span> คัดลอก';
      }, 2000);
    });
  }

  // Format Modal License Input (J3ADQ-xxxx-xxxx-xxxx)
  if (modalLicenseInput) {
    modalLicenseInput.addEventListener('input', (e) => {
      if (modalLicenseError) modalLicenseError.classList.add('hidden');
      if (modalLicenseSuccess) modalLicenseSuccess.classList.add('hidden');
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 36);
    });

    modalLicenseInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (btnModalActivate) btnModalActivate.click();
      }
    });
  }

  // Activate Button in Modal
  if (btnModalActivate) {
    btnModalActivate.addEventListener('click', async () => {
      const rawKey = (modalLicenseInput?.value || '').trim().toUpperCase();

      if (modalLicenseError) modalLicenseError.classList.add('hidden');
      if (modalLicenseSuccess) modalLicenseSuccess.classList.add('hidden');

      if (!rawKey) {
        if (modalLicenseError) {
          modalLicenseError.textContent = 'กรุณาระบุ License Key ก่อนกดเปิดใช้งาน';
          modalLicenseError.classList.remove('hidden');
        }
        modalLicenseInput?.focus();
        return;
      }

      btnModalActivate.disabled = true;
      btnModalActivate.innerHTML = '<span class="sync-dot"></span> กำลังตรวจสอบกับเซิร์ฟเวอร์ J3A Store...';

      try {
        const res = await fetch('/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: rawKey })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          if (modalLicenseSuccess) {
            modalLicenseSuccess.textContent = `✅ เปิดใช้งานสำเร็จ! [${data.badge || data.tierName || 'License'}] กำลังเข้าสู่ระบบ...`;
            modalLicenseSuccess.classList.remove('hidden');
          }

          localStorage.setItem('license_verified', 'true');
          localStorage.setItem('license_key', rawKey);
          localStorage.setItem('remembered_license_key', rawKey);

          setTimeout(() => {
            if (licenseActivationModal) licenseActivationModal.classList.add('hidden');
            syncLicenseStatus();
          }, 900);
        } else {
          if (modalLicenseError) {
            modalLicenseError.textContent = data.error || 'License Key ไม่ถูกต้องหรือหมดอายุ';
            modalLicenseError.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (modalLicenseError) {
          modalLicenseError.textContent = `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${err.message}`;
          modalLicenseError.classList.remove('hidden');
        }
      } finally {
        btnModalActivate.disabled = false;
        btnModalActivate.innerHTML = '🚀 เปิดใช้งาน (Activate)';
      }
    });
  }

  if (btnSwitchExpiredKey) {
    btnSwitchExpiredKey.addEventListener('click', async () => {
      try {
        await fetch('/api/license/logout', { method: 'POST' });
      } catch (_) {}
      localStorage.removeItem('license_verified');
      localStorage.removeItem('license_key');
      if (licenseExpiredModal) licenseExpiredModal.classList.add('hidden');
      if (licenseActivationModal) licenseActivationModal.classList.remove('hidden');
    });
  }

  // 1.2 J3A STORE LICENSE INFO PANEL (Custom Modal)
  const licenseInfoModal = document.getElementById('licenseInfoModal');
  const btnCloseLicenseInfo = document.getElementById('btnCloseLicenseInfo');
  const btnDoneLicenseInfo = document.getElementById('btnDoneLicenseInfo');
  const infoLicenseStatus = document.getElementById('infoLicenseStatus');
  const infoLicenseTier = document.getElementById('infoLicenseTier');
  const infoLicenseRemaining = document.getElementById('infoLicenseRemaining');
  const infoLicenseExpires = document.getElementById('infoLicenseExpires');
  const infoLicenseKey = document.getElementById('infoLicenseKey');
  const btnCopyLicenseKey = document.getElementById('btnCopyLicenseKey');
  const copyKeyIcon = document.getElementById('copyKeyIcon');
  const btnToggleKeyMask = document.getElementById('btnToggleKeyMask');
  const keyMaskIcon = document.getElementById('keyMaskIcon');
  const keyMaskText = document.getElementById('keyMaskText');
  const infoLicenseHwid = document.getElementById('infoLicenseHwid');
  const btnCopyInfoHwid = document.getElementById('btnCopyInfoHwid');
  const copyHwidIcon = document.getElementById('copyHwidIcon');
  const btnSwitchLicenseKey = document.getElementById('btnSwitchLicenseKey');

  let isKeyMasked = true;

  function openLicenseInfoPanel() {
    if (!licenseInfoModal) return;

    const fullKey = activeLicenseInfo?.fullKey || localStorage.getItem('license_key') || '';
    const maskedKey = activeLicenseInfo?.key || (fullKey ? (fullKey.length > 10 ? fullKey.slice(0, 8) + '-****-' + fullKey.slice(-4) : fullKey) : 'ไม่มีข้อมูล');
    const tierStr = activeLicenseInfo?.tierName || 'Standard';
    const remDays = activeLicenseInfo?.remainingDays;
    const hwidStr = activeLicenseInfo?.hwid || modalHwidText?.textContent || 'N/A';
    const expiresAt = activeLicenseInfo?.expiresAt;

    // Status
    if (infoLicenseStatus) {
      if (activeLicenseInfo?.activated) {
        infoLicenseStatus.className = 'stat-card-val text-green';
        infoLicenseStatus.textContent = '🟢 ใช้งานได้ปกติ';
      } else {
        infoLicenseStatus.className = 'stat-card-val text-yellow';
        infoLicenseStatus.textContent = '🟡 ยังไม่เปิดใช้งาน';
      }
    }

    // Tier
    if (infoLicenseTier) {
      infoLicenseTier.textContent = tierStr;
    }

    // Remaining
    if (infoLicenseRemaining) {
      if (typeof remDays === 'number') {
        infoLicenseRemaining.textContent = `${remDays} วัน`;
      } else {
        infoLicenseRemaining.textContent = '--';
      }
    }

    // Expiration date
    if (infoLicenseExpires) {
      if (expiresAt) {
        try {
          const d = new Date(expiresAt);
          infoLicenseExpires.textContent = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (_) {
          infoLicenseExpires.textContent = String(expiresAt).slice(0, 10);
        }
      } else {
        infoLicenseExpires.textContent = '--';
      }
    }

    // Key display
    isKeyMasked = true;
    if (keyMaskIcon) keyMaskIcon.textContent = '👁️';
    if (keyMaskText) keyMaskText.textContent = 'แสดงคีย์';
    if (infoLicenseKey) {
      infoLicenseKey.textContent = maskedKey;
    }

    // HWID
    if (infoLicenseHwid) {
      infoLicenseHwid.textContent = hwidStr;
    }

    licenseInfoModal.classList.remove('hidden');
  }

  function closeLicenseInfoPanel() {
    if (licenseInfoModal) licenseInfoModal.classList.add('hidden');
  }

  if (headerLicenseBadge) {
    headerLicenseBadge.addEventListener('click', openLicenseInfoPanel);
  }
  if (btnCloseLicenseInfo) {
    btnCloseLicenseInfo.addEventListener('click', closeLicenseInfoPanel);
  }
  if (btnDoneLicenseInfo) {
    btnDoneLicenseInfo.addEventListener('click', closeLicenseInfoPanel);
  }

  // Toggle Mask/Unmask Key
  if (btnToggleKeyMask) {
    btnToggleKeyMask.addEventListener('click', () => {
      isKeyMasked = !isKeyMasked;
      const fullKey = activeLicenseInfo?.fullKey || localStorage.getItem('license_key') || 'ไม่มีข้อมูล';
      const maskedKey = activeLicenseInfo?.key || (fullKey.length > 10 ? fullKey.slice(0, 8) + '-****-' + fullKey.slice(-4) : fullKey);

      if (isKeyMasked) {
        if (infoLicenseKey) infoLicenseKey.textContent = maskedKey;
        if (keyMaskIcon) keyMaskIcon.textContent = '👁️';
        if (keyMaskText) keyMaskText.textContent = 'แสดงคีย์';
      } else {
        if (infoLicenseKey) infoLicenseKey.textContent = fullKey;
        if (keyMaskIcon) keyMaskIcon.textContent = '🔒';
        if (keyMaskText) keyMaskText.textContent = 'ซ่อนคีย์';
      }
    });
  }

  // Copy Key
  if (btnCopyLicenseKey) {
    btnCopyLicenseKey.addEventListener('click', async () => {
      const keyToCopy = activeLicenseInfo?.fullKey || localStorage.getItem('license_key') || '';
      if (!keyToCopy) return;
      try {
        await navigator.clipboard.writeText(keyToCopy);
        if (copyKeyIcon) copyKeyIcon.textContent = '✅';
        btnCopyLicenseKey.style.borderColor = '#00ffcc';
        setTimeout(() => {
          if (copyKeyIcon) copyKeyIcon.textContent = '📋';
          btnCopyLicenseKey.style.borderColor = '';
        }, 1500);
      } catch (_) {}
    });
  }

  // Copy HWID
  if (btnCopyInfoHwid) {
    btnCopyInfoHwid.addEventListener('click', async () => {
      const hwidToCopy = infoLicenseHwid?.textContent || activeLicenseInfo?.hwid || '';
      if (!hwidToCopy) return;
      try {
        await navigator.clipboard.writeText(hwidToCopy);
        if (copyHwidIcon) copyHwidIcon.textContent = '✅';
        btnCopyInfoHwid.style.borderColor = '#00ffcc';
        setTimeout(() => {
          if (copyHwidIcon) copyHwidIcon.textContent = '📋';
          btnCopyInfoHwid.style.borderColor = '';
        }, 1500);
      } catch (_) {}
    });
  }

  // Switch Key Button inside Panel
  if (btnSwitchLicenseKey) {
    btnSwitchLicenseKey.addEventListener('click', async () => {
      if (confirm('ยืนยันออกจากระบบเพื่อสลับเปลี่ยน License Key?')) {
        closeLicenseInfoPanel();
        try {
          await fetch('/api/license/logout', { method: 'POST' });
        } catch (_) {}
        localStorage.removeItem('license_verified');
        localStorage.removeItem('license_key');
        if (licenseActivationModal) licenseActivationModal.classList.remove('hidden');
        syncLicenseStatus();
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

  // 8. UPDATE CHECKER & IN-PLACE SELF-UPDATE ENGINE (เหมือน DiscordProfile)
  if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => checkForUpdates(true));
  }
  if (btnCheckUpdateAgain) {
    btnCheckUpdateAgain.addEventListener('click', () => checkForUpdates(true));
  }

  async function executeAutoUpdate() {
    if (isUpdatingApp) return;
    if (!confirm('ยืนยันเริ่มการอัปเดตระบบอัตโนมัติ?\n\nโปรแกรมจะทำการอัปเดตข้อมูลในตัว (In-Place Update) และรีสตาร์ทกลับมาเปิดให้อัตโนมัติในไม่กี่วินาที ไม่จำเป็นต้องดาวน์โหลดไฟล์ใหม่เอง')) {
      return;
    }

    isUpdatingApp = true;
    if (btnAutoUpdate) {
      btnAutoUpdate.disabled = true;
      btnAutoUpdate.innerHTML = '<span class="sync-dot"></span> กำลังอัปเดตและรีสตาร์ท...';
    }
    if (btnTopBannerUpdate) {
      btnTopBannerUpdate.disabled = true;
      btnTopBannerUpdate.innerHTML = '<span class="sync-dot"></span> กำลังอัปเดตและรีสตาร์ท...';
    }
    if (btnUrgentAutoUpdate) {
      btnUrgentAutoUpdate.disabled = true;
      btnUrgentAutoUpdate.innerHTML = '<span class="sync-dot"></span> กำลังอัปเดต...';
    }

    if (updateStatusBanner) updateStatusBanner.className = 'update-status-banner info';
    if (updateStatusText) updateStatusText.innerHTML = '<span class="sync-dot"></span> กำลังดาวน์โหลดแพ็กเกจเวอร์ชันล่าสุด... กรุณารอสักครู่';

    try {
      const res = await fetch('/api/auto-update', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || (!data.success && !data.ok)) {
        throw new Error(data.error || 'ดาวน์โหลดไม่สำเร็จ');
      }

      if (updateStatusBanner) updateStatusBanner.className = 'update-status-banner success';
      if (updateStatusText) updateStatusText.innerHTML = '🚀 กำลังเปิดหน้าต่าง Process Update และรีสตาร์ทโปรแกรมอัตโนมัติ...';

      // Hide modal & siren after short delay as updater takes over
      setTimeout(() => {
        if (updateModal) updateModal.classList.add('hidden');
        if (screenStrobeOverlay) screenStrobeOverlay.classList.add('hidden');
        stopEmergencySiren();
        showLoader('ระบบกำลังอัปเดต...', 'หน้าต่าง Process Update กำลังทำงาน โปรแกรมจะรีสตาร์ทกลับขึ้นมาให้อัตโนมัติ');
      }, 800);

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
          if (retries > 60) {
            clearInterval(poll);
            location.reload();
          }
        }
      }, 1500);
    } catch (err) {
      if (updateStatusBanner) updateStatusBanner.className = 'update-status-banner error';
      if (updateStatusText) updateStatusText.textContent = `❌ อัปเดตไม่สำเร็จ: ${err.message}`;
      if (btnAutoUpdate) {
        btnAutoUpdate.disabled = false;
        btnAutoUpdate.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ⚡ อัปเดตอัตโนมัติทันที';
      }
      if (btnTopBannerUpdate) {
        btnTopBannerUpdate.disabled = false;
        btnTopBannerUpdate.innerHTML = '⚡ อัปเดตทันที';
      }
      if (btnUrgentAutoUpdate) {
        btnUrgentAutoUpdate.disabled = false;
        btnUrgentAutoUpdate.innerHTML = '⚡ อัปเดตอัตโนมัติทันที';
      }
      isUpdatingApp = false;
    }
  }

  if (btnAutoUpdate) {
    btnAutoUpdate.addEventListener('click', executeAutoUpdate);
  }
  if (btnTopBannerUpdate) {
    btnTopBannerUpdate.addEventListener('click', executeAutoUpdate);
  }
  if (btnTopBannerDetails) {
    btnTopBannerDetails.addEventListener('click', () => {
      checkForUpdates(true);
    });
  }
  if (btnUrgentAutoUpdate) {
    btnUrgentAutoUpdate.addEventListener('click', executeAutoUpdate);
  }
  if (btnToggleSirenSound) {
    btnToggleSirenSound.addEventListener('click', toggleSirenMute);
  }
  if (btnCloseUpdateModal) {
    btnCloseUpdateModal.addEventListener('click', () => {
      updateModal.classList.add('hidden');
      if (screenStrobeOverlay) screenStrobeOverlay.classList.add('hidden');
      stopEmergencySiren();
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
  // 12. FAKE PLAY ROBLOX TOGGLE
  if (btnToggleFakeRoblox) {
    btnToggleFakeRoblox.addEventListener('click', async () => {
      btnToggleFakeRoblox.disabled = true;
      try {
        const isRunning = btnToggleFakeRoblox.classList.contains('running');
        const endpoint = isRunning ? '/api/fake-roblox/stop' : '/api/fake-roblox/start';
        const res = await fetch(endpoint, { method: 'POST' });
        const data = await res.json();
        await syncFakeRobloxStatus();
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการสลับ Fake Roblox: ' + err.message);
      } finally {
        btnToggleFakeRoblox.disabled = false;
      }
    });
  }
}

// Sync Fake Roblox Process Status
async function syncFakeRobloxStatus() {
  try {
    const res = await fetch('/api/fake-roblox/status');
    if (!res.ok) return;
    const data = await res.json();
    const banner = document.querySelector('.fake-roblox-banner');

    if (data.running) {
      if (fakeRobloxStatusBadge) {
        fakeRobloxStatusBadge.className = 'badge-roblox-status active';
        fakeRobloxStatusBadge.textContent = '🟢 กำลังจำลอง Roblox (Playing Roblox)';
      }
      if (fakeRobloxBtnIcon) fakeRobloxBtnIcon.textContent = '⏹️';
      if (fakeRobloxBtnText) fakeRobloxBtnText.textContent = 'ปิด Fake Roblox';
      if (btnToggleFakeRoblox) btnToggleFakeRoblox.className = 'btn btn-roblox-action running';
      if (banner) banner.classList.add('running');
    } else {
      if (fakeRobloxStatusBadge) {
        fakeRobloxStatusBadge.className = 'badge-roblox-status idle';
        fakeRobloxStatusBadge.textContent = '⚫ ปิดอยู่';
      }
      if (fakeRobloxBtnIcon) fakeRobloxBtnIcon.textContent = '▶️';
      if (fakeRobloxBtnText) fakeRobloxBtnText.textContent = 'เปิด Fake Roblox';
      if (btnToggleFakeRoblox) btnToggleFakeRoblox.className = 'btn btn-roblox-action';
      if (banner) banner.classList.remove('running');
    }
  } catch (_) {}
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
    if (topBannerVersion) topBannerVersion.textContent = `v${data.latestVersion}`;
    if (topBannerCurrentVersion) topBannerCurrentVersion.textContent = `v${data.currentVersion}`;
    if (btnTopBannerUpdate) btnTopBannerUpdate.innerHTML = `⚡ อัปเดตเป็น v${data.latestVersion} ทันที`;
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

    const urgentUpdateBanner = document.getElementById('urgentUpdateBanner');
    const urgentCountdownTimer = document.getElementById('urgentCountdownTimer');

    if (data.hasUpdate) {
      // 1. Show badge on header button & activate top dashboard banner
      if (updateBadge) updateBadge.classList.remove('hidden');
      if (emergencyTopSirenBanner) emergencyTopSirenBanner.classList.remove('hidden');

      // 2. Trigger Red Alert Strobe & Police Lights on Modal Card
      if (updateModalCard) updateModalCard.classList.add('emergency-alert-mode');
      if (updateHazardBar) updateHazardBar.classList.remove('hidden');
      if (policeStrobeBar) policeStrobeBar.classList.remove('hidden');

      // 3. Update Status text with flashing warning
      updateStatusBanner.className = 'update-status-banner has-update';
      updateStatusText.innerHTML = `🚨 <b>[ฉุกเฉินไฟกระพริบแดง]</b> ตรวจพบเวอร์ชันใหม่ <b>v${data.latestVersion}</b> บังคับอัปเดตด่วน! (อัปเดตในตัว ไม่ต้องโหลดไฟล์ใหม่)`;
      if (btnAutoUpdate) btnAutoUpdate.classList.remove('hidden');

      // 4. Trigger 67-Hour Joke Countdown Banner
      if (urgentUpdateBanner) {
        urgentUpdateBanner.classList.remove('hidden');
        startUrgentCountdown(urgentCountdownTimer);
      }

      // 5. Activate full-screen emergency red strobe vignette
      if (screenStrobeOverlay) screenStrobeOverlay.classList.remove('hidden');

      // 6. Auto-popup alert for older versions (e.g. 2.4.1 or older than latest)
      if (!sessionStorage.getItem('update_modal_shown')) {
        sessionStorage.setItem('update_modal_shown', 'true');
        if (updateModal) updateModal.classList.remove('hidden');
        startEmergencySiren();
      } else if (openModalOnResult) {
        startEmergencySiren();
      }
    } else {
      if (updateBadge) updateBadge.classList.add('hidden');
      if (emergencyTopSirenBanner) emergencyTopSirenBanner.classList.add('hidden');
      if (urgentUpdateBanner) urgentUpdateBanner.classList.add('hidden');
      if (screenStrobeOverlay) screenStrobeOverlay.classList.add('hidden');
      if (updateModalCard) updateModalCard.classList.remove('emergency-alert-mode');
      if (updateHazardBar) updateHazardBar.classList.add('hidden');
      if (policeStrobeBar) policeStrobeBar.classList.add('hidden');
      stopEmergencySiren();

      updateStatusBanner.className = 'update-status-banner success';
      updateStatusText.textContent = '✨ คุณกำลังใช้งานเวอร์ชันล่าสุดแล้ว ไม่จำเป็นต้องอัปเดต';
      if (btnAutoUpdate) btnAutoUpdate.classList.add('hidden');
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

let countdownInterval = null;
function startUrgentCountdown(timerEl) {
  if (!timerEl) return;
  if (countdownInterval) clearInterval(countdownInterval);

  let deadline = Number(localStorage.getItem('urgent_update_deadline'));
  if (!deadline || isNaN(deadline)) {
    // 67 hours from now
    deadline = Date.now() + (67 * 60 * 60 * 1000);
    localStorage.setItem('urgent_update_deadline', String(deadline));
  }

  function tick() {
    const remainingMs = Math.max(0, deadline - Date.now());
    const totalSec = Math.floor(remainingMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const pad = n => String(n).padStart(2, '0');
    timerEl.textContent = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// --- Check if App was Just Updated (แสดงรายละเอียดเมื่อเปิดกลับขึ้นมาหลังอัปเดต) ---
async function checkJustUpdated() {
  const updateSuccessModal = document.getElementById('updateSuccessModal');
  const btnCloseUpdateSuccess = document.getElementById('btnCloseUpdateSuccess');
  const successVersionTag = document.getElementById('successVersionTag');
  const successChangelogList = document.getElementById('successChangelogList');

  if (btnCloseUpdateSuccess) {
    btnCloseUpdateSuccess.addEventListener('click', () => {
      if (updateSuccessModal) updateSuccessModal.classList.add('hidden');
    });
  }

  try {
    const res = await fetch('/api/just-updated');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.justUpdated) {
      if (successVersionTag) {
        successVersionTag.textContent = `v${data.version || '2.6.0'}`;
      }
      if (successChangelogList && Array.isArray(data.releaseNotes) && data.releaseNotes.length > 0) {
        successChangelogList.innerHTML = '';
        data.releaseNotes.forEach(note => {
          const li = document.createElement('li');
          li.textContent = note;
          successChangelogList.appendChild(li);
        });
      }
      if (updateSuccessModal) {
        updateSuccessModal.classList.remove('hidden');
      }
    }
  } catch (e) {
    console.warn('Check just-updated error:', e);
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
    const isRoblox = (q.name || '').toLowerCase().includes('roblox') 
                  || (q.gameTitle || '').toLowerCase().includes('roblox')
                  || ((q.name || '').toLowerCase().includes('shawarma'));

    if (isRoblox) {
      typeBadgeClass = 'badge-desktop';
      typeLabel = '🎮 Roblox (Fake Auto)';
    } else if (q.taskType.includes('VIDEO') || q.taskType.includes('WATCH')) {
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
let robloxPollCounter = 0;
function startStatusPolling() {
  statusPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const state = await res.json();
        updateRunnerUI(state);
      }
      robloxPollCounter++;
      if (robloxPollCounter % 4 === 0) {
        syncFakeRobloxStatus();
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
