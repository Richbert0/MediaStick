'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isDesktop: true,

  // Infos
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPort: () => ipcRenderer.invoke('server-port'),
  getPlatform: () => ipcRenderer.invoke('app-platform'),
  getDataDir: () => ipcRenderer.invoke('data-dir'),
  getWindowState: () => ipcRenderer.invoke('window-state'),

  // Fenster
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  toggleFullscreen: () => ipcRenderer.send('window-fullscreen'),
  reloadWindow: () => ipcRenderer.send('window-reload'),

  // System
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openDataDir: (sub) => ipcRenderer.send('open-data-dir', sub || ''),

  // Dialoge
  showMessage: (opts) => ipcRenderer.invoke('show-message-box', opts),
  showOpen: (opts) => ipcRenderer.invoke('show-open-dialog', opts),

  onWindowState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_, state) => callback(state);
    ipcRenderer.on('window-state', handler);
    return () => ipcRenderer.removeListener('window-state', handler);
  },
});
