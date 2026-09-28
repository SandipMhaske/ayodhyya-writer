import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/storage/repository.js';
import { CommentService, InsightsService, WxrService } from '../src/core/services/services.js';
import { scoreSpam } from '../src/security/spam.js';
import { consentBlock } from '../src/builder/generator.js';
import { parseWxr, wxrSummary } from '../src/core/utils/wxr.js';

const WXR = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
xmlns:content="http://purl.org/rss/1.0/modules/content/"
xmlns:dc="http://purl.org/dc/elements/1.1/"
xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Old Blog</title>
<wp:author><wp:author_login>jane</wp:author_login><wp:author_display_name><![CDATA[Jane Doe]]></wp:author_display_name></wp:author>
<item><title>Hello WP</title><link>https://old.example/hello/</link><pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
<dc:creator><![CDATA[jane]]></dc:creator>
<content:encoded><![CDATA[<p>Real content here with enough words to publish.</p><script>evil()</script>]]></content:encoded>
<excerpt:encoded><![CDATA[Short excerpt.]]></excerpt:encoded>
<wp:post_type>post</wp:post_type><wp:status>publish</wp:status>
<category domain="category" nicename="news"><![CDATA[News]]></category>
<category domain="post_tag" nicename="intro"><![CDATA[Intro]]></category></item>
<item><title>Draft Page</title><wp:post_type>page</wp:post_type><wp:status>draft</wp:status>
<content:encoded><![CDATA[<p>Page body.</p>]]></content:encoded></item>
<item><title>Nav Menu Item</title><wp:post_type>nav_menu_item</wp:post_type><wp:status>publish</wp:status></item>
</channel></rss>`;

describe('spam scoring', () => {
  it('separates ham, review, and spam', () => {
    assert.equal(scoreSpam({ author: 'Amy', content: '<p>Great post, thanks for writing this up!</p>' }).verdict, 'ham');
    const rev = scoreSpam({ author: 'x', content: 'Nice! https://spam.example/deal for cheap VIAGRA pills' });
    assert.equal(rev.verdict, 'review');
    const spam = scoreSpam({ author: 'http://spam.example', content: 'BUY VIAGRA CHEAP https://a.example https://b.example https://c.example casino FREE IPHONE' });
    assert.equal(spam.verdict, 'spam');
    assert.ok(spam.reasons.length >= 3);
  });
  it('auto-spams blatant junk on add, keeps the audit trail', async () => {
    const repo = new MemoryStore();
    const junk = await CommentService.add(repo, 's1', { articleSlug: 'a', author: 'x', content: 'casino loans viagra https://a.x https://b.x https://c.x' });
    assert.equal(junk.status, 'Spam');
    assert.ok(typeof junk.spamScore === 'number' && junk.spamScore >= 80);
    const okc = await CommentService.add(repo, 's1', { articleSlug: 'a', author: 'Amy', content: '<p>Thoughtful reply here.</p>' });
    assert.equal(okc.status, 'Pending');
  });
});

describe('insights', () => {
  it('computes local stats without tracking', () => {
    const r = InsightsService.summarize({
      articles: [
        { status: 'Published', wordCount: 400, readingTime: 2, publishDate: new Date().toISOString(), categoryIds: ['c1'] },
        { status: 'Draft', wordCount: 100, readingTime: 1, categoryIds: [] },
      ],
      comments: [{ status: 'Approved' }, { status: 'Pending' }, { status: 'Spam' }],
      subscribers: [{ status: 'Active' }, { status: 'Unsubscribed' }],
      categories: [{ id: 'c1', name: 'News' }],
      deployments: [{}, {}],
    });
    assert.equal(r.published, 1);
    assert.equal(r.drafts, 1);
    assert.equal(r.totalWords, 400);
    assert.equal(r.commentsApproved, 1);
    assert.equal(r.subscribers, 1);
    assert.equal(r.deployments, 2);
    assert.deepEqual(r.perCategory, [{ name: 'News', count: 1 }]);
    assert.equal(r.perWeek.length, 8);
    assert.ok(r.streakWeeks >= 1, 'this-week post counts as streak');
  });
});

describe('consent banner', () => {
  it('renders only when enabled, text escaped', () => {
    assert.equal(consentBlock({}), '');
    assert.equal(consentBlock({ privacy: { cookie: { enabled: false } } }), '');
    const html = consentBlock({ privacy: { cookie: { enabled: true, text: 'We use <b>cookies</b>.' } } });
    assert.ok(html.includes('id="cookiebanner"') && html.includes('data-consent="ok"'));
    assert.ok(html.includes('We use &lt;b&gt;cookies&lt;/b&gt;.'), 'owner text still escaped');
  });
});

describe('wxr import', () => {
  it('parses authors, posts, pages; skips nav items; maps status', () => {
    const parsed = parseWxr(WXR);
    assert.equal(parsed.authors[0].name, 'Jane Doe');
    assert.equal(parsed.items.length, 2, 'nav_menu_item skipped');
    assert.equal(parsed.items[0].status, 'Published');
    assert.equal(parsed.items[1].status, 'Draft');
    assert.deepEqual(parsed.items[0].categories, ['News']);
    assert.deepEqual(parsed.items[0].tags, ['Intro']);
    assert.deepEqual(wxrSummary(parsed), { posts: 1, pages: 1, authors: 1 });
    assert.throws(() => parseWxr('<html>nope</html>'), /Not a WordPress export/);
  });
  it('imports through domain services (sanitized, linked, audited)', async () => {
    const repo = new MemoryStore();
    const counts = await WxrService.importParsed(repo, 's1', parseWxr(WXR));
    assert.deepEqual(counts, { articles: 1, pages: 1 });
    const arts = await repo.query('articles', (a) => a.siteId === 's1');
    assert.equal(arts.length, 1);
    assert.ok(!arts[0].content.includes('<script>'), 'imported content sanitized');
    assert.equal(arts[0].canonicalUrl, 'https://old.example/hello/', 'source canonical kept');
    assert.ok(arts[0].authorId, 'author created and linked');
    assert.equal((await repo.query('categories', () => true)).length, 1);
    assert.equal((await repo.query('tags', () => true)).length, 1);
    assert.ok((await repo.all('audit')).some((e) => e.action === 'wxr.import'));
  });
});
