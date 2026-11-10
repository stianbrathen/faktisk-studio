// Delt "Nylige filer"-panel som alle plugins kan bruke.
//
// Bruk:
//   1) Legg til container-element i sidebar: <div id="recentFilesPanel" data-type="image"></div>
//      (data-type kan være "image", "video" eller utelates for alle typer)
//   2) Inkluder dette scriptet.
//   3) Lytt på "faktisk-recent-file-picked"-eventet på containeren for å motta valgte URL:
//        el.addEventListener('faktisk-recent-file-picked', e => { pluginState.url = e.detail.url; ... });
//   4) Registrer URL i historikken når du laster den:
//        window.faktisk.recentFileAdd({ url, type: 'image', alt: 'name', pluginId: PLUGIN_ID });
//
// Panelet oppdaterer seg automatisk ved åpning og har manuell refresh-knapp.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var panels = document.querySelectorAll('.recent-files-panel, [data-recent-files-panel]');
    if (panels.length === 0) {
      var singleton = document.getElementById('recentFilesPanel');
      if (singleton) panels = [singleton];
    }
    panels.forEach(setup);
  });

  function setup(container) {
    container.classList.add('recent-files-panel');
    var filter = container.dataset.type || '';
    render(container, filter);
  }

  async function render(container, filter) {
    container.innerHTML = `
      <div class="rfp-head">
        <span class="rfp-label">Nylige filer</span>
        <button type="button" class="rfp-refresh" title="Oppdater lista">↻</button>
      </div>
      <div class="rfp-grid" role="list">
        <div class="rfp-loading">Laster…</div>
      </div>`;
    container.querySelector('.rfp-refresh').onclick = () => render(container, filter);

    try {
      var opts = { limit: 18 };
      if (filter) opts.type = filter;
      var res = await window.faktisk.recentFileList(opts);
      var grid = container.querySelector('.rfp-grid');
      if (!res.ok || !res.files || res.files.length === 0) {
        grid.innerHTML = '<div class="rfp-empty">Ingen filer enda. Åpne Labrador og last opp — filen dukker opp her når du bruker den i en plugin.</div>';
        return;
      }
      grid.innerHTML = res.files.map(function (f) {
        var thumb = '';
        if (f.type === 'image') {
          thumb = '<img class="rfp-tile__img" src="' + esc(f.url) + '" alt="" loading="lazy">';
        } else if (f.type === 'video') {
          thumb = '<div class="rfp-tile__vid">▶</div>';
        } else {
          thumb = '<div class="rfp-tile__doc">FIL</div>';
        }
        var short = shortName(f.url);
        return (
          '<button class="rfp-tile" role="listitem" data-url="' + esc(f.url) + '" data-type="' + esc(f.type) + '" data-alt="' + esc(f.alt || '') + '" title="' + esc(f.url) + '">' +
            thumb +
            '<span class="rfp-tile__name">' + esc(short) + '</span>' +
          '</button>'
        );
      }).join('');
      grid.querySelectorAll('.rfp-tile').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var url = btn.dataset.url;
          var type = btn.dataset.type;
          var alt = btn.dataset.alt || '';
          container.dispatchEvent(new CustomEvent('faktisk-recent-file-picked', {
            detail: { url: url, type: type, alt: alt },
            bubbles: true,
          }));
        });
      });
    } catch (e) {
      console.error(e);
      container.querySelector('.rfp-grid').innerHTML = '<div class="rfp-empty">Kunne ikke laste lista.</div>';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) {
      return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]);
    });
  }
  function shortName(url) {
    try {
      var u = new URL(url);
      var last = u.pathname.split('/').filter(Boolean).pop() || u.host;
      if (last.length > 22) last = last.slice(0, 10) + '…' + last.slice(-9);
      return last;
    } catch (e) { return url; }
  }
})();
