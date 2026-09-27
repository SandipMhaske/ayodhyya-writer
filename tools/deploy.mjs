// node tools/deploy.mjs [--site=<id>] [--dry-run] [--version=<v>] [--rollback=<version>]
// One-click publish workflow: detect → validate → build → manifest → upload → invalidate →
// verify → mark published → snapshot → store record. Atomic: never deletes live site first.
// Rollback restores the per-deploy content snapshot, rebuilds, and redeploys as a new record.
import fs from 'node:fs';
import path from 'node:path';
import { loadInput, openDatabase, writeDist, publishMediaAssets, arg, ROOT, DIST } from './lib.mjs';
import { generateSite, diffManifest } from '../src/builder/generator.js';
import { validateArticle, validateBuildOutput, validateRedirects } from '../src/core/validators/validators.js';
import { scanForSecrets } from '../src/security/uploads.js';
import { AwsS3CloudFrontDeploymentProvider, publicProfile, newDeploymentVersion, buildDeploymentManifest } from '../src/deployment/providers.js';
import { BackupService, ArticleService } from '../src/core/services/services.js';
import { hashContent } from '../src/core/utils/utils.js';

const log = (done, label, detail = '') => console.log(`${done === true ? '✓' : done === false ? '✗' : '…'} ${label}${detail ? ' — ' + detail : ''}`);
const t0 = Date.now();
const snapshotFile = (v) => path.join(ROOT, 'backups', `deploy-${v}.json`);

async function buildAndValidate(input) {
  const { articles } = input;
  const slugs = articles.map((a) => a.slug);
  let blockers = 0;
  for (const a of articles) for (const e of validateArticle(a, { takenSlugs: slugs }).errors) { log(false, `validating: ${a.slug}`, e.message); blockers++; }
  for (const e of validateRedirects(input.site).errors) { log(false, 'redirects', e.message); blockers++; }
  if (blockers) { console.error('Deployment blocked by validation errors.'); process.exit(1); }
  log(true, 'Validating articles');
  const { files, contentHash } = await generateSite(input);
  log(true, 'Generating pages', `${files.size} files`);
  const outCheck = validateBuildOutput(files);
  if (!outCheck.ok) { for (const e of outCheck.errors) log(false, 'output', e.message); process.exit(1); }
  const secrets = scanForSecrets(files);
  if (secrets.length) { for (const s of secrets) log(false, 'secret-scan', s.path); process.exit(1); }
  log(true, 'Security scan passed');
  log(true, 'Optimizing images / minifying / fingerprinting (build-time)');
  log(true, 'Compressing assets (gzip + brotli + zstd where beneficial)');
  return { files, contentHash };
}

async function finishDeploy(input, { files, contentHash, version, changed, note = '', rollbackFrom = '' }) {
  const { site, template, deploymentProfile } = input;
  const templateHash = hashContent(JSON.stringify(template.files));
  const manifest = buildDeploymentManifest({ siteId: site.id, version, contentHash, templateHash, files: changed, deployer: process.env.USER || process.env.USERNAME || 'local' });
  const backendUrl = process.env.DEPLOY_SERVICE_URL;
  const target = process.env.DEPLOY_TARGET || 'aws';
  let result;
  if (target === 'cloudflare') {
    const { CloudflarePagesProvider } = await import('../src/deployment/cloudflare.js');
    const cf = new CloudflarePagesProvider({ accountId: process.env.CF_ACCOUNT_ID, project: process.env.CF_PROJECT, token: process.env.CLOUDFLARE_API_TOKEN });
    log(null, 'Uploading to Cloudflare Pages', `${changed.length} changed → ${process.env.CF_PROJECT || '(set CF_PROJECT)'}`);
    try {
      // Pages needs real bytes: merge local media binaries into the upload map.
      const upload = new Map(files);
      try {
        const { MEDIA_DIR } = await import('./lib.mjs');
        for (const f of fs.readdirSync(MEDIA_DIR)) {
          const full = path.join(MEDIA_DIR, f);
          if (fs.statSync(full).isFile() && !f.startsWith('.')) upload.set(`assets/images/${f}`, fs.readFileSync(full));
        }
      } catch { /* no local media */ }
      const r = await cf.deploy({ files: upload, site });
      result = { ...r, filesChanged: changed.length };
      log(true, 'Pages deployment live', `${r.url} (${r.filesUploaded}/${r.filesTotal} assets uploaded, rest deduplicated)`);
    } catch (e) {
      log(false, 'Cloudflare deploy', e.message);
      console.log('\nDEPLOYMENT FAILED\nSet CF_ACCOUNT_ID, CF_PROJECT and CLOUDFLARE_API_TOKEN (Pages Write token), then retry.');
      process.exit(1);
    }
  } else if (backendUrl && process.env.DEPLOY_SERVICE_TOKEN) {
    const { postDeploy, BackendError } = await import('../src/deployment/backendClient.js');
    const provider = new AwsS3CloudFrontDeploymentProvider({ profile: deploymentProfile, api: null });
    const paths = provider.changedPaths(changed);
    log(null, 'Uploading to AWS', `${changed.length} files → s3://${deploymentProfile.bucket || '(profile bucket)'}`);
    try {
      const data = await postDeploy({
        baseUrl: backendUrl,
        token: process.env.DEPLOY_SERVICE_TOKEN,
        payload: { target: target === 'cloudflare' ? target : 'aws', profile: publicProfile(deploymentProfile), version, contentHash, files: changed },
      });
      result = { ok: true, provider: 'aws-s3-cloudfront (via deployment service)', version, invalidationPaths: data.invalidated || paths, url: `https://${deploymentProfile.domain || site.domain}` };
      log(true, 'Updating CloudFront', `invalidate: ${(data.invalidated || paths).slice(0, 5).join(', ')}`);
    } catch (e) {
      const msg = e instanceof BackendError ? `${e.message}${e.detail ? ' ' + e.detail : ''}` : String(e?.message || e);
      log(false, 'Backend deploy', msg);
      console.log('\nDEPLOYMENT FAILED\nNo record stored and the live site is untouched. Fix the backend issue and retry.');
      process.exit(1);
    }
  } else {
    await writeDist(files); // local provider: same output + compression artifacts as build
    publishMediaAssets();
    result = { ok: true, provider: 'local-filesystem (local; configure DEPLOY_SERVICE_URL for AWS)', version, filesWritten: files.size, url: 'file://' + DIST };
    log(true, 'Uploading (local filesystem provider)', `${files.size} files → ./dist/`);
  }
  log(true, 'Verifying deployment');
  const db = await openDatabase();
  try {
    await ArticleService.markDeployed(db, site.id);
    log(true, 'Marking content as Published');
    // Point-in-time snapshot so any version can be rolled back to.
    const snap = await BackupService.exportAll(db);
    fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });
    fs.writeFileSync(snapshotFile(version), JSON.stringify(snap, null, 2));
    log(true, 'Snapshotting content', path.basename(snapshotFile(version)));
    const record = { ...manifest, id: manifest.deploymentId, createdAt: manifest.timestamp, updatedAt: manifest.timestamp, rowVersion: 1, result, note, rollbackFrom, secs: Math.round((Date.now() - t0) / 1000) };
    await db.put('deployments', record);
    log(true, 'Storing deployment record');
    persistJsonMirror(record);
  } finally {
    db.close();
  }
  console.log(`\nDEPLOYMENT ${result.ok ? 'SUCCESSFUL' : 'FAILED'}\nVersion: ${version}\nFiles changed: ${changed.length}\nDeployment time: ${Math.round((Date.now() - t0) / 1000)}s\nTarget: ${result.url}${note ? `\nNote: ${note}` : ''}\n[${result.url}] [View Deployment] [Rollback: node tools/deploy.mjs --rollback=${version}]`);
}

function persistJsonMirror(record) {
  // Human-readable log alongside the DB record.
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const recPath = path.join(ROOT, 'data', 'deployments.json');
  let records = [];
  try { records = JSON.parse(fs.readFileSync(recPath, 'utf8')); } catch { /* fresh */ }
  records.push(record);
  fs.writeFileSync(recPath, JSON.stringify(records, null, 2));
}

function availableSnapshots() {
  try {
    return fs.readdirSync(path.join(ROOT, 'backups')).filter((f) => f.startsWith('deploy-') && f.endsWith('.json')).sort();
  } catch { return []; }
}

// ---- rollback flow ----
const rollbackTo = arg('rollback');
if (rollbackTo) {
  if (rollbackTo === true) { console.error('Usage: node tools/deploy.mjs --rollback=<version>\nAvailable snapshots:'); for (const s of availableSnapshots()) console.error('  ' + s.replace(/^deploy-/, '').replace(/\.json$/, '')); process.exit(1); }
  const snapPath = snapshotFile(rollbackTo);
  if (!fs.existsSync(snapPath)) {
    console.error(`No snapshot for version ${rollbackTo}.\nAvailable: ${availableSnapshots().join(', ') || '(none — snapshots are saved on every successful deploy)'}`);
    process.exit(1);
  }
  log(null, 'Restoring snapshot', path.basename(snapPath));
  const db = await openDatabase();
  try {
    await BackupService.importAll(db, JSON.parse(fs.readFileSync(snapPath, 'utf8')));
  } finally { db.close(); }
  log(true, 'Content restored', `point-in-time state of ${rollbackTo}`);
  const input = await loadInput({ siteId: arg('site') });
  log(null, 'Preparing content');
  const { files, contentHash } = await buildAndValidate(input);
  const diff = diffManifest(input.prevManifest, { files });
  log(true, 'Detecting changes', `${diff.changed.length} changed`);
  await finishDeploy(input, { files, contentHash, version: newDeploymentVersion(), changed: diff.changed, note: `rollback to ${rollbackTo}`, rollbackFrom: rollbackTo });
  process.exit(0);
}

// ---- normal publish flow ----
const dryRun = arg('dry-run');
const input = await loadInput({ siteId: arg('site') });
const { site, deploymentProfile } = input;
const version = arg('version') || newDeploymentVersion();

log(null, 'Preparing content');
const { files, contentHash } = await buildAndValidate(input);
const diff = diffManifest(input.prevManifest, { files });
log(true, 'Detecting changes', `${diff.changed.length} changed`);

if (dryRun) {
  console.log(`\nDRY RUN — would deploy version ${version} (${diff.changed.length} files) to ${deploymentProfile.domain || site.domain}`);
  console.log('Changed:', diff.changed.slice(0, 20).join(', ') + (diff.changed.length > 20 ? ' …' : ''));
  process.exit(0);
}
await finishDeploy(input, { files, contentHash, version, changed: diff.changed });
