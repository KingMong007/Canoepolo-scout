// sw.js
const CACHE_VERSION = 'v10-2025-08-29'; // <— bump bij elke release
const APP_ASSETS = [
  '/', '/index.html', '/manifest.json', '/icons/icon-192.png',
  // voeg hier je css/js/beelden toe die je wilt cachen
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting(); // <— nieuwe SW mag meteen actief worden
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // <— neem meteen alle tabs over
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request)
    )
  );
});

// laat de pagina de SW vragen om direct te wisselen
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
