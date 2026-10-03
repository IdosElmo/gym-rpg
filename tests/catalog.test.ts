/**
 * The food catalog and the meals of the day: the catalog is internally
 * consistent, a pick prices in CODE to pinned numbers, quantities read the
 * way people type them, and a catalog meal / a slot survive the event log —
 * live state equals replay, both merge orders converge, garbage is dropped.
 */
import { describe, expect, it } from 'vitest';

import {
  catalogHints,
  catalogMealInput,
  catalogName,
  catalogProblems,
  entriesForSlot,
  fmtQty,
  HINT_MAX_LINES,
  parseQty,
  priceCatalog,
  PORTION,
} from '../src/core/catalog.ts';
import { MEAL_SLOTS, logMeal, mealRecordOf, mealsForDate, normalizeNutrition, slotAt } from '../src/core/nutrition.ts';
import { FIXED_MEALS, FOODS } from '../src/data/foods.ts';
import { createEdgeAiPort } from '../src/nutrition/edgePort.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
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

const NOW = Date.parse('2026-09-28T10:00:00Z');
const DATE = '2026-09-28';

describe('the catalog itself', () => {
  it('has no problems: unique ids, known slots, units, components that resolve', () => {
    expect(catalogProblems()).toEqual([]);
  });

  it('ships the owner\'s two fixed meals, in the meals they were asked for', () => {
    const oat = FIXED_MEALS.find((m) => m.id === 'oatmeal');
    const eggs = FIXED_MEALS.find((m) => m.id === 'eggs_salad');
    expect(oat?.slots).toEqual(['breakfast', 'dinner']);
    expect(oat?.components.map((c) => [c.food, c.unit, c.qty])).toEqual([
      ['oats_fine', 'cup', 0.5],
      ['soy_milk', 'cup', 0.75],
      ['chia', 'tbsp', 1],
      ['whey', 'scoop', 1],
    ]);
    expect(eggs?.slots).toEqual(['dinner', 'breakfast']);
    expect(eggs?.components.map((c) => [c.food, c.unit, c.qty])).toEqual([
      ['egg', 'unit', 2],
      ['salad', 'bowl', 1],
    ]);
  });
});

describe('pricing, in code', () => {
  it('prices the oatmeal from its four components (totals rounded once, from exact sums)', () => {
    // 40 g oats 151.6 + 180 ml soy 59.4 + 12 g chia 58.32 + 30 g whey 114 = 383.32
    const p = priceCatalog('oatmeal', 'portion', 1);
    expect(p?.calories).toBe(383);
    expect(p?.protein).toBe(35);
    expect(p?.lines.map((l) => [l.name, l.quantity, l.grams, l.kcal])).toEqual([
      ['שיבולת שועל דקה', '½ כוס', 40, 152],
      ['חלב סויה ללא סוכר', '¾ כוס', 180, 59],
      ['זרעי צ׳יה', '1 כף', 12, 58],
      ['אבקת חלבון', '1 סקופ', 30, 114],
    ]);
    expect(p?.lines.every((l) => l.assumed === false)).toBe(true);
  });

  it('prices the eggs with salad, and scales a meal by portions', () => {
    expect(priceCatalog('eggs_salad', 'portion', 1)).toMatchObject({ calories: 207, protein: 16 });
    // the omelette: the same eggs and salad plus one pan of spray (~1 g, 9 kcal)
    expect(priceCatalog('omelette_salad', 'portion', 1)).toMatchObject({ calories: 216, protein: 16 });
    expect(priceCatalog('oatmeal', 'portion', 0.5)).toMatchObject({ calories: 192, protein: 18 });
    expect(priceCatalog('oatmeal', 'portion', 2)).toMatchObject({ calories: 767, protein: 70 });
  });

  it('prices a single food by unit and quantity', () => {
    expect(priceCatalog('olive_oil', 'tbsp', 1)).toMatchObject({ calories: 119, protein: 0 });
    expect(priceCatalog('chicken_breast', 'g100', 1.5)).toMatchObject({ calories: 248, protein: 47 });
    expect(priceCatalog('egg', 'unit', 3)?.lines).toHaveLength(1);
  });

  it('refuses what does not price: unknown entry, wrong unit, a bad quantity', () => {
    expect(priceCatalog('nope', 'cup', 1)).toBeNull();
    expect(priceCatalog('oats_fine', 'scoop', 1)).toBeNull();
    expect(priceCatalog('oatmeal', 'cup', 1)).toBeNull();
    expect(priceCatalog('egg', 'unit', 0)).toBeNull();
    expect(priceCatalog('egg', 'unit', -1)).toBeNull();
    expect(priceCatalog('egg', 'unit', Number.NaN)).toBeNull();
    expect(priceCatalog('egg', 'unit', 101)).toBeNull();
  });
});

describe('quantities as people type them', () => {
  it('reads decimals, commas, fractions, mixed numbers and glyphs', () => {
    expect(parseQty('1')).toBe(1);
    expect(parseQty(' 0.5 ')).toBe(0.5);
    expect(parseQty('0,5')).toBe(0.5);
    expect(parseQty('.5')).toBe(0.5);
    expect(parseQty('1/2')).toBe(0.5);
    expect(parseQty('3/4')).toBe(0.75);
    expect(parseQty('1 1/2')).toBe(1.5);
    expect(parseQty('½')).toBe(0.5);
    expect(parseQty('1½')).toBe(1.5);
    expect(parseQty('1/3')).toBe(0.33);
  });

  it('refuses empty, zero, negative, garbage and absurd quantities', () => {
    for (const bad of ['', '0', '-1', 'abc', '1/0', '2..5', '1e3', '101', 'x½']) expect(parseQty(bad)).toBeNull();
  });

  it('writes a quantity back the way a recipe would', () => {
    expect(fmtQty(0.5)).toBe('½');
    expect(fmtQty(0.75)).toBe('¾');
    expect(fmtQty(1.5)).toBe('1½');
    expect(fmtQty(2)).toBe('2');
    expect(fmtQty(0.3)).toBe('0.3');
  });

  it('names a pick for the meal list', () => {
    const oat = FIXED_MEALS[0]!;
    const oats = FOODS.find((f) => f.id === 'oats_fine')!;
    expect(catalogName(oat, PORTION, 1)).toBe('שיבולת שועל');
    expect(catalogName(oat, PORTION, 0.5)).toBe('½ מנה · שיבולת שועל');
    expect(catalogName(oat, PORTION, 2)).toBe('2 מנות · שיבולת שועל');
    expect(catalogName(oats, oats.units[0]!, 0.5)).toBe('½ כוס שיבולת שועל דקה');
  });
});

describe('the meals of the day', () => {
  it('lists six meals in order, with the owner\'s windows', () => {
    expect(MEAL_SLOTS.map((s) => [s.key, s.from, s.to])).toEqual([
      ['breakfast', '08:00', '10:00'],
      ['snack_am', '10:00', '12:00'],
      ['lunch', '12:00', '16:00'],
      ['snack_pm', '16:00', '18:00'],
      ['dinner', '18:00', '21:00'],
      ['other', null, null],
    ]);
  });

  it('picks the meal by the clock, window ends exclusive; outside every window it is נשנושים', () => {
    expect(slotAt('07:59')).toBe('other');
    expect(slotAt('08:00')).toBe('breakfast');
    expect(slotAt('09:59')).toBe('breakfast');
    expect(slotAt('10:00')).toBe('snack_am');
    expect(slotAt('12:00')).toBe('lunch');
    expect(slotAt('16:00')).toBe('snack_pm');
    expect(slotAt('18:00')).toBe('dinner');
    expect(slotAt('20:59')).toBe('dinner');
    expect(slotAt('21:00')).toBe('other');
  });

  it('lists fixed meals first, then foods; "all" appends the rest of the catalog', () => {
    const { fits, rest } = entriesForSlot('breakfast', false);
    expect(fits.slice(0, 3).map((e) => e.id)).toEqual(['oatmeal', 'eggs_salad', 'omelette_salad']);
    expect(fits.every((e) => e.slots.includes('breakfast'))).toBe(true);
    expect(rest).toEqual([]);
    const all = entriesForSlot('breakfast', true);
    expect(all.rest.some((e) => e.id === 'tuna_water')).toBe(true);
    expect(all.fits.length + all.rest.length).toBe(FIXED_MEALS.length + FOODS.length);
    // lunch has no fixed meal yet — only foods
    expect(entriesForSlot('lunch', false).fits.every((e) => e.kind === 'food')).toBe(true);
  });
});

describe('a catalog pick in the event log', () => {
  it('logs as source catalog with its slot and frozen lines; live equals replay', () => {
    const store = new LocalStore(fakeStorage());
    const input = catalogMealInput({ id: 'oatmeal', unit: 'portion', qty: 1, date: DATE, slot: 'breakfast', time: '08:30' });
    expect(input).not.toBeNull();
    const ev = logMeal(store, input!, 'm1');
    expect(ev?.payload).toMatchObject({
      name: 'שיבולת שועל',
      calories: 383,
      protein: 35,
      source: 'catalog',
      slot: 'breakfast',
      catalog: { id: 'oatmeal', unit: 'portion', qty: 1 },
    });
    const live = store.getState().nutrition;
    expect(live).toEqual(rebuildFromEvents(store.getEvents(), NOW).nutrition);
    expect(mealsForDate(live, DATE)[0]?.catalog?.lines).toHaveLength(4);
  });

  it('refuses a pick that does not price', () => {
    expect(catalogMealInput({ id: 'nope', unit: 'portion', qty: 1, date: DATE, slot: 'lunch', time: '' })).toBeNull();
    expect(catalogMealInput({ id: 'egg', unit: 'portion', qty: 1, date: DATE, slot: 'lunch', time: '' })).toBeNull();
  });

  it('converges in both merge orders with slotted, catalog and legacy meals', () => {
    const a = catalogMealInput({ id: 'eggs_salad', unit: 'portion', qty: 1, date: DATE, slot: 'dinner', time: '19:00' })!;
    const ev = (id: string, ts: number, payload: Record<string, unknown>): AppEvent => ({ id, ts, type: 'meal_logged', payload });
    const A = [ev('e1', 1000, { id: 'm1', ...a })];
    const B = [
      ev('e2', 2000, { id: 'm2', date: DATE, name: 'קפה', calories: 40, protein: 2, time: '10:30', source: 'manual', slot: 'snack_am' }),
      ev('e3', 3000, { id: 'm3', date: DATE, name: 'ישן', calories: 300, protein: 10, time: '', source: 'manual' }),
    ];
    const ab = rebuildFromEvents([...A, ...B], NOW).nutrition;
    const ba = rebuildFromEvents([...B, ...A], NOW).nutrition;
    expect(ab).toEqual(ba);
    expect(mealsForDate(ab, DATE).map((r) => [r.id, r.slot ?? null])).toEqual([
      ['m3', null],
      ['m2', 'snack_am'],
      ['m1', 'dinner'],
    ]);
  });

  it('reads a slot and catalog info defensively: garbage is dropped, the meal is kept', () => {
    const base = { id: 'm1', date: DATE, name: 'x', calories: 100, protein: 5, time: '', source: 'catalog' };
    expect(mealRecordOf({ ...base, slot: 'brunch' })?.rec.slot).toBeUndefined();
    expect(mealRecordOf({ ...base, slot: 'lunch' })?.rec.slot).toBe('lunch');
    expect(mealRecordOf({ ...base, catalog: { id: '', unit: 'x', qty: 1 } })?.rec.catalog).toBeUndefined();
    expect(mealRecordOf({ ...base, catalog: { id: 'egg', unit: 'unit', qty: -2 } })?.rec.catalog).toBeUndefined();
    const huge = mealRecordOf({ ...base, catalog: { id: 'egg', unit: 'unit', qty: 1e9, lines: ['junk', { name: '' }] } });
    expect(huge?.rec.catalog).toEqual({ id: 'egg', unit: 'unit', qty: 100, lines: [] });
    // a stored blob round-trips both fields
    const n = normalizeNutrition({
      meals: { m1: { ...base, slot: 'dinner', catalog: { id: 'egg', unit: 'unit', qty: 2, lines: [] } } },
    });
    expect(n.meals['m1']?.slot).toBe('dinner');
    expect(n.meals['m1']?.catalog?.qty).toBe(2);
  });
});

describe('the catalog as estimator hints', () => {
  it('has one line per fixed meal (first) and per food, capped at what the function reads', () => {
    const hints = catalogHints();
    expect(hints).toHaveLength(Math.min(HINT_MAX_LINES, FOODS.length + FIXED_MEALS.length));
    expect(hints[0]?.startsWith('ארוחה קבועה "שיבולת שועל"')).toBe(true);
    expect(hints).toContain(
      'ארוחה קבועה "שיבולת שועל" (מנה אחת) = ½ כוס שיבולת שועל דקה + ¾ כוס חלב סויה ללא סוכר + 1 כף זרעי צ׳יה + 1 סקופ אבקת חלבון',
    );
    expect(hints.find((h) => h.startsWith('שמן זית'))).toBe('שמן זית: כפית=4.5 ג׳, כף=13.5 ג׳; 884 קק״ל ו-0 ג׳ חלבון ל-100 ג׳');
  });

  it('rides along in the Edge Function body, and is left out when empty', async () => {
    const bodies: Record<string, unknown>[] = [];
    const port = createEdgeAiPort({
      invoke: (body) => {
        bodies.push(body);
        return Promise.resolve({ ok: true, data: { calories: 1, protein_g: 1, confidence: 'high', items: [] } });
      },
      isSignedIn: () => true,
    });
    await port.estimate({ text: 'שיבולת שועל', catalog: ['a', 'b'] });
    await port.estimate({ text: 'סלט', catalog: [] });
    expect(bodies).toEqual([{ text: 'שיבולת שועל', catalog: ['a', 'b'] }, { text: 'סלט' }]);
  });
});
