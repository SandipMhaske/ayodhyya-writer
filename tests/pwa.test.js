// PWA offline guarantee: everything the app needs with no network must be either
// in the service-worker APP_SHELL or generated locally at runtime. This test fails
// the suite if a module, template, icon, or manifest asset is added but not cached.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROJ = path.resolve(import.meta.dirname, '..');

function shellEntries() {
  const sw = fs.readFileSync(path.join(PROJ, 'service-worker.js'), 'utf8');
  const block = sw.match(/APP_SHELL = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
}

describe('pwa offline shell', () => {
  it('every cached path exists on disk', () => {
    const missing = shellEntries().filter((p) => !fs.existsSync(path.join(PROJ, p)));
    assert.deepEqual(missing, [], `cached but missing from disk: ${missing.join(', ')}`);
  });
  it('every app.js static import is cached', () => {
    const app = fs.readFileSync(path.join(PROJ, 'assets/js/app.js'), 'utf8');
    const imports = [...app.matchAll(/from '\.\.\/\.\.\/(src\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.length > 5, 'expected a real import list');
    const shell = new Set(shellEntries());
    const uncached = imports.filter((p) => !shell.has(p));
    assert.deepEqual(uncached, [], `modules loadable online but dead offline: ${uncached.join(', ')}`);
  });
  it('every default template file is cached (first-run seeding)', () => {
    const dir = path.join(PROJ, 'src/templates/default');
    const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
    const shell = new Set(shellEntries());
    const uncached = files.map((f) => `src/templates/default/${f}`).filter((p) => !shell.has(p));
    assert.deepEqual(uncached, [], `template files missing from offline cache: ${uncached.join(', ')}`);
  });
  it('manifest + icons referenced by index.html exist', () => {
    const idx = fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8');
    for (const m of idx.matchAll(/(?:manifest|icon)[^>]*(?:href|content)="([^"]+)"/g)) {
      const href = m[1];
      if (href.startsWith('http') || href.startsWith('data:')) continue;
      assert.ok(fs.existsSync(path.join(PROJ, href.replace(/^\.\//, ''))), `missing: ${href}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJ, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons || []) {
      assert.ok(fs.existsSync(path.join(PROJ, icon.src.replace(/^\.\//, ''))), `missing manifest icon: ${icon.src}`);
    }
  });
  it('windows launcher starts the admin server and opens the app', () => {
    const start = fs.readFileSync(path.join(PROJ, 'start-writer.bat'), 'utf8');
    assert.match(start, /tools\\preview\.mjs --admin/, 'launcher serves the writer UI');
    assert.match(start, /localhost:8080\/index\.html/, 'launcher opens the app URL');
    assert.match(start, /where node/, 'launcher checks the Node prerequisite');
    const stop = fs.readFileSync(path.join(PROJ, 'stop-writer.bat'), 'utf8');
    assert.match(stop, /Ayodhyya Writer server/, 'stop script targets the server window');
  });
});
