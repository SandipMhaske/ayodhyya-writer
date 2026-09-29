import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSite, analyticsHead, adsenseBlock } from '../src/builder/generator.js';
import { requiredExtraHosts } from '../src/security/uploads.js';
import { loadTemplateFiles } from '../tools/lib.mjs';
import seed from '../seed/seed-data.json' with { type: 'json' };

const mkArticles = (n) => Array.from({ length: n }, (_, i) => ({
  id: `a${i}`, siteId: 'site_ayodhyya', title: `Post ${i}`, slug: `post-${i}`, excerpt: 'e',
  content: '<p>body text here for weight</p>', contentFormat: 'html', status: 'Published',
  publishDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  categoryIds: [], tagIds: [], revision: 1, lastDeployedRevision: 0, readingTime: 1, wordCount: 10,
}));
const base = { site: seed.sites[0], pages: [], categories: [], tags: [], authors: [], media: [], comments: [], template: loadTemplateFiles('default') };

describe('pagination', () => {
  it('splits archives with correct links, robots, canonicals, sitemap', async () => {
    const site = { ...seed.sites[0], postsPerPage: 10 };
    const { files } = await generateSite({ ...base, site, articles: mkArticles(25) });
    assert.ok(files.has('index.html') && files.has('page/2/index.html') && files.has('page/3/index.html'));
    assert.ok(!files.has('page/4/index.html'));
    const p2 = files.get('page/2/index.html');
    assert.ok(p2.includes('href="/"') && p2.includes('href="/page/3/"'), 'newer links home, older links forward');
    assert.ok(p2.includes('noindex,follow'), 'archive pages kept out of the index');
    assert.ok(p2.includes('canonical') && p2.includes('/page/2/'));
    assert.ok(files.get('sitemap.xml').includes('/page/2/'), 'archive pages in sitemap');
    const p1 = files.get('index.html');
    assert.ok(p1.includes('href="/page/2/"') && !p1.includes('noindex'), 'homepage links forward, stays indexed');
  });
  it('single page output when everything fits', async () => {
    const { files } = await generateSite({ ...base, articles: mkArticles(3) });
    assert.ok(![...files.keys()].some((k) => k.startsWith('page/')), 'no archive pages needed');
  });
});

describe('analytics + adsense', () => {
  it('emits provider snippets only when fully configured', () => {
    assert.equal(analyticsHead({}), '');
    assert.equal(analyticsHead({ analytics: { provider: 'none' } }), '');
    assert.equal(analyticsHead({ analytics: { provider: 'ga4' } }), '', 'ga4 needs an id');
    assert.ok(analyticsHead({ analytics: { provider: 'ga4', measurementId: 'G-ABC' } }).includes('googletagmanager.com'));
    assert.ok(analyticsHead({ analytics: { provider: 'plausible', domain: 'x.com' } }).includes('data-domain="x.com"'));
    assert.equal(analyticsHead({ analytics: { provider: 'umami', measurementId: 'id' } }), '', 'umami needs a host');
    assert.ok(analyticsHead({ analytics: { provider: 'umami', measurementId: 'id', host: 'https://a.example' } }).includes('data-website-id="id"'));
  });
  it('renders only configured ad placements', () => {
    const site = { adsense: { publisherId: 'ca-pub-1', slots: { 'before-article': '111' } } };
    assert.ok(adsenseBlock(site, 'before-article').includes('data-ad-slot="111"'));
    assert.equal(adsenseBlock(site, 'sidebar'), '', 'unconfigured placement renders nothing');
    assert.equal(adsenseBlock({ adsense: {} }, 'before-article'), '', 'no publisher id, no ads');
  });
  it('lists exact third-party hosts for the CSP parameter', () => {
    assert.deepEqual(requiredExtraHosts({}), []);
    assert.ok(requiredExtraHosts({ adsense: { publisherId: 'ca-pub-1' } }).includes('https://pagead2.googlesyndication.com'));
    assert.ok(requiredExtraHosts({ analytics: { provider: 'ga4' } }).includes('https://www.googletagmanager.com'));
    assert.deepEqual(requiredExtraHosts({ analytics: { provider: 'umami', host: 'https://a.example/' } }), ['https://a.example']);
  });
});

describe('discovery tags + brand assets', () => {
  it('every page carries favicon and feed autodiscovery', async () => {
    const { files } = await generateSite({ ...base, articles: mkArticles(2) });
    for (const [p, c] of files) {
      if (!p.endsWith('.html')) continue;
      assert.ok(c.includes('rel="icon" href="/favicon.svg"'), `${p} favicon`);
      assert.ok(c.includes('rel="alternate" type="application/rss+xml"'), `${p} feed link`);
    }
  });
  it('publishes favicon.svg from project icons', async () => {
    const { publishBrandAssets } = await import('../tools/lib.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-brand-'));
    const dist = path.join(dir, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    assert.equal(publishBrandAssets(dist), 1);
    assert.ok(fs.readFileSync(path.join(dist, 'favicon.svg'), 'utf8').includes('<svg'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
