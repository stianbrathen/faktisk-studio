// Faktisk Studio · Metodeboks
//
// Faktaboks for metode og forbehold i samme stil som Tabell: stikktittel, tittel, undertittel,
// punkter med ikon (dokumentert / observert / vet ikke / info / forbehold / data / kilde) og kilde.
// Valgfri klode-illustrasjon: rolig prikkeklode med buer mellom land – enten fra → til (vektet),
// eller som et nettverk uten retning. Motoren (klode-runtime.js) er den samme i forhåndsvisning og embed.

const PLUGIN_ID = 'metodeboks';
(async () => {
  try {
    const [appV, plugins] = await Promise.all([window.faktisk.appVersion(), window.faktisk.pluginStatus()]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
  } catch (e) {}
})();

const $ = id => document.getElementById(id);
const FIELDS = ['kicker', 'tittel', 'under', 'kilde', 'fra', 'til'];
const state = { punkter: [], boks: 'hvit', klode: false, retning: 'fra' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderPts() {
  const list = $('ptList'); list.innerHTML = '';
  state.punkter.forEach((p, i) => {
    const r = document.createElement('div'); r.className = 'kk-acc'; r.dataset.i = i;
    const opts = Object.keys(MB_ICONS).map(k => `<option value="${k}" ${p.ikon === k ? 'selected' : ''}>${MB_ICONS[k].n}</option>`).join('');
    r.innerHTML = `
      <div class="mb-pt__top">
        <span class="hk-row__num">${i + 1}</span>
        <select class="project-select" data-act="ikon" title="Ikon">${opts}</select>
        <span class="ks-clip__btns">
          <button class="tb-row__btn" data-act="up" ${i === 0 ? 'disabled' : ''} title="Flytt opp">↑</button>
          <button class="tb-row__btn" data-act="down" ${i === state.punkter.length - 1 ? 'disabled' : ''} title="Flytt ned">↓</button>
          <button class="tb-row__btn tb-row__btn--del" data-act="del" title="Slett">×</button>
        </span>
      </div>
      <input class="tb-row__input" data-act="h" value="${esc(p.h)}" placeholder="Overskrift – f.eks. Dette har vi dokumentert">
      <textarea class="tb-row__input" data-act="t" rows="3" placeholder="Tekst">${esc(p.t)}</textarea>`;
    list.appendChild(r);
  });
}
$('ptList').addEventListener('input', e => {
  const r = e.target.closest('.kk-acc'); if (!r) return;
  const p = state.punkter[+r.dataset.i], act = e.target.dataset.act;
  if (act === 'h' || act === 't') { p[act] = e.target.value; schedule(); }
});
$('ptList').addEventListener('change', e => {
  const r = e.target.closest('.kk-acc'); if (!r || e.target.dataset.act !== 'ikon') return;
  state.punkter[+r.dataset.i].ikon = e.target.value; schedule();
});
$('ptList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.kk-acc').dataset.i, P = state.punkter;
  if (b.dataset.act === 'del') P.splice(i, 1);
  if (b.dataset.act === 'up' && i > 0) P.splice(i - 1, 0, P.splice(i, 1)[0]);
  if (b.dataset.act === 'down' && i < P.length - 1) P.splice(i + 1, 0, P.splice(i, 1)[0]);
  renderPts(); schedule();
});
$('addPtBtn').addEventListener('click', () => {
  const order = ['ok', 'obs', 'ukjent'];
  state.punkter.push({ ikon: order[state.punkter.length] || 'info', h: '', t: '' });
  renderPts(); schedule();
  const ins = $('ptList').querySelectorAll('[data-act="h"]'); if (ins.length) ins[ins.length - 1].focus();
});

FIELDS.forEach(f => $(f).addEventListener('input', () => { state[f] = $(f).value; schedule(); }));
$('boks').addEventListener('change', () => { state.boks = $('boks').value; schedule(); });
$('retning').addEventListener('change', () => { state.retning = $('retning').value; schedule(); });
$('klode').addEventListener('change', () => { state.klode = $('klode').checked; $('klodeOpts').hidden = !state.klode; schedule(); });

let tmr = null;
function schedule() { clearTimeout(tmr); tmr = setTimeout(() => { render(); save(); }, 350); }
function render() {
  const host = $('previewHost');
  const has = String(state.tittel || '').trim() || state.punkter.some(p => String(p.h || p.t || '').trim());
  $('copyEmbedBtn').disabled = !has;
  if (!has) { host.innerHTML = '<p class="ftb-empty">Skriv en tittel eller legg til punkter – forhåndsvisningen dukker opp her.</p>'; return; }
  const missing = mbRenderPreview(host, state);
  const w = $('missingWarn');
  w.hidden = !(state.klode && missing.length);
  if (!w.hidden) w.textContent = 'Fant ikke koordinater for: ' + missing.join(', ') + '. Bruk norske landnavn.';
}
$('copyEmbedBtn').addEventListener('click', async () => {
  const b = $('copyEmbedBtn'), orig = b.textContent;
  try { await window.faktisk.copyToClipboard(mbBuildSnippet(state)); b.textContent = '✅ Kopiert'; } catch (e) { b.textContent = 'Kunne ikke kopiere'; }
  setTimeout(() => { b.textContent = orig; }, 3000);
});
$('backBtn').addEventListener('click', () => window.faktisk.goHome());
$('fullscreenBtn').addEventListener('click', () => window.faktisk.toggleFullscreen());
$('openLabradorBtn').addEventListener('click', () => window.faktisk.openExternal('https://labrador.faktisk.no/'));

let restoring = false;
function apply(s) {
  restoring = true;
  Object.assign(state, { punkter: [], boks: 'hvit', klode: false, retning: 'fra' }, s || {});
  FIELDS.forEach(f => { $(f).value = state[f] || ''; });
  $('boks').value = state.boks; $('retning').value = state.retning; $('klode').checked = !!state.klode; $('klodeOpts').hidden = !state.klode;
  renderPts(); render();
  restoring = false;
}
function save() { if (!restoring) window.faktisk.stateSave(PLUGIN_ID, JSON.parse(JSON.stringify(state))).catch(() => {}); }
async function refreshProjects() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID); if (!res.ok) return;
    const sel = $('projectSelect'); while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => { const o = document.createElement('option'); o.value = p.fileId; o.textContent = p.name; sel.appendChild(o); });
  } catch (e) {}
}
$('saveProjectBtn').addEventListener('click', async () => {
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', (state.tittel || 'Metodeboks').slice(0, 40));
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), JSON.parse(JSON.stringify(state)));
  if (res.ok) refreshProjects();
});
$('projectSelect').addEventListener('change', async () => {
  const id = $('projectSelect').value; if (!id) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, id);
  if (res.ok && res.state) apply(res.state);
});

$('demoBtn').addEventListener('click', async () => {
  if (state.punkter.some(p => String(p.h || p.t || '').trim()) && !(await window.faktiskDialog.confirm('Erstatte innholdet som ligger inne nå?'))) return;
  apply({
    kicker: 'Metode', tittel: 'Slik har vi undersøkt nettverket', under: 'Dette viser kartleggingen – og dette vet vi fortsatt ikke.',
    punkter: [
      { ikon: 'ok', h: 'Dette har vi dokumentert', t: 'Facebook-kontoer deler eller promoterer hverandres innhold. Flere publiserer politiske innlegg i grupper på tvers av landegrenser.' },
      { ikon: 'obs', h: 'Dette har vi observert', t: 'Innleggene har fellestrekk i språk, utforming og tematikk. Enkelte kontoer publiserer svært hyppig, og deler av innholdet fremstår som KI-generert.' },
      { ikon: 'ukjent', h: 'Dette vet vi ikke', t: 'Hvem som kontrollerer alle kontoene, om de styres samlet, eller hva hensikten med aktiviteten er.' },
    ],
    kilde: 'Kilde: Faktisk.nos egen kartlegging av Facebook-aktivitet.', boks: 'hvit', klode: true,
    fra: 'Pakistan (20), Spania (6), Tyskland (5), USA (4), Filippinene (3)', til: 'Norge, Danmark, Tyskland, Australia', retning: 'fra',
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
  apply({ kicker: 'Metode', punkter: [{ ikon: 'ok', h: '', t: '' }, { ikon: 'obs', h: '', t: '' }, { ikon: 'ukjent', h: '', t: '' }] });
})();
