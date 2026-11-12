// Faktisk Studio · Utklipp i boks
//
// Et utklippet bilde (PNG uten bakgrunn) i en boks med farge, bilde eller video bak. Utklippet glir opp
// fra bunnen når leseren scroller dit, og blir stående. Embedden er ren HTML/CSS + litt ES5 (snippet.js).
// Alle filer lenkes fra Labrador – aldri base64.

const PLUGIN_ID = 'utklipp-boks';
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
const FIELDS = ['fgW', 'fgX', 'fgBottom', 'fgRot', 'from', 'ease', 'dur', 'delay', 'aspect', 'mobileAspect', 'radius', 'shadow',
  'bgType', 'bgColor', 'bgDim', 'bgBlur', 'width', 'align', 'caption', 'altText'];
const CHECKS = ['fgShadow'];
const els = {};
FIELDS.concat(CHECKS).forEach(f => { els[f] = $(f); });
Object.assign(els, {
  fgBox: $('fgBox'), bgBox: $('bgBox'), previewHost: $('previewHost'), replay: $('replayBtn'),
  copyEmbed: $('copyEmbedBtn'), back_: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
});

const state = { fgSrc: '', bgSrc: '' };

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());

// ---------- Labrador-filer ----------
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i, VID_EXT = /\.(mp4|m4v|mov|webm)(\?|$)/i;
const extOk = (accept, url) => accept === 'video' ? VID_EXT.test(url) : accept === 'image' ? IMG_EXT.test(url) : IMG_EXT.test(url) || VID_EXT.test(url);
async function openFilePanel(panel, accept, onPick, reopen) {
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
  const files = (res.files || []).filter(f => extOk(accept, f.url)).slice(0, 120);
  if (!files.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen passende filer i Labrador ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">' + files.length + ' filer (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  files.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'ftb-labfile'; item.title = f.url;
    item.innerHTML = (IMG_EXT.test(f.url) ? '<img loading="lazy" src="' + escapeHtml(f.url) + '" alt="">' : '<span class="fli-vidtag">▶</span>') + '<span>' + escapeHtml(f.name) + '</span>';
    item.addEventListener('click', () => { panel.style.display = 'none'; onPick(f.url); });
    list.appendChild(item);
  });
}
async function uploadFile(btn, accept, onDone) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; }) : () => {};
  const filters = accept === 'video' ? [{ name: 'Video', extensions: ['mp4', 'm4v'] }]
    : accept === 'image' ? [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    : [{ name: 'Bilde eller video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'm4v'] }];
  try {
    const res = await window.faktisk.labradorUpload({ filters });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) onDone(res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally { unsub(); btn.disabled = false; btn.textContent = orig; }
}
// felt for én fil: adresse + Mine filer + Last opp
function mediaField(value, accept, onSet) {
  const box = document.createElement('div'); box.className = 'fli-mediafield';
  const ok = isUrl(value), vid = VID_EXT.test(value || '');
  box.innerHTML = `<div class="fli-mrow">${ok ? (vid ? '<span class="mn-thumb fli-vthumb">▶</span>' : `<img class="mn-thumb" src="${escapeHtml(value)}" alt="">`) : '<span class="mn-thumb mn-thumb--empty"></span>'}
      <input class="hk-row__img" value="${escapeHtml(value || '')}" placeholder="${accept === 'video' ? 'MP4-adresse fra Labrador' : 'Bildeadresse fra Labrador (PNG/JPG)'}" spellcheck="false"></div>
    <div class="ftb-labrow"><button class="ftb-labbtn" type="button" data-f="files">Mine filer ▾</button><button class="ftb-labbtn" type="button" data-f="upload">Last opp…</button></div>
    <div class="ftb-labpanel" style="display:none;"></div>`;
  const inp = box.querySelector('input'), panel = box.querySelector('.ftb-labpanel');
  inp.addEventListener('change', () => onSet(inp.value.trim(), true));
  inp.addEventListener('input', () => onSet(inp.value.trim(), false));
  const filesBtn = box.querySelector('[data-f=files]');
  filesBtn.addEventListener('click', () => {
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, accept, url => onSet(url, true), () => { panel.style.display = 'none'; filesBtn.click(); });
  });
  box.querySelector('[data-f=upload]').addEventListener('click', e => uploadFile(e.currentTarget, accept, url => onSet(url, true)));
  return box;
}


function renderMediaFields() {
  els.fgBox.innerHTML = '';
  els.fgBox.appendChild(mediaField(state.fgSrc, 'image', (url, commit) => { state.fgSrc = url; if (commit) renderMediaFields(); scheduleUpdate(commit); }));
  els.bgBox.innerHTML = '';
  const t = els.bgType.value;
  if (t === 'image' || t === 'video') els.bgBox.appendChild(mediaField(state.bgSrc, t, (url, commit) => { state.bgSrc = url; if (commit) renderMediaFields(); scheduleUpdate(false); }));
}

// ---------- konfig ----------
function readConfig() {
  const v = f => els[f].value;
  return {
    fgSrc: isUrl(state.fgSrc) ? state.fgSrc.trim() : '', fgW: +v('fgW'), fgX: +v('fgX'), fgBottom: +v('fgBottom'), fgRot: +v('fgRot'), fgShadow: els.fgShadow.checked,
    from: v('from'), ease: v('ease'), dur: +v('dur'), delay: +v('delay'),
    aspect: v('aspect'), mobileAspect: v('mobileAspect'), radius: +v('radius'), shadow: v('shadow'),
    bgType: v('bgType'), bgColor: v('bgColor'), bgSrc: isUrl(state.bgSrc) ? state.bgSrc.trim() : '', bgDim: +v('bgDim'), bgBlur: +v('bgBlur'),
    width: +v('width'), align: v('align'), caption: v('caption').trim(), alt: v('altText').trim(), version: PLUGIN_VERSION,
  };
}
function buildEmbedSnippet(cfg) {
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fub-container') : '';
  return fubBuildSnippet(cfg, baseCss);
}
function updateUI() {
  const media = els.bgType.value !== 'color';
  document.querySelectorAll('.ub-bgmedia').forEach(e => { e.style.display = media ? '' : 'none'; });
  const out = (id, t) => { const o = $(id + 'Out'); if (o) o.textContent = t; };
  out('fgW', els.fgW.value + ' %'); out('fgX', els.fgX.value + ' %'); out('fgBottom', els.fgBottom.value + ' %'); out('fgRot', els.fgRot.value + '°');
  out('dur', (+els.dur.value).toFixed(2) + ' s'); out('delay', (+els.delay.value).toFixed(2) + ' s');
  out('radius', els.radius.value + ' px'); out('bgDim', Math.round(els.bgDim.value * 100) + ' %'); out('bgBlur', els.bgBlur.value + ' px');
  out('width', els.width.value + ' px');
}

// ---------- forhåndsvisning ----------
function renderPreview(animate) {
  const cfg = readConfig(); cfg.static = true;
  const host = els.previewHost;
  host.innerHTML = buildEmbedSnippet(cfg);
  host.querySelectorAll('script').forEach(old => {
    if (!animate) { old.remove(); return; }
    const s = document.createElement('script'); s.textContent = old.textContent; old.replaceWith(s);
  });
  const box = host.querySelector('.fub-box');
  if (box && !cfg.fgSrc) { const d = document.createElement('div'); d.className = 'ub-empty'; d.textContent = 'Velg et utklipp (PNG) fra Labrador'; box.appendChild(d); }
  if (!animate) { const v = host.querySelector('video'); if (v) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } }
}

// dra utklippet
let drag = null;
els.previewHost.addEventListener('pointerdown', e => {
  const fg = e.target.closest('.fub-fg'); if (!fg) return;
  const box = fg.closest('.fub-box'); if (!box) return;
  e.preventDefault();
  drag = { fg, box, x0: e.clientX, y0: e.clientY, fx: +els.fgX.value, fb: +els.fgBottom.value };
  fg.classList.add('is-drag');
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = drag.box.getBoundingClientRect();
  const x = Math.max(-20, Math.min(120, Math.round((drag.fx + (e.clientX - drag.x0) / r.width * 100) * 2) / 2));
  const b = Math.max(-60, Math.min(60, Math.round((drag.fb - (e.clientY - drag.y0) / r.height * 100) * 2) / 2));
  els.fgX.value = x; els.fgBottom.value = b;
  drag.fg.style.left = x + '%'; drag.fg.style.bottom = b + '%';
  updateUI();
});
const endDrag = () => { if (!drag) return; drag.fg.classList.remove('is-drag'); drag = null; scheduleUpdate(false); };
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
els.replay.addEventListener('click', () => renderPreview(true));

const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = $('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

// ---------- oppdatering og lagring ----------
let isRestoring = false, saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveStateNow, 300); }
function scheduleUpdate(animate) { updateUI(); renderPreview(!!animate); saveSoon(); }
const ANIM_FIELDS = ['from', 'ease', 'dur', 'delay'];
FIELDS.concat(CHECKS).forEach(f => {
  const anim = ANIM_FIELDS.indexOf(f) >= 0;
  els[f].addEventListener('input', () => scheduleUpdate(false));
  els[f].addEventListener('change', () => scheduleUpdate(anim));
});
els.bgType.addEventListener('change', () => renderMediaFields());

function serializeState() {
  const o = { fgSrc: state.fgSrc, bgSrc: state.bgSrc };
  FIELDS.forEach(f => { o[f] = els[f].value; });
  CHECKS.forEach(f => { o[f] = els[f].checked; });
  return JSON.parse(JSON.stringify(o));
}
function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    FIELDS.forEach(f => { if (s[f] != null) els[f].value = s[f]; });
    CHECKS.forEach(f => { if (typeof s[f] === 'boolean') els[f].checked = s[f]; });
    state.fgSrc = s.fgSrc || ''; state.bgSrc = s.bgSrc || '';
    renderMediaFields(); updateUI(); renderPreview(true);
  } finally { isRestoring = false; }
}
function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

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
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', `Utklipp i boks ${new Date().toLocaleDateString('no')}`);
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

// ---------- embed ----------
// Stillbilde av bakgrunnsvideoen (ffmpeg + opplasting til Labrador, gjenbrukes). Vises når autoplay
// er blokkert, f.eks. lav strømmodus på iPhone.
async function videoPoster(url) {
  if (!url || !window.faktisk.labradorThumbnail) return '';
  try { const r = await window.faktisk.labradorThumbnail({ url, atTime: 0 }); return r && r.ok && r.url ? r.url : ''; } catch (e) { return ''; }
}

els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.fgSrc && !(await window.faktiskDialog.confirm('Utklippet mangler (eller er ikke en adresse fra Labrador). Kopiere likevel?'))) return;
  if (cfg.bgType !== 'color' && !cfg.bgSrc && !(await window.faktiskDialog.confirm('Bakgrunnen mangler fil fra Labrador – da vises bare fargen. Kopiere likevel?'))) return;
  try {
    if (cfg.bgType === 'video' && cfg.bgSrc) { els.copyEmbed.textContent = 'Lager stillbilde …'; cfg.bgPoster = await videoPoster(cfg.bgSrc); }
    const html = buildEmbedSnippet(cfg);
    await window.faktisk.copyToClipboard(html);
    els.copyEmbed.textContent = '✅ Kopiert (' + Math.max(1, Math.round(html.length / 1024)) + ' KB)! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 5000);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});
els.back_.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => { await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file'); });

(async function init() {
  setPreviewWidth(680);
  renderMediaFields(); updateUI(); renderPreview(true);
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
    if (res.ok && res.state) applyState(res.state);
  } catch (e) {}
})();
