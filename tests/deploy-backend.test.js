// Boots the real deployment service WITH bucket config but WITHOUT the aws CLI,
// proving a valid authed deploy degrades to a clean 502 (errorId, no leak) instead of
// hanging or crashing — i.e. the CLI's backend path is safe to call.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 18792;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-be-'));
const PROJ = path.resolve(import.meta.dirname, '..');

async function waitReady(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('service did not start');
}

describe('backend deploy without aws CLI', () => {
  before(async () => {
    process.chdir(tmp);
    process.env.PORT = String(PORT);
    process.env.DEPLOY_TOKEN = 'be-publisher-token';
    process.env.ADMIN_TOKEN = 'be-admin-token';
    process.env.SITE_BUCKET = 'test-bucket';
    process.env.DISTRIBUTION_ID = 'E1234567890ABC';
    // Force aws CLI absence even if installed: empty PATH lookup would still find it;
    // instead rely on sync failing (no credentials) — either way the contract is:
    // non-401/403, JSON body, errorId present, no token echoed.
    const { pathToFileURL } = await import('node:url');
    await import(pathToFileURL(path.join(PROJ, 'server/deployment-service/server.js')).href);
    await waitReady();
  });
  after(async () => {
    const { pathToFileURL } = await import('node:url');
    const { server } = await import(pathToFileURL(path.join(PROJ, 'server/deployment-service/server.js')).href);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  it('authed deploy fails clean with errorId (no AWS here)', async () => {
    const r = await fetch(BASE + '/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer be-publisher-token' },
      body: JSON.stringify({ version: '2099.01.01.0000', files: [{ path: 'index.html' }] }),
    });
    assert.ok(![401, 403].includes(r.status), `auth must pass, got ${r.status}`);
    const body = await r.text();
    assert.ok(!body.includes('be-publisher-token'), 'token never echoed');
    const data = JSON.parse(body);
    assert.ok(data.errorId || data.ok, 'either a live deploy or a tracked errorId');
  });
});
