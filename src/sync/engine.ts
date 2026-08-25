/**
 * sync/engine.ts — the write-behind sync loop.
 *
 * WHAT IT IS
 * ----------
 * A headless background process that sits BESIDE the store, not in front of it.
 * The app writes to `LocalStore` synchronously and never waits for the network;
 * the engine watches those writes through `store.subscribeEvents`, pushes them
 * when it can, pulls what other devices wrote, and merges. Losing the network,
 * the account, or the whole backend degrades the app to exactly what it was
 * before this file existed: a fast offline app.
 *
 * ONE CYCLE = flush coalesced → push outbox → pull pages → merge → (ghost) →
 * (league weeks). The last two steps are the side channels — the ghost-duel
 * snapshot and the closed league weeks — and they are deliberately last and
 * deliberately failure-tolerant: both live BESIDE the log, never in it, so
 * neither can delay or break a backup.
 * Cycles never overlap (`this.cycle`); a request that arrives mid-cycle sets a
 * rerun flag instead of racing.
 *
 * WHY AN OUTBOX OF IDS
 * --------------------
 * The event log is the only copy of any payload. The outbox stores ids into it,
 * so the two can never disagree, and it survives reloads (`sync/meta.ts`) so a
 * workout logged in a tunnel is still uploaded tomorrow.
 *
 * WHY COALESCING
 * --------------
 * Every keystroke in a weight field appends a `set_logged` event — that is the
 * local design and it stays. But those events are a full snapshot (`w` AND `r`),
 * so only the last one per `date|exId|setIndex` carries information. Typing
 * "42.5" locally produces four events and uploads ONE. Anything that is not a
 * `set_logged` flushes the buffer first, so a value never travels after the
 * checkmark that confirmed it.
 *
 * WHY THE MERGE CANNOT LOOP
 * -------------------------
 * A merge lands via `store.replaceAll`, which deliberately does NOT emit to
 * `subscribeEvents`, and the engine appends nothing of its own when it merges.
 * So pulled events cannot be mistaken for local writes and pushed back, and two
 * devices cannot ping-pong markers at each other forever.
 *
 * DETERMINISM
 * -----------
 * No `Date.now()`, no `Math.random()` anywhere in here: the clock is injected
 * (`now`) and ids come from the store. Everything below is therefore testable
 * with fake timers and an in-memory backend (`tests/sync.engine.test.ts`).
 */

import {
  emptyOpponentMonth,
  opponentMonth,
  type LeagueWeekUpload,
  type OpponentMonth,
} from '../core/leagueSync.ts';
import type { AppEvent, DataStore, Unsubscribe } from '../storage/DataStore.ts';
import { mergeIntoStore } from '../storage/merge.ts';
import { ensureDeviceId, type StorageLike } from '../storage/migrate.ts';
import { isAuthError, type SyncBackend } from './backend.ts';
import {
  GHOST_RECENT_MAX,
  clearSyncMeta,
  emptySyncMeta,
  readSyncMeta,
  writeSyncMeta,
  type SyncMeta,
} from './meta.ts';

/* --------------------------------------------------------------- status */

/**
 * `disabled`  — no project configured (the account card is not even rendered);
 * `signedOut` — configured, nobody signed in: purely local, like always;
 * `idle`      — signed in, everything this device knows is on the server;
 * `syncing`   — a cycle is running;
 * `offline`   — no connection; the outbox waits, nothing is lost;
 * `error`     — the last cycle failed; a retry is scheduled with backoff;
 * `reauth`    — the session expired; retrying cannot help, the user must act.
 */
export type SyncStatusKind =
  | 'disabled'
  | 'signedOut'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'reauth';

export interface SyncStatus {
  kind: SyncStatusKind;
  /** Events not yet known to be on the server (outbox + coalesce buffer). */
  pending: number;
  lastSyncAt: number | null;
  /** Human-readable detail for `error` (never shown as the primary message). */
  message?: string;
}

/* --------------------------------------------------------------- timings */

export interface SyncTiming {
  /** Idle time after the last keystroke before a `set_logged` is uploaded. */
  coalesceMs: number;
  /** Debounce between a local write and the cycle it triggers. */
  pushDebounceMs: number;
  /** Poll period while the tab is visible. */
  pollMs: number;
  /** Rows per push request (Supabase upserts are happiest in batches). */
  pushChunk: number;
  /** Rows per pull page. */
  pullLimit: number;
  /** Ceiling for the exponential backoff. */
  maxBackoffMs: number;
}

export const DEFAULT_TIMING: SyncTiming = {
  coalesceMs: 1_500,
  pushDebounceMs: 500,
  pollMs: 60_000,
  pushChunk: 500,
  pullLimit: 1_000,
  maxBackoffMs: 5 * 60_000,
};

/**
 * Retry delay after `failures` consecutive failed cycles: 1s, 2s, 4s, 8s … up
 * to the cap. Reset to zero by any success and by the `online` event — coming
 * back from a tunnel should not wait out a backoff earned while offline.
 */
export function backoffDelay(failures: number, max: number = DEFAULT_TIMING.maxBackoffMs): number {
  if (failures <= 0) return 0;
  const exp = Math.min(failures - 1, 30);
  return Math.min(1_000 * 2 ** exp, max);
}

/* ----------------------------------------------------------- environment */

/** The slice of `window` / `document` the engine listens on (injectable). */
export interface EngineTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SyncEngineOptions {
  store: DataStore;
  backend: SyncBackend;
  /** Where `gymrpg_sync_v1` lives. Same storage the store uses, normally. */
  storage: StorageLike;
  /** Injected clock — the engine never calls `Date.now()` itself. */
  now?: () => number;
  onStatus?: (status: SyncStatus) => void;
  /** Called after a pull actually changed local state, so the UI can repaint. */
  onRemoteApplied?: () => void;
  /** `false` keeps the engine inert and reports `disabled`. */
  enabled?: boolean;
  /** `window`-ish (online/offline/pagehide). `null` = no listeners (tests). */
  win?: EngineTarget | null;
  /** `document`-ish (visibilitychange). */
  doc?: EngineTarget | null;
  isOnline?: () => boolean;
  isVisible?: () => boolean;
  deviceId?: string;
  timing?: Partial<SyncTiming>;
  /**
   * The ghost publisher, when this build has ghost duels. Absent = the engine
   * never touches the `ghosts` table at all.
   */
  ghost?: GhostPublisher;
  /**
   * The league publisher, when this build has הליגה. Absent = the engine never
   * touches the `league_weeks` table at all.
   */
  league?: LeaguePublisher;
}

/**
 * What the engine needs in order to publish a ghost — and no more.
 *
 * The engine knows nothing about characters, levels or hashing: it asks for a
 * snapshot, compares the fingerprint with the one it published last time, and
 * uploads only when they differ. `main.ts` supplies the function that reads the
 * game state, so this module stays free of the game layer.
 */
export interface GhostPublisher {
  /**
   * The snapshot to publish under `handle`, or `null` when there is nothing to
   * publish (no game state worth sharing yet).
   */
  snapshot(handle: string): { payload: Record<string, unknown>; hash: string } | null;
  /** A handle to use when the device has not chosen one (derived from the account). */
  defaultHandle(userId: string): string;
}

/**
 * What the engine needs in order to publish league weeks — and no more.
 *
 * The engine knows nothing about scores, weeks or months: it asks for the rows
 * that are eligible right now (the closed weeks of the current and previous
 * month — `core/leagueSync.ts` → `publishableWeeks`), diffs them against the set
 * it has already published, and uploads the difference. `main.ts` supplies the
 * function that reads the ledger and today's date, so this module stays free of
 * both the game layer and the clock.
 *
 * WHY THE WHOLE ELIGIBLE LIST RATHER THAN "WHAT JUST CLOSED": because the answer
 * to "what just closed" is not knowledge this device necessarily has. A week can
 * close while the app is signed out, on another device, or between two installs;
 * `closeDueWeeks` returns the weeks IT closed, and nothing returns the weeks
 * somebody else's cycle closed. Diffing the ledger against the notebook makes
 * the publisher self-healing instead: whatever is closed and not yet published
 * goes up, whenever it was closed and whoever closed it.
 */
export interface LeaguePublisher {
  /** Closed weeks eligible for publishing right now, oldest first. */
  rows(): readonly LeagueWeekUpload[];
}

/** An opponent's month, plus how fresh it is — what the league screen reads. */
export interface LeagueMonthView {
  handle: string;
  monthKey: string;
  month: OpponentMonth;
  /** ms epoch these rows were read from the server; `null` = never read. */
  fetchedAt: number | null;
  /**
   * True when this did NOT come from the network just now: the cached copy of
   * an earlier fetch, or an empty month because the device is offline / signed
   * out. The numbers may be behind; they are never wrong-by-invention.
   */
  stale: boolean;
}

type TimerId = ReturnType<typeof setTimeout>;

function defaultOnline(): boolean {
  const nav: Navigator | undefined = globalThis.navigator;
  return typeof nav?.onLine === 'boolean' ? nav.onLine : true;
}

function defaultVisible(): boolean {
  const doc: Document | undefined = globalThis.document;
  return typeof doc?.visibilityState === 'string' ? doc.visibilityState === 'visible' : true;
}

/** `date|exId|setIndex` — the identity of a logged set, and the coalesce key. */
function coalesceKey(payload: Readonly<Record<string, unknown>>): string | null {
  const date = payload['date'];
  const exId = payload['exId'];
  const idx = payload['setIndex'];
  if (typeof date !== 'string' || typeof exId !== 'string' || typeof idx !== 'number') return null;
  return `${date}|${exId}|${idx}`;
}

/* ---------------------------------------------------------------- engine */

export class SyncEngine {
  private readonly store: DataStore;
  private readonly backend: SyncBackend;
  private readonly storage: StorageLike;
  private readonly now: () => number;
  private readonly statusCb: (status: SyncStatus) => void;
  private readonly remoteCb: () => void;
  private readonly timing: SyncTiming;
  private readonly enabled: boolean;
  private readonly win: EngineTarget | null;
  private readonly doc: EngineTarget | null;
  private readonly isOnline: () => boolean;
  private readonly isVisible: () => boolean;
  private readonly ghost: GhostPublisher | null;
  private readonly league: LeaguePublisher | null;

  private meta: SyncMeta;
  /**
   * Every event id this device has ever held locally or pulled. Maintained
   * incrementally (the log can be thousands of events; a pull must not rescan
   * it). It only ever GROWS — notably `clear()` does not shrink it, so a wiped
   * device cannot re-adopt the very events it just erased.
   */
  private readonly knownIds: Set<string>;
  /** `date|exId|setIndex` -> id of the newest `set_logged` for that set. */
  private readonly coalesced = new Map<string, string>();

  private unsubscribe: Unsubscribe | null = null;
  private coalesceTimer: TimerId | null = null;
  private pushTimer: TimerId | null = null;
  private backoffTimer: TimerId | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private cycle: Promise<void> | null = null;
  private rerun = false;
  private failures = 0;
  private kind: SyncStatusKind;
  private message: string | undefined;
  private lastEmitted = '';

  private readonly onOnline = (): void => {
    // A fresh connection deserves a fresh chance: drop the backoff entirely.
    this.failures = 0;
    this.clearBackoff();
    void this.sync();
  };
  private readonly onOffline = (): void => {
    if (this.canSync()) this.setStatus('offline');
  };
  private readonly onPageHide = (): void => {
    // Last chance to persist what the user typed: no network, just bookkeeping.
    this.flushCoalesced();
  };
  private readonly onVisibility = (): void => {
    if (this.isVisible()) {
      this.startPolling();
      void this.sync();
    } else {
      this.stopPolling();
      this.flushCoalesced();
    }
  };

  constructor(opts: SyncEngineOptions) {
    this.store = opts.store;
    this.backend = opts.backend;
    this.storage = opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.statusCb = opts.onStatus ?? ((): void => undefined);
    this.remoteCb = opts.onRemoteApplied ?? ((): void => undefined);
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.enabled = opts.enabled !== false;
    this.win = opts.win === undefined ? (globalThis.window ?? null) : opts.win;
    this.doc = opts.doc === undefined ? (globalThis.document ?? null) : opts.doc;
    this.isOnline = opts.isOnline ?? defaultOnline;
    this.isVisible = opts.isVisible ?? defaultVisible;
    this.ghost = opts.ghost ?? null;
    this.league = opts.league ?? null;

    // The device id belongs to the INSTALL, not to the engine: it already sits
    // in this same storage (`LocalStore` minted it), so the notebook records the
    // real one instead of an empty string nobody ever passed.
    this.meta = readSyncMeta(this.storage, opts.deviceId ?? ensureDeviceId(this.storage));
    this.knownIds = new Set(this.store.getEvents().map((e) => e.id));
    this.kind = !this.enabled ? 'disabled' : this.meta.userId ? 'idle' : 'signedOut';
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Attach to the store and the environment. Safe to call twice. */
  start(): void {
    if (!this.enabled || this.unsubscribe) {
      this.emit();
      return;
    }
    this.unsubscribe = this.store.subscribeEvents((ev) => this.onLocalEvent(ev));
    this.win?.addEventListener('online', this.onOnline);
    this.win?.addEventListener('offline', this.onOffline);
    this.win?.addEventListener('pagehide', this.onPageHide);
    this.doc?.addEventListener('visibilitychange', this.onVisibility);
    if (this.isVisible()) this.startPolling();
    this.emit();
    if (this.canSync()) void this.sync();
  }

  /**
   * SIGN OUT. Forgets the account, the cursor and the outbox; keeps every byte
   * of app data. Signing back in re-links from scratch (full push + full pull),
   * which is the only safe assumption once we've thrown the cursor away.
   */
  stop(): void {
    this.clearTimers();
    this.coalesced.clear();
    clearSyncMeta(this.storage);
    this.meta = emptySyncMeta(this.meta.deviceId);
    this.failures = 0;
    this.message = undefined;
    this.setStatus('signedOut');
  }

  /** Detach from store + environment entirely (teardown / tests). */
  dispose(): void {
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.win?.removeEventListener('online', this.onOnline);
    this.win?.removeEventListener('offline', this.onOffline);
    this.win?.removeEventListener('pagehide', this.onPageHide);
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
  }

  /* --------------------------------------------------------------- account */

  /**
   * FIRST SIGN-IN ON THIS DEVICE (account link): everything already on the
   * device becomes part of the account. The whole local log is enqueued
   * (coalesced — years of keystrokes collapse to one event per set), pushed,
   * and then everything the account already holds is pulled and merged in.
   *
   * Both halves matter: the phone that has been used for a year must not lose
   * its history to an empty account, and an empty new phone must not wipe the
   * account by "winning" a merge. Union does both at once.
   */
  async linkAccount(userId: string): Promise<void> {
    const switching = this.meta.userId !== null && this.meta.userId !== userId;
    this.meta.userId = userId;
    if (switching) {
      // A different account's cursor means nothing here.
      this.meta.cursor = 0;
      this.meta.lastSyncAt = null;
    }
    this.enqueueAll();
    this.persist();
    if (this.isVisible()) this.startPolling();
    await this.sync();
  }

  /**
   * Called by the auth listener on every sign-in, INCLUDING the session that is
   * silently restored on page load. Re-linking there would re-upload the entire
   * log on every reload, so a known account simply resumes with its cursor and
   * outbox intact.
   */
  async onSignedIn(userId: string): Promise<void> {
    if (this.meta.userId === userId) {
      if (this.isVisible()) this.startPolling();
      await this.sync();
      return;
    }
    await this.linkAccount(userId);
  }

  /**
   * Put the ENTIRE local log in the outbox (coalescing `set_logged` down to the
   * last event per set). Used by `linkAccount`, and by the history screen after
   * an additive import — those events arrived through `replaceAll`, which the
   * engine deliberately cannot see.
   */
  enqueueAll(): void {
    const latestSet = new Map<string, string>();
    const ids: string[] = [];
    for (const ev of this.store.getEvents()) {
      this.knownIds.add(ev.id);
      if (ev.type === 'set_logged') {
        const key = coalesceKey(ev.payload);
        if (key) {
          latestSet.set(key, ev.id);
          continue;
        }
      }
      ids.push(ev.id);
    }
    const keep = new Set([...ids, ...latestSet.values()]);
    // Preserve log order — the server's seq then roughly follows real time.
    this.meta.outbox = this.store.getEvents().filter((e) => keep.has(e.id)).map((e) => e.id);
    this.coalesced.clear();
    this.persist();
  }

  /* ---------------------------------------------------------- local writes */

  private onLocalEvent(ev: AppEvent): void {
    this.knownIds.add(ev.id);
    if (!this.canSync()) return;

    if (ev.type === 'set_logged') {
      const key = coalesceKey(ev.payload);
      if (key) {
        this.coalesced.set(key, ev.id);
        this.armCoalesce();
        this.emit();
        return;
      }
    }
    // Anything else is a real state change: flush the buffer so the set's value
    // is uploaded before the event that acts on it, then queue and push.
    this.flushCoalesced();
    this.enqueue(ev.id);
    this.armPush();
  }

  private enqueue(id: string): void {
    if (!this.meta.outbox.includes(id)) this.meta.outbox.push(id);
    this.persist();
    this.emit();
  }

  /** Move the coalesce buffer into the outbox. Idempotent, network-free. */
  flushCoalesced(): void {
    this.clearTimer('coalesce');
    if (this.coalesced.size === 0) return;
    for (const id of this.coalesced.values()) {
      if (!this.meta.outbox.includes(id)) this.meta.outbox.push(id);
    }
    this.coalesced.clear();
    this.persist();
    this.emit();
  }

  /* ------------------------------------------------------------- the cycle */

  private canSync(): boolean {
    return this.enabled && this.meta.userId !== null;
  }

  /**
   * Run (or join) one full cycle. Never throws: a failure becomes a status plus
   * a scheduled retry, because there is nobody to catch it — the app is not
   * waiting for this.
   */
  sync(): Promise<void> {
    if (!this.canSync()) {
      if (this.enabled) this.setStatus('signedOut');
      return Promise.resolve();
    }
    if (this.cycle) {
      this.rerun = true;
      return this.cycle;
    }
    const run = this.runCycle().then(
      () => {
        this.cycle = null;
        if (this.rerun) {
          this.rerun = false;
          void this.sync();
        }
      },
      () => {
        this.cycle = null;
      },
    );
    this.cycle = run;
    return run;
  }

  /** Resolves once no cycle is in flight — the hook every test awaits. */
  async settled(): Promise<void> {
    while (this.cycle) await this.cycle;
  }

  private async runCycle(): Promise<void> {
    const userId = this.meta.userId;
    if (!userId) return;
    this.clearTimer('push');
    this.flushCoalesced();

    if (!this.isOnline()) {
      this.setStatus('offline');
      return;
    }

    this.setStatus('syncing');
    try {
      await this.pushOutbox(userId);
      await this.pullAll(userId);
      // The ghost and the league rows ride at the END of a successful cycle, and
      // their failures are their own (see `publishGhost` / `publishLeague`): the
      // backup must never be held hostage to a vanity snapshot or a scoreboard.
      // The ghost goes first because the league publishes under ITS handle.
      await this.publishGhost(userId);
      await this.publishLeague(userId);
      this.failures = 0;
      this.message = undefined;
      this.meta.lastSyncAt = this.now();
      this.persist();
      this.setStatus('idle');
    } catch (err) {
      this.onFailure(err);
    }
  }

  private onFailure(err: unknown): void {
    if (isAuthError(err)) {
      // Retrying a dead token is pure battery drain — park until the user acts.
      this.failures = 0;
      this.clearBackoff();
      this.message = undefined;
      this.setStatus('reauth');
      return;
    }
    if (!this.isOnline()) {
      // The tunnel, not the server. `online` will wake us; no backoff needed.
      this.setStatus('offline');
      return;
    }
    this.failures += 1;
    this.message = err instanceof Error ? err.message : String(err);
    this.setStatus('error');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clearBackoff();
    const delay = backoffDelay(this.failures, this.timing.maxBackoffMs);
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      void this.sync();
    }, delay);
  }

  /* ----------------------------------------------------------------- push */

  /** Outbox ids resolved against the log, oldest first, `pushChunk` at a time. */
  private nextBatch(): { ids: string[]; events: AppEvent[] } {
    const byId = new Map<string, AppEvent>();
    for (const ev of this.store.getEvents()) byId.set(ev.id, ev);

    const keep: string[] = [];
    const ids: string[] = [];
    const events: AppEvent[] = [];
    let dropped = false;
    for (const id of this.meta.outbox) {
      const ev = byId.get(id);
      if (!ev) {
        // The event is gone from the log — `clear()` truncated it. There is
        // nothing left to upload, and the `data_cleared` marker that replaced
        // it carries the same meaning to every other device.
        dropped = true;
        continue;
      }
      keep.push(id);
      if (events.length < this.timing.pushChunk) {
        ids.push(id);
        events.push(ev);
      }
    }
    if (dropped) {
      this.meta.outbox = keep;
      this.persist();
    }
    return { ids, events };
  }

  private async pushOutbox(userId: string): Promise<void> {
    for (;;) {
      const batch = this.nextBatch();
      if (batch.events.length === 0) return;
      await this.backend.pushEvents(userId, batch.events);
      // Acked: these are durable server-side, drop them and checkpoint. A crash
      // right here at worst re-pushes them, which the id primary key absorbs.
      const acked = new Set(batch.ids);
      this.meta.outbox = this.meta.outbox.filter((id) => !acked.has(id));
      this.persist();
      this.emit();
    }
  }

  /* ----------------------------------------------------------------- pull */

  private async pullAll(userId: string): Promise<void> {
    const incoming: AppEvent[] = [];
    let cursor = this.meta.cursor;
    // The loop is bounded so a backend that never advances its cursor (a bug on
    // either side) degrades to "one wasted page", not a hung tab.
    for (let page = 0; page < 10_000; page += 1) {
      const res = await this.backend.pullEvents(userId, cursor, this.timing.pullLimit);
      for (const ev of res.events) {
        // Our own events come back on the first pull after a push; the local log
        // already has them, and re-adding would be a no-op rebuild.
        if (!this.knownIds.has(ev.id)) incoming.push(ev);
      }
      const next = Math.max(cursor, res.lastSeq);
      const exhausted = res.events.length < this.timing.pullLimit || next <= cursor;
      cursor = next;
      if (exhausted) break;
    }
    if (cursor !== this.meta.cursor) {
      this.meta.cursor = cursor;
      this.persist();
    }
    if (incoming.length === 0) return;
    this.applyRemote(incoming);
  }

  /**
   * Fold pulled events into the local log and rebuild. `mergeIntoStore` keeps
   * the current tab and this install's `createdAt`; everything else is a pure
   * replay of the union, which is why no conflict handling appears anywhere.
   */
  private applyRemote(incoming: readonly AppEvent[]): void {
    const res = mergeIntoStore(this.store, incoming, this.now());
    for (const ev of incoming) this.knownIds.add(ev.id);
    if (res.added > 0) this.remoteCb();
  }

  /* --------------------------------------------------------- ghost duels */

  /**
   * Publish MY ghost — but only when it actually changed.
   *
   * The snapshot's fingerprint is compared with the one in the notebook, so an
   * ordinary cycle on a character that has not trained, re-equipped or renamed
   * itself makes NO request at all. That is the whole reason the hash is
   * persisted: the ghosts table would otherwise take a write every sync tick,
   * for ever, for nothing.
   *
   * FAILURE IS FREE. A ghost is presence data, not history — the log is already
   * safely on the server by the time this runs — so a rejected or failed publish
   * is swallowed and simply leaves the stored hash alone, which makes the next
   * cycle try again. Nothing about the user's data depends on it.
   */
  /**
   * The name this account publishes under: the chosen one, or the one derived
   * from the account. `null` when this build has no ghost publisher at all — the
   * handle is ONE identity across the whole social surface, so a build without
   * it publishes nothing anywhere rather than inventing a second name.
   */
  private handleFor(userId: string): string | null {
    if (this.meta.ghostHandle) return this.meta.ghostHandle;
    const derived = this.ghost?.defaultHandle(userId);
    return derived ? derived : null;
  }

  private async publishGhost(userId: string): Promise<void> {
    const ghost = this.ghost;
    if (!ghost) return;
    const handle = this.meta.ghostHandle ?? ghost.defaultHandle(userId);
    const snap = ghost.snapshot(handle);
    if (!snap) return;
    if (this.meta.ghostHandle === handle && this.meta.ghostHash === snap.hash) return;
    try {
      await this.backend.publishGhost(userId, handle, snap.payload);
      this.meta.ghostHandle = handle;
      this.meta.ghostHash = snap.hash;
      this.persist();
    } catch {
      /* taken handle, offline, RLS — try again next cycle; nothing is lost */
    }
  }

  /** The handle this device publishes under, or `''` when none was chosen yet. */
  getGhostHandle(): string {
    return this.meta.ghostHandle ?? '';
  }

  /**
   * Claim a handle. Returns false when the backend says somebody else owns it,
   * in which case NOTHING is stored — the old name keeps working.
   *
   * This is the one ghost call that is not fire-and-forget: the user is standing
   * in front of the settings card waiting for an answer, so the result (and the
   * Hebrew error behind it) has to come back to them.
   */
  async setGhostHandle(handle: string): Promise<boolean> {
    const ghost = this.ghost;
    const userId = this.meta.userId;
    if (!ghost || !userId || !handle) return false;
    const snap = ghost.snapshot(handle);
    if (!snap) return false;
    try {
      await this.backend.publishGhost(userId, handle, snap.payload);
    } catch {
      return false;
    }
    this.meta.ghostHandle = handle;
    this.meta.ghostHash = snap.hash;
    this.persist();
    return true;
  }

  /* --------------------------------------------------------------- הליגה */

  /**
   * Publish the closed weeks the server does not have yet.
   *
   * THE DIFF IS AGAINST THE LEDGER, NOT AGAINST AN EVENT. Every cycle asks the
   * publisher for the weeks that are closed AND inside the publish window, and
   * subtracts the ones this notebook says it already uploaded. Three properties
   * fall out of that and each is a test:
   *
   *   * PUBLISH ON CLOSE — a week that closed since the last cycle is in the
   *     list and not in the set, so it goes up on the very next cycle;
   *   * NOTHING TO SAY IS FREE — a cycle where the two agree makes NO request,
   *     the same discipline `publishGhost`'s fingerprint enforces;
   *   * SELF-HEALING — a week closed while signed out (or on a device whose
   *     notebook was wiped, or by another device that pushed the event before
   *     this one was linked) is simply "in the ledger, not in the set", so it is
   *     noticed and uploaded without anything having to remember it happened.
   *
   * A RENAME REPUBLISHES, exactly like the ghost's: the rows carry the name, so
   * when the handle in force differs from the one the set belongs to the whole
   * window is treated as unpublished and rewritten under the new name. Rows
   * older than the window keep the old name — they are outside the league's
   * living memory, and `opponentMonth` breaks the resulting (very rare) tie by
   * `updated_at`.
   *
   * FAILURE IS FREE, like the ghost's: the log is already safe on the server by
   * the time this runs, the notebook is left alone, and the next cycle retries.
   */
  private async publishLeague(userId: string): Promise<void> {
    const league = this.league;
    if (!league) return;
    const handle = this.handleFor(userId);
    if (!handle) return;

    const rows = league.rows();
    const renamed = this.meta.leagueHandle !== handle;
    const published = renamed ? new Set<string>() : new Set(this.meta.leagueWeeks);
    const due = rows.filter((row) => !published.has(row.weekKey));

    if (due.length === 0) {
      // Nothing to upload — but the notebook may still be carrying week keys
      // that have fallen out of the window. Pruning here is what keeps it small
      // for ever (a window is 8–10 weeks) without a second pass.
      const inWindow = this.meta.leagueWeeks.filter((week) => rows.some((row) => row.weekKey === week));
      if (inWindow.length !== this.meta.leagueWeeks.length) {
        this.meta.leagueWeeks = inWindow;
        this.persist();
      }
      return;
    }

    try {
      await this.backend.publishLeagueWeeks(userId, handle, due);
      this.meta.leagueHandle = handle;
      // Everything in the window is now published: what was already there, plus
      // what just went up. Stated as the window itself, so the set prunes itself.
      this.meta.leagueWeeks = rows.map((row) => row.weekKey);
      this.persist();
    } catch {
      /* offline, RLS, a rename mid-flight — try again next cycle; nothing lost */
    }
  }

  /** The week keys this device believes are published (probe, and for tests). */
  getPublishedLeagueWeeks(): readonly string[] {
    return [...this.meta.leagueWeeks];
  }

  /**
   * READ an opponent's month — from the server when possible, from the cache
   * when not.
   *
   * STALENESS, stated plainly, because the UI has to say it in Hebrew:
   *   * a successful fetch returns `stale: false` and the instant it was read;
   *   * a FAILED fetch (offline, RLS, a server on fire) returns the cached rows
   *     with `stale: true` and the instant THEY were read — never an error and
   *     never a zero, because "your partner scored 0 this month" is a lie that a
   *     dropped connection must not be allowed to tell;
   *   * signed out, or a build with sync switched off, returns an empty month
   *     with `stale: true` and `fetchedAt: null` — the feature is dark, exactly
   *     like every other cloud surface;
   *   * asking for a DIFFERENT (handle, month) than the cached one and failing
   *     returns an empty month rather than somebody else's numbers.
   *
   * The rows go through `normalizeLeagueRow` (inside `opponentMonth`) on the way
   * in and again on the way out of storage: what is cached is only ever what was
   * already believable.
   */
  async loadLeagueMonth(handle: string, monthKey: string): Promise<LeagueMonthView> {
    const cached = this.cachedLeagueMonth(handle, monthKey);
    if (!this.canSync() || !this.isOnline()) return cached;
    try {
      const raw = await this.backend.fetchLeagueMonth(handle, monthKey);
      const month = opponentMonth(raw, monthKey);
      this.meta.leagueMonth = { handle, monthKey, fetchedAt: this.now(), rows: month.rows };
      this.persist();
      return { handle, monthKey, month, fetchedAt: this.meta.leagueMonth.fetchedAt, stale: false };
    } catch {
      return cached;
    }
  }

  /** The cached month WITHOUT a request — what a first paint renders. */
  getLeagueMonth(handle: string, monthKey: string): LeagueMonthView {
    return this.cachedLeagueMonth(handle, monthKey);
  }

  private cachedLeagueMonth(handle: string, monthKey: string): LeagueMonthView {
    const cache = this.meta.leagueMonth;
    if (!cache || cache.handle !== handle || cache.monthKey !== monthKey) {
      return { handle, monthKey, month: emptyOpponentMonth(monthKey), fetchedAt: null, stale: true };
    }
    return {
      handle,
      monthKey,
      month: opponentMonth(cache.rows, monthKey),
      fetchedAt: cache.fetchedAt,
      stale: true,
    };
  }

  /** Opponents fought recently, newest first. */
  getRecentOpponents(): readonly string[] {
    return [...this.meta.ghostRecent];
  }

  /** Remember an opponent (moves an existing one back to the front). */
  rememberOpponent(handle: string): void {
    if (!handle) return;
    const next = [handle, ...this.meta.ghostRecent.filter((h) => h !== handle)];
    this.meta.ghostRecent = next.slice(0, GHOST_RECENT_MAX);
    this.persist();
  }

  /* -------------------------------------------------------------- timers */

  private armCoalesce(): void {
    this.clearTimer('coalesce');
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null;
      this.flushCoalesced();
      this.armPush();
    }, this.timing.coalesceMs);
  }

  private armPush(): void {
    this.clearTimer('push');
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.sync();
    }, this.timing.pushDebounceMs);
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      if (this.canSync() && this.isVisible()) void this.sync();
    }, this.timing.pollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private clearBackoff(): void {
    if (this.backoffTimer === null) return;
    clearTimeout(this.backoffTimer);
    this.backoffTimer = null;
  }

  private clearTimer(which: 'coalesce' | 'push'): void {
    if (which === 'coalesce' && this.coalesceTimer !== null) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    if (which === 'push' && this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer('coalesce');
    this.clearTimer('push');
    this.clearBackoff();
    this.stopPolling();
  }

  /* -------------------------------------------------------------- status */

  private persist(): void {
    writeSyncMeta(this.storage, this.meta);
  }

  private setStatus(kind: SyncStatusKind): void {
    this.kind = kind;
    this.emit();
  }

  private emit(): void {
    const status = this.getStatus();
    const key = `${status.kind}|${status.pending}|${status.lastSyncAt ?? ''}|${status.message ?? ''}`;
    if (key === this.lastEmitted) return;
    this.lastEmitted = key;
    this.statusCb(status);
  }

  /* --------------------------------------------------------------- probes */

  getStatus(): SyncStatus {
    const base: SyncStatus = {
      kind: this.kind,
      pending: this.pendingCount(),
      lastSyncAt: this.meta.lastSyncAt,
    };
    return this.kind === 'error' && this.message !== undefined
      ? { ...base, message: this.message }
      : base;
  }

  /** Events this device still owes the server. */
  pendingCount(): number {
    return this.meta.outbox.length + this.coalesced.size;
  }

  /** A copy of the persisted bookkeeping — for the UI and for tests. */
  getMeta(): SyncMeta {
    return { ...this.meta, outbox: [...this.meta.outbox], leagueWeeks: [...this.meta.leagueWeeks] };
  }
}
