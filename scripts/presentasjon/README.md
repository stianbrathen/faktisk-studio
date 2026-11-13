# Presentasjon-pluginen: prototype → plugin

`prototype.html` er prototypen (også publisert som artifact «Studio Presentasjon»). Lysbildetyper, avspilling og
Keynote-eksporten utvikles der, fordi den kan prøves i en vanlig nettleser.

`lag-plugin.py` gjør prototypen om til `plugins/presentasjon/index.html`:

    python3 scripts/presentasjon/lag-plugin.py scripts/presentasjon/prototype.html plugins/presentasjon/index.html

Endringer som bare gjelder Studio (lagring i dokumentet, filstier, Lag Keynote via `src/presentasjon-main.js`)
ligger i skriptet. Feiler skriptet med «fant 0 av …», er prototypen endret der skriptet bytter tekst: oppdater skriptet.

`plugins/presentasjon/lib/` er PptxGenJS 4.0.1 og JSZip 3.10.1 (min.js fra npm).
