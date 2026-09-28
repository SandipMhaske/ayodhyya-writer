import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTemplate } from '../src/templates/engine.js';
import { generateSite } from '../src/builder/generator.js';
import { loadTemplateFiles } from '../tools/lib.mjs';
import seed from '../seed/seed-data.json' with { type: 'json' };

describe('themes', () => {
  it('midnight package is complete and valid', () => {
    const t = loadTemplateFiles('midnight');
    assert.equal(t.name, 'Midnight');
    assert.equal(Object.keys(t.files).length, 9);
    const v = validateTemplate({ name: t.name, files: t.files });
    assert.ok(v.ok, 'midnight passes template validation: ' + v.errors.join(', '));
  });
  it('same content renders distinctly per theme', async () => {
    const base = { site: seed.sites[0], articles: seed.articles, pages: seed.pages, categories: seed.categories, tags: seed.tags, authors: seed.authors, media: [], comments: [] };
    const def = await generateSite({ ...base, template: loadTemplateFiles('default') });
    const mid = await generateSite({ ...base, template: loadTemplateFiles('midnight') });
    assert.ok(def.files.get('index.html').includes('>Home<'), 'default nav voice');
    assert.ok(mid.files.get('index.html').includes('>Essays<'), 'midnight nav voice');
    assert.notEqual(def.files.get('index.html'), mid.files.get('index.html'));
    const cssKey = [...mid.files.keys()].find((k) => k.startsWith('assets/css/'));
    assert.ok(mid.files.get(cssKey).includes('--bg:#0b0f1a'), 'dark theme ships its palette');
  });
  it('leetcode site defaults to midnight; backfill adds both themes', async () => {
    const leet = seed.sites.find((s) => s.id === 'site_leetcode');
    assert.equal(leet.activeTemplateId, 'tpl_midnight_v1');
    const { openDatabase } = await import('../tools/lib.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-theme-'));
    process.env.AYODHYYA_DB = path.join(dir, 't.db');
    try {
      const db = await openDatabase();
      assert.ok(await db.get('templates', 'tpl_default_v1'), 'default backfilled');
      assert.ok(await db.get('templates', 'tpl_midnight_v1'), 'midnight backfilled');
      db.close();
    } finally {
      delete process.env.AYODHYYA_DB;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
