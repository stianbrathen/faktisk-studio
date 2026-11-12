// Prikkeklode · bygger embed-koden (brukes av Studio-editoren; forhåndsvisningen kjører nøyaktig denne koden)
// cfg: { title, sub, bg, home:{lon,lat}, zoom, places[], items[], factsTitle, pulses, motion, trigger, list, labels,
//        hint, hintText, aspect, width, round, padTop, padBot, alt, caption, version }
// Skjermbilder lenkes med URL fra Labrador — aldri base64.
function fpkBuildSnippet(cfg, engineSrc, dots, baseCss) {
  const id = 'fpk-' + Math.random().toString(36).slice(2, 8);
  const S = '.fpk-' + id, B = '.fpk-box-' + id, O = '.fpk-ov-' + id;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  const maxW = cfg.width === 'full' || !cfg.width ? '100%' : (parseInt(cfg.width, 10) || 680) + 'px';
  const aspect = (cfg.aspect || '16/10').replace('/', ' / ');
  const vspace = (v, side) => {
    const n = isFinite(v) ? Math.max(-24, Math.min(64, v)) : 12;
    return n >= 0 ? `padding-${side}: ${n}px;` : `padding-${side}: 0; margin-${side}: ${n}px;`;
  };
  const bg = cfg.bg || 'navy';
  const light = bg === 'white' || bg === 'none';
  const bgCss = bg === 'white' ? '#FFFFFF' : bg === 'none' ? 'transparent'
    : 'radial-gradient(120% 90% at 50% 45%, #0E2560 0%, #07153A 60%, #050E28 100%)';
  const ink = light ? '#0B1B3F' : '#EAF1FF', muted = light ? '#5B6B88' : '#8FA3C8';

  const run = {
    bg, home: cfg.home, zoom: cfg.zoom, factsTitle: cfg.factsTitle || '', cardMode: ['inside', 'pop', 'page'].indexOf(cfg.cardMode) >= 0 ? cfg.cardMode : 'auto',
    pulses: cfg.pulses !== false, motion: cfg.motion === 0 ? 0 : 1, trigger: cfg.trigger || 'middle',
    list: cfg.list !== false, labels: cfg.labels !== false,
    places: (cfg.places || []).map(p => ({ id: p.id, name: p.name || '', lat: +p.lat, lon: +p.lon, role: p.role === 'target' ? 'target' : 'source', color: p.color || '', lab: p.lab || '' })),
    items: (cfg.items || []).map(it => {
      const o = { from: it.from, to: it.to, type: it.type === 'profil' ? 'profil' : 'side', name: it.name || '', meta: it.meta || '',
        shots: (it.shots || []).filter(Boolean), facts: (it.facts || []).filter(Boolean) };
      if (it.warn) o.warn = it.warn;
      if (it.text) o.text = it.text;
      if (+it.lift > 0) o.lift = +it.lift;
      if (+it.mark > 0) o.mark = +it.mark;
      return o;
    }),
  };
  const json = JSON.stringify(run).replace(/</g, '\\u003c');

  const css = `${baseCss || ''}
.fpk-container { container-type: inline-size; }
.fpk-container${B} { ${vspace(cfg.padTop, 'top')} ${vspace(cfg.padBot, 'bottom')} }
${B} .fpk-frame { max-width: ${maxW}; margin: 0 auto; }
${S} { position: relative; background: ${bgCss}; color: ${ink}; overflow: hidden; font-family: var(--fk-font, Helvetica, Arial, sans-serif);${cfg.round !== false ? ' border-radius: 14px;' : ''}${bg === 'white' ? ' box-shadow: inset 0 0 0 1px #E3E8F0;' : ''} isolation: isolate; text-align: left; }
${S} * { box-sizing: border-box; }
${S} .fpk-stage { position: relative; width: 100%; aspect-ratio: ${aspect}; touch-action: pan-y; cursor: grab; user-select: none; -webkit-user-select: none; outline: none; }
${S} .fpk-stage:focus-visible { box-shadow: inset 0 0 0 2px #0050FC; }
${S} .fpk-stage.is-drag { cursor: grabbing; }
${S} .fpk-stage.is-hot { cursor: pointer; }
${S} canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
${S} .fpk-head { position: absolute; left: 0; top: 0; padding: 18px 20px; pointer-events: none; max-width: 64%; }
${S} .fpk-title { margin: 0 0 4px; font-size: clamp(17px, 3.1cqw, 24px); line-height: 1.15; font-weight: 700; letter-spacing: -.01em; color: ${ink}; }
${S} .fpk-sub { margin: 0; font-size: clamp(12px, 1.8cqw, 14px); line-height: 1.35; color: ${muted}; }
${S} .fpk-reset { position: absolute; right: 14px; bottom: 14px; z-index: 2; border-radius: 99px; font: 600 12px/1 var(--fk-font, Helvetica, Arial, sans-serif); padding: 7px 12px; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .3s;
  ${light ? 'background: #fff; color: #0B1B3F; border: 1px solid #D5DCE8; box-shadow: 0 2px 8px rgba(11,27,63,.08);' : 'background: rgba(255,255,255,.1); color: #EAF1FF; border: 1px solid rgba(255,255,255,.18);'} }
${S} .fpk-reset.is-on { opacity: 1; pointer-events: auto; }
${S} .fpk-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: ${light ? 'rgba(11,27,63,.78)' : 'rgba(0,0,0,.45)'}; color: #fff; font-size: 12px; line-height: 1.2;
  padding: 6px 12px; border-radius: 99px; pointer-events: none; white-space: nowrap; transition: opacity .6s; max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; }
${S} .fpk-hint.is-off { opacity: 0; }
${S} .fpk-list { display: flex; gap: 8px; overflow-x: auto; padding: 12px 16px 16px; scrollbar-width: thin; border-top: 1px solid ${light ? '#E9EDF3' : 'rgba(255,255,255,.08)'}; }
${S} .fpk-item { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; border-radius: 99px; padding: 6px 12px 6px 6px; font: 500 13px/1.2 var(--fk-font, Helvetica, Arial, sans-serif); cursor: pointer; color: ${ink};
  ${light ? 'background: #F4F6FA; border: 1px solid #E1E6EF;' : 'background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);'} }
${S} .fpk-item:hover, ${S} .fpk-item.is-sel { ${light ? 'background: #E9EEF7; border-color: #9FB0CC;' : 'background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.35);'} }
${S} .fpk-item small { color: ${muted}; font-size: 11px; }
${S} .fpk-av, ${O} .fpk-av { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
${S} .fpk-av svg, ${O} .fpk-av svg { width: 14px; height: 14px; }
${S} .fpk-card, ${O} .fpk-card { position: absolute; right: 16px; top: 50%; z-index: 3; width: min(380px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow-y: auto; overscroll-behavior: contain;
  transform: translateY(-50%) scale(.96); opacity: 0; pointer-events: none; visibility: hidden; background: #fff; color: #1c1e21; border-radius: 12px; text-align: left;
  box-shadow: ${light ? '0 14px 40px rgba(11,27,63,.22); border: 1px solid #E3E8F0' : '0 18px 50px rgba(0,0,0,.45)'}; transition: opacity .2s, transform .2s, visibility .2s; cursor: auto; }
${S} .fpk-card.is-open, ${O} .fpk-card.is-open { opacity: 1; visibility: visible; transform: translateY(-50%) scale(1); pointer-events: auto; }
${S} .fpk-card__top, ${O} .fpk-card__top { display: flex; gap: 10px; align-items: center; padding: 12px 14px 8px; }
${S} .fpk-card__top .fpk-av, ${O} .fpk-card__top .fpk-av { width: 40px; height: 40px; }
${S} .fpk-card__top .fpk-av svg, ${O} .fpk-card__top .fpk-av svg { width: 22px; height: 22px; }
${S} .fpk-card__name, ${O} .fpk-card__name { font-weight: 650; font-size: 15px; line-height: 1.2; }
${S} .fpk-card__meta, ${O} .fpk-card__meta { font-size: 12px; line-height: 1.3; color: #65676b; }
${S} .fpk-card__x, ${O} .fpk-card__x { margin-left: auto; align-self: flex-start; flex: 0 0 auto; border: 0; background: #f0f2f5; width: 30px; height: 30px; border-radius: 50%; font-size: 15px; line-height: 1; cursor: pointer; color: #333; }
${S} .fpk-card__text, ${O} .fpk-card__text { padding: 0 14px 12px; font-size: 14px; line-height: 1.45; white-space: pre-line; }
${S} .fpk-card__shots, ${O} .fpk-card__shots { background: #f0f2f5; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
${S} .fpk-card__shots img, ${O} .fpk-card__shots img { display: block; width: 100%; height: auto; border-radius: 6px; }
${S} .fpk-card__facts, ${O} .fpk-card__facts { background: #FFF7DA; padding: 10px 14px 12px; font-size: 12.5px; line-height: 1.45; }
${S} .fpk-card__facts b, ${O} .fpk-card__facts b { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8a6d00; margin-bottom: 3px; }
${S} .fpk-warn, ${O} .fpk-warn { color: #B3261E; font-weight: 600; }
${O} { font-family: "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif; line-height: 1.4; text-align: left; }
${O} * { box-sizing: border-box; }
${O}.fpk-ov--page { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 16px;
  visibility: hidden; opacity: 0; transition: opacity .2s, visibility .2s; }
${O}.fpk-ov--page.is-open { visibility: visible; opacity: 1; }
${O}.fpk-ov--page .fpk-ov__bd { position: absolute; inset: 0; background: rgba(7,21,58,.62); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
${O}.fpk-ov--page .fpk-card { position: relative; top: auto; right: auto; bottom: auto; left: auto; width: min(460px, 100%); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); transform: scale(.96); }
${O}.fpk-ov--page .fpk-card.is-open { transform: none; }
${O}.fpk-ov--pop { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483000; }
${O}.fpk-ov--pop .fpk-ov__bd { display: none; }
${O}.fpk-ov--pop .fpk-card { position: absolute; right: auto; bottom: auto; width: min(460px, calc(100vw - 32px)); max-height: min(86vh, 800px);
  transform: translateY(10px) scale(.98); border: 1px solid rgba(11,27,63,.08);
  box-shadow: 0 28px 70px rgba(11,27,63,.32), 0 6px 18px rgba(11,27,63,.16); }
${O}.fpk-ov--pop .fpk-card.is-open { transform: none; }
${O} .fpk-card__x { width: 34px; height: 34px; font-size: 16px; }
@container (max-width: 560px) {
  ${S} .fpk-stage { aspect-ratio: 4 / 5; }
  ${S} .fpk-head { max-width: 100%; padding: 14px; }
  ${S} .fpk-card { top: auto; bottom: 10px; right: 10px; left: 10px; width: auto; max-height: 66%; transform: translateY(12px); }
  ${S} .fpk-card.is-open { transform: translateY(0); }
  ${S} .fpk-card__top { padding: 10px 12px 6px; }
  ${S} .fpk-card__top .fpk-av { width: 32px; height: 32px; }
  ${S} .fpk-card__facts { padding: 8px 12px 10px; font-size: 12px; }
}
${B} .fpk-caption { max-width: ${maxW}; margin: .6em auto 0; font-family: var(--fk-font); font-size: 14px; line-height: 1.45; color: #5A5A5A; }
@media (prefers-reduced-motion: reduce) { ${S} .fpk-card, ${S} .fpk-hint, ${S} .fpk-reset, ${O}, ${O} .fpk-card { transition: none; } }
`;
  const head = cfg.title || cfg.sub
    ? `<div class="fpk-head">${cfg.title ? `<p class="fpk-title">${esc(cfg.title)}</p>` : ''}${cfg.sub ? `<p class="fpk-sub">${esc(cfg.sub)}</p>` : ''}</div>` : '';
  const hint = cfg.hint === false || !run.items.length ? ''
    : `<div class="fpk-hint">${esc(cfg.hintText || 'Dra for å snu kloden · trykk på et ikon for å se innlegget')}</div>`;

  return '\x3C!-- ============================================\n' +
    '     FAKTISK · PRIKKEKLODE' + (cfg.version ? ' · v' + cfg.version : '') + '\n' +
    '     Roterbar klode med kontoer og innlegg. Innhold og utseende endres i Faktisk Studio.\n' +
    '     ============================================ -->\n' +
    '<style>' + css + '</style>\n' +
    `<div class="fpk-container fpk-box-${id}">\n` +
    '  <div class="fpk-frame">\n' +
    `    <div class="fpk-${id}" id="${id}" role="group" aria-label="${esc(cfg.alt || 'Roterbar klode')}">` +
    `<div class="fpk-stage" tabindex="0" aria-label="Roterbar klode. Bruk piltastene for å snu den, eller velg en konto i lista under."><canvas aria-hidden="true"></canvas>${head}` +
    '<button class="fpk-reset" type="button">↺ Tilbake</button>' + hint +
    '<div class="fpk-card" role="dialog" aria-label="Innlegg"></div></div>' +
    '<div class="fpk-list"></div></div>\n' +
    '  </div>' + (cfg.caption ? '\n  \x3C!-- ▶ BILDETEKST -->\n  <div class="fpk-caption">' + esc(cfg.caption) + '</div>' : '') + '\n' +
    '</div>\n' +
    // Skriptet finner sin egen grafikk (rett før skriptet), ikke via getElementById: limes samme embed inn to
    // ganger, har begge samme id, og da startet bare den første. Reserve: første grafikk med klassen som ikke er i gang.
    '\x3Cscript>\n(function () {\n  var C = ' + json + ';\n  var D = \'' + dots + '\';\n' +
    '  var sc = document.currentScript, box = sc && sc.previousElementSibling, root = box && box.querySelector ? box.querySelector(\'' + S + '\') : null;\n' +
    '  if (!root || root.__fpk) { var all = document.querySelectorAll(\'' + S + '\'); root = null; for (var i = 0; i < all.length; i++) if (!all[i].__fpk) { root = all[i]; break; } }\n' +
    '  if (root) (' + engineSrc + ')(root, C, D);\n})();\n\x3C/script>\n';
}
