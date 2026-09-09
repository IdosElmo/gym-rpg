/**
 * The ⚖️ weight log's core: the fold, the drivers, the selectors — and above
 * all the MERGE laws, which are the meal tracker's verbatim. Weigh-ins live in
 * `state.nutrition` beside the meals (never in `GameState`), so everything here
 * goes through `rebuildFromEvents` and must converge whichever order two
 * devices' logs are merged in.
 */
import { describe, expect, it } from 'vitest';

import { applyNutritionEvent, emptyNutrition, normalizeNutrition } from '../src/core/nutrition.ts';
import {
  WEIGHT_TREND_WINDOW,
  deleteWeight,
  kgOf,
  logWeight,
  movingAverage,
  setWeightTarget,
  weightEntries,
  weightRecordOf,
  weightSummary,
  type WeightInput,
} from '../src/core/weight.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import {
  CURRENT_STATE_VERSION,
  buildExport,
  migrateState,
  parseImport,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = Date.parse('2026-09-09T10:00:00Z');

function ev(id: string, ts: number, type: AppEvent['type'], payload: Record<string, unknown>): AppEvent {
  return { id, ts, type, payload };
}

function weigh(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id, date: '2026-09-01', time: '07:30', kg: 82.4, note: '', ...over };
}

const input: WeightInput = { date: '2026-09-01', time: '07:30', kg: 82.4, note: 'בבוקר' };

describe('the weight fold', () => {
  it('applies a weigh-in once and ignores every duplicate of its id', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'weight_logged', weigh('w1'));
    applyNutritionEvent(n, 'weight_logged', weigh('w1', { kg: 99 }));
    expect(Object.keys(n.weights)).toEqual(['w1']);
    expect(n.weights['w1']?.kg).toBe(82.4);
  });

  it('rounds to one decimal and trims the note', () => {
    const read = weightRecordOf(weigh('w1', { kg: 82.4499, note: `  בבוקר\n  אחרי  קפה  ${'x'.repeat(100)}` }));
    expect(read?.rec.kg).toBe(82.4);
    expect(read?.rec.note.startsWith('בבוקר אחרי קפה')).toBe(true);
    expect(read?.rec.note).toHaveLength(80);
  });

  it('REFUSES a weight no human has, instead of clamping it', () => {
    expect(weightRecordOf(weigh('w1', { kg: 5 }))).toBeNull();
    expect(weightRecordOf(weigh('w1', { kg: 1000 }))).toBeNull();
    expect(weightRecordOf(weigh('w1', { kg: '82' }))).toBeNull();
    expect(weightRecordOf(weigh('w1', { kg: Number.NaN }))).toBeNull();
    expect(weightRecordOf(weigh('w1', { date: '1.9.2026' }))).toBeNull();
    // date-SHAPED is not enough: the deltas do calendar math on it
    expect(weightRecordOf(weigh('w1', { date: '2026-02-31' }))).toBeNull();
    expect(weightRecordOf(weigh('w1', { date: '2026-13-01' }))).toBeNull();
    expect(weightRecordOf(weigh('', {}))).toBeNull();
    expect(kgOf(20)).toBe(20);
    expect(kgOf(400)).toBe(400);
    expect(kgOf(19.94)).toBeNull();
  });

  it('keeps a bad time as empty instead of refusing the weigh-in', () => {
    expect(weightRecordOf(weigh('w1', { time: 'morning' }))?.rec.time).toBe('');
  });

  it('a garbage target reads as no target', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'weight_target_set', { kg: 78 });
    expect(n.weightTarget).toBe(78);
    applyNutritionEvent(n, 'weight_target_set', { kg: 'soon' });
    expect(n.weightTarget).toBeNull();
    applyNutritionEvent(n, 'weight_target_set', { kg: 3 });
    expect(n.weightTarget).toBeNull();
  });
});

describe('merge convergence', () => {
  const A = [
    ev('e1', 1000, 'weight_logged', weigh('w1')),
    ev('e2', 2000, 'weight_logged', weigh('w2', { date: '2026-09-02', kg: 82.0 })),
    ev('e5', 5000, 'weight_target_set', { kg: 78 }),
  ];
  const B = [ev('e3', 3000, 'weight_deleted', { id: 'w1' }), ev('e4', 4000, 'weight_target_set', { kg: 80 })];

  it('folds identically in both merge orders', () => {
    const ab = rebuildFromEvents([...A, ...B], NOW).nutrition;
    const ba = rebuildFromEvents([...B, ...A], NOW).nutrition;
    expect(ab).toEqual(ba);
    expect(Object.keys(ab.weights).sort()).toEqual(['w1', 'w2']);
    expect(ab.weightDeleted['w1']).toBe(true);
    expect(weightEntries(ab).map((r) => r.id)).toEqual(['w2']);
    // the target is LWW by (ts, id): e5 at ts 5000 wins over e4 at 4000
    expect(ab.weightTarget).toBe(78);
  });

  it('converges when the delete arrives BEFORE the log it tombstones', () => {
    const deleteFirst = [ev('e3', 500, 'weight_deleted', { id: 'w1' }), ev('e1', 1000, 'weight_logged', weigh('w1'))];
    const n = rebuildFromEvents(deleteFirst, NOW).nutrition;
    expect(n.weights['w1']).toBeDefined();
    expect(weightEntries(n)).toHaveLength(0);
  });

  it('breaks a target timestamp tie by event id, both ways', () => {
    const x = ev('a', 1000, 'weight_target_set', { kg: 70 });
    const y = ev('b', 1000, 'weight_target_set', { kg: 75 });
    expect(rebuildFromEvents([x, y], NOW).nutrition.weightTarget).toBe(75);
    expect(rebuildFromEvents([y, x], NOW).nutrition.weightTarget).toBe(75);
  });

  it('data_cleared wipes the weigh-ins with the rest of the tracker', () => {
    const n = rebuildFromEvents([...A, ev('e9', 9000, 'data_cleared', {})], NOW).nutrition;
    expect(n).toEqual(emptyNutrition());
  });

  it('leaves the meals untouched — the two logs share a slot, not a key space', () => {
    const meal = ev('m', 100, 'meal_logged', {
      id: 'w1', // same id as a weigh-in, on purpose
      date: '2026-09-01',
      name: 'שייק',
      calories: 300,
      protein: 30,
      time: '',
      source: 'manual',
    });
    const n = rebuildFromEvents([meal, ...A, ...B], NOW).nutrition;
    expect(n.meals['w1']?.name).toBe('שייק');
    expect(n.deleted['w1']).toBeUndefined(); // the weight tombstone is not a meal tombstone
    expect(n.weightDeleted['w1']).toBe(true);
  });
});

describe('the live drivers', () => {
  it('logWeight appends exactly one event and mirrors the replayed state', () => {
    const store = new LocalStore(fakeStorage());
    const ev1 = logWeight(store, input, 'w1');
    expect(ev1?.type).toBe('weight_logged');
    // the event carries what the reader accepted — rounded, trimmed
    logWeight(store, { ...input, date: '2026-09-02', kg: 82.04, note: '  אחרי  אימון ' }, 'w2');
    deleteWeight(store, 'w1');
    setWeightTarget(store, 78.26);

    const live = store.getState().nutrition;
    const replayed = rebuildFromEvents(store.getEvents(), NOW).nutrition;
    expect(live).toEqual(replayed);
    expect(weightEntries(live).map((r) => r.id)).toEqual(['w2']);
    expect(live.weights['w2']).toEqual({ date: '2026-09-02', time: '07:30', kg: 82, note: 'אחרי אימון' });
    expect(store.getEvents().find((e) => e.type === 'weight_logged' && e.payload['id'] === 'w2')?.payload['kg']).toBe(82);
    expect(live.weightTarget).toBe(78.3);
  });

  it('refuses an invalid weigh-in without appending anything', () => {
    const store = new LocalStore(fakeStorage());
    expect(logWeight(store, { ...input, kg: 2 }, 'w1')).toBeNull();
    expect(logWeight(store, { ...input, date: 'junk' }, 'w2')).toBeNull();
    expect(store.getEvents().filter((e) => e.type === 'weight_logged')).toHaveLength(0);
  });

  it('clears the target with null', () => {
    const store = new LocalStore(fakeStorage());
    setWeightTarget(store, 78);
    setWeightTarget(store, null);
    expect(store.getState().nutrition.weightTarget).toBeNull();
    expect(rebuildFromEvents(store.getEvents(), NOW).nutrition.weightTarget).toBeNull();
  });

  it('round-trips through export → import', () => {
    const store = new LocalStore(fakeStorage());
    logWeight(store, input, 'w1');
    setWeightTarget(store, 78);
    const blob = buildExport(store.getState(), store.getEvents(), NOW);
    const parsed = parseImport(JSON.parse(JSON.stringify(blob)), NOW);
    expect(parsed).not.toBeNull();
    const n = rebuildFromEvents(parsed!.events, NOW).nutrition;
    expect(n.weights['w1']?.kg).toBe(82.4);
    expect(n.weightTarget).toBe(78);
  });
});

describe('normalizeNutrition, weight half', () => {
  it('routes garbage to empty and keeps only well-formed entries', () => {
    const n = normalizeNutrition({
      meals: {},
      weights: { ok: { date: '2026-09-01', time: '07:00', kg: 81.15, note: 'x' }, bad: { date: 'nope', kg: 81 }, junk: 3 },
      weightDeleted: { a: true, b: 'yes', '': true },
      weightTarget: '78',
    });
    expect(Object.keys(n.weights)).toEqual(['ok']);
    expect(n.weights['ok']?.kg).toBe(81.2);
    expect(n.weightDeleted).toEqual({ a: true });
    expect(n.weightTarget).toBeNull();
    // a v6-shaped slot (no weight fields at all) is simply empty
    expect(normalizeNutrition({ meals: {}, deleted: {}, targets: {} })).toEqual(emptyNutrition());
  });

  it('a v6 state blob migrates to v7 with an empty weight log', () => {
    const v6 = {
      schemaVersion: 6,
      sessions: {},
      ui: { view: 'NT', open: {} },
      game: null,
      plan: null,
      planPresets: {},
      nutrition: { meals: {}, deleted: {}, targets: { calories: 2000, protein: null } },
      meta: { legacyImported: false, createdAt: NOW, updatedAt: NOW },
    };
    const s = migrateState(v6, NOW);
    expect(CURRENT_STATE_VERSION).toBe(7);
    expect(s.schemaVersion).toBe(7);
    expect(s.nutrition.targets).toEqual({ calories: 2000, protein: null });
    expect(s.nutrition.weights).toEqual({});
    expect(s.nutrition.weightDeleted).toEqual({});
    expect(s.nutrition.weightTarget).toBeNull();
    expect(s.ui.view).toBe('NT');
  });
});

describe('selectors', () => {
  function log(entries: readonly [string, string, number][]): ReturnType<typeof emptyNutrition> {
    const n = emptyNutrition();
    entries.forEach(([date, time, kg], i) => applyNutritionEvent(n, 'weight_logged', weigh(`w${i}`, { date, time, kg })));
    return n;
  }

  it('orders entries by date, then time, then id — oldest first', () => {
    const n = emptyNutrition();
    applyNutritionEvent(n, 'weight_logged', weigh('b', { date: '2026-09-02', time: '20:00' }));
    applyNutritionEvent(n, 'weight_logged', weigh('c', { date: '2026-09-02', time: '07:00' }));
    applyNutritionEvent(n, 'weight_logged', weigh('a', { date: '2026-09-01', time: '' }));
    applyNutritionEvent(n, 'weight_logged', weigh('d', { date: '2026-09-02', time: '07:00' }));
    expect(weightEntries(n).map((r) => r.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('the moving average trails over the last N entries', () => {
    const rows = weightEntries(log([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`2026-09-0${i}`, '07:00', 80 + i] as const)));
    const avg = movingAverage(rows, 3);
    expect(avg.slice(0, 4)).toEqual([81, 81.5, 82, 83]);
    expect(avg[avg.length - 1]).toBe(87);
    expect(WEIGHT_TREND_WINDOW).toBe(7);
    expect(movingAverage([])).toEqual([]);
  });

  it('summarises an empty log as nothing, not as zeros', () => {
    const s = weightSummary(emptyNutrition());
    expect(s.count).toBe(0);
    expect(s.latest).toBeNull();
    expect(s.sincePrevious).toBeNull();
    expect(s.sevenDay).toBeNull();
    expect(s.toTarget).toBeNull();
    expect(s.targetReached).toBe(false);
  });

  it('measures the deltas against the previous entry, 7 and 30 days back, and the first', () => {
    const n = log([
      ['2026-07-01', '07:00', 90],
      ['2026-08-01', '07:00', 86],
      ['2026-08-25', '07:00', 84.5],
      ['2026-09-01', '07:00', 83],
      ['2026-09-08', '07:00', 82.4],
    ]);
    const s = weightSummary(n);
    expect(s.latest?.kg).toBe(82.4);
    expect(s.sincePrevious).toBe(-0.6);
    // 7 days before 09-08 is 09-01: exactly that entry
    expect(s.sevenDay).toBe(-0.6);
    // 30 days before 09-08 is 08-09: the last entry at or before it is 08-01
    expect(s.thirtyDay).toBe(-3.6);
    expect(s.sinceFirst).toBe(-7.6);
    expect(s.min).toBe(82.4);
    expect(s.max).toBe(90);
  });

  it('says null for a window with no entry that far back', () => {
    const s = weightSummary(log([['2026-09-07', '07:00', 83], ['2026-09-08', '07:00', 82.4]]));
    expect(s.sincePrevious).toBe(-0.6);
    expect(s.sevenDay).toBeNull();
    expect(s.thirtyDay).toBeNull();
  });

  it('reaches a goal in the direction the log started from — losing OR gaining', () => {
    const cut = log([['2026-09-01', '07:00', 85], ['2026-09-08', '07:00', 79.8]]);
    cut.weightTarget = 80;
    expect(weightSummary(cut).toTarget).toBe(0.2);
    expect(weightSummary(cut).targetReached).toBe(true);

    const bulk = log([['2026-09-01', '07:00', 70], ['2026-09-08', '07:00', 72]]);
    bulk.weightTarget = 75;
    expect(weightSummary(bulk).toTarget).toBe(3);
    expect(weightSummary(bulk).targetReached).toBe(false);
    bulk.weightTarget = 71;
    expect(weightSummary(bulk).targetReached).toBe(true);
  });
});
