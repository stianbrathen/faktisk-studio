// Faktisk Studio · Looping Video-plugin

const PLUGIN_ID = 'looping-video';
const PLUGIN_VERSION = '0.5.4';
const MAX_DURATION = 10;
const MIN_DURATION = 1;

// Vis app-versjon + plugin-versjon ved siden av logoen
(async () => {
  try {
    const v = await window.faktisk.appVersion();
    const el = document.getElementById('appVersion');
    if (el && v) el.textContent = 'v' + v + ' · plugin v' + PLUGIN_VERSION;
  } catch (e) {}
})();

const els = {
  url:           document.getElementById('videoUrl'),
  loadBtn:       document.getElementById('loadVideoBtn'),
  video:         document.getElementById('videoEl'),
  empty:         document.getElementById('canvasEmpty'),
  track:         document.getElementById('track'),
  selection:     document.getElementById('selection'),
  handleStart:   document.getElementById('handleStart'),
  handleEnd:     document.getElementById('handleEnd'),
  labelStart:    document.getElementById('labelStart'),
  labelEnd:      document.getElementById('labelEnd'),
  labelDuration: document.getElementById('labelDuration'),
  copyEmbed:     document.getElementById('copyEmbedBtn'),
  exportVideo:   document.getElementById('exportVideoBtn'),
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
  loaded: false,
  thumbnailDataUrl: null,
  thumbnailForTime: null,
  thumbnailForUrl: null,    // cache-key inkluderer URL så vi ikke gjenbruker thumbnail fra annen video
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
  if (!url) {
    setStatus('Lim inn en URL først.', true);
    return;
  }
  if (!isValidUrl(url)) {
    setStatus('Det ser ikke ut som en gyldig URL.', true);
    return;
  }
  setStatus('Laster…');
  els.video.src = url;
  await new Promise((resolve, reject) => {
    const onMeta = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('Kunne ikke laste videoen — sjekk URL.')); };
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

  // Invalider cachet thumbnail når URL endres, ellers kan vi vise gammel
  // thumbnail på ny video hvis trimStart tilfeldigvis er den samme.
  if (state.url !== url) {
    state.thumbnailDataUrl = null;
    state.thumbnailForTime = null;
  }
  state.url = url;
  state.duration = els.video.duration;
  state.trimStart = 0;
  state.trimEnd = Math.min(MAX_DURATION, state.duration);
  state.loaded = true;

  els.empty.classList.add('hidden');
  renderTimeline();
  syncVideoToSelection();
  startPreviewLoop();
  updateExportButtons();
  setStatus(`Lastet · ${Math.round(els.video.videoWidth)}×${Math.round(els.video.videoHeight)} · ${formatSec(state.duration)}`);
  scheduleSaveState();
  scheduleThumbnail();
}

let thumbTimer = null;
function scheduleThumbnail() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    if (!state.loaded || !state.url) return;
    if (state.thumbnailForUrl === state.url
        && state.thumbnailForTime === state.trimStart
        && state.thumbnailDataUrl) return;
    const origStatus = els.status.textContent;
    setStatus('Genererer thumbnail…');
    try {
      const res = await window.faktisk.generateThumbnail({
        url: state.url,
        atTime: state.trimStart,
      });
      if (res.ok) {
        state.thumbnailDataUrl = res.dataUrl;
        state.thumbnailForTime = state.trimStart;
        state.thumbnailForUrl = state.url;
        setStatus(origStatus);
      } else {
        console.warn('Thumbnail feilet:', res.error);
        setStatus(origStatus);
      }
    } catch (e) {
      console.warn('Thumbnail-feil:', e);
      setStatus(origStatus);
    }
  }, 700);
}

function startPreviewLoop() {
  els.video.currentTime = state.trimStart;
  els.video.play().catch(() => {});
  els.video.ontimeupdate = () => {
    if (els.video.currentTime >= state.trimEnd - 0.05) {
      els.video.currentTime = state.trimStart;
    }
  };
}

function syncVideoToSelection() {
  if (els.video.currentTime < state.trimStart || els.video.currentTime > state.trimEnd) {
    els.video.currentTime = state.trimStart;
  }
}

function renderTimeline() {
  const dur = state.duration;
  if (!dur) return;
  const startPct = (state.trimStart / dur) * 100;
  const endPct = (state.trimEnd / dur) * 100;
  els.handleStart.style.left = startPct + '%';
  els.handleEnd.style.left = endPct + '%';
  els.selection.style.left = startPct + '%';
  els.selection.style.width = (endPct - startPct) + '%';
  els.labelStart.textContent = formatSec(state.trimStart);
  els.labelEnd.textContent = formatSec(state.trimEnd);
  els.labelDuration.textContent = formatSec(state.trimEnd - state.trimStart);
}

function formatSec(s) {
  return s.toFixed(1).replace('.', ',') + 's';
}

function attachHandleDrag(handle, isStart) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const trackRect = els.track.getBoundingClientRect();
    const startedAtTrimStart = state.trimStart;  // husk for å se om vi må regenerere thumbnail
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(trackRect.width, ev.clientX - trackRect.left));
      const pct = x / trackRect.width;
      const t = pct * state.duration;
      if (isStart) {
        state.trimStart = Math.max(0, Math.min(t, state.trimEnd - MIN_DURATION));
        if (state.trimEnd - state.trimStart > MAX_DURATION) {
          state.trimEnd = state.trimStart + MAX_DURATION;
        }
      } else {
        state.trimEnd = Math.min(state.duration, Math.max(t, state.trimStart + MIN_DURATION));
        if (state.trimEnd - state.trimStart > MAX_DURATION) {
          state.trimStart = state.trimEnd - MAX_DURATION;
        }
      }
      renderTimeline();
      syncVideoToSelection();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      scheduleSaveState();
      // Regenerér thumbnail hvis trimStart faktisk er endret — uansett hvilket
      // håndtak. Høyre-håndtaket kan dytte trimStart hvis klippet blir for langt.
      if (state.trimStart !== startedAtTrimStart) scheduleThumbnail();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

attachHandleDrag(els.handleStart, true);
attachHandleDrag(els.handleEnd, false);

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'
  }[c]));
}

function buildEmbedSnippet() {
  const ts = state.trimStart.toFixed(2);
  const te = state.trimEnd.toFixed(2);
  const baseUrl = escapeHtml(state.url.split('#')[0]);
  const id = 'fvl-' + Math.random().toString(36).slice(2, 8);
  const caption = (els.captionText.value || '').trim();
  const photographer = (els.photographer.value || '').trim();
  const hasCaption = caption || photographer;

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

  // Caption: container query styres av .fvl-container-wrapper rundt video.
  // - Smal embed (under 1080px figure-bredde): left-aligned uten padding
  // - Bred embed (fullWidth, over 1080px): sentrert via cqw-formel
  const innerCaption = hasCaption ? `

  <div class="caption fvl-caption" style="margin-top:0.5rem;box-sizing:border-box;">${captionParts.join('')}
  </div>` : '';

  const open = hasCaption ? `<figure style="margin:0;">` : '';
  const close = hasCaption ? `</figure>` : '';

  const posterAttr = state.thumbnailDataUrl ? ` poster="${state.thumbnailDataUrl}"` : '';
  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const aspect = (vw / vh).toFixed(4);

  return `<!-- ============================================
     FAKTISK · LOOPING VIDEO
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <!-- ▶ VIDEO — bytt ut URL-en under for å bruke et annet klipp -->
  <style>
    .fvl-container { container-type: inline-size; }
    /* Caption sentreres KUN når figure er bred nok (fullWidth-embed).
       På smale embeds (spalte/mobil) treffer ikke regelen, og caption
       blir left-aligned uten ekstra padding — som Faktisks vanlige bilder. */
    @container (min-width: 1080px) {
      .fvl-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem);
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem);
      }
    }
  </style>
  <div class="fvl-container">
    <video id="${id}" data-src="${baseUrl}#t=${ts},${te}"${posterAttr} muted autoplay loop playsinline webkit-playsinline disablepictureinpicture preload="auto" aria-label="Looping videoklipp" style="width:100%;aspect-ratio:${aspect};border-radius:8px;display:block;"></video>${innerCaption}
  </div>
${close}
<script>
(function(){
  var v=document.getElementById('${id}'); if(!v) return;
  var S=${ts}, E=${te}, loaded=false, inView=false;
  function actuallyLoad(){
    if(loaded) return; loaded=true;
    // Vis poster som CSS-background (fallback hvis browser flasher transparent
    // under seek) OG skjul videoens innhold med opacity:0 (men hold layout).
    // visibility:hidden kan få iOS Safari til å tro videoen ikke er synlig
    // og avvise autoplay — opacity:0 unngår det problemet.
    if(v.poster){
      v.style.backgroundImage='url("'+v.poster+'")';
      v.style.backgroundSize='cover';
      v.style.backgroundPosition='center';
    }
    v.style.opacity='0';
    v.style.transition='opacity 0.15s';
    v.src=v.dataset.src;
  }
  function tryLoad(){
    if(loaded || !inView) return;
    if(document.readyState !== 'complete'){
      window.addEventListener('load', tryLoad, {once:true});
      return;
    }
    actuallyLoad();
  }
  function tryPlay(){
    var p = v.play();
    if(p && p.catch) p.catch(function(){
      var unlock = function(){
        v.play().catch(function(){});
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('click', unlock);
      };
      document.addEventListener('touchstart', unlock, {once:true, passive:true});
      document.addEventListener('click', unlock, {once:true});
    });
  }
  v.addEventListener('loadedmetadata',function(){ v.currentTime=S; });
  // Fade in video når den FAKTISK spiller en frame (playing-event).
  // Da har browser dekodet og rendret en frame ved S — ingen sjanse for
  // at den viser frame 0 eller en hvit ramme. 2 sek timeout som
  // sikkerhetsnett hvis autoplay avvises (iOS Low Power osv).
  var shownTimer = setTimeout(function(){ v.style.opacity='1'; }, 2000);
  v.addEventListener('playing', function(){
    clearTimeout(shownTimer);
    v.style.opacity='1';
  }, {once:true});
  v.addEventListener('canplay', tryPlay);
  // Manuell loop via requestAnimationFrame (jevnere enn timeupdate som bare
  // fyrer hver ~250 ms — kan miste seek-vinduet og forårsake flash).
  // Mer lead-time gjør at Safari får tid til å seke og rendre frame før
  // den når slutten — eliminerer flash av første frame ved loop.
  function loopTick(){
    if(!v.paused && v.currentTime>=E-0.15){ v.currentTime=S; }
    requestAnimationFrame(loopTick);
  }
  v.addEventListener('canplay', function(){ requestAnimationFrame(loopTick); }, {once:true});
  v.addEventListener('ended',function(){ v.currentTime=S; tryPlay(); });
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ inView=true; tryLoad(); } });
    },{threshold:0.1});
    io.observe(v);
  } else {
    inView=true; tryLoad();
  }
})();
</script>
`;
}

function updateExportButtons() {
  els.copyEmbed.disabled = !state.loaded;
  els.exportVideo.disabled = !state.loaded;
}

els.loadBtn.addEventListener('click', loadVideo);
els.url.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadVideo();
});

els.copyEmbed.addEventListener('click', async () => {
  if (!state.loaded) return;
  if (state.thumbnailForUrl !== state.url
      || state.thumbnailForTime !== state.trimStart
      || !state.thumbnailDataUrl) {
    clearTimeout(thumbTimer);
    setStatus('Genererer thumbnail før kopiering…');
    const res = await window.faktisk.generateThumbnail({
      url: state.url,
      atTime: state.trimStart,
    });
    if (res.ok) {
      state.thumbnailDataUrl = res.dataUrl;
      state.thumbnailForTime = state.trimStart;
      state.thumbnailForUrl = state.url;
    }
  }
  const snippet = buildEmbedSnippet();
  try {
    await window.faktisk.copyToClipboard(snippet);
    const orig = els.copyEmbed.textContent;
    els.copyEmbed.textContent = '✅ Kopiert!';
    setStatus('Embed-koden er kopiert — lim inn i Labrador Markup-boks.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 2000);
  } catch (e) {
    setStatus('Kunne ikke kopiere: ' + e.message, true);
  }
});

els.exportVideo.addEventListener('click', async () => {
  if (!state.loaded || !state.url) return;
  const defaultName = (els.captionText.value || '').replace(/[^\w\-]+/g, '_').slice(0, 40)
                      || ('looping-' + new Date().toISOString().slice(0, 10));
  const savePath = await window.faktisk.saveDialog({
    title: 'Lagre videoklipp',
    defaultPath: defaultName + '.mp4',
    filters: [{ name: 'MP4-video', extensions: ['mp4'] }],
  });
  if (!savePath) return;

  const host = document.getElementById('faktisk-dialog-host')
            || (window.faktiskDialog.alert(''), document.getElementById('faktisk-dialog-host'));
  function renderProgress(label, percent) {
    host.innerHTML = `<div class="fd-card" style="width:420px;">
      <p class="fd-message">Eksporterer videoklipp…</p>
      <p class="fd-progress-label">${label}</p>
      <div class="fd-progress"><div class="fd-progress__bar" style="width:${percent}%"></div></div>
    </div>`;
    host.classList.add('open');
  }
  renderProgress('Forbereder…', 0);

  const unsub = window.faktisk.onVideoProgress(({ phase, percent }) => {
    const label = phase === 'downloading' ? 'Laster ned original-video…'
                : phase === 'encoding'    ? 'Trimmer og koder om…'
                : phase === 'done'        ? 'Ferdig'
                                          : phase;
    renderProgress(label, percent);
  });

  const res = await window.faktisk.videoExport({
    url: state.url,
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    savePath,
    quality: '1080',
  });
  unsub();

  if (res.ok) {
    host.innerHTML = `<div class="fd-card" style="width:420px;">
      <p class="fd-message">Videoklipp eksportert</p>
      <p style="font-size:13px;color:#666;margin:0;word-break:break-all;">${savePath}</p>
      <div class="fd-row">
        <button class="fd-btn fd-btn-cancel" data-close>Lukk</button>
        <button class="fd-btn fd-btn-primary" data-act="reveal">Vis i Finder</button>
      </div>
    </div>`;
    host.querySelector('[data-close]').onclick = () => { host.classList.remove('open'); host.innerHTML = ''; };
    host.querySelector('[data-act="reveal"]').onclick = async () => {
      await window.faktisk.revealInFinder(savePath);
      host.classList.remove('open'); host.innerHTML = '';
    };
  } else {
    host.classList.remove('open'); host.innerHTML = '';
    await window.faktiskDialog.alert('Eksport feilet: ' + (res.error || 'ukjent feil'));
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

// ============================================================
//  Arkivering
// ============================================================

let isRestoring = false;

function serializeState() {
  return {
    url: els.url.value,
    trimStart: state.trimStart,
    trimEnd: state.trimEnd,
    captionText: els.captionText.value,
    photographer: els.photographer.value,
    loaded: state.loaded,
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
        if (typeof saved.trimStart === 'number') {
          state.trimStart = Math.max(0, Math.min(saved.trimStart, state.duration));
        }
        if (typeof saved.trimEnd === 'number') {
          state.trimEnd = Math.max(state.trimStart + MIN_DURATION,
                                  Math.min(saved.trimEnd, state.duration));
        }
        renderTimeline();
        syncVideoToSelection();
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
    || `Looping ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) {
    setStatus('Prosjektet er lagret: «' + res.name + '».');
    await refreshProjectList();
    const fileId = name.trim().replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 100);
    els.projectSelect.value = fileId;
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
  } else {
    setStatus('Kunne ikke åpne prosjekt: ' + (res.error || 'ukjent feil'), true);
  }
});

// Init
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
    if (res.ok && res.state) {
      await applyState(res.state);
    }
  } catch (e) { console.error(e); }
})();
