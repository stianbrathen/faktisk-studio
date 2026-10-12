// Faktisk Studio · Skjermarkiv 0.1
//
// Søkbar oversikt over skjermbilder og skjermopptak. Studio gjør det tunge
// arbeidet lokalt (src/skjermarkiv-main.js): skann mappe, nøkkelbilder med
// ffmpeg, tekstlesing med Apple Vision. Arkivet er samme format (v1) som
// nettsiden skjermarkiv.html, så filer kan åpnes begge steder.
//
// Arkivene lagres automatisk i Studios userData («Mine arkiver»); «Lagre
// arkivfil…» gir en .skjermarkiv.json å dele eller åpne på nettsiden.
// Lokale stier (absPath) tas IKKE med i eksportert fil.

const PLUGIN_ID = 'skjermarkiv';
const ANALYZER = 'studio-plugin 0.1.0';
const $ = id => document.getElementById(id);

(async () => {
  try {
    const [appV, plugins] = await Promise.all([window.faktisk.appVersion(), window.faktisk.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = $('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const els = {
  status: $('status'), progressBox: $('progressBox'), progressBar: $('progressBar'), progressNote: $('progressNote'),
  stopBtn: $('stopBtn'), pickFolderBtn: $('pickFolderBtn'), rescanBtn: $('rescanBtn'), ocrChk: $('ocrChk'),
  archiveList: $('archiveList'), openFileBtn: $('openFileBtn'), exportBtn: $('exportBtn'), ocrInfo: $('ocrInfo'),
  search: $('searchInput'), kindSeg: $('kindSeg'), sort: $('sortSelect'), group: $('groupSelect'),
  count: $('countInfo'), title: $('archiveTitle'), grid: $('grid'), empty: $('emptyState'), gridWrap: $('gridWrap'),
  detail: $('detail'), stage: $('detailStage'), strip: $('detailStrip'), dName: $('detailName'), dMeta: $('detailMeta'),
  dActions: $('detailActions'), dTexts: $('detailTexts'), dPos: $('detailPos'),
};

const hasApi = typeof window.faktisk.skjermarkivAnalyze === 'function';

const state = {
  archive: null,       // { format, version, saved, source, title, folderLink, items: [] }
  archiveId: '',
  folderAbs: '',       // mappa arkivet ble laget fra (lokalt)
  running: false,
  stopRequested: false,
  ui: { q: '', kind: 'all', sort: 'date-desc', group: 'day' },
  visible: [],         // elementer som vises (etter filter/sortering), for forrige/neste
  detailIndex: -1,
};

// ============================================================
//  Hjelpere
// ============================================================
function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDur(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}
function fmtTc(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
function fmtSize(b) {
  if (!b) return '';
  if (b > 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1).replace('.', ',') + ' MB';
  return Math.round(b / 1e3) + ' KB';
}
const dayFmt = new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function fmtDate(iso) { try { return dtFmt.format(new Date(iso)); } catch (e) { return ''; } }
function fileUrl(p) { return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F'); }
const uidOf = it => it.driveId ? 'd:' + it.driveId : 'p:' + (it.path || it.name) + ':' + (it.size || 0);
const norm = s => String(s || '').toLowerCase().normalize('NFC');

// Dato fra filnavn (macOS/iOS-mønstre). Returnerer ISO eller null.
function dateFromName(name) {
  const n = String(name);
  let m;
  const mk = (y, mo, d, h, mi, s) => {
    const dt = new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0));
    return isNaN(dt) || +y < 2000 || +y > 2100 ? null : dt.toISOString();
  };
  // «Skjermbilde 2026-09-30 kl. 10.12.33», «Skjermopptak …», «Screenshot 2026-09-30 at 10.12.33», «Screen Recording …»
  if ((m = n.match(/(\d{4})-(\d{2})-(\d{2})(?:\s*(?:kl\.?|at|à|um|klo)?\s*(\d{1,2})[.:](\d{2})[.:](\d{2}))?/))) return mk(m[1], m[2], m[3], m[4], m[5], m[6]);
  // «ScreenRecording_09-29-2026 14-02-10»
  if ((m = n.match(/ScreenRecording_(\d{2})-(\d{2})-(\d{4})[ _](\d{2})-(\d{2})-(\d{2})/i))) return mk(m[3], m[1], m[2], m[4], m[5], m[6]);
  // «IMG_20260930_101233», «VID_20260930_101233», «Screenshot_20260930-101233»
  if ((m = n.match(/(?:IMG|VID|PXL|Screenshot|Screenrecorder)[_-]?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/i))) return mk(m[1], m[2], m[3], m[4], m[5], m[6]);
  // iOS-skjermopptak: «RPReplay_Final1727000000» (unix-tid)
  if ((m = n.match(/RPReplay_Final(\d{10})/i))) { const d = new Date(+m[1] * 1000); return isNaN(d) ? null : d.toISOString(); }
  return null;
}
function labelFor(it) {
  const n = it.name || '';
  const screen = /skjermbilde|screenshot|skjermopptak|screen ?recording|rpreplay|screenrecord/i.test(n);
  if (it.kind === 'video') return screen ? 'Skjermopptak' : 'Video';
  return screen ? 'Skjermbilde' : 'Bilde';
}

// ============================================================
//  Arkiv: opprett, lagre, åpne
// ============================================================
function newArchive(source, folderAbs) {
  state.archive = { format: 'faktisk-skjermarkiv', version: 1, saved: new Date().toISOString(), source, title: source, folderLink: '', items: [] };
  state.archiveId = 'a' + Date.now().toString(36);
  state.folderAbs = folderAbs || '';
}

let saveTimer = null, saving = false, savePending = false;
function scheduleArchiveSave(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveArchiveNow, delay == null ? 1500 : delay);
}
async function saveArchiveNow() {
  if (!state.archive || !state.archiveId) return;
  if (saving) { savePending = true; return; }
  saving = true;
  try {
    state.archive.saved = new Date().toISOString();
    const a = state.archive;
    const res = await window.faktisk.skjermarkivArchiveSave({
      id: state.archiveId,
      content: JSON.stringify(Object.assign({}, a, { localFolder: state.folderAbs })),
      meta: { title: a.title || a.source, source: a.source, count: a.items.length, folder: state.folderAbs },
    });
    if (!res.ok) setStatus('Kunne ikke lagre arkivet: ' + res.error, true);
    refreshArchiveList();
  } catch (e) { setStatus('Kunne ikke lagre arkivet: ' + e.message, true); }
  finally {
    saving = false;
    if (savePending) { savePending = false; saveArchiveNow(); }
  }
}

function loadArchiveObject(obj, id) {
  if (!obj || obj.format !== 'faktisk-skjermarkiv' || !Array.isArray(obj.items)) throw new Error('Ikke et skjermarkiv-arkiv');
  if (obj.version > 2) throw new Error('Arkivet er fra en nyere versjon');
  state.archive = obj;
  state.archive.items = obj.items.filter(Boolean);
  state.folderAbs = obj.localFolder || '';
  delete state.archive.localFolder;
  state.archiveId = id || ('a' + Date.now().toString(36));
  state.archive.items.forEach(it => { it.uid = it.uid || uidOf(it); it.label = it.label || labelFor(it); });
}

async function refreshArchiveList() {
  if (!hasApi) return;
  const res = await window.faktisk.skjermarkivArchiveList().catch(() => null);
  els.archiveList.innerHTML = '';
  const list = (res && res.ok && res.archives) || [];
  if (!list.length) { els.archiveList.innerHTML = '<span class="sa-muted">Ingen ennå</span>'; return; }
  list.forEach(a => {
    const row = document.createElement('div');
    row.className = 'sa-arch' + (a.id === state.archiveId ? ' is-on' : '');
    row.innerHTML = '<span class="sa-arch__name"></span><span class="sa-arch__n"></span><button class="sa-arch__del" title="Slett arkivet">×</button>';
    row.querySelector('.sa-arch__name').textContent = a.title || a.source || a.id;
    row.querySelector('.sa-arch__n').textContent = (a.count || 0) + ' filer';
    row.title = (a.folder || '') + (a.savedAt ? '\nLagret ' + fmtDate(a.savedAt) : '');
    row.addEventListener('click', e => { if (!e.target.closest('.sa-arch__del')) openStoredArchive(a.id); });
    row.querySelector('.sa-arch__del').addEventListener('click', async e => {
      e.stopPropagation();
      const yes = await window.faktiskDialog.confirm('Slette arkivet «' + (a.title || a.source) + '»? Filene i mappa røres ikke.');
      if (!yes) return;
      await window.faktisk.skjermarkivArchiveDelete({ id: a.id });
      if (a.id === state.archiveId) { state.archive = null; state.archiveId = ''; render(); saveUiState(); }
      refreshArchiveList();
    });
    els.archiveList.appendChild(row);
  });
}

async function openStoredArchive(id) {
  if (state.running) { setStatus('Vent til analysen er ferdig, eller stopp den.', true); return; }
  setStatus('Åpner arkiv…');
  const res = await window.faktisk.skjermarkivArchiveLoad({ id });
  if (!res.ok) { setStatus(res.error, true); return; }
  try {
    loadArchiveObject(JSON.parse(res.content), id);
    setStatus('');
    render(); refreshArchiveList(); saveUiState(); updateButtons();
  } catch (e) { setStatus('Kunne ikke åpne arkivet: ' + e.message, true); }
}

// ============================================================
//  Analyse
// ============================================================
async function pickFolder() {
  if (state.running) return;
  const res = await window.faktisk.openFileDialog({ title: 'Velg mappe med skjermbilder og opptak', properties: ['openDirectory'] });
  if (!res || res.canceled || !res.path) return;
  const scan = await window.faktisk.skjermarkivScan({ folder: res.path });
  if (!scan.ok) { setStatus(scan.error, true); return; }
  if (!scan.files.length) { setStatus('Fant ingen bilder eller videoer i mappa.', true); return; }
  newArchive(scan.folderName, scan.folder);
  addScannedFiles(scan.files);
  render(); updateButtons(); saveUiState();
  scheduleArchiveSave(0);
  runAnalysis();
}

async function rescan() {
  if (state.running || !state.archive) return;
  if (!state.folderAbs) {
    // Arkiv fra nettsiden eller annen maskin: knytt det til en mappe
    const res = await window.faktisk.openFileDialog({ title: 'Velg mappa arkivet hører til', properties: ['openDirectory'] });
    if (!res || res.canceled || !res.path) return;
    state.folderAbs = res.path;
  }
  const scan = await window.faktisk.skjermarkivScan({ folder: state.folderAbs });
  if (!scan.ok) { setStatus(scan.error, true); return; }
  const added = addScannedFiles(scan.files);
  render();
  setStatus(added ? added + ' nye filer funnet.' : 'Ingen nye filer i mappa.');
  scheduleArchiveSave(0);
  runAnalysis();
}

// Legg til skannede filer som ikke finnes fra før (kjennes igjen på sti +
// størrelse, eller navn + størrelse for arkiver fra nettsiden).
function addScannedFiles(files) {
  const items = state.archive.items;
  const byPath = new Map(items.map(it => [(it.path || it.name) + ':' + it.size, it]));
  const byName = new Map(items.map(it => [it.name + ':' + it.size, it]));
  let added = 0;
  for (const f of files) {
    const known = byPath.get(f.path + ':' + f.size) || byName.get(f.name + ':' + f.size);
    if (known) { known.absPath = f.absPath; continue; }
    const nameDate = dateFromName(f.name);
    const it = {
      name: f.name, path: f.path, kind: f.kind, ext: f.ext, mime: f.mime, size: f.size,
      lastModified: f.lastModified, date: nameDate || new Date(f.birthtime || f.lastModified).toISOString(),
      dateSource: nameDate ? 'filnavn' : 'endringsdato',
      label: '', width: 0, height: 0, duration: 0, status: 'pending', error: '', link: '',
      text: '', ocr: false, thumb: '', frames: [], absPath: f.absPath,
    };
    it.label = labelFor(it);
    it.uid = uidOf(it);
    items.push(it);
    added++;
  }
  return added;
}

async function runAnalysis(onlyOcr) {
  if (state.running || !state.archive) return;
  const doOcr = els.ocrChk.checked;
  const todo = state.archive.items.filter(it => it.absPath && (onlyOcr ? (doOcr && it.status === 'ready' && !it.ocr) : it.status !== 'ready'));
  if (!todo.length) { updateButtons(); return; }
  state.running = true; state.stopRequested = false;
  updateButtons();
  els.progressBox.style.display = 'block';
  const t0 = Date.now();
  let done = 0, failed = 0, sinceSave = 0;
  for (const it of todo) {
    if (state.stopRequested) break;
    els.progressNote.textContent = (done + 1) + ' av ' + todo.length + ' · ' + it.name;
    els.progressBar.style.width = Math.round(done / todo.length * 100) + '%';
    let res;
    try { res = await window.faktisk.skjermarkivAnalyze({ absPath: it.absPath, ocr: doOcr }); }
    catch (e) { res = { ok: false, error: e.message }; }
    if (res && res.ok) {
      applyAnalysis(it, res);
      if (res.ocrInfo) showOcrInfo(res.ocrInfo);
    } else {
      it.status = 'error'; it.error = (res && res.error) || 'Ukjent feil'; failed++;
    }
    done++; sinceSave++;
    updateCard(it);
    if (sinceSave >= 15) { sinceSave = 0; scheduleArchiveSave(0); }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  state.running = false;
  els.progressBox.style.display = 'none';
  render();
  updateButtons();
  await saveArchiveNow();
  setStatus((state.stopRequested ? 'Stoppet. ' : 'Ferdig ✓ ') + done + ' filer analysert på ' + (secs < 60 ? Math.max(1, secs) + ' s' : fmtDur(secs))
    + (failed ? ' · ' + failed + ' feilet (vises med rød kant)' : ''));
}

function applyAnalysis(it, r) {
  it.width = r.width || it.width; it.height = r.height || it.height;
  if (r.duration) it.duration = r.duration;
  it.thumb = r.thumb || it.thumb;
  if (r.kind === 'video') it.frames = r.frames || [];
  else it.text = r.text || '';
  it.ocr = !!r.ocr;
  // Dato: filnavn > metadata i fila > endringsdato (usikker)
  if (it.dateSource !== 'filnavn' && r.created) { it.date = r.created; it.dateSource = 'metadata'; }
  it.status = 'ready'; it.error = '';
  it.analyzer = ANALYZER;
}

function showOcrInfo(info) {
  if (info.error) { els.ocrInfo.textContent = 'Tekstlesing feilet: ' + info.error; els.ocrInfo.classList.add('is-err'); return; }
  els.ocrInfo.classList.remove('is-err');
  els.ocrInfo.textContent = 'Tekst lest med Apple Vision'
    + (info.langs && info.langs.length ? ' (' + info.langs.join(', ') + ')' : info.auto ? ' (språk gjenkjennes automatisk)' : '');
}

// ============================================================
//  Visning: filter, søk, rutenett
// ============================================================
function haystack(it) {
  if (!it._hay) {
    it._hay = norm([it.name, it.path, it.ext, it.label, it.text, (it.frames || []).map(f => f.text).join('\n'),
      (it.speech || []).map(s => s.text).join(' ')].join('\n'));
  }
  return it._hay;
}
function terms() { return norm(state.ui.q).split(/\s+/).filter(Boolean); }

// Første tekstlinje (med tidskode) som inneholder et søkeord
function snippet(it, ts) {
  if (!ts.length) return null;
  const sources = [];
  if (it.text) sources.push({ t: null, text: it.text });
  (it.frames || []).forEach(f => f.text && sources.push({ t: f.t, text: f.text }));
  for (const s of sources) {
    for (const line of s.text.split('\n')) {
      const l = norm(line);
      if (ts.some(t => l.includes(t))) return { t: s.t, line };
    }
  }
  return null;
}
function highlight(text, ts) {
  let html = esc(text);
  ts.forEach(t => {
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  });
  return html;
}

function filteredItems() {
  if (!state.archive) return [];
  const ts = terms();
  let list = state.archive.items.filter(it =>
    (state.ui.kind === 'all' || it.kind === state.ui.kind) &&
    ts.every(t => haystack(it).includes(t)));
  const s = state.ui.sort;
  const cmp = {
    'date-desc': (a, b) => String(b.date).localeCompare(String(a.date)),
    'date-asc': (a, b) => String(a.date).localeCompare(String(b.date)),
    name: (a, b) => a.name.localeCompare(b.name, 'nb', { numeric: true }),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
    size: (a, b) => (b.size || 0) - (a.size || 0),
  }[s];
  return list.sort(cmp);
}

function groupKey(it) {
  if (state.ui.group === 'folder') { const p = (it.path || '').split('/'); return p.length > 1 ? p.slice(0, -1).join('/') : '(rot)'; }
  if (state.ui.group === 'day') { try { return dayFmt.format(new Date(it.date)); } catch (e) { return 'Ukjent dato'; } }
  return '';
}

function render() {
  const a = state.archive;
  els.empty.style.display = a ? 'none' : '';
  els.grid.innerHTML = '';
  els.title.textContent = '';
  if (!a) { els.count.textContent = ''; state.visible = []; return; }
  const all = a.items;
  const nImg = all.filter(i => i.kind === 'image').length, nVid = all.length - nImg;
  const totalDur = all.reduce((s, i) => s + (i.duration || 0), 0);
  const pending = all.filter(i => i.status !== 'ready').length;
  els.title.innerHTML = '<b>' + esc(a.title || a.source) + '</b> · ' + nImg + ' bilder · ' + nVid + ' klipp'
    + (totalDur ? ' · ' + fmtDur(totalDur) + ' video' : '')
    + (pending ? ' · <span class="sa-warn">' + pending + ' ikke analysert' + (state.folderAbs ? '' : ' (koble til mappa med «Oppdater fra mappa»)') + '</span>' : '');
  const list = filteredItems();
  state.visible = list;
  els.count.textContent = list.length === all.length ? list.length + ' filer' : list.length + ' av ' + all.length;
  const ts = terms();
  let lastGroup = null;
  const frag = document.createDocumentFragment();
  list.forEach((it, idx) => {
    const g = groupKey(it);
    if (g && g !== lastGroup) {
      const h = document.createElement('div');
      h.className = 'sa-group';
      h.textContent = g;
      frag.appendChild(h);
      lastGroup = g;
    }
    frag.appendChild(cardFor(it, idx, ts));
  });
  els.grid.appendChild(frag);
}

function cardFor(it, idx, ts) {
  const c = document.createElement('div');
  c.className = 'sa-card sa-card--' + it.kind + (it.status === 'error' ? ' is-err' : '') + (it.status === 'pending' ? ' is-pending' : '');
  c.dataset.uid = it.uid;
  const portrait = it.height > it.width;
  const sn = snippet(it, ts);
  c.innerHTML =
    '<div class="sa-card__img' + (portrait ? ' is-portrait' : '') + '">'
      + (it.thumb ? '<img loading="lazy" alt="" src="' + esc(it.thumb) + '">' : '<span class="sa-card__ph">' + (it.status === 'pending' ? 'Venter…' : it.status === 'error' ? 'Feil' : '') + '</span>')
      + '<span class="sa-card__badge">' + esc(it.kind === 'video' ? (fmtDur(it.duration) || 'Klipp') : (it.ext || '').toUpperCase()) + '</span>'
    + '</div>'
    + '<div class="sa-card__body">'
      + '<div class="sa-card__name" title="' + esc(it.path || it.name) + '">' + esc(it.name) + '</div>'
      + '<div class="sa-card__meta">' + esc(it.label) + ' · ' + esc(fmtDate(it.date)) + (it.dateSource === 'endringsdato' ? ' <span class="sa-uncertain" title="Datoen er endringsdatoen til fila og kan være feil">(usikker)</span>' : '') + '</div>'
      + (sn ? '<div class="sa-card__snip">' + (sn.t != null ? '<span class="sa-tc">' + fmtTc(sn.t) + '</span> ' : '') + highlight(sn.line, ts) + '</div>' : '')
      + (it.status === 'error' ? '<div class="sa-card__err">' + esc(it.error) + '</div>' : '')
    + '</div>';
  c.addEventListener('click', () => openDetail(idx, sn ? sn.t : null));
  return c;
}

// Oppdater ett kort under analysen uten å tegne alt på nytt
function updateCard(it) {
  it._hay = null;
  const old = els.grid.querySelector('.sa-card[data-uid="' + CSS.escape(it.uid) + '"]');
  if (!old) return;
  const idx = state.visible.indexOf(it);
  old.replaceWith(cardFor(it, idx, terms()));
}

// ============================================================
//  Detaljvisning
// ============================================================
let detailVideo = null;

function openDetail(idx, seekT) {
  const it = state.visible[idx];
  if (!it) return;
  state.detailIndex = idx;
  els.detail.style.display = 'flex';
  els.dPos.textContent = (idx + 1) + ' av ' + state.visible.length;
  els.dName.textContent = it.name;

  // Metadata
  const rows = [
    ['Type', it.label],
    ['Tatt', fmtDate(it.date) + (it.dateSource ? ' (' + it.dateSource + ')' : '')],
    ['Mappe', (it.path || '').split('/').slice(0, -1).join('/') || '—'],
    ['Oppløsning', it.width ? it.width + '×' + it.height : ''],
    ['Lengde', fmtDur(it.duration)],
    ['Størrelse', fmtSize(it.size)],
    ['Format', (it.ext || '').toUpperCase()],
  ].filter(r => r[1]);
  els.dMeta.innerHTML = rows.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('');

  // Handlinger
  els.dActions.innerHTML = '';
  if (it.absPath) addAction('Vis i Finder', () => window.faktisk.revealInFinder(it.absPath));
  if (it.link) addAction('Åpne original ↗', () => window.faktisk.openExternal(it.link));

  // Media
  els.stage.innerHTML = '';
  els.strip.innerHTML = '';
  detailVideo = null;
  if (it.kind === 'video' && it.absPath) {
    const v = document.createElement('video');
    v.src = fileUrl(it.absPath);
    v.controls = true; v.playsInline = true; v.preload = 'auto';
    v.addEventListener('error', () => { showFrame(it, 0); });   // kodek Chromium ikke kan spille: vis nøkkelbilder
    v.addEventListener('timeupdate', () => markActiveFrame(it, v.currentTime));
    els.stage.appendChild(v);
    detailVideo = v;
    if (seekT != null) v.addEventListener('loadedmetadata', () => { v.currentTime = seekT; }, { once: true });
  } else if (it.kind === 'video') {
    showFrame(it, seekT != null ? Math.max(0, (it.frames || []).findIndex(f => f.t === seekT)) : 0);
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.src = it.thumb || '';
    els.stage.appendChild(img);
    if (it.absPath) {
      // Full oppløsning: direkte for vanlige formater, via Studio for HEIC o.l.
      if (/^(png|jpe?g|gif|webp|bmp)$/i.test(it.ext || '')) img.src = fileUrl(it.absPath);
      else window.faktisk.skjermarkivPreview({ absPath: it.absPath }).then(r => { if (r && r.ok && els.detail.style.display !== 'none') img.src = r.src; });
    }
  }

  // Nøkkelbilder
  (it.frames || []).forEach((f, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sa-strip__f' + (f.scene ? ' is-scene' : '');
    b.title = fmtTc(f.t) + (f.scene ? ' · scenebytte' : '');
    b.innerHTML = '<img alt="" src="' + esc(f.src) + '"><span>' + fmtTc(f.t) + '</span>';
    b.addEventListener('click', () => {
      if (detailVideo && !detailVideo.error) { detailVideo.currentTime = f.t; } else showFrame(it, k);
    });
    els.strip.appendChild(b);
  });

  // Tekst
  const ts = terms();
  let html = '';
  if (it.kind === 'image') {
    html = it.text ? '<h4>Tekst i bildet</h4><div class="sa-tx">' + highlight(it.text, ts) + '</div>'
      : '<p class="sa-muted">' + (it.ocr ? 'Ingen tekst funnet.' : 'Ikke tekstlest.') + '</p>';
  } else {
    const withText = (it.frames || []).filter(f => f.text);
    html = withText.length ? '<h4>Tekst i klippet</h4>' + withText.map(f =>
      '<div class="sa-tx sa-tx--t" data-t="' + f.t + '"><button class="sa-tc" type="button">' + fmtTc(f.t) + '</button> ' + highlight(f.text, ts) + '</div>').join('')
      : '<p class="sa-muted">' + (it.ocr ? 'Ingen tekst funnet i nøkkelbildene.' : 'Ikke tekstlest.') + '</p>';
  }
  els.dTexts.innerHTML = html;
  els.dTexts.querySelectorAll('.sa-tx--t').forEach(el => el.addEventListener('click', () => {
    const t = parseFloat(el.dataset.t);
    if (detailVideo && !detailVideo.error) { detailVideo.currentTime = t; detailVideo.play().catch(() => {}); }
    else showFrame(it, (it.frames || []).findIndex(f => f.t === t));
  }));
  const hit = els.dTexts.querySelector('mark');
  if (hit) hit.scrollIntoView({ block: 'center' });
}

function addAction(label, fn) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn-mini btn-mini--light'; b.textContent = label;
  b.addEventListener('click', fn);
  els.dActions.appendChild(b);
}

function showFrame(it, k) {
  const f = (it.frames || [])[k] || (it.frames || [])[0];
  els.stage.innerHTML = '';
  const img = document.createElement('img');
  img.alt = ''; img.src = f ? f.src : (it.thumb || '');
  els.stage.appendChild(img);
  if (!it.absPath) {
    const note = document.createElement('div');
    note.className = 'sa-stage-note';
    note.textContent = 'Originalen er ikke på denne maskinen — viser nøkkelbilder.';
    els.stage.appendChild(note);
  }
  detailVideo = null;
  if (f) markActiveFrame(it, f.t);
}

function markActiveFrame(it, t) {
  const fr = it.frames || [];
  let k = -1;
  for (let i = 0; i < fr.length; i++) if (fr[i].t <= t + 0.05) k = i;
  els.strip.querySelectorAll('.sa-strip__f').forEach((b, i) => b.classList.toggle('is-on', i === k));
}

function closeDetail() {
  if (detailVideo) { try { detailVideo.pause(); } catch (e) {} }
  els.detail.style.display = 'none';
  els.stage.innerHTML = '';
  detailVideo = null;
  state.detailIndex = -1;
}

// ============================================================
//  Import og eksport av arkivfil
// ============================================================
async function openArchiveFile() {
  if (state.running) return;
  const res = await window.faktisk.openFileDialog({ title: 'Åpne arkivfil', filters: [{ name: 'Skjermarkiv', extensions: ['json'] }] });
  if (!res || res.canceled || !res.path) return;
  setStatus('Leser arkivfila…');
  const r = await window.faktisk.skjermarkivReadJson({ path: res.path });
  if (!r.ok) { setStatus(r.error, true); return; }
  try {
    loadArchiveObject(JSON.parse(r.content), null);
    setStatus('Åpnet «' + (state.archive.title || state.archive.source) + '» (' + state.archive.items.length + ' filer). Lagret under Mine arkiver.');
    render(); updateButtons(); saveUiState();
    await saveArchiveNow();
  } catch (e) { setStatus('Kunne ikke åpne: ' + e.message, true); }
}

async function exportArchiveFile() {
  if (!state.archive) return;
  const a = state.archive;
  const name = (a.title || a.source || 'skjermarkiv').replace(/[\/:*?"<>|]/g, '-') + ' ' + new Date().toISOString().slice(0, 10) + '.skjermarkiv.json';
  const savePath = await window.faktisk.saveDialog({ title: 'Lagre arkivfil', defaultPath: name, filters: [{ name: 'Skjermarkiv', extensions: ['json'] }] });
  if (!savePath) return;
  // Uten lokale stier og interne felt
  const out = Object.assign({}, a, {
    saved: new Date().toISOString(),
    items: a.items.map(it => { const c = Object.assign({}, it); delete c.absPath; delete c._hay; delete c.uid; return c; }),
  });
  const res = await window.faktisk.writeTextFile({ savePath, content: JSON.stringify(out) });
  if (res.ok) { setStatus('Lagret ✓ ' + savePath.split('/').pop()); window.faktisk.revealInFinder(savePath); }
  else setStatus('Kunne ikke lagre: ' + res.error, true);
}

// ============================================================
//  Knapper, tastatur, tilstand
// ============================================================
function updateButtons() {
  const has = !!state.archive;
  els.pickFolderBtn.disabled = state.running || !hasApi;
  els.rescanBtn.disabled = state.running || !has || !hasApi;
  els.exportBtn.disabled = state.running || !has;
  els.openFileBtn.disabled = state.running || !hasApi;
}

function saveUiState() {
  window.faktisk.stateSave(PLUGIN_ID, { archiveId: state.archiveId, ui: state.ui, ocr: els.ocrChk.checked }).catch(() => {});
}

let searchTimer = null;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.ui.q = els.search.value; render(); }, 150);
});
els.kindSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  state.ui.kind = b.dataset.kind;
  els.kindSeg.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b));
  render(); saveUiState();
});
els.sort.addEventListener('change', () => { state.ui.sort = els.sort.value; render(); saveUiState(); });
els.group.addEventListener('change', () => { state.ui.group = els.group.value; render(); saveUiState(); });
els.ocrChk.addEventListener('change', saveUiState);
els.pickFolderBtn.addEventListener('click', pickFolder);
els.rescanBtn.addEventListener('click', rescan);
els.stopBtn.addEventListener('click', () => { state.stopRequested = true; els.progressNote.textContent = 'Stopper etter denne fila…'; });
els.openFileBtn.addEventListener('click', openArchiveFile);
els.exportBtn.addEventListener('click', exportArchiveFile);
$('closeBtn').addEventListener('click', closeDetail);
$('prevBtn').addEventListener('click', () => openDetail(Math.max(0, state.detailIndex - 1)));
$('nextBtn').addEventListener('click', () => openDetail(Math.min(state.visible.length - 1, state.detailIndex + 1)));
els.detail.addEventListener('click', e => { if (e.target === els.detail) closeDetail(); });
document.addEventListener('keydown', e => {
  if (els.detail.style.display === 'none') {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); els.search.focus(); }
    return;
  }
  if (e.key === 'Escape') closeDetail();
  else if (e.key === 'ArrowLeft' && state.detailIndex > 0) openDetail(state.detailIndex - 1);
  else if (e.key === 'ArrowRight' && state.detailIndex < state.visible.length - 1) openDetail(state.detailIndex + 1);
  else if (e.code === 'Space' && detailVideo) { e.preventDefault(); detailVideo.paused ? detailVideo.play().catch(() => {}) : detailVideo.pause(); }
});
$('backBtn').addEventListener('click', () => window.faktisk.goHome());
$('fullscreenBtn').addEventListener('click', () => window.faktisk.toggleFullscreen());

(async function init() {
  updateButtons();
  if (!hasApi) {
    setStatus('Skjermarkiv krever Faktisk Studio 0.7.8 eller nyere. Oppdater Studio fra Malsiden.', true);
    return;
  }
  refreshArchiveList();
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    const s = res && res.ok && res.state;
    if (s) {
      if (s.ui) {
        Object.assign(state.ui, s.ui, { q: '' });
        els.sort.value = state.ui.sort; els.group.value = state.ui.group;
        els.kindSeg.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x.dataset.kind === state.ui.kind));
      }
      if (typeof s.ocr === 'boolean') els.ocrChk.checked = s.ocr;
      if (s.archiveId) await openStoredArchive(s.archiveId);
    }
  } catch (e) { console.error(e); }
  render();
})();
