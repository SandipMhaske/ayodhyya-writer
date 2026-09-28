import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { minifyHtml, minifyCss, minifyJs, fingerprintName, shouldCompress, compressBuffer } from '../src/optimizer/optimizer.js';
import { validateArticle, validateBuildOutput, validateInternalLinks, validateRedirects } from '../src/core/validators/validators.js';

describe('optimizer', () => {
  it('minifies html/css/js', () => {
    assert.ok(minifyHtml('<!-- c --><p>  hi </p>').length < '<!-- c --><p>  hi </p>'.length);
    assert.equal(minifyCss('a { color : red; }'), 'a{color:red}');
    assert.ok(minifyJs('// c\nvar x = 1;').length < 15);
  });
  it('compresses gzip/brotli/zstd with real byte savings', async () => {
    const text = 'hello world '.repeat(500);
    for (const enc of ['gzip', 'br', 'zstd']) {
      const out = await compressBuffer(text, enc);
      if (!out) { assert.ok(enc === 'zstd', 'only zstd may be unavailable'); continue; }
      assert.ok(out.bytes.length < Buffer.byteLength(text), `${enc} shrinks text`);
    }
    const z = await compressBuffer(text, 'zstd');
    if (z) {
      const { zstdDecompressSync } = await import('node:zlib');
      assert.equal(zstdDecompressSync(z.bytes).toString('utf8'), text);
      const g = await compressBuffer(text, 'gzip');
      assert.ok(z.bytes.length <= g.bytes.length, 'zstd beats gzip on text');
    }
  });
  it('fingerprints + skips recompressing media', () => {
    assert.match(fingerprintName('style.css', 'abc'), /^style\.[a-f0-9]{6}\.css$/);
    assert.ok(!shouldCompress('photo.webp'));
    assert.ok(shouldCompress('index.html'));
  });
});

describe('validators', () => {
  it('blocks publish on missing title/slug/empty content', () => {
    const r = validateArticle({ title: '', slug: '', content: '', status: 'Published' }, { takenSlugs: [] });
    assert.ok(!r.ok && r.errors.length >= 2);
  });
  it('flags duplicate slugs', () => {
    const r = validateArticle({ title: 'T', slug: 'a', content: 'x', status: 'Draft' }, { takenSlugs: ['a', 'a'] });
    assert.ok(r.errors.some((e) => e.code === 'duplicate-slug'));
  });
  it('requires a parseable date for Scheduled', () => {
    const base = { title: 'T', slug: 't', content: 'x', status: 'Scheduled' };
    assert.ok(validateArticle(base, {}).errors.some((e) => e.code === 'scheduled-no-date'));
    assert.ok(validateArticle({ ...base, publishDate: 'not-a-date' }, {}).errors.some((e) => e.code === 'scheduled-bad-date'));
    assert.ok(validateArticle({ ...base, publishDate: '2026-01-01T00:00:00.000Z' }, {}).ok);
  });
  it('catches broken internal links, tolerates the rest', () => {
    const files = new Map([
      ['index.html', '<a href="/about/">a</a><a href="/missing/">b</a><a href="https://ext.com/x">c</a><a href="#frag">d</a><a href="mailto:a@b.c">e</a><a href="/rss.xml?v=2">f</a>'],
      ['about/index.html', 'x'],
      ['rss.xml', 'x'],
    ]);
    assert.deepEqual(validateInternalLinks(files), [{ page: 'index.html', link: '/missing/' }]);
  });
  it('requires build outputs', () => {
    const r = validateBuildOutput(new Map([['index.html', 'x']]));
    assert.ok(!r.ok, 'missing sitemap/robots flagged');
  });
  it('warns on schema types missing their data, budgets on heavy files', () => {
    const a = { title: 'T', slug: 't', content: '<p>x</p>', status: 'Draft', schemaType: 'HowTo', howToSteps: [] };
    assert.ok(validateArticle(a, {}).warnings.some((w) => w.code === 'howto-no-steps'));
    const b = { ...a, schemaType: 'FAQPage', faqItems: [{ question: 'Q?' }] };
    assert.ok(validateArticle(b, {}).warnings.some((w) => w.code === 'faq-no-qa'));
    const fat = new Map([['index.html', 'x'.repeat(200_000)], ['sitemap.xml', 'x'], ['robots.txt', 'x'], ['rss.xml', 'x'], ['404.html', 'x'], ['search-index.json', 'x']]);
    const r = validateBuildOutput(fat);
    assert.ok(r.ok, 'budgets warn, never block');
    assert.ok(r.warnings.some((w) => w.code === 'over-budget' && w.message.includes('index.html')));
  });
  it('validates redirect targets (open-redirect surface)', () => {
    assert.ok(validateRedirects({ redirects: [{ from: '/old/', to: '/new/', code: 301 }] }).ok);
    const bad = validateRedirects({ redirects: [
      { from: 'noleadingslash', to: '/x/' },
      { from: '/a/', to: 'javascript:alert(1)' },
      { from: '/b/', to: '/x/\r\nSet-Cookie: evil' },
      { from: '/c/', to: '/y/', code: 999 },
    ] });
    assert.equal(bad.errors.length, 4);
    const ext = validateRedirects({ redirects: [{ from: '/o/', to: 'https://other.example/' }] });
    assert.ok(ext.ok && ext.warnings.some((w) => w.code === 'redirect-external'));
  });
});
