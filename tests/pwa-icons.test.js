import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodePng, ayodhyyaPixel, crc32 } from '../src/pwa/icons.js';

const PROJ = path.resolve(import.meta.dirname, '..');

function parsePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let o = 8;
  const chunks = {};
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    const want = buf.readUInt32BE(o + 8 + len);
    const got = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    assert.equal(got, want, `valid CRC for ${type}`);
    (chunks[type] = chunks[type] || []).push(data);
    o += 12 + len;
  }
  return chunks;
}

function pixels(chunks, size) {
  const raw = Buffer.concat([inflateSync(chunks.IDAT[0])]);
  const px = (x, y) => [...raw.subarray(y * (1 + size * 4) + 1 + x * 4, y * (1 + size * 4) + 1 + x * 4 + 4)];
  return px;
}

describe('pwa icons', () => {
  it('encodes structurally valid PNGs at every committed size', () => {
    for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
      const buf = fs.readFileSync(path.join(PROJ, 'assets/icons', name));
      const chunks = parsePng(buf);
      assert.equal(chunks.IHDR[0].readUInt32BE(0), size, `${name} width`);
      assert.equal(chunks.IHDR[0].readUInt32BE(4), size, `${name} height`);
      assert.ok(buf.length < 20000, `${name} stays tiny (${buf.length}B)`);
    }
  });
  it('renders the gold A on ink with transparent/masked corners', () => {
    const std = parsePng(fs.readFileSync(path.join(PROJ, 'assets/icons/icon-192.png')));
    const px = pixels(std, 192);
    assert.deepEqual(px(0, 0), [0, 0, 0, 0], 'rounded corner is transparent');
    assert.deepEqual(px(96, 96), [15, 23, 42, 255], 'center is ink');
    const gold = [];
    for (let y = 0; y < 192; y += 4) for (let x = 0; x < 192; x += 4) {
      const p = px(x, y);
      if (p[0] === 251 && p[1] === 191 && p[2] === 36) gold.push([x, y]);
    }
    assert.ok(gold.length > 50, 'gold artwork present');
    const mask = parsePng(fs.readFileSync(path.join(PROJ, 'assets/icons/maskable-512.png')));
    assert.deepEqual(pixels(mask, 512)(0, 0), [15, 23, 42, 255], 'maskable is full-bleed');
  });
  it('is deterministic', () => {
    const a = encodePng(64, ayodhyyaPixel(false));
    const b = encodePng(64, ayodhyyaPixel(false));
    assert.ok(a.equals(b), 'same input → byte-identical PNG');
  });
});
