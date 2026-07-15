// Faktisk Studio · Parallax bildecollage
// Scroll-drevet parallax i sticky-container. Hvert bilde har en "depth"-verdi
// som styrer hvor raskt det beveger seg — 1 = normal, høyere = raskere, negativ = motsatt.

const PLUGIN_ID = 'parallax-collage';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const els = {
  imgTabUrl: document.getElementById('imgTabUrl'),
  imgTabFile: document.getElementById('imgTabFile'),
  imgSrcUrl: document.getElementById('imgSrcUrl'),
  imgSrcFile: document.getElementById('imgSrcFile'),
  imgUrl: document.getElementById('imgUrl'),
  imgLoadUrl: document.getElementById('imgLoadUrl'),
  imgFile: document.getElementById('imgFile'),
  imgPickFile: document.getElementById('imgPickFile'),
  imageList: document.getElementById('imageList'),
  imagesCount: document.getElementById('imagesCount'),
  imageProps: document.getElementById('imageProps'),
  propWidth: document.getElementById('propWidth'),
  propWidthVal: document.getElementById('propWidthVal'),
  propRotate: document.getElementById('propRotate'),
  propRotateVal: document.getElementById('propRotateVal'),
  propDepth: document.getElementById('propDepth'),
  propDepthVal: document.getElementById('propDepthVal'),
  deleteImgBtn: document.getElementById('deleteImgBtn'),
  propBg: document.getElementById('propBg'),
  propBgTransparent: document.getElementById('propBgTransparent'),
  propPara: document.getElementById('propPara'),
  propParaVal: document.getElementById('propParaVal'),
  propFrameH: document.getElementById('propFrameH'),
  propFrameHVal: document.getElementById('propFrameHVal'),
  propFrameHMobile: document.getElementById('propFrameHMobile'),
  propFrameHMobileVal: document.getElementById('propFrameHMobileVal'),
  propViewBadge: document.getElementById('propViewBadge'),
  copyToOtherBtn: document.getElementById('copyToOtherBtn'),
  shapeRectBtn: document.getElementById('shapeRectBtn'),
  shapeCircleBtn: document.getElementById('shapeCircleBtn'),
  scrollPreview: document.getElementById('scrollPreview'),
  scrollPreviewVal: document.getElementById('scrollPreviewVal'),
  stage: document.getElementById('stage'),
  frame: document.getElementById('frame'),
  bgLayer: document.getElementById('bgLayer'),
  imagesLayer: document.getElementById('imagesLayer'),
  deviceDesktop: document.getElementById('deviceDesktop'),
  deviceMobile: document.getElementById('deviceMobile'),
  status: document.getElementById('status'),
  copyEmbed: document.getElementById('copyEmbedBtn'),
  back: document.getElementById('backBtn'),
  full: document.getElementById('fullscreenBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject: document.getElementById('saveProjectBtn'),
};

const state = {
  // Hvert bilde har SEPARATE posisjons-verdier per device — det som varierer basert på
  // skjermformat er x/y/width/rotation. Dybde/lag deles alltid.
  images: [],           // [{ id, src, alt, depth, zIndex, desktop:{x,y,width,rotation}, mobile:{x,y,width,rotation} }]
  bgColor: '#000000',
  bgTransparent: true,
  paraMax: 300,
  frameHeightDesktop: 600,
  frameHeightMobile: 700,
  selectedId: null,
};

// UI-only (persisterer ikke): hvilken visning brukeren editerer akkurat nå.
let currentDevice = 'desktop';

let nextImgId = 1;

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

// -------------------------
//  Bilde-lasting
// -------------------------
function loadImageData(srcOrFile) {
  return new Promise((resolve, reject) => {
    const reader = (typeof srcOrFile === 'string')
      ? Promise.resolve(srcOrFile)
      : new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = rej;
          fr.readAsDataURL(srcOrFile);
        });
    reader.then(src => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ src, naturalW: img.naturalWidth, naturalH: img.naturalHeight, name: (typeof srcOrFile === 'string' ? (srcOrFile.split('/').pop() || 'bilde') : srcOrFile.name) });
      img.onerror = reject;
      img.src = src;
    }).catch(reject);
  });
}

// -------------------------
//  Render (editor)
// -------------------------
function render() {
  // Bakgrunn
  els.bgLayer.style.background = state.bgTransparent
    ? 'repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 0 0 / 20px 20px'
    : state.bgColor;

  // Bilder
  els.imagesLayer.innerHTML = '';
  const scrollPct = +els.scrollPreview.value / 100;      // 0-1
  const centeredProgress = (scrollPct - 0.5) * 2;         // -1 til +1

  state.images.forEach((img, idx) => {
    // Array-orden bestemmer stack: siste bilde i array = øverst i lag-stakken.
    const pos = img[currentDevice] || img.desktop;
    const wrap = document.createElement('div');
    wrap.className = 'par-img';
    if (img.shape === 'circle') wrap.classList.add('is-circle');
    wrap.dataset.id = img.id;
    if (img.id === state.selectedId) wrap.classList.add('is-selected');
    wrap.style.left = pos.x + '%';
    wrap.style.top = pos.y + '%';
    wrap.style.width = pos.width + '%';
    wrap.style.zIndex = (idx + 1);
    wrap.style.setProperty('--rot', pos.rotation + 'deg');
    const parY = centeredProgress * img.depth * state.paraMax * -1;
    wrap.style.setProperty('--par-y', parY.toFixed(1) + 'px');

    const el = document.createElement('img');
    el.src = img.src;
    el.alt = img.alt || '';
    wrap.appendChild(el);

    // Resize-håndtak (bare width) — vises bare når selektert
    if (img.id === state.selectedId) {
      const h = document.createElement('div');
      h.className = 'par-img__handle par-img__handle--se';
      wrap.appendChild(h);
      attachResize(h, img);
    }

    els.imagesLayer.appendChild(wrap);
    attachDrag(wrap, img);
  });

  renderImageList();
  renderImageProps();
  updateExportButton();
}

function renderImageList() {
  els.imageList.innerHTML = '';
  els.imagesCount.textContent = state.images.length + ' stk';
  // Vis bildene i OMVENDT array-orden så øverste lag (siste array-index) kommer først i lista
  // (samme konvensjon som Photoshop, Figma osv.).
  const total = state.images.length;
  for (let displayIdx = 0; displayIdx < total; displayIdx++) {
    const actualIdx = total - 1 - displayIdx;
    const img = state.images[actualIdx];
    const layerNum = actualIdx + 1;
    const row = document.createElement('div');
    row.className = 'image-row' + (img.id === state.selectedId ? ' is-selected' : '');
    row.draggable = true;
    row.dataset.actualIdx = actualIdx;
    row.innerHTML = `
      <span class="image-row__grip" aria-hidden="true">⋮⋮</span>
      <div class="image-row__thumb"><img src="${img.src}" alt=""></div>
      <span class="image-row__layer" title="Lag ${layerNum} av ${total}">${layerNum}</span>
      <span class="image-row__label">${img.alt || 'Bilde ' + layerNum}</span>
      <button class="image-row__del" title="Slett">×</button>
    `;
    row.addEventListener('click', e => {
      if (e.target.classList.contains('image-row__del')) {
        state.images.splice(actualIdx, 1);
        if (state.selectedId === img.id) state.selectedId = null;
        render();
        scheduleSaveState();
        return;
      }
      state.selectedId = img.id;
      render();
    });
    // HTML5 drag/drop for lag-omordning
    row.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(actualIdx));
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      els.imageList.querySelectorAll('.image-row').forEach(r => r.classList.remove('is-drop-above', 'is-drop-below'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      row.classList.toggle('is-drop-above', isTopHalf);
      row.classList.toggle('is-drop-below', !isTopHalf);
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('is-drop-above', 'is-drop-below');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const fromIdx = +e.dataTransfer.getData('text/plain');
      if (isNaN(fromIdx) || fromIdx === actualIdx) return;
      const rect = row.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      // Target-index i display-orden svarer omvendt til actualIdx.
      // "Drop above" i visning = "høyere lag" = høyere actual-index.
      let insertAtActual;
      if (isTopHalf) {
        insertAtActual = actualIdx + 1;
      } else {
        insertAtActual = actualIdx;
      }
      // Fjern fra gammel posisjon
      const [moved] = state.images.splice(fromIdx, 1);
      // Juster insertAt om nødvendig (splice endret indeksene)
      if (fromIdx < insertAtActual) insertAtActual--;
      state.images.splice(insertAtActual, 0, moved);
      scheduleSaveState();
      render();
    });
    els.imageList.appendChild(row);
  }
}

function renderImageProps() {
  const img = state.images.find(i => i.id === state.selectedId);
  if (!img) { els.imageProps.style.display = 'none'; return; }
  els.imageProps.style.display = '';
  const pos = img[currentDevice] || img.desktop;
  els.propWidth.value = pos.width; els.propWidthVal.textContent = pos.width + ' %';
  els.propRotate.value = pos.rotation; els.propRotateVal.textContent = pos.rotation + '°';
  els.propDepth.value = img.depth; els.propDepthVal.textContent = (+img.depth).toFixed(1);
  els.propViewBadge.textContent = currentDevice === 'mobile' ? 'MOBIL' : 'DESKTOP';
  const isCircle = img.shape === 'circle';
  els.shapeRectBtn.classList.toggle('is-active', !isCircle);
  els.shapeCircleBtn.classList.toggle('is-active', isCircle);
}

function updateExportButton() {
  els.copyEmbed.disabled = state.images.length === 0;
}

// -------------------------
//  Drag + resize
// -------------------------
function attachDrag(wrap, img) {
  wrap.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('par-img__handle')) return;
    e.preventDefault();
    state.selectedId = img.id;
    wrap.setPointerCapture(e.pointerId);
    const rect = els.frame.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const pos = img[currentDevice];
    const origX = pos.x, origY = pos.y;
    const onMove = ev => {
      const dxPct = (ev.clientX - startX) / rect.width * 100;
      const dyPct = (ev.clientY - startY) / rect.height * 100;
      pos.x = Math.max(-20, Math.min(120, origX + dxPct));
      pos.y = Math.max(-20, Math.min(120, origY + dyPct));
      wrap.style.left = pos.x + '%';
      wrap.style.top = pos.y + '%';
    };
    const onUp = () => {
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      scheduleSaveState();
      render();
    };
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
  });
}

function attachResize(handle, img) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const rect = els.frame.getBoundingClientRect();
    const startX = e.clientX;
    const pos = img[currentDevice];
    const origW = pos.width;
    const wrap = handle.closest('.par-img');
    const onMove = ev => {
      const dxPct = (ev.clientX - startX) / rect.width * 100;
      pos.width = Math.max(5, Math.min(150, origW + dxPct));
      if (wrap) wrap.style.width = pos.width + '%';
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      scheduleSaveState();
      render();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

// -------------------------
//  Bilde-input + tabs
// -------------------------
els.imgTabUrl.addEventListener('click', () => {
  els.imgTabUrl.classList.add('is-active');
  els.imgTabFile.classList.remove('is-active');
  els.imgSrcUrl.style.display = '';
  els.imgSrcFile.style.display = 'none';
});
els.imgTabFile.addEventListener('click', () => {
  els.imgTabFile.classList.add('is-active');
  els.imgTabUrl.classList.remove('is-active');
  els.imgSrcFile.style.display = '';
  els.imgSrcUrl.style.display = 'none';
});

async function addImageFromData(data) {
  const id = nextImgId++;
  const defaultPos = {
    x: 20 + (state.images.length % 4) * 15,
    y: 20 + Math.floor(state.images.length / 4) * 15,
    width: 30,
    rotation: 0,
  };
  // Mobil starter med bredere bilder siden spalten er smalere
  const defaultMobile = { ...defaultPos, width: 60, x: 20 };
  // Nye bilder legges alltid TIL SLUTT i array-en, som betyr øverste lag i stakken.
  state.images.push({
    id,
    src: data.src,
    alt: data.name || ('Bilde ' + id),
    depth: 1.0,
    shape: 'rect',   // 'rect' | 'circle'
    desktop: defaultPos,
    mobile: defaultMobile,
  });
  state.selectedId = id;
  render();
  scheduleSaveState();
  setStatus('Bilde lagt til.');
}

els.imgLoadUrl.addEventListener('click', async () => {
  const url = (els.imgUrl.value || '').trim();
  if (!url) { setStatus('Lim inn URL først.', true); return; }
  setStatus('Laster bilde…');
  try {
    const data = await loadImageData(url);
    await addImageFromData(data);
    els.imgUrl.value = '';
    // Registrer i delt fil-historikk (feiler stille hvis studio-versjonen mangler API-et)
    if (window.faktisk.recentFileAdd) {
      window.faktisk.recentFileAdd({ url, type: 'image', alt: data.name || '', pluginId: PLUGIN_ID }).catch(() => {});
    }
  } catch (e) {
    setStatus('Kunne ikke laste bildet. Sjekk URL/CORS.', true);
  }
});

// Åpne Labrador i embedded vindu (fallback til systemnettleser).
// Åpner root-URL, ikke direkte /settings/upload-file — Labrador SPA krasjer på
// direktelinker uten aktiv session. Fra root navigerer man til Innstillinger →
// Last opp fil på 1 klikk, og persist:labrador-partisjonen husker deg til neste gang.
document.getElementById('openLabradorBtn')?.addEventListener('click', async () => {
  if (window.faktisk.openLabrador) {
    await window.faktisk.openLabrador();
  } else {
    await window.faktisk.openExternal('https://labrador.faktisk.no/');
  }
});

// Lytt på klikk fra "Nylige filer"-panelet — auto-last inn bilde
const recentPanel = document.getElementById('recentFilesPanel');
if (recentPanel) {
  recentPanel.addEventListener('faktisk-recent-file-picked', async (e) => {
    const url = e.detail.url;
    setStatus('Laster fra historikk…');
    try {
      const data = await loadImageData(url);
      await addImageFromData(data);
    } catch (err) {
      setStatus('Kunne ikke laste bildet fra historikken.', true);
    }
  });
}
els.imgPickFile.addEventListener('click', () => els.imgFile.click());
els.imgFile.addEventListener('change', async () => {
  const file = els.imgFile.files[0];
  if (!file) return;
  try {
    const data = await loadImageData(file);
    await addImageFromData(data);
  } catch (e) {
    setStatus('Kunne ikke lese fil.', true);
  }
});

// -------------------------
//  Prop-håndterere
// -------------------------
// Oppdater felt som er delt (dybde, lag, alt)
function updateShared(field, val) {
  const img = state.images.find(i => i.id === state.selectedId);
  if (!img) return;
  img[field] = val;
  render();
  scheduleSaveState();
}
// Oppdater felt som er per-visning (x, y, width, rotation)
function updatePerView(field, val) {
  const img = state.images.find(i => i.id === state.selectedId);
  if (!img) return;
  const pos = img[currentDevice] || img.desktop;
  pos[field] = val;
  render();
  scheduleSaveState();
}
els.propWidth.addEventListener('input', () => { updatePerView('width', +els.propWidth.value); els.propWidthVal.textContent = els.propWidth.value + ' %'; });
els.propRotate.addEventListener('input', () => { updatePerView('rotation', +els.propRotate.value); els.propRotateVal.textContent = els.propRotate.value + '°'; });
els.propDepth.addEventListener('input', () => { updateShared('depth', +els.propDepth.value); els.propDepthVal.textContent = (+els.propDepth.value).toFixed(1); });

// "Kopier posisjon" — kopierer aktive visnings-verdier til den andre visningen.
els.copyToOtherBtn.addEventListener('click', () => {
  const img = state.images.find(i => i.id === state.selectedId);
  if (!img) return;
  const from = currentDevice, to = currentDevice === 'desktop' ? 'mobile' : 'desktop';
  img[to] = { ...img[from] };
  scheduleSaveState();
  render();
  setStatus('Kopierte ' + from + '-posisjon til ' + to + '.');
});

// Shape-toggle (rect/circle)
function setShape(shape) {
  const img = state.images.find(i => i.id === state.selectedId);
  if (!img) return;
  img.shape = shape;
  render();
  scheduleSaveState();
}
els.shapeRectBtn.addEventListener('click', () => setShape('rect'));
els.shapeCircleBtn.addEventListener('click', () => setShape('circle'));

// =====================================================================
//  PRESETS — ferdige oppsett som anvendes på eksisterende bilder
// =====================================================================
// Hvert preset har posisjons-arrayer for ulike antall bilder. Bilder som ligger
// utenfor preset-lengden beholder posisjonen sin. Mobile-verdier avledes fra desktop
// via en enkel skalering. Bildene beholder src/depth/shape som brukeren har satt.
const PRESETS = {
  fokus: {
    // Ett stort bilde midt, med opptil 3 små bilder rundt.
    desktop: [
      { x: 25, y: 12, w: 50, rot: 0,  depth: 0.5 },
      { x: 5,  y: 55, w: 22, rot: -6, depth: 1.6 },
      { x: 73, y: 60, w: 22, rot: 5,  depth: 1.6 },
      { x: 40, y: 68, w: 20, rot: -3, depth: 2.0 },
    ],
    mobile: [
      { x: 15, y: 8,  w: 70, rot: 0,  depth: 0.5 },
      { x: 5,  y: 55, w: 45, rot: -6, depth: 1.6 },
      { x: 50, y: 62, w: 45, rot: 5,  depth: 1.6 },
      { x: 25, y: 78, w: 50, rot: -3, depth: 2.0 },
    ],
  },
  duo: {
    // To bilder side ved side med litt overlapping.
    desktop: [
      { x: 8,  y: 15, w: 46, rot: -4, depth: 0.7 },
      { x: 46, y: 22, w: 46, rot: 4,  depth: 1.3 },
    ],
    mobile: [
      { x: 5,  y: 8,  w: 70, rot: -4, depth: 0.7 },
      { x: 25, y: 48, w: 70, rot: 4,  depth: 1.3 },
    ],
  },
  triangel: {
    // Bilde på topp, to i bunn — trekant-formasjon.
    desktop: [
      { x: 33, y: 5,  w: 34, rot: 0,  depth: 0.8 },
      { x: 3,  y: 52, w: 34, rot: -6, depth: 1.5 },
      { x: 63, y: 52, w: 34, rot: 6,  depth: 1.5 },
    ],
    mobile: [
      { x: 20, y: 5,  w: 60, rot: 0,  depth: 0.8 },
      { x: 3,  y: 50, w: 60, rot: -6, depth: 1.5 },
      { x: 37, y: 70, w: 60, rot: 6,  depth: 1.5 },
    ],
  },
  skala: {
    // Bildene i dybdeskala fra bakerst (rolig) til forrest (rask). 4 bilder ideelt.
    desktop: [
      { x: 20, y: 25, w: 60, rot: 0,  depth: 0.3 },
      { x: 10, y: 40, w: 40, rot: -3, depth: 0.8 },
      { x: 55, y: 35, w: 35, rot: 4,  depth: 1.5 },
      { x: 35, y: 60, w: 30, rot: -2, depth: 2.2 },
    ],
    mobile: [
      { x: 10, y: 12, w: 80, rot: 0,  depth: 0.3 },
      { x: 5,  y: 38, w: 55, rot: -3, depth: 0.8 },
      { x: 45, y: 45, w: 55, rot: 4,  depth: 1.5 },
      { x: 22, y: 70, w: 55, rot: -2, depth: 2.2 },
    ],
  },
  kollasje: {
    // 5-6 bilder spredt utover, ulike rotasjoner og dybder — polaroid-mood.
    desktop: [
      { x: 5,  y: 10, w: 28, rot: -8, depth: 0.6 },
      { x: 38, y: 5,  w: 28, rot: 4,  depth: 1.2 },
      { x: 68, y: 18, w: 27, rot: -3, depth: 0.9 },
      { x: 15, y: 55, w: 30, rot: 6,  depth: 1.8 },
      { x: 55, y: 60, w: 30, rot: -4, depth: 1.4 },
      { x: 40, y: 35, w: 22, rot: 2,  depth: 2.2 },
    ],
    mobile: [
      { x: 5,  y: 3,  w: 48, rot: -8, depth: 0.6 },
      { x: 45, y: 12, w: 50, rot: 4,  depth: 1.2 },
      { x: 10, y: 32, w: 45, rot: -3, depth: 0.9 },
      { x: 48, y: 42, w: 48, rot: 6,  depth: 1.8 },
      { x: 5,  y: 65, w: 50, rot: -4, depth: 1.4 },
      { x: 42, y: 72, w: 55, rot: 2,  depth: 2.2 },
    ],
  },
};

async function applyPreset(id) {
  const preset = PRESETS[id];
  if (!preset) return;
  if (state.images.length === 0) {
    setStatus('Legg til bilder først, så anvend et preset.', true);
    return;
  }
  const ok = await window.faktiskDialog.confirm(
    'Anvend "' + id + '"-preset? Dette overskriver posisjonen, bredden og dybden til de første ' +
    Math.min(state.images.length, preset.desktop.length) + ' bildene.'
  );
  if (!ok) return;
  const n = Math.min(state.images.length, preset.desktop.length);
  for (let i = 0; i < n; i++) {
    const img = state.images[i];
    const d = preset.desktop[i];
    const m = preset.mobile[i];
    img.desktop = { x: d.x, y: d.y, width: d.w, rotation: d.rot };
    img.mobile  = { x: m.x, y: m.y, width: m.w, rotation: m.rot };
    img.depth = d.depth;
  }
  render();
  scheduleSaveState();
  setStatus('Anvendte preset "' + id + '" på ' + n + ' bilder.');
}
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});
els.deleteImgBtn.addEventListener('click', () => {
  if (state.selectedId == null) return;
  state.images = state.images.filter(i => i.id !== state.selectedId);
  state.selectedId = null;
  render();
  scheduleSaveState();
});

els.propBg.addEventListener('input', () => { state.bgColor = els.propBg.value; render(); scheduleSaveState(); });
els.propBgTransparent.addEventListener('change', () => { state.bgTransparent = els.propBgTransparent.checked; render(); scheduleSaveState(); });
els.propPara.addEventListener('input', () => { state.paraMax = +els.propPara.value; els.propParaVal.textContent = state.paraMax + ' px'; render(); scheduleSaveState(); });
els.propFrameH.addEventListener('input', () => { state.frameHeightDesktop = +els.propFrameH.value; els.propFrameHVal.textContent = state.frameHeightDesktop + ' px'; scheduleSaveState(); });
els.propFrameHMobile.addEventListener('input', () => { state.frameHeightMobile = +els.propFrameHMobile.value; els.propFrameHMobileVal.textContent = state.frameHeightMobile + ' px'; scheduleSaveState(); });
els.scrollPreview.addEventListener('input', () => { els.scrollPreviewVal.textContent = els.scrollPreview.value + ' %'; render(); });

// Device-toggle (kun UI, ikke persistert)
function setDevice(device) {
  currentDevice = device;
  els.stage.dataset.device = device;
  els.deviceDesktop.classList.toggle('is-active', device === 'desktop');
  els.deviceMobile.classList.toggle('is-active', device === 'mobile');
  render();
}
els.deviceDesktop.addEventListener('click', () => setDevice('desktop'));
els.deviceMobile.addEventListener('click', () => setDevice('mobile'));

// -------------------------
//  Embed-generering
// -------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildInnerHtml() {
  const bg = state.bgTransparent ? 'transparent' : state.bgColor;

  // Hvert bilde får et unikt classname (col-img-N) + desktop-posisjon som base CSS.
  // Mobil-overrides legges i en media query — kun for bilder som faktisk avviker
  // fra desktop, så CSS-en blir kompakt.
  const perImageStyles = [];
  const mobileOverrides = [];
  const imagesHtml = state.images.map((img, idx) => {
    const d = img.desktop, m = img.mobile;
    const z = idx + 1;
    perImageStyles.push(`.col-img-${img.id}{left:${d.x.toFixed(1)}%;top:${d.y.toFixed(1)}%;width:${d.width.toFixed(1)}%;--rot:${d.rotation.toFixed(1)}deg;z-index:${z};}`);
    if (m && (m.x !== d.x || m.y !== d.y || m.width !== d.width || m.rotation !== d.rotation)) {
      mobileOverrides.push(`  .col-img-${img.id}{left:${m.x.toFixed(1)}%;top:${m.y.toFixed(1)}%;width:${m.width.toFixed(1)}%;--rot:${m.rotation.toFixed(1)}deg;}`);
    }
    const shapeClass = img.shape === 'circle' ? ' col-img--circle' : '';
    return `    <img class="collage-img col-img-${img.id}${shapeClass}" src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || '')}" data-depth="${img.depth.toFixed(2)}">`;
  }).join('\n');
  const mobileCss = mobileOverrides.length
    ? `\n@media (max-width: 600px) {\n${mobileOverrides.join('\n')}\n}`
    : '';

  // Ny mekanikk: iframen har fast høyde (state.frameHeight), sitter i sideflyt.
  // Ingen sticky/pinning — leseren scroller vanlig gjennom siden.
  // Bildene animeres basert på iframens posisjon i viewporten (getBoundingClientRect på window.frameElement,
  // som er tilgjengelig fordi srcdoc-iframes er same-origin med parent).
  return `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parallax collage</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: ${bg};
    font-family: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif;
  }
  .collage-stage {
    position: relative;
    width: 100%;
    height: 100vh;
    overflow: hidden;
  }
  .collage-img {
    position: absolute;
    height: auto;
    border-radius: 6px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
    transform: translate3d(0, var(--par-y, 0px), 0) rotate(var(--rot, 0deg));
    will-change: transform;
  }
  .collage-img.col-img--circle {
    aspect-ratio: 1 / 1;
    height: auto;
    object-fit: cover;
    border-radius: 50%;
  }
  ${perImageStyles.join('')}${mobileCss}
</style>
</head>
<body>
<div class="collage-stage">
${imagesHtml}
</div>
<script>
(function(){
  var PARA_MAX = ${state.paraMax};
  var imgs = document.querySelectorAll('.collage-img');
  // Prøv å hente parent-frame-elementet (fungerer siden srcdoc er same-origin)
  var parentWin = null, frameEl = null;
  try {
    parentWin = window.parent && window.parent !== window ? window.parent : null;
    frameEl = window.frameElement || null;
  } catch (e) {}

  function updateParallax() {
    var rect, vh;
    if (frameEl && parentWin) {
      // Vanlig embed-modus: mål iframens posisjon i PARENT-viewporten
      try {
        rect = frameEl.getBoundingClientRect();
        vh = parentWin.innerHeight || document.documentElement.clientHeight;
      } catch (e) { return; }
    } else {
      // Standalone-modus (åpnet iframen direkte): mål egen scroll
      rect = { top: 0, height: window.innerHeight };
      vh = window.innerHeight;
    }
    // Progress: 0 når iframen akkurat kommer inn nedenfra, 1 når den akkurat forlater oppover
    var total = vh + rect.height;
    var progress = (vh - rect.top) / total;
    progress = Math.max(0, Math.min(1, progress));
    // Sentrer: -1 til +1, 0 når iframens senter er på viewport-senter
    var centered = (progress - 0.5) * 2;
    imgs.forEach(function(im){
      var depth = parseFloat(im.dataset.depth || 1);
      var parY = centered * depth * PARA_MAX * -1;
      im.style.setProperty('--par-y', parY.toFixed(1) + 'px');
    });
  }

  // rAF-throttled scroll-lytter på parent for glatt animasjon
  var pending = false;
  function requestUpdate() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(function(){
      updateParallax();
      pending = false;
    });
  }

  try {
    if (parentWin) {
      parentWin.addEventListener('scroll', requestUpdate, { passive: true });
      parentWin.addEventListener('resize', requestUpdate);
    } else {
      window.addEventListener('scroll', requestUpdate, { passive: true });
      window.addEventListener('resize', requestUpdate);
    }
  } catch (e) {
    // Cross-origin fallback: rAF-loop
    (function loop(){
      updateParallax();
      window.requestAnimationFrame(loop);
    })();
  }
  updateParallax();
})();
</script>
</body>
</html>`;
}

function buildEmbed() {
  const inner = buildInnerHtml();
  const srcdoc = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const desktopH = state.frameHeightDesktop;
  const mobileH = state.frameHeightMobile;
  // Iframe-høyden byttes ved 600px viewportbredde. Wrapper og iframe deler samme
  // høyde-uttrykk så det matcher.
  const heightExpr = `min(${desktopH}px, 90vh)`;
  return `<!-- Faktisk · Parallax bildecollage — selvstendig iframe (fungerer i CMS som strammer markup) -->
<style>.faktisk-parallax-wrap{height:${heightExpr}}.faktisk-parallax-wrap iframe{height:${heightExpr}}@media (max-width:600px){.faktisk-parallax-wrap{height:min(${mobileH}px,95vh)}.faktisk-parallax-wrap iframe{height:min(${mobileH}px,95vh)}}</style>
<div class="faktisk-parallax-wrap" style="position:relative;width:100%;overflow:hidden;"><iframe title="parallax-collage" srcdoc="${srcdoc}" width="1200" height="${desktopH}" loading="lazy" style="width:100%;border:0;display:block;" allowfullscreen scrolling="auto"></iframe></div>`;
}

els.copyEmbed.addEventListener('click', async () => {
  try {
    const snippet = buildEmbed();
    await window.faktisk.copyToClipboard(snippet);
    const orig = els.copyEmbed.textContent;
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setStatus('Embed-kode kopiert til utklippstavle.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
  } catch (e) {
    setStatus('Kunne ikke kopiere: ' + e.message, true);
  }
});

// -------------------------
//  State-persistens
// -------------------------
els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });

let isRestoring = false;
function serializeState() { return JSON.parse(JSON.stringify(state)); }
async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    // Migrer bilder fra v0.1.x-format (flate x/y/width/rotation + explicit zIndex) til
    // v0.2+-format (desktop/mobile nestet + array-orden bestemmer z-stack).
    const rawImages = (Array.isArray(saved.images) ? saved.images : []).slice();
    // Hvis migrasjonen har eksplisitt zIndex på gamle bilder, sortér etter det
    // så array-orden matcher original layer-intent.
    if (rawImages.length > 0 && rawImages.some(i => typeof i.zIndex === 'number')) {
      rawImages.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    }
    state.images = rawImages.map(img => {
      if (img.desktop && img.mobile) return img; // allerede migrert til v0.2
      const base = {
        x: +img.x || 0,
        y: +img.y || 0,
        width: +img.width || 30,
        rotation: +img.rotation || 0,
      };
      return {
        id: img.id,
        src: img.src,
        alt: img.alt || '',
        depth: +img.depth || 1,
        shape: img.shape || 'rect',
        desktop: base,
        mobile: { ...base, width: Math.min(80, base.width * 1.6) },
      };
    });
    state.bgColor = saved.bgColor || '#000000';
    state.bgTransparent = saved.bgTransparent !== false;
    state.paraMax = +saved.paraMax || 300;
    // Migrer frameHeight → frameHeightDesktop + frameHeightMobile
    state.frameHeightDesktop = +saved.frameHeightDesktop || +saved.frameHeight || 600;
    state.frameHeightMobile = +saved.frameHeightMobile || (+saved.frameHeight || 700) + 100;
    state.selectedId = saved.selectedId || null;
    nextImgId = state.images.reduce((m, i) => Math.max(m, i.id + 1), 1);
    // Sett UI-verdier
    els.propBg.value = state.bgColor;
    els.propBgTransparent.checked = state.bgTransparent;
    els.propPara.value = state.paraMax; els.propParaVal.textContent = state.paraMax + ' px';
    els.propFrameH.value = state.frameHeightDesktop; els.propFrameHVal.textContent = state.frameHeightDesktop + ' px';
    els.propFrameHMobile.value = state.frameHeightMobile; els.propFrameHMobileVal.textContent = state.frameHeightMobile + ' px';
    render();
  } finally { isRestoring = false; }
}
let saveTimer = null;
function scheduleSaveState() {
  if (isRestoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
  }, 400);
}

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.fileId; opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch (e) { console.error(e); }
}
els.saveProject.addEventListener('click', async () => {
  const defaultName = `Parallax ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) { setStatus('Lagret: «' + res.name + '».'); await refreshProjectList(); }
  else setStatus('Kunne ikke lagre.', true);
});
els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) { await applyState(res.state); setStatus('Åpnet prosjekt.'); }
});

// -------------------------
//  Init
// -------------------------
(async function init() {
  render();
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) { await applyState(res.state); els.projectSelect.value = fileId; return; }
      }
    } catch (e) { console.error(e); }
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) await applyState(res.state);
  } catch (e) { console.error(e); }
})();
