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

## Bevissikring (src/bevis-main.js, Studio 0.7.12+)

- Eget sikringsvindu med `partition: 'persist:bevis'` (varig innlogging for SoMe), ren Chrome-UA (uten «Electron/»).
- Skjermbilde av hele siden via `webContents.debugger` + `Page.captureScreenshot` (`captureBeyondViewport`), i fliser à 12 000 enhetspiksler satt sammen med sharp. Maks 20 000 CSS-px — ett krasj (SIGTRAP) sett ved 30 000 px etter 40 rullebilder i test.
- SoMe-sider ruller ofte en indre boks — da gir «hele siden» bare det synlige. Rullebildene (`capturePage` per skjermhøyde) finner selv elementet som ruller.
- yt-dlp lastes ned til userData/bin (sha256 mot SHA2-256SUMS i samme release); deno lastes ned ved behov (YouTube krever JS-runtime siden nov. 2025). Cookies fra sikringsvinduet sendes som midlertidig Netscape-fil (0600, slettes etterpå).
- Hver sikring: `manifest.json` + `SHA256SUMS.txt` (kontroller med `shasum -a 256 -c SHA256SUMS.txt`). Fingeravtrykk = sha256 av SHA256SUMS.txt. Dotfiler (miniatyr) er utenfor sjekksummene.
- `\uXXXX` i verktøykall blir gjort om til ekte tegn under overføring — bruk `chr()` i python når slike escapes skal skrives til fil.
- Stikkprøver (src/bevis-sample.js): plan (plan.json + plan.txt + SHA256SUMS.txt) lagres i `<sak>/_stikkprover/` FØR innsamling; resultat.json logger hvert nedslag så avbrutte planer kan fortsettes. X = søke-URL `from: since: until:` (until eksklusiv), YouTube = yt-dlp `--flat-playlist` med `youtubetab:approximate_date` (omtrentlige datoer; nøyaktig dato i info.json). Facebook/Instagram/TikTok mangler dato-adresser — egne strategier senere.
- Tekst under rulling slås sammen per steg (`mergeLines`), fordi feeds fjerner innlegg øverst mens man ruller.
- Chrome-kobling (src/bevis-link.js): lokal tjeneste kun på 127.0.0.1:47361 med koble-kode (`X-Faktisk-Token`, vises i pluginen, lagret i userData/bevis-link.json). Avviser Origin som ikke er chrome-extension:// og svarer aldri på CORS-preflight. `faktisk-studio://last-ned?url=` krever `build.protocols` i package.json (Info.plist) — virker derfor bare i bygget app, ikke `npm start` — og Studio SPØR alltid før nedlasting. Utvidelsen ligger i `plugins/bevissikring/chrome-utvidelse/` (bare tekstfiler, ingen ikoner — bundle-pipelinen tåler ikke binærfiler) og kopieres ut med «Hent utvidelsen…» fordi Chrome ikke kan lese fra app.asar.
- Sikkerhet og oppfølging (src/bevis-extra.js): innstillinger i userData/bevis-settings.json (navn → `capturedByName`, tidsstempel av/på, tempo). RFC 3161-tidsstempel (DigiCert, Sectigo som reserve) på sha256 av SHA256SUMS.txt via `setStampHooks` i finalize → `tidsstempel.tsq/.tsr/.json` ligger UTENFOR sjekksummene og sjekkes for seg i «Kontroller». TimeStampReq bygges for hånd i DER; testet mot lokal `openssl ts -reply`-TSA og bekreftet med `openssl ts -verify` (sandkassen når ikke ekte TSA-er).
- Ingen stille standardmappe: pluginen krever valgt arkiv, varsler om iCloud/Drive/Dropbox/OneDrive, og `captureFolder`/`writePlan`/`saveList` kaster hvis rota ikke finnes (låst kryptert arkiv skal ikke gi løs mappe i /Volumes). Chrome-tjenesten svarer 409 uten arkiv. Kryptert arkiv = `hdiutil create -type SPARSEBUNDLE -fs APFS -encryption AES-256 -stdinpass` (passord + `\0` på stdin, lagres ikke) — IKKE testet (krever macOS).
- `confirmVisit` i bevis-main spør før LinkedIn-profiler og Instagram-/Facebook-stories (kontoeier ser besøket). Tilfeldige pauser i profil-/stikkprøveserier (`window.bvPace`) og under rulling.
- «Følg med»: skjult vindu i persist:bevis sjekker adressen hver 24. t mens Studio kjører (userData/bevis-watch.json). «Borte» = kjente fraser/404; «endret» = ≥30 % av tekstlinjene fra første sjekk mangler. Ved endring lages ny sikring (kind `oppfolging`) + varsel.
- Pluginens `init()` må vente på DOMContentLoaded: svar fra Studio kan komme før senere `<script>`-filer har registrert seg, og da ble `window.bvSecurityInit` hoppet over i stillhet.
- «Vis sikringen» (src/bevis-view.js): oversiktsvindu per sikring (rullebilder etter hverandre, hele siden, video/bilder, tekst, fakta + kontroll). Egen økt `bevis-visning` der all ikke-file:-trafikk stoppes. Siden skrives til os.tmpdir() (ikke i sikringsmappa — da blir den «ekstra»), slettes ved lukking. Uten preload sendes klikk til main via `console.log('BEVISVIEW …')` + `console-message` (ukjente skjema-lenker utløser ikke will-navigate pålitelig). MHTML åpnes i eget vindu med `javascript: false` og låst tittel. PDF i iframe ble blank (CSP/PDF-plugin) — åpnes i Forhåndsvisning i stedet.
- Statuslinja i sidepanelet er `position: sticky; bottom: 0` — den lå langt under knappene, og Stian trodde «Last ned bare videoen» ikke gjorde noe (meldingen var «Skriv inn en sak»).
- `loginAccount` i manifestet = feltet «Konto i sikringsvinduet» (redaksjonens researchkonto). Tomt for Chrome-sikringer (brukerens egen Chrome). Bakgrunn: VVP 3.10 (falsk identitet bare unntaksvis) — passiv bruk av nøytral researchkonto er greit, samhandling under falsk identitet er redaktørbeslutning.
- Import og søk (src/bevis-index.js + plugins/bevissikring/arkiv.js): importerte skjermbilder/opptak blir egne sikringer (kind `import`, filer kopieres urørt til `import/`, sha256 av original = kopi, opptakstid fra creation_time/Spotlight/filnavn). Søkeindeks per sikring i `<sak>/_indeks/<mappe>.json` (UTENFOR sikringsmappa): meta, tekst.txt, info.json/kommentarer, OCR via `skjermarkiv-main.analyze` (Vision), tale via Studios `transcribe`-IPC kalt fra pluginen (`language: 'auto'`). Indeksen er utdatert når sha256 av SHA256SUMS.txt endres. Slipp av filer krever `webUtils.getPathForFile` i preload (File.path finnes ikke i Electron 32+).
- Lenkeliste («Liste»-fanen, plugins/bevissikring/lenkeliste.js, plugin 0.1.3, 11.11.2026): lim inn lenker eller last opp .txt/.csv/.xlsx (xlsx leses i rendereren med egen mini-unzip + DecompressionStream('deflate-raw') + DOMParser, også hyperkoblinger fra arkets .rels). To moduser per lenke: «video» = bevisDownload, «grundig» = bevisOpen(wait) → bevisExpand(comments) → bevisCapture med media:true og tag {kind:'lenke', suffix:'lNNN'}. INGEN ny Studio-IPC: lista lagres med bevisProfileSave (havner i <sak>/_profiler/<tid>_web/, scan.kind='lenkeliste' — saveList tar bare pluginVersion som ekstra felt, så alt lenkelista trenger ligger i scan), resultater med bevisProfileResult, oversikt.csv med writeTextFile. profil.js filtrerer bort scan.kind==='lenkeliste'. Pause (bvPace) bare når samme nettsted kommer to ganger på rad; nettsted som krever innlogging hoppes over resten av kjøringen. Egen mappe _lister/ og tag i video-manifestet krever en Studio-IPC senere.
- «Slett…» på kortet (`bevis-delete` i bevis-extra.js): `shell.trashItem` (aldri rm), fjerner indeksfila og «Følg med», og skriver en linje i `<sak>/_slettelogg.txt` (tid, mappe, adresse, fingeravtrykk, navn). Krever bekreftelse.
- «Sikre alt jeg ser» (Chrome-utvidelse 0.2.0 + p17 i bevis-link/bevis-main): utvidelsen ruller og tar skjermbilder selv (`captureVisibleTab`, maks 2/s → 650 ms mellom bilder, maks 40), åpner kommentarer/svar (aldri ekte lenker), henter tekst, MHTML (3 forsøk — feiler av og til rett etter rulling) og bilder. Med Studio: stykkevis opplasting `/full/start` → `/full/file` (base64, kun hvitelistede stier) → `/full/finish` (kind `chrome`, index uten OCR); `/status` har `features: ['download','capture','full']`. Video lastes ned av yt-dlp med Chrome-cookies for nettstedet — cookies sendes KUN til 127.0.0.1 og skrives til en midlertidig cookie-fil som slettes. Uten Studio lagrer utvidelsen selv i Nedlastinger/Bevissikring/<sak>/ (manifest i samme format, SHA256SUMS via crypto.subtle, RFC 3161 bygd i JS); blob-adresser må lages i offscreen-dokument (service worker kan ikke). Strømmet video krever Studio. En framtidig «light»-app kan implementere samme protokoll.

## Podkast (plugins/podkast, 0.1.0 — ikke publisert, 28.10.2026)

- Embed-skript som kjører i leserens side skal finne roten med `document.currentScript.parentNode`, ikke `getElementById(id)`: samme embed limt inn to ganger på én side har samme id, og da virket bare den første (funnet i test). Gjelder alle nye embeds med skript.
- YouTube-data (oEmbed, spilleliste-RSS, `i.ytimg.com`-bilder) hentes med `fetch` fra plugin-vinduet. CORS fra YouTube i Electron er ikke verifisert; feiler det, trengs en IPC i main.js (se `kunnskapsbase/podkast_plugin.md`).
- Fullskjerm fra en iframe (YouTube) inne i en embed med `container-type`/`transform`/`filter` på en forelder: i testartikkelen havnet fullskjermvinduet utenfor skjermen til høyre (28.10.2026, nettleser ikke avklart – trolig Safari). Podkast-runtime slår av disse egenskapene på alle foreldre mens `fullscreenElement` ligger i embedden, og setter dem tilbake etterpå. Mønsteret gjelder alle embeds med iframe-video.
- OBS: den fiksen virket IKKE i testartikkelen (verken Chrome eller Safari). Årsaken er ikke funnet – se `kunnskapsbase/podkast_plugin.md`. Podkast har i stedet fått «⤢ Stor visning» (position:fixed over hele nettleservinduet, iframen flyttes ikke i DOM så avspillingen fortsetter).
- Oppklart 28.10 kveld: fullskjerm glir ut også på youtube.com hos Stian → Mac-oppsettet hans, ikke embeds. Ikke bruk tid på å «fikse» fullskjerm i embeds ut fra hans maskin alene; test på en annen Mac først.
- Måling i embeds: faktisk.no har Fathom (`window.fathom.trackEvent`) og Kilkaya — IKKE Google Tag Manager/dataLayer (verifisert i testartikkelen 29.10.2026). Podkast sender til Fathom som «<podkastnavn>: <hendelse>». Nye embeds med måling bør gjøre det samme.
- Personvern: bilder fra tredjepart (f.eks. `i.ytimg.com`) i embed-markup lastes ved sidevisning og avslører leseren før noen har klikket. Legg bildene i Labrador /files.

## Teksting/transkribering (src/transcribe-pipeline.js, endret 30.10.2026 — ikke sluppet)
- Hele flyten lyd → segmenter ligger i `src/transcribe-pipeline.js`; `transcribe`-IPC i main.js laster bare ned motor/modeller og kaller `transcribeWav`. Test uten å bygge: `node scripts/test-transcribe.js <klipp> [--vad1 0.2] [--med-prompt] [--uten-norm]` (bruker Studios whisper-cli og modeller i userData, skriver pass 1, hull og funn).
- Pass 1 kjører UTEN VAD og UTEN `--prompt`. VAD 0.2 mistet 7 av 9 setninger i et teaserklipp med telefonlyd/musikk; Faktisk-ordlista som prompt kostet setninger eller ga diktet tekst. Pluginen sender fortsatt prompt — Studio ignorerer den (`usePrompt`).
- Hull-utsnitt må holdes under whispers 30 s-vindu: store hull deles i biter på maks 20 s (+2,5 s polstring hver vei). Et 33 s-utsnitt mistet teksten etter vindusgrensa — i selve hull-passet.
- Kjent gjenstående: whisper uten VAD hopper over tale i starten av et nytt vindu og stempler neste setning med vindusstarten (segmenter på xx,06 s). `absorbNext` i planGaps prøvde å løse det, men ga doble segmenter — står AV. Detaljer og testresultater: `kunnskapsbase/teksting_vad_jojo_test.md`.

## Videoslider og TikTok-henting (plugins/videoslider 0.1.0 + src/tiktok-main.js — ikke sluppet, 1.11.2026)
- Slider med stående videoer (TikTok-videoene) til forsiden og artikler. Embed-prefiks `fvs`, kjøretid `fvsRun` i `plugins/videoslider/runtime.js` (ES5, `toString()` inn i embedden). Detaljer, testresultater og release-sjekkliste: `kunnskapsbase/videoslider_plugin.md`.
- Lyd-regel (videoslider 0.1.3, 11.11.2026): bare `curP` har lyd. Klargjorte/forrige avspillere er ALLTID `muted` (endPrime slår ikke lyden på igjen; mute() gjelder bare curP), `silenceOthers(p)` i activate og på `playing`, og en `play`-vakt + sen play()-promise pauser avspillere som ikke vises. `place()` flytter ikke `<video>` som allerede står i riktig ramme (gjeninnsetting kan forsinke start i Safari). Stian hørte forrige video fortsette når neste startet (trolig iPhone) — ikke gjenskapt i Chromium, fikset defensivt.
- Klargjøring (videoslider 0.1.4, 12.11.2026): klargjort neste video spiller lydløst til `PRIME_S` (1,2 s) før den stoppes og spoles til 0 (timeupdate), sikkerhetsnett 3 s (`p.primeT`) — iPhone henter da mer enn første bilde. Blar leseren dit midt i klargjøringen, pauses den før play() så `playing` kommer igjen (ellers blir neste ikke klargjort). `#fvsdebug` i adressen: telleren viser ms fra bla til avspilling og om videoen var klar. Målt 12.11 på faktisk.no/testforside: filene er faststart, H.264, 0,4–1,3 Mbit/s, 3–17 MB — filene er ikke flaskehalsen; CloudFront-miss gir ~300 ms TTFB, treff 10–40 ms. Desktop (Electron/Chromium): ~210 ms fra bla-start (mest scroll-animasjon til 60 %).
- Aktivering på scroll (videoslider 0.1.5, 12.11.2026): skjermopptak fra iPhone (60 fps, rammeanalyse) viste at IntersectionObserver meldte 0,4–0,7 s ETTER at siden hadde rastet inn — videoen sto stille, så rykket den i gang. Nå avgjøres aktiv side i `scroll` (rAF-strupet): `round(scrollTop/h)` aktiveres når den er ≥55 % synlig, så videoen starter mens den glir inn. IO brukes ikke lenger. Programmert bla (`go()`: piler/taster/auto-neste) setter `progTarget` så mellomstegene ignoreres (ellers hopper den tilbake til forrige); `touchstart`/`wheel` nullstiller. `prepare()`/`warm()` venter til feeden har stått i ro 180 ms (`whenIdle`) — å flytte <video> inn i neste side mens den glir kan gi rykk.
- Startbilde til videoen spiller (videoslider 0.1.6, 12.11.2026): avspilleren holdes `is-loading` (video skjult, startbildet = første bilde vises) til den er aktiv OG `playing` (venter på `seeked` hvis den spoler). Ikke lenger `is-ready` (synlig) på neste side ved `loadeddata` — klargjort video spiller lydløst / står på et senere bilde, og på iPhone så man den gå bak, så hoppe tilbake til start («som om videoene har startet under startbildet»). `p.starting` hindrer at activate()s egen pause viser videoen.
- Stort vindu = `<dialog>` med `showModal()` (øverste lag, påvirkes ikke av transform/contain i Labrador) og vertikal scroll-snap. TO `<video>` (P[0]/P[1], endret 4.11.2026) bytter på: den ene spiller, den andre står klar på neste side i blaretningen (lastet, første bilde tegnet). Begge låses opp for lyd i trykket som åpner vinduet (den andre spilles lydløst et øyeblikk og stoppes) — iPhone krever trykk per element. Neste video startet på ~8 ms mot ~400 ms med én delt video (Chromium, strupet nett). Ikke testet på iPhone ennå. Datasparing/2G: ingen forhåndslasting.
- Video og stillbilder ligger i Labrador (stillbilde via `labradorThumbnail` ved 1,0 s). Videoene lastes først når vinduet åpnes. Embedden sender og lytter på `fkpod:play` (pauser podkast) og måler i Fathom som «<tittel>: <hendelse> – <videotittel>».
- TikTok: IPC `tiktok-list` og `tiktok-import` i `src/tiktok-main.js`, registrert i main.js etter bevis-index og eksponert i preload (`tiktokList`, `tiktokImport`, `onTiktokProgress`). yt-dlp lånes fra `bevis-main.js` (`_internal`). Nedlasting med `-S vcodec:h264,res:1080`, ffmpeg fast start (libx264 hvis HEVC), maks 100 MB, lagres i Labrador som `tiktok-<id>.mp4` og gjenbrukes.
- TikTok-IPC-ene kom med i **Studio 0.7.13** (sluppet 2.11.2026 — koden lå i repoet da det ble bygget; verifisert i app.asar: src/tiktok-main.js, main.js og preload.js). Pluginen feature-detekterer (`tiktokList`/`tiktokImport`), så minStudioVersion 0.7.13 holder for TikTok-delen. TikTok-henting er altså ute i produksjon, men UTESTET mot ekte TikTok.
- Ikke testet mot ekte TikTok eller i ekte Studio. Kan TikTok kreve innlogging eller ha endret API-et, oppdater yt-dlp først. Cookies sendes ikke nå; `writeCookieFile` i bevis-main.js kan eksporteres ved behov.

## Medieslider (plugins/medieslider 0.1.0 — ikke publisert, 4.11.2026)
- Slider med egne bilder og videoer (utklipp, skjermbilder av innlegg, klipp) til artikler. Bygget på Videoslider; embed-prefiks `fms`, kjøretid `fmsRun` i `plugins/medieslider/runtime.js` (ES5, `toString()` inn i embedden). Status: `kunnskapsbase/medieslider_status.md`.
- Per element: type (bilde/video), src, w/h (måles fra fila → kortene får riktig form uten hopp), stillbilde for video (`labrador-thumbnail` + samme svart-bilde-sjekk som Videoslider), bildetekst, kilde, dato (ÅÅÅÅ-MM-DD → «12. oktober 2026»), lenke, alt-tekst.
- Tre visninger (`D.mode`): `lightbox` (<dialog> over hele skjermen, ::backdrop rgba(12,12,12,.86), sidelengs scroll-snap), `expand` (`.fms-stage` = hvitt kort med skygge som spretter opp fra kortet; Popover API `popover="manual"` → øverste lag, ellers absolutt i `.fms-wrap`; bildet maks min(860 px, 100vw−52) × min(68vh, 720 px) og aldri forstørret; midt over sporet, klemt i skjermen, følger rulling og lukkes når slideren er ute av syne; klikk utenfor/Esc/× lukker; siden dempes ikke), `none` (bare sporet; video spilles i kortet).
- «Flere bilder…» / dra fra Finder: `<input type=file multiple>` → FileReader → bilder over 2400 px skaleres ned i canvas (PNG beholdes som PNG hvis < ~8 MB, ellers JPEG 0,88) → `labradorUploadData` (eksisterende IPC, ingen Studio-endring). Gir originalen, IKKE Studios AVIF/variant-optimalisering som «Last opp…» gjør. Video kun via «Last opp…».
- Video: `preload="none"`, egen `<video controls>` per element (ikke delt som i Videoslider — her blas det ikke med lyd). Autoplay bare når elementet åpnes med et trykk. `fkpod:play` som de andre.
- `.fms` har IKKE overflow:hidden (reserven uten Popover API plasserer `.fms-stage` absolutt og skal kunne gå utover boksen).

## Verifisering (plugins/verifisering — 0.2.0 publisert 10.11.2026, plugin-repo 05982c2; 0.3.0 med tekst ligger lokalt, ikke publisert og ikke committet)
- 0.3.0: tekst (`tekst.js`) — konkrete spor etter AI-chat, usynlige tegn, lenker og docx/pdf-metadata, ingen AI-score. Detaljer og testresultater: `docs/verifisering_plugin.md` § 0.3.0. Spesialtegn lages med `String.fromCodePoint` (escape-sekvenser blir gjort om under overføring).
- Sjekker video og bilder: Content Credentials (egen leser `c2pa-lite.js`, signaturen KONTROLLERES IKKE), IPTC/XMP, EXIF (exifr), MP4/MOV-metadata, kanter, forskjellskart, hjørner (synlige vannmerker), lyd og leppesynk (MediaPipe, lastes ned ved første bruk etter samtykke, lagres i IndexedDB). 0.2.0: EXIF-miniatyr mot bilde, JPEG-tabeller, tidslinje + kildens tidspunkt, AI-størrelser, tekst over tid (Apple Vision via `skjermarkivAnalyze`), sol/skygge, bildesøk og parallakse (ruter med median-avvik etter homografi — ikke enkeltpunkter). HTML-rapport. Status, avgjørelser og lærdom: `docs/verifisering_plugin.md` (samme tekst i kunnskapsbasen).
- Ingen ny IPC: fil via `<input type=file>`/dra-og-slipp, bilder via `<video>`+`<canvas>`, lyd via `decodeAudioData`. minStudioVersion 0.7.13.
- AI-merking i tre nivåer som ALDRI blandes; verktøyet gir aldri en samlet «ekte/falsk»-dom. SynthID og C2PA-signatur bare via nettsider som journalisten selv laster opp til (kildevern-advarsel i pluginen).
- Ikke onnxruntime for store modeller i Electron (krasjer, se main.js over teksting). MediaPipe kjører som WASM i plugin-vinduet.
- Chromiums decodeAudioData følger elst media_time, men IKKE tom redigering (forsinket lydstart) — legg til `startDelay` fra elst, ellers blir leppesynk feil.
- Søk til midten av bildet (`(n+0,5)/fps`); `requestVideoFrameCallback` fyrer ikke for skjult video.
- Stabilisering på mobil gir ukorrelert bevegelse mellom ansikt og bakgrunn i ekte selfies — ikke et komposittbevis alene. Parallakse er derfor ikke med i 0.1.

## Dokumenter (.faktisk) — Studio 0.8.0 (sluppet 12.11.2026)
- `src/documents-main.js` registrerer alle `document-*`-IPC-ene og `documents-export-all` (eksponert i preload som `documentOpen`, `documentSave`, `documentSaveAs`, `documentRecent`, `documentInfo`, `documentImportMedia`, `documentsExportAll`, m.fl.). Ved etterkontroll av bygget: grep i `src/documents-main.js` i app.asar, ikke main.js.
- keynote-klipp 0.3.0 krever 0.8.0 (minStudioVersion 0.8.0 satt manuelt i registry — release-plugin.sh setter den ikke).
- Detaljer: `Claude-overforing faktisk.no/kunnskapsbase/faktisk_studio_release_workflow.md` § Studio 0.8.0.

## Forslag: Final Cut-maler i Studio (12.11.2026, ikke påbegynt)
Malsynk (register + zip i GitHub Releases, ikke plugin-bundles), tre nivåer Kjerne/Delt/Mine, Grafikk-plugin med FCPXML, UUID-vakt i release. Se `Claude-overforing faktisk.no/kunnskapsbase/fcp_maler_i_studio.md`.
