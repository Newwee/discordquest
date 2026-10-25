const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. URL เซิร์ฟเวอร์ J3A Store (รองรับทั้งโดเมนหลักและ fallback ไปยัง Vercel)
const PRIMARY_API_URL = 'https://j3astore.com';
const FALLBACK_API_URL = 'https://j3a-store.vercel.app';
const STORE_WEB_URL = 'https://j3astore.com';

// 2. ตำแหน่งเก็บไฟล์ License บนเครื่องลูกค้า (%APPDATA%/J3ADiscordAutoQuest/license.json)
const APP_DATA_DIR = path.join(
  process.env.APPDATA || process.env.USERPROFILE || '.',
  'J3ADiscordAutoQuest'
);
const LICENSE_FILE = path.join(APP_DATA_DIR, 'license.json');

/**
 * ดึง Hardware ID (HWID) ประจำเครื่องที่ปลอมแปลงยาก
 * รวม Windows MachineGuid + Motherboard UUID แล้ว Hash ด้วย SHA-256
 */
function getMachineHWID() {
  let rawIdentifier = '';
  try {
    if (process.platform === 'win32') {
      // 1. ดึง MachineGuid จาก Windows Registry
      try {
        const regOutput = execSync(
          'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
          { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const match = regOutput.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/);
        if (match && match[1]) {
          rawIdentifier += match[1].trim();
        }
      } catch (_) {}

      // 2. ดึง BIOS / Motherboard UUID (รองรับทั้ง Windows 10 และ Windows 11 ที่ไม่มี wmic)
      let mbUuid = '';
      try {
        const wmicOutput = execSync('wmic csproduct get uuid', {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const lines = wmicOutput.split('\r\n').filter((l) => l.trim() && !l.includes('UUID'));
        if (lines[0]) mbUuid = lines[0].trim();
      } catch (_) {
        // Fallback PowerShell CIM เมื่อ wmic ถูกปิดการใช้งานใน Windows 11
        try {
          const psOutput = execSync(
            'powershell.exe -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
            { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
          ).trim();
          if (psOutput && !psOutput.toLowerCase().includes('default string')) {
            mbUuid = psOutput;
          }
        } catch (_) {}
      }

      if (mbUuid) {
        rawIdentifier += (rawIdentifier ? '_' : '') + mbUuid;
      }
    }
  } catch (e) {
    rawIdentifier = `${process.env.COMPUTERNAME || 'PC'}_${process.env.USERNAME || 'USER'}`;
  }

  if (!rawIdentifier) {
    rawIdentifier = `${process.env.COMPUTERNAME || 'PC'}_${process.env.USERNAME || 'USER'}`;
  }

  return crypto.createHash('sha256').update(rawIdentifier).digest('hex');
}

/**
 * บันทึก License ลง Local Cache
 */
function saveLocalLicense(data) {
  try {
    if (!fs.existsSync(APP_DATA_DIR)) {
      fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving local license:', err);
  }
}

/**
 * อ่าน License จาก Local Cache
 */
function loadLocalLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    }
  } catch (err) {
    return null;
  }
  return null;
}

/**
 * ลบ License เมื่อหมดอายุ
 */
function clearLocalLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      fs.unlinkSync(LICENSE_FILE);
    }
  } catch (err) {}
}

/**
 * ยิง Request ไปยังเซิร์ฟเวอร์ พร้อมระบบ Auto-fallback
 */
async function fetchVerifyEndpoint(payload, timeoutMs = 8000) {
  const urls = [
    `${PRIMARY_API_URL}/api/license/verify`,
    `${FALLBACK_API_URL}/api/license/verify`
  ];

  let lastError = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // ลอง URL ถัดไป
      continue;
    }
  }

  throw lastError || new Error('Network error');
}

/**
 * ฟังก์ชันหลักในการตรวจสอบหรือเปิดใช้งาน License Key
 * @param {string} inputKey - คีย์ที่ลูกค้ากรอก
 */
async function verifyOrActivateKey(inputKey) {
  const hwid = getMachineHWID();
  const keyToTest = (inputKey || '').trim().toUpperCase();

  if (!keyToTest) {
    return { success: false, error: 'กรุณาระบุ License Key' };
  }

  try {
    const response = await fetchVerifyEndpoint({
      key: keyToTest,
      hwid: hwid,
      app_name: 'discord_autoquest',
    });

    const data = response.data;

    if (response.ok && data && data.valid) {
      // เซฟข้อมูลคีย์ลงเครื่อง
      const licenseRecord = {
        key: keyToTest,
        hwid: hwid,
        tier: data.tier,
        tierName: data.tierName,
        expiresAt: data.expiresAt,
        activatedAt: data.activatedAt,
        remainingDays: data.remainingDays,
        lastVerified: new Date().toISOString(),
      };

      saveLocalLicense(licenseRecord);

      return {
        success: true,
        action: data.action,
        tier: data.tier,
        tierName: data.tierName,
        remainingDays: data.remainingDays,
        expiresAt: data.expiresAt,
        message: data.message || 'เปิดใช้งานสำเร็จเรียบร้อย!',
      };
    } else {
      if (data && data.status === 'expired') {
        clearLocalLicense();
      }
      return {
        success: false,
        error: data?.error || 'License Key ไม่ถูกต้องหรือหมดอายุ',
      };
    }
  } catch (err) {
    return {
      success: false,
      error: `ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ตรวจสอบสิทธิ์ได้ (${err.message})`,
    };
  }
}

/**
 * ตรวจสอบสิทธิ์อัตโนมัติเมื่อเปิดโปรแกรม (Startup Check)
 */
async function checkStartupLicense() {
  const cached = loadLocalLicense();
  if (!cached || !cached.key) {
    return { requiredActivation: true };
  }

  // ส่งไป Verify กับ Server
  const result = await verifyOrActivateKey(cached.key);
  if (!result.success) {
    clearLocalLicense();
    return { requiredActivation: true, error: result.error };
  }

  return { requiredActivation: false, license: result };
}

/**
 * Helper ดึงข้อความ Badge สำหรับแสดงผลบน Header
 * ตัวอย่าง: "🟢 License: 1 สัปดาห์ (เหลืออีก 5 วัน)" หรือ "🟡 Trial 3 วัน (เหลืออีก 2 วัน)"
 */
function getLicenseBadge(licenseData) {
  if (!licenseData) {
    return { text: '🔒 ยังไม่ได้เปิดใช้งาน', icon: '🔒', isTrial: false, active: false };
  }

  const tier = (licenseData.tier || '').toLowerCase();
  const tierName = licenseData.tierName || '';
  const isTrial = tier.includes('trial') || tier.includes('3d') || tierName.includes('3 วัน') || tierName.includes('Trial');
  const icon = isTrial ? '🟡' : '🟢';

  let tierLabel = tierName || (isTrial ? 'Trial 3 วัน' : 'License');
  let remainingText = '';

  if (typeof licenseData.remainingDays === 'number') {
    remainingText = ` (เหลืออีก ${licenseData.remainingDays} วัน)`;
  } else if (licenseData.expiresAt) {
    const diffMs = new Date(licenseData.expiresAt).getTime() - Date.now();
    if (diffMs > 0) {
      const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      remainingText = ` (เหลืออีก ${days} วัน)`;
    } else {
      return { text: '🔴 License หมดอายุแล้ว', icon: '🔴', isTrial, active: false };
    }
  }

  return {
    text: `${icon} ${tierLabel}${remainingText}`,
    icon: icon,
    tierLabel: tierLabel,
    remainingText: remainingText,
    tier: licenseData.tier,
    tierName: licenseData.tierName,
    remainingDays: licenseData.remainingDays,
    isTrial,
    active: true
  };
}

module.exports = {
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
};
