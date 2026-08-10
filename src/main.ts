/**
 * main.ts — composition root.
 *
 * Wires the concrete `LocalStore` (swap here for a future cloud-backed store),
 * the rest timer, the toast and the screens, then registers the service worker
 * — but ONLY over http/https, so the single-file `file://` build still runs.
 *
 * It is also the ONLY module that knows cloud sync exists at all: it is the one
 * place `sync/supabaseBackend.ts` (and therefore `@supabase/supabase-js`) is
 * imported from, and everything it builds is handed to the UI as plain
 * callbacks. If `syncConfigured()` is false — placeholder config, or the
 * single-file build opened from disk — none of it is constructed, no listener
 * is attached and the account card is never rendered: the app is exactly the
 * offline app it has always been.
 */

import '../styles/index.css';

import { LocalStore } from './storage/LocalStore.ts';
import type { DataStore } from './storage/DataStore.ts';
import { refreshStreak } from './core/game.ts';
import { isSignedIn, refreshAccountCard, type AccountDeps } from './sync/account.ts';
import { syncConfigured } from './sync/config.ts';
import { SyncEngine, type SyncStatus } from './sync/engine.ts';
import { createSupabaseSync } from './sync/supabaseBackend.ts';
import { createApp, type App, type AppHooks } from './ui/app.ts';
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

  const sync = wireSync(store);
  const app = createApp(store, timer, sync.hooks);
  sync.attach(app);
  initImportInput(store, () => app.render(), {
    isSignedIn: sync.isSignedIn,
    onLocalMerge: sync.onLocalMerge,
  });
  app.render();

  registerServiceWorker();
}

/* ------------------------------------------------------------ cloud sync */

interface SyncWiring {
  hooks: AppHooks;
  /** Called once the app exists, to give the wiring something to repaint. */
  attach(app: App): void;
  isSignedIn(): boolean;
  onLocalMerge(): void;
}

/**
 * Build the engine + account plumbing, or a set of inert no-ops.
 *
 * The deferred-repaint rule lives here, and it is the only genuinely subtle bit:
 * a pull can land at ANY moment, and re-rendering the screen out from under
 * someone mid-interaction is worse than showing them stale numbers for a few
 * seconds. So a remote merge repaints immediately unless the user is either
 * typing into a set (`.inp` focused inside #main) or watching a live battle —
 * in which case the repaint is flagged and picked up by the next render, i.e.
 * the next tab switch, or a short retry once the moment has passed. The DATA is
 * already merged either way; only the pixels wait.
 */
function wireSync(store: DataStore): SyncWiring {
  const inert: SyncWiring = {
    hooks: {},
    attach: () => undefined,
    isSignedIn: () => false,
    onLocalMerge: () => undefined,
  };
  if (!syncConfigured()) return inert;

  const supabase = createSupabaseSync({ storage: window.localStorage });
  if (!supabase) return inert;

  let app: App | null = null;
  let status: SyncStatus = { kind: 'signedOut', pending: 0, lastSyncAt: null };
  let email: string | null = null;
  let deferred = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const engine = new SyncEngine({
    store,
    backend: supabase.backend,
    storage: window.localStorage,
    onStatus: (s) => {
      status = s;
      // Cheap and local: only the card repaints, never the whole screen.
      refreshAccountCard(account);
    },
    onRemoteApplied: () => repaint(),
  });

  const account: AccountDeps = {
    getStatus: () => status,
    getEmail: () => email,
    signIn: () => void supabase.auth.signInWithGoogle().catch(() => undefined),
    signOut: () => {
      void supabase.auth.signOut().catch(() => undefined);
      // Stop syncing immediately rather than waiting for the auth callback: the
      // user asked for it, and the local data is untouched either way.
      engine.stop();
      app?.render();
    },
  };

  /** Is it a bad moment to repaint the screen? */
  function busy(): boolean {
    if (store.getState().ui.view === 'BT') return true; // a battle is running
    const active = document.activeElement;
    const main = document.getElementById('main');
    return active instanceof HTMLElement && active.classList.contains('inp') && (main?.contains(active) ?? false);
  }

  function repaint(): void {
    if (busy()) {
      deferred = true;
      if (retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (deferred) repaint();
        }, 3_000);
      }
      return;
    }
    app?.render(); // `onRender` below clears the flag
  }

  return {
    hooks: {
      history: {
        account,
        isSignedIn: () => isSignedIn(status),
        onLocalMerge: () => {
          // An import arrived through `replaceAll`, which the engine cannot see.
          engine.enqueueAll();
          void engine.sync();
        },
      },
      onRender: () => {
        deferred = false;
      },
    },
    attach: (a: App) => {
      app = a;
      engine.start();
      supabase.auth.onChange((user) => {
        email = user?.email ?? null;
        if (user) void engine.onSignedIn(user.id);
        else engine.stop();
        if (!refreshAccountCard(account)) app?.render();
      });
      // The session restored on load (or completed from an OAuth redirect).
      void supabase.auth.getUser().then((user) => {
        if (!user) return;
        email = user.email;
        void engine.onSignedIn(user.id);
      });
    },
    isSignedIn: () => isSignedIn(status),
    onLocalMerge: () => {
      engine.enqueueAll();
      void engine.sync();
    },
  };
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
