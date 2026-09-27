import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, sanitizeSvg } from '../src/security/sanitize.js';
import { validateUpload, scanForSecrets, contentSecurityPolicy } from '../src/security/uploads.js';

describe('sanitizer: XSS blocked', () => {
  it('strips script + event handlers + javascript: urls', () => {
    const out = sanitizeHtml('<p onclick="evil()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    assert.ok(!out.includes('<script'), 'script removed');
    assert.ok(!out.includes('onclick'), 'handlers removed');
    assert.ok(!out.includes('javascript:'), 'js urls removed');
    assert.match(out, /<p>Hi<\/p>/);
  });
  it('drops inline svg but keeps img', () => {
    const out = sanitizeHtml('<svg onload="x"><circle/></svg><img src="/a.png" alt="a">');
    assert.ok(!out.includes('<svg'), 'inline svg dropped');
    assert.ok(out.includes('<img'), 'img kept');
  });
  it('only allows approved iframe hosts', () => {
    const evil = sanitizeHtml('<iframe src="https://evil.example/x"></iframe>');
    const good = sanitizeHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
    assert.ok(!evil.includes('<iframe'), 'evil iframe dropped');
    assert.ok(good.includes('youtube.com'), 'youtube kept');
  });
  it('rejects dangerous svg', () => {
    assert.equal(sanitizeSvg('<svg><script>alert(1)</script></svg>'), '');
    assert.equal(sanitizeSvg('<svg onload="x"></svg>'), '');
  });
});

describe('uploads: validation', () => {
  it('detects mime mismatch for classic formats', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = validateUpload({ filename: 'photo.jpg', mimeType: 'image/jpeg', size: 100, bytes: png });
    assert.ok(!r.ok, 'mismatch blocked');
  });
  it('blocks executables + traversal', () => {
    assert.ok(!validateUpload({ filename: 'x.exe', mimeType: 'application/x-msdownload', size: 10 }).ok);
    const r = validateUpload({ filename: '../../etc/passwd.png', mimeType: 'image/png', size: 10 });
    assert.ok(!r.normalizedFilename.includes('..'));
  });
});

describe('secret scanner + csp', () => {
  it('finds AWS keys in output', () => {
    const hits = scanForSecrets([['index.html', 'key AKIAIOSFODNN7EXAMPLE here']]);
    assert.equal(hits.length, 1);
  });
  it('ignores binaries, builds csp', () => {
    assert.equal(scanForSecrets([['a.png', 'AKIAIOSFODNN7EXAMPLE']]).length, 0);
    assert.match(contentSecurityPolicy({}), /frame-ancestors 'none'/);
  });
});
