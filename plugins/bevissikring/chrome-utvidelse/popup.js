const $ = id => document.getElementById(id);
let tab = null;
let studio = null;      // svar fra /status, eller null

function setMsg(text, kind) { $('msg').textContent = text || ''; $('msg').className = 'msg' + (kind ? ' ' + kind : ''); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderJobs(jobs) {
  if (!jobs || !jobs.length) { $('jobs').innerHTML = '<li class="muted">Ingen ennå</li>'; return; }
  $('jobs').innerHTML = jobs.slice(0, 8).map(j =>
    '<li><span class="t" title="' + esc(j.url) + '">' + (j.kind === 'video' ? '▶ ' : '▣ ') + esc(j.title || j.url) + '</span>' +
    '<span class="s ' + esc(j.status) + '" title="' + esc(j.error || '') + '">' + esc(j.status) + '</span></li>').join('');
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function refresh() {
  try {
    const st = await fsCall('/status');
    studio = st;
    $('dot').classList.add('on');
    const full = (st.features || []).includes('full');
    $('conn').textContent = 'Koblet til Faktisk Studio ' + st.version + (full ? ' — sikringer går rett i arkivet' : ' — oppdater Studio for «Sikre alt»');
    $('videoHint').textContent = '';
    const notes = [];
    if (st.extVersion && newer(st.extVersion, chrome.runtime.getManifest().version)) notes.push('Ny versjon av utvidelsen (' + st.extVersion + ') finnes: Bevissikring i Studio → «Hent utvidelsen», og trykk ↻ på chrome://extensions.');
    if (st.rootProblem) notes.push(st.rootProblem);
    if (notes.length && !$('msg').textContent) setMsg(notes.join(' '), 'err');
    $('cases').innerHTML = (st.cases || []).map(c => '<option value="' + esc(c) + '">').join('');
    if (!$('caseInput').value) $('caseInput').value = (await fsCaseName()) || st.caseName || '';
    renderJobs(st.jobs);
  } catch (err) {
    studio = null;
    $('dot').classList.remove('on');
    $('conn').textContent = err.noToken ? err.message : 'Studio kjører ikke — sikringer lagres i Nedlastinger/Bevissikring.';
    $('videoHint').textContent = '(strømmet video krever Studio)';
    if (!$('caseInput').value) $('caseInput').value = await fsCaseName();
  }
}

async function saveOpts() {
  await chrome.storage.local.set({
    caseName: $('caseInput').value.trim(),
    optScroll: $('optScroll').checked, optExpand: $('optExpand').checked, optImages: $('optImages').checked, optVideo: $('optVideo').checked,
  });
}
async function checkPerm() {
  const has = await fsHasAllHosts();
  $('permBox').hidden = has || !($('optImages').checked || $('optVideo').checked);
  return has;
}
['optScroll', 'optExpand', 'optImages', 'optVideo'].forEach(id => $(id).addEventListener('change', () => { saveOpts(); checkPerm(); }));
$('caseInput').addEventListener('change', saveOpts);
$('optLink').addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
$('permBtn').addEventListener('click', async () => { await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false); checkPerm(); });

function showProgress(p) {
  if (!p) return;
  $('prog').hidden = false;
  $('bar').style.width = Math.max(2, Math.min(100, p.pct || 0)) + '%';
  $('progMsg').textContent = p.msg || '';
  $('progMsg').className = 'msg' + (p.done ? (p.ok ? ' ok' : ' err') : '');
  $('allBtn').disabled = !p.done;
  $('allBtn').textContent = p.done ? 'Sikre alt jeg ser' : 'Sikrer …';
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'session' && ch.progress) showProgress(ch.progress.newValue); });

$('allBtn').addEventListener('click', async () => {
  if (!tab || !/^https?:/i.test(tab.url || '')) { setMsg('Kan bare sikre vanlige nettsider', 'err'); return; }
  await saveOpts();
  // Tilgang må bes om mens brukeren klikker; uten tilgang sikres resten likevel
  if (($('optImages').checked || $('optVideo').checked) && !(await fsHasAllHosts())) {
    await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    checkPerm();
  }
  setMsg('');
  showProgress({ msg: 'Starter …', pct: 1 });
  const opts = { scroll: $('optScroll').checked, expand: $('optExpand').checked, images: $('optImages').checked, video: $('optVideo').checked,
    caseName: $('caseInput').value.trim(), note: $('note').value.trim() };
  const r = await chrome.runtime.sendMessage({ type: 'captureAll', tabId: tab.id, opts });
  if (r && r.ok) $('note').value = '';
  setTimeout(refresh, 800);
});

$('videoBtn').addEventListener('click', async () => {
  const url = fsVideoUrl(null, tab);
  if (!url) { setMsg('Denne siden har ingen vanlig nettadresse', 'err'); return; }
  await saveOpts();
  $('videoBtn').disabled = true;
  try {
    await fsCall('/download', { url, case: $('caseInput').value.trim(), note: $('note').value.trim(), extVersion: FS_EXT_VERSION });
    setMsg('Sendt — Studio laster ned i bakgrunnen.', 'ok');
    $('note').value = '';
    setTimeout(refresh, 600);
  } catch (err) {
    if (err.offline) {
      await chrome.tabs.create({ url: 'faktisk-studio://last-ned?url=' + encodeURIComponent(url) });
      setMsg('Studio kjørte ikke — åpner appen. Den spør før nedlasting.', 'ok');
    } else setMsg(err.message, 'err');
  } finally { $('videoBtn').disabled = false; }
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const o = await fsGet(['optScroll', 'optExpand', 'optImages', 'optVideo']);
  if (o.optScroll === false) $('optScroll').checked = false;
  if (o.optExpand === false) $('optExpand').checked = false;
  if (o.optImages === false) $('optImages').checked = false;
  if (o.optVideo === false) $('optVideo').checked = false;
  checkPerm();
  const { progress } = await chrome.storage.session.get('progress');
  const { running } = await chrome.runtime.sendMessage({ type: 'isRunning' }).catch(() => ({}));
  if (progress && (running || Date.now() - progress.at < 60000)) showProgress(Object.assign({}, progress, { done: !running && progress.done }));
  else {
    const { lastMessage } = await fsGet('lastMessage');
    if (lastMessage && Date.now() - lastMessage.at < 60000) setMsg(lastMessage.msg, lastMessage.ok ? 'ok' : 'err');
  }
  await refresh();
  setInterval(refresh, 4000);
})();
