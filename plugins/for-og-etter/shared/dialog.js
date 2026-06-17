// Faktisk Studio · delt dialog-modul
// window.prompt og window.confirm er blokkert i Electron. Vi bygger
// en custom modal som matcher Faktisk-designet og returnerer Promise.

(function () {
  function ensureContainer() {
    let host = document.getElementById('faktisk-dialog-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'faktisk-dialog-host';
    document.body.appendChild(host);
    const style = document.createElement('style');
    style.textContent = `
      #faktisk-dialog-host {
        position: fixed; inset: 0; display: none;
        align-items: center; justify-content: center;
        background: rgba(0,0,0,0.45);
        z-index: 99999;
        font-family: var(--font-regular), "Helvetica Neue", sans-serif;
      }
      #faktisk-dialog-host.open { display: flex; }
      .fd-card {
        background: #fff;
        color: #212121;
        border-radius: 14px;
        padding: 24px 28px;
        width: 420px;
        max-width: calc(100vw - 40px);
        box-shadow: 0 24px 60px rgba(0,0,0,0.4);
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .fd-message {
        font-size: 15px;
        line-height: 1.4;
        margin: 0;
        color: #212121;
        font-weight: 500;
      }
      .fd-input {
        background: #f0f0f0;
        border: 0;
        outline: 0;
        border-radius: 7px;
        padding: 10px 12px;
        font-size: 14px;
        font-family: inherit;
        color: #212121;
        font-weight: 500;
      }
      .fd-input:focus { outline: 2px solid #0050FC; }
      .fd-row {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 4px;
      }
      .fd-btn {
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        border: 0;
        border-radius: 9px;
        cursor: pointer;
        font-family: inherit;
      }
      .fd-btn-primary { background: #0050FC; color: #fff; }
      .fd-btn-primary:hover { background: #0040D9; }
      .fd-btn-cancel { background: #e0e0e0; color: #212121; }
      .fd-btn-cancel:hover { background: #d0d0d0; }
      .fd-btn-danger { background: #d04040; color: #fff; }
      .fd-btn-danger:hover { background: #e85050; }
      .fd-progress-label {
        font-size: 13px;
        color: #555;
        margin: 0;
      }
      .fd-progress {
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
      }
      .fd-progress__bar {
        height: 100%;
        background: #0050FC;
        transition: width 0.2s;
      }
      .project-card {
        background: #0050FC;
        color: #fff;
        border-radius: 9px;
        padding: 12px 16px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 4px;
        position: relative;
        transition: background 0.15s;
      }
      .project-card:hover { background: #0040D9; }
      .project-card__name { font-weight: bold; font-size: 14px; }
      .project-card__meta { font-size: 11px; opacity: 0.85; }
      .project-card__delete {
        position: absolute; top: 6px; right: 8px;
        background: rgba(255,255,255,0.18); color: #fff;
        width: 22px; height: 22px; border-radius: 4px;
        display: none; align-items: center; justify-content: center;
        font-size: 14px; cursor: pointer; border: 0;
      }
      .project-card:hover .project-card__delete { display: flex; }
      .project-card__delete:hover { background: rgba(255,80,80,0.85); }
    `;
    document.head.appendChild(style);
    return host;
  }

  function open(html, onMount) {
    const host = ensureContainer();
    host.innerHTML = `<div class="fd-card">${html}</div>`;
    host.classList.add('open');
    if (onMount) onMount(host);
    return () => { host.classList.remove('open'); host.innerHTML = ''; };
  }

  function prompt(message, defaultValue) {
    return new Promise(resolve => {
      const close = open(`
        <p class="fd-message"></p>
        <input class="fd-input" type="text">
        <div class="fd-row">
          <button class="fd-btn fd-btn-cancel" data-act="cancel">Avbryt</button>
          <button class="fd-btn fd-btn-primary" data-act="ok">OK</button>
        </div>
      `, host => {
        host.querySelector('.fd-message').textContent = message || '';
        const input = host.querySelector('.fd-input');
        input.value = defaultValue || '';
        setTimeout(() => { input.focus(); input.select(); }, 30);
        const cleanup = result => { close(); resolve(result); };
        host.querySelector('[data-act="ok"]').onclick = () => cleanup(input.value);
        host.querySelector('[data-act="cancel"]').onclick = () => cleanup(null);
        input.onkeydown = e => {
          if (e.key === 'Enter') cleanup(input.value);
          if (e.key === 'Escape') cleanup(null);
        };
      });
    });
  }

  function confirm(message, danger) {
    return new Promise(resolve => {
      const okClass = danger ? 'fd-btn-danger' : 'fd-btn-primary';
      const close = open(`
        <p class="fd-message"></p>
        <div class="fd-row">
          <button class="fd-btn fd-btn-cancel" data-act="cancel">Avbryt</button>
          <button class="fd-btn ${okClass}" data-act="ok">${danger ? 'Slett' : 'OK'}</button>
        </div>
      `, host => {
        host.querySelector('.fd-message').textContent = message || '';
        const cleanup = result => { close(); resolve(result); };
        host.querySelector('[data-act="ok"]').onclick = () => cleanup(true);
        host.querySelector('[data-act="cancel"]').onclick = () => cleanup(false);
        document.onkeydown = e => {
          if (e.key === 'Escape') { document.onkeydown = null; cleanup(false); }
        };
      });
    });
  }

  function alert(message) {
    return new Promise(resolve => {
      const close = open(`
        <p class="fd-message"></p>
        <div class="fd-row">
          <button class="fd-btn fd-btn-primary" data-act="ok">OK</button>
        </div>
      `, host => {
        host.querySelector('.fd-message').textContent = message || '';
        const cleanup = () => { close(); resolve(); };
        host.querySelector('[data-act="ok"]').onclick = cleanup;
      });
    });
  }

  window.faktiskDialog = { prompt, confirm, alert };
})();
