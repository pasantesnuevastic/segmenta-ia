const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('segmenta', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  createPlan: (request) => ipcRenderer.invoke('plan:create', request),
});
