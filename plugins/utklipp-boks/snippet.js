// Utklipp i boks · bygger embed-koden (brukes av Studio-editoren)
// Et utklippet bilde (PNG uten bakgrunn, f.eks. en hånd med et ID-kort) i en boks med farge, bilde eller video bak.
// Utklippet glir opp fra bunnen når leseren scroller dit, og blir stående. Ren HTML/CSS + et lite ES5-skript. Ingen base64.
function fubBuildSnippet(cfg, baseCss) {
  var id = 'fub-' + Math.random().toString(36).slice(2, 8);
  var S = '.fub-' + id;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v, d) { v = parseFloat(v); return isFinite(v) ? v : d; };
  var safe = function (u) { return String(u || '').trim().replace(/ /g, '%20'); };
  var aspect = (cfg.aspect || '4/5').replace('/', ' / ');
  var mob = cfg.mobileAspect && cfg.mobileAspect !== 'same' ? cfg.mobileAspect.replace('/', ' / ') : '';
  var maxW = Math.round(num(cfg.width, 520));
  var align = cfg.align === 'left' ? '0 auto 0 0' : '0 auto';
  var radius = num(cfg.radius, 18);
  var shadow = cfg.shadow === 'strong' ? '0 18px 44px rgba(0,0,0,.34), 0 4px 10px rgba(0,0,0,.16)' : cfg.shadow === 'soft' ? '0 8px 24px rgba(0,0,0,.16)' : 'none';
  var bgType = cfg.bgType || 'color';
  var bgSrc = safe(cfg.bgSrc);
  var bgBlur = num(cfg.bgBlur, 0), bgDim = Math.max(0, Math.min(0.9, num(cfg.bgDim, 0)));
  var fx = num(cfg.fgX, 50), fw = Math.max(5, num(cfg.fgW, 70)), fb = num(cfg.fgBottom, 0), rot = num(cfg.fgRot, 0);
  var dur = Math.max(0.2, num(cfg.dur, 1.1)), delay = Math.max(0, num(cfg.delay, 0.15));
  var ease = cfg.ease === 'bounce' ? 'cubic-bezier(.34, 1.36, .64, 1)' : cfg.ease === 'soft' ? 'cubic-bezier(.16, 1, .3, 1)' : 'cubic-bezier(.22, 1, .36, 1)';
  var from = cfg.from || 'bottom';
  var FROM = { bottom: 'translateY(110%)', left: 'translateX(-120%)', right: 'translateX(120%)', zoom: 'scale(.6)' }[from] || 'translateY(110%)';
  var fgShadow = cfg.fgShadow ? ' filter: drop-shadow(0 ' + (fw * 0.06).toFixed(2) + 'cqw ' + (fw * 0.12).toFixed(2) + 'cqw rgba(0,0,0,.35));' : '';
  var font = 'var(--fk-font, "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif)';
  var css = (baseCss || '') + '\n' +
    '.fub-container { container-type: inline-size; }\n' +
    S + ' { margin: ' + align + '; max-width: ' + maxW + 'px; font-family: ' + font + '; padding: 0; }\n' +
    S + ' .fub-box { position: relative; overflow: hidden; aspect-ratio: ' + aspect + '; border-radius: ' + radius + 'px; background: ' + (cfg.bgColor || '#0050FC') + '; box-shadow: ' + shadow + '; isolation: isolate; container-type: inline-size; -webkit-mask-image: -webkit-radial-gradient(white, black); }\n' +
    (mob ? '@container (max-width: 520px) { ' + S + ' .fub-box { aspect-ratio: ' + mob + '; } }\n' : '') +
    S + ' .fub-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; margin: 0; max-width: none;' + (bgBlur > 0 ? ' filter: blur(' + bgBlur + 'px); transform: scale(' + (1 + bgBlur * 0.012).toFixed(3) + ');' : '') + ' }\n' +
    // iOS viser en stor spill-knapp over video som ikke får starte — stillbildet skal stå rent
    S + ' video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none; }\n' +
    S + ' video::-webkit-media-controls { display: none !important; }\n' +
    (bgDim > 0 ? S + ' .fub-dim { position: absolute; inset: 0; background: rgba(0,0,0,' + bgDim + '); }\n' : '') +
    S + ' .fub-fg { position: absolute; left: ' + fx + '%; bottom: ' + fb + '%; width: ' + fw + '%; transform: translateX(-50%)' + (rot ? ' rotate(' + rot + 'deg)' : '') + '; transform-origin: 50% 100%; z-index: 2; }\n' +
    S + ' .fub-fg img { display: block; width: 100%; height: auto; margin: 0; max-width: none;' + fgShadow + ' }\n' +
    S + ' .fub-cap { margin: .55em 0 0; font-size: 13px; line-height: 1.4; color: var(--fk-ink-dim, #5A5A5A); text-align: ' + (cfg.align === 'left' ? 'left' : 'center') + '; }\n' +
    // animasjon: bare når skriptet kjører (uten skript står utklippet på plass)
    S + '.fub-anim .fub-fg img { transform: ' + FROM + ';' + (from === 'zoom' ? ' opacity: 0;' : '') + ' }\n' +
    S + '.fub-anim.is-in .fub-fg img { transform: none; opacity: 1; transition: transform ' + dur + 's ' + ease + ' ' + delay + 's, opacity ' + Math.min(0.4, dur) + 's ease-out ' + delay + 's; }\n' +
    '@media (prefers-reduced-motion: reduce) { ' + S + '.fub-anim .fub-fg img { transform: none !important; opacity: 1 !important; transition: none !important; } }\n';
  var bg = '';
  if (bgType === 'image' && bgSrc) bg = '      <img class="fub-bg" src="' + esc(bgSrc) + '" alt="" loading="lazy" decoding="async">\n';
  // poster: stillbilde når autoplay er blokkert (lav strømmodus på iPhone)
  else if (bgType === 'video' && bgSrc) bg = '      <video class="fub-bg" src="' + esc(bgSrc) + '"' + (cfg.bgPoster ? ' poster="' + esc(safe(cfg.bgPoster)) + '"' : '') + ' muted loop playsinline autoplay preload="metadata" aria-hidden="true"></video>\n';
  var alt = cfg.alt || 'Illustrasjon';
  var fg = cfg.fgSrc ? '      <div class="fub-fg"><img src="' + esc(safe(cfg.fgSrc)) + '" alt="' + esc(alt) + '" decoding="async"></div>\n' : '';
  var vid = bgType === 'video' && bgSrc;
  return '\x3C!-- ============================================\n' +
    '     FAKTISK · UTKLIPP I BOKS' + (cfg.version ? ' · v' + cfg.version : '') + '\n' +
    '     Utklippet bilde som glir inn i en boks. Endres i Faktisk Studio.\n' +
    '     ============================================ -->\n' +
    '<style>' + css + '</style>\n' +
    '<div class="fub-container">\n' +
    '  <figure class="fub-' + id + '" id="' + id + '">\n' +
    '    <div class="fub-box">\n' +
    bg +
    (bgDim > 0 ? '      <div class="fub-dim"></div>\n' : '') +
    fg +
    '    </div>\n' +
    (cfg.caption ? '    <figcaption class="fub-cap">' + esc(cfg.caption) + '</figcaption>\n' : '') +
    '  </figure>\n' +
    '</div>\n' +
    '\x3Cscript>\n(function () {\n' +
    '  var el = document.getElementById(\'' + id + '\'); if (!el || el.__fub) return; el.__fub = 1;\n' +
    (vid ? '  var v = el.querySelector(\'video\');\n' : '') +
    '  if (!window.IntersectionObserver) return;\n' +
    '  el.className += \' fub-anim\';\n' +
    '  var io = new IntersectionObserver(function (es) {\n' +
    '    for (var i = 0; i < es.length; i++) {\n' +
    '      if (es[i].isIntersecting && es[i].intersectionRatio >= ' + (cfg.static ? 0 : 0.4) + ') { if (el.className.indexOf(\'is-in\') < 0) el.className += \' is-in\'; }\n' +
    (vid ? '      if (v) { if (es[i].isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }\n' : '') +
    '    }\n' +
    '  }, { threshold: [0, ' + (cfg.static ? 0 : 0.4) + '] });\n' +
    '  io.observe(el);\n' +
    // blokkert autoplay: første trykk på siden starter videoen
    (vid ? '  var un = function () { if (v && v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } document.removeEventListener(\'touchend\', un); document.removeEventListener(\'click\', un); };\n  document.addEventListener(\'touchend\', un, { passive: true }); document.addEventListener(\'click\', un);\n' : '') +
    '})();\n<\/script>\n';
}
