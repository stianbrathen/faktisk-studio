// Faktisk Studio · TikTok-henting (brukes av Videoslider-pluginen)
//
//   tiktok-list    De siste videoene på en TikTok-profil via yt-dlp
//                  (--flat-playlist): id, adresse, tekst, dato, lengde,
//                  visninger og forsidebilde. Ingenting lastes ned.
//   tiktok-import  Laster ned én video med yt-dlp. H.264 foretrekkes, og yt-dlp
//                  velger versjonen uten vannmerke når TikTok har den (den
//                  vannmerkede «download»-versjonen har lavere prioritet i yt-dlp).
//                  Flytter moov først («fast start»), gjør om til H.264 hvis TikTok
//                  bare hadde HEVC, sjekker Labradors 100 MB-grense og legger fila i
//                  Labrador som tiktok-<id>.mp4. Ligger den der fra før, brukes den
//                  (ingen duplikater i File admin).
//
// Fremdrift sendes som 'tiktok-progress' til vinduet som spurte.
// yt-dlp (nedlasting med sha256-sjekk) og kjøring lånes fra bevissikringen
// (src/bevis-main.js), så Studio har én kopi av verktøyet.
// TikTok kan kreve innlogging eller endre seg. Da gir yt-dlp en feilmelding som
// vises i pluginen; ofte hjelper det å oppdatere yt-dlp fra bevissikringen.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

let deps = null;   // { app, findFfmpeg, labradorListFiles, labradorSafeName, labradorCookieHeader, labradorOrigin }
const MAX_BYTES = 100 * 1024 * 1024;   // Labradors grense per fil

function B() { return (deps && deps._bevis) || require('./bevis-main.js')._internal; }

// «@faktisk.no», «faktisk.no» eller https://www.tiktok.com/@faktisk.no → profiladresse
function profileUrl(input) {
  const s = String(input || '').trim();
  let m = /^@?([\w.-]+)$/.exec(s);
  if (m && !/^https?$/i.test(m[1])) return 'https://www.tiktok.com/@' + m[1];
  m = /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([\w.-]+)\/?(?:[?#].*)?$/i.exec(s);
  return m ? 'https://www.tiktok.com/@' + m[1] : null;
}

function videoId(u) {
  const m = /\/video\/(\d{6,})/.exec(String(u || ''));
  return m ? m[1] : null;
}

function isVideoUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i.test(s)
    || /^https?:\/\/(?:vm|vt)\.tiktok\.com\/[\w-]+\/?$/i.test(s);
}

// Stillbilde, ikke det animerte «dynamicCover»
function pickThumb(list) {
  const arr = Array.isArray(list) ? list.filter(t => t && t.url) : [];
  const pref = ['cover', 'originCover', 'origin_cover'];
  for (const id of pref) { const t = arr.find(x => x.id === id); if (t) return t.url; }
  const still = arr.find(x => !/dynamic/i.test(x.id || ''));
  return still ? still.url : '';
}

function lastError(stderr) {
  const line = String(stderr || '').split('\n').filter(l => /ERROR/.test(l)).slice(-1)[0] || '';
  return line.replace(/^.*?ERROR:\s*/, '').replace(/\s*;?\s*please report this issue.*$/i, '').slice(0, 300);
}

function sender(e) {
  return msg => {
    try { if (e && e.sender && !(e.sender.isDestroyed && e.sender.isDestroyed())) e.sender.send('tiktok-progress', msg); } catch (x) {}
  };
}

async function tool() {
  const b = B();
  const yt = await b.ensureYtDlp(null);
  const env = Object.assign({}, process.env, { PATH: [b.binDir(), ...(b.EXTRA_PATH || []), process.env.PATH || ''].join(':') });
  return { b, yt, env };
}

function metaOut(m) {
  m = m || {};
  return {
    title: String(m.title || ''),
    description: String(m.description || ''),
    duration: Math.round(Number(m.duration) || 0),
    timestamp: Number(m.timestamp) || 0,
  };
}

// ------------------------------------------------------------
//  Liste over de siste videoene
// ------------------------------------------------------------
async function listVideos(e, opts) {
  const url = profileUrl(opts && opts.profile);
  if (!url) return { ok: false, error: 'Skriv inn TikTok-profilen, f.eks. @faktisk.no.' };
  const limit = Math.max(1, Math.min(60, parseInt(opts && opts.limit, 10) || 24));
  const send = sender(e);
  let t;
  try { send({ phase: 'list', label: 'Gjør klar yt-dlp …' }); t = await tool(); }
  catch (err) { return { ok: false, error: 'yt-dlp kunne ikke lastes ned: ' + err.message }; }
  send({ phase: 'list', label: 'Henter de siste videoene fra TikTok …' });
  const r = await t.b.run(t.yt, [
    '--flat-playlist', '-J', '--no-warnings', '--no-colors',
    '--playlist-items', '1-' + limit, '--socket-timeout', '30', '--extractor-retries', '3',
    '--', url,
  ], { timeoutMs: 4 * 60 * 1000, env: t.env });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch (x) {}
  if (!data || !Array.isArray(data.entries)) {
    const err = lastError(r.stderr);
    return { ok: false, error: r.timedOut ? 'TikTok svarte ikke (yt-dlp brukte for lang tid).'
      : 'Fikk ikke hentet lista fra TikTok' + (err ? ': ' + err : '.') };
  }
  const items = data.entries.filter(Boolean).map(en => {
    const link = en.webpage_url || en.url || '';
    return {
      id: String(en.id || videoId(link) || ''),
      url: link,
      title: String(en.title || ''),
      description: String(en.description || ''),
      duration: Math.round(Number(en.duration) || 0),
      timestamp: Number(en.timestamp) || 0,
      views: Number(en.view_count) || 0,
      thumb: pickThumb(en.thumbnails) || en.thumbnail || '',
    };
  }).filter(it => it.id && /^https?:\/\//.test(it.url));
  return { ok: true, profile: url, items };
}

// ------------------------------------------------------------
//  Én video → Labrador
// ------------------------------------------------------------
async function fetchInfo(t, url) {
  const r = await t.b.run(t.yt, ['-J', '--skip-download', '--no-playlist', '--no-warnings', '--no-colors', '--', url],
    { timeoutMs: 2 * 60 * 1000, env: t.env });
  try { return JSON.parse(r.stdout); } catch (x) { return null; }
}

function upload(fileName, buf, send) {
  return new Promise(async (resolve) => {
    const boundary = '----FaktiskStudio' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from('--' + boundary + '\r\n'
      + 'Content-Disposition: form-data; name="file"; filename="' + fileName.replace(/"/g, '') + '"\r\n'
      + 'Content-Type: video/mp4\r\n\r\n');
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([head, buf, tail]);
    let cookie = '';
    try { cookie = await deps.labradorCookieHeader(); } catch (x) {}
    const origin = deps.labradorOrigin || 'https://labrador.faktisk.no';
    const lib = /^http:/.test(origin) ? http : https;
    const req = lib.request(origin + '/ajax/file-upload/upload-files', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
      },
    }, res => {
      res.on('data', () => {});
      res.on('end', async () => {
        if (res.statusCode === 301 || res.statusCode === 302) return resolve({ ok: false, loggedIn: false, error: 'Ikke innlogget i Labrador.' });
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve({ ok: false, error: 'Opplasting til Labrador feilet (HTTP ' + res.statusCode + ').' });
        const list = await deps.labradorListFiles().catch(() => null);
        const hit = list && list.loggedIn && list.files.find(f => f.name === fileName);
        resolve(hit ? { ok: true, url: hit.url } : { ok: false, error: 'Labrador svarte OK, men fila dukket ikke opp i lista.' });
      });
    });
    req.on('error', err => resolve({ ok: false, error: 'Opplasting feilet: ' + err.message }));
    const CHUNK = 256 * 1024;
    let off = 0;
    const next = () => {
      while (off < body.length) {
        const end = Math.min(off + CHUNK, body.length);
        const ok = req.write(body.subarray(off, end));
        off = end;
        const pct = Math.round(off / body.length * 100);
        send({ phase: 'upload', percent: pct, label: 'Legger videoen i Labrador … ' + pct + ' %' });
        if (!ok) { req.once('drain', next); return; }
      }
      req.end();
    };
    next();
  });
}

async function importVideo(e, opts) {
  const url = String((opts && opts.url) || '').trim();
  if (!isVideoUrl(url)) return { ok: false, error: 'Det er ikke en adresse til en TikTok-video.' };
  const send = sender(e);
  const given = opts.meta || null;

  let files;
  try { files = await deps.labradorListFiles(); } catch (err) { return { ok: false, error: err.message }; }
  if (!files || !files.loggedIn) return { ok: false, loggedIn: false, error: 'Ikke innlogget i Labrador.' };

  let t;
  try { send({ phase: 'download', label: 'Gjør klar yt-dlp …' }); t = await tool(); }
  catch (err) { return { ok: false, error: 'yt-dlp kunne ikke lastes ned: ' + err.message }; }

  const nameFor = id => deps.labradorSafeName('tiktok-' + id + '.mp4');
  const known = videoId(url);
  if (known) {
    const hit = files.files.find(f => f.name === nameFor(known));
    if (hit) {
      const meta = given || await fetchInfo(t, url);
      return Object.assign({ ok: true, reused: true, url: hit.url, id: known, link: (meta && meta.webpage_url) || url }, metaOut(meta));
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faktisk-tiktok-'));
  try {
    send({ phase: 'download', percent: 0, label: 'Laster ned fra TikTok …' });
    const ff = deps.findFfmpeg && deps.findFfmpeg();
    if (!ff) return { ok: false, error: 'ffmpeg mangler i Studio.' };
    const args = [
      '--no-playlist', '--newline', '--no-colors', '--no-warnings', '--no-mtime',
      '-S', 'vcodec:h264,res:1080', '--merge-output-format', 'mp4',
      '--socket-timeout', '30', '--retries', '3', '--write-info-json',
      '--ffmpeg-location', ff,
      '-o', path.join(dir, '%(id)s.%(ext)s'),
      '--', url,
    ];
    const r = await t.b.run(t.yt, args, {
      timeoutMs: 10 * 60 * 1000, env: t.env,
      onLine: line => {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) { const p = Math.round(parseFloat(m[1])); send({ phase: 'download', percent: p, label: 'Laster ned fra TikTok … ' + p + ' %' }); }
      },
    });
    const names = fs.readdirSync(dir);
    const vid = names.find(n => /\.(mp4|mkv|webm|mov)$/i.test(n) && !/\.part$/.test(n));
    if (!vid) {
      const err = lastError(r.stderr);
      return { ok: false, error: 'Fikk ikke lastet ned videoen' + (err ? ': ' + err : (r.timedOut ? ' (tidsavbrudd).' : '.')) };
    }
    let meta = {};
    const ij = names.find(n => /\.info\.json$/.test(n));
    if (ij) { try { meta = JSON.parse(fs.readFileSync(path.join(dir, ij), 'utf8')); } catch (x) {} }
    const id = String(meta.id || known || path.basename(vid).replace(/\.[^.]+$/, ''));
    const fileName = nameFor(id);
    const link = meta.webpage_url || url;

    // Kortlenker (vm.tiktok.com) har ikke id i adressen: sjekk Labrador på nytt
    if (!known) {
      const again = await deps.labradorListFiles();
      const hit = again && again.loggedIn && again.files.find(f => f.name === fileName);
      if (hit) return Object.assign({ ok: true, reused: true, url: hit.url, id, link }, metaOut(given || meta));
    }

    const h264 = !meta.vcodec || /^(h264|avc)/i.test(String(meta.vcodec));
    send({ phase: 'convert', label: h264 ? 'Gjør klar for nett …' : 'Gjør om til H.264 …' });
    const out = path.join(dir, 'faktisk-ut.mp4');
    const codec = h264 ? ['-c', 'copy']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];
    const fr = await t.b.run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, vid)]
      .concat(codec, ['-movflags', '+faststart', out]), { timeoutMs: 15 * 60 * 1000 });
    if (fr.code !== 0 || !fs.existsSync(out)) {
      return { ok: false, error: 'ffmpeg feilet: ' + (String(fr.stderr || '').trim().split('\n').slice(-1)[0] || 'ukjent feil') };
    }
    const size = fs.statSync(out).size;
    if (size > MAX_BYTES) return { ok: false, error: 'Videoen er ' + Math.round(size / 1048576) + ' MB – over Labradors grense på 100 MB.' };

    const up = await upload(fileName, fs.readFileSync(out), send);
    if (!up.ok) return up;
    return Object.assign({ ok: true, url: up.url, id, link, sizeMB: +(size / 1048576).toFixed(1), converted: !h264 }, metaOut(given || meta));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {}
  }
}

function register(ipcMain, d) {
  deps = d || {};
  ipcMain.handle('tiktok-list', (e, o) => listVideos(e, o || {}).catch(err => ({ ok: false, error: err.message })));
  ipcMain.handle('tiktok-import', (e, o) => importVideo(e, o || {}).catch(err => ({ ok: false, error: err.message })));
}

module.exports = { register, _test: { profileUrl, videoId, isVideoUrl, pickThumb, lastError, listVideos, importVideo, setDeps: d => { deps = d; } } };
