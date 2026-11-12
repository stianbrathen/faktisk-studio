// Faktisk Studio · Logo-nettverk
//
// Animert toppgrafikk: en logo popper inn, og et nettverk av linjer og noder
// (med egne symboler fra Labrador, eller innebygde ikoner) vokser ut fra den
// når leseren scroller dit. Etter introen lever nettverket videre i loop:
// nodene svever rolig, pulser vandrer langs linjene og logoen «puster».
//
// Embedden er selvstendig SVG + JS. Bilder lenkes med URL fra Labrador
// (ALDRI base64). Animasjonen er ÉN funksjon (fnlRun) som kopieres inn i
// embedden via toString() — forhåndsvisningen kjører nøyaktig samme kode.
// Plassering av nodene er deterministisk (seed), så embedden blir lik
// forhåndsvisningen. Spiller bare når den er synlig; redusert bevegelse
// gir ferdig, stillestående nettverk.

const PLUGIN_ID = 'logo-nettverk';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([window.faktisk.appVersion(), window.faktisk.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

// Innebygde symboler (24×24, fylt, evenodd) — tegnes som SVG-stier, ingen filer
const ICONS = {
  phone:  { label: 'Mobil',       d: 'M7 1.5h10a2 2 0 0 1 2 2v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-17a2 2 0 0 1 2-2zM7 4.5v13.5h10V4.5zM12 19a1 1 0 1 0 0 2 1 1 0 0 0 0-2z' },
  person: { label: 'Person',      d: 'M12 12a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2zm0 2c-4.6 0-8.2 2.3-8.2 5.2V21.4h16.4v-2.2c0-2.9-3.6-5.2-8.2-5.2z' },
  chat:   { label: 'Snakkeboble', d: 'M4 3.5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.5L4.5 21.5v-4H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z' },
  globe:  { label: 'Globus',      d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 9h-3a15.5 15.5 0 0 0-1.3-5.6A8 8 0 0 1 18.9 11zM12 4.1c.9 1.2 1.8 3.5 2 6.9h-4c.2-3.4 1.1-5.7 2-6.9zM9.4 5.4A15.5 15.5 0 0 0 8.1 11h-3a8 8 0 0 1 4.3-5.6zM5.1 13h3a15.5 15.5 0 0 0 1.3 5.6A8 8 0 0 1 5.1 13zm6.9 6.9c-.9-1.2-1.8-3.5-2-6.9h4c-.2 3.4-1.1 5.7-2 6.9zm2.6-1.3a15.5 15.5 0 0 0 1.3-5.6h3a8 8 0 0 1-4.3 5.6z' },
  alert:  { label: 'Varsel',      d: 'M12 1.8 1 21.2h22zm-1.1 6.7h2.2v6.4h-2.2zm0 8.2h2.2v2.2h-2.2z' },
  video:  { label: 'Video',       d: 'M4 4.5h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zm6 3.8v7.4l6.2-3.7z' },
};

// ============================================================
//  Animasjonsmotoren — kopieres inn i embedden via toString().
//  ES5, ingen template-literals, ingen avhengigheter.
// ============================================================
function fnlRun(root, C) {
  if (!root || root.__fnl) return;
  root.__fnl = 1;
  var NS = 'http://www.w3.org/2000/svg';
  var svg = root.querySelector('svg');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var W = 0, H = 0, S = 1, nodes = [], edges = [], packets = [], hub = null;
  var gEdges, gPackets, gNodes, gLogo, logoImg, logoRing;
  var introStart = -1, introEnd = 0, introDone = false, triggered = false;
  var visible = false, raf = 0, lastSpawn = 0, motionOn = 0;
  var speed = C.speed || 1;

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  }
  function rng(seed) {
    var s = (seed % 2147483647 + 2147483647) % 2147483647 || 1;
    return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
  }
  function easeOut(x) { return x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }
  function easeBack(x) { if (x <= 0) return 0; if (x >= 1) return 1; var c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }

  function build() {
    var r = root.getBoundingClientRect();
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    S = Math.min(W, H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    nodes = []; edges = []; packets = [];
    var rand = rng(C.seed || 1);

    // Ikon-definisjoner
    var defs = el('defs', {});
    (C.symbols || []).forEach(function (s, i) {
      if (s.kind === 'icon' && s.d) el('path', { id: root.id + '-ic' + i, d: s.d, 'fill-rule': 'evenodd' }, defs);
    });

    var L = Math.max(1, Math.min(3, C.layers | 0)), N = Math.max(L * 3, C.count | 0);
    var wsum = 0, k, counts = [];
    for (k = 1; k <= L; k++) wsum += k + 0.6;
    var left = N;
    for (k = 1; k <= L; k++) {
      var c = k === L ? left : Math.max(3, Math.round(N * (k + 0.6) / wsum));
      c = Math.min(c, left - 3 * (L - k)); counts.push(c); left -= c;
    }
    var symPx = (C.symSize || 0.065) * S * (H > W * 1.05 ? 1.25 : 1);
    var cx = W / 2, cy = H / 2;
    var mx = symPx * 0.75 + 4, my = symPx * 0.75 + 4;
    var rx = (W / 2 - mx) * (C.spread || 0.9), ry = (H / 2 - my) * (C.spread || 0.9);
    hub = { x: cx, y: cy, bx: cx, by: cy, layer: 0, born: 0 };

    var symIdx = 0, nsym = (C.symbols || []).length;
    for (k = 1; k <= L; k++) {
      var cnt = counts[k - 1], off = rand() * Math.PI * 2;
      var frac = L === 1 ? 0.92 : (0.42 + 0.58 * (k - 1) / (L - 1));
      for (var i = 0; i < cnt; i++) {
        var a = off + (i / cnt) * Math.PI * 2 + (rand() - 0.5) * (Math.PI * 2 / cnt) * 0.5;
        var rr = frac * (0.88 + rand() * 0.18);
        var x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
        x = Math.max(mx, Math.min(W - mx, x)); y = Math.max(my, Math.min(H - my, y));
        var si = -1;
        if (nsym) {
          if (C.symMode === 'layer') si = (k - 1) % nsym;
          else if (C.symMode === 'cycle') si = symIdx++ % nsym;
          else si = Math.floor(rand() * nsym);
        }
        nodes.push({ bx: x, by: y, x: x, y: y, layer: k, sym: si, ang: a,
          size: symPx * (k === 1 ? 1 : k === 2 ? 0.88 : 0.76),
          f1: 0.00035 + rand() * 0.0004, f2: 0.0003 + rand() * 0.0004, p1: rand() * 6.28, p2: rand() * 6.28,
          born: Infinity, pulse: -1e9 });
      }
    }
    // Kanter: logo → lag 1, lag k → nærmeste 1–2 i lag k-1, + sidekanter (tetthet)
    function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
    nodes.forEach(function (n) {
      if (n.layer === 1) { edges.push({ a: hub, b: n, kind: 'out' }); return; }
      var prev = nodes.filter(function (m) { return m.layer === n.layer - 1; })
        .sort(function (p, q) { return dist(p, n) - dist(q, n); });
      edges.push({ a: prev[0], b: n, kind: 'out' });
      if (prev[1] && rand() < (C.density || 0)) edges.push({ a: prev[1], b: n, kind: 'out' });
    });
    for (k = 1; k <= L; k++) {
      var ring = nodes.filter(function (m) { return m.layer === k; })
        .sort(function (p, q) { return p.ang - q.ang; });
      for (var j = 0; j < ring.length; j++) {
        var nb = ring[(j + 1) % ring.length];
        if (ring.length > 2 && rand() < (C.density || 0) * 0.8) edges.push({ a: ring[j], b: nb, kind: 'side' });
      }
    }

    // Tidsplan for introen (ms, før tempo)
    var perLayer = {};
    edges.forEach(function (e) {
      if (e.kind !== 'out') return;
      var lk = e.b.layer; perLayer[lk] = (perLayer[lk] || 0) + 1;
      var idx = perLayer[lk] - 1;
      e.start = 550 + (lk - 1) * 700 + Math.min(idx * 45, 500) + rand() * 120;
      e.dur = 520 + rand() * 180;
      e.b.born = Math.min(e.b.born, e.start + e.dur);
    });
    introEnd = 0;
    edges.forEach(function (e) {
      if (e.kind === 'side') { e.start = Math.max(e.a.born, e.b.born) + 80 + rand() * 200; e.dur = 450; }
      introEnd = Math.max(introEnd, e.start + e.dur);
    });
    nodes.forEach(function (n) { introEnd = Math.max(introEnd, n.born + 450); });

    // Tegn: kanter, pakker, noder, logo (logo øverst)
    gEdges = el('g', { fill: 'none', stroke: C.lineColor, 'stroke-width': Math.max(1, S * 0.0032 * (C.lineW || 1)), 'stroke-linecap': 'round' });
    edges.forEach(function (e) { e.path = el('path', { opacity: 0 }, gEdges); });
    gPackets = el('g', {});
    gNodes = el('g', {});
    nodes.forEach(function (n, i) {
      var g = el('g', { opacity: 0 }, gNodes);
      n.g = g;
      var sz = n.size, sym = n.sym >= 0 ? C.symbols[n.sym] : null;
      n.ring = el('circle', { r: sz * 0.62, fill: 'none', stroke: C.accent, 'stroke-width': Math.max(1, S * 0.003), opacity: 0 }, g);
      if (!sym) {
        el('circle', { r: sz * 0.2, fill: C.lineColor }, g);
        el('circle', { r: sz * 0.36, fill: 'none', stroke: C.lineColor, 'stroke-opacity': 0.35, 'stroke-width': Math.max(1, S * 0.002) }, g);
        return;
      }
      if (C.nodeStyle === 'disc') el('circle', { r: sz * 0.62, fill: C.nodeColor }, g);
      if (C.nodeStyle === 'ring') el('circle', { r: sz * 0.62, fill: C.bg === 'transparent' ? 'none' : C.bg, stroke: C.lineColor, 'stroke-width': Math.max(1, S * 0.003) }, g);
      var inner = C.nodeStyle === 'bare' ? sz : sz * 0.72;
      if (sym.kind === 'icon') {
        var sc = inner / 24;
        var u = el('use', { transform: 'translate(' + (-inner / 2) + ',' + (-inner / 2) + ') scale(' + sc + ')', fill: C.symColor }, g);
        u.setAttribute('href', '#' + root.id + '-ic' + n.sym);
      } else if (sym.url) {
        var im = el('image', { x: -inner / 2, y: -inner / 2, width: inner, height: inner, preserveAspectRatio: 'xMidYMid meet' }, g);
        im.setAttribute('href', sym.url);
      }
    });
    gLogo = el('g', {});
    var lsz = (C.logoSize || 0.24) * S * (H > W * 1.05 ? 1.2 : 1);
    hub.size = lsz;
    logoRing = el('circle', { cx: cx, cy: cy, r: lsz * 0.55, fill: 'none', stroke: C.accent, 'stroke-width': Math.max(1.5, S * 0.004), opacity: 0 }, gLogo);
    if (C.logo) {
      logoImg = el('image', { x: cx - lsz / 2, y: cy - lsz / 2, width: lsz, height: lsz, preserveAspectRatio: 'xMidYMid meet' }, gLogo);
      logoImg.setAttribute('href', C.logo);
    } else {
      logoImg = el('g', {}, gLogo);
      el('circle', { cx: cx, cy: cy, r: lsz * 0.42, fill: C.lineColor }, logoImg);
      var t = el('text', { x: cx, y: cy + lsz * 0.07, 'text-anchor': 'middle', 'font-size': lsz * 0.2, 'font-family': 'Helvetica, Arial, sans-serif', 'font-weight': 700, fill: '#fff' }, logoImg);
      t.textContent = 'LOGO';
    }
    logoImg.style.transformOrigin = cx + 'px ' + cy + 'px';
    render(introDone ? 1e9 : (introStart < 0 ? -1 : performance.now() - introStart), performance.now());
  }

  function curve(e) {
    var ax = e.a.x, ay = e.a.y, bx = e.b.x, by = e.b.y;
    if (e.a === hub && hub.size) {
      // Start i kanten av logoen, så linjene ikke synes gjennom en gjennomsiktig logo
      var ddx = bx - ax, ddy = by - ay, dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1, off = Math.min(hub.size * 0.46, dl * 0.5);
      ax += ddx / dl * off; ay += ddy / dl * off;
    }
    if (C.lineShape !== 'curve') return 'M' + ax + ',' + ay + 'L' + bx + ',' + by;
    var mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
    var bend = e.kind === 'side' ? 0.18 : 0.1;
    return 'M' + ax + ',' + ay + 'Q' + (mx - dy * bend) + ',' + (my + dx * bend) + ' ' + bx + ',' + by;
  }

  // t = ms siden introstart (eller stor verdi = ferdig), now = performance.now()
  function render(t, now) {
    var ts = t * speed;
    // Bevegelse etter introen tones inn over 1,5 s
    var mAmp = reduce ? 0 : (C.motion === 2 ? 0.02 : C.motion === 1 ? 0.0095 : 0) * S;
    var mF = introDone ? Math.min(1, (now - (introStart + introEnd / speed)) / 1500) : 0;
    if (!(mF > 0)) mF = introDone ? 1 : 0;
    nodes.forEach(function (n) {
      n.x = n.bx + Math.sin(now * n.f1 + n.p1) * mAmp * mF;
      n.y = n.by + Math.cos(now * n.f2 + n.p2) * mAmp * mF;
    });
    // Logo
    var lp = t < 0 ? 0 : introDone ? 1 : easeBack(Math.min(1, ts / 650));
    logoImg.style.transform = 'scale(' + lp + ')';
    logoImg.style.opacity = t < 0 ? 0 : Math.min(1, ts / 200);
    // Kanter
    edges.forEach(function (e) {
      var p = introDone ? 1 : easeOut((ts - e.start) / e.dur);
      e.path.setAttribute('d', curve(e));
      if (p <= 0) { e.path.setAttribute('opacity', 0); return; }
      e.path.setAttribute('opacity', e.kind === 'side' ? 0.45 : 0.75);
      if (p < 1) {
        var len = e.len || (e.len = e.path.getTotalLength());
        e.path.setAttribute('stroke-dasharray', len);
        e.path.setAttribute('stroke-dashoffset', len * (1 - p));
      } else if (e.path.hasAttribute('stroke-dasharray')) {
        e.path.removeAttribute('stroke-dasharray'); e.path.removeAttribute('stroke-dashoffset');
      }
    });
    // Noder
    nodes.forEach(function (n) {
      var k = introDone ? 1e9 : ts - n.born;
      var s = k < 0 ? 0 : introDone ? 1 : easeBack(Math.min(1, k / 420));
      var pk = (now - n.pulse) / 700;
      var bump = pk >= 0 && pk < 1 ? 1 + Math.sin(pk * Math.PI) * 0.14 : 1;
      n.g.setAttribute('opacity', k < 0 ? 0 : 1);
      n.g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ') scale(' + (s * bump) + ')');
      var rp = introDone ? pk : (k >= 0 && k < 900 ? k / 900 : -1);
      if (rp >= 0 && rp < 1) {
        n.ring.setAttribute('opacity', (1 - rp) * 0.8);
        n.ring.setAttribute('r', n.size * (0.62 + rp * 0.55));
      } else n.ring.setAttribute('opacity', 0);
    });
    // Logo puster
    if (introDone && C.breath && !reduce) {
      var bp = ((now - introStart) % 3400) / 3400;
      logoRing.setAttribute('opacity', (1 - bp) * 0.55);
      logoRing.setAttribute('r', hub.size * (0.5 + bp * 0.55));
    } else logoRing.setAttribute('opacity', 0);
    // Pakker
    packets = packets.filter(function (pk) {
      var q = (now - pk.t0) / pk.dur;
      if (q >= 1) { pk.el.parentNode && pk.el.parentNode.removeChild(pk.el); if (pk.e.b.pulse !== undefined) pk.e.b.pulse = now; return false; }
      var e = pk.e, x, y;
      if (C.lineShape === 'curve') {
        var mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2, dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        var bend = e.kind === 'side' ? 0.18 : 0.1, qx = mx - dy * bend, qy = my + dx * bend, u = 1 - q;
        x = u * u * e.a.x + 2 * u * q * qx + q * q * e.b.x; y = u * u * e.a.y + 2 * u * q * qy + q * q * e.b.y;
      } else { x = e.a.x + (e.b.x - e.a.x) * q; y = e.a.y + (e.b.y - e.a.y) * q; }
      pk.el.setAttribute('cx', x); pk.el.setAttribute('cy', y);
      pk.el.setAttribute('opacity', Math.sin(q * Math.PI) * 0.95);
      return true;
    });
    if (introDone && C.packets && !reduce && C.motion > 0 && now - lastSpawn > (C.motion === 2 ? 260 : 520) && packets.length < 9) {
      lastSpawn = now;
      var outs = edges.filter(function (e) { return e.kind === 'out'; });
      var e = outs[Math.floor(Math.random() * outs.length)];
      if (e) packets.push({ e: e, t0: now, dur: (900 + Math.random() * 600) / (C.motion === 2 ? 1.4 : 1),
        el: el('circle', { r: Math.max(2, S * 0.0065), fill: C.accent, opacity: 0 }, gPackets) });
    }
  }

  function frame(now) {
    raf = 0;
    if (!visible) return;
    var t = introStart < 0 ? -1 : now - introStart;
    if (!introDone && introStart >= 0 && t * speed >= introEnd) introDone = true;
    render(introDone ? 1e9 : t, now);
    // Ingen løpende bevegelse og ferdig intro → stopp løkka (spar batteri)
    if (introDone && (reduce || (C.motion === 0 && !C.breath))) return;
    if (introStart < 0 && triggered === false) return;
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  function play() {
    introDone = false; triggered = true; introStart = performance.now(); lastSpawn = 0;
    packets.forEach(function (p) { p.el.parentNode && p.el.parentNode.removeChild(p.el); }); packets = [];
    edges.forEach(function (e) { e.len = 0; });
    kick();
  }
  function finish() { triggered = true; introDone = true; introStart = performance.now() - introEnd / speed - 2000; kick(); }
  root.__fnlPlay = play;

  build();
  var isStatic = root.hasAttribute('data-static') || C.trigger === 'static' || reduce;
  if (isStatic) finish();

  // Synlighet: spill bare når den vises
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) kick();
    }, { threshold: 0 }).observe(root);
    if (!isStatic) {
      var trig = C.trigger || 'middle';
      var ths = [0]; for (var q = 1; q <= 20; q++) ths.push(q / 20);
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (!en.isIntersecting || triggered) return;
          if (trig === 'full') {
            var r = en.boundingClientRect, vh = window.innerHeight || document.documentElement.clientHeight;
            if (!(r.bottom <= vh + 2 || r.top <= vh * 0.15)) return;
          }
          io.disconnect(); play();
        });
      }, trig === 'full' ? { threshold: ths } : { rootMargin: trig === 'early' ? '0px 0px -10% 0px' : '0px 0px -30% 0px', threshold: 0 });
      io.observe(root);
    }
  } else { visible = true; finish(); }

  if (window.ResizeObserver) {
    var lw = 0, lh = 0;
    new ResizeObserver(function () {
      var r = root.getBoundingClientRect();
      if (Math.abs(r.width - lw) > 3 || Math.abs(r.height - lh) > 3) {
        lw = r.width; lh = r.height;
        if (!introDone && triggered) introDone = true;   // midt i introen: hopp til ferdig
        build(); kick();
      }
    }).observe(root);
  }
}

// ============================================================
//  Editor
// ============================================================

const $ = id => document.getElementById(id);
const els = {
  style: $('styleSelect'), color2: $('color2'), mix: $('mix'),
  logoUrl: $('logoUrl'), logoPanel: $('logoPanel'), logoSize: $('logoSize'),
  symList: $('symList'), addSym: $('addSymBtn'), symMode: $('symMode'), nodeStyle: $('nodeStyle'), symSize: $('symSize'),
  nodeCount: $('nodeCount'), layers: $('layers'), spread: $('spread'), density: $('density'),
  reseed: $('reseedBtn'), lineShape: $('lineShape'),
  bgPreset: $('bgPreset'), bgColor: $('bgColor'), lineColor: $('lineColor'), accentColor: $('accentColor'), nodeColor: $('nodeColor'),
  trigger: $('triggerSelect'), speed: $('speed'), motion: $('motion'), optPackets: $('optPackets'), optBreath: $('optBreath'),
  aspect: $('aspect'), width: $('widthSelect'), optRound: $('optRound'), padTop: $('padTop'), padBot: $('padBot'),
  altText: $('altText'), caption: $('captionText'),
  previewHost: $('previewHost'), playBtn: $('playBtn'), copyEmbed: $('copyEmbedBtn'),
  back: $('backBtn'), full: $('fullscreenBtn'), openLabrador: $('openLabradorBtn'),
  projectSelect: $('projectSelect'), saveProject: $('saveProjectBtn'),
};

const state = {
  seed: 1 + Math.floor(Math.random() * 99999),
  // Symboler: { id, kind: 'url'|'icon', url, icon }
  symbols: [],
};

function uid() { return 's_' + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isValidUrl(s) { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; } }
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- Labrador-filer (samme mønster som Chatbobler) ----------
const IMG_EXT = /\.(png|svg|jpe?g|gif|avif|webp)(\?|$)/i;

async function openFilePanel(panel, onPick, reopen) {
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try { res = await window.faktisk.labradorListFiles(); }
  catch (err) { panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>'; return; }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. <button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) reopen(); else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 60);
  if (!matching.length) { panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder lastet opp ennå.</div>'; return; }
  panel.innerHTML = '<div class="ftb-labpanel__status">' + matching.length + ' bilder (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'ftb-labfile'; item.textContent = f.name; item.title = f.url;
    item.addEventListener('click', () => { panel.style.display = 'none'; onPick(f.url); });
    list.appendChild(item);
  });
}

async function uploadImage(btn, onDone) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; }) : () => {};
  try {
    const res = await window.faktisk.labradorUpload({ filters: [{ name: 'Bilde', extensions: ['png', 'webp', 'gif', 'jpg', 'jpeg', 'avif'] }] });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) onDone(res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally { unsub(); btn.disabled = false; btn.textContent = orig; }
}

// Logo
function setLogo(url) { els.logoUrl.value = url; scheduleUpdate(); }
$('logoFilesBtn').addEventListener('click', () => {
  if (els.logoPanel.style.display !== 'none') { els.logoPanel.style.display = 'none'; return; }
  openFilePanel(els.logoPanel, setLogo, () => { els.logoPanel.style.display = 'none'; $('logoFilesBtn').click(); });
});
$('logoUploadBtn').addEventListener('click', e => uploadImage(e.currentTarget, setLogo));

// ---------- Symbolliste ----------
function renderSymbols() {
  els.symList.innerHTML = '';
  state.symbols.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'cb-msg';
    const iconOpts = Object.keys(ICONS).map(k => `<option value="${k}" ${s.icon === k ? 'selected' : ''}>${ICONS[k].label}</option>`).join('');
    const thumb = s.kind === 'icon'
      ? `<svg class="ln-thumb" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ICONS[s.icon] ? ICONS[s.icon].d : ''}"/></svg>`
      : (s.url && isValidUrl(s.url) ? `<img class="ln-thumb" src="${escapeHtml(s.url)}" alt="">` : '<span class="ln-thumb ln-thumb--empty">?</span>');
    card.innerHTML = `
      <div class="hk-row__top">
        ${thumb}
        <select class="project-select ln-kind" data-act="kind" data-id="${s.id}">
          <option value="url" ${s.kind === 'url' ? 'selected' : ''}>Eget bilde</option>
          <option value="icon" ${s.kind === 'icon' ? 'selected' : ''}>Innebygd ikon</option>
        </select>
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-id="${s.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${s.id}" title="Fjern">×</button>
        </span>
      </div>
      ${s.kind === 'icon' ? `
      <select class="project-select" data-act="icon" data-id="${s.id}">${iconOpts}</select>` : `
      <input class="hk-row__img" value="${escapeHtml(s.url || '')}" data-act="url" data-id="${s.id}" placeholder="Bilde-URL fra Labrador (PNG uten bakgrunn)" spellcheck="false">
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="files" data-id="${s.id}">Mine filer ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-id="${s.id}">Last opp…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${s.id}" style="display:none;"></div>`}`;
    els.symList.appendChild(card);
  });
  document.body.classList.toggle('ln-has-icons', state.symbols.some(s => s.kind === 'icon'));
}

function setSymUrl(id, url) {
  const s = state.symbols.find(x => x.id === id);
  if (!s) return;
  s.url = url; renderSymbols(); scheduleUpdate();
}

els.symList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const i = state.symbols.findIndex(x => x.id === id);
  if (act === 'del') { state.symbols.splice(i, 1); renderSymbols(); scheduleUpdate(); }
  if (act === 'up' && i > 0) { const [s] = state.symbols.splice(i, 1); state.symbols.splice(i - 1, 0, s); renderSymbols(); scheduleUpdate(); }
  if (act === 'files') {
    const panel = els.symList.querySelector(`[data-panel="${id}"]`);
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    openFilePanel(panel, url => setSymUrl(id, url), () => { panel.style.display = 'none'; btn.click(); });
  }
  if (act === 'upload') uploadImage(btn, url => setSymUrl(id, url));
});
els.symList.addEventListener('change', e => {
  const { act, id } = e.target.dataset;
  const s = state.symbols.find(x => x.id === id);
  if (!s) return;
  if (act === 'kind') { s.kind = e.target.value; if (s.kind === 'icon' && !s.icon) s.icon = 'phone'; renderSymbols(); }
  if (act === 'icon') { s.icon = e.target.value; renderSymbols(); }
  scheduleUpdate();
});
els.symList.addEventListener('input', e => {
  const { act, id } = e.target.dataset;
  const s = state.symbols.find(x => x.id === id);
  if (s && act === 'url') { s.url = e.target.value.trim(); scheduleUpdate(); }
});
els.addSym.addEventListener('click', () => {
  state.symbols.push({ id: uid(), kind: state.symbols.length ? 'url' : 'icon', url: '', icon: 'phone' });
  renderSymbols(); scheduleUpdate();
});
els.reseed.addEventListener('click', () => { state.seed = 1 + Math.floor(Math.random() * 99999); scheduleUpdate(); });

// ---------- Stil ----------
// Tett nett: 40–260 noder (canvas). Enkelt: 4–48 noder (SVG).
const COUNT_RANGE = { mesh: [40, 260, 150], simple: [4, 48, 18] };
function syncStyleUI(resetCount) {
  const st = els.style.value === 'simple' ? 'simple' : 'mesh';
  document.body.classList.toggle('ln-mesh', st === 'mesh');
  const [mn, mx, def] = COUNT_RANGE[st];
  els.nodeCount.min = mn; els.nodeCount.max = mx;
  els.nodeCount.step = st === 'mesh' ? 10 : 1;
  const v = parseInt(els.nodeCount.value, 10);
  if (resetCount || !(v >= mn && v <= mx)) els.nodeCount.value = def;
}
els.style.addEventListener('change', () => { syncStyleUI(true); scheduleUpdate(); });

// Bakgrunnsfarger for tett nett: lys midt, mørk kant
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (n, sh) => (n >> sh) & 255;
  const c = [16, 8, 0].map(sh => Math.round(ch(pa, sh) * (1 - t) + ch(pb, sh) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function meshBg(bg) {
  if (bg === 'transparent') return { mid: '#16295A', edge: '#020409' };
  if (bg.toUpperCase() === '#07153A') return { mid: '#16295A', edge: '#020409' };
  if (bg === '#000000') return { mid: '#0C1630', edge: '#000000' };
  if (luminance(bg) > 0.5) return { mid: bg, edge: mixHex(bg, "#000000", 0.05) };
  return { mid: mixHex(bg, '#FFFFFF', 0.1), edge: mixHex(bg, '#000000', 0.75) };
}

// ---------- Konfig → embed ----------
function readConfig() {
  const bg = els.bgPreset.value === 'custom' ? els.bgColor.value : els.bgPreset.value;
  return {
    style: els.style.value === 'simple' ? 'simple' : 'mesh',
    color2: els.color2.value, mix: parseFloat(els.mix.value),
    logo: isValidUrl(els.logoUrl.value.trim()) ? els.logoUrl.value.trim() : '',
    logoSize: parseFloat(els.logoSize.value),
    symbols: state.symbols
      .filter(s => s.kind === 'icon' ? !!ICONS[s.icon] : isValidUrl(s.url || ''))
      .map(s => s.kind === 'icon' ? { kind: 'icon', d: ICONS[s.icon].d } : { kind: 'url', url: s.url }),
    symMode: els.symMode.value, nodeStyle: els.nodeStyle.value, symSize: parseFloat(els.symSize.value),
    count: parseInt(els.nodeCount.value, 10), layers: parseInt(els.layers.value, 10),
    spread: parseFloat(els.spread.value), density: parseFloat(els.density.value),
    lineShape: els.lineShape.value, seed: state.seed,
    bg: bg === 'transparent' || HEX.test(bg) ? bg : '#07153A',
    lineColor: els.lineColor.value, accent: els.accentColor.value, nodeColor: els.nodeColor.value,
    trigger: els.trigger.value, speed: parseFloat(els.speed.value), motion: parseInt(els.motion.value, 10),
    packets: els.optPackets.checked, breath: els.optBreath.checked,
    aspect: els.aspect.value, width: els.width.value, round: els.optRound.checked,
    padTop: parseInt(els.padTop.value, 10), padBot: parseInt(els.padBot.value, 10),
    alt: els.altText.value.trim(), caption: els.caption.value.trim(),
  };
}

function buildEmbedSnippet(cfg) {
  cfg = cfg || readConfig();
  const id = 'fnl-' + Math.random().toString(36).slice(2, 8);
  const S = `.fnl-${id}`, B = `.fnl-box-${id}`;
  const maxW = cfg.width === 'full' ? '100%' : (parseInt(cfg.width, 10) || 640) + 'px';
  const mobAspect = cfg.aspect === '21/9' ? '1 / 1' : cfg.aspect === '1/1' ? '1 / 1' : '4 / 5';
  const vspace = (v, side) => {
    const n = Number.isFinite(v) ? Math.max(-24, Math.min(64, v)) : 12;
    return n >= 0 ? `padding-${side}: ${n}px;` : `padding-${side}: 0; margin-${side}: ${n}px;`;
  };
  // Det embedden trenger (ingen editor-felt)
  const runCfg = {
    logo: cfg.logo, logoSize: cfg.logoSize, symbols: cfg.symbols, symMode: cfg.symMode, nodeStyle: cfg.nodeStyle,
    symSize: cfg.symSize, count: cfg.count, layers: cfg.layers, spread: cfg.spread, density: cfg.density,
    lineShape: cfg.lineShape, seed: cfg.seed, bg: cfg.bg, lineColor: cfg.lineColor, accent: cfg.accent,
    nodeColor: cfg.nodeColor, symColor: autoSymColor(cfg), trigger: cfg.trigger, speed: cfg.speed,
    motion: cfg.motion, packets: cfg.packets, breath: cfg.breath,
  };
  const mesh = cfg.style === 'mesh';
  const mb = meshBg(cfg.bg);
  const runMesh = {
    logo: cfg.logo, logoSize: cfg.logoSize, symbols: cfg.symbols, nodeScale: +(cfg.symSize / 0.065).toFixed(3),
    count: cfg.count, seed: cfg.seed, bg: cfg.bg, bgMid: mb.mid, bgEdge: mb.edge,
    colorA: cfg.lineColor, colorB: cfg.color2, mix: cfg.mix,
    trigger: cfg.trigger, speed: cfg.speed, motion: cfg.motion, packets: cfg.packets, breath: cfg.breath,
  };
  const json = JSON.stringify(mesh ? runMesh : runCfg).replace(/</g, '\\u003c');
  const baseCss = window.FaktiskEmbedBase ? window.FaktiskEmbedBase.getBaseCss('fnl-container') : '';
  const bgCss = cfg.bg === 'transparent' ? 'transparent'
    : mesh ? mb.edge
    : cfg.bg === '#07153A' ? 'radial-gradient(120% 90% at 50% 45%, #12275E 0%, #07153A 60%, #040C24 100%)' : cfg.bg;

  return `<!-- ============================================
     FAKTISK · LOGO-NETTVERK
     Animert nettverk. Utseende endres i Faktisk Studio.
     ============================================ -->
  <style>${baseCss}
    .fnl-container { container-type: inline-size; }
    .fnl-container${B} { ${vspace(cfg.padTop, 'top')} ${vspace(cfg.padBot, 'bottom')} }
    ${B} .fnl-frame { max-width: ${maxW}; margin: 0 auto; }
    ${S} {
      position: relative; width: 100%;
      aspect-ratio: ${cfg.aspect.replace('/', ' / ')};
      background: ${bgCss};
      ${cfg.round ? 'border-radius: 14px;' : ''}
      overflow: hidden;
    }
    @container (max-width: 560px) { ${S} { aspect-ratio: ${mobAspect}; ${cfg.round ? 'border-radius: 10px;' : ''} } }
    ${S} ${mesh ? 'canvas' : 'svg'} { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    ${B} .fnl-caption { max-width: ${maxW}; margin: .6em auto 0; font-family: var(--fk-font); font-size: 14px; line-height: 1.45; color: #5A5A5A; }
  </style>
  <div class="fnl-container fnl-box-${id}">
    <div class="fnl-frame">
      <div class="fnl-${id}" id="${id}" role="img" aria-label="${escapeHtml(cfg.alt || 'Animert illustrasjon av et nettverk')}">${mesh ? '<canvas aria-hidden="true"></canvas>' : '<svg aria-hidden="true"></svg>'}</div>
    </div>${cfg.caption ? `
    <!-- ▶ BILDETEKST -->
    <div class="fnl-caption">${escapeHtml(cfg.caption)}</div>` : ''}
  </div>
  <script>
  (function () {
    var C = ${json};
    (${(mesh ? fnlMesh : fnlRun).toString()})(document.getElementById('${id}'), C);
  })();
  </script>
`;
}

// Innebygde symboler får automatisk kontrastfarge mot det de står på:
// sirkelen (noder i farget sirkel) eller bakgrunnen (gjennomsiktig = hvit artikkel).
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function autoSymColor(cfg) {
  const base = cfg.nodeStyle === 'disc' ? cfg.nodeColor : (cfg.bg === 'transparent' ? '#FFFFFF' : cfg.bg);
  if (luminance(base) < 0.35) return '#FFFFFF';
  // Lys bakgrunn: linjefargen hvis den er mørk nok, ellers mørk blå
  return luminance(cfg.lineColor) < 0.25 ? cfg.lineColor : '#07153A';
}

// ---------- Forhåndsvisning ----------
function mountSnippet(host, html, isStatic) {
  host.innerHTML = html;
  const root = host.querySelector('[id^="fnl-"]');
  if (root && isStatic) root.setAttribute('data-static', '');
  host.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script'); s.textContent = old.textContent; old.replaceWith(s);
  });
  return root;
}
function renderPreview() {
  updateOutputs();
  document.body.classList.toggle('ln-bg-custom', els.bgPreset.value === 'custom');
  mountSnippet(els.previewHost, buildEmbedSnippet(readConfig()), true);
}
els.playBtn.addEventListener('click', () => {
  // Ekte embed-kode uten data-static, så introen spilles fra start
  const root = mountSnippet(els.previewHost, buildEmbedSnippet(Object.assign(readConfig(), { trigger: 'early' })), false);
  if (root && root.__fnlPlay) root.__fnlPlay();
});

const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = $('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

function updateOutputs() {
  const pct = el => Math.round(parseFloat(el.value) * 100) + ' %';
  $('logoSizeOut').textContent = pct(els.logoSize);
  $('symSizeOut').textContent = pct(els.symSize);
  $('nodeCountOut').textContent = els.nodeCount.value;
  $('layersOut').textContent = els.layers.value;
  $('spreadOut').textContent = pct(els.spread);
  $('densityOut').textContent = pct(els.density);
  $('mixOut').textContent = pct(els.mix);
  $('speedOut').textContent = pct(els.speed);
  $('padTopOut').textContent = els.padTop.value + ' px';
  $('padBotOut').textContent = els.padBot.value + ' px';
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { renderPreview(); saveStateNow(); }, 200);
}

els.copyEmbed.addEventListener('click', async () => {
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet(readConfig()));
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});
els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => { await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file'); });

// ---------- Lagring ----------
const FIELDS = ['style', 'color2', 'mix', 'logoUrl', 'logoSize', 'symMode', 'nodeStyle', 'symSize', 'nodeCount', 'layers', 'spread', 'density',
  'lineShape', 'bgPreset', 'bgColor', 'lineColor', 'accentColor', 'nodeColor', 'trigger', 'speed', 'motion',
  'aspect', 'width', 'padTop', 'padBot', 'altText', 'caption'];
const CHECKS = ['optPackets', 'optBreath', 'optRound'];
let isRestoring = false;

function serializeState() {
  const o = { seed: state.seed, symbols: state.symbols };
  FIELDS.forEach(f => { o[f] = els[f].value; });
  CHECKS.forEach(f => { o[f] = els[f].checked; });
  return o;
}
function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    // Stilen først, så nodeCount får riktig område før verdien settes.
    // Lagret før stilvalget fantes = enkelt nettverk.
    els.style.value = s.style === 'mesh' ? 'mesh' : 'simple';
    syncStyleUI(false);
    FIELDS.forEach(f => { if (f !== 'style' && s[f] != null) els[f].value = s[f]; });
    syncStyleUI(false);
    CHECKS.forEach(f => { if (typeof s[f] === 'boolean') els[f].checked = s[f]; });
    if (s.seed) state.seed = s.seed;
    if (Array.isArray(s.symbols)) state.symbols = s.symbols.map(x => ({ id: x.id || uid(), kind: x.kind === 'icon' ? 'icon' : 'url', url: x.url || '', icon: x.icon || 'phone' }));
    renderSymbols(); renderPreview();
  } finally { isRestoring = false; }
}
function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}
FIELDS.forEach(f => {
  els[f].addEventListener('input', scheduleUpdate);
  els[f].addEventListener('change', scheduleUpdate);
});
CHECKS.forEach(f => els[f].addEventListener('change', scheduleUpdate));
els.bgColor.addEventListener('input', () => { els.bgPreset.value = 'custom'; });

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => { const o = document.createElement('option'); o.value = p.fileId; o.textContent = p.name; sel.appendChild(o); });
  } catch (e) { console.error(e); }
}
els.saveProject.addEventListener('click', async () => {
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', `Logo-nettverk ${new Date().toLocaleDateString('no')}`);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) await refreshProjectList();
});
els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) applyState(res.state);
});

(async function init() {
  setPreviewWidth(680);
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) { applyState(res.state); els.projectSelect.value = fileId; return; }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) { applyState(res.state); return; }
  } catch (e) {}
  // Utgangspunkt: tett nett med person-ikoner, så man ser noe med én gang
  syncStyleUI(true);
  state.symbols = [{ id: uid(), kind: 'icon', icon: 'person', url: '' }];
  renderSymbols(); renderPreview();
})();
