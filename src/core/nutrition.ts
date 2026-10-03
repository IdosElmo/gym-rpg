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
 *   nutrition_day_closed  -> "סגרתי את היום": last writer wins PER DATE (the
 *                            same rule, keyed by day), so close → reopen →
 *                            close converges. The fold accepts any date; the
 *                            driver refuses to close a day with no meals.
 *   meal_template_saved   -> "שמירת ארוחה משלי": the WHOLE template per event,
 *                            last writer wins PER TEMPLATE ID (the
 *                            `nutrition_targets_set` rule, keyed by id).
 *   meal_template_deleted -> a tombstone set, the `meal_deleted` rule: render =
 *                            templates minus deleted, so delete-before-save and
 *                            save-before-delete converge.
 *   data_cleared          -> resets nutrition to empty (handled by the caller's
 *                            switch, like `sessions`/`plan`).
 *   weight_*              -> the ⚖️ weight log shares this slot and this fold;
 *                            its three laws are the three above, verbatim
 *                            (see core/weight.ts, which the fold delegates to).
 *   photo_*               -> the 📸 progress photos too — metadata only; the
 *                            pixels live in the BlobStore (see core/photos.ts).
 */

import type {
  AppEvent,
  DataStore,
  EventType,
  MealAiInfo,
  MealAiItem,
  MealCatalogInfo,
  MealLoggedPayload,
  MealRecord,
  MealSlot,
  MealSource,
  MealTemplatePick,
  MealTemplateRecord,
  MealTemplateSavedPayload,
  NutritionDayClosedPayload,
  NutritionState,
  NutritionTargets,
} from '../storage/DataStore.ts';
import { applyPhotoEvent, normalizePhotos } from './photos.ts';
import { applyWeightEvent, normalizeWeights } from './weight.ts';

/* -------------------------------------------------------------- constants */

/** Sanity clamps — a payload is data from ANOTHER device until proven benign. */
export const MEAL_MAX_CALORIES = 10000;
export const MEAL_MAX_PROTEIN = 500;
/** Carbs and fat (grams) — the same sanity clamp, per meal and per daily target. */
export const MEAL_MAX_CARBS = 1000;
export const MEAL_MAX_FAT = 500;
/** A meal's name is also the text the estimator reads — room for quantities. */
export const MEAL_MAX_NAME_LEN = 300;
const AI_MAX_ITEMS = 10;
const AI_MAX_ITEM_LEN = 60;
/** The breakdown mirrors the estimator's own caps (nutrition/aiPort.ts). */
const AI_MAX_BREAKDOWN = 20;
const AI_MAX_REASON_LEN = 200;
const AI_MAX_ITEM_GRAMS = 2000;
const AI_MAX_ITEM_KCAL = 2000;
const AI_MAX_ITEM_PROTEIN = 500;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

const MEAL_SOURCES: readonly MealSource[] = ['manual', 'gemini_text', 'gemini_photo', 'catalog'];
const CATALOG_MAX_ID_LEN = 60;
/** A quantity is a count of units — 100 of anything is already a typo. */
export const CATALOG_MAX_QTY = 100;

/**
 * The meals of the day, in the order the screen lists them. `from`/`to` are
 * the eating windows ('HH:MM', `to` exclusive); `other` (נשנושים / אחר) has
 * none. The windows pick the form's default meal on today, and are the
 * schedule the reminders will follow.
 */
export interface MealSlotDef {
  key: MealSlot;
  /** The heading over the meal's list. */
  label: string;
  /** The chip in the add form — short enough for three to a row. */
  short: string;
  from: string | null;
  to: string | null;
}

export const MEAL_SLOTS: readonly MealSlotDef[] = [
  { key: 'breakfast', label: 'ארוחת בוקר', short: 'בוקר', from: '08:00', to: '10:00' },
  { key: 'snack_am', label: 'ביניים (בוקר–צהריים)', short: 'ביניים א׳', from: '10:00', to: '12:00' },
  { key: 'lunch', label: 'ארוחת צהריים', short: 'צהריים', from: '12:00', to: '16:00' },
  { key: 'snack_pm', label: 'ביניים (צהריים–ערב)', short: 'ביניים ב׳', from: '16:00', to: '18:00' },
  { key: 'dinner', label: 'ארוחת ערב', short: 'ערב', from: '18:00', to: '21:00' },
  { key: 'other', label: 'נשנושים / אחר', short: 'נשנושים', from: null, to: null },
];

const SLOT_KEYS: readonly MealSlot[] = MEAL_SLOTS.map((s) => s.key);

export function isMealSlot(v: unknown): v is MealSlot {
  return typeof v === 'string' && (SLOT_KEYS as readonly string[]).includes(v);
}

/** The meal whose window holds 'HH:MM'; outside every window, `other`. */
export function slotAt(hhmm: string): MealSlot {
  for (const s of MEAL_SLOTS) {
    if (s.from !== null && s.to !== null && hhmm >= s.from && hhmm < s.to) return s.key;
  }
  return 'other';
}
const CONFIDENCES = ['low', 'medium', 'high'] as const;

export function emptyNutrition(): NutritionState {
  return {
    meals: {},
    deleted: {},
    targets: { calories: null, protein: null },
    closedDays: {},
    weights: {},
    weightDeleted: {},
    weightTarget: null,
    photos: {},
    photoDeleted: {},
    customPoseName: '',
    templates: {},
    templateDeleted: {},
  };
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

/** A nullable clamped integer: `null` stays `null`, garbage becomes `null`. */
function optClamp(v: unknown, max: number): number | null {
  return v === null || v === undefined ? null : clampInt(v, max);
}

/**
 * An OPTIONAL macro: a number is clamped, anything else (absent, `null`,
 * garbage) is `undefined` — unknown, which is not the same as 0.
 */
function optMacro(v: unknown, max: number): number | undefined {
  return clampInt(v, max) ?? undefined;
}

/** The optional carbs / fat of a payload, as spreadable fields (absent when unknown). */
function macrosOf(payload: Readonly<Record<string, unknown>>): { carbs?: number; fat?: number } {
  const carbs = optMacro(payload['carbs'], MEAL_MAX_CARBS);
  const fat = optMacro(payload['fat'], MEAL_MAX_FAT);
  return { ...(carbs !== undefined ? { carbs } : {}), ...(fat !== undefined ? { fat } : {}) };
}

/** Read one stored breakdown line, or `null` when it has no name. */
function aiItemOf(raw: unknown): MealAiItem | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw['name'] === 'string' ? raw['name'].trim().slice(0, AI_MAX_ITEM_LEN) : '';
  if (!name) return null;
  return {
    name,
    quantity: typeof raw['quantity'] === 'string' ? raw['quantity'].trim().slice(0, AI_MAX_ITEM_LEN) : '',
    grams: optClamp(raw['grams'], AI_MAX_ITEM_GRAMS),
    kcal: optClamp(raw['kcal'], AI_MAX_ITEM_KCAL),
    proteinG: optClamp(raw['proteinG'], AI_MAX_ITEM_PROTEIN),
    assumed: raw['assumed'] === true,
  };
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
  const breakdown: MealAiItem[] = [];
  if (Array.isArray(raw['breakdown'])) {
    for (const it of raw['breakdown']) {
      const line = aiItemOf(it);
      if (line) breakdown.push(line);
      if (breakdown.length >= AI_MAX_BREAKDOWN) break;
    }
  }
  const reason = typeof raw['reason'] === 'string' ? raw['reason'].trim().slice(0, AI_MAX_REASON_LEN) : '';
  return {
    model: model.slice(0, AI_MAX_ITEM_LEN),
    confidence: confidence as MealAiInfo['confidence'],
    items,
    ...(breakdown.length > 0 ? { breakdown } : {}),
    ...(reason ? { reason } : {}),
  };
}

function catalogInfoOf(raw: unknown): MealCatalogInfo | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim().slice(0, CATALOG_MAX_ID_LEN) : '';
  const unit = typeof raw['unit'] === 'string' ? raw['unit'].trim().slice(0, CATALOG_MAX_ID_LEN) : '';
  const qty = raw['qty'];
  if (!id || !unit || typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return null;
  const lines: MealAiItem[] = [];
  if (Array.isArray(raw['lines'])) {
    for (const it of raw['lines']) {
      const line = aiItemOf(it);
      if (line) lines.push(line);
      if (lines.length >= AI_MAX_BREAKDOWN) break;
    }
  }
  return { id, unit, qty: Math.min(CATALOG_MAX_QTY, Math.round(qty * 100) / 100), lines };
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
  // A name is ONE line of data: a multi-line description collapses to spaces.
  const name =
    typeof payload['name'] === 'string' ? payload['name'].replace(/\s+/g, ' ').trim().slice(0, MEAL_MAX_NAME_LEN) : '';
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
  const slot = isMealSlot(payload['slot']) ? payload['slot'] : null;
  const catalog = catalogInfoOf(payload['catalog']);
  const rec: MealRecord = {
    date,
    name,
    calories,
    protein,
    ...macrosOf(payload),
    time,
    source,
    ...(ai ? { ai } : {}),
    ...(slot ? { slot } : {}),
    ...(catalog ? { catalog } : {}),
  };
  return { id, rec };
}

/** Read ANY targets-shaped value; missing / garbage fields become `null`. */
export function normalizeTargets(raw: unknown): NutritionTargets {
  const out: NutritionTargets = { calories: null, protein: null };
  if (!isRecord(raw)) return out;
  out.calories = clampInt(raw['calories'], MEAL_MAX_CALORIES);
  out.protein = clampInt(raw['protein'], MEAL_MAX_PROTEIN);
  const carbs = optMacro(raw['carbs'], MEAL_MAX_CARBS);
  const fat = optMacro(raw['fat'], MEAL_MAX_FAT);
  if (carbs !== undefined) out.carbs = carbs;
  if (fat !== undefined) out.fat = fat;
  return out;
}

function pickOf(raw: unknown): MealTemplatePick | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim().slice(0, CATALOG_MAX_ID_LEN) : '';
  const unit = typeof raw['unit'] === 'string' ? raw['unit'].trim().slice(0, CATALOG_MAX_ID_LEN) : '';
  const qty = raw['qty'];
  if (!id || !unit || typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return null;
  return { id, unit, qty: Math.min(CATALOG_MAX_QTY, Math.round(qty * 100) / 100) };
}

/**
 * Read a `meal_template_saved` payload into a valid template, or `null` (no
 * id, no name, non-numeric calories/protein). One reader for the fold, the
 * stored blob and the live driver — the `mealRecordOf` move.
 */
export function templateRecordOf(payload: Record<string, unknown>): { id: string; rec: MealTemplateRecord } | null {
  const id = payload['id'];
  const name =
    typeof payload['name'] === 'string' ? payload['name'].replace(/\s+/g, ' ').trim().slice(0, MEAL_MAX_NAME_LEN) : '';
  if (typeof id !== 'string' || !id || !name) return null;
  const calories = clampInt(payload['calories'], MEAL_MAX_CALORIES);
  const protein = clampInt(payload['protein'], MEAL_MAX_PROTEIN);
  if (calories === null || protein === null) return null;
  const pick = pickOf(payload['pick']);
  return { id, rec: { name, calories, protein, ...macrosOf(payload), ...(pick ? { pick } : {}) } };
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
  const closed = raw['closedDays'];
  if (isRecord(closed)) {
    for (const key of Object.keys(closed)) {
      if (ISO_DATE_RE.test(key) && closed[key] === true) n.closedDays[key] = true;
    }
  }
  const templates = raw['templates'];
  if (isRecord(templates)) {
    for (const key of Object.keys(templates)) {
      const entry = templates[key];
      if (!isRecord(entry)) continue;
      const read = templateRecordOf({ ...entry, id: key });
      if (read) n.templates[key] = read.rec;
    }
  }
  const tplDeleted = raw['templateDeleted'];
  if (isRecord(tplDeleted)) {
    for (const key of Object.keys(tplDeleted)) {
      if (key && tplDeleted[key] === true) n.templateDeleted[key] = true;
    }
  }
  normalizeWeights(raw, n);
  normalizePhotos(raw, n);
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
    case 'meal_template_saved': {
      const read = templateRecordOf(payload as Record<string, unknown>);
      if (read) n.templates[read.id] = read.rec;
      break;
    }
    case 'meal_template_deleted': {
      const id = payload['id'];
      if (typeof id === 'string' && id) n.templateDeleted[id] = true;
      break;
    }
    case 'nutrition_day_closed': {
      const date = payload['date'];
      if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) break;
      if (payload['closed'] === true) n.closedDays[date] = true;
      else if (payload['closed'] === false) delete n.closedDays[date];
      break;
    }
    case 'weight_logged':
    case 'weight_deleted':
    case 'weight_target_set':
      applyWeightEvent(n, type, payload);
      break;
    case 'photo_taken':
    case 'photo_deleted':
    case 'photo_pose_named':
      applyPhotoEvent(n, type, payload);
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
  /** Grams; absent = unknown (never 0 by default). */
  carbs?: number;
  fat?: number;
  /** 'HH:MM' for display, or '' when unknown. */
  time: string;
  source: MealSource;
  ai?: MealAiInfo;
  slot?: MealSlot;
  catalog?: MealCatalogInfo;
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
    ...(input.carbs !== undefined ? { carbs: input.carbs } : {}),
    ...(input.fat !== undefined ? { fat: input.fat } : {}),
    time: input.time,
    source: input.source,
    ...(input.ai ? { ai: input.ai } : {}),
    ...(input.slot ? { slot: input.slot } : {}),
    ...(input.catalog ? { catalog: input.catalog } : {}),
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

/**
 * Save the daily targets (whole object, LWW like the plan) and mirror them.
 * Carbs / fat are optional: left out (or `null`), the screen derives them
 * from calories + protein (core/macros.ts) — and a later save without them
 * returns to that default, since the object travels whole.
 */
export function setTargets(
  store: DataStore,
  targets: { calories: number | null; protein: number | null; carbs?: number | null; fat?: number | null },
): AppEvent {
  const clean = normalizeTargets(targets);
  const payload = {
    calories: clean.calories,
    protein: clean.protein,
    ...(clean.carbs !== undefined ? { carbs: clean.carbs } : {}),
    ...(clean.fat !== undefined ? { fat: clean.fat } : {}),
  };
  const ev = store.append('nutrition_targets_set', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'nutrition_targets_set', payload));
  return ev;
}

/** What the UI knows about a meal it is saving as the user's own. */
export interface TemplateInput {
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fat?: number;
  pick?: MealTemplatePick;
}

/**
 * "שמירת ארוחה משלי": append ONE `meal_template_saved` (the whole template) and
 * mirror it, or `null` when the input does not read as a template. The uuid
 * comes from the caller, as for a meal.
 */
export function saveTemplate(store: DataStore, input: TemplateInput, id: string): AppEvent | null {
  const payload: MealTemplateSavedPayload = {
    id,
    name: input.name,
    calories: input.calories,
    protein: input.protein,
    ...(input.carbs !== undefined ? { carbs: input.carbs } : {}),
    ...(input.fat !== undefined ? { fat: input.fat } : {}),
    ...(input.pick ? { pick: input.pick } : {}),
  };
  if (!templateRecordOf(payload)) return null;
  const ev = store.append('meal_template_saved', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'meal_template_saved', payload));
  return ev;
}

/** Append the tombstone for one template id and mirror it. */
export function deleteTemplate(store: DataStore, id: string): AppEvent | null {
  if (!id) return null;
  const payload = { id };
  const ev = store.append('meal_template_deleted', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'meal_template_deleted', payload));
  return ev;
}

/**
 * "סגרתי את היום" (`closed: true`) or "פתיחה להוספה" (`closed: false`): append
 * ONE `nutrition_day_closed` and mirror it. Returns `null` (appending nothing)
 * for a bad date, or when closing a day that has no live meal — an empty day is
 * not a complete one, and would count as a 0 in the closed-days mean.
 */
export function setDayClosed(store: DataStore, date: string, closed: boolean): AppEvent | null {
  if (!ISO_DATE_RE.test(date)) return null;
  const n = store.getState().nutrition;
  if (closed && mealsForDate(n, date).length === 0) return null;
  const payload: NutritionDayClosedPayload = { date, closed };
  const ev = store.append('nutrition_day_closed', payload);
  store.update((draft) => applyNutritionEvent(draft.nutrition, 'nutrition_day_closed', payload));
  return ev;
}

/* -------------------------------------------------------------- selectors */

/** True when the user closed this date AND it still has a live meal. */
export function isDayClosed(n: NutritionState, date: string): boolean {
  return n.closedDays[date] === true && mealsForDate(n, date).length > 0;
}

/**
 * The under-estimation lenses: what the day's calories come to if every
 * estimate ran this many percent low (oil, sauces, portions). Display-only —
 * nothing stored changes.
 */
export const SAFETY_MARGINS = [10, 20] as const;
export type SafetyMargin = 0 | (typeof SAFETY_MARGINS)[number];

/** `value` inflated by `pct` percent, rounded to a whole unit. */
export function withMargin(value: number, pct: number): number {
  return Math.round(value * (1 + pct / 100));
}

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

/**
 * The day's carbs and fat — beside `dayTotals`, because they can be UNKNOWN:
 * `carbs` / `fat` sum the meals that carry one, and `carbsMissing` /
 * `fatMissing` count the live meals that do not. A day with any missing is a
 * lower bound ("≥"), never a silent zero.
 */
export interface DayMacros {
  carbs: number;
  fat: number;
  carbsMissing: number;
  fatMissing: number;
}

export function dayMacros(n: NutritionState, date: string): DayMacros {
  const t: DayMacros = { carbs: 0, fat: 0, carbsMissing: 0, fatMissing: 0 };
  for (const row of mealsForDate(n, date)) {
    if (row.carbs === undefined) t.carbsMissing += 1;
    else t.carbs += row.carbs;
    if (row.fat === undefined) t.fatMissing += 1;
    else t.fat += row.fat;
  }
  return t;
}

export interface TemplateRow extends MealTemplateRecord {
  id: string;
}

/** The user's live saved meals (tombstones filtered), by name then id. */
export function liveTemplates(n: NutritionState): TemplateRow[] {
  const out: TemplateRow[] = [];
  for (const id of Object.keys(n.templates)) {
    const rec = n.templates[id];
    if (!rec || n.templateDeleted[id]) continue;
    out.push({ id, ...rec });
  }
  out.sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
  return out;
}

/** Shift an ISO date by whole days — pure calendar math, no clock involved. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DaySummary extends DayTotals {
  date: string;
  /** The user closed the day ("סגרתי את היום") and it has meals. */
  closed: boolean;
}

/** The last `count` days ENDING at `today`, oldest first. */
export function recentDays(n: NutritionState, today: string, count = 7): DaySummary[] {
  const out: DaySummary[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    out.push({ date, ...dayTotals(n, date), closed: isDayClosed(n, date) });
  }
  return out;
}

export interface IntakeStats {
  /** Days in the window that were averaged (logged, and closed when asked). */
  tracked: number;
  /** Mean daily calories over the TRACKED days, or `null` when none. */
  avgCalories: number | null;
  /** Mean daily protein over the TRACKED days, or `null` when none. */
  avgProtein: number | null;
  /** The tracked day with the most calories, or `null` when none. */
  peak: DaySummary | null;
}

/**
 * The window's averages — over the days that were TRACKED, not the calendar:
 * a day with no meal logged is far more often "forgot to log" than "ate
 * nothing", and folding zeros into the mean would quietly flatter every diet.
 * With `closedOnly`, a day must also be CLOSED: a half-logged day flatters the
 * mean exactly the way an unlogged one would.
 */
export function intakeStats(days: readonly DaySummary[], closedOnly = false): IntakeStats {
  const tracked = days.filter((d) => d.meals > 0 && (!closedOnly || d.closed));
  if (tracked.length === 0) return { tracked: 0, avgCalories: null, avgProtein: null, peak: null };
  const cal = tracked.reduce((s, d) => s + d.calories, 0);
  const prot = tracked.reduce((s, d) => s + d.protein, 0);
  const peak = tracked.reduce((best, d) => (d.calories > best.calories ? d : best), tracked[0] as DaySummary);
  return {
    tracked: tracked.length,
    avgCalories: Math.round(cal / tracked.length),
    avgProtein: Math.round(prot / tracked.length),
    peak,
  };
}
