// Faktisk Studio · Klippsamler
//
// Bevisst avgrenset: legg til klipp, trim hvert av dem, ordne rekkefølgen,
// eksporter samlet i valgt format — med eller uten lyd. INGEN tidslinje,
// spor, musikk eller effekter; det er Final Cut sin jobb.
//
// Eksporten skjer i Studios sequence-export-IPC: hvert klipp trimmes,
// skaleres/beskjæres til felles format (sentrert utfylling) og settes
// sammen med normalisert lyd (48 kHz stereo; stille spor for klipp uten
// lyd) eller helt uten lydspor.

const PLUGIN_ID = 'klippsamler';

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
  addLocalBtn:  document.getElementById('addLocalBtn'),
  url:          document.getElementById('videoUrl'),
  loadBtn:      document.getElementById('loadVideoBtn'),
  status:       document.getElementById('status'),
  back:         document.getElementById('backBtn'),
  full:         document.getElementById('fullscreenBtn'),
  openLabrador: document.getElementById('openLabradorBtn'),

  clipSection:  document.getElementById('clipSection'),
  clipList:     document.getElementById('clipList'),
  totalDur:     document.getElementById('totalDur'),

  trimBox:      document.getElementById('trimBox'),
  setInBtn:     document.getElementById('setInBtn'),
  setOutBtn:    document.getElementById('setOutBtn'),
  resetTrimBtn: document.getElementById('resetTrimBtn'),
  trimInfo:     document.getElementById('trimInfo'),

  formatSelect: document.getElementById('formatSelect'),
  keepAudio:    document.getElementById('keepAudio'),

  video:        document.getElementById('videoEl'),
  empty:        document.getElementById('emptyState'),

  exportBtn:    document.getElementById('exportBtn'),
  progress:     document.getElementById('progress'),
  progressBar:  document.getElementById('progressBar'),
  progressNote: document.getElementById('progressNote'),

  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
  playAllBtn:    document.getElementById('playAllBtn'),
};

const state = {
  // Klipp: { id, name, localPath?, url?, duration, start, end }
  clips: [],
  selectedId: null,
  exporting: false,
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

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

function fmtTime(t) {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

function clipSrc(c) {
  return c.localPath
    ? 'file://' + encodeURI(c.localPath).replace(/#/g, '%23')
    : c.url;
}

function clipDur(c) {
  return Math.max(0, (c.end ?? c.duration) - (c.start || 0));
}

// Les varigheten av et klipp ved å laste metadata i et frakoblet element
function probeDuration(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve(v.duration);
    v.onerror = () => reject(new Error('Kunne ikke lese videoen.'));
    v.src = src;
  });
}

// ============================================================
//  Legge til klipp
// ============================================================

async function addClip({ localPath, url, name }) {
  if (state.clips.length >= 20) { setStatus('Maks 20 klipp.', true); return; }
  const id = 'c_' + Math.random().toString(36).slice(2, 7);
  const src = localPath
    ? 'file://' + encodeURI(localPath).replace(/#/g, '%23')
    : url;
  setStatus('Leser klippet…');
  try {
    const duration = await probeDuration(src);
    state.clips.push({
      id, name, localPath: localPath || '', url: url || '',
      duration, start: 0, end: duration,
    });
    selectClip(id);
    setStatus('La til «' + name + '» · ' + fmtTime(duration));
    scheduleSaveState();
  } catch (e) {
    setStatus(e.message, true);
  }
}

els.addLocalBtn.addEventListener('click', async () => {
  const res = await window.faktisk.openFileDialog({
    title: 'Velg videoklipp',
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mpg', 'mpeg', 'm4v', 'webm'] }],
    properties: ['openFile', 'multiSelections'],
  });
  const paths = (res && res.filePaths) || [];
  for (const p of paths) {
    await addClip({ localPath: p, name: p.split('/').pop() });
  }
});

els.loadBtn.addEventListener('click', async () => {
  const url = els.url.value.trim();
  if (!url || !isValidUrl(url)) { setStatus('Ugyldig URL.', true); return; }
  await addClip({ url, name: decodeURIComponent(url.split('/').pop().split('?')[0] || 'klipp') });
  els.url.value = '';
});

// ============================================================
//  Klippliste og rekkefølge
// ============================================================

function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  const [c] = state.clips.splice(i, 1);
  state.clips.splice(j, 0, c);
  renderClips();
  scheduleSaveState();
}

function deleteClip(id) {
  state.clips = state.clips.filter(c => c.id !== id);
  if (state.selectedId === id) {
    state.selectedId = null;
    els.video.pause();
    els.video.style.display = 'none';
    els.empty.style.display = 'flex';
    els.trimBox.style.display = 'none';
  }
  renderClips();
  scheduleSaveState();
}

function selectClip(id) {
  const c = state.clips.find(x => x.id === id);
  if (!c) return;
  if (previewIdx >= 0) { els.video.pause(); stopPreview(); }
  state.selectedId = id;
  els.video.src = clipSrc(c);
  els.video.style.display = 'block';
  els.empty.style.display = 'none';
  els.trimBox.style.display = 'block';
  els.video.currentTime = c.start || 0;
  renderClips();
}

function renderClips() {
  els.clipSection.style.display = state.clips.length ? 'flex' : 'none';
  els.clipList.innerHTML = '';

  state.clips.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'ks-clip' + (state.selectedId === c.id ? ' ks-clip--active' : '');
    const trimmed = (c.start > 0.05 || c.end < c.duration - 0.05);
    row.innerHTML = `
      <span class="ks-clip__num">${i + 1}</span>
      <button class="ks-clip__name" data-act="sel" data-id="${c.id}"
              title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
      <span class="ks-clip__dur${trimmed ? ' ks-clip__dur--trim' : ''}">${fmtTime(clipDur(c))}</span>
      <span class="ks-clip__btns">
        <button class="tb-row__btn" data-act="up" data-id="${c.id}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="tb-row__btn" data-act="down" data-id="${c.id}" title="Flytt ned" ${i === state.clips.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${c.id}" title="Fjern">×</button>
      </span>`;
    els.clipList.appendChild(row);
  });

  els.clipList.onclick = e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'sel') selectClip(id);
    if (act === 'up') moveClip(id, -1);
    if (act === 'down') moveClip(id, 1);
    if (act === 'del') deleteClip(id);
  };

  const total = state.clips.reduce((s, c) => s + clipDur(c), 0);
  els.totalDur.textContent = state.clips.length
    ? state.clips.length + ' klipp · ' + fmtTime(total) + ' totalt'
    : '';
  updateTrimInfo();
  updateButtons();
}

// ============================================================
//  Trim
// ============================================================

function selectedClip() {
  return state.clips.find(c => c.id === state.selectedId) || null;
}

function updateTrimInfo() {
  const c = selectedClip();
  els.trimInfo.textContent = '';
  renderTimeline();
}

// ---- Trimstrek: dra i start-/sluttpunktet, klikk for å spole ----
var tl = {
  box: document.getElementById('tl'), track: document.getElementById('tlTrack'),
  keep: document.getElementById('tlKeep'), hIn: document.getElementById('tlIn'),
  hOut: document.getElementById('tlOut'), ph: document.getElementById('tlPh'),
  inLbl: document.getElementById('tlInLbl'), mid: document.getElementById('tlMid'),
  outLbl: document.getElementById('tlOutLbl'),
};
function renderTimeline() {
  // Kan kalles før resten av skriptet er lest inn (renderClips ved oppstart)
  try { if (!tl || previewIdx === undefined) return; } catch (e) { return; }
  const c = selectedClip();
  if (!c || !c.duration || previewIdx >= 0) { tl.box.hidden = true; return; }
  tl.box.hidden = false;
  const pct = t => (Math.max(0, Math.min(c.duration, t)) / c.duration * 100) + '%';
  tl.keep.style.left = pct(c.start);
  tl.keep.style.width = ((c.end - c.start) / c.duration * 100) + '%';
  tl.hIn.style.left = pct(c.start);
  tl.hOut.style.left = pct(c.end);
  tl.ph.style.left = pct(els.video.currentTime || 0);
  tl.inLbl.textContent = 'Inn ' + fmtTime(c.start);
  tl.mid.textContent = 'Bruker ' + fmtTime(clipDur(c)) + ' av ' + fmtTime(c.duration);
  tl.outLbl.textContent = 'Ut ' + fmtTime(c.end);
}
function timeAt(ev) {
  const c = selectedClip(); const r = tl.track.getBoundingClientRect();
  return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * c.duration;
}
function dragHandle(which) {
  return ev => {
    const c = selectedClip(); if (!c) return;
    ev.preventDefault(); ev.stopPropagation();
    els.video.pause();
    const move = e => {
      const t = timeAt(e);
      if (which === 'in') c.start = Math.max(0, Math.min(t, c.end - 0.2));
      else c.end = Math.min(c.duration, Math.max(t, c.start + 0.2));
      // Vis bildet der man kutter
      els.video.currentTime = which === 'in' ? c.start : c.end;
      renderClips();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      scheduleSaveState();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
}
tl.hIn.addEventListener('pointerdown', dragHandle('in'));
tl.hOut.addEventListener('pointerdown', dragHandle('out'));
tl.track.addEventListener('pointerdown', ev => {
  if (ev.target === tl.hIn || ev.target === tl.hOut || !selectedClip()) return;
  const seek = e => { els.video.currentTime = timeAt(e); renderTimeline(); };
  seek(ev);
  const up = () => { removeEventListener('pointermove', seek); removeEventListener('pointerup', up); };
  addEventListener('pointermove', seek); addEventListener('pointerup', up);
});
els.video.addEventListener('timeupdate', renderTimeline);
els.video.addEventListener('seeked', renderTimeline);
// I og O setter inn/ut der spillehodet står (når man ikke skriver i et felt)
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === 'i' || e.key === 'I') els.setInBtn.click();
  if (e.key === 'o' || e.key === 'O') els.setOutBtn.click();
});

els.setInBtn.addEventListener('click', () => {
  const c = selectedClip();
  if (!c) return;
  c.start = Math.min(els.video.currentTime, c.end - 0.2);
  renderClips();
  scheduleSaveState();
});

els.setOutBtn.addEventListener('click', () => {
  const c = selectedClip();
  if (!c) return;
  c.end = Math.max(els.video.currentTime, c.start + 0.2);
  renderClips();
  scheduleSaveState();
});

els.resetTrimBtn.addEventListener('click', () => {
  const c = selectedClip();
  if (!c) return;
  c.start = 0;
  c.end = c.duration;
  renderClips();
  scheduleSaveState();
});

// ============================================================
//  Gjennomspilling av hele redigeringen
// ============================================================
//
// Spiller klippene i rekkefølge med trimming — slik eksporten blir.
// Kildebyttet mellom klipp gir et knapt merkbart hopp i forhåndsvisningen;
// selve eksporten er sømløs.

let previewIdx = -1;      // -1 = ikke i gjennomspilling
let previewSwitching = false;

function stopPreview(msg) {
  previewIdx = -1;
  previewSwitching = false;
  els.playAllBtn.textContent = '▶ Spill gjennom redigeringen';
  if (msg) setStatus(msg);
  renderTimeline();
}

function previewPlayClip(idx) {
  const c = state.clips[idx];
  if (!c) { els.video.pause(); stopPreview('Gjennomspilling ferdig ✓'); return; }
  previewIdx = idx;
  previewSwitching = true;
  state.selectedId = c.id;
  renderClips();
  els.video.src = clipSrc(c);
  els.video.style.display = 'block';
  els.empty.style.display = 'none';
  els.trimBox.style.display = 'block';
  const onReady = () => {
    els.video.removeEventListener('canplay', onReady);
    if (previewIdx !== idx) return; // stoppet i mellomtiden
    els.video.currentTime = c.start || 0;
    els.video.play().catch(() => stopPreview());
    // Litt slark før pause-lytteren armeres igjen
    setTimeout(() => { previewSwitching = false; }, 300);
  };
  els.video.addEventListener('canplay', onReady);
}

els.playAllBtn.addEventListener('click', () => {
  if (previewIdx >= 0) {
    els.video.pause();
    stopPreview('Gjennomspilling stoppet.');
    return;
  }
  if (!state.clips.length) return;
  els.playAllBtn.textContent = '◼ Stopp gjennomspillingen';
  setStatus('Spiller gjennom ' + state.clips.length + ' klipp…');
  previewPlayClip(0);
});

// Stopp/hopp ved ut-punktet: i gjennomspilling → neste klipp,
// ellers → pause. Ved vanlig avspilling starter vi fra inn-punktet.
els.video.addEventListener('timeupdate', () => {
  if (previewIdx >= 0) {
    const c = state.clips[previewIdx];
    if (c && els.video.currentTime >= c.end - 0.03) {
      previewPlayClip(previewIdx + 1);
    }
    return;
  }
  const c = selectedClip();
  if (!c) return;
  if (els.video.currentTime >= c.end - 0.03 && !els.video.paused) {
    els.video.pause();
  }
});
els.video.addEventListener('ended', () => {
  if (previewIdx >= 0) previewPlayClip(previewIdx + 1);
});
els.video.addEventListener('play', () => {
  if (previewIdx >= 0) return;
  const c = selectedClip();
  if (!c) return;
  if (els.video.currentTime < c.start || els.video.currentTime >= c.end - 0.05) {
    els.video.currentTime = c.start;
  }
});
// Bruker som pauser manuelt avbryter gjennomspillingen
els.video.addEventListener('pause', () => {
  if (previewIdx >= 0 && !previewSwitching && !els.video.ended) {
    stopPreview('Gjennomspilling stoppet.');
  }
});

// ============================================================
//  Eksport
// ============================================================

function updateButtons() {
  els.exportBtn.disabled = state.clips.length < 1 || state.exporting;
}

const PHASE_LABELS = {
  downloading: 'Henter klipp fra Labrador…',
  encoding: 'Setter sammen og komprimerer…',
};

els.exportBtn.addEventListener('click', async () => {
  if (!state.clips.length || state.exporting) return;

  const fmt = els.formatSelect.value;
  let outWidth = null, outHeight = null;
  if (fmt !== 'source') {
    const [w, h] = fmt.split('x').map(Number);
    outWidth = w;
    outHeight = h;
  }

  const savePath = await window.faktisk.saveDialog({
    title: 'Eksporter samlet klipp',
    defaultPath: 'samlet-klipp.mp4',
    filters: [{ name: 'MP4-video', extensions: ['mp4'] }],
  });
  if (!savePath) return;

  state.exporting = true;
  updateButtons();
  els.progress.style.display = 'block';
  els.progressBar.style.width = '0%';
  els.progressNote.textContent = 'Klippene kodes om til felles format — dette kan ta litt tid.';

  const unsub = window.faktisk.onSequenceProgress(msg => {
    const label = PHASE_LABELS[msg.phase] || msg.phase;
    setStatus(label + (typeof msg.percent === 'number' ? ' ' + msg.percent + '%' : ''));
    if (typeof msg.percent === 'number') els.progressBar.style.width = msg.percent + '%';
  });

  try {
    const res = await window.faktisk.sequenceExport({
      clips: state.clips.map(c => ({
        inputPath: c.localPath || undefined,
        url: c.url || undefined,
        start: c.start,
        end: c.end,
      })),
      savePath,
      outWidth,
      outHeight,
      keepAudio: els.keepAudio.checked,
    });
    if (res.ok) {
      setStatus('Eksportert ✓ ' + savePath.split('/').pop()
        + ' (' + res.width + '×' + res.height
        + (res.sizeMB ? ', ' + res.sizeMB + ' MB' : '') + ')');
      await window.faktisk.revealInFinder(savePath);
    } else {
      setStatus('Eksport feilet: ' + res.error, true);
    }
  } catch (err) {
    setStatus('Eksport feilet: ' + err.message, true);
  } finally {
    unsub();
    state.exporting = false;
    els.progressNote.textContent = '';
    updateButtons();
    setTimeout(() => { els.progress.style.display = 'none'; }, 2000);
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
    clips: state.clips,
    format: els.formatSelect.value,
    keepAudio: els.keepAudio.checked,
  };
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    if (saved.format) els.formatSelect.value = saved.format;
    if (typeof saved.keepAudio === 'boolean') els.keepAudio.checked = saved.keepAudio;
    if (Array.isArray(saved.clips)) {
      state.clips = saved.clips;
      renderClips();
      if (state.clips.length) selectClip(state.clips[0].id);
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
['change'].forEach(ev => {
  els.formatSelect.addEventListener(ev, scheduleSaveState);
  els.keepAudio.addEventListener(ev, scheduleSaveState);
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
  const defaultName = 'Klippsamler ' + new Date().toLocaleDateString('no');
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
  renderClips();
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
