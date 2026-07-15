// Faktisk Studio · Bildemal-plugin
// Komponer et bilde med bakgrunn, bokser/sirkler med hvit ramme og drop shadow,
// mørke gradient-fades. Eksport til PNG/JPG eller utklippstavle.

const PLUGIN_ID = 'bildemal';

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

const CANVAS_SIZES = {
  '1920x1080': { w: 1920, h: 1080 },
  '1080x1080': { w: 1080, h: 1080 },
};

const els = {
  canvasSize: document.getElementById('canvasSize'),
  bgTabUrl: document.getElementById('bgTabUrl'),
  bgTabFile: document.getElementById('bgTabFile'),
  bgSrcUrl: document.getElementById('bgSrcUrl'),
  bgSrcFile: document.getElementById('bgSrcFile'),
  bgUrl: document.getElementById('bgUrl'),
  bgLoadUrl: document.getElementById('bgLoadUrl'),
  bgFile: document.getElementById('bgFile'),
  bgPickFile: document.getElementById('bgPickFile'),
  bgFileName: document.getElementById('bgFileName'),
  shapesCount: document.getElementById('shapesCount'),
  addRectBtn: document.getElementById('addRectBtn'),
  addCircleBtn: document.getElementById('addCircleBtn'),
  shapeList: document.getElementById('shapeList'),
  shapeProps: document.getElementById('shapeProps'),
  propStroke: document.getElementById('propStroke'),
  propStrokeVal: document.getElementById('propStrokeVal'),
  propRadius: document.getElementById('propRadius'),
  propRadiusVal: document.getElementById('propRadiusVal'),
  propRadiusRow: document.getElementById('propRadiusRow'),
  propShadow: document.getElementById('propShadow'),
  propShadowVal: document.getElementById('propShadowVal'),
  shapeTabUrl: document.getElementById('shapeTabUrl'),
  shapeTabFile: document.getElementById('shapeTabFile'),
  shapeSrcUrl: document.getElementById('shapeSrcUrl'),
  shapeSrcFile: document.getElementById('shapeSrcFile'),
  shapeUrl: document.getElementById('shapeUrl'),
  shapeLoadUrl: document.getElementById('shapeLoadUrl'),
  shapeFile: document.getElementById('shapeFile'),
  shapePickFile: document.getElementById('shapePickFile'),
  shapeFileName: document.getElementById('shapeFileName'),
  deleteShapeBtn: document.getElementById('deleteShapeBtn'),
  fadeTop: document.getElementById('fadeTop'),
  fadeTopVal: document.getElementById('fadeTopVal'),
  fadeBottom: document.getElementById('fadeBottom'),
  fadeBottomVal: document.getElementById('fadeBottomVal'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  exportJpgBtn: document.getElementById('exportJpgBtn'),
  copyClipBtn: document.getElementById('copyClipBtn'),
  status: document.getElementById('status'),
  frame: document.getElementById('frame'),
  bgLayer: document.getElementById('bgLayer'),
  shapesLayer: document.getElementById('shapesLayer'),
  fadeTopLayer: document.getElementById('fadeTopLayer'),
  fadeBottomLayer: document.getElementById('fadeBottomLayer'),
  back: document.getElementById('backBtn'),
  full: document.getElementById('fullscreenBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject: document.getElementById('saveProjectBtn'),
};

// State er i CANVAS-koordinater (px på den endelige outputen, ikke editor-pixels).
// Editoren skalerer alt med en frame-bredde-faktor.
const state = {
  canvasSize: '1920x1080',
  bg: null,         // { src, naturalW, naturalH, x, y, scale } eller null
  shapes: [],       // [{ id, type:'rect'|'circle', x, y, w, h, strokeWidth, cornerRadius, shadowAlpha, image: { src, naturalW, naturalH, x, y, scale } | null }]
  fadeTop: 0,       // 0-1 alpha
  fadeBottom: 0,    // 0-1 alpha
  selectedShapeId: null,
};

let nextShapeId = 1;

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

// Aktuell canvas-størrelse i piksler
function canvasDim() { return CANVAS_SIZES[state.canvasSize] || CANVAS_SIZES['1920x1080']; }

// Faktoren mellom canvas-px og editor-px
function editorScale() {
  const dim = canvasDim();
  const frameW = els.frame.getBoundingClientRect().width;
  return frameW / dim.w;
}

// Konverter canvas-px → editor-px (string med 'px')
function toEditorPx(canvasPx) {
  return (canvasPx * editorScale()).toFixed(1) + 'px';
}

// =============================================
//  Bilde-laster (URL eller File → returnerer { src(dataURL), naturalW, naturalH })
// =============================================
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
      img.onload = () => resolve({ src, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
      img.onerror = reject;
      img.src = src;
    }).catch(reject);
  });
}

// =============================================
//  Render — synkroniser DOM med state
// =============================================
function render() {
  const dim = canvasDim();
  els.frame.style.aspectRatio = dim.w + ' / ' + dim.h;

  // Bakgrunn
  els.bgLayer.innerHTML = '';
  if (state.bg) {
    const img = document.createElement('img');
    img.src = state.bg.src;
    img.style.left = toEditorPx(state.bg.x);
    img.style.top = toEditorPx(state.bg.y);
    img.style.width = toEditorPx(state.bg.naturalW * state.bg.scale);
    img.style.height = toEditorPx(state.bg.naturalH * state.bg.scale);
    els.bgLayer.appendChild(img);
    attachBgDrag(img);
  }

  // Shapes — to lag: ytre .shape (med resize-håndtak), indre .shape__clip (med border + bilde)
  els.shapesLayer.innerHTML = '';
  state.shapes.forEach(s => {
    const shape = document.createElement('div');
    shape.className = 'shape';
    shape.dataset.id = s.id;
    if (s.id === state.selectedShapeId) shape.classList.add('is-selected');
    shape.style.left = toEditorPx(s.x);
    shape.style.top = toEditorPx(s.y);
    shape.style.width = toEditorPx(s.w);
    shape.style.height = toEditorPx(s.h);
    shape.style.setProperty('--shadow-alpha', s.shadowAlpha);

    // Klipplaget — innset av strokeWidth slik at klippet stopper PÅ INDRE kant av stroken
    const stroke = s.strokeWidth;
    const clip = document.createElement('div');
    clip.className = 'shape__clip';
    clip.style.top = toEditorPx(stroke);
    clip.style.left = toEditorPx(stroke);
    clip.style.width = toEditorPx(s.w - 2 * stroke);
    clip.style.height = toEditorPx(s.h - 2 * stroke);
    // Indre border-radius = outer cornerRadius - strokeWidth
    clip.style.borderRadius = s.type === 'circle'
      ? '50%'
      : toEditorPx(Math.max(0, s.cornerRadius - stroke));
    shape.appendChild(clip);

    // Indre bilde (i klipplaget)
    if (s.image) {
      const img = document.createElement('img');
      img.className = 'shape__img';
      img.src = s.image.src;
      img.style.left = toEditorPx(s.image.x);
      img.style.top = toEditorPx(s.image.y);
      img.style.width = toEditorPx(s.image.naturalW * s.image.scale);
      img.style.height = toEditorPx(s.image.naturalH * s.image.scale);
      clip.appendChild(img);

      const grab = document.createElement('div');
      grab.className = 'shape__img-grab';
      clip.appendChild(grab);
      attachShapeImgDrag(grab, s);
    }

    // SVG-stroke — ren tegnet linje sentrert på path. ViewBox = shape-størrelse i canvas-px.
    const strokeDiv = document.createElement('div');
    strokeDiv.className = 'shape__stroke';
    strokeDiv.style.setProperty('--shadow-alpha', s.shadowAlpha);
    strokeDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" preserveAspectRatio="none">${buildStrokeSvgInner(s)}</svg>`;
    shape.appendChild(strokeDiv);

    // Resize-handles på ytre .shape — fullt synlige siden shape ikke har overflow:hidden
    ['nw', 'ne', 'sw', 'se'].forEach(dir => {
      const h = document.createElement('div');
      h.className = 'shape__handle shape__handle--' + dir;
      h.dataset.dir = dir;
      shape.appendChild(h);
      attachShapeResize(h, s);
    });

    els.shapesLayer.appendChild(shape);
    attachShapeDrag(shape, s);
  });

  // Fade-overlays
  els.fadeTopLayer.style.setProperty('--fade-top', state.fadeTop);
  els.fadeBottomLayer.style.setProperty('--fade-bottom', state.fadeBottom);

  renderShapeList();
  renderShapeProps();
  updateExportButtons();
}

function renderShapeList() {
  els.shapeList.innerHTML = '';
  els.shapesCount.textContent = state.shapes.length + ' stk';
  state.shapes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'shape-row' + (s.id === state.selectedShapeId ? ' is-selected' : '');
    row.innerHTML = `
      <div class="shape-row__icon shape-row__icon--${s.type}"></div>
      <span class="shape-row__label">${s.type === 'rect' ? 'Rektangel' : 'Sirkel'} ${i + 1}</span>
      <button class="shape-row__del" title="Slett">×</button>
    `;
    row.addEventListener('click', e => {
      if (e.target.classList.contains('shape-row__del')) {
        state.shapes.splice(i, 1);
        if (state.selectedShapeId === s.id) state.selectedShapeId = null;
        render();
        scheduleSaveState();
        return;
      }
      state.selectedShapeId = s.id;
      render();
    });
    els.shapeList.appendChild(row);
  });
}

function renderShapeProps() {
  const s = state.shapes.find(x => x.id === state.selectedShapeId);
  if (!s) {
    els.shapeProps.style.display = 'none';
    return;
  }
  els.shapeProps.style.display = '';
  els.propStroke.value = s.strokeWidth;
  els.propStrokeVal.textContent = s.strokeWidth + ' px';
  // Radius-slider clampes så min følger stroke-tykkelsen (uniform hjørne-tykkelse).
  els.propRadius.min = s.strokeWidth;
  els.propRadius.value = Math.max(s.strokeWidth, s.cornerRadius);
  els.propRadiusVal.textContent = els.propRadius.value + ' px';
  els.propRadiusRow.style.display = s.type === 'circle' ? 'none' : '';
  els.propShadow.value = Math.round(s.shadowAlpha * 100);
  els.propShadowVal.textContent = Math.round(s.shadowAlpha * 100) + ' %';
}

function updateExportButtons() {
  const hasContent = !!state.bg || state.shapes.length > 0;
  els.exportPngBtn.disabled = !hasContent;
  els.exportJpgBtn.disabled = !hasContent;
  els.copyClipBtn.disabled = !hasContent;
}

// =============================================
//  Drag-håndtering for bakgrunn, shapes, indre bilder, resize
// =============================================
function attachBgDrag(imgEl) {
  imgEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    imgEl.setPointerCapture(e.pointerId);
    els.bgLayer.classList.add('is-dragging');
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = state.bg.x;
    const origY = state.bg.y;
    const scale = editorScale();
    const onMove = ev => {
      state.bg.x = origX + (ev.clientX - startX) / scale;
      state.bg.y = origY + (ev.clientY - startY) / scale;
      imgEl.style.left = toEditorPx(state.bg.x);
      imgEl.style.top = toEditorPx(state.bg.y);
    };
    const onUp = () => {
      imgEl.removeEventListener('pointermove', onMove);
      imgEl.removeEventListener('pointerup', onUp);
      els.bgLayer.classList.remove('is-dragging');
      scheduleSaveState();
    };
    imgEl.addEventListener('pointermove', onMove);
    imgEl.addEventListener('pointerup', onUp);
  });
  // Scroll for zoom
  els.bgLayer.addEventListener('wheel', e => {
    if (!state.bg) return;
    e.preventDefault();
    const dim = canvasDim();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.1, Math.min(5, state.bg.scale * (1 + delta)));
    // Zoom rundt sentrum av canvas (enkleste tilnærming)
    const cx = dim.w / 2;
    const cy = dim.h / 2;
    const oldW = state.bg.naturalW * state.bg.scale;
    const oldH = state.bg.naturalH * state.bg.scale;
    const newW = state.bg.naturalW * newScale;
    const newH = state.bg.naturalH * newScale;
    state.bg.x -= (newW - oldW) / 2 * ((cx - (state.bg.x + oldW / 2)) / oldW + 0.5);
    state.bg.y -= (newH - oldH) / 2 * ((cy - (state.bg.y + oldH / 2)) / oldH + 0.5);
    state.bg.scale = newScale;
    render();
    scheduleSaveState();
  }, { passive: false });
}

function attachShapeDrag(shapeEl, s) {
  shapeEl.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('shape__handle')) return; // resize-håndtak
    if (e.target.classList.contains('shape__img-grab')) return; // indre bilde-drag
    e.preventDefault();
    state.selectedShapeId = s.id;
    shapeEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = s.x;
    const origY = s.y;
    const scale = editorScale();
    const onMove = ev => {
      s.x = origX + (ev.clientX - startX) / scale;
      s.y = origY + (ev.clientY - startY) / scale;
      shapeEl.style.left = toEditorPx(s.x);
      shapeEl.style.top = toEditorPx(s.y);
    };
    const onUp = () => {
      shapeEl.removeEventListener('pointermove', onMove);
      shapeEl.removeEventListener('pointerup', onUp);
      scheduleSaveState();
      render();
    };
    shapeEl.addEventListener('pointermove', onMove);
    shapeEl.addEventListener('pointerup', onUp);
  });
}

// Bygger SVG-strokens path-element (rect eller ellipse) i canvas-koordinater.
function buildStrokeSvgInner(s) {
  const sw = s.strokeWidth;
  if (s.type === 'circle') {
    return `<ellipse cx="${s.w / 2}" cy="${s.h / 2}" rx="${(s.w - sw) / 2}" ry="${(s.h - sw) / 2}" fill="none" stroke="white" stroke-width="${sw}"/>`;
  }
  // Rect: path-linjen sentreres så ytterkant = s.x/y/w/h
  const rx = Math.max(0, s.cornerRadius - sw / 2);
  return `<rect x="${sw / 2}" y="${sw / 2}" width="${s.w - sw}" height="${s.h - sw}" rx="${rx}" fill="none" stroke="white" stroke-width="${sw}"/>`;
}

// Oppdater SVG-stroken + klipplaget på en eksisterende shape (under resize).
function updateShapeStroke(shapeEl, s) {
  const strokeDiv = shapeEl.querySelector('.shape__stroke');
  if (strokeDiv) {
    strokeDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" preserveAspectRatio="none">${buildStrokeSvgInner(s)}</svg>`;
  }
  const clip = shapeEl.querySelector('.shape__clip');
  if (clip) {
    const stroke = s.strokeWidth;
    clip.style.top = toEditorPx(stroke);
    clip.style.left = toEditorPx(stroke);
    clip.style.width = toEditorPx(s.w - 2 * stroke);
    clip.style.height = toEditorPx(s.h - 2 * stroke);
  }
}

function attachShapeResize(handleEl, s) {
  handleEl.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    handleEl.setPointerCapture(e.pointerId);
    const dir = handleEl.dataset.dir;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = s.x;
    const origY = s.y;
    const origW = s.w;
    const origH = s.h;
    const scale = editorScale();
    const shapeEl = handleEl.closest('.shape');
    const onMove = ev => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      if (dir.includes('e')) nw = Math.max(40, origW + dx);
      if (dir.includes('w')) { nw = Math.max(40, origW - dx); nx = origX + (origW - nw); }
      if (dir.includes('s')) nh = Math.max(40, origH + dy);
      if (dir.includes('n')) { nh = Math.max(40, origH - dy); ny = origY + (origH - nh); }
      if (s.type === 'circle') {
        const side = Math.max(nw, nh);
        if (dir.includes('w')) nx = origX + (origW - side);
        if (dir.includes('n')) ny = origY + (origH - side);
        nw = nh = side;
      }
      s.x = nx; s.y = ny; s.w = nw; s.h = nh;
      if (shapeEl) {
        shapeEl.style.left = toEditorPx(s.x);
        shapeEl.style.top = toEditorPx(s.y);
        shapeEl.style.width = toEditorPx(s.w);
        shapeEl.style.height = toEditorPx(s.h);
        // Re-bygg SVG-stroken og klipplaget så de speiler den nye størrelsen.
        updateShapeStroke(shapeEl, s);
      }
    };
    const onUp = () => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      scheduleSaveState();
      render();
    };
    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
  });
}

function attachShapeImgDrag(grabEl, s) {
  grabEl.addEventListener('pointerdown', e => {
    if (!s.image) return;
    e.preventDefault();
    e.stopPropagation();
    grabEl.setPointerCapture(e.pointerId);
    grabEl.classList.add('is-dragging');
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = s.image.x;
    const origY = s.image.y;
    const scale = editorScale();
    const onMove = ev => {
      s.image.x = origX + (ev.clientX - startX) / scale;
      s.image.y = origY + (ev.clientY - startY) / scale;
      const imgEl = grabEl.parentElement.querySelector('.shape__img');
      if (imgEl) {
        imgEl.style.left = toEditorPx(s.image.x);
        imgEl.style.top = toEditorPx(s.image.y);
      }
    };
    const onUp = () => {
      grabEl.removeEventListener('pointermove', onMove);
      grabEl.removeEventListener('pointerup', onUp);
      grabEl.classList.remove('is-dragging');
      scheduleSaveState();
    };
    grabEl.addEventListener('pointermove', onMove);
    grabEl.addEventListener('pointerup', onUp);
  });
  // Zoom indre bilde med scroll
  grabEl.addEventListener('wheel', e => {
    if (!s.image) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.05, Math.min(5, s.image.scale * (1 + delta)));
    // Zoom rundt boksens senter
    const cx = s.w / 2 - s.strokeWidth;
    const cy = s.h / 2 - s.strokeWidth;
    const oldW = s.image.naturalW * s.image.scale;
    const oldH = s.image.naturalH * s.image.scale;
    const newW = s.image.naturalW * newScale;
    const newH = s.image.naturalH * newScale;
    s.image.x -= (newW - oldW) / 2 * ((cx - (s.image.x + oldW / 2)) / oldW + 0.5);
    s.image.y -= (newH - oldH) / 2 * ((cy - (s.image.y + oldH / 2)) / oldH + 0.5);
    s.image.scale = newScale;
    render();
    scheduleSaveState();
  }, { passive: false });
}

// =============================================
//  Knapper og handlere
// =============================================
els.canvasSize.addEventListener('change', () => {
  state.canvasSize = els.canvasSize.value in CANVAS_SIZES ? els.canvasSize.value : '1920x1080';
  render();
  scheduleSaveState();
});

// Tabs for bg-src
els.bgTabUrl.addEventListener('click', () => {
  els.bgTabUrl.classList.add('is-active');
  els.bgTabFile.classList.remove('is-active');
  els.bgSrcUrl.style.display = '';
  els.bgSrcFile.style.display = 'none';
});
els.bgTabFile.addEventListener('click', () => {
  els.bgTabFile.classList.add('is-active');
  els.bgTabUrl.classList.remove('is-active');
  els.bgSrcFile.style.display = '';
  els.bgSrcUrl.style.display = 'none';
});

async function setBgFromImage(imgData) {
  const dim = canvasDim();
  // Auto-fit: skaler så bildet dekker canvas, sentrer
  const scaleW = dim.w / imgData.naturalW;
  const scaleH = dim.h / imgData.naturalH;
  const scale = Math.max(scaleW, scaleH);
  const w = imgData.naturalW * scale;
  const h = imgData.naturalH * scale;
  state.bg = {
    src: imgData.src,
    naturalW: imgData.naturalW,
    naturalH: imgData.naturalH,
    x: (dim.w - w) / 2,
    y: (dim.h - h) / 2,
    scale,
  };
  render();
  scheduleSaveState();
  setStatus('Bakgrunn lastet.');
}

els.bgLoadUrl.addEventListener('click', async () => {
  const url = (els.bgUrl.value || '').trim();
  if (!url) { setStatus('Lim inn en URL.', true); return; }
  setStatus('Laster bakgrunn…');
  try {
    const data = await loadImageData(url);
    await setBgFromImage(data);
  } catch (e) {
    setStatus('Kunne ikke laste bildet. Sjekk URL/CORS.', true);
  }
});

els.bgPickFile.addEventListener('click', () => els.bgFile.click());
els.bgFile.addEventListener('change', async () => {
  const file = els.bgFile.files[0];
  if (!file) return;
  els.bgFileName.textContent = file.name;
  setStatus('Laster fil…');
  try {
    const data = await loadImageData(file);
    await setBgFromImage(data);
  } catch (e) {
    setStatus('Kunne ikke lese fil.', true);
  }
});

// Legg til shape
function addShape(type) {
  const dim = canvasDim();
  const w = type === 'circle' ? 400 : 420;
  const h = type === 'circle' ? 400 : 580;
  const id = nextShapeId++;
  state.shapes.push({
    id, type,
    x: (dim.w - w) / 2,
    y: (dim.h - h) / 2,
    w, h,
    strokeWidth: 6,
    cornerRadius: type === 'circle' ? 0 : 20,
    shadowAlpha: 0.5,
    image: null,
  });
  state.selectedShapeId = id;
  render();
  scheduleSaveState();
}
els.addRectBtn.addEventListener('click', () => addShape('rect'));
els.addCircleBtn.addEventListener('click', () => addShape('circle'));

// Slett valgt shape
els.deleteShapeBtn.addEventListener('click', () => {
  if (state.selectedShapeId == null) return;
  state.shapes = state.shapes.filter(s => s.id !== state.selectedShapeId);
  state.selectedShapeId = null;
  render();
  scheduleSaveState();
});

// Shape-props.
// For at hjørnene skal være jevnt tykke hele veien rundt MÅ cornerRadius >= strokeWidth.
// Hvis radius er mindre enn stroke-tykkelse, klipper CSS-borderen den indre kanten
// til en skarp ende — det ser ujevnt ut. Vi clamper automatisk for å unngå det.
els.propStroke.addEventListener('input', () => {
  const s = state.shapes.find(x => x.id === state.selectedShapeId);
  if (!s) return;
  s.strokeWidth = +els.propStroke.value;
  els.propStrokeVal.textContent = s.strokeWidth + ' px';
  if (s.type === 'rect' && s.cornerRadius < s.strokeWidth) {
    s.cornerRadius = s.strokeWidth;
    els.propRadius.value = s.cornerRadius;
    els.propRadiusVal.textContent = s.cornerRadius + ' px';
  }
  render();
  scheduleSaveState();
});
els.propRadius.addEventListener('input', () => {
  const s = state.shapes.find(x => x.id === state.selectedShapeId);
  if (!s || s.type !== 'rect') return;
  const requested = +els.propRadius.value;
  s.cornerRadius = Math.max(s.strokeWidth, requested);
  els.propRadius.value = s.cornerRadius;
  els.propRadiusVal.textContent = s.cornerRadius + ' px';
  render();
  scheduleSaveState();
});
els.propShadow.addEventListener('input', () => {
  const s = state.shapes.find(x => x.id === state.selectedShapeId);
  if (!s) return;
  s.shadowAlpha = (+els.propShadow.value) / 100;
  els.propShadowVal.textContent = (+els.propShadow.value) + ' %';
  render();
  scheduleSaveState();
});

// Shape-bilde URL/fil
els.shapeTabUrl.addEventListener('click', () => {
  els.shapeTabUrl.classList.add('is-active');
  els.shapeTabFile.classList.remove('is-active');
  els.shapeSrcUrl.style.display = '';
  els.shapeSrcFile.style.display = 'none';
});
els.shapeTabFile.addEventListener('click', () => {
  els.shapeTabFile.classList.add('is-active');
  els.shapeTabUrl.classList.remove('is-active');
  els.shapeSrcFile.style.display = '';
  els.shapeSrcUrl.style.display = 'none';
});

async function setShapeImageFromData(imgData) {
  const s = state.shapes.find(x => x.id === state.selectedShapeId);
  if (!s) return;
  // Auto-fit: dekk hele boksens innside
  const innerW = s.w - 2 * s.strokeWidth;
  const innerH = s.h - 2 * s.strokeWidth;
  const scaleW = innerW / imgData.naturalW;
  const scaleH = innerH / imgData.naturalH;
  const scale = Math.max(scaleW, scaleH);
  const w = imgData.naturalW * scale;
  const h = imgData.naturalH * scale;
  s.image = {
    src: imgData.src,
    naturalW: imgData.naturalW,
    naturalH: imgData.naturalH,
    x: (innerW - w) / 2,
    y: (innerH - h) / 2,
    scale,
  };
  render();
  scheduleSaveState();
}
els.shapeLoadUrl.addEventListener('click', async () => {
  const url = (els.shapeUrl.value || '').trim();
  if (!url) { setStatus('Lim inn en URL.', true); return; }
  setStatus('Laster bilde…');
  try {
    const data = await loadImageData(url);
    await setShapeImageFromData(data);
    setStatus('Bilde lagt i boksen.');
  } catch (e) {
    setStatus('Kunne ikke laste bildet.', true);
  }
});
els.shapePickFile.addEventListener('click', () => els.shapeFile.click());
els.shapeFile.addEventListener('change', async () => {
  const file = els.shapeFile.files[0];
  if (!file) return;
  els.shapeFileName.textContent = file.name;
  try {
    const data = await loadImageData(file);
    await setShapeImageFromData(data);
  } catch (e) {
    setStatus('Kunne ikke lese fil.', true);
  }
});

// Fade-overlays
els.fadeTop.addEventListener('input', () => {
  state.fadeTop = (+els.fadeTop.value) / 100;
  els.fadeTopVal.textContent = (+els.fadeTop.value) + ' %';
  render();
  scheduleSaveState();
});
els.fadeBottom.addEventListener('input', () => {
  state.fadeBottom = (+els.fadeBottom.value) / 100;
  els.fadeBottomVal.textContent = (+els.fadeBottom.value) + ' %';
  render();
  scheduleSaveState();
});

// =============================================
//  Eksport — render alt på off-screen canvas
// =============================================
async function renderToCanvas() {
  const dim = canvasDim();
  const cnv = document.createElement('canvas');
  cnv.width = dim.w;
  cnv.height = dim.h;
  const ctx = cnv.getContext('2d');

  // Bakgrunn
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, dim.w, dim.h);

  if (state.bg) {
    const bgImg = await loadImg(state.bg.src);
    ctx.drawImage(
      bgImg,
      state.bg.x, state.bg.y,
      state.bg.naturalW * state.bg.scale,
      state.bg.naturalH * state.bg.scale
    );
  }

  // Fade-overlays — tegnes PÅ bakgrunn, men FØR shapes så boksene alltid
  // ligger over fade-en (samme stack-rekkefølge som i editoren).
  if (state.fadeTop > 0) {
    const grad = ctx.createLinearGradient(0, 0, 0, dim.h / 2);
    grad.addColorStop(0, `rgba(0,0,0,${state.fadeTop})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, dim.w, dim.h / 2);
  }
  if (state.fadeBottom > 0) {
    const grad = ctx.createLinearGradient(0, dim.h, 0, dim.h / 2);
    grad.addColorStop(0, `rgba(0,0,0,${state.fadeBottom})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, dim.h / 2, dim.w, dim.h / 2);
  }

  // Shapes — bygges på samme måte som SVG-editoren:
  //   1) klipp inn til shape, tegn bildet → image fyller inne i strek-en
  //   2) tegn strek (med drop-shadow) over → ramme rundt med skygge
  // INGEN egen white fill bak — det er ekvivalent med editoren der clip-en er transparent.
  for (const s of state.shapes) {
    ctx.save();

    // Klipp til innsiden av strek-en, tegn bildet
    if (s.image) {
      ctx.save();
      drawShapePath(ctx, s, true);  // inner path: bruker (cornerRadius - sw) som radius
      ctx.clip();
      const innerImg = await loadImg(s.image.src);
      const innerX = s.x + s.strokeWidth + s.image.x;
      const innerY = s.y + s.strokeWidth + s.image.y;
      ctx.drawImage(
        innerImg,
        innerX, innerY,
        s.image.naturalW * s.image.scale,
        s.image.naturalH * s.image.scale
      );
      ctx.restore();
    }

    // Hvit ramme med drop-shadow — ekvivalent med SVG-stroken i editoren
    // (som har filter: drop-shadow(...) på .shape__stroke).
    ctx.shadowColor = `rgba(0,0,0,${s.shadowAlpha})`;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 12;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawShapePathInset(ctx, s, s.strokeWidth / 2);
    ctx.stroke();

    ctx.restore();
  }

  return cnv;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// Tegn ytterkanten av shape (rektangel med radius, eller sirkel/ellipse).
// For inner=true brukes inner corner radius (cornerRadius - strokeWidth) som matcher
// inner edge av strek-en — samme som SVG-clip-en i editoren.
function drawShapePath(ctx, s, inner) {
  const inset = inner ? s.strokeWidth : 0;
  const x = s.x + inset;
  const y = s.y + inset;
  const w = s.w - 2 * inset;
  const h = s.h - 2 * inset;
  if (s.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    // BUG-FIX: for inner clip skal radius = cornerRadius - strokeWidth (indre kant av stroke).
    const baseR = inner ? Math.max(0, s.cornerRadius - s.strokeWidth) : s.cornerRadius;
    const r = Math.min(baseR, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

function drawShapePathInset(ctx, s, inset) {
  const x = s.x + inset;
  const y = s.y + inset;
  const w = s.w - 2 * inset;
  const h = s.h - 2 * inset;
  if (s.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    const r = Math.max(0, Math.min(s.cornerRadius - inset, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

async function downloadAs(format) {
  setStatus('Rendrer…');
  try {
    const cnv = await renderToCanvas();
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpg' ? 0.92 : undefined;
    cnv.toBlob(blob => {
      if (!blob) { setStatus('Eksport feilet.', true); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bildemal-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Lastet ned ${format.toUpperCase()}.`);
    }, mime, quality);
  } catch (e) {
    console.error(e);
    setStatus('Eksport feilet: ' + e.message, true);
  }
}

els.exportPngBtn.addEventListener('click', () => downloadAs('png'));
els.exportJpgBtn.addEventListener('click', () => downloadAs('jpg'));

els.copyClipBtn.addEventListener('click', async () => {
  setStatus('Rendrer for utklippstavle…');
  try {
    const cnv = await renderToCanvas();
    cnv.toBlob(async blob => {
      if (!blob) { setStatus('Eksport feilet.', true); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setStatus('Bilde kopiert til utklippstavle.');
      } catch (e) {
        setStatus('Kunne ikke kopiere: ' + e.message, true);
      }
    }, 'image/png');
  } catch (e) {
    setStatus('Eksport feilet.', true);
  }
});

// =============================================
//  Topbar + state-persistens
// =============================================
els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });

let isRestoring = false;
function serializeState() {
  // Vi lagrer ALT inkludert dataURL-er. Det kan bli stort hvis brukeren har store opplastinger,
  // men sikrer at projektet kan åpnes igjen senere. Live state-save (auto-save) er debounced.
  return JSON.parse(JSON.stringify(state));
}
async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    if (saved.canvasSize in CANVAS_SIZES) {
      state.canvasSize = saved.canvasSize;
      els.canvasSize.value = saved.canvasSize;
    }
    state.bg = saved.bg || null;
    state.shapes = Array.isArray(saved.shapes) ? saved.shapes : [];
    state.fadeTop = +saved.fadeTop || 0;
    state.fadeBottom = +saved.fadeBottom || 0;
    state.selectedShapeId = saved.selectedShapeId || null;
    // Oppdater nextShapeId basert på eksisterende
    nextShapeId = state.shapes.reduce((m, s) => Math.max(m, s.id + 1), 1);
    els.fadeTop.value = Math.round(state.fadeTop * 100);
    els.fadeTopVal.textContent = Math.round(state.fadeTop * 100) + ' %';
    els.fadeBottom.value = Math.round(state.fadeBottom * 100);
    els.fadeBottomVal.textContent = Math.round(state.fadeBottom * 100) + ' %';
    render();
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
  }, 500);
}

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
  const defaultName = `Bildemal ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) {
    setStatus('Lagret: «' + res.name + '».');
    await refreshProjectList();
  } else {
    setStatus('Kunne ikke lagre.', true);
  }
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) {
    await applyState(res.state);
    setStatus('Åpnet prosjekt.');
  }
});

// Reagér på resize for å re-rendre med ny editor-scale
window.addEventListener('resize', () => render());

// =============================================
//  Init
// =============================================
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
        if (res.ok && res.state) {
          await applyState(res.state);
          els.projectSelect.value = fileId;
          return;
        }
      }
    } catch (e) { console.error(e); }
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) await applyState(res.state);
  } catch (e) { console.error(e); }
})();
