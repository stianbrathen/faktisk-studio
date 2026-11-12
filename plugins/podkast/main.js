// Faktisk Studio · Podkast
//
// Spillerboks for videopodkast (YouTube) til forsiden og artikler på
// faktisk.no. Redaktøren limer inn YouTube-lenker, retter tekstene, legger
// forhåndsbildene i Labrador og kopierer embedden.
//
// Embedden:
// - er ferdig rendret HTML (vises også når skriptet sover i Labrador),
// - laster YouTube FØRST når leseren trykker play (youtube-nocookie.com),
// - lenker forhåndsbildene fra Labrador (aldri base64; YouTube-bildet brukes
//   bare som reserve, og da sier kopier-knappen fra),
// - er scopet til en unik id, så flere bokser kan stå på samme side,
// - sender målehendelser til dataLayer + «fkpod:track».
// Forhåndsvisningen ER embed-markupen; runtime.js (fpodRun) kjører med
// preview: true, så klikk på play ikke starter YouTube i Studio.
//
// Henting fra YouTube (tittel, bilde) skjer fra plugin-vinduet med fetch.
// Svarer YouTube uten CORS, faller vi tilbake til manuell utfylling og
// «Last opp…» — ingenting stopper opp.

const PLUGIN_ID = 'podkast';
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
  kicker: $('kickerInput'), title: $('titleInput'), credit: $('creditInput'),
  fetchInput: $('fetchInput'), fetchBtn: $('fetchBtn'), fetchStatus: $('fetchStatus'),
  epList: $('epList'), addEpBtn: $('addEpBtn'), allThumbsBtn: $('allThumbsBtn'),
  linkYoutube: $('linkYoutube'), linkSpotify: $('linkSpotify'), linkApple: $('linkApple'), linkAll: $('linkAll'),
  about: $('aboutInput'), cover: $('coverInput'), coverFiles: $('coverFilesBtn'),
  coverBig: $('coverBigInput'), coverBigFiles: $('coverBigFilesBtn'), coverBigUpload: $('coverBigUploadBtn'), coverBigPanel: $('coverBigPanel'),
  coverUpload: $('coverUploadBtn'), coverPanel: $('coverPanel'),
  loopBig: $('loopBigInput'), loopBigFiles: $('loopBigFilesBtn'), loopBigUpload: $('loopBigUploadBtn'), loopBigPanel: $('loopBigPanel'),
  loopSmall: $('loopSmallInput'), loopSmallFiles: $('loopSmallFilesBtn'), loopSmallUpload: $('loopSmallUploadBtn'), loopSmallPanel: $('loopSmallPanel'),
  visible: $('visibleSelect'), previewWidth: $('previewWidthSelect'),
  previewHost: $('previewHost'), copyEmbed: $('copyEmbedBtn'),
  back: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
  importToggle: $('importToggle'), importPanel: $('importPanel'), importInput: $('importInput'),
  importBtn: $('importBtn'), importStatus: $('importStatus'),
};

const state = {
  // { key, id, title, desc, date (ÅÅÅÅ-MM-DD), dur ("12:34"), no, thumb }
  episodes: [],
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; }
}

// YouTube-id fra alle vanlige lenkeformer, eller en ren 11-tegns id
function parseVideoId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return (u.pathname.slice(1).match(/^[\w-]{11}/) || [])[0] || null;
    if (/youtube(-nocookie)?\.com$/.test(host)) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}
// Mux: godtar lenke til player.mux.com / stream.mux.com / image.mux.com, hele
// embed-koden fra Mux (iframe eller <mux-player>), eller en ren avspillings-ID.
// Returnerer { id, title, time } eller null.
function parseMux(s) {
  s = String(s || '').trim().replace(/&amp;/g, '&');
  let id = null;
  const host = s.match(/(?:player|stream|image)\.mux\.com\/([A-Za-z0-9]{20,})/);
  if (host) id = host[1];
  if (!id) { const a = s.match(/playback-id\s*=\s*["']?([A-Za-z0-9]{20,})/); if (a) id = a[1]; }
  if (!id && /^[A-Za-z0-9]{20,}$/.test(s)) id = s;
  if (!id) return null;
  const pick = re => { const x = s.match(re); try { return x ? decodeURIComponent(x[1].replace(/\+/g, ' ')) : ''; } catch (e) { return x ? x[1] : ''; } };
  let title = pick(/(?:metadata-video-title|video-title)=["']?([^&"'>]+)/);
  if (/^(video|untitled)$/i.test(title)) title = '';
  const t = pick(/thumbnail\.(?:png|jpe?g|webp)\?[^"'\s>]*?time=([\d.]+)/);
  return { id, title, time: t ? +t : null };
}
function muxThumb(id, time, width) {
  return `https://image.mux.com/${id}/thumbnail.jpg?width=${width || 1280}` + (time != null ? `&time=${time}` : '');
}
// Lengden fra Mux sin HLS-strøm (summerer segmentene i første kvalitetsnivå).
// Kaster MuxIdError hvis ID-en er en Asset-ID eller videoen ikke er offentlig.
class MuxIdError extends Error {}
async function muxDuration(id) {
  let master;
  try {
    const mu = `https://stream.mux.com/${id}.m3u8`;
    const res = await fetch(mu);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (/asset id/i.test(txt)) throw new MuxIdError('Dette er en Asset-ID, ikke en avspillings-ID (Playback ID). I Mux: åpne videoen og kopier ID-en under «Playback IDs».');
      if (res.status === 403 || /signed|token/i.test(txt)) throw new MuxIdError('Videoen er ikke offentlig hos Mux (signert avspilling). Lag en offentlig Playback ID i Mux, ellers kan den ikke spilles på faktisk.no.');
      if (res.status === 400 || res.status === 404) throw new MuxIdError('Mux kjenner ikke denne avspillings-ID-en. Sjekk at hele ID-en er med.');
      return '';
    }
    master = await res.text();
  } catch (e) { if (e instanceof MuxIdError) throw e; return ''; }
  try {
    const mu = `https://stream.mux.com/${id}.m3u8`;
    const line = master.split('\n').find(l => l.trim() && !l.startsWith('#'));
    if (!line) return '';
    const media = await (await fetch(new URL(line.trim(), mu).href)).text();
    const sec = media.split('\n').filter(l => l.startsWith('#EXTINF:')).reduce((a, l) => a + parseFloat(l.slice(8)), 0);
    if (!sec) return '';
    const s = Math.round(sec), h = Math.floor(s / 3600), mi = Math.floor(s % 3600 / 60), se = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(mi).padStart(2, '0')}:${se}` : `${mi}:${se}`;
  } catch (e) { return ''; }
}
function isMuxEp(e) { return e && e.src === 'mux'; }
function isMuxThumb(u) { return /^https:\/\/image\.mux\.com\//.test(u || ''); }
function epWatchUrl(e) { return !e.id ? '' : isMuxEp(e) ? 'https://player.mux.com/' + e.id : 'https://youtu.be/' + e.id; }
function epMiniThumb(e) { return e.thumb || (isMuxEp(e) ? muxThumb(e.id, null, 320) : 'https://i.ytimg.com/vi/' + e.id + '/default.jpg'); }

// Fyller en episode fra Mux: id, tittel (fra embed-koden), bilde og lengde.
async function applyMux(ep, mx, swap) {
  let d = '';
  try { d = await muxDuration(mx.id); }
  catch (e) { await window.faktiskDialog.alert(e.message); return null; }
  ep.src = 'mux'; ep.id = mx.id;
  if (mx.title && (swap || !ep.title)) ep.title = mx.title;
  if (!ep.thumb || isMuxThumb(ep.thumb) || /ytimg\.com/.test(ep.thumb)) ep.thumb = muxThumb(mx.id, mx.time);
  if (d && (swap || !ep.dur)) ep.dur = d;
  return !!d;
}

function parsePlaylistId(s) {
  try { return new URL(String(s).trim()).searchParams.get('list'); } catch (e) { return null; }
}

function dateText(iso) {
  if (!iso) return '';
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso; }
}
function normDur(s) {
  const m = String(s || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  return m[1] ? `${+m[1]}:${m[2].padStart(2, '0')}:${m[3]}` : `${+m[2]}:${m[3]}`;
}
function isLabradorUrl(u) { return /faktisk\.no\//.test(u || ''); }

// ============================================================
//  Episoder i sidepanelet
// ============================================================

function newEp(o) {
  return Object.assign({ key: 'e_' + Math.random().toString(36).slice(2, 7), id: '', src: '', title: '', desc: '', date: '', dur: '', no: '', thumb: '' }, o || {});
}

function renderEpisodes() {
  els.epList.innerHTML = '';
  state.episodes.forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'hk-row';
    const thumbOk = e.thumb && isLabradorUrl(e.thumb);
    card.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${i + 1}</span>
        <input class="hk-row__title" value="${escapeHtml(e.title)}" data-k="${e.key}" data-act="title" placeholder="Tittel på episoden (valgfri)">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-k="${e.key}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn" data-act="down" data-k="${e.key}" title="Flytt ned" ${i === state.episodes.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-k="${e.key}" title="Fjern episoden">×</button>
        </span>
      </div>
      <input class="hk-row__img" value="${escapeHtml(epWatchUrl(e))}" data-k="${e.key}" data-act="url" placeholder="YouTube-lenke, eller Mux (lenke, ID eller embed-kode)" spellcheck="false" title="${isMuxEp(e) ? 'Spilles av fra Mux' : 'Spilles av fra YouTube'}">
      <div class="pod-meta">
        <input class="ftb-value pod-no" value="${escapeHtml(e.no)}" data-k="${e.key}" data-act="no" placeholder="Ep." title="Episodenummer">
        <input class="ftb-value pod-date" type="date" value="${escapeHtml(e.date)}" data-k="${e.key}" data-act="date" title="Publiseringsdato">
        <input class="ftb-value pod-dur" value="${escapeHtml(e.dur)}" data-k="${e.key}" data-act="dur" placeholder="mm:ss" title="Varighet (vises på bildet)">
      </div>
      <textarea class="caption-input pod-desc" rows="2" data-k="${e.key}" data-act="desc" placeholder="Kort beskrivelse (valgfri)">${escapeHtml(e.desc)}</textarea>
      <div class="pod-thumbrow">
        ${e.id ? `<img class="pod-thumbmini" src="${escapeHtml(epMiniThumb(e))}" alt="">` : ''}
        <span class="pod-thumbstate ${thumbOk || isMuxThumb(e.thumb) ? 'is-ok' : ''}">${thumbOk ? 'Bilde i Labrador ✓' : isMuxEp(e) ? 'Bilde fra Mux ✓' : 'Bildet hentes fra YouTube'}</span>
      </div>
      <input class="hk-row__img" value="${escapeHtml(e.thumb)}" data-k="${e.key}" data-act="thumb" placeholder="Forhåndsbilde-URL fra Labrador (16:9)" spellcheck="false">
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="ytthumb" data-k="${e.key}" ${e.id ? '' : 'disabled'}>${isMuxEp(e) ? 'Mux-bildet' : 'YouTube-bildet'} → Labrador</button>
        <button class="ftb-labbtn" type="button" data-act="files" data-k="${e.key}">Mine filer ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-k="${e.key}">Last opp…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${e.key}" style="display:none;"></div>`;
    els.epList.appendChild(card);
  });
}

els.epList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, k } = btn.dataset;
  const i = state.episodes.findIndex(x => x.key === k);
  if (i < 0) return;
  if (act === 'del') { state.episodes.splice(i, 1); renderEpisodes(); scheduleUpdate(); }
  if (act === 'up' || act === 'down') {
    const j = i + (act === 'up' ? -1 : 1);
    if (j < 0 || j >= state.episodes.length) return;
    const [x] = state.episodes.splice(i, 1);
    state.episodes.splice(j, 0, x);
    renderEpisodes(); scheduleUpdate();
  }
  if (act === 'files') toggleFilePanel(k);
  if (act === 'upload') uploadThumb(k, btn);
  if (act === 'ytthumb') ytThumbToLabrador(k, btn);
});

els.epList.addEventListener('input', e => {
  const { act, k } = e.target.dataset;
  const ep = state.episodes.find(x => x.key === k);
  if (!ep || !act) return;
  const v = e.target.value;
  if (act === 'title') ep.title = v;
  if (act === 'desc') ep.desc = v;
  if (act === 'no') ep.no = v.trim();
  if (act === 'date') ep.date = v;
  if (act === 'dur') ep.dur = v.trim();
  if (act === 'thumb') ep.thumb = v.trim();
  if (act === 'url') {
    const id = parseVideoId(v);
    const mx = id ? null : parseMux(v);
    if (id && (id !== ep.id || isMuxEp(ep))) {
      const swap = !!ep.id; ep.id = id; ep.src = '';
      if (isMuxThumb(ep.thumb)) ep.thumb = '';
      fillFromOEmbed(ep, swap).then(() => { renderEpisodes(); scheduleUpdate(); });
    } else if (mx && (mx.id !== ep.id || !isMuxEp(ep))) {
      const swap = !!ep.id;
      applyMux(ep, mx, swap).then(() => { renderEpisodes(); scheduleUpdate(); });
    }
  }
  scheduleUpdate();
});
// Oppdater bildestatus/miniatyr når feltet forlates (ikke for hvert tegn)
els.epList.addEventListener('change', e => {
  if (['thumb', 'url'].includes(e.target.dataset.act)) renderEpisodes();
});

els.addEpBtn.addEventListener('click', () => {
  state.episodes.push(newEp());
  renderEpisodes();
  scheduleUpdate();
  const inputs = els.epList.querySelectorAll('[data-act="url"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

// ============================================================
//  Henting fra YouTube
// ============================================================

function setFetchStatus(msg, bad) {
  els.fetchStatus.textContent = msg || '';
  els.fetchStatus.classList.toggle('is-bad', !!bad);
}

async function fillFromOEmbed(ep, force) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + ep.id));
    if (!r.ok) return false;
    const j = await r.json();
    if (j.title && (force || !ep.title)) ep.title = j.title;
    return true;
  } catch (e) { return false; }
}

// Spilleliste via YouTubes åpne RSS (15 nyeste). Krever at YouTube svarer
// med CORS — gjør den ikke det, må lenkene limes inn én og én.
async function fetchPlaylist(listId) {
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(listId));
  if (!r.ok) throw new Error('YouTube svarte ' + r.status);
  const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
  const NS_YT = 'http://www.youtube.com/xml/schemas/2015';
  const NS_MEDIA = 'http://search.yahoo.com/mrss/';
  return Array.from(xml.getElementsByTagName('entry')).map(en => {
    const id = (en.getElementsByTagNameNS(NS_YT, 'videoId')[0] || {}).textContent || '';
    const title = (en.getElementsByTagName('title')[0] || {}).textContent || '';
    const pub = ((en.getElementsByTagName('published')[0] || {}).textContent || '').slice(0, 10);
    const desc = (en.getElementsByTagNameNS(NS_MEDIA, 'description')[0] || {}).textContent || '';
    return { id, title, date: pub, desc: desc.split('\n')[0].slice(0, 300) };
  }).filter(x => /^[\w-]{11}$/.test(x.id));
}

els.fetchBtn.addEventListener('click', async () => {
  const raw = els.fetchInput.value.trim();
  if (!raw) return;
  els.fetchBtn.disabled = true;
  try {
    const listId = parsePlaylistId(raw);
    const lines = raw.split(/\s+/).filter(Boolean);
    const ids = lines.map(parseVideoId).filter(Boolean);
    const muxes = /<iframe|<mux-player/i.test(raw) ? [parseMux(raw)].filter(Boolean)
      : lines.filter(l => !parseVideoId(l)).map(parseMux).filter(Boolean);
    if (muxes.length && !ids.length) {
      setFetchStatus('Henter fra Mux…');
      const have = new Set(state.episodes.map(e => e.id));
      let added = 0, durOk = 0;
      for (const mx of muxes) {
        if (have.has(mx.id)) continue;
        const ep = newEp();
        const ok = await applyMux(ep, mx, false);
        if (ok === null) continue;  // ugyldig ID – meldingen er vist
        if (ok) durOk++;
        state.episodes.push(ep); added++;
      }
      setFetchStatus(added === 0 ? 'Episodene finnes allerede i lista.'
        : `La til ${added} episode${added > 1 ? 'r' : ''} fra Mux.` + (durOk < added ? ' Fikk ikke hentet lengden – skriv den inn selv.' : '')
          , durOk < added);
    } else if (listId && !parseVideoId(raw)) {
      setFetchStatus('Henter spillelista…');
      let items;
      try { items = await fetchPlaylist(listId); }
      catch (err) {
        setFetchStatus('Fikk ikke hentet spillelista fra Studio (' + err.message + '). Lim inn lenkene til episodene i stedet, én per linje.', true);
        return;
      }
      if (!items.length) { setFetchStatus('Fant ingen videoer i spillelista.', true); return; }
      const have = new Set(state.episodes.map(e => e.id));
      let added = 0;
      items.forEach(it => { if (!have.has(it.id)) { state.episodes.push(newEp(it)); added++; } });
      setFetchStatus(`La til ${added} episoder (nyeste først). Fyll inn episodenummer og varighet.`);
    } else if (ids.length) {
      setFetchStatus('Henter titler…');
      const have = new Set(state.episodes.map(e => e.id));
      let ok = 0, added = 0;
      for (const id of ids) {
        if (have.has(id)) continue;
        const ep = newEp({ id });
        if (await fillFromOEmbed(ep)) ok++;
        state.episodes.push(ep); added++;
      }
      setFetchStatus(added === 0 ? 'Episodene finnes allerede i lista.'
        : ok === added ? `La til ${added} episode${added > 1 ? 'r' : ''}.`
          : `La til ${added} episode${added > 1 ? 'r' : ''}, men fikk ikke hentet tittelen – skriv den inn selv.`, ok < added);
    } else {
      setFetchStatus('Fant ingen YouTube- eller Mux-lenke. Lim inn en lenke, en Mux-ID eller embed-koden fra Mux.', true);
      return;
    }
    els.fetchInput.value = '';
    renderEpisodes();
    scheduleUpdate();
  } finally {
    els.fetchBtn.disabled = false;
  }
});

// ============================================================
//  Forhåndsbilder i Labrador
// ============================================================

function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

async function ensureLoggedIn() {
  const st = await window.faktisk.labradorListFiles();
  if (st.loggedIn) return st;
  const c = await window.faktisk.labradorConnect();
  if (!c.loggedIn) return null;
  return window.faktisk.labradorListFiles();
}

// Henter YouTubes forhåndsbilde og legger det i Labrador med fast navn
// (youtube-<id>.jpg), så et nytt klikk gjenbruker fila.
async function ytThumbToLabrador(k, btn, quiet) {
  const ep = state.episodes.find(x => x.key === k);
  if (!ep || !ep.id) return false;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Henter…'; }
  try {
    const fileName = (isMuxEp(ep) ? 'mux-' : 'youtube-') + ep.id + '.jpg';
    const list = await ensureLoggedIn();
    if (!list) { if (!quiet) await window.faktiskDialog.alert('Fikk ikke gyldig innlogging i Labrador.'); return false; }
    const existing = (list.files || []).find(f => f.name === fileName);
    if (existing) { ep.thumb = existing.url; return true; }

    let blob = null;
    const srcs = isMuxEp(ep) ? [isMuxThumb(ep.thumb) ? ep.thumb : muxThumb(ep.id)]
      : ['maxresdefault', 'sddefault', 'hqdefault'].map(size => `https://i.ytimg.com/vi/${ep.id}/${size}.jpg`);
    for (const src of srcs) {
      try {
        const r = await fetch(src);
        if (r.ok) { const b = await r.blob(); if (b.size > 3000) { blob = b; break; } }
      } catch (e) { /* CORS eller nett – prøv neste / gi opp under */ }
    }
    if (!blob) {
      if (!quiet) await window.faktiskDialog.alert(isMuxEp(ep)
        ? 'Studio fikk ikke hentet bildet fra Mux. Bildet fra Mux kan brukes som det er, eller last opp et eget med «Last opp…».'
        : 'Studio fikk ikke hentet bildet fra YouTube. Lagre forhåndsbildet fra YouTube Studio og bruk «Last opp…».');
      return false;
    }
    const res = await window.faktisk.labradorUploadData({ fileName, dataUrl: await blobToDataUrl(blob) });
    if (!res.ok || !res.url) {
      if (!quiet) await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'fant ikke URL — sjekk «Mine filer»'));
      return false;
    }
    ep.thumb = res.url;
    return true;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
    renderEpisodes();
    scheduleUpdate();
  }
}

els.allThumbsBtn.addEventListener('click', async () => {
  const todo = state.episodes.filter(e => e.id && !isLabradorUrl(e.thumb) && !isMuxEp(e));
  if (!todo.length) { await window.faktiskDialog.alert('Alle episodene har allerede bilde i Labrador.'); return; }
  els.allThumbsBtn.disabled = true;
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    els.allThumbsBtn.textContent = `Laster opp ${i + 1} av ${todo.length}…`;
    if (await ytThumbToLabrador(todo[i].key, null, true)) ok++;
  }
  els.allThumbsBtn.disabled = false;
  els.allThumbsBtn.textContent = 'Alle bilder til Labrador';
  if (ok < todo.length) {
    await window.faktiskDialog.alert(`${ok} av ${todo.length} bilder ble lagt i Labrador. De andre må lastes opp med «Last opp…».`);
  }
});

const IMG_EXT = /\.(png|jpe?g|gif|avif|webp)(\?|$)/i;
const VID_EXT = /\.(mp4|m4v|mov|webm)(\?|$)/i;

function toggleFilePanel(k) {
  const panel = els.epList.querySelector(`[data-panel="${k}"]`);
  openFilePanel(panel, url => {
    const ep = state.episodes.find(x => x.key === k);
    if (ep) { ep.thumb = url; renderEpisodes(); scheduleUpdate(); }
  });
}

// Felles «Mine filer»-panel (bilder i Labrador) — brukes per episode og for coveret
async function openFilePanel(panel, onPick, ext, noun) {
  ext = ext || IMG_EXT; noun = noun || 'bilder';
  if (!panel) return;
  const open = panel.style.display !== 'none';
  document.querySelectorAll('.ftb-labpanel').forEach(p => { p.style.display = 'none'; });
  if (open) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) { panel.style.display = 'none'; openFilePanel(panel, onPick, ext, noun); }
      else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => ext.test(f.url)).slice(0, 60);
  if (!matching.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen ' + noun + ' lastet opp ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">' + matching.length + ' ' + noun + ' (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ftb-labfile';
    item.textContent = f.name;
    item.title = f.url;
    item.addEventListener('click', () => { panel.style.display = 'none'; onPick(f.url); });
    list.appendChild(item);
  });
}

function uploadThumb(k, btn) {
  return uploadImage(btn, url => {
    const ep = state.episodes.find(x => x.key === k);
    if (ep) { ep.thumb = url; renderEpisodes(); scheduleUpdate(); }
  });
}

async function uploadImage(btn, onUrl, filters) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; })
    : () => {};
  try {
    const res = await window.faktisk.labradorUpload({ filters: filters || [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }] });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) onUrl(res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally {
    unsub();
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// Cover og tekst om podkasten
els.coverFiles.addEventListener('click', () => openFilePanel(els.coverPanel, url => { els.cover.value = url; scheduleUpdate(); }));
els.coverUpload.addEventListener('click', () => uploadImage(els.coverUpload, url => { els.cover.value = url; scheduleUpdate(); }));
els.coverBigFiles.addEventListener('click', () => openFilePanel(els.coverBigPanel, url => { els.coverBig.value = url; scheduleUpdate(); }));
els.coverBigUpload.addEventListener('click', () => uploadImage(els.coverBigUpload, url => { els.coverBig.value = url; scheduleUpdate(); }));

// Løkke før avspilling (mp4 i Labrador)
const VID_FILTER = [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov'] }];
[['loopBig', 'loopBigFiles', 'loopBigUpload', 'loopBigPanel'], ['loopSmall', 'loopSmallFiles', 'loopSmallUpload', 'loopSmallPanel']].forEach(([f, files, up, panel]) => {
  els[files].addEventListener('click', () => openFilePanel(els[panel], url => { els[f].value = url; scheduleUpdate(); }, VID_EXT, 'videoer'));
  els[up].addEventListener('click', () => uploadImage(els[up], url => { els[f].value = url; scheduleUpdate(); }, VID_FILTER));
});
function loopData() {
  const u = el => { const v = el.value.trim(); return isValidUrl(v) ? encodeURI(decodeURI(v)) : ''; };
  const big = u(els.loopBig), small = u(els.loopSmall);
  return big || small ? Object.assign({}, big ? { big } : {}, small ? { small } : {}) : null;
}

// ============================================================
//  Embed + forhåndsvisning (samme markup)
// ============================================================

function activeEpisodes() { return state.episodes.filter(e => e.id); }

function embedData() {
  return {
    title: els.title.value.trim(),
    episodes: activeEpisodes().map(e => {
      const meta = [e.no ? 'Episode ' + e.no : '', dateText(e.date)].filter(Boolean).join(' · ');
      const o = { id: e.id, no: e.no || '', title: e.title.trim(), desc: e.desc.trim(), meta, dur: normDur(e.dur) };
      if (isMuxEp(e)) o.src = 'mux';
      if (e.thumb && isValidUrl(e.thumb)) o.thumb = encodeURI(decodeURI(e.thumb));
      return o;
    }),
    ...(loopData() ? { loop: loopData() } : {}),
  };
}

function buildEmbedSnippet() {
  const id = 'fpod-' + Math.random().toString(36).slice(2, 8);
  const S = '.' + id;
  const data = embedData();
  const EP = data.episodes;
  const kicker = els.kicker.value.trim();
  const title = data.title || 'Podkast';
  const credit = els.credit.value.trim();
  const visible = Math.max(1, parseInt(els.visible.value, 10) || 3);
  const L = {
    youtube: els.linkYoutube.value.trim(), spotify: els.linkSpotify.value.trim(),
    apple: els.linkApple.value.trim(), all: els.linkAll.value.trim(),
  };
  const pill = (href, txt) => isValidUrl(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${txt}</a>` : '';
  const allHref = (EP.length > 1 && isValidUrl(L.all)) ? L.all : '';  // bare ved flere episoder, ingen reserve
  const thumb = e => e.thumb || (e.src === 'mux' ? muxThumb(e.id) : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`);
  const e0 = EP[0];
  const cover = isValidUrl(els.cover.value.trim()) ? encodeURI(decodeURI(els.cover.value.trim())) : '';
  const coverBig = isValidUrl(els.coverBig.value.trim()) ? encodeURI(decodeURI(els.coverBig.value.trim())) : '';
  const aboutParas = els.about.value.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean);
  const hasAbout = !!(cover || aboutParas.length);
  const hasList = EP.length > 1;
  const aboutHtml = hasAbout ? `
      <div class="fpod-about${cover ? '' : ' fpod-about--nocover'}">${cover ? `<button type="button" class="fpod-coverbtn" aria-label="Vis coveret stort"${coverBig ? ` data-full="${escapeHtml(coverBig)}"` : ''}><img class="fpod-cover" src="${escapeHtml(cover)}" alt="Cover: ${escapeHtml(title)}"></button>` : ''}
        <div class="fpod-abouttext">${aboutParas.map(t => `<p>${escapeHtml(t).replace(/\n/g, '<br>')}</p>`).join('')}</div>
      </div>` : '';

  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss(id) : '';
  const css = `${baseCss}
${S}{container-type:inline-size;--fpod-line:#dcdcdc;--fpod-grey:#f2f2f2;--fpod-blue:#0050FC;--fpod-ink:#212121}
${S} .fpod,${S} .fpod *{box-sizing:border-box}
${S} .fpod{background:#fff;border:1px solid var(--fpod-line);border-radius:10px;overflow:hidden;font-family:var(--fk-font,"Unica77","Helvetica Neue",Helvetica,Arial,sans-serif);font-weight:300;font-synthesis:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;color:var(--fpod-ink);text-align:left}
${S} .fpod-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px 0}
${S} .fpod-kicker{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--fpod-blue);margin:0}
${S} .fpod-series{font-family:inherit;font-size:24px;font-weight:500;line-height:1.1;margin:4px 0 0;padding:0;color:var(--fpod-ink);letter-spacing:normal;text-transform:none}
${S} .fpod-credit{font-size:13px;color:#666;margin:4px 0 0}
${S} .fpod-links{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
${S} .fpod-links a{font-size:12px;line-height:1.4;border:1px solid var(--fpod-line);border-radius:99px;padding:4px 10px;color:var(--fpod-ink);text-decoration:none;white-space:nowrap}
${S} .fpod-links a:hover{border-color:var(--fpod-ink)}
${S} .fpod-main{padding:16px 18px;position:relative}
${S} .fpod-stage{position:relative;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden}
${S} .fpod-stage iframe,${S} .fpod-stage>div,${S} .fpod-stage mux-player{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;--media-object-fit:contain}
${S} .fpod-facade{all:unset;position:absolute;inset:0;cursor:pointer;display:block}
${S} .fpod-facade img{width:100%;height:100%;object-fit:cover;display:block;margin:0}
${S} .fpod-loop{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;margin:0;opacity:0;transition:opacity .4s;pointer-events:none;background:transparent}
${S} .fpod-loop.is-on{opacity:1}
${S} .fpod-bigplay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:72px;height:72px;border-radius:50%;background:var(--fpod-blue);color:#fff;display:grid;place-items:center;z-index:1;transition:transform .15s}
${S} .fpod-bigplay svg{width:30px;height:30px;margin-left:4px}
${S} .fpod-facade:hover .fpod-bigplay{transform:translate(-50%,-50%) scale(1.06)}
${S} .fpod-facade:focus-visible{outline:3px solid var(--fpod-blue);outline-offset:-3px}
${S} .fpod-meta{margin:0 auto 0 0;display:flex;align-items:center;gap:8px;font-size:13px;line-height:1.3;color:#6b6b6b}
${S} .fpod-dur{font-weight:500;color:var(--fpod-ink)}
${S} .fpod-dur::before{content:"·";font-weight:300;color:#6b6b6b;margin-right:8px}
${S}.fpod-isbig .fpod-meta{display:none}
${S} .fpod-meta--mux .fpod-yt{display:none}
${S} .fpod-meta--mux .fpod-dur::before{content:none;margin:0}
${S} .fpod-prevnote{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:2;background:#fff;color:var(--fpod-ink);font-size:13px;font-weight:500;padding:6px 10px;border-radius:6px;white-space:nowrap}
${S} .fpod-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 18px;margin-top:8px}
${S} .fpod-pop{all:unset;cursor:pointer;font-family:inherit;font-size:13px;font-weight:500;color:var(--fpod-ink);line-height:1.3}
${S} .fpod-pop:hover{color:var(--fpod-blue)}
${S} .fpod-pop:focus-visible{outline:2px solid var(--fpod-blue);outline-offset:2px}
${S}.fpod-isbig .fpod-pop{display:none}
${S} .fpod-big{all:unset;cursor:pointer;font-family:inherit;font-size:13px;font-weight:500;color:var(--fpod-ink);line-height:1.3}
${S} .fpod-big:hover{color:var(--fpod-blue)}
${S} .fpod-big:focus-visible{outline:2px solid var(--fpod-blue);outline-offset:2px}
@media (pointer:coarse){${S} .fpod-pop,${S} .fpod-big{display:none}}
${S}.fpod-isbig .fpod-stage{position:fixed;inset:0;z-index:2147483000;border-radius:0;aspect-ratio:auto;width:auto;height:auto;margin:0}
${S}.fpod-isbig .fpod-big{position:fixed;top:14px;right:16px;z-index:2147483001;background:#fff;color:#212121;padding:8px 14px;border-radius:99px;box-shadow:0 2px 12px rgba(0,0,0,.45)}
${S} .fpod-epno{font-size:13px;color:#666;margin:4px 0 0}
${S} .fpod-epno:empty{display:none}
${S} .fpod-epno:empty + .fpod-title{margin-top:12px}
${S} .fpod-title:empty{display:none}
${S} .fpod-desc:empty{display:none}
${S} .fpod-title{font-family:inherit;font-size:20px;font-weight:500;line-height:1.2;margin:2px 0 6px;padding:0;color:var(--fpod-ink);letter-spacing:normal;text-transform:none}
${S} .fpod-desc{font-size:14px;line-height:1.4;color:#444;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
${S} .fpod-err{font-size:14px;margin:8px 0 0}
${S} .fpod-err a{color:var(--fpod-blue)}
${S} .fpod-list{list-style:none;margin:0;padding:0 18px;border-top:1px solid var(--fpod-line)}
${S} .fpod-list li{border-bottom:1px solid var(--fpod-line);margin:0;padding:0}
${S} .fpod-list li::before{content:none}
${S} .fpod-list li:last-child{border-bottom:0}
${S} .fpod-item{all:unset;box-sizing:border-box;width:100%;display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center;padding:10px 0;cursor:pointer;font-family:inherit;color:var(--fpod-ink)}
${S} .fpod-item:focus-visible{outline:2px solid var(--fpod-blue);outline-offset:2px}
${S} .fpod-th{position:relative;aspect-ratio:16/9;border-radius:4px;overflow:hidden;background:var(--fpod-grey);display:block}
${S} .fpod-th img{width:100%;height:100%;object-fit:cover;display:block;margin:0}
${S} .fpod-th b{font-weight:500;position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.75);color:#fff;font-size:11px;padding:1px 4px;border-radius:3px;font-weight:500}
${S} .fpod-it{font-size:15px;font-weight:500;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
${S} .fpod-im{display:block;font-size:12px;color:#888;margin-top:3px}
${S} .fpod-item:hover .fpod-it{color:var(--fpod-blue)}
${S} .fpod-item[aria-current=true] .fpod-it{color:var(--fpod-blue);font-weight:500}
${S} .fpod-item[aria-current=true] .fpod-im::before{content:"▶ Valgt · ";color:var(--fpod-blue);font-weight:500}
${S} .fpod-more{all:unset;display:block;margin:0 18px 12px;font-size:14px;font-weight:500;cursor:pointer;color:var(--fpod-ink);font-family:inherit}
${S} .fpod-more:hover{color:var(--fpod-blue)}
${S} .fpod-about{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:start;padding:16px 18px;border-top:1px solid var(--fpod-line)}
${S} .fpod-about--nocover{grid-template-columns:1fr}
${S} .fpod-coverbtn{all:unset;display:block;cursor:zoom-in;border-radius:6px;width:100%}
${S} .fpod-coverbtn:focus-visible{outline:2px solid var(--fpod-blue);outline-offset:2px}
${S} .fpod-cover{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;display:block;margin:0;background:var(--fpod-grey);transition:transform .15s}
${S} .fpod-coverbtn:hover .fpod-cover{transform:scale(1.02)}
${S} .fpod-abouttext p{font-size:15px;line-height:1.45;color:#333;margin:0 0 8px}
${S} .fpod-abouttext p:last-child{margin-bottom:0}
${S} .fpod-about + .fpod-list{border-top:1px solid var(--fpod-line)}
${S} .fpod-foot{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:12px 18px;background:var(--fpod-grey);font-size:13px;color:#666}
${S} .fpod-foot a{color:var(--fpod-ink);font-weight:500;text-decoration:none;font-size:14px}
${S} .fpod-foot a:hover{text-decoration:underline}
@container (min-width:640px){
  ${S} .fpod-body{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)}
  ${S} .fpod-body--solo{display:block}
  ${S} .fpod-side{border-left:1px solid var(--fpod-line);min-height:0}
  ${S} .fpod-about{display:block;border-top:0;padding:16px 18px}
  ${S} .fpod-coverbtn{max-width:220px;margin-bottom:14px}
  ${S} .fpod-list{border-top:0;padding:6px 18px;overflow:auto;max-height:520px}
  ${S} .fpod-more{display:none}
}
@container (max-width:639px){
  ${S} .fpod-head{display:block}
  ${S} .fpod-links{justify-content:flex-start;margin-top:10px}
  ${S} .fpod-links:empty{display:none}
  ${S} .fpod-links a{font-size:13px;padding:7px 14px}
  ${S} .fpod-series{font-size:20px}
  ${S} .fpod-title{font-size:18px}
  ${S} .fpod-item{grid-template-columns:80px 1fr}
  ${S} .fpod-list li.fpod-hide{display:none}
  ${S} .fpod-list.open li.fpod-hide{display:block}
}`;

  const items = EP.map((e, i) => `
      <li${i >= visible ? ' class="fpod-hide"' : ''}><button type="button" class="fpod-item" data-i="${i}" aria-current="${i === 0}">
        <span class="fpod-th"><img src="${escapeHtml(thumb(e))}" alt="" loading="lazy">${e.dur ? `<b>${escapeHtml(e.dur)}</b>` : ''}</span>
        <span><span class="fpod-it">${escapeHtml(e.title)}</span><span class="fpod-im">${escapeHtml(e.meta)}</span></span>
      </button></li>`).join('');

  data.src = embedSource();  // for «Hent fra eksisterende embed» – runtime bruker det ikke
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const runtime = window.fpodRun ? window.fpodRun.toString() : '';
  const ver = PLUGIN_VERSION ? ' · v' + PLUGIN_VERSION : '';

  return `<!-- FAKTISK · PODKAST${ver} -->
<div class="fpod-wrap ${id}" id="${id}">
<style>${css}
</style>
<section class="fpod" aria-label="Podkast: ${escapeHtml(title)}">
  <div class="fpod-head"><div>
    ${kicker ? `<p class="fpod-kicker">${escapeHtml(kicker)}</p>` : ''}
    <h2 class="fpod-series">${escapeHtml(title)}</h2>
    ${credit ? `<p class="fpod-credit">${escapeHtml(credit)}</p>` : ''}
  </div><div class="fpod-links">${pill(L.youtube, 'YouTube')}${pill(L.spotify, 'Spotify')}${pill(L.apple, 'Apple Podcasts')}</div></div>
  <div class="fpod-body${hasAbout || hasList ? '' : ' fpod-body--solo'}">
    <div class="fpod-main">
      <div class="fpod-stage"><button type="button" class="fpod-facade" aria-label="Spill av: ${escapeHtml(e0.title || title)}"><img src="${escapeHtml(thumb(e0))}" alt=""><span class="fpod-bigplay"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg></span></button></div>
      <div class="fpod-tools"><p class="fpod-meta${e0.src === 'mux' ? ' fpod-meta--mux' : ''}"><span class="fpod-yt">Spilles av via YouTube</span><span class="fpod-dur"${e0.dur ? '' : ' style="display:none"'}>${escapeHtml(e0.dur)}</span></p><button type="button" class="fpod-pop" aria-label="Spill av videoen i et eget lite vindu">⧉ Eget vindu</button><button type="button" class="fpod-big" aria-label="Vis videoen i hele nettleservinduet">⤢ Stor visning</button></div>
      <p class="fpod-epno">${escapeHtml(e0.meta)}</p>
      <h3 class="fpod-title">${escapeHtml(e0.title)}</h3>
      <p class="fpod-desc">${escapeHtml(e0.desc)}</p>
    </div>
    ${hasAbout || hasList ? `<div class="fpod-side">${aboutHtml}${hasList ? `<ul class="fpod-list">${items}
    </ul>${EP.length > visible ? `<button type="button" class="fpod-more" data-all="Vis alle ${EP.length} episoder">Vis alle ${EP.length} episoder</button>` : ''}` : ''}</div>` : ''}
  </div>
  ${allHref ? `<div class="fpod-foot"><a href="${escapeHtml(allHref)}" target="_blank" rel="noopener">Alle episoder →</a></div>` : ''}
</section>
<script type="application/json" class="fpod-data">${json}</script>
<script>(${runtime})(document.currentScript ? document.currentScript.parentNode : document.getElementById("${id}"));</script>
</div>
`;
}

function renderPreview() {
  const n = activeEpisodes().length;
  els.copyEmbed.disabled = n === 0;
  els.previewHost.style.maxWidth = els.previewWidth.value + 'px';
  if (!n) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Lim inn en YouTube-lenke til venstre — forhåndsvisningen dukker opp her.</p>';
    return;
  }
  els.previewHost.innerHTML = buildEmbedSnippet();
  const root = els.previewHost.querySelector('.fpod-wrap');
  if (root && window.fpodRun) window.fpodRun(root, { preview: true });
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, 250);
}

els.copyEmbed.addEventListener('click', async () => {
  const eps = activeEpisodes();
  if (!eps.length) return;
  // Én episode: tittelen er valgfri (linja skjules). Flere episoder: trengs i episodelista.
  const noTitle = eps.length > 1 ? eps.filter(e => !e.title.trim()).length : 0;
  if (noTitle) {
    await window.faktiskDialog.alert(`${noTitle} episode${noTitle > 1 ? 'r' : ''} mangler tittel. Fyll inn tittelen før du kopierer.`);
    return;
  }
  const missing = eps.filter(e => !isLabradorUrl(e.thumb) && !isMuxEp(e)).length;
  if (missing) {
    const go = await window.faktiskDialog.confirm(
      `${missing} av ${eps.length} episoder har ikke forhåndsbilde i Labrador.\n\n`
      + 'Da hentes bildet fra YouTube når siden lastes, og Google får leserens IP-adresse før noen har trykket play.\n\n'
      + 'Bruk «Alle bilder til Labrador» først, eller kopier likevel?');
    if (!go) return;
  }
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet());
    const orig = els.copyEmbed.textContent;
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
//  Lagring og prosjekter
// ============================================================

let isRestoring = false;

// Alt som trengs for å gjenskape feltene, lagt i embedens data (src).
function embedSource() {
  return {
    v: 1, kicker: els.kicker.value, title: els.title.value, credit: els.credit.value,
    about: els.about.value, cover: els.cover.value, coverBig: els.coverBig.value,
    loopBig: els.loopBig.value, loopSmall: els.loopSmall.value,
    links: { youtube: els.linkYoutube.value, spotify: els.linkSpotify.value, apple: els.linkApple.value, all: els.linkAll.value },
    visible: els.visible.value,
    episodes: activeEpisodes().map(e => ({ id: e.id, src: e.src || '', title: e.title, desc: e.desc, date: e.date, dur: e.dur, no: e.no, thumb: e.thumb })),
  };
}

// Leser en embed limt inn fra Labrador. Nye embeds har src i dataene; eldre
// (før 29.10) leses fra markupen + episodedataene.
function parseEmbed(code) {
  const doc = new DOMParser().parseFromString(String(code || ''), 'text/html');
  const dataEl = doc.querySelector('script.fpod-data');
  if (!dataEl) throw new Error('Fant ingen podkast-embed. Lim inn hele koden fra Markup-boksen.');
  let D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { throw new Error('Klarte ikke å lese dataene i embeden.'); }
  if (D.src && typeof D.src === 'object') return D.src;
  const txt = sel => { const n = doc.querySelector(sel); return n ? n.textContent.trim() : ''; };
  const link = t => { const a = Array.from(doc.querySelectorAll('.fpod-links a')).find(x => x.textContent.trim() === t); return a ? a.getAttribute('href') || '' : ''; };
  const para = p => { p.querySelectorAll('br').forEach(br => br.replaceWith('\n')); return p.textContent.trim(); };
  const cb = doc.querySelector('.fpod-coverbtn');
  const img = doc.querySelector('.fpod-about img');
  const eps = Array.isArray(D.episodes) ? D.episodes : [];
  const foot = doc.querySelector('.fpod-foot a');
  return {
    kicker: txt('.fpod-kicker'), title: D.title || txt('.fpod-series'), credit: txt('.fpod-credit'),
    about: Array.from(doc.querySelectorAll('.fpod-abouttext p')).map(para).join('\n\n'),
    cover: img ? img.getAttribute('src') || '' : '', coverBig: cb ? cb.getAttribute('data-full') || '' : '',
    loopBig: D.loop && D.loop.big || '', loopSmall: D.loop && D.loop.small || '',
    links: { youtube: link('YouTube'), spotify: link('Spotify'), apple: link('Apple Podcasts'),
             all: eps.length > 1 && foot ? foot.getAttribute('href') || '' : '' },
    episodes: eps.map(e => ({ id: e.id || '', src: e.src || '', title: e.title || '', desc: e.desc || '', date: '', dur: e.dur || '', no: e.no || '', thumb: e.thumb || '' })),
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
  const filled = els.title.value.trim() || activeEpisodes().length;
  if (filled && !(await window.faktiskDialog.confirm('Erstatte det som står i feltene nå med innholdet fra embeden?'))) return;
  applyState(Object.assign({ visible: els.visible.value, previewWidth: els.previewWidth.value }, s, { previewWidth: els.previewWidth.value }));
  saveStateNow();
  els.importInput.value = '';
  const n = (s.episodes || []).length;
  setImportStatus(`Hentet «${s.title || 'uten navn'}» med ${n} ${n === 1 ? 'video' : 'videoer'}.`);
});

function serializeState() {
  return {
    kicker: els.kicker.value, title: els.title.value, credit: els.credit.value,
    about: els.about.value, cover: els.cover.value, coverBig: els.coverBig.value,
    loopBig: els.loopBig.value, loopSmall: els.loopSmall.value,
    episodes: state.episodes,
    links: { youtube: els.linkYoutube.value, spotify: els.linkSpotify.value, apple: els.linkApple.value, all: els.linkAll.value },
    visible: els.visible.value, previewWidth: els.previewWidth.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    if (typeof s.kicker === 'string') els.kicker.value = s.kicker;
    els.title.value = s.title || '';
    els.credit.value = s.credit || '';
    els.about.value = s.about || '';
    els.cover.value = s.cover || '';
    els.coverBig.value = s.coverBig || '';
    els.loopBig.value = s.loopBig || '';
    els.loopSmall.value = s.loopSmall || '';
    const L = s.links || {};
    els.linkYoutube.value = L.youtube || ''; els.linkSpotify.value = L.spotify || '';
    els.linkApple.value = L.apple || ''; els.linkAll.value = L.all || '';
    if (s.visible) els.visible.value = s.visible;
    if (s.previewWidth) els.previewWidth.value = s.previewWidth;
    if (Array.isArray(s.episodes)) state.episodes = s.episodes.map(e => newEp(e));
    renderEpisodes();
    renderPreview();
  } finally {
    isRestoring = false;
  }
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.kicker, els.title, els.credit, els.about, els.cover, els.coverBig, els.loopBig, els.loopSmall, els.linkYoutube, els.linkSpotify, els.linkApple, els.linkAll]
  .forEach(el => el.addEventListener('input', scheduleUpdate));
[els.visible, els.previewWidth].forEach(el => el.addEventListener('change', scheduleUpdate));

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
  const defaultName = (els.title.value || '').slice(0, 40).trim() || `Podkast ${new Date().toLocaleDateString('no')}`;
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
  renderEpisodes();
  renderPreview();
})();
