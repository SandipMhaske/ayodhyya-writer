// Image import — download candidate images, verify actual file signatures, reject junk.
// Universal (browser + Node): fetch is injected, bytes stay as Uint8Array, validation
// reuses the upload allowlist (extension + MIME + magic bytes + size + traversal).
// Storage is the caller's job: CLI writes data/media/, browser keeps a data: URL.
import { validateUpload, normalizeFilename } from '../security/uploads.js';
import { blockedHost } from '../core/utils/fetchArticle.js';

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export function suggestFilename(srcUrl, fallback = 'image') {
  try {
    const u = new URL(String(srcUrl));
    const last = u.pathname.split('/').filter(Boolean).pop() || fallback;
    return normalizeFilename(decodeURIComponent(last).slice(0, 100) || fallback);
  } catch {
    return normalizeFilename(fallback);
  }
}

export async function downloadImages(images, { fetchImpl, timeoutMs = 20000, maxBytes = MAX_IMPORT_BYTES, allowLocal = false } = {}) {
  const fetch = fetchImpl || globalThis.fetch;
  const out = [];
  for (const img of images || []) {
    const src = String(img?.src || '');
    const rec = { src, alt: String(img?.alt || ''), ok: false };
    let host = '';
    try { host = new URL(src).hostname; } catch { rec.errors = ['Not a valid image URL.']; out.push(rec); continue; }
    if (!allowLocal && blockedHost(host)) { rec.errors = ['Blocked host (SSRF guard).']; out.push(rec); continue; }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      timer.unref?.();
      const resp = await fetch(src, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'AyodhyyaWriter/1.0 (+import)', Accept: 'image/*' } });
      clearTimeout(timer);
      if (!resp.ok) { rec.errors = [`HTTP ${resp.status}.`]; out.push(rec); continue; }
      const mime = String(resp.headers?.get?.('content-type') || '').split(';')[0].trim();
      if (mime && !mime.startsWith('image/')) { rec.errors = [`Not an image (${mime}).`]; out.push(rec); continue; }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (bytes.length > maxBytes) { rec.errors = ['Image too large.']; out.push(rec); continue; }
      const filename = suggestFilename(src);
      const check = validateUpload({ filename, mimeType: mime || 'application/octet-stream', size: bytes.length, bytes: bytes.slice(0, 16) });
      if (!check.ok) { rec.errors = check.errors; out.push(rec); continue; }
      Object.assign(rec, { ok: true, buffer: bytes, mime: check.detectedMime || mime, size: bytes.length, filename: check.normalizedFilename });
    } catch (e) {
      rec.errors = [e?.name === 'AbortError' ? 'Download timed out.' : `Download failed: ${e?.message || e}`];
    }
    out.push(rec);
  }
  return out;
}
