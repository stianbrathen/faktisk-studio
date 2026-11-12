// Faktisk Studio · Videoslider
//
// Slider med stående videoer (TikTok-videoene) til forsiden og artikler på
// faktisk.no. Redaktøren henter videoene fra Labrador (eller laster dem opp),
// Studio lager stillbildene og legger dem i Labrador, og embedden kopieres.
//
// Embedden:
// - er ferdig rendret HTML (kortene vises også når skriptet sover i Labrador),
// - lenker video og stillbilder fra Labrador (aldri base64),
// - laster videoene først når leseren åpner det store vinduet,
// - er scopet til en unik klasse, så flere bokser kan stå på samme side,
// - måler med Fathom (se runtime.js).
// Forhåndsvisningen ER embed-markupen; runtime.js (fvsRun) kjører med preview: true.

const PLUGIN_ID = 'videoslider';
let PLUGIN_VERSION = '';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    if (me) PLUGIN_VERSION = me.version;
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const $ = id => document.getElementById(id);
const els = {
  kicker: $('kickerInput'), title: $('titleInput'), lede: $('ledeInput'),
  followText: $('followText'), followUrl: $('followUrl'), linkLabel: $('linkLabel'),
  addFiles: $('addFilesBtn'), addUpload: $('addUploadBtn'), addEmpty: $('addEmptyBtn'),
  addPanel: $('addPanel'), addStatus: $('addStatus'),
  list: $('videoList'), allPosters: $('allPostersBtn'),
  previewWidth: $('previewWidthSelect'), previewHost: $('previewHost'), copyEmbed: $('copyEmbedBtn'),
  back: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
  importToggle: $('importToggle'), importPanel: $('importPanel'), importInput: $('importInput'),
  importBtn: $('importBtn'), importStatus: $('importStatus'),
  picker: $('picker'), pickerVideo: $('pickerVideo'), pickerTime: $('pickerTime'),
  pickerUse: $('pickerUse'), pickerCancel: $('pickerCancel'),
};

const state = {
  // { key, src, title, link, dur ("0:45"), poster, posterAt (sek) }
  videos: [],
};
const busy = new Map();   // key → statustekst mens stillbilde lages (lagres ikke)

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const LEFT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>';
const RIGHT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(\?|#|$)/i;
const IMG_EXT = /\.(png|jpe?g|gif|avif|webp)(\?|$)/i;
const FILTERS = {
  // Labrador tar mp4 (ikke mov). Eksporter mp4 med H.264 og «fast start».
  video: [{ name: 'Video (mp4)', extensions: ['mp4'] }],
  image: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }],
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidUrl(s) {
  try { const u = new URL(String(s || '').trim()); return u.protocol === 'https:' || u.protocol === 'http:'; }
  catch (e) { return false; }
}
function isLabradorUrl(u) { return /faktisk\.no\//.test(u || ''); }
function cleanUrl(u) {
  u = String(u || '').trim();
  try { return encodeURI(decodeURI(u)); } catch (e) { return u; }
}
function fileName(u) {
  const last = String(u || '').split('#')[0].split('?')[0].split('/').pop() || '';
  try { return decodeURIComponent(last); } catch (e) { return last; }
}
function fmtDur(sec) {
  if (!(sec > 0) || !isFinite(sec)) return '';
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function normDur(s) {
  const m = /^\s*(\d{1,3}):(\d{2})\s*$/.exec(s || '');
  return m ? (+m[1]) + ':' + m[2] : '';
}
function fmtSec(t) { return (Math.round((t || 0) * 10) / 10).toFixed(1).replace('.', ',') + ' s'; }
function newVideo(o) {
  return Object.assign({ key: 'v_' + Math.random().toString(36).slice(2, 7), src: '', title: '', link: '', dur: '', poster: '', posterAt: 1, start: '' }, o || {});
}
const alertBox = msg => window.faktiskDialog.alert(msg);

// ---------- Dato og sortering ----------
// TikTok-ID-en inneholder publiseringstidspunktet: de øverste 32 bitene er
// Unix-sekunder. Da får også videoer lagt inn via lenke eller fra Labrador
// (tiktok-<id>.mp4) en dato, uten noe ekstra kall til TikTok.
function tiktokTime(id) {
  try {
    if (!/^\d{15,22}$/.test(String(id || ''))) return 0;
    const sec = Number(BigInt(id) >> 32n);
    return sec > 1.4e9 && sec < 2.2e9 ? sec : 0;
  } catch (e) { return 0; }
}
function videoTime(v) {
  return Number(v.ts) || tiktokTime(tiktokIdOf(v.link)) || tiktokTime(tiktokIdOf(v.src)) || 0;
}
function fmtDate(sec) {
  return sec ? new Date(sec * 1000).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
// Nyeste først. Videoer uten dato (egne opplastinger) beholder innbyrdes
// rekkefølge og havner sist.
function sortNewestFirst() {
  const withIdx = state.videos.map((v, i) => ({ v, i, t: videoTime(v) }));
  withIdx.sort((a, b) => (b.t - a.t) || (a.i - b.i));
  state.videos = withIdx.map(x => x.v);
}

// ============================================================
//  Videoene i sidepanelet
// ============================================================

function renderVideos() {
  // Stillbilder lages i bakgrunnen og tegner lista på nytt: behold feltet
  // redaktøren skriver i (fokus og markør), så teksten ikke blir avbrutt.
  const a = document.activeElement;
  const keep = a && els.list.contains(a) && a.dataset && a.dataset.k
    ? { k: a.dataset.k, act: a.dataset.act, s: a.selectionStart, e: a.selectionEnd } : null;
  els.list.innerHTML = '';
  state.videos.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'hk-row';
    const b = busy.get(v.key);
    const posterOk = isLabradorUrl(v.poster);
    const srcBad = v.src && !isLabradorUrl(v.src);
    const stateText = b || (posterOk ? 'Stillbilde i Labrador ✓' + (isLabradorUrl(v.start) ? ' · startbilde ✓' : v.startErr ? ' · startbilde feilet: ' + v.startErr : ' · mangler startbilde')
      : v.poster ? 'Stillbildet ligger ikke i Labrador' : 'Mangler stillbilde');
    const stateCls = b ? '' : posterOk ? 'is-ok' : 'is-bad';
    row.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${i + 1}</span>
        <input class="hk-row__title" value="${escapeHtml(v.title)}" data-k="${v.key}" data-act="title" placeholder="Tittel (vises under videoen)">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" type="button" data-act="up" data-k="${v.key}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn" type="button" data-act="down" data-k="${v.key}" title="Flytt ned" ${i === state.videos.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tb-row__btn tb-row__btn--del" type="button" data-act="del" data-k="${v.key}" title="Fjern videoen">×</button>
        </span>
      </div>
      <div class="vs-media">
        <button type="button" class="vs-thumbbtn" data-act="pick" data-k="${v.key}" title="Velg stillbilde" ${v.src && !b ? '' : 'disabled'}>${v.poster
          ? `<img class="vs-thumb" src="${escapeHtml(v.poster)}" alt="">`
          : '<span class="vs-thumb vs-thumb--empty">▶</span>'}</button>
        <div class="vs-fields">
          <input class="hk-row__img" value="${escapeHtml(v.src)}" data-k="${v.key}" data-act="src" placeholder="Video-URL fra Labrador (mp4)" spellcheck="false">
          <input class="hk-row__img" value="${escapeHtml(v.link)}" data-k="${v.key}" data-act="link" placeholder="TikTok-lenke til videoen (valgfri)" spellcheck="false">
          <div class="vs-meta">
            <input class="ftb-value vs-dur" value="${escapeHtml(v.dur)}" data-k="${v.key}" data-act="dur" placeholder="m:ss" title="Varighet (fylles ut automatisk)">
            ${videoTime(v) ? `<span class="vs-date" title="Publisert på TikTok">${escapeHtml(fmtDate(videoTime(v)))}</span>` : ''}
            <span class="vs-poststate ${stateCls}">${escapeHtml(stateText)}</span>
          </div>
        </div>
      </div>
      ${srcBad ? '<p class="vs-row-warn">Videoen ligger ikke i Labrador.</p>' : ''}
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="pick" data-k="${v.key}" ${v.src && !b ? '' : 'disabled'}>Velg stillbilde…</button>
        <button class="ftb-labbtn" type="button" data-act="files" data-k="${v.key}">Bilde fra Labrador ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-k="${v.key}">Last opp bilde…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${v.key}" style="display:none;"></div>`;
    els.list.appendChild(row);
  });
  if (keep) {
    const el = els.list.querySelector(`[data-k="${keep.k}"][data-act="${keep.act}"]`);
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {}
    }
  }
  markTT();
}

els.list.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || btn.disabled) return;
  const { act, k } = btn.dataset;
  const i = state.videos.findIndex(x => x.key === k);
  if (i < 0) return;
  const v = state.videos[i];
  if (act === 'del') { state.videos.splice(i, 1); renderVideos(); scheduleUpdate(); }
  if (act === 'up' || act === 'down') {
    const j = i + (act === 'up' ? -1 : 1);
    if (j < 0 || j >= state.videos.length) return;
    const [x] = state.videos.splice(i, 1);
    state.videos.splice(j, 0, x);
    renderVideos(); scheduleUpdate();
  }
  if (act === 'pick') openPicker(v);
  if (act === 'files') {
    const panel = els.list.querySelector(`[data-panel="${k}"]`);
    openFilePanel(panel, IMG_EXT, 'bilder', url => { v.poster = url; renderVideos(); scheduleUpdate(); });
  }
  if (act === 'upload') uploadFile(btn, 'image', url => { v.poster = url; renderVideos(); scheduleUpdate(); });
});

els.list.addEventListener('input', e => {
  const { act, k } = e.target.dataset;
  const v = state.videos.find(x => x.key === k);
  if (!v || !act) return;
  const val = e.target.value;
  if (act === 'title') v.title = val;
  if (act === 'link') v.link = val.trim();
  if (act === 'dur') v.dur = val.trim();
  if (act === 'src') v.src = val.trim();
  scheduleUpdate();
});

// Ny video-URL: nullstill varighet og stillbilde, og hent dem på nytt
els.list.addEventListener('change', e => {
  const { act, k } = e.target.dataset;
  const v = state.videos.find(x => x.key === k);
  if (!v) return;
  if (act === 'src') { v.dur = ''; v.poster = ''; renderVideos(); scheduleUpdate(); probe(v); }
  if (act === 'dur') { v.dur = normDur(v.dur) || v.dur; renderVideos(); }
});

// ============================================================
//  Legge til videoer
// ============================================================

function setAddStatus(msg, bad) {
  els.addStatus.textContent = msg || '';
  els.addStatus.classList.toggle('is-bad', !!bad);
}

// «+ Fra Labrador»: panelet står åpent, så flere videoer kan legges til etter
// hverandre. De legges øverst, i den rekkefølgen de klikkes.
let addAt = 0;
els.addFiles.addEventListener('click', () => {
  addAt = 0;
  openFilePanel(els.addPanel, VIDEO_EXT, 'videoer', url => {
    const v = newVideo({ src: url });
    state.videos.splice(Math.min(addAt, state.videos.length), 0, v);
    addAt++;
    renderVideos(); scheduleUpdate();
    setAddStatus(`La til «${fileName(url)}». Skriv tittel og TikTok-lenke i raden.`);
    probe(v);
  }, { keepOpen: true });
});

els.addUpload.addEventListener('click', () => uploadFile(els.addUpload, 'video', url => {
  const v = newVideo({ src: url });
  state.videos.unshift(v);
  renderVideos(); scheduleUpdate();
  probe(v);
}));

els.addEmpty.addEventListener('click', () => {
  state.videos.unshift(newVideo());
  renderVideos(); scheduleUpdate();
  const first = els.list.querySelector('[data-act="src"]');
  if (first) first.focus();
});

// Varighet fra videoens metadata
function probeDuration(url) {
  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    let t = null;
    const done = s => {
      clearTimeout(t);
      vid.removeAttribute('src');
      try { vid.load(); } catch (e) {}
      resolve(s);
    };
    t = setTimeout(() => done(0), 20000);
    vid.addEventListener('loadedmetadata', () => done(isFinite(vid.duration) ? vid.duration : 0), { once: true });
    vid.addEventListener('error', () => done(0), { once: true });
    vid.src = url;
  });
}

// Stillbilder lages ett om gangen (Studio laster ned videoen og kjører ffmpeg)
let posterQueue = Promise.resolve();
function queue(fn) {
  const p = posterQueue.then(fn, fn);
  posterQueue = p.catch(() => {});
  return p;
}

async function probe(v) {
  if (!isValidUrl(v.src)) return;
  if (!v.dur) {
    const sec = await probeDuration(v.src);
    if (sec && !v.dur) { v.dur = fmtDur(sec); renderVideos(); scheduleUpdate(); }
  }
  if (!v.poster && isLabradorUrl(v.src)) {
    await queue(() => (state.videos.includes(v) && !v.poster) ? makePoster(v, v.posterAt || 1, { quiet: true }) : false);
  }
}

async function ensureLoggedIn() {
  const st = await window.faktisk.labradorListFiles();
  if (st && st.loggedIn) return st;
  const c = await window.faktisk.labradorConnect();
  if (!c || !c.loggedIn) return null;
  return window.faktisk.labradorListFiles();
}

// Studio henter bildet fra videoen og legger det i Labrador med fast navn
// (<video>-poster-<t>s.jpg), så samme bilde gjenbrukes ved neste eksport.
async function makePoster(v, atTime, o) {
  o = o || {};
  if (!isLabradorUrl(v.src)) {
    if (!o.quiet) await alertBox('Stillbilder lages bare for videoer som ligger i Labrador.');
    return false;
  }
  const t = Math.max(0, Math.round((atTime || 0) * 10) / 10);
  busy.set(v.key, 'Lager stillbilde…');
  renderVideos();
  try {
    let res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    if (res && res.loggedIn === false && !o.quiet) {
      const c = await window.faktisk.labradorConnect();
      if (c && c.loggedIn) res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    }
    if (res && res.ok && res.url) {
      v.poster = res.url; v.posterAt = t;
      // Automatisk stillbilde (ikke valgt for hånd): mange TikTok-videoer er
      // svarte eller toner inn ved 1 s. Er bildet nesten svart, prøv lenger ut.
      // Bare for standardtidspunktet (1 s) — et tidspunkt valgt for hånd røres ikke
      if (o.quiet && !o.noRetry && t === 1) await avoidDarkPoster(v);
      await ensureStartFrame(v);
      return true;
    }
    if (!o.quiet) {
      await alertBox(res && res.loggedIn === false
        ? 'Fikk ikke gyldig innlogging i Labrador.'
        : 'Kunne ikke lage stillbilde: ' + ((res && res.error) || 'ukjent feil'));
    }
    return false;
  } catch (err) {
    if (!o.quiet) await alertBox('Kunne ikke lage stillbilde: ' + err.message);
    return false;
  } finally {
    busy.delete(v.key);
    renderVideos();
    scheduleUpdate();
  }
}

// ---------- Startbilde ----------
// Stillbildet (kortet i slideren) er hentet ved 1 s eller senere, men videoen
// starter på 0 s — byttet fra stillbilde til video ga et synlig rykk i det
// store vinduet (Stian 04.11.2026). Startbildet (første bilde i videoen)
// brukes derfor bak videoen i det store vinduet; kortene beholder stillbildet.
// Starter klippet svart, er startbildet svart — slik videoen faktisk ser ut.
async function ensureStartFrame(v) {
  if (isLabradorUrl(v.start) || !isLabradorUrl(v.src)) return;
  try {
    busy.set(v.key, 'Lager startbilde…');
    renderVideos();
    // Noen videoer har ikke et bilde nøyaktig på 0,0 s (tidsstempler som
    // starter litt etter null); prøv da like etter starten.
    let res = null, err = '';
    for (const t of [0, 0.1, 0.3]) {
      try { res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t }); }
      catch (e) { res = { ok: false, error: e.message }; }
      if (res && res.ok && res.url) { v.start = res.url; v.startErr = ''; return; }
      err = (res && (res.error || (res.loggedIn === false ? 'ikke innlogget i Labrador' : ''))) || 'ukjent feil';
    }
    v.startErr = err;
    console.warn('Startbilde feilet for', v.src, err);
  } catch (e) { v.startErr = e.message; }
}

// ---------- Unngå svarte stillbilder ----------
const DARK_LIMIT = 22;                 // snittlysstyrke 0–255; under = «svart»
const RETRY_TIMES = [2.5, 4, 6, 9, 13];

// Snittlysstyrke for et bilde i Labrador (Labrador sender CORS-hoder, samme
// mønster som de andre pluginene). null hvis det ikke lar seg måle.
function posterBrightness(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 42;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        resolve(sum / (d.length / 4));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url + (url.includes('?') ? '&' : '?') + 'lum=1';
  });
}
function durSeconds(v) {
  const m = /^(\d+):(\d{2})$/.exec(String(v.dur || '').trim());
  return m ? +m[1] * 60 + +m[2] : 0;
}
// Prøver nye tidspunkter til bildet ikke er svart. Finner den ikke noe lyst,
// beholdes det lyseste. Hvert forsøk lagres i Labrador (…-poster-<t>s.jpg).
async function avoidDarkPoster(v) {
  let lum = await posterBrightness(v.poster);
  if (lum == null || lum >= DARK_LIMIT) return;
  let best = { url: v.poster, t: v.posterAt, lum };
  const dur = durSeconds(v);
  for (const t of RETRY_TIMES) {
    if (dur && t > dur - 0.5) break;
    busy.set(v.key, 'Stillbildet ble svart – prøver ' + String(t).replace('.', ',') + ' s …');
    renderVideos();
    const res = await window.faktisk.labradorThumbnail({ url: v.src.split('#')[0], atTime: t });
    if (!res || !res.ok || !res.url) break;
    lum = await posterBrightness(res.url);
    if (lum == null) break;
    if (lum > best.lum) best = { url: res.url, t, lum };
    if (lum >= DARK_LIMIT) break;
  }
  v.poster = best.url; v.posterAt = best.t;
}

document.getElementById('sortDateBtn').addEventListener('click', () => {
  if (!state.videos.some(v => videoTime(v))) { setAddStatus('Ingen av videoene har dato (bare TikTok-videoer har det).'); return; }
  sortNewestFirst(); renderVideos(); scheduleUpdate();
  setAddStatus('Sortert med nyeste først. Videoer uten dato ligger sist.');
});

els.allPosters.addEventListener('click', async () => {
  // Ta også med videoer som har et svart, automatisk stillbilde (ved 1 s)
  const dark = [];
  for (const v of state.videos) {
    if (isLabradorUrl(v.src) && isLabradorUrl(v.poster) && (v.posterAt || 1) === 1) {
      const lum = await posterBrightness(v.poster);
      if (lum != null && lum < DARK_LIMIT) dark.push(v);
    }
  }
  const todo = state.videos.filter(v => isLabradorUrl(v.src) && (!isLabradorUrl(v.poster) || !isLabradorUrl(v.start) || dark.includes(v)));
  if (!todo.length) { await alertBox('Alle videoene har allerede stillbilde i Labrador.'); return; }
  const list = await ensureLoggedIn();
  if (!list) { await alertBox('Fikk ikke gyldig innlogging i Labrador.'); return; }
  els.allPosters.disabled = true;
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    els.allPosters.textContent = `Lager ${i + 1} av ${todo.length}…`;
    if (await queue(() => makePoster(todo[i], todo[i].posterAt || 1, { quiet: true }))) ok++;
  }
  els.allPosters.disabled = false;
  els.allPosters.textContent = 'Lag alle stillbilder i Labrador';
  if (ok < todo.length) {
    await alertBox(`${ok} av ${todo.length} stillbilder ble laget. Prøv de andre med «Velg stillbilde…» i raden.`);
  }
});

// ============================================================
//  Velg stillbilde (spol til riktig bilde)
// ============================================================

let pickerFor = null;
function openPicker(v) {
  if (!v || !v.src) return;
  pickerFor = v;
  const pv = els.pickerVideo;
  pv.addEventListener('loadedmetadata', () => {
    const d = pv.duration || 0;
    try { pv.currentTime = Math.min(v.posterAt || 1, Math.max(0, d - 0.1)); } catch (e) {}
  }, { once: true });
  pv.src = v.src;
  els.pickerTime.textContent = fmtSec(v.posterAt || 1);
  els.picker.hidden = false;
  els.pickerUse.focus();
}
function closePicker() {
  els.picker.hidden = true;
  const pv = els.pickerVideo;
  try { pv.pause(); } catch (e) {}
  pv.removeAttribute('src');
  try { pv.load(); } catch (e) {}
  pickerFor = null;
}
['timeupdate', 'seeked'].forEach(ev => els.pickerVideo.addEventListener(ev, () => {
  els.pickerTime.textContent = fmtSec(els.pickerVideo.currentTime);
}));
els.pickerCancel.addEventListener('click', closePicker);
els.pickerUse.addEventListener('click', async () => {
  const v = pickerFor;
  const t = els.pickerVideo.currentTime || 0;
  closePicker();
  if (v) await queue(() => makePoster(v, t));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !els.picker.hidden) closePicker();
});

// ============================================================
//  Labrador: filpanel og opplasting
// ============================================================

async function openFilePanel(panel, extRe, noun, onPick, o) {
  o = o || {};
  if (!panel) return;
  const open = panel.style.display !== 'none';
  document.querySelectorAll('.ftb-labpanel').forEach(p => { p.style.display = 'none'; });
  if (open) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res || !res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st && st.loggedIn) { panel.style.display = 'none'; openFilePanel(panel, extRe, noun, onPick, o); }
      else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => extRe.test(f.url)).slice(0, 80);
  if (!matching.length) {
    panel.innerHTML = `<div class="ftb-labpanel__status">Ingen ${noun} lastet opp ennå.</div>`;
    return;
  }
  panel.innerHTML = `<div class="ftb-labpanel__status">${matching.length} ${noun} (nyeste først)${o.keepOpen ? ' – klikk flere for å legge dem til' : ''}</div><div class="ftb-labpanel__list"></div>`;
  const list = panel.querySelector('.ftb-labpanel__list');
  const used = new Set(state.videos.map(v => v.src));
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ftb-labfile';
    item.textContent = (o.keepOpen && used.has(f.url) ? '✓ ' : '') + f.name;
    item.title = f.url;
    item.addEventListener('click', () => {
      if (o.keepOpen) item.textContent = '✓ ' + f.name;
      else panel.style.display = 'none';
      onPick(f.url);
    });
    list.appendChild(item);
  });
}

async function uploadFile(btn, kind, onUrl) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => {
        if (msg.percent != null) btn.textContent = msg.percent + ' %…';
        if (kind === 'video') setAddStatus(msg.label || ('Laster opp… ' + msg.percent + ' % (' + msg.sentMB + ' av ' + msg.totalMB + ' MB)'));
      })
    : () => {};
  try {
    const res = await window.faktisk.labradorUpload({ filters: FILTERS[kind] });
    if (!res || res.canceled) { if (kind === 'video') setAddStatus(''); return; }
    if (!res.ok) { if (kind === 'video') setAddStatus(''); await alertBox('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) {
      if (kind === 'video') setAddStatus('Lastet opp «' + (res.name || fileName(res.url)) + '» ✓');
      onUrl(res.url);
    } else {
      await alertBox(res.note || 'Lastet opp, men fant ikke URL — se «Fra Labrador».');
    }
  } catch (err) {
    await alertBox('Opplasting feilet: ' + err.message);
  } finally {
    unsub();
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ============================================================
//  Hent fra TikTok (krever Studio 0.7.13+: yt-dlp kjører i Studio)
// ============================================================
// Lista viser de siste videoene på profilen. Redaktøren krysser av, og Studio
// laster ned hver video (uten vannmerke når TikTok har den), legger den i
// Labrador som tiktok-<id>.mp4 og returnerer adressen. Raden fylles ut med
// tittel (TikTok-teksten uten emneknagger), TikTok-lenke og lengde, og
// stillbildet lages i bakgrunnen som for andre videoer.

var tt = { items: [], sel: new Set(), busy: false, prefix: '', lastErr: '' };
var ttEls = {
  section: $('ttSection'), row: $('ttRow'), profile: $('ttProfile'), fetch: $('ttFetchBtn'),
  status: $('ttStatus'), list: $('ttList'), add: $('ttAddBtn'), paste: $('ttPaste'),
  links: $('ttLinks'), linksBtn: $('ttLinksBtn'), old: $('ttOld'),
};
const ttSupported = !!(window.faktisk && window.faktisk.tiktokList && window.faktisk.tiktokImport);
if (!ttSupported) {
  [ttEls.row, ttEls.paste].forEach(el => { if (el) el.hidden = true; });
  ttEls.old.hidden = false;
}

function ttSetStatus(msg, bad) {
  ttEls.status.textContent = msg || '';
  ttEls.status.classList.toggle('is-bad', !!bad);
}

function tiktokIdOf(s) {
  const m = /\/video\/(\d{6,})|tiktok-(\d{6,})\.mp4/.exec(String(s || ''));
  return m ? (m[1] || m[2]) : null;
}
function inSlider(id) {
  return state.videos.some(v => tiktokIdOf(v.link) === id || tiktokIdOf(v.src) === id);
}

// TikTok-tekst → tittel: uten emneknagger, maks ca. 110 tegn
function cleanTitle(s) {
  let t = String(s || '').replace(/(^|\s)[#＃][^\s#＃]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/[\s,;:–-]+$/, '');
  if (t.length > 110) {
    const cut = t.slice(0, 110);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + ' …';
  }
  return t;
}

function ttMeta(it) {
  const date = it.timestamp ? new Date(it.timestamp * 1000).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' }) : '';
  const views = it.views ? it.views.toLocaleString('nb-NO') + ' visninger' : '';
  return [date, fmtDur(it.duration), views].filter(Boolean).join(' · ');
}

function renderTT() {
  ttEls.list.hidden = !tt.items.length;
  ttEls.add.hidden = !tt.items.length;
  ttEls.list.innerHTML = '';
  tt.items.forEach(it => {
    const row = document.createElement('label');
    row.className = 'vs-tt';
    row.title = it.description || it.title || '';
    row.innerHTML = `<input type="checkbox" data-id="${escapeHtml(it.id)}">`
      + (it.thumb ? `<img src="${escapeHtml(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="vs-tt__noimg"></span>')
      + `<span class="vs-tt__txt"><span class="vs-tt__title">${escapeHtml(cleanTitle(it.description || it.title) || 'Uten tekst')}</span>`
      + `<span class="vs-tt__meta">${escapeHtml(ttMeta(it))}</span></span>`;
    const img = row.querySelector('img');
    if (img) img.addEventListener('error', () => {
      const ph = document.createElement('span');
      ph.className = 'vs-tt__noimg';
      img.replaceWith(ph);
    });
    ttEls.list.appendChild(row);
  });
  markTT();
}

// Marker videoer som allerede er i slideren (uten å tegne lista på nytt)
function markTT() {
  if (!ttEls || !ttEls.list) return;
  ttEls.list.querySelectorAll('input[data-id]').forEach(cb => {
    const id = cb.dataset.id;
    const isIn = inSlider(id);
    if (isIn) tt.sel.delete(id);
    cb.disabled = isIn || tt.busy;
    cb.checked = tt.sel.has(id);
    cb.closest('.vs-tt').classList.toggle('is-in', isIn);
  });
  const n = tt.sel.size;
  ttEls.add.disabled = !n || tt.busy;
  ttEls.add.textContent = n ? `Legg til valgte (${n})` : 'Velg videoer over';
}

ttEls.list.addEventListener('change', e => {
  const cb = e.target.closest('input[data-id]');
  if (!cb) return;
  if (cb.checked) tt.sel.add(cb.dataset.id); else tt.sel.delete(cb.dataset.id);
  markTT();
});

function ttListen() {
  return window.faktisk.onTiktokProgress
    ? window.faktisk.onTiktokProgress(m => { if (m && m.label) ttSetStatus(tt.prefix + m.label); })
    : () => {};
}

function ttLock(on) {
  tt.busy = on;
  ttEls.fetch.disabled = on;
  ttEls.linksBtn.disabled = on;
  markTT();
}

ttEls.fetch.addEventListener('click', async () => {
  if (tt.busy || !ttSupported) return;
  ttLock(true);
  ttSetStatus('Henter de siste videoene …');
  const unsub = ttListen();
  try {
    const res = await window.faktisk.tiktokList({ profile: ttEls.profile.value, limit: 24 });
    if (!res || !res.ok) { ttSetStatus((res && res.error) || 'Fikk ikke hentet lista fra TikTok.', true); return; }
    tt.items = res.items || [];
    tt.sel.clear();
    renderTT();
    ttSetStatus(tt.items.length ? `${tt.items.length} videoer, nyeste først. Kryss av dem du vil ha i slideren.` : 'Fant ingen videoer på profilen.');
  } catch (err) {
    ttSetStatus('Feil: ' + err.message, true);
  } finally {
    unsub();
    ttLock(false);
  }
});

async function ttImport(jobs) {
  if (tt.busy || !jobs.length) return;
  const st = await window.faktisk.labradorListFiles().catch(() => null);
  if (!st || !st.loggedIn) {
    const c = await window.faktisk.labradorConnect();
    if (!c || !c.loggedIn) { ttSetStatus('Logg inn i Labrador først.', true); return; }
  }
  ttLock(true);
  const unsub = ttListen();
  let ok = 0, at = 0;
  const fails = [];
  tt.lastErr = '';
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      tt.prefix = jobs.length > 1 ? `Video ${i + 1} av ${jobs.length}: ` : '';
      ttSetStatus(tt.prefix + 'starter …');
      let res;
      try { res = await window.faktisk.tiktokImport({ url: job.url, meta: job.meta || null }); }
      catch (err) { res = { ok: false, error: err.message }; }
      if (!res || !res.ok) {
        fails.push((job.meta && cleanTitle(job.meta.description || job.meta.title)) || job.url);
        tt.lastErr = (res && res.error) || '';
        continue;
      }
      if (inSlider(res.id)) continue;   // kom inn via en annen lenke
      const v = newVideo({ src: res.url, title: cleanTitle(res.description || res.title), link: res.link || job.url, dur: fmtDur(res.duration),
        ts: Number(res.timestamp) || Number(job.meta && job.meta.timestamp) || 0 });
      state.videos.splice(Math.min(at, state.videos.length), 0, v);
      at++;
      ok++;
      renderVideos();
      scheduleUpdate();
      queue(() => (state.videos.includes(v) && !v.poster) ? makePoster(v, v.posterAt || 1, { quiet: true }) : false);
    }
  } finally {
    unsub();
    tt.prefix = '';
    ttLock(false);
  }
  if (ok) { sortNewestFirst(); renderVideos(); scheduleUpdate(); }
  if (fails.length) {
    ttSetStatus(`La til ${ok} av ${jobs.length}. Feilet: ${fails.join('; ')}${tt.lastErr ? ' – ' + tt.lastErr : ''}`, true);
  } else {
    ttSetStatus(`La til ${ok} ${ok === 1 ? 'video' : 'videoer'}, sortert med nyeste først. Stillbildene lages nå.`);
  }
}

ttEls.add.addEventListener('click', () => {
  const jobs = tt.items.filter(it => tt.sel.has(it.id) && !inSlider(it.id)).map(it => ({ url: it.url, meta: it }));
  ttImport(jobs);
});

ttEls.linksBtn.addEventListener('click', async () => {
  const urls = ttEls.links.value.split(/\s+/).map(s => s.trim()).filter(s => /^https?:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\//i.test(s));
  if (!urls.length) { ttSetStatus('Fant ingen TikTok-lenker. Lim inn én lenke per linje.', true); return; }
  const jobs = urls.filter(u => !inSlider(tiktokIdOf(u))).map(url => ({ url }));
  if (!jobs.length) { ttSetStatus('Alle videoene er allerede i slideren.'); return; }
  await ttImport(jobs);
  ttEls.links.value = '';
});

// ============================================================
//  Embed + forhåndsvisning (samme markup)
// ============================================================

function activeVideos() { return state.videos.filter(v => isValidUrl(v.src)); }

function embedData() {
  return {
    title: els.title.value.trim(),
    linkLabel: els.linkLabel.value.trim() || 'Se på TikTok',
    videos: activeVideos().map(v => {
      const o = { src: cleanUrl(v.src), title: v.title.trim(), dur: normDur(v.dur) };
      if (isValidUrl(v.poster)) o.poster = cleanUrl(v.poster);
      if (isValidUrl(v.start)) o.start = cleanUrl(v.start);
      if (isValidUrl(v.link)) o.link = v.link.trim();
      return o;
    }),
  };
}

function buildEmbedSnippet() {
  const id = 'fvs-' + Math.random().toString(36).slice(2, 8);
  const S = '.' + id;
  const data = embedData();
  const VV = data.videos;
  const kicker = els.kicker.value.trim();
  const title = data.title;
  const lede = els.lede.value.trim();
  const fText = els.followText.value.trim();
  const fUrl = els.followUrl.value.trim();
  const follow = fText && isValidUrl(fUrl)
    ? `<a class="fvs-follow" href="${escapeHtml(fUrl)}" target="_blank" rel="noopener">${escapeHtml(fText)}<span aria-hidden="true">↗</span></a>`
    : '';

  const css = `
${S}{container-type:inline-size;--fvs-ink:#212121;--fvs-line:#dcdcdc;--fvs-blue:#0050FC;--fvs-blue-hover:#0040D9}
${S} .fvs,${S} .fvs *,${S} .fvs-dlg,${S} .fvs-dlg *{box-sizing:border-box}
${S} .fvs{background:#fff;border:1px solid var(--fvs-line);border-radius:10px;overflow:hidden;padding:16px 0 18px;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif);color:var(--fvs-ink);text-align:left}
${S} .fvs-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 16px;padding:0 18px 14px}
${S} .fvs-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fvs-blue);margin:0;padding:0;line-height:1.3}
${S} .fvs-title{font-family:inherit;font-size:24px;font-weight:700;line-height:1.1;margin:4px 0 0;padding:0;color:var(--fvs-ink);letter-spacing:normal;text-transform:none}
${S} .fvs-lede{font-size:15px;line-height:1.4;color:#444;margin:6px 0 0;padding:0}
${S} .fvs-headside{display:flex;align-items:center;gap:12px}
${S} .fvs-follow{display:inline-flex;align-items:center;gap:6px;background:var(--fvs-blue);color:#fff;font-size:14px;font-weight:700;line-height:1;padding:10px 15px;border-radius:99px;text-decoration:none;white-space:nowrap}
${S} .fvs-follow:hover{background:var(--fvs-blue-hover);color:#fff;text-decoration:none}
${S} .fvs-nav{display:inline-flex;gap:6px;flex:none}
@media (pointer:coarse){${S} .fvs-arrow{width:40px;height:40px}}
${S} .fvs-arrow{all:unset;box-sizing:border-box;width:36px;height:36px;border-radius:50%;border:1px solid var(--fvs-line);background:#fff;color:var(--fvs-ink);display:grid;place-items:center;cursor:pointer}
${S} .fvs-arrow:hover:not(:disabled){border-color:var(--fvs-ink)}
${S} .fvs-arrow:disabled{opacity:.35;cursor:default}
${S} .fvs-arrow svg{width:20px;height:20px;display:block}
${S} .fvs-follow:focus-visible,${S} .fvs-arrow:focus-visible,${S} .fvs-card:focus-visible{outline:3px solid var(--fvs-blue);outline-offset:3px}
${S} .fvs-track{list-style:none;margin:0;padding:2px 18px 4px;display:grid;grid-auto-flow:column;grid-auto-columns:42%;gap:12px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scroll-padding-inline:18px;scrollbar-width:none}
${S} .fvs-track::-webkit-scrollbar{display:none}
${S} .fvs-item{margin:0;padding:0;min-width:0;list-style:none;scroll-snap-align:start}
${S} .fvs-item::before{content:none}
${S} .fvs-card{display:block;color:inherit;text-decoration:none;border-radius:8px}
${S} .fvs-thumb{position:relative;display:block;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#1a1a1a}
${S} .fvs-thumb img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;margin:0;transition:transform .3s ease}
${S} .fvs-card:hover .fvs-thumb img{transform:scale(1.03)}
${S} .fvs-thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(transparent 62%,rgba(0,0,0,.55));pointer-events:none}
${S} .fvs-play{position:absolute;left:10px;bottom:10px;z-index:1;width:36px;height:36px;border-radius:50%;background:var(--fvs-blue);color:#fff;display:grid;place-items:center;transition:transform .15s}
${S} .fvs-play svg{width:16px;height:16px;margin-left:2px;display:block}
${S} .fvs-card:hover .fvs-play{transform:scale(1.08)}
${S} .fvs-dur{position:absolute;right:9px;bottom:16px;z-index:1;color:#fff;font-size:12px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.6)}
${S} .fvs-ct{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px;font-size:15px;font-weight:500;line-height:1.25}
${S} .fvs-card:hover .fvs-ct{color:var(--fvs-blue)}
@container (min-width:480px){${S} .fvs-track{grid-auto-columns:29%}}
@container (min-width:720px){${S} .fvs-track{grid-auto-columns:196px}${S} .fvs-title{font-size:28px}}
${S} .fvs-dlg{position:fixed;inset:0;width:100%;height:100%;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#0b0b0b;color:#fff;overflow:hidden;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif)}
${S} .fvs-dlg:not([open]){display:none}
${S} .fvs-dlg::backdrop{background:#0b0b0b}
${S} .fvs-feed{height:100%;overflow-y:auto;overscroll-behavior:contain;scroll-snap-type:y mandatory;scrollbar-width:none;outline:0}
${S} .fvs-feed::-webkit-scrollbar{display:none}
${S} .fvs-slide{height:100%;display:grid;place-items:center;padding:16px 76px;scroll-snap-align:start;scroll-snap-stop:always}
${S} .fvs-frame{position:relative;height:100%;max-width:100%;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:#000}
${S} .fvs-poster,${S} .fvs-player video{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:contain;background:#000;display:block;margin:0}
${S} .fvs-player{position:absolute;inset:0;cursor:pointer}
${S} .fvs-state{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;display:none;place-items:center;z-index:3;pointer-events:none}
${S} .fvs-state svg{width:34px;height:34px;margin-left:4px;display:block}
${S} .fvs-player.is-paused .fvs-state{display:grid}
${S} .fvs-player.is-loading .fvs-state{display:none}
${S} .fvs-player video{background:transparent}
${S} .fvs-player video{transition:opacity .15s ease-out}
${S} .fvs-player.is-loading video{opacity:0;transition:none}
${S} .fvs-bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25);z-index:4;pointer-events:none}
${S} .fvs-bar i{display:block;height:100%;width:0;background:#fff}
${S} .fvs-err{display:none;position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);z-index:5;margin:0;padding:12px 14px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font-size:15px;line-height:1.4;text-align:center}
${S} .fvs-player.is-error .fvs-err{display:block}
${S} .fvs-player.is-error .fvs-state{display:none}
${S} .fvs-err a{color:#fff;font-weight:700}
${S} .fvs-info{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:56px 18px 22px;background:linear-gradient(transparent,rgba(0,0,0,.7));pointer-events:none}
${S} .fvs-vt{margin:0;font-size:17px;font-weight:700;line-height:1.3;color:#fff}
${S} .fvs-tt{pointer-events:auto;display:inline-block;margin-top:8px;color:#fff;font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px}
${S} .fvs-ui{position:absolute;inset:0;pointer-events:none;z-index:10}
${S} .fvs-count{position:absolute;left:18px;top:calc(16px + env(safe-area-inset-top,0px));margin:0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
${S} .fvs-top{position:absolute;right:14px;top:calc(12px + env(safe-area-inset-top,0px));display:flex;gap:8px}
${S} .fvs-side{position:absolute;right:14px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px}
${S} .fvs-btn{all:unset;box-sizing:border-box;pointer-events:auto;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;display:grid;place-items:center;cursor:pointer}
${S} .fvs-btn:hover:not(:disabled){background:rgba(255,255,255,.3)}
${S} .fvs-btn:disabled{opacity:.3;cursor:default}
${S} .fvs-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}
${S} .fvs-btn svg{width:24px;height:24px;display:block}
@media (max-width:600px){
  ${S} .fvs-slide{padding:0}
  ${S} .fvs-frame{width:100%;height:100%;aspect-ratio:auto;border-radius:0}
  ${S} .fvs-side{display:none}
  ${S} .fvs-btn{background:rgba(0,0,0,.35)}
  ${S} .fvs-info{padding-bottom:calc(28px + env(safe-area-inset-bottom,0px))}
}
@media (prefers-reduced-motion:reduce){
  ${S} .fvs-thumb img,${S} .fvs-play{transition:none}
  ${S} .fvs-card:hover .fvs-thumb img,${S} .fvs-card:hover .fvs-play{transform:none}
}`;

  const cards = VV.map((v, i) => {
    const href = v.link || v.src;
    const label = 'Spill av' + (v.title ? ': ' + v.title : ' video ' + (i + 1)) + (v.dur ? ' (' + v.dur + ')' : '');
    return `
    <li class="fvs-item"><a class="fvs-card" href="${escapeHtml(href)}" data-i="${i}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}">
      <span class="fvs-thumb">${v.poster ? `<img src="${escapeHtml(v.poster)}" alt="" width="360" height="640" loading="lazy" decoding="async">` : ''}<span class="fvs-play" aria-hidden="true">${PLAY_SVG}</span>${v.dur ? `<b class="fvs-dur">${escapeHtml(v.dur)}</b>` : ''}</span>${v.title ? `
      <span class="fvs-ct">${escapeHtml(v.title)}</span>` : ''}
    </a></li>`;
  }).join('');

  data.src = embedSource();   // for «Hent fra eksisterende embed» – runtime bruker det ikke
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const runtime = window.fvsRun ? window.fvsRun.toString() : '';
  const ver = PLUGIN_VERSION ? ' · v' + PLUGIN_VERSION : '';
  const headText = (kicker ? `<p class="fvs-kicker">${escapeHtml(kicker)}</p>` : '')
    + (title ? `<h2 class="fvs-title" id="${id}-t">${escapeHtml(title)}</h2>` : '')
    + (lede ? `<p class="fvs-lede">${escapeHtml(lede)}</p>` : '');

  return `<!-- FAKTISK · VIDEOSLIDER${ver} -->
<div class="fvs-wrap ${id}" id="${id}">
<style>${css}
</style>
<section class="fvs"${title ? ` aria-labelledby="${id}-t"` : ' aria-label="Videoer"'}>
  <div class="fvs-head">
    <div class="fvs-headtext">${headText}</div>
    <div class="fvs-headside">${follow}<span class="fvs-nav"><button type="button" class="fvs-arrow fvs-arrow--prev" aria-label="Bla til venstre" disabled>${LEFT_SVG}</button><button type="button" class="fvs-arrow fvs-arrow--next" aria-label="Bla til høyre">${RIGHT_SVG}</button></span></div>
  </div>
  <ul class="fvs-track" role="list">${cards}
  </ul>
</section>
<script type="application/json" class="fvs-data">${json}</script>
<script>(${runtime})(document.currentScript ? document.currentScript.parentNode : document.getElementById("${id}"));</script>
</div>
`;
}

function renderPreview() {
  const n = activeVideos().length;
  els.copyEmbed.disabled = n === 0;
  els.previewHost.style.maxWidth = els.previewWidth.value + 'px';
  // Det store vinduet er åpent i forhåndsvisningen: vent til det lukkes
  if (els.previewHost.querySelector('dialog[open]')) { scheduleUpdate(1000); return; }
  if (!n) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Hent videoer fra Labrador til venstre — forhåndsvisningen dukker opp her.</p>';
    return;
  }
  els.previewHost.innerHTML = buildEmbedSnippet();
  const root = els.previewHost.querySelector('.fvs-wrap');
  if (root && window.fvsRun) window.fvsRun(root, { preview: true });
}

let updateTimer = null;
function scheduleUpdate(delay) {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, typeof delay === 'number' ? delay : 250);
}

els.copyEmbed.addEventListener('click', async () => {
  const vids = activeVideos();
  if (!vids.length) return;
  const plural = n => n === 1 ? 'video' : 'videoer';
  const notLab = vids.filter(v => !isLabradorUrl(v.src)).length;
  const noPoster = vids.filter(v => !isLabradorUrl(v.poster)).length;
  const noTitle = vids.filter(v => !v.title.trim()).length;
  const warn = [];
  if (notLab) warn.push(`${notLab} ${plural(notLab)} ligger ikke i Labrador.`);
  if (noPoster) warn.push(`${noPoster} ${plural(noPoster)} mangler stillbilde i Labrador – kortet blir svart. Bruk «Lag alle stillbilder i Labrador».`);
  if (noTitle) warn.push(`${noTitle} ${plural(noTitle)} mangler tittel.`);
  const noStart = vids.filter(v => isLabradorUrl(v.poster) && !isLabradorUrl(v.start)).length;
  if (noStart) warn.push(`${noStart} ${plural(noStart)} mangler startbilde – det kan rykke når videoen starter i det store vinduet. Bruk «Lag alle stillbilder i Labrador».`);
  if (warn.length && !(await window.faktiskDialog.confirm(warn.join('\n\n') + '\n\nKopiere likevel?'))) return;
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet());
    const orig = 'Kopier embed';
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ============================================================
//  Lagring, prosjekter og «Hent fra eksisterende embed»
// ============================================================

let isRestoring = false;

// Alt som trengs for å gjenskape feltene, lagt i embedens data (src).
function embedSource() {
  return {
    v: 1, kicker: els.kicker.value, title: els.title.value, lede: els.lede.value,
    followText: els.followText.value, followUrl: els.followUrl.value, linkLabel: els.linkLabel.value,
    videos: activeVideos().map(v => ({ src: v.src, title: v.title, link: v.link, dur: v.dur, poster: v.poster, posterAt: v.posterAt, start: v.start, ts: v.ts })),
  };
}

function parseEmbed(code) {
  const doc = new DOMParser().parseFromString(String(code || ''), 'text/html');
  const dataEl = doc.querySelector('script.fvs-data');
  if (!dataEl) throw new Error('Fant ingen videoslider-embed. Lim inn hele koden fra Markup-boksen.');
  let D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { throw new Error('Klarte ikke å lese dataene i embeden.'); }
  if (D.src && typeof D.src === 'object') return D.src;
  return {
    title: D.title || '', linkLabel: D.linkLabel || '',
    videos: (D.videos || []).map(v => ({ src: v.src || '', title: v.title || '', link: v.link || '', dur: v.dur || '', poster: v.poster || '' })),
  };
}

function setImportStatus(msg, bad) {
  els.importStatus.textContent = msg || '';
  els.importStatus.classList.toggle('is-bad', !!bad);
}

els.importToggle.addEventListener('click', () => {
  const open = els.importPanel.style.display === 'none';
  els.importPanel.style.display = open ? '' : 'none';
  els.importToggle.setAttribute('aria-expanded', String(open));
  els.importToggle.textContent = 'Hent fra eksisterende embed ' + (open ? '▴' : '▾');
  if (open) els.importInput.focus();
});

els.importBtn.addEventListener('click', async () => {
  let s;
  try { s = parseEmbed(els.importInput.value); } catch (e) { setImportStatus(e.message, true); return; }
  if (activeVideos().length && !(await window.faktiskDialog.confirm('Erstatte det som står i feltene nå med innholdet fra embeden?'))) return;
  applyState(Object.assign({}, s, { previewWidth: els.previewWidth.value }));
  saveStateNow();
  els.importInput.value = '';
  const n = (s.videos || []).length;
  setImportStatus(`Hentet «${s.title || 'uten navn'}» med ${n} ${n === 1 ? 'video' : 'videoer'}.`);
});

function serializeState() {
  return {
    kicker: els.kicker.value, title: els.title.value, lede: els.lede.value,
    followText: els.followText.value, followUrl: els.followUrl.value, linkLabel: els.linkLabel.value,
    videos: state.videos.map(v => ({ key: v.key, src: v.src, title: v.title, link: v.link, dur: v.dur, poster: v.poster, posterAt: v.posterAt, start: v.start, ts: v.ts })),
    previewWidth: els.previewWidth.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    if (typeof s.kicker === 'string') els.kicker.value = s.kicker;
    if (typeof s.title === 'string') els.title.value = s.title;
    els.lede.value = s.lede || '';
    if (typeof s.followText === 'string') els.followText.value = s.followText;
    if (typeof s.followUrl === 'string') els.followUrl.value = s.followUrl;
    if (typeof s.linkLabel === 'string' && s.linkLabel) els.linkLabel.value = s.linkLabel;
    if (s.previewWidth) els.previewWidth.value = s.previewWidth;
    if (Array.isArray(s.videos)) state.videos = s.videos.map(v => newVideo(v));
    renderVideos();
    renderPreview();
  } finally {
    isRestoring = false;
  }
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.kicker, els.title, els.lede, els.followText, els.followUrl, els.linkLabel]
  .forEach(el => el.addEventListener('input', () => scheduleUpdate()));
els.previewWidth.addEventListener('change', () => scheduleUpdate());

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
  const defaultName = (els.title.value || '').slice(0, 40).trim() || `Videoslider ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) await refreshProjectList();
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) applyState(res.state);
});

(async function init() {
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) { applyState(res.state); els.projectSelect.value = fileId; return; }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) { applyState(res.state); return; }
  } catch (e) {}
  renderVideos();
  renderPreview();
})();
