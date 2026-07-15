#!/usr/bin/env node
// sync-shared.js — kopierer alle filer fra plugins/_shared/ inn i hver plugins shared/-mappe.
//
// Bruk:
//   node plugins/_shared/sync-shared.js
//
// Kjøres fra Studio-repoens rot ELLER fra plugin-repoen. Auto-detekterer.
//
// Effekt: hver plugin/<id>/shared/ får en oppdatert kopi av alle non-README-filer i _shared/.
// Overskriver stille — endringer i plugin/<id>/shared/* forsvinner.
//
// Løser F2 fra kodegjennomgangen: én kanonisk kilde for delte plugin-filer.

const fs = require('fs');
const path = require('path');

// Finn Studio-plugin-mappen — auto-detekter både fra Studio-repo-rot og fra plugin-repo
function findStudioPluginsDir() {
  const candidates = [
    path.resolve(__dirname, '..'),                              // plugins/_shared/ → plugins/
    path.resolve(process.cwd(), 'plugins'),                     // Studio-repo-rot
    path.resolve(process.cwd(), '../Faktisk Studio/plugins'),   // plugin-repo → Studio-repo
    path.resolve(process.cwd(), '../../plugins'),               // fallback
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, '_shared'))) {
      return dir;
    }
  }
  throw new Error('Fant ikke plugins-mappen. Kjør fra Studio-repo-rot eller plugin-repo.');
}

const pluginsDir = findStudioPluginsDir();
const sharedDir = path.join(pluginsDir, '_shared');

// Hvilke filer i _shared/ skal synkroniseres — ignorer README + selve scriptet
function shouldSync(name) {
  if (name === 'README.md') return false;
  if (name === 'sync-shared.js') return false;
  if (name.startsWith('.')) return false;
  return true;
}

const sharedFiles = fs.readdirSync(sharedDir).filter(shouldSync);
console.log(`Synker ${sharedFiles.length} fil${sharedFiles.length === 1 ? '' : 'er'} fra _shared/:`);
sharedFiles.forEach(f => console.log(`  • ${f}`));

// Finn alle plugin-mapper (som ikke er _shared)
const pluginIds = fs.readdirSync(pluginsDir, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
  .map(e => e.name);

let totalCopied = 0;
for (const id of pluginIds) {
  const pluginSharedDir = path.join(pluginsDir, id, 'shared');
  // Skip plugins uten shared/-mappe (feks bildemal om den ikke har det)
  if (!fs.existsSync(pluginSharedDir)) {
    console.log(`  ⊘ ${id}: ingen shared/-mappe, hoppet over`);
    continue;
  }
  let copiedHere = 0;
  for (const file of sharedFiles) {
    const src = path.join(sharedDir, file);
    const dst = path.join(pluginSharedDir, file);
    const srcContent = fs.readFileSync(src);
    // Skriv bare hvis innhold faktisk er annerledes (bevar mtime for uendret fil)
    if (fs.existsSync(dst)) {
      const dstContent = fs.readFileSync(dst);
      if (srcContent.equals(dstContent)) continue;
    }
    fs.writeFileSync(dst, srcContent);
    copiedHere++;
    totalCopied++;
  }
  if (copiedHere > 0) {
    console.log(`  ✓ ${id}: ${copiedHere} fil${copiedHere === 1 ? '' : 'er'} oppdatert`);
  }
}

if (totalCopied === 0) {
  console.log('\n✅ Alle plugins er allerede synkroniserte.');
} else {
  console.log(`\n✅ Ferdig: ${totalCopied} fil-kopiering(er).`);
}
