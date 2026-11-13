"""Lager plugins/presentasjon/index.html fra prototypen (presentasjon-prototype.html).

Prototypen er stedet der lysbildetyper og eksport utvikles; denne fila gjør den om
til en Studio-plugin:
  * lokale skript (lib/) i stedet for CDN, ingen Google Fonts (fontene er installert)
  * lagring i Studio-dokumentet (stateSave/stateLoad) i stedet for localStorage
  * bilder, klipp og lyd lagres som filstier (file://), så Studio kopierer dem inn i Medier/
  * «Lag Keynote» lagrer .key i dokumentets Eksport/ via Studio (AppleScript)
  * lydbølge-videoer lages av Studio (ffmpeg) i valgt palett
Bruk: python3 lag-presentasjon-plugin.py prototype.html ut/index.html
"""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
h = open(src, encoding='utf-8').read()


def rep(a, b, count=1):
    global h
    n = h.count(a)
    assert n == count, f'fant {n} av: {a[:80]!r}'
    h = h.replace(a, b)


# ---------- hode ----------
rep('<meta name="claude:viewport-fit-sides" content="cover">\n<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,600&display=swap">\n',
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; '
    'img-src \'self\' data: blob: file:; media-src \'self\' blob: file:; connect-src \'self\' blob: data:; font-src \'self\' data:;">\n')
rep('<title>Studio Presentasjon</title>', '<title>Presentasjon · Faktisk Studio</title>')
rep('--slide-serif:"Newsreader","Newsreader SemiBold",Georgia,serif;', '--slide-serif:"Newsreader SemiBold","Newsreader",Georgia,serif;')
rep('<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.min.js"></script>',
    '<script src="lib/jszip.min.js"></script>\n<script src="lib/pptxgen.min.js"></script>')

# ---------- topplinje og dokumentlinje ----------
rep('<div class="brand"><b>Faktisk Studio</b><span>Presentasjon · prototype</span></div>',
    '<button class="btn small" id="homeBtn" title="Tilbake til forsiden">← Malside</button>\n'
    '    <div class="brand"><b>Faktisk Studio</b><span>Presentasjon</span></div>')
rep('<label class="deckpick"><span>Eksempel</span><select id="deckSel" aria-label="Velg eksempelpresentasjon"></select></label>',
    '<label class="deckpick"><span>Start fra eksempel</span><select id="deckSel" aria-label="Start fra et eksempel"></select></label>')
rep('title="Laster ned presentasjonen som .pptx som åpnes i Keynote">Lag Keynote</button>',
    'title="Lager Keynote-fila i dokumentets Eksport-mappe og åpner den">Lag Keynote</button>')
rep('      <div class="insp" id="inspDoc"></div>',
    '      <div class="docslot"><select id="projectSelect" hidden></select><button class="btn small" id="saveProjectBtn">Lagre…</button></div>\n'
    '      <div class="insp" id="inspDoc"></div>')
i = h.index('<div class="note" id="note"><p>')
j = h.index('</p>', i)
h = h[:i] + ('<div class="note" id="note"><p><b>Presentasjon.</b> Skriv rett i lysbildet, slipp bilder, video eller lyd på feltene, og dra lysbildene i lista for å endre rekkefølge. '
             'Lagre som dokument til høyre, så kopieres mediene inn i dokumentmappa. «Lag Keynote» legger Keynote-fila i Eksport-mappa og åpner den.') + h[j:]
rep('.sep{border-top:1px solid var(--ui-line)}', '.sep{border-top:1px solid var(--ui-line)}\n.docslot{margin:0 0 12px}.docslot .fk-docbar button{font-size:12px}')

# ---------- tilstand: Studio-dokumentet ----------
a = h.index("const STORE = 'studio-presentasjon-v1';")
b = h.index('\n', h.index('function save(){ MEM[deck]')) + 1
h = h[:a] + r"""const PLUGIN_ID = 'presentasjon', STORE = 'studio-presentasjon-v1';   // STORE: bare for «Skjul»-valget på merknaden
let deck = 'sujo1', doc, slides, sel = 0;
function freshDoc(d){ return {title:DECKS[d].name, palette:'akademisk', sender:'sujo'}; }
// eksemplene i prototypen har medier på nett; i Studio legger man inn egne filer
function loadDeck(d){ deck = d; sel = 0; doc = freshDoc(d); slides = DECKS[d].slides(); slides.forEach(s => { delete s.def; }); }
loadDeck('sujo1');
const keepImg = img => { const o = {}; for (const k in img || {}) if (img[k] && /^file:/.test(img[k].url || '')) o[k] = {...img[k]}; return o; };
let saveT = 0, restoring = false;
function save(){
  if (restoring || !window.faktisk || !window.faktisk.stateSave) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => { window.faktisk.stateSave(PLUGIN_ID, {format:1, doc, slides:slides.map(s => ({...s, img:keepImg(s.img)}))}).catch(() => {}); }, 400);
}
async function restore(){
  try {
    const r = await window.faktisk.stateLoad(PLUGIN_ID), x = r && r.ok && r.state;
    if (!(x && Array.isArray(x.slides) && x.slides.length && x.slides.every(s => TYPES[s.type]))) return;
    restoring = true;
    doc = {...freshDoc('sujo1'), ...x.doc}; if (!PALETTES[doc.palette]) doc.palette = 'faktisk-lys';
    slides = x.slides.map(s => ({...s, img:s.img || {}})); sel = 0;
    uid = Math.max(uid, ...slides.map(s => s.id)) + 1;
    document.getElementById('docTitle').value = doc.title; drawAll();
  } catch (e) { console.error(e); } finally { restoring = false; }
}
""" + h[b:]

# ---------- medier som filstier ----------
rep("""  const old = slide.img[role]; if (old) URL.revokeObjectURL(old.url);
  slide.img[role] = {url:URL.createObjectURL(file), kind:file.type.startsWith('video')?'video':'image', x:.5, y:.5, z:1, name:file.name};
  refresh();""",
"""  const old = slide.img[role]; if (old && old.url.startsWith('blob:')) URL.revokeObjectURL(old.url);
  slide.img[role] = {url:fileUrl(file), kind:file.type.startsWith('video')?'video':'image', x:.5, y:.5, z:1, name:file.name};
  refresh(); save();""")
rep("function setMedia(slide, role, file){", """// filsti når Studio kan gi den (da kopieres fila inn i dokumentets Medier/), ellers blob
function fileUrl(file){
  const f = window.faktisk || {}, get = f.pathForFile || f.bevisPathForFile;
  const p = get ? get(file) : '';
  return p ? 'file://' + encodeURI(p).replace(/#/g, '%23') : URL.createObjectURL(file);
}
function setMedia(slide, role, file){""")
rep("slide.img.lyd = {url:URL.createObjectURL(file), kind:'audio'};", "slide.img.lyd = {url:fileUrl(file), kind:'audio'};")
rep("async function lydUrl(src){ if (src.startsWith('blob:')) return src;", "async function lydUrl(src){ if (src.startsWith('blob:') || src.startsWith('file:')) return src;")

# ---------- eksempler ----------
rep("for (const [k, d] of Object.entries(DECKS)) { const o = document.createElement('option'); o.value = k; o.textContent = d.name; deckSel.appendChild(o); }\ndeckSel.value = deck;\n"
    "deckSel.addEventListener('change', () => { save(); loadDeck(deckSel.value); save(); titleIn.value = doc.title; drawAll(); });",
    "{ const o = document.createElement('option'); o.value = ''; o.textContent = 'Velg …'; deckSel.appendChild(o); }\n"
    "for (const [k, d] of Object.entries(DECKS)) { const o = document.createElement('option'); o.value = k; o.textContent = d.name; deckSel.appendChild(o); }\n"
    "deckSel.value = '';\n"
    "deckSel.addEventListener('change', () => { const v = deckSel.value; deckSel.value = ''; if (!v) return;\n"
    "  if (!confirm(`Erstatte lysbildene med eksempelet «${DECKS[v].name}»? Bilder og klipp må legges inn på nytt.`)) return;\n"
    "  loadDeck(v); save(); titleIn.value = doc.title; drawAll(); });")

# ---------- Lag Keynote via Studio ----------
a = h.index("makeBtn.addEventListener('click', async () => {")
b = h.index('\n});\n', a) + 4
h = h[:a] + r"""// Studio: les lokale filer og lag lydbølge-videoer i valgt palett
EXPORT_HOOKS.readFile = async (url) => { const r = await window.faktisk.presentationReadFile(url); if (!r || !r.ok) throw new Error(r && r.error || 'Kunne ikke lese ' + url); return r; };
function waveBasePng(s, pal){
  const W = 1660, H = 310, WY = 30, WH = 230, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = pal.flate; g.fillRect(0, 0, W, H); g.fillStyle = pal.aksent;
  const {p} = waveFor(s), bw = W / p.length;
  p.forEach((v, i) => { const hh = Math.max(4, v*WH), x = i*bw + bw*.2, w = bw*.6, y = WY + (WH-hh)/2, r = w/2;
    g.beginPath(); g.roundRect ? g.roundRect(x, y, w, hh, r) : g.rect(x, y, w, hh); g.fill(); });
  return c.toDataURL('image/png');
}
EXPORT_HOOKS.waveVideo = async (s, pal, from, to) => {
  if (!window.faktisk.presentationWaveform) return null;
  const src = lydSrc(s); if (!src || !src.startsWith('file:')) return null;
  const r = await window.faktisk.presentationWaveform({src, base:waveBasePng(s, pal), dur:waveFor(s).dur, from, to,
    tekst:exHex('tekst', pal), dempet:exHex('dempet', pal)});
  if (!r || !r.ok) { console.warn('lydbølge', r && r.error); return null; }
  return 'file://' + encodeURI(r.path).replace(/#/g, '%23');
};
makeBtn.addEventListener('click', async () => {
  if (!window.faktisk || !window.faktisk.presentationKeynote) { toast('«Lag Keynote» krever en nyere versjon av Faktisk Studio.'); return; }
  makeBtn.disabled = true; const label = makeBtn.textContent;
  try {
    const blob = await exportPptx(doc, slides, {onProgress:(i, n, msg) => { makeBtn.textContent = msg || `Lager … ${i}/${n}`; }});
    makeBtn.textContent = 'Åpner i Keynote …';
    const info = window.faktisk.documentInfo ? await window.faktisk.documentInfo() : null;
    const r = await window.faktisk.presentationKeynote({bytes:new Uint8Array(await blob.arrayBuffer()), title:doc.title, folder:info && info.folder});
    if (r.canceled) return;
    if (!r.ok) throw new Error(r.error || 'ukjent feil');
    const name = r.path.split('/').pop();
    toast(r.fallback ? `Studio fikk ikke styre Keynote, så «${name}» er åpnet i Keynote. Velg Arkiv › Lagre der for å få en Keynote-fil.`
                     : `«${name}» er lagret${info ? ' i Eksport-mappa' : ''} og åpnet i Keynote.`);
  } catch (err) { console.error(err); toast('Keynote-fila kunne ikke lages: ' + err.message); }
  finally { makeBtn.disabled = false; makeBtn.textContent = label; }
});
document.getElementById('homeBtn').addEventListener('click', () => window.faktisk && window.faktisk.goHome());
""" + h[b:]

# ---------- start: hent dokumentet fra Studio ----------
k = h.rindex('\ndrawAll();\n')
h = h[:k] + '\ndrawAll();\nif (window.faktisk && window.faktisk.stateLoad) restore();\n' + h[k + len('\ndrawAll();\n'):]

assert 'localStorage' not in h.split('/* ---------- tilstand')[1].split('/* ---------- tegning')[0]
open(dst, 'w', encoding='utf-8').write(h)
print('ok', dst, len(h))
