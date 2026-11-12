// Faktisk Studio · Bevissikring — profiler og innlegg
//
// Journalisten åpner en profil eller side i sikringsvinduet (logget inn).
// «Finn innlegg» ruller gjennom profilen, åpner «Se mer» underveis og samler
// lenkene til innleggene med dato og et utdrag. Lista lagres og hashes i
// saken (<sak>/_profiler/…), og pluginen sikrer så de valgte innleggene ett
// og ett med bevis-capture. Resultatet logges ved siden av lista, så en
// avbrutt jobb kan fortsettes.
//
//   bevis-profile-scan    rull og finn innlegg i siden som er åpen
//   bevis-profile-stop    stopp skanningen
//   bevis-profile-save    lagre funnlista (liste.json + liste.csv + SHA256SUMS)
//   bevis-profile-lists   tidligere lister med resultater
//   bevis-profile-result  logg resultatet for ett innlegg
//   bevis-expand          åpne «Se mer» / «Vis flere kommentarer» i vinduet
//   bevis-profile-urls    adresser til «Om»-sider for profilinfo
//
// Facebook er hovedmålet, men lenkemønstrene dekker også Instagram, X,
// TikTok og Threads.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const LIST_DIR = '_profiler';
let H = null;
let deps = null;
let stopFlag = false;
let scanning = false;

const pad2 = n => String(n).padStart(2, '0');
const DAY = 86400000;

// ------------------------------------------------------------
//  Skript i siden
// ------------------------------------------------------------
// Lenker som peker på enkeltinnlegg, per nettsted. Returnerer også dato
// (time[datetime] der det finnes, ellers lenketeksten) og et utdrag.
const PAGE_POSTS = `(() => {
  const host = location.hostname.replace(/^(www|m|web|mbasic)\\./, '');
  const P = {
    'facebook.com': /facebook\\.com\\/(?:[^/?#]+\\/(?:posts|videos|photos)\\/[^?#]+|permalink\\.php\\?|story\\.php\\?|reel\\/\\d+|watch\\/?\\?v=|photo\\/?\\?fbid=|groups\\/[^/]+\\/(?:posts|permalink)\\/[^/?#]+|share\\/[pvr]\\/[^/?#]+)/,
    'instagram.com': /instagram\\.com\\/(?:[^/?#]+\\/)?(?:p|reel|tv)\\/[\\w-]+/,
    'x.com': /(?:x|twitter)\\.com\\/[^/?#]+\\/status\\/\\d+/,
    'twitter.com': /(?:x|twitter)\\.com\\/[^/?#]+\\/status\\/\\d+/,
    'tiktok.com': /tiktok\\.com\\/@[^/?#]+\\/(?:video|photo)\\/\\d+/,
    'threads.net': /threads\\.(?:net|com)\\/@[^/?#]+\\/post\\/[\\w-]+/,
    'threads.com': /threads\\.(?:net|com)\\/@[^/?#]+\\/post\\/[\\w-]+/,
  };
  const key = Object.keys(P).find(k => host === k || host.endsWith('.' + k));
  if (!key) return { unsupported: true, host };
  const re = P[key], out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!re.test(href)) continue;
    const art = a.closest('[role="article"], article, [data-pagelet^="TimelineFeedUnit"], [data-testid="tweet"]');
    const t = (art || a).querySelector('time[datetime]') || a.querySelector('time[datetime]');
    const label = ((a.getAttribute('aria-label') || '') + ' ' + (a.innerText || '')).replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.push({ href, dateText: label, datetime: t ? t.getAttribute('datetime') : '',
      snippet: art ? (art.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 280) : '' });
  }
  return { host: key, posts: out, title: document.title, url: location.href };
})()`;

// Klikk «Se mer», «Vis flere kommentarer» o.l. Aldri lenker til andre sider.
function expandScript(rounds, comments) {
  return `(async () => {
    const re = ${comments
      ? '/^(se mer|see more|vis mer|show more|vis flere kommentarer|se flere kommentarer|view more comments|vis tidligere kommentarer|view previous comments|vis flere svar|view more replies|se alle \\d+ svar|vis alle \\d+ svar|view all \\d+ replies|vis \\d+ svar|\\d+ svar|\\d+ replies|\\d+ reply|1 svar)$/i'
      : '/^(se mer|see more|vis mer|show more)$/i'};
    let clicked = 0;
    for (let r = 0; r < ${Math.max(1, Math.min(rounds, 20))}; r++) {
      const btns = Array.from(document.querySelectorAll('[role="button"], button')).filter(b => {
        const t = (b.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 40 || !re.test(t)) return false;
        const a = b.closest('a[href]');
        if (a && !/^javascript:|#$/.test(a.getAttribute('href') || '')) return false;
        const rc = b.getBoundingClientRect();
        return rc.width > 0 && rc.height > 0;
      });
      if (!btns.length) break;
      for (const b of btns.slice(0, 40)) { try { b.click(); clicked++; } catch (e) {} }
      await new Promise(res => setTimeout(res, 1200));
    }
    return clicked;
  })()`;
}

// ------------------------------------------------------------
//  Adresser og datoer
// ------------------------------------------------------------
const KEEP_FB = new Set(['story_fbid', 'id', 'v', 'fbid', 'set']);
function normalizePostUrl(href) {
  let u;
  try { u = new URL(href); } catch (e) { return ''; }
  u.hash = '';
  const host = u.hostname.replace(/^(www|m|web|mbasic)\./, '');
  if (/facebook\.com$/.test(host)) {
    u.hostname = 'www.facebook.com';
    for (const k of Array.from(u.searchParams.keys())) if (!KEEP_FB.has(k)) u.searchParams.delete(k);
  } else {
    u.search = '';
    if (/(x|twitter)\.com$/.test(host)) { u.hostname = 'x.com'; const m = u.pathname.match(/^\/[^/]+\/status\/\d+/); if (m) u.pathname = m[0]; }
    if (/instagram\.com$/.test(host)) { const m = u.pathname.match(/\/(p|reel|tv)\/[\w-]+/); if (m) u.pathname = m[0] + '/'; u.hostname = 'www.instagram.com'; }
  }
  return u.href.replace(/\?$/, '');
}

const MONTHS = {
  jan: 0, januar: 0, january: 0, feb: 1, februar: 1, february: 1, mar: 2, mars: 2, march: 2, apr: 3, april: 3,
  mai: 4, may: 4, jun: 5, juni: 5, june: 5, jul: 6, juli: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  okt: 9, oktober: 9, oct: 9, october: 9, nov: 10, november: 10, des: 11, desember: 11, dec: 11, december: 11,
};
const isoDay = t => { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

// Beste gjetning på dato ut fra Facebook/Instagram-tekster («3 t», «12. okt.»,
// «2. mars 2024», «October 12, 2024», «I går»). Tom streng hvis ukjent.
function parseLooseDate(text, datetime, now) {
  now = now || Date.now();
  if (datetime) { const t = Date.parse(datetime); if (!isNaN(t)) return isoDay(t); }
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (!s) return '';
  if (/\b(i går|yesterday)\b/.test(s)) return isoDay(now - DAY);
  if (/\b(i dag|today|akkurat nå|just now)\b/.test(s)) return isoDay(now);
  let m = s.match(/\b(\d+)\s*(min|m|minutter|minutes?|t|h|timer?|hours?|hrs?)\b/);
  if (m) return isoDay(now);
  m = s.match(/\b(\d+)\s*(d|dager?|days?)\b/); if (m) return isoDay(now - +m[1] * DAY);
  m = s.match(/\b(\d+)\s*(u|uker?|w|weeks?)\b/); if (m) return isoDay(now - +m[1] * 7 * DAY);
  const mk = '(' + Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|') + ')\\b';
  m = s.match(new RegExp('\\b(\\d{1,2})\\.?\\s+' + mk + '\\.?(?:\\s+(\\d{4}))?'));
  let day, mon, year;
  if (m) { day = +m[1]; mon = MONTHS[m[2]]; year = m[3] ? +m[3] : null; }
  else {
    m = s.match(new RegExp('\\b' + mk + '\\.?\\s+(\\d{1,2}),?(?:\\s+(\\d{4}))?'));
    if (m) { mon = MONTHS[m[1]]; day = +m[2]; year = m[3] ? +m[3] : null; }
  }
  if (mon === undefined || !day || day > 31) return '';
  const nowD = new Date(now);
  if (!year) { year = nowD.getFullYear(); if (new Date(year, mon, day).getTime() > now + DAY) year--; }
  return year + '-' + pad2(mon + 1) + '-' + pad2(day);
}

// Om-sider for profilinfo
function profileUrls(raw) {
  let u;
  try { u = new URL(H.normalizeUrl(raw)); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m|web)\./, '');
  const out = { profile: u.href, about: [] };
  if (/facebook\.com$/.test(host)) {
    u.hostname = 'www.facebook.com'; u.hash = '';
    if (u.pathname.startsWith('/profile.php')) {
      const id = u.searchParams.get('id');
      out.profile = 'https://www.facebook.com/profile.php?id=' + id;
      out.about.push({ part: 'om', url: out.profile + '&sk=about' });
      out.about.push({ part: 'sidegjennomsiktighet', url: out.profile + '&sk=about_profile_transparency', optional: true });
    } else {
      const base = 'https://www.facebook.com/' + (u.pathname.split('/').filter(Boolean)[0] || '');
      out.profile = base;
      out.about.push({ part: 'om', url: base + '/about' });
      out.about.push({ part: 'sidegjennomsiktighet', url: base + '/about_profile_transparency', optional: true });
    }
  }
  return out;
}

// ------------------------------------------------------------
//  Skanning
// ------------------------------------------------------------
async function scan(e, o) {
  const progress = (msg, extra) => { try { if (!e.sender.isDestroyed()) e.sender.send('bevis-profile-progress', Object.assign({ msg }, extra || {})); } catch (err) {} };
  const w = H.getWindow();
  if (!w) throw new Error('Åpne profilen i sikringsvinduet først');
  const wc = w.webContents;
  if (wc.isLoading()) await H.waitForLoad(wc, 30000);
  const maxScreens = Math.max(1, Math.min(+o.maxScreens || 150, 1000));
  const until = /^\d{4}-\d{2}-\d{2}$/.test(o.untilDate || '') ? o.untilDate : '';
  const expand = o.expand !== false;
  const startedAt = new Date().toISOString();
  const found = new Map();
  let first = await wc.executeJavaScript(PAGE_POSTS);
  if (first.unsupported) throw new Error('Kjenner ikke igjen innlegg på ' + first.host + ' — åpne en profil på Facebook, Instagram, X, TikTok eller Threads');
  const pageUrl = first.url, pageTitle = first.title, host = first.host;

  const absorb = res => {
    for (const p of res.posts || []) {
      const url = normalizePostUrl(p.href);
      if (!url) continue;
      const cur = found.get(url);
      const date = parseLooseDate(p.dateText, p.datetime);
      if (!cur) found.set(url, { url, dateText: p.dateText, datetime: p.datetime || '', date, snippet: p.snippet, order: found.size });
      else {
        if (!cur.date && date) { cur.date = date; cur.dateText = p.dateText; }
        if (!cur.datetime && p.datetime) cur.datetime = p.datetime;
        if ((p.snippet || '').length > (cur.snippet || '').length) cur.snippet = p.snippet;
      }
    }
  };
  absorb(first);

  await wc.executeJavaScript(H.PAGE_SCROLLER);
  await wc.executeJavaScript('window.__bevisScroller.start()');
  let screens = 0, stoppedBy = 'maks', idle = 0;
  stopFlag = false;
  while (screens < maxScreens) {
    if (stopFlag) { stoppedBy = 'stoppet'; break; }
    if (expand) { try { await wc.executeJavaScript(expandScript(1, false)); } catch (err) {} }
    absorb(await wc.executeJavaScript(PAGE_POSTS));
    progress('Ruller … ' + found.size + ' innlegg funnet', { count: found.size, screens });
    if (until) {
      const dated = Array.from(found.values()).sort((a, b) => a.order - b.order).filter(p => p.date).slice(-3);
      if (dated.length === 3 && dated.every(p => p.date < until)) { stoppedBy = 'dato'; break; }
    }
    let info = await wc.executeJavaScript('window.__bevisScroller.step()');
    screens++;
    // Ujevnt tempo — faste intervaller ser ut som en robot
    await H.wait(H.settings && H.settings.pace === 'normal' ? 700 + Math.random() * 900 : 1400 + Math.random() * 2600);
    if (!info.moved) {
      // Venter på at mer lastes inn (uendelig rulling)
      await H.wait(2000);
      info = await wc.executeJavaScript('window.__bevisScroller.step()');
      if (!info.moved) { if (++idle >= 2) { stoppedBy = 'slutt'; break; } } else idle = 0;
    } else idle = 0;
  }
  absorb(await wc.executeJavaScript(PAGE_POSTS));
  const posts = Array.from(found.values()).sort((a, b) => a.order - b.order).map((p, i) => ({
    index: i, url: p.url, date: p.date, dateText: p.dateText, datetime: p.datetime, snippet: p.snippet,
    beforeUntil: !!(until && p.date && p.date < until),
  }));
  return { ok: true, host, pageUrl, pageTitle, startedAt, finishedAt: new Date().toISOString(), screens, stoppedBy, maxScreens, untilDate: until, posts };
}

// ------------------------------------------------------------
//  Lagring av lister
// ------------------------------------------------------------
function csvCell(s) { s = String(s == null ? '' : s); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function saveList(root, caseName, scanRes, extra) {
  if (!root || !fs.existsSync(root)) throw new Error(root ? 'Arkivmappa er ikke tilgjengelig (låst kryptert arkiv?)' : 'Velg arkivmappe først');
  const caseDir = path.join(root, H.safeName(caseName) || 'Uten sak');
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  const desc = H.describeUrl(scanRes.pageUrl);
  const name = [stamp, H.slug(desc.platform, 24), H.slug(desc.handle, 40)].filter(Boolean).join('_');
  let dir = path.join(caseDir, LIST_DIR, name), i = 2;
  while (fs.existsSync(dir)) dir = path.join(caseDir, LIST_DIR, name + '-' + i++);
  fs.mkdirSync(dir, { recursive: true });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const list = Object.assign({
    format: 'faktisk-profilliste', version: 1, id: crypto.randomBytes(6).toString('hex'),
    case: caseName, createdAt: d.toISOString(), createdAtLocal: d.toLocaleString('nb-NO', { timeZone: tz }) + ' (' + tz + ')',
    createdBy: (() => { try { return require('os').userInfo().username; } catch (err) { return ''; } })(),
    studioVersion: deps.app.getVersion(), platform: desc.platform, account: desc.handle,
    note: 'Datoer er tolket fra teksten på siden og kan være omtrentlige. Rekkefølgen er slik innleggene dukket opp under rullingen.',
  }, extra || {}, { scan: scanRes });
  fs.writeFileSync(path.join(dir, 'liste.json'), JSON.stringify(list, null, 2) + '\n');
  const rows = [['nr', 'dato', 'dato_tekst', 'lenke', 'utdrag'].join(';')];
  for (const p of scanRes.posts) rows.push([p.index + 1, p.date, p.dateText, p.url, p.snippet].map(csvCell).join(';'));
  fs.writeFileSync(path.join(dir, 'liste.csv'), '\ufeff' + rows.join('\n') + '\n');
  const sums = [];
  for (const f of ['liste.csv', 'liste.json']) sums.push((await H.sha256File(path.join(dir, f))) + '  ' + f);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  return { dir, list };
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function listLists(root) {
  const out = [];
  let cases = [];
  try { cases = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')); } catch (e) { return out; }
  for (const c of cases) {
    const ldir = path.join(root, c.name, LIST_DIR);
    let ents = [];
    try { ents = fs.readdirSync(ldir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const dir = path.join(ldir, e.name);
      const list = readJson(path.join(dir, 'liste.json'));
      if (!list || list.format !== 'faktisk-profilliste') continue;
      out.push({ dir, case: c.name, list, results: readJson(path.join(dir, 'resultat.json')) || [] });
    }
  }
  out.sort((a, b) => String(b.list.createdAt).localeCompare(String(a.list.createdAt)));
  return out;
}
function insideListDir(dir) {
  const l = readJson(path.join(dir || '', 'liste.json'));
  return !!(l && l.format === 'faktisk-profilliste' && path.basename(path.dirname(dir)) === LIST_DIR);
}

// ------------------------------------------------------------
//  Registrering
// ------------------------------------------------------------
function register(ipcMain, d) {
  deps = d;
  H = require('./bevis-main.js')._internal;

  ipcMain.handle('bevis-profile-scan', async (e, o) => {
    if (scanning) return { ok: false, error: 'En skanning pågår allerede' };
    scanning = true;
    try { return await scan(e, o || {}); }
    catch (err) { return { ok: false, error: err.message }; }
    finally { scanning = false; stopFlag = false; }
  });
  ipcMain.handle('bevis-profile-stop', () => { stopFlag = true; return { ok: true }; });

  ipcMain.handle('bevis-profile-save', async (e, o) => {
    try {
      if (!o || !o.root || !o.scan || !Array.isArray(o.scan.posts)) throw new Error('Mangler skanning');
      const r = await saveList(o.root, String(o.caseName || '').trim() || 'Uten sak', o.scan, { pluginVersion: o.pluginVersion || null });
      return { ok: true, dir: r.dir, list: r.list };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-profile-lists', (e, o) => {
    try { return { ok: true, lists: listLists(o && o.root) }; } catch (err) { return { ok: false, error: err.message, lists: [] }; }
  });

  ipcMain.handle('bevis-profile-result', (e, o) => {
    try {
      if (!insideListDir(o && o.dir)) throw new Error('Ikke en profilliste');
      const f = path.join(o.dir, 'resultat.json');
      const arr = readJson(f) || [];
      arr.push(Object.assign({ at: new Date().toISOString() }, o.result || {}));
      fs.writeFileSync(f, JSON.stringify(arr, null, 2) + '\n');
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-expand', async (e, o) => {
    const w = H.getWindow();
    if (!w) return { ok: false, error: 'Ingen side åpen' };
    try {
      const clicked = await w.webContents.executeJavaScript(expandScript(Math.max(1, Math.min(+(o && o.rounds) || 6, 20)), !(o && o.comments === false)));
      return { ok: true, clicked };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bevis-profile-urls', (e, o) => {
    const r = profileUrls(o && o.url);
    return r ? Object.assign({ ok: true }, r) : { ok: false, error: 'Ugyldig adresse' };
  });
}

module.exports = { register, _test: { normalizePostUrl, parseLooseDate, profileUrls: u => { H = H || require('./bevis-main.js')._internal; return profileUrls(u); }, PAGE_POSTS, expandScript } };
