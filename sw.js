/**
 * sw.js — Service Worker: stale-while-revalidate + precache.
 */

const CACHE_NAME = 'spatial-ai-v8';

const PRECACHE_ASSETS = [
  '/index.html',
  '/explorer.html',
  '/auth.html',
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

async function safeFetchAndCache(cache, url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      credentials: 'same-origin',
    });

    if (
      response.ok &&
      response.status === 200 &&
      response.type !== 'opaque' &&
      response.type !== 'opaqueredirect'
    ) {
      await cache.put(url, response);
    } else {
      console.warn(`[SW] Skipping cache for ${url} — status: ${response.status}, type: ${response.type}`);
    }
  } catch (err) {
    console.warn(`[SW] Precache fetch failed for ${url}:`, err.message);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(PRECACHE_ASSETS.map((url) => safeFetchAndCache(cache, url)));
      await self.skipWaiting();
    })
  );
});

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
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Only handle same-origin requests
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip WASM range requests
  if (request.url.endsWith('.wasm') && request.headers.has('range')) return;

  const url = new URL(request.url);

  // ── Skip ALL navigation requests — let the browser handle them natively.
  // Cloudflare Workers Assets performs redirect normalization (e.g. trailing
  // slash, canonical paths) on HTML page requests. If the SW intercepts a
  // navigate request and the CDN returns a redirect, the fetch will fail with:
  //   "a redirected response was used for a request whose redirect mode is not 'follow'"
  // because navigate-mode requests default to redirect:'manual' in some
  // contexts. Bypassing navigate requests entirely is the safest fix.
  if (request.mode === 'navigate') return;

  // Skip cross-origin
  if (url.hostname !== self.location.hostname) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      // Always use redirect:'follow' for network fetch
      const freshRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
        credentials: 'same-origin',
        mode: request.mode === 'navigate' ? 'navigate' : request.mode,
      });

      const networkFetch = fetch(freshRequest)
        .then((networkResponse) => {
          // Only cache clean, non-redirected, same-origin responses
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cached);

      // Stale-while-revalidate: serve cache instantly, revalidate in background
      return cached ?? networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});