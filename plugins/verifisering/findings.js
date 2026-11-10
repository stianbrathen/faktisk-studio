// Faktisk Studio · Verifisering — funn
//
// Gjør rådata (C2PA, XMP, EXIF, MP4-metadata, filnavn) om til funn som
// journalisten kan lese: hva vi fant, hva det betyr og hva det IKKE betyr.
//
// REGEL: aldri en samlet «ekte/falsk»-konklusjon. Hvert funn står for seg.
// nivå: 'merking' (fila sier selv noe om opprinnelse), 'spor' (teknisk spor),
//       'mangler' (noe vi lette etter, men ikke fant), 'info'.
// vekt: 'ai' (peker mot AI/syntetisk), 'opptak' (fila påstår opptak),
//       'behandlet' (redigert/omkodet), 'noytral'.
//
// window.VfFindings i plugin-vinduet, module.exports i Node.

(function (root) {
  'use strict';

  const C2 = (typeof module !== 'undefined' && module.exports) ? require('./c2pa-lite.js') : root.VfC2pa;

  const UNVERIFIED = 'Signaturen er ikke kontrollert i Studio. Det som står her er det fila selv påstår. Kontroller signaturen på contentcredentials.org/verify før du bygger på den (fila lastes da opp dit).';

  function build(input) {
    const { name, c2pa, xmp, exif, video, kind } = input;
    const out = [];
    const add = f => out.push(f);

    // ---------- 1. Content Credentials (C2PA) ----------
    const a = c2pa && c2pa.store && c2pa.store.active;
    if (a) {
      const who = a.signer && a.signer.subject ? (a.signer.subject.O || a.signer.subject.CN || '') : '';
      const types = a.actions.map(x => C2.describeSourceType(x.digitalSourceType)).filter(Boolean);
      const ai = types.find(t => ['full', 'delvis'].includes(t.ai));
      const algo = types.find(t => t.ai === 'algoritme' || t.ai === 'forbedret');
      const capture = types.find(t => t.ai === 'opptak');
      add({
        nivå: 'merking', vekt: ai ? 'ai' : capture ? 'opptak' : 'noytral',
        tittel: 'Content Credentials (C2PA) funnet',
        tekst: [
          a.generator ? 'Laget/lagret med: ' + a.generator + '.' : '',
          who ? 'Signert av: ' + who + (a.signer.issuer && a.signer.issuer.O ? ' (sertifikat fra ' + a.signer.issuer.O + ')' : '') + '.' : 'Fant ikke signeringssertifikatet.',
          c2pa.store.manifests.length > 1 ? 'Fila har ' + c2pa.store.manifests.length + ' manifester, altså en historikk med flere ledd.' : '',
        ].filter(Boolean).join(' '),
        betyr: 'Et program som støtter standarden har skrevet inn hvem som laget eller endret fila, og med hvilket verktøy.',
        betyrIkke: UNVERIFIED,
      });
      if (ai) add({
        nivå: 'merking', vekt: 'ai',
        tittel: 'Merket som: ' + ai.no,
        tekst: 'Handlingen i manifestet har digitalSourceType «' + ai.key + '»' + (a.actions.find(x => x.softwareAgent) ? ', verktøy: ' + a.actions.find(x => x.softwareAgent).softwareAgent : '') + '.',
        betyr: 'Verktøyet som laget fila erklærer at innholdet helt eller delvis er laget med generativ AI. Slike merker settes av verktøyet selv, og AI-leverandører har lite å tjene på å merke falskt.',
        betyrIkke: 'At hele innholdet er AI hvis typen er «satt sammen». ' + UNVERIFIED,
      });
      else if (algo) add({
        nivå: 'merking', vekt: 'behandlet',
        tittel: 'Merket som algoritmisk: ' + lc(algo.no),
        tekst: 'digitalSourceType «' + algo.key + '».',
        betyr: 'Innholdet er laget eller bearbeidet av programvare, ikke bare tatt opp.',
        betyrIkke: '«algorithmicMedia» betyr ikke nødvendigvis generativ AI (det kan f.eks. være en grafikk). ' + UNVERIFIED,
      });
      if (capture && !ai) add({
        nivå: 'merking', vekt: 'opptak',
        tittel: 'Fila påstår å være et opptak',
        tekst: 'digitalSourceType «' + capture.key + '» (' + lc(capture.no) + ').',
        betyr: 'Kameraet eller appen som laget fila har merket den som opptak.',
        betyrIkke: 'At den er ekte. Uten kontrollert signatur kan en slik påstand være skrevet inn av hvem som helst. Bruk den aldri alene som bevis. ' + UNVERIFIED,
      });
      if (a.ingredients.length) add({
        nivå: 'merking', vekt: 'behandlet',
        tittel: 'Bygger på ' + a.ingredients.length + ' annen fil' + (a.ingredients.length > 1 ? 'er' : ''),
        tekst: a.ingredients.map(i => (i.title || 'uten navn') + (i.relationship ? ' (' + i.relationship + ')' : '')).join(', ') + '.',
        betyr: 'Fila er laget av eller ut fra andre filer (f.eks. et originalbilde som er redigert).',
        betyrIkke: 'Noe om hva som ble endret. Se handlingene i detaljene.',
      });
      if (a.actions.length) {
        const NAVN = { 'c2pa.created': 'laget', 'c2pa.opened': 'åpnet', 'c2pa.edited': 'redigert', 'c2pa.edited.metadata': 'metadata endret', 'c2pa.converted': 'konvertert', 'c2pa.transcoded': 'kodet om', 'c2pa.repackaged': 'pakket om', 'c2pa.resized': 'skalert', 'c2pa.cropped': 'beskåret', 'c2pa.color_adjustments': 'farger justert', 'c2pa.filtered': 'filter brukt', 'c2pa.placed': 'element satt inn', 'c2pa.removed': 'noe fjernet', 'c2pa.drawing': 'tegnet', 'c2pa.published': 'publisert', 'c2pa.redacted': 'sladdet', 'c2pa.watermarked': 'vannmerket', 'c2pa.unknown': 'ukjent handling' };
        const rader = a.actions.map(x => {
          const std = NAVN[x.action];
          let t = std ? std + ' (' + x.action + ')' : 'egen handling «' + x.action + '»';
          if (x.softwareAgent) t += ', verktøy: ' + x.softwareAgent;
          if (x.description) t += ', beskrivelse i fila: «' + String(x.description).slice(0, 300) + '»';
          return t;
        });
        const egne = a.actions.some(x => x.action && !NAVN[x.action]);
        add({
          nivå: 'merking', vekt: 'noytral',
          tittel: 'Handlinger i manifestet (' + a.actions.length + ')',
          tekst: rader.join('; ') + '.',
          betyr: 'Dette er stegene verktøyet har skrevet inn, i rekkefølge.' + (egne ? ' Handlinger uten «c2pa.»-prefiks er definert av verktøyet selv, og beskrivelsen er verktøyets egen tekst.' : ''),
          betyrIkke: 'At lista er komplett eller sann. ' + UNVERIFIED,
        });
      }
    } else if (c2pa && c2pa.remote) {
      add({
        nivå: 'merking', vekt: 'noytral', tittel: 'Lenke til ekstern C2PA-manifest',
        tekst: 'XMP peker til ' + c2pa.remote + '.',
        betyr: 'Merkingen ligger på en server i stedet for i fila.',
        betyrIkke: 'Studio henter den ikke (kildevern). Åpne lenken selv hvis du vil se den.',
      });
    } else {
      add({
        nivå: 'mangler', vekt: 'noytral', tittel: 'Ingen Content Credentials (C2PA)',
        tekst: 'Fant ingen C2PA-manifest i fila.',
        betyr: 'Verktøyet som laget fila skrev ikke inn merkingen, eller den er fjernet underveis.',
        betyrIkke: 'At fila er ekte. Merkingen forsvinner ofte ved opplasting til sosiale medier, skjermopptak og konvertering, og mange AI-verktøy (bl.a. Midjourney) merker ikke i det hele tatt.',
      });
    }

    // ---------- 2. XMP / IPTC ----------
    const x = xmp || {};
    if (x.DigitalSourceType) {
      const t = C2.describeSourceType(x.DigitalSourceType);
      add({
        nivå: 'merking', vekt: ['full', 'delvis'].includes(t.ai) ? 'ai' : t.ai === 'opptak' ? 'opptak' : 'noytral',
        tittel: 'IPTC-merke: ' + lc(t.no),
        tekst: 'XMP-feltet DigitalSourceType = «' + t.key + '».',
        betyr: 'Den som lagret fila har merket opprinnelsen i bildets metadata (bl.a. Google, Meta og Midjourney bruker dette feltet).',
        betyrIkke: 'Noe sikkert: feltet er usignert og kan endres eller fjernes med vanlige verktøy.',
      });
    }
    // Fastvareversjon fra kamera/telefon (f.eks. «18.1») er ikke et redigeringsspor
    const sw = exif && exif.Software && !/^[\d.]+$/.test(String(exif.Software).trim()) ? exif.Software : '';
    const tools = [x.CreatorTool, sw, x.History].filter(Boolean);
    const allTools = [].concat(tools, a ? [a.generator] : [], video && video.keys ? [video.keys['com.apple.quicktime.software']] : []).filter(Boolean).join(' · ');
    const aiTool = AI_TOOLS.filter(([re]) => re.test(allTools)).map(([, n]) => n);
    if (aiTool.length && !(a && a.actions.some(q => ['full', 'delvis'].includes((C2.describeSourceType(q.digitalSourceType) || {}).ai)))) add({
      nivå: 'spor', vekt: 'ai', tittel: 'Metadata nevner et AI-verktøy: ' + Array.from(new Set(aiTool)).join(', '),
      tekst: 'Programvarefeltene inneholder «' + allTools + '».',
      betyr: 'Fila er sannsynligvis laget eller lagret av dette verktøyet.',
      betyrIkke: 'Noe sikkert: feltene er usignerte og kan endres. Noen av verktøyene kan også redigere ekte bilder.',
    });
    if (tools.length && !aiTool.length) add({
      nivå: 'spor', vekt: 'behandlet', tittel: 'Programvare i metadata',
      tekst: Array.from(new Set(tools.join(' · ').split(' · '))).join(' · ') + '.',
      betyr: 'Fila er lagret eller eksportert av disse programmene.',
      betyrIkke: 'At innholdet er manipulert. Kamera-apper, telefonens bildebehandling og vanlig eksport skriver også inn programnavn.',
    });

    // ---------- 3. Kameradata (bilder) ----------
    if (kind === 'image') {
      const e = exif || {};
      if (e.Make || e.Model) add({
        nivå: 'spor', vekt: 'opptak', tittel: 'Kameradata: ' + [e.Make, e.Model].filter(Boolean).join(' '),
        tekst: [e.LensModel ? 'Objektiv: ' + e.LensModel + '.' : '', e.DateTimeOriginal ? 'Tatt: ' + fmtDate(e.DateTimeOriginal) + '.' : '', e.ExposureTime ? 'Lukker 1/' + Math.round(1 / e.ExposureTime) + ' s' + (e.FNumber ? ', f/' + e.FNumber : '') + (e.ISO ? ', ISO ' + e.ISO : '') + '.' : ''].filter(Boolean).join(' '),
        betyr: 'Fila har metadata av den typen et kamera eller en telefon skriver.',
        betyrIkke: 'At bildet er ekte, eller at det er tatt der og da. EXIF kan kopieres eller redigeres.',
      });
      else add({
        nivå: 'mangler', vekt: 'noytral', tittel: 'Ingen kameradata (EXIF)',
        tekst: 'Fant ikke kameramerke eller -modell.',
        betyr: 'Fila er trolig lastet ned fra en tjeneste, sendt via meldingsapp, skjermdumpet eller laget av programvare.',
        betyrIkke: 'At den er AI eller falsk. De fleste tjenester fjerner EXIF ved opplasting.',
      });
      if (e.latitude != null && e.longitude != null) add({
        nivå: 'spor', vekt: 'noytral', tittel: 'GPS-posisjon i fila',
        tekst: e.latitude.toFixed(5) + ', ' + e.longitude.toFixed(5) + '.', kart: [e.latitude, e.longitude],
        betyr: 'Kameraet registrerte (eller noen skrev inn) denne posisjonen.',
        betyrIkke: 'At bildet faktisk er tatt der. Sammenlign med det du ser i bildet.',
      });
    }

    // ---------- 4. Video (MP4/MOV) ----------
    if (video) {
      const k = video.keys || {}; const make = k['com.apple.quicktime.make'] || video.tags['©mak'] || video.tags.manu;
      const model = k['com.apple.quicktime.model'] || video.tags['©mod'] || video.tags.modl;
      const v = video.tracks.find(t => t.handler === 'vide');
      if (make || model) add({
        nivå: 'spor', vekt: 'opptak', tittel: 'Opptaksenhet: ' + [make, model].filter(Boolean).join(' '),
        tekst: [k['com.apple.quicktime.software'] ? 'Programvare ' + k['com.apple.quicktime.software'] + '.' : '', k['com.apple.quicktime.creationdate'] ? 'Opptakstid: ' + k['com.apple.quicktime.creationdate'] + '.' : ''].filter(Boolean).join(' '),
        betyr: 'Fila har metadata av den typen telefonen eller kameraet skriver ved opptak.',
        betyrIkke: 'At innholdet er uredigert. Metadata kan beholdes ved redigering, og kan skrives inn med vanlige verktøy.',
      });
      else add({
        nivå: 'mangler', vekt: 'noytral', tittel: 'Ingen opplysninger om opptaksenhet',
        tekst: 'Fant ikke kameramerke, modell eller opptakstid fra enheten.',
        betyr: 'Fila er trolig eksportert, lastet ned fra en tjeneste eller kodet om. Originalen fra kilden kan ha mer.',
        betyrIkke: 'At videoen er manipulert eller AI-generert.',
      });
      const loc = k['com.apple.quicktime.location.ISO6709'] || video.tags['©xyz'];
      const ll = parseIso6709(loc);
      if (ll) add({
        nivå: 'spor', vekt: 'noytral', tittel: 'Posisjon i videoens metadata',
        tekst: ll[0].toFixed(5) + ', ' + ll[1].toFixed(5) + '.', kart: ll,
        betyr: 'Enheten registrerte (eller noen skrev inn) denne posisjonen.',
        betyrIkke: 'At videoen faktisk er tatt der. Sammenlign med det du ser.',
      });
      const enc = [].concat(video.encoderHints || [], k.encoder ? [k.encoder] : [], video.tags['©too'] ? [video.tags['©too']] : [], v && v.compressor && !/^AVC Coding$|^HEVC Coding$/i.test(v.compressor) ? [v.compressor] : []);
      const encU = Array.from(new Set(enc)).filter((e, i, arr) => !arr.some((o, j) => j !== i && o.length > e.length && o.includes(e)));
      if (enc.length) add({
        nivå: 'spor', vekt: 'behandlet', tittel: 'Kodet med: ' + encU.join(' · '),
        tekst: 'Navnet ligger i metadata eller i begynnelsen av videodataene.',
        betyr: 'Videoen er kodet (eller kodet om) av dette programmet. x264/Lavc/Lavf brukes av ffmpeg, HandBrake, mange redigeringsprogrammer og nettjenester.',
        betyrIkke: 'At innholdet er endret. Omkoding skjer ved all eksport og opplasting.',
      });
      if (v) add({
        nivå: 'info', vekt: 'noytral', tittel: 'Videoformat',
        tekst: [Math.round(v.width) + '×' + Math.round(v.height), v.fps ? fmtNum(v.fps) + ' bilder/s' : '', video.duration ? fmtNum(video.duration) + ' s' : '', v.codec, v.keyframeEvery && v.fps ? 'nøkkelbilde hvert ' + fmtNum(v.keyframeEvery / v.fps) + ' s' + (v.keyframeRegular ? ' (helt fast)' : '') : '', video.tracks.some(t => t.handler === 'soun') ? 'med lyd' : 'uten lyd', 'beholder ' + (video.brand || '?')].filter(Boolean).join(', ') + '.',
        betyr: 'Tekniske fakta som kan sammenlignes med det kilden sier (f.eks. telefonmodell og opptaksinnstillinger).',
        betyrIkke: 'Noe om ekthet alene. Fast nøkkelbildeintervall er vanlig etter eksport; mobiltelefoner bruker ofte rundt 1 s.',
      });
    }

    // ---------- 5. Filnavn ----------
    const hints = (typeof module !== 'undefined' && module.exports ? require('./media-meta.js') : root.VfMeta).nameHints(name);
    if (hints.length) add({
      nivå: 'spor', vekt: 'ai', tittel: 'Filnavnet ligner navnet fra ' + hints.join(', '),
      tekst: '«' + name + '».',
      betyr: 'Fila kan ha beholdt standardnavnet fra et AI-verktøy.',
      betyrIkke: 'Noe sikkert. Filnavn kan settes av hvem som helst, og like navn finnes tilfeldig.',
    });

    return out;
  }

  const AI_TOOLS = [
    [/midjourney/i, 'Midjourney'], [/dall[·\-. ]?e/i, 'DALL·E'], [/firefly/i, 'Adobe Firefly'], [/stable ?diffusion|sdxl|automatic1111|comfyui/i, 'Stable Diffusion/ComfyUI'],
    [/imagen|nano ?banana|gemini/i, 'Google (Imagen/Gemini)'], [/\bsora\b/i, 'Sora'], [/\bveo\b/i, 'Veo'], [/runway/i, 'Runway'], [/\bkling\b/i, 'Kling'],
    [/gpt-?image|gpt-4o|chatgpt|openai/i, 'OpenAI'], [/leonardo/i, 'Leonardo'], [/ideogram/i, 'Ideogram'], [/\bflux\b/i, 'FLUX'], [/novelai/i, 'NovelAI'],
    [/grok|aurora/i, 'xAI Grok'], [/hailuo|minimax/i, 'Hailuo/MiniMax'], [/seedance|seedream|dreamina|jimeng/i, 'ByteDance'], [/\bpika\b/i, 'Pika'], [/luma|dream machine/i, 'Luma'],
  ];
  const lc = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  function fmtNum(n) { return (Math.round(n * 100) / 100).toString().replace('.', ','); }
  function fmtDate(d) { try { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? String(d) : x.toLocaleString('nb-NO'); } catch (e) { return String(d); } }
  function parseIso6709(s) {
    const m = String(s || '').match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  const api = { build, parseIso6709, fmtNum };
  root.VfFindings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
