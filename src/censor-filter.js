// Faktisk Studio — filtergraf-bygger for videosensur (blur-masker)
//
// Ren node-modul uten Electron-avhengigheter, så den kan enhetstestes
// direkte med node. Brukes av censor-export-handleren i main.js.
//
// Maskemodell:
//   {
//     shape       — 'circle' | 'ellipse' | 'rect'
//     w, h        — standardstørrelse i kildepiksler (fallback for keyframes)
//     blur        — gblur sigma (f.eks. 12 / 24 / 40)
//     fade        — fade inn/ut i sekunder (0 = av)
//     feather     — kantmykhet 0–0.8 (andel av radius), kun sirkel/oval
//     keyframes   — [{ t, x, y, w?, h? }] sortert på t; x/y = maskens SENTRUM
//   }
// Masken er aktiv fra første til siste keyframe. Både posisjon OG størrelse
// interpoleres lineært mellom keyframes.
//
// Teknikk: ffmpeg-crop kan ikke endre størrelse per frame, så vi cropper
// maks-størrelsen over hele spennet (med animert posisjon), blurrer, og
// animerer selve maskeFORMEN i alpha-kanalen via geq med T-uttrykk.
// Statisk rektangel slipper geq og bruker eksakt crop (raskere).

'use strict';

function fnum(n) {
  return String(Math.round(n * 100) / 100);
}

function even(n) {
  return Math.max(2, 2 * Math.round(n / 2));
}

/**
 * Stykkevis lineær interpolasjon som ffmpeg-uttrykk i tidsvariabelen tv
 * ('t' i crop/overlay, 'T' i geq). Holder første/siste verdi utenfor spennet.
 */
function lerpExpr(keyframes, key, tv) {
  const v = tv || 't';
  const kfs = keyframes;
  if (kfs.length === 1) return fnum(kfs[0][key]);
  let expr = fnum(kfs[kfs.length - 1][key]);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i], b = kfs[i + 1];
    const dt = Math.max(0.001, b.t - a.t);
    const seg = `${fnum(a[key])}+(${fnum(b[key] - a[key])})*(${v}-${fnum(a.t)})/${fnum(dt)}`;
    expr = `if(lt(${v},${fnum(b.t)}),${seg},${expr})`;
  }
  return `if(lt(${v},${fnum(kfs[0].t)}),${fnum(kfs[0][key])},${expr})`;
}

function validateMask(m, i) {
  if (!m || typeof m !== 'object') throw new Error(`Maske ${i + 1}: ugyldig objekt`);
  if (!(m.w > 1) || !(m.h > 1)) throw new Error(`Maske ${i + 1}: ugyldig størrelse`);
  if (!Array.isArray(m.keyframes) || !m.keyframes.length) {
    throw new Error(`Maske ${i + 1}: mangler keyframes`);
  }
  for (const k of m.keyframes) {
    if (typeof k.t !== 'number' || typeof k.x !== 'number' || typeof k.y !== 'number') {
      throw new Error(`Maske ${i + 1}: keyframe mangler t/x/y`);
    }
  }
  const ts = m.keyframes.map(k => k.t);
  if (Math.max(...ts) - Math.min(...ts) < 0.1) {
    throw new Error(`Maske ${i + 1}: trenger minst to keyframes med ulik tid (start og slutt på maskens varighet)`);
  }
}

/**
 * Bygger filter_complex-graf for et sett masker.
 * @param {Array} masks
 * @returns {{ graph: string, outLabel: string }}
 */
function buildCensorFilter(masks) {
  if (!Array.isArray(masks) || !masks.length) {
    throw new Error('Ingen masker å rendre');
  }
  const parts = [];
  let prev = '0:v';

  masks.forEach((m, i) => {
    validateMask(m, i);
    const isRound = m.shape === 'ellipse' || m.shape === 'circle';

    // Normaliser keyframes: alle får størrelse (fallback til maskens standard)
    const kfs = m.keyframes
      .slice()
      .sort((a, b) => a.t - b.t)
      .map(k => {
        let w = (k.w > 1 ? k.w : m.w);
        let h = (k.h > 1 ? k.h : m.h);
        if (m.shape === 'circle') h = w;
        return { t: k.t, x: k.x, y: k.y, w, h };
      });

    const sigma = Math.max(1, Math.round(m.blur || 24));
    const from = kfs[0].t;
    const to = kfs[kfs.length - 1].t;
    const span = Math.max(0.1, to - from);
    const fade = Math.min(Math.max(0, m.fade != null ? m.fade : 0.3), span / 2);
    const feather = Math.min(0.8, Math.max(0.05, m.feather != null ? m.feather : 0.35));

    const sizeVaries = kfs.some(k => k.w !== kfs[0].w || k.h !== kfs[0].h);
    const W = even(Math.max(...kfs.map(k => k.w)));
    const H = even(Math.max(...kfs.map(k => k.h)));

    // Posisjon: senter-uttrykk → klemt topp-venstre for crop/overlay.
    const xC = lerpExpr(kfs, 'x', 't');
    const yC = lerpExpr(kfs, 'y', 't');
    const posX = (bound) => `max(0,min(${xC}-${fnum(W / 2)},${bound}-${W}))`;
    const posY = (bound) => `max(0,min(${yC}-${fnum(H / 2)},${bound}-${H}))`;

    // Temporal fade inn/ut på alfakanalen, så masken ikke «popper».
    const fadeChain = fade > 0.01
      ? `,fade=t=in:st=${fnum(from)}:d=${fnum(fade)}:alpha=1` +
        `,fade=t=out:st=${fnum(to - fade)}:d=${fnum(fade)}:alpha=1`
      : '';

    // Formen tegnes i alpha via geq når masken er rund og/eller størrelsen
    // animeres. Radius-uttrykkene bruker geq-variabelen T (sekunder).
    let shapeChain = '';
    if (isRound || sizeVaries) {
      const rxE = `((${lerpExpr(kfs, 'w', 'T')})/2)`;
      const ryE = `((${lerpExpr(kfs, 'h', 'T')})/2)`;
      const aExpr = isRound
        ? `255*clip((1-hypot((X-W/2)/${rxE},(Y-H/2)/${ryE}))/${fnum(feather)},0,1)`
        : `255*clip(min(${rxE}-abs(X-W/2),${ryE}-abs(Y-H/2))/2,0,1)`;
      shapeChain = `,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${aExpr}'`;
    }

    parts.push(`[${prev}]split=2[b${i}][m${i}]`);
    parts.push(
      `[m${i}]crop=${W}:${H}:x='${posX('in_w')}':y='${posY('in_h')}'` +
      `,gblur=sigma=${sigma},format=yuva420p${shapeChain}${fadeChain}[f${i}]`
    );
    parts.push(
      `[b${i}][f${i}]overlay=x='${posX('main_w')}':y='${posY('main_h')}'` +
      `:enable='between(t,${fnum(from)},${fnum(to)})'[v${i}]`
    );
    prev = `v${i}`;
  });

  return { graph: parts.join(';'), outLabel: `[${prev}]` };
}

module.exports = { buildCensorFilter, lerpExpr };
