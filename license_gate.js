/**
 * J3A Discord AutoQuest - License Key Verification & HWID Lock Engine
 * ระบบรักษาความปลอดภัยสิทธิ์การใช้งาน พร้อมระบบล็อกเครื่อง 1:1, เข้ารหัส AES-256-GCM,
 * ป้องกันการโกงเวลา (Anti-Clock Rollback) และระบบดักจับการวนใช้สิทธิ์ 3 วัน (Anti-Abuse Trial)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// -------------------------------------------------------------
// Constants & Configuration
// -------------------------------------------------------------
const BASE_DIR = path.resolve(__dirname);
const LICENSE_ENC_FILE = path.join(BASE_DIR, 'license.dat');
const LEGACY_KEY_FILE = path.join(BASE_DIR, 'license.key');
const STORE_URL = 'https://j3a-store.vercel.app';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwq22hsYcYWJYuOaUkDy1Ysmut80NwQ5kdmQ-0ItJ8JhGjV2w2PRxEua9mi_3yGagh1/exec';
const PRODUCT_ID = 'discord_autoquest';

const STORAGE_SALT = 'J3A_DISCORD_AUTOQUEST_SECURITY_SALT_2026';
const STORAGE_PEPPER = 'J3A_HWID_PEPPER_V2_CRYPTO';

// -------------------------------------------------------------
// 1. โครงสร้างประเภทของคีย์และอายุการใช้งาน
// -------------------------------------------------------------
const KEY_PACKAGES = {
  'DAQ-3D-': {
    code: '3D',
    name: '3 Days Trial',
    badge: '3 Days',
    durationMs: 72 * 60 * 60 * 1000, // 72 ชั่วโมง (3 วัน)
    isTrial: true,
    desc: 'คีย์ 3 วัน (สำหรับทดลอง / ซื้อครั้งแรก)'
  },
  'DAQ-1W-': {
    code: '1W',
    name: '1 Week',
    badge: '1 Week',
    durationMs: 7 * 24 * 60 * 60 * 1000, // 7 วัน
    isTrial: false,
    desc: 'คีย์ 1 สัปดาห์'
  },
  'DAQ-4W-': {
    code: '4W',
    name: '4 Weeks',
    badge: '4 Weeks',
    durationMs: 28 * 24 * 60 * 60 * 1000, // 28 วัน
    isTrial: false,
    desc: 'คีย์ 4 สัปดาห์'
  },
  'DAQ-6M-': {
    code: '6M',
    name: '6 Months',
    badge: '6 Months',
    durationMs: 180 * 24 * 60 * 60 * 1000, // 180 วัน
    isTrial: false,
    desc: 'คีย์ 6 เดือน'
  },
  // Legacy / Developer support
  'J3ADQ-': {
    code: 'LEGACY',
    name: 'Standard (J3A)',
    badge: 'Standard',
    durationMs: 30 * 24 * 60 * 60 * 1000,
    isTrial: false,
    desc: 'คีย์มาตรฐาน J3A'
  }
};

let isLicenseActive = false;
let currentLicenseDetails = null;
let watcherInterval = null;
let cachedHWID = null;

/**
 * ระบุประเภทแพ็กเกจจาก Prefix ของคีย์
 */
function detectPackage(key) {
  if (!key || typeof key !== 'string') return null;
  const upper = key.trim().toUpperCase();
  for (const prefix of Object.keys(KEY_PACKAGES)) {
    if (upper.startsWith(prefix)) {
      return { prefix, ...KEY_PACKAGES[prefix] };
    }
  }
  return null;
}

// -------------------------------------------------------------
// 2. ระบบ Hardware ID (HWID Lock - CPU + Motherboard + MAC -> SHA-256)
// -------------------------------------------------------------
function getPrimaryMAC() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name in ifaces) {
      for (const net of ifaces[name]) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          return net.mac.replace(/[:-]/g, '').toUpperCase();
        }
      }
    }
  } catch (_) {}
  return 'MAC_UNKNOWN';
}

function getSystemHWID() {
  if (cachedHWID) return cachedHWID;

  let cpuId = 'GENERIC_CPU';
  let mbUuid = 'GENERIC_MBUUID';

  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `
      $cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId
      $uuid = (Get-CimInstance Win32_ComputerSystemProduct).UUID
      Write-Output "$cpu|$uuid"
      `
    ], { encoding: 'utf8', timeout: 5000 }).trim();

    const parts = out.split('|');
    if (parts[0] && parts[0].trim()) cpuId = parts[0].trim();
    if (parts[1] && parts[1].trim() && !parts[1].toLowerCase().includes('default string')) {
      mbUuid = parts[1].trim();
    }
  } catch (_) {
    // Fallback: Windows MachineGuid
    try {
      const guid = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        '(Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Cryptography").MachineGuid'
      ], { encoding: 'utf8', timeout: 2500 }).trim();
      if (guid && guid.length >= 8) mbUuid = guid.toUpperCase();
    } catch (_) {}
  }

  const mac = getPrimaryMAC();
  const rawString = `CPU:${cpuId}|MB:${mbUuid}|MAC:${mac}`;
  cachedHWID = crypto.createHash('sha256').update(rawString).digest('hex').toUpperCase();
  return cachedHWID;
}

// -------------------------------------------------------------
// 3. Encrypted Local Storage (AES-256-GCM Hardware-Locked Storage)
// -------------------------------------------------------------
function deriveHardwareKey(hwid) {
  return crypto.scryptSync(hwid + STORAGE_SALT, STORAGE_PEPPER, 32);
}

function encryptLicenseData(dataObj, hwid) {
  const key = deriveHardwareKey(hwid);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = JSON.stringify(dataObj);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptLicenseData(cipherPayload, hwid) {
  try {
    if (!cipherPayload || typeof cipherPayload !== 'string') return null;
    const parts = cipherPayload.trim().split(':');
    if (parts.length !== 3) return null;

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encryptedHex = parts[2];

    const key = deriveHardwareKey(hwid);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (err) {
    // หากข้อมูลถูกแก้ไขแม้แต่ไบต์เดียว หรือเปิดบนเครื่องอื่น (HWID ต่าง) GCM Authentication จะล้มเหลว
    return null;
  }
}

// -------------------------------------------------------------
// 4. ระบบป้องกันการวนใช้สิทธิ์ 3 วันซ้ำ (Anti-Abuse Trial System)
// -------------------------------------------------------------
function getMachineVaultPath() {
  const localApp = process.env.LOCALAPPDATA || os.tmpdir();
  const vaultDir = path.join(localApp, 'J3A_Security');
  if (!fs.existsSync(vaultDir)) {
    try { fs.mkdirSync(vaultDir, { recursive: true }); } catch (_) {}
  }
  return path.join(vaultDir, 'vault_dq.dat');
}

function hasUsedTrial(hwid) {
  const vaultPath = getMachineVaultPath();
  if (!fs.existsSync(vaultPath)) return false;
  try {
    const raw = fs.readFileSync(vaultPath, 'utf8');
    const data = decryptLicenseData(raw, hwid);
    return !!(data && data.trialUsed);
  } catch (_) {
    return false;
  }
}

function markTrialUsed(hwid, trialKey) {
  const vaultPath = getMachineVaultPath();
  try {
    const data = {
      hwid,
      trialUsed: true,
      trialKey,
      recordedAt: Date.now()
    };
    const encrypted = encryptLicenseData(data, hwid);
    fs.writeFileSync(vaultPath, encrypted, 'utf8');
  } catch (_) {}
}

// -------------------------------------------------------------
// 5. Utility Helpers & Time Formatter
// -------------------------------------------------------------
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

function formatRemainingTime(ms) {
  if (ms <= 0) return 'หมดอายุแล้ว';

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  if (days > 0) {
    return `${days} วัน ${hours} ชม.`;
  }
  if (hours > 0) {
    return `${hours} ชม. ${minutes} นาที`;
  }
  return `${minutes} นาที`;
}

// -------------------------------------------------------------
// 6. Google Apps Script Communication
// -------------------------------------------------------------
async function callLicenseApi(action, key, hwid, extraParams = {}, timeoutMs = 8000) {
  const params = new URLSearchParams({
    action: action,
    key: key.trim().toUpperCase(),
    hwid: hwid.trim(),
    product: PRODUCT_ID,
    ...extraParams
  });

  const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------
// 7. License Verification & Expiration Checker
// -------------------------------------------------------------
function isLicensed() {
  return isLicenseActive;
}

function getActiveKey() {
  return currentLicenseDetails ? currentLicenseDetails.key : '';
}

function getLicenseDetails() {
  if (!currentLicenseDetails) {
    return {
      active: false,
      key: '',
      maskedKey: '',
      package: 'ไม่มีข้อมูล',
      badge: 'Unlicensed',
      remainingMs: 0,
      remainingText: 'ยังไม่ได้เปิดใช้งาน',
      hwid: getSystemHWID(),
      isTrial: false,
      expired: false
    };
  }

  const now = Date.now();
  const remainingMs = Math.max(0, currentLicenseDetails.expiresAt - now);
  const isExpired = remainingMs <= 0;

  return {
    active: isLicenseActive && !isExpired,
    key: currentLicenseDetails.key,
    maskedKey: maskKey(currentLicenseDetails.key),
    package: currentLicenseDetails.packageName || 'Standard',
    badge: currentLicenseDetails.badge || 'Standard',
    activatedAt: currentLicenseDetails.activatedAt,
    expiresAt: currentLicenseDetails.expiresAt,
    remainingMs,
    remainingText: formatRemainingTime(remainingMs),
    hwid: currentLicenseDetails.hwid,
    isTrial: !!currentLicenseDetails.isTrial,
    expired: isExpired,
    storeUrl: STORE_URL
  };
}

/**
 * 4. การตรวจสอบอายุคีย์ (Expiration Checker) & HWID Lock
 * ตรวจสอบความถูกต้องและวันหมดอายุ
 */
async function checkStoredLicense() {
  const hwid = getSystemHWID();

  // ตรวจสอบทั้งไฟล์เข้ารหัสใหม่ (.dat) และไฟล์เดิม (.key) เพื่อไมเกรตอัตโนมัติ
  let licenseData = null;

  if (fs.existsSync(LICENSE_ENC_FILE)) {
    try {
      const rawEnc = fs.readFileSync(LICENSE_ENC_FILE, 'utf8');
      licenseData = decryptLicenseData(rawEnc, hwid);
      if (!licenseData) {
        // อาจถูกย้ายมาจากเครื่องอื่น หรือไฟล์ถูกแก้ไขไบต์
        isLicenseActive = false;
        currentLicenseDetails = null;
        return {
          success: false,
          reason: 'TAMPER_OR_FOREIGN_HWID',
          message: 'คีย์นี้ถูกผูกไว้กับเครื่องอื่นแล้ว (HWID Mismatch)',
          hwid
        };
      }
    } catch (e) {
      licenseData = null;
    }
  } else if (fs.existsSync(LEGACY_KEY_FILE)) {
    // ไมเกรตจาก license.key แบบเดิม
    try {
      const legacyKey = fs.readFileSync(LEGACY_KEY_FILE, 'utf8').trim().toUpperCase();
      const pkg = detectPackage(legacyKey);
      if (pkg) {
        const now = Date.now();
        licenseData = {
          key: legacyKey,
          prefix: pkg.prefix,
          packageName: pkg.name,
          badge: pkg.badge,
          hwid: hwid,
          activatedAt: now,
          expiresAt: now + pkg.durationMs,
          lastSeenTime: now,
          isTrial: pkg.isTrial
        };
        // บันทึกเป็นไฟล์เข้ารหัสอันใหม่
        const enc = encryptLicenseData(licenseData, hwid);
        fs.writeFileSync(LICENSE_ENC_FILE, enc, 'utf8');
        try { fs.unlinkSync(LEGACY_KEY_FILE); } catch (_) {}
      }
    } catch (_) {}
  }

  if (!licenseData) {
    isLicenseActive = false;
    currentLicenseDetails = null;
    return { success: false, reason: 'NO_LICENSE', hwid };
  }

  // 1. ตรวจสอบ HWID Lock
  if (licenseData.hwid !== hwid) {
    isLicenseActive = false;
    currentLicenseDetails = null;
    return {
      success: false,
      reason: 'HWID_MISMATCH',
      message: 'คีย์นี้ถูกผูกไว้กับเครื่องอื่นแล้ว (HWID Mismatch)',
      hwid
    };
  }

  const now = Date.now();

  // 2. ป้องกันการโกงเวลา (Anti-Clock Rollback): ถ้าเวลาเครื่องย้อนหลังเกิน 5 นาที
  if (licenseData.lastSeenTime && now < (licenseData.lastSeenTime - 300000)) {
    isLicenseActive = false;
    return {
      success: false,
      reason: 'CLOCK_ROLLBACK',
      message: 'ตรวจพบการย้อนเวลาของระบบ (Clock Rollback Detected) กรุณาตั้งเวลาเครื่องให้ตรงกับเวลาปัจจุบัน',
      hwid
    };
  }

  // 3. ตรวจสอบวันหมดอายุ (Expiration Check)
  if (now > licenseData.expiresAt) {
    isLicenseActive = false;
    currentLicenseDetails = licenseData;
    return {
      success: false,
      expired: true,
      reason: 'EXPIRED',
      message: `คีย์ของคุณหมดอายุแล้ว สามารถต่ออายุได้ที่ ${STORE_URL}`,
      expiresAt: licenseData.expiresAt,
      hwid
    };
  }

  // อัปเดตเวลาล่าสุดที่ทำงานและบันทึกกลับ
  licenseData.lastSeenTime = now;
  try {
    const updatedEnc = encryptLicenseData(licenseData, hwid);
    fs.writeFileSync(LICENSE_ENC_FILE, updatedEnc, 'utf8');
  } catch (_) {}

  isLicenseActive = true;
  currentLicenseDetails = licenseData;

  // ตรวจสอบยืนยันสิทธิ์กับ Google Apps Script ในเบื้องหลัง (Non-blocking)
  try {
    callLicenseApi('check', licenseData.key, hwid, {}, 5000)
      .then(serverRes => {
        if (serverRes && serverRes.success === false) {
          // หากเซิร์ฟเวอร์แจ้งว่าคีย์ถูกระงับ หรือ HWID ไม่ตรง
          if (serverRes.message && serverRes.message.includes('ผูกไว้กับเครื่องอื่น')) {
            isLicenseActive = false;
            currentLicenseDetails = null;
            try { fs.unlinkSync(LICENSE_ENC_FILE); } catch (_) {}
          }
        }
      })
      .catch(() => {});
  } catch (_) {}

  return {
    success: true,
    key: licenseData.key,
    package: licenseData.packageName,
    badge: licenseData.badge,
    expiresAt: licenseData.expiresAt,
    remainingText: formatRemainingTime(licenseData.expiresAt - now),
    hwid
  };
}

// -------------------------------------------------------------
// 8. การเปิดใช้งาน License Key ครั้งแรก (First Activation)
// -------------------------------------------------------------
async function activateLicenseKey(rawKey) {
  const cleanKey = (rawKey || '').trim().toUpperCase();
  const hwid = getSystemHWID();

  if (!cleanKey) {
    return { success: false, message: 'กรุณากรอก License Key' };
  }

  // ตรวจสอบประเภทแพ็กเกจ
  const pkg = detectPackage(cleanKey);
  if (!pkg) {
    return {
      success: false,
      message: `❌ รูปแบบคีย์ไม่ถูกต้อง!\nคีย์ต้องขึ้นต้นด้วย:\n• DAQ-3D- (3 วัน)\n• DAQ-1W- (1 สัปดาห์)\n• DAQ-4W- (4 สัปดาห์)\n• DAQ-6M- (6 เดือน)`
    };
  }

  // 3. ระบบป้องกันการวนใช้สิทธิ์ 3 วันซ้ำ (Anti-Abuse Trial)
  if (pkg.isTrial) {
    if (hasUsedTrial(hwid)) {
      return {
        success: false,
        message: 'เครื่องนี้เคยรับสิทธิ์ใช้งาน 3 วันแล้ว กรุณาอัปเกรดเป็นแพ็กเกจ 1 สัปดาห์ขึ้นไปที่ J3A STORE'
      };
    }
  }

  const now = Date.now();
  let activatedAt = now;
  let expiresAt = now + pkg.durationMs;

  // ยิงตรวจสอบกับ Google Apps Script Web App
  try {
    const res = await callLicenseApi('activate', cleanKey, hwid, {
      package: pkg.name,
      durationMs: pkg.durationMs,
      isTrial: pkg.isTrial ? 'true' : 'false'
    }, 10000);

    if (res && res.success === true) {
      if (res.activated_at) activatedAt = Number(res.activated_at) || now;
      if (res.expires_at) expiresAt = Number(res.expires_at) || (activatedAt + pkg.durationMs);
    } else {
      // เซิร์ฟเวอร์ปฏิเสธ
      const serverMsg = res?.message || 'ไม่สามารถเปิดใช้งานคีย์นี้ได้';
      if (serverMsg.toLowerCase().includes('mismatch') || serverMsg.includes('ผูกไว้กับเครื่องอื่น')) {
        return {
          success: false,
          message: 'คีย์นี้ถูกผูกไว้กับเครื่องอื่นแล้ว (HWID Mismatch)'
        };
      }
      if (serverMsg.includes('เคยรับสิทธิ์') || serverMsg.includes('3 วัน')) {
        return {
          success: false,
          message: 'เครื่องนี้เคยรับสิทธิ์ใช้งาน 3 วันแล้ว กรุณาอัปเกรดเป็นแพ็กเกจ 1 สัปดาห์ขึ้นไปที่ J3A STORE'
        };
      }
      return {
        success: false,
        message: serverMsg
      };
    }
  } catch (err) {
    // หากเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ขณะเปิดใช้งานครั้งแรก ให้แจ้งเตือนอย่างชัดเจน
    return {
      success: false,
      message: `ไม่สามารถเชื่อมต่อไปยังเซิร์ฟเวอร์เพื่อยืนยันสิทธิ์ได้: ${err.message}`
    };
  }

  // บันทึกข้อมูลแบบเข้ารหัสลงใน license.dat
  const record = {
    key: cleanKey,
    prefix: pkg.prefix,
    packageName: pkg.name,
    badge: pkg.badge,
    hwid: hwid,
    activatedAt: activatedAt,
    expiresAt: expiresAt,
    lastSeenTime: now,
    isTrial: pkg.isTrial
  };

  const encryptedData = encryptLicenseData(record, hwid);
  fs.writeFileSync(LICENSE_ENC_FILE, encryptedData, 'utf8');

  // หากเป็นคีย์แบบ 3 วัน บันทึกประวัติลงใน persistent machine vault ทันที
  if (pkg.isTrial) {
    markTrialUsed(hwid, cleanKey);
  }

  isLicenseActive = true;
  currentLicenseDetails = record;

  return {
    success: true,
    message: 'เปิดใช้งานสำเร็จเรียบร้อย!',
    key: cleanKey,
    package: pkg.name,
    badge: pkg.badge,
    expiresAt: expiresAt,
    remainingText: formatRemainingTime(expiresAt - now),
    hwid
  };
}

// -------------------------------------------------------------
// 9. ลบสิทธิ์ในเครื่อง (Logout)
// -------------------------------------------------------------
function logoutLicense() {
  if (fs.existsSync(LICENSE_ENC_FILE)) {
    try { fs.unlinkSync(LICENSE_ENC_FILE); } catch (_) {}
  }
  if (fs.existsSync(LEGACY_KEY_FILE)) {
    try { fs.unlinkSync(LEGACY_KEY_FILE); } catch (_) {}
  }
  isLicenseActive = false;
  currentLicenseDetails = null;
}

// -------------------------------------------------------------
// 10. Background Expiration Watcher (ตรวจสอบซ้ำทุกๆ 30 นาที)
// -------------------------------------------------------------
function startLicenseWatcher(onExpiredCallback) {
  if (watcherInterval) clearInterval(watcherInterval);

  // รันตรวจสอบซ้ำทุก 30 นาที (30 * 60 * 1000 ms)
  const INTERVAL_MS = 30 * 60 * 1000;

  watcherInterval = setInterval(async () => {
    try {
      const result = await checkStoredLicense();
      if (!result.success || result.expired) {
        isLicenseActive = false;
        if (typeof onExpiredCallback === 'function') {
          onExpiredCallback(result);
        }
      }
    } catch (_) {}
  }, INTERVAL_MS);

  if (watcherInterval.unref) watcherInterval.unref();
}

module.exports = {
  BASE_DIR,
  LICENSE_ENC_FILE,
  STORE_URL,
  APPS_SCRIPT_URL,
  PRODUCT_ID,
  KEY_PACKAGES,
  detectPackage,
  getSystemHWID,
  maskKey,
  formatRemainingTime,
  callLicenseApi,
  isLicensed,
  getActiveKey,
  getLicenseDetails,
  checkStoredLicense,
  activateLicenseKey,
  logoutLicense,
  startLicenseWatcher,
  hasUsedTrial,
  markTrialUsed
};
