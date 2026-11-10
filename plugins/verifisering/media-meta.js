// Faktisk Studio · Verifisering — media-meta
//
// Teknisk metadata uten ffmpeg:
//  - Video (MP4/MOV, ISO-BMFF): moov-boksen (mvhd/tkhd/mdhd/hdlr/stsd/stts/stss),
//    udta-tekster (©too, ©xyz …) og QuickTime-nøkler (com.apple.quicktime.*).
//    Leser bare boks-hoder og moov — mdat (selve videoen) hoppes over, bortsett
//    fra den første MB-en der x264/Lavc skriver navnet sitt.
//  - Bilder: exifr (EXIF, TIFF, GPS, IPTC, XMP).
//  - XMP (alle formater): DigitalSourceType, CreatorTool m.m. med enkle regex.
//
// window.VfMeta i plugin-vinduet, module.exports i Node (tester).

(function (root) {
  'use strict';

  const td = new TextDecoder('utf-8');
  const ascii = (u8, s, n) => String.fromCharCode.apply(null, u8.subarray(s, s + n));
  const u32 = (u8, o) => ((u8[o] << 24) >>> 0) + (u8[o + 1] << 16) + (u8[o + 2] << 8) + u8[o + 3];
  const u16 = (u8, o) => (u8[o] << 8) | u8[o + 1];
  const u64 = (u8, o) => u32(u8, o) * 4294967296 + u32(u8, o + 4);
  const s32 = (u8, o) => u32(u8, o) | 0;

  function boxes(u8, s, e) {
    const out = [];
    while (s + 8 <= e) {
      let size = u32(u8, s); const type = ascii(u8, s + 4, 4); let h = 8;
      if (size === 1) { size = u64(u8, s + 8); h = 16; } else if (size === 0) size = e - s;
      if (size < h || s + size > e) break;
      out.push({ type, start: s, data: s + h, end: s + size });
      s += size;
    }
    return out;
  }
  const find = (list, t) => list.find(b => b.type === t);
  const kids = (u8, b, skip) => boxes(u8, b.data + (skip || 0), b.end);
  // QuickTime/MP4-tid: sekunder siden 1904-01-01 UTC
  const qtDate = s => (s > 0 ? new Date((s - 2082844800) * 1000) : null);

  function parseUdtaText(u8, b) {
    // ©-tekster: [len u16][lang u16][tekst] — eller en «data»-boks (iTunes-stil)
    const inner = boxes(u8, b.data, b.end);
    const d = find(inner, 'data');
    if (d) return td.decode(u8.subarray(d.data + 8, d.end));
    if (b.end - b.data >= 4) { const L = u16(u8, b.data); if (L && b.data + 4 + L <= b.end) return td.decode(u8.subarray(b.data + 4, b.data + 4 + L)); }
    return td.decode(u8.subarray(b.data, b.end)).replace(/\0/g, '');
  }
  function parseMetaKeys(u8, meta, out) {
    // meta (fullbox i MP4, vanlig boks i QuickTime) → hdlr 'mdta' + keys + ilst
    let list = kids(u8, meta, 0);
    if (!find(list, 'hdlr') && !find(list, 'keys')) list = kids(u8, meta, 4);
    const keysB = find(list, 'keys'), ilst = find(list, 'ilst');
    if (keysB && ilst) {
      const n = u32(u8, keysB.data + 4); const names = []; let p = keysB.data + 8;
      for (let i = 0; i < n && p + 8 <= keysB.end; i++) { const L = u32(u8, p); names.push(td.decode(u8.subarray(p + 8, p + L))); p += L; }
      for (const it of boxes(u8, ilst.data, ilst.end)) {
        const idx = u32(u8, it.start + 4); const d = find(boxes(u8, it.data, it.end), 'data');
        if (!d || !names[idx - 1]) continue;
        const typ = u32(u8, d.data) & 0xffffff; const val = u8.subarray(d.data + 8, d.end);
        out[names[idx - 1]] = typ === 1 ? td.decode(val) : (typ === 23 ? new DataView(val.buffer, val.byteOffset).getFloat32(0) : (val.length <= 8 ? Array.from(val).reduce((a, b) => a * 256 + b, 0) : '(' + val.length + ' byte)'));
      }
    } else if (ilst) {
      for (const it of boxes(u8, ilst.data, ilst.end)) out[it.type] = parseUdtaText(u8, it);
    }
  }

  // Redigeringsliste (edts/elst): tom redigering = forsinkelse, media_time = hopp i starten.
  // Nettlesere følger den ved avspilling, men decodeAudioData gjør det IKKE — derfor
  // regner vi ut hvor mye lyden må flyttes for å stemme med bildet.
  function parseElst(u8, edts, movieTs, mediaTs) {
    const elst = find(kids(u8, edts), 'elst'); if (!elst) return null;
    const v = u8[elst.data], n = u32(u8, elst.data + 4); let p = elst.data + 8, empty = 0, mediaTime = 0, entries = [];
    for (let i = 0; i < n; i++) {
      const dur = v === 1 ? u64(u8, p) : u32(u8, p); const mt = v === 1 ? (u32(u8, p + 8) | 0) * 4294967296 + u32(u8, p + 12) : s32(u8, p + 4);
      p += v === 1 ? 20 : 12; entries.push([dur, mt]);
      if (mt === -1) { if (!entries.some(e => e[1] >= 0)) empty += dur; } else if (entries.filter(e => e[1] >= 0).length === 1) mediaTime = mt;
    }
    return { entries, startDelay: movieTs ? empty / movieTs : 0, mediaSkip: mediaTs ? mediaTime / mediaTs : 0, offset: (movieTs ? empty / movieTs : 0) - (mediaTs ? mediaTime / mediaTs : 0) };
  }
  function parseTrak(u8, trak, movieTs) {
    const t = { handler: '', codec: '', width: 0, height: 0, timescale: 0, duration: 0, samples: 0, fps: 0, keyframeEvery: 0, syncSamples: 0, handlerName: '', language: '' };
    const tk = kids(u8, trak);
    const tkhd = find(tk, 'tkhd');
    if (tkhd) { const v = u8[tkhd.data]; const o = tkhd.end - 8; t.width = u32(u8, o) / 65536; t.height = u32(u8, o + 4) / 65536; t.tkhdVersion = v; }
    const mdia = find(tk, 'mdia'); if (!mdia) return t;
    const edts = find(tk, 'edts');
    const md = kids(u8, mdia);
    const mdhd = find(md, 'mdhd');
    if (mdhd) {
      const v = u8[mdhd.data]; const o = mdhd.data + 4 + (v === 1 ? 16 : 8);
      t.timescale = u32(u8, o); t.duration = v === 1 ? u64(u8, o + 4) : u32(u8, o + 4);
      const lang = u16(u8, o + (v === 1 ? 12 : 8));
      t.language = String.fromCharCode(((lang >> 10) & 31) + 96, ((lang >> 5) & 31) + 96, (lang & 31) + 96);
    }
    if (edts) { const e = parseElst(u8, edts, movieTs, t.timescale); if (e) { t.editList = e.entries.map(x => x.join(':')).join(' '); t.startDelay = e.startDelay; t.mediaSkip = e.mediaSkip; } }
    const hdlr = find(md, 'hdlr');
    if (hdlr) { t.handler = ascii(u8, hdlr.data + 8, 4); t.handlerName = td.decode(u8.subarray(hdlr.data + 24, hdlr.end)).replace(/[\x00-\x1f]/g, '').trim(); }
    const minf = find(md, 'minf'); if (!minf) return t;
    const stbl = find(kids(u8, minf), 'stbl'); if (!stbl) return t;
    const st = kids(u8, stbl);
    const stsd = find(st, 'stsd');
    if (stsd) {
      const e = stsd.data + 8; t.codec = ascii(u8, e + 4, 4);
      if (t.handler === 'vide') { t.codedWidth = u16(u8, e + 32); t.codedHeight = u16(u8, e + 34); const cn = u8[e + 50]; if (cn > 0 && cn < 32) t.compressor = ascii(u8, e + 51, cn); }
      if (t.handler === 'soun') { t.channels = u16(u8, e + 24); t.sampleRate = u32(u8, e + 32) / 65536; }
    }
    const stts = find(st, 'stts');
    if (stts) {
      const n = u32(u8, stts.data + 4); let best = 0, bestDelta = 0, tot = 0;
      for (let i = 0; i < n; i++) { const c = u32(u8, stts.data + 8 + i * 8), d = u32(u8, stts.data + 12 + i * 8); tot += c; if (c > best) { best = c; bestDelta = d; } }
      t.samples = tot; if (bestDelta && t.timescale) t.fps = t.timescale / bestDelta; t.sttsEntries = n;
    }
    const stss = find(st, 'stss');
    if (stss) {
      const n = u32(u8, stss.data + 4); t.syncSamples = n;
      if (n > 1) { const gaps = []; for (let i = 1; i < Math.min(n, 400); i++) gaps.push(u32(u8, stss.data + 8 + i * 4) - u32(u8, stss.data + 4 + i * 4)); gaps.sort((a, b) => a - b); t.keyframeEvery = gaps[gaps.length >> 1]; t.keyframeRegular = gaps[0] === gaps[gaps.length - 1]; }
    } else if (t.handler === 'vide') t.allKeyframes = true;
    return t;
  }

  async function bmff(reader) {
    const top = [];
    { // toppnivå-bokser via korte lesinger
      let p = 0;
      while (p + 8 <= reader.size && top.length < 4000) {
        const h = await reader.read(p, 16);
        let size = u32(h, 0); const type = ascii(h, 4, 4); let hl = 8;
        if (size === 1) { size = u64(h, 8); hl = 16; } else if (size === 0) size = reader.size - p;
        if (size < hl) break;
        top.push({ type, start: p, data: p + hl, end: Math.min(p + size, reader.size), size });
        p += size;
      }
    }
    const out = { container: 'ISO-BMFF', boxes: top.map(b => b.type), brand: '', compatible: [], tracks: [], tags: {}, keys: {}, encoderHints: [] };
    const ftyp = find(top, 'ftyp');
    if (ftyp) {
      const u8 = await reader.read(ftyp.data, Math.min(ftyp.end - ftyp.data, 256));
      out.brand = ascii(u8, 0, 4).trim(); out.compatible = [];
      for (let o = 8; o + 4 <= u8.length; o += 4) out.compatible.push(ascii(u8, o, 4).trim());
    }
    const moovB = find(top, 'moov');
    if (moovB && moovB.end - moovB.data < 150e6) {
      const u8 = await reader.read(moovB.data, moovB.end - moovB.data);
      const mv = boxes(u8, 0, u8.length);
      const mvhd = find(mv, 'mvhd');
      if (mvhd) {
        const v = u8[mvhd.data]; const o = mvhd.data + 4;
        const ct = v === 1 ? u64(u8, o) : u32(u8, o), mt = v === 1 ? u64(u8, o + 8) : u32(u8, o + 4);
        const ts = u32(u8, o + (v === 1 ? 16 : 8)), du = v === 1 ? u64(u8, o + 20) : u32(u8, o + 12);
        out.created = qtDate(ct); out.modified = qtDate(mt); out.duration = ts ? du / ts : 0; out.timescale = ts;
      }
      for (const b of mv) {
        if (b.type === 'trak') out.tracks.push(parseTrak(u8, b, out.timescale));
        if (b.type === 'udta') {
          for (const x of boxes(u8, b.data, b.end)) {
            if (x.type === 'meta') parseMetaKeys(u8, x, out.keys);
            else if (x.type.charCodeAt(0) === 0xa9 || ['auth', 'titl', 'dscp', 'cprt', 'gnre', 'loci', 'yrrc'].includes(x.type)) {
              try { out.tags[x.type.replace('©', '©')] = parseUdtaText(u8, x); } catch (e) {}
            } else if (x.type === 'smta' || x.type === 'SDLN' || x.type === 'manu' || x.type === 'modl') {
              out.tags[x.type] = td.decode(u8.subarray(x.data, Math.min(x.end, x.data + 80))).replace(/[^\x20-\x7e]/g, '').trim();
            }
          }
        }
        if (b.type === 'meta') parseMetaKeys(u8, b, out.keys);
      }
    }
    // Koderens navn i begynnelsen av videodataene (x264 skriver en klartekst-SEI)
    const mdat = find(top, 'mdat');
    if (mdat) {
      const u8 = await reader.read(mdat.data, Math.min(1 << 20, mdat.end - mdat.data));
      const s = new TextDecoder('latin1').decode(u8);
      const m264 = s.match(/x264 - core \d+[^\0]{0,40}/); if (m264) out.encoderHints.push(m264[0].split(' - H.264')[0]);
      const m265 = s.match(/x265 \(build \d+\)[^\0]{0,20}|HEVC encoder version [\d.]+/); if (m265) out.encoderHints.push(m265[0]);
      const lavc = s.match(/Lavc\d+\.\d+\.\d+/); if (lavc) out.encoderHints.push(lavc[0]);
    }
    return out;
  }

  // XMP: de feltene som betyr noe for verifisering
  function xmpFields(xml) {
    if (!xml) return {};
    const pick = (re) => { const m = xml.match(re); return m ? m[1].trim() : ''; };
    const attrOrEl = (name) => pick(new RegExp(name + '="([^"]*)"')) || pick(new RegExp('<' + name + '>([^<]*)<'));
    const out = {
      DigitalSourceType: attrOrEl('Iptc4xmpExt:DigitalSourceType') || attrOrEl('Iptc4xmpCore:DigitalSourceType'),
      CreatorTool: attrOrEl('xmp:CreatorTool'),
      CreateDate: attrOrEl('xmp:CreateDate'),
      ModifyDate: attrOrEl('xmp:ModifyDate'),
      Credit: attrOrEl('photoshop:Credit'),
      Provenance: attrOrEl('dcterms:provenance'),
      DocumentID: attrOrEl('xmpMM:DocumentID'),
      OriginalDocumentID: attrOrEl('xmpMM:OriginalDocumentID'),
    };
    const hist = xml.match(/stEvt:softwareAgent="([^"]+)"/g) || [];
    out.History = Array.from(new Set(hist.map(h => h.replace(/stEvt:softwareAgent="|"/g, '')))).join(' · ');
    const desc = xml.match(/<dc:description>[\s\S]*?<rdf:li[^>]*>([^<]*)</); if (desc) out.Description = desc[1];
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out;
  }

  // Filnavn som ligner standardnavn fra kjente AI-verktøy (svakt hint, aldri bevis)
  const NAME_HINTS = [
    [/^Gemini_Generated_Image_/i, 'Google Gemini'],
    [/^ChatGPT Image /i, 'ChatGPT'],
    [/^DALL[·.\-_ ]?E/i, 'DALL·E'],
    [/^(Firefly|Adobe ?Firefly)/i, 'Adobe Firefly'],
    [/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_\d)?\.(png|webp|jpe?g)$/i, 'Midjourney (brukernavn_prompt_uuid)'],
    [/\bsora\b/i, 'Sora'],
    [/\bveo\s?\d?\b/i, 'Veo'],
    [/\bgrok[-_ ]?(image|video)/i, 'Grok'],
    [/\bkling\b/i, 'Kling'],
    [/\bhailuo\b|\bminimax\b/i, 'Hailuo/MiniMax'],
    [/\brunway\b|\bgen-?[34]\b/i, 'Runway'],
    [/\bpika\b/i, 'Pika'],
    [/\bseedance\b|\bdreamina\b|\bjimeng\b/i, 'Seedance/Dreamina'],
    [/\bleonardo\b/i, 'Leonardo'],
    [/\bideogram\b/i, 'Ideogram'],
    [/\bflux\b/i, 'FLUX'],
    [/\bstable[-_ ]?diffusion\b|\bComfyUI_\d+/i, 'Stable Diffusion/ComfyUI'],
  ];
  function nameHints(name) {
    const out = [];
    for (const [re, label] of NAME_HINTS) if (re.test(name || '')) out.push(label);
    return out;
  }

  const api = { bmff, xmpFields, nameHints, qtDate };
  root.VfMeta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
