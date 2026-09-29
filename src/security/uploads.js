// Upload validation (extension + MIME + magic bytes + size + traversal) & secret scanning.
// Never trust original filename or extension.
import { normalizePath } from '../core/utils/utils.js';

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', exts: ['jpg', 'jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  { mime: 'image/png', exts: ['png'], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  { mime: 'image/gif', exts: ['gif'], magic: [[0x47, 0x49, 0x46, 0x38]] },
  { mime: 'image/webp', exts: ['webp'], magic: [[0x52, 0x49, 0x46, 0x46]] }, // RIFF....WEBP (checked loosely)
  { mime: 'image/avif', exts: ['avif'], magic: [[0x00, 0x00, 0x00]] }, // ftyp check done loosely
  { mime: 'image/svg+xml', exts: ['svg'], magic: null }, // text — strictly sanitized elsewhere
];
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'gif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'ps1', 'js', 'mjs', 'php', 'py', 'sh', 'dll', 'so', 'html', 'htm', 'zip', 'rar', '7z', 'tar', 'gz']);

export function normalizeFilename(original) {
  const base = String(original || 'file').split(/[\\/]/).pop().trim().toLowerCase();
  const clean = base.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'file';
  if (clean.includes('..')) return clean.replace(/\./g, '-') + '.bin';
  return clean;
}

export function detectMimeFromBytes(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp';
  const head = String.fromCharCode(...b.slice(0, 64));
  if (/<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

export function validateUpload({ filename, mimeType, size, bytes }) {
  const errors = [];
  const norm = normalizeFilename(filename);
  if (/(\.\.|\/|\\|\0)/.test(String(filename || '')) && /(\.\.|\\|\0)/.test(String(filename))) errors.push('Path traversal in filename.');
  const ext = (norm.split('.').pop() || '').toLowerCase();
  if (BLOCKED_EXT.has(ext) && ext !== 'svg') errors.push(`Executable/archive uploads blocked: .${ext}`);
  if (!ALLOWED_EXT.has(ext)) errors.push(`Extension not allowed: .${ext}`);
  if ((size || 0) > MAX_IMAGE_BYTES) errors.push(`File too large (max ${MAX_IMAGE_BYTES / 1048576} MB).`);
  const detected = bytes ? detectMimeFromBytes(bytes) : null;
  if (bytes && ext !== 'svg' && ext !== 'avif' && detected && mimeType && detected !== mimeType) {
    // AVIF/WebP detection is heuristic; enforce strictly for classic formats.
    if (['image/jpeg', 'image/png', 'image/gif'].includes(detected)) errors.push(`MIME mismatch: claimed ${mimeType}, detected ${detected}.`);
  }
  if (bytes && ext !== 'svg' && !detected && ext !== 'avif' && ext !== 'webp') errors.push('Unrecognized file signature.');
  return { ok: errors.length === 0, errors, normalizedFilename: norm, detectedMime: detected };
}

// Blocks publishing when secrets would leak into the public site.
const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,                                   // AWS access key
  /aws_secret_access_key\s*[:=]/i,
  /xox[bpas]-[0-9a-zA-Z-]+/i,
  /gh[pousr]_[0-9a-zA-Z]{20,}/,                         // GitHub tokens
  /-----BEGIN (RSA )?PRIVATE KEY-----/,
  /"secret"\s*:\s*"[^"]+"/i,
];
export function scanForSecrets(files) {
  // files: iterable of [path, content]
  const hits = [];
  for (const [path, content] of files) {
    const p = normalizePath(path);
    if (/\.(webp|png|jpe?g|avif|gif|ico|woff2?)$/i.test(p)) continue;
    const text = String(content || '');
    for (const re of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) { hits.push({ path: p, pattern: String(re), sample: m[0].slice(0, 40) }); break; }
    }
    if (/(AKIA|aws_secret|PRIVATE KEY)/i.test(p)) hits.push({ path: p, pattern: 'filename', sample: p });
  }
  return hits;
}

export function contentSecurityPolicy({ adsense = false, analytics = '', analyticsHost = '' } = {}) {
  const script = ["'self'"];
  const img = ["'self'", 'data:', 'https:'];
  const connect = ["'self'"];
  if (adsense) { script.push('https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com'); img.push('https://*.googlesyndication.com'); connect.push('https://*.googlesyndication.com'); }
  if (analytics === 'ga4') { script.push('https://www.googletagmanager.com', 'https://www.google-analytics.com'); connect.push('https://www.google-analytics.com'); img.push('https://www.google-analytics.com'); }
  if ((analytics === 'plausible' || analytics === 'umami') && analyticsHost) {
    const host = String(analyticsHost).replace(/\/+$/, '');
    script.push(host); connect.push(host);
  }
  return [
    `default-src 'self'`,
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${img.join(' ')}`,
    `font-src 'self' data:`,
    `connect-src ${connect.join(' ')}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
  ].join('; ');
}

export function requiredExtraHosts(site) {
  // Hosts the owner must paste into the CloudFormation ExtraScriptHosts param
  // when AdSense/analytics integrations are enabled. Empty = CSP stays locked down.
  const hosts = [];
  if (site?.adsense?.publisherId) hosts.push('https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com');
  const a = site?.analytics;
  if (a?.provider === 'ga4') hosts.push('https://www.googletagmanager.com', 'https://www.google-analytics.com');
  if ((a?.provider === 'plausible' || a?.provider === 'umami') && a?.host) hosts.push(String(a.host).replace(/\/+$/, ''));
  return [...new Set(hosts)];
}

export function securityHeaders(opts = {}) {
  return {
    'Content-Security-Policy': contentSecurityPolicy(opts),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
  };
}
