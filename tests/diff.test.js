import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffRevision, renderDiff } from '../src/core/utils/diff.js';

describe('revision diff', () => {
  it('identical content yields all-same, zero counts', () => {
    const r = diffRevision('<p>Hello world</p>', '<p>Hello world</p>');
    assert.equal(r.added, 0);
    assert.equal(r.removed, 0);
    assert.ok(!r.capped);
    assert.ok(r.segments.length > 0 && r.segments.every((s) => s.type === 'same'));
  });
  it('finds word insertions and deletions', () => {
    const r = diffRevision('<p>The quick brown fox</p>', '<p>The quick red fox jumps</p>');
    assert.ok(r.added > 0 && r.removed > 0);
    const html = renderDiff(r.segments);
    assert.ok(html.includes('<ins>') && html.includes('<del>'));
    assert.ok(html.includes('red') && html.includes('brown'));
  });
  it('escapes markup in rendered output', () => {
    const r = diffRevision('<p>old</p>', '<p><script>alert(1)</script>new</p>');
    const html = renderDiff(r.segments);
    assert.ok(!html.includes('<script>'), 'no live tags in diff output');
    assert.ok(html.includes('&lt;script&gt;') || html.includes('new'));
  });
  it('handles empty inputs without crashing', () => {
    assert.deepEqual(diffRevision('', '').segments, []);
    assert.ok(diffRevision('', '<p>all new content here</p>').added > 0);
    assert.ok(diffRevision('<p>gone</p>', '').removed > 0);
  });
  it('stays bounded on large articles', () => {
    const big = ('Word '.repeat(400) + '\n').repeat(30); // 12k words
    const t0 = Date.now();
    const r = diffRevision(big, big.replace(/Word/g, 'Term'));
    assert.ok(Date.now() - t0 < 5000, 'completes in reasonable time');
    assert.ok(r.added > 0);
  });
});
