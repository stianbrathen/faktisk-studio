// Faktisk Studio · Bevissikring — profiler og innlegg (lastes etter stikkprove.js)
//
// 1) Åpne profilen i sikringsvinduet og logg inn.
// 2) «Sikre profilinfo»: toppen av profilen + Om-siden (+ sidegjennomsiktighet).
// 3) «Finn innlegg»: ruller og samler lenker til innleggene. Lista lagres og
//    hashes i saken før noe sikres.
// 4) Huk av og «Sikre valgte»: hvert innlegg åpnes, kommentarene åpnes, og
//    innlegget sikres som egen sikring. Fremdriften logges, så jobben kan
//    fortsettes senere.

(function () {
  const $ = id => document.getElementById(id);
  const api = window.faktisk;
  if (typeof api.bevisProfileScan !== 'function') return;

  const el = {
    url: $('pUrl'), open: $('pOpenBtn'), info: $('pInfoBtn'), max: $('pMax'), until: $('pUntil'), expand: $('pExpand'),
    scan: $('pScanBtn'), stop: $('pStopBtn'), lists: $('pListSelect'), box: $('pResBox'), meta: $('pMeta'),
    all: $('pAllBtn'), none: $('pNoneBtn'), sel: $('pSel'), list: $('pList'), comments: $('pExpandComments'),
    run: $('pRunBtn'), runStop: $('pRunStop'), reveal: $('pRevealBtn'),
  };
  const P = { current: null, lists: [], selected: new Set(), running: false, stop: false, scanning: false };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtD = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? (m[3] + '.' + m[2] + '.' + m[1].slice(2)) : ''; };

  function caseOk() {
    const c = els.caseInput.value.trim();
    if (!c) { setStatus('Skriv inn en sak først', 'err'); els.caseInput.focus(); return ''; }
    return c;
  }
  function busy(b) {
    el.open.disabled = el.info.disabled = el.scan.disabled = b;
    el.stop.disabled = !P.scanning;
    renderRun();
  }

  // ------------------------------------------------------------
  //  Åpne og profilinfo
  // ------------------------------------------------------------
  el.open.addEventListener('click', async () => {
    const url = el.url.value.trim();
    if (!url) { setStatus('Lim inn lenken til profilen eller siden', 'err'); el.url.focus(); return; }
    const r = await api.bevisOpen({ url });
    if (r.cancelled) setStatus('Avbrutt');
    else if (!r.ok || !r.url) setStatus('Ugyldig adresse', 'err'); else { setStatus('Logg inn i vinduet om nødvendig.'); scheduleSaveState(); }
  });

  async function captureUrl(url, tag, maxScroll, expandComments) {
    if (window.bvRootReady && !window.bvRootReady()) return { status: 'feil', error: 'ingen arkivmappe', login: true };
    const open = await api.bevisOpen({ url, wait: true, settleMs: 3000 });
    if (!open.ok) return { status: 'feil', error: 'kunne ikke åpne siden', finalUrl: '' };
    if (/\/(login|checkpoint|i\/flow\/login|accounts\/login)/.test(open.finalUrl || '')) return { status: 'feil', error: 'krever innlogging', login: true };
    if (expandComments) { try { await api.bevisExpand({ rounds: 6, comments: true }); } catch (e) {} }
    const r = await api.bevisCapture({
      root: state.root, caseName: els.caseInput.value.trim(), note: els.noteInput.value.trim(), url,
      pluginVersion: state.pluginVersion, options: options(), tag, maxScroll,
    });
    if (!r.ok) return { status: 'feil', error: r.error };
    return { status: 'ok', dir: r.dir, fingerprint: r.fingerprint, finalUrl: open.finalUrl };
  }

  el.info.addEventListener('click', async () => {
    if (state.busy || P.running) return;
    if (!caseOk()) return;
    const urls = await api.bevisProfileUrls({ url: el.url.value.trim() || ((await api.bevisWindowState()).url || '') });
    if (!urls.ok) { setStatus('Lim inn lenken til profilen', 'err'); return; }
    setBusy(true); busy(true);
    const done = [];
    try {
      setStatus('Sikrer toppen av profilen …');
      const top = await captureUrl(urls.profile, { kind: 'profil', part: 'topp', suffix: 'profil', account: urls.profile }, 3, false);
      if (top.login) { setStatus('Siden krever innlogging. Logg inn i vinduet og prøv igjen.', 'err'); return; }
      done.push(top.status === 'ok' ? 'profil' : 'profil (feilet)');
      for (const a of urls.about) {
        setStatus('Sikrer «' + a.part + '» …');
        if (a.optional) {
          const probe = await api.bevisOpen({ url: a.url, wait: true, settleMs: 2500 });
          if (!probe.ok || !/transparency/i.test(probe.finalUrl || '')) continue;   // finnes bare for sider
          const t = ((await api.bevisWindowState()).title || '').trim();
          if (!t || /^facebook$|ikke tilgjengelig|not available|not found|fant ikke/i.test(t)) continue;
        }
        const r = await captureUrl(a.url, { kind: 'profil', part: a.part, suffix: a.part, account: urls.profile }, 6, false);
        done.push(r.status === 'ok' ? a.part : a.part + ' (feilet)');
      }
      setStatus('Profilinfo sikret: ' + done.join(', '), 'ok');
      await refresh();
    } finally { setBusy(false); busy(false); }
  });

  // ------------------------------------------------------------
  //  Finn innlegg
  // ------------------------------------------------------------
  if (api.onBevisProfileProgress) api.onBevisProfileProgress(p => { if (P.scanning && p && p.msg) setStatus(p.msg); });

  el.scan.addEventListener('click', async () => {
    if (state.busy || P.running || P.scanning) return;
    const caseName = caseOk(); if (!caseName) return;
    const st = await api.bevisWindowState();
    if (!st.open) {
      if (!el.url.value.trim()) { setStatus('Åpne profilen først', 'err'); return; }
      await api.bevisOpen({ url: el.url.value.trim(), wait: true, settleMs: 3000 });
    }
    P.scanning = true; setBusy(true); busy(true);
    setStatus('Ruller gjennom profilen …');
    try {
      const r = await api.bevisProfileScan({ maxScreens: +el.max.value || 150, untilDate: el.until.value || '', expand: el.expand.checked });
      if (!r.ok) { setStatus('Fant ikke innlegg: ' + r.error, 'err'); return; }
      if (!r.posts.length) { setStatus('Fant ingen innlegg. Er du logget inn, og står vinduet på profilens innleggsside?', 'err'); return; }
      const saved = await api.bevisProfileSave({ root: state.root, caseName, scan: r, pluginVersion: state.pluginVersion });
      if (!saved.ok) { setStatus('Kunne ikke lagre lista: ' + saved.error, 'err'); return; }
      const why = { maks: 'nådde maks antall skjermer', dato: 'nådde datoen', slutt: 'kom til slutten', stoppet: 'stoppet' }[r.stoppedBy] || r.stoppedBy;
      setStatus('Fant ' + r.posts.length + ' innlegg (' + why + '). Lista er lagret i saken.', 'ok');
      await loadLists(saved.dir, true);
    } finally { P.scanning = false; setBusy(false); busy(false); }
  });
  el.stop.addEventListener('click', () => { api.bevisProfileStop(); setStatus('Stopper …'); });

  // ------------------------------------------------------------
  //  Lister og valg
  // ------------------------------------------------------------
  async function loadLists(selectDir, selectDefault) {
    if (!state.root) return;
    const r = await api.bevisProfileLists({ root: state.root });
    P.lists = (r.lists || []).filter(l => !(l.list && l.list.scan && l.list.scan.kind === 'lenkeliste'));
    const cur = selectDir || (P.current && P.current.dir) || '';
    el.lists.innerHTML = '<option value="">' + (P.lists.length ? 'Tidligere lister …' : 'Ingen lister ennå') + '</option>' + P.lists.map(l =>
      '<option value="' + esc(l.dir) + '"' + (l.dir === cur ? ' selected' : '') + '>' +
      esc(l.case + ' · ' + (l.list.account || l.list.platform) + ' · ' + l.list.scan.posts.length + ' innlegg · ' + l.list.createdAtLocal.split(',')[0]) + '</option>').join('');
    const l = P.lists.find(x => x.dir === cur);
    if (l) select(l, selectDefault);
    else renderList();
  }
  function select(l, selectDefault) {
    P.current = { dir: l.dir, list: l.list, results: l.results || [] };
    P.selected = new Set();
    if (selectDefault) l.list.scan.posts.forEach(p => { if (!p.beforeUntil) P.selected.add(p.index); });
    renderList();
  }
  el.lists.addEventListener('change', () => {
    if (P.running) return;
    const l = P.lists.find(x => x.dir === el.lists.value);
    if (l) select(l, false); else { P.current = null; renderList(); }
  });

  function postStatus(i) {
    const rs = (P.current.results || []).filter(r => r.index === i);
    if (!rs.length) return '';
    if (rs.some(r => r.status === 'ok')) return 'ok';
    return 'err';
  }

  function renderList() {
    const c = P.current;
    el.box.hidden = !c;
    if (!c) { renderRun(); return; }
    const posts = c.list.scan.posts;
    const okN = posts.filter(p => postStatus(p.index) === 'ok').length;
    el.meta.innerHTML = esc(c.list.scan.pageTitle || c.list.scan.pageUrl) + '<br><span class="bv-muted">' +
      esc(posts.length + ' innlegg · ' + c.list.scan.screens + ' skjermer rullet · lista laget ' + c.list.createdAtLocal + ' · ' + okN + ' sikret') + '</span>';
    el.list.innerHTML = posts.map(p => {
      const st = postStatus(p.index);
      return '<li class="bv-plan__row bv-post' + (st ? ' is-' + st : '') + (p.beforeUntil ? ' is-old' : '') + '" data-i="' + p.index + '">' +
        '<input type="checkbox" data-i="' + p.index + '"' + (P.selected.has(p.index) ? ' checked' : '') + (P.running ? ' disabled' : '') + '>' +
        '<span class="bv-plan__n">' + (p.index + 1) + '</span>' +
        '<span class="bv-post__date" title="' + esc(p.dateText) + '">' + esc(p.date ? fmtD(p.date) : (p.dateText || '—').slice(0, 14)) + '</span>' +
        '<span class="bv-plan__d" title="' + esc(p.snippet + '\n' + p.url) + '">' + esc(p.snippet || p.url) + '</span>' +
        '<span class="bv-plan__s">' + (st === 'ok' ? '✓' : st === 'err' ? '✗' : '') + '</span></li>';
    }).join('');
    renderRun();
  }
  function renderRun() {
    const n = P.selected.size;
    el.sel.textContent = P.current ? n + ' valgt' : '';
    el.run.disabled = !P.current || !n || P.running || P.scanning || state.busy && !P.running;
    el.run.textContent = P.running ? 'Sikrer …' : 'Sikre valgte (' + n + ')';
    el.runStop.hidden = !P.running;
  }

  el.list.addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    const i = +cb.dataset.i;
    if (cb.checked) P.selected.add(i); else P.selected.delete(i);
    renderRun();
  });
  el.list.addEventListener('dblclick', e => {
    const row = e.target.closest('.bv-post'); if (!row || !P.current) return;
    const p = P.current.list.scan.posts[+row.dataset.i];
    if (p) api.openExternal(p.url);
  });
  el.all.addEventListener('click', () => { if (!P.current || P.running) return; P.current.list.scan.posts.forEach(p => { if (postStatus(p.index) !== 'ok') P.selected.add(p.index); }); renderList(); });
  el.none.addEventListener('click', () => { if (P.running) return; P.selected.clear(); renderList(); });
  el.reveal.addEventListener('click', () => { if (P.current) api.revealInFinder(P.current.dir + '/liste.csv'); });

  // ------------------------------------------------------------
  //  Sikre valgte
  // ------------------------------------------------------------
  el.run.addEventListener('click', async () => {
    if (P.running || !P.current || !P.selected.size) return;
    if (!caseOk()) return;
    const c = P.current, posts = c.list.scan.posts.filter(p => P.selected.has(p.index));
    P.running = true; P.stop = false;
    setBusy(true); renderList();
    let ok = 0, fail = 0;
    try {
      for (let k = 0; k < posts.length; k++) {
        if (P.stop) break;
        const p = posts[k];
        const row = el.list.querySelector('.bv-post[data-i="' + p.index + '"]');
        if (row) { row.classList.add('is-running'); row.scrollIntoView({ block: 'nearest' }); }
        setStatus('Innlegg ' + (k + 1) + ' av ' + posts.length + ' …');
        const tag = { kind: 'innlegg', listId: c.list.id, index: p.index, total: c.list.scan.posts.length, date: p.date, dateText: p.dateText,
          account: c.list.account || '', profileUrl: c.list.scan.pageUrl, suffix: 'i' + String(p.index + 1).padStart(3, '0') };
        const res = await captureUrl(p.url, tag, 15, el.comments.checked);
        await api.bevisProfileResult({ dir: c.dir, result: Object.assign({ index: p.index, url: p.url }, res) });
        c.results.push(Object.assign({ index: p.index }, res));
        if (res.status === 'ok') { ok++; P.selected.delete(p.index); } else fail++;
        renderList();
        if (res.login) { setStatus('Krever innlogging. Logg inn i vinduet og trykk «Sikre valgte» igjen.', 'err'); P.stop = true; break; }
        if (k % 5 === 4) await refresh();
        if (k < posts.length - 1 && !P.stop && window.bvPace) await window.bvPace(() => P.stop);
      }
    } finally {
      P.running = false;
      setBusy(false);
      renderList();
      await refresh();
      if (!/Krever innlogging/.test(els.status.textContent)) setStatus('Sikret ' + ok + ' innlegg' + (fail ? ', ' + fail + ' feilet (fortsatt valgt — prøv igjen)' : '') + (P.stop ? ' — stoppet' : '') + '.', fail ? 'warn' : 'ok');
      P.stop = false;
    }
  });
  el.runStop.addEventListener('click', () => { P.stop = true; setStatus('Stopper etter dette innlegget …'); });

  // ------------------------------------------------------------
  //  Lagring og visning (kalles fra main.js / stikkprove.js)
  // ------------------------------------------------------------
  window.bvProfileState = () => ({ url: el.url.value, max: el.max.value, until: el.until.value, expand: el.expand.checked, comments: el.comments.checked });
  window.bvProfileApply = s => {
    if (!s) return;
    el.url.value = s.url || '';
    if (s.max) el.max.value = s.max;
    el.until.value = s.until || '';
    if (typeof s.expand === 'boolean') el.expand.checked = s.expand;
    if (typeof s.comments === 'boolean') el.comments.checked = s.comments;
  };
  window.bvProfileShown = () => loadLists();
  window.bvProfileRunning = () => P.running || P.scanning;
  [el.url, el.max, el.until].forEach(x => x.addEventListener('input', scheduleSaveState));
  [el.expand, el.comments].forEach(x => x.addEventListener('change', scheduleSaveState));
})();
