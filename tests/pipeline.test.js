import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/storage/repository.js';
import { ArticleService } from '../src/core/services/services.js';
import { generateSite, diffManifest } from '../src/builder/generator.js';
import { loadTemplateFiles } from '../tools/lib.mjs';
import seed from '../seed/seed-data.json' with { type: 'json' };

function testInput() {
  const site = seed.sites[0];
  return {
    site,
    articles: seed.articles, pages: seed.pages, categories: seed.categories,
    tags: seed.tags, authors: seed.authors, media: [],
    template: loadTemplateFiles('default'),
  };
}

describe('integration: store → build pipeline', () => {
  it('creates/sanitizes article, detects pending changes', async () => {
    const repo = new MemoryStore();
    const a = await ArticleService.create(repo, 'site_ayodhyya', { title: 'Hello', content: '<p>x</p><script>evil()</script>' });
    assert.ok(!a.content.includes('<script'), 'sanitized on save');
    assert.equal((await ArticleService.pendingChanges(repo, 'site_ayodhyya')).length, 1);
  });

  it('generates full static site from seed', async () => {
    const { files, contentHash, publishedCount } = await generateSite(testInput());
    for (const must of ['index.html', 'sitemap.xml', 'robots.txt', 'rss.xml', '404.html', 'search-index.json', 'articles/aws-lambda-guide/index.html', 'about/index.html']) {
      assert.ok([...files.keys()].some((k) => k === must), `has ${must}`);
    }
    assert.ok(![...files.keys()].some((k) => k.includes('core-web-vitals-draft')), 'drafts excluded');
    assert.ok(contentHash.length >= 8);
    assert.equal(publishedCount, 1);
    assert.match(files.get('sitemap.xml'), /aws-lambda-guide/);
    assert.ok(!files.get('articles/aws-lambda-guide/index.html').includes('evil'), 'no unsanitized content');
  });

  it('incremental diff detects only changed files', async () => {
    const first = await generateSite(testInput());
    const hashes = {};
    for (const [p, c] of first.files) hashes[p] = 'h:' + String(c).length;
    const second = await generateSite({ ...testInput(), articles: [...testInput().articles, { ...testInput().articles[0], id: 'x', slug: 'new-post', title: 'New', status: 'Published', content: '<p>new</p>', categoryIds: [], tagIds: [] }] });
    const d = diffManifest({ hashes, files: first.files }, second);
    assert.ok(d.changed.includes('articles/new-post/index.html'), 'new article detected: ' + d.changed.join(','));
  });

  it('auto-publishes due scheduled articles, holds future ones', async () => {
    const base = testInput();
    const mk = (id, date) => ({ ...base.articles[0], id, slug: id, title: id, status: 'Scheduled', publishDate: date, content: '<p>timed</p>', categoryIds: [], tagIds: [] });
    const r = await generateSite(
      { ...base, articles: [...base.articles, mk('sched-past', '2020-01-01T00:00:00.000Z'), mk('sched-future', '2099-01-01T00:00:00.000Z')] },
      { now: '2026-06-01T00:00:00.000Z' }
    );
    assert.ok(r.files.has('articles/sched-past/index.html'), 'due scheduled article is live');
    assert.ok(![...r.files.keys()].some((k) => k.includes('sched-future')), 'future article withheld');
  });

  it('publishDue flips only past-due scheduled articles', async () => {
    const { ArticleService } = await import('../src/core/services/services.js');
    const repo = new MemoryStore();
    const past = await ArticleService.create(repo, 's1', { title: 'Past', content: '<p>x</p>', status: 'Scheduled', publishDate: '2020-01-01T00:00:00.000Z' });
    const future = await ArticleService.create(repo, 's1', { title: 'Future', content: '<p>x</p>', status: 'Scheduled', publishDate: '2099-01-01T00:00:00.000Z' });
    const flipped = await ArticleService.publishDue(repo, 's1', new Date('2026-06-01T00:00:00.000Z').getTime());
    assert.deepEqual(flipped, [past.slug]);
    assert.equal((await repo.get('articles', past.id)).status, 'Published');
    assert.equal((await repo.get('articles', future.id)).status, 'Scheduled');
    assert.ok((await repo.all('audit')).some((e) => e.action === 'articles.publishDue'), 'audit trail recorded');
  });

  it('emits a human-readable sitemap page mirroring the XML', async () => {
    const { files } = await generateSite(testInput());
    const page = files.get('sitemap/index.html');
    assert.ok(page, 'sitemap page generated');
    assert.ok(page.includes('/articles/aws-lambda-guide/'), 'article linked');
    assert.ok(page.includes('/about/'), 'static page linked');
    assert.ok((page.match(/<script/g) || []).length <= 1, 'at most the template asset script');
  });
});
