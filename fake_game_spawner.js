const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const KNOWN_QUEST_EXES = {
  "1557866763339960340": ["deadzone2steam.exe"], // Deadzone Rogue 2
  "1437509662303059998": ["where winds meet.exe", "wwm.exe"], // Where Winds Meet
  "1461154307171811401": ["endfield.exe"], // Arknights: Endfield
  "1260340082150346932": ["once_human.exe"], // Once Human
  "1551691007387508878": ["gravebound.exe"], // Gravebound
  "1402418087793528862": ["risk of rain 2.exe"], // Risk of Rain 2
  "357607478105604096": ["aces.exe"], // War Thunder
  "363413310474813450": ["wizard101.exe", "wizardgraphicalclient.exe"], // Wizard101
  "363445589247131668": ["robloxplayerbeta.exe", "roblox.exe"], // Roblox
  "542075586886107149": ["r5apex.exe", "r5apex_dx12.exe"], // Apex Legends
  "1314395942253756416": ["marvel-win64-shipping.exe", "marvel.exe"], // Marvel Rivals
  "700136079562375258": ["valorant-win64-shipping.exe"], // Valorant
  "1531874756096295054": ["FC27.exe", "FC27_Trial.exe", "EASPORTSFC27.exe"], // EA SPORTS FC 27
  "1470616226995765409": ["htgame.exe"], // NTE Half Anni
  "1445982809792708628": ["aion2.exe", "aion2_client.exe"] // AION 2
};

let detectableMap = null;

function ensureDummyStub() {
  const stubPath = path.join(__dirname, 'dummy_stub.exe');
  if (fs.existsSync(stubPath)) return stubPath;

  const csPath = path.join(__dirname, 'dummy_game.cs');
  if (!fs.existsSync(csPath)) {
    fs.writeFileSync(csPath, `using System; using System.Threading; using System.Runtime.InteropServices;
class DummyGame {
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    static void Main() {
        IntPtr hWnd = GetConsoleWindow();
        if (hWnd != IntPtr.Zero) ShowWindow(hWnd, 0);
        while (true) Thread.Sleep(10000);
    }
}`);
  }

  const cscPaths = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ];
  const csc = cscPaths.find(p => fs.existsSync(p)) || 'csc.exe';
  try {
    execSync(`"${csc}" /target:exe /out:"${stubPath}" "${csPath}"`, { stdio: 'ignore' });
  } catch (e) {
    console.error('Failed to compile dummy_stub.exe:', e.message);
  }
  return stubPath;
}

async function loadDetectableApps() {
  if (detectableMap) return detectableMap;
  detectableMap = new Map();

  const cachePath = path.join(__dirname, 'detectable_cache.json');
  let rawList = [];
  try {
    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      // Cache valid for 7 days
      if (Date.now() - stats.mtimeMs < 7 * 86400 * 1000) {
        rawList = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }
    }
    if (rawList.length === 0) {
      const res = await fetch('https://discord.com/api/v9/applications/detectable');
      if (res.ok) {
        rawList = await res.json();
        fs.writeFileSync(cachePath, JSON.stringify(rawList));
      }
    }
  } catch (e) {
    console.error('Failed to load detectable apps:', e.message);
  }

  for (const item of rawList) {
    if (item.id && Array.isArray(item.executables)) {
      const winExes = item.executables
        .filter(e => e.os === 'win32' || !e.os)
        .map(e => path.basename(e.name || '').trim())
        .filter(name => name.length > 0 && name.endsWith('.exe'));
      if (winExes.length > 0) {
        detectableMap.set(item.id, winExes);
      }
    }
  }
  return detectableMap;
}

function isDiscordDesktopRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Discord.exe" /NH', { encoding: 'utf8' });
    return out.toLowerCase().includes('discord.exe');
  } catch {
    return false;
  }
}

async function findExecutableForQuest(quest) {
  const appId = quest.config?.task_config_v2?.tasks?.PLAY_ON_DESKTOP?.applications?.[0]?.id 
             || quest.config?.application?.id 
             || quest.applicationId;

  // 1. Check known quest mappings
  if (appId && KNOWN_QUEST_EXES[appId]) {
    return KNOWN_QUEST_EXES[appId][0];
  }

  // 2. Check detectable apps
  const map = await loadDetectableApps();
  if (appId && map.has(appId)) {
    const exes = map.get(appId);
    if (exes && exes.length > 0) return exes[0];
  }

  // 3. Fallback: sanitize application or quest name
  const rawName = quest.config?.application?.name || quest.name || 'game';
  const clean = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '') + '.exe';
  return clean || 'game.exe';
}

function spawnFakeGame(exeName, gameTitle = '') {
  const stubPath = ensureDummyStub();
  const tempDir = path.join(os.tmpdir(), 'DiscordQuestFakeGames');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const cleanName = path.basename(exeName);
  const targetPath = path.join(tempDir, cleanName);

  // Copy stub to target exe name
  fs.copyFileSync(stubPath, targetPath);

  // Spawn process detached with gameTitle argument
  const child = spawn(targetPath, [gameTitle || cleanName], { detached: true, stdio: 'ignore' });
  child.unref();

  return {
    pid: child.pid,
    name: cleanName,
    path: targetPath,
    child
  };
}

function killFakeGame(gameInfo) {
  if (!gameInfo) return;
  try {
    if (gameInfo.pid) {
      execSync(`taskkill /F /PID ${gameInfo.pid}`, { stdio: 'ignore' });
    }
  } catch {}
  try {
    if (gameInfo.name) {
      execSync(`taskkill /F /IM "${gameInfo.name}"`, { stdio: 'ignore' });
    }
  } catch {}
  try {
    if (gameInfo.path && fs.existsSync(gameInfo.path)) {
      fs.unlinkSync(gameInfo.path);
    }
  } catch {}
}

module.exports = {
  ensureDummyStub,
  loadDetectableApps,
  isDiscordDesktopRunning,
  findExecutableForQuest,
  spawnFakeGame,
  killFakeGame
};
