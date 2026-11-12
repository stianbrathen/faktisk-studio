// Faktisk Studio · Bevissikring — kobling til Chrome-utvidelsen
//
// To veier inn til Studio fra nettleseren:
//
// 1) Lokal tjeneste på 127.0.0.1:47361 (bare maskinen selv). Brukes når Studio
//    kjører. Krever koble-koden (X-Faktisk-Token) som vises i pluginen, og
//    avviser forespørsler fra vanlige nettsider (Origin må være en
//    chrome-extension://, og CORS-preflight besvares aldri).
//      GET  /status    versjon, saker, siste jobber
//      POST /download  { url, case, note }            → yt-dlp i bakgrunnen
//      POST /capture   { url, case, note, screenshot, mhtml, text, … }
//                      → siden slik den ser ut i Chrome, med manifest og sjekksum
//
// 2) Egen adresse faktisk-studio://last-ned?url=… (starter Studio om den ikke
//    kjører). Den kan lages av hvilken som helst nettside, så Studio spør
//    ALLTID før noe lastes ned.
//
// Jobbene kjøres én og én i kø. Ferdig/feil gir varsel i macOS.

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, dialog, Notification, BrowserWindow, shell } = require('electron');

const PORT = 47361;
const SCHEME = 'faktisk-studio';
const MAX_BODY = 300 * 1024 * 1024;

let H = null;
let cfg = null;
let server = null;
let serverError = '';
let lastSeen = null;
let jobs = [];
let queue = Promise.resolve();
const pendingUrls = [];

// ------------------------------------------------------------
//  Innstillinger (koble-kode, arkiv, sist brukte sak)
// ------------------------------------------------------------
function cfgFile() { return path.join(app.getPath('userData'), 'bevis-link.json'); }
function newToken() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) { s += a[b[i] % a.length]; if (i === 3) s += '-'; }
  return s;
}
function loadCfg() {
  if (cfg) return cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { cfg = {}; }
  if (!cfg.token) { cfg.token = newToken(); saveCfg(); }
  return cfg;
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 }); } catch (e) {}
}
// Ingen stille standardmappe: arkivet må være valgt i Bevissikring
function archiveRoot() { return loadCfg().root || ''; }
function rootProblem() {
  const r = archiveRoot();
  if (!r) return 'Velg arkivmappe i Bevissikring i Faktisk Studio først';
  if (!fs.existsSync(r)) return 'Arkivmappa er ikke tilgjengelig (låst kryptert arkiv?) — åpne Bevissikring i Studio';
  return '';
}
// Versjonen av utvidelsen som følger med pluginen — popupen sammenligner
function bundledExtVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(findExtensionSource(), 'manifest.json'), 'utf8')).version || ''; } catch (e) { return ''; }
}
function listCases() {
  try {
    return fs.readdirSync(archiveRoot(), { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map(e => e.name).sort((a, b) => a.localeCompare(b, 'nb'));
  } catch (e) { return []; }
}

function broadcast(ch, payload) {
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(ch, payload); } catch (e) {} }
}
function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body: String(body || '').slice(0, 180) }).show(); } catch (e) {}
}
function publicJobs() { return jobs.map(j => Object.assign({}, j)); }

// ------------------------------------------------------------
//  Jobbkø
// ------------------------------------------------------------
function addJob(kind, url, caseName, source) {
  const job = { id: crypto.randomBytes(4).toString('hex'), kind, status: 'i kø', url, case: caseName, source, createdAt: new Date().toISOString() };
  jobs.unshift(job);
  jobs = jobs.slice(0, 30);
  broadcast('bevis-jobs', publicJobs());
  return job;
}
function runJob(job, fn) {
  queue = queue.then(async () => {
    job.status = 'kjører';
    broadcast('bevis-jobs', publicJobs());
    try {
      const r = await fn();
      if (!r || !r.ok) throw new Error((r && r.error) || 'feilet');
      job.status = 'ferdig'; job.dir = r.dir; job.title = r.title || ''; job.fingerprint = r.fingerprint;
      notify(job.kind === 'video' ? 'Video lagret i Faktisk Studio' : 'Side sikret i Faktisk Studio', (r.title || job.url) + ' · ' + job.case);
    } catch (err) {
      job.status = 'feil'; job.error = err.message;
      notify('Faktisk Studio fikk ikke lagret', err.message);
    }
    job.doneAt = new Date().toISOString();
    broadcast('bevis-jobs', publicJobs());
    broadcast('bevis-library-changed', { dir: job.dir || null });
  });
}

function startDownload(url, caseName, note, source) {
  const job = addJob('video', url, caseName, source);
  runJob(job, () => H.doDownload({ sender: null }, { root: archiveRoot(), caseName, url, note: note || '', pluginVersion: source }));
  return job;
}

// Siden slik den ser ut i brukerens egen Chrome (skjermbilde, MHTML, tekst)
async function saveChromeCapture(d, caseName) {
  const when = new Date();
  const { dir, platform, handle } = H.captureFolder(archiveRoot(), caseName, d.url, when, 'chrome');
  const files = [];
  if (typeof d.screenshot === 'string' && d.screenshot.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(path.join(dir, 'skjermbilde-chrome.png'), Buffer.from(d.screenshot.slice(22), 'base64'));
    files.push('skjermbilde-chrome.png');
  }
  if (typeof d.mhtml === 'string' && d.mhtml) { fs.writeFileSync(path.join(dir, 'side.mhtml'), Buffer.from(d.mhtml, 'base64')); files.push('side.mhtml'); }
  if (typeof d.text === 'string') { fs.writeFileSync(path.join(dir, 'tekst.txt'), d.text); files.push('tekst.txt'); }
  if (!files.length) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} throw new Error('Utvidelsen sendte ingenting å lagre'); }
  const meta = {};
  if (d.meta && typeof d.meta === 'object') for (const [k, v] of Object.entries(d.meta).slice(0, 200)) if (k && typeof v === 'string') meta[k] = v.slice(0, 2000);
  const info = { url: d.url, title: String(d.title || '').slice(0, 500), canonical: '', lang: '', meta, userAgent: String(d.userAgent || ''), viewport: d.viewport || null };
  const manifest = H.baseManifest({ kind: 'chrome', caseName, note: d.note || '', url: d.url, info, when, platform, handle, appVersion: app.getVersion() });
  manifest.source.capturedIn = 'Google Chrome via Faktisk-utvidelsen ' + String(d.extVersion || '').slice(0, 20);
  manifest.source.capturedInChromeAt = typeof d.capturedAt === 'string' ? d.capturedAt : null;
  manifest.warnings = [];
  if (!files.includes('skjermbilde-chrome.png')) manifest.warnings.push('Mangler skjermbilde fra Chrome');
  if (!files.includes('side.mhtml')) manifest.warnings.push('Mangler nettarkiv-fil fra Chrome');
  if (files.includes('skjermbilde-chrome.png')) await H.makeThumb(dir, 'skjermbilde-chrome.png');
  manifest.completedAt = new Date().toISOString();
  const fin = await H.finalize(dir, manifest);
  return { ok: true, dir, fingerprint: fin.fingerprint, title: info.title };
}

// ------------------------------------------------------------
//  Lokal tjeneste
// ------------------------------------------------------------
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('for stor forespørsel')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function tokenOk(t) {
  const a = Buffer.from(String(t || '')), b = Buffer.from(loadCfg().token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function httpUrl(u) {
  try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; }
}

// ------------------------------------------------------------
//  «Sikre alt jeg ser» (utvidelsen 0.2): start → filer → ferdig
// ------------------------------------------------------------
const uploads = new Map();
const UPLOAD_PATH_RE = /^(skjermbilder\/rulling-\d{2,3}\.png|bilder\/[A-Za-z0-9._-]{1,80}|video\/[A-Za-z0-9._-]{1,80}|side\.mhtml|side\.html|tekst\.txt|skjermbilde-chrome\.png)$/;
function cleanUploads() {
  const now = Date.now();
  for (const [id, u] of uploads) if (now - u.at > 60 * 60 * 1000) { uploads.delete(id); try { fs.rmSync(u.dir, { recursive: true, force: true }); } catch (e) {} }
}
function fullStart(d) {
  cleanUploads();
  const url = httpUrl(d.url);
  if (!url) throw new Error('Ugyldig adresse');
  const caseName = String(d.case || loadCfg().caseName || 'Fra Chrome').trim().slice(0, 80) || 'Fra Chrome';
  const when = new Date();
  const { dir, platform, handle } = H.captureFolder(archiveRoot(), caseName, url, when, 'chrome');
  const id = crypto.randomBytes(8).toString('hex');
  uploads.set(id, { id, dir, platform, handle, when, url, caseName, at: Date.now(), files: [] });
  return { ok: true, id, case: caseName };
}
function fullFile(d) {
  const u = uploads.get(String(d.id || ''));
  if (!u) throw new Error('Ukjent opplasting (utløpt?)');
  const rel = String(d.path || '');
  if (!UPLOAD_PATH_RE.test(rel)) throw new Error('Ugyldig filnavn: ' + rel.slice(0, 80));
  if (typeof d.data !== 'string') throw new Error('Mangler innhold');
  const full = path.join(u.dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(d.data, 'base64'));
  u.files.push(rel); u.at = Date.now();
  return { ok: true };
}
async function fullFinish(d, job) {
  const u = uploads.get(String(d.id || ''));
  if (!u) throw new Error('Ukjent opplasting (utløpt?)');
  uploads.delete(u.id);
  const m = d.meta && typeof d.meta === 'object' ? d.meta : {};
  const meta = {};
  if (m.meta && typeof m.meta === 'object') for (const [k, v] of Object.entries(m.meta).slice(0, 200)) if (k && typeof v === 'string') meta[k] = v.slice(0, 2000);
  const info = { url: httpUrl(m.url) || u.url, title: String(m.title || '').slice(0, 500), canonical: '', lang: '', meta,
    userAgent: String(m.userAgent || '').slice(0, 400), viewport: m.viewport && typeof m.viewport === 'object' ? m.viewport : null };
  const manifest = H.baseManifest({ kind: 'chrome', caseName: u.caseName, note: String(d.note || '').slice(0, 2000), url: u.url, info, when: u.when, platform: u.platform, handle: u.handle, appVersion: app.getVersion() });
  manifest.source.capturedIn = 'Google Chrome via Faktisk-utvidelsen ' + String(d.extVersion || '').slice(0, 20) + ' («Sikre alt jeg ser»)';
  manifest.source.capturedInChromeAt = typeof m.capturedAt === 'string' ? m.capturedAt : null;
  manifest.loginAccount = 'brukerens egen Chrome-innlogging';
  manifest.chrome = {
    scroll: m.scroll && typeof m.scroll === 'object' ? { shots: +m.scroll.shots || 0, inner: !!m.scroll.inner, reachedEnd: !!m.scroll.reachedEnd } : null,
    expandedComments: +m.expanded || 0,
    images: m.images && typeof m.images === 'object' ? { found: +m.images.found || 0, saved: +m.images.saved || 0 } : null,
  };
  manifest.warnings = (Array.isArray(m.warnings) ? m.warnings : []).map(w => String(w).slice(0, 300)).slice(0, 20);
  if (d.video) {
    job.status = 'laster ned video'; broadcast('bevis-jobs', publicJobs());
    const mres = await H.downloadMedia(u.url, path.join(u.dir, 'media'), { comments: false, progress: null,
      cookies: Array.isArray(d.cookies) ? d.cookies : null, userAgent: info.userAgent });
    manifest.media = { tool: mres.tool, ok: mres.ok, note: mres.note, cookies: Array.isArray(d.cookies) && d.cookies.length ? 'Chrome' : 'Studio' };
    if (!mres.ok && mres.note && !/Fant ingen video/.test(mres.note)) manifest.warnings.push('Video: ' + mres.note);
  }
  const first = u.files.filter(f => /^skjermbilder\/rulling-/.test(f)).sort()[0] || (u.files.includes('skjermbilde-chrome.png') ? 'skjermbilde-chrome.png' : '');
  if (first) await H.makeThumb(u.dir, first);
  manifest.completedAt = new Date().toISOString();
  const fin = await H.finalize(u.dir, manifest);
  try { await require('./bevis-index.js')._test.buildIndex(null, u.dir, { ocr: false }); } catch (e) {}
  return { ok: true, dir: u.dir, fingerprint: fin.fingerprint, title: info.title };
}

async function handle(req, res) {
  // Vanlige nettsider sender alltid Origin, og egendefinert header krever
  // preflight — som vi aldri godtar. Kun utvidelser (og lokale verktøy) slipper inn.
  if (req.method === 'OPTIONS') { res.writeHead(403); return res.end(); }
  const origin = String(req.headers.origin || '');
  if (origin && !origin.startsWith('chrome-extension://')) return send(res, 403, { ok: false, error: 'Ikke tillatt' });
  if (!tokenOk(req.headers['x-faktisk-token'])) return send(res, 401, { ok: false, error: 'Feil koble-kode — se Bevissikring i Faktisk Studio' });
  lastSeen = new Date().toISOString();
  const u = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && u.pathname === '/status') {
    return send(res, 200, { ok: true, app: 'faktisk-studio', version: app.getVersion(), extVersion: bundledExtVersion(), features: ['download', 'capture', 'full'], rootProblem: rootProblem(), cases: listCases(), caseName: loadCfg().caseName || '', jobs: publicJobs().slice(0, 10) });
  }
  if (req.method === 'GET' && u.pathname === '/jobs') return send(res, 200, { ok: true, jobs: publicJobs() });

  if (req.method === 'POST' && /^\/full\/(start|file|finish)$/.test(u.pathname)) {
    let d;
    try { d = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Ugyldig forespørsel' }); }
    const rp = rootProblem();
    if (rp) return send(res, 409, { ok: false, error: rp });
    try {
      if (u.pathname === '/full/start') return send(res, 200, fullStart(d));
      if (u.pathname === '/full/file') return send(res, 200, fullFile(d));
      const up = uploads.get(String(d.id || ''));
      if (!up) return send(res, 404, { ok: false, error: 'Ukjent opplasting (utløpt?)' });
      const job = addJob('side', up.url, up.caseName, 'chrome-utvidelse ' + String(d.extVersion || '').slice(0, 20));
      runJob(job, () => fullFinish(d, job));
      return send(res, 200, { ok: true, job });
    } catch (err) { return send(res, 400, { ok: false, error: err.message }); }
  }

  if (req.method === 'POST' && (u.pathname === '/download' || u.pathname === '/capture')) {
    let d;
    try { d = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { ok: false, error: 'Ugyldig forespørsel' }); }
    const url = httpUrl(d.url);
    if (!url) return send(res, 400, { ok: false, error: 'Ugyldig adresse' });
    const rp = rootProblem();
    if (rp) return send(res, 409, { ok: false, error: rp });
    const caseName = String(d.case || loadCfg().caseName || 'Fra Chrome').trim().slice(0, 80) || 'Fra Chrome';
    const source = 'chrome-utvidelse ' + String(d.extVersion || '').slice(0, 20);
    if (u.pathname === '/download') {
      const job = startDownload(url, caseName, String(d.note || '').slice(0, 2000), source);
      return send(res, 200, { ok: true, job });
    }
    const job = addJob('side', url, caseName, source);
    runJob(job, () => saveChromeCapture(Object.assign({}, d, { url, note: String(d.note || '').slice(0, 2000) }), caseName));
    return send(res, 200, { ok: true, job });
  }
  return send(res, 404, { ok: false, error: 'Ukjent' });
}

function startServer() {
  if (server) return;
  const s = http.createServer((req, res) => { handle(req, res).catch(err => { try { send(res, 500, { ok: false, error: err.message }); } catch (e) {} }); });
  s.on('error', err => { serverError = err.code === 'EADDRINUSE' ? 'Porten ' + PORT + ' er opptatt (kjører Studio to ganger?)' : err.message; server = null; broadcast('bevis-link-changed', {}); });
  s.listen(PORT, '127.0.0.1', () => { serverError = ''; server = s; broadcast('bevis-link-changed', {}); });
}

// ------------------------------------------------------------
//  faktisk-studio:// — spør alltid først
// ------------------------------------------------------------
async function handleOpenUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return; }
  if (u.protocol !== SCHEME + ':') return;
  if (rootProblem()) { notify('Faktisk Studio', rootProblem()); return; }
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
  const target = httpUrl(u.searchParams.get('url'));
  if (action !== 'last-ned' || !target) return;
  const caseName = loadCfg().caseName || 'Fra Chrome';
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const opts = {
    type: 'question', buttons: ['Last ned', 'Avbryt'], defaultId: 0, cancelId: 1,
    message: 'Laste ned video til Faktisk Studio?',
    detail: target + '\n\nSak: ' + caseName + '\nArkiv: ' + archiveRoot(),
  };
  const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return;
  startDownload(target, caseName, '', 'faktisk-studio://');
}

// ------------------------------------------------------------
//  Kopi av utvidelsen til en vanlig mappe (Chrome kan ikke lese fra app.asar)
// ------------------------------------------------------------
function findExtensionSource() {
  const cands = [
    path.join(app.getPath('userData'), 'plugins', 'bevissikring', 'chrome-utvidelse'),
    path.join(__dirname, '..', 'plugins', 'bevissikring', 'chrome-utvidelse'),
  ];
  return cands.find(p => { try { return fs.statSync(path.join(p, 'manifest.json')).isFile(); } catch (e) { return false; } }) || null;
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const a = path.join(src, ent.name), b = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(a, b);
    else fs.writeFileSync(b, fs.readFileSync(a));
  }
}

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain) {
  H = require('./bevis-main.js')._internal;

  // macOS sender adressen til appen (også ved oppstart) — fang den tidlig
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) handleOpenUrl(url); else pendingUrls.push(url);
  });

  app.whenReady().then(() => {
    loadCfg();
    try {
      if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
      else app.setAsDefaultProtocolClient(SCHEME);
    } catch (e) {}
    startServer();
    pendingUrls.splice(0).forEach(handleOpenUrl);
  });

  ipcMain.handle('bevis-link-status', () => ({
    ok: true, token: loadCfg().token, port: PORT, running: !!server, error: serverError,
    lastSeen, jobs: publicJobs(), root: archiveRoot(), caseName: loadCfg().caseName || '',
  }));

  ipcMain.handle('bevis-link-config', (e, o) => {
    loadCfg();
    if (o && typeof o.root === 'string') cfg.root = o.root;
    if (o && typeof o.caseName === 'string') cfg.caseName = o.caseName.trim().slice(0, 80);
    saveCfg();
    return { ok: true };
  });

  ipcMain.handle('bevis-link-new-token', () => { loadCfg(); cfg.token = newToken(); saveCfg(); return { ok: true, token: cfg.token }; });

  ipcMain.handle('bevis-link-extension', () => {
    try {
      const src = findExtensionSource();
      if (!src) throw new Error('Fant ikke utvidelsen i pluginen');
      if (rootProblem()) throw new Error(rootProblem());
      const dst = path.join(archiveRoot(), '_chrome-utvidelse');
      copyTree(src, dst);
      shell.showItemInFolder(path.join(dst, 'manifest.json'));
      return { ok: true, dir: dst };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { register, _test: { fullStart, fullFile, fullFinish, uploads, handle, tokenOk, newToken, saveChromeCapture, handleOpenUrl, loadCfg: () => loadCfg(), startServer } };
