// Bildesensur — masker (sirkel/oval/rektangel) med blur, pixelering eller
// svart felt over stillbilder. Samme sensur-tankegang som video-sensur,
// men rendret i canvas og eksportert i full oppløsning.
'use strict';

const PLUGIN_ID = window.PLUGIN_ID;

const els = {};
['imgUrl', 'imgLoadUrl', 'imgFile',
 'addMaskBtn', 'maskEmpty', 'maskList',
 'projectSelect', 'saveProjectBtn',
 'labradorBtn', 'copyClipBtn', 'exportPngBtn', 'exportJpgBtn',
 'status', 'backBtn', 'fullscreenBtn',
 'previewCanvas', 'canvasArea', 'canvasEmpty',
].forEach(id => { els[id] = document.getElementById(id); });

const setStatus = (msg, isError) => {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
};

// ── State ────────────────────────────────────────────────────────────────

const state = {
  img: null,        // { src, naturalW, naturalH, name }
  masks: [],        // { id, type: circle|ellipse|rect, mode: blur|pixel|black, cx, cy, w, h, strength }
  nextId: 1,
};
let selectedId = null;

const MODE_LABEL = { blur: 'Blur', pixel: 'Pixelering', black: 'Svart felt' };
const TYPE_LABEL = { circle: 'Sirkel', ellipse: 'Oval', rect: 'Rektangel' };

// ── Bildelasting ─────────────────────────────────────────────────────────

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
      img.onerror = () => reject(new Error('Kunne ikke laste bildet (sjekk URL/CORS).'));
      img.src = src;
    }).catch(reject);
  });
}

const imgCache = new Map();
function loadImg(src) {
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(src, img); res(img); };
    img.onerror = rej;
    img.src = src;
  });
}

function baseName() {
  if (!state.img) return 'bilde';
  if (state.img.name) return state.img.name.replace(/\.[^.]+$/, '');
  try {
    const seg = decodeURIComponent((state.img.src.split('/').pop() || '').split(/[?#]/)[0]);
    if (seg && !seg.startsWith('data:')) return seg.replace(/\.[^.]+$/, '');
  } catch (e) {}
  return 'bilde';
}

async function setImage(srcOrFile) {
  setStatus('Laster bilde…');
  try {
    const data = await loadImageData(srcOrFile);
    data.name = (typeof srcOrFile === 'string') ? '' : srcOrFile.name;
    state.img = data;
    await loadImg(data.src);
    els.previewCanvas.width = data.naturalW;
    els.previewCanvas.height = data.naturalH;
    els.previewCanvas.classList.add('has-image');
    els.canvasEmpty.style.display = 'none';
    setExportEnabled(true);
    scheduleRender();
    scheduleSaveState();
    setStatus('');
  } catch (err) { setStatus(err.message, true); }
}

function setExportEnabled(on) {
  ['addMaskBtn', 'labradorBtn', 'copyClipBtn', 'exportPngBtn', 'exportJpgBtn']
    .forEach(k => { els[k].disabled = !on; });
}

// ── Sensur-rendering ─────────────────────────────────────────────────────
//
// Hver maske rendres via en fullstørrelse effekt-canvas (blurret/pixelert/
// svart versjon) som maskes med en feather-kantet form (destination-in)
// og legges over originalen. Samme kode for forhåndsvisning og eksport.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function drawShape(ctx, m) {
  ctx.beginPath();
  if (m.type === 'rect') {
    ctx.rect(m.cx - m.w / 2, m.cy - m.h / 2, m.w, m.h);
  } else {
    ctx.ellipse(m.cx, m.cy, m.w / 2, m.h / 2, 0, 0, Math.PI * 2);
  }
}

// Blur drar inn gjennomsiktige piksler utenfor bildekanten — ved sterk blur
// blir en stripe på opptil radiusen halvgjennomsiktig, og originalen skinner
// gjennom. Løses ved å tegne bildet med strukket kant-fyll som margin før
// blurring. Memoiseres så drag/slider ikke re-blurrer i hver frame.
let blurMemo = { key: '', canvas: null };
function blurredImage(img, W, H, r) {
  const key = img.src.length + ':' + img.src.slice(-120) + '|' + W + 'x' + H + '|' + Math.round(r);
  if (blurMemo.key === key) return blurMemo.canvas;
  const M = Math.ceil(r * 2) + 2;
  const big = makeCanvas(W + 2 * M, H + 2 * M);
  const b = big.getContext('2d');
  b.drawImage(img, -M, -M, W + 2 * M, H + 2 * M);   // strukket versjon som kant-fyll
  b.drawImage(img, 0, 0, W, H, M, M, W, H);          // skarp original i midten
  const out = makeCanvas(W, H);
  const o = out.getContext('2d');
  o.filter = `blur(${r}px)`;
  o.drawImage(big, -M, -M);
  o.filter = 'none';
  blurMemo = { key, canvas: out };
  return out;
}

function applyMask(ctx, m, img, W, H) {
  const rel = Math.max(W, H) / 1600;                 // skaler effekter med oppløsningen
  const feather = m.mode === 'pixel'
    ? Math.max(2, Math.min(m.w, m.h) * 0.06)
    : Math.max(4, Math.min(m.w, m.h) * 0.22);

  const fx = makeCanvas(W, H);
  const fctx = fx.getContext('2d');
  if (m.mode === 'blur') {
    const r = Math.max(3, (6 + m.strength * 54) * rel);
    fctx.drawImage(blurredImage(img, W, H, r), 0, 0);
  } else if (m.mode === 'pixel') {
    const block = Math.max(4, Math.round((8 + m.strength * 56) * rel));
    const sw = Math.max(1, Math.round(W / block));
    const sh = Math.max(1, Math.round(H / block));
    const small = makeCanvas(sw, sh);
    small.getContext('2d').drawImage(img, 0, 0, sw, sh);
    fctx.imageSmoothingEnabled = false;
    fctx.drawImage(small, 0, 0, sw, sh, 0, 0, W, H);
  } else { // black
    fctx.fillStyle = '#000';
    fctx.fillRect(0, 0, W, H);
  }

  // Alfamaske med myk kant. Sirkel/oval bruker en ekte radiell gradient:
  // full dekning i kjernen, smoothstep-fade som slutter nøyaktig på formens
  // kant — bluren under beholder full styrke. Rektangel bruker inset + blur
  // av formen, så faden holder seg innenfor kanten.
  const mk = makeCanvas(W, H);
  const mctx = mk.getContext('2d');
  mctx.fillStyle = '#fff';
  if (m.type === 'rect') {
    mctx.filter = `blur(${feather * 0.5}px)`;
    const inner = { ...m, w: Math.max(6, m.w - feather), h: Math.max(6, m.h - feather) };
    drawShape(mctx, inner);
    mctx.fill();
    mctx.filter = 'none';
    drawShape(mctx, { ...m, w: Math.max(4, m.w - feather * 2), h: Math.max(4, m.h - feather * 2) });
    mctx.fill();
  } else {
    const rx = m.w / 2, ry = m.h / 2;
    const frac = Math.min(0.95, feather / Math.min(rx, ry));
    const start = 1 - frac;
    mctx.save();
    mctx.translate(m.cx, m.cy);
    mctx.scale(rx, ry);                     // gjør gradienten elliptisk for ovaler
    const g = mctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(start, 'rgba(255,255,255,1)');
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const a = 1 - t * t * (3 - 2 * t);    // smoothstep ut mot kanten
      g.addColorStop(start + frac * t, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    }
    g.addColorStop(1, 'rgba(255,255,255,0)');
    mctx.fillStyle = g;
    mctx.fillRect(-1, -1, 2, 2);
    mctx.restore();
  }

  fctx.globalCompositeOperation = 'destination-in';
  fctx.drawImage(mk, 0, 0);

  ctx.drawImage(fx, 0, 0);
}

async function renderToCanvas() {
  if (!state.img) throw new Error('Ingen bilde lastet.');
  const img = await loadImg(state.img.src);
  const W = state.img.naturalW, H = state.img.naturalH;
  const cnv = makeCanvas(W, H);
  const ctx = cnv.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  state.masks.forEach(m => applyMask(ctx, m, img, W, H));
  return cnv;
}

function handleSize(W) { return Math.max(10, Math.round(W / 70)); }

async function render() {
  if (!state.img) return;
  const img = await loadImg(state.img.src);
  const W = state.img.naturalW, H = state.img.naturalH;
  const ctx = els.previewCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  state.masks.forEach(m => applyMask(ctx, m, img, W, H));

  // Guides (kun forhåndsvisning)
  const hs = handleSize(W);
  state.masks.forEach(m => {
    const sel = m.id === selectedId;
    ctx.save();
    ctx.lineWidth = Math.max(1.5, W / 900);
    ctx.setLineDash(sel ? [] : [6, 5]);
    ctx.strokeStyle = sel ? '#0050FC' : 'rgba(255,255,255,0.85)';
    drawShape(ctx, m);
    ctx.stroke();
    if (sel) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#0050FC';
      ctx.fillRect(m.cx + m.w / 2 - hs / 2, m.cy + m.h / 2 - hs / 2, hs, hs);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(m.cx + m.w / 2 - hs / 2, m.cy + m.h / 2 - hs / 2, hs, hs);
    }
    ctx.restore();
  });
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render().catch(console.error); });
}

// ── Maskeliste (sidebar) ─────────────────────────────────────────────────

function maskById(id) { return state.masks.find(m => m.id === id); }

function addMask() {
  if (!state.img) return;
  const { naturalW: W, naturalH: H } = state.img;
  const size = Math.round(Math.min(W, H) * 0.28);
  const n = state.masks.length;
  const m = {
    id: state.nextId++,
    type: 'circle',
    mode: 'blur',
    cx: Math.round(W / 2 + (n % 3 - 1) * size * 0.6),
    cy: Math.round(H / 2 + (Math.floor(n / 3) % 3 - 1) * size * 0.6),
    w: size, h: size,
    strength: 0.5,
  };
  state.masks.push(m);
  selectedId = m.id;
  rebuildMaskList();
  scheduleRender();
  scheduleSaveState();
}

function removeMask(id) {
  state.masks = state.masks.filter(m => m.id !== id);
  if (selectedId === id) selectedId = null;
  rebuildMaskList();
  scheduleRender();
  scheduleSaveState();
}

function rebuildMaskList() {
  els.maskList.innerHTML = '';
  els.maskEmpty.style.display = state.masks.length ? 'none' : '';
  state.masks.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mask-row' + (m.id === selectedId ? ' selected' : '');

    const top = document.createElement('div');
    top.className = 'mask-row__top';

    const name = document.createElement('span');
    name.className = 'mask-row__name';
    name.textContent = 'Maske ' + (i + 1);
    name.addEventListener('click', () => { selectedId = m.id; rebuildMaskList(); scheduleRender(); });

    const typeSel = document.createElement('select');
    typeSel.className = 'project-select';
    Object.entries(TYPE_LABEL).forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      typeSel.appendChild(o);
    });
    typeSel.value = m.type;
    typeSel.addEventListener('change', () => {
      m.type = typeSel.value;
      if (m.type === 'circle') m.h = m.w;
      selectedId = m.id;
      rebuildMaskList(); scheduleRender(); scheduleSaveState();
    });

    const modeSel = document.createElement('select');
    modeSel.className = 'project-select';
    Object.entries(MODE_LABEL).forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      modeSel.appendChild(o);
    });
    modeSel.value = m.mode;
    modeSel.addEventListener('change', () => {
      m.mode = modeSel.value;
      selectedId = m.id;
      rebuildMaskList(); scheduleRender(); scheduleSaveState();
    });

    const del = document.createElement('button');
    del.className = 'mask-row__del';
    del.type = 'button';
    del.title = 'Fjern maske';
    del.textContent = '✕';
    del.addEventListener('click', () => removeMask(m.id));

    top.appendChild(name);
    top.appendChild(typeSel);
    top.appendChild(modeSel);
    top.appendChild(del);
    row.appendChild(top);

    if (m.mode !== 'black') {
      const sr = document.createElement('div');
      sr.className = 'slider-row';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = 'Styrke';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0; slider.max = 100;
      slider.value = Math.round(m.strength * 100);
      slider.addEventListener('input', () => {
        m.strength = +slider.value / 100;
        scheduleRender(); scheduleSaveState();
      });
      sr.appendChild(lbl);
      sr.appendChild(slider);
      row.appendChild(sr);
    }

    els.maskList.appendChild(row);
  });
}

// ── Canvas-interaksjon ───────────────────────────────────────────────────

function canvasPoint(e) {
  const r = els.previewCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * els.previewCanvas.width / r.width,
    y: (e.clientY - r.top) * els.previewCanvas.height / r.height,
  };
}

function insideMask(p, m) {
  const dx = p.x - m.cx, dy = p.y - m.cy;
  if (m.type === 'rect') return Math.abs(dx) <= m.w / 2 && Math.abs(dy) <= m.h / 2;
  const rx = m.w / 2, ry = m.h / 2;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

function maskAt(p) {
  for (let i = state.masks.length - 1; i >= 0; i--) {
    if (insideMask(p, state.masks[i])) return state.masks[i];
  }
  return null;
}

function onHandle(p) {
  const m = maskById(selectedId);
  if (!m || !state.img) return null;
  const hs = handleSize(state.img.naturalW) * 1.6;
  const hx = m.cx + m.w / 2, hy = m.cy + m.h / 2;
  return (Math.abs(p.x - hx) < hs && Math.abs(p.y - hy) < hs) ? m : null;
}

els.previewCanvas.addEventListener('pointerdown', e => {
  if (!state.img) return;
  const p = canvasPoint(e);
  let mode = null;
  let target = onHandle(p);
  if (target) {
    mode = 'resize';
  } else {
    target = maskAt(p);
    if (target) { mode = 'move'; selectedId = target.id; rebuildMaskList(); }
    else { selectedId = null; rebuildMaskList(); scheduleRender(); return; }
  }
  e.preventDefault();
  const start = p;
  const orig = { cx: target.cx, cy: target.cy, w: target.w, h: target.h };
  els.previewCanvas.classList.add('dragging');
  scheduleRender();

  function onMove(ev) {
    const q = canvasPoint(ev);
    if (mode === 'move') {
      target.cx = orig.cx + (q.x - start.x);
      target.cy = orig.cy + (q.y - start.y);
    } else {
      let nw = Math.max(24, (q.x - target.cx) * 2);
      let nh = Math.max(24, (q.y - target.cy) * 2);
      if (target.type === 'circle') { nw = nh = Math.max(nw, nh); }
      target.w = nw; target.h = nh;
    }
    scheduleRender();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    els.previewCanvas.classList.remove('dragging');
    scheduleSaveState();
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
});

els.previewCanvas.addEventListener('wheel', e => {
  if (!state.img) return;
  const p = canvasPoint(e);
  const m = maskAt(p) || maskById(selectedId);
  if (!m || !insideMask(p, m)) return;
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.05 : 1 / 1.05;
  if (e.shiftKey && m.type !== 'circle') {
    m.h = Math.max(24, m.h * f);
  } else {
    m.w = Math.max(24, m.w * f);
    m.h = Math.max(24, m.h * f);
  }
  scheduleRender();
  scheduleSaveState();
}, { passive: false });

window.addEventListener('keydown', e => {
  if (['Delete', 'Backspace'].includes(e.key) && selectedId
      && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    removeMask(selectedId);
  }
});

// ── Sidebar-kontroller ───────────────────────────────────────────────────

els.imgLoadUrl.addEventListener('click', () => {
  const u = els.imgUrl.value.trim();
  if (u) setImage(u);
});
els.imgUrl.addEventListener('keydown', e => { if (e.key === 'Enter') els.imgLoadUrl.click(); });
els.imgFile.addEventListener('change', function () { if (this.files[0]) setImage(this.files[0]); });
els.addMaskBtn.addEventListener('click', addMask);

// ── Eksport ──────────────────────────────────────────────────────────────

async function downloadAs(format) {
  setStatus('Rendrer…');
  try {
    const cnv = await renderToCanvas();
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    cnv.toBlob(blob => {
      if (!blob) { setStatus('Eksport feilet.', true); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName()}-sensurert.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Lastet ned ${format.toUpperCase()}.`);
    }, mime, format === 'jpg' ? 0.92 : undefined);
  } catch (e) { setStatus('Eksport feilet: ' + e.message, true); }
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
        setStatus('Sensurert bilde kopiert til utklippstavlen.');
      } catch (e) { setStatus('Kunne ikke kopiere: ' + e.message, true); }
    }, 'image/png');
  } catch (e) { setStatus('Eksport feilet.', true); }
});

els.labradorBtn.addEventListener('click', async () => {
  if (!window.faktisk.labradorUploadData) {
    setStatus('Krever Faktisk Studio 0.6.3 eller nyere.', true);
    return;
  }
  els.labradorBtn.disabled = true;
  setStatus('Rendrer og laster opp til Labrador…');
  try {
    const cnv = await renderToCanvas();
    const dataUrl = cnv.toDataURL('image/jpeg', 0.92);
    const fileName = `${baseName()}-sensurert.jpg`;
    let res = await window.faktisk.labradorUploadData({ fileName, dataUrl });
    if (res.loggedIn === false) {
      setStatus('Logg inn i vinduet som åpnes…');
      const st = await window.faktisk.labradorConnect();
      if (!st.loggedIn) { setStatus('Fikk ikke gyldig innlogging.', true); return; }
      res = await window.faktisk.labradorUploadData({ fileName, dataUrl });
    }
    if (res.ok && res.url) {
      try { await window.faktisk.copyToClipboard(res.url); } catch (e) {}
      if (window.faktisk.recentFileAdd) {
        window.faktisk.recentFileAdd({ url: res.url, type: 'image', pluginId: PLUGIN_ID }).catch(() => {});
      }
      setStatus('Lastet opp «' + fileName + '» ✓ — URL kopiert.');
    } else if (res.ok) {
      setStatus('Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.', true);
    } else {
      setStatus('Opplasting feilet: ' + (res.error || 'ukjent feil'), true);
    }
  } catch (e) {
    setStatus('Opplasting feilet: ' + e.message, true);
  } finally {
    els.labradorBtn.disabled = false;
  }
});

// ── Topbar + persistens ──────────────────────────────────────────────────

els.backBtn.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.fullscreenBtn.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });

let isRestoring = false;
function serializeState() {
  return JSON.parse(JSON.stringify({
    img: state.img, masks: state.masks, nextId: state.nextId,
  }));
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    state.masks = Array.isArray(saved.masks) ? saved.masks : [];
    state.nextId = saved.nextId || (Math.max(0, ...state.masks.map(m => m.id)) + 1);
    selectedId = null;
    if (saved.img && saved.img.src) {
      state.img = saved.img;
      try {
        await loadImg(state.img.src);
        els.previewCanvas.width = state.img.naturalW;
        els.previewCanvas.height = state.img.naturalH;
        els.previewCanvas.classList.add('has-image');
        els.canvasEmpty.style.display = 'none';
        setExportEnabled(true);
        if (!state.img.name) els.imgUrl.value = state.img.src.startsWith('data:') ? '' : state.img.src;
      } catch (e) {
        setStatus('Kunne ikke gjenåpne bildet (sjekk URL).', true);
        state.img = null;
      }
    }
    rebuildMaskList();
    scheduleRender();
  } finally { isRestoring = false; }
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

els.saveProjectBtn.addEventListener('click', async () => {
  const defaultName = baseName() !== 'bilde'
    ? baseName().slice(0, 40)
    : `Bildesensur ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) { setStatus('Lagret: «' + res.name + '».'); await refreshProjectList(); }
  else setStatus('Kunne ikke lagre: ' + (res.error || 'ukjent feil'), true);
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) { await applyState(res.state); setStatus('Åpnet «' + res.name + '».'); }
});

(async function init() {
  rebuildMaskList();
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
