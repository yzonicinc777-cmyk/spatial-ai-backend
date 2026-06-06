/**
 * sw.js — Service Worker: stale-while-revalidate + precache.
 */

const CACHE_NAME = 'spatial-ai-v2';

const PRECACHE_ASSETS = [
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

  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;
  if (request.url.endsWith('.wasm') && request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.hostname !== self.location.hostname) return;

  // ── Navigation guard ──────────────────────────────────────────
  // If a top-level navigation lands directly on explorer.html
  // (e.g. PWA launched from a stale shortcut or cached entry),
  // redirect to index.html so the landing page always shows first.
  if (request.mode === 'navigate') {
    const path = url.pathname;

    // If the user navigates directly to explorer.html (PWA cold launch,
    // bookmark, typed URL, stale cached shortcut), send them to auth.html.
    // auth.html will skip the form and forward to explorer.html automatically
    // if a valid token is already in sessionStorage (see Bug 2 fix).
    if (path === '/explorer.html' || path.endsWith('/explorer.html')) {
      return event.respondWith(
        Response.redirect('/auth.html', 302)
      );
    }

    // All other navigations load normally
    return;
}
  // ─────────────────────────────────────────────────────────────

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);

      // FIX: use freshRequest (with redirect:'follow') for the actual fetch,
      // not the original request — this was the bug; freshRequest was built
      // but then `fetch(request)` was called instead of `fetch(freshRequest)`.
      const freshRequest = new Request(request, { redirect: 'follow' });

      const networkFetch = fetch(freshRequest)        // ← was fetch(request), now fetch(freshRequest)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.status === 200 &&
            networkResponse.type !== 'opaque' &&       // ← added: don't cache opaque responses
            networkResponse.type !== 'opaqueredirect'  // ← added: don't cache redirect stubs
          ) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cached);  // network failed → serve from cache

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
