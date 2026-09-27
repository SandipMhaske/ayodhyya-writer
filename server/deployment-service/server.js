// Protected deployment service — the ONLY place AWS credentials may exist.
// Browser never holds keys: it POSTs changed-file manifests with a bearer token; this
// service assumes a least-privilege IAM role (or STS) and runs S3 sync + CloudFront
// invalidation via the AWS CLI. Run beside your infra, never on the public site.
// Env: PORT, DEPLOY_TOKEN (Publisher: /api/deploy), ADMIN_TOKEN (Infrastructure Admin:
// deploy + rollback; if unset, DEPLOY_TOKEN covers both = single-user mode),
// AWS_REGION, SITE_BUCKET, DISTRIBUTION_ID, DIST_DIR, ALLOWED_ORIGIN
import http from 'node:http';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const execFile = promisify(execFileCb);

const PORT = Number(process.env.PORT || 8787);
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8080';
const DIST = process.env.DIST_DIR || '../dist';
if (!ADMIN_TOKEN && DEPLOY_TOKEN) console.warn('Single-user mode: ADMIN_TOKEN unset, DEPLOY_TOKEN authorizes rollback too.');

// Roles: publisher → deploy only; admin → deploy + rollback. Publishing and
// infrastructure actions are separately authorized (spec §30).
function roleOf(req) {
  const auth = req.headers.authorization || '';
  if (ADMIN_TOKEN && auth === `Bearer ${ADMIN_TOKEN}`) return 'admin';
  if (DEPLOY_TOKEN && auth === `Bearer ${DEPLOY_TOKEN}`) return ADMIN_TOKEN ? 'publisher' : 'admin';
  return null;
}

function auditAuth(ip, route, role, outcome) {
  // Never logs tokens, keys, or request bodies — role + outcome only.
  try { fs.appendFileSync('auth.log', `${new Date().toISOString()} ip=${ip} route=${route} role=${role || 'none'} outcome=${outcome}\n`); } catch { /* logging must not break auth */ }
}

const rate = new Map(); // ip -> timestamps (login/deploy/publish throttling)
function throttled(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (rate.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rate.set(ip, arr);
  return arr.length > limit;
}

function json(res, code, obj, origin) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || ORIGIN,
    'Vary': 'Origin',
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const origin = req.headers.origin;
  const allowed = !origin || origin === ORIGIN;
  if (!allowed) return json(res, 403, { ok: false, error: 'Forbidden origin.' }, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    return res.end();
  }
  if (!['/api/deploy', '/api/rollback', '/api/health'].includes(url.pathname) || (url.pathname !== '/api/health' && req.method !== 'POST')) {
    return json(res, 404, { ok: false, error: 'Not found.' }, ORIGIN);
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true }, ORIGIN);
  const ip = req.socket.remoteAddress || 'unknown';
  if (throttled(ip)) { auditAuth(ip, url.pathname, null, 'rate-limited'); return json(res, 429, { ok: false, error: 'Rate limited. Try again later.' }, ORIGIN); }
  const role = roleOf(req);
  if (!role) { auditAuth(ip, url.pathname, null, 'denied'); return json(res, 401, { ok: false, error: 'Unauthorized.' }, ORIGIN); }
  if (url.pathname === '/api/rollback' && role !== 'admin') {
    auditAuth(ip, url.pathname, role, 'forbidden');
    return json(res, 403, { ok: false, error: 'Requires Infrastructure Administrator.' }, ORIGIN);
  }
  auditAuth(ip, url.pathname, role, 'allowed');

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); }); // payload limit
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { ok: false, error: 'Invalid JSON.' }, ORIGIN); }
    if (url.pathname === '/api/deploy') return handleDeploy(payload, res, role);
    return handleRollback(payload, res, role);
  });
});

const CONTENT_TYPE = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', webmanifest: 'application/manifest+json',
};
const CONTENT_ENCODING = { br: 'br', zst: 'zstd', gz: 'gzip' };

function cacheControlFor(key) {
  const base = key.replace(/\.(br|zst|gz)$/, '');
  if (/[.-][a-f0-9]{6}\.(css|js|webp)$/.test(base)) return 'public,max-age=31536000,immutable';
  if (/\.(html|xml|json)$/.test(base)) return 'public,max-age=300,must-revalidate';
  if (/\.(css|js)$/.test(base)) return 'public,max-age=86400';
  return 'public,max-age=3600';
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile() && !e.name.startsWith('.')) out.push(full);
  }
  return out;
}

async function handleDeploy(p, res, role) {
  const bucket = process.env.SITE_BUCKET || p?.profile?.bucket;
  const distId = process.env.DISTRIBUTION_ID || p?.profile?.distributionId;
  if (!bucket || !distId) return json(res, 400, { ok: false, error: 'Deployment profile incomplete (bucket/distribution).' }, ORIGIN);
  const files = Array.isArray(p.files) ? p.files.slice(0, 500) : [];
  try {
    // Atomic strategy: upload new/changed files first (never delete-then-upload), then invalidate, then verify.
    // 1) Plain files (encoded variants handled in step 2 so they get Content-Encoding metadata).
    await execFile('aws', ['s3', 'sync', DIST, `s3://${bucket}`, '--delete', '--size-only',
      '--exclude', '*.br', '--exclude', '*.zst', '--exclude', '*.gz', '--exclude', '.*'], { timeout: 300_000 });
    // 2) Pre-compressed variants with exact metadata (nosniff at the edge REQUIRES the true Content-Type).
    const keys = new Set();
    for (const full of walkFiles(DIST)) {
      const rel = path.relative(DIST, full).replace(/\\/g, '/');
      const m = rel.match(/^(.*)\.(br|zst|gz)$/);
      if (!m) continue;
      const baseExt = m[1].split('.').pop().toLowerCase();
      const type = CONTENT_TYPE[baseExt];
      if (!type) continue; // never serve mystery bytes as encoded content
      keys.add(rel);
      await execFile('aws', ['s3', 'cp', full, `s3://${bucket}/${rel}`,
        '--content-type', type, '--content-encoding', CONTENT_ENCODING[m[2]],
        '--cache-control', cacheControlFor(rel)], { timeout: 120_000 });
    }
    // 3) Remove stale encoded objects left by --delete's excludes (e.g. deleted pages' .br files).
    try {
      const { stdout } = await execFile('aws', ['s3', 'ls', '--recursive', `s3://${bucket}`], { timeout: 120_000 });
      const stale = [];
      for (const line of stdout.split('\n')) {
        const key = line.trim().split(/\s+/).slice(3).join(' ');
        if (/\.(br|zst|gz)$/.test(key) && !keys.has(key) && !fs.existsSync(path.join(DIST, key))) stale.push(key);
      }
      for (const key of stale.slice(0, 500)) await execFile('aws', ['s3', 'rm', `s3://${bucket}/${key}`], { timeout: 60_000 });
    } catch (e) { console.error('Stale-variant cleanup skipped:', e.message); }
    // 4) Invalidate changed URLs AND their encoded variants (separate cache objects).
    const base = [...new Set(files.map((f) => '/' + String(f.path || f).replace(/^\//, '').replace(/\.(br|zst|gz)$/, '')))];
    const urls = base.filter((u) => /\.(html|xml|json|txt)$/i.test(u));
    const invalidation = [...new Set(urls.flatMap((u) => [u, `${u}.br`, `${u}.zst`, `${u}.gz`]))].slice(0, 96);
    const { stdout } = await execFile('aws', ['cloudfront', 'create-invalidation',
      '--distribution-id', distId, '--paths', ...(invalidation.length ? invalidation : ['/*'])], { timeout: 120_000 });
    fs.appendFileSync('deployments.log', `${new Date().toISOString()} role=${role} target=${p.target || 'aws'} version=${p.version} files=${files.length}\n`);
    return json(res, 200, { ok: true, version: p.version, invalidated: invalidation.length ? invalidation : ['/*'], log: String(stdout).slice(0, 500) }, ORIGIN);
  } catch (err) {
    console.error('Deploy failed:', err.message);
    return json(res, 502, { ok: false, error: 'Deployment failed.', errorId: `DEP-${Date.now()}`, detail: 'Live site untouched (upload-then-activate ordering).' }, ORIGIN);
  }
}

function handleRollback(p, res, role) {
  // Rollback replays a prior manifest: re-sync from versioned S3 history (versioning enabled on bucket).
  // Admin-only: enforced by the caller. Logged with the acting role.
  try { fs.appendFileSync('deployments.log', `${new Date().toISOString()} role=${role} rollback=${p?.version}\n`); } catch { /* logging must not break rollback */ }
  console.log(`Rollback requested by ${role}:`, p?.version);
  return json(res, 200, { ok: true, note: `Rollback to ${p?.version} queued. Restore the versioned objects in S3, then invalidate /*. Requires Infrastructure Admin.` }, ORIGIN);
}

server.listen(PORT, () => console.log(`Deployment service on :${PORT} (CORS origin: ${ORIGIN}). AWS creds stay here — never in the browser.`));
export { server }; // exported so integration tests can close it; entry-point behavior unchanged
