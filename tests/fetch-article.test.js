import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchArticle, validateImportUrl } from '../src/core/utils/fetchArticle.js';

const PAGE = `<!doctype html><html><head><title>Fallback Title</title>
<meta property="og:title" content="OG Title Wins">
<meta property="og:description" content="OG excerpt here.">
<meta name="author" content="Jane Doe">
<meta property="article:published_time" content="2026-05-01T00:00:00.000Z">
<meta property="og:image" content="https://src.example/img.png">
</head><body>
<header><nav><a href="/menu">Menu</a></nav></header>
<script>steal(document.cookie)</script>
<article><h1>Hello World</h1><p>${'Body text here. '.repeat(40)}</p><img src="/pic.jpg" alt="pic"><a href="/rel">rel</a><iframe src="https://evil.example/x"></iframe></article>
<footer>bye</footer></body></html>`;

const mockFetch = (html = PAGE, ctype = 'text/html') => async () => ({
  ok: true,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? ctype : '') },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
});

describe('fetch-article', () => {
  it('extracts title, excerpt, author, date, image, canonical', async () => {
    const a = await fetchArticle('https://src.example/post/', { fetchImpl: mockFetch() });
    assert.equal(a.title, 'OG Title Wins');
    assert.equal(a.excerpt, 'OG excerpt here.');
    assert.equal(a.authorName, 'Jane Doe');
    assert.equal(a.publishDate, '2026-05-01T00:00:00.000Z');
    assert.equal(a.featuredImage, 'https://src.example/img.png');
    assert.equal(a.canonicalUrl, 'https://src.example/post/');
    assert.equal(a.slug, 'og-title-wins');
  });
  it('keeps article, drops chrome/scripts, absolutizes refs, sanitizes', async () => {
    const a = await fetchArticle('https://src.example/post/', { fetchImpl: mockFetch() });
    assert.ok(!a.content.includes('<script'), 'scripts never survive');
    assert.ok(!a.content.includes('steal'), 'script bodies gone');
    assert.ok(!a.content.includes('Menu'), 'nav chrome dropped');
    assert.ok(!a.content.includes('<iframe'), 'unapproved iframe host dropped');
    assert.ok(a.content.includes('src="https://src.example/pic.jpg"'), 'images absolutized');
    assert.ok(a.content.includes('href="https://src.example/rel"'), 'links absolutized');
  });
  it('lists absolute content images with alts, OG first, deduped', async () => {
    const html = PAGE.replace('</article>', '<img src="/pic.jpg" alt="dup"><img src="data:image/png;base64,xx" alt="inline"></article>');
    const a = await fetchArticle('https://src.example/post/', { fetchImpl: mockFetch(html) });
    assert.equal(a.images[0].src, 'https://src.example/img.png', 'OG image first');
    const pics = a.images.filter((i) => i.src === 'https://src.example/pic.jpg');
    assert.equal(pics.length, 1, 'duplicate img deduped');
    assert.equal(pics[0].alt, 'pic');
    assert.ok(a.images.every((i) => /^https?:/i.test(i.src)), 'only absolute http(s) candidates');
  });
  it('rejects SSRF targets and bad inputs', async () => {
    for (const u of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pass@example.com/', 'not a url']) {
      assert.ok(!validateImportUrl(u).ok, `blocked: ${u}`);
      await assert.rejects(fetchArticle(u, { fetchImpl: mockFetch() }), `fetch blocked: ${u}`);
    }
    assert.ok(validateImportUrl('http://localhost:8081/about/', { allowLocal: true }).ok, 'explicit --allow-local permits intranet/dev hosts');
  });
  it('rejects non-HTML, errors, empty pages, oversize bodies', async () => {
    await assert.rejects(fetchArticle('https://src.example/f.pdf', { fetchImpl: mockFetch('x', 'application/pdf') }), /Not an HTML/);
    await assert.rejects(fetchArticle('https://src.example/empty', { fetchImpl: mockFetch('<html><body><p>hi</p></body></html>') }), /No readable/);
    const miss = mockFetch('');
    await assert.rejects(fetchArticle('https://src.example/404', { fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => '' } }) }), /HTTP 404/);
    void miss;
    const big = 'x'.repeat(3_000_000);
    await assert.rejects(fetchArticle('https://src.example/big', { fetchImpl: mockFetch(big) }), /too large/);
  });
});
