/* eslint-disable no-undef */
/**
 * Ori service worker — precache + offline.
 *
 * The whole app is ONE self-contained index.html (vite-plugin-singlefile), so
 * the precache list is tiny: the document itself plus the PWA metadata.
 * Strategy: cache-first for everything in scope, with a background refresh, and
 * an index.html fallback for navigations. Nothing is ever fetched cross-origin.
 *
 * Bump CACHE_VERSION when you ship a build you want clients to pick up eagerly.
 */
const CACHE_VERSION = 'gymrpg-v2';
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

/**
 * 🔔 Meal reminders. The `meal-reminders` Edge Function pushes
 * `{ title, body, tag }`; the tag is per meal, so a reminder replaces an older
 * one for the same meal instead of stacking. A push with an unreadable body
 * still shows something — a push that shows nothing gets the site's push
 * permission revoked by the browser.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : '🍽️ תזכורת לארוחה';
  const body = typeof data.body === 'string' ? data.body : '';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'meal';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      lang: 'he',
      dir: 'rtl',
      icon: './icon.svg',
      badge: './icon.svg',
    }),
  );
});

/** Tapping a reminder brings the app forward — the open window, or a new one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow('./');
    })(),
  );
});
