import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let SQLiteStore;
try {
  ({ SQLiteStore } = await import('../src/storage/sqliteStore.js'));
} catch { /* node:sqlite unavailable — tests below fail loudly instead of silently skipping */ }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-db-'));
const dbPath = path.join(dir, 'test.db');

describe('sqlite store', () => {
  let db;
  before(async () => { db = new SQLiteStore(dbPath); await db.open(); });
  after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('put/get round-trips content', async () => {
    await db.put('articles', { id: 'a1', title: 'Hello', updatedAt: new Date().toISOString() });
    assert.equal((await db.get('articles', 'a1')).title, 'Hello');
    assert.equal(await db.get('articles', 'missing'), null);
  });
  it('upserts, lists, queries, counts', async () => {
    await db.put('articles', { id: 'a1', title: 'Hello v2', status: 'Draft', updatedAt: new Date().toISOString() });
    await db.put('articles', { id: 'a2', title: 'World', status: 'Published', updatedAt: new Date().toISOString() });
    assert.equal((await db.get('articles', 'a1')).title, 'Hello v2');
    assert.equal(await db.count('articles'), 2);
    assert.equal((await db.query('articles', (a) => a.status === 'Published')).length, 1);
  });
  it('read-only SQL works, writes rejected', async () => {
    const rows = await db.sqlReadOnly("SELECT id FROM articles ORDER BY id");
    assert.deepEqual(rows.map((r) => r.id).sort(), ['a1', 'a2']);
    await assert.rejects(() => db.sqlReadOnly('DELETE FROM articles'));
  });
  it('remove/clear work', async () => {
    await db.remove('articles', 'a2');
    assert.equal(await db.count('articles'), 1);
    await db.clear('articles');
    assert.equal(await db.count('articles'), 0);
  });
  it('AYODHYYA_DB redirects the database file (test isolation)', async () => {
    const { openDatabase } = await import('../tools/lib.mjs');
    const alt = path.join(dir, 'alt.db');
    process.env.AYODHYYA_DB = alt;
    try {
      const altDb = await openDatabase();
      assert.ok(fs.existsSync(alt), 'override path created');
      assert.ok((await altDb.all('sites')).length > 0, 'override DB seeded from seed data');
      altDb.close();
    } finally {
      delete process.env.AYODHYYA_DB;
    }
  });
});
