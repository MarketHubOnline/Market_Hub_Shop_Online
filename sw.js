const CACHE_NAME = 'markethub-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/marketplace.css',
  './css/dashboards.css',
  './js/config.js',
  './js/utils.js',
  './js/auth.js',
  './js/navigation.js',
  './js/marketplace.js',
  './js/productDetail.js',
  './js/cart.js',
  './js/checkout.js',
  './js/orders.js',
  './js/seller.js',
  './js/admin.js',
  './js/chat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
