// IContentRepository abstraction: Memory (tests/offline fallback) + IndexedDB (browser).
// Future: SQLite adapter (desktop) + cloud sync — same interface, no business-layer rewrite.
export const COLLECTIONS = ['sites', 'articles', 'pages', 'categories', 'tags', 'authors', 'media', 'templates', 'revisions', 'deployments', 'audit', 'kv'];

export class MemoryStore {
  constructor(seed = {}) {
    this.data = {};
    for (const c of COLLECTIONS) this.data[c] = new Map();
    if (seed) for (const c of COLLECTIONS) for (const item of seed[c] || []) this.data[c].set(item.id, structuredCloneSafe(item));
  }
  async put(col, item) { this.data[col].set(item.id, structuredCloneSafe(item)); return item; }
  async get(col, id) { const v = this.data[col].get(id); return v ? structuredCloneSafe(v) : null; }
  async all(col) { return [...this.data[col].values()].map(structuredCloneSafe); }
  async remove(col, id) { this.data[col].delete(id); }
  async clear(col) { this.data[col].clear(); }
  async query(col, fn) { return (await this.all(col)).filter(fn); }
}

function structuredCloneSafe(v) {
  if (typeof structuredClone === 'function') { try { return structuredClone(v); } catch { /* fall through */ } }
  return JSON.parse(JSON.stringify(v));
}

// Minimal IndexedDB adapter with the same interface (browser only).
export class IndexedDBStore {
  constructor(dbName = 'ayodhyya-writer-v1') { this.dbName = dbName; this.db = null; }
  open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }
  tx(col, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(col, mode);
      const store = t.objectStore(col);
      const out = fn(store);
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
    });
  }
  async put(col, item) { await this.openIfNeeded(); return this.tx(col, 'readwrite', (s) => s.put(structuredCloneSafe(item))); }
  async get(col, id) {
    await this.openIfNeeded();
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(col, 'readonly');
      const r = t.objectStore(col).get(id);
      r.onsuccess = () => resolve(r.result ? structuredCloneSafe(r.result) : null);
      r.onerror = () => reject(r.error);
    });
  }
  async all(col) {
    await this.openIfNeeded();
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(col, 'readonly');
      const r = t.objectStore(col).getAll();
      r.onsuccess = () => resolve((r.result || []).map(structuredCloneSafe));
      r.onerror = () => reject(r.error);
    });
  }
  async remove(col, id) { await this.openIfNeeded(); return this.tx(col, 'readwrite', (s) => s.delete(id)); }
  async clear(col) { await this.openIfNeeded(); return this.tx(col, 'readwrite', (s) => s.clear()); }
  async query(col, fn) { return (await this.all(col)).filter(fn); }
  async openIfNeeded() { if (!this.db) await this.open(); }
}

export async function createRepository({ seed } = {}) {
  // Browser: prefer IndexedDB, fall back to memory. Node/tests: memory.
  if (typeof indexedDB !== 'undefined') {
    try {
      const idb = new IndexedDBStore();
      await idb.open();
      if (seed) {
        const existing = await idb.all('sites');
        if (!existing.length) for (const c of COLLECTIONS) for (const item of seed[c] || []) await idb.put(c, item);
      }
      return idb;
    } catch { /* fall through to memory */ }
  }
  return new MemoryStore(seed);
}

// localStorage persistence helper for the single-page UI (non-sensitive data only).
// NEVER persist secrets/tokens here — deployment credentials stay server-side.
export const LocalBackup = {
  exportJson(all) { return JSON.stringify({ exportedAt: new Date().toISOString(), app: 'ayodhyya-writer', version: 1, data: all }, null, 2); },
  parseBackup(text) {
    const obj = JSON.parse(String(text));
    if (!obj || typeof obj !== 'object' || !obj.data) throw new Error('Invalid backup file.');
    return obj.data;
  },
};
