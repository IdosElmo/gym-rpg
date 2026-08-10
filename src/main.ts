/**
 * main.ts — composition root.
 *
 * Wires the concrete `LocalStore` (swap here for a future cloud-backed store),
 * the rest timer, the toast and the screens, then registers the service worker
 * — but ONLY over http/https, so the single-file `file://` build still runs.
 */

import '../styles/index.css';

import { LocalStore } from './storage/LocalStore.ts';
import type { DataStore } from './storage/DataStore.ts';
import { refreshStreak } from './core/game.ts';
import { createApp } from './ui/app.ts';
import { initImportInput } from './ui/history.ts';
import { createRestTimer } from './ui/timer.ts';
import { initToast } from './ui/toast.ts';
import { must } from './ui/dom.ts';

function boot(): void {
  const store: DataStore = new LocalStore();

  initToast(must('toast'));
  // Weeks close by the passing of time, not by a user action: re-evaluate the
  // streak once per boot so a missed week is reflected before anything renders.
  refreshStreak(store);
  const timer = createRestTimer();
  const app = createApp(store, timer);
  initImportInput(store, () => app.render());
  app.render();

  registerServiceWorker();
}

/**
 * PWA: the service worker lives in `public/sw.js` and is copied next to
 * `index.html`. Registration is guarded because the same built file is also
 * opened straight from disk, where a `file://` script URL is not a valid SW.
 */
function registerServiceWorker(): void {
  const proto = location.protocol;
  if (!('serviceWorker' in navigator) || (proto !== 'https:' && proto !== 'http:')) return;
  navigator.serviceWorker.register(new URL('sw.js', location.href), { scope: './' }).catch(() => {
    /* the app is offline-capable from localStorage even without the SW */
  });
}

// The bundle is inlined into <head> by vite-plugin-singlefile, so wait for the
// shell to exist before querying it (module scripts are deferred, but the guard
// keeps us correct even if the tag ever moves or loses `type="module"`).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
