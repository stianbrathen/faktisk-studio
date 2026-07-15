// Faktisk Studio · Videohøydepunkter-plugin
//
// Marker høydepunkter (inn/ut-punkter) i en Labrador-opplastet video.
// Embed-en gir leserne en klikkbar tidslinje + høydepunkt-knapper,
// med valgfri sakte film-avspilling per høydepunkt.

const PLUGIN_ID = 'video-hoydepunkter';

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
  track:         document.getElementById('hlTrack'),
  head:          document.getElementById('hlHead'),
  labelPos:      document.getElementById('labelPos'),
  labelDur:      document.getElementById('labelDur'),
  btnIn:         document.getElementById('btnIn'),
  btnOut:        document.getElementById('btnOut'),
  btnAdd:        document.getElementById('btnAdd'),
  pendLbl:       document.getElementById('pendLbl'),
  hlList:        document.getElementById('hlList'),
  hlEmpty:       document.getElementById('hlEmpty'),
  slowRate:      document.getElementById('slowRate'),
  stopAtEnd:     document.getElementById('stopAtEnd'),
  copyEmbed:     document.getElementById('copyEmbedBtn'),
  status:        document.getElementById('status'),
  back:          document.getElementById('backBtn'),
  full:          document.getElementById('fullscreenBtn'),
  openLabrador:  document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

const state = {
  url: '',
  duration: 0,
  loaded: false,
  highlights: [],        // { t: tittel, s: start, e: slutt, slow: bool }
  pendIn: null,
  pendOut: null,
  previewStop: null,     // stopper forhåndsvisning av et høydepunkt
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

function formatSec(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m + 'm ' + sec.replace('.', ',') + 's';
  }
  return s.toFixed(1).replace('.', ',') + 's';
}

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
    state.posterDataUrl = null;
    state.posterForKey = null;
    // Ny video → gamle høydepunkter gjelder neppe, men behold dem hvis
    // de er innenfor varigheten (kan være samme klipp re-lastet).
    state.highlights = state.highlights.filter(h => h.e <= els.video.duration + 0.5);
  }

  state.url = url;
  state.duration = els.video.duration;
  state.loaded = true;
  state.pendIn = null;
  state.pendOut = null;

  els.empty.classList.add('hidden');
  els.labelDur.textContent = formatSec(state.duration);
  renderTrack();
  renderList();
  updatePend();
  updateButtons();
  setStatus(`Lastet · ${Math.round(els.video.videoWidth)}×${Math.round(els.video.videoHeight)} · ${formatSec(state.duration)}`);
  scheduleSaveState();
}

// ── Tidslinje (canvas-siden) ─────────────────────────────────────────────

function renderTrack() {
  els.track.querySelectorAll('.hl-seg, .hl-pend').forEach(n => n.remove());
  const dur = state.duration;
  if (!dur) return;
  state.highlights.forEach(h => {
    const seg = document.createElement('div');
    seg.className = 'hl-seg';
    seg.style.left = (h.s / dur * 100) + '%';
    seg.style.width = (Math.max(0.2, h.e - h.s) / dur * 100) + '%';
    seg.title = h.t;
    els.track.appendChild(seg);
  });
  [state.pendIn, state.pendOut].forEach(t => {
    if (t == null) return;
    const p = document.createElement('div');
    p.className = 'hl-pend';
    p.style.left = (t / dur * 100) + '%';
    els.track.appendChild(p);
  });
}

function seekFromEvent(ev) {
  const rect = els.track.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
  if (state.duration) els.video.currentTime = (x / rect.width) * state.duration;
}
els.track.addEventListener('mousedown', e => {
  if (!state.loaded) return;
  e.preventDefault();
  seekFromEvent(e);
  const onMove = ev => seekFromEvent(ev);
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Playhead + forhåndsvisnings-stopp via rAF (timeupdate er for grovkornet)
(function raf() {
  const dur = state.duration;
  const t = els.video.currentTime || 0;
  if (dur) {
    els.head.style.left = (t / dur * 100) + '%';
    els.labelPos.textContent = formatSec(t);
  }
  if (state.previewStop != null && t >= state.previewStop - 0.03) {
    els.video.pause();
    els.video.playbackRate = 1;
    state.previewStop = null;
  }
  requestAnimationFrame(raf);
})();

// ── Markering ────────────────────────────────────────────────────────────

function updatePend() {
  const fi = state.pendIn == null ? '–' : formatSec(state.pendIn);
  const fo = state.pendOut == null ? '–' : formatSec(state.pendOut);
  els.pendLbl.textContent = `Inn: ${fi} · Ut: ${fo}`;
  els.btnAdd.disabled = !(state.loaded && state.pendIn != null
    && state.pendOut != null && state.pendOut > state.pendIn + 0.2);
  renderTrack();
}

els.btnIn.addEventListener('click', () => {
  if (!state.loaded) return;
  state.pendIn = Math.round(els.video.currentTime * 10) / 10;
  if (state.pendOut != null && state.pendOut <= state.pendIn) state.pendOut = null;
  updatePend();
});
els.btnOut.addEventListener('click', () => {
  if (!state.loaded) return;
  state.pendOut = Math.round(els.video.currentTime * 10) / 10;
  updatePend();
});
els.btnAdd.addEventListener('click', () => {
  if (els.btnAdd.disabled) return;
  state.highlights.push({
    t: 'Høydepunkt ' + (state.highlights.length + 1),
    s: state.pendIn,
    e: state.pendOut,
    slow: false,
  });
  state.highlights.sort((a, b) => a.s - b.s);
  state.pendIn = null;
  state.pendOut = null;
  updatePend();
  renderList();
  scheduleSaveState();
});

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (!state.loaded) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (els.video.paused) els.video.play(); else els.video.pause();
  } else if (e.key === 'ArrowLeft') {
    els.video.currentTime = Math.max(0, els.video.currentTime - (e.shiftKey ? 0.1 : 5));
  } else if (e.key === 'ArrowRight') {
    els.video.currentTime = Math.min(state.duration, els.video.currentTime + (e.shiftKey ? 0.1 : 5));
  } else if (e.key === 'i' || e.key === 'I') {
    els.btnIn.click();
  } else if (e.key === 'o' || e.key === 'O') {
    els.btnOut.click();
  }
});

// ── Høydepunkt-liste (sidebar) ───────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

function renderList() {
  els.hlList.innerHTML = '';
  els.hlEmpty.style.display = state.highlights.length ? 'none' : 'block';
  state.highlights.forEach((h, i) => {
    const row = document.createElement('div');
    row.className = 'hl-row';
    row.dataset.i = i;
    row.innerHTML =
      `<div class="hl-row__top">
        <span class="hl-row__num">${i + 1}</span>
        <input class="hl-row__title" value="${escapeHtml(h.t)}" placeholder="Tittel på høydepunktet">
        <button class="hl-row__del" data-act="del" title="Slett">✕</button>
      </div>
      <div class="hl-row__bottom">
        <span class="hl-time">
          <button data-act="inMinus" title="−0,1s">−</button>
          <button class="hl-time__val" data-act="goIn" title="Hopp hit">${formatSec(h.s)}</button>
          <button data-act="inPlus" title="+0,1s">+</button>
        </span>
        <span class="hl-row__dash">–</span>
        <span class="hl-time">
          <button data-act="outMinus" title="−0,1s">−</button>
          <button class="hl-time__val" data-act="goOut" title="Hopp hit">${formatSec(h.e)}</button>
          <button data-act="outPlus" title="+0,1s">+</button>
        </span>
        <button class="hl-row__play" data-act="play" title="Forhåndsvis">▶</button>
        <label class="hl-row__slow"><input type="checkbox" class="hl-slow-cb"${h.slow ? ' checked' : ''}> sakte</label>
      </div>`;
    els.hlList.appendChild(row);
  });
  renderTrack();
}

els.hlList.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const row = e.target.closest('.hl-row');
  const i = +row.dataset.i;
  const h = state.highlights[i];
  const act = btn.dataset.act;
  const r10 = x => Math.round(x * 10) / 10;

  if (act === 'del') {
    state.highlights.splice(i, 1);
    renderList();
    scheduleSaveState();
    return;
  }
  if (act === 'goIn') { els.video.currentTime = h.s; return; }
  if (act === 'goOut') { els.video.currentTime = h.e; return; }
  if (act === 'play') {
    els.video.currentTime = h.s;
    state.previewStop = h.e;
    els.video.playbackRate = h.slow ? parseFloat(els.slowRate.value) : 1;
    els.video.play();
    return;
  }
  if (act === 'inMinus')  h.s = Math.max(0, r10(h.s - 0.1));
  if (act === 'inPlus')   h.s = Math.min(h.e - 0.2, r10(h.s + 0.1));
  if (act === 'outMinus') h.e = Math.max(h.s + 0.2, r10(h.e - 0.1));
  if (act === 'outPlus')  h.e = Math.min(state.duration, r10(h.e + 0.1));

  const vals = row.querySelectorAll('.hl-time__val');
  vals[0].textContent = formatSec(h.s);
  vals[1].textContent = formatSec(h.e);
  renderTrack();
  scheduleSaveState();
});

els.hlList.addEventListener('input', e => {
  const row = e.target.closest('.hl-row');
  if (!row) return;
  const h = state.highlights[+row.dataset.i];
  if (e.target.classList.contains('hl-row__title')) h.t = e.target.value;
  if (e.target.classList.contains('hl-slow-cb')) h.slow = e.target.checked;
  scheduleSaveState();
});

// ── Embed-generering ─────────────────────────────────────────────────────

function buildEmbedSnippet() {
  const id = 'fhl-' + Math.random().toString(36).slice(2, 8);
  const baseUrl = escapeHtml(state.url.split('#')[0]);
  const dur = state.duration;
  const slowRate = parseFloat(els.slowRate.value) || 0.5;
  const stopAtEnd = els.stopAtEnd.checked;
  const hs = state.highlights.slice().sort((a, b) => a.s - b.s);

  const vw = els.video.videoWidth || 16;
  const vh = els.video.videoHeight || 9;
  const aspect = (vw / vh).toFixed(4);

  const posterBg = state.posterDataUrl
    ? `background-image:url('${state.posterDataUrl}');background-size:cover;background-position:center;`
    : 'background:#1a1a1a;';

  // Base-CSS med design-tokens fra shared/embed-tokens.js
  const baseCss = (typeof window !== 'undefined' && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss('fhl-container')
    : '';

  // Segmenter og knapper posisjoneres ved byggetid — varigheten er kjent her,
  // så embed-JS slipper å vente på loadedmetadata for layout.
  const segs = hs.map((h, i) =>
    `<div class="fhl-seg" data-i="${i}" style="left:${(h.s / dur * 100).toFixed(2)}%;width:${(Math.max(0.2, h.e - h.s) / dur * 100).toFixed(2)}%;" title="${escapeHtml(h.t)}"></div>`
  ).join('\n      ');

  const chips = hs.map((h, i) =>
    `<button type="button" class="fhl-chip" data-i="${i}" data-s="${h.s.toFixed(2)}" data-e="${h.e.toFixed(2)}" data-slow="${h.slow ? 1 : 0}">${escapeHtml(h.t)}${h.slow ? '<span class="fhl-slowtag">sakte</span>' : ''}</button>`
  ).join('\n      ');

  return `<!-- ============================================
     FAKTISK · VIDEOHØYDEPUNKTER
     Tidslinje med klikkbare høydepunkter
     ============================================ -->
<div class="fhl-container">
  <style>${baseCss}
    .fhl-wrap-${id} { width: 100%; }
    .fhl-video-${id} {
      position: relative; width: 100%; aspect-ratio: ${aspect};
      border-radius: var(--fk-radius-md); overflow: hidden; background: #000;
    }
    .fhl-play-${id} {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: clamp(56px, 12cqw, 100px); height: clamp(56px, 12cqw, 100px);
      border: 0; background: transparent; cursor: pointer; padding: 0;
      transition: transform 0.1s;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.25));
    }
    .fhl-play-${id}:hover { transform: translate(-50%, -50%) scale(1.05); }
    .fhl-play-${id} svg { display: block; width: 100%; height: 100%; }
    .fhl-track-${id} {
      position: relative; height: 16px; margin-top: 10px;
      background: #E4E4E4; border-radius: 8px; cursor: pointer; overflow: hidden;
    }
    .fhl-track-${id} .fhl-seg {
      position: absolute; top: 0; bottom: 0;
      background: var(--fk-blue); opacity: 0.35; border-radius: 8px;
      pointer-events: none;
    }
    .fhl-track-${id} .fhl-seg.on { opacity: 0.85; }
    .fhl-fill-${id} {
      position: absolute; left: 0; top: 0; bottom: 0; width: 0;
      background: rgba(0,0,0,0.16); pointer-events: none;
    }
    .fhl-head-${id} {
      position: absolute; top: 0; bottom: 0; width: 2px;
      background: var(--fk-ink); pointer-events: none;
    }
    .fhl-bar-${id} {
      display: flex; align-items: center; gap: 10px; margin-top: 8px;
    }
    .fhl-bar-${id} button {
      border: 1px solid #D9D9D9; background: var(--fk-white);
      border-radius: var(--fk-radius-sm); padding: 6px 12px;
      font-family: var(--fk-font); font-weight: var(--fk-fw-bold);
      font-size: 14px; color: var(--fk-ink); cursor: pointer;
    }
    .fhl-bar-${id} button:hover { border-color: #999; }
    .fhl-speed-${id}.on {
      background: var(--fk-blue); border-color: var(--fk-blue); color: var(--fk-white);
    }
    .fhl-time-${id} {
      font-variant-numeric: tabular-nums; color: var(--fk-ink-dim); font-size: 13px;
    }
    .fhl-spacer-${id} { flex: 1; }
    .fhl-chips-${id} { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .fhl-chips-${id} .fhl-chip {
      border: 1px solid #D9D9D9; background: #F5F5F5;
      border-radius: 999px; padding: 7px 16px;
      font-family: var(--fk-font); font-weight: var(--fk-fw-bold);
      font-size: 13.5px; color: var(--fk-ink); cursor: pointer;
    }
    .fhl-chips-${id} .fhl-chip:hover { border-color: #999; }
    .fhl-chips-${id} .fhl-chip.on {
      background: var(--fk-blue); border-color: var(--fk-blue); color: var(--fk-white);
    }
    .fhl-chip .fhl-slowtag { font-size: 11px; opacity: 0.75; margin-left: 6px; }
  </style>
  <div class="fhl-wrap-${id}">
    <div class="fhl-video-${id}" style="${posterBg}">
      <video id="${id}" data-src="${baseUrl}" playsinline webkit-playsinline preload="none" aria-label="Video med høydepunkter" style="width:100%;height:100%;display:block;"></video>
      <div id="${id}-cover" style="position:absolute;inset:0;${posterBg}transition:opacity 0.2s;pointer-events:none;"></div>
      <button class="fhl-play-${id}" id="${id}-bigplay" aria-label="Spill av video" type="button">
        <svg viewBox="0 0 230.89 230.89" aria-hidden="true">
          <circle cx="115.45" cy="115.45" r="115.45" fill="#0050fc"/>
          <path fill="#fff" d="M165.51,109.38l-76.8-44.34c-4.67-2.69-10.5.67-10.5,6.06v88.69c0,5.39,5.83,8.76,10.5,6.06l76.8-44.34c4.67-2.69,4.67-9.43,0-12.12Z"/>
        </svg>
      </button>
    </div>
    <div class="fhl-track-${id}" id="${id}-track">
      ${segs}
      <div class="fhl-fill-${id}" id="${id}-fill"></div>
      <div class="fhl-head-${id}" id="${id}-head"></div>
    </div>
    <div class="fhl-bar-${id}">
      <button type="button" id="${id}-play" aria-label="Spill av / pause">▶</button>
      <span class="fhl-time-${id}" id="${id}-time">0:00 / ${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}</span>
      <span class="fhl-spacer-${id}"></span>
      <button type="button" class="fhl-speed-${id}" id="${id}-speed" title="Avspillingshastighet">1×</button>
    </div>
    <div class="fhl-chips-${id}" id="${id}-chips">
      ${chips}
    </div>
  </div>
</div>
<script>
(function(){
  var v = document.getElementById('${id}');
  if(!v || v.__fhl) return; v.__fhl = 1;
  var byId = function(sfx){ return document.getElementById('${id}' + sfx); };
  var bigplay = byId('-bigplay'), cover = byId('-cover'), track = byId('-track');
  var fill = byId('-fill'), head = byId('-head'), play = byId('-play');
  var time = byId('-time'), speed = byId('-speed'), chips = byId('-chips');
  var DUR = ${dur.toFixed(2)};
  var SLOW = ${slowRate};
  var STOP = ${stopAtEnd};
  var RATES = [1, SLOW, 0.25].filter(function(x, i, a){ return a.indexOf(x) === i; });
  var segEls = track.querySelectorAll('.fhl-seg');
  var chipEls = chips.querySelectorAll('.fhl-chip');
  var act = null, actIdx = -1, inited = false;

  function fmt(t){
    if(!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = Math.floor(t - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function hideCover(){
    if(cover){ cover.style.opacity = '0';
      setTimeout(function(){ if(cover) cover.style.display = 'none'; }, 250); }
    if(bigplay) bigplay.style.display = 'none';
  }
  function init(cb){
    if(inited){ cb(); return; }
    inited = true;
    v.src = v.dataset.src;
    v.addEventListener('loadedmetadata', function(){ cb(); }, {once:true});
    v.addEventListener('playing', hideCover, {once:true});
    setTimeout(hideCover, 3000);
  }
  function setRate(r){
    try{ v.playbackRate = r; }catch(e){}
    if('preservesPitch' in v) v.preservesPitch = true;
    speed.textContent = (r === 1 ? '1×' : String(r).replace('.', ',') + '×');
    if(r === 1){ speed.classList.remove('on'); } else { speed.classList.add('on'); }
  }
  function setActive(i){
    act = (i < 0) ? null : {
      s: parseFloat(chipEls[i].dataset.s),
      e: parseFloat(chipEls[i].dataset.e)
    };
    actIdx = i;
    var j;
    for(j = 0; j < chipEls.length; j++){
      if(j === i){ chipEls[j].classList.add('on'); } else { chipEls[j].classList.remove('on'); }
    }
    for(j = 0; j < segEls.length; j++){
      if(j === i){ segEls[j].classList.add('on'); } else { segEls[j].classList.remove('on'); }
    }
  }
  function go(i){
    var c = chipEls[i];
    init(function(){
      v.currentTime = parseFloat(c.dataset.s);
      setActive(i);
      setRate(c.dataset.slow === '1' ? SLOW : 1);
      var p = v.play(); if(p && p.catch) p.catch(function(){});
    });
  }
  for(var ci = 0; ci < chipEls.length; ci++){
    (function(i){ chipEls[i].addEventListener('click', function(){ go(i); }); })(ci);
  }
  bigplay.addEventListener('click', function(){
    init(function(){ var p = v.play(); if(p && p.catch) p.catch(function(){}); });
  });
  play.addEventListener('click', function(){
    init(function(){
      if(v.paused){ var p = v.play(); if(p && p.catch) p.catch(function(){}); }
      else { v.pause(); }
    });
  });
  speed.addEventListener('click', function(){
    var i = RATES.indexOf(v.playbackRate);
    setRate(RATES[(i + 1) % RATES.length] || 1);
  });
  v.addEventListener('play', function(){ play.textContent = '❚❚'; });
  v.addEventListener('pause', function(){ play.textContent = '▶'; });
  function tick(){
    var t = v.currentTime || 0;
    fill.style.width = (t / DUR * 100) + '%';
    head.style.left = (t / DUR * 100) + '%';
    time.textContent = fmt(t) + ' / ' + fmt(DUR);
    if(act && t >= act.e - 0.03){
      if(STOP) v.pause();
      setRate(1);
      setActive(-1);
    }
  }
  v.addEventListener('timeupdate', tick);
  v.addEventListener('seeking', function(){
    if(act && (v.currentTime < act.s - 0.5 || v.currentTime > act.e + 0.5)){
      setRate(1); setActive(-1);
    }
  });
  function seekEv(ev){
    var r = track.getBoundingClientRect();
    var cx = (ev.touches && ev.touches.length ? ev.touches[0].clientX : ev.clientX);
    var p = Math.min(1, Math.max(0, (cx - r.left) / r.width));
    init(function(){ v.currentTime = p * DUR; tick(); });
  }
  track.addEventListener('mousedown', function(e){
    seekEv(e);
    function mv(e2){ seekEv(e2); }
    function up(){ document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
  track.addEventListener('touchstart', function(e){ seekEv(e); }, {passive:true});
  track.addEventListener('touchmove', function(e){ seekEv(e); }, {passive:true});
})();
<\/script>
`;
}

// ── Kopier embed ─────────────────────────────────────────────────────────

function updateButtons() {
  const on = state.loaded;
  els.btnIn.disabled = !on;
  els.btnOut.disabled = !on;
  els.copyEmbed.disabled = !(on && state.highlights.length > 0);
}

els.copyEmbed.addEventListener('click', async () => {
  if (els.copyEmbed.disabled) return;
  // Poster: stillbilde fra første høydepunkt (eller tidlig i klippet)
  const posterTime = state.highlights.length
    ? state.highlights[0].s
    : Math.min(1, state.duration / 4);
  const key = state.url + '@' + posterTime.toFixed(2);
  if (state.posterForKey !== key || !state.posterDataUrl) {
    setStatus('Genererer stillbilde…');
    try {
      const res = await window.faktisk.generateThumbnail({
        url: state.url,
        atTime: posterTime,
      });
      if (res.ok) {
        state.posterDataUrl = res.dataUrl;
        state.posterForKey = key;
      }
    } catch (e) { console.warn(e); }
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

// ── Arkivering (state + prosjekter) ──────────────────────────────────────

let isRestoring = false;

function serializeState() {
  return {
    url: els.url.value,
    highlights: state.highlights.map(h => ({ t: h.t, s: h.s, e: h.e, slow: !!h.slow })),
    slowRate: els.slowRate.value,
    stopAtEnd: els.stopAtEnd.checked,
  };
}

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    if (typeof saved.slowRate === 'string' && ['0.5', '0.25'].includes(saved.slowRate)) {
      els.slowRate.value = saved.slowRate;
    }
    els.stopAtEnd.checked = saved.stopAtEnd !== false;
    state.highlights = Array.isArray(saved.highlights)
      ? saved.highlights
          .filter(h => typeof h.s === 'number' && typeof h.e === 'number' && h.e > h.s)
          .map(h => ({ t: String(h.t || ''), s: h.s, e: h.e, slow: !!h.slow }))
      : [];
    if (saved.url) {
      els.url.value = saved.url;
      await loadVideo();
    }
    renderList();
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
  els.slowRate.addEventListener(ev, scheduleSaveState);
  els.stopAtEnd.addEventListener(ev, scheduleSaveState);
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
  const firstTitle = state.highlights.length ? state.highlights[0].t : '';
  const defaultName = (firstTitle || '').slice(0, 40).trim()
    || `Høydepunkter ${new Date().toLocaleDateString('no')}`;
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
