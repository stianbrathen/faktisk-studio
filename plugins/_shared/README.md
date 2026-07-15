# plugins/_shared/ — kanonisk kilde for delte plugin-filer

Dette er den ENESTE sannhetskilden for filer som flere plugins deler. Hver plugins `shared/`-mappe skal være en synkronisert kopi av det som er her.

## Filer som hører hjemme her

- `embed-tokens.js` — Design-tokens for embed-CSS (--fk-* variabler)
- Fremtidig kandidater: `dialog.js`, `new-project.js`, `style.css`, `recent-files-panel.js`, `recent-files-panel.css`

Frem til migreringen er komplett har hver plugin fortsatt egne kopier — vi flytter dem gradvis inn i `_shared/`.

## Synkronisering

Kjør fra plugin-repo-roten (`faktiskorg-studio-plugins/`):

```bash
node ../Faktisk\ Studio/plugins/_shared/sync-shared.js
```

Scriptet kopierer alle filer fra `_shared/` inn i hver plugins `shared/`-mappe, overskriver eksisterende kopier. Kjøres automatisk av `release-plugin.sh` før bundling.

## Regel

**Manuelle endringer i `plugins/<id>/shared/*` vil bli overskrevet** ved neste sync. Ved endringer:
1. Editer filen her i `_shared/`
2. Kjør sync (eller la release-scriptet gjøre det)
3. Bygg og pushe pluginen — bundlen inkluderer den oppdaterte filen

## Hvorfor?

Fikser F2 fra kodegjennomgangen — token-endring krevde tidligere endring i 8 plugin-mapper. Nå ett sted.
