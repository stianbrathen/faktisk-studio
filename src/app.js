// Faktisk Studio — Malside (hub)

const ELEMENT_TYPES = [
  { id: 'looping-video',   label: 'Looping videoklipp',   category: 'video' },
  { id: 'video-player',    label: 'Videoavspiller',       category: 'video' },
  { id: 'bilde-markering', label: 'Bilde med markering',  category: 'image' },
  { id: 'bildeanalyse',    label: 'Bildeanalyse',         category: 'image' },
  { id: 'for-og-etter',    label: 'Før og etter slider',  category: 'image' },
  { id: 'interaktiv-video',label: 'Interaktiv video',     category: 'video' },
  { id: 'parallax-collage',label: 'Parallax bildecollage',category: 'image' },
  { id: 'kart',            label: 'Kart med markeringer', category: 'annet' },
  { id: 'timeline-bilder', label: 'Timeline med bilder',  category: 'annet' },
  { id: 'timeline-horisontal', label: 'Horisontal timeline', category: 'annet' },
];

// Kategorier vises i denne rekkefølgen. Plugins med ukjent/manglende
// category havner under «Annet».
const CATEGORIES = [
  { key: 'video', label: 'Video' },
  { key: 'image', label: 'Bilder' },
  { key: 'annet', label: 'Annet' },
];

async function renderHub() {
  const grid = document.getElementById('pluginGrid');
  grid.innerHTML = '';

  let installed = [];
  try {
    installed = await window.faktisk.listPlugins();
  } catch (e) {
    console.error('Kunne ikke hente plugins:', e);
  }

  // Bygg liste: installerte plugins først, så placeholders for ELEMENT_TYPES
  // som ikke er installert ennå. Kategori hentes fra manifest (installerte)
  // eller ELEMENT_TYPES (placeholders).
  const installedIds = new Set(installed.map(p => p.id));
  const items = [
    ...installed.map(p => {
      const known = ELEMENT_TYPES.find(t => t.id === p.id);
      return {
        kind: 'installed',
        plugin: p,
        label: known ? known.label : (p.name || p.id),
        category: p.category || (known && known.category) || 'annet',
      };
    }),
    ...ELEMENT_TYPES.filter(t => !installedIds.has(t.id)).map(type => ({
      kind: 'placeholder',
      type,
      category: type.category || 'annet',
    })),
  ];

  CATEGORIES.forEach(cat => {
    const catItems = items.filter(it =>
      it.category === cat.key
      || (cat.key === 'annet' && !CATEGORIES.some(c => c.key === it.category)));
    if (!catItems.length) return;

    const group = document.createElement('section');
    group.className = 'malside__group';
    const title = document.createElement('h2');
    title.className = 'malside__group-title';
    title.textContent = cat.label;
    group.appendChild(title);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'malside__grid';
    const columns = [[], [], []];
    catItems.forEach((item, i) => columns[i % 3].push(item));
    columns.forEach(colItems => {
      const col = document.createElement('div');
      col.className = 'malside__column';
      colItems.forEach(item => {
        col.appendChild(item.kind === 'installed'
          ? makeInstalledCard(item.plugin, item.label)
          : makePlaceholderCard(item.type));
      });
      groupGrid.appendChild(col);
    });
    group.appendChild(groupGrid);
    grid.appendChild(group);
  });
}

function makeInstalledCard(plugin, fallbackLabel) {
  const card = document.createElement('button');
  card.className = 'plugin-card';
  card.title = plugin.description || '';
  card.innerHTML = `<h2 class="plugin-card__title">${escapeHtml(plugin.name || fallbackLabel)}</h2>`;
  card.addEventListener('click', () => openPlugin(plugin.id));
  return card;
}

function makePlaceholderCard(type) {
  const card = document.createElement('div');
  card.className = 'plugin-card plugin-card--placeholder';
  card.innerHTML = `
    <h2 class="plugin-card__title">${escapeHtml(type.label)}</h2>
    <button class="plugin-card__add" title="Kommer snart" aria-label="Installer">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M11 4h2v16h-2zM4 11h16v2H4z"/>
      </svg>
    </button>
  `;
  card.querySelector('.plugin-card__add').addEventListener('click', e => {
    e.stopPropagation();
    window.faktiskDialog.alert('«' + type.label + '» er ikke installert ennå.');
  });
  return card;
}

async function openPlugin(id) {
  try {
    const res = await window.faktisk.openPlugin(id);
    if (!res.ok) window.faktiskDialog.alert('Kunne ikke åpne plugin: ' + (res.error || 'ukjent feil'));
  } catch (e) {
    console.error(e);
    window.faktiskDialog.alert('Feil ved åpning av plugin: ' + e.message);
  }
}

async function openPluginWithProject(pluginId, fileId) {
  localStorage.setItem('faktisk-pending-project', JSON.stringify({ pluginId, fileId }));
  await openPlugin(pluginId);
}

async function openMyProjectsModal() {
  let projects = [];
  try {
    const res = await window.faktisk.projectList(null);
    if (res.ok) projects = res.projects;
  } catch (e) { console.error(e); }

  const labels = new Map(ELEMENT_TYPES.map(t => [t.id, t.label]));

  let listHtml;
  if (!projects.length) {
    listHtml = '<div class="projects-modal__empty">Du har ingen lagrede prosjekter ennå.</div>';
  } else {
    listHtml = '<div class="projects-modal">' + projects.map(p => {
      const dateLabel = formatRelativeDate(p.savedAt);
      const pluginLabel = labels.get(p.pluginId) || p.pluginId;
      return `<div class="project-card" data-plugin="${escapeHtml(p.pluginId)}" data-file="${escapeHtml(p.fileId)}" data-name="${escapeHtml(p.name)}">
        <span class="project-card__name">${escapeHtml(p.name)}</span>
        <span class="project-card__meta">${escapeHtml(pluginLabel)} · ${escapeHtml(dateLabel)}</span>
        <button class="project-card__delete" title="Slett">×</button>
      </div>`;
    }).join('') + '</div>';
  }

  const host = document.getElementById('faktisk-dialog-host') || (() => {
    window.faktiskDialog.alert(''); return document.getElementById('faktisk-dialog-host');
  })();
  host.innerHTML = `<div class="fd-card" style="width:760px;max-width:calc(100vw - 60px);">
    <p class="fd-message">Mine prosjekter</p>
    ${listHtml}
    <div class="fd-row">
      <button class="fd-btn fd-btn-cancel" data-close>Lukk</button>
    </div>
  </div>`;
  host.classList.add('open');

  function close() { host.classList.remove('open'); host.innerHTML = ''; host.onclick = null; }
  host.querySelector('[data-close]').onclick = close;
  host.onclick = e => { if (e.target === host) close(); };

  host.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('project-card__delete')) return;
      const pluginId = card.dataset.plugin;
      const fileId = card.dataset.file;
      close();
      openPluginWithProject(pluginId, fileId);
    });
    const delBtn = card.querySelector('.project-card__delete');
    if (delBtn) {
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const name = card.dataset.name;
        const pluginId = card.dataset.plugin;
        const fileId = card.dataset.file;
        const ok = await window.faktiskDialog.confirm('Slette «' + name + '»?', true);
        if (!ok) return;
        const del = await window.faktisk.projectDelete(pluginId, fileId);
        if (del.ok) { close(); openMyProjectsModal(); }
        else window.faktiskDialog.alert('Kunne ikke slette: ' + (del.error || 'ukjent feil'));
      });
    }
  });
}

async function openPluginMarketModal() {
  const host = document.getElementById('faktisk-dialog-host') || (() => {
    window.faktiskDialog.alert(''); return document.getElementById('faktisk-dialog-host');
  })();

  function renderModal(bodyHtml, footerHtml) {
    host.innerHTML = `<div class="fd-card" style="width:720px;max-width:calc(100vw - 60px);">
      <p class="fd-message" style="font-size:18px;">Plugin-marked</p>
      <div class="market-body">${bodyHtml}</div>
      <div class="fd-row">${footerHtml || '<button class="fd-btn fd-btn-cancel" data-close>Lukk</button>'}</div>
    </div>`;
    host.classList.add('open');
    host.onclick = e => { if (e.target === host) close(); };
    const closeBtn = host.querySelector('[data-close]');
    if (closeBtn) closeBtn.onclick = close;
  }
  function close() { host.classList.remove('open'); host.innerHTML = ''; host.onclick = null; }

  renderModal('<div class="market-empty">Laster registry…</div>',
              '<button class="fd-btn fd-btn-cancel" data-close>Lukk</button>');

  let registry = null, installed = [], registryError = null;
  try {
    const [reg, inst] = await Promise.all([
      window.faktisk.registryFetch(false),
      window.faktisk.pluginStatus(),
    ]);
    if (reg.ok) registry = reg.registry;
    else registryError = reg.error;
    installed = inst || [];
  } catch (e) {
    registryError = e.message;
  }

  if (!registry) {
    renderModal(`<div class="market-empty">
      <p style="color:#c33;">Kunne ikke hente registry.</p>
      <p style="font-size:12px;color:#666;">${escapeHtml(registryError || '')}</p>
    </div>`);
    return;
  }

  const installedById = new Map(installed.map(p => [p.id, p]));
  const items = (registry.plugins || []).map(rp => {
    const ip = installedById.get(rp.id);
    let status;
    if (!ip) status = 'install';
    else if (rp.version !== ip.version) {
      const cmp = compareVersionsClient(rp.version, ip.version);
      status = cmp > 0 ? 'update' : 'installed';
    } else status = 'installed';
    return { ...rp, status, installedVersion: ip ? ip.version : null, installedSource: ip ? ip.source : null };
  });

  function compareVersionsClient(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const va = pa[i] || 0, vb = pb[i] || 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }

  function rowHtml(it) {
    const action =
      it.status === 'install'   ? '<button class="fd-btn fd-btn-primary" data-act="install" data-id="' + escapeHtml(it.id) + '">Installer</button>' :
      it.status === 'update'    ? '<button class="fd-btn fd-btn-primary" data-act="install" data-id="' + escapeHtml(it.id) + '">Oppdater til ' + escapeHtml(it.version) + '</button>' :
                                  '<button class="fd-btn fd-btn-cancel" data-act="uninstall" data-id="' + escapeHtml(it.id) + '" ' + (it.installedSource !== 'user' ? 'disabled title="Innebygd plugin"' : '') + '>Avinstaller</button>';
    const meta = it.status === 'update'
      ? `<span style="color:#c80;">Oppdatering tilgjengelig (du har ${escapeHtml(it.installedVersion)})</span>`
      : it.status === 'installed'
      ? `Installert · v${escapeHtml(it.installedVersion)}${it.installedSource === 'builtin' ? ' (innebygd)' : ''}`
      : `v${escapeHtml(it.version)}`;
    return `<div class="market-row">
      <div class="market-row__info">
        <div class="market-row__name">${escapeHtml(it.name)}</div>
        <div class="market-row__desc">${escapeHtml(it.description || '')}</div>
        <div class="market-row__meta">${meta}</div>
        ${it.changelog ? `<div class="market-row__changelog">${escapeHtml(it.changelog)}</div>` : ''}
      </div>
      <div class="market-row__action">${action}</div>
    </div>`;
  }

  const bodyHtml = items.length
    ? items.map(rowHtml).join('')
    : '<div class="market-empty">Registry-en er tom.</div>';

  renderModal(bodyHtml, `
    <button class="fd-btn fd-btn-cancel" data-refresh>Sjekk på nytt</button>
    <button class="fd-btn fd-btn-cancel" data-close>Lukk</button>
  `);

  host.querySelector('[data-refresh]').onclick = async () => {
    await window.faktisk.registryFetch(true);
    close();
    openPluginMarketModal();
  };

  host.querySelectorAll('button[data-act="install"]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const entry = (registry.plugins || []).find(p => p.id === id);
      if (!entry) return;
      btn.textContent = 'Installerer…';
      btn.disabled = true;
      const res = await window.faktisk.pluginInstall(entry);
      if (res.ok) {
        close();
        await renderHub();
        await window.faktiskDialog.alert('«' + entry.name + '» er installert (v' + entry.version + ').');
        openPluginMarketModal();
      } else {
        await window.faktiskDialog.alert('Kunne ikke installere: ' + (res.error || 'ukjent feil'));
        btn.disabled = false;
        btn.textContent = 'Installer';
      }
    };
  });

  host.querySelectorAll('button[data-act="uninstall"]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const ok = await window.faktiskDialog.confirm('Avinstallere denne pluginen?', true);
      if (!ok) return;
      const res = await window.faktisk.pluginUninstall(id);
      if (res.ok) {
        close();
        await renderHub();
        openPluginMarketModal();
      } else {
        await window.faktiskDialog.alert('Kunne ikke avinstallere: ' + (res.error || 'ukjent feil'));
      }
    };
  });
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'akkurat nå';
  if (diffMin < 60) return diffMin + ' min siden';
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return diffHrs + ' timer siden';
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return diffDays + ' dager siden';
  return d.toLocaleDateString('no');
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ============================================================
//  Topp-bar-knapper
// ============================================================
document.getElementById('malsideBtn').addEventListener('click', () => {
  document.getElementById('pluginGrid').scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('addPluginBtn').addEventListener('click', () => {
  openPluginMarketModal();
});

document.getElementById('fullscreenBtn').addEventListener('click', async () => {
  await window.faktisk.toggleFullscreen();
});

document.getElementById('myProjectsBtn').addEventListener('click', () => {
  openMyProjectsModal();
});

renderHub();

// Vis app-versjon ved siden av logoen
(async () => {
  try {
    const v = await window.faktisk.appVersion();
    const el = document.getElementById('appVersion');
    if (el && v) el.textContent = 'v' + v;
  } catch (e) {}
})();

// ============================================================
//  Auto-update-banner
//  Vises øverst i vinduet når electron-updater melder om ny versjon.
// ============================================================
(function setupUpdaterBanner() {
  if (!window.faktisk || !window.faktisk.updaterGetState) return;

  // Lag banner-elementet
  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0',
    'z-index:9999',
    'background:#0050FC', 'color:#fff',
    'padding:10px 18px',
    'display:none',
    'align-items:center', 'justify-content:center',
    'gap:16px',
    'font-family:"Haas Grot Text 75 Bold", "Helvetica Neue", Helvetica, Arial, sans-serif',
    'font-weight:bold', 'font-size:13px',
    'box-shadow:0 2px 12px rgba(0,0,0,0.25)',
  ].join(';');
  document.body.appendChild(banner);

  function esc(s){ return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  function render(state) {
    if (!state || !state.status) return;
    // Kun disse status'ene skal vises som banner
    if (state.status === 'available') {
      banner.innerHTML = `<span>Ny versjon <strong>v${esc(state.version)}</strong> tilgjengelig — laster ned i bakgrunnen…</span>`;
      banner.style.display = 'flex';
      banner.style.background = '#0050FC';
    } else if (state.status === 'downloading') {
      banner.innerHTML = `<span>Laster ned oppdatering… <strong>${esc(state.percent || 0)}%</strong></span>`;
      banner.style.display = 'flex';
      banner.style.background = '#0050FC';
    } else if (state.status === 'ready') {
      banner.innerHTML = `
        <span>Ny versjon <strong>v${esc(state.version)}</strong> er klar til å installeres.</span>
        <button id="updateRestartBtn" style="background:#fff;color:#0050FC;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;font-family:inherit;font-weight:bold;font-size:12px;">Restart og installer</button>
        <button id="updateDismissBtn" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:6px;padding:6px 12px;cursor:pointer;font-family:inherit;font-weight:bold;font-size:12px;">Senere</button>
      `;
      banner.style.display = 'flex';
      banner.style.background = '#0050FC';
      const restartBtn = document.getElementById('updateRestartBtn');
      const dismissBtn = document.getElementById('updateDismissBtn');
      if (restartBtn) restartBtn.onclick = () => window.faktisk.updaterQuitAndInstall();
      if (dismissBtn) dismissBtn.onclick = () => { banner.style.display = 'none'; };
    } else if (state.status === 'error') {
      // Feil skjules stille — logger til konsoll i stedet for å plage bruker
      console.warn('Auto-updater error:', state.message);
      banner.style.display = 'none';
    } else {
      banner.style.display = 'none';
    }
  }

  // Hent siste kjente state ved oppstart
  window.faktisk.updaterGetState().then(render).catch(() => {});
  // Lytt på fremtidige oppdateringer
  window.faktisk.onUpdaterState(render);
})();
