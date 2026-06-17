// Faktisk Studio · Videoavspiller-plugin

const PLUGIN_ID = 'video-player';

// Vis app-versjon + plugin-versjon i topp-bar (dynamisk fra manifest)
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
  trimTrack:     document.getElementById('trimTrack'),
  trimSelection: document.getElementById('trimSelection'),
  handleStart:   document.getElementById('handleStart'),
  handleEnd:     document.getElementById('handleEnd'),
  posterTrack:   document.getElementById('posterTrack'),
  handlePoster:  document.getElementById('handlePoster'),
  labelStart:    document.getElementById('labelStart'),
  labelEnd:      document.getElementById('labelEnd'),
  labelDuration: document.getElementById('labelDuration'),
  labelPoster:   document.getElementById('labelPoster'),
  copyEmbed:     document.getElementById('copyEmbedBtn'),
  status:        document.getElementById('status'),
  back:          document.getElementById('backBtn'),
  full:          document.getElementById('fullscreenBtn'),
  captionText:   document.getElementById('captionText'),
  photographer:  document.getElementById('photographerText'),
  openLabrador:  document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

const state = {
  url: '',
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  posterTime: 1,
  loaded: false,
  posterDataUrl: null,
  posterForKey: null,
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
    updateExportButtons();
    return null;
  });

  if (!els.video.duration || !isFinite(els.video.duration)) {
    setStatus('Klarte ikke å lese videoens lengde.', true);
    return;
  }

  if (state.url !== url) {
    state.posterDataUrl = null;
    state.posterForKey = null;
  }

  state.url = url;
  state.duration = els.video.duration;
  state.trimStart = 0;
  state.trimEnd = state.duration;
  state.posterTime = Math.min(1, state.duration / 4);
  state.loaded = true;

  els.empty.classList.add('hidden');
  renderTimelines();
  updateExportButtons();
  setStatus(`Lastet · ${Math.round(els.video.videoWidth)}×${Math.round(els.video.videoHeight)} · ${formatSec(state.duration)}`);
  scheduleSaveState();
  schedulePoster();
}

let posterTimer = null;
function schedulePoster() {
  clearTimeout(posterTimer);
  posterTimer = setTimeout(async () => {
    if (!state.loaded || !state.url) return;
    const key = state.url + '@' + state.posterTime.toFixed(2);
    if (state.posterForKey === key && state.posterDataUrl) return;
    const origStatus = els.status.textContent;
    setStatus('Genererer stillbilde…');
    try {
      const res = await window.faktisk.generateThumbnail({
        url: state.url,
        atTime: state.posterTime,
      });
      if (res.ok) {
        state.posterDataUrl = res.dataUrl;
        state.posterForKey = key;
        setStatus(origStatus);
      } else {
        console.warn('Stillbilde feilet:', res.error);
        setStatus(origStatus);
      }
    } catch (e) {
      console.warn(e);
      setStatus(origStatus);
    }
  }, 700);
}

function renderTimelines() {
  const dur = state.duration;
  if (!dur) return;
  // Trim
  const startPct = (state.trimStart / dur) * 100;
  const endPct = (state.trimEnd / dur) * 100;
  els.handleStart.style.left = startPct + '%';
  els.handleEnd.style.left = endPct + '%';
  els.trimSelection.style.left = startPct + '%';
  els.trimSelection.style.width = (endPct - startPct) + '%';
  els.labelStart.textContent = formatSec(state.trimStart);
  els.labelEnd.textContent = formatSec(state.trimEnd);
  els.labelDuration.textContent = formatSec(state.trimEnd - state.trimStart);
  // Poster (clamped innenfor trim)
  state.posterTime = Math.max(state.trimStart, Math.min(state.posterTime, state.trimEnd));
  const posterPct = (state.posterTime / dur) * 100;
  els.handlePoster.style.left = posterPct + '%';
  els.labelPoster.textContent = formatSec(state.posterTime);
}

function formatSec(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m + 'm ' + sec.replace('.', ',') + 's';
  }
  return s.toFixed(1).replace('.', ',') + 's';
}

function attachHandleDrag(handle, kind, track) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect = track.getBoundingClientRect();
    const startTS = state.trimStart;
    const startTE = state.trimEnd;
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const pct = x / rect.width;
      const t = pct * state.duration;
      if (kind === 'start') {
        state.trimStart = Math.max(0, Math.min(t, state.trimEnd - 0.5));
      } else if (kind === 'end') {
        state.trimEnd = Math.min(state.duration, Math.max(t, state.trimStart + 0.5));
      } else if (kind === 'poster') {
        state.posterTime = Math.max(state.trimStart, Math.min(t, state.trimEnd));
      }
      renderTimelines();
      if (kind !== 'poster') {
        // sync preview
        if (els.video.currentTime < state.trimStart || els.video.currentTime > state.trimEnd) {
          els.video.currentTime = state.trimStart;
        }
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleSaveState();
      if (kind === 'poster' || state.trimStart !== startTS) {
        // poster trenger refresh hvis trim flyttet eller poster ble dratt
        schedulePoster();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

attachHandleDrag(els.handleStart, 'start', els.trimTrack);
attachHandleDrag(els.handleEnd, 'end', els.trimTrack);
attachHandleDrag(els.handlePoster, 'poster', els.posterTrack);

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

function buildEmbedSnippet() {
  const ts = state.trimStart.toFixed(2);
  const te = state.trimEnd.toFixed(2);
  const baseUrl = escapeHtml(state.url.split('#')[0]);
  const id = 'fvp-' + Math.random().toString(36).slice(2, 8);
  const caption = (els.captionText.value || '').trim();
  const photographer = (els.photographer.value || '').trim();
  const hasCaption = caption || photographer;

  // Trim er valgfri — bare bruk media fragment hvis brukeren faktisk har klippet
  const isTrimmed = state.trimStart > 0.1 || state.trimEnd < state.duration - 0.1;
  const srcWithFragment = isTrimmed ? `${baseUrl}#t=${ts},${te}` : baseUrl;

  const captionParts = [];
  if (caption) {
    captionParts.push(`
    <!-- ▶ BILDETEKST -->
    <figcaption itemprop="caption">${escapeHtml(caption)}</figcaption>`);
  }
  if (photographer) {
    captionParts.push(`
    <!-- ▶ FOTOGRAF / KILDE ("Foto: " kommer automatisk) -->
    <figcaption itemprop="author" data-byline-prefix="Foto:">${escapeHtml(photographer)}</figcaption>`);
  }
  const innerCaption = hasCaption ? `

  <div class="caption fvp-caption" style="margin-top:0.5rem;box-sizing:border-box;">${captionParts.join('')}
  </div>` : '';

  const open = hasCaption ? `<figure style="margin:0;">` : '';
  const close = hasCaption ? `</figure>` : '';

  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const aspect = (vw / vh).toFixed(4);

  const posterBg = state.posterDataUrl
    ? `background-image:url('${state.posterDataUrl}');background-size:cover;background-position:center;`
    : 'background:#1a1a1a;';

  return `<!-- ============================================
     FAKTISK · VIDEOAVSPILLER
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <style>
    .fvp-container { container-type: inline-size; }
    @container (min-width: 1080px) {
      .fvp-container > .caption.fvp-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
      }
    }
    @media (max-width: 768px) {
      .fvp-container > .caption.fvp-caption {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
    }
    .fvp-play-${id} {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      /* Responsiv størrelse — mindre på smal embed, større på fullWidth */
      width: clamp(56px, 12cqw, 100px);
      height: clamp(56px, 12cqw, 100px);
      border: 0;
      background: transparent;
      cursor: pointer;
      padding: 0;
      transition: transform 0.1s;
      /* Subtil shadow — overflow:hidden på wrapper ville klippet en stor */
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.25));
    }
    .fvp-play-${id}:hover { transform: translate(-50%, -50%) scale(1.05); }
    .fvp-play-${id} svg { display: block; width: 100%; height: 100%; }
  </style>
  <!-- ▶ VIDEO — bytt ut URL-en under for å bruke et annet klipp -->
  <div class="fvp-container">
    <div style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:8px;overflow:hidden;${posterBg}">
      <video id="${id}" data-src="${srcWithFragment}" playsinline webkit-playsinline preload="none" aria-label="Videoavspiller" style="width:100%;height:100%;display:block;${posterBg}"></video>
      <div id="${id}-cover" style="position:absolute;inset:0;${posterBg}transition:opacity 0.2s;pointer-events:none;"></div>
      <button class="fvp-play-${id}" id="${id}-play" aria-label="Spill av video" type="button">
        <svg viewBox="0 0 230.89 230.89" aria-hidden="true">
          <circle cx="115.45" cy="115.45" r="115.45" fill="#0050fc"/>
          <path fill="#fff" d="M165.51,109.38l-76.8-44.34c-4.67-2.69-10.5.67-10.5,6.06v88.69c0,5.39,5.83,8.76,10.5,6.06l76.8-44.34c4.67-2.69,4.67-9.43,0-12.12Z"/>
        </svg>
      </button>
    </div>${innerCaption}
  </div>
${close}
<script>
(function(){
  var v = document.getElementById('${id}');
  var btn = document.getElementById('${id}-play');
  var cover = document.getElementById('${id}-cover');
  if(!v || !btn) return;
  var S = ${ts};
  var isTrimmed = ${isTrimmed};
  function hideCover(){
    if(cover){
      cover.style.opacity = '0';
      setTimeout(function(){ if(cover) cover.style.display = 'none'; }, 250);
    }
  }
  btn.addEventListener('click', function(){
    btn.style.display = 'none';
    v.src = v.dataset.src;
    // Manuell seek til trim-start når metadata er klar — media fragment alene
    // respekteres ikke alltid umiddelbart, så browser kan glimte frame 0.
    if(isTrimmed){
      v.addEventListener('loadedmetadata', function(){
        v.currentTime = S;
      }, {once:true});
      // Skjul cover først NÅR seek til S er ferdig OG video spiller
      var seekDone = false, playDone = false;
      function maybeHide(){ if(seekDone && playDone) hideCover(); }
      v.addEventListener('seeked', function(){ seekDone = true; maybeHide(); }, {once:true});
      v.addEventListener('playing', function(){
        playDone = true; maybeHide();
        v.controls = true;
      }, {once:true});
    } else {
      // Ingen trim — bare vent på playing
      v.addEventListener('playing', function(){
        hideCover();
        v.controls = true;
      }, {once:true});
    }
    // Fallback: vis video etter 3 sek selv om events aldri fyrer
    setTimeout(hideCover, 3000);
    var p = v.play();
    if(p && p.catch) p.catch(function(){});
  });
})();
</script>
`;
}

function updateExportButtons() {
  els.copyEmbed.disabled = !state.loaded;
}

els.loadBtn.addEventListener('click', loadVideo);
els.url.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadVideo();
});

els.copyEmbed.addEventListener('click', async () => {
  if (!state.loaded) return;
  // Sørg for at poster matcher current valg
  const key = state.url + '@' + state.posterTime.toFixed(2);
  if (state.posterForKey !== key || !state.posterDataUrl) {
    clearTimeout(posterTimer);
    setStatus('Genererer stillbilde før kopiering…');
    const res = await window.faktisk.generateThumbnail({
      url: state.url,
      atTime: state.posterTime,
    });
    if (res.ok) {
      state.posterDataUrl = res.dataUrl;
      state.posterForKey = key;
    }
  }
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

els.back.addEventListener('click', async () => {
  await window.faktisk.goHome();
});
els.full.addEventListener('click', async () => {
  await window.faktisk.toggleFullscreen();
});
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// Arkivering
let isRestoring = false;
function serializeState() {
  return {
    url: els.url.value,
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    posterTime: state.posterTime,
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
      els.url.value = saved.url;
      await loadVideo();
      if (state.loaded) {
        if (typeof saved.trimStart === 'number') state.trimStart = Math.max(0, Math.min(saved.trimStart, state.duration));
        if (typeof saved.trimEnd === 'number') state.trimEnd = Math.max(state.trimStart + 0.5, Math.min(saved.trimEnd, state.duration));
        if (typeof saved.posterTime === 'number') state.posterTime = Math.max(state.trimStart, Math.min(saved.posterTime, state.trimEnd));
        renderTimelines();
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
  els.url.addEventListener(ev, scheduleSaveState);
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
    || `Video ${new Date().toLocaleDateString('no')}`;
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
    } catch (e) { console.error(e); }
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) await applyState(res.state);
  } catch (e) { console.error(e); }
})();
