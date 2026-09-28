// Static site generator — pure, testable without a browser.
// Input: { site, articles, pages, categories, tags, authors, media, template, deploymentProfile }
// Output: Map<outputPath, content> with clean URLs + SEO + feeds + search index + redirects.
import { sanitizeHtml } from '../security/sanitize.js';
import { renderTemplate } from '../templates/engine.js';
import { seoHead, articleJsonLd, websiteJsonLd, breadcrumbJsonLd, buildSitemap, buildSitemapIndex, paginateSitemap, buildRss, buildRobots, canonicalFor } from '../seo/seo.js';
import { markdownToHtml } from '../core/utils/markdown.js';
import { escapeHtml, hashContent, stripTags } from '../core/utils/utils.js';
import { minifyHtml, minifyCss, minifyJs, fingerprintName } from '../optimizer/optimizer.js';
import { securityHeaders } from '../security/uploads.js';

export function newsletterBlock(site) {
  const nl = site?.newsletter;
  if (!nl?.enabled) return '';
  const form = nl.endpoint
    ? `<form action="${escapeHtml(nl.endpoint)}" method="post"><label>Email updates<input type="email" name="email" required autocomplete="email"></label> <button type="submit">Subscribe</button></form>`
    : '<p>Signup opening soon.</p>';
  return `<section class="newsletter"><h2>${escapeHtml(nl.heading || 'Newsletter')}</h2><p>${escapeHtml(nl.text || '')}</p>${form}</section>`;
}

export function commentsSection({ site, slug, comments }) {
  const cfg = site?.comments;
  const approved = (comments || []).filter((c) => c.articleSlug === slug && c.status === 'Approved')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const list = approved.map((c) =>
    `<article class="comment"><p class="byline">${escapeHtml(c.author || 'Anonymous')} · ${escapeHtml((c.createdAt || '').slice(0, 10))}</p><div>${c.content}</div></article>`).join('\n');
  const form = cfg?.enabled && cfg?.endpoint
    ? `<form class="comment-form" action="${escapeHtml(cfg.endpoint)}" method="post"><h3>Leave a comment</h3><input type="hidden" name="slug" value="${escapeHtml(slug)}"><label>Name<input name="name" maxlength="80" autocomplete="name"></label><label>Comment<textarea name="message" rows="4" required maxlength="5000"></textarea></label><button type="submit">Post comment</button></form>`
    : '';
  if (!approved.length && !form) return '';
  return `<section class="comments"><h2>Comments${approved.length ? ` (${approved.length})` : ''}</h2>${list || '<p>No comments yet.</p>'}${form}</section>`;
}

export function shareBlock({ url, title }) {
  // Plain links (no JS needed) + progressive-enhancement buttons handled by template script.js.
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const link = (href, label) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  return `<section class="share"><h2>Share this article</h2><div class="row">`
    + `<button type="button" data-share="native" data-url="${escapeHtml(url)}" data-title="${escapeHtml(title)}">Share…</button>`
    + `<button type="button" data-share="copy" data-url="${escapeHtml(url)}">Copy link</button>`
    + link(`https://twitter.com/intent/tweet?text=${t}&url=${u}`, 'X')
    + link(`https://www.facebook.com/sharer/sharer.php?u=${u}`, 'Facebook')
    + link(`https://www.linkedin.com/sharing/share-offsite/?url=${u}`, 'LinkedIn')
    + link(`https://wa.me/?text=${t}%20${u}`, 'WhatsApp')
    + link(`https://t.me/share/url?url=${u}&text=${t}`, 'Telegram')
    + `</div></section>`;
}

export function relatedArticles(article, published, count = 3) {
  const cat = (article.categoryIds || [])[0];
  const tags = new Set(article.tagIds || []);
  return published
    .filter((a) => a.slug !== article.slug)
    .map((a) => ({
      a,
      score: ((a.categoryIds || [])[0] === cat && cat ? 2 : 0) + (a.tagIds || []).filter((t) => tags.has(t)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || String(y.a.publishDate || y.a.createdAt).localeCompare(String(x.a.publishDate || x.a.createdAt)))
    .slice(0, count)
    .map((x) => x.a);
}

export function prevNext(article, published) {
  const ordered = [...published].sort((a, b) => String(a.publishDate || a.createdAt).localeCompare(String(b.publishDate || b.createdAt)));
  const i = ordered.findIndex((a) => a.slug === article.slug);
  if (i < 0) return { prev: null, next: null };
  return { prev: ordered[i - 1] || null, next: ordered[i + 1] || null };
}

export function relatedBlock(list) {
  if (!list.length) return '';
  return `<section class="related"><h2>Related reading</h2><div class="grid">${list.map((a) =>
    `<article class="card"><h2><a href="/articles/${a.slug}/">${escapeHtml(a.title)}</a></h2><p>${escapeHtml(a.excerpt || '')}</p></article>`).join('')}</div></section>`;
}

export function prevNextBlock({ prev, next }) {
  if (!prev && !next) return '';
  return `<nav class="prevnext" aria-label="More articles"><div class="row">`
    + (prev ? `<a href="/articles/${prev.slug}/">← ${escapeHtml(prev.title)}</a>` : '<span></span>')
    + (next ? `<a href="/articles/${next.slug}/">${escapeHtml(next.title)} →</a>` : '<span></span>')
    + `</div></nav>`;
}

export function articleBody(article) {
  const raw = article.contentFormat === 'markdown' ? markdownToHtml(article.content) : String(article.content || '');
  return sanitizeHtml(raw);
}

export function addHeadingIds(html) {
  // Slugs h2/h3 headings with stable ids for TOC anchors + deep links.
  // Runs post-sanitize (id attributes are not author-trusted) at build time.
  const seen = new Map();
  return String(html ?? '').replace(/<(h[23])>([^<]*)<\/\1>/gi, (full, tag, text) => {
    let base = text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `<${tag} id="${base}${n > 1 ? `-${n}` : ''}">${text}</${tag}>`;
  });
}

export function tocFor(html) {
  // Flat TOC from h2/h3 headings (h3 nested). Empty string when too few headings.
  const items = [...String(html ?? '').matchAll(/<(h[23]) id="([^"]+)">([^<]*)<\/\1>/gi)]
    .map((m) => ({ level: Number(m[1][1]), id: m[2], text: m[3] }));
  if (items.length < 2) return '';
  return `<nav class="toc" aria-label="Table of contents"><p>On this page</p><ul>${items
    .map((i) => `<li class="toc-${i.level}"><a href="#${i.id}">${escapeHtml(i.text)}</a></li>`).join('')}</ul></nav>`;
}

function adsenseHead(site) {
  const pub = site?.adsense?.publisherId;
  if (!pub) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeHtml(pub)}" crossorigin="anonymous"></script>`;
}

function adsenseBlock(site, placement) {
  const slot = site?.adsense?.slots?.[placement] || site?.adsense?.slots?.[site?.adsense?.placements?.[placement]];
  if (!site?.adsense?.publisherId || !slot) return '';
  return `<ins class="adsbygoogle" style="display:block" data-ad-client="${escapeHtml(site.adsense.publisherId)}" data-ad-slot="${escapeHtml(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>`;
}

export function buildSearchIndex({ articles }) {
  return (articles || [])
    .filter((a) => a.status === 'Published' || a.status === 'Modified')
    .map((a) => ({
      title: a.title, slug: a.slug, excerpt: a.excerpt || '',
      content: stripTags(articleBody(a)).slice(0, 5000),
      category: (a.categoryIds || [])[0] || '', tags: a.tagIds || [], date: a.publishDate || a.createdAt,
    }));
}

export async function generateSite(input, { sitemapPerPage, now } = {}) {
  const { site, articles = [], pages = [], categories = [], tags = [], authors = [], comments = [], template } = input;
  const files = new Map(); // path -> string
  const tpl = template?.files || {};
  const css = tpl['style.css'] ? minifyCss(tpl['style.css']) : '';
  const js = tpl['script.js'] ? minifyJs(tpl['script.js']) : '';
  const cssName = css ? fingerprintName('style.css', css) : null;
  const jsName = js ? fingerprintName('app.js', js) : null;
  if (cssName) files.set(`assets/css/${cssName}`, css);
  if (jsName) files.set(`assets/js/${jsName}`, js);

  const authorById = new Map(authors.map((a) => [a.id, a]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  // Scheduled articles whose publish date has passed go live automatically at build time.
  const at = now ? new Date(now).getTime() : Date.now();
  const isLive = (a) => ['Published', 'Modified'].includes(a.status) ||
    (a.status === 'Scheduled' && a.publishDate && !Number.isNaN(Date.parse(a.publishDate)) && Date.parse(a.publishDate) <= at);
  const published = articles.filter(isLive)
    .sort((a, b) => String(b.publishDate || b.createdAt).localeCompare(String(a.publishDate || a.createdAt)));

  const baseCtx = (extra = {}) => ({
    site: { name: site.name, description: site.description || site.tagline, url: site.url, tagline: site.tagline },
    ...extra,
  });
  const layout = (tplName, ctx) => renderTemplate(tpl[tplName] || '{{{content}}}', ctx);

  const cssLink = cssName ? `<link rel="stylesheet" href="/assets/css/${cssName}">` : '';
  const jsTag = jsName ? `<script src="/assets/js/${jsName}" defer></script>` : '';

  // Homepage
  {
    const cards = published.slice(0, 20).map((a) =>
      `<article class="card"><h2><a href="/articles/${a.slug}/">${escapeHtml(a.title)}</a></h2><p>${escapeHtml(a.excerpt || '')}</p></article>`).join('\n');
    const url = canonicalFor(site.url, '/');
    const head = seoHead({ site, title: `${site.name} — ${site.tagline || ''}`.trim(), description: site.seo?.defaultDescription || site.description, canonical: url, jsonldObjects: [websiteJsonLd({ site })], extra: `${cssLink}\n${adsenseHead(site)}` });
    const body = layout('index.html', baseCtx({ page: { title: site.name }, content: cards + '\n' + newsletterBlock(site), 'seo.head': head, 'social.meta': '', 'adsense.head': adsenseHead(site), 'site.name': site.name }));
    files.set('index.html', minifyHtml(injectHead(body, head, jsTag)));
  }

  // Articles
  const sitemapUrls = [{ loc: canonicalFor(site.url, '/'), lastmod: isoDate(site.updatedAt) }];
  for (const a of published) {
    const author = authorById.get(a.authorId);
    const cat = catById.get((a.categoryIds || [])[0]);
    const url = canonicalFor(site.url, `/articles/${a.slug}/`);
    const bodyHtml = addHeadingIds(articleBody(a));
    const toc = tocFor(bodyHtml);
    const head = seoHead({
      site,
      title: a.metaTitle || a.title,
      description: a.metaDescription || a.excerpt,
      canonical: a.canonicalUrl || url,
      robots: a.robots,
      og: { type: 'article', title: a.ogTitle || a.title, description: a.ogDescription || a.excerpt, image: a.ogImage || a.featuredImage, url },
      twitter: { card: 'summary_large_image', title: a.twitterTitle || a.title, description: a.twitterDescription || a.excerpt, image: a.twitterImage || a.featuredImage },
      jsonldObjects: [
        articleJsonLd({ site, article: a, author, url }),
        breadcrumbJsonLd([{ name: 'Home', url: canonicalFor(site.url, '/') }, ...(cat ? [{ name: cat.name, url: canonicalFor(site.url, `/category/${cat.slug}/`) }] : []), { name: a.title, url }]),
      ],
      extra: `${cssLink}\n${adsenseHead(site)}`,
    });
    const content = `${adsenseBlock(site, 'before-article')}\n${bodyHtml}\n${adsenseBlock(site, 'after-article')}\n${commentsSection({ site, slug: a.slug, comments })}\n${newsletterBlock(site)}\n${relatedBlock(relatedArticles(a, published))}\n${prevNextBlock(prevNext(a, published))}\n${shareBlock({ url, title: a.title })}`;
    const ctx = baseCtx({
      article: { title: a.title, content, author: author?.name || '', date: a.publishDate || a.createdAt, excerpt: a.excerpt },
      page: { title: a.title, content },
      content,
      toc,
      'seo.head': head, 'social.meta': '', 'adsense.head': adsenseHead(site), 'site.name': site.name,
    });
    files.set(`articles/${a.slug}/index.html`, minifyHtml(injectHead(layout('article.html', ctx), head, jsTag)));
    sitemapUrls.push({ loc: url, lastmod: isoDate(a.modifiedDate || a.updatedAt) });
  }

  // Category / tag pages
  for (const c of categories) {
    const list = published.filter((a) => (a.categoryIds || []).includes(c.id));
    const url = canonicalFor(site.url, `/category/${c.slug}/`);
    const head = seoHead({ site, title: `${c.name} — ${site.name}`, description: c.description, canonical: url, extra: cssLink });
    const cards = list.map((a) => `<article class="card"><h2><a href="/articles/${a.slug}/">${escapeHtml(a.title)}</a></h2></article>`).join('\n');
    files.set(`category/${c.slug}/index.html`, minifyHtml(injectHead(layout('category.html', baseCtx({ page: { title: c.name }, content: cards, category: c, 'seo.head': head, 'site.name': site.name })), head, jsTag)));
    sitemapUrls.push({ loc: url, lastmod: isoDate(c.updatedAt) });
  }
  for (const t of tags) {
    const list = published.filter((a) => (a.tagIds || []).includes(t.id));
    const url = canonicalFor(site.url, `/tag/${t.slug}/`);
    const head = seoHead({ site, title: `${t.name} — ${site.name}`, canonical: url, extra: cssLink });
    const cards = list.map((a) => `<article class="card"><h2><a href="/articles/${a.slug}/">${escapeHtml(a.title)}</a></h2></article>`).join('\n');
    files.set(`tag/${t.slug}/index.html`, minifyHtml(injectHead(layout('tag.html', baseCtx({ page: { title: t.name }, content: cards, tag: t, 'seo.head': head, 'site.name': site.name })), head, jsTag)));
  }

  // Static pages (about/contact/privacy/...)
  for (const p of pages.filter((p) => p.status === 'Published' || p.status === 'Modified')) {
    const url = canonicalFor(site.url, `/${p.slug}/`);
    const head = seoHead({ site, title: p.metaTitle || p.title, description: p.metaDescription, canonical: p.canonicalUrl || url, extra: cssLink });
    const body = sanitizeHtml(p.contentFormat === 'markdown' ? markdownToHtml(p.content) : p.content);
    files.set(`${p.slug}/index.html`, minifyHtml(injectHead(layout('page.html', baseCtx({ page: { title: p.title, content: body }, content: body, 'seo.head': head, 'site.name': site.name })), head, jsTag)));
    sitemapUrls.push({ loc: url, lastmod: isoDate(p.updatedAt) });
  }

  // Search page + index
  {
    const head = seoHead({ site, title: `Search — ${site.name}`, canonical: canonicalFor(site.url, '/search/'), robots: 'noindex,follow', extra: cssLink });
    files.set('search/index.html', minifyHtml(injectHead(layout('search.html', baseCtx({ page: { title: 'Search' }, content: '', 'seo.head': head, 'site.name': site.name })), head, jsTag)));
    files.set('search-index.json', JSON.stringify(buildSearchIndex({ articles })));
  }

  // 404
  {
    const head = seoHead({ site, title: `Not found — ${site.name}`, robots: 'noindex,nofollow', extra: cssLink });
    files.set('404.html', minifyHtml(injectHead(layout('404.html', baseCtx({ page: { title: 'Not found' }, content: '<p>Page not found.</p>', 'seo.head': head, 'site.name': site.name })), head, jsTag)));
  }

  // Feeds + robots + manifest + headers
  // Sitemap: single file for small sites, paginated pages + index once large.
  const sitemapPages = paginateSitemap(sitemapUrls, sitemapPerPage);
  for (const page of sitemapPages) files.set(page.name, buildSitemap(page.urls));
  if (sitemapPages.some((p) => p.index)) files.set('sitemap.xml', buildSitemapIndex(site.url, sitemapPages));
  files.set('rss.xml', buildRss({ site, articles: published }));
  files.set('robots.txt', buildRobots({ site, production: true }));
  files.set('manifest.webmanifest', JSON.stringify({ name: site.name, short_name: site.name, start_url: '/', display: 'standalone' }));
  files.set('_headers.json', JSON.stringify(securityHeaders({ adsense: !!site?.adsense?.publisherId }), null, 2));
  // Redirect manifest for slug changes (CloudFront Functions / S3 routing compatible JSON)
  const redirects = (site.redirects || []).filter((r) => r?.from && r?.to);
  files.set('redirects.json', JSON.stringify(redirects, null, 2));

  const contentHash = hashContent([...files.entries()].map(([p, c]) => `${p}:${typeof c === 'string' ? c.length : 0}:${fnvSafe(c)}`));
  return { files, contentHash, sitemapUrls, publishedCount: published.length };
}

function fnvSafe(s) {
  let h = 0x811c9dc5;
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  const n = Math.min(str.length, 20000);
  for (let i = 0; i < n; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

function injectHead(html, head, jsTag) {
  let s = String(html ?? '');
  if (s.includes('</head>')) return s.replace('</head>', `${head}\n${jsTag}\n</head>`);
  return `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n${head}\n${jsTag}\n</head><body>${s}</body>`;
}

function isoDate(d) {
  try { return new Date(d || Date.now()).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}

// Incremental build manifest: only rebuild/upload what changed.
export function diffManifest(prev, next) {
  // prev/next: { contentHash, files: Map } — compare per-file hashes.
  const changed = [];
  const prevMap = prev?.hashes || {};
  const nextHashes = {};
  for (const [p, c] of next.files) {
    const h = fnvSafe(typeof c === 'string' ? c.slice(0, 20000) + c.length : c);
    nextHashes[p] = h;
    if (prevMap[p] !== h) changed.push(p);
  }
  const removed = Object.keys(prevMap).filter((p) => !next.files.has(p));
  return { changed, removed, nextHashes, fullRebuild: !prev };
}
