/* eslint-disable no-undef */
/**
 * Gym RPG service worker — precache + offline.
 *
 * The whole app is ONE self-contained index.html (vite-plugin-singlefile), so
 * the precache list is tiny: the document itself plus the PWA metadata.
 * Strategy: cache-first for everything in scope, with a background refresh, and
 * an index.html fallback for navigations. Nothing is ever fetched cross-origin.
 *
 * Bump CACHE_VERSION when you ship a build you want clients to pick up eagerly.
 */
const CACHE_VERSION = 'gymrpg-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const fresh = await fetch(request);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('Offline', { status: 503, statusText: 'Offline' })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((res) => (res && res.ok ? cache.put(request, res.clone()) : undefined))
            .catch(() => undefined),
        );
        return cached;
      }
      try {
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
