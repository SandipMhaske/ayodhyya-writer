// Browser backup encryption — WebCrypto PBKDF2-SHA256 + AES-GCM.
// Envelope AYB2.<saltB64>.<ivB64>.<cipherB64> (distinct from the CLI's scrypt-based
// AYB1: WebCrypto has no scrypt). Works fully offline; imports node:test-compatible
// WebCrypto (globalThis.crypto.subtle, present in browsers and Node 18+).
const PREFIX = 'AYB2';
const ITERATIONS = 210_000;

function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackupBrowser(plaintext, password) {
  if (!password || String(password).length < 8) throw new Error('Backup password must be at least 8 characters.');
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto unavailable in this browser.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), new TextEncoder().encode(String(plaintext))));
  return [PREFIX, b64encode(salt), b64encode(iv), b64encode(ct)].join('.');
}

export function isEncryptedBackupBrowser(text) {
  return String(text || '').startsWith(PREFIX + '.');
}

export async function decryptBackupBrowser(payload, password) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Not an Ayodhyya browser backup (AYB2).');
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto unavailable in this browser.');
  const [, saltB64, ivB64, ctB64] = parts;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(ivB64) }, await deriveKey(password, b64decode(saltB64)), b64decode(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Decryption failed — wrong password or tampered file.');
  }
}
