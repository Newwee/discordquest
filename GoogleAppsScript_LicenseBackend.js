/**
 * =========================================================================
 * J3A STORE - Google Apps Script License & HWID Verification Backend
 * สำหรับ Google Sheet จัดการ License Key ของ Discord AutoQuest
 * =========================================================================
 * 
 * วิธีติดตั้งใน Google Sheet:
 * 1. เปิด Google Sheet ที่ใช้เก็บคีย์
 * 2. ไปที่ Extensions (ส่วนขยาย) > Apps Script
 * 3. วางโค้ดนี้ทั้งหมดลงใน Code.gs
 * 4. กด Deploy (การทำให้ใช้งานได้) > New deployment (การทำให้ใช้งานได้ใหม่)
 * 5. เลือกประเภท: Web app (เว็บแอป)
 *    - Execute as: Me (ฉัน)
 *    - Who has access: Anyone (ทุกคน)
 * 6. กด Deploy แล้วคัดลอก Web App URL ไปใส่ใน license_gate.js
 * =========================================================================
 */

const SHEET_NAME_LICENSES = 'Licenses';
const SHEET_NAME_TRIALS = 'Trial_History';
const STORE_URL = 'https://j3a-store.vercel.app';

// กำหนดระยะเวลาตามประเภทของคีย์
const KEY_DURATIONS = {
  'DAQ-3D-': { name: '3 Days Trial', durationMs: 72 * 60 * 60 * 1000, isTrial: true },
  'DAQ-1W-': { name: '1 Week', durationMs: 7 * 24 * 60 * 60 * 1000, isTrial: false },
  'DAQ-4W-': { name: '4 Weeks', durationMs: 28 * 24 * 60 * 60 * 1000, isTrial: false },
  'DAQ-6M-': { name: '6 Months', durationMs: 180 * 24 * 60 * 60 * 1000, isTrial: false },
  'J3ADQ-':  { name: 'Standard (J3A)', durationMs: 30 * 24 * 60 * 60 * 1000, isTrial: false }
};

function getDurationInfo(key) {
  const upper = (key || '').trim().toUpperCase();
  for (const prefix in KEY_DURATIONS) {
    if (upper.startsWith(prefix)) {
      return KEY_DURATIONS[prefix];
    }
  }
  return { name: 'Standard', durationMs: 7 * 24 * 60 * 60 * 1000, isTrial: false };
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = (params.action || '').trim().toLowerCase();
  const rawKey = (params.key || '').trim().toUpperCase();
  const hwid = (params.hwid || '').trim().toUpperCase();

  // CORS Headers
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  if (!rawKey) {
    return output.setContent(JSON.stringify({ success: false, message: 'กรุณากรอก License Key' }));
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets(ss);

  const licenseSheet = ss.getSheetByName(SHEET_NAME_LICENSES);
  const trialSheet = ss.getSheetByName(SHEET_NAME_TRIALS);

  // ค้นหาแถวของคีย์ในชีต Licenses
  const data = licenseSheet.getDataRange().getValues();
  let keyRow = -1;
  let rowData = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === rawKey) {
      keyRow = i + 1; // 1-based index
      rowData = data[i];
      break;
    }
  }

  if (keyRow === -1 || !rowData) {
    return output.setContent(JSON.stringify({ success: false, message: 'ไม่พบ License Key นี้ในระบบ' }));
  }

  // โครงสร้างคอลัมน์:
  // A: Key | B: HWID | C: Package | D: Status | E: Activated_At | F: Expires_At | G: Note
  const currentHWID = String(rowData[1] || '').trim().toUpperCase();
  const currentPackage = String(rowData[2] || '').trim();
  const currentStatus = String(rowData[3] || 'ACTIVE').trim().toUpperCase();
  const activatedAt = rowData[4] ? Number(rowData[4]) : 0;
  const expiresAt = rowData[5] ? Number(rowData[5]) : 0;

  if (currentStatus === 'REVOKED' || currentStatus === 'BANNED') {
    return output.setContent(JSON.stringify({ success: false, message: 'คีย์นี้ถูกระงับการใช้งานในระบบ' }));
  }

  const durationInfo = getDurationInfo(rawKey);
  const now = new Date().getTime();

  // -------------------------------------------------------------
  // ACTION: ACTIVATE (เปิดใช้งานคีย์)
  // -------------------------------------------------------------
  if (action === 'activate') {
    // 3. ระบบป้องกันการวนใช้สิทธิ์ 3 วันซ้ำ (Anti-Abuse Trial)
    if (durationInfo.isTrial) {
      if (isHwidUsedTrial(trialSheet, hwid)) {
        return output.setContent(JSON.stringify({
          success: false,
          message: 'เครื่องนี้เคยรับสิทธิ์ใช้งาน 3 วันแล้ว กรุณาอัปเกรดเป็นแพ็กเกจ 1 สัปดาห์ขึ้นไปที่ J3A STORE'
        }));
      }
    }

    // 2. ตรวจสอบ HWID Lock
    if (currentHWID && currentHWID !== hwid) {
      return output.setContent(JSON.stringify({
        success: false,
        message: 'คีย์นี้ถูกผูกไว้กับเครื่องอื่นแล้ว (HWID Mismatch)'
      }));
    }

    let finalActivated = activatedAt;
    let finalExpires = expiresAt;

    if (!currentHWID || !finalActivated) {
      // First Activation: บันทึกผูก HWID และคำนวณวันหมดอายุ
      finalActivated = now;
      finalExpires = now + durationInfo.durationMs;

      licenseSheet.getRange(keyRow, 2).setValue(hwid); // Col B: HWID
      licenseSheet.getRange(keyRow, 3).setValue(durationInfo.name); // Col C: Package
      licenseSheet.getRange(keyRow, 4).setValue('ACTIVE'); // Col D: Status
      licenseSheet.getRange(keyRow, 5).setValue(finalActivated); // Col E: Activated_At
      licenseSheet.getRange(keyRow, 6).setValue(finalExpires); // Col F: Expires_At

      // หากเป็นคีย์แบบทดลอง 3 วัน บันทึก HWID ลงในชีต Trial_History
      if (durationInfo.isTrial) {
        trialSheet.appendRow([hwid, rawKey, new Date().toISOString()]);
      }
    } else {
      // หากเปิดซ้ำบนเครื่องเดิม ตรวจสอบวันหมดอายุ
      if (now > finalExpires) {
        return output.setContent(JSON.stringify({
          success: false,
          expired: true,
          message: `คีย์ของคุณหมดอายุแล้ว สามารถต่ออายุได้ที่ ${STORE_URL}`
        }));
      }
    }

    return output.setContent(JSON.stringify({
      success: true,
      message: 'เปิดใช้งานสำเร็จเรียบร้อย!',
      key: rawKey,
      package: durationInfo.name,
      activated_at: finalActivated,
      expires_at: finalExpires
    }));
  }

  // -------------------------------------------------------------
  // ACTION: CHECK (ตรวจสอบสถานะคีย์)
  // -------------------------------------------------------------
  if (action === 'check') {
    if (currentHWID && currentHWID !== hwid) {
      return output.setContent(JSON.stringify({
        success: false,
        message: 'คีย์นี้ถูกผูกไว้กับเครื่องอื่นแล้ว (HWID Mismatch)'
      }));
    }

    if (expiresAt && now > expiresAt) {
      return output.setContent(JSON.stringify({
        success: false,
        expired: true,
        message: `คีย์ของคุณหมดอายุแล้ว สามารถต่ออายุได้ที่ ${STORE_URL}`
      }));
    }

    return output.setContent(JSON.stringify({
      success: true,
      message: 'ยืนยันสิทธิ์ถูกต้อง',
      key: rawKey,
      package: currentPackage || durationInfo.name,
      activated_at: activatedAt,
      expires_at: expiresAt
    }));
  }

  return output.setContent(JSON.stringify({ success: false, message: 'Action ไม่ถูกต้อง' }));
}

/**
 * ตรวจสอบว่า HWID เคยเปิดใช้สิทธิ์ 3 วันในชีต Trial_History หรือยัง
 */
function isHwidUsedTrial(trialSheet, hwid) {
  if (!hwid) return false;
  const trialData = trialSheet.getDataRange().getValues();
  for (let i = 1; i < trialData.length; i++) {
    if (String(trialData[i][0]).trim().toUpperCase() === hwid) {
      return true;
    }
  }
  return false;
}

/**
 * สร้าง Sheet และ Header ถ้ายังไม่มี
 */
function ensureSheets(ss) {
  let licenseSheet = ss.getSheetByName(SHEET_NAME_LICENSES);
  if (!licenseSheet) {
    licenseSheet = ss.insertSheet(SHEET_NAME_LICENSES);
    licenseSheet.appendRow(['Key', 'HWID', 'Package', 'Status', 'Activated_At', 'Expires_At', 'Created_At']);
    licenseSheet.setFrozenRows(1);
  }

  let trialSheet = ss.getSheetByName(SHEET_NAME_TRIALS);
  if (!trialSheet) {
    trialSheet = ss.insertSheet(SHEET_NAME_TRIALS);
    trialSheet.appendRow(['HWID', 'Key', 'Recorded_At']);
    trialSheet.setFrozenRows(1);
  }
}
