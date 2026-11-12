// Faktisk Studio — dokumenter på disk (.faktisk)
//
// Et dokument er én fil i en vanlig mappe i Finder, med mediefiler og
// eksporter ved siden av:
//
//   SUJO samling 1/
//     Presentasjon.faktisk      ← dette dokumentet
//     Medier/                   ← filer kopiert inn via documentImportMedia
//     Eksport/                  ← standardmappe for lagringsdialoger
//
// Pluginene trenger ingen endringer for å lagre: de sender allerede hele
// tilstanden sin via state-save ved hver endring. Når et dokument er åpent
// for den pluginen, skrives tilstanden til dokumentfila i stedet for til
// userData/state. Uten åpent dokument virker alt som før.

const path = require('path');
const fs = require('fs');

const EXT = 'faktisk';
const FORMAT = 'faktisk-studio-dokument';

let current = null;          // { path, pluginId, name }
let pendingOpen = [];        // filer macOS ba oss åpne før appen var klar
let ctx = null;              // { app, dialog, shell, Menu, getWindow, pluginEntry, homeEntry, readAutoState }
let writeTimer = null, lastState = null;

// Siste mappe et dokument ble lagret i eller åpnet fra. Standard er hjemmemappa,
// ikke Dokumenter — den er ofte synket med iCloud, og da kan mediefiler bli
// liggende bare i skyen når Studio eller Keynote trenger dem.
function lastFolderFile() { return path.join(ctx.app.getPath('userData'), 'last-document-folder.txt'); }
function lastFolder() {
  try { const d = fs.readFileSync(lastFolderFile(), 'utf-8').trim(); if (d && fs.existsSync(d)) return d; } catch (e) {}
  return ctx.app.getPath('home');
}
function rememberFolder(p) {
  // Husk mappa som INNEHOLDER prosjektmappa, så neste prosjekt havner ved siden av
  try { fs.writeFileSync(lastFolderFile(), path.dirname(path.dirname(p)), 'utf-8'); } catch (e) {}
}

function docName(p) { return path.basename(p, '.' + EXT); }
function folderOf(p) { return path.dirname(p); }

// ---- mediefiler i dokumentet --------------------------------------------------
//
// Lokale bilder, video og lyd som tilstanden peker på, kopieres inn i Medier/
// ved siden av dokumentet. I fila lagres stiene relativt til dokumentmappa
// ({{dokumentmappe}}/Medier/…), så prosjektet virker etter at mappa er flyttet
// eller sendt til noen andre. Pluginene ser alltid vanlige, fulle stier.

const MEDIA_EXT = /\.(mov|mp4|m4v|webm|mpg|mpeg|avi|mkv|mp3|wav|m4a|aac|ogg|png|jpe?g|gif|webp|avif|heic|tiff?|bmp|svg|pdf)$/i;
const TOKEN = '{{dokumentmappe}}';
let copied = new Map();   // kilde → kopi i Medier/, for dokumentet som er åpent

function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => mapStrings(x, fn));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = mapStrings(v[k], fn); return o; }
  return v;
}

function copyIntoMedia(src, folder) {
  const dir = path.join(folder, 'Medier');
  if (path.dirname(src) === dir) return src;
  if (copied.has(src) && fs.existsSync(copied.get(src))) return copied.get(src);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(src), stem = path.basename(src, ext);
  let target = path.join(dir, stem + ext), n = 2;
  while (fs.existsSync(target)) {
    // Samme fil kopiert tidligere (samme navn og størrelse) brukes om igjen
    try { if (fs.statSync(target).size === fs.statSync(src).size) { copied.set(src, target); return target; } } catch (e) {}
    target = path.join(dir, stem + ' ' + n++ + ext);
  }
  fs.copyFileSync(src, target);
  copied.set(src, target);
  return target;
}

// Kopier lokale mediefiler som ligger utenfor dokumentmappa inn i Medier/
function collectMedia(state, folder) {
  return mapStrings(state, (str) => {
    let p = str, isUrl = false;
    if (str.startsWith('file://')) { try { p = decodeURI(str.slice(7)); isUrl = true; } catch (e) { return str; } }
    if (!p.startsWith('/') || !MEDIA_EXT.test(p) || p.startsWith(folder + path.sep)) return str;
    try { if (!fs.statSync(p).isFile()) return str; } catch (e) { return str; }
    try {
      const t = copyIntoMedia(p, folder);
      return isUrl ? 'file://' + encodeURI(t).replace(/#/g, '%23') : t;
    } catch (e) { console.error('[dokument] kunne ikke kopiere', p, e.message); return str; }
  });
}

let relinks = new Map();  // savnet fil → ny plassering valgt av brukeren

function useCopies(state) {
  if (!copied.size) return state;
  return mapStrings(state, (str) => {
    for (const [src, dst] of copied) {
      if (str === src) return dst;
      if (str === 'file://' + encodeURI(src).replace(/#/g, '%23')) return 'file://' + encodeURI(dst).replace(/#/g, '%23');
    }
    return str;
  });
}
function useRelinks(state) {
  if (!relinks.size) return state;
  return mapStrings(state, (str) => {
    for (const [from, to] of relinks) {
      if (str === from) return to;
      if (str === 'file://' + encodeURI(from).replace(/#/g, '%23')) return 'file://' + encodeURI(to).replace(/#/g, '%23');
    }
    return str;
  });
}

// Pluginens manifest: "media": "lokal" (alt skal ligge på maskinen, f.eks.
// Keynote-klipp og Presentasjon) eller "labrador" (embeds som lenker til
// Labrador). Uten feltet oppfører dokumentet seg som "lokal".
function mediaMode(pluginId) {
  try {
    const entry = ctx.pluginEntry(pluginId);
    const m = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'manifest.json'), 'utf-8'));
    return m.media === 'labrador' ? 'labrador' : 'lokal';
  } catch (e) { return 'lokal'; }
}

const WEB_MEDIA = /^https?:\/\/\S+\.(mov|mp4|m4v|webm|mp3|wav|m4a|png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i;
function webMedia(state) {
  const out = new Set();
  mapStrings(state, (str) => { if (WEB_MEDIA.test(str) || /^https:\/\/player\.mux\.com\//.test(str)) out.add(str); return str; });
  return [...out];
}

// Alle lokale mediefiler tilstanden peker på
function mediaPaths(state) {
  const out = new Set();
  mapStrings(state, (str) => {
    let p = str;
    if (str.startsWith('file://')) { try { p = decodeURI(str.slice(7)); } catch (e) { return str; } }
    if (p.startsWith('/') && MEDIA_EXT.test(p)) out.add(p);
    return str;
  });
  return [...out];
}

function listMedia() {
  if (!current) return null;
  flush();
  let state = null;
  try { state = readDoc(current.path).state; } catch (e) { return null; }
  const folder = path.dirname(current.path), dir = path.join(folder, 'Medier');
  const files = mediaPaths(state).map((p) => {
    let exists = false, size = 0;
    try { const st = fs.statSync(p); exists = st.isFile(); size = st.size; } catch (e) {}
    return { path: p, name: path.basename(p), inside: p.startsWith(dir + path.sep),
             where: p.startsWith(dir + path.sep) ? 'Medier/' : path.dirname(p).replace(ctx.app.getPath('home'), '~'),
             exists, size };
  });
  const mode = mediaMode(current.pluginId);
  for (const u of webMedia(state)) {
    files.push({ path: u, name: decodeURIComponent(u.split('?')[0].split('/').pop() || u), web: true,
                 inside: false, exists: true, where: new URL(u).host });
  }
  return { copyMedia: current.settings.copyMedia !== false, mode, files };
}

function notifyMedia() {
  const win = ctx && ctx.getWindow();
  if (win && current) win.webContents.send('document-media-changed');
}

// Skriv dokumentet på nytt med endringene og last pluginen, så den ser nye stier
function rewriteAndReload() {
  const payload = readDoc(current.path);
  writeDoc(current.path, current.pluginId, lastState !== null ? lastState : payload.state, current.settings);
  lastState = null;
  const win = ctx.getWindow(); if (win) win.webContents.reload();
}

function toStored(state, folder) {
  const enc = 'file://' + encodeURI(folder);
  return mapStrings(state, (str) => str.split(folder + path.sep).join(TOKEN + '/').split(enc + '/').join('file://' + TOKEN + '/'));
}
function fromStored(state, folder) {
  return mapStrings(state, (str) => str.includes(TOKEN)
    ? str.split('file://' + TOKEN + '/').join('file://' + encodeURI(folder) + '/').split(TOKEN + '/').join(folder + path.sep)
    : str);
}

function readDoc(p) {
  const payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!payload || payload.format !== FORMAT || !payload.pluginId) {
    throw new Error('Fila er ikke et Faktisk Studio-dokument.');
  }
  payload.state = fromStored(payload.state, path.dirname(p));
  return payload;
}

// Skriv atomisk (tmp + rename), så en krasj midt i ikke ødelegger dokumentet
function writeDoc(p, pluginId, state, settings) {
  const folder = path.dirname(p);
  settings = Object.assign({ copyMedia: true }, settings || {});
  // Kopier inn alt (standard), eller bare filer brukeren har valgt «Kopier inn» for
  let st = settings.copyMedia ? collectMedia(state, folder) : useCopies(state);
  st = useRelinks(st);
  const payload = {
    format: FORMAT,
    schemaVersion: 1,
    pluginId,
    name: docName(p),
    savedAt: new Date().toISOString(),
    appVersion: ctx.app.getVersion(),
    settings,
    state: toStored(st, folder),
  };
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

function updateWindow() {
  const win = ctx.getWindow();
  if (!win) return;
  if (current) {
    win.setTitle(current.name + ' — Faktisk Studio');
    // macOS: dokumentikon i tittellinja; ⌘-klikk viser mappa
    try { win.setRepresentedFilename(current.path); } catch (e) {}
  } else {
    win.setTitle('Faktisk Studio');
    try { win.setRepresentedFilename(''); } catch (e) {}
  }
}

function flush() {
  clearTimeout(writeTimer); writeTimer = null;
  if (current && lastState !== null) {
    try { writeDoc(current.path, current.pluginId, lastState, current.settings); lastState = null; notifyMedia(); }
    catch (e) { console.error('[dokument] kunne ikke lagre', e); }
  }
}

function setCurrent(doc) {
  flush();
  if (!doc || !current || doc.path !== current.path) { copied = new Map(); relinks = new Map(); }
  current = doc; lastState = null;
  updateWindow();
  const win = ctx.getWindow();
  if (win) win.webContents.send('document-changed', info());
}

// ---- kalles fra main.js sine state-save / state-load -----------------------

// Returnerer true når tilstanden ble tatt hånd om av et åpent dokument
// (da skal den IKKE skrives til userData, så ulagret arbeid der beholdes).
function onStateSave(pluginId, state) {
  if (!current || current.pluginId !== pluginId) return false;
  lastState = state;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 400);
  return true;
}

function onStateLoad(pluginId) {
  if (!current || current.pluginId !== pluginId) return undefined;
  try {
    const payload = readDoc(current.path);
    return { ok: true, state: payload.state || null, savedAt: payload.savedAt, document: info() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Når brukeren åpner en plugin fra forsiden eller går hjem, lukkes dokumentet
function onLeave() { setCurrent(null); }

// Lagringsdialoger starter i Eksport/ ved siden av dokumentet
function adjustSaveOpts(opts) {
  opts = Object.assign({}, opts || {});
  if (!current) return opts;
  const exportDir = path.join(folderOf(current.path), 'Eksport');
  const base = opts.defaultPath ? path.basename(opts.defaultPath) : '';
  if (!opts.defaultPath || !path.isAbsolute(opts.defaultPath)) {
    try { fs.mkdirSync(exportDir, { recursive: true }); } catch (e) {}
    opts.defaultPath = path.join(exportDir, base);
  }
  return opts;
}

function info() {
  if (!current) return null;
  const folder = folderOf(current.path);
  return {
    path: current.path, name: current.name, pluginId: current.pluginId, folder,
    mediaDir: path.join(folder, 'Medier'), exportDir: path.join(folder, 'Eksport'),
  };
}

// ---- åpne / ny / lagre -------------------------------------------------------

function openDocument(p) {
  if (!ctx || !ctx.app.isReady() || !ctx.getWindow()) { pendingOpen.push(p); return { ok: true, queued: true }; }
  let payload;
  try { payload = readDoc(p); }
  catch (e) {
    ctx.dialog.showMessageBox(ctx.getWindow(), { type: 'warning', message: 'Kunne ikke åpne «' + path.basename(p) + '»', detail: e.message });
    return { ok: false, error: e.message };
  }
  const entry = ctx.pluginEntry(payload.pluginId);
  if (!entry) {
    const msg = 'Dokumentet er laget med pluginen «' + payload.pluginId + '», som ikke er installert. Installer den via (+) på forsiden.';
    ctx.dialog.showMessageBox(ctx.getWindow(), { type: 'warning', message: 'Mangler plugin', detail: msg });
    return { ok: false, error: msg };
  }
  setCurrent({ path: p, pluginId: payload.pluginId, name: docName(p), settings: Object.assign({ copyMedia: true }, payload.settings || {}) });
  ctx.app.addRecentDocument(p);
  ctx.getWindow().loadFile(entry);
  return { ok: true };
}

async function openDialog() {
  const res = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
    title: 'Åpne dokument',
    defaultPath: lastFolder(),
    properties: ['openFile'],
    filters: [{ name: 'Faktisk Studio-dokument', extensions: [EXT] }],
  });
  if (!res.canceled && res.filePaths[0]) openDocument(res.filePaths[0]);
}

// Hvilken plugin vises nå? Leses fra adressen i vinduet (plugins/<id>/index.html)
function activePluginId() {
  const win = ctx.getWindow(); if (!win) return null;
  const m = /\/plugins\/([^/]+)\/[^/]*$/.exec(decodeURIComponent(win.webContents.getURL() || ''));
  return m ? m[1] : null;
}

async function saveAs() {
  const pluginId = current ? current.pluginId : activePluginId();
  if (!pluginId) {
    ctx.dialog.showMessageBox(ctx.getWindow(), { type: 'info', message: 'Åpne en plugin først', detail: 'Det er arbeidet i en plugin som lagres som dokument.' });
    return;
  }
  flush();
  const state = current ? readDoc(current.path).state : ctx.readAutoState(pluginId);
  const res = await ctx.dialog.showSaveDialog(ctx.getWindow(), {
    title: current ? 'Lagre som' : 'Lagre dokument',
    defaultPath: current ? path.join(folderOf(current.path), current.name + ' kopi.' + EXT)
                         : path.join(lastFolder(), 'Uten navn.' + EXT),
    filters: [{ name: 'Faktisk Studio-dokument', extensions: [EXT] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    message: 'Tips: lag en mappe per prosjekt. Medier og eksporter legges ved siden av dokumentet.',
  });
  if (res.canceled || !res.filePath) return;
  let p = res.filePath; if (!p.toLowerCase().endsWith('.' + EXT)) p += '.' + EXT;
  const settings = current ? Object.assign({}, current.settings) : { copyMedia: mediaMode(pluginId) !== 'labrador' };
  try { writeDoc(p, pluginId, state, settings); }
  catch (e) { ctx.dialog.showMessageBox(ctx.getWindow(), { type: 'error', message: 'Kunne ikke lagre', detail: e.message }); return; }
  // Videre arbeid går til det nye dokumentet. Pluginen er allerede lastet med
  // samme tilstand, så vi bytter bare mål uten å laste på nytt.
  setCurrent({ path: p, pluginId, name: docName(p), settings });
  ctx.app.addRecentDocument(p);
  rememberFolder(p);
  // Last pluginen på nytt fra dokumentet, så den bruker kopiene i Medier/
  const win = ctx.getWindow(); if (win) win.webContents.reload();
}

function save() { if (current) flush(); else saveAs(); }

function newDocument() {
  const pluginId = current ? current.pluginId : activePluginId();
  setCurrent(null);
  if (pluginId) ctx.clearAutoState(pluginId);
  const win = ctx.getWindow();
  if (win) win.webContents.reload();
}

function importMedia(filePaths) {
  if (!current) return { ok: false, error: 'Ingen dokument er åpent' };
  const dir = path.join(folderOf(current.path), 'Medier');
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const src of [].concat(filePaths || [])) {
    // Ligger fila allerede i Medier/, brukes den som den er
    if (path.dirname(path.resolve(src)) === dir) { out.push(src); continue; }
    const ext = path.extname(src), stem = path.basename(src, ext);
    let target = path.join(dir, stem + ext), n = 2;
    while (fs.existsSync(target)) target = path.join(dir, stem + ' ' + n++ + ext);
    fs.copyFileSync(src, target);
    out.push(target);
  }
  return { ok: true, paths: out };
}

// ---- meny --------------------------------------------------------------------

function buildMenu() {
  const { Menu, shell } = ctx;
  const template = [
    { role: 'appMenu' },
    {
      label: 'Arkiv',
      submenu: [
        { label: 'Ny', accelerator: 'CmdOrCtrl+N', click: newDocument },
        { label: 'Åpne…', accelerator: 'CmdOrCtrl+O', click: openDialog },
        { label: 'Åpne sist brukte', role: 'recentDocuments', submenu: [{ label: 'Tøm meny', role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Lukk', accelerator: 'CmdOrCtrl+W', click: () => { setCurrent(null); const w = ctx.getWindow(); if (w) w.loadFile(ctx.homeEntry()); } },
        { label: 'Lagre', accelerator: 'CmdOrCtrl+S', click: save },
        { label: 'Lagre som…', accelerator: 'Shift+CmdOrCtrl+S', click: saveAs },
        { type: 'separator' },
        { label: 'Vis i Finder', click: () => { if (current) shell.showItemInFolder(current.path); } },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- oppsett -----------------------------------------------------------------

// Må kalles før app er klar, så dobbeltklikk i Finder ved oppstart fanges opp
function early(app) {
  app.on('open-file', (e, p) => { e.preventDefault(); openDocument(p); });
}

function register(ipcMain, c) {
  ctx = c;
  buildMenu();
  ipcMain.handle('document-info', async () => info());
  ipcMain.handle('document-import-media', async (e, filePaths) => {
    try { return importMedia(filePaths); } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('document-save', async () => { save(); return { ok: true }; });
  ipcMain.handle('document-media-list', async () => listMedia());
  ipcMain.handle('document-media-reveal', async (e, p) => { if (p && fs.existsSync(p)) ctx.shell.showItemInFolder(p); return { ok: true }; });
  ipcMain.handle('document-media-copy', async (e, p) => {
    if (!current) return { ok: false };
    try { copyIntoMedia(p, path.dirname(current.path)); rewriteAndReload(); return { ok: true }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('document-media-relink', async (e, p) => {
    if (!current) return { ok: false };
    const ext = path.extname(p).slice(1);
    const res = await ctx.dialog.showOpenDialog(ctx.getWindow(), {
      title: 'Finn «' + path.basename(p) + '»', defaultPath: path.dirname(p),
      properties: ['openFile'], filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    relinks.set(p, res.filePaths[0]);
    try { rewriteAndReload(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('document-set-copy-media', async (e, on) => {
    if (!current) return { ok: false };
    current.settings = Object.assign({}, current.settings, { copyMedia: !!on });
    try { rewriteAndReload(); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('document-reveal', async () => { if (current) ctx.shell.showItemInFolder(current.path); return { ok: !!current }; });
  ipcMain.handle('document-save-as', async () => { await saveAs(); return { ok: true, document: info() }; });
  ipcMain.handle('document-open', async (e, p) => (p ? openDocument(p) : (await openDialog(), { ok: true })));
  ctx.app.on('before-quit', flush);
  // Pluginens <title> skal ikke overskrive dokumentnavnet i tittellinja
  const win = ctx.getWindow();
  if (win) win.on('page-title-updated', (e) => { if (current) { e.preventDefault(); updateWindow(); } });
  const queued = pendingOpen; pendingOpen = [];
  if (queued.length) openDocument(queued[queued.length - 1]);
}

module.exports = { early, register, onStateSave, onStateLoad, onLeave, adjustSaveOpts, info };
