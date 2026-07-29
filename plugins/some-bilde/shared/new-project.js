// Delt hjelper: kobler #newProjectBtn til stateClear + reload.
// Plugin må ha en knapp med id="newProjectBtn" i topbaren OG sette
// window.PLUGIN_ID til pluginens id (samme som mappe-navnet i plugins/).
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('newProjectBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      try {
        var ok = await window.faktiskDialog.confirm(
          'Slett gjeldende arbeid og start på nytt?\n\nLagrede prosjekter beholdes.',
          true
        );
        if (!ok) return;
        var id = window.PLUGIN_ID || (document.querySelector('meta[name="plugin-id"]') || {}).content;
        if (id && window.faktisk && window.faktisk.stateClear) {
          await window.faktisk.stateClear(id);
        }
        location.reload();
      } catch (e) {
        console.error(e);
      }
    });
  });
})();
