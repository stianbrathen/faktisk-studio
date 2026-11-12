// Leser den nyeste Electron-krasjrapporten fra macOS og skriver ut det
// vesentlige: hva som terminerte prosessen og hvor det smalt.
// Bruk: node scripts/crash-info.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
const files = fs.readdirSync(dir)
  .filter(f => f.startsWith('Electron') && f.endsWith('.ips'))
  .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

if (!files.length) {
  console.log('Ingen Electron-krasjrapporter funnet i', dir);
  process.exit(0);
}

const file = path.join(dir, files[0].f);
console.log('=== ' + file + ' ===\n');

const raw = fs.readFileSync(file, 'utf-8');
const nl = raw.indexOf('\n');
const body = JSON.parse(raw.slice(nl + 1));

console.log('Termination:', JSON.stringify(body.termination || {}, null, 2));
console.log('\nException:', JSON.stringify(body.exception || {}, null, 2));

const idx = body.faultingThread || 0;
const thread = (body.threads || [])[idx] || {};
const imgs = body.usedImages || [];
console.log('\nKrasjende tråd (topp 14 rammer):');
(thread.frames || []).slice(0, 14).forEach(fr => {
  const img = imgs[fr.imageIndex] || {};
  console.log('  ' + (img.name || '?') + '  ' + (fr.symbol || '+' + fr.imageOffset));
});
