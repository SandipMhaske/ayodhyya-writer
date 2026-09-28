// node tools/icons.mjs — render committed PWA icons (deterministic; rerun anytime).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, ayodhyyaPixel } from '../src/pwa/icons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'assets', 'icons');
fs.mkdirSync(dir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];
for (const [name, size, maskable] of jobs) {
  fs.writeFileSync(path.join(dir, name), encodePng(size, ayodhyyaPixel(maskable)));
  console.log(`wrote assets/icons/${name} (${size}px)`);
}
