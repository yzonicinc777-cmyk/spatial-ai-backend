/**
 * sw.js — Service Worker: stale-while-revalidate + precache.
 *
 * AUTO-UPDATE: CACHE_NAME is injected at deploy time by GitHub Actions.
 * Every push to main bumps the cache version → browsers auto-update
 * without needing a manual cache clear.
 *
 * FIX: Handles redirected responses from Cloudflare Workers correctly.
 * The root cause of the "redirect mode not follow" error was that:
 *   1. cache.addAll() uses default redirect:'follow' BUT then tries to
 *      store the redirected response, which the Cache API rejects.
 *   2. The fetch handler was not explicitly setting redirect:'follow'
 *      on outgoing requests, so redirected responses were opaque/errored.
 */

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch a single URL safely for caching.
 * - Forces redirect:'follow' so we always get the final response body.
 * - Only stores responses that are actually cacheable (status 200, non-opaque,
 *   not a raw redirect object).
 * - Never throws — a failed precache asset is warned, not fatal.
 */
async function safeFetchAndCache(cache, url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',         // always follow redirects (Cloudflare Worker)
      credentials: 'same-origin',
    });

    // Only cache a clean, complete response
    if (
      response.ok &&                      // status 200–299
      response.status === 200 &&
      response.type !== 'opaque' &&       // not a cross-origin no-cors response
      response.type !== 'opaqueredirect'  // not an unresolved redirect
    ) {
      await cache.put(url, response);
    } else {
      console.warn(`[SW] Skipping cache for ${url} — status: ${response.status}, type: ${response.type}`);
    }
  } catch (err) {
    console.warn(`[SW] Precache fetch failed for ${url}:`, err.message);
  }
}

// ── Install: precache shell assets ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use individual safeFetchAndCache instead of cache.addAll()
      // because addAll() chokes on redirected responses.
      await Promise.all(PRECACHE_ASSETS.map((url) => safeFetchAndCache(cache, url)));
      await self.skipWaiting(); // activate immediately
    })
  );
});

// ── Activate: remove ALL stale caches from previous versions ─────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Removing old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim()) // take control of all open pages immediately
  );
});

// ── Fetch: stale-while-revalidate for same-origin GETs ───────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  // Only intercept same-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip WASM range requests (partial content — browser handles natively)
  if (request.url.endsWith('.wasm') && request.headers.has('range')) return;

  // Skip cross-origin requests (OSM tiles, Nominatim, etc.)
  const url = new URL(request.url);
  if (url.hostname !== self.location.hostname) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      // Build a new request that explicitly follows redirects
      // This is the key fix: without this, a Cloudflare Worker redirect
      // produces a response with type:'opaqueredirect' which the Cache
      // API and the browser both reject with the "redirect mode" error.
      const freshRequest = new Request(request.url, {
        method:      request.method,
        headers:     request.headers,
        redirect:    'follow',          // ← THE FIX
        credentials: 'same-origin',
        mode:        request.mode === 'navigate' ? 'navigate' : 'same-origin',
      });

      const networkFetch = fetch(freshRequest)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.status === 200 &&
            networkResponse.type !== 'opaque' &&
            networkResponse.type !== 'opaqueredirect'
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
