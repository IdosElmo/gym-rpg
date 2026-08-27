/**
 * The 🍽️ nutrition tracker's core: the fold, the drivers, the selectors — and
 * above all the MERGE laws. Meals live beside sessions/plan on `AppState`
 * (never in `GameState`), so everything here goes through `rebuildFromEvents`
 * and must converge whichever order two devices' logs are merged in.
 */
import { describe, expect, it } from 'vitest';

import {
  applyNutritionEvent,
  dayTotals,
  deleteMeal,
  emptyNutrition,
  logMeal,
  mealRecordOf,
  mealsForDate,
  normalizeNutrition,
  recentDays,
  setTargets,
  shiftDate,
  type MealInput,
} from '../src/core/nutrition.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { buildExport, parseImport, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = Date.parse('2026-08-27T10:00:00Z');

function ev(id: string, ts: number, type: AppEvent['type'], payload: Record<string, unknown>): AppEvent {
  return { id, ts, type, payload };
}

function meal(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    date: '2026-08-27',
    name: 'חזה עוף עם אורז',
    calories: 550,
    protein: 45,
    time: '13:30',
    source: 'manual',
    ...over,
  };
}

const input: MealInput = {
  date: '2026-08-27',
  name: 'חזה עוף עם אורז',
  calories: 550,
  protein: 45,
  time: '13:30',
  source: 'manual',
};

describe('the meal fold', () => {
  it('applies a meal once and ignores every duplicate of its id', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('m1'));
    applyNutritionEvent(n, 'meal_logged', meal('m1', { calories: 9999 }));
    expect(Object.keys(n.meals)).toEqual(['m1']);
    expect(n.meals['m1']?.calories).toBe(550);
  });

  it('clamps hostile numbers and trims the name', () => {
    const read = mealRecordOf(meal('m1', { calories: 1e9, protein: -3, name: `  ${'א'.repeat(200)}  ` }));
    expect(read?.rec.calories).toBe(10000);
    expect(read?.rec.protein).toBe(0);
    expect(read?.rec.name).toHaveLength(120);
  });

  it('refuses a payload that is not a meal', () => {
    expect(mealRecordOf(meal('m1', { date: '27/08/2026' }))).toBeNull();
    expect(mealRecordOf(meal('m1', { name: '   ' }))).toBeNull();
    expect(mealRecordOf(meal('', {}))).toBeNull();
    expect(mealRecordOf(meal('m1', { calories: 'הרבה' }))).toBeNull();
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('m1', { date: 'junk' }));
    expect(Object.keys(n.meals)).toHaveLength(0);
  });

  it('keeps a bad time as empty instead of refusing the meal', () => {
    expect(mealRecordOf(meal('m1', { time: 'בצהריים' }))?.rec.time).toBe('');
  });
});

describe('merge convergence', () => {
  const A = [
    ev('e1', 1000, 'meal_logged', meal('m1')),
    ev('e2', 2000, 'meal_logged', meal('m2', { name: 'שייק חלבון', calories: 300, protein: 30 })),
    ev('e5', 5000, 'nutrition_targets_set', { calories: 2200, protein: 150 }),
  ];
  const B = [
    ev('e3', 3000, 'meal_deleted', { id: 'm1' }),
    ev('e4', 4000, 'nutrition_targets_set', { calories: 1800, protein: 120 }),
  ];

  it('folds identically in both merge orders', () => {
    const ab = rebuildFromEvents([...A, ...B], NOW).nutrition;
    const ba = rebuildFromEvents([...B, ...A], NOW).nutrition;
    expect(ab).toEqual(ba);
    expect(Object.keys(ab.meals).sort()).toEqual(['m1', 'm2']);
    expect(ab.deleted['m1']).toBe(true);
    expect(mealsForDate(ab, '2026-08-27').map((r) => r.id)).toEqual(['m2']);
    // targets are LWW by (ts, id): e5 at ts 5000 wins over e4 at 4000
    expect(ab.targets).toEqual({ calories: 2200, protein: 150 });
  });

  it('converges when the delete arrives BEFORE the log it tombstones', () => {
    const deleteFirst = [ev('e3', 500, 'meal_deleted', { id: 'm1' }), ev('e1', 1000, 'meal_logged', meal('m1'))];
    const n = rebuildFromEvents(deleteFirst, NOW).nutrition;
    expect(n.meals['m1']).toBeDefined();
    expect(mealsForDate(n, '2026-08-27')).toHaveLength(0);
  });

  it('breaks a targets timestamp tie by event id, both ways', () => {
    const x = ev('a', 1000, 'nutrition_targets_set', { calories: 1111, protein: 11 });
    const y = ev('b', 1000, 'nutrition_targets_set', { calories: 2222, protein: 22 });
    expect(rebuildFromEvents([x, y], NOW).nutrition.targets.calories).toBe(2222);
    expect(rebuildFromEvents([y, x], NOW).nutrition.targets.calories).toBe(2222);
  });

  it('data_cleared wipes the tracker exactly like sessions and plan', () => {
    const n = rebuildFromEvents([...A, ev('e9', 9000, 'data_cleared', {})], NOW).nutrition;
    expect(n).toEqual(emptyNutrition());
  });
});

describe('the live drivers', () => {
  it('logMeal appends exactly one event and mirrors the replayed state', () => {
    const store = new LocalStore(fakeStorage());
    const ev1 = logMeal(store, input, 'm1');
    expect(ev1?.type).toBe('meal_logged');
    deleteMeal(store, 'm1');
    logMeal(store, { ...input, name: 'שייק', calories: 300, protein: 30 }, 'm2');
    setTargets(store, { calories: 2000, protein: 140 });

    const live = store.getState().nutrition;
    const replayed = rebuildFromEvents(store.getEvents(), NOW).nutrition;
    expect(live).toEqual(replayed);
    expect(mealsForDate(live, '2026-08-27').map((r) => r.id)).toEqual(['m2']);
    expect(live.targets).toEqual({ calories: 2000, protein: 140 });
  });

  it('refuses an invalid meal without appending anything', () => {
    const store = new LocalStore(fakeStorage());
    expect(logMeal(store, { ...input, name: '  ' }, 'm1')).toBeNull();
    expect(logMeal(store, { ...input, date: 'junk' }, 'm2')).toBeNull();
    expect(store.getEvents().filter((e) => e.type === 'meal_logged')).toHaveLength(0);
  });

  it('round-trips through export → import', () => {
    const store = new LocalStore(fakeStorage());
    logMeal(store, input, 'm1');
    setTargets(store, { calories: 2000, protein: null });
    const blob = buildExport(store.getState(), store.getEvents(), NOW);
    const parsed = parseImport(JSON.parse(JSON.stringify(blob)), NOW);
    expect(parsed).not.toBeNull();
    const n = rebuildFromEvents(parsed!.events, NOW).nutrition;
    expect(n.meals['m1']?.name).toBe('חזה עוף עם אורז');
    expect(n.targets).toEqual({ calories: 2000, protein: null });
  });
});

describe('normalizeNutrition', () => {
  it('routes garbage to an empty tracker and keeps only well-formed entries', () => {
    expect(normalizeNutrition(null)).toEqual(emptyNutrition());
    expect(normalizeNutrition('junk')).toEqual(emptyNutrition());
    expect(normalizeNutrition([1, 2])).toEqual(emptyNutrition());
    const n = normalizeNutrition({
      meals: { m1: meal('m1'), m2: { date: 'junk' }, m3: 7 },
      deleted: { m1: true, m2: 'yes', '': true },
      targets: { calories: 1e9, protein: 'הרבה' },
    });
    expect(Object.keys(n.meals)).toEqual(['m1']);
    expect(n.deleted).toEqual({ m1: true });
    expect(n.targets).toEqual({ calories: 10000, protein: null });
  });
});

describe('selectors', () => {
  it('sums a day and sorts meals by time then id', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('b', { time: '08:00', calories: 100, protein: 10 }));
    applyNutritionEvent(n, 'meal_logged', meal('a', { time: '20:00', calories: 200, protein: 20 }));
    applyNutritionEvent(n, 'meal_logged', meal('c', { time: '08:00', calories: 50, protein: 5 }));
    applyNutritionEvent(n, 'meal_logged', meal('x', { date: '2026-08-26', calories: 999, protein: 99 }));
    expect(mealsForDate(n, '2026-08-27').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(dayTotals(n, '2026-08-27')).toEqual({ calories: 350, protein: 35, meals: 3 });
  });

  it('recentDays walks the calendar, month boundary included', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('m1', { date: '2026-09-01', calories: 400, protein: 40 }));
    const days = recentDays(n, '2026-09-02', 7);
    expect(days.map((d) => d.date)).toEqual([
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(days[5]?.calories).toBe(400);
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});
