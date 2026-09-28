// Domain services — all business logic lives here, never in UI components.
// Each service takes a repository (Memory/IndexedDB) so the build engine stays testable.
import { createArticle, createPage, createCategory, createTag, createAuthor, createMedia, createTemplate, createRevision, createComment, createSubscriber, touchArticle } from '../models/models.js';
import { uniqueSlug, nowIso } from '../utils/utils.js';
import { sanitizeHtml } from '../../security/sanitize.js';

async function takenSlugs(repo, siteId) {
  const arts = await repo.query('articles', (a) => a.siteId === siteId);
  return arts.map((a) => a.slug);
}

export const ArticleService = {
  async create(repo, siteId, partial) {
    const slugs = await takenSlugs(repo, siteId);
    const title = partial.title || 'Untitled';
    const a = createArticle({ ...partial, siteId, title, slug: uniqueSlug(partial.slug || title, slugs), content: sanitizeHtml(partial.content || '') });
    await repo.put('articles', a);
    await repo.put('revisions', createRevision({ entityType: 'article', entityId: a.id, revision: 1, snapshot: a, note: 'created' }));
    await AuditService.log(repo, { action: 'article.create', entityType: 'article', entityId: a.id, detail: a.title });
    return a;
  },
  async update(repo, id, patch) {
    const cur = await repo.get('articles', id);
    if (!cur) throw new Error('Article not found: ' + id);
    const next = touchArticle(cur, { ...patch, ...(patch.content != null ? { content: sanitizeHtml(patch.content) } : {}) });
    await repo.put('articles', next);
    await repo.put('revisions', createRevision({ entityType: 'article', entityId: id, revision: next.revision, snapshot: next, note: patch.note || 'edited' }));
    await AuditService.log(repo, { action: 'article.update', entityType: 'article', entityId: id, detail: next.title });
    return next;
  },
  async remove(repo, id) {
    const cur = await repo.get('articles', id);
    await repo.remove('articles', id);
    await AuditService.log(repo, { action: 'article.delete', entityType: 'article', entityId: id, detail: cur?.title || id });
  },
  async list(repo, siteId) { return repo.query('articles', (a) => a.siteId === siteId); },
  async pendingChanges(repo, siteId) {
    const arts = await this.list(repo, siteId);
    const pages = await repo.query('pages', (p) => p.siteId === siteId);
    return [...arts.filter((a) => a.revision !== a.lastDeployedRevision), ...pages.filter((p) => p.revision !== p.lastDeployedRevision)];
  },
  async markDeployed(repo, siteId) {
    for (const a of await this.list(repo, siteId)) {
      if (a.revision !== a.lastDeployedRevision) await repo.put('articles', { ...a, status: a.status === 'Modified' ? 'Published' : a.status, lastDeployedRevision: a.revision, updatedAt: nowIso() });
    }
    for (const p of await repo.query('pages', (x) => x.siteId === siteId)) {
      if (p.revision !== p.lastDeployedRevision) await repo.put('pages', { ...p, status: p.status === 'Modified' ? 'Published' : p.status, lastDeployedRevision: p.revision, updatedAt: nowIso() });
    }
  },
  async publishDue(repo, siteId, now = Date.now()) {
    // Flips due Scheduled articles to Published (they'd go live on next build anyway).
    const flipped = [];
    for (const a of await this.list(repo, siteId)) {
      if (a.status === 'Scheduled' && a.publishDate && !Number.isNaN(Date.parse(a.publishDate)) && Date.parse(a.publishDate) <= now) {
        await repo.put('articles', { ...a, status: 'Published', updatedAt: nowIso(), version: (a.version || 1) + 1, revision: (a.revision || 1) + 1 });
        flipped.push(a.slug);
      }
    }
    if (flipped.length) await AuditService.log(repo, { action: 'articles.publishDue', entityType: 'site', entityId: siteId, detail: flipped.join(', ') });
    return flipped;
  },
};

export const PageService = {
  async create(repo, siteId, partial) {
    const pages = await repo.query('pages', (p) => p.siteId === siteId);
    const p = createPage({ ...partial, siteId, slug: uniqueSlug(partial.slug || partial.title || 'page', pages.map((x) => x.slug)), content: sanitizeHtml(partial.content || '') });
    await repo.put('pages', p);
    return p;
  },
  async update(repo, id, patch) {
    const cur = await repo.get('pages', id);
    const next = { ...cur, ...patch, ...(patch.content != null ? { content: sanitizeHtml(patch.content) } : {}), updatedAt: nowIso(), version: cur.version + 1, revision: cur.revision + 1 };
    if (cur.status === 'Published') next.status = 'Modified';
    await repo.put('pages', next);
    return next;
  },
};

export const TaxonomyService = {
  async createCategory(repo, siteId, partial) { const c = createCategory({ ...partial, siteId }); await repo.put('categories', c); return c; },
  async createTag(repo, siteId, partial) { const t = createTag({ ...partial, siteId }); await repo.put('tags', t); return t; },
};
export const AuthorService = {
  async create(repo, siteId, partial) { const a = createAuthor({ ...partial, siteId }); await repo.put('authors', a); return a; },
};
export const MediaService = {
  async register(repo, siteId, meta) { const m = createMedia({ ...meta, siteId }); await repo.put('media', m); return m; },
  async update(repo, id, patch) {
    // Alt/caption/title fixes — the accessibility repair path for health warnings.
    const cur = await repo.get('media', id);
    if (!cur) throw new Error('Media not found: ' + id);
    const allowed = (({ altText, caption, title }) => ({ altText, caption, title }))(patch);
    const next = { ...cur };
    for (const [k, v] of Object.entries(allowed)) if (v !== undefined) next[k] = String(v).slice(0, 500);
    next.updatedAt = nowIso();
    next.version = (cur.version || 1) + 1;
    await repo.put('media', next);
    return next;
  },
};
export const CommentService = {
  // Reader comments are UNTRUSTED DATA: sanitized on the way in, escaped on render.
  // Only Approved comments ever reach the generated site.
  async add(repo, siteId, { articleSlug, author, content }) {
    if (!articleSlug) throw new Error('Comment needs an article.');
    if (!String(content || '').trim()) throw new Error('Comment is empty.');
    const c = createComment({ siteId, articleSlug, author: String(author || 'Anonymous').slice(0, 80), content: sanitizeHtml(content).slice(0, 5000) });
    await repo.put('comments', c);
    await AuditService.log(repo, { action: 'comment.add', entityType: 'comment', entityId: c.id, detail: articleSlug });
    return c;
  },
  async setStatus(repo, id, status) {
    if (!['Pending', 'Approved', 'Spam'].includes(status)) throw new Error('Bad comment status: ' + status);
    const cur = await repo.get('comments', id);
    if (!cur) throw new Error('Comment not found: ' + id);
    const next = { ...cur, status, updatedAt: nowIso(), version: (cur.version || 1) + 1 };
    await repo.put('comments', next);
    await AuditService.log(repo, { action: 'comment.' + status.toLowerCase(), entityType: 'comment', entityId: id, detail: cur.articleSlug });
    return next;
  },
  async approvedFor(repo, siteId, articleSlug) {
    return (await repo.query('comments', (c) => c.siteId === siteId && c.articleSlug === articleSlug && c.status === 'Approved'))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  },
  async pendingCount(repo, siteId) {
    return (await repo.query('comments', (c) => c.siteId === siteId && c.status === 'Pending')).length;
  },
};
export const SubscriberService = {
  async add(repo, siteId, { email, name = '', source = 'site-form' }) {
    const clean = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) throw new Error('Not a valid email address.');
    const dupe = await repo.query('subscribers', (s) => s.siteId === siteId && s.email === clean);
    if (dupe.length) return dupe[0];
    const s = createSubscriber({ siteId, email: clean, name: String(name).slice(0, 120), source });
    await repo.put('subscribers', s);
    return s;
  },
  async setStatus(repo, id, status) {
    if (!['Active', 'Unsubscribed'].includes(status)) throw new Error('Bad subscriber status: ' + status);
    const cur = await repo.get('subscribers', id);
    if (!cur) throw new Error('Subscriber not found: ' + id);
    const next = { ...cur, status, updatedAt: nowIso() };
    await repo.put('subscribers', next);
    return next;
  },
  toCsv(subscribers) {
    // Portable export for any email provider. RFC-4180 quoting.
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return ['email,name,status,source,subscribed_at',
      ...(subscribers || []).map((s) => [s.email, s.name, s.status, s.source, s.createdAt].map(q).join(','))].join('\n') + '\n';
  },
};
export const TemplateService = {
  async save(repo, siteId, partial) { const t = createTemplate({ ...partial, siteId }); await repo.put('templates', t); return t; },
  async setActive(repo, siteId, templateId) {
    for (const t of await repo.query('templates', (x) => x.siteId === siteId)) await repo.put('templates', { ...t, active: t.id === templateId });
    for (const s of await repo.query('sites', (x) => x.id === siteId)) await repo.put('sites', { ...s, activeTemplateId: templateId, updatedAt: nowIso() });
  },
};
export const SearchService = {
  search(docs, q) {
    const needle = String(q || '').toLowerCase().trim();
    if (!needle) return [];
    return docs.filter((d) => `${d.title} ${d.excerpt} ${d.content} ${(d.tags || []).join(' ')}`.toLowerCase().includes(needle)).slice(0, 50);
  },
};
export const BackupService = {
  async exportAll(repo) {
    const data = {};
    for (const c of ['sites', 'articles', 'pages', 'categories', 'tags', 'authors', 'media', 'templates', 'deployments', 'comments', 'subscribers']) data[c] = await repo.all(c);
    return { exportedAt: nowIso(), app: 'ayodhyya-writer', version: 1, data };
  },
  async importAll(repo, backup) {
    const data = backup.data || backup;
    for (const [col, items] of Object.entries(data)) for (const item of items || []) await repo.put(col, item);
  },
  toXml(backup) {
    // Lossless-enough XML mirror of the JSON backup (values round-trip as text).
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const tag = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, '_') || 'value';
    const node = (name, value) => {
      const t = tag(name);
      if (Array.isArray(value)) return `<${t}>${value.map((v) => node('item', v)).join('')}</${t}>`;
      if (value && typeof value === 'object') return `<${t}>${Object.entries(value).map(([k, v]) => node(k, v)).join('')}</${t}>`;
      return `<${t}>${esc(value)}</${t}>`;
    };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<backup app="${esc(backup.app)}" version="${esc(backup.version)}" exportedAt="${esc(backup.exportedAt)}">${node('data', backup.data)}</backup>`;
  },
};
export const AuditService = {
  async log(repo, { actor = 'local', action, entityType, entityId, detail }) {
    const { createAuditEvent } = await import('../models/models.js');
    await repo.put('audit', createAuditEvent({ actor, action, entityType, entityId, detail }));
  },
};
