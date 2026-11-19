// Faktisk Studio · Presentasjon-pluginen (main-siden)
//
//   presentation-read-file  Leser en lokal mediefil (bilde, video, lyd) som bytes,
//                           så pluginen kan legge den inn i Keynote-fila. fetch()
//                           kan ikke lese file://-adresser i rendereren.
//   presentation-waveform   Lager lydbølge-video: hvert bilde tegnes som SVG (sharp) og
//                           kodes med ffmpeg sammen med lyden. Bølgen fylles ut der
//                           lyden er spilt, stolpene ved streken går som en lydmåler,
//                           og telleren viser «0:12 / 2:06». Med from/to blir det et
//                           utsnitt (ett funn) med bånd og etikett. Mellomlagres i
//                           userData/presentasjon-cache.
//   presentation-fit-video  Beskjærer et klipp til feltet i lysbildet og maler runde hjørner
//                           i bakgrunnsfargen (Keynote runder ikke hjørner på video)
//   presentation-fonts-install  Legger fritt lisensierte fonter fra pluginen i ~/Library/Fonts
//   presentation-fonts-find/-choose/-install-from  Haas Grot Text fra Faktisks fontmappe (tilgang = lisens)
//   presentation-keynote    Tar imot .pptx-fila pluginen har laget, åpner den i
//                           Keynote og lagrer den som .key i dokumentets Eksport/
//                           (eller der brukeren velger). .pptx-fila slettes. Går
//                           AppleScript ikke (manglende tillatelse), legges .pptx-fila
//                           i Eksport/ og åpnes i Keynote i stedet.
//
// Fremdrift sendes som 'presentation-progress' til vinduet som spurte.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

let deps = null;   // { app, dialog, shell, findFfmpeg }

const MEDIA = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
  '.heic':'image/heic', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.m4v':'video/mp4', '.mov':'video/quicktime',
  '.webm':'video/webm', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.aac':'audio/aac', '.wav':'audio/wav', '.ogg':'audio/ogg' };

function toPath(p) {
  if (typeof p !== 'string') return '';
  if (p.startsWith('file://')) { try { p = decodeURI(p.slice(7)); } catch (e) { return ''; } }
  return p.startsWith('/') ? p : '';
}
const fmt = (t) => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const progress = (e, msg, frac) => { try { e.sender.send('presentation-progress', { msg, frac }); } catch (x) {} };

function run(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args); let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (x) => resolve({ ok: false, error: x.message }));
    p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split('\n').slice(-3).join(' ') }));
  });
}

function readFile(e, p) {
  p = toPath(p);
  const type = MEDIA[path.extname(p).toLowerCase()];
  if (!p || !type) return { ok: false, error: 'Ikke en mediefil' };
  try { return { ok: true, bytes: fs.readFileSync(p), type }; } catch (x) { return { ok: false, error: 'Fant ikke fila: ' + p }; }
}

// Lydmåler: samme regler som i pluginen (liveBar/envAt i prototypen)
const LIVE = { span: 9, dt: 0.03, block: 0.02 };
const liveBar = (baseH, d, lvl, WH) => { const w = Math.exp(-((d / 4) ** 2)); return baseH * (1 - w) + Math.max(baseH * 0.35, 6 + WH * Math.min(1, lvl) * 0.95) * w; };
const hex = (v, d) => (/^#?[0-9A-F]{6}$/i.test(v || '') ? '#' + String(v).replace('#', '') : d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// lydstyrke per 20 ms for hele klippet, normert mot 98-persentilen
function envelope(ff, src) {
  return new Promise((resolve) => {
    const p = spawn(ff, ['-v', 'error', '-i', src, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
    const chunks = []; p.stdout.on('data', (d) => chunks.push(d)); p.on('error', () => resolve(null));
    p.on('close', () => {
      const b = Buffer.concat(chunks), n = Math.floor(b.length / 2), blk = Math.round(8000 * LIVE.block), v = [];
      for (let i = 0; i < n; i += blk) { let s = 0, c = 0; for (let j = i; j < Math.min(n, i + blk); j += 2) { const x = b.readInt16LE(j * 2) / 32768; s += x * x; c++; } v.push(Math.sqrt(s / Math.max(1, c))); }
      const ref = [...v].sort((a, c) => a - c)[Math.floor(v.length * 0.98)] || 1;
      resolve(v.map((x) => Math.pow(Math.min(1, x / ref), 0.7)));
    });
  });
}

// Ett bilde i videoen som SVG: bølge (svak = ikke spilt), funnbånd, lydmåler ved streken, strek og teller
function frameSvg(o, t, env) {
  const W = 1660, H = 310, WY = 30, WH = 230, N = o.peaks.length, bw = W / N, k = t / o.dur * N;
  const lvl = (tt) => env ? env[Math.max(0, Math.min(env.length - 1, Math.floor(tt / LIVE.block)))] || 0 : 0;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${o.c.flate}"/>`;
  if (o.seg) {
    const x0 = o.seg[0] / o.dur * W, x1 = Math.max(x0 + 8, o.seg[1] / o.dur * W);
    s += `<rect x="${x0.toFixed(1)}" y="${WY - 6}" width="${(x1 - x0).toFixed(1)}" height="${WH + 12}" fill="${o.c.markering}" fill-opacity=".2" stroke="${o.c.markering}" stroke-width="3"/>`;
    if (o.label) s += `<text x="${Math.min(W - 60, Math.max(60, (x0 + x1) / 2)).toFixed(1)}" y="19" text-anchor="middle" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-weight="700" font-size="19" fill="${o.c.markering}">${esc(o.label)}</text>`;
  }
  let played = '', rest = '';
  for (let i = 0; i < N; i++) {
    const base = Math.max(4, o.peaks[i] * WH), d = i + 0.5 - k;
    const hh = Math.abs(d) <= LIVE.span ? liveBar(base, d, lvl(t + d * LIVE.dt), WH) : base;
    const r = `<rect x="${(i * bw + bw * 0.2).toFixed(1)}" y="${(WY + (WH - hh) / 2).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${hh.toFixed(1)}" rx="${(bw * 0.3).toFixed(1)}"/>`;
    if (d < 0) played += r; else rest += r;
  }
  s += `<g fill="${o.c.aksent}">${played}</g><g fill="${o.c.aksent}" fill-opacity=".3">${rest}</g>`;
  s += `<rect x="${(k * bw - 2).toFixed(1)}" y="6" width="4" height="270" rx="2" fill="${o.c.tekst}"/>`;
  s += `<text x="${W / 2}" y="298" text-anchor="middle" font-family="Helvetica, Arial, DejaVu Sans, sans-serif" font-size="24" fill="${o.c.dempet}">${fmt(t)} / ${fmt(o.dur)}</text></svg>`;
  return s;
}

async function waveform(e, o) {
  const src = toPath(o && o.src);
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Fant ikke lydfila' };
  const peaks = Array.isArray(o.peaks) ? o.peaks.slice(0, 2000).map((v) => Math.max(0, Math.min(1, Number(v) || 0))) : null;
  if (!peaks || !peaks.length) return { ok: false, error: 'Mangler lydbølgen' };
  const dur = Number(o.dur) || 0, from = Math.max(0, Number(o.from) || 0);
  const to = Math.min(dur || 1e9, o.to == null ? dur : Number(o.to)), len = Math.max(0.5, to - from);
  const c = o.colors || {};
  const opt = { peaks, dur, c: { flate: hex(c.flate, '#ECEAE4'), aksent: hex(c.aksent, '#2D4A68'), markering: hex(c.markering, '#B4472F'), tekst: hex(c.tekst, '#1D2733'), dempet: hex(c.dempet, '#5B6572') },
    seg: Array.isArray(o.seg) ? o.seg.map(Number) : null, label: o.label ? String(o.label).slice(0, 40) : '' };
  const st = fs.statSync(src);
  const key = crypto.createHash('sha256').update(JSON.stringify([src, st.size, st.mtimeMs, opt, from, to, 5])).digest('hex').slice(0, 24);
  const dir = path.join(deps.app.getPath('userData'), 'presentasjon-cache');
  const out = path.join(dir, key + '.mp4');
  if (fs.existsSync(out)) return { ok: true, path: out, cached: true };
  fs.mkdirSync(dir, { recursive: true });
  let sharp; try { sharp = require('sharp'); } catch (x) { return { ok: false, error: 'sharp mangler' }; }
  const ff = deps.findFfmpeg(), env = await envelope(ff, src);
  const W = 1660, H = 310, FPS = 25, frames = Math.ceil(len * FPS);
  const tmp = out + '.tmp.mp4';
  const p = spawn(ff, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-ss', String(from), '-t', String(len), '-i', src, '-map', '0:v', '-map', '1:a?', '-t', String(len),
    // BT.709-merket, så flatene får nøyaktig lysbildets farge i Keynote (ellers synes en svak boks rundt bølgen)
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', tmp]);
  let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const done = new Promise((resolve) => { p.on('close', (code) => resolve(code)); p.on('error', () => resolve(-1)); });
  p.stdin.on('error', () => {});
  try {
    for (let f = 0; f < frames; f++) {
      const raw = await sharp(Buffer.from(frameSvg(opt, from + f / FPS, env))).removeAlpha().raw().toBuffer();
      if (!p.stdin.write(raw)) await new Promise((r) => p.stdin.once('drain', r));
      if (f % 50 === 0) progress(e, 'Lager lydbølge-video …', f / frames);
    }
  } catch (x) { err = x.message; }
  p.stdin.end();
  const code = await done;
  if (code !== 0 || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (x) {} return { ok: false, error: err.trim() || 'ffmpeg feilet' }; }
  fs.renameSync(tmp, out);
  return { ok: true, path: out };
}

// Klipp til et lysbildefelt: beskjært og skalert til feltet, med runde hjørner malt i fargen bak
// (Keynote tegner ikke runde hjørner på video, så hjørnene bakes inn i selve klippet)
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
function holePath(W, H, r, ellipse) {
  if (ellipse) { const rx = W / 2, ry = H / 2; return `M0 ${ry}A${rx} ${ry} 0 1 0 ${W} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`; }
  r = Math.max(0, Math.min(r, W / 2, H / 2));
  return `M${r} 0H${W - r}A${r} ${r} 0 0 1 ${W} ${r}V${H - r}A${r} ${r} 0 0 1 ${W - r} ${H}H${r}A${r} ${r} 0 0 1 0 ${H - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}
async function fitVideo(e, o) {
  const src = toPath(o && o.src);
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Fant ikke klippet' };
  const W = even(Number(o.w) || 0), H = even(Number(o.h) || 0);
  if (W < 16 || H < 16 || W > 3840 || H > 2160) return { ok: false, error: 'Ugyldig størrelse' };
  const cr = (Array.isArray(o.crop) ? o.crop : []).map((v) => Math.max(0, Math.floor(Number(v) || 0)));
  if (cr.length !== 4 || cr[2] < 2 || cr[3] < 2) return { ok: false, error: 'Ugyldig utsnitt' };
  const r = Math.max(0, Number(o.radius) || 0), ellipse = !!o.ellipse, bg = hex(o.bg, '#000000');
  // hvit kant og skygge: klippet får en marg i bakgrunnsfargen der kanten og skyggen tegnes.
  // kantUt: kanten ligger utenpå klippet (fra Presentasjon 0.1.12); ellers innenfor, som før.
  const kant = Math.max(0, Math.min(40, Number(o.kant) || 0)), ut = !!o.kantUt, K = ut ? kant : 0;
  const sk = o.skygge && typeof o.skygge === 'object' ? { y: Number(o.skygge.y) || 0, blur: Number(o.skygge.blur) || 0, alpha: Math.min(1, Number(o.skygge.alpha) || 0), pad: even(Number(o.skygge.pad) || 0) } : null;
  const P = (sk ? sk.pad : 0) + K, TW = W + 2 * P, TH = H + 2 * P;
  const st = fs.statSync(src);
  const key = crypto.createHash('sha256').update(JSON.stringify([src, st.size, st.mtimeMs, W, H, cr, r, ellipse, bg, kant, ut, sk, 5])).digest('hex').slice(0, 24);
  const dir = path.join(deps.app.getPath('userData'), 'presentasjon-cache');
  const out = path.join(dir, key + '-klipp.mp4');
  if (fs.existsSync(out)) return { ok: true, path: out, cached: true };
  fs.mkdirSync(dir, { recursive: true });
  let sharp; try { sharp = require('sharp'); } catch (x) { return { ok: false, error: 'sharp mangler' }; }
  const mask = out + '.hjorner.png', tmp = out + '.tmp.mp4';
  // laget som legges over klippet: bakgrunnsfarge (med skygge) rundt et hull i feltets form, og kanten innerst i hullet
  const hole = holePath(W, H, r, ellipse), outer = K ? holePath(W + 2 * K, H + 2 * K, r ? r + K : 0, ellipse) : hole, O = P - K;   // ytre form: klippet + kanten, med radius r + K
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}"><defs>
    <mask id="ute"><rect width="${TW}" height="${TH}" fill="#fff"/><path transform="translate(${P} ${P})" d="${hole}" fill="#000"/></mask>
    <clipPath id="inne"><path transform="translate(${P} ${P})" d="${hole}"/></clipPath>
    ${sk ? `<filter id="sk" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sk.blur / 2}"/></filter>` : ''}</defs>
    <g mask="url(#ute)"><rect width="${TW}" height="${TH}" fill="${bg}"/>${sk ? `<path transform="translate(${O} ${O + sk.y})" d="${outer}" fill="#000" fill-opacity="${sk.alpha}" filter="url(#sk)"/>` : ''}${K ? `<path transform="translate(${O} ${O})" d="${outer}" fill="#fff"/>` : ''}</g>
    ${kant && !ut ? `<g clip-path="url(#inne)"><path transform="translate(${P} ${P})" d="${hole}" fill="none" stroke="#fff" stroke-width="${kant * 2}"/></g>` : ''}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(mask);
  progress(e, 'Tilpasser klipp …', 0);
  const [cx, cy, cw, ch] = cr;
  const res = await run(deps.findFfmpeg(), ['-v', 'error', '-y', '-i', src, '-i', mask, '-filter_complex',
    // hjørnene legges på i RGB og merkes BT.709, så fargen blir den samme som lysbildets bakgrunn i Keynote
    `[0:v]crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}:flags=lanczos,setsar=1,format=gbrp${P ? `,pad=${TW}:${TH}:${P}:${P}:color=${bg}` : ''}[v];[1:v]format=gbrap[m];[v][m]overlay=0:0:format=gbrp,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[o]`,
    '-map', '[o]', '-map', '0:a?', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4', tmp]);
  try { fs.unlinkSync(mask); } catch (x) {}
  if (!res.ok || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (x) {} return { ok: false, error: res.error || 'ffmpeg feilet' }; }
  fs.renameSync(tmp, out);
  return { ok: true, path: out };
}

// Installerer fonter som pluginen har med seg (bare fritt lisensierte, som Newsreader) i ~/Library/Fonts.
// Godtar bare .ttf/.otf med riktig filsignatur, inntil 5 MB, og overskriver aldri en fil som finnes.
function installFonts(e, o) {
  const files = Array.isArray(o && o.files) ? o.files.slice(0, 8) : [];
  if (!files.length) return { ok: false, error: 'Ingen fonter' };
  const dir = path.join(require('os').homedir(), 'Library', 'Fonts'), installed = [];
  try { fs.mkdirSync(dir, { recursive: true }); } catch (x) { return { ok: false, error: x.message }; }
  for (const f of files) {
    const name = String(f && f.name || '');
    if (!/^[\w .-]{1,80}\.(ttf|otf)$/i.test(name)) return { ok: false, error: 'Ugyldig filnavn: ' + name };
    const buf = Buffer.from(String(f.data || ''), 'base64');
    const sig = buf.slice(0, 4).toString('hex');
    if (buf.length < 1000 || buf.length > 5e6 || !['00010000', '4f54544f', '74727565'].includes(sig)) return { ok: false, error: 'Ikke en font: ' + name };
    const target = path.join(dir, name);
    if (fs.existsSync(target)) continue;
    try { fs.writeFileSync(target, buf); installed.push(name); } catch (x) { return { ok: false, error: x.message }; }
  }
  return { ok: true, installed };
}

// ---- lisensierte fonter (Haas Grot Text) fra Faktisks fontmappe ----
// Fontene ligger i en mappe som bare lisensierte brukere har tilgang til (en egen delt disk på Google Drive).
// Studio leter etter en mappe som heter «Fonter» på de delte diskene, eller bruker mappa brukeren har valgt.
// Tilgangen til mappa er lisenskontrollen: Studio installerer bare det brukeren allerede har lov til å lese.
const LISENS_FONT = /^(NeueHaasGroteskText|HaasGrotText)[\w-]*\.(otf|ttf)$/i;
const fontCfg = () => path.join(deps.app.getPath('userData'), 'presentasjon-fonter.json');
function fontFilesIn(dir) { try { return fs.readdirSync(dir).filter((n) => LISENS_FONT.test(n)); } catch (x) { return []; } }
function findFontDir() {
  try { const d = JSON.parse(fs.readFileSync(fontCfg(), 'utf-8')).dir; if (d && fontFilesIn(d).length) return d; } catch (x) {}
  const cloud = path.join(os.homedir(), 'Library', 'CloudStorage');
  let roots = []; try { roots = fs.readdirSync(cloud).filter((n) => /^GoogleDrive/i.test(n)).map((n) => path.join(cloud, n)); } catch (x) {}
  for (const r of roots) for (const sd of ['Delte disker', 'Shared drives']) {
    let drives = []; try { drives = fs.readdirSync(path.join(r, sd)); } catch (x) { continue; }
    for (const dname of drives) {
      const base = path.join(r, sd, dname);
      for (const cand of [base, path.join(base, 'Fonter'), path.join(base, 'Fonter', 'Haas Grot Text')]) if (fontFilesIn(cand).length && (cand !== base || /font/i.test(dname))) return cand;
    }
  }
  return null;
}
function fontsFind() { const dir = findFontDir(); return dir ? { ok: true, dir, files: fontFilesIn(dir) } : { ok: false }; }
async function fontsChoose() {
  const r = await deps.dialog.showOpenDialog({ title: 'Velg mappa med Haas Grot Text', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const dir = r.filePaths[0], files = fontFilesIn(dir);
  if (!files.length) return { ok: false, error: 'Fant ingen Haas Grot Text-filer i mappa' };
  try { fs.writeFileSync(fontCfg(), JSON.stringify({ dir })); } catch (x) {}
  return { ok: true, dir, files };
}
function fontsInstallFrom() {
  const dir = findFontDir(); if (!dir) return { ok: false, error: 'Fant ikke fontmappa' };
  const target = path.join(os.homedir(), 'Library', 'Fonts'), installed = [];
  try { fs.mkdirSync(target, { recursive: true }); } catch (x) { return { ok: false, error: x.message }; }
  for (const n of fontFilesIn(dir)) {
    const to = path.join(target, n); if (fs.existsSync(to)) continue;
    let buf; try { buf = fs.readFileSync(path.join(dir, n)); } catch (x) { return { ok: false, error: 'Kunne ikke lese ' + n + ' (er den lastet ned fra Drive?)' }; }
    if (!['00010000', '4f54544f', '74727565'].includes(buf.slice(0, 4).toString('hex'))) return { ok: false, error: 'Ikke en font: ' + n };
    try { fs.writeFileSync(to, buf); installed.push(n); } catch (x) { return { ok: false, error: x.message }; }
  }
  return { ok: true, installed };
}

function nextName(dir, title, ext) {
  const safe = (title || 'Presentasjon').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Presentasjon';
  for (let n = 1; n < 1000; n++) { const p = path.join(dir, `${safe} v${n}${ext}`); if (!fs.existsSync(p)) return p; }
  return path.join(dir, `${safe} ${Date.now()}${ext}`);
}

const SCRIPT = `on run argv
  set src to POSIX file (item 1 of argv)
  set dst to POSIX file (item 2 of argv)
  tell application "Keynote"
    activate
    set d to open src
    delay 0.5
    save d in dst
  end tell
end run`;

// «Lag Keynote»: lagre .pptx i Eksport/. Med saveAsKey prøver Studio å la Keynote lagre den
// som .key (AppleScript) i maks 20 s; svarer ikke Keynote (importvarsel, tillatelse som ikke er
// gitt ennå), åpnes .pptx-fila i Keynote og brukeren lagrer med ⌘S. I 0.8.1 ventet Studio i
// 3 minutter og knappen ble stående på «Åpner i Keynote».
async function keynote(e, o) {
  const bytes = o && o.bytes;
  if (!bytes || !bytes.length) return { ok: false, error: 'Ingen fil å lagre' };
  const asKey = !!o.saveAsKey;
  let target;
  const folder = toPath(o.folder);
  if (folder && fs.existsSync(folder)) {
    const dir = path.join(folder, 'Eksport'); fs.mkdirSync(dir, { recursive: true });
    target = nextName(dir, o.title, '.pptx');
  } else {
    const res = await deps.dialog.showSaveDialog({ title: 'Lagre presentasjonen', defaultPath: path.join(deps.app.getPath('documents'), (o.title || 'Presentasjon') + '.pptx'),
      filters: [{ name: 'Presentasjon (åpnes i Keynote)', extensions: ['pptx'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    target = res.filePath.endsWith('.pptx') ? res.filePath : res.filePath + '.pptx';
  }
  fs.writeFileSync(target, Buffer.from(bytes));
  if (asKey) {
    progress(e, 'Lagrer som Keynote-fil …');
    const key = target.replace(/\.pptx$/, '.key');
    const err = await new Promise((resolve) => execFile('osascript', ['-e', SCRIPT, target, key], { timeout: 20000 }, (x, so, se) => resolve(x ? (se || x.message) : null)));
    if (!err && fs.existsSync(key)) { try { fs.unlinkSync(target); } catch (x) {} return { ok: true, path: key, key: true }; }
    // Keynote svarte ikke (importvarsel, tillatelse): fila er åpnet, brukeren lagrer selv
  }
  execFile('open', ['-a', 'Keynote', target], () => {});
  return { ok: true, path: target, opened: true };
}

function register(ipcMain, d) {
  deps = d;
  ipcMain.handle('presentation-read-file', (e, p) => readFile(e, p));
  ipcMain.handle('presentation-waveform', (e, o) => waveform(e, o));
  ipcMain.handle('presentation-fit-video', (e, o) => fitVideo(e, o));
  ipcMain.handle('presentation-fonts-install', (e, o) => installFonts(e, o));
  ipcMain.handle('presentation-fonts-find', () => fontsFind());
  ipcMain.handle('presentation-fonts-choose', () => fontsChoose());
  ipcMain.handle('presentation-fonts-install-from', () => fontsInstallFrom());
  ipcMain.handle('presentation-keynote', (e, o) => keynote(e, o));
}

module.exports = { register, _test: { toPath, fmt, nextName, waveform, fitVideo, setDeps: (x) => { deps = x; } } };
