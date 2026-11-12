// Faktisk Studio · Mobilnettverk
//
// Skjermbilder (fra Labrador, ALDRI base64) på mobiltelefoner i tre dybdelag over et glødende
// nettverk. Leseren kan trykke på en mobil for å se skjermbildet stort. Motoren (engine.js,
// fmnRun) og embed-byggeren (snippet.js, fmnBuildSnippet) er de samme som i embedden —
// forhåndsvisningen kjører nøyaktig embed-koden.

const PLUGIN_ID = 'mobilnettverk';
let PLUGIN_VERSION = '';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([window.faktisk.appVersion(), window.faktisk.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    if (me && me.version) PLUGIN_VERSION = me.version;
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const $ = id => document.getElementById(id);
const els = {
  shotList: $('shotList'), addShot: $('addShotBtn'),
  front: $('front'), mid: $('mid'), back: $('back'), size: $('size'), reseed: $('reseedBtn'),
  bg: $('bg'), lineColor: $('lineColor'), motion: $('motion'), trigger: $('triggerSelect'),
  optHint: $('optHint'), hintText: $('hintText'), optDrag: $('optDrag'),
  view: $('view'), ring: $('ring'), optArrows: $('optArrows'), optNet: $('optNet'), optShadow: $('optShadow'), optFade: $('optFade'), count: $('count'),
  batchUpload: $('batchUploadBtn'), batchPick: $('batchPickBtn'), batchFile: $('batchFile'), batchPanel: $('batchPanel'), batchStatus: $('batchStatus'),
  aspect: $('aspect'), width: $('widthSelect'), optRound: $('optRound'), padTop: $('padTop'), padBot: $('padBot'),
  altText: $('altText'), caption: $('captionText'),
  previewHost: $('previewHost'), playBtn: $('playBtn'), copyEmbed: $('copyEmbedBtn'),
  back_: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
};

const state = {
  seed: 1 + Math.floor(Math.random() * 99999),
  shots: [],   // { id, url, caption }
};

function uid() { return 's_' + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidUrl(s) { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; } }

// ---------- Labrador-filer ----------
const IMG_EXT = /\.(png|jpe?g|gif|avif|webp)(\?|$)/i;
async function openFilePanel(panel, onPick, reopen) {
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) reopen(); else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 80);
  if (!matching.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder lastet opp ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">' + matching.length + ' bilder (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'ftb-labfile'; item.textContent = f.name; item.title = f.url;
    item.addEventListener('click', () => { panel.style.display = 'none'; onPick(f.url); });
    list.appendChild(item);
  });
}
async function uploadImage(btn, onDone) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; }) : () => {};
  try {
    const res = await window.faktisk.labradorUpload({ filters: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }] });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) onDone(res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally { unsub(); btn.disabled = false; btn.textContent = orig; }
}

// ---------- Skjermbilde-liste ----------
// «Antall» (side om side) følger antall skjermbilder (maks 3) til brukeren
// flytter skyveknappen selv. Før sto den fast på 2, så bilde nr. 3 «vises ikke».
function syncCountToShots() {
  if (state.countManual || isRestoring) return;
  const n = state.shots.filter(x => isValidUrl(x.url || '')).length;
  if (!n) return;
  els.count.value = String(Math.min(3, n));
  $('countOut').textContent = els.count.value;
}

function renderShots() {
  syncCountToShots();
  els.shotList.innerHTML = '';
  if (!state.shots.length) {
    els.shotList.innerHTML = '<p class="hk-hint">Ingen skjermbilder ennå — trykk «+ Skjermbilde».</p>';
    return;
  }
  state.shots.forEach((s, i) => {
    const ok = s.url && isValidUrl(s.url);
    const card = document.createElement('div');
    card.className = 'cb-msg mn-shot';
    card.innerHTML = `
      <div class="hk-row__top">
        ${ok ? `<img class="mn-thumb" src="${escapeHtml(s.url)}" alt="">` : '<span class="mn-thumb mn-thumb--empty"></span>'}
        <span class="mn-num">${i + 1}${els.view.value === 'side' ? (i < (parseInt(els.count.value, 10) || 2) ? ' · vises' : ' · vises ikke') : els.view.value === 'ring' ? (i === 0 ? ' · først foran' : '') : i < (parseInt(els.front.value, 10) || 3) ? ' · foran' : ''}</span>
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-id="${s.id}" ${i === 0 ? 'disabled' : ''} title="Flytt opp">↑</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${s.id}" title="Fjern">×</button>
        </span>
      </div>
      <input class="hk-row__img" value="${escapeHtml(s.url || '')}" data-act="url" data-id="${s.id}" placeholder="Bilde-URL fra Labrador" spellcheck="false">
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="files" data-id="${s.id}">Mine filer ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-id="${s.id}">Last opp…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${s.id}" style="display:none;"></div>
      <input class="hk-row__title" value="${escapeHtml(s.caption || '')}" data-act="caption" data-id="${s.id}" placeholder="Tekst når skjermbildet er forstørret (valgfri)">`;
    els.shotList.appendChild(card);
  });
}
function setShotUrl(id, url) {
  const s = state.shots.find(x => x.id === id);
  if (!s) return;
  s.url = url; renderShots(); scheduleUpdate();
}
els.shotList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const i = state.shots.findIndex(x => x.id === id);
  if (act === 'del') { state.shots.splice(i, 1); renderShots(); scheduleUpdate(); }
  if (act === 'up' && i > 0) { const [s] = state.shots.splice(i, 1); state.shots.splice(i - 1, 0, s); renderShots(); scheduleUpdate(); }
  if (act === 'files') {
    const panel = els.shotList.querySelector(`[data-panel="${id}"]`);
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, url => setShotUrl(id, url), () => { panel.style.display = 'none'; btn.click(); });
  }
  if (act === 'upload') uploadImage(btn, url => setShotUrl(id, url));
});
els.shotList.addEventListener('input', e => {
  const { act, id } = e.target.dataset;
  const s = state.shots.find(x => x.id === id);
  if (!s) return;
  if (act === 'url') { s.url = e.target.value.trim(); scheduleUpdate(); }
  if (act === 'caption') { s.caption = e.target.value; scheduleUpdate(); }
});
els.shotList.addEventListener('change', e => { if (e.target.dataset.act === 'url') renderShots(); });
els.addShot.addEventListener('click', () => { state.shots.push({ id: uid(), url: '', caption: '' }); renderShots(); scheduleUpdate(); });
els.reseed.addEventListener('click', () => { state.seed = 1 + Math.floor(Math.random() * 99999); scheduleUpdate(); });

// ---------- Batch: mange skjermbilder på én gang ----------
// Opplasting går via labradorUploadData (finnes i Studio fra før) — ingen app-oppdatering trengs.
function batchMsg(t, err) {
  els.batchStatus.style.display = t ? '' : 'none';
  els.batchStatus.textContent = t || '';
  els.batchStatus.style.color = err ? '#ffb4b4' : '';
}
function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function uniqueName(name) {
  // Tidsstempel i navnet, så to «Skjermbilde.png» ikke kolliderer i Labrador
  const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name || 'skjermbilde.png');
  const base = (m[1] || 'skjermbilde').replace(/[^\wæøåÆØÅ-]+/g, '-').replace(/-+/g, '-').slice(0, 50);
  return base + '-' + Date.now().toString(36) + (m[2] || '.png').toLowerCase();
}
async function batchUploadFiles(files) {
  files = Array.from(files || []).filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  if (!window.faktisk.labradorUploadData) { await window.faktiskDialog.alert('Denne Studio-versjonen mangler opplasting av bildedata.'); return; }
  // Fjern tomme rader først, så nye bilder ikke havner bak en tom
  state.shots = state.shots.filter(s => (s.url || '').trim() || (s.caption || '').trim());
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    batchMsg(`Laster opp ${i + 1} av ${files.length}: ${f.name}…`);
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error('over 25 MB');
      const dataUrl = await readAsDataUrl(f);
      let res = await window.faktisk.labradorUploadData({ fileName: uniqueName(f.name), dataUrl });
      if (res && res.loggedIn === false) {
        batchMsg('Ikke innlogget i Labrador — logg inn i vinduet som åpnes…');
        const st = await window.faktisk.labradorConnect();
        if (!st.loggedIn) throw new Error('ikke innlogget');
        res = await window.faktisk.labradorUploadData({ fileName: uniqueName(f.name), dataUrl });
      }
      if (!res || !res.ok || !res.url) throw new Error((res && res.error) || 'fant ikke URL etter opplasting');
      state.shots.push({ id: uid(), url: res.url, caption: '' });
      ok++;
      renderShots(); scheduleUpdate();
    } catch (err) {
      fail++; console.warn('[mobilnettverk] opplasting feilet', f.name, err);
    }
  }
  batchMsg(fail ? `${ok} lastet opp, ${fail} feilet (se konsollen).` : `${ok} skjermbilder lastet opp ✓`, !!fail);
  setTimeout(() => { if (!fail) batchMsg(''); }, 5000);
}
els.batchUpload.addEventListener('click', () => { els.batchFile.value = ''; els.batchFile.click(); });
els.batchFile.addEventListener('change', () => batchUploadFiles(els.batchFile.files));
// Dra bilder fra Finder rett inn i lista
['dragenter', 'dragover'].forEach(ev => els.shotList.addEventListener(ev, e => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); els.shotList.classList.add('is-over'); }
}));
['dragleave', 'drop'].forEach(ev => els.shotList.addEventListener(ev, () => els.shotList.classList.remove('is-over')));
els.shotList.addEventListener('drop', e => { e.preventDefault(); batchUploadFiles(e.dataTransfer.files); });
// Velg flere bilder som allerede ligger i Labrador
els.batchPick.addEventListener('click', async () => {
  const panel = els.batchPanel;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); } catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => { const st = await window.faktisk.labradorConnect(); panel.style.display = 'none'; if (st.loggedIn) els.batchPick.click(); });
    return;
  }
  const imgs = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 120);
  if (!imgs.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder i Labrador ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">Klikk for å velge (nyeste først)</div><div class="mn-batch-list"></div>' +
    '<div class="ftb-labrow"><button type="button" class="ftb-labbtn" data-act="add">Legg til valgte (0)</button><button type="button" class="ftb-labbtn" data-act="close">Lukk</button></div>';
  const list = panel.querySelector('.mn-batch-list'), addBtn = panel.querySelector('[data-act="add"]');
  const chosen = [];
  imgs.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mn-batch-item'; b.title = f.name;
    b.innerHTML = '<img loading="lazy" src="' + escapeHtml(f.url) + '" alt="">';
    b.addEventListener('click', () => {
      const i = chosen.indexOf(f.url);
      if (i >= 0) chosen.splice(i, 1); else chosen.push(f.url);
      b.classList.toggle('is-on', i < 0);
      addBtn.textContent = 'Legg til valgte (' + chosen.length + ')';
    });
    list.appendChild(b);
  });
  addBtn.addEventListener('click', () => {
    if (!chosen.length) return;
    state.shots = state.shots.filter(s => (s.url || '').trim() || (s.caption || '').trim());
    chosen.forEach(u => state.shots.push({ id: uid(), url: u, caption: '' }));
    panel.style.display = 'none'; renderShots(); scheduleUpdate();
  });
  panel.querySelector('[data-act="close"]').addEventListener('click', () => { panel.style.display = 'none'; });
});

// ---------- Konfig → embed ----------
function readConfig() {
  return {
    items: state.shots.filter(s => isValidUrl(s.url || '')).map(s => ({ src: s.url, caption: (s.caption || '').trim() })),
    front: parseInt(els.front.value, 10), mid: parseInt(els.mid.value, 10), back: parseInt(els.back.value, 10),
    size: parseFloat(els.size.value), seed: state.seed,
    bg: els.bg.value, lineColor: els.lineColor.value, motion: parseInt(els.motion.value, 10), trigger: els.trigger.value,
    hint: els.optHint.checked, hintText: els.hintText.value.trim(), drag: els.optDrag.checked,
    view: els.view.value, ring: parseInt(els.ring.value, 10), arrows: els.optArrows.checked,
    net: els.optNet.checked, shadow: els.optShadow.checked, fade: els.optFade.checked, count: parseInt(els.count.value, 10),
    aspect: els.aspect.value, width: els.width.value, round: els.optRound.checked,
    padTop: parseInt(els.padTop.value, 10), padBot: parseInt(els.padBot.value, 10),
    alt: els.altText.value.trim(), caption: els.caption.value.trim(), version: PLUGIN_VERSION,
  };
}
function buildEmbedSnippet(cfg) {
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fmn-container') : '';
  return fmnBuildSnippet(cfg || readConfig(), fmnRun.toString(), baseCss);
}

// ---------- Forhåndsvisning ----------
function mountSnippet(host, html, isStatic) {
  // Lysbokser fra forrige forhåndsvisning ligger i <body> — rydd dem
  document.querySelectorAll('[class*="fmn-lb-"]').forEach(n => n.remove());
  host.innerHTML = html;
  const root = host.querySelector('.fmn-frame > [id^="fmn-"]');
  if (root && isStatic) root.setAttribute('data-static', '');
  host.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script'); s.textContent = old.textContent; old.replaceWith(s);
  });
  return root;
}
function renderPreview() {
  updateOutputs();
  mountSnippet(els.previewHost, buildEmbedSnippet(readConfig()), true);
}
els.playBtn.addEventListener('click', () => {
  const root = mountSnippet(els.previewHost, buildEmbedSnippet(Object.assign(readConfig(), { trigger: 'early' })), false);
  if (root && root.__fmnPlay) root.__fmnPlay();
});
const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = $('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

function updateOutputs() {
  $('frontOut').textContent = els.front.value;
  $('ringOut').textContent = els.ring.value;
  document.body.classList.toggle('mn-ring', els.view.value === 'ring');
  document.body.classList.toggle('mn-side', els.view.value === 'side');
  document.body.classList.toggle('mn-light', els.bg.value === 'white' || els.bg.value === 'none');
  $('countOut').textContent = els.count.value;
  $('midOut').textContent = els.mid.value;
  $('backOut').textContent = els.back.value;
  $('sizeOut').textContent = Math.round(parseFloat(els.size.value) * 100) + ' %';
  $('padTopOut').textContent = els.padTop.value + ' px';
  $('padBotOut').textContent = els.padBot.value + ' px';
  els.hintText.style.display = els.optHint.checked ? '' : 'none';
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, 200);
}

els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.items.length) { await window.faktiskDialog.alert('Legg til minst ett skjermbilde fra Labrador først.'); return; }
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet(cfg));
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});
els.back_.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => { await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file'); });

// ---------- Lagring ----------
const FIELDS = ['view', 'count', 'ring', 'front', 'mid', 'back', 'size', 'bg', 'lineColor', 'motion', 'trigger', 'hintText', 'aspect', 'width', 'padTop', 'padBot', 'altText', 'caption'];
const CHECKS = ['optHint', 'optRound', 'optDrag', 'optArrows', 'optNet', 'optShadow', 'optFade'];
let isRestoring = false;
function serializeState() {
  const o = { seed: state.seed, countManual: !!state.countManual, shots: state.shots.map(s => ({ id: s.id, url: s.url, caption: s.caption })) };
  FIELDS.forEach(f => { o[f] = els[f].value; });
  CHECKS.forEach(f => { o[f] = els[f].checked; });
  return o;
}
function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    FIELDS.forEach(f => { if (s[f] != null) els[f].value = s[f]; });
    CHECKS.forEach(f => { if (typeof s[f] === 'boolean') els[f].checked = s[f]; });
    if (s.seed) state.seed = s.seed;
    state.countManual = s.countManual === true;
    if (Array.isArray(s.shots)) state.shots = s.shots.map(x => ({ id: x.id || uid(), url: x.url || '', caption: x.caption || '' }));
    renderShots(); renderPreview();
  } finally { isRestoring = false; }
}
function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}
FIELDS.forEach(f => { els[f].addEventListener('input', scheduleUpdate); els[f].addEventListener('change', scheduleUpdate); });
CHECKS.forEach(f => els[f].addEventListener('change', scheduleUpdate));
els.front.addEventListener('input', renderShots);
els.view.addEventListener('change', renderShots);
els.count.addEventListener('input', e => { if (e.isTrusted) state.countManual = true; renderShots(); });
// Lys bakgrunn: standard lyseblå linjefarge blir for svak mot hvitt — bytt mellom mørk/lys standard
// (bare hvis brukeren ikke har valgt egen farge).
const LINE_DARK_BG = '#6fa8ff', LINE_LIGHT_BG = '#2f6fe4';
els.bg.addEventListener('change', () => {
  const light = els.bg.value === 'white' || els.bg.value === 'none', cur = els.lineColor.value.toLowerCase();
  if (light && cur === LINE_DARK_BG) els.lineColor.value = LINE_LIGHT_BG;
  if (!light && cur === LINE_LIGHT_BG) els.lineColor.value = LINE_DARK_BG;
  scheduleUpdate();
});

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => { const o = document.createElement('option'); o.value = p.fileId; o.textContent = p.name; sel.appendChild(o); });
  } catch (e) { console.error(e); }
}
els.saveProject.addEventListener('click', async () => {
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', `Mobilnettverk ${new Date().toLocaleDateString('no')}`);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) await refreshProjectList();
});
els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) applyState(res.state);
});

(async function init() {
  setPreviewWidth(680);
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) { applyState(res.state); els.projectSelect.value = fileId; return; }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) { applyState(res.state); return; }
  } catch (e) {}
  state.shots = [{ id: uid(), url: '', caption: '' }];
  renderShots(); renderPreview();
})();
