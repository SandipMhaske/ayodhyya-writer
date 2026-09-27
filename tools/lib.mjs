// Shared CLI helpers (Node built-ins only): SQLite database + seed + template package.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS } from '../src/storage/repository.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');
export const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'ayodhyya.db');
export const MEDIA_DIR = path.join(path.dirname(process.env.AYODHYYA_DB || DB_PATH), 'media');

export function saveMediaFile(buffer, filename, dir = MEDIA_DIR) {
  // Stores validated image bytes, deduplicating names. Returns stored name.
  fs.mkdirSync(dir, { recursive: true });
  const dot = String(filename).lastIndexOf('.');
  const stem = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : '';
  let name = filename;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${stem}-${i}${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(buffer));
  return name;
}

export function publishMediaAssets(distDir = DIST, mediaDir = MEDIA_DIR) {
  // Copies local media into the static output so imported images actually render.
  if (!fs.existsSync(mediaDir)) return 0;
  const outDir = path.join(distDir, 'assets', 'images');
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(mediaDir)) {
    const full = path.join(mediaDir, f);
    if (!fs.statSync(full).isFile() || f.startsWith('.')) continue;
    fs.copyFileSync(full, path.join(outDir, f));
    n++;
  }
  return n;
}

export function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function loadTemplateFiles(name = 'default') {
  const dir = path.join(ROOT, 'src', 'templates', name);
  const files = {};
  for (const f of ['index.html', 'article.html', 'category.html', 'tag.html', 'search.html', 'page.html', '404.html', 'style.css', 'script.js']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) files[f] = fs.readFileSync(p, 'utf8');
  }
  const meta = readJsonSafe(path.join(dir, 'template.json'), { name, versionTag: 'v1' });
  return { id: `tpl_${name}_v1`, siteId: '', name: meta.name || name, versionTag: meta.versionTag || 'v1', active: true, files, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 };
}

export async function openDatabase(dbPath = process.env.AYODHYYA_DB || DB_PATH) {
  // File-based content database. First run imports seed-data.json (plus any
  // data/<collection>.json overrides); afterwards the .db file is the source of truth.
  const { SQLiteStore } = await import('../src/storage/sqliteStore.js');
  const store = new SQLiteStore(dbPath);
  await store.open();
  if ((await store.count('sites')) === 0) {
    const seed = readJsonSafe(path.join(ROOT, 'seed', 'seed-data.json'), {});
    for (const c of COLLECTIONS) {
      const overlayPath = path.join(DATA_DIR, `${c}.json`);
      let items = null;
      if (fs.existsSync(overlayPath)) { const v = readJsonSafe(overlayPath, null); if (Array.isArray(v)) items = v; }
      for (const item of items ?? seed[c] ?? []) await store.put(c, item);
    }
    if ((await store.count('templates')) === 0) {
      const t = loadTemplateFiles('default');
      t.siteId = (await store.all('sites'))[0]?.id || '';
      await store.put('templates', t);
    }
  }
  return store;
}

export async function loadInput({ siteId } = {}) {
  const store = await openDatabase();
  try {
    const overlay = async (col) => {
      const p = path.join(DATA_DIR, `${col}.json`);
      if (fs.existsSync(p)) { const v = readJsonSafe(p, null); if (Array.isArray(v)) return v; }
      return store.all(col);
    };
    const sites = await overlay('sites');
    const site = (siteId && sites.find((s) => s.id === siteId)) || sites[0];
    if (!site) throw new Error('No site found. Run `node tools/db.mjs --init` or pass --site=<id>.');
    let templates = await overlay('templates');
    if (!templates.length) templates = [loadTemplateFiles('default')];
    const template = templates.find((t) => t.id === site.activeTemplateId) || templates[0];
    const scoped = (rows) => rows.filter((r) => !siteId || r.siteId === site.id || !r.siteId);
    const seed = readJsonSafe(path.join(ROOT, 'seed', 'seed-data.json'), {});
    const out = {
      site,
      sites,
      articles: scoped(await overlay('articles')),
      pages: scoped(await overlay('pages')),
      categories: scoped(await overlay('categories')),
      tags: scoped(await overlay('tags')),
      authors: scoped(await overlay('authors')),
      media: await overlay('media'),
      template,
      deploymentProfile: readJsonSafe(path.join(DATA_DIR, 'deployment-profile.json'), seed.deploymentProfile || {}),
      prevManifest: readJsonSafe(path.join(DIST, '.build-manifest.json'), null),
    };
    store.close();
    return out;
  } catch (err) {
    store.close();
    throw err;
  }
}

export async function writeDist(files, { compress = true } = {}) {
  const { shouldCompress } = await import('../src/optimizer/optimizer.js');
  fs.mkdirSync(DIST, { recursive: true });
  for (const [rel, content] of files) {
    const full = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    if (compress && shouldCompress(rel)) {
      try {
        const zlib = await import('node:zlib');
        const buf = Buffer.from(String(content), 'utf8');
        fs.writeFileSync(full + '.gz', zlib.gzipSync(buf));
        fs.writeFileSync(full + '.br', zlib.brotliCompressSync(buf));
        // zstd is served first when the client advertises it (smallest wire size).
        if (typeof zlib.zstdCompressSync === 'function') fs.writeFileSync(full + '.zst', zlib.zstdCompressSync(buf));
      } catch { /* compression optional */ }
    }
  }
}

export function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : true;
}
