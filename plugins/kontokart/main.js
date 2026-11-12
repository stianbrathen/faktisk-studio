// Faktisk Studio · Kontokart
//
// Én kontoliste, to visninger:
//   • Tabell med klode – «Her befinner administratorene seg»: kontoer med adminland som merkelapper,
//     to målinger side om side, «Vis alle», og en klode som snurrer (kan dras) med piller per land.
//   • Verdenskart – adminland → gruppene innholdet er rettet mot, innlegg som glir langs buene,
//     klikkbare kontoer, og eksempelkontoer med egen tekst og egne mål-grupper.
// Motorene (kart-runtime.js, klode-runtime.js) og embed-byggeren (snippet.js) er de samme i
// forhåndsvisningen og i embedden. Ingen medier – bare data, så ingen Labrador-opplasting trengs.

const PLUGIN_ID = 'kontokart';
(async () => {
  try {
    const [appV, plugins] = await Promise.all([window.faktisk.appVersion(), window.faktisk.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const $ = id => document.getElementById(id);
const TEXT_FIELDS = ['tittel', 'ingress', 'klodeNote', 'labelA', 'labelB', 'visRader', 'tabellNote', 'kartHint', 'klodeHint', 'kartLegendAdmin', 'kartKilde', 'enhet'];
const state = { view: 'tabell', accounts: [], targets: [], mainTarget: 0, klode: true };
const uid = () => 'a_' + Math.random().toString(36).slice(2, 8);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function defaultTargets() {
  return [
    { navn: 'Norske Facebook-grupper', kort: 'Norske grupper', land: 'Norge' },
    { navn: 'Danske grupper', kort: 'Danske', land: 'Danmark' },
    { navn: 'Tyske grupper', kort: 'Tyske', land: 'Tyskland' },
    { navn: 'Australske grupper', kort: 'Australske', land: 'Australia' },
  ];
}

// ---------- Kontoer ----------
function newAccount(o) { return Object.assign({ id: '', navn: '', landA: '', landB: '', eksempel: false, eksempelTekst: '', grupper: [] , _k: uid() }, o || {}); }

function renderAccounts() {
  const list = $('accList');
  $('accCount').textContent = state.accounts.length ? '(' + state.accounts.length + ')' : '';
  list.innerHTML = '';
  state.accounts.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'kk-acc' + (a.eksempel ? ' is-ex' : '');
    const tg = state.targets.map((t, ti) => `<label class="kk-g"><input type="checkbox" data-act="g" data-ti="${ti}" ${a.grupper.includes(ti) ? 'checked' : ''}><span>${esc(t.kort || t.navn)}</span></label>`).join('');
    row.innerHTML = `
      <div class="kk-acc__top">
        <span class="hk-row__num">${i + 1}</span>
        <input class="tb-row__input kk-navn" data-act="navn" value="${esc(a.navn)}" placeholder="Kontonavn">
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" ${i === 0 ? 'disabled' : ''} title="Flytt opp">↑</button>
          <button class="tb-row__btn" data-act="down" ${i === state.accounts.length - 1 ? 'disabled' : ''} title="Flytt ned">↓</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" title="Slett">×</button>
        </span>
      </div>
      <input class="tb-row__input" data-act="id" value="${esc(a.id)}" placeholder="Facebook-ID (valgfri)" spellcheck="false">
      <div class="kk-two">
        <input class="tb-row__input" data-act="landA" value="${esc(a.landA)}" placeholder="Adminland, f.eks. Pakistan (3), Spania">
        <input class="tb-row__input" data-act="landB" value="${esc(a.landB)}" placeholder="2. måling (valgfri)">
      </div>
      <label class="ks-check kk-excheck"><input type="checkbox" data-act="eksempel" ${a.eksempel ? 'checked' : ''}><span>Eksempel – fremhev i kartet</span></label>
      <div class="kk-ex" ${a.eksempel ? '' : 'hidden'}>
        <textarea class="tb-row__input" data-act="eksempelTekst" rows="2" placeholder="Tekst som vises når kontoen er valgt">${esc(a.eksempelTekst)}</textarea>
        <div class="kk-gs"><span class="kk-gs__lab">Poster i:</span>${tg}</div>
      </div>`;
    row.dataset.i = i;
    list.appendChild(row);
  });
}
$('accList').addEventListener('input', e => {
  const row = e.target.closest('.kk-acc'); if (!row) return;
  const a = state.accounts[+row.dataset.i], act = e.target.dataset.act;
  if (['navn', 'id', 'landA', 'landB', 'eksempelTekst'].includes(act)) { a[act] = e.target.value; schedule(); }
});
$('accList').addEventListener('change', e => {
  const row = e.target.closest('.kk-acc'); if (!row) return;
  const a = state.accounts[+row.dataset.i], act = e.target.dataset.act;
  if (act === 'eksempel') { a.eksempel = e.target.checked; renderAccounts(); schedule(); }
  if (act === 'g') { const ti = +e.target.dataset.ti; a.grupper = e.target.checked ? a.grupper.concat(ti) : a.grupper.filter(x => x !== ti); schedule(); }
});
$('accList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.kk-acc').dataset.i, act = b.dataset.act;
  if (act === 'del') state.accounts.splice(i, 1);
  if (act === 'up' && i > 0) state.accounts.splice(i - 1, 0, state.accounts.splice(i, 1)[0]);
  if (act === 'down' && i < state.accounts.length - 1) state.accounts.splice(i + 1, 0, state.accounts.splice(i, 1)[0]);
  renderAccounts(); schedule();
});
$('addAccBtn').addEventListener('click', () => {
  state.accounts.push(newAccount()); renderAccounts(); schedule();
  const ins = $('accList').querySelectorAll('.kk-navn'); if (ins.length) ins[ins.length - 1].focus();
});

// ---------- Lim inn fra regneark / tabell ----------
function parsePasted(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    let cells = line.split('\t').map(s => s.trim());
    if (cells.length < 2) cells = line.split(/\s{3,}|\s\|\s/).map(s => s.trim());
    if (/^navn\b/i.test(cells[0])) return;                       // overskriftsrad
    let navn = cells[0], id = '', A = '', B = '';
    const m = navn.match(/^(.*?)\s*\((\d{6,})\)\s*$/);
    if (m) { navn = m[1]; id = m[2]; A = cells[1] || ''; B = cells[2] || ''; }
    else if (/^\d{6,}$/.test(cells[1] || '')) { id = cells[1]; A = cells[2] || ''; B = cells[3] || ''; }
    else { A = cells[1] || ''; B = cells[2] || ''; }
    out.push(newAccount({ navn, id, landA: A, landB: B }));
  });
  return out;
}
$('pasteBtn').addEventListener('click', () => { const p = $('pastePanel'); p.hidden = !p.hidden; if (!p.hidden) $('pasteText').focus(); });
$('pasteApply').addEventListener('click', () => {
  const rows = parsePasted($('pasteText').value);
  if (!rows.length) return;
  state.accounts = $('pasteReplace').checked ? rows : state.accounts.concat(rows);
  $('pasteText').value = ''; $('pastePanel').hidden = true;
  renderAccounts(); schedule();
});

// ---------- Importer fil (Excel .xlsx, CSV, TSV) – felles dialog i shared/fk-import.js ----------
$('importBtn').addEventListener('click', () => {
  FaktiskImport.openDialog({
    title: 'Importer kontoer',
    replaceLabel: 'Erstatt eksisterende kontoer',
    fields: [
      { key: 'navn', label: 'Kontonavn', guess: /navn|konto|side|name|profil/i, required: true },
      { key: 'id', label: 'Facebook-ID', guess: /\bid\b|facebook-id|fb-id/i },
      { key: 'landA', label: 'Adminland (måling 1)', guess: /publiser|adminland|land|country|lokasjon/i },
      { key: 'landB', label: 'Adminland (måling 2)', guess: /initiell|analyse|første|måling 2|2\./i },
    ],
    onApply: (objs, o) => {
      const rows = objs.filter(x => String(x.navn).trim()).map(x => {
        let navn = String(x.navn).trim(), id = String(x.id || '').trim();
        const m = navn.match(/^(.*?)\s*\((\d{6,})\)\s*$/);
        if (m && !id) { navn = m[1]; id = m[2]; }
        return newAccount({ navn, id, landA: x.landA, landB: x.landB });
      });
      state.accounts = o.replace ? rows : state.accounts.concat(rows);
      renderAccounts(); schedule();
    },
  });
});

// ---------- Mål-grupper ----------
function renderTargets() {
  const box = $('targetList'); box.innerHTML = '';
  state.targets.forEach((t, i) => {
    const r = document.createElement('div'); r.className = 'kk-target'; r.dataset.i = i;
    r.innerHTML = `
      <label class="kk-main" title="Hovedgruppe"><input type="radio" name="kkMain" data-act="main" ${i === state.mainTarget ? 'checked' : ''}><span>●</span></label>
      <input class="tb-row__input" data-act="navn" value="${esc(t.navn)}" placeholder="Navn, f.eks. Danske grupper">
      <input class="tb-row__input kk-short" data-act="kort" value="${esc(t.kort)}" placeholder="Kort (mobil)">
      <input class="tb-row__input kk-short" data-act="land" value="${esc(t.land)}" placeholder="Land">
      <button class="tb-row__btn tb-row__btn--del" data-act="del" title="Slett">×</button>`;
    box.appendChild(r);
  });
}
$('targetList').addEventListener('input', e => {
  const r = e.target.closest('.kk-target'); if (!r) return;
  const t = state.targets[+r.dataset.i], act = e.target.dataset.act;
  if (['navn', 'kort', 'land'].includes(act)) { t[act] = e.target.value; schedule(); if (act !== 'land') renderAccountsSoon(); }
});
$('targetList').addEventListener('change', e => {
  const r = e.target.closest('.kk-target'); if (r && e.target.dataset.act === 'main') { state.mainTarget = +r.dataset.i; schedule(); }
});
$('targetList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act="del"]'); if (!b) return;
  const i = +b.closest('.kk-target').dataset.i;
  state.targets.splice(i, 1);
  state.accounts.forEach(a => { a.grupper = a.grupper.filter(x => x !== i).map(x => x > i ? x - 1 : x); });
  if (state.mainTarget >= state.targets.length) state.mainTarget = 0; else if (state.mainTarget > i) state.mainTarget--;
  renderTargets(); renderAccounts(); schedule();
});
$('addTargetBtn').addEventListener('click', () => { state.targets.push({ navn: '', kort: '', land: '' }); renderTargets(); renderAccounts(); });
let accT = null; function renderAccountsSoon() { clearTimeout(accT); accT = setTimeout(renderAccounts, 600); }

// ---------- Visning ----------
document.querySelectorAll('.kk-tab').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; syncView(); schedule(); }));
function syncView() {
  document.querySelectorAll('.kk-tab').forEach(b => b.classList.toggle('is-on', b.dataset.view === state.view));
  document.querySelectorAll('.kk-view').forEach(v => { v.hidden = v.dataset.for.split(' ').indexOf(state.view) < 0; });
  $('kartHint').hidden = state.view !== 'kart'; $('klodeHint').hidden = state.view !== 'klode';
  syncHintPlaceholders();
}
// 0.2.1: verdenskart og nettverksklode deler hjelpeteksten – står det bare tekst i det ene feltet,
// brukes den i begge visningene. Plassholderen viser hva som faktisk blir brukt.
function syncHintPlaceholders() {
  const k = (state.kartHint || '').trim(), g = (state.klodeHint || '').trim();
  $('kartHint').placeholder = g ? 'Samme som nettverkskloden: ' + g.replace(/\s*·\s*Dra[^·]*$/i, '') : 'Tekst over knappene: Trykk på en konto for å …';
  $('klodeHint').placeholder = k ? 'Samme som verdenskartet: ' + kkKlodeHint({ kartHint: k }) : 'Tekst over knappene: ' + KK_KLODE_HINT;
}
TEXT_FIELDS.forEach(f => $(f).addEventListener('input', () => { state[f] = $(f).value; if (f === 'kartHint' || f === 'klodeHint') syncHintPlaceholders(); schedule(); }));
$('klode').addEventListener('change', () => { state.klode = $('klode').checked; schedule(); });

// ---------- Forhåndsvisning + embed ----------
let tmr = null;
function schedule() { clearTimeout(tmr); tmr = setTimeout(() => { render(); save(); }, 350); }
function render() {
  const host = $('previewHost');
  const has = state.accounts.some(a => String(a.navn || '').trim());
  $('copyEmbedBtn').disabled = !has;
  if (!has) { host.innerHTML = '<p class="ftb-empty">Legg inn kontoer – forhåndsvisningen dukker opp her.</p>'; $('missingWarn').hidden = true; return; }
  const M = kkRenderPreview(host, state, state.view);
  const w = $('missingWarn');
  if (M.missing.length) { w.hidden = false; w.textContent = 'Fant ikke koordinater for: ' + M.missing.join(', ') + '. Sjekk skrivemåten (norske navn, f.eks. «Tyskland», «Storbritannia»).'; }
  else w.hidden = true;
}
$('copyEmbedBtn').addEventListener('click', async () => {
  const b = $('copyEmbedBtn'), orig = b.textContent;
  try {
    await window.faktisk.copyToClipboard(kkBuildSnippet(state, state.view));
    b.textContent = '✅ Kopiert (' + ({ kart: 'verdenskart', klode: 'nettverksklode' }[state.view] || 'tabell med klode') + ')';
  } catch (e) { b.textContent = 'Kunne ikke kopiere'; }
  setTimeout(() => { b.textContent = orig; }, 3500);
});
$('backBtn').addEventListener('click', () => window.faktisk.goHome());
$('fullscreenBtn').addEventListener('click', () => window.faktisk.toggleFullscreen());
$('openLabradorBtn').addEventListener('click', () => window.faktisk.openExternal('https://labrador.faktisk.no/'));

// ---------- Lagring ----------
let restoring = false;
function serialize() {
  const s = JSON.parse(JSON.stringify(state));
  s.accounts.forEach(a => { delete a._k; delete a._A; delete a._B; });
  return s;
}
function apply(s) {
  if (!s) return;
  restoring = true;
  Object.assign(state, { view: 'tabell', accounts: [], targets: defaultTargets(), mainTarget: 0, klode: true }, s);
  state.accounts = (state.accounts || []).map(a => newAccount(a));
  TEXT_FIELDS.forEach(f => { $(f).value = state[f] != null ? state[f] : (f === 'visRader' ? 8 : ''); });
  $('klode').checked = state.klode !== false;
  syncView(); renderTargets(); renderAccounts(); render();
  restoring = false;
}
function save() { if (!restoring) window.faktisk.stateSave(PLUGIN_ID, serialize()).catch(() => {}); }

async function refreshProjects() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID); if (!res.ok) return;
    const sel = $('projectSelect'); while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => { const o = document.createElement('option'); o.value = p.fileId; o.textContent = p.name; sel.appendChild(o); });
  } catch (e) {}
}
$('saveProjectBtn').addEventListener('click', async () => {
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', (state.tittel || 'Kontokart ' + new Date().toLocaleDateString('no')).slice(0, 40));
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serialize());
  if (res.ok) refreshProjects();
});
$('projectSelect').addEventListener('change', async () => {
  const id = $('projectSelect').value; if (!id) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, id);
  if (res.ok && res.state) apply(res.state);
});

// ---------- Eksempeldata: Facebook-nettverket (Faktisk.no, nov. 2026) ----------
const DEMO_TSV = [
  'Muhammad Affan (100095091117030)\tPakistan (3), Spania, USA\tPakistan (2), Spania, USA',
  'Deutschland Entdeckt (61550722962533)\t1 ukjent\tPakistan (2)',
  'BallsAnimation (61551025701635)\tPakistan, Tyskland, USA\tPakistan, Tyskland, USA',
  'Ymirr (61584788783786)\tTyskland\tPakistan, Tyskland, Spania',
  'VoxTerra World / Lilac Lohengrin (61590976500872)\tTyskland (2), Pakistan\tTyskland (2), Pakistan',
  'nyrt.com (61589454252314)\tPakistan, Tyskland\tPakistan, Tyskland',
  'Danmark Først (61590165255686)\tPakistan\tPakistan',
  'qryn.com (61589357746218)\tPakistan (2), Spania, Filippinene\tSpania (2), Tyskland, Filippinene',
  'Norge Først (61590370810921)\tPakistan, Spania, Filippinene\tSpania, Filippinene, + 1 ukjent',
  'Danske Stemmer (61590749973331)\tPakistan, Spania, Filippinene\tSpania, Filippinene, + 1 ukjent',
  'Danmark Nyheder (61592044193256)\tPakistan (2)\tTyskland',
  'Lianz (61585855296604)\tPakistan (3), USA\tUSA',
  'Arion Dio (61573240436443)\tSpania\tIngen oppgitt',
  'Helurez (61590996562656)\tIngen oppgitt\tIngen oppgitt',
  'Iveryaw (61591386384815)\tPakistan\tIngen oppgitt',
  'Fluffys Crumbles (61558470587201)\tIngen oppgitt\tIngen oppgitt',
  'Reise von Dänemark nach Deutschland (61591489217207)\tPakistan\tIngen oppgitt',
  'Flüstern der Grauen Stille (61558747150568)\tIngen stedsdata fra Facebook\tIngen stedsdata fra Facebook',
  'Kendra Matthies (100090134711758)\tSpania\tIkke innhentet (ingen rådata)',
].join('\n');
$('demoBtn').addEventListener('click', async () => {
  if (state.accounts.length && !(await window.faktiskDialog.confirm('Erstatte kontoene som ligger inne nå?'))) return;
  const acc = parsePasted(DEMO_TSV);
  const l = acc.find(a => a.navn === 'Lianz');
  if (l) { l.eksempel = true; l.grupper = [0, 1, 2, 3]; l.eksempelTekst = 'Profilen spiller på tysk identitet, men administratorene er i Pakistan og USA. Kontoen poster aktivt i norske, danske, tyske og australske grupper.'; }
  apply({
    view: state.view, accounts: acc, targets: defaultTargets(), mainTarget: 0, klode: true,
    tittel: 'Her befinner administratorene seg',
    ingress: 'Land Facebooks sidetransparens oppgir for personer med tilgang til kontoene i nettverket. Tall viser antall administratorer i landet.',
    klodeNote: 'Dra i kloden for å snurre den. Tallet i hver merkelapp er antall administratorer i landet ved publisering, summert for kontoene i tabellen.',
    labelA: 'Ved publisering', labelB: 'Første analyse', visRader: 8,
    tabellNote: 'Redaksjonen merket at Facebook ga forskjellige data på forskjellige tidspunkt. Facebook-ID står under kontonavnet.',
    kartHint: 'Trykk på en konto for å se hvor administratorene befinner seg',
    kartKilde: 'Adminland ved publisering ifølge Facebooks sidetransparens. Stedet viser ikke nødvendigvis hvor innleggene publiseres fra. Kilde: Faktisk.no',
  });
  save();
});

(async function init() {
  await refreshProjects();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending); localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) { const res = await window.faktisk.projectLoad(pluginId, fileId); if (res.ok && res.state) { apply(res.state); $('projectSelect').value = fileId; return; } }
    } catch (e) {}
  }
  try { const res = await window.faktisk.stateLoad(PLUGIN_ID); if (res.ok && res.state) { apply(res.state); return; } } catch (e) {}
  apply({ targets: defaultTargets() });
})();
