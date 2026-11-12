// Faktisk Studio · Bevissikring — hovedprosess-delen
//
// Sikrer innhold fra nettet før det forsvinner, systematisk og etterprøvbart.
// Siden åpnes i et eget vindu med egen, varig innlogging (persist:bevis), så
// journalisten kan logge inn på SoMe, rulle og åpne kommentarer før sikring.
//
//   bevis-open            åpne/naviger sikringsvinduet
//   bevis-window-state    URL og tittel i vinduet
//   bevis-capture         sikre siden: skjermbilder, PDF, MHTML, HTML, tekst,
//                         video/bilder (yt-dlp), bilder på siden, Wayback
//   bevis-capture-region  dra et utsnitt i vinduet og sikre bare det
//   bevis-list            alle sikringer under arkivmappa
//   bevis-verify          regn ut sha256 på nytt og sammenlign med SHA256SUMS.txt
//
// Hver sikring blir en mappe:  <arkiv>/<sak>/<ÅÅÅÅ-MM-DD_TTMMSS>_<plattform>_<navn>/
// med manifest.json (hvem, når, hva, hash per fil) og SHA256SUMS.txt som kan
// kontrolleres uten Studio:  cd <mappe> && shasum -a 256 -c SHA256SUMS.txt
//
// Husk (Studio-lærdom): stdout fra ALLE spawn-kall må leses, ellers fylles
// 64 KB-røret og prosessen henger.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { BrowserWindow, session, shell, net } = require('electron');

const PARTITION = 'persist:bevis';
const MAX_SHOT_CSS_H = 20000;     // høyeste side vi tar som ett skjermbilde (CSS-px)
const TILE_DEVICE_PX = 12000;     // Chromium-grense per bilde er ~16k px; vi holder god margin
const MAX_SCROLL_SHOTS = 40;
const MAX_PAGE_IMAGES = 60;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const SUMS_FILE = 'SHA256SUMS.txt';
const MANIFEST_FILE = 'manifest.json';
const THUMB_FILE = '.studio-miniatyr.jpg';     // dotfil: utenfor sjekksummene

let deps = null;          // { app, findFfmpeg }
let win = null;           // sikringsvinduet
let owner = null;         // webContents til plugin-vinduet som får hendelser
let busy = false;
// Settes av src/bevis-extra.js (innstillinger og tidsstempel)
const settings = { timestamp: false, userName: '', account: '' };
let stampHooks = null;
function setStampHooks(h) { stampHooks = h; }
const STAMP_RE = /^tidsstempel\.(tsq|tsr|json)$/;

// Besøk som synes for den som eies av kontoen: LinkedIn viser hvem som har
// sett profilen, og Instagram/Facebook viser hvem som har sett en story.
const askedVisit = new Set();
function visitWarning(url) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  const h = u.hostname.replace(/^www\./, '');
  if (/(^|\.)linkedin\.com$/.test(h) && /^\/(in|company|pub)\//.test(u.pathname))
    return { key: 'linkedin', text: 'LinkedIn kan vise kontoeieren at du har sett profilen.', detail: 'Hvem som ser profiler avhenger av personverninnstillingene på LinkedIn-kontoen som er logget inn i sikringsvinduet. Bruk en researchkonto med «Privat modus» slått på (Innstillinger → Synlighet → Profilvisning).' };
  if (/(^|\.)instagram\.com$/.test(h) && /^\/stories\//.test(u.pathname))
    return { key: 'igstory', text: 'Instagram viser kontoeieren hvem som har sett en story.', detail: 'Kontoen som er logget inn i sikringsvinduet havner på listen over seere. Bruk en researchkonto, ikke din egen.' };
  if (/(^|\.)facebook\.com$/.test(h) && /^\/stories\//.test(u.pathname))
    return { key: 'fbstory', text: 'Facebook viser kontoeieren hvem som har sett en story.', detail: 'Kontoen som er logget inn i sikringsvinduet havner på listen over seere. Bruk en researchkonto, ikke din egen.' };
  return null;
}
async function confirmVisit(url) {
  const w = visitWarning(url);
  if (!w || askedVisit.has(w.key)) return true;
  const { dialog, BrowserWindow: BW } = require('electron');
  const parent = BW.getFocusedWindow();
  const opts = { type: 'warning', buttons: ['Fortsett', 'Avbryt'], defaultId: 1, cancelId: 1, message: w.text, detail: w.detail + '\n\n' + url, checkboxLabel: 'Ikke spør igjen før Studio startes på nytt' };
  const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return false;
  if (r.checkboxChecked) askedVisit.add(w.key);
  return true;
}

// ------------------------------------------------------------
//  Hjelpere
// ------------------------------------------------------------
const pad2 = n => String(n).padStart(2, '0');

function sendTo(wc, channel, payload) {
  try { if (wc && !wc.isDestroyed()) wc.send(channel, payload); } catch (e) {}
}
function windowState() {
  if (!win || win.isDestroyed()) return { open: false };
  const wc = win.webContents;
  return { open: true, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading() };
}
function pushWindowState() { sendTo(owner, 'bevis-window', windowState()); }

function safeName(s, max = 60) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}
function slug(s, max = 40) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/gi, 'ae').replace(/ø/gi, 'o').replace(/å/gi, 'a')
    .toLowerCase().replace(/[^a-z0-9@._-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/g, '');
}

// Plattform og konto/innlegg ut fra URL — brukes i mappenavnet
const PLATFORMS = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)(twitter|x)\.com$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)t\.me$|(^|\.)telegram\.(me|org)$/, 'telegram'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)vk\.com$/, 'vk'],
  [/(^|\.)bsky\.app$/, 'bluesky'],
];
function describeUrl(u) {
  let url;
  try { url = new URL(u); } catch (e) { return { platform: 'web', handle: '' }; }
  const host = url.hostname.replace(/^www\.|^m\.|^mobile\./, '');
  let platform = null;
  for (const [re, name] of PLATFORMS) if (re.test(host)) { platform = name; break; }
  const segs = url.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  let handle = '';
  if (platform === 'youtube') {
    handle = url.searchParams.get('v') || (segs[0] === 'shorts' ? segs[1] : segs[0]) || '';
  } else if (platform === 'facebook') {
    handle = segs.filter(s => !/^(posts|videos|photos|permalink\.php|story\.php|watch|reel|groups|share|p|v|r)$/.test(s)).slice(0, 2).join('-')
      || url.searchParams.get('id') || url.searchParams.get('v') || '';
  } else if (platform === 'x' && segs[0] === 'search') {
    handle = ((url.searchParams.get('q') || '').match(/from:([A-Za-z0-9_]+)/) || [, 'sok'])[1];
  } else if (platform) {
    handle = segs.filter(s => !/^(status|p|reel|reels|video|post|posts|comments|s)$/.test(s)).slice(0, 2).join('-');
  } else {
    platform = host;
    handle = segs.slice(-1)[0] || '';
  }
  return { platform, handle: handle.replace(/\.(html?|php|aspx?)$/i, '') };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', c => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Alle filer i mappa (rekursivt), uten dotfiler, sortert — relative stier med /
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else if (ent.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort((a, b) => a.localeCompare(b, 'nb'));
}

function run(cmd, args, { timeoutMs = 120000, env, onLine } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { env: env || process.env }); } catch (err) { return resolve({ code: -1, stdout: '', stderr: err.message }); }
    let stdout = '', stderr = '', partial = '';
    const keep = s => (s.length > 400000 ? s.slice(-200000) : s);
    p.stdout.on('data', c => {                         // MÅ leses
      const s = c.toString();
      stdout = keep(stdout + s);
      if (onLine) {
        partial += s;
        const lines = partial.split(/\r?\n|\r/);
        partial = lines.pop();
        lines.forEach(l => { try { onLine(l); } catch (e) {} });
      }
    });
    p.stderr.on('data', c => { stderr = keep(stderr + c.toString()); });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, timeoutMs);
    p.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: err.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut: code === null }); });
  });
}

async function fetchBuffer(url, { ses, timeoutMs = 60000, maxBytes = Infinity } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await (ses ? ses.fetch(url, { signal: ctl.signal }) : net.fetch(url, { signal: ctl.signal }));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > maxBytes) throw new Error('for stor (' + Math.round(len / 1e6) + ' MB)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('for stor');
    return { buf, type: (res.headers.get('content-type') || '').split(';')[0].trim(), finalUrl: res.url };
  } finally { clearTimeout(timer); }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// Vanlig Chrome-UA: mange nettsteder (Google, Meta) avviser «Electron/…» i UA
function cleanUserAgent(ua) {
  // Bygg en ren Chrome-UA: «Mozilla/5.0 (<plattform>) AppleWebKit … Chrome/x Safari/537.36»
  const plat = (String(ua || '').match(/\(([^)]+)\)/) || [, 'Macintosh; Intel Mac OS X 10_15_7'])[1];
  const chrome = process.versions.chrome || (String(ua).match(/Chrome\/([\d.]+)/) || [, '130.0.0.0'])[1];
  return 'Mozilla/5.0 (' + plat + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chrome + ' Safari/537.36';
}
function bevisSession() {
  const ses = session.fromPartition(PARTITION);
  if (!ses.__bevisUa) {
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
    ses.__bevisUa = true;
  }
  return ses;
}

// ------------------------------------------------------------
//  Sikringsvinduet
// ------------------------------------------------------------
function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  bevisSession();
  win = new BrowserWindow({
    width: 1280, height: 900,
    title: 'Bevissikring',
    show: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;
  // Innloggings-popup-er (f.eks. «Logg inn med Google») får åpne seg i samme økt
  wc.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } } }));
  // Ingen nedlastinger fra siden selv i dette vinduet — vi henter det vi trenger eksplisitt
  ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading', 'did-fail-load'].forEach(ev => wc.on(ev, pushWindowState));
  win.on('closed', () => { win = null; pushWindowState(); });
  return win;
}

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.href;
  } catch (e) { return ''; }
}

function waitForLoad(wc, timeoutMs = 30000) {
  return new Promise(resolve => {
    if (!wc.isLoading()) return resolve(true);
    const t = setTimeout(() => { wc.removeListener('did-stop-loading', done); resolve(false); }, timeoutMs);
    function done() { clearTimeout(t); resolve(true); }
    wc.once('did-stop-loading', done);
  });
}

// ------------------------------------------------------------
//  Skript som kjøres i siden
// ------------------------------------------------------------
// Finner elementet som faktisk ruller (dokumentet, eller en indre beholder
// som på Facebook/X), og ruller det i steg. Returnerer info for hvert steg.
const PAGE_SCROLLER = `(() => {
  if (window.__bevisScroller) return true;
  function pick() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 40) return se;
    let best = null, bestArea = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.width, innerWidth)) * Math.max(0, Math.min(r.height, innerHeight));
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return best || se;
  }
  window.__bevisScroller = {
    el: null,
    start() { this.el = pick(); this.origin = this.el.scrollTop; return this.info(); },
    info() { const e = this.el; return { top: e.scrollTop, height: e.scrollHeight, view: e.clientHeight, doc: e === (document.scrollingElement || document.documentElement) }; },
    to(y) { this.el.scrollTop = y; return this.info(); },
    step() { const e = this.el; const before = e.scrollTop; e.scrollTop = before + Math.round(e.clientHeight * 0.85); const i = this.info(); i.moved = e.scrollTop !== before; return i; },
    back() { this.el.scrollTop = this.origin || 0; return this.info(); },
    text() { return document.body ? document.body.innerText : ''; },
  };
  return true;
})()`;

// Henter tekst, HTML og metadata fra siden
const PAGE_INFO = `(() => {
  const meta = {};
  for (const m of document.querySelectorAll('meta[property], meta[name], meta[itemprop]')) {
    const k = m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop');
    const v = m.getAttribute('content');
    if (k && v && v.length < 2000 && !(k in meta)) meta[k] = v;
  }
  const canonical = (document.querySelector('link[rel="canonical"]') || {}).href || '';
  let jsonLd = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (jsonLd.length >= 10) break;
    const t = s.textContent || '';
    if (t.length < 200000) jsonLd.push(t);
  }
  return {
    title: document.title,
    url: location.href,
    lang: document.documentElement.lang || '',
    canonical,
    meta,
    jsonLd,
    text: document.body ? document.body.innerText : '',
    html: '<!doctype html>\\n' + document.documentElement.outerHTML,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    userAgent: navigator.userAgent,
  };
})()`;

// Bilder på siden som er store nok til å være innhold (ikke ikoner)
const PAGE_IMAGES = `(() => {
  const seen = new Set(), out = [];
  const add = (u, w, h, alt) => {
    if (!u || seen.has(u) || /^(blob:|javascript:)/.test(u)) return;
    seen.add(u); out.push({ url: u, width: w || 0, height: h || 0, alt: alt || '' });
  };
  for (const img of document.images) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w >= 200 && h >= 200) add(img.currentSrc || img.src, w, h, img.alt);
  }
  for (const v of document.querySelectorAll('video[poster]')) add(v.poster, 0, 0, 'video-plakat');
  const og = document.querySelector('meta[property="og:image"]');
  if (og && og.content) add(new URL(og.content, location.href).href, 0, 0, 'og:image');
  return out.slice(0, ${MAX_PAGE_IMAGES});
})()`;

// Utsnitt: overlegg der brukeren drar et rektangel. Esc avbryter.
const PAGE_SELECT_REGION = `new Promise(resolve => {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,80,252,.06)';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #0050FC;background:rgba(0,80,252,.12);display:none;pointer-events:none;box-sizing:border-box';
  const tip = document.createElement('div');
  tip.textContent = 'Dra over det du vil sikre · Esc avbryter';
  tip.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#0050FC;color:#fff;font:bold 14px -apple-system,system-ui,sans-serif;padding:7px 14px;border-radius:6px;pointer-events:none';
  o.append(box, tip);
  document.documentElement.append(o);
  let sx = 0, sy = 0, drag = false;
  const done = r => { o.remove(); removeEventListener('keydown', key, true); requestAnimationFrame(() => requestAnimationFrame(() => resolve(r))); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
  addEventListener('keydown', key, true);
  const rect = e => ({ x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), width: Math.abs(e.clientX - sx), height: Math.abs(e.clientY - sy) });
  o.addEventListener('mousedown', e => { e.preventDefault(); drag = true; sx = e.clientX; sy = e.clientY; box.style.display = 'block'; tip.style.display = 'none'; });
  o.addEventListener('mousemove', e => { if (!drag) return; const r = rect(e); Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' }); });
  o.addEventListener('mouseup', e => { if (!drag) return; drag = false; const r = rect(e); if (r.width < 8 || r.height < 8) { box.style.display = 'none'; tip.style.display = ''; return; } done(r); });
})`;

// ------------------------------------------------------------
//  Skjermbilder
// ------------------------------------------------------------
let sharpLib;
function getSharp() {
  if (sharpLib === undefined) { try { sharpLib = require('sharp'); } catch (e) { sharpLib = null; } }
  return sharpLib;
}

// Hele dokumentet via DevTools-protokollen (captureBeyondViewport).
// Sider som ruller en indre beholder (Facebook, X) gir da bare synlig område —
// derfor tar vi også skjermbilder underveis i rullingen (se scrollShots).
async function fullPageShot(wc) {
  const dbg = wc.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    const vv = m.cssVisualViewport || m.visualViewport || {};
    const dpr = await wc.executeJavaScript('devicePixelRatio').catch(() => 1) || 1;
    const width = Math.max(1, Math.ceil(cs.width));
    const fullH = Math.max(1, Math.ceil(cs.height));
    const height = Math.min(fullH, MAX_SHOT_CSS_H);
    const tileH = Math.max(500, Math.floor(TILE_DEVICE_PX / dpr));
    const tiles = [];
    for (let y = 0; y < height; y += tileH) {
      const h = Math.min(tileH, height - y);
      const r = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, fromSurface: true,
        clip: { x: 0, y, width, height: h, scale: 1 },
      });
      tiles.push(Buffer.from(r.data, 'base64'));
    }
    let buf = tiles[0];
    if (tiles.length > 1) {
      const sharp = getSharp();
      if (!sharp) throw new Error('kan ikke sette sammen lange skjermbilder (sharp mangler)');
      const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
      const W = Math.max(...metas.map(mm => mm.width));
      const H = metas.reduce((s, mm) => s + mm.height, 0);
      let top = 0;
      const comps = tiles.map((t, i) => { const c = { input: t, top, left: 0 }; top += metas[i].height; return c; });
      buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }, limitInputPixels: false })
        .composite(comps).png({ compressionLevel: 6 }).toBuffer();
    }
    return { buf, cssWidth: width, cssHeight: height, fullCssHeight: fullH, truncated: fullH > height, viewportHeight: Math.round(vv.clientHeight || 0), tiles: tiles.length };
  } finally {
    if (attached) { try { dbg.detach(); } catch (e) {} }
  }
}

// Slår sammen tekst fra hvert rullesteg. Feeds som Facebook og X fjerner
// innlegg øverst mens man ruller, så teksten etter rullingen mangler starten.
// Vi finner overlappet mellom slutten av det vi har og det nye utsnittet.
function mergeLines(acc, text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  if (!acc.length) { acc.push(...lines); return; }
  for (let k = Math.min(8, acc.length); k >= 2; k--) {
    const tail = acc.slice(-k);
    for (let j = lines.length - k; j >= 0; j--) {
      let ok = true;
      for (let t = 0; t < k; t++) if (lines[j + t] !== tail[t]) { ok = false; break; }
      if (ok) { acc.push(...lines.slice(j + k)); return; }
    }
  }
  const recent = new Set(acc.slice(-3000));
  for (const l of lines) if (!recent.has(l)) acc.push(l);
}

async function scrollShots(wc, dir, onStep, maxShots) {
  await wc.executeJavaScript(PAGE_SCROLLER);
  let info = await wc.executeJavaScript('window.__bevisScroller.start()');
  const inner = info.doc === false;           // ruller en indre boks (SoMe), ikke dokumentet
  info = await wc.executeJavaScript('window.__bevisScroller.to(0)');
  await wait(500);
  const files = [];
  const textLines = [];
  const limit = Math.max(1, Math.min(maxShots || MAX_SCROLL_SHOTS, 400));
  let lastHeight = info.height, still = 0;
  for (let i = 0; i < limit; i++) {
    const img = await wc.capturePage();
    const name = 'rulling-' + (limit > 99 ? String(i + 1).padStart(3, '0') : pad2(i + 1)) + '.png';
    fs.writeFileSync(path.join(dir, name), img.toPNG());
    files.push({ name, scrollTop: info.top, scrollHeight: info.height });
    try { mergeLines(textLines, await wc.executeJavaScript('window.__bevisScroller.text()')); } catch (e) {}
    if (onStep) onStep(i + 1);
    info = await wc.executeJavaScript('window.__bevisScroller.step()');
    if (!info.moved) {
      // Nede: vent litt i tilfelle mer innhold lastes inn (uendelig rulling)
      await wait(900);
      const again = await wc.executeJavaScript('window.__bevisScroller.step()');
      if (!again.moved) break;
      info = again;
    }
    await wait(450);                       // la lat innlasting og animasjoner falle til ro
    if (info.height === lastHeight) still++; else { still = 0; lastHeight = info.height; }
  }
  await wc.executeJavaScript('window.__bevisScroller.to(0)');
  await wait(400);
  return { files, textLines, limit, inner };
}

// ------------------------------------------------------------
//  yt-dlp (video og bilder fra innlegg) og deno (kreves for YouTube)
// ------------------------------------------------------------
function binDir() { return path.join(deps.app.getPath('userData'), 'bin'); }
function ytDlpPath() { return path.join(binDir(), 'yt-dlp'); }
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin'];

function findDeno() {
  const cands = [path.join(binDir(), 'deno'), ...EXTRA_PATH.map(p => path.join(p, 'deno'))];
  return cands.find(p => fs.existsSync(p)) || null;
}

function sumsLookup(text, fileName) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && path.basename(m[2].trim()) === fileName) return m[1].toLowerCase();
  }
  return null;
}

// Laster ned nyeste yt-dlp fra prosjektets GitHub-releases og sjekker sha256
// mot SHA2-256SUMS fra samme release. Nedlasting via appens egen nettstakk
// setter ikke quarantine-attributt.
async function ensureYtDlp(progress, { update = false } = {}) {
  const dest = ytDlpPath();
  if (fs.existsSync(dest) && !update) return dest;
  progress && progress('Laster ned yt-dlp (første gang) …');
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
  const [bin, sums] = await Promise.all([
    fetchBuffer(base + 'yt-dlp_macos', { timeoutMs: 180000 }),
    fetchBuffer(base + 'SHA2-256SUMS', { timeoutMs: 60000 }),
  ]);
  const want = sumsLookup(sums.buf.toString('utf8'), 'yt-dlp_macos');
  const got = crypto.createHash('sha256').update(bin.buf).digest('hex');
  if (!want || want !== got) throw new Error('yt-dlp: sjekksummen stemmer ikke — avbrutt');
  fs.mkdirSync(binDir(), { recursive: true });
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, bin.buf);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  return dest;
}

async function ensureDeno(progress) {
  const found = findDeno();
  if (found) return found;
  if (process.platform !== 'darwin') return null;
  progress && progress('Laster ned deno (trengs for YouTube, første gang) …');
  const asset = process.arch === 'arm64' ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip';
  const base = 'https://github.com/denoland/deno/releases/latest/download/';
  const [zip, sum] = await Promise.all([
    fetchBuffer(base + asset, { timeoutMs: 240000 }),
    fetchBuffer(base + asset + '.sha256sum', { timeoutMs: 60000 }),
  ]);
  const want = (sum.buf.toString('utf8').match(/[a-f0-9]{64}/i) || [])[0];
  const got = crypto.createHash('sha256').update(zip.buf).digest('hex');
  if (!want || want.toLowerCase() !== got) throw new Error('deno: sjekksummen stemmer ikke');
  fs.mkdirSync(binDir(), { recursive: true });
  const zipPath = path.join(deps.app.getPath('temp'), 'bevis-deno-' + Date.now() + '.zip');
  fs.writeFileSync(zipPath, zip.buf);
  const r = await run('/usr/bin/ditto', ['-x', '-k', zipPath, binDir()], { timeoutMs: 120000 });
  try { fs.unlinkSync(zipPath); } catch (e) {}
  const dest = path.join(binDir(), 'deno');
  if (r.code !== 0 || !fs.existsSync(dest)) throw new Error('deno: kunne ikke pakke ut');
  fs.chmodSync(dest, 0o755);
  return dest;
}

// Cookies fra sikringsvinduet → Netscape-fil for yt-dlp (bare for nettstedet)
async function writeCookieFile(pageUrl) {
  let host;
  try { host = new URL(pageUrl).hostname; } catch (e) { return null; }
  const parts = host.split('.');
  const base = parts.slice(-2).join('.');
  const all = await bevisSession().cookies.get({});
  const rel = all.filter(c => { const d = String(c.domain || '').replace(/^\./, ''); return d === base || d.endsWith('.' + base); });
  if (!rel.length) return null;
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of rel) {
    let domain = c.domain || host;
    const sub = !c.hostOnly;
    if (sub && !domain.startsWith('.')) domain = '.' + domain;
    if (!sub) domain = domain.replace(/^\./, '');
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + domain, sub ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE',
      c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate), c.name, c.value].join('\t'));
  }
  const file = path.join(deps.app.getPath('temp'), 'bevis-cookies-' + crypto.randomBytes(6).toString('hex') + '.txt');
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}

// Cookies sendt fra Chrome-utvidelsen (bare for nettstedet) → Netscape-fil
function writeChromeCookieFile(cookies, pageUrl) {
  let host;
  try { host = new URL(pageUrl).hostname; } catch (e) { return null; }
  const base = host.split('.').slice(-2).join('.');
  const rel = (Array.isArray(cookies) ? cookies : []).filter(c => c && c.name && typeof c.value === 'string' &&
    (String(c.domain || '').replace(/^\./, '') === base || String(c.domain || '').replace(/^\./, '').endsWith('.' + base)));
  if (!rel.length) return null;
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of rel.slice(0, 400)) {
    let domain = String(c.domain || host);
    const sub = !c.hostOnly;
    if (sub && !domain.startsWith('.')) domain = '.' + domain;
    if (!sub) domain = domain.replace(/^\./, '');
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + domain, sub ? 'TRUE' : 'FALSE', String(c.path || '/'), c.secure ? 'TRUE' : 'FALSE',
      c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate), String(c.name).replace(/[\t\n]/g, ''), String(c.value).replace(/[\t\n]/g, '')].join('\t'));
  }
  const file = path.join(deps.app.getPath('temp'), 'bevis-cookies-' + crypto.randomBytes(6).toString('hex') + '.txt');
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}

async function downloadMedia(pageUrl, mediaDir, { comments, progress, cookies, userAgent }) {
  const result = { ok: false, files: [], note: '', tool: '' };
  let yt;
  try { yt = await ensureYtDlp(progress); }
  catch (e) { result.note = 'yt-dlp kunne ikke lastes ned: ' + e.message; return result; }
  const isYouTube = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test((() => { try { return new URL(pageUrl).hostname; } catch (e) { return ''; } })());
  let denoNote = '';
  if (isYouTube) { try { await ensureDeno(progress); } catch (e) { denoNote = ' (deno mangler: ' + e.message + ')'; } }

  fs.mkdirSync(mediaDir, { recursive: true });
  const ver = await run(yt, ['--version'], { timeoutMs: 60000 });
  result.tool = 'yt-dlp ' + String(ver.stdout).trim();
  const cookieFile = cookies ? writeChromeCookieFile(cookies, pageUrl) : await writeCookieFile(pageUrl).catch(() => null);
  const ff = deps.findFfmpeg && deps.findFfmpeg();
  const args = [
    '--newline', '--no-colors', '--no-overwrites', '--no-mtime',
    '--playlist-items', '1-50',
    '--socket-timeout', '30', '--retries', '3',
    '--max-filesize', '2G',
    '--write-info-json', '--write-thumbnail',
    '--merge-output-format', 'mp4/mkv',
    '--user-agent', userAgent && /^Mozilla\//.test(userAgent) ? String(userAgent).slice(0, 400) : cleanUserAgent(bevisSession().getUserAgent()),
    '-o', path.join(mediaDir, '%(extractor_key)s-%(id)s.%(ext)s'),
  ];
  if (ff) args.push('--ffmpeg-location', ff);
  if (cookieFile) args.push('--cookies', cookieFile);
  if (comments) args.push('--write-comments');
  args.push('--', pageUrl);
  const env = Object.assign({}, process.env, { PATH: [binDir(), ...EXTRA_PATH, process.env.PATH || ''].join(':') });
  const r = await run(yt, args, {
    timeoutMs: 20 * 60 * 1000, env,
    onLine: line => {
      const m = line.match(/\[download\]\s+([\d.]+)%/);
      if (m && progress) progress('Laster ned video … ' + Math.round(parseFloat(m[1])) + ' %');
    },
  });
  if (cookieFile) { try { fs.unlinkSync(cookieFile); } catch (e) {} }
  result.files = listFiles(mediaDir).map(f => 'media/' + f);
  const err = (r.stderr || '').split('\n').filter(l => /ERROR/.test(l)).slice(-2).join(' ').replace(/^.*?ERROR:\s*/, '');
  if (result.files.length) {
    result.ok = true;
    result.note = (r.code === 0 ? '' : 'Noe kan mangle: ' + err) + denoNote;
  } else if (/Unsupported URL|No video formats|There is no video|No media found/i.test(r.stderr)) {
    result.note = 'Fant ingen video eller bilder som yt-dlp kan hente fra denne adressen.';
  } else if (r.timedOut) {
    result.note = 'yt-dlp brukte for lang tid og ble stoppet.';
  } else {
    result.note = 'yt-dlp: ' + (err || 'ukjent feil (kode ' + r.code + ')') + denoNote;
  }
  if (!result.files.length) { try { fs.rmdirSync(mediaDir); } catch (e) {} }
  return result;
}

// ------------------------------------------------------------
//  Bilder på siden (hentes med vinduets innlogging)
// ------------------------------------------------------------
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/heic': 'heic' };
async function downloadPageImages(wc, dir, progress) {
  const list = await wc.executeJavaScript(PAGE_IMAGES).catch(() => []);
  const out = [];
  if (!list.length) return out;
  fs.mkdirSync(dir, { recursive: true });
  const ses = bevisSession();
  let n = 0;
  for (const it of list) {
    n++;
    progress && progress('Henter bilder på siden … ' + n + '/' + list.length);
    try {
      let buf, type;
      if (it.url.startsWith('data:')) {
        const m = it.url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
        if (!m) continue;
        type = m[1];
        buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
      } else {
        const r = await fetchBuffer(it.url, { ses, timeoutMs: 45000, maxBytes: MAX_IMAGE_BYTES });
        buf = r.buf; type = r.type;
      }
      if (!buf || buf.length < 1000) continue;
      const ext = EXT_BY_TYPE[type] || (it.url.split('?')[0].match(/\.(jpe?g|png|webp|gif|avif|heic)$/i) || [, 'bin'])[1].toLowerCase().replace('jpeg', 'jpg');
      const name = 'bilde-' + pad2(out.length + 1) + '.' + ext;
      fs.writeFileSync(path.join(dir, name), buf);
      out.push({ file: 'bilder/' + name, sourceUrl: it.url.startsWith('data:') ? '(innebygd data-URL)' : it.url, alt: it.alt, width: it.width, height: it.height });
    } catch (e) { /* hopp over bilder som ikke kan hentes */ }
  }
  if (!out.length) { try { fs.rmdirSync(dir); } catch (e) {} }
  return out;
}

// ------------------------------------------------------------
//  Wayback Machine (frivillig — forteller en tredjepart hva vi ser på)
// ------------------------------------------------------------
async function waybackSave(url) {
  const started = new Date().toISOString();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120000);
    const res = await net.fetch('https://web.archive.org/save/' + url, { signal: ctl.signal, headers: { 'User-Agent': 'FaktiskStudio-bevissikring' } });
    clearTimeout(timer);
    const loc = res.headers.get('content-location') || '';
    let archived = loc ? 'https://web.archive.org' + loc : (/\/web\/\d{8,}/.test(res.url) ? res.url : '');
    return { requestedAt: started, ok: res.ok && !!archived, status: res.status, archivedUrl: archived || null,
      note: archived ? '' : (res.status === 429 ? 'Wayback: for mange forespørsler — prøv igjen senere' : 'Wayback svarte uten arkivlenke (HTTP ' + res.status + ')') };
  } catch (e) {
    return { requestedAt: started, ok: false, archivedUrl: null, note: 'Wayback: ' + (e.name === 'AbortError' ? 'tidsavbrudd' : e.message) };
  }
}

// ------------------------------------------------------------
//  Manifest og sjekksummer
// ------------------------------------------------------------
async function finalize(dir, manifest) {
  const files = listFiles(dir).filter(f => f !== MANIFEST_FILE && f !== SUMS_FILE && !STAMP_RE.test(f));
  manifest.files = [];
  for (const f of files) {
    const full = path.join(dir, f);
    manifest.files.push({ path: f, bytes: fs.statSync(full).size, sha256: await sha256File(full) });
  }
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n');
  const all = files.concat([MANIFEST_FILE]).sort((a, b) => a.localeCompare(b, 'nb'));
  const lines = [];
  for (const f of all) {
    const h = f === MANIFEST_FILE ? await sha256File(path.join(dir, f)) : manifest.files.find(x => x.path === f).sha256;
    lines.push(h + '  ' + f);
  }
  fs.writeFileSync(path.join(dir, SUMS_FILE), lines.join('\n') + '\n');
  const fingerprint = await sha256File(path.join(dir, SUMS_FILE));
  let stamp = null;
  if (settings.timestamp && stampHooks) {
    try { stamp = await stampHooks.stamp(dir); } catch (e) { stamp = { ok: false, error: e.message }; }
  }
  return { fingerprint, fileCount: all.length + 1, bytes: manifest.files.reduce((s, x) => s + x.bytes, 0), stamp };
}

async function makeThumb(dir, srcFile) {
  const sharp = getSharp();
  if (!sharp || !srcFile) return;
  try {
    await sharp(path.join(dir, srcFile), { limitInputPixels: false })
      .resize({ width: 360, height: 270, fit: 'cover', position: 'top' })
      .jpeg({ quality: 78 }).toFile(path.join(dir, THUMB_FILE));
  } catch (e) {}
}

function captureFolder(root, caseName, url, when, suffix) {
  const d = describeUrl(url);
  const stamp = when.getFullYear() + '-' + pad2(when.getMonth() + 1) + '-' + pad2(when.getDate()) + '_' + pad2(when.getHours()) + pad2(when.getMinutes()) + pad2(when.getSeconds());
  const name = [stamp, slug(d.platform, 24), slug(d.handle, 40), suffix ? slug(suffix, 24) : ''].filter(Boolean).join('_');
  if (!root || !fs.existsSync(root)) throw new Error(root ? 'Arkivmappa er ikke tilgjengelig (låst kryptert arkiv?)' : 'Velg arkivmappe først');
  const caseDir = path.join(root, safeName(caseName) || 'Uten sak');
  let dir = path.join(caseDir, name), i = 2;
  while (fs.existsSync(dir)) dir = path.join(caseDir, name + '-' + i++);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, platform: d.platform, handle: d.handle };
}

function baseManifest({ kind, caseName, note, url, info, when, platform, handle, appVersion }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    format: 'faktisk-bevissikring', version: 1, kind,
    case: caseName || '', note: note || '',
    capturedAt: when.toISOString(),
    capturedAtLocal: when.toLocaleString('nb-NO', { timeZone: tz }) + ' (' + tz + ')',
    capturedBy: (() => { try { return os.userInfo().username; } catch (e) { return ''; } })(),
    capturedByName: settings.userName || '',
    // Kontoen som er logget inn i sikringsvinduet (redaksjonens researchkonto)
    loginAccount: kind === 'chrome' ? '' : (settings.account || ''),
    machine: os.hostname(),
    tool: { name: 'Faktisk Studio · Bevissikring', studioVersion: appVersion, pluginVersion: null },
    source: {
      requestedUrl: url, finalUrl: info.url, title: info.title, canonical: info.canonical || '',
      platform, handle, lang: info.lang || '',
      meta: info.meta || {},
    },
    browser: { userAgent: info.userAgent, viewport: info.viewport },
    howToVerify: 'Åpne Terminal i denne mappa og kjør: shasum -a 256 -c ' + SUMS_FILE,
  };
}

// ------------------------------------------------------------
//  Kontroll og liste
// ------------------------------------------------------------
async function verifyFolder(dir) {
  const sumsPath = path.join(dir, SUMS_FILE);
  if (!fs.existsSync(sumsPath)) return { ok: false, error: 'Fant ikke ' + SUMS_FILE };
  const expected = new Map();
  for (const line of fs.readFileSync(sumsPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m) expected.set(m[2], m[1].toLowerCase());
  }
  const changed = [], missing = [];
  for (const [f, h] of expected) {
    const full = path.join(dir, f);
    if (!fs.existsSync(full)) { missing.push(f); continue; }
    if ((await sha256File(full)) !== h) changed.push(f);
  }
  const extra = listFiles(dir).filter(f => f !== SUMS_FILE && !expected.has(f) && !STAMP_RE.test(f));
  let stamp = null;
  if (stampHooks) { try { stamp = await stampHooks.verify(dir); } catch (e) { stamp = { ok: false, error: e.message }; } }
  return { ok: !changed.length && !missing.length && !(stamp && !stamp.missing && !stamp.ok), checked: expected.size, changed, missing, extra, stamp,
    fingerprint: await sha256File(sumsPath), checkedAt: new Date().toISOString() };
}

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')); } catch (e) { return null; }
}

function listCaptures(root) {
  const out = [], cases = [];
  let caseEnts = [];
  try { caseEnts = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return { cases, items: out }; }
  for (const ce of caseEnts) {
    if (!ce.isDirectory() || ce.name.startsWith('.') || ce.name.startsWith('_')) continue;
    cases.push(ce.name);
    const caseDir = path.join(root, ce.name);
    let ents = [];
    try { ents = fs.readdirSync(caseDir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(caseDir, e.name);
      const m = readManifest(dir);
      if (!m || m.format !== 'faktisk-bevissikring') continue;
      let fingerprint = '';
      try { fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, SUMS_FILE))).digest('hex'); } catch (err) {}
      const files = m.files || [];
      const pick = re => (files.find(f => re.test(f.path)) || {}).path || '';
      out.push({
        dir, case: ce.name, folderName: e.name, kind: m.kind, capturedAt: m.capturedAt, capturedAtLocal: m.capturedAtLocal,
        capturedBy: m.capturedBy, note: m.note, url: m.source && (m.source.finalUrl || m.source.requestedUrl),
        requestedUrl: m.source && m.source.requestedUrl, title: m.source && m.source.title, platform: m.source && m.source.platform,
        fileCount: files.length + 2, bytes: files.reduce((s, f) => s + (f.bytes || 0), 0), fingerprint,
        thumb: fs.existsSync(path.join(dir, THUMB_FILE)) ? path.join(dir, THUMB_FILE) : '',
        mainImage: pick(/^(utsnitt|skjermbilde-hele-siden|skjermbilde-chrome)\.png$/) || pick(/^skjermbilder\/rulling-01\.png$/) || pick(/^media\/.+\.(mp4|mkv|webm|mov|m4a|mp3)$/i),
        media: files.filter(f => f.path.startsWith('media/') && !/\.(json|jpg|webp|png)$/i.test(f.path)).length,
        images: files.filter(f => f.path.startsWith('bilder/')).length,
        wayback: m.wayback && m.wayback.archivedUrl || '',
        warnings: m.warnings || [],
        sample: m.sample || null,
        tag: m.tag || null,
        capturedByName: m.capturedByName || '',
        loginAccount: m.loginAccount || '',
        stamp: (() => { try { const t = JSON.parse(fs.readFileSync(path.join(dir, 'tidsstempel.json'), 'utf8')); return { genTime: t.genTime, tsa: t.tsa }; } catch (err) { return null; } })(),
      });
    }
  }
  out.sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
  cases.sort((a, b) => a.localeCompare(b, 'nb'));
  return { cases, items: out };
}

function isInsideCaptureFolder(p) {
  // Godta bare stier i (eller lik) en mappe med vårt manifest
  let d = path.resolve(p);
  for (let i = 0; i < 4; i++) {
    const m = readManifest(d);
    if (m && m.format === 'faktisk-bevissikring') return true;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return false;
}

// ------------------------------------------------------------
//  Selve sikringen
// ------------------------------------------------------------
async function doCapture(e, opts) {
  const sender = e.sender;
  const progress = (msg, pct) => sendTo(sender, 'bevis-progress', { msg, pct });
  const o = Object.assign({ screenshot: true, scroll: true, pdf: true, mhtml: true, text: true, media: true, pageImages: true, comments: false, wayback: false }, opts.options || {});
  if (!opts.root) throw new Error('Velg arkivmappe først');

  let w = win && !win.isDestroyed() ? win : null;
  const wantUrl = normalizeUrl(opts.url);
  if (!w) {
    if (!wantUrl) throw new Error('Åpne en side først');
    w = ensureWindow();
    progress('Åpner siden …');
    w.webContents.loadURL(wantUrl).catch(() => {});
    await waitForLoad(w.webContents, 45000);
    await wait(2500);
  }
  const wc = w.webContents;
  if (wc.isLoading()) { progress('Venter på at siden lastes ferdig …'); await waitForLoad(wc, 30000); }
  if (!/^https?:/.test(wc.getURL())) throw new Error('Vinduet viser ingen nettside');

  const when = new Date();
  const info = await wc.executeJavaScript(PAGE_INFO);
  if (!/^https?:/.test(info.url || '')) throw new Error('Siden kunne ikke lastes — sjekk adressen eller nettforbindelsen');
  const pageUrl = info.url;
  const sample = opts.sample && typeof opts.sample === 'object' ? opts.sample : null;
  const tag = opts.tag && typeof opts.tag === 'object' ? opts.tag : null;
  const suffix = sample ? 's' + pad2((sample.index || 0) + 1) : (tag && tag.suffix ? String(tag.suffix) : '');
  const { dir, platform, handle } = captureFolder(opts.root, opts.caseName, pageUrl, when, suffix);
  const manifest = baseManifest({ kind: sample ? 'stikkprove' : 'side', caseName: opts.caseName, note: opts.note, url: wantUrl || pageUrl, info, when, platform, handle, appVersion: deps.app.getVersion() });
  manifest.tool.pluginVersion = opts.pluginVersion || null;
  if (sample) manifest.sample = sample;
  if (tag) manifest.tag = tag;
  manifest.options = o;
  manifest.warnings = [];
  manifest.steps = [];
  const step = (name, extra) => manifest.steps.push(Object.assign({ step: name, at: new Date().toISOString() }, extra || {}));

  // Wayback i bakgrunnen mens resten pågår
  const waybackP = o.wayback ? waybackSave(pageUrl) : null;

  try {
    // 1) Skjermbilder underveis i rullingen (laster også inn lat innhold)
    let scrolled = null;
    if (o.scroll) {
      const sdir = path.join(dir, 'skjermbilder');
      fs.mkdirSync(sdir, { recursive: true });
      progress('Ruller gjennom siden og tar skjermbilder …');
      try {
        scrolled = await scrollShots(wc, sdir, n => progress('Ruller gjennom siden … bilde ' + n), opts.maxScroll);
        step('rulling', { count: scrolled.files.length });
        if (scrolled.files.length >= scrolled.limit && !opts.maxScroll) manifest.warnings.push('Siden var lengre enn ' + scrolled.limit + ' skjermhøyder — rullebildene dekker bare starten.');
      } catch (err) { manifest.warnings.push('Rullebilder feilet: ' + err.message); }
    }

    // 2) Tekst og HTML — etter rullingen, så kommentarer og innlegg som
    //    lastes inn underveis kommer med. Teksten samles fra hvert rullesteg,
    //    så innlegg som feeden har fjernet fra toppen også er med.
    let after = info;
    if (o.scroll) { try { after = await wc.executeJavaScript(PAGE_INFO); } catch (err) {} }
    if (o.text) {
      let text = after.text || '', source = 'side';
      if (scrolled && scrolled.textLines.length) {
        const all = scrolled.textLines.slice();
        mergeLines(all, after.text);
        text = all.join('\n'); source = 'samlet under rulling';
      }
      fs.writeFileSync(path.join(dir, 'tekst.txt'), text);
      step('tekst', { chars: text.length, source });
    }
    if (o.mhtml) {
      fs.writeFileSync(path.join(dir, 'side.html'), after.html || '');
      step('html');
    }

    // 3) Hele siden som ett bilde
    if (o.screenshot) {
      progress('Tar skjermbilde av hele siden …');
      try {
        const shot = await fullPageShot(wc);
        fs.writeFileSync(path.join(dir, 'skjermbilde-hele-siden.png'), shot.buf);
        step('skjermbilde', { cssWidth: shot.cssWidth, cssHeight: shot.cssHeight, tiles: shot.tiles });
        if (shot.truncated) manifest.warnings.push('Siden er svært lang — skjermbildet er kuttet ved ' + MAX_SHOT_CSS_H + ' px.' + (o.scroll ? ' Se rullebildene.' : ' Slå på «Skjermbilder mens siden rulles» for å få med resten.'));
        if (shot.viewportHeight && shot.cssHeight <= shot.viewportHeight + 4 && scrolled && scrolled.inner) {
          manifest.warnings.push('Siden ruller inne i en egen boks (vanlig på SoMe) — «hele siden» viser bare det synlige. Rullebildene dekker resten.');
        }
      } catch (err) { manifest.warnings.push('Skjermbilde feilet: ' + err.message); }
    }

    // 4) PDF og nettarkiv-fil
    if (o.pdf) {
      progress('Lager PDF …');
      try {
        const pdf = await wc.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
        fs.writeFileSync(path.join(dir, 'side.pdf'), pdf);
        step('pdf');
      } catch (err) { manifest.warnings.push('PDF feilet: ' + err.message); }
    }
    if (o.mhtml) {
      progress('Lagrer nettarkiv-fil (MHTML) …');
      try {
        await wc.savePage(path.join(dir, 'side.mhtml'), 'MHTML');
        step('mhtml');
      } catch (err) { manifest.warnings.push('MHTML feilet: ' + err.message); }
    }

    // 5) Bilder på siden
    if (o.pageImages) {
      try {
        const imgs = await downloadPageImages(wc, path.join(dir, 'bilder'), progress);
        manifest.pageImages = imgs;
        step('bilder', { count: imgs.length });
      } catch (err) { manifest.warnings.push('Bilder på siden feilet: ' + err.message); }
    }

    // 6) Video og bilder fra innlegget (yt-dlp)
    if (o.media) {
      progress('Leter etter video …');
      const mres = await downloadMedia(pageUrl, path.join(dir, 'media'), { comments: o.comments, progress });
      manifest.media = { tool: mres.tool, ok: mres.ok, note: mres.note };
      step('media', { count: mres.files.length });
      if (mres.note && mres.ok) manifest.warnings.push(mres.note);
      if (!mres.ok && mres.note && !/^Fant ingen/.test(mres.note)) manifest.warnings.push(mres.note);
    }

    // 7) Wayback
    if (waybackP) {
      progress('Venter på Wayback Machine …');
      manifest.wayback = await waybackP;
      if (!manifest.wayback.ok) manifest.warnings.push(manifest.wayback.note);
    }

    progress('Regner ut sjekksummer …');
    await makeThumb(dir, fs.existsSync(path.join(dir, 'skjermbilde-hele-siden.png')) ? 'skjermbilde-hele-siden.png'
      : (fs.existsSync(path.join(dir, 'skjermbilder', 'rulling-01.png')) ? 'skjermbilder/rulling-01.png' : ''));
    manifest.completedAt = new Date().toISOString();
    const fin = await finalize(dir, manifest);
    progress('Ferdig', 100);
    return { ok: true, dir, fingerprint: fin.fingerprint, fileCount: fin.fileCount, bytes: fin.bytes, warnings: manifest.warnings, media: manifest.media || null, wayback: manifest.wayback || null, stamp: fin.stamp };
  } catch (err) {
    // Selv ved feil: skriv det vi har, så ingenting går tapt i stillhet
    manifest.warnings.push('Avbrutt: ' + err.message);
    manifest.completedAt = new Date().toISOString();
    try { await finalize(dir, manifest); } catch (e2) {}
    throw err;
  }
}

// «Bare video»: yt-dlp rett på adressen, uten sikringsvindu og skjermbilder.
// Innloggingen fra sikringsvinduet brukes likevel (cookies), så innlegg som
// krever konto virker hvis man har logget inn der en gang.
async function doDownload(e, opts) {
  const progress = msg => sendTo(e.sender, 'bevis-progress', { msg });
  if (!opts.root) throw new Error('Velg arkivmappe først');
  const url = normalizeUrl(opts.url);
  if (!url) throw new Error('Ugyldig adresse');
  const when = new Date();
  const { dir, platform, handle } = captureFolder(opts.root, opts.caseName, url, when, 'video');
  progress('Henter video …');
  const mres = await downloadMedia(url, path.join(dir, 'media'), { comments: !!opts.comments, progress });
  if (!mres.ok) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {}
    throw new Error(mres.note || 'Fant ingen video');
  }
  // Metadata fra yt-dlp (første info.json)
  let meta = {};
  const infoFile = mres.files.find(f => /\.info\.json$/.test(f));
  if (infoFile) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, infoFile), 'utf8'));
      meta = { title: j.title || j.fulltitle || '', uploader: j.uploader || j.channel || '', uploader_id: j.uploader_id || j.channel_id || '',
        upload_date: j.upload_date || '', timestamp: j.timestamp || null, duration: j.duration || null, webpage_url: j.webpage_url || url,
        extractor: j.extractor_key || j.extractor || '', description: String(j.description || '').slice(0, 2000) };
    } catch (err) {}
  }
  const info = {
    url: meta.webpage_url || url, title: meta.title || '', canonical: '', lang: '',
    meta: Object.fromEntries(Object.entries(meta).filter(([k, v]) => v !== '' && v !== null && k !== 'title' && k !== 'webpage_url')),
    userAgent: cleanUserAgent(bevisSession().getUserAgent()), viewport: null,
  };
  const manifest = baseManifest({ kind: 'video', caseName: opts.caseName, note: opts.note, url, info, when, platform, handle, appVersion: deps.app.getVersion() });
  manifest.tool.pluginVersion = opts.pluginVersion || null;
  manifest.media = { tool: mres.tool, ok: mres.ok, note: mres.note };
  manifest.warnings = mres.note ? [mres.note] : [];
  const thumb = mres.files.find(f => /\.(jpe?g|webp|png)$/i.test(f));
  if (thumb) await makeThumb(dir, thumb);
  progress('Regner ut sjekksummer …');
  manifest.completedAt = new Date().toISOString();
  const fin = await finalize(dir, manifest);
  return { ok: true, dir, fingerprint: fin.fingerprint, fileCount: fin.fileCount, bytes: fin.bytes, warnings: manifest.warnings, title: meta.title || '', stamp: fin.stamp };
}

async function doCaptureRegion(e, opts) {
  if (!win || win.isDestroyed()) throw new Error('Åpne en side først');
  if (!opts.root) throw new Error('Velg arkivmappe først');
  const wc = win.webContents;
  if (!/^https?:/.test(await wc.executeJavaScript('location.href').catch(() => ''))) throw new Error('Vinduet viser ingen nettside');
  win.show(); win.focus();
  const rect = await wc.executeJavaScript(PAGE_SELECT_REGION, true);
  if (!rect) return { ok: false, canceled: true };
  await wait(120);
  const img = await wc.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
  const when = new Date();
  const info = await wc.executeJavaScript(PAGE_INFO);
  const { dir, platform, handle } = captureFolder(opts.root, opts.caseName, info.url, when);
  fs.writeFileSync(path.join(dir, 'utsnitt.png'), img.toPNG());
  // Hele det synlige vinduet også, så utsnittet har sammenheng
  const full = await wc.capturePage();
  fs.writeFileSync(path.join(dir, 'synlig-vindu.png'), full.toPNG());
  if (opts.text !== false) fs.writeFileSync(path.join(dir, 'tekst.txt'), info.text || '');
  const manifest = baseManifest({ kind: 'utsnitt', caseName: opts.caseName, note: opts.note, url: info.url, info, when, platform, handle, appVersion: deps.app.getVersion() });
  manifest.tool.pluginVersion = opts.pluginVersion || null;
  manifest.region = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, coordinates: 'CSS-piksler i synlig vindu' };
  manifest.warnings = [];
  await makeThumb(dir, 'utsnitt.png');
  manifest.completedAt = new Date().toISOString();
  const fin = await finalize(dir, manifest);
  return { ok: true, dir, fingerprint: fin.fingerprint, fileCount: fin.fileCount, bytes: fin.bytes, warnings: [], stamp: fin.stamp };
}

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain, d) {
  deps = d;

  // Foreslått mappe — brukes bare som forslag i mappevelgeren, aldri stille
  ipcMain.handle('bevis-default-root', () => path.join(deps.app.getPath('documents'), 'Faktisk bevissikring'));

  ipcMain.handle('bevis-open', async (e, opts) => {
    owner = e.sender;
    const url = normalizeUrl(opts && opts.url);
    if (url && !(await confirmVisit(url))) return { ok: false, cancelled: true, error: 'Avbrutt' };
    const w = ensureWindow();
    if (url) w.webContents.loadURL(url).catch(() => {});
    w.show();
    if (!(opts && opts.wait)) { w.focus(); return { ok: true, url }; }
    // Stikkprøver: vent til siden er lastet og har fått falle til ro
    await wait(300);
    await waitForLoad(w.webContents, 45000);
    await wait(Math.min(Math.max(+opts.settleMs || 2500, 500), 15000));
    return { ok: true, url, finalUrl: w.webContents.getURL(), title: w.webContents.getTitle() };
  });

  ipcMain.handle('bevis-window-state', (e) => { owner = e.sender; return windowState(); });

  ipcMain.handle('bevis-focus', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); return true; } return false; });

  ipcMain.handle('bevis-capture', async (e, opts) => {
    if (busy) return { ok: false, error: 'En sikring pågår allerede' };
    busy = true;
    try { return await doCapture(e, opts || {}); }
    catch (err) { return { ok: false, error: err.message }; }
    finally { busy = false; }
  });

  ipcMain.handle('bevis-capture-region', async (e, opts) => {
    if (busy) return { ok: false, error: 'En sikring pågår allerede' };
    busy = true;
    try { return await doCaptureRegion(e, opts || {}); }
    catch (err) { return { ok: false, error: err.message }; }
    finally { busy = false; }
  });

  ipcMain.handle('bevis-download', async (e, opts) => {
    if (busy) return { ok: false, error: 'En sikring pågår allerede' };
    busy = true;
    try {
      if (opts && opts.url && !(await confirmVisit(normalizeUrl(opts.url)))) return { ok: false, cancelled: true, error: 'Avbrutt' };
      return await doDownload(e, opts || {});
    }
    catch (err) { return { ok: false, error: err.message }; }
    finally { busy = false; }
  });

  ipcMain.handle('bevis-list', (e, opts) => {
    try { return Object.assign({ ok: true }, listCaptures(opts && opts.root)); }
    catch (err) { return { ok: false, error: err.message, cases: [], items: [] }; }
  });

  ipcMain.handle('bevis-verify', async (e, opts) => {
    const dir = opts && opts.dir;
    if (!dir || !isInsideCaptureFolder(dir)) return { ok: false, error: 'Ikke en sikringsmappe' };
    try { return await verifyFolder(dir); } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-open-path', async (e, opts) => {
    const p = opts && opts.path;
    if (!p || !fs.existsSync(p) || !isInsideCaptureFolder(p)) return { ok: false, error: 'Finnes ikke' };
    if (opts.reveal) { shell.showItemInFolder(p); return { ok: true }; }
    const err = await shell.openPath(p);
    return { ok: !err, error: err || undefined };
  });

  ipcMain.handle('bevis-tool-status', async () => {
    const yt = fs.existsSync(ytDlpPath());
    let version = '';
    if (yt) { const r = await run(ytDlpPath(), ['--version'], { timeoutMs: 60000 }); version = String(r.stdout).trim(); }
    return { ytDlp: yt, ytDlpVersion: version, deno: !!findDeno() };
  });

  ipcMain.handle('bevis-update-tools', async (e) => {
    try {
      await ensureYtDlp(msg => sendTo(e.sender, 'bevis-progress', { msg }), { update: true });
      const r = await run(ytDlpPath(), ['--version'], { timeoutMs: 60000 });
      return { ok: true, ytDlpVersion: String(r.stdout).trim() };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-logout', async () => {
    await bevisSession().clearStorageData();
    if (win && !win.isDestroyed()) win.webContents.reload();
    return { ok: true };
  });
}

module.exports = {
  register,
  // Brukes av src/bevis-sample.js (stikkprøver)
  _internal: { settings, setStampHooks, readManifest, confirmVisit, visitWarning, getWindow: () => (win && !win.isDestroyed() ? win : null), ensureWindow, waitForLoad, wait, normalizeUrl, PAGE_SCROLLER, mergeLines, doDownload, downloadMedia, captureFolder, baseManifest, finalize, makeThumb, ensureYtDlp, run, binDir, EXTRA_PATH, safeName, slug, describeUrl, sha256File, listFiles, cleanUserAgent, bevisSession, fetchBuffer },
  _test: { describeUrl, slug, safeName, sumsLookup, cleanUserAgent, verifyFolder, listCaptures, mergeLines, finalize, visitWarning },
};
