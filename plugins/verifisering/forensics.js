// Faktisk Studio · Verifisering — bilde- og tidsspor
//
//  jpegInfo(u8)        kvantiseringstabeller (DQT), anslått libjpeg-kvalitet, markører
//                      (JFIF, EXIF, Adobe, ICC), progressiv/baseline, fargeoppløsning
//  compareThumb(a, b)  EXIF-miniatyr mot hovedbildet (ImageData-form), alle fire vendinger
//  aiSizeHint(...)     størrelser/lengder som er typiske for AI-verktøy (svakt hint)
//  timeline(...)       alle datoer i fila + avvik, og sammenligning med tidspunktet kilden oppgir
//  textOverTime(frames) tekst som er lest i mange bilder: stabil eller «flytende»
//  sun(date, lat, lon) solhøyde og -retning (etter SunCalc, V. Agafonkin, BSD-2)
//
// Alle funksjoner er rene og kan testes i Node. Ingen dom — bare funn.

(function (root) {
  'use strict';

  // ------------------------------------------------------------
  //  JPEG: kvantiseringstabeller og markører
  // ------------------------------------------------------------
  // Standardtabellene fra IJG/libjpeg (Annex K), i zigzag-rekkefølge slik de lagres i DQT
  const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  const STD_L = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const STD_C = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99].concat(new Array(32).fill(99));
  function ijgTable(std, q) {
    const s = q < 50 ? 5000 / q : 200 - 2 * q;
    return std.map(v => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
  }
  function bestQuality(tbl, std) {
    // tbl i naturlig rekkefølge (8×8 rad for rad)
    let best = { q: 0, err: Infinity };
    for (let q = 1; q <= 100; q++) {
      const t = ijgTable(std, q); let e = 0;
      for (let i = 0; i < 64; i++) e += Math.abs(t[i] - tbl[i]);
      if (e < best.err) best = { q, err: e };
    }
    best.exact = best.err === 0; return best;
  }
  function jpegInfo(u8) {
    if (!(u8[0] === 0xff && u8[1] === 0xd8)) return null;
    const out = { tables: {}, markers: [], jfif: false, exif: false, adobe: false, icc: false, xmp: false, progressive: false, components: [], comment: '' };
    let p = 2;
    while (p + 4 <= u8.length && u8[p] === 0xff) {
      const m = u8[p + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { p += (m === 0xff ? 1 : 2); continue; }
      if (m === 0xd9 || m === 0xda) break;
      const L = (u8[p + 2] << 8) | u8[p + 3]; const s = p + 4, e = p + 2 + L;
      const id = String.fromCharCode.apply(null, u8.subarray(s, Math.min(e, s + 12)));
      if (m === 0xe0 && id.startsWith('JFIF')) out.jfif = true;
      if (m === 0xe1 && id.startsWith('Exif')) out.exif = true;
      if (m === 0xe1 && id.startsWith('http://ns.ad')) out.xmp = true;
      if (m === 0xe2 && id.startsWith('ICC_PROFILE')) out.icc = true;
      if (m === 0xee && id.startsWith('Adobe')) out.adobe = true;
      if (m === 0xfe) out.comment = new TextDecoder().decode(u8.subarray(s, Math.min(e, s + 200))).replace(/\0/g, '').trim();
      if (m >= 0xe0 && m <= 0xef) out.markers.push('APP' + (m - 0xe0) + (id.match(/^[A-Za-z]{3,}/) ? ' ' + id.match(/^[A-Za-z ]+/)[0].trim() : ''));
      if (m === 0xdb) { // DQT: kan inneholde flere tabeller
        let q = s;
        while (q < e) {
          const pq = u8[q] >> 4, tq = u8[q] & 15; q++;
          const t = new Array(64);
          for (let i = 0; i < 64; i++) { t[ZZ[i]] = pq ? (u8[q + 2 * i] << 8) | u8[q + 2 * i + 1] : u8[q + i]; }
          q += pq ? 128 : 64; out.tables[tq] = t;
        }
      }
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
        out.progressive = m === 0xc2;
        out.height = (u8[s + 1] << 8) | u8[s + 2]; out.width = (u8[s + 3] << 8) | u8[s + 4];
        const n = u8[s + 5];
        for (let i = 0; i < n; i++) { const b = u8[s + 7 + i * 3]; out.components.push({ h: b >> 4, v: b & 15, tq: u8[s + 8 + i * 3] }); }
      }
      p = e;
    }
    if (out.components.length >= 3) {
      const y = out.components[0], c = out.components[1];
      out.subsampling = (y.h === c.h && y.v === c.v) ? '4:4:4' : (y.h === 2 * c.h && y.v === 2 * c.v) ? '4:2:0' : (y.h === 2 * c.h && y.v === c.v) ? '4:2:2' : y.h + 'x' + y.v + '/' + c.h + 'x' + c.v;
    }
    if (out.tables[0]) {
      out.lum = bestQuality(out.tables[0], STD_L);
      if (out.tables[1]) out.chr = bestQuality(out.tables[1], STD_C);
      out.standard = out.lum.exact && (!out.chr || out.chr.exact);
      out.nearStandard = !out.standard && out.lum.err <= 64; // små avvik (avrunding i noen programmer)
    }
    return out;
  }

  // ------------------------------------------------------------
  //  EXIF-miniatyr mot hovedbildet
  // ------------------------------------------------------------
  function toGray(img) { const g = new Float32Array(img.width * img.height); const d = img.data; for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return g; }
  // Fjern svarte kanter (noen kameraer legger 16:9-bilder i en 4:3-miniatyr)
  function trimBlack(img) {
    const { width: w, height: h } = img; const g = toGray(img);
    const rowDark = y => { let s = 0; for (let x = 0; x < w; x++) s += g[y * w + x]; return s / w < 12; };
    const colDark = x => { let s = 0; for (let y = 0; y < h; y++) s += g[y * w + x]; return s / h < 12; };
    let t = 0, b = h - 1, l = 0, r = w - 1;
    while (t < h / 3 && rowDark(t)) t++; while (b > h * 2 / 3 && rowDark(b)) b--;
    while (l < w / 3 && colDark(l)) l++; while (r > w * 2 / 3 && colDark(r)) r--;
    return { x: l, y: t, w: r - l + 1, h: b - t + 1 };
  }
  // a = miniatyr, mainScaledVariants = hovedbildet nedskalert til miniatyrens innhold i 4 vendinger
  function compareThumb(thumb, variants) {
    const g = toGray(thumb); const W = thumb.width, H = thumb.height; let best = { diff: Infinity, rot: 0 };
    for (const v of variants) {
      if (v.width !== W || v.height !== H) continue;
      const h = toGray(v);
      // normaliser lysstyrke (miniatyrer er ofte litt annerledes tonet)
      let ma = 0, mb = 0; for (let i = 0; i < g.length; i++) { ma += g[i]; mb += h[i]; } ma /= g.length; mb /= g.length;
      const d = new Float32Array(g.length); let s = 0; for (let i = 0; i < g.length; i++) { d[i] = Math.abs((g[i] - ma) - (h[i] - mb)); s += d[i]; }
      // største avvik i én rute (8×6): fanger lokale endringer (noe fjernet/lagt til)
      const BX = 8, BY = 6; let bmax = 0, bloc = null;
      for (let by = 0; by < BY; by++) for (let bx = 0; bx < BX; bx++) {
        const x0 = Math.floor(bx * W / BX), x1 = Math.floor((bx + 1) * W / BX), y0 = Math.floor(by * H / BY), y1 = Math.floor((by + 1) * H / BY); let t = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t += d[y * W + x]; n++; }
        const m = n ? t / n : 0; if (m > bmax) { bmax = m; bloc = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H }; }
      }
      const r = { diff: s / g.length, blockMax: bmax, block: bloc, rot: v.rot || 0 };
      if (r.diff + r.blockMax * 0.3 < best.diff + (best.blockMax || 0) * 0.3) best = r;
    }
    best.verdict = best.diff >= 22 || best.blockMax >= 38 ? 'ulik' : best.diff < 10 && best.blockMax < 24 ? 'lik' : 'usikker';
    best.local = best.verdict !== 'lik' && best.diff < 15 && best.blockMax >= 24;
    return best;
  }

  // ------------------------------------------------------------
  //  Typiske AI-størrelser og -lengder (svakt hint)
  // ------------------------------------------------------------
  const AI_IMG = ['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '2048x2048', '1344x768', '768x1344', '1216x832', '832x1216', '1152x896', '896x1152', '1536x640', '640x1536', '1456x816', '816x1456', '1232x928', '928x1232', '1664x928', '928x1664', '1472x1104', '1104x1472', '2048x1152', '1152x2048', '1408x768', '768x1408'];
  function aiSizeHint(o) {
    const reasons = [];
    if (o.kind === 'image' && o.width && o.height) {
      if (AI_IMG.includes(o.width + 'x' + o.height)) reasons.push(o.width + '×' + o.height + ' er en standardstørrelse fra AI-bildeverktøy');
      else if (o.width % 64 === 0 && o.height % 64 === 0 && o.width >= 512 && o.height >= 512 && o.width <= 2048) reasons.push(o.width + '×' + o.height + ' er delelig med 64, som er vanlig for bildemodeller');
      if (reasons.length && !o.hasCamera) reasons.push('ingen kameradata');
      if (reasons.length && o.format === 'png') reasons.push('lagret som PNG, uvanlig for kamerabilder');
    }
    if (o.kind === 'video' && o.duration) {
      const near = [4, 5, 6, 8, 10, 15, 20].find(d => Math.abs(o.duration - d) < 0.06);
      if (near) reasons.push('lengden er nesten nøyaktig ' + near + ' s, som er standardlengder i AI-videoverktøy');
      if (near && !o.hasAudio) reasons.push('uten lyd');
      if (near && !o.hasDevice) reasons.push('ingen data om opptaksenhet');
    }
    return reasons.length >= 2 ? reasons : [];
  }

  // ------------------------------------------------------------
  //  Tidslinje
  // ------------------------------------------------------------
  function asDate(v) {
    if (!v) return null; if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    const m = s.match(/^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?(.*)$/);
    if (m) { const tz = m[7] && /[+-]\d\d:?\d\d|Z/.test(m[7]) ? m[7].trim().replace(/^(\d)/, '+$1') : ''; const d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + (tz ? (tz === 'Z' ? 'Z' : tz.replace(/^([+-]\d\d)(\d\d)$/, '$1:$2')) : '')); return isNaN(d) ? null : d; }
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  function timeline(o) {
    const items = []; const add = (label, v, kind, note) => { const d = asDate(v); if (d) items.push({ label, date: d, kind, note: note || '' }); };
    const e = o.exif || {}, x = o.xmp || {}, v = o.video, k = (v && v.keys) || {};
    add('Tatt (EXIF DateTimeOriginal)', e.DateTimeOriginal, 'opptak', e.OffsetTimeOriginal ? 'tidssone ' + e.OffsetTimeOriginal : 'uten tidssone — tolket som lokal tid');
    add('Digitalisert (EXIF CreateDate)', e.CreateDate, 'opptak');
    add('Endret (EXIF ModifyDate)', e.ModifyDate, 'endret');
    if (e.GPSDateStamp && e.GPSTimeStamp) { const t = Array.isArray(e.GPSTimeStamp) ? e.GPSTimeStamp.map(n => String(Math.floor(n)).padStart(2, '0')).join(':') : e.GPSTimeStamp; add('GPS-tid (UTC)', String(e.GPSDateStamp).replace(/:/g, '-') + 'T' + t + 'Z', 'opptak'); }
    add('Laget (XMP CreateDate)', x.CreateDate, 'opptak'); add('Endret (XMP ModifyDate)', x.ModifyDate, 'endret');
    if (v) {
      const ok = d => d && d.getUTCFullYear() > 1971;
      if (ok(v.created)) add('Laget (MP4 mvhd)', v.created, 'opptak', 'UTC'); else items.push({ label: 'Laget (MP4 mvhd)', date: null, kind: 'nullstilt', note: 'tom/nullstilt' + (v.created ? ' (' + v.created.toISOString().slice(0, 10) + ')' : '') });
      if (ok(v.modified)) add('Endret (MP4 mvhd)', v.modified, 'endret', 'UTC');
      add('Opptakstid (QuickTime creationdate)', k['com.apple.quicktime.creationdate'], 'opptak', 'fra enheten');
    }
    add('Sist endret på din maskin', o.fileModified, 'fil', 'filsystemet — endres ved kopiering/nedlasting');
    items.sort((a, b) => (a.date ? a.date - 0 : -Infinity) - (b.date ? b.date - 0 : -Infinity));
    const capture = items.find(i => i.kind === 'opptak' && i.date);
    const notes = [];
    const now = Date.now();
    items.filter(i => i.date && i.date - now > 86400e3).forEach(i => notes.push({ type: 'framtid', text: i.label + ' ligger i framtiden (' + i.date.toISOString().slice(0, 10) + ')' }));
    const mod = items.find(i => i.kind === 'endret' && i.date);
    if (capture && mod && mod.date - capture.date > 120e3) notes.push({ type: 'endret', text: 'Fila er endret/lagret ' + human(mod.date - capture.date) + ' etter opptak (' + mod.label + ')' });
    const ops = items.filter(i => i.kind === 'opptak' && i.date);
    for (let i = 1; i < ops.length; i++) { const d = Math.abs(ops[i].date - ops[0].date); if (d > 3600e3 * 1.01 && Math.abs(d % 3600e3) > 120e3) { notes.push({ type: 'uenige', text: ops[0].label + ' og ' + ops[i].label + ' er ' + human(d) + ' fra hverandre' }); break; } }
    if (items.some(i => i.kind === 'nullstilt')) notes.push({ type: 'nullstilt', text: 'Opprettelsestiden i videoen er tom eller nullstilt' });
    let source = null;
    if (o.sourceTime && capture) { const d = o.sourceTime - capture.date; source = { diffMs: d, text: 'Tidspunktet kilden oppgir er ' + human(Math.abs(d)) + (d > 0 ? ' etter' : ' før') + ' ' + capture.label.toLowerCase() }; }
    return { items, capture, notes, source };
  }
  function human(ms) {
    const s = ms / 1000; if (s < 90) return Math.round(s) + ' s'; if (s < 5400) return Math.round(s / 60) + ' min';
    if (s < 172800) return (Math.round(s / 360) / 10).toString().replace('.', ',') + ' timer'; return Math.round(s / 86400) + ' døgn';
  }

  // ------------------------------------------------------------
  //  Tekst over tid
  // ------------------------------------------------------------
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  // frames = [{t, text}] → tekstlinjer som går igjen, og linjer som «nesten» går igjen (endrer seg)
  function textOverTime(frames) {
    const lines = frames.map(f => Array.from(new Set(String(f.text || '').split('\n').map(norm).filter(s => s.length >= 4))));
    const all = new Map();
    lines.forEach((ls, fi) => ls.forEach(l => { if (!all.has(l)) all.set(l, new Set()); all.get(l).add(fi); }));
    const withText = lines.filter(l => l.length).length;
    const stable = [], morph = [];
    const keys = Array.from(all.keys()).sort((a, b) => all.get(b).size - all.get(a).size);
    const used = new Set();
    for (const a of keys) {
      if (used.has(a)) continue;
      const fa = all.get(a); const variants = [];
      for (const b of keys) {
        if (b === a || used.has(b)) continue;
        const d = lev(a, b) / Math.max(a.length, b.length);
        if (d > 0 && d <= 0.34 && Math.abs(a.length - b.length) <= Math.max(3, a.length * 0.3)) variants.push({ text: b, frames: Array.from(all.get(b)) });
      }
      if (fa.size >= 2 || variants.length) {
        if (variants.length) { morph.push({ text: a, frames: Array.from(fa), variants }); variants.forEach(v => used.add(v.text)); }
        else stable.push({ text: a, frames: Array.from(fa) });
        used.add(a);
      }
    }
    return { framesWithText: withText, frames: frames.length, stable: stable.slice(0, 12), morph: morph.slice(0, 12) };
  }

  // ------------------------------------------------------------
  //  Sol (SunCalc-formlene)
  // ------------------------------------------------------------
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  function sun(date, lat, lon) {
    const d = date / dayMs - 0.5 + J1970 - J2000;
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const lw = rad * -lon, phi = rad * lat, H = rad * (280.16 + 360.9856235 * d) - lw - ra;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    let alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    // lysbrytning nær horisonten
    if (alt > -0.08) alt += 0.0002967 / Math.tan(alt + 0.00312536 / (alt + 0.08901179));
    const azDeg = (az / rad + 180 + 360) % 360;
    return { altitude: alt / rad, azimuth: azDeg, shadowAzimuth: (azDeg + 180) % 360, shadowPerMeter: alt > 0 ? 1 / Math.tan(alt) : Infinity };
  }
  const COMPASS = ['nord', 'nord-nordøst', 'nordøst', 'øst-nordøst', 'øst', 'øst-sørøst', 'sørøst', 'sør-sørøst', 'sør', 'sør-sørvest', 'sørvest', 'vest-sørvest', 'vest', 'vest-nordvest', 'nordvest', 'nord-nordvest'];
  const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  const api = { jpegInfo, ijgTable, bestQuality, trimBlack, compareThumb, aiSizeHint, timeline, textOverTime, sun, compass, human, asDate, lev };
  root.VfForensics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
