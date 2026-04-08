'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn, execSync } = require('child_process');

// ─── Pfade ───────────────────────────────────────────────────────────────────
// Im ASAR-Build: Ressourcen liegen in process.resourcesPath/app/
// Im Dev-Modus:  Ressourcen liegen neben electron-main.js
const APP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, 'app');

const SERVER_PY   = path.join(APP_DIR, 'server.py');
const SERVER_PORT = path.join(APP_DIR, 'server.port');
const SERVER_PID  = path.join(APP_DIR, 'server.pid');
const MULTIPLAYER_PID = path.join(APP_DIR, 'games', 'server-ws.pid');
const APP_ICON_ICO = path.join(APP_DIR, 'images', 'icons', 'icon.ico');
const APP_ICON_PNG = path.join(APP_DIR, 'images', 'icons', 'icon-512.png');
const APP_ICON    = fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : APP_ICON_PNG;

// ─── Globale Referenzen ──────────────────────────────────────────────────────
let mainWindow    = null;
let serverProcess = null;
let serverPort    = 8080;
let splashWindow  = null;

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window-state', {
    maximized: mainWindow.isMaximized(),
    fullscreen: mainWindow.isFullScreen(),
  });
}

function killPid(pid) {
  if (!pid || Number.isNaN(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch {}
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' }); } catch {}
  }
}

function killFromPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) killPid(pid);
  } catch {}
  try { fs.unlinkSync(pidFile); } catch {}
}

// ─── Python finden ───────────────────────────────────────────────────────────
function findPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  // Im Build: Mitgeliefertes Python (PyInstaller-EXE) prüfen
  const bundledPy = path.join(APP_DIR, 'server_win.exe');
  if (fs.existsSync(bundledPy)) return bundledPy;

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 3000 });
      return cmd;
    } catch { /* weiter */ }
  }
  return null;
}

// ─── Server starten ──────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    // Alte port/pid Dateien löschen
    killFromPidFile(MULTIPLAYER_PID);
    try { fs.unlinkSync(SERVER_PORT); } catch {}
    try { fs.unlinkSync(SERVER_PID);  } catch {}

    const python = findPython();
    if (!python) {
      reject(new Error('Python nicht gefunden.\n\nBitte Python 3.9+ installieren.'));
      return;
    }

    const isExe = python.endsWith('.exe') && !python.includes('python');
    const args  = isExe ? [] : [SERVER_PY];
    const cmd   = isExe ? python : python;

    const logPath = path.join(APP_DIR, 'server.log');
    let logStream;
    try {
      logStream = fs.createWriteStream(logPath, { flags: 'w' });
    } catch { logStream = null; }

    serverProcess = spawn(cmd, args, {
      cwd:      APP_DIR,
      env:      {
        ...process.env,
        MEDIACENTER_NODE_RUNTIME: process.execPath,
      },
      stdio:    ['ignore', logStream ? 'pipe' : 'ignore', logStream ? 'pipe' : 'ignore'],
      detached: false,
      windowsHide: true,
    });

    if (logStream && serverProcess.stdout) serverProcess.stdout.pipe(logStream);
    if (logStream && serverProcess.stderr) serverProcess.stderr.pipe(logStream);

    serverProcess.on('error', err => {
      reject(new Error(`Server konnte nicht gestartet werden:\n${err.message}`));
    });
    serverProcess.on('exit', code => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(`Server beendet (Code ${code})`);
      }
    });

    // Warten bis server.port geschrieben oder Port erreichbar
    let waited = 0;
    const CHECK_MS   = 300;
    const MAX_WAIT   = 20000; // 20 Sekunden

    const timer = setInterval(() => {
      waited += CHECK_MS;

      // 1) server.port Datei vorhanden?
      if (fs.existsSync(SERVER_PORT)) {
        try {
          const p = parseInt(fs.readFileSync(SERVER_PORT, 'utf8').trim(), 10);
          if (p > 0) {
            serverPort = p;
            clearInterval(timer);
            // Nochmals kurz warten bis HTTP bereit
            waitForHttp(serverPort, 5000).then(resolve).catch(resolve);
            return;
          }
        } catch {}
      }

      // 2) Port 8080 direkt erreichbar?
      if (waited % 1500 === 0) {
        isPortOpen(8080).then(open => {
          if (open) { serverPort = 8080; clearInterval(timer); resolve(); }
        });
      }

      if (waited >= MAX_WAIT) {
        clearInterval(timer);
        // Trotzdem versuchen zu laden – vielleicht läuft er doch
        resolve();
      }
    }, CHECK_MS);
  });
}

function isPortOpen(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/`, res => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

function waitForHttp(port, maxMs) {
  return new Promise(resolve => {
    let spent = 0;
    const iv = setInterval(async () => {
      spent += 400;
      const open = await isPortOpen(port);
      if (open || spent >= maxMs) { clearInterval(iv); resolve(); }
    }, 400);
  });
}

// ─── Splash-Fenster ──────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:           520,
    height:          340,
    frame:           false,
    transparent:     true,
    resizable:       false,
    skipTaskbar:     true,
    alwaysOnTop:     true,
    webPreferences:  { nodeIntegration: false, contextIsolation: true },
  });
  // Inline-HTML als Data-URL
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:
  radial-gradient(circle at top left,rgba(90,197,255,.18),transparent 34%),
  radial-gradient(circle at top right,rgba(255,180,79,.18),transparent 28%),
  linear-gradient(145deg,#07111b,#0d1726 52%,#07101a 100%);
  border-radius:22px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;height:100vh;
  font-family:'Aptos','Segoe UI Variable Text','Segoe UI',sans-serif;
  color:#fff;border:1px solid rgba(255,221,164,0.24);overflow:hidden;
  box-shadow:0 28px 80px rgba(0,0,0,.48)}
.shell{width:100%;height:100%;padding:28px;display:flex;flex-direction:column;justify-content:space-between}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px}
.mark{width:42px;height:42px;border-radius:14px;background:
  linear-gradient(145deg,rgba(255,216,118,.95),rgba(255,162,68,.92));
  box-shadow:0 10px 30px rgba(255,179,71,.28), inset 0 1px 0 rgba(255,255,255,.32);
  position:relative}
.mark:after{content:'';position:absolute;inset:10px;border-radius:9px;
  border:1px solid rgba(8,15,24,.28)}
.eyebrow{font-size:.68rem;letter-spacing:2px;text-transform:uppercase;color:rgba(169,224,255,.72);margin-bottom:4px}
h1{font-size:1.7rem;line-height:1;font-weight:800;font-family:'Bahnschrift','Segoe UI Variable Display','Trebuchet MS',sans-serif;letter-spacing:1px}
.meta{display:flex;gap:8px}
.chip{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.04);font-size:.72rem;color:rgba(236,245,255,.78)}
.hero{display:flex;flex-direction:column;gap:10px}
.hero h2{font-size:1.05rem;font-weight:700;max-width:320px}
.hero p{font-size:.84rem;line-height:1.6;color:rgba(235,241,247,.62);max-width:380px}
.bar{width:100%;height:5px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden}
.fill{height:100%;border-radius:2px;
  background:linear-gradient(90deg,#ffd977,#ffb347,#91e2ff);
  animation:load 3s ease-in-out forwards}
@keyframes load{from{width:0%}to{width:95%}}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:.78rem;color:rgba(255,255,255,.48)}
</style></head><body>
<div class="shell">
  <div class="top">
    <div class="brand">
      <div class="mark"></div>
      <div>
        <div class="eyebrow">Desktop Edition</div>
        <h1>MediaCenter</h1>
      </div>
    </div>
    <div class="meta">
      <span class="chip">Lokaler Server</span>
      <span class="chip">Native UI</span>
    </div>
  </div>
  <div class="hero">
    <h2>Die Anwendung wird vorbereitet und direkt in der Desktop-Oberflaeche gestartet.</h2>
    <p>Keine Browser-Tabs, keine Umwege. Medien, Uploads und Multiplayer laufen in einem zusammenhaengenden App-Fenster.</p>
    <div class="bar"><div class="fill"></div></div>
  </div>
  <div class="foot">
    <span>MediaCenter v2.1</span>
    <span>Starte Dienste...</span>
  </div>
</div>
</body></html>`;
  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ─── Hauptfenster ────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:           1440,
    height:          900,
    minWidth:        1040,
    minHeight:       680,
    show:            false,
    title:           'MediaCenter',
    frame:           false,
    autoHideMenuBar: true,
    backgroundColor: '#07111b',
    icon:            fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    webPreferences:  {
      preload:        path.join(__dirname, 'preload.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      sandbox:             false,
      webviewTag:          false,
      allowRunningInsecureContent: false,
    },
  });

  // Menü reduzieren
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  } else {
    // Dev: Einfaches Menü mit DevTools
    const devMenu = Menu.buildFromTemplate([
      { label: 'Ansicht', submenu: [
        { label: 'DevTools', accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools() },
        { label: 'Neu laden', accelerator: 'F5',
          click: () => mainWindow.reload() },
      ]},
    ]);
    Menu.setApplicationMenu(devMenu);
  }

  // Externe Links im System-Browser öffnen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`) &&
        !url.startsWith(`http://localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Navigationen, die den Rahmen verlassen würden, blockieren
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`) &&
        !url.startsWith(`http://localhost:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('did-finish-load', sendWindowState);
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});

  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/?desktop=1`);
}

// ─── IPC Handler ─────────────────────────────────────────────────────────────
ipcMain.handle('app-version',  () => app.getVersion());
ipcMain.handle('server-port',  () => serverPort);
ipcMain.handle('app-platform', () => process.platform);
ipcMain.handle('window-state', () => ({
  maximized: mainWindow ? mainWindow.isMaximized() : false,
  fullscreen: mainWindow ? mainWindow.isFullScreen() : false,
}));

ipcMain.on('window-minimize',  () => mainWindow?.minimize());
ipcMain.on('window-maximize',  () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
  sendWindowState();
});
ipcMain.on('window-close',     () => mainWindow?.close());
ipcMain.on('window-fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  sendWindowState();
});
ipcMain.on('window-reload', () => mainWindow?.webContents.reload());
ipcMain.on('open-external',    (_, url) => shell.openExternal(url));

ipcMain.handle('show-message-box', async (_, opts) => {
  return dialog.showMessageBox(mainWindow, opts);
});
ipcMain.handle('show-open-dialog', async (_, opts) => {
  return dialog.showOpenDialog(mainWindow, opts);
});

// ─── App-Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();

  try {
    await startServer();
  } catch (err) {
    if (splashWindow) splashWindow.destroy();
    dialog.showErrorBox('Startfehler', err.message);
    app.quit();
    return;
  }

  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && serverProcess.exitCode === null) {
    killPid(serverProcess.pid);
  }
  killFromPidFile(MULTIPLAYER_PID);
  // Cleanup
  try { fs.unlinkSync(SERVER_PID);  } catch {}
  try { fs.unlinkSync(SERVER_PORT); } catch {}
});

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});

// Abstürze abfangen
process.on('uncaughtException', err => {
  console.error('Uncaught:', err);
});
