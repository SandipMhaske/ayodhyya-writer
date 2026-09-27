// Domain services — all business logic lives here, never in UI components.
// Each service takes a repository (Memory/IndexedDB) so the build engine stays testable.
import { createArticle, createPage, createCategory, createTag, createAuthor, createMedia, createTemplate, createRevision, touchArticle } from '../models/models.js';
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
    for (const c of ['sites', 'articles', 'pages', 'categories', 'tags', 'authors', 'media', 'templates', 'deployments']) data[c] = await repo.all(c);
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
