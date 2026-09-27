// node tools/build.mjs [--site=<id>] [--full] [--audit-only]
// Offline build: validate → sanitize → generate → optimize → fingerprint → compress → manifest.
import fs from 'node:fs';
import path from 'node:path';
import { loadInput, writeDist, publishMediaAssets, arg, ROOT, DIST } from './lib.mjs';
import { generateSite, diffManifest } from '../src/builder/generator.js';
import { validateArticle, validateBuildOutput, validateRedirects, validateSiteHealth } from '../src/core/validators/validators.js';
import { scanForSecrets } from '../src/security/uploads.js';
import { hashContent } from '../src/core/utils/utils.js';

const step = (ok, label, detail = '') => console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);

const input = await loadInput({ siteId: arg('site') });
const { site, articles, pages, template } = input;

// 1–4. Validate content + SEO + media
let blockers = 0;
const slugs = articles.map((a) => a.slug);
for (const a of articles) {
  const r = validateArticle(a, { takenSlugs: slugs });
  for (const e of r.errors) { step(false, `content: ${a.slug}`, e.message); blockers++; }
}
for (const e of validateRedirects(site).errors) { step(false, 'redirects', e.message); blockers++; }
const health = validateSiteHealth({ articles, pages, media: input.media, categories: input.categories, deploymentProfile: input.deploymentProfile });
for (const area of ['content', 'seo', 'media', 'performance', 'security', 'deployment']) {
  for (const h of health[area]) if (h.level !== 'ok') console.log(`  [${area}] ${h.level.toUpperCase()}: ${h.message}`);
}
if (arg('audit-only')) process.exit(blockers ? 1 : 0);

// 5–13. Generate
const { files, contentHash, publishedCount } = await generateSite(input);
step(true, 'Preparing content', `${articles.length} articles, ${pages.length} pages`);
step(true, 'Generating pages', `${files.size} files, ${publishedCount} published`);

// 14–20. Validate output + secrets
const outCheck = validateBuildOutput(files);
for (const e of outCheck.errors) { step(false, 'output', e.message); blockers++; }
const secrets = scanForSecrets(files);
for (const s of secrets) { step(false, 'secret-scan', `${s.path} matches ${s.pattern}`); blockers++; }
if (!secrets.length) step(true, 'Security scan', 'no secrets detected');
if (blockers > 0 && !arg('force')) {
  console.error(`\nBuild BLOCKED: ${blockers} critical issue(s). Fix them or re-run with --force (security blocks cannot be forced).`);
  if (secrets.length) process.exit(1);
}

// Incremental info
const full = arg('full');
const diff = diffManifest(input.prevManifest, { files });
step(true, full ? 'Full rebuild' : 'Incremental build', `${diff.changed.length} changed, ${diff.removed.length} removed`);

// Write dist + manifest
await writeDist(files);
const mediaCount = publishMediaAssets();
if (mediaCount) step(true, 'Publishing local media', `${mediaCount} image(s) → dist/assets/images/`);
const templateHash = hashContent(JSON.stringify(template.files));
fs.writeFileSync(path.join(DIST, '.build-manifest.json'), JSON.stringify({
  siteId: site.id, builtAt: new Date().toISOString(), contentHash, templateHash,
  hashes: diff.nextHashes, fileCount: files.size,
}, null, 2));
step(true, 'Build complete', `${files.size} files → ./dist/ (contentHash ${contentHash})`);
console.log(`\nPreview: node tools/preview.mjs\nPublish: node tools/deploy.mjs`);
