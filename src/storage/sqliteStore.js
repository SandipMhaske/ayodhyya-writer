// SQLiteStore — file-based local database for CLI/desktop use (data/ayodhyya.db).
// Same IContentRepository interface as MemoryStore/IndexedDBStore: put/get/all/remove/clear/query.
// Browser never loads this module (Node-only via node:sqlite); the browser uses IndexedDB.
// seed-data.json is only a first-run seed — the .db file is the source of truth afterwards.
import { COLLECTIONS } from './repository.js';
import fs from 'node:fs';
import path from 'node:path';

export class SQLiteStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    const { DatabaseSync } = await import('node:sqlite');
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    for (const c of COLLECTIONS) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS "${c}" (id TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt TEXT)`);
    }
    return this.db;
  }

  async put(col, item) {
    await this.open();
    if (!item || !item.id) throw new Error(`Cannot store item without id in ${col}.`);
    this.db
      .prepare(`INSERT INTO "${col}" (id, data, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`)
      .run(item.id, JSON.stringify(item), item.updatedAt || null);
    return item;
  }

  async get(col, id) {
    await this.open();
    const row = this.db.prepare(`SELECT data FROM "${col}" WHERE id = ?`).get(id);
    return row ? JSON.parse(row.data) : null;
  }

  async all(col) {
    await this.open();
    return this.db.prepare(`SELECT data FROM "${col}" ORDER BY updatedAt DESC`).all().map((r) => JSON.parse(r.data));
  }

  async remove(col, id) {
    await this.open();
    this.db.prepare(`DELETE FROM "${col}" WHERE id = ?`).run(id);
  }

  async clear(col) {
    await this.open();
    this.db.exec(`DELETE FROM "${col}"`);
  }

  async query(col, fn) {
    return (await this.all(col)).filter(fn);
  }

  async count(col) {
    await this.open();
    return this.db.prepare(`SELECT COUNT(*) AS n FROM "${col}"`).get().n;
  }

  /** Read-only SQL passthrough for inspection (SELECT/WITH/PRAGMA/EXPLAIN only). Data column holds JSON. */
  async sqlReadOnly(sql, params = []) {
    await this.open();
    if (!/^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(String(sql))) throw new Error('Only read queries (SELECT/WITH/PRAGMA/EXPLAIN) are allowed.');
    return this.db.prepare(String(sql)).all(...params);
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}
