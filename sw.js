'use strict';
// Offline shell for the PWA install. Stale-while-revalidate: the game launches
// instantly from cache and quietly refreshes it in the background, so an update
// lands on the NEXT launch — no version bump ritual, no stale-forever cache.
// (The cache name is still versioned in case the asset list itself changes.)
const CACHE = 'cyber-ronin-v4'; // v4: ui/gamepad.js joined the asset list
const ASSETS = [
  '.', 'index.html', 'style.css', 'game.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png',
  'ui/lang.js', 'ui/core.js', 'ui/board.js', 'ui/audio.js', 'ui/sprites.js', 'ui/bgcache.js',
  'ui/scene.js', 'ui/debug.js', 'ui/gamepad.js', 'ui/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(cached => {
    const fresh = fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => cached); // offline: the cache is all there is
    return cached || fresh;
  }));
});
