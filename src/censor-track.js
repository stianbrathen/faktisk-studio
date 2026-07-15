// Faktisk Studio — motiv-tracking for videosensur
//
// Ren node-modul: template-matching (SAD — sum av absolutte differanser)
// på nedskalerte gråtonebilder. Ingen ML, ingen nettverkskall — alt skjer
// lokalt. Følger området redaktøren har markert, frame for frame, og
// stopper når bildet endrer seg brått (klipp / motivet forsvinner).
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
 * @param {object} [opts]   — { searchR, adapt, cutThresh }
 * @returns {{ path: Array<{i:number,x:number,y:number}>, stoppedEarly: boolean, frames: number }}
 */
function trackRegion(buf, sw, sh, nFrames, region, opts) {
  const o = Object.assign({ searchR: 26, adapt: 0.15, cutThresh: 30 }, opts || {});
  const tw = Math.max(10, Math.round(region.w));
  const th = Math.max(10, Math.round(region.h));
  const hw = Math.floor(tw / 2), hh = Math.floor(th / 2);

  const clampX = (x) => Math.max(hw, Math.min(sw - hw - 1, Math.round(x)));
  const clampY = (y) => Math.max(hh, Math.min(sh - hh - 1, Math.round(y)));

  let cx = clampX(region.x);
  let cy = clampY(region.y);

  const frameAt = (i) => i * sw * sh;

  // Template = Float64 for glidende oppdatering uten avrundingsdrift
  const template = new Float64Array(tw * th);
  const readPatch = (fOff, px, py, out) => {
    const x0 = px - hw, y0 = py - hh;
    for (let y = 0; y < th; y++) {
      const rowOff = fOff + (y0 + y) * sw + x0;
      for (let x = 0; x < tw; x++) out[y * tw + x] = buf[rowOff + x];
    }
  };
  readPatch(frameAt(0), cx, cy, template);

  const patch = new Float64Array(tw * th);

  // SAD mellom template og patch sentrert i (px,py); avbryt om verre enn best
  function sad(fOff, px, py, bestSoFar) {
    const x0 = px - hw, y0 = py - hh;
    let sum = 0;
    for (let y = 0; y < th; y++) {
      const rowOff = fOff + (y0 + y) * sw + x0;
      const tRow = y * tw;
      for (let x = 0; x < tw; x++) {
        sum += Math.abs(buf[rowOff + x] - template[tRow + x]);
      }
      if (sum > bestSoFar) return sum; // tidlig exit
    }
    return sum;
  }

  const path = [{ i: 0, x: cx, y: cy }];
  let stoppedEarly = false;

  for (let f = 1; f < nFrames; f++) {
    const fOff = frameAt(f);
    let best = Infinity, bx = cx, by = cy;

    // Grovt søk (steg 2), deretter finsøk (steg 1) rundt beste treff
    for (let dy = -o.searchR; dy <= o.searchR; dy += 2) {
      const py = clampY(cy + dy);
      for (let dx = -o.searchR; dx <= o.searchR; dx += 2) {
        const px = clampX(cx + dx);
        const s = sad(fOff, px, py, best);
        if (s < best) { best = s; bx = px; by = py; }
      }
    }
    for (let dy = -1; dy <= 1; dy++) {
      const py = clampY(by + dy);
      for (let dx = -1; dx <= 1; dx++) {
        const px = clampX(bx + dx);
        if (dx === 0 && dy === 0) continue;
        const s = sad(fOff, px, py, best);
        if (s < best) { best = s; bx = px; by = py; }
      }
    }

    // Gjennomsnittlig intensitetsavvik per piksel — høyt = klipp/mistet motiv
    const meanDiff = best / (tw * th);
    if (meanDiff > o.cutThresh) {
      stoppedEarly = true;
      break;
    }

    cx = bx; cy = by;
    path.push({ i: f, x: cx, y: cy });

    // Glidende template-oppdatering: tåler gradvis endring (rotasjon, lys)
    // uten å drifte av gårde på én dårlig frame.
    readPatch(fOff, cx, cy, patch);
    for (let k = 0; k < template.length; k++) {
      template[k] = (1 - o.adapt) * template[k] + o.adapt * patch[k];
    }
  }

  return { path, stoppedEarly, frames: nFrames };
}

/**
 * Ramer-Douglas-Peucker på x(t) og y(t) hver for seg — beholder unionen av
 * punktene, så banen forenkles uten at bevegelsen avviker mer enn eps px.
 */
function simplifyPath(points, eps) {
  if (points.length <= 2) return points;

  function rdpKeep(vals, keep) {
    function rec(a, b) {
      let maxD = 0, idx = -1;
      const va = vals[a], vb = vals[b];
      for (let i = a + 1; i < b; i++) {
        // Avvik fra rett linje mellom a og b (lineær i indeks — jevn fps)
        const f = (i - a) / (b - a);
        const d = Math.abs(vals[i] - (va + (vb - va) * f));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep.add(idx);
        rec(a, idx);
        rec(idx, b);
      }
    }
    rec(0, vals.length - 1);
  }

  const keep = new Set([0, points.length - 1]);
  rdpKeep(points.map(p => p.x), keep);
  rdpKeep(points.map(p => p.y), keep);
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}

module.exports = { trackRegion, simplifyPath };
