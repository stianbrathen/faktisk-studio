// Faktisk Studio · Loop-illustrasjon
//
// Sett sammen en animert illustrasjon som går i loop: bakgrunn og lag (bilder/logoer, video,
// ringer av elementer, nettverk og mobiler), og samle lag i mapper som animeres samlet.
// Alle filer ligger i Labrador (ALDRI base64 i embedden). Motoren (engine.js, fliRun) og
// embed-byggeren (snippet.js) er de samme som i embedden — forhåndsvisningen kjører samme kode.
// Videoen eksporteres her i editoren (WebCodecs + mp4mux.js), med de samme tegnefunksjonene.

const PLUGIN_ID = 'loop-illustrasjon';
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
  aspect: $('aspect'), mobileAspect: $('mobileAspect'), loop: $('loop'),
  bgType: $('bgType'), bgColor: $('bgColor'), bgDim: $('bgDim'), bgBlur: $('bgBlur'), bgGlow: $('bgGlow'), bgGlowColor: $('bgGlowColor'), bgVignette: $('bgVignette'),
  trigger: $('trigger'), width: $('widthSelect'), maxH: $('maxH'), optBand: $('optBand'), padY: $('padY'), optRound: $('optRound'), posterT: $('posterT'),
  altText: $('altText'), caption: $('captionText'),
  vFormat: $('vFormat'), vRes: $('vRes'), vFps: $('vFps'), vLoops: $('vLoops'),
  layerList: $('layerList'), previewHost: $('previewHost'), playBtn: $('playBtn'), scrub: $('scrub'), timeLabel: $('timeLabel'),
  copyEmbed: $('copyEmbedBtn'), exportBtn: $('exportBtn'), exportStatus: $('exportStatus'), progBar: $('progBar'),
  back_: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
};

const state = { bgSrc: '', layers: [], sel: null };

const uid = () => 'l_' + Math.random().toString(36).slice(2, 8);
const rseed = () => 1 + Math.floor(Math.random() * 99999);
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());
const loopLen = () => parseFloat(els.loop.value) || 8;

// ---------- lagtyper ----------
const TYPE_NAME = { image: 'Bilde/logo', video: 'Video', ring: 'Ring', network: 'Nettverk', phones: 'Mobiler', chat: 'Chatbobler', group: 'Mappe' };
const TYPE_ICON = { image: '▣', video: '▶', ring: '◌', network: '✳', phones: '▯', chat: '💬', group: '▤' };
function newLayer(type) {
  const base = { id: uid(), type, name: '', seed: rseed(), x: 0.5, y: 0.5, rot: 0, opacity: 1, tIn: 0, tOut: loopLen(), enter: 'fade', exit: 'fade', dur: 0.8,
    spin: 0, pulse: 0, beats: 2, float: 0, blur: 0, blurMode: 'static', zoom: 0, group: '', move: false, x2: 0.5, y2: 0.5, moveEase: 'smooth' };
  const per = {
    image: { size: 40, src: '', shape: 'none', shadow: false, enter: 'pop' },
    video: { size: 60, src: '', shape: 'round', shadow: true },
    ring: { size: 62, count: 24, itemSize: 7, shape2: 'patron', color: '#c9a24a', orient: 'out', ripple: 0, ringLine: false, lineColor: '#c9a24a', lineW: 2, srcs: '', enter: 'draw', dur: 2 },
    network: { size: 90, count: 40, area: 'circle', hole: 25, links: 3, nodeSize: 1, nodeStyle: 'glow', color: '#6fa8ff', glow: true, packets: true, rings: 2, motion: 1, lineW: 1.4, srcs: '', enter: 'draw', dur: 1.6 },
    phones: { size: 85, count: 6, phoneSize: 24, color: '#6fa8ff', net: true, glowPh: true, motion: 1, srcs: '', enter: 'draw', dur: 1.4 },
    chat: { size: 62, msgs: 'Hei! Trenger du penger fort?\n> Hva må jeg gjøre?\nEnkelt oppdrag. 50 000 kr.\nSend meg en DM 📩', chatStyle: 'imessage', textSize: 30, gap: 0.9, bounce: 0.25, typing: true, anchor: 'top', shadow: true, tIn: 0.2, tOut: Math.max(1, loopLen() - 0.6), enter: 'fade', exit: 'fade', dur: 0.5 },
    group: { scale: 1, name: 'Mappe ' + (state.layers.filter(l => l.type === 'group').length + 1) },
  };
  return Object.assign(base, per[type] || {});
}

// felt som vises for hver lagtype
const ENTER = [['fade', 'Tones inn'], ['pop', 'Popper opp'], ['scale', 'Vokser'], ['zoom', 'Zoomer inn'], ['blur', 'Fra uskarp'], ['draw', 'Tegnes på (ring, nettverk, mobiler)'], ['up', 'Fra under'], ['down', 'Fra over'], ['left', 'Fra venstre'], ['right', 'Fra høyre'], ['spin', 'Snurrer inn'], ['none', 'Ingen']];
const EXIT = [['fade', 'Tones ut'], ['pop', 'Krymper'], ['scale', 'Blir mindre'], ['zoom', 'Zoomer ut'], ['blur', 'Blir uskarp'], ['draw', 'Tegnes bort'], ['up', 'Ut nedover'], ['down', 'Ut oppover'], ['left', 'Ut til venstre'], ['right', 'Ut til høyre'], ['spin', 'Snurrer ut'], ['none', 'Ingen']];
const BLURMODE = [['static', 'Hele tiden'], ['in', 'Uskarp i starten'], ['out', 'Blir uskarp mot slutten'], ['inout', 'Uskarp i starten og slutten'], ['pulse', 'Pulserer']];
const pct = v => Math.round(v * 100) + ' %';
const sec = v => (+v).toFixed(1) + ' s';
function fieldsFor(l) {
  const L = loopLen(), F = [];
  const sect = t => F.push({ sect: t });
  if (l.type === 'image' || l.type === 'video') {
    sect('Fil');
    F.push({ k: 'src', kind: 'media', accept: l.type === 'video' ? 'video' : 'image' });
    F.push({ k: 'shape', label: 'Form', kind: 'select', opts: [['none', 'Som filen (PNG med gjennomsiktighet)'], ['round', 'Avrundet rektangel'], ['circle', 'Sirkel']] });
    F.push({ k: 'shadow', label: 'Skygge', kind: 'check' });
  }
  if (l.type === 'ring') {
    sect('Ring');
    F.push({ k: 'shape2', label: 'Element', kind: 'select', opts: [['patron', 'Patron'], ['dot', 'Prikk'], ['line', 'Strek'], ['node', 'Lysende node'], ['person', 'Profil'], ['images', 'Egne bilder fra Labrador']] });
    F.push({ k: 'srcs', kind: 'medialist', accept: 'image', show: l => l.shape2 === 'images' });
    F.push({ k: 'count', label: 'Antall', kind: 'range', min: 3, max: 90, step: 1 });
    F.push({ k: 'itemSize', label: 'Elementstørrelse', kind: 'range', min: 1, max: 30, step: 0.5, fmt: v => v + ' %' });
    F.push({ k: 'orient', label: 'Retning', kind: 'select', opts: [['out', 'Peker utover'], ['in', 'Peker innover'], ['tangent', 'Langs sirkelen'], ['upright', 'Står oppreist']] });
    F.push({ k: 'color', label: 'Farge', kind: 'color', show: l => l.shape2 !== 'images' });
    F.push({ k: 'ripple', label: 'Bølge rundt ringen', kind: 'range', min: 0, max: 1, step: 0.05, fmt: pct });
    F.push({ k: 'ringLine', label: 'Sirkelstrek', kind: 'check' });
    F.push({ k: 'lineColor', label: 'Strekfarge', kind: 'color', show: l => l.ringLine });
  }
  if (l.type === 'network') {
    sect('Nettverk');
    F.push({ k: 'area', label: 'Område', kind: 'select', opts: [['circle', 'Sirkel rundt punktet'], ['full', 'Hele bildet']] });
    F.push({ k: 'count', label: 'Noder', kind: 'range', min: 5, max: 200, step: 1 });
    F.push({ k: 'hole', label: 'Tomrom i midten', kind: 'range', min: 0, max: 90, step: 1, fmt: v => v + ' %' });
    F.push({ k: 'links', label: 'Linjer per node', kind: 'range', min: 1, max: 5, step: 1 });
    F.push({ k: 'nodeStyle', label: 'Noder som', kind: 'select', opts: [['glow', 'Lysende punkter'], ['person', 'Profiler'], ['images', 'Egne bilder fra Labrador']] });
    F.push({ k: 'srcs', kind: 'medialist', accept: 'image', show: l => l.nodeStyle === 'images' });
    F.push({ k: 'nodeSize', label: 'Nodestørrelse', kind: 'range', min: 0.3, max: 4, step: 0.1, fmt: pct });
    F.push({ k: 'color', label: 'Farge', kind: 'color' });
    F.push({ k: 'lineW', label: 'Linjetykkelse', kind: 'range', min: 0.4, max: 5, step: 0.1, fmt: v => (+v).toFixed(1) });
    F.push({ k: 'motion', label: 'Bevegelse i nettet', kind: 'range', min: 0, max: 3, step: 0.1, fmt: pct });
    F.push({ k: 'rings', label: 'Pulsringer', kind: 'range', min: 0, max: 4, step: 1 });
    F.push({ k: 'glow', label: 'Glød', kind: 'check' });
    F.push({ k: 'packets', label: 'Signaler langs linjene', kind: 'check' });
    F.push({ kind: 'reseed' });
  }
  if (l.type === 'chat') {
    sect('Chatbobler');
    F.push({ k: 'msgs', kind: 'textarea', label: 'Én melding per linje. Start linja med > for meldinger fra «meg» (høyre side). Skriv \\n for linjeskift i en boble.' });
    F.push({ k: 'chatStyle', label: 'Stil', kind: 'select', opts: [['imessage', 'iMessage'], ['whatsapp', 'WhatsApp'], ['messenger', 'Messenger'], ['signal', 'Signal'], ['dark', 'Mørk']] });
    F.push({ k: 'textSize', label: 'Tekststørrelse', kind: 'range', min: 12, max: 80, step: 1 });
    F.push({ k: 'gap', label: 'Tid mellom bobler', kind: 'range', min: 0, max: 4, step: 0.05, fmt: v => +v ? sec(v) : 'alle samtidig' });
    F.push({ k: 'anchor', label: 'Vokser', kind: 'select', opts: [['top', 'Nedover fra punktet'], ['bottom', 'Oppover (som i en chat)'], ['center', 'Fra midten']] });
    F.push({ k: 'bounce', label: 'Sprett', kind: 'range', min: 0, max: 1, step: 0.05, fmt: v => +v ? pct(v) : 'glir inn' });
    F.push({ k: 'typing', label: '«Skriver …» før svar', kind: 'check' });
    F.push({ k: 'shadow', label: 'Skygge', kind: 'check' });
  }
  if (l.type === 'phones') {
    sect('Mobiler');
    F.push({ k: 'srcs', kind: 'medialist', accept: 'both' });
    F.push({ k: 'count', label: 'Antall', kind: 'range', min: 1, max: 20, step: 1 });
    F.push({ k: 'phoneSize', label: 'Mobilstørrelse', kind: 'range', min: 6, max: 70, step: 1, fmt: v => v + ' %' });
    F.push({ k: 'color', label: 'Farge på nettet', kind: 'color' });
    F.push({ k: 'motion', label: 'Sveving', kind: 'range', min: 0, max: 3, step: 0.1, fmt: pct });
    F.push({ k: 'net', label: 'Nettverk mellom mobilene', kind: 'check' });
    F.push({ k: 'glowPh', label: 'Glød bak mobilene', kind: 'check' });
    F.push({ kind: 'reseed' });
  }
  sect(l.type === 'group' ? 'Mappe' : 'Plassering');
  if (l.type !== 'group') F.push({ k: 'group', label: 'Ligger i mappe', kind: 'groupsel' });
  F.push({ k: 'x', label: l.type === 'group' ? 'Midtpunkt sideveis' : 'Sideveis', kind: 'range', min: -0.2, max: 1.2, step: 0.005, fmt: pct });
  F.push({ k: 'y', label: l.type === 'group' ? 'Midtpunkt opp/ned' : 'Opp/ned', kind: 'range', min: -0.2, max: 1.2, step: 0.005, fmt: pct });
  if (l.type === 'group') F.push({ k: 'scale', label: 'Størrelse', kind: 'range', min: 0.2, max: 3, step: 0.01, fmt: pct });
  else F.push({ k: 'size', label: l.type === 'ring' ? 'Diameter' : l.type === 'network' || l.type === 'phones' ? 'Utstrekning' : 'Størrelse', kind: 'range', min: 2, max: 160, step: 0.5, fmt: v => v + ' %' });
  F.push({ k: 'rot', label: 'Rotasjon', kind: 'range', min: -180, max: 180, step: 1, fmt: v => v + '°' });
  F.push({ k: 'move', label: 'Flytter seg mens den vises', kind: 'check' });
  F.push({ k: 'x2', label: 'Til sideveis', kind: 'range', min: -0.3, max: 1.3, step: 0.005, fmt: pct, show: l => l.move });
  F.push({ k: 'y2', label: 'Til opp/ned', kind: 'range', min: -0.3, max: 1.3, step: 0.005, fmt: pct, show: l => l.move });
  F.push({ k: 'moveEase', label: 'Bevegelse', kind: 'select', opts: [['smooth', 'Myk start og stopp'], ['linear', 'Jevn fart']], show: l => l.move });
  F.push({ k: 'opacity', label: 'Synlighet', kind: 'range', min: 0, max: 1, step: 0.01, fmt: pct });
  sect('Inn og ut');
  F.push({ k: 'tIn', label: 'Kommer inn', kind: 'range', min: 0, max: L, step: 0.1, fmt: sec });
  F.push({ k: 'tOut', label: 'Går ut', kind: 'range', min: 0, max: L, step: 0.1, fmt: v => +v >= L - 0.001 ? 'blir' : sec(v) });
  F.push({ k: 'enter', label: 'Inn', kind: 'select', opts: ENTER });
  F.push({ k: 'exit', label: 'Ut', kind: 'select', opts: EXIT });
  F.push({ k: 'dur', label: 'Varighet inn/ut', kind: 'range', min: 0.1, max: Math.max(0.5, L / 2), step: 0.05, fmt: sec });
  sect('Bevegelse i loopen');
  F.push({ k: 'spin', label: 'Spinn (runder per loop)', kind: 'range', min: -6, max: 6, step: 1, fmt: v => +v ? (v > 0 ? '↻ ' : '↺ ') + Math.abs(v) : 'av' });
  F.push({ k: 'pulse', label: 'Puls', kind: 'range', min: 0, max: 0.5, step: 0.01, fmt: v => +v ? pct(v) : 'av' });
  F.push({ k: 'beats', label: 'Slag per loop', kind: 'range', min: 1, max: 16, step: 1 });
  F.push({ k: 'float', label: 'Svever', kind: 'range', min: 0, max: 3, step: 0.1, fmt: v => +v ? pct(v) : 'av' });
  F.push({ k: 'zoom', label: 'Zoom inn og ut', kind: 'range', min: 0, max: 0.6, step: 0.01, fmt: v => +v ? pct(v) : 'av' });
  F.push({ k: 'blur', label: 'Uskarphet', kind: 'range', min: 0, max: 60, step: 1, fmt: v => +v ? v : 'av' });
  F.push({ k: 'blurMode', label: 'Når uskarp', kind: 'select', opts: BLURMODE, show: l => +l.blur > 0 });
  return F;
}

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
// liste med filer (én adresse per linje)
function mediaListField(value, accept, onSet) {
  const box = document.createElement('div'); box.className = 'fli-mediafield';
  const urls = String(value || '').split(/\r?\n/).map(s => s.trim()).filter(isUrl);
  box.innerHTML = `<div class="fli-thumbs">${urls.map((u, i) => VID_EXT.test(u) ? `<span class="mn-thumb fli-vthumb" title="${escapeHtml(u)}">▶<button type="button" data-rm="${i}" title="Fjern">×</button></span>` : `<span class="fli-th"><img class="mn-thumb" src="${escapeHtml(u)}" alt=""><button type="button" data-rm="${i}" title="Fjern">×</button></span>`).join('') || '<span class="hk-hint">Ingen filer ennå.</span>'}</div>
    <div class="ftb-labrow"><button class="ftb-labbtn" type="button" data-f="files">+ Fra Mine filer ▾</button><button class="ftb-labbtn" type="button" data-f="upload">Last opp…</button></div>
    <div class="ftb-labpanel" style="display:none;"></div>
    <textarea class="caption-input fli-urls" rows="2" spellcheck="false" placeholder="Eller lim inn adresser fra Labrador, én per linje">${escapeHtml(urls.join('\n'))}</textarea>`;
  const panel = box.querySelector('.ftb-labpanel'), ta = box.querySelector('textarea');
  const add = u => onSet(urls.concat([u]).join('\n'), true);
  box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { const a = urls.slice(); a.splice(+b.dataset.rm, 1); onSet(a.join('\n'), true); }));
  ta.addEventListener('change', () => onSet(ta.value.split(/\r?\n/).map(s => s.trim()).filter(isUrl).join('\n'), true));
  const filesBtn = box.querySelector('[data-f=files]');
  filesBtn.addEventListener('click', () => {
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, accept, add, () => { panel.style.display = 'none'; filesBtn.click(); });
  });
  box.querySelector('[data-f=upload]').addEventListener('click', e => uploadFile(e.currentTarget, accept, add));
  return box;
}

// ---------- lagliste ----------
function layerName(l) { return l.name || TYPE_NAME[l.type]; }
function renderLayers() {
  const list = els.layerList; list.innerHTML = '';
  if (!state.layers.length) { list.innerHTML = '<p class="hk-hint">Ingen lag ennå — legg til med knappene over.</p>'; return; }
  const groups = state.layers.filter(l => l.type === 'group');
  state.layers.forEach((l, i) => {
    const card = document.createElement('div');
    const inGroup = l.group && groups.some(g => g.id === l.group);
    card.className = 'fli-layer' + (state.sel === l.id ? ' is-open' : '') + (l.hidden ? ' is-hidden' : '') + (inGroup ? ' in-group' : '') + (l.type === 'group' ? ' is-group' : '');
    card.dataset.id = l.id;
    const g = inGroup ? groups.find(x => x.id === l.group) : null;
    card.innerHTML = `<div class="fli-head" data-act="sel">
        <span class="fli-icon" title="${TYPE_NAME[l.type]}">${TYPE_ICON[l.type]}</span>
        <span class="fli-name">${escapeHtml(layerName(l))}${g ? `<small> · ${escapeHtml(layerName(g))}</small>` : ''}</span>
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="vis" title="${l.hidden ? 'Vis' : 'Skjul'}">${l.hidden ? '◌' : '●'}</button>
          <button class="tb-row__btn" data-act="up" ${i === 0 ? 'disabled' : ''} title="Lenger bak">↑</button>
          <button class="tb-row__btn" data-act="down" ${i === state.layers.length - 1 ? 'disabled' : ''} title="Lenger fram">↓</button>
          <button class="tb-row__btn" data-act="dup" title="Dupliser">⧉</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" title="Fjern">×</button>
        </span></div>`;
    if (state.sel === l.id) card.appendChild(layerBody(l));
    list.appendChild(card);
  });
}
function layerBody(l) {
  const body = document.createElement('div'); body.className = 'fli-body';
  const nameRow = document.createElement('label'); nameRow.className = 'fli-field';
  nameRow.innerHTML = `<span>Navn</span><input type="text" class="input-mini" value="${escapeHtml(l.name || '')}" placeholder="${TYPE_NAME[l.type]}">`;
  nameRow.querySelector('input').addEventListener('input', e => { l.name = e.target.value; const n = body.parentNode && body.parentNode.querySelector('.fli-name'); if (n) n.firstChild.textContent = layerName(l); scheduleUpdate(true); });
  body.appendChild(nameRow);
  let sectEl = null;
  fieldsFor(l).forEach(f => {
    if (f.sect) { sectEl = document.createElement('div'); sectEl.className = 'fli-sect'; sectEl.innerHTML = `<span class="url-section__label">${f.sect}</span>`; body.appendChild(sectEl); return; }
    if (f.show && !f.show(l)) return;
    const host = sectEl || body;
    if (f.kind === 'media') { host.appendChild(mediaField(l[f.k], f.accept, (v, rerender) => { l[f.k] = v; scheduleUpdate(); if (rerender) renderLayers(); })); return; }
    if (f.kind === 'medialist') { host.appendChild(mediaListField(l[f.k], f.accept, (v, rerender) => { l[f.k] = v; scheduleUpdate(); if (rerender) renderLayers(); })); return; }
    if (f.kind === 'reseed') { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-mini btn-mini--light'; b.textContent = '⟳ Ny variant'; b.addEventListener('click', () => { l.seed = rseed(); scheduleUpdate(); }); host.appendChild(b); return; }
    const row = document.createElement('label'); row.className = f.kind === 'check' ? 'ks-check' : f.kind === 'range' ? 'cb-range' : 'fli-field';
    const v = l[f.k];
    if (f.kind === 'range') {
      row.innerHTML = `<span>${f.label}</span><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v == null ? f.min : v}"><output></output>`;
      const inp = row.querySelector('input'), out = row.querySelector('output');
      const show = () => { out.textContent = f.fmt ? f.fmt(+inp.value) : inp.value; };
      show();
      inp.addEventListener('input', () => { l[f.k] = +inp.value; show(); scheduleUpdate(); if (f.k === 'blur' && (+inp.value > 0) !== !!body.querySelector('[data-k=blurMode]')) renderSoon(); if (f.k === 'tIn' || f.k === 'tOut') seekTo(+inp.value + (f.k === 'tIn' ? Math.min(+l.dur || 0.8, 1) : -0.05)); });
    } else if (f.kind === 'select' || f.kind === 'groupsel') {
      const opts = f.kind === 'groupsel' ? [['', 'Ingen']].concat(state.layers.filter(g => g.type === 'group').map(g => [g.id, layerName(g)])) : f.opts;
      row.innerHTML = `<span>${f.label}</span><select class="project-select" data-k="${f.k}">${opts.map(([k, t]) => `<option value="${k}"${String(k) === String(v == null ? '' : v) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`;
      row.querySelector('select').addEventListener('change', e => { l[f.k] = e.target.value; scheduleUpdate(); renderLayers(); });
    } else if (f.kind === 'check') {
      row.innerHTML = `<input type="checkbox"${v ? ' checked' : ''}><span>${f.label}</span>`;
      row.querySelector('input').addEventListener('change', e => {
        l[f.k] = e.target.checked;
        // ny bane starter der laget står, og går et stykke til høyre
        if (f.k === 'move' && l.move) { l.x2 = Math.min(1.2, (+l.x || 0.5) + 0.15); l.y2 = +l.y || 0.5; }
        scheduleUpdate(); renderLayers();
      });
    } else if (f.kind === 'textarea') {
      row.className = 'fli-field fli-field--wide';
      row.innerHTML = `<span class="hk-hint">${escapeHtml(f.label)}</span><textarea class="caption-input fli-msgs" rows="5" spellcheck="true">${escapeHtml(v || '')}</textarea>`;
      row.querySelector('textarea').addEventListener('input', e => { l[f.k] = e.target.value; scheduleUpdate(); });
    } else if (f.kind === 'color') {
      row.className = 'mn-color';
      row.innerHTML = `<input type="color" value="${v || '#ffffff'}"><span>${f.label}</span>`;
      row.querySelector('input').addEventListener('input', e => { l[f.k] = e.target.value; scheduleUpdate(); });
    }
    host.appendChild(row);
  });
  return body;
}
let renderT = 0;
function renderSoon() { clearTimeout(renderT); renderT = setTimeout(renderLayers, 250); }
els.layerList.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('.fli-layer'); if (!card) return;
  const id = card.dataset.id, i = state.layers.findIndex(x => x.id === id), l = state.layers[i];
  const act = btn.dataset.act;
  if (act === 'sel') { if (e.target.closest('button')) return; state.sel = state.sel === id ? null : id; renderLayers(); return; }
  e.stopPropagation();
  if (act === 'vis') l.hidden = !l.hidden;
  if (act === 'up' && i > 0) { state.layers.splice(i, 1); state.layers.splice(i - 1, 0, l); }
  if (act === 'down' && i < state.layers.length - 1) { state.layers.splice(i, 1); state.layers.splice(i + 1, 0, l); }
  if (act === 'dup') { const c = JSON.parse(JSON.stringify(l)); c.id = uid(); c.name = (l.name || TYPE_NAME[l.type]) + ' (kopi)'; if (l.type !== 'group') c.x = Math.min(1, (+l.x || 0.5) + 0.04); state.layers.splice(i + 1, 0, c); state.sel = c.id; }
  if (act === 'del') { state.layers.splice(i, 1); if (l.type === 'group') state.layers.forEach(x => { if (x.group === l.id) x.group = ''; }); if (state.sel === id) state.sel = null; }
  renderLayers(); scheduleUpdate();
});
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
  const l = newLayer(b.dataset.add);
  // nye lag legges i valgt mappe hvis en mappe (eller et lag i en mappe) er valgt
  const sel = state.layers.find(x => x.id === state.sel);
  if (sel && l.type !== 'group') l.group = sel.type === 'group' ? sel.id : (sel.group || '');
  state.layers.push(l); state.sel = l.id; renderLayers(); scheduleUpdate();
  setTimeout(() => { const c = els.layerList.querySelector(`[data-id="${l.id}"]`); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50);
}));

// bakgrunnsfil
function renderBgMedia() {
  const box = $('bgMediaBox'); box.innerHTML = '';
  const t = els.bgType.value;
  document.body.classList.toggle('fli-bg-media', t === 'image' || t === 'video');
  if (t === 'image' || t === 'video') box.appendChild(mediaField(state.bgSrc, t, (v, rerender) => { state.bgSrc = v; scheduleUpdate(); if (rerender) renderBgMedia(); }));
}

// ---------- konfig ----------
function readConfig() {
  const L = loopLen();
  return {
    aspect: els.aspect.value, mobileAspect: els.mobileAspect.value, loop: L,
    bg: { type: els.bgType.value, color: els.bgColor.value, src: (els.bgType.value === 'image' || els.bgType.value === 'video') && isUrl(state.bgSrc) ? state.bgSrc.trim() : '',
      dim: +els.bgDim.value, blur: +els.bgBlur.value, glow: els.bgGlow.checked, glowColor: els.bgGlowColor.value, vignette: els.bgVignette.checked },
    layers: state.layers.map(l => Object.assign({}, l, { src: isUrl(l.src) ? l.src.trim() : '', tOut: Math.min(+l.tOut, L) })),
    trigger: els.trigger.value, width: els.width.value, maxH: els.maxH.value, band: els.optBand.checked, padTop: +els.padY.value, padBot: +els.padY.value,
    round: els.optRound.checked, posterT: Math.min(+els.posterT.value, L),
    alt: els.altText.value.trim(), caption: els.caption.value.trim(), version: PLUGIN_VERSION,
  };
}
function buildEmbedSnippet(cfg) {
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fli-container') : '';
  return fliBuildSnippet(cfg || readConfig(), fliRun.toString(), baseCss);
}

// ---------- forhåndsvisning (samme motor som embedden, styrt av editoren) ----------
let api = null, pvRoot = null, cfgLive = null;
let playing = true, t0 = performance.now(), pausedAt = 0, busy = false;
function mountPreview() {
  els.previewHost.innerHTML = '<div class="fli-pv"><canvas></canvas></div><div class="fli-pv-cap"></div>';
  pvRoot = els.previewHost.querySelector('.fli-pv');
  cfgLive = Object.assign(readConfig(), { __manual: true, __editor: true });
  api = fliRun(pvRoot, cfgLive);
  new ResizeObserver(sizePreview).observe(pvRoot);
  pvRoot.addEventListener('pointerdown', onDown);
  pvRoot.addEventListener('pointermove', onMove);
  pvRoot.addEventListener('pointerup', onUp);
  pvRoot.addEventListener('pointercancel', onUp);
}
function sizePreview() {
  if (!pvRoot) return;
  const cfg = cfgLive, w = pvRoot.parentNode.getBoundingClientRect().width;
  const asp = (w < 560 && cfg.mobileAspect && cfg.mobileAspect !== 'same' ? cfg.mobileAspect : cfg.aspect).split('/').map(Number);
  // samme bredde- og høydegrense som i embedden
  const mw = cfg.width === 'full' ? Infinity : parseInt(cfg.width, 10) || 680, mh = parseInt(cfg.maxH, 10) || 0;
  pvRoot.style.maxWidth = Math.min(mw, mh ? window.innerHeight * mh / 100 * asp[0] / asp[1] : Infinity) + 'px';
  pvRoot.style.margin = '0 auto';
  els.previewHost.style.background = cfg.band && cfg.bg.type !== 'none' ? cfg.bg.color : '';
  els.previewHost.style.padding = (+cfg.padTop || 0) + 'px 0';
  pvRoot.classList.toggle('is-band', !!(cfg.band && cfg.bg.type !== 'none'));
  pvRoot.style.aspectRatio = asp[0] + ' / ' + asp[1];
  pvRoot.style.background = cfg.bg.type === 'none' ? '' : cfg.bg.color;
  pvRoot.classList.toggle('is-clear', cfg.bg.type === 'none');
  pvRoot.style.borderRadius = cfg.round ? '10px' : '';
  const r = pvRoot.getBoundingClientRect();
  api.setSize(Math.max(1, r.width), Math.max(1, r.height), Math.min(2, window.devicePixelRatio || 1));
  const cap = els.previewHost.querySelector('.fli-pv-cap'); cap.textContent = cfg.caption; cap.style.display = cfg.caption ? '' : 'none';
}
function applyConfig() {
  const c = readConfig();
  Object.keys(c).forEach(k => { cfgLive[k] = c[k]; });
  sizePreview();
}
const curT = () => { const L = loopLen(); return playing ? ((performance.now() - t0) / 1000) % L : pausedAt % L; };
function seekTo(t) { setPlaying(false); pausedAt = Math.max(0, Math.min(loopLen() - 0.001, t)); }
function setPlaying(v) {
  if (v === playing) return;
  if (v) t0 = performance.now() - pausedAt * 1000; else pausedAt = curT();
  playing = v; els.playBtn.textContent = playing ? '❚❚ Pause' : '▶ Spill av';
  if (api) { if (playing) api.playVideos(); else api.pauseVideos(); }
}
els.playBtn.addEventListener('click', () => setPlaying(!playing));
els.scrub.addEventListener('input', () => seekTo(els.scrub.value / 1000 * loopLen()));
let tickN = 0;
function tick() {
  if (api && !busy) {
    const t = curT();
    if (playing && ++tickN % 45 === 0) api.playVideos();
    api.draw(t);
    drawSelection();
    els.timeLabel.textContent = t.toFixed(1) + ' / ' + loopLen().toFixed(1) + ' s';
    if (document.activeElement !== els.scrub) els.scrub.value = Math.round(t / loopLen() * 1000);
  }
  requestAnimationFrame(tick);
}
function drawSelection() {
  const l = state.layers.find(x => x.id === state.sel); if (!l || l.hidden) return;
  const b = api.boxes()[l.id]; if (!b) return;
  const x = api.canvas.getContext('2d'), d = Math.min(2, window.devicePixelRatio || 1);
  x.save(); x.setTransform(d, 0, 0, d, 0, 0); x.setLineDash([6, 5]); x.lineWidth = 1.5; x.strokeStyle = 'rgba(127,208,255,.9)';
  if (b.group) { x.beginPath(); x.arc(b.x, b.y, 10, 0, Math.PI * 2); x.moveTo(b.x - 16, b.y); x.lineTo(b.x + 16, b.y); x.moveTo(b.x, b.y - 16); x.lineTo(b.x, b.y + 16); x.stroke(); }
  else x.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  x.restore();
}
// klikk for å velge, dra for å flytte
let drag = null;
function ptr(e) { const r = pvRoot.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; }
function onDown(e) {
  const [px, py, w, h] = ptr(e), boxes = api.boxes();
  let hit = null;
  const cur = state.layers.find(x => x.id === state.sel);
  const inside = (l, pad) => { const b = boxes[l.id]; if (!b || l.hidden) return false; if (b.group) return Math.hypot(px - b.x, py - b.y) < 18; return Math.abs(px - b.x) <= b.w / 2 + pad && Math.abs(py - b.y) <= b.h / 2 + pad; };
  if (cur && inside(cur, 6)) hit = cur;
  else for (let i = state.layers.length - 1; i >= 0; i--) { const l = state.layers[i]; if (l.type !== 'group' && inside(l, 0)) { hit = l; break; } }
  if (!hit) return;
  if (state.sel !== hit.id) { state.sel = hit.id; renderLayers(); }
  drag = { id: hit.id, sx: px, sy: py, x: +hit.x, y: +hit.y, x2: +hit.x2, y2: +hit.y2, w, h };
  pvRoot.setPointerCapture(e.pointerId); e.preventDefault();
}
function onMove(e) {
  if (!drag) return;
  const [px, py] = ptr(e), l = state.layers.find(x => x.id === drag.id); if (!l) return;
  const dx = (px - drag.sx) / drag.w, dy = (py - drag.sy) / drag.h, r3 = v => Math.round(v * 1000) / 1000;
  l.x = r3(drag.x + dx); l.y = r3(drag.y + dy);
  if (l.move) { l.x2 = r3(drag.x2 + dx); l.y2 = r3(drag.y2 + dy); }   // hele banen flyttes med
  applyConfig();
}
function onUp() { if (!drag) return; drag = null; renderLayers(); scheduleUpdate(); }

const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = $('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
  setTimeout(sizePreview, 300);
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

function updateOutputs() {
  const L = loopLen();
  $('loopOut').textContent = L.toFixed(1) + ' s';
  $('bgDimOut').textContent = Math.round(els.bgDim.value * 100) + ' %';
  $('bgBlurOut').textContent = els.bgBlur.value;
  els.posterT.max = L; $('posterTOut').textContent = Math.min(+els.posterT.value, L).toFixed(1) + ' s';
}
let updateTimer = null;
function scheduleUpdate(quiet) {
  updateOutputs();
  if (api) applyConfig();
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => saveStateNow(), 300);
  void quiet;
}

// loop-lengden styrer tidsfeltene: lag som varte til slutten, varer fortsatt til slutten
let lastLoop = loopLen();
els.loop.addEventListener('input', () => {
  const L = loopLen();
  state.layers.forEach(l => { if (+l.tOut >= lastLoop - 0.001 || +l.tOut > L) l.tOut = L; if (+l.tIn > L) l.tIn = 0; });
  lastLoop = L; scheduleUpdate(); renderSoon();
});
els.bgType.addEventListener('change', () => { renderBgMedia(); scheduleUpdate(); });

// ---------- embed ----------
// Stillbilder til videoene (ffmpeg + opplasting til Labrador, gjenbrukes). Vises når autoplay er
// blokkert, f.eks. lav strømmodus på iPhone — ellers blir bakgrunnen/laget tomt.
async function videoPosters(cfg) {
  const out = {};
  if (!window.faktisk.labradorThumbnail) return out;
  const isVid = u => /^https?:/.test(u || '') && /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(u);
  const urls = [];
  if (cfg.bg && cfg.bg.type === 'video' && cfg.bg.src) urls.push(cfg.bg.src);
  cfg.layers.filter(l => !l.hidden).forEach(l => {
    if (l.src) urls.push(l.src);
    String(l.srcs || '').split(/\r?\n/).forEach(s => urls.push(s.trim()));
  });
  for (const u of [...new Set(urls)].filter(isVid)) {
    try {
      const r = await window.faktisk.labradorThumbnail({ url: u.replace(/#video$/, ''), atTime: 0 });
      if (r && r.ok && r.url) out[u] = r.url;
    } catch (e) {}
  }
  return out;
}

els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  const local = cfg.layers.filter(l => !l.hidden && (l.type === 'image' || l.type === 'video') && !l.src);
  if (!cfg.layers.some(l => !l.hidden)) { await window.faktiskDialog.alert('Legg til minst ett lag først.'); return; }
  if (local.length && !(await window.faktiskDialog.confirm(local.length + ' lag mangler fil fra Labrador og blir tomme i embedden. Kopiere likevel?'))) return;
  try {
    els.copyEmbed.textContent = 'Lager stillbilder …';
    cfg.posters = await videoPosters(cfg);
    const html = buildEmbedSnippet(cfg);
    await window.faktisk.copyToClipboard(html);
    els.copyEmbed.textContent = '✅ Kopiert (' + Math.round(html.length / 1024) + ' KB)! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 5000);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});
els.back_.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => { await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file'); });

// ---------- video-eksport ----------
function exportStatus(msg, err) { els.exportStatus.textContent = msg || ''; els.exportStatus.style.color = err ? '#ffb4b4' : ''; }
const setProg = p => { els.progBar.style.width = (p * 100).toFixed(1) + '%'; };
function exportDims() {
  const [a, b] = els.aspect.value.split('/').map(Number), short = parseInt(els.vRes.value, 10) || 1080;
  const even = v => Math.round(v / 2) * 2;
  return a >= b ? [even(short * a / b), short] : [short, even(short * b / a)];
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipHeader(sig, fields) { const b = new DataView(new ArrayBuffer(fields.reduce((a, f) => a + f[1], 4))); let o = 0; b.setUint32(o, sig, true); o += 4;
  for (const [v, n] of fields) { if (n === 2) b.setUint16(o, v, true); else b.setUint32(o, v >>> 0, true); o += n; } return new Uint8Array(b.buffer); }
function zipWriter() {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0, count = 0;
  return {
    async add(name, blob) {
      const u8 = new Uint8Array(await blob.arrayBuffer()), crc = crc32(u8), nm = enc.encode(name), size = u8.length;
      const lh = zipHeader(0x04034b50, [[20, 2], [0x0800, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [size, 4], [size, 4], [nm.length, 2], [0, 2]]);
      parts.push(lh, nm, blob);
      central.push(zipHeader(0x02014b50, [[20, 2], [20, 2], [0x0800, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [size, 4], [size, 4], [nm.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), nm);
      offset += lh.length + nm.length + size; count++;
      if (offset > 4.2e9) throw new Error('Filen blir over 4 GB. Velg 720p eller færre runder.');
    },
    finish() { let cd = 0; central.forEach(c => cd += c.length);
      return new Blob([...parts, ...central, zipHeader(0x06054b50, [[0, 2], [0, 2], [count, 2], [count, 2], [cd, 4], [offset, 4], [0, 2]])], { type: 'application/zip' }); }
  };
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function pickCodec(W, H, fps) {
  if (!('VideoEncoder' in window)) return null;
  const bitrate = Math.round(W * H * fps * 0.2);
  for (const codec of ['avc1.42002a', 'avc1.4d002a', 'avc1.640033']) {
    const c = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { const s = await VideoEncoder.isConfigSupported(c); if (s && s.supported) return c; } catch (e) {}
  }
  return null;
}
let cancelExport = false;
els.exportBtn.addEventListener('click', async () => {
  if (busy) { cancelExport = true; return; }
  const cfg = readConfig(), fps = parseInt(els.vFps.value, 10) || 25, loops = parseInt(els.vLoops.value, 10) || 1, fmt = els.vFormat.value;
  const [W, H] = exportDims(), n = Math.round(cfg.loop * loops * fps);
  const base = 'loop-illustrasjon-' + new Date().toISOString().slice(0, 10);
  busy = true; cancelExport = false; els.exportBtn.textContent = 'Avbryt eksport'; setProg(0);
  const root = document.createElement('div'); root.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + W + 'px;height:' + H + 'px;';
  root.innerHTML = '<canvas></canvas>'; document.body.appendChild(root);
  let ex = null;
  try {
    exportStatus('Henter filer …');
    ex = fliRun(root, Object.assign(JSON.parse(JSON.stringify(cfg)), { __manual: true, cors: true, __export: true }));
    ex.setSize(W, H, 1); ex.draw(0);
    await new Promise(res => { let fin = false; ex.ready(() => { if (!fin) { fin = true; res(); } }); setTimeout(() => { if (!fin) { fin = true; res(); } }, 20000); });
    const failed = ex.failed();
    if (failed.length && !(await window.faktiskDialog.confirm(failed.length + ' fil(er) kunne ikke brukes i eksporten (mangler eller tillater ikke eksport fra Labrador). Fortsette uten dem?'))) throw new Error('cancel');
    const hasVid = ex.hasVideo(), cv = ex.canvas;
    const frameAt = async i => { const t = i / fps; if (hasVid) await new Promise(r => ex.seekVideos(t, r)); ex.draw(t, { noBg: false }); };
    if (fmt === 'mp4') {
      const conf = await pickCodec(W, H, fps);
      if (!conf) throw new Error('Denne maskinen kan ikke lage MP4 her. Velg PNG-sekvens.');
      const mux = new FliMp4(W, H, fps);
      let encErr = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => mux.add(chunk, meta), error: e => { encErr = e; } });
      enc.configure(conf);
      for (let i = 0; i < n; i++) {
        if (cancelExport) throw new Error('cancel');
        if (encErr) throw encErr;
        await frameAt(i);
        const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
        while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 5));
        if (i % 3 === 0) { setProg(i / n); exportStatus(`Lager bilde ${i + 1} av ${n} …`); }
      }
      await enc.flush(); enc.close();
      if (encErr) throw encErr;
      const blob = mux.finish();
      setProg(1); download(blob, `${base}-${W}x${H}.mp4`);
      const bi = ex.blurInfo();
      exportStatus(`Ferdig: ${W}×${H}, ${(n / fps).toFixed(1)} s, ${(blob.size / 1e6).toFixed(1)} MB. Videoen kan loopes sømløst i klippeprogrammet. Uskarphet: ${bi.utregnet + bi.innebygd} ganger${bi.reserve ? `, ${bi.reserve} med reserve (${bi.feil})` : ''}.`);
      console.log('[loop-illustrasjon] uskarphet i eksporten', bi);
    } else {
      const zw = zipWriter();
      for (let i = 0; i < n; i++) {
        if (cancelExport) throw new Error('cancel');
        await frameAt(i);
        const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Kunne ikke lage PNG.')), 'image/png'));
        await zw.add(`frame_${String(i).padStart(5, '0')}.png`, blob);
        if (i % 2 === 0) { setProg(i / n); exportStatus(`Lager bilde ${i + 1} av ${n} …`); }
      }
      await zw.add('LES_MEG.txt', new Blob([`Loop-illustrasjon – PNG-sekvens\n${W}x${H}, ${fps} bilder/sek, ${n} bilder.\n\nProRes 4444 med ffmpeg:\nffmpeg -framerate ${fps} -i frame_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0 ${base}.mov\n`], { type: 'text/plain' }));
      const zip = zw.finish();
      setProg(1); download(zip, `${base}-png-${W}x${H}.zip`);
      exportStatus(`Ferdig: ${n} PNG-bilder (${(zip.size / 1e6).toFixed(0)} MB).`);
    }
  } catch (e) {
    if (e && e.message === 'cancel') { exportStatus('Eksport avbrutt.'); setProg(0); }
    else if (e && e.name === 'SecurityError') exportStatus('En av filene tillater ikke eksport fra Labrador. Prøv å laste den opp på nytt.', true);
    else { console.error(e); exportStatus('Eksporten feilet: ' + (e && e.message ? e.message : e), true); }
  } finally {
    if (ex) ex.destroy(); root.remove();
    busy = false; els.exportBtn.textContent = 'Eksporter video';
    if (api && playing) api.playVideos();
  }
});

// ---------- lagring ----------
const FIELDS = ['aspect', 'mobileAspect', 'loop', 'bgType', 'bgColor', 'bgDim', 'bgBlur', 'bgGlowColor', 'trigger', 'width', 'maxH', 'padY', 'posterT', 'altText', 'caption', 'vFormat', 'vRes', 'vFps', 'vLoops'];
const CHECKS = ['bgGlow', 'bgVignette', 'optRound', 'optBand'];
let isRestoring = false;
function serializeState() {
  const o = { bgSrc: state.bgSrc, layers: state.layers };
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
    state.bgSrc = s.bgSrc || '';
    state.layers = Array.isArray(s.layers) ? s.layers.map(l => Object.assign(newLayer(l.type || 'image'), l)) : [];
    state.sel = null; lastLoop = loopLen();
    renderBgMedia(); renderLayers(); updateOutputs(); if (api) applyConfig();
    t0 = performance.now();
  } finally { isRestoring = false; }
}
function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}
FIELDS.forEach(f => { els[f].addEventListener('input', () => scheduleUpdate()); els[f].addEventListener('change', () => scheduleUpdate()); });
CHECKS.forEach(f => els[f].addEventListener('change', () => scheduleUpdate()));

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
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', `Loop-illustrasjon ${new Date().toLocaleDateString('no')}`);
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

// eksempel som vises første gang: nettverk bak, og en mappe med en ring av patroner rundt en logo
function demoLayers() {
  const net = Object.assign(newLayer('network'), { name: 'Nettverk', count: 46, hole: 34, size: 98 });
  const g = Object.assign(newLayer('group'), { name: 'Logo', blur: 16, blurMode: 'out' });
  const ring = Object.assign(newLayer('ring'), { name: 'Patroner', group: g.id, tIn: 0.3, spin: 1, ripple: 0.2, beats: 2 });
  const logo = Object.assign(newLayer('image'), { name: 'Logo', group: g.id, size: 34, tIn: 1.2, tOut: 7.3, exit: 'scale', pulse: 0.05, beats: 4 });
  return [net, g, ring, logo];
}

(async function init() {
  setPreviewWidth(680);
  mountPreview();
  requestAnimationFrame(tick);
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
    if (res.ok && res.state && Array.isArray(res.state.layers)) { applyState(res.state); return; }
  } catch (e) {}
  state.layers = demoLayers();
  renderBgMedia(); renderLayers(); updateOutputs(); applyConfig();
})();
window.addEventListener('resize', () => sizePreview());
