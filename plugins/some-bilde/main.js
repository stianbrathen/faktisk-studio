// Faktisk Studio · SoMe-bilde — kvadratiske bilder til Facebook/sosiale medier
//
// Canvas-basert: forhåndsvisningen OG eksporten bruker samme tegnefunksjon,
// så det du ser er nøyaktig det du får. 1200×1200 (Facebook-kvadrat).
//
// Interaksjon på canvasen:
//   - dra i bakgrunn = flytt bildet (den halvdelen du peker på ved delt bilde)
//   - scroll        = zoom bildet under pekeren
//   - dra i teksten = flytt tekstblokken opp/ned
//   - dra i partnerlogo (fri modus) = flytt den

const PLUGIN_ID = 'some-bilde';
const W = 1200, H = 1200;

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(), window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const els = {};
['imgUrl', 'imgLoadUrl', 'imgFile', 'img2Url', 'img2LoadUrl', 'img2File', 'img2Remove',
 'splitOptions', 'splitLine', 'splitVertical',
 'textInput', 'textSize', 'textAuto',
 'partnerFile', 'partnerMode', 'partnerRemove', 'partnerOptions', 'partnerSize',
 'partnerBox', 'partnerPlus',
 'fadeTop', 'fadeBottom', 'showLogo',
 'projectSelect', 'saveProjectBtn',
 'copyClipBtn', 'exportPngBtn', 'exportJpgBtn',
 'status', 'backBtn', 'fullscreenBtn', 'previewCanvas', 'canvasArea',
].forEach(id => { els[id] = document.getElementById(id); });

const state = {
  img1: null,   // { src, naturalW, naturalH, x, y, scale }
  img2: null,
  splitLine: true,
  splitVertical: true,
  fadeTop: 0.35,
  fadeBottom: 0.35,
  showLogo: true,
  text: { content: '', size: 72, auto: true, y: 1050 }, // y = bunnen av tekstblokken
  partner: null, // { src, naturalW, naturalH, mode:'preset'|'free', sizePct, label:true, x, y }
};

function setStatus(msg, isError) {
  els.status.textContent = msg || '';
  els.status.style.color = isError ? '#FFB4B4' : '#fff';
}

// ── Bildeinnlasting (fra bildemal) ───────────────────────────────────────

function loadImageData(srcOrFile) {
  return new Promise((resolve, reject) => {
    const reader = (typeof srcOrFile === 'string')
      ? Promise.resolve(srcOrFile)
      : new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = rej;
          fr.readAsDataURL(srcOrFile);
        });
    reader.then(src => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve({ src, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
      img.onerror = () => reject(new Error('Kunne ikke laste bildet (sjekk URL/CORS).'));
      img.src = src;
    }).catch(reject);
  });
}

const imgCache = new Map();
function loadImg(src) {
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src));
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(src, img); res(img); };
    img.onerror = rej;
    img.src = src;
  });
}

// Faktisk-logoen: last logo.svg som Image og farg den hvit via canvas-
// compositing (fetch av lokale filer er blokkert på file://-sider).
let logoImg = null;
(function initLogo() {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth * 8;   // høy oppløsning for skarp nedskalering
    c.height = img.naturalHeight * 8;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, c.width, c.height);
    logoImg = c;
    logoImg.naturalWidth = c.width;
    logoImg.naturalHeight = c.height;
    scheduleRender();
  };
  img.onerror = e => console.warn('Logo-lasting feilet:', e);
  img.src = 'logo.svg';
})();

// ── Regioner (helbilde eller delt) ───────────────────────────────────────

function regions() {
  if (!state.img2) return [{ x: 0, y: 0, w: W, h: H, img: 'img1' }];
  return state.splitVertical
    ? [{ x: 0, y: 0, w: W / 2, h: H, img: 'img1' },
       { x: W / 2, y: 0, w: W / 2, h: H, img: 'img2' }]
    : [{ x: 0, y: 0, w: W, h: H / 2, img: 'img1' },
       { x: 0, y: H / 2, w: W, h: H / 2, img: 'img2' }];
}

// Cover-fit: startposisjon som fyller regionen
function coverFit(imgData, reg) {
  const scale = Math.max(reg.w / imgData.naturalW, reg.h / imgData.naturalH);
  return {
    ...imgData,
    scale,
    x: reg.x + (reg.w - imgData.naturalW * scale) / 2,
    y: reg.y + (reg.h - imgData.naturalH * scale) / 2,
  };
}

function refitImages() {
  const regs = regions();
  for (const reg of regs) {
    const im = state[reg.img];
    if (im) Object.assign(state[reg.img], coverFit(im, reg));
  }
}

// ── Automatisk linjedeling ───────────────────────────────────────────────
// Manuelle linjeskift (Enter) respekteres alltid; auto balanserer segmenter
// som er for brede, med jevnest mulig linjebredde.

function balanceSegment(ctx, words, maxW) {
  const wWidths = words.map(w => ctx.measureText(w).width);
  const space = ctx.measureText(' ').width;
  const total = wWidths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  let n = Math.max(1, Math.ceil(total / maxW));
  while (n <= words.length) {
    // Grådig partisjonering mot mållengde total/n
    const target = total / n;
    const lines = [];
    let line = [], lw = 0;
    for (let i = 0; i < words.length; i++) {
      const addW = wWidths[i] + (line.length ? space : 0);
      const gjenstår = words.length - i;
      const linjerIgjen = n - lines.length;
      // Tving brudd hvis vi ellers ikke får nok ord til resten av linjene
      if (line.length && (lw + addW > target * 1.15 || gjenstår <= linjerIgjen - 1)) {
        lines.push(line.join(' '));
        line = [words[i]]; lw = wWidths[i];
      } else {
        line.push(words[i]); lw += addW;
      }
    }
    if (line.length) lines.push(line.join(' '));
    if (lines.every(l => ctx.measureText(l).width <= maxW) && lines.length <= n) return lines;
    n++;
  }
  return words.map(w => w); // hvert ord på egen linje (ekstremtilfelle)
}

function computeLines(ctx) {
  const t = state.text;
  if (!t.content.trim()) return [];
  ctx.font = `700 ${t.size}px NHG`;
  const maxW = W - 160; // luft på sidene
  const segs = t.content.split('\n').map(s => s.trim()).filter(Boolean);
  if (!t.auto) return segs;
  const out = [];
  for (const seg of segs) {
    if (ctx.measureText(seg).width <= maxW) { out.push(seg); continue; }
    out.push(...balanceSegment(ctx, seg.split(/\s+/), maxW));
  }
  return out;
}

// ── Tegning (delt mellom forhåndsvisning og eksport) ─────────────────────

let textBounds = null;    // for hit-testing
let partnerBounds = null;

async function draw(ctx) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // Bakgrunnsbilder, klippet til sine regioner
  for (const reg of regions()) {
    const im = state[reg.img];
    if (!im) continue;
    const img = await loadImg(im.src);
    ctx.save();
    ctx.beginPath();
    ctx.rect(reg.x, reg.y, reg.w, reg.h);
    ctx.clip();
    ctx.drawImage(img, im.x, im.y, im.naturalW * im.scale, im.naturalH * im.scale);
    ctx.restore();
  }

  // Delestrek
  if (state.img2 && state.splitLine) {
    ctx.fillStyle = '#fff';
    if (state.splitVertical) ctx.fillRect(W / 2 - 4, 0, 8, H);
    else ctx.fillRect(0, H / 2 - 4, W, 8);
  }

  // Fades
  if (state.fadeTop > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, H / 2);
    g.addColorStop(0, `rgba(0,0,0,${state.fadeTop})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H / 2);
  }
  if (state.fadeBottom > 0) {
    const g = ctx.createLinearGradient(0, H, 0, H / 2);
    g.addColorStop(0, `rgba(0,0,0,${state.fadeBottom})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H / 2, W, H / 2);
  }

  // Faktisk-logo øverst
  if (state.showLogo && logoImg) {
    const lw = 220;
    const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    ctx.drawImage(logoImg, (W - lw) / 2, 56, lw, lh);
  }

  // Partnerlogo — faste plasseringer: øverst til høyre (på linje med
  // Faktisk-logoen) eller sentrert under den. Valgfritt: hvit avrundet
  // boks bak (for logoer som ikke finnes i hvitt) og plusstegn foran.
  partnerBounds = null;
  if (state.partner) {
    const p = state.partner;
    const pimg = await loadImg(p.src);
    // Fast HØYDE (spesifisert: 60px standard) — bredden følger logoens
    // format, og boksen omslutter logoen uansett bredde.
    const ph = p.sizeH || 60;
    const pw = ph * (p.naturalW / p.naturalH);
    const logoH = logoImg ? 220 * (logoImg.naturalHeight / logoImg.naturalWidth) : 44;
    const logoSenterY = 56 + logoH / 2;
    let px, py;
    if (p.mode === 'right') {
      px = W - 52 - pw;                 // høyremarg fra spesifikasjonen
      py = logoSenterY - ph / 2;        // på linje med Faktisk-logoen
    } else { // 'under'
      px = (W - pw) / 2;
      py = 56 + logoH + 34;
    }

    const pad = Math.round(ph * 0.22);  // boks-luft skalerer med logohøyden

    let boksVenstre = px;
    if (p.box) {
      boksVenstre = px - pad;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(px - pad, py - pad, pw + pad * 2, ph + pad * 2, Math.round(pad * 0.9));
      ctx.fill();
    }

    if (p.plus) {
      ctx.font = `700 ${Math.round(ph * 0.66)}px NHG`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6;
      ctx.fillText('+', boksVenstre - 24, py + ph / 2 + ph * 0.03); // 24px luft
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    ctx.drawImage(pimg, px, py, pw, ph);
    partnerBounds = { x: px, y: py, w: pw, h: ph };
  }

  // Tekst med blå bokser per linje
  textBounds = null;
  const lines = computeLines(ctx);
  if (lines.length) {
    const t = state.text;
    ctx.font = `700 ${t.size}px NHG`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const padX = Math.round(t.size * 0.38);
    const padY = Math.round(t.size * 0.16);
    const gap = Math.round(t.size * 0.14);
    const lineH = t.size + padY * 2;
    const totalH = lines.length * lineH + (lines.length - 1) * gap;
    let top = Math.min(H - 40 - totalH, Math.max(40, t.y - totalH));
    let minX = W, maxX = 0;
    const radius = Math.round(t.size * 0.14); // svak avrunding, som på boxes-siden
    for (let i = 0; i < lines.length; i++) {
      const tw = ctx.measureText(lines[i]).width;
      const bw = tw + padX * 2;
      const bx = (W - bw) / 2;
      const by = top + i * (lineH + gap);
      ctx.fillStyle = '#0050FC';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, lineH, radius);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(lines[i], W / 2, by + lineH / 2 + t.size * 0.04);
      minX = Math.min(minX, bx); maxX = Math.max(maxX, bx + bw);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    textBounds = { x: minX, y: top, w: maxX - minX, h: totalH };
  }
}

// Forhåndsvisning: throttlet re-tegning
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    try { await draw(els.previewCanvas.getContext('2d')); }
    catch (e) { console.warn(e); }
  });
}

// Eksport: samme tegnefunksjon på ferskt canvas
async function renderToCanvas() {
  await document.fonts.load('700 72px NHG').catch(() => {});
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  await draw(cnv.getContext('2d'));
  return cnv;
}

// ── Canvas-interaksjon ───────────────────────────────────────────────────

function canvasPoint(ev) {
  const r = els.previewCanvas.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) * (W / r.width),
    y: (ev.clientY - r.top) * (H / r.height),
  };
}
function inBounds(p, b) {
  return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}
function regionAt(p) {
  return regions().find(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
}

els.previewCanvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const start = canvasPoint(e);
  let mode = 'bg', targetKey = null, orig = null;

  if (inBounds(start, textBounds)) {
    mode = 'text';
    orig = { y: state.text.y };
  } else {
    const reg = regionAt(start);
    if (reg && state[reg.img]) {
      targetKey = reg.img;
      orig = { x: state[reg.img].x, y: state[reg.img].y };
    } else return;
  }

  els.previewCanvas.classList.add('dragging');
  function onMove(ev) {
    const p = canvasPoint(ev);
    const dx = p.x - start.x, dy = p.y - start.y;
    if (mode === 'text') {
      state.text.y = Math.max(100, Math.min(H - 40, orig.y + dy));
    } else if (targetKey) {
      state[targetKey].x = orig.x + dx;
      state[targetKey].y = orig.y + dy;
    }
    scheduleRender();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    els.previewCanvas.classList.remove('dragging');
    scheduleSaveState();
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
});

els.previewCanvas.addEventListener('wheel', e => {
  const p = canvasPoint(e);
  const reg = regionAt(p);
  if (!reg || !state[reg.img]) return;
  e.preventDefault();
  const im = state[reg.img];
  const faktor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
  const nyScale = Math.max(0.05, Math.min(20, im.scale * faktor));
  // Zoom rundt pekeren: hold punktet under pekeren fast
  im.x = p.x - (p.x - im.x) * (nyScale / im.scale);
  im.y = p.y - (p.y - im.y) * (nyScale / im.scale);
  im.scale = nyScale;
  scheduleRender();
  scheduleSaveState();
}, { passive: false });

// ── Sidebar-kontroller ───────────────────────────────────────────────────

async function setImage(key, srcOrFile) {
  setStatus('Laster bilde…');
  try {
    const data = await loadImageData(srcOrFile);
    state[key] = data;
    if (key === 'img2') els.splitOptions.style.display = 'flex';
    refitImages();
    scheduleRender();
    scheduleSaveState();
    setStatus('');
  } catch (err) { setStatus(err.message, true); }
}

els.imgLoadUrl.addEventListener('click', () => {
  const u = els.imgUrl.value.trim();
  if (u) setImage('img1', u);
});
els.imgUrl.addEventListener('keydown', e => { if (e.key === 'Enter') els.imgLoadUrl.click(); });
els.imgFile.addEventListener('change', function () { if (this.files[0]) setImage('img1', this.files[0]); });

els.img2LoadUrl.addEventListener('click', () => {
  const u = els.img2Url.value.trim();
  if (u) setImage('img2', u);
});
els.img2Url.addEventListener('keydown', e => { if (e.key === 'Enter') els.img2LoadUrl.click(); });
els.img2File.addEventListener('change', function () { if (this.files[0]) setImage('img2', this.files[0]); });
els.img2Remove.addEventListener('click', () => {
  state.img2 = null;
  els.img2Url.value = '';
  els.splitOptions.style.display = 'none';
  refitImages();
  scheduleRender(); scheduleSaveState();
});

els.splitLine.addEventListener('change', () => { state.splitLine = els.splitLine.checked; scheduleRender(); scheduleSaveState(); });
els.splitVertical.addEventListener('change', () => {
  state.splitVertical = els.splitVertical.checked;
  refitImages();
  scheduleRender(); scheduleSaveState();
});

els.textInput.addEventListener('input', () => { state.text.content = els.textInput.value; scheduleRender(); scheduleSaveState(); });
els.textSize.addEventListener('input', () => { state.text.size = +els.textSize.value; scheduleRender(); scheduleSaveState(); });
els.textAuto.addEventListener('change', () => { state.text.auto = els.textAuto.checked; scheduleRender(); scheduleSaveState(); });

els.partnerFile.addEventListener('change', async function () {
  if (!this.files[0]) return;
  try {
    const data = await loadImageData(this.files[0]);
    state.partner = {
      ...data,
      mode: els.partnerMode.value,
      sizeH: +els.partnerSize.value,
      box: els.partnerBox.checked,
      plus: els.partnerPlus.checked,
    };
    els.partnerOptions.style.display = 'flex';
    els.partnerRemove.style.display = '';
    scheduleRender(); scheduleSaveState();
  } catch (err) { setStatus(err.message, true); }
});
els.partnerBox.addEventListener('change', () => {
  if (state.partner) { state.partner.box = els.partnerBox.checked; scheduleRender(); scheduleSaveState(); }
});
els.partnerPlus.addEventListener('change', () => {
  if (state.partner) { state.partner.plus = els.partnerPlus.checked; scheduleRender(); scheduleSaveState(); }
});
els.partnerMode.addEventListener('change', () => {
  if (state.partner) { state.partner.mode = els.partnerMode.value; scheduleRender(); scheduleSaveState(); }
});
els.partnerSize.addEventListener('input', () => {
  if (state.partner) { state.partner.sizeH = +els.partnerSize.value; scheduleRender(); scheduleSaveState(); }
});
els.partnerRemove.addEventListener('click', () => {
  state.partner = null;
  els.partnerOptions.style.display = 'none';
  els.partnerRemove.style.display = 'none';
  scheduleRender(); scheduleSaveState();
});

els.fadeTop.addEventListener('input', () => { state.fadeTop = +els.fadeTop.value / 100; scheduleRender(); scheduleSaveState(); });
els.fadeBottom.addEventListener('input', () => { state.fadeBottom = +els.fadeBottom.value / 100; scheduleRender(); scheduleSaveState(); });
els.showLogo.addEventListener('change', () => { state.showLogo = els.showLogo.checked; scheduleRender(); scheduleSaveState(); });

// ── Eksport ──────────────────────────────────────────────────────────────

async function downloadAs(format) {
  setStatus('Rendrer…');
  try {
    const cnv = await renderToCanvas();
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    cnv.toBlob(blob => {
      if (!blob) { setStatus('Eksport feilet.', true); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faktisk-some-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Lastet ned ${format.toUpperCase()}.`);
    }, mime, format === 'jpg' ? 0.92 : undefined);
  } catch (e) { setStatus('Eksport feilet: ' + e.message, true); }
}
els.exportPngBtn.addEventListener('click', () => downloadAs('png'));
els.exportJpgBtn.addEventListener('click', () => downloadAs('jpg'));

els.copyClipBtn.addEventListener('click', async () => {
  setStatus('Rendrer for utklippstavle…');
  try {
    const cnv = await renderToCanvas();
    cnv.toBlob(async blob => {
      if (!blob) { setStatus('Eksport feilet.', true); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setStatus('Bilde kopiert — lim rett inn i Facebook.');
      } catch (e) { setStatus('Kunne ikke kopiere: ' + e.message, true); }
    }, 'image/png');
  } catch (e) { setStatus('Eksport feilet.', true); }
});

// ── Topbar + persistens ──────────────────────────────────────────────────

els.backBtn.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.fullscreenBtn.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });

let isRestoring = false;
function serializeState() { return JSON.parse(JSON.stringify(state)); }

async function applyState(saved) {
  if (!saved) return;
  isRestoring = true;
  try {
    state.img1 = saved.img1 || null;
    state.img2 = saved.img2 || null;
    state.splitLine = saved.splitLine !== false;
    state.splitVertical = saved.splitVertical !== false;
    state.fadeTop = +saved.fadeTop || 0;
    state.fadeBottom = +saved.fadeBottom || 0;
    state.showLogo = saved.showLogo !== false;
    if (saved.text) Object.assign(state.text, saved.text);
    state.partner = saved.partner || null;
    // Synk UI
    els.splitOptions.style.display = state.img2 ? 'flex' : 'none';
    els.splitLine.checked = state.splitLine;
    els.splitVertical.checked = state.splitVertical;
    els.fadeTop.value = Math.round(state.fadeTop * 100);
    els.fadeBottom.value = Math.round(state.fadeBottom * 100);
    els.showLogo.checked = state.showLogo;
    els.textInput.value = state.text.content;
    els.textSize.value = state.text.size;
    els.textAuto.checked = state.text.auto;
    if (state.partner) {
      if (!['under', 'right'].includes(state.partner.mode)) state.partner.mode = 'right';
      if (!state.partner.sizeH) state.partner.sizeH = 60; // migrer fra gammel sizePct
      els.partnerMode.value = state.partner.mode;
      els.partnerSize.value = state.partner.sizeH;
      els.partnerBox.checked = !!state.partner.box;
      els.partnerPlus.checked = !!state.partner.plus;
      els.partnerOptions.style.display = 'flex';
      els.partnerRemove.style.display = '';
    }
    scheduleRender();
  } finally { isRestoring = false; }
}

let saveTimer = null;
function scheduleSaveState() {
  if (isRestoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
  }, 500);
}

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.fileId;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch (e) { console.error(e); }
}

els.saveProjectBtn.addEventListener('click', async () => {
  const defaultName = (state.text.content || '').slice(0, 40).trim()
    || `SoMe-bilde ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) { setStatus('Lagret: «' + res.name + '».'); await refreshProjectList(); }
  else setStatus('Kunne ikke lagre: ' + (res.error || 'ukjent feil'), true);
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) { await applyState(res.state); setStatus('Åpnet «' + res.name + '».'); }
});

(async function init() {
  await document.fonts.load('700 72px NHG').catch(() => {});
  scheduleRender();
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) { await applyState(res.state); els.projectSelect.value = fileId; return; }
      }
    } catch (e) { console.error(e); }
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) await applyState(res.state);
  } catch (e) { console.error(e); }
})();
