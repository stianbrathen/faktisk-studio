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

  projectSave: (pluginId, name, state) => ipcRenderer.invoke('project-save', pluginId, name, state),
  projectList: (pluginId) => ipcRenderer.invoke('project-list', pluginId),
  projectLoad: (pluginId, fileId) => ipcRenderer.invoke('project-load', pluginId, fileId),
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
  generateThumbnail: (opts) => ipcRenderer.invoke('generate-thumbnail', opts),
});
