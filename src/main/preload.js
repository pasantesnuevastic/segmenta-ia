const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('segmenta', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setProvider: (provider) => ipcRenderer.invoke('settings:set-provider', provider),
  saveKey: (input) => ipcRenderer.invoke('settings:save-key', input),
  unlock: (passphrase) => ipcRenderer.invoke('settings:unlock', passphrase),
  deleteKey: () => ipcRenderer.invoke('settings:delete-key'),
  createPlan: (request) => ipcRenderer.invoke('plan:create', request),
});
