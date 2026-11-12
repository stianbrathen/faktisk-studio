// Faktisk Studio · Medieslider
//
// Slider med egne bilder og videoer til artikler: en serie utklipp, skjermbilder
// av innlegg, klipp osv. Bygget på Videoslider, men for alle formater og med
// tekst per element (bildetekst, kilde, dato, lenke).
//
// Embedden:
// - er ferdig rendret HTML (kortene vises også når skriptet sover i Labrador),
// - lenker bilder, videoer og stillbilder fra Labrador (aldri base64),
// - laster video først når den vises stort,
// - har tre visninger (velges i editoren): hele skjermen med dempet bakgrunn,
//   stort over siden (utover spalten der det er plass), eller bare slider,
// - er scopet til en unik klasse, så flere bokser kan stå på samme side,
// - måler med Fathom (se runtime.js).
// Forhåndsvisningen ER embed-markupen; runtime.js (fmsRun) kjører med preview: true.

const PLUGIN_ID = 'medieslider';
let PLUGIN_VERSION = '';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    if (me) PLUGIN_VERSION = me.version;
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const $ = id => document.getElementById(id);
const els = {
  kicker: $('kickerInput'), title: $('titleInput'), lede: $('ledeInput'),
  mode: $('modeSelect'), shape: $('shapeSelect'), size: $('sizeSelect'), linkLabel: $('linkLabel'), link2Label: $('link2Label'),
  addFiles: $('addFilesBtn'), addUpload: $('addUploadBtn'), addEmpty: $('addEmptyBtn'),
  addBatch: $('addBatchBtn'), batchInput: $('batchInput'),
  addPanel: $('addPanel'), addStatus: $('addStatus'),
  list: $('itemList'), allPosters: $('allPostersBtn'),
  previewWidth: $('previewWidthSelect'), previewHost: $('previewHost'), copyEmbed: $('copyEmbedBtn'),
  back: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
  importToggle: $('importToggle'), importPanel: $('importPanel'), importInput: $('importInput'),
  importBtn: $('importBtn'), importStatus: $('importStatus'),
  picker: $('picker'), pickerVideo: $('pickerVideo'), pickerTime: $('pickerTime'),
  pickerUse: $('pickerUse'), pickerCancel: $('pickerCancel'),
};

const state = {
  // { key, type ('image'|'video'), src, poster, posterAt, w, h, dur,
  //   caption, credit, date (ÅÅÅÅ-MM-DD), link, linkLabel, link2, link2Label, alt }
  // 0.1.4: link = lenke 1 (f.eks. arkivert innlegg), link2 = lenke 2 (f.eks. der bildet først
  // ble publisert). linkLabel/link2Label = egen tekst på lenken; tom = felles tekst
  // (lenke 1) eller automatisk tekst («Først publisert hos NRK», lenke 2).
  items: [],
};
const busy = new Map();   // key → statustekst mens stillbilde lages (lagres ikke)

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ZOOM_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zM5 14h2v3h3v2H5v-5zm12 0h2v5h-5v-2h3v-3z"/></svg>';
const LEFT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>';
const RIGHT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(\?|#|$)/i;
const IMG_EXT = /\.(png|jpe?g|gif|avif|webp)(\?|#|$)/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|webm|png|jpe?g|gif|avif|webp)(\?|#|$)/i;
const FILTERS = {
  // Labrador tar mp4 (ikke mov). Eksporter mp4 med H.264 og «fast start».
  media: [{ name: 'Bilde eller video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'mp4'] }],
  image: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }],
};
const SHAPES = { original: 0, portrait: 4 / 5, square: 1, landscape: 16 / 9 };
// Kortstørrelse i slideren: høyden følger embeddens bredde (cqw = % av
// bredden), med grenser. Ved 680 px (artikkelspalte): ca. 204 / 258 / 374 /
// 544 px høye kort; full bredde (1048): 220 / 290 / 420 / 600; mobil (350):
// 150 / 200 / 260 / 300. «Ekstra store» viser i praksis ett kort om gangen.
const SIZES = {
  small:  { h: 'clamp(150px, 30cqw, 220px)', max: 'min(78cqw, 560px)' },
  medium: { h: 'clamp(200px, 38cqw, 290px)', max: 'min(78cqw, 560px)' },
  large:  { h: 'min(clamp(260px, 55cqw, 420px), 75vh)', max: 'calc(100cqw - 60px)' },
  xl:     { h: 'min(clamp(300px, 80cqw, 600px), 78vh)', max: 'calc(100cqw - 60px)' },
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidUrl(s) {
  try { const u = new URL(String(s || '').trim()); return u.protocol === 'https:' || u.protocol === 'http:'; }
  catch (e) { return false; }
}
function isLabradorUrl(u) { return /faktisk\.no\//.test(u || ''); }
// 0.1.4: navn på redaksjonen bak en lenke, til den automatiske teksten på lenke 2
const OUTLETS = {
  'nrk.no': 'NRK', 'vg.no': 'VG', 'dagbladet.no': 'Dagbladet', 'aftenposten.no': 'Aftenposten',
  'tv2.no': 'TV 2', 'nettavisen.no': 'Nettavisen', 'dn.no': 'DN', 'e24.no': 'E24',
  'abcnyheter.no': 'ABC Nyheter', 'bt.no': 'Bergens Tidende', 'adressa.no': 'Adresseavisen',
  'aftenbladet.no': 'Stavanger Aftenblad', 'nationen.no': 'Nationen', 'klassekampen.no': 'Klassekampen',
  'vl.no': 'Vårt Land', 'dagsavisen.no': 'Dagsavisen', 'document.no': 'Document', 'resett.no': 'Resett',
  'p4.no': 'P4', 'tek.no': 'Tek.no', 'faktisk.no': 'Faktisk.no',
  'ifinnmark.no': 'iFinnmark', 'itromso.no': 'iTromsø', 'fvn.no': 'Fædrelandsvennen', 'ba.no': 'Bergensavisen',
  'tb.no': 'Tønsbergs Blad', 'rb.no': 'Romerikes Blad', 'oa.no': 'Oppland Arbeiderblad', 'h-avis.no': 'Hamar Arbeiderblad',
  'smp.no': 'Sunnmørsposten', 'rbnett.no': 'Romsdals Budstikke', 'an.no': 'Avisa Nordland', 'tk.no': 'Tidens Krav',
  'dr.dk': 'DR', 'tv2.dk': 'TV 2', 'politiken.dk': 'Politiken', 'bt.dk': 'B.T.', 'ekstrabladet.dk': 'Ekstra Bladet',
  'svt.se': 'SVT', 'aftonbladet.se': 'Aftonbladet', 'expressen.se': 'Expressen', 'dn.se': 'DN',
  'bbc.co.uk': 'BBC', 'bbc.com': 'BBC', 'reuters.com': 'Reuters', 'apnews.com': 'AP', 'theguardian.com': 'The Guardian',
  'spiegel.de': 'Der Spiegel', 'bild.de': 'Bild', 'tagesschau.de': 'Tagesschau', 'zeit.de': 'Die Zeit',
};
function outletName(url) {
  let host = '';
  try { host = new URL(String(url).trim()).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
  const parts = host.split('.');
  for (let n = parts.length; n >= 2; n--) {
    const h = parts.slice(-n).join('.');
    if (OUTLETS[h]) return OUTLETS[h];
  }
  return host;
}
function l2Placeholder(v) {
  return v.link2 ? 'Tekst: ' + link2Text(Object.assign({}, v, { link2Label: '' })) : 'Tekst (lages fra lenken, f.eks. «Først publisert hos NRK»)';
}
// Teksten på lenke 1 for ett element: egen tekst, ellers felles tekst
function link1Text(v) {
  if (v.linkLabel && v.linkLabel.trim()) return v.linkLabel.trim();
  return (els.linkLabel.value || '').trim() || 'Se originalen';
}
// Teksten på lenke 2 for ett element: egen tekst, ellers «<prefiks> <redaksjon>»
function link2Text(v) {
  if (v.link2Label && v.link2Label.trim()) return v.link2Label.trim();
  const pre = (els.link2Label.value || '').trim() || 'Først publisert hos';
  const name = outletName(v.link2);
  return name ? pre + ' ' + name : pre;
}

function cleanUrl(u) {
  u = String(u || '').trim();
  try { return encodeURI(decodeURI(u)); } catch (e) { return u; }
}
function fileName(u) {
  const last = String(u || '').split('#')[0].split('?')[0].split('/').pop() || '';
  try { return decodeURIComponent(last); } catch (e) { return last; }
}
function typeOf(u) { return VIDEO_EXT.test(u || '') ? 'video' : 'image'; }
function fmtDur(sec) {
  if (!(sec > 0) || !isFinite(sec)) return '';
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtSec(t) { return (Math.round((t || 0) * 10) / 10).toFixed(1).replace('.', ',') + ' s'; }
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return String(iso || '').trim();
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}
function newItem(o) {
  const it = Object.assign({
    key: 'm_' + Math.random().toString(36).slice(2, 7), type: 'image', src: '', poster: '', posterAt: 1,
    w: 0, h: 0, dur: '', caption: '', credit: '', date: '', link: '', linkLabel: '', link2: '', link2Label: '', alt: '',
  }, o || {});
  if (it.src && !(o && o.type)) it.type = typeOf(it.src);
  return it;
}
const alertBox = msg => window.faktiskDialog.alert(msg);

// ============================================================
//  Lista i sidepanelet
// ============================================================

function renderItems() {
  // Stillbilder lages i bakgrunnen og tegner lista på nytt: behold feltet
  // redaktøren skriver i (fokus og markør), så teksten ikke blir avbrutt.
  const a = document.activeElement;
  const keep = a && els.list.contains(a) && a.dataset && a.dataset.k
    ? { k: a.dataset.k, act: a.dataset.act, s: a.selectionStart, e: a.selectionEnd } : null;
  els.list.innerHTML = '';
  state.items.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'hk-row ms-row';
    const isVid = v.type === 'video';
    const b = busy.get(v.key);
    const thumb = isVid ? v.poster : v.src;
    const srcBad = v.src && !isLabradorUrl(v.src);
    let stateText = '', stateCls = '';
    if (isVid) {
      stateText = b || (isLabradorUrl(v.poster) ? 'Stillbilde i Labrador ✓' : v.poster ? 'Stillbildet ligger ikke i Labrador' : 'Mangler stillbilde');
      stateCls = b ? '' : isLabradorUrl(v.poster) ? 'is-ok' : 'is-bad';
    } else if (v.w && v.h) {
      stateText = v.w + ' × ' + v.h;
    }
    row.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${i + 1}</span>
        <span class="ms-type ${isVid ? 'is-video' : ''}">${isVid ? 'Video' : 'Bilde'}</span>
        <span class="ks-clip__btns">
          <button class="tb-row__btn" type="button" data-act="up" data-k="${v.key}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn" type="button" data-act="down" data-k="${v.key}" title="Flytt ned" ${i === state.items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tb-row__btn tb-row__btn--del" type="button" data-act="del" data-k="${v.key}" title="Fjern">×</button>
        </span>
      </div>
      <div class="vs-media">
        <span class="vs-thumbbtn ms-thumb">${thumb
          ? `<img class="vs-thumb ms-thumbimg" src="${escapeHtml(thumb)}" alt="">`
          : `<span class="vs-thumb vs-thumb--empty ms-thumbimg">${isVid ? '▶' : '·'}</span>`}</span>
        <div class="vs-fields">
          <input class="hk-row__img" value="${escapeHtml(v.src)}" data-k="${v.key}" data-act="src" placeholder="Bilde- eller video-URL fra Labrador" spellcheck="false">
          <textarea class="caption-input ms-cap" rows="2" data-k="${v.key}" data-act="caption" placeholder="Bildetekst (valgfri)">${escapeHtml(v.caption)}</textarea>
          <div class="vs-pair ms-pair">
            <input class="caption-input caption-input--single" value="${escapeHtml(v.credit)}" data-k="${v.key}" data-act="credit" placeholder="Kilde, f.eks. Skjermbilde: Facebook">
            <input class="caption-input caption-input--single ms-date" type="date" value="${escapeHtml(v.date)}" data-k="${v.key}" data-act="date" title="Dato (valgfri)">
          </div>
          <div class="ms-linkpair">
            <input class="hk-row__img" value="${escapeHtml(v.link)}" data-k="${v.key}" data-act="link" placeholder="Lenke 1, f.eks. arkivert innlegg (valgfri)" spellcheck="false">
            <input class="caption-input caption-input--single" value="${escapeHtml(v.linkLabel)}" data-k="${v.key}" data-act="linkLabel" placeholder="Tekst: ${escapeHtml(link1Text(Object.assign({}, v, { linkLabel: '' })))}">
          </div>
          <div class="ms-linkpair">
            <input class="hk-row__img" value="${escapeHtml(v.link2)}" data-k="${v.key}" data-act="link2" placeholder="Lenke 2, f.eks. der bildet først ble publisert (valgfri)" spellcheck="false">
            <input class="caption-input caption-input--single" value="${escapeHtml(v.link2Label)}" data-k="${v.key}" data-act="link2Label" placeholder="${escapeHtml(l2Placeholder(v))}">
          </div>
          <input class="hk-row__img" value="${escapeHtml(v.alt)}" data-k="${v.key}" data-act="alt" placeholder="Alt-tekst for skjermlesere (ellers brukes bildeteksten)">
          <div class="vs-meta">
            ${isVid ? `<span class="vs-dur ms-dur">${escapeHtml(v.dur || '–:––')}</span>` : ''}
            <span class="vs-poststate ${stateCls}">${escapeHtml(stateText)}</span>
          </div>
        </div>
      </div>
      ${srcBad ? '<p class="vs-row-warn">Fila ligger ikke i Labrador.</p>' : ''}
      ${isVid ? `<div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="pick" data-k="${v.key}" ${v.src && !b ? '' : 'disabled'}>Velg stillbilde…</button>
        <button class="ftb-labbtn" type="button" data-act="files" data-k="${v.key}">Bilde fra Labrador ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-k="${v.key}">Last opp bilde…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${v.key}" style="display:none;"></div>` : ''}`;
    els.list.appendChild(row);
  });
  if (keep) {
    const el = els.list.querySelector(`[data-k="${keep.k}"][data-act="${keep.act}"]`);
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {}
    }
  }
}

els.list.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || btn.disabled) return;
  const { act, k } = btn.dataset;
  const i = state.items.findIndex(x => x.key === k);
  if (i < 0) return;
  const v = state.items[i];
  if (act === 'del') { state.items.splice(i, 1); renderItems(); scheduleUpdate(); }
  if (act === 'up' || act === 'down') {
    const j = i + (act === 'up' ? -1 : 1);
    if (j < 0 || j >= state.items.length) return;
    const [x] = state.items.splice(i, 1);
    state.items.splice(j, 0, x);
    renderItems(); scheduleUpdate();
  }
  if (act === 'pick') openPicker(v);
  if (act === 'files') {
    const panel = els.list.querySelector(`[data-panel="${k}"]`);
    openFilePanel(panel, IMG_EXT, 'bilder', url => { v.poster = url; renderItems(); scheduleUpdate(); });
  }
  if (act === 'upload') uploadFile(btn, 'image', url => { v.poster = url; renderItems(); scheduleUpdate(); });
});

els.list.addEventListener('input', e => {
  const { act, k } = e.target.dataset;
  const v = state.items.find(x => x.key === k);
  if (!v || !act) return;
  const val = e.target.value;
  if (['caption', 'credit', 'alt', 'linkLabel', 'link2Label'].includes(act)) v[act] = val;
  if (act === 'link' || act === 'link2' || act === 'date') v[act] = val.trim();
  if (act === 'link2') {
    // Vis/oppdater feltet for egen tekst uten å tegne lista på nytt (beholder markøren)
    const lab = els.list.querySelector(`[data-k="${k}"][data-act="link2Label"]`);
    if (lab) lab.placeholder = l2Placeholder(v);
  }
  if (act === 'src') v.src = val.trim();
  scheduleUpdate();
});

// Ny URL: finn type og mål på nytt, og lag stillbilde for video
els.list.addEventListener('change', e => {
  const { act, k } = e.target.dataset;
  const v = state.items.find(x => x.key === k);
  if (!v || act !== 'src') return;
  Object.assign(v, { type: typeOf(v.src), w: 0, h: 0, dur: '', poster: '', posterAt: 1 });
  renderItems(); scheduleUpdate(); probe(v);
});

// ============================================================
//  Legge til bilder og videoer
// ============================================================

function setAddStatus(msg, bad) {
  els.addStatus.textContent = msg || '';
  els.addStatus.classList.toggle('is-bad', !!bad);
}

// «+ Fra Labrador»: panelet står åpent, så flere filer kan legges til etter
// hverandre. De legges sist, i den rekkefølgen de klikkes (en serie leses
// fra venstre).
els.addFiles.addEventListener('click', () => {
  openFilePanel(els.addPanel, MEDIA_EXT, 'bilder og videoer', url => {
    const v = newItem({ src: url });
    state.items.push(v);
    renderItems(); scheduleUpdate();
    setAddStatus(`La til «${fileName(url)}».`);
    probe(v);
  }, { keepOpen: true });
});

els.addUpload.addEventListener('click', () => uploadFile(els.addUpload, 'media', url => {
  const v = newItem({ src: url });
  state.items.push(v);
  renderItems(); scheduleUpdate();
  probe(v);
}));

// ---------- Mange bilder på én gang ----------
// «Flere bilder…» (eller dra fra Finder): bildene lastes opp til Labrador ett
// og ett og legges sist i rekka i den rekkefølgen de ble valgt. Store bilder
// skaleres ned til maks 1800 px på lengste side og gjøres om til WebP før opplasting (skjermbilder
// fra Retina-skjermer kan være 3000–6000 px). Video tas én om gangen med
// «Last opp…» (Studio komprimerer og håndterer store filer der).
const MAX_SIDE = 1800;   // 0.1.3: nok for stor visning på Retina, og mye lettere enn 2400
const IMG_FILE = /^image\/(png|jpeg|webp|avif|gif)$/;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Kunne ikke lese fila'));
    r.readAsDataURL(blob);
  });
}
function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kunne ikke lese bildet'));
    img.src = url;
  });
}
// → { dataUrl, name, w, h } klar for opplasting
// 0.1.3: alle bilder unntatt GIF gjøres om til WebP (kvalitet 0,85) og skaleres
// ned til maks MAX_SIDE. Før ble PNG-skjermbilder lastet opp som PNG – ca. 560 KB
// per bilde, 19 MB for tre slidere. Som WebP blir de ca. 75 KB, uten synlig
// forskjell på tekst i skjermbilder.
async function prepareImage(file) {
  const dataUrl = await readAsDataUrl(file);
  if (file.type === 'image/gif') return { dataUrl, name: file.name, w: 0, h: 0 };   // behold animasjon
  const img = await loadImg(dataUrl);
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';               // gjennomsiktige PNG-er får hvit bakgrunn
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  const base = String(file.name || 'bilde').replace(/\.[^.]+$/, '');
  let out = c.toDataURL('image/webp', 0.85);
  let name = base + '.webp';
  if (!/^data:image\/webp/.test(out)) { out = c.toDataURL('image/jpeg', 0.85); name = base + '.jpg'; }
  // Allerede lett WebP/JPEG i riktig størrelse: behold originalen hvis den er mindre
  if (scale >= 1 && /^image\/(webp|jpeg)$/.test(file.type) && dataUrl.length < out.length) {
    return { dataUrl, name: file.name, w, h };
  }
  return { dataUrl: out, name, w: cw, h: ch };
}

// Kort, trygt og unikt filnavn som fortsatt sier hva bildet er:
//   «Skjermbilde 2026-11-04 kl. 10.23.45.png» → «skjermbilde-1104-102345-k3x1.png»
//   «Bjørnøya på Åsgårdstrand – Facebook-innlegget som spredte seg.jpg»
//     → «bjornoya-pa-asgardstrand-k3x2.jpg» (maks 28 tegn, kuttet ved ordgrense)
// Bare a–z, 0–9 og bindestrek (Labrador endret navn med mellomrom/punktum/æøå,
// og da fant ikke Studio fila igjen), og en kort unik hale så like navn aldri
// kolliderer.
function uploadName(orig, n) {
  const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(String(orig || 'bilde'));
  const ext = (m[2] || '.jpg').toLowerCase();
  const tail = (Date.now().toString(36) + (n || 0).toString(36)).slice(-4);
  const raw = (m[1] || '').trim();
  // Skjermbilder fra macOS/iOS: behold dato og klokkeslett, kortere
  const sc = /^(skjermbilde|screenshot|skjermopptak|screen shot)\D*\d{2}(\d{2})-(\d{2})-(\d{2})\D+(\d{1,2})[.:](\d{2})[.:](\d{2})/i.exec(raw);
  if (sc) {
    const kind = /opptak/i.test(sc[1]) ? 'skjermopptak' : 'skjermbilde';
    return `${kind}-${sc[3]}${sc[4]}-${sc[5].padStart(2, '0')}${sc[6]}${sc[7]}-${tail}${ext}`;
  }
  let slug = raw.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > 28) {
    const cut = slug.slice(0, 29);
    const at = cut.lastIndexOf('-');
    slug = (at >= 12 ? cut.slice(0, at) : cut.slice(0, 28)).replace(/-+$/, '');
  }
  return (slug || 'bilde') + '-' + tail + ext;
}
// Finn den opplastede fila i Labrador selv om navnet er litt endret
async function findUploaded(name) {
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  // Reserve: den unike halen + filendelsen på slutten av navnet
  const tail = norm(name.split('-').pop());
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const list = await window.faktisk.labradorListFiles();
      const files = (list && list.files) || [];
      const hit = files.find(f => norm(f.name) === want) || files.find(f => tail.length > 4 && norm(f.name).endsWith(tail));
      if (hit) return hit.url;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1200));   // lista kan henge litt etter
  }
  return '';
}

let batchBusy = false;
async function uploadBatch(files) {
  const list = Array.from(files || []).filter(f => IMG_FILE.test(f.type));
  const skipped = (files ? files.length : 0) - list.length;
  if (!list.length) { setAddStatus(skipped ? 'Bare bilder kan lastes opp flere om gangen – ta videoer med «Last opp…».' : '', !!skipped); return; }
  if (batchBusy) return;
  const st = await ensureLoggedIn();
  if (!st) { setAddStatus('Logg inn i Labrador først.', true); return; }
  batchBusy = true;
  els.addBatch.disabled = true;
  let ok = 0;
  const fails = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setAddStatus(`Laster opp ${i + 1} av ${list.length}: ${f.name}`);
      try {
        const p = await prepareImage(f);
        const name = uploadName(p.name, i);
        const res = await window.faktisk.labradorUploadData({ fileName: name, dataUrl: p.dataUrl });
        if (!res || !res.ok) throw new Error((res && res.error) || 'opplastingen feilet');
        // Labrador kan endre filnavnet litt, og da finner ikke Studio adressen
        // (svarer ok uten url). Let selv i fillista.
        const url = res.url || await findUploaded(name);
        if (!url) throw new Error('lastet opp, men fant ikke adressen – se «+ Fra Labrador»');
        const v = newItem({ src: url, type: 'image', w: p.w, h: p.h });
        state.items.push(v);
        ok++;
        renderItems(); scheduleUpdate();
        if (!v.w) probe(v);
      } catch (err) {
        fails.push(f.name + ' (' + err.message + ')');
      }
    }
  } finally {
    batchBusy = false;
    els.addBatch.disabled = false;
  }
  const extra = skipped ? ` ${skipped} fil${skipped === 1 ? '' : 'er'} som ikke er bilder ble hoppet over.` : '';
  if (fails.length) setAddStatus(`La til ${ok} av ${list.length}. Feilet: ${fails.join('; ')}.${extra}`, true);
  else setAddStatus(`La til ${ok} ${ok === 1 ? 'bilde' : 'bilder'} sist i rekka.${extra}`);
}

els.addBatch.addEventListener('click', () => { if (!batchBusy) els.batchInput.click(); });
els.batchInput.addEventListener('change', () => {
  const files = els.batchInput.files;
  uploadBatch(files).finally(() => { els.batchInput.value = ''; });
});

// Dra og slipp fra Finder på sidepanelet
(function () {
  const zone = document.querySelector('.plugin-sidebar');
  if (!zone) return;
  let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  zone.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.classList.add('ms-drop'); });
  zone.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('ms-drop'); });
  zone.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; zone.classList.remove('ms-drop');
    uploadBatch(e.dataTransfer.files);
  });
})();

els.addEmpty.addEventListener('click', () => {
  state.items.push(newItem());
  renderItems(); scheduleUpdate();
  const rows = els.list.querySelectorAll('[data-act="src"]');
  if (rows.length) rows[rows.length - 1].focus();
});

// Størrelse (og varighet) fra fila, så kortene får riktig form uten hopp
function probeImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), 20000);
    img.onload = () => { clearTimeout(t); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}
function probeVideo(url) {
  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    let t = null;
    const done = r => {
      clearTimeout(t);
      vid.removeAttribute('src');
      try { vid.load(); } catch (e) {}
      resolve(r);
    };
    t = setTimeout(() => done(null), 20000);
    vid.addEventListener('loadedmetadata', () => done({
      w: vid.videoWidth, h: vid.videoHeight, dur: isFinite(vid.duration) ? vid.duration : 0,
    }), { once: true });
    vid.addEventListener('error', () => done(null), { once: true });
    vid.src = url;
  });
}

// Stillbilder lages ett om gangen (Studio laster ned videoen og kjører ffmpeg)
let posterQueue = Promise.resolve();
function queue(fn) {
  const p = posterQueue.then(fn, fn);
  posterQueue = p.catch(() => {});
  return p;
}

async function probe(v) {
  if (!isValidUrl(v.src)) return;
  if (v.type === 'image') {
    if (!v.w) {
      const r = await probeImage(v.src);
      if (r && r.w) { v.w = r.w; v.h = r.h; renderItems(); scheduleUpdate(); }
    }
    return;
  }
  if (!v.w || !v.dur) {
    const r = await probeVideo(v.src);
    if (r) {
      if (r.w) { v.w = r.w; v.h = r.h; }
      if (r.dur && !v.dur) v.dur = fmtDur(r.dur);
      renderItems(); scheduleUpdate();
    }
  }
  if (!v.poster && isLabradorUrl(v.src)) {
    await queue(() => (state.items.includes(v) && !v.poster) ? makePoster(v, v.posterAt || 1, { quiet: true }) : false);
  }
}

async function ensureLoggedIn() {
  const st = await window.faktisk.labradorListFiles();
  if (st && st.loggedIn) return st;
  const c = await window.faktisk.labradorConnect();
  if (!c || !c.loggedIn) return null;
  return window.faktisk.labradorListFiles();
}

// Studio henter bildet fra videoen og legger det i Labrador med fast navn
// (<video>-poster-<t>s.jpg), så samme bilde gjenbrukes ved neste eksport.
async function makePoster(v, atTime, o) {
  o = o || {};
  if (!isLabradorUrl(v.src)) {
    if (!o.quiet) await alertBox('Stillbilder lages bare for videoer som ligger i Labrador.');
    return false;
  }
  const t = Math.max(0, Math.round((atTime || 0) * 10) / 10);
  busy.set(v.key, 'Lager stillbilde…');
  renderItems();
  try {
    let res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    if (res && res.loggedIn === false && !o.quiet) {
      const c = await window.faktisk.labradorConnect();
      if (c && c.loggedIn) res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    }
    if (res && res.ok && res.url) {
      v.poster = res.url; v.posterAt = t;
      // Bare for standardtidspunktet (1 s) — et tidspunkt valgt for hånd røres ikke
      if (o.quiet && t === 1) await avoidDarkPoster(v);
      return true;
    }
    if (!o.quiet) {
      await alertBox(res && res.loggedIn === false
        ? 'Fikk ikke gyldig innlogging i Labrador.'
        : 'Kunne ikke lage stillbilde: ' + ((res && res.error) || 'ukjent feil'));
    }
    return false;
  } catch (err) {
    if (!o.quiet) await alertBox('Kunne ikke lage stillbilde: ' + err.message);
    return false;
  } finally {
    busy.delete(v.key);
    renderItems();
    scheduleUpdate();
  }
}

// ---------- Unngå svarte stillbilder (som i Videoslider) ----------
const DARK_LIMIT = 22;                 // snittlysstyrke 0–255; under = «svart»
const RETRY_TIMES = [2.5, 4, 6, 9, 13];

function posterBrightness(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        resolve(sum / (d.length / 4));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url + (url.includes('?') ? '&' : '?') + 'lum=1';
  });
}
function durSeconds(v) {
  const m = /^(\d+):(\d{2})$/.exec(String(v.dur || '').trim());
  return m ? +m[1] * 60 + +m[2] : 0;
}
async function avoidDarkPoster(v) {
  let lum = await posterBrightness(v.poster);
  if (lum == null || lum >= DARK_LIMIT) return;
  let best = { url: v.poster, t: v.posterAt, lum };
  const dur = durSeconds(v);
  for (const t of RETRY_TIMES) {
    if (dur && t > dur - 0.5) break;
    busy.set(v.key, 'Stillbildet ble svart – prøver ' + String(t).replace('.', ',') + ' s …');
    renderItems();
    const res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    if (!res || !res.ok || !res.url) break;
    lum = await posterBrightness(res.url);
    if (lum == null) break;
    if (lum > best.lum) best = { url: res.url, t, lum };
    if (lum >= DARK_LIMIT) break;
  }
  v.poster = best.url; v.posterAt = best.t;
}

els.allPosters.addEventListener('click', async () => {
  const todo = state.items.filter(v => v.type === 'video' && isLabradorUrl(v.src) && !isLabradorUrl(v.poster));
  if (!todo.length) { await alertBox('Alle videoene har allerede stillbilde i Labrador.'); return; }
  const list = await ensureLoggedIn();
  if (!list) { await alertBox('Fikk ikke gyldig innlogging i Labrador.'); return; }
  els.allPosters.disabled = true;
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    els.allPosters.textContent = `Lager ${i + 1} av ${todo.length}…`;
    if (await queue(() => makePoster(todo[i], todo[i].posterAt || 1, { quiet: true }))) ok++;
  }
  els.allPosters.disabled = false;
  els.allPosters.textContent = 'Lag stillbilder for videoene';
  if (ok < todo.length) {
    await alertBox(`${ok} av ${todo.length} stillbilder ble laget. Prøv de andre med «Velg stillbilde…» i raden.`);
  }
});

// ============================================================
//  Velg stillbilde (spol til riktig bilde)
// ============================================================

let pickerFor = null;
function openPicker(v) {
  if (!v || !v.src) return;
  pickerFor = v;
  const pv = els.pickerVideo;
  pv.addEventListener('loadedmetadata', () => {
    const d = pv.duration || 0;
    try { pv.currentTime = Math.min(v.posterAt || 1, Math.max(0, d - 0.1)); } catch (e) {}
  }, { once: true });
  pv.src = v.src;
  els.pickerTime.textContent = fmtSec(v.posterAt || 1);
  els.picker.hidden = false;
  els.pickerUse.focus();
}
function closePicker() {
  els.picker.hidden = true;
  const pv = els.pickerVideo;
  try { pv.pause(); } catch (e) {}
  pv.removeAttribute('src');
  try { pv.load(); } catch (e) {}
  pickerFor = null;
}
['timeupdate', 'seeked'].forEach(ev => els.pickerVideo.addEventListener(ev, () => {
  els.pickerTime.textContent = fmtSec(els.pickerVideo.currentTime);
}));
els.pickerCancel.addEventListener('click', closePicker);
els.pickerUse.addEventListener('click', async () => {
  const v = pickerFor;
  const t = els.pickerVideo.currentTime || 0;
  closePicker();
  if (v) await queue(() => makePoster(v, t));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !els.picker.hidden) closePicker();
});

// ============================================================
//  Labrador: filpanel og opplasting
// ============================================================

async function openFilePanel(panel, extRe, noun, onPick, o) {
  o = o || {};
  if (!panel) return;
  const open = panel.style.display !== 'none';
  document.querySelectorAll('.ftb-labpanel').forEach(p => { p.style.display = 'none'; });
  if (open) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res || !res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st && st.loggedIn) { panel.style.display = 'none'; openFilePanel(panel, extRe, noun, onPick, o); }
      else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  // Studios egne stillbilder (…-poster-1_0s.jpg) er ikke interessante her
  const matching = (res.files || []).filter(f => extRe.test(f.url) && !/-poster-\d+_\d+s\.jpg$/i.test(f.name || '')).slice(0, 120);
  if (!matching.length) {
    panel.innerHTML = `<div class="ftb-labpanel__status">Ingen ${noun} lastet opp ennå.</div>`;
    return;
  }
  panel.innerHTML = `<div class="ftb-labpanel__status">${matching.length} ${noun} (nyeste først)${o.keepOpen ? ' – klikk flere for å legge dem til' : ''}</div><div class="ftb-labpanel__list"></div>`;
  const list = panel.querySelector('.ftb-labpanel__list');
  const used = new Set(state.items.map(v => v.src));
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ftb-labfile';
    item.textContent = (o.keepOpen && used.has(f.url) ? '✓ ' : '') + (VIDEO_EXT.test(f.url) ? '▶ ' : '') + f.name;
    item.title = f.url;
    item.addEventListener('click', () => {
      if (o.keepOpen) item.textContent = '✓ ' + (VIDEO_EXT.test(f.url) ? '▶ ' : '') + f.name;
      else panel.style.display = 'none';
      onPick(f.url);
    });
    list.appendChild(item);
  });
}

async function uploadFile(btn, kind, onUrl) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => {
        if (msg.percent != null) btn.textContent = msg.percent + ' %…';
        if (kind === 'media') setAddStatus(msg.label || ('Laster opp… ' + msg.percent + ' % (' + msg.sentMB + ' av ' + msg.totalMB + ' MB)'));
      })
    : () => {};
  try {
    const res = await window.faktisk.labradorUpload({ filters: FILTERS[kind] });
    if (!res || res.canceled) { if (kind === 'media') setAddStatus(''); return; }
    if (!res.ok) { if (kind === 'media') setAddStatus(''); await alertBox('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) {
      if (kind === 'media') setAddStatus('Lastet opp «' + (res.name || fileName(res.url)) + '» ✓');
      onUrl(res.url);
    } else {
      await alertBox(res.note || 'Lastet opp, men fant ikke URL — se «Fra Labrador».');
    }
  } catch (err) {
    await alertBox('Opplasting feilet: ' + err.message);
  } finally {
    unsub();
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ============================================================
//  Embed + forhåndsvisning (samme markup)
// ============================================================

function activeItems() { return state.items.filter(v => isValidUrl(v.src)); }

function embedData() {
  return {
    title: els.title.value.trim(),
    mode: els.mode.value,
    linkLabel: els.linkLabel.value.trim() || 'Se originalen',
    items: activeItems().map(v => {
      const o = { t: v.type === 'video' ? 'v' : 'i', src: cleanUrl(v.src) };
      if (v.w && v.h) { o.w = v.w; o.h = v.h; }
      if (v.type === 'video' && isValidUrl(v.poster)) o.poster = cleanUrl(v.poster);
      if (v.type === 'video' && v.dur) o.dur = v.dur;
      if (v.caption.trim()) o.cap = v.caption.trim();
      if (v.credit.trim()) o.credit = v.credit.trim();
      if (v.date) { o.date = v.date; o.dateText = fmtDate(v.date); }
      if (isValidUrl(v.link)) { o.link = v.link.trim(); if (v.linkLabel && v.linkLabel.trim()) o.l1 = v.linkLabel.trim(); }
      if (isValidUrl(v.link2)) { o.link2 = v.link2.trim(); o.l2 = link2Text(v); }
      if (v.alt.trim()) o.alt = v.alt.trim();
      return o;
    }),
  };
}

const EAGER_CARDS = 3;   // kort som får bildet med en gang (resten lastes ved behov)

function buildEmbedSnippet() {
  const id = 'fms-' + Math.random().toString(36).slice(2, 8);
  const S = '.' + id;
  const data = embedData();
  const II = data.items;
  const mode = data.mode;
  const shape = els.shape.value in SHAPES ? els.shape.value : 'original';
  const fixed = SHAPES[shape];
  const size = els.size.value in SIZES ? els.size.value : 'medium';
  const kicker = els.kicker.value.trim();
  const title = data.title;
  const lede = els.lede.value.trim();
  const hasHead = !!(kicker || title || lede);

  const css = `
${S}{position:relative;container-type:inline-size;--fms-ink:#212121;--fms-dim:#5a5a5a;--fms-line:#dcdcdc;--fms-blue:#0050FC}
${S} .fms{--fms-h:${SIZES[size].h}}
${S} .fms,${S} .fms *,${S} .fms-dlg,${S} .fms-dlg *{box-sizing:border-box}
${S} .fms{background:#fff;border:1px solid var(--fms-line);border-radius:10px;padding:${hasHead ? '16px' : '14px'} 0 16px;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif);color:var(--fms-ink);text-align:left}
${S} .fms-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 16px;padding:0 18px 14px}
${S} .fms-head--bare{padding-bottom:8px;justify-content:flex-end}
${S} .fms-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fms-blue);margin:0;padding:0;line-height:1.3}
${S} .fms-title{font-family:inherit;font-size:22px;font-weight:700;line-height:1.15;margin:4px 0 0;padding:0;color:var(--fms-ink);letter-spacing:normal;text-transform:none}
${S} .fms-lede{font-size:15px;line-height:1.4;color:#444;margin:6px 0 0;padding:0}
${S} .fms-nav{display:inline-flex;gap:6px;flex:none}
@media (pointer:coarse){${S} .fms-arrow{width:40px;height:40px}}
${S} .fms-arrow{all:unset;box-sizing:border-box;width:36px;height:36px;border-radius:50%;border:1px solid var(--fms-line);background:#fff;color:var(--fms-ink);display:grid;place-items:center;cursor:pointer}
${S} .fms-arrow:hover:not(:disabled){border-color:var(--fms-ink)}
${S} .fms-arrow:disabled{opacity:.35;cursor:default}
${S} .fms-arrow svg{width:20px;height:20px;display:block}
${S} .fms-arrow:focus-visible,${S} .fms-open:focus-visible,${S} .fms-link:focus-visible{outline:3px solid var(--fms-blue);outline-offset:3px}
${S} .fms-track{list-style:none;margin:0;padding:2px 18px 4px;display:flex;align-items:flex-start;gap:14px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scroll-padding-inline:18px;scrollbar-width:none}
${S} .fms-track::-webkit-scrollbar{display:none}
${S} .fms-item{margin:0;padding:0;list-style:none;scroll-snap-align:start;flex:0 0 auto}
${S} .fms-item::before{content:none}
${S} .fms-card{margin:0;padding:0;width:${fixed ? 'calc(var(--fms-h) * ' + fixed.toFixed(4) + ')' : 'calc(var(--fms-h) * var(--ar,1))'};max-width:${SIZES[size].max}}
${S} .fms-open{display:block;color:inherit;text-decoration:none;border-radius:8px;cursor:zoom-in}
${S} .fms-media{position:relative;display:block;width:100%;${fixed ? 'aspect-ratio:' + fixed.toFixed(4) : 'aspect-ratio:var(--ar,1)'};border-radius:8px;overflow:hidden;background:#f2f2f2;border:1px solid rgba(0,0,0,.06)}
${S} .fms-media img,${S} .fms-media video{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;margin:0;transition:transform .3s ease}
${S} .fms-media video{background:#000}
${S} .fms-open:hover .fms-media img{transform:scale(1.03)}
${S} .fms-badge{position:absolute;left:10px;bottom:10px;z-index:1;width:34px;height:34px;border-radius:50%;background:var(--fms-blue);color:#fff;display:grid;place-items:center;transition:transform .15s}
${S} .fms-badge svg{width:16px;height:16px;display:block}
${S} .fms-badge--play svg{margin-left:2px}
${S} .fms-badge--zoom{background:rgba(0,0,0,.55);opacity:0;transition:opacity .15s}
${S} .fms-open:hover .fms-badge--zoom,${S} .fms-open:focus-visible .fms-badge--zoom{opacity:1}
${S} .fms-open:hover .fms-badge--play{transform:scale(1.08)}
${S} .fms-dur{position:absolute;right:9px;bottom:15px;z-index:1;color:#fff;font-size:12px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.7)}
${S} .fms-cap{margin:8px 0 0;padding:0;font-size:14px;line-height:1.35;color:var(--fms-ink)}
${S} .fms-ct{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:0}
${S} .fms-meta{margin:3px 0 0;font-size:12px;line-height:1.35;color:var(--fms-dim)}
${S} .fms-link{color:var(--fms-blue);font-weight:700;text-decoration:none;white-space:nowrap}
${S} .fms-link:hover{text-decoration:underline}
${S} .fms-links{margin-top:2px}
${S} .fms-links .fms-link{white-space:normal}
@container (min-width:720px){${S} .fms-title{font-size:26px}}
${S} .fms-big{position:relative;display:flex;justify-content:center;align-items:center;min-height:0}
${S} .fms-big img,${S} .fms-big video{display:block;max-width:100%;width:auto;height:auto;object-fit:contain;margin:0;border-radius:6px;background:#111}
${S} .fms-feed.is-zoomed{overflow:hidden;scroll-snap-type:none}
${S} .fms-zwrap{position:relative;display:flex;justify-content:center;max-width:100%}
${S} .fms-zbtn{all:unset;box-sizing:border-box;position:absolute;right:10px;bottom:10px;z-index:2;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:none;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
${S} .fms-zbtn svg{width:22px;height:22px;display:block}
${S} .fms-zbtn:focus-visible{outline:3px solid #fff;outline-offset:2px}
${S} .fms-zwrap.can-zoom .fms-zbtn,${S} .fms-zwrap.is-zoom .fms-zbtn{display:grid}
${S} .fms-zwrap.can-zoom img{cursor:zoom-in}
${S} .fms-zwrap.is-zoom .fms-big{display:block;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;border-radius:6px;background:#111;max-width:100%}
${S} .fms-zwrap.is-zoom .fms-big img{max-width:none!important;max-height:none!important;border-radius:0;cursor:zoom-out}
${S} .fms-bigcap{margin:0;padding:12px 2px 0;max-width:760px;width:100%}
${S} .fms-bigtext{margin:0;font-size:16px;line-height:1.45}
${S} .fms-bigmeta{margin:4px 0 0;font-size:13px;line-height:1.4;opacity:.8}
${S} .fms-bigmeta a{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px}
${S} .fms-btn{all:unset;box-sizing:border-box;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center;cursor:pointer;pointer-events:auto}
${S} .fms-btn:hover:not(:disabled){background:rgba(255,255,255,.3)}
${S} .fms-btn:disabled{opacity:.3;cursor:default}
${S} .fms-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}
${S} .fms-btn svg{width:24px;height:24px;display:block}
${S} .fms-dlg{position:fixed;inset:0;width:100%;height:100%;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;color:#fff;overflow:hidden;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif)}
${S} .fms-dlg:not([open]){display:none}
${S} .fms-dlg::backdrop{background:rgba(12,12,12,.86)}
${S} .fms-feed{height:100%;display:flex;overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scroll-snap-type:x mandatory;scrollbar-width:none;outline:0}
${S} .fms-feed::-webkit-scrollbar{display:none}
${S} .fms-slide{flex:0 0 100%;height:100%;display:flex;align-items:center;justify-content:center;padding:64px 76px 28px;scroll-snap-align:center;scroll-snap-stop:always}
${S} .fms-fig{margin:0;display:flex;flex-direction:column;align-items:center;max-width:100%;max-height:100%}
${S} .fms-fig .fms-big img,${S} .fms-fig .fms-big video{max-height:calc(100dvh - 210px)}
${S} .fms-ui{position:absolute;inset:0;pointer-events:none;z-index:10}
${S} .fms-count{position:absolute;left:18px;top:calc(18px + env(safe-area-inset-top,0px));margin:0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#fff}
${S} .fms-close{position:absolute;right:14px;top:calc(10px + env(safe-area-inset-top,0px))}
${S} .fms-prev,${S} .fms-next{position:absolute;top:50%;margin-top:-22px}
${S} .fms-prev{left:16px}
${S} .fms-next{right:16px}
${S} .fms-stage{position:absolute;z-index:60;inset:auto;margin:0;padding:10px 10px 12px;border:0;border-radius:14px;background:#fff;color:var(--fms-ink);width:max-content;max-width:calc(100vw - 32px);overflow:visible;outline:0;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif);text-align:left;box-shadow:0 34px 80px -18px rgba(0,0,0,.45),0 10px 24px -6px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.07)}
${S} .fms-stage:popover-open{position:fixed}
${S} .fms-stage[hidden]{display:none}
${S} .fms-stage.is-in{animation:${id}-pop .24s cubic-bezier(.2,.9,.3,1.15)}
@keyframes ${id}-pop{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:none}}
${S} .fms-stagebody{position:relative}
${S} .fms-sfig{display:table;margin:0;min-width:min(260px,calc(100vw - 52px))}
${S} .fms-sfig .fms-big img,${S} .fms-sfig .fms-big video{max-height:min(68vh,720px);max-width:min(860px,calc(100vw - 52px));border-radius:8px;background:#f2f2f2}
${S} .fms-sfig .fms-bigcap{display:table-caption;caption-side:bottom;padding:10px 4px 2px;max-width:none}
${S} .fms-sfig .fms-bigtext{font-size:15px}
${S} .fms-sfig .fms-bigmeta{opacity:1;color:var(--fms-dim)}
${S} .fms-sfig .fms-bigmeta a{color:var(--fms-blue)}
${S} .fms-sbtn{position:absolute;z-index:3;width:38px;height:38px;background:rgba(0,0,0,.55);color:#fff}
${S} .fms-sbtn:hover:not(:disabled){background:rgba(0,0,0,.78)}
${S} .fms-sbtn:disabled{visibility:hidden}
${S} .fms-sbtn svg{width:22px;height:22px}
${S} .fms-sclose{top:18px;right:18px}
${S} .fms-sprev,${S} .fms-snext{top:40%;margin-top:-19px;background:#fff;color:var(--fms-ink);box-shadow:0 4px 14px rgba(0,0,0,.22)}
${S} .fms-sprev:hover:not(:disabled),${S} .fms-snext:hover:not(:disabled){background:#f2f2f2}
${S} .fms-sprev{left:-19px}
${S} .fms-snext{right:-19px}
${S} .fms-scount{position:absolute;left:18px;top:18px;z-index:3;margin:0;padding:3px 9px;border-radius:99px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.5}
@media (max-width:600px){
  ${S} .fms-slide{padding:58px 0 calc(18px + env(safe-area-inset-bottom,0px))}
  ${S} .fms-fig .fms-bigcap{padding-left:16px;padding-right:16px}
  ${S} .fms-big img,${S} .fms-big video{border-radius:0}
  ${S} .fms-prev,${S} .fms-next{display:none}
  ${S} .fms-sprev{left:14px}
  ${S} .fms-snext{right:14px}
}
@media (prefers-reduced-motion:reduce){
  ${S} .fms-media img,${S} .fms-badge{transition:none}
  ${S} .fms-open:hover .fms-media img,${S} .fms-open:hover .fms-badge{transform:none}
  ${S} .fms-stage.is-in{animation:none}
}`;

  const openable = mode !== 'none';
  const cards = II.map((v, i) => {
    const ar = v.w && v.h ? Math.max(0.35, Math.min(2.4, v.w / v.h)) : (v.t === 'v' ? 9 / 16 : 1);
    const alt = v.alt || v.cap || '';
    let media;
    if (v.t === 'v' && !openable) {
      // «Bare slider»: videoen spilles av i kortet
      media = `<span class="fms-media"><video src="${escapeHtml(v.src)}" controls playsinline preload="none" data-i="${i}"${v.poster ? ` ${i < EAGER_CARDS ? 'poster' : 'data-fms-poster'}="${escapeHtml(v.poster)}"` : ''}${alt ? ` aria-label="${escapeHtml(alt)}"` : ''}></video></span>`;
    } else {
      const img = v.t === 'v' ? v.poster : v.src;
      const badge = v.t === 'v'
        ? `<span class="fms-badge fms-badge--play" aria-hidden="true">${PLAY_SVG}</span>${v.dur ? `<b class="fms-dur">${escapeHtml(v.dur)}</b>` : ''}`
        : (openable ? `<span class="fms-badge fms-badge--zoom" aria-hidden="true">${ZOOM_SVG}</span>` : '');
      // 0.1.3: bare de første kortene får src med en gang. Resten får data-fms-src
      // og lastes av runtime når slideren nærmer seg skjermen og kortet nærmer seg
      // synsfeltet i sporet. loading="lazy" alene holdt ikke: nettleseren henter
      // «nære» bilder, og i et vannrett spor er alle nære – hele serien ble lastet.
      const srcAttr = i < EAGER_CARDS ? 'src' : 'data-fms-src';
      media = `<span class="fms-media">${img ? `<img ${srcAttr}="${escapeHtml(img)}" alt="${escapeHtml(v.t === 'v' ? '' : alt)}"${v.w && v.h ? ` width="${v.w}" height="${v.h}"` : ''} loading="lazy" decoding="async">` : ''}${badge}</span>`;
      if (openable) {
        const label = (v.t === 'v' ? 'Spill av' : 'Vis større') + (v.cap ? ': ' + v.cap.slice(0, 90) : ' ' + (i + 1) + ' av ' + II.length);
        media = `<a class="fms-open" href="${escapeHtml(v.src)}" data-i="${i}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}">${media}</a>`;
      }
    }
    const lnk = [v.link ? `<a class="fms-link" href="${escapeHtml(v.link)}" data-i="${i}" data-l="1" target="_blank" rel="noopener">${escapeHtml(v.l1 || data.linkLabel)} ↗</a>` : '',
      v.link2 ? `<a class="fms-link" href="${escapeHtml(v.link2)}" data-i="${i}" data-l="2" target="_blank" rel="noopener">${escapeHtml(v.l2 || '')} ↗</a>` : ''].filter(Boolean);
    // Én lenke: på samme linje som kilde/dato (som før). To lenker: egen linje.
    const metaParts = [v.credit ? escapeHtml(v.credit) : '', v.dateText ? escapeHtml(v.dateText) : ''].concat(lnk.length === 1 ? lnk : []).filter(Boolean);
    const meta = metaParts.join(' · ');
    const linkRow = lnk.length > 1 ? `<p class="fms-meta fms-links">${lnk.join('<span class="fms-sep" aria-hidden="true"> · </span>')}</p>` : '';
    const cap = v.cap || meta || linkRow
      ? `<figcaption class="fms-cap">${v.cap ? `<p class="fms-ct">${escapeHtml(v.cap)}</p>` : ''}${meta ? `<p class="fms-meta">${meta}</p>` : ''}${linkRow}</figcaption>`
      : '';
    return `
    <li class="fms-item"><figure class="fms-card" style="--ar:${ar.toFixed(4)}">${media}${cap}</figure></li>`;
  }).join('');

  data.src = embedSource();   // for «Hent fra eksisterende embed» – runtime bruker det ikke
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const runtime = window.fmsRun ? window.fmsRun.toString() : '';
  const ver = PLUGIN_VERSION ? ' · v' + PLUGIN_VERSION : '';
  const headText = (kicker ? `<p class="fms-kicker">${escapeHtml(kicker)}</p>` : '')
    + (title ? `<h2 class="fms-title" id="${id}-t">${escapeHtml(title)}</h2>` : '')
    + (lede ? `<p class="fms-lede">${escapeHtml(lede)}</p>` : '');
  const nav = `<span class="fms-nav"><button type="button" class="fms-arrow fms-arrow--prev" aria-label="Bla til venstre" disabled>${LEFT_SVG}</button><button type="button" class="fms-arrow fms-arrow--next" aria-label="Bla til høyre">${RIGHT_SVG}</button></span>`;

  return `<!-- FAKTISK · MEDIESLIDER${ver} -->
<div class="fms-wrap ${id}" id="${id}">
<style>${css}
</style>
<section class="fms"${title ? ` aria-labelledby="${id}-t"` : ' aria-label="Bilder og videoer"'}>
  <div class="fms-head${hasHead ? '' : ' fms-head--bare'}">${hasHead ? `<div class="fms-headtext">${headText}</div>` : ''}${nav}</div>${mode === 'expand' ? `
  <div class="fms-stage" role="dialog" aria-label="Stor visning" tabindex="-1" hidden></div>` : ''}
  <ul class="fms-track" role="list">${cards}
  </ul>
</section>
<script type="application/json" class="fms-data">${json}</script>
<script>(${runtime})(document.currentScript ? document.currentScript.parentNode : document.getElementById("${id}"));</script>
</div>
`;
}

function renderPreview() {
  const n = activeItems().length;
  els.copyEmbed.disabled = n === 0;
  els.previewHost.style.maxWidth = els.previewWidth.value + 'px';
  // Stor visning er åpen i forhåndsvisningen: vent til den lukkes
  if (els.previewHost.querySelector('dialog[open]') || els.previewHost.querySelector('.fms-stage:not([hidden])')) {
    scheduleUpdate(1000); return;
  }
  if (!n) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Legg til bilder og videoer fra Labrador til venstre — forhåndsvisningen dukker opp her.</p>';
    return;
  }
  els.previewHost.innerHTML = buildEmbedSnippet();
  const root = els.previewHost.querySelector('.fms-wrap');
  if (root && window.fmsRun) window.fmsRun(root, { preview: true });
}

let updateTimer = null;
function scheduleUpdate(delay) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, typeof delay === 'number' ? delay : 250);
}

els.copyEmbed.addEventListener('click', async () => {
  const items = activeItems();
  if (!items.length) return;
  const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  const notLab = items.filter(v => !isLabradorUrl(v.src)).length;
  const noPoster = items.filter(v => v.type === 'video' && !isLabradorUrl(v.poster)).length;
  const noText = items.filter(v => !v.caption.trim() && !v.alt.trim()).length;
  const warn = [];
  if (notLab) warn.push(`${n(notLab, 'fil', 'filer')} ligger ikke i Labrador.`);
  if (noPoster) warn.push(`${n(noPoster, 'video', 'videoer')} mangler stillbilde i Labrador – kortet blir tomt. Bruk «Lag stillbilder for videoene».`);
  if (noText) warn.push(`${n(noText, 'element', 'elementer')} mangler både bildetekst og alt-tekst (skjermlesere får ingenting).`);
  if (warn.length && !(await window.faktiskDialog.confirm(warn.join('\n\n') + '\n\nKopiere likevel?'))) return;
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet());
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ============================================================
//  Lagring, prosjekter og «Hent fra eksisterende embed»
// ============================================================

let isRestoring = false;

const ITEM_FIELDS = ['type', 'src', 'poster', 'posterAt', 'w', 'h', 'dur', 'caption', 'credit', 'date', 'link', 'linkLabel', 'link2', 'link2Label', 'alt'];
function pickFields(v, withKey) {
  const o = withKey ? { key: v.key } : {};
  ITEM_FIELDS.forEach(f => { o[f] = v[f]; });
  return o;
}

// Alt som trengs for å gjenskape feltene, lagt i embedens data (src).
function embedSource() {
  return {
    v: 1, kicker: els.kicker.value, title: els.title.value, lede: els.lede.value,
    mode: els.mode.value, shape: els.shape.value, size: els.size.value, linkLabel: els.linkLabel.value, link2Label: els.link2Label.value,
    items: activeItems().map(v => pickFields(v, false)),
  };
}

function parseEmbed(code) {
  const doc = new DOMParser().parseFromString(String(code || ''), 'text/html');
  const dataEl = doc.querySelector('script.fms-data');
  if (!dataEl) throw new Error('Fant ingen medieslider-embed. Lim inn hele koden fra Markup-boksen.');
  let D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { throw new Error('Klarte ikke å lese dataene i embeden.'); }
  if (D.src && typeof D.src === 'object') return D.src;
  return {
    title: D.title || '', mode: D.mode || 'lightbox', linkLabel: D.linkLabel || '',
    items: (D.items || []).map(v => ({
      type: v.t === 'v' ? 'video' : 'image', src: v.src || '', poster: v.poster || '', w: v.w || 0, h: v.h || 0,
      dur: v.dur || '', caption: v.cap || '', credit: v.credit || '', date: v.date || '', link: v.link || '', linkLabel: v.l1 || '', link2: v.link2 || '', link2Label: v.l2 || '', alt: v.alt || '',
    })),
  };
}

function setImportStatus(msg, bad) {
  els.importStatus.textContent = msg || '';
  els.importStatus.classList.toggle('is-bad', !!bad);
}

els.importToggle.addEventListener('click', () => {
  const open = els.importPanel.style.display === 'none';
  els.importPanel.style.display = open ? '' : 'none';
  els.importToggle.setAttribute('aria-expanded', String(open));
  els.importToggle.textContent = 'Hent fra eksisterende embed ' + (open ? '▴' : '▾');
  if (open) els.importInput.focus();
});

els.importBtn.addEventListener('click', async () => {
  let s;
  try { s = parseEmbed(els.importInput.value); } catch (e) { setImportStatus(e.message, true); return; }
  if (activeItems().length && !(await window.faktiskDialog.confirm('Erstatte det som står i feltene nå med innholdet fra embeden?'))) return;
  applyState(Object.assign({}, s, { previewWidth: els.previewWidth.value }));
  saveStateNow();
  els.importInput.value = '';
  const k = (s.items || []).length;
  setImportStatus(`Hentet «${s.title || 'uten navn'}» med ${k} ${k === 1 ? 'element' : 'elementer'}.`);
});

function serializeState() {
  return {
    kicker: els.kicker.value, title: els.title.value, lede: els.lede.value,
    mode: els.mode.value, shape: els.shape.value, size: els.size.value, linkLabel: els.linkLabel.value, link2Label: els.link2Label.value,
    items: state.items.map(v => pickFields(v, true)),
    previewWidth: els.previewWidth.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    if (typeof s.kicker === 'string') els.kicker.value = s.kicker;
    if (typeof s.title === 'string') els.title.value = s.title;
    els.lede.value = s.lede || '';
    if (s.mode) els.mode.value = s.mode;
    if (s.shape) els.shape.value = s.shape;
    if (s.size) els.size.value = s.size;
    if (typeof s.linkLabel === 'string' && s.linkLabel) els.linkLabel.value = s.linkLabel;
    if (typeof s.link2Label === 'string' && s.link2Label) els.link2Label.value = s.link2Label;
    if (s.previewWidth) els.previewWidth.value = s.previewWidth;
    if (Array.isArray(s.items)) state.items = s.items.map(v => newItem(v));
    renderItems();
    renderPreview();
  } finally {
    isRestoring = false;
  }
  // Mål som mangler (f.eks. fra eldre data): hent dem i bakgrunnen
  state.items.forEach(v => { if (!v.w) probe(v); });
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.kicker, els.title, els.lede, els.linkLabel, els.link2Label].forEach(el => el.addEventListener('input', () => scheduleUpdate()));
[els.linkLabel, els.link2Label].forEach(el => el.addEventListener('change', () => renderItems()));
[els.mode, els.shape, els.size, els.previewWidth].forEach(el => el.addEventListener('change', () => scheduleUpdate()));

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.fileId;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch (e) { console.error(e); }
}

els.saveProject.addEventListener('click', async () => {
  const defaultName = (els.title.value || '').slice(0, 40).trim() || `Medieslider ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
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
  renderItems();
  renderPreview();
})();
