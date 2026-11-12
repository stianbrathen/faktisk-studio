// Faktisk Studio · Bevissikring — Chrome-utvidelsen (lastes etter main.js)
//
// Viser koble-koden utvidelsen trenger, holder Studio oppdatert på hvilket
// arkiv og hvilken sak nedlastinger fra Chrome skal havne i, og oppdaterer
// lista når en jobb fra Chrome blir ferdig.

(function () {
  const api = window.faktisk;
  const $ = id => document.getElementById(id);
  if (typeof api.bevisLinkStatus !== 'function') { const b = $('linkBlock'); if (b) b.hidden = true; return; }

  const el = { info: $('linkInfo'), token: $('linkToken'), copy: $('linkCopyBtn'), renew: $('linkNewBtn'), ext: $('linkExtBtn') };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let jobs = [];
  let sent = { root: null, caseName: null };

  function ago(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    return s < 60 ? 'nå nettopp' : s < 3600 ? Math.round(s / 60) + ' min siden' : new Date(iso).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  async function render() {
    const st = await api.bevisLinkStatus();
    el.token.textContent = st.token;
    jobs = st.jobs || jobs;
    const active = jobs.filter(j => j.status === 'i kø' || j.status === 'kjører').length;
    const last = jobs[0];
    el.info.innerHTML =
      (st.running ? 'Klar for utvidelsen' + (st.lastSeen ? ' · sist i kontakt ' + esc(ago(st.lastSeen)) : '') : '<span class="bv-warnline">Ikke tilgjengelig: ' + esc(st.error || 'starter …') + '</span>') +
      (active ? '<br>Fra Chrome: ' + active + ' jobb' + (active > 1 ? 'er' : '') + ' pågår' : '') +
      (!active && last ? '<br>Siste fra Chrome: ' + esc((last.title || last.url).slice(0, 50)) + ' — ' + esc(last.status) + (last.error ? ' (' + esc(last.error.slice(0, 80)) + ')' : '') : '');
  }

  // Studio må vite arkiv og sak når utvidelsen sender noe uten å oppgi sak
  function syncConfig() {
    const root = state.root || '', caseName = els.caseInput.value.trim();
    if (root === sent.root && caseName === sent.caseName) return;
    sent = { root, caseName };
    api.bevisLinkConfig({ root, caseName }).catch(() => {});
  }
  setInterval(syncConfig, 2000);

  el.copy.addEventListener('click', async () => {
    await api.copyToClipboard(el.token.textContent);
    el.copy.textContent = 'Kopiert ✓';
    setTimeout(() => { el.copy.textContent = 'Kopier'; }, 1800);
  });
  el.renew.addEventListener('click', async () => {
    const ok = await window.faktiskDialog.confirm('Lage ny koble-kode? Utvidelsen må da få den nye koden før den virker igjen.', true);
    if (!ok) return;
    await api.bevisLinkNewToken();
    render();
  });
  el.ext.addEventListener('click', async () => {
    syncConfig();
    const r = await api.bevisLinkExtension();
    if (r.ok) setStatus('Utvidelsen ligger i Finder. I Chrome: chrome://extensions → Utviklermodus → «Last inn upakket» → velg mappa.', 'ok');
    else setStatus('Fant ikke utvidelsen: ' + r.error, 'err');
  });

  if (api.onBevisJobs) api.onBevisJobs(list => { jobs = list || []; render(); });
  if (api.onBevisLibraryChanged) api.onBevisLibraryChanged(() => { refresh(); });
  if (api.onBevisLinkChanged) api.onBevisLinkChanged(() => render());

  setTimeout(() => { syncConfig(); render(); }, 300);
  setInterval(render, 15000);
})();
