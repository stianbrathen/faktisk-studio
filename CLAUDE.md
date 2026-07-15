# Faktisk Studio

Electron-app for journalister på faktisk.no. Bygger interaktive embeds og video-elementer for Labrador-artikler. Plugin-basert arkitektur — pluggbare maler lastes fra `faktiskorg-studio-plugins`-registeret på GitHub.

## Repo-oversikt

- **`main.js`** — Electron main process. IPC-handlers for fil-lagring, video-eksport, plugin-installering, Labrador-integrasjon.
- **`preload.js`** — Kontekst-bro mellom renderer og main. Eksponerer `window.faktisk.*`.
- **`src/`** — Renderer-siden (hoved-UI-vinduet, plugin-liste, prosjektbehandling).
- **`plugins/`** — Innebygde plugins (builtin). Kopi av det som ligger i registeret, brukes som fallback.
- **`scripts/sign-and-notarize.sh`** — Custom Apple signing/notarization + genererer `app-update.yml`.

## Standard release-flyt (foretrukket: bruk scriptet)

**Før du starter:** endre kode, bump `package.json` version, test lokalt med `npm start`.

```bash
cd ~/Dokumenter\ lokalt/Faktisk\ prosjekter/Faktisk\ Studio
./release-studio.sh <versjon> "<release notes>"
```

Scriptet håndterer alt: verifiserer package.json-match, henter Apple-passord fra Keychain, tilbyr å slette eksisterende tag, bygger + signerer + notariserer, verifiserer filnavn (bindestrek-krav), publiserer via `gh release create`.

**Én-gangs Keychain-oppsett:**
```bash
security add-generic-password -s "faktisk-studio-notarize" -a "apple_password" -w "<app-specific-password>"
```

## Manuell fallback

Hvis scriptet feiler eller du trenger fin-kontroll:

```bash
# 1) Slett gammel release om samme tag
gh release delete v<versjon> --repo stianbrathen/faktiskorg-studio-plugins --yes --cleanup-tag 2>/dev/null

# 2) Sett Apple-credentials
export APPLE_ID="stian.brathen@mac.com"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-passord>"
export APPLE_TEAM_ID="W75MQ2URJN"

# 3) Bygg + signer + notariser
npm run build:mac

# 4) Publiser
gh release create v<versjon> \
  --repo stianbrathen/faktiskorg-studio-plugins \
  --title "Faktisk Studio <versjon>" \
  --notes "<endringsbeskrivelse>" \
  "dist/Faktisk-Studio-<versjon>-arm64.dmg" \
  "dist/Faktisk-Studio-<versjon>-arm64-mac.zip" \
  "dist/latest-mac.yml"

# 5) Verifiser
gh release view v<versjon> --repo stianbrathen/faktiskorg-studio-plugins
```

## Kritiske regler

**Filnavn må bruke bindestrek**, ikke mellomrom. `Faktisk-Studio-0.5.5-...`, ikke `Faktisk Studio-0.5.5-...`. electron-updater krasjer på URL-encoding-mismatch. Håndteres via `APP_NAME_SAFE="Faktisk-Studio"` i `scripts/sign-and-notarize.sh`.

**`app-update.yml` genereres i Step 0 av sign-scriptet** — kommer IKKE gratis med electron-builder når vi bruker custom signing. Ikke fjern den delen.

**Kan ikke re-releasee samme tag.** GitHub avviser. Enten bump versjon (0.5.5 → 0.5.6) eller `gh release delete v0.5.5 --cleanup-tag` først.

**Repo-en må ligge utenfor `~/Documents/`** (iCloud). Codesign krasjer med detritus-feil ellers. Bruk `~/Dokumenter lokalt/` som vi gjør nå.

**Labrador-integrasjon:** ikke prøv innebygd Electron-vindu for Labrador SPA — Firebase-auth krasjer. Bruk `shell.openExternal(url)` som åpner i default browser. Se `main.js` `ipcMain.handle('open-labrador', ...)`.

## Plugin-arkitektur

Studio poll-er `registryUrl` fra `package.json` (peker på `raw.githubusercontent.com/.../registry.json`), sammenligner plugin-versjoner, laster nye bundle.json-filer på request.

Endringer i plugin-koden må pushes til **`faktiskorg-studio-plugins`-repoen**, ikke bare committes lokalt her. Se den repoens CLAUDE.md for release-flyt.

## Vanlige feilmoduser

| Symptom | Årsak | Fiks |
|---|---|---|
| "a release with the same tag name already exists" | Prøver å reuse versjon | Bump eller slett først |
| electron-updater ENOENT app-update.yml | Custom sign-script mangler Step 0 | Sjekk `sign-and-notarize.sh` |
| electron-updater 404 for ZIP | Filnavn har mellomrom | Bruk APP_NAME_SAFE med bindestrek |
| npm audit høyt Severity på Electron 33 | Kjent, ikke exploitabel i vår kontekst | Ignorer, planlagt å migrere til Electron 38 |
| Labrador "Application error" i vindu | Prøver embedded Electron-vindu | Bruk shell.openExternal |
