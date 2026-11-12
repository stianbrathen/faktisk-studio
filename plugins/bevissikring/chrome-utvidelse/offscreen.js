// Skjult hjelpedokument: lager blob:-adresser som chrome.downloads kan lagre
// (service worker kan ikke lage dem selv). Brukes bare når Studio ikke kjører.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.target !== 'offscreen') return;
  if (m.type === 'blob') {
    const s = atob(m.data);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    reply({ url: URL.createObjectURL(new Blob([a], { type: m.mime || 'application/octet-stream' })) });
    return;
  }
  if (m.type === 'revoke') { try { URL.revokeObjectURL(m.url); } catch (e) {} reply({ ok: true }); }
});
