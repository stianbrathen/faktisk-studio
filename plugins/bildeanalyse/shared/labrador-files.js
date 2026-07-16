// Faktisk Studio — «Mine filer» + «Last opp fil» fra Labrador (delt fil)
//
// Konfigurasjonsdrevet: monterer et panel per URL-input som finnes på siden,
// med riktig filtype-filter (video/bilde). Injiserer egen CSS — pluginene
// trenger bare <script src="shared/labrador-files.js"> før main.js.
// Hopper over inputs som allerede har fått panel (eller egen implementasjon).
// Kanonisk kilde: plugins/_shared/.
//
// clickLoad: false brukes der flere inputs må fylles før lasting
// (for-og-etter trenger både før- og etter-bilde før «Hent»).

(function () {
  'use strict';
  if (!window.faktisk || !window.faktisk.labradorListFiles) return;

  const MOUNTS = [
    // Video-verktøyene (video-player, looping-video, video-hoydepunkter)
    { url: 'videoUrl',  btn: 'loadVideoBtn', accept: 'video' },
    // Parallax bildecollage
    { url: 'imgUrl',    btn: 'imgLoadUrl',   accept: 'image' },
    // Bildemal: bakgrunn + bilde i boks
    { url: 'bgUrl',     btn: 'bgLoadUrl',    accept: 'image' },
    { url: 'shapeUrl',  btn: 'shapeLoadUrl', accept: 'image' },
    // Bilde med markering
    { url: 'urlImage',  btn: 'loadBtn',      accept: 'image' },
    // Før og etter-slider: fyll begge før lasting
    { url: 'urlBefore', btn: 'loadBtn',      accept: 'image', clickLoad: false },
    { url: 'urlAfter',  btn: 'loadBtn',      accept: 'image', clickLoad: false },
  ];

  const EXT = {
    video: /\.(mp4|mov|mpg|mpeg|m4v|webm)(\?|$)/i,
    image: /\.(png|jpe?g|gif|avif|heic|webp)(\?|$)/i,
  };
  const UPLOAD_FILTERS = {
    video: [{ name: 'Video', extensions: ['mp4', 'mov', 'mpg', 'mpeg', 'm4v'] }],
    image: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'gif', 'avif', 'heic', 'webp'] }],
  };
  const TYPE_LABEL = { video: 'VIDEO', image: 'BILDE' };

  let cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    const css = document.createElement('style');
    css.textContent = `
      .labf-row { display: flex; gap: 6px; margin-top: 6px; }
      .labf-btn {
        flex: 1; background: rgba(255,255,255,0.14); color: #fff;
        border: 0; border-radius: var(--radius-input, 8px);
        font-family: var(--font-bold, inherit); font-weight: bold;
        font-size: 12px; height: 28px; padding: 0 10px; cursor: pointer;
        white-space: nowrap;
      }
      .labf-btn:hover { background: rgba(255,255,255,0.28); }
      .labf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .labf-panel {
        background: var(--bg-input, #fff); border-radius: var(--radius-input, 8px);
        padding: 8px; max-height: 200px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 4px; margin-top: 6px;
      }
      .labf-panel__status { font-size: 12px; color: #666; padding: 2px 4px; }
      .labf-panel__status button {
        background: transparent; border: 0; color: #0050FC;
        font-weight: bold; cursor: pointer; text-decoration: underline;
        font-size: 12px; padding: 0;
      }
      .labf-file {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 6px; border-radius: 6px; cursor: pointer;
        font-size: 12.5px; color: var(--text-input, #222);
      }
      .labf-file:hover { background: rgba(0,0,0,0.08); }
      .labf-file__type {
        font-size: 10px; font-weight: bold; background: #0050FC; color: #fff;
        border-radius: 4px; padding: 1px 5px; flex-shrink: 0;
      }
      .labf-file__name {
        flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: var(--font-bold, inherit); font-weight: bold;
      }
      .labf-progress {
        height: 6px; background: rgba(0,0,0,0.15); border-radius: 3px;
        overflow: hidden; margin-top: 4px; display: none;
      }
      .labf-progress__bar {
        height: 100%; width: 0; background: #0050FC; transition: width 0.3s;
      }
    `;
    document.head.appendChild(css);
  }

  const statusEl = document.getElementById('status');
  const setStatus = (msg, isError) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#FFB4B4' : '#fff';
  };

  function mount(cfg) {
    const urlInput = document.getElementById(cfg.url);
    const loadBtn = document.getElementById(cfg.btn);
    if (!urlInput || !loadBtn) return;
    if (urlInput.dataset.labfMounted) return;
    if (cfg.url === 'videoUrl' && document.getElementById('labFilesBtn')) return; // video-sensur har egen
    urlInput.dataset.labfMounted = '1';
    injectCss();

    const anchor = urlInput.closest('.url-row') || urlInput.parentElement;
    if (!anchor || !anchor.parentElement) return;

    const row = document.createElement('div');
    row.className = 'labf-row';
    row.innerHTML =
      '<button class="labf-btn" type="button">Mine filer ▾</button>' +
      '<button class="labf-btn" type="button">Last opp fil…</button>';
    const panel = document.createElement('div');
    panel.className = 'labf-panel';
    panel.style.display = 'none';
    panel.innerHTML = '<div class="labf-panel__status"></div><div class="labf-panel__list"></div>';
    const progress = document.createElement('div');
    progress.className = 'labf-progress';
    progress.innerHTML = '<div class="labf-progress__bar"></div>';

    anchor.insertAdjacentElement('afterend', progress);
    anchor.insertAdjacentElement('afterend', panel);
    anchor.insertAdjacentElement('afterend', row);

    const [filesBtn, uploadBtn] = row.querySelectorAll('button');
    const panelStatus = panel.querySelector('.labf-panel__status');
    const panelList = panel.querySelector('.labf-panel__list');
    const progressBar = progress.querySelector('.labf-progress__bar');
    const extRe = EXT[cfg.accept] || EXT.image;

    function pick(url) {
      urlInput.value = url;
      // Noen plugins lagrer state på input-event — utløs det
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      panel.style.display = 'none';
      if (cfg.clickLoad !== false) loadBtn.click();
      else urlInput.focus();
    }

    async function refresh() {
      panelStatus.textContent = 'Henter filer…';
      panelList.innerHTML = '';
      let res;
      try { res = await window.faktisk.labradorListFiles(); }
      catch (err) { panelStatus.textContent = 'Feil: ' + err.message; return; }

      if (!res.loggedIn) {
        panelStatus.innerHTML = 'Ikke innlogget. <button type="button">Koble til Labrador…</button>';
        panelStatus.querySelector('button').addEventListener('click', async () => {
          panelStatus.textContent = 'Logg inn i vinduet som åpnes…';
          const st = await window.faktisk.labradorConnect();
          if (st.loggedIn) refresh();
          else panelStatus.textContent = 'Fikk ikke gyldig innlogging. Prøv igjen.';
        });
        return;
      }

      const matching = res.files.filter(f => extRe.test(f.url));
      panelStatus.textContent = matching.length
        ? matching.length + ' ' + (cfg.accept === 'video' ? 'videoer' : 'bilder') + ' (nyeste først)'
        : 'Ingen ' + (cfg.accept === 'video' ? 'videoer' : 'bilder') + ' lastet opp ennå.';
      matching.slice(0, 60).forEach(f => {
        const item = document.createElement('div');
        item.className = 'labf-file';
        item.innerHTML = '<span class="labf-file__type">' + TYPE_LABEL[cfg.accept] + '</span>'
          + '<span class="labf-file__name"></span>';
        item.querySelector('.labf-file__name').textContent = f.name;
        item.title = f.url;
        item.addEventListener('click', () => pick(f.url));
        panelList.appendChild(item);
      });
    }

    filesBtn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'flex';
      if (!open) refresh();
    });

    uploadBtn.addEventListener('click', async () => {
      uploadBtn.disabled = true;
      setStatus('Velg fil — lastes opp til Labrador…');
      const unsub = window.faktisk.onLabradorUploadProgress
        ? window.faktisk.onLabradorUploadProgress(msg => {
            progress.style.display = 'block';
            progressBar.style.width = msg.percent + '%';
            setStatus('Laster opp… ' + msg.percent + '% (' + msg.sentMB + ' av ' + msg.totalMB + ' MB)');
          })
        : () => {};
      try {
        const res = await window.faktisk.labradorUpload({
          filters: UPLOAD_FILTERS[cfg.accept] || UPLOAD_FILTERS.image,
        });
        if (res.canceled) { setStatus(''); return; }
        if (!res.ok) { setStatus(res.error, true); return; }
        if (res.url) {
          setStatus('Lastet opp «' + res.name + '» ✓');
          pick(res.url);
        } else {
          setStatus(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer».', true);
        }
      } catch (err) {
        setStatus('Opplasting feilet: ' + err.message, true);
      } finally {
        unsub();
        uploadBtn.disabled = false;
        setTimeout(() => { progress.style.display = 'none'; progressBar.style.width = '0%'; }, 2000);
      }
    });
  }

  MOUNTS.forEach(mount);
})();
