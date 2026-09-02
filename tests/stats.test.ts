/**
 * tests/stats.test.ts — the pure statistics engine (`core/stats.ts`).
 *
 * Everything here is a function of `(sessions, events, resolve, today)`, so the
 * whole suite runs without a clock, a store or a DOM. The two rules the feature
 * rests on get their own tests: COMPLETED SETS ONLY on the training side, and
 * "no 🛠 dev grant may ever inflate a number" on the event side.
 */
import { describe, expect, it } from 'vitest';

import { findExercise, type Exercise } from '../src/data/program.ts';
import type { AppEvent, Session, SetEntry } from '../src/storage/DataStore.ts';
import {
  ENERGY_PER_PHONE_CHARGE,
  EQUIVALENTS,
  basics,
  completedSets,
  computeStats,
  equivalentsOf,
  exerciseBests,
  gameStats,
  heatLevel,
  heatmap,
  oddballs,
  partBalance,
  trainingEvents,
  weeklyTonnage,
} from '../src/core/stats.ts';

/* ------------------------------------------------------------- fixtures */

const resolve = (id: string): Exercise | null => findExercise(id);

function set(w: string, r: string, done = true): SetEntry {
  return { w, r, done };
}

/** `{ '2025-03-02': { a1: [set, set] } }` -> a sessions map. */
function sessionsOf(
  raw: Record<string, Record<string, (SetEntry | null)[]>>,
  day = 'A',
): Record<string, Session> {
  const out: Record<string, Session> = {};
  for (const date of Object.keys(raw)) out[date] = { day, ex: raw[date] ?? {} };
  return out;
}

let seq = 0;
function ev(type: string, payload: Record<string, unknown>, ts = ++seq): AppEvent {
  return { id: `e${String(ts).padStart(4, '0')}`, ts, type: type as AppEvent['type'], payload };
}

/* -------------------------------------------------------------- cardio */

describe('cardio stages — incline-minutes are not kilograms', () => {
  // x21 = the treadmill incline walk: `w` is the incline %, `r` the minutes
  const sessions = sessionsOf({
    '2025-03-02': { a1: [set('40', '10')], x21: [set('1', '5'), set('2', '5'), set('3', '5', false)] },
  });

  it('keeps a stage out of the tonnage, and its "weight" out of the heaviest set', () => {
    const sets = completedSets(sessions, resolve);
    const stages = sets.filter((s) => s.exId === 'x21');
    expect(stages).toHaveLength(2);
    for (const s of stages) {
      expect(s.cardio).toEqual({ loadLabel: 'שיפוע', loadUnit: '%', loadStart: 1, loadStep: 1 });
      expect(s.tonnage).toBe(0);
      expect(s.timed).toBe(false);
    }
    // …while its VOLUME is load × minutes, which is what its PRs are measured in
    expect(stages.map((s) => s.volume)).toEqual([5, 10]);
    const b = basics(sets, '2025-03-02');
    expect(b.tonnage).toBe(400);
    expect(b.sets).toBe(3);
    // a stage's minutes are neither repetitions nor plank seconds
    expect(b.reps).toBe(10);
    expect(b.seconds).toBe(0);
    expect(b.cardioMinutes).toBe(10);
    expect(oddballs(sets, 0, b.tonnage).heaviestSet?.exId).toBe('a1');
    // a strength set has no spec at all
    expect(sets.find((s) => s.exId === 'a1')?.cardio).toBeNull();
  });

  it('ranks the best stage by volume and tags the exercise as cardio for the screen', () => {
    const bests = exerciseBests(completedSets(sessions, resolve));
    const x21 = bests.find((e) => e.exId === 'x21');
    expect(x21?.cardio?.loadUnit).toBe('%');
    expect(x21?.best).toMatchObject({ weight: 2, reps: 5, volume: 10 });
    expect(x21?.first).toMatchObject({ weight: 1, reps: 5, volume: 5 });
    expect(x21?.totalTonnage).toBe(0);
    expect(bests.find((e) => e.exId === 'a1')?.cardio).toBeNull();
  });

  it('reports no cardio minutes at all for a lifter', () => {
    const sets = completedSets(sessionsOf({ '2025-03-02': { a1: [set('40', '10')] } }), resolve);
    expect(basics(sets, '2025-03-02').cardioMinutes).toBe(0);
  });
});

/* ------------------------------------------------------------- tonnage */

describe('tonnage — Σ weight × reps over COMPLETED sets', () => {
  it('multiplies weights and reps, and ignores every set that is not checked', () => {
    const sessions = sessionsOf({
      '2025-03-02': {
        a1: [set('40', '10'), set('42.5', '8'), set('50', '8', false)],
      },
    });
    const stats = basics(completedSets(sessions, resolve), '2025-03-02');
    expect(stats.tonnage).toBe(40 * 10 + 42.5 * 8);
    expect(stats.sets).toBe(2);
    expect(stats.reps).toBe(18);
    expect(stats.workouts).toBe(1);
  });

  it('parses string weights defensively: decimals, commas, junk and empties', () => {
    const sessions = sessionsOf({
      '2025-03-02': {
        a1: [set('42,5', '4'), set('abc', '10'), set('', '10'), set('20', 'xyz'), null],
      },
    });
    const sets = completedSets(sessions, resolve);
    expect(sets).toHaveLength(4);
    // 42,5 × 4 = 170 · junk/empty weights are bodyweight reps · junk reps = 0
    expect(basics(sets, '2025-03-02').tonnage).toBe(170);
    expect(basics(sets, '2025-03-02').reps).toBe(24);
  });

  it('counts bodyweight reps and plank SECONDS separately, never as kilograms', () => {
    const sessions = sessionsOf({
      // a6 = hanging leg raises (bodyweight, חזרות) · b5 = plank (שניות)
      '2025-03-02': { a6: [set('', '15')], b5: [set('', '60'), set('', '45')] },
    });
    const stats = basics(completedSets(sessions, resolve), '2025-03-02');
    expect(stats.tonnage).toBe(0);
    expect(stats.reps).toBe(15);
    expect(stats.seconds).toBe(105);
  });

  it('a weighted plank still lifts kilograms but its reps stay seconds', () => {
    const sessions = sessionsOf({ '2025-03-02': { b5: [set('10', '60')] } });
    const stats = basics(completedSets(sessions, resolve), '2025-03-02');
    expect(stats.tonnage).toBe(600);
    expect(stats.seconds).toBe(60);
    expect(stats.reps).toBe(0);
  });

  it('is safe on an empty log', () => {
    const stats = basics([], '2025-03-02');
    expect(stats).toMatchObject({ tonnage: 0, sets: 0, workouts: 0, perWeek: 0, topWeekday: null });
    expect(stats.firstDate).toBeNull();
  });

  it('names the busiest weekday and averages workouts per week since the first one', () => {
    const sessions = sessionsOf({
      '2025-03-02': { a1: [set('40', '10')] }, // Sunday
      '2025-03-09': { a1: [set('40', '10')] }, // Sunday
      '2025-03-11': { a1: [set('40', '10')] }, // Tuesday
    });
    // 2025-03-02 → 2025-03-15 inclusive = 14 days = exactly 2 weeks.
    const stats = basics(completedSets(sessions, resolve), '2025-03-15');
    expect(stats.topWeekday).toBe(0);
    expect(stats.byWeekday[0]).toBe(2);
    expect(stats.byWeekday[2]).toBe(1);
    expect(stats.perWeek).toBe(1.5);
  });
});

/* ------------------------------------------------- dev-event exclusion */

describe('🛠 dev grants never inflate a number', () => {
  it('leaves the training metrics untouched — a dev grant writes no set at all', () => {
    const sessions = sessionsOf({ '2025-03-02': { a1: [set('40', '10')] } });
    const events = [
      ev('xp_gained', { date: '2025-03-02', source: 'dev', total: 9999, parts: { chest: 9999 }, dev: true, key: 'dev|1' }),
      ev('energy_gained', { date: '2025-03-02', amount: 5000, source: 'dev', dev: true, key: 'dev|2' }),
      ev('coins_granted', { date: '2025-03-02', amount: 99999, key: 'dev|3', source: 'dev', dev: true }),
    ];
    const stats = computeStats({ sessions, events, resolve, today: '2025-03-02' });
    expect(stats.basics.tonnage).toBe(400);
    expect(stats.game.totalXp).toBe(0);
    expect(stats.game.energyEarned).toBe(0);
    expect(stats.game.coinsEarned).toBe(0);
  });

  it('keeps the REAL grants that sit beside them', () => {
    const events = [
      ev('xp_gained', { date: '2025-03-02', source: 'set', total: 12, parts: { chest: 12 }, retro: false }),
      ev('xp_gained', { date: '2025-03-02', source: 'dev', total: 500, parts: { chest: 500 }, dev: true, key: 'dev|1' }),
      ev('energy_gained', { date: '2025-03-02', amount: 10, source: 'set', retro: false, key: '2025-03-02|a1|0' }),
    ];
    const g = gameStats(events);
    expect(g.totalXp).toBe(12);
    expect(g.energyEarned).toBe(10);
    expect(g.phoneCharges).toBe(Math.round((10 / ENERGY_PER_PHONE_CHARGE) * 10) / 10);
  });

  it('drops a purged dev grant through liveEvents, and keeps a post-purge one out too', () => {
    const events = [
      ev('xp_gained', { date: '2025-03-01', source: 'dev', total: 100, parts: {}, dev: true, key: 'dev|1' }),
      ev('dev_purge', { date: '2025-03-02', dev: true }),
      ev('xp_gained', { date: '2025-03-03', source: 'dev', total: 100, parts: {}, dev: true, key: 'dev|2' }),
      ev('xp_gained', { date: '2025-03-03', source: 'set', total: 8, parts: {}, retro: false }),
    ];
    // The purge marker itself is dev-marked too, so it never reaches a metric —
    // its whole effect has already been applied by `liveEvents` upstream.
    expect(trainingEvents(events).map((e) => e.type)).toEqual(['xp_gained']);
    expect(gameStats(events).totalXp).toBe(8);
  });

  it('counts coins won in a battle that dev energy paid for — a purge reverts grants, not history', () => {
    const events = [
      ev('energy_gained', { date: '2025-03-02', amount: 500, source: 'dev', dev: true, key: 'dev|1' }),
      ev('wave_cleared', { date: '2025-03-02', world: 1, wave: 1, coins: 7, energySpent: 10 }),
      ev('dev_purge', { date: '2025-03-02', dev: true }),
    ];
    const g = gameStats(events);
    expect(g.energyEarned).toBe(0);
    expect(g.wavesCleared).toBe(1);
    expect(g.coinsEarned).toBe(7);
  });
});

/* --------------------------------------------------- weekly sparkline */

describe('weekly tonnage — Sun–Sat buckets', () => {
  it('splits a Saturday and the Sunday after it into two different weeks', () => {
    const sessions = sessionsOf({
      '2025-03-01': { a1: [set('10', '10')] }, // Saturday → week of 2025-02-23
      '2025-03-02': { a1: [set('20', '10')] }, // Sunday    → week of 2025-03-02
    });
    const weeks = weeklyTonnage(completedSets(sessions, resolve), '2025-03-08', 3);
    expect(weeks.map((w) => w.weekStart)).toEqual(['2025-02-16', '2025-02-23', '2025-03-02']);
    expect(weeks.map((w) => w.tonnage)).toEqual([0, 100, 200]);
  });

  it('always ends on the week containing today, and marks it as the live one', () => {
    const weeks = weeklyTonnage([], '2025-03-05', 12);
    expect(weeks).toHaveLength(12);
    expect(weeks[11]?.weekStart).toBe('2025-03-02');
    expect(weeks[11]?.current).toBe(true);
    expect(weeks.filter((w) => w.current)).toHaveLength(1);
    expect(weeks[0]?.weekStart).toBe('2024-12-15');
  });

  it('keeps untrained weeks as real zeros rather than gaps, and counts workouts', () => {
    const sessions = sessionsOf({
      '2025-03-02': { a1: [set('20', '10')] },
      '2025-03-04': { a1: [set('20', '10')] },
    });
    const weeks = weeklyTonnage(completedSets(sessions, resolve), '2025-03-13', 3);
    expect(weeks.map((w) => w.tonnage)).toEqual([0, 400, 0]);
    expect(weeks[1]?.workouts).toBe(2);
    expect(weeks[1]?.sets).toBe(2);
  });
});

/* ------------------------------------------------------------ heatmap */

describe('calendar heatmap', () => {
  it('buckets a day by its completed sets', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(5)).toBe(1);
    expect(heatLevel(6)).toBe(2);
    expect(heatLevel(10)).toBe(2);
    expect(heatLevel(11)).toBe(3);
    expect(heatLevel(15)).toBe(3);
    expect(heatLevel(16)).toBe(4);
    expect(heatLevel(40)).toBe(4);
  });

  it('returns whole Sun–Sat weeks, oldest first, ending on the week of today', () => {
    const weeks = heatmap([], '2025-03-05', 16);
    expect(weeks).toHaveLength(16);
    expect(weeks[15]?.weekStart).toBe('2025-03-02');
    expect(weeks[15]?.days).toHaveLength(7);
    expect(weeks[15]?.days[0]?.date).toBe('2025-03-02');
    expect(weeks[15]?.days[6]?.date).toBe('2025-03-08');
    expect(weeks[0]?.weekStart).toBe('2024-11-17');
  });

  it('marks the days after today as future, and paints the trained ones', () => {
    const sessions = sessionsOf({
      '2025-03-03': { a1: [set('40', '10'), set('40', '10'), set('40', '10')] },
    });
    const weeks = heatmap(completedSets(sessions, resolve), '2025-03-05', 2);
    const week = weeks[1];
    expect(week?.days[1]).toMatchObject({ date: '2025-03-03', sets: 3, level: 1, future: false });
    expect(week?.days[0]?.level).toBe(0);
    expect(week?.days[3]?.future).toBe(false); // 2025-03-05 IS today
    expect(week?.days[4]?.future).toBe(true);
    expect(week?.days[1]?.tonnage).toBe(1200);
  });
});

/* ------------------------------------------------------ part balance */

describe('per-body-part balance', () => {
  it('splits a set through bodyPartWeights, exactly like the XP engine', () => {
    // a1 = incline press, split { chest: .8, arms: .2 }; 40 × 10 = 400 volume.
    const sessions = sessionsOf({ '2025-03-02': { a1: [set('40', '10')] } });
    const balance = partBalance(completedSets(sessions, resolve));
    const chest = balance.parts.find((p) => p.part === 'chest');
    const arms = balance.parts.find((p) => p.part === 'arms');
    expect(chest?.volume).toBe(320);
    expect(arms?.volume).toBe(80);
    expect(chest?.tonnage).toBe(320);
    expect(chest?.ratio).toBe(1);
    expect(arms?.ratio).toBeCloseTo(0.25, 5);
    expect(balance.most).toBe('chest');
    expect(balance.least).toBe('back');
  });

  it('gives a bodyweight part real load — the bars are volume, not kilograms', () => {
    // b5 = plank (60s, core) vs a1 = 40×10 press.
    const sessions = sessionsOf({ '2025-03-02': { a1: [set('40', '10')], b5: [set('', '60')] } });
    const balance = partBalance(completedSets(sessions, resolve));
    const core = balance.parts.find((p) => p.part === 'core');
    expect(core?.volume).toBe(60);
    expect(core?.tonnage).toBe(0);
    expect(core?.ratio).toBeGreaterThan(0);
    expect(balance.most).toBe('chest');
  });

  it('is empty-safe and reports no extremes when nothing is logged', () => {
    const balance = partBalance([]);
    expect(balance.parts).toHaveLength(6);
    expect(balance.parts.every((p) => p.volume === 0 && p.ratio === 0)).toBe(true);
    expect(balance.most).toBeNull();
    expect(balance.least).toBeNull();
  });

  it('counts an unresolvable exercise in the totals but attributes it to no part', () => {
    const sessions = sessionsOf({ '2025-03-02': { zz_gone: [set('50', '10')] } });
    const sets = completedSets(sessions, resolve);
    expect(basics(sets, '2025-03-02').tonnage).toBe(500);
    expect(partBalance(sets).total).toBe(0);
    expect(sets[0]?.he).toBe('zz_gone');
  });
});

/* ------------------------------------------------------------- bests */

describe('per-exercise bests and growth', () => {
  const sessions = sessionsOf({
    '2025-03-02': { a1: [set('40', '10')], a5: [set('10', '12')] },
    '2025-03-09': { a1: [set('50', '10'), set('45', '10')] },
    '2025-03-16': { a1: [set('42.5', '8')] },
  });

  it('ranks by total volume and reports first vs best with a growth percentage', () => {
    const bests = exerciseBests(completedSets(sessions, resolve));
    const a1 = bests[0];
    expect(a1?.exId).toBe('a1');
    expect(a1?.sets).toBe(4);
    expect(a1?.sessions).toBe(3);
    expect(a1?.best).toMatchObject({ weight: 50, reps: 10, volume: 500, date: '2025-03-09' });
    expect(a1?.first).toMatchObject({ weight: 40, reps: 10, volume: 400, date: '2025-03-02' });
    expect(a1?.growthPct).toBe(25);
    expect(bests[1]?.exId).toBe('a5');
    expect(bests[1]?.growthPct).toBeNull(); // one set ever — nothing to compare
  });

  it('caps the table at the requested size', () => {
    expect(exerciseBests(completedSets(sessions, resolve), 1)).toHaveLength(1);
    expect(exerciseBests([], 8)).toEqual([]);
  });

  it('keeps the EARLIER set when two tie for the best', () => {
    const tied = sessionsOf({
      '2025-03-02': { a1: [set('40', '10')] },
      '2025-03-09': { a1: [set('40', '10')] },
    });
    expect(exerciseBests(completedSets(tied, resolve))[0]?.best.date).toBe('2025-03-02');
  });
});

/* ------------------------------------------------------- equivalents */

describe('fun equivalents', () => {
  it('brags about the heaviest rung already passed and points at the next one', () => {
    const r = equivalentsOf(7_000);
    expect(r.headline?.eq.id).toBe('elephant');
    expect(r.headline?.count).toBe(1.2);
    expect(r.next?.eq.id).toBe('bus');
    expect(r.next?.remaining).toBe(5_000);
  });

  it('never rounds an unreached rung up into a headline', () => {
    const r = equivalentsOf(11_900);
    expect(r.headline?.eq.id).toBe('elephant');
    expect(r.all.find((e) => e.eq.id === 'bus')?.reached).toBe(false);
    expect(r.all.find((e) => e.eq.id === 'bus')?.count).toBe(1); // rounded, but not reached
  });

  it('has no headline before the first rung, and still names the goal', () => {
    const r = equivalentsOf(0);
    expect(r.headline).toBeNull();
    expect(r.next?.eq.id).toBe('gorilla');
    expect(r.next?.remaining).toBe(160);
    expect(r.all).toHaveLength(EQUIVALENTS.length);
  });

  it('tops out at the Eiffel tower with nothing left to chase', () => {
    const r = equivalentsOf(20_000_000);
    expect(r.headline?.eq.id).toBe('eiffel');
    expect(r.next).toBeNull();
  });

  it('keeps the ladder ascending — every rung heavier than the one before it', () => {
    for (let i = 1; i < EQUIVALENTS.length; i += 1) {
      expect(EQUIVALENTS[i]?.kg).toBeGreaterThan(EQUIVALENTS[i - 1]?.kg ?? 0);
    }
  });
});

/* -------------------------------------------------------- game stats */

describe('game stats from the event log', () => {
  it('aggregates waves, bosses, dailies, duels, coins and PRs', () => {
    const events = [
      ev('wave_cleared', { date: '2025-03-02', world: 1, wave: 1, coins: 5 }),
      ev('wave_cleared', { date: '2025-03-02', world: 1, wave: 10, coins: 15, miniBoss: true }),
      ev('boss_defeated', { date: '2025-03-03', bossId: 'boss_w1', coins: 100 }),
      ev('daily_challenge', { date: '2025-03-03', score: 10, complete: true, coins: 60 }),
      ev('ghost_duel', { date: '2025-03-03', opponentHandle: 'dan', won: true, coins: 150 }),
      ev('ghost_duel', { date: '2025-03-03', opponentHandle: 'ron', won: false, coins: 30 }),
      ev('coins_spent', { date: '2025-03-03', itemId: 'sword', cost: 80 }),
      ev('item_upgraded', { date: '2025-03-03', itemId: 'sword', toLevel: 1, cost: 40 }),
      ev('pr_achieved', { date: '2025-03-02', exId: 'a1', setIndex: 0, volume: 400, previousBest: 300 }),
      ev('streak_changed', { from: 0, to: 1 }),
      ev('streak_changed', { from: 1, to: 2 }),
      ev('streak_changed', { from: 2, to: 1 }),
    ];
    const g = gameStats(events);
    expect(g).toMatchObject({
      wavesCleared: 2,
      miniBosses: 1,
      worldBosses: 1,
      dailyAttempts: 1,
      dailyCompleted: 1,
      dailyBestScore: 10,
      duels: 2,
      duelWins: 1,
      duelLosses: 1,
      coinsEarned: 5 + 15 + 100 + 60 + 150 + 30,
      coinsSpent: 120,
      prs: 1,
      streakTier: 1,
      bestStreakTier: 2,
    });
  });

  it('dedupes the per-day ledgers exactly like the game state does', () => {
    const events = [
      ev('daily_challenge', { date: '2025-03-03', score: 4, complete: false, coins: 20 }),
      ev('daily_challenge', { date: '2025-03-03', score: 9, complete: false, coins: 45 }),
      ev('ghost_duel', { date: '2025-03-03', opponentHandle: 'dan', won: true, coins: 150 }),
      ev('ghost_duel', { date: '2025-03-03', opponentHandle: 'dan', won: false, coins: 30 }),
      ev('pr_achieved', { date: '2025-03-02', exId: 'a1', setIndex: 0, volume: 400 }),
      ev('pr_achieved', { date: '2025-03-02', exId: 'a1', setIndex: 0, volume: 400 }),
    ];
    const g = gameStats(events);
    expect(g.dailyAttempts).toBe(1);
    expect(g.dailyBestScore).toBe(4); // the FIRST run of the date is the one that counted
    expect(g.duels).toBe(1);
    expect(g.duelWins).toBe(1);
    expect(g.coinsEarned).toBe(20 + 150);
    expect(g.prs).toBe(1);
  });

  it('forgets everything before a data_cleared, and is safe on an empty log', () => {
    const cleared = gameStats([
      ev('wave_cleared', { date: '2025-03-02', world: 1, wave: 1, coins: 5 }),
      ev('data_cleared', { date: '2025-03-03' }),
      ev('wave_cleared', { date: '2025-03-04', world: 1, wave: 1, coins: 9 }),
    ]);
    expect(cleared.wavesCleared).toBe(1);
    expect(cleared.coinsEarned).toBe(9);
    expect(gameStats([])).toMatchObject({ wavesCleared: 0, coinsEarned: 0, prs: 0, phoneCharges: 0 });
  });
});

/* ---------------------------------------------------------- oddballs */

describe('the oddball stats', () => {
  const sessions = sessionsOf({
    '2025-03-02': { a1: [set('40', '10'), set('40', '10')], b5: [set('', '60')] },
    '2025-03-20': { a1: [set('80', '3')] },
  });

  it('estimates rest time from each exercise own rest, per completed set', () => {
    const odd = oddballs(completedSets(sessions, resolve), 0, 0);
    // a1 rests 90s (×3), b5 rests 60s (×1)
    expect(odd.restSeconds).toBe(90 * 3 + 60);
  });

  it('picks the heaviest bar ever — kilograms first, reps only as a tie-break', () => {
    const odd = oddballs(completedSets(sessions, resolve), 0, 0);
    expect(odd.heaviestSet).toMatchObject({ weight: 80, reps: 3, date: '2025-03-20' });
  });

  it('finds the longest gap survived and the most loyal exercise', () => {
    const odd = oddballs(completedSets(sessions, resolve), 0, 0);
    expect(odd.longestGap).toMatchObject({ days: 18, from: '2025-03-02', to: '2025-03-20' });
    expect(odd.loyal).toMatchObject({ exId: 'a1', sessions: 2 });
  });

  it('reports XP per ton, and nothing at all before a kilogram moved', () => {
    expect(oddballs([], 100, 0).xpPerTon).toBeNull();
    expect(oddballs([], 240, 2_000).xpPerTon).toBe(120);
  });

  it('has no gap to report with a single workout', () => {
    const one = sessionsOf({ '2025-03-02': { a1: [set('40', '10')] } });
    expect(oddballs(completedSets(one, resolve), 0, 400).longestGap).toBeNull();
  });
});

/* ------------------------------------------------------ the whole thing */

describe('computeStats', () => {
  it('reports an empty screen for a brand-new install without throwing', () => {
    const stats = computeStats({ sessions: {}, events: [], resolve, today: '2025-03-05' });
    expect(stats.empty).toBe(true);
    expect(stats.basics.tonnage).toBe(0);
    expect(stats.weekly).toHaveLength(12);
    expect(stats.heatmap).toHaveLength(16);
    expect(stats.balance.parts).toHaveLength(6);
    expect(stats.bests).toEqual([]);
    expect(stats.equivalents.headline).toBeNull();
    expect(stats.odd.heaviestSet).toBeNull();
  });

  it('wires every card off the same two sources', () => {
    const sessions = sessionsOf({ '2025-03-03': { a1: [set('50', '10')], b5: [set('', '60')] } });
    const events = [
      ev('xp_gained', { date: '2025-03-03', source: 'set', total: 20, parts: { chest: 20 }, retro: false }),
      ev('wave_cleared', { date: '2025-03-03', world: 1, wave: 1, coins: 5 }),
    ];
    const stats = computeStats({ sessions, events, resolve, today: '2025-03-05' });
    expect(stats.empty).toBe(false);
    expect(stats.basics.tonnage).toBe(500);
    expect(stats.basics.seconds).toBe(60);
    expect(stats.equivalents.headline?.eq.id).toBe('gorilla');
    expect(stats.equivalents.next?.eq.id).toBe('cow');
    expect(stats.weekly[11]?.tonnage).toBe(500);
    expect(stats.game.wavesCleared).toBe(1);
    expect(stats.odd.xpPerTon).toBe(40);
  });
});
