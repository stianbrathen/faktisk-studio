// Faktisk Studio · Bevissikring — import og søk (lastes sist)
//
//  • Importer skjermbilder og skjermopptak (mobil/Mac) til saken: dra inn
//    eller «Velg filer…». Blir en egen sikring med sjekksummer og tidsstempel.
//  • «Gjør søkbar»: bygger indeks per sikring — sidens tekst, tekst lest i
//    bilder og video (Apple Vision) og tale (Studios transkribering).
//  • Søkefeltet søker i indeksen og viser treff med utdrag og tidskode.

(function () {
  const api = window.faktisk;
  const $ = id => document.getElementById(id);
  if (typeof api.bevisImport !== 'function') return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MEDIA_RE = /\.(png|jpe?g|heic|heif|webp|gif|tiff?|bmp|mov|mp4|m4v|webm|mkv|avi|3gp|m4a|mp3|wav|aac|ogg|opus|flac)$/i;

  const el = {
    drop: $('impDrop'), pick: $('impPickBtn'), list: $('impList'), go: $('impBtn'), speech: $('impSpeech'),
    idxInfo: $('idxInfo'), idxBtn: $('idxBtn'), idxStop: $('idxStopBtn'), idxSpeech: $('idxSpeech'),
  };
  const A = { pending: [], running: false, stop: false, hits: {}, searchSeq: 0 };
  state.hits = {};

  const fmtT = t => { t = Math.max(0, Math.round(+t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const SRC = { tekst: 'Tekst', ocr: 'Tekst i bilde', tale: 'Tale', meta: 'Info', info: 'Beskrivelse', kommentarer: 'Kommentarer' };

  // ------------------------------------------------------------
  //  Import
  // ------------------------------------------------------------
  function renderPending() {
    el.list.innerHTML = A.pending.map((p, i) => '<li><span title="' + esc(p) + '">' + esc(p.split('/').pop()) + '</span><button class="link-btn" data-i="' + i + '" type="button" title="Fjern">✕</button></li>').join('');
    el.go.hidden = !A.pending.length;
    el.go.textContent = 'Importer ' + A.pending.length + (A.pending.length === 1 ? ' fil' : ' filer');
  }
  function addPaths(paths) {
    const ok = paths.filter(p => MEDIA_RE.test(p));
    const skipped = paths.length - ok.length;
    for (const p of ok) if (!A.pending.includes(p)) A.pending.push(p);
    renderPending();
    if (skipped) setStatus(skipped + ' fil' + (skipped > 1 ? 'er' : '') + ' hoppet over — bare bilder, video og lyd kan importeres', 'warn');
  }
  el.list.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; A.pending.splice(+b.dataset.i, 1); renderPending(); });
  el.pick.addEventListener('click', async () => {
    const r = await api.openFileDialog({ title: 'Velg skjermbilder og opptak', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bilder, video og lyd', extensions: ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'mov', 'mp4', 'm4v', 'webm', 'mkv', 'm4a', 'mp3', 'wav'] }] });
    if (!r.canceled) addPaths(r.filePaths || [r.path]);
  });
  ['dragenter', 'dragover'].forEach(t => el.drop.addEventListener(t, e => { e.preventDefault(); el.drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => el.drop.addEventListener(t, () => el.drop.classList.remove('is-over')));
  el.drop.addEventListener('drop', e => {
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files || []).map(f => { try { return api.bevisPathForFile ? api.bevisPathForFile(f) : f.path; } catch (err) { return ''; } }).filter(Boolean);
    if (!paths.length) { setStatus('Fikk ikke tak i filene — bruk «Velg filer…»', 'err'); return; }
    addPaths(paths);
  });
  // Unngå at filer som slippes utenfor feltet åpnes i vinduet
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  el.go.addEventListener('click', async () => {
    if (state.busy || A.running || !A.pending.length) return;
    if (window.bvRootReady && !window.bvRootReady()) return;
    const caseName = els.caseInput.value.trim();
    if (!caseName) { setStatus('Skriv inn en sak — sikringene samles per sak', 'err'); els.caseInput.focus(); return; }
    setBusy(true);
    setStatus('Importerer …');
    let r;
    try {
      r = await api.bevisImport({ root: state.root, caseName, paths: A.pending.slice(), url: els.urlInput.value.trim(), note: els.noteInput.value.trim(), pluginVersion: state.pluginVersion });
    } finally { setBusy(false); }
    if (!r.ok) { setStatus('Import feilet: ' + r.error, 'err'); return; }
    A.pending = []; renderPending();
    els.noteInput.value = '';
    state.highlight = r.dir;
    await refresh();
    setStatus('Importert' + (r.stamp && r.stamp.ok ? ' og tidsstemplet' : '') + '. Gjør innholdet søkbart …', 'ok');
    await indexDirs([r.dir], el.speech.checked);
  });

  // ------------------------------------------------------------
  //  Indeksering
  // ------------------------------------------------------------
  async function transcribe(dir, todo) {
    for (const t of todo) {
      if (A.stop) return;
      setStatus('Transkriberer tale i ' + t.rel.split('/').pop() + ' … (første gang lastes talemodellen ned)');
      const r = await api.transcribe({ inputPath: t.path, language: 'auto' });
      if (!r || !r.ok) { setStatus('Transkribering feilet: ' + ((r && r.error) || 'ukjent feil'), 'warn'); continue; }
      await api.bevisIndexSpeech({ dir, rel: t.rel, segments: r.segments || [], language: r.language || 'auto' });
    }
  }
  async function indexDirs(dirs, withSpeech) {
    if (A.running) return;
    A.running = true; A.stop = false;
    el.idxBtn.disabled = true; el.idxStop.hidden = false;
    let speechLeft = 0;
    try {
      for (let i = 0; i < dirs.length; i++) {
        if (A.stop) break;
        setStatus('Gjør søkbar ' + (i + 1) + ' av ' + dirs.length + ' …');
        const b = await api.bevisIndexBuild({ dir: dirs[i] });
        if (!b.ok) continue;
        if (withSpeech) await transcribe(dirs[i], b.speechTodo || []);
        else speechLeft += (b.speechTodo || []).length;
      }
      setStatus(A.stop ? 'Stoppet' : 'Ferdig — innholdet er søkbart' + (speechLeft ? ' (tale i ' + speechLeft + ' opptak er ikke transkribert)' : ''), 'ok');
    } finally {
      A.running = false;
      el.idxBtn.disabled = false; el.idxStop.hidden = true;
      updateIndexInfo();
      if (state.ui.q) runSearch();
    }
  }
  window.bvAutoIndex = dir => { if (!A.running) api.bevisIndexBuild({ dir }).then(updateIndexInfo).catch(() => {}); };

  async function updateIndexInfo() {
    if (!state.root) { el.idxInfo.textContent = ''; return; }
    const s = await api.bevisIndexStatus({ root: state.root, caseName: state.ui.caseFilter || undefined });
    if (!s.ok || !s.total) { el.idxInfo.textContent = ''; el.idxBtn.hidden = true; if (el.idxSpeech) el.idxSpeech.parentNode.hidden = true; return; }
    if (el.idxSpeech) el.idxSpeech.parentNode.hidden = false;
    const done = s.total - s.todo.length;
    el.idxInfo.textContent = done === s.total ? 'Alt er søkbart' : done + ' av ' + s.total + ' søkbare';
    el.idxBtn.hidden = false;
    el.idxBtn.dataset.todo = JSON.stringify(s.todo);
  }
  el.idxBtn.addEventListener('click', async () => {
    let todo = [];
    try { todo = JSON.parse(el.idxBtn.dataset.todo || '[]'); } catch (e) {}
    const withSpeech = !!(el.idxSpeech && el.idxSpeech.checked);
    if (!todo.length && !withSpeech) { setStatus('Alt er allerede søkbart'); return; }
    if (!todo.length) {
      // Alt indeksert, men tale kan mangle: bygg på nytt (raskt, gjenbruker OCR) for å finne opptak uten tale
      const st = await api.bevisList({ root: state.root });
      todo = (st.items || []).filter(it => !state.ui.caseFilter || it.case === state.ui.caseFilter).map(it => it.dir);
    }
    indexDirs(todo, withSpeech);
  });
  el.idxStop.addEventListener('click', () => { A.stop = true; setStatus('Stopper etter gjeldende fil …'); });

  // ------------------------------------------------------------
  //  Søk
  // ------------------------------------------------------------
  let searchTimer = null;
  async function runSearch() {
    const q = state.ui.q.trim();
    const seq = ++A.searchSeq;
    if (q.length < 2 || !state.root) { state.hits = {}; render(); return; }
    const r = await api.bevisSearch({ root: state.root, caseName: state.ui.caseFilter || undefined, q });
    if (seq !== A.searchSeq) return;
    state.hits = (r && r.hits) || {};
    render();
  }
  els.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  els.caseFilter.addEventListener('change', () => { updateIndexInfo(); runSearch(); });

  window.bvHitsHtml = function (it) {
    const h = state.hits[it.dir];
    if (!h || !h.length || !state.ui.q) return '';
    const words = state.ui.q.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    const mark = s => { let out = esc(s); for (const w of words) out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;') + ')', 'gi'), '<mark>$1</mark>'); return out; };
    return '<ul class="bv-hits">' + h.map(x => '<li><button class="bv-hit" type="button" data-act="hit" data-tab="' + esc(x.src === 'tale' ? 'tale' : x.src === 'ocr' ? 'ocr' : x.src === 'tekst' ? 'tekst' : 'fakta') + '">' +
      '<span class="bv-hit__src">' + esc(SRC[x.src] || x.src) + (x.t != null ? ' ' + fmtT(x.t) : '') + (x.file && x.src !== 'tekst' ? ' · ' + esc(x.file.split('/').pop()) : '') + '</span> ' + mark(x.snip) + '</button></li>').join('') + '</ul>';
  };
  window.bvHitMatch = it => !!(state.hits[it.dir]);

  if (api.onBevisLibraryChanged) api.onBevisLibraryChanged(() => updateIndexInfo());
  setTimeout(updateIndexInfo, 800);
})();
