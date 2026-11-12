// Prikkeklode · motor (kopieres inn i embedden via toString() — ES5, ingen avhengigheter)
//
// fpkRun(root, C, DOTS)
//   root: embeddens rot-element (id-scopet), med .fpk-stage, canvas, .fpk-card, .fpk-list, .fpk-reset, .fpk-hint
//   C.cardMode: 'auto' (standard: inne fra 900 px, ellers spretter ut), 'inside', 'pop' eller 'page'
//   C:    { bg, home:{lon,lat}, zoom, places:[{id,name,lat,lon,role,color,lab}], items:[…], factsTitle,
//           pulses, motion, trigger, list }
//   DOTS: landprikker, 4 tegn per prikk (se dots.js)
function fpkRun(root, C, DOTS) {
  if (!root || root.__fpk) return;
  root.__fpk = 1;
  var D2R = Math.PI / 180;
  var LIGHT = C.bg === 'white' || C.bg === 'none';
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var stage = root.querySelector('.fpk-stage');
  var cv = root.querySelector('canvas');
  var ctx = cv.getContext('2d');
  var card = root.querySelector('.fpk-card');
  // Hvor kortet åpnes (C.cardMode):
  //   inside — i grafikken · pop — spretter ut over grafikken med skygge, siden dekkes ikke ·
  //   page — over hele siden med mørk bakgrunn · auto (standard) — inside fra 900 px, ellers pop.
  // I pop og page flyttes kortet (samme node) til et overlegg i <body>, så det kan gå utenfor rammen.
  var cardHome = card.parentNode, ov = null, ovMode = false, lastFocus = null;
  function wantOverlay() {
    var m = C.cardMode || 'auto';
    if (m === 'page' || m === 'pop') return m;
    if (m === 'inside') return false;
    return W > 0 && W < 900 ? 'pop' : false;
  }
  function placeCard() {
    var want = wantOverlay();
    if (want === ovMode) return;
    if (sel >= 0) close();
    ovMode = want;
    if (want) {
      if (!ov) {
        ov = document.createElement('div');
        var bd = document.createElement('div'); bd.className = 'fpk-ov__bd';
        bd.addEventListener('click', function () { close(); });
        ov.appendChild(bd);
        ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      }
      ov.className = 'fpk-ov fpk-ov-' + root.id + ' fpk-ov--' + want;
      ov.appendChild(card);
      if (!ov.parentNode) document.body.appendChild(ov);
    } else {
      card.style.left = card.style.top = '';
      cardHome.appendChild(card);
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }
  }
  // «Spretter ut»: kortet sentreres over grafikken (kan gå utenfor kantene) og midt i skjermbildet,
  // i dokumentets koordinater — det blir liggende der når leseren scroller.
  function positionPop() {
    if (ovMode !== 'pop' || sel < 0) return;
    var de = document.documentElement, vw = de.clientWidth || window.innerWidth, vh = window.innerHeight;
    var sx = window.pageXOffset || de.scrollLeft || 0, sy = window.pageYOffset || de.scrollTop || 0;
    var r = root.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    // Skjermbildene laster etter at kortet er plassert — regn med full høyde når kortet har bilder,
    // ellers vokser det ned under skjermkanten
    if (card.querySelector('img')) h = Math.max(h, Math.min(vh * 0.86, 800));
    var left = r.left + r.width / 2 - w / 2;
    left = Math.max(16, Math.min(vw - 16 - w, left));
    var top = Math.max(16, (vh - h) / 2);
    top = Math.max(top, Math.min(r.top, vh - 16 - h));      // ikke over grafikkens øvre kant hvis det er plass
    card.style.left = Math.round(left + sx) + 'px';
    card.style.top = Math.round(top + sy) + 'px';
  }
  function outsidePop(e) {
    if (ovMode !== 'pop' || sel < 0) return;
    var n = e.target;
    while (n) { if (n === card || n === root) return; n = n.parentNode; }
    close();
  }
  document.addEventListener('pointerdown', outsidePop, true);
  var list = root.querySelector('.fpk-list');
  var hint = root.querySelector('.fpk-hint');
  var resetBtn = root.querySelector('.fpk-reset');
  var FONT = (window.getComputedStyle ? getComputedStyle(root).fontFamily : '') || 'Helvetica, Arial, sans-serif';
  var ICON = {
    side: 'M5 3h2v18H5zM8 4h11l-2.5 4L19 12H8z',
    profil: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z'
  };
  var ICONINK = LIGHT ? '#FFFFFF' : '#07153A';
  var INK = LIGHT ? '#0B1B3F' : '#FFFFFF';
  var HOME = { lon: +(C.home && C.home.lon) || 20, lat: +(C.home && C.home.lat) || 45 };

  // ---------- Prikker ----------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', MAP = {};
  for (var b = 0; b < 64; b++) MAP[B64.charAt(b)] = b;
  var NDOT = Math.floor((DOTS || '').length / 4);
  var DX = new Float32Array(NDOT), DY = new Float32Array(NDOT), DZ = new Float32Array(NDOT);
  for (var i = 0; i < NDOT; i++) {
    var o = i * 4;
    var la = ((MAP[DOTS.charAt(o)] << 6 | MAP[DOTS.charAt(o + 1)]) - 600) / 10 * D2R;
    var lo = ((MAP[DOTS.charAt(o + 2)] << 6 | MAP[DOTS.charAt(o + 3)]) - 1800) / 10 * D2R;
    DX[i] = Math.cos(la) * Math.cos(lo); DY[i] = Math.cos(la) * Math.sin(lo); DZ[i] = Math.sin(la);
  }

  function vec(lat, lon) { var a = lat * D2R, b = lon * D2R; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; }
  function hexA(h, a) {
    h = String(h || '#888888').replace('#', ''); if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16) || 0; return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ease(x) { return x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }

  // ---------- Steder og buer ----------
  var PL = {};
  (C.places || []).forEach(function (p) { if (p && p.id && isFinite(p.lat) && isFinite(p.lon)) PL[p.id] = p; });
  var items = (C.items || []).filter(function (it) { return it && PL[it.from] && PL[it.to] && it.from !== it.to; });
  function col(it) { return PL[it.from].color || '#FF8A3D'; }
  var perFrom = {};
  items.forEach(function (it, idx) {
    var s = PL[it.from], t = PL[it.to];
    var k = perFrom[it.from] = (perFrom[it.from] || 0) + 1;
    var a = vec(s.lat, s.lon), b2 = vec(t.lat, t.lon);
    var om = Math.acos(Math.max(-1, Math.min(1, a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2]))), so = Math.sin(om) || 1e-6;
    var lift = it.lift > 0 ? +it.lift : Math.min(0.06 + om * 0.3, 0.3) + (k - 1) * 0.07;
    var pts = [];
    for (var j = 0; j <= 64; j++) {
      var f = j / 64, w1 = Math.sin((1 - f) * om) / so, w2 = Math.sin(f * om) / so, h = 1 + lift * Math.sin(Math.PI * f);
      pts.push([(a[0] * w1 + b2[0] * w2) * h, (a[1] * w1 + b2[1] * w2) * h, (a[2] * w1 + b2[2] * w2) * h]);
    }
    it._i = idx; it._pts = pts; it._delay = idx * 260; it._pulse = (idx * 0.37) % 1;
    it._mark = it.mark > 0 && it.mark < 1 ? +it.mark : 0.5 + (k % 2 ? -0.06 : 0.06);
  });
  var LAB = { r: [11, 1, 'left'], l: [-11, 1, 'right'], a: [0, -15, 'center'], b: [0, 18, 'center'] };

  // ---------- Tilstand ----------
  var W = 0, H = 0, R = 0, CX = 0, CY = 0, DPR = 1;
  var lon = HOME.lon, lat = HOME.lat, vLon = 0, vLat = 0;
  var dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = 0, lastInput = -1e9;
  var sel = -1, hot = -1, introAt = -1, introDone = false, running = false, visible = false, raf = 0, timer = 0, marks = [];
  var cL, sL, cP, sP;

  function resize() {
    var r = stage.getBoundingClientRect(); W = r.width; H = r.height;
    if (!W || !H) return;
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    var narrow = W < 560, z = Math.max(0.6, Math.min(3, +C.zoom || 1));
    R = Math.min(W, H) * (narrow ? 0.40 : 0.43) * z * (narrow && z > 1.2 ? 0.85 : 1);
    CX = W * 0.5; CY = H * (z > 1.2 ? (narrow ? 0.56 : 0.58) : 0.55);
    placeCard();
    positionPop();
    draw(now());
  }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function setRot() { cL = Math.cos(lon * D2R); sL = Math.sin(lon * D2R); cP = Math.cos(lat * D2R); sP = Math.sin(lat * D2R); }
  function proj(X, Y, Z) {
    var X1 = X * cL + Y * sL, Y1 = -X * sL + Y * cL;
    var d = X1 * cP + Z * sP, up = -X1 * sP + Z * cP;
    return [CX + R * Y1, CY - R * up, d, Y1 * Y1 + up * up];
  }
  function seen(p) { return p[2] > 0 || p[3] > 1; }

  var glow = document.createElement('canvas'); glow.width = glow.height = 64;
  (function () {
    var g = glow.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  })();

  // ---------- Tegning ----------
  function draw(t) {
    if (!W) return;
    setRot();
    var it0 = introDone ? 1e9 : introAt < 0 ? -1 : t - introAt;
    var gIn = it0 < 0 ? 0 : ease(it0 / 900);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!gIn) return;
    ctx.globalAlpha = gIn;
    var keepR = R; R = R * (0.92 + 0.08 * gIn);

    // Kule
    if (LIGHT) {
      var sl = ctx.createRadialGradient(CX - R * .35, CY - R * .4, R * .1, CX, CY, R);
      sl.addColorStop(0, '#FFFFFF'); sl.addColorStop(1, '#EDF2FA');
      ctx.fillStyle = sl; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(30,60,120,.14)'; ctx.lineWidth = 1; ctx.stroke();
    } else {
      var atm = ctx.createRadialGradient(CX, CY, R * 0.9, CX, CY, R * 1.25);
      atm.addColorStop(0, 'rgba(90,140,255,.22)'); atm.addColorStop(1, 'rgba(90,140,255,0)');
      ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(CX, CY, R * 1.25, 0, 7); ctx.fill();
      var sp = ctx.createRadialGradient(CX - R * .35, CY - R * .4, R * .1, CX, CY, R);
      sp.addColorStop(0, '#16336F'); sp.addColorStop(1, '#0A1C4C');
      ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
    }

    // Prikker i fire lysstyrker
    var bk = [[], [], [], []], sz = Math.max(1.1, Math.min(R / 210, 3.2));
    for (var i = 0; i < NDOT; i++) {
      var X = DX[i], Y = DY[i], Z = DZ[i];
      var X1 = X * cL + Y * sL, d = X1 * cP + Z * sP;
      if (d <= 0.02) continue;
      var Y1 = -X * sL + Y * cL, up = -X1 * sP + Z * cP;
      var sx = CX + R * Y1, sy = CY - R * up;
      if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
      bk[d > .6 ? 3 : d > .35 ? 2 : d > .15 ? 1 : 0].push(sx, sy, d);
    }
    var al = LIGHT ? [.14, .24, .38, .56] : [.22, .38, .58, .85], rgb = LIGHT ? '30,60,120' : '150,185,255';
    for (var q = 0; q < 4; q++) {
      ctx.fillStyle = 'rgba(' + rgb + ',' + al[q] + ')'; ctx.beginPath(); var Bq = bk[q];
      for (var j = 0; j < Bq.length; j += 3) { var s2 = sz * (0.55 + 0.45 * Bq[j + 2]); ctx.rect(Bq[j] - s2 / 2, Bq[j + 1] - s2 / 2, s2, s2); }
      ctx.fill();
    }

    // Buer og pulser
    marks = []; var later = [];
    ctx.lineCap = 'round';
    items.forEach(function (it) {
      var prog = reduce ? 1 : ease((it0 - 700 - it._delay) / 1300);
      if (prog <= 0) return;
      var c = col(it), dim = sel >= 0 && sel !== it._i;
      var n = Math.round(64 * prog), P = [];
      for (var k = 0; k <= 64; k++) P.push(proj(it._pts[k][0], it._pts[k][1], it._pts[k][2]));
      ctx.strokeStyle = hexA(c, dim ? (LIGHT ? .14 : .18) : (sel === it._i ? 1 : .8));
      ctx.lineWidth = sel === it._i ? 2.6 : 1.7;
      ctx.beginPath(); var pen = false;
      for (k = 0; k <= n; k++) {
        var p = P[k];
        if (seen(p)) { if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } } else pen = false;
      }
      ctx.stroke();
      if (prog >= 1 && !reduce && !dim && C.pulses !== false) {
        for (var u = 0; u < 2; u++) {
          var f = ((t / 3200) + it._pulse + u * .5) % 1, pp = P[Math.floor(f * 64)];
          if (!seen(pp)) continue;
          var gs = 16 + 6 * Math.sin(f * Math.PI);
          if (LIGHT) {
            ctx.fillStyle = hexA(c, .18); ctx.beginPath(); ctx.arc(pp[0], pp[1], gs * .42, 0, 7); ctx.fill();
            ctx.fillStyle = c; ctx.beginPath(); ctx.arc(pp[0], pp[1], 3.2, 0, 7); ctx.fill();
          } else {
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .9 * gIn;
            ctx.drawImage(glow, pp[0] - gs / 2, pp[1] - gs / 2, gs, gs);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = gIn;
          }
        }
      }
      var mp = P[Math.round(it._mark * 64)];
      var pop = reduce ? 1 : ease((it0 - 1700 - it._delay) / 400);
      if (pop > 0 && seen(mp)) later.push([it, mp, pop, dim, c]);
    });

    // Steder og navn
    ctx.font = '600 ' + Math.round(Math.max(11, Math.min(R / 22, 16))) + 'px ' + FONT; ctx.textBaseline = 'middle';
    Object.keys(PL).forEach(function (id) {
      var s = PL[id], v = vec(s.lat, s.lon), p = proj(v[0], v[1], v[2]);
      if (p[2] <= 0) return;
      var src = s.role === 'source', c = src ? (s.color || '#FF8A3D') : INK;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p[0], p[1], src ? 4 : 3.2, 0, 7); ctx.fill();
      ctx.strokeStyle = hexA(c, .5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], src ? 8 : 6.5, 0, 7); ctx.stroke();
      if (C.labels === false || !s.name) return;
      var L = LAB[s.lab] || (src ? LAB.r : LAB.l);
      ctx.textAlign = L[2]; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeStyle = LIGHT ? 'rgba(255,255,255,.92)' : 'rgba(7,21,58,.8)';
      ctx.strokeText(s.name, p[0] + L[0], p[1] + L[1]);
      ctx.fillStyle = LIGHT ? '#0B1B3F' : 'rgba(234,241,255,.95)';
      ctx.fillText(s.name, p[0] + L[0], p[1] + L[1]);
    });

    // Klikkbare ikoner øverst
    later.forEach(function (m) {
      var it = m[0], mp = m[1], pop = m[2], dim = m[3], c = m[4];
      var r = Math.max(11, Math.min(R / 20, 15)) * (it._i === hot || it._i === sel ? 1.18 : 1) * (0.6 + 0.4 * pop);
      ctx.globalAlpha = (dim ? .35 : 1) * gIn * pop;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mp[0], mp[1], r, 0, 7); ctx.fill();
      ctx.strokeStyle = LIGHT ? '#FFFFFF' : '#07153A'; ctx.lineWidth = 2; ctx.stroke();
      if (it._i === sel) { ctx.strokeStyle = LIGHT ? c : '#FFFFFF'; ctx.beginPath(); ctx.arc(mp[0], mp[1], r + 4, 0, 7); ctx.stroke(); }
      if (window.Path2D) {
        ctx.save(); ctx.translate(mp[0] - r * .55, mp[1] - r * .55); ctx.scale(r * 1.1 / 24, r * 1.1 / 24);
        ctx.fillStyle = ICONINK; ctx.fill(new Path2D(ICON[it.type] || ICON.side)); ctx.restore();
      }
      ctx.globalAlpha = gIn;
      marks.push({ i: it._i, x: mp[0], y: mp[1], r: r });
    });
    R = keepR;
    ctx.globalAlpha = 1;
  }

  // ---------- Løkke ----------
  function frame(t) {
    raf = 0;
    if (!running) return;
    var idle = t - lastInput > 5000 && !dragging && sel < 0;
    if (!dragging) {
      lon += vLon; lat += vLat; vLon *= .93; vLat *= .93;
      if (Math.abs(vLon) < .002) vLon = 0; if (Math.abs(vLat) < .002) vLat = 0;
      if (idle && !reduce && C.motion !== 0) {
        lon += (HOME.lon + 8 * Math.sin(t / 4000) - lon) * .02; lat += (HOME.lat - lat) * .02;
      }
    }
    lat = Math.max(-60, Math.min(80, lat));
    draw(t);
    if (resetBtn) resetBtn.classList.toggle('is-on', Math.abs(lon - HOME.lon) > 20 || Math.abs(lat - HOME.lat) > 15);
    var alive = !reduce && (C.pulses !== false || C.motion !== 0);   // pulser eller vugging = løpende bevegelse
    var busy = dragging || vLon || vLat || (!introDone && introAt >= 0 && t - introAt < 4500);
    if (busy) raf = requestAnimationFrame(frame);
    else if (alive) timer = setTimeout(function () { raf = requestAnimationFrame(frame); }, 33);   // ~30 fps i ro
    // ellers: står stille til neste kick() (dra, klikk, størrelse)
  }
  function kick() { clearTimeout(timer); if (running && visible && !raf) raf = requestAnimationFrame(frame); }
  function start() { if (!running) { running = true; } if (introAt < 0) introAt = now(); kick(); }
  function stop() { clearTimeout(timer); if (raf) cancelAnimationFrame(raf); raf = 0; }
  function finish() { introDone = true; running = true; draw(now()); kick(); }

  // ---------- Kort ----------
  function avatar(it) {
    return '<span class="fpk-av" style="background:' + esc(col(it)) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="' + ICONINK + '" d="' + (ICON[it.type] || ICON.side) + '"/></svg></span>';
  }
  function open(i) {
    var it = items[i]; if (!it) return;
    var s = PL[it.from], t = PL[it.to];
    sel = i;
    var shots = (it.shots || []).filter(Boolean);
    var body = shots.length
      ? '<div class="fpk-card__shots">' + shots.map(function (u, n) { return '<img src="' + esc(u) + '" alt="Skjermbilde ' + (n + 1) + ' av ' + shots.length + '" loading="lazy">'; }).join('') + '</div>'
      : (it.text ? '<div class="fpk-card__text">' + esc(it.text) + '</div>' : '');
    var facts = (it.facts || []).filter(Boolean);
    card.innerHTML =
      '<div class="fpk-card__top">' + avatar(it) +
        '<div><div class="fpk-card__name">' + esc(it.name || '') + '</div>' +
        (it.meta ? '<div class="fpk-card__meta">' + esc(it.meta) + '</div>' : '') + '</div>' +
        '<button class="fpk-card__x" type="button" aria-label="Lukk">✕</button></div>' + body +
      '<div class="fpk-card__facts">' + (C.factsTitle ? '<b>' + esc(C.factsTitle) + '</b>' : '') +
        (it.warn ? '<div class="fpk-warn">⚠ ' + esc(it.warn) + '</div>' : '') +
        '<div>Styres fra ' + esc(s.name) + ' · rettet mot ' + esc(t.name) + '</div>' +
        facts.map(function (f) { return '<div>' + esc(f) + '</div>'; }).join('') + '</div>';
    card.classList.add('is-open'); card.scrollTop = 0;
    var xb = card.querySelector('.fpk-card__x');
    xb.addEventListener('click', close);
    if (ovMode && ov) {
      positionPop();
      ov.classList.add('is-open');
      if (!lastFocus) lastFocus = document.activeElement;
      setTimeout(function () { try { xb.focus({ preventScroll: true }); } catch (er) {} }, 60);   // etter at overlegget er synlig
    }
    if (list) [].forEach.call(list.children, function (bt, k) { bt.classList.toggle('is-sel', k === i); bt.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
    if (hint) hint.classList.add('is-off');
    kick();
  }
  function close() {
    if (sel < 0) return; sel = -1; card.classList.remove('is-open');
    if (ovMode && ov) {
      ov.classList.remove('is-open');
      if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (er) {} }
      lastFocus = null;
    }
    if (list) [].forEach.call(list.children, function (bt) { bt.classList.remove('is-sel'); bt.setAttribute('aria-pressed', 'false'); });
    kick();
  }

  // ---------- Interaksjon ----------
  function pick(x, y) {
    for (var i = marks.length - 1; i >= 0; i--) {
      var m = marks[i], dx = x - m.x, dy = y - m.y;
      if (dx * dx + dy * dy <= (m.r + 8) * (m.r + 8)) return m.i;
    }
    return -1;
  }
  function local(e) { var r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function inUi(e) { var n = e.target; while (n && n !== stage) { if (n.classList && (n.classList.contains('fpk-card') || n.classList.contains('fpk-reset'))) return true; n = n.parentNode; } return false; }
  function glide(tl, ta, ms) {
    var fl = lon, fa = lat, t0 = now();
    ta = Math.max(-55, Math.min(75, ta));
    (function go() {
      var f = ease((now() - t0) / ms);
      lon = fl + (tl - fl) * f; lat = fa + (ta - fa) * f; vLon = vLat = 0; lastInput = now();
      draw(now()); if (f < 1) requestAnimationFrame(go); else kick();
    })();
  }

  stage.addEventListener('pointerdown', function (e) {
    if (inUi(e)) return;
    dragging = true; moved = 0; var p = local(e); lastX = downX = p[0]; lastY = downY = p[1]; vLon = vLat = 0;
    lastInput = now(); stage.classList.add('is-drag');
    try { stage.setPointerCapture(e.pointerId); } catch (er) {}
    kick();
  });
  stage.addEventListener('pointermove', function (e) {
    var p = local(e);
    if (dragging) {
      var dx = p[0] - lastX, dy = p[1] - lastY; lastX = p[0]; lastY = p[1];
      moved = Math.max(moved, Math.abs(p[0] - downX) + Math.abs(p[1] - downY));
      var k = 57.3 / Math.max(R, 1) * 0.9;
      vLon = -dx * k; vLat = e.pointerType === 'mouse' ? dy * k : 0;
      lon += vLon; lat += vLat; lastInput = now();
      if (moved > 6 && hint) hint.classList.add('is-off');
      kick();
    } else if (e.pointerType === 'mouse') {
      var h = pick(p[0], p[1]);
      if (h !== hot) { hot = h; stage.classList.toggle('is-hot', h >= 0); kick(); }
    }
  });
  stage.addEventListener('pointerup', function (e) {
    if (!dragging) return; dragging = false; stage.classList.remove('is-drag');
    if (moved < 6) { var p = local(e), h = pick(p[0], p[1]); if (h >= 0) open(h); else close(); vLon = vLat = 0; }
    lastInput = now(); kick();
  });
  stage.addEventListener('pointercancel', function () { dragging = false; stage.classList.remove('is-drag'); kick(); });
  stage.addEventListener('pointerleave', function () { if (hot >= 0) { hot = -1; stage.classList.remove('is-hot'); kick(); } });
  if (resetBtn) resetBtn.addEventListener('click', function () { close(); glide(HOME.lon, HOME.lat, 900); lastInput = now() - 5000; });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.target !== stage) return;
    if (e.key === 'ArrowLeft') vLon = 2.2; else if (e.key === 'ArrowRight') vLon = -2.2;
    else if (e.key === 'ArrowUp') vLat = -1.6; else if (e.key === 'ArrowDown') vLat = 1.6; else return;
    lastInput = now(); e.preventDefault(); kick();
  });

  // Liste under kloden (også for tastatur og skjermleser)
  if (list) {
    if (C.list === false) list.style.display = 'none';
    items.forEach(function (it, i) {
      var bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'fpk-item'; bt.setAttribute('aria-pressed', 'false');
      bt.innerHTML = avatar(it) + '<span>' + esc(it.name || '') + ' <small>' + esc(PL[it.from].name) + ' → ' + esc(PL[it.to].name) + '</small></span>';
      bt.addEventListener('click', function () {
        if (sel === i) { close(); return; }
        var m = it._pts[Math.round(it._mark * 64)], hyp = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
        var tl = Math.atan2(m[1], m[0]) / D2R, ta = Math.asin(m[2] / hyp) / D2R;
        var narrow = W < 560, zf = Math.max(1, +C.zoom || 1);
        if (ovMode) glide(tl, ta - 3, 700);   // kortet ligger utenfor grafikken — buen kan stå midt i
        else glide(tl + (narrow ? 0 : 28 / zf), ta - (narrow ? 28 / zf : 4), 700);
        open(i);
      });
      list.appendChild(bt);
    });
  }

  root.__fpkPlay = function () { visible = true; running = true; introDone = false; introAt = now(); kick(); };
  root.__fpkView = function () { return { lon: Math.round(((lon + 540) % 360 - 180) * 10) / 10, lat: Math.round(lat * 10) / 10 }; };

  // ---------- Oppstart ----------
  resize();
  if ('ResizeObserver' in window) {
    var rw = 0, rh = 0;
    new ResizeObserver(function () {
      var r = stage.getBoundingClientRect();
      if (Math.abs(r.width - rw) < 1 && Math.abs(r.height - rh) < 1) return;
      rw = r.width; rh = r.height; resize();
    }).observe(stage);
  } else window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else kick(); });
  var trig = C.trigger || 'middle';
  if (!('IntersectionObserver' in window)) { visible = true; finish(); return; }
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) kick(); else stop(); }).observe(root);
  if (reduce || trig === 'static' || root.hasAttribute('data-static')) { finish(); return; }
  var started = false;
  new IntersectionObserver(function (es) {
    var e = es[0], ok = e.isIntersecting;
    if (ok && trig === 'full') { var bb = e.boundingClientRect; ok = bb.bottom <= window.innerHeight + 1 || bb.top <= window.innerHeight * 0.15; }
    if (ok && !started) { started = true; visible = true; start(); }
  }, { rootMargin: trig === 'early' ? '0px 0px -10% 0px' : trig === 'middle' ? '0px 0px -30% 0px' : '0px', threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(root);
}
