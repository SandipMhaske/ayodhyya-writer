// Optional AI writing assist — OFF by default, explicit click only, never automatic.
// Pure + provider-agnostic (any OpenAI-compatible chat-completions endpoint).
// The API key lives in tab session memory (Settings) — never localStorage, IndexedDB,
// disk, git, or generated output. Article text leaves the device ONLY when the user
// clicks an assist button. All logic unit-tested with injected fetch.

export class AIError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.kind = kind; // 'missing-key' | 'auth' | 'failed' | 'unreachable' | 'bad-response' | 'disabled'
    this.detail = detail;
  }
}

export const ASSIST_TASKS = {
  summarize: {
    label: 'Summarize into excerpt',
    system: 'You write tight excerpts for blog articles. Reply with ONLY the excerpt, 40-160 characters, no quotes, no preamble.',
    user: (a) => `Title: ${a.title || '(untitled)'}\n\nArticle:\n${a.text.slice(0, 6000)}`,
  },
  keywords: {
    label: 'Suggest focus keyword',
    system: 'You are an SEO analyst. Reply with ONLY a 2-4 word focus keyword phrase in lowercase, nothing else.',
    user: (a) => `Title: ${a.title || '(untitled)'}\n\nArticle:\n${a.text.slice(0, 6000)}`,
  },
  meta: {
    label: 'Draft meta description',
    system: 'You write click-worthy meta descriptions. Reply with ONLY the description, 120-160 characters, no quotes, no preamble.',
    user: (a) => `Title: ${a.title || '(untitled)'}\nFocus keyword: ${a.focusKeyword || 'none'}\n\nArticle:\n${a.text.slice(0, 6000)}`,
  },
};

export function cleanReply(task, text) {
  // Models add preamble despite instructions — strip quotes, labels, and wrapping.
  let s = String(text ?? '').trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^(?:(?:focus|meta)\s+)?(?:excerpt|keyword|description)s?\s*[:–-]\s*/i, '')
    .trim();
  if (task === 'keywords') s = s.split('\n')[0].toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  return s.slice(0, 400);
}

export async function assist(task, article, { baseUrl, apiKey, model, fetchImpl, timeoutMs = 30000 } = {}) {
  const def = ASSIST_TASKS[task];
  if (!def) throw new AIError('failed', `Unknown assist task: ${task}`);
  if (!baseUrl) throw new AIError('disabled', 'AI assist is off — set a provider URL in Settings to enable it.');
  if (!apiKey) throw new AIError('missing-key', 'No AI key for this tab — paste one in Settings (kept in memory only).');
  if (!article?.text?.trim()) throw new AIError('failed', 'Nothing to analyze yet — write some content first.');
  const fetch = fetchImpl || globalThis.fetch;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  let resp;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.();
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: [{ role: 'system', content: def.system }, { role: 'user', content: def.user(article) }], max_tokens: 300, temperature: 0.5 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    if (e?.name === 'AbortError') throw new AIError('failed', 'AI request timed out.');
    throw new AIError('unreachable', 'AI provider unreachable — check the URL and connection.');
  }
  if (resp.status === 401 || resp.status === 403) throw new AIError('auth', 'AI provider rejected the key.');
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new AIError('failed', `AI provider error (HTTP ${resp.status}).`, String(data?.error?.message || '').slice(0, 200));
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new AIError('bad-response', 'AI returned an empty reply — try again.');
  return cleanReply(task, text);
}
