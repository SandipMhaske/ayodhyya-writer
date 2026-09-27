// node tools/db.mjs [--init] [--stats] [--sites] [--articles] [--export] [--export-xml] [--import --file=..] [--sql="SELECT ..."] [--reset --yes]
// Local content database manager. The SQLite file data/ayodhyya.db is the source of
// truth for all CLI commands (build/deploy); seed-data.json is only a first-run seed.
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, arg, ROOT, DATA_DIR, DB_PATH } from './lib.mjs';
import { BackupService } from '../src/core/services/services.js';
import { COLLECTIONS } from '../src/storage/repository.js';

const cmd = (process.argv[2] || '--stats').split('=')[0];
const TARGET_DB = process.env.AYODHYYA_DB || DB_PATH; // shown honestly when overridden

if (cmd === '--init') {
  const db = await openDatabase();
  console.log(`Database ready: ${db.dbPath || TARGET_DB}`);
  for (const c of COLLECTIONS) console.log(`  ${c}: ${await db.count(c)}`);
  db.close();
} else if (cmd === '--stats') {
  if (!fs.existsSync(TARGET_DB)) console.log('No database yet — run: node tools/db.mjs --init');
  else {
    const db = await openDatabase();
    const size = fs.statSync(TARGET_DB).size;
    console.log(`Database: ${db.dbPath || TARGET_DB} (${(size / 1024).toFixed(1)} KB)`);
    for (const c of COLLECTIONS) console.log(`  ${c}: ${await db.count(c)}`);
    db.close();
  }
} else if (cmd === '--sites') {
  const db = await openDatabase();
  for (const s of await db.all('sites')) console.log(` - ${s.id}  ${s.name}  ${s.url}  [${s.status}]`);
  db.close();
} else if (cmd === '--articles') {
  const db = await openDatabase();
  const site = arg('site');
  const status = arg('status');
  const rows = (await db.all('articles')).filter((a) => (!site || a.siteId === site) && (!status || a.status === status));
  for (const a of rows) console.log(` - [${a.status}] ${a.slug}  ${a.title}  (rev ${a.revision}, deployed rev ${a.lastDeployedRevision})`);
  if (!rows.length) console.log('No articles match.');
  db.close();
} else if (cmd === '--deployments') {
  const db = await openDatabase();
  const rows = (await db.all('deployments')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const d of rows) console.log(` - ${d.version}${d.rollbackFrom ? `  (rollback to ${d.rollbackFrom})` : ''}  files:${d.filesChanged}  ${d.status}  ${(d.createdAt || '').slice(0, 16).replace('T', ' ')}${d.note ? '  — ' + d.note : ''}`);
  if (!rows.length) console.log('No deployments yet.');
  db.close();
} else if (cmd === '--export' || cmd === '--export-xml') {
  const db = await openDatabase();
  const data = await BackupService.exportAll(db);
  db.close();
  const xml = cmd === '--export-xml';
  const password = arg('password');
  const ext = password ? 'enc' : xml ? 'xml' : 'json';
  const out = arg('out') || path.join(ROOT, 'backups', `backup-${Date.now()}.${ext}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let text = xml ? BackupService.toXml(data) : JSON.stringify(data, null, 2);
  if (password) {
    const { encryptBackup } = await import('../src/security/backupCrypto.js');
    text = encryptBackup(text, password);
  }
  fs.writeFileSync(out, text);
  console.log(`Backup written${password ? ' (AES-256-GCM encrypted)' : ''} (no secrets included): ${out}`);
} else if (cmd === '--import') {
  const file = arg('file');
  if (!file) { console.error('Usage: node tools/db.mjs --import --file=backups/backup-....json [--password=...]'); process.exit(1); }
  let text = fs.readFileSync(file, 'utf8');
  const { isEncryptedBackup, decryptBackup } = await import('../src/security/backupCrypto.js');
  if (isEncryptedBackup(text)) {
    const password = arg('password');
    if (!password) { console.error('Backup is encrypted — retry with --password=...'); process.exit(1); }
    try { text = decryptBackup(text, password); } catch (e) { console.error(e.message); process.exit(1); }
  }
  const db = await openDatabase();
  await BackupService.importAll(db, JSON.parse(text));
  console.log(`Imported ${file} into ${TARGET_DB}`);
  db.close();
} else if (cmd === '--import-url') {
  const url = arg('import-url') || process.argv[3] || '';
  if (!url || url === true) { console.error('Usage: node tools/db.mjs --import-url=https://example.com/article [--site=<id>] [--allow-local]'); process.exit(1); }
  const { fetchArticle } = await import('../src/core/utils/fetchArticle.js');
  const { ArticleService } = await import('../src/core/services/services.js');
  const allow = arg('allow-local') === true || arg('allow-local') === 'true';
  let found;
  try {
    found = await fetchArticle(url, { allowLocal: allow });
  } catch (e) { console.error('Import failed:', e.message); process.exit(1); }
  const db = await openDatabase();
  const sites = await db.all('sites');
  const siteId = arg('site') || sites[0]?.id;
  if (!siteId) { console.error('No site in database.'); process.exit(1); }
  const { downloadImages } = await import('../src/media/importImages.js');
  const { saveMediaFile } = await import('./lib.mjs');
  const { MediaService } = await import('../src/core/services/services.js');
  const dl = await downloadImages(found.images, { allowLocal: allow });
  let content = found.content;
  let featured = found.featuredImage;
  let localized = 0;
  const failed = [];
  for (const r of dl) {
    if (!r.ok) { failed.push(`${r.src} (${(r.errors || []).join(' ')})`); continue; }
    const stored = saveMediaFile(r.buffer, r.filename);
    await MediaService.register(db, siteId, { filename: stored, originalName: r.filename, mimeType: r.mime, size: r.size, altText: r.alt, title: r.alt, hash: stored });
    const local = `/assets/images/${stored}`;
    content = content.split(r.src).join(local);
    if (featured === r.src) featured = local;
    localized++;
  }
  const a = await ArticleService.create(db, siteId, {
    title: found.title, slug: found.slug, excerpt: found.excerpt, content,
    metaDescription: found.excerpt, canonicalUrl: found.canonicalUrl, featuredImage: featured,
  });
  db.close();
  console.log(`Imported as draft: "${a.title}" (${a.slug}, ${a.wordCount} words, canonical ${found.canonicalUrl})`);
  console.log(`Images: ${localized} localized to /assets/images/, ${failed.length} kept remote${failed.length ? ' — ' + failed.slice(0, 3).join('; ') : ''}`);
} else if (cmd === '--sql') {
  const q = arg('sql', process.argv[3] || '');
  if (!q) { console.error('Usage: node tools/db.mjs --sql="SELECT id, json_extract(data,\'$.title\') AS title FROM articles"'); process.exit(1); }
  const db = await openDatabase();
  try {
    const rows = await db.sqlReadOnly(q);
    console.log(JSON.stringify(rows.slice(0, 100), null, 2));
    if (rows.length > 100) console.log(`… +${rows.length - 100} more rows`);
  } catch (e) { console.error('Query rejected:', e.message); process.exit(1); }
  db.close();
} else if (cmd === '--reset') {
  if (arg('yes') !== true && arg('yes') !== 'true') { console.error(`Refusing without --yes. This deletes ${TARGET_DB}.`); process.exit(1); }
  const db = await openDatabase();
  db.close();
  fs.rmSync(TARGET_DB, { force: true });
  console.log('Database deleted. Next --init re-imports the seed.');
} else {
  console.log('Usage: node tools/db.mjs [--init|--stats|--sites|--articles|--deployments|--export|--export-xml|--import --file=..|--import-url=<url>|--sql="SELECT .."| --reset --yes]');
}
