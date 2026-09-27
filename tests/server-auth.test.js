import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18791;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-auth-'));
const PROJ = path.resolve(import.meta.dirname, '..'); // captured before chdir below

async function waitReady(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('deployment service did not start');
}

describe('deployment service RBAC', () => {
  before(async () => {
    process.chdir(tmp); // keep auth.log out of the repo
    process.env.PORT = String(PORT);
    process.env.DEPLOY_TOKEN = 'test-publisher-token-1234567890';
    process.env.ADMIN_TOKEN = 'test-admin-token-0987654321';
    process.env.ALLOWED_ORIGIN = 'http://localhost:8080';
    const root = process.cwd().replace(/\\/g, '/');
    await import('node:url').then(({ pathToFileURL }) =>
      import(pathToFileURL(path.join(PROJ, 'server/deployment-service/server.js')).href));
    await waitReady();
    void root;
  });
  after(async () => {
    const { pathToFileURL } = await import('node:url');
    const { server } = await import(pathToFileURL(path.join(PROJ, 'server/deployment-service/server.js')).href);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  it('health is public', async () => {
    assert.equal((await fetch(BASE + '/api/health')).status, 200);
  });
  it('deploy without token → 401', async () => {
    const r = await fetch(BASE + '/api/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
  });
  it('deploy with wrong token → 401', async () => {
    const r = await fetch(BASE + '/api/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: '{}' });
    assert.equal(r.status, 401);
  });
  it('publisher token cannot rollback → 403', async () => {
    const r = await fetch(BASE + '/api/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-publisher-token-1234567890' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.match(await r.text(), /Infrastructure Administrator/);
  });
  it('admin token can rollback → 200', async () => {
    const r = await fetch(BASE + '/api/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token-0987654321' }, body: JSON.stringify({ version: '2026.01.01.0000' }) });
    assert.equal(r.status, 200);
  });
  it('publisher token passes deploy auth (fails later on profile, not auth)', async () => {
    const r = await fetch(BASE + '/api/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-publisher-token-1234567890' }, body: '{}' });
    assert.ok(![401, 403].includes(r.status), `expected auth to pass, got ${r.status}`);
  });
  it('auth audit log records outcomes without secrets', async () => {
    const log = fs.readFileSync(path.join(tmp, 'auth.log'), 'utf8');
    assert.match(log, /outcome=denied/);
    assert.match(log, /outcome=allowed/);
    assert.match(log, /route=\/api\/rollback role=publisher outcome=forbidden/);
    assert.ok(!log.includes('test-publisher-token'), 'tokens must never be logged');
  });
});
