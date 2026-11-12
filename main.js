// Faktisk Studio — Electron main process
// Hovedvindu laster src/index.html (Malside-hub). Pluginene ligger i
// plugins/<id>/index.html og navigeres til via window.location.

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, net, Menu } = require('electron');
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

// Dokumenter på disk (.faktisk) — se src/documents-main.js
const docs = require('./src/documents-main.js');
docs.early(app);

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
  docs.register(ipcMain, {
    app, dialog, shell, Menu,
    getWindow: () => mainWindow,
    pluginEntry: (id) => pluginEntryFor(id),
    homeEntry: () => path.join(__dirname, 'src', 'index.html'),
    readAutoState: (id) => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, safeId(id) + '.json'), 'utf-8')).state || null; }
      catch (e) { return null; }
    },
    clearAutoState: (id) => { try { fs.rmSync(path.join(dataDir, safeId(id) + '.json')); } catch (e) {} },
  });
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

function pluginEntryFor(pluginId) {
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
  return candidates.find(p => fs.existsSync(p)) || null;
}

ipcMain.handle('open-plugin', async (e, pluginId) => {
  const found = pluginEntryFor(pluginId);
  if (!found) return { ok: false, error: 'Plugin finnes ikke: ' + pluginId };
  docs.onLeave(); // åpnet fra forsiden: nytt arbeid, ikke et dokument
  mainWindow.loadFile(found);
  return { ok: true };
});

ipcMain.handle('go-home', async () => {
  docs.onLeave();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  return { ok: true };
});

ipcMain.handle('copy-to-clipboard', async (e, text) => {
  // Embed-kode: bilder som Studio har komprimert får AVIF + srcset (se
  // upgradeEmbedImages). Feiler oppslaget, kopieres teksten uendret.
  let out = text, upgraded = 0;
  try {
    const r = await upgradeEmbedImages(String(text == null ? '' : text));
    out = r.text; upgraded = r.count;
  } catch (err) {
    console.warn('[copy-to-clipboard] Kunne ikke oppgradere bilder:', err && err.message);
  }
  clipboard.writeText(out);
  return { ok: true, upgradedImages: upgraded };
});

ipcMain.handle('toggle-fullscreen', async () => {
  const isFull = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFull);
  return { ok: true, fullscreen: !isFull };
});

ipcMain.handle('save-dialog', async (e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, docs.adjustSaveOpts(opts));
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
    if (docs.onStateSave(pluginId, state)) return { ok: true, document: true };
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
    const fromDoc = docs.onStateLoad(pluginId);
    if (fromDoc !== undefined) return fromDoc;
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
  try {
    const list = await labradorListFiles();
    if (list && list.loggedIn) list.files = groupImageVariants(list.files);
    return list;
  }
  catch (err) { return { ok: false, loggedIn: false, error: err.message }; }
});

// ---------- Komprimerte bildevarianter ----------
// Studio laster opp hvert bilde som <navn>-<hash6>-<bredde>.(avif|jpg|webp|png).
// I fillistene til plugins vises bare den største JPG/WebP/PNG-en per bilde;
// de andre variantene ligger på oppføringen som `variants`.
const IMG_VARIANT_RE = /^(.*-[0-9a-f]{6})-(\d+)\.(avif|jpe?g|webp|png)$/i;

function variantGroups(files) {
  const groups = new Map();
  files.forEach(f => {
    const m = IMG_VARIANT_RE.exec(f.name || '');
    if (!m) return;
    const stem = m[1].toLowerCase(), ext = m[3].toLowerCase();
    if (!groups.has(stem)) groups.set(stem, { avif: [], fallback: [] });
    const g = groups.get(stem), v = { w: +m[2], url: f.url, id: f.id };
    const arr = ext === 'avif' ? g.avif : g.fallback;
    if (!arr.some(x => x.w === v.w)) arr.push(v);
  });
  groups.forEach(g => { g.avif.sort((a, b) => a.w - b.w); g.fallback.sort((a, b) => a.w - b.w); });
  return groups;
}

function groupImageVariants(files) {
  const groups = variantGroups(files);
  return files.filter(f => {
    const m = IMG_VARIANT_RE.exec(f.name || '');
    if (!m) return true;
    const g = groups.get(m[1].toLowerCase());
    if (!g.fallback.length) return true;                 // bare AVIF: vis som den er
    const top = g.fallback[g.fallback.length - 1];
    if (f.url !== top.url) return false;                  // skjul AVIF og mindre størrelser
    f.variants = {
      avif: g.avif.map(v => ({ w: v.w, url: v.url })),
      fallback: g.fallback.map(v => ({ w: v.w, url: v.url })),
    };
    return true;
  });
}

let variantIndexCache = null;
async function labradorVariantIndex(force) {
  if (!force && variantIndexCache && Date.now() - variantIndexCache.t < 60000) return variantIndexCache;
  const list = await labradorListFiles();
  if (!list.loggedIn) return null;
  const norm = u => { u = String(u || '').trim(); try { u = decodeURI(u); } catch (e) {} return u.replace(/^https?:\/\//i, '').toLowerCase(); };
  const groups = variantGroups(list.files), byUrl = new Map();
  list.files.forEach(f => {
    const m = IMG_VARIANT_RE.exec(f.name || '');
    if (m) byUrl.set(norm(f.url), { group: groups.get(m[1].toLowerCase()), ext: m[3].toLowerCase() });
  });
  variantIndexCache = { t: Date.now(), byUrl, norm };
  return variantIndexCache;
}

// Bytter <img src="…-hash-bredde.jpg"> i embed-kode til
// <picture style="display:contents"><source type="image/avif" srcset=…><img srcset=…></picture>.
// display:contents gjør at <picture> ikke påvirker layout. Rører ikke
// <img> som allerede har srcset, eller noe inne i <script>.
// Plugins kan styre `sizes` med data-fk-sizes på <img>.
async function upgradeEmbedImages(text) {
  if (!/<img\b/i.test(text) || !/\/files\//i.test(text)) return { text, count: 0 };
  const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
  let idx = await withTimeout(labradorVariantIndex(false), 5000);
  if (!idx) return { text, count: 0 };
  const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const escA = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const srcOf = tag => { const m = /\ssrc\s*=\s*(["'])(.*?)\1/i.exec(tag); return m ? unesc(m[2]) : null; };
  const candidates = [];
  text.replace(/<img\b[^>]*>/gi, t => { const u = srcOf(t); if (u && IMG_VARIANT_RE.test(u.split('/').pop().split('?')[0])) candidates.push(u); return t; });
  if (!candidates.length) return { text, count: 0 };
  // Nylig opplastet og ikke i hurtigbufferen ennå: hent lista på nytt én gang
  if (candidates.some(u => !idx.byUrl.has(idx.norm(u)))) idx = (await withTimeout(labradorVariantIndex(true), 5000)) || idx;

  let count = 0;
  const parts = text.split(/(<script\b[\s\S]*?<\/script>)/i);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/<img\b[^>]*>/gi, tag => {
      if (/\ssrcset\s*=/i.test(tag)) return tag;
      const src = srcOf(tag);
      const hit = src && idx.byUrl.get(idx.norm(src));
      if (!hit || !hit.group || !hit.group.fallback.length) return tag;
      const g = hit.group;
      const sm = /\sdata-fk-sizes\s*=\s*(["'])(.*?)\1/i.exec(tag);
      const sizes = sm ? unesc(sm[2]) : '(max-width: 1100px) 100vw, 1100px';
      const set = arr => arr.map(v => escA(String(v.url).replace(/ /g, '%20')) + ' ' + v.w + 'w').join(', ');
      let img = tag;
      // Valgt AVIF direkte: la <img> peke på JPG/WebP så eldre nettlesere også får bilde
      if (hit.ext === 'avif') {
        const top = g.fallback[g.fallback.length - 1];
        img = img.replace(/(\ssrc\s*=\s*)(["'])(.*?)\2/i, (m0, a) => a + '"' + escA(String(top.url).replace(/ /g, '%20')) + '"');
      }
      img = img.replace(/\s*\/?>$/, ' srcset="' + set(g.fallback) + '" sizes="' + escA(sizes) + '">');
      count++;
      return g.avif.length
        ? '<picture style="display:contents"><source type="image/avif" srcset="' + set(g.avif) + '" sizes="' + escA(sizes) + '">' + img + '</picture>'
        : img;
    });
  }
  return { text: parts.join(''), count };
}

// Filvelger + opplasting i én operasjon. Returnerer URL-en til den nye fila
// ved å slå opp i list-files etterpå (upload-responsen er ikke dokumentert).
ipcMain.handle('labrador-upload', async (e, opts) => {
  const filters = (opts && opts.filters) || [
    { name: 'Medier', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp', 'avif', 'heic', 'mp4', 'mpg', 'pdf'] },
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

  // Bilder komprimeres før opplasting: AVIF + JPG/WebP i 1200 og 2400 px,
  // med kvalitet valgt per bilde (se src/image-optimize.js). Plugins kan be
  // om originalen med { optimize: false } (Alt-klikk på «Last opp…»).
  // Feiler noe (f.eks. HEIC som sharp ikke leser), lastes originalen opp.
  if (!opts || opts.optimize !== false) {
    const optim = require('./src/image-optimize');
    if (optim.OPTIMIZABLE.test(fileName)) {
      const totalMB = (stat.size / 1048576).toFixed(1);
      const note = (label, percent) => {
        try { mainWindow && mainWindow.webContents.send('labrador-upload-progress', { percent, label, sentMB: '0.0', totalMB }); } catch (e) {}
      };
      try {
        const r = await optim.optimizeImage(filePath, fileName, note);
        if (r) return await labradorUploadOptimized(r, note);
      } catch (err) {
        console.warn('[labrador-upload] Bildeoptimalisering feilet, laster opp originalen:', err && err.message);
      }
    }
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
    '.webp': 'image/webp',
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

// Sender én fil til Labrador uten å slå opp URL-en etterpå.
async function labradorPostBuffer(fileName, buffer, contentType) {
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
  if (res.status === 301 || res.status === 302) return { ok: false, loggedIn: false, status: res.status };
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: 'HTTP ' + res.status, status: res.status, body: res.body };
  }
  return { ok: true, status: res.status, body: res.body };
}

// Enkel buffer-opplasting (små filer, ingen fremdrift). Returnerer URL
// ved å slå opp i list-files etterpå.
async function labradorUploadBuffer(fileName, buffer, contentType) {
  const posted = await labradorPostBuffer(fileName, buffer, contentType);
  if (!posted.ok) return posted;
  const list = await labradorListFiles();
  const hit = list.loggedIn && list.files.find(f => f.name === fileName);
  return hit
    ? { ok: true, url: hit.url, id: hit.id }
    : { ok: true, url: null };
}

// Laster opp de komprimerte variantene fra optimizeImage. Filnavnene har en
// kort hash av originalen, så samme bilde lastet opp på nytt gjenbruker
// filene som allerede ligger i Labrador i stedet for å lage duplikater.
async function labradorUploadOptimized(r, note) {
  variantIndexCache = null;
  const list0 = await labradorListFiles();
  if (!list0.loggedIn) {
    return { ok: false, loggedIn: false,
      error: 'Ikke innlogget i Labrador. Åpne «Mine filer ▾» og trykk «Koble til Labrador…» først.' };
  }
  // Labrador kan endre filnavn litt (store/små bokstaver, tegn), så vi
  // sammenligner på en normalisert form – og faller tilbake på rekkefølgen
  // til filene som er nye siden før opplastingen.
  const norm = n => String(n || '').toLowerCase().normalize('NFC').replace(/[^a-z0-9æøå.]/g, '');
  const maxId0 = list0.files.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
  const have = new Map(list0.files.map(f => [norm(f.name), f]));
  const todo = r.files.filter(f => !have.has(norm(f.name)));
  const replies = [];
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    note('Laster opp ' + (i + 1) + ' av ' + todo.length + ' (' + Math.round(f.buffer.length / 1024) + ' KB)…',
      90 + Math.round(i / todo.length * 10));
    const res = await labradorPostBuffer(f.name, f.buffer, f.mime);
    replies.push(f.name + ' → ' + (res.status || '') + ' ' + String(res.body || '').slice(0, 160));
    if (!res.ok) {
      return res.loggedIn === false
        ? { ok: false, loggedIn: false, error: 'Ikke innlogget i Labrador.' }
        : { ok: false, error: 'Opplasting av ' + f.name + ' feilet (' + (res.error || 'ukjent feil') + ')' };
    }
  }

  // Slå opp URL-ene. Labrador bruker av og til litt tid før nye filer
  // vises i lista, så vi prøver noen ganger.
  const findAll = list => {
    const byName = new Map(list.files.map(f => [norm(f.name), f]));
    const fresh = list.files.filter(f => (Number(f.id) || 0) > maxId0)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const urls = new Map();
    r.files.forEach(f => {
      const hit = byName.get(norm(f.name)) || have.get(norm(f.name));
      if (hit) urls.set(f.name, hit.url);
    });
    // Ingen navnetreff, men like mange nye filer som vi sendte: bruk rekkefølgen
    const missing = todo.filter(f => !urls.has(f.name));
    if (missing.length && fresh.length === todo.length) {
      todo.forEach((f, i) => { if (!urls.has(f.name)) urls.set(f.name, fresh[i].url); });
    }
    return { urls, fresh };
  };
  let list = list0, found = findAll(list0);
  for (let attempt = 0; todo.length && attempt < 6; attempt++) {
    if (attempt) { note('Venter på at Labrador viser filene…', 99); await new Promise(res => setTimeout(res, 1500)); }
    list = await labradorListFiles();
    if (!list.loggedIn) break;
    found = findAll(list);
    if (r.files.every(f => found.urls.has(f.name))) break;
  }

  const pick = kind => r.files.filter(f => f.kind === kind).map(f => ({
    w: f.w, h: f.h, bytes: f.buffer.length, url: found.urls.get(f.name) || null,
  })).filter(v => v.url);
  const avif = pick('avif'), fallback = pick('fallback');
  const top = fallback[fallback.length - 1];
  if (!top) {
    const newest = (list.files || []).slice(0, 8).map(f => f.id + ': ' + f.name);
    console.warn('[labrador-upload] Komprimerte filer ikke funnet i lista.',
      '\n  sendt:', todo.map(f => f.name + ' (' + f.mime + ')').join(', '),
      '\n  svar:', replies.join('\n         '),
      '\n  nyeste i lista:', newest.join(' | '));
    return { ok: false,
      error: 'Labrador svarte OK, men de komprimerte filene dukket ikke opp i lista.\n\n'
        + 'Sendt: ' + todo.map(f => f.name).join(', ') + '\n\n'
        + 'Svar fra Labrador: ' + (replies[0] || '–') + '\n\n'
        + 'Nyeste filer i Labrador: ' + (newest.join(' | ') || '–') + '\n\n'
        + 'Alt-klikk «Last opp…» for å laste opp originalen i mellomtiden.' };
  }
  note('Ferdig', 100);
  const topAvif = avif[avif.length - 1];
  return {
    ok: true, optimized: true,
    name: r.files.filter(f => f.kind === 'fallback').pop().name,
    url: top.url,
    variants: { avif, fallback, fallbackType: r.fallbackMime, width: r.width, height: r.height },
    stats: {
      origBytes: r.origBytes, fallbackBytes: top.bytes, avifBytes: topAvif ? topAvif.bytes : null,
      quality: r.quality, reused: r.files.length - todo.length,
    },
  };
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

// ============================================================
//  Video-eksport av HTML-embeds (Chatbobler m.fl.) — se src/dom-video-export.js
// ============================================================
let domVideoCancelled = false, domVideoBusy = false;
ipcMain.handle('dom-video-export', async (e, opts) => {
  if (!opts || !opts.html || !opts.savePath) return { ok: false, error: 'Mangler embed-kode eller filnavn' };
  if (domVideoBusy) return { ok: false, error: 'En video-eksport kjører allerede' };
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  const { exportDomVideo } = require('./src/dom-video-export');
  domVideoCancelled = false; domVideoBusy = true;
  const sender = e.sender;
  try {
    return await exportDomVideo(opts, {
      BrowserWindow,
      ffmpegPath: findFfmpeg(),
      onProgress: msg => { try { if (!sender.isDestroyed()) sender.send('dom-video-export-progress', msg); } catch (err) {} },
      isCancelled: () => domVideoCancelled,
    });
  } finally {
    domVideoBusy = false;
  }
});
ipcMain.handle('dom-video-export-cancel', async () => { domVideoCancelled = true; return { ok: true }; });

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
    // Apples ProRes-koder: alfakanalen blir gjenkjent av Final Cut (prores_ks ble ikke det)
    ? ['-c:v', 'prores_videotoolbox', '-profile:v', '4444', '-allow_sw', '1', '-pix_fmt', 'bgra',
       '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']
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

// Transkriberingsflyten (lyd → segmenter, pass 1 + hull-pass) ligger i
// src/transcribe-pipeline.js — testbar fra Terminal: node scripts/test-transcribe.js
const transcribePipeline = require('./src/transcribe-pipeline.js');

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
    wavFile = outPrefix + '.wav';
    await transcribePipeline.extractAudioWav(findFfmpeg(), input, wavFile);
    send({ phase: 'extracting-audio', percent: 100 });

    // Språk: 'no' (standard), 'auto' (autodeteksjon) eller ISO-kode.
    // Oversettelse: Whispers innebygde translate-oppgave — går KUN til
    // engelsk, fra hvilket som helst språk.
    const lang = /^([a-z]{2,3}|auto)$/.test(String(opts.language || ''))
      ? opts.language : 'no';
    // Manus-hint (fra teksting-pluginen): navn og fagord, så whisper staver dem riktig
    const prompt = typeof opts.prompt === 'string'
      ? opts.prompt.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
      : '';

    // Pass 1 + hull-pass: se src/transcribe-pipeline.js
    const segments = await transcribePipeline.transcribeWav({
      cli, ffmpeg: findFfmpeg(), wav: wavFile,
      model: aiModelPath(modelId), vadModel: aiModelPath('vad'),
      lang, translate: opts.translate === true, prompt,
      tmpPrefix: outPrefix, send,
    });

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

// Skjermarkiv (Studio 0.7.8): skann mappe, nøkkelbilder, tekstlesing med
// Apple Vision og lagring av arkiver — se src/skjermarkiv-main.js
require('./src/skjermarkiv-main.js').register(ipcMain, { app, findFfmpeg });

// Bevissikring: sikringsvindu, skjermbilder, PDF/MHTML, yt-dlp og sjekksummer
// — se src/bevis-main.js
require('./src/bevis-main.js').register(ipcMain, { app, findFfmpeg });
require('./src/bevis-sample.js').register(ipcMain, { app });
require('./src/bevis-link.js').register(ipcMain);
require('./src/bevis-profile.js').register(ipcMain, { app });
require('./src/bevis-extra.js').register(ipcMain, { app });
require('./src/bevis-view.js').register(ipcMain);
require('./src/bevis-index.js').register(ipcMain, { app, findFfmpeg });

// Videoslider (Studio 0.7.14): de siste videoene fra en TikTok-profil, og valgte
// videoer lastet ned med yt-dlp (fra bevissikringen) og lagt i Labrador — se src/tiktok-main.js
require('./src/tiktok-main.js').register(ipcMain, { app, findFfmpeg, labradorListFiles, labradorSafeName, labradorCookieHeader, labradorOrigin: LABRADOR_ORIGIN });
