// Felles for bakgrunn, popup og innstillinger: snakker med Faktisk Studio
// på 127.0.0.1:47361 med koble-koden fra Bevissikring-pluginen.

const FS_BASE = 'http://127.0.0.1:47361';
const FS_EXT_VERSION = chrome.runtime.getManifest().version;

async function fsGet(keys) { return chrome.storage.local.get(keys); }

async function fsCall(path, body) {
  const { token } = await fsGet('token');
  if (!token) { const e = new Error('Ikke koblet til Studio ennå — åpne Innstillinger og lim inn koble-koden.'); e.noToken = true; throw e; }
  let res;
  try {
    res = await fetch(FS_BASE + path, { signal: path === '/status' ? AbortSignal.timeout(2500) : undefined,
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ 'X-Faktisk-Token': token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const e = new Error('Faktisk Studio kjører ikke. Start appen og prøv igjen.');
    e.offline = true; throw e;
  }
  const j = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
  if (!res.ok || !j.ok) { const e = new Error(j.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
  return j;
}

function fsVideoUrl(info, tab) {
  // Lenke man høyreklikket på, ellers siden (yt-dlp vil ha innleggets adresse,
  // ikke blob:-adressen til selve videoelementet)
  const cand = [info && info.linkUrl, info && info.pageUrl, tab && tab.url];
  return cand.find(u => /^https?:\/\//i.test(u || '')) || '';
}

function fsBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Siden slik den ser ut i Chrome: synlig skjermbilde, MHTML og tekst.
// Krever at brukeren nettopp klikket på utvidelsen (activeTab).
async function fsCapturePage(tab) {
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await new Promise((resolve, reject) => chrome.pageCapture.saveAsMHTML({ tabId: tab.id }, b => {
    if (b) resolve(b); else reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'MHTML feilet'));
  }));
  let page = {};
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const meta = {};
        for (const m of Array.from(document.querySelectorAll('meta[property], meta[name]')).slice(0, 200)) {
          const k = m.getAttribute('property') || m.getAttribute('name');
          if (k && m.content && !(k in meta)) meta[k] = m.content.slice(0, 2000);
        }
        return { url: location.href, title: document.title, text: document.body ? document.body.innerText : '', meta,
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, userAgent: navigator.userAgent };
      },
    });
    page = (r && r[0] && r[0].result) || {};
  } catch (e) { /* f.eks. chrome://-sider */ }
  return {
    url: page.url || tab.url, title: page.title || tab.title || '', text: page.text || '', meta: page.meta || {},
    viewport: page.viewport || null, userAgent: page.userAgent || navigator.userAgent,
    screenshot: shot, mhtml: fsBase64(await blob.arrayBuffer()), capturedAt: new Date().toISOString(), extVersion: FS_EXT_VERSION,
  };
}

async function fsHasAllHosts() { try { return await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (e) { return false; } }

async function fsCaseName() {
  const { caseName } = await fsGet('caseName');
  return caseName || '';
}
