import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, uniqueSlug, fnv1aHex, readingTimeMinutes, isValidSlug, isValidUrl } from '../src/core/utils/utils.js';
import { markdownToHtml, htmlToMarkdown } from '../src/core/utils/markdown.js';

describe('utils: slug', () => {
  it('slugifies titles', () => {
    assert.equal(slugify('AWS Lambda Guide!'), 'aws-lambda-guide');
    assert.equal(slugify('  Hello   World  '), 'hello-world');
    assert.equal(slugify(''), 'untitled');
  });
  it('rejects bad slugs / makes unique', () => {
    assert.ok(isValidSlug('aws-lambda-guide'));
    assert.ok(!isValidSlug('AWS_Bad slug!'));
    assert.equal(uniqueSlug('Hello', ['hello', 'hello-2']), 'hello-3');
  });
});

describe('utils: hash/time', () => {
  it('fnv1a is deterministic', () => {
    assert.equal(fnv1aHex('abc'), fnv1aHex('abc'));
    assert.notEqual(fnv1aHex('abc'), fnv1aHex('abd'));
  });
  it('reading time floors at 1', () => {
    assert.equal(readingTimeMinutes(''), 1);
    assert.ok(readingTimeMinutes('word '.repeat(400)) >= 2);
  });
  it('rejects javascript: urls', () => {
    assert.ok(!isValidUrl('javascript:alert(1)'));
    assert.ok(isValidUrl('https://www.ayodhyya.com/a/'));
    assert.ok(isValidUrl('/articles/x/'));
  });
});

describe('markdown', () => {
  it('converts headings, bold, links, lists', () => {
    const html = markdownToHtml('# Hi\n\nHello **bold** and [link](/a/).\n\n- one\n- two');
    assert.match(html, /<h1>Hi<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<a href="\/a\/"/);
    assert.match(html, /<ul>/);
  });
  it('round-trips simple html', () => {
    assert.match(htmlToMarkdown('<h1>T</h1><p>Hello <strong>there</strong></p>'), /# T/);
  });
});
