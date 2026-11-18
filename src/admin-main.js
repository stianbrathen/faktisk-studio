// Faktisk Studio · Admin
//
// Admin er den som har plugin-registeret (faktiskorg-studio-plugins) klonet på maskinen og
// kan pushe til GitHub – samme regel som i forslaget om Final Cut-maler. Det finnes ingen
// egen innlogging: uten registeret lokalt vises ikke Admin, og uten skrivetilgang til GitHub
// kommer ingen endringer ut. Labrador-innloggingen (main.js: labradorWhoAmI) vises bare.
//
// Seksjoner (admin.html): Betatilgang (nå), Plugins (oversikt), Maler (senere: godkjenning
// av delte Final Cut-maler og templates-registry.json i samme repo).
//
//   admin-status        {admin, repo, user}
//   admin-choose-repo   velg mappa med registeret
//   admin-registry      plugins i registeret + kjente e-poster for betalistene + git-status
//   admin-beta-set      {id, beta, emails} → oppdaterer registry.json (lokalt, ikke publisert)
//   admin-publish       {message} → git add registry.json, commit, push
//
// E-postadressene lagres bare lokalt (userData/admin-kjente.json, sjekksum → adresse), så
// admin ser navn i lista. I registeret står bare sjekksummene.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

let deps = null;   // { app, dialog, mainWindow: () => win, whoAmI: (force) => Promise<user>, betaHash }

const DEFAULT_REPOS = [
  path.join(os.homedir(), 'Dokumenter lokalt', 'Faktisk prosjekter', 'faktiskorg-studio-plugins'),
  path.join(os.homedir(), 'faktiskorg-studio-plugins'),
];
const settingsFile = () => path.join(deps.app.getPath('userData'), 'admin.json');
const knownFile = () => path.join(deps.app.getPath('userData'), 'admin-kjente.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch (e) { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n', 'utf-8');

function isRepo(p) { return !!p && fs.existsSync(path.join(p, 'registry.json')) && fs.existsSync(path.join(p, '.git')); }
function repoPath() {
  const s = readJson(settingsFile(), {});
  if (isRepo(s.repo)) return s.repo;
  return DEFAULT_REPOS.find(isRepo) || null;
}
function git(repo, args) {
  return new Promise((resolve) => execFile('git', args, { cwd: repo, timeout: 60000 }, (err, so, se) =>
    resolve({ ok: !err, out: String(so || '').trim(), err: String(se || (err && err.message) || '').trim() })));
}
function readRegistry(repo) { return JSON.parse(fs.readFileSync(path.join(repo, 'registry.json'), 'utf-8')); }
function writeRegistry(repo, reg) {
  reg.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(repo, 'registry.json'), JSON.stringify(reg, null, 2) + '\n', 'utf-8');
}

async function status() {
  const repo = repoPath();
  const user = deps.whoAmI ? await Promise.race([deps.whoAmI(false), new Promise((r) => setTimeout(r, 3000))]) : null;
  return { ok: true, admin: !!repo, repo, user: user ? { email: user.email } : null };
}

async function registry() {
  const repo = repoPath(); if (!repo) return { ok: false, error: 'Fant ikke plugin-registeret på maskinen' };
  const reg = readRegistry(repo), known = readJson(knownFile(), {});
  const st = await git(repo, ['status', '--porcelain', '--', 'registry.json']);
  await git(repo, ['fetch', '--quiet']);
  const behind = await git(repo, ['rev-list', '--count', 'HEAD..@{u}']);
  const ahead = await git(repo, ['rev-list', '--count', '@{u}..HEAD']);
  return { ok: true, repo, changed: !!st.out, behind: Number(behind.out) || 0, ahead: Number(ahead.out) || 0,
    plugins: reg.plugins.map((p) => ({ id: p.id, name: p.name, version: p.version, minStudioVersion: p.minStudioVersion,
      changelog: p.changelog, beta: !!p.beta, betaUsers: (p.betaUsers || []).map((h) => ({ hash: h, email: known[h] || null })) })) };
}

function betaSet(o) {
  const repo = repoPath(); if (!repo) return { ok: false, error: 'Fant ikke plugin-registeret' };
  const reg = readRegistry(repo), entry = reg.plugins.find((p) => p.id === o.id);
  if (!entry) return { ok: false, error: `«${o.id}» er ikke i registeret ennå. Publiser første versjon med release-plugin.sh (tilgangen i manifestet blir med), så kan den styres herfra.` };
  const known = readJson(knownFile(), {});
  const emails = (o.emails || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const hashes = [...new Set([...(o.keepHashes || []), ...emails.map((e) => { const h = deps.betaHash(e); known[h] = e; return h; })])];
  if (o.beta) { entry.beta = true; entry.betaUsers = hashes; } else { delete entry.beta; delete entry.betaUsers; }
  writeRegistry(repo, reg); writeJson(knownFile(), known);
  return { ok: true };
}

async function publish(o) {
  const repo = repoPath(); if (!repo) return { ok: false, error: 'Fant ikke plugin-registeret' };
  const msg = String((o && o.message) || 'Registeret oppdatert fra Studio-admin').slice(0, 200);
  const steps = [];
  for (const args of [['pull', '--rebase', '--autostash'], ['add', 'registry.json'], ['commit', '-m', msg], ['push']]) {
    const r = await git(repo, args); steps.push({ cmd: 'git ' + args.join(' '), ...r });
    if (!r.ok && !(args[0] === 'commit' && /nothing to commit/.test(r.out + r.err))) return { ok: false, error: r.err || r.out, steps };
  }
  return { ok: true, steps };
}

function register(ipcMain, d) {
  deps = d;
  const guard = (fn) => async (e, a) => { try { return await fn(a); } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('admin-status', guard(() => status()));
  ipcMain.handle('admin-choose-repo', guard(async () => {
    const r = await deps.dialog.showOpenDialog({ title: 'Velg mappa med plugin-registeret (faktiskorg-studio-plugins)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    if (!isRepo(r.filePaths[0])) return { ok: false, error: 'Mappa har ikke registry.json og git' };
    writeJson(settingsFile(), { ...readJson(settingsFile(), {}), repo: r.filePaths[0] }); return status();
  }));
  ipcMain.handle('admin-registry', guard(() => registry()));
  ipcMain.handle('admin-beta-set', guard((o) => betaSet(o)));
  ipcMain.handle('admin-publish', guard((o) => publish(o)));
  ipcMain.handle('open-admin', guard(() => { deps.mainWindow().loadFile(path.join(__dirname, 'admin.html')); return { ok: true }; }));
}

module.exports = { register, _test: { isRepo, repoPath, betaSet, registry, setDeps: (x) => { deps = x; } } };
