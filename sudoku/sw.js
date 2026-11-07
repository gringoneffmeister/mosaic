// Retired: the site-wide ../sw.js now keeps Sudoku offline along with the other games.
// Phones that installed this one pick up this version, which removes itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sudoku-')).map(k => caches.delete(k))))
    .then(() => self.registration.unregister()));
});
