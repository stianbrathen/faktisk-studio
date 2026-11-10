// Faktisk Studio · Verifisering 0.2
//
// Leser det en video- eller bildefil selv sier om opprinnelsen (C2PA, IPTC/XMP,
// EXIF, MP4/MOV-metadata) og lager hjelpebilder (enkeltbilder, kanter,
// forskjellskart) som journalisten vurderer selv. Lagrer en HTML-rapport.
//
// Alt kjører i plugin-vinduet: fila leses via <input type=file>/dra-og-slipp,
// bilder hentes med <video> + <canvas>. Ingen ny IPC, ingen nettverk
// (CSP i index.html tillater ikke https). Bruker bare eksisterende
// saveDialog/writeTextFile/openExternal/copyToClipboard.
//
// REGEL: verktøyet gir aldri en samlet «ekte/falsk»-konklusjon.

const PLUGIN_ID = 'verifisering';
const PLUGIN_VERSION = '0.2.0';
const $ = id => document.getElementById(id);
const F = window.faktisk || {};

(async () => {
  try {
    const [appV, plugins] = await Promise.all([F.appVersion(), F.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = $('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const state = {
  file: null, url: '', kind: '', sha256: '', c2pa: null, xmp: {}, exif: null, video: null, findings: [],
  fps: 30, duration: 0, t: 0, frame: null, mode: 'bilde', zoom: 'fit', shots: [], busy: false, imageBitmap: null,
  viewInfo: '', audio: null, audioFindings: [], lsFinding: null, lsPlotUrl: '',
  extraFindings: [], tidFindings: [], parFinding: null, ocrFinding: null, jpeg: null, thumb: null, tl: null, par: null,
};
const els = {
  status: $('status'), progressBox: $('progressBox'), progressBar: $('progressBar'), fileBox: $('fileBox'), fileInfo: $('fileInfo'),
  reportBox: $('reportBox'), moreBox: $('moreBox'), empty: $('emptyState'), main: $('mainArea'), findingList: $('findingList'),
  canvas: $('viewCanvas'), stage: $('stage'), scrub: $('scrub'), time: $('timeLabel'), strip: $('strip'), explain: $('explain'),
  video: $('srcVideo'), metaTables: $('metaTables'), shotList: $('shotList'), note: $('noteInput'), alignChk: $('alignChk'),
};

// ============================================================
//  Hjelpere
// ============================================================
function setStatus(msg, isError) { els.status.textContent = msg || ''; els.status.style.color = isError ? '#FFB4B4' : '#fff'; }
function progress(p) { if (p == null) { els.progressBox.style.display = 'none'; return; } els.progressBox.style.display = ''; els.progressBar.style.width = Math.round(p * 100) + '%'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1).replace('.', ',') + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; return (n / 1073741824).toFixed(2).replace('.', ',') + ' GB'; }
function fmtT(t) { return (Math.round(t * 100) / 100).toFixed(2).replace('.', ',') + ' s'; }
function fmtDate(d) { if (!d) return ''; const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? String(d) : x.toLocaleString('nb-NO'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fileReader(file) { return { size: file.size, read: (o, n) => file.slice(o, Math.min(file.size, o + n)).arrayBuffer().then(b => new Uint8Array(b)) }; }

// ============================================================
//  Fil inn
// ============================================================
$('fileInput').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
const drop = $('dropZone');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('is-over'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(file) {
  if (playing) await stopPlay();
  if (state.busy) return;
  state.busy = true;
  try {
    if (state.url) URL.revokeObjectURL(state.url);
    Object.assign(state, { file, url: URL.createObjectURL(file), sha256: '', c2pa: null, xmp: {}, exif: null, video: null, findings: [], frame: null, t: 0, n: 0, shots: [], imageBitmap: null, mode: 'bilde', shotsAuto: [], sunResult: null, audio: null, audioFindings: [], lsFinding: null, lsPlotUrl: '', extraFindings: [], tidFindings: [], parFinding: null, ocrFinding: null, jpeg: null, thumb: null, tl: null, par: null });
    $('ocrOut').innerHTML = ''; $('ocrNote').textContent = ''; $('sunOut').innerHTML = ''; $('tidNote').textContent = '';
    $('audioBox').innerHTML = ''; resetLipsyncUi();
    els.note.value = '';
    renderShots();
    els.empty.style.display = 'none'; els.main.style.display = '';
    [els.fileBox, els.reportBox, els.moreBox, $('searchBox')].forEach(b => b.style.display = '');
    setStatus('Leser metadata…'); progress(0.1);

    const reader = fileReader(file);
    state.c2pa = await VfC2pa.read(reader);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isVideo = /^video\//.test(file.type) || (state.c2pa.format === 'bmff' && !['heic', 'heif', 'avif'].includes(ext));
    state.kind = isVideo ? 'video' : 'image';
    progress(0.3);

    if (isVideo) {
      if (state.c2pa.format === 'bmff') { try { state.video = await VfMeta.bmff(reader); } catch (e) { console.warn(e); } }
    } else {
      try {
        state.exif = await window.exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, jfif: true, ihdr: true, mergeOutput: true, translateValues: true });
      } catch (e) { state.exif = null; console.warn('exifr', e); }
    }
    state.xmp = VfMeta.xmpFields(state.c2pa.xmp);
    state.findings = VfFindings.build({ name: file.name, c2pa: state.c2pa, xmp: state.xmp, exif: state.exif, video: state.video, kind: state.kind });
    renderFindings(); renderFileInfo(); renderMeta();
    progress(0.5);

    await setupMedia();
    progress(0.7);
    $('lydTab').style.display = state.kind === 'video' ? '' : 'none';
    if (state.kind === 'video') { setStatus('Analyserer lyden…'); await analyzeAudio(); }
    progress(0.8);
    setStatus('Ser etter spor i fila…');
    try { await extraAnalysis(); } catch (e) { console.warn('ekstra', e); }
    progress(0.85);
    setStatus('Beregner sjekksum…');
    await computeHash();
    renderFileInfo();
    setStatus('Ferdig. Se funn, bilder og metadata.');
  } catch (e) {
    console.error(e); setStatus('Kunne ikke lese fila: ' + e.message, true);
  } finally { progress(null); state.busy = false; }
}

async function computeHash() {
  if (!crypto.subtle || state.file.size > 1024 * 1048576) { state.sha256 = ''; return; }
  const buf = await state.file.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  state.sha256 = Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}

function fileFacts() {
  const f = state.file; const v = state.video && state.video.tracks.find(t => t.handler === 'vide');
  const facts = { 'Filnavn': f.name, 'Størrelse': fmtBytes(f.size) + ' (' + f.size.toLocaleString('nb-NO') + ' byte)', 'Type': f.type || state.c2pa.format, 'Sist endret (din maskin)': fmtDate(new Date(f.lastModified)) };
  if (state.sha256) facts['SHA-256'] = state.sha256; else facts['SHA-256'] = state.file.size > 1024 * 1048576 ? 'ikke beregnet (over 1 GB)' : '…';
  if (v) { facts['Oppløsning'] = Math.round(v.width) + '×' + Math.round(v.height); if (v.fps) facts['Bilder/s'] = VfFindings.fmtNum(v.fps); }
  if (state.duration) facts['Lengde'] = fmtT(state.duration);
  if (state.kind === 'image' && state.imageBitmap) facts['Oppløsning'] = state.imageBitmap.width + '×' + state.imageBitmap.height;
  return facts;
}
function renderFileInfo() {
  const facts = fileFacts();
  els.fileInfo.innerHTML = Object.keys(facts).map(k => `<div><span>${esc(k)}</span><b class="${k === 'SHA-256' ? 'vf-hash' : ''}">${esc(facts[k])}</b></div>`).join('');
}

// ============================================================
//  Funn
// ============================================================
const VEKT = { ai: ['Peker mot AI', 'vf-tag--ai'], opptak: ['Fila påstår opptak', 'vf-tag--opptak'], behandlet: ['Bearbeidet', 'vf-tag--beh'], noytral: ['', ''] };
// «Fila påstår opptak» bare når fila selv sier det (merking); tekniske spor som passer med opptak får en mildere merkelapp
function vektLabel(x) { if (x.vekt === 'opptak' && x.nivå !== 'merking') return ['Typisk for opptak', 'vf-tag--opptak']; return VEKT[x.vekt] || VEKT.noytral; }
const NIVÅ = { merking: 'Merking i fila', spor: 'Teknisk spor', mangler: 'Ikke funnet', info: 'Fakta' };
function allFindings() { return [].concat(state.findings, state.extraFindings, state.tidFindings, state.audioFindings, [state.lsFinding, state.parFinding, state.ocrFinding].filter(Boolean)); }
function renderFindings() {
  els.findingList.innerHTML = allFindings().map((x, i) => {
    const v = vektLabel(x);
    return `<article class="vf-f vf-f--${x.nivå}">
      <div class="vf-f__head"><span class="vf-f__lvl">${esc(NIVÅ[x.nivå] || x.nivå)}</span>${v[0] ? `<span class="vf-tag ${v[1]}">${v[0]}</span>` : ''}</div>
      <h4>${esc(x.tittel)}</h4>
      <p>${esc(x.tekst)}</p>
      <p class="vf-f__b"><b>Betyr:</b> ${esc(x.betyr)}</p>
      <p class="vf-f__bi"><b>Betyr ikke:</b> ${esc(x.betyrIkke)}</p>
      ${x.kart ? `<button class="link-btn vf-map" data-i="${i}" type="button">Åpne posisjonen i kart</button>` : ''}
    </article>`;
  }).join('');
  els.findingList.querySelectorAll('.vf-map').forEach(b => b.addEventListener('click', async () => {
    const k = allFindings()[+b.dataset.i].kart;
    const ok = await window.faktiskDialog.confirm('Åpne posisjonen i Google Maps i nettleseren? Bare koordinatene sendes, ikke fila.');
    if (ok) F.openExternal('https://www.google.com/maps?q=' + k[0] + ',' + k[1]);
  }));
}

// ============================================================
//  Metadata-tabeller
// ============================================================
function flatten(obj, prefix, out, depth) {
  out = out || {}; depth = depth || 0;
  for (const k of Object.keys(obj || {})) {
    const v = obj[k]; const key = prefix ? prefix + '.' + k : k;
    if (v == null || v === '') continue;
    if (v instanceof Uint8Array || (v && v.buffer instanceof ArrayBuffer && v.byteLength > 64)) { out[key] = '(' + (v.length || v.byteLength) + ' byte)'; continue; }
    if (v instanceof Date) { out[key] = fmtDate(v); continue; }
    if (Array.isArray(v)) { out[key] = v.length > 12 ? '[' + v.length + ' verdier]' : v.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(', '); continue; }
    if (typeof v === 'object' && depth < 3) { flatten(v, key, out, depth + 1); continue; }
    out[key] = String(v).slice(0, 400);
  }
  return out;
}
function metaSections() {
  const sec = [];
  const a = state.c2pa.store && state.c2pa.store.active;
  if (a) {
    const d = { 'Verktøy (claim generator)': a.generator, 'Tittel': a.title, 'Format': a.format, 'Instans-ID': a.instanceID, 'Signeringsalgoritme': a.alg,
      'Signert av (O / CN)': a.signer ? [a.signer.subject.O, a.signer.subject.CN].filter(Boolean).join(' / ') : '(fant ikke sertifikat)',
      'Sertifikat utstedt av': a.signer ? [a.signer.issuer.O, a.signer.issuer.CN].filter(Boolean).join(' / ') : '',
      'Sertifikat gyldig': a.signer ? a.signer.notBefore + ' – ' + a.signer.notAfter : '',
      'Tidsstempel i signaturen': a.hasTimestamp ? 'ja (ikke kontrollert)' : 'nei', 'Antall manifester': state.c2pa.store.manifests.length,
      'Assertions': a.assertionLabels.join(', ') };
    a.actions.forEach((x, i) => { d['Handling ' + (i + 1)] = [x.action, x.digitalSourceType ? 'kilde: ' + x.digitalSourceType.split('/').pop() : '', x.softwareAgent, x.when, x.description].filter(Boolean).join(' · '); });
    a.ingredients.forEach((x, i) => { d['Ingrediens ' + (i + 1)] = [x.title, x.format, x.relationship].filter(Boolean).join(' · '); });
    if (a.authors.length) d['Forfatter (påstått)'] = a.authors.join(', ');
    sec.push(['Content Credentials (C2PA) — ikke signaturkontrollert', d]);
  }
  if (Object.keys(state.xmp).length) sec.push(['XMP / IPTC', state.xmp]);
  if (state.exif) sec.push(['EXIF / TIFF / IPTC / GPS (exifr)', flatten(state.exif)]);
  if (state.video) {
    const v = state.video;
    sec.push(['Beholder', { 'Hovedmerke (ftyp)': v.brand, 'Kompatible merker': v.compatible.join(', '), 'Bokser på toppnivå': v.boxes.join(', '), 'Laget (mvhd)': fmtDate(v.created), 'Endret (mvhd)': fmtDate(v.modified), 'Lengde': v.duration ? fmtT(v.duration) : '', 'Koder (fra videodata)': v.encoderHints.join(', ') }]);
    const TL = { codec: 'Kodek', width: 'Bredde (px)', height: 'Høyde (px)', codedWidth: 'Kodet bredde', codedHeight: 'Kodet høyde', fps: 'Bilder/s', samples: 'Antall bilder/pakker', keyframeEvery: 'Nøkkelbilde hvert (bilder)', keyframeRegular: 'Helt fast nøkkelbildeintervall', syncSamples: 'Antall nøkkelbilder', allKeyframes: 'Bare nøkkelbilder', compressor: 'Kodernavn i sporet', handlerName: 'Spornavn', language: 'Språk', channels: 'Lydkanaler', sampleRate: 'Samplingsfrekvens (Hz)', timescale: 'Tidsskala', duration: 'Varighet (i tidsskala-enheter)', sttsEntries: 'Oppføringer i tidstabellen', editList: 'Redigeringsliste (elst, varighet:mediatid)', startDelay: 'Forsinket start (s)', mediaSkip: 'Hopper over i starten (s)' };
    v.tracks.forEach((t, i) => {
      const d = {}; for (const k of Object.keys(TL)) if (t[k] !== undefined && t[k] !== '' && t[k] !== 0 && !(t.handler === 'soun' && ['width', 'height', 'fps', 'keyframeEvery', 'syncSamples'].includes(k))) d[TL[k]] = typeof t[k] === 'boolean' ? (t[k] ? 'ja' : 'nei') : typeof t[k] === 'number' ? VfFindings.fmtNum(t[k]) : t[k];
      sec.push(['Spor ' + (i + 1) + ' (' + (t.handler === 'vide' ? 'video' : t.handler === 'soun' ? 'lyd' : t.handler) + ')', d]);
    });
    if (Object.keys(v.keys).length) sec.push(['QuickTime-nøkler', v.keys]);
    if (Object.keys(v.tags).length) sec.push(['udta-tekster', v.tags]);
  }
  return sec;
}
function renderMeta() {
  const sec = metaSections();
  els.metaTables.innerHTML = sec.length ? sec.map(([t, d]) => `<h4 class="vf-mh">${esc(t)}</h4><table class="vf-mt">${Object.keys(d).filter(k => d[k] !== '' && d[k] != null).map(k => `<tr><th>${esc(k)}</th><td>${esc(d[k])}</td></tr>`).join('')}</table>`).join('')
    : '<p class="vf-muted">Fant ingen metadata å vise.</p>';
}

// ============================================================
//  Bilder: video/bilde → canvas, moduser
// ============================================================
const WORK_W = 960;   // analyse-oppløsning for kanter/forskjell (fart)
async function setupMedia() {
  els.strip.innerHTML = '';
  document.querySelectorAll('#modeSeg [data-video]').forEach(b => { b.disabled = state.kind !== 'video'; });
  $('alignWrap').style.display = state.kind === 'video' ? '' : 'none';
  $('scrubRow').style.display = state.kind === 'video' ? '' : 'none';
  setMode('bilde', true);
resetLipsyncUi();
  if (state.kind === 'video') {
    const v = els.video; v.src = state.url;
    setStatus('Åpner videoen…');
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Videoen kan ikke spilles av her (kodek?)')); setTimeout(() => rej(new Error('Videoen lastet ikke innen 20 s')), 20000); });
    state.duration = v.duration || (state.video && state.video.duration) || 0;
    const tr = state.video && state.video.tracks.find(t => t.handler === 'vide');
    state.fps = (tr && tr.fps) || 30;
    els.scrub.max = Math.max(1, Math.floor(state.duration * state.fps) - 1);
    await showTime(Math.min(1, state.duration / 2));
    state.stripPromise = buildStrip().catch(e => console.warn('miniatyrer', e));
  } else {
    state.imageBitmap = await createImageBitmap(state.file);
    const c = document.createElement('canvas'); c.width = state.imageBitmap.width; c.height = state.imageBitmap.height;
    const ctx = c.getContext('2d'); ctx.drawImage(state.imageBitmap, 0, 0);
    state.frame = { canvas: c };
    await render();
  }
}
function seek(t) {
  const v = els.video;
  return new Promise(res => {
    // requestVideoFrameCallback fyrer ikke alltid for en skjult video — derfor også en tidsgrense
    const done = () => { v.removeEventListener('seeked', done); let ok = false; const fin = () => { if (!ok) { ok = true; res(); } }; if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fin); setTimeout(fin, 120); };
    v.addEventListener('seeked', done);
    v.currentTime = Math.max(0, Math.min(state.duration - 0.001, t));
  });
}
// Bilde nr. n vises i [n/fps, (n+1)/fps). Vi søker til midten av bildet, ellers
// kan avrunding gi samme bilde to ganger (t + 1/fps havnet i samme bilde i test).
const frameAt = t => Math.max(0, Math.min(Math.floor(state.duration * state.fps) - 1, Math.floor(t * state.fps + 1e-6)));
const centerOf = n => (n + 0.5) / state.fps;
// Én videohenting om gangen: miniatyrstripa bygges i bakgrunnen, og to samtidige
// søk i samme <video> ga feil bilde (og avspilling fra feil sted) i test.
let videoLock = Promise.resolve();
function grab(t, maxW) {
  const job = videoLock.then(async () => {
    await seek(t);
    const v = els.video; const s = maxW && v.videoWidth > maxW ? maxW / v.videoWidth : 1;
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c;
  });
  videoLock = job.catch(() => {});
  return job;
}
const toImg = c => c.getContext('2d').getImageData(0, 0, c.width, c.height);
function scaledCanvas(src, maxW) {
  if (src.width <= maxW) return src;
  const s = maxW / src.width; const c = document.createElement('canvas'); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}
async function showTime(t) {
  const n = frameAt(t); state.n = n; t = n / state.fps;
  state.t = t; els.scrub.value = n; els.time.textContent = fmtT(t) + ' · bilde ' + (n + 1);
  state.frame = { canvas: await grab(centerOf(n)) };
  await render();
  els.strip.querySelectorAll('.vf-strip__f').forEach(b => b.classList.toggle('is-on', frameAt(+b.dataset.t) === n));
}
async function buildStrip() {
  const n = Math.min(12, Math.max(2, Math.floor(state.duration)));
  const keepT = state.t; els.strip.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const t = state.duration * (i + 0.5) / n;
    const c = await grab(t, 240);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'vf-strip__f'; b.dataset.t = t;
    b.innerHTML = `<img src="${c.toDataURL('image/jpeg', 0.7)}" alt=""><span>${fmtT(t)}</span>`;
    b.addEventListener('click', () => showTime(t));
    els.strip.appendChild(b);
  }
  await seek(centerOf(state.n || 0));
}

const EXPLAIN = {
  parallakse: { tittel: 'Parallakse (dybde i bakgrunnen)', betyr: 'Studio følger punkter i bakgrunnen (personen er maskert bort) fra dette bildet til et bilde 2,5 s senere, og ser om alt beveger seg som ett flatt bilde. Grønne punkter følger planet; oransje ruter beveger seg annerledes (piler forstørret) — det er tegn på ekte dybde, slik et virkelig rom eller en gate har.', betyrIkke: 'At bakgrunnen er falsk når det ikke er oransje ruter. Flate fasader, fjerne motiver og et kamera som bare dreies gir heller ingen dybde. Og dybde utelukker ikke at personen er lagt oppå en ekte bakgrunnsvideo.' },
  hjorner: { tittel: 'Hjørner forstørret', betyr: 'De fire hjørnene forstørret 2×, der AI-verktøy ofte setter synlig merke (f.eks. Sora-logo, Veo-tekst, Gemini-stjerne). Se også etter rester av et merke som er beskåret eller visket ut.', betyrIkke: 'At fila er ekte hvis du ikke ser noe. Synlige merker fjernes lett, og mange verktøy setter dem ikke.' },
  bilde: { tittel: 'Enkeltbilde', betyr: 'Bildet slik det ligger i fila, i full oppløsning. Bruk zoom for å se på kanter rundt personer, tekst, hender og skygger.', betyrIkke: 'Hvordan opptaket så ut før det ble komprimert. Komprimering gir blokker og uskarphet som ikke er manipulasjon.' },
  kanter: { tittel: 'Kanter (Sobel)', betyr: 'Lyse linjer viser hvor lysstyrken endrer seg brått. Se etter en hard, jevn kontur rundt en person mot en ellers myk bakgrunn, doble konturer, eller et område der kantene plutselig er mye skarpere eller mykere enn resten.', betyrIkke: 'At noe er klippet inn. Mobilkameraer skjerper bildet, og skarpe kanter er normalt der det er kontrast (skilt, vindusrammer, hår).' },
  endring: { tittel: 'Endring til neste bilde', betyr: 'Lyst = endret seg mellom dette bildet og det neste (etter at kamerabevegelsen er trukket fra). En ekte bakgrunn er stort sett mørk; det som beveger seg (munn, hode) lyser. En lysende stripe som følger omrisset av en person, kan tyde på en maske.', betyrIkke: 'Manipulasjon i seg selv. Bevegelse, lysendring, komprimering og kamerarotasjon gir også lys, særlig langs skarpe kanter.' },
  snitt: { tittel: 'Snitt av endring', betyr: 'Gjennomsnittet av mange «endring»-bilder over et par sekunder, flyttet til samme kamerastilling. Det som vanligvis beveger seg, lyser; en stillestående bakgrunn blir mørk. Ser du en tydelig ring rundt personen som ikke følger bevegelsen hans, er det verdt en nærmere kikk.', betyrIkke: 'At bakgrunnen er ekte fordi den er mørk, eller falsk fordi den lyser. Glass, speilinger, stripemønstre og perspektivendring lyser også.' },
};
function setMode(m, silent) {
  state.mode = m;
  $('parScanBtn').style.display = m === 'parallakse' ? '' : 'none';
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('is-on', b.dataset.mode === m));
  const e = EXPLAIN[m];
  els.explain.innerHTML = `<b>${esc(e.tittel)}.</b> <span class="vf-f__b"><b>Betyr:</b> ${esc(e.betyr)}</span> <span class="vf-f__bi"><b>Betyr ikke:</b> ${esc(e.betyrIkke)}</span>`;
  if (!silent) render();
}
document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => { if (!b.disabled && !state.busy) setMode(b.dataset.mode); }));
els.alignChk.addEventListener('change', () => { if (state.mode === 'endring' || state.mode === 'snitt') render(); });
document.querySelectorAll('#zoomSeg button').forEach(b => b.addEventListener('click', () => {
  state.zoom = b.dataset.zoom; document.querySelectorAll('#zoomSeg button').forEach(x => x.classList.toggle('is-on', x === b)); applyZoom();
}));
function applyZoom() {
  const c = els.canvas;
  if (state.zoom === 'fit') { c.style.width = ''; c.style.height = ''; c.classList.add('is-fit'); }
  else { c.classList.remove('is-fit'); c.style.width = (c.width * +state.zoom) + 'px'; c.style.height = (c.height * +state.zoom) + 'px'; }
}
function paint(imgOrCanvas) {
  const c = els.canvas; const ctx = c.getContext('2d');
  if (imgOrCanvas instanceof HTMLCanvasElement) { c.width = imgOrCanvas.width; c.height = imgOrCanvas.height; ctx.drawImage(imgOrCanvas, 0, 0); }
  else { c.width = imgOrCanvas.width; c.height = imgOrCanvas.height; ctx.putImageData(new ImageData(imgOrCanvas.data, imgOrCanvas.width, imgOrCanvas.height), 0, 0); }
  applyZoom();
}
async function render() {
  if (!state.frame) return;
  const m = state.mode; const align = els.alignChk.checked;
  state.viewInfo = '';
  try {
    if (m === 'bilde') { paint(state.frame.canvas); return; }
    if (m === 'kanter') { paint(VfVisual.edges(toImg(scaledCanvas(state.frame.canvas, 1600)), { overlay: true })); return; }
    if (m === 'hjorner') { paint(VfVisual.corners(toImg(scaledCanvas(state.frame.canvas, 1920)))); return; }
    if (m === 'parallakse') { await renderParallax(); return; }
    state.busy = true;
    if (m === 'endring') {
      setStatus('Lager forskjellskart…');
      const a = scaledCanvas(state.frame.canvas, WORK_W);
      const b = scaledCanvas(await grab(centerOf(state.n + 1)), WORK_W);
      await seek(centerOf(state.n));
      const r = VfVisual.diff(toImg(a), toImg(b), { align });
      state.viewInfo = align ? 'kamerabevegelse trukket fra: ' + r.shift.dx + ', ' + r.shift.dy + ' px' : 'uten justering';
      paint(r);
      setStatus('Endring ' + fmtT(state.t) + ' → neste bilde (' + state.viewInfo + ').' + (r.mean < 0.25 ? ' Bildene er nesten helt like — kan være et duplisert bilde (vanlig etter konvertering av bildefrekvens).' : ''));
    } else if (m === 'snitt') {
      const span = Math.min(3, Math.max(0.5, state.duration - state.t - 2 / state.fps)); const N = 16; const pairs = [];
      for (let i = 0; i < N; i++) {
        setStatus('Henter bilder ' + (i + 1) + '/' + N + '…'); progress(i / N * 0.6);
        const n = state.n + Math.round(span * state.fps * i / N);
        const a = i === 0 ? scaledCanvas(state.frame.canvas, WORK_W) : scaledCanvas(await grab(centerOf(n)), WORK_W);
        const b = scaledCanvas(await grab(centerOf(n + 1)), WORK_W);
        pairs.push([toImg(a), toImg(b)]);
      }
      setStatus('Regner ut snittet…'); progress(0.8); await sleep(20);
      const r = VfVisual.accumulate(pairs, { align });
      await seek(centerOf(state.n));
      state.viewInfo = N + ' bildepar over ' + fmtT(span) + (r.skipped ? ', ' + r.skipped + ' hoppet over (lot seg ikke justere)' : '');
      paint(r); setStatus('Snitt av endring fra ' + fmtT(state.t) + ' (' + state.viewInfo + ').');
    }
  } catch (e) { console.error(e); setStatus('Feil: ' + e.message, true); }
  finally { state.busy = false; progress(null); }
}
els.scrub.addEventListener('input', () => { if (!state.busy) showTime(+els.scrub.value / state.fps); });
$('prevFrameBtn').addEventListener('click', () => { if (!state.busy) showTime((state.n - 1) / state.fps); });
$('nextFrameBtn').addEventListener('click', () => { if (!state.busy) showTime((state.n + 1) / state.fps); });
document.addEventListener('keydown', e => {
  if (state.kind !== 'video' || $('panel-bilder').style.display === 'none' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowLeft') $('prevFrameBtn').click(); if (e.key === 'ArrowRight') $('nextFrameBtn').click();
});

// Avspilling med lyd. Videoen er skjult (display:none), så bildet tegnes på lerretet
// med requestAnimationFrame — requestVideoFrameCallback fyrer ikke pålitelig for skjult video.
let playing = false, playStarted = false;
async function togglePlay() {
  if (state.kind !== 'video') return;
  if (playing) { await stopPlay(); return; }
  if (state.busy) return;
  const v = els.video;
  if (state.mode !== 'bilde') setMode('bilde', true);
  playing = true; state.busy = true; $('playBtn').textContent = '❚❚'; $('playBtn').title = 'Pause (mellomrom)';
  if (state.stripPromise) { setStatus('Venter på miniatyrene…'); await state.stripPromise; setStatus(''); }
  await videoLock;
  if (!playing) return;
  // Start fra bildet som vises (den skjulte videoen kan stå der miniatyrstripa slapp den)
  await seek(state.n >= Math.floor(state.duration * state.fps) - 2 ? 0 : state.t);
  if (!playing) return;
  v.muted = false; v.volume = 1; v.onended = () => stopPlay();
  const tick = () => {
    if (!playing) return;
    const c = els.canvas;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; applyZoom(); }
    c.getContext('2d').drawImage(v, 0, 0);
    const n = frameAt(v.currentTime); els.scrub.value = n; els.time.textContent = fmtT(v.currentTime) + ' · bilde ' + (n + 1);
    requestAnimationFrame(tick);
  };
  try { await v.play(); playStarted = true; tick(); }
  catch (e) { await stopPlay(); setStatus('Kunne ikke spille av: ' + e.message, true); }
}
async function stopPlay() {
  if (!playing) return;
  playing = false; const v = els.video; v.pause(); v.muted = true; v.onended = null;
  $('playBtn').textContent = '▶'; $('playBtn').title = 'Spill av med lyd (mellomrom)';
  const started = playStarted; playStarted = false;
  state.busy = false;
  await showTime(started ? Math.min(v.currentTime, state.duration - 0.001) : state.t);
}
$('playBtn').addEventListener('click', togglePlay);
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || state.kind !== 'video' || $('panel-bilder').style.display === 'none' || /INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
  e.preventDefault(); togglePlay();
});

// ============================================================
//  Lyd
// ============================================================
async function analyzeAudio() {
  const v = state.video; const hasSound = v ? v.tracks.some(t => t.handler === 'soun') : true;
  if (!hasSound) { state.audioFindings = [{ nivå: 'info', vekt: 'noytral', tittel: 'Ingen lydspor', tekst: 'Videoen har ikke lyd.', betyr: 'Fila er lagret uten lyd (eller lyden er fjernet).', betyrIkke: 'Noe om ekthet alene. Mange AI-videoverktøy lager video uten lyd, men det gjør også mange eksporter og opplastinger.' }]; renderFindings(); renderAudioBox(); return; }
  if (state.file.size > 800 * 1048576) { state.audioFindings = [{ nivå: 'info', vekt: 'noytral', tittel: 'Lyden er ikke analysert', tekst: 'Fila er over 800 MB.', betyr: 'Lydanalysen dekoder hele lydsporet i minnet og er slått av for så store filer.', betyrIkke: '' }]; renderFindings(); renderAudioBox(); return; }
  try {
    const buf = await state.file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const ab = await ctx.decodeAudioData(buf);
    const ch = []; for (let i = 0; i < Math.min(2, ab.numberOfChannels); i++) ch.push(ab.getChannelData(i));
    // Lydens plassering i forhold til bildet (redigeringsliste). Chromium følger
    // «hopp i starten» (media_time) også i decodeAudioData, men IKKE en tom redigering
    // (forsinket lydstart) — målt 10.11.2026. Den legges derfor til her, ellers blir
    // leppesynk feil for filer der lyden starter senere enn bildet.
    const at = v && v.tracks.find(t => t.handler === 'soun');
    const offset = (at && at.startDelay) || 0;
    state.audio = VfAudio.analyze(ch, ab.sampleRate, state.fps, { offset });
    state.audio.decodedChannels = ab.numberOfChannels;
    state.audioFindings = audioFindings(state.audio);
  } catch (e) {
    console.warn('lyd', e);
    state.audioFindings = [{ nivå: 'info', vekt: 'noytral', tittel: 'Lyden kunne ikke leses', tekst: e.message, betyr: 'Lydformatet støttes kanskje ikke i Studio.', betyrIkke: 'Noe om fila.' }];
  }
  renderFindings(); renderAudioBox();
}
function dbStr(x) { return Math.round(x) + ' dB'; }
function audioFindings(a) {
  const out = [];
  if (a.channels >= 2) out.push(a.dualMono
    ? { nivå: 'spor', vekt: 'behandlet', tittel: 'Lyden er dobbel mono', tekst: 'Venstre og høyre kanal er identiske (sidesignal ' + (a.sideRatio * 100).toFixed(1).replace('.', ',') + ' %).', betyr: 'Lyden er tatt opp med én mikrofon, eller lagt på / laget etterpå (taleopptak, syntetisk stemme, mono-eksport).', betyrIkke: 'At lyden er falsk. Mange mikrofoner og apper tar opp i mono.' }
    : { nivå: 'spor', vekt: 'opptak', tittel: 'Ekte stereo', tekst: 'Korrelasjon venstre/høyre ' + a.stereoCorr.toFixed(2).replace('.', ',') + ', sidesignal ' + Math.round(a.sideRatio * 100) + ' %.', betyr: 'Kanalene er forskjellige, slik de blir med to mikrofoner (vanlig på telefoner).', betyrIkke: 'At lyd og bilde hører sammen. Stereo kan også lages i et redigeringsprogram.' });
  else out.push({ nivå: 'info', vekt: 'noytral', tittel: 'Monolyd', tekst: 'Lydsporet har én kanal.', betyr: 'Tatt opp eller lagret i mono.', betyrIkke: 'Noe om ekthet.' });
  const silent = a.digitalSilenceShare > 0.02;
  out.push({ nivå: 'spor', vekt: silent ? 'behandlet' : 'noytral', tittel: 'Bakgrunnsstøy i pausene: ' + dbStr(a.noiseFloorDb),
    tekst: 'Stilleste 8 % av lyden ligger rundt ' + dbStr(a.noiseFloorDb) + ' (tale: rundt ' + dbStr(a.loudDb) + ').' + (silent ? ' ' + Math.round(a.digitalSilenceShare * 100) + ' % av lyden er helt digital stillhet (lengste ' + VfFindings.fmtNum(a.longestSilenceS) + ' s).' : ''),
    betyr: silent ? 'Helt stille partier forekommer sjelden i opptak fra virkeligheten; de tyder på at lyden er klippet, støyfjernet eller laget digitalt.' : 'Det er hele tiden litt bakgrunnslyd (rom, trafikk, vind), slik det er i de fleste opptak.',
    betyrIkke: silent ? 'Manipulasjon. Støyfjerning i telefoner og apper kan også gi digital stillhet.' : 'At lyden er ekte. Bakgrunnsstøy kan legges på.' });
  if (a.jumps.length) out.push({ nivå: 'spor', vekt: 'behandlet', tittel: 'Brå sprang i lyden (' + a.jumps.length + ')', tekst: 'Ved ' + a.jumps.slice(0, 8).map(t => fmtT(t)).join(', ') + '.', betyr: 'Steder der lydkurven hopper brått i et ellers rolig parti — mulige klipp eller skjøter. Lytt og se på bildet akkurat der.', betyrIkke: 'At det er klippet. Klikk, plopp og s-lyder kan gi det samme.' });
  if (a.clippedShare > 0.001) out.push({ nivå: 'info', vekt: 'noytral', tittel: 'Lyden er overstyrt', tekst: (a.clippedShare * 100).toFixed(2).replace('.', ',') + ' % av samplene ligger på maks.', betyr: 'Opptaket var for høyt (vanlig ved vind eller rop nær mikrofonen).', betyrIkke: 'Noe om ekthet.' });
  return out;
}
function renderAudioBox() {
  $('audioBox').innerHTML = state.audioFindings.map(x => `<article class="vf-f"><div class="vf-f__head"><span class="vf-f__lvl">Lyd</span></div><h4>${esc(x.tittel)}</h4><p>${esc(x.tekst)}</p><p class="vf-f__b"><b>Betyr:</b> ${esc(x.betyr)}</p>${x.betyrIkke ? `<p class="vf-f__bi"><b>Betyr ikke:</b> ${esc(x.betyrIkke)}</p>` : ''}</article>`).join('');
}

// ============================================================
//  Leppesynk (MediaPipe Face Landmarker, lokalt)
// ============================================================
function resetLipsyncUi() {
  const p = $('lsPlot'), g = p.getContext('2d'); g.clearRect(0, 0, p.width, p.height);
  g.fillStyle = '#6E6E6E'; g.font = '14px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center';
  g.fillText('Grafen kommer her når du trykker «Analyser leppesynk».', p.width / 2, p.height / 2 - 8);
  g.fillText('Den viser hvor godt munnen følger talen.', p.width / 2, p.height / 2 + 14);
  const o = $('lsOverlay'); o.getContext('2d').clearRect(0, 0, o.width, o.height);
  $('lsNote').textContent = ''; $('lsVideo').removeAttribute('src');
}
$('lsBtn').addEventListener('click', () => runLipsync().catch(e => { console.error(e); setStatus('Leppesynk: ' + e.message, true); progress(null); state.busy = false; $('lsBtn').disabled = false; }));
async function runLipsync() {
  if (state.busy || state.kind !== 'video') return;
  if (!state.audio || !state.audio.envelope) { setStatus('Leppesynk krever lyd som kan leses.', true); return; }
  const st = await VfModels.status();
  if (!st.ready) {
    const ok = await window.faktiskDialog.confirm('Leppesynk bruker MediaPipe Face Landmarker (Google, Apache 2.0). Studio må laste ned modellfilene én gang (ca. ' + Math.round(st.mb) + ' MB fra jsDelivr og Google). Bare programfiler lastes ned — ingenting fra videoen sendes noe sted. Etterpå virker det uten nett. Laste ned nå?');
    if (!ok) return;
    state.busy = true; $('lsBtn').disabled = true;
    try { await VfModels.ensure((p, msg) => { progress(p); setStatus(msg); }); } finally { state.busy = false; $('lsBtn').disabled = false; progress(null); }
  }
  state.busy = true; $('lsBtn').disabled = true;
  try {
    setStatus('Starter ansiktsmodellen…');
    const lm = await VfModels.faceLandmarker();
    const fps = state.fps; const spanSel = $('lsSpan').value;
    const t0 = spanSel === 'all' ? 0 : state.t; const span = spanSel === 'all' ? state.duration : Math.min(+spanSel, state.duration - t0);
    if (span < 4) throw new Error((state.duration || 0) < 4 ? 'Klippet er for kort (trenger minst 4 s med tale).' : 'For kort utsnitt — gå lenger tilbake i klippet (trenger minst 4 s).');
    const v = $('lsVideo'); v.src = state.url; v.muted = true;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Videoen kunne ikke spilles')); });
    v.currentTime = t0; await new Promise(r => { v.onseeked = r; });
    const ov = $('lsOverlay'); ov.width = v.videoWidth; ov.height = v.videoHeight; const octx = ov.getContext('2d');
    const samples = []; let ts = 0, found = 0, total = 0; const win = { t: t0, n: 0 };
    // Slutt litt før siste bilde: når videoen er ferdig kommer det ingen nye bilder,
    // og requestVideoFrameCallback fyrer aldri igjen (hang på «44,38 s av 44,49 s»).
    const tEnd = Math.min(t0 + span, state.duration - 1.5 / fps);
    await new Promise((resolve) => {
      let doneFlag = false, lastFrame = performance.now();
      const finish = () => { if (doneFlag) return; doneFlag = true; clearInterval(guard); v.removeEventListener('ended', finish); v.pause(); resolve(); };
      v.addEventListener('ended', finish);
      // Vakthund: kommer det ikke nye bilder på 3 s (f.eks. pause, dekoderfeil), avslutt med det vi har
      const guard = setInterval(() => { if (performance.now() - lastFrame > 3000) finish(); }, 500);
      const step = (now, meta) => {
        if (doneFlag) return;
        lastFrame = performance.now();
        const mt = meta ? meta.mediaTime : v.currentTime;
        if (mt >= tEnd || v.ended) { finish(); return; }
        ts = Math.max(ts + 1, Math.round(now)); total++;
        const r = lm.detectForVideo(v, ts);
        octx.clearRect(0, 0, ov.width, ov.height);
        if (r.faceLandmarks && r.faceLandmarks.length) {
          const p = r.faceLandmarks[0]; const P = k => [p[k].x * ov.width, p[k].y * ov.height];
          const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
          samples.push({ t: mt, v: d(P(13), P(14)) / Math.max(1, d(P(33), P(263))) }); found++;
          octx.fillStyle = '#00E0FF'; for (const k of [13, 14, 61, 291, 0, 17, 33, 263]) { const q = P(k); octx.fillRect(q[0] - 3, q[1] - 3, 6, 6); }
        }
        // Hold tritt: hvis maskinen ikke rekker å måle hvert bilde, senkes avspillingsfarten
        // (målt i Electron uten GPU: bare 25 % av bildene ved 1×, og svakere måling).
        win.n++; if (mt - win.t >= 1) {
          const cov = win.n / Math.max(1, (mt - win.t) * fps);
          if (cov < 0.9) v.playbackRate = Math.max(0.1, v.playbackRate * Math.max(0.3, cov * 0.95));
          else if (cov > 0.98 && v.playbackRate < 1) v.playbackRate = Math.min(1, v.playbackRate * 1.15);
          win.t = mt; win.n = 0;
        }
        setStatus('Leppesynk: ' + fmtT(mt - t0) + ' av ' + fmtT(tEnd - t0) + (v.playbackRate < 0.99 ? ' (spilles av i ' + Math.round(v.playbackRate * 100) + ' % fart for å rekke hvert bilde)' : '')); progress(Math.min(1, (mt - t0) / (tEnd - t0)));
        v.requestVideoFrameCallback(step);
      };
      v.requestVideoFrameCallback(step);
      v.playbackRate = 1; v.play();
    });
    // til ett tall per videobilde
    const k0 = Math.floor(t0 * fps), k1 = Math.floor(tEnd * fps); const n = k1 - k0;
    const mouth = new Float32Array(n).fill(NaN);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const tc = (k0 + k + 0.5) / fps;
      while (j + 1 < samples.length && Math.abs(samples[j + 1].t - tc) <= Math.abs(samples[j].t - tc)) j++;
      if (samples[j] && Math.abs(samples[j].t - tc) <= 1 / fps) mouth[k] = samples[j].v;
    }
    let last = NaN; for (let k = 0; k < n; k++) { if (isNaN(mouth[k])) mouth[k] = last; else last = mouth[k]; }
    for (let k = n - 1; k >= 0; k--) { if (isNaN(mouth[k])) mouth[k] = last; else last = mouth[k]; }
    const covered = samples.length / Math.max(1, n);
    const env = state.audio.envelope.slice(k0, k1);
    const r = VfAudio.lipsync(mouth, env, fps);
    if (r.error) throw new Error(r.error);
    drawLipsyncPlot(r, fps);
    state.lsPlotUrl = $('lsPlot').toDataURL('image/png');
    state.lsFinding = lipsyncFinding(r, { t0, span, tEnd, faceShare: found / Math.max(1, total), covered: Math.min(1, covered) });
    $('lsNote').textContent = 'Målt ' + Math.round(Math.min(1, covered) * 100) + ' % av bildene, ansikt funnet i ' + Math.round(found / Math.max(1, total) * 100) + ' % av dem.';
    renderFindings();
    setStatus('Leppesynk ferdig: ' + state.lsFinding.tittel + '.');
  } finally { state.busy = false; $('lsBtn').disabled = false; progress(null); }
}
function lipsyncFinding(r, info) {
  const ms = Math.round(r.lagMs); const strong = r.best.r > Math.max(0.1, r.base95);
  const stable = r.windows.filter(w => Math.abs(w.lag - r.best.lag) <= 1).length / Math.max(1, r.windows.length);
  const base = { nivå: 'spor', kilde: 'leppesynk', tekst: 'Sterkest sammenheng ved ' + (ms === 0 ? '0 ms' : (ms < 0 ? 'munnen ' + (-ms) + ' ms før lyden' : 'lyden ' + ms + ' ms før munnen')) + ' (r = ' + r.best.r.toFixed(2).replace('.', ',') + '; med tilfeldig forskjøvet lyd blir beste r høyst ' + r.base95.toFixed(2).replace('.', ',') + ' i 95 % av forsøkene). ' + Math.round(stable * 100) + ' % av 4-sekundersvinduene gir samme forskyvning (±1 bilde). Utsnitt ' + fmtT(info.t0) + '–' + fmtT(info.tEnd) + ', målt ' + Math.round(info.covered * 100) + ' % av bildene, ansikt funnet i ' + Math.round(info.faceShare * 100) + ' % av dem.' };
  if (info.covered < 0.7) return Object.assign(base, { vekt: 'noytral', tittel: 'Leppesynk: for få bilder målt', betyr: 'Maskinen rakk bare å måle ' + Math.round(info.covered * 100) + ' % av bildene, så målingen er for grov.', betyrIkke: 'Noe om synk. Prøv igjen med et kortere utsnitt.' });
  if (info.faceShare < 0.6) return Object.assign(base, { vekt: 'noytral', tittel: 'Leppesynk: for lite ansikt å måle på', betyr: 'Munnen var ikke synlig eller ble ikke funnet i store deler av utsnittet.', betyrIkke: 'Noe om synk. Prøv et annet utsnitt der ansiktet ses forfra.' });
  if (!strong) return Object.assign(base, { vekt: 'noytral', tittel: 'Leppesynk: ingen tydelig sammenheng', betyr: 'Munnbevegelsene og talen følger ikke hverandre tydeligere enn tilfeldig. Det kan skyldes at den som snakker ikke er den som ses, musikk/støy, eller at munnen er liten i bildet.', betyrIkke: 'At lyden er lagt på eller falsk. Målingen er usikker for korte utsnitt og utydelige ansikter.' });
  if (Math.abs(r.best.lag) <= 2 && stable >= 0.5) return Object.assign(base, { vekt: 'noytral', tittel: 'Leppesynk: munn og tale følger hverandre', betyr: 'Lyd og munnbevegelser hører sammen i tid, slik de gjør i et vanlig opptak (munnen beveger seg gjerne litt før lyden kommer).', betyrIkke: 'At videoen er ekte. Dubbing, leppesynk-AI og helsyntetisk video kan også være i synk.' });
  if (Math.abs(r.best.lag) > 2 && stable >= 0.5) return Object.assign(base, { vekt: 'behandlet', tittel: 'Leppesynk: lyden kommer ca. ' + Math.abs(ms) + ' ms ' + (ms < 0 ? 'etter' : 'før') + ' munnen', betyr: 'Lyd og munn følger hverandre tydelig, men forskjøvet. Det skjer ved feil i eksport/opplasting, i livesendinger, eller når lyden er lagt på etterpå.', betyrIkke: 'Manipulasjon alene. Forskyvninger på et par hundre millisekunder er vanlige etter omkoding og strømming.' });
  return Object.assign(base, { vekt: 'behandlet', tittel: 'Leppesynk: forskyvningen varierer', betyr: 'Lyd og munn følger hverandre, men forskyvningen endrer seg gjennom utsnittet. Det kan tyde på at lyd og bilde er satt sammen av flere biter, eller at ansiktet beveger seg mye.', betyrIkke: 'Manipulasjon alene. Prøv et annet utsnitt der ansiktet er rolig og ses forfra.' });
}
function drawLipsyncPlot(r, fps) {
  const c = $('lsPlot'), g = c.getContext('2d'); const W = c.width, H = c.height, padL = 44, padB = 34, padT = 14, padR = 12;
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const xs = r.curve.map(p => p.lag); const minX = xs[0], maxX = xs[xs.length - 1];
  const maxY = Math.max(0.2, r.best.r * 1.15), minY = Math.min(-0.1, Math.min.apply(null, r.curve.map(p => p.r)));
  const X = l => padL + (l - minX) / (maxX - minX) * (W - padL - padR), Y = v => padT + (maxY - v) / (maxY - minY) * (H - padT - padB);
  g.fillStyle = 'rgba(110,110,110,0.18)'; g.fillRect(padL, Y(r.base95), W - padL - padR, Y(minY) - Y(r.base95));
  g.strokeStyle = '#ccc'; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(W - padR, Y(0)); g.moveTo(X(0), padT); g.lineTo(X(0), H - padB); g.stroke();
  g.strokeStyle = '#0050FC'; g.lineWidth = 2.5; g.beginPath(); r.curve.forEach((p, i) => { const x = X(p.lag), y = Y(p.r); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  g.fillStyle = '#0050FC'; g.beginPath(); g.arc(X(r.best.lag), Y(r.best.r), 5, 0, 7); g.fill();
  g.fillStyle = '#212121'; g.font = '12px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center';
  for (let l = Math.ceil(minX / 3) * 3; l <= maxX; l += 3) g.fillText(Math.round(l * 1000 / fps) + '', X(l), H - padB + 15);
  g.fillText('forskyvning i ms (negativ = munnen før lyden)', (W + padL) / 2, H - 4);
  g.textAlign = 'left'; g.fillStyle = '#6E6E6E'; g.fillText('grått felt: tilfeldig forskjøvet lyd (95 %)', padL + 6, Y(minY) - 6);
    [maxY, 0].forEach(v => g.fillText(v.toFixed(2).replace('.', ','), padL - 6, Y(v) + 4));
  g.textAlign = 'right'; g.fillStyle = '#0050FC'; g.fillText('r = ' + r.best.r.toFixed(2).replace('.', ',') + ' ved ' + Math.round(r.best.lag * 1000 / fps) + ' ms', W - padR - 4, padT + 12);
}

// ============================================================
//  Ekstra spor: JPEG, miniatyr, AI-størrelser, datoer
// ============================================================
function where(b) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return (cy < 0.34 ? 'øverst' : cy > 0.66 ? 'nederst' : 'midt') + (cx < 0.34 ? ' til venstre' : cx > 0.66 ? ' til høyre' : (cy < 0.34 || cy > 0.66 ? ' på midten' : ' i bildet')); }
async function extraAnalysis() {
  const out = [];
  const X = VfForensics;
  const hasCamera = !!(state.exif && (state.exif.Make || state.exif.Model));
  // JPEG-tabeller og markører
  if (state.c2pa.format === 'jpeg') {
    const u8 = new Uint8Array(await state.file.slice(0, Math.min(state.file.size, 4e6)).arrayBuffer());
    const j = X.jpegInfo(u8); state.jpeg = j;
    if (j && j.lum) {
      const parts = [j.standard ? 'Standard libjpeg-tabeller, kvalitet ' + j.lum.q : j.nearStandard ? 'Nesten standard libjpeg-tabeller, kvalitet ≈ ' + j.lum.q : 'Egne tabeller (ikke libjpeg), nærmest kvalitet ' + j.lum.q,
        j.subsampling ? 'fargeoppløsning ' + j.subsampling : '', j.progressive ? 'progressiv' : 'baseline',
        'markører: ' + (j.markers.join(', ') || 'ingen')];
      let betyr, vekt = 'noytral';
      if (j.standard || j.nearStandard) {
        betyr = 'Bildet ble sist lagret av et program som bruker standardtabellene fra libjpeg. Det gjør de fleste nettjenester, meldingsapper, nettlesere, GIMP og ffmpeg. Kameraer og telefoner bruker oftest egne tabeller.';
        if (hasCamera) { vekt = 'behandlet'; betyr += ' Fila har likevel kameradata, så den er trolig lagret på nytt etter opptak og har beholdt EXIF (vanlig ved redigering).'; }
      } else betyr = 'Tabellene er ikke libjpeg-standard. Det er typisk for kamera- og telefonfastvare og for Adobe-programmer.';
      if (j.adobe) betyr += ' Adobe-markøren (APP14) tyder på at et Adobe-program har lagret bildet.';
      out.push({ nivå: 'spor', vekt, tittel: 'JPEG-lagring: ' + (j.standard || j.nearStandard ? 'standardtabeller (kvalitet ' + j.lum.q + ')' : 'egne tabeller'), tekst: parts.filter(Boolean).join(', ') + '.', betyr, betyrIkke: 'At innholdet er endret. Hver opplasting eller deling kan lagre bildet på nytt med andre tabeller.' });
    }
  }
  // EXIF-miniatyr mot hovedbildet
  if (state.kind === 'image' && window.exifr && window.exifr.thumbnail && state.imageBitmap) {
    try {
      const tb = await window.exifr.thumbnail(state.file);
      if (tb && tb.length) {
        const tBmp = await createImageBitmap(new Blob([tb], { type: 'image/jpeg' }));
        const tc = document.createElement('canvas'); tc.width = tBmp.width; tc.height = tBmp.height; tc.getContext('2d').drawImage(tBmp, 0, 0);
        const box = X.trimBlack(tc.getContext('2d').getImageData(0, 0, tc.width, tc.height));
        const crop = tc.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
        const thumbAspect = box.w / box.h; const variants = []; const main = state.imageBitmap; let aspectOk = false;
        for (const rot of [0, 90, 180, 270]) {
          const mw = rot % 180 ? main.height : main.width, mh = rot % 180 ? main.width : main.height;
          if (Math.abs(mw / mh - thumbAspect) / thumbAspect > 0.06) continue; aspectOk = true;
          const c = document.createElement('canvas'); c.width = box.w; c.height = box.h; const g = c.getContext('2d');
          g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180);
          const dw = rot % 180 ? c.height : c.width, dh = rot % 180 ? c.width : c.height; g.drawImage(main, -dw / 2, -dh / 2, dw, dh);
          const v = g.getImageData(0, 0, c.width, c.height); v.rot = rot; variants.push(v);
        }
        const cmp = aspectOk ? X.compareThumb(crop, variants) : { verdict: 'utsnitt', diff: NaN };
        state.thumb = { width: tBmp.width, height: tBmp.height, cmp, url: tc.toDataURL('image/jpeg', 0.9) };
        const T = {
          lik: ['Miniatyren i EXIF stemmer med bildet', 'noytral', 'Den lille kopien kameraet la i fila, viser det samme som hovedbildet.', 'At bildet er uredigert. Mange redigeringsprogrammer lager ny miniatyr når de lagrer.'],
          usikker: ['Miniatyren i EXIF ligner bildet, men ikke helt', 'behandlet', 'Små forskjeller kan komme av farge- eller lysjustering etter opptak — eller av at miniatyren er laget med andre innstillinger.', 'Manipulasjon. Se på miniatyren og bildet side om side.'],
          ulik: ['Miniatyren i EXIF viser noe annet enn bildet', 'behandlet', 'Hovedbildet er endret etter at miniatyren ble laget, men miniatyren er beholdt. Det er et klassisk spor etter redigering — miniatyren kan vise hvordan bildet så ut før.', 'Hva som er endret, eller om endringen er vesentlig (beskjæring og fargejustering gir også forskjell).'],
          utsnitt: ['Miniatyren i EXIF har et annet utsnitt enn bildet', 'behandlet', 'Sideforholdet er forskjellig, så bildet er trolig beskåret etter opptak mens miniatyren er beholdt.', 'Manipulasjon. Beskjæring er vanlig og ofte uskyldig.'],
        }[cmp.verdict];
        out.push({ nivå: 'spor', vekt: T[1], tittel: T[0], tekst: 'Miniatyr ' + tBmp.width + '×' + tBmp.height + (isFinite(cmp.diff) ? ', avvik ' + cmp.diff.toFixed(1).replace('.', ',') + ' gråtrinn i snitt, størst ' + cmp.blockMax.toFixed(0) + ' i ett område' + (cmp.local && cmp.block ? ' (' + where(cmp.block) + ')' : '') + (cmp.rot ? ', vendt ' + cmp.rot + '°' : '') : '') + '. Miniatyren er lagt til under Bilder i rapporten.', betyr: T[2], betyrIkke: T[3] });
        state.shotsAuto = [{ dataUrl: state.thumb.url, label: 'EXIF-miniatyr (' + tBmp.width + '×' + tBmp.height + ')', note: '', explain: 'Den lille kopien som lå inne i fila. Sammenlign med hovedbildet.' }];
      }
    } catch (e) { console.warn('miniatyr', e); }
  }
  // AI-størrelser og -lengder
  const v = state.video && state.video.tracks.find(t => t.handler === 'vide');
  const k = (state.video && state.video.keys) || {};
  const hints = X.aiSizeHint({ kind: state.kind, width: state.imageBitmap ? state.imageBitmap.width : 0, height: state.imageBitmap ? state.imageBitmap.height : 0, hasCamera, format: state.c2pa.format, duration: state.duration, hasAudio: !!(state.video && state.video.tracks.some(t => t.handler === 'soun')), hasDevice: !!(k['com.apple.quicktime.make'] || k['com.apple.quicktime.model']) });
  if (hints.length) out.push({ nivå: 'spor', vekt: 'ai', tittel: 'Typisk for AI-verktøy: ' + hints[0].split(' er ')[0].split(' (')[0], tekst: hints.join('; ') + '.', betyr: 'Kombinasjonen ligner det AI-verktøy leverer. Det er et svakt hint, men verdt å følge opp med de andre testene.', betyrIkke: 'At fila er AI. Mange vanlige bilder og klipp har slike størrelser og lengder.' });
  state.extraFindings = out;
  // Tidslinje
  state.tl = X.timeline({ exif: state.exif, xmp: state.xmp, video: state.video, fileModified: new Date(state.file.lastModified) });
  state.tidFindings = timelineFindings(state.tl);
  renderTimeline(); prefillTid();
  renderFindings();
}
function timelineFindings(tl) {
  const out = [];
  const TXT = {
    framtid: ['Dato i framtiden', 'behandlet', 'En klokke var feilstilt, eller datoen er skrevet inn for hånd.', 'Manipulasjon i seg selv.'],
    endret: ['Lagret på nytt etter opptak', 'behandlet', 'Fila er åpnet og lagret i et program etter at den ble tatt opp.', 'Hva som er endret. Rotering, beskjæring og eksport gir også ny endringstid.'],
    uenige: ['Tidspunktene i fila er uenige', 'behandlet', 'To felt som begge skal vise opptakstid, viser ulik tid. Det kan komme av redigering, feil tidssone eller at metadata er kopiert fra en annen fil.', 'Manipulasjon alene. Hele timer forskjell skyldes ofte bare tidssone.'],
    nullstilt: ['Opprettelsestiden i videoen er tom', 'noytral', 'Programmet som laget fila, satte ikke opptakstid. Vanlig for eksporter og nedlastinger.', 'At videoen er falsk.'],
  };
  for (const n of tl.notes) { const t = TXT[n.type]; if (t) out.push({ nivå: 'spor', vekt: t[1], tittel: t[0], tekst: n.text + '.', betyr: t[2], betyrIkke: t[3] }); }
  if (tl.source) {
    const big = Math.abs(tl.source.diffMs) > 36 * 3600e3;
    out.push({ nivå: 'spor', vekt: big ? 'behandlet' : 'noytral', tittel: big ? 'Kildens tidspunkt stemmer ikke med fila' : 'Kildens tidspunkt passer med fila', tekst: tl.source.text + '.', betyr: big ? 'Enten er tidspunktet feil, eller fila er eldre/nyere enn det kilden sier. Følg opp med kilden.' : 'Tidspunktet kilden oppgir, ligger nær tiden i metadata.', betyrIkke: big ? 'At kilden lyver. Metadata kan være feil (feilstilt klokke, tidssone, kopiert fil).' : 'Bekreftelse. Metadata kan endres, og tidssoner mangler ofte i EXIF.' });
  }
  return out;
}
function renderTimeline() {
  const tl = state.tl; if (!tl) return;
  $('timelineBox').innerHTML = tl.items.length ? `<table class="vf-tl">${tl.items.map(i => `<tr><th>${esc(i.label)}</th><td>${i.date ? esc(i.date.toLocaleString('nb-NO')) + ' <span class="vf-tl__note">(' + esc(i.date.toISOString().replace('T', ' ').slice(0, 19)) + ' UTC)</span>' : '—'}${i.note ? '<div class="vf-tl__note">' + esc(i.note) + '</div>' : ''}</td></tr>`).join('')}</table>` : '<p class="vf-muted vf-muted--dark">Fant ingen tidspunkter i fila.</p>';
}

// ============================================================
//  Sted og tid: sola
// ============================================================
function metaPlace() {
  const f = allFindings().find(x => x.kart); return f ? f.kart : null;
}
function prefillTid() {
  const cap = state.tl && state.tl.capture; const ll = metaPlace();
  const tzMin = -new Date().getTimezoneOffset(); $('tzInput').value = String(tzMin / 60);
  if (cap) { const d = new Date(cap.date.getTime() + tzMin * 60000); $('tidInput').value = d.toISOString().slice(0, 16); } else $('tidInput').value = '';
  if (ll) { $('latInput').value = ll[0].toFixed(5); $('lonInput').value = ll[1].toFixed(5); } else { $('latInput').value = ''; $('lonInput').value = ''; }
  $('srcChk').checked = false;
  $('tidNote').textContent = (cap ? 'Tid fra fila: ' + cap.label + '. ' : 'Fant ingen opptakstid i fila — skriv inn det kilden sier. ') + (ll ? 'Sted fra fila.' : 'Fant ingen posisjon i fila — skriv inn koordinater (f.eks. fra kart).');
  drawSun(null);
}
$('useMetaBtn').addEventListener('click', prefillTid);
function readTid() {
  const s = $('tidInput').value; if (!s) return null; const tz = parseFloat($('tzInput').value || '0');
  const [d, t] = s.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(Y, M - 1, D, h, mi) - tz * 3600e3);
}
$('sunBtn').addEventListener('click', () => {
  const when = readTid(); const lat = parseFloat($('latInput').value), lon = parseFloat($('lonInput').value);
  if (!when) { setStatus('Skriv inn tidspunkt.', true); return; }
  if ($('srcChk').checked) {
    state.tl = VfForensics.timeline({ exif: state.exif, xmp: state.xmp, video: state.video, fileModified: new Date(state.file.lastModified), sourceTime: when });
    state.tidFindings = timelineFindings(state.tl); renderFindings();
  }
  if (!isFinite(lat) || !isFinite(lon)) { $('sunOut').innerHTML = '<p>Skriv inn bredde- og lengdegrad for å regne ut sola.</p>'; drawSun(null); return; }
  const r = VfForensics.sun(when, lat, lon); drawSun(r);
  const C = VfForensics.compass; const f = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
  $('sunOut').innerHTML = r.altitude <= 0
    ? `<b>Sola er under horisonten</b> (${f(r.altitude)}°). Det er natt eller skumring på stedet${r.altitude > -6 ? ' (borgerlig skumring: fortsatt lyst, men ingen direkte sol eller skarpe skygger)' : ''}.`
    : `<b>Solhøyde ${f(r.altitude)}°, retning ${Math.round(r.azimuth)}° (${C(r.azimuth)})</b><br>Skyggene peker mot ${Math.round(r.shadowAzimuth)}° (${C(r.shadowAzimuth)}). En 1 m høy stolpe kaster ${r.shadowPerMeter > 50 ? 'svært lang' : f(r.shadowPerMeter) + ' m lang'} skygge.<br><span class="vf-muted vf-muted--dark">Finn nord i bildet (kart/Street View) og sjekk at skyggene peker riktig vei og har omtrent riktig lengde.</span>`;
  state.sunResult = { when, lat, lon, r };
  const sf = { nivå: 'info', vekt: 'noytral', tittel: r.altitude > 0 ? 'Sola: ' + f(r.altitude) + '° høyt i ' + C(r.azimuth) : 'Sola er under horisonten', tekst: when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC på ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + (r.altitude > 0 ? '. Skygger mot ' + C(r.shadowAzimuth) + ', ' + (r.shadowPerMeter > 50 ? 'svært lange' : f(r.shadowPerMeter) + ' m per meter høyde') : '') + '.', betyr: 'Slik skal lys og skygger se ut hvis tid og sted stemmer.', betyrIkke: 'Noe før du har sammenlignet med bildet. Overskyet vær gir ingen tydelige skygger.' };
  state.tidFindings = state.tidFindings.filter(x => !/^Sola/.test(x.tittel)).concat([sf]); renderFindings();
});
function drawSun(r) {
  const c = $('sunCanvas'), g = c.getContext('2d'), W = c.width, cx = W / 2, cy = W / 2, R = W / 2 - 28;
  g.clearRect(0, 0, W, W); g.fillStyle = '#F6F6F6'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  g.strokeStyle = '#cfcfcf'; g.lineWidth = 1; [R * 2 / 3, R / 3].forEach(rr => { g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.stroke(); });
  g.fillStyle = '#212121'; g.font = 'bold 14px -apple-system, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [['N', 0], ['Ø', 90], ['S', 180], ['V', 270]].forEach(([t, a]) => { const q = a * Math.PI / 180; g.fillText(t, cx + Math.sin(q) * (R + 14), cy - Math.cos(q) * (R + 14)); });
  if (!r) return;
  const at = (az, len) => { const q = az * Math.PI / 180; return [cx + Math.sin(q) * len, cy - Math.cos(q) * len]; };
  if (r.altitude > 0) {
    const sl = Math.min(R, R * Math.min(1, r.shadowPerMeter / 3)); const [sx, sy] = at(r.shadowAzimuth, sl);
    g.strokeStyle = '#555'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(sx, sy); g.stroke();
    g.fillStyle = '#555'; g.font = '12px -apple-system, Helvetica, sans-serif'; const [lx, ly] = at(r.shadowAzimuth, sl + 14); g.fillText('skygge', lx, ly);
  }
  const elev = Math.max(0, r.altitude); const [px, py] = at(r.azimuth, R * (1 - elev / 90));
  g.fillStyle = r.altitude > 0 ? '#FFB000' : '#9AA0AA'; g.beginPath(); g.arc(px, py, 13, 0, 7); g.fill();
  g.fillStyle = '#212121'; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();
}

// ============================================================
//  Tekst i bildet (Apple Vision via Studio)
// ============================================================
$('ocrBtn').addEventListener('click', async () => {
  if (state.busy || !state.file) return;
  if (typeof F.skjermarkivAnalyze !== 'function' || typeof F.bevisPathForFile !== 'function') { $('ocrNote').textContent = 'Denne Studio-versjonen kan ikke lese tekst for pluginen (krever Studio 0.7.13 med Skjermarkiv).'; return; }
  const absPath = F.bevisPathForFile(state.file);
  if (!absPath) { $('ocrNote').textContent = 'Fant ikke fila på disken. Dra den inn fra Finder i stedet for fra en nettleser.'; return; }
  state.busy = true; $('ocrBtn').disabled = true; $('ocrNote').textContent = 'Leser tekst… (kan ta et halvt minutt)'; setStatus('Leser tekst med Apple Vision…');
  try {
    const r = await F.skjermarkivAnalyze({ absPath, ocr: true, maxFrames: 24 });
    if (!r || !r.ok) throw new Error((r && r.error) || 'ukjent feil');
    if (r.ocrInfo && r.ocrInfo.error) throw new Error(r.ocrInfo.error);
    const frames = r.kind === 'video' ? r.frames : [{ t: 0, text: r.text || '', src: r.thumb }];
    const tot = VfForensics.textOverTime(frames);
    renderOcr(frames, tot);
    state.ocrFinding = ocrFinding(tot, r.kind);
    renderFindings(); setStatus('Tekstlesing ferdig.');
    $('ocrNote').textContent = frames.length + ' bilde' + (frames.length > 1 ? 'r' : '') + ' lest, tekst i ' + tot.framesWithText + '.';
  } catch (e) { $('ocrNote').textContent = 'Kunne ikke lese tekst: ' + e.message; setStatus('Tekstlesing feilet.', true); }
  finally { state.busy = false; $('ocrBtn').disabled = false; }
});
function renderOcr(frames, tot) {
  const morphSet = new Set(tot.morph.flatMap(m => m.variants.map(v => v.text)));
  const hl = txt => esc(txt).split('\n').map(line => { const n = line.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim(); return morphSet.has(n) ? '<mark class="vf-morph">' + line + '</mark>' : line; }).join('\n');
  const sum = (tot.morph.length ? '<div class="vf-card"><h4>Tekst som endrer seg mellom bildene</h4>' + tot.morph.map(m => '<p>«' + esc(m.text) + '» (' + m.frames.length + ' bilder) → ' + m.variants.map(v => '«<mark class="vf-morph">' + esc(v.text) + '</mark>» (' + v.frames.length + ')').join(', ') + '</p>').join('') + '</div>' : '')
    + (tot.stable.length ? '<div class="vf-card"><h4>Tekst som går igjen uendret</h4><p>' + tot.stable.map(x => '«' + esc(x.text) + '» (' + x.frames.length + ' bilder)').join(', ') + '</p></div>' : '');
  $('ocrOut').innerHTML = sum + '<div class="vf-ocr">' + frames.map(f => `<div class="vf-ocr__f">${f.src ? `<img src="${f.src}" alt="">` : ''}<span>${fmtT(f.t || 0)}</span><pre>${f.text ? hl(f.text) : '<i>ingen tekst</i>'}</pre></div>`).join('') + '</div>';
}
function ocrFinding(tot, kind) {
  if (!tot.framesWithText) return { nivå: 'info', vekt: 'noytral', tittel: 'Ingen lesbar tekst i bildene', tekst: 'Apple Vision fant ikke tekst i ' + tot.frames + ' bilde' + (tot.frames > 1 ? 'r' : '') + '.', betyr: 'Det er ingen skilt eller tekst å kontrollere — eller den er for liten/uskarp.', betyrIkke: 'Noe om ekthet.' };
  if (kind !== 'video') return { nivå: 'info', vekt: 'noytral', tittel: 'Tekst lest i bildet', tekst: 'Se fanen «Tekst i bildet».', betyr: 'Teksten kan brukes til å finne stedet eller sjekke om skilt og navn finnes.', betyrIkke: 'Noe om ekthet alene. AI-bilder kan ha både ekte og forvrengt tekst.' };
  if (tot.morph.length) return { nivå: 'spor', vekt: 'ai', tittel: 'Tekst som endrer seg mellom bildene (' + tot.morph.length + ')', tekst: tot.morph.slice(0, 3).map(m => '«' + m.text + '» → «' + m.variants[0].text + '»').join('; ') + '.', betyr: 'Bokstaver som skifter fra bilde til bilde er typisk for AI-generert video. Se på bildene i fanen «Tekst i bildet».', betyrIkke: 'At videoen er AI: tekstlesingen feiler lett på uskarpe, skrå eller delvis skjulte skilt. Se selv.' };
  return { nivå: 'spor', vekt: 'noytral', tittel: 'Teksten i bildet er stabil', tekst: tot.stable.length ? 'Går igjen uendret: ' + tot.stable.slice(0, 4).map(x => '«' + x.text + '»').join(', ') + '.' : 'Tekst lest i ' + tot.framesWithText + ' bilder.', betyr: 'Tekst som står stille i mange bilder er det man venter i et vanlig opptak.', betyrIkke: 'At videoen er ekte. Nyere AI-modeller kan holde tekst stabil.' };
}

// ============================================================
//  Bildesøk
// ============================================================
function currentImageBlob() { return new Promise(res => scaledCanvas(els.canvas, 2400).toBlob(res, 'image/png')); }
$('copyImgBtn').addEventListener('click', async () => {
  try { const b = await currentImageBlob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); setStatus('Bildet er kopiert. Lim det inn (⌘V) i søketjenesten.'); }
  catch (e) { setStatus(/focus/i.test(e.message || '') ? 'Kunne ikke kopiere bildet fordi Studio-vinduet ikke var aktivt. Klikk i vinduet og prøv igjen.' : 'Kunne ikke kopiere bildet: ' + e.message + '. Bruk «Lagre bildet som vises…».', true); }
});
$('dlImgBtn').addEventListener('click', async () => {
  const b = await currentImageBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b);
  a.download = state.file.name.replace(/\.[^.]+$/, '') + (state.kind === 'video' ? '_' + fmtT(state.t).replace(/ /g, '').replace(/,/g, '-') : '') + '.png'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
});
document.querySelectorAll('.vf-search').forEach(b => b.addEventListener('click', async () => {
  const ok = await window.faktiskDialog.confirm('Åpne ' + b.textContent + ' i nettleseren? Når du limer inn eller laster opp bildet der, sendes det til tjenesten. Ikke gjør det med upublisert eller kildesensitivt materiale uten at det er avklart.');
  if (ok) F.openExternal(b.dataset.url);
}));

// ============================================================
//  Parallakse
// ============================================================
async function ensureModels() {
  const st = await VfModels.status(); if (st.ready) return true;
  const ok = await window.faktiskDialog.confirm('Leppesynk og parallakse bruker MediaPipe (Google, Apache 2.0). Studio må laste ned modellfilene én gang (ca. ' + Math.round(st.mb) + ' MB fra jsDelivr og Google). Bare programfiler lastes ned — ingenting fra fila sendes noe sted. Etterpå virker det uten nett. Laste ned nå?');
  if (!ok) return false;
  await VfModels.ensure((p, msg) => { progress(p); setStatus(msg); }); progress(null); return true;
}
const PAR_W = 1280, PAR_GAP = 2.5;
async function parallaxPair(n) {
  const n2 = Math.min(Math.floor(state.duration * state.fps) - 2, n + Math.round(PAR_GAP * state.fps));
  if (n2 - n < state.fps * 0.5) return null;
  const a = scaledCanvas(await grab(centerOf(n)), PAR_W), b = scaledCanvas(await grab(centerOf(n2)), PAR_W);
  const mask = await VfModels.personMask(a);
  const A = toImg(a), B = toImg(b); const s = VfVisual.estimateShift(B, A);
  const r = VfParallax.analyze(A, B, mask, { init: [s.dx, s.dy], maxPoints: 800 });
  r.t1 = n / state.fps; r.t2 = n2 / state.fps; r.canvas = a; r.mask = mask; r.scale = PAR_W / Math.max(a.width, 1);
  return r;
}
async function renderParallax() {
  if (!(await ensureModels())) { paint(state.frame.canvas); setStatus('Parallakse trenger modellfilene.', true); return; }
  state.busy = true; setStatus('Følger punkter i bakgrunnen…');
  try {
    const r = await parallaxPair(state.n); await seek(centerOf(state.n));
    if (!r) { paint(state.frame.canvas); setStatus('For nær slutten — gå lenger tilbake i klippet.', true); return; }
    const c = document.createElement('canvas'); c.width = r.canvas.width; c.height = r.canvas.height; const g = c.getContext('2d');
    g.drawImage(r.canvas, 0, 0);
    // demp personen
    const id = g.getImageData(0, 0, c.width, c.height); for (let i = 0; i < r.mask.length; i++) if (r.mask[i]) { id.data[i * 4] *= 0.35; id.data[i * 4 + 1] *= 0.35; id.data[i * 4 + 2] *= 0.35; } g.putImageData(id, 0, 0);
    VfParallax.overlay(g, r, 1); paint(c);
    state.par = r; state.parFinding = parallaxFinding([r]); renderFindings();
    state.viewInfo = fmtT(r.t1) + ' → ' + fmtT(r.t2);
    setStatus(r.error ? 'Parallakse: ' + r.error : 'Parallakse ' + state.viewInfo + ': ' + (r.depthCells ? r.depthCells + ' område' + (r.depthCells > 1 ? 'r' : '') + ' med dybde' : 'ingen målbar dybde') + ' (' + r.tracked + ' punkter, kamerabevegelse ' + Math.round(r.motion || 0) + ' px).');
  } catch (e) { console.error(e); setStatus('Parallakse: ' + e.message, true); }
  finally { state.busy = false; progress(null); }
}
$('parScanBtn').addEventListener('click', async () => {
  if (state.busy || state.kind !== 'video') return;
  if (!(await ensureModels())) return;
  state.busy = true; const res = [];
  try {
    const N = 10, last = Math.floor((state.duration - PAR_GAP - 0.3) * state.fps);
    for (let i = 0; i < N; i++) {
      const n = Math.max(0, Math.round(last * i / Math.max(1, N - 1)));
      setStatus('Parallakse: bildepar ' + (i + 1) + ' av ' + N + '…'); progress(i / N);
      const r = await parallaxPair(n); if (r) res.push(r);
    }
    await seek(centerOf(state.n));
    state.parFinding = parallaxFinding(res); renderFindings();
    setStatus('Parallakse over klippet: ' + state.parFinding.tittel + '.');
  } catch (e) { console.error(e); setStatus('Parallakse: ' + e.message, true); }
  finally { state.busy = false; progress(null); }
});
function parallaxFinding(list) {
  const ok = list.filter(r => !r.error); const withDepth = ok.filter(r => r.depthCells > 0); const moved = ok.filter(r => (r.motion || 0) >= 20);
  const one = list.length === 1;
  const where = withDepth.map(r => fmtT(r.t1) + '–' + fmtT(r.t2) + ' (' + r.depthCells + ' område' + (r.depthCells > 1 ? 'r' : '') + ', inntil ' + r.maxCellShift.toFixed(1).replace('.', ',') + ' px)').join('; ');
  const base = { nivå: 'spor', tekst: (one ? 'Bildeparet ' + fmtT(list[0].t1) + '–' + fmtT(list[0].t2) : ok.length + ' bildepar over klippet') + ': ' + (withDepth.length ? 'dybde i ' + (one ? 'paret' : withDepth.length + ' av ' + ok.length) + ' — ' + where : 'ingen målbar dybde') + '. ' + (ok.length ? 'Kamerabevegelse ' + ok.map(r => Math.round(r.motion || 0)).join(', ') + ' px (av 1280).' : '') + (list.length - ok.length ? ' ' + (list.length - ok.length) + ' par kunne ikke måles (for få punkter).' : '') };
  if (!ok.length) return Object.assign(base, { vekt: 'noytral', tittel: 'Parallakse: kunne ikke måles', betyr: 'For få punkter i bakgrunnen å følge (ensfarget flate, mørkt eller uskarpt).', betyrIkke: 'Noe om bakgrunnen.' });
  if (withDepth.length) return Object.assign(base, { vekt: 'opptak', tittel: 'Parallakse: bakgrunnen har dybde', betyr: 'Deler av bakgrunnen flytter seg annerledes enn resten når kameraet beveger seg, slik et ekte rom eller en gate gjør. Et stillbilde som er zoomet eller panorert, gjør ikke det.', betyrIkke: 'At videoen er ekte: personen kan fortsatt være lagt oppå en ekte bakgrunnsvideo, og 3D-gjengivelse eller AI-video kan også ha dybde.' });
  return Object.assign(base, { vekt: 'noytral', tittel: 'Parallakse: ingen målbar dybde', betyr: moved.length ? 'Bakgrunnen beveget seg som ett flatt plan selv der kameraet flyttet seg. Det passer med et flatt bilde, men også med en flat fasade, et fjernt motiv eller et kamera som bare dreies.' : 'Kameraet beveget seg for lite til at dybde kan måles. Prøv «Sjekk hele klippet» eller et parti der kameraet flytter seg mer.', betyrIkke: 'At bakgrunnen er falsk eller et stillbilde. Dette er ikke bevis i noen retning.' });
}

// ============================================================
//  Faner
// ============================================================
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => { if (typeof stopPlay === 'function') stopPlay();
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('is-on', x === b));
  ['funn', 'bilder', 'lyd', 'tid', 'tekst', 'meta'].forEach(t => { $('panel-' + t).style.display = t === b.dataset.tab ? '' : 'none'; });
}));

// ============================================================
//  Rapport
// ============================================================
$('addShotBtn').addEventListener('click', async () => {
  if (!state.frame) return;
  const note = await window.faktiskDialog.prompt('Kommentar til bildet (valgfritt):', '');
  if (note === null) return;
  const src = scaledCanvas(els.canvas, 1600);
  const e = EXPLAIN[state.mode];
  state.shots.push({ dataUrl: src.toDataURL('image/jpeg', 0.86), label: e.tittel + (state.kind === 'video' ? ' · ' + fmtT(state.t) : '') + (state.viewInfo ? ' · ' + state.viewInfo : ''), note: note || '', explain: 'Betyr: ' + e.betyr + ' Betyr ikke: ' + e.betyrIkke });
  renderShots(); setStatus('Lagt til i rapporten (' + state.shots.length + ' bilde' + (state.shots.length > 1 ? 'r' : '') + ').');
});
function renderShots() {
  els.shotList.innerHTML = state.shots.map((s, i) => `<div class="vf-shot"><img src="${s.dataUrl}" alt=""><span>${esc(s.label)}</span><button type="button" data-i="${i}" title="Fjern">×</button></div>`).join('');
  els.shotList.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.shots.splice(+b.dataset.i, 1); renderShots(); }));
}
function c2paDetail() { const s = metaSections().find(x => /^Content Credentials/.test(x[0])); return s ? s[1] : null; }
function metaTable() { const out = {}; for (const [t, d] of metaSections()) { if (/^Content Credentials/.test(t)) continue; for (const k of Object.keys(d)) if (d[k] !== '' && d[k] != null) out[t + ' · ' + k] = d[k]; } return out; }
$('saveReportBtn').addEventListener('click', async () => {
  if (!state.file) return;
  const shots0 = (state.shotsAuto || []).concat(state.shots);
  const shots = state.lsPlotUrl ? shots0.concat([{ dataUrl: state.lsPlotUrl, label: 'Leppesynk — sammenheng mellom munn og tale', note: '', explain: 'Blå kurve: hvor godt munnens åpning følger lydstyrken i talen ved ulike forskyvninger. Grått felt: det tilfeldig forskjøvet lyd gir. En tydelig topp over det grå feltet nær 0 betyr at lyd og munn følger hverandre.' }]) : shots0;
  const html = VfReport.build({ file: { name: state.file.name, facts: fileFacts() }, findings: allFindings(), c2paDetail: c2paDetail(), metaTable: metaTable(), shots, note: els.note.value.trim(), pluginVersion: PLUGIN_VERSION });
  const base = state.file.name.replace(/\.[^.]+$/, '');
  const savePath = await F.saveDialog({ title: 'Lagre verifiseringsrapport', defaultPath: base + '.verifisering.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (!savePath) return;
  const r = await F.writeTextFile({ savePath, content: html });
  if (r && r.ok) { setStatus('Rapport lagret.'); if (F.revealInFinder) F.revealInFinder(savePath); }
  else setStatus('Kunne ikke lagre: ' + (r && r.error), true);
});
$('copyBtn').addEventListener('click', async () => {
  const lines = ['Verifisering – ' + state.file.name, 'Ingen samlet vurdering: hvert funn står for seg.', ''];
  for (const x of allFindings()) lines.push('• ' + x.tittel + ': ' + x.tekst, '  Betyr: ' + x.betyr, '  Betyr ikke: ' + x.betyrIkke, '');
  if (state.sha256) lines.push('SHA-256: ' + state.sha256);
  await F.copyToClipboard(lines.join('\n')); setStatus('Funnene er kopiert.');
});
$('ccBtn').addEventListener('click', async () => {
  const ok = await window.faktiskDialog.confirm('Åpne contentcredentials.org/verify i nettleseren? Der laster du opp fila selv, og den sendes da til Content Authenticity Initiative (Adobe). Ikke gjør det med upublisert eller kildesensitivt materiale uten at det er avklart.');
  if (ok) F.openExternal('https://contentcredentials.org/verify');
});
$('synthBtn').addEventListener('click', async () => {
  const ok = await window.faktiskDialog.confirm('Åpne synthid.com i nettleseren? Der laster du opp fila selv, og den sendes da til Google. SynthID finner bare vannmerker fra Google og partnerne deres (bl.a. OpenAI-bilder og NVIDIA). «Ikke funnet» betyr ikke at fila er ekte. Ikke last opp upublisert eller kildesensitivt materiale uten at det er avklart.');
  if (ok) F.openExternal('https://synthid.com');
});

$('backBtn').addEventListener('click', () => F.goHome());
$('fullscreenBtn').addEventListener('click', () => F.toggleFullscreen());
setMode('bilde', true);
resetLipsyncUi();
