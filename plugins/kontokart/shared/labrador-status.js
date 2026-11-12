// Faktisk Studio — Labrador-tilkoblingsstatus i toppbaren (delt fil)
//
// Selvforsynt: injiserer egen CSS og en statusbrikke i .topbar__actions.
// Viser tydelig om Studio er koblet til Labrador (grønn prikk) eller ikke
// (grå prikk + «Koble til»). Klikk kobler til / sjekker på nytt.
// Inkluderes med <script src="shared/labrador-status.js"> etter topbaren
// (i src/ på malsiden). Kanonisk kilde: plugins/_shared/.

(function () {
  'use strict';
  if (!window.faktisk || !window.faktisk.labradorStatus) return;
  const bar = document.querySelector('.topbar__actions');
  if (!bar || document.getElementById('labStatusChip')) return;

  const css = document.createElement('style');
  css.textContent = `
    .lab-chip {
      display: flex; align-items: center; gap: 7px;
      background: rgba(255,255,255,0.12);
      border: 0; border-radius: 18px;
      padding: 6px 14px; margin-right: 6px;
      font-family: var(--font-bold, inherit); font-weight: bold;
      font-size: 12px; color: #fff; cursor: pointer;
      white-space: nowrap;
    }
    .lab-chip:hover { background: rgba(255,255,255,0.24); }
    .lab-chip__dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: #999; flex-shrink: 0;
      transition: background 0.2s;
    }
    .lab-chip.on .lab-chip__dot { background: #2ecc5e; box-shadow: 0 0 6px rgba(46,204,94,0.7); }
    .lab-chip.checking .lab-chip__dot { background: #f5c542; }
  `;
  document.head.appendChild(css);

  const chip = document.createElement('button');
  chip.id = 'labStatusChip';
  chip.className = 'lab-chip checking';
  chip.type = 'button';
  chip.innerHTML = '<span class="lab-chip__dot"></span><span class="lab-chip__label">Labrador…</span>';
  bar.insertBefore(chip, bar.firstChild);
  const label = chip.querySelector('.lab-chip__label');

  let connected = false;
  let busy = false;

  function render(state) {
    chip.classList.remove('on', 'checking');
    if (state === 'on') {
      chip.classList.add('on');
      label.textContent = 'Labrador tilkoblet';
      chip.title = 'Koblet til Labrador — «Mine filer» og opplasting virker i alle verktøy. Klikk for å sjekke på nytt.';
    } else if (state === 'checking') {
      chip.classList.add('checking');
      label.textContent = 'Labrador…';
      chip.title = 'Sjekker Labrador-tilkobling…';
    } else {
      label.textContent = 'Koble til Labrador';
      chip.title = 'Ikke innlogget — klikk for å logge inn. Gjelder alle verktøyene.';
    }
  }

  async function check() {
    if (busy) return;
    render('checking');
    try {
      const st = await window.faktisk.labradorStatus();
      connected = !!st.loggedIn;
    } catch (e) {
      connected = false;
    }
    render(connected ? 'on' : 'off');
  }

  chip.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      if (connected) {
        busy = false;
        await check();
        return;
      }
      render('checking');
      label.textContent = 'Logg inn i vinduet…';
      const st = await window.faktisk.labradorConnect();
      connected = !!st.loggedIn;
      render(connected ? 'on' : 'off');
    } catch (e) {
      render('off');
    } finally {
      busy = false;
    }
  });

  window.addEventListener('focus', check);
  check();
})();
