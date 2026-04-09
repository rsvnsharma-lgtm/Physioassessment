const CACHE = 'mhitr-physio-v1';
const BASE  = '/Physioassessment/';

const STATIC = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Install: cache static shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static + CDN, network-first for everything else
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always skip non-GET and chrome-extension
  if (e.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Cache-first for our own files + CDN assets (fonts, mediapipe)
  const isCDN = CDN_HOSTS.some(h => url.hostname.includes(h));
  const isOwn = url.pathname.startsWith(BASE);

  if (isOwn || isCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => caches.match(BASE + 'index.html'));
      })
    );
    return;
  }

  // Network-first for everything else (camera, APIs)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
