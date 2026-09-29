// Offline support. App files: network first (always fresh when online), cache as fallback.
// Plate-reader runtime and models: cache first (big, rarely change). Bump VERSION to refresh them.
const VERSION = 'rate-this-car-v1';
const APP_SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/i18n.js',
  'js/shared.js',
  'js/plate-reader.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'demo/car.jpg',
];
const HEAVY = /\/(models|vendor)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (HEAVY.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        return cached || (request.mode === 'navigate' ? caches.match('index.html') : Response.error());
      }),
  );
});
