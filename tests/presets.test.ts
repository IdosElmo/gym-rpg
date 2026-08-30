/**
 * presets.test.ts — the ready-made plans.
 *
 * A preset is shipped DATA that becomes a user's real plan the moment it is
 * picked, so what is worth proving is that it survives every gate a hand-edited
 * plan goes through: validation, normalisation, the save/replay round trip, and
 * the XP engine. A preset that fails one of those would only fail in the user's
 * hands, after they replaced their plan with it.
 */
import { describe, expect, it } from 'vitest';

import {
  BODY_PARTS,
  DEFAULT_WEEKLY_TARGET,
  bodyPartWeights,
  findExercise,
  isPlanDayKey,
  programDayKeys,
  weekdaysCaption,
} from '../src/data/program.ts';
import { PLAN_PRESETS, presetById } from '../src/data/presets.ts';
import {
  PLAN_LIMITS,
  defaultPlanDoc,
  deriveWeeklyTarget,
  isDefaultPlan,
  normalizePlanDoc,
  planToRecord,
  resolveProgram,
  savePlan,
  validatePlanDoc,
} from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents } from '../src/storage/migrate.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import type { PlanDoc } from '../src/data/planTypes.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const AB = 'ab4';

function ab(): PlanDoc {
  const preset = presetById(AB);
  if (!preset) throw new Error('no A/B preset');
  return preset.build();
}

/* ------------------------------------------------------------ every preset */

describe('every preset', () => {
  it('is findable by id, and an unknown id is null (never a wrong plan)', () => {
    expect(PLAN_PRESETS.map((p) => p.id)).toEqual(['builtin3', AB]);
    for (const p of PLAN_PRESETS) expect(presetById(p.id)).toBe(p);
    expect(presetById('nope')).toBeNull();
    expect(new Set(PLAN_PRESETS.map((p) => p.id)).size).toBe(PLAN_PRESETS.length);
  });

  it('describes itself truthfully for the picker card', () => {
    for (const p of PLAN_PRESETS) {
      expect(p.name.trim()).not.toBe('');
      expect(p.description.trim()).not.toBe('');
      expect(p.build().days).toHaveLength(p.days);
    }
  });

  it('validates and normalises without a single repair', () => {
    for (const p of PLAN_PRESETS) {
      const doc = p.build();
      expect(validatePlanDoc(doc)).toEqual([]);
      // normalisation is where a bad number / dead row / illegal key would be
      // quietly fixed — a preset must come out byte-identical.
      expect(normalizePlanDoc(JSON.parse(JSON.stringify(planToRecord(doc))))).toEqual(doc);
    }
  });

  it('stays inside the plan limits and points only at built-in exercises', () => {
    for (const p of PLAN_PRESETS) {
      const doc = p.build();
      expect(doc.days.length).toBeGreaterThanOrEqual(PLAN_LIMITS.minDays);
      expect(doc.days.length).toBeLessThanOrEqual(PLAN_LIMITS.maxDays);
      expect(doc.customExercises).toEqual([]);
      const keys = doc.days.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const day of doc.days) {
        expect(isPlanDayKey(day.key)).toBe(true);
        expect(day.exercises.length).toBeGreaterThan(0);
        expect(day.exercises.length).toBeLessThanOrEqual(PLAN_LIMITS.maxExercisesPerDay);
        const ids = day.exercises.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const row of ids) expect(findExercise(row)).not.toBeNull();
      }
    }
  });

  it('agrees with the one derivation rule about its own weekly target', () => {
    for (const p of PLAN_PRESETS) {
      const doc = p.build();
      expect(doc.weeklyTarget).toBe(deriveWeeklyTarget(doc.days));
      expect(resolveProgram(doc).weeklyTarget).toBe(doc.weeklyTarget);
    }
  });
});

/* ---------------------------------------------------- the built-in preset */

describe('the "היפרטרופיה 3 ימים" preset', () => {
  it('IS the built-in program — picking it equals a reset to default', () => {
    const preset = presetById('builtin3');
    expect(preset?.days).toBe(3);
    const doc = preset?.build();
    expect(doc).toEqual(defaultPlanDoc());
    expect(isDefaultPlan(doc ?? null)).toBe(true);
    expect(doc?.weeklyTarget).toBe(DEFAULT_WEEKLY_TARGET);
    expect(doc?.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
  });
});

/* --------------------------------------------------------- the A/B preset */

describe('the "תוכנית A/B — 4 ימים" preset', () => {
  it('is three workouts trained on four weekdays, with a weekly target of 4', () => {
    const doc = ab();
    expect(doc.days).toHaveLength(3);
    expect(doc.weeklyTarget).toBe(4);
    const [a, b1, b2] = doc.days;
    expect(a?.label).toContain('אימון A');
    expect(b1?.label).toContain('אימון B1');
    expect(b2?.label).toContain('אימון B2');
    expect(a?.weekdays).toEqual([0, 3]); // ראשון + רביעי
    expect(b1?.weekdays).toEqual([2]); // שלישי
    expect(b2?.weekdays).toEqual([4]); // חמישי
    // no weekday belongs to two days — that is what makes the target 2+1+1 = 4
    expect(weekdaysCaption(a?.weekdays ?? [])).toBe('ראשון · רביעי');
    expect(weekdaysCaption(b1?.weekdays ?? [])).toBe('שלישי');
    expect(weekdaysCaption(b2?.weekdays ?? [])).toBe('חמישי');
    const all = doc.days.flatMap((d) => d.weekdays ?? []);
    expect(new Set(all).size).toBe(all.length);
  });

  it('mints FRESH day keys on every pick, never re-using A/B/C', () => {
    const first = ab().days.map((d) => d.key);
    const second = ab().days.map((d) => d.key);
    expect(first).not.toEqual(second);
    for (const k of [...first, ...second]) {
      expect(k.startsWith('d_')).toBe(true);
      expect(['A', 'B', 'C']).not.toContain(k);
    }
  });

  it('holds exactly the prescribed exercises per day, in order', () => {
    const doc = ab();
    expect(doc.days[0]?.exercises.map((r) => r.id)).toEqual([
      'x11', 'c2', 'x12', 'c3', 'x2', 'x3', 'x4', 'x5', 'a6', 'x13',
    ]);
    expect(doc.days[1]?.exercises.map((r) => r.id)).toEqual([
      'x14', 'x15', 'b2', 'a2', 'x7', 'a5', 'x9', 'x16', 'x13',
    ]);
    expect(doc.days[2]?.exercises.map((r) => r.id)).toEqual([
      'x17', 'x18', 'x19', 'x20', 'x7', 'a5', 'x9', 'b5', 'x13',
    ]);
  });

  it('re-uses the existing exercises instead of duplicating them', () => {
    // the lifts the program already ships must be the SAME definitions
    const doc = ab();
    for (const id of ['c2', 'c3', 'b2', 'a2', 'a5', 'a6', 'b5', 'x7']) {
      expect(doc.days.flatMap((d) => d.exercises).some((r) => r.id === id)).toBe(true);
      expect(findExercise(id)?.id).toBe(id);
    }
    expect(doc.customExercises).toEqual([]);
  });

  it('closes each day with the dead hang the plan decompresses on', () => {
    for (const day of ab().days) {
      const last = day.exercises[day.exercises.length - 1];
      expect(last).toMatchObject({ id: 'x13', sets: 2, reps: '30–45 שנ׳' });
    }
  });

  it('rests 90s on the compounds and 60s on the isolation work', () => {
    const rows = new Map(ab().days.flatMap((d) => d.exercises).map((r) => [r.id, r] as const));
    for (const id of ['x11', 'c2', 'x12', 'c3', 'x14', 'x15', 'b2', 'a2', 'x17', 'x18', 'x19', 'x20']) {
      expect(rows.get(id)?.rest, id).toBe(90);
    }
    for (const id of ['x2', 'x3', 'x4', 'x5', 'a6', 'x13', 'x7', 'a5', 'x9', 'x16', 'b5']) {
      expect(rows.get(id)?.rest, id).toBe(60);
    }
  });

  it('carries the prescribed sets and reps', () => {
    const rows = new Map(ab().days.flatMap((d) => d.exercises).map((r) => [r.id, r] as const));
    expect(rows.get('x11')).toMatchObject({ sets: 3, reps: '8–10' });
    expect(rows.get('c2')).toMatchObject({ sets: 3, reps: '8–10' });
    expect(rows.get('x2')).toMatchObject({ sets: 3, reps: '10–12' });
    expect(rows.get('x4')).toMatchObject({ sets: 3, reps: '12–15' });
    expect(rows.get('x14')).toMatchObject({ sets: 4, reps: '5–8' }); // slow assisted pull-ups
    expect(rows.get('x17')).toMatchObject({ sets: 4, reps: '3–5' }); // 4–5s negatives
    expect(rows.get('a2')).toMatchObject({ sets: 3, reps: '10–12 לצד' });
    expect(rows.get('x16')).toMatchObject({ sets: 3, reps: '10–12 לצד' });
    expect(rows.get('b5')).toMatchObject({ sets: 3, reps: '45–60 שנ׳' });
  });

  it('trains every body part, and each exercise splits its XP legally', () => {
    const seen = new Set<string>();
    for (const day of ab().days) {
      for (const row of day.exercises) {
        const ex = findExercise(row.id);
        expect(ex).not.toBeNull();
        const w = bodyPartWeights(ex!);
        expect(BODY_PARTS.reduce((acc, p) => acc + w[p], 0)).toBeCloseTo(1, 10);
        for (const p of BODY_PARTS) if (w[p] > 0) seen.add(p);
      }
    }
    // hanging knee raises, the pallof press and the plank keep the core in this
    // split too — all six parts get worked
    expect([...seen].sort()).toEqual([...BODY_PARTS].sort());
  });

  it('resolves into tabs whose captions are the weekdays they run on', () => {
    const doc = ab();
    const program = resolveProgram(doc);
    expect(programDayKeys(program)).toEqual(doc.days.map((d) => d.key));
    expect(program.weeklyTarget).toBe(4);
    expect(program.days[0]?.day.day).toBe('ראשון');
    expect(program.days[1]?.day.day).toBe('שלישי');
    expect(program.days[2]?.day.day).toBe('חמישי');
    expect(program.days[0]?.day.exercises).toHaveLength(10);
    expect(program.days[0]?.day.focus).not.toBe('');
  });

  it('saves as ONE event and replays out of the log unchanged', () => {
    const store = new LocalStore(fakeStorage());
    const res = savePlan(store, ab());
    expect(res.ok).toBe(true);
    expect(store.getEvents().filter((e) => e.type === 'plan_updated')).toHaveLength(1);
    const saved = store.getState().plan;
    expect(saved?.weeklyTarget).toBe(4);
    expect(saved?.days).toHaveLength(3);
    expect(rebuildFromEvents(store.getEvents(), Date.now()).plan).toEqual(saved);
  });
});
