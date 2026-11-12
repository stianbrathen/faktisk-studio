// Faktisk Studio · Bevissikring — «Vis sikringen»
//
// Åpner én sikring i et eget vindu med oversikt over alt som ble lagret:
// siden slik den så ut (rullebildene etter hverandre), hele siden, video og
// bilder, PDF, tekst og fakta fra manifestet (tid, navn, fingeravtrykk,
// tidsstempel). Nettarkivet (MHTML) åpnes i et eget vindu.
//
// Alt vises fra disk. Vinduene bruker en egen økt der ALL nettrafikk stoppes,
// så det arkiverte innholdet aldri kan kontakte nettsteder eller sporere.
// Visningssiden skrives til en midlertidig fil (ikke i sikringsmappa, der den
// ville blitt en «ekstra» fil) og slettes når vinduet lukkes.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { BrowserWindow, session, shell } = require('electron');

const PARTITION = 'bevis-visning';
let sessionReady = false;

function viewSession() {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    ses.webRequest.onBeforeRequest((d, cb) => {
      const u = d.url || '';
      cb({ cancel: !(u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('devtools:') || u.startsWith('chrome-extension:')) });
    });
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  }
  return ses;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileHref = (dir, rel) => pathToFileURL(path.join(dir, rel)).href;
const act = (kind, rel) => 'bevisview://' + kind + '?f=' + encodeURIComponent(rel);

function fmtBytes(b) {
  if (!b) return '0 kB';
  if (b > 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1).replace('.', ',') + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' kB';
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

function buildPage(dir, m, verify) {
  const files = (m.files || []).map(f => f.path);
  const has = rel => files.includes(rel);
  const scroll = files.filter(f => /^skjermbilder\/rulling-\d+\.png$/.test(f)).sort();
  const full = ['skjermbilde-hele-siden.png', 'utsnitt.png', 'skjermbilde-chrome.png', 'skjermbilde.png'].filter(has);
  const videos = files.filter(f => /^(media|import)\/.+\.(mp4|m4v|mov|webm|mkv|3gp)$/i.test(f));
  const audio = files.filter(f => /^(media|import)\/.+\.(m4a|mp3|ogg|opus|wav|aac|flac)$/i.test(f));
  const mediaImgs = files.filter(f => /^(media|import)\/.+\.(jpe?g|png|webp|gif|heic|heif|tiff?|bmp)$/i.test(f));
  const idx = (() => { try { return require('./bevis-index.js').readIndex(dir); } catch (e) { return null; } })() || {};
  const iparts = idx.parts || [];
  const speech = iparts.filter(p => p.src === 'tale');
  const ocrParts = iparts.filter(p => p.src === 'ocr');
  const imp = m.import && Array.isArray(m.import.files) ? m.import.files : [];
  const pageImgs = files.filter(f => /^bilder\/.+\.(jpe?g|png|webp|gif|avif)$/i.test(f));
  const mhtml = files.find(f => /\.mhtml$/i.test(f));
  const pdf = files.find(f => /\.pdf$/i.test(f));
  let text = '';
  if (has('tekst.txt')) { try { text = fs.readFileSync(path.join(dir, 'tekst.txt'), 'utf8'); } catch (e) {} }
  const textCut = text.length > 1500000;
  if (textCut) text = text.slice(0, 1500000);
  const stamp = readJson(path.join(dir, 'tidsstempel.json'));
  const src = m.source || {};
  const info = (m.media && m.media.info) || null;

  const tabs = [];
  if (scroll.length) tabs.push(['rulling', 'Slik siden så ut', scroll.length + ' skjermer']);
  if (full.length) tabs.push(['hele', full[0] === 'utsnitt.png' ? 'Utsnitt' : 'Hele siden', '']);
  if (videos.length || audio.length || mediaImgs.length) tabs.push(['media', imp.length ? 'Importerte filer' : 'Video og bilder', String(videos.length + audio.length + mediaImgs.length)]);
  if (speech.length) tabs.push(['tale', 'Tale', String(speech.length)]);
  if (ocrParts.length) tabs.push(['ocr', 'Tekst i bilder', String(ocrParts.length)]);
  if (pageImgs.length) tabs.push(['bilder', 'Bilder fra siden', String(pageImgs.length)]);
  if (text) tabs.push(['tekst', 'Tekst', '']);
  tabs.push(['fakta', 'Fakta og kontroll', '']);

  const img = rel => (idx.previews && idx.previews[rel] && /^data:image\/jpeg;base64,/.test(idx.previews[rel]))
    ? '<img src="' + esc(idx.previews[rel]) + '" alt="" loading="lazy" title="Forhåndsvisning — åpne originalen for full kvalitet">'
    : '<img src="' + esc(fileHref(dir, rel)) + '" alt="" loading="lazy">';
  const fmtT = t => { t = Math.max(0, Math.round(+t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const impInfo = rel => { const f = imp.find(x => x.path === rel); if (!f) return ''; return '<div class="impmeta">Original: ' + esc(f.originalName) + (f.recorded ? ' · tatt ' + esc(fmtTime(f.recorded)) + ' <span class="mut">(' + esc(f.recordedSource) + ')</span>' : ' · <span class="mut">ukjent opptakstid</span>') + (f.device ? ' · ' + esc(f.device) : '') + '</div>'; };
  const fileLinks = rel => '<span class="fl"><a href="' + esc(act('open', rel)) + '">Åpne</a> · <a href="' + esc(act('reveal', rel)) + '">Vis i Finder</a></span>';

  const panels = {};
  panels.rulling = '<p class="hint">Rullebildene i rekkefølge — det journalisten så på skjermen, skjerm for skjerm. Overlapp mellom bildene er normalt.</p>' +
    scroll.map((f, i) => '<figure class="shot"><figcaption>Skjerm ' + (i + 1) + ' av ' + scroll.length + fileLinks(f) + '</figcaption>' + img(f) + '</figure>').join('');
  panels.hele = full.map(f => '<figure class="shot"><figcaption>' + esc(f) + fileLinks(f) + '</figcaption>' + img(f) + '</figure>').join('');
  panels.media = videos.map(f => '<figure class="shot" id="v-' + esc(f) + '"><figcaption>' + esc(path.basename(f)) + fileLinks(f) + '</figcaption>' + impInfo(f) + '<video controls preload="metadata" src="' + esc(fileHref(dir, f)) + '"></video></figure>').join('') +
    audio.map(f => '<figure class="shot"><figcaption>' + esc(path.basename(f)) + fileLinks(f) + '</figcaption>' + impInfo(f) + '<audio controls src="' + esc(fileHref(dir, f)) + '"></audio></figure>').join('') +
    (imp.length ? mediaImgs.map(f => '<figure class="shot"><figcaption>' + esc(path.basename(f)) + fileLinks(f) + '</figcaption>' + impInfo(f) + img(f) + '</figure>').join('')
      : (mediaImgs.length ? '<div class="grid">' + mediaImgs.map(f => '<figure><a href="' + esc(act('open', f)) + '">' + img(f) + '</a><figcaption>' + esc(path.basename(f)) + '</figcaption></figure>').join('') + '</div>' : ''));
  const byFile = list => { const g = {}; for (const p of list) (g[p.file] = g[p.file] || []).push(p); return g; };
  panels.tale = '<p class="hint">Transkribert automatisk — sjekk mot opptaket før sitat. Klikk tidskoden for å spille av derfra.</p>' +
    Object.entries(byFile(speech)).map(([file, ps]) => '<h3>' + esc(path.basename(file)) + '</h3><table class="tale">' + ps.sort((a, b) => a.t - b.t).map(p => '<tr><td><a href="#" class="tc" data-f="' + esc(file) + '" data-t="' + p.t + '">' + fmtT(p.t) + '</a></td><td class="sel">' + esc(p.text) + '</td></tr>').join('') + '</table>').join('');
  panels.ocr = '<p class="hint">Tekst lest automatisk i bilder og nøkkelbilder fra video (Apple Vision). Kan inneholde feil.</p>' +
    Object.entries(byFile(ocrParts)).map(([file, ps]) => '<h3>' + esc(path.basename(file)) + '</h3>' + ps.map(p => (p.t != null ? '<div class="mut">' + fmtT(p.t) + '</div>' : '') + '<pre class="txt">' + esc(p.text) + '</pre>').join('')).join('');
  panels.bilder = '<div class="grid">' + pageImgs.map(f => '<figure><a href="' + esc(act('open', f)) + '">' + img(f) + '</a><figcaption>' + esc(path.basename(f)) + '</figcaption></figure>').join('') + '</div>';
  panels.tekst = '<p class="hint">All tekst fra siden, samlet mens den ble rullet.' + (textCut ? ' Vist avkortet — hele teksten ligger i tekst.txt.' : '') + fileLinks('tekst.txt') + '</p><pre class="txt">' + esc(text) + '</pre>';

  const v = verify || {};
  const verdict = v.error ? '<div class="vd bad">' + esc(v.error) + '</div>'
    : v.ok ? '<div class="vd ok">✓ Uendret — alle ' + v.checked + ' filer stemmer med sjekksummene' + (v.stamp && v.stamp.ok ? ', og tidsstempelet bekrefter at de fantes ' + esc(fmtTime(v.stamp.genTime)) : '') + '.</div>'
    : '<div class="vd bad">✗ Stemmer ikke med sikringen' + (v.changed && v.changed.length ? '<br>Endret: ' + esc(v.changed.join(', ')) : '') + (v.missing && v.missing.length ? '<br>Mangler: ' + esc(v.missing.join(', ')) : '') + (v.stamp && !v.stamp.ok && !v.stamp.missing ? '<br>' + esc(v.stamp.error || 'Tidsstempelet stemmer ikke') : '') + '</div>';
  const row = (k, val) => val ? '<tr><th>' + esc(k) + '</th><td>' + val + '</td></tr>' : '';
  panels.fakta = verdict + '<table class="facts">' +
    row('Sak', esc(m.case)) +
    row('Sikret', esc(m.capturedAtLocal || fmtTime(m.capturedAt)) + '<br><span class="mut">' + esc(m.capturedAt) + ' (UTC)</span>') +
    row('Av', esc([m.capturedByName, m.capturedBy ? '(' + m.capturedBy + ' på ' + (m.machine || '') + ')' : ''].filter(Boolean).join(' '))) +
    row('Konto', m.loginAccount ? esc(m.loginAccount) + ' <span class="mut">(innlogget i sikringsvinduet)</span>' : (m.kind === 'chrome' ? '<span class="mut">brukerens egen Chrome</span>' : '')) +
    row('Adresse', '<span class="sel">' + esc(src.finalUrl || src.requestedUrl) + '</span>') +
    row('Oppgitt adresse', src.requestedUrl && src.requestedUrl !== src.finalUrl ? '<span class="sel">' + esc(src.requestedUrl) + '</span>' : '') +
    row('Tittel', esc(src.title)) +
    row('Plattform', esc([src.platform, src.handle].filter(Boolean).join(' · '))) +
    row('Opplaster', info ? esc([info.uploader, info.uploadDate].filter(Boolean).join(' · ')) : '') +
    row('Notat', esc(m.note)) +
    row('Importert fra', imp.length ? esc((m.import.importedFrom || []).join(', ')) + '<br><span class="mut">Opptakstid kommer fra filene selv og kan ikke bekreftes av Studio</span>' : '') +
    row('Tidsstempel', stamp ? esc(fmtTime(stamp.genTime)) + ' <span class="mut">fra ' + esc(stamp.tsa) + ' (RFC 3161)</span>' : '<span class="mut">ingen</span>') +
    row('Fingeravtrykk', '<code class="sel">' + esc(v.fingerprint || '') + '</code><br><span class="mut">SHA-256 av SHA256SUMS.txt</span>') +
    row('Nettleser', esc(m.browser && m.browser.userAgent)) +
    row('Verktøy', esc([m.tool && m.tool.name, m.tool && m.tool.studioVersion ? 'Studio ' + m.tool.studioVersion : '', m.tool && m.tool.pluginVersion ? 'plugin ' + m.tool.pluginVersion : ''].filter(Boolean).join(' · '))) +
    row('Wayback', m.wayback && m.wayback.archivedUrl ? '<span class="sel">' + esc(m.wayback.archivedUrl) + '</span>' : '') +
    '</table>' +
    ((m.warnings || []).length ? '<h3>Merknader</h3><ul class="warn">' + m.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
    '<h3>Filer (' + files.length + ')</h3><table class="files">' + (m.files || []).map(f => '<tr><td>' + esc(f.path) + '</td><td class="num">' + fmtBytes(f.bytes) + '</td><td><code>' + esc(String(f.sha256).slice(0, 16)) + '…</code></td><td>' + fileLinks(f.path) + '</td></tr>').join('') + '</table>' +
    '<p class="hint">Kontroll uten Studio: åpne Terminal i mappa og kjør <code>shasum -a 256 -c SHA256SUMS.txt</code>.</p>';

  const first = tabs[0][0];
  const title = src.title || src.finalUrl || 'Sikring';
  return `<!doctype html>
<html lang="no"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(title)} · Sikring</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; background: #1e1e1e; color: #eee; }
header { position: sticky; top: 0; z-index: 3; background: #2a2a2a; border-bottom: 1px solid #3a3a3a; padding: 12px 18px 0; }
.top { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
h1 { font-size: 17px; margin: 0; flex: 1 1 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: #aaa; font-size: 12.5px; margin: 4px 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { background: #0050FF; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 7px; border-radius: 4px; margin-right: 6px; }
.badge.ok { background: #1E7A46; } .badge.bad { background: #C0392B; }
nav { display: flex; gap: 2px; flex-wrap: wrap; }
nav button { background: none; border: 0; color: #bbb; font: inherit; font-weight: 600; padding: 8px 12px; border-bottom: 3px solid transparent; cursor: pointer; }
nav button.on { color: #fff; border-bottom-color: #0050FF; }
nav button small { color: #888; font-weight: 400; margin-left: 4px; }
.btn { background: #0050FF; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn.light { background: #444; }
main { padding: 18px; max-width: 1500px; margin: 0 auto; }
section { display: none; } section.on { display: block; }
.hint { color: #aaa; font-size: 13px; margin: 0 0 14px; }
.shot { margin: 0 0 18px; }
.shot figcaption { font-size: 12px; color: #999; margin-bottom: 4px; display: flex; justify-content: space-between; }
.shot img, .shot video { display: block; max-width: 100%; margin: 0 auto; border: 1px solid #333; background: #fff; }
.shot video { background: #000; max-height: 80vh; }
.fl { color: #777; margin-left: 10px; font-size: 12px; }
a { color: #7EA8FF; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.grid figure { margin: 0; } .grid img { width: 100%; height: 200px; object-fit: contain; background: #111; border: 1px solid #333; }
.grid figcaption { font-size: 11px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.txt { white-space: pre-wrap; word-break: break-word; background: #151515; border: 1px solid #333; padding: 14px; border-radius: 6px; font: 13px/1.5 ui-monospace, Menlo, monospace; user-select: text; }
.facts, .files { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
.facts th { text-align: left; color: #999; font-weight: 600; width: 160px; vertical-align: top; padding: 6px 10px 6px 0; }
.facts td, .files td { padding: 6px 10px 6px 0; vertical-align: top; border-top: 1px solid #2f2f2f; word-break: break-all; }
.files td.num { white-space: nowrap; color: #aaa; }
.mut { color: #888; } code { font: 12px ui-monospace, Menlo, monospace; }
.sel { user-select: text; }
.vd { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-weight: 600; }
.vd.ok { background: rgba(30,158,90,.22); } .vd.bad { background: rgba(192,57,43,.35); }
.warn li { color: #FFD479; }
.impmeta { font-size: 12px; color: #bbb; margin: 0 0 6px; }
.tale { border-collapse: collapse; width: 100%; margin-bottom: 14px; }
.tale td { padding: 4px 10px 4px 0; vertical-align: top; border-top: 1px solid #2f2f2f; }
.tale td:first-child { width: 60px; white-space: nowrap; }
h3 { font-size: 14px; margin: 18px 0 8px; }
</style></head>
<body>
<header>
  <div class="top">
    <h1>${esc(title)}</h1>
    ${mhtml ? '<a class="btn" href="' + esc(act('mhtml', mhtml)) + '" title="Åpner nettarkivet uten nett — lenker og knapper virker ikke">Åpne nettarkivet</a>' : ''}
    ${pdf ? '<a class="btn light" href="' + esc(act('open', pdf)) + '" title="Åpner PDF-en i Forhåndsvisning">PDF</a>' : ''}
    <a class="btn light" href="${esc(act('reveal', 'manifest.json'))}">Vis i Finder</a>
  </div>
  <div class="meta">
    <span class="badge ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Uendret' : 'Kontroller'}</span>${stamp ? '<span class="badge ok">Tidsstemplet</span>' : ''}
    ${esc(m.capturedAtLocal || fmtTime(m.capturedAt))}${m.capturedByName ? ' · ' + esc(m.capturedByName) : ''} · ${esc(m.case)} · <span class="sel">${esc(src.finalUrl || src.requestedUrl || '')}</span>
  </div>
  <nav>${tabs.map(t => '<button data-t="' + t[0] + '"' + (t[0] === first ? ' class="on"' : '') + '>' + esc(t[1]) + (t[2] ? '<small>' + esc(t[2]) + '</small>' : '') + '</button>').join('')}</nav>
</header>
<main>${tabs.map(t => '<section id="p-' + t[0] + '"' + (t[0] === first ? ' class="on"' : '') + '>' + (panels[t[0]] || '') + '</section>').join('')}</main>
<script>
// Handlinger (åpne fil, Finder, nettarkiv) sendes til Studio via konsollen —
// vinduet har ingen preload og ingen nettilgang
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="bevisview://"]'); if (!a) return;
  e.preventDefault();
  console.log('BEVISVIEW ' + a.getAttribute('href'));
});
function showTab(t) {
  const b = document.querySelector('nav button[data-t="' + t + '"]'); if (!b) return false;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach(s => s.classList.toggle('on', s.id === 'p-' + t));
  window.scrollTo(0, 0);
  return true;
}
document.querySelector('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.t); });
// Tidskode i talen: spill av videoen fra der
document.addEventListener('click', e => {
  const a = e.target.closest('a.tc'); if (!a) return;
  e.preventDefault();
  const fig = document.getElementById('v-' + a.dataset.f);
  if (!fig || !showTab('media')) return;
  const v = fig.querySelector('video'); fig.scrollIntoView();
  if (v) { v.currentTime = +a.dataset.t; v.play().catch(() => {}); }
});
if (location.hash) showTab(location.hash.slice(1));
</script>
</body></html>`;
}

function insideDir(dir, rel) {
  const full = path.resolve(dir, rel);
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

function openMhtml(dir, rel, title) {
  const full = insideDir(dir, rel);
  if (!full || !fs.existsSync(full)) return;
  const w = new BrowserWindow({
    width: 1280, height: 900, title: 'Nettarkiv · ' + title,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, javascript: false },
  });
  viewSession();
  w.on('page-title-updated', e => e.preventDefault());
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.loadURL(pathToFileURL(full).href).catch(() => {});
}

async function openView(dir, verifyFn, tab) {
  const m = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (e) { return null; } })();
  if (!m || m.format !== 'faktisk-bevissikring') throw new Error('Ikke en sikringsmappe');
  let verify = null;
  try { verify = await verifyFn(dir); } catch (e) { verify = { error: e.message }; }
  const html = buildPage(dir, m, verify);
  const tmp = path.join(os.tmpdir(), 'faktisk-sikring-' + crypto.randomBytes(6).toString('hex') + '.html');
  fs.writeFileSync(tmp, html);
  const title = (m.source && (m.source.title || m.source.finalUrl)) || 'Sikring';
  const w = new BrowserWindow({
    width: 1320, height: 920, title: title + ' · Sikring', backgroundColor: '#1e1e1e',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
  });
  viewSession();
  const handle = url => {
    if (!url.startsWith('bevisview://')) return false;
    const u = new URL(url);
    const rel = u.searchParams.get('f') || '';
    const full = insideDir(dir, rel);
    if (!full) return true;
    if (u.hostname === 'open') shell.openPath(full);
    else if (u.hostname === 'reveal') shell.showItemInFolder(full);
    else if (u.hostname === 'mhtml') openMhtml(dir, rel, title);
    return true;
  };
  w.webContents.on('console-message', (e, level, msg) => { if (typeof msg === 'string' && msg.startsWith('BEVISVIEW ')) handle(msg.slice(10)); });
  w.webContents.on('will-navigate', (e, url) => { e.preventDefault(); handle(url); });
  w.webContents.setWindowOpenHandler(({ url }) => { handle(url); return { action: 'deny' }; });
  w.on('closed', () => { try { fs.unlinkSync(tmp); } catch (e) {} });
  await w.loadURL(pathToFileURL(tmp).href + (/^[a-z]+$/.test(tab || '') ? '#' + tab : ''));
  return { ok: true };
}

function register(ipcMain) {
  const H = require('./bevis-main.js');
  ipcMain.handle('bevis-view', async (e, o) => {
    try { return await openView(String(o && o.dir || ''), d => H._test.verifyFolder(d), o && o.tab); }
    catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { register, _test: { buildPage, openView } };
