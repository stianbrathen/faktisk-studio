// Faktisk Studio · Bevissikring 0.1
//
// Sikrer nettsider og SoMe-innlegg systematisk: siden åpnes i et eget vindu
// (egen varig innlogging), journalisten ruller og åpner kommentarer, og
// «Sikre siden» lagrer skjermbilder, PDF, MHTML/HTML, tekst, bilder og video
// (yt-dlp) i én mappe per sikring, med manifest.json og SHA256SUMS.txt.
// Det tunge arbeidet gjøres i Studio (src/bevis-main.js).
//
// Mappestruktur:  <arkiv>/<sak>/<ÅÅÅÅ-MM-DD_TTMMSS>_<plattform>_<navn>/

const PLUGIN_ID = 'bevissikring';
const $ = id => document.getElementById(id);
const api = window.faktisk;
const hasApi = typeof api.bevisCapture === 'function';

const els = {
  caseInput: $('caseInput'), caseList: $('caseList'), urlInput: $('urlInput'), openBtn: $('openBtn'),
  winText: $('winText'), winInfo: $('winInfo'), focusBtn: $('focusBtn'), noteInput: $('noteInput'),
  captureBtn: $('captureBtn'), regionBtn: $('regionBtn'), status: $('status'),
  rootText: $('rootText'), pickRootBtn: $('pickRootBtn'), revealRootBtn: $('revealRootBtn'),
  toolInfo: $('toolInfo'), updateToolsBtn: $('updateToolsBtn'), logoutBtn: $('logoutBtn'),
  search: $('searchInput'), caseFilter: $('caseFilter'), count: $('countInfo'), list: $('list'), empty: $('emptyState'),
  waybackHint: $('waybackHint'),
};
const optBoxes = Array.from(document.querySelectorAll('[data-opt]'));

const state = {
  root: '', items: [], cases: [], busy: false, pluginVersion: '',
  ui: { q: '', caseFilter: '' }, verify: {}, highlight: '',
};

// ============================================================
//  Hjelpere
// ============================================================
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setStatus(msg, kind) {
  els.status.textContent = msg || '';
  els.status.className = 'plugin-sidebar__status' + (kind ? ' bv-status--' + kind : '');
}
function fmtSize(b) {
  if (!b) return '0 kB';
  if (b > 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1).replace('.', ',') + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' kB';
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }) + ' kl. ' +
    d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fileUrl(p) {
  return 'file://' + String(p).split('/').map(encodeURIComponent).join('/');
}
function shortHash(h) { return h ? h.slice(0, 10) + '…' + h.slice(-6) : ''; }
const PLATFORM_LABEL = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', x: 'X', tiktok: 'TikTok', youtube: 'YouTube',
  import: 'Import', telegram: 'Telegram', linkedin: 'LinkedIn', reddit: 'Reddit', snapchat: 'Snapchat', vk: 'VK', bluesky: 'Bluesky',
};
function options() {
  const o = {};
  optBoxes.forEach(b => { o[b.dataset.opt] = b.checked; });
  return o;
}
function setBusy(b) {
  if (!b && window.bvSampleRunning && window.bvSampleRunning()) return;
  if (!b && window.bvProfileRunning && window.bvProfileRunning()) return;
  if (!b && window.bvListRunning && window.bvListRunning()) return;
  state.busy = b;
  els.captureBtn.disabled = b; els.regionBtn.disabled = b; els.openBtn.disabled = b;
  const vb = document.getElementById('videoBtn'); if (vb) vb.disabled = b;
  els.captureBtn.textContent = b ? 'Sikrer …' : 'Sikre siden';
}

// ============================================================
//  Lagring av innstillinger
// ============================================================
let saveTimer = null;
function scheduleSaveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.stateSave(PLUGIN_ID, {
      root: state.root, caseName: els.caseInput.value, url: els.urlInput.value,
      options: options(), ui: state.ui,
      sample: window.bvSampleState ? window.bvSampleState() : undefined,
      profile: window.bvProfileState ? window.bvProfileState() : undefined,
      list: window.bvListState ? window.bvListState() : undefined,
    }).catch(() => {});
  }, 400);
}

// ============================================================
//  Vinduet
// ============================================================
function renderWindow(s) {
  const open = s && s.open;
  els.winInfo.classList.toggle('is-open', !!open);
  els.focusBtn.hidden = !open;
  if (!open) { els.winText.textContent = 'Ingen side åpen'; els.winText.title = ''; return; }
  els.winText.textContent = (s.loading ? 'Laster … ' : '') + (s.title || s.url || '');
  els.winText.title = s.url || '';
}

async function openPage() {
  const url = els.urlInput.value.trim();
  if (!url) { setStatus('Lim inn en adresse først', 'err'); els.urlInput.focus(); return; }
  const r = await api.bevisOpen({ url });
  if (r.cancelled) setStatus('Avbrutt');
  else if (!r.ok || !r.url) setStatus('Ugyldig adresse', 'err');
  else { setStatus(''); scheduleSaveState(); }
}

// ============================================================
//  Sikring
// ============================================================
async function capture(region) {
  if (state.busy) return;
  if (window.bvRootReady ? !window.bvRootReady() : !state.root) { if (!window.bvRootReady) setStatus('Velg arkivmappe først', 'err'); return; }
  const caseName = els.caseInput.value.trim();
  if (!caseName) { setStatus('Skriv inn en sak — sikringene samles per sak', 'err'); els.caseInput.focus(); return; }
  setBusy(true);
  setStatus(region ? 'Dra over det du vil sikre i vinduet (Esc avbryter) …' : 'Starter …');
  try {
    const payload = { root: state.root, caseName, note: els.noteInput.value.trim(), url: els.urlInput.value.trim(), pluginVersion: state.pluginVersion };
    const r = region ? await api.bevisCaptureRegion(payload) : await api.bevisCapture(Object.assign(payload, { options: options() }));
    if (r.canceled) { setStatus('Utsnitt avbrutt'); return; }
    if (!r.ok) { setStatus('Sikring feilet: ' + (r.error || 'ukjent feil'), 'err'); return; }
    state.highlight = r.dir;
    if (window.bvAutoIndex) window.bvAutoIndex(r.dir);
    const w = (r.warnings || []).length;
    const st = r.stamp ? (r.stamp.ok ? ' · tidsstemplet' : ' · tidsstempel feilet (' + r.stamp.error + ') — prøv igjen fra kortet') : '';
    setStatus('Sikret ' + r.fileCount + ' filer (' + fmtSize(r.bytes) + ')' + st + (w ? ' · ' + w + ' merknad' + (w > 1 ? 'er' : '') + ' — se kortet' : ''), w || (r.stamp && !r.stamp.ok) ? 'warn' : 'ok');
    els.noteInput.value = '';
    await refresh();
    const card = els.list.querySelector('.is-new');
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    setStatus('Sikring feilet: ' + err.message, 'err');
  } finally {
    setBusy(false);
    refreshTools();
  }
}

// ============================================================
//  Liste
// ============================================================
async function refresh() {
  if (!state.root) { state.items = []; state.cases = []; render(); return; }
  const r = await api.bevisList({ root: state.root });
  state.items = r.items || [];
  state.cases = r.cases || [];
  els.caseList.innerHTML = state.cases.map(c => '<option value="' + esc(c) + '">').join('');
  const cur = state.ui.caseFilter;
  els.caseFilter.innerHTML = '<option value="">Alle saker</option>' +
    state.cases.map(c => '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  if (cur && !state.cases.includes(cur)) state.ui.caseFilter = '';
  render();
}

function visibleItems() {
  const words = state.ui.q.toLowerCase().split(/\s+/).filter(Boolean);
  return state.items.filter(it => {
    if (state.ui.caseFilter && it.case !== state.ui.caseFilter) return false;
    if (!words.length) return true;
    const hay = [it.title, it.url, it.requestedUrl, it.note, it.case, it.platform, it.folderName, it.fingerprint, it.sample ? 'stikkprøve ' + it.sample.from + ' ' + it.sample.account : ''].join(' ').toLowerCase();
    return words.every(w => hay.includes(w)) || !!(window.bvHitMatch && window.bvHitMatch(it));
  });
}

function verifyHtml(v) {
  if (!v) return '';
  if (v.running) return '<div class="bv-verify">Kontrollerer …</div>';
  if (v.error) return '<div class="bv-verify bv-verify--bad">' + esc(v.error) + '</div>';
  if (v.ok) {
    return '<div class="bv-verify bv-verify--ok">✓ Uendret — ' + v.checked + ' filer stemmer med sjekksummene' +
      (v.extra && v.extra.length ? '<br><span class="bv-muted">Lagt til senere (ikke med i sikringen): ' + esc(v.extra.join(', ')) + '</span>' : '') + '</div>';
  }
  const parts = [];
  if (v.changed.length) parts.push('Endret: ' + v.changed.join(', '));
  if (v.missing.length) parts.push('Mangler: ' + v.missing.join(', '));
  return '<div class="bv-verify bv-verify--bad">✗ Stemmer ikke med sikringen<br>' + esc(parts.join(' · ')) + '</div>';
}

function render() {
  const items = visibleItems();
  els.count.textContent = items.length === state.items.length ? state.items.length + (state.items.length === 1 ? ' sikring' : ' sikringer') : items.length + ' av ' + state.items.length;
  els.empty.style.display = state.items.length ? 'none' : '';
  els.list.innerHTML = items.map((it, i) => {
    const plat = PLATFORM_LABEL[it.platform] || it.platform || 'Nett';
    const extras = [];
    if (it.media) extras.push(it.media + ' video' + (it.media > 1 ? 'er' : ''));
    if (it.images) extras.push(it.images + ' bilde' + (it.images > 1 ? 'r' : ''));
    const thumb = it.thumb ? '<img src="' + esc(fileUrl(it.thumb)) + '" alt="" loading="lazy">' : '<span class="bv-thumb__none">Ingen bilde</span>';
    return '<article class="bv-card' + (it.dir === state.highlight ? ' is-new' : '') + '" data-i="' + state.items.indexOf(it) + '">' +
      '<button class="bv-thumb" data-act="image" type="button" title="Vis sikringen">' + thumb + '</button>' +
      '<div class="bv-body">' +
        '<div class="bv-top"><span class="bv-badge">' + esc(plat) + '</span>' +
          (it.kind === 'utsnitt' ? '<span class="bv-badge bv-badge--light">Utsnitt</span>' : '') +
          (it.kind === 'video' ? '<span class="bv-badge bv-badge--light">Bare video</span>' : '') +
          (it.kind === 'chrome' ? '<span class="bv-badge bv-badge--chrome">Fra Chrome</span>' : '') +
          (it.tag && it.tag.kind === 'profil' ? '<span class="bv-badge bv-badge--profile">Profil · ' + esc(it.tag.part || '') + '</span>' : '') +
          (it.tag && it.tag.kind === 'innlegg' ? '<span class="bv-badge bv-badge--profile">Innlegg ' + (it.tag.index + 1) + '/' + it.tag.total + (it.tag.date ? ' · ' + esc(it.tag.date) : '') + '</span>' : '') +
          (it.tag && it.tag.kind === 'lenke' ? '<span class="bv-badge bv-badge--list">Liste ' + (it.tag.index + 1) + '/' + it.tag.total + '</span>' : '') +
          (it.tag && it.tag.kind === 'oppfolging' ? '<span class="bv-badge bv-badge--follow" title="' + esc(it.tag.detail || '') + '">Oppfølging · ' + esc(it.tag.status) + '</span>' : '') +
          (it.sample ? '<span class="bv-badge bv-badge--sample" title="Stikkprøve fra plan ' + esc(it.sample.planId) + '">Stikkprøve ' + (it.sample.index + 1) + '/' + it.sample.total + ' · ' + esc(it.sample.from === it.sample.lastDay ? it.sample.from : it.sample.from + ' – ' + it.sample.lastDay) + '</span>' : '') +
          '<span class="bv-case">' + esc(it.case) + '</span>' +
          '<time>' + esc(fmtTime(it.capturedAt)) + '</time></div>' +
        '<h3 class="bv-title">' + esc(it.title || it.url) + '</h3>' +
        '<button class="bv-url" data-act="url" type="button" title="Åpne i nettleseren">' + esc(it.url) + '</button>' +
        (it.note ? '<p class="bv-note">' + esc(it.note) + '</p>' : '') +
        '<div class="bv-meta">' + it.fileCount + ' filer · ' + fmtSize(it.bytes) + (extras.length ? ' · ' + extras.join(' · ') : '') +
          (it.capturedByName || it.capturedBy ? ' · ' + esc(it.capturedByName || it.capturedBy) : '') +
          (it.wayback ? ' · <button class="link-btn bv-inline" data-act="wayback" type="button">Wayback-kopi</button>' : '') + '</div>' +
        '<div class="bv-hash" title="SHA-256 av SHA256SUMS.txt — identifiserer hele sikringen">Fingeravtrykk ' + esc(shortHash(it.fingerprint)) +
          (it.stamp ? ' · <span class="bv-stamped" title="RFC 3161-tidsstempel fra ' + esc(it.stamp.tsa) + '">⏱ tidsstemplet ' + esc(fmtTime(it.stamp.genTime)) + '</span>' : ' · <button class="link-btn bv-inline" data-act="stamp" type="button" title="Hent uavhengig tidsstempel nå (bare sjekksummen sendes)">Tidsstemple</button>') + '</div>' +
        (window.bvWatchHtml ? window.bvWatchHtml(it) : '') +
        (window.bvHitsHtml ? window.bvHitsHtml(it) : '') +
        ((it.warnings || []).length ? '<ul class="bv-warn">' + it.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
        verifyHtml(state.verify[it.dir]) +
        '<div class="bv-cardactions">' +
          '<button class="btn-mini" data-act="view" type="button" title="Alt som ble sikret i ett vindu: siden slik den så ut, video, bilder, tekst og kontroll">Vis sikringen</button>' +
          '<button class="btn-mini btn-mini--light" data-act="finder" type="button">Vis i Finder</button>' +
          '<button class="btn-mini btn-mini--light" data-act="verify" type="button">Kontroller</button>' +
          '<button class="btn-mini btn-mini--light" data-act="copy" type="button" title="Kopier tid, adresse og fingeravtrykk til notater eller kildeliste">Kopier kildeinfo</button>' +
          '<button class="btn-mini btn-mini--light" data-act="reopen" type="button" title="Åpne adressen i sikringsvinduet igjen">Åpne på nytt</button>' +
          (typeof api.bevisDelete === 'function' ? '<button class="btn-mini btn-mini--light bv-del" data-act="delete" type="button" title="Flytt sikringen til Papirkurven">Slett…</button>' : '') +
          (window.bvWatchFor && it.kind !== 'oppfolging' && /^https?:/.test(it.url || '') ? (window.bvWatchFor(it.dir)
            ? '<button class="btn-mini btn-mini--light" data-act="unwatch" type="button">Slutt å følge</button>'
            : '<button class="btn-mini btn-mini--light" data-act="watch" type="button" title="Sjekk adressen hver 24. time mens Studio er åpent, og sikre på nytt hvis innholdet forsvinner eller endres">Følg med</button>') : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }).join('');
}

function sourceInfo(it) {
  return [
    'Sikret: ' + (it.capturedAtLocal || fmtTime(it.capturedAt)) + (it.capturedByName || it.capturedBy ? ' av ' + (it.capturedByName || it.capturedBy) : ''),
    it.stamp ? 'Tidsstempel (RFC 3161): ' + it.stamp.genTime + ' fra ' + it.stamp.tsa : '',
    it.loginAccount ? 'Konto i sikringsvinduet: ' + it.loginAccount : '',
    'Adresse: ' + it.url,
    it.requestedUrl && it.requestedUrl !== it.url ? 'Oppgitt adresse: ' + it.requestedUrl : '',
    it.title ? 'Tittel: ' + it.title : '',
    it.tag && it.tag.kind === 'innlegg' ? 'Innlegg ' + (it.tag.index + 1) + ' av ' + it.tag.total + ' fra profilen ' + (it.tag.profileUrl || '') + (it.tag.date ? ' (dato tolket: ' + it.tag.date + ')' : '') : '',
    it.tag && it.tag.kind === 'lenke' ? 'Lenke ' + (it.tag.index + 1) + ' av ' + it.tag.total + ' fra lenkeliste ' + (it.tag.listId || '') : '',
    it.sample ? 'Stikkprøve: ' + (it.sample.index + 1) + ' av ' + it.sample.total + ', vindu ' + it.sample.from + ' – ' + it.sample.lastDay + ' (plan ' + it.sample.planId + ')' : '',
    'Sak: ' + it.case,
    it.wayback ? 'Wayback: ' + it.wayback : '',
    'Fingeravtrykk (SHA-256 av SHA256SUMS.txt): ' + it.fingerprint,
    'Mappe: ' + it.dir,
  ].filter(Boolean).join('\n');
}

els.list.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.bv-card');
  const it = state.items[+card.dataset.i];
  if (!it) return;
  const act = btn.dataset.act;
  if (window.bvCardAction && await window.bvCardAction(act, it, btn)) return;
  if (act === 'delete') {
    const ok = await window.faktiskDialog.confirm('Slette sikringen «' + (it.title || it.url || it.folderName) + '» (' + it.case + ', ' + fmtTime(it.capturedAt) + ')?\n\nMappa flyttes til Papirkurven og kan hentes tilbake derfra til den tømmes. Slettingen noteres i _slettelogg.txt i saksmappa.', true);
    if (!ok) return;
    const r = await api.bevisDelete({ dir: it.dir });
    if (!r.ok) { setStatus('Kunne ikke slette: ' + r.error, 'err'); return; }
    setStatus('Flyttet til Papirkurven', 'ok');
    await refresh();
    return;
  }
  if (act === 'finder') api.bevisOpenPath({ path: it.dir + '/manifest.json', reveal: true });
  else if (act === 'image' || act === 'view' || act === 'hit') {
    if (typeof api.bevisView === 'function') { const r = await api.bevisView({ dir: it.dir, tab: act === 'hit' ? btn.dataset.tab : '' }); if (!r.ok) setStatus('Kunne ikke vise: ' + r.error, 'err'); }
    else if (it.mainImage) api.bevisOpenPath({ path: it.dir + '/' + it.mainImage });
  }
  else if (act === 'url') api.openExternal(it.url);
  else if (act === 'wayback') api.openExternal(it.wayback);
  else if (act === 'reopen') { els.urlInput.value = it.url; els.caseInput.value = it.case; openPage(); }
  else if (act === 'copy') {
    await api.copyToClipboard(sourceInfo(it));
    btn.textContent = 'Kopiert ✓';
    setTimeout(() => { btn.textContent = 'Kopier kildeinfo'; }, 2000);
  } else if (act === 'verify') {
    state.verify[it.dir] = { running: true }; render();
    const v = await api.bevisVerify({ dir: it.dir });
    state.verify[it.dir] = v.error && v.ok === false && !v.changed ? { error: v.error } : v;
    render();
  }
});

// ============================================================
//  Arkivmappe og verktøy
// ============================================================
function renderRoot() {
  els.rootText.textContent = state.root || '(ikke valgt)';
  els.rootText.title = state.root || '';
}
async function pickRoot() {
  if (window.bvPickRoot) return window.bvPickRoot();
  const r = await api.openFileDialog({ title: 'Velg mappe for bevissikring', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return;
  state.root = r.path;
  renderRoot(); scheduleSaveState(); refresh();
}
async function refreshTools() {
  try {
    const t = await api.bevisToolStatus();
    els.toolInfo.textContent = t.ytDlp ? 'yt-dlp ' + t.ytDlpVersion : 'yt-dlp lastes ned første gang en video sikres';
  } catch (e) { els.toolInfo.textContent = ''; }
}

// ============================================================
//  Hendelser
// ============================================================
els.openBtn.addEventListener('click', openPage);
els.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') openPage(); });
els.focusBtn.addEventListener('click', () => api.bevisFocus());
els.captureBtn.addEventListener('click', () => capture(false));
els.regionBtn.addEventListener('click', () => capture(true));

// «Bare video»: last ned med yt-dlp rett inn i saken, uten vindu
async function downloadVideo() {
  if (state.busy) return;
  if (typeof api.bevisDownload !== 'function') { setStatus('Krever nyere Faktisk Studio', 'err'); return; }
  if (window.bvRootReady ? !window.bvRootReady() : !state.root) return;
  const caseName = els.caseInput.value.trim();
  if (!caseName) { setStatus('Skriv inn en sak — sikringene samles per sak', 'err'); els.caseInput.focus(); return; }
  const url = els.urlInput.value.trim();
  if (!url) { setStatus('Lim inn lenken til videoen', 'err'); els.urlInput.focus(); return; }
  setBusy(true);
  setStatus('Henter video … (første gang lastes også yt-dlp ned, det kan ta et minutt)');
  const vb = document.getElementById('videoBtn'); if (vb) vb.textContent = 'Henter video …';
  try {
    const r = await api.bevisDownload({ root: state.root, caseName, url, note: els.noteInput.value.trim(), pluginVersion: state.pluginVersion, comments: options().comments });
    if (!r.ok) { setStatus('Fikk ikke lastet ned: ' + r.error, 'err'); return; }
    state.highlight = r.dir;
    if (window.bvAutoIndex) window.bvAutoIndex(r.dir);
    setStatus('Lastet ned' + (r.title ? ': ' + r.title.slice(0, 60) : '') + ' (' + fmtSize(r.bytes) + ')', (r.warnings || []).length ? 'warn' : 'ok');
    els.noteInput.value = '';
    await refresh();
    const card = els.list.querySelector('.is-new');
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    setStatus('Fikk ikke lastet ned: ' + err.message, 'err');
  } finally {
    setBusy(false);
    if (vb) vb.textContent = 'Last ned bare videoen';
    refreshTools();
  }
}
document.getElementById('videoBtn').addEventListener('click', downloadVideo);
els.pickRootBtn.addEventListener('click', pickRoot);
els.revealRootBtn.addEventListener('click', () => { if (state.root) api.revealInFinder(state.root); });
els.updateToolsBtn.addEventListener('click', async () => {
  setStatus('Oppdaterer yt-dlp …');
  const r = await api.bevisUpdateTools();
  setStatus(r.ok ? 'yt-dlp er oppdatert (' + r.ytDlpVersion + ')' : 'Oppdatering feilet: ' + r.error, r.ok ? 'ok' : 'err');
  refreshTools();
});
els.logoutBtn.addEventListener('click', async () => {
  const ok = await window.faktiskDialog.confirm('Logge ut av alle nettsteder i sikringsvinduet? Innlogginger og informasjonskapsler slettes.', true);
  if (!ok) return;
  await api.bevisLogout();
  setStatus('Logget ut', 'ok');
});
els.caseInput.addEventListener('input', scheduleSaveState);
optBoxes.forEach(b => b.addEventListener('change', () => {
  els.waybackHint.hidden = !document.querySelector('[data-opt="wayback"]').checked;
  const media = document.querySelector('[data-opt="media"]');
  const comments = document.querySelector('[data-opt="comments"]');
  comments.disabled = !media.checked;
  scheduleSaveState();
}));
els.search.addEventListener('input', () => { state.ui.q = els.search.value; render(); });
els.caseFilter.addEventListener('change', () => { state.ui.caseFilter = els.caseFilter.value; scheduleSaveState(); render(); });

$('backBtn').addEventListener('click', () => api.goHome());
$('fullscreenBtn').addEventListener('click', () => api.toggleFullscreen());

// ============================================================
//  Oppstart
// ============================================================
(async function init() {
  // Vent til alle skriptene (stikkprove, profil, sikkerhet …) er lastet —
  // ellers kan svar fra Studio komme før de har registrert seg
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  try {
    const [appV, plugins] = await Promise.all([api.appVersion(), api.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    state.pluginVersion = me ? me.version : '';
    $('appVersion').textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}

  if (!hasApi) {
    setStatus('Denne pluginen krever en nyere Faktisk Studio. Oppdater appen fra Malsiden.', 'err');
    els.captureBtn.disabled = els.regionBtn.disabled = els.openBtn.disabled = true;
    return;
  }

  api.onBevisProgress(p => { if (state.busy && p && p.msg) setStatus(p.msg); });
  api.onBevisWindow(renderWindow);

  let saved = null;
  try { const res = await api.stateLoad(PLUGIN_ID); saved = res && res.ok && res.state; } catch (e) {}
  if (saved) {
    state.root = saved.root || '';
    els.caseInput.value = saved.caseName || '';
    els.urlInput.value = saved.url || '';
    if (saved.options) optBoxes.forEach(b => { if (b.dataset.opt in saved.options) b.checked = !!saved.options[b.dataset.opt]; });
    if (saved.ui) state.ui = Object.assign(state.ui, saved.ui);
  }
  // Ingen stille standardmappe — sikkerhet.js ber brukeren velge
  if (window.bvSecurityInit) { try { await window.bvSecurityInit(); } catch (e) { console.error('bvSecurityInit', e); } }
  els.waybackHint.hidden = !document.querySelector('[data-opt="wayback"]').checked;
  document.querySelector('[data-opt="comments"]').disabled = !document.querySelector('[data-opt="media"]').checked;
  els.search.value = state.ui.q || '';
  if (window.bvProfileApply) window.bvProfileApply(saved && saved.profile);
  if (window.bvListApply) window.bvListApply(saved && saved.list);
  if (window.bvSampleApply) window.bvSampleApply(saved && saved.sample);
  renderRoot();
  renderWindow(await api.bevisWindowState());
  refreshTools();
  await refresh();
})();
