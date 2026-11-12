// Faktisk Studio · Teksting (økt 2: redigering + linjedeling + eksport)
//
// 0.7.0: tekstboksene deles opp på ordnivå (deling.js) — brudd ved punktum,
// komma og pauser i stedet for der plassen tar slutt — og et valgfritt
// manus gir riktig stavemåte og tegnsetting. Avvik fra manus markeres gult.
//
// Transkriberer tale med NB-Whisper (lokalt via Studios transcribe-IPC),
// lar deg redigere segmentene direkte, balanserer teksten på de tre
// linjene i Faktisk-tekstingsmalen, og eksporterer FCPXML («Faktisk
// titler»-templaten) og SRT.
//
// Redigering:
//   - Klikk i teksten og skriv
//   - Enter = del segmentet ved markøren (tiden fordeles proporsjonalt)
//   - Rettetast først i segmentet = flett med forrige
//   - ×-knapp = slett segmentet

const PLUGIN_ID = 'teksting';

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
  localFileBtn:  document.getElementById('localFileBtn'),
  openLabrador:  document.getElementById('openLabradorBtn'),
  status:        document.getElementById('status'),
  back:          document.getElementById('backBtn'),
  full:          document.getElementById('fullscreenBtn'),

  video:         document.getElementById('videoEl'),
  canvasEmpty:   document.getElementById('canvasEmpty'),
  captionOverlay: document.getElementById('captionOverlay'),

  modelBox:      document.getElementById('modelBox'),
  langSelect:    document.getElementById('langSelect'),
  modelSelect:   document.getElementById('modelSelect'),
  modelDesc:     document.getElementById('modelDesc'),
  addSegBtn:     document.getElementById('addSegBtn'),
  resegBtn:      document.getElementById('resegBtn'),
  manusText:     document.getElementById('manusText'),
  applyManusBtn: document.getElementById('applyManusBtn'),
  manusDesc:     document.getElementById('manusDesc'),

  transcribeBtn: document.getElementById('transcribeBtn'),
  exportFcpBtn:  document.getElementById('exportFcpBtn'),
  exportSrtBtn:  document.getElementById('exportSrtBtn'),
  exportVidBtn:  document.getElementById('exportVidBtn'),
  progress:      document.getElementById('progress'),
  progressBar:   document.getElementById('progressBar'),
  progressNote:  document.getElementById('progressNote'),

  segmentsList:  document.getElementById('segmentsList'),
  segmentsEmpty: document.getElementById('segmentsEmpty'),
  segmentsMeta:  document.getElementById('segmentsMeta'),

  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),

  fcpRes:        document.getElementById('fcpResSelect'),
  capSize:       document.getElementById('capSizeRange'),
  capSizeOut:    document.getElementById('capSizeOut'),
  boxColor:      document.getElementById('boxColorSelect'),
  anim:          document.getElementById('animSelect'),
  animIn:        document.getElementById('animInChk'),
  animOut:       document.getElementById('animOutChk'),
  capOp:         document.getElementById('capOpRange'),
  capOpOut:      document.getElementById('capOpOut'),
  capX:          document.getElementById('capXRange'),
  capXOut:       document.getElementById('capXOut'),
  capY:          document.getElementById('capYRange'),
  tiktokSafe:    document.getElementById('tiktokSafeChk'),
  capYOut:       document.getElementById('capYOut'),
  capReset:      document.getElementById('capResetBtn'),
};

const state = {
  url: '',
  localPath: '',
  loaded: false,
  duration: 0,
  transcribing: false,
  model: 'whisper-small',
  // Final Cut-prosjektets oppløsning ('1080' eller '2160') og tekststørrelse (1 = malens 60 px)
  fcpRes: '1080',
  capSize: 1,
  // Valg i Final Cut-malen «Faktisk titler» (publiserte parametre) og plassering
  boxColor: '0',      // 0 blå, 1 sorte, 2 hvite bokser
  anim: '2',          // 0 rekkefølge, 1 samlet, 2 pop inn, 3 fade inn
  animIn: true,
  animOut: true,
  capOpacity: 1,      // dekning for hele tittelen (adjust-blend i FCPXML)
  capX: 0,            // flytting i prosent av bildehøyden (som FCPXML-posisjon)
  capY: 0,
  tiktokSafe: true,  // stående: smalere linjer, klar av TikToks ikoner
  // 'no' = NB-Whisper. Alt annet bruker original (flerspråklig) Whisper:
  // 'auto' (autodeteksjon), 'en', eller 'translate-en' (→ engelsk tekst).
  language: 'no',
  // Valgfritt manus: gir stavemåte/tegnsetting og hint til whisper
  manus: '',
  // Segmenter: { start, end, text, words?, flags? }
  //   words: [{ w, start, end, f?, h? }] — ordtider fra whisper (eller manus)
  //   flags: avvik fra manus som bør sjekkes (vises gult)
  segments: [],
};

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

function fmtTime(t) {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function updateButtons() {
  els.transcribeBtn.disabled = !state.loaded || state.transcribing;
  const hasSegments = state.segments.length > 0;
  els.exportFcpBtn.disabled = !hasSegments || state.transcribing;
  els.exportSrtBtn.disabled = !hasSegments || state.transcribing;
  els.exportVidBtn.disabled = !state.loaded || !hasSegments || state.transcribing;
  els.addSegBtn.disabled = !state.loaded || state.transcribing;
  els.resegBtn.disabled = !hasSegments || state.transcribing;
  els.applyManusBtn.disabled = !hasSegments || state.transcribing || !state.manus.trim();
}

// Modellen som faktisk brukes: NB-Whisper for norsk, original
// (flerspråklig) Whisper for alt annet — samme størrelsesvalg.
function effectiveModelId() {
  if (state.language === 'no') return state.model;
  const ml = state.model.replace('whisper-', 'whisper-ml-');
  // large-v3-turbo er destillert UTEN oversettelsesoppgaven — med -tr gir
  // den kildespråket tilbake pluss repetisjoner (verifisert). Oversettelse
  // rutes derfor til medium, den beste modellen som faktisk kan det.
  if (state.language === 'translate-en' && ml === 'whisper-ml-large') {
    return 'whisper-ml-medium';
  }
  return ml;
}

// ============================================================
//  Linjedeling — balanser teksten på Faktisk-malens tre linjer
// ============================================================
//
// Tekstboksene i «Faktisk titler» (Haas Grot 75 Bold, 60 px) rommer i
// praksis rundt 26 tegn per linje på 1080 bred video før boksen blir
// bredere enn bildet. Samme budsjett som den gamle Captions FX-websiden.
//
// Liggende format (1920 bredt, samme 60 px-tekst) har plass til lengre
// linjer — og der er to linjer TV-teksting-konvensjonen. Kvadrat og
// stående deler samme 1080-bredde og bruker malens tre linjer.
const CAP_STYLE = {
  blue: '#0050FC',
  font: '"Haas Grot Text 75 Bold", "Helvetica Neue", Helvetica, Arial, sans-serif',
  lineHeight: 1.25,  // som .cap-box--video
  padX: 0.45,        // em, som CSS
  padY: 0.12,
  radius: 0.12,
  gap: 0.25,         // em mellom boksene (4px ved 16px font i preview)
};

function currentLineBudget() {
  const vw = els.video.videoWidth || 0;
  const vh = els.video.videoHeight || 1;
  const landscape = vw > vh * 1.05;
  // Større tekst → færre tegn per linje (boksene skal fortsatt holde seg innenfor bildet)
  const k = capScale();
  if (landscape) return { maxChars: Math.max(14, Math.round(42 / k)), maxLines: 2 };
  if (state.tiktokSafe === false) return { maxChars: Math.max(10, Math.round(26 / k)), maxLines: 3 };
  // Faktisks safe zone for stående (1080x1920): tekstfeltet nederst er
  // x 238–846, dvs. maks 608 px bred boks sentrert om 540 — klar av
  // TikTok/Reels-ikonene til høyre. Målt i ekte skrift, ikke tegn.
  // Boksbredde = k·(tekst@60px + 2·0,45·60) ≤ 608 → tekst@60px ≤ 608/k − 54.
  const maxPx60 = SAFE_CAPTION_W / k - 2 * CAP_STYLE.padX * 60;
  // Litt over er lov når teksten ellers ikke får plass på tre linjer:
  // opp til 660 px (høyre kant ~870 i stedet for 846).
  const hardPx60 = SAFE_CAPTION_W_MAX / k - 2 * CAP_STYLE.padX * 60;
  return { maxChars: Math.max(4, maxPx60 / UNIT_PX), hardChars: Math.max(4, hardPx60 / UNIT_PX), maxLines: 3, measure: measureCap };
}

// Måling av tekst i bokse-skriften (60 px), i «tegn-enheter» à 30 px
const SAFE_CAPTION_W = 608;   // px på 1080 bredt stående bilde (malens tekstfelt)
const SAFE_CAPTION_W_MAX = 660; // myk grense: litt over når det trengs
const UNIT_PX = 30;
const _capMeasure = { ctx: null, cache: new Map() };
function measureCap(str) {
  let v = _capMeasure.cache.get(str);
  if (v !== undefined) return v;
  if (!_capMeasure.ctx) {
    _capMeasure.ctx = document.createElement('canvas').getContext('2d');
    _capMeasure.ctx.font = 'bold 60px ' + CAP_STYLE.font;
  }
  v = _capMeasure.ctx.measureText(str).width / UNIT_PX;
  if (_capMeasure.cache.size > 5000) _capMeasure.cache.clear();
  _capMeasure.cache.set(str, v);
  return v;
}

// Tekststørrelse valgt i sidepanelet (1 = malens 60 px på 1080)
const BOX_COLORS = { '0': { bg: '#0050FC', ink: '#FFFFFF', name: 'Blå bokser' }, '1': { bg: '#000000', ink: '#FFFFFF', name: 'Sorte bokser' }, '2': { bg: '#FFFFFF', ink: '#000000', name: 'Hvite bokser' } };
const ANIM_NAMES = { '0': 'Rekkefølge', '1': 'Samlet', '2': 'Pop inn', '3': 'Fade inn' };
const boxStyle = () => BOX_COLORS[state.boxColor] || BOX_COLORS['0'];
const capOpacity = () => Math.min(1, Math.max(0.2, parseFloat(state.capOpacity) || 1));

function capScale() {
  const v = parseFloat(state.capSize);
  return isFinite(v) ? Math.min(1.8, Math.max(0.6, v)) : 1;
}

// Balanser ord på færrest mulige linjer (maks 2-3 avhengig av format),
// jevnest mulig fordelt. Dynamisk programmering: minimer summen av
// kvadrert slakk per linje, slik at «Dette er en / setning» blir
// «Dette er / en setning».
// Norsk typografi: «» i stedet for "" / “” / „“, tankestrek i stedet for
// bindestrek med mellomrom rundt, og … i stedet for tre punktum.
// Brukes på alt som vises og eksporteres, og på teksten fra transkriberingen.
function norskTypografi(text) {
  let t = String(text == null ? '' : text);
  t = t.replace(/[„“]/g, '"').replace(/[”″]/g, '"');
  // Rette anførselstegn: åpning ved start eller etter mellomrom/parentes/strek, ellers lukking
  t = t.replace(/"/g, (m, i, str) => (i === 0 || /[\s(\[{\u2013\u2014\-\/«]/.test(str[i - 1])) ? '«' : '»');
  t = t.replace(/(^|\s)-(?=\s)/g, '$1\u2013');
  t = t.replace(/\.\.\./g, '\u2026');
  return t;
}

// Selve linjedelingen ligger i deling.js (felles med oppdelingen i bokser):
// færrest mulig linjer, jevnt fordelt, og helst brudd ved komma/punktum —
// aldri etter «på», «en», mellom fornavn og etternavn eller tall og enhet
// når det finnes et like godt alternativ. Ingen ord kastes: blir teksten
// for lang, utvides linjene og advarselen vises.
function balanceLines(text) {
  return window.TekstDeling.balanceLines(norskTypografi(text), currentLineBudget());
}

// ============================================================
//  Oppdeling i tekstbokser og manus (deling.js)
// ============================================================

// Ord whisper alltid skal kjenne (sendes som --prompt, kun i hovedpasset)
const HOUSE_PROMPT = 'Faktisk.no, Faktisk, faktasjekk';

function flagsFromWords(words) {
  const f = (words || []).filter(w => w.f === 'avvik' || w.f === 'sjekk')
    .map(w => ({ type: w.f, word: w.w, heard: w.h || '' }));
  return f.length ? f : undefined;
}

// Har segmentet ordtider som fortsatt stemmer med teksten?
function wordsMatch(seg) {
  if (!Array.isArray(seg.words) || !seg.words.length) return false;
  const toks = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
  return toks.length === seg.words.length
    && window.TekstDeling.normKey(toks.join(' ')) === window.TekstDeling.normKey(seg.words.map(w => w.w).join(' '));
}

// Del alle ordene inn i tekstbokser på nytt. Teksten (også redigert tekst)
// beholdes; grensene og tidene settes på nytt.
function resegment(words) {
  const segs = window.TekstDeling.segmentWords(words, currentLineBudget());
  return segs.map(sg => Object.assign(sg, { text: norskTypografi(sg.text) }));
}

// Bruk manus på ordene. Returnerer { segments, stats } eller { error }.
function applyManusToWords(words) {
  const res = window.TekstDeling.alignToManus(words, state.manus);
  if (!res.ok) {
    if (res.reason === 'for langt') return { error: 'Manuset og opptaket er for lange til å sammenstilles i ett (over ca. 6 000 ord hver). Del opp klippet.' };
    return { error: 'Manuset ser ikke ut til å høre til dette klippet — bare '
      + Math.round((res.stats.coverage || 0) * 100) + ' % av ordene stemmer. Tekstingen er ikke endret.' };
  }
  return { segments: resegment(res.words), stats: res.stats };
}

function manusSummary(st) {
  const parts = [st.matched + st.corrected + ' ord stemte med manus'];
  if (st.corrected) parts.push(st.corrected + ' stavet etter manus');
  if (st.check) parts.push(st.check + ' å sjekke');
  if (st.offScript) parts.push(st.offScript + ' ord sagt utenfor manus');
  return parts.join(' · ');
}

// ============================================================
//  Modellstatus
// ============================================================

document.getElementById('resetModelBtn').addEventListener('click', async () => {
  const yes = await window.faktiskDialog.confirm(
    'Slette den nedlastede modellen? Den hentes på nytt neste gang du transkriberer.');
  if (!yes) return;
  const res = await window.faktisk.transcribeResetModel(effectiveModelId());
  setStatus(res.ok ? 'Modell-cachen er tømt.' : 'Feil: ' + res.error, !res.ok);
  refreshModelStatus();
});

async function refreshModelStatus() {
  try {
    const st = await window.faktisk.transcribeStatus();
    els.modelBox.style.display = 'flex';
    if (!st.ok) {
      els.modelDesc.textContent = st.error;
      return;
    }
    const m = (st.models || {})[effectiveModelId()];
    if (!m) { els.modelDesc.textContent = ''; return; }
    const extra = state.language === 'translate-en'
      ? ' Whisper oversetter kun TIL engelsk — for norske undertekster må teksten oversettes i redigeringen etterpå.'
        + (state.model === 'whisper-large'
          ? ' («Best» bruker medium her — turbo-utgaven av large kan ikke oversette.)'
          : '')
      : '';
    els.modelDesc.textContent = (m.ready
      ? m.label + ' — klar.'
      : m.label + ' — lastes ned første gang du transkriberer (' + m.sizeMB + ' MB, én gang).') + extra;
  } catch (e) {
    els.modelBox.style.display = 'none';
  }
}

els.modelSelect.addEventListener('change', () => {
  state.model = els.modelSelect.value;
  refreshModelStatus();
  scheduleSaveState();
});

els.langSelect.addEventListener('change', () => {
  state.language = els.langSelect.value;
  refreshModelStatus();
  scheduleSaveState();
});

// ============================================================
//  Video-lasting
// ============================================================

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
    state.duration = els.video.duration;
    state.loaded = true;
    els.canvasEmpty.style.display = 'none';
    setStatus('Lastet · ' + fmtTime(state.duration));
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
//  Transkribering
// ============================================================

const PHASE_LABELS = {
  'downloading':       'Laster ned video…',
  'downloading-engine': 'Laster ned transkriberingsmotor (første gang)…',
  'extracting-audio':  'Henter ut lydsporet…',
  'downloading-model': 'Laster ned talemodellen (første gang)…',
  'transcribing':      'Transkriberer…',
  'transcribing-gaps': 'Dobbeltsjekker pauser for oversett tale…',
};

els.transcribeBtn.addEventListener('click', async () => {
  if (!state.loaded || state.transcribing) return;

  if (state.segments.length) {
    const yes = await window.faktiskDialog.confirm(
      'Ny transkribering erstatter segmentene og eventuelle redigeringer. Fortsette?');
    if (!yes) return;
  }

  state.transcribing = true;
  updateButtons();
  els.progress.style.display = 'block';
  els.progressBar.style.width = '0%';
  els.progressNote.textContent = 'Transkribering kan ta noen minutter for lange opptak.';

  const unsub = window.faktisk.onTranscribeProgress(msg => {
    const label = PHASE_LABELS[msg.phase] || msg.phase;
    setStatus(label + (typeof msg.percent === 'number' ? ' ' + msg.percent + '%' : ''));
    if (msg.phase === 'downloading-model' && msg.file) {
      els.progressNote.textContent = 'Henter ' + msg.file + ' — skjer bare første gang.';
    }
    if (typeof msg.percent === 'number') {
      els.progressBar.style.width = msg.percent + '%';
    }
  });

  try {
    const res = await window.faktisk.transcribe({
      url: state.url || undefined,
      inputPath: state.localPath || undefined,
      model: effectiveModelId(),
      language: state.language === 'translate-en' ? 'auto' : state.language,
      translate: state.language === 'translate-en',
      // Navn og fagord fra manus, så whisper staver dem riktig (Studio 0.7.7+;
      // eldre Studio ignorerer feltet)
      // Faktisk-ordene er alltid med: uten hint hørte large «Faktisk.no» som «NHO».
      prompt: state.language !== 'translate-en'
        ? [HOUSE_PROMPT, state.manus.trim() ? window.TekstDeling.promptFromManus(state.manus, 260) : '']
            .filter(Boolean).join(', ')
        : undefined,
    });

    if (res.ok) {
      const raw = (res.segments || []).map(s => Object.assign({}, s, { text: norskTypografi(s.text) }));
      let msg = '';
      try {
        // Del opp på ordnivå: whispers egne segmenter brytes der det passer
        // dem, ikke der det passer en tekstboks
        const words = window.TekstDeling.wordsFromSegments(raw);
        state.segments = resegment(words);
        if (state.manus.trim() && state.language !== 'translate-en') {
          const m = applyManusToWords(words);
          if (m.error) msg = ' · ' + m.error;
          else { state.segments = m.segments; msg = ' · ' + manusSummary(m.stats); }
        }
      } catch (e) {
        console.error(e);
        state.segments = raw;   // reserve: whispers segmenter som før
      }
      renderSegments();
      setStatus('Ferdig ✓ ' + state.segments.length + ' tekstbokser' + msg);
      els.progressNote.textContent = '';
      scheduleSaveState();
    } else {
      setStatus('Transkribering feilet: ' + res.error, true);
    }
  } catch (err) {
    setStatus('Transkribering feilet: ' + err.message, true);
  } finally {
    unsub();
    state.transcribing = false;
    updateButtons();
    refreshModelStatus();
    setTimeout(() => { els.progress.style.display = 'none'; }, 2000);
  }
});

// ============================================================
//  Segmentliste med redigering
// ============================================================

// ---------- tid: visning og tolking ----------
function fmtFine(t) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
// «1:02.5», «62.5», «1:02,5» → sekunder (null hvis ugyldig)
function parseTime(str) {
  const p = String(str || '').trim().replace(',', '.').split(':');
  if (!p.length || p.length > 3) return null;
  let t = 0;
  for (const part of p) {
    const v = parseFloat(part);
    if (!isFinite(v) || v < 0) return null;
    t = t * 60 + v;
  }
  return t;
}

let selectedIndex = -1;

// Sett inn et nytt, tomt segment ved tiden t, klemt mellom naboene.
// Returnerer indeksen, eller -1 hvis det ikke er plass.
function insertSegmentAt(t) {
  let idx = state.segments.findIndex(s => t < s.start);
  if (idx === -1) idx = state.segments.length;
  const prev = state.segments[idx - 1];
  // Står spillehodet inni et segment: legg det nye rett etter det
  let start = Math.max(t, prev ? prev.end : 0);
  const next = state.segments[idx];
  let end = start + 2.5;
  if (next) end = Math.min(end, next.start);
  if (state.duration) end = Math.min(end, state.duration);
  if (end - start < 0.3) return -1;
  state.segments.splice(idx, 0, { start, end, text: '' });
  return idx;
}

// Nytt segment rett etter segment i. Er det ikke luft etter det,
// deles tiden: segment i beholder første halvdel, det nye får andre.
function insertSegmentAfter(i) {
  const seg = state.segments[i];
  const next = state.segments[i + 1];
  const limit = next ? next.start : (state.duration || seg.end + 2.5);
  let start, end;
  if (limit - seg.end >= 0.5) {
    start = seg.end; end = Math.min(limit, seg.end + 2.5);
  } else {
    const mid = seg.start + (seg.end - seg.start) / 2;
    if (seg.end - seg.start < 0.6) return -1;
    start = mid; end = seg.end; seg.end = mid;
  }
  state.segments.splice(i + 1, 0, { start, end, text: '' });
  return i + 1;
}

// Etter at et segment er laget: vis tydelig hvor det havnet
function revealNewSegment(idx) {
  selectedIndex = idx;
  renderSegments();
  scheduleSaveState();
  const seg = state.segments[idx];
  els.video.currentTime = seg.start + 0.01;
  setStatus('Nytt segment ' + fmtFine(seg.start) + '–' + fmtFine(seg.end) + ' — skriv teksten');
  const row = els.segmentsList.querySelector('.seg[data-index="' + idx + '"]');
  if (row) {
    row.classList.add('seg--new');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const editor = row.querySelector('.seg__editor');
    if (editor) editor.focus();
  }
  scrollTimelineTo(seg.start);
}

els.addSegBtn.addEventListener('click', () => {
  if (!state.loaded || state.transcribing) return;
  const idx = insertSegmentAt(els.video.currentTime || 0);
  if (idx < 0) { setStatus('Ikke plass til et nytt segment her — spol til en pause, eller bruk ＋ på et segment.', true); return; }
  revealNewSegment(idx);
});

// Klem start/slutt mellom naboene og minst 0,2 s lengde
function setSegTime(i, which, t) {
  const seg = state.segments[i];
  if (!seg || !isFinite(t)) return;
  const prev = state.segments[i - 1], next = state.segments[i + 1];
  if (which === 'start') seg.start = Math.max(prev ? prev.end : 0, Math.min(t, seg.end - 0.2));
  else seg.end = Math.min(next ? next.start : (state.duration || Infinity), Math.max(t, seg.start + 0.2));
}

function timeField(seg, i, which) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'seg__t';
  inp.value = fmtFine(seg[which]);
  inp.title = (which === 'start' ? 'Start' : 'Slutt') + ' — skriv tiden, eller bruk piltastene (↑↓ 0,1 s, Shift 1 s)';
  const commit = () => {
    const t = parseTime(inp.value);
    if (t != null) setSegTime(i, which, t);
    renderSegments(); scheduleSaveState();
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
      setSegTime(i, which, state.segments[i][which] + d);
      inp.value = fmtFine(state.segments[i][which]);
      els.video.currentTime = state.segments[i][which] + (which === 'start' ? 0.01 : -0.05);
      renderTimeline(); scheduleSaveState();
    }
  });
  inp.addEventListener('blur', () => { if (inp.value !== fmtFine(state.segments[i] ? state.segments[i][which] : 0)) commit(); });
  return inp;
}

function miniBtn(label, title, fn, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'seg__btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', e => { e.stopPropagation(); fn(e); });
  return b;
}

// Gul merknad under et segment som avviker fra manus
function flagNote(flags) {
  const note = document.createElement('div');
  note.className = 'seg__flag';
  const off = flags.filter(f => f.type === 'avvik').map(f => f.word);
  const chk = flags.filter(f => f.type === 'sjekk');
  const parts = [];
  if (off.length) parts.push('Ikke i manus: «' + off.join(' ') + '»');
  chk.forEach(f => parts.push('Manus «' + f.word + '», hørt «' + f.heard + '»'));
  note.textContent = parts.join(' · ') + ' — sjekk mot lyden. Forsvinner når du redigerer.';
  return note;
}

function renderSegments() {
  els.segmentsList.innerHTML = '';
  updateButtons();

  if (!state.segments.length) {
    els.segmentsList.appendChild(els.segmentsEmpty);
    els.segmentsEmpty.style.display = 'block';
    els.segmentsMeta.textContent = '';
    renderOverlay();
    renderTimeline();
    return;
  }

  els.segmentsMeta.textContent = state.segments.length + ' segmenter';

  state.segments.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'seg' + (i === selectedIndex ? ' seg--sel' : '') + (seg.flags ? ' seg--flag' : '');
    row.dataset.index = i;

    // Tider: start og slutt kan skrives inn, finjusteres med piltaster
    // eller settes til spillehodet med knappene
    const times = document.createElement('div');
    times.className = 'seg__times';
    const r1 = document.createElement('div'); r1.className = 'seg__trow';
    r1.appendChild(miniBtn('⇤', 'Sett START til spillehodet', () => { setSegTime(i, 'start', els.video.currentTime); renderSegments(); scheduleSaveState(); }));
    r1.appendChild(timeField(seg, i, 'start'));
    const r2 = document.createElement('div'); r2.className = 'seg__trow';
    r2.appendChild(miniBtn('⇥', 'Sett SLUTT til spillehodet', () => { setSegTime(i, 'end', els.video.currentTime); renderSegments(); scheduleSaveState(); }));
    r2.appendChild(timeField(seg, i, 'end'));
    times.appendChild(r1); times.appendChild(r2);
    const play = miniBtn('▶ ' + (seg.end - seg.start).toFixed(1).replace('.', ',') + ' s', 'Spill av dette segmentet', () => {
      els.video.currentTime = seg.start + 0.01; els.video.play().catch(() => {});
    }, 'seg__play');
    times.appendChild(play);

    // Innhold: redigerbar tekst + boks-forhåndsvisning
    const content = document.createElement('div');
    content.className = 'seg__content';
    const editor = document.createElement('div');
    editor.className = 'seg__editor';
    editor.contentEditable = 'plaintext-only';
    editor.spellcheck = true;
    editor.textContent = seg.text;
    editor.dataset.placeholder = 'Skriv teksten …';
    bindEditor(editor, i);
    editor.addEventListener('focus', () => selectSegment(i, false));
    const preview = document.createElement('div');
    preview.className = 'seg__preview';
    renderPreviewBoxes(preview, seg.text);
    content.appendChild(editor);
    content.appendChild(preview);
    if (seg.flags) content.appendChild(flagNote(seg.flags));

    // Handlinger: flytt teksten opp/ned, nytt segment etter, slett
    const actions = document.createElement('div');
    actions.className = 'seg__actions';
    const up = miniBtn('↑', 'Flytt teksten ett segment opp (tidene blir stående)', () => swapText(i, i - 1));
    up.disabled = i === 0;
    const down = miniBtn('↓', 'Flytt teksten ett segment ned (tidene blir stående)', () => swapText(i, i + 1));
    down.disabled = i === state.segments.length - 1;
    const add = miniBtn('＋', 'Nytt segment rett etter dette', () => {
      const idx = insertSegmentAfter(i);
      if (idx < 0) { setStatus('Segmentet er for kort til å deles.', true); return; }
      revealNewSegment(idx);
    });
    const del = miniBtn('×', 'Slett segmentet', () => {
      state.segments.splice(i, 1);
      if (selectedIndex >= state.segments.length) selectedIndex = state.segments.length - 1;
      renderSegments(); scheduleSaveState();
    }, 'seg__btn--del');
    actions.append(up, down, add, del);

    row.addEventListener('mousedown', e => {
      if (e.target.closest('input, button, .seg__editor')) return;
      selectSegment(i, true);
    });

    row.appendChild(times);
    row.appendChild(content);
    row.appendChild(actions);
    els.segmentsList.appendChild(row);
  });

  renderOverlay();
  renderTimeline();
}

// Bytt tekst med nabosegmentet; tidene står. Markøren følger teksten.
function swapText(i, j) {
  const a = state.segments[i], b = state.segments[j];
  if (!a || !b) return;
  const t = a.text; a.text = b.text; b.text = t;
  const w = a.words; a.words = b.words; b.words = w;
  const f = a.flags; a.flags = b.flags; b.flags = f;
  selectedIndex = j;
  renderSegments(); scheduleSaveState();
  const row = els.segmentsList.querySelector('.seg[data-index="' + j + '"]');
  if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('seg--new'); }
}

function selectSegment(i, seek) {
  selectedIndex = i;
  els.segmentsList.querySelectorAll('.seg').forEach(r => r.classList.toggle('seg--sel', +r.dataset.index === i));
  els.timelineTrack && els.timelineTrack.querySelectorAll('.tl-seg').forEach(b => b.classList.toggle('is-sel', +b.dataset.index === i));
  const seg = state.segments[i];
  if (seg && seek) { els.video.currentTime = seg.start + 0.01; scrollTimelineTo(seg.start); }
}

// ============================================================
//  Tidslinje under videoen
// ============================================================

els.timeline = document.getElementById('timeline');
els.timelineScroll = document.getElementById('tlScroll');
els.timelineTrack = document.getElementById('tlTrack');
els.timelinePlayhead = document.getElementById('tlPlayhead');
els.timelineZoom = document.getElementById('tlZoom');

function pxPerSec() {
  const dur = state.duration || els.video.duration || 0;
  const w = els.timelineScroll.clientWidth || 600;
  if (!dur) return 40;
  const fit = (w - 2) / dur, max = 220;
  const z = parseFloat(els.timelineZoom.value) || 0;
  return fit >= max ? fit : fit * Math.pow(max / fit, z);
}

function renderTimeline() {
  if (!els.timelineTrack) return;
  const dur = state.duration || els.video.duration || 0;
  const track = els.timelineTrack;
  track.querySelectorAll('.tl-seg, .tl-tick').forEach(n => n.remove());
  els.timeline.classList.toggle('is-empty', !dur);
  if (!dur) return;
  const pps = pxPerSec();
  track.style.width = Math.max(els.timelineScroll.clientWidth - 2, dur * pps) + 'px';

  // Tidsskala: velg et steg som gir minst ~70 px mellom tallene
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => s * pps >= 70) || 600;
  for (let t = 0; t <= dur + 0.001; t += step) {
    const tick = document.createElement('span');
    tick.className = 'tl-tick';
    tick.style.left = (t * pps) + 'px';
    tick.textContent = step < 1 ? fmtFine(t) : fmtTime(t);
    track.appendChild(tick);
  }

  state.segments.forEach((seg, i) => {
    const b = document.createElement('div');
    b.className = 'tl-seg' + (i === selectedIndex ? ' is-sel' : '') + (seg.text.trim() ? '' : ' is-blank') + (seg.flags ? ' is-flag' : '');
    b.dataset.index = i;
    b.style.left = (seg.start * pps) + 'px';
    b.style.width = Math.max(4, (seg.end - seg.start) * pps) + 'px';
    b.title = fmtFine(seg.start) + '–' + fmtFine(seg.end) + '\n' + (seg.text.trim() || '(tom)');
    const label = document.createElement('span');
    label.className = 'tl-seg__txt';
    label.textContent = (i + 1) + '  ' + (seg.text.trim() || '(tom)');
    b.appendChild(label);
    const hl = document.createElement('i'); hl.className = 'tl-seg__h tl-seg__h--l';
    const hr = document.createElement('i'); hr.className = 'tl-seg__h tl-seg__h--r';
    b.append(hl, hr);
    b.addEventListener('pointerdown', e => startTimelineDrag(e, i, e.target === hl ? 'start' : e.target === hr ? 'end' : 'move'));
    track.appendChild(b);
  });
  updatePlayhead();
}

function updatePlayhead() {
  if (!els.timelinePlayhead) return;
  els.timelinePlayhead.style.left = ((els.video.currentTime || 0) * pxPerSec()) + 'px';
}

function scrollTimelineTo(t) {
  const sc = els.timelineScroll, x = t * pxPerSec();
  if (x < sc.scrollLeft + 40 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollTo({ left: Math.max(0, x - sc.clientWidth / 3), behavior: 'smooth' });
}
// Når du selv ruller i tidslinjen, slutter den å følge spillehodet en liten stund
let tlUserScrollAt = 0;

// Dra en boks: flytt hele segmentet, eller dra i kantene for start/slutt.
// Klemmes mot naboene, så segmentene aldri overlapper.
function startTimelineDrag(e, i, mode) {
  e.preventDefault(); e.stopPropagation();
  const seg = state.segments[i];
  const pps = pxPerSec(), x0 = e.clientX, s0 = seg.start, e0 = seg.end, len = e0 - s0;
  const prev = state.segments[i - 1], next = state.segments[i + 1];
  const minS = prev ? prev.end : 0, maxE = next ? next.start : (state.duration || Infinity);
  const block = e.currentTarget;
  let moved = false;
  block.setPointerCapture(e.pointerId);
  selectSegment(i, false);
  const onMove = ev => {
    const dt = (ev.clientX - x0) / pps;
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    if (!moved) return;
    if (mode === 'move') { const s = Math.min(Math.max(minS, s0 + dt), maxE - len); seg.start = s; seg.end = s + len; }
    else if (mode === 'start') seg.start = Math.min(Math.max(minS, s0 + dt), seg.end - 0.2);
    else seg.end = Math.max(Math.min(maxE, e0 + dt), seg.start + 0.2);
    block.style.left = (seg.start * pps) + 'px';
    block.style.width = Math.max(4, (seg.end - seg.start) * pps) + 'px';
    els.video.currentTime = mode === 'end' ? Math.max(0, seg.end - 0.05) : seg.start + 0.01;
  };
  const onUp = () => {
    block.removeEventListener('pointermove', onMove);
    block.removeEventListener('pointerup', onUp);
    block.removeEventListener('pointercancel', onUp);
    if (moved) { renderSegments(); scheduleSaveState(); }
    else selectSegment(i, true);
    const row = els.segmentsList.querySelector('.seg[data-index="' + i + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  block.addEventListener('pointermove', onMove);
  block.addEventListener('pointerup', onUp);
  block.addEventListener('pointercancel', onUp);
}

// ---------- Avspillingsknapper ----------
(function setupTransport() {
  const $ = id => document.getElementById(id);
  const v = els.video, play = $('tpPlay');
  if (!play) return;
  let startedAt = 0;   // hvor siste avspilling startet — «Stopp» går tilbake hit
  const seek = t => { v.currentTime = Math.max(0, Math.min(t, (state.duration || v.duration || 0))); };
  const toggle = () => { if (v.paused) { startedAt = v.currentTime; v.play().catch(() => {}); } else v.pause(); };
  play.addEventListener('click', toggle);
  $('tpStart').addEventListener('click', () => seek(0));
  $('tpBack').addEventListener('click', () => seek(v.currentTime - 5));
  $('tpFwd').addEventListener('click', () => seek(v.currentTime + 5));
  $('tpStop').addEventListener('click', () => { v.pause(); seek(startedAt); });
  $('tpRate').addEventListener('change', e => { v.playbackRate = parseFloat(e.target.value) || 1; });
  const sync = () => {
    play.textContent = v.paused ? '▶' : '❚❚';
    $('tpTime').textContent = fmtFine(v.currentTime || 0) + ' / ' + fmtFine(state.duration || v.duration || 0);
  };
  ['play', 'pause', 'timeupdate', 'seeked', 'loadedmetadata'].forEach(ev => v.addEventListener(ev, sync));
  // Tastatur: mellomrom = spill/pause, ← → = 5 s (ikke mens du skriver)
  document.addEventListener('keydown', e => {
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (!state.loaded) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(v.currentTime - (e.shiftKey ? 1 : 5)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(v.currentTime + (e.shiftKey ? 1 : 5)); }
  });
  sync();
})();

if (els.timelineTrack) {
  // Klikk på tom flate: spol. Dobbeltklikk: nytt segment der.
  const timeAtEvent = e => {
    const r = els.timelineTrack.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left) / pxPerSec());
  };
  els.timelineTrack.addEventListener('click', e => {
    if (e.target.closest('.tl-seg')) return;
    els.video.currentTime = Math.min(timeAtEvent(e), state.duration || Infinity);
  });
  els.timelineTrack.addEventListener('dblclick', e => {
    if (e.target.closest('.tl-seg') || !state.loaded || state.transcribing) return;
    const idx = insertSegmentAt(timeAtEvent(e));
    if (idx < 0) { setStatus('Ikke plass til et nytt segment her.', true); return; }
    revealNewSegment(idx);
  });
  els.timelineZoom.addEventListener('input', () => {
    const t = els.video.currentTime || 0;
    renderTimeline();
    scrollTimelineTo(t);
  });
  window.addEventListener('resize', renderTimeline);
  // Jevn spillehode-bevegelse under avspilling, og følg med når den går ut av synsfeltet
  // Jevn følging: under avspilling glir tidslinjen kontinuerlig, med
  // spillehodet rundt en tredjedel inn — i stedet for å hoppe en side om gangen.
  let lastTick = performance.now();
  (function tick(now) {
    now = now || performance.now();
    const dt = Math.min(0.1, (now - lastTick) / 1000); lastTick = now;
    if (!els.video.paused) {
      updatePlayhead();
      const sc = els.timelineScroll, max = sc.scrollWidth - sc.clientWidth;
      if (max > 0 && now - tlUserScrollAt > 1500) {
        const x = (els.video.currentTime || 0) * pxPerSec();
        const target = Math.max(0, Math.min(max, x - sc.clientWidth * 0.33));
        const diff = target - sc.scrollLeft;
        // stort hopp (f.eks. etter spoling): ta det raskt; ellers myk etterfølging
        sc.scrollLeft += Math.abs(diff) > sc.clientWidth ? diff : diff * Math.min(1, dt * 8);
      }
    }
    requestAnimationFrame(tick);
  })();
  // Rullehjul/styreflate: loddrett rulling flytter tidslinjen sideveis.
  // Cmd/Ctrl + rulling (eller knip på styreflaten) zoomer rundt pekeren.
  els.timelineScroll.addEventListener('wheel', e => {
    const sc = els.timelineScroll;
    tlUserScrollAt = performance.now();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = sc.getBoundingClientRect(), px = e.clientX - r.left;
      const tAt = (sc.scrollLeft + px) / pxPerSec();
      const z = els.timelineZoom;
      z.value = String(Math.max(0, Math.min(1, (parseFloat(z.value) || 0) - e.deltaY * 0.004)));
      renderTimeline();
      sc.scrollLeft = Math.max(0, tAt * pxPerSec() - px);
      return;
    }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); sc.scrollLeft += e.deltaY; }
  }, { passive: false });
  els.timelineScroll.addEventListener('pointerdown', () => { tlUserScrollAt = performance.now(); });
  els.video.addEventListener('seeked', () => { updatePlayhead(); renderOverlay(); });
  els.video.addEventListener('loadedmetadata', () => renderTimeline());
}

function renderPreviewBoxes(container, text) {
  container.innerHTML = '';
  const { lines, tooLong, maxLines, manualIgnored } = balanceLines(text);
  lines.forEach(line => {
    const box = document.createElement('span');
    box.className = 'cap-box';
    box.textContent = line;
    container.appendChild(box);
  });
  if (tooLong) {
    const warn = document.createElement('span');
    warn.className = 'seg__warn';
    warn.textContent = 'For langt for ' + maxLines + ' linjer — del segmentet (Enter i teksten)';
    container.appendChild(warn);
  } else if (manualIgnored) {
    const warn = document.createElement('span');
    warn.className = 'seg__warn';
    warn.textContent = 'Linjeskiftene dine får ikke plass på ' + maxLines + ' linjer — delt automatisk';
    container.appendChild(warn);
  }
}

function bindEditor(editor, index) {
  // Oppdater tekst + preview mens man skriver (uten full re-render,
  // som ville kastet markøren)
  editor.addEventListener('input', () => {
    const seg = state.segments[index];
    if (!seg) return;
    seg.text = editor.textContent;
    // Du har sett på teksten: fjern manus-merknaden
    if (seg.flags) {
      delete seg.flags;
      if (seg.words) seg.words.forEach(w => { delete w.f; delete w.h; });
      const row = editor.closest('.seg');
      if (row) { row.classList.remove('seg--flag'); const n = row.querySelector('.seg__flag'); if (n) n.remove(); }
      renderTimeline();
    }
    const preview = editor.parentElement.querySelector('.seg__preview');
    renderPreviewBoxes(preview, seg.text);
    renderOverlay();
    scheduleSaveState();
  });

  // Rett opp anførselstegn o.l. når du går ut av teksten (ikke mens du skriver,
  // så markøren ikke hopper)
  editor.addEventListener('blur', () => {
    const seg = state.segments[index];
    if (!seg) return;
    const fixed = norskTypografi(editor.textContent);
    if (fixed !== editor.textContent) { editor.textContent = fixed; seg.text = fixed; scheduleSaveState(); }
  });

  editor.addEventListener('keydown', e => {
    const seg = state.segments[index];
    if (!seg) return;

    // Shift+Enter = linjeskift i samme boks
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertNewline(editor);
      return;
    }

    // Enter = del segmentet ved markøren
    if (e.key === 'Enter') {
      e.preventDefault();
      const pos = caretOffset(editor);
      splitSegment(index, pos);
      return;
    }

    // Rettetast først i teksten = flett med forrige segment
    if (e.key === 'Backspace' && caretOffset(editor) === 0 && index > 0) {
      e.preventDefault();
      mergeWithPrevious(index);
    }
  });
}

// Sett inn et ekte «\n» ved markøren. (execCommand('insertText') lager en
// <div> i plaintext-only-felt, og da forsvinner skiftet fra textContent.)
function insertNewline(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const n = document.createTextNode('\n');
  r.insertNode(n);
  r.setStartAfter(n);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  el.normalize();
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}

function splitSegment(index, charPos) {
  const seg = state.segments[index];
  const text = seg.text;
  if (charPos <= 0 || charPos >= text.length) return;

  const first = text.slice(0, charPos).trim();
  const second = text.slice(charPos).trim();
  if (!first || !second) return;

  // Med ordtider: del ved ordets faktiske tid. Ellers fordeles tiden
  // proporsjonalt med tegnposisjonen.
  const a = { start: seg.start, text: first }, b = { end: seg.end, text: second };
  const k = first.split(/\s+/).filter(Boolean).length;
  const atWordGap = /\s/.test(text[charPos] || ' ') || /\s/.test(text[charPos - 1] || ' ');
  let splitTime = seg.start + (seg.end - seg.start) * (charPos / text.length);
  if (wordsMatch(seg) && atWordGap && k > 0 && k < seg.words.length) {
    a.words = seg.words.slice(0, k); b.words = seg.words.slice(k);
    splitTime = b.words[0].start;
    a.flags = flagsFromWords(a.words); b.flags = flagsFromWords(b.words);
    if (!a.flags) delete a.flags;
    if (!b.flags) delete b.flags;
  }
  a.end = splitTime; b.start = splitTime;

  state.segments.splice(index, 1, a, b);

  renderSegments();
  scheduleSaveState();

  // Sett markøren først i det nye segmentet
  const rows = els.segmentsList.querySelectorAll('.seg__editor');
  if (rows[index + 1]) rows[index + 1].focus();
}

function mergeWithPrevious(index) {
  const prev = state.segments[index - 1];
  const cur = state.segments[index];
  const joinPos = prev.text.length;

  const merged = {
    start: prev.start,
    end: cur.end,
    text: (prev.text + ' ' + cur.text).replace(/\s+/g, ' ').trim(),
  };
  if (wordsMatch(prev) && wordsMatch(cur)) {
    merged.words = prev.words.concat(cur.words);
    const f = flagsFromWords(merged.words);
    if (f) merged.flags = f;
  }
  state.segments.splice(index - 1, 2, merged);

  renderSegments();
  scheduleSaveState();

  // Markør der skjøten skjedde
  const rows = els.segmentsList.querySelectorAll('.seg__editor');
  const editor = rows[index - 1];
  if (editor) {
    editor.focus();
    const range = document.createRange();
    const node = editor.firstChild;
    if (node) {
      const pos = Math.min(joinPos + 1, node.textContent.length);
      range.setStart(node, pos);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

// ============================================================
//  Forhåndsvisning på videoen — de blå boksene
// ============================================================

function activeSegmentIndex(t) {
  for (let i = 0; i < state.segments.length; i++) {
    const s = state.segments[i];
    if (t >= s.start && t < s.end) return i;
  }
  return -1;
}

// Forankre overlayen til videoens FAKTISKE rektangel (videoen er sentrert
// med letterboxing i canvas-området) og speil malens geometri:
// «Faktisk titler» er bygget på 1080x1920 med 60 px tekst og linjegrupper
// på Y -267/-371/-474 fra midten. Uten format-snapshots i malen beholdes
// pikselkoordinatene også på liggende — da havner teksten mye nærmere
// bunnen. Forhåndsvisningen gjenskaper begge tilfellene.
function layoutOverlay() {
  const videoRect = els.video.getBoundingClientRect();
  const areaRect = els.video.parentElement.getBoundingClientRect();
  if (!videoRect.width) return;

  const o = els.captionOverlay;
  o.style.left = (videoRect.left - areaRect.left) + 'px';
  o.style.width = videoRect.width + 'px';
  o.style.right = 'auto';

  const portrait = (els.video.videoHeight || 0) >= (els.video.videoWidth || 1);
  if (portrait) {
    // Nederste linjesenter 474 px over midten av 1920 → 486/1920 fra bunn,
    // minus halv linjehøyde ≈ 0.234
    // Tekststørrelsen skalerer både boksene og avstanden fra bunnen (som i FCPXML-eksporten)
    const k = capScale();
    o.style.bottom = (areaRect.bottom - videoRect.bottom + videoRect.height * 0.234 * k) + 'px';
    o.style.setProperty('--cap-font', (videoRect.width * 60 / 1080 * k) + 'px');
  } else {
    // Uten snapshot: samme pikselavstander på 1080 høyde → ~66 px fra bunn
    const k = capScale();
    o.style.bottom = (areaRect.bottom - videoRect.bottom + videoRect.height * 0.04 * k) + 'px';
    o.style.setProperty('--cap-font', (videoRect.height * 60 / 1080 * k) + 'px');
  }
  // Boksfarge, dekning og flytting (flytting i prosent av bildehøyden, som i FCPXML)
  const bs = boxStyle();
  o.style.setProperty('--cap-bg', bs.bg);
  o.style.setProperty('--cap-ink', bs.ink);
  o.style.opacity = capOpacity();
  o.style.transform = 'translate(' + (videoRect.height * (+state.capX || 0) / 100) + 'px,' + (-videoRect.height * (+state.capY || 0) / 100) + 'px)';
}

let lastOverlayIndex = -2;
function renderOverlay() {
  layoutOverlay();
  const idx = activeSegmentIndex(els.video.currentTime);
  // Tegn på nytt også når teksten i det aktive segmentet endres (f.eks. et nytt,
  // tomt segment man skriver i) — ikke bare når et annet segment blir aktivt
  const key = idx < 0 ? 'none' : idx + '|' + state.segments[idx].text + '|' + capScale();
  if (key === lastOverlayIndex) return;
  lastOverlayIndex = key;

  els.captionOverlay.innerHTML = '';
  if (idx < 0) return;

  const { lines } = balanceLines(state.segments[idx].text);
  lines.forEach(line => {
    const box = document.createElement('span');
    box.className = 'cap-box cap-box--video';
    box.textContent = line;
    els.captionOverlay.appendChild(box);
  });
}

window.addEventListener('resize', () => { lastOverlayIndex = -2; renderOverlay(); });
els.video.addEventListener('loadedmetadata', () => {
  lastOverlayIndex = -2;
  // Formatet (og dermed linjebudsjettet) er først kjent nå — tegn
  // segmentforhåndsvisningene på nytt med riktig antall linjer/tegn.
  renderSegments();
});

els.video.addEventListener('timeupdate', () => {
  renderOverlay();
  const t = els.video.currentTime;
  const editing = els.segmentsList.contains(document.activeElement);
  document.querySelectorAll('.seg').forEach(row => {
    const seg = state.segments[parseInt(row.dataset.index, 10)];
    const on = !!(seg && t >= seg.start && t < seg.end);
    // Følg med i lista under avspilling (men ikke mens du skriver)
    if (on && !row.classList.contains('active') && !els.video.paused && !editing) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.toggle('active', on);
  });
  if (els.timelineTrack) els.timelineTrack.querySelectorAll('.tl-seg').forEach(b => {
    const seg = state.segments[+b.dataset.index];
    b.classList.toggle('is-active', !!(seg && t >= seg.start && t < seg.end));
  });
  updatePlayhead();
});

// ============================================================
//  Final Cut-oppløsning og tekststørrelse
// ============================================================

function syncCapControls() {
  els.boxColor.value = state.boxColor;
  els.anim.value = state.anim;
  els.animIn.checked = !!state.animIn;
  els.animOut.checked = !!state.animOut;
  els.capOp.value = String(capOpacity());
  els.capOpOut.textContent = Math.round(capOpacity() * 100) + ' %';
  els.capX.value = String(+state.capX || 0);
  els.capXOut.textContent = String(+state.capX || 0);
  els.capY.value = String(+state.capY || 0);
  els.capYOut.textContent = String(+state.capY || 0);
  els.fcpRes.value = state.fcpRes;
  els.capSize.value = String(capScale());
  els.capSizeOut.textContent = Math.round(capScale() * 100) + ' %';
  if (els.tiktokSafe) els.tiktokSafe.checked = state.tiktokSafe !== false;
}
els.fcpRes.addEventListener('change', () => {
  state.fcpRes = els.fcpRes.value === '2160' ? '2160' : '1080';
  scheduleSaveState();
});
els.capSize.addEventListener('input', () => {
  state.capSize = parseFloat(els.capSize.value) || 1;
  els.capSizeOut.textContent = Math.round(capScale() * 100) + ' %';
  // Linjebudsjettet avhenger av størrelsen: tegn segmentene og teksten på videoen på nytt
  renderSegments();
  lastOverlayIndex = -2;
  renderOverlay();
  scheduleSaveState();
});
// Tekstvalg som også vises i forhåndsvisningen
const refreshCaps = () => { lastOverlayIndex = -2; renderOverlay(); scheduleSaveState(); };
els.boxColor.addEventListener('change', () => { state.boxColor = els.boxColor.value; refreshCaps(); });
els.anim.addEventListener('change', () => { state.anim = els.anim.value; scheduleSaveState(); });
els.animIn.addEventListener('change', () => { state.animIn = els.animIn.checked; scheduleSaveState(); });
els.animOut.addEventListener('change', () => { state.animOut = els.animOut.checked; scheduleSaveState(); });
els.capOp.addEventListener('input', () => { state.capOpacity = parseFloat(els.capOp.value) || 1; els.capOpOut.textContent = Math.round(capOpacity() * 100) + ' %'; refreshCaps(); });
els.capX.addEventListener('input', () => { state.capX = parseFloat(els.capX.value) || 0; els.capXOut.textContent = String(state.capX); refreshCaps(); });
els.capY.addEventListener('input', () => { state.capY = parseFloat(els.capY.value) || 0; els.capYOut.textContent = String(state.capY); refreshCaps(); });
if (els.tiktokSafe) els.tiktokSafe.addEventListener('change', () => {
  state.tiktokSafe = els.tiktokSafe.checked;
  renderSegments(); lastOverlayIndex = -2; renderOverlay(); scheduleSaveState();
});
els.capReset.addEventListener('click', () => {
  Object.assign(state, { capSize: 1, boxColor: '0', anim: '2', animIn: true, animOut: true, capOpacity: 1, capX: 0, capY: 0, tiktokSafe: true });
  syncCapControls(); renderSegments(); refreshCaps();
});
syncCapControls();

// ============================================================
//  Eksport: FCPXML («Faktisk titler») og SRT
// ============================================================

const FPS = 25;
const toFrames = sec => Math.max(0, Math.round(sec * FPS));

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Genererer FCPXML som matcher mars 2026-prosjektet: «Faktisk titler»-
// templaten med tre tekstlinjer per tittel, blå bokser og pop-inn.
function buildFcpxml() {
  // Bruk ALLTID standard leveringsformat, aldri forhåndsvisningens
  // oppløsning: Labrador-strømmer kan være nedskalert (typisk 640x360),
  // og da ville Final Cut rendret titlene i lav oppløsning → uskarpe
  // bokser. Retningen (liggende/stående/kvadrat) hentes fra videoen,
  // oppløsningen er alltid full.
  const vw = els.video.videoWidth || 1080;
  const vh = els.video.videoHeight || 1920;
  const aspect = vw / vh;
  let w, h;
  if (Math.abs(aspect - 1) < 0.05)      { w = 1080; h = 1080; }   // kvadrat
  else if (aspect > 1)                  { w = 1920; h = 1080; }   // liggende
  else                                  { w = 1080; h = 1920; }   // stående

  // Oppløsning på Final Cut-prosjektet: malen er tegnet i HD-piksler, så i et
  // 4K-prosjekt skaleres hver tittel 2× for å se lik ut. Tekststørrelsen
  // skalerer i tillegg, og tittelen flyttes opp så nederste boks holder samme
  // (skalerte) avstand til bunnen. Posisjon i FCPXML er prosent av bildehøyden.
  const resK = state.fcpRes === '2160' ? 2 : 1;
  w *= resK; h *= resK;
  const capK = capScale();
  const scale = +(resK * capK).toFixed(4);
  const dy = +(50 * (capK - 1) + (+state.capY || 0)).toFixed(4);
  const dx = +(+state.capX || 0).toFixed(4);
  const transform = (scale !== 1 || dy !== 0 || dx !== 0)
    ? `\n              <adjust-transform position="${dx} ${dy}" scale="${scale} ${scale}"/>`
    : '';
  const op = capOpacity();
  const blend = op < 1 ? `\n              <adjust-blend amount="${op.toFixed(3)}"/>` : '';
  const boxParam = state.boxColor + ' (' + boxStyle().name + ')';
  const animParam = state.anim + ' (' + (ANIM_NAMES[state.anim] || 'Pop inn') + ')';

  const totalFrames = toFrames(state.duration || (state.segments.length
    ? state.segments[state.segments.length - 1].end : 0));

  // Titlene legges som tilkoblede klipp (lane 1) oppå en gap som dekker
  // hele lengden. Direkte i spinen må elementene ligge kant i kant — og
  // Whisper-segmenter har naturlige pauser mellom seg, noe som fikk
  // Final Cut til å forskyve/gjemme titlene ved import.
  const titles = state.segments.map((seg, i) => {
    const { lines } = balanceLines(seg.text);
    const startF = toFrames(seg.start);
    // Klipp mot neste segment så to titler aldri overlapper (ugyldig i FCP)
    const next = state.segments[i + 1];
    const endF = Math.min(toFrames(seg.end), next ? toFrames(next.start) : Infinity);
    const durF = Math.max(1, endF - startF);
    const tsId = 'ts_' + (i + 1);

    // Alltid tre <text>-elementer — templaten forventer det, tomme linjer
    // er tomme elementer (samme struktur som mars-prosjektet)
    const textEls = [0, 1, 2].map(li => lines[li]
      ? `              <text>\n                <text-style ref="${tsId}">${xmlEscape(lines[li])}</text-style>\n              </text>`
      : `              <text>\n              </text>`
    ).join('\n');

    return `              <title ref="r2" lane="1" offset="${startF}/${FPS}s" name="Subtitle ${i + 1}" duration="${durF}/${FPS}s" role="titles">
              <param name="Boksfarge" key="9999/3080229630/100/3080230405/2/100" value="${boxParam}"/>
              <param name="Animasjon type" key="9999/3080229630/100/3080229631/2/100" value="${animParam}"/>
              <param name="Animer inn" key="9999/10012/10013/2/101" value="${state.animIn ? 1 : 0}"/>
              <param name="Animer ut" key="9999/10012/10013/2/102" value="${state.animOut ? 1 : 0}"/>
${textEls}
              <text-style-def id="${tsId}">
                <text-style font="Haas Grot Text" fontSize="60" fontFace="75 Bold" fontColor="1.0 1.0 1.0 1" bold="1" alignment="center"/>
              </text-style-def>${transform}${blend}
            </title>`;
  }).join('\n\n');

  const today = new Date().toISOString().slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.12">
  <resources>
    <format id="r1" frameDuration="1/${FPS}s" width="${w}" height="${h}" colorSpace="1-1-1 (Rec. 709)"/>
    <effect id="r2" name="Faktisk titler" uid="~/Titles.localized/Faktisk maler/01 Faktisk maler/Faktisk titler/Faktisk titler.moti" src="file:///Users/stianbrathen/Movies/Motion%20Templates.localized/Titles.localized/Faktisk%20maler/01%20Faktisk%20maler/Faktisk%20titler/Faktisk%20titler.moti"/>
  </resources>
  <library>
    <event name="Teksting">
      <project name="Teksting-prosjekt-${today}">
        <sequence format="r1" duration="${totalFrames}/${FPS}s" tcStart="0/${FPS}s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="Gap" offset="0/${FPS}s" duration="${totalFrames}/${FPS}s" start="0/${FPS}s">
${titles}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const pad = (n, l) => String(n).padStart(l, '0');
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(f, 3);
}

function buildSrt() {
  return state.segments.map((seg, i) => {
    const { lines } = balanceLines(seg.text);
    return (i + 1) + '\n'
      + srtTime(seg.start) + ' --> ' + srtTime(seg.end) + '\n'
      + (lines.length ? lines.join('\n') : seg.text);
  }).join('\n\n') + '\n';
}

function exportBaseName() {
  return ((state.url || state.localPath || 'teksting')
    .split('/').pop().replace(/\.[^.]+$/, '') || 'teksting');
}

async function exportFile(content, ext, filterName) {
  const savePath = await window.faktisk.saveDialog({
    title: 'Eksporter ' + ext.toUpperCase(),
    defaultPath: exportBaseName() + '.' + ext,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (!savePath) return;
  const res = await window.faktisk.writeTextFile({ savePath, content });
  if (res.ok) {
    setStatus('Eksportert ✓ ' + savePath.split('/').pop());
    await window.faktisk.revealInFinder(savePath);
  } else {
    setStatus('Eksport feilet: ' + res.error, true);
  }
}

els.exportFcpBtn.addEventListener('click', () => {
  if (!state.segments.length) return;
  exportFile(buildFcpxml(), 'fcpxml', 'Final Cut Pro XML');
});

els.exportSrtBtn.addEventListener('click', () => {
  if (!state.segments.length) return;
  exportFile(buildSrt(), 'srt', 'SubRip-undertekster');
});

// ============================================================
//  Eksport: video med innbrent tekst (MP4)
// ============================================================
//
// Tegner én full-frame PNG per segment med nøyaktig samme geometri som
// forhåndsvisningen (malens 60 px-tekst på 1080-lerret, bokser fra bunn),
// og lar Studios ffmpeg legge dem over videoen med fade-inn.

// (CAP_STYLE er flyttet opp til linjedelingen)

function renderCaptionPng(seg) {
  const W = els.video.videoWidth;
  const H = els.video.videoHeight;
  const portrait = H >= W;
  // Speiler layoutOverlay(): malens 60 px på 1080-lerretet
  const k = capScale();
  const fontSize = (portrait ? (W * 60 / 1080) : (H * 60 / 1080)) * k;
  const bottomOffset = (portrait ? H * 0.234 : H * 0.04) * k + H * (+state.capY || 0) / 100;
  const shiftX = H * (+state.capX || 0) / 100;
  const bs = boxStyle();

  const { lines } = balanceLines(seg.text);
  if (!lines.length) return null;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold ' + fontSize + 'px ' + CAP_STYLE.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const boxH = fontSize * (CAP_STYLE.lineHeight + 2 * CAP_STYLE.padY);
  const gap = fontSize * CAP_STYLE.gap;
  const padX = fontSize * CAP_STYLE.padX;
  const radius = fontSize * CAP_STYLE.radius;

  // Stable boksene nedenfra: nederste linje har bunnkant på bottomOffset
  let bottomY = H - bottomOffset;
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i];
    const textW = ctx.measureText(text).width;
    const boxW = textW + 2 * padX;
    const x = (W - boxW) / 2 + shiftX;
    const y = bottomY - boxH;

    ctx.globalAlpha = capOpacity();
    ctx.fillStyle = bs.bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, radius);
    else ctx.rect(x, y, boxW, boxH);
    ctx.fill();

    ctx.fillStyle = bs.ink;
    ctx.fillText(text, W / 2 + shiftX, y + boxH / 2 + fontSize * 0.04);

    bottomY = y - gap;
  }
  return canvas.toDataURL('image/png');
}

els.exportVidBtn.addEventListener('click', async () => {
  if (!state.loaded || !state.segments.length || state.transcribing) return;
  if (!els.video.videoWidth) {
    setStatus('Videoen er ikke ferdig lastet ennå.', true);
    return;
  }

  const savePath = await window.faktisk.saveDialog({
    title: 'Eksporter video med tekst',
    defaultPath: exportBaseName() + '-tekstet.mp4',
    filters: [{ name: 'MP4-video', extensions: ['mp4'] }],
  });
  if (!savePath) return;

  // Som i FCPXML-eksporten: klipp mot neste segment slik at to bokser
  // aldri vises samtidig (overlapp kan oppstå fra hull-passet)
  const pngs = [];
  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    if (!seg.text.trim()) continue;
    const next = state.segments[i + 1];
    const end = next ? Math.min(seg.end, next.start) : seg.end;
    if (end - seg.start < 0.1) continue;
    const png = renderCaptionPng(seg);
    if (png) pngs.push({ png, start: seg.start, end });
  }
  if (!pngs.length) { setStatus('Ingen segmenter med tekst.', true); return; }

  els.exportVidBtn.disabled = true;
  els.progress.style.display = 'block';
  els.progressBar.style.width = '0%';
  els.progressNote.textContent = 'Brenner inn tekst og komprimerer — dette kan ta litt tid.';

  const unsub = window.faktisk.onCaptionBurnProgress(msg => {
    const labels = { downloading: 'Laster ned video…', encoding: 'Eksporterer video…' };
    setStatus((labels[msg.phase] || msg.phase)
      + (typeof msg.percent === 'number' ? ' ' + msg.percent + '%' : ''));
    if (typeof msg.percent === 'number') els.progressBar.style.width = msg.percent + '%';
  });

  try {
    const res = await window.faktisk.captionBurnExport({
      url: state.url || undefined,
      inputPath: state.localPath || undefined,
      savePath,
      pngs,
      duration: state.duration,
    });
    if (res.ok) {
      setStatus('Eksportert ✓ ' + savePath.split('/').pop()
        + (res.sizeMB ? ' (' + res.sizeMB + ' MB)' : ''));
      await window.faktisk.revealInFinder(savePath);
    } else {
      setStatus('Eksport feilet: ' + res.error, true);
    }
  } catch (err) {
    setStatus('Eksport feilet: ' + err.message, true);
  } finally {
    unsub();
    els.progressNote.textContent = '';
    updateButtons();
    setTimeout(() => { els.progress.style.display = 'none'; }, 2000);
  }
});

// ============================================================
//  Kilde: Labrador + lokal fil
// ============================================================

const labEls = {
  filesBtn: document.getElementById('labFilesBtn'),
  panel:    document.getElementById('labPanel'),
  status:   document.getElementById('labPanelStatus'),
  list:     document.getElementById('labPanelList'),
};

const VIDEO_EXT = /\.(mp4|mov|mpg|mpeg|m4v|webm)(\?|$)/i;

async function useLabradorUrl(url) {
  els.url.value = url;
  state.localPath = '';
  labEls.panel.style.display = 'none';
  await loadVideo();
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

els.localFileBtn.addEventListener('click', async () => {
  if (typeof window.faktisk.openFileDialog !== 'function') {
    setStatus('Direktevalg krever Studio 0.7.0 eller nyere.', true);
    return;
  }
  const res = await window.faktisk.openFileDialog({
    title: 'Velg videoklipp',
    filters: [{ name: 'Video', extensions: ['mov', 'mp4', 'm4v', 'webm', 'mpg', 'mpeg', 'avi', 'mkv'] }],
  });
  if (!res || res.canceled || !res.path) return;

  state.localPath = res.path;
  els.url.value = '';
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

// ============================================================
//  Manus og ny oppdeling
// ============================================================

els.manusText.addEventListener('input', () => {
  state.manus = els.manusText.value;
  updateButtons();
  scheduleSaveState();
});

els.applyManusBtn.addEventListener('click', async () => {
  if (!state.segments.length || !state.manus.trim()) return;
  const yes = await window.faktiskDialog.confirm(
    'Tilpasse tekstingen til manuset? Der talen stemmer med manus, brukes manusets '
    + 'stavemåte og tegnsetting. Tekstboksene deles opp på nytt, så egne tidsjusteringer '
    + 'forsvinner — men det som faktisk ble sagt utenfor manus, beholdes og markeres gult.');
  if (!yes) return;
  setStatus('Sammenstiller med manus…');
  await new Promise(r => setTimeout(r, 30)); // la statusen tegnes før jobben
  try {
    const m = applyManusToWords(window.TekstDeling.wordsFromSegments(state.segments));
    if (m.error) { setStatus(m.error, true); return; }
    state.segments = m.segments;
    selectedIndex = -1;
    renderSegments();
    scheduleSaveState();
    setStatus('Manus brukt ✓ ' + manusSummary(m.stats));
  } catch (e) {
    console.error(e);
    setStatus('Klarte ikke bruke manuset: ' + e.message, true);
  }
});

els.resegBtn.addEventListener('click', async () => {
  if (!state.segments.length || state.transcribing) return;
  const yes = await window.faktiskDialog.confirm(
    'Dele opp alle tekstboksene på nytt? Teksten beholdes (også det du har rettet), '
    + 'men grensene og tidene settes på nytt — ved punktum, komma og pauser.');
  if (!yes) return;
  try {
    const before = state.segments.length;
    state.segments = resegment(window.TekstDeling.wordsFromSegments(state.segments));
    selectedIndex = -1;
    renderSegments();
    scheduleSaveState();
    setStatus('Delt opp på nytt ✓ ' + before + ' → ' + state.segments.length + ' tekstbokser');
  } catch (e) {
    console.error(e);
    setStatus('Klarte ikke dele opp: ' + e.message, true);
  }
});

// ============================================================
//  Lagring
// ============================================================

let isRestoring = false;
let saveTimer = null;

function serializeState() {
  return {
    url: state.url,
    localPath: state.localPath,
    segments: state.segments,
    model: state.model,
    language: state.language,
    manus: state.manus,
    fcpRes: state.fcpRes,
    capSize: state.capSize,
    boxColor: state.boxColor, anim: state.anim, animIn: state.animIn, animOut: state.animOut,
    capOpacity: state.capOpacity, capX: state.capX, capY: state.capY,
    tiktokSafe: state.tiktokSafe,
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
    if (s.model && /^whisper-(small|medium|large)$/.test(s.model)) {
      state.model = s.model;
      els.modelSelect.value = s.model;
    }
    if (s.language && ['no', 'auto', 'en', 'translate-en'].includes(s.language)) {
      state.language = s.language;
      els.langSelect.value = s.language;
    }
    state.manus = typeof s.manus === 'string' ? s.manus : '';
    els.manusText.value = state.manus;
    if (s.fcpRes === '1080' || s.fcpRes === '2160') state.fcpRes = s.fcpRes;
    if (Number.isFinite(+s.capSize) && s.capSize) state.capSize = +s.capSize;
    if (['0', '1', '2'].includes(String(s.boxColor))) state.boxColor = String(s.boxColor);
    if (['0', '1', '2', '3'].includes(String(s.anim))) state.anim = String(s.anim);
    if (typeof s.animIn === 'boolean') state.animIn = s.animIn;
    if (typeof s.animOut === 'boolean') state.animOut = s.animOut;
    if (Number.isFinite(+s.capOpacity) && s.capOpacity) state.capOpacity = +s.capOpacity;
    if (Number.isFinite(+s.capX)) state.capX = +s.capX;
    if (Number.isFinite(+s.capY)) state.capY = +s.capY;
    if (typeof s.tiktokSafe === 'boolean') state.tiktokSafe = s.tiktokSafe;
    syncCapControls();
    refreshModelStatus();
    if (s.localPath) {
      state.localPath = s.localPath;
      await loadVideo('file://' + encodeURI(s.localPath).replace(/#/g, '%23'));
    } else if (s.url) {
      els.url.value = s.url;
      await loadVideo();
    }
    if (Array.isArray(s.segments) && s.segments.length) {
      state.segments = s.segments;
      renderSegments();
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
  refreshModelStatus();
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
