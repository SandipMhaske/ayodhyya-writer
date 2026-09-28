import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addHeadingIds, tocFor } from '../src/builder/generator.js';

describe('table of contents', () => {
  it('slugs ids with dedupe and leaves other markup alone', () => {
    const out = addHeadingIds('<h2>Hello World</h2><p>x</p><h2>Hello World</h2><h3>Detail &amp; More</h3>');
    assert.ok(out.includes('<h2 id="hello-world">Hello World</h2>'));
    assert.ok(out.includes('<h2 id="hello-world-2">'), 'duplicate headings numbered');
    assert.ok(out.includes('<p>x</p>'), 'non-headings untouched');
  });
  it('builds a nested nav, empty when too few headings', () => {
    assert.equal(tocFor('<h2>Only one</h2>'), '');
    const toc = tocFor('<h2 id="a">Alpha</h2><h3 id="b">Beta</h3>');
    assert.match(toc, /<nav class="toc"/);
    assert.match(toc, /<li class="toc-3"><a href="#b">Beta<\/a><\/li>/);
  });
  it('escapes heading text in anchors', () => {
    const toc = tocFor(addHeadingIds('<h2>A & B</h2><h2>Second</h2>'));
    assert.ok(!toc.includes('A & B</a>'), 'raw ampersand never emitted');
    assert.ok(toc.includes('A &amp; B</a>'));
  });
});
