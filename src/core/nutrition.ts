/**
 * core/nutrition.ts — the meal tracker's fold, drivers and selectors.
 *
 * DESIGN — a tracker, not a game system
 * -------------------------------------
 * Meals grant NOTHING: no XP, no energy, no coins. `applyGameEvent` never sees
 * these event types (unknown types fall to its `default:`), so the nutrition
 * ledger lives beside `sessions` and `plan` on `AppState`, not inside
 * `GameState` — and `GAME_STATE_VERSION` does not move for it.
 *
 * Like `plan`, `state.nutrition` is a CACHE of the log. The ONE fold below
 * (`applyNutritionEvent`) is shared by the live write path (append then mirror,
 * the same trick `savePlan` uses) and by `rebuildFromEvents`, which is what
 * makes replay provably equivalent to live state.
 *
 * MERGE SEMANTICS (all order-free under the `(ts, id)` total order):
 *   meal_logged           -> first write per meal id wins; ids are uuids, so two
 *                            devices cannot collide and a duplicate is a no-op.
 *   meal_deleted          -> a tombstone set, union-monotone: delete-before-log
 *                            and log-before-delete converge (render = meals
 *                            minus deleted). "Re-adding" is a NEW uuid, so a
 *                            tombstone never resurrects anything.
 *   nutrition_targets_set -> whole targets object in the payload, last writer
 *                            wins — byte-for-byte the `plan_updated` rule.
 *   data_cleared          -> resets nutrition to empty (handled by the caller's
 *                            switch, like `sessions`/`plan`).
 */

import type {
  AppEvent,
  DataStore,
  EventType,
  MealAiInfo,
  MealLoggedPayload,
  MealRecord,
  MealSource,
  NutritionState,
  NutritionTargets,
} from '../storage/DataStore.ts';

/* -------------------------------------------------------------- constants */

/** Sanity clamps — a payload is data from ANOTHER device until proven benign. */
export const MEAL_MAX_CALORIES = 10000;
export const MEAL_MAX_PROTEIN = 500;
export const MEAL_MAX_NAME_LEN = 120;
const AI_MAX_ITEMS = 10;
const AI_MAX_ITEM_LEN = 60;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

const MEAL_SOURCES: readonly MealSource[] = ['manual', 'gemini_text', 'gemini_photo'];
const CONFIDENCES = ['low', 'medium', 'high'] as const;

export function emptyNutrition(): NutritionState {
  return { meals: {}, deleted: {}, targets: { calories: null, protein: null } };
}

/* ---------------------------------------------------------------- readers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampInt(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n < 0 ? 0 : n > max ? max : n;
}

function aiInfoOf(raw: unknown): MealAiInfo | null {
  if (!isRecord(raw)) return null;
  const model = raw['model'];
  const confidence = raw['confidence'];
  if (typeof model !== 'string' || !model) return null;
  if (!CONFIDENCES.includes(confidence as (typeof CONFIDENCES)[number])) return null;
  const items: string[] = [];
  if (Array.isArray(raw['items'])) {
    for (const it of raw['items']) {
      if (typeof it === 'string' && it.trim()) items.push(it.trim().slice(0, AI_MAX_ITEM_LEN));
      if (items.length >= AI_MAX_ITEMS) break;
    }
  }
  return { model: model.slice(0, AI_MAX_ITEM_LEN), confidence: confidence as MealAiInfo['confidence'], items };
}

/**
 * Read a `meal_logged` payload into a valid `MealRecord`, or `null` when the
 * payload is not a meal (bad date, empty name, non-numeric values). Used by the
 * fold, by `normalizeNutrition` (a stored blob is just as untrusted) and by the
 * live driver as its validation gate — ONE reader, three doors.
 */
export function mealRecordOf(payload: Record<string, unknown>): { id: string; rec: MealRecord } | null {
  const id = payload['id'];
  const date = payload['date'];
  const name = typeof payload['name'] === 'string' ? payload['name'].trim().slice(0, MEAL_MAX_NAME_LEN) : '';
  if (typeof id !== 'string' || !id) return null;
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) return null;
  if (!name) return null;
  const calories = clampInt(payload['calories'], MEAL_MAX_CALORIES);
  const protein = clampInt(payload['protein'], MEAL_MAX_PROTEIN);
  if (calories === null || protein === null) return null;
  const time = typeof payload['time'] === 'string' && HHMM_RE.test(payload['time']) ? payload['time'] : '';
  const source: MealSource = MEAL_SOURCES.includes(payload['source'] as MealSource)
    ? (payload['source'] as MealSource)
    : 'manual';
  const ai = aiInfoOf(payload['ai']);
  const rec: MealRecord = { date, name, calories, protein, time, source, ...(ai ? { ai } : {}) };
  return { id, rec };
}

/** Read ANY targets-shaped value; missing / garbage fields become `null`. */
export function normalizeTargets(raw: unknown): NutritionTargets {
  const out: NutritionTargets = { calories: null, protein: null };
  if (!isRecord(raw)) return out;
  out.calories = clampInt(raw['calories'], MEAL_MAX_CALORIES);
  out.protein = clampInt(raw['protein'], MEAL_MAX_PROTEIN);
  return out;
}

/** Route ANY persisted nutrition blob to a valid `NutritionState`. Never throws. */
export function normalizeNutrition(raw: unknown): NutritionState {
  const n = emptyNutrition();
  if (!isRecord(raw)) return n;
  const meals = raw['meals'];
  if (isRecord(meals)) {
    for (const key of Object.keys(meals)) {
      const entry = meals[key];
      if (!isRecord(entry)) continue;
      const read = mealRecordOf({ ...entry, id: key });
      if (read) n.meals[key] = read.rec;
    }
  }
  const deleted = raw['deleted'];
  if (isRecord(deleted)) {
    for (const key of Object.keys(deleted)) {
      if (key && deleted[key] === true) n.deleted[key] = true;
    }
  }
  n.targets = normalizeTargets(raw['targets']);
  return n;
}

/* ------------------------------------------------------------------- fold */

/**
 * THE nutrition fold — one event into the state, in place. Idempotent under
 * union merge: a `meal_logged` whose id is already present is a no-op, a
 * tombstone is monotone, targets are last-writer-wins (the caller feeds events
 * in the `(ts, id)` total order, so "last applied" IS "last in the order").
 */
export function applyNutritionEvent(
  n: NutritionState,
  type: EventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  switch (type) {
    case 'meal_logged': {
      const read = mealRecordOf(payload as Record<string, unknown>);
      if (!read || n.meals[read.id]) break;
      n.meals[read.id] = read.rec;
      break;
    }
    case 'meal_deleted': {
      const id = payload['id'];
      if (typeof id === 'string' && id) n.deleted[id] = true;
      break;
    }
    case 'nutrition_targets_set':
      n.targets = normalizeTargets(payload);
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- drivers */

/** What the UI knows about a meal before it becomes an event. */
export interface MealInput {
  date: string;
  name: string;
  calories: number;
  protein: number;
  /** 'HH:MM' for display, or '' when unknown. */
  time: string;
  source: MealSource;
  ai?: MealAiInfo;
}

/**
 * Append ONE `meal_logged` event and mirror it into `state.nutrition`, or
 * return `null` (and append nothing) when the input does not read as a meal.
 * The uuid comes from the CALLER — the UI mints `crypto.randomUUID()`, tests
 * pass fixed ids — which keeps this module deterministic.
 */
export function logMeal(store: DataStore, input: MealInput, id: string): AppEvent | null {
  const payload: MealLoggedPayload = {
    id,
    date: input.date,
    name: input.name,
    calories: input.calories,
    protein: input.protein,
    time: input.time,
    source: input.source,
    ...(input.ai ? { ai: input.ai } : {}),
  };
  if (!mealRecordOf(payload)) return null;
  const ev = store.append('meal_logged', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'meal_logged', payload));
  return ev;
}

/** Append the tombstone for one meal id and mirror it. */
export function deleteMeal(store: DataStore, id: string): AppEvent | null {
  if (!id) return null;
  const payload = { id };
  const ev = store.append('meal_deleted', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'meal_deleted', payload));
  return ev;
}

/** Save the daily targets (whole object, LWW like the plan) and mirror them. */
export function setTargets(store: DataStore, targets: { calories: number | null; protein: number | null }): AppEvent {
  const clean = normalizeTargets(targets);
  const payload = { calories: clean.calories, protein: clean.protein };
  const ev = store.append('nutrition_targets_set', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'nutrition_targets_set', payload));
  return ev;
}

/* -------------------------------------------------------------- selectors */

export interface MealRow extends MealRecord {
  id: string;
}

/** Live meals of one date, tombstones filtered, sorted by time then id. */
export function mealsForDate(n: NutritionState, date: string): MealRow[] {
  const out: MealRow[] = [];
  for (const id of Object.keys(n.meals)) {
    const rec = n.meals[id];
    if (!rec || rec.date !== date || n.deleted[id]) continue;
    out.push({ id, ...rec });
  }
  out.sort((a, b) => (a.time === b.time ? (a.id < b.id ? -1 : 1) : a.time < b.time ? -1 : 1));
  return out;
}

export interface DayTotals {
  calories: number;
  protein: number;
  meals: number;
}

export function dayTotals(n: NutritionState, date: string): DayTotals {
  const t: DayTotals = { calories: 0, protein: 0, meals: 0 };
  for (const row of mealsForDate(n, date)) {
    t.calories += row.calories;
    t.protein += row.protein;
    t.meals += 1;
  }
  return t;
}

/** Shift an ISO date by whole days — pure calendar math, no clock involved. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DaySummary extends DayTotals {
  date: string;
}

/** The last `count` days ENDING at `today`, oldest first. */
export function recentDays(n: NutritionState, today: string, count = 7): DaySummary[] {
  const out: DaySummary[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    out.push({ date, ...dayTotals(n, date) });
  }
  return out;
}
