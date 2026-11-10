# Verifisering (plugin) — plan og lærdom

Status 10.11.2026: **0.2.0 bygget, ikke publisert, ikke committet** (0.1.0 ble testet av Stian i Studio samme dag). Ligger i `plugins/verifisering/`.
Testet i Node, headless Chrome og **Electron 33.4.11** (samme versjon som Studio, Linux/xvfb, samme webPreferences: sandbox, contextIsolation), men ikke i selve Studio på Mac — Stian tester med `npm start` først.
Utgangspunkt: en manuell analyse i Claude-chat 10.11.2026 av et selfieklipp (mann foran
Kokoon Advanced Wellness Clinic, Arguineguín, Gran Canaria). Spørsmålet var om personen var lagt
inn på en bakgrunn. Konklusjon: mest sannsynlig ekte opptak. Rapporten ligger som Claude-dok
«Analyse av selfievideo – er personen lagt på en bakgrunn?» (Stians artefakter, claude.ai).

## Hva pluginen skal gjøre

Dra inn et videoklipp eller et bilde → kjør faste tester → vis hvert funn med tall, farge
(grønn/gul/rød), «hva det betyr» og «hva det IKKE betyr» → eksporter rapport (samme oppsett som
dokumentet over: konklusjon, materiale, funn bilde, funn lyd/leppesynk, sted, hvorfor det ser
rart ut, begrensninger, neste steg, verktøy, kilder).

## Tre nivåer for «er dette AI?» (må holdes adskilt i UI og rapport)

1. **Merking i fila — sikkert når funnet, nesten verdiløst når fraværende.**
   - C2PA / Content Credentials (OpenAI GPT Image/Sora, Google Veo/Imagen, Adobe Firefly m.fl.;
     Midjourney merker ikke). Lokalt med `@contentauth/c2pa-node` (npm, 0.10.0 per nov. 2026).
   - XMP/IPTC `digitalSourceType` = `trainedAlgorithmicMedia`, EXIF Software, encoder-tagger.
   - Synlige vannmerker (Sora, Veo, Gemini-stjerne, Kling …) via mal-matching/OCR i hjørnene
     (Apple Vision finnes allerede via `skjermarkiv-main`).
   - Opplasting/omkoding stripper merkingen. Fravær = ingen konklusjon.
2. **Usynlige vannmerker — sikkert, men bare for enkelte leverandører.**
   - SynthID (Google; OpenAI-bilder fra mai 2026; NVIDIA, Kakao): offentlig portal synthid.com fra
     7.10.2026, Google Cloud-API i lukket forhåndsvisning. INGEN lokal detektor.
     → Bare som eksplisitt, manuell handling med advarsel: fila sendes til Google (kildevern —
     upublisert materiale skal ikke forlate maskinen uten at journalisten velger det).
   - «Ikke funnet» betyr bare «ikke Googles/partnernes AI».
   - Åpne vannmerker som kan sjekkes lokalt: Stable Diffusions `invisible-watermark` (DWT-DCT),
     Meta Video Seal.
3. **Statistiske tegn — bare indikasjoner, aldri dom.**
   - Bilde: frekvensspekter (oppskaleringstopper), sensorstøy/PRNU-konsistens, JPEG-kvantiserings-
     tabeller og dobbel komprimering, ELA, klassifiseringsmodeller.
   - Video: testene under + tidskonsistens (tekst, hender, objekter som endrer form), fysikk,
     landemerke-jitter.
   - Klassifiserere generaliserer dårlig til nye modeller og tåler dårlig SoMe-komprimering.
     Formuler som «peker mot / peker bort fra».

## Testbatteri (fra referanseanalysen) med verdier fra det ekte klippet

Klipp: 1280×720, 24 fps, 44,5 s (1 066 bilder), H.264 + AAC 44,1 kHz stereo, nøkkelbilde hvert
5,0 s, ingen Apple-metadata (= eksportert på nytt).

| Test | Metode | Ekte klipp | Tolkning |
|---|---|---|---|
| Parallakse interiør mot fasade | Homografi (ORB + RANSAC) på fasaden alene, restfeil på punkter bak glasset (Lucas–Kanade) | Opptil 5,3 px ved 61 px kamerabevegelse | Ekte 3D-scene, ikke flatt stillbilde |
| Bakgrunnsdrift | Fasekorrelasjon på bakgrunnsflate, akkumulert bane | 78 px x, 24 px y over 44 s; bare 6 % av bildene helt i ro | Ikke frossen bakgrunn |
| Differansekart | Bakgrunnsjustert absolutt differanse, snitt over mange par | Ingen kantstripe rundt person | Ingen keying-maske |
| Kanter | Zoom på hår/skulder | Myk hårkrans, ingen glorie/farge-søl | Ingen maske |
| Ansikt mot bakgrunn | Korrelasjon av bevegelse per bilde | 0,00 (x), 0,11 (y) | UAVKLART — normalt med stabilisering |
| Leppesynk | Munnåpning (MediaPipe landemerke 13–14 / øyekroker 33–263) mot lydstyrke 300–3 000 Hz per bilde, krysskorrelasjon ±15 bilder | Topp ved −1 bilde (munnen 42 ms foran), r = 0,32; tilfeldig forskjøvet lyd gir r ≤ 0,08 (95-pst.) | I synk |
| Synk over tid | Samme i 4 s-vinduer med 2 s steg | Alle 21 vinduer på 0 eller −1 bilde | Ingen drift |
| Stereo | Korrelasjon V/H, sidesignal | 0,94; sidesignal 37 % | Ekte stereo, ikke dobbel mono |
| Støy i pauser | Stilleste 8 % av 20 ms-rammer | ca. −43 dB, mest under 1 kHz | Utendørs rumling, aldri digital stillhet |
| Kutt | ffmpeg scene > 0,08, sprang i lydsampler | Ingen scenekutt; eneste lyd-sprang var en s-lyd | Sammenhengende opptak |
| Sted | Street View + virksomhetens egne bilder | Faste detaljer like; lokalet tomt i Street View mars 2026, klinikken i myk åpning til nov. 2026 | Bakgrunnen er ekte og ikke hentet fra nettsiden |

## Fallgruver som ble oppdaget (ikke gjenta)

- **Stabilisering gir ukorrelert ansikt/bakgrunn.** Telefonen fjerner rotasjonsristing fra hele bildet,
  igjen står hodets egen bevegelse. Dette er det som får ekte selfies til å se «innklipt» ut — ikke
  rapporter det som komposittindikator alene.
- **Stor dybdeskarphet er normalt** på frontkamera (ca. 2,7 mm brennvidde → hyperfokal ca. 1 m;
  720p-nedskalering gjør resten). Uskarp bakgrunn på et vanlig selfieopptak ville vært mer mistenkelig.
- **Vertikale spiler (stripemønster) gir upålitelig dy** i optisk flyt (aperturproblemet). Bruk dx, eller
  krev hjørnepunkter.
- **Masker personen ut** før bakgrunnssporing (ellipse + nedre rektangel holdt i testen; i pluginen
  bør ansikts-/personsegmentering brukes).
- **Siste lydramme kan være tom** → NaN i hele korrelasjonen. Fyll eller kutt.
- **Ikke søk etter tekst i hele MP4-fila.** «Veo» ble funnet som tilfeldige bytes i `mdat`. Søk bare i
  metadata-bokser (`moov/udta/meta`, `uuid`, XMP, C2PA/JUMBF).
- **Fortegn i krysskorrelasjon:** negativ forskyvning = munnen leder lyden, som er naturlig i ekte tale.
- Skilt/innredning i video men tomt lokale i Street View er IKKE et varsel når Street View er eldre;
  rekkefølgen er det som teller.

## Arkitektur-forslag (opprinnelig plan — det som ble bygget står under «Status 0.1.0»)

- Renderer (plugin-vinduet): **opencv.js** (WASM, `@techstark/opencv-js`) for sporing/homografi og
  **MediaPipe Tasks for Web** (`@mediapipe/tasks-vision` 1.2.x, WASM) for ansiktslandemerker.
  Unngår onnxruntime i Electron-prosessene, som krasjer på store tensorer (se kommentar i main.js
  over teksting). UltraFace i main fungerer fordi modellen er liten.
- Main: bilder og lyd via eksisterende `ffmpeg-static` (`findFfmpeg()`); metadata via `ffmpeg -i`
  som i main.js (ffprobe følger ikke med) + egen MP4-boksleser for udta/uuid/XMP/C2PA.
- Modeller i `AI_MODELS` med sha256 og samtykke-dialog. MediaPipe Face Landmarker:
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  3 758 596 byte, sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
  (Apache 2.0). Verifiser hash på nytt før den legges inn.
- Alt lokalt. Eneste nettkall: valgfri SynthID-sjekk og Street View/kart, begge etter eksplisitt valg.
- Kan gjenbruke Bevissikring for å sikre kildeklippet (manifest + sjekksum) før analyse, og
  Skjermarkiv-OCR for synlige vannmerker.
- Rapport: HTML/PDF fra pluginen; ev. lagre ved siden av sikringen i saken.

## Åpne spørsmål (fra planen)

- Egen plugin eller fane i Bevissikring?
- Hvor mye av nivå 3 (klassifiserere) skal med i første versjon? Forslag: bare nivå 1, de lokale
  delene av nivå 2, og testene i tabellen over; klassifiserere senere.

## Status 0.1.0 (10.11.2026)

Bygget etter avgrensningen fra faktisk-Claude (metadata, visuelle hjelpemidler, rapport), men utvidet
med lyd, leppesynk og hjørnevisning etter Stians ønske («ikke avgrens hvis det fungerer bedre»).
Parallakse er bevisst utelatt (se under).

**Filer** (`plugins/verifisering/`): `index.html`, `main.js` (UI), `c2pa-lite.js` (C2PA uten WASM),
`media-meta.js` (MP4/MOV-metadata, XMP, filnavn-hint), `findings.js` (funn med betyr/betyr ikke),
`visual.js` (kanter, forskjellskart, snitt, hjørner, munnsporing), `audio.js` (lyd + leppesynk),
`models.js` (MediaPipe-filer i IndexedDB), `report.js` (HTML-rapport), `lib/exifr.umd.js` (MIT),
`lib/mp-vision.js` (MediaPipe tasks-vision 0.10.21 cjs pakket som global, Apache 2.0), `shared/` (kopi
av skjermarkiv/shared). Bundle: 437 KB, bare tekstfiler. `minStudioVersion` 0.7.13 — ingen ny IPC.

**Avgjørelser**
- Ingen Studio-endring: fila leses med `<input type=file>`/dra-og-slipp (File.slice), bilder hentes med
  `<video>` + `<canvas>`, lyd med `OfflineAudioContext.decodeAudioData`. Rapport via eksisterende
  `saveDialog` + `writeTextFile`.
- **C2PA uten c2pa-web**: `@contentauth/c2pa-web` er 9 MB WASM (12 MB inline) → for stort for bundelen.
  `c2pa-lite.js` leser JUMBF i JPEG (APP11), PNG (caBX), WebP (C2PA) og BMFF (uuid d8fec3d6…), dekoder
  CBOR/COSE og leser signeringssertifikatets eier. **Signaturen kontrolleres ikke** — alle C2PA-funn
  sier det, og «påstår opptak» skal aldri leses som bevis. Kontrollert mot c2pa-python på c2pa-rs-fixtures
  (CA.jpg, C.jpg, video1.mp4) og egne AI-signerte PNG/JPG/MP4 (trainedAlgorithmicMedia).
- **Leppesynk med MediaPipe**, lastet ned ved første bruk etter samtykke (~13,6 MB fra jsDelivr og
  storage.googleapis.com, sha256-kontrollert, lagret i IndexedDB). CSP åpner bare de to vertene i
  `connect-src`, pluss `blob:` og `'wasm-unsafe-eval'` i `script-src`. Ingenting fra fila sendes ut.
  Videoen spilles dempet i panelet; `requestVideoFrameCallback` + `detectForVideo` måler munnåpning
  (landemerke 13–14 / 33–263) per bilde.
- **Ingen samlet dom.** Funn har nivå (merking/spor/mangler/info) og vekt (ai/opptak/behandlet/nøytral),
  hver med «betyr» og «betyr ikke».

**Lærdom fra byggingen (ikke gjenta)**
- **Søk til midten av bildet** (`(n + 0,5)/fps`). `t + 1/fps` ga samme bilde to ganger → helt svart
  forskjellskart.
- **`requestVideoFrameCallback` fyrer ikke for en skjult video** (display:none) i headless Chrome. `seek()`
  har derfor 120 ms tidsgrense. Leppesynk bruker en synlig video.
- **decodeAudioData og redigeringslister (Chromium, målt):** «hopp i starten» (elst media_time) følges,
  men en **tom redigering (forsinket lydstart) følges IKKE**. `media-meta.js` leser elst, og `startDelay`
  for lydsporet legges til. Uten dette ble 300 ms forskjøvet lyd målt som 83 ms.
- **Leppesynk må fjerne langsomme endringer** (glidende snitt ±0,125 s) før krysskorrelasjon, og
  sammenligningsgrunnlaget må ta *beste* forskyvning per tilfeldig forsøk. Referanseklippet: r 0,31 → 0,48,
  tilfeldig nivå 0,27 → 0,20. Kontroller i Chrome: riktig lyd −42 ms (r 0,38), lyd forskjøvet 300 ms →
  −375 ms, feil lyd → «ingen tydelig sammenheng».
- **Munnsporing uten modell** (bruker merker munnen, blokksøk) ble prøvd og forkastet: svært følsom for
  plasseringen (r 0,06–0,28 for samme klipp).
- **Forskjellskart med fast skala** (40 gråtrinn = gul), ikke normalisert per bilde — ellers forsterkes
  en rolig bakgrunn opp og ser mistenkelig ut. Snittet flyttes til første bildes kamerastilling, ellers
  «spøkelser» når kameraet glir.
- **Leppesynk hang på siste bilde** ved «Hele klippet» (Stians test 10.11.2026: «44,38 s av 44,49 s»): når videoen er ferdig, fyrer `requestVideoFrameCallback` aldri igjen. Slutter nå 1,5 bilde før slutten, lytter på `ended` og har en vakthund (3 s uten nytt bilde → avslutt med det som er målt).
- `String.fromCharCode.apply` på 1 MB sprenger stakken — bruk `TextDecoder('latin1')`.
- Eldre C2PA har sertifikatkjeden under strengnøkkelen `x5chain` i stedet for 33.
- Playwright `wait_for_function` bryter pluginens CSP (eval) — test med polling av statusteksten.

**Electron-test 10.11.2026** (Electron 33.4.11, egen testapp med Studios webPreferences og en preload som etterligner `window.faktisk`):
- Nedlasting av MediaPipe-filene med `fetch` fra `file://` virket, sha256 stemte, og filene ble lagret i IndexedDB.
- Ved ny start var modellene klare uten nedlasting, og leppesynk virket med nettet slått av (`enableNetworkEmulation({offline:true})`).
- Kokoon-klippet: munnen 42 ms før lyden, r = 0,39 (tilfeldig ≤ 0,15), 89 % av vinduene stabile.
- **Lærdom:** uten GPU rakk Electron bare å måle 25 % av bildene ved 1× avspilling, og målingen ble svak (r 0,18). Leppesynk senker nå avspillingsfarten automatisk når den ikke rekker hvert bilde, og gir «for få bilder målt» under 70 %.

**Uferdig / neste**
- Ikke testet i Studio på Mac: dra-og-slipp i Studios vindu, avspilling av HEVC/MOV fra iPhone (Linux-Chromium har ikke HEVC), og et ekte AI-bilde/-video med C2PA.
- Parallakse er utelatt: en automatisk versjon krever punktsporing + homografi (opencv.js ~9 MB), og en
  forenklet versjon kan gi falsk «ser ekte ut» (2D-zoom/rotasjon av et stillbilde ligner dybde).
- Signaturkontroll av C2PA (c2pa-web, nedlasting ved behov som MediaPipe) — mulig 0.2.
- `synthid.com`-lenken: kontroller at det er Googles offisielle adresse før publisering.
- Store filer: SHA-256 og lydanalyse leser hele fila i minnet (grense 1 GB / 800 MB).
- Release når testet: `./release-plugin.sh verifisering 0.1.0 "…"` fra plugin-repoet.

## Status 0.2.0 (10.11.2026, ettermiddag)

Stian ba om punkt 1–6 og 8 fra forbedringslista, pluss parallakse. Alt uten Studio-endring (minStudioVersion 0.7.13). Bundle 507 KB.

| Nytt | Hvor | Testet |
|---|---|---|
| EXIF-miniatyr mot hovedbildet (4 vendinger, svarte kanter trimmes, største avvik i én av 8×6 ruter fanger lokale endringer) | `forensics.js` `compareThumb`, `main.js` `extraAnalysis` | Chrome: lik / område endret («midt til høyre», maks 41) / annet utsnitt |
| JPEG-kvantiseringstabeller (libjpeg-standard → anslått kvalitet), markører (JFIF/EXIF/Adobe APP14/ICC), progressiv, fargeoppløsning | `forensics.js` `jpegInfo` | Node: PIL q85/q95 eksakt, ffmpeg-JPEG = ikke standard |
| Tidslinje over alle datoer + avvik (lagret etter opptak, uenige felt, nullstilt, framtid) og sammenligning med tidspunktet kilden oppgir | `forensics.js` `timeline`, fane «Sted og tid» | Node + Chrome |
| Typiske AI-størrelser/-lengder (krever minst to tegn sammen) | `forensics.js` `aiSizeHint` | Node |
| Tekst i bildet over tid (Apple Vision via `skjermarkivAnalyze` + `bevisPathForFile`), tekst som «flyter» markeres | `forensics.js` `textOverTime`, fane «Tekst i bildet» | Bare med etterlignet IPC — **ikke med ekte Vision** |
| Sol og skygge (SunCalc-formler) med kompass | `forensics.js` `sun`, fane «Sted og tid» | Node: Oslo midtsommer 53,5° sør |
| Bildesøk: kopier/lagre bildet som vises, åpne Google Lens/TinEye/Yandex/Bing med kildevern-advarsel | sidepanel | Ikke testet: utklippstavle og nedlasting i Studio |
| Parallakse | `parallax.js`, modus «Parallakse» + «Sjekk hele klippet» | Node, Chrome og Electron |

**Parallakse — metode og lærdom**
- Personen maskeres med MediaPipe selfie segmenter (0,25 MB, lastes ned sammen med leppesynk-filene). Shi–Tomasi-hjørner i bakgrunnen, sporing med grov-til-fin blokksøk + sub-piksel og kontroll begge veier, homografi med RANSAC (ren JS, ingen OpenCV).
- **Enkeltpunkter duger ikke**: «sammenhengende avvik per punkt» fant ingenting i Kokoon-klippet. Det som virker, er **medianen av avvikene i ruter (6×4)**: en hel rute som forskyves samme vei = dybde. Interiøret bak glasset: −2,4 px mot ±0,3 px for fasaden ved 66 px kamerabevegelse (1280 px bredde).
- Kontroller: flatt bilde zoomet/perspektivvridd (29–33 px bevegelse) → 0 ruter med dybde. Ekte klipp, ni par à 2,5 s: dybde i 3 av 9 (der kameraet flyttet seg nok). Ett tilfeldig par gir ofte «ingen målbar dybde» → bruk «Sjekk hele klippet» (10 par).
- «Ingen dybde» skal ALDRI leses som «flatt/falskt»: kamera som bare dreies, flate fasader og fjerne motiver gir det samme. Det står i funnet.

**Ikke testet i Studio på Mac (0.2.0)**: ekte Apple Vision-tekstlesing, kopier bilde til utklippstavlen, «Lagre bildet som vises…» (Electron uten will-download-handler skal vise lagringsdialog), HEVC.

### Test på Mac 10.11.2026 (Studio med `npm start`, Kokoon-klippet)
- **Tekst i bildet (Apple Vision): virker.** 8 bilder lest, «Kokoon Advanced Wellness Clinic» funnet i 8 av 8, gruppert som «Tekst som går igjen uendret».
- **«Lagre bildet som vises…»: virker.** Electron viser macOS-lagringsdialogen med Nedlastinger som mappe. Filnavnet ble `…_100s.png` (komma fjernet, så det kunne leses som 100 sekunder), så det er endret til `…_1-00s.png`.
- **«Kopier bildet som vises»:** feilet med «Document is not focused», men bare fordi Claude klikket mens vinduet lå i bakgrunnen. `navigator.clipboard.write` krever at vinduet er aktivt. Feilmeldingen ber nå om å klikke i vinduet og prøve igjen. Om det virker når Stian klikker selv, er ennå ikke bekreftet. Studios `copyToClipboard` kan bare kopiere tekst, så kopiering uten fokus ville kreve en Studio-endring (ikke gjort).
- **Ikke testet ennå:** dra og slipp fra Finder, iPhone-HEVC og C2PA-filer i Studio. Åpne-panelet og dra og slipp mellom apper lar seg ikke styre i bakgrunnen. Testfiler ligger i `Claude-overforing faktisk.no/testfiler-verifisering/`: `iphone_hevc.mov` (HEVC/hvc1 1080p med Apple-nøkler: iPhone 15 Pro, posisjon, opptaksdato), `ai_test.jpg/.png/.mp4` (C2PA signert med Claudes egen test-CA, digitalSourceType trainedAlgorithmicMedia) og `camera.jpg`.
- **Testfilene i Studio (Stian, 10.11 kl. 15.45):** `iphone_hevc.mov` (HEVC/hvc1) ble lest: libx265 funnet, Apple-nøkler, posisjon, mono, støygulv. Det er ikke bekreftet at videoen spilte av. `ai_test.jpg` ga «Merket som: Laget av generativ AI» (trainedAlgorithmicMedia).
- **Ekte C2PA fra en ekte utsteder, oppdaget ved et uhell:** filer Claude leverer via outputs-mappa, får et C2PA-manifest fra «Anthropic Files 1.0.0», signert av «Anthropic Claude Content Signing» (utsteder Anthropic, PBC). Det skjedde med `camera.jpg` (46 562 → 52 333 byte) og `iphone_hevc.mov`. Manifestet har handlingene `c2pa.opened` og `com.anthropic.claude.provided` («Claude provided this file … may have created or modified the file contents», origin-confidence unknown). Pluginen leste det riktig både i JPEG og i BMFF/MOV. De to filene har altså ekte merking fra en ekte utsteder, men falske kameradata (laget av Claude).
- **Nytt funn i 0.2.0:** «Handlinger i manifestet (n)» lister alle handlinger. Standardhandlinger får norske navn. Handlinger verktøyet har definert selv (uten `c2pa.`) vises med id, verktøy og fila sin egen beskrivelse i anførselstegn. Før dette ble `com.anthropic.claude.provided` ikke vist. Testet med Node mot de tre filene.
- «Eksempel AI-verktÃ¸y» (feil tegn) ligger i selve testsertifikatet (dobbelt kodet da det ble laget), og c2pa-python viser det samme. Det er ikke en feil i pluginen.
- **HEVC i Studio: virker.** `iphone_hevc.mov` (hvc1 1080p) dekodes i plugin-vinduet: bildet vises, miniatyrstripa lages, og hopp til 1,50 s (bilde 46) viser riktig bilde. Leppesynk ga «For kort utsnitt — gå lenger tilbake» på et klipp som bare er 2 s. Teksten sier nå «Klippet er for kort» når hele klippet er under 4 s.
- **Avspilling med lyd (ny, 10.11):** knappen ▶ ved tidslinja i Bilder, eller mellomrom. Den skjulte `srcVideo` spilles med lyd, og bildet tegnes på lerretet med requestAnimationFrame (rVFC fyrer ikke for skjult video). Ved pause blir tidslinja stående på bildet der den stoppet, og avspillingen stopper ved bytte av fane eller ny fil. Testet i Electron 33 med Kokoon-klippet: starter fra 1,00 s, lyd på, pause ved 7,13 s, mellomrom fortsetter derfra.
- **Rettet eldre kappløp:** `buildStrip()` kjørte uten venting og flyttet den skjulte videoen mens annet hentet bilder. I test startet avspillingen da på 31,5 s i stedet for 1 s, og andre visninger kunne få feil bilde hvis man klikket tidlig. `grab()` går nå gjennom en kø (`videoLock`), og avspillingen venter på `state.stripPromise`.
