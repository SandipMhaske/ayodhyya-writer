// Shared string/time/hash utilities. Pure JS — works in browser + Node, no DOM.
export function slugify(input, maxLen = 80) {
  const s = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return s || 'untitled';
}

export function uniqueSlug(base, taken) {
  const set = new Set(taken || []);
  let slug = slugify(base);
  if (!set.has(slug)) return slug;
  let i = 2;
  while (set.has(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

// FNV-1a 32-bit hex — deterministic, sync, dependency-free content hashing.
export function fnv1aHex(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

export function hashContent(parts) {
  return fnv1aHex(Array.isArray(parts) ? parts.join('\u0000') : String(parts ?? ''));
}

export function nowIso() {
  return new Date().toISOString();
}

export function deploymentVersion(date = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}.${p(date.getHours())}${p(date.getMinutes())}`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripTags(html) {
  return String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function wordCountOf(htmlOrText) {
  const t = stripTags(htmlOrText);
  if (!t) return 0;
  return t.split(/\s+/).length;
}

export function readingTimeMinutes(htmlOrText, wpm = 200) {
  return Math.max(1, Math.ceil(wordCountOf(htmlOrText) / wpm));
}

export function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || ''));
}

export function isValidUrl(u, { allowRelative = true } = {}) {
  if (!u) return false;
  const s = String(u).trim();
  if (/^(javascript|data|vbscript|file):/i.test(s)) return false;
  if (allowRelative && s.startsWith('/')) return !/\s/.test(s);
  try {
    const url = new URL(s);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/');
}
