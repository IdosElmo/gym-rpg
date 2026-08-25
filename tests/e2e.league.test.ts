/**
 * e2e.league.test.ts — TWO ACCOUNTS, ONE HOUSEHOLD, ONE LEADERBOARD.
 *
 * `e2e.duel.test.ts` plays two accounts against each other in the arena. This
 * one plays them against each other over a MONTH: two stores, two sync engines,
 * one in-memory server holding `events` (private, per user), `ghosts` (one row
 * per user) and `league_weeks` (one row per user per week, read by handle) —
 * the same shape `supabase/schema.sql` describes, including the asymmetry that
 * makes the feature possible (a league row is readable by everyone, an event
 * only by its owner).
 *
 * NOTHING HERE TOUCHES A NETWORK.
 *
 * What it asserts, end to end:
 *   1. Two DIFFERENT plans — four light days a week against three heavy ones —
 *      are graded on the same 0…100 scale, because every component is a ratio
 *      against the trainee's own plan and their own past.
 *   2. Closing the weeks and syncing publishes them; nothing else about either
 *      account leaves the device.
 *   3. Each side fetches the other's month by NAME and computes exactly the
 *      monthly score that side holds locally — the number they are competing
 *      over is one number, not two approximations of it.
 *   4. A hostile row cannot beat an honest one: the score must reproduce its own
 *      components (`normalizeLeagueRow`).
 *   5. Spending stays PRIVATE: a redeemed reward and a staked challenge change
 *      the purse on one device and appear nowhere on the wire.
 *   6. The ledgers stay one account's own: neither log carries the other's week.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDueWeeks, gameOf, redeemLeagueReward, setLeagueChallenge } from '../src/core/game.ts';
import { monthlyScore } from '../src/core/league.ts';
import { opponentMonth, publishableWeeks, type LeagueWeekUpload } from '../src/core/leagueSync.ts';
import { planToRecord } from '../src/core/plan.ts';
import { poolOfMonth } from '../src/data/leaguePools.ts';
import { PLAN_DOC_VERSION, type PlanDoc, type PlanExercise } from '../src/data/planTypes.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, Session, SetEntry } from '../src/storage/DataStore.ts';
import { makeEvent, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import {
  GhostHandleTakenError,
  type GhostRow,
  type LeagueRawRow,
  type PullPage,
  type SyncBackend,
} from '../src/sync/backend.ts';
import { SyncEngine } from '../src/sync/engine.ts';

/* --------------------------------------------------------------- fixtures */

const DAY_MS = 86_400_000;

/** July 2026 weeks — the month the two of them are fighting over. */
const JULY = '2026-07';
const JUNE_WEEKS = ['2026-05-31', '2026-06-07', '2026-06-14', '2026-06-21'];
const JULY_WEEKS = ['2026-06-28', '2026-07-05', '2026-07-12', '2026-07-19'];
/** A Monday in the week of 2026-07-26: every July week above has closed. */
const TODAY = '2026-07-27';
const NOW = new Date(Date.parse(`${TODAY}T12:00:00.000Z`));

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
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

function rows(ids: readonly string[], sets: number): PlanExercise[] {
  return ids.map((id) => ({ id, sets, reps: '8–10', rest: 90 }));
}

interface DayDef {
  key: string;
  ids: readonly string[];
  sets: number;
  /** Days after the week's Sunday this day is trained on. */
  offset: number;
}

/** ROTEM: four days a week, three exercises × four sets, 20 kg × 10. */
const ROTEM_DAYS: DayDef[] = [
  { key: 'A', ids: ['a1', 'a2', 'a3'], sets: 4, offset: 0 },
  { key: 'B', ids: ['b1', 'b2', 'b3'], sets: 4, offset: 1 },
  { key: 'C', ids: ['c1', 'c2', 'c3'], sets: 4, offset: 2 },
  { key: 'd_d', ids: ['x1', 'x2', 'x3'], sets: 4, offset: 3 },
];
/** YOSSI: three days a week, two exercises × five sets, 100 kg × 5. */
const YOSSI_DAYS: DayDef[] = [
  { key: 'A', ids: ['a1', 'a2'], sets: 5, offset: 0 },
  { key: 'B', ids: ['b1', 'b2'], sets: 5, offset: 2 },
  { key: 'C', ids: ['c1', 'c2'], sets: 5, offset: 4 },
];

function planOf(days: readonly DayDef[], weeklyTarget: number): PlanDoc {
  return {
    version: PLAN_DOC_VERSION,
    rev: 1,
    days: days.map((d, i) => ({
      key: d.key,
      label: `יום ${String(i)}`,
      weekdays: [d.offset],
      exercises: rows(d.ids, d.sets),
    })),
    weeklyTarget,
    customExercises: [],
  };
}

const ROTEM_PLAN = planOf(ROTEM_DAYS, 4);
const YOSSI_PLAN = planOf(YOSSI_DAYS, 3);

function sessionsFor(days: readonly DayDef[], weeks: readonly string[], w: string, r: string, skip = 0): Record<string, Session> {
  const out: Record<string, Session> = {};
  for (const weekStart of weeks) {
    for (const day of days.slice(0, days.length - skip)) {
      const ex: Record<string, (SetEntry | null)[]> = {};
      for (const id of day.ids) ex[id] = Array.from({ length: day.sets }, () => ({ w, r, done: true }));
      out[iso(weekStart, day.offset)] = { day: day.key, ex };
    }
  }
  return out;
}

/* ------------------------------------------------------------- the server */

interface Row {
  seq: number;
  ev: AppEvent;
}

class MemoryBackend implements SyncBackend {
  private readonly rows = new Map<string, Row[]>();
  private readonly seqs = new Map<string, number>();
  readonly ghosts = new Map<string, GhostRow>();
  readonly leagueRows = new Map<string, LeagueRawRow>();

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

  /**
   * `league_weeks`. The insert policy in the schema pins `handle` to the
   * writer's own `ghosts` row, so a name belongs to one account — reproduced
   * here, because it is what makes "fetch by handle" mean one person.
   */
  async publishLeagueWeeks(userId: string, handle: string, weeks: readonly LeagueWeekUpload[]): Promise<void> {
    const owner = this.ghosts.get(userId);
    if (!owner || owner.handle !== handle) throw new Error('handle is not yours (RLS)');
    for (const row of weeks) {
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

  eventsOf(userId: string): AppEvent[] {
    return this.listOf(userId).map((r) => r.ev);
  }

  /** Everything on the wire, as one string — for "this never left the device". */
  wire(): string {
    return JSON.stringify([...this.leagueRows.values()]);
  }
}

/* ---------------------------------------------------------------- people */

interface Person {
  userId: string;
  handle: string;
  store: LocalStore;
  storage: StorageLike;
  engine: SyncEngine;
}

function makePerson(
  userId: string,
  handle: string,
  backend: MemoryBackend,
  plan: PlanDoc,
  sessions: Record<string, Session>,
): Person {
  const events: AppEvent[] = [
    makeEvent(
      'plan_updated',
      { plan: planToRecord(plan), revision: 1, date: '2026-01-01' },
      Date.parse('2026-01-01T00:00:00.000Z'),
    ),
  ];
  for (const date of Object.keys(sessions).sort()) {
    const s = sessions[date] as Session;
    events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
  }
  const storage = fakeStorage();
  const store = new LocalStore(storage);
  store.replaceAll(rebuildFromEvents(events, NOW.getTime()), events);

  const engine = new SyncEngine({
    store,
    backend,
    storage,
    now: () => Date.now(),
    win: null,
    doc: null,
    isOnline: () => true,
    isVisible: () => false,
    ghost: {
      snapshot: (h) => ({ payload: { v: 1, name: h }, hash: `hash:${h}` }),
      defaultHandle: () => handle,
    },
    league: { rows: () => publishableWeeks(gameOf(store).league.weeks, TODAY) },
  });
  engine.start();
  return { userId, handle, store, storage, engine };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------ the story */

describe('two accounts, one month', () => {
  /** Both of them, trained through June and July and signed in. */
  async function household(): Promise<{ backend: MemoryBackend; rotem: Person; yossi: Person }> {
    const backend = new MemoryBackend();
    const weeks = [...JUNE_WEEKS, ...JULY_WEEKS];
    const rotem = makePerson(
      'user-rotem',
      'rotem',
      backend,
      ROTEM_PLAN,
      sessionsFor(ROTEM_DAYS, weeks, '20', '10'),
    );
    // Yossi missed one of his three days in every July week.
    const yossi = makePerson(
      'user-yossi',
      'yossi',
      backend,
      YOSSI_PLAN,
      { ...sessionsFor(YOSSI_DAYS, JUNE_WEEKS, '100', '5'), ...sessionsFor(YOSSI_DAYS, JULY_WEEKS, '100', '5', 1) },
    );
    closeDueWeeks(rotem.store, NOW);
    closeDueWeeks(yossi.store, NOW);
    await rotem.engine.onSignedIn(rotem.userId);
    await yossi.engine.onSignedIn(yossi.userId);
    return { backend, rotem, yossi };
  }

  it('publishes both months and agrees, on both sides, about both totals', async () => {
    const { backend, rotem, yossi } = await household();

    /* 1. Two different plans, one scale. Rotem executed hers in full: four
          days of four, every set done, steady load → the coin week. Yossi
          skipped a day of three every week in July. */
    const mineR = monthlyScore(gameOf(rotem.store).league.weeks, JULY);
    const mineY = monthlyScore(gameOf(yossi.store).league.weeks, JULY);
    expect(mineR).toBeGreaterThan(mineY);
    expect(gameOf(rotem.store).league.months[JULY]?.weeks).toBe(4);

    /* 2. Their weeks are on the wire, and nothing else is. */
    expect(backend.leagueRows.size).toBe(16); // 4 July + 4 June weeks, each
    const wire = backend.wire();
    expect(wire).not.toContain('user-rotem');
    expect(wire).not.toContain('session_imported');
    expect(wire).not.toContain('a1'); // no exercise ever crosses
    // Their event logs stayed private and separate — a league row is NOT an event.
    expect(backend.eventsOf('user-rotem').length).toBeGreaterThan(0);
    expect(backend.eventsOf('user-rotem').some((e) => e.type === 'league_week_closed')).toBe(true);
    // …and the two logs share nothing at all: an account's weeks are its own.
    const yossiIds = new Set(backend.eventsOf('user-yossi').map((e) => e.id));
    expect(backend.eventsOf('user-rotem').some((e) => yossiIds.has(e.id))).toBe(false);
    expect(Object.keys(gameOf(yossi.store).league.weeks)).not.toContain('nothing-of-hers');

    /* 3. Each of them reads the other by NAME and gets the other's own number. */
    const rotemSeesYossi = await rotem.engine.loadLeagueMonth('yossi', JULY);
    const yossiSeesRotem = await yossi.engine.loadLeagueMonth('rotem', JULY);
    expect(rotemSeesYossi.stale).toBe(false);
    expect(rotemSeesYossi.month.monthlyScore).toBe(mineY);
    expect(yossiSeesRotem.month.monthlyScore).toBe(mineR);
    // …week by week, not just in total.
    expect(yossiSeesRotem.month.weeks).toEqual(
      Object.fromEntries(JULY_WEEKS.map((w) => [w, gameOf(rotem.store).league.weeks[w]])),
    );
    expect(yossiSeesRotem.month.coins).toBe(4);
    expect(yossiSeesRotem.month.rejected).toBe(0);

    /* …and the same rows, read straight off the table, total the same way. */
    expect(opponentMonth(await backend.fetchLeagueMonth('rotem', JULY), JULY).monthlyScore).toBe(mineR);

    /* 4. Who is winning is now a comparison of two numbers, and both of them
          compute the same comparison. */
    expect(yossiSeesRotem.month.monthlyScore > mineY).toBe(true);
    expect(rotemSeesYossi.month.monthlyScore < mineR).toBe(true);

    rotem.engine.dispose();
    yossi.engine.dispose();
  });

  it('cannot be beaten by a row that lies about its own arithmetic', async () => {
    const { backend, rotem, yossi } = await household();
    const honest = monthlyScore(gameOf(yossi.store).league.weeks, JULY);

    // Somebody writes a perfect month straight into the table under Yossi's
    // name — with components that do not add up to the scores it claims.
    for (const weekKey of JULY_WEEKS) {
      backend.leagueRows.set(`user-liar|${weekKey}`, {
        handle: 'yossi',
        week_key: weekKey,
        month_key: JULY,
        score: 100,
        c: 0.1,
        q: 0.1,
        l: 0.1,
        p: 0.1,
        coin: true,
        volume: 1e9,
        days: 7,
        prs: 9,
        updated_at: '2026-07-26T00:00:00.000Z',
      });
    }

    const view = await rotem.engine.loadLeagueMonth('yossi', JULY);
    expect(view.month.rejected).toBe(4);
    expect(view.month.monthlyScore).toBe(honest);
    rotem.engine.dispose();
    yossi.engine.dispose();
  });

  it('keeps what the coins were spent on private', async () => {
    const { backend, rotem, yossi } = await household();
    const before = backend.wire();

    // Rotem cashes a month in: a reward and a staked challenge. Both are real
    // events in HER log and both move HER purse…
    const reward = poolOfMonth(JULY).rewards[0];
    const challenge = poolOfMonth(JULY).challenges[0];
    if (!reward || !challenge) throw new Error('empty pool');
    const coinsBefore = gameOf(rotem.store).league.coins;
    expect(redeemLeagueReward(rotem.store, JULY, reward.id, NOW).ok).toBe(true);
    expect(setLeagueChallenge(rotem.store, JULY, challenge.id, NOW).ok).toBe(true);
    expect(gameOf(rotem.store).league.coins).toBeLessThan(coinsBefore);

    await rotem.engine.sync();

    // …and NOTHING about them is on the wire: there is no column for a
    // redemption, and there should never be one.
    expect(backend.wire()).toBe(before);
    expect(backend.wire()).not.toContain(reward.id);
    expect(backend.wire()).not.toContain(challenge.id);
    // Yossi sees her scores — the same ones as before she spent anything.
    const view = await yossi.engine.loadLeagueMonth('rotem', JULY);
    expect(view.month.monthlyScore).toBe(monthlyScore(gameOf(rotem.store).league.weeks, JULY));

    // Her spending IS in her own log and her own account, as an event.
    expect(backend.eventsOf('user-rotem').some((e) => e.type === 'league_reward_redeemed')).toBe(true);
    expect(backend.eventsOf('user-yossi').some((e) => e.type === 'league_reward_redeemed')).toBe(false);
    // And nothing of Rotem's ever entered Yossi's ledger.
    expect(Object.keys(gameOf(yossi.store).league.redemptions)).toEqual([]);
    rotem.engine.dispose();
    yossi.engine.dispose();
  });

  it('lets a second device of one account see the same opponent, offline', async () => {
    const { rotem, yossi } = await household();
    const mineR = monthlyScore(gameOf(rotem.store).league.weeks, JULY);

    // Yossi's phone reads Rotem's month once, then loses the network for a day.
    await yossi.engine.loadLeagueMonth('rotem', JULY);
    vi.setSystemTime(NOW.getTime() + DAY_MS);
    const cached = yossi.engine.getLeagueMonth('rotem', JULY);
    expect(cached.stale).toBe(true);
    expect(cached.fetchedAt).toBe(NOW.getTime());
    expect(cached.month.monthlyScore).toBe(mineR);
    // The screen has numbers and knows how old they are — never a zero.
    rotem.engine.dispose();
    yossi.engine.dispose();
  });
});
