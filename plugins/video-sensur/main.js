// Faktisk Studio · Videosensur-plugin
//
// Blur-masker som følger motivet via keyframes. Redaktøren drar masken
// i bildet på ulike tidspunkter; posisjonen interpoleres lineært mellom
// punktene. Eksport skjer i main-prosessen (censor-export → ffmpeg) med
// CRF 17, original oppløsning/fps og lyden kopiert urørt.
//
// Koordinater lagres i KILDEPIKSLER (videoWidth/videoHeight), ikke
// visningspiksler — så eksporten er uavhengig av vindusstørrelse.

const PLUGIN_ID = 'video-sensur';

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
  url:           document.getElementById('videoUrl'),
  loadBtn:       document.getElementById('loadVideoBtn'),
  video:         document.getElementById('videoEl'),
  empty:         document.getElementById('canvasEmpty'),
  canvasArea:    document.getElementById('canvasArea'),
  overlay:       document.getElementById('maskOverlay'),
  ruler:         document.getElementById('ruler'),
  laneList:      document.getElementById('laneList'),
  head:          document.getElementById('msHead'),
  tlWrap:        document.getElementById('tlWrap'),
  tlRange:       document.getElementById('tlRange'),
  zoomIn:        document.getElementById('zoomInBtn'),
  zoomOut:       document.getElementById('zoomOutBtn'),
  zoomFit:       document.getElementById('zoomFitBtn'),
  zoomMask:      document.getElementById('zoomMaskBtn'),
  labelPos:      document.getElementById('labelPos'),
  labelDur:      document.getElementById('labelDur'),
  addMask:       document.getElementById('addMaskBtn'),
  maskList:      document.getElementById('maskList'),
  maskEmpty:     document.getElementById('maskEmpty'),
  exportBtn:     document.getElementById('exportBtn'),
  trimTrack:     document.getElementById('trimTrack'),
  trimSel:       document.getElementById('trimSel'),
  trimHandleS:   document.getElementById('trimHandleStart'),
  trimHandleE:   document.getElementById('trimHandleEnd'),
  trimInfo:      document.getElementById('exportTrimInfo'),
  trimText:      document.getElementById('exportTrimText'),
  trimReset:     document.getElementById('trimResetBtn'),
  exportProgress:document.getElementById('exportProgress'),
  exportBar:     document.getElementById('exportBar'),
  status:        document.getElementById('status'),
  back:          document.getElementById('backBtn'),
  full:          document.getElementById('fullscreenBtn'),
  openLabrador:  document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

const MASK_COLORS = ['#0050FC', '#E8590C', '#1a7f37', '#9a25b8', '#b3261e', '#0a7d8c'];
const BLUR_LEVELS = { '12': 'Lett', '24': 'Middels', '40': 'Sterk' };

const state = {
  url: '',
  duration: 0,
  loaded: false,
  masks: [],        // { name, shape, w, h, blur, fade, feather, keyframes:[{t,x,y}] } — kildepiksler
  selected: -1,
  exporting: false,
  dragging: false,  // fryser re-rendring av overlegget mens en maske dras
  view: { start: 0, end: 0 },  // synlig tidsvindu på tidslinjen (zoom)
  trimStart: 0,
  trimEnd: 0,   // = duration når hele klippet eksporteres
};

// ── Utsnitt (trim) ───────────────────────────────────────────────────────

function isTrimmed() {
  return state.loaded
    && (state.trimStart > 0.05 || state.trimEnd < state.duration - 0.05);
}

function renderTrim() {
  if (!state.duration) return;
  const L = t2pct(state.trimStart);
  const R = t2pct(state.trimEnd);
  els.trimHandleS.style.left = Math.max(0, Math.min(100, L)) + '%';
  els.trimHandleE.style.left = Math.max(0, Math.min(100, R)) + '%';
  els.trimHandleS.style.display = (L < -0.5 || L > 100.5) ? 'none' : '';
  els.trimHandleE.style.display = (R < -0.5 || R > 100.5) ? 'none' : '';
  els.trimSel.style.left = Math.max(0, L) + '%';
  els.trimSel.style.width = Math.max(0, Math.min(100, R) - Math.max(0, L)) + '%';
  const trimmed = isTrimmed();
  els.trimInfo.style.display = trimmed ? 'flex' : 'none';
  if (trimmed) {
    els.trimText.textContent = 'Utsnitt: ' + formatSec(state.trimStart)
      + ' – ' + formatSec(state.trimEnd)
      + ' (' + formatSec(state.trimEnd - state.trimStart) + ')';
  }
}

function attachTrimHandle(handle, which) {
  handle.addEventListener('pointerdown', e => {
    if (!state.loaded) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = els.trimTrack.getBoundingClientRect();
    function onMove(ev) {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = r10(state.view.start + frac * viewSpan());
      if (which === 'start') {
        state.trimStart = Math.max(0, Math.min(t, state.trimEnd - 0.5));
      } else {
        state.trimEnd = Math.min(state.duration, Math.max(t, state.trimStart + 0.5));
      }
      renderTrim();
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      updateButtons();
      scheduleSaveState();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// ── Tidslinje-zoom ───────────────────────────────────────────────────────

const MIN_VIEW = 0.5; // sekunder — mer zoom enn dette gir ikke mening

function viewSpan() { return Math.max(0.001, state.view.end - state.view.start); }
function t2pct(t) { return (t - state.view.start) / viewSpan() * 100; }

// Setter vinduet; ved kollisjon med klippgrensene skyves vinduet i stedet
// for å krympes, så zoomnivået bevares.
function setView(s, e) {
  const dur = state.duration || 0;
  let span = Math.max(MIN_VIEW, e - s);
  span = Math.min(span, dur || span);
  if (s < 0) s = 0;
  if (s + span > dur) s = Math.max(0, dur - span);
  state.view = { start: s, end: s + span };
  renderTimeline();
  updateViewLabel();
}

function updateViewLabel() {
  const zoomed = state.duration && viewSpan() < state.duration - 0.01;
  els.tlRange.textContent = zoomed
    ? formatSec(state.view.start) + ' – ' + formatSec(state.view.end)
    : '';
}

function zoomAround(centerT, factor) {
  const span = Math.max(MIN_VIEW, Math.min(state.duration, viewSpan() * factor));
  const frac = (centerT - state.view.start) / viewSpan();
  setView(centerT - frac * span, centerT + (1 - frac) * span);
}

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

function formatSec(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m + 'm ' + sec.replace('.', ',') + 's';
  }
  return s.toFixed(1).replace('.', ',') + 's';
}

const r10 = x => Math.round(x * 10) / 10;

// ── Video-lasting ────────────────────────────────────────────────────────

async function loadVideo() {
  const url = els.url.value.trim();
  if (!url) { setStatus('Lim inn en URL først.', true); return; }
  if (!isValidUrl(url)) { setStatus('Ugyldig URL.', true); return; }

  setStatus('Laster…');
  els.video.src = url;
  await new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('Kunne ikke laste videoen.')); };
    function cleanup() {
      els.video.removeEventListener('loadedmetadata', onMeta);
      els.video.removeEventListener('error', onErr);
    }
    els.video.addEventListener('loadedmetadata', onMeta);
    els.video.addEventListener('error', onErr);
  }).catch(err => {
    setStatus(err.message, true);
    state.loaded = false;
    updateButtons();
    return null;
  });

  if (!els.video.duration || !isFinite(els.video.duration)) {
    setStatus('Klarte ikke å lese videoens lengde.', true);
    return;
  }

  if (state.url !== url) {
    state.masks = state.masks.filter(m =>
      m.keyframes[m.keyframes.length - 1].t <= els.video.duration + 0.5);
    state.selected = -1;
  }

  state.url = url;
  state.duration = els.video.duration;
  state.loaded = true;

  els.empty.classList.add('hidden');
  els.labelDur.textContent = formatSec(state.duration);
  state.view = { start: 0, end: state.duration };
  if (!(state.trimEnd > state.trimStart) || state.trimEnd > state.duration + 0.05) {
    state.trimStart = 0;
    state.trimEnd = state.duration;
  }
  updateViewLabel();
  renderAll();
  updateButtons();
  setStatus(`Lastet · ${els.video.videoWidth}×${els.video.videoHeight} · ${formatSec(state.duration)}`);
  scheduleSaveState();
}

// ── Interpolasjon og geometri ────────────────────────────────────────────

function maskPosAt(m, t) {
  const kfs = m.keyframes;
  if (t <= kfs[0].t) return { x: kfs[0].x, y: kfs[0].y };
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / Math.max(0.001, b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return { x: last.x, y: last.y };
}

// Størrelsen interpoleres også — keyframes uten w/h faller tilbake til maskens standard
function maskSizeAt(m, t) {
  const kfs = m.keyframes;
  const sz = k => ({ w: k.w > 1 ? k.w : m.w, h: k.h > 1 ? k.h : m.h });
  if (t <= kfs[0].t) return sz(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return sz(last);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / Math.max(0.001, b.t - a.t);
      const A = sz(a), B = sz(b);
      return { w: A.w + (B.w - A.w) * f, h: A.h + (B.h - A.h) * f };
    }
  }
  return sz(last);
}

function maskRange(m) {
  return { from: m.keyframes[0].t, to: m.keyframes[m.keyframes.length - 1].t };
}

// Skalering mellom kildepiksler og visningspiksler
function viewScale() {
  return els.video.videoWidth ? els.video.clientWidth / els.video.videoWidth : 1;
}

// Overlay-laget legges nøyaktig over videoelementet
function positionOverlay() {
  const vr = els.video.getBoundingClientRect();
  const ar = els.canvasArea.getBoundingClientRect();
  els.overlay.style.left = (vr.left - ar.left) + 'px';
  els.overlay.style.top = (vr.top - ar.top) + 'px';
  els.overlay.style.width = vr.width + 'px';
  els.overlay.style.height = vr.height + 'px';
}
new ResizeObserver(() => { positionOverlay(); renderOverlay(); }).observe(els.canvasArea);
els.video.addEventListener('loadedmetadata', positionOverlay);

// ── Overlegg (masker i bildet) ───────────────────────────────────────────

function renderOverlay() {
  els.overlay.querySelectorAll('.mask-box').forEach(n => n.remove());
  if (!state.loaded) return;
  const s = viewScale();
  const t = els.video.currentTime;

  state.masks.forEach((m, i) => {
    const { from, to } = maskRange(m);
    const active = t >= from - 0.05 && t <= to + 0.05;
    // Utenfor aktivt tidsrom vises kun valgt maske (dempet), så den kan finnes igjen
    if (!active && state.selected !== i) return;

    const pos = maskPosAt(m, t);
    const size = maskSizeAt(m, t);
    const box = document.createElement('div');
    box.className = 'mask-box' + (state.selected === i ? ' selected' : '') + (active ? '' : ' inactive')
      + (m.shape === 'ellipse' || m.shape === 'circle' ? ' mask-box--ellipse' : '')
      + (m.locked ? ' locked' : '');
    box.dataset.i = i;
    box.style.left = (pos.x - size.w / 2) * s + 'px';
    box.style.top = (pos.y - size.h / 2) * s + 'px';
    box.style.width = size.w * s + 'px';
    box.style.height = size.h * s + 'px';
    box.style.backdropFilter = `blur(${Math.round((m.blur || 24) / 2)}px)`;
    box.style.webkitBackdropFilter = box.style.backdropFilter;

    if (state.selected === i) {
      const label = document.createElement('div');
      label.className = 'mask-box__label';
      label.textContent = m.name + (m.locked ? ' 🔒' : '');
      box.appendChild(label);
      if (!m.locked) {
        const rz = document.createElement('div');
        rz.className = 'mask-box__resize';
        rz.dataset.resize = '1';
        box.appendChild(rz);
      }
    }
    els.overlay.appendChild(box);
  });
}

// Dra for å flytte (lagrer keyframe ved spilletid) / dra hjørne for størrelse.
// Lyttere ligger på window og videoen pauses under drag — ellers re-rendres
// overlegget av rAF-løkka mens videoen spiller, boksen byttes ut midt i
// draget, og grepet «slipper».
els.overlay.addEventListener('pointerdown', e => {
  const box = e.target.closest('.mask-box');
  if (!box) return;
  e.preventDefault();
  e.stopPropagation();
  const i = +box.dataset.i;
  const m = state.masks[i];
  if (!m || m.locked) return;

  els.video.pause();
  state.dragging = true;
  if (state.selected !== i) { state.selected = i; renderList(); renderTimeline(); }

  const s = viewScale();
  const resizing = !!e.target.dataset.resize;
  const startX = e.clientX, startY = e.clientY;
  const startPos = maskPosAt(m, els.video.currentTime);
  const startSize = maskSizeAt(m, els.video.currentTime);
  let livePos = { ...startPos };
  let liveSize = { ...startSize };
  box.classList.add('dragging');

  function onMove(ev) {
    const dx = (ev.clientX - startX) / s;
    const dy = (ev.clientY - startY) / s;
    if (resizing) {
      liveSize.w = Math.min(els.video.videoWidth, Math.max(24, Math.round(startSize.w + dx * 2)));
      liveSize.h = m.shape === 'circle'
        ? Math.min(els.video.videoHeight, liveSize.w) // sirkel: alltid 1:1
        : Math.min(els.video.videoHeight, Math.max(24, Math.round(startSize.h + dy * 2)));
      if (m.shape === 'circle') liveSize.w = liveSize.h;
    } else {
      livePos = {
        x: Math.max(0, Math.min(els.video.videoWidth, startPos.x + dx)),
        y: Math.max(0, Math.min(els.video.videoHeight, startPos.y + dy)),
      };
    }
    box.style.left = (livePos.x - liveSize.w / 2) * s + 'px';
    box.style.top = (livePos.y - liveSize.h / 2) * s + 'px';
    box.style.width = liveSize.w * s + 'px';
    box.style.height = liveSize.h * s + 'px';
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    state.dragging = false;
    box.classList.remove('dragging');
    // Både flytting og størrelsesendring lagres som keyframe ved spilletid —
    // størrelsen animeres altså på samme måte som posisjonen.
    upsertKeyframe(m, els.video.currentTime, livePos.x, livePos.y, liveSize.w, liveSize.h);
    m.w = Math.round(liveSize.w); m.h = Math.round(liveSize.h); // ny standard
    renderTimeline();
    renderList();
    renderOverlay();
    scheduleSaveState();
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});

function upsertKeyframe(m, t, x, y, w, h) {
  t = r10(t);
  x = Math.round(x); y = Math.round(y);
  const existing = m.keyframes.find(k => Math.abs(k.t - t) < 0.05);
  if (existing) {
    existing.x = x; existing.y = y;
    if (w > 1) { existing.w = Math.round(w); existing.h = Math.round(h); }
  } else {
    const kf = { t, x, y };
    if (w > 1) { kf.w = Math.round(w); kf.h = Math.round(h); }
    m.keyframes.push(kf);
  }
  m.keyframes.sort((a, b) => a.t - b.t);
}

// ── Masker: opprett, velg, rediger ───────────────────────────────────────

function selectMask(i) {
  state.selected = i;
  renderList();
  renderTimeline();
  renderOverlay();
}

els.addMask.addEventListener('click', () => {
  if (!state.loaded) return;
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  const size = Math.round(Math.min(vw, vh) * 0.18);
  const t0 = r10(Math.min(els.video.currentTime, Math.max(0, state.duration - 0.5)));
  const t1 = r10(Math.min(state.duration, t0 + 4));
  const cx = Math.round(vw / 2), cy = Math.round(vh / 3);
  state.masks.push({
    name: 'Maske ' + (state.masks.length + 1),
    shape: 'circle', feather: 0.35, locked: false,
    w: size, h: size,
    blur: 24, fade: 0.3,
    keyframes: t1 - t0 >= 0.1
      ? [{ t: t0, x: cx, y: cy }, { t: t1, x: cx, y: cy }]
      : [{ t: Math.max(0, t0 - 4), x: cx, y: cy }, { t: t0, x: cx, y: cy }],
  });
  selectMask(state.masks.length - 1);
  updateButtons();
  scheduleSaveState();
  setStatus('Maske lagt til — dra den over det som skal sensureres.');
});

function renderList() {
  els.maskList.innerHTML = '';
  els.maskEmpty.style.display = state.masks.length ? 'none' : 'block';
  state.masks.forEach((m, i) => {
    const { from, to } = maskRange(m);
    const row = document.createElement('div');
    row.className = 'mask-row' + (state.selected === i ? ' selected' : '');
    row.dataset.i = i;
    row.style.borderLeftColor = state.selected === i ? MASK_COLORS[i % MASK_COLORS.length] : 'transparent';
    const blurOpts = Object.entries(BLUR_LEVELS).map(([v, lbl]) =>
      `<option value="${v}"${+v === m.blur ? ' selected' : ''}>${lbl}</option>`).join('');
    const dis = m.locked ? ' disabled' : '';
    row.innerHTML =
      `<div class="mask-row__top">
        <button class="mask-row__lock${m.locked ? ' on' : ''}" data-act="lock"
          title="${m.locked ? 'Lås opp masken' : 'Lås masken (kan ikke flyttes eller endres)'}">${m.locked ? '🔒' : '🔓'}</button>
        <span class="mask-row__name">${m.name}</span>
        <span class="mask-row__range">${formatSec(from)} – ${formatSec(to)} · ${m.keyframes.length} pkt</span>
        <button class="mask-row__del" data-act="del" title="Slett maske"${dis}>✕</button>
      </div>
      <div class="mask-row__bottom${m.locked ? ' islocked' : ''}">
        <span class="lbl">Form</span>
        <select data-set="shape"${dis}>
          <option value="circle"${m.shape === 'circle' ? ' selected' : ''}>Sirkel</option>
          <option value="ellipse"${m.shape === 'ellipse' ? ' selected' : ''}>Oval</option>
          <option value="rect"${m.shape === 'rect' ? ' selected' : ''}>Rektangel</option>
        </select>
        ${m.shape !== 'rect' ? `<span class="lbl">Kant</span>
        <select data-set="feather"${dis}>
          <option value="0.35"${m.feather >= 0.2 ? ' selected' : ''}>Myk</option>
          <option value="0.08"${m.feather < 0.2 ? ' selected' : ''}>Skarp</option>
        </select>` : ''}
        <span class="lbl">Blur</span>
        <select data-set="blur"${dis}>${blurOpts}</select>
        <span class="lbl">Fade</span>
        <select data-set="fade"${dis}>
          <option value="0"${m.fade === 0 ? ' selected' : ''}>Av</option>
          <option value="0.3"${m.fade === 0.3 ? ' selected' : ''}>0,3s</option>
          <option value="0.6"${m.fade === 0.6 ? ' selected' : ''}>0,6s</option>
        </select>
        <button class="mask-row__kf" data-act="addKf" title="Legg til punkt ved spilletid (forlenger tidsrommet)"${dis}>+ punkt</button>
        <button class="mask-row__kf" data-act="delKf" title="Slett punktet nærmest spilletid"${dis}>− punkt</button>
        <button class="mask-row__kf mask-row__track" data-act="track" title="Følg motivet automatisk fra spilletid til maskens slutt"${dis}>Spor →</button>
      </div>`;
    els.maskList.appendChild(row);
  });
}

els.maskList.addEventListener('click', e => {
  const row = e.target.closest('.mask-row');
  if (!row) return;
  // Klikk på en select må IKKE re-rendre lista — det lukker dropdownen
  // før den rekker å åpne seg. La select-elementet håndtere seg selv.
  if (e.target.closest('select')) return;
  const i = +row.dataset.i;
  const m = state.masks[i];
  const btn = e.target.closest('button');

  if (!btn) { if (state.selected !== i) selectMask(i); return; }
  const act = btn.dataset.act;

  if (act === 'lock') {
    m.locked = !m.locked;
    renderList(); renderOverlay(); renderTimeline();
    scheduleSaveState();
    return;
  }
  if (m.locked) return; // låst maske: ingen andre handlinger

  if (act === 'del') {
    state.masks.splice(i, 1);
    if (state.selected >= state.masks.length) state.selected = state.masks.length - 1;
    renderAll(); updateButtons(); scheduleSaveState();
    return;
  }
  if (act === 'addKf') {
    const t = els.video.currentTime;
    const pos = maskPosAt(m, t);
    const size = maskSizeAt(m, t);
    upsertKeyframe(m, t, pos.x, pos.y, size.w, size.h);
    selectMask(i); scheduleSaveState();
    return;
  }
  if (act === 'track') {
    trackMask(i);
    return;
  }
  if (act === 'delKf') {
    if (m.keyframes.length <= 2) { setStatus('En maske trenger minst to punkter.', true); return; }
    const t = els.video.currentTime;
    let best = 0, bestD = Infinity;
    m.keyframes.forEach((k, j) => {
      const d = Math.abs(k.t - t);
      if (d < bestD) { bestD = d; best = j; }
    });
    m.keyframes.splice(best, 1);
    selectMask(i); scheduleSaveState();
  }
});

els.maskList.addEventListener('change', e => {
  const row = e.target.closest('.mask-row');
  if (!row || !e.target.dataset.set) return;
  const m = state.masks[+row.dataset.i];
  if (m.locked) { renderList(); return; }
  if (e.target.dataset.set === 'blur') m.blur = +e.target.value;
  if (e.target.dataset.set === 'fade') m.fade = +e.target.value;
  if (e.target.dataset.set === 'shape') {
    m.shape = e.target.value;
    if (m.shape === 'circle') m.h = m.w; // sirkel er alltid rund
    renderList(); // Kant-selecten vises/skjules avhengig av form
  }
  if (e.target.dataset.set === 'feather') m.feather = +e.target.value;
  renderOverlay();
  scheduleSaveState();
});

// ── Tidslinje ────────────────────────────────────────────────────────────

// Én lane per maske: fargekodet spenn med keyframe-punkter, alltid synlig.
function renderTimeline() {
  els.laneList.innerHTML = '';
  const dur = state.duration;
  if (!dur) return;
  state.masks.forEach((m, i) => {
    const { from, to } = maskRange(m);
    const color = MASK_COLORS[i % MASK_COLORS.length];
    const row = document.createElement('div');
    row.className = 'timeline-row lane' + (state.selected === i ? ' selected' : '');
    row.dataset.i = i;

    const label = document.createElement('span');
    label.className = 'timeline-row__label';
    label.textContent = (m.locked ? '🔒 ' : '') + m.name;
    label.style.color = color;
    label.style.opacity = m.locked ? 0.55 : 1;
    label.title = m.name + (m.locked ? ' (låst)' : ' — klikk for å velge');

    const track = document.createElement('div');
    track.className = 'timeline__track';

    // Spenn og punkter i zoom-vinduet — klipp mot kantene, skjul utenfor
    const L = Math.max(0, t2pct(from));
    const R = Math.min(100, t2pct(to));
    if (R > 0 && L < 100 && R > L) {
      const span = document.createElement('div');
      span.className = 'ms-span' + (state.selected === i ? ' selected' : '');
      span.style.left = L + '%';
      span.style.width = Math.max(0.4, R - L) + '%';
      span.style.background = color;
      track.appendChild(span);
    }

    m.keyframes.forEach(k => {
      const pct = t2pct(k.t);
      if (pct < 0 || pct > 100) return;
      const dot = document.createElement('div');
      dot.className = 'ms-kf';
      dot.style.left = pct + '%';
      track.appendChild(dot);
    });

    row.appendChild(label);
    row.appendChild(track);
    els.laneList.appendChild(row);
  });
  renderTrim(); // utsnitt-håndtakene følger samme zoom-vindu
}

function seekFromEvent(ev, trackEl) {
  const rect = trackEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
  if (state.duration) {
    els.video.currentTime = state.view.start + (x / rect.width) * viewSpan();
  }
}

function attachSeek(el, getTrack) {
  el.addEventListener('mousedown', e => {
    if (!state.loaded) return;
    const track = getTrack(e);
    if (!track) return;
    e.preventDefault();
    seekFromEvent(e, track);
    const onMove = ev => seekFromEvent(ev, track);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

attachSeek(els.ruler, () => els.ruler);
attachSeek(els.laneList, e => {
  const row = e.target.closest('.lane');
  if (!row) return null;
  const i = +row.dataset.i;
  // selectMask re-rendrer lanes — hent sporet på nytt fra ferskt DOM,
  // ellers peker vi på en løsrevet node og seek-draget dør.
  if (state.selected !== i) selectMask(i);
  return els.laneList.querySelector(`.lane[data-i="${i}"] .timeline__track`);
});

let lastT = -1;
(function raf() {
  const dur = state.duration;
  const t = els.video.currentTime || 0;
  if (dur) {
    const pct = t2pct(t);
    els.head.style.display = (pct < 0 || pct > 100) ? 'none' : '';
    els.head.style.left = Math.max(0, Math.min(100, pct)) + '%';
    els.labelPos.textContent = formatSec(t);
  }
  if (!state.dragging && Math.abs(t - lastT) > 0.02) {
    lastT = t;
    renderOverlay();
  }
  requestAnimationFrame(raf);
})();

function renderAll() {
  renderList();
  renderTimeline();
  renderOverlay();
  positionOverlay();
}

attachTrimHandle(els.trimHandleS, 'start');
attachTrimHandle(els.trimHandleE, 'end');
els.trimReset.addEventListener('click', () => {
  state.trimStart = 0;
  state.trimEnd = state.duration;
  renderTrim();
  updateButtons();
  scheduleSaveState();
});

// ── Zoom-kontroller ──────────────────────────────────────────────────────

els.zoomIn.addEventListener('click', () => {
  if (state.loaded) zoomAround(els.video.currentTime, 0.5);
});
els.zoomOut.addEventListener('click', () => {
  if (state.loaded) zoomAround(els.video.currentTime, 2);
});
els.zoomFit.addEventListener('click', () => {
  if (state.loaded) setView(0, state.duration);
});
els.zoomMask.addEventListener('click', () => {
  if (!state.loaded || state.selected < 0) return;
  const { from, to } = maskRange(state.masks[state.selected]);
  const pad = Math.max(0.2, (to - from) * 0.15);
  setView(from - pad, to + pad);
});

// ⌘/Ctrl + scroll = zoom rundt pekeren · horisontal scroll = panorering
els.tlWrap.addEventListener('wheel', e => {
  if (!state.loaded) return;
  const rect = els.tlWrap.getBoundingClientRect();
  const trackLeft = rect.left + 102; // 90px label + 12px gap
  const trackW = Math.max(1, rect.width - 102);
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const frac = Math.max(0, Math.min(1, (e.clientX - trackLeft) / trackW));
    const tCursor = state.view.start + frac * viewSpan();
    zoomAround(tCursor, e.deltaY > 0 ? 1.3 : 1 / 1.3);
  } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    e.preventDefault();
    const shift = (e.deltaX / trackW) * viewSpan();
    setView(state.view.start + shift, state.view.end + shift);
  }
}, { passive: false });

// Piltaster: ←/→ = 1s · ⇧ = ett frame-steg (0,04s) · mellomrom = spill/pause
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (!state.loaded) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (els.video.paused) els.video.play(); else els.video.pause();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const step = (e.shiftKey ? 0.04 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
    els.video.pause();
    els.video.currentTime = Math.max(0, Math.min(state.duration, els.video.currentTime + step));
  }
});

// ── Motiv-tracking ───────────────────────────────────────────────────────

async function trackMask(i) {
  const m = state.masks[i];
  if (!m || m.locked || state.exporting) return;
  const { to } = maskRange(m);
  const t0 = r10(els.video.currentTime);
  if (t0 >= to - 0.3) {
    setStatus('Spol til der sporingen skal starte — masken må vare lenger enn spilletiden.', true);
    return;
  }
  els.video.pause();
  const pos = maskPosAt(m, t0);
  const size = maskSizeAt(m, t0);
  setStatus('Sporer motivet…');

  const unsub = window.faktisk.onCensorTrackProgress(msg => {
    if (msg.phase === 'decoding') setStatus('Leser bilder… ' + msg.percent + '%');
    else if (msg.phase === 'tracking') setStatus('Sporer motivet…');
  });

  try {
    const res = await window.faktisk.censorTrack({
      url: state.url,
      from: t0, to,
      x: pos.x, y: pos.y, w: size.w, h: size.h,
      videoW: els.video.videoWidth, videoH: els.video.videoHeight,
    });
    if (!res.ok) { setStatus('Sporing feilet: ' + res.error, true); return; }

    // Erstatt keyframes i sporingsvinduet med de sporede punktene.
    // Punkter før start og etter sporet slutt beholdes.
    const trackedEnd = res.keyframes[res.keyframes.length - 1].t;
    const kept = m.keyframes.filter(k => k.t < t0 - 0.05 || k.t > trackedEnd + 0.05);
    const tracked = res.keyframes.map(k => ({
      t: k.t, x: k.x, y: k.y, w: Math.round(size.w), h: Math.round(size.h),
    }));
    m.keyframes = kept.concat(tracked).sort((a, b) => a.t - b.t);

    selectMask(i);
    renderAll();
    scheduleSaveState();
    setStatus(res.stoppedEarly
      ? `Sporet til ${formatSec(trackedEnd)} — stoppet der bildet endret seg brått (klipp?). Sjekk og juster.`
      : `Sporet ferdig til ${formatSec(trackedEnd)} (${tracked.length} punkter). Se over og finjuster ved behov.`);
  } catch (err) {
    setStatus('Sporing feilet: ' + err.message, true);
  } finally {
    unsub();
  }
}

// ── Eksport ──────────────────────────────────────────────────────────────

function masksValid() {
  return state.masks.length > 0 && state.masks.every(m => {
    const { from, to } = maskRange(m);
    return to - from >= 0.1;
  });
}

function updateButtons() {
  els.addMask.disabled = !state.loaded;
  // Eksport krever masker ELLER et utsnitt (ren trim-eksport er også nyttig)
  els.exportBtn.disabled = !(state.loaded && (masksValid() || isTrimmed()) && !state.exporting);
  els.exportBtn.textContent = (state.masks.length === 0 && isTrimmed())
    ? 'Eksporter utsnitt (uten sensur)…'
    : 'Eksporter video…';
}

els.exportBtn.addEventListener('click', async () => {
  if (els.exportBtn.disabled) return;
  // Dekod URL-segmentet — ellers får fila bokstavelig «%20» i navnet,
  // som gir 404 når den lastes opp igjen og URL-en re-enkodes.
  let base = state.url.split('/').pop() || 'video.mp4';
  try { base = decodeURIComponent(base); } catch (e) {}
  base = base.replace(/\.(mp4|mov|mpg|mpeg|m4v).*$/i, '').replace(/%/g, '');
  const savePath = await window.faktisk.saveDialog({
    title: 'Eksporter sensurert video',
    defaultPath: base + '-sensurert.mp4',
    filters: [{ name: 'Video', extensions: ['mp4'] }],
  });
  if (!savePath) return;

  state.exporting = true;
  updateButtons();
  els.exportProgress.style.display = 'block';
  els.exportBar.style.width = '0%';

  const unsub = window.faktisk.onCensorProgress(msg => {
    if (msg.phase === 'downloading') {
      setStatus('Laster ned kildevideo…');
    } else if (msg.phase === 'encoding') {
      setStatus('Rendrer… ' + msg.percent + '%');
      els.exportBar.style.width = msg.percent + '%';
    }
  });

  try {
    const res = await window.faktisk.censorExport({
      url: state.url,
      savePath,
      trimStart: state.trimStart,
      trimEnd: state.trimEnd,
      duration: Math.max(0.1, state.trimEnd - state.trimStart),
      masks: state.masks.map(m => ({
        shape: m.shape, feather: m.feather,
        w: m.w, h: m.h, blur: m.blur, fade: m.fade,
        keyframes: m.keyframes.map(k => {
          const kf = { t: k.t, x: k.x, y: k.y };
          if (k.w > 1) { kf.w = k.w; kf.h = k.h; }
          return kf;
        }),
      })),
    });
    if (res.ok) {
      els.exportBar.style.width = '100%';
      setStatus('Eksportert ✓');
      await window.faktisk.revealInFinder(res.savePath);
    } else {
      setStatus('Eksport feilet: ' + res.error, true);
    }
  } catch (err) {
    setStatus('Eksport feilet: ' + err.message, true);
  } finally {
    unsub();
    state.exporting = false;
    updateButtons();
    setTimeout(() => { els.exportProgress.style.display = 'none'; }, 2500);
  }
});

// ── Labrador-filer: «Mine filer»-panel + direkteopplasting ───────────────

const labEls = {
  filesBtn:  document.getElementById('labFilesBtn'),
  uploadBtn: document.getElementById('labUploadBtn'),
  panel:     document.getElementById('labPanel'),
  status:    document.getElementById('labPanelStatus'),
  list:      document.getElementById('labPanelList'),
};

const VIDEO_EXT = /\.(mp4|mov|mpg|mpeg|m4v|webm)(\?|$)/i;

function useLabradorUrl(url) {
  els.url.value = url;
  labEls.panel.style.display = 'none';
  loadVideo();
}

async function refreshLabPanel() {
  labEls.status.textContent = 'Henter filer…';
  labEls.list.innerHTML = '';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { labEls.status.textContent = 'Feil: ' + err.message; return; }

  if (!res.loggedIn) {
    labEls.status.innerHTML = 'Ikke innlogget. '
      + '<button class="link-btn" id="labConnectBtn" type="button">Koble til Labrador…</button>';
    document.getElementById('labConnectBtn').addEventListener('click', async () => {
      labEls.status.textContent = 'Logg inn i vinduet som åpnes…';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) refreshLabPanel();
      else labEls.status.textContent = 'Fikk ikke gyldig innlogging. Prøv igjen.';
    });
    return;
  }

  const videos = res.files.filter(f => VIDEO_EXT.test(f.url));
  const others = res.files.filter(f => !VIDEO_EXT.test(f.url));
  labEls.status.textContent = res.files.length
    ? videos.length + ' videoer · ' + others.length + ' andre filer (nyeste først)'
    : 'Ingen filer lastet opp ennå.';

  // Videoer først — det er dem denne pluginen bruker
  videos.concat(others).slice(0, 60).forEach(f => {
    const row = document.createElement('div');
    row.className = 'lab-file';
    const isVideo = VIDEO_EXT.test(f.url);
    row.innerHTML = '<span class="lab-file__type' + (isVideo ? ' video' : '') + '">'
      + (isVideo ? 'VIDEO' : (f.name.split('.').pop() || 'FIL').toUpperCase().slice(0, 5)) + '</span>'
      + '<span class="lab-file__name"></span>';
    row.querySelector('.lab-file__name').textContent = f.name;
    row.title = f.url + (isVideo ? '' : ' (ikke video — kan ikke brukes her)');
    if (isVideo) row.addEventListener('click', () => useLabradorUrl(f.url));
    else row.style.opacity = '0.45';
    labEls.list.appendChild(row);
  });
}

labEls.filesBtn.addEventListener('click', () => {
  const open = labEls.panel.style.display !== 'none';
  labEls.panel.style.display = open ? 'none' : 'flex';
  if (!open) refreshLabPanel();
});

labEls.uploadBtn.addEventListener('click', async () => {
  labEls.uploadBtn.disabled = true;
  setStatus('Velg fil — lastes opp til Labrador…');
  try {
    const res = await window.faktisk.labradorUpload({
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mpg', 'mpeg', 'm4v'] }],
    });
    if (res.canceled) { setStatus(''); return; }
    if (!res.ok) {
      // Ikke innlogget gir HTTP-feil — tilby tilkobling
      setStatus('Opplasting feilet: ' + res.error + ' — er du koblet til Labrador?', true);
      return;
    }
    if (res.url) {
      setStatus('Lastet opp «' + res.name + '» ✓');
      useLabradorUrl(res.url);
    } else {
      setStatus(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer».', true);
    }
  } catch (err) {
    setStatus('Opplasting feilet: ' + err.message, true);
  } finally {
    labEls.uploadBtn.disabled = false;
  }
});

// ── Navigasjon ───────────────────────────────────────────────────────────

els.loadBtn.addEventListener('click', loadVideo);
els.url.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadVideo();
});
els.back.addEventListener('click', async () => {
  await window.faktisk.goHome();
});
els.full.addEventListener('click', async () => {
  await window.faktisk.toggleFullscreen();
});
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ── Arkivering ───────────────────────────────────────────────────────────

let isRestoring = false;

function serializeState() {
  return {
    url: els.url.value,
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    masks: state.masks.map(m => ({
      name: m.name, shape: m.shape || 'rect', feather: m.feather, locked: !!m.locked,
      w: m.w, h: m.h, blur: m.blur, fade: m.fade,
      keyframes: m.keyframes.map(k => {
        const kf = { t: k.t, x: k.x, y: k.y };
        if (k.w > 1) { kf.w = k.w; kf.h = k.h; }
        return kf;
      }),
    })),
  };
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    state.masks = Array.isArray(saved.masks)
      ? saved.masks
          .filter(m => m && m.w > 1 && Array.isArray(m.keyframes) && m.keyframes.length >= 2)
          .map((m, i) => ({
            name: String(m.name || 'Maske ' + (i + 1)),
            // Masker lagret før formvalget fantes mangler shape — de blir
            // sirkler (dagens standard), ikke rektangler.
            shape: ['circle', 'ellipse', 'rect'].includes(m.shape) ? m.shape : 'circle',
            feather: (typeof m.feather === 'number' && m.feather > 0) ? m.feather : 0.35,
            locked: !!m.locked,
            w: m.w, h: m.h,
            blur: [12, 24, 40].includes(m.blur) ? m.blur : 24,
            fade: [0, 0.3, 0.6].includes(m.fade) ? m.fade : 0.3,
            keyframes: m.keyframes
              .filter(k => typeof k.t === 'number' && typeof k.x === 'number' && typeof k.y === 'number')
              .sort((a, b) => a.t - b.t),
          }))
      : [];
    state.selected = -1;
    if (typeof saved.trimStart === 'number' && typeof saved.trimEnd === 'number'
        && saved.trimEnd > saved.trimStart) {
      state.trimStart = saved.trimStart;
      state.trimEnd = saved.trimEnd;
    }
    if (saved.url) {
      els.url.value = saved.url;
      await loadVideo();
    }
    renderAll();
    updateButtons();
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
  updateButtons();
}
['input', 'change'].forEach(ev => {
  els.url.addEventListener(ev, scheduleSaveState);
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
  const defaultName = `Sensur ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) {
    setStatus('Lagret: «' + res.name + '».');
    await refreshProjectList();
  } else {
    setStatus('Kunne ikke lagre: ' + (res.error || 'ukjent feil'), true);
  }
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) {
    setStatus('Åpner «' + res.name + '»…');
    await applyState(res.state);
    setStatus('Åpnet «' + res.name + '».');
  }
});

(async function init() {
  updateButtons();
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
