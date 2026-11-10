// Faktisk Studio · Verifisering — c2pa-lite
//
// Leser Content Credentials (C2PA) direkte fra fila, uten WASM:
// finner manifestlageret (JUMBF) i JPEG, PNG, WebP og ISO-BMFF (MP4/MOV/HEIC/AVIF),
// dekoder CBOR/JSON og trekker ut verktøy, handlinger (inkl. digitalSourceType),
// ingredienser og signeringssertifikatets eier.
//
// VIKTIG: Signaturen KONTROLLERES IKKE her. Alt som leses er det fila påstår.
// Full kontroll krever c2pa-biblioteket (9 MB WASM) — se docs/verifisering_plugin.md.
//
// Kjører både i plugin-vinduet (window.VfC2pa) og i Node (module.exports) for tester.
// «reader» = { size, read(offset, length) → Promise<Uint8Array> }.

(function (root) {
  'use strict';

  const td = new TextDecoder('utf-8');
  const ascii = (u8, s, n) => String.fromCharCode.apply(null, u8.subarray(s, s + n));
  const u32 = (u8, o) => ((u8[o] << 24) >>> 0) + (u8[o + 1] << 16) + (u8[o + 2] << 8) + u8[o + 3];
  const u16 = (u8, o) => (u8[o] << 8) | u8[o + 1];
  const u64 = (u8, o) => u32(u8, o) * 4294967296 + u32(u8, o + 4);
  const hex = (u8, s, n) => Array.from(u8.subarray(s, s + n), b => b.toString(16).padStart(2, '0')).join('');

  const UUID_C2PA_BMFF = 'd8fec3d61b0e483c92975828877ec481';
  const UUID_XMP_BMFF = 'be7acfcb97a942e89c71999491e3afac';

  // ------------------------------------------------------------
  //  CBOR (RFC 8949) — nok for C2PA-claims, -assertions og COSE
  // ------------------------------------------------------------
  function cborDecode(u8) {
    let p = 0;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    function len(ai) {
      if (ai < 24) return ai;
      if (ai === 24) return u8[p++];
      if (ai === 25) { const v = dv.getUint16(p); p += 2; return v; }
      if (ai === 26) { const v = dv.getUint32(p); p += 4; return v; }
      if (ai === 27) { const v = dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); p += 8; return v; }
      if (ai === 31) return -1; // ubestemt lengde
      throw new Error('CBOR: ugyldig lengde');
    }
    function half(h) {
      const s = h & 0x8000, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
      const v = e === 0 ? f * Math.pow(2, -24) : e === 31 ? (f ? NaN : Infinity) : (f + 1024) * Math.pow(2, e - 25);
      return s ? -v : v;
    }
    function item() {
      if (p >= u8.length) throw new Error('CBOR: slutt på data');
      const b = u8[p++], mt = b >> 5, ai = b & 31;
      if (mt === 7) {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        if (ai === 25) { const v = half(dv.getUint16(p)); p += 2; return v; }
        if (ai === 26) { const v = dv.getFloat32(p); p += 4; return v; }
        if (ai === 27) { const v = dv.getFloat64(p); p += 8; return v; }
        if (ai === 24) { return { simple: u8[p++] }; }
        if (ai === 31) return BREAK;
        return { simple: ai };
      }
      const n = len(ai);
      if (mt === 0) return n;
      if (mt === 1) return -1 - n;
      if (mt === 2 || mt === 3) {
        let bytes;
        if (n < 0) {
          const parts = [];
          for (;;) { const c = item(); if (c === BREAK) break; parts.push(mt === 2 ? c : new TextEncoder().encode(c)); }
          const tot = parts.reduce((a, c) => a + c.length, 0); bytes = new Uint8Array(tot);
          let o = 0; for (const c of parts) { bytes.set(c, o); o += c.length; }
        } else { bytes = u8.subarray(p, p + n); p += n; }
        return mt === 2 ? bytes : td.decode(bytes);
      }
      if (mt === 4) {
        const a = [];
        if (n < 0) { for (;;) { const c = item(); if (c === BREAK) break; a.push(c); } }
        else for (let i = 0; i < n; i++) a.push(item());
        return a;
      }
      if (mt === 5) {
        const m = {};
        const put = () => { const k = item(); if (k === BREAK) return false; m[typeof k === 'object' ? JSON.stringify(k) : String(k)] = item(); return true; };
        if (n < 0) { while (put()); } else for (let i = 0; i < n; i++) put();
        return m;
      }
      if (mt === 6) return { tag: n, value: item() };
      throw new Error('CBOR: ukjent type');
    }
    const BREAK = { brk: 1 };
    return item();
  }
  const untag = v => (v && typeof v === 'object' && 'tag' in v && 'value' in v) ? untag(v.value) : v;

  // ------------------------------------------------------------
  //  JUMBF (ISO 19566-5)
  // ------------------------------------------------------------
  function boxes(u8, s, e) {
    const out = [];
    while (s + 8 <= e) {
      let size = u32(u8, s); const type = ascii(u8, s + 4, 4); let h = 8;
      if (size === 1) { size = u64(u8, s + 8); h = 16; }
      else if (size === 0) size = e - s;
      if (size < h || s + size > e) break;
      out.push({ type, start: s, data: s + h, end: s + size });
      s += size;
    }
    return out;
  }
  function parseJumb(u8, s, e) {
    const node = { label: '', uuid: '', kind: '', children: [], content: [] };
    for (const b of boxes(u8, s, e)) {
      if (b.type === 'jumd') {
        node.uuid = hex(u8, b.data, 16);
        node.kind = ascii(u8, b.data, 4);
        const tog = u8[b.data + 16];
        let q = b.data + 17;
        if (tog & 2) { let z = q; while (z < b.end && u8[z] !== 0) z++; node.label = td.decode(u8.subarray(q, z)); q = z + 1; }
      } else if (b.type === 'jumb') {
        node.children.push(parseJumb(u8, b.data, b.end));
      } else {
        node.content.push({ type: b.type, bytes: u8.subarray(b.data, b.end) });
      }
    }
    return node;
  }
  function decodeContent(node) {
    for (const c of node.content) {
      try {
        if (c.type === 'cbor') return untag(cborDecode(c.bytes));
        if (c.type === 'json') return JSON.parse(td.decode(c.bytes));
      } catch (e) { return { _feil: e.message }; }
    }
    return null;
  }

  // ------------------------------------------------------------
  //  DER-sertifikat: eier (subject) og utsteder (issuer)
  // ------------------------------------------------------------
  function derTLV(u8, p) {
    const tag = u8[p]; let l = u8[p + 1], h = 2;
    if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + u8[p + 2 + i]; h = 2 + n; }
    return { tag, start: p, data: p + h, end: p + h + l };
  }
  function derChildren(u8, t) { const out = []; let p = t.data; while (p < t.end) { const c = derTLV(u8, p); out.push(c); p = c.end; } return out; }
  function derOid(u8, t) {
    const b = u8.subarray(t.data, t.end); const out = [Math.floor(b[0] / 40), b[0] % 40]; let v = 0;
    for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { out.push(v); v = 0; } }
    return out.join('.');
  }
  function derString(u8, v) {
    const b = u8.subarray(v.data, v.end);
    if (v.tag === 0x1e) { let r = ''; for (let i = 0; i + 1 < b.length; i += 2) r += String.fromCharCode((b[i] << 8) | b[i + 1]); return r; }
    if (v.tag === 0x14) return String.fromCharCode.apply(null, b);
    return td.decode(b);
  }
  function derName(u8, t) {
    const names = { '2.5.4.3': 'CN', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST' };
    const out = {};
    for (const set of derChildren(u8, t)) for (const atv of derChildren(u8, set)) {
      const [o, v] = derChildren(u8, atv);
      const k = names[derOid(u8, o)]; if (k && !out[k]) out[k] = derString(u8, v);
    }
    return out;
  }
  function derTime(u8, t) {
    const s = ascii(u8, t.data, t.end - t.data);
    const m = t.tag === 0x17 ? s.match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/) : s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)/);
    if (!m) return s;
    const y = t.tag === 0x17 ? (Number(m[1]) < 50 ? '20' : '19') + m[1] : m[1];
    return y + '-' + m[2] + '-' + m[3];
  }
  function parseCert(der) {
    try {
      const cert = derTLV(der, 0); const tbs = derChildren(der, cert)[0]; const f = derChildren(der, tbs);
      let i = 0; if (f[0].tag === 0xa0) i = 1;
      const issuer = derName(der, f[i + 2]); const validity = derChildren(der, f[i + 3]); const subject = derName(der, f[i + 4]);
      return { subject, issuer, notBefore: derTime(der, validity[0]), notAfter: derTime(der, validity[1]) };
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------
  //  Manifestlager → lesbart sammendrag
  // ------------------------------------------------------------
  function softwareName(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    return [a.name, a.version].filter(Boolean).join(' ');
  }
  function generatorOf(claim) {
    if (!claim) return '';
    const info = claim.claim_generator_info;
    if (Array.isArray(info) && info.length) return info.map(softwareName).filter(Boolean).join(', ');
    if (info && typeof info === 'object') return softwareName(info);
    return claim.claim_generator || '';
  }
  function summarizeManifest(m) {
    const out = { label: m.label, generator: '', title: '', format: '', instanceID: '', actions: [], ingredients: [], authors: [], assertionLabels: [], signer: null, alg: '' };
    for (const ch of m.children) {
      const lab = ch.label || '';
      if (lab === 'c2pa.assertions') {
        for (const a of ch.children) {
          const l = a.label || ''; out.assertionLabels.push(l);
          const base = l.replace(/__\d+$/, '');
          if (/^c2pa\.actions(\.v\d+)?$/.test(base)) {
            const d = decodeContent(a) || {};
            for (const x of (d.actions || [])) {
              out.actions.push({
                action: x.action || '',
                digitalSourceType: x.digitalSourceType || (x.parameters && x.parameters.digitalSourceType) || '',
                softwareAgent: softwareName(x.softwareAgent),
                when: x.when || '',
                description: x.description || (x.parameters && x.parameters.description) || '',
              });
            }
          } else if (/^c2pa\.ingredient(\.v\d+)?$/.test(base)) {
            const d = decodeContent(a) || {};
            out.ingredients.push({ title: d.title || d['dc:title'] || '', format: d.format || d['dc:format'] || '', relationship: d.relationship || '' });
          } else if (base === 'stds.schema-org.CreativeWork') {
            const d = decodeContent(a) || {};
            const au = Array.isArray(d.author) ? d.author : d.author ? [d.author] : [];
            for (const x of au) out.authors.push(typeof x === 'string' ? x : (x.name || x['@id'] || ''));
          }
        }
      } else if (/^c2pa\.claim(\.v\d+)?$/.test(lab)) {
        const c = decodeContent(ch) || {};
        out.generator = generatorOf(c);
        out.title = c['dc:title'] || c.title || '';
        out.format = c['dc:format'] || c.format || '';
        out.instanceID = c.instanceID || c.instance_id || '';
        out.claimVersion = /v2$/.test(lab) ? 2 : 1;
      } else if (lab === 'c2pa.signature') {
        try {
          const cose = untag(decodeContent(ch));
          if (Array.isArray(cose)) {
            let prot = {};
            if (cose[0] instanceof Uint8Array && cose[0].length) prot = untag(cborDecode(cose[0])) || {};
            const unprot = cose[1] || {};
            const alg = prot['1'];
            out.alg = { '-7': 'ES256', '-35': 'ES384', '-36': 'ES512', '-37': 'PS256', '-38': 'PS384', '-39': 'PS512', '-8': 'Ed25519' }[String(alg)] || (alg != null ? String(alg) : '');
            let chain = prot['33'] || unprot['33'] || prot.x5chain || unprot.x5chain;
            if (chain instanceof Uint8Array) chain = [chain];
            if (Array.isArray(chain) && chain[0] instanceof Uint8Array) out.signer = parseCert(chain[0]);
            out.hasTimestamp = !!(unprot.sigTst || unprot.sigTst2 || unprot.rVals);
          }
        } catch (e) { out.signatureError = e.message; }
      }
    }
    return out;
  }
  function parseStore(u8) {
    const top = boxes(u8, 0, u8.length).find(b => b.type === 'jumb');
    if (!top) return null;
    const store = parseJumb(u8, top.data, top.end);
    if (store.label !== 'c2pa' && store.kind !== 'c2pa') return null;
    const manifests = store.children.map(summarizeManifest);
    return { manifests, active: manifests[manifests.length - 1] || null, bytes: u8.length };
  }

  // ------------------------------------------------------------
  //  Finn manifestlageret i fila
  // ------------------------------------------------------------
  async function readAll(reader, max) {
    if (reader.size > max) return null;
    return reader.read(0, reader.size);
  }
  function concat(parts) {
    const tot = parts.reduce((a, c) => a + c.length, 0); const u8 = new Uint8Array(tot); let o = 0;
    for (const c of parts) { u8.set(c, o); o += c.length; } return u8;
  }
  function detectFormat(h) {
    if (h[0] === 0xff && h[1] === 0xd8) return 'jpeg';
    if (h[0] === 0x89 && ascii(h, 1, 3) === 'PNG') return 'png';
    if (ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'WEBP') return 'webp';
    if (ascii(h, 0, 4) === 'GIF8') return 'gif';
    if ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2a) || (h[0] === 0x4d && h[1] === 0x4d && h[3] === 0x2a)) return 'tiff';
    const t = ascii(h, 4, 4);
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'uuid', 'pnot'].includes(t)) return 'bmff';
    return 'ukjent';
  }

  function fromJpeg(u8) {
    const groups = {}; const xmp = [];
    let p = 2;
    while (p + 4 <= u8.length && u8[p] === 0xff) {
      const m = u8[p + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      if (m === 0xda || m === 0xd9) break;
      const L = u16(u8, p + 2); const s = p + 4, e = p + 2 + L;
      if (m === 0xeb && ascii(u8, s, 2) === 'JP') {
        const en = u16(u8, s + 2), z = u32(u8, s + 4);
        const chunk = u8.subarray(s + 8, e);
        (groups[en] = groups[en] || []).push({ z, chunk });
      } else if (m === 0xe1) {
        const head = ascii(u8, s, Math.min(29, e - s));
        if (head.startsWith('http://ns.adobe.com/xap/1.0/')) xmp.push(td.decode(u8.subarray(s + 29, e)));
      }
      p = e;
    }
    let store = null;
    for (const en of Object.keys(groups)) {
      const parts = groups[en].sort((a, b) => a.z - b.z).map((g, i) => i === 0 ? g.chunk : g.chunk.subarray(8));
      const s = concat(parts);
      if (s.length >= 8 && ascii(s, 4, 4) === 'jumb') {
        const r = parseStore(s); if (r) { store = r; break; }
      }
    }
    return { store, xmp: xmp.join('\n') };
  }
  function fromPng(u8) {
    let p = 8, store = null; const xmp = [];
    while (p + 12 <= u8.length) {
      const L = u32(u8, p), t = ascii(u8, p + 4, 4), d = p + 8;
      if (t === 'caBX') store = parseStore(u8.subarray(d, d + L));
      else if (t === 'iTXt') {
        const z = u8.indexOf(0, d); const kw = ascii(u8, d, z - d);
        if (kw === 'XML:com.adobe.xmp') { let q = z + 3; q = u8.indexOf(0, q) + 1; q = u8.indexOf(0, q) + 1; xmp.push(td.decode(u8.subarray(q, d + L))); }
      }
      if (t === 'IEND') break;
      p = d + L + 4;
    }
    return { store, xmp: xmp.join('\n') };
  }
  function fromWebp(u8) {
    let p = 12, store = null; const xmp = [];
    while (p + 8 <= u8.length) {
      const t = ascii(u8, p, 4); const L = u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24);
      const d = p + 8;
      if (t === 'C2PA') store = parseStore(u8.subarray(d, d + L));
      else if (t === 'XMP ') xmp.push(td.decode(u8.subarray(d, d + L)));
      p = d + L + (L & 1);
    }
    return { store, xmp: xmp.join('\n') };
  }
  // ISO-BMFF: les bare boks-hodene, hopp over mdat (kan være mange GB)
  async function topBoxes(reader) {
    const out = []; let p = 0;
    while (p + 8 <= reader.size && out.length < 4000) {
      const h = await reader.read(p, 16);
      let size = u32(h, 0); const type = ascii(h, 4, 4); let hl = 8;
      if (size === 1) { size = u64(h, 8); hl = 16; } else if (size === 0) size = reader.size - p;
      if (size < hl) break;
      out.push({ type, start: p, data: p + hl, end: Math.min(p + size, reader.size) });
      p += size;
    }
    return out;
  }
  async function fromBmff(reader) {
    let store = null; const xmp = [];
    for (const b of await topBoxes(reader)) {
      if (b.type !== 'uuid') continue;
      const id = await reader.read(b.data, 16);
      const uid = hex(id, 0, 16);
      if (uid === UUID_C2PA_BMFF && b.end - b.data < 200e6) {
        const u8 = await reader.read(b.data + 16, b.end - b.data - 16);
        let q = 4; let z = q; while (z < u8.length && u8[z] !== 0) z++;
        const purpose = ascii(u8, q, z - q); q = z + 1;
        if (purpose === 'manifest') { q += 8; const r = parseStore(u8.subarray(q)); if (r) store = r; }
      } else if (uid === UUID_XMP_BMFF && b.end - b.data < 20e6) {
        xmp.push(td.decode(await reader.read(b.data + 16, b.end - b.data - 16)));
      }
    }
    return { store, xmp: xmp.join('\n') };
  }

  async function read(reader) {
    const head = await reader.read(0, Math.min(64, reader.size));
    const format = detectFormat(head);
    let r = { store: null, xmp: '' };
    try {
      if (format === 'bmff') r = await fromBmff(reader);
      else if (['jpeg', 'png', 'webp'].includes(format)) {
        const u8 = await readAll(reader, 300e6);
        if (u8) r = format === 'jpeg' ? fromJpeg(u8) : format === 'png' ? fromPng(u8) : fromWebp(u8);
      }
    } catch (e) { r.error = e.message; }
    r.format = format;
    const prov = (r.xmp.match(/dcterms:provenance(?:="|>)([^"<]+)/) || [])[1] || '';
    r.remote = /^https?:/i.test(prov) ? prov : '';
    return r;
  }

  // ------------------------------------------------------------
  //  IPTC digitalSourceType → norsk forklaring
  // ------------------------------------------------------------
  const DST = {
    trainedAlgorithmicMedia: { no: 'Laget av generativ AI', ai: 'full' },
    compositeWithTrainedAlgorithmicMedia: { no: 'Satt sammen med innhold fra generativ AI', ai: 'delvis' },
    algorithmicMedia: { no: 'Laget av en algoritme uten opptak (ikke nødvendigvis AI)', ai: 'algoritme' },
    compositeSynthetic: { no: 'Satt sammen av syntetisk innhold', ai: 'delvis' },
    algorithmicallyEnhanced: { no: 'Forbedret med algoritme/AI (f.eks. oppskalering, støyfjerning)', ai: 'forbedret' },
    digitalCapture: { no: 'Tatt opp digitalt med kamera eller mikrofon', ai: 'opptak' },
    computationalCapture: { no: 'Tatt opp med kamera med databehandling (f.eks. mobilkamera)', ai: 'opptak' },
    negativeFilm: { no: 'Skannet fra negativ film', ai: 'opptak' },
    positiveFilm: { no: 'Skannet fra positiv film/dias', ai: 'opptak' },
    print: { no: 'Skannet fra papirbilde', ai: 'opptak' },
    minorHumanEdits: { no: 'Opptak med små manuelle endringer', ai: 'opptak' },
    humanEdits: { no: 'Redigert av et menneske', ai: 'redigert' },
    compositeCapture: { no: 'Satt sammen av flere opptak', ai: 'redigert' },
    digitalArt: { no: 'Digital kunst laget av et menneske', ai: 'kunst' },
    virtualRecording: { no: 'Opptak av en virtuell scene (f.eks. spill)', ai: 'virtuell' },
    screenCapture: { no: 'Skjermbilde eller skjermopptak', ai: 'skjerm' },
    dataDrivenMedia: { no: 'Laget fra data (f.eks. diagram)', ai: 'data' },
  };
  function describeSourceType(uri) {
    if (!uri) return null;
    const key = String(uri).split('/').pop();
    return Object.assign({ key, uri }, DST[key] || { no: key, ai: 'ukjent' });
  }

  const api = { read, cborDecode, parseStore, describeSourceType, detectFormat, topBoxes, UUID_C2PA_BMFF, UUID_XMP_BMFF };
  root.VfC2pa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
