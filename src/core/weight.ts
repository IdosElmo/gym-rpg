/**
 * core/weight.ts — the ⚖️ weight log's fold, drivers and selectors.
 *
 * DESIGN — the meal tracker's sibling, under the meal tracker's laws
 * -------------------------------------------------------------------
 * A weigh-in grants NOTHING: no XP, no energy, no coins. The three event types
 * here never reach `applyGameEvent`; they fold into `state.nutrition` beside
 * the meals (`weights` / `weightDeleted` / `weightTarget`), through the ONE
 * fold `applyNutritionEvent` delegates to — so the live write path and
 * `rebuildFromEvents` agree byte for byte, exactly as they do for meals.
 *
 * MERGE SEMANTICS (all order-free under the `(ts, id)` total order):
 *   weight_logged     -> first write per entry id wins; ids are uuids, so two
 *                        devices cannot collide and a duplicate is a no-op.
 *   weight_deleted    -> a tombstone set, union-monotone: delete-before-log and
 *                        log-before-delete converge (render = entries minus
 *                        deleted). "Re-adding" is a NEW uuid.
 *   weight_target_set -> the goal weight in the payload, last writer wins —
 *                        the `nutrition_targets_set` rule.
 *   data_cleared      -> resets the whole nutrition slot (the caller's switch).
 *
 * ONE ENTRY PER WEIGH-IN, NOT PER DAY. A morning and an evening weigh-in are
 * two data points, and the chart the user asked for plots ENTRIES on its x
 * axis — so the log keeps every one and orders them by (date, time, id).
 */

import type {
  AppEvent,
  DataStore,
  EventType,
  NutritionState,
  WeightLoggedPayload,
  WeightRecord,
} from '../storage/DataStore.ts';

/* -------------------------------------------------------------- constants */

/**
 * The plausible human range. Unlike a meal's calories (clamped — a big number
 * is still a meal), a weight outside this band is not a weigh-in at all, so a
 * payload carrying one is REFUSED rather than pulled to the edge.
 */
export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 400;
export const WEIGHT_MAX_NOTE_LEN = 80;
/** Entries averaged for the trend line — a week of daily weigh-ins. */
export const WEIGHT_TREND_WINDOW = 7;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/**
 * A REAL calendar date, not merely a date-shaped string: the 7- and 30-day
 * deltas do calendar math on it, and `'2026-02-31'` would throw there — a
 * payload from another device is data until proven benign.
 */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/* ---------------------------------------------------------------- readers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One decimal, or `null` when the value is not a weight a human can have. */
export function kgOf(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const kg = Math.round(v * 10) / 10;
  if (kg < WEIGHT_MIN_KG || kg > WEIGHT_MAX_KG) return null;
  return kg;
}

/**
 * Read a `weight_logged` payload into a valid `WeightRecord`, or `null` when
 * the payload is not a weigh-in (bad date, weight out of range). Used by the
 * fold, by `normalizeWeights` (a stored blob is just as untrusted) and by the
 * live driver as its validation gate — ONE reader, three doors.
 */
export function weightRecordOf(payload: Record<string, unknown>): { id: string; rec: WeightRecord } | null {
  const id = payload['id'];
  const date = payload['date'];
  if (typeof id !== 'string' || !id) return null;
  if (!isCalendarDate(date)) return null;
  const kg = kgOf(payload['kg']);
  if (kg === null) return null;
  const time = typeof payload['time'] === 'string' && HHMM_RE.test(payload['time']) ? payload['time'] : '';
  const note =
    typeof payload['note'] === 'string' ? payload['note'].replace(/\s+/g, ' ').trim().slice(0, WEIGHT_MAX_NOTE_LEN) : '';
  return { id, rec: { date, time, kg, note } };
}

/**
 * Read the weight half of ANY persisted nutrition blob INTO `n`. Missing or
 * garbage fields become empty — a v6 blob simply has no weigh-ins.
 */
export function normalizeWeights(raw: Record<string, unknown>, n: NutritionState): void {
  const weights = raw['weights'];
  if (isRecord(weights)) {
    for (const key of Object.keys(weights)) {
      const entry = weights[key];
      if (!isRecord(entry)) continue;
      const read = weightRecordOf({ ...entry, id: key });
      if (read) n.weights[key] = read.rec;
    }
  }
  const deleted = raw['weightDeleted'];
  if (isRecord(deleted)) {
    for (const key of Object.keys(deleted)) {
      if (key && deleted[key] === true) n.weightDeleted[key] = true;
    }
  }
  n.weightTarget = kgOf(raw['weightTarget']);
}

/* ------------------------------------------------------------------- fold */

/**
 * THE weight fold — one event into the nutrition slot, in place. Idempotent
 * under union merge: a `weight_logged` whose id is present is a no-op, a
 * tombstone is monotone, the target is last-writer-wins (the caller feeds
 * events in the `(ts, id)` total order).
 */
export function applyWeightEvent(n: NutritionState, type: EventType, payload: Readonly<Record<string, unknown>>): void {
  switch (type) {
    case 'weight_logged': {
      const read = weightRecordOf(payload as Record<string, unknown>);
      if (!read || n.weights[read.id]) break;
      n.weights[read.id] = read.rec;
      break;
    }
    case 'weight_deleted': {
      const id = payload['id'];
      if (typeof id === 'string' && id) n.weightDeleted[id] = true;
      break;
    }
    case 'weight_target_set':
      n.weightTarget = kgOf(payload['kg']);
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- drivers */

/** What the UI knows about a weigh-in before it becomes an event. */
export interface WeightInput {
  date: string;
  /** 'HH:MM', or '' when unknown. */
  time: string;
  kg: number;
  note: string;
}

/**
 * Append ONE `weight_logged` event and mirror it into `state.nutrition`, or
 * return `null` (and append nothing) when the input does not read as a
 * weigh-in. The uuid comes from the CALLER — the UI mints `crypto.randomUUID()`,
 * tests pass fixed ids — which keeps this module deterministic.
 */
export function logWeight(store: DataStore, input: WeightInput, id: string): AppEvent | null {
  const payload: WeightLoggedPayload = { id, date: input.date, time: input.time, kg: input.kg, note: input.note };
  const read = weightRecordOf(payload);
  if (!read) return null;
  // Store what the reader accepted (rounded kg, trimmed note), so the event on
  // disk and the record in the cache are the same bytes.
  const clean: WeightLoggedPayload = { id, ...read.rec };
  const ev = store.append('weight_logged', clean);
  store.update((draft) => applyWeightEvent(draft.nutrition, 'weight_logged', clean));
  return ev;
}

/** Append the tombstone for one entry id and mirror it. */
export function deleteWeight(store: DataStore, id: string): AppEvent | null {
  if (!id) return null;
  const payload = { id };
  const ev = store.append('weight_deleted', payload);
  store.update((draft) => applyWeightEvent(draft.nutrition, 'weight_deleted', payload));
  return ev;
}

/** Save (or clear, with `null`) the goal weight — LWW, and mirrored. */
export function setWeightTarget(store: DataStore, kg: number | null): AppEvent {
  const payload = { kg: kg === null ? null : kgOf(kg) };
  const ev = store.append('weight_target_set', payload);
  store.update((draft) => applyWeightEvent(draft.nutrition, 'weight_target_set', payload));
  return ev;
}

/* -------------------------------------------------------------- selectors */

export interface WeightRow extends WeightRecord {
  id: string;
}

/** Every live weigh-in, tombstones filtered, OLDEST first by (date, time, id). */
export function weightEntries(n: NutritionState): WeightRow[] {
  const out: WeightRow[] = [];
  for (const id of Object.keys(n.weights)) {
    const rec = n.weights[id];
    if (!rec || n.weightDeleted[id]) continue;
    out.push({ id, ...rec });
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * The trailing moving average of `kg` over the last `window` entries, one
 * value per row (the first rows average what exists so far). Daily weight is
 * noisy by a kilo either way — water, salt, the hour — and this is the line
 * that shows where it is actually going.
 */
export function movingAverage(rows: readonly WeightRow[], window = WEIGHT_TREND_WINDOW): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    sum += rows[i]?.kg ?? 0;
    if (i >= window) sum -= rows[i - window]?.kg ?? 0;
    const count = Math.min(i + 1, window);
    out.push(Math.round((sum / count) * 100) / 100);
  }
  return out;
}

/** Shift a calendar date by whole days — pure calendar math, never throws. */
function shiftDate(date: string, days: number): string {
  if (!isCalendarDate(date)) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last entry dated ON OR BEFORE `date`, or `null`. */
function entryAtOrBefore(rows: readonly WeightRow[], date: string): WeightRow | null {
  let found: WeightRow | null = null;
  for (const r of rows) {
    if (r.date <= date) found = r;
    else break;
  }
  return found;
}

export interface WeightSummary {
  /** How many live entries there are. */
  count: number;
  /** The newest weigh-in, or `null` when there is none. */
  latest: WeightRow | null;
  /** Newest minus the one before it, or `null` with fewer than two entries. */
  sincePrevious: number | null;
  /** Newest minus the first ever, or `null` with fewer than two entries. */
  sinceFirst: number | null;
  /** Newest minus the last entry at least 7 days older, or `null` when none. */
  sevenDay: number | null;
  /** Newest minus the last entry at least 30 days older, or `null` when none. */
  thirtyDay: number | null;
  /** Lightest and heaviest live entries (`null` when empty). */
  min: number | null;
  max: number | null;
  /** The trend line's newest value, or `null` when empty. */
  trend: number | null;
  /** Goal minus newest (negative = still above the goal), or `null`. */
  toTarget: number | null;
  /**
   * True once the newest weigh-in has crossed the goal in the direction the
   * log started from: a goal BELOW the first entry is reached at or under it,
   * a goal ABOVE the first entry at or over it. Losing and gaining are both
   * goals here — the tracker does not assume which way is "good".
   */
  targetReached: boolean;
}

function delta(a: number, b: number): number {
  return Math.round((a - b) * 10) / 10;
}

/** Everything the summary card and the header say, from the live entries. */
export function weightSummary(n: NutritionState): WeightSummary {
  const rows = weightEntries(n);
  const latest = rows[rows.length - 1] ?? null;
  const first = rows[0] ?? null;
  const previous = rows.length >= 2 ? (rows[rows.length - 2] ?? null) : null;
  const empty: WeightSummary = {
    count: rows.length,
    latest,
    sincePrevious: null,
    sinceFirst: null,
    sevenDay: null,
    thirtyDay: null,
    min: null,
    max: null,
    trend: null,
    toTarget: null,
    targetReached: false,
  };
  if (!latest || !first) return empty;
  const older = (days: number): number | null => {
    const ref = entryAtOrBefore(rows, shiftDate(latest.date, -days));
    return ref ? delta(latest.kg, ref.kg) : null;
  };
  const avg = movingAverage(rows);
  return {
    ...empty,
    sincePrevious: previous ? delta(latest.kg, previous.kg) : null,
    sinceFirst: rows.length >= 2 ? delta(latest.kg, first.kg) : null,
    sevenDay: older(7),
    thirtyDay: older(30),
    min: rows.reduce((m, r) => Math.min(m, r.kg), Number.POSITIVE_INFINITY),
    max: rows.reduce((m, r) => Math.max(m, r.kg), Number.NEGATIVE_INFINITY),
    trend: avg[avg.length - 1] ?? null,
    toTarget: n.weightTarget === null ? null : delta(n.weightTarget, latest.kg),
    targetReached:
      n.weightTarget !== null &&
      (n.weightTarget <= first.kg ? latest.kg <= n.weightTarget : latest.kg >= n.weightTarget),
  };
}
