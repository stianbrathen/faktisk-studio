// Faktisk Studio — Electron main process
// Hovedvindu laster src/index.html (Malside-hub). Pluginene ligger i
// plugins/<id>/index.html og navigeres til via window.location.

const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const { version: APP_VERSION, registryUrl: REGISTRY_URL } = require('./package.json');

let mainWindow = null;

// Mappe for brukerinstallerte plugins (kan skrives til, sletteslves)
const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
// Mappe for innebygde plugins (read-only, kommer med .dmg)
const builtinPluginsDir = path.join(__dirname, 'plugins');
const registryCacheFile = path.join(app.getPath('userData'), 'registry-cache.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#9D9D9D',
    title: 'Faktisk Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
//  Plugin-skanning og navigering
// ============================================================

function scanPluginsDir(dir, sourceLabel) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const manifestPath = path.join(dir, d.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      found.push({
        id: d.name,
        source: sourceLabel,
        installPath: path.join(dir, d.name),
        ...manifest,
        entry: path.join(dir, d.name, manifest.entry || 'index.html'),
      });
    } catch (e) {
      console.error('Manifest-feil for', d.name, e);
    }
  }
  return found;
}

ipcMain.handle('list-plugins', async () => {
  const builtin = scanPluginsDir(builtinPluginsDir, 'builtin');
  const user = scanPluginsDir(userPluginsDir, 'user');
  const byId = new Map();
  for (const p of builtin) byId.set(p.id, p);
  for (const p of user) byId.set(p.id, p);
  return Array.from(byId.values());
});

ipcMain.handle('open-plugin', async (e, pluginId) => {
  const candidates = [
    path.join(userPluginsDir, pluginId, 'index.html'),
    path.join(builtinPluginsDir, pluginId, 'index.html'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) return { ok: false, error: 'Plugin finnes ikke: ' + pluginId };
  mainWindow.loadFile(found);
  return { ok: true };
});

ipcMain.handle('go-home', async () => {
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  return { ok: true };
});

ipcMain.handle('copy-to-clipboard', async (e, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle('toggle-fullscreen', async () => {
  const isFull = mainWindow.isFullScreen();
  mainWindow.setFullScreen(!isFull);
  return { ok: true, fullscreen: !isFull };
});

ipcMain.handle('save-dialog', async (e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, opts || {});
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('open-external', async (e, url) => {
  if (typeof url !== 'string') return { ok: false, error: 'Ugyldig URL' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Bare http(s) tillatt' };
  await shell.openExternal(url);
  return { ok: true };
});

// ============================================================
//  Arkivering — auto-restore state + navngitte prosjekter
// ============================================================

const dataDir = path.join(app.getPath('userData'), 'state');
const projectsDir = path.join(app.getPath('userData'), 'projects');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function safeId(s) {
  return String(s).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 100);
}

ipcMain.handle('state-save', async (e, pluginId, state) => {
  try {
    ensureDir(dataDir);
    const file = path.join(dataDir, safeId(pluginId) + '.json');
    const payload = { schemaVersion: 1, savedAt: new Date().toISOString(), state };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('state-load', async (e, pluginId) => {
  try {
    const file = path.join(dataDir, safeId(pluginId) + '.json');
    if (!fs.existsSync(file)) return { ok: true, state: null };
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { ok: true, state: payload.state || null, savedAt: payload.savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-save', async (e, pluginId, name, state) => {
  try {
    if (!name || !name.trim()) return { ok: false, error: 'Mangler navn' };
    const dir = path.join(projectsDir, safeId(pluginId));
    ensureDir(dir);
    const file = path.join(dir, safeId(name) + '.json');
    const payload = {
      schemaVersion: 1,
      name: name.trim(),
      pluginId,
      savedAt: new Date().toISOString(),
      state,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true, name: name.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-list', async (e, pluginId) => {
  try {
    const results = [];
    const scan = (dir, plugin) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          results.push({
            pluginId: plugin,
            fileId: f.replace(/\.json$/, ''),
            name: payload.name || f.replace(/\.json$/, ''),
            savedAt: payload.savedAt,
          });
        } catch (e) {}
      }
    };
    if (pluginId) {
      scan(path.join(projectsDir, safeId(pluginId)), pluginId);
    } else if (fs.existsSync(projectsDir)) {
      for (const sub of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (sub.isDirectory()) scan(path.join(projectsDir, sub.name), sub.name);
      }
    }
    results.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    return { ok: true, projects: results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-load', async (e, pluginId, fileId) => {
  try {
    const file = path.join(projectsDir, safeId(pluginId), safeId(fileId) + '.json');
    if (!fs.existsSync(file)) return { ok: false, error: 'Prosjektet finnes ikke' };
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { ok: true, name: payload.name, state: payload.state, savedAt: payload.savedAt };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('project-delete', async (e, pluginId, fileId) => {
  try {
    const file = path.join(projectsDir, safeId(pluginId), safeId(fileId) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
//  Video-export og thumbnail (ffmpeg)
// ============================================================

function findFfmpeg() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) {
      const unpackedPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedPath)) return unpackedPath;
      if (fs.existsSync(ffmpegStatic)) return ffmpegStatic;
    }
  } catch (e) {
    console.error('ffmpeg-static ikke tilgjengelig:', e.message);
  }
  return 'ffmpeg';
}

function checkFfmpeg() {
  return new Promise(resolve => {
    const proc = spawn(findFfmpeg(), ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', code => resolve(code === 0));
  });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return downloadToFile(response.headers.location, dest).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + response.statusCode + ' ved nedlasting av video'));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlinkSync(dest); reject(err); });
    }).on('error', err => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const downloadCache = new Map();

async function ensureDownloaded(url) {
  if (downloadCache.has(url)) {
    const cached = downloadCache.get(url);
    if (fs.existsSync(cached)) return cached;
    downloadCache.delete(url);
  }
  const filepath = path.join(app.getPath('temp'), 'fs-cache-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4');
  await downloadToFile(url, filepath);
  downloadCache.set(url, filepath);
  return filepath;
}

app.on('before-quit', () => {
  for (const filepath of downloadCache.values()) {
    try { fs.unlinkSync(filepath); } catch (e) {}
  }
});

ipcMain.handle('video-export', async (e, opts) => {
  const { url, trimStart, trimEnd, savePath, quality } = opts || {};
  if (!url || typeof trimStart !== 'number' || typeof trimEnd !== 'number' || !savePath) {
    return { ok: false, error: 'Mangler url, trimStart, trimEnd eller savePath' };
  }

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return { ok: false, error: 'Klarte ikke finne ffmpeg. Prøv å starte appen på nytt.' };
  }

  const send = msg => {
    try { mainWindow && mainWindow.webContents.send('video-export-progress', msg); } catch (e) {}
  };

  let tmpInput;
  try {
    send({ phase: 'downloading', percent: 0 });
    tmpInput = await ensureDownloaded(url);
    send({ phase: 'downloading', percent: 100 });
  } catch (err) {
    return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
  }

  const qmap = {
    '1080': { maxHeight: 1080, crf: 22 },
    '720':  { maxHeight: 720,  crf: 23 },
    '480':  { maxHeight: 480,  crf: 25 },
  };
  const q = qmap[quality] || qmap['1080'];
  const duration = trimEnd - trimStart;

  const args = [
    '-ss', String(trimStart),
    '-i', tmpInput,
    '-t', String(duration),
    '-vf', `scale=-2:'min(${q.maxHeight},ih)'`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(q.crf),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    '-y',
    savePath,
  ];

  try {
    await new Promise((resolve, reject) => {
      send({ phase: 'encoding', percent: 0 });
      const ff = spawn(findFfmpeg(), args);
      let stderr = '';
      ff.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          const percent = Math.min(100, Math.round((t / duration) * 100));
          send({ phase: 'encoding', percent });
        }
      });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg feilet (kode ' + code + '). Siste output: ' + stderr.split('\n').slice(-3).join(' | ')));
      });
    });
    send({ phase: 'done', percent: 100 });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return { ok: true, savePath };
});

ipcMain.handle('generate-thumbnail', async (e, opts) => {
  const { url, atTime } = opts || {};
  if (!url || typeof atTime !== 'number') {
    return { ok: false, error: 'Mangler url eller atTime' };
  }
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) return { ok: false, error: 'ffmpeg ikke tilgjengelig' };

  let tmpInput;
  try {
    tmpInput = await ensureDownloaded(url);
  } catch (err) {
    return { ok: false, error: 'Kunne ikke laste ned video: ' + err.message };
  }

  const tmpOutput = path.join(app.getPath('temp'), 'fs-thumb-' + Date.now() + '.jpg');
  try {
    await new Promise((resolve, reject) => {
      const args = [
        '-ss', String(atTime),
        '-i', tmpInput,
        '-frames:v', '1',
        '-vf', 'scale=800:-2',
        '-q:v', '4',
        '-y',
        tmpOutput,
      ];
      const ff = spawn(findFfmpeg(), args);
      let stderr = '';
      ff.stderr.on('data', chunk => { stderr += chunk.toString(); });
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg feilet: ' + stderr.split('\n').slice(-2).join(' | ')));
      });
    });
    const bytes = fs.readFileSync(tmpOutput);
    const sizeKb = (bytes.length / 1024).toFixed(1);
    const dataUrl = 'data:image/jpeg;base64,' + bytes.toString('base64');
    try { fs.unlinkSync(tmpOutput); } catch (e) {}
    return { ok: true, dataUrl, sizeKb };
  } catch (err) {
    try { fs.unlinkSync(tmpOutput); } catch (e) {}
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('reveal-in-finder', async (e, filePath) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

ipcMain.handle('plugin-status', async () => {
  const installed = [
    ...scanPluginsDir(builtinPluginsDir, 'builtin'),
    ...scanPluginsDir(userPluginsDir, 'user'),
  ];
  const byId = new Map();
  for (const p of installed) {
    if (!byId.has(p.id) || p.source === 'user') byId.set(p.id, p);
  }
  return Array.from(byId.values()).map(p => ({
    id: p.id, name: p.name, version: p.version, source: p.source,
  }));
});

// ============================================================
//  Plugin-registry og auto-update
// ============================================================

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'FaktiskStudio/' + APP_VERSION } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetJson(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' fra ' + url));
      }
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

ipcMain.handle('registry-fetch', async (e, force) => {
  try {
    const now = Date.now();
    if (!force && fs.existsSync(registryCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(registryCacheFile, 'utf-8'));
        if (cache.cachedAt && now - cache.cachedAt < 30 * 60 * 1000) {
          return { ok: true, registry: cache.registry, fromCache: true };
        }
      } catch (e) {}
    }
    if (!REGISTRY_URL) return { ok: false, error: 'Ingen registry-URL konfigurert' };
    const registry = await httpGetJson(REGISTRY_URL);
    fs.writeFileSync(registryCacheFile, JSON.stringify({ cachedAt: now, registry }, null, 2), 'utf-8');
    return { ok: true, registry, fromCache: false };
  } catch (err) {
    if (fs.existsSync(registryCacheFile)) {
      try {
        const cache = JSON.parse(fs.readFileSync(registryCacheFile, 'utf-8'));
        return { ok: true, registry: cache.registry, fromCache: true, stale: true, fetchError: err.message };
      } catch (e) {}
    }
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plugin-install', async (e, pluginEntry) => {
  try {
    if (!pluginEntry || !pluginEntry.id || !pluginEntry.bundleUrl) {
      return { ok: false, error: 'Mangler plugin-id eller bundleUrl' };
    }
    if (pluginEntry.minStudioVersion && compareVersions(APP_VERSION, pluginEntry.minStudioVersion) < 0) {
      return { ok: false, error: 'Pluginen krever Faktisk Studio ' + pluginEntry.minStudioVersion + ' eller nyere — du har ' + APP_VERSION };
    }
    const bundle = await httpGetJson(pluginEntry.bundleUrl);
    if (!bundle || typeof bundle !== 'object') {
      return { ok: false, error: 'Bundle har ugyldig format' };
    }
    const safePluginId = safeId(pluginEntry.id);
    const installPath = path.join(userPluginsDir, safePluginId);
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }
    fs.mkdirSync(installPath, { recursive: true });
    for (const [filename, content] of Object.entries(bundle)) {
      if (typeof filename !== 'string' || !/^[a-zA-Z0-9._/\-]+$/.test(filename) || filename.includes('..')) {
        return { ok: false, error: 'Ugyldig filnavn i bundle: ' + filename };
      }
      const target = path.join(installPath, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(content), 'utf-8');
    }
    return { ok: true, installedAt: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('plugin-uninstall', async (e, pluginId) => {
  try {
    const installPath = path.join(userPluginsDir, safeId(pluginId));
    if (!fs.existsSync(installPath)) {
      return { ok: false, error: 'Pluginen er ikke installert (brukerversjon)' };
    }
    fs.rmSync(installPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app-version', async () => APP_VERSION);
