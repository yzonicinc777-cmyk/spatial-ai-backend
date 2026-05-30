const CACHE_NAME = 'spatial-ai-v2'; // Changed from v1 to force a refresh
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/detection.worker.js',
  '/manifest.json',
  '/pkg/spatial_explorer_core.js',
  '/pkg/spatial_explorer_core_bg.wasm'
];

self.addEventListener('fetch', event => {
  // Never intercept non-GET or cross-origin requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          cache.put(event.request, response.clone());
        }
        return response;
      }).catch(() => cached);  // network fail → return cache
      return cached || fetchPromise;
    })
  );
});