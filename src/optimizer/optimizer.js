// Optimizer: dependency-free HTML/CSS/JS minification, asset fingerprinting,
// gzip/brotli artifact generation (Node zlib when available; browser skips compression).
import { fnv1aHex } from '../core/utils/utils.js';

export function minifyHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/>\s+</g, '><');
  return s.trim();
}

export function minifyCss(css) {
  let s = String(css ?? '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*([{}:;,>+~])\s*/g, '$1');
  s = s.replace(/;}/g, '}');
  return s.trim();
}

export function minifyJs(js) {
  let s = String(js ?? '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*([{}();,:=+\-*/<>!&|?])\s*/g, '$1');
  return s.trim();
}

export function fingerprintName(filename, content) {
  const hash = fnv1aHex(content).slice(0, 6);
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return `${filename}.${hash}`;
  return `${filename.slice(0, dot)}.${hash}${filename.slice(dot)}`;
}

// Returns { bytes, encoding } or null when compression is unavailable/pointless.
export async function compressBuffer(input, encoding = 'gzip') {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  try {
    const zlib = await import('node:zlib').catch(() => null);
    if (!zlib) return null;
    if (encoding === 'gzip') return { bytes: zlib.gzipSync(buf), encoding: 'gzip' };
    if (encoding === 'br') return { bytes: zlib.brotliCompressSync(buf), encoding: 'br' };
    if (encoding === 'zstd' || encoding === 'zst') {
      if (typeof zlib.zstdCompressSync !== 'function') return null;
      return { bytes: zlib.zstdCompressSync(buf), encoding: 'zstd' };
    }
    return null;
  } catch { return null; }
}

const ALREADY_COMPRESSED = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'zip', 'pdf']);
export function shouldCompress(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  if (ALREADY_COMPRESSED.has(ext)) return false; // no benefit
  return ['html', 'css', 'js', 'xml', 'json', 'txt', 'svg', 'webmanifest'].includes(ext);
}
