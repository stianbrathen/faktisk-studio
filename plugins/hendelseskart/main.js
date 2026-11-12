// Faktisk Studio · Hendelseskart
//
// To kilder:
//   «Kart»       — live OpenStreetMap i redigeringen (Leaflet, buntet lokalt):
//                  søk sted, panorér/zoom til utsnittet, velg format
//                  (16:9 / 9:16 / 1:1), plasser punkter med ekte koordinater.
//                  Ved eksport stables kartflisene til et bilde som lastes
//                  automatisk opp til Labrador — embedden er statisk og
//                  CSP-trygg, med OSM-attribusjon bakt inn i bildet.
//   «Eget bilde» — hvilket som helst bilde fra Labrador (skjermbilde e.l.),
//                  punkter i prosentkoordinater.
//
// Embedden er identisk for begge: URL-lenket bakgrunn (aldri base64),
// nummererte klikkbare punkter og popup i Faktisk-stil.

const PLUGIN_ID = 'hendelseskart';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) {
      el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
    }
  } catch (e) {}
})();

const els = {
  modeMapBtn:    document.getElementById('modeMapBtn'),
  modeImgBtn:    document.getElementById('modeImgBtn'),
  mapControls:   document.getElementById('mapControls'),
  imgControls:   document.getElementById('imgControls'),
  mapBox:        document.getElementById('mapBox'),
  geoSearch:     document.getElementById('geoSearch'),
  geoBtn:        document.getElementById('geoBtn'),
  geoResults:    document.getElementById('geoResults'),
  formatSelect:  document.getElementById('formatSelect'),

  urlImage:      document.getElementById('urlImage'),
  loadBtn:       document.getElementById('loadBtn'),
  imgMain:       document.getElementById('imgMain'),
  preview:       document.getElementById('preview'),
  clipper:       document.getElementById('clipper'),
  empty:         document.getElementById('emptyState'),

  copyEmbed:     document.getElementById('copyEmbedBtn'),
  status:        document.getElementById('status'),
  back:          document.getElementById('backBtn'),
  full:          document.getElementById('fullscreenBtn'),
  captionText:   document.getElementById('captionText'),
  photographer:  document.getElementById('photographerText'),
  openLabrador:  document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
  pointSection:  document.getElementById('pointSection'),
  pointList:     document.getElementById('pointList'),
  addPointBtn:   document.getElementById('addPointBtn'),
};

const FORMATS = {
  '169': { w: 1920, h: 1080 },
  '916': { w: 1080, h: 1920 },
  '11':  { w: 1440, h: 1440 },
};

// Kartstiler = CSS-filter på flisene. Samme filterstreng brukes i editoren
// (CSS på tile-panelet) og i eksporten (ctx.filter på canvas) — Electron og
// lesernes nettlesere er samme motor, så resultatet blir identisk.
// Gråtone/duotone gjør de blå punktene og popupene tydeligere mot kartet.
const MAP_STYLES = {
  standard: '',
  gratone:  'grayscale(1) brightness(1.05) contrast(0.92)',
  faktisk:  'grayscale(1) brightness(1.1) sepia(1) hue-rotate(182deg) saturate(2.2) brightness(0.97)',
};

const OSM_ATTRIB = '© OpenStreetMap-bidragsytere';

const state = {
  mode: 'map',            // 'map' | 'image'
  format: '169',
  mapStyle: 'standard',
  // Kart-modus
  mapView: { lat: 64.6, lng: 12.5, zoom: 5 },
  // Eget bilde-modus
  url: '',
  loaded: false,
  aspectRatio: 16 / 9,
  // Punkter. Kart-modus: {lat, lng}. Bilde-modus: {x, y} i prosent.
  points: [],
  openPointId: null,
};

let map = null;
let markerLayer = null;

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kunne ikke laste: ' + url));
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

// ============================================================
//  Modus
// ============================================================

function setMode(mode) {
  state.mode = mode;
  const isMap = mode === 'map';
  els.modeMapBtn.classList.toggle('hk-mode__btn--active', isMap);
  els.modeImgBtn.classList.toggle('hk-mode__btn--active', !isMap);
  els.mapControls.style.display = isMap ? 'block' : 'none';
  els.imgControls.style.display = isMap ? 'none' : 'block';
  els.mapBox.style.display = isMap ? 'block' : 'none';
  els.preview.style.display = (!isMap && state.loaded) ? 'block' : 'none';
  els.empty.style.display = (!isMap && !state.loaded) ? 'flex' : 'none';
  if (isMap) {
    initMap();
    fitMapBox();
    setTimeout(() => map && map.invalidateSize(), 50);
  } else {
    fitPreview();
  }
  renderPoints();
  updateExportButtons();
  scheduleSaveState();
}

els.modeMapBtn.addEventListener('click', () => setMode('map'));
els.modeImgBtn.addEventListener('click', () => setMode('image'));

// ============================================================
//  Kart (Leaflet + OSM)
// ============================================================

function initMap() {
  if (map || typeof L === 'undefined') return;
  map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    zoomSnap: 0.5,
  }).setView([state.mapView.lat, state.mapView.lng], state.mapView.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: OSM_ATTRIB,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  applyMapStyle();
  map.on('moveend zoomend', () => {
    const c = map.getCenter();
    state.mapView = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    scheduleSaveState();
  });
  syncMapMarkers();
}

// Skaler kartboksen til valgt format, «contain» i tilgjengelig plass
function fitMapBox() {
  const stage = document.getElementById('stage');
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const f = FORMATS[state.format];
  const ar = f.w / f.h;
  let w = box.width, h = w / ar;
  if (h > box.height) { h = box.height; w = h * ar; }
  els.mapBox.style.width = Math.round(w) + 'px';
  els.mapBox.style.height = Math.round(h) + 'px';
  if (map) map.invalidateSize();
}

els.formatSelect.addEventListener('change', () => {
  state.format = els.formatSelect.value;
  fitMapBox();
  scheduleSaveState();
});

function applyMapStyle() {
  const pane = document.querySelector('#map .leaflet-tile-pane');
  if (pane) pane.style.filter = MAP_STYLES[state.mapStyle] || '';
}

const styleSelect = document.getElementById('styleSelect');
styleSelect.addEventListener('change', () => {
  state.mapStyle = styleSelect.value;
  applyMapStyle();
  scheduleSaveState();
});

// --- Stedssøk (Nominatim) ---
async function geoSearch() {
  const q = els.geoSearch.value.trim();
  if (!q) return;
  els.geoResults.style.display = 'block';
  els.geoResults.innerHTML = '<div class="hk-georesults__item">Søker…</div>';
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=no&q=' + encodeURIComponent(q));
    const hits = await res.json();
    if (!hits.length) {
      els.geoResults.innerHTML = '<div class="hk-georesults__item">Ingen treff.</div>';
      return;
    }
    els.geoResults.innerHTML = '';
    hits.forEach(h => {
      const item = document.createElement('button');
      item.className = 'hk-georesults__item hk-georesults__item--hit';
      item.type = 'button';
      item.textContent = h.display_name;
      item.addEventListener('click', () => {
        els.geoResults.style.display = 'none';
        if (!map) return;
        // Nominatim gir boundingbox [sør, nord, vest, øst] — fly dit
        if (Array.isArray(h.boundingbox) && h.boundingbox.length === 4) {
          const bb = h.boundingbox.map(Number);
          map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 16 });
        } else {
          map.setView([Number(h.lat), Number(h.lon)], 13);
        }
      });
      els.geoResults.appendChild(item);
    });
  } catch (e) {
    els.geoResults.innerHTML = '<div class="hk-georesults__item">Søket feilet: ' + escapeHtml(e.message) + '</div>';
  }
}
els.geoBtn.addEventListener('click', geoSearch);
els.geoSearch.addEventListener('keydown', e => { if (e.key === 'Enter') geoSearch(); });

// --- Markører på kartet ---
function markerIcon(idx) {
  return L.divIcon({
    className: 'hk-micon',
    html: '<div class="hk-marker hk-marker--map">' + (idx + 1) + '</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function popupContent(p, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'hk-pop hk-pop--leaflet';
  wrap.innerHTML = popupHtml(p, idx, 'hk-pop');
  const x = wrap.querySelector('.hk-pop__close');
  if (x) x.addEventListener('click', () => map && map.closePopup());
  return wrap;
}

function syncMapMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  state.points.forEach((p, idx) => {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
    const m = L.marker([p.lat, p.lng], {
      icon: markerIcon(idx),
      draggable: true,
      keyboard: false,
    });
    m.bindPopup(() => popupContent(p, idx), {
      className: 'hk-lpop',
      maxWidth: 360,
      offset: [0, -10],
      closeButton: false,
    });
    m.on('dragend', () => {
      const ll = m.getLatLng();
      p.lat = ll.lat;
      p.lng = ll.lng;
      scheduleSaveState();
    });
    m.addTo(markerLayer);
    p._marker = m;
  });
}

// ============================================================
//  Eget bilde
// ============================================================

async function loadMainImage() {
  const url = els.urlImage.value.trim();
  if (!url) { setStatus('Lim inn URL til kartbildet.', true); return; }
  if (!isValidUrl(url)) { setStatus('Ugyldig URL.', true); return; }

  setStatus('Laster bilde…');
  try {
    const img = await loadImage(url);
    state.url = url;
    state.aspectRatio = img.naturalWidth / img.naturalHeight;
    state.loaded = true;
    els.imgMain.src = url;
    els.empty.style.display = 'none';
    els.preview.style.display = 'block';
    fitPreview();
    renderPoints();
    updateExportButtons();
    setStatus(`Lastet · ${img.naturalWidth}×${img.naturalHeight}`);
    scheduleSaveState();
  } catch (e) {
    setStatus(e.message, true);
    state.loaded = false;
    updateExportButtons();
  }
}

// Skaler forhåndsvisningen så HELE bildet alltid er synlig («contain»):
// stående bilder må begrenses av høyden, liggende av bredden.
function fitPreview() {
  if (!state.loaded) return;
  const stage = document.getElementById('stage');
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const ar = state.aspectRatio;
  let w = box.width, h = w / ar;
  if (h > box.height) { h = box.height; w = h * ar; }
  els.preview.style.width = Math.round(w) + 'px';
  els.preview.style.height = Math.round(h) + 'px';
}

window.addEventListener('resize', () => {
  if (state.mode === 'map') fitMapBox();
  else fitPreview();
});

// ============================================================
//  Punkter
// ============================================================

function addPoint() {
  const id = 'pt_' + Math.random().toString(36).slice(2, 7);
  const p = { id, title: 'Hendelse ' + (state.points.length + 1), text: '', imgUrl: '' };
  if (state.mode === 'map') {
    if (!map) { setStatus('Kartet er ikke klart ennå.', true); return; }
    const c = map.getCenter();
    p.lat = c.lat;
    p.lng = c.lng;
  } else {
    if (!state.loaded) { setStatus('Hent et bilde først.', true); return; }
    p.x = 50;
    p.y = 35 + (state.points.length % 4) * 12;
  }
  state.points.push(p);
  state.openPointId = id;
  renderPoints();
  scheduleSaveState();
}

function deletePoint(id) {
  state.points = state.points.filter(p => p.id !== id);
  if (state.openPointId === id) state.openPointId = null;
  renderPoints();
  scheduleSaveState();
}

// Popup-plassering i bilde-modus og embed (prosentkoordinater)
function popPlacement(p) {
  const vert = p.y < 55
    ? `top: calc(${p.y.toFixed(2)}% + clamp(26px, 4cqw, 42px));`
    : `bottom: calc(${(100 - p.y).toFixed(2)}% + clamp(26px, 4cqw, 42px));`;
  let horiz;
  if (p.x < 22)      horiz = `left: 2%;`;
  else if (p.x > 78) horiz = `right: 2%;`;
  else               horiz = `left: ${p.x.toFixed(2)}%; transform: translateX(-50%);`;
  return vert + ' ' + horiz;
}

function popupHtml(p, idx, cls) {
  const img = (p.imgUrl && isValidUrl(p.imgUrl))
    ? `<img class="${cls}__img" src="${escapeHtml(p.imgUrl)}" alt="" loading="lazy">`
    : '';
  const text = String(p.text || '').trim();
  const textHtml = text
    ? `<p class="${cls}__text">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
    : '';
  return `${img}
    <div class="${cls}__body">
      <div class="${cls}__head">
        <span class="${cls}__num">${idx + 1}</span>
        <span class="${cls}__title">${escapeHtml(p.title || '')}</span>
        <button class="${cls}__close" type="button" aria-label="Lukk">×</button>
      </div>
      ${textHtml}
    </div>`;
}

function renderPoints() {
  renderPointRows();
  if (state.mode === 'map') syncMapMarkers();
  else renderStage();
  updateExportButtons();
}

function renderPointRows() {
  els.pointList.innerHTML = '';
  state.points.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'hk-row' + (state.openPointId === p.id ? ' hk-row--active' : '');
    row.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${idx + 1}</span>
        <input class="hk-row__title" value="${escapeHtml(p.title)}"
               data-id="${p.id}" data-act="title" placeholder="Tittel">
        <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${p.id}" title="Slett punktet">×</button>
      </div>
      <textarea class="hk-row__text" rows="2" data-id="${p.id}" data-act="text"
                placeholder="Tekst i popupen…">${escapeHtml(p.text)}</textarea>
      <input class="hk-row__img" value="${escapeHtml(p.imgUrl)}"
             data-id="${p.id}" data-act="img"
             placeholder="Bilde-URL fra Labrador (valgfri)" spellcheck="false">`;
    els.pointList.appendChild(row);
  });

  els.pointList.onclick = e => {
    if (e.target.dataset.act === 'del') deletePoint(e.target.dataset.id);
  };
  els.pointList.oninput = e => {
    const act = e.target.dataset.act;
    const p = state.points.find(pt => pt.id === e.target.dataset.id);
    if (!p || !act) return;
    if (act === 'title') p.title = e.target.value;
    if (act === 'text')  p.text = e.target.value;
    if (act === 'img')   p.imgUrl = e.target.value.trim();
    if (state.mode === 'map') {
      // Oppdater åpen Leaflet-popup uten re-render
      if (p._marker && p._marker.isPopupOpen()) {
        p._marker.setPopupContent(popupContent(p, state.points.indexOf(p)));
      }
    } else {
      renderStage();
    }
    scheduleSaveState();
  };
  els.pointList.onfocusin = e => {
    const id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    if (state.openPointId !== id) {
      state.openPointId = id;
      // Ikke full re-render (mister fokus) — bare markér raden og vis punktet
      els.pointList.querySelectorAll('.hk-row').forEach(r => r.classList.remove('hk-row--active'));
      const row = e.target.closest('.hk-row');
      if (row) row.classList.add('hk-row--active');
      const p = state.points.find(pt => pt.id === id);
      if (state.mode === 'map' && p && p._marker) p._marker.openPopup();
      if (state.mode === 'image') renderStage();
    }
  };
}

// --- Bilde-modus: markører + popup i forhåndsvisningen ---
function renderStage() {
  els.clipper.querySelectorAll('.hk-marker, .hk-pop').forEach(n => n.remove());
  if (!state.loaded) return;

  state.points.forEach((p, idx) => {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
    const btn = document.createElement('button');
    btn.className = 'hk-marker';
    btn.type = 'button';
    btn.textContent = idx + 1;
    btn.style.left = p.x.toFixed(2) + '%';
    btn.style.top = p.y.toFixed(2) + '%';
    btn.title = p.title || ('Punkt ' + (idx + 1));
    bindMarker(btn, p);
    els.clipper.appendChild(btn);

    if (state.openPointId === p.id) {
      const pop = document.createElement('div');
      pop.className = 'hk-pop';
      pop.style.cssText = popPlacement(p);
      pop.innerHTML = popupHtml(p, idx, 'hk-pop');
      pop.querySelector('.hk-pop__close').addEventListener('click', ev => {
        ev.stopPropagation();
        state.openPointId = null;
        renderPoints();
      });
      els.clipper.appendChild(pop);
    }
  });
}

function bindMarker(btn, p) {
  btn.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect = els.clipper.getBoundingClientRect();
    const x0 = p.x, y0 = p.y;
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    const move = ev => {
      const dxPct = (ev.clientX - startX) / rect.width * 100;
      const dyPct = (ev.clientY - startY) / rect.height * 100;
      if (Math.abs(dxPct) + Math.abs(dyPct) > 0.5) moved = true;
      p.x = Math.max(2, Math.min(98, x0 + dxPct));
      p.y = Math.max(2, Math.min(98, y0 + dyPct));
      btn.style.left = p.x.toFixed(2) + '%';
      btn.style.top = p.y.toFixed(2) + '%';
      const pop = els.clipper.querySelector('.hk-pop');
      if (pop && state.openPointId === p.id) pop.style.cssText = popPlacement(p);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved) {
        scheduleSaveState();
      } else {
        state.openPointId = state.openPointId === p.id ? null : p.id;
        renderPoints();
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

els.addPointBtn.addEventListener('click', addPoint);

// ============================================================
//  Kart-snapshot: fliser → canvas → Labrador
// ============================================================

// Web-mercator: geografisk koordinat → global pikselposisjon på zoomnivå z
function lng2px(lng, z) {
  return (lng + 180) / 360 * 256 * Math.pow(2, z);
}
function lat2px(lat, z) {
  const s = Math.sin(lat * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
}

async function buildMapSnapshot() {
  const dims = FORMATS[state.format];
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast();
  const north = b.getNorth(), south = b.getSouth();

  // Flis-zoom: nok oppløsning til målformatet, men aldri flere enn ~90 fliser
  const containerW = map.getSize().x;
  let zt = Math.round(map.getZoom() + Math.log2(dims.w / containerW));
  zt = Math.max(1, Math.min(19, zt));
  const tilesNeeded = z => {
    const tx = Math.floor(lng2px(east, z) / 256) - Math.floor(lng2px(west, z) / 256) + 1;
    const ty = Math.floor(lat2px(south, z) / 256) - Math.floor(lat2px(north, z) / 256) + 1;
    return tx * ty;
  };
  while (zt > 1 && tilesNeeded(zt) > 90) zt--;

  const x0 = lng2px(west, zt), x1 = lng2px(east, zt);
  const y0 = lat2px(north, zt), y1 = lat2px(south, zt);
  const sx = dims.w / (x1 - x0), sy = dims.h / (y1 - y0);

  const cnv = document.createElement('canvas');
  cnv.width = dims.w;
  cnv.height = dims.h;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, dims.w, dims.h);
  // Kartstil: nøyaktig samme filterstreng som editorens tile-panel
  ctx.filter = MAP_STYLES[state.mapStyle] || 'none';

  const n = Math.pow(2, zt);
  const jobs = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x1 - 0.01) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y1 - 0.01) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;   // dateline-wrap
      jobs.push(
        loadImage(`https://tile.openstreetmap.org/${zt}/${wx}/${ty}.png`)
          .then(img => {
            ctx.drawImage(img,
              (tx * 256 - x0) * sx, (ty * 256 - y0) * sy,
              256 * sx + 0.5, 256 * sy + 0.5);
          })
          .catch(() => {}) // enkeltfliser kan mangle — hullet blir grått
      );
    }
  }
  await Promise.all(jobs);

  // Attribusjon (påkrevd av OSM-lisensen) — bakes inn nederst til høyre,
  // uten kartstil-filteret
  ctx.filter = 'none';
  const fs = Math.max(14, Math.round(dims.w / 90));
  ctx.font = fs + 'px "Helvetica Neue", Arial, sans-serif';
  const label = ' ' + OSM_ATTRIB + ' ';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(dims.w - tw - 8, dims.h - fs - 12, tw + 8, fs + 12);
  ctx.fillStyle = '#333';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, dims.w - tw - 4, dims.h - (fs + 12) / 2);

  // Punktposisjoner i prosent av utsnittet
  const pts = state.points
    .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number')
    .map(p => ({
      ...p,
      x: Math.max(0, Math.min(100, (lng2px(p.lng, zt) - x0) / (x1 - x0) * 100)),
      y: Math.max(0, Math.min(100, (lat2px(p.lat, zt) - y0) / (y1 - y0) * 100)),
    }));

  return { canvas: cnv, points: pts, aspect: dims.w / dims.h };
}

// ============================================================
//  Embed-output
// ============================================================

function buildEmbedSnippet(override) {
  const url = escapeHtml(override ? override.url : state.url);
  const points = override ? override.points : state.points;
  const aspectNum = override ? override.aspect : state.aspectRatio;
  const id = 'hkart-' + Math.random().toString(36).slice(2, 8);
  const aspect = aspectNum.toFixed(4);
  const caption = (els.captionText.value || '').trim();
  const photographer = (els.photographer.value || '').trim();
  const hasCaption = caption || photographer;

  const captionParts = [];
  if (caption) captionParts.push(`
    <!-- ▶ BILDETEKST -->
    <figcaption itemprop="caption">${escapeHtml(caption)}</figcaption>`);
  if (photographer) captionParts.push(`
    <!-- ▶ KILDE ("Foto: " kommer automatisk) -->
    <figcaption itemprop="author" data-byline-prefix="Foto:">${escapeHtml(photographer)}</figcaption>`);

  const innerCaption = hasCaption ? `

  <div class="caption hk-caption" style="margin-top:1.2rem;box-sizing:border-box;">${captionParts.join('')}
  </div>` : '';

  const open = hasCaption ? `<figure style="margin:0;">` : '';
  const close = hasCaption ? `</figure>` : '';

  const baseCss = (typeof window !== 'undefined' && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss('hk-container')
    : '';

  const markers = points.map((p, idx) => `
        <!-- ▶ PUNKT ${idx + 1}: ${escapeHtml(p.title || '')} -->
        <button class="hk-m" type="button" data-pop="${id}-pop-${idx}"
                style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;"
                aria-expanded="false" aria-controls="${id}-pop-${idx}">${idx + 1}</button>`).join('');

  const pops = points.map((p, idx) => `
        <div class="hk-pop" id="${id}-pop-${idx}" style="${popPlacement(p)}" role="dialog" aria-label="${escapeHtml(p.title || 'Punkt ' + (idx + 1))}" hidden>${popupHtml(p, idx, 'hk-pop')}
        </div>`).join('');

  return `<!-- ============================================
     FAKTISK · HENDELSESKART
     Klikkbare punkter med popup. Endre tekst i feltene merket med ▶
     ============================================ -->
${open}
  <style>${baseCss}
    .hk-container { container-type: inline-size; padding: 0.7rem 0; }
    @container (min-width: 1080px) {
      .hk-container > .caption.hk-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
      }
    }
    @media (max-width: 768px) {
      .hk-container > .caption.hk-caption {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
    }
    .hk-stage-${id} {
      position: relative;
      width: 100%;
      aspect-ratio: ${aspect};
      overflow: hidden;
      border-radius: 8px;
      background: #1a1a1a;
      container-type: inline-size;
    }
    .hk-stage-${id} > img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .hk-stage-${id} .hk-m {
      position: absolute;
      transform: translate(-50%, -50%);
      width: clamp(24px, 3.4cqw, 38px);
      height: clamp(24px, 3.4cqw, 38px);
      border-radius: 50%;
      border: 0;
      background: #0050fc;
      color: #fff;
      font-family: "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-weight: bold;
      font-size: clamp(13px, 1.8cqw, 19px);
      line-height: 1;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      cursor: pointer;
      z-index: 3;
      padding: 0;
    }
    .hk-stage-${id} .hk-m::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: #0050fc;
      opacity: 0.5;
      z-index: -1;
      animation: hk-pulse-${id} 2s ease-out infinite;
    }
    .hk-stage-${id} .hk-m[aria-expanded="true"]::after { animation: none; opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
      .hk-stage-${id} .hk-m::after { animation: none !important; }
    }
    @keyframes hk-pulse-${id} {
      0%   { transform: scale(1);   opacity: 0.5; }
      80%  { transform: scale(2.2); opacity: 0;   }
      100% { transform: scale(2.2); opacity: 0;   }
    }
    .hk-stage-${id} .hk-pop {
      position: absolute;
      z-index: 5;
      width: min(340px, 86cqw);
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.35);
      overflow: hidden;
      font-family: "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    .hk-stage-${id} .hk-pop__img {
      display: block;
      width: 100%;
      max-height: clamp(140px, 30cqw, 240px);
      object-fit: cover;
    }
    .hk-stage-${id} .hk-pop__body { padding: 10px 12px 12px; }
    .hk-stage-${id} .hk-pop__head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hk-stage-${id} .hk-pop__num {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #0050fc;
      color: #fff;
      font-weight: bold;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .hk-stage-${id} .hk-pop__title {
      flex: 1;
      font-weight: bold;
      font-size: clamp(14px, 1.9cqw, 17px);
      color: #212121;
      line-height: 1.25;
    }
    .hk-stage-${id} .hk-pop__close {
      flex-shrink: 0;
      border: 0;
      background: transparent;
      color: #888;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }
    .hk-stage-${id} .hk-pop__close:hover { color: #212121; }
    .hk-stage-${id} .hk-pop__text {
      margin: 8px 0 0;
      font-size: clamp(13px, 1.7cqw, 15px);
      line-height: 1.45;
      color: #333;
    }
  </style>
  <!-- ▶ KARTBILDE — bytt URL-en for å bruke et annet bilde -->
  <div class="hk-container">
    <div class="hk-stage-${id}" id="${id}" aria-label="Kart med klikkbare hendelser">
      <img src="${url}" alt="" loading="lazy">${markers}${pops}
    </div>${innerCaption}
  </div>
  <script>
  (function () {
    var root = document.getElementById('${id}');
    if (!root) return;
    var btns = Array.prototype.slice.call(root.querySelectorAll('.hk-m'));
    var pops = Array.prototype.slice.call(root.querySelectorAll('.hk-pop'));
    function closeAll() {
      pops.forEach(function (p) { p.hidden = true; });
      btns.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var pop = document.getElementById(b.getAttribute('data-pop'));
        if (!pop) return;
        var wasOpen = !pop.hidden;
        closeAll();
        if (!wasOpen) {
          pop.hidden = false;
          b.setAttribute('aria-expanded', 'true');
        }
      });
    });
    pops.forEach(function (p) {
      var x = p.querySelector('.hk-pop__close');
      if (x) x.addEventListener('click', function (e) { e.stopPropagation(); closeAll(); });
      p.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) closeAll();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  })();
  </script>
${close}
`;
}

function updateExportButtons() {
  els.copyEmbed.disabled = state.mode === 'map'
    ? state.points.length === 0
    : !state.loaded;
}

els.loadBtn.addEventListener('click', loadMainImage);

els.copyEmbed.addEventListener('click', async () => {
  try {
    let snippet;
    if (state.mode === 'map') {
      if (!map || !state.points.length) return;
      els.copyEmbed.disabled = true;
      setStatus('Lager kartbilde av utsnittet…');
      const snap = await buildMapSnapshot();
      const dataUrl = snap.canvas.toDataURL('image/jpeg', 0.9);
      const fileName = 'hendelseskart-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.jpg';

      setStatus('Laster kartbildet opp til Labrador…');
      let res = await window.faktisk.labradorUploadData({ fileName, dataUrl });
      if (res.loggedIn === false) {
        setStatus('Logg inn i vinduet som åpnes…');
        const st = await window.faktisk.labradorConnect();
        if (!st.loggedIn) { setStatus('Fikk ikke gyldig innlogging.', true); return; }
        res = await window.faktisk.labradorUploadData({ fileName, dataUrl });
      }
      if (!res.ok || !res.url) {
        setStatus('Opplasting feilet: ' + (res.error || 'fant ikke URL — sjekk «Mine filer»'), true);
        return;
      }
      if (window.faktisk.recentFileAdd) {
        window.faktisk.recentFileAdd({ url: res.url, type: 'image', pluginId: PLUGIN_ID }).catch(() => {});
      }
      snippet = buildEmbedSnippet({ url: res.url, points: snap.points, aspect: snap.aspect });
    } else {
      if (!state.loaded) return;
      snippet = buildEmbedSnippet(null);
    }

    await window.faktisk.copyToClipboard(snippet);
    const orig = 'Kopier embed';
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setStatus('Embed-koden er kopiert.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
  } catch (e) {
    setStatus('Kunne ikke lage embed: ' + e.message, true);
  } finally {
    updateExportButtons();
  }
});

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ============================================================
//  Arkivering
// ============================================================

let isRestoring = false;
function serializeState() {
  return {
    mode: state.mode,
    format: state.format,
    mapStyle: state.mapStyle,
    mapView: state.mapView,
    url: els.urlImage.value,
    points: state.points.map(p => {
      const { _marker, ...rest } = p;
      return rest;
    }),
    captionText: els.captionText.value,
    photographer: els.photographer.value,
  };
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    els.captionText.value = saved.captionText || '';
    els.photographer.value = saved.photographer || '';
    if (saved.format && FORMATS[saved.format]) {
      state.format = saved.format;
      els.formatSelect.value = saved.format;
    }
    if (saved.mapStyle && saved.mapStyle in MAP_STYLES) {
      state.mapStyle = saved.mapStyle;
      styleSelect.value = saved.mapStyle;
      applyMapStyle();
    }
    if (saved.mapView) state.mapView = saved.mapView;
    if (Array.isArray(saved.points)) state.points = saved.points;

    if (saved.mode === 'image' && saved.url) {
      els.urlImage.value = saved.url;
      setMode('image');
      await loadMainImage();
      renderPoints();
    } else {
      setMode('map');
      if (map && saved.mapView) {
        map.setView([saved.mapView.lat, saved.mapView.lng], saved.mapView.zoom);
      }
      renderPoints();
    }
  } finally {
    isRestoring = false;
  }
}

let saveTimer = null;
function scheduleSaveState() {
  if (isRestoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
  }, 400);
}
['input', 'change'].forEach(ev => {
  els.urlImage.addEventListener(ev, scheduleSaveState);
  els.captionText.addEventListener(ev, scheduleSaveState);
  els.photographer.addEventListener(ev, scheduleSaveState);
});

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
  const defaultName = (els.captionText.value || '').slice(0, 40).trim()
    || `Hendelseskart ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) {
    setStatus('Lagret: «' + res.name + '».');
    await refreshProjectList();
  }
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) {
    setStatus('Åpner «' + res.name + '»…');
    await applyState(res.state);
  }
});

(async function init() {
  els.formatSelect.value = state.format;
  const pending = localStorage.getItem('faktisk-pending-project');
  await refreshProjectList();
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) {
          await applyState(res.state);
          els.projectSelect.value = fileId;
          return;
        }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) {
      await applyState(res.state);
      return;
    }
  } catch (e) {}
  setMode('map');
})();
