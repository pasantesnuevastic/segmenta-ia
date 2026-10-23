const fs = require('node:fs');
const path = require('node:path');

const PROVIDERS = ['gemini', 'openai'];

// Ajustes en disco. La llave de API se guarda cifrada (safeStorage de Electron, inyectado
// para poder probarlo) y nunca se devuelve al proceso de la interfaz: solo se informa si existe.
function createSettings({ dir, safeStorage }) {
  const file = path.join(dir, 'settings.json');

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

  function write(data) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  async function getStatus() {
    const data = read();
    return {
      provider: PROVIDERS.includes(data.provider) ? data.provider : 'gemini',
      hasKey: Boolean(data.keys && data.keys[data.provider]),
      encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    };
  }

  async function save({ provider, apiKey }) {
    if (!PROVIDERS.includes(provider)) throw new Error('Proveedor no válido');
    const data = read();
    data.provider = provider;
    if (apiKey) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        throw new Error('El cifrado del sistema no está disponible; la llave no se guardó');
      }
      data.keys = data.keys || {};
      data.keys[provider] = (await safeStorage.encryptStringAsync(apiKey)).toString('base64');
    }
    write(data);
    return getStatus();
  }

  // Solo para el proceso principal (planificador). Nunca exponer por IPC.
  async function getApiKey(provider) {
    const encrypted = read().keys?.[provider];
    if (!encrypted) return null;
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'));
    if (shouldReEncrypt) await save({ provider, apiKey: result });
    return result;
  }

  return { getStatus, save, getApiKey };
}

module.exports = { createSettings, PROVIDERS };
