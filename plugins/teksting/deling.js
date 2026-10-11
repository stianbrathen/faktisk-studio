// Faktisk Studio · Teksting — oppdeling, linjebryting og manus
//
// Ren logikk uten DOM, så den kan testes i Node (module.exports) og
// brukes i pluginen (window.TekstDeling).
//
//   balanceLines(text, budget)        → linjer i én tekstboks
//   segmentWords(words, budget)       → tekstbokser (segmenter) fra ord med tider
//   wordsFromSegments(segments)       → ord med tider fra eksisterende segmenter
//   alignToManus(words, manus)        → ordene med manusets stavemåte/tegnsetting
//   promptFromManus(manus)            → kort hint (navn, fagord) til whisper
//
// Prinsipp: et brudd har en «pris». Etter punktum er billig, etter komma og
// ved pauser i talen også. Etter preposisjon/artikkel, mellom fornavn og
// etternavn og mellom tall og enhet er dyrt. Dynamisk programmering velger
// den billigste oppdelingen av HELE teksten — i stedet for å fylle til det
// er fullt og bryte der plassen tar slutt.
//
// Regel (som resten av pluginen): ingen ord kastes noen gang i stillhet.

(function (root) {
  'use strict';

  // ------------------------------------------------------------
  //  Ordlister (bokmål + vanlige nynorskformer)
  // ------------------------------------------------------------
  const set = s => new Set(s.split(/\s+/).filter(Boolean));

  // Svært dårlig å slutte en linje/boks på disse: de hører til neste ord.
  const BIND_STRONG = set(`
    en ei et ett eit
    på i til av med fra frå om under over ved mot etter hos uten utan mellom
    gjennom blant rundt langs innen bak foran før via per pr inn ut opp ned
    min mi mitt mine din di ditt dine sin si sitt sine vår vårt våre
    hans hennes deres deira dens dets
    denne dette disse hver kvar hvert kvart enhver noen noe nokon noko ingen
    alle begge flere fleire mange få mye mykje litt hele heile selve sjølve
    nest mest minst mer meir
    herr fru dr professor statsminister minister president ordfører
  `);
  // Litt dårlig: hjelpeverb, subjektspronomen og tvetydige småord.
  const BIND_WEAK = set(`
    det den de dei som har hadde er var blir ble vert vart skal skulle kan
    kunne vil ville må måtte bør burde får fikk
    jeg eg du han hun ho vi me dere de man ein
    ikke ikkje ikkje aldri også ogso bare berre så
  `);
  // Godt å bryte FØR disse (de innleder ny setningsdel).
  const CONJ = set(`
    og men eller for så som at fordi når hvis om mens da der enn dersom
    selv sjølv likevel derfor deretter etterpå samtidig både verken hverken
    hvor kor hva kva hvem kven hvorfor kvifor hvordan korleis
  `);
  const UNITS = set(`
    prosent % prosentpoeng kroner kr kroner. millioner million mill milliarder
    milliard mrd tusen hundre år året måneder måneder dager døgn timer minutter
    sekunder meter m km kilometer kilo kg tonn grader dollar euro
  `);

  const SENT_END = /[.!?…]["»”’)\]]*$/;
  const CLAUSE_END = /[,;:]["»”’)\]]*$|[–—]$/;
  const UPPER_START = /^["«(]*\p{Lu}/u;
  const DIGIT_END = /\d[\d.,]*$/;

  function bare(w) {
    return String(w || '').toLowerCase()
      .replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, '');
  }

  // Faste uttrykk som ikke bør deles over to linjer eller to bokser.
  const FIXED = [
    'på grunn av', 'i forhold til', 'når det gjelder', 'blant annet', 'for eksempel',
    'i stedet for', 'i staden for', 'i tillegg', 'ved hjelp av', 'til tross for',
    'på tross av', 'i løpet av', 'etter hvert', 'i hvert fall', 'i alle fall',
    'først og fremst', 'rett og slett', 'mer enn', 'mindre enn', 'flere enn',
    'færre enn', 'så langt', 'så mye', 'så mange', 'i fjor', 'i år', 'i dag',
    'i går', 'i morgen', 'i kveld', 'i natt', 'i sommer', 'i vinter', 'i høst',
    'i vår', 'i stand', 'om lag', 'cirka', 'over hele', 'ikke minst', 'ikke bare',
    'både og', 'enten eller', 'sosiale medier', 'kunstig intelligens',
  ].map(p => p.split(' '));

  // Pris for å bryte MELLOM ws[k] og ws[k+1] (ws = ordstrenger).
  // Negativ = godt sted, positiv = dårlig sted. Felles for linjer og bokser.
  function breakCost(ws, k) {
    const a = ws[k], b = ws[k + 1];
    if (b == null) return 0;
    let c = 0;
    if (SENT_END.test(a)) c -= 10;
    else if (CLAUSE_END.test(a) || b === '–' || b === '—') c -= 5;
    // «Nord- og Sør-Norge»: ordet som slutter på bindestrek hører til neste
    if (/\p{L}-$/u.test(a)) return c + 12;
    const punctAfterA = /[^\p{L}\p{N}%]$/u.test(a);
    if (punctAfterA) return c;
    const ba = bare(a), bb = bare(b);
    if (BIND_STRONG.has(ba)) c += 10;
    else if (BIND_WEAK.has(ba)) c += 3;
    if (CONJ.has(bb)) c -= 3;
    // Fornavn Etternavn: ikke riv navn fra hverandre
    if (UPPER_START.test(a) && UPPER_START.test(b)) c += 12;
    // Egennavn midt i setningen kan fortsette med små bokstaver
    // («Statens vegvesen», «Oslo kommune») — svak preferanse mot brudd
    else if (UPPER_START.test(a) && k > 0 && !SENT_END.test(ws[k - 1])) c += 2;
    // 20 | prosent, 3,5 | millioner
    if (DIGIT_END.test(a) && (UNITS.has(bb) || /^\d/.test(bb))) c += 12;
    // Faste uttrykk som krysser bruddet
    for (const ph of FIXED) {
      for (let s = 1; s < ph.length; s++) {           // bruddet ligger etter ph[s-1]
        let ok = true;
        for (let q = 0; q < ph.length && ok; q++) {
          const w = ws[k - (s - 1) + q];
          if (w == null) { ok = false; break; }
          // tegnsetting inni uttrykket betyr at det ikke er uttrykket
          if (q < ph.length - 1 && /[^\p{L}\p{N}]$/u.test(w)) ok = false;
          if (bare(w) !== ph[q]) ok = false;
        }
        if (ok) return c + 9;
      }
    }
    return c;
  }

  // ------------------------------------------------------------
  //  Linjer i én boks
  // ------------------------------------------------------------
  //
  // Minst mulig antall linjer innenfor budsjettet; blant delingene med det
  // antallet: jevnest mulig (kvadrert slakk) PLUSS bruddprisen, så «på |
  // huset» og «Jonas | Gahr Støre» unngås når det finnes et like jevnt
  // alternativ, og komma/punktum foretrekkes som linjeskift.
  const LINE_BREAK_WEIGHT = 6; // én bruddpris-enhet ≈ 6 «slakk²»

  // words: ordstrenger. bc(k) = bruddpris etter words[k] (standard: regnes ut).
  // Returnerer { lines, penalty } der penalty er summen av positive
  // bruddpriser ved linjeskiftene (brukes når boksene velges), eller null.
  function balanceIntoK(words, k, maxChars, bc) {
    const n = words.length;
    const bcAt = bc || (q => breakCost(words, q));
    const len = new Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) len[i + 1] = len[i] + words[i].length;
    const lineLen = (p, i) => len[i] - len[p] + (i - p - 1); // ord p..i-1
    if (k === 1) return lineLen(0, n) <= maxChars ? { lines: [words.join(' ')], penalty: 0 } : null;
    if (k > n) return null;
    const INF = Infinity;
    const dp = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(INF));
    const cut = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(-1));
    const bcs = new Array(n).fill(0);
    for (let q = 0; q < n - 1; q++) bcs[q] = bcAt(q);
    dp[0][0] = 0;
    for (let j = 1; j <= k; j++) {
      for (let i = j; i <= n; i++) {
        for (let p = j - 1; p < i; p++) {
          if (dp[p][j - 1] === INF) continue;
          const L = lineLen(p, i);
          if (L > maxChars) continue;
          const slack = maxChars - L;
          let cost = dp[p][j - 1] + slack * slack;
          if (i < n) cost += LINE_BREAK_WEIGHT * bcs[i - 1];
          if (cost < dp[i][j]) { dp[i][j] = cost; cut[i][j] = p; }
        }
      }
    }
    if (dp[n][k] === INF) return null;
    const lines = [];
    let penalty = 0;
    let i = n;
    for (let j = k; j >= 1; j--) {
      const p = cut[i][j];
      lines.unshift(words.slice(p, i).join(' '));
      if (i < n) penalty += Math.max(0, bcs[i - 1]);
      i = p;
    }
    return { lines, penalty };
  }

  function balanceLines(text, budget) {
    const { maxChars, maxLines } = budget;
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { lines: [], tooLong: false, maxLines };
    for (let k = 1; k <= maxLines; k++) {
      const best = balanceIntoK(words, k, maxChars);
      if (best) return { lines: best.lines, tooLong: false, maxLines };
    }
    // For langt: utvid tegnbudsjettet til ALLE ord får plass på maks antall
    // linjer. Boksene blir for brede (advarsel vises), men ingen ord forsvinner.
    const k = Math.min(maxLines, words.length);
    for (let b = maxChars + 2; ; b += 2) {
      const best = balanceIntoK(words, k, b);
      if (best) return { lines: best.lines, tooLong: true, maxLines };
    }
  }

  // Får ordene plass på maxLines linjer à maxChars? (grådig fylling er
  // optimal for selve ja/nei-spørsmålet)
  function fits(words, i, j, maxChars, maxLines) {
    let lines = 1, cur = 0;
    for (let k = i; k <= j; k++) {
      const L = words[k].w.length;
      if (L > maxChars) return false;
      if (cur === 0) cur = L;
      else if (cur + 1 + L <= maxChars) cur += 1 + L;
      else { lines++; cur = L; if (lines > maxLines) return false; }
    }
    return true;
  }

  // ------------------------------------------------------------
  //  Oppdeling i tekstbokser
  // ------------------------------------------------------------
  //
  // words: [{ w, start, end, f? }] i tidsrekkefølge.
  // Returnerer segmenter { start, end, text, words, flags? }.
  const SEG = {
    perBox: 8,          // fast pris per boks: hindrer unødvendig mange små
    minDur: 1.0,        // kortere boks enn dette er vanskelig å rekke å lese
    shortCost: 45,      // per sekund under minDur
    maxCps: 17,         // tegn per sekund før det blir for raskt å lese
    cpsCost: 3,
    maxDur: 7,          // lengre enn dette blir stående for lenge
    longCost: 4,
    innerSentence: 12,  // en setning slutter MIDT i boksen
    innerPause: 0.7,    // pauser lenger enn dette inni en boks koster
    innerPauseCost: 20,
    pauseBonus: 8,      // per sekund pause etter boksen (maks 1 s)
    linger: 0.5,        // boksen står litt etter siste ord, om det er luft
    maxWords: 30,
  };

  function segmentWords(words, budget, opts) {
    const o = Object.assign({}, SEG, opts || {});
    const { maxChars, maxLines } = budget;
    const n = words.length;
    if (!n) return [];

    const ws = words.map(w => w.w);
    const bc = ws.map((_, k) => breakCost(ws, k));
    // Prisen for linjeskiftene inni en kandidatboks (i..j): finnes det bare
    // dårlige steder å skifte linje («på grunn | av»), er boksen dårlig.
    const linePenalty = (i, j) => {
      const sub = ws.slice(i, j + 1);
      for (let k = 1; k <= maxLines; k++) {
        const r = balanceIntoK(sub, k, maxChars, q => bc[i + q]);
        if (r) return r.penalty;
      }
      return 0;
    };
    const gapAfter = i => (i < n - 1 ? Math.max(0, words[i + 1].start - words[i].end) : 1);
    const best = new Array(n + 1).fill(Infinity);
    const from = new Array(n + 1).fill(-1);
    best[0] = 0;

    for (let j = 0; j < n; j++) {           // boksen slutter på ord j
      let chars = -1, inner = 0;
      for (let i = j; i >= 0 && j - i < o.maxWords; i--) {   // og starter på ord i
        if (best[i] === Infinity) { chars += words[i].w.length + 1; continue; }
        chars += words[i].w.length + 1;
        if (i < j) {
          // pris for det som skjer MELLOM ord i og i+1 inni boksen
          if (SENT_END.test(words[i].w)) inner += o.innerSentence;
          const p = gapAfter(i);
          if (p > o.innerPause) inner += (p - o.innerPause) * o.innerPauseCost;
        }
        if (!fits(words, i, j, maxChars, maxLines)) {
          // Ett enkelt ord som ikke får plass må likevel kunne stå alene
          if (i !== j) break;
        }
        const speech = Math.max(0.05, words[j].end - words[i].start);
        const shown = speech + Math.min(o.linger, gapAfter(j));
        let cost = best[i] + o.perBox + inner + linePenalty(i, j);
        if (shown < o.minDur) cost += (o.minDur - shown) * o.shortCost;
        if (shown > o.maxDur) cost += (shown - o.maxDur) * o.longCost;
        const cps = chars / Math.max(shown, 0.5);
        if (cps > o.maxCps) cost += (cps - o.maxCps) * o.cpsCost;
        if (j < n - 1) {
          cost += bc[j];
          cost -= Math.min(1, gapAfter(j)) * o.pauseBonus;
        }
        if (cost < best[j + 1]) { best[j + 1] = cost; from[j + 1] = i; }
      }
    }

    // Rekonstruer
    const ranges = [];
    for (let j = n; j > 0; ) {
      let i = from[j];
      if (i < 0) i = j - 1; // skal ikke skje — men aldri mist ord
      ranges.unshift([i, j - 1]);
      j = i;
    }

    // Tider: start på første ord, slutt litt etter siste ord (om det er
    // luft), minst minDur når mulig, og små hull lukkes så boksene ikke
    // blinker av og på.
    const segs = ranges.map(([i, j]) => {
      const ws = words.slice(i, j + 1);
      const seg = {
        start: ws[0].start,
        end: ws[ws.length - 1].end,
        text: ws.map(w => w.w).join(' '),
        words: ws.map(w => {
          const c = { w: w.w, start: round3(w.start), end: round3(w.end) };
          if (w.f) { c.f = w.f; if (w.h) c.h = w.h; }
          return c;
        }),
      };
      const flags = ws.filter(w => w.f === 'avvik' || w.f === 'sjekk')
        .map(w => ({ type: w.f, word: w.w, heard: w.h || '' }));
      if (flags.length) seg.flags = flags;
      return seg;
    });
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k], next = segs[k + 1];
      const limit = next ? next.start : Infinity;
      if (k > 0) s.start = Math.max(s.start, segs[k - 1].end);
      s.end = Math.min(limit, s.end + o.linger);
      if (s.end - s.start < o.minDur) s.end = Math.min(limit, s.start + o.minDur);
      if (next && next.start - s.end < 0.25) s.end = next.start;
      if (s.end <= s.start) s.end = s.start + 0.2;
      s.start = round3(s.start); s.end = round3(s.end);
    }
    return segs;
  }

  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ------------------------------------------------------------
  //  Ord fra eksisterende segmenter
  // ------------------------------------------------------------
  //
  // Har segmentet ordtider fra whisper (seg.words) og teksten er uendret,
  // brukes de. Er teksten redigert (eller ordtider mangler, f.eks. fra
  // eldre Studio), fordeles tiden på ordene etter lengde — redigeringene
  // dine beholdes alltid.
  const normKey = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  function wordsFromSegments(segments) {
    const out = [];
    for (const seg of segments || []) {
      // Spesialtokens fra whisper («<|nocaptions|>») er aldri tekst
      const text = String(seg.text || '').replace(/<\|[^|>]*\|>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const toks = text.split(/\s+/);
      if (Array.isArray(seg.words) && seg.words.length
          && normKey(seg.words.map(w => w.w).join(' ')) === normKey(text)
          && seg.words.length === toks.length) {
        // Samme ord — men ta med tegnsettingen fra teksten (kan være rettet)
        seg.words.forEach((w, k) => {
          const c = { w: toks[k], start: w.start, end: w.end };
          if (w.f) { c.f = w.f; if (w.h) c.h = w.h; }
          out.push(c);
        });
        continue;
      }
      const total = toks.reduce((a, t) => a + t.length + 1, 0);
      const dur = Math.max(0.05, seg.end - seg.start);
      let t = seg.start;
      for (const tok of toks) {
        const d = dur * (tok.length + 1) / total;
        out.push({ w: tok, start: t, end: t + d * 0.92, est: true });
        t += d;
      }
    }
    // Sørg for stigende tider (hull-passet kan gi små overlapp)
    for (let k = 1; k < out.length; k++) {
      if (out[k].start < out[k - 1].start) out[k].start = out[k - 1].start;
      if (out[k].end < out[k].start) out[k].end = out[k].start;
    }
    return out;
  }

  // Ord fra whisper-tokens (-ojf). Tokens som starter med mellomrom
  // begynner et nytt ord; spesialtokens ([_BEG_], [_TT_123], <|…|>) hoppes over.
  function wordsFromTokens(tokens, offsetSec) {
    const off = offsetSec || 0;
    const words = [];
    let cur = null;
    for (const t of tokens || []) {
      const txt = String(t.text || '');
      if (!txt || /^\s*\[_/.test(txt) || /^\s*<\|/.test(txt)) continue;
      const from = t.offsets && t.offsets.from != null ? t.offsets.from / 1000 + off : null;
      const to = t.offsets && t.offsets.to != null ? t.offsets.to / 1000 + off : null;
      if (/^\s/.test(txt) || !cur) {
        const w = txt.trim();
        if (!w) continue;
        cur = { w, start: from, end: to };
        words.push(cur);
      } else {
        cur.w += txt;
        if (to != null) cur.end = to;
        if (cur.start == null) cur.start = from;
      }
    }
    return words.filter(w => w.w.trim());
  }

  // ------------------------------------------------------------
  //  Manus
  // ------------------------------------------------------------
  const NUM = {
    null: 0, en: 1, ett: 1, ei: 1, eitt: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6,
    sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12, tretten: 13,
    fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19,
    tjue: 20, tyve: 20, tretti: 30, tredve: 30, førti: 40, førr: 40, femti: 50,
    seksti: 60, sytti: 70, søtti: 70, åtti: 80, nitti: 90, hundre: 100, tusen: 1000,
  };
  const TENS = ['tjue', 'tyve', 'tretti', 'tredve', 'førti', 'femti', 'seksti', 'sytti', 'søtti', 'åtti', 'nitti'];
  function numValue(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s in NUM) return NUM[s];
    for (const t of TENS) {
      if (s.startsWith(t)) {
        const rest = s.slice(t.length);
        if (rest in NUM && NUM[rest] < 10 && NUM[rest] > 0) return NUM[t] + NUM[rest];
      }
    }
    // «tjuetjueseks» o.l. tolkes ikke — da blir det et vanlig avvik
    return null;
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  const sim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length, 1));

  // Hvor godt to ord (normalisert) passer: 2 = likt, 1 = stavevariant,
  // 0 = beslektet, negativt = forskjellig.
  function pairScore(a, b) {
    if (a === b) return 2;
    const va = numValue(a), vb = numValue(b);
    if (va != null && vb != null && va === vb && (/^\d+$/.test(a) || /^\d+$/.test(b))) return 2;
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) / 2) return -1.5;
    const s = sim(a, b);
    if (s >= 0.75) return 1;
    if (s >= 0.5) return 0;
    return -1.5;
  }

  function cleanManus(text) {
    return String(text || '')
      .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')     // [regi], {notater}
      .replace(/\([^)]*\)/g, ' ')                 // (VIDEO …), (husk å …)
      // Replikk-etiketter alene på linjen: «Ina:», «Hjalti:», «Speaker 2:»
      .replace(/^[ \t]*[\p{Lu}][\p{L}.\-]{0,20}(?:[ \t][\p{L}\d.\-]{1,20})?:[ \t]*$/gmu, ' ')
      .replace(/^\s*#+\s*/gm, '')                 // markdown-overskrifter
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ') // tidskoder
      .replace(/[“”]/g, '"');
  }

  const GAP_T = -1.0;   // ord i talen som ikke står i manus
  const GAP_M = -0.7;   // ord i manus som ikke ble sagt (billig: manus har ofte mer)
  const MAX_CELLS = 40e6;

  // Sammenstill talen (ord med tider) med manus. Returnerer
  // { words, stats } der words har manusets stavemåte og tegnsetting der de
  // stemmer, og talens ord (markert f:'avvik') der taleren gikk utenfor
  // manus. Tidene kommer alltid fra talen.
  function alignToManus(words, manusText) {
    const M = cleanManus(manusText).split(/\s+/).filter(t => normKey(t));
    const T = words;
    const n = T.length, m = M.length;
    const stats = { matched: 0, corrected: 0, check: 0, offScript: 0, skipped: 0, manusWords: m };
    if (!n || !m) return { words: T.slice(), stats, ok: false, reason: 'tomt' };
    if ((n + 1) * (m + 1) > MAX_CELLS) {
      return { words: T.slice(), stats, ok: false, reason: 'for langt' };
    }
    const tn = T.map(w => normKey(w.w));
    const mn = M.map(normKey);
    // Poeng per unike ordpar, regnet ut én gang (Levenshtein er det dyre)
    const ids = (arr, map) => arr.map(x => { if (!map.has(x)) map.set(x, map.size); return map.get(x); });
    const tMap = new Map(), mMap = new Map();
    const tid = ids(tn, tMap), mid = ids(mn, mMap);
    const tU = [...tMap.keys()], mU = [...mMap.keys()];
    const UM = mU.length;
    const useCache = tU.length * UM <= 8e6;
    const cache = useCache ? new Float32Array(tU.length * UM).fill(NaN) : null;
    const score = (i, j) => {
      if (!useCache) return pairScore(tn[i], mn[j]);
      const key = tid[i] * UM + mid[j];
      let v = cache[key];
      if (v !== v) { v = pairScore(tU[tid[i]], mU[mid[j]]); cache[key] = v; }
      return v;
    };

    const W = m + 1;
    const tr = new Uint8Array((n + 1) * W);
    // tre rader med poeng (to-stegs trekk trenger i-2)
    let r2 = new Float64Array(W), r1 = new Float64Array(W), r0 = new Float64Array(W);
    // rad 0: manus-prefiks hoppes over gratis (klippet kan starte midt i manus)
    for (let j = 0; j <= m; j++) { r0[j] = 0; tr[j] = 3; }
    tr[0] = 0;
    for (let i = 1; i <= n; i++) {
      [r2, r1, r0] = [r1, r0, r2];
      const cur = r0, up = r1, up2 = r2;
      cur[0] = up[0] + GAP_T; tr[i * W] = 2;
      for (let j = 1; j <= m; j++) {
        let best = up[j - 1] + score(i - 1, j - 1), t = 1;
        let v = up[j] + GAP_T; if (v > best) { best = v; t = 2; }
        v = cur[j - 1] + GAP_M; if (v > best) { best = v; t = 3; }
        // 1 talt ord = 2 manusord («facebookgruppa» / «Facebook-gruppa» ↔ «Facebook gruppa»)
        if (j >= 2 && tn[i - 1] === mn[j - 2] + mn[j - 1]) {
          v = up[j - 2] + 3; if (v > best) { best = v; t = 4; }
        }
        // 2 talte ord = 1 manusord
        if (i >= 2 && mn[j - 1] === tn[i - 2] + tn[i - 1]) {
          v = up2[j - 1] + 3; if (v > best) { best = v; t = 5; }
        }
        cur[j] = best; tr[i * W + j] = t;
      }
    }
    // Manus-hale etter siste talte ord er også gratis: velg beste slutt
    let jEnd = 0, bestEnd = -Infinity;
    for (let j = 0; j <= m; j++) if (r0[j] > bestEnd) { bestEnd = r0[j]; jEnd = j; }

    const ops = [];
    let i = n, j = jEnd;
    while (i > 0) {
      const t = tr[i * W + j];
      if (t === 1) { ops.push({ k: 'pair', ti: i - 1, mj: j - 1 }); i--; j--; }
      else if (t === 2) { ops.push({ k: 'talk', ti: i - 1 }); i--; }
      else if (t === 3) { ops.push({ k: 'skip', mj: j - 1 }); j--; }
      else if (t === 4) { ops.push({ k: 't1m2', ti: i - 1, mj: j - 2 }); i--; j -= 2; }
      else if (t === 5) { ops.push({ k: 't2m1', ti: i - 2, mj: j - 1 }); i -= 2; j--; }
      else break;
    }
    ops.reverse();

    const good = op => op && (op.k === 't1m2' || op.k === 't2m1'
      || (op.k === 'pair' && score(op.ti, op.mj) >= 1));
    const out = [];
    const lastSkipPunct = { p: '' };
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k];
      if (op.k === 'skip') {
        stats.skipped++;
        // Setningsslutt i et hoppet manusord flyttes til forrige ord, så
        // tegnsettingen ikke forsvinner sammen med det usagte
        const p = (M[op.mj].match(/[.!?…]["»)]*$/) || [''])[0];
        if (p) lastSkipPunct.p = p;
        continue;
      }
      if (lastSkipPunct.p && out.length && !/[^\p{L}\p{N}]$/u.test(out[out.length - 1].w)) {
        out[out.length - 1].w += lastSkipPunct.p.replace(/[»)"]+$/, '');
      }
      lastSkipPunct.p = '';
      if (op.k === 'pair') {
        const tw = T[op.ti], mw = M[op.mj];
        const sc = score(op.ti, op.mj);
        if (sc >= 1) {
          out.push({ w: mw, start: tw.start, end: tw.end });
          if (sc === 2) stats.matched++; else stats.corrected++;
        } else if (sim(tn[op.ti], mn[op.mj]) >= 0.34 && /\p{L}/u.test(tn[op.ti])
                   && good(prevReal(ops, k)) && good(nextReal(ops, k))) {
          // Ett ord som ikke stemmer, men omgitt av manus på begge sider:
          // trolig feilhørt (navn, fagord). Bruk manus, men marker.
          out.push({ w: mw, start: tw.start, end: tw.end, f: 'sjekk', h: tw.w });
          stats.check++;
        } else {
          out.push({ w: tw.w, start: tw.start, end: tw.end, f: 'avvik' });
          stats.offScript++;
        }
      } else if (op.k === 'talk') {
        const tw = T[op.ti];
        out.push({ w: tw.w, start: tw.start, end: tw.end, f: 'avvik' });
        stats.offScript++;
      } else if (op.k === 't1m2') {
        const tw = T[op.ti], a = M[op.mj], b = M[op.mj + 1];
        const mid = tw.start + (tw.end - tw.start) * (a.length / (a.length + b.length));
        out.push({ w: a, start: tw.start, end: mid }, { w: b, start: mid, end: tw.end });
        stats.matched += 2;
      } else if (op.k === 't2m1') {
        const t1 = T[op.ti], t2 = T[op.ti + 1];
        out.push({ w: M[op.mj], start: t1.start, end: t2.end });
        stats.matched++;
      }
    }
    // Stor bokstav i starten av en setning når et talt ord (avvik) står der
    for (let k = 0; k < out.length; k++) {
      const prev = out[k - 1];
      if ((k === 0 || SENT_END.test(prev.w)) && out[k].f === 'avvik') {
        out[k].w = out[k].w.replace(/^(["«(]*)(\p{Ll})/u, (s, a, c) => a + c.toUpperCase());
      }
    }
    const spoken = stats.matched + stats.corrected + stats.check;
    stats.coverage = n ? spoken / n : 0;
    // Under 40 % treff: manus hører trolig ikke til dette klippet
    const ok = stats.coverage >= 0.4;
    return { words: ok ? out : T.slice(), stats, ok, reason: ok ? '' : 'passer ikke' };
  }
  function prevReal(ops, k) { for (let x = k - 1; x >= 0; x--) if (ops[x].k !== 'skip') return ops[x]; return null; }
  function nextReal(ops, k) { for (let x = k + 1; x < ops.length; x++) if (ops[x].k !== 'skip') return ops[x]; return null; }

  // Hint til whisper: egennavn, tall og lange/sjeldne ord fra manus, så de
  // staves riktig. Bevisst en ordliste og ikke setninger — whisper kan
  // ellers «gjenta» hint-setninger i stille partier. whisper.cpp tillater
  // maks ~224 tokens; vi holder oss godt under.
  function promptFromManus(manusText, maxChars) {
    const max = maxChars || 300;
    // Linjeskift regnes som setningsgrense (overskrifter, replikker)
    const toks = cleanManus(manusText).replace(/\n+/g, ' \u0000 ').split(/[ \t]+/);
    const seen = new Set(), picked = [];
    for (let k = 0; k < toks.length; k++) {
      const raw = toks[k].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!raw) continue;
      const prev = toks[k - 1] || '\u0000';
      const sentenceStart = prev === '\u0000' || SENT_END.test(prev) || /:$/.test(prev);
      const isName = /^\p{Lu}/u.test(raw) && !sentenceStart;
      const isAbbr = /^\p{Lu}{2,}$/u.test(raw);
      const isLong = raw.length >= 11;
      const hasDigit = /\d/.test(raw) && raw.length >= 3;
      if (!(isName || isAbbr || isLong || hasDigit)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(raw);
    }
    let s = '';
    for (const p of picked) {
      if ((s + ', ' + p).length > max) break;
      s = s ? s + ', ' + p : p;
    }
    return s;
  }

  const api = {
    balanceLines, segmentWords, wordsFromSegments, wordsFromTokens,
    alignToManus, promptFromManus, breakCost, normKey, SEG,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TekstDeling = api;
})(typeof window !== 'undefined' ? window : globalThis);
