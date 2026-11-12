function kkKart(root, CFG, DOTS) {
  if (!root || root.__n) return; root.__n = 1;
  var map = root.querySelector('.fkn-map'), cv = map.querySelector('canvas'), ctx = cv.getContext('2d');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Kartutsnitt (lengde/bredde), regnet ut i Studio ut fra stedene
  var L0 = CFG.ext[0], L1 = CFG.ext[1], T0 = CFG.ext[2], T1 = CFG.ext[3];
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', MAPC = {};
  for (var b = 0; b < 64; b++) MAPC[B64.charAt(b)] = b;
  var pts = [];
  for (var i = 0; i + 3 < DOTS.length; i += 4) {
    var la = ((MAPC[DOTS.charAt(i)] << 6 | MAPC[DOTS.charAt(i + 1)]) - 600) / 10;
    var lo = ((MAPC[DOTS.charAt(i + 2)] << 6 | MAPC[DOTS.charAt(i + 3)]) - 1800) / 10;
    if (lo < L0 || lo > L1 || la > T0 || la < T1) continue;
    // tynn ut mot polene, så kartet ikke blir tettere der (Fibonacci-gitteret er jevnt på kula)
    if (Math.random() > Math.cos(la * Math.PI / 180) * 1.15) continue;
    pts.push(lo, la);
  }
  // Steder (adminland), grupper (mål) og kontoer – bygget i Studio. ACC: [navn, [adminland], [grupper], eksempeltekst]
  var C = CFG.C, G = CFG.G, ACC = CFG.ACC, MAIN = CFG.main;
  ACC.forEach(function (a) { if (!a[2] || !a[2].length) a[2] = [MAIN]; });
  Object.keys(C).forEach(function (k) { C[k].acc = 0; });
  ACC.forEach(function (a) { a[1].forEach(function (k) { if (C[k]) C[k].acc++; }); });
  function pill(cls, html) { var el = document.createElement('span'); el.className = 'fkn-pill ' + cls; el.innerHTML = html; map.appendChild(el); return el; }
  Object.keys(C).forEach(function (k) { C[k].el = pill('', C[k].n + '<i>' + C[k].acc + '</i>'); });
  Object.keys(G).forEach(function (k) { G[k].el = pill(G[k].main ? 'fkn-pill--no' : 'fkn-pill--grp', ''); });
  // Kontoliste
  var list = root.querySelector('.fkn-acc'), sel = -1, hov = -1;
  ACC.forEach(function (a, idx) {
    var bt = document.createElement('button'); bt.type = 'button';
    bt.className = 'fkn-chip' + (a[1].length ? '' : ' fkn-chip--na') + (a[3] ? ' fkn-chip--ex' : '');
    bt.textContent = a[0];
    if (a[3]) { var tg = document.createElement('em'); tg.textContent = 'eksempel'; bt.appendChild(tg); }
    a.where = a[1].length ? a[1].map(function (k) { return C[k].n; }).join(' · ') : 'ingen kjent adminlokasjon';
    bt.setAttribute('aria-label', a[0] + ': ' + (a[3] || 'administratorer: ' + a.where));
    bt.setAttribute('aria-pressed', 'false');
    bt.addEventListener('click', function () { sel = sel === idx ? -1 : idx; sync(); draw(now()); });
    bt.addEventListener('mouseenter', function () { if (matchMedia('(hover:hover)').matches) { hov = idx; sync(); draw(now()); } });
    bt.addEventListener('mouseleave', function () { hov = -1; sync(); draw(now()); });
    list.appendChild(bt); a.el = bt;
  });
  var hint = root.querySelector('.fkn-hint'), hint0 = hint ? hint.textContent : '';
  function cur() { var k = hov >= 0 ? hov : sel; return k >= 0 ? ACC[k] : null; }
  function sync() {
    ACC.forEach(function (a, k) { a.el.classList.toggle('is-on', k === sel); a.el.setAttribute('aria-pressed', k === sel ? 'true' : 'false'); });
    var a = cur();
    if (!hint) return;
    if (!a) { hint.textContent = hint0; return; }
    hint.innerHTML = '<span><b></b></span>'; hint.firstChild.firstChild.textContent = a[0] + ':';
    hint.firstChild.appendChild(document.createTextNode(a[3] || ('Administratorer: ' + a.where)));
    posts.length = 0; nextAt = {};
  }
  // Ruter: oversikt = hvert adminland → norske grupper; valgt konto = dens adminland → dens grupper
  function routes() {
    var a = cur(), out = [];
    if (!a) { Object.keys(C).forEach(function (k) { out.push({ s: k, d: MAIN, w: C[k].acc }); }); return out; }
    a[1].forEach(function (s) { a[2].forEach(function (d) { out.push({ s: s, d: d, w: 3 }); }); });
    return out;
  }

  var W = 0, H = 0, DPR = 1;
  function X(lon) { return (lon - L0) / (L1 - L0) * W; }
  var PADT = 0.2, bottom = root.querySelector('.fkn-bottom');
  function Y(lat) { var pad = H * PADT; return pad + (T0 - lat) / (T0 - T1) * (H - pad); }   // luft over toppen
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function curve(s, d) {
    var x0 = X(s.lon), y0 = Y(s.lat), x1 = X(d.lon), y1 = Y(d.lat), dx = x1 - x0, dy = y1 - y0, dd = Math.sqrt(dx * dx + dy * dy);
    return [x0, y0, (x0 + x1) / 2, Math.min(y0, y1) - dd * 0.2, x1, y1];
  }
  function qp(c, t) { var u = 1 - t; return [u * u * c[0] + 2 * u * t * c[2] + t * t * c[4], u * u * c[1] + 2 * u * t * c[3] + t * t * c[5]]; }
  function place(el, x, y, pos, gap) {
    var w = el.offsetWidth, h = el.offsetHeight, g = gap || 12, px = x, py = y;
    if (pos === 'r') { px = x + g; py = y - h / 2; } else if (pos === 'l') { px = x - g - w; py = y - h / 2; }
    else if (pos === 't') { px = x - w / 2; py = y - g - h; } else { px = x - w / 2; py = y + g; }
    px = Math.max(4, Math.min(W - w - 4, px)); py = Math.max(4, Math.min(H - h - 4, py));
    el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
  }
  var POS = {}; Object.keys(C).forEach(function (k) { POS[k] = C[k].pos; });
  function resize() {
    var r = map.parentNode.getBoundingClientRect(); W = r.width; if (!W) return;
    // Riktige proporsjoner: like mange piksler per grad på begge akser (+ luft over toppen)
    H = Math.round(W * (T0 - T1) / (L1 - L0) / (1 - PADT)); map.style.aspectRatio = 'auto'; map.style.width = '100%'; map.style.height = H + 'px';
    // Tekst og knapper legger seg over den sørligste delen (under ca. 28° sør)
    if (bottom) bottom.style.marginTop = (-Math.round(H - Y(CFG.cut))) + 'px';
    DPR = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    if (hint) {   // reserver plass til den lengste teksten, så knappene ikke hopper
      var keep = hint.innerHTML, mx = 0; hint.style.minHeight = '';
      ACC.forEach(function (x) { if (x[3]) { hint.innerHTML = '<span><b></b></span>'; hint.firstChild.firstChild.textContent = x[0] + ':'; hint.firstChild.appendChild(document.createTextNode(x[3])); mx = Math.max(mx, hint.offsetHeight); } });
      hint.innerHTML = keep; hint.style.minHeight = mx + 'px';
    }
    Object.keys(G).forEach(function (k) { G[k].el.textContent = W < 460 ? G[k].s : G[k].n; });
    Object.keys(C).forEach(function (k) { place(C[k].el, X(C[k].lon), Y(C[k].lat), POS[k]); });
    G[MAIN].gap = Math.max(28, H * 0.15);
    Object.keys(G).forEach(function (k) { place(G[k].el, X(G[k].lon), Y(G[k].lat), G[k].pos, G[k].main ? G[MAIN].gap : 14); });
    draw(now());
  }
  var posts = [], nextAt = {};
  function draw(t) {
    if (!W) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    var sz = Math.max(1.3, Math.min(W / 420, 2.4));
    ctx.fillStyle = 'rgba(0,80,252,.26)'; ctx.beginPath();
    for (var i = 0; i < pts.length; i += 2) ctx.rect(X(pts[i]) - sz / 2, Y(pts[i + 1]) - sz / 2, sz, sz);
    ctx.fill();
    var a = cur(), R = routes(), srcOn = {}, dstOn = {};
    R.forEach(function (r) { srcOn[r.s] = 1; dstOn[r.d] = 1; });
    // Buer (svake i oversikten, sterke for valgt konto)
    R.forEach(function (r) {
      var cu = curve(C[r.s], G[r.d]); r.cu = cu;
      ctx.strokeStyle = 'rgba(0,80,252,' + (a ? .8 : .38) + ')'; ctx.lineWidth = a ? 2 : 0.8 + r.w * 0.22;
      ctx.beginPath(); ctx.moveTo(cu[0], cu[1]); ctx.quadraticCurveTo(cu[2], cu[3], cu[4], cu[5]); ctx.stroke();
    });
    // Innlegg langs rutene
    for (var p = posts.length - 1; p >= 0; p--) {
      var P = posts[p], f = (t - P.t0) / P.dur;
      if (f >= 1 || !R[P.r]) { posts.splice(p, 1); continue; }
      if (f < 0) continue;
      var e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2, q = qp(R[P.r].cu, e), al = Math.min(1, f * 6, (1 - f) * 6);
      ctx.fillStyle = 'rgba(255,255,255,' + al.toFixed(3) + ')'; ctx.strokeStyle = 'rgba(0,80,252,' + al.toFixed(3) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(q[0] - 5, q[1] - 4, 10, 8, 2); else ctx.rect(q[0] - 5, q[1] - 4, 10, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(0,80,252,' + (al * .8).toFixed(3) + ')'; ctx.fillRect(q[0] - 3, q[1] - 1.5, 6, 1.2); ctx.fillRect(q[0] - 3, q[1] + .8, 4, 1.2);
    }
    // Adminland
    Object.keys(C).forEach(function (k) {
      var c = C[k], x = X(c.lon), y = Y(c.lat), r = 3 + Math.sqrt(c.acc) * 2.2, on = !!srcOn[k];
      ctx.fillStyle = 'rgba(0,80,252,' + (on ? .16 : .05) + ')'; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(0,80,252,' + (on ? 1 : .25) + ')'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      c.el.style.opacity = on ? '1' : (a ? '0' : '.35');
    });
    // Grupper: norske alltid; de andre som stiplet ring («lignende aktivitet») til en konto som er dokumentert der velges
    var pul = reduce ? 0 : (t % 2400) / 2400;
    Object.keys(G).forEach(function (k) {
      var g = G[k], x = X(g.lon), y = Y(g.lat), on = !!dstOn[k];
      if (g.main) { ctx.strokeStyle = 'rgba(0,80,252,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - G[MAIN].gap); ctx.stroke(); }
      if (on && g.main) {   // Norge: rødt og større
        ctx.strokeStyle = 'rgba(229,38,42,' + (.55 * (1 - pul)).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9 + pul * 16, 0, 7); ctx.stroke();
        ctx.fillStyle = 'rgba(229,38,42,.18)'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill();
        ctx.fillStyle = '#E5262A'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.stroke();
      } else if (on) {
        ctx.strokeStyle = 'rgba(0,80,252,' + (.5 * (1 - pul)).toFixed(3) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6 + pul * 12, 0, 7); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0050FC'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill(); ctx.stroke();
      } else {
        ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,80,252,.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      if (!g.main) g.el.style.opacity = on ? '1' : '0';
    });
  }
  var raf = 0, visible = true;
  function frame(t) {
    raf = 0; if (!visible) return;
    var R = routes(), a = cur();
    R.forEach(function (r, idx) {
      if (!(t < nextAt[idx])) {
        posts.push({ r: idx, t0: t, dur: 3800 + Math.random() * 1600 });
        nextAt[idx] = t + (a ? 2600 : 9000 / Math.max(1, r.w)) * (0.7 + Math.random() * 0.6);   // flere kontoer = flere innlegg
      }
    });
    draw(t); raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  resize();
  if (reduce) return;
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }).observe(map);
  else raf = requestAnimationFrame(frame);
}
