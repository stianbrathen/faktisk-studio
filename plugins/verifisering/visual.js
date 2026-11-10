// Faktisk Studio · Verifisering — visuelle hjelpemidler
//
// Rene bildefunksjoner på {width, height, data: RGBA} (ImageData-form), så de
// kan testes i Node. Verktøyet feller ingen dom: dette er bilder journalisten
// selv vurderer.
//
//  - gray()        luminans (Rec. 601) som Float32Array
//  - edges()       Sobel-kanter (styrke), valgfritt lagt over et dempet originalbilde
//  - estimateShift() global forskyvning mellom to bilder (kamerabevegelse),
//                  grov-til-fin blokksøk med «trimmet» snitt så det som beveger
//                  seg (personen) påvirker mindre
//  - diff()        forskjell mellom to bilder etter justering, som fargekart
//                  (FAST skala: 40 gråtrinn = gul, så en rolig bakgrunn blir mørk og
//                  ikke forsterkes opp slik en normalisering per bilde ville gjort)
//  - accumulate()  snitt av mange slike forskjeller (samme som i referanseanalysen)
//
// window.VfVisual i plugin-vinduet, module.exports i Node.

(function (root) {
  'use strict';

  function gray(img) {
    const { width: w, height: h, data: d } = img; const g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { w, h, g };
  }
  function downscale(G, f) {
    const w = Math.max(1, Math.floor(G.w / f)), h = Math.max(1, Math.floor(G.h / f)); const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let yy = y * f; yy < y * f + f && yy < G.h; yy++) for (let xx = x * f; xx < x * f + f && xx < G.w; xx++) { s += G.g[yy * G.w + xx]; n++; }
      g[y * w + x] = s / n;
    }
    return { w, h, g };
  }

  // «Inferno»-lignende fargeskala: svart → lilla → oransje → gul
  const STOPS = [[0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]];
  function cmap(v) {
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) {
      const a = STOPS[i - 1], b = STOPS[i], t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return STOPS[STOPS.length - 1].slice(1);
  }

  function edges(img, opts) {
    opts = opts || {};
    const G = gray(img), { w, h, g } = G; const mag = new Float32Array(w * h); let max = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy); mag[i] = m; if (m > max) max = m;
    }
    // Normaliser mot 99,5-persentilen så enkeltpiksler ikke styrer skalaen
    const p = percentile(mag, 0.995) || max || 1;
    const out = new Uint8ClampedArray(w * h * 4); const dim = opts.overlay ? 0.35 : 0;
    for (let i = 0; i < w * h; i++) {
      const v = Math.min(1, mag[i] / p); const e = Math.pow(v, 0.7) * 255;
      const k = i * 4;
      if (dim) { out[k] = img.data[k] * dim + e * (1 - dim); out[k + 1] = img.data[k + 1] * dim + e * (1 - dim); out[k + 2] = img.data[k + 2] * dim + e; }
      else { out[k] = out[k + 1] = out[k + 2] = e; }
      out[k + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }

  function percentile(arr, q) {
    const n = arr.length; if (!n) return 0;
    const step = Math.max(1, Math.floor(n / 20000)); const s = [];
    for (let i = 0; i < n; i += step) s.push(arr[i]);
    s.sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  // Snitt av absolutt forskjell der de overlapper, med de 30 % største avvikene
  // kastet (dem som skyldes noe som beveger seg, ikke kameraet).
  function cost(A, B, dx, dy, step) {
    const x0 = Math.max(0, dx), x1 = Math.min(A.w, B.w + dx), y0 = Math.max(0, dy), y1 = Math.min(A.h, B.h + dy);
    if (x1 - x0 < A.w * 0.5 || y1 - y0 < A.h * 0.5) return Infinity;
    const hist = HIST.fill(0); let n = 0;
    for (let y = y0; y < y1; y += step) {
      const ra = y * A.w, rb = (y - dy) * B.w - dx;
      for (let x = x0; x < x1; x += step) { const d = A.g[ra + x] - B.g[rb + x]; hist[(d < 0 ? -d : d) | 0]++; n++; }
    }
    // trimmet snitt via histogram (lineær tid): de laveste 70 %
    const keep = Math.floor(n * 0.7); let s = 0, c = 0;
    for (let v = 0; v < 256 && c < keep; v++) { const k = Math.min(hist[v], keep - c); s += k * v; c += k; }
    return s / Math.max(1, c);
  }
  const HIST = new Uint32Array(256);
  // Forskyvning (dx, dy) slik at A(x, y) ≈ B(x − dx, y − dy)
  function estimateShift(imgA, imgB) {
    const GA = gray(imgA), GB = gray(imgB);
    const levels = [8, 4, 2, 1].filter(f => GA.w / f >= 40);
    let dx = 0, dy = 0, first = true;
    for (const f of levels) {
      const A = f > 1 ? downscale(GA, f) : GA, B = f > 1 ? downscale(GB, f) : GB;
      dx *= first ? 0 : 2; dy *= first ? 0 : 2;
      const r = first ? 10 : 2; const step = f === 1 ? 3 : 1;
      let best = Infinity, bx = dx, by = dy;
      for (let yy = dy - r; yy <= dy + r; yy++) for (let xx = dx - r; xx <= dx + r; xx++) {
        const c = cost(A, B, xx, yy, step); if (c < best) { best = c; bx = xx; by = yy; }
      }
      dx = bx; dy = by; first = false;
      if (f === levels[levels.length - 1]) {
        const scale = f; // nederste nivå kan være > 1 for små bilder
        return { dx: dx * scale, dy: dy * scale, residual: best };
      }
    }
    return { dx: 0, dy: 0, residual: 0 };
  }

  function diffValues(imgA, imgB, align) {
    const GA = gray(imgA), GB = gray(imgB); const { w, h } = GA;
    const s = align ? estimateShift(imgA, imgB) : { dx: 0, dy: 0 };
    const v = new Float32Array(w * h); const valid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const yb = y - s.dy; if (yb < 0 || yb >= GB.h) continue;
      for (let x = 0; x < w; x++) {
        const xb = x - s.dx; if (xb < 0 || xb >= GB.w) continue;
        const i = y * w + x; v[i] = Math.abs(GA.g[i] - GB.g[yb * GB.w + xb]); valid[i] = 1;
      }
    }
    return { w, h, v, valid, shift: s };
  }
  function render(w, h, v, valid, scale) {
    const p = scale || 40; const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      if (!valid[i]) { out[k] = 40; out[k + 1] = 40; out[k + 2] = 40; out[k + 3] = 255; continue; }
      const c = cmap(Math.pow(v[i] / p, 0.6)); out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }
  function diff(imgA, imgB, opts) {
    const r = diffValues(imgA, imgB, !(opts && opts.align === false));
    const img = render(r.w, r.h, r.v, r.valid, opts && opts.scale);
    let sum = 0, n = 0; for (let i = 0; i < r.v.length; i += 7) if (r.valid[i]) { sum += r.v[i]; n++; }
    img.shift = r.shift; img.mean = n ? sum / n : 0; return img;
  }
  // pairs = [[imgA, imgB], …] — snitt av justerte forskjeller. Hvert kart flyttes
  // inn i koordinatene til det FØRSTE bildet (ellers blir snittet «spøkelser» når
  // kameraet glir over tid). Par som ikke lar seg justere mot første bilde, hoppes over.
  function accumulate(pairs, opts) {
    const align = !(opts && opts.align === false);
    if (!pairs.length) return null;
    const ref = pairs[0][0]; const w = ref.width, h = ref.height;
    const acc = new Float32Array(w * h), cnt = new Uint16Array(w * h); const shifts = []; let used = 0, skipped = 0;
    for (const [a, b] of pairs) {
      const r = diffValues(a, b, align);
      const s0 = (align && a !== ref) ? estimateShift(ref, a) : { dx: 0, dy: 0, residual: 0 };
      if (s0.residual > 18) { skipped++; continue; }
      shifts.push({ dx: r.shift.dx, dy: r.shift.dy, toRef: [s0.dx, s0.dy] }); used++;
      for (let y = 0; y < h; y++) {
        const yi = y - s0.dy; if (yi < 0 || yi >= r.h) continue;
        for (let x = 0; x < w; x++) {
          const xi = x - s0.dx; if (xi < 0 || xi >= r.w) continue;
          const j = yi * r.w + xi; if (!r.valid[j]) continue;
          const i = y * w + x; acc[i] += r.v[j]; cnt[i]++;
        }
      }
    }
    const valid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (cnt[i]) { acc[i] /= cnt[i]; valid[i] = 1; }
    const img = render(w, h, acc, valid, (opts && opts.scale) || 24);
    img.shifts = shifts; img.used = used; img.skipped = skipped; return img;
  }

  // ---------- Leppesynk: følg et område (munnen) fra bilde til bilde ----------
  // box = {x, y, w, h} i bildets piksler. Søker ±r px etter beste treff for et
  // større område rundt (munn + nese/hake) og flytter boksen dit.
  function sad(A, B, bx, by, bw, bh, dx, dy, step) {
    let s = 0, n = 0;
    for (let y = by; y < by + bh; y += step) {
      const y2 = y + dy; if (y < 0 || y >= A.h || y2 < 0 || y2 >= B.h) continue;
      for (let x = bx; x < bx + bw; x += step) {
        const x2 = x + dx; if (x < 0 || x >= A.w || x2 < 0 || x2 >= B.w) continue;
        s += Math.abs(A.g[y * A.w + x] - B.g[y2 * B.w + x2]); n++;
      }
    }
    return n ? s / n : Infinity;
  }
  function trackBox(G0, G1, box, r) {
    r = r || 12;
    const ex = { x: Math.round(box.x - box.w * 0.6), y: Math.round(box.y - box.h * 1.6), w: Math.round(box.w * 2.2), h: Math.round(box.h * 3.2) };
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { const c = sad(G0, G1, ex.x, ex.y, ex.w, ex.h, dx, dy, 2); if (c < best) { best = c; bx = dx; by = dy; } }
    let fx = bx, fy = by;
    for (let dy = by - 1; dy <= by + 1; dy++) for (let dx = bx - 1; dx <= bx + 1; dx++) { const c = sad(G0, G1, ex.x, ex.y, ex.w, ex.h, dx, dy, 1); if (c < best) { best = c; fx = dx; fy = dy; } }
    return { dx: fx, dy: fy };
  }
  // Bevegelse i munnområdet mellom to bilder, etter at hodebevegelsen er trukket fra
  function mouthSeries(grays, box0) {
    const out = new Float32Array(Math.max(0, grays.length - 1)); const boxes = [];
    let box = Object.assign({}, box0);
    for (let k = 0; k + 1 < grays.length; k++) {
      const m = trackBox(grays[k], grays[k + 1], box, Math.max(6, Math.round(box.w * 0.4)));
      out[k] = sad(grays[k], grays[k + 1], box.x, box.y, box.w, box.h, m.dx, m.dy, 1);
      boxes.push(Object.assign({}, box));
      box = { x: box.x + m.dx, y: box.y + m.dy, w: box.w, h: box.h };
      if (box.x < 0 || box.y < 0 || box.x + box.w > grays[k].w || box.y + box.h > grays[k].h) { box.x = Math.max(0, Math.min(grays[k].w - box.w, box.x)); box.y = Math.max(0, Math.min(grays[k].h - box.h, box.y)); }
    }
    return { series: out, boxes };
  }

  // ---------- Hjørner forstørret (synlige vannmerker) ----------
  // Returnerer et nytt bilde med de fire hjørnene (hver frac av bredde/høyde) forstørret 2×.
  function corners(img, frac) {
    frac = frac || 0.22;
    const { width: W, height: H, data: d } = img;
    const cw = Math.round(W * frac), ch = Math.round(H * frac), s = 2, gap = 6;
    const ow = cw * s * 2 + gap, oh = ch * s * 2 + gap; const out = new Uint8ClampedArray(ow * oh * 4).fill(30);
    const src = [[0, 0], [W - cw, 0], [0, H - ch], [W - cw, H - ch]], dst = [[0, 0], [cw * s + gap, 0], [0, ch * s + gap], [cw * s + gap, ch * s + gap]];
    for (let q = 0; q < 4; q++) for (let y = 0; y < ch * s; y++) for (let x = 0; x < cw * s; x++) {
      const sx = src[q][0] + Math.floor(x / s), sy = src[q][1] + Math.floor(y / s); const i = (sy * W + sx) * 4, o = ((dst[q][1] + y) * ow + dst[q][0] + x) * 4;
      out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; out[o + 3] = 255;
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { width: ow, height: oh, data: out };
  }

  const api = { gray, edges, estimateShift, diff, accumulate, cmap, percentile, trackBox, mouthSeries, corners };
  root.VfVisual = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
