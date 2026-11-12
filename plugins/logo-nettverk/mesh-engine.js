// Logo-nettverk · «Tett nett»-motor (canvas)
//
// Variant av fnlRun for mange noder (100–250): logoen faller inn ovenfra,
// treffer med lysglimt og trykkbølge, og et tett nett av noder i to farger
// tennes utover til kantene. Etter introen lever nettet videre i loop.
// Canvas i stedet for SVG fordi hundrevis av noder med glød er for tungt
// som SVG på mobil. ES5, ingen avhengigheter — kopieres inn i embedden
// via toString() på samme måte som fnlRun.
function fnlMesh(root, C) {
  if (!root || root.__fnl) return;
  root.__fnl = 1;
  var cv = root.querySelector('canvas');
  var ctx = cv.getContext('2d');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var speed = C.speed || 1;

  // --- seedet tilfeldighet (lik layout i Studio og i artikkelen)
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeBack(t) { t = clamp(t, 0, 1); var s = 1.6; t -= 1; return t * t * ((s + 1) * t + s) + 1; }
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    var n = m ? parseInt(m[1], 16) : 0x5B8CFF;
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  var cols = [hexRgb(C.colorA || '#5B8CFF'), hexRgb(C.colorB || '#FF5A4E')];
  var bgMid = hexRgb(C.bgMid || '#16295A'), bgEdge = hexRgb(C.bgEdge || '#020409');
  var bgMix = [0, 1, 2].map(function (i) { return Math.round(bgMid[i] * 0.42 + bgEdge[i] * 0.58); });
  var nodeScale = C.nodeScale || 1;
  // Lys bakgrunn: lyse noder, mørkere ikoner, svakere glød
  var light = C.bg !== 'transparent' && (bgMid[0] * 0.3 + bgMid[1] * 0.59 + bgMid[2] * 0.11) > 150;
  var glowK = light ? 0.45 : 1;
  // Symboler: innebygde ikoner (Path2D) eller egne bilder (PNG fra Labrador)
  var syms = (C.symbols || []).map(function (sy) {
    if (sy.kind === 'icon') { try { return window.Path2D ? { p: new Path2D(sy.d) } : null; } catch (e) { return null; } }
    var im = new Image(); im.onload = function () { if (W) draw(performance.now()); }; im.src = sy.url; return { im: im };
  }).filter(function (x) { return x; });

  // Glød-sprites per farge (tegnes én gang, gjenbrukes med 'lighter')
  function glowSprite(c) {
    var g = document.createElement('canvas'); g.width = g.height = 64;
    var x = g.getContext('2d');
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, 0.9)); gr.addColorStop(0.25, rgba(c, 0.35)); gr.addColorStop(1, rgba(c, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return g;
  }
  var glows = [glowSprite(cols[0]), glowSprite(cols[1]), glowSprite([255, 255, 255])];

  var logo = null, logoReady = !C.logo;
  if (C.logo) {
    logo = new Image();
    logo.onload = function () { logoReady = true; if (pendingStart) start(); else draw(lastT); };
    logo.onerror = function () { logo = null; logoReady = true; if (pendingStart) start(); };
    logo.src = C.logo;
  }

  var W = 0, H = 0, S = 1, dpr = 1, cx = 0, cy = 0, logoR = 0, clearR = 0;
  var nodes = [], edges = [], spokes = [], packets = [];
  var introStart = -1, introEnd = 0, done = false, visible = false, raf = 0, lastT = -1, pendingStart = false;
  var lastSpawn = 0, nextPulse = 0, pulseAt = -1e9;

  function layout() {
    var r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); S = Math.min(W, H);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cx = W / 2; cy = H / 2;
    logoR = S * (C.logoSize || 0.3) / 2;
    clearR = logoR * (C.clear || 1.9);

    var rand = rng(C.seed || 7);
    // Antall noder: «count» gjelder 16:9; smalere formater får færre
    var N = Math.round((C.count || 150) * (W * H / (S * S)) / (16 / 9));
    N = clamp(N, 20, 320);
    var pad = S * 0.04;
    var minD = Math.sqrt((W + 2 * pad) * (H + 2 * pad) / (N * 1.7));
    nodes = [];
    var tries = 0;
    while (nodes.length < N && tries < N * 40) {
      tries++;
      var x = -pad + rand() * (W + 2 * pad), y = -pad + rand() * (H + 2 * pad);
      var dc = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (dc < clearR) continue;
      var ok = true;
      for (var i = 0; i < nodes.length; i++) {
        var dx = nodes[i].x - x, dy = nodes[i].y - y;
        if (dx * dx + dy * dy < minD * minD) { ok = false; break; }
      }
      if (!ok) continue;
      nodes.push({ x: x, y: y, d: dc });
    }
    // Farge: glatt felt + støy, så rødt og blått klumper seg litt som i et ekte nettverk
    var p1 = rand() * 6.28, p2 = rand() * 6.28;
    var fv = nodes.map(function (n) {
      return Math.sin(n.x / S * 3.1 + p1) + Math.cos(n.y / S * 2.7 + p2) + (rand() - 0.5) * 1.6;
    });
    var sorted = fv.slice().sort(function (a, b) { return a - b; });
    var thr = sorted[Math.floor(sorted.length * (1 - (C.mix == null ? 0.42 : C.mix)))] || 0;
    var maxD = 0;
    nodes.forEach(function (n, i) {
      n.c = fv[i] >= thr ? 1 : 0;
      n.icon = rand() < (C.iconShare == null ? 0.62 : C.iconShare);
      n.r = n.icon ? S * 0.017 * nodeScale * (0.8 + rand() * 0.45) : S * (0.0035 + rand() * 0.002) * Math.sqrt(nodeScale);
      n.s = syms.length ? Math.floor(rand() * syms.length) : -1;
      n.ph = rand() * 6.28; n.ph2 = rand() * 6.28;
      n.w1 = 0.00035 + rand() * 0.0004; n.w2 = 0.0003 + rand() * 0.0004;
      n.tw = 0.0006 + rand() * 0.0012;
      n.flash = -1e9;
      if (n.d > maxD) maxD = n.d;
    });
    // Kanter: nærmeste naboer
    edges = [];
    var seen = {};
    nodes.forEach(function (n, i) {
      var near = [];
      for (var j = 0; j < nodes.length; j++) {
        if (j === i) continue;
        var dx = nodes[j].x - n.x, dy = nodes[j].y - n.y, dd = dx * dx + dy * dy;
        if (dd < minD * minD * 6.2) near.push([dd, j]);
      }
      near.sort(function (a, b) { return a[0] - b[0]; });
      var k = n.icon ? 3 : 2;
      for (var q = 0; q < Math.min(k, near.length); q++) {
        var j2 = near[q][1], key = i < j2 ? i + '-' + j2 : j2 + '-' + i;
        if (seen[key]) continue;
        seen[key] = 1;
        edges.push({ a: n, b: nodes[j2] });
      }
    });
    // Eiker fra logoen til den innerste ringen av noder
    spokes = [];
    var inner = nodes.filter(function (n) { return n.d < clearR + minD * 2.2; })
      .sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    var step = Math.max(1, Math.floor(inner.length / (C.spokes || 22)));
    for (var s = 0; s < inner.length; s += step) spokes.push({ b: inner[s] });

    // Tidsplan (ms): logo faller 0–650, treff 650, nettet tennes utover
    var DROP = 650;
    nodes.forEach(function (n) {
      n.t = DROP + 120 + (n.d - clearR) / Math.max(1, maxD - clearR) * 1900 + rand() * 260;
    });
    edges.forEach(function (e) {
      var first = e.a.t < e.b.t ? e.a : e.b, last = first === e.a ? e.b : e.a;
      e.from = first; e.to = last;
      e.t = first.t + 60; e.dur = Math.max(220, last.t - first.t + 120);
      e.c = first.c;
    });
    spokes.forEach(function (sp) { sp.t = DROP + 40 + rand() * 140; sp.dur = Math.max(260, sp.b.t - sp.t); });
    introEnd = 0;
    nodes.forEach(function (n) { introEnd = Math.max(introEnd, n.t + 400); });
    edges.forEach(function (e) { introEnd = Math.max(introEnd, e.t + e.dur); });
  }

  function pos(n, now) {
    if (!done && introStart >= 0 && C.motion === 0) return [n.x, n.y];
    var amp = S * (C.motion === 2 ? 0.009 : 0.0045) * (C.motion === 0 ? 0 : 1);
    var fade = done ? 1 : 0;
    if (!done && introStart >= 0) fade = clamp(((now - introStart) * speed - introEnd + 400) / 1500, 0, 1);
    return [n.x + Math.sin(now * n.w1 + n.ph) * amp * fade, n.y + Math.cos(now * n.w2 + n.ph2) * amp * fade];
  }

  function draw(now) {
    lastT = now;
    var t = done ? 1e9 : (introStart < 0 ? -1 : (now - introStart) * speed);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Bakgrunn
    if (C.bg !== 'transparent') {
      var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.62);
      bg.addColorStop(0, rgba(bgMid, 1)); bg.addColorStop(0.38, rgba(bgMix, 1));
      bg.addColorStop(1, rgba(bgEdge, 1));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    } else ctx.clearRect(0, 0, W, H);
    if (t < 0) return;

    var DROP = 650;
    var lw = Math.max(0.8, S * 0.0013);
    // Logo-halo
    var haloA = clamp(t / DROP, 0, 1) * 0.55 * ((done || t > introEnd) && C.breath !== false ? 0.8 + 0.2 * Math.sin(now * 0.0016) : 1);
    var halo = ctx.createRadialGradient(cx, cy, logoR * 0.6, cx, cy, logoR * 3.4);
    halo.addColorStop(0, rgba(cols[0], haloA * 0.55 * glowK)); halo.addColorStop(1, rgba(cols[0], 0));
    ctx.fillStyle = halo; ctx.fillRect(cx - logoR * 3.4, cy - logoR * 3.4, logoR * 6.8, logoR * 6.8);

    // Faste svake ringer rundt logoen
    var ringA = clamp((t - DROP) / 600, 0, 1) * 0.28;
    ctx.lineWidth = lw; ctx.strokeStyle = rgba(cols[0], ringA);
    ctx.beginPath(); ctx.arc(cx, cy, clearR * 0.92, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = rgba(cols[0], ringA * 0.7);
    ctx.beginPath(); ctx.arc(cx, cy, logoR * 1.32, 0, 6.2832); ctx.stroke();

    // Eiker
    spokes.forEach(function (sp) {
      var p = easeOut((t - sp.t) / sp.dur); if (p <= 0) return;
      var b = pos(sp.b, now), ang = Math.atan2(b[1] - cy, b[0] - cx);
      var x0 = cx + Math.cos(ang) * logoR * 1.02, y0 = cy + Math.sin(ang) * logoR * 1.02;
      ctx.strokeStyle = rgba(cols[sp.b.c], 0.32);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (b[0] - x0) * p, y0 + (b[1] - y0) * p); ctx.stroke();
    });
    // Kanter
    edges.forEach(function (e) {
      var p = easeOut((t - e.t) / e.dur); if (p <= 0) return;
      var a = pos(e.from, now), b = pos(e.to, now);
      ctx.strokeStyle = rgba(cols[e.c], 0.42);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p); ctx.stroke();
    });

    // Pakker
    ctx.globalCompositeOperation = 'lighter';
    for (var i = packets.length - 1; i >= 0; i--) {
      var pk = packets[i], q = (now - pk.s) / pk.dur;
      if (q >= 1) { pk.to.flash = now; packets.splice(i, 1); continue; }
      var a2 = pos(pk.from, now), b2 = pos(pk.to, now);
      var px = a2[0] + (b2[0] - a2[0]) * q, py = a2[1] + (b2[1] - a2[1]) * q, gs = S * 0.03;
      ctx.drawImage(glows[2], px - gs / 2, py - gs / 2, gs, gs);
      ctx.drawImage(glows[pk.c], px - gs, py - gs, gs * 2, gs * 2);
    }
    // Glød bak nodene
    nodes.forEach(function (n) {
      var age = t - n.t; if (age <= 0) return;
      var pp = pos(n, now);
      var tw = Math.pow(Math.max(0, Math.sin(now * n.tw + n.ph)), 6);
      var fl = clamp(1 - (now - n.flash) / 600, 0, 1);
      var pop = clamp(1 - age / 500, 0, 1);
      var g = (n.icon ? 0.22 : 0.45) + tw * 0.55 + fl * 0.8 + pop * 0.6;
      var gs = (n.icon ? n.r * 4.2 : n.r * 9) * (1 + fl * 0.4);
      ctx.globalAlpha = clamp(g * glowK, 0, 1);
      ctx.drawImage(glows[n.c], pp[0] - gs, pp[1] - gs, gs * 2, gs * 2);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Nodene
    nodes.forEach(function (n) {
      var age = t - n.t; if (age <= 0) return;
      var sc = easeBack(age / 380);
      var pp = pos(n, now), r = n.r * sc, c = cols[n.c];
      if (!n.icon) {
        ctx.fillStyle = rgba(c, 0.95);
        ctx.beginPath(); ctx.arc(pp[0], pp[1], r, 0, 6.2832); ctx.fill();
        return;
      }
      ctx.fillStyle = light ? rgba([255 - (255 - c[0]) * 0.15 | 0, 255 - (255 - c[1]) * 0.15 | 0, 255 - (255 - c[2]) * 0.15 | 0], 0.95)
        : rgba([c[0] * 0.18 | 0, c[1] * 0.18 | 0, c[2] * 0.22 | 0], 0.92);
      ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = Math.max(1, S * 0.0022);
      ctx.beginPath(); ctx.arc(pp[0], pp[1], r, 0, 6.2832); ctx.fill(); ctx.stroke();
      var sy = n.s >= 0 ? syms[n.s] : null;
      if (sy && sy.p) {
        var is = r * 1.15 / 24;
        ctx.save(); ctx.translate(pp[0] - r * 0.575, pp[1] - r * 0.6); ctx.scale(is, is);
        ctx.fillStyle = light ? rgba([c[0] * 0.75 | 0, c[1] * 0.75 | 0, c[2] * 0.75 | 0], 1)
          : rgba([Math.min(255, c[0] + 60), Math.min(255, c[1] + 60), Math.min(255, c[2] + 60)], 1);
        ctx.fill(sy.p, 'evenodd'); ctx.restore();
      } else if (sy && sy.im && sy.im.complete && sy.im.naturalWidth) {
        var iw = r * 1.3, ih = iw, ar = sy.im.naturalWidth / sy.im.naturalHeight;
        if (ar > 1) ih = iw / ar; else iw = ih * ar;
        ctx.drawImage(sy.im, pp[0] - iw / 2, pp[1] - ih / 2, iw, ih);
      } else if (!sy) {
        ctx.fillStyle = rgba(c, 0.95);
        ctx.beginPath(); ctx.arc(pp[0], pp[1], r * 0.32, 0, 6.2832); ctx.fill();
      }
    });

    // Trykkbølger ved treffet, og svake pulser i loopen
    function wave(t0, life, a0) {
      var q = (t - t0) / life; if (q < 0 || q > 1) return;
      ctx.lineWidth = Math.max(1, S * 0.003) * (1 - q * 0.6);
      ctx.strokeStyle = rgba(cols[0], a0 * (1 - q));
      ctx.beginPath(); ctx.arc(cx, cy, logoR * 1.05 + easeOut(q) * Math.max(W, H) * 0.7, 0, 6.2832); ctx.stroke();
    }
    wave(DROP, 1300, 0.75); wave(DROP + 180, 1500, 0.45);
    if (done || t > introEnd) {
      var pq = (now - pulseAt) / 2600;
      if (pq >= 0 && pq <= 1) {
        ctx.lineWidth = Math.max(1, S * 0.002); ctx.strokeStyle = rgba(cols[0], 0.3 * (1 - pq));
        ctx.beginPath(); ctx.arc(cx, cy, logoR * 1.05 + easeOut(pq) * clearR * 1.8, 0, 6.2832); ctx.stroke();
      }
    }

    // Logoen faller inn ovenfra
    var dp = clamp(t / DROP, 0, 1);
    // Faller med akselerasjon, treffer ved DROP, spretter litt tilbake
    var ly = -logoR * 1.2 + (cy + logoR * 1.2) * dp * dp;
    var bq = (t - DROP) / 420;
    if (bq > 0 && bq < 1) ly = cy - Math.sin(Math.PI * bq) * logoR * 0.14 * (1 - bq);
    var ls = 1.12 - 0.12 * dp;
    if (bq > 0 && bq < 0.25) ls = 1 + 0.05 * Math.sin(Math.PI * bq / 0.25);
    var flash = clamp(1 - (t - DROP) / 450, 0, 1) * (t >= DROP ? 1 : 0);
    if (flash > 0) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash * 0.85;
      var fs = logoR * 4.5;
      ctx.drawImage(glows[2], cx - fs, cy - fs, fs * 2, fs * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    var R = logoR * ls;
    if (logo && logoReady && logo.naturalWidth) {
      var ar = logo.naturalWidth / logo.naturalHeight, lw2 = R * 2, lh2 = R * 2;
      if (ar > 1) lh2 = lw2 / ar; else lw2 = lh2 * ar;
      ctx.drawImage(logo, cx - lw2 / 2, ly - lh2 / 2, lw2, lh2);
    } else {
      ctx.fillStyle = rgba(cols[0], 1);
      ctx.beginPath(); ctx.arc(cx, ly, R * 0.8, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + (R * 0.38) + 'px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('LOGO', cx, ly);
    }
  }

  function frame(now) {
    raf = 0;
    if (!done && introStart >= 0 && (now - introStart) * speed > introEnd) done = true;
    if (done && !reduce) {
      if (C.packets !== false && now - lastSpawn > (C.motion === 2 ? 140 : 240) && packets.length < 16 && edges.length) {
        lastSpawn = now;
        var e = edges[Math.floor(Math.random() * edges.length)], fwd = Math.random() < 0.5;
        packets.push({ from: fwd ? e.a : e.b, to: fwd ? e.b : e.a, s: now, dur: 700 + Math.random() * 700, c: e.c });
      }
      if (C.breath !== false && now > nextPulse) { pulseAt = now; nextPulse = now + 4200; }
    }
    draw(now);
    // Ikke startet ennå = ingenting å animere (bare bakgrunnen står)
    var animating = introStart >= 0 && (!done || (!reduce && (C.motion !== 0 || C.packets !== false || C.breath !== false)));
    if (animating && visible) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  function start() {
    pendingStart = false;
    if (!logoReady) { pendingStart = true; return; }
    introStart = performance.now(); done = false; packets = []; nextPulse = introStart + introEnd / speed + 600;
    kick();
  }
  function finish() { done = true; introStart = 0; draw(performance.now()); kick(); }
  root.__fnlPlay = function () { visible = true; start(); };

  layout();
  draw(performance.now());

  if ('ResizeObserver' in window) {
    var rw = 0;
    new ResizeObserver(function () {
      var w = root.getBoundingClientRect().width;
      if (Math.abs(w - rw) < 1) return;
      rw = w; layout(); draw(performance.now()); kick();
    }).observe(root);
  }

  var trig = C.trigger || 'middle';
  if (reduce || trig === 'static' || root.hasAttribute('data-static')) {
    visible = true; finish();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) kick(); }).observe(root);
    }
    return;
  }
  if (!('IntersectionObserver' in window)) { visible = true; start(); return; }
  var margin = trig === 'early' ? '0px 0px -10% 0px' : trig === 'middle' ? '0px 0px -30% 0px' : '0px';
  var started = false;
  new IntersectionObserver(function (es) {
    var en = es[0];
    var ok = en.isIntersecting;
    if (ok && trig === 'full') {
      var b = en.boundingClientRect, vh = window.innerHeight;
      ok = b.bottom <= vh + 1 || b.top <= vh * 0.15;
    }
    if (ok && !started) { started = true; visible = true; start(); }
  }, { rootMargin: margin, threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(root);
  new IntersectionObserver(function (es) {
    visible = es[0].isIntersecting;
    if (visible) kick();
  }).observe(root);
}
