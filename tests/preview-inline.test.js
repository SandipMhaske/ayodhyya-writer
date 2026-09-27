import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inlineAssets, blobTypeFor, previewInterceptorScript, PREVIEW_MAP_KEY } from '../src/preview/inline.js';
const files = new Map([
  ['index.html', '<link rel="stylesheet" href="/assets/css/style.abc123.css"><script src="/assets/js/app.def456.js" defer></script>'],
  ['assets/css/style.abc123.css', 'a{color:red}'],
  ['assets/js/app.def456.js', 'console.log(1)'],
]);

describe('preview helpers', () => {
  it('inlines CSS/JS, leaves external tags alone', () => {
    const out = inlineAssets(files, files.get('index.html'));
    assert.ok(out.includes('<style>a{color:red}</style>'), 'css inlined');
    assert.ok(out.includes('<script>console.log(1)</script>'), 'js inlined');
    assert.ok(!out.includes('/assets/'), 'no asset requests remain');
    const ext = inlineAssets(files, '<link rel="stylesheet" href="https://cdn.example/x.css">');
    assert.ok(ext.includes('https://cdn.example/x.css'), 'external untouched');
  });
  it('picks blob content types', () => {
    assert.equal(blobTypeFor('index.html'), 'text/html');
    assert.equal(blobTypeFor('rss.xml'), 'application/xml');
    assert.equal(blobTypeFor('weird.bin'), 'text/plain');
  });
  it('interceptor resolves paths at click time via the session map', () => {
    const s = previewInterceptorScript();
    assert.ok(s.startsWith('<script>') && s.endsWith('</script>'));
    assert.ok(s.includes(PREVIEW_MAP_KEY), 'reads the session blob map');
    assert.ok(s.includes("closest('a')"), 'intercepts link clicks');
    assert.ok(s.includes('preventDefault'), 'stops absolute-link navigation');
    assert.ok(s.includes('404.html'), 'falls back to the preview 404 page');
    assert.ok(s.includes('addEventListener(\'submit\''), 'intercepts GET forms (search)');
    assert.ok(!s.includes('http'), 'no network calls of its own');
  });
  it('interceptor reroutes clicks through the session map', () => {
    const src = previewInterceptorScript().replace(/^<script>|<\/script>$/g, '');
    const store = {
      [PREVIEW_MAP_KEY]: JSON.stringify({ 'index.html': 'blob:home', 'articles/x/index.html': 'blob:art', '404.html': 'blob:404' }),
    };
    const handlers = {};
    let navigated = null;
    const sandbox = {
      sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
      document: { addEventListener: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); } },
      location: {},
    };
    Object.defineProperty(sandbox.location, 'href', { set: (v) => { navigated = v; }, get: () => '' });
    new Function('document', 'sessionStorage', 'location', src)(sandbox.document, sandbox.sessionStorage, sandbox.location);
    const click = (href) => {
      navigated = null;
      const e = { target: { closest: () => ({ getAttribute: () => href, target: '' }) }, preventDefault: () => {} };
      handlers.click.forEach((h) => h(e));
      return navigated;
    };
    assert.equal(click('/articles/x/?a=1#b'), 'blob:art?a=1#b');
    assert.equal(click('/'), 'blob:home');
    assert.equal(click('/nope/'), 'blob:404');
    assert.equal(click('https://ext.com/'), null, 'external links untouched');
  });
});
