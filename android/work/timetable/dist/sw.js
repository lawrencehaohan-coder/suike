/*
 * 随课 static app shell. Increment VERSION whenever bundled files change.
 * Private hosting limitations: the browser must first load and install this
 * worker successfully while signed in. Login pages, auth redirects, URLs with
 * query parameters and responses marked no-store are never cached. A host that
 * requires authentication for the worker/assets may therefore prevent offline
 * use. Browser storage eviction may also remove the cache. A previously cached
 * shell can remain usable offline on this device; server sign-out or permission
 * revocation cannot remotely erase that offline copy or localStorage data.
 */
'use strict';

const VERSION = '2026-10-11.3';
const CACHE_PREFIX = 'suike-static-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const SCOPE_URL = new URL('./', self.registration.scope);
const ASSET_TYPES = {
  'index.html': /^text\/html\b/i,
  'styles.css': /^text\/css\b/i,
  'seed-data.js': /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)\b/i,
  'model.js': /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)\b/i,
  'app.js': /^(?:text|application)\/(?:javascript|x-javascript|ecmascript)\b/i,
  'manifest.webmanifest': /^application\/(?:manifest\+json|json)\b/i,
  'icon.svg': /^image\/svg\+xml\b/i,
  'icon-192.png': /^image\/png\b/i,
  'icon-512.png': /^image\/png\b/i,
  'maskable-512.png': /^image\/png\b/i
};
const ASSETS = new Map(Object.entries(ASSET_TYPES).map(([file, type]) => {
  const url = new URL(file, SCOPE_URL);
  return [url.pathname, {file, url: url.href, type}];
}));
const INDEX_ASSET = ASSETS.get(new URL('index.html', SCOPE_URL).pathname);
const NAV_PATHS = new Set([SCOPE_URL.pathname, new URL('index.html', SCOPE_URL).pathname]);

function cleanSameOrigin(url) {
  return url.origin === SCOPE_URL.origin && !url.search && !url.hash && !url.username && !url.password;
}

async function safeToCache(response, asset) {
  if (!response || !response.ok || response.status !== 200 || response.redirected ||
      !['basic', 'default'].includes(response.type)) return false;
  if (/\bno-store\b/i.test(response.headers.get('cache-control') || '')) return false;
  if (!asset.type.test(response.headers.get('content-type') || '')) return false;
  let finalURL;
  try { finalURL = new URL(response.url); } catch { return false; }
  if (!cleanSameOrigin(finalURL)) return false;
  // A root navigation may resolve to the directory itself or to index.html.
  if (asset.file === 'index.html') {
    if (!NAV_PATHS.has(finalURL.pathname)) return false;
    // Avoid caching a same-URL authentication page returned as a 200 rewrite.
    const html = await response.clone().text();
    return html.includes('id="courseForm"') && html.includes('manifest.webmanifest') && html.includes('app.js');
  }
  return finalURL.pathname === new URL(asset.url).pathname;
}

async function openCache() {
  try { return await caches.open(CACHE_NAME); } catch { return null; }
}

async function storeResponse(cache, asset, response) {
  if (!cache) return;
  try {
    if (await safeToCache(response, asset)) await cache.put(asset.url, response.clone());
  } catch { /* A full/disabled cache must not prevent a valid online response. */ }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await openCache();
    // One failed or auth-protected asset must not turn a login page into a cache.
    await Promise.all([...ASSETS.values()].map(async asset => {
      try {
        const response = await fetch(asset.url, {credentials: 'same-origin', cache: 'reload'});
        await storeResponse(cache, asset, response);
      } catch { /* A later successful online request may populate this asset. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigationResponse(request) {
  const cache = await openCache();
  try {
    // Let online authentication redirects reach the browser; never cache them.
    const response = await fetch(new Request(request, {credentials: 'same-origin'}));
    await storeResponse(cache, INDEX_ASSET, response);
    return response;
  } catch (error) {
    const cached = cache && await cache.match(INDEX_ASSET.url);
    if (cached) return cached;
    throw error;
  }
}

async function staticResponse(request, asset) {
  const cache = await openCache();
  const cached = cache && await cache.match(asset.url);
  if (cached) return cached;
  const response = await fetch(new Request(request, {credentials: 'same-origin'}));
  await storeResponse(cache, asset, response);
  return response;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Do not handle tokenized URLs, external requests, APIs or account pages.
  if (!cleanSameOrigin(url)) return;
  if (event.request.mode === 'navigate') {
    if (NAV_PATHS.has(url.pathname)) event.respondWith(navigationResponse(event.request));
    return;
  }
  const asset = ASSETS.get(url.pathname);
  if (asset) event.respondWith(staticResponse(event.request, asset));
});
