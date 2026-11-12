// Faktisk Studio — forsiden: søk, kategorier, sist brukte dokumenter og
// installerte plugins gruppert etter hva man lager. Data om gruppene og
// tegningene ligger i hub-catalog.js. Kalles fra renderHub() i app.js.
(function () {
  const { ART, GROUPS, TAG, CATS } = window.HUB_CATALOG;
  const GENERIC = '<rect x="20" y="10" width="80" height="52" rx="8" fill="rgba(255,255,255,.28)"/><rect x="20" y="10" width="80" height="52" rx="8" stroke="#fff" stroke-width="2.2" fill="none"/><path d="M40 36h40M60 26v20" stroke="#fff" stroke-width="3" stroke-linecap="round"/>';

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const ui = {
    q: '', cat: 'alle', kind: 'alle', favOnly: false,
    view: load('hub-view', 'kort'),
    favs: new Set(load('hub-favs', [])),
    closed: new Set(load('hub-closed', [])),
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hi = (s, q) => !q ? esc(s) : esc(s).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
  const svg = id => `<svg viewBox="0 0 120 72" aria-hidden="true">${ART[id] || GENERIC}</svg>`;
  const when = iso => {
    const d = new Date(iso); if (isNaN(d)) return '';
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    if (days === 0) return 'i dag ' + d.toTimeString().slice(0, 5);
    if (days === 1) return 'i går';
    if (days < 7) return d.toLocaleDateString('nb-NO', { weekday: 'long' });
    return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
  };

  let host, items = [], names = {};

  // Installerte plugins plasseres i katalogens grupper; ukjente havner i «Andre»
  function buildItems(installed) {
    const byId = new Map(installed.map(p => [p.id, p]));
    names = Object.fromEntries(installed.map(p => [p.id, p.name || p.id]));
    const known = new Set();
    const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(it => {
      known.add(it[0]);
      return byId.has(it[0]) || it[5] === 'soon';
    }).map(it => {
      const p = byId.get(it[0]);
      return { id: it[0], name: (p && p.name) || it[1], desc: it[2], kind: it[3], kw: it[4], soon: !p && it[5] === 'soon' };
    }) }));
    const rest = installed.filter(p => !known.has(p.id)).map(p => ({
      id: p.id, name: p.name || p.id, desc: (p.description || '').split(/(?<=\.)\s/)[0], kind: p.media === 'labrador' ? 'embed' : 'fil', kw: p.category || '',
    }));
    if (rest.length) groups.push({ id: 'andre', title: 'Andre', sub: 'Plugins som ikke er sortert ennå', items: rest });
    return groups;
  }

  function matches(it, cat = ui.cat) {
    if (ui.kind === 'embed' && it.kind !== 'embed') return false;
    if (ui.kind === 'fil' && it.kind === 'embed') return false;
    if (ui.favOnly && !ui.favs.has(it.id)) return false;
    if (cat !== 'alle') { const c = CATS.find(c => c.id === cat); if (!c || !c.ids.has(it.id)) return false; }
    return !ui.q || (it.name + ' ' + it.desc + ' ' + it.kw).toLowerCase().includes(ui.q);
  }

  function open(it) {
    if (it.soon) { window.faktiskDialog.alert('«' + it.name + '» kommer i en senere versjon.'); return; }
    window.openPlugin(it.id);
  }

  function star(it) {
    const b = document.createElement('button');
    b.className = 'hub-star'; b.type = 'button'; b.title = 'Favoritt';
    b.setAttribute('aria-label', 'Favoritt: ' + it.name); b.setAttribute('aria-pressed', String(ui.favs.has(it.id)));
    b.textContent = ui.favs.has(it.id) ? '★' : '☆';
    b.addEventListener('click', e => {
      e.stopPropagation();
      ui.favs.has(it.id) ? ui.favs.delete(it.id) : ui.favs.add(it.id);
      store('hub-favs', [...ui.favs]); renderGroups();
    });
    return b;
  }

  function renderCats() {
    const all = items.flatMap(g => g.items);
    const el = host.querySelector('#hubCats');
    el.innerHTML = [['alle', 'Alle'], ...CATS.map(c => [c.id, c.label])]
      .map(([id, label]) => [id, label, all.filter(it => matches(it, id)).length])
      .filter(([id, , n]) => id === 'alle' || n || ui.cat === id)
      .map(([id, label, n]) => `<button class="hub-chip" type="button" data-c="${id}" aria-pressed="${ui.cat === id}">${esc(label)}<small>${n}</small></button>`).join('');
    el.querySelectorAll('.hub-chip').forEach(b => b.addEventListener('click', () => { ui.cat = b.dataset.c; renderGroups(); }));
  }

  function renderGroups() {
    renderCats();
    const box = host.querySelector('#hubGroups'); box.innerHTML = '';
    const filtered = ui.q || ui.cat !== 'alle' || ui.favOnly || ui.kind !== 'alle';
    let total = 0;
    for (const g of items) {
      const list = g.items.filter(it => matches(it));
      if (!list.length) continue;
      total += list.length;
      const closed = !filtered && ui.closed.has(g.id);
      const sec = document.createElement('section');
      sec.className = 'hub-group'; sec.dataset.closed = closed;
      sec.innerHTML = `<button class="hub-group__head" type="button" aria-expanded="${!closed}"><span class="hub-caret">▾</span><h2>${esc(g.title)}</h2><span>${esc(g.sub)} · ${list.length}</span></button>`;
      sec.firstChild.addEventListener('click', () => {
        ui.closed.has(g.id) ? ui.closed.delete(g.id) : ui.closed.add(g.id);
        store('hub-closed', [...ui.closed]); renderGroups();
      });
      const wrap = document.createElement('div');
      wrap.className = ui.view === 'liste' ? 'hub-list' : 'hub-grid';
      if (closed) wrap.hidden = true;
      for (const it of list) {
        const tags = `<span class="hub-tag ${TAG[it.kind] ? TAG[it.kind][1].replace('tag--', 'hub-tag--') : ''}">${esc((TAG[it.kind] || ['Verktøy'])[0])}</span>${it.soon ? ' <span class="hub-tag hub-tag--soon">Kommer</span>' : ''}`;
        const el = document.createElement('div');
        el.tabIndex = 0; el.setAttribute('role', 'button');
        el.title = it.desc;
        if (ui.view === 'liste') {
          el.className = 'hub-row' + (it.soon ? ' hub-row--soon' : '');
          el.innerHTML = `<div class="hub-row__art">${svg(it.id)}</div><div class="hub-row__name">${hi(it.name, ui.q)}</div><div class="hub-row__desc">${hi(it.desc, ui.q)}</div><div>${tags}</div>`;
        } else {
          el.className = 'hub-card' + (it.soon ? ' hub-card--soon' : '');
          el.innerHTML = `<div class="hub-card__art">${svg(it.id)}</div><div class="hub-card__body"><div class="hub-card__name">${hi(it.name, ui.q)}</div><div class="hub-card__desc">${hi(it.desc, ui.q)}</div><div class="hub-card__foot">${tags}</div></div>`;
        }
        if (!it.soon) el.appendChild(star(it));
        el.addEventListener('click', () => open(it));
        el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(it); } });
        wrap.appendChild(el);
      }
      sec.appendChild(wrap);
      box.appendChild(sec);
    }
    if (!total) {
      box.innerHTML = ui.favOnly && !ui.q && ui.cat === 'alle'
        ? '<div class="hub-empty">Ingen favoritter ennå. Hold pekeren over et kort og trykk på stjernen.</div>'
        : `<div class="hub-empty">Ingen plugins passer${ui.q ? ' «' + esc(ui.q) + '»' : ''} med disse valgene. Prøv «Alle» eller et annet søkeord.</div>`;
    }
  }

  async function renderRecent() {
    const box = host.querySelector('#hubRecent');
    let docs = [];
    try { docs = (window.faktisk.documentRecent && await window.faktisk.documentRecent()) || []; } catch (e) {}
    if (!docs.length) {
      box.innerHTML = '<p class="hub-recent__empty">Dokumenter du lagrer med Arkiv → Lagre (⌘S) dukker opp her.</p>';
      return;
    }
    box.innerHTML = docs.slice(0, 5).map((d, i) =>
      `<button class="hub-doc" type="button" data-i="${i}" title="${esc(d.path)}">${svg(d.pluginId)}<div style="min-width:0"><strong>${esc(d.name)}</strong><span>${esc(names[d.pluginId] || d.pluginId)}</span></div><time>${esc(when(d.openedAt))}</time></button>`).join('');
    box.querySelectorAll('.hub-doc').forEach(b => b.addEventListener('click', () => window.faktisk.documentOpen(docs[+b.dataset.i].path)));
  }

  window.renderNewHub = async function (mount) {
    host = mount;
    let installed = [];
    try { installed = await window.faktisk.listPlugins(); } catch (e) { console.error('Kunne ikke hente plugins:', e); }
    items = buildItems(installed);
    host.classList.add('hub');
    host.innerHTML = `
      <section class="hub-lead">
        <div class="hub-panel">
          <h2>Hva vil du lage?</h2>
          <label class="hub-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2.4" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/></svg>
            <input id="hubQ" type="search" placeholder="F.eks. kart, sensur, TikTok, tabell, Keynote" autocomplete="off" aria-label="Søk etter plugin">
            <kbd>⌘K</kbd>
          </label>
          <div class="hub-chips" id="hubCats" role="group" aria-label="Kategori"></div>
          <div class="hub-filters">
            <div class="hub-seg" role="group" aria-label="Type">
              <button type="button" data-k="alle">Alt</button><button type="button" data-k="embed">Embed</button><button type="button" data-k="fil">Lager fil</button>
            </div>
            <button class="hub-chip" type="button" id="hubFav" aria-pressed="false">★ Favoritter</button>
            <span class="hub-spacer"></span>
            <div class="hub-seg" role="group" aria-label="Visning">
              <button type="button" data-v="kort">▦ Kort</button><button type="button" data-v="liste">☰ Liste</button>
            </div>
          </div>
        </div>
        <div class="hub-panel">
          <h2>Sist brukte dokumenter</h2>
          <div class="hub-recent" id="hubRecent"></div>
          <button class="btn-secondary-tb hub-recent__open" type="button" id="hubOpen">Åpne…</button>
        </div>
      </section>
      <div class="hub-groups" id="hubGroups"></div>`;

    const q = host.querySelector('#hubQ');
    q.value = ui.q;
    q.addEventListener('input', () => { ui.q = q.value.trim().toLowerCase(); renderGroups(); });
    const syncSeg = () => {
      host.querySelectorAll('[data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === ui.kind)));
      host.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === ui.view)));
      host.querySelector('#hubFav').setAttribute('aria-pressed', String(ui.favOnly));
    };
    host.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { ui.kind = b.dataset.k; syncSeg(); renderGroups(); }));
    host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.v; store('hub-view', ui.view); syncSeg(); renderGroups(); }));
    host.querySelector('#hubFav').addEventListener('click', () => { ui.favOnly = !ui.favOnly; syncSeg(); renderGroups(); });
    host.querySelector('#hubOpen').addEventListener('click', () => window.faktisk.documentOpen());
    syncSeg();
    renderGroups();
    renderRecent();
  };

  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      const q = document.getElementById('hubQ'); if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  });
})();
