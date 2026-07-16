// Faktisk Studio — Electron main process
// Hovedvindu laster src/index.html (Malside-hub). Pluginene ligger i
// plugins/<id>/index.html og navigeres til via window.location.

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { version: APP_VERSION, registryUrl: REGISTRY_URL } = require('./package.json');

// electron-updater lastes trygt (kraster ikke dev-mode hvis pakken mangler)
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('electron-updater ikke tilgjengelig:', e.message);
}

let mainWindow = null;

// Mappe for brukerinstallerte plugins (kan skrives til, sletteslves)
const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
// Mappe for innebygde plugins (read-only, kommer med .dmg)
const builtinPluginsDir = path.join(__dirname, 'plugins');
const registryCacheFile = path.join(app.getPath('userData'), 'registry-cache.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#9D9D9D',
    title: 'Faktisk Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // F4 sikkerhet: sandbox = true. Renderer + preload kan bare bruke Web APIs
      // og de eksplisitt eksponerte IPC-kanalene via contextBridge. Ingen direkte
      // Node-tilgang selv om plugin-kode skulle prøve. Preload-en vår er allerede
      // sandbox-kompatibel (bruker kun 'electron'-modulen som er tillatt).
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ============================================================
//  Auto-updater (electron-updater med GitHub Releases som feed)
// ============================================================

// Siste kjente updater-status. Renderer kan hente den når som helst.
let updaterState = { status: 'idle' };

function pushUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-state', updaterState);
  }
}

function setupAutoUpdater() {
  // Kjør kun i pakket app — dev-mode har ikke oppdaterings-metadata og ville feilet.
  if (!autoUpdater || !app.isPackaged) {
    updaterState = { status: 'dev-mode' };
    return;
  }

  autoUpdater.autoDownload = true;          // last ned automatisk når vi finner ny versjon
  autoUpdater.autoInstallOnAppQuit = true;  // installer ved neste avslutning hvis brukeren ikke restarter

  autoUpdater.on('checking-for-update', () => pushUpdaterState({ status: 'checking' }));
  autoUpdater.on('update-available', info => pushUpdaterState({ status: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => pushUpdaterState({ status: 'idle' }));
  autoUpdater.on('download-progress', p => pushUpdaterState({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', info => pushUpdaterState({ status: 'ready', version: info.version }));
  autoUpdater.on('error', err => {
    console.error('Auto-updater error:', err);
    pushUpdaterState({ status: 'error', message: err && err.message ? err.message : String(err) });
  });

  // Første sjekk 5 sek etter oppstart så vindu er klart til å motta events.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  // Periodisk sjekk hver 4. time.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

ipcMain.handle('updater-get-state', () => updaterState);

ipcMain.handle('updater-check', async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, error: 'Auto-updater ikke tilgjengelig i dev-mode' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('updater-quit-and-install', () => {
  if (autoUpdater && app.isPackaged) autoUpdater.quitAndInstall();
  return { ok: true };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
//  Plugin-skanning og navigering
// ============================================================

function scanPluginsDir(dir, sourceLabel) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const manifestPath = path.join(dir, d.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      found.push({
        id: d.name,
        source: sourceLabel,
        installPath: path.join(dir, d.name),
        ...manifest,
        entry: path.join(dir, d.name, manifest.entry || 'index.html'),
      });
    } catch (e) {
      console.error('Manifest-feil for', d.name, e);
    }
  }
  return found;
}

ipcMain.handle('list-plugins', async () => {
  const builtin = scanPluginsDir(builtinPluginsDir, 'builtin');
  const user = scanPluginsDir(userPluginsDir, 'user');
  const byId = new Map();
  for (const p of builtin) byId.set(p.id, p);
  for (const p of user) byId.set(p.id, p);
  return Array.from(byId.values());
});

ipcMain.handle('open-plugin', async (e, pluginId) => {
  // I dev (npm start) skal repo-versjonen alltid vinne over installerte
  // kopier i userData — ellers tester man gamle filer uten å vite det.
  // Dev-appen deler userData med den pakkede appen, så fellen er reell.
  const candidates = app.isPackaged
    ? [
        path.join(userPluginsDir, pluginId, 'index.html'),
        path.join(builtinPluginsDir, pluginId, 'index.html'),
      ]
    : [
        path.join(builtinPluginsDir, pluginId, 'index.html'),
        path.join(userPluginsDir, pluginId, 'index.html'),
      ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) return { ok: false, error: 'Plugin finnes ikke: ' + pluginId };
  mainWindow.loadFile(found);
  return { ok: true };
});

ipcMain.handle('go-home', async () => {
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  return { ok: true };
});

ipcMain.handle('copy-to-clipboard', async (e, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle('toggle-fullscreen', async () => {
  const isFull = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFull);
  return { ok: true, fullscreen: !isFull };
});

ipcMain.handle('save-dialog', async (e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, opts || {});
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-external', async (e, url) => {
  if (typeof url !== 'string') return { ok: false, error: 'Ugyldig URL' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Bare http(s) tillatt' };
  await shell.openExternal(url);
  return { ok: true };
});

// ============================================================
//  Arkivering — auto-restore state + navngitte prosjekter
// ============================================================

const dataDir = path.join(app.getPath('userData'), 'state');
const projectsDir = path.join(app.getPath('userData'), 'projects');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeId(s) {
  return String(s).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 100);
}

ipcMain.handle('state-save', async (e, pluginId, state) => {
  try {
    ensureDir(dataDir);
    const file = path.join(dataDir, safeId(pluginId) + '.json');
    const payload = { schemaVersion: 1, savedAt: new Date().toISOString(), state };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('state-load', async (e, pluginId) => {
  try {
    const file = path.join(dataDir, safeId(pluginId) + '.json');
    if (!fs.existsSync(file)) return { ok: true, state: null };
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { ok: true, state: payload.state || null, savedAt: payload.savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
//  Labrador-integrasjon: eget vindu med persistent session, delt fil-historikk
// ============================================================
const recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
const MAX_RECENT_FILES = 60;

function loadRecentFiles() {
  try {
    if (!fs.existsSync(recentFilesPath)) return [];
    return JSON.parse(fs.readFileSync(recentFilesPath, 'utf-8'));
  } catch (e) { return []; }
}
function saveRecentFiles(list) {
  try {
    fs.writeFileSync(recentFilesPath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {}
}

// Åpne Labrador i brukerens default nettleser — der brukeren allerede har
// aktiv Labrador-session. Innebygd Electron-vindu gir "Application error"
// uansett hvordan vi konfigurerer UA, session-partisjon og popup-håndtering
// (sannsynligvis pga Firebase-auth-begrensninger i Chromium fra Electron).
// Default URL: /settings/upload-file — Labrador redirect-er til login hvis
// ingen session, ellers direkte til upload-siden.
ipcMain.handle('open-labrador', async (e, urlIn) => {
  const target = urlIn || 'https://labrador.faktisk.no/settings/upload-file';
  if (typeof target !== 'string' || !/^https?:\/\/labrador\.faktisk\.no/i.test(target)) {
    return { ok: false, error: 'Bare labrador.faktisk.no-URL-er tillatt' };
  }
  await shell.openExternal(target);
  return { ok: true };
});

// ============================================================
//  Labrador filopplasting-API (gren: labrador-filer)
//
//  Endepunktene er de klassiske jQuery-sidene under /settings/ —
//  IKKE SPA-en (som krasjer i Electron). Verifisert 2026-07-16:
//    GET  /ajax/file-upload/list-files            → JSON {id:{name,url}}
//    POST /ajax/file-upload/upload-files          → multipart, felt "file"
//    GET  /ajax/file-upload/delete-file?id=<id>
//  Auth: sesjonskake. Brukeren logger inn i et eget Electron-vindu med
//  persistent partition, og main-prosessen sender kakene manuelt.
// ============================================================

const LABRADOR_ORIGIN = 'https://labrador.faktisk.no';
const LABRADOR_PARTITION = 'persist:labrador';

async function labradorCookieHeader() {
  const { session } = require('electron');
  const ses = session.fromPartition(LABRADOR_PARTITION);
  const cookies = await ses.cookies.get({ url: LABRADOR_ORIGIN });
  return cookies.map(c => c.name + '=' + c.value).join('; ');
}

function labradorRequest(path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise(async (resolve, reject) => {
    const cookie = await labradorCookieHeader();
    const req = https.request(LABRADOR_ORIGIN + path, {
      method,
      headers: Object.assign({ Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' }, headers),
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function labradorListFiles() {
  const res = await labradorRequest('/ajax/file-upload/list-files');
  if (res.status !== 200) return { ok: false, loggedIn: false, error: 'HTTP ' + res.status };
  try {
    const parsed = JSON.parse(res.body);
    const files = Object.entries(parsed)
      .map(([id, f]) => ({ id, name: f.name, url: f.url }))
      .sort((a, b) => Number(b.id) - Number(a.id)); // nyeste først
    return { ok: true, loggedIn: true, files };
  } catch (e) {
    // HTML i stedet for JSON = redirect til login = ikke innlogget
    return { ok: true, loggedIn: false, files: [] };
  }
}

let labradorLoginWin = null;

ipcMain.handle('labrador-status', async () => {
  try { return await labradorListFiles(); }
  catch (err) { return { ok: false, loggedIn: false, error: err.message }; }
});

ipcMain.handle('labrador-connect', async () => {
  if (labradorLoginWin && !labradorLoginWin.isDestroyed()) {
    labradorLoginWin.focus();
    return { ok: true, already: true };
  }
  return new Promise(resolve => {
    labradorLoginWin = new BrowserWindow({
      width: 1100, height: 800,
      parent: mainWindow || undefined,
      title: 'Logg inn på Labrador',
      webPreferences: { partition: LABRADOR_PARTITION, nodeIntegration: false, contextIsolation: true },
    });
    // Upload-siden er en klassisk server-rendret side og fungerer i Electron;
    // er brukeren ikke innlogget redirect-er Labrador til login først.
    labradorLoginWin.loadURL(LABRADOR_ORIGIN + '/settings/upload-file');
    // Når vinduet lukkes: sjekk om vi fikk gyldig session
    labradorLoginWin.on('closed', async () => {
      labradorLoginWin = null;
      try { resolve(await labradorListFiles()); }
      catch (err) { resolve({ ok: false, loggedIn: false, error: err.message }); }
    });
    // Auto-lukk når innlogging lykkes: sjekk session ved hver navigasjon
    labradorLoginWin.webContents.on('did-navigate', async () => {
      try {
        const st = await labradorListFiles();
        if (st.loggedIn && labradorLoginWin && !labradorLoginWin.isDestroyed()) {
          labradorLoginWin.close(); // trigger 'closed' → resolve
        }
      } catch (e) {}
    });
  });
});

ipcMain.handle('labrador-list-files', async () => {
  try { return await labradorListFiles(); }
  catch (err) { return { ok: false, loggedIn: false, error: err.message }; }
});

// Filvelger + opplasting i én operasjon. Returnerer URL-en til den nye fila
// ved å slå opp i list-files etterpå (upload-responsen er ikke dokumentert).
ipcMain.handle('labrador-upload', async (e, opts) => {
  const filters = (opts && opts.filters) || [
    { name: 'Medier', extensions: ['png', 'gif', 'jpg', 'jpeg', 'avif', 'heic', 'mp4', 'mpg', 'pdf'] },
  ];
  const pick = await dialog.showOpenDialog(mainWindow, {
    title: 'Velg fil som skal lastes opp til Labrador',
    properties: ['openFile'],
    filters,
  });
  if (pick.canceled || !pick.filePaths.length) return { ok: false, canceled: true };
  const filePath = pick.filePaths[0];
  const fileName = path.basename(filePath);
  const stat = fs.statSync(filePath);
  if (stat.size > 100 * 1024 * 1024) {
    return { ok: false, error: 'Fila er over 100 MB (Labradors grense).' };
  }

  const boundary = '----FaktiskStudio' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + fileName.replace(/"/g, '') + '"\r\n'
    + 'Content-Type: application/octet-stream\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, fs.readFileSync(filePath), tail]);

  try {
    const res = await labradorRequest('/ajax/file-upload/upload-files', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: 'Opplasting feilet (HTTP ' + res.status + ')' };
    }
    // Finn den nye fila i lista (matcher på navn, nyeste først)
    const list = await labradorListFiles();
    if (list.loggedIn) {
      const hit = list.files.find(f => f.name === fileName)
        || list.files.find(f => f.name.includes(fileName.replace(/\.[^.]+$/, '')));
      if (hit) return { ok: true, name: hit.name, url: hit.url, id: hit.id };
    }
    return { ok: true, name: fileName, url: null,
      note: 'Lastet opp, men fant ikke URL automatisk — sjekk «Mine filer».' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('recent-file-add', async (e, entry) => {
  try {
    if (!entry || !entry.url) return { ok: false, error: 'Mangler url' };
    let list = loadRecentFiles();
    // Fjern eksisterende oppføring med samme URL
    list = list.filter(x => x.url !== entry.url);
    list.unshift({
      url: entry.url,
      type: entry.type || guessType(entry.url),
      alt: entry.alt || '',
      addedAt: new Date().toISOString(),
      pluginId: entry.pluginId || null,
    });
    if (list.length > MAX_RECENT_FILES) list = list.slice(0, MAX_RECENT_FILES);
    saveRecentFiles(list);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('recent-file-list', async (e, opts) => {
  const list = loadRecentFiles();
  const type = opts && opts.type;
  const limit = (opts && opts.limit) || 24;
  const filtered = type ? list.filter(x => x.type === type) : list;
  return { ok: true, files: filtered.slice(0, limit) };
});
ipcMain.handle('recent-file-remove', async (e, url) => {
  const list = loadRecentFiles().filter(x => x.url !== url);
  saveRecentFiles(list);
  return { ok: true };
});
ipcMain.handle('recent-file-clear', async () => {
  saveRecentFiles([]);
  return { ok: true };
});

function guessType(url) {
  const u = String(url).toLowerCase().split('?')[0];
  if (/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)$/i.test(u)) return 'image';
  if (/\.(mp4|mov|webm|m4v|avi)$/i.test(u)) return 'video';
  if (u.includes('player.mux.com')) return 'video';
  if (/\.(mp3|wav|m4a|ogg)$/i.test(u)) return 'audio';
  return 'other';
}

// Sletter auto-save-state for én plugin. Etterlater LAGREDE prosjekter (project-list) urørt.
ipcMain.handle('state-clear', async (e, pluginId) => {
  try {
    const file = path.join(dataDir, safeId(pluginId) + '.json');
    if (fs.existsSync(file)) fs.rmSync(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-save', async (e, pluginId, name, state) => {
  try {
    if (!name || !name.trim()) return { ok: false, error: 'Mangler navn' };
    const dir = path.join(projectsDir, safeId(pluginId));
    ensureDir(dir);
    const file = path.join(dir, safeId(name) + '.json');
    const payload = {
      schemaVersion: 1,
      name: name.trim(),
      pluginId,
      savedAt: new Date().toISOString(),
      state,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true, name: name.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-list', async (e, pluginId) => {
  try {
    const results = [];
    const scan = (dir, plugin) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          results.push({
            pluginId: plugin,
            fileId: f.replace(/\.json$/, ''),
            name: payload.name || f.replace(/\.json$/, ''),
            savedAt: payload.savedAt,
          });
        } catch (e) {}
      }
    };
    if (pluginId) {
      scan(path.join(projectsDir, safeId(pluginId)), pluginId);
    } else if (fs.existsSync(projectsDir)) {
      for (const sub of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (sub.isDirectory()) scan(path.join(projectsDir, sub.name), sub.name);
      }
    }
    results.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    return { ok: true, projects: results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-load', async (e, pluginId, fileId) => {
  try {
    const file = path.join(projectsDir, safeId(pluginId), safeId(fileId) + '.json');
    if (!fs.existsSync(file)) return { ok: false, error: 'Prosjektet finnes ikke' };
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { ok: true, name: payload.name, state: payload.state, savedAt: payload.savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-delete', async (e, pluginId, fileId) => {
  try {
    const file = path.join(projectsDir, safeId(pluginId), safeId(fileId) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
//  Video-export og thumbnail (ffmpeg)
// ============================================================

function findFfmpeg() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) {
      const unpackedPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedPath)) return unpackedPath;
      if (fs.existsSync(ffmpegStatic)) return ffmpegStatic;
    }
  } catch (e) {
    console.error('ffmpeg-static ikke tilgjengelig:', e.message);
  }
  return 'ffmpeg';
}

function checkFfmpeg() {
  return new Promise(resolve => {
    const proc = spawn(findFfmpeg(), ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', code => resolve(code === 0));
  });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadToFile(response.headers.location, dest).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + response.statusCode + ' ved nedlasting av video'));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlinkSync(dest); reject(err); });
    }).on('error', err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const downloadCache = new Map();

async function ensureDownloaded(url) {
  if (downloadCache.has(url)) {
    const cached = downloadCache.get(url);
    if (fs.existsSync(cached)) return cached;
    downloadCache.delete(url);
  }
  const filepath = path.join(app.getPath('temp'), 'fs-cache-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4');
  await downloadToFile(url, filepath);
  downloadCache.set(url, filepath);
  return filepath;
}

app.on('before-quit', () => {
  for (const filepath of downloadCache.values()) {
    try { fs.unlinkSync(filepath); } catch (e) {}
  }
});

ipcMain.handle('video-export', async (e, opts) => {
  const { url, trimStart, trimEnd, savePath, quality } = opts || {};
  if (!url || typeof trimStart !== 'number' || typeof trimEnd !== 'number' || !savePath) {
    return { ok: false, error: 'Mangler url, trimStart, trimEnd eller savePath' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  }

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('video-export-progress', msg); } catch (e) {}
  };

  let tmpInput;
  try {
    send({ phase: 'downloading', percent: 0 });
    tmpInput = await ensureDownloaded(url);
    send({ phase: 'downloading', percent: 100 });
  } catch (err) {
    return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
  }

  const qmap = {
    '1080': { maxHeight: 1080, crf: 22 },
    '720':  { maxHeight: 720,  crf: 23 },
    '480':  { maxHeight: 480,  crf: 25 },
  };
  const q = qmap[quality] || qmap['1080'];
  const duration = trimEnd - trimStart;

  const args = [
    '-ss', String(trimStart),
    '-i', tmpInput,
    '-t', String(duration),
    '-vf', `scale=-2:'min(${q.maxHeight},ih)'`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    '-y',
    savePath,
  ];

  try {
    await new Promise((resolve, reject) => {
      send({ phase: 'encoding', percent: 0 });
      const ff = spawn(findFfmpeg(), args);
      let stderr = '';
      ff.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          const percent = Math.min(100, Math.round((t / duration) * 100));
          send({ phase: 'encoding', percent });
        }
      });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: ' + stderr.split('\n').slice(-3).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return { ok: true, savePath };
});

// Videosensur: blur-masker med keyframe-spor rendres inn i videoen.
// Filtergrafen bygges i src/censor-filter.js (ren modul, enhetstestbar).
// Kvalitet: CRF 17 + samme oppløsning/fps som kilden, lyd kopieres bit-for-bit.
ipcMain.handle('censor-export', async (e, opts) => {
  const { url, inputPath, savePath, duration, masks, trimStart, trimEnd } = opts || {};
  // Utsnitt: -ss før -i (rask, nøyaktig seek ved re-encoding) nullstiller
  // tidsstemplene, så maskenes keyframe-tider forskyves tilsvarende.
  const ts = (typeof trimStart === 'number' && trimStart > 0.01) ? trimStart : 0;
  const te = (typeof trimEnd === 'number' && trimEnd > ts + 0.1) ? trimEnd : null;
  const hasTrim = ts > 0 || te !== null;
  const maskList = Array.isArray(masks) ? masks : [];
  if ((!url && !inputPath) || !savePath || (!maskList.length && !hasTrim)) {
    return { ok: false, error: 'Mangler kilde (url/inputPath), savePath eller masker/utsnitt' };
  }
  const shiftedMasks = maskList.map(m => Object.assign({}, m, {
    keyframes: (m.keyframes || []).map(k => Object.assign({}, k, { t: k.t - ts })),
  }));

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  }

  let graph = null, outLabel = null;
  if (shiftedMasks.length) {
    try {
      const cfPath = require.resolve('./src/censor-filter.js');
      // I dev-modus: tøm require-cachen så endringer i filtergraf-modulen
      // plukkes opp uten app-restart (cachen bet oss under utviklingen).
      if (!app.isPackaged) delete require.cache[cfPath];
      ({ graph, outLabel } = require(cfPath).buildCensorFilter(shiftedMasks));
      if (!app.isPackaged) {
        console.log('[censor-export] former:', shiftedMasks.map(m => m.shape || 'rect').join(', '),
          hasTrim ? `· utsnitt ${ts}s–${te || 'slutt'}` : '');
        console.log('[censor-export] graf (første 300 tegn):', graph.slice(0, 300));
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('censor-export-progress', msg); } catch (e) {}
  };

  let input = inputPath;
  if (!input || !fs.existsSync(input)) {
    try {
      send({ phase: 'downloading', percent: 0 });
      input = await ensureDownloaded(url);
      send({ phase: 'downloading', percent: 100 });
    } catch (err) {
      return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
    }
  }

  const args = [
    ...(ts > 0 ? ['-ss', String(ts)] : []),
    '-i', input,
    ...(te !== null ? ['-t', String(te - ts)] : []),
    ...(graph
      ? ['-filter_complex', graph, '-map', outLabel]
      : ['-map', '0:v']),
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y',
    savePath,
  ];

  const totalDur = (typeof duration === 'number' && duration > 0) ? duration : 0;

  try {
    await new Promise((resolve, reject) => {
      send({ phase: 'encoding', percent: 0 });
      const ff = spawn(findFfmpeg(), args);
      let stderr = '';
      ff.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        if (totalDur) {
          const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (m) {
            const t = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
            send({ phase: 'encoding', percent: Math.min(100, Math.round((t / totalDur) * 100)) });
          }
        }
      });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: ' + stderr.split('\n').slice(-3).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return { ok: true, savePath };
});

// Motiv-tracking: følger et markert område gjennom klippet via
// template-matching på nedskalerte gråtonebilder (src/censor-track.js).
// Alt kjører lokalt — ingen ML-modeller, ingen nettverkskall.
ipcMain.handle('censor-track', async (e, opts) => {
  const { url, inputPath, from, to, x, y, w, h, videoW, videoH } = opts || {};
  if ((!url && !inputPath) || typeof from !== 'number' || typeof to !== 'number'
      || to - from < 0.3 || !videoW || !videoH) {
    return { ok: false, error: 'Ugyldige tracking-parametre' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('censor-track-progress', msg); } catch (e) {}
  };

  let input = inputPath;
  if (!input || !fs.existsSync(input)) {
    try {
      send({ phase: 'downloading', percent: 0 });
      input = await ensureDownloaded(url);
    } catch (err) {
      return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
    }
  }

  // Nedskalert analyse: ~480px bredde og 5 fps holder for maskebaner,
  // og gjør både ffmpeg-dekoding og matching rask.
  const FPS = 5;
  const sw = Math.min(480, videoW);
  const scale = sw / videoW;
  const sh = Math.max(2, 2 * Math.round((videoH * scale) / 2));
  const span = to - from;

  const args = [
    '-ss', String(Math.max(0, from)),
    '-i', input,
    '-t', String(span + 0.3),
    '-vf', `fps=${FPS},scale=${sw}:${sh}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1',
  ];

  let raw;
  try {
    raw = await new Promise((resolve, reject) => {
      send({ phase: 'decoding', percent: 0 });
      const ff = spawn(findFfmpeg(), args);
      const chunks = [];
      let bytes = 0;
      const expected = Math.max(1, Math.ceil(span * FPS)) * sw * sh;
      ff.stdout.on('data', c => {
        chunks.push(c);
        bytes += c.length;
        send({ phase: 'decoding', percent: Math.min(99, Math.round((bytes / expected) * 100)) });
      });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error('ffmpeg feilet (kode ' + code + ')'));
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const nFrames = Math.floor(raw.length / (sw * sh));
  if (nFrames < 2) return { ok: false, error: 'For få bilder å spore over' };

  try {
    const { trackRegion, simplifyPath } = require('./src/censor-track.js');
    send({ phase: 'tracking', percent: 0 });
    const res = trackRegion(raw, sw, sh, nFrames, {
      x: x * scale, y: y * scale, w: w * scale, h: h * scale,
    });
    // Forenkle banen (2px toleranse i analyseoppløsning) og skaler tilbake
    const simplified = simplifyPath(res.path, 2);
    const keyframes = simplified.map(p => ({
      t: Math.round((from + p.i / FPS) * 10) / 10,
      x: Math.round(p.x / scale),
      y: Math.round(p.y / scale),
    }));
    send({ phase: 'done', percent: 100 });
    return {
      ok: true,
      keyframes,
      stoppedEarly: res.stoppedEarly,
      trackedTo: from + (res.path[res.path.length - 1].i / FPS),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('generate-thumbnail', async (e, opts) => {
  const { url, atTime } = opts || {};
  if (!url || typeof atTime !== 'number') {
    return { ok: false, error: 'Mangler url eller atTime' };
  }
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };

  let tmpInput;
  try {
    tmpInput = await ensureDownloaded(url);
  } catch (err) {
    return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
  }

  const tmpOutput = path.join(app.getPath('temp'), 'fs-thumb-' + Date.now() + '.jpg');
  try {
    await new Promise((resolve, reject) => {
      // -ss ETTER -i: nøyaktig frame ved atTime (slow seek). -ss FØR -i ville
      // gitt nærmeste keyframe — kunne være flere sekunder unna ønsket tid.
      // For thumbnail er nøyaktighet viktigere enn hastighet siden vi bare
      // gjør det én gang per URL+tid.
      const args = [
        '-i', tmpInput,
        '-ss', String(atTime),
        '-frames:v', '1',
        '-vf', 'scale=800:-2',
        '-q:v', '4',
        '-y',
        tmpOutput,
      ];
      const ff = spawn(findFfmpeg(), args);
      let stderr = '';
      ff.stderr.on('data', chunk => { stderr += chunk.toString(); });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg feilet: ' + stderr.split('\n').slice(-2).join(' | ')));
      });
    });
    const bytes = fs.readFileSync(tmpOutput);
    const sizeKb = (bytes.length / 1024).toFixed(1);
    const dataUrl = 'data:image/jpeg;base64,' + bytes.toString('base64');
    try { fs.unlinkSync(tmpOutput); } catch (e) {}
    return { ok: true, dataUrl, sizeKb };
  } catch (err) {
    try { fs.unlinkSync(tmpOutput); } catch (e) {}
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('reveal-in-finder', async (e, filePath) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

ipcMain.handle('plugin-status', async () => {
  const installed = [
    ...scanPluginsDir(builtinPluginsDir, 'builtin'),
    ...scanPluginsDir(userPluginsDir, 'user'),
  ];
  const byId = new Map();
  for (const p of installed) {
    if (!byId.has(p.id) || p.source === 'user') byId.set(p.id, p);
  }
  return Array.from(byId.values()).map(p => ({
    id: p.id, name: p.name, version: p.version, source: p.source,
  }));
});

// ============================================================
//  Plugin-registry og auto-update
// ============================================================

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FaktiskStudio/' + APP_VERSION } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetJson(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' fra ' + url));
      }
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Henter bytes (Buffer) — brukes for sha256-verifisering av plugin-bundles
// før innhold parses og installeres. F4 fra kodegjennomgangen.
function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FaktiskStudio/' + APP_VERSION } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' fra ' + url));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

ipcMain.handle('registry-fetch', async (e, force) => {
  try {
    const now = Date.now();
    if (!force && fs.existsSync(registryCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(registryCacheFile, 'utf-8'));
        if (cache.cachedAt && now - cache.cachedAt < 30 * 60 * 1000) {
          return { ok: true, registry: cache.registry, fromCache: true };
        }
      } catch (e) {}
    }
    if (!REGISTRY_URL) return { ok: false, error: 'Ingen registry-URL konfigurert' };
    // Cache-buster: GitHub raw CDN cacher ~5 min etter push. Med ?t= får
    // brukeren alltid fresh registry når de klikker "Sjekk på nytt".
    const cacheBuster = REGISTRY_URL + (REGISTRY_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
    const registry = await httpGetJson(cacheBuster);
    fs.writeFileSync(registryCacheFile, JSON.stringify({ cachedAt: now, registry }, null, 2), 'utf-8');
    return { ok: true, registry, fromCache: false };
  } catch (err) {
    if (fs.existsSync(registryCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(registryCacheFile, 'utf-8'));
        return { ok: true, registry: cache.registry, fromCache: true, stale: true, fetchError: err.message };
      } catch (e) {}
    }
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plugin-install', async (e, pluginEntry) => {
  try {
    if (!pluginEntry || !pluginEntry.id || !pluginEntry.bundleUrl) {
      return { ok: false, error: 'Mangler plugin-id eller bundleUrl' };
    }
    if (pluginEntry.minStudioVersion && compareVersions(APP_VERSION, pluginEntry.minStudioVersion) < 0) {
      return { ok: false, error: 'Pluginen krever Faktisk Studio ' + pluginEntry.minStudioVersion + ' eller nyere — du har ' + APP_VERSION };
    }
    // Hent bundle som Buffer så vi kan sha256-verifisere før parsing.
    // F4 — tamper-detektering: hvis registry har sha256, må den matche eksakt.
    const bundleBuf = await httpGetBuffer(pluginEntry.bundleUrl);
    if (pluginEntry.sha256) {
      const actualHash = crypto.createHash('sha256').update(bundleBuf).digest('hex');
      if (actualHash !== pluginEntry.sha256) {
        return {
          ok: false,
          error: 'Sikkerhetsfeil: bundle-hash matcher ikke registry.\n' +
                 'Forventet: ' + pluginEntry.sha256.slice(0, 16) + '...\n' +
                 'Faktisk:   ' + actualHash.slice(0, 16) + '...\n' +
                 'Bundle kan være tuklet med — installasjon avvist.'
        };
      }
    }
    let bundle;
    try {
      bundle = JSON.parse(bundleBuf.toString('utf-8'));
    } catch (e) {
      return { ok: false, error: 'Bundle er ugyldig JSON: ' + e.message };
    }
    if (!bundle || typeof bundle !== 'object') {
      return { ok: false, error: 'Bundle har ugyldig format' };
    }
    const safePluginId = safeId(pluginEntry.id);
    const installPath = path.join(userPluginsDir, safePluginId);
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }
    fs.mkdirSync(installPath, { recursive: true });
    for (const [filename, content] of Object.entries(bundle)) {
      if (typeof filename !== 'string' || !/^[a-zA-Z0-9._/\-]+$/.test(filename) || filename.includes('..')) {
        return { ok: false, error: 'Ugyldig filnavn i bundle: ' + filename };
      }
      const target = path.join(installPath, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(content), 'utf-8');
    }
    return { ok: true, installedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plugin-uninstall', async (e, pluginId) => {
  try {
    const installPath = path.join(userPluginsDir, safeId(pluginId));
    if (!fs.existsSync(installPath)) {
      return { ok: false, error: 'Pluginen er ikke installert (brukerversjon)' };
    }
    fs.rmSync(installPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app-version', async () => APP_VERSION);
