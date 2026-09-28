import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, validateTemplate } from '../src/templates/engine.js';
import { seoHead, articleJsonLd, buildSitemap, buildSitemapIndex, paginateSitemap, buildRss, buildRobots } from '../src/seo/seo.js';

describe('template engine', () => {
  it('interpolates escaped + raw vars', () => {
    assert.equal(renderTemplate('<h1>{{site.name}}</h1><div>{{{article.content}}}</div>', { site: { name: 'A&B' }, article: { content: '<p>x</p>' } }),
      '<h1>A&amp;B</h1><div><p>x</p></div>');
  });
  it('validates packages', () => {
    const r = validateTemplate({ name: 't', files: { 'index.html': 'x' } });
    assert.ok(!r.ok, 'missing files flagged');
  });
});

describe('seo engine', () => {
  it('emits head with canonical + robots', () => {
    const h = seoHead({ site: { name: 'S' }, title: 'T', description: 'D', canonical: 'https://x.com/a/', robots: 'index,follow' });
    assert.match(h, /<title>T<\/title>/);
    assert.match(h, /canonical/);
  });
  it('never emits invalid json-ld', () => {
    assert.equal(articleJsonLd({ site: {}, article: { title: '' } }), null);
    assert.ok(articleJsonLd({ site: { name: 'S' }, article: { title: 'T' }, url: 'https://x/' })['@context']);
  });
  it('emits valid HowTo/FAQ markup, falls back safely when empty', () => {
    const how = articleJsonLd({ site: {}, article: { title: 'T', schemaType: 'HowTo', howToSteps: [{ name: 'Prep', text: 'Do the thing.' }] }, url: 'https://x/' });
    assert.equal(how['@type'], 'HowTo');
    assert.equal(how.step[0]['@type'], 'HowToStep');
    const faq = articleJsonLd({ site: {}, article: { title: 'T', schemaType: 'FAQPage', faqItems: [{ question: 'Q?', answer: 'A.' }] }, url: 'https://x/' });
    assert.equal(faq['@type'], 'FAQPage');
    assert.equal(faq.mainEntity[0]['@type'], 'Question');
    assert.equal(articleJsonLd({ site: {}, article: { title: 'T', schemaType: 'HowTo', howToSteps: [] }, url: 'https://x/' })['@type'], 'BlogPosting');
    assert.equal(articleJsonLd({ site: {}, article: { title: 'T', schemaType: 'FAQPage', faqItems: [] }, url: 'https://x/' })['@type'], 'BlogPosting');
    assert.equal(articleJsonLd({ site: {}, article: { title: 'T', schemaType: 'Bogus' }, url: 'https://x/' })['@type'], 'BlogPosting');
  });
  it('builds sitemap/rss/robots', () => {
    assert.match(buildSitemap([{ loc: 'https://x.com/' }]), /urlset/);
    assert.match(buildRss({ site: { name: 'S', url: 'https://x.com' }, articles: [] }), /<rss/);
    assert.match(buildRobots({ site: { url: 'https://x.com' } }), /Sitemap:/);
  });
  it('builds scoped category feeds', async () => {
    const a1 = { title: 'A1', slug: 'a1', excerpt: '', status: 'Published', publishDate: '2026-01-01' };
    const a2 = { title: 'A2', slug: 'a2', excerpt: '', status: 'Draft' };
    const feed = buildRss({ site: { name: 'S', url: 'https://x.com' }, articles: [a1, a2], title: 'Cat — S', link: 'https://x.com/category/cat/' });
    assert.ok(feed.includes('<title>Cat — S</title>'), 'scoped channel title');
    assert.ok(feed.includes('a1') && !feed.includes('a2'), 'only live items in scope');
    const { generateSite } = await import('../src/builder/generator.js');
    const { loadTemplateFiles } = await import('../tools/lib.mjs');
    const seed = await import('../seed/seed-data.json', { with: { type: 'json' } }).then((m) => m.default);
    const { files } = await generateSite({ site: seed.sites[0], articles: seed.articles, pages: [], categories: seed.categories, tags: seed.tags, authors: seed.authors, media: [], comments: [], template: loadTemplateFiles('default') });
    assert.ok(files.get('category/aws/rss.xml').includes('aws-lambda-guide'), 'category feed generated');
    assert.ok(!files.has('category/web/rss.xml'), 'empty categories get no feed');
  });
  it('paginates large sitemaps with an index, single file when small', () => {
    const urls = Array.from({ length: 5 }, (_, i) => ({ loc: `https://x.com/${i}/` }));
    const small = paginateSitemap(urls);
    assert.equal(small.length, 1);
    assert.equal(small[0].name, 'sitemap.xml');
    assert.ok(!small[0].index);
    const big = paginateSitemap(urls, 2);
    assert.deepEqual(big.map((p) => p.name), ['sitemap-1.xml', 'sitemap-2.xml', 'sitemap-3.xml']);
    assert.ok(big.every((p) => p.index));
    const idx = buildSitemapIndex('https://x.com', big);
    assert.match(idx, /<sitemapindex/);
    assert.match(idx, /sitemap-2\.xml/);
  });
  it('generator emits index once over the page size', async () => {
    const { generateSite } = await import('../src/builder/generator.js');
    const { loadTemplateFiles } = await import('../tools/lib.mjs');
    const seed = await import('../seed/seed-data.json', { with: { type: 'json' } }).then((m) => m.default);
    const input = { site: seed.sites[0], articles: seed.articles, pages: seed.pages, categories: seed.categories, tags: seed.tags, authors: seed.authors, media: [], template: loadTemplateFiles('default') };
    const few = await generateSite(input);
    assert.ok(few.files.has('sitemap.xml'));
    assert.ok(![...few.files.keys()].some((k) => k.startsWith('sitemap-')));
    const many = await generateSite(input, { sitemapPerPage: 2 });
    assert.match(many.files.get('sitemap.xml'), /<sitemapindex/);
    assert.ok(many.files.has('sitemap-1.xml'));
  });
});
