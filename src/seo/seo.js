// SEO engine: head meta, JSON-LD, sitemap, RSS, robots. Never emits invalid structured data.
import { escapeHtml } from '../core/utils/utils.js';

export function canonicalFor(siteUrl, path) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const p = String(path || '/');
  return base + (p.startsWith('/') ? p : '/' + p);
}

export function seoHead({ site, title, description, canonical, robots, og = {}, twitter = {}, jsonldObjects = [], extra = '' }) {
  const t = escapeHtml(title || site?.name || '');
  const d = escapeHtml(description || site?.seo?.defaultDescription || site?.description || '');
  const c = escapeHtml(canonical || '');
  const r = escapeHtml(robots || site?.seo?.robots || 'index,follow');
  const tags = [
    `<title>${t}</title>`,
    d && `<meta name="description" content="${d}">`,
    c && `<link rel="canonical" href="${c}">`,
    `<meta name="robots" content="${r}">`,
    `<meta property="og:type" content="${escapeHtml(og.type || 'website')}">`,
    og.title && `<meta property="og:title" content="${escapeHtml(og.title)}">`,
    og.description && `<meta property="og:description" content="${escapeHtml(og.description)}">`,
    og.image && `<meta property="og:image" content="${escapeHtml(og.image)}">`,
    og.url && `<meta property="og:url" content="${escapeHtml(og.url)}">`,
    site?.name && `<meta property="og:site_name" content="${escapeHtml(site.name)}">`,
    twitter.card && `<meta name="twitter:card" content="${escapeHtml(twitter.card)}">`,
    twitter.title && `<meta name="twitter:title" content="${escapeHtml(twitter.title)}">`,
    twitter.description && `<meta name="twitter:description" content="${escapeHtml(twitter.description)}">`,
    twitter.image && `<meta name="twitter:image" content="${escapeHtml(twitter.image)}">`,
  ].filter(Boolean);
  const validLd = (jsonldObjects || []).filter((o) => o && typeof o === 'object' && o['@context'] && o['@type']);
  if (validLd.length) tags.push(`<script type="application/ld+json">${JSON.stringify(validLd.length === 1 ? validLd[0] : { '@context': 'https://schema.org', '@graph': validLd })}</script>`);
  if (extra) tags.push(extra);
  return tags.join('\n');
}

export function articleJsonLd({ site, article, author, url }) {
  if (!article?.title) return null; // never emit invalid structured data
  const type = article.schemaType || 'BlogPosting';
  if (type === 'HowTo') {
    const steps = (article.howToSteps || []).filter((s) => s?.text?.trim()).map((s, i) => ({
      '@type': 'HowToStep', position: i + 1, name: (s.name || '').slice(0, 200) || undefined, text: s.text,
    }));
    if (!steps.length) return fallbackArticleLd(site, article, author, url, 'BlogPosting'); // no steps = not a HowTo
    return {
      '@context': 'https://schema.org', '@type': 'HowTo',
      name: article.title,
      description: article.metaDescription || article.excerpt || '',
      datePublished: article.publishDate || article.createdAt,
      author: author ? { '@type': 'Person', name: author.name } : undefined,
      step: steps,
    };
  }
  if (type === 'FAQPage') {
    const qa = (article.faqItems || []).filter((f) => f?.question?.trim() && f?.answer?.trim()).map((f) => ({
      '@type': 'Question', name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    }));
    if (!qa.length) return fallbackArticleLd(site, article, author, url, 'BlogPosting'); // no Q&A = not an FAQPage
    return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa };
  }
  return fallbackArticleLd(site, article, author, url, ['BlogPosting', 'Article', 'NewsArticle'].includes(type) ? type : 'BlogPosting');
}

function fallbackArticleLd(site, article, author, url, type) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    headline: article.title,
    description: article.metaDescription || article.excerpt || '',
    datePublished: article.publishDate || article.createdAt,
    dateModified: article.modifiedDate || article.updatedAt,
    author: author ? { '@type': 'Person', name: author.name } : undefined,
    publisher: site?.name ? { '@type': 'Organization', name: site.name } : undefined,
    mainEntityOfPage: url,
    image: article.ogImage || article.featuredImage || undefined,
  };
}

export function websiteJsonLd({ site }) {
  return { '@context': 'https://schema.org', '@type': 'WebSite', name: site?.name, url: site?.url };
}

export function breadcrumbJsonLd(items) {
  const list = (items || []).filter((i) => i?.name && i?.url);
  if (!list.length) return null;
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: list.map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, name: i.name, item: i.url })),
  };
}

export function buildSitemap(urls) {
  const rows = (urls || [])
    .filter((u) => u?.loc)
    .map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeHtml(u.lastmod)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>`;
}

export const SITEMAP_PAGE_SIZE = 50000; // protocol limit per sitemap file

export function paginateSitemap(urls, perPage = SITEMAP_PAGE_SIZE) {
  // Splits URL list into page-sized chunks; single chunk → plain sitemap (no index).
  const list = (urls || []).filter((u) => u?.loc);
  const pages = [];
  for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage));
  return pages.length <= 1 ? [{ name: 'sitemap.xml', urls: list, index: false }] : pages.map((p, i) => ({ name: `sitemap-${i + 1}.xml`, urls: p, index: true }));
}

export function buildSitemapIndex(siteUrl, pages) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const rows = pages.map((p) => `  <sitemap><loc>${escapeHtml(base + '/' + p.name)}</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</sitemapindex>`;
}

export function buildRss({ site, articles, title, link }) {
  const items = (articles || []).filter((a) => a.status === 'Published' || a.status === 'Modified').map((a) => `
    <item>
      <title>${escapeHtml(a.title)}</title>
      <link>${escapeHtml(canonicalFor(site.url, '/articles/' + a.slug + '/'))}</link>
      <guid>${escapeHtml(canonicalFor(site.url, '/articles/' + a.slug + '/'))}</guid>
      <description>${escapeHtml(a.excerpt || a.metaDescription || '')}</description>
      ${a.publishDate ? `<pubDate>${escapeHtml(new Date(a.publishDate).toUTCString())}</pubDate>` : ''}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>${escapeHtml(title || site?.name || '')}</title>\n<link>${escapeHtml(link || site?.url || '')}</link>\n<description>${escapeHtml(site?.description || site?.tagline || '')}</description>\n${items}\n</channel>\n</rss>`;
}

export function buildRobots({ site, production = true }) {
  const lines = ['User-agent: *'];
  if (production) {
    lines.push('Allow: /');
    lines.push('Disallow: /admin');
    lines.push('Disallow: /api/');
    lines.push(`Sitemap: ${String(site?.url || '').replace(/\/+$/, '')}/sitemap.xml`);
  } else {
    lines.push('Disallow: /');
  }
  return lines.join('\n') + '\n';
}
