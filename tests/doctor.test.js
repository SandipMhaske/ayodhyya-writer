import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJ = path.resolve(import.meta.dirname, '..');
const run = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-doc-'));
const env = { ...process.env, AYODHYYA_DB: path.join(tmp, 'doc.db') };

describe('doctor', () => {
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reports healthy JSON on a seeded database', async () => {
    const r = await run(process.execPath, ['tools/doctor.mjs', '--json'], { cwd: PROJ, env });
    const summary = JSON.parse(r.stdout);
    assert.equal(summary.ok, true);
    for (const area of ['env', 'database', 'templates', 'seed', 'build', 'deploy']) {
      assert.ok(summary.results.some((x) => x.area === area), `covers ${area}`);
    }
  });
});
