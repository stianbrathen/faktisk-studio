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
  wrapInBox:     document.getElementById('wrapInBox'),
  boxOptions:    document.getElementById('boxOptions'),
  boxHeight:     document.getElementById('boxHeight'),
  logoSelect:    document.getElementById('logoSelect'),
};

// Høyde-presets for vertikal video i container. Tallene er vh-verdier (prosent av viewport-høyde).
// Med max-height styrer skjermhøyden hvor stort klippet blir — ikke kolonnebredden.
// Det gjør at samme valg gir konsistent inntrykk på mobil og desktop.
const BOX_HEIGHT_VH = { kompakt: 60, medium: 75, stor: 90 };
// Pikselgrense som backstop på svært høye skjermer (4K-monitorer etc.), slik at vertikalvideo
// ikke blir absurd stor selv om vh-verdien tilsier det.
const BOX_HEIGHT_PX_CAP = { kompakt: 540, medium: 680, stor: 820 };

// SVG-markup for logo-merker (samme som pop-up). Tegnes hvit i sort sirkel.
const LOGO_SVGS = {
  x: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.022 1.792-4.69 4.533-4.69 1.312 0 2.686.235 2.686.235v2.967h-1.514c-1.491 0-1.956.93-1.956 1.886v2.262h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.69a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.12z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  threads: '<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291.475-.027.961-.04 1.45-.04.658 0 1.305.025 1.93.072-.085-.523-.207-1-.366-1.425-.293-.797-.83-1.495-1.494-1.974-.595-.431-1.282-.667-1.992-.667h-.01c-1.04 0-2.087.413-2.79 1.106l-1.397-1.4c1.13-1.117 2.594-1.71 4.187-1.71h.014c1.156 0 2.27.394 3.21 1.135 1.014.795 1.74 1.971 2.146 3.371.18.62.305 1.31.374 2.044.78.27 1.477.65 2.066 1.139 1.184.974 1.913 2.31 1.913 3.787 0 4.046-3.297 7.34-7.343 7.34zm1.018-9.628c-.234 0-.46.008-.677.02-1.834.102-2.978.97-2.917 2.005.06 1.099 1.275 1.604 2.45 1.541 1.083-.06 2.489-.484 2.756-3.451-.522-.075-1.078-.115-1.612-.115z"/></svg>',
};
const LOGO_LABELS = {
  x: 'Fra X (Twitter)',
  facebook: 'Fra Facebook',
  instagram: 'Fra Instagram',
  tiktok: 'Fra TikTok',
  youtube: 'Fra YouTube',
  threads: 'Fra Threads',
};
function isValidLogoKey(key) {
  return key === 'none' || Object.prototype.hasOwnProperty.call(LOGO_SVGS, key);
}

const state = {
  url: '',
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  posterTime: 1,
  loaded: false,
  posterDataUrl: null,
  posterForKey: null,
  posterUrl: null,      // Labrador-URL for poster — foretrekkes over base64
  posterUrlKey: null,
  wrapInBox: false,
  boxHeight: 'medium',   // 'kompakt' | 'medium' | 'stor' — maks-høyde-preset for vertikal video
  logo: 'none',          // 'none' | 'x' | 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'threads'
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

  // Poster: Labrador-URL når tilgjengelig (liten embed), ellers base64
  const poster = state.posterUrl ? encodeURI(state.posterUrl) : state.posterDataUrl;
  const posterBg = poster
    ? `background-image:url('${poster}');background-size:cover;background-position:center;`
    : 'background:#1a1a1a;';

  // Vertikal video = aspect < 1. I container-modus bruker vi max-height (vh) for å begrense høyden.
  // På desktop ville en vertikalvideo som tar 50% av en bred kolonne fortsatt blitt latterlig høy
  // (50% av 800px kolonne = 400px bred × 16/9 ≈ 711px høy). Med max-height: 75vh tar klippet
  // maks 75% av skjermhøyden uansett kolonnebredde, og aspect-ratio lar bredden følge med.
  const isVertical = (vw / vh) < 1;
  const wrapClass = state.wrapInBox ? `fvp-wrap-${id}` : '';
  const heightKey = (state.boxHeight in BOX_HEIGHT_VH) ? state.boxHeight : 'medium';
  const vhVal = BOX_HEIGHT_VH[heightKey];
  const pxCap = BOX_HEIGHT_PX_CAP[heightKey];

  // Base-CSS med design-tokens fra shared/embed-tokens.js.
  // Alle --fk-* CSS-variabler + font/color-arv fra rot-scope.
  const baseCss = (typeof window !== "undefined" && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss(`fvp-container`)
    : "";

  return `<!-- ============================================
     FAKTISK · VIDEOAVSPILLER
     Endre teksten i feltene merket med ▶
     ============================================ -->
${open}
  <style>${baseCss}
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
    ${state.wrapInBox ? `
    /* Grå container-boks rundt video + caption */
    .fvp-wrap-${id} {
      background: #D9D9D9;
      border-radius: 4px;
      padding: clamp(12px, 1.6cqw, 20px) clamp(14px, 2.4cqw, 28px);
      display: flex;
      flex-direction: column;
      gap: clamp(10px, 1.4cqw, 16px);
    }
    .fvp-wrap-${id} .fvp-video-${id} {
      margin: 0 auto;
      ${isVertical ? `
      /* Vi tenker i maks-høyde, men siden inline-styling har width:100% + aspect-ratio,
         konverterer vi høyden til en max-width via aspect-ratio.
         max-width = max-høyde × aspect-ratio. Det gir samme resultat som å sette max-height
         direkte, men spiller godt sammen med inline width:100%. */
      max-width: min(${(vhVal * (vw / vh)).toFixed(2)}vh, ${Math.round(pxCap * (vw / vh))}px);` : ''}
    }
    @media (max-width: 600px) {
      .fvp-wrap-${id} .fvp-video-${id} {
        ${isVertical ? `
        /* På mobil vil vh ofte gi smalere video enn kolonnen tillater, så vi lar
           kolonnen ta over hvis den er smalere enn vh-beregningen. Det gir mer video på
           liten skjerm (der vertikalvideo passer naturlig) uten å sprenge på desktop. */
        max-width: min(100%, ${(vhVal * (vw / vh)).toFixed(2)}vh);` : ''}
      }
    }
    .fvp-wrap-${id} .fvp-caption-inner-${id} {
      background: #fff;
      color: #212121;
      padding: clamp(12px, 1.5cqw, 18px) clamp(14px, 2cqw, 22px);
      border-radius: 6px;
      font-family: "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: clamp(14px, 1.5cqw, 17px);
      line-height: 1.6;
    }
    /* Caption-rad: logo til venstre, brødtekst til høyre (normal stil, ikke kursiv).
       Når logo er satt blir flex-layout aktiv; uten logo tar caption-en full bredde. */
    .fvp-wrap-${id} .fvp-caption-inner-${id}.has-logo {
      display: flex;
      align-items: center;
      gap: clamp(10px, 1.4cqw, 14px);
    }
    .fvp-wrap-${id} .fvp-caption-inner-${id}.has-logo .fvp-cap-text-${id} {
      flex: 1;
    }
    .fvp-wrap-${id} .fvp-caption-inner-${id} figcaption { display: block; font-style: normal; }
    .fvp-wrap-${id} .fvp-caption-inner-${id} figcaption[itemprop="author"] {
      margin-top: 6px;
      font-size: 0.85em;
      opacity: 0.7;
    }
    /* Logo-badge: sort sirkel med hvit logo */
    .fvp-logo-${id} {
      width: clamp(34px, 4cqw, 42px);
      height: clamp(34px, 4cqw, 42px);
      background: #000;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      flex: 0 0 auto;
    }
    .fvp-logo-${id} svg {
      width: 52%;
      height: 52%;
      display: block;
    }
    ` : ''}
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
  <div class="fvp-container">${state.wrapInBox ? `
    <div class="fvp-wrap-${id}">
      <div class="fvp-video-${id}" style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:6px;overflow:hidden;${posterBg}">
        <video id="${id}" data-src="${srcWithFragment}" playsinline webkit-playsinline preload="none" aria-label="Videoavspiller" style="width:100%;height:100%;display:block;${posterBg}"></video>
        <div id="${id}-cover" style="position:absolute;inset:0;${posterBg}transition:opacity 0.2s;pointer-events:none;"></div>
        <button class="fvp-play-${id}" id="${id}-play" aria-label="Spill av video" type="button">
          <svg viewBox="0 0 230.89 230.89" aria-hidden="true">
            <circle cx="115.45" cy="115.45" r="115.45" fill="#0050fc"/>
            <path fill="#fff" d="M165.51,109.38l-76.8-44.34c-4.67-2.69-10.5.67-10.5,6.06v88.69c0,5.39,5.83,8.76,10.5,6.06l76.8-44.34c4.67-2.69,4.67-9.43,0-12.12Z"/>
          </svg>
        </button>
      </div>${(hasCaption || (state.logo && state.logo !== 'none')) ? (() => {
        const hasLogo = state.logo && state.logo !== 'none';
        const logoBadge = hasLogo
          ? `<div class="fvp-logo-${id}" role="img" aria-label="${escapeHtml(LOGO_LABELS[state.logo] || '')}">${LOGO_SVGS[state.logo] || ''}</div>`
          : '';
        // Med logo: cap-text wrappes så flex-layout fungerer (logo | text)
        const inner = hasCaption
          ? (hasLogo
              ? `${logoBadge}<div class="fvp-cap-text-${id}">${captionParts.join('')}
        </div>`
              : `${captionParts.join('')}`)
          : logoBadge;
        return `
      <div class="fvp-caption-inner-${id}${hasLogo ? ' has-logo' : ''}">${inner}
      </div>`;
      })() : ''}
    </div>` : `
    <div style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:8px;overflow:hidden;${posterBg}">
      <video id="${id}" data-src="${srcWithFragment}" playsinline webkit-playsinline preload="none" aria-label="Videoavspiller" style="width:100%;height:100%;display:block;${posterBg}"></video>
      <div id="${id}-cover" style="position:absolute;inset:0;${posterBg}transition:opacity 0.2s;pointer-events:none;"></div>
      <button class="fvp-play-${id}" id="${id}-play" aria-label="Spill av video" type="button">
        <svg viewBox="0 0 230.89 230.89" aria-hidden="true">
          <circle cx="115.45" cy="115.45" r="115.45" fill="#0050fc"/>
          <path fill="#fff" d="M165.51,109.38l-76.8-44.34c-4.67-2.69-10.5.67-10.5,6.06v88.69c0,5.39,5.83,8.76,10.5,6.06l76.8-44.34c4.67-2.69,4.67-9.43,0-12.12Z"/>
        </svg>
      </button>
    </div>${innerCaption}`}
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
  // Foretrukket: poster som Labrador-URL (liten embed, gjenbrukes ved samme tid)
  if (window.faktisk.labradorThumbnail && state.posterUrlKey !== key) {
    setStatus('Lager stillbilde i Labrador…');
    try {
      const r = await window.faktisk.labradorThumbnail({
        url: state.url, atTime: state.posterTime,
      });
      if (r.ok && r.url) { state.posterUrl = r.url; state.posterUrlKey = key; }
      else { state.posterUrl = null; state.posterUrlKey = null; }
    } catch (e) { state.posterUrl = null; state.posterUrlKey = null; }
  }
  if (!state.posterUrl && (state.posterForKey !== key || !state.posterDataUrl)) {
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
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setStatus('Embed-koden er kopiert.');
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
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
    wrapInBox: state.wrapInBox,
    boxHeight: state.boxHeight,
    logo: state.logo,
  };
}
async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    els.captionText.value = saved.captionText || '';
    els.photographer.value = saved.photographer || '';
    if (typeof saved.wrapInBox === 'boolean') {
      state.wrapInBox = saved.wrapInBox;
      if (els.wrapInBox) els.wrapInBox.checked = saved.wrapInBox;
      if (els.boxOptions) els.boxOptions.style.display = saved.wrapInBox ? 'flex' : 'none';
    }
    // Nytt v0.1.4-felt: boxHeight ('kompakt' | 'medium' | 'stor')
    if (typeof saved.boxHeight === 'string' && saved.boxHeight in BOX_HEIGHT_VH) {
      state.boxHeight = saved.boxHeight;
      if (els.boxHeight) els.boxHeight.value = saved.boxHeight;
    } else if (typeof saved.boxWidth === 'number') {
      // Bakoverkompatibilitet: gammel boxWidth-prosent → nærmeste høyde-preset.
      // Brukerintensjonen "smal video" → kompakt, "bredere" → større presets.
      var legacyKey = saved.boxWidth <= 50 ? 'kompakt'
                   : saved.boxWidth <= 65 ? 'medium'
                   : 'stor';
      state.boxHeight = legacyKey;
      if (els.boxHeight) els.boxHeight.value = legacyKey;
    }
    if (typeof saved.logo === 'string' && isValidLogoKey(saved.logo)) {
      state.logo = saved.logo;
      if (els.logoSelect) els.logoSelect.value = saved.logo;
    }
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

// Container-boks toggle + bredde-velger
if (els.wrapInBox) {
  els.wrapInBox.addEventListener('change', () => {
    state.wrapInBox = els.wrapInBox.checked;
    if (els.boxOptions) els.boxOptions.style.display = state.wrapInBox ? 'flex' : 'none';
    scheduleSaveState();
  });
}
if (els.boxHeight) {
  els.boxHeight.addEventListener('change', () => {
    var v = els.boxHeight.value;
    if (v in BOX_HEIGHT_VH) {
      state.boxHeight = v;
      scheduleSaveState();
    }
  });
}
if (els.logoSelect) {
  els.logoSelect.addEventListener('change', () => {
    var v = els.logoSelect.value;
    if (isValidLogoKey(v)) {
      state.logo = v;
      scheduleSaveState();
    }
  });
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
