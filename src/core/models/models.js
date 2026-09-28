// Domain models + factories. Every major entity: id, createdAt, updatedAt, version, status.
import { nowIso, slugify, readingTimeMinutes, wordCountOf } from '../utils/utils.js';

export const ARTICLE_STATUSES = ['Draft', 'Ready', 'Scheduled', 'Published', 'Archived', 'Modified'];
export const PAGE_STATUSES = ['Draft', 'Published', 'Archived', 'Modified'];

export function newId(prefix = 'id') {
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

function base(prefix) {
  const now = nowIso();
  return { id: newId(prefix), createdAt: now, updatedAt: now, version: 1 };
}

export function createSite(partial = {}) {
  return {
    ...base('site'),
    name: 'Ayodhyya',
    tagline: '',
    domain: 'www.ayodhyya.com',
    url: 'https://www.ayodhyya.com',
    language: 'en',
    description: '',
    logo: '',
    theme: { colorPrimary: '#0f172a', colorAccent: '#f59e0b', fontBody: 'system-ui', fontHeading: 'system-ui', layoutWidth: '72rem', mode: 'light' },
    navigation: { header: [], footer: [] },
    seo: { titleSuffix: '', defaultDescription: '', robots: 'index,follow', canonicalBase: '' },
    social: { twitter: '', facebook: '', linkedin: '', whatsapp: '', telegram: '' },
    adsense: { publisherId: '', slots: {}, placements: {} },
    comments: { enabled: false, endpoint: '', heading: 'Comments' },
    newsletter: { enabled: false, endpoint: '', heading: 'Newsletter', text: '' },
    analytics: { provider: 'none', measurementId: '' },
    privacy: { privacyPolicy: '', cookiePolicy: '', terms: '', advertisingDisclosure: '' },
    redirects: [],
    activeTemplateId: 'default-v1',
    status: 'Active',
    ...partial,
  };
}

export function createArticle(partial = {}) {
  const content = partial.content || '';
  return {
    ...base('art'),
    siteId: partial.siteId || '',
    title: '',
    slug: partial.slug || (partial.title ? slugify(partial.title) : ''),
    excerpt: '',
    content,
    contentFormat: partial.contentFormat || 'html', // html | markdown
    featuredImage: '',
    authorId: '',
    categoryIds: [],
    tagIds: [],
    status: 'Draft',
    publishDate: '',
    modifiedDate: '',
    canonicalUrl: '',
    metaTitle: '',
    metaDescription: '',
    keywords: [],
    robots: '',
    focusKeyword: '',
    ogTitle: '',
    ogDescription: '',
    ogImage: '',
    twitterTitle: '',
    twitterDescription: '',
    twitterImage: '',
    schemaType: 'BlogPosting',
    readingTime: readingTimeMinutes(content),
    wordCount: wordCountOf(content),
    revision: 1,
    lastDeployedRevision: 0,
    ...partial,
  };
}

export function touchArticle(a, patch = {}) {
  const next = { ...a, ...patch, updatedAt: nowIso(), version: (a.version || 1) + 1, revision: (a.revision || 1) + 1 };
  next.wordCount = wordCountOf(next.content || '');
  next.readingTime = readingTimeMinutes(next.content || '');
  // Any edit to a Published article flips it to Modified (pending changes).
  if (a.status === 'Published' && next.status === 'Published') next.status = 'Modified';
  next.modifiedDate = next.updatedAt;
  return next;
}

export function createPage(partial = {}) {
  return {
    ...base('page'),
    siteId: partial.siteId || '',
    title: '',
    slug: partial.slug || (partial.title ? slugify(partial.title) : ''),
    content: partial.content || '',
    contentFormat: 'html',
    status: 'Draft',
    metaTitle: '',
    metaDescription: '',
    canonicalUrl: '',
    revision: 1,
    lastDeployedRevision: 0,
    ...partial,
  };
}

export function createCategory(partial = {}) {
  return { ...base('cat'), siteId: '', name: '', slug: partial.slug || (partial.name ? slugify(partial.name) : ''), description: '', ...partial };
}
export function createTag(partial = {}) {
  return { ...base('tag'), siteId: '', name: '', slug: partial.slug || (partial.name ? slugify(partial.name) : ''), ...partial };
}
export function createAuthor(partial = {}) {
  return { ...base('auth'), siteId: '', name: '', slug: partial.slug || (partial.name ? slugify(partial.name) : ''), bio: '', avatar: '', role: '', ...partial };
}
export function createMedia(partial = {}) {
  return {
    ...base('media'), siteId: '', filename: '', originalName: '', mimeType: '', size: 0,
    width: 0, height: 0, altText: '', caption: '', title: '', hash: '', variants: [], dataUrl: '', ...partial,
  };
}
export function createComment(partial = {}) {
  return {
    ...base('comment'), siteId: '', articleSlug: '', author: '', content: '',
    status: 'Pending', ...partial, // Pending | Approved | Spam
  };
}
export function createSubscriber(partial = {}) {
  return {
    ...base('subscriber'), siteId: '', email: '', name: '', source: 'site-form',
    status: 'Active', ...partial, // Active | Unsubscribed
  };
}
export function createTemplate(partial = {}) {
  return {
    ...base('tpl'), siteId: '', name: 'Default', versionTag: 'v1', active: false,
    files: {}, // { 'index.html': '...', 'article.html': '...', ... 'style.css': '...' }
    ...partial,
  };
}
export function createRevision(partial = {}) {
  return { ...base('rev'), entityType: 'article', entityId: '', revision: 1, snapshot: null, note: '', ...partial };
}
export function createDeploymentRecord(partial = {}) {
  return {
    ...base('dep'), siteId: '', version: '', contentHash: '', templateHash: '',
    filesChanged: 0, files: [], status: 'Success', deployer: 'local', distributionInvalidation: [],
    note: '', ...partial,
  };
}
export function createAuditEvent(partial = {}) {
  return { ...base('audit'), actor: 'local', action: '', entityType: '', entityId: '', detail: '', ...partial };
}
