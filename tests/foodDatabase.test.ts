/**
 * Stage ז — the food database and full macros, in core: the grown catalog is
 * consistent (every food carries carbs and fat that add up to its calories),
 * a pick prices carbs / fat in code like protein, a meal without them stays
 * UNKNOWN (never 0), the default carbs / fat split, the ready meals, the
 * daily menus and their picker, and the estimator's optional carbs / fat.
 */
import { describe, expect, it } from 'vitest';

import { catalogMealInput, catalogProblems, priceCatalog, readyForSlot } from '../src/core/catalog.ts';
import { DEFAULT_FAT_SHARE, defaultSplit, macroTargets } from '../src/core/macros.ts';
import { DEFAULT_MENU_KCAL, menuById, menuFor, menuTotals } from '../src/core/menus.ts';
import {
  dayMacros,
  logMeal,
  mealRecordOf,
  mealsForDate,
  normalizeTargets,
  setTargets,
} from '../src/core/nutrition.ts';
import { DAILY_MENUS, FIXED_MEALS, FOODS, READY_MEALS, type DailyMenu } from '../src/data/foods.ts';
import { parseEstimate } from '../src/nutrition/aiPort.ts';
import type { AppEvent, MealSlot } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = Date.parse('2026-10-03T10:00:00Z');
const DATE = '2026-10-03';

describe('the database', () => {
  it('is ~220 generic foods with stable snake_case ids, and stays problem-free', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(200);
    expect(catalogProblems()).toEqual([]);
    for (const e of [...FOODS, ...READY_MEALS]) expect(e.id, e.id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('keeps every original id and the owners\' fixed meals untouched', () => {
    const starters = [
      'oats_fine', 'soy_milk', 'chia', 'whey', 'egg', 'salad', 'olive_oil', 'oil_spray', 'tahini', 'bread_whole',
      'cottage5', 'protein_yogurt', 'chicken_breast', 'tuna_water', 'salmon', 'rice_cooked', 'lentils',
      'sweet_potato', 'apple', 'banana', 'almonds', 'rice_cake',
    ];
    expect(FOODS.slice(0, starters.length).map((f) => f.id)).toEqual(starters);
    expect(FIXED_MEALS.map((m) => m.id)).toEqual(['oatmeal', 'eggs_salad', 'omelette_salad']);
  });

  it('covers the Israeli staples the stage asked for', () => {
    const ids = new Set(FOODS.map((f) => f.id));
    for (const id of [
      'pita', 'lafa', 'challah', 'couscous', 'bulgur', 'hummus', 'tahini_sauce', 'avocado', 'peanut_butter',
      'cottage3', 'white_cheese5', 'yellow_cheese', 'labneh', 'shakshuka', 'schnitzel', 'shawarma_pita',
      'shawarma_lafa', 'falafel', 'sabich', 'majadra', 'pizza', 'sushi', 'burger', 'burger_bun', 'chicken_soup',
      'israeli_salad', 'bamba', 'bisli', 'dark_chocolate', 'protein_bar', 'granola', 'coffee_milk', 'orange_juice',
      'soda', 'beer', 'wine_red', 'tofu', 'chickpeas',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('gives every food carbs and fat per 100 g, and their energy adds up', () => {
    for (const f of FOODS) {
      expect(f.carbs100, f.id).toBeGreaterThanOrEqual(0);
      expect(f.fat100, f.id).toBeGreaterThanOrEqual(0);
      const energy = 4 * f.protein100 + 4 * f.carbs100 + 9 * f.fat100 + 7 * (f.alcohol100 ?? 0);
      expect(Math.abs(energy - f.kcal100), f.id).toBeLessThanOrEqual(Math.max(f.kcal100 * 0.12, 12));
    }
  });
});

describe('carbs and fat, priced in code', () => {
  it('prices them like protein — totals rounded once, from exact sums', () => {
    // 40 g oats (27.08 C, 2.6 F) + 180 ml soy (2.16 C, 3.24 F) + 12 g chia (5.05 C, 3.68 F) + 30 g whey (2.4 C, 1.8 F)
    expect(priceCatalog('oatmeal', 'portion', 1)).toMatchObject({ calories: 383, protein: 35, carbs: 37, fat: 11 });
    expect(priceCatalog('olive_oil', 'tbsp', 1)).toMatchObject({ carbs: 0, fat: 14 });
    expect(priceCatalog('pita', 'unit', 1)).toMatchObject({ calories: 248, protein: 8, carbs: 50, fat: 1 });
  });

  it('a catalog pick freezes carbs and fat into its payload; live equals replay', () => {
    const store = new LocalStore(fakeStorage());
    const input = catalogMealInput({ id: 'meal_chicken_rice_salad', unit: 'portion', qty: 1, date: DATE, slot: 'lunch', time: '13:00' });
    expect(input).toMatchObject({ calories: 555, protein: 52, carbs: 51, fat: 14, source: 'catalog' });
    const ev = logMeal(store, input!, 'm1');
    expect(ev?.payload).toMatchObject({ carbs: 51, fat: 14 });
    expect(store.getState().nutrition).toEqual(rebuildFromEvents(store.getEvents(), NOW).nutrition);
  });

  it('a meal without carbs / fat stays valid and UNKNOWN — absent, never 0', () => {
    const base = { id: 'x', date: DATE, name: 'ישן', calories: 300, protein: 10, time: '', source: 'manual' };
    const old = mealRecordOf(base)?.rec;
    expect(old).toBeDefined();
    expect('carbs' in (old ?? {})).toBe(false);
    expect('fat' in (old ?? {})).toBe(false);
    expect(mealRecordOf({ ...base, carbs: null, fat: 'x' })?.rec).toEqual(old);
    expect(mealRecordOf({ ...base, carbs: 40.7, fat: -3 })?.rec).toMatchObject({ carbs: 40, fat: 0 });
    expect(mealRecordOf({ ...base, carbs: 1e9, fat: 1e9 })?.rec).toMatchObject({ carbs: 1000, fat: 500 });
  });

  it('the day\'s carbs / fat are a lower bound while a meal lacks them', () => {
    const ev = (id: string, ts: number, payload: Record<string, unknown>): AppEvent => ({ id, ts, type: 'meal_logged', payload });
    const meal = (id: string, over: Record<string, unknown>) => ({ id, date: DATE, name: id, calories: 100, protein: 5, time: '', source: 'manual', ...over });
    const n = rebuildFromEvents(
      [
        ev('e1', 1, meal('a', { carbs: 30, fat: 10 })),
        ev('e2', 2, meal('b', { carbs: 20 })),
        ev('e3', 3, meal('c', {})),
        ev('e4', 4, { ...meal('d', { carbs: 999, fat: 99 }), date: '2026-10-02' }),
      ],
      NOW,
    ).nutrition;
    expect(dayMacros(n, DATE)).toEqual({ carbs: 50, fat: 10, carbsMissing: 1, fatMissing: 2 });
    expect(dayMacros(n, '2026-10-01')).toEqual({ carbs: 0, fat: 0, carbsMissing: 0, fatMissing: 0 });
  });
});

describe('the carbs / fat targets', () => {
  it('derives the default split: fat 30% of calories ÷ 9, carbs the remainder ÷ 4', () => {
    expect(DEFAULT_FAT_SHARE).toBe(0.3);
    // 2000 kcal, 150 g protein: fat 600/9 = 67 g; carbs (2000 − 600 − 603)/4 = 199 g
    expect(defaultSplit(2000, 150)).toEqual({ carbs: 199, fat: 67 });
    // never negative: a protein target that eats the whole budget leaves 0 carbs
    expect(defaultSplit(1200, 300)).toEqual({ carbs: 0, fat: 40 });
    // an explicit fat feeds the remainder in its place
    expect(defaultSplit(2000, 150, 50)).toEqual({ carbs: 238, fat: 50 });
  });

  it('macroTargets: explicit wins, missing is derived only with calories AND protein', () => {
    expect(macroTargets({ calories: 2000, protein: 150 })).toEqual({ carbs: 199, fat: 67, derived: { carbs: true, fat: true } });
    expect(macroTargets({ calories: 2000, protein: 150, carbs: 250 })).toEqual({ carbs: 250, fat: 67, derived: { carbs: false, fat: true } });
    expect(macroTargets({ calories: 2000, protein: 150, fat: 50 })).toEqual({ carbs: 238, fat: 50, derived: { carbs: true, fat: false } });
    expect(macroTargets({ calories: 2000, protein: null })).toEqual({ carbs: null, fat: null, derived: { carbs: false, fat: false } });
    expect(macroTargets({ calories: null, protein: 150, fat: 60 })).toEqual({ carbs: null, fat: 60, derived: { carbs: false, fat: false } });
  });

  it('targets carry optional carbs / fat — LWW whole, so a save without them returns to the default', () => {
    expect(normalizeTargets({ calories: 2000, protein: 150 })).toEqual({ calories: 2000, protein: 150 });
    expect(normalizeTargets({ calories: 2000, protein: 150, carbs: 220, fat: null })).toEqual({ calories: 2000, protein: 150, carbs: 220 });
    const store = new LocalStore(fakeStorage());
    setTargets(store, { calories: 2000, protein: 150, carbs: 220, fat: 60 });
    expect(store.getState().nutrition.targets).toEqual({ calories: 2000, protein: 150, carbs: 220, fat: 60 });
    setTargets(store, { calories: 1900, protein: 140 });
    expect(store.getState().nutrition.targets).toEqual({ calories: 1900, protein: 140 });
    expect(store.getState().nutrition).toEqual(rebuildFromEvents(store.getEvents(), NOW).nutrition);
  });

  it('two devices\' targets converge in both merge orders', () => {
    const a: AppEvent = { id: 'a', ts: 1000, type: 'nutrition_targets_set', payload: { calories: 2000, protein: 150, carbs: 200, fat: 70 } };
    const b: AppEvent = { id: 'b', ts: 2000, type: 'nutrition_targets_set', payload: { calories: 1800, protein: 140 } };
    const ab = rebuildFromEvents([a, b], NOW).nutrition.targets;
    expect(ab).toEqual(rebuildFromEvents([b, a], NOW).nutrition.targets);
    expect(ab).toEqual({ calories: 1800, protein: 140 });
  });
});

describe('the ready meals', () => {
  it('are ~40 meals, one portion each, spread over every meal of the day', () => {
    expect(READY_MEALS.length).toBeGreaterThanOrEqual(40);
    const slots: MealSlot[] = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'other'];
    for (const s of slots) expect(READY_MEALS.filter((m) => m.slots.includes(s)).length, s).toBeGreaterThanOrEqual(8);
    for (const m of READY_MEALS) {
      const p = priceCatalog(m.id, 'portion', 1);
      expect(p, m.id).not.toBeNull();
      // a real meal or snack: 120–900 kcal a portion
      expect(p!.calories, m.id).toBeGreaterThanOrEqual(120);
      expect(p!.calories, m.id).toBeLessThanOrEqual(900);
    }
  });

  it('pins a few everyday plates (re-pin deliberately)', () => {
    expect(priceCatalog('meal_chicken_rice_salad', 'portion', 1)).toMatchObject({ calories: 555, protein: 52, carbs: 51, fat: 14 });
    expect(priceCatalog('meal_shakshuka_bread', 'portion', 1)).toMatchObject({ calories: 445, protein: 20 });
    expect(priceCatalog('meal_cottage_rice_cakes', 'portion', 1)).toMatchObject({ calories: 240, protein: 16 });
    expect(priceCatalog('meal_salmon_sweet_potato', 'portion', 1)).toMatchObject({ calories: 457, protein: 35 });
  });

  it('are listed for a meal of the day apart from the foods — fitting first, the rest on request', () => {
    const b = readyForSlot('breakfast', false);
    expect(b.fits.length).toBeGreaterThan(0);
    expect(b.fits.every((m) => m.slots.includes('breakfast'))).toBe(true);
    expect(b.rest).toEqual([]);
    const all = readyForSlot('breakfast', true);
    expect(all.fits.length + all.rest.length).toBe(READY_MEALS.length);
    expect(readyForSlot(null, false).fits).toHaveLength(READY_MEALS.length);
  });
});

describe('the daily menus', () => {
  it('cover 1500–2600 kcal plus vegetarian days, each landing within 5% of its level', () => {
    expect(DAILY_MENUS.map((m) => [m.kcal, m.vegetarian === true])).toEqual([
      [1500, false],
      [1800, false],
      [2200, false],
      [2600, false],
      [1800, true],
      [2200, true],
    ]);
    for (const m of DAILY_MENUS) {
      const t = menuTotals(m);
      expect(Math.abs(t.calories / m.kcal - 1), m.id).toBeLessThanOrEqual(0.05);
      expect(t.protein, m.id).toBeGreaterThanOrEqual(80);
      // one ready meal per meal of the day, each fitting its slot (catalogProblems checks it too)
      expect(new Set(m.items.map((i) => i.slot)).size, m.id).toBe(m.items.length);
    }
  });

  it('a vegetarian day uses vegetarian ready meals only', () => {
    for (const m of DAILY_MENUS.filter((d) => d.vegetarian)) {
      for (const it of m.items) expect(READY_MEALS.find((r) => r.id === it.meal)?.vegetarian, it.meal).toBe(true);
    }
  });

  it('picks the menu closest to the target; a tie goes to the lower level; no target is the default', () => {
    expect(menuFor(1500)?.id).toBe('menu_1500');
    expect(menuFor(1600)?.id).toBe('menu_1500');
    expect(menuFor(1650)?.id).toBe('menu_1500'); // tie 150/150 → lower
    expect(menuFor(1700)?.id).toBe('menu_1800');
    expect(menuFor(2450)?.id).toBe('menu_2600');
    expect(menuFor(4000)?.id).toBe('menu_2600');
    expect(menuFor(900)?.id).toBe('menu_1500');
    expect(menuFor(null)?.kcal).toBe(DEFAULT_MENU_KCAL);
    expect(menuFor(0)?.kcal).toBe(DEFAULT_MENU_KCAL);
    expect(menuFor(2300, true)?.id).toBe('menu_veg_2200');
    expect(menuFor(1500, true)?.id).toBe('menu_veg_1800');
    expect(menuFor(2000, false, [])).toBeNull();
    expect(menuById('menu_2200')?.kcal).toBe(2200);
    expect(menuById('nope')).toBeNull();
  });

  it('a menu\'s total is exactly what logging each of its meals adds to the day', () => {
    const menu = menuById('menu_1800') as DailyMenu;
    const store = new LocalStore(fakeStorage());
    menu.items.forEach((it, i) => {
      const input = catalogMealInput({ id: it.meal, unit: 'portion', qty: 1, date: DATE, slot: it.slot, time: '' });
      logMeal(store, input!, `m${i}`);
    });
    const rows = mealsForDate(store.getState().nutrition, DATE);
    const t = menuTotals(menu);
    expect(rows.reduce((s, r) => s + r.calories, 0)).toBe(t.calories);
    expect(rows.reduce((s, r) => s + r.protein, 0)).toBe(t.protein);
    expect(dayMacros(store.getState().nutrition, DATE)).toEqual({ carbs: t.carbs, fat: t.fat, carbsMissing: 0, fatMissing: 0 });
  });
});

describe('the estimator\'s optional carbs / fat', () => {
  const line = (name: string, kcal: number, protein_g: number, extra: Record<string, unknown> = {}) => ({
    name, quantity: '', grams: 100, kcal, protein_g, assumed: false, ...extra,
  });

  it('sums the lines when every line carries them', () => {
    const est = parseEstimate({
      confidence: 'high',
      items: [line('אורז', 130, 3, { carbs_g: 28, fat_g: 0.3 }), line('עוף', 165, 31, { carbs_g: 0, fat_g: 3.6 })],
    });
    expect(est).toMatchObject({ calories: 295, proteinG: 34, carbsG: 28, fatG: 4 });
  });

  it('falls back to the answer\'s totals, else leaves them unknown', () => {
    const partial = parseEstimate({ confidence: 'high', carbs_g: 40, items: [line('א', 100, 5, { carbs_g: 10 }), line('ב', 100, 5)] });
    expect(partial?.carbsG).toBe(40);
    expect(partial && 'fatG' in partial).toBe(false);
    const none = parseEstimate({ calories: 500, protein_g: 30, confidence: 'medium', items: ['אורז'] });
    expect(none && ('carbsG' in none || 'fatG' in none)).toBe(false);
  });
});
