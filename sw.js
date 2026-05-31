/**
 * sw.js — Service Worker with stale-while-revalidate strategy
 * + precaching for all shell assets.
 */

const CACHE      = 'spatial-ai-v3';
const PRECACHE   = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/detection.worker.js',
  '/manifest.json',
  '/pkg/spatial_explorer_core.js',
  '/pkg/spatial_explorer_core_bg.wasm',
];

// Install: precache shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: prune old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for same-origin GETs
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  // Never intercept WASM range requests (causes issues in some browsers)
  if (e.request.url.endsWith('.wasm') && e.request.headers.has('range')) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          cache.put(e.request, res.clone());
        }
        return res;
      }).catch(() => cached);

      // Stale-while-revalidate: return cached immediately, update in bg
      return cached || fetchPromise;
    })
  );
});