// SEO content analyzer — RankMath-style per-article scoring, dependency-free.
// Pure: (article, { siteUrl }) → { score 0–100, grade, checks[], stats }.
// Readability math is English-tuned (Flesch); other languages still get every
// non-readability check. Never blocks publishing by itself — the UI advises,
// the pre-publish gate decides.
import { stripTags } from '../core/utils/utils.js';

function wordsOf(text) {
  const w = String(text || '').trim().split(/\s+/).filter(Boolean);
  return w.length === 1 && w[0] === '' ? [] : w;
}

export function countSyllables(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]e|ed|es)$/, '').replace(/^y/, '');
  const beats = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, beats ? beats.length : 1);
}

export function fleschReadingEase(words, sentences, syllables) {
  if (!words || !sentences) return 0;
  return Math.round((206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)) * 10) / 10;
}

export function fleschKincaidGrade(words, sentences, syllables) {
  if (!words || !sentences) return 0;
  return Math.round((0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59) * 10) / 10;
}

export function significantWords(keyword) {
  return String(keyword || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
}

export function analyzeSeo(article = {}, { siteUrl = '' } = {}) {
  const html = String(article.content || '');
  const text = stripTags(html);
  const words = wordsOf(text);
  const wordCount = words.length;
  const sentences = text.split(/[.!?…]+/).map((s) => s.trim()).filter(Boolean).length || (wordCount ? 1 : 0);
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const flesch = fleschReadingEase(wordCount, sentences, syllables);
  const grade = fleschKincaidGrade(wordCount, sentences, syllables);
  const title = article.metaTitle || article.title || '';
  const desc = article.metaDescription || article.excerpt || '';
  const kw = String(article.focusKeyword || '').trim().toLowerCase();
  const sig = significantWords(kw);
  const slug = String(article.slug || '').toLowerCase();
  const intro = words.slice(0, 100).join(' ').toLowerCase();
  const body = text.toLowerCase();
  const density = kw && wordCount ? (body.split(kw).length - 1) / wordCount * 100 : 0;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imgsWithAlt = imgs.filter((t) => /alt\s*=\s*("|')[^"']+\1/i.test(t)).length;
  const hrefs = [...html.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  const hasScheme = (h) => /^[a-z][a-z0-9+.-]*:/i.test(h);
  const sameHost = (h) => {
    try { return !!siteUrl && new URL(h).hostname === new URL(siteUrl).hostname; } catch { return false; }
  };
  const internalLinks = hrefs.filter((h) => h.startsWith('/') || (hasScheme(h) && sameHost(h))).length;
  const externalLinks = hrefs.filter((h) => hasScheme(h) && !sameHost(h)).length;

  const checks = [];
  const add = (id, label, weight, status, detail = '') => checks.push({ id, label, weight, status, detail });
  const P = 'pass', W = 'warn', F = 'fail';

  add('title-length', 'Title length 30–60 characters', 10,
    !title ? F : title.length >= 30 && title.length <= 60 ? P : (title.length >= 10 && title.length <= 70) ? W : F, `${title.length} characters`);
  add('meta-length', 'Meta description 120–160 characters', 10,
    !desc ? F : desc.length >= 120 && desc.length <= 160 ? P : (desc.length >= 70 && desc.length <= 200) ? W : F, `${desc.length} characters`);
  if (!kw) {
    add('keyword-title', 'Focus keyword in title', 10, W, 'Set a focus keyword to unlock keyword checks.');
    add('keyword-slug', 'Focus keyword in slug', 5, W, 'Set a focus keyword.');
    add('keyword-intro', 'Focus keyword in the first 100 words', 10, W, 'Set a focus keyword.');
    add('keyword-density', 'Keyword density 0.5–2.5%', 10, W, 'Set a focus keyword.');
  } else {
    add('keyword-title', `Focus keyword in title (“${kw}”)`, 10, title.toLowerCase().includes(kw) ? P : F);
    const hit = sig.filter((w) => slug.includes(w)).length;
    add('keyword-slug', 'Focus keyword in slug', 5, sig.length === 0 ? W : hit === sig.length ? P : hit > 0 ? W : F, `${hit}/${sig.length} words in slug`);
    add('keyword-intro', 'Focus keyword in the first 100 words', 10, intro.includes(kw) ? P : F);
    add('keyword-density', 'Keyword density 0.5–2.5%', 10,
      density === 0 ? F : density >= 0.5 && density <= 2.5 ? P : (density < 4 ? W : F), `${Math.round(density * 100) / 100}%`);
  }
  add('content-length', 'Content length ≥ 300 words', 10,
    wordCount >= 300 ? P : wordCount >= 150 ? W : F, `${wordCount} words`);
  add('image-alt', 'Images carry alt text', 5,
    imgs.length === 0 ? W : imgsWithAlt === imgs.length ? P : imgsWithAlt > 0 ? W : F, `${imgsWithAlt}/${imgs.length} with alt`);
  add('internal-links', 'At least one internal link', 5, internalLinks > 0 ? P : W, `${internalLinks} internal, ${externalLinks} external`);
  add('readability', 'Readable sentences (Flesch ≥ 50)', 10,
    wordCount < 30 ? W : flesch >= 50 ? P : flesch >= 30 ? W : F, `Flesch ${flesch}, grade ${grade}`);
  const ex = String(article.excerpt || '');
  add('excerpt', 'Excerpt 40–300 characters', 5,
    !ex ? F : ex.length >= 40 && ex.length <= 300 ? P : W, `${ex.length} characters`);
  add('featured-image', 'Featured image set', 5, article.featuredImage ? P : W);
  add('canonical', 'Canonical URL set', 5, article.canonicalUrl ? P : W);

  let score = 0;
  for (const c of checks) score += c.weight * (c.status === P ? 1 : c.status === W ? 0.5 : 0);
  score = Math.round(score);
  return {
    score,
    grade: score >= 80 ? 'Good' : score >= 50 ? 'Needs work' : 'Poor',
    checks,
    stats: { wordCount, sentences, flesch, fkGrade: grade, density: Math.round(density * 100) / 100, internalLinks, externalLinks, images: imgs.length, imagesWithAlt: imgsWithAlt },
  };
}
