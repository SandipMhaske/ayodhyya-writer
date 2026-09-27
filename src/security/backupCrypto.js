// Encrypted backups — AES-256-GCM with scrypt key derivation.
// CLI/desktop ONLY (node:crypto). Never imported by the browser app: the browser
// export path stays plaintext-JSON so it works fully offline with zero dependencies.
// Format: AYB1.<saltB64>.<ivB64>.<cipherB64>  (auth tag appended to ciphertext by GCM)
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const PREFIX = 'AYB1';

export function encryptBackup(plaintext, password) {
  if (!password || String(password).length < 8) throw new Error('Backup password must be at least 8 characters.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(String(password), salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return [PREFIX, salt.toString('base64'), iv.toString('base64'), enc.toString('base64')].join('.');
}

export function isEncryptedBackup(text) {
  return String(text || '').startsWith(PREFIX + '.');
}

export function decryptBackup(payload, password) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Not an Ayodhyya encrypted backup.');
  const [, saltB64, ivB64, encB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || enc.length < 17) throw new Error('Corrupt backup envelope.');
  const key = scryptSync(String(password || ''), salt, 32);
  try {
    const tag = enc.subarray(enc.length - 16);
    const data = enc.subarray(0, enc.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Decryption failed — wrong password or tampered file.');
  } finally {
    key.fill(0);
  }
}
