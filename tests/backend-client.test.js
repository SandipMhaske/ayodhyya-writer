import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postDeploy, BackendError } from '../src/deployment/backendClient.js';

const okFetch = (seen) => async (url, opts) => {
  seen.push({ url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, version: 'v1', invalidated: ['/'] }) };
};

describe('backend deploy client', () => {
  it('posts manifest with bearer token and returns data', async () => {
    const seen = [];
    const data = await postDeploy({ baseUrl: 'http://x:8787/', token: 'tok', payload: { version: 'v1' }, fetchImpl: okFetch(seen) });
    assert.equal(data.version, 'v1');
    assert.equal(seen[0].url, 'http://x:8787/api/deploy');
    assert.equal(seen[0].auth, 'Bearer tok');
  });
  it('maps 401/403/502 to typed errors with actionable messages', async () => {
    const f401 = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const f403 = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Requires Infrastructure Administrator.' }) });
    const f502 = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, errorId: 'DEP-1', detail: 'S3 sync failed.' }) });
    await assert.rejects(postDeploy({ baseUrl: 'http://x', token: 't', payload: {}, fetchImpl: f401 }), (e) => e instanceof BackendError && e.kind === 'auth');
    await assert.rejects(postDeploy({ baseUrl: 'http://x', token: 't', payload: {}, fetchImpl: f403 }), (e) => e.kind === 'forbidden');
    await assert.rejects(postDeploy({ baseUrl: 'http://x', token: 't', payload: {}, fetchImpl: f502 }), (e) => e.kind === 'failed' && /DEP-1/.test(e.message));
  });
  it('maps network failure to unreachable without leaking the token', async () => {
    const boom = async () => { throw new Error('connect ECONNREFUSED'); };
    await assert.rejects(postDeploy({ baseUrl: 'http://x', token: 'secret-token', payload: {}, fetchImpl: boom }), (e) => {
      assert.equal(e.kind, 'unreachable');
      assert.ok(!String(e.message + e.detail).includes('secret-token'), 'token never in errors');
      return true;
    });
  });
  it('rejects missing url/token before any request', async () => {
    let called = false;
    const spy = async () => { called = true; throw new Error('must not call'); };
    await assert.rejects(postDeploy({ baseUrl: '', token: 't', payload: {}, fetchImpl: spy }), (e) => e.kind === 'invalid');
    await assert.rejects(postDeploy({ baseUrl: 'http://x', token: '', payload: {}, fetchImpl: spy }), (e) => e.kind === 'auth');
    assert.ok(!called);
  });
});
