// Faktisk Studio · Kontokart · nettverksklode
// Stor klode med Europa i fokus: adminland → grupper, innlegg langs buene, klikkbare kontoer og land.
// Ved valg dreier og zoomer kloden så alle stedene får plass (nære steder → inn, store avstander → hele kloden).
// Samme data som verdenskartet (kkKartCfg). Kjøres direkte i forhåndsvisningen og via toString() i embedden.
function kkNettklode(root, CFG, DOTS) {

  if (!root || root.__n) return; root.__n = 1;
  var map = root.querySelector('.fkn-map'), cv = map.querySelector('canvas'), ctx = cv.getContext('2d');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var D2R = Math.PI / 180;
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', MAPC = {};
  for (var b = 0; b < 64; b++) MAPC[B64.charAt(b)] = b;
  var N = Math.floor(DOTS.length / 4), DX = new Float32Array(N), DY = new Float32Array(N), DZ = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var o = i * 4, la = ((MAPC[DOTS.charAt(o)] << 6 | MAPC[DOTS.charAt(o + 1)]) - 600) / 10 * D2R, lo = ((MAPC[DOTS.charAt(o + 2)] << 6 | MAPC[DOTS.charAt(o + 3)]) - 1800) / 10 * D2R;
    DX[i] = Math.cos(la) * Math.cos(lo); DY[i] = Math.cos(la) * Math.sin(lo); DZ[i] = Math.sin(la);
  }
  function V(la, lo) { la *= D2R; lo *= D2R; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; }
  // Adminland, grupper og kontoer – bygget i Studio (samme oppsett som verdenskartet).
  // ACC: [navn, [adminland], [grupper], eksempeltekst]
  var C = CFG.C, G = CFG.G, ACC = CFG.ACC, MAIN = CFG.main;
  ACC.forEach(function (a) { if (!a[2] || !a[2].length) a[2] = [MAIN]; });
  Object.keys(C).forEach(function (k) { C[k].acc = 0; C[k].v = V(C[k].lat, C[k].lon); });
  Object.keys(G).forEach(function (k) { G[k].v = V(G[k].lat, G[k].lon); });
  ACC.forEach(function (a) { a[1].forEach(function (k) { if (C[k]) C[k].acc++; }); });

  function pill(cls, html) { var el = document.createElement('span'); el.className = 'fkn-pill ' + cls; el.innerHTML = html; map.appendChild(el); return el; }
  Object.keys(C).forEach(function (k) { C[k].el = pill('', C[k].n + '<i>' + C[k].acc + '</i>'); });
  Object.keys(G).forEach(function (k) { G[k].el = pill(G[k].main ? 'fkn-pill--no' : 'fkn-pill--grp', G[k].n); });

  // Kontoliste
  var focusC = null;   // valgt land (klikk på kloden)
  var list = root.querySelector('.fkn-acc'), sel = -1, hov = -1, hint = root.querySelector('.fkn-hint'), hint0 = hint ? hint.textContent : '';
  ACC.forEach(function (a, idx) {
    var bt = document.createElement('button'); bt.type = 'button';
    bt.className = 'fkn-chip' + (a[1].length ? '' : ' fkn-chip--na') + (a[3] ? ' fkn-chip--ex' : '');
    bt.textContent = a[0];
    if (a[3]) { var tg = document.createElement('em'); tg.textContent = 'eksempel'; bt.appendChild(tg); }
    a.where = a[1].length ? a[1].map(function (k) { return C[k].n; }).join(' · ') : 'ingen kjent adminlokasjon';
    bt.setAttribute('aria-label', a[0] + ': ' + (a[3] || 'administratorer: ' + a.where)); bt.setAttribute('aria-pressed', 'false');
    bt.addEventListener('click', function () { sel = sel === idx ? -1 : idx; focusC = null; sync(); aim(); });
    bt.addEventListener('mouseenter', function () { if (matchMedia('(hover:hover)').matches) { hov = idx; sync(); } });
    bt.addEventListener('mouseleave', function () { hov = -1; sync(); });
    list.appendChild(bt); a.el = bt;
  });
  function cur() { var k = hov >= 0 ? hov : sel; return k >= 0 ? ACC[k] : null; }
  function sync() {
    ACC.forEach(function (a, k) {
      a.el.classList.toggle('is-on', k === sel); a.el.setAttribute('aria-pressed', k === sel ? 'true' : 'false');
      a.el.classList.toggle('is-rel', !!focusC && sel < 0 && a[1].indexOf(focusC) >= 0);
    });
    var a = cur(); posts.length = 0; nextAt = {};
    if (!hint) return;
    if (a) { hint.innerHTML = '<span><b></b></span>'; hint.firstChild.firstChild.textContent = a[0] + ':'; hint.firstChild.appendChild(document.createTextNode(a[3] || ('Administratorer: ' + a.where))); return; }
    if (focusC) { var c = C[focusC]; hint.innerHTML = '<span><b></b></span>'; hint.firstChild.firstChild.textContent = c.n + ':'; hint.firstChild.appendChild(document.createTextNode(c.acc + (c.acc === 1 ? ' konto har' : ' kontoer har') + ' administratorer her. Kontoene er markert under.')); return; }
    hint.textContent = hint0;
  }
  function routes() {
    var a = cur(), out = [];
    if (!a && focusC) {
      var ds = {}; ds[MAIN] = 1;
      ACC.forEach(function (x) { if (x[1].indexOf(focusC) >= 0) x[2].forEach(function (d) { ds[d] = 1; }); });
      Object.keys(ds).forEach(function (d) { out.push({ s: focusC, d: d, w: d === MAIN ? C[focusC].acc : 3 }); });
      return out;
    }
    if (!a) { Object.keys(C).forEach(function (k) { out.push({ s: k, d: MAIN, w: C[k].acc }); }); return out; }
    a[1].forEach(function (s) { a[2].forEach(function (d) { out.push({ s: s, d: d, w: 3 }); }); });
    return out;
  }

  // ---------- Klode ----------
  var W = 0, H = 0, DPR = 1, R = 0, CX = 0, CY = 0;
  var HOME = CFG.home ? { lon: CFG.home[0], lat: CFG.home[1] } : { lon: 28, lat: 40 }, lon = HOME.lon, lat = HOME.lat, cL, sL, cP, sP;
  var goal = null, drag = null, vLon = 0, vLat = 0, idleAt = -1e9, tt = 0;
  var R0 = 0, CY0 = 0, CYc = 0, zoom = 1, zGoal = 1, cyF = 0, cyGoal = 0;   // zoom: 1 = Europa-utsnittet
  function setRot() { cL = Math.cos(lon * D2R); sL = Math.sin(lon * D2R); cP = Math.cos(lat * D2R); sP = Math.sin(lat * D2R); }
  function proj(v) {
    var X1 = v[0] * cL + v[1] * sL, Y1 = -v[0] * sL + v[1] * cL, d = X1 * cP + v[2] * sP, up = -X1 * sP + v[2] * cP;
    return [CX + R * Y1, CY - R * up, d, Y1 * Y1 + up * up];
  }
  function vis(p) { return p[2] > 0 || p[3] > 1; }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  // Valgt konto: drei kloden så stedene havner på forsiden (gjennomsnittet av punktene)
  // Fokus (konto eller land): drei til midtpunktet og zoom så alle stedene får plass.
  // Nære steder → zoom inn. Store avstander (f.eks. USA–Australia) → zoom ut til hele kloden.
  function aim() {
    var a = cur(), pts = [];
    if (a) pts = a[1].map(function (k) { return C[k].v; }).concat(a[2].map(function (k) { return G[k].v; }));
    else if (focusC) routes().forEach(function (r, i) { if (!i) pts.push(C[r.s].v); pts.push(G[r.d].v); });
    idleAt = now();
    if (pts.length < 2) { goal = { lon: HOME.lon, lat: HOME.lat }; zGoal = 1; cyGoal = 0; kick(); return; }
    var s = [0, 0, 0]; pts.forEach(function (v) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; });
    var n = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]) || 1; s = [s[0] / n, s[1] / n, s[2] / n];
    // Midtpunktet som minimerer største avstand (så f.eks. USA og Australia begge kommer på forsiden)
    function ang(v) { return Math.acos(Math.max(-1, Math.min(1, v[0] * s[0] + v[1] * s[1] + v[2] * s[2]))); }
    for (var it = 0, st = 0.5; it < 120; it++, st *= 0.96) {
      var far = pts[0], fa = -1; pts.forEach(function (v) { var q = ang(v); if (q > fa) { fa = q; far = v; } });
      s = [s[0] + (far[0] - s[0]) * st * 0.3, s[1] + (far[1] - s[1]) * st * 0.3, s[2] + (far[2] - s[2]) * st * 0.3];
      n = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]) || 1; s = [s[0] / n, s[1] / n, s[2] / n];
    }
    var th = 0; pts.forEach(function (v) { th = Math.max(th, ang(v)); });
    th = Math.min(th + 12 * D2R, 88 * D2R);
    var fit = Math.min(W * 0.42, CYc * 0.86 - 34) / Math.sin(th);   // luft til piller i kanten
    zGoal = Math.max(0.4, Math.min(1.7, fit / R0)); cyGoal = 1;
    goal = { lon: Math.atan2(s[1], s[0]) / D2R, lat: Math.max(-30, Math.min(65, Math.asin(s[2]) / D2R)) };
    kick();
  }
  function resize() {
    var r = map.getBoundingClientRect(); W = r.width; H = r.height; if (!W || !H) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    var narrow = W < 520;
    R0 = narrow ? W * 0.7 : Math.min(W * 0.58, H * 1.0);   // stor klode – Europa og Norge zoomet inn, sidene beskjæres
    CY0 = H * 0.64;                                 // Europa i øvre halvdel, over tekst og knapper
    CYc = H * 0.47;                                 // midt i feltet over tekst og knapper (ved fokus)
    CX = W * 0.5; applyZoom();                 // toppen av kloden like under pillen for norske grupper
    Object.keys(C).concat(Object.keys(G)).forEach(function (k) { var o = C[k] || G[k]; o.w = o.el.offsetWidth; o.h = o.el.offsetHeight; o.el.textContent = ''; });
    Object.keys(C).forEach(function (k) { C[k].el.innerHTML = C[k].n + '<i>' + C[k].acc + '</i>'; C[k].w = C[k].el.offsetWidth; C[k].h = C[k].el.offsetHeight; });
    Object.keys(G).forEach(function (k) { G[k].el.textContent = narrow ? G[k].s : G[k].n; G[k].w = G[k].el.offsetWidth; G[k].h = G[k].el.offsetHeight; });
    draw(now());
  }
  function applyZoom() { R = R0 * zoom; CY = CY0 * (1 - cyF) + CYc * cyF; }
  function slerp(A, B, om, f) { var s = Math.sin(om) || 1, k1 = Math.sin((1 - f) * om) / s, k2 = Math.sin(f * om) / s; return [A[0] * k1 + B[0] * k2, A[1] * k1 + B[1] * k2, A[2] * k1 + B[2] * k2]; }
  function arcPts(A, B) {
    var dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])), om = Math.acos(dot), steps = Math.max(12, Math.round(om * 40)), lift = 0.04 + om * 0.13, out = [];
    for (var s = 0; s <= steps; s++) { var f = s / steps, v = slerp(A, B, om, f), h = 1 + lift * Math.sin(Math.PI * f); out.push(proj([v[0] * h, v[1] * h, v[2] * h])); }
    return out;
  }
  function place(el, x, y, w, h, side, gap) {
    var px = x, py = y;
    if (side === 'r') { px = x + gap; py = y - h / 2; } else if (side === 'l') { px = x - gap - w; py = y - h / 2; }
    else if (side === 't') { px = x - w / 2; py = y - gap - h; } else { px = x - w / 2; py = y + gap; }
    px = Math.max(4, Math.min(W - w - 4, px)); py = Math.max(4, Math.min(H - h - 4, py));
    el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    el.__box = [px, py];
  }
  var posts = [], nextAt = {};
  function draw(t) {
    if (!W) return;
    setRot();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    var g = ctx.createRadialGradient(CX - R * .3, CY - R * .45, R * .05, CX, CY, R);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#DCE6FF');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, R, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,80,252,.16)'; ctx.lineWidth = 1; ctx.stroke();
    var bk = [[], [], [], []], sz = Math.max(1.4, Math.min(R / 200, 2.8));
    for (var i = 0; i < N; i++) {
      var X = DX[i], Y = DY[i], Z = DZ[i], X1 = X * cL + Y * sL, d = X1 * cP + Z * sP;
      if (d <= 0.03) continue;
      var Y1 = -X * sL + Y * cL, up = -X1 * sP + Z * cP, sx = CX + R * Y1, sy = CY - R * up;
      if (sx < -4 || sy < -4 || sx > W + 4 || sy > H + 4) continue;
      bk[d > .6 ? 3 : d > .35 ? 2 : d > .15 ? 1 : 0].push(sx, sy, d);
    }
    var al = [.16, .28, .44, .62];
    for (var q = 0; q < 4; q++) {
      ctx.fillStyle = 'rgba(0,80,252,' + al[q] + ')'; ctx.beginPath(); var Bq = bk[q];
      for (var j = 0; j < Bq.length; j += 3) { var s2 = sz * (0.55 + 0.45 * Bq[j + 2]); ctx.rect(Bq[j] - s2 / 2, Bq[j + 1] - s2 / 2, s2, s2); }
      ctx.fill();
    }
    var a = cur(), RT = routes(), srcOn = {}, dstOn = {};
    RT.forEach(function (r) { srcOn[r.s] = 1; dstOn[r.d] = 1; });
    // Buer (deler bak kloden skjules)
    ctx.lineCap = 'round';
    RT.forEach(function (r) {
      var P = arcPts(C[r.s].v, G[r.d].v); r.P = P;
      ctx.strokeStyle = 'rgba(0,80,252,' + (a ? .8 : .42) + ')'; ctx.lineWidth = a ? 2 : 0.9 + r.w * 0.2;
      ctx.beginPath(); var pen = false;
      for (var m = 0; m < P.length; m++) { if (vis(P[m])) { if (pen) ctx.lineTo(P[m][0], P[m][1]); else ctx.moveTo(P[m][0], P[m][1]); pen = true; } else pen = false; }
      ctx.stroke();
    });
    // Innlegg langs buene
    for (var p = posts.length - 1; p >= 0; p--) {
      var Q = posts[p], f = (t - Q.t0) / Q.dur;
      if (f >= 1 || !RT[Q.r]) { posts.splice(p, 1); continue; }
      if (f < 0) continue;
      var e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2, PP = RT[Q.r].P, idx = Math.min(PP.length - 1, Math.round(e * (PP.length - 1))), pt = PP[idx];
      if (!vis(pt)) continue;
      var alp = Math.min(1, f * 6, (1 - f) * 6);
      ctx.fillStyle = 'rgba(255,255,255,' + alp.toFixed(3) + ')'; ctx.strokeStyle = 'rgba(0,80,252,' + alp.toFixed(3) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(pt[0] - 5, pt[1] - 4, 10, 8, 2); else ctx.rect(pt[0] - 5, pt[1] - 4, 10, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(0,80,252,' + (alp * .8).toFixed(3) + ')'; ctx.fillRect(pt[0] - 3, pt[1] - 1.5, 6, 1.2); ctx.fillRect(pt[0] - 3, pt[1] + .8, 4, 1.2);
    }
    // Adminland
    Object.keys(C).forEach(function (k) {
      var c = C[k], pp = proj(c.v), front = pp[2] > 0.04, on = !!srcOn[k], r = 3 + Math.sqrt(c.acc) * 2.2;
      if (front) {
        ctx.fillStyle = 'rgba(0,80,252,' + (on ? .16 : .05) + ')'; ctx.beginPath(); ctx.arc(pp[0], pp[1], r + 5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(0,80,252,' + (on ? 1 : .25) + ')'; ctx.beginPath(); ctx.arc(pp[0], pp[1], r, 0, 7); ctx.fill();
      }
      var vo = front ? Math.min(1, (pp[2] - 0.04) / 0.2) : 0;
      c.el.style.opacity = (vo * (on ? 1 : (a ? 0 : .4))).toFixed(2);
      c.box = c.el.__box; if (vo > 0) place(c.el, pp[0], pp[1], c.w, c.h, pp[0] < CX - R * 0.15 ? 'l' : pp[0] > CX + R * 0.15 ? 'r' : (pp[1] > CY - R * 0.5 ? 'b' : 'r'), 12);
    });
    // Grupper
    var pul = reduce ? 0 : (t % 2400) / 2400;
    Object.keys(G).forEach(function (k) {
      var gg = G[k], pp = proj(gg.v), front = pp[2] > 0.04, on = !!dstOn[k], x = pp[0], y = pp[1];
      var vo = front ? Math.min(1, (pp[2] - 0.04) / 0.2) : 0;
      if (gg.main) {
        var gap = Math.max(30, H * 0.12);
        if (front) {
          ctx.strokeStyle = 'rgba(0,80,252,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - gap); ctx.stroke();
          ctx.strokeStyle = 'rgba(229,38,42,' + (.55 * (1 - pul)).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9 + pul * 16, 0, 7); ctx.stroke();
          ctx.fillStyle = 'rgba(229,38,42,.18)'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill();
          ctx.fillStyle = '#E5262A'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.stroke();
        }
        gg.el.style.opacity = vo.toFixed(2);
        if (vo > 0) place(gg.el, x, y, gg.w, gg.h, 't', gap);
        return;
      }
      if (front) {
        if (on) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0050FC'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill(); ctx.stroke();
        } else {
          ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,80,252,.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      gg.el.style.opacity = on ? vo.toFixed(2) : '0';
      if (on && vo > 0) place(gg.el, x, y, gg.w, gg.h, k === 'DK' ? 'l' : k === 'AU' ? 'b' : 'r', 14);
    });
  }
  // Dra for å snurre; slipp med fart. Loddrett sveip på mobil scroller siden.
  map.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId }; vLon = vLat = 0; goal = null; try { map.setPointerCapture(e.pointerId); } catch (er) {} map.classList.add('is-drag'); kick(); });
  map.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var k = 90 / Math.max(80, R), dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    vLon = -dx * k; vLat = dy * k; lon += vLon; lat = Math.max(-40, Math.min(70, lat + vLat)); if (reduce) draw(now());
  });
  function end(e) {
    if (!drag) return;
    var moved = Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6;
    drag = null; idleAt = now(); map.classList.remove('is-drag');
    if (!moved) tap(e);
    kick();
  }
  // Klikk på et land (prikk eller pille) → fokus på landet. Klikk utenfor → tilbake til oversikten.
  function tap(e) {
    var r = map.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = null, best = 26;
    Object.keys(C).forEach(function (k) {
      var c = C[k], pp = proj(c.v); if (pp[2] <= 0.04) return;
      var d = Math.hypot(pp[0] - x, pp[1] - y); if (d < best) { best = d; hit = k; }
      if (c.box && x >= c.box[0] && x <= c.box[0] + c.w && y >= c.box[1] && y <= c.box[1] + c.h && +c.el.style.opacity > 0.3) { hit = k; best = 0; }
    });
    sel = -1; focusC = hit && hit !== focusC ? hit : null;
    vLon = vLat = 0; sync(); aim();
  }
  map.addEventListener('pointerup', end); map.addEventListener('pointercancel', end);
  var raf = 0, visible = true, last = 0;
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0; if (!visible) return;
    var dt = last ? Math.min(80, t - last) : 16; last = t;
    if (!drag) {
      lon += vLon; lat = Math.max(-40, Math.min(70, lat + vLat)); vLon *= .94; vLat *= .94;
      if (Math.abs(vLon) < .01) vLon = 0; if (Math.abs(vLat) < .01) vLat = 0;
      if (goal && !vLon && !vLat) {
        var dl = ((goal.lon - lon + 540) % 360) - 180, kk = reduce ? 1 : 0.06;
        lon += dl * kk; lat += (goal.lat - lat) * kk;
        if (Math.abs(dl) < .05 && Math.abs(goal.lat - lat) < .05) goal = null;
      } else if (!goal && !reduce && t - idleAt > 4000 && !cur() && !focusC) {
        tt += dt; var tl = HOME.lon + 22 * Math.sin(tt / 30000);     // svak, langsom vugging rundt Europa
        lon += (tl - lon) * 0.02; lat += (HOME.lat - lat) * 0.02;
      }
    }
    var zd = zGoal - zoom, cd = cyGoal - cyF;
    if (reduce) { zoom = zGoal; cyF = cyGoal; } else { zoom += zd * 0.06; cyF += cd * 0.06; }
    if (Math.abs(zd) < .002) zoom = zGoal; if (Math.abs(cd) < .002) cyF = cyGoal;
    applyZoom();
    var RT = routes(), a = cur();
    if (!reduce) RT.forEach(function (r, idx) {
      if (!(t < nextAt[idx])) { posts.push({ r: idx, t0: t, dur: 3800 + Math.random() * 1600 }); nextAt[idx] = t + (a ? 2600 : 9000 / Math.max(1, r.w)) * (0.7 + Math.random() * 0.6); }
    });
    draw(t);
    if (!reduce || drag || vLon || vLat || goal || zoom !== zGoal || cyF !== cyGoal) raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  resize();
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; last = 0; if (visible) kick(); }).observe(map);
  else kick();
}
