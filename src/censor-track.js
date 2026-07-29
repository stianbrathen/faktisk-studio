// Faktisk Studio — motiv-tracking for videosensur
//
// Ren node-modul: template-matching på nedskalerte gråtonebilder.
// Ingen ML, ingen nettverkskall — alt skjer lokalt.
//
// Strategi (v2):
//   1. Posisjonssøk med SAD (rask, tidlig exit) mot adaptivt template.
//   2. NCC-verifisering (normalisert kryss-korrelasjon) på beste posisjon —
//      robust mot lysendring, og mot både original- og adaptivt template,
//      så gradvis drift bort fra motivet oppdages og korrigeres.
//   3. Skala-estimering per frame (bilineær resampling ±4 %) — masken vokser
//      og krymper med motivet (ansikt som nærmer seg / fjerner seg).
//   4. Okklusjonstoleranse: mistes motivet kort (noen passerer foran),
//      fryses posisjonen og søket utvides — sporingen gjenopptas når
//      motivet dukker opp igjen, og stopper først etter ~1,5 s uten treff.
//
// main.js mater denne med rå gråtonebytes fra ffmpeg (rawvideo/gray).

'use strict';

/**
 * Følger et område gjennom en serie gråtonebilder.
 *
 * @param {Buffer} buf      — rå gray-frames, sw*sh bytes per frame
 * @param {number} sw, sh   — bildedimensjoner (nedskalert)
 * @param {number} nFrames
 * @param {object} region   — { x, y, w, h } senter + størrelse i nedskalerte px
 * @param {object} [opts]
 * @returns {{ path: Array<{i:number,x:number,y:number,s:number}>, stoppedEarly: boolean, frames: number }}
 */
function trackRegion(buf, sw, sh, nFrames, region, opts) {
  const o = Object.assign({
    searchR: 26,      // søkeradius i px (nedskalert)
    adapt: 0.12,      // glidende template-oppdatering
    minCorr: 0.30,    // under dette = motivet mistet denne framen
    goodCorr: 0.55,   // over dette = trygt å adaptere template
    scaleStep: 0.04,  // ±4 % skala testes per frame
    maxLost: 8,       // frames uten treff før vi gir oss (~1,6 s ved 5 fps)
  }, opts || {});

  const tw = Math.max(10, Math.round(region.w));
  const th = Math.max(10, Math.round(region.h));
  const hw = Math.floor(tw / 2), hh = Math.floor(th / 2);
  const N = tw * th;

  let scaleNow = 1;                       // akkumulert skala relativt til start
  const minScale = 0.4, maxScale = 2.5;

  const clampCX = (x, s) => Math.max(hw * s + 1, Math.min(sw - hw * s - 2, x));
  const clampCY = (y, s) => Math.max(hh * s + 1, Math.min(sh - hh * s - 2, y));

  let cx = Math.round(clampCX(region.x, 1));
  let cy = Math.round(clampCY(region.y, 1));

  const frameAt = (i) => i * sw * sh;

  // Heltalls-patch (rask, brukes i posisjonssøket)
  const readPatch = (fOff, px, py, out) => {
    const x0 = px - hw, y0 = py - hh;
    for (let y = 0; y < th; y++) {
      const rowOff = fOff + (y0 + y) * sw + x0;
      for (let x = 0; x < tw; x++) out[y * tw + x] = buf[rowOff + x];
    }
  };

  // Bilineær patch ved vilkårlig senter og skala — brukes til skala-test
  function samplePatch(fOff, pcx, pcy, s, out) {
    for (let ty = 0; ty < th; ty++) {
      const fy = pcy + (ty - (th - 1) / 2) * s;
      const y0 = Math.max(0, Math.min(sh - 2, Math.floor(fy)));
      const ay = fy - y0;
      const r0 = fOff + y0 * sw, r1 = r0 + sw;
      for (let tx = 0; tx < tw; tx++) {
        const fx = pcx + (tx - (tw - 1) / 2) * s;
        const x0 = Math.max(0, Math.min(sw - 2, Math.floor(fx)));
        const ax = fx - x0;
        out[ty * tw + tx] =
          (buf[r0 + x0] * (1 - ax) + buf[r0 + x0 + 1] * ax) * (1 - ay) +
          (buf[r1 + x0] * (1 - ax) + buf[r1 + x0 + 1] * ax) * ay;
      }
    }
  }

  // Zero-mean normalisert kryss-korrelasjon — 1 = perfekt, ~0 = urelatert.
  // Robust mot jevn lysendring (eksponering, skygge) i motsetning til SAD.
  function ncc(a, b) {
    let ma = 0, mb = 0;
    for (let k = 0; k < N; k++) { ma += a[k]; mb += b[k]; }
    ma /= N; mb /= N;
    let cov = 0, va = 0, vb = 0;
    for (let k = 0; k < N; k++) {
      const da = a[k] - ma, db = b[k] - mb;
      cov += da * db; va += da * da; vb += db * db;
    }
    const denom = Math.sqrt(va * vb);
    return denom < 1e-6 ? 0 : cov / denom;
  }

  const tOrig = new Float64Array(N);      // originalt utseende (anker mot drift)
  const tAdapt = new Float64Array(N);     // glidende oppdatert
  readPatch(frameAt(0), cx, cy, tOrig);
  tAdapt.set(tOrig);

  const patch = new Float64Array(N);
  const patchS = new Float64Array(N);

  // SAD mot adaptivt template med tidlig exit
  function sad(fOff, px, py, bestSoFar) {
    const x0 = px - hw, y0 = py - hh;
    let sum = 0;
    for (let y = 0; y < th; y++) {
      const rowOff = fOff + (y0 + y) * sw + x0;
      const tRow = y * tw;
      for (let x = 0; x < tw; x++) {
        sum += Math.abs(buf[rowOff + x] - tAdapt[tRow + x]);
      }
      if (sum > bestSoFar) return sum;
    }
    return sum;
  }

  const path = [{ i: 0, x: cx, y: cy, s: 1 }];
  let stoppedEarly = false;
  let lost = 0;

  const iclampX = (x) => Math.max(hw, Math.min(sw - hw - 1, Math.round(x)));
  const iclampY = (y) => Math.max(hh, Math.min(sh - hh - 1, Math.round(y)));

  let vx = 0, vy = 0;   // hastighetsmodell: hvor vi FORVENTER motivet neste frame

  for (let f = 1; f < nFrames; f++) {
    const fOff = frameAt(f);
    const R = lost > 0 ? Math.round(o.searchR * 1.8) : o.searchR;

    // 1) Posisjonssøk rundt forventet posisjon, med avstandsstraff:
    //    kandidater langt fra prediksjonen må være TYDELIG bedre for å vinne.
    //    Det fjerner «hopp bort og tilbake»-flimmer der et annet område
    //    tilfeldigvis matcher marginalt bedre i enkeltframes.
    const ecx = iclampX(cx + vx), ecy = iclampY(cy + vy);
    const penW = N * 0.006;   // straff: ~0,6 grånivåer ved 10 px, ~4 ved 26 px
    let best = Infinity, bx = ecx, by = ecy;
    for (let dy = -R; dy <= R; dy += 2) {
      const py = iclampY(ecy + dy);
      for (let dx = -R; dx <= R; dx += 2) {
        const px = iclampX(ecx + dx);
        const pen = penW * (dx * dx + dy * dy);
        if (pen >= best) continue;
        const s = sad(fOff, px, py, best - pen) + pen;
        if (s < best) { best = s; bx = px; by = py; }
      }
    }
    for (let dy = -1; dy <= 1; dy++) {
      const py = iclampY(by + dy);
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const px = iclampX(bx + dx);
        const s = sad(fOff, px, py, best);
        if (s < best) { best = s; bx = px; by = py; }
      }
    }

    // 2) NCC-verifisering på beste posisjon: mot adaptivt template (samme
    //    motiv som forrige frame?) og mot originalen ved gjeldende skala
    //    (fortsatt det motivet redaktøren markerte?).
    readPatch(fOff, bx, by, patch);
    const corrA = ncc(patch, tAdapt);
    samplePatch(fOff, clampCX(bx, scaleNow), clampCY(by, scaleNow), scaleNow, patchS);
    const corrO = ncc(patchS, tOrig);
    const corr = Math.max(corrA, corrO);

    // Bevegelses-sjekk: et middelmådig treff som samtidig hopper langt er
    // nesten alltid feiltreff (okklusjon som ligner bakgrunnen) — behandle
    // det som mistet i stedet for å låse på feil sted og drifte.
    const jump = Math.hypot(bx - cx, by - cy);
    const suspicious = corrA < 0.75 && jump > o.searchR * 0.6;

    if (corr < o.minCorr || suspicious) {
      // Motivet borte. Skjedde det ved bildekanten med fart utover, har
      // motivet gått ut av bildet: følg bevegelsen et lite stykke ut og
      // avslutt der — ikke bli stående og lås på noe annet som passerer.
      const edgeM = Math.max(tw, th) * 0.8;
      const atEdge = cx < edgeM || cx > sw - edgeM || cy < edgeM || cy > sh - edgeM;
      if (atEdge && (Math.abs(vx) > 0.7 || Math.abs(vy) > 0.7)) {
        for (let g = 0; g < 3 && f + g < nFrames; g++) {
          cx += vx; cy += vy;
          path.push({ i: f + g, x: Math.round(cx), y: Math.round(cy), s: Math.round(scaleNow * 1000) / 1000 });
        }
        stoppedEarly = true;
        break;
      }
      lost++;
      vx = 0; vy = 0;
      if (lost > o.maxLost) { stoppedEarly = true; break; }
      continue;
    }
    // Oppdater hastighetsmodellen (dempet, og bare fra sammenhengende treff)
    if (lost === 0) { vx = 0.5 * vx + 0.5 * (bx - cx); vy = 0.5 * vy + 0.5 * (by - cy); }
    else { vx = 0; vy = 0; }
    lost = 0;

    // 3) Skala-test mot ORIGINAL-templatet. Det adaptive absorberer gradvis
    //    vekst og melder alltid «uendret» — originalen gjør ikke det: når
    //    motivet har vokst, matcher et større samplingsvindu (skalert ned
    //    til templatestørrelse) originalen best. Kandidatene deler frame,
    //    så sammenligningen er rettferdig selv om utseendet eldes.
    let bestS = scaleNow, bestSCorr = -2;
    for (const rs of [1 - 2 * o.scaleStep, 1 - o.scaleStep, 1, 1 + o.scaleStep, 1 + 2 * o.scaleStep]) {
      const s = Math.max(minScale, Math.min(maxScale, scaleNow * rs));
      samplePatch(fOff, clampCX(bx, s), clampCY(by, s), s, patchS);
      const c = ncc(patchS, tOrig) - (rs === 1 ? 0 : 0.008);
      if (c > bestSCorr) { bestSCorr = c; bestS = s; }
    }
    scaleNow = bestS;

    cx = bx; cy = by;
    path.push({ i: f, x: cx, y: cy, s: Math.round(scaleNow * 1000) / 1000 });

    // 4) Template-vedlikehold: adapter bare ved trygge treff uten mistenkelig
    //    hopp — okklusjoner og feiltreff skal ikke forgifte templatet.
    if (corrA >= o.goodCorr && jump <= o.searchR * 0.8) {
      for (let k = 0; k < N; k++) {
        tAdapt[k] = (1 - o.adapt) * tAdapt[k] + o.adapt * patch[k];
      }
    }
  }

  // Medianfilter (3 punkter) på banen: dreper enkeltframe-spikes — «hopp
  // bort og tilbake» — uten å sløve reell bevegelse nevneverdig.
  const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  for (let k = 1; k < path.length - 1; k++) {
    path[k] = {
      i: path[k].i,
      x: med3(path[k - 1].x, path[k].x, path[k + 1].x),
      y: med3(path[k - 1].y, path[k].y, path[k + 1].y),
      s: med3(path[k - 1].s, path[k].s, path[k + 1].s),
    };
  }

  return { path, stoppedEarly, frames: nFrames };
}

/**
 * Ramer-Douglas-Peucker på x(t), y(t) og skala(t) hver for seg — beholder
 * unionen av punktene, så banen forenkles uten at bevegelse eller
 * størrelsesendring avviker merkbart.
 */
function simplifyPath(points, eps) {
  if (points.length <= 2) return points;

  function rdpKeep(vals, keep, tol) {
    function rec(a, b) {
      let maxD = 0, idx = -1;
      const va = vals[a], vb = vals[b];
      for (let i = a + 1; i < b; i++) {
        const f = (i - a) / (b - a);
        const d = Math.abs(vals[i] - (va + (vb - va) * f));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol && idx > 0) {
        keep.add(idx);
        rec(a, idx);
        rec(idx, b);
      }
    }
    rec(0, vals.length - 1);
  }

  const keep = new Set([0, points.length - 1]);
  rdpKeep(points.map(p => p.x), keep, eps);
  rdpKeep(points.map(p => p.y), keep, eps);
  // Skala-kanalen: 6 % endring tilsvarer eps px i posisjon — romslig nok til
  // at ±4 %-trappetrinnene fra skala-søket ikke gir unødige keyframes
  rdpKeep(points.map(p => ((p.s || 1) / 0.06) * eps), keep, eps);
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

module.exports = { trackRegion, simplifyPath };
