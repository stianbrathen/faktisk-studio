// Faktisk Studio · Presentasjon-pluginen (main-siden)
//
//   presentation-read-file  Leser en lokal mediefil (bilde, video, lyd) som bytes,
//                           så pluginen kan legge den inn i Keynote-fila. fetch()
//                           kan ikke lese file://-adresser i rendereren.
//   presentation-waveform   Lager lydbølge-video med ffmpeg: et ferdig tegnet bilde
//                           av bølgen (fra pluginen, i palettens farger), en strek
//                           som går over den, telleren «0:12 / 2:06» og lyden.
//                           Med from/to blir det et utsnitt (ett funn). Resultatet
//                           mellomlagres i userData/presentasjon-cache.
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
const FONTS = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'];

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

async function waveform(e, o) {
  const src = toPath(o && o.src);
  if (!src || !fs.existsSync(src)) return { ok: false, error: 'Fant ikke lydfila' };
  const m = /^data:image\/png;base64,(.+)$/.exec((o && o.base) || '');
  if (!m) return { ok: false, error: 'Mangler bildet av lydbølgen' };
  const dur = Number(o.dur) || 0, from = Math.max(0, Number(o.from) || 0);
  const to = Math.min(dur || 1e9, o.to == null ? dur : Number(o.to)), len = Math.max(.5, to - from);
  const W = 1660, H = 310;
  const tekst = /^[0-9A-F]{6}$/i.test(o.tekst || '') ? o.tekst : '1D2733', dempet = /^[0-9A-F]{6}$/i.test(o.dempet || '') ? o.dempet : '5B6572';
  const st = fs.statSync(src);
  const key = crypto.createHash('sha256').update([src, st.size, st.mtimeMs, m[1].length, crypto.createHash('sha1').update(m[1]).digest('hex'), from, to, tekst, dempet, 2].join('|')).digest('hex').slice(0, 24);
  const dir = path.join(deps.app.getPath('userData'), 'presentasjon-cache');
  const out = path.join(dir, key + '.mp4');
  if (fs.existsSync(out)) return { ok: true, path: out, cached: true };
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(os.tmpdir(), 'fk-bolge-' + key + '.png');
  fs.writeFileSync(base, Buffer.from(m[1], 'base64'));
  progress(e, 'Lager lydbølge-video …');
  const font = FONTS.find((f) => fs.existsSync(f));
  const head = `color=c=#${tekst}:s=4x270:r=25[ph];[0:v][ph]overlay=x='(t+${from})/${dur}*${W}-2':y=6:eval=frame`;
  const counter = font ? `,drawtext=fontfile=${font}:text='%{eif\\:floor((t+${from})/60)\\:d}\\:%{eif\\:mod(floor(t+${from})\\,60)\\:d\\:2} / ${fmt(dur).replace(':', '\\:')}':x=(w-text_w)/2:y=274:fontsize=24:fontcolor=#${dempet}` : '';
  const args = (graph) => ['-v', 'error', '-y', '-loop', '1', '-framerate', '25', '-i', base, '-ss', String(from), '-t', String(len), '-i', src,
    '-filter_complex', graph + '[v]', '-map', '[v]', '-map', '1:a?', '-t', String(len), '-s', `${W}x${H}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out];
  const ff = deps.findFfmpeg();
  let r = await run(ff, args(head + counter));
  if (!r.ok && counter) r = await run(ff, args(head));   // ffmpeg uten drawtext: lag den uten teller
  try { fs.unlinkSync(base); } catch (x) {}
  if (!r.ok) { try { fs.unlinkSync(out); } catch (x) {} return { ok: false, error: r.error || 'ffmpeg feilet' }; }
  return { ok: true, path: out };
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

async function keynote(e, o) {
  const bytes = o && o.bytes;
  if (!bytes || !bytes.length) return { ok: false, error: 'Ingen fil å lagre' };
  let target;
  const folder = toPath(o.folder);
  if (folder && fs.existsSync(folder)) {
    const dir = path.join(folder, 'Eksport'); fs.mkdirSync(dir, { recursive: true });
    target = nextName(dir, o.title, '.key');
  } else {
    const res = await deps.dialog.showSaveDialog({ title: 'Lagre Keynote-presentasjonen', defaultPath: path.join(deps.app.getPath('documents'), (o.title || 'Presentasjon') + '.key'),
      filters: [{ name: 'Keynote', extensions: ['key'] }] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    target = res.filePath.endsWith('.key') ? res.filePath : res.filePath + '.key';
  }
  const tmp = path.join(os.tmpdir(), 'fk-presentasjon-' + Date.now() + '.pptx');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  progress(e, 'Åpner i Keynote …');
  const err = await new Promise((resolve) => execFile('osascript', ['-e', SCRIPT, tmp, target], { timeout: 180000 }, (x, so, se) => resolve(x ? (se || x.message) : null)));
  if (!err && fs.existsSync(target)) { try { fs.unlinkSync(tmp); } catch (x) {} return { ok: true, path: target }; }
  // Reserve: legg .pptx-fila ved siden av og åpne den i Keynote
  const pptx = target.replace(/\.key$/, '.pptx');
  try { fs.copyFileSync(tmp, pptx); fs.unlinkSync(tmp); } catch (x) { return { ok: false, error: x.message }; }
  execFile('open', ['-a', 'Keynote', pptx], () => {});
  return { ok: true, path: pptx, fallback: true, error: String(err || '').trim().slice(0, 300) };
}

function register(ipcMain, d) {
  deps = d;
  ipcMain.handle('presentation-read-file', (e, p) => readFile(e, p));
  ipcMain.handle('presentation-waveform', (e, o) => waveform(e, o));
  ipcMain.handle('presentation-keynote', (e, o) => keynote(e, o));
}

module.exports = { register, _test: { toPath, fmt, nextName, waveform, setDeps: (x) => { deps = x; } } };
