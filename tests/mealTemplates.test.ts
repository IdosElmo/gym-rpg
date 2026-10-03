/**
 * Stage ז — "שמירת ארוחה משלי": the user's own saved meals. One template per
 * `meal_template_saved` (whole, LWW per id), deletion a tombstone; folded into
 * `state.nutrition` by the one shared fold, so live state equals replay and
 * two devices' logs converge in either merge order. A saved catalog pick
 * re-prices from the catalog when logged; a free-text one keeps its numbers.
 * State v10 carries the slot; a v9 blob migrates to empty templates.
 */
import { describe, expect, it } from 'vitest';

import { catalogMealInput, templateFromMeal, templateMealInput } from '../src/core/catalog.ts';
import {
  deleteTemplate,
  emptyNutrition,
  liveTemplates,
  logMeal,
  mealsForDate,
  normalizeNutrition,
  saveTemplate,
  templateRecordOf,
} from '../src/core/nutrition.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { CURRENT_STATE_VERSION, migrateState, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

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
const ev = (id: string, ts: number, type: AppEvent['type'], payload: Record<string, unknown>): AppEvent => ({ id, ts, type, payload });

describe('saving and deleting my meals', () => {
  it('saves a template whole, lists it, deletes it with a tombstone — live equals replay', () => {
    const store = new LocalStore(fakeStorage());
    expect(saveTemplate(store, { name: 'שייק בוקר', calories: 320, protein: 30, carbs: 40, fat: 6 }, 't1')).not.toBeNull();
    expect(saveTemplate(store, { name: 'טוסט', calories: 300, protein: 15 }, 't2')).not.toBeNull();
    const n = store.getState().nutrition;
    expect(liveTemplates(n).map((t) => [t.id, t.name, t.carbs ?? null])).toEqual([
      ['t2', 'טוסט', null],
      ['t1', 'שייק בוקר', 40],
    ]);
    deleteTemplate(store, 't2');
    expect(liveTemplates(store.getState().nutrition).map((t) => t.id)).toEqual(['t1']);
    expect(store.getState().nutrition.templates['t2']).toBeDefined(); // tombstoned, not removed
    expect(store.getState().nutrition).toEqual(rebuildFromEvents(store.getEvents(), NOW).nutrition);
    expect(store.getEvents().map((e) => e.type)).toEqual(['meal_template_saved', 'meal_template_saved', 'meal_template_deleted']);
  });

  it('refuses what is not a template: no name, non-numeric numbers', () => {
    const store = new LocalStore(fakeStorage());
    expect(saveTemplate(store, { name: '  ', calories: 100, protein: 1 }, 'x')).toBeNull();
    expect(saveTemplate(store, { name: 'x', calories: Number.NaN, protein: 1 }, 'x')).toBeNull();
    expect(store.getEvents()).toHaveLength(0);
  });

  it('reads a payload defensively: garbage macros and picks are dropped, values clamped', () => {
    const r = templateRecordOf({ id: 't', name: ' a\nb ', calories: 1e9, protein: 12.7, carbs: 'x', fat: 3, pick: { id: '', unit: 'u', qty: 1 } });
    expect(r).toEqual({ id: 't', rec: { name: 'a b', calories: 10000, protein: 12, fat: 3 } });
    const p = templateRecordOf({ id: 't', name: 'a', calories: 1, protein: 1, pick: { id: 'egg', unit: 'unit', qty: 1e6 } });
    expect(p?.rec.pick).toEqual({ id: 'egg', unit: 'unit', qty: 100 });
    expect(templateRecordOf({ id: '', name: 'a', calories: 1, protein: 1 })).toBeNull();
  });
});

describe('merge laws', () => {
  const A = [
    ev('e1', 1000, 'meal_template_saved', { id: 't1', name: 'ישן', calories: 100, protein: 5 }),
    ev('e3', 3000, 'meal_template_saved', { id: 't2', name: 'שני', calories: 200, protein: 10 }),
  ];
  const B = [
    ev('e2', 2000, 'meal_template_saved', { id: 't1', name: 'חדש', calories: 150, protein: 8, carbs: 20 }),
    ev('e4', 4000, 'meal_template_deleted', { id: 't2' }),
  ];

  it('folds identically in both merge orders: LWW per id, tombstones win', () => {
    const ab = rebuildFromEvents([...A, ...B], NOW).nutrition;
    const ba = rebuildFromEvents([...B, ...A], NOW).nutrition;
    expect(ab).toEqual(ba);
    expect(liveTemplates(ab)).toEqual([{ id: 't1', name: 'חדש', calories: 150, protein: 8, carbs: 20 }]);
  });

  it('a delete that arrives BEFORE the save it tombstones still hides it', () => {
    const n = rebuildFromEvents([ev('d', 500, 'meal_template_deleted', { id: 't9' }), ev('s', 900, 'meal_template_saved', { id: 't9', name: 'x', calories: 1, protein: 1 })], NOW).nutrition;
    expect(n.templates['t9']).toBeDefined();
    expect(liveTemplates(n)).toEqual([]);
  });

  it('breaks a timestamp tie by event id, both ways', () => {
    const x = ev('a', 1000, 'meal_template_saved', { id: 't', name: 'A', calories: 1, protein: 1 });
    const y = ev('b', 1000, 'meal_template_saved', { id: 't', name: 'B', calories: 2, protein: 2 });
    expect(liveTemplates(rebuildFromEvents([x, y], NOW).nutrition)[0]?.name).toBe('B');
    expect(liveTemplates(rebuildFromEvents([y, x], NOW).nutrition)[0]?.name).toBe('B');
  });

  it('data_cleared wipes them with the rest of the tracker', () => {
    const n = rebuildFromEvents([...A, ev('z', 9000, 'data_cleared', {})], NOW).nutrition;
    expect(n).toEqual(emptyNutrition());
  });
});

describe('logging a saved meal', () => {
  it('a saved catalog pick re-prices from the catalog, under the saved name', () => {
    const store = new LocalStore(fakeStorage());
    const pick = catalogMealInput({ id: 'pita', unit: 'unit', qty: 2, date: DATE, slot: 'lunch', time: '13:00' })!;
    logMeal(store, pick, 'm1');
    const row = mealsForDate(store.getState().nutrition, DATE)[0]!;
    const tpl = templateFromMeal(row);
    expect(tpl).toEqual({ name: '2 יחידה פיתה', calories: 495, protein: 16, carbs: 100, fat: 2, pick: { id: 'pita', unit: 'unit', qty: 2 } });
    saveTemplate(store, tpl, 't1');
    const saved = liveTemplates(store.getState().nutrition)[0]!;
    const input = templateMealInput(saved, { date: '2026-10-04', slot: 'dinner', time: '' });
    expect(input).toMatchObject({ name: '2 יחידה פיתה', calories: 495, carbs: 100, source: 'catalog', slot: 'dinner', catalog: { id: 'pita', unit: 'unit', qty: 2 } });
  });

  it('a free-text meal keeps its own numbers (carbs / fat only when it had them)', () => {
    const input = templateMealInput(
      { id: 't', name: 'סלט של אמא', calories: 420, protein: 12, fat: 30 },
      { date: DATE, slot: 'dinner', time: '19:00' },
    );
    expect(input).toEqual({ date: DATE, name: 'סלט של אמא', calories: 420, protein: 12, fat: 30, time: '19:00', source: 'manual', slot: 'dinner' });
  });

  it('a saved pick that no longer prices falls back to its stored numbers', () => {
    const input = templateMealInput(
      { id: 't', name: 'x', calories: 100, protein: 5, pick: { id: 'gone', unit: 'unit', qty: 1 } },
      { date: DATE, slot: 'lunch', time: '' },
    );
    expect(input).toMatchObject({ calories: 100, protein: 5, source: 'manual' });
  });
});

describe('state v10', () => {
  it('migrates a v9 blob to empty templates, and round-trips a stored slot', () => {
    expect(CURRENT_STATE_VERSION).toBe(10);
    const v9 = {
      schemaVersion: 9,
      sessions: {},
      ui: { view: 'A', open: {} },
      game: null,
      plan: null,
      planPresets: {},
      nutrition: { meals: {}, deleted: {}, targets: { calories: 2000, protein: 150 } },
      meta: { legacyImported: false, createdAt: NOW, updatedAt: NOW },
    };
    const s = migrateState(v9, NOW);
    expect(s.schemaVersion).toBe(10);
    expect(s.nutrition.templates).toEqual({});
    expect(s.nutrition.templateDeleted).toEqual({});
    expect(s.nutrition.targets).toEqual({ calories: 2000, protein: 150 });
    const n = normalizeNutrition({
      templates: { t1: { name: 'a', calories: 1, protein: 1 }, bad: { name: '' } },
      templateDeleted: { t1: true, junk: 'yes' },
    });
    expect(Object.keys(n.templates)).toEqual(['t1']);
    expect(n.templateDeleted).toEqual({ t1: true });
  });
});
