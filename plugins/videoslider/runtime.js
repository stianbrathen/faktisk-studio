// Faktisk Studio · Videoslider — kjøretid for embedden
//
// fvsRun(root, opts) kopieres inn i embedden med toString(), og den samme
// funksjonen kjører i forhåndsvisningen i Studio (opts.preview = true, uten måling).
// Skrevet i ES5 og uten globale DOM-oppslag: alt søkes fra embeddens rot,
// slik at flere embeds kan stå på samme side.
//
// - Slideren er ferdig rendret HTML (kort med stillbilde og tittel). Uten skript
//   er hvert kort en vanlig lenke (TikTok-lenken, ellers videofila).
// - Trykk på et kort åpner et stort vindu (<dialog>, øverste lag – påvirkes ikke av
//   transform/contain hos foreldre) med én video per side. Leseren blar opp/ned som
//   på TikTok (scroll-snap), med piltaster, knapper eller musehjul.
// - TO <video> bytter på: den ene spiller, den andre står klar på neste side
//   (lastet, første bilde tegnet), så neste video starter med en gang. Begge låses
//   opp for lyd i trykket som åpner vinduet (iPhone krever trykk per element).
// - Videoene lastes først når vinduet åpnes (stillbildene ligger i Labrador).
// - Bare én avspilling om gangen: «fkpod:play» på window pauser podkast-embeds
//   og andre slidere, og omvendt.
// - Måling: Fathom («<tittel>: <hendelse>»), dataLayer hvis den finnes, og «fkvs:track».
// - I Labrador-editoren (window.lab_api) gjør skriptet ingenting.

/* eslint-disable no-var */
function fvsRun(root, opts) {
  if (!root || root.__fvs) return;
  opts = opts || {};
  if (window.lab_api && !opts.preview) return;
  var dataEl = root.querySelector('.fvs-data');
  var D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var V = D.videos || [];
  if (!V.length) return;
  root.__fvs = true;

  var me = 'fvs' + Math.random().toString(36).slice(2, 10);
  // Fokus tilbake til kortet bare når vinduet ble åpnet med tastaturet.
  // Etter trykk/klikk ville nettleseren (særlig Safari på iPhone) ellers vise
  // fokusrammen rundt kortet når vinduet lukkes.
  var viaKey = false;
  var q = function (s) { return root.querySelector(s); };
  var qa = function (s) { return root.querySelectorAll(s); };
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (x) {}
  var LABEL = D.linkLabel || 'Se på TikTok';
  var NAME = D.title || 'Videoslider';

  function track(name, extra) {
    if (opts.preview) return;
    var p = { boks: NAME };
    for (var k in (extra || {})) p[k] = extra[k];
    try { if (window.dataLayer && window.dataLayer.push) { var o = { event: 'videoslider_' + name }; for (var k2 in p) o[k2] = p[k2]; window.dataLayer.push(o); } } catch (x) {}
    // faktisk.no måler med Fathom (og Kilkaya), ikke Google Tag Manager
    try {
      if (window.fathom && window.fathom.trackEvent) {
        window.fathom.trackEvent(NAME + ': ' + name + (p.prosent ? ' ' + p.prosent + ' %' : '') + (p.video_title ? ' – ' + p.video_title : ''));
      }
    } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('fkvs:track', { detail: { name: name, params: p } })); } catch (x) {}
  }

  // ------------------------------------------------------------------
  //  Slideren på siden
  // ------------------------------------------------------------------
  var rail = q('.fvs-track');
  var prevBtn = q('.fvs-arrow--prev');
  var nextBtn = q('.fvs-arrow--next');
  var nav = q('.fvs-nav');
  var raf = 0;

  function arrows() {
    raf = 0;
    if (!rail || !prevBtn || !nextBtn) return;
    var max = rail.scrollWidth - rail.clientWidth - 2;
    // Får alle kortene plass, trengs ikke pilene (CSS bestemmer ellers om de vises)
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
    var items = rail.querySelectorAll('.fvs-item');
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
    // Bildene kan endre bredden på sporet når de lastes
    setTimeout(arrows, 600);
  }

  var follow = q('.fvs-follow');
  if (follow) follow.addEventListener('click', function () { track('Følg oss'); });

  var cards = qa('.fvs-card');
  for (var c = 0; c < cards.length; c++) {
    (function (a) {
      a.addEventListener('click', function (ev) {
        if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        var i = parseInt(a.getAttribute('data-i'), 10);
        if (!(i >= 0 && i < V.length)) return;
        ev.preventDefault();
        viaKey = ev.detail === 0;
        open(i, a);
      });
    })(cards[c]);
  }

  // ------------------------------------------------------------------
  //  Stort vindu
  // ------------------------------------------------------------------
  // TO avspillere (P[0], P[1]) bytter på: den ene spiller videoen som vises,
  // den andre står klar på neste side med videoen lastet og første bilde
  // tegnet. Når leseren blar dit, starter den med en gang i stedet for å
  // laste fra null. Begge låses opp for lyd i trykket som åpner vinduet
  // (iPhone krever at video med lyd startes av et trykk — per element).
  var dlg = null, feed = null, slides = [];
  var counter = null, muteBtn = null, upBtn = null, downBtn = null;
  var P = [], curP = null;
  var cur = -1, dir = 1, opener = null, io = null, advanceT = null, htmlOverflow = '', isOpen = false;
  var marks = {}, played = {}, muted = false;
  var conn = navigator.connection;
  var saveData = !!(conn && (conn.saveData || /2g$/.test(conn.effectiveType || '')));
  // Klargjort video spilles så lenge lydløst før den stoppes på første bilde
  var PRIME_S = 1.2;
  // #fvsdebug i adressen: telleren viser ms fra bla til videoen spiller
  var DEBUG = /fvsdebug/.test(location.hash || '');
  var now = function () { return window.performance && performance.now ? performance.now() : Date.now(); };
  var lastScroll = 0, scrollRaf = 0, progTarget = -1;
  // Kjør fn når feeden ikke har scrollet de siste 180 ms
  function whenIdle(fn) {
    var t = function () { if (now() - lastScroll < 180) setTimeout(t, 90); else fn(); };
    t();
  }

  var ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
    on: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>'
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }

  // Klassene på en avspiller: is-paused (play-knapp), is-loading (video
  // skjult, bildet bak vises), is-ready (klar på neste side, uten play-knapp)
  function cls(p, c) { p.player.className = 'fvs-player' + (c ? ' ' + c : ''); }

  function makePlayer() {
    var p = { idx: -1, ready: false };
    p.player = el('div', 'fvs-player is-paused is-loading');
    p.video = el('video');
    p.video.setAttribute('playsinline', '');
    p.video.setAttribute('webkit-playsinline', '');
    p.video.setAttribute('preload', 'auto');
    p.player.appendChild(p.video);
    p.stateIcon = el('span', 'fvs-state', ICON.play);
    p.stateIcon.setAttribute('aria-hidden', 'true');
    p.player.appendChild(p.stateIcon);
    p.bar = el('div', 'fvs-bar', '<i></i>');
    p.player.appendChild(p.bar);
    p.errBox = el('p', 'fvs-err');
    p.player.appendChild(p.errBox);
    // Trykk på videoen: pause/spill
    p.player.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('a')) return;
      if (p === curP) toggle();
    });
    var v = p.video;
    // Første bilde er tegnet. Videoen på neste side holdes likevel SKJULT
    // (is-loading): mens den klargjøres spiller den lydløst, og på iPhone kan
    // den vise et senere bilde enn starten. Bak den ligger startbildet (første
    // bilde), så det er det leseren ser mens siden glir inn. (Før ble videoen
    // vist her — da så man den gå/stå på feil sted, og så hoppe tilbake.)
    v.addEventListener('loadeddata', function () {
      p.ready = true;
    });
    // Vakt: en avspiller som ikke vises, skal aldri spille med lyd. Den holdes
    // lydløs hele tiden (se prime/activate), og starter den likevel uten at vi
    // klargjør den (sen play()-promise, Safari som gjenopptar), stoppes den.
    v.addEventListener('play', function () {
      if (p !== curP) { v.muted = true; if (!p.priming) { try { v.pause(); } catch (x) {} } }
    });
    v.addEventListener('playing', function () {
      // Klargjøring: la den gå lydløst til PRIME_S er spilt (se prime)
      if (p !== curP) { if (!p.priming) endPrime(p); return; }
      if (DEBUG && p.t0) { counter.textContent = (cur + 1) + ' / ' + V.length + ' · ' + Math.round(now() - p.t0) + ' ms' + (p.wasReady ? ' (klar)' : ' (ikke klar)'); p.t0 = 0; }
      silenceOthers(p);
      p.starting = false;
      // Vis videoen først når den faktisk spiller fra riktig sted (ikke midt
      // i en spoling tilbake til start) — overgangen fra startbildet blir da
      // usynlig.
      if (v.seeking) {
        var onSeeked = function () { v.removeEventListener('seeked', onSeeked); if (p === curP && !v.paused) cls(p, ''); };
        v.addEventListener('seeked', onSeeked);
      } else cls(p, '');
      p.errBox.textContent = '';
      try { window.dispatchEvent(new CustomEvent('fkpod:play', { detail: { src: me } })); } catch (x) {}
      if (cur >= 0 && !played[cur]) { played[cur] = 1; track('spilt', { video_title: V[cur].title }); }
      // Videoen som vises, har startet: gjør neste klar
      // … men først når blaingen har stoppet: å flytte en <video> inn i neste
      // side mens siden glir, kan gi rykk i Safari.
      var at = cur;
      whenIdle(function () { if (isOpen && cur === at) { prepare(cur + dir); warm(cur - dir); } });
    });
    // Pausen activate() selv gjør på en video som klargjøres, skal ikke vise
    // videoen (p.starting) — den står da på et tilfeldig sted
    v.addEventListener('pause', function () { if (p === curP && !v.ended && !p.starting) cls(p, 'is-paused'); });
    v.addEventListener('timeupdate', function () {
      if (p !== curP) { if (!v.paused && (!p.priming || v.currentTime >= PRIME_S)) endPrime(p); return; }
      var d = v.duration, t = v.currentTime;
      if (!d || !isFinite(d)) return;
      p.bar.firstChild.style.width = Math.min(100, t / d * 100) + '%';
      var pct = t / d * 100, steps = [25, 50, 75, 95];
      marks[cur] = marks[cur] || {};
      for (var s = 0; s < steps.length; s++) {
        if (pct >= steps[s] && !marks[cur][steps[s]]) {
          marks[cur][steps[s]] = 1;
          track('sett', { prosent: steps[s] === 95 ? 100 : steps[s], video_title: V[cur].title });
        }
      }
    });
    v.addEventListener('ended', function () {
      if (p !== curP) return;
      p.bar.firstChild.style.width = '100%';
      if (cur < V.length - 1) {
        clearTimeout(advanceT);
        advanceT = setTimeout(function () { if (isOpen) go(cur + 1); }, 500);
      }
    });
    v.addEventListener('error', function () {
      if (!v.getAttribute('src')) return;
      p.ready = false;
      if (p !== curP) { p.idx = -1; return; }   // reserven feilet: lastes på nytt ved visning
      var it = V[cur] || {};
      cls(p, 'is-error');
      p.errBox.textContent = 'Videoen kunne ikke spilles av her. ';
      if (it.link) {
        var a = el('a');
        a.href = it.link; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = LABEL + ' ↗';
        p.errBox.appendChild(a);
      }
      track('feil', { video_title: it.title });
    });
    return p;
  }

  function build() {
    dlg = el('dialog', 'fvs-dlg');
    dlg.setAttribute('aria-label', NAME);
    feed = el('div', 'fvs-feed');
    feed.setAttribute('tabindex', '-1');
    for (var i = 0; i < V.length; i++) {
      (function (v, i) {
        var s = el('section', 'fvs-slide');
        s.setAttribute('data-i', String(i));
        s.setAttribute('aria-label', 'Video ' + (i + 1) + ' av ' + V.length + (v.title ? ': ' + v.title : ''));
        var f = el('div', 'fvs-frame');
        var img = el('img', 'fvs-poster');
        img.alt = '';
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        // Bak videoen: startbildet (første bilde), så overgangen til video
        // ikke rykker. Mangler det, brukes stillbildet.
        if (v.start || v.poster) img.src = v.start || v.poster;
        f.appendChild(img);
        var info = el('div', 'fvs-info');
        if (v.title) { var t = el('p', 'fvs-vt'); t.textContent = v.title; info.appendChild(t); }
        if (v.link) {
          var a = el('a', 'fvs-tt');
          a.href = v.link; a.target = '_blank'; a.rel = 'noopener';
          a.textContent = LABEL + ' ↗';
          a.addEventListener('click', function () {
            if (curP) { try { curP.video.pause(); } catch (x) {} }
            track('lenke', { video_title: v.title });
          });
          info.appendChild(a);
        }
        f.appendChild(info);
        s.appendChild(f);
        // Klikk utenfor videoen (mørk flate rundt) lukker vinduet
        s.addEventListener('click', function (ev) { if (ev.target === s) shut(); });
        feed.appendChild(s);
        slides.push(s);
      })(V[i], i);
    }

    P = [makePlayer(), makePlayer()];

    var ui = el('div', 'fvs-ui');
    counter = el('p', 'fvs-count');
    counter.setAttribute('aria-live', 'polite');
    var closeBtn = el('button', 'fvs-btn fvs-close', ICON.close);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Lukk');
    closeBtn.addEventListener('click', shut);
    muteBtn = el('button', 'fvs-btn fvs-mute', ICON.on);
    muteBtn.type = 'button';
    muteBtn.setAttribute('aria-label', 'Slå av lyd');
    muteBtn.addEventListener('click', function () { mute(!muted); });
    upBtn = el('button', 'fvs-btn fvs-up', ICON.up);
    upBtn.type = 'button';
    upBtn.setAttribute('aria-label', 'Forrige video');
    upBtn.addEventListener('click', function () { go(cur - 1); });
    downBtn = el('button', 'fvs-btn fvs-down', ICON.down);
    downBtn.type = 'button';
    downBtn.setAttribute('aria-label', 'Neste video');
    downBtn.addEventListener('click', function () { go(cur + 1); });
    ui.appendChild(counter);
    var top = el('div', 'fvs-top');
    top.appendChild(muteBtn);
    top.appendChild(closeBtn);
    ui.appendChild(top);
    var side = el('div', 'fvs-side');
    side.appendChild(upBtn);
    side.appendChild(downBtn);
    ui.appendChild(side);

    dlg.appendChild(feed);
    dlg.appendChild(ui);
    root.appendChild(dlg);

    // Den siden som vises mest, er den aktive. Avgjøres på scroll-hendelsen
    // (én gang per bilde), så neste video starter mens den glir inn — ikke
    // når innrastingen er ferdig. (Før: IntersectionObserver, som på iPhone
    // meldte fra 0,4–0,7 s etter at siden hadde stoppet: videoen sto stille.)
    // Under programmert bla (piler/taster/auto-neste) ignoreres mellomstegene.
    feed.addEventListener('scroll', function () {
      lastScroll = now();
      if (scrollRaf) return;
      scrollRaf = (window.requestAnimationFrame || setTimeout)(function () {
        scrollRaf = 0;
        if (!isOpen) return;
        var h = feed.clientHeight || 1, pos = feed.scrollTop / h, i = Math.round(pos);
        if (progTarget >= 0) { if (Math.abs(pos - progTarget) < 0.05) progTarget = -1; return; }
        if (Math.abs(pos - i) < 0.45) activate(i);   // minst 55 % synlig
      });
    }, { passive: true });
    var userScroll = function () { progTarget = -1; };
    feed.addEventListener('touchstart', userScroll, { passive: true });
    feed.addEventListener('wheel', userScroll, { passive: true });

    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('close', onClosed);
    window.addEventListener('fkpod:play', function (ev) {
      if (ev.detail && ev.detail.src !== me && curP) { try { curP.video.pause(); } catch (x) {} }
    });
  }

  // Bare avspilleren som vises, får lyd. Alle andre videoer i vinduet stoppes
  // og gjøres lydløse (også om en av dem av en eller annen grunn fortsatt går).
  function silenceOthers(p) {
    for (var k = 0; k < P.length; k++) {
      var o = P[k];
      if (o === p) continue;
      o.video.muted = true;
      if (!o.priming && !o.video.paused) { try { o.video.pause(); } catch (x) {} }
    }
  }

  function mute(on) {
    muted = !!on;
    if (curP) curP.video.muted = muted;
    muteBtn.innerHTML = muted ? ICON.off : ICON.on;
    muteBtn.setAttribute('aria-label', muted ? 'Slå på lyd' : 'Slå av lyd');
  }

  // Legg en avspiller på side i (uten å spille). Bildet bak lastes nå.
  function place(p, i) {
    var frame = slides[i].querySelector('.fvs-frame');
    var im = frame.querySelector('.fvs-poster');
    if (im) im.removeAttribute('loading');
    // Flytt bare når avspilleren ikke allerede står her. Å sette inn et
    // <video>-element på nytt (selv på samme plass) kan i Safari bygge
    // tegningen på nytt og forsinke starten.
    if (p.player.parentNode !== frame) frame.insertBefore(p.player, frame.querySelector('.fvs-info'));
    if (p.idx === i) return;
    var v = V[i];
    p.idx = i;
    p.ready = false;
    p.errBox.textContent = '';
    p.bar.firstChild.style.width = '0';
    if (v.start || v.poster) p.video.setAttribute('poster', v.start || v.poster); else p.video.removeAttribute('poster');
    p.video.setAttribute('aria-label', v.title || ('Video ' + (i + 1)));
    p.video.src = v.src;
  }

  // Gjør side i klar i den ledige avspilleren: videoen lastes og første
  // bilde tegnes, så den kan starte med en gang leseren blar dit.
  function prepare(i) {
    if (!(i >= 0 && i < V.length) || saveData || !curP) return;
    var p = P[0] === curP ? P[1] : P[0];
    if (p.idx === i) return;
    try { p.video.pause(); } catch (x) {}
    cls(p, 'is-loading');
    place(p, i);
    try { p.video.load(); } catch (x) {}
    prime(p);
  }

  // iPhone/Safari laster ikke video på forhånd (preload ignoreres): først når
  // play() kalles, hentes data. Vi spiller derfor den klargjorte videoen
  // lydløst et øyeblikk og stopper på første bilde — da er starten lastet og
  // dekodet. Lydløs avspilling er alltid lov; lyden er låst opp i åpne-trykket.
  function prime(p) {
    var v = p.video;
    p.priming = true;
    v.muted = true;
    var pr;
    try { pr = v.play(); } catch (x) {}
    // Den får spille PRIME_S sekunder lydløst (timeupdate stopper den), så
    // Safari henter mer enn bare første bilde. Sikkerhetsnett: stopp uansett
    // etter 3 s. Blokkert (f.eks. Strømsparing på iPhone): stopp straks.
    clearTimeout(p.primeT);
    p.primeT = setTimeout(function () { if (p !== curP && p.priming) endPrime(p); }, 3000);
    if (pr && pr.then) pr.then(function () {}, function () { endPrime(p); });
  }
  // Avspilleren forblir LYDLØS etter klargjøringen. Lyden slås på først i
  // activate(), når den blir den som vises. (Før ble lyden slått på igjen her,
  // og en klargjort video som Safari likevel lot gå videre, ble hørbar.)
  function endPrime(p) {
    var v = p.video;
    try { v.pause(); } catch (x) {}
    if (p.priming) { try { v.currentTime = 0; } catch (x) {} }
    p.priming = false;
    if (p !== curP) v.muted = true;
  }

  // Varm opp (bare hurtigbufferen) videoen i motsatt retning
  var warmed = {};
  function warm(i) {
    if (!(i >= 0 && i < V.length) || warmed[i] || saveData) return;
    warmed[i] = 1;
    var im = slides[i] && slides[i].querySelector('.fvs-poster');
    if (im) im.removeAttribute('loading');
    var src = V[i].src;
    if (!window.fetch || !src) return;
    try {
      fetch(src.split('#')[0], { headers: { Range: 'bytes=0-1999999' }, credentials: 'omit' })
        .then(function (r) { return r.arrayBuffer(); })['catch'](function () {});
    } catch (x) {}
  }

  function play() {
    if (!curP) return;
    var p = curP, pr;
    try { pr = p.video.play(); } catch (x) {}
    // Startet først etter at leseren har bladd videre: stopp den
    if (pr && pr.then) pr.then(function () { if (p !== curP) { p.video.muted = true; try { p.video.pause(); } catch (x) {} } }, function () {});
    // Blokkert: vis play-knappen
    if (pr && pr['catch']) pr['catch'](function () { if (p === curP) { p.starting = false; cls(p, 'is-paused'); } });
  }

  function toggle() {
    if (!curP) return;
    var v = curP.video;
    if (v.paused || v.ended) play(); else v.pause();
  }

  function activate(i) {
    if (!(i >= 0 && i < V.length) || i === cur) return;
    if (cur >= 0) dir = i > cur ? 1 : -1;
    cur = i;
    clearTimeout(advanceT);
    // Står den andre avspilleren klar på denne siden? Da bytter vi.
    var p = P[0].idx === i ? P[0] : P[1].idx === i ? P[1] : (P[0] === curP ? P[1] : P[0]);
    var old = curP;
    curP = p;
    silenceOthers(p);
    if (old && old !== p) { old.video.muted = true; try { old.video.pause(); } catch (x) {} }
    // Blar leseren hit mens videoen klargjøres (spiller lydløst), stopp den
    // først, så play() under gir en ny «playing» (som gjør neste klar).
    if (p.priming && p !== old) { try { p.video.pause(); } catch (x) {} }
    p.priming = false;
    place(p, i);
    p.t0 = now(); p.wasReady = p.ready; p.starting = true;
    clearTimeout(p.primeT);
    // Startbildet vises til videoen spiller fra start (se «playing»)
    cls(p, 'is-loading');
    p.video.muted = muted;
    if (p !== old && p.video.currentTime > 0) { try { p.video.currentTime = 0; } catch (x) {} }
    play();
    counter.textContent = (i + 1) + ' / ' + V.length;
    upBtn.disabled = i === 0;
    downBtn.disabled = i === V.length - 1;
  }

  function go(i) {
    if (!(i >= 0 && i < V.length)) return;
    var top = i * feed.clientHeight;
    progTarget = i;
    try { feed.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' }); }
    catch (x) { feed.scrollTop = top; }
    activate(i);
  }

  function onKey(ev) {
    var k = ev.key;
    var t = ev.target;
    var onControl = t && t.closest && t.closest('button, a');
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown') { ev.preventDefault(); go(cur + 1); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') { ev.preventDefault(); go(cur - 1); }
    else if ((k === ' ' || k === 'Spacebar' || k === 'k') && !onControl) { ev.preventDefault(); toggle(); }
    else if (k === 'm' || k === 'M') { mute(!muted); }
    else if ((k === 'Escape' || k === 'Esc') && !dlg.showModal) { shut(); }
  }

  function open(i, from) {
    if (!dlg) build();
    if (isOpen) return;
    isOpen = true;
    opener = from || document.activeElement;
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (dlg.showModal) { try { dlg.showModal(); } catch (x) { dlg.setAttribute('open', ''); } }
    else dlg.setAttribute('open', '');
    feed.scrollTop = i * feed.clientHeight;
    cur = -1;
    dir = 1;
    curP = null;
    activate(i);
    // Lås opp den andre avspilleren i samme trykk (iPhone: lyd krever trykk
    // per element). Den spilles lydløst et øyeblikk og stoppes; så lastes
    // neste video inn i den.
    var other = P[0] === curP ? P[1] : P[0];
    var nx = i + 1 < V.length ? i + 1 : i - 1;
    if (nx >= 0 && !saveData) {
      cls(other, 'is-loading');
      place(other, nx);
      prime(other);   // play() i trykket låser opp lyd for denne avspilleren også
    }
    if (io) for (var s = 0; s < slides.length; s++) io.observe(slides[s]);
    try { feed.focus({ preventScroll: true }); } catch (x) { feed.focus(); }
    track('åpnet', { video_title: V[i].title });
  }

  function shut() {
    if (!dlg) return;
    if (dlg.close && dlg.open) dlg.close();
    else { dlg.removeAttribute('open'); onClosed(); }
  }

  function onClosed() {
    if (!isOpen) return;
    isOpen = false;
    clearTimeout(advanceT);
    if (io) io.disconnect();
    for (var k = 0; k < P.length; k++) {
      var p = P[k];
      try { p.video.pause(); } catch (x) {}
      p.video.removeAttribute('src');
      try { p.video.load(); } catch (x) {}
      p.idx = -1; p.ready = false;
      cls(p, 'is-paused is-loading');
    }
    curP = null;
    cur = -1;
    document.documentElement.style.overflow = htmlOverflow;
    if (viaKey && opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (x) {} }
    else if (document.activeElement && document.activeElement.blur && root.contains(document.activeElement)) { try { document.activeElement.blur(); } catch (x) {} }
  }
}
