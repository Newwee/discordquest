/**
 * J3A Discord AutoQuest - License Gate (HWID Lock 1:1)
 * ตรวจสอบสิทธิ์การใช้งานผ่าน Google Apps Script Web App
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// -------------------------------------------------------------
// ข้อกำหนดสำคัญเรื่อง Path: Absolute Path อิงจากตำแหน่งไฟล์เสมอ
// -------------------------------------------------------------
const BASE_DIR = path.resolve(__dirname);
const LICENSE_KEY_FILE = path.join(BASE_DIR, 'license.key');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwq22hsYcYWJYuOaUkDy1Ysmut80NwQ5kdmQ-0ItJ8JhGjV2w2PRxEua9mi_3yGagh1/exec';
const PRODUCT_ID = 'discord_autoquest';
const KEY_PREFIX = 'J3ADQ-';

let isLicenseActive = false;
let activeLicenseKey = '';

/**
 * 1. ดึง Hardware ID (HWID) ประจำเครื่อง
 * ใช้ UUID ของเครื่องบน Windows จาก Win32_ComputerSystemProduct (fallback ด้วย uuid.getnode / MAC)
 */
function getSystemHWID() {
  // Windows: Win32_ComputerSystemProduct UUID
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_ComputerSystemProduct).UUID'
    ], { encoding: 'utf8', timeout: 4000 }).trim();

    if (out && out.length >= 8 && !out.toLowerCase().includes('default string')) {
      return out.toUpperCase();
    }
  } catch (_) {}

  // Fallback 1: Windows MachineGuid
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Cryptography").MachineGuid'
    ], { encoding: 'utf8', timeout: 2500 }).trim();

    if (out && out.length >= 8) {
      return out.toUpperCase();
    }
  } catch (_) {}

  // Fallback 2: MAC Address (uuid.getnode equivalent)
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

  // Fallback 3: Hostname
  return os.hostname().toUpperCase();
}

/**
 * ซ่อนส่วนสำคัญของคีย์เพื่อแสดงผลอย่างปลอดภัย
 */
function maskKey(key) {
  if (!key) return '';
  const parts = key.trim().split('-');
  if (parts.length >= 4) {
    return `${parts[0]}-****-****-${parts[parts.length - 1]}`;
  }
  if (key.length > 8) {
    return `${key.slice(0, 6)}****${key.slice(-4)}`;
  }
  return '****';
}

/**
 * ยิง HTTP GET ไปยัง Google Apps Script Web App
 */
async function callLicenseApi(action, key, hwid, timeoutMs = 8000) {
  const params = new URLSearchParams({
    action: action,
    key: key.trim().toUpperCase(),
    hwid: hwid.trim(),
    product: PRODUCT_ID
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

/**
 * ตรวจสอบสถานะว่าเปิดใช้งาน License Key หรือยัง
 */
function isLicensed() {
  if (isLicenseActive) return true;
  // เช็คไฟล์อย่างเร็วถ้ามีไฟล์อยู่แล้ว
  if (fs.existsSync(LICENSE_KEY_FILE)) {
    try {
      const k = fs.readFileSync(LICENSE_KEY_FILE, 'utf8').trim().toUpperCase();
      if (k.startsWith(KEY_PREFIX)) {
        activeLicenseKey = k;
        return true;
      }
    } catch (_) {}
  }
  return false;
}

function getActiveKey() {
  if (activeLicenseKey) return activeLicenseKey;
  if (fs.existsSync(LICENSE_KEY_FILE)) {
    try {
      activeLicenseKey = fs.readFileSync(LICENSE_KEY_FILE, 'utf8').trim().toUpperCase();
    } catch (_) {}
  }
  return activeLicenseKey;
}

/**
 * ตรวจสอบคีย์ใน license.key กับเซิร์ฟเวอร์แบบ Asynchronous (ไม่บล็อกพอร์ต HTTP)
 */
async function checkStoredLicense() {
  const hwid = getSystemHWID();

  if (!fs.existsSync(LICENSE_KEY_FILE)) {
    isLicenseActive = false;
    activeLicenseKey = '';
    return { success: false, reason: 'NO_FILE', hwid };
  }

  let savedKey = '';
  try {
    savedKey = fs.readFileSync(LICENSE_KEY_FILE, 'utf8').trim().toUpperCase();
  } catch (e) {
    isLicenseActive = false;
    return { success: false, reason: 'READ_ERROR', error: e.message, hwid };
  }

  if (!savedKey || !savedKey.startsWith(KEY_PREFIX)) {
    try { fs.unlinkSync(LICENSE_KEY_FILE); } catch (_) {}
    isLicenseActive = false;
    activeLicenseKey = '';
    return { success: false, reason: 'INVALID_PREFIX', hwid };
  }

  try {
    const checkRes = await callLicenseApi('check', savedKey, hwid, 7000);
    if (checkRes && checkRes.success === true) {
      isLicenseActive = true;
      activeLicenseKey = savedKey;
      return { success: true, key: savedKey, hwid, message: checkRes.message };
    } else {
      // คีย์ถูกเพิกถอนหรือไม่ถูกต้อง ลบทิ้ง
      try { fs.unlinkSync(LICENSE_KEY_FILE); } catch (_) {}
      isLicenseActive = false;
      activeLicenseKey = '';
      return { success: false, reason: 'REJECTED', message: checkRes?.message || 'คีย์ไม่ถูกต้อง', hwid };
    }
  } catch (netErr) {
    // เน็ตมีปัญหาชั่วคราว ให้โหมดออฟไลน์ถ้าไฟล์มีอยู่จริง
    isLicenseActive = true;
    activeLicenseKey = savedKey;
    return { success: true, key: savedKey, hwid, offline: true, message: 'เปิดใช้งานแล้ว (โหมดออฟไลน์)' };
  }
}

/**
 * เปิดใช้งาน License Key ใหม่
 */
async function activateLicenseKey(rawKey) {
  const cleanKey = (rawKey || '').trim().toUpperCase();
  const hwid = getSystemHWID();

  if (!cleanKey) {
    return { success: false, message: 'กรุณากรอก License Key' };
  }

  if (!cleanKey.startsWith(KEY_PREFIX)) {
    let msg = `❌ คีย์นี้ไม่ใช่คีย์สำหรับ J3A Discord AutoQuest!\n(ต้องขึ้นต้นด้วย "${KEY_PREFIX}")`;
    if (cleanKey.startsWith('J3ADM-')) {
      msg = '❌ คีย์นี้เป็นของโปรแกรม J3A Discord Manager กรุณาใช้คีย์ที่ขึ้นต้นด้วย "J3ADQ-" เท่านั้น';
    } else if (cleanKey.startsWith('J3ADP-')) {
      msg = '❌ คีย์นี้เป็นของโปรแกรม J3A Discord Profile กรุณาใช้คีย์ที่ขึ้นต้นด้วย "J3ADQ-" เท่านั้น';
    }
    return { success: false, message: msg };
  }

  try {
    const res = await callLicenseApi('activate', cleanKey, hwid, 10000);
    if (res && res.success === true) {
      fs.writeFileSync(LICENSE_KEY_FILE, cleanKey, 'utf8');
      isLicenseActive = true;
      activeLicenseKey = cleanKey;
      return {
        success: true,
        message: res.message || 'เปิดใช้งานสำเร็จเรียบร้อย!',
        key: cleanKey,
        hwid
      };
    } else {
      return {
        success: false,
        message: res?.message || 'ไม่สามารถเปิดใช้งานคีย์นี้ได้'
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `ไม่สามารถเชื่อมต่อไปยังเซิร์ฟเวอร์ตรวจสอบได้: ${err.message}`
    };
  }
}

/**
 * ลบสิทธิ์ในเครื่อง (Logout)
 */
function logoutLicense() {
  if (fs.existsSync(LICENSE_KEY_FILE)) {
    try { fs.unlinkSync(LICENSE_KEY_FILE); } catch (_) {}
  }
  isLicenseActive = false;
  activeLicenseKey = '';
}

module.exports = {
  BASE_DIR,
  LICENSE_KEY_FILE,
  APPS_SCRIPT_URL,
  PRODUCT_ID,
  KEY_PREFIX,
  getSystemHWID,
  maskKey,
  callLicenseApi,
  isLicensed,
  getActiveKey,
  checkStoredLicense,
  activateLicenseKey,
  logoutLicense
};
