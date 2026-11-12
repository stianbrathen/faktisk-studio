// Personbilde · bygger embed-koden (brukes av Studio-editoren)
// Et bilde (fra Labrador) med navn og tittel: under bildet, i bobler som popper opp, eller i en boks.
// Ren HTML/CSS + et lite ES5-skript som starter animasjonen når leseren scroller dit. Ingen base64.
function fpbBuildSnippet(cfg, baseCss) {
  var id = 'fpb-' + Math.random().toString(36).slice(2, 8);
  var S = '.fpb-' + id;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (v, d) { v = parseFloat(v); return isFinite(v) ? v : d; };
  var circle = cfg.shape === 'circle';
  var aspect = circle ? '1 / 1' : (cfg.aspect && cfg.aspect !== 'auto' ? cfg.aspect.replace('/', ' / ') : '');
  var radius = circle ? '50%' : num(cfg.radius, 16) + 'px';
  var maxW = Math.round(num(cfg.width, 360));
  var align = cfg.align === 'left' ? '0 auto 0 0' : '0 auto';
  var fx = num(cfg.focusX, 50), fy = num(cfg.focusY, 50), zoom = Math.max(1, num(cfg.zoom, 1));
  var shadow = cfg.shadow === 'strong' ? '0 18px 44px rgba(0,0,0,.38), 0 4px 10px rgba(0,0,0,.18)' : cfg.shadow === 'soft' ? '0 8px 24px rgba(0,0,0,.18)' : 'none';
  var border = cfg.frame ? num(cfg.frameW, 4) + 'px solid ' + (cfg.frameColor || '#ffffff') : '0';
  var breathe = cfg.breathe || 'none', amt = num(cfg.breatheAmt, 4) / 100, dur = num(cfg.breatheDur, 8);
  var mode = cfg.textMode || 'under';
  var B = { light: ['#ffffff', '#212121'], dark: ['#212121', '#ffffff'], blue: ['#0050FC', '#ffffff'], grey: ['#ECEDEF', '#212121'] };
  var bc = B[cfg.bubbleStyle] || B.light, kc = B[cfg.boxStyle] || B.dark;
  var hasName = !!(cfg.name || '').trim(), hasTitle = !!(cfg.title || '').trim();
  var font = 'var(--fk-font, "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif)';
  var css = (baseCss || '') + '\n' +
    '.fpb-container { container-type: inline-size; }\n' +
    S + ' { margin: ' + align + '; max-width: ' + maxW + 'px; font-family: ' + font + '; color: var(--fk-ink, #212121); padding: 0; }\n' +
    S + ' .fpb-media { position: relative; }\n' +
    S + ' .fpb-frame { position: relative; overflow: hidden; border-radius: ' + radius + '; border: ' + border + '; box-shadow: ' + shadow + ';' + (aspect ? ' aspect-ratio: ' + aspect + ';' : '') + ' background: #d9d9d9; box-sizing: border-box; }\n' +
    S + ' .fpb-frame picture { display: contents; }\n' +
    S + ' .fpb-frame img { display: block; width: 100%; ' + (aspect ? 'height: 100%; object-fit: cover; ' : 'height: auto; ') + 'object-position: ' + fx + '% ' + fy + '%; transform-origin: ' + fx + '% ' + fy + '%; transform: scale(' + zoom + '); margin: 0; max-width: none; }\n' +
    // langsom «pust»: inni rammen (bildet zoomer litt) eller hele bildet
    (breathe === 'inner' ? S + ' .fpb-frame img { animation: fpbB-' + id + ' ' + dur + 's ease-in-out infinite alternate; }\n' +
      '@keyframes fpbB-' + id + ' { from { transform: scale(' + zoom + '); } to { transform: scale(' + (zoom * (1 + amt)).toFixed(4) + '); } }\n' : '') +
    (breathe === 'whole' ? S + ' .fpb-frame { animation: fpbB-' + id + ' ' + dur + 's ease-in-out infinite alternate; }\n' +
      '@keyframes fpbB-' + id + ' { from { transform: scale(1); } to { transform: scale(' + (1 + amt).toFixed(4) + '); } }\n' : '') +
    // tekst under bildet
    S + ' .fpb-text { margin: .7em 0 0; text-align: ' + (cfg.textAlign === 'left' ? 'left' : 'center') + '; line-height: 1.3; }\n' +
    S + ' .fpb-name { display: block; font-weight: var(--fk-fw-bold, 500); font-size: clamp(17px, 5.2cqw, 24px); }\n' +
    S + ' .fpb-title { display: block; font-weight: var(--fk-fw-normal, 300); font-size: clamp(14px, 4cqw, 18px); color: var(--fk-ink-dim, #5A5A5A); margin-top: .15em; }\n' +
    // bobler som popper opp
    S + ' .fpb-bub { position: absolute; z-index: 2; max-width: 78%; width: max-content; padding: .45em .8em; border-radius: 1.1em; background: ' + bc[0] + '; color: ' + bc[1] + ';' +
      ' font-size: clamp(13px, 4.2cqw, 19px); line-height: 1.25; box-shadow: 0 6px 18px rgba(0,0,0,.22); transform: translate(-50%, -50%); }\n' +
    S + ' .fpb-bub b { font-weight: var(--fk-fw-bold, 500); } ' + S + ' .fpb-bub span { font-weight: var(--fk-fw-normal, 300); }\n' +
    S + ' .fpb-bub::after { content: ""; position: absolute; bottom: -.32em; width: .9em; height: .9em; background: inherit; border-radius: 0 0 .2em 0; transform: rotate(45deg); }\n' +
    S + ' .fpb-tail-left::after { left: 1em; } ' + S + ' .fpb-tail-right::after { right: 1em; } ' + S + ' .fpb-tail-none::after { display: none; }\n' +
    // boks med avrundede hjørner (under bildet eller nederst i bildet)
    S + ' .fpb-card { background: ' + kc[0] + '; color: ' + kc[1] + '; border-radius: ' + num(cfg.boxRadius, 12) + 'px; padding: .7em 1em; line-height: 1.3; box-sizing: border-box; }\n' +
    S + ' .fpb-card .fpb-name { font-size: clamp(16px, 4.8cqw, 22px); } ' + S + ' .fpb-card .fpb-title { color: inherit; opacity: .8; }\n' +
    S + ' .fpb-card--below { margin: .7em 0 0; text-align: ' + (cfg.textAlign === 'left' ? 'left' : 'center') + '; }\n' +
    S + ' .fpb-card--over { position: absolute; z-index: 2; ' + (circle ? 'left: 15%; right: 15%; bottom: 5%; text-align: center;' : 'left: 6%; right: 6%; bottom: 6%;') + ' }\n' +
    S + ' .fpb-credit { margin: .5em 0 0; font-size: 12px; line-height: 1.4; color: var(--fk-ink-dim, #5A5A5A); text-align: ' + (cfg.textAlign === 'left' ? 'left' : 'center') + '; }\n' +
    // animasjon inn når leseren kommer dit (bare når skriptet kjører; uten skript vises alt)
    S + '.fpb-anim .fpb-pop { opacity: 0; transform: translate(-50%, -50%) scale(.4); }\n' +
    S + '.fpb-anim .fpb-card.fpb-pop { transform: translateY(14px); }\n' +
    S + '.fpb-anim.is-in .fpb-pop { opacity: 1; transform: translate(-50%, -50%) scale(1); transition: transform .55s cubic-bezier(.34, 1.5, .64, 1), opacity .25s ease-out; }\n' +
    S + '.fpb-anim.is-in .fpb-card.fpb-pop { transform: none; transition: transform .6s cubic-bezier(.22, 1, .36, 1), opacity .4s ease-out; }\n' +
    '@media (prefers-reduced-motion: reduce) { ' + S + ' .fpb-frame, ' + S + ' .fpb-frame img { animation: none !important; } ' + S + '.fpb-anim .fpb-pop { opacity: 1 !important; transition: none !important; } ' + S + '.fpb-anim .fpb-bub { transform: translate(-50%, -50%) !important; } ' + S + '.fpb-anim .fpb-card.fpb-pop { transform: none !important; } }\n';

  var delay = num(cfg.popDelay, 0.25), gap = num(cfg.popGap, 0.35), k = 0;
  var bubble = function (cls, inner, pos, tail) {
    var d = (delay + gap * (k++)).toFixed(2);
    return '      <div class="fpb-bub fpb-pop fpb-tail-' + (tail || 'left') + ' ' + cls + '" style="left:' + num(pos && pos.x, 50) + '%;top:' + num(pos && pos.y, 85) + '%;transition-delay:' + d + 's">' + inner + '</div>\n';
  };
  var over = '', below = '';
  if (mode === 'bubbles') {
    if (cfg.oneBubble) { if (hasName || hasTitle) over += bubble('fpb-bub--one', (hasName ? '<b>' + esc(cfg.name) + '</b>' : '') + (hasName && hasTitle ? '<br>' : '') + (hasTitle ? '<span>' + esc(cfg.title) + '</span>' : ''), cfg.posName, cfg.tailName); }
    else {
      if (hasName) over += bubble('fpb-bub--name', '<b>' + esc(cfg.name) + '</b>', cfg.posName, cfg.tailName);
      if (hasTitle) over += bubble('fpb-bub--title', '<span>' + esc(cfg.title) + '</span>', cfg.posTitle, cfg.tailTitle);
    }
  } else if (mode === 'box' && (hasName || hasTitle)) {
    var card = '<div class="fpb-card fpb-pop fpb-card--' + (cfg.boxPlace === 'over' ? 'over' : 'below') + '" style="transition-delay:' + delay.toFixed(2) + 's">' +
      (hasName ? '<span class="fpb-name">' + esc(cfg.name) + '</span>' : '') + (hasTitle ? '<span class="fpb-title">' + esc(cfg.title) + '</span>' : '') + '</div>';
    if (cfg.boxPlace === 'over') over += '      ' + card + '\n'; else below += '    ' + card + '\n';
  } else if (mode === 'under' && (hasName || hasTitle)) {
    below += '    <figcaption class="fpb-text">' + (hasName ? '<span class="fpb-name">' + esc(cfg.name) + '</span>' : '') + (hasTitle ? '<span class="fpb-title">' + esc(cfg.title) + '</span>' : '') + '</figcaption>\n';
  }
  var alt = cfg.alt || [cfg.name, cfg.title].filter(function (x) { return x && x.trim(); }).join(', ') || 'Portrett';
  var anim = mode === 'bubbles' || mode === 'box';
  return '\x3C!-- ============================================\n' +
    '     FAKTISK · PERSONBILDE' + (cfg.version ? ' · v' + cfg.version : '') + '\n' +
    '     Bilde med navn og tittel. Endres i Faktisk Studio.\n' +
    '     ============================================ -->\n' +
    '<style>' + css + '</style>\n' +
    '<div class="fpb-container">\n' +
    '  <figure class="fpb-' + id + '" id="' + id + '">\n' +
    '    <div class="fpb-media">\n' +
    '      <div class="fpb-frame">' + (cfg.src ? fpbImg(cfg, alt, maxW, esc) : '') + '</div>\n' +
    over +
    '    </div>\n' +
    below +
    (cfg.credit ? '    <p class="fpb-credit">' + esc(cfg.credit) + '</p>\n' : '') +
    '  </figure>\n' +
    '</div>\n' +
    (anim ? '\x3Cscript>\n(function () {\n' +
      '  var el = document.getElementById(\'' + id + '\'); if (!el || el.__fpb) return; el.__fpb = 1;\n' +
      '  if (!window.IntersectionObserver) return;\n' +
      '  el.className += \' fpb-anim\';\n' +
      '  var io = new IntersectionObserver(function (es) { for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { el.className += \' is-in\'; io.disconnect(); } }, { threshold: ' + (cfg.static ? 0 : 0.45) + ' });\n' +
      '  io.observe(el);\n' +
      '})();\n<\/script>\n' : '');
}

// Bildet: med komprimerte varianter fra Studio blir det <picture> med AVIF og
// JPG/WebP i flere bredder, så mobilen henter den lille og retina-skjermer
// den store. Uten varianter: vanlig <img> som før.
function fpbImg(cfg, alt, maxW, esc) {
  var v = cfg.srcVariants, attrs = ' alt="' + esc(alt) + '" loading="lazy" decoding="async"';
  if (!v || !v.fallback || !v.fallback.length) return '<img src="' + esc(cfg.src) + '"' + attrs + '>';
  var set = function (arr) { return arr.map(function (x) { return esc(x.url) + ' ' + x.w + 'w'; }).join(', '); };
  // zoom forstørrer bildet i rammen, så be om tilsvarende større fil
  var z = Math.max(1, parseFloat(cfg.zoom) || 1), zs = z > 1.01 ? ' * ' + z.toFixed(2) : '';
  var sizes = zs ? '(max-width: ' + maxW + 'px) calc(100vw' + zs + '), ' + Math.round(maxW * z) + 'px' : '(max-width: ' + maxW + 'px) 100vw, ' + maxW + 'px';
  var fb = v.fallback, top = fb[fb.length - 1];
  return '<picture>' +
    (v.avif && v.avif.length ? '<source type="image/avif" srcset="' + set(v.avif) + '" sizes="' + sizes + '">' : '') +
    '<img src="' + esc(top.url) + '" srcset="' + set(fb) + '" sizes="' + sizes + '"' + attrs + '></picture>';
}
