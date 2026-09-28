// node tools/doctor.mjs [--json]
// Site doctor: answers "why isn't my site working?" in one command. Read-only
// (never fixes, never writes) — prints human lines by default, machine JSON with --json.
// Exit 0 = healthy (warnings allowed), 1 = something blocks build/publish.
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, arg, ROOT, DIST, DATA_DIR, DB_PATH } from './lib.mjs';
import { validateTemplate } from '../src/templates/engine.js';

const results = [];
const ok = (area, message) => results.push({ level: 'ok', area, message });
const warn = (area, message) => results.push({ level: 'warn', area, message });
const fail = (area, message) => results.push({ level: 'fail', area, message });

const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) ok('env', `Node ${process.versions.node} supported.`);
else fail('env', `Node ${process.versions.node} too old — need 18+.`);

const dbPath = process.env.AYODHYYA_DB || DB_PATH;
try {
  // Opening self-heals: a missing database is created and seeded on the spot.
  const db = await openDatabase();
  try {
    const sites = await db.all('sites');
    if (!sites.length) fail('database', 'Database has no sites and seeding produced none — check seed/seed-data.json.');
    else ok('database', `${sites.length} site(s), ${(await db.all('articles')).length} article(s) at ${dbPath}.`);
    const templates = await db.all('templates');
    if (!templates.length) fail('templates', 'No templates installed.');
    for (const t of templates) {
      const v = validateTemplate({ name: t.name, files: t.files || {} });
      if (!v.ok) fail('templates', `${t.name}: ${v.errors.join('; ')}`);
    }
    if (templates.length && templates.every((t) => validateTemplate({ name: t.name, files: t.files || {} }).ok)) {
      ok('templates', `${templates.length} valid template(s).`);
    }
  } finally { db.close(); }
} catch (e) {
  fail('database', `Cannot open database at ${dbPath} (${e.message}) — check disk permissions or restore from backup.`);
}

if (!fs.existsSync(path.join(ROOT, 'seed', 'seed-data.json'))) warn('seed', 'seed/seed-data.json missing — fresh installs cannot seed.');
else ok('seed', 'First-run seed present.');

if (!fs.existsSync(path.join(DIST, 'index.html'))) warn('build', 'No built site yet — run: node tools/build.mjs');
else if (!fs.existsSync(path.join(DIST, '.build-manifest.json'))) warn('build', 'dist/ exists but no build manifest — rebuild recommended.');
else ok('build', 'Generated site present with manifest.');

const profile = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'deployment-profile.json'), 'utf8')); } catch { return null; } })();
if (!profile?.bucket || !profile?.distributionId) warn('deploy', 'Deployment profile incomplete — publishing uses the local provider until Website settings are saved.');
else ok('deploy', `Deployment target configured (${profile.bucket}).`);

if (!fs.existsSync(path.join(ROOT, 'server', 'deployment-service', 'server.js'))) warn('deploy', 'Deployment backend missing from checkout.');
else ok('deploy', 'Deployment backend present.');

const fails = results.filter((r) => r.level === 'fail').length;
if (arg('json')) console.log(JSON.stringify({ ok: fails === 0, results }, null, 2));
else {
  for (const r of results) console.log(`${r.level === 'ok' ? '✓' : r.level === 'warn' ? '⚠' : '✗'} [${r.area}] ${r.message}`);
  console.log(fails ? `\n${fails} blocking issue(s) above.` : '\nAll checks passed.');
}
process.exit(fails ? 1 : 0);
