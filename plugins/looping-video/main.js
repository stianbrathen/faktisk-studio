// Faktisk Studio · Looping Video-plugin

const PLUGIN_ID = 'looping-video';
const MAX_DURATION = 10;
const MIN_DURATION = 1;

// Vis app-versjon + plugin-versjon ved siden av logoen. Plugin-versjon
// hentes dynamisk fra installert manifest (via pluginStatus) så vi slipper
// å bumpe en hardkodet konstant manuelt hver release.
// Plugin-versjonen skrives også inn i embed-koden, så gamle embeds i artikler kan spores.
let PLUGIN_VERSION = '';
(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    if (me && me.version) PLUGIN_VERSION = me.version;
    const el = document.getElementById('appVersion');
    if (el && appV) {
      el.textContent = me
        ? 'v' + appV + ' · plugin v' + me.version
        : 'v' + appV;
    }
  } catch (e) {}
})();

const els = {
  url:           document.getElementById('videoUrl'),
  bgMode:        document.getElementById('bgMode'),
  sizeH:         document.getElementById('sizeH'),
  sizeW:         document.getElementById('sizeW'),
  sizeAlign:     document.getElementById('sizeAlign'),
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
  posterUrl: null,      // Labrador-URL for poster — foretrekkes over base64
  posterUrlKey: null,
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
  // Trimmet = starter etter 0 eller slutter før klippets slutt (ellers native loop)
  const trimmed = state.trimStart > 0.05 || (state.duration > 0 && state.trimEnd < state.duration - 0.1);
  const baseUrl = escapeHtml(state.url.split('#')[0]);
  const id = 'fvl-' + Math.random().toString(36).slice(2, 8);
  // Poster: Labrador-URL når tilgjengelig (liten embed), ellers base64
  const poster = state.posterUrl ? encodeURI(state.posterUrl) : state.thumbnailDataUrl;
  // «Ingen bakgrunn»: ingen mørk flate og ingen stillbilde BAK videoen (det ville synes gjennom
  // gjennomsiktige partier). Stillbildet brukes fortsatt som dekke til videoen spiller.
  const noBg = els.bgMode && els.bgMode.value === 'none';
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

  // Cover-overlay som ALLTID viser thumbnail (eller transparent hvis ingen).
  // Fjernes ved 'playing'-event når video har en frame rendret. Garantert
  // ingen frame-0 flash, uavhengig av timing av v.src vs JS-execution.
  const coverStyle = poster
    ? `position:absolute;inset:0;background-image:url('${poster}');background-size:cover;background-position:center;transition:opacity 0.2s;pointer-events:none;`
    : `position:absolute;inset:0;pointer-events:none;`;
  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const aspect = (vw / vh).toFixed(4);
  // Størrelse i artikkelen: maks bredde og maks høyde (andel av skjermhøyden). Stående video får
  // som standard maks 75 % av skjermhøyden, så den ikke blir enorm på desktop – og litt mindre på mobil.
  let mh = els.sizeH ? els.sizeH.value : 'auto';
  if (mh === 'auto') mh = vw / vh < 1 ? '75' : '';
  const wSel = els.sizeW ? els.sizeW.value : 'full';
  const maxW = wSel === 'full' ? '100%' : (parseInt(wSel, 10) || 680) + 'px';
  const narrowed = wSel !== 'full' || !!mh;
  const frameW = mh ? `min(${maxW}, calc(${parseInt(mh, 10)}vh * ${aspect}))` : maxW;
  const frameAlign = els.sizeAlign && els.sizeAlign.value === 'left' ? '0 auto 0 0' : '0 auto';

  // Base-CSS med design-tokens fra shared/embed-tokens.js.
  // Alle --fk-* CSS-variabler + font/color-arv fra rot-scope.
  const baseCss = (typeof window !== "undefined" && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss(`fvl-container`)
    : "";

  return `<!-- ============================================
     FAKTISK · LOOPING VIDEO${PLUGIN_VERSION ? ' · v' + PLUGIN_VERSION : ''}
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <!-- ▶ VIDEO — bytt ut URL-en under for å bruke et annet klipp -->
  <style>${baseCss}
    .fvl-container { container-type: inline-size; }
    /* iOS sin egen spill-knapp skjules – plakaten og vår egen knapp brukes når autoplay er blokkert */
    #${id}::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none; }
    #${id}::-webkit-media-controls { display: none !important; }
    @container (min-width: 1080px) {
      .fvl-container > .caption.fvl-caption {
        padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
        padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
      }
    }
    @media (max-width: 768px) {
      .fvl-container > .caption.fvl-caption {
        padding-left: 1rem !important;
        padding-right: 1rem !important;
      }
    }
  </style>
  <div class="fvl-container">${narrowed ? `
   <div class="fvl-frame" style="max-width:${frameW};margin:${frameAlign};">` : ''}
    <div style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:8px;overflow:hidden;${noBg ? '' : poster ? `background-image:url('${poster}');background-size:cover;background-position:center;` : 'background:#1a1a1a;'}">
      <video id="${id}" data-src="${baseUrl}" muted autoplay loop playsinline webkit-playsinline disablepictureinpicture preload="auto" aria-label="Looping videoklipp" style="width:100%;height:100%;display:block;object-fit:cover;${poster && !noBg ? `background-image:url('${poster}');background-size:cover;background-position:center;` : ''}"></video>
      <div id="${id}-cover" style="${coverStyle}"></div>
    </div>${narrowed ? innerCaption + `
   </div>` : innerCaption}
  </div>
${close}
<script>
(function(){
  // Looping-video ${PLUGIN_VERSION ? 'v' + PLUGIN_VERSION : ''} — robust autoplay (okt. 2026):
  // - ikke vent på window.load (kan ta lang tid eller aldri skje på tunge sider)
  // - src UTEN media-fragment (#t=): Safari pauser ved fragmentets sluttpunkt i stedet for å loope
  // - load() + play() eksplisitt; nyere Safari henter ikke video av seg selv når src settes fra skript
  // - brukeraktivering via touchend/click (touchstart gir ikke aktivering i iOS)
  // - spill-knapp bare når videoen er KLAR men står stille (blokkert); aldri mens den lastes
  var v=document.getElementById('${id}'); if(!v || v.__fvl) return; v.__fvl=1;
  var cover=document.getElementById('${id}-cover');
  var S=${ts}, E=${te}, TRIM=${trimmed ? 'true' : 'false'};
  var loaded=false, played=false, btn=null, timer=null;
  v.muted=true; v.defaultMuted=true; v.playsInline=true; v.loop=true;
  v.setAttribute('muted',''); v.setAttribute('playsinline','');
  function play(){ var p=v.play(); if(p && p.catch) p.catch(function(){}); }
  function load(){
    if(loaded) return; loaded=true;
    v.src=(v.getAttribute('data-src')||'').split('#')[0];
    try { v.load(); } catch(e) {}
    play();
    // Sikkerhetsnett: har ingenting skjedd etter 20 s (nettleser som ikke laster), vis spill-knapp.
    // Ellers vises knappen KUN når videoen er klar men står stille (= blokkert autoplay), se canplay.
    timer=setTimeout(function(){ if(!played && v.readyState < 2) showButton(); }, 20000);
  }
  function showButton(){
    if(btn || (played && !v.paused)) return;
    btn=document.createElement('button');
    btn.type='button';
    btn.setAttribute('aria-label','Spill av video');
    btn.style.cssText='position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;padding:0;border:0;border-radius:50%;background:#0050fc;cursor:pointer;z-index:2;box-shadow:0 2px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;';
    btn.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="#fff" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
    btn.addEventListener('click', function(){ load(); v.muted=true; play(); });
    (v.parentNode || v).appendChild(btn);
  }
  function hideCover(){
    if(!cover) return;
    cover.style.opacity='0';
    setTimeout(function(){ if(cover) cover.style.display='none'; }, 250);
  }
  v.addEventListener('loadedmetadata', function(){ if(S > 0.01){ try { v.currentTime=S; } catch(e) {} } });
  v.addEventListener('playing', function(){
    played=true; hideCover();   // timeren får stå: den sjekker selv om videoen faktisk går
    if(btn){ btn.parentNode && btn.parentNode.removeChild(btn); btn=null; }
    document.removeEventListener('touchend', unlock); document.removeEventListener('click', unlock);
  });
  // Klar til å spille: prøv å starte. Står den fortsatt stille 2 s etter at den var klar,
  // er autoplay blokkert (f.eks. strømsparing) — da vises spill-knappen. Mens videoen
  // fortsatt lastes vises bare plakaten, aldri knappen.
  var readyCheck=null;
  v.addEventListener('canplay', function(){
    if(played && !v.paused) return;
    play();
    clearTimeout(readyCheck);
    readyCheck=setTimeout(function(){ if(v.paused && !(played && v.currentTime > 0.1)) showButton(); }, 2000);
  });
  // Trimmet klipp: hopp tilbake til start litt før sluttpunktet. Helt klipp: native loop.
  if(TRIM){
    (function tick(){
      if(!v.paused && v.currentTime >= E - 0.15){ v.currentTime=S; }
      requestAnimationFrame(tick);
    })();
  }
  v.addEventListener('ended', function(){ v.currentTime=S; play(); });
  // Første ekte brukeraktivering starter videoen hvis autoplay er blokkert
  function unlock(){ if(played) return; if(loaded) play(); else load(); }
  document.addEventListener('touchend', unlock, {passive:true});
  document.addEventListener('click', unlock);
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      for(var i=0;i<es.length;i++){ if(es[i].isIntersecting){ io.disconnect(); load(); return; } }
    }, {rootMargin:'100% 0px'});
    io.observe(v);
  } else { load(); }
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
  // Foretrukket: poster som Labrador-URL (bittesmå embeds). Deterministisk
  // filnavn i main-prosessen gjør at samme video+tid gjenbruker samme fil.
  const posterKey = state.url + '@' + state.trimStart.toFixed(1);
  if (window.faktisk.labradorThumbnail && state.posterUrlKey !== posterKey) {
    setStatus('Lager stillbilde i Labrador…');
    try {
      const r = await window.faktisk.labradorThumbnail({
        url: state.url, atTime: state.trimStart,
      });
      if (r.ok && r.url) {
        state.posterUrl = r.url;
        state.posterUrlKey = posterKey;
      } else {
        state.posterUrl = null;
        state.posterUrlKey = null;
      }
    } catch (e) { state.posterUrl = null; state.posterUrlKey = null; }
  }
  // Fallback: base64 (ikke innlogget i Labrador, eller opplasting feilet)
  if (!state.posterUrl && (state.thumbnailForUrl !== state.url
      || state.thumbnailForTime !== state.trimStart
      || !state.thumbnailDataUrl)) {
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
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setStatus('Embed-koden er kopiert — lim inn i Labrador Markup-boks.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
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
    bgMode: els.bgMode.value,
    sizeH: els.sizeH.value,
    sizeW: els.sizeW.value,
    sizeAlign: els.sizeAlign.value,
    loaded: state.loaded,
  };
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    els.captionText.value = saved.captionText || '';
    els.photographer.value = saved.photographer || '';
    els.bgMode.value = saved.bgMode === 'none' ? 'none' : 'dark';
    if (saved.sizeH != null) els.sizeH.value = saved.sizeH;
    if (saved.sizeW != null) els.sizeW.value = saved.sizeW;
    if (saved.sizeAlign != null) els.sizeAlign.value = saved.sizeAlign;
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
  els.bgMode.addEventListener(ev, scheduleSaveState);
  els.sizeH.addEventListener(ev, scheduleSaveState);
  els.sizeW.addEventListener(ev, scheduleSaveState);
  els.sizeAlign.addEventListener(ev, scheduleSaveState);
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
