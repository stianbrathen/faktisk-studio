// Faktisk Studio · Prikkeklode
//
// Roterbar klode av prikker. Buer går fra der kontoene styres fra til landene innholdet er rettet mot,
// og hver konto har et klikkbart ikon som åpner et kort med skjermbilder og funn.
// Motoren (engine.js, fpkRun) og embed-byggeren (snippet.js, fpkBuildSnippet) er de samme som i
// embedden — forhåndsvisningen kjører nøyaktig embed-koden. Skjermbilder lenkes fra Labrador, aldri base64.

const PLUGIN_ID = 'prikkeklode';
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
  titleText: $('titleText'), subText: $('subText'),
  placeList: $('placeList'), addSource: $('addSourceBtn'), addTarget: $('addTargetBtn'),
  itemList: $('itemList'), addItem: $('addItemBtn'),
  useView: $('useViewBtn'), homeLon: $('homeLon'), homeLat: $('homeLat'), zoom: $('zoom'),
  bg: $('bg'), optPulses: $('optPulses'), optMotion: $('optMotion'), optLabels: $('optLabels'), optList: $('optList'), cardMode: $('cardMode'),
  trigger: $('triggerSelect'), factsTitle: $('factsTitle'), optHint: $('optHint'), hintText: $('hintText'),
  aspect: $('aspect'), width: $('widthSelect'), optRound: $('optRound'), padTop: $('padTop'), padBot: $('padBot'),
  altText: $('altText'), caption: $('captionText'),
  previewHost: $('previewHost'), playBtn: $('playBtn'), copyEmbed: $('copyEmbedBtn'),
  back_: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
};

const SOURCE_COLORS = ['#FF8A3D', '#3DD6C6', '#F25CA2', '#FFD23F', '#8C7CFF', '#5BC0FF', '#7BD35A'];
const state = { places: [], items: [] };

function uid(p) { return (p || 'x') + '_' + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidUrl(s) { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; } }
function country(name) { return FPK_COUNTRIES.find(c => c[0] === name); }
function newPlace(role, name) {
  const c = country(name) || [name || '', 0, 0];
  const n = state.places.filter(p => p.role === 'source').length;
  return { id: uid('p'), role, name: c[0], lat: c[1], lon: c[2], preset: country(name) ? c[0] : '',
    color: role === 'source' ? SOURCE_COLORS[n % SOURCE_COLORS.length] : '', lab: '' };
}
function newItem() {
  const src = state.places.find(p => p.role === 'source'), tgt = state.places.find(p => p.role === 'target');
  return { id: uid('k'), type: 'side', name: '', from: src ? src.id : '', to: tgt ? tgt.id : '', meta: '', shots: [], warn: '', facts: '', text: '', lift: 0, mark: 0, unconfirmed: false };
}

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
  const imgs = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 120);
  if (!imgs.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder i Labrador ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">Klikk for å velge (nyeste først)</div><div class="mn-batch-list"></div>' +
    '<div class="ftb-labrow"><button type="button" class="ftb-labbtn" data-pick="add">Legg til valgte (0)</button><button type="button" class="ftb-labbtn" data-pick="close">Lukk</button></div>';
  const list = panel.querySelector('.mn-batch-list'), addBtn = panel.querySelector('[data-pick="add"]');
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
  addBtn.addEventListener('click', () => { if (chosen.length) { panel.style.display = 'none'; onPick(chosen.slice()); } });
  panel.querySelector('[data-pick="close"]').addEventListener('click', () => { panel.style.display = 'none'; });
}
function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function uniqueName(name) {
  const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(name || 'skjermbilde.png');
  const base = (m[1] || 'skjermbilde').replace(/[^\wæøåÆØÅ-]+/g, '-').replace(/-+/g, '-').slice(0, 50);
  return base + '-' + Date.now().toString(36) + (m[2] || '.png').toLowerCase();
}
// Laster opp bildefiler (fra filvelger eller Finder) via labradorUploadData og legger URL-ene på kontoen
async function uploadFilesTo(itemId, files, statusEl) {
  files = Array.from(files || []).filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  if (!window.faktisk.labradorUploadData) { await window.faktiskDialog.alert('Denne Studio-versjonen mangler opplasting av bildedata.'); return; }
  const say = (t, err) => { if (!statusEl) return; statusEl.style.display = t ? '' : 'none'; statusEl.textContent = t || ''; statusEl.style.color = err ? '#ffb4b4' : ''; };
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    say(`Laster opp ${i + 1} av ${files.length}: ${f.name}…`);
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error('over 25 MB');
      const dataUrl = await readAsDataUrl(f);
      let res = await window.faktisk.labradorUploadData({ fileName: uniqueName(f.name), dataUrl });
      if (res && res.loggedIn === false) {
        say('Ikke innlogget i Labrador — logg inn i vinduet som åpnes…');
        const st = await window.faktisk.labradorConnect();
        if (!st.loggedIn) throw new Error('ikke innlogget');
        res = await window.faktisk.labradorUploadData({ fileName: uniqueName(f.name), dataUrl });
      }
      if (!res || !res.ok || !res.url) throw new Error((res && res.error) || 'fant ikke URL etter opplasting');
      const it = state.items.find(x => x.id === itemId);
      if (it) it.shots.push(res.url);
      ok++;
    } catch (err) { fail++; console.warn('[prikkeklode] opplasting feilet', f.name, err); }
  }
  renderItems(); scheduleUpdate();
  const st2 = els.itemList.querySelector(`[data-status="${itemId}"]`);
  if (st2) { statusEl = st2; say(fail ? `${ok} lastet opp, ${fail} feilet (se konsollen).` : `${ok} skjermbilde${ok === 1 ? '' : 'r'} lastet opp ✓`, !!fail); setTimeout(() => { if (!fail) say(''); }, 4000); }
}

// ---------- Steder ----------
const LAB_OPTS = [['', 'Navn: automatisk'], ['r', 'Navn til høyre'], ['l', 'Navn til venstre'], ['a', 'Navn over'], ['b', 'Navn under']];
function countryOptions(sel) {
  return '<option value="">Velg land…</option>' + FPK_COUNTRIES.slice().sort((a, b) => a[0].localeCompare(b[0], 'no'))
    .map(c => `<option value="${escapeHtml(c[0])}"${c[0] === sel ? ' selected' : ''}>${escapeHtml(c[0])}</option>`).join('') +
    `<option value="__egen"${sel === '' ? ' selected' : ''}>Eget sted (skriv inn koordinater)</option>`;
}
function renderPlaces() {
  const L = els.placeList;
  L.innerHTML = '';
  if (!state.places.length) { L.innerHTML = '<p class="hk-hint">Ingen steder ennå.</p>'; return; }
  ['source', 'target'].forEach(role => {
    state.places.filter(p => p.role === role).forEach(p => {
      const card = document.createElement('div');
      card.className = 'cb-msg pk-place pk-place--' + role;
      if (role === 'source') card.style.borderLeftColor = p.color;
      card.innerHTML = `
        <div class="hk-row__top">
          <span class="pk-role">${role === 'source' ? 'Styres fra' : 'Rettet mot'}</span>
          <select class="pk-sel" data-act="preset" data-id="${p.id}">${countryOptions(p.preset)}</select>
          <span class="ks-clip__btns"><button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${p.id}" title="Fjern">×</button></span>
        </div>
        <div class="pk-row">
          <input class="hk-row__title" value="${escapeHtml(p.name)}" data-act="name" data-id="${p.id}" placeholder="Navn som vises på kloden">
          ${role === 'source' ? `<input type="color" class="pk-color" value="${escapeHtml(p.color)}" data-act="color" data-id="${p.id}" title="Farge på buene herfra">` : ''}
        </div>
        <div class="pk-row pk-row--small">
          <label>Bredde <input type="number" step="0.01" value="${p.lat}" data-act="lat" data-id="${p.id}"></label>
          <label>Lengde <input type="number" step="0.01" value="${p.lon}" data-act="lon" data-id="${p.id}"></label>
          <select class="pk-sel" data-act="lab" data-id="${p.id}">${LAB_OPTS.map(o => `<option value="${o[0]}"${o[0] === (p.lab || '') ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
        </div>`;
      L.appendChild(card);
    });
  });
}
els.placeList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act="del"]');
  if (!btn) return;
  const id = btn.dataset.id;
  state.places = state.places.filter(p => p.id !== id);
  state.items.forEach(it => { if (it.from === id) it.from = ''; if (it.to === id) it.to = ''; });
  renderPlaces(); renderItems(); scheduleUpdate();
});
els.placeList.addEventListener('input', e => {
  const { act, id } = e.target.dataset;
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  if (act === 'name') { p.name = e.target.value; }
  if (act === 'lat') { p.lat = parseFloat(e.target.value) || 0; p.preset = ''; }
  if (act === 'lon') { p.lon = parseFloat(e.target.value) || 0; p.preset = ''; }
  if (act === 'color') { p.color = e.target.value; e.target.closest('.pk-place').style.borderLeftColor = p.color; }
  scheduleUpdate();
});
els.placeList.addEventListener('change', e => {
  const { act, id } = e.target.dataset;
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  if (act === 'preset') {
    const c = country(e.target.value);
    if (c) { p.name = c[0]; p.lat = c[1]; p.lon = c[2]; p.preset = c[0]; } else p.preset = '';
    renderPlaces();
  }
  if (act === 'lab') p.lab = e.target.value;
  if (act === 'name' || act === 'preset') renderItems();
  if (act === 'lat' || act === 'lon') renderPlaces();
  scheduleUpdate();
});
els.addSource.addEventListener('click', () => { state.places.push(newPlace('source', '')); renderPlaces(); renderItems(); scheduleUpdate(); });
els.addTarget.addEventListener('click', () => { state.places.push(newPlace('target', '')); renderPlaces(); renderItems(); scheduleUpdate(); });

// ---------- Kontoer ----------
function placeOptions(role, sel) {
  const ps = state.places.filter(p => p.role === role);
  return `<option value="">${role === 'source' ? 'Styres fra…' : 'Rettet mot…'}</option>` +
    ps.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${escapeHtml(p.name || '(uten navn)')}</option>`).join('');
}
function renderItems() {
  const L = els.itemList;
  L.innerHTML = '';
  if (!state.items.length) { L.innerHTML = '<p class="hk-hint">Ingen kontoer ennå — trykk «+ Konto».</p>'; return; }
  state.items.forEach((it, i) => {
    const src = state.places.find(p => p.id === it.from);
    const card = document.createElement('div');
    card.className = 'cb-msg pk-item mn-drop';
    card.dataset.drop = it.id;
    if (src) card.style.borderLeftColor = src.color;
    const missing = !src || !state.places.find(p => p.id === it.to);
    card.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num" style="background:${src ? escapeHtml(src.color) : '#777'}">${i + 1}</span>
        <select class="pk-sel pk-sel--type" data-act="type" data-id="${it.id}">
          <option value="side"${it.type !== 'profil' ? ' selected' : ''}>Side</option>
          <option value="profil"${it.type === 'profil' ? ' selected' : ''}>Profil</option>
        </select>
        <input class="hk-row__title" value="${escapeHtml(it.name)}" data-act="name" data-id="${it.id}" placeholder="Navn på siden eller profilen">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-id="${it.id}" ${i === 0 ? 'disabled' : ''} title="Flytt opp">↑</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${it.id}" title="Fjern">×</button>
        </span>
      </div>
      <div class="cb-grid2">
        <select class="pk-sel" data-act="from" data-id="${it.id}">${placeOptions('source', it.from)}</select>
        <select class="pk-sel" data-act="to" data-id="${it.id}">${placeOptions('target', it.to)}</select>
      </div>
      ${missing ? '<p class="pk-warn">Velg både «styres fra» og «rettet mot», ellers vises ikke kontoen.</p>' : ''}
      <input class="hk-row__img" value="${escapeHtml(it.meta)}" data-act="meta" data-id="${it.id}" placeholder="Linje under navnet, f.eks. Side · postet i gruppa NorXit · 15. okt.">
      <div class="pk-shots">
        ${it.shots.map((u, k) => `<span class="pk-shot" title="${escapeHtml(u)}">${isValidUrl(u) ? `<img src="${escapeHtml(u)}" alt="">` : '<span class="mn-thumb--empty"></span>'}
          <button type="button" data-act="shotup" data-id="${it.id}" data-k="${k}" title="Flytt fram" ${k === 0 ? 'disabled' : ''}>‹</button>
          <button type="button" data-act="shotdel" data-id="${it.id}" data-k="${k}" title="Fjern">×</button></span>`).join('')}
        ${it.shots.length ? '' : '<span class="hk-hint" style="margin:0">Ingen skjermbilder ennå</span>'}
      </div>
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="files" data-id="${it.id}">Mine filer ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-id="${it.id}">Last opp…</button>
        <button class="ftb-labbtn" type="button" data-act="url" data-id="${it.id}">Lim inn URL</button>
      </div>
      <div class="ftb-labpanel" data-panel="${it.id}" style="display:none;"></div>
      <div class="hk-hint" data-status="${it.id}" style="display:none;"></div>
      <input class="hk-row__img pk-warninput" value="${escapeHtml(it.warn)}" data-act="warn" data-id="${it.id}" placeholder="Varsel i rødt (valgfritt), f.eks. Postet på feil språk">
      <textarea class="caption-input pk-facts" rows="3" data-act="facts" data-id="${it.id}" placeholder="Funn, én per linje" spellcheck="true">${escapeHtml(it.facts)}</textarea>
      <details class="pk-more"${it.lift || it.mark || it.text || it.unconfirmed ? ' open' : ''}>
        <summary>Mer</summary>
        <label class="ks-check" title="Bare et notat i Studio — vises ikke for leserne"><input type="checkbox" data-act="unconfirmed" data-id="${it.id}"${it.unconfirmed ? ' checked' : ''}><span>Admin-land ikke bekreftet ennå</span></label>
        <label class="cb-range" title="0 = automatisk"><span>Buehøyde</span><input type="range" min="0" max="0.45" step="0.01" value="${it.lift || 0}" data-act="lift" data-id="${it.id}"><output>${it.lift ? Math.round(it.lift * 100) : 'auto'}</output></label>
        <label class="cb-range" title="Hvor på buen ikonet står. 0 = automatisk"><span>Ikon på buen</span><input type="range" min="0" max="0.9" step="0.02" value="${it.mark || 0}" data-act="mark" data-id="${it.id}"><output>${it.mark ? Math.round(it.mark * 100) + ' %' : 'auto'}</output></label>
        <textarea class="caption-input" rows="2" data-act="text" data-id="${it.id}" placeholder="Tekst i kortet når det ikke er skjermbilder">${escapeHtml(it.text)}</textarea>
      </details>
      ${it.unconfirmed ? '<p class="pk-warn">⚠ Admin-land ikke bekreftet (vises ikke for leserne)</p>' : ''}`;
    L.appendChild(card);
  });
}
const fileInput = document.createElement('input');
fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'; fileInput.multiple = true; fileInput.hidden = true;
document.body.appendChild(fileInput);
let uploadTarget = null;
fileInput.addEventListener('change', () => {
  if (uploadTarget) uploadFilesTo(uploadTarget, fileInput.files, els.itemList.querySelector(`[data-status="${uploadTarget}"]`));
});
els.itemList.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset, k = parseInt(btn.dataset.k, 10);
  const i = state.items.findIndex(x => x.id === id), it = state.items[i];
  if (!it) return;
  if (act === 'del') { state.items.splice(i, 1); renderItems(); scheduleUpdate(); }
  if (act === 'up' && i > 0) { state.items.splice(i, 1); state.items.splice(i - 1, 0, it); renderItems(); scheduleUpdate(); }
  if (act === 'shotdel') { it.shots.splice(k, 1); renderItems(); scheduleUpdate(); }
  if (act === 'shotup' && k > 0) { const [s] = it.shots.splice(k, 1); it.shots.splice(k - 1, 0, s); renderItems(); scheduleUpdate(); }
  if (act === 'files') {
    const panel = els.itemList.querySelector(`[data-panel="${id}"]`);
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, urls => { it.shots.push(...urls); renderItems(); scheduleUpdate(); }, () => { panel.style.display = 'none'; btn.click(); });
  }
  if (act === 'upload') { uploadTarget = id; fileInput.value = ''; fileInput.click(); }
  if (act === 'url') {
    const u = await window.faktiskDialog.prompt('Lim inn bilde-URL fra Labrador:', '');
    if (!u || !u.trim()) return;
    if (!isValidUrl(u.trim())) { await window.faktiskDialog.alert('Det ser ikke ut som en gyldig https-adresse.'); return; }
    it.shots.push(u.trim()); renderItems(); scheduleUpdate();
  }
});
els.itemList.addEventListener('input', e => {
  const { act, id } = e.target.dataset;
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  if (['name', 'meta', 'warn', 'facts', 'text'].includes(act)) it[act] = e.target.value;
  if (act === 'lift' || act === 'mark') {
    it[act] = parseFloat(e.target.value) || 0;
    const out = e.target.parentNode.querySelector('output');
    if (out) out.textContent = it[act] ? (act === 'mark' ? Math.round(it[act] * 100) + ' %' : Math.round(it[act] * 100)) : 'auto';
  }
  scheduleUpdate();
});
els.itemList.addEventListener('change', e => {
  const { act, id } = e.target.dataset;
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  if (act === 'type' || act === 'from' || act === 'to') { it[act] = e.target.value; renderItems(); }
  if (act === 'unconfirmed') { it.unconfirmed = e.target.checked; renderItems(); }
  scheduleUpdate();
});
['dragenter', 'dragover'].forEach(ev => els.itemList.addEventListener(ev, e => {
  const card = e.target.closest('[data-drop]');
  if (card && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('is-over'); }
}));
['dragleave', 'drop'].forEach(ev => els.itemList.addEventListener(ev, e => { const c = e.target.closest('[data-drop]'); if (c) c.classList.remove('is-over'); }));
els.itemList.addEventListener('drop', e => {
  const card = e.target.closest('[data-drop]');
  if (!card) return;
  e.preventDefault();
  uploadFilesTo(card.dataset.drop, e.dataTransfer.files, card.querySelector('[data-status]'));
});
els.addItem.addEventListener('click', () => { state.items.push(newItem()); renderItems(); scheduleUpdate(); });

// ---------- Startvisning ----------
function previewRoot() { return els.previewHost.querySelector('[id^="fpk-"][role="group"]'); }
els.useView.addEventListener('click', () => {
  const r = previewRoot();
  if (!r || !r.__fpkView) return;
  const v = r.__fpkView();
  els.homeLon.value = v.lon; els.homeLat.value = v.lat;
  scheduleUpdate();
});

// Sentrer på gjennomsnittet av stedene og zoom så det fjerneste får plass
$('fitBtn').addEventListener('click', () => {
  const ps = state.places.filter(p => isFinite(p.lat) && isFinite(p.lon));
  if (!ps.length) return;
  const R = Math.PI / 180, v = [0, 0, 0];
  const vec = p => [Math.cos(p.lat * R) * Math.cos(p.lon * R), Math.cos(p.lat * R) * Math.sin(p.lon * R), Math.sin(p.lat * R)];
  ps.forEach(p => { const a = vec(p); v[0] += a[0]; v[1] += a[1]; v[2] += a[2]; });
  const n = Math.hypot(v[0], v[1], v[2]) || 1, c = [v[0] / n, v[1] / n, v[2] / n];
  const lon = Math.atan2(c[1], c[0]) / R, lat = Math.asin(c[2]) / R;
  let maxA = 0;
  ps.forEach(p => { const a = vec(p); maxA = Math.max(maxA, Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])))); });
  const zoom = Math.max(0.9, Math.min(2.6, 1.15 / Math.max(Math.sin(Math.min(maxA + 0.08, Math.PI / 2)), 0.2)));
  els.homeLon.value = Math.round(lon * 2) / 2; els.homeLat.value = Math.round(Math.max(-55, Math.min(75, lat + 3)) * 2) / 2;
  els.zoom.value = Math.round(zoom * 20) / 20;
  scheduleUpdate();
});

// ---------- Konfig → embed ----------
function readConfig() {
  const places = state.places.filter(p => isFinite(p.lat) && isFinite(p.lon))
    .map(p => ({ id: p.id, name: (p.name || '').trim(), lat: +p.lat, lon: +p.lon, role: p.role, color: p.color, lab: p.lab }));
  const ok = new Set(places.map(p => p.id));
  return {
    title: els.titleText.value.trim(), sub: els.subText.value.trim(), bg: els.bg.value,
    home: { lon: parseFloat(els.homeLon.value) || 0, lat: parseFloat(els.homeLat.value) || 0 }, zoom: parseFloat(els.zoom.value) || 1,
    places,
    items: state.items.filter(it => ok.has(it.from) && ok.has(it.to)).map(it => ({
      from: it.from, to: it.to, type: it.type, name: (it.name || '').trim(), meta: (it.meta || '').trim(),
      shots: it.shots.filter(u => (u || '').trim()), warn: (it.warn || '').trim(),
      facts: (it.facts || '').split('\n').map(s => s.trim()).filter(Boolean), text: (it.text || '').trim(), lift: it.lift, mark: it.mark,
    })),
    factsTitle: els.factsTitle.value.trim(), pulses: els.optPulses.checked, motion: els.optMotion.checked ? 1 : 0,
    labels: els.optLabels.checked, list: els.optList.checked, cardMode: els.cardMode.value, trigger: els.trigger.value,
    hint: els.optHint.checked, hintText: els.hintText.value.trim(),
    aspect: els.aspect.value, width: els.width.value, round: els.optRound.checked,
    padTop: parseInt(els.padTop.value, 10), padBot: parseInt(els.padBot.value, 10),
    alt: els.altText.value.trim(), caption: els.caption.value.trim(), version: PLUGIN_VERSION,
  };
}
function buildEmbedSnippet(cfg) {
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fpk-container') : '';
  return fpkBuildSnippet(cfg || readConfig(), fpkRun.toString(), FPK_DOTS, baseCss);
}

// ---------- Forhåndsvisning ----------
function mountSnippet(host, html, isStatic) {
  // Kort som er flyttet ut i <body> (over hele siden) fra forrige forhåndsvisning
  document.querySelectorAll('[class*="fpk-ov-"]').forEach(n => n.remove());
  host.innerHTML = html;
  const root = host.querySelector('[id^="fpk-"][role="group"]');
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
  if (root && root.__fpkPlay) root.__fpkPlay();
});
const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = $('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

function updateOutputs() {
  $('zoomOut').textContent = parseFloat(els.zoom.value).toFixed(2).replace('.', ',') + '×';
  $('padTopOut').textContent = els.padTop.value + ' px';
  $('padBotOut').textContent = els.padBot.value + ' px';
  els.hintText.style.display = els.optHint.checked ? '' : 'none';
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, 250);
}

els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.items.length) { await window.faktiskDialog.alert('Legg til minst én konto med både «styres fra» og «rettet mot».'); return; }
  const bad = cfg.items.flatMap(it => it.shots).filter(u => !isValidUrl(u));
  if (bad.length) { await window.faktiskDialog.alert('Noen skjermbilder er ikke lastet opp til Labrador (de har ingen https-adresse). Last dem opp først.'); return; }
  const unconfirmed = state.items.filter(it => it.unconfirmed).map(it => it.name || '(uten navn)');
  if (unconfirmed.length && !(await window.faktiskDialog.confirm('Admin-land er ikke bekreftet for: ' + unconfirmed.join(', ') + '. Kopiere likevel?'))) return;
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
const FIELDS = ['titleText', 'subText', 'homeLon', 'homeLat', 'zoom', 'bg', 'cardMode', 'trigger', 'factsTitle', 'hintText', 'aspect', 'width', 'padTop', 'padBot', 'altText', 'caption'];
const CHECKS = ['optPulses', 'optMotion', 'optLabels', 'optList', 'optHint', 'optRound'];
let isRestoring = false;
function serializeState() {
  const o = { places: JSON.parse(JSON.stringify(state.places)), items: JSON.parse(JSON.stringify(state.items)) };
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
    if (Array.isArray(s.places)) state.places = s.places.map(p => Object.assign({ id: uid('p'), role: 'source', name: '', lat: 0, lon: 0, preset: '', color: '', lab: '' }, p));
    if (Array.isArray(s.items)) state.items = s.items.map(it => Object.assign(newItem(), it, { shots: Array.isArray(it.shots) ? it.shots.slice() : [] }));
    renderPlaces(); renderItems(); renderPreview();
  } finally { isRestoring = false; }
}
function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}
FIELDS.forEach(f => { els[f].addEventListener('input', scheduleUpdate); els[f].addEventListener('change', scheduleUpdate); });
CHECKS.forEach(f => els[f].addEventListener('change', scheduleUpdate));

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
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', `Prikkeklode ${new Date().toLocaleDateString('no')}`);
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

function defaultState() {
  state.places = [newPlace('source', 'Tyskland')];
  state.places.push(newPlace('target', 'Norge'));
  state.items = [newItem()];
  renderPlaces(); renderItems(); renderPreview();
}

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
    if (res.ok && res.state && Array.isArray(res.state.places)) { applyState(res.state); return; }
  } catch (e) {}
  defaultState();
})();
