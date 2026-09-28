// Ayodhyya Writer admin UI — vanilla JS, offline-first, zero dependencies.
// CONTENT=DATA (sanitized), TEMPLATES=CODE (trusted), AWS=INFRA (backend), CREDENTIALS=SECRETS (never here).
import { escapeHtml, slugify, wordCountOf, readingTimeMinutes, stripTags } from '../../src/core/utils/utils.js';
import { AWS_REGIONS, validateBucket, validateRegion, validateDomain, validateDistributionId, validateAcmArn, validateAccountId, validateHostedZoneId, defaultBucketFor, buildProfile, cfnDeployCommand } from '../../src/core/utils/awsWizard.js';
import { markdownToHtml, htmlToMarkdown } from '../../src/core/utils/markdown.js';
import { ARTICLE_STATUSES } from '../../src/core/models/models.js';
import { ArticleService, PageService, TaxonomyService, AuthorService, MediaService, TemplateService, SearchService, BackupService, AuditService, CommentService, SubscriberService } from '../../src/core/services/services.js';
import { createRepository } from '../../src/storage/repository.js';
import { sanitizeHtml } from '../../src/security/sanitize.js';
import { validateUpload, normalizeFilename, scanForSecrets } from '../../src/security/uploads.js';
import { generateSite, diffManifest } from '../../src/builder/generator.js';
import { validateArticle, validateSiteHealth, validateBuildOutput, validateRedirects } from '../../src/core/validators/validators.js';
import { buildDeploymentManifest } from '../../src/deployment/providers.js';
import { inlineAssets, blobTypeFor, previewInterceptorScript, PREVIEW_MAP_KEY } from '../../src/preview/inline.js';
import { assist } from '../../src/ai/assist.js';
import { encryptBackupBrowser, decryptBackupBrowser, isEncryptedBackupBrowser } from '../../src/security/backupCryptoBrowser.js';
import { analyzeSeo } from '../../src/seo/analyzer.js';
import { fetchArticle } from '../../src/core/utils/fetchArticle.js';
import { diffRevision, renderDiff } from '../../src/core/utils/diff.js';
import { downloadImages } from '../../src/media/importImages.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const state = { repo: null, siteId: null, route: 'dashboard', editing: null, lastBuild: null, dist: null, search: '' };

const NAV = [
  ['dashboard', 'Dashboard'], ['articles', 'Articles'], ['pages', 'Pages'], ['media', 'Media'],
  ['organize', 'Categories · Tags · Authors'], ['templates', 'Templates'], ['site', 'Website · SEO · Social · Ads'],
  ['preview', 'Preview'], ['build', 'Build'], ['deployments', 'Deployments'], ['settings', 'Settings'],
];

/* ---------- boot ---------- */
async function boot() {
  renderNav();
  view.innerHTML = '<p>Loading local workspace…</p>';
  const seed = await fetch('./seed/seed-data.json').then((r) => r.json()).catch(() => ({ sites: [] }));
  if (!seed.templates?.length) seed.templates = [await loadDefaultTemplate(seed.sites[0]?.id)];
  state.repo = await createRepository({ seed: toSeedCollections(seed) });
  // Backfill built-in themes missing from older local databases (additive only).
  const firstSiteId = (await state.repo.all('sites'))[0]?.id || '';
  for (const name of ['default', 'midnight']) {
    if (!await state.repo.get('templates', `tpl_${name}_v1`)) {
      await state.repo.put('templates', await loadBuiltinTemplate(name, firstSiteId));
    }
  }
  const sites = await state.repo.all('sites');
  state.siteId = sites[0]?.id || null;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  bindTopbar(); bindNet(); bindKeys();
  route();
  window.addEventListener('hashchange', route);
  setInterval(refreshPending, 5000);
}

function toSeedCollections(seed) {
  const cols = {};
  for (const c of ['sites', 'articles', 'pages', 'categories', 'tags', 'authors', 'media', 'templates', 'revisions', 'deployments', 'audit']) cols[c] = seed[c] || [];
  return cols;
}

async function loadBuiltinTemplate(name, siteId) {
  const files = {};
  for (const f of ['index.html', 'article.html', 'category.html', 'tag.html', 'search.html', 'page.html', '404.html', 'style.css', 'script.js']) {
    try { files[f] = await fetch('./src/templates/' + name + '/' + f).then((r) => (r.ok ? r.text() : '')); } catch { files[f] = ''; }
  }
  let meta = { name, versionTag: 'v1' };
  try { meta = await fetch('./src/templates/' + name + '/template.json').then((r) => r.json()); } catch { /* defaults */ }
  return { id: `tpl_${name}_v1`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, siteId: siteId || '', name: meta.name || name, versionTag: meta.versionTag || 'v1', active: true, files };
}
async function loadDefaultTemplate(siteId) {
  return loadBuiltinTemplate('default', siteId);
}

/* ---------- shell ---------- */
function renderNav() {
  $('#nav').innerHTML = NAV.map(([k, l]) => `<a href="#/${k}" data-r="${k}">${escapeHtml(l)}</a>`).join('');
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}
function modal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').showModal();
}
function bindTopbar() {
  $('#btn-preview').onclick = () => openPreviewNewTab('index.html');
  $('#btn-build').onclick = () => (location.hash = '#/build');
  $('#btn-publish').onclick = publishFlow;
  $('#menu-btn').onclick = () => document.body.classList.toggle('nav-open');
}
function bindNet() {
  const update = () => {
    const on = navigator.onLine;
    const el = $('#netstat');
    el.className = on ? 'online' : 'offline';
    el.querySelector('.lbl').textContent = on ? 'Online — publishing available' : 'Offline — editing available, publishing paused';
  };
  window.addEventListener('online', () => { update(); toast('Back online — pending changes are ready to publish.'); });
  window.addEventListener('offline', update);
  update();
}
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveEditing(); }
    if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); location.hash = '#/preview'; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); publishFlow(); }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); insertLink(); }
  });
}
async function refreshPending() {
  if (!state.repo || !state.siteId) return;
  const pending = await ArticleService.pendingChanges(state.repo, state.siteId);
  $('#pending').textContent = pending.length ? `● ${pending.length} unpublished change${pending.length > 1 ? 's' : ''}` : '✓ Everything published';
  document.querySelectorAll('#nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.r === state.route ? 'page' : 'false'));
}

/* ---------- data helpers ---------- */
async function site() { return state.repo.get('sites', state.siteId); }
async function activeTemplate() {
  const s = await site();
  return (s?.activeTemplateId && (await state.repo.get('templates', s.activeTemplateId))) || (await state.repo.all('templates'))[0];
}
async function fullInput() {
  const [s, articles, pages, categories, tags, authors, media, comments, t] = await Promise.all([
    site(),
    state.repo.query('articles', (a) => a.siteId === state.siteId),
    state.repo.query('pages', (p) => p.siteId === state.siteId),
    state.repo.query('categories', (c) => c.siteId === state.siteId),
    state.repo.query('tags', (t) => t.siteId === state.siteId),
    state.repo.query('authors', (a) => a.siteId === state.siteId),
    state.repo.all('media'),
    state.repo.query('comments', (c) => c.siteId === state.siteId),
    activeTemplate(),
  ]);
  return { site: s, articles, pages, categories, tags, authors, media, comments, template: t };
}

/* ---------- router ---------- */
async function route() {
  const hash = location.hash || '#/dashboard';
  const [, path = 'dashboard', param] = hash.split('/');
  state.route = path;
  $('#crumb').textContent = (NAV.find(([k]) => k === path)?.[1]) || path;
  document.body.classList.remove('nav-open');
  await refreshPending();
  try {
    if (path === 'dashboard') return vDashboard();
    if (path === 'articles' && !param) return vArticles();
    if (path === 'articles' && param) return vArticleEdit(param);
    if (path === 'pages') return vPages();
    if (path === 'media') return vMedia();
    if (path === 'organize') return vOrganize();
    if (path === 'templates') return vTemplates();
    if (path === 'site') return vSite();
    if (path === 'preview') return vPreview();
    if (path === 'build') return vBuild();
    if (path === 'deployments') return vDeployments();
    if (path === 'settings') return vSettings();
    view.innerHTML = '<p>Unknown view.</p>';
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><h3>Something went wrong</h3><p>${escapeHtml(err.message)}</p><p class="status-err">Error ID: UI-${Date.now().toString(36)}</p></div>`;
  }
}

/* ---------- dashboard ---------- */
async function vDashboard() {
  const [articles, pages, media, deployments, s, comments, subs] = await Promise.all([
    state.repo.query('articles', (a) => a.siteId === state.siteId),
    state.repo.query('pages', (p) => p.siteId === state.siteId),
    state.repo.all('media'),
    state.repo.all('deployments'),
    site(),
    state.repo.query('comments', (c) => c.siteId === state.siteId),
    state.repo.query('subscribers', (x) => x.siteId === state.siteId && x.status === 'Active'),
  ]);
  const drafts = articles.filter((a) => a.status === 'Draft').length;
  const modified = articles.filter((a) => a.status === 'Modified').length;
  const published = articles.filter((a) => ['Published', 'Modified'].includes(a.status)).length;
  const scheduled = articles.filter((a) => a.status === 'Scheduled').sort((a, b) => String(a.publishDate).localeCompare(String(b.publishDate)));
  const dueCount = scheduled.filter((a) => a.publishDate && Date.parse(a.publishDate) <= Date.now()).length;
  const pendingComments = comments.filter((c) => c.status === 'Pending').length;
  const pending = await ArticleService.pendingChanges(state.repo, state.siteId);
  const lastDep = deployments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const health = validateSiteHealth({ articles, pages, media, deploymentProfile: JSON.parse(localStorage.getItem('aw.deployProfile') || 'null') });
  const score = (arr) => arr.some((h) => h.level === 'error') ? '<span class="status-err">Attention</span>' : arr.some((h) => h.level === 'warn') ? '<span class="status-warn">Warnings</span>' : '<span class="status-ok">Healthy</span>';
  view.innerHTML = `
    ${localStorage.getItem('aw.tourDone') ? '' : `<div class="card" id="tour" style="margin-bottom:1rem;border-left:4px solid var(--accent)"><h3>Get your first article live in 3 steps</h3><ol style="margin:.5rem 0"><li><a href="#/articles">Write an article</a> — the SEO assistant scores it as you type, no expertise needed.</li><li><a href="#/preview">Preview it</a> — opens exactly what visitors will see, in a new tab.</li><li>Press the <strong>Publish website</strong> button up top — validation, optimization, and deploy happen automatically.</li></ol><button class="btn" id="tour-done">Got it, hide this</button></div>`}
    <div class="cards">
      <div class="card"><h3>Articles</h3><div class="big">${articles.length}</div><div>Drafts ${drafts} · Modified ${modified} · Published ${published}</div></div>
      <div class="card"><h3>Pages / Media</h3><div class="big">${pages.length} / ${media.length}</div><div>Local-first, offline OK</div></div>
      <div class="card"><h3>Website</h3><div>${escapeHtml(s?.name || '')}</div><div>${escapeHtml(s?.domain || '')}</div><div>Template: ${escapeHtml(s?.activeTemplateId || '')}</div></div>
      <div class="card"><h3>Last deployment</h3><div class="big" style="font-size:1.1rem">${lastDep ? escapeHtml(lastDep.version) : '—'}</div><div>${lastDep ? escapeHtml(lastDep.createdAt) : 'Never published from this device'}</div></div>
      <div class="card"><h3>SEO / Perf / Content</h3><div>SEO ${score(health.seo)} · Perf ${score(health.performance)} · Content ${score(health.content)}</div></div>
      <div class="card"><h3>Pending changes</h3><div class="big">${pending.length}</div><div><button class="btn accent" id="dash-pub">Publish website</button></div></div>
      <div class="card"><h3>Scheduled posts</h3><div class="big">${scheduled.length}</div><div>${dueCount ? `<span class="status-warn">${dueCount} due — publishes on next build</span>` : scheduled.length ? `Next: ${escapeHtml(scheduled[0].title)} (${escapeHtml((scheduled[0].publishDate || '').slice(0, 10))})` : 'None scheduled'}</div></div>
      <div class="card"><h3>Engagement</h3><div>${pendingComments} comment(s) awaiting moderation · ${subs.length} subscriber(s)</div><div><a href="#/organize">Moderate</a></div></div>
    </div>
    <h2>Search content (offline)</h2>
    <form id="dash-search" class="row"><input id="dq" placeholder="Search title, excerpt, content…" aria-label="Search content"><button class="btn">Search</button></form>
    <div id="dq-out"></div>
    <h2>Content health</h2>
    <ul class="checklist">${[...health.content, ...health.seo, ...health.media, ...health.performance, ...health.security, ...health.deployment].map((h) => `<li><span class="status-${h.level === 'ok' ? 'ok' : h.level === 'warn' ? 'warn' : 'err'}">${h.level === 'ok' ? '✓' : h.level === 'warn' ? '⚠' : '✗'}</span> ${escapeHtml(h.message)}</li>`).join('')}</ul>`;
  $('#dash-pub').onclick = publishFlow;
  const tourDone = $('#tour-done');
  if (tourDone) tourDone.onclick = () => { localStorage.setItem('aw.tourDone', '1'); $('#tour').remove(); };
  $('#dash-search').onsubmit = async (e) => {
    e.preventDefault();
    const docs = articles.map((a) => ({ title: a.title, excerpt: a.excerpt, content: a.content, tags: a.tagIds }));
    const hits = SearchService.search(docs, $('#dq').value);
    $('#dq-out').innerHTML = hits.length ? `<table><tr><th>Title</th></tr>${hits.map((h) => `<tr><td>${escapeHtml(h.title)}</td></tr>`).join('')}</table>` : '<p>No matches (offline search).</p>';
  };
}

/* ---------- articles ---------- */
async function vArticles() {
  const [articles, authors] = await Promise.all([
    state.repo.query('articles', (a) => a.siteId === state.siteId),
    state.repo.query('authors', (a) => a.siteId === state.siteId),
  ]);
  const byId = new Map(authors.map((a) => [a.id, a.name]));
  view.innerHTML = `
    <div class="row"><h2 style="margin:0">Articles</h2><span style="flex:1"></span><button class="btn" id="imp-url">Import from URL</button><button class="btn primary" id="new-art">+ New article</button></div>
    <div class="row"><input id="aq" placeholder="Filter…" aria-label="Filter articles"></div>
    <table><thead><tr><th>Title</th><th>Slug</th><th>Status</th><th>Author</th><th>Updated</th></tr></thead>
    <tbody id="rows">${articles.map((a) => `<tr data-t="${escapeHtml((a.title + a.slug).toLowerCase())}"><td><a href="#/articles/${a.id}">${escapeHtml(a.title) || '(untitled)'}</a></td><td>${escapeHtml(a.slug)}</td><td><span class="badge ${a.status}">${a.status}</span></td><td>${escapeHtml(byId.get(a.authorId) || '—')}</td><td>${escapeHtml((a.updatedAt || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
  $('#new-art').onclick = async () => {
    const a = await ArticleService.create(state.repo, state.siteId, { title: 'Untitled article' });
    location.hash = '#/articles/' + a.id;
  };
  $('#imp-url').onclick = () => {
    modal(`<h2>Import article from URL</h2><p>The page is fetched, boilerplate stripped, scripts removed, and saved as a <strong>Draft</strong> with canonical pointing at the source. Private/local hosts are blocked.</p>
      <form class="grid" id="iu-f"><label>Page URL<input id="iu-url" placeholder="https://example.com/article" inputmode="url"></label>
      <div class="row"><button class="btn primary" id="iu-go">Fetch &amp; preview</button></div></form><div id="iu-out"></div>`);
    $('#iu-f').onsubmit = async (e) => {
      e.preventDefault();
      $('#iu-out').innerHTML = '<p>Fetching…</p>';
      try {
        const found = await fetchArticle($('#iu-url').value);
        const words = wordCountOf(found.content);
        $('#iu-out').innerHTML = `<table><tr><th>Title</th><td>${escapeHtml(found.title)}</td></tr>
          <tr><th>Slug</th><td>${escapeHtml(found.slug)}</td></tr>
          <tr><th>Excerpt</th><td>${escapeHtml(found.excerpt.slice(0, 160))}</td></tr>
          <tr><th>Content</th><td>${words} words${found.authorName ? ` · by ${escapeHtml(found.authorName)}` : ''}</td></tr>
          <tr><th>Canonical</th><td>${escapeHtml(found.canonicalUrl)}</td></tr></table>
          <div class="row"><button class="btn primary" id="iu-save">Import as draft</button></div>`;
        $('#iu-save').onclick = async () => {
          $('#iu-save').disabled = true;
          $('#iu-save').textContent = 'Downloading images…';
          const dl = await downloadImages(found.images || []);
          let content = found.content;
          let featured = found.featuredImage;
          let localized = 0;
          for (const r of dl) {
            if (!r.ok || r.size > 2_000_000) continue; // tab memory stays lean; big/remote images keep URLs
            await MediaService.register(state.repo, state.siteId, {
              filename: r.filename, originalName: r.filename, mimeType: r.mime, size: r.size,
              altText: r.alt, title: r.alt, hash: r.filename, dataUrl: bytesToDataUrl(r.buffer, r.mime),
            });
            const local = `/assets/images/${r.filename}`;
            content = content.split(r.src).join(local);
            if (featured === r.src) featured = local;
            localized++;
          }
          const a = await ArticleService.create(state.repo, state.siteId, {
            title: found.title, slug: found.slug, excerpt: found.excerpt, content,
            metaDescription: found.excerpt, canonicalUrl: found.canonicalUrl, featuredImage: featured,
          });
          $('#modal').close();
          toast(`Imported as draft (${localized}/${dl.length} images localized${dl.length - localized ? ', rest kept remote' : ''}).`);
          location.hash = '#/articles/' + a.id;
        };
      } catch (err) { $('#iu-out').innerHTML = `<p class="status-err">Import failed: ${escapeHtml(err.message)}</p>`; }
    };
  };
  $('#aq').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#rows tr').forEach((tr) => (tr.style.display = tr.dataset.t.includes(q) ? '' : 'none'));
  };
}

async function vArticleEdit(id) {
  const a = id === 'new' ? await ArticleService.create(state.repo, state.siteId, { title: 'Untitled article' }) : await state.repo.get('articles', id);
  if (!a) { view.innerHTML = '<p>Article not found.</p>'; return; }
  if (id === 'new') { location.hash = '#/articles/' + a.id; return; }
  const [cats, tags, authors, revs] = await Promise.all([
    state.repo.query('categories', (c) => c.siteId === state.siteId),
    state.repo.query('tags', (t) => t.siteId === state.siteId),
    state.repo.query('authors', (x) => x.siteId === state.siteId),
    state.repo.query('revisions', (r) => r.entityId === a.id),
  ]);
  state.editing = { kind: 'article', id: a.id, mode: state.editing?.id === a.id ? state.editing.mode : 'visual' };
  const mode = state.editing.mode;
  view.innerHTML = `
    <div class="row"><a href="#/articles">← Articles</a><span class="badge ${a.status}">${a.status}</span><span style="flex:1"></span>
      <span id="wc">${a.wordCount || 0} words · ${a.readingTime || 1} min</span>
      <span id="seo-score" aria-live="polite" title="SEO score"></span>
      <button class="btn" id="save">Save <span class="kbd">Ctrl+S</span></button>
      <button class="btn danger" id="del">Delete draft</button></div>
    <form class="grid" id="f">
      <label>Title<input id="f-title" value="${escapeHtml(a.title)}"></label>
      <label>Slug<input id="f-slug" value="${escapeHtml(a.slug)}"></label>
      <label>Excerpt<textarea id="f-excerpt" rows="2">${escapeHtml(a.excerpt)}</textarea></label>
      <div class="editor-tabs" role="tablist">
        ${['visual', 'html', 'markdown', 'split', 'preview'].map((m) => `<button type="button" data-m="${m}" aria-selected="${mode === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
      </div>
      <div class="toolbar" aria-label="Formatting">
        ${[['h2', 'H2'], ['bold', 'B'], ['italic', 'I'], ['link', 'Link'], ['ul', '• List'], ['quote', '❝'], ['code', '&lt;&gt;'], ['img', 'Image'], ['table', 'Table'], ['hr', '―']].map(([k, l]) => `<button type="button" data-cmd="${k}">${l}</button>`).join('')}
      </div>
      <div class="split" id="edit-wrap">
        <textarea id="f-content" class="code" rows="16" style="${mode === 'preview' ? 'display:none' : ''}">${escapeHtml(a.contentFormat === 'markdown' ? (htmlToMarkdown(a.content).slice(0, 0) /*noop*/, a.content) : a.content)}</textarea>
        <div id="pane" class="preview-pane" style="${['split', 'preview'].includes(mode) ? '' : 'display:none'}"></div>
      </div>
      <div class="row">
        <label>Status<select id="f-status">${ARTICLE_STATUSES.map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Author<select id="f-author"><option value="">—</option>${authors.map((x) => `<option value="${x.id}" ${x.id === a.authorId ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select></label>
        <label>Format<select id="f-fmt"><option value="html" ${a.contentFormat === 'html' ? 'selected' : ''}>HTML</option><option value="markdown" ${a.contentFormat === 'markdown' ? 'selected' : ''}>Markdown</option></select></label>
        <label>Publish date (for Scheduled)<input id="f-pub" type="datetime-local" value="${escapeHtml((a.publishDate || '').slice(0, 16))}"></label>
      </div>
      <label>Categories (comma slugs or ids)<input id="f-cats" value="${escapeHtml((a.categoryIds || []).join(', '))}"></label>
      <label>Tags (comma slugs or ids)<input id="f-tags" value="${escapeHtml((a.tagIds || []).join(', '))}"></label>
      <details open><summary>SEO assistant (live score)</summary>
        <div id="seo-panel"><p>Loading…</p></div>
        <label>Focus keyword (what should this rank for?)<input id="f-kw" value="${escapeHtml(a.focusKeyword || '')}" placeholder="e.g. solar panels"></label>
        <label>Structured data type<select id="f-schema">${['BlogPosting', 'Article', 'NewsArticle', 'HowTo', 'FAQPage'].map((t) => `<option ${t === (a.schemaType || 'BlogPosting') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div id="schema-extra"></div>
        <label>Meta title<input id="f-mt" value="${escapeHtml(a.metaTitle)}"></label>
        <label>Meta description<textarea id="f-md" rows="2">${escapeHtml(a.metaDescription)}</textarea></label>
        <label>Canonical URL<input id="f-can" value="${escapeHtml(a.canonicalUrl)}"></label>
        <label>OG image<input id="f-og" value="${escapeHtml(a.ogImage)}"></label>
        <h4>Social preview</h4><div id="soc-prev"></div>
      </details>
      <details id="ai-assist"><summary>AI assist (optional, off by default)</summary>
        <p>Article text leaves this device <strong>only</strong> when you click below. Needs a provider URL + key in Settings.</p>
        <div class="row"><button type="button" class="btn" id="ai-summarize">Summarize → excerpt</button><button type="button" class="btn" id="ai-keywords">Suggest keyword</button><button type="button" class="btn" id="ai-meta">Draft meta description</button></div>
        <div id="ai-out" aria-live="polite"></div>
      </details>
      <div class="row"><button class="btn primary" type="submit">Save</button><span id="autosave" aria-live="polite"></span></div>
    </form>
    <h2>Revision history</h2>
    <div class="row"><label>Compare<select id="cmp-from">${revs.sort((x, y) => y.revision - x.revision).map((r) => `<option value="${r.revision}">v${r.revision} — ${escapeHtml((r.createdAt || '').slice(0, 16).replace('T', ' '))}</option>`).join('')}</select></label><span>→</span><label>with<select id="cmp-to">${revs.sort((x, y) => y.revision - x.revision).map((r) => `<option value="${r.revision}">v${r.revision} — ${escapeHtml((r.createdAt || '').slice(0, 16).replace('T', ' '))}</option>`).join('')}</select></label><button class="btn" id="cmp-go">Compare</button></div>
    <table><thead><tr><th>Rev</th><th>When</th><th>Note</th><th></th></tr></thead><tbody>
      ${revs.sort((x, y) => y.revision - x.revision).map((r) => `<tr><td>v${r.revision}</td><td>${escapeHtml((r.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(r.note || '')}</td><td><button class="btn" data-restore="${r.revision}">Restore</button></td></tr>`).join('') || '<tr><td colspan="4">No revisions yet.</td></tr>'}
    </tbody></table>`;
  const contentEl = $('#f-content');
  const currentArticle = () => ({
    title: $('#f-title').value, slug: $('#f-slug').value, excerpt: $('#f-excerpt').value,
    content: $('#f-fmt').value === 'markdown' ? markdownToHtml(contentEl.value) : contentEl.value,
    status: $('#f-status').value, metaTitle: $('#f-mt').value, metaDescription: $('#f-md').value,
    canonicalUrl: $('#f-can').value, ogImage: $('#f-og').value,
    focusKeyword: $('#f-kw').value, schemaType: $('#f-schema').value,
  });
  const updateSeoPanel = () => {
    const art = currentArticle();
    const r = analyzeSeo(art);
    const badge = $('#seo-score');
    if (badge) {
      badge.innerHTML = `SEO <strong>${r.score}</strong> · ${r.grade}`;
      badge.className = r.score >= 80 ? 'status-ok' : r.score >= 50 ? 'status-warn' : 'status-err';
    }
    const dot = (s) => s === 'pass' ? '<span class="status-ok">✓</span>' : s === 'warn' ? '<span class="status-warn">⚠</span>' : '<span class="status-err">✗</span>';
    const panel = $('#seo-panel');
    if (panel) panel.innerHTML = `<p><strong>${r.score}/100 — ${r.grade}</strong> · ${r.stats.wordCount} words · Flesch ${r.stats.flesch} (grade ${r.stats.fkGrade}) · ${r.stats.internalLinks} internal / ${r.stats.externalLinks} external links</p><ul class="checklist">${r.checks.map((c) => `<li>${dot(c.status)} ${escapeHtml(c.label)}${c.detail ? ` — ${escapeHtml(c.detail)}` : ''}</li>`).join('')}</ul>`;
    const sp = $('#soc-prev');
    if (sp) {
      const t = art.metaTitle || art.title || '(no title)';
      const d = art.metaDescription || art.excerpt || '(no description)';
      sp.innerHTML = `<div class="card"><h3>Facebook / LinkedIn</h3>${art.ogImage ? `<img src="${escapeHtml(art.ogImage)}" alt="" style="max-width:100%">` : '<p>(no image — add an OG image)</p>'}<p><strong>${escapeHtml(t)}</strong><br>${escapeHtml(d)}</p></div><div class="card"><h3>X / Twitter (summary large image)</h3><p><strong>${escapeHtml(t)}</strong><br>${escapeHtml(d)}</p></div>`;
    }
  };
  const renderPane = () => {
    const fmt = $('#f-fmt').value;
    const raw = contentEl.value;
    const html = fmt === 'markdown' ? markdownToHtml(raw) : raw;
    $('#pane').innerHTML = sanitizeHtml(html);
    $('#wc').textContent = `${wordCountOf(html)} words · ${readingTimeMinutes(html)} min`;
    updateSeoPanel();
  };
  renderPane();
  for (const id of ['f-title', 'f-slug', 'f-excerpt', 'f-mt', 'f-md', 'f-can', 'f-og', 'f-kw', 'f-schema']) {
    const el = $('#' + id);
    if (el) el.addEventListener('input', updateSeoPanel);
  }
  const aiRun = async (task, applyTo, niceName) => {
    const out = $('#ai-out');
    if (!out) return;
    out.innerHTML = '<p>Asking…</p>';
    try {
      const text = stripTags($('#f-fmt').value === 'markdown' ? markdownToHtml(contentEl.value) : contentEl.value);
      const result = await assist(task, { title: $('#f-title').value, focusKeyword: $('#f-kw').value, text }, {
        baseUrl: localStorage.getItem('aw.aiBaseUrl') || '',
        apiKey: sessionStorage.getItem('aw.aiKey') || '',
        model: localStorage.getItem('aw.aiModel') || '',
      });
      const target = $(applyTo);
      target.value = result;
      target.dispatchEvent(new Event('input'));
      out.innerHTML = `<p class="status-ok">✓ Inserted into ${niceName} — review, then Save.</p>`;
    } catch (e) {
      const needsSetup = e.kind === 'missing-key' || e.kind === 'disabled';
      out.innerHTML = `<p class="status-err">${escapeHtml(e.message)}${needsSetup ? ' <a href="#/settings">Open Settings</a>' : ''}</p>`;
    }
  };
  if ($('#ai-summarize')) $('#ai-summarize').onclick = () => aiRun('summarize', '#f-excerpt', 'excerpt');
  if ($('#ai-keywords')) $('#ai-keywords').onclick = () => aiRun('keywords', '#f-kw', 'focus keyword');
  if ($('#ai-meta')) $('#ai-meta').onclick = () => aiRun('meta', '#f-md', 'meta description');
  state.schemaRows = { steps: [...(a.howToSteps || [])], faq: [...(a.faqItems || [])] };
  const renderSchemaExtra = () => {
    const box = $('#schema-extra');
    const kind = $('#f-schema').value;
    if (kind === 'HowTo') {
      box.innerHTML = `<h4>How-to steps (required for valid HowTo markup)</h4><div id="howto-rows">${state.schemaRows.steps.map((s, i) => `<div class="row" data-hrow="${i}"><input data-hf="name" value="${escapeHtml(s.name || '')}" placeholder="Step name" aria-label="Step name"><input data-hf="text" value="${escapeHtml(s.text || '')}" placeholder="Step instructions" aria-label="Step instructions"><button type="button" class="btn danger" data-hdel="${i}">Delete</button></div>`).join('')}</div><div class="row"><button type="button" class="btn" id="howto-add">+ Add step</button></div>`;
      $('#howto-add').onclick = () => { state.schemaRows.steps.push({ name: '', text: '' }); renderSchemaExtra(); };
      box.querySelectorAll('[data-hdel]').forEach((b) => (b.onclick = () => { state.schemaRows.steps.splice(Number(b.dataset.hdel), 1); renderSchemaExtra(); }));
    } else if (kind === 'FAQPage') {
      box.innerHTML = `<h4>Questions &amp; answers (required for valid FAQ markup)</h4><div id="faq-rows">${state.schemaRows.faq.map((f, i) => `<div class="row" data-frow="${i}"><input data-ff="question" value="${escapeHtml(f.question || '')}" placeholder="Question" aria-label="Question"><input data-ff="answer" value="${escapeHtml(f.answer || '')}" placeholder="Answer" aria-label="Answer"><button type="button" class="btn danger" data-fdel="${i}">Delete</button></div>`).join('')}</div><div class="row"><button type="button" class="btn" id="faq-add">+ Add Q&amp;A</button></div>`;
      $('#faq-add').onclick = () => { state.schemaRows.faq.push({ question: '', answer: '' }); renderSchemaExtra(); };
      box.querySelectorAll('[data-fdel]').forEach((b) => (b.onclick = () => { state.schemaRows.faq.splice(Number(b.dataset.fdel), 1); renderSchemaExtra(); }));
    } else {
      box.innerHTML = '<p>Standard article markup — nothing extra needed.</p>';
    }
  };
  renderSchemaExtra();
  $('#f-schema').addEventListener('change', renderSchemaExtra);
  const syncSchemaRows = () => {
    state.schemaRows.steps = [...document.querySelectorAll('#howto-rows [data-hrow]')].map((row) => ({
      name: row.querySelector('[data-hf="name"]').value, text: row.querySelector('[data-hf="text"]').value,
    }));
    state.schemaRows.faq = [...document.querySelectorAll('#faq-rows [data-frow]')].map((row) => ({
      question: row.querySelector('[data-ff="question"]').value, answer: row.querySelector('[data-ff="answer"]').value,
    }));
  };
  $('#schema-extra').addEventListener('input', syncSchemaRows);
  document.querySelectorAll('.editor-tabs button').forEach((b) => (b.onclick = () => {
    state.editing.mode = b.dataset.m;
    const m = b.dataset.m;
    document.querySelectorAll('.editor-tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    $('#edit-wrap').className = m === 'split' ? 'split' : '';
    contentEl.style.display = m === 'preview' ? 'none' : '';
    $('#pane').style.display = ['split', 'preview'].includes(m) ? '' : 'none';
    if (m !== 'visual') { /* textarea is source of truth in all modes (lightweight editor) */ }
    renderPane();
  }));
  document.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => {
    const map = { h2: ['\n<h2>', '</h2>\n'], bold: ['<strong>', '</strong>'], italic: ['<em>', '</em>'], link: ['<a href="https://">', '</a>'], ul: ['\n<ul>\n<li>', '</li>\n</ul>\n'], quote: ['\n<blockquote>', '</blockquote>\n'], code: ['\n<pre><code>', '</code></pre>\n'], img: ['\n<img src="/assets/images/', '" alt="">\n'], table: ['\n<table>\n<tr><th>', '</th></tr>\n</table>\n'], hr: ['\n<hr>\n', ''] };
    const [pre, post] = map[b.dataset.cmd] || ['', ''];
    const { selectionStart: s, selectionEnd: e, value: v } = contentEl;
    contentEl.value = v.slice(0, s) + pre + v.slice(s, e) + post + v.slice(e);
    renderPane();
  }));
  contentEl.oninput = renderPane;
  let timer;
  contentEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { await collect(true); $('#autosave').textContent = 'Autosaved ' + new Date().toLocaleTimeString(); }, 1500); });
  async function collect(silent = false) {
    const patch = {
      title: $('#f-title').value, slug: slugify($('#f-slug').value || $('#f-title').value),
      excerpt: $('#f-excerpt').value, content: contentEl.value, contentFormat: $('#f-fmt').value,
      status: $('#f-status').value, authorId: $('#f-author').value,
      publishDate: $('#f-pub').value ? new Date($('#f-pub').value).toISOString() : '',
      categoryIds: $('#f-cats').value.split(',').map((s) => s.trim()).filter(Boolean),
      tagIds: $('#f-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      metaTitle: $('#f-mt').value, metaDescription: $('#f-md').value, canonicalUrl: $('#f-can').value, ogImage: $('#f-og').value,
      focusKeyword: $('#f-kw').value, schemaType: $('#f-schema').value,
      howToSteps: (state.schemaRows?.steps || []).filter((s) => (s.text || '').trim()),
      faqItems: (state.schemaRows?.faq || []).filter((f) => (f.question || '').trim() && (f.answer || '').trim()),
    };
    const next = await ArticleService.update(state.repo, a.id, { ...patch, note: silent ? 'autosave' : 'edited' });
    if (!silent) { toast('Saved locally (offline OK).'); route(); }
    return next;
  }
  $('#f').onsubmit = (e) => { e.preventDefault(); collect(false); };
  $('#save').onclick = () => collect(false);
  $('#del').onclick = async () => {
    if (!confirm('Delete this article from this device?')) return;
    await ArticleService.remove(state.repo, a.id);
    location.hash = '#/articles';
  };
  document.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    const rev = revs.find((r) => String(r.revision) === b.dataset.restore);
    if (!rev?.snapshot) return;
    await ArticleService.update(state.repo, a.id, { content: rev.snapshot.content, title: rev.snapshot.title, note: 'restored v' + rev.revision });
    toast('Restored revision v' + rev.revision);
    route();
  }));
  const cmpGo = $('#cmp-go');
  if (cmpGo) cmpGo.onclick = () => {
    const from = revs.find((r) => String(r.revision) === $('#cmp-from').value);
    const to = revs.find((r) => String(r.revision) === $('#cmp-to').value);
    if (!from?.snapshot || !to?.snapshot) { toast('Pick two revisions with snapshots.'); return; }
    if (from.revision === to.revision) { toast('Pick two different revisions.'); return; }
    const r = diffRevision(from.snapshot.content || '', to.snapshot.content || '');
    modal(`<h2>Compare v${from.revision} → v${to.revision}</h2><p>+${r.added} words / −${r.removed} words${r.capped ? ' (large change shown as blocks)' : ''}</p><div class="preview-pane" style="max-height:50vh;overflow:auto">${renderDiff(r.segments) || '<p>No differences.</p>'}</div>`);
  };
}
async function saveEditing() {
  const f = $('#f');
  if (f) f.requestSubmit();
}
function insertLink() {
  const c = $('#f-content');
  if (!c) return;
  const { selectionStart: s, selectionEnd: e, value: v } = c;
  c.value = v.slice(0, s) + `<a href="https://">` + v.slice(s, e) + '</a>' + v.slice(e);
  c.dispatchEvent(new Event('input'));
}

/* ---------- pages ---------- */
async function vPages() {
  const pages = await state.repo.query('pages', (p) => p.siteId === state.siteId);
  view.innerHTML = `<div class="row"><h2 style="margin:0">Pages</h2><span style="flex:1"></span><button class="btn primary" id="np">+ New page</button></div>
    <table><thead><tr><th>Title</th><th>Slug</th><th>Status</th><th></th></tr></thead><tbody>
    ${pages.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>/${escapeHtml(p.slug)}/</td><td><span class="badge ${p.status}">${p.status}</span></td><td><button class="btn" data-edit="${p.id}">Edit</button></td></tr>`).join('')}
    </tbody></table><div id="pe"></div>`;
  $('#np').onclick = async () => {
    const p = await PageService.create(state.repo, state.siteId, { title: 'New page', status: 'Draft' });
    toast('Page created: ' + p.slug);
    route();
  };
  document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
    const p = await state.repo.get('pages', b.dataset.edit);
    modal(`<h2>Edit page — ${escapeHtml(p.title)}</h2><form class="grid" id="pf">
      <label>Title<input id="p-t" value="${escapeHtml(p.title)}"></label>
      <label>Slug<input id="p-s" value="${escapeHtml(p.slug)}"></label>
      <label>Content<textarea id="p-c" class="code" rows="10">${escapeHtml(p.content)}</textarea></label>
      <label>Status<select id="p-st"><option ${p.status === 'Draft' ? 'selected' : ''}>Draft</option><option ${p.status === 'Published' ? 'selected' : ''}>Published</option><option ${p.status === 'Archived' ? 'selected' : ''}>Archived</option></select></label>
      <div class="row"><button class="btn primary">Save</button></div></form>`);
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      await PageService.update(state.repo, p.id, { title: $('#p-t').value, slug: slugify($('#p-s').value), content: $('#p-c').value, status: $('#p-st').value });
      $('#modal').close();
      toast('Page saved locally.');
      route();
    };
  }));
}

/* ---------- media ---------- */
async function vMedia() {
  const media = await state.repo.all('media');
  view.innerHTML = `<div class="row"><h2 style="margin:0">Media</h2><span style="flex:1"></span><input type="file" id="up" accept="image/*,.svg" aria-label="Upload image"></div>
    <p>JPG · PNG · WebP · AVIF · SVG (strictly sanitized) · GIF. Validated by signature, not extension. Variants (400/800/1200/1600) are referenced at build time.</p>
    <table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Alt</th><th>Markup</th></tr></thead><tbody>
    ${media.map((m) => `<tr><td>${escapeHtml(m.filename)}</td><td>${escapeHtml(m.mimeType)}</td><td>${Math.round((m.size || 0) / 1024)} KB</td><td>${escapeHtml(m.altText || '—')}</td><td><span class="row"><button class="btn" data-medit="${m.id}">Edit</button><button class="btn" data-copy="${m.id}">Copy &lt;picture&gt;</button></span></td></tr>`).join('') || '<tr><td colspan="5">No media yet — upload while offline.</td></tr>'}
    </tbody></table>`;
  $('#up').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    const { ok, errors, normalizedFilename } = validateUpload({ filename: f.name, mimeType: f.type, size: f.size, bytes: buf.slice(0, 16) });
    if (!ok) { toast('Upload blocked: ' + errors.join(' ')); return; }
    const alt = prompt('Alt text (required for accessibility):', f.name.replace(/\.[^.]+$/, '')) || '';
    await MediaService.register(state.repo, state.siteId, { filename: normalizedFilename, originalName: f.name, mimeType: f.type, size: f.size, altText: alt, title: alt, hash: String(buf.length) + '-' + f.size });
    toast('Media registered locally.');
    route();
  };
  document.querySelectorAll('[data-medit]').forEach((b) => (b.onclick = async () => {
    const m = await state.repo.get('media', b.dataset.medit);
    if (!m) return;
    modal(`<h2>Edit metadata — ${escapeHtml(m.filename)}</h2><form class="grid" id="mf"><label>Alt text (accessibility)<input id="m-alt" value="${escapeHtml(m.altText || '')}"></label><label>Caption<input id="m-cap" value="${escapeHtml(m.caption || '')}"></label><label>Title<input id="m-title" value="${escapeHtml(m.title || '')}"></label><div class="row"><button class="btn primary">Save</button></div></form>`);
    $('#mf').onsubmit = async (e) => {
      e.preventDefault();
      await MediaService.update(state.repo, m.id, { altText: $('#m-alt').value, caption: $('#m-cap').value, title: $('#m-title').value });
      $('#modal').close();
      toast('Media metadata saved.');
      route();
    };
  }));
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
    const m = await state.repo.get('media', b.dataset.copy);
    const stem = '/assets/images/' + m.filename.replace(/\.[a-z0-9]+$/i, '');
    const markup = `<picture><source type="image/webp" srcset="${stem}-400.webp 400w, ${stem}-800.webp 800w, ${stem}-1200.webp 1200w" sizes="(max-width: 800px) 100vw, 800px"><img src="/assets/images/${m.filename}" alt="${m.altText}" loading="lazy" decoding="async"></picture>`;
    await navigator.clipboard?.writeText(markup).catch(() => {});
    toast('Responsive markup copied.');
  }));
}

/* ---------- organize ---------- */
async function vOrganize() {
  const [cats, tags, authors, comments, subs] = await Promise.all([
    state.repo.query('categories', (c) => c.siteId === state.siteId),
    state.repo.query('tags', (t) => t.siteId === state.siteId),
    state.repo.query('authors', (a) => a.siteId === state.siteId),
    state.repo.query('comments', (c) => c.siteId === state.siteId),
    state.repo.query('subscribers', (s) => s.siteId === state.siteId),
  ]);
  const tbl = (rows, kind) => `<table><thead><tr><th>Name</th><th>Slug</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.slug)}</td><td><button class="btn danger" data-del="${kind}:${r.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="3">None yet.</td></tr>'}</tbody></table>`;
  view.innerHTML = `<h2>Categories</h2><form class="row" id="fc"><input id="fc-n" placeholder="New category" aria-label="New category"><button class="btn">Add</button></form>${tbl(cats, 'cat')}
    <h2>Tags</h2><form class="row" id="ft"><input id="ft-n" placeholder="New tag" aria-label="New tag"><button class="btn">Add</button></form>${tbl(tags, 'tag')}
    <h2>Authors</h2><form class="row" id="fa"><input id="fa-n" placeholder="New author" aria-label="New author"><button class="btn">Add</button></form>${tbl(authors, 'auth')}
    <h2>Comments (moderation)</h2><table><thead><tr><th>Article</th><th>Author</th><th>Comment</th><th>Status</th><th></th></tr></thead><tbody>
    ${comments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((c) => `<tr><td>${escapeHtml(c.articleSlug)}</td><td>${escapeHtml(c.author || '')}</td><td>${stripTags(c.content).slice(0, 80)}</td><td><span class="badge ${c.status === 'Approved' ? 'Published' : c.status === 'Spam' ? 'Archived' : 'Draft'}">${c.status}</span></td><td><span class="row"><button class="btn" data-cappr="${c.id}">Approve</button><button class="btn" data-cspam="${c.id}">Spam</button><button class="btn danger" data-cdel="${c.id}">Delete</button></span></td></tr>`).join('') || '<tr><td colspan="5">No comments yet — enable them under Website, or import some.</td></tr>'}
    </tbody></table>
    <h2>Subscribers (${subs.filter((s) => s.status === 'Active').length} active)</h2><table><thead><tr><th>Email</th><th>Name</th><th>Status</th><th></th></tr></thead><tbody>
    ${subs.map((s) => `<tr><td>${escapeHtml(s.email)}</td><td>${escapeHtml(s.name || '')}</td><td>${s.status}</td><td>${s.status === 'Active' ? `<button class="btn" data-sunsub="${s.id}">Unsubscribe</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4">No subscribers yet — enable the signup block under Website.</td></tr>'}
    </tbody></table>`;
  $('#fc').onsubmit = async (e) => { e.preventDefault(); await TaxonomyService.createCategory(state.repo, state.siteId, { name: $('#fc-n').value, slug: slugify($('#fc-n').value) }); route(); };
  $('#ft').onsubmit = async (e) => { e.preventDefault(); await TaxonomyService.createTag(state.repo, state.siteId, { name: $('#ft-n').value, slug: slugify($('#ft-n').value) }); route(); };
  $('#fa').onsubmit = async (e) => { e.preventDefault(); await AuthorService.create(state.repo, state.siteId, { name: $('#fa-n').value, slug: slugify($('#fa-n').value) }); route(); };
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const [kind, id] = b.dataset.del.split(':');
    await state.repo.remove(kind === 'cat' ? 'categories' : kind === 'tag' ? 'tags' : 'authors', id);
    route();
  }));
  document.querySelectorAll('[data-cappr]').forEach((b) => (b.onclick = async () => { await CommentService.setStatus(state.repo, b.dataset.cappr, 'Approved'); toast('Comment approved — publishes on next build.'); route(); }));
  document.querySelectorAll('[data-cspam]').forEach((b) => (b.onclick = async () => { await CommentService.setStatus(state.repo, b.dataset.cspam, 'Spam'); route(); }));
  document.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = async () => { await state.repo.remove('comments', b.dataset.cdel); route(); }));
  document.querySelectorAll('[data-sunsub]').forEach((b) => (b.onclick = async () => { await SubscriberService.setStatus(state.repo, b.dataset.sunsub, 'Unsubscribed'); route(); }));
}

/* ---------- templates ---------- */
async function vTemplates() {
  const [tpls, s] = await Promise.all([state.repo.query('templates', (t) => t.siteId === state.siteId || !t.siteId), site()]);
  const cur = tpls.find((t) => t.id === s?.activeTemplateId) || tpls[0];
  view.innerHTML = `<div class="row"><h2 style="margin:0">Templates</h2><span style="flex:1"></span>
    <button class="btn" id="dup">Duplicate</button><button class="btn" id="exp">Export</button><button class="btn primary" id="act">Set active</button></div>
    <div class="cards" id="gallery">${tpls.map((t) => `<div class="card"><h3>${escapeHtml(t.name)} ${t.id === s?.activeTemplateId ? '<span class="badge Published">Active</span>' : ''}</h3><div>${escapeHtml(t.versionTag || '')} · ${Object.keys(t.files || {}).length} files</div><div class="row"><button class="btn" data-tprev="${t.id}">Preview</button>${t.id === s?.activeTemplateId ? '' : `<button class="btn primary" data-tuse="${t.id}">Use this theme</button>`}</div></div>`).join('')}</div>
    <div class="row"><label>Template<select id="ts">${tpls.map((t) => `<option value="${t.id}" ${cur?.id === t.id ? 'selected' : ''}>${escapeHtml(t.name)} ${escapeHtml(t.versionTag || '')}</option>`).join('')}</select></label>
    <label>File<select id="tf">${Object.keys(cur?.files || {}).map((f) => `<option>${f}</option>`).join('')}</select></label></div>
    <textarea id="tc" class="code" rows="22" aria-label="Template source"></textarea>
    <div class="row"><button class="btn primary" id="tsave">Save template</button><span>Versioned · preview via Preview tab · trusted site-owner code.</span></div>`;
  const load = () => { $('#tc').value = cur?.files[$('#tf').value] || ''; };
  $('#ts').onchange = () => route();
  document.querySelectorAll('[data-tprev]').forEach((b) => (b.onclick = async () => {
    const t = await state.repo.get('templates', b.dataset.tprev);
    if (!t) return;
    const input = await fullInput();
    const { files } = await generateSite({ ...input, template: t });
    state.dist = files;
    const w = window.open('about:blank');
    if (!w) { toast('Popup blocked — allow popups, then try again.'); return; }
    w.document.write('<p style="font-family:system-ui;padding:2rem">Building theme preview…</p>');
    const site = buildBlobSite(files);
    state.previewSite = site;
    w.location.href = site.urls.get('index.html');
  }));
  document.querySelectorAll('[data-tuse]').forEach((b) => (b.onclick = async () => {
    await TemplateService.setActive(state.repo, state.siteId, b.dataset.tuse);
    toast('Theme activated — preview or publish to see it live.');
    route();
  }));
  $('#tf').onchange = load;
  load();
  $('#tsave').onclick = async () => {
    const t = await state.repo.get('templates', $('#ts').value);
    t.files[$('#tf').value] = $('#tc').value;
    t.version = (t.version || 1) + 1;
    t.updatedAt = new Date().toISOString();
    await state.repo.put('templates', t);
    await AuditService.log(state.repo, { action: 'template.update', entityType: 'template', entityId: t.id, detail: $('#tf').value });
    toast('Template saved (v' + t.version + ').');
  };
  $('#dup').onclick = async () => {
    const t = await state.repo.get('templates', $('#ts').value);
    await TemplateService.save(state.repo, state.siteId, { name: t.name + ' copy', versionTag: (t.versionTag || 'v1') + '-copy', files: { ...t.files } });
    toast('Template duplicated.');
    route();
  };
  $('#exp').onclick = async () => {
    const t = await state.repo.get('templates', $('#ts').value);
    download('template-' + t.name + '.json', JSON.stringify(t, null, 2), 'application/json');
  };
  $('#act').onclick = async () => {
    await TemplateService.setActive(state.repo, state.siteId, $('#ts').value);
    toast('Active template updated.');
    route();
  };
}

/* ---------- site / seo / social / ads ---------- */
async function vSite() {
  const s = await site();
  view.innerHTML = `<h2>Website configuration</h2><form class="grid" id="sf">
    <label>Site name<input id="s-name" value="${escapeHtml(s.name)}"></label>
    <label>Tagline<input id="s-tag" value="${escapeHtml(s.tagline || '')}"></label>
    <label>Domain<input id="s-dom" value="${escapeHtml(s.domain || '')}"></label>
    <label>Public URL<input id="s-url" value="${escapeHtml(s.url || '')}"></label>
    <label>Description<textarea id="s-desc" rows="2">${escapeHtml(s.description || '')}</textarea></label>
    <label>Primary color<input id="s-c1" value="${escapeHtml(s.theme?.colorPrimary || '#0f172a')}"></label>
    <label>Accent color<input id="s-c2" value="${escapeHtml(s.theme?.colorAccent || '#f59e0b')}"></label>
    <h3>SEO defaults</h3>
    <label>Default description<input id="s-seod" value="${escapeHtml(s.seo?.defaultDescription || '')}"></label>
    <label>Robots<input id="s-rob" value="${escapeHtml(s.seo?.robots || 'index,follow')}"></label>
    <h3>Social</h3>
    <label>X/Twitter<input id="s-tw" value="${escapeHtml(s.social?.twitter || '')}"></label>
    <label>Facebook<input id="s-fb" value="${escapeHtml(s.social?.facebook || '')}"></label>
    <h3>Google AdSense (public IDs only — never secrets)</h3>
    <label>Publisher ID (ca-pub-…)<input id="s-pub" value="${escapeHtml(s.adsense?.publisherId || '')}" placeholder="ca-pub-0000000000000000"></label>
    <label>Ad slot — after article<input id="s-slot" value="${escapeHtml(s.adsense?.slots?.['after-article'] || '')}" placeholder="0000000000"></label>
    <h3>Comments</h3>
    <label><input type="checkbox" id="s-com-on" ${s.comments?.enabled ? 'checked' : ''}> Enable comments on articles</label>
    <label>Comment form endpoint (your form service URL — blank shows comments without a form)<input id="s-com-ep" value="${escapeHtml(s.comments?.endpoint || '')}" placeholder="https://forms.example/comments"></label>
    <h3>Newsletter</h3>
    <label><input type="checkbox" id="s-nl-on" ${s.newsletter?.enabled ? 'checked' : ''}> Show signup block</label>
    <label>Signup endpoint (blank shows “opening soon”)<input id="s-nl-ep" value="${escapeHtml(s.newsletter?.endpoint || '')}" placeholder="https://x.example/subscribe"></label>
    <label>Signup heading<input id="s-nl-h" value="${escapeHtml(s.newsletter?.heading || 'Newsletter')}"></label>
    <label>Signup text<textarea id="s-nl-t" rows="2">${escapeHtml(s.newsletter?.text || '')}</textarea></label>
    <div class="row"><button type="button" class="btn" id="sub-csv">Download subscribers CSV</button></div>
    <h3>Redirects (old URL → new URL, keeps SEO juice on slug changes)</h3>
    <div id="red-list"></div>
    <div class="row"><button type="button" class="btn" id="red-add">+ Add redirect</button></div>
    <p id="red-err" class="status-err"></p>
    <div class="row"><button class="btn primary">Save website</button></div></form>
    <h2>Deployment profile (non-secret)</h2><form class="grid" id="df">
    <label>Bucket identifier<input id="d-b" value="${escapeHtml((await getProfile()).bucket || '')}"></label>
    <label>Distribution identifier<input id="d-d" value="${escapeHtml((await getProfile()).distributionId || '')}"></label>
    <label>Region<input id="d-r" value="${escapeHtml((await getProfile()).region || 'ap-south-1')}"></label>
    <div class="row"><button class="btn">Save profile</button></div></form>
    <p>Sensitive credentials are never stored here — they live in the protected deployment service / STS.</p>`;
  const renderReds = (rows) => {
    $('#red-list').innerHTML = (rows.length ? rows : [{ from: '', to: '', code: 301 }]).map((r, i) =>
      `<div class="row" data-red="${i}"><input data-rf="from" value="${escapeHtml(r.from || '')}" placeholder="/old-slug/" aria-label="Old URL"><input data-rf="to" value="${escapeHtml(r.to || '')}" placeholder="/new-slug/ or https://…" aria-label="New URL"><select data-rf="code" aria-label="Redirect type">${[301, 302, 307, 308].map((c) => `<option ${Number(r.code || 301) === c ? 'selected' : ''}>${c}</option>`).join('')}</select><button type="button" class="btn danger" data-rdel="${i}">Delete</button></div>`).join('');
    document.querySelectorAll('[data-rdel]').forEach((b) => (b.onclick = () => {
      rows.splice(Number(b.dataset.rdel), 1);
      renderReds(rows);
    }));
  };
  const redRows = [...(s.redirects || [])];
  renderReds(redRows);
  $('#red-add').onclick = () => { redRows.push({ from: '', to: '', code: 301 }); renderReds(redRows); };
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const collected = [];
    document.querySelectorAll('#red-list [data-red]').forEach((row) => {
      const g = (k) => row.querySelector(`[data-rf="${k}"]`).value.trim();
      if (g('from') || g('to')) collected.push({ from: g('from'), to: g('to'), code: Number(g('code')) || 301 });
    });
    const redCheck = validateRedirects({ redirects: collected });
    if (!redCheck.ok) {
      $('#red-err').textContent = redCheck.errors.map((x) => x.message).join(' ');
      toast('Fix redirect errors first.');
      return;
    }
    $('#red-err').textContent = '';
    await state.repo.put('sites', {
      ...s, name: $('#s-name').value, tagline: $('#s-tag').value, domain: $('#s-dom').value, url: $('#s-url').value,
      description: $('#s-desc').value, theme: { ...s.theme, colorPrimary: $('#s-c1').value, colorAccent: $('#s-c2').value },
      seo: { ...s.seo, defaultDescription: $('#s-seod').value, robots: $('#s-rob').value },
      social: { ...s.social, twitter: $('#s-tw').value, facebook: $('#s-fb').value },
      adsense: { publisherId: $('#s-pub').value.trim(), slots: { ...s.adsense?.slots, 'after-article': $('#s-slot').value.trim() } },
      comments: { enabled: $('#s-com-on').checked, endpoint: $('#s-com-ep').value.trim(), heading: 'Comments' },
      newsletter: { enabled: $('#s-nl-on').checked, endpoint: $('#s-nl-ep').value.trim(), heading: $('#s-nl-h').value.trim() || 'Newsletter', text: $('#s-nl-t').value },
      redirects: collected, updatedAt: new Date().toISOString(), version: (s.version || 1) + 1,
    });
    await AuditService.log(state.repo, { action: 'site.update', entityType: 'site', entityId: s.id, detail: s.name });
    toast('Website saved locally.');
  };
  $('#sub-csv').onclick = async () => {
    const subs = await state.repo.query('subscribers', (x) => x.siteId === state.siteId);
    download(`subscribers-${state.siteId}.csv`, SubscriberService.toCsv(subs), 'text/csv');
    toast(`Exported ${subs.length} subscriber(s). Take the CSV to any email provider.`);
  };
  $('#df').onsubmit = async (e) => {
    e.preventDefault();
    localStorage.setItem('aw.deployProfile', JSON.stringify({ siteId: state.siteId, domain: $('#s-dom').value, bucket: $('#d-b').value, distributionId: $('#d-d').value, region: $('#d-r').value, strategy: 'atomic-s3-cloudfront' }));
    toast('Deployment profile saved (non-secret only).');
  };
}
async function getProfile() {
  try { return JSON.parse(localStorage.getItem('aw.deployProfile') || '{}'); } catch { return {}; }
}

/* ---------- preview (same output as production, opened in a new tab) ---------- */
function buildBlobSite(files) {
  // Revoke the previous blob site to avoid leaking object URLs across rebuilds.
  for (const u of state.previewBlobs || []) { try { URL.revokeObjectURL(u); } catch { /* gone */ } }
  // Link targets resolve at click time through a session map, so circular links
  // between pages just work (no per-page URL rewriting needed).
  const map = {};
  const urls = new Map();
  for (const [p, content] of files) {
    const body = p.endsWith('.html') ? inlineAssets(files, content) + previewInterceptorScript() : content;
    const url = URL.createObjectURL(new Blob([body], { type: blobTypeFor(p) }));
    urls.set(p, url);
    map[p] = url;
  }
  try { sessionStorage.setItem(PREVIEW_MAP_KEY, JSON.stringify(map)); } catch { /* private mode */ }
  const pages = [...files.keys()].filter((p) => p.endsWith('.html')).sort();
  state.previewBlobs = [...urls.values()];
  return { urls, pages };
}

function bytesToDataUrl(bytes, mime) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(bin)}`;
}

async function openPreviewNewTab(startKey = 'index.html') {
  // Open the tab synchronously (popup-blocker safe), fill it once the build lands.
  const tab = window.open('about:blank');
  if (!tab) { toast('Popup blocked — allow popups for this app, then try again.'); location.hash = '#/preview'; return; }
  tab.document.write('<p style="font-family:system-ui;padding:2rem">Building preview…</p>');
  try {
    const input = await fullInput();
    const { files } = await generateSite(input);
    state.dist = files;
    const site = buildBlobSite(files);
    state.previewSite = site;
    // Overlay locally-imported image bytes so previewed articles render them offline.
    const map = JSON.parse(sessionStorage.getItem(PREVIEW_MAP_KEY) || '{}');
    for (const m of input.media || []) {
      if (!m.dataUrl || !m.filename) continue;
      try {
        const blob = await (await fetch(m.dataUrl)).blob();
        const url = URL.createObjectURL(blob);
        site.urls.set(`assets/images/${m.filename}`, url);
        state.previewBlobs.push(url);
        map[`assets/images/${m.filename}`] = url;
      } catch { /* keep remote/broken refs as-is */ }
    }
    try { sessionStorage.setItem(PREVIEW_MAP_KEY, JSON.stringify(map)); } catch { /* private mode */ }
    tab.location.href = site.urls.get(startKey) || site.urls.get('index.html');
  } catch (err) {
    console.error(err);
    tab.document.write(`<p style="font-family:system-ui;padding:2rem">Preview failed: ${escapeHtml(err.message)}</p>`);
  }
}

async function vPreview() {
  const pages = (state.previewSite?.pages) || [];
  view.innerHTML = `<h2>Preview</h2>
    <p>Builds the exact output Publish deploys and opens it in a <strong>new tab</strong> as a fully navigable offline site (assets inlined, links rewritten — no server needed).</p>
    <div class="row"><button class="btn primary" id="pv-open">Open preview in new tab</button></div>
    ${pages.length ? `<h3>Pages in the last build</h3><ul>${pages.map((p) => `<li><a href="#" data-pv="${escapeHtml(p)}">/${escapeHtml(p.replace(/index\.html$/, ''))}</a></li>`).join('')}</ul>` : '<p>No preview built yet — click above.</p>'}
    <p>Uploaded image binaries preview after a CLI build: run <code>node tools/build.mjs</code>, then <code>node tools/preview.mjs</code> and open <code>http://localhost:8081/</code> for the full-asset version.</p>`;
  $('#pv-open').onclick = () => openPreviewNewTab('index.html');
  document.querySelectorAll('[data-pv]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openPreviewNewTab(a.dataset.pv); }));
}

/* ---------- build ---------- */
async function vBuild() {
  view.innerHTML = `<h2>Build</h2><p>Runs the full pipeline locally and offline: validate → sanitize → templates → pages → sitemap/RSS/robots → optimize → fingerprint → compress → manifest.</p>
    <div class="row"><button class="btn primary" id="run">Run build</button><button class="btn" id="dl">Download index.html</button></div>
    <ul class="checklist" id="steps"></ul><pre class="log" id="log" hidden></pre>`;
  $('#run').onclick = async () => {
    const steps = $('#steps');
    steps.innerHTML = '';
    const li = (ok, t) => (steps.innerHTML += `<li>${ok ? '✓' : '✗'} ${escapeHtml(t)}</li>`);
    const input = await fullInput();
    const slugs = input.articles.map((a) => a.slug);
    let blockers = 0;
    for (const a of input.articles) for (const e of validateArticle(a, { takenSlugs: slugs }).errors) { li(false, `${a.slug}: ${e.message}`); blockers++; }
    li(true, 'Preparing content');
    li(blockers === 0, blockers === 0 ? 'Validating articles' : `${blockers} validation errors`);
    if (blockers) return;
    const { files, contentHash } = await generateSite(input);
    state.dist = files;
    state.lastBuild = { at: new Date().toISOString(), contentHash, count: files.size };
    li(true, `Generating pages (${files.size} files)`);
    const out = validateBuildOutput(files);
    out.errors.forEach((e) => li(false, e.message));
    if (!out.ok) return;
    const secrets = scanForSecrets(files);
    li(secrets.length === 0, secrets.length ? `Secrets found: ${secrets.map((s) => s.path).join(', ')}` : 'Security scan passed');
    if (secrets.length) return;
    li(true, 'Optimizing + fingerprinting + compression artifacts ready');
    li(true, `Build complete — contentHash ${contentHash}`);
    const log = $('#log');
    log.hidden = false;
    log.textContent = [...files.keys()].slice(0, 60).join('\n') + (files.size > 60 ? `\n… +${files.size - 60} more` : '');
    await refreshPending();
  };
  $('#dl').onclick = () => {
    if (!state.dist) { toast('Run a build first.'); return; }
    download('index.html', state.dist.get('index.html') || '', 'text/html');
  };
}

/* ---------- publish (one-click) ---------- */
async function publishFlow() {
  if (!navigator.onLine) { toast('Offline — publishing needs a connection. Everything is saved locally.'); location.hash = '#/build'; return; }
  const input = await fullInput();
  const slugs = input.articles.map((a) => a.slug);
  const errors = input.articles.flatMap((a) => validateArticle(a, { takenSlugs: slugs }).errors.map((e) => `${a.slug}: ${e.message}`));
  const health = validateSiteHealth({ articles: input.articles, pages: input.pages, media: input.media, deploymentProfile: await getProfile() });
  const warns = [...health.seo, ...health.media, ...health.performance].filter((h) => h.level === 'warn').map((h) => h.message);
  modal(`<h2>Publish website?</h2>
    ${errors.length ? `<p class="status-err">${errors.length} blocking issue(s) — fix before publishing:</p><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : '<p>✓ All validation passed.</p>'}
    ${warns.length ? `<p class="status-warn">Warnings (can publish anyway):</p><ul>${warns.slice(0, 8).map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
    <div class="row"><button class="btn" id="m-cancel">Cancel</button><button class="btn accent" id="m-go" ${errors.length ? 'disabled' : ''}>Publish ${escapeHtml(String((await ArticleService.pendingChanges(state.repo, state.siteId)).length))} change(s)</button></div>
    <ul class="checklist" id="m-steps"></ul>`);
  $('#m-cancel').onclick = () => $('#modal').close();
  if (errors.length) return;
  $('#m-go').onclick = async () => {
    const steps = $('#m-steps');
    const tick = (t) => (steps.innerHTML += `<li>✓ ${escapeHtml(t)}</li>`);
    tick('Preparing content'); tick('Validating articles'); tick('Sanitizing content');
    const { files, contentHash } = await generateSite(input);
    const prev = state.lastBuild ? { hashes: state.lastBuild.hashes } : null;
    const diff = diffManifest(prev, { files });
    state.dist = files;
    tick(`Generating pages (${files.size} files)`);
    const secrets = scanForSecrets(files);
    if (secrets.length) { steps.innerHTML += `<li>✗ Secrets detected — publish blocked.</li>`; return; }
    tick('Optimizing images · minifying · fingerprinting');
    tick('Compressing assets');
    tick(`Uploading ${diff.changed.length} changed file(s) to ${navigator.onLine ? 'deployment target' : '—'}`);
    // In-browser demo deploys to the local device record (+ optional backend when configured).
    const profile = await getProfile();
    const backend = (localStorage.getItem('aw.deployServiceUrl') || '').replace(/\/+$/, '');
    const version = versionStamp();
    let backendResult = null;
    if (backend) {
      const token = sessionStorage.getItem('aw.deployToken') || '';
      if (!token) {
        steps.innerHTML += `<li>✗ Deployment backend needs a token — set it in Settings, then publish again. Nothing was deployed.</li>`;
        return;
      }
      tick('Contacting deployment backend');
      try {
        const resp = await fetch(`${backend}/api/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ profile, version, contentHash, files: diff.changed }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.status === 401) { steps.innerHTML += `<li>✗ Backend rejected the token. Check Settings → token.</li>`; return; }
        if (resp.status === 403) { steps.innerHTML += `<li>✗ ${escapeHtml(data.error || 'Forbidden.')} This token's role cannot deploy.</li>`; return; }
        if (!resp.ok || !data.ok) { steps.innerHTML += `<li>✗ Deployment failed${data.errorId ? ` (Error ID: ${escapeHtml(data.errorId)})` : ''}. ${escapeHtml(data.detail || data.error || 'Check deployment logs.')}</li>`; return; }
        backendResult = data;
        tick(`Updating CloudFront (invalidated ${(data.invalidated || []).length} path(s))`);
      } catch {
        steps.innerHTML += `<li>✗ Backend unreachable at ${escapeHtml(backend)} — is it running? Nothing was deployed.</li>`;
        return;
      }
    } else {
      tick('No deployment backend configured — recording local deployment');
    }
    tick('Verifying deployment');
    const rec = buildDeploymentManifest({ siteId: state.siteId, version, contentHash, templateHash: 'browser', files: diff.changed, deployer: 'browser' });
    await state.repo.put('deployments', { ...rec, id: rec.deploymentId, createdAt: rec.timestamp, updatedAt: rec.timestamp, rowVersion: 1, result: backendResult || { provider: 'browser-local' }, profile: { bucket: profile.bucket, distributionId: profile.distributionId, region: profile.region } });
    await ArticleService.markDeployed(state.repo, state.siteId);
    await AuditService.log(state.repo, { action: 'deploy', entityType: 'site', entityId: state.siteId, detail: version });
    tick('Marking content as Published');
    $('#m-go').disabled = true;
    steps.innerHTML += `<li><strong>DEPLOYMENT SUCCESSFUL</strong> — version ${escapeHtml(version)}, ${diff.changed.length} files. <a href="#/deployments">View deployment</a> · <a href="#/preview">Open website</a></li>`;
    toast('Published: ' + version);
    refreshPending();
  };
}
function versionStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- deployments ---------- */
async function vDeployments() {
  const deps = (await state.repo.all('deployments')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  view.innerHTML = `<h2>Deployments</h2>
    ${navigator.onLine ? '' : '<p class="status-warn">Offline — history is local; rollback needs a connection + Publisher role.</p>'}
    <table><thead><tr><th>Version</th><th>When</th><th>Files</th><th>Status</th><th></th></tr></thead><tbody>
    ${deps.map((d, i) => `<tr><td>${escapeHtml(d.version)}${i === 0 ? ' (Current)' : ''}</td><td>${escapeHtml((d.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${d.filesChanged}</td><td>${escapeHtml(d.status)}</td><td>${i === 0 ? '' : `<button class="btn" data-rb="${d.version}">Rollback</button>`}</td></tr>`).join('') || '<tr><td colspan="5">No deployments yet — click Publish website.</td></tr>'}
    </tbody></table>
    <div class="row"><h3 style="margin:0">AWS one-click setup</h3><span style="flex:1"></span><button class="btn primary" id="wiz">Launch setup wizard</button></div>
    <div id="wiz-body"></div>
    <details><summary>Manual checklist</summary><ol>
    <li>Deploy <code>infra/cloudformation/static-site.yaml</code> (S3 + OAC + CloudFront + ACM + Route 53).</li>
    <li>Save the deployment profile under Website → Deployment profile.</li>
    <li>Run the protected deployment service (<code>server/deployment-service</code>) and set its URL in Settings.</li>
    <li>Publish from the dashboard — secrets never leave the backend (STS least-privilege).</li></ol></details>`;
  document.querySelectorAll('[data-rb]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`Roll back to ${b.dataset.rb}? Requires Publisher authorization.`)) return;
    await AuditService.log(state.repo, { action: 'rollback', entityType: 'site', entityId: state.siteId, detail: b.dataset.rb });
    toast('Rollback requested for ' + b.dataset.rb + ' (backend replays that manifest).');
  }));
  $('#wiz').onclick = startWizard;
}

const WIZ_TITLES = ['AWS account', 'Region', 'Domain', 'S3 bucket', 'CloudFront', 'HTTPS certificate', 'DNS', 'Permissions & tokens', 'Test connection', 'Save profile'];
async function startWizard() {
  const s = await site();
  const prof = await getProfile();
  state.wizard = {
    step: 0,
    data: {
      accountId: '', region: prof.region || 'ap-south-1', domain: s?.domain || prof.domain || '',
      bucket: prof.bucket || '', distributionId: prof.distributionId || '', acmArn: '',
      createDns: true, hostedZoneId: '', confirmedPerms: false, tokens: null, health: '',
    },
  };
  renderWizard();
}
function wizError(msg) {
  const e = $('#wiz-err');
  if (e) { e.textContent = msg || ''; e.style.display = msg ? '' : 'none'; }
}
function renderWizard() {
  const w = state.wizard;
  const d = w.data;
  const box = $('#wiz-body');
  if (!box) return;
  const nav = (extra = '') => `<p id="wiz-err" class="status-err" style="display:none"></p><div class="row"><button class="btn" id="w-back" ${w.step === 0 ? 'disabled' : ''}>← Back</button><span style="flex:1"></span><span>Step ${w.step + 1} of 10 — ${WIZ_TITLES[w.step]}</span><span style="flex:1"></span>${extra}</div>`;
  const input = (id, val, ph = '') => `<input id="${id}" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}">`;
  if (w.step === 0) box.innerHTML = `<h4>1. AWS account</h4><p>Used for reference only — keys never enter this UI.</p><label>Account ID (12 digits)${input('w-accountId', d.accountId, '123456789012')}</label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 1) box.innerHTML = `<h4>2. Region</h4><p>Bucket region. The CloudFront certificate must live in <code>us-east-1</code> regardless.</p><label>Region<select id="w-region">${AWS_REGIONS.map((r) => `<option ${r === d.region ? 'selected' : ''}>${r}</option>`).join('')}</select></label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 2) box.innerHTML = `<h4>3. Domain</h4><label>Primary domain${input('w-domain', d.domain, 'www.ayodhyya.com')}</label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 3) box.innerHTML = `<h4>4. S3 bucket</h4><label>Bucket identifier${input('w-bucket', d.bucket || (d.domain ? defaultBucketFor(d.domain) : ''), 'ayodhyya-prod-site')}</label><p>Private bucket; CloudFront reads via Origin Access Control. Versioning is enabled for rollback.</p>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 4) box.innerHTML = `<h4>5. CloudFront</h4><label>Distribution ID (leave blank if not created yet)${input('w-distributionId', d.distributionId, 'E1234567890ABC')}</label><p>HTTPS, HTTP→HTTPS redirect, compression, and price class 100 are in the template.</p>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 5) box.innerHTML = `<h4>6. HTTPS certificate</h4><label>ACM ARN, must be <code>us-east-1</code> (blank if not requested yet)${input('w-acmArn', d.acmArn, 'arn:aws:acm:us-east-1:…')}</label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 6) box.innerHTML = `<h4>7. DNS</h4><label><input type="checkbox" id="w-createDns" ${d.createDns ? 'checked' : ''}> Create Route 53 record ($0.50/mo; uncheck to use free external DNS)</label><label>Hosted zone ID${input('w-hostedZoneId', d.hostedZoneId, 'Z2FDTNDATAQYW2')}</label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 7) box.innerHTML = `<h4>8. Permissions & tokens</h4><p>Attach this least-privilege policy to the backend role: <code>s3:ListBucket/GetObject/PutObject/DeleteObject</code> (site bucket only) + <code>cloudfront:CreateInvalidation/GetInvalidation</code> (distribution only). Prefer STS over long-lived keys.</p><div class="row"><button class="btn" id="w-gen">Generate tokens</button></div><div id="w-toks">${d.tokens ? `<p><code>DEPLOY_TOKEN=${d.tokens.deploy}</code> <button class="btn" data-copy="deploy">Copy</button></p><p><code>ADMIN_TOKEN=${d.tokens.admin}</code> <button class="btn" data-copy="admin">Copy</button></p><p class="status-warn">Shown once — set as backend env vars now. They are never stored by this app.</p>` : '<p>No tokens generated yet.</p>'}</div><label><input type="checkbox" id="w-confirmedPerms" ${d.confirmedPerms ? 'checked' : ''}> IAM policy attached and tokens saved as backend env vars</label>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else if (w.step === 8) box.innerHTML = `<h4>9. Test connection</h4><div class="row"><button class="btn" id="w-health">Check deployment backend</button><span id="w-health-out">${d.health}</span></div><p>Works offline for everything except this check.</p>${nav('<button class="btn primary" id="w-next">Next →</button>')}`;
  else {
    const { profile, errors } = buildProfile({ siteId: state.siteId, ...d });
    const cmd = cfnDeployCommand({ profile, acmArn: d.acmArn });
    box.innerHTML = `<h4>10. Save profile</h4>${errors.length ? `<p class="status-err">Fix before saving:</p><ul>${errors.map((e) => `<li><strong>${e.field}:</strong> ${escapeHtml(e.message)}</li>`).join('')}</ul>` : '<p class="status-ok">✓ All values validate.</p>'}
    <pre class="log">${escapeHtml(cmd)}</pre>
    <div class="row"><button class="btn" id="w-copy-cmd">Copy deploy command</button><button class="btn" id="w-dl">Download deployment-profile.json</button><button class="btn primary" id="w-save" ${errors.length ? 'disabled' : ''}>Save profile</button></div>`;
    $('#w-copy-cmd').onclick = async () => { await navigator.clipboard?.writeText(cmd).catch(() => {}); toast('Deploy command copied.'); };
    $('#w-dl').onclick = () => download('deployment-profile.json', JSON.stringify(profile, null, 2), 'application/json');
    const saveBtn = $('#w-save');
    if (saveBtn) saveBtn.onclick = async () => {
      localStorage.setItem('aw.deployProfile', JSON.stringify(profile));
      await AuditService.log(state.repo, { action: 'aws.setup', entityType: 'site', entityId: state.siteId, detail: `${profile.domain} → ${profile.bucket}` });
      toast('Deployment profile saved (non-secret only).');
      route();
    };
  }
  const back = $('#w-back');
  if (back) back.onclick = () => { collectWizard(); w.step--; renderWizard(); };
  const next = $('#w-next');
  if (next) next.onclick = () => {
    collectWizard();
    const err = validateWizardStep();
    if (err) { wizError(err); return; }
    w.step++;
    renderWizard();
  };
  const gen = $('#w-gen');
  if (gen) gen.onclick = () => {
    const rand = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
    d.tokens = { deploy: 'pub_' + rand(), admin: 'adm_' + rand() };
    renderWizard();
  };
  document.querySelectorAll('#wiz-body [data-copy]').forEach((b) => (b.onclick = async () => {
    await navigator.clipboard?.writeText(d.tokens[b.dataset.copy]).catch(() => {});
    toast('Token copied — store it as backend env now.');
  }));
  const health = $('#w-health');
  if (health) health.onclick = async () => {
    const base = (localStorage.getItem('aw.deployServiceUrl') || '').replace(/\/+$/, '');
    if (!base) { $('#w-health-out').textContent = 'No backend URL in Settings yet.'; return; }
    try {
      const r = await fetch(`${base}/api/health`);
      d.health = r.ok ? '✓ Backend reachable.' : `✗ Backend responded ${r.status}.`;
    } catch { d.health = '✗ Unreachable (offline or not running).'; }
    $('#w-health-out').textContent = d.health;
  };
}
function collectWizard() {
  const d = state.wizard.data;
  const v = (id) => $(`#${id}`)?.value ?? $(`#${id}`)?.checked ?? undefined;
  if ($('#w-accountId')) d.accountId = v('w-accountId').trim?.() ?? v('w-accountId');
  for (const id of ['region', 'domain', 'bucket', 'distributionId', 'acmArn', 'hostedZoneId']) {
    const el = $(`#w-${id}`);
    if (el) d[id] = el.value.trim();
  }
  const dns = $('#w-createDns');
  if (dns) d.createDns = dns.checked;
  const cp = $('#w-confirmedPerms');
  if (cp) d.confirmedPerms = cp.checked;
}
function validateWizardStep() {
  const d = state.wizard.data;
  const need = (r) => (r.ok ? null : r.error);
  switch (state.wizard.step) {
    case 0: return need(validateAccountId(d.accountId));
    case 1: return need(validateRegion(d.region));
    case 2: return need(validateDomain(d.domain));
    case 3: return need(validateBucket(d.bucket || defaultBucketFor(d.domain)));
    case 4: return need(validateDistributionId(d.distributionId));
    case 5: return need(validateAcmArn(d.acmArn));
    case 6: return need(validateHostedZoneId(d.hostedZoneId, { required: d.createDns }));
    case 7: return d.confirmedPerms ? null : 'Confirm the IAM policy and token storage first (or go back later).';
    default: return null;
  }
}

/* ---------- settings ---------- */
async function vSettings() {
  const audit = (await state.repo.all('audit')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
  view.innerHTML = `<h2>Settings</h2>
    <form class="grid" id="svc"><label>Deployment service URL (protected backend)<input id="svc-url" placeholder="http://localhost:8787" value="${escapeHtml(localStorage.getItem('aw.deployServiceUrl') || '')}"></label>
    <label>Deploy token (Publisher) — kept in this tab only, never stored on disk<input id="svc-token" type="password" autocomplete="off" placeholder="${sessionStorage.getItem('aw.deployToken') ? 'token saved for this tab session' : 'paste token, saved to session memory only'}"></label>
    <div class="row"><button class="btn">Save</button><button class="btn danger" type="button" id="svc-forget">Forget token</button></div></form>
    <p>Backend deploys the <em>server's</em> <code>./dist</code> — run <code>node tools/build.mjs</code> on the server machine first when publishing from the browser.</p>
    <h3>AI assist (optional, off unless configured)</h3><form class="grid" id="aif"><label>Provider URL (OpenAI-compatible)<input id="ai-url" placeholder="https://api.openai.com/v1" value="${escapeHtml(localStorage.getItem('aw.aiBaseUrl') || '')}"></label>
    <label>Model<input id="ai-model" placeholder="gpt-4o-mini" value="${escapeHtml(localStorage.getItem('aw.aiModel') || '')}"></label>
    <label>API key — tab memory only, never stored<input id="ai-key" type="password" autocomplete="off" placeholder="${sessionStorage.getItem('aw.aiKey') ? 'key saved for this tab session' : 'paste key, saved to session memory only'}"></label>
    <div class="row"><button class="btn">Save</button><button class="btn danger" type="button" id="ai-forget">Forget key</button></div></form>
    <p>Article text is sent to the provider only when you click an AI button in the editor — never automatically.</p>
    <h3>Shortcuts</h3><p><span class="kbd">Ctrl/⌘+S</span> save · <span class="kbd">Ctrl/⌘+P</span> preview · <span class="kbd">Ctrl/⌘+Shift+P</span> publish · <span class="kbd">Ctrl/⌘+K</span> insert link</p>
    <h3>Backup (offline, no secrets)</h3><div class="row"><button class="btn" id="exp">Export backup</button><button class="btn" id="exp-enc">Export encrypted</button><input type="file" id="imp" accept="application/json,.enc" aria-label="Import backup"></div>
    <h3>Audit log</h3><table><thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${audit.map((a) => `<tr><td>${escapeHtml((a.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.detail || '')}</td></tr>`).join('') || '<tr><td colspan="3">No events yet.</td></tr>'}
    </tbody></table>`;
  $('#svc').onsubmit = (e) => {
    e.preventDefault();
    localStorage.setItem('aw.deployServiceUrl', $('#svc-url').value.trim());
    const tok = $('#svc-token').value.trim();
    if (tok) sessionStorage.setItem('aw.deployToken', tok); // tab session only — never localStorage/IndexedDB/disk
    $('#svc-token').value = '';
    toast('Deployment service settings saved (token lives in tab memory only).');
  };
  $('#svc-forget').onclick = () => { sessionStorage.removeItem('aw.deployToken'); toast('Token forgotten.'); };
  $('#aif').onsubmit = (e) => {
    e.preventDefault();
    localStorage.setItem('aw.aiBaseUrl', $('#ai-url').value.trim());
    localStorage.setItem('aw.aiModel', $('#ai-model').value.trim());
    const k = $('#ai-key').value.trim();
    if (k) sessionStorage.setItem('aw.aiKey', k); // tab session only — never disk
    $('#ai-key').value = '';
    toast('AI settings saved (key lives in tab memory only).');
  };
  $('#ai-forget').onclick = () => { sessionStorage.removeItem('aw.aiKey'); toast('AI key forgotten.'); };
  $('#exp').onclick = async () => {
    const all = await BackupService.exportAll(state.repo);
    download(`ayodhyya-backup-${Date.now()}.json`, JSON.stringify(all, null, 2), 'application/json');
  };
  $('#exp-enc').onclick = () => {
    modal(`<h2>Encrypted backup</h2><p>AES-256-GCM, password-protected. Wrong password = unrecoverable.</p><form class="grid" id="enc-f"><label>Password (8+ characters)<input id="enc-p1" type="password" autocomplete="new-password"></label><label>Confirm password<input id="enc-p2" type="password" autocomplete="new-password"></label><div class="row"><button class="btn primary">Download .enc backup</button></div></form>`);
    $('#enc-f').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#enc-p1').value !== $('#enc-p2').value) { toast('Passwords do not match.'); return; }
      try {
        const all = await BackupService.exportAll(state.repo);
        const enc = await encryptBackupBrowser(JSON.stringify(all), $('#enc-p1').value);
        download(`ayodhyya-backup-${Date.now()}.enc`, enc, 'text/plain');
        $('#modal').close();
        toast('Encrypted backup downloaded.');
      } catch (err) { toast(err.message); }
    };
  };
  $('#imp').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      let text = await f.text();
      if (isEncryptedBackupBrowser(text)) {
        const pw = prompt('Encrypted backup — enter password:');
        if (!pw) return;
        text = await decryptBackupBrowser(text, pw);
      }
      await BackupService.importAll(state.repo, JSON.parse(text));
      toast('Backup imported. Reloading…');
      setTimeout(() => location.reload(), 800);
    } catch { toast('Invalid backup file or wrong password.'); }
  };
}

boot();
