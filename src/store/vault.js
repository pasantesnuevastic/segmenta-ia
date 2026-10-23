const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// Parámetros de scrypt (se guardan junto al texto cifrado, para poder subirlos más adelante).
const DEFAULT_KDF = { N: 1 << 16, r: 8, p: 1 };
const MAX_MEM = 256 * 1024 * 1024;

const deriveKey = (passphrase, salt, { N, r, p }) =>
  scrypt(passphrase, salt, 32, { N, r, p, maxmem: MAX_MEM });

// Cifra con una clave derivada de la contraseña (scrypt) y AES-256-GCM. Sin la contraseña
// no se puede descifrar, y GCM detecta cualquier alteración del archivo.
async function encrypt(plain, passphrase, kdf = DEFAULT_KDF) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', await deriveKey(passphrase, salt, kdf), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    v: 1,
    kdf: { name: 'scrypt', ...kdf },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

// Devuelve el texto, o null si la contraseña es incorrecta o el registro fue alterado.
async function decrypt(record, passphrase) {
  try {
    const { N, r, p } = record.kdf;
    const key = await deriveKey(passphrase, Buffer.from(record.salt, 'base64'), { N, r, p });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, DEFAULT_KDF };
