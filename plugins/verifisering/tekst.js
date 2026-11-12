// Faktisk Studio · Verifisering · tekst
//
// Leter etter KONKRETE spor i en tekst: rester etter en AI-chat (kildemerker,
// lenker merket av chattetjenesten, chatfraser), plassholdere, Markdown-rester,
// usynlige tegn og metadata i Word- og PDF-filer.
//
// REGEL: ingen AI-score. Statistiske AI-detektorer gir for mange feilalarmer
// (særlig på korte tekster, redigert tekst og tekst som ikke er engelsk).
// Hvert funn er et faktum med «Betyr / Betyr ikke». At ingenting finnes, betyr ingenting.
//
// NB: spesialtegn lages med String.fromCodePoint (ikke escape-sekvenser i kildekoden),
// fordi slike escapes er blitt gjort om til ekte tegn under overføring før.

(function () {
  'use strict';
  const C = cp => String.fromCodePoint(cp);
  const TEXT_EXT = ['txt', 'md', 'markdown', 'text', 'html', 'htm', 'docx', 'pdf', 'rtf', 'csv', 'json', 'xml', 'srt', 'vtt', 'eml'];

  function extOf(name) { return ((name || '').split('.').pop() || '').toLowerCase(); }
  function isTextFile(file) {
    const ext = extOf(file.name);
    if (TEXT_EXT.includes(ext)) return true;
    return /^text\//.test(file.type || '') || /(pdf|wordprocessingml|rtf|json|xml)/.test(file.type || '');
  }

  // ------------------------------------------------------------
  //  Lesing
  // ------------------------------------------------------------
  function decodeText(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    let s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    // Mange erstatningstegn → trolig Windows-1252 / Latin-1
    const bad = (s.match(new RegExp(C(0xFFFD), 'g')) || []).length;
    if (bad > 3 && bad > s.length / 500) s = new TextDecoder('windows-1252').decode(bytes);
    return s;
  }

  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format);
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  // Minimal ZIP-leser (sentralkatalogen) for .docx
  async function unzip(bytes, wanted) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Fila er ikke en gyldig .docx (fant ikke ZIP-katalogen).');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {}; const names = [];
    for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
      names.push(name);
      if (wanted(name) && dv.getUint32(lho, true) === 0x04034b50) {
        const off = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const data = bytes.subarray(off, off + csize);
        try { files[name] = method === 0 ? data : method === 8 ? await inflate(data, 'deflate-raw') : null; } catch (e) { files[name] = null; }
      }
      p += 46 + nlen + xlen + clen;
    }
    return { files, names };
  }

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function docxText(xmlBytes) {
    if (!xmlBytes) return '';
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'application/xml');
    const out = [];
    const ps = doc.getElementsByTagNameNS(W, 'p');
    for (const p of ps) {
      let line = '';
      const walk = n => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (c.namespaceURI === W) {
            if (c.localName === 't') { line += c.textContent; continue; }
            if (c.localName === 'tab') { line += '\t'; continue; }
            if (c.localName === 'br' || c.localName === 'cr') { line += '\n'; continue; }
            if (c.localName === 'delText' || c.localName === 'instrText') continue;
            if (c.localName === 'p') continue; // nestede avsnitt (tekstbokser) tas av ytre løkke
          }
          walk(c);
        }
      };
      walk(p); out.push(line);
    }
    return out.join('\n');
  }
  function xmlFields(bytes) {
    if (!bytes) return {};
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    const d = {};
    const root = doc.documentElement; if (!root) return d;
    for (const c of root.children) { const v = (c.textContent || '').trim(); if (v) d[c.localName] = v; }
    return d;
  }
  function relsLinks(bytes) {
    if (!bytes) return [];
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    return Array.from(doc.getElementsByTagName('Relationship')).filter(r => /hyperlink$/.test(r.getAttribute('Type') || '')).map(r => r.getAttribute('Target')).filter(Boolean);
  }

  async function readDocx(bytes) {
    const want = n => /^word\/(document|footnotes|endnotes|comments)\.xml$/.test(n) || /^word\/_rels\/document\.xml\.rels$/.test(n) || /^docProps\/(core|app|custom)\.xml$/.test(n);
    const { files, names } = await unzip(bytes, want);
    let text = docxText(files['word/document.xml']);
    const extra = [['word/footnotes.xml', 'Fotnoter'], ['word/endnotes.xml', 'Sluttnoter'], ['word/comments.xml', 'Kommentarer']];
    const parts = [];
    for (const [f, lab] of extra) { const t = docxText(files[f]).trim(); if (t) parts.push(lab, t); }
    if (parts.length) text += '\n\n' + parts.join('\n');
    const core = xmlFields(files['docProps/core.xml']); const app = xmlFields(files['docProps/app.xml']);
    const custom = {};
    if (files['docProps/custom.xml']) {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(files['docProps/custom.xml']), 'application/xml');
      for (const p of doc.getElementsByTagName('*')) { if (p.localName === 'property' && p.getAttribute('name')) custom[p.getAttribute('name')] = (p.textContent || '').trim(); }
    }
    const links = relsLinks(files['word/_rels/document.xml.rels']);
    const hasC2pa = names.some(n => /c2pa|jumbf/i.test(n));
    return { format: 'docx', text, links, core, app, custom, zipNames: names, hasC2pa };
  }

  // PDF: metadata i Info-ordboka/XMP, lenker (/URI) og grovt uttrukket tekst
  function pdfString(s, i) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '(') {
      let depth = 0, out = '';
      for (let j = i; j < s.length; j++) {
        const ch = s[j];
        if (ch === '\\') { const n = s[j + 1]; const map = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };
          if (n in map) { out += map[n]; j++; continue; }
          if (/[0-7]/.test(n)) { const m = s.slice(j + 1, j + 4).match(/^[0-7]{1,3}/)[0]; out += String.fromCharCode(parseInt(m, 8)); j += m.length; continue; }
          j++; continue; }
        if (ch === '(') { depth++; if (depth === 1) continue; }
        if (ch === ')') { depth--; if (depth === 0) break; }
        out += ch;
      }
      return decodePdfText(out);
    }
    if (s[i] === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i); const hex = s.slice(i + 1, end).replace(/\s+/g, '');
      let out = ''; for (let k = 0; k + 1 < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
      return decodePdfText(out);
    }
    return '';
  }
  function decodePdfText(raw) {
    if (raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
      let out = ''; for (let k = 2; k + 1 < raw.length; k += 2) out += String.fromCharCode((raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1));
      return out;
    }
    if (raw.charCodeAt(0) === 0xEF && raw.charCodeAt(1) === 0xBB && raw.charCodeAt(2) === 0xBF) {
      try { return new TextDecoder().decode(Uint8Array.from(raw.slice(3), c => c.charCodeAt(0))); } catch (e) {}
    }
    return raw;
  }
  function xmpGet(x, tag) {
    const m = x.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')) || x.match(new RegExp(tag + '="([^"]*)"'));
    if (!m) return '';
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function a85(str) {
    const s = str.replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
    const out = []; let grp = [];
    for (const ch of s) {
      if (ch === 'z' && grp.length === 0) { out.push(0, 0, 0, 0); continue; }
      const c = ch.charCodeAt(0) - 33; if (c < 0 || c > 84) continue;
      grp.push(c);
      if (grp.length === 5) { let v = 0; for (const g of grp) v = v * 85 + g; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); grp = []; }
    }
    if (grp.length) { const n = grp.length; while (grp.length < 5) grp.push(84); let v = 0; for (const g of grp) v = v * 85 + g; const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; out.push(...b.slice(0, n - 1)); }
    return new Uint8Array(out);
  }
  function ahex(str) { const h = str.replace(/[^0-9a-fA-F]/g, ''); const out = new Uint8Array(h.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
  async function readPdf(bytes) {
    const s = new TextDecoder('latin1').decode(bytes);
    const chunks = [s];
    // Pakk ut komprimerte strømmer (FlateDecode) — XMP, lenker og tekst ligger ofte der
    const re = /stream\r?\n/g; let m, n = 0, total = 0;
    while ((m = re.exec(s)) && n < 600 && total < 40e6) {
      const start = m.index + m[0].length; const end = s.indexOf('endstream', start); if (end < 0) break;
      const dict0 = s.slice(Math.max(0, m.index - 400), m.index); const dict = dict0.slice(dict0.lastIndexOf('<<'));
      const fm = dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/);
      const filters = fm ? (fm[1].match(/\/\w+/g) || []).map(x => x.slice(1)) : [];
      if (filters.length && filters.every(f => ['FlateDecode', 'Fl', 'ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx'].includes(f))) {
        try {
          let data = bytes.subarray(start, end);
          for (const f of filters) {
            if (f === 'ASCII85Decode' || f === 'A85') data = a85(new TextDecoder('latin1').decode(data));
            else if (f === 'ASCIIHexDecode' || f === 'AHx') data = ahex(new TextDecoder('latin1').decode(data));
            else data = await inflate(data, 'deflate');
          }
          total += data.length; chunks.push(new TextDecoder('latin1').decode(data));
        } catch (e) {}
      }
      re.lastIndex = end; n++;
    }
    const all = chunks.join('\n');
    const info = {};
    for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) {
      const i = s.lastIndexOf('/' + k); if (i >= 0) { const v = pdfString(s, i + k.length + 1); if (v) info[k] = v; }
    }
    const xi = all.indexOf('<x:xmpmeta'); const xmp = {};
    if (xi >= 0) {
      const x = all.slice(xi, all.indexOf('</x:xmpmeta>', xi) + 12);
      const map = { 'xmp:CreatorTool': 'CreatorTool', 'pdf:Producer': 'Producer (XMP)', 'xmp:CreateDate': 'CreateDate', 'xmp:ModifyDate': 'ModifyDate', 'dc:creator': 'creator', 'dc:title': 'title', 'pdf:Keywords': 'Keywords (XMP)' };
      for (const k of Object.keys(map)) { const v = xmpGet(x, k); if (v) xmp[map[k]] = v; }
    }
    const links = []; const ure = /\/URI\s*\(/g; let u;
    while ((u = ure.exec(all)) && links.length < 2000) { const v = pdfString(all, u.index + 4); if (v) links.push(v); }
    // Grov tekst: strenger i tekstoperatorene (Tj/TJ/'/"). Egne tegnkodinger gir rot.
    const tparts = []; const tre = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|(\((?:[^()\\]|\\.)*\))\s*(?:Tj|'|")/g; let t;
    for (const ch of chunks) {
      if (!/\bBT\b/.test(ch)) continue;
      tre.lastIndex = 0; let line = []; let prevEnd = -1;
      while ((t = tre.exec(ch))) {
        if (prevEnd >= 0 && /(?:^|\s)(?:Td|TD|Tm|T\*|ET)(?:\s|$)/.test(ch.slice(prevEnd, t.index))) line.push(/(?:^|\s)(?:ET|T\*|TD)(?:\s|$)/.test(ch.slice(prevEnd, t.index)) ? '\n' : ' ');
        prevEnd = t.index + t[0].length;
        if (t[1] != null) { const inner = t[1]; const sre = /\((?:[^()\\]|\\.)*\)/g; let q; let w = ''; while ((q = sre.exec(inner))) w += pdfString(q[0], 0); line.push(w); }
        else line.push(pdfString(t[2], 0));
        if (line.length > 50) { tparts.push(line.join('')); line = []; }
      }
      if (line.length) tparts.push(line.join(''));
    }
    let text = tparts.join('\n');
    const letters = (text.match(/[A-Za-zÆØÅæøåÄÖÜäöüé]/g) || []).length;
    const readable = text.length > 0 && letters / text.length > 0.55;
    const hasC2pa = /c2pa/i.test(all);
    return { format: 'pdf', text: readable ? text : '', textUnreadable: !readable, links, info, xmp, hasC2pa };
  }

  async function readHtml(bytes) {
    const raw = decodeText(bytes);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.querySelectorAll('script,style,noscript,template').forEach(e => e.remove());
    doc.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
    doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,td,th,section,article,header,footer,blockquote,pre,figcaption,dt,dd').forEach(e => e.append('\n'));
    const gen = doc.querySelector('meta[name=generator]');
    const links = Array.from(doc.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
    const text = (doc.body ? doc.body.textContent : doc.documentElement.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return { format: 'html', text, raw, links, generator: gen ? gen.getAttribute('content') : '', title: doc.title || '' };
  }

  async function read(file) {
    const ext = extOf(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === 'docx' || /wordprocessingml/.test(file.type || '')) return readDocx(bytes);
    if (ext === 'pdf' || file.type === 'application/pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return readPdf(bytes);
    if (ext === 'html' || ext === 'htm') return readHtml(bytes);
    const text = decodeText(bytes);
    return { format: ext === 'md' || ext === 'markdown' ? 'md' : ext || 'txt', text, links: [] };
  }

  // ------------------------------------------------------------
  //  Analyse
  // ------------------------------------------------------------
  const ZW_NAMES = {
    0x200B: 'nullbredde-mellomrom', 0x200C: 'nullbredde-ikke-sammenføyer', 0x200D: 'nullbredde-sammenføyer', 0x2060: 'ordsammenføyer', 0x180E: 'mongolsk vokalskiller',
    0xFEFF: 'nullbredde hardt mellomrom (BOM)', 0x2061: 'usynlig funksjonstegn', 0x2062: 'usynlig gangetegn', 0x2063: 'usynlig skilletegn', 0x2064: 'usynlig plusstegn',
    0x00AD: 'mykt bindestrek', 0x00A0: 'hardt mellomrom', 0x202F: 'smalt hardt mellomrom', 0x205F: 'matematisk mellomrom', 0x3000: 'ideografisk mellomrom',
    0x200E: 'venstre-til-høyre-merke', 0x200F: 'høyre-til-venstre-merke', 0x061C: 'arabisk bokstavmerke',
    0x202A: 'retningsstyring (LRE)', 0x202B: 'retningsstyring (RLE)', 0x202C: 'retningsstyring (PDF)', 0x202D: 'retningsstyring (LRO)', 0x202E: 'retningsstyring (RLO – snur teksten)',
    0x2066: 'retningsstyring (LRI)', 0x2067: 'retningsstyring (RLI)', 0x2068: 'retningsstyring (FSI)', 0x2069: 'retningsstyring (PDI)',
  };
  const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  function isEmojiish(cp) {
    return (cp >= 0x1F000 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x2300 && cp <= 0x23FF) || (cp >= 0x2B00 && cp <= 0x2BFF) ||
      (cp >= 0x2190 && cp <= 0x21FF) || (cp >= 0x25A0 && cp <= 0x25FF) || cp === 0x00A9 || cp === 0x00AE || cp === 0x2122 || cp === 0x20E3 || cp === 0x3030 || cp === 0x303D;
  }
  function isCjk(cp) { return (cp >= 0x3400 && cp <= 0x9FFF) || (cp >= 0x20000 && cp <= 0x3FFFF); }
  function charName(cp) {
    if (ZW_NAMES[cp]) return ZW_NAMES[cp];
    if (cp >= 0x2000 && cp <= 0x200A) return 'typografisk mellomrom';
    if (cp >= 0xE0000 && cp <= 0xE007F) return 'tag-tegn (usynlig)';
    if ((cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF)) return 'variantvelger';
    if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000) return 'privat tegn';
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return 'kontrolltegn';
    return 'tegn';
  }

  // Skann tegn for tegn. Returnerer klasser med antall og posisjoner (UTF-16-indeks).
  function scanChars(text) {
    const res = { usynlig: [], rom: [], nbsp: [], myk: [], bidi: [], tagg: [], variant: [], privat: [], kontroll: [] };
    const cps = []; for (let i = 0; i < text.length;) { const cp = text.codePointAt(i); cps.push([cp, i]); i += cp > 0xFFFF ? 2 : 1; }
    let tagRun = null; const hidden = [];
    for (let k = 0; k < cps.length; k++) {
      const [cp, i] = cps[k]; const prev = k > 0 ? cps[k - 1][0] : 0; const next = k + 1 < cps.length ? cps[k + 1][0] : 0;
      const len = cp > 0xFFFF ? 2 : 1;
      const hit = cls => res[cls].push({ i, len, cp });
      if (cp >= 0xE0000 && cp <= 0xE007F) {
        // Flagg-sekvenser (f.eks. Skottland) bruker tag-tegn etter U+1F3F4 — det er vanlig emoji
        let b = k; while (b > 0 && cps[b - 1][0] >= 0xE0000 && cps[b - 1][0] <= 0xE007F) b--;
        if (b > 0 && cps[b - 1][0] === 0x1F3F4) continue;
        hit('tagg');
        if (!tagRun || tagRun.end !== i) { tagRun = { start: i, end: i, s: '' }; hidden.push(tagRun); }
        if (cp >= 0xE0020 && cp <= 0xE007E) tagRun.s += String.fromCharCode(cp - 0xE0000);
        tagRun.end = i + len; continue;
      }
      if (cp === 0x200D) { if (isEmojiish(prev) || isEmojiish(next) || prev === 0xFE0F) continue; hit('usynlig'); continue; }
      if (cp === 0xFEFF) { if (i === 0) continue; hit('usynlig'); continue; }
      if ([0x200B, 0x200C, 0x2060, 0x180E, 0x2061, 0x2062, 0x2063, 0x2064].includes(cp)) { hit('usynlig'); continue; }
      if (cp === 0x00AD) { hit('myk'); continue; }
      if (cp === 0x00A0) { hit('nbsp'); continue; }
      if (cp === 0x202F || cp === 0x205F || cp === 0x3000 || (cp >= 0x2000 && cp <= 0x200A)) { hit('rom'); continue; }
      if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200E || cp === 0x200F || cp === 0x061C) { hit('bidi'); continue; }
      if ((cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0xE0100 && cp <= 0xE01EF)) {
        const prevVs = (prev >= 0xFE00 && prev <= 0xFE0F) || (prev >= 0xE0100 && prev <= 0xE01EF);
        const normal = !prevVs && (isEmojiish(prev) || isCjk(prev) || /[0-9#*]/.test(String.fromCodePoint(prev || 32)) || prev > 0x2000);
        if (!normal) hit('variant'); continue;
      }
      if ((cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0x10FFFF)) { hit('privat'); continue; }
      if ((cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) || (cp >= 0x7F && cp <= 0x9F)) { hit('kontroll'); continue; }
    }
    res.hidden = hidden.filter(h => h.s.trim());
    return res;
  }

  // Kildemerker fra chattetjenester
  function markerPatterns() {
    const L = C(0x3010), R = C(0x3011), D = C(0x2020), S = C(0xE200), E = C(0xE201);
    return [
      { re: new RegExp(S + '[^' + E + ']{0,300}' + E, 'g'), label: 'ChatGPT-kildemerke med private tegn (U+E200–E202)' },
      { re: new RegExp(L + '\\d+(?::\\d+)?' + D + '[^' + R + '\\n]{0,80}' + R, 'g'), label: 'kildemerke «' + L + 'n' + D + 'source' + R + '» (OpenAI)' },
      { re: /:?contentReference\[oaicite:\d+\](?:\{index=\d+\})?/g, label: '«contentReference[oaicite:n]» (ChatGPT)' },
      { re: /\[oaicite:\d+\]/g, label: '«[oaicite:n]» (ChatGPT)' },
      { re: /(?:cite|filecite|navlist|image_group|entity|products?|\b)i?turn\d+(?:search|news|view|fetch|file|image|forecast|finance|product|sports|calc|time|academia)\d+/g, label: '«turnNsearchN»-merke (ChatGPT-søk)' },
      { re: /\[\^\d+\^\]/g, label: 'fotnotemerke «[^n^]» (Bing Chat/Copilot)' },
      { re: /<\/?antArtifact\b[^>]*>/g, label: '«antArtifact»-merke (Claude)' },
      { re: /\{\{\s*citation\s*\}\}|\bcitation_marker\b/g, label: 'sitatmerke fra en AI-mal' },
    ];
  }
  const UTM_RE = /[?&](?:utm_source|ref|source)=(chatgpt\.com|chatgpt|openai(?:\.com)?|perplexity(?:\.ai)?|copilot(?:\.microsoft\.com)?|claude(?:\.ai)?|gemini(?:\.google\.com)?|you\.com|phind)\b/i;

  const PHRASES = [
    // Engelsk
    [/\bas an ai(?: language)? model\b/gi, 'AI omtaler seg selv'], [/\bas a large language model\b/gi, 'AI omtaler seg selv'], [/\bas an ai assistant\b/gi, 'AI omtaler seg selv'],
    [/\bi(?:'m| am) an ai (?:language model|assistant|model)\b/gi, 'AI omtaler seg selv'],
    [/\bmy (?:knowledge cutoff|training data|last training update)\b/gi, 'AI om treningsdata'],
    [/\b(?:i'm sorry|i apologi[sz]e),? but i (?:can(?:no|')t|am unable to|don't have access)\b/gi, 'AI-avslag'],
    [/\bi can(?:no|')t (?:help|assist) with (?:that|this)(?: request)?\b/gi, 'AI-avslag'],
    [/\bregenerate response\b/gi, 'knapp fra chat-vinduet'], [/\bcopy code\b/gi, 'knapp fra chat-vinduet (også på kodesider)', 1],
    [/^(?:you said|chatgpt said|claude said|gemini said|copilot said):/gim, 'tekst fra chat-vinduet'],
    [/^(?:chatgpt|claude|gemini|copilot):\s/gim, 'tekst fra chat-vinduet'],
    [/\b(?:certainly|sure|absolutely|of course)! here(?:'s| is| are)\b/gi, 'typisk assistent-åpning', 1],
    [/\bhere(?:'s| is) (?:a|an|the|your) (?:revised|rewritten|polished|improved|edited|updated|shorter|longer|refined|more concise) (?:version|draft|text|paragraph)\b/gi, 'typisk assistent-åpning', 1],
    [/\bi hope this helps\b/gi, 'typisk assistent-avslutning', 1],
    [/\blet me know if you(?:'d like| would like| want| need)\b/gi, 'typisk assistent-avslutning', 1],
    [/\bfeel free to (?:adjust|modify|customi[sz]e|tweak)\b/gi, 'typisk assistent-avslutning', 1],
    // Norsk
    [/\bsom en (?:ki|ai)[- ]?(?:språkmodell|modell|assistent)/gi, 'AI omtaler seg selv'], [/\bsom en (?:stor )?språkmodell/gi, 'AI omtaler seg selv'],
    [/\bjeg er en (?:ki|ai)[- ]?(?:assistent|modell|språkmodell)/gi, 'AI omtaler seg selv'],
    [/\b(?:min|mine) (?:kunnskapsgrense|treningsdata)/gi, 'AI om treningsdata'], [/\bkunnskapen min (?:går|strekker seg) (?:fram|frem) til/gi, 'AI om treningsdata'],
    [/\bbeklager, men jeg (?:kan ikke|har ikke tilgang)/gi, 'AI-avslag'],
    [/^(?:du sa|chatgpt sa|claude sa|gemini sa|copilot sa):/gim, 'tekst fra chat-vinduet'],
    [/(?:^|[\s.!])(?:selvfølgelig|absolutt|klart|gjerne)! her er/gi, 'typisk assistent-åpning', 1],
    [/\bher er (?:en|et|den|det|din|ditt) (?:omskrevet|omskrevne|forbedret|forbedrede|revidert|reviderte|bearbeidet|bearbeidede|kortere|lengre|oppdatert|oppdaterte|redigert|redigerte|strammere) (?:versjon|utgave|tekst|tekst|utkast|avsnitt)/gi, 'typisk assistent-åpning', 1],
    [/\bjeg håper (?:dette|det) (?:hjelper|var nyttig|er nyttig|hjalp)/gi, 'typisk assistent-avslutning', 1],
    [/\b(?:gi|si) meg (?:gjerne )?beskjed (?:om|hvis) du (?:vil|ønsker|trenger)/gi, 'typisk assistent-avslutning', 1],

    [/\b(?:generer|lag) svaret på nytt/gi, 'knapp fra chat-vinduet'], [/\bkopier kode\b/gi, 'knapp fra chat-vinduet (også på kodesider)', 1],
    [/\b(?:ikke nøl med å|du kan gjerne) (?:justere|endre|tilpasse)/gi, 'typisk assistent-avslutning', 1],
  ];
  const PLACEHOLDER_RE = /\[(?:sett inn|legg inn|skriv inn|fyll inn|insert|add|ditt|din|dine|your|navn|name|dato|date|firma|bedrift|company|organisasjon|organization|kilde|source|lenke|link|url|tittel|title|sted|location|antall|number|beløp|amount|tall|figur|xx+|\.\.\.\s*legg)(?![a-zæøåA-ZÆØÅ])[^\[\]\n]{0,60}\]/gi;
  const PLACEHOLDER_RE2 = /\{\{\s*[a-zæøå_ ]{2,30}\s*\}\}/gi;

  // Bytt usynlige tegn, retningstegn, tag-tegn og private tegn med «·» i utdrag (et RLO-tegn kan ellers snu teksten i rapporten)
  function clean(str) {
    let out = '';
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      const bad = (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xFEFF || cp === 0x180E || cp === 0x061C || cp === 0x00AD ||
        (cp >= 0xE0000 && cp <= 0xE007F) || (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000 || (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) || (cp >= 0x7F && cp <= 0x9F);
      out += bad ? (cp >= 0xE0000 && cp <= 0xE007F ? '' : '·') : ch;
    }
    return out;
  }
  function snippet(text, i, len) {
    const a = Math.max(0, i - 40), b = Math.min(text.length, i + len + 40);
    return (a > 0 ? '…' : '') + clean(text.slice(a, b)).replace(/\s+/g, ' ').trim() + (b < text.length ? '…' : '');
  }
  function words(text) { return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; }
  function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function linksIn(text) { return (text.match(/https?:\/\/[^\s<>"'()\]]+/g) || []); }

  const SCRIPT_TOOLS = [
    [/python-docx/i, 'python-docx'], [/docx[-.]?js|\bdocx\b.*npm|Un-named/i, 'docx (JavaScript)'], [/pandoc/i, 'Pandoc'], [/openpyxl/i, 'openpyxl'],
    [/reportlab/i, 'ReportLab'], [/weasyprint/i, 'WeasyPrint'], [/wkhtmltopdf/i, 'wkhtmltopdf'], [/\bpypdf|PyPDF2/i, 'pypdf'], [/\bFPDF\b|fpdf2/i, 'FPDF'],
    [/pdfkit/i, 'PDFKit'], [/pdf-lib/i, 'pdf-lib'], [/puppeteer|HeadlessChrome/i, 'Chrome uten vindu (Puppeteer)'], [/Skia\/PDF/i, 'Skia/PDF (Chrome sin «Skriv ut som PDF»)'],
    [/matplotlib/i, 'matplotlib'], [/jsPDF/i, 'jsPDF'], [/iText/i, 'iText'], [/Typst/i, 'Typst'], [/LaTeX|pdfTeX|XeTeX|LuaTeX/i, 'LaTeX'],
  ];
  const SCRIPTY = ['python-docx', 'docx (JavaScript)', 'Pandoc', 'openpyxl', 'ReportLab', 'WeasyPrint', 'wkhtmltopdf', 'pypdf', 'FPDF', 'PDFKit', 'pdf-lib', 'Chrome uten vindu (Puppeteer)', 'jsPDF', 'matplotlib'];

  function analyze(doc) {
    const text = doc.text || '';
    const raw = doc.raw || text;
    const F = []; const marks = [];
    const add = f => F.push(f);
    const nWords = words(text);

    // 1) Kildemerker
    const mk = []; const taken = [];
    const overlaps = (i, len) => taken.some(([a, b]) => i < b && i + len > a);
    for (const p of markerPatterns()) {
      p.re.lastIndex = 0; let m; const seen = {};
      while ((m = p.re.exec(text))) {
        if (m[0].length === 0) { p.re.lastIndex++; continue; }
        if (overlaps(m.index, m[0].length)) continue;  // f.eks. [oaicite:0] inni contentReference[...]
        taken.push([m.index, m.index + m[0].length]);
        marks.push({ i: m.index, len: m[0].length, cls: 'ai', title: p.label }); seen[m[0]] = (seen[m[0]] || 0) + 1;
      }
      const keys = Object.keys(seen); if (keys.length) mk.push(p.label + ': ' + keys.slice(0, 3).map(k => '«' + clean(k).slice(0, 60) + '»' + (seen[k] > 1 ? ' ×' + seen[k] : '')).join(', ') + (keys.length > 3 ? ' (+' + (keys.length - 3) + ')' : ''));
    }
    if (!mk.length && raw !== text) for (const p of markerPatterns()) { p.re.lastIndex = 0; if (p.re.test(raw)) mk.push(p.label + ' (i kildekoden, ikke i synlig tekst)'); }
    if (mk.length) add({ nivå: 'spor', vekt: 'ai', tittel: 'Kildemerker fra en AI-chat', tekst: mk.join('; ') + '.',
      betyr: 'Slike merker lager chattetjenester når de viser kilder i et svar. De blir med når svaret kopieres ut i rå form (f.eks. med «kopier»-knappen eller via et API).',
      betyrIkke: 'Hvor mye av teksten som kommer fra chatten, eller at resten er AI-skrevet. Merkene kan også stå i tekst som handler om AI eller siterer et svar.' });

    // 2) Lenker merket av en chattetjeneste
    const allLinks = Array.from(new Set((doc.links || []).concat(linksIn(text)).concat(raw !== text ? linksIn(raw) : [])));
    const utm = allLinks.filter(u => UTM_RE.test(u));
    if (utm.length) {
      const by = {}; utm.forEach(u => { const k = (u.match(UTM_RE) || [])[1].toLowerCase(); by[k] = (by[k] || 0) + 1; });
      for (const u of utm) { let j = text.indexOf(u); while (j >= 0) { marks.push({ i: j, len: u.length, cls: 'ai', title: 'lenke merket av ' + (u.match(UTM_RE) || [])[1] }); j = text.indexOf(u, j + u.length); } }
      add({ nivå: 'spor', vekt: 'ai', tittel: 'Lenker merket av en AI-tjeneste', tekst: utm.length + ' lenke' + (utm.length > 1 ? 'r' : '') + ' har ' + Object.keys(by).map(k => '«' + k + '»' + (by[k] > 1 ? ' (' + by[k] + ')' : '')).join(', ') + ' som kilde: ' + Array.from(new Set(utm.map(domain))).slice(0, 6).join(', ') + '.',
        betyr: 'Tjenesten legger dette på lenker den viser i svarene sine (ChatGPT bruker utm_source=chatgpt.com). Lenken er trolig kopiert fra et slikt svar.',
        betyrIkke: 'At teksten er skrevet av AI. Noen kan ha brukt chatten bare til å finne kilder, eller kopiert lenken fra noen andre. Sjekk at kilden faktisk sier det teksten påstår.' });
    }

    // 3) Chatfraser
    const ph = [], phw = [];
    for (const [re, lab, weak] of PHRASES) {
      re.lastIndex = 0; let m; const arr = weak ? phw : ph;
      while ((m = re.exec(text)) && arr.length < 40) {
        const i = m.index + (m[0].length - m[0].trimStart().length); const len = m[0].trim().length;
        marks.push({ i, len, cls: weak ? 'svak' : 'ai', title: lab + (weak ? ' (svakt spor — vanlig også hos mennesker)' : '') }); arr.push({ lab, s: snippet(text, i, len) });
      }
    }
    if (phw.length) add({ nivå: 'spor', vekt: 'noytral', tittel: 'Fraser som er typiske for chat-assistenter (' + phw.length + ')', tekst: phw.slice(0, 4).map(p => '«' + p.s + '»').join(' ') + (phw.length > 4 ? ' (+' + (phw.length - 4) + ' til)' : ''),
      betyr: 'Åpnings- og avslutningsfraser som AI-assistenter ofte bruker («Her er en omskrevet versjon…», «Gi meg beskjed hvis…»). Står de i en ferdig tekst, kan et svar være limt inn uten opprydding.',
      betyrIkke: 'At teksten er AI-generert. Mennesker bruker de samme frasene, særlig i e-post og når de leverer et utkast.' });
    if (ph.length) {
      const labs = Array.from(new Set(ph.map(p => p.lab)));
      add({ nivå: 'spor', vekt: 'ai', tittel: 'Rester av en chatsamtale (' + ph.length + ')', tekst: labs.join(', ') + '. ' + ph.slice(0, 5).map(p => '«' + p.s + '»').join(' ') + (ph.length > 5 ? ' (+' + (ph.length - 5) + ' til)' : ''),
        betyr: 'Fraser AI-assistenter bruker om seg selv (eller når de avslår), eller tekst fra selve chat-vinduet. De blir ofte med når et svar limes inn uten opprydding.',
        betyrIkke: 'At teksten er AI-generert. Frasen kan være sitert, eller teksten kan handle om AI. Les hvert treff i sammenhengen (fanen Tekst).' });
    }

    // 4) Plassholdere
    const pl = [];
    for (const re of [PLACEHOLDER_RE, PLACEHOLDER_RE2]) { re.lastIndex = 0; let m; while ((m = re.exec(text)) && pl.length < 30) { marks.push({ i: m.index, len: m[0].length, cls: 'mal', title: 'plassholder' }); pl.push(m[0]); } }
    if (pl.length) add({ nivå: 'spor', vekt: 'noytral', tittel: 'Plassholdere som ikke er fylt ut (' + pl.length + ')', tekst: Array.from(new Set(pl)).slice(0, 8).map(x => '«' + clean(x) + '»').join(', ') + '.',
      betyr: 'Teksten er laget fra en mal eller et utkast der noe skulle fylles inn. AI-verktøy lager ofte slike, men det gjør vanlige maler også.',
      betyrIkke: 'At teksten er AI-generert.' });

    // 5) Markdown-rester i tekst som ikke er Markdown
    if (doc.format !== 'md') {
      const bold = (text.match(/\*\*[^*\n]{1,120}\*\*/g) || []).length;
      const heads = (text.match(/^#{1,6} \S/gm) || []).length;
      const bullets = (text.match(/^\s*[-*] \*\*[^*\n]+\*\*/gm) || []).length;
      if (bold >= 2 || heads >= 1) {
        let m; const re = /\*\*[^*\n]{1,120}\*\*|^#{1,6} [^\n]*/gm; while ((m = re.exec(text))) marks.push({ i: m.index, len: m[0].length, cls: 'mal', title: 'Markdown' });
        add({ nivå: 'spor', vekt: 'noytral', tittel: 'Markdown-tegn i vanlig tekst', tekst: [bold ? '«**fet**» ' + bold + ' ganger' : '', heads ? '«#»-overskrifter ' + heads : '', bullets ? 'kulepunkter som starter med fet tekst ' + bullets : ''].filter(Boolean).join(', ') + '.',
          betyr: 'Teksten er kopiert fra et sted som skriver Markdown, f.eks. et chat-svar, et notatprogram eller en utviklerplattform, uten at formateringen ble gjort om.',
          betyrIkke: 'At den kommer fra AI. Mange notatprogrammer og nettsteder bruker Markdown.' });
      }
    }

    // 6) Usynlige og uvanlige tegn
    const sc = scanChars(text);
    const CL = { usynlig: 'usynlige tegn', rom: 'uvanlige mellomrom', bidi: 'retningstegn', variant: 'variantvelgere utenfor emoji', privat: 'private tegn', kontroll: 'kontrolltegn', myk: 'myke bindestreker', nbsp: 'harde mellomrom' };
    const detail = [];
    for (const k of Object.keys(CL)) {
      if (!sc[k].length) continue;
      const byCp = {}; sc[k].forEach(h => { byCp[h.cp] = (byCp[h.cp] || 0) + 1; if (k !== 'nbsp' && k !== 'myk') marks.push({ i: h.i, len: h.len, cls: 'inv', cp: h.cp, title: hex(h.cp) + ' ' + charName(h.cp) }); else marks.push({ i: h.i, len: h.len, cls: 'inv-svak', cp: h.cp, title: hex(h.cp) + ' ' + charName(h.cp) }); });
      detail.push(CL[k] + ': ' + Object.keys(byCp).map(cp => charName(+cp) + ' (' + hex(+cp) + ') ×' + byCp[cp]).join(', '));
    }
    const strong = ['usynlig', 'rom', 'bidi', 'variant', 'privat', 'kontroll'].some(k => sc[k].length);
    if (detail.length) add({ nivå: strong ? 'spor' : 'info', vekt: 'noytral', tittel: strong ? 'Usynlige eller uvanlige tegn' : 'Harde mellomrom / myke bindestreker',
      tekst: detail.join('; ') + '.' + (sc.bidi.some(h => h.cp === 0x202E || h.cp === 0x202D) ? ' NB: tegn som snur tekstretningen kan få tekst til å se annerledes ut enn den er.' : ''),
      betyr: strong ? 'Tegnene følger ofte med ved kopiering fra nettsider, Word, PDF og meldingsapper. Enkelte AI-modeller har også skrevet tegn som U+202F i svar, og usynlige tegn brukes til å merke eller spore tekst. Se hvor de står i fanen Tekst.'
        : 'Vanlig i tekst fra Word, nettsider og tastaturer med hardt mellomrom (f.eks. «10 000» og «s. 3»).',
      betyrIkke: 'At teksten er AI-generert. De fleste AI-tekster har ingen slike tegn, og de fjernes lett.' });
    for (const h of sc.hidden) marks.push({ i: h.start, len: h.end - h.start, cls: 'skjult', title: 'Skjult tekst i tag-tegn: ' + h.s, hidden: h.s });
    if (sc.hidden.length) add({ nivå: 'spor', vekt: 'noytral', tittel: 'Skjult tekst i usynlige tegn', tekst: 'Usynlige tag-tegn staver: ' + sc.hidden.slice(0, 3).map(h => '«' + h.s.slice(0, 200) + '»').join(', ') + '.',
      betyr: 'Noen har gjemt lesbar tekst i teksten med tegn som ikke vises. Det brukes bl.a. til skjulte instrukser til AI-verktøy som leser teksten («prompt injection») eller til å merke en tekst.',
      betyrIkke: 'Hvem som la den inn, eller at teksten ellers er AI-skrevet.' });

    // 7) Dokumentmetadata (docx/pdf/html)
    const tools = [];
    const meta = {};
    if (doc.format === 'docx') {
      const c = doc.core || {}, a = doc.app || {};
      Object.assign(meta, { 'Program (Application)': [a.Application, a.AppVersion].filter(Boolean).join(' '), 'Forfatter (creator)': c.creator, 'Sist endret av': c.lastModifiedBy, 'Laget': c.created, 'Endret': c.modified, 'Revisjon': c.revision, 'Redigeringstid (min)': a.TotalTime, 'Tittel': c.title, 'Beskrivelse': c.description, 'Emneord': c.keywords, 'Mal': a.Template, 'Firma': a.Company, 'Ord (lagret i fila)': a.Words });
      for (const [k, v] of Object.entries(doc.custom || {})) meta['Egendefinert · ' + k] = v;
      const hay = [a.Application, c.creator, c.lastModifiedBy, c.description, a.Template].filter(Boolean).join(' | ');
      for (const [re, name] of SCRIPT_TOOLS) if (re.test(hay)) tools.push(name);
      if (/^2013-12-23T23:15/.test(c.created || '')) tools.push('python-docx (standarddato 23.12.2013)');
      const tt = +a.TotalTime;
      if (a.TotalTime != null && a.TotalTime !== '' && nWords >= 200 && tt <= 3) add({ nivå: 'spor', vekt: 'noytral', tittel: 'Kort redigeringstid i fila', tekst: 'Word har registrert ' + tt + ' min redigering for ' + nWords.toLocaleString('nb-NO') + ' ord.',
        betyr: 'Teksten ble trolig limt inn fra et annet sted, eller fila ble laget av et program.',
        betyrIkke: 'At den er AI-generert. Mange skriver i et annet program og limer inn, og tallet nullstilles ved «Lagre som».' });
    } else if (doc.format === 'pdf') {
      Object.assign(meta, doc.info || {}, doc.xmp || {});
      const hay = Object.values(meta).join(' | ');
      for (const [re, name] of SCRIPT_TOOLS) if (re.test(hay)) tools.push(name);
      if (doc.textUnreadable) add({ nivå: 'mangler', vekt: 'noytral', tittel: 'Fikk ikke tak i teksten i PDF-en', tekst: 'PDF-en bruker egen tegnkoding eller er et skannet bilde. Lenker og metadata er lest, men selve teksten er ikke sjekket.',
        betyr: 'Kopier teksten fra Forhåndsvisning og lim den inn i feltet «Lim inn tekst» for å sjekke den.', betyrIkke: 'Noe om innholdet.' });
    } else if (doc.format === 'html') {
      if (doc.generator) meta['Generator (meta)'] = doc.generator;
      if (doc.title) meta['Tittel'] = doc.title;
    }
    if (doc.hasC2pa) add({ nivå: 'merking', vekt: 'noytral', tittel: 'Mulig Content Credentials (C2PA) i dokumentet', tekst: 'Fila inneholder «c2pa», men manifestet i ' + doc.format + '-filer leses ikke her.',
      betyr: 'Et program kan ha merket dokumentet med hvem som laget det. Sjekk på contentcredentials.org/verify.', betyrIkke: 'At den er AI-laget eller ekte.' });
    for (let k = tools.length - 1; k >= 0; k--) if (tools.some((t, j) => j !== k && t !== tools[k] && t.indexOf(tools[k]) === 0)) tools.splice(k, 1);
    const prog = meta['Program (Application)'] || meta.Producer || meta.Creator || meta.CreatorTool || meta['Generator (meta)'];
    if (tools.length) {
      const scripty = tools.some(t => SCRIPTY.some(s => t.indexOf(s) === 0));
      add({ nivå: 'spor', vekt: 'noytral', tittel: 'Laget med: ' + Array.from(new Set(tools)).join(', '), tekst: 'Fra dokumentets metadata' + (prog ? ' («' + prog + '»)' : '') + '.',
        betyr: scripty ? 'Dokumentet er laget av et program eller skript, ikke skrevet i et vanlig tekstbehandlingsprogram. Chattetjenester som lager Word- eller PDF-filer for brukeren, bruker ofte slike biblioteker.' : 'Programmet som laget eller eksporterte fila.',
        betyrIkke: 'At innholdet er AI-generert. Utviklere, publiseringssystemer og eksportfunksjoner bruker de samme verktøyene.' });
    } else if (prog) add({ nivå: 'info', vekt: 'noytral', tittel: 'Laget med: ' + prog, tekst: 'Fra dokumentets metadata.', betyr: 'Programmet som laget eller sist lagret fila.', betyrIkke: 'Noe om hvem som skrev teksten. Metadata kan endres.' });

    // 8) Lenker (oversikt)
    if (allLinks.length) {
      const doms = {}; allLinks.forEach(u => { const d = domain(u); if (d) doms[d] = (doms[d] || 0) + 1; });
      const top = Object.keys(doms).sort((x, y) => doms[y] - doms[x]).slice(0, 10);
      add({ nivå: 'info', vekt: 'noytral', tittel: 'Lenker: ' + allLinks.length, tekst: top.map(d => d + (doms[d] > 1 ? ' (' + doms[d] + ')' : '')).join(', ') + (Object.keys(doms).length > 10 ? ' …' : '') + '.',
        betyr: 'Kildene teksten viser til. Sjekk at de finnes og sier det teksten påstår — AI-tekster kan ha lenker og kilder som ikke finnes.', betyrIkke: 'At kildene er brukt riktig.' });
    }

    // 9) Ingen AI-rester
    if (!F.some(f => f.vekt === 'ai') && text.trim()) add({ nivå: 'mangler', vekt: 'noytral', tittel: 'Fant ingen kjente AI-rester', tekst: 'Ingen kildemerker, chat-lenker eller chatfraser verktøyet kjenner til.',
      betyr: 'Teksten har ingen av de konkrete sporene som ofte blir med fra en AI-chat.',
      betyrIkke: 'At teksten er skrevet av et menneske. AI-tekst som er kopiert rent eller redigert har ingen slike spor, og det finnes ingen pålitelig måte å avsløre den på ut fra språket alene. AI-detektorer gir mange feilalarmer, særlig på korte og ikke-engelske tekster.' });

    return { findings: F, marks, stats: { words: nWords, chars: text.length, links: allLinks.length }, meta, chars: sc };
  }

  // Tekst med markeringer → HTML (usynlige tegn vises som merkelapper)
  function badChars(str, esc) {
    let out = '';
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      const bad = (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xFEFF || (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000 || (cp >= 0xE0000 && cp <= 0xE007F);
      out += bad ? '<span class="vf-inv" title="' + hex(cp) + ' ' + charName(cp) + '">' + hex(cp).slice(2) + '</span>' : esc(ch);
    }
    return out;
  }
  function renderMarked(text, marks, esc, max) {
    const lim = Math.min(text.length, max || 300000);
    const ms = marks.filter(m => m.i < lim).sort((a, b) => a.i - b.i || b.len - a.len);
    let out = '', pos = 0;
    for (const m of ms) {
      if (m.i < pos) continue;
      out += esc(text.slice(pos, m.i));
      if (m.cls === 'inv' || m.cls === 'inv-svak') out += '<span class="vf-inv' + (m.cls === 'inv-svak' ? ' vf-inv--svak' : '') + '" title="' + esc(m.title) + '">' + hex(m.cp).slice(2) + '</span>';
      else if (m.cls === 'skjult') out += '<span class="vf-inv vf-inv--skjult" title="' + esc(m.title) + '">skjult tekst: «' + esc(m.hidden.slice(0, 120)) + '»</span>';
      else out += '<mark class="vf-tm vf-tm--' + m.cls + '" title="' + esc(m.title) + '">' + badChars(text.slice(m.i, m.i + m.len), esc) + '</mark>';
      pos = m.i + m.len;
    }
    out += esc(text.slice(pos, lim));
    if (lim < text.length) out += '\n\n[… ' + (text.length - lim).toLocaleString('nb-NO') + ' tegn til vises ikke]';
    return out;
  }

  window.VfTekst = { isTextFile, read, analyze, renderMarked, _scanChars: scanChars };
})();
