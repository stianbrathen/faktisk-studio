// Faktisk Studio · Metodeboks · embed-bygger
// Boks i Faktisk-stil: stikktittel, tittel, undertittel, punkter med ikon (dokumentert / observert / vet ikke …),
// kilde, og valgfri klode-illustrasjon med buer mellom land (mbKlode i klode-runtime.js).
// Forhåndsvisningen kjører samme motor; embedden får den via toString(). Beskyttet mot faktisk.no-stilene.

var MB_CSS = "\n.fkm-container.fkm-container{all:initial;display:block;box-sizing:border-box;font-family:\"Unica77\",\"Helvetica Neue\",Helvetica,Arial,sans-serif;font-weight:300;line-height:1.4;color:#212121;text-align:left;-webkit-font-smoothing:antialiased}\n.fkm-container.fkm-container *,.fkm-container.fkm-container *::before,.fkm-container.fkm-container *::after{box-sizing:border-box;margin:0;padding:0;border:0;background:none;font:inherit;line-height:inherit;color:inherit;letter-spacing:normal;text-transform:none;text-indent:0;text-decoration:none;text-align:inherit;list-style:none;float:none;max-width:none;min-width:0;min-height:0;box-shadow:none;outline:0;quotes:none;vertical-align:baseline}\n.fkm-container.fkm-container svg{display:block;max-width:none;fill:none}\n\n.fkm-container.fkm-container{container-type:inline-size;padding:.7rem 0;max-width:var(--lab_page_width,720px);margin:0 auto}\n.fkm-container.fkm-container .fkm{background:#fff;border:1.5px solid #E3E3E3;border-radius:16px;padding:clamp(16px,3.4cqw,30px);\n  font-family:\"Unica77\",\"Helvetica Neue\",Helvetica,Arial,sans-serif;color:#212121;box-sizing:border-box}\n.fkm-container.fkm-container .fkm *{box-sizing:border-box}\n.fkm-container.fkm-container .fkm .fkm-txt{flex:1;min-width:0;margin:0;padding:0}\n.fkm-container.fkm-container .fkm .fkm-txt>*,.fkm-container.fkm-container .fkm .fkm-ico{margin-top:0}\n.fkm-container.fkm-container .fkm .fkm-txt{margin-top:-2px}\n.fkm-container.fkm-container .fkm-kicker{color:#0050fc;font-weight:500;font-size:clamp(11px,1.6cqw,13px);letter-spacing:.07em;text-transform:uppercase}\n.fkm-container.fkm-container .fkm-title{font-weight:500;font-size:clamp(20px,3.4cqw,31px);line-height:1.15;margin-top:4px}\n.fkm-container.fkm-container .fkm-sub{color:#666;font-size:clamp(13px,2cqw,16px);line-height:1.4;margin-top:4px}\n.fkm-container.fkm-container .fkm .fkm-list{margin:clamp(8px,1.6cqw,14px) 0 0;padding:0;list-style:none}\n.fkm-container.fkm-container .fkm .fkm-item{display:flex;gap:clamp(10px,2.2cqw,18px);align-items:flex-start;padding:clamp(10px,2cqw,16px) 0;border-top:1px solid #ECECEC}\n.fkm-container.fkm-container .fkm .fkm-item:first-child{border-top:0}\n.fkm-container.fkm-container .fkm-ico{flex-shrink:0;width:clamp(40px,6cqw,52px);height:clamp(40px,6cqw,52px);border-radius:10px;display:flex;align-items:center;justify-content:center;background:#EEF3FF;color:#0050fc}\n.fkm-container.fkm-container .fkm-ico svg{width:48%;height:48%;display:block}\n.fkm-container.fkm-container .fkm .fkm-h{font-weight:500;font-size:clamp(15px,2.3cqw,19px);line-height:1.3;margin:0}\n.fkm-container.fkm-container .fkm .fkm-p{color:#444;font-size:clamp(14px,2.1cqw,17px);line-height:1.45;margin:4px 0 0}\n.fkm-container.fkm-container .fkm-source{margin-top:clamp(10px,2cqw,16px);padding-top:clamp(10px,2cqw,14px);border-top:1px solid #ECECEC;color:#767676;font-size:clamp(11px,1.7cqw,13px);line-height:1.55}\n.fkm-container.fkm-container .fkm-globe{position:relative;margin-top:clamp(12px,2.4cqw,20px);height:clamp(130px,25cqw,200px);border-radius:12px;overflow:hidden;background:linear-gradient(180deg,#F5F8FF 0%,#E9EFFF 100%)}\n.fkm-container.fkm-container .fkm-globe canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}\n.fkm-container.fkm-container .fkm.fkm--blaa{background:linear-gradient(180deg,#F5F8FF 0%,#EAF0FF 100%);border:0}\n.fkm-container.fkm-container .fkm--blaa .fkm-ico{background:#fff}\n.fkm-container.fkm-container .fkm--blaa .fkm-globe{background:linear-gradient(180deg,#FFFFFF 0%,#F2F6FF 100%)}\n.fkm-container.fkm-container .fkm--blaa .fkm-item,.fkm-container.fkm-container .fkm--blaa .fkm-source{border-color:#D9E2F7}\n";

var MB_ICONS = {
  ok: { n: 'Dokumentert', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.3l2.7 2.7L16.2 9.4"/></svg>' },
  obs: { n: 'Observert', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L20 20"/></svg>' },
  ukjent: { n: 'Vet ikke', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>' },
  info: { n: 'Info', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".7" fill="currentColor"/></svg>' },
  varsel: { n: 'Forbehold', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5L21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".7" fill="currentColor"/></svg>' },
  data: { n: 'Data', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/></svg>' },
  kilde: { n: 'Kilde', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/></svg>' }
};

function mbEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function mbBr(s) { return mbEsc(String(s || '').trim()).replace(/\n/g, '<br>'); }

// «Pakistan (20), Spania (6), Norge» → [{n, lat, lon, w}] + ukjente navn
function mbPlaces(str, missing) {
  var out = [];
  String(str || '').split(',').forEach(function (p) {
    p = p.trim(); if (!p) return;
    var m = p.match(/^(.+?)\s*\((\d+)\)$/), name = m ? m[1].trim() : p, w = m ? +m[2] : 1, c = kkLand(name);
    if (c) out.push({ n: name, lat: c.lat, lon: c.lon, w: w }); else missing.push(name);
  });
  return out;
}
function mbKlodeCfg(S) {
  var missing = [], src = mbPlaces(S.fra, missing), dst = mbPlaces(S.til, missing), all = src.concat(dst);
  var ws = 0, lo = 0, la = 0;
  (src.length ? src : all).forEach(function (p) { ws += p.w; lo += p.lon * p.w; la += p.lat * p.w; });
  var lat0 = all.length ? all.reduce(function (s, p) { return s + p.lat; }, 0) / all.length : 40;
  return { cfg: { src: src.map(function (p) { return { lat: p.lat, lon: p.lon, w: p.w }; }), dst: dst.map(function (p) { return { lat: p.lat, lon: p.lon }; }),
    nett: S.retning === 'nett', home: [ws ? Math.round(lo / ws) : 20, Math.max(-10, Math.min(50, Math.round(lat0 + 4)))] }, missing: missing };
}

function mbMarkup(S) {
  var pts = (S.punkter || []).filter(function (p) { return String(p.h || '').trim() || String(p.t || '').trim(); });
  return '\n<div class="fkm' + (S.boks === 'blaa' ? ' fkm--blaa' : '') + '">'
    + (S.kicker ? '\n  <div class="fkm-kicker">' + mbEsc(S.kicker) + '</div>' : '')
    + (S.tittel ? '\n  <div class="fkm-title" role="heading" aria-level="2">' + mbEsc(S.tittel) + '</div>' : '')
    + (S.under ? '\n  <div class="fkm-sub">' + mbEsc(S.under) + '</div>' : '')
    + (S.klode ? '\n  <div class="fkm-globe" aria-hidden="true"><canvas></canvas></div>' : '')
    + '\n  <div class="fkm-list" role="list">'
    + pts.map(function (p) {
        var ic = MB_ICONS[p.ikon] || MB_ICONS.info;
        return '\n    <div class="fkm-item" role="listitem"><span class="fkm-ico" aria-hidden="true">' + ic.svg + '</span><div class="fkm-txt">'
          + (p.h ? '<div class="fkm-h" role="heading" aria-level="3">' + mbEsc(p.h) + '</div>' : '')
          + (p.t ? '<div class="fkm-p">' + mbBr(p.t) + '</div>' : '') + '</div></div>';
      }).join('')
    + '\n  </div>'
    + (S.kilde ? '\n  <div class="fkm-source">' + mbBr(S.kilde) + '</div>' : '')
    + '\n</div>\n';
}

function mbBuildSnippet(S) {
  var id = 'mb' + Math.random().toString(36).slice(2, 8), k = mbKlodeCfg(S);
  var js = S.klode ? '<script>(function(){var KK_DOTS=\'' + KK_DOTS + '\';\n' + mbKlode.toString() + '\nmbKlode(document.getElementById(\'' + id + '\').querySelector(\'.fkm-globe\'),' + JSON.stringify(k.cfg) + ',KK_DOTS);})();</script>\n' : '';
  return '<!-- FAKTISK · METODEBOKS · laget i Faktisk Studio -->\n<div class="fkm-container" id="' + id + '">\n<style>\n' + MB_CSS + '</style>' + mbMarkup(S) + js + '</div>\n';
}
function mbRenderPreview(host, S) {
  host.innerHTML = '<div class="fkm-container"><style>' + MB_CSS + '</style>' + mbMarkup(S) + '</div>';
  var k = mbKlodeCfg(S);
  if (S.klode) mbKlode(host.querySelector('.fkm-globe'), k.cfg, KK_DOTS);
  return k.missing;
}
