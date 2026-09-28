/* Ayodhyya Writer service worker — offline-first app shell cache.
   Never caches sensitive data; deployment secrets are never in cache. */
const CACHE = 'ayodhyya-writer-v10';
const APP_SHELL = [
  './',
  './index.html',
  './assets/css/app.css',
  './assets/js/app.js',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './seed/seed-data.json',
  // Every ES module app.js imports — without these an offline reload is a dead app.
  './src/core/utils/utils.js',
  './src/core/utils/markdown.js',
  './src/core/utils/awsWizard.js',
  './src/core/utils/fetchArticle.js',
  './src/core/utils/diff.js',
  './src/media/importImages.js',
  './src/security/backupCryptoBrowser.js',
  './src/ai/assist.js',
  './src/core/models/models.js',
  './src/core/services/services.js',
  './src/core/validators/validators.js',
  './src/security/sanitize.js',
  './src/security/uploads.js',
  './src/storage/repository.js',
  './src/templates/engine.js',
  './src/seo/seo.js',
  './src/seo/analyzer.js',
  './src/builder/generator.js',
  './src/optimizer/optimizer.js',
  './src/media/responsive.js',
  './src/deployment/providers.js',
  './src/preview/inline.js',
  // Default template package (first-run seeding when IndexedDB is empty).
  './src/templates/default/template.json',
  './src/templates/default/index.html',
  './src/templates/default/article.html',
  './src/templates/default/category.html',
  './src/templates/default/tag.html',
  './src/templates/default/search.html',
  './src/templates/default/page.html',
  './src/templates/default/404.html',
  './src/templates/default/style.css',
  './src/templates/default/script.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept deployment API calls — those require network + auth.
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: false }).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          // Cache same-origin GET app assets opportunistically.
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => caches.match('./index.html'))
    )
  );
});
