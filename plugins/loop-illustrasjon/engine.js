// Faktisk Studio · Loop-illustrasjon · motor (embed)
//
// Tegner en loopende, animert illustrasjon på ett lerret: bakgrunn (farge, bilde eller video) og
// lag oppå hverandre — bilder/logoer, video, ringer av elementer, nettverk og mobiler. Lag kan
// samles i mapper som animeres samlet (uskarphet, zoom, spinn …). Alle bevegelser går opp i
// loop-lengden, så loopen skjøtes sømløst.
//
// ES5, ingen avhengigheter. Kopieres inn i embedden via toString(), så forhåndsvisningen i
// Studio kjører nøyaktig samme kode. Med C.__manual = true startes ingen egen avspilling, og
// funksjonen returnerer et API som editoren og video-eksporten bruker (draw(t), seek …).
function fliRun(root, C) {
  if (!root) return null;
  if (root.__fli && !C.__manual) return null;
  root.__fli = 1;
  var TAU = Math.PI * 2;
  var cv = root.querySelector('canvas');
  var ctx = cv.getContext('2d');
  // leses på nytt ved hver tegning, så editoren kan endre oppsettet uten å starte motoren på nytt
  var L = Math.max(1, +C.loop || 8);
  var layers = C.layers || [];
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- hjelpere ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sm(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function eOut(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
  function eIn(x) { x = clamp(x, 0, 1); return x * x * x; }
  function eBack(x) { x = clamp(x, 0, 1); var c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    var n = m ? parseInt(m[1], 16) : 0x6FA8FF;
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function rgba(h, a) { var c = hexRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(h1, h2, k) {
    var a = hexRgb(h1), b = hexRgb(h2), o = [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * k); });
    return '#' + ((1 << 24) + (o[0] << 16) + (o[1] << 8) + o[2]).toString(16).slice(1);
  }
  function rr(x, c, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    x.beginPath(); x.moveTo(c + r, y); x.arcTo(c + w, y, c + w, y + h, r); x.arcTo(c + w, y + h, c, y + h, r);
    x.arcTo(c, y + h, c, y, r); x.arcTo(c, y, c + w, y, r); x.closePath();
  }
  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }
  // periodisk i loopen: n hele runder per loop
  function wave(tl, n, ph) { return Math.sin(TAU * n * tl / L + (ph || 0)); }

  // Kan lerretet gjøre uskarphet selv? (Safari før 18 kan ikke — da skaleres bildet ned og opp)
  // Sjekkes ved å faktisk tegne: Safari (iPhone/iPad) godtar ctx.filter som en vanlig egenskap uten å gjøre noe med den
  // Ved videoeksport brukes alltid den utregnede uskarpheten (samme resultat på alle maskiner, uavhengig av grafikkort)
  var FILTER = C.__export ? false : (function () {
    try {
      // fyll en firkant med uskarphet og se om det lekker lys rett utenfor kanten
      var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d');
      x.filter = 'blur(3px)'; x.fillStyle = '#fff'; x.fillRect(10, 8, 12, 16);
      if (x.getImageData(8, 16, 1, 1).data[3] > 10) return true;
    } catch (e) {}
    // Chrome/Electron/Firefox har filteret selv om testen over skulle feile; Safari (også alle nettlesere på iPhone) har det ikke
    var ua = navigator.userAgent || '', safari = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(ua) || /iP(hone|ad|od)/.test(ua);
    return !safari && typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
  })();

  // ---------- media ----------
  var media = {}, videos = [], holder = null, pending = 0, onReady = [], wantPlay = false;
  function playOne(v) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  // bakgrunnsvideo i embedden: et ekte <video>-element bak lerretet (jevn avspilling, uskarphet med CSS),
  // i stedet for å tegne hvert videobilde inn i lerretet. Editoren og eksporten tegner den som før.
  var bgVid = null;
  if (!C.__manual && C.bg && C.bg.type === 'video' && C.bg.src) {
    bgVid = document.createElement('video');
    bgVid.muted = true; bgVid.defaultMuted = true; bgVid.loop = true; bgVid.playsInline = true; bgVid.preload = 'auto';
    bgVid.setAttribute('muted', ''); bgVid.setAttribute('playsinline', ''); bgVid.setAttribute('webkit-playsinline', ''); bgVid.setAttribute('aria-hidden', 'true');
    bgVid.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    bgVid.addEventListener('loadeddata', function () { if (wantPlay) playOne(bgVid); });
    bgVid.src = String(C.bg.src).replace(/#video$/, '').replace(/ /g, '%20');
    // stillbilde når autoplay er blokkert (lav strømmodus på iPhone) eller videoen ikke lastes
    if (C.posters && C.posters[C.bg.src]) bgVid.poster = safeUrl(C.posters[C.bg.src]);
    root.insertBefore(bgVid, root.firstChild);
    videos.push(bgVid);
  }
  function done() { pending = Math.max(0, pending - 1); if (!pending) { var f = onReady; onReady = []; f.forEach(function (fn) { fn(); }); } kick(); }
  function isVideo(src) { return /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(src || '') || /^blob:.*#video$/.test(src || ''); }
  function getMedia(src) {
    if (!src) return null;
    if (media[src]) return media[src];
    var m = { src: src, el: null, ok: false, video: isVideo(src) };
    media[src] = m; pending++;
    if (m.video) {
      if (!holder) {
        holder = document.createElement('div');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;';
        root.appendChild(holder);
      }
      var v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      // prøv med CORS (så uskarphet kan regnes ut), og uten hvis serveren ikke tillater det
      var vSrc = safeUrl(src.replace(/#video$/, ''));
      if (/^https?:/.test(vSrc)) v.crossOrigin = 'anonymous';
      var fired = false, fin = function () { if (fired) return; fired = true; m.ok = !!v.videoWidth; done(); };
      // trege klipp: blir de klare etter tidsfristen, tas de likevel i bruk
      v.addEventListener('loadeddata', function () { m.ok = !!v.videoWidth; if (wantPlay) playOne(v); fin(); kick(); });
      v.addEventListener('error', function () { if (v.crossOrigin && !C.cors) { v.removeAttribute('crossorigin'); v.crossOrigin = null; v.src = vSrc; v.load(); if (wantPlay) playOne(v); return; } fin(); });
      setTimeout(fin, 15000);
      v.src = vSrc;
      holder.appendChild(v); m.el = v; videos.push(v);
      // stillbilde som tegnes til videoen har et bilde å vise (blokkert autoplay, lav strømmodus, treg last)
      var pu = C.posters && C.posters[src];
      if (pu) {
        var pim = new Image(), pSrc = safeUrl(pu); if (/^https?:/.test(pSrc)) pim.crossOrigin = 'anonymous';
        pim.onload = function () { m.pok = true; kick(); };
        pim.onerror = function () { if (pim.crossOrigin && !C.cors) { pim.removeAttribute('crossorigin'); pim.crossOrigin = null; pim.src = pSrc + (pSrc.indexOf('?') < 0 ? '?' : '&') + 'nc=1'; } };
        pim.src = pSrc; m.pim = pim;
      }
    } else {
      var im = new Image();
      var iSrc = safeUrl(src); if (/^https?:/.test(iSrc)) im.crossOrigin = 'anonymous';
      im.onload = function () { m.ok = true; done(); };
      im.onerror = function () { if (im.crossOrigin && !C.cors) { im.removeAttribute('crossorigin'); im.crossOrigin = null; im.src = iSrc + (iSrc.indexOf('?') < 0 ? '?' : '&') + 'nc=1'; return; } m.ok = false; done(); };
      im.src = iSrc; m.el = im;
    }
    return m;
  }
  // videoen selv når den har et bilde, ellers stillbildet
  function mel(m) { return m.video && m.pok && !(m.el.readyState >= 2 && m.el.videoWidth) ? m.pim : m.el; }
  function mready(m) { return !!(m && (m.ok || m.pok)); }
  function msize(m) { var e = mel(m); if (e !== m.el) return [e.naturalWidth || 1, e.naturalHeight || 1]; return m.video ? [e.videoWidth || 16, e.videoHeight || 9] : [e.naturalWidth || e.width || 1, e.naturalHeight || e.height || 1]; }
  function drawCover(x, m, dx, dy, dw, dh, fx, fy) {
    if (!mready(m)) return false;
    var s = msize(m), k = Math.max(dw / s[0], dh / s[1]), sw = dw / k, sh = dh / k;
    var sx = (s[0] - sw) * (fx == null ? 0.5 : fx), sy = (s[1] - sh) * (fy == null ? 0.5 : fy);
    try { x.drawImage(mel(m), sx, sy, sw, sh, dx, dy, dw, dh); } catch (e) { return false; }
    return true;
  }
  // hent alle filer prosjektet bruker
  // én adresse per linje — Labrador beholder mellomrom i filnavn, så det deles ikke på mellomrom
  function srcList(l) { return String(l.srcs || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return /^(https?:|blob:|data:)/.test(s); }); }
  function safeUrl(u) { return /^https?:/.test(u) ? u.replace(/ /g, '%20') : u; }
  if (C.bg && (C.bg.type === 'image' || C.bg.type === 'video') && C.bg.src && !bgVid) getMedia(C.bg.src);
  layers.forEach(function (l) {
    if (l.src) getMedia(l.src);
    if (l.type === 'phones' || l.type === 'network' || l.type === 'ring') srcList(l).forEach(getMedia);
  });

  // ---------- sprites ----------
  var spriteCache = {};
  function glowSprite(col) {
    var k = 'g' + col; if (spriteCache[k]) return spriteCache[k];
    var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, rgba(col, 1)); g.addColorStop(0.22, rgba(col, 0.45)); g.addColorStop(1, rgba(col, 0));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); spriteCache[k] = c; return c;
  }
  // innebygde former for ringen: patron, prikk, strek, node, person
  function shapeSprite(kind, col) {
    var k = 's' + kind + col; if (spriteCache[k]) return spriteCache[k];
    var S = 128, c = document.createElement('canvas'); c.width = c.height = S; var x = c.getContext('2d');
    x.translate(S / 2, S / 2);
    if (kind === 'patron') {
      // spissen peker opp (utover i ringen)
      var w = 34, hb = 70, ht = 40;
      var g = x.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, mix(col, '#000000', 0.45)); g.addColorStop(0.35, mix(col, '#ffffff', 0.35)); g.addColorStop(0.6, col); g.addColorStop(1, mix(col, '#000000', 0.5));
      x.fillStyle = g; rr(x, -w / 2, -10, w, hb, 4); x.fill();
      x.fillStyle = mix(col, '#000000', 0.55); x.fillRect(-w / 2 - 2, hb - 22, w + 4, 8);
      var tip = mix(col, '#c0602a', 0.55), g2 = x.createLinearGradient(-w / 2, 0, w / 2, 0);
      g2.addColorStop(0, mix(tip, '#000000', 0.4)); g2.addColorStop(0.35, mix(tip, '#ffffff', 0.3)); g2.addColorStop(1, mix(tip, '#000000', 0.45));
      x.fillStyle = g2; x.beginPath(); x.moveTo(-w / 2 + 1, -10); x.bezierCurveTo(-w / 2 + 1, -10 - ht * 0.75, -4, -10 - ht, 0, -10 - ht);
      x.bezierCurveTo(4, -10 - ht, w / 2 - 1, -10 - ht * 0.75, w / 2 - 1, -10); x.closePath(); x.fill();
    } else if (kind === 'line') {
      x.fillStyle = col; rr(x, -6, -48, 12, 96, 6); x.fill();
    } else if (kind === 'node') {
      var gl = glowSprite(col); x.drawImage(gl, -64, -64, 128, 128);
      x.fillStyle = '#ffffff'; x.beginPath(); x.arc(0, 0, 13, 0, TAU); x.fill();
      x.strokeStyle = col; x.lineWidth = 5; x.stroke();
    } else if (kind === 'person') {
      x.fillStyle = mix(col, '#000000', 0.25); x.beginPath(); x.arc(0, 0, 58, 0, TAU); x.fill();
      x.save(); x.beginPath(); x.arc(0, 0, 58, 0, TAU); x.clip();
      x.fillStyle = mix(col, '#ffffff', 0.75); x.beginPath(); x.arc(0, -12, 22, 0, TAU); x.fill();
      x.beginPath(); x.ellipse(0, 50, 40, 32, 0, 0, TAU); x.fill(); x.restore();
      x.strokeStyle = col; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 58, 0, TAU); x.stroke();
    } else {
      x.fillStyle = col; x.beginPath(); x.arc(0, 0, 40, 0, TAU); x.fill();
    }
    spriteCache[k] = c; return c;
  }

  // ---------- buffere (for mapper og uskarphet) ----------
  // Lerreter som har fått tegnet en fil uten CORS («tainted») kan aldri leses igjen — de holdes for seg,
  // så de ikke ødelegger utregnet uskarphet for andre lag. TAINT husker hvilke lag det gjelder.
  var pool = [], tpool = [], TAINT = {};
  function getBuf(w, h, t) {
    var b = (t ? tpool : pool).pop() || document.createElement('canvas');
    if (b.width !== w || b.height !== h) { b.width = w; b.height = h; }
    var x = b.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    try { x.filter = 'none'; } catch (e) {}
    return b;
  }
  function freeBuf(b) { (b.__t ? tpool : pool).push(b); }
  // Uskarphet uten ctx.filter (Safari): skaler ned i nøyaktige halve steg, regn ut en ekte gaussisk uskarphet
  // i flyttall på det lille bildet (tre boksfiltre), og skaler opp igjen. Ingen avrunding mellom stegene,
  // så tynne linjer og glød ikke flimrer eller «skimrer» når de beveger seg.
  var pyr = [], fl = null, BLUR = { cpu: 0, gpu: 0, filter: 0, err: '' };
  function prep(i, w, h) {
    var c = pyr[i] || (pyr[i] = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
    // nøyaktig halvering med vanlig (lineær) utjevning er et rent 2×2-snitt — «high» er bare tregere her
    g.imageSmoothingEnabled = true; try { g.imageSmoothingQuality = 'low'; } catch (e) {}
    return c;
  }
  function gaussBoxes(sigma) {
    // tre boksbredder som til sammen gir tilnærmet gaussisk uskarphet
    var wIdeal = Math.sqrt(12 * sigma * sigma / 3 + 1), wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    var wu = wl + 2, mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4), m = Math.round(mIdeal), out = [];
    for (var i = 0; i < 3; i++) out.push(((i < m ? wl : wu) - 1) / 2);
    return out;
  }
  function boxH(src, dst, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var y = 0; y < h; y++) {
      var ti = y * w, li = ti, ri = ti + r, fv = src[ti], lv = src[ti + w - 1], acc = (r + 1) * fv, j;
      for (j = 0; j < r; j++) acc += src[ti + Math.min(j, w - 1)];
      for (j = 0; j <= r; j++) { acc += (ri < y * w + w ? src[ri] : lv) - fv; dst[ti++] = acc * iarr; ri++; }
      for (j = r + 1; j < w - r; j++) { acc += src[ri++] - src[li++]; dst[ti++] = acc * iarr; }
      for (j = Math.max(w - r, r + 1); j < w; j++) { acc += lv - src[li++]; dst[ti++] = acc * iarr; }
    }
  }
  function boxV(src, dst, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var x0 = 0; x0 < w; x0++) {
      var ti = x0, li = ti, ri = ti + r * w, fv = src[ti], lv = src[ti + w * (h - 1)], acc = (r + 1) * fv, j;
      for (j = 0; j < r; j++) acc += src[x0 + Math.min(j, h - 1) * w];
      for (j = 0; j <= r; j++) { acc += (ri < w * h ? src[ri] : lv) - fv; dst[ti] = acc * iarr; ri += w; ti += w; }
      for (j = r + 1; j < h - r; j++) { acc += src[ri] - src[li]; dst[ti] = acc * iarr; li += w; ri += w; ti += w; }
      for (j = Math.max(h - r, r + 1); j < h; j++) { acc += lv - src[li]; dst[ti] = acc * iarr; li += w; ti += w; }
    }
  }
  // Reserve når bildet ikke kan leses (fil uten CORS): nøyaktige halveringer, utjevning på det minste nivået
  // og dobling opp igjen, med blanding mellom to nivåer så uskarpheten endrer seg glidende. Egne lerreter.
  var tp = [];
  function tprep(i, w, h) {
    var c = tp[i] || (tp[i] = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true; try { g.imageSmoothingQuality = 'low'; } catch (e) {}
    return c;
  }
  function tSmooth(src, slot) {
    var c = tprep(slot, src.width, src.height), g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.25; g.drawImage(src, 0, 0);
    g.globalAlpha = 0.125; g.drawImage(src, -1, 0); g.drawImage(src, 1, 0); g.drawImage(src, 0, -1); g.drawImage(src, 0, 1);
    g.globalAlpha = 0.0625; g.drawImage(src, -1, -1); g.drawImage(src, 1, -1); g.drawImage(src, -1, 1); g.drawImage(src, 1, 1);
    return c;
  }
  function gpuBlur(x, buf, blur, rect) {
    var rx = rect ? rect[0] : 0, ry = rect ? rect[1] : 0, rw = rect ? rect[2] : buf.width, rh = rect ? rect[3] : buf.height;
    var target = clamp(blur * 1.25, 1, 64), lf = Math.log(target) / Math.LN2, n = Math.max(1, Math.floor(lf)), fr = Math.max(0, lf - n);
    var lv = [], cur = null;
    for (var k = 1; k <= n + 1; k++) {
      var sw = cur ? cur.width : rw, sh = cur ? cur.height : rh, c = tprep(k, Math.max(1, Math.ceil(sw / 2)), Math.max(1, Math.ceil(sh / 2)));
      if (cur) c.getContext('2d').drawImage(cur, 0, 0, sw / 2, sh / 2); else c.getContext('2d').drawImage(buf, rx, ry, rw, rh, 0, 0, rw / 2, rh / 2);
      lv[k] = c; cur = c;
    }
    var m = tprep(40, rw, rh), mg = m.getContext('2d');
    mg.globalCompositeOperation = 'lighter';
    var up = function (k2, wgt, slot) {
      var c2 = tSmooth(lv[k2], slot);
      for (var j = k2 - 1; j >= 1; j--) { var u = tprep(slot + 1 + (k2 - 1 - j), lv[j].width, lv[j].height); u.getContext('2d').drawImage(c2, 0, 0, c2.width * 2, c2.height * 2); c2 = u; }
      mg.globalAlpha = wgt; mg.drawImage(c2, 0, 0, c2.width * 2, c2.height * 2);
    };
    if (1 - fr > 0.002) up(n, 1 - fr, 10);
    if (fr > 0.002) up(n + 1, fr, 25);
    x.imageSmoothingEnabled = true; x.drawImage(m, 0, 0, rw, rh, rx, ry, rw, rh);
  }
  // rect: bare området rundt laget (i lerretspiksler) — mye raskere enn hele bildet
  function softBlur(x, buf, blur, rect) {
    // kan bildet leses? (ikke hvis en fil uten CORS er tegnet i det)
    if (!buf.__t) { try { buf.getContext('2d').getImageData(0, 0, 1, 1); } catch (e) { buf.__t = 1; BLUR.err = String(e && e.name || e); } }
    if (buf.__t) { BLUR.gpu++; gpuBlur(x, buf, blur, rect); return; }
    var rx = rect ? rect[0] : 0, ry = rect ? rect[1] : 0, rw = rect ? rect[2] : buf.width, rh = rect ? rect[3] : buf.height;
    var f = 1, cur = null, k = 0;
    // minst én halvering (raskt), og videre ned til radiusen er rundt 2–4 piksler
    while ((f === 1 && blur >= 1.2) || (blur / (f * 2) >= 1.1 && f < 32)) {
      var sw = cur ? cur.width : rw, sh = cur ? cur.height : rh;
      var c = prep(k++, Math.max(1, Math.ceil(sw / 2)), Math.max(1, Math.ceil(sh / 2)));
      if (cur) c.getContext('2d').drawImage(cur, 0, 0, sw / 2, sh / 2);
      else c.getContext('2d').drawImage(buf, rx, ry, rw, rh, 0, 0, rw / 2, rh / 2);
      cur = c; f *= 2;
    }
    if (!cur) { cur = prep(k++, rw, rh); cur.getContext('2d').drawImage(buf, rx, ry, rw, rh, 0, 0, rw, rh); }
    var w = cur.width, h = cur.height, n = w * h, g = cur.getContext('2d'), img;
    try { img = g.getImageData(0, 0, w, h); } catch (e) { pyr = []; BLUR.gpu++; BLUR.err = String(e && e.name || e); gpuBlur(x, buf, blur, rect); return; }
    BLUR.cpu++;
    var d = img.data;
    if (!fl || fl.n < n) fl = { n: n, ch: [0, 1, 2, 3].map(function () { return new Float32Array(n); }), tmp: new Float32Array(n) };
    var R = fl.ch[0], G = fl.ch[1], B = fl.ch[2], A = fl.ch[3], T = fl.tmp, p, q;
    // forhåndsmultipliser med alfa, så gjennomsiktige kanter ikke blir mørke
    for (p = 0, q = 0; p < n; p++, q += 4) { var a = d[q + 3] / 255; R[p] = d[q] * a; G[p] = d[q + 1] * a; B[p] = d[q + 2] * a; A[p] = d[q + 3]; }
    var sigma = Math.max(0.3, blur / f), bx = gaussBoxes(sigma);
    [R, G, B, A].forEach(function (ch) {
      for (var i = 0; i < 3; i++) { var r = Math.max(0, Math.round(bx[i])); if (!r) continue; boxH(ch, T, w, h, r); boxV(T, ch, w, h, r); }
    });
    for (p = 0, q = 0; p < n; p++, q += 4) {
      var al = A[p]; d[q + 3] = al;
      if (al > 0.5) { var inv = 255 / al; d[q] = R[p] * inv; d[q + 1] = G[p] * inv; d[q + 2] = B[p] * inv; } else { d[q] = d[q + 1] = d[q + 2] = 0; }
    }
    g.putImageData(img, 0, 0);
    // opp igjen i doble steg (myk, uten blokker)
    for (var j = k - 2; j >= 0; j--) {
      var up = prep(30 + j, pyr[j].width, pyr[j].height);
      up.getContext('2d').drawImage(cur, 0, 0, cur.width * 2, cur.height * 2); cur = up;
    }
    x.imageSmoothingEnabled = true; try { x.imageSmoothingQuality = 'low'; } catch (e) {}
    var up2 = f === 1 ? 1 : 2;   // etter oppskaleringen er bildet halv størrelse (eller fullt, hvis det ikke ble skalert ned)
    x.drawImage(cur, rx, ry, cur.width * up2, cur.height * up2);
  }
  function blit(x, buf, alpha, blur, rect) {
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = clamp(alpha, 0, 1);
    if (blur > 0.15) {
      if (FILTER) { BLUR.filter++; x.filter = 'blur(' + blur.toFixed(1) + 'px)'; x.drawImage(buf, 0, 0); x.filter = 'none'; }
      else softBlur(x, buf, blur, rect);
    } else x.drawImage(buf, 0, 0);
    x.restore();
  }

  // ---------- tid: inn, ut og faste bevegelser ----------
  function phase(l, tl) {
    var tIn = clamp(num(l.tIn, 0), 0, L), tOut = num(l.tOut, L), dur = Math.max(0.05, num(l.dur, 0.8));
    if (!(tOut > tIn)) tOut = L;
    tOut = Math.min(tOut, L);
    var o = { a: 1, s: 1, dx: 0, dy: 0, blur: 0, grow: 1, rot: 0 };
    var whole = tIn <= 0.001 && tOut >= L - 0.001;
    if (whole || reduceStatic) return o;
    var enter = l.enter || 'fade', exit = l.exit || 'fade';
    if (tl < tIn || tl > tOut) { o.a = 0; o.grow = 0; return o; }
    var pi = enter === 'none' || tIn <= 0.001 ? 1 : (tl - tIn) / dur;
    var po = exit === 'none' || tOut >= L - 0.001 ? 0 : (tl - (tOut - dur)) / dur;
    if (pi < 1) apply(o, enter, clamp(pi, 0, 1), true);
    if (po > 0) apply(o, exit, clamp(1 - po, 0, 1), false);
    return o;
  }
  // p: 0 = borte, 1 = helt inne
  function apply(o, kind, p, entering) {
    var U = unit * 120;
    // «tegnes på»: ringer, nettverk og mobiler bygges opp (og ned igjen) element for element
    if (kind === 'draw') { o.grow = Math.min(o.grow, p); o.a *= clamp(p * 6, 0, 1); return; }
    if (kind === 'none') return;
    if (kind === 'pop') { var k = entering ? eBack(p) : eOut(p); o.s *= Math.max(0, k); o.a *= clamp(p * 3, 0, 1); }
    else if (kind === 'scale') { o.s *= 0.55 + 0.45 * eOut(p); o.a *= eOut(p); }
    else if (kind === 'zoom') { o.s *= 1 + 0.6 * (1 - eOut(p)); o.a *= eOut(p); o.blur += (1 - sm(p)) * 14 * unit; }
    // uskarpheten avtar jevnt gjennom hele overgangen og flater rolig ut, i stedet for å bli skarp tidlig og så stoppe
    else if (kind === 'blur') { o.blur += Math.pow(1 - sm(p), 1.35) * 26 * unit; o.a *= sm(Math.min(1, p * 1.6)); }
    else if (kind === 'up') { o.dy += (1 - eOut(p)) * U; o.a *= sm(p * 1.4); }
    else if (kind === 'down') { o.dy -= (1 - eOut(p)) * U; o.a *= sm(p * 1.4); }
    else if (kind === 'left') { o.dx -= (1 - eOut(p)) * U; o.a *= sm(p * 1.4); }
    else if (kind === 'right') { o.dx += (1 - eOut(p)) * U; o.a *= sm(p * 1.4); }
    else if (kind === 'spin') { o.rot += (1 - eOut(p)) * Math.PI; o.s *= 0.4 + 0.6 * eOut(p); o.a *= sm(p * 1.5); }
    else o.a *= sm(p);   // fade
  }
  function motion(l, tl) {
    var ph = (num(l.seed, 1) * 1.37) % TAU;
    var turns = Math.round(num(l.spin, 0)), beats = Math.max(1, Math.round(num(l.beats, 2)));
    var m = { rot: turns ? TAU * turns * tl / L : 0, s: 1, dx: 0, dy: 0, blur: 0 };
    var pu = num(l.pulse, 0); if (pu) m.s *= 1 + pu * (0.5 - 0.5 * Math.cos(TAU * beats * tl / L));
    var zo = num(l.zoom, 0); if (zo) m.s *= 1 + zo * (0.5 - 0.5 * Math.cos(TAU * tl / L));
    var fl = num(l.float, 0); if (fl) { m.dx = fl * unit * 22 * wave(tl, 1, ph); m.dy = fl * unit * 16 * wave(tl, 2, ph * 1.7); m.rot += fl * 0.05 * wave(tl, 1, ph * 2.3); }
    var b = num(l.blur, 0) * unit, mode = l.blurMode || 'static';
    if (b > 0) {
      // «i starten» og «mot slutten» tones også rolig over skjøten, så uskarpheten ikke hopper når loopen starter på nytt
      var seam = Math.min(0.6, L * 0.08);
      if (mode === 'in') m.blur = b * Math.max(1 - sm(tl / (L * 0.45)), sm((tl - (L - seam)) / seam));
      else if (mode === 'out') m.blur = b * Math.max(sm((tl - L * 0.55) / (L * 0.45)), 1 - sm(tl / seam));
      else if (mode === 'inout') m.blur = b * Math.max(1 - sm(tl / (L * 0.3)), sm((tl - L * 0.7) / (L * 0.3)));
      else if (mode === 'pulse') m.blur = b * (0.5 - 0.5 * Math.cos(TAU * beats * tl / L));
      else m.blur = b;
    }
    return m;
  }

  // «Flytter seg»: fra (x, y) til (x2, y2) mens laget er synlig — eller fram og tilbake gjennom hele loopen
  function travel(l, tl) {
    if (!l.move) return [0, 0];
    var tIn = clamp(num(l.tIn, 0), 0, L), tOut = Math.min(num(l.tOut, L), L); if (!(tOut > tIn)) tOut = L;
    var whole = tIn <= 0.001 && tOut >= L - 0.001, ph = num(l.movePh, 0);
    var p = whole ? 0.5 - 0.5 * Math.cos(TAU * tl / L + ph) : sm((tl - tIn) / Math.max(0.05, tOut - tIn));
    if (l.moveEase === 'linear' && !whole) p = clamp((tl - tIn) / Math.max(0.05, tOut - tIn), 0, 1);
    return [(num(l.x2, num(l.x, 0.5)) - num(l.x, 0.5)) * W * p, (num(l.y2, num(l.y, 0.5)) - num(l.y, 0.5)) * H * p];
  }

  // ---------- chatbobler ----------
  var CHAT = {
    imessage: { me: '#0a84ff', meInk: '#ffffff', them: '#e9e9eb', themInk: '#000000' },
    whatsapp: { me: '#d9fdd3', meInk: '#111b21', them: '#ffffff', themInk: '#111b21' },
    messenger: { me: '#0084ff', meInk: '#ffffff', them: '#f0f0f0', themInk: '#050505', grad: ['#a033ff', '#0084ff'] },
    signal: { me: '#2c6bed', meInk: '#ffffff', them: '#e9e9e9', themInk: '#1b1b1b' },
    dark: { me: '#0a84ff', meInk: '#ffffff', them: '#2c2c30', themInk: '#f2f2f2' }
  };
  var CHATFONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
  function wrapLines(x, text, maxW) {
    var out = [];
    String(text).split('\\n').forEach(function (para) {
      var words = para.split(/\s+/), cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
        while (x.measureText(cur).width > maxW && cur.length > 1) { var k = cur.length - 1; while (k > 1 && x.measureText(cur.slice(0, k)).width > maxW) k--; out.push(cur.slice(0, k)); cur = cur.slice(k); }
      });
      out.push(cur);
    });
    return out;
  }
  function drawChat(x, l, o, tl) {
    var colW = num(l.size, 60) / 100 * S, fs = num(l.textSize, 30) * unit, lh = fs * 1.28, pad = fs * 0.62, gapY = fs * 0.4;
    var st = CHAT[l.chatStyle] || CHAT.imessage, gap = Math.max(0, num(l.gap, 0.9)), typing = !!l.typing;
    // sprett: 0 = glir mykt inn, 1 = tydelig sprett
    var bounce = clamp(num(l.bounce, 0.25), 0, 1), popDur = 0.45 + (1 - bounce) * 0.2;
    var pop = function (p) { p = clamp(p, 0, 1); if (!(bounce > 0)) return 0.85 + 0.15 * eOut(p); var c1 = 1.7 * bounce, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
    var msgs = String(l.msgs || '').split(/\r?\n/).map(function (s) { return s.replace(/\s+$/, ''); }).filter(function (s) { return s.trim(); });
    x.font = '400 ' + fs + 'px ' + CHATFONT; x.textBaseline = 'middle';
    var maxW = colW * 0.74 - pad * 2;
    var tIn = clamp(num(l.tIn, 0), 0, L), rel = tl - (tIn <= 0.001 ? 0 : tIn);
    var items = msgs.map(function (s, i) {
      var me = /^\s*>/.test(s), txt = s.replace(/^\s*[>]\s?/, '').replace(/^\s*<\s?/, '');
      var lines = wrapLines(x, txt, maxW), w = 0; lines.forEach(function (ln) { w = Math.max(w, x.measureText(ln).width); });
      var at = gap > 0 ? i * gap + 0.15 : 0, p = gap > 0 ? clamp((rel - at) / popDur, 0, 1) : 1;
      if (o.grow < 1) p = Math.min(p, clamp((o.grow * msgs.length - i), 0, 1));
      var ty = typing && !me && gap > 0 ? clamp((rel - (at - Math.min(0.9, gap * 0.8))) / 0.2, 0, 1) * (p < 1 ? 1 : 0) : 0;
      return { me: me, lines: lines, w: w + pad * 2, h: lines.length * lh + pad * 1.3, p: p, ty: ty, hadTyping: typing && !me && gap > 0 };
    });
    // høyden vokser jevnt når nye bobler kommer
    // høyden går jevnt fra «skriver …» (eller ingenting) til full boble, så resten ikke rykker
    var total = 0; items.forEach(function (it) {
      var typH = it.hadTyping ? fs * 2.2 : 0;
      it.cur = it.p > 0 ? typH + (it.h - typH) * sm(it.p) : (it.ty > 0 ? fs * 2.2 * sm(it.ty) : 0);
      it.k = it.p > 0 ? (it.hadTyping ? 1 : sm(it.p)) : (it.ty > 0 ? sm(it.ty) : 0);
      total += it.cur + gapY * it.k;
    });
    var y = l.anchor === 'bottom' ? -total + colW * 0.0 : 0, x0 = -colW / 2, x1 = colW / 2;
    if (l.anchor === 'center') y = -total / 2;
    items.forEach(function (it) {
      if (it.k <= 0) return;
      var h = it.p > 0 ? it.h : fs * 2.2, step = it.cur + gapY * it.k;
      if (it.p > 0) {
        // starter fra 60 % størrelse (ikke fra ingenting), så boblen ikke hopper fram
        var bx = it.me ? x1 - it.w : x0, by = y, sc = it.p < 1 ? 0.6 + 0.4 * pop(it.p) : 1;
        var ox = it.me ? x1 : x0, oy = by + h;
        x.save(); x.translate(ox, oy); x.scale(sc, sc); x.translate(-ox, -oy); x.globalAlpha *= sm(it.p * 2);
        if (l.shadow) { x.shadowColor = 'rgba(0,0,0,0.22)'; x.shadowBlur = fs * 0.8 * curScale(x); x.shadowOffsetY = fs * 0.15 * curScale(x); }
        var fill = it.me ? st.me : st.them;
        if (it.me && st.grad) { var g = x.createLinearGradient(0, by, 0, by + h); g.addColorStop(0, st.grad[0]); g.addColorStop(1, st.grad[1]); fill = g; }
        x.fillStyle = fill; rr(x, bx, by, it.w, h, Math.min(fs * 0.9, h / 2)); x.fill();
        x.shadowColor = 'transparent';
        // liten hale nederst
        x.beginPath();
        if (it.me) { x.moveTo(x1 - fs * 0.5, by + h - fs * 0.9); x.quadraticCurveTo(x1 - fs * 0.3, by + h, x1 + fs * 0.28, by + h); x.quadraticCurveTo(x1 - fs * 0.4, by + h - fs * 0.05, x1 - fs * 0.9, by + h - fs * 0.35); }
        else { x.moveTo(x0 + fs * 0.5, by + h - fs * 0.9); x.quadraticCurveTo(x0 + fs * 0.3, by + h, x0 - fs * 0.28, by + h); x.quadraticCurveTo(x0 + fs * 0.4, by + h - fs * 0.05, x0 + fs * 0.9, by + h - fs * 0.35); }
        x.fill();
        x.fillStyle = it.me ? st.meInk : st.themInk; x.textAlign = 'left';
        it.lines.forEach(function (ln, j) { x.fillText(ln, bx + pad, by + pad * 0.65 + lh * (j + 0.5)); });
        x.restore();
      }
      // «skriver …» tones ut mens svaret kommer, i stedet for å forsvinne brått
      var tyA = it.p > 0 ? (it.hadTyping ? 1 - sm(it.p * 2.5) : 0) : it.ty;
      if (tyA > 0.01) {
        var tw = fs * 3.4, th = fs * 2.2;
        x.save(); x.globalAlpha *= tyA; x.fillStyle = st.them; rr(x, x0, y, tw, th, th / 2); x.fill();
        for (var d = 0; d < 3; d++) { var b = 0.5 + 0.5 * Math.sin(tl * 9 - d * 0.9); x.fillStyle = st.themInk; x.globalAlpha *= 1; x.save(); x.globalAlpha *= 0.35 + 0.45 * b; x.beginPath(); x.arc(x0 + fs * (1 + d * 0.7), y + th / 2 - b * fs * 0.15, fs * 0.22, 0, TAU); x.fill(); x.restore(); }
        x.restore();
      }
      y += step;
    });
    return [colW, Math.max(total, fs * 2)];
  }

  // ---------- scener per lag (bygges når størrelsen endres) ----------
  var W = 0, H = 0, S = 1, unit = 1, scenes = {}, reduceStatic = false;
  function sceneOf(l) {
    var key = l.id + '|' + W + 'x' + H + '|' + [l.type, l.count, l.seed, l.size, l.hole, l.links, l.area, l.srcs, l.x, l.y].join(',');
    var sc = scenes[l.id];
    if (sc && sc.key === key) return sc;
    sc = { key: key };
    var R = rng(num(l.seed, 1) * 7919 + 13);
    if (l.type === 'network') {
      var n = clamp(Math.round(num(l.count, 40)), 3, 260), rad = num(l.size, 80) / 200 * S, hole = num(l.hole, 0) / 200 * S;
      var full = l.area === 'full', nodes = [], guard = 0;
      while (nodes.length < n && guard++ < n * 300) {
        var x, y;
        if (full) { x = (-0.04 + R() * 1.08) * W; y = (-0.04 + R() * 1.08) * H; }
        else { var a = R() * TAU, r = Math.sqrt(R()); x = Math.cos(a) * rad * r; y = Math.sin(a) * rad * r; }
        var cx0 = full ? num(l.x, 0.5) * W : 0, cy0 = full ? num(l.y, 0.5) * H : 0;
        if (Math.hypot(x - cx0, y - cy0) < hole) continue;
        var z = R();
        nodes.push({ x: x, y: y, z: z, ph: R() * TAU, ph2: R() * TAU, f1: 1 + Math.floor(R() * 2), f2: 1 + Math.floor(R() * 2), img: Math.floor(R() * 999), hot: R() < 0.18 });
      }
      // spre ut litt, så nodene ikke klumper seg
      var minD = Math.sqrt((full ? W * H : Math.PI * rad * rad) / n) * 0.55;
      for (var it = 0; it < 30; it++) for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var p = nodes[i], q = nodes[j], ddx = q.x - p.x, ddy = q.y - p.y, d = Math.hypot(ddx, ddy) || 0.01;
        if (d < minD) { var kk = (minD - d) / 2 * 0.5; p.x -= ddx / d * kk; p.y -= ddy / d * kk; q.x += ddx / d * kk; q.y += ddy / d * kk; }
      }
      var cx = full ? num(l.x, 0.5) * W : 0, cy = full ? num(l.y, 0.5) * H : 0, maxd = 1;
      nodes.forEach(function (p) { p.d = Math.hypot(p.x - cx, p.y - cy); maxd = Math.max(maxd, p.d); });
      nodes.forEach(function (p) { p.dn = p.d / maxd; });
      var edges = [], seen = {}, links = clamp(Math.round(num(l.links, 2)), 1, 5);
      nodes.forEach(function (p, i) {
        nodes.map(function (q, j) { return [j, Math.hypot(q.x - p.x, q.y - p.y)]; }).filter(function (e) { return e[0] !== i; })
          .sort(function (a, b) { return a[1] - b[1]; }).slice(0, links).forEach(function (e) {
            var j = e[0], id = i < j ? i + '-' + j : j + '-' + i; if (seen[id]) return; seen[id] = 1;
            edges.push({ a: i, b: j, c: 1 + Math.floor(R() * 3), ph: R(), pk: R() < 0.5 });
          });
      });
      sc.nodes = nodes; sc.edges = edges; sc.full = full; sc.maxd = maxd;
    } else if (l.type === 'phones') {
      var np = clamp(Math.round(num(l.count, 7)), 1, 24), area = num(l.size, 90) / 200 * S, phones = [];
      for (var k = 0; k < np; k++) {
        var best = null;
        for (var c = 0; c < 40; c++) {
          var ang = R() * TAU, rr2 = Math.sqrt(R()) * area, px = Math.cos(ang) * rr2 * (W / S > 1 ? Math.min(1.6, W / H) : 1), py = Math.sin(ang) * rr2 * (H / S > 1 ? Math.min(1.6, H / W) : 1) * 0.85;
          var dmin = 1e9; phones.forEach(function (o) { dmin = Math.min(dmin, Math.hypot(o.x - px, o.y - py)); });
          if (!best || dmin > best.d) best = { x: px, y: py, d: dmin };
        }
        phones.push({ x: best.x, y: best.y, z: k < Math.ceil(np * 0.35) ? 1 : 0.45 + R() * 0.4, ph: R() * TAU, tilt: (R() - 0.5) * 0.3, i: k });
      }
      phones.sort(function (a, b) { return a.z - b.z; });
      var pe = [], ps = {};
      phones.forEach(function (p, i) {
        phones.map(function (q, j) { return [j, Math.hypot(q.x - p.x, q.y - p.y)]; }).filter(function (e) { return e[0] !== i; })
          .sort(function (a, b) { return a[1] - b[1]; }).slice(0, 2).forEach(function (e) {
            var j = e[0], id = i < j ? i + '-' + j : j + '-' + i; if (ps[id]) return; ps[id] = 1; pe.push({ a: i, b: j, ph: R(), c: 1 + Math.floor(R() * 2) });
          });
      });
      // små noder mellom mobilene
      var dots = []; for (var q2 = 0; q2 < np * 3; q2++) { var a2 = R() * TAU, r3 = Math.sqrt(R()) * area * 1.25; dots.push({ x: Math.cos(a2) * r3 * 1.2, y: Math.sin(a2) * r3 * 0.9, ph: R() * TAU, z: 0.3 + R() * 0.5 }); }
      phones.forEach(function (p) { p.order = Math.hypot(p.x, p.y); });
      var byD = phones.slice().sort(function (a, b) { return a.order - b.order; });
      byD.forEach(function (p, i) { p.rank = i / Math.max(1, np - 1); });
      sc.phones = phones; sc.pedges = pe; sc.dots = dots;
    }
    scenes[l.id] = sc; return sc;
  }

  // ---------- tegning av hvert lag ----------
  var boxes = {};
  function drawMediaLayer(x, l, o) {
    var m = getMedia(l.src), box = num(l.size, 40) / 100 * S;
    var w = box, h = box;
    if (mready(m)) { var s = msize(m); if (s[0] >= s[1]) h = box * s[1] / s[0]; else w = box * s[0] / s[1]; }
    var shape = l.shape || 'none';
    if (shape === 'circle') { w = h = Math.min(w, h); }
    if (l.shadow) { x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 28 * unit * curScale(x); x.shadowOffsetY = 10 * unit * curScale(x); }
    if (shape === 'circle' || shape === 'round') {
      x.save();
      if (shape === 'circle') { x.beginPath(); x.arc(0, 0, w / 2, 0, TAU); } else rr(x, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
      if (l.shadow) { x.fillStyle = '#000'; x.fill(); x.shadowColor = 'transparent'; }
      x.clip();
      if (!drawCover(x, m, -w / 2, -h / 2, w, h) && C.__editor) { x.fillStyle = 'rgba(127,140,160,.35)'; x.fillRect(-w / 2, -h / 2, w, h); }
      x.restore();
    } else if (!(mready(m) && (x.drawImage(mel(m), -w / 2, -h / 2, w, h), true)) && C.__editor) {
      // tom ramme bare i forhåndsvisningen i editoren (aldri i embed eller eksportert video)
      x.shadowColor = 'transparent';
      x.strokeStyle = 'rgba(160,175,200,.6)'; x.lineWidth = 2 * unit; x.setLineDash([8 * unit, 6 * unit]); x.strokeRect(-w / 2, -h / 2, w, h); x.setLineDash([]);
    }
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    return [w, h];
  }
  function curScale(x) { try { var m = x.getTransform(); return Math.hypot(m.a, m.b); } catch (e) { return 1; } }

  function drawRing(x, l, o, tl) {
    var n = clamp(Math.round(num(l.count, 24)), 1, 120), R0 = num(l.size, 60) / 200 * S, isz = num(l.itemSize, 8) / 100 * S;
    var col = l.color || '#c9a24a', kind = l.shape2 || 'patron', imgs = srcList(l).map(getMedia).filter(mready);
    var orient = l.orient || 'out', grow = o.grow, rip = num(l.ripple, 0), beats = Math.max(1, Math.round(num(l.beats, 2)));
    if (l.ringLine) {
      x.strokeStyle = rgba(l.lineColor || col, 0.55); x.lineWidth = Math.max(1, num(l.lineW, 2) * unit);
      x.beginPath(); x.arc(0, 0, R0, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(grow * 1.05, 0, 1)); x.stroke();
    }
    for (var i = 0; i < n; i++) {
      var f = i / n, gi = clamp((grow - f * 0.92) / 0.08, 0, 1);   // tegnes på rundt sirkelen
      if (gi <= 0) continue;
      var ang = -Math.PI / 2 + f * TAU, px = Math.cos(ang) * R0, py = Math.sin(ang) * R0;
      var sc = gi < 1 ? eBack(gi) : 1;
      if (rip) { var ph = ((beats * tl / L - f) % 1 + 1) % 1; sc *= 1 + rip * Math.pow(Math.max(0, Math.cos(ph * TAU)), 12); }
      x.save(); x.translate(px, py);
      if (orient === 'out') x.rotate(ang + Math.PI / 2); else if (orient === 'in') x.rotate(ang - Math.PI / 2); else if (orient === 'tangent') x.rotate(ang + Math.PI);
      x.scale(sc, sc); x.globalAlpha *= clamp(gi * 2, 0, 1);
      if (imgs.length) { var m = imgs[i % imgs.length], s = msize(m), k = isz / Math.max(s[0], s[1]); x.drawImage(mel(m), -s[0] * k / 2, -s[1] * k / 2, s[0] * k, s[1] * k); }
      else { var sp = shapeSprite(kind, col); x.drawImage(sp, -isz / 2, -isz / 2, isz, isz); }
      x.restore();
    }
    return [R0 * 2 + isz, R0 * 2 + isz];
  }

  function drawNetwork(x, l, o, tl) {
    var sc = sceneOf(l), col = l.color || '#6fa8ff', glow = l.glow !== false, gs = glowSprite(col), grow = o.grow;
    var nsz = num(l.nodeSize, 1) * 7 * unit, motionAmt = num(l.motion, 1), style = l.nodeStyle || 'glow';
    var imgs = srcList(l).map(getMedia).filter(mready);
    var P = sc.nodes.map(function (p) {
      var a = clamp((grow * 1.15 - p.dn) / 0.15, 0, 1);
      return { x: p.x + wave(tl, p.f1, p.ph) * 14 * unit * motionAmt, y: p.y + wave(tl, p.f2, p.ph2) * 11 * unit * motionAmt, a: a, z: p.z };
    });
    if (sc.full) x.translate(-num(l.x, 0.5) * W, -num(l.y, 0.5) * H);
    x.lineCap = 'round';
    // pulsringer ut fra midten
    var rings = Math.round(num(l.rings, 2));
    if (rings > 0 && grow >= 1) for (var r = 0; r < rings; r++) {
      var u = ((tl / L * Math.max(1, Math.round(L / 3)) + r / rings) % 1), cx = sc.full ? num(l.x, 0.5) * W : 0, cy = sc.full ? num(l.y, 0.5) * H : 0;
      x.strokeStyle = rgba(col, 0.28 * (1 - u) * (1 - u)); x.lineWidth = 2 * unit; x.beginPath(); x.arc(cx, cy, num(l.hole, 0) / 200 * S + u * sc.maxd, 0, TAU); x.stroke();
    }
    var arrive = [];
    sc.edges.forEach(function (e) {
      var A = P[e.a], B = P[e.b], v = Math.min(A.a, B.a); if (v <= 0.01) return;
      var dz = (A.z + B.z) / 2, lw = (0.8 + dz * 0.9) * unit * num(l.lineW, 1.4);
      if (glow) { x.strokeStyle = rgba(col, 0.12 * v); x.lineWidth = lw * 4; x.beginPath(); x.moveTo(A.x, A.y); x.lineTo(B.x, B.y); x.stroke(); }
      x.strokeStyle = rgba(col, (0.3 + 0.35 * dz) * v); x.lineWidth = lw; x.beginPath(); x.moveTo(A.x, A.y); x.lineTo(B.x, B.y); x.stroke();
      if (l.packets !== false && e.pk && v > 0.98) {
        var uu = ((e.c * tl / L + e.ph) % 1), px = A.x + (B.x - A.x) * uu, py = A.y + (B.y - A.y) * uu, rr3 = 14 * unit * (0.6 + dz * 0.6);
        if (glow) x.drawImage(gs, px - rr3, py - rr3, rr3 * 2, rr3 * 2);
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(px, py, 1.8 * unit, 0, TAU); x.fill();
        if (uu > 0.88) arrive[e.b] = Math.max(arrive[e.b] || 0, (uu - 0.88) / 0.12);
      }
    });
    sc.nodes.forEach(function (p, i) {
      var q = P[i]; if (q.a <= 0.01) return;
      var pulse = p.hot ? 1 + 0.25 * (0.5 + 0.5 * wave(tl, 2, p.ph)) : 1, rad = nsz * (0.6 + p.z * 0.7) * (q.a < 1 ? eBack(q.a) : 1) * pulse * (1 + 0.3 * (arrive[i] || 0));
      var al = clamp(q.a * 1.5, 0, 1) * (0.55 + 0.45 * p.z);
      x.save(); x.globalAlpha *= al;
      if (style === 'person' || (style === 'images' && imgs.length)) {
        var R2 = rad * 2.6;
        if (glow) x.drawImage(gs, q.x - R2 * 1.6, q.y - R2 * 1.6, R2 * 3.2, R2 * 3.2);
        if (style === 'images') { x.save(); x.beginPath(); x.arc(q.x, q.y, R2, 0, TAU); x.clip(); drawCover(x, imgs[p.img % imgs.length], q.x - R2, q.y - R2, R2 * 2, R2 * 2); x.restore(); x.strokeStyle = col; x.lineWidth = 1.5 * unit; x.beginPath(); x.arc(q.x, q.y, R2, 0, TAU); x.stroke(); }
        else x.drawImage(shapeSprite('person', col), q.x - R2 * 1.1, q.y - R2 * 1.1, R2 * 2.2, R2 * 2.2);
      } else {
        if (glow) x.drawImage(gs, q.x - rad * 4, q.y - rad * 4, rad * 8, rad * 8);
        x.fillStyle = p.hot ? '#ffffff' : mix(col, '#ffffff', 0.55); x.beginPath(); x.arc(q.x, q.y, rad * 0.55, 0, TAU); x.fill();
      }
      x.restore();
    });
    return sc.full ? [W, H] : [num(l.size, 80) / 100 * S, num(l.size, 80) / 100 * S];
  }

  function drawPhones(x, l, o, tl) {
    var sc = sceneOf(l), col = l.color || '#6fa8ff', srcs = srcList(l).map(getMedia), grow = o.grow;
    var ph = num(l.phoneSize, 22) / 100 * S, motionAmt = num(l.motion, 1), gs = glowSprite(col);
    var P = sc.phones.map(function (p) {
      var a = clamp((grow * 1.2 - p.rank) / 0.2, 0, 1);
      return { x: p.x + wave(tl, 1, p.ph) * 12 * unit * motionAmt, y: p.y + wave(tl, 1, p.ph + 1.7) * 16 * unit * motionAmt, a: a };
    });
    if (l.net !== false) {
      x.lineCap = 'round';
      sc.dots.forEach(function (d) {
        if (grow <= 0.01) return;
        var dx = d.x + wave(tl, 1, d.ph) * 10 * unit, dy = d.y + wave(tl, 2, d.ph) * 8 * unit, rad = 5 * unit * d.z;
        x.save(); x.globalAlpha *= grow; x.drawImage(gs, dx - rad * 4, dy - rad * 4, rad * 8, rad * 8); x.restore();
      });
      sc.pedges.forEach(function (e) {
        var A = P[e.a], B = P[e.b], v = Math.min(A.a, B.a); if (v <= 0.01) return;
        x.strokeStyle = rgba(col, 0.45 * v); x.lineWidth = 1.5 * unit; x.beginPath(); x.moveTo(A.x, A.y); x.lineTo(B.x, B.y); x.stroke();
        var u = ((e.c * tl / L + e.ph) % 1), px = A.x + (B.x - A.x) * u, py = A.y + (B.y - A.y) * u, r = 12 * unit;
        x.save(); x.globalAlpha *= v; x.drawImage(gs, px - r, py - r, 2 * r, 2 * r); x.restore();
      });
    }
    sc.phones.forEach(function (p, i) {
      var q = P[i]; if (q.a <= 0.01) return;
      var h = ph * (0.55 + 0.45 * p.z) * (q.a < 1 ? eBack(q.a) : 1), w = h * 0.48, r = w * 0.17;
      x.save(); x.translate(q.x, q.y); x.rotate(p.tilt * 0.4 + wave(tl, 1, p.ph * 1.3) * 0.03 * motionAmt);
      x.globalAlpha *= clamp(q.a * 2, 0, 1);
      if (l.glowPh !== false) { x.save(); x.globalAlpha *= 0.5; x.drawImage(gs, -w * 1.4, -h * 0.9, w * 2.8, h * 1.8); x.restore(); }
      var g = x.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); g.addColorStop(0, '#2b3343'); g.addColorStop(0.4, '#0e1118'); g.addColorStop(1, '#06080c');
      x.fillStyle = g; rr(x, -w / 2, -h / 2, w, h, r); x.fill();
      x.strokeStyle = rgba(col, 0.55); x.lineWidth = 1.2 * unit; x.stroke();
      var m = srcs.length ? srcs[p.i % srcs.length] : null, ix = w * 0.05;
      x.save(); rr(x, -w / 2 + ix, -h / 2 + ix, w - 2 * ix, h - 2 * ix, r * 0.75); x.clip();
      if (!drawCover(x, m, -w / 2 + ix, -h / 2 + ix, w - 2 * ix, h - 2 * ix, 0.5, 0)) { var g2 = x.createLinearGradient(0, -h / 2, 0, h / 2); g2.addColorStop(0, rgba(col, 0.35)); g2.addColorStop(1, rgba(col, 0.08)); x.fillStyle = '#0b0f14'; x.fillRect(-w / 2, -h / 2, w, h); x.fillStyle = g2; x.fillRect(-w / 2, -h / 2, w, h); }
      if (p.z < 0.95) { x.fillStyle = 'rgba(0,0,0,' + (0.55 * (1 - p.z)).toFixed(3) + ')'; x.fillRect(-w / 2, -h / 2, w, h); }
      x.restore();
      x.fillStyle = '#000'; rr(x, -w * 0.15, -h / 2 + ix * 1.6, w * 0.3, h * 0.028, h * 0.014); x.fill();
      x.restore();
    });
    return [num(l.size, 90) / 100 * S * 1.3, num(l.size, 90) / 100 * S];
  }

  // tegner ett lag (ikke mappe) med transformasjon, inn/ut og faste bevegelser
  function drawLayer(x, l, tl, extraAlpha) {
    if (l.hidden) return;
    var o = phase(l, tl); if (o.a <= 0.003) return;
    var m = motion(l, tl), a = o.a * clamp(num(l.opacity, 1), 0, 1) * (extraAlpha == null ? 1 : extraAlpha);
    var blur = o.blur + m.blur;
    var target = x, buf = null;
    if (blur > 0.15) { buf = getBuf(cv.width, cv.height, TAINT[l.id]); target = buf.getContext('2d'); target.setTransform(x.getTransform()); }
    target.save();
    var tv = travel(l, tl), cx = num(l.x, 0.5) * W + tv[0], cy = num(l.y, 0.5) * H + tv[1], s = num(l.scale, 1) * o.s * m.s;
    target.translate(cx + o.dx + m.dx, cy + o.dy + m.dy);
    target.rotate((num(l.rot, 0)) * Math.PI / 180 + m.rot + o.rot);
    target.scale(s, s);
    if (!buf) target.globalAlpha *= a;
    var wh = [0, 0];
    if (l.type === 'image' || l.type === 'video') wh = drawMediaLayer(target, l, o);
    else if (l.type === 'ring') wh = drawRing(target, l, o, tl);
    else if (l.type === 'network') wh = drawNetwork(target, l, o, tl);
    else if (l.type === 'phones') wh = drawPhones(target, l, o, tl);
    else if (l.type === 'chat') wh = drawChat(target, l, o, tl);
    target.restore();
    var bb = boxes[l.id] = l.type === 'chat' ? { x: cx, y: cy + (l.anchor === 'bottom' ? -wh[1] / 2 : l.anchor === 'center' ? 0 : wh[1] / 2) * s, w: wh[0] * s, h: wh[1] * s } : { x: cx, y: cy, w: wh[0] * s, h: wh[1] * s };
    if (buf) {
      // område rundt laget (rotasjonssikkert), bare når laget ligger rett på lerretet (ikke inni en mappe)
      var T = x.getTransform(), rect = null;
      if (!FILTER && l.type !== 'network' && Math.abs(T.b) < 1e-6 && Math.abs(T.c) < 1e-6 && Math.abs(T.e) < 0.5 && Math.abs(T.f) < 0.5) {
        var k2 = T.a, rad = (Math.hypot(bb.w, bb.h) / 2 + blur * 3 + 12) * k2, ccx = (bb.x + o.dx + m.dx) * k2, ccy = (bb.y + o.dy + m.dy) * k2;
        var x0 = Math.max(0, Math.floor(ccx - rad)), y0 = Math.max(0, Math.floor(ccy - rad)), x1 = Math.min(cv.width, Math.ceil(ccx + rad)), y1 = Math.min(cv.height, Math.ceil(ccy + rad));
        if (x1 - x0 > 2 && y1 - y0 > 2) rect = [x0, y0, x1 - x0, y1 - y0];
      }
      blit(x, buf, a, blur * dpr, rect); if (buf.__t) TAINT[l.id] = 1; freeBuf(buf);
    }
  }
  function drawGroup(x, g, tl) {
    if (g.hidden) return;
    var o = phase(g, tl); if (o.a <= 0.003) return;
    var m = motion(g, tl), a = o.a * clamp(num(g.opacity, 1), 0, 1), blur = o.blur + m.blur;
    var buf = getBuf(cv.width, cv.height, TAINT[g.id]), b = buf.getContext('2d');
    b.setTransform(x.getTransform());
    var gt = travel(g, tl), cx = num(g.x, 0.5) * W, cy = num(g.y, 0.5) * H, s = num(g.scale, 1) * o.s * m.s;
    b.translate(gt[0], gt[1]);
    b.translate(cx + o.dx + m.dx, cy + o.dy + m.dy); b.rotate(num(g.rot, 0) * Math.PI / 180 + m.rot + o.rot); b.scale(s, s); b.translate(-cx, -cy);
    layers.forEach(function (l) { if (l.group === g.id && l.type !== 'group') drawLayer(b, l, tl); });
    blit(x, buf, a, blur * dpr); if (buf.__t) TAINT[g.id] = 1; freeBuf(buf);
    boxes[g.id] = { x: cx + gt[0], y: cy + gt[1], w: S * 0.2, h: S * 0.2, group: true };
  }
  function drawBg(x, tl) {
    var bg = C.bg || {}, t = bg.type || 'color';
    if (t === 'none') return;
    if (!bgVid) x.fillStyle = bg.color || '#06080c', x.fillRect(0, 0, W, H);
    if ((t === 'image' || t === 'video') && bg.src && !bgVid) {
      var m = getMedia(bg.src), b = num(bg.blur, 0) * unit;
      if (b > 0.4) { var buf = getBuf(cv.width, cv.height, TAINT.__bg), bx = buf.getContext('2d'); bx.setTransform(x.getTransform()); var pad = b * 2; drawCover(bx, m, -pad, -pad, W + pad * 2, H + pad * 2); blit(x, buf, 1, b * dpr); if (buf.__t) TAINT.__bg = 1; freeBuf(buf); }
      else drawCover(x, m, 0, 0, W, H);
    }
    if (bg.glow) {
      var g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
      g.addColorStop(0, rgba(bg.glowColor || '#3a7bff', 0.28 * (0.85 + 0.15 * wave(tl, 1, 0)))); g.addColorStop(1, rgba(bg.glowColor || '#3a7bff', 0));
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    var dim = clamp(num(bg.dim, 0), 0, 0.95); if (dim > 0) { x.fillStyle = 'rgba(0,0,0,' + dim + ')'; x.fillRect(0, 0, W, H); }
    if (bg.vignette) {
      var v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
  }

  // ---------- hele bildet ----------
  var dpr = 1;
  function setSize(w, h, d) {
    dpr = d || 1;
    var pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    W = w; H = h; S = Math.min(W, H); unit = S / 1000;
    if (bgVid) {
      var vb = num((C.bg || {}).blur, 0) * unit;
      bgVid.style.filter = vb > 0.4 ? 'blur(' + vb.toFixed(1) + 'px)' : '';
      bgVid.style.transform = vb > 0.4 ? 'scale(' + (1 + vb * 4 / Math.max(1, S)).toFixed(4) + ')' : '';
    }
  }
  function draw(t, opts) {
    opts = opts || {};
    L = Math.max(1, +C.loop || 8); layers = C.layers || [];
    var tl = ((t % L) + L) % L;
    boxes = {};
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; try { ctx.filter = 'none'; } catch (e) {}
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!opts.noBg) drawBg(ctx, tl);
    layers.forEach(function (l) {
      if (l.type === 'group') drawGroup(ctx, l, tl);
      else if (!l.group || !layers.some(function (g) { return g.type === 'group' && g.id === l.group; })) drawLayer(ctx, l, tl);
    });
  }

  // ---------- API for editoren og eksporten ----------
  var raf = 0, playing = false, visible = false, clock = 0, last = 0;
  function kick() { if (!C.__manual && !raf && (visible || !playing)) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (playing && visible) clock += dt;
    draw(reduce ? num(C.posterT, L * 0.5) : clock);
    if (playing && visible && !reduce) raf = requestAnimationFrame(frame); else last = 0;
  }
  function seekVideos(t, cb) {
    var left = videos.length; if (!left) { cb(); return; }
    videos.forEach(function (v) {
      var d = v.duration || 0, target = d ? (t % d) : 0, fin = false;
      var end = function () { if (fin) return; fin = true; v.removeEventListener('seeked', end); if (--left <= 0) cb(); };
      try { v.pause(); } catch (e) {}
      if (!d || Math.abs(v.currentTime - target) < 0.001) { end(); return; }
      v.addEventListener('seeked', end); setTimeout(end, 3000);
      try { v.currentTime = target; } catch (e) { end(); }
    });
  }
  var api = {
    draw: draw, setSize: setSize, boxes: function () { return boxes; }, loop: function () { return L; }, config: C,
    ready: function (fn) { if (!pending) fn(); else onReady.push(fn); },
    seekVideos: seekVideos,
    blurInfo: function () { return { metode: FILTER ? 'innebygd' : 'utregnet', innebygd: BLUR.filter, utregnet: BLUR.cpu, reserve: BLUR.gpu, feil: BLUR.err }; },
    failed: function () { return Object.keys(media).filter(function (k) { return !media[k].ok; }); },
    hasVideo: function () { return videos.length > 0; },
    playVideos: function () { wantPlay = true; videos.forEach(playOne); },
    pauseVideos: function () { wantPlay = false; videos.forEach(function (v) { try { v.pause(); } catch (e) {} }); },
    destroy: function () { if (raf) cancelAnimationFrame(raf); raf = 0; videos.forEach(function (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }); if (holder && holder.parentNode) holder.parentNode.removeChild(holder); if (bgVid && bgVid.parentNode) bgVid.parentNode.removeChild(bgVid); },
    canvas: cv
  };
  if (C.__manual) return api;

  // ---------- embed: størrelse, start ved synlighet, pause utenfor skjermen ----------
  function resize() {
    var r = root.getBoundingClientRect();
    setSize(Math.max(1, r.width), Math.max(1, r.height), Math.min(2, window.devicePixelRatio || 1));
    if (!raf) raf = requestAnimationFrame(frame);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(root); else window.addEventListener('resize', resize);
  resize();
  playing = true;
  var started = C.trigger === 'always';
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        visible = e.isIntersecting && (started || e.intersectionRatio >= 0.35);
        if (visible) started = true;
        if (visible && !reduce) api.playVideos(); else api.pauseVideos();
        if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
      });
    }, { threshold: [0, 0.35] }).observe(root);
  } else { visible = true; api.playVideos(); }
  if (reduce) { api.pauseVideos(); }
  // blokkert autoplay (lav strømmodus på iPhone): første trykk på siden starter videoene
  if (videos.length && !reduce) {
    var unlock = function () {
      if (!wantPlay) return;
      videos.forEach(playOne);
      document.removeEventListener('touchend', unlock); document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchend', unlock, { passive: true }); document.addEventListener('click', unlock);
  }
  return api;
}
