/**
 * tests/league.test.ts — הליגה, from the formula to the ledgers.
 *
 * Six properties matter, and each has its own block below:
 *
 *   1. THE KEYS. A week is Sun–Sat and belongs to the month containing its
 *      SATURDAY, so the weeks of a year partition into months with none counted
 *      twice and none dropped — including the weeks that straddle a month.
 *   2. THE FORMULA. Every component is capped or clamped where it says it is,
 *      and the score is exactly `100 × (0.4C + 0.3Q + 0.2L + 0.1P)` of the
 *      ROUNDED components.
 *   3. FAIRNESS — the reason the feature exists. A 4-day-a-week trainee doing
 *      many light sets and a 3-day-a-week trainee doing few heavy ones both hit
 *      80 and both take the 🔵 when they execute their own plan; skipping a day
 *      costs each of them the share of their own week it was; a heroic week
 *      clamps; junk sets cannot push C or Q past 1.
 *   4. THE BASELINE. Median of the previous up-to-four NON-EMPTY weeks; a first
 *      week is neutral-good; a week that lifted nothing is a zero.
 *   5. THE LEDGERS. One grade and one 🔵 per week in EITHER merge order, one
 *      redemption per (month, item), one staked challenge per month, one
 *      completion per (month, challenge) — and every refusal happens BEFORE
 *      anything reaches the log.
 *   6. THE DEV RULE. A 🛠 grant can never move a league number, purged or not.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  baselineFor,
  buildLeagueChallengeComplete,
  buildLeagueChallengeSet,
  buildLeagueRedemption,
  buildWeekCloses,
  dueWeeks,
  isMonthKey,
  isWeekKey,
  leagueContext,
  liveWeek,
  loadScore,
  median,
  monthOfWeek,
  monthProgress,
  monthlyCoins,
  monthlyScore,
  regradedWeeks,
  weekClosedPayload,
  weekEndOf,
  weekKeyOf,
  weekScore,
  weeksOfMonth,
  type LeagueInput,
} from '../src/core/league.ts';
import {
  closeDueWeeks,
  completeLeagueChallenge,
  gameOf,
  leagueContextOf,
  redeemLeagueReward,
  setLeagueChallenge,
} from '../src/core/game.ts';
import { applyGameEvent, compareEvents, emptyGame, emptyLeague, finalizeLeague, rebuildGame } from '../src/core/xp.ts';
import { planToRecord } from '../src/core/plan.ts';
import {
  LEAGUE_POOLS,
  allLeagueItems,
  itemInMonth,
  leagueItemById,
  poolOfMonth,
  priceOf,
} from '../src/data/leaguePools.ts';
import { PLAN_DOC_VERSION, type PlanDoc, type PlanExercise } from '../src/data/planTypes.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { mergeIntoStore } from '../src/storage/merge.ts';
import { GAME_STATE_VERSION, type AppEvent, type GameState, type Session, type SetEntry } from '../src/storage/DataStore.ts';
import { makeEvent, normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

/* --------------------------------------------------------------- fixtures */

const DAY_MS = 86_400_000;

/** Every anchor below is a real Sunday (asserted in the first block). */
const W1 = '2026-06-07';
const W2 = '2026-06-14';
const W3 = '2026-06-21';
const W4 = '2026-06-28';
const W5 = '2026-07-05';
/** A Monday inside W6 — "today" for most scenarios, so W1…W5 are all closed. */
const TODAY = '2026-07-13';

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

function set(w: string, r: string, done = true): SetEntry {
  return { w, r, done };
}

/** A session: `ids` exercises × `sets` completed sets each, all at `w × r`. */
function session(day: string, ids: readonly string[], sets: number, w: string, r: string): Session {
  const ex: Record<string, (SetEntry | null)[]> = {};
  for (const id of ids) ex[id] = Array.from({ length: sets }, () => set(w, r));
  return { day, ex };
}

function rows(ids: readonly string[], sets: number): PlanExercise[] {
  return ids.map((id) => ({ id, sets, reps: '8–10', rest: 90 }));
}

function planOf(
  days: ReadonlyArray<{ key: string; label: string; weekdays: number[]; ids: readonly string[]; sets: number }>,
  weeklyTarget: number,
): PlanDoc {
  return {
    version: PLAN_DOC_VERSION,
    rev: 1,
    days: days.map((d) => ({ key: d.key, label: d.label, weekdays: d.weekdays, exercises: rows(d.ids, d.sets) })),
    weeklyTarget,
    customExercises: [],
  };
}

function planEvent(plan: PlanDoc, ts: number, id: string): AppEvent {
  return { id, ts, type: 'plan_updated', payload: { plan: planToRecord(plan), revision: plan.rev, date: '2026-01-01' } };
}

function prEvent(date: string, exId: string, setIndex: number, extra: Record<string, unknown> = {}): AppEvent {
  return {
    id: `pr-${date}-${exId}-${String(setIndex)}`,
    ts: tsOf(date),
    type: 'pr_achieved',
    payload: { date, exId, setIndex, volume: 100, previousBest: 50, retro: false, ...extra },
  };
}

/* ---- PLAYER A: four days a week, three exercises × four sets, light ------ */

const A_DAYS = [
  { key: 'A', label: 'א', weekdays: [0], ids: ['a1', 'a2', 'a3'], sets: 4 },
  { key: 'B', label: 'ב', weekdays: [1], ids: ['b1', 'b2', 'b3'], sets: 4 },
  { key: 'C', label: 'ג', weekdays: [2], ids: ['c1', 'c2', 'c3'], sets: 4 },
  { key: 'd_d', label: 'ד', weekdays: [3], ids: ['x1', 'x2', 'x3'], sets: 4 },
];
const PLAN_A = planOf(A_DAYS, 4);
/** 12 planned sets a day × 4 days. */
const A_PLANNED_DAY = 12;
/** 20 kg × 10 reps = 200 volume points per set → 2,400 a day, 9,600 a week. */
const A_WEEK_VOLUME = 9600;

/* ---- PLAYER B: three days a week, two exercises × five sets, heavy ------- */

const B_DAYS = [
  { key: 'A', label: 'א', weekdays: [0], ids: ['a1', 'a2'], sets: 5 },
  { key: 'B', label: 'ב', weekdays: [2], ids: ['b1', 'b2'], sets: 5 },
  { key: 'C', label: 'ג', weekdays: [4], ids: ['c1', 'c2'], sets: 5 },
];
const PLAN_B = planOf(B_DAYS, 3);
/** 100 kg × 5 reps = 500 volume points per set → 5,000 a day, 15,000 a week. */
const B_WEEK_VOLUME = 15_000;

/** A's week: `days` of its four training days, `factor`× the usual set count. */
function weekA(
  sessions: Record<string, Session>,
  weekStart: string,
  days = 4,
  factor = 1,
  w = '20',
): Record<string, Session> {
  for (let i = 0; i < days; i += 1) {
    const day = A_DAYS[i] as (typeof A_DAYS)[number];
    sessions[iso(weekStart, i)] = session(day.key, day.ids, day.sets * factor, w, '10');
  }
  return sessions;
}

/** B's week: `days` of its three training days (Sun / Tue / Thu). */
function weekB(
  sessions: Record<string, Session>,
  weekStart: string,
  days = 3,
  factor = 1,
  w = '100',
): Record<string, Session> {
  for (let i = 0; i < days; i += 1) {
    const day = B_DAYS[i] as (typeof B_DAYS)[number];
    sessions[iso(weekStart, i * 2)] = session(day.key, day.ids, day.sets * factor, w, '5');
  }
  return sessions;
}

function inputOf(sessions: Record<string, Session>, plan: PlanDoc | null, extra: readonly AppEvent[] = []): LeagueInput {
  const events: AppEvent[] = [...extra];
  if (plan) events.push(planEvent(plan, Date.parse('2026-01-01T00:00:00.000Z'), 'plan-0'));
  return { sessions, events };
}

/** A steady five-week history for one player, graded on its LAST week. */
function steady(who: 'A' | 'B', lastWeek: Partial<{ days: number; factor: number; w: string }> = {}) {
  const sessions: Record<string, Session> = {};
  const fill = who === 'A' ? weekA : weekB;
  for (const week of [W1, W2, W3, W4]) fill(sessions, week);
  fill(sessions, W5, lastWeek.days ?? (who === 'A' ? 4 : 3), lastWeek.factor ?? 1, lastWeek.w ?? (who === 'A' ? '20' : '100'));
  const ctx = leagueContext(inputOf(sessions, who === 'A' ? PLAN_A : PLAN_B));
  return { sessions, ctx, score: weekScore(ctx, W5) };
}

/* ============================================================ 1. the keys */

describe('week and month keys — Sun–Sat weeks, months owned by the SATURDAY', () => {
  it('anchors every week on its Sunday', () => {
    for (const week of [W1, W2, W3, W4, W5]) {
      expect(isWeekKey(week)).toBe(true);
      expect(weekKeyOf(week)).toBe(week);
    }
    // …and every day of a week maps back to that same Sunday.
    for (let i = 0; i < 7; i += 1) expect(weekKeyOf(iso(W1, i))).toBe(W1);
    expect(weekKeyOf(iso(W1, 7))).toBe(W2);
    expect(weekEndOf(W1)).toBe('2026-06-13');
  });

  it('refuses a key that is not a real Sunday', () => {
    expect(isWeekKey('2026-06-08')).toBe(false); // a Monday
    expect(isWeekKey('2026-06')).toBe(false);
    expect(isWeekKey('nonsense')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-08')).toBe(true);
  });

  it('gives a straddling week to the month its SATURDAY falls in', () => {
    // 2026-08-30 (Sun) … 2026-09-05 (Sat) — five days in August, and it is a
    // September week, because the Saturday decides.
    expect(monthOfWeek('2026-08-30')).toBe('2026-09');
    expect(monthOfWeek('2026-08-23')).toBe('2026-08');
    // The other direction: a week that STARTS in the previous month.
    expect(monthOfWeek('2026-05-31')).toBe('2026-06');
  });

  it('partitions a year: every week belongs to exactly one month', () => {
    const seen = new Set<string>();
    let weeks = 0;
    for (let m = 1; m <= 12; m += 1) {
      const monthKey = `2026-${String(m).padStart(2, '0')}`;
      const list = weeksOfMonth(monthKey);
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(5);
      for (const week of list) {
        expect(monthOfWeek(week)).toBe(monthKey);
        expect(seen.has(week)).toBe(false);
        seen.add(week);
        weeks += 1;
      }
    }
    // 52 Saturdays in 2026, so 52 weeks — no gaps, no doubles.
    expect(weeks).toBe(52);
    expect(weeksOfMonth('2026-13')).toEqual([]);
  });
});

/* ========================================================= 2. the formula */

describe('the formula — every component capped or clamped where it says', () => {
  it('C is training days ÷ the weekly target IN FORCE, capped at 1', () => {
    // Three of four days: 0.75. Four of four: 1. Five (a bonus day): still 1.
    const three = weekScore(leagueContext(inputOf(weekA({}, W1, 3), PLAN_A)), W1);
    expect(three.target).toBe(4);
    expect(three.c).toBe(0.75);

    const four = weekScore(leagueContext(inputOf(weekA({}, W1, 4), PLAN_A)), W1);
    expect(four.c).toBe(1);

    const sessions = weekA({}, W1, 4);
    sessions[iso(W1, 4)] = session('A', ['a1'], 2, '20', '10'); // a fifth day
    expect(weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1).c).toBe(1);
  });

  it('C falls back to the built-in target when no plan was ever saved', () => {
    const score = weekScore(leagueContext(inputOf(weekA({}, W1, 3), null)), W1);
    expect(score.target).toBe(BALANCE.streak.daysPerWeek);
    expect(score.c).toBe(1); // three days, built-in target of three
  });

  it('Q counts only the days TRAINED, and cannot exceed 1', () => {
    // One day trained, half of it done: 6 of 12 planned, not 6 of 48.
    const sessions = { [W1]: session('A', ['a1', 'a2', 'a3'], 2, '20', '10') };
    const one = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1);
    expect(one.plannedSets).toBe(A_PLANNED_DAY);
    expect(one.completedSets).toBe(6);
    expect(one.q).toBe(0.5);

    // Twice the sets the plan asked for is still 1 — junk sets buy nothing.
    const double = weekScore(leagueContext(inputOf(weekA({}, W1, 4, 2), PLAN_A)), W1);
    expect(double.completedSets).toBe(96);
    expect(double.plannedSets).toBe(48);
    expect(double.q).toBe(1);
  });

  it('grades each trained day by the plan in force AT THAT DATE', () => {
    // Wednesday of W1 the plan shrinks day A from 12 planned sets to 6.
    const shrunk = planOf([{ key: 'A', label: 'א', weekdays: [0], ids: ['a1', 'a2'], sets: 3 }], 2);
    const events = [
      planEvent(PLAN_A, Date.parse('2026-01-01T00:00:00.000Z'), 'plan-0'),
      planEvent(shrunk, tsOf(iso(W1, 3)), 'plan-1'),
    ];
    const sessions = {
      [iso(W1, 0)]: session('A', ['a1', 'a2', 'a3'], 2, '20', '10'), // 6 of the OLD 12
      [iso(W1, 4)]: session('A', ['a1', 'a2'], 3, '20', '10'), //       6 of the NEW 6
    };
    const score = weekScore(leagueContext({ sessions, events }), W1);
    expect(score.plannedSets).toBe(A_PLANNED_DAY + 6);
    expect(score.completedSets).toBe(12);
    expect(score.q).toBe(0.67);
    // …and C is judged by the target the plan had when the week ENDED.
    expect(score.target).toBe(2);
  });

  it('grades a day the plan no longer describes against what was done', () => {
    // A day key nothing resolves cannot say how many sets it wanted, so it is
    // neither rewarded nor punished: planned === completed for that day.
    const sessions = { [W1]: session('d_gone', ['a1'], 3, '20', '10') };
    const score = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1);
    expect(score.plannedSets).toBe(3);
    expect(score.q).toBe(1);
  });

  it('L clamps the ratio to ±50% and rescales it onto 0…1', () => {
    expect(loadScore(0, 1000)).toBe(0); // nothing lifted is never neutral
    expect(loadScore(500, 1000)).toBe(0); // exactly at the floor
    expect(loadScore(100, 1000)).toBe(0); // far below it — clamped
    expect(loadScore(1000, 1000)).toBe(0.5); // exactly on your own baseline
    expect(loadScore(1250, 1000)).toBe(0.75);
    expect(loadScore(1500, 1000)).toBe(1);
    expect(loadScore(9000, 1000)).toBe(1); // a heroic week is still just 1
    expect(loadScore(1000, 0)).toBe(BALANCE.league.loadNeutral); // no history
  });

  it('P saturates at three PRs', () => {
    const sessions = weekA({}, W1, 4);
    const pr = (n: number): AppEvent[] =>
      Array.from({ length: n }, (_, i) => prEvent(iso(W1, 0), 'a1', i));
    expect(weekScore(leagueContext(inputOf(sessions, PLAN_A, pr(0))), W1).p).toBe(0);
    expect(weekScore(leagueContext(inputOf(sessions, PLAN_A, pr(1))), W1).p).toBe(0.33);
    expect(weekScore(leagueContext(inputOf(sessions, PLAN_A, pr(3))), W1).p).toBe(1);
    const five = weekScore(leagueContext(inputOf(sessions, PLAN_A, pr(5))), W1);
    expect(five.prs).toBe(5); // the ledger records what happened…
    expect(five.p).toBe(1); //  …and the component still caps
  });

  it('counts a duplicated PR once, exactly like the game ledger does', () => {
    const sessions = weekA({}, W1, 4);
    const one = prEvent(iso(W1, 0), 'a1', 0);
    const twin: AppEvent = { ...one, id: 'other-device', ts: one.ts + 5 };
    expect(weekScore(leagueContext(inputOf(sessions, PLAN_A, [one, twin])), W1).prs).toBe(1);
  });

  it('scores exactly 100 × (0.4C + 0.3Q + 0.2L + 0.1P) of the STORED components', () => {
    const { score } = steady('A');
    const w = BALANCE.league.weights;
    expect(w.consistency + w.completion + w.load + w.prs).toBeCloseTo(1, 10);
    const expected =
      Math.round(
        100 * (w.consistency * score.c + w.completion * score.q + w.load * score.l + w.prs * score.p) * 10,
      ) / 10;
    expect(score.score).toBe(expected);
  });

  it('is a flat zero for a week with no training at all', () => {
    const score = weekScore(leagueContext(inputOf({}, PLAN_A)), W1);
    expect(score).toMatchObject({ c: 0, q: 0, l: 0, p: 0, score: 0, coin: false, days: 0, volume: 0 });
  });
});

/* ======================================================== 3. the fairness */

describe('fairness — A (4 light days) against B (3 heavy days)', () => {
  it('pays both the same score and both the 🔵 for a plan fully executed', () => {
    const a = steady('A').score;
    const b = steady('B').score;

    expect(a.days).toBe(4);
    expect(a.completedSets).toBe(48);
    expect(a.volume).toBe(A_WEEK_VOLUME);
    expect(b.days).toBe(3);
    expect(b.completedSets).toBe(30);
    expect(b.volume).toBe(B_WEEK_VOLUME);

    // Four times the sets and two thirds of the volume — and the SAME grade,
    // because every component is a ratio against that player's own plan.
    expect(a.c).toBe(1);
    expect(b.c).toBe(1);
    expect(a.q).toBe(1);
    expect(b.q).toBe(1);
    expect(a.l).toBe(0.5);
    expect(b.l).toBe(0.5);
    expect(a.score).toBe(80);
    expect(b.score).toBe(80);
    expect(a.coin).toBe(true);
    expect(b.coin).toBe(true);
  });

  it('charges each of them the share of their own week a skipped day was', () => {
    const a = steady('A', { days: 3 }).score; // 3 of 4
    const b = steady('B', { days: 2 }).score; // 2 of 3

    expect(a.c).toBe(0.75);
    expect(b.c).toBe(0.67);
    // The load drops by the same share, self-relative for each of them.
    expect(a.l).toBe(0.25);
    expect(b.l).toBe(0.17);
    expect(a.score).toBe(65);
    expect(b.score).toBe(60.2);
    // Neither is punished for the shape of their plan: the two penalties stay
    // within a handful of points of each other.
    expect(Math.abs(a.score - b.score)).toBeLessThanOrEqual(6);
    // And neither takes the coin — the week was not complete.
    expect(a.coin).toBe(false);
    expect(b.coin).toBe(false);
  });

  it('clamps a heroic week: doubling the weight buys ten points, not fifty', () => {
    const normal = steady('B').score;
    const heroic = steady('B', { w: '200' }).score;
    expect(heroic.volume).toBe(B_WEEK_VOLUME * 2);
    expect(heroic.l).toBe(1); // ratio 2.0, clamped to 1.5, rescaled to 1
    expect(heroic.score - normal.score).toBe(10);
  });

  it('clamps junk sets too: C and Q cannot pass 1, and L is self-relative', () => {
    const normal = steady('A').score;
    const junk = steady('A', { factor: 2 }).score; // twice the sets, same weights
    expect(junk.c).toBe(1);
    expect(junk.q).toBe(1);
    expect(junk.l).toBe(1);
    expect(junk.score - normal.score).toBe(10);
    expect(junk.score).toBe(90);

    // SELF-RELATIVE: keep it up for four weeks and the baseline has moved, so
    // the same doubled week is worth exactly what an ordinary week used to be.
    const sessions: Record<string, Session> = {};
    for (const week of [W1, W2, W3, W4, W5]) weekA(sessions, week, 4, 2);
    const sustained = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W5);
    expect(sustained.baseline).toBe(A_WEEK_VOLUME * 2);
    expect(sustained.l).toBe(0.5);
    expect(sustained.score).toBe(80);
  });
});

/* ======================================================== 4. the baseline */

describe('the rolling baseline — the median of up to four non-empty weeks', () => {
  it('is the median, so one spike barely moves it', () => {
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([10, 1, 3, 2])).toBe(2.5); // order-independent
  });

  it('scores a first week as neutral-good — there is nothing to compare to', () => {
    const first = weekScore(leagueContext(inputOf(weekA({}, W1), PLAN_A)), W1);
    expect(first.baseline).toBe(0);
    expect(first.l).toBe(BALANCE.league.loadNeutral);
    expect(first.score).toBe(85); // 40 + 30 + 15
    expect(first.coin).toBe(true);
  });

  it('uses one, two or three prior weeks when that is all there is', () => {
    const build = (weights: readonly string[]): number => {
      const sessions: Record<string, Session> = {};
      weights.forEach((w, i) => weekA(sessions, [W1, W2, W3, W4][i] as string, 4, 1, w));
      weekA(sessions, W5);
      return weekScore(leagueContext(inputOf(sessions, PLAN_A)), W5).baseline;
    };
    expect(build(['10'])).toBe(A_WEEK_VOLUME / 2); // one prior week IS the median
    expect(build(['10', '30'])).toBe(A_WEEK_VOLUME); // median of 4,800 and 14,400
    expect(build(['10', '20', '30'])).toBe(A_WEEK_VOLUME); // the middle of three
  });

  it('never reaches back past four non-empty weeks', () => {
    // Five prior weeks; the FIRST (a huge one) must fall out of the window.
    const sessions: Record<string, Session> = {};
    weekA(sessions, '2026-05-31', 4, 1, '200');
    for (const week of [W1, W2, W3, W4]) weekA(sessions, week);
    weekA(sessions, W5);
    const score = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W5);
    expect(BALANCE.league.baselineWeeks).toBe(4);
    expect(score.baseline).toBe(A_WEEK_VOLUME);
  });

  it('skips EMPTY weeks rather than counting them as zeroes', () => {
    // Two trained weeks with a fortnight of nothing between them: the baseline
    // is the median of the two real weeks, not dragged to zero by the holiday.
    const sessions: Record<string, Session> = {};
    weekA(sessions, W1, 4, 1, '10');
    weekA(sessions, W2, 4, 1, '30');
    weekA(sessions, W5);
    const ctx = leagueContext(inputOf(sessions, PLAN_A));
    expect(weekScore(ctx, W3).days).toBe(0);
    expect(ctx.loaded).toEqual([W1, W2, W5]);
    expect(baselineFor(ctx, W5)).toBe(A_WEEK_VOLUME); // median(4,800, 14,400)
  });
});

/* ========================================================== 5. the ledger */

describe('closing a week — lazy, bounded and idempotent', () => {
  const league = () => emptyLeague();

  it('lists every finished, unclosed week since the first session', () => {
    const ctx = leagueContext(inputOf(weekA(weekA({}, W1), W3), PLAN_A));
    expect(dueWeeks(ctx, league(), TODAY)).toEqual([W1, W2, W3, W4, W5]);
  });

  it('never grades the week in progress', () => {
    const sessions = weekA({}, weekKeyOf(TODAY), 2);
    const ctx = leagueContext(inputOf(sessions, PLAN_A));
    expect(dueWeeks(ctx, league(), TODAY)).toEqual([]);
    // …but it IS gradable live, which is what the UI stage will draw.
    expect(liveWeek(ctx, TODAY).days).toBe(2);
    expect(liveWeek(ctx, TODAY).weekKey).toBe(weekKeyOf(TODAY));
  });

  it('closes empty weeks too, so the ledger has no holes', () => {
    const ctx = leagueContext(inputOf(weekA({}, W1), PLAN_A));
    const due = dueWeeks(ctx, league(), TODAY);
    expect(due).toEqual([W1, W2, W3, W4, W5]);
    expect(weekScore(ctx, W3).score).toBe(0);
  });

  it('reaches back at most the backfill cap', () => {
    const sessions = weekA({}, '2024-01-07'); // ~2.5 years before TODAY
    const ctx = leagueContext(inputOf(sessions, PLAN_A));
    const due = dueWeeks(ctx, league(), TODAY);
    expect(BALANCE.league.backfillWeeks).toBe(26);
    expect(due.length).toBe(26);
    expect(due[0]).toBe(iso(weekKeyOf(TODAY), -7 * 26));
    expect(due[due.length - 1]).toBe(iso(weekKeyOf(TODAY), -7));
  });

  it('writes nothing at all when there is no history', () => {
    expect(buildWeekCloses(inputOf({}, PLAN_A), league(), TODAY, 1)).toEqual([]);
  });

  it('is idempotent per week: a duplicate close mints no second 🔵', () => {
    const { ctx } = steady('A');
    const payload = weekClosedPayload(weekScore(ctx, W5), TODAY);
    expect(payload.coin).toBe(true);

    const game = emptyGame();
    applyGameEvent(game, 'league_week_closed', payload);
    applyGameEvent(game, 'league_week_closed', { ...payload, score: 3 }); // a liar
    finalizeLeague(game.league);

    expect(Object.keys(game.league.weeks)).toEqual([W5]);
    expect(game.league.weeks[W5]?.score).toBe(80);
    expect(game.league.coins).toBe(1);
    expect(game.league.coinsEarned).toBe(1);
  });

  it('converges on ONE coin in either merge order', () => {
    const { ctx } = steady('A');
    const payload = weekClosedPayload(weekScore(ctx, W5), TODAY);
    // Two devices, two uuids, two clocks — the same week and the same grade.
    const one = makeEvent('league_week_closed', { ...payload }, tsOf(TODAY));
    const two = makeEvent('league_week_closed', { ...payload }, tsOf(TODAY) + 60_000);

    const forward = rebuildGame([one, two], TODAY).league;
    const backward = rebuildGame([two, one], TODAY).league;
    expect(forward).toEqual(backward);
    expect(forward.coins).toBe(1);
    expect(Object.keys(forward.weeks)).toEqual([W5]);
    // The (ts, id) order decides which event lands, and it is the same order on
    // both devices because it is a property of the event SET.
    expect([one, two].sort(compareEvents)[0]).toBe(one);
  });

  it('rejects a weekKey that is not a real Sunday, or a junk month key', () => {
    const game = emptyGame();
    applyGameEvent(game, 'league_week_closed', { weekKey: '2026-07-06', score: 99, coin: true });
    applyGameEvent(game, 'league_week_closed', { weekKey: 'ha', score: 99, coin: true });
    applyGameEvent(game, 'league_reward_redeemed', { month: '2026-13', itemId: 'gift_01_1', cost: 3 });
    finalizeLeague(game.league);
    expect(game.league.weeks).toEqual({});
    expect(game.league.redemptions).toEqual({});
    expect(game.league.coins).toBe(0);
  });

  it('clamps what a crafted close claims', () => {
    const game = emptyGame();
    applyGameEvent(game, 'league_week_closed', {
      weekKey: W1,
      score: 10_000,
      c: 9,
      q: -4,
      l: 3,
      p: 7,
      coin: true,
      volume: -12,
      days: 99.7,
      prs: -3,
    });
    expect(game.league.weeks[W1]).toEqual({
      score: 100,
      c: 1,
      q: 0,
      l: 1,
      p: 1,
      coin: true,
      volume: 0,
      days: 99,
      prs: 0,
    });
  });
});

describe('the months — a sum of weeks, and a live total', () => {
  it('sums a month from the weeks whose Saturday it owns', () => {
    const game = emptyGame();
    for (const [week, score] of [
      [W2, 80],
      [W3, 60],
      [W5, 100],
    ] as const) {
      applyGameEvent(game, 'league_week_closed', { weekKey: week, score, c: 1, q: 1, coin: true });
    }
    finalizeLeague(game.league);

    expect(monthlyScore(game.league.weeks, '2026-06')).toBe(140); // W2 + W3
    expect(monthlyScore(game.league.weeks, '2026-07')).toBe(100); // W5
    expect(monthlyCoins(game.league.weeks, '2026-06')).toBe(2);
    expect(game.league.months['2026-06']).toEqual({ month: '2026-06', score: 140, weeks: 2, coins: 2 });
    expect(game.league.months['2026-07']).toEqual({ month: '2026-07', score: 100, weeks: 1, coins: 1 });
    expect(game.league.coins).toBe(3);
  });

  it('adds the week in progress to the month it is going to land in', () => {
    const { ctx } = steady('A');
    const game = emptyGame();
    applyGameEvent(game, 'league_week_closed', { weekKey: W5, score: 80, c: 1, q: 1, coin: true });
    finalizeLeague(game.league);

    // W5's Saturday is 2026-07-11, so it is a July week; "today" is in W6.
    const now = monthProgress(ctx, game.league, TODAY);
    expect(now.month).toBe('2026-07');
    expect(now.closed).toBe(80);
    expect(now.live).toBe(now.liveWeek.score);
    expect(now.total).toBe(80 + now.liveWeek.score);
    expect(now.coins).toBe(1);
  });
});

describe('the 🔵 rule — a complete week, honestly done', () => {
  it('needs C = 1 — every planned day, no exceptions', () => {
    expect(BALANCE.league.coinConsistency).toBe(1);
    expect(weekScore(leagueContext(inputOf(weekA({}, W1, 3), PLAN_A)), W1).coin).toBe(false);
    expect(weekScore(leagueContext(inputOf(weekA({}, W1, 4), PLAN_A)), W1).coin).toBe(true);
  });

  it('needs Q ≥ 0.8 — most of the sets, not merely turning up', () => {
    // Four days, but only 9 of the 12 sets each: C = 1, Q = 0.75.
    const sessions: Record<string, Session> = {};
    for (let i = 0; i < 4; i += 1) {
      const day = A_DAYS[i] as (typeof A_DAYS)[number];
      sessions[iso(W1, i)] = session(day.key, day.ids, 3, '20', '10');
    }
    const short = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1);
    expect(short.c).toBe(1);
    expect(short.q).toBe(0.75);
    expect(short.coin).toBe(false);
    expect(BALANCE.league.coinCompletion).toBe(0.8);

    // One more set on one day takes Q to 0.77… still short; two days do it.
    for (let i = 0; i < 2; i += 1) {
      const day = A_DAYS[i] as (typeof A_DAYS)[number];
      sessions[iso(W1, i)] = session(day.key, day.ids, 4, '20', '10');
    }
    const enough = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1);
    expect(enough.q).toBe(0.88);
    expect(enough.coin).toBe(true);
  });
});

/* ============================== 5b. the best-grade ledger and the self-heal */

/**
 * THE BUG THIS BLOCK EXISTS FOR — reported from a real pair of phones.
 *
 * A phone signs into an account that already holds a year of training in the
 * cloud. `closeDueWeeks` runs at BOOT, synchronously, from the LOCAL log — which
 * at that instant holds almost nothing, because the first pull has not landed
 * yet. So it grades the finished weeks from data it cannot see, files 55s with
 * no 🔵 for weeks that were trained in full… and under the first-in-`(ts, id)`
 * ledger that shipped, those grades were PERMANENT: the sessions arrived
 * seconds later and nothing in the system was able to act on them, on any
 * device, ever.
 *
 * The fix is two halves, and both are here: the ledger accepts a BETTER grade
 * for a week it already holds, and `closeDueWeeks` appends one when the log now
 * grades a closed week higher than the ledger does.
 */
describe('a week graded from half a log — the fresh-device repro', () => {
  const NOW = new Date(Date.parse(`${TODAY}T12:00:00.000Z`));
  /** A boot the next morning: the same week, a later clock. */
  const LATER = new Date(Date.parse(`${TODAY}T21:00:00.000Z`));

  /** Everything the ACCOUNT holds — five full weeks of player A. */
  function accountEvents(): AppEvent[] {
    const { sessions } = steady('A');
    const events: AppEvent[] = [planEvent(PLAN_A, Date.parse('2026-01-01T00:00:00.000Z'), 'plan-0')];
    for (const date of Object.keys(sessions).sort()) {
      const s = sessions[date] as Session;
      events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
    }
    return events;
  }

  /**
   * The fresh phone, mid-sign-in: one day of the last week is all it has.
   * (An entirely empty log closes NOTHING — `dueWeeks` needs a first session —
   * so the damaging case is precisely the partially-filled one.)
   */
  function freshDevice(): LocalStore {
    const sessions: Record<string, Session> = {};
    const day = A_DAYS[0] as (typeof A_DAYS)[number];
    sessions[iso(W5, 0)] = session(day.key, day.ids, day.sets, '20', '10');
    return storeWith(sessions, PLAN_A);
  }

  it('files a grade the log cannot support, and then corrects it when the pull lands', () => {
    const phone = freshDevice();

    // 1. THE POISONED CLOSE. One day of four, no history to measure load
    //    against: 55 points and no coin, for a week that was trained in full.
    const boot = closeDueWeeks(phone, NOW);
    expect(boot.closed).toEqual([W5]);
    expect(boot.regraded).toEqual([]);
    expect(gameOf(phone).league.weeks[W5]).toMatchObject({ score: 55, c: 0.25, coin: false });
    expect(gameOf(phone).league.coins).toBe(0);

    // 2. THE PULL LANDS. The account's whole history merges in — and the
    //    ledger, on its own, still says 55: a grade is a filed fact, not a
    //    recomputation, which is exactly why the close must be re-run.
    mergeIntoStore(phone, accountEvents(), NOW.getTime());
    expect(gameOf(phone).league.weeks[W5]?.score).toBe(55);

    // 3. THE NEXT CLOSE HEALS IT. W1…W4 are due for the first time, and W5 is
    //    re-graded because the log now says more about it than the ledger does.
    const healed = closeDueWeeks(phone, LATER);
    expect(healed.closed).toEqual([W1, W2, W3, W4, W5]);
    expect(healed.regraded).toEqual([W5]);
    expect(gameOf(phone).league.weeks[W5]).toMatchObject({ score: 80, c: 1, q: 1, coin: true });
    expect(gameOf(phone).league.coins).toBe(5);

    // 4. AND IT AGREES, WEEK FOR WEEK AND COIN FOR COIN, with the device that
    //    never lost anything — which is the whole point of a convergent ledger.
    const clean = storeWith(steady('A').sessions, PLAN_A);
    closeDueWeeks(clean, NOW);
    expect(gameOf(phone).league.weeks).toEqual(gameOf(clean).league.weeks);
    expect(gameOf(phone).league.coins).toBe(gameOf(clean).league.coins);

    // 5. Running it again writes nothing: the ledger now equals the recompute.
    const before = phone.getEvents().length;
    expect(closeDueWeeks(phone, LATER).closed).toEqual([]);
    expect(phone.getEvents().length).toBe(before);
  });

  it('converges on the better grade in EITHER merge order, and mints one 🔵', () => {
    const phone = freshDevice();
    closeDueWeeks(phone, NOW);
    mergeIntoStore(phone, accountEvents(), NOW.getTime());
    closeDueWeeks(phone, LATER);

    const log = phone.getEvents();
    expect(log.filter((e) => e.type === 'league_week_closed' && e.payload['weekKey'] === W5)).toHaveLength(2);

    const forward = rebuildGame(log, TODAY).league;
    const backward = rebuildGame([...log].reverse(), TODAY).league;
    expect(forward).toEqual(backward);
    expect(forward.weeks[W5]?.score).toBe(80);
    // TWO closes of one week, ONE coin: the purse is derived from the ledger,
    // and the ledger holds one record per week however many closes it saw.
    expect(forward.weeks[W5]?.coin).toBe(true);
    expect(forward.coins).toBe(5);
  });

  it('refuses a downgrade — a pruned log can never erase a 🔵 somebody earned', () => {
    const { ctx } = steady('A');
    const honest = weekClosedPayload(weekScore(ctx, W5), TODAY);
    const game = emptyGame();
    applyGameEvent(game, 'league_week_closed', honest);
    // A second device, holding half the log, closes the same week at 55.
    applyGameEvent(game, 'league_week_closed', { ...honest, score: 55, c: 0.25, coin: false });
    finalizeLeague(game.league);
    expect(game.league.weeks[W5]).toMatchObject({ score: 80, coin: true });
    expect(game.league.coins).toBe(1);

    // …and the same pair in the other order lands on the same record.
    const poor = makeEvent('league_week_closed', { ...honest, score: 55, c: 0.25, coin: false }, tsOf(TODAY));
    const good = makeEvent('league_week_closed', honest, tsOf(TODAY) + 60_000);
    expect(rebuildGame([poor, good], TODAY).league).toEqual(rebuildGame([good, poor], TODAY).league);
    expect(rebuildGame([poor, good], TODAY).league.weeks[W5]?.score).toBe(80);
  });

  it('keeps the EARLIER event when two closes tie, so the fold is a max over (score, ts, id)', () => {
    const { ctx } = steady('A');
    const payload = weekClosedPayload(weekScore(ctx, W5), TODAY);
    // Same score, different content (a hand-edited days count) — the tie is
    // broken by the log's own total order, which both devices agree on.
    const first = makeEvent('league_week_closed', { ...payload, days: 4 }, tsOf(TODAY));
    const second = makeEvent('league_week_closed', { ...payload, days: 9 }, tsOf(TODAY) + 1);
    expect(rebuildGame([first, second], TODAY).league.weeks[W5]?.days).toBe(4);
    expect(rebuildGame([second, first], TODAY).league.weeks[W5]?.days).toBe(4);
  });

  it('lists only the weeks the log now grades HIGHER', () => {
    const { sessions, ctx } = steady('A');
    const closed = emptyLeague();
    // A ledger that already holds the truth about W5 and a lie about W4.
    closed.weeks[W5] = { ...weekScore(ctx, W5) };
    closed.weeks[W4] = { ...weekScore(ctx, W4), score: 12, c: 0.25, coin: false };
    const full = leagueContext(inputOf(sessions, PLAN_A));
    expect(regradedWeeks(full, closed, TODAY)).toEqual([W4]);

    // Nothing to say about a ledger that matches the log…
    closed.weeks[W4] = { ...weekScore(ctx, W4) };
    expect(regradedWeeks(full, closed, TODAY)).toEqual([]);
    // …and nothing at all when the log has no sessions to grade from.
    expect(regradedWeeks(leagueContext(inputOf({}, PLAN_A)), closed, TODAY)).toEqual([]);
  });

  it('rehydrates the PURSE from the ledger on a boot that folds no event', () => {
    // The other half of the reported screenshot: the race table drew the week
    // straight from the ledger — 80 and its 🔵, correctly — while the header
    // said "🔵 0" and the history list was empty. `normalizeGame` deliberately
    // hands every DERIVED field back at zero (a hand-edited blob may not claim
    // a purse its ledgers do not support) and nothing on the quiet boot path
    // derived them again, so the screen contradicted itself until the next
    // event was folded.
    const storage = fakeStorage();
    const events: AppEvent[] = [planEvent(PLAN_A, Date.parse('2026-01-01T00:00:00.000Z'), 'plan-0')];
    for (const [date, s] of Object.entries(steady('A').sessions).sort()) {
      events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
    }
    const first = new LocalStore(storage);
    first.replaceAll(rebuildFromEvents(events, tsOf(TODAY)), events);
    closeDueWeeks(first, NOW);
    expect(gameOf(first).league.coins).toBe(5);

    // A reboot: same storage, nothing folded, no event written.
    const rebooted = new LocalStore(storage, NOW.getTime());
    const league = gameOf(rebooted).league;
    expect(league.weeks[W5]).toMatchObject({ score: 80, coin: true });
    expect(league.coins).toBe(5);
    expect(league.coinsEarned).toBe(5);
    expect(Object.keys(league.months)).toEqual(['2026-06', '2026-07']);
  });
});

/* ================================================ 6. spending the coins */

/** A game with `n` 🔵 in the purse, minted by that many closed weeks. */
function purse(n: number): GameState {
  const game = emptyGame();
  const weeks = [W1, W2, W3, W4, W5, '2026-07-12', '2026-07-19'];
  for (let i = 0; i < n; i += 1) {
    applyGameEvent(game, 'league_week_closed', { weekKey: weeks[i], score: 80, c: 1, q: 1, coin: true });
  }
  finalizeLeague(game.league);
  return game;
}

describe('redeeming — once per (month, item), and never on credit', () => {
  const MONTH = '2026-07';
  const GIFT = poolOfMonth(MONTH).rewards[0]!.id;
  const EXPERIENCE = poolOfMonth(MONTH).rewards.find((i) => i.kind === 'experience')!.id;

  it('charges the pool price and marks the item redeemed', () => {
    const game = purse(5);
    expect(game.league.coins).toBe(5);
    const plan = buildLeagueRedemption(game, MONTH, GIFT, TODAY, 1);
    expect(plan.ok).toBe(true);
    expect(plan.cost).toBe(BALANCE.league.prices.gift);
    expect(plan.events).toHaveLength(1);

    for (const e of plan.events) applyGameEvent(game, e.type, e.payload);
    finalizeLeague(game.league);
    expect(game.league.coins).toBe(5 - 3);
    expect(game.league.coinsSpent).toBe(3);
    expect(game.league.redemptions[`${MONTH}|${GIFT}`]).toEqual({ itemId: GIFT, kind: 'gift', cost: 3 });
  });

  it('refuses the second redemption of the same item that month — before writing', () => {
    const game = purse(7);
    const first = buildLeagueRedemption(game, MONTH, GIFT, TODAY, 1);
    for (const e of first.events) applyGameEvent(game, e.type, e.payload);
    finalizeLeague(game.league);

    const again = buildLeagueRedemption(game, MONTH, GIFT, TODAY, 2);
    expect(again).toEqual({ ok: false, error: 'already_redeemed', cost: 0, events: [] });
    // …and the reducer refuses again, so a duplicated event cannot double-charge.
    applyGameEvent(game, 'league_reward_redeemed', { month: MONTH, itemId: GIFT, kind: 'gift', cost: 3 });
    finalizeLeague(game.league);
    expect(game.league.coinsSpent).toBe(3);
  });

  it('lets the SAME item be redeemed again in another month', () => {
    const game = purse(7);
    const july = buildLeagueRedemption(game, MONTH, GIFT, TODAY, 1);
    for (const e of july.events) applyGameEvent(game, e.type, e.payload);
    finalizeLeague(game.league);
    // The August pool has its own ids, so the equivalent August gift is another
    // item — but the ledger key is (month, item), which is what allows it.
    const august = poolOfMonth('2026-08').rewards[0]!.id;
    expect(buildLeagueRedemption(game, '2026-08', august, TODAY, 2).ok).toBe(true);
  });

  it('refuses what the purse cannot pay for, BEFORE anything is written', () => {
    const game = purse(4); // an experience costs 5
    const plan = buildLeagueRedemption(game, MONTH, EXPERIENCE, TODAY, 1);
    expect(plan).toEqual({ ok: false, error: 'insufficient_coins', cost: 0, events: [] });
    expect(game.league.redemptions).toEqual({});
  });

  it('refuses an item that is not in THAT month\'s pool, and an unknown id', () => {
    const game = purse(9);
    // A SEASONAL gift belongs to its month alone…
    const seasonal = poolOfMonth(MONTH).rewards.find((i) => i.id.startsWith('gift_'))!.id;
    expect(buildLeagueRedemption(game, '2026-08', seasonal, TODAY, 1).error).toBe('wrong_month');
    expect(buildLeagueRedemption(game, 'later', seasonal, TODAY, 1).error).toBe('wrong_month');
    // …while a base-pool prize is at home in EVERY month.
    expect(buildLeagueRedemption(game, '2026-08', GIFT, TODAY, 1).ok).toBe(true);
    expect(buildLeagueRedemption(game, MONTH, 'no_such_item', TODAY, 1).error).toBe('unknown_item');
    // A challenge is staked, never bought.
    const challengeId = poolOfMonth(MONTH).challenges[0]!.id;
    expect(buildLeagueRedemption(game, MONTH, challengeId, TODAY, 1).error).toBe('unknown_item');
  });

  it('clamps a crafted price and can never drive the purse negative', () => {
    const game = purse(1);
    applyGameEvent(game, 'league_reward_redeemed', {
      month: MONTH,
      itemId: GIFT,
      kind: 'gift',
      cost: 9_999,
    });
    finalizeLeague(game.league);
    expect(game.league.redemptions[`${MONTH}|${GIFT}`]?.cost).toBe(BALANCE.league.maxCost);
    expect(game.league.coins).toBe(0);
  });

  it('converges in either merge order', () => {
    const week = makeEvent('league_week_closed', { weekKey: W5, score: 80, c: 1, q: 1, coin: true }, 10);
    const buy = makeEvent('league_reward_redeemed', { month: MONTH, itemId: GIFT, kind: 'gift', cost: 3 }, 20);
    const twin = makeEvent('league_reward_redeemed', { month: MONTH, itemId: GIFT, kind: 'gift', cost: 3 }, 30);
    const forward = rebuildGame([week, buy, twin], TODAY).league;
    const backward = rebuildGame([twin, buy, week], TODAY).league;
    expect(forward).toEqual(backward);
    expect(forward.coinsSpent).toBe(3);
    expect(forward.coins).toBe(0);
  });
});

describe('the monthly challenge — one slot, staked and claimed', () => {
  const MONTH = '2026-07';
  const CHALLENGE = poolOfMonth(MONTH).challenges[0]!;
  const OTHER = poolOfMonth(MONTH).challenges[1]!;

  it('stakes one challenge a month and pays its bonus when claimed', () => {
    const game = purse(5);
    const staked = buildLeagueChallengeSet(game, MONTH, CHALLENGE.id, TODAY, 1);
    expect(staked.ok).toBe(true);
    expect(staked.cost).toBe(BALANCE.league.prices.challenge);
    for (const e of staked.events) applyGameEvent(game, e.type, e.payload);
    finalizeLeague(game.league);
    expect(game.league.coins).toBe(5 - 2);
    expect(game.league.challenges[MONTH]).toEqual({ challengeId: CHALLENGE.id, cost: 2 });

    const done = buildLeagueChallengeComplete(game, MONTH, TODAY, 2);
    expect(done.ok).toBe(true);
    for (const e of done.events) applyGameEvent(game, e.type, e.payload);
    finalizeLeague(game.league);
    expect(game.league.completions[`${MONTH}|${CHALLENGE.id}`]).toBe(CHALLENGE.bonus);
    expect(game.league.coins).toBe(5 - 2 + CHALLENGE.bonus);
  });

  it('refuses a second stake that month, and a second claim', () => {
    const game = purse(9);
    for (const e of buildLeagueChallengeSet(game, MONTH, CHALLENGE.id, TODAY, 1).events) {
      applyGameEvent(game, e.type, e.payload);
    }
    finalizeLeague(game.league);
    expect(buildLeagueChallengeSet(game, MONTH, OTHER.id, TODAY, 2).error).toBe('challenge_already_set');

    for (const e of buildLeagueChallengeComplete(game, MONTH, TODAY, 3).events) {
      applyGameEvent(game, e.type, e.payload);
    }
    finalizeLeague(game.league);
    const earned = game.league.coinsEarned;
    expect(buildLeagueChallengeComplete(game, MONTH, TODAY, 4).error).toBe('already_completed');
    // The reducer refuses the duplicate too, so the bonus is paid once.
    applyGameEvent(game, 'league_challenge_completed', {
      month: MONTH,
      challengeId: CHALLENGE.id,
      bonus: 5,
    });
    finalizeLeague(game.league);
    expect(game.league.coinsEarned).toBe(earned);
  });

  it('refuses a claim with nothing staked, and an unknown challenge', () => {
    const game = purse(9);
    expect(buildLeagueChallengeComplete(game, MONTH, TODAY, 1).error).toBe('no_challenge');
    expect(buildLeagueChallengeSet(game, MONTH, 'nope', TODAY, 1).error).toBe('unknown_item');
    expect(buildLeagueChallengeSet(game, MONTH, poolOfMonth('2026-03').challenges[0]!.id, TODAY, 1).error).toBe(
      'wrong_month',
    );
    // A gift cannot be staked as a challenge.
    expect(buildLeagueChallengeSet(game, MONTH, poolOfMonth(MONTH).rewards[0]!.id, TODAY, 1).error).toBe(
      'unknown_item',
    );
  });

  it('pays nothing for completing a challenge nobody staked', () => {
    const game = purse(5);
    applyGameEvent(game, 'league_challenge_completed', { month: MONTH, challengeId: OTHER.id, bonus: 5 });
    finalizeLeague(game.league);
    expect(game.league.completions[`${MONTH}|${OTHER.id}`]).toBe(5); // recorded…
    expect(game.league.coinsEarned).toBe(5); // …and not paid: only the 5 weeks
    expect(game.league.coins).toBe(5);
  });

  it('clamps a crafted bonus', () => {
    const game = purse(5);
    applyGameEvent(game, 'league_challenge_set', { month: MONTH, challengeId: CHALLENGE.id, cost: 2 });
    applyGameEvent(game, 'league_challenge_completed', {
      month: MONTH,
      challengeId: CHALLENGE.id,
      bonus: 9_999,
    });
    finalizeLeague(game.league);
    expect(game.league.completions[`${MONTH}|${CHALLENGE.id}`]).toBe(BALANCE.league.maxBonus);
  });
});

/* ============================================ 7. the store, end to end */

/**
 * A store built the way a real one is: a LOG, replayed into state. The events
 * are stamped at their own dates (`store.append` would stamp them "now", which
 * would put the plan into force AFTER the weeks it is supposed to grade).
 */
function storeWith(sessions: Record<string, Session>, plan: PlanDoc | null): LocalStore {
  const events: AppEvent[] = [];
  if (plan) {
    events.push(
      makeEvent(
        'plan_updated',
        { plan: planToRecord(plan), revision: 1, date: '2026-01-01' },
        Date.parse('2026-01-01T00:00:00.000Z'),
      ),
    );
  }
  for (const date of Object.keys(sessions).sort()) {
    const s = sessions[date] as Session;
    events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
  }
  const store = new LocalStore(fakeStorage());
  store.replaceAll(rebuildFromEvents(events, tsOf(TODAY)), events);
  return store;
}

describe('the driver — closing weeks through the store', () => {
  const NOW = new Date(Date.parse(`${TODAY}T12:00:00.000Z`));

  it('closes every due week once, mints the coins and stays idempotent', () => {
    const { sessions } = steady('A');
    const store = storeWith(sessions, PLAN_A);

    const first = closeDueWeeks(store, NOW);
    expect(first.closed).toEqual([W1, W2, W3, W4, W5]);
    expect(first.coins).toBe(5);
    expect(gameOf(store).league.coins).toBe(5);
    expect(gameOf(store).league.months['2026-06']?.weeks).toBe(3); // W1..W3

    // Running it again is a no-op: nothing is due, nothing is written.
    const before = store.getEvents().length;
    const second = closeDueWeeks(store, NOW);
    expect(second.closed).toEqual([]);
    expect(store.getEvents().length).toBe(before);
    expect(gameOf(store).league.coins).toBe(5);
  });

  it('replays byte-identically from the log', () => {
    const { sessions } = steady('A');
    const store = storeWith(sessions, PLAN_A);
    closeDueWeeks(store, NOW);
    redeemLeagueReward(store, '2026-07', poolOfMonth('2026-07').rewards[0]!.id, NOW);
    setLeagueChallenge(store, '2026-07', poolOfMonth('2026-07').challenges[0]!.id, NOW);
    completeLeagueChallenge(store, '2026-07', NOW);

    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents(), NOW.getTime()).game as GameState;
    expect(replayed.league).toEqual(live.league);
    expect(replayed).toEqual(live);
  });

  it('two devices that both close the same weeks offline converge on one purse', () => {
    const { sessions } = steady('A');
    const a = storeWith(sessions, PLAN_A);
    const b = storeWith(sessions, PLAN_A);
    closeDueWeeks(a, NOW);
    closeDueWeeks(b, new Date(NOW.getTime() + 3_600_000));

    const union = [...a.getEvents(), ...b.getEvents()];
    const forward = rebuildGame(union, TODAY).league;
    const backward = rebuildGame([...union].reverse(), TODAY).league;
    expect(forward).toEqual(backward);
    expect(forward.coins).toBe(5);
    expect(Object.keys(forward.weeks)).toEqual([W1, W2, W3, W4, W5]);
    expect(forward).toEqual(gameOf(a).league);
  });

  it('refuses a redemption the purse cannot cover without touching the log', () => {
    const store = storeWith(weekA({}, W1), PLAN_A);
    const before = store.getEvents().length;
    const result = redeemLeagueReward(store, '2026-07', poolOfMonth('2026-07').rewards[0]!.id, NOW);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient_coins');
    expect(store.getEvents().length).toBe(before);
  });

  it('exposes the live week through the store, for the UI stage', () => {
    const { sessions } = steady('A');
    weekA(sessions, weekKeyOf(TODAY), 2);
    const store = storeWith(sessions, PLAN_A);
    const live = liveWeek(leagueContextOf(store), TODAY);
    expect(live.weekKey).toBe(weekKeyOf(TODAY));
    expect(live.days).toBe(2);
    expect(live.c).toBe(0.5);
    expect(live.coin).toBe(false);
  });
});

/* ===================================================== 8. the wipe & bump */

describe('data_cleared and the v10 -> v12 blob bumps', () => {
  it('a wipe takes the whole league with it', () => {
    const game = purse(5);
    applyGameEvent(game, 'league_challenge_set', {
      month: '2026-07',
      challengeId: poolOfMonth('2026-07').challenges[0]!.id,
      cost: 2,
    });
    finalizeLeague(game.league);
    expect(game.league.coins).toBe(3);

    applyGameEvent(game, 'data_cleared', {});
    finalizeLeague(game.league);
    expect(game.league).toEqual(emptyLeague());
  });

  it('keeps what comes AFTER the wipe, in both merge orders', () => {
    const wipe = makeEvent('data_cleared', {}, 100);
    const before = makeEvent('league_week_closed', { weekKey: W1, score: 80, c: 1, q: 1, coin: true }, 50);
    const after = makeEvent('league_week_closed', { weekKey: W5, score: 90, c: 1, q: 1, coin: true }, 150);
    const forward = rebuildGame([before, wipe, after], TODAY).league;
    const backward = rebuildGame([after, wipe, before], TODAY).league;
    expect(forward).toEqual(backward);
    expect(Object.keys(forward.weeks)).toEqual([W5]);
    expect(forward.coins).toBe(1);
  });

  it('reports the current version and starts with an empty league', () => {
    // v12 changed no field at all: it changed what a fold of the same events
    // MEANS (best grade per week, not first), and a v11 cache of the old fold
    // can disagree with a replay of its own log — so it is rejected too.
    expect(GAME_STATE_VERSION).toBe(13);
    expect(emptyGame().league).toEqual(emptyLeague());
  });

  it('rejects a v10 blob so the weeks are replayed rather than re-minted', () => {
    // An empty default would say "no week was ever closed" — which would let the
    // lazy close re-close every week in the backfill window and re-mint its 🔵.
    const old: Record<string, unknown> = { ...emptyGame(), version: 10 };
    delete old['league'];
    expect(normalizeGame(old)).toBeNull();
    // The same blob at the CURRENT version, with the field, loads fine.
    expect(normalizeGame({ ...emptyGame() } as unknown as Record<string, unknown>)).not.toBeNull();
  });

  it('replays a v10 save into a current one with every week intact', () => {
    const { sessions } = steady('A');
    const store = storeWith(sessions, PLAN_A);
    closeDueWeeks(store, new Date(Date.parse(`${TODAY}T12:00:00.000Z`)));
    const live = gameOf(store);

    // the save as a v10 build would have persisted it: right log, stale blob
    const raw = JSON.parse(JSON.stringify(store.getState())) as Record<string, unknown>;
    const blob = raw['game'] as Record<string, unknown>;
    blob['version'] = 10;
    delete blob['league'];
    expect(normalizeGame(blob)).toBeNull(); // …so it is rebuilt

    const rebuilt = rebuildFromEvents(store.getEvents(), Date.parse(`${TODAY}T12:00:00.000Z`));
    expect(rebuilt.game?.version).toBe(GAME_STATE_VERSION);
    expect(rebuilt.game?.league).toEqual(live.league);
  });

  it('keeps only well-formed ledger entries out of a hand-edited blob', () => {
    const blob = {
      ...emptyGame(),
      league: {
        coins: 999, // derived — must be ignored and recomputed
        coinsEarned: 999,
        coinsSpent: 0,
        weeks: {
          [W1]: { score: 80, c: 1, q: 1, l: 0.5, p: 0, coin: true, volume: 10, days: 4, prs: 0 },
          '2026-07-06': { score: 100, coin: true }, // a Monday — dropped
          nonsense: { score: 100, coin: true },
        },
        redemptions: {
          '2026-07|gift_07_1': { itemId: 'gift_07_1', kind: 'gift', cost: 3 },
          '2026-07|gift_07_2': { itemId: 'mismatch', kind: 'gift', cost: 3 }, // dropped
          '2026-13|gift_01_1': { itemId: 'gift_01_1', kind: 'gift', cost: 3 }, // dropped
        },
        challenges: { '2026-07': { challengeId: 'chl_07_1', cost: 2 }, bad: { challengeId: 'x', cost: 2 } },
        completions: { '2026-07|chl_07_1': 3, 'bad|x': 9 },
        months: { '2999-01': { month: '2999-01', score: 500, weeks: 5, coins: 5 } },
      },
    } as unknown as Record<string, unknown>;

    const game = normalizeGame(blob) as GameState;
    expect(Object.keys(game.league.weeks)).toEqual([W1]);
    expect(Object.keys(game.league.redemptions)).toEqual(['2026-07|gift_07_1']);
    expect(Object.keys(game.league.challenges)).toEqual(['2026-07']);
    expect(Object.keys(game.league.completions)).toEqual(['2026-07|chl_07_1']);
    // Everything derived is left at zero — `finalizeGame` recomputes it.
    expect(game.league.coins).toBe(0);
    expect(game.league.months).toEqual({});
    finalizeLeague(game.league);
    expect(game.league.coinsEarned).toBe(1 + 3); // one week's 🔵 + the bonus
    expect(game.league.coinsSpent).toBe(3 + 2);
    expect(game.league.coins).toBe(0);
  });
});

/* ========================================================= 9. the 🛠 rule */

describe('dev grants can never move a league number', () => {
  it('ignores a dev-marked PR, purged or not', () => {
    const sessions = weekA({}, W1, 4);
    const real = prEvent(iso(W1, 0), 'a1', 0);
    const fake = prEvent(iso(W1, 1), 'b1', 0, { dev: true });
    const alsoFake = prEvent(iso(W1, 2), 'c1', 0, { dev: true });

    const honest = weekScore(leagueContext(inputOf(sessions, PLAN_A, [real])), W1);
    const inflated = weekScore(leagueContext(inputOf(sessions, PLAN_A, [real, fake, alsoFake])), W1);
    expect(honest.prs).toBe(1);
    expect(inflated.prs).toBe(1);
    expect(inflated.score).toBe(honest.score);
  });

  it('is unchanged by a purge, because the grants never counted anyway', () => {
    const sessions = weekA({}, W1, 4);
    const real = prEvent(iso(W1, 0), 'a1', 0);
    const fake = prEvent(iso(W1, 1), 'b1', 0, { dev: true });
    const purge = makeEvent('dev_purge', { date: iso(W1, 3), dev: true }, tsOf(iso(W1, 3)));

    const before = weekScore(leagueContext(inputOf(sessions, PLAN_A, [real, fake])), W1);
    const after = weekScore(leagueContext(inputOf(sessions, PLAN_A, [real, fake, purge])), W1);
    expect(after).toEqual(before);
    expect(after.prs).toBe(1);
  });

  it('cannot touch the training side at all — a dev grant writes no set', () => {
    // The days, sets and volume come from the SESSIONS, which the dev panel
    // never writes. Adding every dev event it can produce changes nothing.
    const sessions = weekA({}, W1, 4);
    const devEvents = [
      makeEvent('xp_gained', { date: iso(W1, 5), source: 'dev', parts: { chest: 500 }, total: 500, retro: false, dev: true, key: 'dev|1' }, tsOf(iso(W1, 5))),
      makeEvent('coins_granted', { date: iso(W1, 5), amount: 9999, key: 'dev|2', source: 'dev', dev: true }, tsOf(iso(W1, 5))),
    ];
    const plain = weekScore(leagueContext(inputOf(sessions, PLAN_A)), W1);
    const doped = weekScore(leagueContext(inputOf(sessions, PLAN_A, devEvents)), W1);
    expect(doped).toEqual(plain);
  });
});

/* ============================================================ 10. the pools */

describe('the twelve pools', () => {
  it('offers one pool per calendar month, in order', () => {
    expect(LEAGUE_POOLS).toHaveLength(12);
    LEAGUE_POOLS.forEach((pool, i) => {
      expect(pool.month).toBe(i + 1);
      expect(pool.he.trim().length).toBeGreaterThan(0);
      expect(pool.rewards.filter((r) => r.kind === 'gift')).toHaveLength(3);
      expect(pool.rewards.filter((r) => r.kind === 'experience')).toHaveLength(2);
      expect(pool.challenges).toHaveLength(3);
    });
  });

  it('rotates by month number, whatever the year', () => {
    expect(poolOfMonth('2026-08').month).toBe(8);
    expect(poolOfMonth('2030-08')).toBe(poolOfMonth('2026-08'));
    expect(poolOfMonth('2026-13').month).toBe(1); // junk falls back, never null
    expect(itemInMonth('2026-08', 'gift_08_1')).toBe(true);
    expect(itemInMonth('2026-07', 'gift_08_1')).toBe(false);
    // The couple's base pool does not rotate — it is in every month.
    expect(itemInMonth('2026-08', 'base_1')).toBe(true);
    expect(itemInMonth('2026-07', 'base_1')).toBe(true);
  });

  it("leads every month's rewards with the couple's base pool", () => {
    const baseIds = ['base_1', 'base_3', 'base_4', 'base_5', 'base_2', 'base_6', 'base_7'];
    for (let m = 1; m <= 12; m++) {
      const pool = poolOfMonth(`2026-${String(m).padStart(2, '0')}`);
      expect(pool.rewards.slice(0, baseIds.length).map((i) => i.id)).toEqual(baseIds);
    }
  });

  it('gives every item a unique id, Hebrew copy and an emoji', () => {
    const items = allLeagueItems();
    expect(items).toHaveLength(7 + 12 * 8); // the base pool once, then twelve seasonal pools
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(items.length);
    for (const item of items) {
      expect(leagueItemById(item.id)).toBe(item);
      expect(item.he.trim().length).toBeGreaterThan(0);
      expect(item.detail.trim().length).toBeGreaterThan(0);
      // Hebrew, not a placeholder in English.
      expect(/[֐-׿]/.test(item.he)).toBe(true);
      expect(/[֐-׿]/.test(item.detail)).toBe(true);
      expect(item.emoji.length).toBeGreaterThan(0);
    }
    expect(leagueItemById('no_such_thing')).toBeNull();
  });

  it('prices every item from the balance, by kind', () => {
    expect(priceOf('gift')).toBe(3);
    expect(priceOf('experience')).toBe(5);
    expect(priceOf('challenge')).toBe(2);
    for (const item of allLeagueItems()) {
      expect(priceOf(item.kind)).toBe(BALANCE.league.prices[item.kind]);
      if (item.kind === 'challenge') {
        expect(item.bonus).toBeGreaterThan(0);
        expect(item.bonus).toBeLessThanOrEqual(BALANCE.league.maxBonus);
      } else {
        expect(item.bonus).toBe(0);
      }
    }
  });

  it('keeps a month affordable: a perfect month buys something', () => {
    // Four or five 🔵 a month against a 3 / 5 / 2 price list — a won month buys
    // one real thing, which is the whole economy.
    const perfect = 4 * BALANCE.league.coinPerWeek;
    expect(perfect).toBeGreaterThanOrEqual(BALANCE.league.prices.gift);
    expect(perfect).toBeLessThanOrEqual(BALANCE.league.prices.experience + BALANCE.league.prices.challenge);
  });
});
