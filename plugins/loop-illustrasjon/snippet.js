// Loop-illustrasjon · bygger embed-koden (brukes av Studio-editoren)
// cfg: { aspect, mobileAspect, loop, bg, layers, trigger, width, round, alt, caption, padTop, padBot, posterT, posters, version }
// posters: { videoadresse: stillbilde-adresse } — vises når autoplay er blokkert (lav strømmodus på iPhone)
function fliBuildSnippet(cfg, engineSrc, baseCss) {
  var id = 'fli-' + Math.random().toString(36).slice(2, 8);
  var S = '.fli-' + id, B = '.fli-box-' + id;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var maxW = cfg.width === 'full' || !cfg.width ? '100%' : (parseInt(cfg.width, 10) || 680) + 'px';
  var aspect = (cfg.aspect || '1/1').replace('/', ' / ');
  var mob = cfg.mobileAspect && cfg.mobileAspect !== 'same' ? cfg.mobileAspect.replace('/', ' / ') : '';
  // maks høyde (andel av skjermhøyden): bredden begrenses så høyden aldri blir større
  var ratio = function (a) { var p = String(a || '1/1').split('/'); return (parseFloat(p[0]) || 1) / (parseFloat(p[1]) || 1); };
  var mh = parseInt(cfg.maxH, 10) || 0;
  var frameW = function (a) { return mh ? 'min(' + maxW + ', calc(' + mh + 'vh * ' + ratio(a).toFixed(4) + '))' : maxW; };
  var vspace = function (v, side) {
    var n = isFinite(v) ? Math.max(-24, Math.min(64, v)) : 12;
    return n >= 0 ? 'padding-' + side + ': ' + n + 'px;' : 'padding-' + side + ': 0; margin-' + side + ': ' + n + 'px;';
  };
  var bg = cfg.bg || { type: 'color', color: '#06080c' };
  // bare det motoren trenger — ingen lokale filer, ingen editor-felt
  var KEEP = ['id', 'type', 'name', 'group', 'hidden', 'src', 'srcs', 'x', 'y', 'size', 'scale', 'rot', 'opacity', 'tIn', 'tOut', 'enter', 'exit', 'dur',
    'spin', 'pulse', 'beats', 'zoom', 'float', 'blur', 'blurMode', 'seed', 'shape', 'shadow', 'count', 'itemSize', 'color', 'shape2', 'orient', 'ripple',
    'ringLine', 'lineColor', 'lineW', 'hole', 'links', 'area', 'nodeSize', 'motion', 'nodeStyle', 'glow', 'packets', 'rings', 'phoneSize', 'net', 'glowPh',
    'msgs', 'chatStyle', 'textSize', 'gap', 'bounce', 'typing', 'anchor', 'move', 'x2', 'y2', 'moveEase', 'movePh'];
  var layers = (cfg.layers || []).filter(function (l) { return !l.hidden; }).map(function (l) {
    var o = {}; KEEP.forEach(function (k) { if (l[k] !== undefined && l[k] !== '' && l[k] !== null) o[k] = l[k]; }); return o;
  });
  var run = { loop: cfg.loop, bg: bg, layers: layers, trigger: cfg.trigger || 'visible', posterT: cfg.posterT };
  if (cfg.posters && Object.keys(cfg.posters).length) run.posters = cfg.posters;
  var json = JSON.stringify(run).replace(/</g, '\\u003c');
  var bgCss = bg.type === 'none' ? 'transparent' : (bg.color || '#06080c');
  var css = (baseCss || '') + '\n' +
    '.fli-container { container-type: inline-size; }\n' +
    '.fli-container' + B + ' { ' + vspace(cfg.padTop, 'top') + ' ' + vspace(cfg.padBot, 'bottom') + (cfg.band && bg.type !== 'none' ? ' background: ' + (bg.color || '#06080c') + ';' : '') + ' }\n' +
    B + ' .fli-frame { max-width: ' + frameW(cfg.aspect) + '; margin: 0 auto; }\n' +
    S + ' { position: relative; width: 100%; aspect-ratio: ' + aspect + '; overflow: hidden; background: ' + bgCss + ';' + (cfg.round ? ' border-radius: 10px;' : '') + ' }\n' +
    S + ' canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n' +
    // iOS viser en stor spill-knapp over video som ikke får starte (lav strømmodus) — stillbildet skal stå rent
    S + ' video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none; }\n' +
    S + ' video::-webkit-media-controls { display: none !important; }\n' +
    // med farge i hele bredden tones kantene ut, så illustrasjonen glir over i båndet
    (cfg.band && bg.type !== 'none' ? S + ' { -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent), linear-gradient(180deg, transparent, #000 7%, #000 93%, transparent); -webkit-mask-composite: source-in; mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent), linear-gradient(180deg, transparent, #000 7%, #000 93%, transparent); mask-composite: intersect; }\n' : '') +
    (mob ? '@container (max-width: 560px) { ' + S + ' { aspect-ratio: ' + mob + '; } ' + B + ' .fli-frame { max-width: ' + frameW(cfg.mobileAspect) + '; } }\n' : '') +
    B + ' .fli-caption { max-width: ' + maxW + '; margin: .6em auto 0; font-family: var(--fk-font); font-size: 14px; line-height: 1.45; color: #5A5A5A; }\n';
  return '\x3C!-- ============================================\n' +
    '     FAKTISK · LOOP-ILLUSTRASJON' + (cfg.version ? ' · v' + cfg.version : '') + '\n' +
    '     Animert illustrasjon som går i loop. Endres i Faktisk Studio.\n' +
    '     ============================================ -->\n' +
    '<style>' + css + '</style>\n' +
    '<div class="fli-container fli-box-' + id + '">\n' +
    '  <div class="fli-frame">\n' +
    '    <div class="fli-' + id + '" id="' + id + '" role="img" aria-label="' + esc(cfg.alt || 'Animert illustrasjon') + '"><canvas aria-hidden="true"></canvas></div>\n' +
    '  </div>' + (cfg.caption ? '\n  \x3C!-- ▶ BILDETEKST -->\n  <div class="fli-caption">' + esc(cfg.caption) + '</div>' : '') + '\n' +
    '</div>\n' +
    '\x3Cscript>\n(function () {\n  var C = ' + json + ';\n  (' + engineSrc + ')(document.getElementById(\'' + id + '\'), C);\n})();\n<\/script>\n';
}
