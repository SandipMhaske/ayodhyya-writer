// Import-from-URL — fetch a webpage and extract a clean draft article, fully automatic.
// Pure + dependency-free (works in browser and Node; fetch is injected for tests).
// NEVER executes fetched code: extraction is regex-based, output is allowlist-sanitized.
// SSRF guard blocks non-HTTP(S) schemes and private/local hostnames. Server operators
// should additionally layer egress rules; the browser path is same-origin/CORS-bound.
import { sanitizeHtml } from '../../security/sanitize.js';
import { slugify, stripTags } from './utils.js';

const MAX_BYTES = 2_000_000;

export function blockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  if (!h || h === 'localhost') return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    return false;
  }
  if (h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (/^(metadata|instance-data)\./.test(h)) return true; // cloud metadata endpoints
  return false;
}

export function validateImportUrl(raw, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'Not a valid URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http(s) URLs can be imported.' };
  if (u.username || u.password) return { ok: false, error: 'URLs with credentials are rejected.' };
  if (!allowLocal && blockedHost(u.hostname)) return { ok: false, error: 'Private/local hosts cannot be imported (SSRF guard).' };
  return { ok: true, url: u.href };
}

function meta(html, ...names) {
  for (const n of names) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${n}["']`, 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

function absolutize(html, base) {
  // Keep images/links working by resolving relative refs against the source page.
  const fix = (url) => {
    const u = String(url || '').trim();
    if (!u || u.startsWith('#') || u.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    try { return new URL(u, base).href; } catch { return u; }
  };
  return String(html ?? '')
    .replace(/\s(href|src)="([^"]*)"/gi, (m, a, u) => ` ${a}="${fix(u).replace(/"/g, '&quot;')}"`)
    .replace(/\s(href|src)='([^']*)'/gi, (m, a, u) => ` ${a}="${fix(u).replace(/"/g, '&quot;')}"`);
}

function stripBoilerplate(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|template|nav|header|footer|aside|form|select|button|canvas|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return s;
}

function extractMain(html) {
  const s = stripBoilerplate(html);
  for (const tag of ['article', 'main']) {
    const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
    if (m && stripTags(m[1]).length > 200) return m[1];
  }
  // Fallback: densest div/section by paragraph text.
  let best = '', bestScore = 0;
  for (const m of s.matchAll(/<(div|section)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const text = stripTags(m[2]);
    const score = text.length;
    if (score > bestScore && score > 200) { bestScore = score; best = m[2]; }
  }
  if (best) return best;
  const body = s.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return (body ? body[1] : s).slice(0, 100000);
}

export async function fetchArticle(rawUrl, { fetchImpl, timeoutMs = 20000, allowLocal = false } = {}) {
  const v = validateImportUrl(rawUrl, { allowLocal });
  if (!v.ok) throw new Error(v.error);
  const fetch = fetchImpl || globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  timer.unref?.();
  let resp;
  try {
    resp = await fetch(v.url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'AyodhyyaWriter/1.0 (+import)', Accept: 'text/html' } });
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'Fetch timed out.' : `Fetch failed: ${e?.message || e}`);
  } finally { clearTimeout(timer); }
  if (!resp.ok) throw new Error(`Source returned HTTP ${resp.status}.`);
  const ctype = String(resp.headers?.get?.('content-type') || '');
  if (ctype && !/text\/html|application\/xhtml/i.test(ctype)) throw new Error(`Not an HTML page (${ctype.split(';')[0] || 'unknown type'}).`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('Page too large (over 2 MB) — refusing import.');
  const html = new TextDecoder().decode(bytes);
  const title = meta(html, 'og:title', 'twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim()) || (stripTags(extractMain(html)).slice(0, 120)) || 'Untitled import';
  const excerpt = meta(html, 'og:description', 'twitter:description', 'description') || stripTags(extractMain(html)).slice(0, 160);
  const author = meta(html, 'author', 'article:author', 'og:author');
  const publishDate = meta(html, 'article:published_time', 'article:modified_time', 'date')
    || (html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] || '');
  const image = meta(html, 'og:image', 'twitter:image');
  const content = sanitizeHtml(absolutize(extractMain(html), v.url));
  if (stripTags(content).length < 50) throw new Error('No readable article content found on that page.');
  // Candidate images: content <img> tags (absolute http(s) only) + OG image first.
  const seen = new Set();
  const images = [];
  if (/^https?:/i.test(image) && !seen.has(image)) { seen.add(image); images.push({ src: image, alt: title.slice(0, 120) }); }
  for (const m of content.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\ssrc="([^"]*)"/i)?.[1] || '').trim();
    if (!/^https?:/i.test(src) || seen.has(src)) continue;
    seen.add(src);
    images.push({ src, alt: (tag.match(/\salt="([^"]*)"/i)?.[1] || '').slice(0, 160) });
  }
  return {
    title: title.slice(0, 200),
    slug: slugify(title),
    excerpt: excerpt.slice(0, 300),
    content,
    contentFormat: 'html',
    authorName: author,
    publishDate,
    featuredImage: /^https?:/i.test(image) ? image : '',
    canonicalUrl: v.url, // imported content points canonical at its source
    sourceUrl: v.url,
    images, // [{ src (absolute), alt }] — caller downloads, validates, localizes
  };
}
