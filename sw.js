/**
 * sw.js — Service Worker: stale-while-revalidate + precache.
 *
 * AUTO-UPDATE: CACHE_NAME is injected at deploy time by GitHub Actions.
 * Every push to main bumps the cache version → browsers auto-update
 * without needing a manual cache clear.
 *
 * If DEPLOY_TIMESTAMP is not replaced (local dev), falls back to a
 * fixed string so local dev still works.
 */

// ⚠️  GitHub Actions replaces __DEPLOY_TIMESTAMP__ with the actual
//     timestamp (e.g. 20250611-143022) on every push.
//     See .github/workflows/deploy.yml
const CACHE_NAME = 'spatial-ai-__DEPLOY_TIMESTAMP__';

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
      .then(() => self.skipWaiting())   // activate immediately — don't wait for old tab to close
      .catch((err) => console.warn('[SW] Precache failed (non-fatal):', err))
  );
});

// ── Activate: remove ALL stale caches from previous versions ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())  // take control of all open pages immediately
  );
});

// ── Fetch: stale-while-revalidate for same-origin GETs ───────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;
  if (request.url.endsWith('.wasm') && request.headers.has('range')) return;

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
        .catch(() => cached);

      return cached ?? networkFetch;
    })
  );
});

// ── Message: notify all open clients when a new SW is waiting ─────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});