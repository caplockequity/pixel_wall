/* PixelWall local app shell. Generated builds replace __PIXELWALL_BUILD_ID__.
 * Artwork and billing responses are NEVER cached here. Artwork lives in IDB.
 * A new worker waits for all current windows to close, protecting active edits.
 */
const CACHE = 'pixelwall-shell-__PIXELWALL_BUILD_ID__';
const CORE = ['/editor', '/pixelwall.webmanifest', '/pixelwall-icon-192.png', '/pixelwall-icon-512.png'];
const ASSET = /\.(?:js|mjs|css|wasm|png|svg|ico|woff2?)(?:\?|$)/i;
const forbidden = (url) => url.origin !== self.location.origin || /^\/(?:api|beam)(?:\/|$)/.test(url.pathname) || url.searchParams.has('session_id');
async function fetchAsset(path) {
  const url = new URL(path, self.location.origin);
  const css = url.pathname.endsWith('.css');
  const response = await fetch(path, { cache: 'reload', credentials: 'same-origin', headers: { Accept: css ? 'text/css' : '*/*' } });
  if (!response.ok || css && !response.headers.get('content-type')?.startsWith('text/css')) throw new Error(`Offline asset has the wrong response type: ${path}`);
  if (/\.(?:m?js)$/.test(url.pathname) && !/^(?:text|application)\/(?:java|ecma)script/.test(response.headers.get('content-type') ?? '')) throw new Error(`Offline script is unavailable: ${path}`);
  return response;
}
async function cacheShell() {
  const cache = await caches.open(CACHE);
  const urls = new Set(CORE);
  const manifest = await fetch('/offline-assets.json', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!manifest.ok || !manifest.headers.get('content-type')?.includes('json')) throw new Error('Complete offline asset inventory is unavailable');
  const inventory = await manifest.json();
  if (!inventory.assets?.some((path) => /\.(?:m?js)$/.test(path))) throw new Error('Offline asset inventory contains no editor scripts');
  for (const path of inventory.assets) { const url = new URL(path, self.location.origin); if (!forbidden(url) && ASSET.test(url.pathname)) urls.add(url.pathname); }
  const editor = await fetch('/editor', { cache: 'reload', credentials: 'same-origin', headers: { Accept: 'text/html' } });
  if (!editor.ok || editor.redirected || new URL(editor.url).pathname !== '/editor' || !editor.headers.get('content-type')?.startsWith('text/html')) throw new Error('Authenticated editor shell unavailable');
  const html = await editor.clone().text();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) { const url = new URL(match[1], self.location.origin); if (!forbidden(url) && ASSET.test(url.pathname)) urls.add(url.pathname + url.search); }
  await cache.put('/editor', editor);
  // Any unavailable/mistyped bundle rejects installation; the previous complete
  // shell stays active. The signed-in shell fetch never follows a login page.
  await Promise.all([...urls].filter((url) => url !== '/editor').map(async (url) => { await cache.put(url, await fetchAsset(url)); }));
  await cache.put('/__pixelwall_offline_ready__', new Response('ready'));
}
self.addEventListener('install', (event) => event.waitUntil(cacheShell()));
self.addEventListener('activate', (event) => event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith('pixelwall-shell-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_SAVED_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'OFFLINE_STATUS') event.waitUntil((async () => { const cache = await caches.open(CACHE); event.ports[0]?.postMessage({ ready: Boolean(await cache.match('/__pixelwall_offline_ready__')), version: CACHE }); })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || forbidden(url)) return;
  if (request.mode === 'navigate' && url.pathname === '/editor') {
    event.respondWith((async () => {
      try { const response = await fetch(request); if (response.ok) return response; } catch { /* A saved shell opens without a server. */ }
      const cached = await (await caches.open(CACHE)).match('/editor');
      return cached ?? new Response('Open PixelWall once while connected to prepare offline editing.', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    })());
  } else if (ASSET.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE); const cached = await cache.match(request); if (cached) return cached;
      const response = await fetchAsset(request.url); if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone()); return response;
    })());
  }
});
