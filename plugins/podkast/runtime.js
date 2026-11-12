// Faktisk Studio · Podkast — kjøretid for embedden
//
// fpodRun(root, opts) kopieres inn i embedden med toString(), og den samme
// funksjonen kjører i forhåndsvisningen i Studio (opts.preview = true).
// Skrevet i ES5 og uten globale DOM-oppslag: alt søkes fra embeddens rot,
// slik at flere embeds kan stå på samme side.
//
// - Markupen er ferdig rendret i embedden (vises også om skriptet sover).
// - Spilleren lastes FØRST når leseren trykker play: YouTube (youtube-nocookie.com)
//   eller Mux (<mux-player> fra jsdelivr, fast versjon). Episoden velger selv
//   (e.src === 'mux'). Begge pakkes i samme lille grensesnitt (P), så måling,
//   «Stor visning», «Eget vindu» og episodebytte er like for begge.
// - Bare én spiller om gangen: «fkpod:play» på window pauser de andre.
// - Måling: dataLayer (hvis den finnes) + «fkpod:track»-event.

/* eslint-disable no-var */
function fpodRun(root, opts) {
  if (!root || root.__fpod) return;
  root.__fpod = true;
  opts = opts || {};
  var dataEl = root.querySelector('.fpod-data');
  var D;
  try { D = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var EP = D.episodes || [];
  if (!EP.length) return;

  var me = 'fpod' + Math.random().toString(36).slice(2, 10);
  var idx = 0, player = null, ticker = null, marks = {};
  var MUXJS = 'https://cdn.jsdelivr.net/npm/@mux/mux-player@3.14.0';
  function isMux(e) { return e && e.src === 'mux'; }
  var q = function (s) { return root.querySelector(s); };
  var stage = q('.fpod-stage');

  function track(name, extra) {
    var e = EP[idx] || {};
    var p = { podkast: D.title, episode_no: e.no, episode_title: e.title, video_id: e.id };
    for (var k in (extra || {})) p[k] = extra[k];
    if (opts.preview) return;
    try { if (window.dataLayer && window.dataLayer.push) { var o = { event: name }; for (var k2 in p) o[k2] = p[k2]; window.dataLayer.push(o); } } catch (x) {}
    // faktisk.no måler med Fathom (og Kilkaya), ikke Google Tag Manager
    try { if (window.fathom && window.fathom.trackEvent) window.fathom.trackEvent(D.title + ': ' + name + (p.prosent ? ' ' + p.prosent + ' %' : '')); } catch (x) {}
    try { window.dispatchEvent(new CustomEvent('fkpod:track', { detail: { name: name, params: p } })); } catch (x) {}
  }

  function thumbOf(e) {
    if (e.thumb) return e.thumb;
    return isMux(e) ? 'https://image.mux.com/' + e.id + '/thumbnail.jpg?width=1280'
      : 'https://i.ytimg.com/vi/' + e.id + '/hqdefault.jpg';
  }
  function vname(e) { return [D.title, e.title].filter(function (s) { return s; }).join(': '); }

  function watchUrl(e, t) {
    return isMux(e) ? 'https://player.mux.com/' + encodeURIComponent(e.id) + (t ? '?start-time=' + t : '')
      : 'https://www.youtube.com/watch?v=' + encodeURIComponent(e.id) + (t ? '&t=' + t + 's' : '');
  }

  function show(i) {
    idx = i;
    var e = EP[i];
    q('.fpod-epno').textContent = e.meta || '';
    q('.fpod-title').textContent = e.title || '';
    q('.fpod-desc').textContent = e.desc || '';
    var items = root.querySelectorAll('.fpod-item');
    for (var j = 0; j < items.length; j++) items[j].setAttribute('aria-current', j === i ? 'true' : 'false');
    var err = q('.fpod-err'); if (err) err.parentNode.removeChild(err);
  }

  function facade() {
    var e = EP[idx];
    var b = q('.fpod-facade');
    if (!b) {
      stage.innerHTML = '';
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'fpod-facade';
      b.innerHTML = '<img alt=""><span class="fpod-bigplay"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg></span>';
      stage.appendChild(b);
    }
    b.setAttribute('aria-label', 'Spill av: ' + (e.title || D.title || ''));
    b.querySelector('img').src = thumbOf(e);
    var d = q('.fpod-dur');
    if (d) { d.textContent = e.dur || ''; d.style.display = e.dur ? '' : 'none'; }
    var m = q('.fpod-meta');
    if (m) m.className = 'fpod-meta' + (isMux(e) ? ' fpod-meta--mux' : '');
    b.onclick = start;
  }

  function muxApi() {
    if (window.__fkMux) return window.__fkMux;
    window.__fkMux = new Promise(function (res, rej) {
      if (window.customElements && window.customElements.get('mux-player')) return res();
      var s = document.createElement('script');
      s.src = MUXJS;
      s.onload = function () { window.customElements.whenDefined('mux-player').then(res); };
      s.onerror = function () { window.__fkMux = null; rej(new Error('mux-player')); };
      document.head.appendChild(s);
    });
    return window.__fkMux;
  }

  function api() {
    if (window.__fkYT) return window.__fkYT;
    window.__fkYT = new Promise(function (res) {
      if (window.YT && window.YT.Player) return res(window.YT);
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) { try { prev(); } catch (x) {} } res(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
    return window.__fkYT;
  }

  function tick() {
    if (!player) return;
    var d = player.dur(), t = player.cur();
    if (!d) return;
    var pct = t / d * 100, id = EP[idx].id, steps = [25, 50, 75, 95];
    marks[id] = marks[id] || {};
    for (var i = 0; i < steps.length; i++) {
      if (pct >= steps[i] && !marks[id][steps[i]]) {
        marks[id][steps[i]] = 1;
        track('podkast_progress', { prosent: steps[i] === 95 ? 100 : steps[i] });
      }
    }
  }

  // «Spiller» meldes også etter hopp i videoen og etter bufring – tell bare
  // en avspilling når den starter fra pause/stopp.
  var playing = false;
  function onPlaying() {
    clearInterval(ticker); ticker = setInterval(tick, 1000);
    if (playing) return;
    playing = true;
    try { window.dispatchEvent(new CustomEvent('fkpod:play', { detail: { src: me } })); } catch (x) {}
    track('podkast_play');
  }
  function onPaused() {
    if (!playing) return;
    playing = false;
    clearInterval(ticker);
    track('podkast_pause', { sekunder: Math.round(player ? player.cur() : 0) });
  }
  function onEnded() { playing = false; clearInterval(ticker); tick(); }

  function onState(ev) {
    var S = window.YT.PlayerState;
    if (ev.data === S.PLAYING) onPlaying();
    else if (ev.data === S.PAUSED) onPaused();
    else if (ev.data === S.ENDED) onEnded();
  }

  function onErr() {
    var e = EP[idx];
    var p = document.createElement('p');
    p.className = 'fpod-err';
    p.innerHTML = 'Videoen kunne ikke spilles her. <a target="_blank" rel="noopener"></a>.';
    p.querySelector('a').textContent = isMux(e) ? 'Åpne videoen i eget vindu' : 'Se den på YouTube';
    p.querySelector('a').href = watchUrl(e, 0);
    q('.fpod-main').appendChild(p);
    track('podkast_feil');
  }

  function start() {
    if (!opts.preview) stopLoop();
    if (opts.preview) {
      var n = q('.fpod-prevnote');
      if (!n) {
        n = document.createElement('span');
        n.className = 'fpod-prevnote';
        n.textContent = 'Videoen spilles av når embeden står på faktisk.no';
        stage.appendChild(n);
      }
      return;
    }
    var e = EP[idx];
    // Tidsfrist og synlig reserve (Studio-prinsipp): er spilleren ikke klar
    // etter 12 s, vis lenke til videoen i stedet for et svart felt.
    var ready = false;
    setTimeout(function () { if (!ready) onErr(); }, 12000);
    player = null;
    if (isMux(e)) {
      stage.innerHTML = '';
      var build = function () {
        var el = document.createElement('mux-player');
        el.setAttribute('stream-type', 'on-demand');
        el.setAttribute('accent-color', '#0050FC');
        el.setAttribute('disable-cookies', '');  // som Faktisks andre Mux-embeds (disable_cookies=true)
        el.setAttribute('autoplay', '');         // starter med lyd når den er klar (leseren har trykket)
        el.setAttribute('playback-id', e.id);
        el.setAttribute('poster', thumbOf(e));  // samme bilde som før trykket, ikke Mux sitt
        el.setAttribute('metadata-video-title', vname(e));
        el.setAttribute('title', 'Videospiller: ' + D.title);
        el.addEventListener('loadedmetadata', function () { ready = true; });
        el.addEventListener('playing', onPlaying);
        el.addEventListener('pause', function () { if (!el.ended) onPaused(); });
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', function () { if (!ready) { ready = true; onErr(); } });
        // Reserve: er den fortsatt på pause når den kan spilles, prøv én gang til.
        var kick = function () { el.removeEventListener('canplay', kick); if (el.paused) player.play(); };
        el.addEventListener('canplay', kick);
        stage.appendChild(el);
        player = {
          kind: 'mux', el: el,
          play: function () { var pr = el.play(); if (pr && pr.catch) pr.catch(function () {}); },
          pause: function () { el.pause(); },
          cur: function () { return el.currentTime || 0; },
          dur: function () { return el.duration || 0; },
          load: function (x) { el.setAttribute('poster', thumbOf(x)); el.setAttribute('playback-id', x.id); el.setAttribute('metadata-video-title', vname(x)); player.play(); }
        };
        // Nettleseren kan nekte lyd uten nytt trykk (særlig iPhone) –
        // da står Mux-spilleren klar med sin egen play-knapp.
        player.play();
      };
      // Er Mux-scriptet allerede lastet (forhåndslastet da boksen ble synlig),
      // lages spilleren i selve trykket – det krever iPhone for lyd.
      if (window.customElements && window.customElements.get('mux-player')) build();
      else muxApi().then(build, function () { ready = true; onErr(); });
      return;
    }
    stage.innerHTML = '<div></div>';
    api().then(function (YT) {
      var yt = new YT.Player(stage.firstChild, {
        host: 'https://www.youtube-nocookie.com',
        videoId: e.id,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: location.origin },
        events: {
          onReady: function (ev) {
            ready = true;
            try { ev.target.getIframe().title = 'Videospiller: ' + D.title; } catch (x) {}
            ev.target.playVideo();
          },
          onStateChange: onState,
          onError: function () { ready = true; onErr(); }
        }
      });
      player = {
        kind: 'yt', yt: yt,
        play: function () { if (yt.playVideo) yt.playVideo(); },
        pause: function () { if (yt.pauseVideo) yt.pauseVideo(); },
        cur: function () { return yt.getCurrentTime ? yt.getCurrentTime() : 0; },
        dur: function () { return yt.getDuration ? yt.getDuration() : 0; },
        load: function (x) { if (yt.loadVideoById) yt.loadVideoById(x.id); }
      };
    });
  }

  function choose(i) {
    if (i === idx && player) { player.play(); return; }
    stopLoop();
    show(i);
    track('podkast_episode_valgt');
    playing = false;
    if (player && player.kind === (isMux(EP[i]) ? 'mux' : 'yt')) player.load(EP[i]);
    else if (opts.preview) facade();
    else start();
  }

  var items = root.querySelectorAll('.fpod-item');
  for (var i = 0; i < items.length; i++) {
    (function (b) { b.onclick = function () { choose(+b.getAttribute('data-i')); }; })(items[i]);
  }
  var more = q('.fpod-more');
  if (more) {
    more.onclick = function () {
      var l = q('.fpod-list');
      var open = l.className.indexOf(' open') < 0;
      l.className = open ? l.className + ' open' : l.className.replace(' open', '');
      more.textContent = open ? 'Vis færre' : more.getAttribute('data-all');
    };
  }
  var links = root.querySelectorAll('.fpod-links a, .fpod-foot a');
  for (var k = 0; k < links.length; k++) {
    (function (a) { a.addEventListener('click', function () { track('podkast_lenke', { lenke: a.textContent }); }); })(links[k]);
  }
  window.addEventListener('fkpod:play', function (ev) {
    if (ev.detail && ev.detail.src !== me && player) player.pause();
  });

  // Foreldre med container-type (layout-containment), transform, filter, zoom o.l.
  // gjør at fullskjerm og position:fixed plasseres feil – i testartikkelen gled
  // YouTubes fullskjerm ut til høyre (Chrome og Safari). Mens videoen er i
  // fullskjerm eller stor visning slås slike egenskaper av på alle foreldre
  // (også Labradors), og settes tilbake etterpå.
  var PROPS = ['containerType', 'contain', 'transform', 'filter', 'perspective', 'willChange', 'backdropFilter', 'zoom'];
  var NEUTRAL = { containerType: 'normal', willChange: 'auto', zoom: '1' };
  function neutralize(from) {
    var list = [];
    for (var el = from; el; el = el.parentElement) {
      var old = {};
      for (var i2 = 0; i2 < PROPS.length; i2++) {
        old[PROPS[i2]] = el.style[PROPS[i2]];
        el.style[PROPS[i2]] = NEUTRAL[PROPS[i2]] || 'none';
      }
      list.push([el, old]);
    }
    return list;
  }
  function restore(list) {
    for (var j2 = 0; list && j2 < list.length; j2++) {
      for (var p2 in list[j2][1]) list[j2][0].style[p2] = list[j2][1][p2];
    }
  }

  var fsSaved = null;
  function onFs() {
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && root.contains(fs) && !fsSaved) fsSaved = neutralize(fs.parentElement);
    else if (!fs && fsSaved) { restore(fsSaved); fsSaved = null; }
  }
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  // «Stor visning»: videoen fyller nettleservinduet (ikke ekte fullskjerm).
  // Klassen flytter IKKE iframen i DOM-en – da ville avspillingen startet på nytt.
  var big = q('.fpod-big'), bigSaved = null, bodyOverflow = '';
  function setBig(on) {
    if (on === !!bigSaved) return;
    if (on) {
      bigSaved = neutralize(root);
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      root.className += ' fpod-isbig';
      big.textContent = '✕ Lukk';
      big.setAttribute('aria-label', 'Lukk stor visning');
      track('podkast_stor_visning');
    } else {
      root.className = root.className.replace(' fpod-isbig', '');
      document.body.style.overflow = bodyOverflow;
      restore(bigSaved); bigSaved = null;
      big.textContent = '⤢ Stor visning';
      big.setAttribute('aria-label', 'Vis videoen i hele nettleservinduet');
    }
  }
  if (big) {
    big.onclick = function () {
      if (opts.preview) return;
      if (!bigSaved && !player) start();
      setBig(!bigSaved);
    };
    document.addEventListener('keydown', function (ev) { if (bigSaved && (ev.key === 'Escape' || ev.key === 'Esc')) setBig(false); });
  }

  // Coveret stort: lysboks lagt rett i <body> (utenfor embeddens container-type,
  // så position:fixed dekker hele vinduet). Klikk, ✕ eller Esc lukker.
  var coverBtn = q('.fpod-coverbtn');
  if (coverBtn) {
    coverBtn.onclick = function () {
      var img0 = coverBtn.querySelector('img');
      var ov = document.createElement('div');
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', img0.alt || 'Cover');
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:56px 20px 20px;box-sizing:border-box;cursor:zoom-out;font-family:inherit';
      var big = document.createElement('img');
      big.src = coverBtn.getAttribute('data-full') || img0.src; big.alt = img0.alt;
      big.style.cssText = 'display:block;max-width:min(92vw,1200px);max-height:calc(100vh - 80px);width:auto;height:auto;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6);margin:0';
      var x = document.createElement('button');
      x.type = 'button';
      x.textContent = '✕ Lukk';
      x.setAttribute('aria-label', 'Lukk');
      x.style.cssText = 'position:absolute;top:14px;right:16px;border:0;background:#fff;color:#212121;font:500 13px/1.3 "Unica77","Helvetica Neue",Helvetica,Arial,sans-serif;padding:8px 14px;border-radius:99px;cursor:pointer;font-synthesis:none;box-shadow:0 2px 12px rgba(0,0,0,.45)';
      ov.appendChild(big); ov.appendChild(x);
      var bo = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      function close() {
        document.removeEventListener('keydown', onKey);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        document.body.style.overflow = bo;
        try { coverBtn.focus(); } catch (e2) {}
      }
      function onKey(ev) { if (ev.key === 'Escape' || ev.key === 'Esc') close(); }
      ov.onclick = close;
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      x.focus();
      track('podkast_cover');
    };
  }

  // «Eget vindu»: spilleren (YouTube eller Mux) alene i et lite popup-vindu som lever videre
  // når leseren går til andre sider. Fortsetter fra samme sekund, og spilleren på
  // siden pauses. Popup finnes ikke på mobil – knappen skjules der med CSS.
  // Referer må sendes (ikke noreferrer), ellers kan YouTube nekte å vise embeden.
  var pop = q('.fpod-pop');
  if (pop) {
    pop.onclick = function () {
      if (opts.preview) return;
      var e = EP[idx], t = 0;
      try {
        if (player) { t = Math.floor(player.cur()) || 0; player.pause(); }
      } catch (x) {}
      if (bigSaved) setBig(false);
      var w = null;
      if (isMux(e)) {
        // Mux: tomt vindu som fylles med bare spilleren (player.mux.com åpnet
        // direkte viser Mux sin egen side med ramme, «Copy link» og logo).
        try { w = window.open('', 'faktiskPodkast', 'popup,width=640,height=360'); } catch (x) {}
        if (w) {
          var esc = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
          var name = vname(e);
          try {
            var wd = w.document;
            wd.open();
            wd.write('<!doctype html><html lang="no"><head><meta charset="utf-8"><title>' + esc(name) + '</title>'
              + '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}mux-player{display:block;width:100%;height:100%;--media-object-fit:contain}</style>'
              + '</head><body>'
              + '<mux-player stream-type="on-demand" accent-color="#0050FC" disable-cookies autoplay'
              + ' playback-id="' + esc(e.id) + '" poster="' + esc(thumbOf(e)) + '" start-time="' + t + '" metadata-video-title="' + esc(name) + '"></mux-player>'
              + '<script async src="' + MUXJS + '"><' + '/script></body></html>');
            wd.close();
            try { w.focus(); } catch (x2) {}
          } catch (x) {
            // Vinduet viser allerede en annen side (f.eks. YouTube) – bruk Mux sin side.
            try { w.location.href = 'https://player.mux.com/' + encodeURIComponent(e.id) + '?autoplay=any&disable-cookies=true&start-time=' + t; } catch (x3) {}
          }
        }
      } else {
        try {
          w = window.open('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(e.id) + '?autoplay=1&rel=0&playsinline=1&start=' + t,
            'faktiskPodkast', 'popup,width=640,height=360');
        } catch (x) {}
      }
      if (!w) window.open(watchUrl(e, t), '_blank');
      track('podkast_eget_vindu', { sekunder: t });
    };
  }

  // Forhåndslast Mux-spilleren når boksen nærmer seg skjermen (bare hvis en
  // episode ligger hos Mux). Selve videoen og Mux-statistikken starter først ved play.
  var anyMux = false;
  for (var mi = 0; mi < EP.length; mi++) if (isMux(EP[mi])) anyMux = true;
  if (anyMux && !opts.preview) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        for (var z = 0; z < en.length; z++) if (en[z].isIntersecting) { io.disconnect(); muxApi().then(null, function () {}); return; }
      }, { rootMargin: '300px' });
      io.observe(root);
    } else { muxApi().then(null, function () {}); }
  }

  // Løkke før avspilling: stum video oppå forhåndsbildet til leseren trykker play.
  // Starter først når siden er ferdig lastet og boksen er synlig, pauser utenfor
  // skjermen / i skjult fane. Ikke ved «redusert bevegelse», datasparing eller 2G.
  var LP = D.loop || null, loopV = null, loopIO = null, loopVis = false;
  function stopLoop() {
    if (loopIO) { try { loopIO.disconnect(); } catch (x) {} loopIO = null; }
    if (loopV) {
      try { loopV.pause(); loopV.removeAttribute('src'); loopV.load(); } catch (x) {}
      if (loopV.parentNode) loopV.parentNode.removeChild(loopV);
      loopV = null;
    }
  }
  function loopOk() {
    if (!LP || !(LP.big || LP.small) || idx !== 0) return false;
    if (!('IntersectionObserver' in window)) return false;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (x) {}
    try { var c = navigator.connection; if (c && (c.saveData || /2g$/.test(c.effectiveType || ''))) return false; } catch (x) {}
    return true;
  }
  function loopSrc() {
    var px = (stage.clientWidth || 640) * Math.min(window.devicePixelRatio || 1, 2);
    if (LP.small && (!LP.big || px <= 900)) return LP.small;
    return LP.big || LP.small;
  }
  function loopPlay() {
    if (!loopV) return;
    if (loopVis && !document.hidden) {
      if (!loopV.getAttribute('src')) { loopV.setAttribute('src', loopSrc()); try { loopV.load(); } catch (x) {} }
      try { var pr = loopV.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (x) {}
    } else { try { loopV.pause(); } catch (x) {} }
  }
  function startLoop() {
    if (!loopOk()) return;
    var b = q('.fpod-facade');
    if (!b || loopV) return;
    var v = document.createElement('video');
    v.className = 'fpod-loop';
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = true;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('loop', '');
    v.setAttribute('preload', 'none'); v.setAttribute('aria-hidden', 'true'); v.setAttribute('tabindex', '-1');
    v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', '');
    v.addEventListener('playing', function () { v.className = 'fpod-loop is-on'; });
    v.addEventListener('error', function () { stopLoop(); });
    b.insertBefore(v, b.querySelector('.fpod-bigplay'));
    loopV = v;
    var go = function () {
      if (!loopV) return;
      loopIO = new IntersectionObserver(function (en) {
        for (var z = 0; z < en.length; z++) loopVis = en[z].isIntersecting;
        loopPlay();
      }, { threshold: 0.25 });
      loopIO.observe(stage);
    };
    if (document.readyState === 'complete') setTimeout(go, 300);
    else window.addEventListener('load', function () { setTimeout(go, 300); });
  }
  document.addEventListener('visibilitychange', loopPlay);

  show(0);
  facade();
  startLoop();
}

if (typeof window !== 'undefined') window.fpodRun = fpodRun;
