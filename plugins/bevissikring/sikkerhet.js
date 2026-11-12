// Faktisk Studio · Bevissikring — arkivmappe, sikkerhet og oppfølging
// (lastes etter main.js og bruker state, els, setStatus, refresh, render)
//
//  • Arkivmappa må velges før noe sikres — ingen stille standardmappe.
//    Varsler hvis mappa synkes til iCloud, Google Drive, Dropbox eller OneDrive.
//  • Kryptert arkiv: et macOS-diskbilde (AES-256) som låses opp med passord.
//  • Innstillinger: navn i manifestet, uavhengig tidsstempel, tempo på SoMe.
//  • Tempo: tilfeldige pauser mellom innlegg og nedslag (window.bvPace).
//  • Stories fra Instagram, og «Følg med» på sikrede adresser.

(function () {
  const api = window.faktisk;
  const $ = id => document.getElementById(id);
  if (typeof api.bevisSettingsGet !== 'function') return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const el = {
    setup: $('rootSetup'), setupPick: $('setupPickBtn'), setupVault: $('setupVaultBtn'),
    warn: $('rootWarn'), vaultBox: $('vaultBox'), vaultInfo: $('vaultInfo'), vaultPw: $('vaultPw'), vaultOpen: $('vaultOpenBtn'), vaultClose: $('vaultCloseBtn'),
    vForm: $('vaultForm'), vName: $('vName'), vSize: $('vSize'), vPw: $('vPw'), vPw2: $('vPw2'), vCreate: $('vCreateBtn'), vCancel: $('vCancelBtn'),
    name: $('setName'), account: $('setAccount'), stamp: $('setStamp'), pace: $('setPace'), newVault: $('newVaultBtn'),
    stories: $('storiesBtn'),
  };
  state.settings = { timestamp: true, userName: '', pace: 'forsiktig' };
  state.vault = null;
  state.watches = [];
  state.rootInfo = null;

  // ------------------------------------------------------------
  //  Arkivmappe
  // ------------------------------------------------------------
  async function rootChanged() {
    const has = !!state.root;
    el.setup.hidden = has;
    document.body.classList.toggle('bv-noroot', !has);
    state.rootInfo = has ? await api.bevisPathInfo({ path: state.root }) : null;
    const s = await api.bevisSettingsGet();
    state.vault = s.vault;
    const info = state.rootInfo || {};
    const warn = [];
    if (has && info.cloud) warn.push('Mappa synkes til ' + esc(info.cloud) + '. Sikringene havner da også i skyen — hos en tredjepart, og kanskje på andre maskiner. Velg en lokal mappe eller et kryptert arkiv for kildesensitivt materiale.');
    if (has && !info.exists) warn.push(info.vault || (state.vault && state.root.startsWith('/Volumes/')) ? 'Det krypterte arkivet er låst. Lås det opp nedenfor.' : 'Mappa finnes ikke lenger (flyttet, eller på en disk som ikke er koblet til). Velg mappe på nytt.');
    el.warn.innerHTML = warn.map(w => '<p class="bv-hint bv-hint--warn">' + w + '</p>').join('');
    // Kryptert arkiv
    const v = state.vault;
    el.vaultBox.hidden = !v;
    if (v) {
      el.vaultInfo.innerHTML = 'Kryptert arkiv «' + esc(v.name) + '» — ' + (v.mounted ? '<b>åpent</b>' : 'låst');
      el.vaultPw.hidden = el.vaultOpen.hidden = !!v.mounted;
      el.vaultClose.hidden = !v.mounted;
    }
    const blocked = !has || !info.exists;
    ['captureBtn', 'regionBtn', 'videoBtn', 'storiesBtn', 'planBtn', 'runBtn', 'pInfoBtn', 'pScanBtn', 'pRunBtn', 'lRunBtn', 'linkExtBtn'].forEach(id => {
      const b = $(id); if (b) b.classList.toggle('bv-needroot', blocked);
    });
  }
  window.bvRootChanged = rootChanged;
  window.bvRootReady = function () {
    if (!state.root) { setStatus('Velg arkivmappe først — se øverst til venstre', 'err'); el.setup.hidden = false; el.setup.scrollIntoView({ block: 'nearest' }); return false; }
    if (state.rootInfo && !state.rootInfo.exists) { setStatus(state.rootInfo.vault ? 'Lås opp det krypterte arkivet først' : 'Arkivmappa finnes ikke — velg den på nytt', 'err'); return false; }
    return true;
  };

  async function pick() {
    const r = await api.openFileDialog({ title: 'Velg mappe for bevissikring', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return;
    const info = await api.bevisPathInfo({ path: r.path });
    if (info.cloud) {
      const ok = await window.faktiskDialog.confirm('Mappa synkes til ' + info.cloud + '. Alt som sikres, lastes da også opp dit. Bruke den likevel?', true);
      if (!ok) return;
    }
    setRoot(r.path);
  }
  function setRoot(p) {
    state.root = p;
    if (typeof renderRoot === 'function') renderRoot();
    scheduleSaveState(); refresh(); rootChanged();
  }
  el.setupPick.addEventListener('click', pick);
  window.bvPickRoot = pick;

  // ------------------------------------------------------------
  //  Kryptert arkiv
  // ------------------------------------------------------------
  function showVaultForm(show) {
    el.vForm.hidden = !show;
    if (show) { el.vPw.value = el.vPw2.value = ''; el.vName.focus(); el.vForm.scrollIntoView({ block: 'nearest' }); }
  }
  el.setupVault.addEventListener('click', () => showVaultForm(true));
  el.newVault.addEventListener('click', () => showVaultForm(true));
  el.vCancel.addEventListener('click', () => showVaultForm(false));
  el.vCreate.addEventListener('click', async () => {
    if (el.vPw.value.length < 8) { setStatus('Passordet må ha minst 8 tegn', 'err'); el.vPw.focus(); return; }
    if (el.vPw.value !== el.vPw2.value) { setStatus('Passordene er ikke like', 'err'); el.vPw2.focus(); return; }
    const where = await api.openFileDialog({ title: 'Hvor skal arkivfila ligge?', properties: ['openDirectory', 'createDirectory'] });
    if (where.canceled) return;
    const info = await api.bevisPathInfo({ path: where.path });
    if (info.cloud && !(await window.faktiskDialog.confirm('Arkivfila havner i ' + info.cloud + '. Innholdet er kryptert, men fila synkes. Fortsette?', true))) return;
    el.vCreate.disabled = true;
    setStatus('Lager kryptert arkiv …');
    try {
      const r = await api.bevisVaultCreate({ dir: where.path, name: el.vName.value.trim(), sizeGB: +el.vSize.value || 50, password: el.vPw.value });
      if (!r.ok) { setStatus('Fikk ikke laget arkivet: ' + r.error, 'err'); return; }
      showVaultForm(false);
      setStatus('Kryptert arkiv laget og åpnet. Passordet lagres ikke — ta vare på det (f.eks. i redaksjonens passordhvelv).', 'ok');
      setRoot(r.mountpoint);
    } finally { el.vCreate.disabled = false; el.vPw.value = el.vPw2.value = ''; }
  });
  el.vaultOpen.addEventListener('click', async () => {
    const r = await api.bevisVaultOpen({ password: el.vaultPw.value });
    el.vaultPw.value = '';
    if (!r.ok) { setStatus(r.error, 'err'); return; }
    setStatus('Arkivet er åpent', 'ok');
    if (!state.root || state.root.startsWith('/Volumes/')) setRoot(r.mountpoint); else rootChanged();
  });
  el.vaultPw.addEventListener('keydown', e => { if (e.key === 'Enter') el.vaultOpen.click(); });
  el.vaultClose.addEventListener('click', async () => {
    const r = await api.bevisVaultClose();
    if (!r.ok) { setStatus('Fikk ikke låst: ' + r.error, 'err'); return; }
    setStatus('Arkivet er låst', 'ok');
    rootChanged(); refresh();
  });

  // ------------------------------------------------------------
  //  Innstillinger
  // ------------------------------------------------------------
  let setTimer = null;
  function saveSettings() {
    clearTimeout(setTimer);
    setTimer = setTimeout(() => {
      state.settings = { userName: el.name.value.trim(), account: el.account ? el.account.value.trim() : '', timestamp: el.stamp.checked, pace: el.pace.value };
      api.bevisSettingsSet(state.settings).catch(() => {});
    }, 300);
  }
  el.name.addEventListener('input', saveSettings);
  if (el.account) el.account.addEventListener('input', saveSettings);
  el.stamp.addEventListener('change', saveSettings);
  el.pace.addEventListener('change', saveSettings);

  // Tilfeldig pause mellom elementer i en serie. Faste intervaller og høyt
  // tempo er det plattformene ser etter når de stenger kontoer.
  window.bvPace = async function (isStopped) {
    const careful = state.settings.pace !== 'normal';
    const ms = careful ? 8000 + Math.random() * 17000 : 2500 + Math.random() * 5000;
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (isStopped && isStopped()) return;
      setStatus('Pause ' + Math.ceil((until - Date.now()) / 1000) + ' s (' + (careful ? 'forsiktig' : 'normalt') + ' tempo) …');
      await new Promise(r => setTimeout(r, 500));
    }
    setStatus('');
  };

  // ------------------------------------------------------------
  //  Stories
  // ------------------------------------------------------------
  el.stories.addEventListener('click', async () => {
    if (state.busy || !window.bvRootReady()) return;
    const caseName = els.caseInput.value.trim();
    if (!caseName) { setStatus('Skriv inn en sak — sikringene samles per sak', 'err'); els.caseInput.focus(); return; }
    const url = els.urlInput.value.trim();
    if (!url) { setStatus('Lim inn lenken til Instagram-profilen', 'err'); els.urlInput.focus(); return; }
    setBusy(true);
    setStatus('Henter stories …');
    try {
      const r = await api.bevisStories({ root: state.root, caseName, url, note: els.noteInput.value.trim(), pluginVersion: state.pluginVersion });
      if (r.cancelled) { setStatus('Avbrutt'); return; }
      if (!r.ok) { setStatus(r.error, 'err'); return; }
      state.highlight = r.dir;
      setStatus('Stories lagret (' + fmtSize(r.bytes) + ')', 'ok');
      await refresh();
    } finally { setBusy(false); }
  });

  // ------------------------------------------------------------
  //  Følg med
  // ------------------------------------------------------------
  window.bvWatchFor = dir => state.watches.find(w => w.dir === dir) || null;
  window.bvCardAction = async function (act, it, btn) {
    if (act === 'stamp') {
      btn.disabled = true; btn.textContent = 'Henter …';
      const r = await api.bevisStamp({ dir: it.dir });
      if (!r.ok) setStatus('Tidsstempel feilet: ' + r.error, 'err'); else setStatus('Tidsstemplet ' + fmtTime(r.genTime), 'ok');
      await refresh();
      return true;
    }
    if (act === 'watch') {
      const r = await api.bevisWatchAdd({ dir: it.dir, hours: 24 });
      setStatus(r.ok ? 'Følger med på adressen — sjekkes hver 24. time mens Studio er åpent' : r.error, r.ok ? 'ok' : 'err');
      return true;
    }
    if (act === 'unwatch') {
      const w = window.bvWatchFor(it.dir);
      if (w) await api.bevisWatchRemove({ id: w.id });
      return true;
    }
    if (act === 'watchnow') {
      const w = window.bvWatchFor(it.dir);
      if (w) { await api.bevisWatchCheck({ id: w.id }); setStatus('Sjekker adressen …'); }
      return true;
    }
    return false;
  };
  window.bvWatchHtml = function (it) {
    const w = window.bvWatchFor(it.dir);
    if (!w) return '';
    const cls = w.lastStatus === 'borte' ? 'bad' : w.lastStatus === 'endret' ? 'warn' : 'ok';
    return '<div class="bv-watch bv-watch--' + cls + '">Følger med' + (w.lastCheck ? ' · sjekket ' + esc(fmtTime(w.lastCheck)) + ': ' + esc(w.lastStatus) + (w.lastDetail ? ' — ' + esc(w.lastDetail) : '') : ' · venter på første sjekk') +
      ' <button class="link-btn bv-inline" data-act="watchnow" type="button">Sjekk nå</button></div>';
  };
  async function loadWatches() {
    const r = await api.bevisWatchList();
    state.watches = (r && r.watches) || [];
    render();
  }
  if (api.onBevisWatchChanged) api.onBevisWatchChanged(list => { state.watches = list || []; render(); });

  // ------------------------------------------------------------
  //  Oppstart (main.js venter på denne før lista tegnes)
  // ------------------------------------------------------------
  window.bvSecurityInit = async function () {
    const s = await api.bevisSettingsGet();
    state.settings = s.settings;
    el.name.value = s.settings.userName || '';
    if (el.account) el.account.value = s.settings.account || '';
    el.stamp.checked = s.settings.timestamp !== false;
    el.pace.value = s.settings.pace || 'forsiktig';
    await loadWatches();
    await rootChanged();
  };
})();
