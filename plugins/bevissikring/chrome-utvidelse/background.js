// Bakgrunn: høyreklikkmeny og «Sikre alt jeg ser».
importScripts('common.js', 'capture.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'fs-all', title: 'Sikre alt jeg ser (Faktisk)', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'fs-video', title: 'Last ned video i Faktisk Studio', contexts: ['page', 'link', 'video'] });
  });
  fsGet('token').then(({ token }) => { if (!token) chrome.runtime.openOptionsPage(); });
});

async function badge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  if (text && text !== '…') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
}
async function remember(msg, ok) {
  await chrome.storage.local.set({ lastMessage: { msg, ok, at: Date.now() } });
}
async function progress(msg, pct, done, ok) {
  await chrome.storage.session.set({ progress: { msg, pct: pct || 0, done: !!done, ok: ok !== false, at: Date.now() } });
}

// Én sikring av gangen
let running = false;

async function studioReady() {
  try {
    const st = await fsCall('/status');
    if (!(st.features || []).includes('full')) return { ok: false, reason: 'old', st };
    if (st.rootProblem) return { ok: false, reason: 'root', st };
    return { ok: true, st };
  } catch (e) { return { ok: false, reason: e.noToken ? 'token' : 'offline', error: e.message }; }
}

async function captureAll(tab, opts) {
  if (running) throw new Error('En sikring pågår allerede');
  if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Kan bare sikre vanlige nettsider');
  running = true;
  await badge('…', '#0050FC');
  try {
    const report = (msg, pct) => progress(msg, pct);
    await progress('Starter …', 1);
    const studio = await studioReady();
    const cap = await fsCaptureAll(tab, opts, report);
    let msg;
    if (studio.ok) {
      const r = await fsDeliverToStudio(tab, cap, opts, report);
      msg = 'Sendt til Faktisk Studio (' + cap.files.length + ' filer' + (opts.video ? ', video lastes ned i Studio' : '') + ').';
      void r;
    } else {
      const r = await fsSaveLocally(tab, cap, opts, report);
      const why = studio.reason === 'old' ? 'Studio er for gammel for «Sikre alt»' : studio.reason === 'root' ? (studio.st.rootProblem || 'Studio mangler arkivmappe') : 'Studio kjører ikke';
      msg = why + ' — lagret i Nedlastinger/' + r.folder + (r.stamp && r.stamp.ok ? ' (tidsstemplet)' : '') + '.';
    }
    if (cap.warnings.length) msg += ' Merknader: ' + cap.warnings.join(' ');
    await progress(msg, 100, true, true);
    await remember(msg, true);
    await badge('✓', '#1E9E5A');
    return { ok: true, msg };
  } catch (err) {
    await progress(err.message, 100, true, false);
    await remember(err.message, false);
    await badge('!', '#D9534F');
    return { ok: false, error: err.message };
  } finally { running = false; }
}

async function optionsFromStorage() {
  const o = await fsGet(['optScroll', 'optExpand', 'optImages', 'optVideo', 'caseName']);
  return { scroll: o.optScroll !== false, expand: o.optExpand !== false, images: o.optImages !== false, video: o.optVideo !== false, caseName: o.caseName || '', note: '' };
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.target === 'offscreen') return;
  if (m.type === 'captureAll') {
    chrome.tabs.get(m.tabId).then(tab => captureAll(tab, m.opts)).then(reply);
    return true;
  }
  if (m.type === 'isRunning') { reply({ running }); return; }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const caseName = await fsCaseName();
  try {
    if (info.menuItemId === 'fs-all') {
      await captureAll(tab, await optionsFromStorage());
    } else if (info.menuItemId === 'fs-video') {
      const url = fsVideoUrl(info, tab);
      if (!url) throw new Error('Fant ingen adresse å laste ned fra');
      try {
        await fsCall('/download', { url, case: caseName, extVersion: FS_EXT_VERSION });
      } catch (err) {
        if (!err.offline) throw err;
        await chrome.tabs.create({ url: 'faktisk-studio://last-ned?url=' + encodeURIComponent(url) });
        await remember('Studio kjørte ikke — åpner appen, som spør før nedlasting.', true);
        return;
      }
      await remember('Sendt til Studio: ' + url, true);
      await badge('↓', '#0050FC');
    }
  } catch (err) {
    await remember(err.message, false);
    await badge('!', '#D9534F');
    if (err.noToken || err.status === 401) chrome.runtime.openOptionsPage();
  }
});
