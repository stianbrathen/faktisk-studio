// Faktisk Studio · Blokker i Presentasjon-pluginen
//
// En blokk er en rekke lysbilder (et case, en verktøyforklaring, en fast avslutning) som kan
// lagres og settes inn i nye presentasjoner. Én fil per blokk: «Navn.faktiskblokk», en zip
// der alt er lagret UKOMPRIMERT (STORE): blokk.json + medier/<n>-<filnavn>. Pluginen pakker
// fila med JSZip; her trengs bare en liten zip-leser, så Studio ikke får nye avhengigheter.
//
// To nivåer (et tredje, «Faktisk», kommer sammen med malsynk for Final Cut-malene):
//   Mine  – en mappe på maskinen, standard ~/Faktisk blokker
//   Delt  – en mappe flere har tilgang til (Google Drive, iCloud, Dropbox), valgt av brukeren
// Innstillingene ligger i userData/presentasjon-blokker.json.
//
//   presentation-blocks-settings     les innstillinger (+ standardmappe)
//   presentation-blocks-choose       velg mappe for 'mine' eller 'delt' (dialog)
//   presentation-blocks-list         blokker i begge mappene (bare blokk.json leses)
//   presentation-blocks-save         {bytes, name, overwrite} → lagres i Mine
//   presentation-blocks-load         {path, mediaDir} → lysbilder med file://-adresser; mediene
//                                    pakkes ut i dokumentets Medier/ (eller en mellomlagring)
//   presentation-blocks-share        kopier en blokk fra Mine til Delt
//   presentation-blocks-import       kopier .faktiskblokk-filer inn i Mine
//   presentation-blocks-reveal       vis i Finder
//   presentation-blocks-trash        legg i papirkurven (bare Mine)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let deps = null;   // { app, dialog, shell, documentInfo }
const EXT = '.faktiskblokk';

function settingsFile() { return path.join(deps.app.getPath('userData'), 'presentasjon-blokker.json'); }
function defaultMine() { return path.join(os.homedir(), 'Faktisk blokker'); }
function readSettings() {
  let s = {}; try { s = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')) || {}; } catch (e) {}
  return { mine: s.mine || defaultMine(), delt: s.delt || null };
}
function writeSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf-8'); }

// ---------- liten zip-leser: bare ukomprimerte filer (metode 0) ----------
function zipEntries(buf) {
  const from = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Ikke en blokkfil (fant ikke innholdslista)');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Ødelagt blokkfil');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf-8');
    out[name] = { method, size, off };
    p += 46 + nl + xl + cl;
  }
  return out;
}
function zipRead(buf, e) {
  if (e.method !== 0) throw new Error('Blokkfila er komprimert (ikke laget av Studio)');
  const nl = buf.readUInt16LE(e.off + 26), xl = buf.readUInt16LE(e.off + 28), start = e.off + 30 + nl + xl;
  return buf.slice(start, start + e.size);
}
function readManifest(file) {
  const buf = fs.readFileSync(file), ents = zipEntries(buf);
  if (!ents['blokk.json']) throw new Error('Mangler blokk.json');
  const m = JSON.parse(zipRead(buf, ents['blokk.json']).toString('utf-8'));
  if (!m || m.format !== 'faktisk-blokk' || !Array.isArray(m.slides)) throw new Error('Ukjent blokkformat');
  return { buf, ents, m };
}

function listDir(dir, level) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(EXT)) continue;
    const p = path.join(dir, f);
    try {
      const { m } = readManifest(p), st = fs.statSync(p);
      out.push({ path: p, level, file: f, name: m.name || f.slice(0, -EXT.length), description: m.description || '',
        savedAt: m.savedAt || st.mtime.toISOString(), id: m.id || null, palette: m.palette || '', size: st.size,
        slides: m.slides.map((s) => ({ type: s.type, title: (s.f && (s.f.tittel || s.f.sak || s.f.utsagn)) || '' })) });
    } catch (e) { out.push({ path: p, level, file: f, name: f.slice(0, -EXT.length), error: e.message, slides: [] }); }
  }
  return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

const safeName = (s) => String(s || 'Blokk').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Blokk';
function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext);
  for (let n = 2; fs.existsSync(p); n++) p = path.join(dir, `${base} ${n}${ext}`);
  return p;
}

function save(o) {
  const s = readSettings();
  const bytes = o && o.bytes; if (!bytes || !bytes.length) return { ok: false, error: 'Tom blokk' };
  const buf = Buffer.from(bytes);
  try { const ents = zipEntries(buf); if (!ents['blokk.json']) throw new Error('Mangler blokk.json'); } catch (e) { return { ok: false, error: e.message }; }
  fs.mkdirSync(s.mine, { recursive: true });
  const target = o.overwrite && o.path && path.dirname(o.path) === s.mine ? o.path : uniquePath(s.mine, safeName(o.name), EXT);
  fs.writeFileSync(target, buf);
  return { ok: true, path: target };
}

function load(o) {
  const file = o && o.path; if (!file || !file.endsWith(EXT)) return { ok: false, error: 'Ikke en blokkfil' };
  const { buf, ents, m } = readManifest(file);
  // mediene: inn i dokumentets Medier/ hvis dokumentet er lagret, ellers i en mellomlagring
  const info = deps.documentInfo ? deps.documentInfo() : null;
  const hash = crypto.createHash('sha1').update(file + fs.statSync(file).mtimeMs).digest('hex').slice(0, 12);
  const dir = info && info.mediaDir ? info.mediaDir : path.join(deps.app.getPath('userData'), 'presentasjon-blokker', hash);
  fs.mkdirSync(dir, { recursive: true });
  const map = {};
  for (const [name, e] of Object.entries(ents)) {
    if (!name.startsWith('medier/') || name.endsWith('/')) continue;
    const data = zipRead(buf, e), base = path.basename(name).replace(/^\d+-/, '');
    // samme fil fra før (samme innhold) gjenbrukes
    let target = path.join(dir, base);
    if (fs.existsSync(target) && fs.statSync(target).size === data.length && fs.readFileSync(target).equals(data)) { map[name] = target; continue; }
    target = uniquePath(dir, path.basename(base, path.extname(base)), path.extname(base));
    fs.writeFileSync(target, data); map[name] = target;
  }
  const fix = (v) => (typeof v === 'string' && v.startsWith('blokk:') && map[v.slice(6)] ? 'file://' + encodeURI(map[v.slice(6)]).replace(/#/g, '%23') : v);
  const walk = (v) => Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : fix(v);
  return { ok: true, block: { name: m.name, id: m.id, savedAt: m.savedAt, palette: m.palette, slides: walk(m.slides) } };
}

async function choose(level) {
  const s = readSettings();
  const res = await deps.dialog.showOpenDialog({ title: level === 'delt' ? 'Velg delt mappe for blokker' : 'Velg mappe for mine blokker',
    defaultPath: (level === 'delt' ? s.delt : s.mine) || os.homedir(), properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true, settings: s };
  s[level === 'delt' ? 'delt' : 'mine'] = res.filePaths[0]; writeSettings(s);
  return { ok: true, settings: s };
}

function register(ipcMain, d) {
  deps = d;
  const guard = (fn) => async (e, a) => { try { return await fn(a); } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('presentation-blocks-settings', guard(() => ({ ok: true, settings: readSettings() })));
  ipcMain.handle('presentation-blocks-choose', guard((level) => choose(level)));
  ipcMain.handle('presentation-blocks-list', guard(() => { const s = readSettings(); return { ok: true, settings: s, blocks: [...listDir(s.mine, 'mine'), ...listDir(s.delt, 'delt')] }; }));
  ipcMain.handle('presentation-blocks-save', guard((o) => save(o)));
  ipcMain.handle('presentation-blocks-load', guard((o) => load(o)));
  ipcMain.handle('presentation-blocks-share', guard((p) => {
    const s = readSettings(); if (!s.delt || !fs.existsSync(s.delt)) return { ok: false, error: 'Velg en delt mappe først' };
    const target = path.join(s.delt, path.basename(p));
    fs.copyFileSync(p, target); return { ok: true, path: target };
  }));
  ipcMain.handle('presentation-blocks-import', guard((files) => {
    const s = readSettings(); fs.mkdirSync(s.mine, { recursive: true }); const done = [];
    for (const f of files || []) { if (!String(f).endsWith(EXT)) continue; readManifest(f);
      const t = uniquePath(s.mine, path.basename(f, EXT), EXT); fs.copyFileSync(f, t); done.push(t); }
    return { ok: true, paths: done };
  }));
  ipcMain.handle('presentation-blocks-reveal', guard((p) => { deps.shell.showItemInFolder(p); return { ok: true }; }));
  ipcMain.handle('presentation-blocks-trash', guard(async (p) => {
    const s = readSettings(); if (path.dirname(p) !== s.mine) return { ok: false, error: 'Bare egne blokker kan slettes herfra' };
    await deps.shell.trashItem(p); return { ok: true };
  }));
}

module.exports = { register, _test: { zipEntries, zipRead, readManifest, listDir, load, save, setDeps: (x) => { deps = x; } } };
