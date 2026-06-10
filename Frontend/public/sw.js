/* GovPrep service worker — offline app shell (network-first for navigations,
   cache-first for hashed build assets). Bump CACHE_VERSION to invalidate. */
const CACHE_VERSION = 'govprep-shell-v1';
const BASE = '/Govt-Prep/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll([BASE, BASE + 'manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // SPA navigations: network first, fall back to the cached shell when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(BASE, copy));
          return res;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }

  // Hashed build assets: cache first (immutable filenames).
  if (url.pathname.startsWith(BASE + 'assets/')) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
            return res;
          }),
      ),
    );
  }
});
