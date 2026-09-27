// Responsive <picture> helper + variant naming. Actual raster transcoding happens at
// build time only for formats the runtime supports; markup always includes fallback.
import { normalizeFilename } from '../security/uploads.js';

export function variantName(filename, width, ext = 'webp') {
  const norm = normalizeFilename(filename);
  const dot = norm.lastIndexOf('.');
  const stem = dot >= 0 ? norm.slice(0, dot) : norm;
  return `${stem}-${width}.${ext}`;
}

export function responsivePicture({ src, alt = '', widths = [400, 800, 1200, 1600], sizes = '(max-width: 800px) 100vw, 800px', width, height, lazy = true }) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const stem = String(src).replace(/\.[a-z0-9]+$/i, '');
  const srcsetWebp = widths.map((w) => `${esc(stem)}-${w}.webp ${w}w`).join(', ');
  const wh = [width && ` width="${Number(width)}"`, height && ` height="${Number(height)}"`].filter(Boolean).join('');
  const lz = lazy ? ' loading="lazy" decoding="async"' : ' decoding="async" fetchpriority="high"';
  return `<picture><source type="image/webp" srcset="${srcsetWebp}" sizes="${esc(sizes)}"><img src="${esc(src)}" alt="${esc(alt)}"${wh}${lz}></picture>`;
}
