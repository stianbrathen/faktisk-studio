// Mobilnettverk · bygger embed-koden (brukes av både Studio-editoren og prototypen)
// cfg: { items:[{src,caption,alt}], front, mid, back, size, seed, lineColor, bg, motion, trigger,
//        aspect, width, round, hint, alt, caption, padTop, padBot }
function fmnBuildSnippet(cfg, engineSrc, baseCss) {
  var id = 'fmn-' + Math.random().toString(36).slice(2, 8);
  var S = '.fmn-' + id, B = '.fmn-box-' + id, LB = '.fmn-lb-' + id;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var maxW = cfg.width === 'full' || !cfg.width ? '100%' : (parseInt(cfg.width, 10) || 680) + 'px';
  var aspect = (cfg.aspect || '16/9').replace('/', ' / ');
  var mobAspect = cfg.aspect === '1/1' ? '1 / 1' : '4 / 5';
  var vspace = function (v, side) {
    var n = isFinite(v) ? Math.max(-24, Math.min(64, v)) : 12;
    return n >= 0 ? 'padding-' + side + ': ' + n + 'px;' : 'padding-' + side + ': 0; margin-' + side + ': ' + n + 'px;';
  };
  var bg = cfg.bg || 'navy';
  var light = bg === 'white' || bg === 'none';
  var bgCss = bg === 'black' ? 'radial-gradient(120% 90% at 50% 45%, #10161f 0%, #07090d 55%, #000 100%)'
    : bg === 'white' ? '#fff'
    : bg === 'none' ? 'transparent'
    : 'radial-gradient(120% 90% at 50% 45%, #15305a 0%, #0a1830 45%, #030812 100%)';
  var shadow = !!cfg.shadow;
  var run = {
    items: (cfg.items || []).filter(function (i) { return i && i.src; }).map(function (i) { return { src: i.src, caption: i.caption || '', alt: i.alt || '' }; }),
    front: cfg.front, mid: cfg.mid, back: cfg.back, size: cfg.size, seed: cfg.seed,
    lineColor: cfg.lineColor, motion: cfg.motion, trigger: cfg.trigger, drag: cfg.drag !== false && cfg.view !== 'side',
    view: cfg.view === 'ring' || cfg.view === 'side' ? cfg.view : 'net', ring: cfg.ring, arrows: cfg.arrows !== false, count: cfg.count,
    bg: bg, net: cfg.net !== false,
  };
  var json = JSON.stringify(run).replace(/</g, '\\u003c');
  var css = (baseCss || '') + '\n' +
    '.fmn-container { container-type: inline-size; }\n' +
    '.fmn-container' + B + ' { ' + vspace(cfg.padTop, 'top') + ' ' + vspace(cfg.padBot, 'bottom') + ' }\n' +
    B + ' .fmn-frame { max-width: ' + maxW + '; margin: 0 auto; }\n' +
    S + ' { position: relative; width: 100%; aspect-ratio: ' + aspect + '; overflow: hidden; background: ' + bgCss + ';' + (cfg.round !== false ? ' border-radius: 14px;' : '') + ' isolation: isolate; }\n' +
    S + ' canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n' +
    S + ' .fmn-stage { position: absolute; inset: 0; }\n' +
    S + ' .fmn-ph { position: absolute; display: block; margin: 0; padding: 0; border: 0; border-radius: 14% / 6.5%;' +
    ' background: linear-gradient(160deg, #2b3343, #0e1118 38%, #06080c); box-shadow: 0 0 0 1px rgba(160,190,230,.26), 0 14px 40px rgba(0,0,0,.55);' +
    ' opacity: 0; will-change: transform, opacity; -webkit-tap-highlight-color: transparent; font: inherit; color: inherit; }\n' +
    S + ' button.fmn-ph { cursor: zoom-in; }\n' +
    S + ' .fmn-scr { position: absolute; inset: 3% 4.5%; border-radius: 11% / 5%; overflow: hidden; background: #000; display: block; }\n' +
    S + ' .fmn-scr img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; pointer-events: none; }\n' +
    S + ' .fmn-isl, ' + LB + ' .fmn-isl { position: absolute; top: 2.4%; left: 50%; width: 30%; height: 3%; transform: translateX(-50%); border-radius: 99px; background: #000; }\n' +
    S + ' .fmn-L0 .fmn-scr img { filter: blur(1.2px) brightness(.5); }\n' +
    S + ' .fmn-L1 .fmn-scr img { filter: brightness(.8); }\n' +
    S + ' .fmn-L2 { box-shadow: 0 0 0 1.5px rgba(170,215,255,.55), 0 0 24px rgba(110,170,255,.22), 0 18px 50px rgba(0,0,0,.6); }\n' +
    S + ' button.fmn-ph:hover, ' + S + ' button.fmn-ph:focus-visible { box-shadow: 0 0 0 2px #9fd0ff, 0 0 30px rgba(120,190,255,.45), 0 18px 50px rgba(0,0,0,.6); outline: none; }\n' +
    S + ' .fmn-hint { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); z-index: 1000; padding: 6px 12px; border-radius: 99px;' +
    ' background: rgba(6,14,30,.7); color: #d6e6ff; font: 12px/1.2 var(--fk-font, Helvetica, Arial, sans-serif); white-space: nowrap; pointer-events: none; }\n' +
    // Karusell (3D)
    S + ' .fmn-ring { transform-origin: 50% 50%; will-change: transform, opacity, filter; cursor: pointer; }\n' +
    S + ' .fmn-ring.fmn-front { cursor: zoom-in; box-shadow: 0 0 0 1.5px rgba(170,215,255,.6), 0 0 34px rgba(110,170,255,.3), 0 20px 60px rgba(0,0,0,.6); }\n' +
    S + ' .fmn-arr { position: absolute; top: 50%; z-index: 1500; width: 44px; height: 44px; margin-top: -22px; border: 0; border-radius: 50%;' +
    ' background: rgba(8,18,38,.72); color: #fff; font: 300 30px/1 Helvetica, Arial, sans-serif; cursor: pointer; display: flex; align-items: center; justify-content: center;' +
    ' box-shadow: 0 0 0 1px rgba(170,215,255,.35); }\n' +
    S + ' .fmn-arr:hover, ' + S + ' .fmn-arr:focus-visible { background: rgba(30,60,110,.9); outline: none; }\n' +
    S + ' .fmn-arr-prev { left: 12px; } ' + S + ' .fmn-arr-next { right: 12px; }\n' +
    // Lys / ingen bakgrunn: tynn mørk kant i stedet for blå glød
    (light ?
      S + ' .fmn-ph, ' + S + ' .fmn-L2, ' + S + ' .fmn-ring.fmn-front { box-shadow: 0 0 0 1px rgba(20,30,50,.22); }\n' +
      S + ' .fmn-L0 .fmn-scr img { filter: blur(1.2px) brightness(.85); }\n' +
      S + ' .fmn-L1 .fmn-scr img { filter: none; }\n' +
      S + ' button.fmn-ph:hover, ' + S + ' button.fmn-ph:focus-visible { box-shadow: 0 0 0 2px #0050FC; }\n' +
      // Ingen synlig boks-kant mot hvitt: telefoner og linjer tones ut mot sidene (pilene og hintet berøres ikke)
      (cfg.fade === false ? '' : S + ' canvas' + (cfg.view === 'side' ? '' : ', ' + S + ' .fmn-stage') + ' { -webkit-mask-image: linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent); mask-image: linear-gradient(90deg, transparent, #000 9%, #000 91%, transparent); }\n') : '') +
    // Skygge under mobilene (valgfri): myk ellipse på «gulvet» + litt slagskygge
    (shadow ?
      S + ' .fmn-ph::after { content: ""; position: absolute; left: 6%; right: 6%; bottom: -9%; height: 7%; border-radius: 50%; pointer-events: none;' +
      ' background: radial-gradient(closest-side, rgba(0,0,0,' + (light ? '.38' : '.7') + '), rgba(0,0,0,0)); }\n' +
      S + ' .fmn-ph { filter: drop-shadow(0 ' + (light ? '14px 18px rgba(0,0,0,.22)' : '14px 18px rgba(0,0,0,.5)') + '); }\n' : '') +
    '@container (max-width: 560px) { ' + S + ' { aspect-ratio: ' + mobAspect + ';' + (cfg.round !== false ? ' border-radius: 10px;' : '') + ' } }\n' +
    B + ' .fmn-caption { max-width: ' + maxW + '; margin: .6em auto 0; font-family: var(--fk-font); font-size: 14px; line-height: 1.45; color: #5A5A5A; }\n' +
    // Lysboks (ligger i <body>, scopet med id)
    LB + ' { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; background: rgba(3,8,18,.9);' +
    ' -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); opacity: 0; visibility: hidden; transition: opacity .25s, visibility .25s; }\n' +
    LB + '.is-open { opacity: 1; visibility: visible; }\n' +
    LB + ' .fmn-bx-in { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 56px 16px 40px; box-sizing: border-box; max-height: 100%; }\n' +
    LB + ' .fmn-bx-ph { position: relative; width: min(86vw, calc(min(78vh, 800px) * .47)); aspect-ratio: .47; border-radius: 14% / 6.5%;' +
    ' background: linear-gradient(160deg, #2b3343, #0e1118 38%, #06080c); box-shadow: 0 0 0 1.5px rgba(170,215,255,.5), 0 30px 80px rgba(0,0,0,.7); }\n' +
    LB + ' .fmn-bx-scr { position: absolute; inset: 2.6% 4%; border-radius: 10% / 4.6%; overflow-y: auto; overscroll-behavior: contain; background: #000; -webkit-overflow-scrolling: touch; }\n' +
    LB + ' .fmn-bx-scr img { display: block; width: 100%; min-height: 100%; object-fit: cover; object-position: top center; }\n' +
    LB + ' .fmn-bx-cap { margin: 0; max-width: min(560px, 90vw); color: #e8eef8; text-align: center; font: 15px/1.45 var(--fk-font, Helvetica, Arial, sans-serif); }\n' +
    LB + ' .fmn-bx-x, ' + LB + ' .fmn-bx-nav { position: absolute; border: 0; border-radius: 50%; background: rgba(255,255,255,.14); color: #fff; cursor: pointer;' +
    ' display: flex; align-items: center; justify-content: center; font: 300 30px/1 Helvetica, Arial, sans-serif; }\n' +
    LB + ' .fmn-bx-x { top: 12px; right: 12px; width: 44px; height: 44px; }\n' +
    LB + ' .fmn-bx-nav { top: 50%; width: 48px; height: 48px; margin-top: -24px; }\n' +
    LB + ' .fmn-bx-prev { left: max(10px, calc(50% - min(86vw, calc(min(78vh, 800px) * .47)) / 2 - 64px)); }\n' +
    LB + ' .fmn-bx-next { right: max(10px, calc(50% - min(86vw, calc(min(78vh, 800px) * .47)) / 2 - 64px)); }\n' +
    LB + ' .fmn-bx-x:hover, ' + LB + ' .fmn-bx-nav:hover { background: rgba(255,255,255,.26); }\n' +
    LB + ' .fmn-bx-cnt { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); color: #9fb0c8; font: 13px/1 Helvetica, Arial, sans-serif; }\n' +
    LB + ' .fmn-pop { animation: fmn-pop-' + id + ' .38s cubic-bezier(.2,1.2,.4,1); }\n' +
    '@keyframes fmn-pop-' + id + ' { from { transform: scale(.88); opacity: 0; } to { transform: none; opacity: 1; } }\n' +
    '@media (prefers-reduced-motion: reduce) { ' + LB + ' .fmn-pop { animation: none; } }\n';
  var hint = cfg.hint === false || !run.items.length ? '' : '<span class="fmn-hint">' + esc(cfg.hintText || (cfg.view === 'ring' ? 'Dra eller bruk pilene · trykk på mobilen foran for å se skjermbildet' : cfg.view === 'side' ? (run.items.length > 1 ? 'Trykk på en mobil for å se skjermbildet' : 'Trykk på mobilen for å se skjermbildet') : cfg.drag !== false ? 'Dra i nettverket · trykk på en mobil for å se skjermbildet' : 'Trykk på en mobil for å se skjermbildet')) + '</span>';
  return '\x3C!-- ============================================\n' +
    '     FAKTISK · MOBILNETTVERK' + (cfg.version ? ' · v' + cfg.version : '') + '\n' +
    '     Skjermbilder på telefoner i et nettverk. Utseende endres i Faktisk Studio.\n' +
    '     ============================================ -->\n' +
    '<style>' + css + '</style>\n' +
    '<div class="fmn-container fmn-box-' + id + '">\n' +
    '  <div class="fmn-frame">\n' +
    '    <div class="fmn-' + id + '" id="' + id + '" role="group" aria-label="' + esc(cfg.alt || 'Skjermbilder vist på mobiltelefoner') + '"><canvas aria-hidden="true"></canvas><div class="fmn-stage"></div>' + hint + '</div>\n' +
    '  </div>' + (cfg.caption ? '\n  \x3C!-- ▶ BILDETEKST -->\n  <div class="fmn-caption">' + esc(cfg.caption) + '</div>' : '') + '\n' +
    '</div>\n' +
    '\x3Cscript>\n(function () {\n  var C = ' + json + ';\n  (' + engineSrc + ')(document.getElementById(\'' + id + '\'), C);\n})();\n<\/script>\n';
}
