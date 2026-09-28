import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackupBrowser, decryptBackupBrowser, isEncryptedBackupBrowser } from '../src/security/backupCryptoBrowser.js';

describe('browser encrypted backups (AYB2)', () => {
  it('round-trips through PBKDF2/AES-GCM', async () => {
    const plain = JSON.stringify({ app: 'ayodhyya-writer', data: { sites: [{ id: 's1' }] } });
    const enc = await encryptBackupBrowser(plain, 'correct-horse-123');
    assert.ok(isEncryptedBackupBrowser(enc));
    assert.ok(!enc.includes('ayodhyya-writer'), 'no plaintext leaks');
    assert.equal(await decryptBackupBrowser(enc, 'correct-horse-123'), plain);
  });
  it('rejects wrong password, foreign envelopes, short passwords', async () => {
    const enc = await encryptBackupBrowser('payload-data-here-123456', 'password-123');
    await assert.rejects(decryptBackupBrowser(enc, 'wrong-password'), /wrong password or tampered/);
    await assert.rejects(decryptBackupBrowser('AYB1.salt.iv.ct', 'password-123'), /Not an Ayodhyya browser backup/);
    await assert.rejects(decryptBackupBrowser('{"plain":1}', 'password-123'), /Not an Ayodhyya browser backup/);
    await assert.rejects(encryptBackupBrowser('x', 'short'), /at least 8 characters/);
    assert.ok(!isEncryptedBackupBrowser('{"plain":1}'));
  });
});
