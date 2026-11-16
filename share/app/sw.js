// Spine for iPhone opens without a connection: its page, script, icon and font
// are kept here, and articles and notes are in the app's own database. The
// page itself is asked for first, so a new version arrives as soon as there's
// a connection.
const CACHE = 'spine-app-__VERSION__';
const KEEP = [
  '/app/',
  '/app/app.js?v=__VERSION__',
  '/app/manifest.webmanifest',
  '/app/apple-touch-icon.png',
  '/app/icon-192.png',
  '/reader/fonts/Newsreader.ttf',
  '/reader/fonts/Newsreader-Italic.ttf',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(KEEP))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(names => Promise.all(names.filter(name => name.startsWith('spine-app-') && name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/app/')));
    return;
  }
  if (KEEP.includes(url.pathname + url.search)) {
    event.respondWith(caches.match(request).then(kept => kept ?? fetch(request)));
  }
});
