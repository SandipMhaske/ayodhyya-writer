import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shareBlock, relatedArticles, prevNext, relatedBlock, prevNextBlock } from '../src/builder/generator.js';

const mk = (slug, date, cats = [], tags = []) => ({ slug, title: `Title ${slug} <b>`, excerpt: 'e', publishDate: date, createdAt: date, categoryIds: cats, tagIds: tags });
const pub = [
  mk('one', '2026-01-01', ['c1'], ['t1', 't2']),
  mk('two', '2026-02-01', ['c1'], ['t2']),
  mk('three', '2026-03-01', ['c2'], ['t9']),
  mk('four', '2026-04-01', ['c1'], []),
];

describe('reading ux', () => {
  it('share block encodes URLs and escapes titles, no JS required for links', () => {
    const html = shareBlock({ url: 'https://x.com/articles/a/?y=1', title: 'A "quoted" title' });
    assert.ok(html.includes('twitter.com%2Fintent') === false, 'no double-encoding slip');
    assert.ok(html.includes(encodeURIComponent('https://x.com/articles/a/?y=1')));
    assert.ok(html.includes('A &quot;quoted&quot; title'), 'title escaped in data attributes');
    assert.ok(!html.includes('<script'), 'links work without scripts');
    assert.ok(html.includes('data-share="copy"') && html.includes('data-share="native"'), 'enhancement hooks present');
    assert.ok(html.includes('rel="noopener"'), 'share links hardened');
  });
  it('ranks related by category then tags, excludes self, caps count', () => {
    const rel = relatedArticles(pub[0], pub, 2);
    assert.deepEqual(rel.map((a) => a.slug), ['two', 'four'], 'same-category first, then recency among ties');
    assert.ok(!rel.some((a) => a.slug === 'one'), 'never recommends itself');
    assert.ok(!rel.some((a) => a.slug === 'three'), 'unrelated excluded');
  });
  it('finds chronological neighbors with edge handling', () => {
    assert.deepEqual([prevNext(pub[0], pub).prev, prevNext(pub[0], pub).next?.slug], [null, 'two']);
    assert.equal(prevNext(pub[3], pub).next, null);
    assert.deepEqual(prevNext({ slug: 'ghost' }, pub), { prev: null, next: null });
    const empty = prevNextBlock({ prev: null, next: null });
    assert.equal(empty, '');
    assert.ok(prevNextBlock({ prev: pub[0], next: null }).includes('/articles/one/'));
  });
  it('related block renders nothing when empty', () => {
    assert.equal(relatedBlock([]), '');
    assert.ok(relatedBlock([pub[1]]).includes('/articles/two/'));
  });
  it('exposes reading time on cards and article bylines', async () => {
    const { generateSite } = await import('../src/builder/generator.js');
    const { loadTemplateFiles } = await import('../tools/lib.mjs');
    const seed = await import('../seed/seed-data.json', { with: { type: 'json' } }).then((m) => m.default);
    const input = { site: seed.sites[0], articles: seed.articles, pages: seed.pages, categories: seed.categories, tags: seed.tags, authors: seed.authors, media: [], comments: [], template: loadTemplateFiles('default') };
    const { files } = await generateSite(input);
    assert.ok(files.get('index.html').includes('min read'), 'cards show reading time');
    assert.ok(files.get('articles/aws-lambda-guide/index.html').includes('min read'), 'byline shows reading time');
  });
});
