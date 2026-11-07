// Offline support for every game on the site: one copy of all the files, kept on the phone.
// Opening any game online once stores all of them. Online, pages load fresh from the network
// (so a move link never meets old code); with no signal, or a network that stalls, the saved copy is used.
// Bump VERSION when FILES changes.
const VERSION = 'mosaic-v1';
const FILES = [
  './', 'index.html', 'engine.js', 'sfx.js', 'theme.js', 'theme.css', 'manifest.json', 'icon.svg', 'icon-180.png', 'icon-512.png',
  'chess/', 'chess/index.html', 'chess/engine.js', 'chess/pieces.js', 'chess/manifest.json', 'chess/icon.svg', 'chess/icon-180.png', 'chess/icon-512.png',
  'sixes/', 'sixes/index.html', 'sixes/engine.js', 'sixes/manifest.json', 'sixes/icon.svg', 'sixes/icon-180.png', 'sixes/icon-512.png',
  'sudoku/', 'sudoku/index.html', 'sudoku/engine.js', 'sudoku/manifest.json', 'sudoku/icon.svg', 'sudoku/icon-180.png', 'sudoku/icon-512.png',
];
const WAIT = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(cache => new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const saved = () => cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    net.then(finish, async () => finish((await saved()) || Response.error()));
    // A network that hangs (airplane Wi-Fi before login) falls back to the saved copy.
    setTimeout(async () => finish(await saved()), WAIT);
    e.waitUntil(net.catch(() => {}));
  })));
});
