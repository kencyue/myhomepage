const CACHE_NAME = 'ken-paint-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './pwa-icon.svg',
  './icons/ken-paint-logo.png',
  './icons/gallery.png',
  './icons/camera.png',
  './icons/undo.png',
  './icons/crop.png',
  './icons/cancel.png',
  './icons/pen.png',
  './icons/highlighter.png',
  './icons/circle.png',
  './icons/square.png',
  './icons/lightcircle.png',
  './icons/lightsquare.png',
  './icons/text.png',
  './icons/share.png',
  './icons/download.png',
  './icons/clear.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'error') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);

      return cached || network;
    })
  );
});