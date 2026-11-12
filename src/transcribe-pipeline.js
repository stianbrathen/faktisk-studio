// Transkriberingsflyten for teksting-pluginen (whisper.cpp som frittstående
// binær). Flyttet ut av main.js 30.10.2026 så den kan testes fra Terminal
// uten å bygge Studio: node scripts/test-transcribe.js <klipp>
// main.js står for nedlasting av motor/modeller og IPC; alt herfra er ren
// lyd → segmenter.
const fs = require('fs');
const { spawn } = require('child_process');

// Settes av transcribeWav (ffmpeg-sti og VAD-modell)
const cfg = { ffmpeg: 'ffmpeg', vadModel: null };

// Hent lydsporet som 16 kHz mono WAV (formatet whisper-cli forventer)
function extractAudioWav(ffmpeg, inputPath, outFile, opts) {
  const normalize = !(opts && opts.normalize === false);
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpeg, [
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      // Adaptiv nivånormalisering: løfter lav/fjern tale (f.eks. stemme
      // som bare ligger i én kanal — mono-miksen halverer den — eller
      // med musikk over) så Whisper hører den.
      ...(normalize ? ['-af', 'dynaudnorm=f=150:g=15'] : []),
      '-c:a', 'pcm_s16le',
      '-y',
      outFile,
    ]);
    let stderr = '';
    ff.stderr.on('data', c => { stderr += c.toString(); });
    ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
    ff.on('close', code => {
      if (code !== 0) {
        return reject(new Error(
          stderr.includes('does not contain any stream')
          || stderr.includes('Output file does not contain')
            ? 'Videoen har ikke noe lydspor.'
            : 'Klarte ikke hente ut lyden: ' + stderr.split('\n').slice(-3).join(' | ')));
      }
      resolve(outFile);
    });
  });
}

// Varighet av 16 kHz mono s16-WAV rett fra filstørrelsen (ffprobe følger
// ikke med ffmpeg-static): 32 000 byte per sekund + 44 byte header.
function wavDurationSec(file) {
  try { return Math.max(0, (fs.statSync(file).size - 44) / 32000); } catch (e) { return 0; }
}

// Klipp ut et tidsrom av en WAV uten re-koding.
function extractWavSlice(wav, startSec, durSec, outFile) {
  return new Promise((resolve, reject) => {
    const ff = spawn(cfg.ffmpeg, [
      '-ss', String(startSec.toFixed(3)),
      '-t', String(durSec.toFixed(3)),
      // pcm_s16le i stedet for «-c copy»: copy + -ss ga en tom WAV
      // (130 byte) med enkelte ffmpeg-versjoner — da feilet hull-passet stille
      '-i', wav, '-c:a', 'pcm_s16le', '-y', outFile,
    ]);
    ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
    ff.on('close', code => code === 0 ? resolve(outFile)
      : reject(new Error('Klarte ikke klippe ut lydutsnitt (kode ' + code + ')')));
  });
}

// Ord med tider fra whisper-tokens (-ojf). Et token som starter med
// mellomrom begynner et nytt ord; spesialtokens ([_BEG_], [_TT_123]) hoppes
// over. Brukes av teksting-pluginen til å dele opp tekstboksene på ordnivå.
//
// OBS (whisper.cpp v1.9.2, lest i kildekoden): med --vad er segmentenes
// tider kartlagt tilbake til originalopptaket, men TOKEN-tidene i JSON-en
// er ikke — de ligger på den komprimerte tidslinjen der stillhet er klippet
// bort. Vi forankrer derfor ordene til segmentets (riktige) start/slutt:
// ren forskyvning når lengdene stemmer, ellers lineær skalering.
function wordsFromWhisperTokens(tokens, segFrom, segTo) {
  const raw = [];
  let cur = null;
  for (const t of tokens || []) {
    const txt = String(t.text || '');
    if (!txt || /^\s*\[_/.test(txt) || /^\s*<\|/.test(txt)) continue;
    const from = t.offsets && t.offsets.from != null ? t.offsets.from / 1000 : null;
    const to = t.offsets && t.offsets.to != null ? t.offsets.to / 1000 : null;
    if (/^\s/.test(txt) || !cur) {
      const w = txt.trim();
      if (!w) continue;
      cur = { w, start: from, end: to };
      raw.push(cur);
    } else {
      cur.w += txt;
      if (to != null) cur.end = to;
      if (cur.start == null) cur.start = from;
    }
  }
  const words = raw.filter(w => w.w.trim() && w.start != null && w.end != null);
  if (!words.length || words.length !== raw.length) return null;
  const r0 = words[0].start, r1 = Math.max(r0 + 0.01, words[words.length - 1].end);
  const span = Math.max(0.01, segTo - segFrom);
  const exact = Math.abs((r1 - r0) - span) < 0.15;
  const map = t => exact ? segFrom + (t - r0) : segFrom + (t - r0) * span / (r1 - r0);
  let prev = segFrom;
  return words.map(w => {
    const start = Math.max(prev, Math.min(segTo, map(w.start)));
    const end = Math.max(start, Math.min(segTo, map(w.end)));
    prev = start;
    return { w: w.w, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
  });
}

// Én whisper-kjøring → segmenter. vadThreshold styrer hvor forsiktig
// taledeteksjonen er (lavere = mer inkluderende). Med -ojf får hvert
// segment også ordene med tider (seg.words) når de lar seg lese.
function runWhisperPass(cli, wav, commonArgs, outPrefix, vadThreshold, onPercent) {
  // vadThreshold null = uten taledeteksjon (se hull-passet)
  const vadArgs = vadThreshold == null ? []
    : ['--vad', '--vad-model', cfg.vadModel, '--vad-threshold', vadThreshold];
  const args = commonArgs.concat(['-f', wav], vadArgs, [
    '-ojf',
    '-of', outPrefix,
    '--print-progress',
  ]);
  return new Promise((resolve, reject) => {
    const wp = spawn(cli, args);
    let stderr = '';
    wp.stderr.on('data', c => {
      const text = c.toString();
      stderr += text;
      const m = text.match(/progress\s*=\s*(\d+)%/);
      if (m && onPercent) onPercent(parseInt(m[1], 10));
    });
    // KRITISK: stdout MÅ dreneres. whisper-cli skriver transkribert tekst
    // fortløpende dit, og uten en leser fylles rørbufferen (64 KB) —
    // da blokkerer whisper-cli på write og henger for alltid.
    wp.stdout.on('data', () => {});
    wp.on('error', err => reject(new Error('whisper-prosessfeil: ' + err.message)));
    wp.on('close', code => {
      if (code !== 0) {
        return reject(new Error('whisper-cli feilet (kode ' + code + '): '
          + stderr.split('\n').slice(-4).join(' | ')));
      }
      try {
        const jsonPath = outPrefix + '.json';
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        fs.unlinkSync(jsonPath);
        resolve((parsed.transcription || []).map(t => {
          const seg = {
            start: (t.offsets && t.offsets.from != null) ? t.offsets.from / 1000 : 0,
            end: (t.offsets && t.offsets.to != null) ? t.offsets.to / 1000 : 0,
            // Spesialtokens som «<|nocaptions|>» kan lekke inn i teksten
            text: (t.text || '').replace(/<\|[^|>]*\|>/g, ' ').replace(/\s+/g, ' ').trim(),
          };
          // «<|nocaptions|>» = whisper ga opp her (sett over tale med musikk
          // under). Merkes, så hull-passet prøver tidsrommet på nytt.
          if (/<\|nocaptions\|>/.test(t.text || '')) seg.nocap = true;
          // Snitt-sikkerhet over teksttokens (brukes som vern mot diktet tekst)
          const ps = (t.tokens || []).filter(k => k.p != null && !/^\s*\[_/.test(String(k.text || '')))
            .map(k => k.p);
          if (ps.length) seg.p = ps.reduce((x, y) => x + y, 0) / ps.length;
          // Ordtider er en bonus — feiler de, brukes segmentet som før
          try {
            const words = wordsFromWhisperTokens(t.tokens, seg.start, seg.end);
            if (words && words.length) seg.words = words;
          } catch (e) {}
          return seg;
        }).filter(s => s.text || s.nocap));
      } catch (err) {
        reject(new Error('Klarte ikke lese transkriberingsresultatet: ' + err.message));
      }
    });
  });
}


// ---------- Hull-passet: planlegging og filtrering (rene funksjoner) ----------
const normWs = t => String(t).toLowerCase().replace(/[^a-zæøåäöüé0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// «Tynt» segment: noen få ord strukket over lang tid. Typisk når whisper
// mister tråden i et vindu — den skriver et par ord og hopper over flere
// setninger (sett i podkasttest 11.10.2026: «av det. finnes ikke.» over
// 26 s). Normal tale er 10–16 tegn/s; under 4 over minst 2,5 s er mistenkelig.
function isThinSegment(seg) {
  if (seg.nocap) return true;
  const dur = seg.end - seg.start;
  if (dur < 2.5) return false;
  const chars = normWs(seg.text).replace(/ /g, '').length;
  return chars / dur < 4;
}

// Finn tidsrom som skal dekodes på nytt: tomme hull ≥ gapMin, og tynne
// segmenter (de tas ut og legges i g.replaced — legges tilbake hvis
// ny dekoding ikke gir mer tekst). Segmenter som ender i «...» rett før
// et hull er skadde rester og tas med i hullet på samme måte.
function planGaps(segments, totalDur, gapMin, absorbNext) {
  const keep = [], gaps = [];
  const sorted = segments.slice().sort((a, b) => a.start - b.start);
  let cursor = 0, pending = [];
  for (let i = 0; i <= sorted.length; i++) {
    const seg = sorted[i];
    if (seg && isThinSegment(seg)) { pending.push(seg); continue; }
    const gapEnd = seg ? seg.start : totalDur;
    let absorbed = false;
    if (gapEnd - cursor >= gapMin || pending.length) {
      let gapStart = pending.length ? Math.min(cursor, pending[0].start) : cursor;
      const replaced = pending.slice();
      const prev = keep[keep.length - 1];
      if (prev && /(\.\.\.|…)$/.test(prev.text) && gapStart - prev.end < 0.5) {
        gapStart = prev.start;
        replaced.unshift(keep.pop());
      }
      if (gapEnd - gapStart >= 0.5) {
        // absorbNext: segmentet rett etter hullet dekodes på nytt sammen med
        // hullet. Whisper uten VAD hopper gjerne over tale i starten av et
        // nytt 30 s-vindu og stempler neste setning med vindusstarten — så
        // segmentet kan ligge på feil tid og skjule et hull (podkasttest
        // 30.10.2026: «Samtidig pågår …» meldt på 390,06 s, egentlig ~405 s,
        // to setninger før den forsvant). Legges tilbake hvis ny dekoding
        // ikke dekker det (replacedStillNeeded).
        let end = gapEnd, from = i;
        if (absorbNext && seg && seg.end - seg.start <= 10) {
          replaced.push(seg); end = seg.end; from = i + 1; absorbed = true;
        }
        // Nabotekst: de tre segmentene før og de to etter (gjentakelser fra
        // polstringen kan strekke seg over mer enn ett segment)
        const after = sorted.slice(from, from + 4).filter(x => !isThinSegment(x)).slice(0, 2);
        gaps.push({
          start: gapStart, end, replaced,
          prevText: keep.slice(-3).map(x => x.text).join(' '),
          nextText: after.map(x => x.text).join(' '),
        });
      } else keep.push(...replaced);
    }
    pending = [];
    if (seg) { if (!absorbed) keep.push(seg); cursor = Math.max(cursor, seg.end); }
  }
  return { keep, gaps };
}

// Fjern ord i starten av `text` som bare gjentar slutten av `prev`
// (minst 2 ord), og ord på slutten som gjentar starten av `next`.
// Returnerer { text, dropStart, dropEnd } (antall ord fjernet).
function trimRepeatedEdges(text, prev, next) {
  const raw = String(text).trim().split(/\s+/);
  const t = raw.map(normWs);
  const p = normWs(prev).split(' ').filter(Boolean);
  const nx = normWs(next).split(' ').filter(Boolean);
  let dropStart = 0, dropEnd = 0;
  for (let k = Math.min(t.length, p.length, 12); k >= 2; k--) {
    if (t.slice(0, k).join(' ') === p.slice(p.length - k).join(' ')) { dropStart = k; break; }
  }
  for (let k = Math.min(t.length - dropStart, nx.length, 12); k >= 2; k--) {
    if (t.slice(t.length - k).join(' ') === nx.slice(0, k).join(' ')) { dropEnd = k; break; }
  }
  return { text: raw.slice(dropStart, raw.length - dropEnd).join(' '), dropStart, dropEnd };
}

// Levenshtein-avstand (små ord, brukes bare i kantsjekken under)
function editDist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Andel av ordene i `toks` som (omtrent) finnes i nabo-ordsettet `set`.
// Tåler at whisper deler/skriver sammen ulikt fra gang til gang
// («under cover» / «undercover», teaser-test 30.10.2026) og små
// hørselsforskjeller («fox» / «fax»).
function fuzzyShare(toks, set) {
  const words = toks.map(normWs).filter(Boolean);
  if (!words.length) return 0;
  const long = [...set].filter(x => x.length >= 4);
  let hit = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (set.has(w)) { hit++; continue; }
    if (i + 1 < words.length && set.has(w + words[i + 1])) { hit += 2; i++; continue; }
    if (w.length >= 4 && long.some(x => editDist(x, w) <= (w.length >= 6 ? 2 : 1))) { hit++; continue; }
  }
  return hit / words.length;
}

// Filtrer funn fra én hull-dekoding. Whisper gjentar gjerne nabotale:
// 1) ord i funnet som ligger i polstringen FØR hullet (PAD) og som finnes i
//    slutten av forrige segment, er gjentakelser — kuttes. Tilsvarende ord
//    etter hullet som finnes i starten av neste. (Sett i podkasttest:
//    «… bekrefter vi | et langt skriftlig intervju …» to ganger.)
// 2) funn som (normalisert) finnes i nabo-teksten, eller i naboene
//    KOMBINERT (prev + next limt sammen til ett «nytt» segment)
// 3) funn inneholdt i et annet, lengre funn fra samme hull — behold det lengste
function acceptGapFindings(g, found, s0, sliceEnd) {
  const prevN = normWs(g.prevText), nextN = normWs(g.nextText);
  const neighbors = prevN + ' ' + nextN;
  const prevTail = new Set(prevN.split(' ').slice(-30));
  const nextHead = new Set(nextN.split(' ').slice(0, 30));
  const candidates = [];
  for (const s of found) {
    const start = s.start + s0;
    let end = Math.min(s.end + s0, sliceEnd);
    if (start >= g.end - 0.05) continue; // starter ikke i hullet
    let toks = s.text.replace(/(\.\.\.|…)$/, '').trim().split(/\s+/).filter(Boolean);
    let ws = Array.isArray(s.words) && s.words.length === toks.length
      ? s.words.map(w => ({ w: w.w, start: w.start + s0, end: w.end + s0 })) : null;
    if (ws) {
      // Tidsbasert kutt av gjentakelser i kantene
      // Ordene som ligger i polstringen før hullet: er de fleste av dem
      // med i slutten av teksten før, er de en gjentakelse (whisper hører
      // gjerne litt annerledes andre gang: «team fox» → «Team Fax»)
      let a = 0, b = toks.length;
      while (a < b && ws[a].start < g.start - 0.15) a++;
      if (a && fuzzyShare(toks.slice(0, a), prevTail) < 0.6) a = 0;
      while (b > a && ws[b - 1].start > g.end + 0.1) b--;
      const nTail = toks.length - b;
      if (nTail && fuzzyShare(toks.slice(b), nextHead) < 0.6) b = toks.length;
      const cutTail = b < toks.length;
      toks = toks.slice(a, b); ws = ws.slice(a, b);
      // Kuttet halen (gjentakelse av neste segment): slutt ved siste beholdte
      // ord, ikke ved whisper-segmentets slutt — ellers overlapper boksen
      // neste segment (teaser-test 30.10.2026)
      if (cutTail && ws.length) end = Math.min(end, ws[ws.length - 1].end + 0.2);
    } else {
      const tr = trimRepeatedEdges(toks.join(' '), g.prevText, g.nextText);
      toks = tr.text.split(/\s+/).filter(Boolean);
    }
    const text = toks.join(' ');
    if (!text) continue;
    const cStart = Math.max(g.start, ws && ws.length ? ws[0].start : start);
    if (end - cStart <= 0.2) continue;
    const n = normWs(text);
    if (!n) continue;
    if (prevN.includes(n) || nextN.includes(n) || neighbors.includes(n)) continue;
    const c = { start: cStart, end, text, n, p: s.p };
    if (ws && ws.length) {
      c.words = ws.map(w => ({ w: w.w,
        start: Math.round(Math.max(c.start, Math.min(end, w.start)) * 1000) / 1000,
        end: Math.round(Math.max(c.start, Math.min(end, w.end)) * 1000) / 1000 }));
    }
    candidates.push(c);
  }
  candidates.sort((a, b) => b.n.length - a.n.length);
  const accepted = [];
  for (const c of candidates) {
    if (accepted.some(a => a.n.includes(c.n))) continue;
    accepted.push(c);
  }
  return accepted;
}

// Skal et segment vi tok ut (tynt/«...»-rest) legges tilbake? Ja, med
// mindre den nye dekodingen dekker minst 60 % av ordene i det.
function replacedStillNeeded(seg, accepted) {
  const got = new Set(accepted.map(c => c.n).join(' ').split(' '));
  const ws = normWs(String(seg.text).replace(/<\|[^|>]*\|>/g, ' ')).split(' ').filter(Boolean);
  if (!ws.length) return false;
  return ws.filter(w => got.has(w)).length / ws.length < 0.6;
}


// ---------- Hele flyten: pass 1 + hull-pass ----------
//
// Endret 30.10.2026 (teaser-test mot JoJo, se kunnskapsbase/teksting_vad_jojo_test.md):
// - Pass 1 kjører UTEN VAD. Med VAD 0.2 fant NB-Whisper large bare 2 av 9
//   setninger i et klipp med telefonlyd og musikk; uten VAD kom alt med.
//   (VAD ble innført mot tap ved 30 s-vinduet før hull-passet fantes —
//   hull-passet tar nå den jobben.)
// - Hull ned til 1,0 s undersøkes (tapet ved vindusgrensa var et 1,1 s-hull).
// - Store hull deles i biter på maks 20 s, så utsnittet (bit + PAD + EXTEND)
//   holder seg under 30 s-vinduet. Et 28 s-hull ga et 33 s-utsnitt, og
//   teksten etter vindusgrensa forsvant igjen — i selve hull-passet.
// - Uten-VAD-forsøket i hullet kjøres også når VAD-forsøket ikke fant noe,
//   med vern mot diktet tekst i helt tomme hull.
const GAP_MIN = 1.0;     // sekunder uten tekst før vi undersøker
const PAD = 2.5;         // kontekst FØR hullet (whisper er følsom for hvor
                         // utsnittet starter: med 0,25 s mistet den ord)
const EXTEND = 2.5;      // dekod et stykke inn i neste segment, så setninger
                         // som krysser hullkanten blir hele
const MAX_PIECE = 20;    // maks hull-bit; + PAD + EXTEND = 25 s < 30 s-vinduet
const MAX_GAPS = 40;     // sikkerhetstak for kjøretid
const MIN_P_EMPTY_GAP = 0.6;  // snitt-sikkerhet for funn uten VAD i tomme hull
// Kjente whisper-spøkelser fra stillhet/musikk (lært fra undertekstdata)
const HALLUCINATION = /teksting av|undertekst|takk for at du (så|ser|lytt)|abonner|amara\.org|nicolai winther/i;

const textLen = acc => acc.reduce((n, c) => n + c.n.length, 0);

async function decodeGapPiece(o, g, commonArgs, totalDur, prefix, dbg) {
  const s0 = Math.max(0, g.start - PAD);
  const sliceEnd = Math.min(totalDur, g.end + EXTEND);
  const sliceWav = prefix + '.wav';
  try {
    await extractWavSlice(o.wav, s0, sliceEnd - s0, sliceWav);
    // VAD 0.1 i hullet: her VET vi at hovedpasset ikke fant noe
    const found = await runWhisperPass(o.cli, sliceWav, commonArgs, prefix, '0.1', null);
    let accepted = acceptGapFindings(g, found, s0, sliceEnd);
    dbg('  hull ' + g.start.toFixed(2) + '–' + g.end.toFixed(2)
      + ' (utsnitt ' + s0.toFixed(2) + '–' + sliceEnd.toFixed(2) + ')');
    dbg('    VAD 0.1 fant:  ' + JSON.stringify(found.map(s => s.text)));
    dbg('    VAD 0.1 tok:   ' + JSON.stringify(accepted.map(c => c.text)));
    // VAD kan selv være problemet (klipper bort musikken mellom ordene).
    // Prøv uten VAD når VAD-forsøket ikke fant noe, eller når et tynt
    // segment fra hovedpasset fortsatt ikke er dekket.
    // Kjør også uten VAD når VAD-forsøket dekker under 60 % av hullet
    // (podkasttest 30.10.2026: VAD fant noe i et 20 s-hull og tok resten
    // for ikke-tale, så forsøket uten VAD ble aldri prøvd).
    const covered = accepted.reduce((n, c) => n + Math.max(0, c.end - c.start), 0)
      / Math.max(0.5, g.end - g.start);
    if (!accepted.length || covered < 0.6
        || g.replaced.some(r => replacedStillNeeded(r, accepted))) {
      const found2 = await runWhisperPass(o.cli, sliceWav, commonArgs, prefix + 'b', null, null);
      let accepted2 = acceptGapFindings(g, found2, s0, sliceEnd);
      // I helt tomme hull kan whisper uten VAD dikte tekst — krev høy
      // sikkerhet og ingen kjente spøkelsesfraser
      if (!g.replaced.length) {
        accepted2 = accepted2.filter(c =>
          (c.p == null || c.p >= MIN_P_EMPTY_GAP) && !HALLUCINATION.test(c.text));
      }
      dbg('    uten VAD fant: ' + JSON.stringify(found2.map(s => s.text + ' [p=' + (s.p != null ? s.p.toFixed(2) : '?') + ']')));
      dbg('    uten VAD tok:  ' + JSON.stringify(accepted2.map(c => c.text)));
      // Flett: start med det lengste resultatet, legg til funn fra det
      // andre som ikke (omtrent) gjentar ord som allerede er med
      let base = accepted, other = accepted2;
      if (textLen(accepted2) > textLen(accepted)) { base = accepted2; other = accepted; }
      const have = new Set(base.map(c => c.n).join(' ').split(' ').filter(Boolean));
      const extra = other.filter(c => fuzzyShare(c.text.split(/\s+/), have) < 0.5);
      if (extra.length) dbg('    flettet inn:   ' + JSON.stringify(extra.map(c => c.text)));
      accepted = base.concat(extra);
    }
    return accepted;
  } finally {
    try { fs.unlinkSync(sliceWav); } catch (e) {}
  }
}

// o: { cli, ffmpeg, wav, model, vadModel, lang, translate, prompt,
//      tmpPrefix, send, debug, pass1Vad }
async function transcribeWav(o) {
  cfg.ffmpeg = o.ffmpeg;
  cfg.vadModel = o.vadModel;
  const send = o.send || (() => {});
  const dbg = o.debug || (() => {});
  const commonArgs = ['-m', o.model, '-l', o.lang || 'no',
    '-bs', '5'];           // beam search: dropper færre setninger enn grådig
  if (o.translate) commonArgs.push('-tr');
  // Hint (--prompt) brukes IKKE lenger som standard (30.10.2026): på
  // teaser-testen kostet Faktisk-ordlista hele setninger med NB-Whisper
  // large — med lydnormalisering mistet den «Nei, nå gud …», uten
  // normalisering diktet den en falsk speakersetning. Samme lyd uten hint
  // ble komplett. Manus-justeringen i pluginen retter stavingen etterpå.
  // o.usePrompt = true slår det på igjen (for testing).
  const pass1Args = o.usePrompt && o.prompt ? commonArgs.concat(['--prompt', o.prompt]) : commonArgs;
  const totalDur = wavDurationSec(o.wav);

  send({ phase: 'transcribing', percent: 0 });
  let segments = await runWhisperPass(o.cli, o.wav, pass1Args, o.tmpPrefix,
    o.pass1Vad || null, p => send({ phase: 'transcribing', percent: p }));
  // Uten VAD kan whisper melde segmenter forbi slutten av lyden
  // (sett: «<|nocaptions|>» 60–90 s i et 64 s-klipp)
  segments = segments.filter(s => s.start < totalDur)
    .map(s => (s.end > totalDur ? Object.assign(s, { end: totalDur }) : s));
  dbg('PASS 1 (' + (o.pass1Vad ? 'VAD ' + o.pass1Vad : 'uten VAD') + '):');
  for (const s of segments) dbg('  ' + s.start.toFixed(2) + '–' + s.end.toFixed(2) + '  ' + (s.nocap ? '<nocaptions> ' : '') + s.text);

  if (!(totalDur > 0 && segments.length)) return segments.filter(x => x.text);

  // absorbNext er AV: podkasttest 30.10.2026 kveld («ny3») reddet to setninger,
  // men ga 18 overlappende/doble segmenter og mistet andre. Koden står for
  // videre arbeid (se kunnskapsbase/teksting_vad_jojo_test.md).
  const { keep, gaps } = planGaps(segments, totalDur, GAP_MIN, false);
  dbg('HULL-PASS: ' + gaps.length + ' hull');
  // Hull over taket: legg tilbake det vi tok ut, så ingenting forsvinner
  for (const g of gaps.slice(MAX_GAPS)) keep.push(...g.replaced);
  const todo = gaps.slice(0, MAX_GAPS);
  for (let i = 0; i < todo.length; i++) {
    const g = todo[i];
    send({ phase: 'transcribing-gaps', percent: Math.round(i / todo.length * 100) });
    const found = [];
    let ok = false;
    try {
      // Store hull i biter, i rekkefølge. Neste bit starter etter det
      // forrige bit fant, og forrige funn regnes som nabotekst (duplikatvern).
      let cursor = g.start, prevText = g.prevText, k = 0;
      while (g.end - cursor >= 0.5) {
        const pEnd = Math.min(g.end, cursor + MAX_PIECE);
        const last = pEnd >= g.end - 0.01;
        const piece = { start: cursor, end: pEnd, replaced: last ? g.replaced : [],
          prevText, nextText: last ? g.nextText : '' };
        const acc = await decodeGapPiece(o, piece, commonArgs, totalDur,
          o.tmpPrefix + '-gap' + i + '-' + (k++), dbg);
        found.push(...acc);
        if (acc.length) prevText = (prevText + ' ' + acc.map(c => c.text).join(' ')).trim();
        if (last) break;
        const accEnd = acc.reduce((m, c) => Math.max(m, c.end), 0);
        cursor = Math.min(g.end, Math.max(pEnd, accEnd));
      }
      ok = true;
    } catch (e) {
      // Hull-passet er best effort — hovedresultatet står seg uansett
      console.error('Hull-pass feilet for', g.start.toFixed(1), '–', g.end.toFixed(1), ':', e.message);
    }
    for (const c of found) {
      const seg = { start: c.start, end: c.end, text: c.text };
      if (c.words) seg.words = c.words;
      keep.push(seg);
    }
    // Det vi tok ut, legges tilbake med mindre ny dekoding dekket det
    // — ingenting forsvinner i stillhet
    for (const r of g.replaced) if (!ok || replacedStillNeeded(r, found)) keep.push(r);
  }
  return keep.filter(x => x.text).sort((a, b) => a.start - b.start);
}

module.exports = {
  extractAudioWav, transcribeWav, wavDurationSec,
  // rene funksjoner, eksportert for testing
  planGaps, acceptGapFindings, isThinSegment, trimRepeatedEdges,
};
