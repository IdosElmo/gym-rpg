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
  intakeStats,
  logMeal,
  mealRecordOf,
  mealsForDate,
  normalizeNutrition,
  recentDays,
  isDayClosed,
  setDayClosed,
  setTargets,
  shiftDate,
  withMargin,
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
    const read = mealRecordOf(meal('m1', { calories: 1e9, protein: -3, name: `  ${'א'.repeat(400)}  ` }));
    expect(read?.rec.calories).toBe(10000);
    expect(read?.rec.protein).toBe(0);
    expect(read?.rec.name).toHaveLength(300);
    // a multi-line description is stored as one line
    expect(mealRecordOf(meal('m2', { name: 'טוסט\n  עם  גבינה' }))?.rec.name).toBe('טוסט עם גבינה');
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


describe('the stored estimate breakdown', () => {
  const today = '2026-08-27';
  const ai = {
    model: 'gemini',
    confidence: 'medium' as const,
    items: ['4 דפים דף אורז', 'קערה סלט ירקות'],
    breakdown: [
      { name: 'דף אורז', quantity: '4 דפים', grams: 36, kcal: 119, proteinG: 1, assumed: false },
      { name: 'סלט ירקות', quantity: 'קערה', grams: 150, kcal: 33, proteinG: 2, assumed: true },
    ],
    reason: 'כמות לא צוינה: סלט ירקות',
  };

  it('survives the payload → record → blob → record round trip field for field', () => {
    const read = mealRecordOf({ id: 'm1', date: today, name: 'דפי אורז', calories: 152, protein: 3, time: '', source: 'gemini_text', ai });
    expect(read?.rec.ai).toEqual(ai);
    const n = emptyNutrition();
    n.meals['m1'] = read?.rec as NonNullable<typeof read>['rec'];
    expect(normalizeNutrition(JSON.parse(JSON.stringify(n))).meals['m1']?.ai).toEqual(ai);
  });

  it('reads a meal WITHOUT a breakdown exactly as before (no empty arrays invented)', () => {
    const read = mealRecordOf({
      id: 'm2', date: today, name: 'אורז', calories: 100, protein: 2, time: '', source: 'gemini_text',
      ai: { model: 'gemini', confidence: 'high', items: ['אורז'] },
    });
    expect(read?.rec.ai).toEqual({ model: 'gemini', confidence: 'high', items: ['אורז'] });
    expect(read?.rec.ai).not.toHaveProperty('breakdown');
    expect(read?.rec.ai).not.toHaveProperty('reason');
  });

  it('clamps a breakdown from another device: nameless lines dropped, numbers bounded, garbage nulled', () => {
    const read = mealRecordOf({
      id: 'm3', date: today, name: 'x', calories: 1, protein: 1, time: '', source: 'gemini_text',
      ai: {
        model: 'gemini', confidence: 'low', items: [],
        breakdown: [
          { name: '', kcal: 5 },
          { name: 'שמן', quantity: 7, grams: 999999, kcal: -4, proteinG: 'x', assumed: 'yes' },
          'not a line',
        ],
        reason: 42,
      },
    });
    expect(read?.rec.ai?.breakdown).toEqual([{ name: 'שמן', quantity: '', grams: 2000, kcal: 0, proteinG: null, assumed: false }]);
    expect(read?.rec.ai).not.toHaveProperty('reason');
  });
});

describe('intakeStats', () => {
  const day = (date: string, calories: number, protein: number, meals: number, closed = false) => ({
    date,
    calories,
    protein,
    meals,
    closed,
  });

  it('averages over TRACKED days only — an unlogged day is not a zero', () => {
    const s = intakeStats([day('2026-08-25', 2000, 100, 3), day('2026-08-26', 0, 0, 0), day('2026-08-27', 1000, 50, 1)]);
    expect(s.tracked).toBe(2);
    expect(s.avgCalories).toBe(1500);
    expect(s.avgProtein).toBe(75);
    expect(s.peak?.date).toBe('2026-08-25');
  });

  it('is empty, not NaN, over a window with nothing logged', () => {
    expect(intakeStats([day('2026-08-27', 0, 0, 0)])).toEqual({ tracked: 0, avgCalories: null, avgProtein: null, peak: null });
    expect(intakeStats([])).toEqual({ tracked: 0, avgCalories: null, avgProtein: null, peak: null });
  });

  it('closedOnly averages over CLOSED days only — a half-logged day is not a whole one', () => {
    const days = [day('2026-08-25', 2000, 100, 3, true), day('2026-08-26', 600, 20, 1), day('2026-08-27', 1800, 80, 2, true)];
    expect(intakeStats(days).avgCalories).toBe(1467);
    const s = intakeStats(days, true);
    expect(s.tracked).toBe(2);
    expect(s.avgCalories).toBe(1900);
    expect(s.avgProtein).toBe(90);
    expect(intakeStats([day('2026-08-26', 600, 20, 1)], true).avgCalories).toBeNull();
  });

  it('rounds to whole units', () => {
    const s = intakeStats([day('a', 1000, 10, 1), day('b', 1001, 11, 1), day('c', 1001, 11, 1)]);
    expect(s.avgCalories).toBe(1001);
    expect(s.avgProtein).toBe(11);
  });
});

describe('"סגרתי את היום" — nutrition_day_closed', () => {
  const closeEv = (id: string, ts: number, date: string, closed: boolean) =>
    ev(id, ts, 'nutrition_day_closed', { date, closed });

  it('is LWW per date: close → reopen → close, and the last one decides', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('m1'));
    applyNutritionEvent(n, 'nutrition_day_closed', { date: '2026-08-27', closed: true });
    expect(isDayClosed(n, '2026-08-27')).toBe(true);
    applyNutritionEvent(n, 'nutrition_day_closed', { date: '2026-08-27', closed: false });
    expect(isDayClosed(n, '2026-08-27')).toBe(false);
    expect(n.closedDays).toEqual({});
    applyNutritionEvent(n, 'nutrition_day_closed', { date: '2026-08-27', closed: true });
    expect(isDayClosed(n, '2026-08-27')).toBe(true);
  });

  it('ignores a garbage payload', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'nutrition_day_closed', { date: 'junk', closed: true });
    applyNutritionEvent(n, 'nutrition_day_closed', { date: '2026-08-27', closed: 'yes' });
    expect(n.closedDays).toEqual({});
  });

  it('folds identically in both merge orders, per date, ties broken by event id', () => {
    const A = [ev('e1', 1000, 'meal_logged', meal('m1')), closeEv('c1', 2000, '2026-08-27', true), closeEv('c3', 5000, '2026-08-26', true)];
    const B = [
      ev('e2', 1500, 'meal_logged', meal('m2', { date: '2026-08-26' })),
      closeEv('c2', 3000, '2026-08-27', false),
      closeEv('c4', 5000, '2026-08-26', false),
    ];
    const ab = rebuildFromEvents([...A, ...B], NOW).nutrition;
    const ba = rebuildFromEvents([...B, ...A], NOW).nutrition;
    expect(ab).toEqual(ba);
    // 08-27: the reopen at 3000 is last; 08-26: a ts tie, 'c4' > 'c3' wins
    expect(ab.closedDays).toEqual({});
    const later = rebuildFromEvents([...B, ...A, closeEv('c5', 6000, '2026-08-27', true)], NOW).nutrition;
    expect(later.closedDays).toEqual({ '2026-08-27': true });
  });

  it('a closed day whose meals are all gone does not read as closed', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'meal_logged', meal('m1'));
    applyNutritionEvent(n, 'nutrition_day_closed', { date: '2026-08-27', closed: true });
    applyNutritionEvent(n, 'meal_deleted', { id: 'm1' });
    expect(isDayClosed(n, '2026-08-27')).toBe(false);
    expect(recentDays(n, '2026-08-27', 1)[0]?.closed).toBe(false);
  });

  it('the driver refuses to close an empty day, and mirrors the replayed state', () => {
    const store = new LocalStore(fakeStorage());
    expect(setDayClosed(store, '2026-08-27', true)).toBeNull();
    expect(setDayClosed(store, 'junk', false)).toBeNull();
    expect(store.getEvents().filter((e) => e.type === 'nutrition_day_closed')).toHaveLength(0);

    logMeal(store, input, 'm1');
    expect(setDayClosed(store, '2026-08-27', true)?.type).toBe('nutrition_day_closed');
    expect(recentDays(store.getState().nutrition, '2026-08-27', 2).map((d) => d.closed)).toEqual([false, true]);
    setDayClosed(store, '2026-08-27', false);
    setDayClosed(store, '2026-08-27', true);
    const live = store.getState().nutrition;
    expect(live).toEqual(rebuildFromEvents(store.getEvents(), NOW).nutrition);
    expect(live.closedDays).toEqual({ '2026-08-27': true });
  });

  it('survives the stored blob (normalizeNutrition) and drops garbage keys', () => {
    const n = normalizeNutrition({ closedDays: { '2026-08-27': true, junk: true, '2026-08-28': 'yes' } });
    expect(n.closedDays).toEqual({ '2026-08-27': true });
    expect(normalizeNutrition({}).closedDays).toEqual({});
  });

  it('data_cleared forgets the closed days too', () => {
    const n = rebuildFromEvents(
      [ev('e1', 1000, 'meal_logged', meal('m1')), closeEv('c1', 2000, '2026-08-27', true), ev('e9', 9000, 'data_cleared', {})],
      NOW,
    ).nutrition;
    expect(n.closedDays).toEqual({});
  });
});

describe('withMargin — the under-estimation lens', () => {
  it('inflates by the percentage and rounds to a whole unit', () => {
    expect(withMargin(1800, 10)).toBe(1980);
    expect(withMargin(1800, 20)).toBe(2160);
    expect(withMargin(1234, 10)).toBe(1357);
    expect(withMargin(0, 20)).toBe(0);
    expect(withMargin(1500, 0)).toBe(1500);
  });
});
