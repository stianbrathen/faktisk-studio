// Faktisk Studio · Keynote-klipp
//
// Lager stumme videoklipp med runde hjørner og ekte alfakanal, klare til å
// dras rett inn i Keynote. Poenget med alfakanalen: Keynotes egen skygge
// følger den runde formen, mens Keynotes "outline" alltid tegner et
// firkantet omriss — derfor bakes rammen inn i videoen her i stedet.
//
// Maske og ramme tegnes med canvas (gratis antialiasering, samme kvalitet
// som CSS border-radius) og sendes som PNG til main-prosessen, som lar
// ffmpeg kombinere dem med videoen.

const PLUGIN_ID = 'keynote-klipp';

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
  url:            document.getElementById('videoUrl'),
  loadBtn:        document.getElementById('loadVideoBtn'),
  localFileBtn:   document.getElementById('localFileBtn'),
  openLabrador:   document.getElementById('openLabradorBtn'),
  status:         document.getElementById('status'),
  back:           document.getElementById('backBtn'),
  full:           document.getElementById('fullscreenBtn'),

  video:          document.getElementById('videoEl'),
  stage:          document.getElementById('stage'),
  stageFrame:     document.getElementById('stageFrame'),
  canvasArea:     document.getElementById('canvasArea'),
  canvasEmpty:    document.getElementById('canvasEmpty'),

  fmtGrid:        document.getElementById('fmtGrid'),
  radiusRange:    document.getElementById('radiusRange'),
  radiusVal:      document.getElementById('radiusVal'),
  borderOn:       document.getElementById('borderOn'),
  borderCtl:      document.getElementById('borderCtl'),
  borderWidth:    document.getElementById('borderWidth'),
  borderWidthVal: document.getElementById('borderWidthVal'),
  borderColor:    document.getElementById('borderColor'),
  swatches:       document.getElementById('swatches'),
  zoomRange:      document.getElementById('zoomRange'),
  zoomVal:        document.getElementById('zoomVal'),
  audioOpt:       document.getElementById('audioOpt'),
  loopOpt:        document.getElementById('loopOpt'),
  loopLabel:      document.getElementById('loopLabel'),
  loopHint:       document.getElementById('loopHint'),
  proresOpt:      document.getElementById('proresOpt'),

  playBtn:        document.getElementById('playBtn'),
  trimTrack:      document.getElementById('trimTrack'),
  trimSel:        document.getElementById('trimSel'),
  trimStart:      document.getElementById('trimHandleStart'),
  trimEnd:        document.getElementById('trimHandleEnd'),
  ruler:          document.getElementById('ruler'),
  playhead:       document.getElementById('playhead'),
  labelPos:       document.getElementById('labelPos'),
  labelDur:       document.getElementById('labelDur'),
  labelClip:      document.getElementById('labelClip'),

  projectSelect:  document.getElementById('projectSelect'),
  saveProject:    document.getElementById('saveProjectBtn'),
  exportBtn:      document.getElementById('exportBtn'),
  exportProgress: document.getElementById('exportProgress'),
  exportBar:      document.getElementById('exportBar'),
  exportNote:     document.getElementById('exportNote'),
  exportTrimInfo: document.getElementById('exportTrimInfo'),
  exportTrimText: document.getElementById('exportTrimText'),
  trimResetBtn:   document.getElementById('trimResetBtn'),
};

const state = {
  url: '',
  localPath: '',
  loaded: false,
  srcW: 0,
  srcH: 0,
  duration: 0,

  outW: 1080,
  outH: 1920,
  radius: 80,

  borderOn: false,
  borderWidth: 8,
  borderColor: '#FFFFFF',

  zoom: 1,          // 1 = største mulige utsnitt i målformatet
  panX: 0.5,        // 0–1, hvor i kilden utsnittet ligger
  panY: 0.5,

  trimStart: 0,
  trimEnd: null,    // null = til slutten

  previewBg: 'checker',
  exporting: false,
};

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

function fmtTime(t) {
  if (!isFinite(t)) return '0,0s';
  return t.toFixed(1).replace('.', ',') + 's';
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

// ============================================================
//  Utsnitt: fra zoom/pan til pikselkoordinater i kilden
// ============================================================

// Største rektangel i målformatets sideforhold som får plass i kilden.
function baseCropSize() {
  const targetAspect = state.outW / state.outH;
  const srcAspect = state.srcW / state.srcH;
  if (srcAspect > targetAspect) {
    return { w: state.srcH * targetAspect, h: state.srcH };
  }
  return { w: state.srcW, h: state.srcW / targetAspect };
}

function currentCrop() {
  const base = baseCropSize();
  const w = base.w / state.zoom;
  const h = base.h / state.zoom;
  const maxX = Math.max(0, state.srcW - w);
  const maxY = Math.max(0, state.srcH - h);
  return {
    w, h,
    x: maxX * state.panX,
    y: maxY * state.panY,
  };
}

// ============================================================
//  Forhåndsvisning
// ============================================================

function layoutStage() {
  if (!state.loaded) return;

  const area = els.canvasArea.getBoundingClientRect();
  const availW = Math.max(50, area.width - 40);
  const availH = Math.max(50, area.height - 40);
  const targetAspect = state.outW / state.outH;

  let stageW = availW;
  let stageH = stageW / targetAspect;
  if (stageH > availH) {
    stageH = availH;
    stageW = stageH * targetAspect;
  }

  els.stage.style.width = stageW + 'px';
  els.stage.style.height = stageH + 'px';

  // Videoen plasseres slik at utsnittet fyller scenen nøyaktig
  const crop = currentCrop();
  const scale = stageW / crop.w;
  els.video.style.width = (state.srcW * scale) + 'px';
  els.video.style.height = (state.srcH * scale) + 'px';
  els.video.style.left = (-crop.x * scale) + 'px';
  els.video.style.top = (-crop.y * scale) + 'px';

  // Radius og rammetykkelse skaleres ned til forhåndsvisningen, slik at
  // proporsjonene stemmer med det som faktisk eksporteres.
  const previewScale = stageW / state.outW;
  const r = state.radius * previewScale;

  // Scenen klipper selv videoen — da ser man rutemønsteret bak i hjørnene,
  // altså nøyaktig det som blir gjennomsiktig i den ferdige filen.
  els.stage.style.borderRadius = r + 'px';

  if (state.borderOn) {
    const bw = Math.max(1, state.borderWidth * previewScale);
    els.stageFrame.style.border = bw + 'px solid ' + state.borderColor;
    els.stageFrame.style.borderRadius = r + 'px';
    els.stageFrame.style.display = 'block';
  } else {
    els.stageFrame.style.display = 'none';
  }
}

function applyPreviewBg() {
  const isChecker = state.previewBg === 'checker';
  els.canvasArea.classList.toggle('bg-checker', isChecker);
  if (isChecker) {
    els.canvasArea.style.removeProperty('background-color');
  } else {
    els.canvasArea.style.backgroundColor = state.previewBg;
  }
}

// ============================================================
//  Maske og ramme som PNG
// ============================================================

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y,     x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x,     y + h, rr);
    ctx.arcTo(x,     y + h, x,     y,     rr);
    ctx.arcTo(x,     y,     x + w, y,     rr);
    ctx.closePath();
  }
}

// Gråtonemaske: hvitt = synlig video, svart = gjennomsiktig.
// ffmpeg leser luminansen som alfaverdi via format=gray + alphamerge.
function buildMaskPng() {
  const c = document.createElement('canvas');
  c.width = state.outW;
  c.height = state.outH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, state.outW, state.outH);
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, 0, 0, state.outW, state.outH, state.radius);
  ctx.fill();
  return c.toDataURL('image/png');
}

// Ramme som RGBA-PNG. Strøket tegnes med halv tykkelse innafor kanten slik
// at ytterkanten treffer nøyaktig samme kurve som masken — ellers ville
// halve rammen blitt klippet bort.
function buildBorderPng() {
  if (!state.borderOn || state.borderWidth < 1) return null;
  const c = document.createElement('canvas');
  c.width = state.outW;
  c.height = state.outH;
  const ctx = c.getContext('2d');
  const bw = state.borderWidth;
  ctx.strokeStyle = state.borderColor;
  ctx.lineWidth = bw;
  roundRectPath(ctx, bw / 2, bw / 2, state.outW - bw, state.outH - bw,
                Math.max(0, state.radius - bw / 2));
  ctx.stroke();
  return c.toDataURL('image/png');
}

// ============================================================
//  Video-lasting
// ============================================================

// Returnerer true når videoen er lastet, false ved feil — kallerne bruker
// det til å avgjøre om de skal prøve igjen.
async function loadVideo(srcOverride) {
  const src = srcOverride || els.url.value.trim();
  if (!src) { setStatus('Lim inn URL til en video.', true); return false; }
  if (!srcOverride && !isValidUrl(src)) { setStatus('Ugyldig URL.', true); return false; }

  setStatus('Laster video…');
  els.video.src = src;

  return await new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('Kunne ikke laste videoen.')); };
    function cleanup() {
      els.video.removeEventListener('loadedmetadata', onMeta);
      els.video.removeEventListener('error', onErr);
    }
    els.video.addEventListener('loadedmetadata', onMeta);
    els.video.addEventListener('error', onErr);
  }).then(() => {
    state.url = srcOverride ? '' : src;
    state.srcW = els.video.videoWidth;
    state.srcH = els.video.videoHeight;
    state.duration = els.video.duration;
    state.loaded = true;
    state.trimStart = 0;
    state.trimEnd = null;
    state.zoom = 1;
    state.panX = 0.5;
    state.panY = 0.5;
    els.zoomRange.value = 100;

    els.canvasEmpty.style.display = 'none';
    els.stage.style.display = 'block';
    // Spol litt inn så første bilde faktisk tegnes — et <video> uten
    // avspilling viser ellers bare svart til man trykker play
    try { els.video.currentTime = Math.min(0.1, state.duration / 2); } catch (e) {}
    setStatus('Lastet · ' + state.srcW + '×' + state.srcH + ' · ' + fmtTime(state.duration));
    layoutStage();
    renderTimeline();
    updateButtons();
    scheduleSaveState();
    return true;
  }).catch(err => {
    setStatus(err.message, true);
    state.loaded = false;
    updateButtons();
    return false;
  });
}

// ============================================================
//  Tidslinje
// ============================================================

function effTrimEnd() {
  return state.trimEnd === null ? state.duration : state.trimEnd;
}

function renderTimeline() {
  if (!state.loaded) return;
  const dur = state.duration || 1;
  const a = state.trimStart / dur;
  const b = effTrimEnd() / dur;

  els.trimSel.style.left = (a * 100) + '%';
  els.trimSel.style.width = ((b - a) * 100) + '%';
  els.trimStart.style.left = (a * 100) + '%';
  els.trimEnd.style.left = (b * 100) + '%';

  els.labelDur.textContent = fmtTime(dur);
  const clipLen = effTrimEnd() - state.trimStart;
  els.labelClip.textContent = 'Klipp: ' + fmtTime(clipLen);

  const trimmed = state.trimStart > 0.01 || state.trimEnd !== null;
  els.exportTrimInfo.style.display = trimmed ? 'flex' : 'none';
  if (trimmed) {
    els.exportTrimText.textContent =
      'Utsnitt ' + fmtTime(state.trimStart) + '–' + fmtTime(effTrimEnd());
  }
}

function renderPlayhead() {
  if (!state.loaded) return;
  const p = (els.video.currentTime / (state.duration || 1)) * 100;
  els.playhead.style.left = p + '%';
  els.labelPos.textContent = fmtTime(els.video.currentTime);
}

els.video.addEventListener('timeupdate', () => {
  renderPlayhead();
  // Hold avspillingen innenfor utsnittet så forhåndsvisningen viser
  // nøyaktig det som blir eksportert
  if (els.video.currentTime >= effTrimEnd() - 0.02) {
    els.video.currentTime = state.trimStart;
  }
});

function seekFromEvent(e, track) {
  const r = track.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  return p * state.duration;
}

els.ruler.addEventListener('click', e => {
  if (!state.loaded) return;
  els.video.currentTime = seekFromEvent(e, els.ruler);
});

function bindTrimHandle(handle, which) {
  handle.addEventListener('pointerdown', e => {
    if (!state.loaded) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const move = ev => {
      const t = seekFromEvent(ev, els.trimTrack);
      if (which === 'start') {
        state.trimStart = Math.max(0, Math.min(t, effTrimEnd() - 0.2));
        els.video.currentTime = state.trimStart;
      } else {
        state.trimEnd = Math.min(state.duration, Math.max(t, state.trimStart + 0.2));
      }
      renderTimeline();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      scheduleSaveState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
bindTrimHandle(els.trimStart, 'start');
bindTrimHandle(els.trimEnd, 'end');

els.trimResetBtn.addEventListener('click', () => {
  state.trimStart = 0;
  state.trimEnd = null;
  renderTimeline();
  scheduleSaveState();
});

els.playBtn.addEventListener('click', () => {
  if (!state.loaded) return;
  if (els.video.paused) {
    if (els.video.currentTime < state.trimStart || els.video.currentTime >= effTrimEnd()) {
      els.video.currentTime = state.trimStart;
    }
    els.video.play();
    els.playBtn.textContent = '❚❚';
  } else {
    els.video.pause();
    els.playBtn.textContent = '▶';
  }
});
els.video.addEventListener('pause', () => { els.playBtn.textContent = '▶'; });
els.video.addEventListener('play', () => { els.playBtn.textContent = '❚❚'; });

document.querySelectorAll('.tl-speed').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tl-speed').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    els.video.playbackRate = parseFloat(btn.dataset.rate);
  });
});

// ============================================================
//  Dra for å plassere utsnittet
// ============================================================

// Rull eller knip i forhåndsvisningen for å zoome. Punktet under pekeren
// står stille, så man zoomer inn mot det man peker på. Dobbeltklikk = 100 %.
function setZoomAt(z, fx, fy) {
  const before = currentCrop();
  const px = before.x + fx * before.w, py = before.y + fy * before.h;
  state.zoom = Math.max(1, Math.min(3, z));
  const base = baseCropSize();
  const w = base.w / state.zoom, h = base.h / state.zoom;
  const maxX = state.srcW - w, maxY = state.srcH - h;
  state.panX = maxX > 0.5 ? Math.max(0, Math.min(1, (px - fx * w) / maxX)) : 0.5;
  state.panY = maxY > 0.5 ? Math.max(0, Math.min(1, (py - fy * h) / maxY)) : 0.5;
  els.zoomRange.value = Math.round(state.zoom * 100);
  els.zoomVal.textContent = Math.round(state.zoom * 100) + ' %';
  layoutStage();
  scheduleSaveState();
}
els.stage.addEventListener('wheel', e => {
  if (!state.loaded) return;
  e.preventDefault();
  const r = els.stage.getBoundingClientRect();
  const k = e.ctrlKey ? 0.01 : 0.002; // knip på styreflaten kommer som ctrl+wheel
  setZoomAt(state.zoom * Math.exp(-e.deltaY * k), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}, { passive: false });
els.stage.addEventListener('dblclick', () => { if (state.loaded) setZoomAt(1, 0.5, 0.5); });

els.stage.addEventListener('pointerdown', e => {
  if (!state.loaded) return;
  e.preventDefault();
  els.stage.setPointerCapture(e.pointerId);
  els.stage.classList.add('is-dragging');

  const startX = e.clientX, startY = e.clientY;
  const startPanX = state.panX, startPanY = state.panY;
  const crop = currentCrop();
  const stageW = els.stage.getBoundingClientRect().width;
  const scale = stageW / crop.w;
  const maxX = Math.max(1, state.srcW - crop.w);
  const maxY = Math.max(1, state.srcH - crop.h);

  const move = ev => {
    const dx = (ev.clientX - startX) / scale;
    const dy = (ev.clientY - startY) / scale;
    state.panX = Math.max(0, Math.min(1, startPanX - dx / maxX));
    state.panY = Math.max(0, Math.min(1, startPanY - dy / maxY));
    layoutStage();
  };
  const up = () => {
    els.stage.removeEventListener('pointermove', move);
    els.stage.removeEventListener('pointerup', up);
    els.stage.classList.remove('is-dragging');
    scheduleSaveState();
  };
  els.stage.addEventListener('pointermove', move);
  els.stage.addEventListener('pointerup', up);
});

// ============================================================
//  Kontroller
// ============================================================

els.fmtGrid.addEventListener('click', e => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  state.outW = parseInt(btn.dataset.w, 10);
  state.outH = parseInt(btn.dataset.h, 10);
  layoutStage();
  updateExportNote();
  scheduleSaveState();
});

els.radiusRange.addEventListener('input', () => {
  state.radius = parseInt(els.radiusRange.value, 10);
  els.radiusVal.textContent = state.radius + ' px';
  document.querySelectorAll('.preset-btn').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.radius, 10) === state.radius);
  });
  layoutStage();
  scheduleSaveState();
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.radius = parseInt(btn.dataset.radius, 10);
    els.radiusRange.value = state.radius;
    els.radiusVal.textContent = state.radius + ' px';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    layoutStage();
    scheduleSaveState();
  });
});

// Forvalg for presentasjonsmalen: format + radius som gir samme hjørner
// som bildene i Keynote-malen (23 px på et 1920×1080-lysbilde), uten ramme.
//   Mobil 1080×1920 vises i 511×907  → 48 px i klippet ≈ 23 px i lysbildet
//   Bred 1920×1080 vises i 1152×648  → 40 px i klippet = 24 px i lysbildet
//   Mobil 1080×1920 vises i 338×600 (fire side om side) → 72 px ≈ 23 px
// Regel: radius i klippet = 23 × (klippets bredde / feltets bredde), rundet til 4.
function syncKeynotePresets() {
  document.querySelectorAll('.kn-btn').forEach(b => {
    b.classList.toggle('on',
      parseInt(b.dataset.w, 10) === state.outW &&
      parseInt(b.dataset.h, 10) === state.outH &&
      parseInt(b.dataset.radius, 10) === state.radius &&
      !state.borderOn);
  });
}
document.querySelectorAll('.kn-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.outW = parseInt(btn.dataset.w, 10);
    state.outH = parseInt(btn.dataset.h, 10);
    document.querySelectorAll('.fmt-btn').forEach(b => {
      b.classList.toggle('on',
        parseInt(b.dataset.w, 10) === state.outW && parseInt(b.dataset.h, 10) === state.outH);
    });
    state.radius = parseInt(btn.dataset.radius, 10);
    els.radiusRange.value = state.radius;
    els.radiusVal.textContent = state.radius + ' px';
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.classList.toggle('on', parseInt(b.dataset.radius, 10) === state.radius);
    });
    state.borderOn = false;
    els.borderOn.checked = false;
    els.borderCtl.style.display = 'none';
    layoutStage();
    updateExportNote();
    syncKeynotePresets();
    scheduleSaveState();
  });
});
// Hold markeringen riktig når format, radius eller ramme endres for hånd
['click', 'input', 'change'].forEach(ev =>
  document.querySelector('.plugin-sidebar, body').addEventListener(ev, () => setTimeout(syncKeynotePresets, 0)));

els.borderOn.addEventListener('change', () => {
  state.borderOn = els.borderOn.checked;
  els.borderCtl.style.display = state.borderOn ? 'flex' : 'none';
  layoutStage();
  scheduleSaveState();
});

els.borderWidth.addEventListener('input', () => {
  state.borderWidth = parseInt(els.borderWidth.value, 10);
  els.borderWidthVal.textContent = state.borderWidth + ' px';
  layoutStage();
  scheduleSaveState();
});

function setBorderColor(hex) {
  state.borderColor = hex;
  els.borderColor.value = hex;
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('on', s.dataset.color.toUpperCase() === hex.toUpperCase());
  });
  layoutStage();
  scheduleSaveState();
}

els.swatches.addEventListener('click', e => {
  const sw = e.target.closest('.swatch');
  if (sw) setBorderColor(sw.dataset.color);
});
els.borderColor.addEventListener('input', () => setBorderColor(els.borderColor.value));

els.zoomRange.addEventListener('input', () => {
  state.zoom = parseInt(els.zoomRange.value, 10) / 100;
  els.zoomVal.textContent = els.zoomRange.value + ' %';
  layoutStage();
  scheduleSaveState();
});

document.querySelectorAll('.bg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    state.previewBg = btn.dataset.bg;
    applyPreviewBg();
  });
});

els.proresOpt.addEventListener('change', updateExportNote);
els.loopOpt.addEventListener('change', scheduleSaveState);
els.audioOpt.addEventListener('change', () => {
  updateExportNote();
  syncLoopAvailability();
  // La forhåndsvisningen høres når lyden skal bli med, så man kan
  // kontrollere den før eksport
  els.video.muted = !els.audioOpt.checked;
  scheduleSaveState();
});

// Looping og lyd hører ikke sammen: et klipp med tale eller musikk skal
// spilles én gang, ikke gå i løkke. Gjør derfor loop-valget utilgjengelig
// når lyden beholdes, i stedet for å la begge stå på.
function syncLoopAvailability() {
  const hasAudio = els.audioOpt.checked;
  els.video.muted = !hasAudio;
  els.loopOpt.disabled = hasAudio;
  els.loopLabel.style.opacity = hasAudio ? '0.4' : '';
  els.loopHint.style.opacity = hasAudio ? '0.4' : '';
  els.loopHint.textContent = hasAudio
    ? 'Utilgjengelig når lyden beholdes — klipp med lyd bør spilles én gang.'
    : 'Kutter siste bilde, så klippet ikke hakker der løkken starter på nytt.';
}

function updateExportNote() {
  const codec = els.proresOpt.checked ? 'ProRes 4444' : 'HEVC med alfakanal';
  const size = els.proresOpt.checked
    ? 'store filer, men maksimal kvalitet'
    : 'små filer — typisk noen få MB';
  const audio = els.audioOpt.checked ? 'med lyd (AAC)' : 'uten lyd';
  els.exportNote.textContent = codec + ' · ' + size + ' · ' + audio;
}

function updateButtons() {
  els.exportBtn.disabled = !state.loaded || state.exporting;
}

// ============================================================
//  Eksport
// ============================================================

els.exportBtn.addEventListener('click', async () => {
  if (!state.loaded || state.exporting) return;

  const base = (state.url || state.localPath || 'klipp')
    .split('/').pop().replace(/\.[^.]+$/, '') || 'klipp';
  const savePath = await window.faktisk.saveDialog({
    title: 'Eksporter Keynote-klipp',
    defaultPath: base + '-keynote.mov',
    filters: [{ name: 'QuickTime-film', extensions: ['mov'] }],
  });
  if (!savePath) return;

  state.exporting = true;
  updateButtons();
  els.exportProgress.style.display = 'block';
  els.exportBar.style.width = '0%';

  const unsub = window.faktisk.onKeynoteProgress(msg => {
    if (msg.phase === 'downloading') {
      setStatus('Laster ned kildevideo…');
    } else if (msg.phase === 'encoding') {
      setStatus('Rendrer… ' + msg.percent + '%');
      els.exportBar.style.width = msg.percent + '%';
    } else if (msg.phase === 'done') {
      els.exportBar.style.width = '100%';
    }
  });

  try {
    const crop = currentCrop();
    // Looping: trekk fra én frame på slutten så første og siste bilde ikke
    // blir liggende oppå hverandre når Keynote spiller klippet i løkke
    let trimEnd = effTrimEnd();
    if (els.loopOpt.checked && !els.audioOpt.checked && trimEnd - state.trimStart > 0.2) {
      trimEnd -= 1 / 30;
    }

    const res = await window.faktisk.keynoteExport({
      url: state.url || undefined,
      inputPath: state.localPath || undefined,
      savePath,
      outWidth: state.outW,
      outHeight: state.outH,
      cropX: crop.x, cropY: crop.y, cropW: crop.w, cropH: crop.h,
      maskPng: buildMaskPng(),
      borderPng: buildBorderPng(),
      trimStart: state.trimStart,
      trimEnd,
      duration: state.duration,
      codec: els.proresOpt.checked ? 'prores' : 'hevc',
      keepAudio: els.audioOpt.checked,
    });

    if (res.ok) {
      setStatus('Ferdig ✓ ' + (res.sizeMB ? res.sizeMB + ' MB' : ''));
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

// ============================================================
//  Labrador-filer
// ============================================================

const labEls = {
  filesBtn:  document.getElementById('labFilesBtn'),
  uploadBtn: document.getElementById('labUploadBtn'),
  panel:     document.getElementById('labPanel'),
  status:    document.getElementById('labPanelStatus'),
  list:      document.getElementById('labPanelList'),
};

const VIDEO_EXT = /\.(mp4|mov|mpg|mpeg|m4v|webm)(\?|$)/i;

async function useLabradorUrl(url) {
  els.url.value = url;
  state.localPath = '';
  labEls.panel.style.display = 'none';

  // Nyopplastede filer er ikke alltid tilgjengelige med én gang — prøv noen
  // ganger med økende pause før vi gir opp
  for (const wait of [0, 1200, 2500]) {
    if (wait) {
      setStatus('Venter på at Labrador gjør filen klar…');
      await new Promise(r => setTimeout(r, wait));
    }
    if (await loadVideo()) return;
  }
  setStatus('Fant ikke videoen på Labrador. Trykk «Hent video» om litt.', true);
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
  labEls.status.textContent = videos.length
    ? videos.length + ' videoer (nyeste først)'
    : 'Ingen videoer lastet opp ennå.';

  videos.slice(0, 60).forEach(f => {
    const row = document.createElement('div');
    row.className = 'lab-file';
    row.innerHTML = '<span class="lab-file__type video">VIDEO</span>'
      + '<span class="lab-file__name"></span>';
    row.querySelector('.lab-file__name').textContent = f.name;
    row.title = f.url;
    row.addEventListener('click', () => useLabradorUrl(f.url));
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
  const unsubProgress = window.faktisk.onLabradorUploadProgress(msg => {
    els.exportProgress.style.display = 'block';
    els.exportBar.style.width = msg.percent + '%';
    setStatus('Laster opp… ' + msg.percent + '%');
  });
  try {
    const res = await window.faktisk.labradorUpload({
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mpg', 'mpeg'] }],
    });
    if (res.canceled) { setStatus(''); return; }
    if (!res.ok) {
      setStatus('Opplasting feilet: ' + res.error, true);
      if (res.debug) console.warn('[keynote-klipp] opplastingsdetaljer:', res.debug);
      return;
    }
    if (res.url) {
      setStatus('Lastet opp «' + res.name + '» ✓ — henter…');
      await useLabradorUrl(res.url);
    } else {
      setStatus(res.note || 'Lastet opp, men fikk ikke URL tilbake — prøv «Mine filer».', true);
    }
  } catch (err) {
    setStatus('Opplasting feilet: ' + err.message, true);
  } finally {
    unsubProgress();
    labEls.uploadBtn.disabled = false;
    setTimeout(() => { els.exportProgress.style.display = 'none'; els.exportBar.style.width = '0%'; }, 2000);
  }
});

// Lokal fil: Keynote-klipp skal ofte lages fra opptak som aldri skal
// publiseres, så det er ingen grunn til å tvinge dem via Labrador.
els.localFileBtn.addEventListener('click', async () => {
  if (typeof window.faktisk.openFileDialog !== 'function') {
    setStatus('Direktevalg krever Studio 0.6.5 eller nyere.', true);
    return;
  }
  const res = await window.faktisk.openFileDialog({
    title: 'Velg videoklipp',
    filters: [{ name: 'Video', extensions: ['mov', 'mp4', 'm4v', 'webm', 'mpg', 'mpeg', 'avi', 'mkv'] }],
  });
  if (!res || res.canceled || !res.path) return;

  state.localPath = res.path;
  els.url.value = '';
  // Mellomrom og æøå i filnavn må kodes, ellers finner ikke <video> filen
  loadVideo('file://' + encodeURI(res.path).replace(/#/g, '%23'));
});

// ============================================================
//  Navigasjon
// ============================================================

els.loadBtn.addEventListener('click', () => loadVideo());
els.url.addEventListener('keydown', e => { if (e.key === 'Enter') loadVideo(); });
els.back.addEventListener('click', () => window.faktisk.goHome());
els.full.addEventListener('click', () => window.faktisk.toggleFullscreen());
els.openLabrador.addEventListener('click', () =>
  window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file'));

window.addEventListener('resize', layoutStage);

// ============================================================
//  Lagring
// ============================================================

let isRestoring = false;
let saveTimer = null;

function serializeState() {
  return {
    url: state.url,
    localPath: state.localPath,
    outW: state.outW, outH: state.outH,
    radius: state.radius,
    borderOn: state.borderOn,
    borderWidth: state.borderWidth,
    borderColor: state.borderColor,
    zoom: state.zoom,
    panX: state.panX, panY: state.panY,
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    audioOpt: els.audioOpt.checked,
    loopOpt: els.loopOpt.checked,
    proresOpt: els.proresOpt.checked,
  };
}

function scheduleSaveState() {
  if (isRestoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(() => {});
  }, 400);
}

async function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    state.outW = s.outW || 1080;
    state.outH = s.outH || 1920;
    document.querySelectorAll('.fmt-btn').forEach(b => {
      b.classList.toggle('on',
        parseInt(b.dataset.w, 10) === state.outW && parseInt(b.dataset.h, 10) === state.outH);
    });

    state.radius = typeof s.radius === 'number' ? s.radius : 80;
    els.radiusRange.value = state.radius;
    els.radiusVal.textContent = state.radius + ' px';
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.classList.toggle('on', parseInt(b.dataset.radius, 10) === state.radius);
    });

    state.borderOn = !!s.borderOn;
    els.borderOn.checked = state.borderOn;
    els.borderCtl.style.display = state.borderOn ? 'flex' : 'none';
    state.borderWidth = s.borderWidth || 8;
    els.borderWidth.value = state.borderWidth;
    els.borderWidthVal.textContent = state.borderWidth + ' px';
    if (s.borderColor) setBorderColor(s.borderColor);
    syncKeynotePresets();

    state.zoom = s.zoom || 1;
    els.zoomRange.value = Math.round(state.zoom * 100);
    els.zoomVal.textContent = Math.round(state.zoom * 100) + ' %';
    state.panX = typeof s.panX === 'number' ? s.panX : 0.5;
    state.panY = typeof s.panY === 'number' ? s.panY : 0.5;

    els.audioOpt.checked = !!s.audioOpt;
    els.loopOpt.checked = s.loopOpt !== false;
    els.proresOpt.checked = !!s.proresOpt;
    updateExportNote();
    syncLoopAvailability();

    if (s.localPath) {
      state.localPath = s.localPath;
      await loadVideo('file://' + s.localPath);
    } else if (s.url) {
      els.url.value = s.url;
      await loadVideo();
    }

    // Utsnitt settes etter lasting, siden loadVideo nullstiller det
    if (state.loaded) {
      state.trimStart = s.trimStart || 0;
      state.trimEnd = typeof s.trimEnd === 'number' ? s.trimEnd : null;
      renderTimeline();
      layoutStage();
    }
  } finally {
    isRestoring = false;
  }
}

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    els.projectSelect.innerHTML = '<option value="">Velg lagret prosjekt…</option>';
    (res.projects || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.fileId;
      o.textContent = p.name;
      els.projectSelect.appendChild(o);
    });
  } catch (e) {}
}

els.saveProject.addEventListener('click', async () => {
  const name = await window.faktiskDialog.prompt('Navn på prosjektet:', '');
  if (!name) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name, serializeState());
  if (res.ok) {
    setStatus('Lagret «' + name + '» ✓');
    refreshProjectList();
  } else {
    setStatus('Kunne ikke lagre: ' + res.error, true);
  }
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) await applyState(res.state);
});

// ============================================================
//  Init
// ============================================================

(async function init() {
  updateExportNote();
  syncLoopAvailability();
  applyPreviewBg();
  els.stage.style.display = 'none';
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
