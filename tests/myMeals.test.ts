/**
 * "הארוחות שלי": the catalog's fixed meals (the original owners' breakfasts)
 * belong to whoever has eaten them — derived from the log, never stored.
 */
import { describe, expect, it } from 'vitest';

import { catalogHints, catalogMealInput, entriesForSlot, myFixedMeals } from '../src/core/catalog.ts';
import { logMeal, deleteMeal } from '../src/core/nutrition.ts';
import { reminderSchedule } from '../src/core/reminders.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function store(): LocalStore {
  const map = new Map<string, string>();
  const s: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
  return new LocalStore(s);
}

function eat(st: LocalStore, id: string, mealId = `m-${id}`): void {
  const input = catalogMealInput({ id, unit: id === 'oats_fine' ? 'cup' : 'portion', qty: 1, date: '2025-01-01', slot: 'breakfast', time: '08:00' });
  if (!input) throw new Error(`no catalog input for ${id}`);
  logMeal(st, input, mealId);
}

describe('my fixed meals', () => {
  it('a fresh user has none — the picker, the hints and the reminders never name them', () => {
    const st = store();
    const mine = myFixedMeals(st.getState().nutrition);
    expect(mine).toEqual([]);
    expect(entriesForSlot('breakfast', false, mine).fits.some((e) => e.kind === 'meal')).toBe(false);
    expect(catalogHints(mine).some((l) => l.startsWith('ארוחה קבועה'))).toBe(false);
    for (const w of reminderSchedule(mine)) {
      expect(w.suggestions.length).toBeGreaterThan(0);
      expect(w.suggestions).not.toContain('שיבולת שועל');
    }
  });

  it('a fixed meal the user has eaten is theirs — even after deleting that entry', () => {
    const st = store();
    eat(st, 'oats_fine', 'food-1'); // a plain food does not make a fixed meal "mine"
    expect(myFixedMeals(st.getState().nutrition)).toEqual([]);
    eat(st, 'oatmeal', 'meal-1');
    expect(myFixedMeals(st.getState().nutrition).map((m) => m.id)).toEqual(['oatmeal']);
    expect(entriesForSlot('breakfast', false, myFixedMeals(st.getState().nutrition)).fits[0]?.id).toBe('oatmeal');
    deleteMeal(st, 'meal-1');
    expect(myFixedMeals(st.getState().nutrition).map((m) => m.id)).toEqual(['oatmeal']);
  });
});
