/**
 * main.ts — composition root.
 *
 * Wires the concrete `LocalStore` (the cloud does not replace it — the sync
 * engine runs beside it, see `wireSync` below), the rest timer, the toast and
 * the screens, then registers the service worker — but ONLY over http/https, so
 * the single-file `file://` build still runs.
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
import { closeDueWeeks, gameOf, refreshStreak } from './core/game.ts';
import { buildGhost, ghostHash } from './core/ghost.ts';
import { defaultHandle } from './core/handle.ts';
import { publishableWeeks } from './core/leagueSync.ts';
import { todayISO } from './core/workout.ts';
import { defaultDay } from './core/plan.ts';
import { createDevApi } from './dev/actions.ts';
import { devGateOpen } from './dev/gate.ts';
import { attachDevApi, detachDevApi } from './dev/window.ts';
import { devResetCooldowns } from './ui/battle.ts';
import { isSignedIn, refreshAccountCard, type AccountDeps } from './sync/account.ts';
import { syncConfigured } from './sync/config.ts';
import { SyncEngine, type SyncStatus } from './sync/engine.ts';
import { createSupabaseSync } from './sync/supabaseBackend.ts';
import { createApp, type App, type AppHooks } from './ui/app.ts';
import type { SettingsDeps } from './ui/settings.ts';
import type { GhostDuelDeps, GhostLookupRow } from './ui/ghost.ts';
import type { LeagueCloudDeps } from './ui/league.ts';
import { initImportInput } from './ui/settings.ts';
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
  // And for exactly the same reason, grade every league week that finished
  // while the app was closed — but ONLY once this device holds the account's
  // history. Closing is a judgement about the LOG, and on a device that has
  // just signed in the log is a subset of the account: grading there files 40s
  // with no 🔵 for weeks that were fully trained, and the ledger would then have
  // to be talked out of them. So a linked install waits for the first cycle
  // (`sync.closeWeeksWhenReady`, at most a moment) and an unlinked one — the
  // offline app, the signed-out app, the single-file build — closes right here,
  // exactly as it always did.
  if (sync.closesWeeksNow()) closeDueWeeks(store);
  else sync.closeWeeksWhenReady();
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
  /**
   * Is there nothing to wait for? TRUE with no account linked on this device —
   * the log is all there will ever be, so the boot close can run immediately.
   */
  closesWeeksNow(): boolean;
  /** Otherwise: close the due weeks as soon as the first sync cycle settles. */
  closeWeeksWhenReady(): void;
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
    closesWeeksNow: () => true,
    closeWeeksWhenReady: () => undefined,
  };
  if (!syncConfigured()) return inert;

  const supabase = createSupabaseSync({ storage: window.localStorage });
  if (!supabase) return inert;

  let app: App | null = null;
  let status: SyncStatus = { kind: 'signedOut', pending: 0, lastSyncAt: null };
  let email: string | null = null;
  let deferred = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  let userId: string | null = null;
  /** The boot close is still owed — see `closeWeeksWhenReady` below. */
  let closePending = false;

  /**
   * Grade every finished week the log has not graded yet, and correct every
   * week the log now grades better than the ledger does (`closeDueWeeks`).
   *
   * Called when the device is caught up, and again after every merge that
   * actually brought something in: a pull that lands sessions from another
   * device — or the account's whole history, on a fresh install — is exactly
   * the moment a grade filed from less data can be improved.
   */
  function closeWeeks(): void {
    closePending = false;
    if (closeDueWeeks(store).closed.length > 0) repaint();
  }

  const engine = new SyncEngine({
    store,
    backend: supabase.backend,
    storage: window.localStorage,
    onStatus: (s) => {
      status = s;
      // Cheap and local: only the card repaints, never the whole screen.
      refreshAccountCard(account);
    },
    onRemoteApplied: () => {
      // New events landed. Re-grade before repainting, so the screen and the
      // ledger tell the same story in one paint rather than two.
      closeWeeks();
      repaint();
    },
    onCycleEnd: () => {
      // The first cycle has settled — caught up, or unable to reach the server
      // at all. Either way the boot close waits no longer: an install that can
      // never sync must still grade its own weeks.
      if (closePending) closeWeeks();
    },
    /**
     * THE GHOST PUBLISHER. The engine owns "when" (after a successful cycle,
     * only when the fingerprint moved); this owns "what" — a snapshot of the
     * character as it is right now. It reads the game state and nothing else,
     * and it never writes: a ghost is presence data beside the log, never in it.
     */
    ghost: {
      snapshot: (handle: string) => {
        const payload = buildGhost(gameOf(store), handle);
        return { payload: payload as unknown as Record<string, unknown>, hash: ghostHash(payload) };
      },
      defaultHandle: (id: string) => defaultHandle(email, id),
    },
    /**
     * THE LEAGUE PUBLISHER. Same division of labour as the ghost's: the engine
     * owns "when" (after a successful cycle, only what is not published yet);
     * this owns "what" — the closed weeks of the current and previous month,
     * read straight off the ledger the log folds to. It reads and never writes:
     * a published week is a copy of a fact the log already holds.
     */
    league: {
      rows: () => publishableWeeks(gameOf(store).league.weeks, todayISO(new Date())),
    },
  });

  /**
   * What the arena needs to run a duel. Every call is a thin pass-through: the
   * engine owns the device-local bookkeeping (my name, who I fought lately) and
   * the backend owns the lookup, so this object holds no state of its own.
   */
  const ghost: GhostDuelDeps = {
    signedIn: () => isSignedIn(status),
    myHandle: () => engine.getGhostHandle() || (userId ? defaultHandle(email, userId) : ''),
    recent: () => engine.getRecentOpponents(),
    remember: (handle: string) => engine.rememberOpponent(handle),
    fetch: (handle: string): Promise<GhostLookupRow | null> => supabase.backend.fetchGhost(handle),
  };

  /**
   * What 🏆 הליגה needs from the cloud. Same shape of pass-through as the duel
   * card's: the engine owns the cache, the notebook and the staleness contract,
   * and this object holds no state of its own.
   *
   * IT SHARES THE DUEL'S RECENT LIST on purpose — `getRecentOpponents` /
   * `rememberOpponent`, not a second notebook slot. A handle is one identity
   * across the whole social surface, so the person you duel is the person you
   * race, and the league screen opens on the rival you last met without anybody
   * typing a name twice.
   *
   * `fetchGhost` is here only for the 🛠 marker: a `league_weeks` row carries no
   * dev flag (and this stage adds no column), while the `ghosts` row already
   * does — so the rival's flag is read from the table that has it.
   */
  const league: LeagueCloudDeps = {
    signedIn: () => isSignedIn(status),
    myHandle: () => ghost.myHandle(),
    recent: () => engine.getRecentOpponents(),
    remember: (handle: string) => engine.rememberOpponent(handle),
    cached: (handle: string, monthKey: string) => engine.getLeagueMonth(handle, monthKey),
    load: (handle: string, monthKey: string) => engine.loadLeagueMonth(handle, monthKey),
    fetchGhost: (handle: string) => supabase.backend.fetchGhost(handle),
  };

  const account: AccountDeps = {
    getStatus: () => status,
    getEmail: () => email,
    getHandle: () => ghost.myHandle(),
    setHandle: (handle: string) => engine.setGhostHandle(handle),
    refresh: () => refreshAccountCard(account),
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

  /**
   * The settings hooks are MUTABLE on purpose: the dev panel appears (and
   * disappears) with the session, long after the app was created, and `ui/app.ts`
   * spreads this object on every render — so assigning `dev` here is enough for
   * the next paint to have the card, and deleting it is enough for the card to
   * be gone. No re-wiring, no second hook channel.
   */
  const settingsHooks: Pick<SettingsDeps, 'account' | 'isSignedIn' | 'onLocalMerge' | 'dev'> = {
    account,
    isSignedIn: () => isSignedIn(status),
    onLocalMerge: () => {
      // An import arrived through `replaceAll`, which the engine cannot see.
      engine.enqueueAll();
      void engine.sync();
    },
  };

  /**
   * THE DEV PANEL — built once, handed out only while the gate is open.
   *
   * The API itself is harmless to construct (it is a closure over the store), so
   * the gate governs exactly two things: whether the settings screen is given
   * `dev`, and whether `window.gymDev` exists. Both are re-evaluated on every
   * auth change, which is what makes signing out take the panel away.
   */
  const devApi = createDevApi({
    store,
    day: () => defaultDay(store.getState().plan),
    resetCooldowns: devResetCooldowns,
    onChange: () => app?.render(),
  });
  let devOpen = false;

  async function refreshDevMode(): Promise<void> {
    const open = await devGateOpen({ email, protocol: location.protocol });
    if (open === devOpen) return;
    devOpen = open;
    if (open) {
      settingsHooks.dev = { api: devApi };
      attachDevApi(window as unknown as Record<string, unknown>, devApi);
    } else {
      delete settingsHooks.dev;
      detachDevApi(window as unknown as Record<string, unknown>);
    }
    app?.render();
  }

  return {
    hooks: {
      settings: settingsHooks,
      ghost,
      league,
      onRender: () => {
        deferred = false;
      },
    },
    attach: (a: App) => {
      app = a;
      engine.start();
      supabase.auth.onChange((user) => {
        email = user?.email ?? null;
        userId = user?.id ?? null;
        if (user) void engine.onSignedIn(user.id);
        else engine.stop();
        void refreshDevMode();
        if (!refreshAccountCard(account)) app?.render();
      });
      // The session restored on load (or completed from an OAuth redirect).
      void supabase.auth.getUser().then((user) => {
        if (!user) return;
        email = user.email;
        userId = user.id;
        void refreshDevMode();
        void engine.onSignedIn(user.id);
      });
    },
    isSignedIn: () => isSignedIn(status),
    onLocalMerge: () => {
      engine.enqueueAll();
      void engine.sync();
    },
    closesWeeksNow: () => !engine.hasAccount(),
    closeWeeksWhenReady: () => {
      closePending = true;
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
