// Allowlist HTML sanitizer — treats article content as UNTRUSTED DATA.
// Removes XSS vectors: javascript: URLs, event handlers, malicious SVG/iframe, style abuse.
// Trusted site-owner code (templates, configured custom JS) bypasses this by design.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'kbd', 'samp',
  'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'a', 'img', 'picture', 'source', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'details', 'summary',
  'iframe', 'video', 'audio', 'track',
]);
const ALLOWED_ATTR = new Set([
  'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding',
  'colspan', 'rowspan', 'scope', 'align', 'start', 'reversed', 'open',
  'controls', 'muted', 'loop', 'playsinline', 'poster', 'preload', 'type',
  'allowfullscreen', 'frameborder', 'referrerpolicy', 'sandbox',
]);
const ALLOWED_IFRAME_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com', 'vimeo.com']);
const DISALLOWED_PROTOCOL = /^(javascript|data|vbscript|file|blob)\s*:/i;

function sanitizeUrl(url, { allowDataImages = false } = {}) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('/') || u.startsWith('#')) return /^[\w\-/ .?#=&%:+,;@~]*$/.test(u) ? u : '';
  if (allowDataImages && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(u)) return u;
  if (DISALLOWED_PROTOCOL.test(u)) return '';
  try {
    const parsed = new URL(u, 'https://placeholder.local');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (/^https?:/i.test(u)) return u;
    return u; // resolved relative
  } catch { return ''; }
}

export function sanitizeHtml(dirty, opts = {}) {
  let html = String(dirty ?? '');
  // Strip comments, PHP/ASP tags, and dangerous elements entirely (with contents).
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<\?(php)?[\s\S]*?\?>/gi, '');
  html = html.replace(/<%[\s\S]*?%>/g, '');
  for (const tag of ['script', 'style', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'noscript', 'template', 'slot']) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // Rewrite remaining tags through the allowlist.
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    const isClose = full.startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (isClose) return `</${tag}>`;
    const attrs = [];
    const attrRe = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    let sawSrc = '';
    while ((m = attrRe.exec(rawAttrs || ''))) {
      const name = m[1].toLowerCase();
      let val = m[2] ?? m[3] ?? m[4] ?? '';
      if (name.startsWith('on')) continue; // event handlers
      if (!ALLOWED_ATTR.has(name) && !(name === 'class' && opts.allowClass)) continue;
      if (name === 'sandbox') { attrs.push('sandbox="allow-same-origin allow-scripts"'); continue; }
      if (['href', 'src', 'poster'].includes(name)) {
        val = sanitizeUrl(val);
        if (!val) continue;
        if (tag === 'iframe') {
          try {
            const host = new URL(val, 'https://x.local').hostname.toLowerCase();
            const abs = /^https?:/i.test(val);
            if (abs && ![...ALLOWED_IFRAME_HOSTS].includes(host)) continue;
          } catch { continue; }
        }
      }
      if (name === 'srcset') {
        const cleaned = String(val).split(',').map((p) => sanitizeUrl(p.trim().split(/\s+/)[0])).filter(Boolean).join(', ');
        if (!cleaned) continue;
        val = cleaned;
      }
      val = String(val).replace(/"/g, '&quot;');
      attrs.push(`${name}="${val}"`);
      if (name === 'src') sawSrc = val;
    }
    // Drop iframes whose source was rejected (unapproved host / unsafe URL).
    if (tag === 'iframe' && !sawSrc) return '';
    // SVG is only allowed as <img src>; inline <svg> is dropped by the tag allowlist.
    const selfClose = ['img', 'br', 'hr', 'source', 'track', 'col'].includes(tag) ? ' /' : '';
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClose}>`;
  });
  return html;
}

export function sanitizeSvg(svgText) {
  // Strict: strip scripts, event handlers, foreignObject, remote refs.
  let s = String(svgText ?? '');
  if (/<\s*script/i.test(s) || /\son\w+\s*=/i.test(s)) return '';
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  s = s.replace(/\s(xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, _p, _q, d1, d2) => {
    const v = (d1 ?? d2 ?? '').trim();
    if (/^(javascript|data(?!\s*:\s*image\/svg)|vbscript):/i.test(v)) return '';
    if (/^https?:/i.test(v)) return ''; // no remote refs in uploaded SVG
    return full;
  });
  return s;
}
