const $ = id => document.getElementById(id);
function setMsg(t, k) { $('msg').textContent = t; $('msg').className = 'msg' + (k ? ' ' + k : ''); }

async function test() {
  try {
    const st = await fsCall('/status');
    $('dot').classList.add('on');
    setMsg('Koblet til Faktisk Studio ' + st.version + '.', 'ok');
  } catch (err) {
    $('dot').classList.remove('on');
    setMsg(err.message, 'err');
  }
}

$('saveBtn').addEventListener('click', async () => {
  const token = $('token').value.trim().toUpperCase();
  await chrome.storage.local.set({ token });
  await test();
});

async function perm() {
  const has = await fsHasAllHosts();
  $('permInfo').textContent = has ? 'Utvidelsen har tilgang til å hente bilder og video med innloggingen din.' : 'Uten tilgang til nettsteder sikres skjermbilder, tekst og nettarkiv, men ikke bilder og video med innlogging.';
  $('permBtn').hidden = has;
}
$('permBtn').addEventListener('click', async () => { await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false); perm(); });
$('userName').addEventListener('input', () => chrome.storage.local.set({ userName: $('userName').value.trim() }));
$('stamp').addEventListener('change', () => chrome.storage.local.set({ noStamp: !$('stamp').checked }));

(async () => {
  const { token, userName, noStamp } = await fsGet(['token', 'userName', 'noStamp']);
  if (token) { $('token').value = token; test(); }
  $('userName').value = userName || '';
  $('stamp').checked = !noStamp;
  perm();
})();
