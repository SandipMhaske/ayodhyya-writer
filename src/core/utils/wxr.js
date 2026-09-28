// WordPress eXtended RSS import — the migration path off WordPress hosting.
// Pure regex parsing (never executes anything), then normalized creates through the
// regular domain services (which sanitize + validate like any other content).
import { slugify } from './utils.js';

function cdata(s) {
  const m = String(s || '').match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : String(s || '')).trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? cdata(m[1]) : '';
}

function blockTag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseWxr(xml) {
  const text = String(xml || '');
  if (!/<rss[\s>]|<channel[\s>]/i.test(text)) throw new Error('Not a WordPress export file (no RSS/channel found).');
  const authors = [...text.matchAll(/<wp:author>([\s\S]*?)<\/wp:author>/gi)].map((m) => ({
    login: tag(m[1], 'wp:author_login') || 'author',
    name: cdata(tag(m[1], 'wp:author_display_name')) || tag(m[1], 'wp:author_login') || 'Author',
  }));
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const b = m[1];
    const cats = [...b.matchAll(/<category\s+domain="category"[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => cdata(c[1]));
    const tags = [...b.matchAll(/<category\s+domain="post_tag"[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => cdata(c[1]));
    const rawStatus = tag(b, 'wp:status').toLowerCase();
    return {
      title: cdata(blockTag(b, 'title')) || 'Untitled import',
      link: tag(b, 'link'),
      date: tag(b, 'pubDate'),
      creator: tag(b, 'dc:creator'),
      content: cdata(blockTag(b, 'content:encoded')),
      excerpt: cdata(blockTag(b, 'excerpt:encoded')),
      type: tag(b, 'wp:post_type').toLowerCase(),
      status: rawStatus === 'publish' ? 'Published' : 'Draft',
      categories: cats.filter(Boolean),
      tags: tags.filter(Boolean),
    };
  }).filter((i) => ['post', 'page'].includes(i.type) && (i.title !== 'Untitled import' || i.content));
  return { authors, items };
}

export function wxrSummary(parsed) {
  const posts = parsed.items.filter((i) => i.type === 'post').length;
  return { posts, pages: parsed.items.length - posts, authors: parsed.authors.length };
}
