/* MediaCenter Service Worker – Netzwerk zuerst, Cache nur als Offline-Rückfall */
const CACHE = 'mc-v3';
const STATIC = ['/', '/index.html', '/manifest.json', '/css/main.css', '/js/app.js', '/components/chat.js',
  '/images/movie-default.svg', '/fonts/fonts.css', '/SPIELE.html', '/games/shared/kit.css', '/games/shared/kit.js'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API, Medien, Uploads und WebSocket nie über den Cache
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/ws')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
