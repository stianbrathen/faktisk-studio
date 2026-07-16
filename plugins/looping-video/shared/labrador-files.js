// Faktisk Studio — «Mine filer» + «Last opp fil» fra Labrador (delt fil)
//
// Auto-monterer seg i video-plugins som følger ID-konvensjonen
// #videoUrl + #loadVideoBtn (video-player, looping-video, video-hoydepunkter).
// Injiserer egen CSS — ingen endringer trengs i pluginens main.js/style.css.
// Hopper over sider som har egen implementasjon (#labFilesBtn finnes fra før).
// Kanonisk kilde: plugins/_shared/. Inkluderes etter DOM-en, før main.js.

(function () {
  'use strict';
  if (!window.faktisk || !window.faktisk.labradorListFiles) return;

  const urlInput = document.getElementById('videoUrl');
  const loadBtn = document.getElementById('loadVideoBtn');
  if (!urlInput || !loadBtn) return;                       // ikke en video-plugin
  if (document.getElementById('labFilesBtn')) return;      // egen implementasjon

  const urlRow = urlInput.closest('.url-row');
  if (!urlRow || !urlRow.parentElement) return;

  const statusEl = document.getElementById('status');
  const setStatus = (msg, isError) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#FFB4B4' : '#fff';
  };

  const css = document.createElement('style');
  css.textContent = `
    .labf-row { display: flex; gap: 6px; margin-top: 6px; }
    .labf-btn {
      flex: 1; background: rgba(255,255,255,0.14); color: #fff;
      border: 0; border-radius: var(--radius-input, 8px);
      font-family: var(--font-bold, inherit); font-weight: bold;
      font-size: 13px; height: 30px; padding: 0 12px; cursor: pointer;
      white-space: nowrap;
    }
    .labf-btn:hover { background: rgba(255,255,255,0.28); }
    .labf-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .labf-panel {
      background: var(--bg-input, #fff); border-radius: var(--radius-input, 8px);
      padding: 8px; max-height: 220px; overflow-y: auto;
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

  const row = document.createElement('div');
  row.className = 'labf-row';
  row.innerHTML =
    '<button id="labFilesBtn" class="labf-btn" type="button">Mine filer ▾</button>' +
    '<button id="labUploadBtn" class="labf-btn" type="button">Last opp fil…</button>';
  const panel = document.createElement('div');
  panel.className = 'labf-panel';
  panel.style.display = 'none';
  panel.innerHTML = '<div class="labf-panel__status"></div><div class="labf-panel__list"></div>';
  const progress = document.createElement('div');
  progress.className = 'labf-progress';
  progress.innerHTML = '<div class="labf-progress__bar"></div>';

  urlRow.insertAdjacentElement('afterend', progress);
  urlRow.insertAdjacentElement('afterend', panel);
  urlRow.insertAdjacentElement('afterend', row);

  const filesBtn = row.querySelector('#labFilesBtn');
  const uploadBtn = row.querySelector('#labUploadBtn');
  const panelStatus = panel.querySelector('.labf-panel__status');
  const panelList = panel.querySelector('.labf-panel__list');
  const progressBar = progress.querySelector('.labf-progress__bar');

  const VIDEO_EXT = /\.(mp4|mov|mpg|mpeg|m4v|webm)(\?|$)/i;

  function pick(url) {
    urlInput.value = url;
    panel.style.display = 'none';
    loadBtn.click();
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

    const videos = res.files.filter(f => VIDEO_EXT.test(f.url));
    panelStatus.textContent = videos.length
      ? videos.length + ' videoer (nyeste først)'
      : 'Ingen videoer lastet opp ennå.';
    videos.slice(0, 60).forEach(f => {
      const item = document.createElement('div');
      item.className = 'labf-file';
      item.innerHTML = '<span class="labf-file__type">VIDEO</span><span class="labf-file__name"></span>';
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
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mpg', 'mpeg', 'm4v'] }],
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
})();
