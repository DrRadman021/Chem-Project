/* Rachem service worker — rv2
   Cache-first for same-origin assets, network-first for page navigations,
   stale-while-revalidate for Google Fonts. Bump RV2_SW_VER to ship updates. */
const RV2_SW_VER = 'rv2-v1.0.0';
const CORE = ['./', 'index.html', 'manifest.json', 'favicon.ico', '_fav.svg'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(RV2_SW_VER);
    await Promise.allSettled(CORE.map(p => cache.add(new URL(p, self.registration.scope))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([RV2_SW_VER]);
    const names = await caches.keys();
    await Promise.all(names.map(n => (n.startsWith('rv2-') && !keep.has(n)) ? caches.delete(n) : null));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'rv2-skip-waiting') self.skipWaiting();
});

async function netFirst(req) {
  const cache = await caches.open(RV2_SW_VER);
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    const idx = await cache.match(new URL('./index.html', self.registration.scope));
    if (idx) return idx;
    return new Response('<h1 style="font-family:sans-serif;padding:2rem">Offline</h1>', {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(RV2_SW_VER);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req).then(f => { if (f && f.ok) cache.put(req, f.clone()).catch(() => {}); }).catch(() => {});
    return hit;
  }
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

async function swr(req) {
  const cache = await caches.open(RV2_SW_VER);
  const hit = await cache.match(req);
  const net = fetch(req).then(f => {
    if (f && (f.ok || f.type === 'opaque')) cache.put(req, f.clone()).catch(() => {});
    return f;
  }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(netFirst(req)); return; }
  if (url.origin === self.location.origin) { e.respondWith(cacheFirst(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(swr(req));
  }
  // everything else: let the browser handle it (default network)
});
