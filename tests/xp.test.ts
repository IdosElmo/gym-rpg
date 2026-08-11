/**
 * Unit tests for the pure XP engine: level curve, volume factor, PR detection,
 * XP splits, streak tiers (up AND down), the event reducer and the retroactive
 * grant generator.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  addDays,
  applyGameEvent,
  applyPending,
  buildRetroactiveGrants,
  buildSetGrant,
  buildWorkoutCompletionGrant,
  characterLevel,
  completionSplit,
  computeStreak,
  deriveStats,
  emptyGame,
  finalizeGame,
  isPersonalRecord,
  isoToTs,
  levelForXp,
  levelProgress,
  rebuildGame,
  setVolume,
  splitXp,
  streakMultiplier,
  totalXpToReach,
  tsToIso,
  volumeFactor,
  weekStartISO,
  weeklyTargetAt,
  weeklyTargetForWeek,
  weeklyTargetsFromEvents,
  xpForLevel,
  xpForSet,
} from '../src/core/xp.ts';
import { PROGRAM, findExercise, type Exercise } from '../src/data/program.ts';
import type { AppEvent, EventType, Session } from '../src/storage/DataStore.ts';

function ex(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
}

/* ---------------------------------------------------------- level curve */

describe('level curve', () => {
  it('follows xpForLevel(n) = 100 × 1.35^(n−1)', () => {
    expect(xpForLevel(1)).toBeCloseTo(100, 6);
    expect(xpForLevel(2)).toBeCloseTo(135, 6);
    expect(xpForLevel(3)).toBeCloseTo(182.25, 6);
    expect(xpForLevel(5)).toBeCloseTo(100 * Math.pow(1.35, 4), 6);
  });

  it('accumulates: reaching level 3 costs level1 + level2 XP', () => {
    expect(totalXpToReach(1)).toBeCloseTo(0, 6);
    expect(totalXpToReach(2)).toBeCloseTo(100, 6);
    expect(totalXpToReach(3)).toBeCloseTo(235, 6);
  });

  it('maps XP back to a level, exactly on the boundaries', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99.99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(234.99)).toBe(2);
    expect(levelForXp(235)).toBe(3);
    expect(levelForXp(-50)).toBe(1);
  });

  it('caps at the balance max level (and always terminates)', () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(BALANCE.xp.maxLevel);
  });

  it('reports progress inside the current level', () => {
    const p = levelProgress(160);
    expect(p.level).toBe(2);
    expect(p.into).toBeCloseTo(60, 6);
    expect(p.need).toBeCloseTo(135, 6);
    expect(p.ratio).toBeCloseTo(60 / 135, 6);
    expect(levelProgress(0).ratio).toBe(0);
  });

  it('character level is the floor of the six part levels', () => {
    const parts = emptyGame().parts;
    parts.chest.level = 5;
    parts.back.level = 4;
    parts.legs.level = 3;
    parts.shoulders.level = 2;
    parts.arms.level = 2;
    parts.core.level = 1;
    // (5+4+3+2+2+1)/6 = 2.83 -> 2
    expect(characterLevel(parts)).toBe(2);
  });
});

/* ----------------------------------------------------- volume & set XP */

describe('volume + volumeFactor', () => {
  it('uses weight × reps for weighted sets', () => {
    expect(setVolume('40', '10')).toBe(400);
    expect(setVolume('42.5', '8')).toBe(340);
  });

  it('uses reps (or seconds) alone for bodyweight / timed sets', () => {
    expect(setVolume('', '15')).toBe(15);
    expect(setVolume('0', '50')).toBe(50);
    expect(setVolume('20', '')).toBe(20);
    expect(setVolume('', '')).toBe(0);
    expect(setVolume('abc', 'xyz')).toBe(0);
  });

  it('clamps the factor to [0.5, 1.5]', () => {
    expect(volumeFactor(100, 100)).toBe(1);
    expect(volumeFactor(120, 100)).toBeCloseTo(1.2, 6);
    expect(volumeFactor(1000, 100)).toBe(BALANCE.xp.volumeFactorMax);
    expect(volumeFactor(1, 100)).toBe(BALANCE.xp.volumeFactorMin);
    expect(volumeFactor(80, 100)).toBeCloseTo(0.8, 6);
  });

  it('falls back to factor 1 when there is nothing to compare against', () => {
    expect(volumeFactor(400, 0)).toBe(1);
    expect(volumeFactor(0, 400)).toBe(1);
  });
});

describe('personal records', () => {
  it('needs a previous best to beat — the first set only sets the baseline', () => {
    expect(isPersonalRecord(400, 0)).toBe(false);
    expect(isPersonalRecord(400, 400)).toBe(false);
    expect(isPersonalRecord(401, 400)).toBe(true);
  });

  it('doubles the XP of a record set', () => {
    const normal = xpForSet(80, 100);
    expect(normal.pr).toBe(false);
    expect(normal.xp).toBeCloseTo(8, 6);

    const record = xpForSet(120, 100);
    expect(record.pr).toBe(true);
    expect(record.xp).toBeCloseTo(10 * 1.2 * 2, 6);

    // clamped upside: a huge jump is still only 1.5 × base × 2
    expect(xpForSet(10_000, 100).xp).toBeCloseTo(30, 6);
  });
});

describe('XP splits', () => {
  it('splits a two-part exercise by its declared weights', () => {
    const parts = splitXp(10, ex('a1')); // chest .8 / arms .2
    expect(parts.chest).toBeCloseTo(8, 6);
    expect(parts.arms).toBeCloseTo(2, 6);
    expect(parts.back).toBeUndefined();
  });

  it('gives everything to the primary part when there is no split', () => {
    const parts = splitXp(10, ex('a3')); // legs only
    expect(parts.legs).toBeCloseTo(10, 6);
    expect(Object.keys(parts)).toHaveLength(1);
  });

  it('never invents or loses XP', () => {
    for (const day of ['A', 'B', 'C'] as const) {
      for (const e of PROGRAM[day].exercises) {
        const parts = splitXp(10, e);
        const sum = Object.values(parts).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(10, 6);
      }
    }
  });

  it('gives the completion bonus to every body part', () => {
    const parts = completionSplit();
    expect(Object.keys(parts).sort()).toEqual(['arms', 'back', 'chest', 'core', 'legs', 'shoulders']);
    expect(parts.chest).toBe(BALANCE.xp.workoutCompletionBonus);
  });
});

/* ------------------------------------------------------------- streaks */

describe('week math', () => {
  it('weeks run Sunday -> Saturday', () => {
    expect(weekStartISO('2025-01-05')).toBe('2025-01-05'); // a Sunday
    expect(weekStartISO('2025-01-11')).toBe('2025-01-05'); // the Saturday after
    expect(weekStartISO('2025-01-12')).toBe('2025-01-12'); // next Sunday
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2025-01-30', 3)).toBe('2025-02-02');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
    expect(isoToTs('1970-01-02')).toBe(86_400_000);
  });
});

/**
 * THE PLAN DECIDES WHAT A PERFECT WEEK IS.
 *
 * `weeklyTarget` lives in the plan document, the plan lives in the log, and the
 * log is totally ordered by `(ts, id)` — so the threshold a given week is judged
 * by is a function of the event SET, exactly like the XP is. That is what lets
 * two devices agree on a streak they computed independently.
 */
describe('the weekly target timeline', () => {
  /** A `plan_updated` event carrying a v2 document with `target` days a week. */
  function planEvent(id: string, ts: number, target: number | null): AppEvent {
    const plan =
      target === null
        ? null
        : {
            version: 2,
            rev: 1,
            days: [{ key: 'd_x', label: 'יום', weekdays: [0], exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] }],
            weeklyTarget: target,
            customExercises: [],
          };
    return { id, ts, type: 'plan_updated', payload: { plan, revision: 1, date: tsToIso(ts) } };
  }

  it('reads the target out of plan_updated, and resets it on data_cleared', () => {
    const log = [
      planEvent('a', isoToTs('2025-01-06'), 4),
      { id: 'b', ts: isoToTs('2025-01-20'), type: 'data_cleared', payload: {} } as AppEvent,
    ];
    const targets = weeklyTargetsFromEvents(log);
    expect(targets.map((t) => t.target)).toEqual([4, 3]);
    // before any plan: the built-in program's three days a week
    expect(weeklyTargetAt(targets, isoToTs('2025-01-01'))).toBe(3);
    expect(weeklyTargetAt(targets, isoToTs('2025-01-10'))).toBe(4);
    expect(weeklyTargetAt(targets, isoToTs('2025-01-25'))).toBe(3);
  });

  it('is a function of the event SET: shuffling the log changes nothing', () => {
    const log = [planEvent('a', 1_000, 5), planEvent('z', 2_000, 2)];
    expect(weeklyTargetsFromEvents([...log].reverse())).toEqual(weeklyTargetsFromEvents(log));
    // a ts tie is broken by id, in both directions
    const tie = [planEvent('aaa', 5_000, 6), planEvent('zzz', 5_000, 1)];
    for (const perm of [tie, [...tie].reverse()]) {
      expect(weeklyTargetAt(weeklyTargetsFromEvents(perm), 9_000)).toBe(1);
    }
  });

  it('reads a v1 payload (an older client) as the built-in three days', () => {
    const v1: AppEvent = {
      id: 'v1',
      ts: 1_000,
      type: 'plan_updated',
      payload: { plan: { version: 1, rev: 1, days: {}, customExercises: [] }, revision: 1 },
    };
    expect(weeklyTargetsFromEvents([v1])).toEqual([{ ts: 1_000, target: 3 }]);
  });

  it('judges a week by the plan in force when that week CLOSED', () => {
    // the switch lands mid-week: the week it lands in is judged by the new plan
    const targets = weeklyTargetsFromEvents([planEvent('a', isoToTs('2025-01-08'), 4)]);
    expect(weeklyTargetForWeek(targets, '2024-12-29')).toBe(3);
    expect(weeklyTargetForWeek(targets, '2025-01-05')).toBe(4);
    expect(weeklyTargetForWeek(targets, '2025-01-12')).toBe(4);
  });
});

describe('streak tiers under a plan target', () => {
  const week1 = ['2025-01-05', '2025-01-07', '2025-01-08', '2025-01-09'];
  /** A plan of `target` days a week, active from before any of the history. */
  function targets(target: number): ReturnType<typeof weeklyTargetsFromEvents> {
    return [{ ts: isoToTs('2025-01-01'), target }];
  }

  it('a 4-day plan needs FOUR days for the tier — three drops it', () => {
    expect(computeStreak(week1, '2025-01-12', targets(4)).tier).toBe(1);
    expect(computeStreak(week1.slice(0, 3), '2025-01-12', targets(4)).tier).toBe(0);
    // the same three days are a perfect week under the built-in program
    expect(computeStreak(week1.slice(0, 3), '2025-01-12').tier).toBe(1);
  });

  it('reports the ACTIVE target as `needed`, for the character screen', () => {
    expect(computeStreak([], '2025-01-12', targets(5)).needed).toBe(5);
    expect(computeStreak(week1, '2025-01-12', targets(1)).needed).toBe(1);
    expect(computeStreak(week1, '2025-01-12').needed).toBe(BALANCE.streak.daysPerWeek);
  });

  it('judges each week against the target that was active THAT week', () => {
    const days = [...week1.slice(0, 3), '2025-01-12', '2025-01-14', '2025-01-16'];
    // three days a week throughout: two perfect weeks
    expect(computeStreak(days, '2025-01-19').tier).toBe(2);
    // …but switching to a 4-day plan at the start of week 2 makes week 2 a miss
    const switched = [
      { ts: isoToTs('2025-01-01'), target: 3 },
      { ts: isoToTs('2025-01-12'), target: 4 },
    ];
    expect(computeStreak(days, '2025-01-19', switched).tier).toBe(0);
  });
});

describe('streak tiers', () => {
  const perfect = ['2025-01-05', '2025-01-07', '2025-01-09'];

  it('is 0 with no workouts at all', () => {
    const s = computeStreak([], '2025-01-12');
    expect(s.tier).toBe(0);
    expect(s.daysThisWeek).toBe(0);
    expect(s.needed).toBe(BALANCE.streak.daysPerWeek);
  });

  it('never judges the week in progress', () => {
    const s = computeStreak(perfect, '2025-01-09');
    expect(s.tier).toBe(0);
    expect(s.daysThisWeek).toBe(3);
    expect(s.weekStart).toBe('2025-01-05');
  });

  it('a perfect week (3 distinct days) raises the tier once it closes', () => {
    expect(computeStreak(perfect, '2025-01-12').tier).toBe(1);
  });

  it('stacks across consecutive perfect weeks', () => {
    const days = [...perfect, '2025-01-12', '2025-01-14', '2025-01-16'];
    expect(computeStreak(days, '2025-01-19').tier).toBe(2);
  });

  it('drops one tier for a closed week with fewer than 3 workouts', () => {
    const days = [...perfect, '2025-01-13']; // second week: only one day
    expect(computeStreak(days, '2025-01-19').tier).toBe(0);
  });

  it('drops for an empty week too, but never below 0', () => {
    // one perfect week then three empty weeks: 1 -> 0 -> 0 -> 0
    expect(computeStreak(perfect, '2025-02-02').tier).toBe(0);
    // a single lean week from the start cannot go negative
    expect(computeStreak(['2025-01-05'], '2025-01-12').tier).toBe(0);
  });

  it('counts distinct days only (two sessions on one date is one day)', () => {
    const s = computeStreak(['2025-01-05', '2025-01-05', '2025-01-07'], '2025-01-12');
    expect(s.tier).toBe(0);
  });

  it('the buff is +10% per tier', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(3)).toBeCloseTo(1.3, 6);
    expect(streakMultiplier(-5)).toBe(1);
  });
});

/* ------------------------------------------------------- reducer + grants */

describe('game reducer', () => {
  it('folds xp_gained into parts, best, granted and workout days', () => {
    const game = emptyGame();
    applyGameEvent(game, 'xp_gained', {
      date: '2025-05-04',
      exId: 'a1',
      setIndex: 0,
      source: 'set',
      parts: { chest: 8, arms: 2 },
      total: 10,
      volume: 400,
      retro: false,
    });
    finalizeGame(game, '2025-05-04');

    expect(game.parts.chest.xp).toBe(8);
    expect(game.parts.arms.xp).toBe(2);
    expect(game.totalXp).toBe(10);
    expect(game.best['a1']).toBe(400);
    expect(game.granted['2025-05-04|a1|0']).toBe(true);
    expect(game.workoutDays).toEqual(['2025-05-04']);
  });

  it('keeps retro grants out of the streak', () => {
    const game = emptyGame();
    applyGameEvent(game, 'xp_gained', {
      date: '2020-01-01',
      exId: 'a1',
      setIndex: 0,
      source: 'set',
      parts: { chest: 10 },
      total: 10,
      volume: 100,
      retro: true,
    });
    finalizeGame(game, '2025-05-04');
    expect(game.parts.chest.xp).toBe(10);
    expect(game.workoutDays).toEqual([]);
    expect(game.streak.tier).toBe(0);
  });

  it('ignores derived events (level_up / streak_changed) and unknown types', () => {
    const game = emptyGame();
    applyGameEvent(game, 'level_up', { part: 'chest', from: 1, to: 2 });
    applyGameEvent(game, 'streak_changed', { from: 0, to: 1 });
    applyGameEvent(game, 'boss_defeated', { boss: 'x' });
    // declared-but-unfolded types + a type from a build we have never seen
    applyGameEvent(game, 'plan_updated', { plan: { days: {} } });
    applyGameEvent(game, 'data_merged', { source: 'sync', added: 2 });
    applyGameEvent(game, 'from_the_future' as EventType, { anything: true });
    expect(game).toEqual(emptyGame());
  });

  it('resets everything on data_cleared', () => {
    const game = emptyGame();
    applyGameEvent(game, 'energy_gained', { amount: 100 });
    applyGameEvent(game, 'data_cleared', {});
    expect(game).toEqual(emptyGame());
  });
});

/* ------------------------------------------------ reducer idempotency (v4) */

describe('reducer idempotency — the merge guards', () => {
  const setXp = {
    date: '2025-05-04',
    exId: 'a1',
    setIndex: 0,
    source: 'set',
    parts: { chest: 8, arms: 2 },
    total: 10,
    volume: 400,
    retro: false,
  };

  it('carries the ledgers in the state and reports version 4', () => {
    const game = emptyGame();
    expect(game.version).toBe(4);
    expect(game.energyGranted).toEqual({});
    expect(game.prKeys).toEqual({});
  });

  it('pays a set only once, however many duplicates arrive', () => {
    const game = emptyGame();
    applyGameEvent(game, 'xp_gained', setXp);
    // the SAME grant from another device: different event id, same meaning
    applyGameEvent(game, 'xp_gained', { ...setXp });
    applyGameEvent(game, 'xp_gained', { ...setXp, retro: true });

    expect(game.totalXp).toBe(10);
    expect(game.parts.chest.xp).toBe(8);
    expect(game.granted['2025-05-04|a1|0']).toBe(true);
    expect(game.workoutDays).toEqual(['2025-05-04']);
  });

  it('does not let a duplicate raise `best` or the workout-completion bonus', () => {
    const game = emptyGame();
    applyGameEvent(game, 'xp_gained', setXp);
    // a duplicate that claims a bigger volume must not move `best` either —
    // the slot is paid, the whole event is skipped.
    applyGameEvent(game, 'xp_gained', { ...setXp, volume: 9_999 });
    expect(game.best['a1']).toBe(400);

    const bonus = { date: '2025-05-04', source: 'workout_complete', parts: { core: 5 }, total: 5, retro: false };
    applyGameEvent(game, 'xp_gained', bonus);
    applyGameEvent(game, 'xp_gained', { ...bonus });
    expect(game.parts.core.xp).toBe(5);
    expect(game.bonusDays['2025-05-04']).toBe(true);
  });

  it('pays keyed energy once and unkeyed (pre-v4) energy every time', () => {
    const game = emptyGame();
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 2, source: 'set', key: '2025-05-04|a1|0' });
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 2, source: 'set', key: '2025-05-04|a1|0' });
    expect(game.energy).toBe(2);
    expect(game.energyEarned).toBe(2);
    expect(game.energyGranted['2025-05-04|a1|0']).toBe(true);

    // a different slot still pays
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 2, source: 'set', key: '2025-05-04|a1|1' });
    expect(game.energy).toBe(4);

    // BACK-COMPAT: an event from a log written before the key existed has no
    // ledger entry to check, so it applies exactly like it always did.
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 5, source: 'set' });
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 5, source: 'set' });
    expect(game.energy).toBe(14);
    expect(game.energyGranted).toEqual({ '2025-05-04|a1|0': true, '2025-05-04|a1|1': true });
  });

  it('counts a PR once per (date, exercise, set)', () => {
    const game = emptyGame();
    const pr = { date: '2025-05-04', exId: 'a1', setIndex: 1, volume: 450, previousBest: 400, retro: false };
    applyGameEvent(game, 'pr_achieved', pr);
    applyGameEvent(game, 'pr_achieved', { ...pr });
    expect(game.prCount).toBe(1);
    expect(game.prKeys['2025-05-04|a1|1']).toBe(true);

    applyGameEvent(game, 'pr_achieved', { ...pr, setIndex: 2 });
    expect(game.prCount).toBe(2);
    // a payload without the key fields cannot be guarded — it still counts
    applyGameEvent(game, 'pr_achieved', { volume: 1 });
    expect(game.prCount).toBe(3);
  });

  it('clears the ledgers on data_cleared, so a wiped device can be re-paid', () => {
    const game = emptyGame();
    applyGameEvent(game, 'xp_gained', setXp);
    applyGameEvent(game, 'energy_gained', { date: '2025-05-04', amount: 2, source: 'set', key: '2025-05-04|a1|0' });
    applyGameEvent(game, 'data_cleared', {});
    expect(game).toEqual(emptyGame());
  });

  it('builders stamp the energy key the reducer guards on', () => {
    const game = emptyGame();
    const grant = buildSetGrant(game, {
      date: '2025-05-04',
      day: 'A',
      ex: ex('a1'),
      setIndex: 0,
      w: '40',
      r: '10',
      retro: false,
      ts: 1_000,
    });
    const energy = grant.find((e) => e.type === 'energy_gained');
    expect(energy?.payload['key']).toBe('2025-05-04|a1|0');

    const bonus = buildWorkoutCompletionGrant(game, { date: '2025-05-04', day: 'A', retro: false, ts: 1 });
    expect(bonus.find((e) => e.type === 'energy_gained')?.payload['key']).toBe('bonus|2025-05-04');
  });

  it('derives levels + headline level in finalizeGame', () => {
    const game = emptyGame();
    game.parts.chest.xp = 300;
    finalizeGame(game, '2025-05-04');
    expect(game.parts.chest.level).toBe(3);
    expect(game.level).toBe(1); // floor((3+1+1+1+1+1)/6)
  });
});

describe('grant builders', () => {
  const args = {
    date: '2025-05-04',
    day: 'A' as const,
    ex: ex('a1'),
    setIndex: 0,
    w: '40',
    r: '10',
    retro: false,
    ts: 1_000,
  };

  it('emits xp + energy for a live set, and nothing the second time', () => {
    const game = emptyGame();
    const first = buildSetGrant(game, args);
    expect(first.map((e) => e.type)).toEqual(['xp_gained', 'energy_gained']);
    expect(first[1]?.payload['amount']).toBe(BALANCE.energy.perSet);

    applyPending(game, first);
    // the anti-farm guard: same date + exercise + set index pays once
    expect(buildSetGrant(game, args)).toEqual([]);
    expect(buildSetGrant(game, { ...args, setIndex: 1 })).not.toEqual([]);
  });

  it('emits pr_achieved and doubles XP when the volume beats the best', () => {
    const game = emptyGame();
    applyPending(game, buildSetGrant(game, args)); // best = 400
    const pr = buildSetGrant(game, { ...args, setIndex: 1, w: '45', r: '10' }); // 450
    expect(pr.map((e) => e.type)).toContain('pr_achieved');
    expect(pr[0]?.payload['pr']).toBe(true);
    // factor clamped at 1.5 -> 450/400 = 1.125, ×2 for the PR
    expect(pr[0]?.payload['total']).toBeCloseTo(10 * 1.125 * 2, 6);
  });

  it('emits level_up when a part crosses a threshold', () => {
    const game = emptyGame();
    game.parts.legs.xp = 99;
    const events = buildSetGrant(game, { ...args, ex: ex('a3'), setIndex: 2, w: '20', r: '12' });
    const up = events.find((e) => e.type === 'level_up');
    expect(up?.payload).toMatchObject({ part: 'legs', from: 1, to: 2 });
  });

  it('grants no energy for retro sets', () => {
    const game = emptyGame();
    const events = buildSetGrant(game, { ...args, retro: true });
    expect(events.map((e) => e.type)).toEqual(['xp_gained']);
  });

  it('pays the workout completion bonus once per date', () => {
    const game = emptyGame();
    const bonus = buildWorkoutCompletionGrant(game, { date: '2025-05-04', day: 'A', retro: false, ts: 5 });
    expect(bonus.map((e) => e.type)).toEqual(['xp_gained', 'energy_gained']);
    expect(bonus[0]?.payload['total']).toBe(BALANCE.xp.workoutCompletionBonus * 6);
    expect(bonus[1]?.payload['amount']).toBe(BALANCE.energy.perWorkout);

    applyPending(game, bonus);
    expect(buildWorkoutCompletionGrant(game, { date: '2025-05-04', day: 'A', retro: false, ts: 6 })).toEqual([]);
  });
});

/* -------------------------------------------------------- retroactive XP */

describe('retroactive grants', () => {
  const sessions: Record<string, Session> = {
    '2025-01-05': {
      day: 'A',
      ex: {
        a1: [
          { w: '40', r: '10', done: true },
          { w: '45', r: '10', done: true },
          { w: '45', r: '9', done: false },
        ],
        a5: [{ w: '12', r: '12', done: true }],
      },
    },
    '2025-01-07': { day: 'B', ex: { b1: [{ w: '50', r: '10', done: true }] } },
  };

  it('grants XP for imported history but no energy and no streak', () => {
    const pending = buildRetroactiveGrants(sessions, [], '2025-06-01');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((e) => e.type === 'energy_gained')).toBe(false);

    const game = emptyGame();
    applyPending(game, pending);
    finalizeGame(game, '2025-06-01');
    expect(game.totalXp).toBeGreaterThan(0);
    expect(game.energy).toBe(0);
    expect(game.workoutDays).toEqual([]);
    expect(game.streak.tier).toBe(0);
  });

  it('stamps every grant at its own workout date, in chronological order', () => {
    const pending = buildRetroactiveGrants(sessions, [], '2025-06-01');
    const tss = pending.map((e) => e.ts);
    expect([...tss].sort((a, b) => a - b)).toEqual(tss);
    expect(tss[0]).toBeGreaterThanOrEqual(isoToTs('2025-01-05'));
    expect(tss[tss.length - 1] ?? 0).toBeLessThan(isoToTs('2025-01-08'));
  });

  it('detects PRs across imported days, chronologically', () => {
    const pending = buildRetroactiveGrants(sessions, [], '2025-06-01');
    const prs = pending.filter((e) => e.type === 'pr_achieved');
    // set 1 of a1 sets the baseline (400), set 2 (450) beats it
    expect(prs).toHaveLength(1);
    expect(prs[0]?.payload).toMatchObject({ exId: 'a1', setIndex: 1, previousBest: 400 });
  });

  it('is idempotent: re-running with the grants already in the log yields nothing', () => {
    const first = buildRetroactiveGrants(sessions, [], '2025-06-01');
    const asEvents: AppEvent[] = first.map((p, i) => ({ id: `e${i}`, ts: p.ts, type: p.type, payload: p.payload }));
    expect(buildRetroactiveGrants(sessions, asEvents, '2025-06-01')).toEqual([]);
  });

  it('is deterministic — the same input yields byte-identical payloads', () => {
    const a = buildRetroactiveGrants(sessions, [], '2025-06-01');
    const b = buildRetroactiveGrants(sessions, [], '2025-06-01');
    expect(b).toEqual(a);
  });

  it('adds the completion bonus only for a fully finished day', () => {
    const complete: Record<string, Session> = {
      '2025-01-05': {
        day: 'A',
        ex: Object.fromEntries(
          PROGRAM.A.exercises.map((e) => [
            e.id,
            Array.from({ length: e.sets }, () => ({ w: '20', r: '10', done: true })),
          ]),
        ),
      },
    };
    const bonus = buildRetroactiveGrants(complete, [], '2025-06-01').filter(
      (e) => e.payload['source'] === 'workout_complete',
    );
    expect(bonus).toHaveLength(1);
    // the partial day above never gets one
    expect(
      buildRetroactiveGrants(sessions, [], '2025-06-01').filter((e) => e.payload['source'] === 'workout_complete'),
    ).toHaveLength(0);
  });

  it('rebuilds the same game state from the generated events', () => {
    const pending = buildRetroactiveGrants(sessions, [], '2025-06-01');
    const events: AppEvent[] = pending.map((p, i) => ({ id: `e${i}`, ts: p.ts, type: p.type, payload: p.payload }));
    const folded = emptyGame();
    applyPending(folded, pending);
    finalizeGame(folded, '2025-06-01');
    expect(rebuildGame(events, '2025-06-01')).toEqual(folded);
  });
});

/* ---------------------------------------------------------------- stats */

describe('derived stats', () => {
  it('each body part drives its own stat', () => {
    const parts = emptyGame().parts;
    const base = deriveStats(parts, 0);
    parts.chest.level = 5;
    parts.legs.level = 5;
    parts.shoulders.level = 5;
    const grown = deriveStats(parts, 0);

    expect(grown.atk).toBeGreaterThan(base.atk);
    expect(grown.maxHp).toBeGreaterThan(base.maxHp);
    expect(grown.attackIntervalMs).toBeLessThan(base.attackIntervalMs);
    expect(grown.def).toBe(base.def); // back untouched
  });

  it('applies the streak buff to everything', () => {
    const parts = emptyGame().parts;
    const plain = deriveStats(parts, 0);
    const buffed = deriveStats(parts, 2);
    expect(buffed.buff).toBeCloseTo(1.2, 6);
    expect(buffed.atk).toBeCloseTo(plain.atk * 1.2, 6);
    expect(buffed.maxHp).toBe(Math.round(plain.maxHp * 1.2));
  });

  it('keeps crit chance under its cap', () => {
    const parts = emptyGame().parts;
    parts.arms.level = 99;
    expect(deriveStats(parts, 9).critChance).toBeLessThanOrEqual(BALANCE.stats.critChanceMax);
  });
});
