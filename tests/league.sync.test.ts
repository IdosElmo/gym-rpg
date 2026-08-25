/**
 * league.sync.test.ts — הליגה over the wire.
 *
 * Stage 1 made a week's grade a VALUE. This suite is about the two things that
 * value has to survive to become a leaderboard: leaving this device, and
 * arriving from somebody else's.
 *
 * NOTHING HERE TOUCHES A NETWORK. `MemoryBackend` is the `league_weeks` table as
 * `supabase/schema.sql` describes it — one row per `(user_id, week_key)`, so a
 * re-publish overwrites, and readable by anybody who knows the handle — and it
 * stores rows under the DATABASE's column names, so the trust boundary is
 * exercised against exactly the shape PostgREST hands back.
 *
 * Six properties, one block each:
 *
 *   1. THE BOUNDARY. A fetched row is hostile input. A bad week key, a month
 *      that is not the month of the week's Saturday, a component outside 0…1, a
 *      score outside 0…100 and — the one stage 1 built on purpose — a score that
 *      is not what its own components add up to, are all REFUSED.
 *   2. THE WINDOW. What is eligible to be published right now, and why it is
 *      bounded at two months.
 *   3. THE MONTH. Rows in, one total out, through the SAME `monthlyScore` this
 *      account's own month is totalled with.
 *   4. THE PUBLISHER. On close, once, self-healing, idempotent, under the right
 *      name, and never at the cost of a sync cycle.
 *   5. THE READER. Fresh when the network answers, honestly stale when it does
 *      not, and dark when there is no account.
 *   6. THE NOTEBOOK. A blob written before the league existed keeps its cursor
 *      and its outbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { closeDueWeeks, gameOf } from '../src/core/game.ts';
import { monthlyScore, weeksOfMonth } from '../src/core/league.ts';
import {
  emptyOpponentMonth,
  leagueRowFingerprint,
  normalizeLeagueRow,
  opponentMonth,
  prevMonth,
  publishableWeeks,
  type LeagueWeekUpload,
} from '../src/core/leagueSync.ts';
import { planToRecord } from '../src/core/plan.ts';
import { PLAN_DOC_VERSION, type PlanDoc, type PlanExercise } from '../src/data/planTypes.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { mergeIntoStore } from '../src/storage/merge.ts';
import type { AppEvent, LeagueWeekRecord, Session, SetEntry } from '../src/storage/DataStore.ts';
import { makeEvent, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import {
  GhostHandleTakenError,
  type GhostRow,
  type LeagueRawRow,
  type PullPage,
  type SyncBackend,
} from '../src/sync/backend.ts';
import { SyncEngine } from '../src/sync/engine.ts';
import { SYNC_META_KEY, normalizeSyncMeta, readSyncMeta } from '../src/sync/meta.ts';

/* --------------------------------------------------------------- fixtures */

const DAY_MS = 86_400_000;

/** Real Sundays. W1…W3 are June weeks; W4 and W5 are July weeks (Saturday rule). */
const W1 = '2026-06-07';
const W2 = '2026-06-14';
const W3 = '2026-06-21';
const W4 = '2026-06-28';
const W5 = '2026-07-05';
/** A week whose Saturday falls in MAY — closed, but outside the publish window. */
const W0 = '2026-05-24';
/**
 * The untrained week between W0 and W1. It closes as a ZERO like any other
 * (a zero is a fact about the month, and a ledger with holes could not tell
 * "not closed yet" from "closed empty"), so it is published like any other.
 */
const WE = '2026-05-31';

/** A Monday inside the week of 2026-07-12, so W0…W5 are all closed. */
const TODAY = '2026-07-13';
const NOW = new Date(Date.parse(`${TODAY}T12:00:00.000Z`));
/** A Monday one week later: the week of 2026-07-12 has closed too. */
const NEXT = '2026-07-20';

const HANDLE = 'rotem';

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function iso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function tsOf(date: string): number {
  return Date.parse(`${date}T12:00:00.000Z`);
}

function set(w: string, r: string): SetEntry {
  return { w, r, done: true };
}

function rows(ids: readonly string[], sets: number): PlanExercise[] {
  return ids.map((id) => ({ id, sets, reps: '8–10', rest: 90 }));
}

const DAYS = [
  { key: 'A', ids: ['a1', 'a2', 'a3'], sets: 4 },
  { key: 'B', ids: ['b1', 'b2', 'b3'], sets: 4 },
  { key: 'C', ids: ['c1', 'c2', 'c3'], sets: 4 },
  { key: 'd_d', ids: ['x1', 'x2', 'x3'], sets: 4 },
];

const PLAN: PlanDoc = {
  version: PLAN_DOC_VERSION,
  rev: 1,
  days: DAYS.map((d, i) => ({ key: d.key, label: `יום ${String(i)}`, weekdays: [i], exercises: rows(d.ids, d.sets) })),
  weeklyTarget: 4,
  customExercises: [],
};

/** One trained week: `days` of the plan's four days, each done in full. */
function week(sessions: Record<string, Session>, weekStart: string, days = 4, w = '20'): Record<string, Session> {
  for (let i = 0; i < days; i += 1) {
    const day = DAYS[i] as (typeof DAYS)[number];
    const ex: Record<string, (SetEntry | null)[]> = {};
    for (const id of day.ids) ex[id] = Array.from({ length: day.sets }, () => set(w, '10'));
    sessions[iso(weekStart, i)] = { day: day.key, ex };
  }
  return sessions;
}

/** The plan plus one `session_imported` per date — a log, as the account holds it. */
function eventsFor(sessions: Record<string, Session>): AppEvent[] {
  const events: AppEvent[] = [
    makeEvent(
      'plan_updated',
      { plan: planToRecord(PLAN), revision: 1, date: '2026-01-01' },
      Date.parse('2026-01-01T00:00:00.000Z'),
    ),
  ];
  for (const date of Object.keys(sessions).sort()) {
    const s = sessions[date] as Session;
    events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
  }
  return events;
}

/**
 * A store built the way a real one is: a LOG, replayed into state. Events are
 * stamped at their own dates — `store.append` would stamp them "now", which
 * would put the plan into force after the weeks it is meant to grade.
 */
function storeWith(sessions: Record<string, Session>, storage: StorageLike = fakeStorage()): LocalStore {
  const events: AppEvent[] = eventsFor(sessions);
  const store = new LocalStore(storage);
  store.replaceAll(rebuildFromEvents(events, tsOf(TODAY)), events);
  return store;
}

/** Six weeks of steady training: W0 (May) and W1…W5. */
function steady(): Record<string, Session> {
  const sessions: Record<string, Session> = {};
  for (const w of [W0, W1, W2, W3, W4, W5]) week(sessions, w);
  return sessions;
}

/* ------------------------------------------------------------- the server */

interface Row {
  seq: number;
  ev: AppEvent;
}

/**
 * `events` (private, per user) + `ghosts` (one row per user, unique handle) +
 * `league_weeks` (one row per user per week, read by handle). The three tables
 * the schema declares, with the constraints the clients actually rely on.
 */
class MemoryBackend implements SyncBackend {
  private readonly rows = new Map<string, Row[]>();
  private readonly seqs = new Map<string, number>();
  readonly ghosts = new Map<string, GhostRow>();
  readonly leagueRows = new Map<string, LeagueRawRow>();
  leaguePublishes = 0;
  leagueFetches = 0;
  /** Rows in the LAST publish — so "only what is new went up" is checkable. */
  lastBatch: readonly LeagueWeekUpload[] = [];
  failLeague: Error | null = null;

  private listOf(userId: string): Row[] {
    const list = this.rows.get(userId) ?? [];
    this.rows.set(userId, list);
    return list;
  }

  async pushEvents(userId: string, events: readonly AppEvent[]): Promise<void> {
    const list = this.listOf(userId);
    for (const ev of events) {
      if (list.some((r) => r.ev.id === ev.id)) continue;
      const seq = (this.seqs.get(userId) ?? 0) + 1;
      this.seqs.set(userId, seq);
      list.push({ seq, ev });
    }
  }

  async pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage> {
    const page = this.listOf(userId)
      .filter((r) => r.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    const last = page[page.length - 1];
    return { events: page.map((r) => r.ev), lastSeq: last ? last.seq : afterSeq };
  }

  async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
    for (const [owner, row] of this.ghosts) {
      if (owner !== userId && row.handle === handle) throw new GhostHandleTakenError();
    }
    this.ghosts.set(userId, { handle, payload, updatedAt: Date.now() });
  }

  async fetchGhost(handle: string): Promise<GhostRow | null> {
    for (const row of this.ghosts.values()) if (row.handle === handle) return row;
    return null;
  }

  async publishLeagueWeeks(userId: string, handle: string, weeks: readonly LeagueWeekUpload[]): Promise<void> {
    this.leaguePublishes += 1;
    this.lastBatch = weeks;
    if (this.failLeague) throw this.failLeague;
    for (const row of weeks) {
      // The primary key is (user_id, week_key): a re-publish REPLACES.
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
    this.leagueFetches += 1;
    if (this.failLeague) throw this.failLeague;
    return [...this.leagueRows.values()].filter((r) => r['handle'] === handle && r['month_key'] === monthKey);
  }

  /** Somebody else's hostile row, written straight into the table. */
  seedLeagueRow(userId: string, weekKey: string, row: LeagueRawRow): void {
    this.leagueRows.set(`${userId}|${weekKey}`, row);
  }

  rowsOf(handle: string): LeagueRawRow[] {
    return [...this.leagueRows.values()].filter((r) => r['handle'] === handle);
  }
}

/* --------------------------------------------------------------- the rig */

interface Rig {
  store: LocalStore;
  storage: StorageLike;
  backend: MemoryBackend;
  engine: SyncEngine;
  /** Mutable "today", so a test can let a week close. */
  today: { value: string };
  online: { value: boolean };
}

function makeRig(
  store: LocalStore,
  opts: {
    backend?: MemoryBackend;
    storage?: StorageLike;
    today?: string;
    /** `false` builds an engine WITHOUT a ghost publisher — i.e. without a name. */
    ghost?: boolean;
    /** `false` builds an engine that knows nothing about the league. */
    league?: boolean;
    /** Fired at the end of every cycle — what a deferred boot close hangs off. */
    onCycleEnd?: () => void;
  } = {},
): Rig {
  const backend = opts.backend ?? new MemoryBackend();
  const storage = opts.storage ?? fakeStorage();
  const today = { value: opts.today ?? TODAY };
  const online = { value: true };
  const engine = new SyncEngine({
    store,
    backend,
    storage,
    now: () => Date.now(),
    win: null,
    doc: null,
    isOnline: () => online.value,
    isVisible: () => false,
    ...(opts.onCycleEnd ? { onCycleEnd: opts.onCycleEnd } : {}),
    ...(opts.ghost === false
      ? {}
      : {
          ghost: {
            snapshot: (handle: string) => ({ payload: { v: 1, name: handle }, hash: `hash:${handle}` }),
            defaultHandle: () => HANDLE,
          },
        }),
    ...(opts.league === false
      ? {}
      : { league: { rows: () => publishableWeeks(gameOf(store).league.weeks, today.value) } }),
  });
  engine.start();
  return { store, storage, backend, engine, today, online };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ==================================================== 1. the trust boundary */

describe('normalizeLeagueRow — a fetched row is hostile input', () => {
  /** An honestly graded week, as the database would hand it over. */
  function honest(overrides: Record<string, unknown> = {}): LeagueRawRow {
    // 0.4×1 + 0.3×0.9 + 0.2×0.5 + 0.1×0.33 = 0.803 → 80.3
    return {
      handle: HANDLE,
      week_key: W5,
      month_key: '2026-07',
      score: 80.3,
      c: 1,
      q: 0.9,
      l: 0.5,
      p: 0.33,
      coin: true,
      volume: 9600,
      days: 4,
      prs: 1,
      updated_at: '2026-07-06T08:00:00.000Z',
      ...overrides,
    };
  }

  it('accepts an honest row, in either spelling of its columns', () => {
    const row = normalizeLeagueRow(honest());
    expect(row?.weekKey).toBe(W5);
    expect(row?.monthKey).toBe('2026-07');
    expect(row?.score).toBe(80.3);
    expect(row?.updatedAt).toBe(Date.parse('2026-07-06T08:00:00.000Z'));
    // The engine's own cache round-trips through camelCase; both read the same.
    const camel = normalizeLeagueRow({
      weekKey: W5,
      monthKey: '2026-07',
      score: 80.3,
      c: 1,
      q: 0.9,
      l: 0.5,
      p: 0.33,
      coin: true,
      volume: 9600,
      days: 4,
      prs: 1,
      updatedAt: Date.parse('2026-07-06T08:00:00.000Z'),
    });
    expect(camel).toEqual(row);
  });

  it('refuses a week key that is not a real Sunday', () => {
    expect(normalizeLeagueRow(honest({ week_key: '2026-07-06' }))).toBeNull(); // a Monday
    expect(normalizeLeagueRow(honest({ week_key: '2026-07' }))).toBeNull();
    expect(normalizeLeagueRow(honest({ week_key: 'nonsense' }))).toBeNull();
    expect(normalizeLeagueRow(honest({ week_key: 42 }))).toBeNull();
    expect(normalizeLeagueRow(null)).toBeNull();
    expect(normalizeLeagueRow([honest()])).toBeNull();
  });

  it('refuses a month that is not the month of the week’s SATURDAY', () => {
    // W5 (2026-07-05 … 2026-07-11) is a July week; claiming June is a lie about
    // WHICH leaderboard the score counts towards.
    expect(normalizeLeagueRow(honest({ month_key: '2026-06' }))).toBeNull();
    expect(normalizeLeagueRow(honest({ month_key: '' }))).toBeNull();
    // W4 starts in June and ends on 2026-07-04 — a JULY week, and it is accepted
    // as one.
    const straddling = normalizeLeagueRow(honest({ week_key: W4, month_key: '2026-07' }));
    expect(straddling?.monthKey).toBe('2026-07');
    // …and a caller asking for one month never gets another one's week.
    expect(normalizeLeagueRow(honest(), '2026-06')).toBeNull();
    expect(normalizeLeagueRow(honest(), '2026-07')).not.toBeNull();
  });

  it('refuses a component outside 0…1 and a score outside 0…100', () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown]) {
      expect(normalizeLeagueRow(honest({ c: bad }))).toBeNull();
      expect(normalizeLeagueRow(honest({ q: bad }))).toBeNull();
      expect(normalizeLeagueRow(honest({ l: bad }))).toBeNull();
      expect(normalizeLeagueRow(honest({ p: bad }))).toBeNull();
    }
    expect(normalizeLeagueRow(honest({ score: -1 }))).toBeNull();
    expect(normalizeLeagueRow(honest({ score: 100.1 }))).toBeNull();
    expect(normalizeLeagueRow(honest({ score: 'perfect' }))).toBeNull();
  });

  it('refuses a score that is not what its own components add up to', () => {
    // THE self-verifying property stage 1 built: `weekScore` grades from the
    // ROUNDED components, so score === round1(100 × Σ w·x) for every honest row.
    expect(normalizeLeagueRow(honest({ score: 100, c: 1, q: 1, l: 1, p: 1 }))).not.toBeNull();
    expect(normalizeLeagueRow(honest({ score: 100 }))).toBeNull(); // components say 80.3
    expect(normalizeLeagueRow(honest({ score: 80.4 }))).toBeNull(); // one decimal out
    expect(normalizeLeagueRow(honest({ c: 0.99 }))).toBeNull(); // component nudged instead
    // A perfect zero verifies too — a week that trained nothing is a fact.
    expect(normalizeLeagueRow(honest({ score: 0, c: 0, q: 0, l: 0, p: 0 }))?.score).toBe(0);
  });

  it('derives the 🔵 rather than believing it', () => {
    // Claimed but not earned: C is 0.5, so no coin, whatever the row says.
    const lying = normalizeLeagueRow(honest({ score: 60.3, c: 0.5, q: 0.9, l: 0.5, p: 0.33, coin: true }));
    expect(lying?.coin).toBe(false);
    // Earned but disclaimed: C = 1 and Q ≥ 0.8 mint it regardless.
    expect(normalizeLeagueRow(honest({ coin: false }))?.coin).toBe(true);
    expect(normalizeLeagueRow(honest({ coin: 'yes' }))?.coin).toBe(true);
    // The thresholds are the ledger's own, not a second rule.
    expect(BALANCE.league.coinConsistency).toBe(1);
    expect(BALANCE.league.coinCompletion).toBe(0.8);
  });

  it('clamps the three explaining numbers instead of throwing the grade away', () => {
    // None of them can move a score, so a nonsense value becomes 0 rather than
    // discarding a week whose arithmetic verified.
    const row = normalizeLeagueRow(honest({ volume: -5, days: 3.7, prs: 'lots' }));
    expect(row).not.toBeNull();
    expect(row?.volume).toBe(0);
    expect(row?.days).toBe(3);
    expect(row?.prs).toBe(0);
    expect(normalizeLeagueRow(honest({ updated_at: 'never' }))?.updatedAt).toBeNull();
  });

  it('accepts every week this app itself publishes — the round trip', () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const ledger = gameOf(store).league.weeks;
    const published = publishableWeeks(ledger, TODAY);
    expect(published.length).toBeGreaterThan(0);
    for (const row of published) {
      const back = normalizeLeagueRow({ ...row, updatedAt: null });
      expect(back).not.toBeNull();
      const record = ledger[row.weekKey] as LeagueWeekRecord;
      // Everything the ledger holds survives the wire, unchanged.
      expect({
        score: back?.score,
        c: back?.c,
        q: back?.q,
        l: back?.l,
        p: back?.p,
        coin: back?.coin,
        volume: back?.volume,
        days: back?.days,
        prs: back?.prs,
      }).toEqual(record);
    }
  });
});

/* ========================================================== 2. the window */

describe('the publish window', () => {
  it('is the current month and the one before it', () => {
    expect(prevMonth('2026-07')).toBe('2026-06');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('nonsense')).toBe('nonsense');

    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const ledger = gameOf(store).league.weeks;
    // Six weeks closed, including W0 in MAY…
    expect(Object.keys(ledger)).toContain(W0);
    // …but only June's and July's are eligible — including the untrained week
    // that closed as a zero, and including the week that STARTS in May and is a
    // June week because its Saturday is.
    expect(publishableWeeks(ledger, TODAY).map((r) => r.weekKey)).toEqual([WE, W1, W2, W3, W4, W5]);
    expect(publishableWeeks(ledger, TODAY).map((r) => r.monthKey)).toEqual([
      '2026-06',
      '2026-06',
      '2026-06',
      '2026-06',
      '2026-07',
      '2026-07',
    ]);
  });

  it('never lists a week the ledger has not closed', () => {
    const store = storeWith(steady());
    // Nothing closed yet: the weeks exist in the sessions, not in the ledger.
    expect(publishableWeeks(gameOf(store).league.weeks, TODAY)).toEqual([]);
    closeDueWeeks(store, NOW);
    // The week in progress (2026-07-12) is never graded and never published.
    expect(publishableWeeks(gameOf(store).league.weeks, TODAY).map((r) => r.weekKey)).not.toContain('2026-07-12');
    expect(weeksOfMonth('2026-07')).toContain('2026-07-12');
  });
});

/* =========================================================== 3. the month */

describe('opponentMonth', () => {
  function published(): LeagueRawRow[] {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    return publishableWeeks(gameOf(store).league.weeks, TODAY)
      .filter((r) => r.monthKey === '2026-07')
      .map((r) => ({ ...r, updated_at: '2026-07-06T00:00:00.000Z' }));
  }

  it('totals exactly what monthlyScore totals for the account itself', () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const mine = monthlyScore(gameOf(store).league.weeks, '2026-07');
    const theirs = opponentMonth(published(), '2026-07');
    expect(theirs.monthlyScore).toBe(mine);
    expect(theirs.rows.map((r) => r.weekKey)).toEqual([W4, W5]);
    expect(theirs.coins).toBe(2);
    expect(theirs.rejected).toBe(0);
    // The map is keyed exactly like `game.league.weeks`, which is what lets the
    // UI stage render "her week" with the same component bars as "my week".
    expect(Object.keys(theirs.weeks)).toEqual([W4, W5]);
  });

  it('drops what the boundary refuses and counts it', () => {
    const rows = [
      ...published(),
      { week_key: '2026-07-06', month_key: '2026-07', score: 0, c: 0, q: 0, l: 0, p: 0 }, // Monday
      { week_key: '2026-07-19', month_key: '2026-07', score: 100, c: 0.5, q: 0.5, l: 0.5, p: 0.5 }, // liar
      { week_key: '2026-07-19', month_key: '2026-06', score: 0, c: 0, q: 0, l: 0, p: 0 }, // wrong month
      'not a row',
    ];
    const month = opponentMonth(rows, '2026-07');
    expect(month.rejected).toBe(4);
    expect(month.rows).toHaveLength(2);
    expect(month.monthlyScore).toBe(opponentMonth(published(), '2026-07').monthlyScore);
  });

  it('keeps the NEWEST row when a handle somehow has two for one week', () => {
    const [first] = published();
    if (!first) throw new Error('no rows');
    const older = { ...first, score: 0, c: 0, q: 0, l: 0, p: 0, updated_at: '2026-01-01T00:00:00.000Z' };
    const both = opponentMonth([older, first], '2026-07');
    const reversed = opponentMonth([first, older], '2026-07');
    expect(both.rows).toHaveLength(1);
    expect(both.rows[0]?.score).toBe(first['score']);
    expect(reversed.rows[0]?.score).toBe(first['score']);
  });

  it('is empty, not broken, when nobody published anything', () => {
    expect(opponentMonth([], '2026-07')).toEqual(emptyOpponentMonth('2026-07'));
    expect(emptyOpponentMonth('2026-07').monthlyScore).toBe(0);
  });
});

/* ======================================================= 4. the publisher */

describe('publishing my closed weeks', () => {
  it('uploads the window on the first cycle and makes no request on the next', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);

    await rig.engine.onSignedIn('user-1');
    expect(rig.backend.leaguePublishes).toBe(1);
    expect(rig.backend.rowsOf(HANDLE).map((r) => r['week_key']).sort()).toEqual([WE, W1, W2, W3, W4, W5]);
    // The May week is closed on this device and deliberately NOT on the wire.
    expect(rig.backend.rowsOf(HANDLE).map((r) => r['week_key'])).not.toContain(W0);
    expect(rig.engine.getPublishedLeagueWeeks()).toEqual([WE, W1, W2, W3, W4, W5]);
    expect(readSyncMeta(rig.storage).leagueHandle).toBe(HANDLE);

    // Nothing closed since: not one request.
    await rig.engine.sync();
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(1);
    rig.engine.dispose();
  });

  it('publishes a week the moment it closes — and only that week', async () => {
    const store = storeWith(steady());
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    // Nothing is closed yet, so nothing was published at all.
    expect(rig.backend.leaguePublishes).toBe(0);

    closeDueWeeks(store, NOW);
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(1);
    expect(rig.backend.lastBatch).toHaveLength(6);

    // A week later the week of 2026-07-12 has ended; closing it uploads ONE row.
    rig.today.value = NEXT;
    closeDueWeeks(store, new Date(Date.parse(`${NEXT}T12:00:00.000Z`)));
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(2);
    expect(rig.backend.lastBatch.map((r) => r.weekKey)).toEqual(['2026-07-12']);
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(7);
    rig.engine.dispose();
  });

  it('heals itself when a week closed while nobody was watching', async () => {
    const backend = new MemoryBackend();
    const storage = fakeStorage();
    const store = storeWith(steady(), fakeStorage());
    const rig = makeRig(store, { backend, storage });
    await rig.engine.onSignedIn('user-1');
    closeDueWeeks(store, NOW);
    await rig.engine.sync();
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(6);
    // The tab is closed. Nothing recorded that anything else ever happens.
    rig.engine.dispose();

    // Another week closes while this engine does not exist — on this device
    // (a boot that closed it before signing in) or on another one (its event
    // arrived by a pull). Either way NOTHING told a publisher about it.
    closeDueWeeks(store, new Date(Date.parse(`${NEXT}T12:00:00.000Z`)));

    const revived = makeRig(store, { backend, storage, today: NEXT });
    await revived.engine.onSignedIn('user-1');
    // The diff against the ledger found it: one row, no re-upload of the rest.
    expect(backend.leaguePublishes).toBe(2);
    expect(backend.lastBatch.map((r) => r.weekKey)).toEqual(['2026-07-12']);
    expect(backend.rowsOf(HANDLE)).toHaveLength(7);
    revived.engine.dispose();
  });

  it('publishes everything again after a sign-out, and the table does not grow', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(6);

    // Signing out forgets the notebook — including which weeks were published.
    rig.engine.stop();
    expect(readSyncMeta(rig.storage).leagueWeeks).toEqual([]);

    await rig.engine.onSignedIn('user-1');
    expect(rig.backend.leaguePublishes).toBe(2);
    // The upsert is keyed (user_id, week_key): six weeks re-published are six
    // rows overwritten, never twelve.
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(6);
    expect(rig.backend.leagueRows.size).toBe(6);
    rig.engine.dispose();
  });

  it('re-publishes under a new name after a rename', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(6);

    // A rename is answered SYNCHRONOUSLY for the ghost — the user is standing in
    // front of the settings card — and the league rows follow on the next cycle,
    // because nobody is waiting for a leaderboard to repaint. Same identity,
    // different urgency.
    expect(await rig.engine.setGhostHandle('dana')).toBe(true);
    expect(rig.backend.ghosts.get('user-1')?.handle).toBe('dana');
    expect(rig.backend.rowsOf('dana')).toHaveLength(0);

    await rig.engine.sync();
    expect(rig.backend.rowsOf('dana')).toHaveLength(6);
    // The rows moved rather than multiplied: the old name answers to nothing.
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(0);
    expect(rig.backend.leagueRows.size).toBe(6);
    expect(readSyncMeta(rig.storage).leagueHandle).toBe('dana');
    rig.engine.dispose();
  });

  it('never lets a failed publish break a sync cycle', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    rig.backend.failLeague = new Error('league table is on fire');

    await rig.engine.onSignedIn('user-1');
    // The events still went up and the engine is idle, not in error.
    expect(rig.engine.getStatus().kind).toBe('idle');
    expect(rig.backend.leaguePublishes).toBe(1);
    // Nothing was recorded as published, so the next cycle tries again.
    expect(rig.engine.getPublishedLeagueWeeks()).toEqual([]);
    expect(readSyncMeta(rig.storage).leagueHandle).toBeNull();

    rig.backend.failLeague = null;
    await rig.engine.sync();
    expect(rig.backend.rowsOf(HANDLE)).toHaveLength(6);
    rig.engine.dispose();
  });

  it('publishes nothing at all without an account, a name, or the feature', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);

    // Signed out: a cycle is not even attempted.
    const out = makeRig(store);
    await out.engine.sync();
    expect(out.backend.leaguePublishes).toBe(0);
    expect(out.engine.getStatus().kind).toBe('signedOut');
    out.engine.dispose();

    // A build without ghost duels has no handle — and one identity means one
    // name, so it publishes nowhere rather than inventing a second one.
    const nameless = makeRig(store, { ghost: false });
    await nameless.engine.onSignedIn('user-1');
    expect(nameless.backend.leaguePublishes).toBe(0);
    nameless.engine.dispose();

    // A build without the league never touches the table.
    const noLeague = makeRig(store, { league: false });
    await noLeague.engine.onSignedIn('user-1');
    expect(noLeague.backend.leaguePublishes).toBe(0);
    expect(noLeague.backend.ghosts.size).toBe(1); // …but its ghost still goes up
    noLeague.engine.dispose();
  });

  it('prunes the notebook as weeks fall out of the window', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    expect(rig.engine.getPublishedLeagueWeeks()).toHaveLength(6);

    // Two months later June is out of the window. Nothing new is due, and the
    // notebook drops the weeks it can no longer be asked about — so it is
    // bounded by the window for ever rather than by the length of the account.
    rig.today.value = '2026-09-14';
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(1);
    expect(rig.engine.getPublishedLeagueWeeks()).toEqual([]);
    expect(readSyncMeta(rig.storage).leagueWeeks).toEqual([]);
    rig.engine.dispose();
  });

  it('re-publishes a week whose grade IMPROVED — the diff is on CONTENT, not on keys', async () => {
    // The phone that closed before its pull landed: one day of W5 was all it
    // had, so W5 went up as a 55 with no 🔵 — and the rival read that.
    const half: Record<string, Session> = {};
    week(half, W5, 1);
    const store = storeWith(half);
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    expect(rig.backend.leaguePublishes).toBe(1);
    expect(rig.backend.rowsOf(HANDLE).find((r) => r['week_key'] === W5)).toMatchObject({
      score: 55,
      coin: false,
    });

    // The rest of the account arrives and the next close corrects the week.
    mergeIntoStore(store, eventsFor(steady()), NOW.getTime());
    expect(closeDueWeeks(store, NOW).regraded).toEqual([W5]);

    // A key-only diff would have said "W5? already published" and left the lie
    // standing for ever. The fingerprint says the grade moved.
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(2);
    expect(rig.backend.lastBatch.map((r) => r.weekKey)).toContain(W5);
    expect(rig.backend.rowsOf(HANDLE).find((r) => r['week_key'] === W5)).toMatchObject({
      score: 80,
      coin: true,
    });
    // One row per week, still — a re-publish overwrites (user_id, week_key).
    expect(rig.backend.rowsOf(HANDLE).filter((r) => r['week_key'] === W5)).toHaveLength(1);

    // …and now that the notebook agrees with the ledger, nothing goes up again.
    await rig.engine.sync();
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(2);
    rig.engine.dispose();
  });

  it('republishes ONCE from a notebook written before grades were fingerprinted', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    // A notebook from the build that recorded week KEYS and nothing else: the
    // weeks are "published", but what they said is unknown — so they are sent
    // once and then left alone.
    const storage = fakeStorage({
      [SYNC_META_KEY]: JSON.stringify({
        v: 1,
        deviceId: 'dev-1',
        cursor: 0,
        outbox: [],
        userId: 'user-1',
        lastSyncAt: null,
        ghostHandle: HANDLE,
        ghostHash: 'hash:rotem',
        leagueHandle: HANDLE,
        leagueWeeks: [WE, W1, W2, W3, W4, W5],
      }),
    });
    expect(normalizeSyncMeta(storage.getItem(SYNC_META_KEY)).leagueHashes).toEqual({});

    const rig = makeRig(store, { storage });
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(1);
    expect(rig.backend.lastBatch).toHaveLength(6);
    await rig.engine.sync();
    expect(rig.backend.leaguePublishes).toBe(1);
    rig.engine.dispose();
  });

  it('fingerprints the whole grade, so any part of it moving is noticed', () => {
    const base: LeagueWeekRecord = {
      score: 80,
      c: 1,
      q: 1,
      l: 0.5,
      p: 0,
      coin: true,
      volume: 9600,
      days: 4,
      prs: 0,
    };
    expect(leagueRowFingerprint(base)).toBe(leagueRowFingerprint({ ...base }));
    for (const changed of [
      { ...base, score: 80.1 },
      { ...base, c: 0.9 },
      { ...base, q: 0.9 },
      { ...base, l: 0.6 },
      { ...base, p: 0.1 },
      { ...base, coin: false },
      { ...base, volume: 9601 },
      { ...base, days: 5 },
      { ...base, prs: 1 },
    ]) {
      expect(leagueRowFingerprint(changed)).not.toBe(leagueRowFingerprint(base));
    }
  });
});

/* ============================================ 4b. catching up before grading */

/**
 * WHY THE ENGINE HAS A "CAUGHT UP" LIGHT AT ALL.
 *
 * הליגה grades a finished week and FILES the grade as an event. That is a
 * judgement about the log — so on a device whose log is still a subset of its
 * account (a fresh install between "signed in" and "history arrived"), it is a
 * judgement about data the device cannot see. `main.ts` therefore defers the
 * boot close until the first cycle has settled; these are the two probes it
 * hangs off, and the promise that a cycle ALWAYS settles.
 */
describe('the catch-up gate', () => {
  it('knows whether an account is linked, and whether its history is here yet', async () => {
    const store = storeWith(steady());
    const rig = makeRig(store);
    // Signed out: nothing to wait for — the log is all there will ever be.
    expect(rig.engine.hasAccount()).toBe(false);
    expect(rig.engine.isCaughtUp()).toBe(false);

    await rig.engine.onSignedIn('user-1');
    expect(rig.engine.hasAccount()).toBe(true);
    expect(rig.engine.isCaughtUp()).toBe(true);

    // Signing out forgets the account — and with it the claim to be caught up.
    rig.engine.stop();
    expect(rig.engine.hasAccount()).toBe(false);
    expect(rig.engine.isCaughtUp()).toBe(false);
    rig.engine.dispose();
  });

  it('ends its cycle even with no network, so a deferred close is never stranded', async () => {
    const store = storeWith(steady());
    let ends = 0;
    const rig = makeRig(store, { onCycleEnd: () => void (ends += 1) });
    rig.online.value = false;

    await rig.engine.onSignedIn('user-1');
    // Nothing could be pulled — the device is NOT caught up and says so — but
    // the cycle finished, which is what releases the boot close.
    expect(rig.engine.getStatus().kind).toBe('offline');
    expect(rig.engine.isCaughtUp()).toBe(false);
    expect(ends).toBeGreaterThan(0);

    // Back on the network, the same probe flips.
    rig.online.value = true;
    await rig.engine.sync();
    expect(rig.engine.isCaughtUp()).toBe(true);
    rig.engine.dispose();
  });

  it('is not caught up again after switching to another account', async () => {
    const store = storeWith(steady());
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    expect(rig.engine.isCaughtUp()).toBe(true);

    rig.online.value = false;
    await rig.engine.onSignedIn('user-2');
    // A different account's history is a different question, and none of it is
    // here: grading now would grade user-2's weeks from user-1's device.
    expect(rig.engine.isCaughtUp()).toBe(false);
    rig.engine.dispose();
  });
});

/* ========================================================== 5. the reader */

describe('reading an opponent’s month', () => {
  /** An account that has published its weeks, and an empty one to read them. */
  async function pair(): Promise<{ backend: MemoryBackend; reader: Rig; mine: number }> {
    const backend = new MemoryBackend();
    const theirs = storeWith(steady());
    closeDueWeeks(theirs, NOW);
    const publisher = makeRig(theirs, { backend });
    await publisher.engine.onSignedIn('user-1');
    publisher.engine.dispose();

    const reader = makeRig(storeWith({}), { backend });
    await reader.engine.onSignedIn('user-2');
    return { backend, reader, mine: monthlyScore(gameOf(theirs).league.weeks, '2026-07') };
  }

  it('fetches, normalizes, totals and caches', async () => {
    const { reader, mine } = await pair();
    const view = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    expect(view.stale).toBe(false);
    expect(view.fetchedAt).toBe(Date.now());
    expect(view.month.monthlyScore).toBe(mine);
    expect(view.month.rows.map((r) => r.weekKey)).toEqual([W4, W5]);
    // It is cached in the notebook, not in memory: a reload can render it.
    expect(readSyncMeta(reader.storage).leagueMonth?.rows).toHaveLength(2);
    reader.engine.dispose();
  });

  it('falls back to the cached copy — and says it is stale', async () => {
    const { backend, reader, mine } = await pair();
    const fresh = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    const fetchedAt = fresh.fetchedAt;

    vi.setSystemTime(NOW.getTime() + 3 * DAY_MS);
    backend.failLeague = new Error('offline-ish');
    const stale = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    // The numbers are the ones we last read, and the timestamp is THEIRS — the
    // UI can say "as of three days ago" instead of showing a zero, which is the
    // one thing a dropped connection must never be allowed to say.
    expect(stale.stale).toBe(true);
    expect(stale.fetchedAt).toBe(fetchedAt);
    expect(stale.month.monthlyScore).toBe(mine);

    // A different (handle, month) has nothing cached: empty, not somebody else's.
    const other = await reader.engine.loadLeagueMonth('dana', '2026-07');
    expect(other.month.monthlyScore).toBe(0);
    expect(other.fetchedAt).toBeNull();
    expect(other.stale).toBe(true);
    reader.engine.dispose();
  });

  it('makes no request while offline or signed out, and still renders', async () => {
    const { backend, reader } = await pair();
    await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    const fetches = backend.leagueFetches;

    reader.online.value = false;
    const offline = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    expect(backend.leagueFetches).toBe(fetches);
    expect(offline.stale).toBe(true);
    expect(offline.month.rows).toHaveLength(2);

    reader.online.value = true;
    reader.engine.stop(); // signed out: the whole cloud surface goes dark
    const dark = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    expect(backend.leagueFetches).toBe(fetches);
    expect(dark.month).toEqual(emptyOpponentMonth('2026-07'));
    reader.engine.dispose();
  });

  it('refuses hostile rows that were written straight into the table', async () => {
    const { backend, reader, mine } = await pair();
    backend.seedLeagueRow('user-liar', '2026-07-19', {
      handle: HANDLE,
      week_key: '2026-07-19',
      month_key: '2026-07',
      score: 100,
      c: 0.1,
      q: 0.1,
      l: 0.1,
      p: 0.1,
      coin: true,
      volume: 1e9,
      days: 99,
      prs: 99,
      updated_at: '2026-07-20T00:00:00.000Z',
    });
    const view = await reader.engine.loadLeagueMonth(HANDLE, '2026-07');
    expect(view.month.rejected).toBe(1);
    expect(view.month.monthlyScore).toBe(mine); // …and not one point more
    // The cache only ever holds what was already believable.
    expect(readSyncMeta(reader.storage).leagueMonth?.rows).toHaveLength(2);
    reader.engine.dispose();
  });
});

/* ======================================================== 6. the notebook */

describe('the sync notebook', () => {
  it('reads a pre-league blob tolerantly, keeping the cursor and the outbox', () => {
    const legacy = JSON.stringify({
      v: 1,
      deviceId: 'dev-1',
      cursor: 42,
      outbox: ['ev-1', 'ev-2'],
      userId: 'user-1',
      lastSyncAt: 1_700_000_000_000,
      ghostHandle: HANDLE,
      ghostHash: 'abc',
      ghostRecent: ['dana'],
    });
    const meta = normalizeSyncMeta(legacy);
    // Nothing was reset — a version bump here would have cost a full re-push
    // and re-pull to add three optional fields.
    expect(meta.cursor).toBe(42);
    expect(meta.outbox).toEqual(['ev-1', 'ev-2']);
    expect(meta.ghostHandle).toBe(HANDLE);
    // …and "nothing published yet, nothing cached" is the right reading.
    expect(meta.leagueHandle).toBeNull();
    expect(meta.leagueWeeks).toEqual([]);
    expect(meta.leagueHashes).toEqual({});
    expect(meta.leagueMonth).toBeNull();
  });

  it('re-checks a cached month on the way OUT of storage', () => {
    const meta = normalizeSyncMeta(
      JSON.stringify({
        v: 1,
        deviceId: 'dev-1',
        cursor: 0,
        outbox: [],
        userId: 'user-1',
        lastSyncAt: null,
        leagueMonth: {
          handle: HANDLE,
          monthKey: '2026-07',
          fetchedAt: 1_700_000_000_000,
          rows: [
            { weekKey: W5, monthKey: '2026-07', score: 100, c: 1, q: 1, l: 1, p: 1, volume: 1, days: 1, prs: 0 },
            { weekKey: W5, monthKey: '2026-07', score: 100, c: 0, q: 0, l: 0, p: 0 }, // tampered on disk
            { weekKey: 'nope', monthKey: '2026-07', score: 0, c: 0, q: 0, l: 0, p: 0 },
          ],
        },
      }),
    );
    expect(meta.leagueMonth?.rows).toHaveLength(1);
    expect(meta.leagueMonth?.rows[0]?.weekKey).toBe(W5);
    // A blob with no rows at all is still a cache entry, just an empty one.
    expect(normalizeSyncMeta(JSON.stringify({ v: 1, leagueMonth: { handle: 'x' } })).leagueMonth).toBeNull();
  });

  it('survives a round trip through storage', async () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    const rig = makeRig(store);
    await rig.engine.onSignedIn('user-1');
    await rig.engine.loadLeagueMonth(HANDLE, '2026-07');
    rig.engine.dispose();

    const raw = rig.storage.getItem(SYNC_META_KEY);
    expect(raw).toBeTruthy();
    const meta = normalizeSyncMeta(raw);
    expect(meta.leagueHandle).toBe(HANDLE);
    expect(meta.leagueWeeks).toEqual([WE, W1, W2, W3, W4, W5]);
    // The grades ride with the keys, so a week that is re-graded later is
    // noticed as CHANGED rather than as already-done.
    expect(Object.keys(meta.leagueHashes).sort()).toEqual([WE, W1, W2, W3, W4, W5].sort());
    expect(meta.leagueMonth?.monthKey).toBe('2026-07');
    expect(meta.leagueMonth?.rows).toHaveLength(2);
  });
});
