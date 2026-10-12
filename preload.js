// Faktisk Studio — preload bridge
const { contextBridge, ipcRenderer } = require('electron');

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
