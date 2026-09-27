// Tiny template engine: {{site.name}} escaped, {{{article.content}}} raw.
// TEMPLATES ARE CODE (trusted site-owner code). Article fields are data — the BUILDER
// sanitizes article.content before it ever reaches here.
import { escapeHtml } from '../core/utils/utils.js';

export function resolvePath(obj, path) {
  return String(path).split('.').reduce((acc, k) => (acc == null ? acc : acc[k.trim()]), obj);
}

export function renderTemplate(tpl, ctx) {
  let s = String(tpl ?? '');
  // Raw triple-brace first.
  s = s.replace(/\{\{\{\s*([\w$.]+)\s*\}\}\}/g, (_, p) => {
    const v = resolvePath(ctx, p);
    return v == null ? '' : String(v);
  });
  // Escaped double-brace.
  s = s.replace(/\{\{\s*([\w$.]+)\s*\}\}/g, (_, p) => {
    const v = resolvePath(ctx, p);
    return v == null ? '' : escapeHtml(v);
  });
  return s;
}

export const TEMPLATE_FILES = ['index.html', 'article.html', 'category.html', 'tag.html', 'search.html', 'page.html', '404.html', 'style.css', 'script.js'];

export function validateTemplate(pkg) {
  const errors = [], warnings = [];
  if (!pkg || typeof pkg !== 'object') return { errors: ['Template package must be an object.'], warnings };
  if (!pkg.name) errors.push('Template package missing name.');
  const files = pkg.files || {};
  for (const f of ['index.html', 'article.html', 'page.html', '404.html', 'style.css']) {
    if (!files[f]) errors.push(`Missing required template file: ${f}`);
  }
  for (const [name, content] of Object.entries(files)) {
    if (/<\s*script[^>]*src\s*=\s*["']http/i.test(String(content))) warnings.push(`${name}: references remote script — prefer vendored/minimal JS.`);
  }
  return { errors, warnings, ok: errors.length === 0 };
}
