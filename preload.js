// Faktisk Studio — preload bridge
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('faktisk', {
  listPlugins: () => ipcRenderer.invoke('list-plugins'),
  openPlugin: (id) => ipcRenderer.invoke('open-plugin', id),
  goHome: () => ipcRenderer.invoke('go-home'),

  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  saveDialog: (opts) => ipcRenderer.invoke('save-dialog', opts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

  stateSave: (pluginId, state) => ipcRenderer.invoke('state-save', pluginId, state),
  stateLoad: (pluginId) => ipcRenderer.invoke('state-load', pluginId),
  stateClear: (pluginId) => ipcRenderer.invoke('state-clear', pluginId),

  // Dokumenter på disk (.faktisk). documentInfo() gir null uten åpent dokument,
  // ellers { path, name, pluginId, folder, mediaDir, exportDir }.
  documentInfo: () => ipcRenderer.invoke('document-info'),
  documentImportMedia: (filePaths) => ipcRenderer.invoke('document-import-media', filePaths),
  documentSave: () => ipcRenderer.invoke('document-save'),
  documentSaveAs: () => ipcRenderer.invoke('document-save-as'),
  documentOpen: (filePath) => ipcRenderer.invoke('document-open', filePath),
  documentRecent: () => ipcRenderer.invoke('document-recent'),
  documentsExportAll: () => ipcRenderer.invoke('documents-export-all'),

  projectSave: (pluginId, name, state) => ipcRenderer.invoke('project-save', pluginId, name, state),
  projectList: (pluginId) => ipcRenderer.invoke('project-list', pluginId),
  projectLoad: (pluginId, fileId) => ipcRenderer.invoke('project-load', pluginId, fileId),
  projectExport: (pluginId, fileId) => ipcRenderer.invoke('project-export', pluginId, fileId),
  projectImport: () => ipcRenderer.invoke('project-import'),
  projectDelete: (pluginId, fileId) => ipcRenderer.invoke('project-delete', pluginId, fileId),

  registryFetch: (force) => ipcRenderer.invoke('registry-fetch', force),
  pluginStatus: () => ipcRenderer.invoke('plugin-status'),
  pluginInstall: (entry) => ipcRenderer.invoke('plugin-install', entry),
  pluginUninstall: (pluginId) => ipcRenderer.invoke('plugin-uninstall', pluginId),
  appVersion: () => ipcRenderer.invoke('app-version'),

  videoExport: (opts) => ipcRenderer.invoke('video-export', opts),
  onVideoProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('video-export-progress', listener);
    return () => ipcRenderer.removeListener('video-export-progress', listener);
  },
  revealInFinder: (filePath) => ipcRenderer.invoke('reveal-in-finder', filePath),
  // Video av en HTML-embed (Chatbobler): MP4, ProRes 4444 eller HEVC med alfa
  domVideoExport: (opts) => ipcRenderer.invoke('dom-video-export', opts),
  domVideoExportCancel: () => ipcRenderer.invoke('dom-video-export-cancel'),
  onDomVideoProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('dom-video-export-progress', listener);
    return () => ipcRenderer.removeListener('dom-video-export-progress', listener);
  },
  censorExport: (opts) => ipcRenderer.invoke('censor-export', opts),
  censorTrack: (opts) => ipcRenderer.invoke('censor-track', opts),
  onCensorTrackProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('censor-track-progress', listener);
    return () => ipcRenderer.removeListener('censor-track-progress', listener);
  },
  onCensorProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('censor-export-progress', listener);
    return () => ipcRenderer.removeListener('censor-export-progress', listener);
  },
  generateThumbnail: (opts) => ipcRenderer.invoke('generate-thumbnail', opts),

  // Velg en fil fra maskinen uten å laste den opp noe sted
  openFileDialog: (opts) => ipcRenderer.invoke('open-file-dialog', opts),
  // Skriv tekstfil til sti valgt via saveDialog (FCPXML/SRT-eksport)
  writeTextFile: (opts) => ipcRenderer.invoke('write-text-file', opts),

  // Teksting: lokal transkribering med NB-Whisper
  transcribe: (opts) => ipcRenderer.invoke('transcribe', opts),
  transcribeStatus: () => ipcRenderer.invoke('transcribe-status'),
  transcribeResetModel: (modelId) => ipcRenderer.invoke('transcribe-reset-model', modelId),
  onTranscribeProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('transcribe-progress', listener);
    return () => ipcRenderer.removeListener('transcribe-progress', listener);
  },

  // Klippsetter: trim og slå sammen flere klipp
  sequenceExport: (opts) => ipcRenderer.invoke('sequence-export', opts),
  onSequenceProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('sequence-export-progress', listener);
    return () => ipcRenderer.removeListener('sequence-export-progress', listener);
  },

  // Teksting: brenn tekstboksene inn i videoen (MP4)
  captionBurnExport: (opts) => ipcRenderer.invoke('caption-burn-export', opts),
  onCaptionBurnProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('caption-burn-progress', listener);
    return () => ipcRenderer.removeListener('caption-burn-progress', listener);
  },

  // Keynote-klipp: video med runde hjørner og alfakanal
  keynoteExport: (opts) => ipcRenderer.invoke('keynote-export', opts),
  onKeynoteProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('keynote-export-progress', listener);
    return () => ipcRenderer.removeListener('keynote-export-progress', listener);
  },

  // Labrador-integrasjon
  openLabrador: (url) => ipcRenderer.invoke('open-labrador', url),
  labradorStatus: () => ipcRenderer.invoke('labrador-status'),
  labradorConnect: () => ipcRenderer.invoke('labrador-connect'),
  labradorListFiles: () => ipcRenderer.invoke('labrador-list-files'),
  labradorUpload: (opts) => ipcRenderer.invoke('labrador-upload', opts),
  labradorUploadData: (opts) => ipcRenderer.invoke('labrador-upload-data', opts),
  labradorThumbnail: (opts) => ipcRenderer.invoke('labrador-thumbnail', opts),
  onLabradorUploadProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('labrador-upload-progress', listener);
    return () => ipcRenderer.removeListener('labrador-upload-progress', listener);
  },
  // Lokale AI-modeller (nedlastbare, kjøres offline)
  aiModelStatus: (id) => ipcRenderer.invoke('ai-model-status', id),
  aiModelEnsure: (id) => ipcRenderer.invoke('ai-model-ensure', id),

  recentFileAdd: (entry) => ipcRenderer.invoke('recent-file-add', entry),
  recentFileList: (opts) => ipcRenderer.invoke('recent-file-list', opts),
  recentFileRemove: (url) => ipcRenderer.invoke('recent-file-remove', url),
  recentFileClear: () => ipcRenderer.invoke('recent-file-clear'),

  // Skjermarkiv: skann mappe, analyser (nøkkelbilder + OCR), lagre arkiver
  skjermarkivScan: (opts) => ipcRenderer.invoke('skjermarkiv-scan', opts),
  skjermarkivAnalyze: (opts) => ipcRenderer.invoke('skjermarkiv-analyze', opts),
  skjermarkivOcrCheck: () => ipcRenderer.invoke('skjermarkiv-ocr-check'),
  skjermarkivPreview: (opts) => ipcRenderer.invoke('skjermarkiv-preview', opts),
  skjermarkivArchiveSave: (opts) => ipcRenderer.invoke('skjermarkiv-archive-save', opts),
  skjermarkivArchiveList: () => ipcRenderer.invoke('skjermarkiv-archive-list'),
  skjermarkivArchiveLoad: (opts) => ipcRenderer.invoke('skjermarkiv-archive-load', opts),
  skjermarkivArchiveDelete: (opts) => ipcRenderer.invoke('skjermarkiv-archive-delete', opts),
  skjermarkivReadJson: (opts) => ipcRenderer.invoke('skjermarkiv-read-json', opts),

  // Bevissikring: sikre nettsider og SoMe-innlegg (src/bevis-main.js)
  bevisDefaultRoot: () => ipcRenderer.invoke('bevis-default-root'),
  bevisOpen: (opts) => ipcRenderer.invoke('bevis-open', opts),
  bevisWindowState: () => ipcRenderer.invoke('bevis-window-state'),
  bevisFocus: () => ipcRenderer.invoke('bevis-focus'),
  bevisCapture: (opts) => ipcRenderer.invoke('bevis-capture', opts),
  bevisCaptureRegion: (opts) => ipcRenderer.invoke('bevis-capture-region', opts),
  bevisList: (opts) => ipcRenderer.invoke('bevis-list', opts),
  bevisVerify: (opts) => ipcRenderer.invoke('bevis-verify', opts),
  bevisOpenPath: (opts) => ipcRenderer.invoke('bevis-open-path', opts),
  bevisToolStatus: () => ipcRenderer.invoke('bevis-tool-status'),
  bevisUpdateTools: () => ipcRenderer.invoke('bevis-update-tools'),
  bevisLogout: () => ipcRenderer.invoke('bevis-logout'),
  bevisDownload: (opts) => ipcRenderer.invoke('bevis-download', opts),
  bevisLinkStatus: () => ipcRenderer.invoke('bevis-link-status'),
  bevisSettingsGet: () => ipcRenderer.invoke('bevis-settings-get'),
  bevisView: (opts) => ipcRenderer.invoke('bevis-view', opts),
  bevisDelete: (opts) => ipcRenderer.invoke('bevis-delete', opts),
  bevisImport: (opts) => ipcRenderer.invoke('bevis-import', opts),
  bevisIndexBuild: (opts) => ipcRenderer.invoke('bevis-index-build', opts),
  bevisIndexSpeech: (opts) => ipcRenderer.invoke('bevis-index-speech', opts),
  bevisIndexStatus: (opts) => ipcRenderer.invoke('bevis-index-status', opts),
  bevisSearch: (opts) => ipcRenderer.invoke('bevis-search', opts),
  // Sti til en fil som er sluppet inn i vinduet (File.path finnes ikke lenger)
  bevisPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  bevisSettingsSet: (opts) => ipcRenderer.invoke('bevis-settings-set', opts),
  bevisPathInfo: (opts) => ipcRenderer.invoke('bevis-path-info', opts),
  bevisVaultCreate: (opts) => ipcRenderer.invoke('bevis-vault-create', opts),
  bevisVaultOpen: (opts) => ipcRenderer.invoke('bevis-vault-open', opts),
  bevisVaultClose: () => ipcRenderer.invoke('bevis-vault-close'),
  bevisStamp: (opts) => ipcRenderer.invoke('bevis-stamp', opts),
  bevisStories: (opts) => ipcRenderer.invoke('bevis-stories', opts),
  bevisWatchList: () => ipcRenderer.invoke('bevis-watch-list'),
  bevisWatchAdd: (opts) => ipcRenderer.invoke('bevis-watch-add', opts),
  bevisWatchRemove: (opts) => ipcRenderer.invoke('bevis-watch-remove', opts),
  bevisWatchCheck: (opts) => ipcRenderer.invoke('bevis-watch-check', opts),
  onBevisWatchChanged: (cb) => {
    const h = (e, d) => cb(d);
    ipcRenderer.on('bevis-watch-changed', h);
    return () => ipcRenderer.removeListener('bevis-watch-changed', h);
  },
  bevisProfileScan: (opts) => ipcRenderer.invoke('bevis-profile-scan', opts),
  bevisProfileStop: () => ipcRenderer.invoke('bevis-profile-stop'),
  bevisProfileSave: (opts) => ipcRenderer.invoke('bevis-profile-save', opts),
  bevisProfileLists: (opts) => ipcRenderer.invoke('bevis-profile-lists', opts),
  bevisProfileResult: (opts) => ipcRenderer.invoke('bevis-profile-result', opts),
  bevisProfileUrls: (opts) => ipcRenderer.invoke('bevis-profile-urls', opts),
  bevisExpand: (opts) => ipcRenderer.invoke('bevis-expand', opts),
  onBevisProfileProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-profile-progress', listener);
    return () => ipcRenderer.removeListener('bevis-profile-progress', listener);
  },
  bevisLinkConfig: (opts) => ipcRenderer.invoke('bevis-link-config', opts),
  bevisLinkNewToken: () => ipcRenderer.invoke('bevis-link-new-token'),
  bevisLinkExtension: () => ipcRenderer.invoke('bevis-link-extension'),
  onBevisJobs: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-jobs', listener);
    return () => ipcRenderer.removeListener('bevis-jobs', listener);
  },
  onBevisLibraryChanged: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-library-changed', listener);
    return () => ipcRenderer.removeListener('bevis-library-changed', listener);
  },
  onBevisLinkChanged: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-link-changed', listener);
    return () => ipcRenderer.removeListener('bevis-link-changed', listener);
  },
  bevisPlanCreate: (opts) => ipcRenderer.invoke('bevis-plan-create', opts),
  bevisPlanList: (opts) => ipcRenderer.invoke('bevis-plan-list', opts),
  bevisPlanResult: (opts) => ipcRenderer.invoke('bevis-plan-result', opts),
  bevisYoutubeList: (opts) => ipcRenderer.invoke('bevis-youtube-list', opts),
  bevisYoutubeDate: (opts) => ipcRenderer.invoke('bevis-youtube-date', opts),
  bevisParseAccount: (opts) => ipcRenderer.invoke('bevis-parse-account', opts),
  onBevisProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-progress', listener);
    return () => ipcRenderer.removeListener('bevis-progress', listener);
  },
  onBevisWindow: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('bevis-window', listener);
    return () => ipcRenderer.removeListener('bevis-window', listener);
  },

  // TikTok-henting for Videoslider (Studio 0.7.13) — se src/tiktok-main.js
  tiktokList: (opts) => ipcRenderer.invoke('tiktok-list', opts),
  tiktokImport: (opts) => ipcRenderer.invoke('tiktok-import', opts),
  onTiktokProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('tiktok-progress', listener);
    return () => ipcRenderer.removeListener('tiktok-progress', listener);
  },

  // Auto-updater (electron-updater)
  updaterGetState: () => ipcRenderer.invoke('updater-get-state'),
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('updater-quit-and-install'),
  onUpdaterState: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('updater-state', listener);
    return () => ipcRenderer.removeListener('updater-state', listener);
  },
});

// ============================================================
//  Dokumentlinje i pluginene
// ============================================================
// De fleste pluginene har «Velg lagret prosjekt…» og «Lagre…» nederst i
// venstrespalten (#projectSelect og #saveProjectBtn). Her byttes de ut med
// Åpne… og Lagre som bruker dokumenter i Finder (.faktisk), uten at hver
// plugin må endres. De gamle elementene erstattes med nye noder, så pluginens
// egne lyttere på dem slutter å virke.
window.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('projectSelect');
  const btn = document.getElementById('saveProjectBtn');
  if (!sel || !btn) return;

  const name = document.createElement('div');
  name.className = 'fk-doc-name';
  Object.assign(name.style, { font: '600 12px/1.3 -apple-system, sans-serif', opacity: '0.85',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' });

  const openBtn = document.createElement('button');
  openBtn.type = 'button'; openBtn.className = btn.className; openBtn.textContent = 'Åpne…';
  openBtn.title = 'Åpne et dokument (⌘O)';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = btn.className; saveBtn.id = 'saveProjectBtn';
  saveBtn.title = 'Lagre som dokument i Finder (⌘S)';

  // To knapper per rad:  [Åpne…] [Lagre…]  /  [Vis i Finder] [Medier]
  // Andre rad vises bare når et dokument er lagret.
  const grid = () => { const r = document.createElement('div');
    Object.assign(r.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }); return r; };
  const row1 = grid(), row2 = grid();
  const revealBtn = document.createElement('button');
  revealBtn.type = 'button'; revealBtn.className = btn.className; revealBtn.textContent = 'Vis i Finder';
  revealBtn.addEventListener('click', () => ipcRenderer.invoke('document-reveal'));
  for (const b of [openBtn, saveBtn, revealBtn]) { b.style.width = '100%'; b.style.minWidth = '0'; }
  // Egen beholder, så oppsettet blir likt uansett hvordan pluginen har
  // stilt opp de gamle kontrollene (noen har dem på én rad, andre i kolonne)
  const wrap = document.createElement('div');
  wrap.className = 'fk-docbar';
  Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', boxSizing: 'border-box' });
  const host = sel.parentElement;
  if (host && host === btn.parentElement && host.children.length === 2) host.replaceWith(wrap);
  else { sel.replaceWith(wrap); btn.remove(); }
  wrap.append(name, row1, row2);
  row1.append(openBtn, saveBtn);
  row2.append(revealBtn);

  // ---- medieliste: hvilke filer dokumentet bruker, og hvor de ligger ----
  // Samme knappestil som Åpne… og Lagre… i pluginen
  const mediaBtn = document.createElement('button');
  mediaBtn.type = 'button'; mediaBtn.className = btn.className;
  mediaBtn.style.display = 'none';
  mediaBtn.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  Object.assign(panel.style, { display: 'none', flexDirection: 'column', gap: '8px', padding: '10px',
    borderRadius: '8px', background: 'rgba(0,0,0,0.12)', font: '400 12px/1.35 -apple-system, sans-serif' });
  mediaBtn.style.width = '100%'; mediaBtn.style.minWidth = '0';
  mediaBtn.style.whiteSpace = 'nowrap'; mediaBtn.style.overflow = 'hidden'; mediaBtn.style.textOverflow = 'ellipsis';
  row2.append(mediaBtn);
  wrap.append(panel);
  let open = false;
  mediaBtn.addEventListener('click', () => {
    open = !open; panel.style.display = open ? 'flex' : 'none';
    mediaBtn.setAttribute('aria-expanded', String(open)); if (open) loadMedia(); else setLabel();
  });
  let lastLabel = { n: 0, missing: 0 };
  function setLabel() {
    const { n, missing } = lastLabel;
    mediaBtn.textContent = (open ? '▾ ' : '▸ ') + 'Medier (' + n + ')' + (missing ? ' · ' + missing + ' !' : '');
    mediaBtn.title = missing ? missing + ' fil(er) mangler eller ligger ikke på maskinen' : 'Filene dokumentet bruker';
    mediaBtn.style.boxShadow = missing ? 'inset 0 0 0 2px #C8321E' : '';
  }

  const el = (tag, text, style) => { const d = document.createElement(tag); if (text != null) d.textContent = text; if (style) Object.assign(d.style, style); return d; };
  const small = (label, fn) => { const b = el('button', label, { all: 'unset', cursor: 'pointer', fontWeight: '600', textDecoration: 'underline', marginRight: '10px' }); b.type = 'button'; b.addEventListener('click', fn); return b; };

  async function loadMedia() {
    const res = await ipcRenderer.invoke('document-media-list');
    if (!res) { row2.style.display = 'none'; panel.style.display = 'none'; return; }
    row2.style.display = 'grid';
    // I lokale plugins (Keynote-klipp, Presentasjon) må alt ligge på maskinen
    const online = res.mode === 'lokal' ? res.files.filter(f => f.web).length : 0;
    const missing = res.files.filter(f => !f.exists).length + online;
    mediaBtn.style.display = '';
    lastLabel = { n: res.files.length, missing };
    setLabel();
    if (!open) return;
    panel.textContent = '';
    const lab = el('label', null, { display: 'flex', gap: '6px', alignItems: 'flex-start', cursor: 'pointer' });
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = res.copyMedia;
    cb.addEventListener('change', () => ipcRenderer.invoke('document-set-copy-media', cb.checked));
    lab.append(cb, el('span', 'Kopier mediefiler inn i prosjektmappa'));
    panel.append(lab);
    if (!res.files.length) panel.append(el('div', 'Dokumentet bruker ingen lokale filer.', { opacity: '0.7' }));
    for (const f of res.files) {
      const row = el('div', null, { display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '6px', borderTop: '1px solid rgba(0,0,0,0.12)' });
      const bad = !f.exists || (f.web && res.mode === 'lokal');
      row.append(el('div', f.name, { fontWeight: '600', wordBreak: 'break-all', color: bad ? '#C8321E' : '' }));
      row.append(el('div', f.web ? (res.mode === 'lokal' ? 'Ligger på nett (' + f.where + '), ikke på maskinen' : 'Labrador · ' + f.where)
        : !f.exists ? 'Mangler · ' + f.where : f.inside ? 'Kopiert inn · Medier/' : 'Lenket · ' + f.where,
        { opacity: '0.75', wordBreak: 'break-all' }));
      row.title = f.path;
      const acts = el('div');
      if (f.web) { row.append(acts); panel.append(row); continue; }
      if (f.exists) acts.append(small('Vis i Finder', () => ipcRenderer.invoke('document-media-reveal', f.path)));
      if (f.exists && !f.inside) acts.append(small('Kopier inn', () => ipcRenderer.invoke('document-media-copy', f.path)));
      if (!f.exists) acts.append(small('Finn fila…', () => ipcRenderer.invoke('document-media-relink', f.path)));
      row.append(acts);
      panel.append(row);
    }
  }
  ipcRenderer.on('document-media-changed', () => loadMedia());

  const render = (info) => {
    if (info) {
      name.textContent = info.name;
      name.title = info.path;
      // Lagres automatisk etter første gang, så knappen blir «Lagre som…»
      saveBtn.textContent = 'Lagre som…';
      saveBtn.title = 'Lagre en kopi et annet sted (⇧⌘S). Endringer lagres automatisk.';
      revealBtn.title = info.path;
      row2.style.display = 'grid';
    } else {
      name.textContent = 'Ikke lagret';
      name.title = '';
      saveBtn.textContent = 'Lagre…';
      saveBtn.title = 'Lagre som dokument i Finder (⌘S)';
      row2.style.display = 'none';
    }
  };

  openBtn.addEventListener('click', () => ipcRenderer.invoke('document-open'));
  saveBtn.addEventListener('click', () => ipcRenderer.invoke('document-save-as'));
  ipcRenderer.on('document-changed', (_e, info) => { render(info); loadMedia(); });
  ipcRenderer.invoke('document-info').then((info) => { render(info); loadMedia(); });
});
