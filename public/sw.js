// CACU offline support (Doc 10 E17, Doc 13): lets the till and the offline sales page open again without a connection.
// Pages are always fetched from the network first; the last copy is used only when the network fails. The app's static
// files are cached as they load. Nothing else is cached, and nothing is ever sent from here: sales wait in IndexedDB and
// the page sends them through the normal, checked API when it is back online.
const PAGES = 'cacu-pages-v1';
const STATIC = 'cacu-static-v1';
const OFFLINE_PAGES = ['/pos', '/settings/offline'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cacu-') && ![PAGES, STATIC].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.open(STATIC).then(cache => cache.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }))));
    return;
  }

  if (request.mode === 'navigate' && OFFLINE_PAGES.includes(url.pathname)) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(PAGES).then(cache => cache.put(url.pathname, response.clone()));
      return response;
    }).catch(() => caches.open(PAGES).then(cache => cache.match(url.pathname)).then(hit => hit || Response.error())));
  }
});
