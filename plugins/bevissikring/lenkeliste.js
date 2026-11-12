// Faktisk Studio · Bevissikring — liste med lenker (lastes etter profil.js)
//
// Lim inn lenker eller last opp .txt/.csv/Excel. Hver lenke blir sin egen
// sikring i saken, på én av to måter:
//   «video»   — bare videoen med referanser (yt-dlp: fil, tittel, konto,
//               dato, beskrivelse, lenke), som «Last ned bare videoen».
//   «grundig» — siden åpnes i sikringsvinduet, kommentarene åpnes, og den
//               sikres som «Sikre siden» (valgene under «Hva sikres», video
//               alltid med).
// En kolonne med «video» eller «grundig» overstyrer valget per lenke; annen
// tekst på linja blir notat.
//
// Lista lagres og hashes i saken FØR noe hentes. Ingen ny Studio-IPC: lista
// gjenbruker profil-lagringen (bevisProfileSave → <sak>/_profiler/<tid>_web/
// med liste.json, liste.csv og SHA256SUMS.txt; scan.kind = 'lenkeliste'),
// bevisProfileResult logger hver lenke i resultat.json, og oversikt.csv
// skrives med writeTextFile etter kjøringen. En avbrutt liste kan fortsettes.

(function () {
  const $ = id => document.getElementById(id);
  const api = window.faktisk;
  if (typeof api.bevisProfileSave !== 'function' || !$('lBlock')) return;

  const el = {
    text: $('lText'), drop: $('lDrop'), pick: $('lPickBtn'), file: $('lFile'), comments: $('lComments'),
    check: $('lCheckBtn'), lists: $('lListSelect'), box: $('lResBox'), meta: $('lMeta'), list: $('lList'),
    run: $('lRunBtn'), stop: $('lStopBtn'), reveal: $('lRevealBtn'), fileInfo: $('lFileInfo'),
  };
  const L = { draft: null, current: null, lists: [], running: false, stop: false };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BOM = String.fromCharCode(0xFEFF);
  const MODE_LABEL = { video: 'Bare video', grundig: 'Grundig' };

  function mode() { const r = document.querySelector('input[name="lMode"]:checked'); return r ? r.value : 'video'; }
  function caseOk() {
    const c = els.caseInput.value.trim();
    if (!c) { setStatus('Skriv inn en sak først', 'err'); els.caseInput.focus(); return ''; }
    return c;
  }
  const defMode = c => (c && c.list.scan.defaultMode) || mode();

  // ------------------------------------------------------------
  //  Lenker: finne, rense, slå sammen
  // ------------------------------------------------------------
  const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
  const BARE_RE = /(?:^|[\s;,|])((?:www\.|m\.|vm\.)?(?:youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|threads\.net|threads\.com|vimeo\.com|t\.me|reddit\.com|linkedin\.com|bsky\.app|snapchat\.com|rumble\.com|dailymotion\.com|vk\.com|ok\.ru|bilibili\.com)\/[^\s"'<>;,|]*)/gi;
  const MODE_WORDS = { video: 'video', 'bare video': 'video', grundig: 'grundig', full: 'grundig', side: 'grundig', 'side og kommentarer': 'grundig', kommentarer: 'grundig' };
  const DROP_ALL = /^(utm_\w+|fbclid|gclid|dclid|msclkid|igsh|igshid|mibextid|__cft__.*|__tn__|ref_src|ref_url|rdid|share_url|_nc_\w+|xmt|slof|from_wa|wtsid|cmpid)$/i;

  function trimUrl(u) { return u.replace(/[)\].,;:!?'"»”]+$/, ''); }

  function cleanUrl(raw) {
    let u;
    try { u = new URL(raw); } catch (e) { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hash = '';
    const host = u.hostname.replace(/^(www|m|mobile|web)\./, '').toLowerCase();
    const keepOnly = keys => { for (const k of Array.from(u.searchParams.keys())) if (!keys.includes(k)) u.searchParams.delete(k); };
    if (/(^|\.)youtube\.com$/.test(host)) { u.hostname = 'www.youtube.com'; keepOnly(['v', 't', 'list', 'index']); }
    else if (host === 'youtu.be') keepOnly(['t']);
    else if (/(^|\.)tiktok\.com$/.test(host)) u.search = '';
    else if (/(^|\.)instagram\.com$/.test(host)) { u.hostname = 'www.instagram.com'; keepOnly(['img_index']); }
    else if (/(^|\.)(x|twitter)\.com$/.test(host)) { u.hostname = 'x.com'; u.search = ''; }
    else if (/(^|\.)facebook\.com$/.test(host)) { u.hostname = 'www.facebook.com'; keepOnly(['v', 'story_fbid', 'id', 'fbid', 'set']); }
    else if (/(^|\.)(threads\.net|threads\.com)$/.test(host)) u.search = '';
    else for (const k of Array.from(u.searchParams.keys())) if (DROP_ALL.test(k)) u.searchParams.delete(k);
    return u.href.replace(/\?$/, '');
  }

  // Én rad = én lenke. Flere lenker på samme linje deler notat og modus.
  function parseText(text) {
    const rows = [], seen = new Map();
    let noUrl = 0, dup = 0, cleaned = 0, bad = 0;
    String(text || '').split(/\r?\n/).forEach((line, li) => {
      if (!line.trim()) return;
      const urls = [];
      let m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(line))) urls.push(trimUrl(m[0]));
      let rest = line.replace(URL_RE, ' ');
      BARE_RE.lastIndex = 0;
      while ((m = BARE_RE.exec(rest))) urls.push('https://' + trimUrl(m[1]));
      rest = rest.replace(BARE_RE, ' ');
      if (!urls.length) { noUrl++; return; }
      let rowMode = '';
      const notes = [];
      rest.split(/[\t;,|]/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(cell => {
        const w = MODE_WORDS[cell.toLowerCase()];
        if (w && !rowMode) rowMode = w; else notes.push(cell);
      });
      for (const orig of urls) {
        const url = cleanUrl(orig);
        if (!url) { bad++; continue; }
        if (url !== orig) cleaned++;
        if (seen.has(url)) { dup++; const r = seen.get(url); if (!r.mode && rowMode) r.mode = rowMode; continue; }
        const r = { url, original: orig, mode: rowMode, note: notes.join(' · '), line: li + 1 };
        seen.set(url, r); rows.push(r);
      }
    });
    return { rows, noUrl, dup, cleaned, bad };
  }

  const LOGIN_HOSTS = [[/instagram\.com$/, 'Instagram'], [/(facebook\.com|fb\.watch)$/, 'Facebook'], [/threads\.(net|com)$/, 'Threads'], [/linkedin\.com$/, 'LinkedIn'], [/(x|twitter)\.com$/, 'X']];
  function hostOf(u) { try { return new URL(u).hostname.replace(/^(www|m|mobile|web)\./, ''); } catch (e) { return ''; } }
  function loginSites(rows) {
    const s = new Set();
    rows.forEach(r => { const h = hostOf(r.url); const f = LOGIN_HOSTS.find(([re]) => re.test(h)); if (f) s.add(f[1]); });
    return Array.from(s);
  }

  // ------------------------------------------------------------
  //  Filer: .txt, .csv/.tsv og Excel (.xlsx)
  // ------------------------------------------------------------
  function parseCsv(text) {
    const first = (text.split(/\r?\n/).find(l => l.trim()) || '');
    const count = ch => first.split(ch).length - 1;
    const delim = count('\t') && count('\t') >= Math.max(count(';'), count(',')) ? '\t' : count(';') >= count(',') ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && !cell) q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function inflate(data) {
    const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ikke en gyldig Excel-fil');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder();
    const files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (!/\.(xml|rels)$/.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + csize);
      files[name] = () => (method === 8 ? inflate(raw) : Promise.resolve(raw)).then(b => td.decode(b));
    }
    return files;
  }
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (node, tag) => Array.from(node.getElementsByTagName('*')).filter(e => e.localName === tag);
  const relId = node => { const a = Array.from(node.attributes).find(x => x.localName === 'id' && x.prefix); return a ? a.value : ''; };
  function colIndex(ref) { const m = String(ref || '').match(/^([A-Z]+)/); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

  async function readXlsx(buf) {
    const z = await unzip(buf);
    const shared = z['xl/sharedStrings.xml'] ? byTag(xml(await z['xl/sharedStrings.xml']()), 'si').map(si => byTag(si, 't').map(t => t.textContent).join('')) : [];
    // Første ark i arbeidsboka
    let sheet = '';
    try {
      const first = byTag(xml(await z['xl/workbook.xml']()), 'sheet')[0];
      const rid = first && relId(first);
      const rel = byTag(xml(await z['xl/_rels/workbook.xml.rels']()), 'Relationship').find(r => r.getAttribute('Id') === rid);
      if (rel) sheet = 'xl/' + rel.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
    } catch (e) {}
    if (!z[sheet]) sheet = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
    if (!z[sheet]) throw new Error('fant ingen ark i fila');
    const doc = xml(await z[sheet]());
    // Lenker lagt inn som hyperkobling (synlig tekst ≠ adresse)
    const links = {};
    const relName = sheet.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels');
    if (z[relName]) {
      const rels = byTag(xml(await z[relName]()), 'Relationship');
      byTag(doc, 'hyperlink').forEach(h => {
        const rel = rels.find(r => r.getAttribute('Id') === relId(h));
        if (rel && /^https?:/i.test(rel.getAttribute('Target') || '')) links[h.getAttribute('ref')] = rel.getAttribute('Target');
      });
    }
    return byTag(doc, 'row').map(r => {
      const out = [];
      byTag(r, 'c').forEach(c => {
        const ref = c.getAttribute('r'), t = c.getAttribute('t');
        const v = byTag(c, 'v')[0];
        let val = t === 's' ? (shared[+(v && v.textContent)] || '') : t === 'inlineStr' ? byTag(c, 't').map(x => x.textContent).join('') : (v ? v.textContent : '');
        if (links[ref] && !/https?:\/\//i.test(val)) val = (val ? val + ' ' : '') + links[ref];
        const i = colIndex(ref);
        out[i >= 0 ? i : out.length] = val;
      });
      return Array.from(out, x => x || '');
    });
  }

  async function loadFile(f) {
    if (!f || L.running) return;
    const name = f.name || 'fil';
    try {
      let rows;
      if (/\.xlsx$/i.test(name)) rows = await readXlsx(await f.arrayBuffer());
      else if (/\.(xls|numbers)$/i.test(name)) { setStatus('Den filtypen kan ikke leses. Lagre som .xlsx eller .csv først.', 'err'); return; }
      else if (/\.(csv|tsv)$/i.test(name)) rows = parseCsv(await f.text());
      else rows = (await f.text()).split(/\r?\n/).map(l => [l]);
      const text = rows.map(r => r.map(c => String(c).replace(/[\t\r\n]+/g, ' ').trim()).filter(Boolean).join('\t')).filter(Boolean).join('\n');
      el.text.value = (el.text.value.trim() ? el.text.value.replace(/\s+$/, '') + '\n' : '') + text;
      el.fileInfo.textContent = 'Lagt til fra ' + name + ' (' + rows.length + ' rader) — sjekk innholdet i feltet.';
      scheduleSaveState();
      checkList();
    } catch (e) { setStatus('Kunne ikke lese ' + name + ': ' + e.message, 'err'); }
  }
  el.pick.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => { loadFile(el.file.files[0]); el.file.value = ''; });
  el.drop.addEventListener('dragover', e => { e.preventDefault(); el.drop.classList.add('is-over'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('is-over'));
  el.drop.addEventListener('drop', e => { e.preventDefault(); el.drop.classList.remove('is-over'); loadFile(e.dataTransfer.files[0]); });

  // ------------------------------------------------------------
  //  Sjekk lista (ingenting lagres ennå)
  // ------------------------------------------------------------
  function checkList() {
    if (L.running) return;
    const p = parseText(el.text.value);
    L.current = null; el.lists.value = '';
    if (!p.rows.length) {
      L.draft = null; render();
      setStatus(el.text.value.trim() ? 'Fant ingen lenker i teksten' : 'Lim inn lenker først', 'err');
      return;
    }
    L.draft = p; render();
    setStatus('');
  }
  el.check.addEventListener('click', checkList);
  el.text.addEventListener('input', () => { scheduleSaveState(); if (L.draft) { L.draft = null; render(); } });

  // ------------------------------------------------------------
  //  Status per lenke og visning
  // ------------------------------------------------------------
  function lastResult(i) {
    const rs = (L.current && L.current.results || []).filter(r => r.index === i);
    if (!rs.length) return null;
    return rs.find(r => r.status === 'ok') || rs[rs.length - 1];
  }
  function rowStatus(i) { const r = lastResult(i); return !r ? '' : r.status === 'ok' ? 'ok' : r.login ? 'login' : 'err'; }

  function estimate(v, g) {
    const min = Math.max(1, Math.round((v * 25 + g * 120 + (v + g) * 8) / 60));
    return min < 60 ? min + ' min' : (min / 60).toFixed(1).replace('.', ',') + ' t';
  }

  function render() {
    const c = L.current, d = L.draft;
    el.box.hidden = !c && !d;
    if (!c && !d) return renderRun();
    const rows = c ? c.list.scan.posts : d.rows.map((r, i) => Object.assign({ index: i }, r));
    const def = defMode(c);
    if (c) {
      const okN = rows.filter(r => rowStatus(r.index) === 'ok').length;
      const errN = rows.filter(r => /err|login/.test(rowStatus(r.index))).length;
      el.meta.innerHTML = '<b>' + rows.length + ' lenker</b> · lagret ' + esc(c.list.createdAtLocal) + '<br><span class="bv-muted">' +
        esc(okN + ' sikret' + (errN ? ' · ' + errN + ' feilet' : '') + ' · standard: ' + MODE_LABEL[def].toLowerCase()) + '</span>';
    } else {
      const sites = loginSites(d.rows);
      const bits = [];
      if (d.dup) bits.push(d.dup + ' duplikat' + (d.dup > 1 ? 'er' : '') + ' slått sammen');
      if (d.cleaned) bits.push(d.cleaned + ' renset for sporingsparametre');
      if (d.noUrl) bits.push(d.noUrl + ' linje' + (d.noUrl > 1 ? 'r' : '') + ' uten lenke hoppet over');
      if (d.bad) bits.push(d.bad + ' ugyldig' + (d.bad > 1 ? 'e' : '') + ' adresse' + (d.bad > 1 ? 'r' : ''));
      const vN = d.rows.filter(r => (r.mode || def) === 'video').length, gN = d.rows.length - vN;
      el.meta.innerHTML = '<b>' + d.rows.length + ' lenker</b> klare — ikke lagret ennå' +
        (bits.length ? '<br><span class="bv-muted">' + esc(bits.join(' · ')) + '</span>' : '') +
        '<br><span class="bv-muted">' + esc([vN ? vN + ' bare video' : '', gN ? gN + ' grundig' : ''].filter(Boolean).join(' · ') + ' · ca. ' + estimate(vN, gN) + ' pluss pauser') + '</span>' +
        (sites.length ? '<br><span class="bv-warnline">' + esc(sites.join(', ')) + ' krever ofte innlogging: logg inn i sikringsvinduet først (fanen Én side → Åpne).</span>' : '');
    }
    el.list.innerHTML = rows.map(r => {
      const st = c ? rowStatus(r.index) : '';
      const res = c ? lastResult(r.index) : null;
      const m = r.mode || def;
      const tip = r.url + (r.original && r.original !== r.url ? '\nOpprinnelig: ' + r.original : '') + (r.note ? '\nNotat: ' + r.note : '') +
        (res && res.title ? '\n' + res.title : '') + (res && res.status !== 'ok' && res.error ? '\nFeil: ' + res.error : '');
      return '<li class="bv-plan__row bv-post' + (st ? ' is-' + (st === 'login' ? 'err' : st) : '') + '" data-i="' + r.index + '">' +
        '<span class="bv-plan__n">' + (r.index + 1) + '</span>' +
        '<span class="bv-lmode bv-lmode--' + m + '" title="' + esc(MODE_LABEL[m] + (r.mode ? ' (valgt på linja)' : '')) + '">' + (m === 'video' ? 'V' : 'G') + '</span>' +
        '<span class="bv-plan__d" title="' + esc(tip) + '">' + esc((res && res.title) || r.url.replace(/^https?:\/\/(www\.)?/, '')) + (r.note ? ' <span class="bv-muted">· ' + esc(r.note) + '</span>' : '') + '</span>' +
        '<span class="bv-plan__s" title="' + esc(st === 'login' ? 'Krever innlogging' : st === 'err' ? (res && res.error) || 'Feilet' : '') + '">' + (st === 'ok' ? '✓' : st === 'login' ? '🔒' : st === 'err' ? '✗' : '') + '</span></li>';
    }).join('');
    renderRun();
  }
  function remaining() { return L.current ? L.current.list.scan.posts.filter(r => rowStatus(r.index) !== 'ok') : []; }
  function renderRun() {
    const c = L.current;
    const n = c ? remaining().length : L.draft ? L.draft.rows.length : 0;
    const started = c && (c.results || []).length;
    el.run.hidden = !(c || L.draft);
    el.run.disabled = L.running || !n || state.busy;
    el.run.textContent = L.running ? 'Sikrer …' : !c ? 'Lagre lista og start (' + n + ')' : !n ? 'Alle er sikret' : started ? 'Fortsett (' + n + ' igjen)' : 'Start (' + n + ')';
    el.stop.hidden = !L.running;
    el.reveal.hidden = !c;
    el.check.disabled = L.running;
  }

  // ------------------------------------------------------------
  //  Tidligere lister (lagres sammen med profil-listene)
  // ------------------------------------------------------------
  async function loadLists(selectDir) {
    if (!state.root || !api.bevisProfileLists) return;
    const r = await api.bevisProfileLists({ root: state.root });
    L.lists = (r.lists || []).filter(l => l.list && l.list.scan && l.list.scan.kind === 'lenkeliste');
    const cur = selectDir || (L.current && L.current.dir) || '';
    el.lists.innerHTML = '<option value="">' + (L.lists.length ? 'Tidligere lister …' : 'Ingen lister ennå') + '</option>' + L.lists.map(l => {
      const okN = l.list.scan.posts.filter(p => (l.results || []).some(x => x.index === p.index && x.status === 'ok')).length;
      return '<option value="' + esc(l.dir) + '"' + (l.dir === cur ? ' selected' : '') + '>' +
        esc(l.case + ' · ' + l.list.scan.posts.length + ' lenker · ' + okN + ' sikret · ' + String(l.list.createdAtLocal || '').split(',')[0]) + '</option>';
    }).join('');
    const l = L.lists.find(x => x.dir === cur);
    if (l && !L.running) { L.current = { dir: l.dir, list: l.list, results: l.results || [] }; L.draft = null; }
    render();
  }
  el.lists.addEventListener('change', () => {
    if (L.running) return;
    const l = L.lists.find(x => x.dir === el.lists.value);
    if (l) { L.current = { dir: l.dir, list: l.list, results: l.results || [] }; L.draft = null; if (l.case && !els.caseInput.value.trim()) els.caseInput.value = l.case; }
    else L.current = null;
    render();
  });

  // ------------------------------------------------------------
  //  Kjøring
  // ------------------------------------------------------------
  const LOGIN_ERR = /log ?in|sign ?in|logg inn|login required|requires? (authentication|login)|use --cookies|private|registered users|age-restricted|checkpoint/i;

  async function runVideo(r, note, caseName) {
    const res = await api.bevisDownload({ root: state.root, caseName, note, url: r.url, comments: el.comments.checked, pluginVersion: state.pluginVersion });
    if (res.cancelled) return { status: 'feil', error: 'avbrutt' };
    if (!res.ok) return { status: 'feil', error: res.error || 'ukjent feil', login: LOGIN_ERR.test(res.error || '') };
    return { status: 'ok', dir: res.dir, fingerprint: res.fingerprint, title: res.title || '', warnings: res.warnings || [] };
  }
  async function runFull(r, note, caseName, c, total) {
    const open = await api.bevisOpen({ url: r.url, wait: true, settleMs: 3000 });
    if (open.cancelled) return { status: 'feil', error: 'avbrutt' };
    if (!open.ok) return { status: 'feil', error: 'kunne ikke åpne siden' };
    if (/\/(login|checkpoint|i\/flow\/login|accounts\/login|authwall)/.test(open.finalUrl || '')) return { status: 'feil', error: 'krever innlogging', login: true, finalUrl: open.finalUrl };
    try { await api.bevisExpand({ rounds: 6, comments: true }); } catch (e) {}
    const opts = Object.assign(options(), { media: true, comments: el.comments.checked || !!options().comments });
    const tag = { kind: 'lenke', listId: c.list.id, index: r.index, total, suffix: 'l' + String(r.index + 1).padStart(3, '0') };
    const res = await api.bevisCapture({ root: state.root, caseName, note, url: r.url, pluginVersion: state.pluginVersion, options: opts, tag, maxScroll: 15 });
    if (!res.ok) return { status: 'feil', error: res.error || 'ukjent feil' };
    return { status: 'ok', dir: res.dir, fingerprint: res.fingerprint, title: open.title || '', finalUrl: open.finalUrl, warnings: res.warnings || [] };
  }

  async function saveDraft(caseName) {
    const d = L.draft, def = mode();
    const posts = d.rows.map((r, i) => ({
      index: i, url: r.url, original: r.original, mode: r.mode || '', note: r.note, line: r.line,
      date: '', dateText: '', snippet: [MODE_LABEL[r.mode || def], r.note].filter(Boolean).join(' · '),
    }));
    // bevisProfileSave tar bare med pluginVersion som ekstra felt, så det som
    // gjelder lenkelista ligger i scan (lagres i liste.json og hashes).
    const scan = {
      kind: 'lenkeliste', defaultMode: def, comments: el.comments.checked, host: 'lenkeliste', pageUrl: '',
      pageTitle: 'Liste med ' + posts.length + ' lenker', screens: 0, posts,
      input: { duplicatesMerged: d.dup, cleanedUrls: d.cleaned, linesWithoutLink: d.noUrl, invalid: d.bad, rawText: el.text.value.slice(0, 200000) },
      about: 'Lenkeliste fra Bevissikring. Lista er lagret og hashet før noe ble hentet. «video» = bare videoen med referanser (yt-dlp), «grundig» = siden, kommentarene og videoen. Se resultat.json og oversikt.csv for hva som ble sikret.',
    };
    const r = await api.bevisProfileSave({ root: state.root, caseName, scan, pluginVersion: state.pluginVersion });
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  el.run.addEventListener('click', async () => {
    if (L.running || state.busy) return;
    if (window.bvRootReady && !window.bvRootReady()) return;
    const caseName = caseOk(); if (!caseName) return;
    try {
      if (!L.current) {
        if (!L.draft) checkList();
        if (!L.draft) return;
        const saved = await saveDraft(caseName);
        await loadLists(saved.dir);
        if (!L.current) { setStatus('Lista ble lagret, men kunne ikke leses igjen', 'err'); return; }
      }
    } catch (e) { setStatus('Kunne ikke lagre lista: ' + e.message, 'err'); return; }

    const c = L.current;
    const def = defMode(c);
    const todo = remaining();
    const total = c.list.scan.posts.length;
    const blocked = new Set();   // nettsteder som krevde innlogging i denne kjøringen
    L.running = true; L.stop = false;
    setBusy(true); render();
    let ok = 0, fail = 0, login = 0, done = 0, prevHost = '';
    try {
      for (let k = 0; k < todo.length; k++) {
        if (L.stop) break;
        const r = todo[k], host = hostOf(r.url), m = r.mode || def;
        const row = el.list.querySelector('.bv-post[data-i="' + r.index + '"]');
        if (row) { row.classList.add('is-running'); row.scrollIntoView({ block: 'nearest' }); }
        let res;
        if (blocked.has(host)) res = { status: 'feil', error: 'hoppet over: ' + host + ' krevde innlogging', login: true, skipped: true };
        else {
          // Pause bare når samme nettsted kommer igjen — andre nettsteder ser ikke tempoet
          if (done > 0 && host === prevHost && window.bvPace) { await window.bvPace(() => L.stop); if (L.stop) break; }
          setStatus('Lenke ' + (k + 1) + ' av ' + todo.length + ' (' + MODE_LABEL[m].toLowerCase() + ') — ' + host + ' …');
          const note = [els.noteInput.value.trim(), r.note].filter(Boolean).join(' — ');
          try { res = m === 'grundig' ? await runFull(r, note, caseName, c, total) : await runVideo(r, note, caseName); }
          catch (e) { res = { status: 'feil', error: e.message }; }
          prevHost = host; done++;
          if (res.login) blocked.add(host);
        }
        const entry = Object.assign({ index: r.index, url: r.url, mode: m }, res);
        await api.bevisProfileResult({ dir: c.dir, result: entry });
        c.results.push(Object.assign({ at: new Date().toISOString() }, entry));
        if (res.status === 'ok') ok++; else if (res.login) login++; else fail++;
        render();
        if (k % 5 === 4) await refresh();
      }
    } finally {
      const stopped = L.stop;
      L.running = false; L.stop = false;
      setBusy(false);
      await writeOverview(c);
      render();
      await refresh();
      await loadLists(c.dir);
      const parts = ['Sikret ' + ok + ' av ' + todo.length];
      if (login) parts.push(login + ' krever innlogging (' + Array.from(blocked).join(', ') + ') — logg inn i sikringsvinduet og trykk «Fortsett»');
      if (fail) parts.push(fail + ' feilet (hold musa over ✗ for årsak)');
      if (stopped) parts.push('stoppet');
      setStatus(parts.join(' · ') + '. Oversikten (oversikt.csv) ligger ved lista.', fail || login ? 'warn' : 'ok');
    }
  });
  el.stop.addEventListener('click', () => { L.stop = true; setStatus('Stopper etter denne lenken …'); });
  el.reveal.addEventListener('click', () => { if (L.current) api.revealInFinder(L.current.dir + '/liste.csv'); });

  // oversikt.csv: én rad per lenke med siste status. Utledet fra resultat.json
  // og ligger utenfor SHA256SUMS (som bare dekker selve lista).
  function csvCell(s) { s = String(s == null ? '' : s); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  async function writeOverview(c) {
    if (!c || !api.writeTextFile) return;
    const def = defMode(c);
    const lines = [['nr', 'lenke', 'modus', 'status', 'tittel', 'tidspunkt', 'mappe', 'fingeravtrykk', 'feil', 'notat', 'opprinnelig lenke'].join(';')];
    for (const r of c.list.scan.posts) {
      const res = lastResult(r.index);
      const st = !res ? 'ikke kjørt' : res.status === 'ok' ? 'sikret' : res.login ? 'krever innlogging' : 'feilet';
      lines.push([r.index + 1, r.url, MODE_LABEL[r.mode || def], st, res && res.title, res && res.at, res && res.dir, res && res.fingerprint,
        res && res.status !== 'ok' ? res.error : '', r.note, r.original !== r.url ? r.original : ''].map(csvCell).join(';'));
    }
    try { await api.writeTextFile({ savePath: c.dir + '/oversikt.csv', content: BOM + lines.join('\n') + '\n' }); } catch (e) {}
  }

  // ------------------------------------------------------------
  //  Lagring og visning (kalles fra main.js / stikkprove.js)
  // ------------------------------------------------------------
  document.querySelectorAll('input[name="lMode"]').forEach(x => x.addEventListener('change', () => { scheduleSaveState(); if (L.draft) render(); }));
  el.comments.addEventListener('change', scheduleSaveState);
  window.bvListState = () => ({ text: el.text.value.slice(0, 200000), mode: mode(), comments: el.comments.checked });
  window.bvListApply = s => {
    if (!s) return;
    el.text.value = s.text || '';
    const r = document.querySelector('input[name="lMode"][value="' + (s.mode === 'grundig' ? 'grundig' : 'video') + '"]');
    if (r) r.checked = true;
    if (typeof s.comments === 'boolean') el.comments.checked = s.comments;
  };
  window.bvListShown = () => loadLists();
  window.bvListRunning = () => L.running;
  window._bvListTest = { parseText, cleanUrl, parseCsv, readXlsx };
})();
