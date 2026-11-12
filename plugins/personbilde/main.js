// Faktisk Studio · Personbilde
//
// Et bilde fra Labrador med navn og tittel: under bildet, i bobler som popper opp (dra dem dit
// de passer i forhåndsvisningen) eller i en boks. Boks/sirkel, avrunding, ramme, skygge og en
// langsom «pust». Embedden er ren HTML/CSS + et lite ES5-skript (snippet.js). Ingen base64.

const PLUGIN_ID = 'personbilde';
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
const FIELDS = ['shape', 'aspect', 'radius', 'zoom', 'focusX', 'focusY', 'frameColor', 'frameW', 'shadow', 'breathe', 'breatheAmt', 'breatheDur',
  'name', 'title', 'textMode', 'textAlign', 'bubbleStyle', 'tailName', 'tailTitle', 'popDelay', 'popGap', 'boxStyle', 'boxPlace', 'boxRadius',
  'width', 'align', 'credit', 'altText'];
const CHECKS = ['frame', 'oneBubble'];
const els = {};
FIELDS.concat(CHECKS).forEach(f => { els[f] = $(f); });
Object.assign(els, {
  imgBox: $('imgBox'), previewHost: $('previewHost'), replay: $('replayBtn'), resetPos: $('resetPos'),
  copyEmbed: $('copyEmbedBtn'), back_: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
});

const DEF_NAME = { x: 30, y: 78 }, DEF_TITLE = { x: 64, y: 90 };
const state = { src: '', srcVariants: null, posName: Object.assign({}, DEF_NAME), posTitle: Object.assign({}, DEF_TITLE) };

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());
const safeUrl = s => String(s || '').trim().replace(/ /g, '%20');

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
  const all = res.files || [];
  const files = all.filter(f => extOk(accept, f.url)).slice(0, 120);
  if (!files.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen passende filer i Labrador ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">' + files.length + ' filer (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  files.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'ftb-labfile'; item.title = f.url;
    item.innerHTML = (IMG_EXT.test(f.url) ? '<img loading="lazy" src="' + escapeHtml(f.url) + '" alt="">' : '<span class="fli-vidtag">▶</span>') + '<span>' + escapeHtml(f.name) + '</span>';
    item.addEventListener('click', () => { panel.style.display = 'none'; onPick(f.url, variantsFromList(all, f)); });
    list.appendChild(item);
  });
}
// Komprimerte varianter fra Studio heter <navn>-<hash6>-<bredde>.(avif|jpg|webp|png).
// Velges én av dem i «Mine filer», finner vi søsknene og bygger srcset på nytt.
function variantsFromList(all, f) {
  // Studio 0.7.9+ legger variantene på oppføringen (og skjuler søsknene i lista)
  if (f.variants && f.variants.fallback && f.variants.fallback.length) {
    const ext = (f.name || '').split('.').pop().toLowerCase();
    return { avif: f.variants.avif || [], fallback: f.variants.fallback, fallbackType: ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg' };
  }
  const m = /^(.*-[0-9a-f]{6})-(\d+)\.(avif|jpg|webp|png)$/i.exec(f.name || '');
  if (!m) return null;
  const stem = m[1].toLowerCase(), avif = [], fallback = [];
  let fbType = '';
  all.forEach(x => {
    const k = /^(.*-[0-9a-f]{6})-(\d+)\.(avif|jpg|webp|png)$/i.exec(x.name || '');
    if (!k || k[1].toLowerCase() !== stem) return;
    const v = { w: +k[2], url: x.url }, ext = k[3].toLowerCase();
    if (ext === 'avif') avif.push(v); else { fallback.push(v); fbType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg'; }
  });
  const uniq = arr => arr.filter((v, i) => arr.findIndex(o => o.w === v.w) === i).sort((a, b) => a.w - b.w);
  const fb = uniq(fallback);
  return fb.length ? { avif: uniq(avif), fallback: fb, fallbackType: fbType } : null;
}
let mediaStat = '';
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.round(n / 1024) + ' KB';
// Alt-klikk på «Last opp…» sender originalfila uten komprimering.
async function uploadFile(btn, accept, onDone, ev, statEl) {
  btn.disabled = true;
  const orig = btn.textContent;
  const optimize = !(ev && ev.altKey);
  // feltet tegnes på nytt når bildet settes, så teksten huskes i mediaStat
  const say = t => { mediaStat = t || ''; const el = document.querySelector('.pb-mstat') || statEl; if (el) el.textContent = mediaStat; };
  say(optimize ? '' : 'Laster opp originalen (uten komprimering)…');
  const unsub = window.faktisk.onLabradorUploadProgress ? window.faktisk.onLabradorUploadProgress(msg => {
    btn.textContent = msg.percent + '%…';
    if (msg.label) say(msg.label);
  }) : () => {};
  const filters = accept === 'video' ? [{ name: 'Video', extensions: ['mp4', 'm4v'] }]
    : accept === 'image' ? [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    : [{ name: 'Bilde eller video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'm4v'] }];
  try {
    const res = await window.faktisk.labradorUpload({ filters, optimize });
    if (res.canceled) { say(''); return; }
    if (!res.ok) { say(''); await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.optimized && res.stats) {
      const st = res.stats;
      say('Komprimert: ' + kb(st.origBytes) + ' → ' + (st.avifBytes ? kb(st.avifBytes) + ' AVIF / ' : '') + kb(st.fallbackBytes) + ' ' + ({ 'image/webp': 'WebP', 'image/png': 'PNG' }[res.variants.fallbackType] || 'JPG')
        + ' · ' + res.variants.width + ' px' + (st.reused ? ' · gjenbrukt fra Labrador' : '') + '. Alt-klikk «Last opp…» for originalen.');
    } else if (optimize) say('Lastet opp uten komprimering.');
    else say('Original lastet opp.');
    if (res.url) onDone(res.url, res.optimized ? res.variants : null);
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
    <div class="pb-mstat" style="font-size:11.5px;line-height:1.35;color:#5b6475;margin-top:4px;"></div>
    <div class="ftb-labpanel" style="display:none;"></div>`;
  const inp = box.querySelector('input'), panel = box.querySelector('.ftb-labpanel');
  box.querySelector('.pb-mstat').textContent = mediaStat;
  inp.addEventListener('change', () => { mediaStat = ''; onSet(inp.value.trim(), true, null); });
  inp.addEventListener('input', () => onSet(inp.value.trim(), false, null));
  const filesBtn = box.querySelector('[data-f=files]');
  filesBtn.addEventListener('click', () => {
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, accept, (url, variants) => {
      mediaStat = variants ? 'Komprimert bilde: ' + variants.fallback.map(v => v.w).join(' + ') + ' px' + (variants.avif.length ? ', med AVIF' : '') + '.' : '';
      onSet(url, true, variants);
    }, () => { panel.style.display = 'none'; filesBtn.click(); });
  });
  const upBtn = box.querySelector('[data-f=upload]');
  upBtn.title = 'Bilder komprimeres til AVIF + JPG i 1200 og 2400 px. Alt-klikk for å laste opp originalen.';
  upBtn.addEventListener('click', e => uploadFile(e.currentTarget, accept, (url, variants) => onSet(url, true, variants), e, box.querySelector('.pb-mstat')));
  return box;
}

function renderImgField() {
  els.imgBox.innerHTML = '';
  els.imgBox.appendChild(mediaField(state.src, 'image', (url, commit, variants) => {
    if (variants !== undefined && (variants || url !== state.src)) state.srcVariants = variants;
    state.src = url;
    if (commit) renderImgField();
    scheduleUpdate(true);
  }));
}

// ---------- konfig ----------
function readConfig() {
  const v = f => els[f].value;
  return {
    src: isUrl(state.src) ? safeUrl(state.src) : '',
    srcVariants: srcVariantsFor(state.src),
    shape: v('shape'), aspect: v('aspect'), radius: +v('radius'), zoom: +v('zoom'), focusX: +v('focusX'), focusY: +v('focusY'),
    frame: els.frame.checked, frameColor: v('frameColor'), frameW: +v('frameW'), shadow: v('shadow'),
    breathe: v('breathe'), breatheAmt: +v('breatheAmt'), breatheDur: +v('breatheDur'),
    name: v('name'), title: v('title'), textMode: v('textMode'), textAlign: v('textAlign'),
    bubbleStyle: v('bubbleStyle'), oneBubble: els.oneBubble.checked,
    posName: state.posName, posTitle: state.posTitle, tailName: v('tailName'), tailTitle: v('tailTitle'),
    popDelay: +v('popDelay'), popGap: +v('popGap'),
    boxStyle: v('boxStyle'), boxPlace: v('boxPlace'), boxRadius: +v('boxRadius'),
    width: +v('width'), align: v('align'), credit: v('credit').trim(), alt: v('altText').trim(),
    version: PLUGIN_VERSION,
  };
}
// srcset gjelder bare så lenge adressen i feltet er en av variantene
function srcVariantsFor(src) {
  const v = state.srcVariants;
  if (!v || !isUrl(src) || !v.fallback || !v.fallback.length) return null;
  const all = v.fallback.concat(v.avif || []);
  if (!all.some(x => safeUrl(x.url) === safeUrl(src))) return null;
  return { avif: (v.avif || []).map(x => ({ w: x.w, url: safeUrl(x.url) })), fallback: v.fallback.map(x => ({ w: x.w, url: safeUrl(x.url) })), fallbackType: v.fallbackType || 'image/jpeg' };
}
function buildEmbedSnippet(cfg) {
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fpb-container') : '';
  return fpbBuildSnippet(cfg, baseCss);
}

function updateUI() {
  const b = document.body.classList, mode = els.textMode.value;
  b.toggle('pb-circle', els.shape.value === 'circle');
  b.toggle('pb-has-frame', els.frame.checked);
  b.toggle('pb-no-breathe', els.breathe.value === 'none');
  ['under', 'bubbles', 'box', 'none'].forEach(m => b.toggle('pb-mode-' + m, mode === m));
  b.toggle('pb-one', els.oneBubble.checked);
  els.aspect.disabled = els.shape.value === 'circle';
  const out = (id, t) => { const o = $(id + 'Out'); if (o) o.textContent = t; };
  out('radius', els.radius.value + ' px');
  out('zoom', (+els.zoom.value).toFixed(2) + '×');
  out('focusX', els.focusX.value + ' %');
  out('focusY', els.focusY.value + ' %');
  out('frameW', els.frameW.value + ' px');
  out('breatheAmt', els.breatheAmt.value + ' %');
  out('breatheDur', els.breatheDur.value + ' s');
  out('popDelay', (+els.popDelay.value).toFixed(2) + ' s');
  out('popGap', (+els.popGap.value).toFixed(2) + ' s');
  out('boxRadius', els.boxRadius.value + ' px');
  out('width', els.width.value + ' px');
}

// ---------- forhåndsvisning ----------
// animate=true: kjører embed-skriptet så boblene popper opp; ellers vises alt med en gang
function renderPreview(animate) {
  const cfg = readConfig();
  cfg.static = true;   // forhåndsvisningen starter med en gang den synes
  const html = buildEmbedSnippet(cfg);
  const host = els.previewHost;
  host.innerHTML = html;
  host.querySelectorAll('script').forEach(old => {
    if (!animate) { old.remove(); return; }
    const s = document.createElement('script');
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
  if (!cfg.src) {
    const fr = host.querySelector('.fpb-frame');
    if (fr) { fr.classList.add('pb-empty'); fr.innerHTML = '<span>Velg et bilde fra Labrador</span>'; if (cfg.aspect === 'auto' && cfg.shape !== 'circle') fr.style.aspectRatio = '4 / 5'; }
  }
}

// dra boblene
let drag = null;
els.previewHost.addEventListener('pointerdown', e => {
  const bub = e.target.closest('.fpb-bub');
  if (!bub || !els.previewHost.contains(bub)) return;
  const media = bub.closest('.fpb-media');
  if (!media) return;
  e.preventDefault();
  const key = bub.classList.contains('fpb-bub--title') ? 'posTitle' : 'posName';
  const r = media.getBoundingClientRect(), br = bub.getBoundingClientRect();
  drag = { bub, media, key, offX: e.clientX - (br.left + br.width / 2), offY: e.clientY - (br.top + br.height / 2) };
  bub.classList.add('is-drag');
  bub.style.transitionDelay = '0s';
  try { bub.setPointerCapture(e.pointerId); } catch (err) {}
  void r;
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = drag.media.getBoundingClientRect();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const x = clamp(Math.round((e.clientX - drag.offX - r.left) / r.width * 1000) / 10, -10, 110);
  const y = clamp(Math.round((e.clientY - drag.offY - r.top) / r.height * 1000) / 10, -10, 115);
  state[drag.key] = { x, y };
  drag.bub.style.left = x + '%'; drag.bub.style.top = y + '%';
});
const endDrag = () => { if (!drag) return; drag.bub.classList.remove('is-drag'); drag = null; saveSoon(); };
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

els.resetPos.addEventListener('click', () => {
  state.posName = Object.assign({}, DEF_NAME); state.posTitle = Object.assign({}, DEF_TITLE);
  scheduleUpdate(true);
});
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
function scheduleUpdate(animate) {
  updateUI();
  renderPreview(!!animate);
  saveSoon();
}
// tekstmodus/bobleinnstillinger vises med animasjon, resten rett på
const ANIM_FIELDS = ['textMode', 'oneBubble', 'popDelay', 'popGap', 'boxPlace'];
FIELDS.concat(CHECKS).forEach(f => {
  const anim = ANIM_FIELDS.indexOf(f) >= 0;
  els[f].addEventListener('input', () => scheduleUpdate(false));
  els[f].addEventListener('change', () => scheduleUpdate(anim));
});

function serializeState() {
  const o = { src: state.src, srcVariants: state.srcVariants || null, posName: state.posName, posTitle: state.posTitle };
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
    state.src = s.src || '';
    state.srcVariants = s.srcVariants || null;
    state.posName = s.posName && isFinite(s.posName.x) ? s.posName : Object.assign({}, DEF_NAME);
    state.posTitle = s.posTitle && isFinite(s.posTitle.x) ? s.posTitle : Object.assign({}, DEF_TITLE);
    renderImgField(); updateUI(); renderPreview(true);
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
  const nm = els.name.value.trim();
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', nm ? 'Personbilde – ' + nm : `Personbilde ${new Date().toLocaleDateString('no')}`);
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
els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.src && !(await window.faktiskDialog.confirm('Bildet mangler (eller er ikke en adresse fra Labrador). Kopiere likevel?'))) return;
  try {
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
  renderImgField(); updateUI(); renderPreview(true);
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
