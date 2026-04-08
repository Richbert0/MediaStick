'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  isDesktop:    true,

  // Versioninfo
  getVersion:   () => ipcRenderer.invoke('app-version'),
  getPort:      () => ipcRenderer.invoke('server-port'),
  getPlatform:  () => ipcRenderer.invoke('app-platform'),
  getWindowState: () => ipcRenderer.invoke('window-state'),

  // Fensterkontrolle
  minimize:     () => ipcRenderer.send('window-minimize'),
  maximize:     () => ipcRenderer.send('window-maximize'),
  close:        () => ipcRenderer.send('window-close'),
  toggleFullscreen: () => ipcRenderer.send('window-fullscreen'),
  reloadWindow: () => ipcRenderer.send('window-reload'),

  // Externer Browser
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Dialoge
  showMessage:  (opts) => ipcRenderer.invoke('show-message-box', opts),
  showOpen:     (opts) => ipcRenderer.invoke('show-open-dialog', opts),

  onWindowState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_, state) => callback(state);
    ipcRenderer.on('window-state', handler);
    return () => ipcRenderer.removeListener('window-state', handler);
  },
});
