#!/usr/bin/env node
// Betatilgang til en plugin: hvem som ser den i Studio før den er sluppet for alle.
//
//   node scripts/beta-tilgang.js <plugin>                       vis status
//   node scripts/beta-tilgang.js <plugin> legg-til <e-post> …   gi tilgang
//   node scripts/beta-tilgang.js <plugin> fjern <e-post> …      ta bort tilgang
//   node scripts/beta-tilgang.js <plugin> slipp                 ikke lenger beta: synlig for alle
//
// Endrer plugins/<plugin>/manifest.json. E-postadressene lagres ikke, bare sha256 av
// 'faktisk-studio-beta:' + adressen (samme som main.js sjekker mot Labrador-innloggingen).
// Lista følger med når pluginen publiseres i registeret, og registeret vinner over manifestet
// i appen – så tilgang kan endres uten ny Studio-versjon.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [id, cmd, ...emails] = process.argv.slice(2);
if (!id) { console.log('Bruk: node scripts/beta-tilgang.js <plugin> [legg-til|fjern <e-post> … | slipp]'); process.exit(1); }
const file = path.join(__dirname, '..', 'plugins', id, 'manifest.json');
const m = JSON.parse(fs.readFileSync(file, 'utf-8'));
const hash = (e) => crypto.createHash('sha256').update('faktisk-studio-beta:' + e.trim().toLowerCase()).digest('hex');
m.betaUsers = m.betaUsers || [];
if (cmd === 'legg-til') { m.beta = true; for (const e of emails) { const h = hash(e); if (!m.betaUsers.includes(h)) m.betaUsers.push(h); console.log('+', e); } }
else if (cmd === 'fjern') { for (const e of emails) { const h = hash(e); m.betaUsers = m.betaUsers.filter((x) => x !== h); console.log('−', e); } }
else if (cmd === 'slipp') { delete m.beta; delete m.betaUsers; console.log(id, 'er ikke lenger beta.'); }
else if (cmd) { console.log('Ukjent kommando:', cmd); process.exit(1); }
if (cmd) fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf-8');
console.log(`${id}: ${m.beta ? 'beta, ' + (m.betaUsers || []).length + ' person(er) har tilgang' : 'ikke beta (synlig for alle)'}`);
