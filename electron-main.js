'use strict';
/**
 * MediaCenter – Electron-Hauptprozess.
 *
 * Der Medien-/Spieleserver (HTTP + WebSocket) läuft direkt in diesem Prozess
 * (Node.js) – es wird weder Python noch ein separates Node benötigt.
 *
 * Portabilität: Alle Daten (Medien, Metadaten, Spielstände, Browser-Speicher)
 * liegen im Ordner "MediaCenter-Daten" direkt neben der .exe / .AppImage.
 *
 * Start ohne Fenster (nur Server, z.B. auf einem Heim-PC):  MediaCenter --server
 */

const { app, BrowserWindow, shell, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');

const HEADLESS = process.argv.includes('--server') || process.argv.includes('--headless');
const DATA_FOLDER_NAME = 'MediaCenter-Daten';


// ─── Pfade ──────────────────────────────────────────────────────────────────
const APP_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, 'app');

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test-' + process.pid);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Ordner, in dem die portable App liegt (USB-Stick etc.). */
function portableBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR; // Windows portable .exe
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);                // Linux AppImage
  return path.dirname(process.execPath);                                              // entpackter Build
}

function resolveDataDir() {
  if (process.env.MEDIACENTER_DATA_DIR) return { dir: path.resolve(process.env.MEDIACENTER_DATA_DIR), portable: true };
  if (!app.isPackaged) return { dir: APP_DIR, portable: true }; // Entwicklung: Daten wie bisher unter app/
  const portableDir = path.join(portableBaseDir(), DATA_FOLDER_NAME);
  if (isWritableDir(portableDir)) return { dir: portableDir, portable: true };
  // Fallback (z.B. schreibgeschützter Datenträger): Benutzerprofil
  return { dir: path.join(app.getPath('appData'), 'MediaCenter', DATA_FOLDER_NAME), portable: false };
}

const DATA = resolveDataDir();
const DATA_DIR = DATA.dir;
fs.mkdirSync(DATA_DIR, { recursive: true });

if (HEADLESS) {
  // Reiner Server-Betrieb ohne Fenster und ohne Display (z.B. Heimserver):
  // Die mitgelieferte Electron-Runtime läuft dafür als reines Node.js.
  const { spawnSync } = require('child_process');
  const cli = path.join(__dirname, 'server', 'cli.js');
  const passArgs = process.argv.slice(1).filter(a => a.startsWith('--port') || /^\d+$/.test(a));
  const res = spawnSync(process.execPath, [cli, '--app', APP_DIR, '--data', DATA_DIR, ...passArgs], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    windowsHide: false,
  });
  process.exit(res.status == null ? 0 : res.status);
}

// Browser-Speicher (localStorage, IndexedDB, Cache) ebenfalls portabel ablegen
const PROFILE_DIR = path.join(DATA_DIR, '.profil');
app.setPath('userData', PROFILE_DIR);
app.setPath('sessionData', PROFILE_DIR);
try { app.setPath('crashDumps', path.join(PROFILE_DIR, 'crashes')); } catch { /* ältere Electron-Versionen */ }

const APP_ICON = [path.join(APP_DIR, 'images', 'icons', 'icon-512.png'), path.join(APP_DIR, 'images', 'icons', 'icon.ico')]
  .find(p => fs.existsSync(p));

const LOG_FILE = path.join(PROFILE_DIR, 'server.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  if (HEADLESS || !app.isPackaged) process.stdout.write(line);
  fs.appendFile(LOG_FILE, line, () => {});
}

// ─── Globale Referenzen ─────────────────────────────────────────────────────
let mainWindow = null;
let mediaServer = null;
let serverPort = 0;

if (!HEADLESS && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// ─── Fensterzustand merken ──────────────────────────────────────────────────
const WINDOW_STATE_FILE = path.join(PROFILE_DIR, 'window.json');
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
  } catch {
    return { width: 1440, height: 900, maximized: false };
  }
}
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getNormalBounds();
  const state = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: mainWindow.isMaximized() };
  try { fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state)); } catch { /* ignore */ }
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window-state', {
    maximized: mainWindow.isMaximized(),
    fullscreen: mainWindow.isFullScreen(),
  });
}

// ─── Server ─────────────────────────────────────────────────────────────────
async function startServer() {
  const { createMediaServer } = require('./server');
  const prefs = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, 'prefs.json'), 'utf8')); } catch { return {}; }
  })();
  const envPort = parseInt(process.env.MEDIACENTER_PORT, 10);
  mediaServer = createMediaServer({
    appDir: APP_DIR,
    dataDir: DATA_DIR,
    port: envPort || prefs.port || 8080,
    host: '0.0.0.0',
    portable: DATA.portable,
    log,
  });
  serverPort = await mediaServer.start();
  log(`Server läuft auf Port ${serverPort} – Daten: ${DATA_DIR}`);
  // Port merken: Gleicher Port = gleiche Browser-Origin = localStorage bleibt erhalten
  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROFILE_DIR, 'prefs.json'), JSON.stringify(Object.assign(prefs, { port: serverPort })));
  } catch { /* ignore */ }
  return serverPort;
}

function isAppUrl(url) {
  return url.startsWith(`http://127.0.0.1:${serverPort}/`) || url.startsWith(`http://localhost:${serverPort}/`);
}

// ─── Hauptfenster ───────────────────────────────────────────────────────────
function createMainWindow() {
  const ws = loadWindowState();
  mainWindow = new BrowserWindow({
    x: ws.x, y: ws.y,
    width: Math.max(ws.width || 1440, 900),
    height: Math.max(ws.height || 900, 600),
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MediaCenter',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#06080F',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // eigene Seiten (YouTube, Instagram …) laufen in einer abgeschotteten Browser-Ansicht
      spellcheck: false,
      backgroundThrottling: false, // Musik & LAN-Spiele laufen im Hintergrund weiter
      autoplayPolicy: 'no-user-gesture-required', // Musik/Visualizer starten ohne Extra-Klick
    },
  });
  if (ws.maximized) mainWindow.maximize();

  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  } else {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Ansicht', submenu: [
        { label: 'DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { label: 'Neu laden', accelerator: 'F5', click: () => mainWindow.reload() },
      ] },
    ]));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('Renderer beendet: ' + details.reason);
    if (details.reason !== 'clean-exit') setTimeout(() => mainWindow && mainWindow.reload(), 500);
  });

  mainWindow.webContents.on('did-finish-load', sendWindowState);
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});

  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) mainWindow.on(ev, sendWindowState);
  let saveTimer = null;
  const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWindowState, 400); };
  mainWindow.on('resize', queueSave);
  mainWindow.on('move', queueSave);
  mainWindow.on('close', saveWindowState);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/?desktop=1`);
}

// ─── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('server-port', () => serverPort);
ipcMain.handle('app-platform', () => process.platform);
ipcMain.handle('data-dir', () => ({ path: DATA_DIR, portable: DATA.portable }));
ipcMain.handle('window-state', () => ({
  maximized: mainWindow ? mainWindow.isMaximized() : false,
  fullscreen: mainWindow ? mainWindow.isFullScreen() : false,
}));

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  sendWindowState();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('window-fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  sendWindowState();
});
ipcMain.on('window-set-fullscreen', (_, on) => {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen() !== !!on) mainWindow.setFullScreen(!!on);
  sendWindowState();
});
ipcMain.on('window-reload', () => mainWindow?.webContents.reload());
ipcMain.on('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});
ipcMain.on('open-data-dir', (_, sub) => {
  const allowed = ['', 'media', 'media/Movies', 'media/Series', 'media/Music', 'media/Images'];
  const rel = allowed.includes(sub) ? sub : '';
  const dir = path.join(DATA_DIR, rel);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

ipcMain.handle('show-message-box', (_, opts) => dialog.showMessageBox(mainWindow, opts));
ipcMain.handle('show-open-dialog', (_, opts) => dialog.showOpenDialog(mainWindow, opts));

// ─── Eigene Seiten: abgeschottete Browser-Ansicht (<webview>) ─────────────────
const WEB_PARTITION = 'persist:web';
app.on('web-contents-created', (_e, contents) => {
  // Nur die Hauptoberfläche darf Browser-Ansichten anlegen – und nur mit sicheren Einstellungen
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params.src || 'about:blank';
    if (!isAppUrl(contents.getURL()) || !(/^https?:\/\//i.test(src) || src === 'about:blank')) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    params.partition = WEB_PARTITION;
    delete params.preload;
  });
  if (contents.getType() !== 'webview') return;
  // Links mit target=_blank in derselben Ansicht öffnen statt neuer Fenster
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) contents.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!/^(https?:|about:blank)/i.test(url)) event.preventDefault();
  });
});

function setupWebSession() {
  const ses = session.fromPartition(WEB_PARTITION);
  // Ohne „Electron“ im User-Agent – manche Seiten (z. B. WhatsApp Web) sperren sonst den Zugriff
  ses.setUserAgent(app.userAgentFallback.replace(/\s*(Electron|MediaCenter|mediacenter)\/\S+/g, ''));
  // Fremde Seiten: Vollbild (Videos) und Kopieren erlauben, Kamera/Mikrofon/Standort usw. nicht
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(['fullscreen', 'clipboard-sanitized-write'].includes(permission)));
}

// ─── Lebenszyklus ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Mikrofon (Voice-Chat) und Vollbild nur für die eigene App erlauben
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const own = isAppUrl(details.requestingUrl || wc.getURL());
    cb(own && ['media', 'fullscreen', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  });

  setupWebSession();

  try {
    await startServer();
  } catch (err) {
    log('Startfehler: ' + err.stack);
    if (HEADLESS) { console.error(err); app.exit(1); return; }
    dialog.showErrorBox('MediaCenter – Startfehler', 'Der interne Server konnte nicht gestartet werden:\n\n' + err.message);
    app.quit();
    return;
  }

  if (HEADLESS) {
    const { rankedLanAddresses } = require('./server/util');
    console.log(`MediaCenter-Server läuft: http://localhost:${serverPort}/`);
    for (const a of await rankedLanAddresses()) console.log(`  LAN: http://${a.address}:${serverPort}/`);
    console.log(`  Daten: ${DATA_DIR}`);
    return;
  }

  if (!DATA.portable) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'MediaCenter',
      message: 'Der Ordner neben der App ist schreibgeschützt.',
      detail: 'Daten werden stattdessen hier gespeichert:\n' + DATA_DIR,
    });
  }
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (HEADLESS) return;
  app.quit();
});

let quitting = false;
app.on('before-quit', event => {
  if (quitting || !mediaServer) return;
  quitting = true;
  event.preventDefault();
  const done = () => app.exit(0);
  mediaServer.close().then(done, done);
  setTimeout(done, 1500);
});

app.on('activate', () => {
  if (!HEADLESS && mainWindow === null && serverPort) createMainWindow();
});

process.on('uncaughtException', err => log('Uncaught: ' + (err.stack || err.message)));
process.on('unhandledRejection', err => log('Unhandled: ' + (err && err.stack || err)));
