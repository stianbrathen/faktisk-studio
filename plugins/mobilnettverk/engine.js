// Mobilnettverk · motor (embed)
//
// Skjermbilder vises på telefoner i tre dybdelag (store foran, mindre og mørkere bak) over et
// glødende nettverk. Telefonene svever rolig. Klikk/trykk på en telefon åpner skjermbildet stort
// (lysboks med bla-knapper, Esc, sveip). ES5, ingen avhengigheter — kopieres inn i embedden
// via toString(), så forhåndsvisningen i Studio kjører nøyaktig samme kode.
function fmnRun(root, C) {
  if (!root || root.__fmn) return;
  root.__fmn = 1;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var items = (C.items || []).filter(function (it) { return it && it.src; });
  var stage = root.querySelector('.fmn-stage');
  var cv = root.querySelector('canvas');
  var ctx = cv.getContext('2d');
  var uid = root.id;

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
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    var n = m ? parseInt(m[1], 16) : 0x6FA8FF;
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  var lineC = hexRgb(C.lineColor || '#6FA8FF');
  // Lys (hvit) eller ingen bakgrunn: «lighter»-glød forsvinner mot hvitt, så da tegnes nettverket vanlig
  // og litt kraftigere. NET=false skjuler linjer og punkter helt (bare telefonene).
  var LIGHT = C.bg === 'white' || C.bg === 'none';
  var NET = C.net !== false;
  var BLEND = LIGHT ? 'source-over' : 'lighter';
  var LA = LIGHT ? 1.7 : 1;

  // Glød-sprite for nodene
  var glow = document.createElement('canvas'); glow.width = glow.height = 64;
  (function () {
    var g = glow.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (LIGHT) { gr.addColorStop(0, rgba(lineC, 0.9)); gr.addColorStop(0.18, rgba(lineC, 0.5)); gr.addColorStop(0.45, rgba(lineC, 0.12)); gr.addColorStop(1, rgba(lineC, 0)); }
    else { gr.addColorStop(0, rgba([235, 245, 255], 0.95)); gr.addColorStop(0.2, rgba(lineC, 0.45)); gr.addColorStop(1, rgba(lineC, 0)); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  })();

  var idleT = 0;
  var W = 0, H = 0, dpr = 1, phones = [], nodes = [], edges = [];
  var introStart = -1, introEnd = 0, done = false, visible = false, raf = 0;
  // Dra i nettverket: forskyvning med dybde (foran flytter mest), treghet og fjær tilbake
  var off = { x: 0, y: 0 }, vel = { x: 0, y: 0 }, down = null, dragging = false, suppressClick = false, lastT = 0;
  var DEPTH = [0.35, 0.65, 1];
  // Karusell (3D): telefonene står i en ring rundt leseren og snurrer når man drar
  var RING = C.view === 'ring';
  // Side om side: 1–3 store telefoner på rad, uten lag bak (for ett eller to skjermbilder)
  var SIDE = C.view === 'side';
  var rot = 0, rotVel = 0, rotTarget = 0, STEP = 1, R = 1, Dcam = 1, h0 = 1, snapping = false;
  var lastInteract = -1e9, lastAuto = 0;

  // ---------- Layout ----------
  function layout() {
    var r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    dpr = Math.min(1.5, window.devicePixelRatio || 1); // myke glødlinjer: 1,5× holder, sparer ~45 % piksler på Retina
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (RING) { layoutRing(); paint(performance.now()); return; }
    var rand = rng(C.seed || 3);
    var narrow = W < 560;
    var big = C.size || 1;   // størrelse på telefonene foran (Studio-skyveknapp)
    // Antall per lag: få og store foran
    var nFront = clamp(Math.round(C.front || (narrow ? 2 : 3)), 1, 6);
    if (narrow) nFront = Math.min(nFront, 2);
    var nMid = clamp(Math.round(C.mid == null ? 4 : C.mid), 0, 10);
    var nBack = clamp(Math.round(C.back == null ? 10 : C.back), 0, 24);
    if (narrow) { nMid = Math.min(nMid, 3); nBack = Math.min(nBack, 6); }
    var hFront = Math.min(H * 0.62 * big, W / nFront * 0.95 / 0.47);
    var gap = 0;
    if (SIDE) {
      nFront = clamp(Math.round(C.count || Math.min(Math.max(items.length, 1), 3)), 1, 3);
      nMid = 0; nBack = 0;
      gap = Math.min(W, H) * 0.06;
      hFront = Math.min(H * 0.72 * big, ((W * 0.92 - gap * (nFront - 1)) / nFront) / 0.47);
    }
    var specs = [];
    var i;
    for (i = 0; i < nBack; i++) specs.push({ L: 0, h: hFront * (0.36 + rand() * 0.08) });
    for (i = 0; i < nMid; i++) specs.push({ L: 1, h: hFront * (0.55 + rand() * 0.08) });
    for (i = 0; i < nFront; i++) specs.push({ L: 2, h: SIDE ? hFront : hFront * (0.96 + rand() * 0.08), slot: i });
    // Plassering: forreste lag jevnt over bredden, resten spredt med minsteavstand
    var placed = [];
    specs.forEach(function (s) {
      var w = s.h * 0.47, x, y, tries = 0, best = null, bestD = -1;
      if (SIDE) {
        var rowW = nFront * w + (nFront - 1) * gap;
        x = (W - rowW) / 2 + s.slot * (w + gap) + w / 2;
        y = H * 0.46;
      } else if (s.L === 2) {
        var slotW = W / nFront;
        x = slotW * (s.slot + 0.5) + (rand() - 0.5) * slotW * 0.18;
        y = H * 0.5 + (rand() - 0.5) * H * 0.12 + (s.slot % 2 ? 1 : -1) * H * 0.04;
      } else {
        while (tries++ < 40) {
          var cx = -w * 0.2 + rand() * (W + w * 0.4), cy = -s.h * 0.15 + rand() * (H + s.h * 0.3);
          var dmin = 1e9;
          placed.forEach(function (p) {
            if (p.L !== s.L) return;
            var dx = (p.x - cx) / W, dy = (p.y - cy) / H; dmin = Math.min(dmin, dx * dx + dy * dy);
          });
          if (dmin > bestD) { bestD = dmin; best = [cx, cy]; }
        }
        x = best[0]; y = best[1];
      }
      placed.push({ L: s.L, x: x, y: y, h: s.h, w: w });
    });
    // Skjermbilder: foran først, så midten, så bak (gjentas hvis det er færre bilder enn telefoner)
    var order = placed.slice().sort(function (a, b) { return b.L - a.L; });
    order.forEach(function (p, k) { p.item = items.length ? k % items.length : -1; });
    // Bygg DOM (gjenbruk ved resize)
    stage.innerHTML = '';
    phones = placed.map(function (p, k) {
      var el = document.createElement(p.item >= 0 && p.L > 0 ? 'button' : 'div');
      el.className = 'fmn-ph fmn-L' + p.L;
      if (el.tagName === 'BUTTON') {
        el.type = 'button';
        var it = items[p.item];
        el.setAttribute('aria-label', 'Vis skjermbilde' + (it.caption ? ': ' + it.caption : ''));
        (function (idx, elx) { elx.addEventListener('click', function () { if (suppressClick) return; openBox(idx, elx); }); })(p.item, el);
      } else el.setAttribute('aria-hidden', 'true');
      el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
      el.style.left = (p.x - p.w / 2) + 'px'; el.style.top = (p.y - p.h / 2) + 'px';
      el.style.zIndex = String(p.L * 100 + k);
      var scr = '<span class="fmn-scr">' + (p.item >= 0 ? '<img alt="" draggable="false" loading="' + (p.L === 0 ? 'lazy' : 'eager') + '" decoding="async" src="' + items[p.item].src.replace(/"/g, '&quot;') + '">' : '') + '<i class="fmn-isl"></i></span>';
      el.innerHTML = scr;
      stage.appendChild(el);
      p.el = el;
      p.ph = rand() * 6.28; p.ph2 = rand() * 6.28; p.w1 = 0.00022 + rand() * 0.00018; p.w2 = 0.00018 + rand() * 0.00018;
      // Intro: bakerst først, forreste lag sist
      p.t = (p.L === 0 ? 0 : p.L === 1 ? 350 : 700) + rand() * 500;
      return p;
    });
    // Nettverk: noder i telefonene (midt/bak) + ekstra punkter, kanter til nærmeste naboer
    nodes = [];
    phones.forEach(function (p) { nodes.push({ p: p, x: p.x, y: p.y, t: p.t + 150 }); });
    var extra = Math.round((W * H) / (narrow ? 9000 : 14000));
    for (i = 0; i < extra; i++) nodes.push({ x: rand() * W, y: rand() * H, t: 200 + rand() * 1200, ph: rand() * 6.28 });
    edges = [];
    var seen = {};
    nodes.forEach(function (n, a) {
      var near = [];
      nodes.forEach(function (m, b) { if (a !== b) near.push([(m.x - n.x) * (m.x - n.x) + (m.y - n.y) * (m.y - n.y), b]); });
      near.sort(function (u, v) { return u[0] - v[0]; });
      for (var q = 0; q < 3 && q < near.length; q++) {
        var b = near[q][1], key = a < b ? a + '-' + b : b + '-' + a;
        if (seen[key]) continue; seen[key] = 1;
        edges.push({ a: n, b: nodes[b], t: Math.max(n.t, nodes[b].t), ph: rand() * 6.28 });
      }
    });
    introEnd = 0;
    phones.forEach(function (p) { introEnd = Math.max(introEnd, p.t + 900); });
    edges.forEach(function (e) { introEnd = Math.max(introEnd, e.t + 700); });
    paint(performance.now());
  }


  // ---------- Karusell (3D-ring) ----------
  function makePhone(item, front) {
    var el = document.createElement(item >= 0 ? 'button' : 'div');
    if (item >= 0) {
      el.type = 'button';
      el.setAttribute('aria-label', 'Vis skjermbilde' + (items[item].caption ? ': ' + items[item].caption : ''));
    } else el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="fmn-scr">' + (item >= 0 ? '<img alt="" draggable="false" decoding="async" src="' + items[item].src.replace(/"/g, '&quot;') + '">' : '') + '<i class="fmn-isl"></i></span>';
    return el;
  }
  function layoutRing() {
    var rand = rng(C.seed || 3), narrow = W < 560;
    var N = clamp(Math.round(C.ring || (narrow ? 7 : 9)), 4, 16);
    STEP = Math.PI * 2 / N;
    R = W * (narrow ? 0.6 : 0.4); Dcam = R * 2.7;
    var fr = Dcam / (Dcam - R);
    h0 = Math.min(H * 0.64 * (C.size || 1), W * (narrow ? 0.6 : 0.34) / 0.47) / fr;
    var w0 = h0 * 0.47, i;
    stage.innerHTML = '';
    stage.style.perspective = Math.round(W * 1.8) + 'px';
    // Pilknapper: for dem som ikke oppdager at man kan dra
    if (!root.querySelector('.fmn-arr') && C.arrows !== false) {
      ['prev', 'next'].forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'fmn-arr fmn-arr-' + d;
        b.setAttribute('aria-label', d === 'prev' ? 'Forrige mobil' : 'Neste mobil');
        b.innerHTML = d === 'prev' ? '‹' : '›';
        b.addEventListener('click', function (e) {
          e.stopPropagation(); lastInteract = performance.now();
          rotTarget = Math.round(rot / STEP) * STEP + (d === 'prev' ? STEP : -STEP); rotVel = 0; snapping = true; kick();
        });
        root.appendChild(b);
      });
    }
    phones = [];
    for (i = 0; i < N; i++) {
      var p = { L: 2, a: i * STEP, y: (i % 2 ? 1 : -1) * H * 0.02 + (rand() - 0.5) * H * 0.03, item: items.length ? i % items.length : -1, t: 150 + i * 70 };
      var el = makePhone(p.item);
      el.className = 'fmn-ph fmn-ring';
      el.style.width = w0 + 'px'; el.style.height = h0 + 'px';
      el.style.left = (W / 2 - w0 / 2) + 'px'; el.style.top = (H / 2 - h0 / 2) + 'px';
      (function (pp) {
        el.addEventListener('click', function () {
          if (suppressClick) return;
          lastInteract = performance.now();
          if (pp.front && pp.item >= 0) { openBox(pp.item, pp.el); return; }
          // Trykk på en telefon på siden: snurr den fram
          var d = Math.atan2(Math.sin(-pp.a - rot), Math.cos(-pp.a - rot));
          rotTarget = rot + d; rotVel = 0; snapping = true; kick();
        });
      })(p);
      stage.appendChild(el);
      p.el = el;
      phones.push(p);
    }
    // Nettverk i 3D: noder i telefonene + punkter på en større sylinder rundt
    nodes = phones.map(function (p) { return { p: p, t: p.t + 200 }; });
    var extra = narrow ? 30 : 46;
    for (i = 0; i < extra; i++) nodes.push({ a: rand() * Math.PI * 2, r: R * (1.15 + rand() * 0.6), y: (rand() - 0.5) * H * 0.95, t: 250 + rand() * 1200, ph: rand() * 6.28 });
    function p3(n) { var a = n.p ? n.p.a : n.a, r = n.p ? R : n.r, y = n.p ? n.p.y : n.y; return [r * Math.sin(a), y, r * Math.cos(a)]; }
    edges = []; var seen = {};
    function addE(a, b) { var key = a < b ? a + '-' + b : b + '-' + a; if (seen[key] || a === b) return; seen[key] = 1; edges.push({ a: nodes[a], b: nodes[b], t: Math.max(nodes[a].t, nodes[b].t), ph: rand() * 6.28 }); }
    for (i = 0; i < N; i++) addE(i, (i + 1) % N);
    nodes.forEach(function (n, a) {
      var pa = p3(n), near = [];
      nodes.forEach(function (m, b) { if (b < N && a < N) return; var pb = p3(m); near.push([(pa[0] - pb[0]) * (pa[0] - pb[0]) + (pa[1] - pb[1]) * (pa[1] - pb[1]) + (pa[2] - pb[2]) * (pa[2] - pb[2]), b]); });
      near.sort(function (u, v) { return u[0] - v[0]; });
      for (var q = 0; q < 2 && q < near.length; q++) addE(a, near[q][1]);
    });
    introEnd = 0;
    phones.forEach(function (p) { introEnd = Math.max(introEnd, p.t + 1100); });
    edges.forEach(function (e) { introEnd = Math.max(introEnd, e.t + 700); });
  }
  function proj(a, r, y) {
    var th = a + rot, x = r * Math.sin(th), z = r * Math.cos(th), s = Dcam / (Dcam - z);
    return { x: W / 2 + x * s, y: H / 2 + (y + (z - R) * 0.08) * s, s: s, k: (Math.cos(th) + 1) / 2, th: Math.atan2(Math.sin(th), Math.cos(th)) };
  }
  function paintRing(now) {
    var t = done ? 1e9 : (introStart < 0 ? -1 : now - introStart);
    phones.forEach(function (p) {
      var q = t < 0 ? 0 : easeOut((t - p.t) / 900);
      var pr = proj(p.a, R, p.y), k = pr.k;
      p.sx = pr.x; p.sy = pr.y; p.k = k;
      var ry = clamp(-pr.th * 180 / Math.PI * 0.55, -55, 55);
      p.el.style.transform = 'translate(' + (pr.x - W / 2).toFixed(1) + 'px,' + (pr.y - H / 2 + (1 - q) * 30).toFixed(1) + 'px) scale(' + (pr.s * (0.9 + 0.1 * q)).toFixed(3) + ') rotateY(' + ry.toFixed(1) + 'deg)';
      p.el.style.opacity = String(q * (0.2 + 0.8 * Math.pow(k, 1.4)));
      p.el.style.zIndex = String(Math.round(k * 1000));
      p.el.style.filter = k < 0.55 ? 'blur(' + ((0.55 - k) * 5).toFixed(1) + 'px)' + (LIGHT ? '' : ' brightness(' + (0.45 + k).toFixed(2) + ')') : '';
      var front = Math.abs(pr.th) < STEP / 2;
      if (front !== p.front) { p.front = front; p.el.classList.toggle('fmn-front', front); p.el.setAttribute('tabindex', front ? '0' : '-1'); }
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (t < 0 || !NET) return;
    ctx.lineWidth = Math.max(0.7, Math.min(W, H) * 0.0016);
    function np(n) {
      if (n.p) return [n.p.sx, n.p.sy, n.p.k, 1];
      var pr = proj(n.a, n.r, n.y + (reduce || C.motion === 0 ? 0 : Math.sin(now * 0.0004 + n.ph) * H * 0.01));
      return [pr.x, pr.y, pr.k, pr.s];
    }
    edges.forEach(function (e) {
      var q = easeOut((t - e.t) / 700); if (q <= 0) return;
      var a = np(e.a), b = np(e.b), k = (a[2] + b[2]) / 2;
      ctx.strokeStyle = rgba(lineC, LA * (0.06 + 0.34 * k) * (done ? 0.8 + 0.2 * Math.sin(now * 0.0012 + e.ph) : 1));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q); ctx.stroke();
    });
    ctx.globalCompositeOperation = BLEND;
    nodes.forEach(function (n) {
      var q = easeOut((t - n.t) / 500); if (q <= 0) return;
      var pp = np(n), s = Math.min(W, H) * (n.p ? 0.03 : 0.016) * pp[3];
      ctx.globalAlpha = q * (0.15 + 0.7 * pp[2]);
      ctx.drawImage(glow, pp[0] - s, pp[1] - s, s * 2, s * 2);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function ringStep(dt, now) {
    if (dragging) return;
    if (Math.abs(rotVel) > 0.00003) {
      rot += rotVel * dt; rotVel *= Math.pow(0.93, dt / 16);
      if (Math.abs(rotVel) <= 0.00003) { rotVel = 0; rotTarget = Math.round(rot / STEP) * STEP; snapping = true; }
      return;
    }
    // Snurr sakte av seg selv når ingen holder på (ikke ved redusert bevegelse)
    var idle = now - lastInteract > 6000;
    if (done && !reduce && C.motion !== 0 && idle && now - lastAuto > (C.motion === 2 ? 2600 : 4200)) {
      lastAuto = now; rotTarget = Math.round(rot / STEP) * STEP - STEP; snapping = true;
    }
    if (snapping) {
      var f = 1 - Math.pow(done ? 0.88 : 0.955, dt / 16);
      rot += (rotTarget - rot) * f;
      if (Math.abs(rotTarget - rot) < 0.0005) { rot = rotTarget; snapping = false; }
    }
  }

  function pos(p, now) {
    var k = DEPTH[p.L], ox = off.x * k, oy = off.y * k;
    if (reduce || C.motion === 0) return [ox, oy];
    var amp = Math.min(W, H) * (C.motion === 2 ? 0.016 : 0.008) * (p.L === 2 ? 0.7 : 1);
    return [ox + Math.sin(now * p.w1 + p.ph) * amp, oy + Math.cos(now * p.w2 + p.ph2) * amp * 1.4];
  }

  // ---------- Tegning ----------
  function paint(now) {
    if (RING) return paintRing(now);
    var t = done ? 1e9 : (introStart < 0 ? -1 : now - introStart);
    // Telefoner
    phones.forEach(function (p) {
      var q = t < 0 ? 0 : easeOut((t - p.t) / 900);
      var d = pos(p, now);
      p.dx = d[0]; p.dy = d[1];
      p.el.style.opacity = String(q * (p.L === 0 ? 0.55 : p.L === 1 ? 0.85 : 1));
      var tilt = clamp(vel.x * 9 * DEPTH[p.L], -7, 7);
      p.el.style.transform = 'translate(' + d[0].toFixed(1) + 'px,' + (d[1] + (1 - q) * 24).toFixed(1) + 'px) scale(' + (0.94 + 0.06 * q).toFixed(3) + ') rotate(' + tilt.toFixed(2) + 'deg)';
    });
    // Nettverk
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (t < 0 || !NET) return;
    var lw = Math.max(0.7, Math.min(W, H) * 0.0016);
    ctx.lineWidth = lw;
    function np(n) {
      if (n.p) return [n.x + (n.p.dx || 0), n.y + (n.p.dy || 0)];
      var ox = off.x * 0.5, oy = off.y * 0.5;
      if (reduce || C.motion === 0) return [n.x + ox, n.y + oy];
      var a = Math.min(W, H) * 0.006;
      return [n.x + ox + Math.sin(now * 0.0003 + n.ph) * a, n.y + oy + Math.cos(now * 0.00026 + n.ph) * a];
    }
    edges.forEach(function (e) {
      var q = easeOut((t - e.t) / 700); if (q <= 0) return;
      var a = np(e.a), b = np(e.b);
      var flick = done ? 0.75 + 0.25 * Math.sin(now * 0.0012 + e.ph) : 1;
      ctx.strokeStyle = rgba(lineC, LA * 0.33 * flick);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q); ctx.stroke();
    });
    ctx.globalCompositeOperation = BLEND;
    nodes.forEach(function (n) {
      var q = easeOut((t - n.t) / 500); if (q <= 0) return;
      var pp = np(n), tw = done ? Math.pow(Math.max(0, Math.sin(now * 0.0011 + (n.ph || n.x))), 4) : 0;
      var s = Math.min(W, H) * (n.p ? 0.028 : 0.018) * (1 + tw * 0.6);
      ctx.globalAlpha = q * (0.5 + tw * 0.5);
      ctx.drawImage(glow, pp[0] - s, pp[1] - s, s * 2, s * 2);
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function settling() {
    if (RING) return dragging || snapping || Math.abs(rotVel) > 0.00003;
    return dragging || Math.abs(off.x) + Math.abs(off.y) > 0.3 || Math.abs(vel.x) + Math.abs(vel.y) > 0.01;
  }
  function frame(now) {
    raf = 0;
    var dt = Math.min(48, lastT ? now - lastT : 16); lastT = now;
    if (!done && introStart >= 0 && now - introStart > introEnd) done = true;
    if (RING) ringStep(dt, now);
    else if (!dragging) {
      // treghet + fjær tilbake til hvilestilling
      off.x += vel.x * dt; off.y += vel.y * dt;
      var damp = Math.pow(0.9, dt / 16), spring = 1 - Math.pow(0.93, dt / 16);
      vel.x *= damp; vel.y *= damp;
      off.x -= off.x * spring; off.y -= off.y * spring;
      if (!settling()) { off.x = off.y = vel.x = vel.y = 0; }
    }
    paint(now);
    var anim = settling() || (introStart >= 0 && (!done || (!reduce && C.motion !== 0)));
    if (!anim || !visible) return;
    // Rolig svev på tomgang trenger ikke 60–120 bilder i sekundet: ~30 fps sparer CPU/GPU (og vifta).
    // Dra, snurring og intro går i full fart.
    var busy = settling() || !done || (RING && Math.abs(rot - rotTarget) > 0.0005);
    if (busy) raf = requestAnimationFrame(frame);
    else idleT = setTimeout(function () { idleT = 0; raf = requestAnimationFrame(frame); }, 28);
  }
  function kick() {
    if (idleT) { clearTimeout(idleT); idleT = 0; }
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }
  function start() {
    introStart = performance.now(); done = false;
    if (RING && !reduce) { rot = STEP * 3; rotTarget = 0; snapping = true; }
    kick();
  }
  function finish() { done = true; introStart = 0; paint(performance.now()); kick(); }
  root.__fmnPlay = function () { visible = true; start(); };

  // ---------- Lysboks ----------
  var box = null, cur = 0, lastFocus = null;
  function openBox(idx, fromEl) {
    lastFocus = fromEl || document.activeElement;
    if (!box) {
      box = document.createElement('div');
      box.className = 'fmn-lb fmn-lb-' + uid;
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Skjermbilde');
      box.innerHTML = '<div class="fmn-bx-in"><div class="fmn-bx-ph"><div class="fmn-bx-scr"><img alt=""></div><i class="fmn-isl"></i></div>' +
        '<p class="fmn-bx-cap"></p></div>' +
        '<button type="button" class="fmn-bx-x" aria-label="Lukk">×</button>' +
        (items.length > 1 ? '<button type="button" class="fmn-bx-nav fmn-bx-prev" aria-label="Forrige">‹</button><button type="button" class="fmn-bx-nav fmn-bx-next" aria-label="Neste">›</button><span class="fmn-bx-cnt"></span>' : '');
      document.body.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target === box || e.target.className === 'fmn-bx-in') closeBox(); });
      box.querySelector('.fmn-bx-x').addEventListener('click', closeBox);
      if (items.length > 1) {
        box.querySelector('.fmn-bx-prev').addEventListener('click', function () { show(cur - 1); });
        box.querySelector('.fmn-bx-next').addEventListener('click', function () { show(cur + 1); });
      }
      var sx = null;
      box.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (sx == null || items.length < 2) return;
        var dx = e.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
      }, { passive: true });
    }
    show(idx);
    box.classList.add('is-open');
    document.addEventListener('keydown', onKey);
    var x = box.querySelector('.fmn-bx-x'); if (x) x.focus();
  }
  function show(i) {
    cur = (i + items.length) % items.length;
    var it = items[cur];
    var img = box.querySelector('.fmn-bx-scr img');
    img.src = it.src; img.alt = it.alt || it.caption || 'Skjermbilde';
    box.querySelector('.fmn-bx-scr').scrollTop = 0;
    var cap = box.querySelector('.fmn-bx-cap'); cap.textContent = it.caption || ''; cap.style.display = it.caption ? '' : 'none';
    var cnt = box.querySelector('.fmn-bx-cnt'); if (cnt) cnt.textContent = (cur + 1) + ' / ' + items.length;
    var ph = box.querySelector('.fmn-bx-ph');
    ph.classList.remove('fmn-pop'); void ph.offsetWidth; ph.classList.add('fmn-pop');
  }
  function closeBox() {
    if (!box) return;
    box.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') closeBox();
    else if (e.key === 'ArrowRight') show(cur + 1);
    else if (e.key === 'ArrowLeft') show(cur - 1);
  }

  // ---------- Dra ----------
  if (C.drag !== false && window.PointerEvent) {
    root.style.touchAction = 'pan-y';   // vertikal scroll i artikkelen virker fortsatt på mobil
    root.style.cursor = 'grab';
    var maxX = function () { return W * 0.28; }, maxY = function () { return H * 0.22; };
    var resist = function (o, m) { return 1 / (1 + Math.abs(o) / m * 2.2); };
    root.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), id: e.pointerId };
      vel.x = vel.y = 0;
    });
    root.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.id) return;
      if (!dragging) {
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 7) return;
        dragging = true; root.style.cursor = 'grabbing';
        try { root.setPointerCapture(e.pointerId); } catch (er) {}
        if (introStart < 0) { visible = true; finish(); }
      }
      var now = performance.now(), dtm = Math.max(1, now - down.t);
      var dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      if (RING) {
        var kk = STEP / (W * 0.24);
        rot += dx * kk; rotVel = rotVel * 0.5 + (dx / dtm) * kk * 0.5; snapping = false;
        lastInteract = now;
      } else {
        off.x += dx * resist(off.x, maxX()); off.y += dy * resist(off.y, maxY());
        vel.x = vel.x * 0.5 + (dx / dtm) * 0.5; vel.y = vel.y * 0.5 + (dy / dtm) * 0.5;
      }
      down.lx = e.clientX; down.ly = e.clientY; down.t = now;
      kick();
    });
    var endDrag = function (e) {
      if (!down || (e && e.pointerId !== down.id)) return;
      if (dragging) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 0); }
      down = null; dragging = false; root.style.cursor = 'grab'; lastT = 0;
      if (RING) {
        lastInteract = performance.now();
        rotVel = clamp(rotVel, -0.01, 0.01);
        if (Math.abs(rotVel) <= 0.00003) { rotVel = 0; rotTarget = Math.round(rot / STEP) * STEP; snapping = true; }
      }
      if (Math.abs(vel.x) > 2 || Math.abs(vel.y) > 2) { vel.x = clamp(vel.x, -2, 2); vel.y = clamp(vel.y, -2, 2); }
      kick();
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
  }

  if (RING) {
    root.addEventListener('keydown', function (e) {
      if (box && box.classList.contains('is-open')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); lastInteract = performance.now();
      rotTarget = Math.round(rot / STEP) * STEP + (e.key === 'ArrowLeft' ? STEP : -STEP); snapping = true; kick();
      setTimeout(function () { phones.forEach(function (p) { if (p.front && p.el.focus) p.el.focus(); }); }, 450);
    });
  }

  // ---------- Oppstart ----------
  layout();
  if ('ResizeObserver' in window) {
    var rw = 0;
    new ResizeObserver(function () {
      var w = root.getBoundingClientRect().width;
      if (Math.abs(w - rw) < 1) return;
      rw = w; layout(); kick();
    }).observe(root);
  }
  var trig = C.trigger || 'middle';
  if (!('IntersectionObserver' in window)) { visible = true; finish(); return; }
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) kick(); }).observe(root);
  if (reduce || trig === 'static' || root.hasAttribute('data-static')) { finish(); return; }
  var started = false;
  new IntersectionObserver(function (es) {
    var e = es[0], ok = e.isIntersecting;
    if (ok && trig === 'full') { var b = e.boundingClientRect; ok = b.bottom <= window.innerHeight + 1 || b.top <= window.innerHeight * 0.15; }
    if (ok && !started) { started = true; visible = true; start(); }
  }, { rootMargin: trig === 'early' ? '0px 0px -10% 0px' : trig === 'middle' ? '0px 0px -30% 0px' : '0px', threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(root);
}
