/**
 * sw.js — Service Worker: stale-while-revalidate + precache.
 * Assets inside /js/ folder are correctly pathed.
 */

const CACHE_NAME = 'spatial-ai-v5';

  const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/explorer.html',
  '/core.css',
  '/responsive.css',
  '/animations.css',
  '/app.js',
  '/js/engine.js',
  '/js/render.js',
  '/js/core.js',
  '/js/detection_worker.js',
  '/manifest.json',
  
];

// ── Install: precache shell assets ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Precache failed (non-fatal):', err))
  );
});

// ── Activate: remove stale caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate for same-origin GETs ───────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Only intercept same-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip WASM range requests (partial content — browser handles natively)
  if (request.url.endsWith('.wasm') && request.headers.has('range')) return;

  // Skip cross-origin API calls (OSM, Nominatim, etc.)
  const url = new URL(request.url);
  if (url.hostname !== self.location.hostname) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type !== 'opaque'
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cached); // network failed → fall back to cache

      // Stale-while-revalidate: serve cache instantly, revalidate in background
      return cached ?? networkFetch;
    })
  );
});

// ── Message: force update from app ───────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});