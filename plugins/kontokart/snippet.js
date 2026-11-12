// Faktisk Studio · Kontokart · embed-byggere
// To visninger av SAMME kontodata:
//   kkBuildTabell  → «Her befinner administratorene seg»: liste over kontoer + snurrende klode (kkKlode)
//   kkBuildKart    → verdenskart: adminland → grupper, innlegg langs buene, klikkbare kontoer (kkKart)
//   klode          → nettverksklode: samme data som kartet på en stor klode som dreier og zoomer ved valg (kkNettklode)
// Forhåndsvisningen kjører de samme motorene direkte; embedden får dem via toString().
// CSS-en er beskyttet mot faktisk.no-stilene (all:initial på roten, reset, dobbel rotklasse, kun vekt 300/500).

var KK_CSS_TABELL = "\n.fka.fka{all:initial;display:block;box-sizing:border-box;font-family:\"Unica77\",\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-weight:300;line-height:1.4;color:#212121;text-align:left;-webkit-font-smoothing:antialiased}\n.fka.fka *,.fka.fka *::before,.fka.fka *::after{box-sizing:border-box;margin:0;padding:0;border:0;background:none;font:inherit;line-height:inherit;color:inherit;letter-spacing:normal;text-transform:none;text-indent:0;text-decoration:none;text-align:inherit;list-style:none;float:none;max-width:none;min-width:0;min-height:0;box-shadow:none;outline:0;quotes:none;vertical-align:baseline}\n.fka.fka svg{display:block;max-width:none;fill:none}\n.fka.fka{--ink:#212121;--muted:#6b6b6b;--line:#e4e4e4;--chip:#eef1f8;--accent:#0050FC;\n  font-family:\"Unica77\",\"Unica77 LL\",\"Helvetica Neue\",Arial,sans-serif;color:var(--ink);\n  max-width:var(--lab_page_width,720px);margin:2rem auto;padding:0 16px;box-sizing:border-box}\n.fka.fka *{box-sizing:border-box}\n.fka.fka .fk-h3{font-size:1.25rem;line-height:1.25;margin:0 0 .35rem;font-weight:500}\n.fka.fka .ing{font-size:.95rem;line-height:1.45;color:var(--muted);margin:0 0 1.25rem}\n.fka.fka .fk-list{list-style:none;margin:0;padding:0;border-top:2px solid var(--ink)}\n.fka.fka .fk-li{display:grid;grid-template-columns:minmax(0,15rem) 1fr;gap:.5rem 1.5rem;padding:.85rem 0;border-bottom:1px solid var(--line)}\n.fka.fka .fk-li.x{display:none}\n.fka.fka.open .fk-li.x{display:grid}\n.fka.fka .acc{display:flex;flex-direction:column;gap:.15rem;min-width:0}\n.fka.fka .navn{font-weight:500;font-size:1rem;line-height:1.3}\n.fka.fka .id{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;letter-spacing:.01em}\n.fka.fka .land{display:flex;flex-direction:column;gap:.4rem}\n.fka.fka .lr{display:grid;grid-template-columns:7.5rem 1fr;gap:.6rem;align-items:start}\n.fka.fka .lab{font-size:.75rem;color:var(--muted);line-height:1.2;padding-top:.3rem}\n.fka.fka .c{display:flex;flex-wrap:wrap;gap:.3rem}\n.fka.fka .chip{display:inline-flex;align-items:center;gap:.35rem;background:var(--chip);border-radius:999px;padding:.2rem .65rem;font-size:.85rem;line-height:1.3;white-space:nowrap}\n.fka.fka .chip i{font-style:normal;font-weight:500;font-size:.72rem;background:var(--accent);color:#fff;border-radius:999px;min-width:1.15rem;height:1.15rem;display:inline-flex;align-items:center;justify-content:center;padding:0 .3rem}\n.fka.fka .chip.unk{background:transparent;border:1px dashed #b9b9b9;color:var(--muted)}\n.fka.fka .na{font-size:.85rem;color:var(--muted);font-style:italic;line-height:1.3;padding-top:.2rem}\n.fka.fka .more{margin:1rem 0 0;font:inherit;font-size:.9rem;font-weight:500;color:var(--ink);background:#fff;border:1.5px solid var(--ink);border-radius:999px;padding:.55rem 1.2rem;cursor:pointer}\n.fka.fka .more:hover{background:var(--ink);color:#fff}\n.fka.fka .note{font-size:.8rem;line-height:1.45;color:var(--muted);margin:.9rem 0 0}\n@media(max-width:560px){.fka.fka .fk-li{grid-template-columns:1fr}.fka.fka .lr{grid-template-columns:6.5rem 1fr}}\n.fka.fka .fka-globe{position:relative;margin:0 0 clamp(14px,2.6cqw,20px);height:clamp(200px,40cqw,300px);border-radius:12px;overflow:hidden;background:linear-gradient(180deg,#F5F8FF 0%,#E9EFFF 100%)}\n.fka.fka .fka-globe canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}\n.fka.fka .fka-pill{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:.35rem;white-space:nowrap;background:#fff;border:1px solid rgba(0,80,252,.22);border-radius:999px;padding:.22rem .7rem;font-size:.85rem;line-height:1.3;color:#212121;box-shadow:0 2px 8px rgba(0,40,140,.10);will-change:transform,opacity;opacity:0;visibility:hidden}\n.fka.fka .fka-pill i{font-style:normal;font-weight:500;font-size:.72rem;background:#0050FC;color:#fff;border-radius:999px;min-width:1.15rem;height:1.15rem;display:inline-flex;align-items:center;justify-content:center;padding:0 .3rem}\n.fka.fka .fka-globe-note{margin:-.6rem 0 1rem;font-size:.78rem;color:#767676;line-height:1.4}\n.fka.fka .fka-globe{cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}\n.fka.fka .fka-globe.is-drag{cursor:grabbing}\n.fka.fka .fka-pill{pointer-events:none}\n";
var KK_CSS_KART = ".fkn.fkn{all:initial;display:block;box-sizing:border-box;font-family:\"Unica77\",\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-weight:300;line-height:1.4;color:#212121;text-align:left;-webkit-font-smoothing:antialiased;container-type:inline-size;max-width:var(--lab_page_width,720px);margin:0 auto;padding:.7rem 0}\n.fkn.fkn *,.fkn.fkn *::before,.fkn.fkn *::after{box-sizing:border-box;margin:0;padding:0;border:0;background:none;font:inherit;line-height:inherit;color:inherit;letter-spacing:normal;text-transform:none;text-indent:0;text-decoration:none;text-align:inherit;list-style:none;float:none;max-width:none;min-width:0;min-height:0;box-shadow:none;outline:0;quotes:none;vertical-align:baseline}\n.fkn.fkn .fkn-box{position:relative;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#F5F8FF 0%,#EAF0FF 60%,#E3EBFF 100%)}\n.fkn.fkn .fkn-map{position:relative;aspect-ratio:2/1}\n.fkn.fkn .fkn-map canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}\n.fkn.fkn .fkn-pill{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap;background:#fff;border:1px solid rgba(0,80,252,.22);border-radius:999px;padding:.16rem .6rem;font-size:clamp(11px,1.85cqw,14px);line-height:1.3;color:#212121;box-shadow:0 2px 8px rgba(0,40,140,.10);transition:opacity .25s;z-index:1}\n.fkn.fkn .fkn-pill i{font-style:normal;font-weight:500;font-size:.85em;background:#0050FC;color:#fff;border-radius:999px;min-width:1.35em;height:1.35em;display:inline-flex;align-items:center;justify-content:center;padding:0 .3em}\n.fkn.fkn .fkn-pill--no{background:#0050FC;color:#fff;border-color:#0050FC;font-weight:500;font-size:clamp(12px,2.2cqw,16px);padding:.32rem .95rem;box-shadow:0 4px 14px rgba(0,40,140,.22);z-index:3}\n.fkn.fkn .fkn-bottom{position:relative;z-index:2;margin-top:clamp(-70px,-9cqw,-34px);padding:clamp(30px,5.5cqw,48px) clamp(14px,3cqw,26px) clamp(12px,2.2cqw,18px);background:linear-gradient(180deg,rgba(234,240,255,0) 0%,rgba(232,239,255,.9) clamp(30px,5.5cqw,48px),#E3EBFF 100%)}\n.fkn.fkn .fkn-acc{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}\n.fkn.fkn .fkn-chip{cursor:pointer;background:rgba(255,255,255,.85);border:1px solid rgba(0,80,252,.18);border-radius:999px;padding:.26rem .75rem;font-size:clamp(12px,1.95cqw,14px);line-height:1.35;color:#212121;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}\n.fkn.fkn .fkn-chip:hover{border-color:rgba(0,80,252,.5)}\n.fkn.fkn .fkn-chip.is-on{background:#0050FC;border-color:#0050FC;color:#fff}\n.fkn.fkn .fkn-chip--na{color:#7A7A7A;border-style:dashed}\n.fkn.fkn .fkn-chip--na.is-on{color:#fff;border-style:solid}\n.fkn.fkn .fkn-chip:focus-visible{outline:2px solid #0050FC;outline-offset:2px}\n.fkn.fkn .fkn-hint{text-align:center;font-size:clamp(13.5px,2.3cqw,17px);font-weight:500;line-height:1.35;color:#212121;margin:0 auto 12px;max-width:40em;display:flex;align-items:flex-end;justify-content:center}\n.fkn.fkn .fkn-hint b{font-weight:500;color:#0050FC;margin-right:.3em}\n.fkn.fkn .fkn-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:.2rem 1rem;margin-top:12px;font-size:clamp(10.5px,1.6cqw,12px);color:#5A5A5A;line-height:1.4}\n.fkn.fkn .fkn-legend span{display:inline-flex;align-items:center;gap:.3rem}\n.fkn.fkn .fkn-dot{width:8px;height:8px;border-radius:50%;background:#0050FC;display:inline-block}\n.fkn.fkn .fkn-ring{width:9px;height:9px;border-radius:50%;border:1.2px dashed #0050FC;display:inline-block}\n.fkn.fkn .fkn-post{width:10px;height:7px;border-radius:2px;border:1.2px solid #0050FC;background:#fff;display:inline-block}\n.fkn.fkn .fkn-source{text-align:center;margin-top:5px;color:#767676;font-size:clamp(10px,1.5cqw,11.5px);line-height:1.45}\n.fkn.fkn .fkn-pill--grp{background:#fff;color:#0050FC;border:1.5px solid #0050FC;font-weight:500}\n.fkn.fkn .fkn-chip--ex{border-color:#0050FC;border-width:1.5px}\n.fkn.fkn .fkn-chip em{font-style:normal;font-size:.8em;margin-left:.35em;color:#0050FC;font-weight:500}\n.fkn.fkn .fkn-chip.is-on em{color:#fff}\n@media (max-width:480px){.fkn.fkn .fkn-map{aspect-ratio:1.42/1}\n.fkn.fkn .fkn-bottom{padding:26px 12px 12px}\n.fkn.fkn .fkn-hint{font-size:13.5px;margin-bottom:9px}\n.fkn.fkn .fkn-acc{gap:4px}\n.fkn.fkn .fkn-chip{font-size:11.5px;padding:.17rem .5rem}\n.fkn.fkn .fkn-legend{margin-top:9px}}\n";

function kkEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function kkCap(s) { s = String(s || '').trim(); return s.length <= 3 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1); }

// «Pakistan (3), Spania, + 1 ukjent» → { items:[{land,n}], unk, na }
function kkParseLand(str) {
  var s = String(str || '').trim(), out = { items: [], unk: 0, na: null };
  if (!s) return out;
  if (/^(ingen|ikke)\b/i.test(s)) { out.na = s; return out; }
  s.split(',').forEach(function (p) {
    p = p.trim(); if (!p) return;
    var m = p.match(/^\+?\s*(\d+)\s+ukjent/i);
    if (m) { out.unk += +m[1]; return; }
    m = p.match(/^(.+?)\s*\((\d+)\)$/);
    if (m) out.items.push({ land: m[1].trim(), n: +m[2] }); else out.items.push({ land: p, n: 1 });
  });
  return out;
}
function kkKey(land) { return String(land || '').trim().toLowerCase(); }

// Bygger alt som regnes ut fra kontodataene. Returnerer også steder som mangler koordinater.
function kkModel(S) {
  var accounts = (S.accounts || []).filter(function (a) { return String(a.navn || '').trim(); });
  var names = {}, missing = {};
  accounts.forEach(function (a) {
    a._A = kkParseLand(a.landA); a._B = kkParseLand(a.landB);
    a._A.items.concat(a._B.items).forEach(function (it) { var k = kkKey(it.land); if (!names[k]) names[k] = kkCap(it.land); if (!kkLand(k)) missing[names[k]] = 1; });
  });
  var targets = (S.targets || []).filter(function (t) { return String(t.navn || '').trim(); });
  targets.forEach(function (t) { if (t.land && !kkLand(t.land)) missing[kkCap(t.land)] = 1; });
  return { accounts: accounts, targets: targets, names: names, missing: Object.keys(missing) };
}

// ---------- Kart ----------
function kkKartCfg(M, S) {
  var C = {}, G = {}, mainKey = null, mt = null;
  M.targets.forEach(function (t, i) { if (i === (+S.mainTarget || 0)) mt = t; });
  if (!mt) mt = M.targets[0];
  var mc = mt ? kkLand(mt.land) : { lat: 61, lon: 9.5 };
  M.accounts.forEach(function (a) {
    a._A.items.forEach(function (it) {
      var k = kkKey(it.land), c = kkLand(k); if (!c || C[k]) return;
      var dl = c.lon - mc.lon, pos;
      if (Math.abs(dl) < 25 && c.lat > mc.lat - 15) pos = dl < 0 ? 'l' : 'r';
      else if (dl < -40) pos = 't'; else if (c.lat < 20) pos = 'b'; else pos = dl < 0 ? 'l' : 'r';
      C[k] = { n: M.names[k], lat: c.lat, lon: c.lon, pos: pos };
    });
  });
  M.targets.forEach(function (t, i) {
    var c = kkLand(t.land); if (!c) return;
    var key = 'g' + i, lat = c.lat, lon = c.lon, main = t === mt;
    if (!main && C[kkKey(t.land)]) { lat += 1.3; lon += 3; }   // skill fra adminland-prikken i samme land
    G[key] = { n: t.navn, s: t.kort || t.navn, lat: lat, lon: lon, main: main ? 1 : 0, pos: main ? 't' : (lat < 0 ? 't' : (lon <= mc.lon ? 'l' : 'r')) };
    if (main) mainKey = key;
  });
  var ACC = M.accounts.map(function (a) {
    var ks = a._A.items.map(function (it) { return kkKey(it.land); }).filter(function (k) { return C[k]; });
    var gs = (a.grupper || []).map(function (i) { return 'g' + i; }).filter(function (k) { return G[k]; });
    var r = [String(a.navn).trim(), ks, gs.length ? gs : null];
    if (a.eksempel && String(a.eksempelTekst || '').trim()) r.push(String(a.eksempelTekst).trim());
    return r;
  });
  var lons = [], lats = [];
  Object.keys(C).concat(Object.keys(G)).forEach(function (k) { var p = C[k] || G[k]; lons.push(p.lon); lats.push(p.lat); });
  if (!lons.length) { lons = [-20, 60]; lats = [30, 60]; }
  var L0 = Math.max(-180, Math.min.apply(null, lons) - 30), L1 = Math.min(180, Math.max.apply(null, lons) + 12);
  var T1 = Math.min(-6, Math.min.apply(null, lats) - 32);
  return { C: C, G: G, ACC: ACC, main: mainKey, ext: [L0, L1, 86, T1], cut: T1 + 32 };
}

function kkKartMarkup(M, S, cfg) {
  var mt = cfg.G[cfg.main], others = Object.keys(cfg.G).filter(function (k) { return k !== cfg.main; }).map(function (k) { return cfg.G[k].n.toLowerCase().replace(/ grupper$/, ''); });
  var landList = Object.keys(cfg.C).map(function (k) { return cfg.C[k].n; });
  var aria = M.accounts.length + ' ' + kkEnhet(S) + ' publiserer innlegg rettet mot ' + (mt ? mt.n.toLowerCase() : 'grupper') + '. Administratorene befinner seg ifølge Facebook i ' + (landList.length > 1 ? landList.slice(0, -1).join(', ') + ' og ' + landList[landList.length - 1] : landList.join('')) + '.';
  var leg = '<span><i class="fkn-dot"></i>' + kkEsc(S.kartLegendAdmin || 'Adminland (antall ' + kkEnhet(S) + ')') + '</span>'
    + '<span><i class="fkn-post"></i>Innlegg til ' + kkEsc(mt ? mt.n.charAt(0).toLowerCase() + mt.n.slice(1) : 'grupper') + '</span>'
    + (others.length ? '<span><i class="fkn-ring"></i>Lignende aktivitet i ' + kkEsc(others.length > 1 ? others.slice(0, -1).join(', ') + ' og ' + others[others.length - 1] : others[0]) + ' grupper</span>' : '');
  return '\n<div class="fkn-box" role="figure" aria-label="' + kkEsc(aria) + '">'
    + '\n  <div class="fkn-map" aria-hidden="true"><canvas></canvas></div>'
    + '\n  <div class="fkn-bottom">'
    + '\n    <div class="fkn-hint" aria-live="polite">' + kkEsc(S.kartHint || String(S.klodeHint || '').replace(/\s*·\s*Dra[^·]*$/i, '').trim() || 'Trykk på en konto for å se hvor administratorene befinner seg') + '</div>'
    + '\n    <div class="fkn-acc" role="list"></div>'
    + '\n    <div class="fkn-legend">' + leg + '</div>'
    + (S.kartKilde ? '\n    <div class="fkn-source">' + kkEsc(S.kartKilde) + '</div>' : '')
    + '\n  </div>\n</div>\n';
}

// ---------- Tabell med klode ----------
function kkKlodeCfg(M) {
  var P = {}, order = [];
  M.accounts.forEach(function (a) { a._A.items.forEach(function (it) {
    var k = kkKey(it.land), c = kkLand(k); if (!c) return;
    if (!P[k]) { P[k] = { n: M.names[k], k: 0, lat: c.lat, lon: c.lon }; order.push(k); }
    P[k].k += it.n;
  }); });
  var arr = order.map(function (k) { return P[k]; }).sort(function (a, b) { return b.k - a.k; });
  var top = arr[0] || { lon: 40 };
  return { P: arr, home: [Math.round(top.lon - 30), 22] };
}
function kkCell(p) {
  if (p.na) return '<span class="na">' + kkEsc(p.na) + '</span>';
  var h = p.items.map(function (it) { return '<span class="chip">' + kkEsc(kkCap(it.land)) + (it.n > 1 ? '<i>' + it.n + '</i>' : '') + '</span>'; }).join('');
  if (p.unk) h += '<span class="chip unk">' + p.unk + ' ukjent</span>';
  return h || '<span class="na">Ingen oppgitt</span>';
}
function kkSameLand(a, b) { return JSON.stringify(a.items) === JSON.stringify(b.items) && a.unk === b.unk && a.na === b.na; }
function kkTabellMarkup(M, S) {
  var show = Math.max(1, +S.visRader || 8), hasB = M.accounts.some(function (a) { return String(a.landB || '').trim(); });
  var la = kkEsc(S.labelA || 'Ved publisering'), lb = kkEsc(S.labelB || 'Første analyse');
  var rows = M.accounts.map(function (a, i) {
    var land;
    if (!hasB || !String(a.landB || '').trim()) land = '<div class="lr one"><span class="lab">' + (hasB ? la : 'Adminland') + '</span><div class="c">' + kkCell(a._A) + '</div></div>';
    else if (kkSameLand(a._A, a._B)) land = '<div class="lr one"><span class="lab">Begge målinger</span><div class="c">' + kkCell(a._A) + '</div></div>';
    else land = '<div class="lr"><span class="lab">' + la + '</span><div class="c">' + kkCell(a._A) + '</div></div><div class="lr"><span class="lab">' + lb + '</span><div class="c">' + kkCell(a._B) + '</div></div>';
    return '<div class="fk-li' + (i >= show ? ' x' : '') + '" role="listitem"><div class="acc"><span class="navn">' + kkEsc(a.navn) + '</span>' + (a.id ? '<span class="id">' + kkEsc(a.id) + '</span>' : '') + '</div><div class="land">' + land + '</div></div>';
  }).join('');
  return '\n' + (S.tittel ? '<div class="fk-h3" role="heading" aria-level="3">' + kkEsc(S.tittel) + '</div>\n' : '')
    + (S.ingress ? '<div class="ing">' + kkEsc(S.ingress) + '</div>\n' : '')
    + (S.klode !== false ? '<div class="fka-globe" aria-hidden="true"><canvas></canvas></div>\n' + (S.klodeNote ? '<div class="fka-globe-note">' + kkEsc(S.klodeNote) + '</div>\n' : '') : '')
    + '<div class="fk-list" role="list">' + rows + '</div>\n'
    + (M.accounts.length > show ? '<button type="button" class="more" aria-expanded="false">Vis alle ' + M.accounts.length + ' ' + kkEsc(kkEnhet(S)) + '</button>\n' : '')
    + (S.tabellNote ? '<div class="note">' + kkEsc(S.tabellNote) + '</div>\n' : '');
}

// ---------- Nettverksklode ----------
// 0.2.2: hva kontoene kalles i teksten («Vis alle 19 Facebook-sider», forklaringen og skjermleserteksten)
function kkEnhet(S) { return String((S && S.enhet) || '').trim() || 'kontoer'; }
var KK_KLODE_HINT = 'Trykk på en konto eller et land på kloden · Dra for å snurre';
function kkNettCfg(M, S) {
  var cfg = kkKartCfg(M, S), mg = cfg.G[cfg.main] || { lat: 61, lon: 9.5 };
  // Startutsnitt: hovedgruppen øverst til venstre for midten, så adminland sør/øst for den får plass
  cfg.home = [Math.round(mg.lon + 18.5), Math.max(-40, Math.min(60, Math.round(mg.lat - 21)))];
  delete cfg.ext; delete cfg.cut;
  return cfg;
}
function kkNettMarkup(M, S, cfg) {
  return kkKartMarkup(M, Object.assign({}, S, { kartHint: kkKlodeHint(S) }), cfg);
}
// 0.2.1: tom klodetekst arver verdenskartets tekst (med «· Dra for å snurre» lagt til hvis det ikke står noe om å dra)
function kkKlodeHint(S) {
  var g = String(S.klodeHint || '').trim(), k = String(S.kartHint || '').trim();
  if (g) return g;
  if (k) return /\bdra\b/i.test(k) ? k : k + ' · Dra for å snurre';
  return KK_KLODE_HINT;
}

function kkJson(o) { return JSON.stringify(o).replace(/</g, '\\u003c'); }
function kkId() { return 'kk' + Math.random().toString(36).slice(2, 8); }

// Ferdig embed for Labrador. which: 'tabell' | 'kart' | 'klode'
function kkBuildSnippet(S, which) {
  var M = kkModel(S), id = kkId();
  if (which === 'klode') {
    var nc = kkNettCfg(M, S);
    return '<!-- FAKTISK · KONTOKART (nettverksklode) · laget i Faktisk Studio -->\n<div class="fkn" id="' + id + '">\n<style>\n' + KK_CSS_KLODE + '</style>' + kkNettMarkup(M, S, nc)
      + '<script>(function(){var KK_DOTS=\'' + KK_DOTS + '\';\n' + kkNettklode.toString() + '\nkkNettklode(document.getElementById(\'' + id + '\'),' + kkJson(nc) + ',KK_DOTS);})();</script>\n</div>\n';
  }
  if (which === 'kart') {
    var cfg = kkKartCfg(M, S);
    return '<!-- FAKTISK · KONTOKART (verdenskart) · laget i Faktisk Studio -->\n<div class="fkn" id="' + id + '">\n<style>\n' + KK_CSS_KART + '</style>' + kkKartMarkup(M, S, cfg)
      + '<script>(function(){var KK_DOTS=\'' + KK_DOTS + '\';\n' + kkKart.toString() + '\nkkKart(document.getElementById(\'' + id + '\'),' + kkJson(cfg) + ',KK_DOTS);})();</script>\n</div>\n';
  }
  var kc = kkKlodeCfg(M), n = M.accounts.length;
  return '<!-- FAKTISK · KONTOKART (tabell med klode) · laget i Faktisk Studio -->\n<div class="fka" id="' + id + '">\n<style>\n' + KK_CSS_TABELL + '</style>' + kkTabellMarkup(M, S)
    + '<script>(function(){var KK_DOTS=\'' + KK_DOTS + '\';\n' + kkKlode.toString() + '\n' + kkMore.toString() + '\nvar b=document.getElementById(\'' + id + '\');'
    + (S.klode !== false ? 'kkKlode(b,' + kkJson(kc) + ',KK_DOTS);' : '') + 'kkMore(b,' + n + ',' + kkJson(kkEnhet(S)) + ');})();</script>\n</div>\n';
}

// Forhåndsvisning: samme markup, motorene kalles direkte (script i innerHTML kjører ikke)
function kkRenderPreview(host, S, which) {
  var M = kkModel(S);
  if (which === 'klode') {
    var nc = kkNettCfg(M, S);
    host.innerHTML = '<div class="fkn"><style>' + KK_CSS_KLODE + '</style>' + kkNettMarkup(M, S, nc) + '</div>';
    kkNettklode(host.querySelector('.fkn'), JSON.parse(kkJson(nc)), KK_DOTS);
    return M;
  }
  if (which === 'kart') {
    var cfg = kkKartCfg(M, S);
    host.innerHTML = '<div class="fkn"><style>' + KK_CSS_KART + '</style>' + kkKartMarkup(M, S, cfg) + '</div>';
    kkKart(host.querySelector('.fkn'), JSON.parse(kkJson(cfg)), KK_DOTS);
  } else {
    host.innerHTML = '<div class="fka"><style>' + KK_CSS_TABELL + '</style>' + kkTabellMarkup(M, S) + '</div>';
    var b = host.querySelector('.fka');
    if (S.klode !== false) kkKlode(b, kkKlodeCfg(M), KK_DOTS);
    kkMore(b, M.accounts.length, kkEnhet(S));
  }
  return M;
}
