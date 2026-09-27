// Backend deploy client — the CLI's authenticated POST to the protected deployment
// service. Pure + injectable fetch, so every failure mode is unit-tested without AWS.
// Secrets travel only in the Authorization header, never in logs or errors.
export class BackendError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.kind = kind; // 'auth' | 'forbidden' | 'failed' | 'unreachable' | 'invalid'
    this.detail = detail;
  }
}

export async function postDeploy({ baseUrl, token, payload, fetchImpl, timeoutMs = 30000 }) {
  const fetch = fetchImpl || globalThis.fetch;
  if (!baseUrl) throw new BackendError('invalid', 'No deployment service URL configured.');
  if (!token) throw new BackendError('auth', 'No deploy token — set DEPLOY_SERVICE_TOKEN.');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/api/deploy`;
  let resp;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.(); // never hold the process open on network failure
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    if (e?.name === 'AbortError') throw new BackendError('failed', 'Backend timed out — deployment status unknown, check server logs before retrying.');
    throw new BackendError('unreachable', `Backend unreachable at ${url} — is it running?`);
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new BackendError('auth', 'Backend rejected the token — check DEPLOY_SERVICE_TOKEN.');
  if (resp.status === 403) throw new BackendError('forbidden', data.error || 'Forbidden.');
  if (!resp.ok || !data.ok) {
    throw new BackendError('failed', `Deployment failed${data.errorId ? ` (Error ID: ${data.errorId})` : ''}.`, data.detail || data.error || '');
  }
  return data;
}
