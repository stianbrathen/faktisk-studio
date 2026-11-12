function mbKlode(root, CFG, DOTS) {
  if (!root || root.__g) return; root.__g = 1;
  var cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
  var D2R = Math.PI / 180;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', MAP = {};
  for (var b = 0; b < 64; b++) MAP[B64.charAt(b)] = b;
  var N = Math.floor(DOTS.length / 4), DX = new Float32Array(N), DY = new Float32Array(N), DZ = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var o = i * 4;
    var la = ((MAP[DOTS.charAt(o)] << 6 | MAP[DOTS.charAt(o + 1)]) - 600) / 10 * D2R;
    var lo = ((MAP[DOTS.charAt(o + 2)] << 6 | MAP[DOTS.charAt(o + 3)]) - 1800) / 10 * D2R;
    DX[i] = Math.cos(la) * Math.cos(lo); DY[i] = Math.cos(la) * Math.sin(lo); DZ[i] = Math.sin(la);
  }
  var W = 0, H = 0, DPR = 1, R = 0, CX = 0, CY = 0, HOME = { lon: CFG.home[0], lat: CFG.home[1] }, lon = HOME.lon, lat = HOME.lat, cL, sL, cP, sP;
  // Steder fra kartleggingen: adminland (vekt = antall administratorer i tabellen) og land der aktivitet er observert
  function V(la, lo) { la *= D2R; lo *= D2R; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; }
  // Steder fra Studio: src = fra-land (vekt), dst = til-land. Nettverksmodus: buer mellom alle stedene, uten fast retning.
  var SRC = CFG.src.map(function (x) { return { p: V(x.lat, x.lon), w: x.w || 1 }; });
  var DST = CFG.dst.map(function (x) { return V(x.lat, x.lon); });
  if (CFG.nett) { DST = SRC.map(function (x) { return x.p; }).concat(DST); SRC = DST.map(function (p) { return { p: p, w: 1 }; }); }
  var PLACES = CFG.nett ? DST.slice() : SRC.map(function (x) { return x.p; }).concat(DST);
  var WSUM = 0; for (var w0 = 0; w0 < SRC.length; w0++) WSUM += SRC[w0].w;
  function pickSrc() { var r = Math.random() * WSUM; for (var k = 0; k < SRC.length; k++) { r -= SRC[k].w; if (r <= 0) return SRC[k].p; } return SRC[0].p; }
  function jit(v) { var j = 0.012; var x = v[0] + (Math.random() - .5) * j, y = v[1] + (Math.random() - .5) * j, z = v[2] + (Math.random() - .5) * j, n = Math.sqrt(x * x + y * y + z * z); return [x / n, y / n, z / n]; }
  function setRot() { cL = Math.cos(lon * D2R); sL = Math.sin(lon * D2R); cP = Math.cos(lat * D2R); sP = Math.sin(lat * D2R); }
  function proj(X, Y, Z) {
    var X1 = X * cL + Y * sL, Y1 = -X * sL + Y * cL, d = X1 * cP + Z * sP, up = -X1 * sP + Z * cP;
    return [CX + R * Y1, CY - R * up, d];
  }
  function resize() {
    var r = root.getBoundingClientRect(); W = r.width; H = r.height; if (!W || !H) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    R = Math.max(W * 0.4, H * 1.05); CX = W * 0.5; CY = H * 0.5 + R * 0.1;
    draw(now());
  }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  // Buer fra adminland (vektet) til land der aktiviteten er observert
  var arcs = [], nextAt = 0;
  function spawn(t) {
    if (!SRC.length || !DST.length) return;
    var A0 = jit(pickSrc()), used = {};
    var n = 2 + ((Math.random() * 2) | 0);
    for (var k = 0; k < n; k++) {
      var di = (Math.random() * DST.length) | 0; if (used[di]) continue; used[di] = 1;
      var Bv = jit(DST[di]), dot = A0[0] * Bv[0] + A0[1] * Bv[1] + A0[2] * Bv[2];
      if (dot > 0.995) continue;
      arcs.push({ a: A0, b: Bv, om: Math.acos(Math.max(-1, Math.min(1, dot))), t0: t + k * 700, dur: 3200 + Math.random() * 1400, life: 9000 });
    }
  }
  function slerp(A, Bv, om, f) {
    var s = Math.sin(om), k1 = Math.sin((1 - f) * om) / s, k2 = Math.sin(f * om) / s;
    return [A[0] * k1 + Bv[0] * k2, A[1] * k1 + Bv[1] * k2, A[2] * k1 + Bv[2] * k2];
  }
  function draw(t) {
    if (!W) return;
    setRot();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    // Kule
    var g = ctx.createRadialGradient(CX - R * .3, CY - R * .45, R * .05, CX, CY, R);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#DCE6FF');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,80,252,.16)'; ctx.lineWidth = 1; ctx.stroke();
    // Prikker
    var bk = [[], [], [], []], sz = Math.max(1.2, Math.min(R / 190, 3));
    for (var i = 0; i < N; i++) {
      var X = DX[i], Y = DY[i], Z = DZ[i], X1 = X * cL + Y * sL, d = X1 * cP + Z * sP;
      if (d <= 0.03) continue;
      var Y1 = -X * sL + Y * cL, up = -X1 * sP + Z * cP, sx = CX + R * Y1, sy = CY - R * up;
      if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
      bk[d > .6 ? 3 : d > .35 ? 2 : d > .15 ? 1 : 0].push(sx, sy, d);
    }
    var al = [.2, .34, .52, .74];
    for (var q = 0; q < 4; q++) {
      ctx.fillStyle = 'rgba(0,80,252,' + al[q] + ')'; ctx.beginPath(); var Bq = bk[q];
      for (var j = 0; j < Bq.length; j += 3) { var s2 = sz * (0.55 + 0.45 * Bq[j + 2]); ctx.rect(Bq[j] - s2 / 2, Bq[j + 1] - s2 / 2, s2, s2); }
      ctx.fill();
    }
    // Faste, svake markører for stedene
    for (var pi = 0; pi < PLACES.length; pi++) {
      var pp = proj(PLACES[pi][0], PLACES[pi][1], PLACES[pi][2]);
      if (pp[2] <= 0.05) continue;
      ctx.fillStyle = 'rgba(0,80,252,.14)'; ctx.beginPath(); ctx.arc(pp[0], pp[1], 7, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(0,80,252,.75)'; ctx.beginPath(); ctx.arc(pp[0], pp[1], 2.4, 0, 7); ctx.fill();
    }
    // Buer
    ctx.lineCap = 'round';
    for (var k = arcs.length - 1; k >= 0; k--) {
      var A = arcs[k], age = t - A.t0;
      if (age < 0) continue;
      if (age > A.life) { arcs.splice(k, 1); continue; }
      var grow = Math.min(1, age / A.dur); grow = grow < 1 ? 1 - Math.pow(1 - grow, 2) : 1; var fade = age > A.life - 2500 ? (A.life - age) / 2500 : 1;
      var tail = Math.max(0, (age - A.dur * 0.9) / (A.life - A.dur * 0.9));
      var steps = 48, lift = 0.05 + A.om * 0.18, pts = [];
      for (var s = 0; s <= steps; s++) {
        var f = s / steps; if (f > grow) break;
        var v = slerp(A.a, A.b, A.om, f), h = 1 + lift * Math.sin(Math.PI * f);
        var p = proj(v[0] * h, v[1] * h, v[2] * h); pts.push(p, f);
      }
      if (pts.length < 4) continue;
      for (var m = 2; m < pts.length; m += 2) {
        var p0 = pts[m - 2], p1 = pts[m], f1 = pts[m + 1];
        if (p0[2] < -0.05 && p1[2] < -0.05) continue;
        if (f1 < tail) continue;
        var a2 = fade * (0.25 + 0.65 * f1);
        ctx.strokeStyle = 'rgba(0,80,252,' + a2.toFixed(3) + ')'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      // Startpunkt og hode
      var ps = proj(A.a[0], A.a[1], A.a[2]);
      if (ps[2] > 0) {
        var pr = (age % 2600) / 2600;
        ctx.strokeStyle = 'rgba(0,80,252,' + (0.5 * (1 - pr) * fade).toFixed(3) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(ps[0], ps[1], 3 + pr * 10, 0, 7); ctx.stroke();
        ctx.fillStyle = 'rgba(0,80,252,' + fade.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(ps[0], ps[1], 2.6, 0, 7); ctx.fill();
      }
      var hd = pts[pts.length - 2];
      if (hd[2] > -0.05) { ctx.fillStyle = 'rgba(0,80,252,' + (0.9 * fade).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(hd[0], hd[1], grow < 1 ? 2.4 : 2, 0, 7); ctx.fill(); }
    }
  }
  var raf = 0, visible = true, last = 0, tt = 0;
  function frame(t) {
    raf = 0;
    if (!visible) return;
    var dt = last ? Math.min(80, t - last) : 16; last = t;
    tt += dt; lon = HOME.lon + 14 * Math.sin(tt / 26000); lat = HOME.lat + 3 * Math.sin(tt / 37000);   // svak, langsom vugging rundt fokusområdet
    if (t > nextAt && arcs.length < 12) { spawn(t); nextAt = t + 2200 + Math.random() * 1400; }
    draw(t);
    raf = requestAnimationFrame(frame);
  }
  function startStatic() {  // redusert bevegelse: ett stillbilde med noen ferdige buer
    var t = now(); for (var k = 0; k < 3; k++) spawn(t - 6000); draw(t);
  }
  window.addEventListener('resize', resize);
  resize();
  if (reduce) { startStatic(); return; }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting; last = 0;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    }).observe(root);
  } else raf = requestAnimationFrame(frame);
}
