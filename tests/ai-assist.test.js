import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assist, cleanReply, AIError, ASSIST_TASKS } from '../src/ai/assist.js';

const reply = (text, status = 200) => async () => ({
  ok: status >= 200 && status < 300, status,
  json: async () => ({ choices: [{ message: { content: text } }] }),
});
const art = { title: 'Solar Panels Guide', text: 'Solar panels save money. '.repeat(60), focusKeyword: 'solar panels' };

describe('ai assist', () => {
  it('summarizes, keywords, meta through the provider', async () => {
    const seen = [];
    const spy = async (url, opts) => { seen.push({ url, body: JSON.parse(opts.body) }); return reply('  "A tight excerpt here."  ')(); };
    const out = await assist('summarize', art, { baseUrl: 'https://ai.example/v1/', apiKey: 'k', model: 'm', fetchImpl: spy });
    assert.equal(out, 'A tight excerpt here.');
    assert.equal(seen[0].url, 'https://ai.example/v1/chat/completions');
    assert.equal(seen[0].body.model, 'm');
    assert.ok(seen[0].body.messages[1].content.includes('Solar Panels Guide'));
    assert.ok(!JSON.stringify(seen[0]).includes('undefined'));
  });
  it('cleans model chatter per task', () => {
    assert.equal(cleanReply('keywords', 'Focus Keyword: SOLAR Panels!!\nsecond line'), 'solar panels');
    assert.equal(cleanReply('meta', 'Meta description - A fine description of things here.'), 'A fine description of things here.');
    assert.equal(cleanReply('summarize', 'x'.repeat(500)), 'x'.repeat(400), 'length-capped');
  });
  it('refuses without config, content, or key — never silently', async () => {
    await assert.rejects(assist('summarize', art, { apiKey: 'k', fetchImpl: reply('x') }), (e) => e instanceof AIError && e.kind === 'disabled');
    await assert.rejects(assist('summarize', art, { baseUrl: 'https://x', fetchImpl: reply('x') }), (e) => e.kind === 'missing-key');
    await assert.rejects(assist('summarize', { title: 'T', text: '  ' }, { baseUrl: 'https://x', apiKey: 'k', fetchImpl: reply('x') }), (e) => e.kind === 'failed');
    await assert.rejects(assist('nope', art, { baseUrl: 'https://x', apiKey: 'k', fetchImpl: reply('x') }), /Unknown assist task/);
  });
  it('maps provider failures without leaking the key', async () => {
    const k = 'super-secret-key';
    await assert.rejects(assist('summarize', art, { baseUrl: 'https://x', apiKey: k, fetchImpl: reply('x', 401) }), (e) => e.kind === 'auth');
    await assert.rejects(assist('summarize', art, { baseUrl: 'https://x', apiKey: k, fetchImpl: async () => { throw new Error('down'); } }), (e) => {
      assert.equal(e.kind, 'unreachable');
      assert.ok(!String(e.message + e.detail).includes(k));
      return true;
    });
    await assert.rejects(assist('summarize', art, { baseUrl: 'https://x', apiKey: k, fetchImpl: reply('   ') }), (e) => e.kind === 'bad-response');
    assert.ok(Object.keys(ASSIST_TASKS).length >= 3, 'task catalog present');
  });
});
