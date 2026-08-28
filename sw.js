/* CTTLFA service worker — makes the site installable (Add to Home Screen) and
   gives basic offline access to the last-viewed pages. Deliberately NETWORK-FIRST
   for everything, so an online visitor always gets the current site and fresh
   match data; the cache is only a fallback when the device is offline. */
const CACHE = 'cttlfa-v1';
const SHELL = ['/', '/index.html', '/assets/crest.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return; // never touch cross-origin (fonts, dashboard, etc.)

  // Page navigations: try the network, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () {
      return caches.match('/index.html').then(function (r) { return r || caches.match('/'); });
    }));
    return;
  }

  // Everything else (assets + data): network-first, refresh cache, fall back to cache offline.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
