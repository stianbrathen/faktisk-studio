// Faktisk Studio · Tabell
//
// Tabell i Faktisk-stil for tall og fordelinger: valgfritt kvadratisk
// illustrasjonsbilde til venstre, teksten i god størrelse med søyle under,
// og antall + andel høyrestilt. Andelen (%) og søylelengdene regnes ut
// automatisk fra verdiene — eller, i prosentmodus (0.2.0), er verdiene
// ferdige prosenter som vises som de er, med søyler målt mot 100.
// Valgfri detaljlinje per rad (f.eks. «7 186 medlemmer · 569 innlegg»). Avrundet boks med valgfri ramme, stikktittel,
// tittel, undertittel og kildelinjer.
//
// Embedden er selvstendig og statisk (ingen JS hos leserne), med
// URL-lenkede bilder (aldri base64) og design-tokens fra
// shared/embed-tokens.js. Forhåndsvisningen er NØYAKTIG embed-markupen.

const PLUGIN_ID = 'tabell';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) {
      el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
    }
  } catch (e) {}
})();

const els = {
  kicker:      document.getElementById('kickerInput'),
  title:       document.getElementById('titleInput'),
  subtitle:    document.getElementById('subtitleInput'),
  rowList:     document.getElementById('rowList'),
  addRowBtn:   document.getElementById('addRowBtn'),
  valueMode:   document.getElementById('valueModeSelect'),
  rowHint:     document.getElementById('rowHint'),
  sortBtn:     document.getElementById('sortRowsBtn'),
  optBars:     document.getElementById('optBars'),
  optCount:    document.getElementById('optCount'),
  optPct:      document.getElementById('optPct'),
  optBold:     document.getElementById('optBold'),
  optFrame:    document.getElementById('optFrame'),
  optBg:       document.getElementById('optBg'),
  optDividers: document.getElementById('optDividers'),
  imgSize:     document.getElementById('imgSizeSelect'),
  frameWidth:  document.getElementById('frameWidthSelect'),
  frameColor:  document.getElementById('frameColorInput'),
  sourceText:  document.getElementById('sourceText'),
  previewHost: document.getElementById('previewHost'),
  empty:       document.getElementById('emptyState'),
  copyEmbed:   document.getElementById('copyEmbedBtn'),
  back:        document.getElementById('backBtn'),
  full:        document.getElementById('fullscreenBtn'),
  openLabrador: document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

const state = {
  // Rader: { id, imgUrl, label, value, detail } — value er tall som tekst
  rows: [],
};

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'
  }[c]));
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

// «1 234», «48,3» og «83» → tall; alt annet → null
function parseNum(v) {
  const n = parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

// 48.255 → «48,3 %» (én desimal, norsk komma — som i grafikkene våre)
function fmtPct(p) {
  return p.toFixed(1).replace('.', ',') + ' %';
}

// Bildestørrelser i layouten (kvadratiske illustrasjoner)
const IMG_SIZES = {
  s: 'clamp(36px, 5.5cqw, 52px)',
  m: 'clamp(48px, 8cqw, 74px)',
  l: 'clamp(64px, 11cqw, 104px)',
};

// ============================================================
//  Rader
// ============================================================

function addRow() {
  state.rows.push({
    id: 'r_' + Math.random().toString(36).slice(2, 7),
    imgUrl: '',
    label: '',
    value: '',
    detail: '',
  });
  renderRows();
  scheduleUpdate();
  // Sett markøren i den nye radens tekstfelt
  const inputs = els.rowList.querySelectorAll('[data-act="label"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function deleteRow(id) {
  state.rows = state.rows.filter(r => r.id !== id);
  renderRows();
  scheduleUpdate();
}

function moveRow(id, dir) {
  const i = state.rows.findIndex(r => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.rows.length) return;
  const [r] = state.rows.splice(i, 1);
  state.rows.splice(j, 0, r);
  renderRows();
  scheduleUpdate();
}

function renderRows() {
  els.rowList.innerHTML = '';
  state.rows.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'hk-row';
    card.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${i + 1}</span>
        <input class="hk-row__title" value="${escapeHtml(r.label)}"
               data-id="${r.id}" data-act="label" placeholder="Tekst — f.eks. Kritisk til mediene">
        <input class="ftb-value" value="${escapeHtml(r.value)}"
               data-id="${r.id}" data-act="value" placeholder="${isPctMode() ? '%' : 'Tall'}" inputmode="decimal">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-id="${r.id}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn" data-act="down" data-id="${r.id}" title="Flytt ned" ${i === state.rows.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${r.id}" title="Slett raden">×</button>
        </span>
      </div>
      <input class="hk-row__img" value="${escapeHtml(r.detail || '')}"
             data-id="${r.id}" data-act="detail"
             placeholder="Detaljer (valgfri) — f.eks. 7 186 medlemmer · 569 innlegg" spellcheck="true">
      <input class="hk-row__img" value="${escapeHtml(r.imgUrl)}"
             data-id="${r.id}" data-act="img"
             placeholder="Bilde-URL fra Labrador (valgfri, kvadratisk)" spellcheck="false">
      <div class="ftb-labrow">
        <button class="ftb-labbtn" type="button" data-act="files" data-id="${r.id}">Mine filer ▾</button>
        <button class="ftb-labbtn" type="button" data-act="upload" data-id="${r.id}">Last opp…</button>
      </div>
      <div class="ftb-labpanel" data-panel="${r.id}" style="display:none;"></div>`;
    els.rowList.appendChild(card);
  });

  els.rowList.onclick = e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'del') deleteRow(id);
    if (act === 'up') moveRow(id, -1);
    if (act === 'down') moveRow(id, 1);
    if (act === 'files') toggleFilePanel(id);
    if (act === 'upload') uploadToRow(id, btn);
  };
  els.rowList.oninput = e => {
    const act = e.target.dataset.act;
    const r = state.rows.find(x => x.id === e.target.dataset.id);
    if (!r || !act) return;
    if (act === 'label') r.label = e.target.value;
    if (act === 'value') r.value = e.target.value;
    if (act === 'detail') r.detail = e.target.value;
    if (act === 'img')   r.imgUrl = e.target.value.trim();
    scheduleUpdate();
  };
}

els.addRowBtn.addEventListener('click', addRow);

// ============================================================
//  Verdimodus (0.2.0): «count» = antall, andel regnes ut;
//  «pct» = ferdige prosenter, vises som de er, søyler mot 100
// ============================================================

function isPctMode() {
  return els.valueMode && els.valueMode.value === 'pct';
}

function updateModeUi() {
  const pct = isPctMode();
  els.rowHint.textContent = pct
    ? 'Verdiene er ferdige prosenter (f.eks. 79,9) — de vises som de er, og søylene måles mot 100 %. Bilde-URL: last opp kvadratiske illustrasjoner i Labrador og lim inn lenken.'
    : 'Verdiene er tall — andelen (%) og søylene regnes ut automatisk. Bilde-URL: last opp kvadratiske illustrasjoner i Labrador og lim inn lenken.';
  // «Antall» og «Andel» gir ikke mening hver for seg når verdien er en prosent
  els.optCount.closest('label').style.display = pct ? 'none' : '';
  els.optPct.closest('label').style.display = pct ? 'none' : '';
  els.rowList.querySelectorAll('[data-act="value"]').forEach(i => { i.placeholder = pct ? '%' : 'Tall'; });
}

// Engangs-sortering: høyeste verdi øverst (rader uten tall havner nederst)
function sortRowsByValue() {
  state.rows.sort((a, b) => {
    const na = parseNum(a.value), nb = parseNum(b.value);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return nb - na;
  });
  renderRows();
  scheduleUpdate();
}

els.sortBtn.addEventListener('click', sortRowsByValue);

// 0.2.2: importer rader fra Excel (.xlsx), CSV eller TSV (felles dialog i shared/fk-import.js)
document.getElementById('importBtn').addEventListener('click', () => {
  if (!window.FaktiskImport) return;
  FaktiskImport.openDialog({
    title: 'Importer rader til tabellen',
    replaceLabel: 'Erstatt eksisterende rader',
    fields: [
      { key: 'label', label: 'Tekst', guess: /tekst|navn|gruppe|kategori|label|name/i, required: true },
      { key: 'value', label: 'Verdi (tall eller %)', guess: /verdi|andel|prosent|antall|value|%|tall/i },
      { key: 'detail', label: 'Detaljer (valgfri)', guess: /detalj|beskriv|info|merknad|note/i },
      { key: 'imgUrl', label: 'Bilde-URL (valgfri)', guess: /bilde|url|img|image/i },
    ],
    onApply: (objs, o) => {
      const rows = objs.filter(x => String(x.label).trim()).map(x => ({
        id: 'r_' + Math.random().toString(36).slice(2, 7),
        label: String(x.label).trim(),
        value: String(x.value || '').replace(/\s*%\s*$/, '').trim(),
        detail: String(x.detail || '').trim(),
        imgUrl: /^https?:\/\//.test(String(x.imgUrl || '').trim()) ? String(x.imgUrl).trim() : '',
      }));
      state.rows = o.replace ? rows : state.rows.concat(rows);
      // Verdier med %-tegn i fila → prosentmodus
      if (objs.some(x => /%\s*$/.test(String(x.value || '')))) { els.valueMode.value = 'pct'; updateModeUi(); }
      renderRows(); scheduleUpdate();
    },
  });
});
els.valueMode.addEventListener('change', () => { updateModeUi(); scheduleUpdate(); });

// ============================================================
//  Bilder fra Labrador per rad — samme API som «Mine filer» ellers
// ============================================================

const IMG_EXT = /\.(png|jpe?g|gif|avif|heic|webp)(\?|$)/i;

function setRowImage(id, url) {
  const r = state.rows.find(x => x.id === id);
  if (!r) return;
  r.imgUrl = url;
  renderRows();
  scheduleUpdate();
}

async function toggleFilePanel(id) {
  const panel = els.rowList.querySelector(`[data-panel="${id}"]`);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  // Lukk alle paneler først
  els.rowList.querySelectorAll('.ftb-labpanel').forEach(p => { p.style.display = 'none'; });
  if (open) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try {
    res = await window.faktisk.labradorListFiles();
  } catch (err) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>';
    return;
  }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. '
      + '<button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) { panel.style.display = 'none'; toggleFilePanel(id); }
      else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 60);
  if (!matching.length) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder lastet opp ennå.</div>';
    return;
  }
  panel.innerHTML = '<div class="ftb-labpanel__status">'
    + matching.length + ' bilder (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ftb-labfile';
    item.textContent = f.name;
    item.title = f.url;
    item.addEventListener('click', () => setRowImage(id, f.url));
    list.appendChild(item);
  });
}

async function uploadToRow(id, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; })
    : () => {};
  try {
    const res = await window.faktisk.labradorUpload({
      filters: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'gif', 'avif', 'heic', 'webp'] }],
    });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) setRowImage(id, res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally {
    unsub();
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ============================================================
//  Embed + forhåndsvisning (samme markup)
// ============================================================

function activeRows() {
  return state.rows.filter(r => String(r.label || '').trim() || String(r.value || '').trim());
}

// 0.2.1: embedden beskyttes mot faktisk.no-stilene (FaktiskEmbedBase.isolate i shared/embed-tokens.js)
// 0.2.4: etikett/detalj har overflow-wrap:anywhere (lange ord uten mellomrom gjorde siden bredere enn mobilskjermen),
//        og tallene bruker ikke tabular-nums (faktisk.no sin Unica77 gjør da også komma og mellomrom like brede).
function buildEmbedSnippet() {
  const html = buildEmbedSnippetRaw();
  const iso = window.FaktiskEmbedBase && window.FaktiskEmbedBase.isolate;
  if (!iso) return html;
  return html.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => '<style>' + iso(css, 'ftb-container') + '</style>');
}

function buildEmbedSnippetRaw() {
  const id = 'ftb-' + Math.random().toString(36).slice(2, 8);
  const rows = activeRows();

  const kicker = els.kicker.value.trim();
  const title = els.title.value.trim();
  const subtitle = els.subtitle.value.trim();
  const source = els.sourceText.value.trim();
  const showBars = els.optBars.checked;
  const showCount = els.optCount.checked;
  const showPct = els.optPct.checked;
  const frame = els.optFrame.checked;
  // Ingen bakgrunn: gjennomsiktig boks. Uten ramme heller fjernes sideluften, så teksten flukter med artikkelen.
  const noBg = !els.optBg.checked;
  const dividers = els.optDividers.checked;
  const bold = els.optBold.checked;
  const imgSize = IMG_SIZES[els.imgSize.value] || IMG_SIZES.m;
  const frameWidth = els.frameWidth.value || '1.5';
  const frameColor = /^#[0-9a-fA-F]{6}$/.test(els.frameColor.value)
    ? els.frameColor.value : '#E3E3E3';

  const pctMode = isPctMode();
  // Andel og søyler regnes fra tallverdiene (i prosentmodus: verdien ER andelen)
  const nums = rows.map(r => parseNum(r.value));
  const valid = nums.filter(n => n !== null && n >= 0);
  const sum = valid.reduce((a, b) => a + b, 0);
  const max = valid.length ? Math.max(...valid) : 0;
  const hasAnyImg = rows.some(r => r.imgUrl && isValidUrl(r.imgUrl));

  const baseCss = (typeof window !== 'undefined' && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss('ftb-container')
    : '';

  const rowsHtml = rows.map((r, i) => {
    const n = nums[i];
    const pct = pctMode
      ? ((n !== null && n >= 0) ? n : null)
      : ((n !== null && n >= 0 && sum > 0) ? n / sum * 100 : null);
    const barPct = pctMode
      ? ((n !== null && n >= 0) ? Math.min(n, 100) : null)
      : ((n !== null && n >= 0 && max > 0) ? n / max * 100 : null);

    const img = (r.imgUrl && isValidUrl(r.imgUrl))
      ? `
        <img class="ftb-img" src="${escapeHtml(r.imgUrl)}" alt="" loading="lazy">`
      : (hasAnyImg ? `
        <span class="ftb-img ftb-img--tom" aria-hidden="true"></span>` : '');

    const bar = (showBars && barPct !== null) ? `
          <div class="ftb-track"><div class="ftb-bar" style="width:${barPct.toFixed(1)}%;"></div></div>` : '';

    const numParts = [];
    if (pctMode) {
      // Prosenten er hovedtallet — stort og fett, der antallet ellers står
      if (pct !== null) numParts.push(`
          <span class="ftb-count">${fmtPct(pct)}</span>`);
    } else if (showCount && String(r.value || '').trim()) {
      numParts.push(`
          <span class="ftb-count">${escapeHtml(String(r.value).trim())}</span>`);
    }
    if (!pctMode && showPct && pct !== null) {
      numParts.push(`
          <span class="ftb-pct">${fmtPct(pct)}</span>`);
    }
    const detail = String(r.detail || '').trim();
    const detailHtml = detail ? `
          <span class="ftb-detail">${escapeHtml(detail)}</span>` : '';

    const numsHtml = numParts.length ? `
        <span class="ftb-nums">${numParts.join('')}
        </span>` : '';

    return `
      <!-- ▶ RAD ${i + 1} -->
      <div class="ftb-row">${img}
        <span class="ftb-main">
          <span class="ftb-label">${escapeHtml(String(r.label || '').trim())}</span>${bar}${detailHtml}
        </span>${numsHtml}
      </div>`;
  }).join('');

  const head = [];
  if (kicker) head.push(`
      <!-- ▶ STIKKTITTEL -->
      <div class="ftb-kicker">${escapeHtml(kicker)}</div>`);
  if (title) head.push(`
      <!-- ▶ TITTEL -->
      <div class="ftb-title">${escapeHtml(title)}</div>`);
  if (subtitle) head.push(`
      <!-- ▶ UNDERTITTEL -->
      <div class="ftb-sub">${escapeHtml(subtitle)}</div>`);

  const sourceHtml = source ? `
      <!-- ▶ KILDE / NOTER -->
      <div class="ftb-source">${escapeHtml(source)}</div>` : '';

  return `<!-- ============================================
     FAKTISK · TABELL
     Endre tekst i feltene merket med ▶ — andeler og søyler
     endres i Faktisk Studio.
     ============================================ -->
  <style>${baseCss}
    .ftb-container { container-type: inline-size; padding: 0.7rem 0; }
    .ftb-wrap-${id} {
      background: ${noBg ? 'transparent' : '#fff'};
      border: ${frame ? `${frameWidth}px solid ${frameColor}` : '0'};
      border-radius: 16px;
      padding: ${noBg && !frame ? 'clamp(8px, 1.6cqw, 14px) 0' : 'clamp(16px, 3.4cqw, 30px)'};
      font-family: "Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #212121;
      box-sizing: border-box;
    }
    .ftb-wrap-${id} .ftb-kicker {
      color: #0050fc;
      font-weight: bold;
      font-size: clamp(11px, 1.6cqw, 13px);
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .ftb-wrap-${id} .ftb-title {
      font-weight: bold;
      font-size: clamp(20px, 3.4cqw, 31px);
      line-height: 1.15;
      margin-top: 4px;
    }
    .ftb-wrap-${id} .ftb-sub {
      color: #666;
      font-size: clamp(13px, 2cqw, 16px);
      line-height: 1.4;
      margin-top: 4px;
    }
    .ftb-wrap-${id} .ftb-rows { margin-top: clamp(8px, 1.6cqw, 14px); }
    .ftb-wrap-${id} .ftb-row {
      display: flex;
      align-items: center;
      gap: clamp(10px, 2.2cqw, 18px);
      padding: clamp(10px, 2cqw, 16px) 0;
      ${dividers ? `border-top: 1px solid #ECECEC;` : ''}
    }
    ${dividers ? `.ftb-wrap-${id} .ftb-row:first-child { border-top: 0; }` : ''}
    .ftb-wrap-${id} .ftb-img {
      flex-shrink: 0;
      width: ${imgSize};
      height: ${imgSize};
      border-radius: 10px;
      object-fit: cover;
      display: block;
    }
    .ftb-wrap-${id} .ftb-img--tom { background: transparent; }
    .ftb-wrap-${id} .ftb-main { flex: 1; min-width: 0; display: block; }
    .ftb-wrap-${id} .ftb-label {
      display: block;
      font-size: clamp(15px, 2.3cqw, 19px);
      font-weight: ${bold ? 'bold' : 'normal'};
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .ftb-wrap-${id} .ftb-track {
      margin-top: 7px;
      height: clamp(8px, 1.3cqw, 12px);
      background: #F1F1F1;
      border-radius: 999px;
      overflow: hidden;
    }
    .ftb-wrap-${id} .ftb-bar {
      height: 100%;
      min-width: 3px;
      background: #0050fc;
      border-radius: inherit;
    }
    .ftb-wrap-${id} .ftb-detail {
      display: block;
      margin-top: 6px;
      color: #767676;
      font-size: clamp(12px, 1.9cqw, 14px);
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .ftb-wrap-${id} .ftb-nums {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 1px;
      text-align: right;
    }
    .ftb-wrap-${id} .ftb-count {
      white-space: nowrap;
      font-weight: bold;
      font-size: clamp(18px, 3cqw, 26px);
      line-height: 1.1;
    }
    .ftb-wrap-${id} .ftb-pct {
      color: #767676;
      font-size: clamp(12px, 1.9cqw, 15px);
      white-space: nowrap;
    }
    .ftb-wrap-${id} .ftb-source {
      margin-top: clamp(10px, 2cqw, 16px);
      padding-top: clamp(10px, 2cqw, 14px);
      border-top: 1px solid #ECECEC;
      color: #767676;
      font-size: clamp(11px, 1.7cqw, 13px);
      line-height: 1.55;
      white-space: pre-line;
    }
  </style>
  <div class="ftb-container">
    <div class="ftb-wrap-${id}">${head.join('')}
      <div class="ftb-rows">${rowsHtml}
      </div>${sourceHtml}
    </div>
  </div>
`;
}

function renderPreview() {
  const rows = activeRows();
  els.copyEmbed.disabled = rows.length === 0;
  if (!rows.length) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Legg til rader i tabellen — forhåndsvisningen dukker opp her.</p>';
    return;
  }
  els.previewHost.innerHTML = buildEmbedSnippet();
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    renderPreview();
    saveStateNow();
  }, 250);
}

els.copyEmbed.addEventListener('click', async () => {
  if (!activeRows().length) return;
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet());
    const orig = els.copyEmbed.textContent;
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ============================================================
//  Arkivering
// ============================================================

let isRestoring = false;

function serializeState() {
  return {
    kicker: els.kicker.value,
    title: els.title.value,
    subtitle: els.subtitle.value,
    rows: state.rows,
    valueMode: isPctMode() ? 'pct' : 'count',
    showBars: els.optBars.checked,
    showCount: els.optCount.checked,
    showPct: els.optPct.checked,
    boldLabels: els.optBold.checked,
    frame: els.optFrame.checked,
    bg: els.optBg.checked,
    dividers: els.optDividers.checked,
    imgSize: els.imgSize.value,
    frameWidth: els.frameWidth.value,
    frameColor: els.frameColor.value,
    sourceText: els.sourceText.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    els.kicker.value = s.kicker || '';
    els.title.value = s.title || '';
    els.subtitle.value = s.subtitle || '';
    els.sourceText.value = s.sourceText || '';
    if (typeof s.showBars === 'boolean') els.optBars.checked = s.showBars;
    if (typeof s.showCount === 'boolean') els.optCount.checked = s.showCount;
    if (typeof s.showPct === 'boolean') els.optPct.checked = s.showPct;
    if (typeof s.boldLabels === 'boolean') els.optBold.checked = s.boldLabels;
    if (typeof s.frame === 'boolean') els.optFrame.checked = s.frame;
    els.optBg.checked = s.bg !== false;
    if (typeof s.dividers === 'boolean') els.optDividers.checked = s.dividers;
    if (s.imgSize && IMG_SIZES[s.imgSize]) els.imgSize.value = s.imgSize;
    if (s.frameWidth) els.frameWidth.value = s.frameWidth;
    if (/^#[0-9a-fA-F]{6}$/.test(s.frameColor || '')) els.frameColor.value = s.frameColor;
    els.valueMode.value = s.valueMode === 'pct' ? 'pct' : 'count';
    if (Array.isArray(s.rows)) state.rows = s.rows;
    renderRows();
    updateModeUi();
    renderPreview();
  } finally {
    isRestoring = false;
  }
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.kicker, els.title, els.subtitle, els.sourceText].forEach(el => {
  el.addEventListener('input', scheduleUpdate);
});
[els.optBars, els.optCount, els.optPct, els.optBold, els.optFrame, els.optBg,
 els.optDividers, els.imgSize, els.frameWidth, els.frameColor].forEach(el => {
  el.addEventListener('change', scheduleUpdate);
});
els.frameColor.addEventListener('input', scheduleUpdate);

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

els.saveProject.addEventListener('click', async () => {
  const defaultName = (els.title.value || '').slice(0, 40).trim()
    || `Tabell ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) await refreshProjectList();
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) applyState(res.state);
});

(async function init() {
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) {
          applyState(res.state);
          els.projectSelect.value = fileId;
          return;
        }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) {
      applyState(res.state);
      return;
    }
  } catch (e) {}
  // Tomt utgangspunkt: to rader klare til utfylling
  addRow();
  addRow();
})();
