// Faktisk Studio — katalog for forsiden: grupper, kategorier og tegninger.
// Plugins som ikke står her, havner i «Andre» med navn og beskrivelse fra
// manifestet og en enkel standardtegning.
(function () {
// ---------- tegninger: hvite strek på blått, samme formspråk for alle ----------
const W = 'stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="rgba(255,255,255,.28)"';
const S = 'fill="#fff"';
const vid = (x=10,y=8,w=100,h=56) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" ${F}/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" ${W}/>`;
const img = (x,y,w,h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" ${F}/><path d="M${x+4} ${y+h-4} l${w*.3} ${-h*.42} l${w*.18} ${h*.2} l${w*.14} ${-h*.14} l${w*.3} ${h*.36}" ${W}/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" ${W}/>`;
const lines = (x,y,n,w,gap=7) => Array.from({length:n},(_,i)=>`<path d="M${x} ${y+i*gap} h${i===n-1?w*.6:w}" ${W}/>`).join('');
const phone = (x,y,w=22,h=40,f=F) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" ${f}/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" ${W}/>`;
const ART = {
  'looping-video': vid() + `<path d="M48 36a12 12 0 1 1 6 10" ${W}/><path d="M50 44l4 2 1-5" ${W}/>`,
  'video-player': vid() + `<circle cx="60" cy="36" r="13" ${S}/><path d="M56 29l11 7-11 7z" fill="#0042D6"/>`,
  'video-hoydepunkter': vid(10,6,100,46) + `<path d="M12 62h96" ${W}/><circle cx="34" cy="62" r="4" ${S}/><circle cx="62" cy="62" r="4" ${S}/><circle cx="92" cy="62" r="4" ${S}/>`,
  'videoslider': phone(16,14,24,44) + phone(48,8,26,52,S) + phone(82,14,24,44) + `<path d="M8 36l-3 0M115 36l-3 0" ${W}/>`,
  'podkast': vid() + `${[22,30,38,46,54,62,70,78,86,94].map((x,i)=>`<path d="M${x} ${36-[6,12,8,16,10,14,6,12,9,5][i]}v${2*[6,12,8,16,10,14,6,12,9,5][i]}" ${W}/>`).join('')}`,
  'bilde-markering': img(10,8,100,56) + `<circle cx="74" cy="30" r="11" ${W}/><rect x="16" y="14" width="34" height="14" rx="3" ${S}/><path d="M50 21 L63 27" ${W}/>`,
  'bildeanalyse': `<rect x="8" y="14" width="30" height="44" rx="4" ${F}/><rect x="8" y="14" width="30" height="44" rx="4" stroke="#FFD166" stroke-width="3" fill="none"/><rect x="45" y="14" width="30" height="44" rx="4" ${F}/><rect x="45" y="14" width="30" height="44" rx="4" ${W}/><rect x="82" y="14" width="30" height="44" rx="4" ${F}/><rect x="82" y="14" width="30" height="44" rx="4" stroke="#FFD166" stroke-width="3" fill="none"/>`,
  'for-og-etter': img(10,8,100,56) + `<rect x="10" y="8" width="48" height="56" rx="5" fill="rgba(0,0,0,.25)"/><path d="M58 6v60" ${W}/><circle cx="58" cy="36" r="8" ${S}/><path d="M55 33l-3 3 3 3M61 33l3 3-3 3" stroke="#0042D6" stroke-width="2" fill="none"/>`,
  'pop-up': img(8,30,30,22) + `<path d="M42 40l12-8" ${W}/><path d="M50 30l4 2-1 4" ${W}/>` + img(58,6,54,40) + lines(58,54,2,46,7),
  'parallax-collage': `<rect x="12" y="20" width="44" height="36" rx="4" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="2"/><rect x="40" y="10" width="44" height="36" rx="4" fill="rgba(255,255,255,.32)" stroke="#fff" stroke-width="2"/><rect x="66" y="26" width="44" height="36" rx="4" fill="rgba(255,255,255,.5)" stroke="#fff" stroke-width="2"/><path d="M8 40v14M8 54l-3-4M8 54l3-4" ${W}/>`,
  'medieslider': `<rect x="4" y="12" width="16" height="40" rx="4" ${F}/>` + img(26,8,68,48) + `<rect x="100" y="12" width="16" height="40" rx="4" ${F}/><circle cx="52" cy="64" r="2.5" ${S}/><circle cx="60" cy="64" r="2.5" fill="rgba(255,255,255,.5)"/><circle cx="68" cy="64" r="2.5" fill="rgba(255,255,255,.5)"/>`,
  'hendelseskart': `<path d="M10 14l30-6 30 8 40-8v52l-40 8-30-8-30 6z" ${F}/><path d="M10 14l30-6 30 8 40-8v52l-40 8-30-8-30 6z" ${W}/><path d="M40 8v52M70 16v52" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>` + [[30,30,'1'],[60,44,'2'],[88,26,'3']].map(([x,y,t])=>`<circle cx="${x}" cy="${y}" r="8" ${S}/><text x="${x}" y="${y+4}" text-anchor="middle" font-size="10" font-weight="700" font-family="Inter,Arial" fill="#0042D6">${t}</text>`).join(''),
  'tabell': [0,1,2,3].map(i=>`<path d="M10 ${16+i*14}h100" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/><rect x="10" y="${10+i*14}" width="10" height="10" rx="2" ${S}/><path d="M26 ${15+i*14}h22" ${W}/><rect x="56" y="${11+i*14}" width="${[48,30,40,18][i]}" height="8" rx="2" ${S}/>`).join(''),
  'metodeboks': `<rect x="12" y="6" width="96" height="60" rx="6" ${F}/><rect x="12" y="6" width="96" height="60" rx="6" ${W}/><path d="M22 18h40" stroke="#fff" stroke-width="4" stroke-linecap="round"/>` + [0,1,2].map(i=>`<circle cx="26" cy="${32+i*11}" r="4" ${S}/><path d="M36 ${32+i*11}h${[54,44,50][i]}" ${W}/>`).join(''),
  'personbilde': `<circle cx="36" cy="36" r="24" ${F}/><circle cx="36" cy="36" r="24" ${W}/><circle cx="36" cy="30" r="8" ${S}/><path d="M22 52a14 12 0 0 1 28 0" ${S}/><path d="M70 30h40" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M70 42h30" ${W}/>`,
  'utklipp-boks': `<rect x="16" y="8" width="88" height="56" rx="12" ${F}/><rect x="16" y="8" width="88" height="56" rx="12" ${W}/><g transform="rotate(-10 60 36)"><rect x="40" y="22" width="40" height="26" rx="3" ${S}/><circle cx="50" cy="33" r="4" fill="#0042D6"/><path d="M58 31h16M58 38h12" stroke="#0042D6" stroke-width="2"/></g>`,
  'chatbobler': `<rect x="10" y="8" width="56" height="16" rx="8" ${F}/><rect x="10" y="8" width="56" height="16" rx="8" ${W}/><rect x="52" y="30" width="58" height="16" rx="8" ${S}/><rect x="10" y="52" width="44" height="14" rx="7" ${F}/><rect x="10" y="52" width="44" height="14" rx="7" ${W}/>`,
  'reaksjoner': [0,1,2].map(i=>`<rect x="12" y="${8+i*20}" width="16" height="16" rx="3" ${S}/><path d="M36 ${13+i*20}h${[70,60,66][i]}M36 ${20+i*20}h${[46,52,38][i]}" ${W}/>`).join(''),
  'kontokart': [0,1,2].map(i=>`<rect x="10" y="${10+i*19}" width="46" height="13" rx="3" ${F}/><rect x="10" y="${10+i*19}" width="46" height="13" rx="3" ${W}/><path d="M60 ${16+i*19}C76 ${16+i*19} 78 36 92 36" ${W}/>`).join('') + `<circle cx="100" cy="36" r="10" ${S}/>`,
  'prikkeklode': (()=>{let d='';for(let y=-24;y<=24;y+=6)for(let x=-24;x<=24;x+=6){if(x*x+y*y<=24*24)d+=`<circle cx="${60+x}" cy="${36+y}" r="1.7" fill="#fff" opacity="${0.45+0.55*Math.cos(x/30)}"/>`}return d+`<path d="M44 28C60 2 88 10 92 30" stroke="#FFD166" stroke-width="2.4" fill="none" stroke-linecap="round"/><circle cx="92" cy="30" r="3" fill="#FFD166"/>`})(),
  'mobilnettverk': `<path d="M30 22L60 40L92 18M60 40L84 56M60 40L28 56" stroke="rgba(255,255,255,.6)" stroke-width="2"/>` + phone(20,8,16,26) + phone(52,26,18,30,S) + phone(84,4,16,26) + phone(76,44,16,24) + phone(20,44,16,24),
  'logo-nettverk': `<path d="M60 36L22 16M60 36L98 14M60 36L18 56M60 36L100 58M60 36L60 6" stroke="rgba(255,255,255,.65)" stroke-width="2"/>` + [[22,16],[98,14],[18,56],[100,58],[60,6]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="6" ${F}/><circle cx="${x}" cy="${y}" r="6" ${W}/>`).join('') + `<circle cx="60" cy="36" r="14" ${S}/><text x="60" y="40" text-anchor="middle" font-size="11" font-weight="800" font-family="Inter,Arial" fill="#0042D6">F.</text>`,
  'loop-illustrasjon': `<circle cx="60" cy="36" r="26" stroke="rgba(255,255,255,.5)" stroke-width="2" fill="none" stroke-dasharray="4 5"/>` + [0,72,144,216,288].map(a=>{const r=a*Math.PI/180;return `<rect x="${60+26*Math.cos(r)-6}" y="${36+26*Math.sin(r)-6}" width="12" height="12" rx="3" ${S}/>`}).join('') + `<circle cx="60" cy="36" r="9" ${F}/><circle cx="60" cy="36" r="9" ${W}/>`,
  'presentasjon': `<rect x="8" y="8" width="104" height="58" rx="5" ${F}/><rect x="8" y="8" width="104" height="58" rx="5" ${W}/><path d="M18 22h46" stroke="#fff" stroke-width="5" stroke-linecap="round"/>` + [0,1,2].map(i=>`<rect x="${18+i*31}" y="34" width="26" height="22" rx="4" ${i===1?S:F}/>`).join(''),
  'keynote-klipp': `<rect x="8" y="8" width="104" height="58" rx="5" ${F}/><rect x="8" y="8" width="104" height="58" rx="5" ${W}/><path d="M18 22h34M18 30h26" ${W}/><rect x="70" y="14" width="26" height="46" rx="8" ${S}/><path d="M80 31l8 6-8 6z" fill="#0042D6"/>`,
  'klippsamler': [0,1,2].map(i=>`<rect x="${8+i*36}" y="10" width="30" height="22" rx="4" ${F}/><rect x="${8+i*36}" y="10" width="30" height="22" rx="4" ${W}/>`).join('') + `<path d="M60 38v8M56 42l4 4 4-4" ${W}/><rect x="8" y="50" width="104" height="14" rx="4" ${S}/><path d="M43 50v14M78 50v14" stroke="#0042D6" stroke-width="2"/>`,
  'teksting': vid() + `<rect x="26" y="44" width="68" height="13" rx="3" fill="rgba(0,0,0,.45)"/><path d="M32 50.5h56" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  'video-sensur': vid() + (()=>{let d='';for(let y=0;y<4;y++)for(let x=0;x<4;x++)d+=`<rect x="${48+x*6}" y="${18+y*6}" width="6" height="6" fill="#fff" opacity="${[.9,.5,.75,.35][(x+y)%4]}"/>`;return d})() + `<path d="M40 60a20 14 0 0 1 40 0" ${S}/><path d="M14 66h92" stroke="#FFD166" stroke-width="2.4" stroke-dasharray="2 4"/>`,
  'bildemal': img(10,8,100,56) + `<rect x="18" y="16" width="34" height="26" rx="3" stroke="#fff" stroke-width="3" fill="rgba(0,0,0,.2)"/><circle cx="82" cy="40" r="13" stroke="#fff" stroke-width="3" fill="rgba(0,0,0,.2)"/>`,
  'bilde-sensur': img(10,8,100,56) + (()=>{let d='';for(let y=0;y<4;y++)for(let x=0;x<5;x++)d+=`<rect x="${58+x*7}" y="${16+y*7}" width="7" height="7" fill="#fff" opacity="${[.85,.45,.7,.3,.6][(x*2+y)%5]}"/>`;return d})(),
  'some-bilde': `<rect x="28" y="2" width="64" height="68" rx="4" ${F}/><rect x="28" y="2" width="64" height="68" rx="4" ${W}/><path d="M60 2v48" stroke="#fff" stroke-width="2"/><rect x="28" y="50" width="64" height="20" fill="rgba(0,0,0,.35)"/><path d="M34 58h40M34 64h28" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><text x="86" y="12" text-anchor="end" font-size="8" font-weight="800" font-family="Inter,Arial" fill="#fff">F.</text>`,
  'bevissikring': `<rect x="8" y="6" width="72" height="50" rx="5" ${F}/><rect x="8" y="6" width="72" height="50" rx="5" ${W}/><path d="M8 16h72" ${W}/><circle cx="15" cy="11" r="1.6" ${S}/><circle cx="21" cy="11" r="1.6" ${S}/>` + lines(16,26,3,52,8) + `<rect x="78" y="34" width="34" height="32" rx="5" ${S}/><path d="M95 40v14M89 49l6 6 6-6" stroke="#0042D6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  'verifisering': img(8,8,72,54) + `<circle cx="84" cy="38" r="17" fill="#0042D6" stroke="#fff" stroke-width="3"/><path d="M96 50l12 12" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M77 38l5 5 9-10" stroke="#FFD166" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'skjermarkiv': [0,1,2,3,4,5].map(i=>`<rect x="${8+(i%3)*26}" y="${8+Math.floor(i/3)*30}" width="22" height="26" rx="3" ${i===4?S:F}/>`).join('') + `<circle cx="96" cy="30" r="12" fill="#0042D6" stroke="#fff" stroke-width="3"/><path d="M104 39l9 9" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`,
};


const GROUPS = [
  { id: 'artikkel', title: 'Video og bilder til artikkelen', sub: 'Interaktive embeds som lenker til filer i Labrador', items: [
    ['looping-video','Looping videoklipp','Kort klipp uten lyd som går i løkke i artikkelen.','embed','loop gif animasjon'],
    ['video-player','Videoavspiller','Video med Faktisk-avspillerknapp og valgfri tekst.','embed','video spiller'],
    ['video-hoydepunkter','Videohøydepunkter','Leseren hopper rett til de viktige øyeblikkene.','embed','markører kapitler sakte film'],
    ['videoslider','Videoslider','Stående videoer side om side, til forsiden og artikler.','embed','tiktok reels shorts stående'],
    ['podkast','Podkast','Spillerboks for videopodkast fra YouTube eller Mux.','embed','youtube mux lyd episode'],
    ['bilde-markering','Bilde med markering','Tekstbokser, piler og ringer på et bilde.','embed','pil sirkel annotering'],
    ['bildeanalyse','Bildeanalyse','Fargede rammer viser hvilke bilder som hører sammen.','embed','sammenheng sammenligne'],
    ['for-og-etter','Før og etter','To bilder med en slider leseren drar i.','embed','sammenligne slider'],
    ['pop-up','Pop-up','Bilde som åpnes stort med bildetekst og fotograf.','embed','lightbox forstørr'],
    ['parallax-collage','Parallax-kollasj','Bilder som beveger seg i ulik fart når man ruller.','embed','scroll dybde'],
    ['medieslider','Medieslider','Bla gjennom en serie bilder og videoer.','embed','karusell galleri skjermbilder'],
    ['hendelseskart','Hendelseskart','Nummererte punkter på kart eller bilde, med popup.','embed','kart steder tidslinje'],
  ]},
  { id: 'grafikk', title: 'Grafikk og fakta til artikkelen', sub: 'Faktaboks, tabeller, personer, nettverk og animasjoner', items: [
    ['tabell','Tabell','Tabell i Faktisk-stil med bilder, søyler og andeler.','embed','tall data søylediagram'],
    ['metodeboks','Metodeboks','Metode og forbehold med ikoner for dokumentert og observert.','embed','faktaboks kilder forbehold'],
    ['personbilde','Personbilde','Bilde med navn og tittel, i boks eller sirkel.','embed','portrett byline kilde'],
    ['utklipp-boks','Utklipp i boks','Frilagt bilde i en farget boks.','embed','png frilagt objekt'],
    ['chatbobler','Chatbobler','Gjenskap en chat i stilen til iMessage, WhatsApp og andre.','embed','melding sms whatsapp telegram'],
    ['reaksjoner','Reaksjoner','Liste over SoMe-innlegg med miniatyrbilde og tekst.','embed','kommentarer innlegg sosiale medier'],
    ['kontokart','Kontokart','Kontoer og landene de styres fra.','embed','kontoer land påvirkning'],
    ['prikkeklode','Prikkeklode','Roterbar klode med buer mellom land.','embed','globus verden land påvirkning'],
    ['mobilnettverk','Mobilnettverk','Skjermbilder på mobiler i et glødende nettverk.','embed','telefoner skjermbilder nettverk'],
    ['logo-nettverk','Logo-nettverk','Animert toppgrafikk der et nettverk vokser ut fra en logo.','embed','animasjon toppbilde nettverk'],
    ['loop-illustrasjon','Loop-illustrasjon','Animert illustrasjon av bilder, logoer og ringer.','embed','animasjon toppbilde'],
  ]},
  { id: 'presentasjon', title: 'Presentasjon og video', sub: 'Lager filer på maskinen, til Keynote og Final Cut', items: [
    ['presentasjon','Presentasjon','Lysbilder i Faktisk-stil som blir en ferdig Keynote.','fil','keynote foredrag undervisning sujo','soon'],
    ['keynote-klipp','Keynote-klipp','Videoklipp med runde hjørner, klare for Keynote.','fil','keynote presentasjon mobil'],
    ['klippsamler','Klippsamler','Trim flere klipp og sett dem sammen til ett.','fil','sammensetting trim video'],
    ['teksting','Teksting','Transkriber tale og lag undertekster, helt lokalt.','fil','undertekster whisper srt transkripsjon'],
    ['video-sensur','Videosensur','Sladd ansikter som beveger seg i en video.','fil','blur sladd anonymisering ansikt'],
  ]},
  { id: 'bilder', title: 'Bilder og SoMe', sub: 'Lager bildefiler', items: [
    ['bildemal','Bildemal','Bakgrunnsbilde med bokser og sirkler, rett til utklippstavla.','fil','komponere utsnitt'],
    ['bilde-sensur','Bildesensur','Sladd ansikter eller deler av et bilde.','fil','blur sladd anonymisering'],
    ['some-bilde','SoMe-bilde','Kvadratiske bilder til Facebook og sosiale medier.','fil','facebook instagram deling'],
  ]},
  { id: 'kilder', title: 'Kilder og verifisering', sub: 'Sikre, undersøke og finne igjen materiale', items: [
    ['bevissikring','Bevissikring','Sikre nettsider og innlegg før de forsvinner.','fil','arkiv skjermbilde pdf nettarkiv'],
    ['verifisering','Verifisering','Undersøk om en video eller et bilde er ekte.','verktoy','c2pa exif metadata ekte falsk'],
    ['skjermarkiv','Skjermarkiv','Søk i skjermbilder og skjermopptak i en mappe.','verktoy','søk skjermopptak arkiv'],
  ]},
];
const TAG = { embed: ['Embed',''], fil: ['Lager fil','tag--fil'], verktoy: ['Verktøy',''] };

// Kategorier på tvers av gruppene. En plugin kan høre til flere.
const CATS = [
  ['video', 'Video', 'looping-video video-player video-hoydepunkter videoslider podkast keynote-klipp klippsamler teksting video-sensur'],
  ['bilder', 'Bilder', 'bilde-markering bildeanalyse for-og-etter pop-up parallax-collage medieslider bildemal bilde-sensur some-bilde utklipp-boks'],
  ['grafikk', 'Grafikk', 'tabell metodeboks personbilde utklipp-boks chatbobler reaksjoner loop-illustrasjon logo-nettverk'],
  ['kart', 'Kart og nettverk', 'hendelseskart kontokart prikkeklode mobilnettverk logo-nettverk'],
  ['some', 'SoMe', 'some-bilde reaksjoner chatbobler videoslider'],
  ['presentasjon', 'Presentasjon', 'presentasjon keynote-klipp klippsamler'],
  ['sladd', 'Sladding', 'bilde-sensur video-sensur'],
  ['kilder', 'Kilder', 'bevissikring verifisering skjermarkiv'],
].map(([id, label, ids]) => ({ id, label, ids: new Set(ids.split(' ')) }));

window.HUB_CATALOG = { ART, GROUPS, TAG, CATS };
})();
