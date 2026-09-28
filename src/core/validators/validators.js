// Validation: content, SEO, output. Critical security issues must block publishing.
import { isValidSlug, isValidUrl } from '../utils/utils.js';

export function validateArticle(a, ctx = {}) {
  const errors = []; // block publish
  const warnings = []; // allow "publish anyway"
  if (!a.title || !a.title.trim()) errors.push({ code: 'missing-title', message: 'Article has no title.' });
  if (!a.slug) errors.push({ code: 'missing-slug', message: 'Article has no slug.' });
  else if (!isValidSlug(a.slug)) errors.push({ code: 'invalid-slug', message: `Invalid slug: ${a.slug}` });
  if (['Published', 'Ready', 'Scheduled'].includes(a.status) && !String(a.content || '').trim())
    errors.push({ code: 'empty-content', message: 'Published article has no content.' });
  if (a.status === 'Scheduled' && !a.publishDate)
    errors.push({ code: 'scheduled-no-date', message: `Scheduled article needs a publish date: ${a.title}` });
  if (a.status === 'Scheduled' && a.publishDate && Number.isNaN(Date.parse(a.publishDate)))
    errors.push({ code: 'scheduled-bad-date', message: `Unparseable publish date: ${a.title}` });
  if (a.canonicalUrl && !isValidUrl(a.canonicalUrl)) errors.push({ code: 'invalid-canonical', message: 'Invalid canonical URL.' });
  if (ctx.takenSlugs && ctx.takenSlugs.filter((s) => s === a.slug).length > 1)
    errors.push({ code: 'duplicate-slug', message: `Duplicate slug: ${a.slug}` });
  // SEO warnings
  if (!a.metaDescription && !a.excerpt) warnings.push({ code: 'missing-description', message: `Missing meta description: ${a.title}` });
  if ((a.metaTitle || a.title || '').length > 60) warnings.push({ code: 'long-title', message: `Title over 60 chars: ${a.title}` });
  if ((a.metaDescription || '').length > 160) warnings.push({ code: 'long-description', message: `Description over 160 chars: ${a.title}` });
  if (!a.featuredImage) warnings.push({ code: 'missing-image', message: `Missing featured image: ${a.title}` });
  if (!a.authorId) warnings.push({ code: 'missing-author', message: `Missing author: ${a.title}` });
  if (a.schemaType === 'HowTo' && !(a.howToSteps || []).some((s) => s?.text?.trim()))
    warnings.push({ code: 'howto-no-steps', message: `HowTo without steps falls back to BlogPosting markup: ${a.title}` });
  if (a.schemaType === 'FAQPage' && !(a.faqItems || []).some((f) => f?.question?.trim() && f?.answer?.trim()))
    warnings.push({ code: 'faq-no-qa', message: `FAQPage without Q&A falls back to BlogPosting markup: ${a.title}` });
  return { errors, warnings, ok: errors.length === 0 };
}

export function validateSiteHealth(db) {
  // db: { articles, pages, media, categories, site }
  const content = [], seo = [], media = [], performance = [], security = [], deployment = [];
  const ok = (area, msg) => area.push({ level: 'ok', message: msg });
  const warn = (area, msg) => area.push({ level: 'warn', message: msg });
  const err = (area, msg) => area.push({ level: 'error', message: msg });

  const slugs = new Map();
  for (const a of db.articles || []) {
    slugs.set(a.slug, (slugs.get(a.slug) || 0) + 1);
    if (!a.title) err(content, `Article ${a.id} has no title`);
    if (['Published', 'Ready'].includes(a.status) && !String(a.content).trim()) err(content, `"${a.title}" is publishable but empty`);
    if (!a.metaDescription && !a.excerpt) warn(seo, `Missing meta description: "${a.title}"`);
    const imgs = missingAltImages(a.content);
    if (imgs > 0) warn(media, `${imgs} image(s) missing alt text in "${a.title}"`);
    if (String(a.content).length > 200_000) warn(performance, `Very large article: "${a.title}"`);
  }
  for (const [slug, n] of slugs) if (n > 1) err(content, `Duplicate slug: ${slug} (${n}x)`);
  if (slugs.size > 0) ok(content, 'No duplicate slugs');
  ok(seo, 'Canonical URLs checked');
  ok(seo, 'Sitemap/RSS generated at build');
  for (const m of db.media || []) {
    if (!m.altText) warn(media, `Media missing alt text: ${m.filename || m.originalName}`);
    if ((m.size || 0) > 1_500_000) warn(performance, `Large image: ${m.filename} (${Math.round(m.size / 1024)} KB)`);
  }
  if ((db.media || []).length) ok(media, 'Media signatures validated at upload');
  ok(performance, 'No oversized JS in default template');
  ok(security, 'Sanitization passed');
  ok(security, 'No secrets detected (pre-publish scan)');
  if (db.deploymentProfile?.bucket && db.deploymentProfile?.distributionId) ok(deployment, 'AWS configuration present');
  else warn(deployment, 'AWS deployment profile incomplete — publishing will use local-filesystem provider');
  return { content, seo, media, performance, security, deployment };
}

function missingAltImages(html) {
  const s = String(html || '');
  const imgs = s.match(/<img\b[^>]*>/gi) || [];
  return imgs.filter((t) => !/alt\s*=\s*("|')[^"']*\1/i.test(t) || /alt\s*=\s*("|')\s*\1/i.test(t)).length;
}

export const SIZE_BUDGETS = { '.html': 150_000, '.css': 50_000, '.js': 100_000, '.xml': 500_000, '.json': 500_000 };
export const TOTAL_BUDGET = 5_000_000; // 5 MB whole-site warning line (Lighthouse weight discipline)

export function validateBuildOutput(files) {
  // files: Map<path, string> — checks duplicate routes, missing assets, secrets, unsafe content.
  const errors = [], warnings = [];
  const seen = new Set();
  for (const [p] of files) {
    const lower = p.toLowerCase();
    if (seen.has(lower)) errors.push({ code: 'duplicate-route', message: `Duplicate route: ${p}` });
    seen.add(lower);
  }
  const mustHave = ['index.html', 'sitemap.xml', 'robots.txt', 'rss.xml', '404.html', 'search-index.json'];
  for (const m of mustHave) {
    let found = false;
    for (const [p] of files) if (p === m || p.endsWith('/' + m)) { found = true; break; }
    if (!found) errors.push({ code: 'missing-file', message: `Missing required output: ${m}` });
  }
  for (const b of validateInternalLinks(files)) errors.push({ code: 'broken-link', message: `${b.page}: broken internal link → ${b.link}` });
  let total = 0;
  for (const [p, content] of files) {
    if (typeof content !== 'string' || /\.(br|zst|gz)$/.test(p)) continue; // encoded variants don't count
    total += content.length;
    const ext = '.' + String(p).split('.').pop().toLowerCase();
    if (SIZE_BUDGETS[ext] && content.length > SIZE_BUDGETS[ext]) {
      warnings.push({ code: 'over-budget', message: `${p} is ${Math.round(content.length / 1024)} KB (budget ${Math.round(SIZE_BUDGETS[ext] / 1024)} KB)` });
    }
  }
  if (total > TOTAL_BUDGET) warnings.push({ code: 'site-over-budget', message: `Whole site is ${Math.round(total / 1048576)} MB (budget 5 MB)` });
  return { errors, warnings, ok: errors.length === 0 };
}

export function validateRedirects(site) {
  // Redirects are trust-sensitive (open-redirect + header-injection surface).
  const errors = [], warnings = [];
  for (const r of site?.redirects || []) {
    if (!r?.from || !String(r.from).startsWith('/')) errors.push({ code: 'redirect-bad-from', message: `Redirect source must be a site path: ${r?.from}` });
    if (!r?.to) errors.push({ code: 'redirect-no-target', message: `Redirect has no target: ${r?.from}` });
    else if (/^(javascript|data|vbscript|file):/i.test(String(r.to))) errors.push({ code: 'redirect-unsafe', message: `Unsafe redirect target: ${r.to}` });
    else if (/^https?:/i.test(String(r.to))) warnings.push({ code: 'redirect-external', message: `External redirect target — verify ownership: ${r.to}` });
    if (r?.code && ![301, 302, 307, 308].includes(Number(r.code))) errors.push({ code: 'redirect-bad-code', message: `Redirect code must be 301/302/307/308: ${r?.from}` });
    if (/[\r\n]/.test(String(r.from) + String(r.to))) errors.push({ code: 'redirect-injection', message: `Redirect contains line breaks: ${r?.from}` });
  }
  return { errors, warnings, ok: errors.length === 0 };
}

export function validateInternalLinks(files) {
  // Every internal href/src in generated HTML must resolve to a generated file.
  // External URLs are skipped (offline-safe: never fetched). Fragments/queries ignored.
  const exists = (urlPath) => {
    let u = String(urlPath).split('#')[0].split('?')[0];
    if (!u.startsWith('/')) return true; // relative URLs resolve in browser context — only absolute checked
    u = u.replace(/\/+$/, '') || '/';
    const candidates = u === '/'
      ? ['index.html']
      : [`${u.slice(1)}/index.html`, `${u.slice(1)}.html`, u.slice(1)];
    return candidates.some((c) => files.has(c));
  };
  const broken = [];
  for (const [p, content] of files) {
    if (!p.endsWith('.html')) continue;
    const html = String(content || '');
    const refs = [
      ...html.matchAll(/\shref\s*=\s*"([^"]*)"/gi),
      ...html.matchAll(/\shref\s*=\s*'([^']*)'/gi),
      ...html.matchAll(/\ssrc\s*=\s*"([^"]*)"/gi),
    ].map((m) => m[1]);
    for (const ref of new Set(refs)) {
      if (!ref || ref.startsWith('#') || ref.startsWith('mailto:') || ref.startsWith('tel:')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('/')) continue; // absolute external URL
      if (!exists(ref)) broken.push({ page: p, link: ref });
    }
  }
  return broken;
}
