function kkKlode(box, CFG, DOTS) {
  var root = box.querySelector('.fka-globe');
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
  function V(la, lo) { la *= D2R; lo *= D2R; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; }
  // Adminland ved publisering (antall administratorer, fra tabellen). ox/oy: pillens plassering ut fra punktet
  // Adminland med antall administratorer – regnet ut i Studio
  var P = CFG.P.map(function (p) { return { n: p.n, k: p.k, v: V(p.lat, p.lon), bias: 0 }; });
  P.forEach(function (p) {
    var el = document.createElement('span'); el.className = 'fka-pill';
    el.innerHTML = p.n + '<i>' + p.k + '</i>';
    root.appendChild(el); p.el = el;
  });
  var W = 0, H = 0, DPR = 1, R = 0, CX = 0, CY = 0, lon = CFG.home[0], lat = CFG.home[1], cL, sL, cP, sP;
  function setRot() { cL = Math.cos(lon * D2R); sL = Math.sin(lon * D2R); cP = Math.cos(lat * D2R); sP = Math.sin(lat * D2R); }
  function proj(v) {
    var X1 = v[0] * cL + v[1] * sL, Y1 = -v[0] * sL + v[1] * cL, d = X1 * cP + v[2] * sP, up = -X1 * sP + v[2] * cP;
    return [CX + R * Y1, CY - R * up, d];
  }
  function resize() {
    var r = root.getBoundingClientRect(); W = r.width; H = r.height; if (!W || !H) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    R = Math.min(H * 0.42, W * 0.3); CX = W * 0.5; CY = H * 0.52;
    P.forEach(function (p) { p.w = p.el.offsetWidth; p.h = p.el.offsetHeight; });
    draw();
  }
  function sm(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function draw() {
    if (!W) return;
    setRot();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    var g = ctx.createRadialGradient(CX - R * .3, CY - R * .45, R * .05, CX, CY, R);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#DCE6FF');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,80,252,.16)'; ctx.lineWidth = 1; ctx.stroke();
    var bk = [[], [], [], []], sz = Math.max(1.1, Math.min(R / 120, 2.4));
    for (var i = 0; i < N; i++) {
      var X = DX[i], Y = DY[i], Z = DZ[i], X1 = X * cL + Y * sL, d = X1 * cP + Z * sP;
      if (d <= 0.03) continue;
      var Y1 = -X * sL + Y * cL, up = -X1 * sP + Z * cP;
      bk[d > .6 ? 3 : d > .35 ? 2 : d > .15 ? 1 : 0].push(CX + R * Y1, CY - R * up, d);
    }
    var al = [.18, .3, .46, .66];
    for (var q = 0; q < 4; q++) {
      ctx.fillStyle = 'rgba(0,80,252,' + al[q] + ')'; ctx.beginPath(); var Bq = bk[q];
      for (var j = 0; j < Bq.length; j += 3) { var s2 = sz * (0.55 + 0.45 * Bq[j + 2]); ctx.rect(Bq[j] - s2 / 2, Bq[j + 1] - s2 / 2, s2, s2); }
      ctx.fill();
    }
    // Steder, streker og piller
    var gap = Math.max(34, Math.min(R * 0.6, 64)), vis = [];
    P.forEach(function (p) {
      var pt = proj(p.v), a = sm((pt[2] - 0.08) / 0.3);
      p.pt = pt; p.a = a;
      if (a <= 0.01) { p.el.style.opacity = '0'; p.el.style.visibility = 'hidden'; return; }
      // Pillen legges utover fra klodens sentrum (litt opp), med en fast vinkel-justering per sted
      // Steder høyt på kloden får pillen over seg, de lavere under – da får begge plass når de vises samtidig
      var below = pt[1] > CY - R * 0.48, dx = (pt[0] - CX) / R;
      p.px = pt[0] + dx * gap * 0.9; p.py = pt[1] + (below ? 1 : -1) * gap * 0.62;
      vis.push(p);
    });
    // Enkel kollisjonsunngåelse: skyv piller som overlapper fra hverandre i høyden
    for (var it = 0; it < 6; it++) for (var x1 = 0; x1 < vis.length; x1++) for (var x2 = x1 + 1; x2 < vis.length; x2++) {
      var A = vis[x1], Bp = vis[x2], ox = (A.w + Bp.w) / 2 + 6 - Math.abs(A.px - Bp.px), oy = (A.h + Bp.h) / 2 + 4 - Math.abs(A.py - Bp.py);
      if (ox > 0 && oy > 0) { var sgn = A.py <= Bp.py ? -1 : 1; A.py += sgn * oy / 2; Bp.py -= sgn * oy / 2; }
    }
    vis.forEach(function (p) {
      var pt = p.pt, a = p.a;
      // pillen holdes inne i feltet
      var px = Math.max(p.w / 2 + 6, Math.min(W - p.w / 2 - 6, p.px)), py = Math.max(p.h / 2 + 6, Math.min(H - p.h / 2 - 6, p.py));
      ctx.strokeStyle = 'rgba(0,80,252,' + (0.55 * a).toFixed(3) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = 'rgba(0,80,252,' + (0.18 * a).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(pt[0], pt[1], 6.5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(0,80,252,' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(pt[0], pt[1], 3, 0, 7); ctx.fill();
      p.el.style.visibility = 'visible'; p.el.style.opacity = a.toFixed(3);
      p.el.style.transform = 'translate(' + (px - p.w / 2).toFixed(1) + 'px,' + (py - p.h / 2).toFixed(1) + 'px)';
    });
  }
  var raf = 0, visible = true, last = 0, drag = null, vLon = 0, vLat = 0, idleAt = 0;
  // Dra for å snurre kloden selv (mus og berøring). Loddrett sveip på mobil scroller fortsatt siden.
  root.addEventListener('pointerdown', function (e) {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; vLon = vLat = 0;
    try { root.setPointerCapture(e.pointerId); } catch (er) {}
    root.classList.add('is-drag'); kick();
  });
  root.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var k = 90 / Math.max(80, R), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    vLon = -dx * k; vLat = dy * k;
    lon += vLon; lat = Math.max(-60, Math.min(70, lat + vLat));
    if (reduce) draw();
  });
  function end() { if (!drag) return; drag = null; idleAt = now(); root.classList.remove('is-drag'); kick(); }
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0; if (!visible) return;
    var dt = last ? Math.min(80, t - last) : 16; last = t;
    if (!drag) {
      // slipp med fart, brems rolig, og gli tilbake til vanlig rotasjon og helning etter en pause
      lon += vLon; lat = Math.max(-60, Math.min(70, lat + vLat)); vLon *= .94; vLat *= .94;
      if (Math.abs(vLon) < .01) vLon = 0; if (Math.abs(vLat) < .01) vLat = 0;
      if (!reduce && t - idleAt > 2500) { lon -= dt * 0.006; lat += (CFG.home[1] - lat) * 0.01; }   // ca. 6° i sekundet: én runde i minuttet
    }
    if (reduce && !drag && !vLon && !vLat) { draw(); return; }
    draw(); raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  resize();
  if (reduce) { visible = true; return; }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; last = 0; if (visible && !raf) raf = requestAnimationFrame(frame); }).observe(root);
  } else raf = requestAnimationFrame(frame);
}
function kkMore(box, total, enhet) {
  var b = box.querySelector('.more'); if (!b) return;
  b.addEventListener('click', function () { var o = box.classList.toggle('open'); b.setAttribute('aria-expanded', o); b.textContent = o ? 'Vis færre' : 'Vis alle ' + total + ' ' + (enhet || 'kontoer'); });
}
