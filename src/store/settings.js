const fs = require('node:fs');
const path = require('node:path');
const vault = require('./vault');

const PROVIDERS = ['gemini', 'openai'];
const KEY_FORMAT = /^[\x21-\x7e]{8,300}$/; // ASCII visible, sin espacios
const MIN_PASSPHRASE = 8;

// Error con mensaje apto para mostrar a la persona usuaria.
class UserError extends Error {}

// Ajustes y llave de API. La llave tiene dos modos:
//  - solo esta sesión (por defecto): vive únicamente en memoria y se pierde al cerrar la app;
//  - guardada: en disco, cifrada con una contraseña que elige la persona (nunca se guarda).
// La interfaz nunca recibe la llave: solo se informa si está lista o bloqueada.
function createSettings({ dir, kdf = vault.DEFAULT_KDF }) {
  const file = path.join(dir, 'settings.json');
  const memory = {}; // proveedor → llave descifrada

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

  const currentProvider = (data) => (PROVIDERS.includes(data.provider) ? data.provider : 'gemini');

  function getStatus() {
    const data = read();
    const provider = currentProvider(data);
    return {
      provider,
      hasKey: Boolean(memory[provider]),
      hasStoredKey: Boolean(data.keys?.[provider]),
      searchProvider: 'geoapify',
      hasSearchKey: Boolean(memory.geoapify),
      hasStoredSearchKey: Boolean(data.keys?.geoapify),
    };
  }

  function setProvider(provider) {
    if (!PROVIDERS.includes(provider)) throw new UserError('Proveedor no válido.');
    write({ ...read(), provider });
    return getStatus();
  }

  async function saveKeyFor(keyName, { apiKey, passphrase }) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!KEY_FORMAT.test(key)) {
      throw new UserError('La llave no parece válida: debe tener entre 8 y 300 caracteres, sin espacios.');
    }
    const pass = typeof passphrase === 'string' ? passphrase : '';
    if (pass && pass.length < MIN_PASSPHRASE) {
      throw new UserError(`La contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.`);
    }

    const data = read();
    if (pass) {
      data.keys = { ...data.keys, [keyName]: await vault.encrypt(key, pass, kdf) };
      write(data);
    }
    memory[keyName] = key;
    return getStatus();
  }

  async function unlockKeyFor(keyName, passphrase) {
    const data = read();
    const record = data.keys?.[keyName];
    if (!record) throw new UserError('No hay una llave guardada para este proveedor.');
    const key = typeof passphrase === 'string' ? await vault.decrypt(record, passphrase) : null;
    if (!key) throw new UserError('Contraseña incorrecta.');
    memory[keyName] = key;
    return getStatus();
  }

  function deleteKeyFor(keyName) {
    const data = read();
    delete memory[keyName];
    if (data.keys) {
      delete data.keys[keyName];
      write(data);
    }
    return getStatus();
  }

  const saveKey = (input) => saveKeyFor(currentProvider(read()), input ?? {});
  const unlock = (passphrase) => unlockKeyFor(currentProvider(read()), passphrase);
  const deleteKey = () => deleteKeyFor(currentProvider(read()));
  const saveSearchKey = (input) => saveKeyFor('geoapify', input ?? {});
  const unlockSearchKey = (passphrase) => unlockKeyFor('geoapify', passphrase);
  const deleteSearchKey = () => deleteKeyFor('geoapify');

  // Solo para el proceso principal (planificador). Nunca exponer por IPC.
  function getApiKey(provider) {
    return memory[provider] ?? null;
  }

  return {
    getStatus,
    setProvider,
    saveKey,
    unlock,
    deleteKey,
    saveSearchKey,
    unlockSearchKey,
    deleteSearchKey,
    getApiKey,
  };
}

module.exports = { createSettings, UserError, PROVIDERS };
