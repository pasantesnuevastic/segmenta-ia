const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettings, UserError } = require('../src/store/settings');
const vault = require('../src/store/vault');

const KEY = 'AIzaSyEjemploDeLlaveFalsa1234567890';
const GEOAPIFY_KEY = 'geoapify-demo-key-1234567890';
const PASS = 'contraseña-larga';
const FAST_KDF = { N: 1 << 10, r: 8, p: 1 }; // solo para que las pruebas sean rápidas

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'segmenta-'));
const open = (dir) => createSettings({ dir, kdf: FAST_KDF });
const onDisk = (dir) => {
  const file = path.join(dir, 'settings.json');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

test('sin contraseña: la llave solo vive en memoria y no se escribe en el disco', async () => {
  const dir = tmp();
  const s = open(dir);
  assert.deepStrictEqual(await s.saveKey({ apiKey: KEY }), {
    provider: 'gemini',
    hasKey: true,
    hasStoredKey: false,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: false,
  });
  assert.strictEqual(s.getApiKey('gemini'), KEY);
  assert.ok(!onDisk(dir).includes(KEY));

  const reopened = open(dir); // «cerrar y abrir la app»
  assert.strictEqual(reopened.getStatus().hasKey, false);
  assert.strictEqual(reopened.getApiKey('gemini'), null);
});

test('con contraseña: se guarda cifrada, queda bloqueada al reabrir y se desbloquea', async () => {
  const dir = tmp();
  await open(dir).saveKey({ apiKey: KEY, passphrase: PASS });
  const disk = onDisk(dir);
  assert.ok(!disk.includes(KEY) && !disk.includes(PASS));

  const reopened = open(dir);
  assert.deepStrictEqual(reopened.getStatus(), {
    provider: 'gemini',
    hasKey: false,
    hasStoredKey: true,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: false,
  });
  assert.strictEqual(reopened.getApiKey('gemini'), null);

  await assert.rejects(reopened.unlock('contraseña-errada'), { message: 'Contraseña incorrecta.' });
  assert.strictEqual(reopened.getApiKey('gemini'), null);

  assert.deepStrictEqual(await reopened.unlock(PASS), {
    provider: 'gemini',
    hasKey: true,
    hasStoredKey: true,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: false,
  });
  assert.strictEqual(reopened.getApiKey('gemini'), KEY);
});

test('usa por defecto parámetros fuertes de scrypt y los guarda con el registro', async () => {
  const dir = tmp();
  await createSettings({ dir }).saveKey({ apiKey: KEY, passphrase: PASS });
  const record = JSON.parse(onDisk(dir)).keys.gemini;
  assert.deepStrictEqual(record.kdf, { name: 'scrypt', ...vault.DEFAULT_KDF });
  assert.ok(record.kdf.N >= 1 << 15);
});

test('limpia espacios y saltos de línea al pegar, y rechaza llaves mal formadas', async () => {
  const s = open(tmp());
  await s.saveKey({ apiKey: `  ${KEY}\r\n` });
  assert.strictEqual(s.getApiKey('gemini'), KEY);

  for (const bad of ['', 'corta', 'tiene espacios en medio 1234', 'ñandú-con-tilde-1234', 'x'.repeat(301), null, 42]) {
    await assert.rejects(s.saveKey({ apiKey: bad }), UserError, `debía rechazar ${String(bad).slice(0, 20)}`);
  }
});

test('rechaza una contraseña corta y no guarda nada', async () => {
  const dir = tmp();
  const s = open(dir);
  await assert.rejects(s.saveKey({ apiKey: KEY, passphrase: 'corta' }), UserError);
  assert.strictEqual(s.getStatus().hasKey, false);
  assert.strictEqual(onDisk(dir), '');
});

test('borrar la llave la quita de la memoria y del disco', async () => {
  const dir = tmp();
  const s = open(dir);
  await s.saveKey({ apiKey: KEY, passphrase: PASS });
  assert.deepStrictEqual(s.deleteKey(), {
    provider: 'gemini',
    hasKey: false,
    hasStoredKey: false,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: false,
  });
  assert.ok(!onDisk(dir).includes('"data"'));
  assert.strictEqual(open(dir).getStatus().hasStoredKey, false);
});

test('cada proveedor tiene su propia llave y solo se aceptan proveedores conocidos', async () => {
  const s = open(tmp());
  await s.saveKey({ apiKey: KEY });
  assert.strictEqual(s.setProvider('openai').hasKey, false);
  await s.saveKey({ apiKey: 'sk-ejemplo-falso-1234567890' });
  assert.strictEqual(s.getApiKey('gemini'), KEY);
  assert.strictEqual(s.getApiKey('openai'), 'sk-ejemplo-falso-1234567890');
  assert.throws(() => s.setProvider('otro'), UserError);
});

test('la llave Geoapify se guarda separada de la llave de IA y puede bloquearse y desbloquearse', async () => {
  const dir = tmp();
  const settings = open(dir);
  await settings.saveKey({ apiKey: KEY });
  await settings.saveSearchKey({ apiKey: GEOAPIFY_KEY, passphrase: PASS });

  assert.strictEqual(settings.getApiKey('gemini'), KEY);
  assert.strictEqual(settings.getApiKey('geoapify'), GEOAPIFY_KEY);
  const disk = onDisk(dir);
  assert.ok(!disk.includes(KEY) && !disk.includes(GEOAPIFY_KEY) && !disk.includes(PASS));

  const reopened = open(dir);
  assert.deepStrictEqual(reopened.getStatus(), {
    provider: 'gemini',
    hasKey: false,
    hasStoredKey: false,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: true,
  });
  await reopened.unlockSearchKey(PASS);
  assert.strictEqual(reopened.getApiKey('geoapify'), GEOAPIFY_KEY);
  assert.deepStrictEqual(reopened.deleteSearchKey(), {
    provider: 'gemini',
    hasKey: false,
    hasStoredKey: false,
    searchProvider: 'geoapify',
    hasSearchKey: false,
    hasStoredSearchKey: false,
  });
  assert.strictEqual(reopened.getApiKey('gemini'), null);
});

test('el cifrado detecta que el archivo fue alterado', async () => {
  const record = await vault.encrypt(KEY, PASS, FAST_KDF);
  assert.strictEqual(await vault.decrypt(record, PASS), KEY);
  const tampered = { ...record, data: Buffer.from('otra-cosa-distinta').toString('base64') };
  assert.strictEqual(await vault.decrypt(tampered, PASS), null);
  assert.strictEqual(await vault.decrypt({ garbage: true }, PASS), null);
});
