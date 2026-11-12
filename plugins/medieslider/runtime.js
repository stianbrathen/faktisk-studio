// Faktisk Studio · Medieslider — kjøretid for embedden
//
// fmsRun(root, opts) kopieres inn i embedden med toString(), og den samme
// funksjonen kjører i forhåndsvisningen i Studio (opts.preview = true, uten måling).
// Skrevet i ES5 og uten globale DOM-oppslag: alt søkes fra embeddens rot,
// slik at flere embeds kan stå på samme side.
//
// - Slideren er ferdig rendret HTML (kort med bilde/stillbilde og tekst). Uten
//   skript virker den som en vanlig rad med bilder og lenker.
// - Tre visninger (D.mode):
//   «lightbox»: trykk åpner elementet over hele skjermen med dempet bakgrunn
//               (<dialog> på øverste lag). Bla sidelengs med sveip, piler eller tastatur.
//   «expand»:   trykk spretter elementet opp i rimelig størrelse over siden
//               (hvitt kort med skygge, maks ~860 px, aldri forstørret), midt
//               over slideren og innenfor skjermen. Siden bak dempes ikke.
//   «none»:     bare slideren; videoer spilles av i kortet.
// - Video lastes først når den vises stort (preload none/metadata).
// - Bare én avspilling om gangen: «fkpod:play» på window pauser podkast-,
//   video- og medieslidere, og omvendt.
// - Måling: Fathom («<tittel>: <hendelse>»), dataLayer hvis den finnes, og «fkms:track».
// - I Labrador-editoren (window.lab_api) gjør skriptet ingenting.

/* eslint-disable no-var */
function fmsRun(root, opts) {
  if (!root) return;
  // 0.1.3: kort med data-fms-src/-poster lastes først når slideren nærmer seg
  // skjermen (600 px) OG kortet er innen ca. halvannen sporbredde fra synsfeltet.
  // Kjører også i Labrador-redigeringen, så alle bildene vises der.
  if (!root.__fmsLazy) {
    root.__fmsLazy = true;
    var lazy = root.querySelectorAll('[data-fms-src],[data-fms-poster]');
    var reveal = function (m) {
      var s = m.getAttribute('data-fms-src'), p = m.getAttribute('data-fms-poster');
      if (s) { m.removeAttribute('data-fms-src'); m.src = s; }
      if (p) { m.removeAttribute('data-fms-poster'); m.poster = p; }
    };
    if (lazy.length) {
      if (!('IntersectionObserver' in window)) {
        for (var z = 0; z < lazy.length; z++) reveal(lazy[z]);
      } else {
        var trk = root.querySelector('.fms-track');
        var inner = null;
        var outer = new IntersectionObserver(function (es) {
          var near = false;
          for (var e = 0; e < es.length; e++) if (es[e].isIntersecting) near = true;
          if (!near || inner) return;
          outer.disconnect();
          inner = new IntersectionObserver(function (xs) {
            for (var x = 0; x < xs.length; x++) {
              if (xs[x].isIntersecting) { inner.unobserve(xs[x].target); reveal(xs[x].target); }
            }
          }, { root: trk, rootMargin: '0px 150% 0px 150%' });
          for (var y = 0; y < lazy.length; y++) inner.observe(lazy[y]);
        }, { rootMargin: '600px 0px 600px 0px' });
        outer.observe(root);
      }
    }
  }
  if (root.__fms) return;
  opts = opts || {};
  if (window.lab_api && !opts.preview) return;
  var dataEl = root.querySelector('.fms-data');
  var D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var V = D.items || [];
  if (!V.length) return;
  root.__fms = true;

  var me = 'fms' + Math.random().toString(36).slice(2, 10);
  // Fokus tilbake til kortet bare når vinduet ble åpnet med tastaturet.
  // Etter trykk/klikk ville nettleseren (særlig Safari på iPhone) ellers vise
  // fokusrammen rundt kortet når vinduet lukkes.
  var viaKey = false;
  var MODE = D.mode === 'expand' || D.mode === 'none' ? D.mode : 'lightbox';
  var LABEL = D.linkLabel || 'Se originalen';
  var NAME = D.title || 'Medieslider';
  var q = function (s) { return root.querySelector(s); };
  var qa = function (s) { return root.querySelectorAll(s); };
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (x) {}

  function track(name, extra) {
    if (opts.preview) return;
    var p = { boks: NAME };
    for (var k in (extra || {})) p[k] = extra[k];
    try { if (window.dataLayer && window.dataLayer.push) { var o = { event: 'medieslider_' + name }; for (var k2 in p) o[k2] = p[k2]; window.dataLayer.push(o); } } catch (x) {}
    // faktisk.no måler med Fathom (og Kilkaya), ikke Google Tag Manager
    try {
      if (window.fathom && window.fathom.trackEvent) {
        window.fathom.trackEvent(NAME + ': ' + name + (p.element ? ' – ' + p.element : ''));
      }
    } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('fkms:track', { detail: { name: name, params: p } })); } catch (x) {}
  }
  function label(i) { var v = V[i] || {}; return (v.cap || v.alt || ('Element ' + (i + 1))).slice(0, 80); }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  var ICON = {
    close: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>'
  };

  // Én avspilling om gangen, også på tvers av embeds
  function announce(video) {
    video.addEventListener('play', function () {
      try { window.dispatchEvent(new CustomEvent('fkpod:play', { detail: { src: me } })); } catch (x) {}
      track('spilt', { element: label(parseInt(video.getAttribute('data-i'), 10)) });
    });
  }
  function pauseAll(except) {
    var vids = root.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) if (vids[i] !== except) { try { vids[i].pause(); } catch (x) {} }
  }
  window.addEventListener('fkpod:play', function (ev) {
    if (ev.detail && ev.detail.src !== me) pauseAll(null);
  });

  // ------------------------------------------------------------------
  //  Slideren på siden
  // ------------------------------------------------------------------
  var rail = q('.fms-track');
  var prevBtn = q('.fms-arrow--prev');
  var nextBtn = q('.fms-arrow--next');
  var nav = q('.fms-nav');
  var raf = 0;

  function arrows() {
    raf = 0;
    if (!rail || !prevBtn || !nextBtn) return;
    var max = rail.scrollWidth - rail.clientWidth - 2;
    if (nav) nav.style.display = max > 0 ? '' : 'none';
    prevBtn.disabled = rail.scrollLeft <= 2;
    nextBtn.disabled = rail.scrollLeft >= max;
  }
  function arrowsSoon() { if (!raf) raf = (window.requestAnimationFrame || setTimeout)(arrows); }
  // Bla én «side»: neste starter med venstrekanten på første kort som ikke
  // var helt synlig, forrige går tilbake så mange kort som får plass — uansett
  // hvor bred spalten er. (Før: fast 85 prosent av bredden, som kunne stoppe
  // midt inne i et kort.)
  function page(dir) {
    if (!rail) return;
    var items = rail.querySelectorAll('.fms-item');
    if (!items.length) return;
    var cs = window.getComputedStyle(rail);
    var vr = rail.getBoundingClientRect();
    var left = vr.left + (parseFloat(cs.paddingLeft) || 0);
    var right = vr.right - (parseFloat(cs.paddingRight) || 0);
    var k, r, target = null;
    if (dir > 0) {
      for (k = 0; k < items.length; k++) {
        r = items[k].getBoundingClientRect();
        if (r.right > right + 1 && r.left > left + 1) { target = items[k]; break; }
      }
      if (!target) target = items[items.length - 1];
    } else {
      var first = 0;
      for (k = 0; k < items.length; k++) { if (items[k].getBoundingClientRect().left >= left - 1) { first = k; break; } }
      if (first <= 0) target = items[0];
      else {
        var end = items[first - 1].getBoundingClientRect().right, j = first - 1;
        while (j > 0 && end - items[j - 1].getBoundingClientRect().left <= (right - left) + 1) j--;
        target = items[j];
      }
    }
    var dx = target.getBoundingClientRect().left - left;
    if (Math.abs(dx) < 1) return;
    try { rail.scrollBy({ left: dx, behavior: reduce ? 'auto' : 'smooth' }); }
    catch (x) { rail.scrollLeft += dx; }
  }
  if (rail) {
    rail.addEventListener('scroll', arrowsSoon, { passive: true });
    window.addEventListener('resize', arrowsSoon);
    if (prevBtn) prevBtn.addEventListener('click', function () { page(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { page(1); });
    arrows();
    setTimeout(arrows, 600);
  }

  // Videoer som spilles i kortet («none»)
  var inline = qa('.fms-media video');
  for (var iv = 0; iv < inline.length; iv++) announce(inline[iv]);

  // Lenkene under kortene
  var links = qa('.fms-link');
  for (var il = 0; il < links.length; il++) {
    (function (a) {
      a.addEventListener('click', function () { track('lenke', { element: label(parseInt(a.getAttribute('data-i'), 10)), lenke: parseInt(a.getAttribute('data-l') || '1', 10) }); });
    })(links[il]);
  }

  if (MODE === 'none') return;

  var opens = qa('.fms-open');
  for (var c = 0; c < opens.length; c++) {
    (function (a) {
      a.addEventListener('click', function (ev) {
        if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        var i = parseInt(a.getAttribute('data-i'), 10);
        if (!(i >= 0 && i < V.length)) return;
        ev.preventDefault();
        viaKey = ev.detail === 0;
        if (MODE === 'expand') openStage(i, a); else openBox(i, a);
      });
    })(opens[c]);
  }

  // Ett element stort: bilde eller video (+ tekst). Brukes av begge visningene.
  function figure(v, i, cls) {
    var f = el('figure', cls);
    f.setAttribute('data-i', String(i));
    var m = el('div', 'fms-big');
    if (v.t === 'v') {
      var vid = el('video');
      vid.setAttribute('controls', '');
      vid.setAttribute('playsinline', '');
      vid.setAttribute('webkit-playsinline', '');
      vid.setAttribute('preload', 'none');
      vid.setAttribute('data-i', String(i));
      if (v.poster) vid.setAttribute('poster', v.poster);
      if (v.w && v.h) { vid.setAttribute('width', v.w); vid.setAttribute('height', v.h); }
      vid.setAttribute('aria-label', v.alt || v.cap || ('Video ' + (i + 1)));
      vid.setAttribute('data-src', v.src);
      announce(vid);
      m.appendChild(vid);
    } else {
      var img = el('img');
      img.alt = v.alt || '';
      img.setAttribute('decoding', 'async');
      if (v.w && v.h) { img.setAttribute('width', v.w); img.setAttribute('height', v.h); }
      img.setAttribute('data-src', v.src);
      m.appendChild(img);
    }
    if (v.t === 'v') f.appendChild(m);
    else f.appendChild(zoomable(m, v, i));
    if (v.cap || v.credit || v.date || v.link || v.link2) {
      var cap = el('figcaption', 'fms-bigcap');
      if (v.cap) { var p = el('p', 'fms-bigtext'); p.textContent = v.cap; cap.appendChild(p); }
      var meta = el('p', 'fms-bigmeta');
      if (v.credit) meta.appendChild(document.createTextNode(v.credit));
      if (v.date) { if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · ')); meta.appendChild(document.createTextNode(v.dateText || v.date)); }
      // 0.1.4: inntil to lenker. Én lenke står på linja med kilde/dato, to får egen linje.
      var LL = [];
      if (v.link) LL.push([v.link, v.l1 || LABEL, 1]);
      if (v.link2) LL.push([v.link2, v.l2 || LABEL, 2]);
      var lrow = LL.length > 1 ? el('p', 'fms-bigmeta fms-biglinks') : meta;
      for (var li = 0; li < LL.length; li++) {
        (function (L) {
          if (lrow.childNodes.length) lrow.appendChild(document.createTextNode(' · '));
          var a = el('a');
          a.href = L[0]; a.target = '_blank'; a.rel = 'noopener';
          a.textContent = L[1] + ' ↗';
          a.addEventListener('click', function () { pauseAll(null); track('lenke', { element: label(i), lenke: L[2] }); });
          lrow.appendChild(a);
        })(LL[li]);
      }
      if (meta.childNodes.length) cap.appendChild(meta);
      if (lrow !== meta && lrow.childNodes.length) cap.appendChild(lrow);
      f.appendChild(cap);
    }
    return f;
  }
  // ---------- Forstørre bildet (skjermbilder med liten tekst på mobil) ----------
  // Trykk på bildet (eller forstørrelsesknappen) viser det i inntil 3 ganger
  // størrelsen – aldri større enn fila – i et felt man kan dra/rulle rundt i.
  // Trykk igjen (eller knappen) for å gå tilbake. Mens bildet er forstørret,
  // flytter dra bildet i stedet for å bla til neste.
  var ZOOM_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2z"/></svg>';
  var UNZOOM_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7 9h6v2H7z"/></svg>';
  function zoomable(m, v, i) {
    var wrap = el('div', 'fms-zwrap');
    wrap.appendChild(m);
    var img = m.querySelector('img');
    var btn = el('button', 'fms-zbtn', ZOOM_ICON);
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Forstørr bildet');
    wrap.appendChild(btn);
    // Knappen vises bare når det er noe å hente på å forstørre
    img.addEventListener('load', function () {
      if (img.naturalWidth > img.clientWidth * 1.3) wrap.classList.add('can-zoom');
    });
    function zoomIn(cx, cy) {
      var r = img.getBoundingClientRect();
      if (!r.width) return;
      var fx = cx == null ? 0.5 : Math.max(0, Math.min(1, (cx - r.left) / r.width));
      var fy = cy == null ? 0.3 : Math.max(0, Math.min(1, (cy - r.top) / r.height));
      var zw = Math.min(img.naturalWidth || r.width * 3, r.width * 3);
      zw = Math.max(zw, r.width * 1.5);
      var zh = zw * r.height / r.width;
      // Feltet: hele bredden som er tilgjengelig og det meste av høyden
      var host = wrap.closest('.fms-slide') || wrap.closest('.fms-stage') || wrap.parentNode;
      var W = Math.min(host.clientWidth || r.width, window.innerWidth) - (wrap.closest('.fms-stage') ? 20 : 0);
      var H = Math.min(Math.round(window.innerHeight * 0.72), Math.max(r.height, zh));
      m.style.width = Math.round(W) + 'px';
      m.style.height = Math.round(H) + 'px';
      wrap.classList.add('is-zoom');
      // Fullskjermvisningen: lås blaingen mens bildet er forstørret, så dra
      // (også ut mot kanten) bare flytter bildet
      var fd = wrap.closest('.fms-feed');
      if (fd) fd.classList.add('is-zoomed');
      img.style.width = Math.round(zw) + 'px';
      img.style.height = Math.round(zh) + 'px';
      m.scrollLeft = Math.max(0, fx * zw - W / 2);
      m.scrollTop = Math.max(0, fy * zh - H / 2);
      btn.innerHTML = UNZOOM_ICON;
      btn.setAttribute('aria-label', 'Tilbake til vanlig størrelse');
      if (stage && sOpen) placeStage();
      track('forstørret', { element: label(i) });
    }
    function zoomOut() {
      wrap.classList.remove('is-zoom');
      var fd = wrap.closest('.fms-feed');
      if (fd) fd.classList.remove('is-zoomed');
      m.style.width = m.style.height = img.style.width = img.style.height = '';
      btn.innerHTML = ZOOM_ICON;
      btn.setAttribute('aria-label', 'Forstørr bildet');
      if (stage && sOpen) placeStage();
    }
    wrap.__unzoom = zoomOut;
    img.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains('is-zoom')) zoomOut();
      else if (wrap.classList.contains('can-zoom')) zoomIn(ev.clientX, ev.clientY);
    });
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (wrap.classList.contains('is-zoom')) zoomOut(); else zoomIn(null, null);
    });
    return wrap;
  }
  function unzoomIn(node) {
    var z = node && node.querySelectorAll ? node.querySelectorAll('.fms-zwrap.is-zoom') : [];
    for (var k = 0; k < z.length; k++) if (z[k].__unzoom) z[k].__unzoom();
  }

  // Last inn bildet/videoen først når elementet vises
  function load(f) {
    if (!f || f.__loaded) return;
    f.__loaded = true;
    var m = f.querySelector('[data-src]');
    if (m) m.src = m.getAttribute('data-src');
  }
  function playIfVideo(f, gesture) {
    var vid = f && f.querySelector('video');
    if (!vid || !gesture) return;
    var p;
    try { p = vid.play(); } catch (x) {}
    if (p && p['catch']) p['catch'](function () {});
  }

  // ------------------------------------------------------------------
  //  «lightbox»: hele skjermen med dempet bakgrunn
  // ------------------------------------------------------------------
  var dlg = null, feed = null, figs = [], counter = null, bPrev = null, bNext = null;
  var cur = -1, opener = null, io = null, htmlOverflow = '', isOpen = false;

  function buildBox() {
    dlg = el('dialog', 'fms-dlg');
    dlg.setAttribute('aria-label', NAME);
    feed = el('div', 'fms-feed');
    feed.setAttribute('tabindex', '-1');
    for (var i = 0; i < V.length; i++) {
      var s = el('div', 'fms-slide');
      s.setAttribute('data-i', String(i));
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', (i + 1) + ' av ' + V.length);
      var f = figure(V[i], i, 'fms-fig');
      s.appendChild(f);
      // Klikk på den dempede flaten rundt lukker
      s.addEventListener('click', function (ev) { if (ev.target === this) shutBox(); });
      feed.appendChild(s);
      figs.push(f);
    }
    var ui = el('div', 'fms-ui');
    counter = el('p', 'fms-count');
    counter.setAttribute('aria-live', 'polite');
    var closeBtn = el('button', 'fms-btn fms-close', ICON.close);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Lukk');
    closeBtn.addEventListener('click', shutBox);
    bPrev = el('button', 'fms-btn fms-prev', ICON.prev);
    bPrev.type = 'button';
    bPrev.setAttribute('aria-label', 'Forrige');
    bPrev.addEventListener('click', function () { goBox(cur - 1); });
    bNext = el('button', 'fms-btn fms-next', ICON.next);
    bNext.type = 'button';
    bNext.setAttribute('aria-label', 'Neste');
    bNext.addEventListener('click', function () { goBox(cur + 1); });
    ui.appendChild(counter);
    ui.appendChild(closeBtn);
    ui.appendChild(bPrev);
    ui.appendChild(bNext);
    dlg.appendChild(feed);
    dlg.appendChild(ui);
    root.appendChild(dlg);

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        for (var e = 0; e < es.length; e++) {
          if (es[e].isIntersecting && es[e].intersectionRatio >= 0.6) activateBox(parseInt(es[e].target.getAttribute('data-i'), 10));
        }
      }, { root: feed, threshold: [0.6] });
    } else {
      feed.addEventListener('scroll', function () {
        activateBox(Math.round(feed.scrollLeft / (feed.clientWidth || 1)));
      }, { passive: true });
    }
    dlg.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowRight' || k === 'PageDown') { ev.preventDefault(); goBox(cur + 1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { ev.preventDefault(); goBox(cur - 1); }
      else if ((k === 'Escape' || k === 'Esc') && !dlg.showModal) { shutBox(); }
    });
    dlg.addEventListener('close', onBoxClosed);
  }

  function activateBox(i) {
    if (!(i >= 0 && i < V.length) || i === cur) return;
    cur = i;
    pauseAll(null);
    unzoomIn(feed);
    load(figs[i]); load(figs[i + 1]); load(figs[i - 1]);
    counter.textContent = (i + 1) + ' / ' + V.length;
    bPrev.disabled = i === 0;
    bNext.disabled = i === V.length - 1;
  }

  function goBox(i) {
    if (!(i >= 0 && i < V.length)) return;
    var left = i * feed.clientWidth;
    try { feed.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' }); }
    catch (x) { feed.scrollLeft = left; }
    activateBox(i);
  }

  function openBox(i, from) {
    if (!dlg) buildBox();
    if (isOpen) return;
    isOpen = true;
    opener = from || document.activeElement;
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (dlg.showModal) { try { dlg.showModal(); } catch (x) { dlg.setAttribute('open', ''); } }
    else dlg.setAttribute('open', '');
    feed.scrollLeft = i * feed.clientWidth;
    cur = -1;
    activateBox(i);
    // Trykket på et videokort: start videoen (trykket gjør at lyd er lov)
    playIfVideo(figs[i], true);
    if (io) for (var s = 0; s < figs.length; s++) io.observe(figs[s].parentNode);
    try { feed.focus({ preventScroll: true }); } catch (x) { feed.focus(); }
    track('åpnet', { element: label(i) });
  }

  function shutBox() {
    if (!dlg) return;
    if (dlg.close && dlg.open) dlg.close();
    else { dlg.removeAttribute('open'); onBoxClosed(); }
  }

  function onBoxClosed() {
    if (!isOpen) return;
    isOpen = false;
    if (io) io.disconnect();
    pauseAll(null);
    cur = -1;
    document.documentElement.style.overflow = htmlOverflow;
    if (viaKey && opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (x) {} }
    else if (document.activeElement && document.activeElement.blur && root.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (x) {} }
  }

  // ------------------------------------------------------------------
  //  «expand»: spretter opp i rimelig størrelse over siden
  // ------------------------------------------------------------------
  // Et hvitt kort med skygge som ser ut til å løfte seg ut av slideren.
  // Størrelsen er begrenset (bildet maks ~860 × 68 % av skjermhøyden, og
  // aldri forstørret over originalen), og kortet legges midt over slideren,
  // klemt innenfor skjermen. Siden bak er ikke dempet og kan brukes som før;
  // klikk utenfor, Esc eller × lukker. Med Popover-API-et ligger kortet på
  // øverste lag (klippes ikke av foreldre med overflow/transform); ellers
  // plasseres det absolutt i embedden.
  var stage = q('.fms-stage');
  var usePop = !!(stage && stage.showPopover);
  var sIdx = -1, sOpener = null, sCount = null, sPrev = null, sNext = null, sBody = null, sOpen = false, sRaf = 0;

  function buildStage() {
    stage.innerHTML = '';
    if (usePop) stage.setAttribute('popover', 'manual');
    sBody = el('div', 'fms-stagebody');
    sCount = el('p', 'fms-scount');
    sCount.setAttribute('aria-live', 'polite');
    var sClose = el('button', 'fms-btn fms-sbtn fms-sclose', ICON.close);
    sClose.type = 'button'; sClose.setAttribute('aria-label', 'Lukk');
    sClose.addEventListener('click', shutStage);
    sPrev = el('button', 'fms-btn fms-sbtn fms-sprev', ICON.prev);
    sPrev.type = 'button'; sPrev.setAttribute('aria-label', 'Forrige');
    sPrev.addEventListener('click', function () { showStage(sIdx - 1); });
    sNext = el('button', 'fms-btn fms-sbtn fms-snext', ICON.next);
    sNext.type = 'button'; sNext.setAttribute('aria-label', 'Neste');
    sNext.addEventListener('click', function () { showStage(sIdx + 1); });
    stage.appendChild(sBody);
    stage.appendChild(sCount);
    stage.appendChild(sClose);
    stage.appendChild(sPrev);
    stage.appendChild(sNext);
    stage.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowRight') { ev.preventDefault(); showStage(sIdx + 1); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); showStage(sIdx - 1); }
      else if (k === 'Escape' || k === 'Esc') { ev.preventDefault(); shutStage(); }
    });
    // Sveip sidelengs på mobil
    var x0 = null, y0 = 0;
    stage.addEventListener('touchstart', function (ev) {
      // Forstørret bilde: dra flytter bildet, bytter ikke element
      if (stage.querySelector('.fms-zwrap.is-zoom') || ev.touches.length > 1) { x0 = null; return; }
      var t = ev.touches[0]; x0 = t.clientX; y0 = t.clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (ev) {
      if (x0 == null) return;
      var t = ev.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showStage(sIdx + (dx < 0 ? 1 : -1));
    }, { passive: true });
    // Klikk utenfor lukker (men et nytt kort i slideren bytter bare innhold)
    document.addEventListener('pointerdown', function (ev) {
      if (!sOpen) return;
      var t = ev.target;
      if (stage.contains(t)) return;
      if (t.closest && t.closest('.fms-open') && root.contains(t)) return;
      shutStage();
    }, true);
    var soon = function () { if (sOpen && !sRaf) sRaf = (window.requestAnimationFrame || setTimeout)(function () { sRaf = 0; placeStage(); }); };
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
  }

  // Midt over slideren, klemt innenfor skjermen (16 px marg). Følger siden
  // når den rulles; lukkes når slideren er rullet helt ut av syne.
  function placeStage() {
    if (!sOpen) return;
    var sec = q('.fms') || root;
    var r = sec.getBoundingClientRect();
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) { shutStage(); return; }
    var a = rail ? rail.getBoundingClientRect() : r;
    var w = stage.offsetWidth, h = stage.offsetHeight;
    var left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, vw - 16 - w));
    var top = Math.max(16, Math.min(a.top + a.height / 2 - h / 2, vh - 16 - h));
    if (usePop) { stage.style.left = left + 'px'; stage.style.top = top + 'px'; }
    else {
      var wr = root.getBoundingClientRect();
      stage.style.left = (left - wr.left) + 'px'; stage.style.top = (top - wr.top) + 'px';
    }
    return { left: left, top: top };
  }

  function showStage(i, gesture) {
    if (!(i >= 0 && i < V.length)) return;
    pauseAll(null);
    sIdx = i;
    sBody.innerHTML = '';
    var f = figure(V[i], i, 'fms-sfig');
    sBody.appendChild(f);
    load(f);
    // Størrelsen er kjent først når bildet/videoen har lastet
    var m = f.querySelector('img, video');
    if (m) {
      m.addEventListener('load', placeStage);
      m.addEventListener('loadedmetadata', placeStage);
    }
    playIfVideo(f, gesture);
    sCount.textContent = (i + 1) + ' / ' + V.length;
    sPrev.disabled = i === 0;
    sNext.disabled = i === V.length - 1;
    placeStage();
    // Forhåndslast naboen (bare bilder; video lastes ved avspilling)
    var n = V[i + 1];
    if (n && n.t !== 'v') { var im = new Image(); im.src = n.src; }
  }

  function openStage(i, from) {
    if (!stage) { openBox(i, from); return; }
    if (!sBody) buildStage();
    var wasOpen = sOpen;
    sOpener = from || document.activeElement;
    stage.hidden = false;
    if (usePop && !wasOpen) { try { stage.showPopover(); } catch (x) { usePop = false; } }
    sOpen = true;
    showStage(i, true);
    if (!wasOpen) {
      // Spretter ut fra kortet som ble trykket på
      var pos = placeStage();
      if (from && pos && from.getBoundingClientRect) {
        var fr = from.getBoundingClientRect();
        stage.style.transformOrigin = Math.round(fr.left + fr.width / 2 - pos.left) + 'px ' + Math.round(fr.top + fr.height / 2 - pos.top) + 'px';
      }
      stage.classList.remove('is-in');
      void stage.offsetWidth;
      stage.classList.add('is-in');
    }
    try { stage.focus({ preventScroll: true }); } catch (x) {}
    track('åpnet', { element: label(i) });
  }

  function shutStage() {
    if (!sOpen) return;
    sOpen = false;
    pauseAll(null);
    if (usePop) { try { stage.hidePopover(); } catch (x) {} }
    stage.hidden = true;
    sBody.innerHTML = '';
    sIdx = -1;
    if (viaKey && sOpener && sOpener.focus) { try { sOpener.focus({ preventScroll: true }); } catch (x) {} }
    else if (document.activeElement && document.activeElement.blur && root.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (x) {} }
  }
}
