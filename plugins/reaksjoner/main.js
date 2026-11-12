// Faktisk Studio · Reaksjoner
//
// Liste over innlegg fra sosiale medier i Faktisk-stil: kvadratisk miniatyrbilde
// til venstre, teksten (typisk spørsmålet i innlegget) til høyre, et nøytralt
// like-symbol med antall reaksjoner, og en lenke som sier hvor den fører
// («Arkivert kopi på archive.ph ↗» / «Innlegget på facebook.com ↗»).
//
// Reaksjoner skrives slik plattformen viser dem: «854», «2,4k», «2.4K».
// Tall med k (eller «ca.») regnes som avrundet og vises som «ca. 2 400».
//
// Embedden er selvstendig og statisk (ingen JS hos leserne), med URL-lenkede
// bilder (aldri base64), og beskyttes mot faktisk.no-stilene med
// FaktiskEmbedBase.isolate (shared/embed-tokens.js). Lange ord brytes
// (overflow-wrap) og tall holder fast bredde, så embedden aldri gjør siden
// bredere enn mobilskjermen. Forhåndsvisningen er NØYAKTIG embed-markupen.

const PLUGIN_ID = 'reaksjoner';
const SCOPE = 'fkrk';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const els = {
  title:       document.getElementById('titleInput'),
  subtitle:    document.getElementById('subtitleInput'),
  rowList:     document.getElementById('rowList'),
  addRowBtn:   document.getElementById('addRowBtn'),
  sortBtn:     document.getElementById('sortRowsBtn'),
  optLike:     document.getElementById('optLike'),
  optWord:     document.getElementById('optWord'),
  optQuotes:   document.getElementById('optQuotes'),
  optAutoNote: document.getElementById('optAutoNote'),
  imgSize:     document.getElementById('imgSizeSelect'),
  crop:        document.getElementById('cropSelect'),
  sourceText:  document.getElementById('sourceText'),
  previewHost: document.getElementById('previewHost'),
  copyEmbed:   document.getElementById('copyEmbedBtn'),
  back:        document.getElementById('backBtn'),
  full:        document.getElementById('fullscreenBtn'),
  openLabrador: document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

const state = {
  // Innlegg: { id, imgUrl, text, reactions, url }
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

// «854» → {n:854}; «2,4k» / «2.4K» / «ca. 2 400» → {n:2400, approx:true}
function parseReactions(v) {
  let s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  let approx = /\bca\.?|~|≈/.test(s);
  s = s.replace(/\bca\.?|~|≈|reaksjoner|reactions/g, '').trim();
  const k = s.match(/^([\d]+(?:[.,]\d+)?)\s*(k|tusen)$/);
  if (k) return { n: Math.round(parseFloat(k[1].replace(',', '.')) * 1000), approx: true };
  const m = s.match(/^([\d]+(?:[.,]\d+)?)\s*(m|mill\.?)$/);
  if (m) return { n: Math.round(parseFloat(m[1].replace(',', '.')) * 1e6), approx: true };
  const digits = s.replace(/[\s  .]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return { n: Math.round(parseFloat(digits)), approx };
}

// 2400 → «2&nbsp;400»
function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '&nbsp;');
}

const ARCHIVE_HOSTS = /(^|\.)(archive\.(ph|today|is|li|vn|fo|md)|web\.archive\.org|megalodon\.jp|ghostarchive\.org|perma\.cc|archive\.org)$/;

// Lenketekst ut fra adressen. Arkivtjenester som megalodon.jp har originaladressen
// inni sin egen — vi viser tjenestens navn, ikke Facebooks.
function linkInfo(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\.|^web\./, '');
    const shown = host === 'web.archive.org' ? 'web.archive.org' : host;
    if (ARCHIVE_HOSTS.test(new URL(url).hostname)) return { kind: 'Arkivert kopi', host: shown, archive: true };
    return { kind: 'Innlegget', host: shown, archive: false };
  } catch (e) { return null; }
}

// Fjern sporingskoder fra Facebook-lenker (__cft__, __tn__ m.fl. knytter lenken
// til økten til den som kopierte den). «?multi_permalinks=ID» blir /posts/ID/.
function cleanUrl(raw) {
  const s = String(raw || '').trim();
  if (!isValidUrl(s)) return s;
  const u = new URL(s);
  if (!/(^|\.)facebook\.com$/.test(u.hostname)) return s;
  const group = u.pathname.match(/^\/groups\/([^/]+)\/?$/);
  const mp = u.searchParams.get('multi_permalinks');
  if (group && mp && /^\d+$/.test(mp.split(',')[0])) {
    return `https://www.facebook.com/groups/${group[1]}/posts/${mp.split(',')[0]}/`;
  }
  [...u.searchParams.keys()].forEach(k => {
    if (/^__|^(hoisted_section_header_type|ref|mibextid|rdid|share_url)$/.test(k)) u.searchParams.delete(k);
  });
  return u.toString().replace(/\?$/, '');
}

const IMG_SIZES = {
  s: { d: 84, m: 68 },
  m: { d: 112, m: 84 },
  l: { d: 140, m: 100 },
};

// ============================================================
//  Innlegg
// ============================================================

function newRow(o = {}) {
  return {
    id: 'r_' + Math.random().toString(36).slice(2, 7),
    imgUrl: o.imgUrl || '',
    text: o.text || '',
    reactions: o.reactions || '',
    url: o.url || '',
  };
}

function addRow() {
  state.rows.push(newRow());
  renderRows();
  scheduleUpdate();
  const inputs = els.rowList.querySelectorAll('[data-act="text"]');
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

function hostLabel(r) {
  if (!r.url) return '';
  if (!isValidUrl(r.url)) return 'Ugyldig lenke';
  const li = linkInfo(r.url);
  return li ? `Lenketekst: «${li.kind} på ${li.host} ↗»` : '';
}

function renderRows() {
  els.rowList.innerHTML = '';
  state.rows.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'hk-row';
    card.innerHTML = `
      <div class="hk-row__top">
        <span class="hk-row__num">${i + 1}</span>
        <input class="hk-row__title" value="${escapeHtml(r.text)}"
               data-id="${r.id}" data-act="text" placeholder="Tekst — f.eks. Bør Imam Ali-moskéen lukkes?">
        <input class="ftb-value" value="${escapeHtml(r.reactions)}"
               data-id="${r.id}" data-act="reactions" placeholder="Reaksj." title="Antall reaksjoner — f.eks. 854 eller 2,4k">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" data-id="${r.id}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="tb-row__btn" data-act="down" data-id="${r.id}" title="Flytt ned" ${i === state.rows.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${r.id}" title="Slett innlegget">×</button>
        </span>
      </div>
      <input class="hk-row__img" value="${escapeHtml(r.url)}"
             data-id="${r.id}" data-act="url"
             placeholder="Lenke — arkivert kopi eller innlegget" spellcheck="false">
      <div class="rk-hostlabel" data-host="${r.id}">${escapeHtml(hostLabel(r))}</div>
      <input class="hk-row__img" value="${escapeHtml(r.imgUrl)}"
             data-id="${r.id}" data-act="img"
             placeholder="Bilde-URL fra Labrador (postbildet)" spellcheck="false">
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
    if (act === 'text') r.text = e.target.value;
    if (act === 'reactions') r.reactions = e.target.value;
    if (act === 'img') r.imgUrl = e.target.value.trim();
    if (act === 'url') {
      r.url = e.target.value.trim();
      const lab = els.rowList.querySelector(`[data-host="${r.id}"]`);
      if (lab) lab.textContent = hostLabel(r);
    }
    scheduleUpdate();
  };
  // Rens Facebook-sporingskoder når feltet forlates
  els.rowList.onchange = e => {
    if (e.target.dataset.act !== 'url') return;
    const r = state.rows.find(x => x.id === e.target.dataset.id);
    if (!r) return;
    const c = cleanUrl(r.url);
    if (c !== r.url) {
      r.url = c;
      e.target.value = c;
      const lab = els.rowList.querySelector(`[data-host="${r.id}"]`);
      if (lab) lab.textContent = hostLabel(r) + ' · sporingskoder fjernet';
      scheduleUpdate();
    }
  };
}

els.addRowBtn.addEventListener('click', addRow);

function sortRows() {
  state.rows.sort((a, b) => {
    const na = parseReactions(a.reactions), nb = parseReactions(b.reactions);
    if (!na && !nb) return 0;
    if (!na) return 1;
    if (!nb) return -1;
    return nb.n - na.n;
  });
  renderRows();
  scheduleUpdate();
}
els.sortBtn.addEventListener('click', sortRows);

document.getElementById('importBtn').addEventListener('click', () => {
  if (!window.FaktiskImport) return;
  FaktiskImport.openDialog({
    title: 'Importer innlegg',
    replaceLabel: 'Erstatt eksisterende innlegg',
    fields: [
      { key: 'text', label: 'Tekst / spørsmål', guess: /tekst|spørsmål|innlegg|tittel|text|post/i, required: true },
      { key: 'reactions', label: 'Reaksjoner', guess: /reaksj|reaction|likes|antall/i },
      { key: 'url', label: 'Lenke (valgfri)', guess: /lenke|link|url|arkiv/i },
      { key: 'imgUrl', label: 'Bilde-URL (valgfri)', guess: /bilde|img|image/i },
    ],
    onApply: (objs, o) => {
      const rows = objs.filter(x => String(x.text).trim()).map(x => newRow({
        text: String(x.text).trim(),
        reactions: String(x.reactions || '').trim(),
        url: cleanUrl(String(x.url || '').trim()),
        imgUrl: /^https?:\/\//.test(String(x.imgUrl || '').trim()) ? String(x.imgUrl).trim() : '',
      }));
      state.rows = o.replace ? rows : state.rows.concat(rows);
      renderRows(); scheduleUpdate();
    },
  });
});

// ============================================================
//  Bilder fra Labrador per innlegg — samme API som i Tabell
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
  return state.rows.filter(r => String(r.text || '').trim() || String(r.reactions || '').trim());
}

const LIKE_SVG = '<svg class="ik" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7z"/><path d="M7 10l4.2-6.3a1.6 1.6 0 0 1 2.9 1.1L13.4 9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.4 20H7"/></svg>';
const EMPTY_SVG = '<svg class="tom" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/></svg>';

function buildEmbedSnippet() {
  const raw = buildEmbedSnippetRaw();
  const iso = window.FaktiskEmbedBase && window.FaktiskEmbedBase.isolate;
  if (!iso) return raw;
  return raw.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => '<style>' + iso(css, SCOPE) + '</style>');
}

function buildEmbedSnippetRaw() {
  const rows = activeRows();
  const title = els.title.value.trim();
  const subtitle = els.subtitle.value.trim();
  const own = els.sourceText.value.trim();
  const showLike = els.optLike.checked;
  const showWord = els.optWord.checked;
  const quotes = els.optQuotes.checked;
  const size = IMG_SIZES[els.imgSize.value] || IMG_SIZES.m;
  const objPos = els.crop.value === 'center' ? '50% 50%' : '0 0';
  const hasImgCol = rows.some(r => r.imgUrl && isValidUrl(r.imgUrl));

  let anyApprox = false;
  const archives = [];

  const rowsHtml = rows.map((r, i) => {
    const url = isValidUrl(r.url) ? r.url : '';
    const li = url ? linkInfo(url) : null;
    if (li && li.archive && !archives.includes(li.host)) archives.push(li.host);

    const media = (r.imgUrl && isValidUrl(r.imgUrl))
      ? `<img src="${escapeHtml(r.imgUrl)}" alt="" loading="lazy">`
      : EMPTY_SVG;
    const thumb = !hasImgCol ? '' : (url
      ? `
        <a class="thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${media}</a>`
      : `
        <span class="thumb" aria-hidden="true">${media}</span>`);

    const p = parseReactions(r.reactions);
    if (p && p.approx) anyApprox = true;
    const num = p
      ? (p.approx ? '<small>ca.</small>' : '') + fmtNum(p.n)
      : escapeHtml(String(r.reactions || '').trim());
    const word = showWord ? `<span class="ord">${p && p.n === 1 ? 'reaksjon' : 'reaksjoner'}</span>` : '';
    const reak = num ? `
          <div class="reak">${showLike ? LIKE_SVG : ''}<span class="tall">${num}</span>${word}</div>` : '';

    const text = String(r.text || '').trim();
    const q = text ? `
          <div class="q">${quotes ? '«' : ''}${escapeHtml(text)}${quotes ? '»' : ''}</div>` : '';

    const link = li ? `
          <a class="lenke" href="${escapeHtml(url)}" target="_blank" rel="noopener">${li.kind} på <b>${escapeHtml(li.host)}&nbsp;↗</b></a>` : '';

    return `
      <!-- ▶ INNLEGG ${i + 1} -->
      <div class="rad" role="listitem">${thumb}
        <div class="info">${q}${reak}${link}
        </div>
      </div>`;
  }).join('');

  const notes = [];
  if (els.optAutoNote.checked) {
    if (anyApprox) notes.push('Facebook runder av antall reaksjoner over tusen.');
    if (archives.length) {
      const list = archives.length === 1 ? archives[0]
        : archives.slice(0, -1).join(', ') + ' og ' + archives[archives.length - 1];
      notes.push(`Arkiverte kopier er lagret på ${list}.`);
    }
  }
  if (own) notes.push(escapeHtml(own));
  const noteHtml = notes.length ? `
    <!-- ▶ MERKNAD -->
    <div class="note">${notes.join(' ')}</div>` : '';

  const head = [];
  if (title) head.push(`
    <!-- ▶ TITTEL -->
    <div class="fk-h3" role="heading" aria-level="3">${escapeHtml(title)}</div>`);
  if (subtitle) head.push(`
    <!-- ▶ INGRESS -->
    <div class="ing">${escapeHtml(subtitle)}</div>`);

  return `<!-- ============================================
     FAKTISK · REAKSJONER
     Endre tekst i feltene merket med ▶ — eller i Faktisk Studio.
     ============================================ -->
<div class="${SCOPE}">
  <style>
    .${SCOPE} { --ink:#212121; --muted:#6b6b6b; --line:#e4e4e4; --accent:#0050FC; --soft:#eef1f8;
      max-width: var(--lab_page_width, 720px); margin: 2rem auto; padding: 0 16px; }
    .fk-h3 { font-size: 1.25rem; line-height: 1.25; margin: 0 0 .35rem; font-weight: bold; }
    .ing { font-size: .95rem; line-height: 1.45; color: var(--muted); margin: 0 0 1.25rem; }
    .liste { border-top: 2px solid var(--ink); }
    .rad { display: flex; gap: 1.1rem; align-items: flex-start; padding: 1.1rem 0; border-bottom: 1px solid var(--line); }
    .thumb { flex: 0 0 auto; width: ${size.d}px; height: ${size.d}px; border-radius: 12px; overflow: hidden;
      background: var(--soft); display: flex; align-items: center; justify-content: center;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.06); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: ${objPos}; }
    .thumb .tom { width: 34px; height: 34px; fill: none; stroke: #9aa6c4; stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
    .info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: .55rem; }
    .q { font-size: 1.1rem; line-height: 1.3; font-weight: bold; overflow-wrap: anywhere; }
    .reak { display: flex; align-items: center; gap: .45rem; flex-wrap: wrap; }
    .ik { flex: 0 0 auto; width: 30px; height: 30px; padding: 6px; border-radius: 50%; background: var(--soft);
      fill: none; stroke: var(--accent); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
    .tall { font-size: 1.45rem; line-height: 1; font-weight: bold; white-space: nowrap; }
    .tall small { font-size: .6em; font-weight: normal; color: var(--muted); margin-right: .2em; }
    .ord { font-size: .9rem; color: var(--muted); }
    .lenke { align-self: flex-start; font-size: .85rem; line-height: 1.4; color: var(--accent);
      text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
    .lenke b { font-weight: bold; white-space: nowrap; }
    .lenke:hover { text-decoration-thickness: 2px; }
    .note { font-size: .8rem; line-height: 1.45; color: var(--muted); margin: .9rem 0 0; white-space: pre-line; }
    @media (max-width: 480px) {
      .rad { gap: .85rem; }
      .thumb { width: ${size.m}px; height: ${size.m}px; border-radius: 10px; }
      .q { font-size: 1rem; }
      .tall { font-size: 1.25rem; }
      .ik { width: 26px; height: 26px; padding: 5px; }
    }
  </style>${head.join('')}
  <div class="liste" role="list">${rowsHtml}
  </div>${noteHtml}
</div>
`;
}

function renderPreview() {
  const rows = activeRows();
  els.copyEmbed.disabled = rows.length === 0;
  if (!rows.length) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Legg til innlegg — forhåndsvisningen dukker opp her.</p>';
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
    title: els.title.value,
    subtitle: els.subtitle.value,
    rows: state.rows,
    showLike: els.optLike.checked,
    showWord: els.optWord.checked,
    quotes: els.optQuotes.checked,
    autoNote: els.optAutoNote.checked,
    imgSize: els.imgSize.value,
    crop: els.crop.value,
    sourceText: els.sourceText.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    els.title.value = s.title || '';
    els.subtitle.value = s.subtitle || '';
    els.sourceText.value = s.sourceText || '';
    if (typeof s.showLike === 'boolean') els.optLike.checked = s.showLike;
    if (typeof s.showWord === 'boolean') els.optWord.checked = s.showWord;
    if (typeof s.quotes === 'boolean') els.optQuotes.checked = s.quotes;
    if (typeof s.autoNote === 'boolean') els.optAutoNote.checked = s.autoNote;
    if (s.imgSize && IMG_SIZES[s.imgSize]) els.imgSize.value = s.imgSize;
    if (s.crop === 'center' || s.crop === 'top') els.crop.value = s.crop;
    if (Array.isArray(s.rows)) state.rows = s.rows.map(r => newRow(r)).map((r, i) => ({ ...r, id: s.rows[i].id || r.id }));
    renderRows();
    renderPreview();
  } finally {
    isRestoring = false;
  }
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.title, els.subtitle, els.sourceText].forEach(el => el.addEventListener('input', scheduleUpdate));
[els.optLike, els.optWord, els.optQuotes, els.optAutoNote, els.imgSize, els.crop]
  .forEach(el => el.addEventListener('change', scheduleUpdate));

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
    || `Reaksjoner ${new Date().toLocaleDateString('no')}`;
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
  // Tomt utgangspunkt: tre innlegg klare til utfylling
  addRow();
  addRow();
  addRow();
})();
