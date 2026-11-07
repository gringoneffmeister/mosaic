// Offline support: keep a copy of every file the game needs on the phone.
// Serves from the copy right away and refreshes it in the background, so an update shows up
// on the launch after it's deployed. Bump VERSION when the file list changes.
const VERSION = 'sudoku-v1';
const FILES = ['./', 'index.html', 'engine.js', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png',
  '../theme.js', '../theme.css', '../sfx.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sudoku-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || (req.mode === 'navigate' && await cache.match('index.html')) || Response.error();
  }));
});
