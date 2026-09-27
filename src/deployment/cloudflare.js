// CloudflarePagesProvider — second IDeploymentProvider implementation, proving the core
// CMS is not coupled to AWS. Deploys prebuilt dist/ via the Pages Direct Upload REST API
// (same protocol wrangler uses): upload-token → check-missing → upload assets → deployment.
// Secrets (CLOUDFLARE_API_TOKEN) stay in env / the deployment backend, never in the repo,
// browser storage, or generated output. Live run needs an account + token; all logic below
// is unit-tested with an injected fetch.
import { createHash } from 'node:crypto';
import { securityHeaders } from '../security/uploads.js';

const API = 'https://api.cloudflare.com/client/v4';

export function md5Hex(content) {
  return createHash('md5').update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content).digest('hex');
}

const SKIP = /(^|\/)\.|\.(br|zst|gz)$/;
// Dotfiles (.build-manifest.json, .gitkeep) are local-only. Pages compresses on its own
// (gzip/brotli) — pre-compressed variants must NOT upload as separate keys.
// _headers / _redirects ARE uploaded: Pages reads them natively from the deployment.

export function pagesManifest(files) {
  // files: Map<outputPath, string|Buffer> → { '/path': md5 } for uploadable assets.
  const manifest = {};
  for (const [p, content] of files) {
    if (SKIP.test(p)) continue;
    manifest['/' + String(p).replace(/^\//, '')] = md5Hex(content);
  }
  return manifest;
}

export function platformFiles(site) {
  // Native Pages config files, generated at deploy time (never committed by hand).
  const out = new Map();
  const h = securityHeaders({ adsense: !!site?.adsense?.publisherId });
  out.set('_headers', '/*\n' + Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join('\n') + '\n');
  const redirects = (site?.redirects || []).filter((r) => r?.from && r?.to);
  if (redirects.length) out.set('_redirects', redirects.map((r) => `${r.from} ${r.to} ${r.code || 301}`).join('\n') + '\n');
  return out;
}

export class CloudflarePagesProvider {
  constructor({ accountId, project, token, fetchImpl } = {}) {
    this.accountId = accountId;
    this.project = project;
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch;
    this.name = 'cloudflare-pages';
  }

  changedPaths() {
    return []; // Pages deploys are atomic full-site publishes — no invalidation concept.
  }

  cacheControlFor() {
    return null; // caching is Pages-managed; security headers ship via the _headers file.
  }

  api(path, { method = 'GET', body, jwt } = {}) {
    return this.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt || this.token}`,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  }

  async deploy({ files, site }) {
    if (!this.accountId || !this.project || !this.token) {
      throw new Error('Cloudflare deploy needs CF_ACCOUNT_ID, CF_PROJECT and CLOUDFLARE_API_TOKEN.');
    }
    const withPlatform = new Map([...files, ...platformFiles(site)]);
    const manifest = pagesManifest(withPlatform);
    const hashes = [...new Set(Object.values(manifest))];
    const byHash = new Map();
    for (const [p, content] of withPlatform) {
      if (SKIP.test(p)) continue;
      byHash.set(manifest['/' + String(p).replace(/^\//, '')], { path: p, content });
    }
    // 1) short-lived upload token
    const tok = await this.api(`/accounts/${this.accountId}/pages/projects/${this.project}/upload-token`);
    if (!tok.json?.result?.jwt) throw new Error(`Upload token failed: ${JSON.stringify(tok.json).slice(0, 200)}`);
    const jwt = tok.json.result.jwt;
    // 2) upload only missing assets (dedupe by content hash across deploys)
    const missing = await this.api('/pages/assets/check-missing', { method: 'POST', body: hashes, jwt });
    const needed = new Set(missing.json?.result || []);
    let uploaded = 0;
    for (const hash of needed) {
      const f = byHash.get(hash);
      if (!f) continue;
      const buf = typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content;
      const up = await this.api('/pages/assets/upload', {
        method: 'POST',
        jwt,
        body: [{ base64: true, key: hash, metadata: { contentType: contentTypeOf(f.path) }, value: buf.toString('base64') }],
      });
      if (!up.json?.success) throw new Error(`Asset upload failed for ${f.path}: ${JSON.stringify(up.json).slice(0, 200)}`);
      uploaded++;
    }
    // 3) create the deployment (atomic publish)
    const dep = await this.api(`/accounts/${this.accountId}/pages/projects/${this.project}/deployments`, {
      method: 'POST',
      body: { manifest: JSON.stringify(manifest) },
    });
    if (!dep.json?.success) throw new Error(`Deployment failed: ${JSON.stringify(dep.json).slice(0, 300)}`);
    const url = dep.json.result?.url || `https://${this.project}.pages.dev`;
    return { ok: true, provider: this.name, url, deploymentId: dep.json.result?.id, filesUploaded: uploaded, filesTotal: hashes.length };
  }

  async rollback() {
    // Pages keeps every deployment, but point-in-time content restore goes through our
    // snapshot flow (same as S3): node tools/deploy.mjs --rollback=<version>, then deploy.
    return { ok: false, error: 'Use snapshot rollback: node tools/deploy.mjs --rollback=<version> with DEPLOY_TARGET=cloudflare.' };
  }
}

function contentTypeOf(p) {
  const ext = String(p).split('.').pop().toLowerCase();
  return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', webmanifest: 'application/manifest+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon' })[ext] || 'application/octet-stream';
}
