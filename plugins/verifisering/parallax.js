// Faktisk Studio · Verifisering — parallakse (dybde i bakgrunnen)
//
// Spørsmål: beveger bakgrunnen seg som ett flatt bilde, eller har den dybde?
// Når kameraet flytter seg, forskyves ting på ulik avstand ulikt (parallakse).
// Et stillbilde som er zoomet/panorert/rotert, beveger seg derimot nøyaktig som
// ett plan — det kan beskrives fullt ut med én homografi.
//
// Metode (ren JS, ingen OpenCV):
//  1. hjørnepunkter (Shi–Tomasi) i bakgrunnen (personen er maskert ut)
//  2. sporing til et senere bilde: grov-til-fin blokksøk + sub-piksel, sjekket begge veier
//  3. homografi med RANSAC → avvik for hvert punkt
//  4. «sammenhengende avvik»: punkter som bommer på planet OG peker samme vei som
//     naboene (ekte dybde), ikke tilfeldig støy (sporingsfeil)
//
// Tolkning (forsiktig!): sammenhengende avvik → bakgrunnen har dybde.
// Ingen avvik → forenlig med et flatt bilde, MEN også med en fjern scene, en
// flat fasade eller et kamera som bare dreies. Det må stå i hvert funn.

(function (root) {
  'use strict';

  function gray(img) { const g = new Float32Array(img.width * img.height); const d = img.data; for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return { w: img.width, h: img.height, g }; }
  function half(G) { const w = G.w >> 1, h = G.h >> 1, g = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * G.w + 2 * x; g[y * w + x] = (G.g[i] + G.g[i + 1] + G.g[i + G.w] + G.g[i + G.w + 1]) / 4; } return { w, h, g }; }
  function pyramid(G, n) { const p = [G]; for (let i = 1; i < n; i++) p.push(half(p[i - 1])); return p; }

  // Shi–Tomasi: minste egenverdi av strukturtensoren i 5×5-vindu
  function corners(G, mask, max, minDist) {
    const { w, h, g } = G; const ix = new Float32Array(w * h), iy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; ix[i] = (g[i + 1] - g[i - 1]) / 2; iy[i] = (g[i + w] - g[i - w]) / 2; }
    const score = new Float32Array(w * h); const r = 2; const B = 12;
    for (let y = B; y < h - B; y++) for (let x = B; x < w - B; x++) {
      if (mask && mask[y * w + x]) continue;
      let a = 0, b = 0, c = 0;
      for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { const j = (y + yy) * w + x + xx; a += ix[j] * ix[j]; b += ix[j] * iy[j]; c += iy[j] * iy[j]; }
      const tr = (a + c) / 2, det = Math.sqrt(Math.max(0, tr * tr - (a * c - b * b)));
      score[y * w + x] = tr - det;
    }
    // jevn fordeling: beste punkt per celle, så avstandskrav
    const cell = minDist; const cand = [];
    for (let cy = B; cy < h - B; cy += cell) for (let cx = B; cx < w - B; cx += cell) {
      let best = 0, bx = -1, by = -1;
      for (let y = cy; y < Math.min(h - B, cy + cell); y++) for (let x = cx; x < Math.min(w - B, cx + cell); x++) { const s = score[y * w + x]; if (s > best) { best = s; bx = x; by = y; } }
      if (bx >= 0) cand.push({ x: bx, y: by, s: best });
    }
    cand.sort((p, q) => q.s - p.s);
    const thr = (cand[Math.floor(cand.length * 0.1)] || { s: 0 }).s * 0.05;
    return cand.filter(p => p.s > thr).slice(0, max);
  }

  function sad(A, B, ax, ay, bx, by, r) {
    let s = 0;
    for (let y = -r; y <= r; y++) { const ra = (ay + y) * A.w + ax, rb = (by + y) * B.w + bx; for (let x = -r; x <= r; x++) { const d = A.g[ra + x] - B.g[rb + x]; s += d < 0 ? -d : d; } }
    return s;
  }
  // Følg ett punkt fra A til B gjennom pyramiden. init = (dx, dy) på fullt nivå.
  function trackPoint(PA, PB, x, y, init, R, search) {
    let dx = init[0], dy = init[1];
    for (let l = PA.length - 1; l >= 0; l--) {
      const A = PA[l], B = PB[l], f = 1 << l;
      const ax = Math.round(x / f), ay = Math.round(y / f);
      let cx = Math.round(dx / f), cy = Math.round(dy / f);
      if (ax - R < 0 || ay - R < 0 || ax + R >= A.w || ay + R >= A.h) return null;
      let best = Infinity, bx = cx, by = cy; const s = l === PA.length - 1 ? search : 2;
      for (let yy = cy - s; yy <= cy + s; yy++) for (let xx = cx - s; xx <= cx + s; xx++) {
        const px = ax + xx, py = ay + yy; if (px - R < 0 || py - R < 0 || px + R >= B.w || py + R >= B.h) continue;
        const c = sad(A, B, ax, ay, px, py, R); if (c < best) { best = c; bx = xx; by = yy; }
      }
      if (best === Infinity) return null;
      dx = bx * f; dy = by * f;
      if (l === 0) {
        // sub-piksel: parabel gjennom naboene
        const c0 = best, px = ax + bx, py = ay + by;
        const okx = px - R - 1 >= 0 && px + R + 1 < B.w, oky = py - R - 1 >= 0 && py + R + 1 < B.h;
        if (okx) { const cl = sad(A, B, ax, ay, px - 1, py, R), cr = sad(A, B, ax, ay, px + 1, py, R); const den = cl - 2 * c0 + cr; if (den > 0) dx += 0.5 * (cl - cr) / den; }
        if (oky) { const cu = sad(A, B, ax, ay, px, py - 1, R), cd = sad(A, B, ax, ay, px, py + 1, R); const den = cu - 2 * c0 + cd; if (den > 0) dy += 0.5 * (cu - cd) / den; }
        return { dx, dy, cost: c0 / ((2 * R + 1) * (2 * R + 1)) };
      }
    }
    return null;
  }

  // ---------- homografi ----------
  function solve(A, b) { // Gauss med delvis pivotering, A n×n
    const n = b.length; const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function homography(src, dst) {
    // minste kvadrater (≥4 punkt), h33 = 1
    const A = [], b = [];
    for (let i = 0; i < src.length; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // normallikninger
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    for (let r = 0; r < A.length; r++) for (let i = 0; i < 8; i++) { Atb[i] += A[r][i] * b[r]; for (let j = 0; j < 8; j++) AtA[i][j] += A[r][i] * A[r][j]; }
    const h = solve(AtA, Atb); return h ? h.concat([1]) : null;
  }
  function apply(H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
  function normalize(pts) { // for numerisk stabilitet
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    let d = 0; for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my); d = d / pts.length || 1; const s = Math.SQRT2 / d;
    return { pts: pts.map(p => [(p[0] - mx) * s, (p[1] - my) * s]), T: [s, 0, -mx * s, 0, s, -my * s, 0, 0, 1] };
  }
  function mul3(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; }
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  function homographyN(src, dst) {
    const ns = normalize(src), nd = normalize(dst); const Hn = homography(ns.pts, nd.pts); if (!Hn) return null;
    const H = mul3(inv3(nd.T), mul3(Hn, ns.T)); return H.map(v => v / H[8]);
  }
  function ransac(src, dst, thr, iters) {
    const n = src.length; if (n < 8) return null; let best = null, bestCount = -1; let seed = 987654321;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let it = 0; it < iters; it++) {
      const idx = new Set(); while (idx.size < 4) idx.add(Math.floor(rnd() * n));
      const ii = Array.from(idx); const H = homographyN(ii.map(i => src[i]), ii.map(i => dst[i])); if (!H || H.some(v => !isFinite(v))) continue;
      let c = 0; for (let i = 0; i < n; i++) { const p = apply(H, src[i][0], src[i][1]); if (Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) < thr) c++; }
      if (c > bestCount) { bestCount = c; best = H; }
    }
    if (!best) return null;
    // forbedre på alle inliers
    const inl = []; for (let i = 0; i < n; i++) { const p = apply(best, src[i][0], src[i][1]); if (Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) < thr) inl.push(i); }
    const H2 = inl.length >= 8 ? homographyN(inl.map(i => src[i]), inl.map(i => dst[i])) : best;
    return H2 || best;
  }

  // imgA, imgB: ImageData-form. mask: Uint8Array (1 = person/forgrunn) i A-koordinater, eller null.
  function analyze(imgA, imgB, mask, opts) {
    opts = opts || {};
    const A = gray(imgA), B = gray(imgB); const levels = 4;
    const PA = pyramid(A, levels), PB = pyramid(B, levels);
    // utvid masken (personens kanter gir falske punkter)
    let M = null;
    if (mask) {
      M = new Uint8Array(A.w * A.h); const r = Math.round(A.w * 0.02);
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) if (mask[y * A.w + x]) for (let yy = Math.max(0, y - r); yy <= Math.min(A.h - 1, y + r); yy += r) for (let xx = Math.max(0, x - r); xx <= Math.min(A.w - 1, x + r); xx += r) M[yy * A.w + xx] = 1;
      // fyll hull etter grovt steg
      for (let y = 0; y < A.h; y++) for (let x = 1; x < A.w - 1; x++) if (!M[y * A.w + x] && M[y * A.w + x - 1] && M[y * A.w + x + 1]) M[y * A.w + x] = 1;
    }
    const pts = corners(A, M, opts.maxPoints || 500, Math.max(8, Math.round(A.w / 48)));
    const init = opts.init || [0, 0]; const R = 4;
    const src = [], dst = [], meta = [];
    for (const p of pts) {
      const f = trackPoint(PA, PB, p.x, p.y, init, R, 8); if (!f) continue;
      const q = [p.x + f.dx, p.y + f.dy];
      const b = trackPoint(PB, PA, Math.round(q[0]), Math.round(q[1]), [-f.dx, -f.dy], R, 3); if (!b) continue;
      const fb = Math.hypot(Math.round(q[0]) + b.dx - p.x, Math.round(q[1]) + b.dy - p.y);
      if (fb > 1.2 || f.cost > 18) continue;
      src.push([p.x, p.y]); dst.push(q); meta.push({ fb, cost: f.cost });
    }
    const res = { width: A.w, height: A.h, detected: pts.length, tracked: src.length, points: [] };
    if (src.length < 20) { res.error = 'For få bakgrunnspunkter å følge (' + src.length + ')'; return res; }
    let mot = 0; for (let i = 0; i < src.length; i++) mot += Math.hypot(dst[i][0] - src[i][0], dst[i][1] - src[i][1]); res.motion = mot / src.length;
    const thr = Math.max(0.8, A.w / 640 * 1.0);
    const H = ransac(src, dst, thr, 600); if (!H) { res.error = 'Fant ikke noe plan å sammenligne med'; return res; }
    res.H = H;
    const resid = src.map((s, i) => { const p = apply(H, s[0], s[1]); return [dst[i][0] - p[0], dst[i][1] - p[1]]; });
    const mag = resid.map(r => Math.hypot(r[0], r[1]));
    const sorted = mag.slice().sort((a, b) => a - b); res.medianResid = sorted[sorted.length >> 1]; res.p90Resid = sorted[Math.floor(sorted.length * 0.9)];
    res.inlierShare = mag.filter(m => m < thr).length / mag.length;
    // Områder som flytter seg annerledes enn planet: del bildet i ruter og se på
    // MEDIANEN av avvikene i hver rute. Enkeltpunkter kan være sporingsfeil; en hel
    // rute som forskyves samme vei, er dybde. (Referanseklippet: interiøret bak glasset
    // −2,4 px mot ±0,3 px for fasaden ved 66 px kamerabevegelse, 1280 px bredde.)
    const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
    const comps = resid.flatMap(r => r); const m0 = med(comps); const sigma = 1.4826 * med(comps.map(v => Math.abs(v - m0))) || 0.3;
    const GX = 6, GY = 4, cw = A.w / GX, ch = A.h / GY; const cells = []; const minShift = Math.max(1.0, A.w / 1280 * 1.2);
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      const idx = []; for (let i = 0; i < src.length; i++) if (src[i][0] >= gx * cw && src[i][0] < (gx + 1) * cw && src[i][1] >= gy * ch && src[i][1] < (gy + 1) * ch) idx.push(i);
      if (idx.length < 4) continue;
      const mx = med(idx.map(i => resid[i][0])), my = med(idx.map(i => resid[i][1])); const mm = Math.hypot(mx, my);
      const agree = idx.filter(i => (resid[i][0] * mx + resid[i][1] * my) / (mag[i] * mm || 1) > 0.5).length / idx.length;
      const sig = mm > Math.max(minShift, 3 * sigma / Math.sqrt(idx.length)) && agree >= 0.6;
      cells.push({ x0: gx * cw, y0: gy * ch, x1: (gx + 1) * cw, y1: (gy + 1) * ch, n: idx.length, mx, my, m: mm, agree, sig, idx });
    }
    const depthIdx = new Set(); cells.filter(c => c.sig).forEach(c => c.idx.forEach(i => { const cos = (resid[i][0] * c.mx + resid[i][1] * c.my) / (mag[i] * c.m || 1); if (cos > 0.5) depthIdx.add(i); }));
    res.sigma = sigma; res.cells = cells.map(c => { const o = Object.assign({}, c); delete o.idx; return o; });
    res.depthCells = cells.filter(c => c.sig).length; res.cellsUsed = cells.length;
    res.depthShare = depthIdx.size / src.length; res.maxCellShift = cells.length ? Math.max.apply(null, cells.filter(c => c.sig).map(c => c.m).concat([0])) : 0;
    res.outlierShare = mag.filter(m => m >= thr * 1.5).length / src.length;
    res.points = src.map((s, i) => ({ x: s[0], y: s[1], rx: resid[i][0], ry: resid[i][1], m: mag[i], kind: depthIdx.has(i) ? 'dybde' : mag[i] >= thr * 1.5 ? 'avvik' : 'plan' }));
    res.thr = thr;
    return res;
  }

  // Tegn resultatet oppå bildet A (ImageData) → ny ImageData-lignende
  function overlay(ctx, res, scale) {
    scale = scale || 1; const k = 6; // forstørr avvikene så de syns
    for (const c of res.cells || []) {
      if (!c.sig) continue;
      ctx.fillStyle = 'rgba(255,122,0,0.16)'; ctx.strokeStyle = 'rgba(255,122,0,0.9)'; ctx.lineWidth = 2;
      ctx.fillRect(c.x0 * scale, c.y0 * scale, (c.x1 - c.x0) * scale, (c.y1 - c.y0) * scale); ctx.strokeRect(c.x0 * scale, c.y0 * scale, (c.x1 - c.x0) * scale, (c.y1 - c.y0) * scale);
      const cx = (c.x0 + c.x1) / 2 * scale, cy = (c.y0 + c.y1) / 2 * scale; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + c.mx * k * 2 * scale, cy + c.my * k * 2 * scale); ctx.stroke();
    }
    for (const p of res.points) {
      const x = p.x * scale, y = p.y * scale;
      ctx.strokeStyle = p.kind === 'dybde' ? '#FF7A00' : p.kind === 'avvik' ? 'rgba(255,255,255,0.55)' : '#28C76F';
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = p.kind === 'dybde' ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, p.kind === 'plan' ? 2.5 : 3.5, 0, 7); ctx.fill();
      if (p.kind !== 'plan') { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.rx * k * scale, y + p.ry * k * scale); ctx.stroke(); }
    }
  }

  const api = { analyze, overlay, corners, ransac, apply, homographyN };
  root.VfParallax = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
