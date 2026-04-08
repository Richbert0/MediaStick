/* MediaCenter Service Worker v2.1 */
const CACHE = 'mc-v2';
const STATIC = ['/', '/index.html', '/manifest.json',
  '/css/main.css', '/js/app.js', '/components/chat.js',
  '/images/movie-default.svg',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // API / media requests nie cachen
  if (e.request.url.includes('/api/') || e.request.url.includes('/media/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
