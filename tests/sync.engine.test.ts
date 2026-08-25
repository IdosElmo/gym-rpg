/**
 * sync.engine.test.ts — the sync loop, with a `Map` for a server.
 *
 * NOTHING HERE TOUCHES A NETWORK. `MemoryBackend` implements the same
 * `SyncBackend` interface `supabaseBackend.ts` does — including the part that
 * actually matters, a per-user monotonic `seq` and id-dedupe — so every property
 * the engine relies on is exercised against a server whose behaviour is a dozen
 * lines of readable code instead of a Postgres cluster.
 *
 * The engine's clock and timers are both fake (`vi.useFakeTimers` + an injected
 * `now`), so "wait 1.5 s for the keystrokes to settle" costs zero milliseconds
 * and never flakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import type { LeagueWeekUpload } from '../src/core/leagueSync.ts';
import {
  GhostHandleTakenError,
  SyncAuthError,
  type GhostRow,
  type LeagueRawRow,
  type PullPage,
  type SyncBackend,
} from '../src/sync/backend.ts';
import { SYNC_CONFIG, syncConfigured } from '../src/sync/config.ts';
import { SyncEngine, backoffDelay, type SyncStatus } from '../src/sync/engine.ts';
import { SYNC_META_KEY, readSyncMeta } from '../src/sync/meta.ts';

/* -------------------------------------------------------------- fixtures */

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const USER = 'user-1';
const START = Date.parse('2025-05-04T09:00:00.000Z');

interface Row {
  seq: number;
  ev: AppEvent;
}

/**
 * The whole server: rows keyed `(userId, id)` plus one counter per user.
 * `push` is an upsert-on-id (a re-push is a no-op, exactly like the real
 * `on conflict do nothing`), and `pull` is `seq > cursor order by seq limit n`.
 */
class MemoryBackend implements SyncBackend {
  readonly rows = new Map<string, Row[]>();
  private readonly seqs = new Map<string, number>();
  pushCalls = 0;
  pullCalls = 0;
  /** Set to make the next N calls (push AND pull) reject. */
  failWith: Error | null = null;
  /** Batch sizes seen, so chunking can be asserted. */
  readonly pushSizes: number[] = [];
  readonly pullArgs: Array<{ afterSeq: number; limit: number }> = [];

  private listOf(userId: string): Row[] {
    const list = this.rows.get(userId) ?? [];
    this.rows.set(userId, list);
    return list;
  }

  seed(userId: string, events: readonly AppEvent[]): void {
    this.insert(userId, events);
  }

  private insert(userId: string, events: readonly AppEvent[]): void {
    const list = this.listOf(userId);
    for (const ev of events) {
      if (list.some((r) => r.ev.id === ev.id)) continue; // primary key (user_id, id)
      const seq = (this.seqs.get(userId) ?? 0) + 1;
      this.seqs.set(userId, seq);
      list.push({ seq, ev });
    }
  }

  async pushEvents(userId: string, events: readonly AppEvent[]): Promise<void> {
    this.pushCalls += 1;
    this.pushSizes.push(events.length);
    if (this.failWith) throw this.failWith;
    this.insert(userId, events);
  }

  async pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage> {
    this.pullCalls += 1;
    this.pullArgs.push({ afterSeq, limit });
    if (this.failWith) throw this.failWith;
    const page = this.listOf(userId)
      .filter((r) => r.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    const last = page[page.length - 1];
    return { events: page.map((r) => r.ev), lastSeq: last ? last.seq : afterSeq };
  }

  eventsOf(userId: string): AppEvent[] {
    return this.listOf(userId).map((r) => r.ev);
  }

  /* --------------------------------------------------------- the ghosts */

  /**
   * The `ghosts` table: one row per user (its primary key) plus the UNIQUE
   * index on the handle — the two constraints `supabase/schema.sql` declares
   * and the only ones any caller relies on.
   */
  readonly ghosts = new Map<string, GhostRow>();
  ghostPublishes = 0;

  async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
    this.ghostPublishes += 1;
    for (const [owner, row] of this.ghosts) {
      if (owner !== userId && row.handle === handle) throw new GhostHandleTakenError();
    }
    this.ghosts.set(userId, { handle, payload, updatedAt: START });
  }

  async fetchGhost(handle: string): Promise<GhostRow | null> {
    for (const row of this.ghosts.values()) if (row.handle === handle) return row;
    return null;
  }

  /* -------------------------------------------------------- league weeks */

  /**
   * The `league_weeks` table: one row per `(user_id, week_key)` — its primary
   * key, so a re-publish overwrites — readable by anybody who knows the handle,
   * the same asymmetry the ghosts have.
   */
  readonly leagueRows = new Map<string, LeagueRawRow>();
  leaguePublishes = 0;

  async publishLeagueWeeks(userId: string, handle: string, rows: readonly LeagueWeekUpload[]): Promise<void> {
    this.leaguePublishes += 1;
    for (const row of rows) {
      // Stored under the DATABASE's column names, so every read is exercised
      // against exactly the shape PostgREST hands back.
      this.leagueRows.set(`${userId}|${row.weekKey}`, {
        handle,
        week_key: row.weekKey,
        month_key: row.monthKey,
        score: row.score,
        c: row.c,
        q: row.q,
        l: row.l,
        p: row.p,
        coin: row.coin,
        volume: row.volume,
        days: row.days,
        prs: row.prs,
        updated_at: new Date(Date.now()).toISOString(),
      });
    }
  }

  async fetchLeagueMonth(handle: string, monthKey: string): Promise<LeagueRawRow[]> {
    return [...this.leagueRows.values()].filter((r) => r['handle'] === handle && r['month_key'] === monthKey);
  }
}

interface Rig {
  store: LocalStore;
  storage: StorageLike;
  engine: SyncEngine;
  backend: MemoryBackend;
  statuses: SyncStatus[];
  applied: number;
  online: { value: boolean };
  win: FakeTarget;
}

/** A stand-in for `window` that lets tests fire `online` / `pagehide`. */
class FakeTarget {
  private readonly map = new Map<string, Set<() => void>>();
  addEventListener(type: string, cb: () => void): void {
    const set = this.map.get(type) ?? new Set<() => void>();
    set.add(cb);
    this.map.set(type, set);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.map.get(type)?.delete(cb);
  }
  fire(type: string): void {
    for (const cb of [...(this.map.get(type) ?? [])]) cb();
  }
}

function makeRig(
  backend: MemoryBackend = new MemoryBackend(),
  seed: Record<string, string> = {},
  timing: Partial<ConstructorParameters<typeof SyncEngine>[0]['timing']> = {},
): Rig {
  const storage = fakeStorage(seed);
  const store = new LocalStore(storage);
  const statuses: SyncStatus[] = [];
  const online = { value: true };
  const win = new FakeTarget();
  const rig = {
    store,
    storage,
    backend,
    statuses,
    applied: 0,
    online,
    win,
  } as Rig;
  rig.engine = new SyncEngine({
    store,
    backend,
    storage,
    now: () => Date.now(),
    onStatus: (s) => void statuses.push(s),
    onRemoteApplied: () => {
      rig.applied += 1;
    },
    win,
    doc: null,
    isOnline: () => online.value,
    isVisible: () => true,
    timing: { ...timing },
  });
  return rig;
}

/** Sign in and let the initial link cycle finish. */
async function signIn(rig: Rig, userId = USER): Promise<void> {
  rig.engine.start();
  await rig.engine.linkAccount(userId);
  await rig.engine.settled();
}

/** Advance the fake clock AND let every promise it unblocked run to the end. */
async function tick(engine: SyncEngine, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await engine.settled();
}

function logSet(store: LocalStore, exId: string, i: number, w: string, r: string): AppEvent {
  return store.append('set_logged', { date: '2025-05-04', day: 'A', exId, setIndex: i, w, r });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ----------------------------------------------------------- outbox/push */

describe('outbox', () => {
  it('pushes local events and drops them once acked', async () => {
    const rig = makeRig();
    await signIn(rig);
    logSet(rig.store, 'a1', 0, '40', '10');
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });

    expect(rig.engine.pendingCount()).toBeGreaterThan(0);
    await tick(rig.engine, 600);

    expect(rig.engine.pendingCount()).toBe(0);
    expect(rig.backend.eventsOf(USER).map((e) => e.type)).toContain('set_completed');
    expect(rig.engine.getStatus().kind).toBe('idle');
    rig.engine.dispose();
  });

  it('keeps the outbox on disk and finishes it after a restart', async () => {
    const backend = new MemoryBackend();
    const rig = makeRig(backend);
    await signIn(rig);
    backend.failWith = new Error('boom');

    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    await tick(rig.engine, 600);
    expect(rig.engine.pendingCount()).toBe(1);
    expect(rig.engine.getStatus().kind).toBe('error');

    // The id, not the payload, is what was persisted.
    const persisted = readSyncMeta(rig.storage);
    expect(persisted.outbox).toHaveLength(1);
    expect(persisted.userId).toBe(USER);
    rig.engine.dispose();

    // A brand new engine over the SAME storage + store: the tab was reloaded.
    backend.failWith = null;
    const revived = new SyncEngine({
      store: rig.store,
      backend,
      storage: rig.storage,
      win: null,
      doc: null,
      isVisible: () => false,
    });
    revived.start();
    await revived.settled();
    expect(revived.pendingCount()).toBe(0);
    expect(backend.eventsOf(USER).map((e) => e.type)).toContain('workout_finished');
    revived.dispose();
  });

  it('uploads events in chunks', async () => {
    const rig = makeRig(new MemoryBackend(), {}, { pushChunk: 2 });
    await signIn(rig);
    rig.backend.pushSizes.length = 0;
    for (let i = 0; i < 5; i += 1) {
      rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: i, w: '40', r: '10' });
    }
    await tick(rig.engine, 600);
    expect(rig.backend.pushSizes).toEqual([2, 2, 1]);
    rig.engine.dispose();
  });
});

/* ------------------------------------------------------------ coalescing */

describe('set_logged coalescing', () => {
  it('uploads ONE event per set no matter how many keystrokes', async () => {
    const rig = makeRig();
    await signIn(rig);
    // "4", "42", "42.", "42.5" — four local events, one meaningful value.
    for (const w of ['4', '42', '42.', '42.5']) logSet(rig.store, 'a1', 0, w, '10');
    expect(rig.store.getEvents().filter((e) => e.type === 'set_logged')).toHaveLength(4);
    expect(rig.engine.pendingCount()).toBe(1);

    // Still typing after 1s: nothing has gone out yet.
    await tick(rig.engine, 1_000);
    expect(rig.backend.eventsOf(USER).filter((e) => e.type === 'set_logged')).toHaveLength(0);

    await tick(rig.engine, 1_200); // idle past the coalesce window, then the push debounce
    const uploaded = rig.backend.eventsOf(USER).filter((e) => e.type === 'set_logged');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.payload['w']).toBe('42.5'); // last write wins
    rig.engine.dispose();
  });

  it('coalesces per set, not globally', async () => {
    const rig = makeRig();
    await signIn(rig);
    logSet(rig.store, 'a1', 0, '40', '10');
    logSet(rig.store, 'a1', 1, '45', '10');
    logSet(rig.store, 'a1', 0, '42', '10');
    expect(rig.engine.pendingCount()).toBe(2);
    await tick(rig.engine, 2_500);
    const uploaded = rig.backend.eventsOf(USER).filter((e) => e.type === 'set_logged');
    expect(uploaded.map((e) => e.payload['w']).sort()).toEqual(['42', '45']);
    rig.engine.dispose();
  });

  it('flushes the buffer before an event that depends on it', async () => {
    const rig = makeRig();
    await signIn(rig);
    logSet(rig.store, 'a1', 0, '40', '10');
    // The checkmark must never reach the server before the value it confirms.
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    await tick(rig.engine, 600);
    const types = rig.backend.eventsOf(USER).map((e) => e.type);
    expect(types.indexOf('set_logged')).toBeLessThan(types.indexOf('set_completed'));
    rig.engine.dispose();
  });
});

/* ------------------------------------------------------------ pull/merge */

describe('pull and merge', () => {
  /** Events "another device" already pushed to the account. */
  function remoteSets(): AppEvent[] {
    const other = new LocalStore(fakeStorage());
    other.append('set_completed', { date: '2025-05-01', day: 'B', exId: 'b1', setIndex: 0, w: '60', r: '8' });
    other.append('set_completed', { date: '2025-05-01', day: 'B', exId: 'b1', setIndex: 1, w: '62', r: '8' });
    return [...other.getEvents()];
  }

  it('merges remote events, rebuilds and repaints — keeping the current tab', async () => {
    const rig = makeRig();
    rig.store.update((d) => {
      d.ui.view = 'CH';
    });
    rig.backend.seed(USER, remoteSets());
    await signIn(rig);

    expect(rig.applied).toBe(1);
    expect(rig.store.getEvents()).toHaveLength(2);
    expect(rig.store.getState().sessions['2025-05-01']?.ex['b1']).toHaveLength(2);
    // The merge rebuilt the state — but not the part of it that is nobody
    // else's business.
    expect(rig.store.getState().ui.view).toBe('CH');
    rig.engine.dispose();
  });

  it('does not repaint when the pull brings nothing new', async () => {
    const rig = makeRig();
    rig.backend.seed(USER, remoteSets());
    await signIn(rig);
    expect(rig.applied).toBe(1);

    await tick(rig.engine, 60_000); // the visible-tab poll
    expect(rig.backend.pullCalls).toBeGreaterThan(1);
    expect(rig.applied).toBe(1); // …and still exactly one repaint
    rig.engine.dispose();
  });

  it('ignores events it already has (its own, echoed back)', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    await tick(rig.engine, 600);
    const before = rig.store.getEvents().length;

    await rig.engine.sync(); // pulls its own pushed rows back
    await rig.engine.settled();
    expect(rig.store.getEvents()).toHaveLength(before);
    expect(rig.applied).toBe(0);
    rig.engine.dispose();
  });

  it('pages through a long history and advances the cursor once', async () => {
    const backend = new MemoryBackend();
    const other = new LocalStore(fakeStorage());
    for (let i = 0; i < 5; i += 1) {
      other.append('set_completed', { date: '2025-05-01', day: 'B', exId: 'b1', setIndex: i, w: '60', r: '8' });
    }
    backend.seed(USER, [...other.getEvents()]);

    const rig = makeRig(backend, {}, { pullLimit: 2 });
    await signIn(rig);

    // 2 + 2 + 1 → the short page ends the loop; no extra request.
    expect(rig.backend.pullArgs.map((a) => a.afterSeq)).toEqual([0, 2, 4]);
    expect(rig.engine.getMeta().cursor).toBe(5);
    expect(rig.store.getEvents()).toHaveLength(5);
    expect(rig.applied).toBe(1); // one merge for the whole history, not one per page
    rig.engine.dispose();
  });

  it('remembers the cursor across a restart', async () => {
    const backend = new MemoryBackend();
    backend.seed(USER, remoteSets());
    const rig = makeRig(backend);
    await signIn(rig);
    const cursor = rig.engine.getMeta().cursor;
    expect(cursor).toBe(2);
    rig.engine.dispose();

    const revived = new SyncEngine({ store: rig.store, backend, storage: rig.storage, win: null, doc: null });
    revived.start();
    await revived.settled();
    expect(backend.pullArgs[backend.pullArgs.length - 1]?.afterSeq).toBe(cursor);
    revived.dispose();
  });
});

/* ---------------------------------------------------------- convergence */

describe('two devices on one account', () => {
  it('converge on the union of their logs', async () => {
    const backend = new MemoryBackend();
    const a = makeRig(backend);
    const b = makeRig(backend);
    await signIn(a);
    await signIn(b);

    a.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    b.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a2', setIndex: 0, w: '30', r: '12' });
    // Interleaved: A pushes, B pushes, then both pull.
    await tick(a.engine, 600);
    await tick(b.engine, 600);
    await a.engine.sync();
    await a.engine.settled();
    await b.engine.sync();
    await b.engine.settled();

    const idsA = a.store.getEvents().map((e) => e.id).sort();
    const idsB = b.store.getEvents().map((e) => e.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toHaveLength(2);
    // …and the folded state agrees, which is the property that actually matters
    expect(JSON.stringify(a.store.getState().sessions)).toBe(JSON.stringify(b.store.getState().sessions));
    a.engine.dispose();
    b.engine.dispose();
  });
});

/* ------------------------------------------------------- failure handling */

describe('failures', () => {
  it('backs off exponentially and recovers', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.backend.failWith = new Error('503');
    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });

    // Sync explicitly so the first failure happens at a known instant (it also
    // cancels the pending push debounce), then measure the retry gaps from it.
    await rig.engine.sync();
    await rig.engine.settled();
    const after1 = rig.backend.pushCalls;
    expect(rig.engine.getStatus().kind).toBe('error');
    expect(rig.engine.getStatus().message).toBe('503');

    // 1s, then 2s, then 4s — nothing in between.
    await tick(rig.engine, 999);
    expect(rig.backend.pushCalls).toBe(after1);
    await tick(rig.engine, 1);
    expect(rig.backend.pushCalls).toBe(after1 + 1);
    await tick(rig.engine, 1_999);
    expect(rig.backend.pushCalls).toBe(after1 + 1);
    await tick(rig.engine, 1);
    expect(rig.backend.pushCalls).toBe(after1 + 2);

    rig.backend.failWith = null;
    await tick(rig.engine, 4_000);
    expect(rig.engine.getStatus().kind).toBe('idle');
    expect(rig.engine.pendingCount()).toBe(0);
    rig.engine.dispose();
  });

  it('caps the backoff at five minutes', () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(1)).toBe(1_000);
    expect(backoffDelay(2)).toBe(2_000);
    expect(backoffDelay(9)).toBe(256_000);
    expect(backoffDelay(10)).toBe(300_000);
    expect(backoffDelay(99)).toBe(300_000);
  });

  it('parks on `reauth` instead of retrying a dead session', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.backend.failWith = new SyncAuthError('JWT expired');
    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    await tick(rig.engine, 600);

    expect(rig.engine.getStatus().kind).toBe('reauth');
    const calls = rig.backend.pushCalls;
    await tick(rig.engine, 10 * 60_000); // ten minutes of nothing
    expect(rig.backend.pushCalls).toBe(calls + 10); // only the visible-tab poll
    expect(rig.engine.pendingCount()).toBe(1); // …and the work is still queued
    rig.engine.dispose();
  });

  it('waits out an offline stretch and resumes on `online`', async () => {
    const rig = makeRig();
    await signIn(rig);

    rig.online.value = false;
    rig.win.fire('offline');
    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    const calls = rig.backend.pushCalls;
    await tick(rig.engine, 5_000);
    expect(rig.backend.pushCalls).toBe(calls); // not one wasted request
    expect(rig.engine.getStatus().kind).toBe('offline');
    expect(rig.engine.pendingCount()).toBe(1);

    rig.online.value = true;
    rig.win.fire('online');
    await rig.engine.settled();
    expect(rig.engine.pendingCount()).toBe(0);
    expect(rig.engine.getStatus().kind).toBe('idle');
    rig.engine.dispose();
  });

  it('flushes what the user typed when the page goes away', async () => {
    const rig = makeRig();
    await signIn(rig);
    logSet(rig.store, 'a1', 0, '40', '10');
    expect(rig.engine.getMeta().outbox).toHaveLength(0); // still coalescing

    rig.win.fire('pagehide');
    expect(rig.engine.getMeta().outbox).toHaveLength(1);
    expect(readSyncMeta(rig.storage).outbox).toHaveLength(1);
    rig.engine.dispose();
  });
});

/* --------------------------------------------------------- account flows */

describe('account lifecycle', () => {
  it('uploads the whole local log on the first sign-in, then pulls the account', async () => {
    const backend = new MemoryBackend();
    const other = new LocalStore(fakeStorage());
    other.append('set_completed', { date: '2025-05-01', day: 'B', exId: 'b1', setIndex: 0, w: '60', r: '8' });
    backend.seed(USER, [...other.getEvents()]);

    const rig = makeRig(backend);
    // A year of local training that has never seen a server…
    for (const w of ['40', '41', '42']) logSet(rig.store, 'a1', 0, w, '10');
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '42', r: '10' });
    const localCount = rig.store.getEvents().length;
    expect(localCount).toBe(4);

    await signIn(rig);

    // …uploaded, but coalesced: 3 keystrokes became 1 row.
    const uploaded = backend.eventsOf(USER);
    expect(uploaded.filter((e) => e.type === 'set_logged')).toHaveLength(1);
    expect(uploaded.filter((e) => e.type === 'set_completed')).toHaveLength(2);
    // …and the account's own history came down.
    expect(rig.store.getState().sessions['2025-05-01']).toBeDefined();
    expect(rig.applied).toBe(1);
    rig.engine.dispose();
  });

  it('resumes a known account without re-uploading everything', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    await tick(rig.engine, 600);
    const pushes = rig.backend.pushCalls;

    await rig.engine.onSignedIn(USER); // the session restored on a reload
    await rig.engine.settled();
    expect(rig.backend.pushCalls).toBe(pushes); // nothing to say
    expect(rig.engine.getMeta().cursor).toBeGreaterThan(0); // cursor kept
    rig.engine.dispose();
  });

  it('stop() forgets the cloud and keeps every workout', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    await tick(rig.engine, 600);
    const events = rig.store.getEvents().length;

    rig.engine.stop();

    expect(rig.storage.getItem(SYNC_META_KEY)).toBeNull();
    expect(rig.engine.getMeta().userId).toBeNull();
    expect(rig.engine.getMeta().cursor).toBe(0);
    expect(rig.engine.getStatus().kind).toBe('signedOut');
    expect(rig.store.getEvents()).toHaveLength(events);
    expect(rig.store.getEvents().map((e) => e.type)).toContain('set_completed');

    // Signed out, local writes stop being queued at all.
    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    await tick(rig.engine, 2_000);
    expect(rig.engine.pendingCount()).toBe(0);
    rig.engine.dispose();
  });

  it('sends the wipe rather than the events a wipe destroyed', async () => {
    const rig = makeRig();
    await signIn(rig);
    rig.backend.failWith = new Error('offline-ish');
    rig.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    await tick(rig.engine, 600);
    expect(rig.engine.pendingCount()).toBe(1);

    rig.store.clear(); // account-wide wipe; the log is now just the marker
    rig.backend.failWith = null;
    await tick(rig.engine, 600);

    expect(rig.engine.pendingCount()).toBe(0);
    const types = rig.backend.eventsOf(USER).map((e) => e.type);
    expect(types).toContain('data_cleared');
    // The unsent set no longer exists locally, so there is nothing to upload —
    // and the wipe that replaced it says the same thing to every other device.
    expect(types).not.toContain('set_completed');
    rig.engine.dispose();
  });
});

/* --------------------------------------------------------------- status */

describe('status', () => {
  it('walks signedOut → syncing → idle and reports what is pending', async () => {
    const rig = makeRig();
    rig.engine.start();
    expect(rig.engine.getStatus().kind).toBe('signedOut');

    await rig.engine.linkAccount(USER);
    await rig.engine.settled();
    const kinds = rig.statuses.map((s) => s.kind);
    expect(kinds).toContain('syncing');
    expect(kinds[kinds.length - 1]).toBe('idle');
    expect(rig.engine.getStatus().lastSyncAt).toBe(START);

    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    expect(rig.engine.getStatus().pending).toBe(1);
    await tick(rig.engine, 600);
    const done = rig.engine.getStatus();
    expect(done.kind).toBe('idle');
    expect(done.pending).toBe(0);
    expect(done.lastSyncAt).toBeGreaterThan(START); // the injected clock moved on
    expect(done.message).toBeUndefined();
    rig.engine.dispose();
  });

  it('reports `disabled` and touches nothing when switched off', async () => {
    const rig = makeRig();
    const off = new SyncEngine({
      store: rig.store,
      backend: rig.backend,
      storage: rig.storage,
      enabled: false,
      win: null,
      doc: null,
    });
    off.start();
    expect(off.getStatus().kind).toBe('disabled');
    rig.store.append('workout_finished', { date: '2025-05-04', day: 'A' });
    await off.sync();
    expect(rig.backend.pushCalls).toBe(0);
    expect(off.pendingCount()).toBe(0);
    off.dispose();
    rig.engine.dispose();
  });
});

/* ------------------------------------------------------- the master switch */

describe('syncConfigured', () => {
  const real = { url: 'https://demo.supabase.co', anonKey: 'anon-key' };

  it('is ON with the real project config that ships in the repo, off with missing fields', () => {
    // The repo now ships a live Supabase project (see src/sync/config.ts) —
    // the shipped config must enable sync when served over http(s).
    expect(syncConfigured(SYNC_CONFIG, 'https:')).toBe(true);
    expect(syncConfigured({ url: real.url, anonKey: '' }, 'https:')).toBe(false);
    expect(syncConfigured({ url: '', anonKey: real.anonKey }, 'https:')).toBe(false);
  });

  it('is off on file:// even when a project IS configured', () => {
    // The single-file build opened from disk has an opaque origin: OAuth
    // redirects cannot come back to it. The feature stays completely dark
    // rather than failing visibly halfway through a sign-in.
    expect(syncConfigured(real, 'file:')).toBe(false);
    expect(syncConfigured(real, 'https:')).toBe(true);
    expect(syncConfigured(real, 'http:')).toBe(true);
  });

  it('rejects a URL that is not http(s)', () => {
    expect(syncConfigured({ ...real, url: 'demo.supabase.co' }, 'https:')).toBe(false);
    expect(syncConfigured({ ...real, url: 'ftp://demo.supabase.co' }, 'https:')).toBe(false);
  });
});
