// Faktisk Studio — ansiktsbasert sporing for videosensur
//
// I stedet for å matche piksler (template-tracking) GJENFINNES ansiktet i
// hver frame med UltraFace-detektoren. Det tåler håndholdt/veivete kamera,
// zoom og lysendringer langt bedre, fordi hver frame vurderes uavhengig.
//
// Assosiasjon: nærmeste deteksjon til forrige posisjon (med port for
// avstand og størrelsesforhold) — så to ansikter i bildet ikke blandes.
// Mangler deteksjon (bortvendt ansikt, kortvarig okklusjon) fryses
// posisjonen; sporet gjenopptas når ansiktet dukker opp igjen.

'use strict';

const { detectFaces, MODEL_W, MODEL_H } = require('./face-detect.js');

/**
 * @param {object} session   — ort-session fra face-detect.createSession
 * @param {Buffer} buf       — rå RGB24-frames, MODEL_W*MODEL_H*3 bytes per frame
 * @param {number} nFrames
 * @param {object} region    — { x, y, w, h } startområde i modellkoordinater (px)
 * @param {object} [opts]
 * @returns {{ ok, path?, stoppedEarly?, reason? }}
 *          path: Array<{i,x,y,s}> i modellkoordinater (px), s = rel. størrelse
 */
async function trackFace(session, buf, nFrames, region, opts) {
  const o = Object.assign({
    confThresh: 0.55,
    gatePx: 90,        // maks hopp mellom frames (px i 640×480)
    maxLost: 12,       // frames uten deteksjon før vi gir oss (~2,4 s ved 5 fps)
    smooth: 0.55,      // EMA-glatting av posisjon/størrelse (1 = ta deteksjonen rått)
  }, opts || {});

  const frameSize = MODEL_W * MODEL_H * 3;
  const frameAt = (i) => buf.subarray(i * frameSize, (i + 1) * frameSize);

  const boxCx = (b) => (b.x1 + b.x2) / 2 * MODEL_W;
  const boxCy = (b) => (b.y1 + b.y2) / 2 * MODEL_H;
  const boxW = (b) => (b.x2 - b.x1) * MODEL_W;
  const boxH = (b) => (b.y2 - b.y1) * MODEL_H;

  // Startkrav: deteksjonen må faktisk ligge I maskeområdet redaktøren har
  // plassert (senteret innenfor masken + litt slingring) — ellers hopper
  // sporet til et annet ansikt i bildet. Er ansiktet ikke synlig ennå
  // (bortvendt, kommer inn i bildet senere), skannes det fremover: masken
  // står i ro til første ansikt dukker opp i området, og følges derfra.
  const slackX = region.w * 0.5 + 12, slackY = region.h * 0.5 + 12;
  const inRegion = (d) =>
    Math.abs(boxCx(d) - region.x) < slackX && Math.abs(boxCy(d) - region.y) < slackY;

  let start = null, startF = 0;
  for (let f = 0; f < nFrames && !start; f++) {
    const dets = await detectFaces(session, frameAt(f), { confThresh: o.confThresh });
    let bd = Infinity;
    for (const d of dets) {
      if (!inRegion(d)) continue;
      const dist = Math.hypot(boxCx(d) - region.x, boxCy(d) - region.y);
      if (dist < bd) { bd = dist; start = d; startF = f; }
    }
  }
  if (!start) return { ok: false, reason: 'no-face' };

  // Sporet følger ansiktet, men beholder redaktørens valgte størrelse som
  // basis — skala = ansiktets størrelse relativt til første deteksjon.
  const baseSize = Math.max(boxW(start), boxH(start));
  let cx = boxCx(start), cy = boxCy(start), size = baseSize;
  let vx = 0, vy = 0;   // enkel hastighetsmodell for prediksjon
  let lost = 0;
  let stoppedEarly = false;
  const path = [{ i: startF, x: Math.round(cx), y: Math.round(cy), s: 1 }];

  for (let f = startF + 1; f < nFrames; f++) {
    const dets = await detectFaces(session, frameAt(f), { confThresh: o.confThresh });

    // Prediker og velg nærmeste deteksjon innenfor porten
    const px = cx + vx, py = cy + vy;
    const gate = o.gatePx * (1 + Math.min(2, lost * 0.5));  // videre port når mistet
    let best = null, bd = Infinity;
    for (const d of dets) {
      const dist = Math.hypot(boxCx(d) - px, boxCy(d) - py);
      const dsize = Math.max(boxW(d), boxH(d));
      const ratio = dsize / size;
      if (dist < gate && ratio > 0.45 && ratio < 2.2 && dist < bd) { bd = dist; best = d; }
    }

    if (!best) {
      lost++;
      if (lost > o.maxLost) { stoppedEarly = true; break; }
      continue;   // frys posisjonen til ansiktet dukker opp igjen
    }

    const nx = boxCx(best), ny = boxCy(best);
    const nsize = Math.max(boxW(best), boxH(best));
    vx = lost === 0 ? nx - cx : 0;
    vy = lost === 0 ? ny - cy : 0;
    lost = 0;
    cx = cx + (nx - cx) * o.smooth;
    cy = cy + (ny - cy) * o.smooth;
    size = size + (nsize - size) * o.smooth;

    path.push({
      i: f,
      x: Math.round(cx),
      y: Math.round(cy),
      s: Math.round((size / baseSize) * 1000) / 1000,
    });
  }

  return { ok: true, path, stoppedEarly };
}

module.exports = { trackFace };
