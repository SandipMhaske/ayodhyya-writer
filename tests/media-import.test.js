import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadImages, suggestFilename } from '../src/media/importImages.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const exact = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length); // honor Buffer pooling
const mockFetch = (map) => async (url) => {
  const hit = map[url];
  if (!hit) return { ok: false, status: 404, headers: { get: () => '' } };
  if (hit.text) return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : '') }, arrayBuffer: async () => exact(new TextEncoder().encode(hit.text)) };
  return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? hit.mime : '') }, arrayBuffer: async () => exact(hit.bytes) };
};

describe('image import', () => {
  it('downloads real images, rejects fakes by magic bytes', async () => {
    const out = await downloadImages(
      [{ src: 'https://src.example/a.png', alt: 'A' }, { src: 'https://src.example/fake.png', alt: '' }],
      { fetchImpl: mockFetch({ 'https://src.example/a.png': { mime: 'image/png', bytes: PNG }, 'https://src.example/fake.png': { mime: 'image/png', bytes: new TextEncoder().encode('<html>not an image</html>') } }) }
    );
    assert.ok(out[0].ok && out[0].mime === 'image/png' && out[0].size > 0);
    assert.equal(out[0].filename, 'a.png');
    assert.ok(!out[1].ok, 'HTML masquerading as PNG rejected');
  });
  it('rejects non-images, oversize, bad hosts, bad status', async () => {
    const big = new Uint8Array(10);
    const out = await downloadImages(
      [{ src: 'https://src.example/d.pdf' }, { src: 'https://src.example/big.png' }, { src: 'http://localhost/x.png' }, { src: 'https://src.example/404.png' }],
      {
        fetchImpl: mockFetch({ 'https://src.example/d.pdf': { text: 'pdf' }, 'https://src.example/big.png': { mime: 'image/png', bytes: big } }),
        maxBytes: 8,
      }
    );
    assert.ok(!out[0].ok, 'non-image MIME rejected');
    assert.ok(!out[1].ok, 'oversize rejected');
    assert.ok(!out[2].ok, 'localhost blocked');
    assert.ok(!out[3].ok, 'HTTP error surfaced');
  });
  it('suggests safe filenames from URLs', () => {
    assert.equal(suggestFilename('https://x.example/a/b/Photo%201.JPG'), 'photo-1.jpg');
    assert.equal(suggestFilename('not a url'), 'image', 'unparseable input falls back');
  });
});

describe('media file store', () => {
  it('saves with dedupe and publishes to dist layout', async () => {
    const { saveMediaFile, publishMediaAssets } = await import('../tools/lib.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-media-'));
    const media = path.join(dir, 'media');
    const dist = path.join(dir, 'dist');
    assert.equal(saveMediaFile(PNG, 'a.png', media), 'a.png');
    assert.equal(saveMediaFile(PNG, 'a.png', media), 'a-2.png');
    assert.equal(publishMediaAssets(dist, media), 2);
    assert.ok(fs.existsSync(path.join(dist, 'assets', 'images', 'a-2.png')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
