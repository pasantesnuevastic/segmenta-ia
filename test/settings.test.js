const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettings } = require('../src/store/settings');

// Cifrado simulado: invierte el texto, solo para comprobar que no se guarda en claro.
const fakeSafeStorage = (available = true) => ({
  isAsyncEncryptionAvailable: async () => available,
  encryptStringAsync: async (s) => Buffer.from([...s].reverse().join('')),
  decryptStringAsync: async (b) => ({ result: [...b.toString()].reverse().join(''), shouldReEncrypt: false }),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'segmenta-'));

test('guarda la llave cifrada y no la expone en el estado', async () => {
  const dir = tmp();
  const s = createSettings({ dir, safeStorage: fakeSafeStorage() });
  const status = await s.save({ provider: 'openai', apiKey: 'sk-secreta' });

  assert.deepStrictEqual(status, { provider: 'openai', hasKey: true, encryptionAvailable: true });
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('sk-secreta'));
  assert.strictEqual(await s.getApiKey('openai'), 'sk-secreta');
});

test('rechaza proveedores desconocidos', async () => {
  const s = createSettings({ dir: tmp(), safeStorage: fakeSafeStorage() });
  await assert.rejects(s.save({ provider: 'otro', apiKey: 'x' }));
});

test('no guarda la llave si el cifrado no está disponible', async () => {
  const s = createSettings({ dir: tmp(), safeStorage: fakeSafeStorage(false) });
  await assert.rejects(s.save({ provider: 'gemini', apiKey: 'AIza-secreta' }));
  assert.strictEqual((await s.getStatus()).hasKey, false);
});

test('sin archivo previo usa Gemini y sin llave', async () => {
  const s = createSettings({ dir: tmp(), safeStorage: fakeSafeStorage() });
  assert.deepStrictEqual(await s.getStatus(), { provider: 'gemini', hasKey: false, encryptionAvailable: true });
});
