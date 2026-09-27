import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countSyllables, fleschReadingEase, fleschKincaidGrade, significantWords, analyzeSeo } from '../src/seo/analyzer.js';

const intro = 'Solar panels cut home power bills every month. ';
const filler = 'The sun gives free power all day. A crew fits the cabin roof in one day. '.repeat(28);
const mid = 'Many homes pick solar panels for clean power. Solar panels need little care. Most solar panels last past year twenty five. Good solar panels pay back in six summers. ';
const outro = 'Pick solar panels and start saving soon. ';
const good_body = `<p>${intro}${filler}</p><p>${mid}</p><p>${outro}Read our <a href="/about/">about page</a> and the <a href="https://example.com/ref">reference</a>.</p><img src="/a.png" alt="rooftop solar panels">`;
const good = {
  title: 'Solar Panels Guide for Homeowners in 2026',
  slug: 'solar-panels-guide',
  excerpt: 'A practical homeowner guide to rooftop solar panels, costs, installation steps, and expected savings in the first year of ownership.',
  content: good_body,
  metaTitle: 'Solar Panels Guide for Homeowners in 2026',
  metaDescription: 'A practical homeowner guide to rooftop solar panels, costs, installation steps, and expected savings in the first year of ownership here.',
  focusKeyword: 'solar panels',
  featuredImage: '/a.png',
  canonicalUrl: 'https://x.com/solar-panels-guide/',
};

describe('seo analyzer', () => {
  it('scores readable keyword-targeted content highly', () => {
    const r = analyzeSeo(good, { siteUrl: 'https://x.com' });
    assert.ok(r.score >= 80, `expected 80+, got ${r.score}: ` + JSON.stringify(r.checks.filter((c) => c.status !== 'pass').map((c) => c.id)));
    assert.equal(r.grade, 'Good');
    assert.ok(r.stats.wordCount > 300);
    assert.ok(r.stats.flesch > 50);
    assert.equal(r.stats.internalLinks, 1);
    assert.equal(r.stats.externalLinks, 1);
  });
  it('fails thin content without metadata', () => {
    const r = analyzeSeo({ title: 'Hi', slug: 'hi', content: '<p>Hi there.</p>' });
    assert.ok(r.score < 50, `expected <50, got ${r.score}`);
    assert.equal(r.grade, 'Poor');
    assert.ok(r.checks.some((c) => c.id === 'meta-length' && c.status === 'fail'));
  });
  it('warns (never errors) without a focus keyword', () => {
    const r = analyzeSeo({ ...good, focusKeyword: '' });
    const kw = r.checks.filter((c) => c.id.startsWith('keyword-'));
    assert.equal(kw.length, 4);
    assert.ok(kw.every((c) => c.status === 'warn'));
  });
  it('computes readability math on known text', () => {
    assert.equal(countSyllables('electricity'), 5);
    assert.equal(countSyllables('a'), 1);
    const words = 100, sentences = 10, syll = 150;
    assert.equal(fleschReadingEase(words, sentences, syll), Math.round((206.835 - 1.015 * 10 - 84.6 * 1.5) * 10) / 10);
    assert.ok(fleschKincaidGrade(words, sentences, syll) > 0);
    assert.equal(fleschReadingEase(0, 0, 0), 0);
    assert.deepEqual(significantWords('The Solar Panels!'), ['the', 'solar', 'panels']);
  });
});
