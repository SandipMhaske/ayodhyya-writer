// End-to-end CLI workflow on an ISOLATED database (AYODHYYA_DB): cold seed → build →
// deploy → history → rollback. Shared gitignored side effects (dist/, backups/, the
// deployments.json mirror) are restored afterwards; the real database is never touched.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJ = path.resolve(import.meta.dirname, '..');
const run = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-'));
const env = { ...process.env, AYODHYYA_DB: path.join(tmp, 'e2e.db') };
const VERSION = '2099.01.01.0000';
const node = process.execPath;
let mirrorBefore = null;
let backupsBefore = [];

describe('e2e CLI workflow', () => {
  before(() => {
    try { mirrorBefore = fs.readFileSync(path.join(PROJ, 'data/deployments.json'), 'utf8'); } catch { mirrorBefore = null; }
    try { backupsBefore = fs.readdirSync(path.join(PROJ, 'backups')); } catch { backupsBefore = []; }
  });
  after(() => {
    if (mirrorBefore == null) fs.rmSync(path.join(PROJ, 'data/deployments.json'), { force: true });
    else fs.writeFileSync(path.join(PROJ, 'data/deployments.json'), mirrorBefore);
    for (const f of fs.readdirSync(path.join(PROJ, 'backups'))) {
      if (!backupsBefore.includes(f)) fs.rmSync(path.join(PROJ, 'backups', f));
    }
    delete process.env.AYODHYYA_DB;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('build → deploy → list → rollback from a cold database', async () => {
    const build = await run(node, ['tools/build.mjs'], { cwd: PROJ, env });
    assert.match(build.stdout, /Build complete/);
    assert.ok(fs.existsSync(path.join(PROJ, 'dist/index.html')));

    const dep = await run(node, ['tools/deploy.mjs', `--version=${VERSION}`], { cwd: PROJ, env });
    assert.match(dep.stdout, /DEPLOYMENT SUCCESSFUL/);
    assert.ok(fs.existsSync(path.join(PROJ, 'backups', `deploy-${VERSION}.json`)), 'deploy snapshot saved');

    const list = await run(node, ['tools/db.mjs', '--deployments'], { cwd: PROJ, env });
    assert.ok(list.stdout.includes(VERSION), 'deployment recorded in isolated DB');

    const rb = await run(node, ['tools/deploy.mjs', `--rollback=${VERSION}`], { cwd: PROJ, env });
    assert.match(rb.stdout, /rollback to/);
  });
});
