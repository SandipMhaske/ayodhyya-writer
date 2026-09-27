import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../src/security/backupCrypto.js';

describe('encrypted backups', () => {
  it('round-trips through AES-256-GCM', () => {
    const plain = JSON.stringify({ app: 'ayodhyya-writer', data: { articles: [{ id: 'a1' }] } });
    const enc = encryptBackup(plain, 'correct-horse-123');
    assert.ok(isEncryptedBackup(enc));
    assert.ok(!enc.includes('ayodhyya-writer'), 'no plaintext leaks into envelope');
    assert.equal(decryptBackup(enc, 'correct-horse-123'), plain);
  });
  it('two encryptions differ (random salt/iv)', () => {
    assert.notEqual(encryptBackup('x'.repeat(64), 'password-123'), encryptBackup('x'.repeat(64), 'password-123'));
  });
  it('wrong password, tampering, and bad input fail cleanly', () => {
    const enc = encryptBackup('secret-data-here-12345', 'password-123');
    assert.throws(() => decryptBackup(enc, 'wrong-password'), /wrong password or tampered/);
    const tampered = enc.slice(0, -4) + 'AAAA';
    assert.throws(() => decryptBackup(tampered, 'password-123'), /wrong password or tampered/);
    assert.throws(() => decryptBackup('{"plain":"json"}', 'password-123'), /Not an Ayodhyya/);
    assert.throws(() => encryptBackup('x', 'short'), /at least 8 characters/);
    assert.ok(!isEncryptedBackup('{"plain":"json"}'));
  });
});
