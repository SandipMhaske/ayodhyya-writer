import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/storage/repository.js';
import { CommentService, SubscriberService } from '../src/core/services/services.js';
import { commentsSection, newsletterBlock } from '../src/builder/generator.js';

describe('comments', () => {
  it('sanitizes on input, holds Pending, gates rendering on approval', async () => {
    const repo = new MemoryStore();
    const c = await CommentService.add(repo, 's1', { articleSlug: 'hello', author: 'Spammer', content: '<p>Nice!</p><script>evil()</script>' });
    assert.equal(c.status, 'Pending');
    assert.ok(!c.content.includes('<script>'));
    assert.ok(c.content.includes('Nice!'));
    assert.equal((await CommentService.approvedFor(repo, 's1', 'hello')).length, 0);
    assert.equal(await CommentService.pendingCount(repo, 's1'), 1);
    await CommentService.setStatus(repo, c.id, 'Approved');
    assert.equal((await CommentService.approvedFor(repo, 's1', 'hello')).length, 1);
    await assert.rejects(CommentService.setStatus(repo, c.id, 'Published'), /Bad comment status/);
    await assert.rejects(CommentService.add(repo, 's1', { articleSlug: 'hello', content: '   ' }), /empty/);
  });

  it('renders only approved comments with counts, form gated by endpoint', () => {
    const site = { comments: { enabled: true, endpoint: 'https://forms.example/c' } };
    const comments = [
      { articleSlug: 'hello', author: 'Amy', content: '<p>Great post</p>', status: 'Approved', createdAt: '2026-01-02' },
      { articleSlug: 'hello', author: 'Bot', content: '<p>spam</p>', status: 'Pending', createdAt: '2026-01-03' },
    ];
    const html = commentsSection({ site, slug: 'hello', comments });
    assert.match(html, /Comments \(1\)/);
    assert.ok(html.includes('Amy') && html.includes('Great post'));
    assert.ok(!html.includes('Bot'));
    assert.ok(html.includes('action="https://forms.example/c"') && html.includes('name="slug"'));
    const off = commentsSection({ site: { comments: { enabled: false } }, slug: 'hello', comments });
    assert.ok(off.includes('Amy') && !off.includes('<form'), 'disabled hides the form, keeps published comments');
    const noEndpoint = commentsSection({ site: { comments: { enabled: true, endpoint: '' } }, slug: 'hello', comments: [] });
    assert.equal(noEndpoint, '', 'nothing to show and nowhere to post = no section');
  });
});

describe('newsletter', () => {
  it('validates email, dedupes, exports portable CSV', async () => {
    const repo = new MemoryStore();
    await assert.rejects(SubscriberService.add(repo, 's1', { email: 'not-an-email' }), /valid email/);
    const s = await SubscriberService.add(repo, 's1', { email: 'Amy@Example.COM', name: 'Amy "A"' });
    assert.equal(s.email, 'amy@example.com');
    assert.equal((await SubscriberService.add(repo, 's1', { email: 'amy@example.com' })).id, s.id, 'returns existing on dupe');
    await SubscriberService.setStatus(repo, s.id, 'Unsubscribed');
    const csv = SubscriberService.toCsv(await repo.all('subscribers'));
    assert.ok(csv.startsWith('email,name,status,source,subscribed_at\n'));
    assert.ok(csv.includes('"amy@example.com","Amy ""A""","Unsubscribed"'), 'RFC-4180 quoting');
  });

  it('renders signup block only when enabled', () => {
    assert.equal(newsletterBlock({}), '');
    const on = newsletterBlock({ newsletter: { enabled: true, endpoint: 'https://x.example/sub', heading: 'Updates', text: 'Monthly.' } });
    assert.ok(on.includes('action="https://x.example/sub"') && on.includes('type="email"') && on.includes('Monthly.'));
    const soon = newsletterBlock({ newsletter: { enabled: true, endpoint: '', heading: 'Updates' } });
    assert.ok(soon.includes('opening soon') && !soon.includes('<form'));
  });
});
