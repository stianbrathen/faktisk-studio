// Faktisk Studio · Skjermarkiv — hovedprosess-delen
//
// Gjør det tunge arbeidet for skjermarkiv-pluginen, alt lokalt:
//   skjermarkiv-scan      mappe → liste over bilder og klipp (rekursivt)
//   skjermarkiv-analyze   én fil → mål, dato, miniatyr, nøkkelbilder, OCR
//   skjermarkiv-preview   stort forhåndsbilde (HEIC o.l. som Chromium ikke viser)
//   skjermarkiv-archive-* lagre/åpne/liste arkiver i userData/skjermarkiv
//   skjermarkiv-read-json les en .json-arkivfil valgt av brukeren
//
// Tekstlesing (OCR) bruker Apples Vision-rammeverk via osascript (JXA) —
// finnes på alle Macer, ingen nedlasting og ingenting forlater maskinen.
// Nøkkelbilder: ffmpeg tar ut små gråtonebilder (2 per sekund), forskjellen
// mellom dem måles her, og scenebytter velges som snitt + 1,2 standardavvik
// (samme regel som nettsiden).
//
// Husk (Studio-lærdom): stdout fra ALLE spawn-kall må leses, ellers fylles
// 64 KB-røret og prosessen henger.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'tif', 'tiff', 'bmp']);
const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'webm', 'mkv', 'avi', '3gp']);
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', heic: 'image/heic', heif: 'image/heif',
  webp: 'image/webp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp',
};

function run(cmd, args, { timeoutMs = 120000, binary = false } = {}) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args); } catch (err) { return resolve({ code: -1, stdout: '', stderr: err.message }); }
    const out = [];
    let stderr = '';
    p.stdout.on('data', c => out.push(c));               // MÅ leses
    p.stderr.on('data', c => { stderr += c.toString(); if (stderr.length > 200000) stderr = stderr.slice(-100000); });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, timeoutMs);
    p.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout: binary ? Buffer.alloc(0) : '', stderr: err.message }); });
    p.on('close', code => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      resolve({ code, stdout: binary ? buf : buf.toString('utf8'), stderr });
    });
  });
}

// ------------------------------------------------------------
//  Skann mappe
// ------------------------------------------------------------
function scanFolder(root, limit = 5000) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 12 || files.length >= limit) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (/\.(app|photoslibrary|fcpbundle|lrlibrary)$/i.test(ent.name)) continue;
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).slice(1).toLowerCase();
        const kind = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : null;
        if (!kind) continue;
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        files.push({
          absPath: full,
          path: path.relative(root, full).split(path.sep).join('/'),
          name: ent.name, ext, kind, mime: MIME[ext] || '',
          size: st.size, lastModified: Math.round(st.mtimeMs),
          birthtime: Math.round(st.birthtimeMs || st.mtimeMs),
        });
        if (files.length >= limit) return;
      }
    }
  };
  walk(root, 0);
  return files;
}

// ------------------------------------------------------------
//  Metadata
// ------------------------------------------------------------
async function mdlsDate(file) {
  if (process.platform !== 'darwin') return null;
  const r = await run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemContentCreationDate', file], { timeoutMs: 8000 });
  const m = String(r.stdout).match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})/);
  if (!m) return null;
  const d = new Date(m[1] + 'T' + m[2] + m[3].slice(0, 3) + ':' + m[3].slice(3));
  return isNaN(d) ? null : d.toISOString();
}

async function probeVideo(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 30000 });
  const s = r.stderr;
  const vm = s.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!vm) throw new Error('Fant ikke videospor (kodek støttes kanskje ikke)');
  let width = +vm[1], height = +vm[2];
  // Mobilopptak lagres ofte liggende med rotasjonsflagg — vis som stående
  if (/rotation of -?(90|270)\.00 degrees|rotate\s*:\s*(90|270)/.test(s)) [width, height] = [height, width];
  const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const cm = s.match(/creation_time\s*:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
  return {
    width, height,
    duration: dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0,
    hasAudio: /Stream #.*Audio:/.test(s),
    created: cm && !/^1970|^1904/.test(cm[1]) ? new Date(cm[1]).toISOString() : null,
  };
}

async function imageSize(file) {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { timeoutMs: 15000 });
    const w = String(r.stdout).match(/pixelWidth:\s*(\d+)/), h = String(r.stdout).match(/pixelHeight:\s*(\d+)/);
    if (w && h) return { width: +w[1], height: +h[1] };
  }
  return null;
}

// Liten JPEG (lengste side `max`) som data-URI. sips leser HEIC; ffmpeg er reserve.
async function jpegThumb(ffmpeg, file, max, tmpDir, tag) {
  const out = path.join(tmpDir, tag + '.jpg');
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-Z', String(max), file, '--out', out], { timeoutMs: 30000 });
    if (r.code === 0 && fs.existsSync(out)) return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
  }
  const scale = `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`;
  const r = await run(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', scale, '-q:v', '4', '-y', out], { timeoutMs: 30000 });
  if (r.code === 0 && fs.existsSync(out)) return 'data:image/jpeg;base64,' + fs.readFileSync(out).toString('base64');
  return '';
}

// ------------------------------------------------------------
//  Nøkkelbilder
// ------------------------------------------------------------
const SW = 64, SH = 36;  // størrelse på gråtoneprøvene for scenemåling

async function sampleDiffs(ffmpeg, file, duration) {
  const fps = Math.max(0.2, Math.min(2, 600 / Math.max(1, duration)));
  const r = await run(ffmpeg, ['-v', 'error', '-i', file, '-an',
    '-vf', `fps=${fps.toFixed(3)},scale=${SW}:${SH},format=gray`, '-f', 'rawvideo', '-'],
  { timeoutMs: Math.max(60000, duration * 3000), binary: true });
  const buf = r.stdout;
  const n = Math.floor(buf.length / (SW * SH));
  const diffs = [0];
  for (let i = 1; i < n; i++) {
    let s = 0;
    const a = (i - 1) * SW * SH, b = i * SW * SH;
    for (let k = 0; k < SW * SH; k++) s += Math.abs(buf[a + k] - buf[b + k]);
    diffs.push(s / (SW * SH));
  }
  return { fps, diffs };
}

function chooseKeyframes(duration, fps, diffs, maxFrames = 16) {
  const n = diffs.length;
  if (!n || duration <= 0) return [{ t: 0, scene: false }];
  const minF = Math.max(1, Math.min(8, Math.ceil(duration * 2)));
  const maxF = Math.max(minF, Math.min(maxFrames, Math.ceil(duration * 2)));
  const vals = diffs.slice(1);
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length));
  // Snitt + 1,2 sd (som nettsiden) — men ett stort bytte blåser opp sd og
  // skjuler de mindre. Robust alternativ: median + 4·MAD (min. 6). Den
  // laveste av de to vinner, så tydelige bytter alltid kommer med.
  const sorted = vals.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const mad = (vals.map(v => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(vals.length / 2)]) || 0;
  const thr = Math.min(mean + 1.2 * sd, Math.max(6, med + 4 * mad));
  const picked = [{ t: 0, scene: false }];
  const minGap = Math.min(1.0, duration / maxF);
  const cand = [];
  for (let i = 1; i < n; i++) if (diffs[i] > thr && diffs[i] > 2) cand.push({ t: i / fps, d: diffs[i] });
  cand.sort((a, b) => b.d - a.d);
  for (const c of cand) {
    if (picked.length >= maxF) break;
    if (picked.every(p => Math.abs(p.t - c.t) >= minGap)) picked.push({ t: c.t, scene: true });
  }
  // Fyll jevnt ut til minst minF bilder
  if (picked.length < minF) {
    const step = duration / minF;
    for (let k = 0; k < minF && picked.length < minF; k++) {
      const t = Math.min(duration - 0.05, k * step + step / 2);
      if (picked.every(p => Math.abs(p.t - t) >= step / 2.5)) picked.push({ t, scene: false });
    }
  }
  return picked.sort((a, b) => a.t - b.t).map(p => ({ t: Math.round(Math.max(0, Math.min(duration - 0.04, p.t)) * 100) / 100, scene: p.scene }));
}

async function extractFrame(ffmpeg, file, t, fullOut, smallOut, small) {
  const scale = `scale='if(gt(iw,ih),min(${small},iw),-2)':'if(gt(iw,ih),-2,min(${small},ih))'`;
  const r = await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file,
    '-map', '0:v:0', '-frames:v', '1', '-q:v', '2', '-y', fullOut,
    '-map', '0:v:0', '-frames:v', '1', '-vf', scale, '-q:v', '5', '-y', smallOut], { timeoutMs: 45000 });
  return r.code === 0 && fs.existsSync(fullOut) && fs.existsSync(smallOut);
}

// ------------------------------------------------------------
//  OCR med Apple Vision (osascript / JavaScript for Automation)
// ------------------------------------------------------------
const VISION_JXA = String.raw`
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  var want = ['nb-NO', 'no-NO', 'nn-NO', 'sv-SE', 'da-DK', 'en-US'];
  var langs = [], auto = false, supported = [];
  try {
    var probe = $.VNRecognizeTextRequest.alloc.init;
    probe.recognitionLevel = 0;
    supported = ObjC.deepUnwrap(probe.supportedRecognitionLanguagesAndReturnError(null)) || [];
    langs = want.filter(function (l) { return supported.indexOf(l) >= 0; });
  } catch (e) {}
  var results = [];
  for (var a = 0; a < argv.length; a++) {
    var r = { path: argv[a], lines: [] };
    try {
      var url = $.NSURL.fileURLWithPath(argv[a]);
      var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
      var req = $.VNRecognizeTextRequest.alloc.init;
      req.recognitionLevel = 0;            // 0 = accurate
      req.usesLanguageCorrection = true;
      if (langs.length) req.recognitionLanguages = $(langs);
      else if (req.respondsToSelector('setAutomaticallyDetectsLanguage:')) { req.automaticallyDetectsLanguage = true; auto = true; }
      handler.performRequestsError($([req]), null);
      var obs = req.results;
      var n = obs ? obs.count : 0;
      for (var i = 0; i < n; i++) {
        var o = obs.objectAtIndex(i);
        var top = o.topCandidates(1);
        if (!top.count) continue;
        var c = top.objectAtIndex(0);
        var line = { t: ObjC.unwrap(c.string), c: c.confidence };
        try { var bb = o.boundingBox; line.y = bb.origin.y; line.x = bb.origin.x; } catch (e) {}
        r.lines.push(line);
      }
    } catch (e) { r.error = String(e); }
    results.push(r);
  }
  return JSON.stringify({ langs: langs, auto: auto, results: results });
}
`;

let visionScriptPath = null;
function visionScript(tmpRoot) {
  if (visionScriptPath && fs.existsSync(visionScriptPath)) return visionScriptPath;
  visionScriptPath = path.join(tmpRoot, 'faktisk-skjermarkiv-vision.js');
  fs.writeFileSync(visionScriptPath, VISION_JXA, 'utf-8');
  return visionScriptPath;
}

// Linjer → tekst: ovenfra og ned, venstre mot høyre; usikre/tomme linjer bort
function linesToText(lines) {
  return (lines || [])
    .filter(l => l && l.t && (l.c == null || l.c >= 0.3) && (String(l.t).match(/[\p{L}\p{N}]/gu) || []).length >= 2)
    .sort((a, b) => (b.y == null || a.y == null) ? 0 : (Math.abs(b.y - a.y) > 0.01 ? b.y - a.y : (a.x || 0) - (b.x || 0)))
    .map(l => String(l.t).trim())
    .join('\n');
}

async function visionOcr(files, tmpRoot, probe) {
  if (process.platform !== 'darwin') return { ok: false, error: 'Tekstlesing krever macOS (Apple Vision)' };
  if (!files.length && !probe) return { ok: true, texts: [], langs: [] };
  const script = visionScript(tmpRoot);
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', script, ...files], { timeoutMs: 60000 + files.length * 15000 });
  if (r.code !== 0) return { ok: false, error: 'Vision feilet: ' + String(r.stderr).trim().split('\n').slice(-2).join(' ') };
  try {
    const j = JSON.parse(String(r.stdout).trim());
    const byPath = new Map(j.results.map(x => [x.path, x]));
    return {
      ok: true,
      langs: j.langs || [], auto: !!j.auto,
      texts: files.map(f => { const x = byPath.get(f); return x ? linesToText(x.lines) : ''; }),
      errors: j.results.filter(x => x.error).map(x => x.error),
    };
  } catch (err) {
    return { ok: false, error: 'Kunne ikke lese Vision-svaret: ' + err.message };
  }
}

// ------------------------------------------------------------
//  Analyse av én fil
// ------------------------------------------------------------
async function analyze(ffmpeg, tmpRoot, opts) {
  const file = opts && opts.absPath;
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'Fila finnes ikke (lenger)' };
  const ext = path.extname(file).slice(1).toLowerCase();
  const kind = VIDEO_EXT.has(ext) ? 'video' : 'image';
  const doOcr = opts.ocr !== false;
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'faktisk-skjermarkiv-'));
  try {
    if (kind === 'image') {
      const size = await imageSize(file);
      const thumb = await jpegThumb(ffmpeg, file, 480, tmp, 'thumb');
      if (!thumb) throw new Error('Klarte ikke lese bildet');
      let text = '', ocrInfo = null;
      if (doOcr) {
        const o = await visionOcr([file], tmpRoot);
        if (o.ok) { text = o.texts[0] || ''; ocrInfo = { langs: o.langs, auto: o.auto }; }
        else ocrInfo = { error: o.error };
      }
      return {
        ok: true, kind, width: size ? size.width : 0, height: size ? size.height : 0,
        created: await mdlsDate(file), thumb, text, ocr: doOcr && ocrInfo && !ocrInfo.error, ocrInfo,
      };
    }

    const meta = await probeVideo(ffmpeg, file);
    const { fps, diffs } = await sampleDiffs(ffmpeg, file, meta.duration);
    const keys = chooseKeyframes(meta.duration, fps, diffs, opts.maxFrames || 16);
    const frames = [];
    const fullPaths = [];
    for (let k = 0; k < keys.length; k++) {
      const full = path.join(tmp, 'f' + k + '.jpg'), small = path.join(tmp, 's' + k + '.jpg');
      if (await extractFrame(ffmpeg, file, keys[k].t, full, small, 400)) {
        frames.push({ t: keys[k].t, scene: keys[k].scene,
          src: 'data:image/jpeg;base64,' + fs.readFileSync(small).toString('base64'), text: '' });
        fullPaths.push(full);
      }
    }
    if (!frames.length) throw new Error('Klarte ikke hente ut bilder fra klippet');
    let ocrInfo = null;
    if (doOcr) {
      const o = await visionOcr(fullPaths, tmpRoot);
      if (o.ok) { o.texts.forEach((t, k) => { frames[k].text = t; }); ocrInfo = { langs: o.langs, auto: o.auto }; }
      else ocrInfo = { error: o.error };
    }
    return {
      ok: true, kind, width: meta.width, height: meta.height, duration: Math.round(meta.duration * 100) / 100,
      hasAudio: meta.hasAudio, created: meta.created || await mdlsDate(file),
      thumb: frames[0].src,
      frames, ocr: doOcr && ocrInfo && !ocrInfo.error, ocrInfo,
    };
  } catch (err) {
    return { ok: false, kind, error: err.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

// ------------------------------------------------------------
//  Arkiver i userData
// ------------------------------------------------------------
const safeArchiveId = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

function register(ipcMain, { app, findFfmpeg }) {
  const tmpRoot = () => app.getPath('temp');
  const archDir = () => { const d = path.join(app.getPath('userData'), 'skjermarkiv'); fs.mkdirSync(d, { recursive: true }); return d; };

  ipcMain.handle('skjermarkiv-scan', async (e, opts) => {
    try {
      const folder = opts && opts.folder;
      if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { ok: false, error: 'Mappa finnes ikke' };
      const files = scanFolder(folder, (opts && opts.limit) || 5000);
      return { ok: true, folder, folderName: path.basename(folder), files };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-analyze', async (e, opts) => {
    try { return await analyze(findFfmpeg(), tmpRoot(), opts || {}); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-ocr-check', async () => {
    // Rask egenkontroll: hvilke språk Vision tilbyr på denne Macen
    try { return await visionOcr([], tmpRoot(), true); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-preview', async (e, opts) => {
    const file = opts && opts.absPath;
    if (!file || !fs.existsSync(file)) return { ok: false, error: 'Fila finnes ikke' };
    const tmp = fs.mkdtempSync(path.join(tmpRoot(), 'faktisk-skjermarkiv-'));
    try {
      const src = await jpegThumb(findFfmpeg(), file, (opts && opts.max) || 1800, tmp, 'preview');
      return src ? { ok: true, src } : { ok: false, error: 'Klarte ikke lage forhåndsvisning' };
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  });

  ipcMain.handle('skjermarkiv-archive-save', async (e, opts) => {
    try {
      const id = safeArchiveId(opts && opts.id);
      if (!id || typeof opts.content !== 'string') return { ok: false, error: 'Mangler id eller innhold' };
      const file = path.join(archDir(), id + '.skjermarkiv.json');
      const tmpFile = file + '.tmp';
      fs.writeFileSync(tmpFile, opts.content, 'utf-8');
      fs.renameSync(tmpFile, file);                       // aldri halvskrevet arkiv
      const meta = Object.assign({ id, savedAt: new Date().toISOString() }, opts.meta || {});
      fs.writeFileSync(path.join(archDir(), id + '.meta.json'), JSON.stringify(meta), 'utf-8');
      return { ok: true, path: file };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-archive-list', async () => {
    try {
      const list = fs.readdirSync(archDir()).filter(f => f.endsWith('.meta.json')).map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(archDir(), f), 'utf-8')); } catch (e) { return null; }
      }).filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return { ok: true, archives: list };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-archive-load', async (e, opts) => {
    try {
      const id = safeArchiveId(opts && opts.id);
      const file = path.join(archDir(), id + '.skjermarkiv.json');
      if (!id || !fs.existsSync(file)) return { ok: false, error: 'Fant ikke arkivet' };
      return { ok: true, content: fs.readFileSync(file, 'utf-8') };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('skjermarkiv-archive-delete', async (e, opts) => {
    try {
      const id = safeArchiveId(opts && opts.id);
      for (const f of [id + '.skjermarkiv.json', id + '.meta.json']) {
        const p = path.join(archDir(), f);
        if (id && fs.existsSync(p)) fs.unlinkSync(p);
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Åpne en arkivfil brukeren har valgt (kun .json, maks 400 MB)
  ipcMain.handle('skjermarkiv-read-json', async (e, opts) => {
    try {
      const file = opts && opts.path;
      if (!file || !/\.json$/i.test(file) || !fs.existsSync(file)) return { ok: false, error: 'Velg en .json-arkivfil' };
      if (fs.statSync(file).size > 400 * 1024 * 1024) return { ok: false, error: 'Arkivfila er over 400 MB' };
      return { ok: true, content: fs.readFileSync(file, 'utf-8') };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { register, scanFolder, chooseKeyframes, sampleDiffs, probeVideo, analyze, linesToText, VISION_JXA };
