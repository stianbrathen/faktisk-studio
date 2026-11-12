// Faktisk Studio · Chatbobler
//
// Gjenskaper en chatsamtale i stilen til de vanligste meldingsappene
// (iMessage, SMS på iPhone, WhatsApp, Telegram, Messenger, Signal og
// Meldinger på Android). To visninger:
//   «Chatvindu»   — topplinje, bakgrunn og tekstfelt som i appen
//   «Bare bobler» — kun boblene, transparent rundt (f.eks. én enkelt boble
//                   som popper opp midt i artikkelen)
//
// Animasjon hos leseren: når embedden kommer inn i skjermen, spilles
// samtalen av — skriveindikator (•••) før svar fra den andre, og dine
// meldinger skrives bokstav for bokstav i tekstfeltet før de «sendes».
// Høyden låses før avspilling, så artikkelen aldri hopper. Uten JS, med
// «redusert bevegelse» eller uten IntersectionObserver vises hele
// samtalen statisk.
//
// Fonter: appenes egne systemfonter (SF Pro på Apple, Roboto på Android,
// Segoe på Windows) via systemfont-stacken — ingen fontfiler distribueres.
// Emojis er enhetens egne, akkurat som i appene.
//
// Embedden er selvstendig, bilder lenkes med URL fra Labrador (ALDRI
// base64), og forhåndsvisningen er NØYAKTIG embed-markupen.

const PLUGIN_ID = 'chatbobler';

(async () => {
  try {
    const [appV, plugins] = await Promise.all([
      window.faktisk.appVersion(),
      window.faktisk.pluginStatus(),
    ]);
    const me = (plugins || []).find(p => p.id === PLUGIN_ID);
    const el = document.getElementById('appVersion');
    if (el && appV) {
      el.textContent = me ? 'v' + appV + ' · plugin v' + me.version : 'v' + appV;
    }
  } catch (e) {}
})();

// ============================================================
//  App-stiler
// ============================================================

const SYS_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const ANDROID_FONT = '"Google Sans Text", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"';

// Felles for iMessage og SMS (iPhone)
const IOS_BASE = {
  font: SYS_FONT,
  radius: '1.1em', grp: null, tail: 'imessage',
  inlineMeta: false, status: 'below', header: 'center',
  avatarInLog: false, sep: 'plain', headSub: '',
  avatarBg: 'linear-gradient(180deg,#A6ABB8,#868A96)', avatarInk: '#fff',
  gapSame: '.14em', gapNew: '.55em',
};

const APPS = {
  imessage: Object.assign({}, IOS_BASE, {
    label: 'iMessage (iPhone)', placeholder: 'iMessage', statusText: 'Lest',
    light: { bg: '#FFFFFF', me: '#0B84FE', meInk: '#FFFFFF', them: '#E9E9EB', themInk: '#000000',
      meta: '#8E8E93', metaMe: 'rgba(255,255,255,.8)', read: '#8E8E93',
      head: 'rgba(246,246,246,.96)', headInk: '#000000', headSub: '#8E8E93', line: 'rgba(0,0,0,.14)',
      accent: '#0B84FE', comp: '#FFFFFF', field: '#FFFFFF', fieldLine: '#C7C7CC', ph: '#A1A1A6',
      sepBg: 'transparent', sepInk: '#8E8E93', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#000000', me: '#0A84FF', meInk: '#FFFFFF', them: '#262628', themInk: '#FFFFFF',
      meta: '#8E8E93', metaMe: 'rgba(255,255,255,.8)', read: '#8E8E93',
      head: 'rgba(28,28,30,.96)', headInk: '#FFFFFF', headSub: '#8E8E93', line: 'rgba(255,255,255,.14)',
      accent: '#0A84FF', comp: '#000000', field: '#000000', fieldLine: '#3A3A3C', ph: '#636366',
      sepBg: 'transparent', sepInk: '#8E8E93', frameLine: 'rgba(255,255,255,.12)' },
  }),
  sms: Object.assign({}, IOS_BASE, {
    label: 'SMS (iPhone)', placeholder: 'Tekstmelding', statusText: 'Levert',
    light: { bg: '#FFFFFF', me: '#34C759', meInk: '#FFFFFF', them: '#E9E9EB', themInk: '#000000',
      meta: '#8E8E93', metaMe: 'rgba(255,255,255,.85)', read: '#8E8E93',
      head: 'rgba(246,246,246,.96)', headInk: '#000000', headSub: '#8E8E93', line: 'rgba(0,0,0,.14)',
      accent: '#34C759', comp: '#FFFFFF', field: '#FFFFFF', fieldLine: '#C7C7CC', ph: '#A1A1A6',
      sepBg: 'transparent', sepInk: '#8E8E93', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#000000', me: '#30D158', meInk: '#FFFFFF', them: '#262628', themInk: '#FFFFFF',
      meta: '#8E8E93', metaMe: 'rgba(255,255,255,.85)', read: '#8E8E93',
      head: 'rgba(28,28,30,.96)', headInk: '#FFFFFF', headSub: '#8E8E93', line: 'rgba(255,255,255,.14)',
      accent: '#30D158', comp: '#000000', field: '#000000', fieldLine: '#3A3A3C', ph: '#636366',
      sepBg: 'transparent', sepInk: '#8E8E93', frameLine: 'rgba(255,255,255,.12)' },
  }),
  whatsapp: {
    label: 'WhatsApp', font: SYS_FONT,
    radius: '.5em', grp: null, tail: 'whatsapp',
    inlineMeta: true, status: 'inline', header: 'left',
    avatarInLog: false, sep: 'pill', headSub: 'på nett', placeholder: 'Melding',
    avatarBg: '#DFE5E7', avatarInk: '#54656F',
    gapSame: '.12em', gapNew: '.5em',
    light: { bg: '#EFEAE2', me: '#D9FDD3', meInk: '#111B21', them: '#FFFFFF', themInk: '#111B21',
      meta: '#667781', metaMe: '#667781', read: '#53BDEB',
      head: '#F6F5F3', headInk: '#111B21', headSub: '#667781', line: 'rgba(0,0,0,.08)',
      accent: '#00A884', comp: '#F6F5F3', field: '#FFFFFF', fieldLine: 'transparent', ph: '#8696A0',
      sepBg: '#FFFFFF', sepInk: '#54656F', frameLine: 'rgba(0,0,0,.10)', bubbleShadow: '0 1px .5px rgba(11,20,26,.13)' },
    dark: { bg: '#0B141A', me: '#005C4B', meInk: '#E9EDEF', them: '#202C33', themInk: '#E9EDEF',
      meta: '#8696A0', metaMe: 'rgba(233,237,239,.6)', read: '#53BDEB',
      head: '#202C33', headInk: '#E9EDEF', headSub: '#8696A0', line: 'rgba(255,255,255,.06)',
      accent: '#00A884', comp: '#202C33', field: '#2A3942', fieldLine: 'transparent', ph: '#8696A0',
      sepBg: '#182229', sepInk: '#8696A0', frameLine: 'rgba(255,255,255,.10)', bubbleShadow: '0 1px .5px rgba(0,0,0,.25)' },
  },
  telegram: {
    label: 'Telegram', font: SYS_FONT,
    radius: '1em', grp: '.35em', tail: 'telegram',
    inlineMeta: true, status: 'inline', header: 'telegram',
    avatarInLog: false, sep: 'pill', headSub: 'sist sett nylig', placeholder: 'Melding',
    avatarBg: 'linear-gradient(180deg,#72D5FD,#2A9EF1)', avatarInk: '#fff',
    gapSame: '.14em', gapNew: '.5em',
    light: { bg: 'linear-gradient(160deg,#D9E6B8 0%,#B6D09E 45%,#8FBC91 100%)',
      me: '#EFFEDD', meInk: '#000000', them: '#FFFFFF', themInk: '#000000',
      meta: '#A1AAB3', metaMe: '#5DB957', read: '#5DB957',
      head: 'rgba(255,255,255,.96)', headInk: '#000000', headSub: '#8D8E93', line: 'rgba(0,0,0,.10)',
      accent: '#3390EC', comp: '#FFFFFF', field: '#FFFFFF', fieldLine: '#E2E2E6', ph: '#9EA3A8',
      sepBg: 'rgba(40,60,40,.28)', sepInk: '#FFFFFF', frameLine: 'rgba(0,0,0,.10)', bubbleShadow: '0 1px 1px rgba(0,0,0,.08)' },
    dark: { bg: '#0E1621', me: '#2B5278', meInk: '#FFFFFF', them: '#182533', themInk: '#FFFFFF',
      meta: '#6D7F8F', metaMe: '#7DA8D3', read: '#7DA8D3',
      head: '#17212B', headInk: '#FFFFFF', headSub: '#6D7F8F', line: 'rgba(255,255,255,.06)',
      accent: '#5288C1', comp: '#17212B', field: '#17212B', fieldLine: '#242F3D', ph: '#6D7F8F',
      sepBg: 'rgba(0,0,0,.35)', sepInk: '#FFFFFF', frameLine: 'rgba(255,255,255,.10)', bubbleShadow: 'none' },
  },
  messenger: {
    label: 'Messenger', font: SYS_FONT,
    radius: '1.1em', grp: '.28em', tail: null,
    inlineMeta: false, status: 'below', statusText: 'Sett', header: 'left',
    avatarInLog: true, sep: 'plain', headSub: 'Aktiv nå', placeholder: 'Aa',
    avatarBg: 'linear-gradient(180deg,#8EC5FF,#3B82F6)', avatarInk: '#fff',
    gapSame: '.12em', gapNew: '.55em',
    light: { bg: '#FFFFFF', me: '#0084FF', meInk: '#FFFFFF', them: '#F0F0F0', themInk: '#050505',
      meta: '#65676B', metaMe: 'rgba(255,255,255,.8)', read: '#65676B',
      head: '#FFFFFF', headInk: '#050505', headSub: '#65676B', line: 'rgba(0,0,0,.10)',
      accent: '#0084FF', comp: '#FFFFFF', field: '#F0F2F5', fieldLine: 'transparent', ph: '#65676B',
      sepBg: 'transparent', sepInk: '#65676B', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#000000', me: '#0084FF', meInk: '#FFFFFF', them: '#303030', themInk: '#E4E6EB',
      meta: '#B0B3B8', metaMe: 'rgba(255,255,255,.8)', read: '#B0B3B8',
      head: '#000000', headInk: '#E4E6EB', headSub: '#B0B3B8', line: 'rgba(255,255,255,.10)',
      accent: '#0084FF', comp: '#000000', field: '#303030', fieldLine: 'transparent', ph: '#B0B3B8',
      sepBg: 'transparent', sepInk: '#B0B3B8', frameLine: 'rgba(255,255,255,.12)' },
  },
  signal: {
    label: 'Signal', font: SYS_FONT,
    radius: '1.1em', grp: '.3em', tail: null,
    inlineMeta: true, status: 'inline', header: 'left',
    avatarInLog: false, sep: 'plain', headSub: '', placeholder: 'Signal-melding',
    avatarBg: '#D2DCF8', avatarInk: '#2C58C3',
    gapSame: '.12em', gapNew: '.55em',
    light: { bg: '#FFFFFF', me: '#2C6BED', meInk: '#FFFFFF', them: '#E9E9E9', themInk: '#1B1B1B',
      meta: '#5E5E5E', metaMe: 'rgba(255,255,255,.82)', read: 'rgba(255,255,255,.82)',
      head: '#FFFFFF', headInk: '#1B1B1B', headSub: '#5E5E5E', line: 'rgba(0,0,0,.08)',
      accent: '#2C6BED', comp: '#FFFFFF', field: '#F0F0F0', fieldLine: 'transparent', ph: '#6B6B6B',
      sepBg: 'transparent', sepInk: '#5E5E5E', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#121212', me: '#2C6BED', meInk: '#FFFFFF', them: '#3B3B3B', themInk: '#E9E9E9',
      meta: '#A6A6A6', metaMe: 'rgba(255,255,255,.82)', read: 'rgba(255,255,255,.82)',
      head: '#121212', headInk: '#E9E9E9', headSub: '#A6A6A6', line: 'rgba(255,255,255,.08)',
      accent: '#2C6BED', comp: '#121212', field: '#2E2E2E', fieldLine: 'transparent', ph: '#A6A6A6',
      sepBg: 'transparent', sepInk: '#A6A6A6', frameLine: 'rgba(255,255,255,.12)' },
  },
  instagram: {
    label: 'Instagram', font: SYS_FONT,
    radius: '1.35em', grp: '.35em', tail: null,
    inlineMeta: false, status: 'below', statusText: 'Sett', header: 'left',
    avatarInLog: true, sep: 'plain', sepUpper: true, headSub: '', placeholder: 'Send melding …',
    logAvatar: '2.7em',   // like høyt som en énlinjes boble, som i appen
    avatarBg: 'linear-gradient(135deg,#FEDA75,#FA7E1E 30%,#D62976 60%,#962FBF 85%,#4F5BD5)', avatarInk: '#fff',
    gapSame: '.14em', gapNew: '.6em',
    light: { bg: '#FFFFFF', me: '#7036F5', meInk: '#FFFFFF', them: '#EFEFEF', themInk: '#000000',
      meta: '#737373', metaMe: 'rgba(255,255,255,.8)', read: '#737373',
      head: '#FFFFFF', headInk: '#000000', headSub: '#737373', line: 'rgba(0,0,0,.08)',
      accent: '#7036F5', comp: '#FFFFFF', field: '#EFEFEF', fieldLine: 'transparent', ph: '#737373',
      sepBg: 'transparent', sepInk: '#737373', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#000000', me: '#7036F5', meInk: '#FFFFFF', them: '#262626', themInk: '#F5F5F5',
      meta: '#A8A8A8', metaMe: 'rgba(255,255,255,.8)', read: '#A8A8A8',
      head: '#000000', headInk: '#F5F5F5', headSub: '#A8A8A8', line: 'rgba(255,255,255,.10)',
      accent: '#7036F5', comp: '#000000', field: '#262626', fieldLine: 'transparent', ph: '#A8A8A8',
      sepBg: 'transparent', sepInk: '#A8A8A8', frameLine: 'rgba(255,255,255,.12)' },
  },
  android: {
    label: 'Meldinger (Android)', font: ANDROID_FONT,
    radius: '1.3em', grp: '.3em', tail: null,
    inlineMeta: false, status: 'below', statusText: 'Lest', header: 'left',
    avatarInLog: true, sep: 'plain', headSub: '', placeholder: 'Tekstmelding',
    avatarBg: '#F9DEDC', avatarInk: '#8C1D18',
    gapSame: '.12em', gapNew: '.55em',
    light: { bg: '#FFFFFF', me: '#D3E3FD', meInk: '#041E49', them: '#E9EEF6', themInk: '#1F1F1F',
      meta: '#444746', metaMe: '#444746', read: '#444746',
      head: '#FFFFFF', headInk: '#1F1F1F', headSub: '#444746', line: 'rgba(0,0,0,.06)',
      accent: '#0B57D0', comp: '#FFFFFF', field: '#E9EEF6', fieldLine: 'transparent', ph: '#444746',
      sepBg: 'transparent', sepInk: '#444746', frameLine: 'rgba(0,0,0,.10)' },
    dark: { bg: '#131314', me: '#0842A0', meInk: '#D3E3FD', them: '#282A2C', themInk: '#E3E3E3',
      meta: '#C4C7C5', metaMe: '#C4C7C5', read: '#C4C7C5',
      head: '#131314', headInk: '#E3E3E3', headSub: '#C4C7C5', line: 'rgba(255,255,255,.06)',
      accent: '#A8C7FA', sendInk: '#062E6F', comp: '#131314', field: '#282A2C', fieldLine: 'transparent', ph: '#C4C7C5',
      sepBg: 'transparent', sepInk: '#C4C7C5', frameLine: 'rgba(255,255,255,.12)' },
  },
};

// Hale-former (maskes med SVG så de virker på alle bakgrunner, også
// transparent i «Bare bobler»). Tegnet for høyre side; venstre speiles.
const TAIL_SVG = {
  // iMessage: bred, buet hale nederst — viewBox -13..7 × 0..20
  imessage: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-13 0 20 20'><path d='M-13 0H0V10A10 10 0 0 0 7 19.54V20H3A16 14 0 0 1 -13 6Z'/></svg>",
  // WhatsApp: liten spiss trekant øverst
  whatsapp: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 13'><path d='M0 0H6.6C7.9 0 8.5 1.4 7.7 2.4L0 13Z'/></svg>",
  // Telegram: buet krok nederst
  telegram: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 17'><path d='M0 0C0 8 2.2 13.4 8.2 16.2C8.8 16.5 8.7 17 8 17H0Z'/></svg>",
};

// ============================================================
//  Tidsplan — ÉN kilde: kjøres i editoren (varighet) og kopieres inn i
//  embed-skriptet via toString(). Skrevet i ES5 for leserne.
//  items: [{ k: 'them'|'me'|'sep'|'status', len: antall tegn (grafemer),
//            wait: ms|null (pause før), type: ms|null (skrivetid) }]
// ============================================================
function fcbPlan(items, S, typingOn, compOn) {
  var t = 350 * S, steps = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i], st = { k: it.k };
    if (it.pre) { st.pre = true; steps.push(st); continue; }
    if (it.k === 'sep' || it.k === 'status') {
      st.openAt = t;
      t += (it.k === 'sep' ? 450 : 250) * S;
      steps.push(st);
      continue;
    }
    if (it.wait != null) t += it.wait;
    if (it.k === 'them') {
      var showTyping = it.type != null ? it.type > 0 : typingOn;
      if (showTyping) {
        var dur = it.type != null ? it.type : Math.min(2600, Math.max(900, it.len * 42)) * S;
        st.typeStart = t; t += dur; st.typeEnd = t;
      }
      st.openAt = t;
      t += 750 * S;
    } else if (compOn && it.len > 0) {
      var d = it.type != null ? it.type : Math.min(60, 1900 / it.len) * S * it.len;
      st.typeStart = t; st.perChar = d / it.len;
      t += d + 380 * S;
      st.sendAt = t; st.openAt = t + 60;
      t += 800 * S;
    } else {
      if (it.type != null) t += it.type;
      t += 250 * S;
      st.openAt = t;
      t += 700 * S;
    }
    steps.push(st);
  }
  return { steps: steps, total: t + 400 };
}

// Tegn som brukeren ser dem: 👩‍👩‍👧, 👍🏽 og 🇳🇴 er ETT tegn hver
function graphemes(str) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), function (x) { return x.segment; });
    }
  } catch (e) {}
  return Array.from(str);
}

// Emojis og andre tegn utenfor BMP (4 byte i UTF-8) skrives som
// HTML-entiteter i embed-koden. Da overlever de uansett hvordan
// Labrador/databasen håndterer tegnsett — nettleseren viser dem likt.
function encodeAstral(html) {
  return html.replace(/[\u{10000}-\u{10FFFF}]/gu, c => '&#x' + c.codePointAt(0).toString(16).toUpperCase() + ';');
}

function secToMs(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? Math.round(Math.min(n, 30) * 1000) : null;
}

function svgUrl(svg) {
  return 'url("data:image/svg+xml;utf8,' + svg.replace(/"/g, "'").replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E') + '")';
}

// ============================================================
//  Elementer + tilstand
// ============================================================

const els = {
  app:        document.getElementById('appSelect'),
  theme:      document.getElementById('themeSelect'),
  frameBtns:  Array.from(document.querySelectorAll('[data-frame]')),
  themName:   document.getElementById('themName'),
  themStatus: document.getElementById('themStatus'),
  themAvatar: document.getElementById('themAvatar'),
  avatarPanel: document.getElementById('avatarPanel'),
  meName:     document.getElementById('meName'),
  msgList:    document.getElementById('msgList'),
  addThem:    document.getElementById('addThemBtn'),
  addMe:      document.getElementById('addMeBtn'),
  addSep:     document.getElementById('addSepBtn'),
  trigger:    document.getElementById('triggerSelect'),
  ready:      document.getElementById('readySelect'),
  speed:      document.getElementById('speedSelect'),
  optTyping:  document.getElementById('optTyping'),
  optCompose: document.getElementById('optCompose'),
  optReplay:  document.getElementById('optReplay'),
  optHeader:  document.getElementById('optHeader'),
  avatarLog:  document.getElementById('avatarLogSelect'),
  avSize:     document.getElementById('avSize'),
  avZoom:     document.getElementById('avZoom'),
  avX:        document.getElementById('avX'),
  avY:        document.getElementById('avY'),
  optTimes:   document.getElementById('optTimes'),
  optStatus:  document.getElementById('optStatus'),
  width:      document.getElementById('widthSelect'),
  align:      document.getElementById('alignSelect'),
  size:       document.getElementById('sizeRange'),
  sizeOut:    document.getElementById('sizeOut'),
  padTop:     document.getElementById('padTop'),
  padBot:     document.getElementById('padBot'),
  padTopOut:  document.getElementById('padTopOut'),
  padBotOut:  document.getElementById('padBotOut'),
  height:     document.getElementById('heightSelect'),
  profBg:     document.getElementById('profBgSelect'),
  profBgColor: document.getElementById('profBgColor'),
  caption:    document.getElementById('captionText'),
  previewHost: document.getElementById('previewHost'),
  playBtn:    document.getElementById('playBtn'),
  copyEmbed:  document.getElementById('copyEmbedBtn'),
  back:       document.getElementById('backBtn'),
  full:       document.getElementById('fullscreenBtn'),
  openLabrador: document.getElementById('openLabradorBtn'),
  projectSelect: document.getElementById('projectSelect'),
  saveProject:   document.getElementById('saveProjectBtn'),
};

Object.keys(APPS).forEach(k => {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = APPS[k].label;
  els.app.appendChild(o);
});

const state = {
  frame: 'window',
  readyTo: '',   // id til siste melding som står klar fra start ('' = ingen)
  // Meldinger: { id, kind: 'them'|'me'|'sep', text, time, img, imgOpen }
  msgs: [],
};

function uid() { return 'm_' + Math.random().toString(36).slice(2, 8); }

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

// Én til tre emojis alene → vises store uten boble (som i appene)
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣|\s)+$/u;
function isJumboEmoji(text) {
  const t = String(text || '').trim();
  if (!t || !EMOJI_ONLY.test(t) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t)) return false;
  return graphemes(t.replace(/\s/g, '')).length <= 3;
}

// Tekst → HTML: escaping, linjeskift, lenker understreket (IKKE klikkbare —
// lenker i gjengitte samtaler kan være svindel)
function textToHtml(text) {
  let h = escapeHtml(String(text || '').trim());
  h = h.replace(/((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g, '<span class="fcb-link">$1</span>');
  return h.replace(/\n/g, '<br>');
}

// Relativ luminans (0 = svart, 1 = hvit) — velger lys/mørk tekst på profilkortet
function hexLum(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = Array.from(parts[0])[0] || '';
  const b = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] || '') : '';
  return (a + b).toUpperCase();
}

// ============================================================
//  Meldingsliste i sidepanelet
// ============================================================

function addMsg(kind) {
  const last = state.msgs[state.msgs.length - 1];
  state.msgs.push({
    id: uid(), kind,
    text: kind === 'sep' ? 'I dag ' + new Date().toTimeString().slice(0, 5) : '',
    time: kind === 'sep' ? '' : (last && last.time) || '',
    img: '',
    imgOpen: false,
  });
  renderList();
  scheduleUpdate();
  const inputs = els.msgList.querySelectorAll('[data-act="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function hasTiming(m) { return secToMs(m.wait) != null || secToMs(m.typeSec) != null; }

function moveMsg(id, dir) {
  const i = state.msgs.findIndex(m => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.msgs.length) return;
  const [m] = state.msgs.splice(i, 1);
  state.msgs.splice(j, 0, m);
  renderList();
  scheduleUpdate();
}

function renderList() {
  els.msgList.innerHTML = '';
  state.msgs.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'cb-msg cb-msg--' + m.kind;
    const btns = `
      <span class="ks-clip__btns">
        <button class="tb-row__btn" data-act="up" data-id="${m.id}" title="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="tb-row__btn" data-act="down" data-id="${m.id}" title="Flytt ned" ${i === state.msgs.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="tb-row__btn tb-row__btn--del" data-act="del" data-id="${m.id}" title="Slett">×</button>
      </span>`;
    if (m.kind === 'sep') {
      card.innerHTML = `
        <div class="hk-row__top">
          <span class="cb-chip cb-chip--sep">Tid</span>
          <input class="hk-row__title" value="${escapeHtml(m.text)}" data-id="${m.id}" data-act="text"
                 placeholder="F.eks. I dag 14:32 eller Tirsdag">${btns}
        </div>`;
    } else {
      const who = m.kind === 'me' ? 'Deg' : 'Den andre';
      card.innerHTML = `
        <div class="hk-row__top">
          <button type="button" class="cb-chip cb-chip--${m.kind} cb-chip--btn" data-act="swap" data-id="${m.id}"
                  title="Bytt avsender">${who} ⇄</button>
          <input class="cb-time" value="${escapeHtml(m.time)}" data-id="${m.id}" data-act="time"
                 placeholder="kl." title="Klokkeslett (vises i boblen i WhatsApp, Telegram og Signal)">
          <button class="tb-row__btn cb-timebtn${hasTiming(m) ? ' is-set' : ''}" data-act="timetoggle" data-id="${m.id}"
                  title="Timing: pause før og skrivetid">⏱</button>${btns}
        </div>
        <div class="cb-timing" style="${m.timeOpen ? '' : 'display:none;'}">
          <label>Pause før <input class="cb-sec" data-id="${m.id}" data-act="wait" value="${escapeHtml(m.wait || '')}" placeholder="auto" inputmode="decimal"> s</label>
          <label>${m.kind === 'them' ? 'Skriver (•••)' : 'Skriver i feltet'} <input class="cb-sec" data-id="${m.id}" data-act="typeSec" value="${escapeHtml(m.typeSec || '')}" placeholder="auto" inputmode="decimal"> s</label>
          <span class="cb-timing__hint">${m.kind === 'them' ? 'Tomt = automatisk ut fra lengden. 0 = ingen •••.' : 'Tomt = automatisk ut fra lengden.'}</span>
        </div>
        <textarea class="cb-text" rows="2" data-id="${m.id}" data-act="text"
                  placeholder="Skriv meldingen …" spellcheck="true">${escapeHtml(m.text)}</textarea>
        <div class="cb-imgrow">
          <button class="ftb-labbtn cb-imgtoggle" type="button" data-act="imgtoggle" data-id="${m.id}">${m.img ? '🖼 Bilde ✓' : '+ Bilde'}</button>
        </div>
        <div class="cb-imgbox" style="${m.imgOpen ? '' : 'display:none;'}">
          <input class="hk-row__img" value="${escapeHtml(m.img)}" data-id="${m.id}" data-act="img"
                 placeholder="Bilde-URL fra Labrador" spellcheck="false">
          <div class="ftb-labrow">
            <button class="ftb-labbtn" type="button" data-act="files" data-id="${m.id}">Mine filer ▾</button>
            <button class="ftb-labbtn" type="button" data-act="upload" data-id="${m.id}">Last opp…</button>
          </div>
          <div class="ftb-labpanel" data-panel="${m.id}" style="display:none;"></div>
        </div>`;
    }
    els.msgList.appendChild(card);
  });
}

els.msgList.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const m = state.msgs.find(x => x.id === id);
  if (act === 'del') {
    state.msgs = state.msgs.filter(x => x.id !== id);
    renderList(); scheduleUpdate();
  }
  if (act === 'up') moveMsg(id, -1);
  if (act === 'down') moveMsg(id, 1);
  if (act === 'swap' && m) {
    m.kind = m.kind === 'me' ? 'them' : 'me';
    renderList(); scheduleUpdate();
  }
  if (act === 'timetoggle' && m) {
    m.timeOpen = !m.timeOpen;
    renderList();
  }
  if (act === 'imgtoggle' && m) {
    m.imgOpen = !m.imgOpen;
    renderList();
  }
  if (act === 'files') toggleFilePanel(id);
  if (act === 'upload') uploadToMsg(id, btn);
});

els.msgList.addEventListener('input', e => {
  const act = e.target.dataset.act;
  const m = state.msgs.find(x => x.id === e.target.dataset.id);
  if (!m || !act) return;
  if (act === 'text') m.text = e.target.value;
  if (act === 'time') m.time = e.target.value;
  if (act === 'img') {
    m.img = e.target.value.trim();
    clearTimeout(m._probe);
    m._probe = setTimeout(() => probeImageSize(m), 400);
  }
  if (act === 'wait' || act === 'typeSec') {
    m[act] = e.target.value.trim();
    const b = e.target.closest('.cb-msg').querySelector('.cb-timebtn');
    if (b) b.classList.toggle('is-set', hasTiming(m));
  }
  scheduleUpdate();
});

// Cmd/Ctrl+Enter i en melding → ny melding fra den andre parten
els.msgList.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
  const m = state.msgs.find(x => x.id === e.target.dataset.id);
  if (!m) return;
  e.preventDefault();
  addMsg(m.kind === 'me' ? 'them' : 'me');
});

els.addThem.addEventListener('click', () => addMsg('them'));
els.addMe.addEventListener('click', () => addMsg('me'));
els.addSep.addEventListener('click', () => addMsg('sep'));

// ============================================================
//  Bilder fra Labrador per melding — samme mønster som Tabell
// ============================================================

const IMG_EXT = /\.(png|jpe?g|gif|avif|heic|webp)(\?|$)/i;

// Leser bildets mål, så embedden kan reservere riktig plass før bildet er lastet
// (ellers vokser chatten — og artikkelen hopper — når bildet kommer).
function probeImageSize(m) {
  const url = m.img;
  if (!url || !isValidUrl(url)) { m.imgW = m.imgH = 0; return; }
  const im = new Image();
  im.onload = () => {
    if (m.img !== url) return;
    m.imgW = im.naturalWidth; m.imgH = im.naturalHeight;
    scheduleUpdate();
  };
  im.src = url;
}

function setMsgImage(id, url) {
  const m = state.msgs.find(x => x.id === id);
  if (!m) return;
  m.img = url;
  m.imgOpen = true;
  probeImageSize(m);
  renderList();
  scheduleUpdate();
}

// Felles: «Mine filer»-panel og opplasting — brukes av meldingsbilder og profilbildet
async function openFilePanel(panel, onPick, reopen) {
  panel.style.display = 'block';
  panel.innerHTML = '<div class="ftb-labpanel__status">Henter filer…</div>';
  let res;
  try {
    res = await window.faktisk.labradorListFiles();
  } catch (err) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Feil: ' + escapeHtml(err.message) + '</div>';
    return;
  }
  if (!res.loggedIn) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ikke innlogget. '
      + '<button type="button" class="ftb-labbtn">Koble til Labrador…</button></div>';
    panel.querySelector('button').addEventListener('click', async () => {
      panel.innerHTML = '<div class="ftb-labpanel__status">Logg inn i vinduet som åpnes…</div>';
      const st = await window.faktisk.labradorConnect();
      if (st.loggedIn) reopen();
      else panel.innerHTML = '<div class="ftb-labpanel__status">Fikk ikke gyldig innlogging.</div>';
    });
    return;
  }
  const matching = (res.files || []).filter(f => IMG_EXT.test(f.url)).slice(0, 60);
  if (!matching.length) {
    panel.innerHTML = '<div class="ftb-labpanel__status">Ingen bilder lastet opp ennå.</div>';
    return;
  }
  panel.innerHTML = '<div class="ftb-labpanel__status">'
    + matching.length + ' bilder (nyeste først)</div><div class="ftb-labpanel__list"></div>';
  const list = panel.querySelector('.ftb-labpanel__list');
  matching.forEach(f => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ftb-labfile';
    item.textContent = f.name;
    item.title = f.url;
    item.addEventListener('click', () => onPick(f.url));
    list.appendChild(item);
  });
}

async function uploadImage(btn, onDone) {
  btn.disabled = true;
  const orig = btn.textContent;
  const unsub = window.faktisk.onLabradorUploadProgress
    ? window.faktisk.onLabradorUploadProgress(msg => { btn.textContent = msg.percent + '%…'; })
    : () => {};
  try {
    const res = await window.faktisk.labradorUpload({
      filters: [{ name: 'Bilde', extensions: ['png', 'jpg', 'jpeg', 'gif', 'avif', 'heic', 'webp'] }],
    });
    if (res.canceled) return;
    if (!res.ok) { await window.faktiskDialog.alert('Opplasting feilet: ' + (res.error || 'ukjent feil')); return; }
    if (res.url) onDone(res.url);
    else await window.faktiskDialog.alert(res.note || 'Lastet opp, men fant ikke URL — sjekk «Mine filer» i Labrador.');
  } catch (err) {
    await window.faktiskDialog.alert('Opplasting feilet: ' + err.message);
  } finally {
    unsub();
    btn.disabled = false;
    btn.textContent = orig;
  }
}

function toggleFilePanel(id) {
  const panel = els.msgList.querySelector(`[data-panel="${id}"]`);
  if (!panel) return;
  const open = panel.style.display !== 'none';
  els.msgList.querySelectorAll('.ftb-labpanel').forEach(p => { p.style.display = 'none'; });
  if (open) return;
  openFilePanel(panel, url => setMsgImage(id, url), () => toggleFilePanel(id));
}

function uploadToMsg(id, btn) { return uploadImage(btn, url => setMsgImage(id, url)); }

// Profilbilde (den andre): samme knapper
function setAvatar(url) {
  els.themAvatar.value = url;
  updateAvOut();
  els.avatarPanel.style.display = 'none';
  scheduleUpdate();
}
function toggleAvatarPanel() {
  const panel = els.avatarPanel;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  openFilePanel(panel, setAvatar, () => { panel.style.display = 'none'; toggleAvatarPanel(); });
}
document.getElementById('avatarFilesBtn').addEventListener('click', toggleAvatarPanel);
document.getElementById('avatarUploadBtn').addEventListener('click', e => uploadImage(e.currentTarget, setAvatar));

// ============================================================
//  Konfigurasjon → embed
// ============================================================

function readConfig() {
  return {
    app: APPS[els.app.value] ? els.app.value : 'imessage',
    theme: els.theme.value === 'dark' ? 'dark' : 'light',
    frame: state.frame,
    themName: els.themName.value.trim(),
    themStatus: els.themStatus.value.trim(),
    themAvatar: els.themAvatar.value.trim(),
    meName: els.meName.value.trim(),
    msgs: state.msgs,
    trigger: els.trigger.value === 'scroll' ? 'middle' : els.trigger.value,
    readyTo: state.readyTo || '',
    speed: parseFloat(els.speed.value) || 1,
    typing: els.optTyping.checked,
    compose: els.optCompose.checked,
    replay: els.optReplay.checked,
    header: els.optHeader.checked,
    avatarLog: els.avatarLog.value,
    avSize: parseFloat(els.avSize.value) || 1,
    avZoom: parseFloat(els.avZoom.value) || 1,
    avX: parseInt(els.avX.value, 10) || 0,
    avY: parseInt(els.avY.value, 10) || 0,
    times: els.optTimes.checked,
    status: els.optStatus.checked,
    width: els.width.value,
    align: els.align.value,
    textSize: parseFloat(els.size.value) || 1,
    profBg: els.profBg.value === 'custom' ? els.profBgColor.value : els.profBg.value,
    padTop: parseInt(els.padTop.value, 10),
    padBot: parseInt(els.padBot.value, 10),
    height: els.height.value,
    caption: els.caption.value.trim(),
  };
}

function activeMsgs(msgs) {
  return msgs.filter(m => String(m.text || '').trim() || (m.kind !== 'sep' && m.img && isValidUrl(m.img)));
}

const ICON_BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4.5 5.2 11.3l1.6 1.6 4-4V19.5h2.3V8.9l4 4 1.6-1.6z"/></svg>';
const ICON_CHECK1 = '<svg class="fcb-chk" viewBox="0 0 12 11" aria-hidden="true"><path d="M1.5 6 4.5 9 10.5 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CHECK2 = '<svg class="fcb-chk fcb-chk--2" viewBox="0 0 17 11" aria-hidden="true"><path d="M1.5 6 4.5 9 10.5 2M8 8.2 8.8 9 14.8 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function buildEmbedSnippet(cfg) {
  cfg = cfg || readConfig();
  const A = APPS[cfg.app] || APPS.imessage;
  const C = A[cfg.theme] || A.light;
  const id = 'fcb-' + Math.random().toString(36).slice(2, 8);
  const win = cfg.frame === 'window';
  // «Profil + bobler»: kort med profilbilde og navn øverst, bare boblene under
  const prof = cfg.frame === 'profile';
  const msgs = activeMsgs(cfg.msgs);
  const themName = cfg.themName || 'Kari';
  const meName = cfg.meName || 'Meg';
  const avatarUrl = cfg.themAvatar && isValidUrl(cfg.themAvatar) ? cfg.themAvatar : '';
  const maxW = cfg.width === 'full' ? '100%' : (parseInt(cfg.width, 10) || 390) + 'px';
  // Skalering 80–400 %. I brede artikler (spalte/full) gjelder hele faktoren;
  // i smale (mobil, < 560 px) bare halve økningen, så boblene ikke sprenger skjermen.
  const fz = Math.min(4, Math.max(0.8, cfg.textSize || 1));
  const big = fz > 2;   // over 200 %: boblene får bruke nesten hele bredden
  const fzMob = fz > 1 ? 1 + (fz - 1) / 2 : fz;
  const px = (n, f) => Math.round(n * (f || fz) * 10) / 10;
  const frameMargin = cfg.align === 'left' ? '0 auto 0 0' : cfg.align === 'right' ? '0 0 0 auto' : '0 auto';
  const fixedH = win && /^\d+$/.test(String(cfg.height || '')) ? parseInt(cfg.height, 10) : 0;
  const B = `.fcb-box-${id}`;
  const vspace = (v, side) => {
    const n = Number.isFinite(v) ? Math.max(-24, Math.min(64, v)) : 12;
    return n >= 0 ? `padding-${side}: ${n}px; margin-${side}: 0;` : `padding-${side}: 0; margin-${side}: ${n}px;`;
  };
  const animated = cfg.trigger !== 'static';
  const compose = win && cfg.compose;
  const lastIdx = msgs.length - 1;
  // Profilbilde ved boblene: 'auto' = som appen gjør det, 'on' = alltid, 'off' = aldri
  const avSize = Math.min(2, Math.max(0.5, cfg.avSize || 1));
  const avLog = `calc(${A.logAvatar || '2.4em'} * ${avSize})`;
  const avZoom = Math.min(4, Math.max(1, cfg.avZoom || 1));
  const clampPos = v => Math.min(100, Math.max(0, 50 + (Number.isFinite(v) ? v : 0)));
  const avPos = `${clampPos(cfg.avX)}% ${clampPos(cfg.avY)}%`;
  const showLogAv = cfg.avatarLog === 'on' || (cfg.avatarLog !== 'off' && !!A.avatarInLog);

  // Bilde i en rund ramme med eget utsnitt (zoom + plassering), så også skjermdump-utsnitt passer
  const lazy = animated ? '' : ' loading="lazy"';
  const avatarHtml = (cls) => avatarUrl
    ? `<span class="${cls} fcb-av--img" aria-hidden="true"><img src="${escapeHtml(avatarUrl)}" alt=""${lazy}></span>`
    : `<span class="${cls}" aria-hidden="true">${escapeHtml(initials(themName))}</span>`;

  // Grupper: påfølgende meldinger fra samme avsender (tidsskille bryter)
  const pos = msgs.map((m, i) => {
    if (m.kind === 'sep') return '';
    const prev = msgs[i - 1], next = msgs[i + 1];
    const samePrev = prev && prev.kind === m.kind;
    const sameNext = next && next.kind === m.kind;
    return samePrev ? (sameNext ? 'mid' : 'last') : (sameNext ? 'first' : 'solo');
  });

  // Meldinger til og med readyTo står klare før avspillingen starter
  const readyIdx = cfg.readyTo ? msgs.findIndex(m => m.id === cfg.readyTo) : -1;
  const tailAt = A.tail === 'whatsapp' ? ['first', 'solo'] : ['last', 'solo'];
  const lastMeIdx = msgs.map(m => m.kind).lastIndexOf('me');

  const rowsHtml = msgs.map((m, i) => {
    if (m.kind === 'sep') {
      return `
        <!-- ▶ TIDSSKILLE -->
        <div class="fcb-row fcb-row--sep" data-k="sep"${i <= readyIdx ? ' data-pre="1"' : ''}><div class="fcb-in"><div class="fcb-l"><span class="fcb-sep">${escapeHtml(m.text.trim())}</span></div></div></div>`;
    }
    const g = pos[i];
    const img = m.img && isValidUrl(m.img) ? m.img : '';
    const text = String(m.text || '').trim();
    const jumbo = !img && isJumboEmoji(text);
    const tail = A.tail && !jumbo && tailAt.includes(g);
    const cls = ['fcb-bubble'];
    if (jumbo) cls.push('fcb-bubble--jumbo');
    if (img) cls.push('fcb-bubble--img');
    if (img && !text) cls.push('fcb-bubble--imgonly');
    if (tail) cls.push('has-tail');

    let meta = '';
    if (A.inlineMeta && !jumbo) {
      const t = cfg.times && m.time ? escapeHtml(m.time.trim()) : '';
      const chk = (m.kind === 'me' && cfg.status)
        ? (cfg.app === 'signal' ? ICON_CHECK2 : `<span class="fcb-read">${ICON_CHECK2}</span>`)
        : '';
      if (t || chk) meta = `<span class="fcb-meta">${t}${chk}</span>`;
    }

    const who = m.kind === 'me' ? meName : themName;
    const avatarSlot = (showLogAv && m.kind === 'them')
      ? ((g === 'last' || g === 'solo') ? avatarHtml('fcb-av fcb-av--log') : '<span class="fcb-av fcb-av--log fcb-av--ghost" aria-hidden="true"></span>')
      : '';

    const inner = `${img ? `<img class="fcb-img" src="${escapeHtml(img)}" alt=""${m.imgW > 0 && m.imgH > 0 ? ` width="${Math.round(m.imgW)}" height="${Math.round(m.imgH)}"` : ''}${lazy}>` : ''}${text ? `<span class="fcb-t">${textToHtml(text)}${meta}</span>` : (meta ? `<span class="fcb-t fcb-t--meta">${meta}</span>` : '')}`;

    let status = '';
    if (cfg.status && A.status === 'below' && i === lastMeIdx && i === lastIdx) {
      status = `
        <div class="fcb-row fcb-row--status" data-k="status"${i <= readyIdx ? ' data-pre="1"' : ''}><div class="fcb-in"><div class="fcb-l"><span class="fcb-status">${escapeHtml(A.statusText)}</span></div></div></div>`;
    }

    return `
        <!-- ▶ MELDING ${i + 1} (${m.kind === 'me' ? 'deg' : escapeHtml(themName)}) -->
        <div class="fcb-row fcb-row--${m.kind} g-${g}" data-k="${m.kind}"${i <= readyIdx ? ' data-pre="1"' : ''} data-plain="${escapeHtml(text)}" data-len="${graphemes(text).length}"${secToMs(m.wait) != null ? ` data-wait="${secToMs(m.wait)}"` : ''}${secToMs(m.typeSec) != null ? ` data-type="${secToMs(m.typeSec)}"` : ''}>
          <div class="fcb-in"><div class="fcb-l">${avatarSlot}<div class="${cls.join(' ')}"><span class="fcb-sr">${escapeHtml(who)}: </span>${inner}${tail ? '<i class="fcb-tail" aria-hidden="true"></i>' : ''}</div></div></div>
        </div>${status}`;
  }).join('');

  // Topplinje
  const sub = cfg.themStatus || A.headSub;
  let head = '';
  if (win && cfg.header) {
    if (A.header === 'center') {
      head = `
      <div class="fcb-head fcb-head--center">
        <span class="fcb-back">${ICON_BACK}</span>
        ${avatarHtml('fcb-av fcb-av--head')}
        <span class="fcb-name">${escapeHtml(themName)} <span class="fcb-chev">›</span></span>
      </div>`;
    } else if (A.header === 'telegram') {
      head = `
      <div class="fcb-head fcb-head--tg">
        <span class="fcb-back">${ICON_BACK}</span>
        <span class="fcb-who"><span class="fcb-name">${escapeHtml(themName)}</span>${sub ? `<span class="fcb-sub">${escapeHtml(sub)}</span>` : ''}</span>
        ${avatarHtml('fcb-av fcb-av--head')}
      </div>`;
    } else {
      head = `
      <div class="fcb-head fcb-head--left">
        <span class="fcb-back">${ICON_BACK}</span>
        ${avatarHtml('fcb-av fcb-av--head')}
        <span class="fcb-who"><span class="fcb-name">${escapeHtml(themName)}</span>${sub ? `<span class="fcb-sub">${escapeHtml(sub)}</span>` : ''}</span>
        <span class="fcb-call">${ICON_PHONE}</span>
      </div>`;
    }
  }

  // Profilkort: bakgrunn og tekstfarge
  const profBgRaw = String(cfg.profBg || 'app');
  const profBg = profBgRaw === 'app' ? C.bg : (profBgRaw === 'transparent' || /^#[0-9a-fA-F]{6}$/.test(profBgRaw)) ? profBgRaw : C.bg;
  const profDark = profBg !== 'transparent' && /^#[0-9a-fA-F]{6}$/.test(profBg) ? hexLum(profBg) < 0.4 : cfg.theme === 'dark' && profBgRaw === 'app';
  const profInk = profDark ? '#FFFFFF' : '#000000';
  if (prof) {
    head = `
      <!-- ▶ PROFIL -->
      <div class="fcb-phead">
        ${avatarHtml('fcb-av fcb-av--prof')}
        <span class="fcb-pname">${escapeHtml(themName)}</span>${cfg.themStatus ? `
        <span class="fcb-psub">${escapeHtml(cfg.themStatus)}</span>` : ''}
      </div>`;
  }

  const composer = win ? `
      <div class="fcb-comp" aria-hidden="true">
        <span class="fcb-field"><span class="fcb-ctext"></span><span class="fcb-caret"></span><span class="fcb-ph">${escapeHtml(A.placeholder)}</span></span>
        <span class="fcb-send">${ICON_SEND}</span>
      </div>` : '';

  // Typing-rad (flyttes ikke — ligger sist i loggen; lukkede rader tar 0 høyde)
  const typingAvatar = showLogAv ? avatarHtml('fcb-av fcb-av--log') : '';
  const anyTyping = cfg.typing || msgs.some(m => m.kind === 'them' && (secToMs(m.typeSec) || 0) > 0);
  const typing = (animated && anyTyping) ? `
        <div class="fcb-row fcb-row--them fcb-typing g-solo" aria-hidden="true"><div class="fcb-in"><div class="fcb-l">${typingAvatar}<div class="fcb-bubble fcb-bubble--dots${A.tail ? ' has-tail' : ''}"><span class="fcb-dots"><i></i><i></i><i></i></span>${A.tail ? '<i class="fcb-tail"></i>' : ''}</div></div></div></div>` : '';

  const captionHtml = cfg.caption ? `
    <!-- ▶ BILDETEKST -->
    <div class="fcb-caption">${escapeHtml(cfg.caption)}</div>` : '';

  const replayHtml = (animated && cfg.replay) ? `
    <button type="button" class="fcb-replay" hidden>↻ Spill av igjen</button>` : '';

  const S = `.fcb-${id}`;
  const tailSvg = A.tail ? svgUrl(TAIL_SVG[A.tail]) : '';
  const grp = A.grp;

  // Hale-geometri (em — skalerer med skriftstørrelsen)
  const TAIL_GEO = {
    imessage: { w: '1.18em', h: '1.18em', off: '-.41em', v: 'bottom' },
    whatsapp: { w: '.5em',  h: '.8em',  off: '-.5em',  v: 'top' },
    telegram: { w: '.56em', h: '1.05em', off: '-.52em', v: 'bottom' },
  };
  const tg = A.tail ? TAIL_GEO[A.tail] : null;

  const baseCss = (typeof window !== 'undefined' && window.FaktiskEmbedBase)
    ? window.FaktiskEmbedBase.getBaseCss('fcb-container')
    : '';

  const css = `${baseCss}
    .fcb-container { container-type: inline-size; }
    /* To klasser (.fcb-container.fcb-box-<id>) så ingen annen chatboks i artikkelen kan overstyre */
    .fcb-container${B} {
      container-name: fcbo-${id};
      /* Luft over/under (justeres i Studio). Negativ = trekk nærmere teksten. */
      ${vspace(cfg.padTop, 'top')}
      ${vspace(cfg.padBot, 'bottom')}
    }
    ${B} .fcb-frame {
      max-width: ${maxW};
      margin: ${frameMargin};
      ${win || prof ? 'container-type: inline-size;' : `/* Bare bobler: blokken blir like bred som den bredeste boblen og
         plasseres (midtstilt/venstre/høyre) som helhet — boblene inni står
         fortsatt venstre/høyre som i appen. Ingen container-type her
         (størrelsesinneslutning ville gjort fit-content til 0). */
      width: fit-content;`}
    }
    ${S} {
      --r: ${A.radius};
      font-family: ${A.font};
      /* Skalerer med chatbredden: ${px(14)} px på smale mobiler, maks ${px(17)} px */
      font-size: clamp(${px(14, fzMob)}px, ${px(4.1, fzMob)}cqw, ${px(17, fzMob)}px);
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: -0.01em;
      color: ${C.themInk};
      -webkit-font-smoothing: antialiased;
      text-align: left;
      box-sizing: border-box;
      position: relative;
      ${win ? `background: ${C.bg};
      border: 1px solid ${C.frameLine};
      border-radius: 1.4em;
      overflow: hidden;
      display: flex;
      flex-direction: column;` : ''}${prof ? `
      background: ${profBg};
      ${profBg !== 'transparent' ? 'border-radius: 1.4em;' : ''}
      /* Sideluft i cqw-tak, så store bobler ikke kveles av luft som vokser med skalaen */
      padding: 1.1em min(.9em, 4cqw) 1em;` : ''}
    }
    ${S} *, ${S} *::before, ${S} *::after { box-sizing: border-box; }
    ${S} .fcb-sr {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip: rect(0 0 0 0); white-space: nowrap;
    }

    /* Topplinje */
    ${S} .fcb-head {
      display: flex; align-items: center; gap: .55em;
      padding: .6em .8em;
      background: ${C.head};
      border-bottom: .5px solid ${C.line};
      color: ${C.headInk};
      position: relative;
      z-index: 2;
    }
    ${S} .fcb-back { color: ${C.accent}; width: .75em; height: 1.2em; flex-shrink: 0; display: inline-flex; }
    ${S} .fcb-back svg { width: 100%; height: 100%; }
    ${S} .fcb-av {
      flex-shrink: 0; border-radius: 50%; object-fit: cover;
      display: inline-flex; align-items: center; justify-content: center;
      background: ${A.avatarBg}; color: ${A.avatarInk};
      font-weight: 600; letter-spacing: 0;
      overflow: hidden;
    }
    ${S} .fcb-av--img { background: #ddd; }
    ${S} .fcb-av--img img {
      width: 100%; height: 100%; display: block;
      object-fit: cover;
      object-position: ${avPos};
      transform: scale(${avZoom});
      transform-origin: ${avPos};
    }
    ${S} .fcb-av--head { width: 2.25em; height: 2.25em; font-size: .9em; }
    ${S} .fcb-who { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
    ${S} .fcb-name { font-weight: 600; font-size: .95em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${S} .fcb-sub { font-size: .74em; color: ${C.headSub}; }
    ${S} .fcb-call { width: 1.3em; height: 1.3em; color: ${C.accent}; flex-shrink: 0; }
    ${S} .fcb-call svg { width: 100%; height: 100%; }
    ${S} .fcb-head--center { flex-direction: column; gap: .2em; padding: .55em .8em .45em; }
    ${S} .fcb-head--center .fcb-back { position: absolute; left: .8em; top: 1.05em; }
    ${S} .fcb-head--center .fcb-av--head { width: 2.9em; height: 2.9em; font-size: .95em; }
    ${S} .fcb-head--center .fcb-name { font-weight: 400; font-size: .7em; }
    ${S} .fcb-chev { color: ${C.headSub}; }
    ${S} .fcb-head--tg .fcb-who { align-items: center; text-align: center; }

${prof ? `
    /* Profilkort: profilbilde og navn øverst */
    ${S} .fcb-phead {
      display: flex; flex-direction: column; align-items: center; gap: .3em;
      padding-bottom: .9em; text-align: center; color: ${profInk};
    }
    ${S} .fcb-av--prof { width: calc(3.6em * ${avSize}); height: calc(3.6em * ${avSize}); font-size: 1.15em; }
    ${S} .fcb-pname { font-weight: 600; font-size: 1.05em; line-height: 1.2; }
    ${S} .fcb-psub { font-size: .75em; opacity: .6; }
` : ''}    /* Samtaleloggen — forankret i bunnen, som i appene */
    ${S} .fcb-log {
      display: flex; flex-direction: column;
      padding: ${win ? '.5em .75em .7em' : (prof || big) ? '.2em min(.5em, 2cqw)' : '.2em .5em'};
      position: relative;
    }
    /* Spacer skyver meldingene ned til bunnen (som i appene) uten
       justify-content:flex-end — den gjør toppen uscrollbar ved overflyt */
    ${S} .fcb-spacer { flex: 1 0 0; }
    ${fixedH ? `
    /* Fast høyde: eldre meldinger glir ut øverst, leseren kan scrolle opp */
    ${S} .fcb-log {
      height: min(${fixedH}px, 75vh);
      height: min(${fixedH}px, 75svh);
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }` : ''}
    ${S} .fcb-row { display: grid; grid-template-rows: 1fr; }
    /* .fcb-in er klippeboksen (0 høyde når lukket), .fcb-l har luft og layout */
    ${S} .fcb-in { min-height: 0; }
    ${S} .fcb-l {
      display: flex; align-items: flex-end; gap: .45em;
      padding-top: ${A.gapNew};
    }
    ${S} .fcb-row.g-mid .fcb-l, ${S} .fcb-row.g-last .fcb-l { padding-top: ${A.gapSame}; }
    ${S} .fcb-row--me .fcb-l { justify-content: flex-end; }
    ${S} .fcb-row--sep .fcb-l { justify-content: center; padding-top: .8em; padding-bottom: .15em; }
    ${S} .fcb-row--status .fcb-l { justify-content: flex-end; padding-top: .2em; }
    /* Første rad har ingen rad over seg — ingen luft øverst (ellers mer luft over enn under) */
    ${S} .fcb-spacer + .fcb-row .fcb-l { padding-top: 0; }

    ${S} .fcb-sep {
      font-size: .72em; font-weight: 500; color: ${C.sepInk};
      ${A.sep === 'pill' ? `background: ${C.sepBg}; padding: .3em .8em; border-radius: 1em;${cfg.app === 'whatsapp' ? ` box-shadow: ${C.bubbleShadow}; text-transform: uppercase; letter-spacing: .02em;` : ''}` : ''}
      ${A.sepUpper ? 'text-transform: uppercase; letter-spacing: .03em;' : ''}
    }
    ${S} .fcb-status { font-size: .7em; font-weight: 500; color: ${C.meta}; }

    /* Bobler */
    ${S} .fcb-bubble {
      --bb: ${C.them};
      position: relative;
      max-width: ${win ? 'min(76%, 24em)' : prof ? (big ? '92%' : 'min(24em, 86%)') : big ? 'min(24em, 92cqw)' : 'min(24em, 82cqw)'};   /* lesbare linjer også i bred visning */
      background: var(--bb);
      color: ${C.themInk};
      border-radius: var(--r);
      ${C.bubbleShadow && C.bubbleShadow !== 'none' ? `box-shadow: ${C.bubbleShadow};` : ''}
      overflow-wrap: anywhere;
    }
    ${S} .fcb-row--me .fcb-bubble { --bb: ${C.me}; color: ${C.meInk}; }
    ${S} .fcb-t { display: flow-root; padding: .42em .78em .45em; }
    ${S} .fcb-link { text-decoration: underline; text-underline-offset: .12em; }
    ${S} .fcb-bubble--img { width: ${win || prof ? '72%' : 'min(15em, 70cqw)'}; padding: ${A.tail === 'imessage' ? '0' : '.2em'}; }
    ${S} .fcb-bubble--img .fcb-t { padding: .35em .6em .3em; }
    ${S} .fcb-img { display: block; width: 100%; height: auto; border-radius: calc(var(--r) - .2em); }
    ${S} .fcb-bubble--imgonly { background: ${A.tail === 'imessage' ? 'transparent' : 'var(--bb)'}; box-shadow: none; }
    ${S} .fcb-bubble--imgonly .fcb-img { border-radius: ${A.tail === 'imessage' ? 'var(--r)' : 'calc(var(--r) - .2em)'}; }
    ${S} .fcb-t--meta { padding: 0 .5em .25em; }
    ${S} .fcb-bubble--imgonly .fcb-t--meta { position: absolute; right: .35em; bottom: .35em; padding: .05em .45em; border-radius: 1em; background: rgba(0,0,0,.35); }
    ${S} .fcb-bubble--imgonly .fcb-t--meta .fcb-meta { color: #fff; }
    ${S} .fcb-bubble--jumbo {
      background: transparent; box-shadow: none;
      font-size: 2.6em; line-height: 1.15; letter-spacing: .02em;
    }
    ${S} .fcb-bubble--jumbo .fcb-t { padding: 0 .05em; }

    /* Grupperte hjørner (Messenger, Signal, Android, Telegram) */
    ${grp ? `
    ${S} .fcb-row--them.g-first .fcb-bubble { border-bottom-left-radius: ${grp}; }
    ${S} .fcb-row--them.g-mid .fcb-bubble { border-top-left-radius: ${grp}; border-bottom-left-radius: ${grp}; }
    ${S} .fcb-row--them.g-last .fcb-bubble { border-top-left-radius: ${grp}; }
    ${S} .fcb-row--me.g-first .fcb-bubble { border-bottom-right-radius: ${grp}; }
    ${S} .fcb-row--me.g-mid .fcb-bubble { border-top-right-radius: ${grp}; border-bottom-right-radius: ${grp}; }
    ${S} .fcb-row--me.g-last .fcb-bubble { border-top-right-radius: ${grp}; }
    ${S} .fcb-bubble--jumbo { border-radius: 0; }` : ''}

    /* Haler */
    ${tg ? `
    ${S} .fcb-tail {
      position: absolute; ${tg.v}: 0;
      width: ${tg.w}; height: ${tg.h};
      background: var(--bb);
      -webkit-mask: ${tailSvg} no-repeat 0 0 / 100% 100%;
      mask: ${tailSvg} no-repeat 0 0 / 100% 100%;
      pointer-events: none;
    }
    ${S} .fcb-row--me .fcb-tail { right: ${tg.off}; }
    ${S} .fcb-row--them .fcb-tail { left: ${tg.off}; transform: scaleX(-1); }
    ${A.tail === 'whatsapp' ? `
    ${S} .fcb-row--me .has-tail { border-top-right-radius: 0; }
    ${S} .fcb-row--them .has-tail { border-top-left-radius: 0; }
    ${S} .fcb-row .fcb-bubble { margin-left: .5em; margin-right: .5em; }
    ${S} .fcb-row .fcb-bubble--jumbo { margin: 0 .2em; }` : ''}
    ${A.tail === 'telegram' ? `
    ${S} .fcb-row--me .has-tail { border-bottom-right-radius: 0; }
    ${S} .fcb-row--them .has-tail { border-bottom-left-radius: 0; }
    ${S} .fcb-row .fcb-bubble { margin-left: .45em; margin-right: .45em; }` : ''}
    ${A.tail === 'imessage' ? `
    ${S} .fcb-row .fcb-bubble { margin-left: .3em; margin-right: .3em; }
    ${S} .fcb-bubble--imgonly .fcb-tail { display: none; }` : ''}` : ''}

    /* Klokkeslett og haker inne i boblen */
    ${S} .fcb-meta {
      float: right;
      display: inline-flex; align-items: center; gap: .2em;
      margin: .55em -.2em -.2em .75em;
      font-size: .68em; line-height: 1; white-space: nowrap;
      color: ${C.meta};
    }
    ${S} .fcb-row--me .fcb-meta { color: ${C.metaMe}; }
    ${S} .fcb-chk { width: 1.25em; height: .85em; }
    ${S} .fcb-chk--2 { width: 1.5em; }
    ${S} .fcb-read { color: ${C.read}; display: inline-flex; }

    /* Avatar i loggen (Messenger, Android) */
    /* Profilbilde ved boblene: appens standard × «Størrelse» i Studio */
    ${S} .fcb-av--log { width: ${avLog}; height: ${avLog}; font-size: .78em; }
    ${S} .fcb-av--ghost { visibility: hidden; }

    /* Tekstfelt nederst */
    ${S} .fcb-comp {
      display: flex; align-items: center; gap: .45em;
      padding: .45em .6em .6em;
      background: ${C.comp};
      ${cfg.app === 'whatsapp' || cfg.app === 'telegram' ? `border-top: .5px solid ${C.line};` : ''}
    }
    ${S} .fcb-field {
      flex: 1; min-width: 0;
      display: flex; align-items: center;
      min-height: 2.1em;
      padding: .3em .85em;
      background: ${C.field};
      border: 1px solid ${C.fieldLine};
      border-radius: 1.1em;
      color: ${cfg.theme === 'dark' ? '#FFFFFF' : '#000000'};
      font-size: .95em;
      overflow: hidden;
    }
    ${S} .fcb-ctext { white-space: pre-wrap; overflow-wrap: anywhere; }
    ${S} .fcb-ph { color: ${C.ph}; white-space: nowrap; }
    ${S} .fcb-caret { display: none; width: 1.5px; height: 1.15em; margin-left: 1px; background: ${C.accent}; animation: fcb-blink-${id} 1s steps(1) infinite; }
    ${S} .fcb-comp.has-text .fcb-ph { display: none; }
    ${S} .fcb-comp.is-typing .fcb-caret { display: inline-block; }
    ${S} .fcb-send {
      flex-shrink: 0; width: 1.85em; height: 1.85em; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: ${C.accent}; color: ${C.sendInk || '#FFFFFF'};
      opacity: .35; transform: scale(.85);
      transition: opacity .2s, transform .2s;
    }
    ${S} .fcb-send svg { width: 1.2em; height: 1.2em; }
    ${S} .fcb-comp.has-text .fcb-send { opacity: 1; transform: scale(1); }
    ${S} .fcb-comp.is-sent .fcb-send { transform: scale(.8); }

    /* Skriveindikator */
    ${S} .fcb-bubble--dots { padding: .62em .8em; }
    ${S} .fcb-dots { display: flex; gap: .26em; }
    ${S} .fcb-dots i {
      width: .5em; height: .5em; border-radius: 50%;
      background: ${C.meta};
      animation: fcb-dot-${id} 1.2s infinite ease-in-out;
    }
    ${S} .fcb-dots i:nth-child(2) { animation-delay: .15s; }
    ${S} .fcb-dots i:nth-child(3) { animation-delay: .3s; }
    ${S} .fcb-typing { grid-template-rows: 0fr; }
    ${S} .fcb-typing > .fcb-in { overflow: hidden; }
    ${S}.fcb-anim .fcb-typing.is-open { grid-template-rows: 1fr; }
    ${S}.fcb-anim .fcb-typing.is-open.is-done > .fcb-in { overflow: visible; }

    /* Animasjon — gjelder bare når skriptet har tatt over (.fcb-anim) */
    ${S}.fcb-anim .fcb-row { transition: grid-template-rows .3s cubic-bezier(.3,.7,.3,1); }
    ${S}.fcb-anim .fcb-row:not(.is-open) { grid-template-rows: 0fr; }
    ${S}.fcb-anim .fcb-row > .fcb-in { overflow: hidden; }
    ${S}.fcb-anim .fcb-row.is-done > .fcb-in { overflow: visible; }
    ${S}.fcb-anim .fcb-row.is-open .fcb-bubble { animation: fcb-pop-${id} .42s cubic-bezier(.2,1.35,.4,1) both; }
    ${S}.fcb-anim .fcb-row--them .fcb-bubble { transform-origin: 0 100%; }
    ${S}.fcb-anim .fcb-row--me .fcb-bubble { transform-origin: 100% 100%; }
    ${S}.fcb-anim .fcb-row--sep.is-open .fcb-sep,
    ${S}.fcb-anim .fcb-row--status.is-open .fcb-status { animation: fcb-fade-${id} .4s ease both; }
    ${S}.fcb-anim .fcb-log { overflow: hidden; }
    ${S}.fcb-measure .fcb-row { grid-template-rows: 1fr !important; transition: none !important; }
    ${S}.fcb-notrans .fcb-row { transition: none !important; }
    ${S}.fcb-measure .fcb-typing { grid-template-rows: 0fr !important; }
    @keyframes fcb-pop-${id} {
      0%   { transform: scale(.55) translateY(.4em); opacity: 0; }
      60%  { opacity: 1; }
      100% { transform: none; opacity: 1; }
    }
    @keyframes fcb-fade-${id} { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fcb-dot-${id} {
      0%, 60%, 100% { transform: translateY(0); opacity: .45; }
      30% { transform: translateY(-.22em); opacity: 1; }
    }
    @keyframes fcb-blink-${id} { 50% { opacity: 0; } }

    ${B} .fcb-caption {
      max-width: ${maxW};
      margin: .6em ${cfg.align === 'center' ? 'auto' : '0'} 0;
      ${cfg.align === 'right' ? 'margin-left: auto; text-align: right;' : ''}
      font-family: var(--fk-font);
      font-size: 14px;
      line-height: 1.45;
      color: #5A5A5A;
    }
    .fcb-container .fcb-replay {
      display: block;
      margin: .6em auto 5px;   /* samme luft under som over embedden */
      padding: .45em 1em;
      font-family: var(--fk-font);
      font-weight: var(--fk-fw-bold);
      font-size: 13px;
      color: #0050FC;
      background: #fff;
      border: 1.5px solid #0050FC;
      border-radius: 999px;
      cursor: pointer;
    }
    .fcb-container .fcb-replay[hidden] { display: none; }
    .fcb-container .fcb-replay:hover { background: #0050FC; color: #fff; }
    /* Bred artikkel (spalte/full): full skalering. MÅ stå sist — ellers vinner grunnregelen. */${fz !== fzMob ? `
    @container fcbo-${id} (min-width: 560px) {
      ${S} { font-size: clamp(${px(14)}px, ${px(4.1)}cqw, ${px(17)}px); }
    }` : ''}`;

  const script = animated ? `
  <script>
  (function () {
    var root = document.getElementById('${id}');
    if (!root || root.__fcb) return;
    root.__fcb = 1;
    var box = root.closest('.fcb-container') || root.parentNode;
    var log = root.querySelector('.fcb-log');
    var rows = [].slice.call(log.querySelectorAll('.fcb-row:not(.fcb-typing)'));
    var typing = log.querySelector('.fcb-typing');
    var comp = root.querySelector('.fcb-comp');
    var ctext = comp ? comp.querySelector('.fcb-ctext') : null;
    var replay = box.querySelector('.fcb-replay');
    var S = parseFloat(root.getAttribute('data-speed')) || 1;
    var useComp = !!ctext && root.getAttribute('data-compose') === '1';
    var timers = [], running = false;
    ${fcbPlan.toString()}
    ${graphemes.toString()}
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function stop() { timers.forEach(clearTimeout); timers = []; }
    var fixed = root.hasAttribute('data-fixed');
    function toBottom() { if (fixed) log.scrollTop = log.scrollHeight; }
    function follow() { if (!running) return; toBottom(); requestAnimationFrame(follow); }
    // Måling/tilbakestilling skjer UTEN overgangsanimasjon — ellers glir radene
    // synlig sammen igjen etterpå (f.eks. når et bilde lastes ferdig midt i).
    function measure() {
      root.classList.add('fcb-notrans');
      if (!fixed) {
        root.classList.add('fcb-measure');
        log.style.height = '';
        var h = log.offsetHeight;
        // Skriveindikatoren kan være høyere enn meldingen den står i stedet for
        // (f.eks. med profilbilde) — gi plass, ellers kappes boblen nederst.
        if (typing && typing.firstElementChild) {
          var tyH = typing.offsetHeight + typing.firstElementChild.scrollHeight, minR = Infinity;
          rows.forEach(function (r) { if (r.getAttribute('data-k') === 'them' && !r.hasAttribute('data-pre')) minR = Math.min(minR, r.offsetHeight); });
          if (minR < Infinity && tyH > minR) h += Math.ceil(tyH - minR);
        }
        log.style.height = h + 'px';
        root.classList.remove('fcb-measure');
      }
      void log.offsetHeight;
      root.classList.remove('fcb-notrans');
      toBottom();
    }
    function setComp(txt, on) {
      if (!comp) return;
      ctext.textContent = txt;
      comp.classList.toggle('has-text', !!txt);
      comp.classList.toggle('is-typing', !!on);
    }
    function showAll() {
      stop(); running = false;
      root.classList.remove('fcb-anim');
      log.style.height = '';
      rows.forEach(function (r) { r.classList.add('is-open', 'is-done'); });
      if (typing) typing.classList.remove('is-open');
      setComp('', false);
      if (replay) replay.hidden = true;
      toBottom();
    }
    function open(r) {
      r.classList.add('is-open');
      later(function () { r.classList.add('is-done'); }, 450);
    }
    function reset() {
      stop();
      root.classList.add('fcb-notrans');
      rows.forEach(function (r) {
        if (r.hasAttribute('data-pre')) r.classList.add('is-open', 'is-done');
        else r.classList.remove('is-open', 'is-done');
      });
      if (typing) typing.classList.remove('is-open', 'is-done');
      setComp('', false);
      root.classList.add('fcb-anim');
      measure();
    }
    function play() {
      reset();
      running = true;
      requestAnimationFrame(follow);
      if (replay) replay.hidden = true;
      var items = rows.map(function (r) {
        var w = r.getAttribute('data-wait'), ty = r.getAttribute('data-type');
        return { k: r.getAttribute('data-k'), pre: r.hasAttribute('data-pre'), len: parseInt(r.getAttribute('data-len'), 10) || 0,
                 wait: w == null ? null : +w, type: ty == null ? null : +ty };
      });
      var plan = fcbPlan(items, S, root.getAttribute('data-typing') === '1', useComp);
      plan.steps.forEach(function (st, i) {
        var r = rows[i];
        if (st.pre) return;
        if (st.typeStart != null && st.k === 'them' && typing) {
          later(function () { typing.classList.add('is-open'); open(typing); }, st.typeStart);
          later(function () { typing.classList.remove('is-open', 'is-done'); }, st.typeEnd);
        }
        if (st.typeStart != null && st.k === 'me') {
          var chars = graphemes(r.getAttribute('data-plain') || '');
          chars.forEach(function (c, j) {
            later(function () { setComp(chars.slice(0, j + 1).join(''), true); }, st.typeStart + j * st.perChar);
          });
          later(function () { comp.classList.add('is-sent'); setComp('', false); }, st.sendAt);
          later(function () { comp.classList.remove('is-sent'); }, st.sendAt + 200);
        }
        later(function () { open(r); }, st.openAt);
      });
      var t = plan.total - 400;
      later(function () {
        running = false;
        root.classList.remove('fcb-anim');
        log.style.height = '';
        rows.forEach(function (r) { r.classList.add('is-done'); });
        if (replay) replay.hidden = false;
      }, t + 400);
    }
    root.__fcbPlay = play;
    root.__fcbShowAll = showAll;
    if (replay) replay.addEventListener('click', play);

    // Bilder laster sent — mål høyden på nytt så artikkelen ikke hopper
    [].slice.call(root.querySelectorAll('img')).forEach(function (im) {
      im.addEventListener('load', function () { if (running || root.classList.contains('fcb-anim')) measure(); });
    });
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = root.offsetWidth;
        if (w !== lastW) { lastW = w; if (root.classList.contains('fcb-anim')) measure(); }
      }).observe(root);
    }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (root.hasAttribute('data-static') || reduce || !('IntersectionObserver' in window)) {
      showAll();
      return;
    }
    reset();
    // early: så snart toppen er innenfor nederste 10 % · middle: øvre 70 %
    // full: hele boksen synlig (eller, for høye bokser, toppen nær skjermtoppen)
    var trig = root.getAttribute('data-trigger') || 'middle';
    var ths = [0]; for (var q = 1; q <= 20; q++) ths.push(q / 20);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        if (trig === 'full') {
          var r = e.boundingClientRect, vh = window.innerHeight || document.documentElement.clientHeight;
          if (!(r.bottom <= vh + 2 || r.top <= vh * 0.15)) return;
        }
        io.disconnect(); play();
      });
    }, trig === 'full' ? { threshold: ths }
       : { rootMargin: trig === 'early' ? '0px 0px -10% 0px' : '0px 0px -30% 0px', threshold: 0 });
    io.observe(root);
  })();
  </script>` : '';

  const staticScript = (!animated && fixedH) ? `
  <script>
  (function () { var l = document.querySelector('#${id} .fcb-log'); if (l) l.scrollTop = l.scrollHeight; })();
  </script>` : '';
  const appName = A.label.replace(/\s*\(.*\)/, '');
  return encodeAstral(`<!-- ============================================
     FAKTISK · CHATBOBLER (${escapeHtml(A.label)}, ${cfg.theme === 'dark' ? 'mørk' : 'lys'})
     Gjengitt samtale. Endre tekst i feltene merket med ▶ —
     utseende og animasjon endres i Faktisk Studio.
     ============================================ -->
  <style>${css}
  </style>
  <div class="fcb-container fcb-box-${id}">
    <div class="fcb-frame">
      <div class="fcb-${id}" id="${id}" role="figure" aria-label="Gjengitt samtale i ${escapeHtml(appName)} med ${escapeHtml(themName)}" data-speed="${cfg.speed}" data-compose="${compose ? '1' : '0'}" data-typing="${cfg.typing ? '1' : '0'}" data-trigger="${escapeHtml(cfg.trigger)}"${fixedH ? ' data-fixed="1"' : ''}>${head}
        <div class="fcb-log"><div class="fcb-spacer"></div>${rowsHtml}${typing}
        </div>${composer}
      </div>
    </div>${captionHtml}${replayHtml}
  </div>${script}${staticScript}
`);
}

// ============================================================
//  Forhåndsvisning (NØYAKTIG embed-markupen, skript kjøres)
// ============================================================

function mountSnippet(host, html, isStatic) {
  host.innerHTML = html;
  const root = host.querySelector('[id^="fcb-"]');
  if (root && isStatic) root.setAttribute('data-static', '');
  host.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script');
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
  return root;
}

function renderPreview() {
  const cfg = readConfig();
  const has = activeMsgs(cfg.msgs).length > 0;
  els.copyEmbed.disabled = !has;
  els.playBtn.disabled = !has || cfg.trigger === 'static';
  document.body.classList.toggle('cb-frame-bare', cfg.frame !== 'window');
  document.body.classList.toggle('cb-frame-profile', cfg.frame === 'profile');
  document.body.classList.toggle('cb-profbg-custom', els.profBg.value === 'custom');
  document.body.classList.toggle('cb-static', cfg.trigger === 'static');
  fillReadySelect();
  const logAv = cfg.avatarLog === 'on' || (cfg.avatarLog !== 'off' && APPS[cfg.app].avatarInLog);
  document.body.classList.toggle('cb-no-avatar', !((cfg.frame === 'window' && cfg.header) || cfg.frame === 'profile' || logAv));
  if (!has) {
    els.previewHost.innerHTML = '<p class="ftb-empty">Legg til meldinger — forhåndsvisningen dukker opp her.</p>';
    return;
  }
  mountSnippet(els.previewHost, buildEmbedSnippet(cfg), true);
  updateDuration(cfg);
}

// «Står klar fra start»: velg til og med hvilken melding (resten popper opp)
function fillReadySelect() {
  const sel = els.ready;
  const msgs = activeMsgs(state.msgs);
  if (state.readyTo && !msgs.some(m => m.id === state.readyTo)) state.readyTo = '';
  sel.innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = ''; o0.textContent = 'Ingen — alt popper opp';
  sel.appendChild(o0);
  msgs.forEach((m, i) => {
    if (i === msgs.length - 1) return;   // minst én melding må poppe opp
    const o = document.createElement('option');
    o.value = m.id;
    const who = m.kind === 'sep' ? 'Tid' : (m.kind === 'me' ? 'Deg' : 'Den andre');
    const txt = String(m.text || '').trim() || '(bilde)';
    o.textContent = `Til og med ${i + 1}: ${who} – ${txt.length > 26 ? txt.slice(0, 26) + '…' : txt}`;
    sel.appendChild(o);
  });
  sel.value = state.readyTo || '';
}

function updateDuration(cfg) {
  const hint = document.getElementById('playHint');
  if (!hint) return;
  if (cfg.trigger === 'static') { hint.textContent = 'Animasjon er slått av — samtalen vises ferdig.'; return; }
  const msgs = activeMsgs(cfg.msgs);
  const items = [];
  const A = APPS[cfg.app];
  const lastMe = msgs.map(m => m.kind).lastIndexOf('me');
  const readyIdx = cfg.readyTo ? msgs.findIndex(m => m.id === cfg.readyTo) : -1;
  msgs.forEach((m, i) => {
    items.push({ k: m.kind, pre: i <= readyIdx, len: graphemes(String(m.text || '').trim()).length, wait: secToMs(m.wait), type: secToMs(m.typeSec) });
    if (cfg.status && A.status === 'below' && i === lastMe && i === msgs.length - 1) items.push({ k: 'status', pre: i <= readyIdx, len: 0, wait: null, type: null });
  });
  const plan = fcbPlan(items, cfg.speed, cfg.typing, cfg.frame === 'window' && cfg.compose);
  const sec = Math.round(plan.total / 100) / 10;
  hint.textContent = `Avspillingen varer ca. ${String(sec).replace('.', ',')} s. Forhåndsvisningen viser ferdig samtale — trykk for å se animasjonen.`;
}

els.playBtn.addEventListener('click', () => {
  // Bygg på nytt uten data-static og spill av med én gang
  const root = mountSnippet(els.previewHost, buildEmbedSnippet(readConfig()), true);
  if (root && root.__fcbPlay) {
    root.removeAttribute('data-static');
    root.__fcbPlay();
    root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    renderPreview();
    saveStateNow();
  }, 250);
}

els.copyEmbed.addEventListener('click', async () => {
  const cfg = readConfig();
  if (!activeMsgs(cfg.msgs).length) return;
  try {
    await window.faktisk.copyToClipboard(buildEmbedSnippet(cfg));
    const orig = 'Kopier embed';
    els.copyEmbed.textContent = '✅ Kopiert! Slå av «Validate input» i Labrador';
    setTimeout(() => { els.copyEmbed.textContent = orig; }, 4500);
  } catch (e) {
    els.copyEmbed.textContent = 'Kunne ikke kopiere';
    setTimeout(() => { els.copyEmbed.textContent = 'Kopier embed'; }, 3000);
  }
});

// ---------- Video-eksport (Studio 0.7.10+) ----------
// Embed-koden spilles av i et usynlig vindu med virtuell klokke, ramme for
// ramme, og kodes med ffmpeg. MP4 får bakgrunnsfarge; .mov beholder alfa.
const vid = {
  format: document.getElementById('vidFormat'), scale: document.getElementById('vidScale'),
  bg: document.getElementById('vidBg'), btn: document.getElementById('exportVideoBtn'),
  status: document.getElementById('vidStatus'),
};
let vidBusy = false;
function vidSay(t, err) { vid.status.textContent = t || ''; vid.status.style.color = err ? '#FFB4B4' : ''; }
function vidPlanMs(cfg) {
  const msgs = activeMsgs(cfg.msgs), A = APPS[cfg.app];
  const lastMe = msgs.map(m => m.kind).lastIndexOf('me');
  const readyIdx = cfg.readyTo ? msgs.findIndex(m => m.id === cfg.readyTo) : -1;
  const items = [];
  msgs.forEach((m, i) => {
    items.push({ k: m.kind, pre: i <= readyIdx, len: graphemes(String(m.text || '').trim()).length, wait: secToMs(m.wait), type: secToMs(m.typeSec) });
    if (cfg.status && A.status === 'below' && i === lastMe && i === msgs.length - 1) items.push({ k: 'status', pre: i <= readyIdx, len: 0, wait: null, type: null });
  });
  return fcbPlan(items, cfg.speed, cfg.typing, cfg.frame === 'window' && cfg.compose).total;
}
function syncVidUi() {
  vid.bg.style.display = vid.format.value === 'mp4' ? '' : 'none';
  if (!window.faktisk.domVideoExport) {
    vid.btn.disabled = true;
    vidSay('Video-eksport krever Faktisk Studio 0.7.10 eller nyere.');
  }
}
vid.format.addEventListener('change', syncVidUi);
syncVidUi();

vid.btn.addEventListener('click', async () => {
  if (vidBusy) { window.faktisk.domVideoExportCancel && window.faktisk.domVideoExportCancel(); vidSay('Avbryter…'); return; }
  const base = readConfig();
  if (!activeMsgs(base.msgs).length) { vidSay('Legg til meldinger først.', true); return; }
  const fmt = vid.format.value;
  const ext = fmt === 'mp4' ? 'mp4' : 'mov';
  const name = ('chatbobler-' + (base.themName || base.app)).toLowerCase().replace(/[^a-z0-9æøå]+/g, '-').replace(/-+$/, '') + (fmt === 'mp4' ? '' : '-transparent') + '.' + ext;
  const savePath = await window.faktisk.saveDialog({
    title: 'Lagre video', defaultPath: name,
    filters: [{ name: fmt === 'mp4' ? 'MP4-video' : 'QuickTime-video', extensions: [ext] }],
  });
  if (!savePath) return;
  // Videoen skal alltid animeres, uten «Spill av igjen»-knappen
  const cfg = Object.assign({}, base, { replay: false, trigger: 'early' });
  const width = cfg.width === 'full' ? 480 : (parseInt(cfg.width, 10) || 390);
  const durationMs = vidPlanMs(cfg) + 1800;   // hold sluttbildet litt
  vidBusy = true;
  vid.btn.textContent = 'Avbryt eksport';
  vidSay('Forbereder…');
  const unsub = window.faktisk.onDomVideoProgress ? window.faktisk.onDomVideoProgress(m => {
    if (m.phase === 'rendering') vidSay('Lager video … ' + m.percent + ' % (ramme ' + m.frame + ' av ' + m.frames + ')');
    else if (m.phase === 'encoding') vidSay('Koder videoen …');
    else if (m.phase === 'loading') vidSay('Laster samtalen …');
  }) : () => {};
  try {
    const res = await window.faktisk.domVideoExport({
      html: buildEmbedSnippet(cfg), width, scale: +vid.scale.value, fps: 30, durationMs,
      background: vid.bg.value, padding: 16, format: fmt, savePath,
    });
    if (!res || !res.ok) { vidSay('Eksport feilet: ' + ((res && res.error) || 'ukjent feil'), true); return; }
    vid.status.innerHTML = '';
    const ok = document.createElement('span');
    ok.textContent = 'Lagret ✓ ' + res.width + '×' + res.height + ' px, ' + (res.sizeMB || '?') + ' MB. ';
    const show = document.createElement('button');
    show.type = 'button'; show.className = 'link-btn'; show.textContent = 'Vis i Finder';
    show.addEventListener('click', () => window.faktisk.revealInFinder(res.savePath));
    vid.status.append(ok, show);
  } catch (err) {
    vidSay('Eksport feilet: ' + err.message, true);
  } finally {
    unsub(); vidBusy = false; vid.btn.textContent = 'Eksporter video…';
  }
});

// Forhåndsvis i ulike embed-bredder (Labrador mobil 380 / spalte / full)
const pwBtns = Array.from(document.querySelectorAll('[data-pw]'));
function setPreviewWidth(w) {
  const art = document.getElementById('articleHost');
  if (art) art.style.maxWidth = 'calc(' + w + 'px + 48px)';   // 2 × 24 px padding
  pwBtns.forEach(b => b.classList.toggle('is-active', b.dataset.pw === String(w)));
}
pwBtns.forEach(b => b.addEventListener('click', () => setPreviewWidth(b.dataset.pw)));

els.frameBtns.forEach(b => b.addEventListener('click', () => {
  state.frame = b.dataset.frame;
  els.frameBtns.forEach(x => x.classList.toggle('is-active', x === b));
  scheduleUpdate();
}));

els.back.addEventListener('click', async () => { await window.faktisk.goHome(); });
els.full.addEventListener('click', async () => { await window.faktisk.toggleFullscreen(); });
els.openLabrador.addEventListener('click', async () => {
  await window.faktisk.openExternal('https://labrador.faktisk.no/settings/upload-file');
});

// ============================================================
//  Arkivering
// ============================================================

let isRestoring = false;

function serializeState() {
  const c = readConfig();
  return {
    app: c.app, theme: c.theme, frame: state.frame,
    themName: els.themName.value, themStatus: els.themStatus.value,
    themAvatar: els.themAvatar.value, meName: els.meName.value,
    msgs: state.msgs.map(m => ({ id: m.id, kind: m.kind, text: m.text, time: m.time, img: m.img, imgW: m.imgW || 0, imgH: m.imgH || 0, wait: m.wait || '', typeSec: m.typeSec || '' })),
    trigger: c.trigger, readyTo: state.readyTo || '', speed: els.speed.value,
    typing: c.typing, compose: c.compose, replay: c.replay,
    header: c.header, avatarLog: c.avatarLog, avSize: c.avSize, avZoom: c.avZoom, avX: c.avX, avY: c.avY, times: c.times, status: c.status,
    width: c.width, align: c.align, textSize: els.size.value, padTop: c.padTop, padBot: c.padBot, height: c.height, caption: els.caption.value,
    profBg: els.profBg.value, profBgColor: els.profBgColor.value,
  };
}

function applyState(s) {
  if (!s) return;
  isRestoring = true;
  try {
    if (s.app && APPS[s.app]) els.app.value = s.app;
    if (s.theme) els.theme.value = s.theme;
    if (s.frame === 'window' || s.frame === 'bare' || s.frame === 'profile') {
      state.frame = s.frame;
      els.frameBtns.forEach(x => x.classList.toggle('is-active', x.dataset.frame === s.frame));
    }
    els.themName.value = s.themName != null ? s.themName : 'Kari';
    els.themStatus.value = s.themStatus || '';
    els.themAvatar.value = s.themAvatar || '';
    els.meName.value = s.meName != null ? s.meName : 'Meg';
    if (s.trigger) els.trigger.value = s.trigger === 'scroll' ? 'middle' : s.trigger;
    state.readyTo = s.readyTo || '';
    if (s.speed) els.speed.value = s.speed;
    [['typing', els.optTyping], ['compose', els.optCompose], ['replay', els.optReplay],
     ['header', els.optHeader], ['times', els.optTimes], ['status', els.optStatus]].forEach(([k, el]) => {
      if (typeof s[k] === 'boolean') el.checked = s[k];
    });
    if (s.avatarLog) els.avatarLog.value = s.avatarLog;
    [['avSize', els.avSize], ['avZoom', els.avZoom], ['avX', els.avX], ['avY', els.avY]].forEach(([k, el]) => {
      if (Number.isFinite(s[k])) el.value = s[k];
    });
    updateAvOut();
    if (s.width) els.width.value = s.width === '520' ? '480' : s.width;
    if (s.align) els.align.value = s.align;
    if (s.textSize) els.size.value = s.textSize;
    updateSizeOut();
    if (Number.isFinite(s.padTop)) els.padTop.value = s.padTop;
    if (Number.isFinite(s.padBot)) els.padBot.value = s.padBot;
    updatePadOut();
    if (s.height) els.height.value = s.height;
    if (s.profBg) els.profBg.value = s.profBg;
    if (s.profBgColor) els.profBgColor.value = s.profBgColor;
    els.caption.value = s.caption || '';
    if (Array.isArray(s.msgs)) {
      state.msgs = s.msgs.map(m => ({
        id: m.id || uid(), kind: ['me', 'them', 'sep'].includes(m.kind) ? m.kind : 'them',
        text: m.text || '', time: m.time || '', img: m.img || '', imgOpen: !!m.img,
        imgW: m.imgW || 0, imgH: m.imgH || 0,
        wait: m.wait || '', typeSec: m.typeSec || '', timeOpen: !!(m.wait || m.typeSec),
      }));
    }
    // Eldre prosjekter uten bildemål: les dem inn nå
    state.msgs.forEach(m => { if (m.img && !(m.imgW > 0)) probeImageSize(m); });
    renderList();
    renderPreview();
  } finally {
    isRestoring = false;
  }
}

function saveStateNow() {
  if (isRestoring) return;
  window.faktisk.stateSave(PLUGIN_ID, serializeState()).catch(console.error);
}

[els.themName, els.themStatus, els.themAvatar, els.meName, els.caption].forEach(el => {
  el.addEventListener('input', scheduleUpdate);
});
function updateSizeOut() {
  els.sizeOut.textContent = Math.round(parseFloat(els.size.value) * 100) + ' %';
}
els.size.addEventListener('input', () => { updateSizeOut(); scheduleUpdate(); });
function updateAvOut() {
  document.getElementById('avSizeOut').textContent = Math.round(els.avSize.value * 100) + ' %';
  document.getElementById('avZoomOut').textContent = Math.round(els.avZoom.value * 100) + ' %';
  document.body.classList.toggle('cb-has-avimg', isValidUrl(els.themAvatar.value.trim()));
}
[els.avSize, els.avZoom, els.avX, els.avY].forEach(el => el.addEventListener('input', () => { updateAvOut(); scheduleUpdate(); }));
els.themAvatar.addEventListener('input', updateAvOut);
function updatePadOut() {
  els.padTopOut.textContent = els.padTop.value + ' px';
  els.padBotOut.textContent = els.padBot.value + ' px';
}
[els.padTop, els.padBot].forEach(el => el.addEventListener('input', () => { updatePadOut(); scheduleUpdate(); }));

els.ready.addEventListener('change', () => { state.readyTo = els.ready.value; scheduleUpdate(); });
[els.app, els.theme, els.trigger, els.speed, els.optTyping, els.optCompose, els.optReplay,
 els.optHeader, els.avatarLog, els.optTimes, els.optStatus, els.width, els.align, els.size, els.height, els.profBg].forEach(el => {
  el.addEventListener('change', scheduleUpdate);
});
els.profBgColor.addEventListener('input', () => { els.profBg.value = 'custom'; scheduleUpdate(); });

async function refreshProjectList() {
  try {
    const res = await window.faktisk.projectList(PLUGIN_ID);
    if (!res.ok) return;
    const sel = els.projectSelect;
    while (sel.options.length > 1) sel.remove(1);
    res.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.fileId;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  } catch (e) { console.error(e); }
}

els.saveProject.addEventListener('click', async () => {
  const first = state.msgs.find(m => m.kind !== 'sep' && m.text.trim());
  const defaultName = (els.themName.value.trim() ? 'Samtale med ' + els.themName.value.trim() : '')
    || (first ? first.text.slice(0, 40).trim() : '')
    || `Chatbobler ${new Date().toLocaleDateString('no')}`;
  const name = await window.faktiskDialog.prompt('Lagre prosjekt som:', defaultName);
  if (!name || !name.trim()) return;
  const res = await window.faktisk.projectSave(PLUGIN_ID, name.trim(), serializeState());
  if (res.ok) await refreshProjectList();
});

els.projectSelect.addEventListener('change', async () => {
  const fileId = els.projectSelect.value;
  if (!fileId) return;
  const res = await window.faktisk.projectLoad(PLUGIN_ID, fileId);
  if (res.ok && res.state) applyState(res.state);
});

// Eksempelsamtale som utgangspunkt
function starterConversation() {
  const mk = (kind, text, time) => ({ id: uid(), kind, text, time: time || '', img: '', imgOpen: false });
  return [
    mk('sep', 'I dag 14:32'),
    mk('them', 'Hei! Har du sett videoen som går rundt nå? 😳', '14:32'),
    mk('me', 'Nei, hvilken da?', '14:33'),
    mk('them', 'Den om at strømmen skal rasjoneres fra neste uke', '14:33'),
    mk('them', 'Alle deler den', '14:33'),
    mk('me', 'Send lenken, så sjekker jeg den 🔍', '14:34'),
  ];
}

(async function init() {
  setPreviewWidth(680);
  await refreshProjectList();
  const pending = localStorage.getItem('faktisk-pending-project');
  if (pending) {
    try {
      const { pluginId, fileId } = JSON.parse(pending);
      localStorage.removeItem('faktisk-pending-project');
      if (pluginId === PLUGIN_ID) {
        const res = await window.faktisk.projectLoad(pluginId, fileId);
        if (res.ok && res.state) {
          applyState(res.state);
          els.projectSelect.value = fileId;
          return;
        }
      }
    } catch (e) {}
  }
  try {
    const res = await window.faktisk.stateLoad(PLUGIN_ID);
    if (res.ok && res.state) {
      applyState(res.state);
      return;
    }
  } catch (e) {}
  state.msgs = starterConversation();
  renderList();
  renderPreview();
})();
