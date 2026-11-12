// Faktisk Studio · felles filimport (CSV, TSV, TXT og Excel .xlsx) — kanonisk kopi i plugins/_shared/.
//
//   FaktiskImport.readFile(file)            → Promise<{ sheets: [{ name, rows: string[][] }] }>
//   FaktiskImport.openDialog({ title, fields, onApply })
//        fields:  [{ key, label, guess: /regex for kolonneoverskrift/, required }]
//        onApply: (objekter[]) — én per datarad, med feltene som nøkler
//
// Ingen eksterne bibliotek: .xlsx pakkes ut med nettleserens DecompressionStream og leses med DOMParser.
// CSV: finner skilletegn selv (semikolon, komma, tabulator), støtter "sitert, tekst", og faller tilbake til
// Windows-1252 når fila ikke er gyldig UTF-8 (vanlig for CSV lagret fra norsk Excel).
(function (root) {
  'use strict';

  // ---------- CSV / TSV ----------
  function decodeText(buf) {
    var u = new Uint8Array(buf), s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(u); }
    catch (e) { s = new TextDecoder('windows-1252').decode(u); }
    return s.replace(/^﻿/, '');
  }
  function sniffDelim(text) {
    var line = text.split(/\r?\n/).find(function (l) { return l.trim(); }) || '';
    var best = '\t', n = -1;
    ['\t', ';', ','].forEach(function (d) {
      var c = 0, q = false;
      for (var i = 0; i < line.length; i++) { var ch = line[i]; if (ch === '"') q = !q; else if (!q && ch === d) c++; }
      if (c > n) { n = c; best = d; }
    });
    return best;
  }
  function parseDelimited(text, d) {
    d = d || sniffDelim(text);
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return clean(rows);
  }
  function clean(rows) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    var w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    // fjern tomme kolonner helt til høyre
    while (w > 0 && rows.every(function (r) { return !r[w - 1]; })) w--;
    return rows.map(function (r) { var o = r.slice(0, w); while (o.length < w) o.push(''); return o; });
  }

  // ---------- XLSX (zip + XML) ----------
  function unzip(buf) {
    var dv = new DataView(buf), u = new Uint8Array(buf), eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Fila ser ikke ut som en gyldig .xlsx (fant ikke zip-katalog).');
    var n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true), files = {};
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      var lho = dv.getUint32(off + 42, true), name = new TextDecoder().decode(u.subarray(off + 46, off + 46 + nlen));
      var dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      files[name] = { method: method, data: u.subarray(dstart, dstart + csize) };
      off += 46 + nlen + xlen + clen;
    }
    return files;
  }
  async function inflate(entry) {
    if (entry.method === 0) return new TextDecoder().decode(entry.data);
    if (entry.method !== 8) throw new Error('Ukjent komprimering i .xlsx (metode ' + entry.method + ').');
    var ds = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  }
  function xml(s) { return new DOMParser().parseFromString(s, 'application/xml'); }
  function kids(el, tag) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.localName === tag; }); }
  function txt(el) { return Array.prototype.map.call(el.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join(''); }
  function colIdx(ref) { var m = /^([A-Z]+)/.exec(ref || ''), c = 0; if (!m) return -1; for (var i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64); return c - 1; }
  function fmtNum(v) { var n = +v; if (!isFinite(n)) return v; return String(Math.round(n * 1e9) / 1e9); }

  async function parseXlsx(buf) {
    var files = unzip(buf), get = async function (p) { return files[p] ? await inflate(files[p]) : null; };
    var shared = [], ss = await get('xl/sharedStrings.xml');
    if (ss) Array.prototype.forEach.call(xml(ss).getElementsByTagNameNS('*', 'si'), function (si) { shared.push(txt(si)); });
    var wb = xml(await get('xl/workbook.xml') || '<workbook/>'), rels = {}, relsX = await get('xl/_rels/workbook.xml.rels');
    if (relsX) Array.prototype.forEach.call(xml(relsX).getElementsByTagNameNS('*', 'Relationship'), function (r) { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    var sheets = [];
    var list = Array.prototype.slice.call(wb.getElementsByTagNameNS('*', 'sheet'));
    for (var i = 0; i < list.length; i++) {
      var s = list[i], rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      var target = rels[rid] || ('worksheets/sheet' + (i + 1) + '.xml');
      var path = target.replace(/^\//, '').replace(/^xl\//, ''); path = 'xl/' + path;
      var sx = await get(path); if (!sx) continue;
      var rows = [];
      Array.prototype.forEach.call(xml(sx).getElementsByTagNameNS('*', 'row'), function (r) {
        var ri = (+r.getAttribute('r') || rows.length + 1) - 1, out = [];
        kids(r, 'c').forEach(function (c, ci) {
          var t = c.getAttribute('t'), idx = colIdx(c.getAttribute('r')); if (idx < 0) idx = ci;
          var v = kids(c, 'v')[0], val = '';
          if (t === 's') val = shared[+(v && v.textContent)] || '';
          else if (t === 'inlineStr') { var is = kids(c, 'is')[0]; val = is ? txt(is) : ''; }
          else if (t === 'b') val = v && v.textContent === '1' ? 'SANN' : 'USANN';
          else if (t === 'str' || t === 'e') val = v ? v.textContent : '';
          else val = v ? fmtNum(v.textContent) : '';
          out[idx] = val;
        });
        for (var k = 0; k < out.length; k++) if (out[k] == null) out[k] = '';
        rows[ri] = out;
      });
      for (var k2 = 0; k2 < rows.length; k2++) if (!rows[k2]) rows[k2] = [];
      sheets.push({ name: s.getAttribute('name') || ('Ark ' + (i + 1)), rows: clean(rows) });
    }
    if (!sheets.length) throw new Error('Fant ingen ark i .xlsx-fila.');
    return sheets;
  }

  async function readFile(file) {
    var name = (file && file.name || '').toLowerCase(), buf = await file.arrayBuffer();
    if (/\.xlsx$/.test(name)) return { sheets: await parseXlsx(buf) };
    if (/\.(xls|numbers|ods)$/.test(name)) throw new Error('Dette formatet støttes ikke direkte. Lagre som .xlsx eller .csv og prøv igjen.');
    var text = decodeText(buf);
    return { sheets: [{ name: file.name, rows: parseDelimited(text, /\.tsv$/.test(name) ? '\t' : null) }] };
  }

  // ---------- Dialog: velg ark, overskriftsrad og kolonne per felt ----------
  var CSS = '.fki-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;font:13px/1.4 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#fff}'
    + '.fki{background:#3c3c3c;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);width:min(860px,92vw);max-height:88vh;display:flex;flex-direction:column;padding:18px 20px;gap:12px}'
    + '.fki h3{margin:0;font-size:16px}.fki-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}'
    + '.fki select,.fki input[type=file]{background:#5a5a5a;color:#fff;border:0;border-radius:6px;padding:5px 8px;font:inherit}'
    + '.fki-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}.fki-map label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#ddd}'
    + '.fki-prev{overflow:auto;border-radius:8px;background:#2c2c2c;max-height:42vh}.fki-prev table{border-collapse:collapse;font-size:12px;min-width:100%}'
    + '.fki-prev th,.fki-prev td{padding:4px 8px;border-bottom:1px solid #444;text-align:left;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}'
    + '.fki-prev th{background:#4a4a4a;position:sticky;top:0}.fki-prev td.on,.fki-prev th.on{background:rgba(0,80,252,.35)}'
    + '.fki-err{background:#7a2b2b;border-radius:6px;padding:8px 10px}.fki-btns{display:flex;justify-content:flex-end;gap:8px}'
    + '.fki-btn{border:0;border-radius:6px;padding:7px 14px;font:inherit;font-weight:bold;cursor:pointer;background:#6a6a6a;color:#fff}.fki-btn--p{background:#0050FC}.fki-btn:disabled{opacity:.4;cursor:default}'
    + '.fki-drop{border:2px dashed #777;border-radius:10px;padding:22px;text-align:center;color:#ccc}.fki-drop.is-over{border-color:#0050FC;color:#fff}.fki small{color:#bbb}';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function openDialog(opt) {
    if (!document.getElementById('fki-css')) { var st = el('style'); st.id = 'fki-css'; st.textContent = CSS; document.head.appendChild(st); }
    var fields = opt.fields || [], ov = el('div', 'fki-ov'), box = el('div', 'fki');
    ov.appendChild(box); document.body.appendChild(ov);
    var data = null, sheetIdx = 0, header = true, map = {};
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    function guess(heads) {
      map = {};
      fields.forEach(function (f, fi) {
        var hit = -1;
        if (header && f.guess) heads.forEach(function (h, i) { if (hit < 0 && f.guess.test(h) && Object.keys(map).every(function (k) { return map[k] !== i; })) hit = i; });
        if (hit < 0 && !header) hit = fi < heads.length ? fi : -1;
        map[f.key] = hit;
      });
    }
    function rowsNow() { var r = data.sheets[sheetIdx].rows; return header ? r.slice(1) : r; }
    function headsNow() { var r = data.sheets[sheetIdx].rows, w = r[0] ? r[0].length : 0; return header ? r[0] : Array.from({ length: w }, function (_, i) { return 'Kolonne ' + String.fromCharCode(65 + i); }); }

    function pickView(err) {
      box.innerHTML = '<h3>' + esc(opt.title || 'Importer fil') + '</h3>'
        + (err ? '<div class="fki-err">' + esc(err) + '</div>' : '')
        + '<div class="fki-drop">Slipp en fil her, eller <label style="text-decoration:underline;cursor:pointer">velg fil<input type="file" accept=".xlsx,.csv,.tsv,.txt" hidden></label><br><small>Excel (.xlsx), CSV eller TSV. Fra Google Sheets: Fil → Last ned → .xlsx eller .csv.</small></div>'
        + '<div class="fki-btns"><button class="fki-btn" data-x>Avbryt</button></div>';
      var inp = box.querySelector('input[type=file]'), drop = box.querySelector('.fki-drop');
      inp.addEventListener('change', function () { if (inp.files[0]) load(inp.files[0]); });
      ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
      ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
      drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) load(f); });
      box.querySelector('[data-x]').addEventListener('click', close);
    }
    async function load(file) {
      try { data = await readFile(file); }
      catch (e) { pickView(e.message || String(e)); return; }
      sheetIdx = 0; header = true;
      if (!data.sheets[0].rows.length) { pickView('Fila er tom.'); return; }
      guess(headsNow()); mapView(file.name);
    }
    function mapView(fname) {
      var heads = headsNow(), rows = rowsNow();
      var colOpts = function (sel) { return '<option value="-1">– ikke bruk –</option>' + heads.map(function (h, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + esc(h || 'Kolonne ' + String.fromCharCode(65 + i)) + '</option>'; }).join(''); };
      var used = {}; fields.forEach(function (f) { if (map[f.key] >= 0) used[map[f.key]] = 1; });
      box.innerHTML = '<h3>' + esc(opt.title || 'Importer fil') + ' <small>· ' + esc(fname) + '</small></h3>'
        + '<div class="fki-row">'
        + (data.sheets.length > 1 ? '<label>Ark <select data-sheet>' + data.sheets.map(function (s, i) { return '<option value="' + i + '"' + (i === sheetIdx ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' : '')
        + '<label><input type="checkbox" data-head' + (header ? ' checked' : '') + '> Første rad er overskrifter</label>'
        + '<small>' + rows.length + ' rader</small></div>'
        + '<div class="fki-map">' + fields.map(function (f) { return '<label>' + esc(f.label) + (f.required ? ' *' : '') + '<select data-f="' + f.key + '">' + colOpts(map[f.key]) + '</select></label>'; }).join('') + '</div>'
        + '<div class="fki-prev"><table><thead><tr>' + heads.map(function (h, i) { return '<th class="' + (used[i] ? 'on' : '') + '">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>'
        + rows.slice(0, 12).map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (used[i] ? 'on' : '') + '">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('')
        + '</tbody></table></div>'
        + (rows.length > 12 ? '<small>Viser 12 av ' + rows.length + ' rader.</small>' : '')
        + '<div class="fki-row" style="justify-content:space-between"><label>' + (opt.replaceLabel ? '<input type="checkbox" data-rep checked> ' + esc(opt.replaceLabel) : '') + '</label>'
        + '<div class="fki-btns"><button class="fki-btn" data-back>Annen fil</button><button class="fki-btn" data-x>Avbryt</button><button class="fki-btn fki-btn--p" data-ok>Importer ' + rows.length + ' rader</button></div></div>';
      var ok = box.querySelector('[data-ok]');
      var miss = fields.filter(function (f) { return f.required && !(map[f.key] >= 0); });
      ok.disabled = !!miss.length || !rows.length;
      box.querySelectorAll('select[data-f]').forEach(function (s) { s.addEventListener('change', function () { map[s.dataset.f] = +s.value; mapView(fname); }); });
      var sh = box.querySelector('[data-sheet]'); if (sh) sh.addEventListener('change', function () { sheetIdx = +sh.value; guess(headsNow()); mapView(fname); });
      box.querySelector('[data-head]').addEventListener('change', function (e) { header = e.target.checked; guess(headsNow()); mapView(fname); });
      box.querySelector('[data-back]').addEventListener('click', function () { pickView(); });
      box.querySelector('[data-x]').addEventListener('click', close);
      ok.addEventListener('click', function () {
        var rep = box.querySelector('[data-rep]');
        var objs = rowsNow().map(function (r) { var o = {}; fields.forEach(function (f) { o[f.key] = map[f.key] >= 0 ? (r[map[f.key]] || '') : ''; }); return o; });
        close(); opt.onApply(objs, { replace: rep ? rep.checked : true });
      });
    }
    pickView();
  }

  root.FaktiskImport = { readFile: readFile, openDialog: openDialog, parseDelimited: parseDelimited };
})(typeof window !== 'undefined' ? window : globalThis);
