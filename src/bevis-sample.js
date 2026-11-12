// Faktisk Studio · Bevissikring — stikkprøver over en periode
//
// Lager en PLAN før noe hentes: konto, periode, metode og tidsvinduer, lagret
// og hashet i saken. Planen viser i ettertid at utvalget var systematisk og
// ikke håndplukket. Selve innsamlingen kjøres fra pluginen: hvert nedslag
// åpnes i sikringsvinduet og sikres med bevis-capture (merket med sample).
//
//   bevis-plan-create    lag og lagre plan (X: søkeadresser, YouTube: videoer)
//   bevis-plan-list      planer i arkivet, med resultater
//   bevis-plan-result    logg resultatet av ett nedslag
//   bevis-youtube-list   alle videoer i en kanal med omtrentlig dato (yt-dlp)
//   bevis-youtube-date   nøyaktig publiseringsdato for én video
//
// Plattformer: X og YouTube først. Facebook, Instagram og TikTok har ingen
// adresse som hopper til en dato — de kommer som egne strategier senere.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PLAN_DIR = '_stikkprover';
const DAY = 86400000;
let H = null;           // hjelpere fra bevis-main.js
let deps = null;
const ytCache = new Map();

const pad2 = n => String(n).padStart(2, '0');
function isoDate(t) { const d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
function parseDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function ymdToIso(s) { return /^\d{8}$/.test(s || '') ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : ''; }

// ------------------------------------------------------------
//  Konto → plattform og håndtak
// ------------------------------------------------------------
function parseAccount(input, platformHint) {
  const raw = String(input || '').trim();
  let platform = platformHint || '', handle = '', channelUrl = '';
  let url = null;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : (raw.includes('.') && raw.includes('/') ? 'https://' + raw : 'x:' + raw)); } catch (e) {}
  if (url && /^https?:$/.test(url.protocol)) {
    const host = url.hostname.replace(/^www\.|^m\.|^mobile\./, '');
    const segs = url.pathname.split('/').filter(Boolean);
    if (/(^|\.)(twitter|x)\.com$/.test(host)) { platform = 'x'; handle = segs[0] || ''; }
    else if (/(^|\.)youtube\.com$/.test(host)) {
      platform = 'youtube';
      if (segs[0] && segs[0].startsWith('@')) { handle = segs[0]; channelUrl = 'https://www.youtube.com/' + segs[0]; }
      else if (segs[0] === 'channel' || segs[0] === 'c' || segs[0] === 'user') { handle = segs[1] || ''; channelUrl = 'https://www.youtube.com/' + segs[0] + '/' + segs[1]; }
    }
    else if (/(^|\.)facebook\.com$/.test(host)) { platform = 'facebook'; handle = segs[0] === 'profile.php' ? (url.searchParams.get('id') || '') : (segs[0] || ''); }
    else if (/(^|\.)instagram\.com$/.test(host)) { platform = 'instagram'; handle = segs[0] || ''; }
    else if (/(^|\.)tiktok\.com$/.test(host)) { platform = 'tiktok'; handle = (segs[0] || '').replace(/^@/, ''); }
  } else {
    handle = raw.replace(/^@/, '');
    if (platform === 'youtube') { handle = '@' + handle; channelUrl = 'https://www.youtube.com/' + handle; }
  }
  if (platform === 'x') handle = handle.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  return { platform, handle, channelUrl };
}

// ------------------------------------------------------------
//  Tidsvinduer
// ------------------------------------------------------------
// interval: ett nedslag hver n. dag fra start.  count: n nedslag jevnt fordelt
// slik at første starter på fra-datoen og siste slutter på til-datoen.
function makeWindows({ from, to, mode, n, windowDays }) {
  const a = parseDate(from), b = parseDate(to);
  if (isNaN(a) || isNaN(b) || b < a) throw new Error('Ugyldig periode');
  const span = Math.round((b - a) / DAY) + 1;                 // til-datoen er med
  const w = Math.max(1, Math.min(+windowDays || 1, span));
  const wins = [];
  if (mode === 'count') {
    const cnt = Math.max(1, Math.min(+n || 1, 500));
    for (let i = 0; i < cnt; i++) {
      const off = cnt === 1 ? Math.floor((span - w) / 2) : Math.round(i * (span - w) / (cnt - 1));
      wins.push(a + off * DAY);
    }
  } else {
    const step = Math.max(1, +n || 1);
    for (let off = 0; off < span; off += step) wins.push(a + off * DAY);
    if (wins.length > 500) throw new Error('For mange nedslag (' + wins.length + ') — øk intervallet');
  }
  const seen = new Set();
  return wins.filter(t => !seen.has(t) && seen.add(t)).map((t, i) => {
    const end = Math.min(t + w * DAY, b + DAY);                // eksklusiv slutt
    return { index: i, from: isoDate(t), until: isoDate(end), lastDay: isoDate(end - DAY) };
  });
}

function xSearchUrl(handle, from, until) {
  const q = 'from:' + handle + ' since:' + from + ' until:' + until;
  return 'https://x.com/search?q=' + encodeURIComponent(q) + '&src=typed_query&f=live';
}

// Velg inntil per videoer i vinduet, jevnt fordelt i tid (deterministisk)
function pickVideos(videos, win, per) {
  const inWin = videos.filter(v => v.date && v.date >= win.from && v.date < win.until);
  if (inWin.length <= per) return inWin;
  const out = [];
  for (let i = 0; i < per; i++) out.push(inWin[Math.round(i * (inWin.length - 1) / Math.max(1, per - 1))]);
  return out.filter((v, i, arr) => arr.indexOf(v) === i);
}

// ------------------------------------------------------------
//  YouTube via yt-dlp
// ------------------------------------------------------------
async function youtubeList(channelUrl, progress, refresh) {
  if (!refresh && ytCache.has(channelUrl)) return ytCache.get(channelUrl);
  const yt = await H.ensureYtDlp(progress);
  const env = Object.assign({}, process.env, { PATH: [H.binDir(), ...H.EXTRA_PATH, process.env.PATH || ''].join(':') });
  const all = [], notes = [];
  for (const tab of ['videos', 'shorts', 'streams']) {
    progress && progress('Henter videoliste fra YouTube (' + tab + ') …');
    let n = 0;
    const r = await H.run(yt, [
      '--flat-playlist', '--no-warnings', '--extractor-args', 'youtubetab:approximate_date',
      '--print', '%(upload_date)s\t%(id)s\t%(title)s', '--', channelUrl.replace(/\/+$/, '') + '/' + tab,
    ], { timeoutMs: 10 * 60 * 1000, env, onLine: () => { if (++n % 100 === 0 && progress) progress('Henter videoliste … ' + n + ' (' + tab + ')'); } });
    for (const line of String(r.stdout).split('\n')) {
      const [d, id, ...rest] = line.split('\t');
      if (!id || !/^[\w-]{6,}$/.test(id)) continue;
      all.push({ id, title: rest.join('\t'), date: ymdToIso(d), kind: tab, url: tab === 'shorts' ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id });
    }
    if (r.code !== 0 && !/does not have a|This channel does not have/i.test(r.stderr)) {
      const err = (r.stderr || '').split('\n').filter(l => /ERROR/.test(l)).slice(-1)[0];
      if (err && tab === 'videos') notes.push(err.replace(/^.*?ERROR:\s*/, ''));
    }
  }
  const seen = new Set();
  const videos = all.filter(v => !seen.has(v.id) && seen.add(v.id)).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
  const res = { channelUrl, fetchedAt: new Date().toISOString(), count: videos.length, undated: videos.filter(v => !v.date).length, videos, notes, approximate: true };
  if (videos.length) ytCache.set(channelUrl, res);
  return res;
}

async function youtubeExactDate(id, progress) {
  const yt = await H.ensureYtDlp(progress);
  const env = Object.assign({}, process.env, { PATH: [H.binDir(), ...H.EXTRA_PATH, process.env.PATH || ''].join(':') });
  const r = await H.run(yt, ['--skip-download', '--no-warnings', '--print', '%(upload_date)s\t%(timestamp)s\t%(title)s', '--', 'https://www.youtube.com/watch?v=' + id], { timeoutMs: 180000, env });
  const [d, ts, ...title] = String(r.stdout).trim().split('\t');
  if (!/^\d{8}$/.test(d || '')) throw new Error(((r.stderr || '').split('\n').filter(l => /ERROR/.test(l)).slice(-1)[0] || 'fant ingen dato').replace(/^.*?ERROR:\s*/, ''));
  return { id, date: ymdToIso(d), timestamp: /^\d+$/.test(ts || '') ? +ts : null, title: title.join('\t') };
}

// ------------------------------------------------------------
//  Planfiler
// ------------------------------------------------------------
function planText(plan) {
  const L = [];
  L.push('STIKKPRØVEPLAN — Faktisk Studio · Bevissikring');
  L.push('');
  L.push('Laget:       ' + plan.createdAtLocal + (plan.createdBy ? ' av ' + plan.createdBy : ''));
  L.push('Sak:         ' + plan.case);
  L.push('Plattform:   ' + plan.platform);
  L.push('Konto:       ' + plan.account.input + (plan.account.handle ? '  (' + plan.account.handle + ')' : ''));
  L.push('Periode:     ' + plan.period.from + ' – ' + plan.period.to + ' (begge dager med)');
  L.push('Metode:      ' + (plan.method.mode === 'count'
    ? plan.method.n + ' nedslag jevnt fordelt over perioden'
    : 'ett nedslag hver ' + plan.method.n + '. dag fra startdatoen'));
  L.push('Vindu:       ' + plan.method.windowDays + ' døgn per nedslag (UTC-datoer)');
  if (plan.platform === 'youtube') {
    L.push('Utvalg:      inntil ' + plan.method.perWindow + ' video(er) per vindu, jevnt fordelt i tid innenfor vinduet');
    L.push('Datoer:      omtrentlige datoer fra kanaloversikten; nøyaktig dato står i hver sikrings media/*.info.json');
  }
  if (plan.platform === 'x') L.push('Kilde:       X-søk  from:konto since:fra until:til  (krever innlogging; X sitt søk kan være ufullstendig)');
  if (plan.note) L.push('Notat:       ' + plan.note);
  L.push('');
  L.push('Nr   Fra          Til og med   Innhold');
  for (const w of plan.windows) {
    const what = plan.platform === 'youtube'
      ? (w.videos.length ? w.videos.map(v => v.id + ' ' + v.date).join(', ') : '(ingen videoer i vinduet)')
      : w.url;
    L.push(String(w.index + 1).padEnd(5) + w.from + '   ' + w.lastDay + '   ' + what);
  }
  L.push('');
  L.push('Planen ble lagret og hashet FØR innsamlingen startet. Kontroller med: shasum -a 256 -c SHA256SUMS.txt');
  return L.join('\n') + '\n';
}

async function writePlan(root, caseName, plan) {
  if (!root || !fs.existsSync(root)) throw new Error(root ? 'Arkivmappa er ikke tilgjengelig (låst kryptert arkiv?)' : 'Velg arkivmappe først');
  const caseDir = path.join(root, H.safeName(caseName) || 'Uten sak');
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  const name = [stamp, plan.platform, H.slug(plan.account.handle || plan.account.input, 40)].filter(Boolean).join('_');
  let dir = path.join(caseDir, PLAN_DIR, name), i = 2;
  while (fs.existsSync(dir)) dir = path.join(caseDir, PLAN_DIR, name + '-' + i++);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'plan.txt'), planText(plan));
  const lines = [];
  for (const f of ['plan.json', 'plan.txt']) lines.push((await H.sha256File(path.join(dir, f))) + '  ' + f);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  return { dir, fingerprint: await H.sha256File(path.join(dir, 'SHA256SUMS.txt')) };
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

function listPlans(root) {
  const out = [];
  let cases = [];
  try { cases = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')); } catch (e) { return out; }
  for (const c of cases) {
    const pdir = path.join(root, c.name, PLAN_DIR);
    let ents = [];
    try { ents = fs.readdirSync(pdir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const dir = path.join(pdir, e.name);
      const plan = readJson(path.join(dir, 'plan.json'));
      if (!plan || plan.format !== 'faktisk-stikkprove') continue;
      const results = readJson(path.join(dir, 'resultat.json')) || [];
      out.push({ dir, case: c.name, plan, results });
    }
  }
  out.sort((a, b) => String(b.plan.createdAt).localeCompare(String(a.plan.createdAt)));
  return out;
}

function insidePlanDir(dir) {
  const plan = readJson(path.join(dir || '', 'plan.json'));
  return !!(plan && plan.format === 'faktisk-stikkprove' && path.basename(path.dirname(dir)) === PLAN_DIR);
}

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain, d) {
  deps = d;
  H = require('./bevis-main.js')._internal;
  const send = (e, msg) => { try { if (!e.sender.isDestroyed()) e.sender.send('bevis-progress', { msg }); } catch (err) {} };

  ipcMain.handle('bevis-plan-create', async (e, o) => {
    try {
      o = o || {};
      if (!o.root) throw new Error('Velg arkivmappe først');
      if (!String(o.caseName || '').trim()) throw new Error('Skriv inn en sak');
      const acc = parseAccount(o.account, o.platform);
      if (!acc.platform) throw new Error('Velg plattform');
      if (!acc.handle) throw new Error('Fant ingen konto i «' + (o.account || '') + '»');
      if (!['x', 'youtube'].includes(acc.platform)) throw new Error('Stikkprøver støtter foreløpig X og YouTube');
      const windows = makeWindows(o);
      const per = Math.max(1, Math.min(+o.perWindow || 1, 10));
      let source = null;
      if (acc.platform === 'x') {
        windows.forEach(w => { w.url = xSearchUrl(acc.handle, w.from, w.until); });
        source = { type: 'x-search', note: 'X-søk med from:/since:/until: — krever innlogging i sikringsvinduet' };
      } else {
        if (!acc.channelUrl) throw new Error('Oppgi YouTube-kanalen som lenke eller @navn');
        const list = await youtubeList(acc.channelUrl, msg => send(e, msg), !!o.refresh);
        if (!list.count) throw new Error('Fant ingen videoer på kanalen' + (list.notes.length ? ': ' + list.notes[0] : ''));
        windows.forEach(w => { w.videos = pickVideos(list.videos, w, per).map(v => ({ id: v.id, date: v.date, title: v.title, url: v.url, kind: v.kind })); });
        source = { type: 'youtube-flat-playlist', channelUrl: acc.channelUrl, listedAt: list.fetchedAt, videosOnChannel: list.count, undated: list.undated, datesApproximate: true,
          oldest: list.videos.find(v => v.date) || null };
      }
      const now = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const plan = {
        format: 'faktisk-stikkprove', version: 1,
        id: crypto.randomBytes(6).toString('hex'),
        case: o.caseName.trim(), note: o.note || '',
        createdAt: now.toISOString(),
        createdAtLocal: now.toLocaleString('nb-NO', { timeZone: tz }) + ' (' + tz + ')',
        createdBy: (() => { try { return require('os').userInfo().username; } catch (err) { return ''; } })(),
        studioVersion: deps.app.getVersion(), pluginVersion: o.pluginVersion || null,
        platform: acc.platform,
        account: { input: String(o.account || '').trim(), handle: acc.handle, channelUrl: acc.channelUrl || null },
        period: { from: o.from, to: o.to },
        method: { mode: o.mode === 'count' ? 'count' : 'interval', n: +o.n || 1, windowDays: Math.max(1, +o.windowDays || 1), perWindow: acc.platform === 'youtube' ? per : undefined },
        source,
        windows,
      };
      const w = await writePlan(o.root, o.caseName, plan);
      return { ok: true, dir: w.dir, fingerprint: w.fingerprint, plan };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-plan-list', (e, o) => {
    try { return { ok: true, plans: listPlans(o && o.root) }; } catch (err) { return { ok: false, error: err.message, plans: [] }; }
  });

  // Resultatloggen er en egen fil ved siden av planen — planen selv endres aldri
  ipcMain.handle('bevis-plan-result', (e, o) => {
    try {
      if (!insidePlanDir(o && o.dir)) throw new Error('Ikke en planmappe');
      const f = path.join(o.dir, 'resultat.json');
      const arr = readJson(f) || [];
      arr.push(Object.assign({ at: new Date().toISOString() }, o.result || {}));
      fs.writeFileSync(f, JSON.stringify(arr, null, 2) + '\n');
      return { ok: true, count: arr.length };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-youtube-list', async (e, o) => {
    try {
      const acc = parseAccount(o && o.account, 'youtube');
      if (acc.platform !== 'youtube' || !acc.channelUrl) throw new Error('Oppgi YouTube-kanalen som lenke eller @navn');
      const list = await youtubeList(acc.channelUrl, msg => send(e, msg), !!(o && o.refresh));
      return Object.assign({ ok: true }, list, { videos: undefined, oldest: list.videos.find(v => v.date) || null, newest: list.videos.filter(v => v.date).slice(-1)[0] || null });
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-youtube-date', async (e, o) => {
    try { return Object.assign({ ok: true }, await youtubeExactDate(String(o && o.id || ''), msg => send(e, msg))); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-parse-account', (e, o) => parseAccount(o && o.account, o && o.platform));
}

module.exports = { register, _test: { parseAccount, makeWindows, pickVideos, xSearchUrl, planText } };
