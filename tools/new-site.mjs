// node tools/new-site.mjs [--seed] [--list-sites] [--export-backup] [--site=<id>]
// Local data helpers: inspect seed, export/import backups (offline, no secrets included).
import fs from 'node:fs';
import path from 'node:path';
import { loadInput, arg, ROOT, DATA_DIR } from './lib.mjs';

if (arg('list-sites') || process.argv.length <= 2) {
  const { sites } = await loadInput({});
  console.log('Sites:');
  for (const s of sites) console.log(` - ${s.id}  ${s.name}  ${s.url}`);
}
if (arg('seed')) {
  console.log('Seed data lives at seed/seed-data.json and is imported into data/ayodhyya.db on first run.');
  console.log('After that the SQLite database is the source of truth. Manage it with: node tools/db.mjs --stats');
  console.log('Per-device browser edits live in IndexedDB; CLI edits live in data/ayodhyya.db.');
}
if (arg('export-backup')) {
  const input = await loadInput({ siteId: arg('site') });
  const { deploymentProfile, prevManifest, sites, ...rest } = input;
  const backup = { exportedAt: new Date().toISOString(), app: 'ayodhyya-writer', version: 1, data: rest };
  fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });
  const p = path.join(ROOT, 'backups', `backup-${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(backup, null, 2));
  console.log(`Backup written (no secrets included): ${p}`);
}
