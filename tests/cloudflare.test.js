import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, pagesManifest, platformFiles, CloudflarePagesProvider } from '../src/deployment/cloudflare.js';

function mockFetch(log, uploaded) {
  return async (url, opts = {}) => {
    log.push({ url, method: opts.method || 'GET' });
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (url.endsWith('/upload-token')) return { status: 200, json: async () => ({ success: true, result: { jwt: 'jwt-1' } }) };
    if (url.endsWith('/check-missing')) {
      const missing = body.filter((h) => !uploaded.has(h));
      return { status: 200, json: async () => ({ success: true, result: missing }) };
    }
    if (url.endsWith('/assets/upload')) {
      for (const f of body) uploaded.add(f.key);
      return { status: 200, json: async () => ({ success: true }) };
    }
    if (url.endsWith('/deployments')) {
      assert.ok(body.manifest.includes('/index.html'), 'manifest carries paths');
      return { status: 200, json: async () => ({ success: true, result: { id: 'dep-1', url: 'https://proj.pages.dev' } }) };
    }
    throw new Error('unexpected call: ' + url);
  };
}

const site = { name: 'S', adsense: {}, redirects: [{ from: '/old/', to: '/new/', code: 301 }] };

describe('cloudflare provider', () => {
  it('md5 matches known vector', () => {
    assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  });
  it('manifest skips encoded variants and dotfiles, keeps platform files', () => {
    const m = pagesManifest(new Map([['index.html', 'a'], ['index.html.br', 'a'], ['app.js.zst', 'b'], ['.build-manifest.json', 'c'], ['_headers', 'd']]));
    assert.deepEqual(Object.keys(m), ['/index.html', '/_headers']);
  });
  it('platform files use native Pages syntax', () => {
    const pf = platformFiles(site);
    assert.match(pf.get('_headers'), /^\/\*\n  Content-Security-Policy: /m);
    assert.match(pf.get('_headers'), /\n  X-Content-Type-Options: nosniff(\n|$)/);
    assert.equal(pf.get('_redirects').trim(), '/old/ /new/ 301');
  });
  it('deploys via upload-token → missing-only upload → deployment', async () => {
    const log = [];
    const uploaded = new Set();
    const p = new CloudflarePagesProvider({ accountId: 'acc', project: 'proj', token: 'tok', fetchImpl: mockFetch(log, uploaded) });
    const files = new Map([['index.html', '<h1>hi</h1>'], ['style.css', 'a{}'], ['index.html.br', 'junk']]);
    const r1 = await p.deploy({ files, site });
    assert.ok(r1.ok && r1.url === 'https://proj.pages.dev');
    assert.equal(r1.filesUploaded, 4); // index + css + _headers + _redirects (.br skipped)
    const r2 = await p.deploy({ files, site });
    assert.equal(r2.filesUploaded, 0, 'second identical deploy uploads nothing');
    assert.ok(log.some((c) => c.url.includes('/upload-token')));
    assert.ok(log.some((c) => c.url.endsWith('/deployments') && c.method === 'POST'));
  });
  it('atomic model: no invalidation, Pages-managed caching, snapshot rollback', async () => {
    const p = new CloudflarePagesProvider({});
    assert.deepEqual(p.changedPaths(['index.html']), []);
    assert.equal(p.cacheControlFor('index.html'), null);
    const rb = await p.rollback();
    assert.ok(!rb.ok && /--rollback/.test(rb.error));
    await assert.rejects(() => p.deploy({ files: new Map(), site }), /CLOUDFLARE_API_TOKEN/);
  });
});
