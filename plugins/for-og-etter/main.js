// Faktisk Studio · Før og etter slider-plugin (MVP)

const PLUGIN_ID = 'for-og-etter';

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
  urlBefore:     document.getElementById('urlBefore'),
  urlAfter:      document.getElementById('urlAfter'),
  loadBtn:       document.getElementById('loadBtn'),
  imgBefore:     document.getElementById('imgBefore'),
  imgAfter:      document.getElementById('imgAfter'),
  clip:          document.getElementById('clip'),
  handle:        document.getElementById('handle'),
  preview:       document.getElementById('preview'),
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
  stage:         document.getElementById('stage'),
  tbSection:     document.getElementById('tbSection'),
  tbList:        document.getElementById('tbList'),
  addTbBtn:      document.getElementById('addTbBtn'),
};

const state = {
  urlBefore: '',
  urlAfter: '',
  loaded: false,
  sliderPos: 50,
  aspectRatio: 16/9,
  textBoxes: [],   // { id, text, x, y, variant: 'light'|'dark' }
};

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

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Kunne ikke laste: ' + url));
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

async function loadImages() {
  const urlB = els.urlBefore.value.trim();
  const urlA = els.urlAfter.value.trim();
  if (!urlB || !urlA) {
    setStatus('Lim inn URL til begge bildene.', true);
    return;
  }
  if (!isValidUrl(urlB) || !isValidUrl(urlA)) {
    setStatus('Ugyldig URL.', true);
    return;
  }

  setStatus('Laster bilder…');
  try {
    const [imgB, imgA] = await Promise.all([loadImage(urlB), loadImage(urlA)]);
    state.urlBefore = urlB;
    state.urlAfter = urlA;
    state.aspectRatio = imgA.naturalWidth / imgA.naturalHeight;
    state.loaded = true;
    els.imgBefore.src = urlB;
    els.imgAfter.src = urlA;
    els.empty.style.display = 'none';
    els.preview.style.display = 'flex';
    els.tbSection.style.display = 'flex';
    applyAspectRatio();
    updateClip();
    renderTextBoxes();
    updateExportButtons();
    setStatus(`Lastet · ${imgA.naturalWidth}×${imgA.naturalHeight}`);
    scheduleSaveState();
  } catch (e) {
    setStatus(e.message, true);
    state.loaded = false;
    updateExportButtons();
  }
}

function applyAspectRatio() {
  // Sett preview-elementet til riktig aspect ratio
  els.preview.style.aspectRatio = state.aspectRatio.toFixed(4);
  els.preview.style.maxHeight = '100%';
  els.preview.style.height = 'auto';
}

function updateClip() {
  els.clip.style.clipPath = `inset(0 ${100 - state.sliderPos}% 0 0)`;
  els.handle.style.left = state.sliderPos + '%';
}

// ============================================================
//  Tekstbokser
// ============================================================
function addTextBox() {
  const id = 'tb_' + Math.random().toString(36).slice(2, 7);
  const variant = state.textBoxes.length % 2 === 0 ? 'light' : 'dark';
  state.textBoxes.push({
    id,
    text: 'Tekstboks',
    x: 50,
    y: 30 + (state.textBoxes.length % 4) * 12,
    variant,
  });
  renderTextBoxes();
  scheduleSaveState();
}

function deleteTextBox(id) {
  state.textBoxes = state.textBoxes.filter(t => t.id !== id);
  renderTextBoxes();
  scheduleSaveState();
}

function toggleVariant(id) {
  const tb = state.textBoxes.find(t => t.id === id);
  if (!tb) return;
  tb.variant = tb.variant === 'light' ? 'dark' : 'light';
  renderTextBoxes();
  scheduleSaveState();
}

function renderTextBoxes() {
  // Sidebar-rader. Dark = overskrift (input), Light = beskrivelse (textarea + peker)
  els.tbList.innerHTML = '';
  state.textBoxes.forEach(tb => {
    const row = document.createElement('div');
    row.className = 'tb-row';
    const chip = tb.variant === 'dark'
      ? `<button class="tb-row__chip tb-row__chip--dark" data-act="toggle" data-id="${tb.id}" title="Bytt til beskrivelse">H</button>`
      : `<button class="tb-row__chip tb-row__chip--light" data-act="toggle" data-id="${tb.id}" title="Bytt til overskrift">¶</button>`;
    const field = tb.variant === 'dark'
      ? `<input class="tb-row__input" value="${escapeHtml(tb.text)}" data-id="${tb.id}" data-act="edit" placeholder="Overskrift">`
      : `<textarea class="tb-row__input" rows="2" data-id="${tb.id}" data-act="edit" placeholder="Lengre forklaring…">${escapeHtml(tb.text)}</textarea>`;
    const pointerBtn = tb.variant === 'light'
      ? `<button class="tb-row__del" data-act="pointer" data-id="${tb.id}" title="${tb.pointer ? 'Fjern peker' : 'Legg til peker'}">${tb.pointer ? '✗↗' : '↗'}</button>`
      : `<span></span>`;
    row.innerHTML = chip + field + pointerBtn + `<button class="tb-row__del" data-act="del" data-id="${tb.id}" title="Slett">×</button>`;
    els.tbList.appendChild(row);
  });
  els.tbList.onclick = e => {
    const act = e.target.dataset.act;
    const id = e.target.dataset.id;
    if (act === 'del') deleteTextBox(id);
    if (act === 'toggle') toggleVariant(id);
    if (act === 'pointer') togglePointer(id);
  };
  els.tbList.oninput = e => {
    if (e.target.dataset.act === 'edit') {
      const tb = state.textBoxes.find(t => t.id === e.target.dataset.id);
      if (tb) { tb.text = e.target.value; renderOverlays(); scheduleSaveState(); }
    }
  };
  renderOverlays();
}

function togglePointer(id) {
  const tb = state.textBoxes.find(t => t.id === id);
  if (!tb) return;
  if (tb.pointer) {
    tb.pointer = null;
  } else {
    // Plasser peker litt diagonalt fra boksen som start
    tb.pointer = {
      x: Math.min(95, tb.x + 20),
      y: Math.min(95, tb.y + 15),
    };
  }
  renderTextBoxes();
  scheduleSaveState();
}

function renderOverlays() {
  // Fjern gamle overlays + arrow-SVG
  els.preview.querySelectorAll('.tb-overlay, .tb-pointer-dot, .tb-arrow-svg').forEach(n => n.remove());

  // Tegn piler (SVG-overlay) først — under bokser
  const arrows = state.textBoxes.filter(tb => tb.variant === 'light' && tb.pointer);
  if (arrows.length) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tb-arrow-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;';
    arrows.forEach(tb => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', tb.x);
      line.setAttribute('y1', tb.y);
      line.setAttribute('x2', tb.pointer.x);
      line.setAttribute('y2', tb.pointer.y);
      line.setAttribute('stroke', '#D9D9D9');
      line.setAttribute('stroke-width', '0.4');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(line);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', tb.pointer.x);
      circle.setAttribute('cy', tb.pointer.y);
      circle.setAttribute('r', '1.2');
      circle.setAttribute('fill', '#D9D9D9');
      svg.appendChild(circle);
    });
    els.preview.appendChild(svg);
  }

  // Tekstbokser
  state.textBoxes.forEach(tb => {
    const el = document.createElement('div');
    el.className = 'tb-overlay tb-overlay--' + tb.variant;
    if (tb.variant === 'light') {
      el.style.whiteSpace = 'pre-wrap';
      el.style.maxWidth = '32%';
      el.style.fontWeight = 'normal';
    }
    el.textContent = tb.text;
    el.style.left = tb.x + '%';
    el.style.top = tb.y + '%';
    el.dataset.id = tb.id;
    attachOverlayDrag(el, tb, 'box');
    els.preview.appendChild(el);
  });

  // Draggable peker-dotter (for grå bokser med peker)
  arrows.forEach(tb => {
    const dot = document.createElement('div');
    dot.className = 'tb-pointer-dot';
    dot.style.cssText = `position:absolute;left:${tb.pointer.x}%;top:${tb.pointer.y}%;width:16px;height:16px;background:#D9D9D9;border-radius:50%;transform:translate(-50%,-50%);cursor:move;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);z-index:5;`;
    attachOverlayDrag(dot, tb, 'pointer');
    els.preview.appendChild(dot);
  });
}

function attachOverlayDrag(el, tb, kind) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = els.preview.getBoundingClientRect();
    const move = ev => {
      const x = Math.max(0, Math.min(100, ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * 100));
      const y = Math.max(0, Math.min(100, ((ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top) / rect.height * 100));
      if (kind === 'pointer') {
        tb.pointer.x = x;
        tb.pointer.y = y;
      } else {
        tb.x = x;
        tb.y = y;
      }
      renderOverlays();   // re-render så streken oppdateres
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      scheduleSaveState();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

els.addTbBtn.addEventListener('click', addTextBox);

// Drag-håndtering for slider
function startDrag(e) {
  e.preventDefault();
  const rect = els.preview.getBoundingClientRect();
  const move = (ev) => {
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    state.sliderPos = pct;
    updateClip();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
    scheduleSaveState();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', up);
  move(e);
}
els.handle.addEventListener('mousedown', startDrag);
els.handle.addEventListener('touchstart', startDrag, { passive: false });
els.preview.addEventListener('click', startDrag);

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

function buildEmbedSnippet() {
  const urlB = escapeHtml(state.urlBefore);
  const urlA = escapeHtml(state.urlAfter);
  const id = 'ffes-' + Math.random().toString(36).slice(2, 8);
  const aspect = state.aspectRatio.toFixed(4);
  const caption = (els.captionText.value || '').trim();
  const photographer = (els.photographer.value || '').trim();
  const hasCaption = caption || photographer;

  const captionParts = [];
  if (caption) captionParts.push(`
    <!-- ▶ BILDETEKST -->
    <figcaption itemprop="caption">${escapeHtml(caption)}</figcaption>`);
  if (photographer) captionParts.push(`
    <!-- ▶ FOTOGRAF / KILDE ("Foto: " kommer automatisk) -->
    <figcaption itemprop="author" data-byline-prefix="Foto:">${escapeHtml(photographer)}</figcaption>`);

  const innerCaption = hasCaption ? `

  <div class="caption ffes-caption" style="margin-top:0.5rem;box-sizing:border-box;">${captionParts.join('')}
  </div>` : '';

  const open = hasCaption ? `<figure style="margin:0;">` : '';
  const close = hasCaption ? `</figure>` : '';

  return `<!-- ============================================
     FAKTISK · FØR OG ETTER SLIDER
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <style>
    .ffes-container { container-type: inline-size; }
    @container (min-width: 1080px) {
      .ffes-container > .caption.ffes-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
      }
    }
    @media (max-width: 768px) {
      .ffes-container > .caption.ffes-caption {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
    }
    .ffes-stage-${id} {
      position: relative;
      width: 100%;
      aspect-ratio: ${aspect};
      border-radius: 8px;
      overflow: hidden;
      user-select: none;
      touch-action: none;
      background: #1a1a1a;
    }
    .ffes-stage-${id} img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
      user-select: none;
    }
    .ffes-stage-${id} .ffes-clip {
      position: absolute;
      inset: 0;
      clip-path: inset(0 50% 0 0);
      pointer-events: none;
      will-change: clip-path;
    }
    .ffes-stage-${id} .ffes-handle {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 4px;
      background: #fff;
      transform: translateX(-50%);
      cursor: ew-resize;
      z-index: 2;
      will-change: left;
    }
    .ffes-stage-${id} .ffes-knob {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: clamp(54px, 10cqw, 84px);
      height: clamp(26px, 4.6cqw, 40px);
      background: #fff;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }
    .ffes-stage-${id} .ffes-knob svg {
      width: 70%;
      height: 70%;
    }
    .ffes-stage-${id} .ffes-tb {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 0.3em 0.65em;
      border-radius: 5px;
      font-family: "Haas Grot Text 75 Bold", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-weight: bold;
      font-size: clamp(11px, 1.8cqw, 26px);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 3;
      line-height: 1.25;
    }
    .ffes-stage-${id} .ffes-tb--dark {
      background: #0050fc;
      color: #fff;
      white-space: nowrap;
    }
    .ffes-stage-${id} .ffes-tb--light {
      background: #D9D9D9;
      color: #212121;
      white-space: pre-wrap;
      max-width: 38%;
      font-weight: normal;
      font-size: clamp(10px, 1.5cqw, 20px);
    }
    .ffes-stage-${id} .ffes-arrow {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    }
    .ffes-stage-${id} .ffes-arrow line {
      stroke: #D9D9D9;
      stroke-width: 0.4;
      vector-effect: non-scaling-stroke;
    }
    .ffes-stage-${id} .ffes-arrow circle {
      fill: #D9D9D9;
    }
  </style>
  <!-- ▶ BILDER — bytt ut URL-ene under for å bruke andre bilder -->
  <div class="ffes-container">
    <div class="ffes-stage-${id}" id="${id}" aria-label="Før og etter sammenligning — dra slideren for å bytte mellom bildene">
      <img src="${urlA}" alt="" loading="lazy">
      <div class="ffes-clip">
        <img src="${urlB}" alt="" loading="lazy">
      </div>
      <div class="ffes-handle">
        <div class="ffes-knob">
          <svg viewBox="0 0 229.48 102.71" aria-hidden="true">
            <path fill="#0050fc" d="M225.98,45.29L149.18.95c-4.67-2.69-10.5.67-10.5,6.06v88.69c0,5.39,5.83,8.76,10.5,6.06l76.8-44.34c4.67-2.69,4.67-9.43,0-12.12Z"/>
            <path fill="#0050fc" d="M3.5,45.29L80.3.95c4.67-2.69,10.5.67,10.5,6.06v88.69c0,5.39-5.83,8.76-10.5,6.06L3.5,57.42c-4.67-2.69-4.67-9.43,0-12.12Z"/>
          </svg>
        </div>
      </div>${(() => {
        // SVG-overlay for piler (kun grå-bokser som har peker)
        const arrows = state.textBoxes.filter(tb => tb.variant === 'light' && tb.pointer);
        if (!arrows.length) return '';
        return `
      <svg class="ffes-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${arrows.map(tb => `
        <line x1="${tb.x.toFixed(2)}" y1="${tb.y.toFixed(2)}" x2="${tb.pointer.x.toFixed(2)}" y2="${tb.pointer.y.toFixed(2)}"/>
        <circle cx="${tb.pointer.x.toFixed(2)}" cy="${tb.pointer.y.toFixed(2)}" r="1.2"/>`).join('')}
      </svg>`;
      })()}${state.textBoxes.map(tb => `
      <!-- ▶ ${tb.variant === 'dark' ? 'OVERSKRIFT' : 'BESKRIVELSE'} — endre teksten her -->
      <div class="ffes-tb ffes-tb--${tb.variant}" style="left:${tb.x.toFixed(2)}%;top:${tb.y.toFixed(2)}%;">${escapeHtml(tb.text)}</div>`).join('')}
    </div>${innerCaption}
  </div>
${close}
<script>
(function(){
  var stage = document.getElementById('${id}');
  if(!stage) return;
  var clip = stage.querySelector('.ffes-clip');
  var handle = stage.querySelector('.ffes-handle');
  var pos = 50;
  function setPos(pct){
    pos = Math.max(0, Math.min(100, pct));
    clip.style.clipPath = 'inset(0 ' + (100-pos) + '% 0 0)';
    handle.style.left = pos + '%';
  }
  function move(ev){
    var rect = stage.getBoundingClientRect();
    var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    setPos((x / rect.width) * 100);
    if(ev.cancelable) ev.preventDefault();
  }
  function startDrag(e){
    move(e);
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, {passive:false});
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
  }
  function endDrag(){
    document.removeEventListener('mousemove', move);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
  }
  stage.addEventListener('mousedown', startDrag);
  stage.addEventListener('touchstart', startDrag, {passive:false});
})();
</script>
`;
}

function updateExportButtons() {
  els.copyEmbed.disabled = !state.loaded;
}

els.loadBtn.addEventListener('click', loadImages);

els.copyEmbed.addEventListener('click', async () => {
  if (!state.loaded) return;
  const snippet = buildEmbedSnippet();
  try {
    await window.faktisk.copyToClipboard(snippet);
    const orig = els.copyEmbed.textContent;
    els.copyEmbed.textContent = '✅ Kopiert!';
    setStatus('Embed-koden er kopiert.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 2000);
  } catch (e) {
    setStatus('Kunne ikke kopiere: ' + e.message, true);
  }
});

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// Arkivering
let isRestoring = false;
function serializeState() {
  return {
    urlBefore: els.urlBefore.value,
    urlAfter: els.urlAfter.value,
    sliderPos: state.sliderPos,
    textBoxes: state.textBoxes,
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
    if (saved.urlBefore && saved.urlAfter) {
      els.urlBefore.value = saved.urlBefore;
      els.urlAfter.value = saved.urlAfter;
      await loadImages();
      if (state.loaded && typeof saved.sliderPos === 'number') {
        state.sliderPos = saved.sliderPos;
        updateClip();
      }
      if (Array.isArray(saved.textBoxes)) {
        state.textBoxes = saved.textBoxes;
        renderTextBoxes();
      }
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
  els.urlBefore.addEventListener(ev, scheduleSaveState);
  els.urlAfter.addEventListener(ev, scheduleSaveState);
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
    || `Slider ${new Date().toLocaleDateString('no')}`;
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
  updateExportButtons();
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
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) await applyState(res.state);
  } catch (e) {}
})();
