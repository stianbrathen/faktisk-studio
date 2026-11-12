// Faktisk Studio · Bevissikring — sikkerhet og oppfølging
//
//   Innstillinger   navn i manifestet, tidsstempel av/på, tempo på SoMe
//                   (userData/bevis-settings.json)
//   Tidsstempel     RFC 3161 fra en uavhengig tjeneste (DigiCert, Sectigo som
//                   reserve). Bare sha256 av SHA256SUMS.txt sendes — aldri
//                   innhold. Lagres som tidsstempel.tsq/.tsr/.json i sikringen.
//   Arkivmappe      varsler om mapper som synkes til skyen (iCloud, Drive …)
//   Kryptert arkiv  macOS-diskbilde (APFS, AES-256) via hdiutil. Passordet går
//                   rett til hdiutil og lagres ikke.
//   Stories         Instagram-stories via yt-dlp med innloggingen i vinduet
//   Følg med        sjekker sikrede adresser på nytt (mens Studio kjører) og
//                   sikrer siden på nytt hvis innholdet er borte eller endret

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net, BrowserWindow, Notification, shell } = require('electron');

let H = null;
let deps = null;
let settings = null;
const DEFAULT_TSA = ['http://timestamp.digicert.com', 'http://timestamp.sectigo.com'];

// ------------------------------------------------------------
//  Innstillinger
// ------------------------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'bevis-settings.json');
function loadSettings() {
  if (settings) return settings;
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { settings = {}; }
  settings = Object.assign({ timestamp: true, userName: '', account: '', pace: 'forsiktig', vault: null }, settings);
  applySettings();
  return settings;
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 }); } catch (e) {}
  applySettings();
}
function applySettings() {
  H.settings.timestamp = settings.timestamp !== false;
  H.settings.userName = String(settings.userName || '').slice(0, 80);
  H.settings.account = String(settings.account || '').slice(0, 120);
  H.settings.pace = settings.pace === 'normal' ? 'normal' : 'forsiktig';
}
function tsaList() {
  if (process.env.BEVIS_TSA) return process.env.BEVIS_TSA.split(',');
  return Array.isArray(settings.tsa) && settings.tsa.length ? settings.tsa : DEFAULT_TSA;
}
function broadcast(ch, payload) {
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(ch, payload); } catch (e) {} }
}
function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body: String(body || '').slice(0, 180) }).show(); } catch (e) {}
}

// ------------------------------------------------------------
//  RFC 3161-tidsstempel
// ------------------------------------------------------------
function derLen(n) {
  if (n < 128) return Buffer.from([n]);
  const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const der = (tag, content) => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
const derSeq = (...parts) => der(0x30, Buffer.concat(parts));
const derInt = buf => der(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const OID_SHA256 = Buffer.from('0609608648016503040201', 'hex');

// TimeStampReq { version 1, messageImprint { sha256, hash }, nonce, certReq TRUE }
function buildTsq(hash, nonce) {
  return derSeq(derInt(Buffer.from([1])), derSeq(derSeq(OID_SHA256, Buffer.from([0x05, 0x00])), der(0x04, hash)), derInt(nonce), Buffer.from([0x01, 0x01, 0xff]));
}
function readTlv(buf, off) {
  const tag = buf[off]; let len = buf[off + 1], hdr = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i]; hdr = 2 + n; }
  return { tag, start: off + hdr, end: off + hdr + len };
}
// Status fra PKIStatusInfo + genTime (første GeneralizedTime i svaret)
function parseTsr(buf) {
  const top = readTlv(buf, 0);
  if (top.tag !== 0x30) throw new Error('ugyldig svar');
  const statusInfo = readTlv(buf, top.start);
  const st = readTlv(buf, statusInfo.start);
  let status = 0;
  for (let i = st.start; i < st.end; i++) status = status * 256 + buf[i];
  let genTime = '';
  for (let i = statusInfo.end; i < buf.length - 17; i++) {
    if (buf[i] !== 0x18) continue;
    const len = buf[i + 1];
    if (len < 15 || len > 24) continue;
    const s = buf.slice(i + 2, i + 2 + len).toString('latin1');
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
    if (m) { genTime = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + (m[7] || '') + 'Z'; break; }
  }
  return { status, genTime };
}

async function stampFolder(dir) {
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'));
  const hash = crypto.createHash('sha256').update(sums).digest();
  const nonce = crypto.randomBytes(8);
  const req = buildTsq(hash, nonce);
  const requestedAt = new Date().toISOString();
  let lastErr = null;
  for (const url of tsaList()) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: req, signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const tsr = Buffer.from(await res.arrayBuffer());
      const info = parseTsr(tsr);
      if (info.status > 1) throw new Error('tjenesten avviste forespørselen (status ' + info.status + ')');
      if (tsr.indexOf(hash) < 0) throw new Error('svaret gjelder ikke denne sjekksummen');
      fs.writeFileSync(path.join(dir, 'tidsstempel.tsq'), req);
      fs.writeFileSync(path.join(dir, 'tidsstempel.tsr'), tsr);
      const meta = {
        format: 'faktisk-tidsstempel', version: 1, standard: 'RFC 3161', tsa: url, requestedAt, genTime: info.genTime,
        file: 'SHA256SUMS.txt', sha256: hash.toString('hex'),
        meaning: 'Tjenesten bekrefter at SHA256SUMS.txt (og dermed alle filene i sikringen) fantes i denne formen senest på genTime.',
        howToVerify: [
          'Vis tidspunkt og sjekksum:  openssl ts -reply -in tidsstempel.tsr -text',
          'Full kontroll av signaturen:  openssl ts -verify -data SHA256SUMS.txt -in tidsstempel.tsr -CAfile <rotsertifikatet til ' + url.replace(/^https?:\/\//, '') + '>',
        ],
      };
      fs.writeFileSync(path.join(dir, 'tidsstempel.json'), JSON.stringify(meta, null, 2) + '\n');
      return Object.assign({ ok: true }, meta);
    } catch (e) { lastErr = e; }
  }
  throw new Error('Fikk ikke tidsstempel: ' + (lastErr ? (lastErr.name === 'AbortError' ? 'tidsavbrudd' : lastErr.message) : 'ingen tjeneste'));
}

async function verifyStamp(dir) {
  const f = path.join(dir, 'tidsstempel.json');
  if (!fs.existsSync(f)) return { ok: false, missing: true };
  const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'))).digest();
  let tsrOk = false;
  try { tsrOk = fs.readFileSync(path.join(dir, 'tidsstempel.tsr')).indexOf(hash) >= 0; } catch (e) {}
  const ok = meta.sha256 === hash.toString('hex') && tsrOk;
  return { ok, genTime: meta.genTime, tsa: meta.tsa, error: ok ? undefined : 'SHA256SUMS.txt stemmer ikke med tidsstempelet' };
}

// ------------------------------------------------------------
//  Arkivmappe: sky-synk og kryptert diskbilde
// ------------------------------------------------------------
function cloudOf(p) {
  const home = os.homedir(), rp = path.resolve(p);
  const under = d => rp === d || rp.startsWith(d + path.sep);
  if (under(path.join(home, 'Library', 'Mobile Documents'))) return 'iCloud Drive';
  const cs = path.join(home, 'Library', 'CloudStorage');
  if (under(cs)) {
    const n = rp.slice(cs.length + 1).split(path.sep)[0] || '';
    return /google/i.test(n) ? 'Google Drive' : /dropbox/i.test(n) ? 'Dropbox' : /onedrive/i.test(n) ? 'OneDrive' : (n || 'en skytjeneste');
  }
  const m = rp.match(/\/(Dropbox|Google Drive|OneDrive)(\/|$)/i);
  if (m) return m[1];
  for (const d of ['Documents', 'Desktop']) {
    if (under(path.join(home, d)) && fs.existsSync(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', d))) return 'iCloud (Skrivebord og Dokumenter)';
  }
  return null;
}

function runInput(cmd, args, input, timeoutMs = 120000) {
  return new Promise(resolve => {
    let p;
    try { p = spawn(cmd, args); } catch (err) { return resolve({ code: -1, stdout: '', stderr: err.message }); }
    let stdout = '', stderr = '';
    p.stdout.on('data', c => { stdout += c; });             // MÅ leses
    p.stderr.on('data', c => { stderr += c; });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, timeoutMs);
    p.on('error', err => { clearTimeout(t); resolve({ code: -1, stdout, stderr: err.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr }); });
    try { p.stdin.end(input); } catch (e) {}
  });
}
const vaultMounted = () => !!(settings.vault && settings.vault.mountpoint && fs.existsSync(settings.vault.mountpoint));

async function vaultAttach(image, password) {
  const r = await runInput('/usr/bin/hdiutil', ['attach', '-stdinpass', '-plist', image], password + '\0');
  if (r.code !== 0) throw new Error(/Authentication|passphrase/i.test(r.stderr) ? 'Feil passord' : (r.stderr.trim() || 'kunne ikke åpne arkivet'));
  const mps = Array.from(r.stdout.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)).map(m => m[1]);
  if (!mps.length) throw new Error('arkivet ble åpnet, men fant ikke hvor');
  return mps[mps.length - 1];
}

async function vaultCreate(o) {
  if (process.platform !== 'darwin') throw new Error('Kryptert arkiv krever macOS');
  const dir = String(o.dir || ''), name = String(o.name || 'Faktisk bevissikring').replace(/[\/:]/g, ' ').trim().slice(0, 60) || 'Faktisk bevissikring';
  const gb = Math.max(1, Math.min(+o.sizeGB || 50, 2000));
  const password = String(o.password || '');
  if (!dir || !fs.existsSync(dir)) throw new Error('Velg hvor arkivet skal ligge');
  if (password.length < 8) throw new Error('Passordet må ha minst 8 tegn');
  const cloud = cloudOf(dir);
  const image = path.join(dir, name + '.sparsebundle');
  if (fs.existsSync(image)) throw new Error('Det finnes allerede et arkiv med det navnet der');
  const r = await runInput('/usr/bin/hdiutil', ['create', '-size', gb + 'g', '-type', 'SPARSEBUNDLE', '-fs', 'APFS', '-encryption', 'AES-256', '-stdinpass', '-volname', name, image], password + '\0', 300000);
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'kunne ikke lage arkivet');
  const mountpoint = await vaultAttach(image, password);
  settings.vault = { image, name, mountpoint, createdAt: new Date().toISOString(), cloud };
  saveSettings();
  return { image, mountpoint, cloud };
}

// ------------------------------------------------------------
//  Følg med
// ------------------------------------------------------------
const watchFile = () => path.join(app.getPath('userData'), 'bevis-watch.json');
let watches = null;
let checking = false;
function loadWatches() {
  if (watches) return watches;
  try { watches = JSON.parse(fs.readFileSync(watchFile(), 'utf8')); } catch (e) { watches = []; }
  if (!Array.isArray(watches)) watches = [];
  return watches;
}
function saveWatches() { try { fs.writeFileSync(watchFile(), JSON.stringify(watches, null, 2)); } catch (e) {} }
function publicWatches() { return loadWatches().map(w => Object.assign({}, w, { baseline: undefined, events: (w.events || []).slice(-10) })); }

const GONE = [
  'dette innholdet er ikke tilgjengelig', 'innholdet er ikke tilgjengelig', "this content isn't available", 'this content isn’t available',
  'denne siden er ikke tilgjengelig', "this page isn't available", 'this page isn’t available', "sorry, this page isn't available",
  "this page doesn't exist", 'this page doesn’t exist', 'this post is unavailable', 'denne posten er ikke tilgjengelig',
  'video unavailable', 'videoen er ikke tilgjengelig', "this video isn't available", 'this video has been removed',
  'account suspended', 'kontoen er suspendert', "this account doesn't exist", 'this account doesn’t exist',
  'page not found', 'siden finnes ikke', 'post not found',
];
const normLine = l => l.toLowerCase().replace(/\s+/g, ' ').trim();
function meaningfulLines(text) {
  const out = new Set();
  for (const l of String(text || '').split('\n')) { const n = normLine(l); if (n.length >= 20) out.add(crypto.createHash('sha1').update(n).digest('hex').slice(0, 12)); }
  return Array.from(out).slice(0, 4000);
}

async function loadHidden(url) {
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:bevis', sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  H.bevisSession();
  try {
    let httpStatus = 0;
    w.webContents.on('did-navigate', (e, u, code) => { httpStatus = code || httpStatus; });
    await w.webContents.loadURL(url).catch(() => {});
    await H.waitForLoad(w.webContents, 45000);
    await H.wait(4000);
    const page = await w.webContents.executeJavaScript(`({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '', html: '<!doctype html>\\n' + document.documentElement.outerHTML, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } })`);
    const img = await w.webContents.capturePage();
    return { page, png: img.toPNG(), httpStatus };
  } finally { try { w.destroy(); } catch (e) {} }
}

function judge(w, page, httpStatus) {
  if (/\/(login|checkpoint|accounts\/login|i\/flow\/login)/.test(page.url)) return { status: 'innlogging', detail: 'Krever innlogging i sikringsvinduet — kunne ikke sjekke' };
  const head = (page.title + '\n' + String(page.text || '').slice(0, 5000)).toLowerCase();
  const hit = GONE.find(g => head.includes(g));
  if (hit || httpStatus === 404 || httpStatus === 410) return { status: 'borte', detail: hit ? '«' + hit + '»' : 'HTTP ' + httpStatus };
  if (!w.baseline || !w.baseline.length) return { status: 'uendret', detail: 'Første sjekk — lagret som utgangspunkt' };
  const now = new Set(meaningfulLines(page.text));
  const missing = w.baseline.filter(h => !now.has(h)).length;
  const pct = Math.round(100 * missing / w.baseline.length);
  if (w.baseline.length >= 3 && pct >= 30) return { status: 'endret', detail: pct + ' % av teksten fra første sjekk er borte' };
  return { status: 'uendret', detail: pct ? pct + ' % av teksten endret (under grensen)' : 'Ingen endring' };
}

async function captureFollowUp(w, res, verdict) {
  const when = new Date();
  const { dir, platform, handle } = H.captureFolder(w.root, w.case, res.page.url || w.url, when, 'oppfolging');
  fs.writeFileSync(path.join(dir, 'skjermbilde.png'), res.png);
  fs.writeFileSync(path.join(dir, 'tekst.txt'), res.page.text || '');
  fs.writeFileSync(path.join(dir, 'side.html'), res.page.html || '');
  const info = { url: res.page.url, title: res.page.title, canonical: '', lang: '', meta: {}, userAgent: res.page.userAgent, viewport: res.page.viewport };
  const manifest = H.baseManifest({ kind: 'oppfolging', caseName: w.case, note: 'Automatisk oppfølging: ' + verdict.status + ' — ' + verdict.detail, url: w.url, info, when, platform, handle, appVersion: app.getVersion() });
  manifest.tag = { kind: 'oppfolging', status: verdict.status, detail: verdict.detail, watchId: w.id, originalDir: w.dir, url: w.url, httpStatus: res.httpStatus || null };
  manifest.warnings = ['Tatt automatisk i et skjult vindu: skjermbildet viser bare første skjermhøyde.'];
  await H.makeThumb(dir, 'skjermbilde.png');
  manifest.completedAt = new Date().toISOString();
  await H.finalize(dir, manifest);
  return dir;
}

async function checkWatch(w) {
  if (!fs.existsSync(w.root)) { w.lastStatus = 'arkiv utilgjengelig'; w.lastDetail = 'Arkivmappa finnes ikke (låst kryptert arkiv?)'; w.lastCheck = new Date().toISOString(); w.nextCheck = Date.now() + 3600000; return; }
  const res = await loadHidden(w.url);
  const verdict = judge(w, res.page, res.httpStatus);
  const prev = w.lastStatus;
  w.lastCheck = new Date().toISOString();
  w.lastStatus = verdict.status; w.lastDetail = verdict.detail;
  w.nextCheck = Date.now() + w.hours * 3600000;
  if (!w.baseline || !w.baseline.length) { if (verdict.status === 'uendret') { w.baseline = meaningfulLines(res.page.text); w.baselineAt = w.lastCheck; } }
  const ev = { at: w.lastCheck, status: verdict.status, detail: verdict.detail };
  if ((verdict.status === 'borte' || verdict.status === 'endret') && prev !== verdict.status) {
    try { ev.dir = await captureFollowUp(w, res, verdict); } catch (e) { ev.error = e.message; }
    notify(verdict.status === 'borte' ? 'Innhold er borte' : 'Innhold er endret', w.url + ' · ' + w.case);
  }
  (w.events = w.events || []).push(ev);
  if (w.events.length > 100) w.events = w.events.slice(-100);
}

async function runDue(force) {
  if (checking) return;
  checking = true;
  try {
    for (const w of loadWatches()) {
      if (!force && w.nextCheck && w.nextCheck > Date.now()) continue;
      if (force && force !== w.id) continue;
      try { await checkWatch(w); } catch (e) { w.lastStatus = 'feil'; w.lastDetail = e.message; w.lastCheck = new Date().toISOString(); w.nextCheck = Date.now() + 3600000; }
      saveWatches();
      broadcast('bevis-watch-changed', publicWatches());
      broadcast('bevis-library-changed', {});
    }
  } finally { checking = false; }
}

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain, d) {
  deps = d;
  H = require('./bevis-main.js')._internal;
  app.whenReady().then(() => {
    loadSettings();
    H.setStampHooks({ stamp: stampFolder, verify: verifyStamp });
    setTimeout(() => runDue(false), 60000);
    setInterval(() => runDue(false), 5 * 60000);
  });

  ipcMain.handle('bevis-settings-get', () => {
    loadSettings();
    return { ok: true, settings: { timestamp: settings.timestamp !== false, userName: settings.userName || '', account: settings.account || '', pace: settings.pace || 'forsiktig' },
      vault: settings.vault ? Object.assign({}, settings.vault, { mounted: vaultMounted() }) : null };
  });
  ipcMain.handle('bevis-settings-set', (e, o) => {
    loadSettings();
    if (o && typeof o.timestamp === 'boolean') settings.timestamp = o.timestamp;
    if (o && typeof o.userName === 'string') settings.userName = o.userName.trim().slice(0, 80);
    if (o && typeof o.account === 'string') settings.account = o.account.trim().slice(0, 120);
    if (o && (o.pace === 'forsiktig' || o.pace === 'normal')) settings.pace = o.pace;
    saveSettings();
    return { ok: true };
  });

  ipcMain.handle('bevis-path-info', (e, o) => {
    const p = String(o && o.path || '');
    if (!p) return { ok: true, exists: false };
    loadSettings();
    const v = settings.vault;
    const inVault = !!(v && v.mountpoint && (p === v.mountpoint || p.startsWith(v.mountpoint + path.sep)));
    return { ok: true, exists: fs.existsSync(p), cloud: inVault ? null : cloudOf(p), vault: inVault, vaultMounted: vaultMounted() };
  });

  ipcMain.handle('bevis-vault-create', async (e, o) => { try { return Object.assign({ ok: true }, await vaultCreate(o || {})); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('bevis-vault-open', async (e, o) => {
    try {
      loadSettings();
      if (!settings.vault || !settings.vault.image) throw new Error('Ingen kryptert arkiv er satt opp');
      if (!fs.existsSync(settings.vault.image)) throw new Error('Finner ikke arkivfila ' + settings.vault.image);
      settings.vault.mountpoint = await vaultAttach(settings.vault.image, String(o && o.password || ''));
      saveSettings();
      return { ok: true, mountpoint: settings.vault.mountpoint };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('bevis-vault-close', async () => {
    loadSettings();
    if (!vaultMounted()) return { ok: true };
    const r = await runInput('/usr/bin/hdiutil', ['detach', settings.vault.mountpoint], '');
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() || 'kunne ikke låse (er en fil åpen?)' };
  });

  ipcMain.handle('bevis-stamp', async (e, o) => {
    try {
      const dir = String(o && o.dir || '');
      const m = H.readManifest(dir);
      if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
      return await stampFolder(dir);
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-stories', async (e, o) => {
    try {
      let u; try { u = new URL(H.normalizeUrl(o && o.url)); } catch (err) { throw new Error('Lim inn lenken til Instagram-profilen'); }
      if (!/(^|\.)instagram\.com$/.test(u.hostname)) throw new Error('Nedlasting av stories virker for Instagram. For Facebook: åpne storyen i vinduet og bruk «Sikre utsnitt» eller skjermopptak (Cmd+Shift+5).');
      const segs = u.pathname.split('/').filter(Boolean);
      const user = segs[0] === 'stories' ? segs[1] : segs[0];
      if (!user) throw new Error('Fant ikke brukernavnet i lenken');
      if (!(await H.confirmVisit('https://www.instagram.com/stories/' + user + '/'))) return { ok: false, cancelled: true, error: 'Avbrutt' };
      return await H.doDownload(e, { root: o.root, caseName: o.caseName, url: 'https://www.instagram.com/stories/' + user + '/', note: o.note || '', pluginVersion: o.pluginVersion });
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-watch-list', () => ({ ok: true, watches: publicWatches(), checking }));
  ipcMain.handle('bevis-watch-add', async (e, o) => {
    try {
      const dir = String(o && o.dir || '');
      const m = H.readManifest(dir);
      if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
      const url = (m.source && (m.source.finalUrl || m.source.requestedUrl)) || '';
      if (!/^https?:/.test(url)) throw new Error('Sikringen har ingen nettadresse');
      const hours = Math.max(1, Math.min(+o.hours || 24, 720));
      loadWatches();
      let w = watches.find(x => x.dir === dir);
      if (w) w.hours = hours;
      else {
        w = { id: crypto.randomBytes(5).toString('hex'), url, dir, case: path.basename(path.dirname(dir)), root: path.dirname(path.dirname(dir)), hours,
          addedAt: new Date().toISOString(), baseline: null, lastCheck: null, lastStatus: 'venter', lastDetail: '', nextCheck: Date.now(), events: [] };
        watches.push(w);
      }
      saveWatches();
      broadcast('bevis-watch-changed', publicWatches());
      runDue(w.id);
      return { ok: true, id: w.id };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('bevis-watch-remove', (e, o) => {
    loadWatches();
    watches = watches.filter(w => w.id !== (o && o.id));
    saveWatches();
    broadcast('bevis-watch-changed', publicWatches());
    return { ok: true };
  });
  ipcMain.handle('bevis-watch-check', (e, o) => { runDue((o && o.id) || false); return { ok: true }; });

  // Slett: til Papirkurven (kan angres i Finder), aldri rm. Loggføres i saken.
  ipcMain.handle('bevis-delete', async (e, o) => {
    try {
      const dir = path.resolve(String(o && o.dir || ''));
      const m = H.readManifest(dir);
      if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
      const caseDir = path.dirname(dir), name = path.basename(dir);
      let fingerprint = '';
      try { fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'))).digest('hex'); } catch (err) {}
      await shell.trashItem(dir);
      try { fs.unlinkSync(path.join(caseDir, '_indeks', name + '.json')); } catch (err) {}
      loadWatches();
      const before = watches.length;
      watches = watches.filter(w => path.resolve(w.dir) !== dir);
      if (watches.length !== before) { saveWatches(); broadcast('bevis-watch-changed', publicWatches()); }
      loadSettings();
      const who = settings.userName || (() => { try { return os.userInfo().username; } catch (err) { return ''; } })();
      const line = [new Date().toISOString(), 'slettet (til Papirkurven)', name, (m.source && (m.source.finalUrl || m.source.requestedUrl)) || '', 'fingeravtrykk ' + fingerprint, 'av ' + who, o && o.reason ? 'grunn: ' + String(o.reason).replace(/\s+/g, ' ').slice(0, 300) : ''].filter(Boolean).join(' · ');
      try { fs.appendFileSync(path.join(caseDir, '_slettelogg.txt'), line + '\n'); } catch (err) {}
      broadcast('bevis-library-changed', {});
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { register, _test: { buildTsq, parseTsr, cloudOf, judge, meaningfulLines, stampFolder: d => stampFolder(d), verifyStamp: d => verifyStamp(d) } };
