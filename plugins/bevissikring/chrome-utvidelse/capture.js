// «Sikre alt jeg ser» — kjøres i bakgrunnen (service worker).
//
// 1. Åpner flere kommentarer/svar (valgfritt, maks noen runder)
// 2. Ruller gjennom siden fra toppen og tar et skjermbilde per skjermhøyde
//    (finner selv boksen som ruller — Facebook og X ruller ofte en indre boks)
// 3. Samler teksten fra hvert steg (feeds fjerner innlegg øverst underveis)
// 4. Nettarkiv (MHTML), HTML, metadata, bilder på siden, video
// 5. Leverer til Studio (eller en annen lokal motor) — eller, uten Studio,
//    lagrer i Nedlastinger/Bevissikring med manifest, sjekksummer og tidsstempel.

const FS_MAX_SHOTS = 40;
const FS_SHOT_GAP_MS = 650;     // Chrome tillater maks 2 skjermbilder i sekundet
const FS_MAX_IMAGES = 60;
const FS_MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// ------------------------------------------------------------
//  Funksjoner som kjøres i siden (må være selvstendige)
// ------------------------------------------------------------
function fsPageScroller(cmd, arg) {
  if (!window.__fsScroller) {
    const pick = () => {
      const se = document.scrollingElement || document.documentElement;
      if (se.scrollHeight > se.clientHeight + 40) return se;
      let best = null, bestArea = 0;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowY)) continue;
        if (el.scrollHeight <= el.clientHeight + 40) continue;
        const r = el.getBoundingClientRect();
        const area = Math.max(0, Math.min(r.width, innerWidth)) * Math.max(0, Math.min(r.height, innerHeight));
        if (area > bestArea) { best = el; bestArea = area; }
      }
      return best || se;
    };
    window.__fsScroller = {
      el: null, origin: 0,
      start() { this.el = pick(); this.origin = this.el.scrollTop; return this.info(); },
      info() { const e = this.el; return { top: e.scrollTop, height: e.scrollHeight, view: e.clientHeight, inner: e !== (document.scrollingElement || document.documentElement) }; },
      to(y) { this.el.scrollTop = y; return this.info(); },
      step() { const e = this.el; const b = e.scrollTop; e.scrollTop = b + Math.round(e.clientHeight * 0.85); const i = this.info(); i.moved = e.scrollTop !== b; return i; },
      back() { this.el.scrollTop = this.origin || 0; return this.info(); },
    };
  }
  const s = window.__fsScroller;
  if (cmd === 'start') return s.start();
  if (cmd === 'to') return s.to(arg || 0);
  if (cmd === 'step') return s.step();
  if (cmd === 'back') { const r = s.back(); delete window.__fsScroller; return r; }
  if (cmd === 'text') return document.body ? document.body.innerText : '';
  return null;
}

function fsPageExpand(rounds) {
  const re = /^(se flere kommentarer|vis flere kommentarer|se tidligere kommentarer|vis tidligere kommentarer|view more comments|view previous comments|see more comments|more comments|se alle \d+ svar|vis alle \d+ svar|se \d+ svar|vis \d+ svar|view all \d+ repl(y|ies)|view \d+ repl(y|ies)|\d+ (svar|replies)|see more|se mer|vis mer|show more|more replies|flere svar|load more comments)$/i;
  return (async () => {
    let clicked = 0;
    for (let r = 0; r < rounds; r++) {
      const btns = Array.from(document.querySelectorAll('[role="button"], button, span[dir="auto"]')).filter(b => {
        const t = (b.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 40 || !re.test(t)) return false;
        const a = b.closest('a[href]');
        if (a && !/^javascript:|#$/.test(a.getAttribute('href') || '')) return false;   // aldri lenker til andre sider
        const rc = b.getBoundingClientRect();
        return rc.width > 0 && rc.height > 0;
      });
      if (!btns.length) break;
      for (const b of btns.slice(0, 40)) { try { b.click(); clicked++; } catch (e) {} }
      await new Promise(res => setTimeout(res, 1300));
    }
    return clicked;
  })();
}

function fsPageCollect() {
  const meta = {};
  for (const m of Array.from(document.querySelectorAll('meta[property], meta[name], meta[itemprop]')).slice(0, 300)) {
    const k = m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop');
    const v = m.getAttribute('content');
    if (k && v && v.length < 2000 && !(k in meta)) meta[k] = v;
  }
  const seen = new Set(), images = [];
  const add = (u, w, h, kind) => {
    if (!u || seen.has(u) || !/^(https?:|data:image\/)/.test(u)) return;
    seen.add(u); images.push({ url: u, w: w || 0, h: h || 0, kind });
  };
  for (const img of document.images) {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w >= 200 && h >= 200) add(img.currentSrc || img.src, w, h, 'img');
  }
  const videos = [];
  for (const v of document.querySelectorAll('video')) {
    if (v.poster) add(v.poster, 0, 0, 'poster');
    const src = v.currentSrc || v.src || (v.querySelector('source') || {}).src || '';
    videos.push({ src, blob: /^blob:/.test(src), direct: /^https?:/.test(src), w: v.videoWidth, h: v.videoHeight, duration: isFinite(v.duration) ? v.duration : null });
  }
  if (meta['og:image']) add(meta['og:image'], 0, 0, 'og:image');
  const html = '<!doctype html>\n' + document.documentElement.outerHTML;
  return {
    url: location.href, title: document.title, meta, images: images.slice(0, 120), videos,
    html: html.length > 8000000 ? html.slice(0, 8000000) : html,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, userAgent: navigator.userAgent,
  };
}

// ------------------------------------------------------------
//  Hjelpere
// ------------------------------------------------------------
const fsSleep = ms => new Promise(r => setTimeout(r, ms));
async function fsExec(tabId, func, args) {
  const r = await chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
  return r && r[0] ? r[0].result : null;
}
function fsMergeLines(acc, text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  if (!acc.length) { acc.push(...lines); return; }
  for (let k = Math.min(8, acc.length); k >= 2; k--) {
    const tail = acc.slice(-k);
    for (let j = lines.length - k; j >= 0; j--) {
      let ok = true;
      for (let t = 0; t < k; t++) if (lines[j + t] !== tail[t]) { ok = false; break; }
      if (ok) { acc.push(...lines.slice(j + k)); return; }
    }
  }
  const recent = new Set(acc.slice(-3000));
  for (const l of lines) if (!recent.has(l)) acc.push(l);
}
function fsB64FromDataUrl(u) { return String(u).slice(String(u).indexOf(',') + 1); }
function fsBytesFromB64(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
async function fsSha256Hex(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join(''); }
const fsUtf8 = s => new TextEncoder().encode(s);
const fsPad = n => String(n).padStart(2, '0');
const FS_COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
function fsSlug(s, max) { return String(s || '').normalize('NFKD').replace(FS_COMBINING, '').replace(/[^A-Za-z0-9@._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 40).toLowerCase(); }
function fsSafeName(s) { return String(s || '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
const FS_EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };


async function fsFetchBytes(url) {
  if (/^data:/.test(url)) {
    const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!m) return null;
    return { bytes: m[2] ? fsBytesFromB64(m[3]) : fsUtf8(decodeURIComponent(m[3])), type: m[1] };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctl.signal });
    if (!res.ok) return null;
    const len = +res.headers.get('content-length') || 0;
    if (len > FS_MAX_IMAGE_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > FS_MAX_IMAGE_BYTES) return null;
    return { bytes: buf, type: (res.headers.get('content-type') || '').split(';')[0].trim() };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// ------------------------------------------------------------
//  Selve sikringen
// ------------------------------------------------------------
// opts: { scroll, expand, images, video, caseName, note }
// report(msg, pct) viser fremdrift i popupen
async function fsCaptureAll(tab, opts, report) {
  const tabId = tab.id, windowId = tab.windowId;
  const warnings = [];
  const files = [];          // { path, bytes, type }
  const capturedAt = new Date().toISOString();
  const ensureActive = async () => {
    const t = await chrome.tabs.get(tabId);
    if (!t.active) throw new Error('Ikke bytt fane mens siden sikres — prøv igjen.');
  };
  const shot = async () => {
    await ensureActive();
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return fsBytesFromB64(fsB64FromDataUrl(url));
  };

  // 1) Kommentarer
  let expanded = 0;
  if (opts.expand) {
    report('Åpner kommentarer og svar …');
    try { expanded = await fsExec(tabId, fsPageExpand, [4]) || 0; } catch (e) { warnings.push('Kunne ikke åpne kommentarer: ' + e.message); }
  }

  // 2) Rulling og skjermbilder
  const textLines = [];
  let scrollInfo = { shots: 0, inner: false, reachedEnd: false };
  if (opts.scroll) {
    let info = await fsExec(tabId, fsPageScroller, ['start']);
    scrollInfo.inner = !!(info && info.inner);
    await fsExec(tabId, fsPageScroller, ['to', 0]);
    await fsSleep(600);
    let still = 0;
    for (let i = 0; i < FS_MAX_SHOTS; i++) {
      report('Ruller og tar skjermbilder … ' + (i + 1), Math.min(80, 5 + i * 2));
      const bytes = await shot();
      files.push({ path: 'skjermbilder/rulling-' + fsPad(i + 1) + '.png', bytes, type: 'image/png' });
      scrollInfo.shots = i + 1;
      try { fsMergeLines(textLines, await fsExec(tabId, fsPageScroller, ['text'])); } catch (e) {}
      info = await fsExec(tabId, fsPageScroller, ['step']);
      await fsSleep(FS_SHOT_GAP_MS);
      if (!info || !info.moved) {
        // Uendelig rulling: vent litt på mer innhold
        await fsSleep(1200);
        info = await fsExec(tabId, fsPageScroller, ['step']);
        if (!info || !info.moved) { if (++still >= 1) { scrollInfo.reachedEnd = true; break; } } else still = 0;
        await fsSleep(FS_SHOT_GAP_MS);
      }
    }
    if (!scrollInfo.reachedEnd) warnings.push('Siden var lengre enn ' + FS_MAX_SHOTS + ' skjermhøyder — skjermbildene dekker bare starten.');
    if (scrollInfo.inner) warnings.push('Siden ruller inne i en egen boks; skjermbildene viser det som var synlig under rullingen.');
  } else {
    report('Tar skjermbilde …', 20);
    files.push({ path: 'skjermbilde-chrome.png', bytes: await shot(), type: 'image/png' });
  }

  // 3) Tekst, HTML, metadata
  report('Henter tekst og nettarkiv …', 82);
  const page = await fsExec(tabId, fsPageCollect, []) || {};
  if (opts.scroll) { try { await fsExec(tabId, fsPageScroller, ['back']); } catch (e) {} }
  const finalText = await fsExec(tabId, fsPageScroller, ['text']).catch(() => '');
  if (textLines.length) fsMergeLines(textLines, finalText); else textLines.push(...String(finalText || '').split('\n'));
  files.push({ path: 'tekst.txt', bytes: fsUtf8(textLines.join('\n')), type: 'text/plain' });
  if (page.html) files.push({ path: 'side.html', bytes: fsUtf8(page.html), type: 'text/html' });
  const mhtml = () => new Promise((resolve, reject) => chrome.pageCapture.saveAsMHTML({ tabId }, b => {
    if (b) resolve(b); else reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'MHTML feilet'));
  }));
  let mErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {   // feiler av og til rett etter rulling — prøv igjen
    try { const blob = await mhtml(); files.push({ path: 'side.mhtml', bytes: new Uint8Array(await blob.arrayBuffer()), type: 'multipart/related' }); mErr = null; break; }
    catch (e) { mErr = e; await fsSleep(1000); }
  }
  if (mErr) warnings.push('Nettarkiv (MHTML) feilet: ' + mErr.message);

  // 4) Bilder
  const imgInfo = { found: (page.images || []).length, saved: 0 };
  if (opts.images && imgInfo.found) {
    if (!(await fsHasAllHosts())) warnings.push('Bilder: utvidelsen har ikke fått tilgang til å hente bilder fra nettsteder (trykk «Gi tilgang» i utvidelsen).');
    else {
      let n = 0;
      for (const it of page.images.slice(0, FS_MAX_IMAGES)) {
        n++; report('Henter bilder … ' + n + '/' + Math.min(page.images.length, FS_MAX_IMAGES), 85);
        const r = await fsFetchBytes(it.url);
        if (!r || !r.bytes.length) continue;
        const ext = FS_EXT_BY_TYPE[r.type] || (it.url.match(/\.(jpe?g|png|webp|gif|avif)(\?|$)/i) || [, 'bin'])[1].toLowerCase().replace('jpeg', 'jpg');
        imgInfo.saved++;
        files.push({ path: 'bilder/bilde-' + fsPad(imgInfo.saved) + '.' + ext, bytes: r.bytes, type: r.type || 'application/octet-stream', source: it.url });
      }
      if (page.images.length > FS_MAX_IMAGES) warnings.push('Bare de første ' + FS_MAX_IMAGES + ' bildene ble hentet.');
    }
  }

  return { page, files, warnings, capturedAt, scroll: scrollInfo, expanded, images: imgInfo, textChars: textLines.join('\n').length };
}

// ------------------------------------------------------------
//  Levering til Studio (eller annen lokal motor)
// ------------------------------------------------------------
async function fsDeliverToStudio(tab, cap, opts, report) {
  const start = await fsCall('/full/start', { url: cap.page.url || tab.url, case: opts.caseName, extVersion: FS_EXT_VERSION });
  let i = 0;
  for (const f of cap.files) {
    i++; report('Sender til Studio … ' + i + '/' + cap.files.length, 88 + Math.round(10 * i / cap.files.length));
    let b64 = '';
    for (let k = 0; k < f.bytes.length; k += 0x8000) b64 += String.fromCharCode.apply(null, f.bytes.subarray(k, k + 0x8000));
    await fsCall('/full/file', { id: start.id, path: f.path, data: btoa(b64) });
  }
  let cookies = null;
  if (opts.video && await fsHasAllHosts()) {
    try {
      const host = new URL(cap.page.url || tab.url).hostname.split('.').slice(-2).join('.');
      cookies = await chrome.cookies.getAll({ domain: host });
    } catch (e) { cookies = null; }
  }
  const p = cap.page;
  return fsCall('/full/finish', {
    id: start.id, note: opts.note || '', extVersion: FS_EXT_VERSION, video: !!opts.video, cookies,
    meta: { url: p.url, title: p.title, meta: p.meta, viewport: p.viewport, userAgent: p.userAgent, capturedAt: cap.capturedAt,
      scroll: cap.scroll, expanded: cap.expanded, images: cap.images, warnings: cap.warnings },
  });
}

// ------------------------------------------------------------
//  Uten Studio: Nedlastinger/Bevissikring/<sak>/<mappe>/
// ------------------------------------------------------------
const FS_TSA = ['http://timestamp.digicert.com', 'http://timestamp.sectigo.com'];
function fsDerLen(n) { if (n < 128) return [n]; const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
function fsDer(tag, content) { return [tag, ...fsDerLen(content.length), ...content]; }
function fsDerInt(bytes) { return fsDer(0x02, bytes[0] & 0x80 ? [0, ...bytes] : bytes); }
function fsBuildTsq(hash, nonce) {
  const oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const algo = fsDer(0x30, [...oid, 0x05, 0x00]);
  const imprint = fsDer(0x30, [...algo, ...fsDer(0x04, Array.from(hash))]);
  return new Uint8Array(fsDer(0x30, [...fsDerInt([1]), ...imprint, ...fsDerInt(Array.from(nonce)), 0x01, 0x01, 0xff]));
}
function fsIndexOf(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return i; }
  return -1;
}
function fsParseTsr(buf) {
  const tlv = off => { let len = buf[off + 1], hdr = 2; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i]; hdr = 2 + n; } return { start: off + hdr, end: off + hdr + len }; };
  const top = tlv(0), si = tlv(top.start), st = tlv(si.start);
  let status = 0; for (let i = st.start; i < st.end; i++) status = status * 256 + buf[i];
  let genTime = '';
  for (let i = si.end; i < buf.length - 17; i++) {
    if (buf[i] !== 0x18) continue;
    const len = buf[i + 1]; if (len < 15 || len > 24) continue;
    const s = String.fromCharCode.apply(null, buf.subarray(i + 2, i + 2 + len));
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
    if (m) { genTime = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + (m[7] || '') + 'Z'; break; }
  }
  return { status, genTime };
}
async function fsTimestamp(sumsBytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', sumsBytes));
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const tsq = fsBuildTsq(hash, nonce);
  let last = null;
  for (const url of FS_TSA) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: tsq });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const tsr = new Uint8Array(await res.arrayBuffer());
      const info = fsParseTsr(tsr);
      if (info.status > 1) throw new Error('avvist (status ' + info.status + ')');
      if (fsIndexOf(tsr, hash) < 0) throw new Error('svaret gjelder ikke denne sjekksummen');
      const meta = { format: 'faktisk-tidsstempel', version: 1, standard: 'RFC 3161', tsa: url, requestedAt: new Date().toISOString(), genTime: info.genTime,
        file: 'SHA256SUMS.txt', sha256: Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join(''),
        meaning: 'Tjenesten bekrefter at SHA256SUMS.txt (og dermed alle filene i sikringen) fantes i denne formen senest på genTime.',
        howToVerify: ['openssl ts -reply -in tidsstempel.tsr -text'] };
      return { ok: true, tsq, tsr, meta };
    } catch (e) { last = e; }
  }
  return { ok: false, error: last ? last.message : 'ingen tjeneste' };
}

async function fsEnsureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Lagre sikringsfiler i Nedlastinger' });
}
async function fsSaveFile(dirPath, f) {
  // Blob-adresse lages i et skjult dokument (service worker kan ikke lage blob:-URL)
  let b64 = '';
  for (let k = 0; k < f.bytes.length; k += 0x8000) b64 += String.fromCharCode.apply(null, f.bytes.subarray(k, k + 0x8000));
  const { url } = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'blob', data: btoa(b64), mime: f.type || 'application/octet-stream' });
  const id = await chrome.downloads.download({ url, filename: dirPath + '/' + f.path, conflictAction: 'uniquify', saveAs: false });
  await new Promise(resolve => {
    const done = d => { if (d.id === id && d.state && /complete|interrupted/.test(d.state.current)) { chrome.downloads.onChanged.removeListener(done); resolve(); } };
    chrome.downloads.onChanged.addListener(done);
    setTimeout(() => { chrome.downloads.onChanged.removeListener(done); resolve(); }, 60000);
  });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url }).catch(() => {});
}

async function fsSaveLocally(tab, cap, opts, report) {
  const { userName } = await fsGet('userName');
  const p = cap.page;
  const when = new Date(cap.capturedAt);
  let host = 'web';
  try { host = new URL(p.url || tab.url).hostname.replace(/^www\./, ''); } catch (e) {}
  const stamp = when.getFullYear() + '-' + fsPad(when.getMonth() + 1) + '-' + fsPad(when.getDate()) + '_' + fsPad(when.getHours()) + fsPad(when.getMinutes()) + fsPad(when.getSeconds());
  const folder = 'Bevissikring/' + (fsSafeName(opts.caseName) || 'Uten sak') + '/' + [stamp, fsSlug(host, 30), 'chrome'].join('_');

  // Enkel video (vanlig videofil, ikke strømmet) kan lagres uten Studio
  if (opts.video) {
    const direct = (p.videos || []).filter(v => v.direct).slice(0, 3);
    let saved = 0;
    for (const v of direct) {
      report('Henter video …', 86);
      const r = await fsFetchBytes(v.src);
      if (r && r.bytes.length) { saved++; cap.files.push({ path: 'video/video-' + fsPad(saved) + '.' + (FS_EXT_BY_TYPE[r.type] || 'mp4'), bytes: r.bytes, type: r.type || 'video/mp4', source: v.src }); }
    }
    if ((p.videos || []).length && !saved) cap.warnings.push('Video ble ikke lagret: strømmet video krever Faktisk Studio (yt-dlp). Start Studio og sikre på nytt, eller bruk «Last ned video».');
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const entries = [];
  for (const f of cap.files) entries.push({ path: f.path, bytes: f.bytes.length, sha256: await fsSha256Hex(f.bytes), source: f.source || undefined });
  const manifest = {
    format: 'faktisk-bevissikring', version: 1, kind: 'chrome', case: opts.caseName || '', note: opts.note || '',
    capturedAt: when.toISOString(), capturedAtLocal: when.toLocaleString('nb-NO', { timeZone: tz }) + ' (' + tz + ')',
    capturedBy: '', capturedByName: userName || '', machine: '', loginAccount: 'brukerens egen Chrome-innlogging',
    tool: { name: 'Faktisk Bevissikring for Chrome (uten Studio)', studioVersion: null, pluginVersion: null, extensionVersion: FS_EXT_VERSION },
    source: { requestedUrl: p.url || tab.url, finalUrl: p.url || tab.url, title: p.title || '', canonical: '', platform: host, handle: '', lang: '', meta: p.meta || {},
      capturedIn: 'Google Chrome via Faktisk-utvidelsen ' + FS_EXT_VERSION + ' («Sikre alt jeg ser», lagret uten Studio)' },
    browser: { userAgent: p.userAgent, viewport: p.viewport },
    chrome: { scroll: cap.scroll, expandedComments: cap.expanded, images: cap.images },
    warnings: cap.warnings, completedAt: new Date().toISOString(), files: entries,
    howToVerify: 'Åpne Terminal i denne mappa og kjør: shasum -a 256 -c SHA256SUMS.txt',
  };
  const manBytes = fsUtf8(JSON.stringify(manifest, null, 2) + '\n');
  const sumsLines = entries.map(e => [e.sha256, e.path]).concat([[await fsSha256Hex(manBytes), 'manifest.json']])
    .sort((a, b) => a[1].localeCompare(b[1], 'nb')).map(x => x[0] + '  ' + x[1]);
  const sumsBytes = fsUtf8(sumsLines.join('\n') + '\n');
  const all = cap.files.concat([{ path: 'manifest.json', bytes: manBytes, type: 'application/json' }, { path: 'SHA256SUMS.txt', bytes: sumsBytes, type: 'text/plain' }]);
  const { noStamp } = await fsGet('noStamp');
  let stampInfo = null;
  if (!noStamp) {
    report('Henter tidsstempel …', 90);
    stampInfo = await fsTimestamp(sumsBytes);
    if (!stampInfo.ok) cap.warnings.push('Tidsstempel kunne ikke hentes (' + stampInfo.error + ') — sjekk nettforbindelsen.');
    if (stampInfo.ok) all.push({ path: 'tidsstempel.tsq', bytes: stampInfo.tsq, type: 'application/timestamp-query' },
      { path: 'tidsstempel.tsr', bytes: stampInfo.tsr, type: 'application/timestamp-reply' },
      { path: 'tidsstempel.json', bytes: fsUtf8(JSON.stringify(stampInfo.meta, null, 2) + '\n'), type: 'application/json' });
  }
  await fsEnsureOffscreen();
  let i = 0;
  for (const f of all) { i++; report('Lagrer i Nedlastinger … ' + i + '/' + all.length, 90 + Math.round(9 * i / all.length)); await fsSaveFile(folder, f); }
  return { ok: true, folder, stamp: stampInfo, fingerprint: await fsSha256Hex(sumsBytes) };
}
