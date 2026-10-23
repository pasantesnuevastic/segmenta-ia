const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createSettings, UserError } = require('../store/settings');
const { planRequest } = require('../core/planner');

const RENDERER_DIR = path.join(__dirname, '../renderer');
const RENDERER_URL = pathToFileURL(RENDERER_DIR + path.sep).href;

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
  win.loadFile(path.join(RENDERER_DIR, 'index.html'));
}

// Solo se atienden mensajes que vienen de nuestra propia ventana local.
const isTrusted = (event) => Boolean(event.senderFrame?.url.startsWith(RENDERER_URL));

// Respuesta uniforme { ok, ... }. Los errores propios se muestran tal cual; los demás, con un mensaje genérico.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, arg) => {
    if (!isTrusted(event)) return { ok: false, message: 'Origen no permitido.' };
    try {
      return await fn(arg);
    } catch (err) {
      return { ok: false, message: err instanceof UserError ? err.message : 'Ocurrió un error inesperado.' };
    }
  });
}

app.whenReady().then(() => {
  const settings = createSettings({ dir: app.getPath('userData') });
  const withStatus = (status) => ({ ok: true, status });

  handle('settings:get', () => withStatus(settings.getStatus()));
  handle('settings:set-provider', (provider) => withStatus(settings.setProvider(provider)));
  handle('settings:save-key', async (input) => withStatus(await settings.saveKey(input ?? {})));
  handle('settings:unlock', async (passphrase) => withStatus(await settings.unlock(passphrase)));
  handle('settings:delete-key', () => withStatus(settings.deleteKey()));

  // La llave se lee y se usa solo aquí, en el proceso principal; la interfaz nunca la recibe.
  handle('plan:create', async (request) => {
    const { provider, hasStoredKey } = settings.getStatus();
    const apiKey = settings.getApiKey(provider);
    if (!apiKey && hasStoredKey) {
      return { ok: false, code: 'locked', message: 'La llave está guardada y bloqueada: desbloquéala con tu contraseña en Ajustes.' };
    }
    return planRequest({ request, provider, apiKey });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
