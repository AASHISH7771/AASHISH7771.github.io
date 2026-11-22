/* Kura service worker — keeps the shell (and the phrasebook) available with
   no signal, WITHOUT trapping users on a stale build.

   Strategy:
   - navigations  → network first, cache as fallback   (always try fresh HTML)
   - shell assets → stale-while-revalidate            (instant + self-updating)
   - cross-origin → never touched (translation / TTS traffic)

   Bump CACHE whenever you ship a change; activate() deletes older caches.
*/

const CACHE = 'kura-v17';

// index.html requests assets as `app.js?v=15`. A cache key includes the query
// string, so precaching the bare `./app.js` left the app with NO JavaScript
// offline — it rendered, but every script missed the cache. Keep this in step
// with the ?v= in index.html and with CACHE above.
const V = '17';

const SHELL = [
  './',
  './index.html',
  `./styles.css?v=${V}`,
  `./translit.js?v=${V}`,
  `./phrases.js?v=${V}`,
  `./app.js?v=${V}`,
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never cache translation / TTS
  if (url.pathname.endsWith('/sw.js')) return;       // never serve the SW from cache

  // 1. Navigations: try the network, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 2. Assets: serve from cache immediately, refresh in the background.
  //    The ignoreSearch retry is the safety net: if the ?v= in index.html ever
  //    drifts from V above, offline still serves a working copy instead of
  //    silently shipping a dead shell.
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const network = fetch(req)
          .then(res => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => hit
            || cache.match(req, { ignoreSearch: true })
            || cache.match(req.url.split('?')[0]));
        return hit || network;
      })
    )
  );
});


