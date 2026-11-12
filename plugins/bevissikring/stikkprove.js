// Faktisk Studio · Bevissikring — stikkprøver (lastes etter main.js)
//
// Planen lages og lagres FØR innsamlingen (src/bevis-sample.js), så utvalget
// kan dokumenteres som systematisk. Kjøringen åpner hvert nedslag i
// sikringsvinduet og sikrer det med bevisCapture, merket med sample-info.
// Resultatet av hvert nedslag logges i resultat.json ved siden av planen,
// så en avbrutt plan kan fortsettes senere.

(function () {
  const $ = id => document.getElementById(id);
  const api = window.faktisk;
  if (typeof api.bevisPlanCreate !== 'function') return;

  const S = {
    mode: 'single',
    plans: [],          // fra bevisPlanList
    current: null,      // { dir, plan, results, fingerprint }
    running: false,
    stop: false,
  };
  const el = {
    modeSeg: $('modeSeg'), planSelect: $('planSelect'), form: $('planForm'),
    platform: $('sPlatform'), account: $('sAccount'), from: $('sFrom'), to: $('sTo'),
    firstBtn: $('sFirstBtn'), firstInfo: $('sFirstInfo'), mode: $('sMode'), n: $('sN'), nUnit: $('sNUnit'),
    win: $('sWindow'), per: $('sPer'), summary: $('sSummary'),
    planBtn: $('planBtn'), runBtn: $('runBtn'), stopBtn: $('stopBtn'),
    planBox: $('planBox'), planMeta: $('planMeta'), planList: $('planList'), planReveal: $('planRevealBtn'),
  };

  const DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const fmtD = s => { const t = pd(s); return isNaN(t) ? s : new Date(t).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const PLAT = { x: 'X', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };

  // ------------------------------------------------------------
  //  Modus
  // ------------------------------------------------------------
  function setMode(m) {
    S.mode = m === 'sample' || m === 'profile' || m === 'list' ? m : 'single';
    document.body.classList.toggle('bv-mode-sample', S.mode === 'sample');
    document.body.classList.toggle('bv-mode-profile', S.mode === 'profile');
    document.body.classList.toggle('bv-mode-list', S.mode === 'list');
    el.modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.mode === S.mode));
    if (S.mode === 'sample') loadPlans();
    if (S.mode === 'profile' && window.bvProfileShown) window.bvProfileShown();
    if (S.mode === 'list' && window.bvListShown) window.bvListShown();
  }
  el.modeSeg.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b || S.running || (window.bvProfileRunning && window.bvProfileRunning()) || (window.bvListRunning && window.bvListRunning())) return;
    setMode(b.dataset.mode); scheduleSaveState();
  });

  // ------------------------------------------------------------
  //  Skjema
  // ------------------------------------------------------------
  function countWindows() {
    const a = pd(el.from.value), b = pd(el.to.value);
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    const span = Math.round((b - a) / DAY) + 1;
    const n = Math.max(1, +el.n.value || 1);
    return el.mode.value === 'count' ? Math.min(n, span) : Math.ceil(span / n);
  }
  function updateForm() {
    const p = el.platform.value;
    document.body.classList.toggle('bv-plat-youtube', p === 'youtube');
    el.nUnit.textContent = el.mode.value === 'count' ? 'nedslag' : (+el.n.value === 1 ? 'dag' : 'dag');
    el.firstBtn.hidden = p !== 'youtube';
    if (p === 'x' && !el.firstInfo.dataset.keep) el.firstInfo.textContent = 'På X står startdatoen som «Ble med» på profilen.';
    if (p === 'youtube' && !el.firstInfo.dataset.keep) el.firstInfo.textContent = '';
    const c = countWindows();
    const w = Math.max(1, +el.win.value || 1);
    el.summary.textContent = c
      ? c + ' nedslag à ' + w + ' døgn' + (p === 'youtube' ? ', inntil ' + Math.max(1, +el.per.value || 1) + ' video(er) hver' : '') + (c > 60 ? ' — det tar tid' : '')
      : 'Velg en periode.';
  }
  [el.platform, el.mode, el.n, el.win, el.per, el.from, el.to, el.account].forEach(x => x.addEventListener('input', () => { updateForm(); scheduleSaveState(); }));
  [el.platform, el.mode].forEach(x => x.addEventListener('change', () => { updateForm(); scheduleSaveState(); }));

  // Lim inn en lenke → velg plattform automatisk
  el.account.addEventListener('change', async () => {
    const r = await api.bevisParseAccount({ account: el.account.value, platform: el.platform.value });
    if (r && r.platform && el.platform.querySelector('option[value="' + r.platform + '"]')) {
      el.platform.value = r.platform; updateForm();
    }
  });

  el.firstBtn.addEventListener('click', async () => {
    if (S.running) return;
    el.firstInfo.dataset.keep = '1';
    el.firstInfo.textContent = 'Henter videolisten …';
    setBusy(true);
    try {
      const r = await api.bevisYoutubeList({ account: el.account.value });
      if (!r.ok) { el.firstInfo.textContent = r.error; return; }
      if (!r.oldest) { el.firstInfo.textContent = r.count + ' videoer, men ingen datoer.'; return; }
      el.firstInfo.textContent = 'Sjekker nøyaktig dato …';
      const d = await api.bevisYoutubeDate({ id: r.oldest.id });
      const date = d.ok ? d.date : r.oldest.date;
      el.from.value = date;
      if (!el.to.value) el.to.value = new Date().toISOString().slice(0, 10);
      el.firstInfo.textContent = 'Første video: ' + fmtD(date) + (d.ok ? '' : ' (omtrentlig)') + ' · ' + r.count + ' videoer totalt';
      updateForm(); scheduleSaveState();
    } finally { setBusy(false); }
  });

  // ------------------------------------------------------------
  //  Planer
  // ------------------------------------------------------------
  async function loadPlans(selectDir) {
    if (!state.root) return;
    const r = await api.bevisPlanList({ root: state.root });
    S.plans = r.plans || [];
    const cur = selectDir || (S.current && S.current.dir) || '';
    el.planSelect.innerHTML = '<option value="">Ny plan …</option>' + S.plans.map(p =>
      '<option value="' + esc(p.dir) + '"' + (p.dir === cur ? ' selected' : '') + '>' +
      esc(p.case + ' · ' + (PLAT[p.plan.platform] || p.plan.platform) + ' ' + p.plan.account.handle + ' · ' + p.plan.period.from + '–' + p.plan.period.to) + '</option>').join('');
    if (cur) {
      const p = S.plans.find(x => x.dir === cur);
      if (p) S.current = { dir: p.dir, plan: p.plan, results: p.results };
    }
    renderPlan();
  }
  el.planSelect.addEventListener('change', () => {
    if (S.running) return;
    const p = S.plans.find(x => x.dir === el.planSelect.value);
    S.current = p ? { dir: p.dir, plan: p.plan, results: p.results } : null;
    renderPlan();
  });

  function windowStatus(i) {
    const rs = (S.current.results || []).filter(r => r.index === i);
    if (!rs.length) return { cls: 'pending', label: '' };
    if (rs.some(r => r.status === 'feil') && !rs.some(r => r.status === 'ok' || r.status === 'tom')) return { cls: 'err', label: rs.filter(r => r.status === 'feil').slice(-1)[0].error || 'feil' };
    if (rs.every(r => r.status === 'tom')) return { cls: 'empty', label: 'ingenting i vinduet' };
    const n = rs.filter(r => r.status === 'ok').length;
    return { cls: 'ok', label: n > 1 ? n + ' sikringer' : 'sikret' };
  }
  function doneCount() {
    if (!S.current) return 0;
    return S.current.plan.windows.filter((w, i) => ['ok', 'empty'].includes(windowStatus(i).cls)).length;
  }

  function renderPlan() {
    const c = S.current;
    el.form.hidden = !!c;
    el.planBtn.hidden = !!c;
    el.runBtn.hidden = !c;
    el.stopBtn.hidden = !c;
    el.planBox.hidden = !c;
    if (!c) { el.runBtn.disabled = true; el.stopBtn.disabled = true; updateForm(); return; }
    const p = c.plan, done = doneCount(), total = p.windows.length;
    el.planMeta.innerHTML = esc((PLAT[p.platform] || p.platform) + ' · ' + p.account.handle) + '<br>' +
      esc(fmtD(p.period.from) + ' – ' + fmtD(p.period.to) + ' · ' + total + ' nedslag à ' + p.method.windowDays + ' døgn') + '<br>' +
      '<span class="bv-muted">Plan laget ' + esc(p.createdAtLocal) + ' · ' + done + ' av ' + total + ' ferdig</span>';
    el.planList.innerHTML = p.windows.map((w, i) => {
      const st = windowStatus(i);
      const extra = p.platform === 'youtube' ? (w.videos.length ? w.videos.length + ' video' + (w.videos.length > 1 ? 'er' : '') : 'ingen videoer') : '';
      return '<li class="bv-plan__row is-' + st.cls + '" data-i="' + i + '"><span class="bv-plan__n">' + (i + 1) + '</span>' +
        '<span class="bv-plan__d">' + esc(w.from === w.lastDay ? fmtD(w.from) : fmtD(w.from) + ' – ' + fmtD(w.lastDay)) + (extra ? ' <span class="bv-muted">· ' + esc(extra) + '</span>' : '') + '</span>' +
        '<span class="bv-plan__s" title="' + esc(st.label) + '">' + ({ ok: '✓', empty: '–', err: '✗', pending: '', running: '…' }[st.cls] || '') + '</span></li>';
    }).join('');
    el.runBtn.disabled = S.running || done === total;
    el.runBtn.textContent = done === 0 ? 'Kjør plan' : (done === total ? 'Ferdig' : 'Fortsett (' + (total - done) + ' igjen)');
    el.stopBtn.disabled = !S.running;
  }

  el.planReveal.addEventListener('click', () => { if (S.current) api.revealInFinder(S.current.dir + '/plan.txt'); });
  $('planNewBtn').addEventListener('click', () => { if (S.running) return; S.current = null; el.planSelect.value = ''; renderPlan(); });

  el.planBtn.addEventListener('click', async () => {
    if (S.running) return;
    const caseName = els.caseInput.value.trim();
    if (!caseName) { setStatus('Skriv inn en sak først', 'err'); els.caseInput.focus(); return; }
    if (!el.account.value.trim()) { setStatus('Skriv inn kontoen', 'err'); el.account.focus(); return; }
    if (!countWindows()) { setStatus('Velg en gyldig periode', 'err'); return; }
    setBusy(true);
    setStatus('Lager plan …');
    try {
      const r = await api.bevisPlanCreate({
        root: state.root, caseName, account: el.account.value.trim(), platform: el.platform.value,
        from: el.from.value, to: el.to.value, mode: el.mode.value, n: +el.n.value, windowDays: +el.win.value,
        perWindow: +el.per.value, note: els.noteInput.value.trim(), pluginVersion: state.pluginVersion,
      });
      if (!r.ok) { setStatus('Kunne ikke lage plan: ' + r.error, 'err'); return; }
      const empty = r.plan.platform === 'youtube' ? r.plan.windows.filter(w => !w.videos.length).length : 0;
      setStatus('Planen er lagret (' + r.plan.windows.length + ' nedslag' + (empty ? ', ' + empty + ' uten videoer' : '') + '). Se gjennom og trykk «Kjør plan».', 'ok');
      await loadPlans(r.dir);
    } finally { setBusy(false); renderPlan(); }
  });

  el.stopBtn.addEventListener('click', () => { if (S.running) { S.stop = true; setStatus('Stopper etter dette nedslaget …'); } });

  // ------------------------------------------------------------
  //  Kjøring
  // ------------------------------------------------------------
  async function logResult(result) {
    await api.bevisPlanResult({ dir: S.current.dir, result });
    (S.current.results = S.current.results || []).push(Object.assign({ at: new Date().toISOString() }, result));
    renderPlan();
  }

  async function captureOne(url, sample, maxScroll) {
    if (window.bvRootReady && !window.bvRootReady()) return { status: 'feil', error: 'ingen arkivmappe', login: true };
    const open = await api.bevisOpen({ url, wait: true, settleMs: 3000 });
    if (!open.ok) return { status: 'feil', error: 'kunne ikke åpne siden' };
    if (/\/(login|i\/flow\/login|accounts\/login)/.test(open.finalUrl || '')) return { status: 'feil', error: 'krever innlogging', login: true };
    const r = await api.bevisCapture({
      root: state.root, caseName: S.current.plan.case, note: els.noteInput.value.trim(), url,
      pluginVersion: state.pluginVersion, options: options(), sample, maxScroll,
    });
    if (!r.ok) return { status: 'feil', error: r.error };
    return { status: 'ok', dir: r.dir, fingerprint: r.fingerprint, warnings: (r.warnings || []).length };
  }

  el.runBtn.addEventListener('click', async () => {
    if (S.running || !S.current) return;
    const p = S.current.plan;
    S.running = true; S.stop = false;
    setBusy(true); renderPlan();
    const total = p.windows.length;
    try {
      for (let i = 0; i < total; i++) {
        if (S.stop) break;
        if (['ok', 'empty'].includes(windowStatus(i).cls)) continue;
        const w = p.windows[i];
        const row = el.planList.querySelector('[data-i="' + i + '"]');
        if (row) { row.className = 'bv-plan__row is-running'; row.scrollIntoView({ block: 'nearest' }); }
        const base = { planId: p.id, index: i, total, from: w.from, lastDay: w.lastDay, until: w.until, platform: p.platform, account: p.account.handle };
        if (p.platform === 'x') {
          setStatus('Nedslag ' + (i + 1) + ' av ' + total + ': ' + fmtD(w.from) + ' …');
          const res = await captureOne(w.url, Object.assign({}, base, { url: w.url, query: decodeURIComponent((w.url.match(/q=([^&]+)/) || [, ''])[1]) }), 25);
          await logResult(Object.assign({ index: i }, res));
          if (res.login) { setStatus('X krever innlogging. Logg inn i sikringsvinduet og trykk «Fortsett».', 'err'); break; }
          if (i < total - 1 && !S.stop && window.bvPace) await window.bvPace(() => S.stop);
        } else if (p.platform === 'youtube') {
          if (!w.videos.length) { await logResult({ index: i, status: 'tom' }); continue; }
          for (const v of w.videos) {
            if (S.stop) break;
            setStatus('Nedslag ' + (i + 1) + ' av ' + total + ': ' + (v.title || v.id).slice(0, 60) + ' …');
            const res = await captureOne(v.url, Object.assign({}, base, { videoId: v.id, videoDateApprox: v.date, url: v.url }), 4);
            await logResult(Object.assign({ index: i, videoId: v.id }, res));
            if (!S.stop && window.bvPace) await window.bvPace(() => S.stop);
          }
        }
        await refresh();
      }
    } finally {
      S.running = false;
      setBusy(false);
      const done = doneCount();
      if (!/krever innlogging/.test(els.status.textContent)) {
        setStatus(S.stop ? 'Stoppet — ' + done + ' av ' + total + ' ferdig. «Fortsett» tar resten.' : (done === total ? 'Planen er gjennomført: ' + total + ' nedslag.' : done + ' av ' + total + ' ferdig — noen feilet, trykk «Fortsett» for å prøve dem igjen.'), done === total ? 'ok' : 'warn');
      }
      S.stop = false;
      renderPlan();
      await refresh();
    }
  });

  // ------------------------------------------------------------
  //  Lagring (kalles fra main.js)
  // ------------------------------------------------------------
  window.bvSampleState = () => ({
    mode: S.mode, platform: el.platform.value, account: el.account.value, from: el.from.value, to: el.to.value,
    smode: el.mode.value, n: el.n.value, win: el.win.value, per: el.per.value,
  });
  window.bvSampleApply = (s) => {
    if (s) {
      if (s.platform && el.platform.querySelector('option[value="' + s.platform + '"]:not([disabled])')) el.platform.value = s.platform;
      el.account.value = s.account || '';
      el.from.value = s.from || ''; el.to.value = s.to || '';
      if (s.smode) el.mode.value = s.smode;
      if (s.n) el.n.value = s.n;
      if (s.win) el.win.value = s.win;
      if (s.per) el.per.value = s.per;
    }
    if (!el.to.value) el.to.value = new Date().toISOString().slice(0, 10);
    updateForm();
    setMode(s && s.mode);
  };
  window.bvSampleRunning = () => S.running;
})();
