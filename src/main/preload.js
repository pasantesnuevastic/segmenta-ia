const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('segmenta', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setProvider: (provider) => ipcRenderer.invoke('settings:set-provider', provider),
  saveKey: (input) => ipcRenderer.invoke('settings:save-key', input),
  unlock: (passphrase) => ipcRenderer.invoke('settings:unlock', passphrase),
  deleteKey: () => ipcRenderer.invoke('settings:delete-key'),
  createPlan: (request) => ipcRenderer.invoke('plan:create', request),
  executePlan: (plan) => ipcRenderer.invoke('search:run', plan),
  exportCsv: (results) => ipcRenderer.invoke('results:export-csv', results),
  onSearchProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('search:progress', handler);
    return () => ipcRenderer.removeListener('search:progress', handler);
  },
});
