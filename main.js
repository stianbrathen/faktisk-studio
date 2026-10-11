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

// Labradors LABSESSID er en session-cookie (uten utløpsdato) — Electron
// lagrer bare varige cookies på disk, så innloggingen forsvant ved hver
// app-restart. Etter vellykket innlogging skriver vi kaken tilbake med
// 30 dagers utløp, så sesjonen overlever restart (så lenge serveren godtar den).
async function persistLabradorSession() {
  const { session } = require('electron');
  const ses = session.fromPartition(LABRADOR_PARTITION);
  const cookies = await ses.cookies.get({ url: LABRADOR_ORIGIN });
  for (const c of cookies) {
    if (c.session) {
      try {
        await ses.cookies.set({
          url: LABRADOR_ORIGIN,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          secure: true,
          httpOnly: c.httpOnly,
          expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        });
      } catch (e) { console.warn('Kunne ikke persistere cookie', c.name, e.message); }
    }
  }
  try { await ses.cookies.flushStore(); } catch (e) {}
}

async function labradorListFiles() {
  const res = await labradorRequest('/ajax/file-upload/list-files');
  // 302 = redirect til login = ikke innlogget (ikke en feil)
  if (res.status === 301 || res.status === 302) return { ok: true, loggedIn: false, files: [] };
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
    // NB: /settings/upload-file svarer HTTP 500 («Application error») uten
    // gyldig session — den redirecter IKKE til login. Gå via login-siden
    // direkte; did-navigate-sjekken under lukker vinduet når sesjonen er inne.
    labradorLoginWin.loadURL(LABRADOR_ORIGIN + '/login/index');
    // Når vinduet lukkes: sjekk om vi fikk gyldig session
    labradorLoginWin.on('closed', async () => {
      labradorLoginWin = null;
      try { resolve(await labradorListFiles()); }
      catch (err) { resolve({ ok: false, loggedIn: false, error: err.message }); }
    });
    // Skjul vinduet straks navigasjonen forlater login-flyten — ellers
    // blinker Labradors landingsside (fillista) et øyeblikk før lukking,
    // og det ser ut som noe er galt.
    labradorLoginWin.webContents.on('did-start-navigation', (ev2, navUrl, isInPlace, isMainFrame) => {
      if (!isMainFrame || !navUrl) return;
      const inLoginFlow = /\/login/i.test(navUrl) || /accounts\.google|gstatic|googleapis/i.test(navUrl);
      if (!inLoginFlow && labradorLoginWin && !labradorLoginWin.isDestroyed()) {
        try { labradorLoginWin.hide(); } catch (e) {}
      }
    });
    // Auto-lukk når innlogging lykkes: sjekk session ved hver navigasjon
    labradorLoginWin.webContents.on('did-navigate', async () => {
      try {
        const st = await labradorListFiles();
        if (st.loggedIn) {
          await persistLabradorSession(); // overlev app-restart
          if (labradorLoginWin && !labradorLoginWin.isDestroyed()) {
            labradorLoginWin.close(); // trigger 'closed' → resolve
          }
        } else if (labradorLoginWin && !labradorLoginWin.isDestroyed()
            && !labradorLoginWin.isVisible()) {
          // Skjult, men fortsatt ikke innlogget (uventet redirect) — vis igjen
          labradorLoginWin.show();
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
  // Vask filnavnet: «%» gir URL-dekodings-404 hos Labrador (filnavn med
  // bokstavelig %20 tolkes som mellomrom når URL-en hentes). Behold
  // norske tegn, bytt ut resten av det eksotiske med bindestrek.
  const fileName = path.basename(filePath)
    .replace(/%[0-9a-fA-F]{2}/g, ' ')
    .replace(/%/g, '')
    .replace(/[^\w.æøåÆØÅéÉèÈüÜöÖäÄ ()-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const stat = fs.statSync(filePath);
  if (stat.size > 100 * 1024 * 1024) {
    return { ok: false, error: 'Fila er over 100 MB (Labradors grense).' };
  }

  // Labrador ser på Content-Type, ikke bare filendelsen. Med
  // application/octet-stream for alt ble .mov stille forkastet — serveren
  // svarte 200, men fila dukket aldri opp i lista.
  const MIME_BY_EXT = {
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.webm': 'video/webm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.pdf': 'application/pdf',
  };
  const mimeType = MIME_BY_EXT[path.extname(fileName).toLowerCase()] || 'application/octet-stream';

  const boundary = '----FaktiskStudio' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + fileName.replace(/"/g, '') + '"\r\n'
    + 'Content-Type: ' + mimeType + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, fs.readFileSync(filePath), tail]);

  // Strøm kroppen i biter og meld fremdrift — store videoer tar tid,
  // og uten indikator tror redaktøren at ingenting skjer.
  const sendProgress = msg => {
    try { mainWindow && mainWindow.webContents.send('labrador-upload-progress', msg); } catch (e) {}
  };
  const streamUpload = () => new Promise(async (resolve, reject) => {
    const cookie = await labradorCookieHeader();
    const req = https.request(LABRADOR_ORIGIN + '/ajax/file-upload/upload-files', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    const CHUNK = 256 * 1024;
    let offset = 0;
    const writeNext = () => {
      while (offset < body.length) {
        const end = Math.min(offset + CHUNK, body.length);
        const ok = req.write(body.slice(offset, end));
        offset = end;
        sendProgress({
          percent: Math.round((offset / body.length) * 100),
          sentMB: (offset / 1048576).toFixed(1),
          totalMB: (body.length / 1048576).toFixed(1),
        });
        if (!ok) { req.once('drain', writeNext); return; }
      }
      req.end();
    };
    writeNext();
  });

  try {
    sendProgress({ percent: 0, sentMB: '0.0', totalMB: (body.length / 1048576).toFixed(1) });
    const res = await streamUpload();
    if (res.status === 301 || res.status === 302) {
      return { ok: false, loggedIn: false,
        error: 'Ikke innlogget i Labrador. Åpne «Mine filer ▾» og trykk «Koble til Labrador…» først.' };
    }
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
    // Serveren svarte 200, men fila er ikke i lista. Logg hva Labrador
    // faktisk svarte — uten det er dette umulig å feilsøke.
    console.warn('[labrador-upload] Fil ikke funnet etter opplasting.',
      '\n  filnavn:', fileName,
      '\n  MIME:', mimeType,
      '\n  størrelse:', (stat.size / 1048576).toFixed(1), 'MB',
      '\n  HTTP:', res.status,
      '\n  svar:', String(res.body).slice(0, 500));
    return { ok: false, name: fileName,
      error: 'Labrador svarte OK, men fila dukket ikke opp i lista. '
        + 'Se konsollen (Vis → Utviklerverktøy) for serverens svar.',
      debug: { status: res.status, body: String(res.body).slice(0, 500), mimeType, sizeMB: (stat.size / 1048576).toFixed(1) } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Vasket filnavn for Labrador-opplasting (bokstavelig %XX gir 404 ved henting)
function labradorSafeName(name) {
  return String(name)
    .replace(/%[0-9a-fA-F]{2}/g, ' ')
    .replace(/%/g, '')
    .replace(/[^\w.æøåÆØÅéÉèÈüÜöÖäÄ ()-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Enkel buffer-opplasting (små filer, ingen fremdrift). Returnerer URL
// ved å slå opp i list-files etterpå.
async function labradorUploadBuffer(fileName, buffer, contentType) {
  const boundary = '----FaktiskStudio' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="' + fileName.replace(/"/g, '') + '"\r\n'
    + 'Content-Type: ' + (contentType || 'application/octet-stream') + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, buffer, tail]);
  const res = await labradorRequest('/ajax/file-upload/upload-files', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': body.length,
    },
    body,
  });
  if (res.status === 301 || res.status === 302) return { ok: false, loggedIn: false };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: 'HTTP ' + res.status };
  }
  const list = await labradorListFiles();
  const hit = list.loggedIn && list.files.find(f => f.name === fileName);
  return hit
    ? { ok: true, url: hit.url, id: hit.id }
    : { ok: true, url: null };
}

// Laster opp generert innhold (dataURL fra canvas) direkte til Labrador —
// brukes av bilde-plugins som produserer ferdige bilder (f.eks. bilde-sensur).
ipcMain.handle('labrador-upload-data', async (e, opts) => {
  const { fileName, dataUrl } = opts || {};
  if (!fileName || !dataUrl) return { ok: false, error: 'Mangler fileName eller dataUrl' };
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: 'Ugyldig dataURL — må være base64-kodet' };
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 100 * 1024 * 1024) {
    return { ok: false, error: 'Over 100 MB (Labradors grense).' };
  }
  try { return await labradorUploadBuffer(labradorSafeName(fileName), buffer, m[1]); }
  catch (err) { return { ok: false, error: err.message }; }
});

// Genererer stillbilde fra video og laster det opp til Labrador, slik at
// embeds kan LENKE posteren i stedet for å bake inn ~100 KB base64.
// Deterministisk filnavn (video + tidspunkt) → eksisterende fil gjenbrukes,
// så gjentatte eksporter ikke fyller opp File admin.
ipcMain.handle('labrador-thumbnail', async (e, opts) => {
  const { url, atTime } = opts || {};
  if (!url || typeof atTime !== 'number') {
    return { ok: false, error: 'Mangler url eller atTime' };
  }
  const base = labradorSafeName(
    decodeURIComponent((url.split('/').pop() || 'video').split('#')[0])
      .replace(/\.[^.]+$/, '')
  ).slice(0, 60);
  const name = base + '-poster-' + atTime.toFixed(1).replace('.', '_') + 's.jpg';

  // Gjenbruk eksisterende poster om den finnes
  let list;
  try { list = await labradorListFiles(); }
  catch (err) { return { ok: false, error: err.message }; }
  if (!list.loggedIn) return { ok: false, loggedIn: false };
  const eksisterende = list.files.find(f => f.name === name);
  if (eksisterende) return { ok: true, url: eksisterende.url, reused: true };

  // Generer stillbildet (samme oppskrift som generate-thumbnail)
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };
  let tmpInput;
  try { tmpInput = await ensureDownloaded(url.split('#')[0]); }
  catch (err) { return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message }; }

  const tmpOutput = path.join(app.getPath('temp'), 'fs-lthumb-' + Date.now() + '.jpg');
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(findFfmpeg(), [
        '-i', tmpInput, '-ss', String(atTime), '-frames:v', '1',
        '-vf', 'scale=800:-2', '-q:v', '4', '-y', tmpOutput,
      ]);
      let stderr = '';
      ff.stderr.on('data', c => { stderr += c.toString(); });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => code === 0 ? resolve()
        : reject(new Error('ffmpeg feilet: ' + stderr.split('\n').slice(-2).join(' | '))));
    });
    const bytes = fs.readFileSync(tmpOutput);
    const res = await labradorUploadBuffer(name, bytes, 'image/jpeg');
    try { fs.unlinkSync(tmpOutput); } catch (err) {}
    if (res.ok && res.url) return { ok: true, url: res.url, sizeKb: (bytes.length / 1024).toFixed(1) };
    return res.ok
      ? { ok: false, error: 'Lastet opp, men fant ikke poster-URL i fillista' }
      : res;
  } catch (err) {
    try { fs.unlinkSync(tmpOutput); } catch (e2) {}
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

// Deling mellom journalister: eksporter et prosjekt som .faktiskprosjekt-fil
// (samme JSON som på disk) som kan sendes på Slack/e-post og importeres i
// mottakerens Studio. Bilder/video i prosjektene er Labrador-URL-er, så
// innholdet virker hos mottakeren. Prosjekter som peker på LOKALE filer
// (f.eks. Klippsamler med klipp fra maskinen) deler bare referansene.
ipcMain.handle('project-export', async (e, pluginId, fileId) => {
  try {
    const file = path.join(projectsDir, safeId(pluginId), safeId(fileId) + '.json');
    if (!fs.existsSync(file)) return { ok: false, error: 'Prosjektet finnes ikke' };
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Eksporter prosjekt',
      defaultPath: (payload.name || fileId) + '.faktiskprosjekt',
      filters: [{ name: 'Faktisk Studio-prosjekt', extensions: ['faktiskprosjekt'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true, savePath: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-import', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Importer prosjekt',
      properties: ['openFile'],
      filters: [{ name: 'Faktisk Studio-prosjekt', extensions: ['faktiskprosjekt', 'json'] }],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const payload = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'));
    if (!payload || payload.schemaVersion !== 1 || !payload.pluginId || !payload.state) {
      return { ok: false, error: 'Filen er ikke et gyldig Faktisk Studio-prosjekt.' };
    }
    const name = String(payload.name || 'Importert prosjekt').trim();
    const dir = path.join(projectsDir, safeId(payload.pluginId));
    ensureDir(dir);
    // Ikke overskriv et eksisterende prosjekt med samme navn — legg på suffiks
    let fileId = safeId(name);
    let target = path.join(dir, fileId + '.json');
    let n = 2;
    while (fs.existsSync(target)) {
      fileId = safeId(name) + '_' + n++;
      target = path.join(dir, fileId + '.json');
    }
    fs.writeFileSync(target, JSON.stringify({
      schemaVersion: 1,
      name,
      pluginId: payload.pluginId,
      savedAt: new Date().toISOString(),
      state: payload.state,
    }, null, 2), 'utf-8');
    return { ok: true, pluginId: payload.pluginId, fileId, name };
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

// Skriv tekstfil til en sti brukeren har valgt via saveDialog.
// Brukes av eksporter som lages i renderer (FCPXML, SRT) — pluginene har
// ikke fs-tilgang selv.
ipcMain.handle('write-text-file', async (e, opts) => {
  const { savePath, content } = opts || {};
  if (!savePath || typeof content !== 'string') {
    return { ok: false, error: 'Mangler savePath eller content' };
  }
  try {
    fs.writeFileSync(savePath, content, 'utf-8');
    return { ok: true, savePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Velg en lokal fil uten opplasting. Keynote-klipp lages ofte fra opptak
// som aldri skal publiseres, så det er ingen grunn til å tvinge dem via
// Labrador først.
ipcMain.handle('open-file-dialog', async (e, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: (opts && opts.title) || 'Velg fil',
    // Kallere kan be om f.eks. multiSelections (klippsetter); standard er én fil
    properties: (opts && opts.properties) || ['openFile'],
    filters: (opts && opts.filters) || [],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  // path beholdes for bakoverkompatibilitet; filePaths har alle valgte
  return { canceled: false, path: res.filePaths[0], filePaths: res.filePaths };
});

// ============================================================
//  Keynote-klipp: video med runde hjørner og ekte alfakanal
// ============================================================
//
// Produserer HEVC med alfakanal (hevc_videotoolbox) slik at hjørnene blir
// gjennomsiktige i Keynote og lysbildebakgrunnen skinner gjennom. Keynotes
// egen skygge følger da den runde formen, mens Keynotes "outline" alltid
// tegner et firkantet omriss — derfor bakes rammen inn i videoen her.
//
// Maske og ramme genereres som PNG i renderer (canvas gir gratis
// antialiasering, samme kvalitet som CSS border-radius) og sendes hit som
// dataURL. ffmpeg kombinerer dem med videoen:
//   video → trim → crop → scale → alphamerge(maske) → overlay(ramme) → HEVC
//
// Lyd fjernes alltid (-an): Keynote-klipp skal være stumme.

// Minimal PNG (RGBA, helt gjennomsiktig) i gitt størrelse — uten eksterne pakker
function transparentPng(w, h) {
  const zlib = require('zlib');
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);   // filterbyte 0 + nuller per rad
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function writeTempPng(dataUrl, name) {
  const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
  if (!base64) throw new Error('Ugyldig PNG-dataURL: ' + name);
  const file = path.join(app.getPath('temp'), `faktisk-keynote-${name}-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

ipcMain.handle('keynote-export', async (e, opts) => {
  const {
    url, inputPath, savePath,
    outWidth, outHeight,
    cropX, cropY, cropW, cropH,   // utsnitt i kildens pikselkoordinater
    maskPng, borderPng,            // dataURL-er fra renderer
    trimStart, trimEnd, duration,
    codec,                         // 'hevc' (standard) | 'prores'
    keepAudio,                     // som regel false — Keynote-klipp er stumme
  } = opts || {};

  if ((!url && !inputPath) || !savePath) {
    return { ok: false, error: 'Mangler kilde (url/inputPath) eller savePath' };
  }
  if (!outWidth || !outHeight) {
    return { ok: false, error: 'Mangler målformat (outWidth/outHeight)' };
  }
  if (!maskPng) {
    return { ok: false, error: 'Mangler maske' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  }

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('keynote-export-progress', msg); } catch (e) {}
  };

  // Hent kilden hvis den ligger på nett
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

  // Skriv maske/ramme til temp
  let maskFile = null, borderFile = null;
  try {
    maskFile = writeTempPng(maskPng, 'mask');
    if (borderPng) borderFile = writeTempPng(borderPng, 'border');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const ts = (typeof trimStart === 'number' && trimStart > 0.01) ? trimStart : 0;
  const te = (typeof trimEnd === 'number' && trimEnd > ts + 0.1) ? trimEnd : null;

  // Filtergraf. Maske-PNG-en er allerede i målformat, så videoen croppes og
  // skaleres dit før alphamerge. format=gray henter lumina som alfaverdi.
  const cropFilter = (cropW && cropH)
    ? `crop=${Math.round(cropW)}:${Math.round(cropH)}:${Math.round(cropX || 0)}:${Math.round(cropY || 0)},`
    : '';
  const scaleFilter = `scale=${outWidth}:${outHeight}:flags=lanczos`;

  let graph =
    `[0:v]${cropFilter}${scaleFilter},format=rgba,setsar=1[v];` +
    `[1:v]format=gray[m];` +
    `[v][m]alphamerge[a]`;
  let outLabel = '[a]';

  if (borderFile) {
    graph += `;[a][2:v]overlay=0:0:format=auto[out]`;
    outLabel = '[out]';
  }

  const useProres = codec === 'prores';

  // hevc_videotoolbox velger en svært lav bitrate hvis man ikke sier noe, og
  // VBR-en bruker et par sekunder på å finne nivået — det gir synlig
  // pixelering i starten av klippet. Sett derfor en romslig bitrate ut fra
  // oppløsningen, og be om keyframe hvert sekund så den stabiliserer raskt.
  const fps = 30;
  const bitrateKbps = Math.round((outWidth * outHeight * fps * 0.2) / 1000);

  const videoArgs = useProres
    ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le']
    : [
        '-c:v', 'hevc_videotoolbox',
        '-alpha_quality', '1.0',
        '-pix_fmt', 'bgra',
        '-tag:v', 'hvc1',
        '-b:v', bitrateKbps + 'k',
        '-maxrate', Math.round(bitrateKbps * 1.5) + 'k',
        '-bufsize', Math.round(bitrateKbps * 2) + 'k',
        '-g', String(fps),          // keyframe hvert sekund
        '-realtime', '0',           // la encoderen bruke tid på kvalitet
      ];

  const args = [
    ...(ts > 0 ? ['-ss', String(ts)] : []),
    '-i', input,
    ...(te !== null ? ['-t', String(te - ts)] : []),
    '-i', maskFile,
    ...(borderFile ? ['-i', borderFile] : []),
    '-filter_complex', graph,
    '-map', outLabel,
    // Keynote-klipp er som regel stumme, men lyden kan beholdes på forespørsel.
    // AAC framfor kopiering: kildelyden kan være i et format QuickTime ikke
    // tar i .mov, og re-encoding er billig for korte klipp.
    ...(keepAudio
      ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '192k']
      : ['-an']),
    ...videoArgs,
    '-movflags', '+faststart',
    '-y',
    savePath,
  ];

  const totalDur = te !== null ? (te - ts)
    : (typeof duration === 'number' && duration > 0 ? duration - ts : 0);

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
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: ' + stderr.split('\n').slice(-4).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { maskFile && fs.unlinkSync(maskFile); } catch (e) {}
    try { borderFile && fs.unlinkSync(borderFile); } catch (e) {}
  }

  let sizeMB = null;
  try { sizeMB = (fs.statSync(savePath).size / (1024 * 1024)).toFixed(1); } catch (e) {}
  return { ok: true, savePath, sizeMB };
});

// ============================================================
//  Klippsetter: trim + sammenslåing av flere klipp
// ============================================================
//
// Bevisst avgrenset: trim per klipp, rekkefølge, felles format, valgfri
// lyd. INGEN tidslinje/spor/musikk — det er Final Cut sin jobb.

// Les metadata for en mediefil fra ffmpeg -i (ffprobe følger ikke med
// ffmpeg-static). Exit-koden er alltid 1 uten output — det er forventet.
function probeMedia(input) {
  return new Promise((resolve, reject) => {
    const ff = spawn(findFfmpeg(), ['-i', input]);
    let stderr = '';
    ff.stderr.on('data', c => { stderr += c.toString(); });
    ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
    ff.on('close', () => {
      const vm = stderr.match(/Stream #.*Video:.* (\d{2,5})x(\d{2,5})/);
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!vm) return reject(new Error('Fant ikke videospor i: ' + input));
      resolve({
        width: parseInt(vm[1], 10),
        height: parseInt(vm[2], 10),
        hasAudio: /Stream #.*Audio:/.test(stderr),
        duration: dm
          ? parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3])
          : 0,
      });
    });
  });
}

ipcMain.handle('sequence-export', async (e, opts) => {
  const { clips, savePath, outWidth, outHeight, keepAudio } = opts || {};
  if (!Array.isArray(clips) || clips.length < 1) {
    return { ok: false, error: 'Ingen klipp å eksportere' };
  }
  if (clips.length > 20) {
    return { ok: false, error: 'Maks 20 klipp per eksport.' };
  }
  if (!savePath) return { ok: false, error: 'Mangler savePath' };

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('sequence-export-progress', msg); } catch (e) {}
  };

  // Hent kilder (Labrador-URL-er lastes ned) og prob dem
  const sources = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      let input = c.inputPath;
      if (!input || !fs.existsSync(input)) {
        send({ phase: 'downloading', percent: Math.round(i / clips.length * 100) });
        input = await ensureDownloaded(c.url);
      }
      const meta = await probeMedia(input);
      const start = Math.max(0, Number(c.start) || 0);
      const end = (typeof c.end === 'number' && c.end > start + 0.05)
        ? Math.min(c.end, meta.duration || c.end)
        : (meta.duration || 0);
      sources.push({ input, meta, start, end, dur: Math.max(0.1, end - start) });
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Målformat: eksplisitt, eller første klipps oppløsning (avrundet til partall)
  const even = n => Math.max(2, 2 * Math.round(n / 2));
  const W = even(outWidth || sources[0].meta.width);
  const H = even(outHeight || sources[0].meta.height);
  const FPS = 30;

  const args = [];
  const parts = [];
  const pairLabels = [];

  sources.forEach((s, k) => { args.push('-i', s.input); });

  // Klipp uten lyd får stille stereo fra anullsrc-inputs (etter videoene)
  const silentIdx = {};
  if (keepAudio) {
    sources.forEach((s, k) => {
      if (!s.meta.hasAudio) {
        silentIdx[k] = args.filter(a => a === '-i').length;
        args.push('-f', 'lavfi', '-t', s.dur.toFixed(3),
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      }
    });
  }

  sources.forEach((s, k) => {
    parts.push(
      `[${k}:v]trim=${s.start.toFixed(3)}:${s.end.toFixed(3)},setpts=PTS-STARTPTS,` +
      `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H},setsar=1,format=yuv420p[v${k}]`);
    if (keepAudio) {
      if (s.meta.hasAudio) {
        parts.push(
          `[${k}:a]atrim=${s.start.toFixed(3)}:${s.end.toFixed(3)},asetpts=PTS-STARTPTS,` +
          `aresample=48000,aformat=channel_layouts=stereo[a${k}]`);
      } else {
        parts.push(`[${silentIdx[k]}:a]asetpts=PTS-STARTPTS[a${k}]`);
      }
      pairLabels.push(`[v${k}][a${k}]`);
    } else {
      pairLabels.push(`[v${k}]`);
    }
  });

  parts.push(pairLabels.join('')
    + `concat=n=${sources.length}:v=1:a=${keepAudio ? 1 : 0}`
    + (keepAudio ? '[vout][aout]' : '[vout]'));

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    ...(keepAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y', savePath,
  );

  const totalDur = sources.reduce((sum, s) => sum + s.dur, 0);
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
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: '
          + stderr.split('\n').slice(-4).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let sizeMB = null;
  try { sizeMB = (fs.statSync(savePath).size / (1024 * 1024)).toFixed(1); } catch (e) {}
  return { ok: true, savePath, sizeMB, width: W, height: H };
});

// ============================================================
//  Teksting: brenn tekstboksene inn i videoen
// ============================================================
//
// Pluginen tegner én full-frame PNG per segment (samme canvas-tegning som
// forhåndsvisningen — Faktisk-boksene, riktig font og malgeometri), og
// ffmpeg legger dem over videoen med fade-inn og enable-vinduer. Utdata
// er H.264 + AAC (MP4) — klar for Labrador og SoMe uten Final Cut.

ipcMain.handle('caption-burn-export', async (e, opts) => {
  const { url, inputPath, savePath, pngs, duration } = opts || {};
  if ((!url && !inputPath) || !savePath) {
    return { ok: false, error: 'Mangler kilde (url/inputPath) eller savePath' };
  }
  if (!Array.isArray(pngs) || !pngs.length) {
    return { ok: false, error: 'Ingen tekstsegmenter å brenne inn' };
  }
  if (pngs.length > 5000) {
    return { ok: false, error: 'For mange segmenter for innbrenning (maks 5000).' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  }

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('caption-burn-progress', msg); } catch (e) {}
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

  // Skriv PNG-ene til temp
  const pngFiles = [];
  try {
    for (let i = 0; i < pngs.length; i++) {
      pngFiles.push(writeTempPng(pngs[i].png, 'cap' + i));
    }
  } catch (err) {
    pngFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
    return { ok: false, error: err.message };
  }

  // Alle tekstbildene settes sammen til ÉN bildesekvens med ffmpegs concat-
  // liste (bilde + varighet, tomt gjennomsiktig bilde i pausene) og legges
  // oppå videoen i ett overlay. Tidligere var hvert segment en egen input og
  // et eget overlay i en lang kjede — det tålte bare ~100 segmenter, så lange
  // opptak (15 min+) feilet.
  const segs = pngs.map((p, i) => ({ file: pngFiles[i], start: Math.max(0, Number(p.start) || 0), end: Number(p.end) || 0 }))
    .filter(x => x.end > x.start + 0.02)
    .sort((a, b) => a.start - b.start);
  // Tomt, gjennomsiktig bilde i samme størrelse som tekstbildene (leses fra PNG-hodet)
  let blankFile;
  try {
    const head = fs.readFileSync(pngFiles[0]).subarray(16, 24);
    const pw = head.readUInt32BE(0), ph = head.readUInt32BE(4);
    blankFile = path.join(app.getPath('temp'), `faktisk-teksting-blank-${Date.now()}.png`);
    fs.writeFileSync(blankFile, transparentPng(pw, ph));
  } catch (err) {
    pngFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
    return { ok: false, error: 'Kunne ikke lage tomt tekstbilde: ' + err.message };
  }
  const q = f => "'" + String(f).replace(/'/g, "'\\''") + "'";
  const lines = ['ffconcat version 1.0'];
  let cur = 0;
  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    const st = Math.max(cur, sg.start);
    const next = segs[i + 1];
    const en = Math.max(st + 0.04, Math.min(sg.end, next ? next.start : sg.end));
    if (st - cur > 0.001) { lines.push('file ' + q(blankFile), 'duration ' + (st - cur).toFixed(3)); }
    lines.push('file ' + q(sg.file), 'duration ' + (en - st).toFixed(3));
    cur = en;
  }
  const tail = Math.max(1, ((typeof duration === 'number' && duration > 0) ? duration : cur) - cur + 1);
  lines.push('file ' + q(blankFile), 'duration ' + tail.toFixed(3));
  lines.push('file ' + q(blankFile));     // concat-demuxeren trenger siste fil to ganger for at varigheten skal gjelde
  const listFile = path.join(app.getPath('temp'), `faktisk-teksting-${Date.now()}.ffconcat`);
  fs.writeFileSync(listFile, lines.join('\n') + '\n');
  pngFiles.push(blankFile, listFile);     // ryddes bort til slutt sammen med tekstbildene

  const graph = '[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:eof_action=pass:format=auto[vout]';
  const args = ['-i', input, '-f', 'concat', '-safe', '0', '-i', listFile];
  args.push(
    '-filter_complex', graph,
    '-map', '[vout]',
    '-map', '0:a?', '-c:a', 'aac', '-b:a', '192k',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y', savePath,
  );

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
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: '
          + stderr.split('\n').slice(-4).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    pngFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
  }

  let sizeMB = null;
  try { sizeMB = (fs.statSync(savePath).size / (1024 * 1024)).toFixed(1); } catch (e) {}
  return { ok: true, savePath, sizeMB };
});

// ============================================================
//  Teksting: transkribering med NB-Whisper via whisper.cpp
// ============================================================
//
// Kjøres som frittstående whisper-cli-binær — samme mønster som ffmpeg.
// Historikk som IKKE må gjentas: onnxruntime (transformers.js) krasjer i
// alle Electron-prosesstyper (main, utilityProcess, ELECTRON_RUN_AS_NODE)
// fordi store tensor-allokeringer i BFCArena trapper i Electrons
// minne-hooks — bekreftet i krasjrapporter for både ORT 1.21 og 1.27.
// En separat binær har ikke Electrons allokator, og whisper.cpp har
// Metal-akselerasjon på Apple Silicon i tillegg.
//
// Modellen (NB-Whisper small, ggml q5_0, 167 MB) håndteres av det
// eksisterende AI_MODELS-systemet med sha256-verifisering.

// Selvstendig whisper-cli-binær, bygget statisk med scripts/build-whisper-cli.sh
// og hostet som release-asset. Lastes ned til userData/bin ved første behov —
// samme mønster som AI-modellene, med sha256-verifisering.
// Nedlasting via vår egen https (ikke nettleser) setter ikke quarantine-
// attributt, så Gatekeeper blokkerer ikke kjøringen.
const WHISPER_CLI_TOOL = {
  file: 'whisper-cli',
  url: 'https://github.com/stianbrathen/faktiskorg-studio-plugins/releases/download/tools-v1/whisper-cli-arm64',
  // whisper.cpp v1.9.2, statisk + portabel (GGML_NATIVE=OFF), Developer ID-signert
  sha256: '0d1257a2e4acf00530411759e892a5e12f47b1c2f4ce95842111c70f794a4adb',
  sizeMB: 3,
};

function bundledWhisperCliPath() {
  return path.join(app.getPath('userData'), 'bin', WHISPER_CLI_TOOL.file);
}

function findWhisperCli() {
  const candidates = [
    // Vår distribuerte binær (lastes ned automatisk)
    bundledWhisperCliPath(),
    // Homebrew som fallback for utviklere (Apple Silicon + Intel)
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    // Eldre navn på binæren i homebrew-formelen
    '/opt/homebrew/bin/whisper-cpp',
    '/usr/local/bin/whisper-cpp',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Last ned den distribuerte binæren om ingen finnes fra før.
// Returnerer sti, eller kaster med forklarende feilmelding.
async function ensureWhisperCli(sendProgress) {
  const existing = findWhisperCli();
  if (existing) return existing;

  if (WHISPER_CLI_TOOL.sha256.startsWith('FYLL-INN')) {
    throw new Error('whisper.cpp mangler. Installer med: brew install whisper-cpp '
      + '(distribuert binær er ikke publisert ennå).');
  }

  if (sendProgress) sendProgress({ phase: 'downloading-engine', percent: 0 });
  const buf = await httpGetBuffer(WHISPER_CLI_TOOL.url);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash !== WHISPER_CLI_TOOL.sha256) {
    throw new Error('Nedlastet transkriberingsmotor matcher ikke forventet sjekksum — avbrutt.');
  }
  const dest = bundledWhisperCliPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  fs.chmodSync(dest, 0o755);
  if (sendProgress) sendProgress({ phase: 'downloading-engine', percent: 100 });
  return dest;
}

// Hent lydsporet som 16 kHz mono WAV (formatet whisper-cli forventer)
function extractAudioWav(inputPath) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(app.getPath('temp'), 'faktisk-transkriber-' + Date.now() + '.wav');
    const ff = spawn(findFfmpeg(), [
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      // Adaptiv nivånormalisering: løfter lav/fjern tale (f.eks. stemme
      // som bare ligger i én kanal — mono-miksen halverer den — eller
      // med musikk over) så Whisper hører den. Uten dette druknet hele
      // setninger i test mot andre transkriberingstjenester.
      '-af', 'dynaudnorm=f=150:g=15',
      '-c:a', 'pcm_s16le',
      '-y',
      outFile,
    ]);
    let stderr = '';
    ff.stderr.on('data', c => { stderr += c.toString(); });
    ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
    ff.on('close', code => {
      if (code !== 0) {
        return reject(new Error(
          stderr.includes('does not contain any stream')
          || stderr.includes('Output file does not contain')
            ? 'Videoen har ikke noe lydspor.'
            : 'Klarte ikke hente ut lyden: ' + stderr.split('\n').slice(-3).join(' | ')));
      }
      resolve(outFile);
    });
  });
}

ipcMain.handle('transcribe-reset-model', async (e, modelId) => {
  try {
    const id = whisperModelId(modelId);
    const p = aiModelPath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('transcribe-status', async () => {
  const cli = findWhisperCli();
  const canDownload = !WHISPER_CLI_TOOL.sha256.startsWith('FYLL-INN');
  if (!cli && !canDownload) {
    return {
      ok: false,
      error: 'whisper.cpp mangler. Installer med: brew install whisper-cpp — '
        + 'eller si fra, så legger vi binæren inn i Studio.',
    };
  }
  const models = {};
  for (const id of Object.keys(AI_MODELS)) {
    if (!id.startsWith('whisper-')) continue;
    models[id] = {
      ready: aiModelReady(id),
      sizeMB: AI_MODELS[id].sizeMB,
      label: AI_MODELS[id].label,
    };
  }
  return { ok: true, models };
});

// Varighet av 16 kHz mono s16-WAV rett fra filstørrelsen (ffprobe følger
// ikke med ffmpeg-static): 32 000 byte per sekund + 44 byte header.
function wavDurationSec(file) {
  try { return Math.max(0, (fs.statSync(file).size - 44) / 32000); } catch (e) { return 0; }
}

// Klipp ut et tidsrom av en WAV uten re-koding.
function extractWavSlice(wav, startSec, durSec, outFile) {
  return new Promise((resolve, reject) => {
    const ff = spawn(findFfmpeg(), [
      '-ss', String(startSec.toFixed(3)),
      '-t', String(durSec.toFixed(3)),
      // pcm_s16le i stedet for «-c copy»: copy + -ss ga en tom WAV
      // (130 byte) med enkelte ffmpeg-versjoner — da feilet hull-passet stille
      '-i', wav, '-c:a', 'pcm_s16le', '-y', outFile,
    ]);
    ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
    ff.on('close', code => code === 0 ? resolve(outFile)
      : reject(new Error('Klarte ikke klippe ut lydutsnitt (kode ' + code + ')')));
  });
}

// Ord med tider fra whisper-tokens (-ojf). Et token som starter med
// mellomrom begynner et nytt ord; spesialtokens ([_BEG_], [_TT_123]) hoppes
// over. Brukes av teksting-pluginen til å dele opp tekstboksene på ordnivå.
//
// OBS (whisper.cpp v1.9.2, lest i kildekoden): med --vad er segmentenes
// tider kartlagt tilbake til originalopptaket, men TOKEN-tidene i JSON-en
// er ikke — de ligger på den komprimerte tidslinjen der stillhet er klippet
// bort. Vi forankrer derfor ordene til segmentets (riktige) start/slutt:
// ren forskyvning når lengdene stemmer, ellers lineær skalering.
function wordsFromWhisperTokens(tokens, segFrom, segTo) {
  const raw = [];
  let cur = null;
  for (const t of tokens || []) {
    const txt = String(t.text || '');
    if (!txt || /^\s*\[_/.test(txt) || /^\s*<\|/.test(txt)) continue;
    const from = t.offsets && t.offsets.from != null ? t.offsets.from / 1000 : null;
    const to = t.offsets && t.offsets.to != null ? t.offsets.to / 1000 : null;
    if (/^\s/.test(txt) || !cur) {
      const w = txt.trim();
      if (!w) continue;
      cur = { w, start: from, end: to };
      raw.push(cur);
    } else {
      cur.w += txt;
      if (to != null) cur.end = to;
      if (cur.start == null) cur.start = from;
    }
  }
  const words = raw.filter(w => w.w.trim() && w.start != null && w.end != null);
  if (!words.length || words.length !== raw.length) return null;
  const r0 = words[0].start, r1 = Math.max(r0 + 0.01, words[words.length - 1].end);
  const span = Math.max(0.01, segTo - segFrom);
  const exact = Math.abs((r1 - r0) - span) < 0.15;
  const map = t => exact ? segFrom + (t - r0) : segFrom + (t - r0) * span / (r1 - r0);
  let prev = segFrom;
  return words.map(w => {
    const start = Math.max(prev, Math.min(segTo, map(w.start)));
    const end = Math.max(start, Math.min(segTo, map(w.end)));
    prev = start;
    return { w: w.w, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
  });
}

// Én whisper-kjøring → segmenter. vadThreshold styrer hvor forsiktig
// taledeteksjonen er (lavere = mer inkluderende). Med -ojf får hvert
// segment også ordene med tider (seg.words) når de lar seg lese.
function runWhisperPass(cli, wav, commonArgs, outPrefix, vadThreshold, onPercent) {
  // vadThreshold null = uten taledeteksjon (se hull-passet)
  const vadArgs = vadThreshold == null ? []
    : ['--vad', '--vad-model', aiModelPath('vad'), '--vad-threshold', vadThreshold];
  const args = commonArgs.concat(['-f', wav], vadArgs, [
    '-ojf',
    '-of', outPrefix,
    '--print-progress',
  ]);
  return new Promise((resolve, reject) => {
    const wp = spawn(cli, args);
    let stderr = '';
    wp.stderr.on('data', c => {
      const text = c.toString();
      stderr += text;
      const m = text.match(/progress\s*=\s*(\d+)%/);
      if (m && onPercent) onPercent(parseInt(m[1], 10));
    });
    // KRITISK: stdout MÅ dreneres. whisper-cli skriver transkribert tekst
    // fortløpende dit, og uten en leser fylles rørbufferen (64 KB) —
    // da blokkerer whisper-cli på write og henger for alltid.
    wp.stdout.on('data', () => {});
    wp.on('error', err => reject(new Error('whisper-prosessfeil: ' + err.message)));
    wp.on('close', code => {
      if (code !== 0) {
        return reject(new Error('whisper-cli feilet (kode ' + code + '): '
          + stderr.split('\n').slice(-4).join(' | ')));
      }
      try {
        const jsonPath = outPrefix + '.json';
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        fs.unlinkSync(jsonPath);
        resolve((parsed.transcription || []).map(t => {
          const seg = {
            start: (t.offsets && t.offsets.from != null) ? t.offsets.from / 1000 : 0,
            end: (t.offsets && t.offsets.to != null) ? t.offsets.to / 1000 : 0,
            // Spesialtokens som «<|nocaptions|>» kan lekke inn i teksten
            text: (t.text || '').replace(/<\|[^|>]*\|>/g, ' ').replace(/\s+/g, ' ').trim(),
          };
          // «<|nocaptions|>» = whisper ga opp her (sett over tale med musikk
          // under). Merkes, så hull-passet prøver tidsrommet på nytt.
          if (/<\|nocaptions\|>/.test(t.text || '')) seg.nocap = true;
          // Ordtider er en bonus — feiler de, brukes segmentet som før
          try {
            const words = wordsFromWhisperTokens(t.tokens, seg.start, seg.end);
            if (words && words.length) seg.words = words;
          } catch (e) {}
          return seg;
        }).filter(s => s.text || s.nocap));
      } catch (err) {
        reject(new Error('Klarte ikke lese transkriberingsresultatet: ' + err.message));
      }
    });
  });
}

async function ensureTranscribeModel(id, send) {
  if (aiModelReady(id)) return;
  send({ phase: 'downloading-model', percent: 0, file: AI_MODELS[id].file });
  const buf = await httpGetBuffer(AI_MODELS[id].url);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash !== AI_MODELS[id].sha256) {
    throw new Error('Nedlastet modell matcher ikke forventet sjekksum — avbrutt.');
  }
  fs.mkdirSync(path.dirname(aiModelPath(id)), { recursive: true });
  fs.writeFileSync(aiModelPath(id), buf);
  send({ phase: 'downloading-model', percent: 100 });
}

// ---------- Hull-passet: planlegging og filtrering (rene funksjoner) ----------
const normWs = t => String(t).toLowerCase().replace(/[^a-zæøåäöüé0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// «Tynt» segment: noen få ord strukket over lang tid. Typisk når whisper
// mister tråden i et vindu — den skriver et par ord og hopper over flere
// setninger (sett i podkasttest 11.10.2026: «av det. finnes ikke.» over
// 26 s). Normal tale er 10–16 tegn/s; under 4 over minst 2,5 s er mistenkelig.
function isThinSegment(seg) {
  if (seg.nocap) return true;
  const dur = seg.end - seg.start;
  if (dur < 2.5) return false;
  const chars = normWs(seg.text).replace(/ /g, '').length;
  return chars / dur < 4;
}

// Finn tidsrom som skal dekodes på nytt: tomme hull ≥ gapMin, og tynne
// segmenter (de tas ut og legges i g.replaced — legges tilbake hvis
// ny dekoding ikke gir mer tekst). Segmenter som ender i «...» rett før
// et hull er skadde rester og tas med i hullet på samme måte.
function planGaps(segments, totalDur, gapMin) {
  const keep = [], gaps = [];
  const sorted = segments.slice().sort((a, b) => a.start - b.start);
  let cursor = 0, pending = [];
  for (let i = 0; i <= sorted.length; i++) {
    const seg = sorted[i];
    if (seg && isThinSegment(seg)) { pending.push(seg); continue; }
    const gapEnd = seg ? seg.start : totalDur;
    if (gapEnd - cursor >= gapMin || pending.length) {
      let gapStart = pending.length ? Math.min(cursor, pending[0].start) : cursor;
      const replaced = pending.slice();
      const prev = keep[keep.length - 1];
      if (prev && /(\.\.\.|…)$/.test(prev.text) && gapStart - prev.end < 0.5) {
        gapStart = prev.start;
        replaced.unshift(keep.pop());
      }
      if (gapEnd - gapStart >= 0.5) {
        // Nabotekst: de tre segmentene før og de to etter (gjentakelser fra
        // polstringen kan strekke seg over mer enn ett segment)
        const after = sorted.slice(i, i + 4).filter(x => !isThinSegment(x)).slice(0, 2);
        gaps.push({
          start: gapStart, end: gapEnd, replaced,
          prevText: keep.slice(-3).map(x => x.text).join(' '),
          nextText: after.map(x => x.text).join(' '),
        });
      } else keep.push(...replaced);
    }
    pending = [];
    if (seg) { keep.push(seg); cursor = Math.max(cursor, seg.end); }
  }
  return { keep, gaps };
}

// Fjern ord i starten av `text` som bare gjentar slutten av `prev`
// (minst 2 ord), og ord på slutten som gjentar starten av `next`.
// Returnerer { text, dropStart, dropEnd } (antall ord fjernet).
function trimRepeatedEdges(text, prev, next) {
  const raw = String(text).trim().split(/\s+/);
  const t = raw.map(normWs);
  const p = normWs(prev).split(' ').filter(Boolean);
  const nx = normWs(next).split(' ').filter(Boolean);
  let dropStart = 0, dropEnd = 0;
  for (let k = Math.min(t.length, p.length, 12); k >= 2; k--) {
    if (t.slice(0, k).join(' ') === p.slice(p.length - k).join(' ')) { dropStart = k; break; }
  }
  for (let k = Math.min(t.length - dropStart, nx.length, 12); k >= 2; k--) {
    if (t.slice(t.length - k).join(' ') === nx.slice(0, k).join(' ')) { dropEnd = k; break; }
  }
  return { text: raw.slice(dropStart, raw.length - dropEnd).join(' '), dropStart, dropEnd };
}

// Filtrer funn fra én hull-dekoding. Whisper gjentar gjerne nabotale:
// 1) ord i funnet som ligger i polstringen FØR hullet (PAD) og som finnes i
//    slutten av forrige segment, er gjentakelser — kuttes. Tilsvarende ord
//    etter hullet som finnes i starten av neste. (Sett i podkasttest:
//    «… bekrefter vi | et langt skriftlig intervju …» to ganger.)
// 2) funn som (normalisert) finnes i nabo-teksten, eller i naboene
//    KOMBINERT (prev + next limt sammen til ett «nytt» segment)
// 3) funn inneholdt i et annet, lengre funn fra samme hull — behold det lengste
function acceptGapFindings(g, found, s0, sliceEnd) {
  const prevN = normWs(g.prevText), nextN = normWs(g.nextText);
  const neighbors = prevN + ' ' + nextN;
  const prevTail = new Set(prevN.split(' ').slice(-30));
  const nextHead = new Set(nextN.split(' ').slice(0, 30));
  const candidates = [];
  for (const s of found) {
    const start = s.start + s0;
    const end = Math.min(s.end + s0, sliceEnd);
    if (start >= g.end - 0.05) continue; // starter ikke i hullet
    let toks = s.text.replace(/(\.\.\.|…)$/, '').trim().split(/\s+/).filter(Boolean);
    let ws = Array.isArray(s.words) && s.words.length === toks.length
      ? s.words.map(w => ({ w: w.w, start: w.start + s0, end: w.end + s0 })) : null;
    if (ws) {
      // Tidsbasert kutt av gjentakelser i kantene
      // Ordene som ligger i polstringen før hullet: er de fleste av dem
      // med i slutten av teksten før, er de en gjentakelse (whisper hører
      // gjerne litt annerledes andre gang: «team fox» → «Team Fax»)
      let a = 0, b = toks.length;
      while (a < b && ws[a].start < g.start - 0.15) a++;
      if (a && toks.slice(0, a).filter(t => prevTail.has(normWs(t))).length / a < 0.6) a = 0;
      while (b > a && ws[b - 1].start > g.end + 0.1) b--;
      const nTail = toks.length - b;
      if (nTail && toks.slice(b).filter(t => nextHead.has(normWs(t))).length / nTail < 0.6) b = toks.length;
      toks = toks.slice(a, b); ws = ws.slice(a, b);
    } else {
      const tr = trimRepeatedEdges(toks.join(' '), g.prevText, g.nextText);
      toks = tr.text.split(/\s+/).filter(Boolean);
    }
    const text = toks.join(' ');
    if (!text) continue;
    const cStart = Math.max(g.start, ws && ws.length ? ws[0].start : start);
    if (end - cStart <= 0.2) continue;
    const n = normWs(text);
    if (!n) continue;
    if (prevN.includes(n) || nextN.includes(n) || neighbors.includes(n)) continue;
    const c = { start: cStart, end, text, n };
    if (ws && ws.length) {
      c.words = ws.map(w => ({ w: w.w,
        start: Math.round(Math.max(c.start, Math.min(end, w.start)) * 1000) / 1000,
        end: Math.round(Math.max(c.start, Math.min(end, w.end)) * 1000) / 1000 }));
    }
    candidates.push(c);
  }
  candidates.sort((a, b) => b.n.length - a.n.length);
  const accepted = [];
  for (const c of candidates) {
    if (accepted.some(a => a.n.includes(c.n))) continue;
    accepted.push(c);
  }
  return accepted;
}

// Skal et segment vi tok ut (tynt/«...»-rest) legges tilbake? Ja, med
// mindre den nye dekodingen dekker minst 60 % av ordene i det.
function replacedStillNeeded(seg, accepted) {
  const got = new Set(accepted.map(c => c.n).join(' ').split(' '));
  const ws = normWs(String(seg.text).replace(/<\|[^|>]*\|>/g, ' ')).split(' ').filter(Boolean);
  if (!ws.length) return false;
  return ws.filter(w => got.has(w)).length / ws.length < 0.6;
}

ipcMain.handle('transcribe', async (e, opts) => {
  const { url, inputPath } = opts || {};
  const modelId = whisperModelId(opts && opts.model);
  if (!url && !inputPath) return { ok: false, error: 'Mangler kilde (url/inputPath)' };

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('transcribe-progress', msg); } catch (e) {}
  };

  // Sørg for transkriberingsmotoren (lastes ned første gang om nødvendig)
  let cli;
  try {
    cli = await ensureWhisperCli(send);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Sørg for modellene (AI_MODELS-mønsteret: nedlasting + sha256-sjekk).
  // VAD-modellen (under 1 MB) trengs i tillegg til talemodellen.
  try {
    await ensureTranscribeModel(modelId, send);
    await ensureTranscribeModel('vad', send);
  } catch (err) {
    return { ok: false, error: 'Kunne ikke laste ned modellen: ' + err.message };
  }

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

  let wavFile = null;
  const outPrefix = path.join(app.getPath('temp'), 'faktisk-transkriber-' + Date.now());
  try {
    send({ phase: 'extracting-audio', percent: 0 });
    wavFile = await extractAudioWav(input);
    send({ phase: 'extracting-audio', percent: 100 });

    // Språk: 'no' (standard), 'auto' (autodeteksjon) eller ISO-kode.
    // Oversettelse: Whispers innebygde translate-oppgave — går KUN til
    // engelsk, fra hvilket som helst språk.
    const lang = /^([a-z]{2,3}|auto)$/.test(String(opts.language || ''))
      ? opts.language : 'no';
    const commonArgs = [
      '-m', aiModelPath(modelId),
      '-l', lang,
      '-bs', '5',            // beam search: dropper færre setninger enn
                             // grådig dekoding (standard), koster litt fart
    ];
    if (opts.translate === true) commonArgs.push('-tr');

    // Manus-hint (fra teksting-pluginen): navn og fagord, så whisper staver
    // dem riktig. Kun i hovedpasset — i hull-passet (VAD 0,1, nesten stille
    // partier) kunne et hint ellers bli «gjentatt» som falsk tekst.
    const prompt = typeof opts.prompt === 'string'
      ? opts.prompt.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
      : '';
    const pass1Args = prompt ? commonArgs.concat(['--prompt', prompt]) : commonArgs;

    // Pass 1: hele opptaket med VAD (deler ved talepauser i stedet for
    // blinde 30-sekunders vinduer — uten VAD forsvant setninger som
    // krysset vindusgrensa). Terskel 0.2 er empirisk: standard 0.5
    // droppet telefonkvalitets-tale, 0.3 avviste fjern stemme under
    // musikk som ikke-tale.
    send({ phase: 'transcribing', percent: 0 });
    let segments = await runWhisperPass(cli, wavFile, pass1Args, outPrefix,
      '0.2', p => send({ phase: 'transcribing', percent: p }));

    // Pass 2 — hull-pass. VAD/vindusgrenser kan fortsatt miste tale i
    // overgangene (verifisert: setninger nær 30 s-grensa forsvant, mens
    // NØYAKTIG samme lyd dekodet isolert ble perfekt). Derfor: finn hull
    // i tidslinja, dekod dem isolert, og flett inn resultatet.
    const totalDur = wavDurationSec(wavFile);
    const GAP_MIN = 1.5;   // sekunder uten tekst før vi undersøker
    const PAD = 2.5;       // kontekst FØR hullet. Whisper er følsom for
                           // hvor utsnittet starter: med 0,25 s mistet den
                           // ord midt i setningen («denne Facebook-gruppa»
                           // → «gruppa»), med 2,5 s ble frasen ordrett.
                           // Duplikatvernet under tar seg av at polstringen
                           // overlapper nabotale.
    const EXTEND = 2.5;    // dekod et stykke inn i neste segment, så
                           // setninger som krysser hullkanten blir hele
    if (totalDur > 0 && segments.length) {
      const { keep, gaps } = planGaps(segments, totalDur, GAP_MIN);

      const MAX_GAPS = 30; // sikkerhetstak for kjøretid
      // Hull over taket: legg tilbake det vi tok ut, så ingenting forsvinner
      for (const g of gaps.slice(MAX_GAPS)) keep.push(...g.replaced);
      const gapsToCheck = gaps.slice(0, MAX_GAPS);
      for (let i = 0; i < gapsToCheck.length; i++) {
        const g = gapsToCheck[i];
        send({ phase: 'transcribing-gaps',
               percent: Math.round(i / gapsToCheck.length * 100) });
        const s0 = Math.max(0, g.start - PAD);
        const sliceEnd = Math.min(totalDur, g.end + EXTEND);
        const sliceWav = outPrefix + '-gap' + i + '.wav';
        let used = false;
        try {
          await extractWavSlice(wavFile, s0, sliceEnd - s0, sliceWav);
          // Enda mer inkluderende VAD (0.1) i hullene: her VET vi at
          // hovedpasset ikke fant noe — finnes det tale, vil vi ha den.
          const found = await runWhisperPass(cli, sliceWav, commonArgs,
            outPrefix + '-gap' + i, '0.1', null);
          let accepted = acceptGapFindings(g, found, s0, sliceEnd);
          // Taledeteksjonen kan selv være problemet: VAD klipper bort
          // musikken mellom ordene, og det oppkuttede lydsporet ga
          // «<|nocaptions|>» — mens SAMME utsnitt uten VAD ga alle
          // setningene (verifisert, podkasttest 11.10.2026). Prøv uten VAD,
          // men bare der hovedpasset faktisk fant noe (tynt/nocaptions-
          // segment): i helt stille hull kan whisper uten VAD dikte tekst.
          if (g.replaced.length && (!accepted.length
              || g.replaced.some(r => replacedStillNeeded(r, accepted)))) {
            const found2 = await runWhisperPass(cli, sliceWav, commonArgs,
              outPrefix + '-gap' + i + 'b', null, null);
            const accepted2 = acceptGapFindings(g, found2, s0, sliceEnd);
            const len = a => a.reduce((n, c) => n + c.n.length, 0);
            if (len(accepted2) > len(accepted)) accepted = accepted2;
          }
          for (const c of accepted) {
            const seg = { start: c.start, end: c.end, text: c.text };
            if (c.words) seg.words = c.words;
            keep.push(seg);
          }
          // Det vi tok ut, legges tilbake med mindre ny dekoding dekket det
          // — ingenting forsvinner i stillhet
          for (const r of g.replaced) if (replacedStillNeeded(r, accepted)) keep.push(r);
          used = true;
        } catch (e) {
          // Hull-passet er best effort — hovedresultatet står seg uansett
          console.error('Hull-pass feilet for', g.start.toFixed(1), '–', g.end.toFixed(1), ':', e.message);
        } finally {
          if (!used) keep.push(...g.replaced);
          try { fs.unlinkSync(sliceWav); } catch (e) {}
        }
      }
      segments = keep.filter(x => x.text).sort((a, b) => a.start - b.start);
    }

    segments = segments.filter(x => x.text);
    send({ phase: 'done', percent: 100 });
    return {
      ok: true,
      text: segments.map(s => s.text).join(' '),
      segments,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { wavFile && fs.unlinkSync(wavFile); } catch (e) {}
  }
});
// Motiv-tracking: følger et markert område gjennom klippet via
// template-matching på nedskalerte gråtonebilder (src/censor-track.js).
// Alt kjører lokalt — ingen ML-modeller, ingen nettverkskall.
// ============================================================
//  AI-modeller — lokale, nedlastbare (ingen sky, ingen API-nøkler)
// ============================================================
//
// Modeller lastes ned én gang til userData/models/ med sha256-verifisering,
// og kjøres lokalt via onnxruntime. Plugins feature-detekter via
// ai-model-status og ber om nedlasting via ai-model-ensure.

const AI_MODELS = {
  ansikt: {
    file: 'ultraface-rfb-640.onnx',
    url: 'https://huggingface.co/wide-video/ultraface-v0.0.0/resolve/main/version-RFB-640_simplified_fixed.onnx',
    sha256: '7fad51c3261f17befe6e5637e18f8689eeeac48a40738e6c9182485c7aaaf547',
    sizeMB: 1.4,
    label: 'Ansiktsdeteksjon (UltraFace, MIT-lisens)',
  },
  // NB-Whisper i tre størrelser. Samme fil-navn for small som før slik at
  // allerede nedlastede modeller gjenbrukes.
  'whisper-small': {
    file: 'ggml-nb-whisper-small-q5.bin',
    url: 'https://huggingface.co/NbAiLab/nb-whisper-small/resolve/main/ggml-model-q5_0.bin',
    sha256: '2a9025afb6e825fc4ae6a46671e0cb2f43e62f1dec87270deea6fe61b5285a20',
    sizeMB: 167,
    label: 'NB-Whisper small — rask, god til utkast',
  },
  'whisper-medium': {
    file: 'ggml-nb-whisper-medium-q5.bin',
    url: 'https://huggingface.co/NbAiLab/nb-whisper-medium/resolve/main/ggml-model-q5_0.bin',
    sha256: '18733de634af639a43b0f8c5f5a2ea0920de4c5b32a5570ec130981581c0e5e7',
    sizeMB: 514,
    label: 'NB-Whisper medium — bedre på navn og utydelig tale',
  },
  'whisper-large': {
    file: 'ggml-nb-whisper-large-q5.bin',
    url: 'https://huggingface.co/NbAiLab/nb-whisper-large/resolve/main/ggml-model-q5_0.bin',
    sha256: 'feb5951ae694a62cfeb81fb501f6cfa8cc50d96bcddb1e4e8215f7006bac23a2',
    sizeMB: 1031,
    label: 'NB-Whisper large — best kvalitet, tregest',
  },
  // Original OpenAI Whisper (flerspråklig, ~100 språk) for klipp på andre
  // språk enn norsk — NB-modellene er finjustert på norsk og hopper gjerne
  // over f.eks. engelske partier. Samme kvantisering (q5) fra whisper.cpp-
  // repoet. «large» er large-v3-turbo: nesten large-kvalitet, mye raskere
  // og mindre.
  'whisper-ml-small': {
    file: 'ggml-whisper-small-q5.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    sizeMB: 190,
    label: 'Whisper small (flerspråklig) — rask, god til utkast',
  },
  'whisper-ml-medium': {
    file: 'ggml-whisper-medium-q5.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f',
    sizeMB: 539,
    label: 'Whisper medium (flerspråklig) — bedre på navn og utydelig tale',
  },
  'whisper-ml-large': {
    file: 'ggml-whisper-large-v3-turbo-q5.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    sizeMB: 574,
    label: 'Whisper large-v3-turbo (flerspråklig) — best kvalitet',
  },
  // Taledeteksjon (VAD) for whisper-cli: deler lyden ved pauser i stedet
  // for faste 30-sekunders vinduer. Id-en starter bevisst IKKE med
  // 'whisper-' så den holdes utenfor modellvalg-listene.
  vad: {
    file: 'ggml-silero-v5.1.2.bin',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
    sizeMB: 0.9,
    label: 'Taledeteksjon (Silero VAD)',
  },
};

// Gyldige modellvalg for transkribering, med small som trygg standard
function whisperModelId(requested) {
  return AI_MODELS[requested] && String(requested).startsWith('whisper-')
    ? requested
    : 'whisper-small';
}

function aiModelPath(id) {
  return path.join(app.getPath('userData'), 'models', AI_MODELS[id].file);
}

function aiModelReady(id) {
  const m = AI_MODELS[id];
  if (!m) return false;
  const p = aiModelPath(id);
  if (!fs.existsSync(p)) return false;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  return hash === m.sha256;
}

ipcMain.handle('ai-model-status', async (e, id) => {
  const m = AI_MODELS[id];
  if (!m) return { ok: false, error: 'Ukjent modell: ' + id };
  return { ok: true, ready: aiModelReady(id), sizeMB: m.sizeMB, label: m.label };
});

ipcMain.handle('ai-model-ensure', async (e, id) => {
  const m = AI_MODELS[id];
  if (!m) return { ok: false, error: 'Ukjent modell: ' + id };
  if (aiModelReady(id)) return { ok: true, alreadyDownloaded: true };
  try {
    const buf = await httpGetBuffer(m.url);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== m.sha256) {
      return { ok: false, error: 'Nedlastet modell matcher ikke forventet sjekksum — avbrutt.' };
    }
    fs.mkdirSync(path.dirname(aiModelPath(id)), { recursive: true });
    fs.writeFileSync(aiModelPath(id), buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Én ort-session per modell, gjenbrukes mellom sporinger
const aiSessions = {};
async function getFaceSession() {
  if (!aiSessions.ansikt) {
    const { createSession } = require('./src/face-detect.js');
    aiSessions.ansikt = await createSession(aiModelPath('ansikt'));
  }
  return aiSessions.ansikt;
}

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

  // ── Ansiktsmodus: gjenfinn ansiktet per frame med UltraFace i stedet for
  //    pikselmatch — tåler håndholdt kamera, zoom og lysendringer langt bedre.
  if (opts.mode === 'face') {
    if (!aiModelReady('ansikt')) {
      return { ok: false, error: 'Ansiktsmodellen er ikke lastet ned', needModel: true };
    }
    // 10 fps: fotgjengere nær kamera flytter seg ~75 px/frame ved 5 fps
    // (målt) — dobling halverer spranget og holder assosiasjonen stabil.
    const FPS = 10;
    const MW = 640, MH = 480;
    const scaleF = Math.min(MW / videoW, MH / videoH);
    const dispW = Math.round(videoW * scaleF), dispH = Math.round(videoH * scaleF);
    const padX = Math.floor((MW - dispW) / 2), padY = Math.floor((MH - dispH) / 2);
    const span = to - from;
    const frameBytes = MW * MH * 3;

    const args = [
      '-ss', String(Math.max(0, from)),
      '-i', input,
      '-t', String(span + 0.3),
      '-vf', `fps=${FPS},scale=${MW}:${MH}:force_original_aspect_ratio=decrease,` +
             `pad=${MW}:${MH}:(ow-iw)/2:(oh-ih)/2,format=rgb24`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ];

    let raw;
    try {
      raw = await new Promise((resolve, reject) => {
        send({ phase: 'decoding', percent: 0 });
        const ff = spawn(findFfmpeg(), args);
        const chunks = [];
        let bytes = 0;
        const expected = Math.max(1, Math.ceil(span * FPS)) * frameBytes;
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

    const nFrames = Math.floor(raw.length / frameBytes);
    if (nFrames < 2) return { ok: false, error: 'For få bilder å spore over' };

    try {
      const { trackFace } = require('./src/censor-track-face.js');
      const { simplifyPath } = require('./src/censor-track.js');
      send({ phase: 'tracking', percent: 0 });
      const session = await getFaceSession();
      const res = await trackFace(session, raw, nFrames, {
        x: x * scaleF + padX, y: y * scaleF + padY,
        w: w * scaleF, h: h * scaleF,
      });
      if (!res.ok) return { ok: false, reason: res.reason, error: 'Fant ikke ansikt i maskeområdet' };
      const simplified = simplifyPath(res.path, 2);
      const keyframes = simplified.map(p => ({
        t: Math.round((from + p.i / FPS) * 10) / 10,
        x: Math.round((p.x - padX) / scaleF),
        y: Math.round((p.y - padY) / scaleF),
        s: p.s || 1,
      }));
      send({ phase: 'done', percent: 100 });
      return {
        ok: true,
        keyframes,
        stoppedEarly: res.stoppedEarly,
        trackedTo: from + (res.path[res.path.length - 1].i / FPS),
        mode: 'face',
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Nedskalert analyse: ~480px bredde. 10 fps — 5 var for glissent for
  // motiver nær kamera (målt ~35 px/frame i analyseoppløsning ved 5 fps).
  const FPS = 10;
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
      s: p.s || 1,   // relativ størrelse — masken følger motiv som nærmer/fjerner seg
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
      // Binærfiler (fonter, bilder) markeres med «b64:»-prefiks av
      // build-bundle.js — ren tekst-skriving korrumperer dem ellers.
      if (typeof content === 'string' && content.startsWith('b64:')) {
        fs.writeFileSync(target, Buffer.from(content.slice(4), 'base64'));
      } else {
        fs.writeFileSync(target, String(content), 'utf-8');
      }
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
