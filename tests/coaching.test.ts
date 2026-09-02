/**
 * coaching.test.ts — the advice behind a boss gate: sets per week the plan
 * gives a part, library exercises that would feed it, and the ETA at the
 * recent XP pace. Pure functions over (game, plan, events, today).
 */
import { describe, expect, it } from 'vitest';

import { gateCoaching, partSetsPerWeek, suggestExercises, xpRate } from '../src/core/coaching.ts';
import { gameOf, onSetCompleted, onWorkoutFinished } from '../src/core/game.ts';
import { resolveProgram } from '../src/core/plan.ts';
import { worldGate } from '../src/core/combat.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { PLAN_PRESETS } from '../src/data/presets.ts';
import {
  BODY_PARTS,
  BUILTIN_PROGRAM,
  bodyPartWeights,
  findExercise,
  isCardio,
  type BodyPart,
  type Exercise,
} from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function ex(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
}

const AB4 = resolveProgram(PLAN_PRESETS.find((p) => p.id === 'ab4')?.build() ?? null);

describe('partSetsPerWeek', () => {
  it('splits every set by the XP weights and multiplies by the scheduled weekdays', () => {
    const sets = partSetsPerWeek(BUILTIN_PROGRAM);
    // hand-computed from the same weights the XP engine pays by
    const want: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
    for (const day of BUILTIN_PROGRAM.days) {
      for (const e of day.day.exercises) {
        if (isCardio(e)) continue;
        const w = bodyPartWeights(e);
        for (const p of BODY_PARTS) want[p] += w[p] * e.sets * Math.max(1, day.weekdays.length);
      }
    }
    for (const p of BODY_PARTS) expect(sets[p]).toBeCloseTo(want[p], 1);
    // the built-in split is chest-heavy and shoulder-light — the shape the gate
    // coaching exists to make visible
    expect(sets.chest).toBeGreaterThan(sets.shoulders * 3);
  });

  it('shows the A/B 4-day preset as back-heavy and chest-light', () => {
    const sets = partSetsPerWeek(AB4);
    expect(sets.back).toBeGreaterThan(sets.chest * 5);
    // a day scheduled twice a week counts twice
    const once = resolveProgram({
      ...(PLAN_PRESETS.find((p) => p.id === 'ab4')?.build() ?? null)!,
    });
    expect(partSetsPerWeek(once).legs).toBe(sets.legs);
  });
});

describe('suggestExercises', () => {
  it('names library exercises that feed the part and are not in the plan yet, best first', () => {
    const out = suggestExercises(AB4, 'chest');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    const inPlan = new Set(AB4.days.flatMap((d) => d.day.exercises.map((e) => e.id)));
    for (const e of out) {
      expect(inPlan.has(e.id), `${e.id} is already in the plan`).toBe(false);
      expect(bodyPartWeights(e).chest).toBeGreaterThanOrEqual(0.5);
      expect(isCardio(e)).toBe(false);
    }
    for (let i = 1; i < out.length; i += 1) {
      expect(bodyPartWeights(out[i] as Exercise).chest).toBeLessThanOrEqual(
        bodyPartWeights(out[i - 1] as Exercise).chest,
      );
    }
  });

  it('never suggests the cardio ladder, and respects the cap', () => {
    for (const p of BODY_PARTS) {
      for (const e of suggestExercises(BUILTIN_PROGRAM, p, 10)) expect(isCardio(e)).toBe(false);
    }
    expect(suggestExercises(BUILTIN_PROGRAM, 'back', 1)).toHaveLength(1);
    expect(suggestExercises(BUILTIN_PROGRAM, 'back', 0)).toHaveLength(0);
  });
});

describe('xpRate', () => {
  it('averages LIVE, non-retro, non-dev XP per workout day inside the window', () => {
    const store = new LocalStore(fakeStorage());
    // two workout days inside the window, one far outside it
    for (const date of ['2025-05-04', '2025-05-06', '2025-01-01']) {
      const now = new Date(`${date}T10:00:00Z`);
      for (let i = 0; i < 3; i += 1) {
        onSetCompleted(store, { date, day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' }, now);
      }
    }
    // a dev grant, which must not count
    store.append('xp_gained', { date: '2025-05-07', parts: { chest: 999 }, total: 999, dev: true });
    // a retro grant, which must not count either
    store.append('xp_gained', { date: '2025-05-07', parts: { chest: 999 }, total: 999, retro: true });

    const rate = xpRate(store.getEvents(), '2025-05-10');
    expect(rate.workouts).toBe(2);
    // a1 is a chest exercise: three sets a day, two days — the average is one day's worth
    const chestOneDay = store
      .getEvents()
      .filter((e) => e.type === 'xp_gained' && e.payload['date'] === '2025-05-04')
      .reduce((s, e) => s + Number((e.payload['parts'] as Record<string, number>)['chest'] ?? 0), 0);
    expect(rate.perWorkout.chest).toBeCloseTo(chestOneDay, 0);
    expect(rate.perWorkout.legs).toBe(0);
  });

  it('is zero with no recent training', () => {
    const rate = xpRate([], '2025-05-10');
    expect(rate.workouts).toBe(0);
    for (const p of BODY_PARTS) expect(rate.perWorkout[p]).toBe(0);
  });
});

describe('gateCoaching', () => {
  it('lists every unmet part with its sets, suggestions and ETA, slowest first', () => {
    const store = new LocalStore(fakeStorage());
    // a week of built-in training: chest gets lots, shoulders very little
    let d = 0;
    for (const day of ['A', 'B', 'C', 'A', 'B', 'C'] as const) {
      d += 1;
      const date = `2025-05-${String(d).padStart(2, '0')}`;
      const now = new Date(`${date}T10:00:00Z`);
      for (const e of BUILTIN_PROGRAM.days.find((x) => x.key === day)?.day.exercises ?? []) {
        for (let i = 0; i < e.sets; i += 1) {
          onSetCompleted(store, { date, day, ex: e, setIndex: i, w: '40', r: '10' }, now);
        }
      }
      onWorkoutFinished(store, { date, day }, now);
    }
    const game = gameOf(store);
    const gate = worldGate(3, { chest: game.parts.chest.level, back: game.parts.back.level, legs: game.parts.legs.level, shoulders: game.parts.shoulders.level, arms: game.parts.arms.level, core: game.parts.core.level });
    expect(gate.locked).toBe(true);

    const c = gateCoaching(game, gate, BUILTIN_PROGRAM, store.getEvents(), '2025-05-07');
    expect(c.measuredOver).toBe(6);
    expect(c.parts.map((p) => p.part).sort()).toEqual(
      gate.requirements.filter((r) => !r.met).map((r) => r.part).sort(),
    );
    for (const p of c.parts) {
      expect(p.have).toBeLessThan(p.need);
      expect(p.xpMissing).toBeCloseTo(totalXpToReach(p.need) - game.parts[p.part].xp, 0);
      expect(p.xpPerWorkout).toBeGreaterThan(0);
      expect(p.workoutsLeft).toBe(Math.max(1, Math.ceil(p.xpMissing / p.xpPerWorkout)));
      expect(p.setsPerWeek).toBe(partSetsPerWeek(BUILTIN_PROGRAM)[p.part]);
    }
    // slowest first, and the gate's ETA is the slowest part's
    for (let i = 1; i < c.parts.length; i += 1) {
      expect(c.parts[i]?.workoutsLeft ?? 0).toBeLessThanOrEqual(c.parts[i - 1]?.workoutsLeft ?? 0);
    }
    expect(c.workoutsLeft).toBe(c.parts[0]?.workoutsLeft);
    expect(c.workoutsLeft).toBe(Math.max(...c.parts.map((p) => p.workoutsLeft ?? 0)));
    // the built-in split is thin on legs and shoulders — one of them decides the gate
    expect(['legs', 'shoulders']).toContain(c.parts[0]?.part);
  });

  it('has no ETA without a recent pace, and nothing to say when the gate is met', () => {
    const game = emptyGame();
    const gate = worldGate(1, { chest: 1, back: 1, legs: 1, shoulders: 1, arms: 1, core: 1 });
    const c = gateCoaching(game, gate, BUILTIN_PROGRAM, [], '2025-05-07');
    expect(c.parts).toHaveLength(3);
    expect(c.workoutsLeft).toBeNull();
    for (const p of c.parts) expect(p.workoutsLeft).toBeNull();

    const met = worldGate(1, { chest: 9, back: 9, legs: 9, shoulders: 9, arms: 9, core: 9 });
    const none = gateCoaching(game, met, BUILTIN_PROGRAM, [], '2025-05-07');
    expect(none.parts).toHaveLength(0);
    expect(none.workoutsLeft).toBe(0);
  });
});
