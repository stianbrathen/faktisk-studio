// Faktisk Studio · Bilde med markering-plugin (MVP)

const PLUGIN_ID = 'bilde-markering';

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
  urlImage:      document.getElementById('urlImage'),
  loadBtn:       document.getElementById('loadBtn'),
  imgMain:       document.getElementById('imgMain'),
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
  addTbBtnDark:  document.getElementById('addTbBtnDark'),
  addTbBtnLight: document.getElementById('addTbBtnLight'),
  markerSection: document.getElementById('markerSection'),
  markList:      document.getElementById('markList'),
  addMarkFilled: document.getElementById('addMarkFilled'),
  addMarkOpen:   document.getElementById('addMarkOpen'),
};

const state = {
  url: '',
  loaded: false,
  aspectRatio: 16/9,
  textBoxes: [],   // { id, text, x, y, variant: 'light'|'dark', pointer? }
  markers: [],     // { id, x, y, radius, style: 'filled'|'open' }
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

async function loadMainImage() {
  const url = els.urlImage.value.trim();
  if (!url) { setStatus('Lim inn URL til bildet.', true); return; }
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
    els.tbSection.style.display = 'flex';
    els.markerSection.style.display = 'flex';
    applyAspectRatio();
    renderTextBoxes();
    renderMarkers();
    updateExportButtons();
    setStatus(`Lastet · ${img.naturalWidth}×${img.naturalHeight}`);
    scheduleSaveState();
  } catch (e) {
    setStatus(e.message, true);
    state.loaded = false;
    updateExportButtons();
  }
}

function applyAspectRatio() {
  els.preview.style.aspectRatio = state.aspectRatio.toFixed(4);
  els.preview.style.maxHeight = '100%';
  els.preview.style.height = 'auto';
}

// ============================================================
//  Tekstbokser
// ============================================================
function addTextBox(variant) {
  const id = 'tb_' + Math.random().toString(36).slice(2, 7);
  const v = (variant === 'light' || variant === 'dark') ? variant : 'dark';
  state.textBoxes.push({
    id,
    text: v === 'dark' ? 'Overskrift' : 'Beskrivelse her…',
    x: 50,
    y: 30 + (state.textBoxes.length % 4) * 12,
    variant: v,
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

function togglePointer(id) {
  const tb = state.textBoxes.find(t => t.id === id);
  if (!tb) return;
  if (tb.pointer) {
    tb.pointer = null;
  } else {
    tb.pointer = {
      x: Math.min(95, tb.x + 20),
      y: Math.min(95, tb.y + 15),
    };
  }
  renderTextBoxes();
  scheduleSaveState();
}

function renderTextBoxes() {
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
    const pointerBtn = `<button class="tb-row__btn ${tb.pointer ? 'tb-row__btn--active' : ''}" data-act="pointer" data-id="${tb.id}" title="${tb.pointer ? 'Fjern peker' : 'Legg til peker'}">&gt;</button>`;
    row.innerHTML = chip + field + pointerBtn + `<button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${tb.id}" title="Slett">×</button>`;
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

// ============================================================
//  Markeringer (frittstående sirkler — fylt eller åpen ring)
// ============================================================
function addMarker(style) {
  const id = 'm_' + Math.random().toString(36).slice(2, 7);
  const s = style === 'open' ? 'open' : 'filled';
  state.markers.push({
    id,
    x: 50,
    y: 50 + (state.markers.length % 3) * 8,
    radius: 5,    // prosent av bildebredden
    style: s,
  });
  renderMarkers();
  scheduleSaveState();
}

function deleteMarker(id) {
  state.markers = state.markers.filter(m => m.id !== id);
  renderMarkers();
  scheduleSaveState();
}

function toggleMarkerStyle(id) {
  const m = state.markers.find(m => m.id === id);
  if (!m) return;
  m.style = m.style === 'filled' ? 'open' : 'filled';
  renderMarkers();
  scheduleSaveState();
}

function renderMarkers() {
  els.markList.innerHTML = '';
  state.markers.forEach(m => {
    const row = document.createElement('div');
    row.className = 'tb-row';
    const chip = m.style === 'filled'
      ? `<button class="tb-row__chip tb-row__chip--dark" data-act="toggleMark" data-id="${m.id}" title="Bytt til ring">●</button>`
      : `<button class="tb-row__chip tb-row__chip--light" data-act="toggleMark" data-id="${m.id}" title="Bytt til fylt prikk">○</button>`;
    const sizeLabel = `<span class="tb-row__input" style="display:flex;align-items:center;justify-content:center;font-size:11px;color:#666;background:#D4D4D4;height:24px;">${m.radius.toFixed(1)}%</span>`;
    row.innerHTML = chip + sizeLabel +
      `<span></span>` +
      `<button class="tb-row__btn tb-row__btn--del" data-act="delMark" data-id="${m.id}" title="Slett">×</button>`;
    els.markList.appendChild(row);
  });
  els.markList.onclick = e => {
    const act = e.target.dataset.act;
    const id = e.target.dataset.id;
    if (act === 'delMark') deleteMarker(id);
    if (act === 'toggleMark') toggleMarkerStyle(id);
  };
  renderOverlays();
}

// ============================================================
//  Renderer alle overlays på preview (tekstbokser, piler, markeringer)
// ============================================================
function renderOverlays() {
  // Fjern alle gamle overlays + arrow + sirkler + markeringer
  els.preview.querySelectorAll('.tb-overlay, .tb-pointer-circle, .tb-arrow-svg, .bm-marker').forEach(n => n.remove());
  const clipper = els.preview.querySelector('.slider-clipper');
  if (!clipper) return;

  // 1) Peker-piler fra tekstbokser
  const arrows = state.textBoxes.filter(tb => tb.pointer);
  if (arrows.length) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('tb-arrow-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;';
    arrows.forEach(tb => {
      const color = tb.variant === 'dark' ? '#0050fc' : '#fff';
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', tb.x);
      line.setAttribute('y1', tb.y);
      line.setAttribute('x2', tb.pointer.x);
      line.setAttribute('y2', tb.pointer.y);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2.2');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(line);
    });
    clipper.appendChild(svg);

    arrows.forEach(tb => {
      const wrap = document.createElement('div');
      wrap.className = 'tb-pointer-circle tb-pointer-circle--' + tb.variant;
      wrap.style.left = tb.pointer.x + '%';
      wrap.style.top = tb.pointer.y + '%';
      wrap.innerHTML = '<span class="tb-pointer-pulse"></span><span class="tb-pointer-dot-inner"></span>';
      clipper.appendChild(wrap);
    });
  }

  // 2) Frittstående markeringer (fylte sirkler eller åpne ringer)
  state.markers.forEach(m => {
    const wrap = document.createElement('div');
    wrap.className = 'bm-marker bm-marker--' + m.style;
    wrap.style.left = m.x + '%';
    wrap.style.top = m.y + '%';
    wrap.style.width = (m.radius * 2) + '%';
    wrap.style.aspectRatio = '1';
    wrap.dataset.id = m.id;
    // Skalerings-håndtak (nedre-høyre)
    const handle = document.createElement('div');
    handle.className = 'bm-marker__scale';
    handle.title = 'Dra for å skalere';
    wrap.appendChild(handle);
    attachMarkerDrag(wrap, m, 'move');
    attachMarkerDrag(handle, m, 'scale');
    clipper.appendChild(wrap);
  });

  // 3) Tekstbokser — UTENFOR clipper, kan stikke ut
  state.textBoxes.forEach(tb => {
    const el = document.createElement('div');
    el.className = 'tb-overlay tb-overlay--' + tb.variant;
    el.textContent = tb.text;
    el.style.left = tb.x + '%';
    el.style.top = tb.y + '%';
    el.dataset.id = tb.id;
    attachOverlayDrag(el, tb, 'box');
    els.preview.appendChild(el);
  });

  // 4) Gjør peker-sirklene dragbare
  els.preview.querySelectorAll('.tb-pointer-circle').forEach((dot, idx) => {
    attachOverlayDrag(dot, arrows[idx], 'pointer');
  });
}

// ============================================================
//  Drag-håndtering for tekstbokser + peker-prikker
// ============================================================
function attachOverlayDrag(el, tb, kind) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = els.preview.getBoundingClientRect();
    const boxRect0 = el.getBoundingClientRect();
    const halfPctX = rect.width > 0 ? (boxRect0.width / 2) / rect.width * 100 : 0;
    const dotRadPctX = rect.width > 0 ? 14 / rect.width * 100 : 0;
    const dotRadPctY = rect.height > 0 ? 14 / rect.height * 100 : 0;
    const move = ev => {
      let x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * 100;
      let y = ((ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top) / rect.height * 100;
      if (kind === 'pointer') {
        tb.pointer.x = Math.max(dotRadPctX, Math.min(100 - dotRadPctX, x));
        tb.pointer.y = Math.max(dotRadPctY, Math.min(100 - dotRadPctY, y));
      } else {
        tb.x = Math.max(halfPctX, Math.min(100 - halfPctX, x));
        tb.y = Math.max(0, Math.min(100, y));
      }
      renderOverlays();
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

// ============================================================
//  Drag-håndtering for markeringer (move + scale)
// ============================================================
function attachMarkerDrag(el, m, kind) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect = els.preview.getBoundingClientRect();
    const cx0 = m.x;
    const cy0 = m.y;
    const r0 = m.radius;
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const move = ev => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dxPct = (cx - startX) / rect.width * 100;
      const dyPct = (cy - startY) / rect.height * 100;
      if (kind === 'scale') {
        // Bruk maksimal akse for jevn skalering
        const newR = Math.max(1, Math.min(40, r0 + Math.max(dxPct, dyPct)));
        m.radius = newR;
      } else {
        // Hold senter innenfor [r, 100-r]
        const r = m.radius;
        m.x = Math.max(r, Math.min(100 - r, cx0 + dxPct));
        m.y = Math.max(r, Math.min(100 - r, cy0 + dyPct));
      }
      renderMarkers();
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

els.addTbBtnDark.addEventListener('click', () => addTextBox('dark'));
els.addTbBtnLight.addEventListener('click', () => addTextBox('light'));
els.addMarkFilled.addEventListener('click', () => addMarker('filled'));
els.addMarkOpen.addEventListener('click', () => addMarker('open'));

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

// ============================================================
//  Embed-output
// ============================================================
function buildEmbedSnippet() {
  const url = escapeHtml(state.url);
  const id = 'bmrk-' + Math.random().toString(36).slice(2, 8);
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

  <div class="caption bmrk-caption" style="margin-top:1.2rem;box-sizing:border-box;">${captionParts.join('')}
  </div>` : '';

  const open = hasCaption ? `<figure style="margin:0;">` : '';
  const close = hasCaption ? `</figure>` : '';

  return `<!-- ============================================
     FAKTISK · BILDE MED MARKERING
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <style>
    .bmrk-container { container-type: inline-size; padding: 0.7rem 0; }
    @container (min-width: 1080px) {
      .bmrk-container > .caption.bmrk-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
      }
    }
    @media (max-width: 768px) {
      .bmrk-container > .caption.bmrk-caption {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
    }
    .bmrk-stage-${id} {
      position: relative;
      width: 100%;
      aspect-ratio: ${aspect};
      user-select: none;
    }
    .bmrk-stage__clip-${id} {
      position: absolute;
      inset: 0;
      overflow: hidden;
      border-radius: 8px;
      background: #1a1a1a;
    }
    .bmrk-stage-${id} img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .bmrk-stage-${id} .bmrk-tb {
      position: absolute;
      transform: translate(-50%, -50%);
      padding: 0.3em 0.65em;
      border-radius: 5px;
      font-family: "Haas Grot Text 75 Bold", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-weight: bold;
      font-size: clamp(14px, 1.8cqw, 26px);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 3;
      line-height: 1.25;
    }
    .bmrk-stage-${id} .bmrk-tb--dark {
      background: #0050fc;
      color: #fff;
      white-space: nowrap;
    }
    .bmrk-stage-${id} .bmrk-tb--light {
      background: #D9D9D9;
      color: #212121;
      white-space: pre-wrap;
      max-width: 38%;
      font-weight: normal;
      font-size: clamp(13px, 1.6cqw, 22px);
    }
    .bmrk-tb-area-${id} {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 4;
    }
    .bmrk-tb-area-${id} > * { pointer-events: auto; }
    @media (max-width: 768px) {
      .bmrk-stage-${id} > .bmrk-tb-area-${id} { inset: 0 1rem; }
    }
    @media (max-width: 600px) {
      .bmrk-stage-${id} .bmrk-tb--light, .bmrk-stage-${id} .bmrk-tb--dark {
        max-width: 60%;
      }
      .bmrk-stage-${id} .bmrk-tb--dark { white-space: normal; }
    }
    .bmrk-stage-${id} .bmrk-arrow {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    }
    .bmrk-stage-${id} .bmrk-arrow line {
      stroke-width: 2.2;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .bmrk-stage-${id} .bmrk-dot {
      position: absolute;
      width: clamp(16px, 2.2cqw, 28px);
      height: clamp(16px, 2.2cqw, 28px);
      transform: translate(-50%, -50%);
      z-index: 3;
      pointer-events: none;
      --dot-color: #fff;
    }
    .bmrk-stage-${id} .bmrk-dot::before,
    .bmrk-stage-${id} .bmrk-dot::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: var(--dot-color);
    }
    .bmrk-stage-${id} .bmrk-dot::before {
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      z-index: 2;
    }
    .bmrk-stage-${id} .bmrk-dot::after {
      opacity: 0.55;
      animation: bmrk-pulse-${id} 1.8s ease-out infinite;
      z-index: 1;
    }
    @keyframes bmrk-pulse-${id} {
      0%   { transform: scale(1);   opacity: 0.55; }
      80%  { transform: scale(2.6); opacity: 0;    }
      100% { transform: scale(2.6); opacity: 0;    }
    }
    /* Markeringer — frittstående sirkler */
    .bmrk-stage-${id} .bmrk-marker {
      position: absolute;
      transform: translate(-50%, -50%);
      aspect-ratio: 1;
      pointer-events: none;
      z-index: 2;
    }
    .bmrk-stage-${id} .bmrk-marker--filled {
      background: #0050fc;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .bmrk-stage-${id} .bmrk-marker--open {
      border: clamp(3px, 0.5cqw, 5px) solid #0050fc;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
  </style>
  <!-- ▶ BILDE — bytt ut URL-en under for å bruke et annet bilde -->
  <div class="bmrk-container">
    <div class="bmrk-stage-${id}" id="${id}" aria-label="Bilde med markeringer">
      <div class="bmrk-stage__clip-${id}">
        <img src="${url}" alt="" loading="lazy">${(() => {
          const arrows = state.textBoxes.filter(tb => tb.pointer);
          if (!arrows.length) return '';
          const colorOf = tb => tb.variant === 'dark' ? '#0050fc' : '#fff';
          const lines = `
        <svg class="bmrk-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${arrows.map(tb => `
          <line x1="${tb.x.toFixed(2)}" y1="${tb.y.toFixed(2)}" x2="${tb.pointer.x.toFixed(2)}" y2="${tb.pointer.y.toFixed(2)}" stroke="${colorOf(tb)}"/>`).join('')}
        </svg>`;
          const dots = arrows.map(tb => `
        <div class="bmrk-dot" style="left:${tb.pointer.x.toFixed(2)}%;top:${tb.pointer.y.toFixed(2)}%;--dot-color:${colorOf(tb)};"></div>`).join('');
          return lines + dots;
        })()}${state.markers.map(m => `
        <!-- ▶ MARKERING (${m.style === 'filled' ? 'fylt' : 'åpen ring'}) — flytt eller skaler -->
        <div class="bmrk-marker bmrk-marker--${m.style}" style="left:${m.x.toFixed(2)}%;top:${m.y.toFixed(2)}%;width:${(m.radius*2).toFixed(2)}%;"></div>`).join('')}
      </div>${state.textBoxes.length ? `
      <!-- Tekstbokser — kan stikke ut over bildet på mobil holdes innenfor 1rem -->
      <div class="bmrk-tb-area-${id}">${state.textBoxes.map(tb => `
        <!-- ▶ ${tb.variant === 'dark' ? 'OVERSKRIFT' : 'BESKRIVELSE'} — endre teksten her -->
        <div class="bmrk-tb bmrk-tb--${tb.variant}" style="left:${tb.x.toFixed(2)}%;top:${tb.y.toFixed(2)}%;">${escapeHtml(tb.text)}</div>`).join('')}
      </div>` : ''}
    </div>${innerCaption}
  </div>
${close}
`;
}

function updateExportButtons() {
  els.copyEmbed.disabled = !state.loaded;
}

els.loadBtn.addEventListener('click', loadMainImage);

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

// ============================================================
//  Arkivering
// ============================================================
let isRestoring = false;
function serializeState() {
  return {
    url: els.urlImage.value,
    textBoxes: state.textBoxes,
    markers: state.markers,
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
    if (saved.url) {
      els.urlImage.value = saved.url;
      await loadMainImage();
      if (Array.isArray(saved.textBoxes)) {
        state.textBoxes = saved.textBoxes;
        renderTextBoxes();
      }
      if (Array.isArray(saved.markers)) {
        state.markers = saved.markers;
        renderMarkers();
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
    || `Markering ${new Date().toLocaleDateString('no')}`;
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
