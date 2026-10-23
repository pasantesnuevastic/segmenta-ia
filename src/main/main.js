const path = require('node:path');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { createSettings } = require('../store/settings');
const { planRequest } = require('../core/planner');

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    title: 'Segmenta IA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  // La interfaz es local: no se abre ni se navega a ninguna otra dirección.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  const settings = createSettings({ dir: app.getPath('userData'), safeStorage });

  ipcMain.handle('settings:get', () => settings.getStatus());
  ipcMain.handle('settings:save', (_event, input) => settings.save(input));

  // La llave se lee y se usa solo aquí, en el proceso principal; la interfaz nunca la recibe.
  ipcMain.handle('plan:create', async (_event, request) => {
    const { provider } = await settings.getStatus();
    const apiKey = await settings.getApiKey(provider);
    return planRequest({ request, provider, apiKey });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
