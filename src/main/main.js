const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createSettings, UserError } = require('../store/settings');
const { planRequest } = require('../core/planner');
const { createOsmProvider } = require('../core/osm');
const { runPlan } = require('../core/runner');
const { ALLOWED_COLUMNS, LIMITS } = require('../core/validator/contract');
const { CSV_COLUMNS, outputColumns, serializeCsv } = require('../core/results');

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
      return await fn(arg, event);
    } catch (err) {
      return { ok: false, message: err instanceof UserError ? err.message : 'Ocurrió un error inesperado.' };
    }
  });
}

app.whenReady().then(() => {
  const settings = createSettings({ dir: app.getPath('userData') });
  const osmProvider = createOsmProvider();
  let searchRunning = false;
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

  handle('search:run', async (plan, event) => {
    if (searchRunning) {
      return { ok: false, code: 'busy', message: 'Ya hay una búsqueda en curso. Espera a que termine antes de iniciar otra.' };
    }
    searchRunning = true;
    try {
      return await runPlan({
        plan,
        osmProvider,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('search:progress', progress);
        },
      });
    } finally {
      searchRunning = false;
    }
  });

  handle('results:export-csv', async (input, event) => {
    if (!input || !Array.isArray(input.columns) || !Array.isArray(input.rows)
      || input.columns.some((column) => !CSV_COLUMNS.includes(column))
      || input.rows.length > LIMITS.maxResults) {
      return { ok: false, code: 'bad_request', message: 'Los resultados no tienen un formato válido para exportar.' };
    }

    let csv;
    try {
      const selectedColumns = input.columns.filter((column) => ALLOWED_COLUMNS.includes(column));
      const columns = outputColumns(selectedColumns);
      if (JSON.stringify(columns) !== JSON.stringify(input.columns)) {
        return { ok: false, code: 'bad_request', message: 'El orden de las columnas de exportación no es válido.' };
      }
      csv = serializeCsv(input.rows, columns);
    } catch (error) {
      return { ok: false, code: 'bad_request', message: error.message };
    }
    const suggestedName = `segmenta-resultados-${new Date().toISOString().slice(0, 10)}.csv`;
    const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Guardar resultados como CSV',
      defaultPath: path.join(app.getPath('documents'), suggestedName),
      filters: [{ name: 'Archivo CSV', extensions: ['csv'] }],
    });
    if (choice.canceled || !choice.filePath) {
      return { ok: false, code: 'cancelled', message: 'Exportación cancelada.' };
    }
    try {
      await fs.writeFile(choice.filePath, csv, { encoding: 'utf8' });
    } catch (error) {
      return {
        ok: false,
        code: 'write_failed',
        message: `No se pudo guardar el CSV: ${error.message}`,
      };
    }
    return { ok: true, path: choice.filePath, rowCount: input.rows.length };
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
