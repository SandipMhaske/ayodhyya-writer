// PNG icon generator — dependency-free (node:zlib only): CRC + IDAT chunks hand-built,
// pixels computed per-coordinate. Works in Node; the BROWSER never runs this (icons
// are generated once and committed). Deterministic: same input → byte-identical PNG.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(size, pixel) {
  // pixel(x, y, size) → [r, g, b, a]. 8-bit RGBA, no interlace.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter byte: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (1 + size * 4) + 1 + x * 4;
      raw[o] = r & 0xff; raw[o + 1] = g & 0xff; raw[o + 2] = b & 0xff; raw[o + 3] = a ?? 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const INK = [15, 23, 42, 255];
const GOLD = [251, 191, 36, 255];

function roundedRect(x, y, s, r) {
  if (x < 0 || y < 0 || x >= s || y >= s) return false;
  if (r <= 0) return true;
  // Inside unless within a corner square AND outside the corner radius.
  const qx = x < r ? r - x : x >= s - r ? x - (s - r) : -1;
  const qy = y < r ? r - y : y >= s - r ? y - (s - r) : -1;
  if (qx >= 0 && qy >= 0) return qx * qx + qy * qy <= r * r;
  return true;
}

function barDist(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

export function ayodhyyaPixel(maskable = false) {
  // Gold "A" (two legs + crossbar) on ink. Maskable variant keeps art in the safe zone.
  return (x, y, s) => {
    const r = maskable ? 0 : Math.round(s * 0.19);
    if (!roundedRect(x, y, s, r)) return [0, 0, 0, 0];
    const m = maskable ? s * 0.2 : 0; // safe-zone padding for maskable
    const X = (v) => m + v * (s - 2 * m);
    const Y = (v) => m + v * (s - 2 * m);
    const w = s * (maskable ? 0.075 : 0.086);
    const left = barDist(x, y, X(0.31), Y(0.75), X(0.5), Y(0.25));
    const right = barDist(x, y, X(0.5), Y(0.25), X(0.69), Y(0.75));
    const bar = barDist(x, y, X(0.375), Y(0.62), X(0.625), Y(0.62));
    if (Math.min(left, right, bar) <= w) return GOLD;
    return INK;
  };
}
