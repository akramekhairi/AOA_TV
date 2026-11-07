// Offline navigation shell only. API responses, signed assets and credentials are never cached.
const CACHE = 'aoa-shell-v1';
const BASE = new URL('./', self.location.href).pathname;
self.addEventListener('install', event => { event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const shell = await fetch(BASE, {cache:'reload'});
  if(!shell.ok) throw new Error('Shell unavailable');
  const markup = await shell.clone().text();
  await cache.put(BASE, shell);
  const assets = [...markup.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => new URL(match[1], self.location.origin + BASE)).filter(url => url.origin === self.location.origin && url.pathname.startsWith(BASE + 'assets/') && !url.search).map(url => url.href);
  await cache.addAll([...assets, BASE + 'icon.svg', BASE + 'icon-192.png']);
})()); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aoa-shell-') && key !== CACHE).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.headers.has('Authorization') || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || url.search || url.pathname.includes('/api/')) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match(BASE)));
  else if (url.pathname.startsWith(BASE + 'assets/')) event.respondWith(caches.open(CACHE).then(async cache => { const cached = await cache.match(event.request); if(cached) return cached; const response = await fetch(event.request); if(response.ok) await cache.put(event.request, response.clone()); return response; }));
});
