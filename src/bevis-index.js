// Faktisk Studio · Bevissikring — import og søk
//
//   Import   skjermbilder og skjermopptak (mobil eller Mac) legges inn i en
//            sak som en egen sikring (kind 'import'): filene kopieres urørt
//            til import/, opptakstid og filinfo noteres, og sikringen får
//            manifest, sjekksummer og tidsstempel som alt annet.
//   Indeks   per sikring i <sak>/_indeks/<mappe>.json — UTENFOR sikringsmappa,
//            så sjekksummene ikke berøres. Inneholder:
//              meta   tittel, adresse, notat, konto, opplaster …
//              tekst  tekst.txt (sidens tekst)
//              info   beskrivelse og kommentarer fra yt-dlp (info.json)
//              ocr    tekst lest i bilder og nøkkelbilder fra video
//                     (Apple Vision, gjenbrukt fra Skjermarkiv)
//              tale   transkripsjon av lyd (Studios whisper, via pluginen)
//   Søk      alle ord må finnes; treff med utdrag og tidskode.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

let H = null, SK = null, deps = null;

const IMG_RE = /\.(png|jpe?g|heic|heif|webp|gif|tiff?|bmp)$/i;
const VID_RE = /\.(mov|mp4|m4v|webm|mkv|avi|3gp)$/i;
const AUD_RE = /\.(m4a|mp3|wav|aac|ogg|opus|flac)$/i;
const TEXT_CAP = 3000000;

const pad2 = n => String(n).padStart(2, '0');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const indexDir = dir => path.join(path.dirname(dir), '_indeks');
const indexPath = dir => path.join(indexDir(dir), path.basename(dir) + '.json');
const ffmpeg = () => (deps && deps.findFfmpeg ? deps.findFfmpeg() : null);
const tmpRoot = () => app.getPath('temp');

function writeIndex(dir, idx) {
  fs.mkdirSync(indexDir(dir), { recursive: true });
  const f = indexPath(dir), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(idx));
  fs.renameSync(tmp, f);
}

async function mdlsDates(file) {
  if (process.platform !== 'darwin') return {};
  const r = await H.run('/usr/bin/mdls', ['-name', 'kMDItemContentCreationDate', '-name', 'kMDItemAcquisitionMake', '-name', 'kMDItemAcquisitionModel', '-name', 'kMDItemWhereFroms', file], { timeoutMs: 8000 });
  const s = String(r.stdout || '');
  const d = s.match(/kMDItemContentCreationDate\s*=\s*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})/);
  const make = (s.match(/kMDItemAcquisitionMake\s*=\s*"([^"]*)"/) || [])[1] || '';
  const model = (s.match(/kMDItemAcquisitionModel\s*=\s*"([^"]*)"/) || [])[1] || '';
  const from = (s.match(/kMDItemWhereFroms\s*=\s*\(\s*"([^"]*)"/) || [])[1] || '';
  let created = null;
  if (d) { const x = new Date(d[1] + 'T' + d[2] + d[3].slice(0, 3) + ':' + d[3].slice(3)); if (!isNaN(x)) created = x.toISOString(); }
  return { created, device: [make, model].filter(Boolean).join(' '), whereFrom: from };
}

// Opptakstid fra filnavnet («Skjermbilde 2026-10-24 kl. 14.03.11», «IMG_20261024_140311», «Screenshot_20261024-140311» …)
function nameDate(name) {
  const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[ _T-]*(?:kl\.?\s*|at\s*)?(\d{2})[.:_-]?(\d{2})[.:_-]?(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return isNaN(d) || +m[2] > 12 ? null : d.toISOString();
}

// ------------------------------------------------------------
//  Import
// ------------------------------------------------------------
async function doImport(e, o) {
  const root = String(o.root || ''), caseName = String(o.caseName || '').trim();
  if (!root || !fs.existsSync(root)) throw new Error(root ? 'Arkivmappa er ikke tilgjengelig (låst kryptert arkiv?)' : 'Velg arkivmappe først');
  if (!caseName) throw new Error('Skriv inn en sak først');
  const paths = (Array.isArray(o.paths) ? o.paths : []).map(String).filter(p => p && fs.existsSync(p) && fs.statSync(p).isFile());
  if (!paths.length) throw new Error('Ingen filer å importere');
  const bad = paths.filter(p => !(IMG_RE.test(p) || VID_RE.test(p) || AUD_RE.test(p)));
  if (bad.length) throw new Error('Kan bare importere bilder, video og lyd: ' + bad.map(p => path.basename(p)).slice(0, 3).join(', '));
  const progress = msg => { try { if (e && e.sender) e.sender.send('bevis-progress', { msg }); } catch (err) {} };
  const url = H.normalizeUrl(o.url || '') || '';
  const when = new Date();
  let dir, platform = 'import', handle = '';
  if (/^https?:/.test(url)) {
    ({ dir, platform, handle } = H.captureFolder(root, caseName, url, when, 'import'));
  } else {
    const stamp = when.getFullYear() + '-' + pad2(when.getMonth() + 1) + '-' + pad2(when.getDate()) + '_' + pad2(when.getHours()) + pad2(when.getMinutes()) + pad2(when.getSeconds());
    const caseDir = path.join(root, H.safeName(caseName) || 'Uten sak');
    const base = [stamp, 'import', H.slug(path.parse(paths[0]).name, 40)].filter(Boolean).join('_');
    dir = path.join(caseDir, base); let i = 2;
    while (fs.existsSync(dir)) dir = path.join(caseDir, base + '-' + i++);
    fs.mkdirSync(dir, { recursive: true });
  }
  const idir = path.join(dir, 'import');
  fs.mkdirSync(idir, { recursive: true });
  const files = [];
  const used = new Set();
  for (let k = 0; k < paths.length; k++) {
    const src = paths[k];
    progress('Importerer ' + (k + 1) + ' av ' + paths.length + ': ' + path.basename(src));
    let name = path.basename(src).replace(/[\/:]/g, '_');
    const p = path.parse(name); let n = 2;
    while (used.has(name.toLowerCase())) name = p.name + '-' + n++ + p.ext;
    used.add(name.toLowerCase());
    const dst = path.join(idir, name);
    const st = fs.statSync(src);
    fs.copyFileSync(src, dst);
    const hSrc = await H.sha256File(src), hDst = await H.sha256File(dst);
    if (hSrc !== hDst) throw new Error('Kopien av ' + name + ' ble ikke lik originalen');
    const md = await mdlsDates(src);
    let created = md.created, createdSource = created ? 'filens metadata (Spotlight)' : '';
    if (VID_RE.test(src) && ffmpeg()) {
      try { const pv = await SK.probeVideo(ffmpeg(), src); if (pv.created) { created = pv.created; createdSource = 'videoens metadata (creation_time)'; } } catch (err) {}
    }
    const nd = nameDate(name);
    if (!created && nd) { created = nd; createdSource = 'filnavnet'; }
    files.push({
      path: 'import/' + name, originalName: path.basename(src), originalPath: src, bytes: st.size, sha256: hSrc,
      fileModified: st.mtime.toISOString(), fileCreated: st.birthtime ? st.birthtime.toISOString() : null,
      recorded: created || null, recordedSource: createdSource || 'ukjent', nameDate: nd,
      device: md.device || '', whereFrom: md.whereFrom || '',
    });
  }
  const title = String(o.title || '').trim() || (files.length === 1 ? files[0].originalName : files.length + ' importerte filer');
  const info = { url, title, canonical: '', lang: '', meta: {}, userAgent: '', viewport: null };
  const manifest = H.baseManifest({ kind: 'import', caseName, note: o.note || '', url, info, when, platform: url ? platform : 'import', handle, appVersion: app.getVersion() });
  manifest.tool.pluginVersion = o.pluginVersion || null;
  manifest.source.capturedIn = String(o.source || '').slice(0, 80) || 'importert fil';
  manifest.import = { files, importedFrom: [...new Set(paths.map(p => path.dirname(p)))] };
  manifest.warnings = [
    'Importert: filene er tatt utenfor Studio. Sjekksummer og tidsstempel viser når de ble importert — opptakstiden kommer fra filens metadata eller filnavn og kan ikke bekreftes.',
  ];
  if (files.some(f => !f.recorded)) manifest.warnings.push('Fant ikke opptakstid for ' + files.filter(f => !f.recorded).map(f => f.originalName).join(', ') + '.');
  // Miniatyr fra første bilde/video
  try {
    const first = files.find(f => IMG_RE.test(f.path) || VID_RE.test(f.path));
    if (first && ffmpeg()) {
      const a = await SK.analyze(ffmpeg(), tmpRoot(), { absPath: path.join(dir, first.path), ocr: false, maxFrames: 1 });
      if (a.ok && a.thumb) fs.writeFileSync(path.join(dir, '.studio-miniatyr.jpg'), Buffer.from(a.thumb.split(',')[1], 'base64'));
    }
  } catch (err) {}
  manifest.completedAt = new Date().toISOString();
  const fin = await H.finalize(dir, manifest);
  return { ok: true, dir, fingerprint: fin.fingerprint, fileCount: fin.fileCount, bytes: fin.bytes, warnings: manifest.warnings, title, stamp: fin.stamp };
}

// ------------------------------------------------------------
//  Indeks
// ------------------------------------------------------------
function fileShaMap(m) { const o = {}; for (const f of m.files || []) o[f.path] = f.sha256; return o; }

async function buildIndex(e, dir, opts) {
  const m = H.readManifest(dir);
  if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
  const progress = msg => { try { if (e && e.sender) e.sender.send('bevis-progress', { msg }); } catch (err) {} };
  const old = readJson(indexPath(dir)) || {};
  const shas = fileShaMap(m);
  const src = m.source || {};
  const parts = [];
  const add = (srcName, text, extra) => { text = String(text || '').trim(); if (text) parts.push(Object.assign({ src: srcName, text: text.slice(0, TEXT_CAP) }, extra || {})); };

  add('meta', [src.title, src.finalUrl, src.requestedUrl !== src.finalUrl ? src.requestedUrl : '', m.note, m.case, src.platform, src.handle,
    m.capturedByName, m.loginAccount, m.tag && m.tag.detail, m.media && m.media.info && m.media.info.uploader,
    ...(m.import ? m.import.files.map(f => f.originalName + (f.device ? ' ' + f.device : '')) : [])].filter(Boolean).join('\n'));
  if (shas['tekst.txt']) { try { add('tekst', fs.readFileSync(path.join(dir, 'tekst.txt'), 'utf8'), { file: 'tekst.txt' }); } catch (err) {} }
  for (const rel of Object.keys(shas).filter(r => /^media\/.+\.info\.json$/.test(r))) {
    const j = readJson(path.join(dir, rel)); if (!j) continue;
    add('info', [j.title, j.uploader, j.channel, j.description, (j.tags || []).join(' ')].filter(Boolean).join('\n'), { file: rel });
    if (Array.isArray(j.comments) && j.comments.length) add('kommentarer', j.comments.slice(0, 5000).map(c => (c.author || '') + ': ' + (c.text || '')).join('\n'), { file: rel });
  }
  for (const rel of Object.keys(shas).filter(r => /^media\/.+\.(live_chat|comments)\.json$/.test(r))) {
    try { add('kommentarer', fs.readFileSync(path.join(dir, rel), 'utf8').slice(0, 500000), { file: rel }); } catch (err) {}
  }

  // Tekst i bilder og video (OCR) — importerte filer, video fra media/, utsnitt
  const ocrTargets = Object.keys(shas).filter(r =>
    (/^import\//.test(r) && (IMG_RE.test(r) || VID_RE.test(r))) || (/^media\//.test(r) && VID_RE.test(r)) || r === 'utsnitt.png' || r === 'skjermbilde-chrome.png');
  const ocrDone = {}, previews = {}, avInfo = {};
  const oldOcr = (old.parts || []).filter(p => p.src === 'ocr');
  for (const rel of ocrTargets) {
    if (old.ocrDone && old.ocrDone[rel] === shas[rel]) {
      oldOcr.filter(p => p.file === rel).forEach(p => parts.push(p));
      ocrDone[rel] = shas[rel];
      if (old.previews && old.previews[rel]) previews[rel] = old.previews[rel];
      if (old.avInfo && old.avInfo[rel]) avInfo[rel] = old.avInfo[rel];
      continue;
    }
    if (opts.ocr === false || !ffmpeg()) continue;
    progress('Leser tekst i ' + path.basename(rel) + ' …');
    const a = await SK.analyze(ffmpeg(), tmpRoot(), { absPath: path.join(dir, rel), ocr: true, maxFrames: 12 });
    if (!a.ok) { ocrDone[rel] = shas[rel]; continue; }
    if (a.kind === 'image') { add('ocr', a.text, { file: rel }); if (/\.(heic|heif|tiff?|bmp)$/i.test(rel) && a.thumb) previews[rel] = a.thumb; }
    else {
      (a.frames || []).forEach(fr => add('ocr', fr.text, { file: rel, t: fr.t }));
      avInfo[rel] = { duration: a.duration, hasAudio: !!a.hasAudio };
    }
    if (a.ocrInfo && a.ocrInfo.error) { /* OCR utilgjengelig: ikke merk som ferdig, så det prøves igjen */ }
    else ocrDone[rel] = shas[rel];
  }

  // Tale beholdes fra forrige indeks hvis fila er uendret
  const speech = {};
  for (const [rel, s] of Object.entries(old.speech || {})) if (shas[rel] && s.sha === shas[rel]) speech[rel] = s;
  (old.parts || []).filter(p => p.src === 'tale' && speech[p.file]).forEach(p => parts.push(p));

  // Hva mangler tale? Lyd/video med lydspor
  const speechTodo = [];
  for (const rel of Object.keys(shas).filter(r => (/^(import|media)\//.test(r)) && (VID_RE.test(r) || AUD_RE.test(r)))) {
    if (speech[rel]) continue;
    let hasAudio = AUD_RE.test(rel) ? true : (avInfo[rel] ? avInfo[rel].hasAudio : null);
    if (hasAudio == null && ffmpeg()) { try { hasAudio = (await SK.probeVideo(ffmpeg(), path.join(dir, rel))).hasAudio; } catch (err) { hasAudio = false; } }
    if (hasAudio) speechTodo.push({ rel, path: path.join(dir, rel) });
  }

  const sumsSha = (() => { try { return sha256(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'))); } catch (err) { return ''; } })();
  const idx = {
    format: 'faktisk-bevis-indeks', version: 1, folder: path.basename(dir), case: m.case, kind: m.kind,
    title: src.title || '', url: src.finalUrl || src.requestedUrl || '', capturedAt: m.capturedAt,
    indexedAt: new Date().toISOString(), sumsSha, ocrDone, previews, avInfo, speech, parts,
  };
  writeIndex(dir, idx);
  return { ok: true, parts: parts.length, ocrPending: ocrTargets.filter(r => !ocrDone[r]).length, speechTodo };
}

function addSpeech(dir, o) {
  const m = H.readManifest(dir);
  if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
  const rel = String(o.rel || '');
  const sha = fileShaMap(m)[rel];
  if (!sha) throw new Error('Fila er ikke en del av sikringen');
  const idx = readJson(indexPath(dir)) || { format: 'faktisk-bevis-indeks', version: 1, parts: [], speech: {} };
  idx.parts = (idx.parts || []).filter(p => !(p.src === 'tale' && p.file === rel));
  const segs = Array.isArray(o.segments) ? o.segments : [];
  for (const s of segs) {
    const text = String(s && s.text || '').replace(/\s+/g, ' ').trim();
    if (text) idx.parts.push({ src: 'tale', file: rel, t: +s.start || 0, end: +s.end || 0, text });
  }
  idx.speech = idx.speech || {};
  idx.speech[rel] = { sha, at: new Date().toISOString(), language: o.language || '', model: o.model || '', segments: segs.length };
  writeIndex(dir, idx);
  return { ok: true, segments: segs.length };
}

// ------------------------------------------------------------
//  Søk
// ------------------------------------------------------------
function caseDirs(root, caseName) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !/^[._]/.test(d.name)).map(d => d.name); } catch (e) {}
  if (caseName) names = names.filter(n => n === caseName);
  return names.map(n => path.join(root, n));
}

function snippet(text, words) {
  const low = text.toLowerCase();
  let pos = -1;
  for (const w of words) { const p = low.indexOf(w); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  if (pos < 0) return '';
  const a = Math.max(0, pos - 70), b = Math.min(text.length, pos + 110);
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
}

function search(root, caseName, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(w => w.length >= 2).slice(0, 8);
  const hits = {};
  let indexed = 0, total = 0;
  if (!words.length) return { ok: true, hits, indexed, total };
  for (const cdir of caseDirs(root, caseName)) {
    let ents = [];
    try { ents = fs.readdirSync(cdir, { withFileTypes: true }).filter(d => d.isDirectory() && !/^[._]/.test(d.name)); } catch (e) {}
    for (const ent of ents) {
      const dir = path.join(cdir, ent.name);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      total++;
      const idx = readJson(indexPath(dir));
      if (!idx) continue;
      indexed++;
      const all = (idx.parts || []).map(p => p.text).join('\n').toLowerCase();
      if (!words.every(w => all.includes(w))) continue;
      const found = [];
      for (const p of idx.parts || []) {
        const lt = p.text.toLowerCase();
        if (!words.some(w => lt.includes(w))) continue;
        found.push({ src: p.src, file: p.file || '', t: p.t, snip: snippet(p.text, words), score: words.filter(w => lt.includes(w)).length });
      }
      found.sort((a, b) => b.score - a.score);
      hits[dir] = found.slice(0, 4).map(({ score, ...rest }) => rest);
    }
  }
  return { ok: true, hits, indexed, total };
}

function indexStatus(root, caseName) {
  const todo = [];
  let total = 0;
  for (const cdir of caseDirs(root, caseName)) {
    let ents = [];
    try { ents = fs.readdirSync(cdir, { withFileTypes: true }).filter(d => d.isDirectory() && !/^[._]/.test(d.name)); } catch (e) {}
    for (const ent of ents) {
      const dir = path.join(cdir, ent.name);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      total++;
      const idx = readJson(indexPath(dir));
      let sums = '';
      try { sums = sha256(fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'))); } catch (e) {}
      if (!idx || idx.sumsSha !== sums) todo.push(dir);
    }
  }
  return { ok: true, total, todo };
}

function readIndex(dir) { return readJson(indexPath(dir)); }

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain, d) {
  deps = d;
  H = require('./bevis-main.js')._internal;
  SK = require('./skjermarkiv-main.js');
  ipcMain.handle('bevis-import', async (e, o) => { try { return await doImport(e, o || {}); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('bevis-index-build', async (e, o) => { try { return await buildIndex(e, String(o && o.dir || ''), o || {}); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('bevis-index-speech', (e, o) => { try { return addSpeech(String(o && o.dir || ''), o || {}); } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('bevis-index-status', (e, o) => { try { return indexStatus(String(o && o.root || ''), o && o.caseName); } catch (err) { return { ok: false, error: err.message, total: 0, todo: [] }; } });
  ipcMain.handle('bevis-search', (e, o) => { try { return search(String(o && o.root || ''), o && o.caseName, o && o.q); } catch (err) { return { ok: false, error: err.message, hits: {} }; } });
}

module.exports = { register, readIndex, indexPath, _test: { nameDate, search, buildIndex, addSpeech, doImport, indexStatus, snippet } };
