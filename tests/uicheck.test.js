// UI id-consistency: every static $('#id') in assets/js/app.js must have a matching
// id="..." in app.js templates or index.html. Catches dead-button crashes
// (e.g. a typo'd id makes $('#x').onclick throw and kills the whole view).
// Wizard text inputs are excluded: they receive ids via the input() helper;
// their names are cross-checked against collectWizard/validateWizardStep instead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROJ = path.resolve(import.meta.dirname, '..');
const DYNAMIC_IDS = new Set(['w-accountId', 'w-domain', 'w-bucket', 'w-distributionId', 'w-acmArn', 'w-hostedZoneId']);

describe('ui id consistency', () => {
  it('every static selector resolves to a rendered id', () => {
    const app = fs.readFileSync(path.join(PROJ, 'assets/js/app.js'), 'utf8');
    const idx = fs.readFileSync(path.join(PROJ, 'index.html'), 'utf8');
    const sel = new Set();
    const dynVars = {};
    for (const q of ["$('#", '$("']) {
      const close = q[2] + ')';
      let i = 0;
      while ((i = app.indexOf(q, i)) !== -1) {
        const j = app.indexOf(close, i + 3);
        if (j === -1) { i += 3; continue; } // e.g. dynamic '#'+var — resolved separately below
        const cand = app.slice(i + 3, j).replace(/^#/, '');
        if (!/^[A-Za-z][\w-]*$/.test(cand)) { i += 3; continue; } // not a literal id
        sel.add(cand);
        i = j + 1;
      }
    }
    // Resolve dynamic '#'+var selectors via their for-of literal arrays.
    for (const m of app.matchAll(/\$\('#' \+ (\w+)\)/g)) {
      const loop = app.match(new RegExp(`for \\(const ${m[1]} of \\[([^\\]]+)\\]`));
      for (const lit of (loop?.[1] || '').matchAll(/'([^']+)'/g)) dynVars[lit[1]] = true;
    }
    for (const id of Object.keys(dynVars)) sel.add(id);
    const ids = new Set();
    for (const m of (app + idx).matchAll(/ id="([^"]+)"/g)) ids.add(m[1]);
    const missing = [...sel].filter((s) => !ids.has(s) && !DYNAMIC_IDS.has(s) && !s.includes('${'));
    assert.deepEqual(missing, [], `dangling selectors would crash views: ${missing.join(', ')}`);
  });

  it('dynamic wizard ids are read back by the collector/validator', () => {
    const app = fs.readFileSync(path.join(PROJ, 'assets/js/app.js'), 'utf8');
    for (const id of DYNAMIC_IDS) {
      const short = id.replace(/^w-/, '');
      assert.ok(app.includes(`'${id}'`) || app.includes(`"${id}"`), `wizard input ${id} rendered`);
      assert.ok(app.includes(short) && (app.includes('collectWizard') || app.includes('validateWizardStep')), `wizard input ${id} consumed`);
    }
  });
});
