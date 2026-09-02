/**
 * core/plan.ts — the headless plan model.
 *
 * THE contract of this module is one sentence: **`resolveProgram(null)` returns
 * the built-in program itself** (`BUILTIN_PROGRAM`, whose days are the `PROGRAM`
 * objects themselves). A user who never opened the plan editor has
 * `state.plan === null`, so every screen keeps reading the exact same frozen
 * program it read before this feature existed — no copy, no re-derivation, no
 * behavioural drift. Everything else here only matters once a plan is saved.
 *
 * DESIGN — a plan owns its days (document v2)
 * -------------------------------------------
 * `days` is an ORDERED ARRAY of 1–7 `PlanDay`s, each with a stable `key`, a
 * Hebrew `label` and the `weekdays` it is trained on, plus a document-level
 * `weeklyTarget`. That is what lets a 4-days-a-week A/B split exist: two days,
 * four weekdays, target 4. A v1 document (the fixed A/B/C record) is migrated on
 * READ by `normalizePlanDoc`, into exactly the days v1 used to render.
 *
 * DESIGN — the plan is an event, the state is a cache
 * ---------------------------------------------------
 * A save appends exactly ONE `plan_updated` event carrying the whole document,
 * and mirrors it into `state.plan`. Folding the log with `planFromEvents` gives
 * the same answer, because the fold is "last `plan_updated` in the total
 * `(ts, id)` order wins" (last-writer-wins) with `data_cleared` resetting to
 * `null`. Whole-document events make a merge trivial: there is nothing to
 * reconcile field by field, and two devices that hold the same event set always
 * agree on which save was last.
 *
 * DESIGN — rows point at definitions
 * ----------------------------------
 * A `PlanExercise` row carries only `{id, sets, reps, rest}`. Pointing at a
 * built-in id keeps the coaching copy (steps / cue / mistake / body part) in
 * CODE, so it can be improved in a later release for users who already saved a
 * plan. A custom exercise carries its own definition, minus the coaching copy —
 * the workout screen simply hides the explanation panel when there is none.
 *
 * DESIGN — XP keys never move
 * ---------------------------
 * `game.best[exId]`, `game.granted[date|exId|setIndex]` and the previous-
 * performance lookup are all keyed by EXERCISE ID, never by position in a day.
 * Reordering a day, moving an exercise between days, or removing and re-adding
 * one therefore preserves history, PRs and XP automatically.
 */

import {
  BODY_PARTS,
  BODY_PART_HE,
  BUILTIN_PROGRAM,
  BUILTIN_WEEKDAYS,
  DAY_ORDER,
  DEFAULT_WEEKLY_TARGET,
  MAX_PLAN_DAYS,
  MAX_WEEKLY_TARGET,
  MIN_WEEKLY_TARGET,
  PROGRAM,
  WEEKDAY_HE,
  builtInExercises,
  defaultDayOf,
  findExercise,
  isBuiltInDayKey,
  isCardio,
  isPlanDayKey,
  weekdayCaption,
  type BodyPart,
  type BodyPartSplit,
  type BuiltInDayKey,
  type Day,
  type DayKey,
  type EquipmentKey,
  type Exercise,
  type ExerciseResolver,
  type ProgramDay,
  type ResolvedProgram,
} from '../data/program.ts';
import {
  CUSTOM_ID_PREFIX,
  DAY_ID_PREFIX,
  MAX_USER_PRESETS,
  PLAN_DOC_VERSION,
  PLAN_DOC_VERSION_V1,
  USER_PRESET_PREFIX,
  clampWeeklyTarget,
  isUserPresetId,
  type CustomExercise,
  type PlanDay,
  type PlanDoc,
  type PlanExercise,
  type UserPreset,
} from '../data/planTypes.ts';
import { uuid } from '../util/uuid.ts';
import { compareEvents, finalizeGame, weeklyTargetsFromEvents } from './xp.ts';
import { todayISO } from './workout.ts';
import type {
  AppEvent,
  AppState,
  DataStore,
  EventType,
  PlanPresetDeletedPayload,
  PlanPresetSavedPayload,
  PlanUpdatedPayload,
} from '../storage/DataStore.ts';

/* ----------------------------------------------------------------- limits */

/** The editable ranges. The editor clamps to them and `savePlan` enforces them. */
export const PLAN_LIMITS = {
  minSets: 1,
  maxSets: 10,
  /** A cardio exercise counts STAGES, and a 5-minute ladder needs more than ten: two hours' worth. */
  maxStages: 24,
  minRest: 15,
  maxRest: 600,
  maxExercisesPerDay: 20,
  maxNameLength: 60,
  maxRepsLength: 24,
  /** A plan defines its own days — between one and one per weekday. */
  minDays: 1,
  maxDays: MAX_PLAN_DAYS,
} as const;

/** Defaults a freshly added row starts with. */
export const NEW_ROW_DEFAULTS = { sets: 3, reps: '10–12', rest: 90 } as const;

/**
 * The most sets a row of `def` may ask for: ten for a lift, `maxStages` for a
 * cardio ladder (twelve 5-minute stages are an hour's walk — the editor must
 * not snap that back to ten). An unknown definition gets the strict cap.
 */
export function maxSetsOf(def: Exercise | null | undefined): number {
  return isCardio(def) ? PLAN_LIMITS.maxStages : PLAN_LIMITS.maxSets;
}

/** The units a custom exercise may log its second field in. */
export const PLAN_UNITS: readonly string[] = ['חזרות', 'שניות', 'חזרות/רגל'] as const;

export const EQUIPMENT_KEYS: readonly EquipmentKey[] = [
  'Smith Machine',
  'Dumbbells',
  'Bodyweight',
  'Machine',
] as const;

/* ---------------------------------------------------------------- helpers */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBodyPart(v: unknown): v is BodyPart {
  return typeof v === 'string' && (BODY_PARTS as readonly string[]).includes(v);
}

function isEquipmentKey(v: unknown): v is EquipmentKey {
  return typeof v === 'string' && (EQUIPMENT_KEYS as readonly string[]).includes(v);
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** A fresh id for a user-invented exercise: `cx_` + 12 hex chars of a uuid. */
export function newCustomId(): string {
  return CUSTOM_ID_PREFIX + uuid().replace(/-/g, '').slice(0, 12);
}

/**
 * A fresh key for a user-created workout day: `d_` + 8 hex chars of a uuid.
 *
 * Minted per DAY, never reused, and never one of the reserved view keys — two
 * devices that both add a day therefore add two different days rather than
 * silently merging them into one.
 */
export function newDayKey(): string {
  return DAY_ID_PREFIX + uuid().replace(/-/g, '').slice(0, 8);
}

/**
 * A fresh id for a preset the user saves: `up_` + 12 hex chars of a uuid.
 * Minted per SAVE, never reused — two devices that each save a preset save two
 * presets, and a delete can never kill anything but the id it names.
 */
export function newUserPresetId(): string {
  return USER_PRESET_PREFIX + uuid().replace(/-/g, '').slice(0, 12);
}

/* ---------------------------------------------------------- supersets */

/**
 * ONE superset link: `[first, second]`, two exercise ids of the SAME day.
 *
 * The pair is ordered exactly like the day is: `first` is the card the user
 * meets first, `second` the one they go straight into with no rest between.
 */
export type SupersetPair = readonly [string, string];

/**
 * THE rule of a legal superset, in one place: both ids exist in the day, they
 * are ADJACENT in its order (`first` immediately before `second`), and no id is
 * claimed by two pairs.
 *
 * Everything that stores a day runs its pairs through this, so an illegal pair
 * cannot survive a normalisation, a clone or a save. It DROPS rather than
 * throws: a document merged from another device (or hand-edited, or written by
 * a build whose editor allowed something this one does not) must still open —
 * losing a link is recoverable in one tap, a workout screen that refuses to
 * render is not. The editor refuses the same pairs loudly, before saving.
 */
export function legalPairs(
  pairs: readonly SupersetPair[] | undefined,
  rows: readonly PlanExercise[],
): SupersetPair[] {
  if (!pairs || pairs.length === 0) return [];
  const index = new Map<string, number>();
  rows.forEach((r, i) => index.set(r.id, i));
  const out: SupersetPair[] = [];
  const claimed = new Set<string>();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [a, b] = pair;
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) continue;
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined || ib !== ia + 1) continue;
    if (claimed.has(a) || claimed.has(b)) continue;
    claimed.add(a);
    claimed.add(b);
    out.push([a, b]);
  }
  return out;
}

/** Raw (untrusted) pairs of a stored day, before they are judged legal. */
function rawPairs(raw: unknown): SupersetPair[] {
  if (!Array.isArray(raw)) return [];
  const out: SupersetPair[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const a = p[0];
    const b = p[1];
    if (typeof a !== 'string' || typeof b !== 'string') continue;
    out.push([a.trim(), b.trim()]);
  }
  return out;
}

/** The superset pairs of a day (empty for a day that has none, or no day). */
export function supersetPairs(day: PlanDay | null | undefined): readonly SupersetPair[] {
  return day?.supersets ?? [];
}

/**
 * The OTHER exercise of `exId`'s superset, or `null` when it has none.
 *
 * This is what the workout screen asks per checkbox: a tap on a set of an
 * exercise with a partner completes the same set of the partner too.
 */
export function supersetPartner(day: PlanDay | null | undefined, exId: string): string | null {
  for (const [a, b] of supersetPairs(day)) {
    if (a === exId) return b;
    if (b === exId) return a;
  }
  return null;
}

/** The pair `exId` belongs to, in DAY order, or `null` — the UI needs both ids. */
export function supersetPairOf(day: PlanDay | null | undefined, exId: string): SupersetPair | null {
  for (const pair of supersetPairs(day)) {
    if (pair[0] === exId || pair[1] === exId) return pair;
  }
  return null;
}

/** True when the exercise is half of a superset. */
export function isSuperset(day: PlanDay | null | undefined, exId: string): boolean {
  return supersetPartner(day, exId) !== null;
}

/* ------------------------------------------------------------- the default */

/**
 * THE constructor of a `PlanDay` — every one of them is built here.
 *
 * That is not tidiness: `planIsDirty` / `isDefaultPlan` compare documents by
 * their JSON, and JSON preserves INSERTION ORDER. A day built with `weekdays`
 * before `exercises` in one place and after it in another would serialise to two
 * different strings for the same plan, and the editor would claim unsaved
 * changes forever. One constructor, one key order.
 */
export function makePlanDay(
  key: DayKey,
  label: string,
  weekdays: readonly number[],
  exercises: PlanExercise[],
  supersets: readonly SupersetPair[] = [],
): PlanDay {
  const out: PlanDay = { key, label, exercises };
  if (weekdays.length > 0) out.weekdays = [...weekdays];
  // Only legal pairs are ever stored, and an empty list is stored as NO field
  // at all — same rule as `weekdays`, same reason (see the doc comment above).
  const pairs = legalPairs(supersets, exercises);
  if (pairs.length > 0) out.supersets = pairs;
  return out;
}

/** The rows of a built-in day, as a plan would store them. */
function builtInRows(k: BuiltInDayKey): PlanExercise[] {
  return PROGRAM[k].exercises.map((ex) => ({ id: ex.id, sets: ex.sets, reps: ex.reps, rest: ex.rest }));
}

/** The v2 `PlanDay` of a built-in day — the shape a v1 document migrates INTO. */
function builtInPlanDay(k: BuiltInDayKey, exercises: PlanExercise[] = builtInRows(k)): PlanDay {
  return makePlanDay(k, PROGRAM[k].label, BUILTIN_WEEKDAYS[k], exercises);
}

/**
 * The built-in program expressed AS a plan document — the starting point of
 * every edit session. Resolving it yields days that are `===` the PROGRAM days
 * (see `resolveProgram`), so "open the editor and save without changing
 * anything" is a genuine no-op for every screen.
 */
export function defaultPlanDoc(): PlanDoc {
  return {
    version: PLAN_DOC_VERSION,
    rev: 0,
    days: DAY_ORDER.map((k) => builtInPlanDay(k)),
    weeklyTarget: DEFAULT_WEEKLY_TARGET,
    customExercises: [],
  };
}

/* --------------------------------------------------- the derived target */

/** The distinct weekdays a set of days is trained on, ascending. */
export function assignedWeekdays(days: readonly PlanDay[]): number[] {
  const out = new Set<number>();
  for (const d of days) {
    for (const w of d.weekdays ?? []) {
      if (Number.isFinite(w) && w >= 0 && w <= 6) out.add(Math.trunc(w));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The only thing the routing-map test needs of a day: its key and weekdays. */
interface WeekdayAssignment {
  readonly key: DayKey;
  readonly weekdays?: readonly number[];
}

/**
 * True for the A/B/C weekday map v1 shipped with — `[0,1] / [2,3] / [4,5,6]`.
 *
 * That map is a ROUTING map, not a schedule: it exists so that every weekday
 * opens SOME tab, which is why three workouts claim all seven days. Reading it
 * as a schedule would say "seven training days a week", which is exactly what
 * `DEFAULT_WEEKLY_TARGET` (three) has always denied. See `deriveWeeklyTarget`
 * and `scheduleTabs` — the two readers of the map, and the two places where
 * treating routing as a schedule would visibly lie to the user (a weekly target
 * of seven, and seven workout tabs for a three-day program).
 *
 * Takes anything with a key and weekdays, so a `PlanDay` (document side) and a
 * `ProgramDay` (resolved side) are judged by the very same predicate.
 */
export function isBuiltInWeekdayMap(days: readonly WeekdayAssignment[]): boolean {
  if (days.length !== DAY_ORDER.length) return false;
  return days.every((d, i) => {
    const k = DAY_ORDER[i];
    if (!k || d.key !== k) return false;
    const mine = d.weekdays ?? [];
    const builtIn = BUILTIN_WEEKDAYS[k];
    return mine.length === builtIn.length && mine.every((w, j) => w === builtIn[j]);
  });
}

/**
 * The weekday that NAMES a built-in day — the first of its routing range, which
 * is the one `DAY_NAMES` / `weekdayCaption` have always read: ראשון for A,
 * שלישי for B, חמישי for C.
 */
function canonicalWeekday(key: BuiltInDayKey): number {
  return BUILTIN_WEEKDAYS[key][0] ?? 0;
}

/** True when a built-in day still carries its WHOLE routing range, untouched. */
function carriesRoutingRange(d: WeekdayAssignment): boolean {
  if (!isBuiltInDayKey(d.key)) return false;
  const mine = d.weekdays ?? [];
  const builtIn = BUILTIN_WEEKDAYS[d.key];
  return mine.length === builtIn.length && mine.every((w, i) => w === builtIn[i]);
}

/**
 * LEAVING THE ROUTING MAP. The built-in ranges are only ever read as routing
 * while ALL THREE are in place (`isBuiltInWeekdayMap`); the moment the plan
 * differs — a fourth day is added, a day is removed or moved, a chip is
 * toggled — every reader takes the weekdays literally, and a day that still
 * carries `[4,5,6]` suddenly claims three training days it never had. The
 * user's treadmill day showed exactly that: one Wednesday added, and the tab
 * bar grew to seven tabs with a weekly target of seven.
 *
 * So a built-in day that still carries its whole range collapses to the ONE
 * weekday that names it — A → ראשון, B → שלישי, C → חמישי — the day the built-in
 * program has always been "trained on" in every caption. The editor calls this
 * at the mutation that leaves the map (and only then: afterwards a range is
 * whatever the user set), and `normalizePlanDoc` applies it to a document that
 * was saved in the half-way state — see `repairRoutingRanges` — so an install
 * that already holds one reads it right without re-saving.
 *
 * Unconditional per day; the callers decide WHEN. Returns whether anything changed.
 */
export function collapseRoutingRanges(days: PlanDay[]): boolean {
  let changed = false;
  for (const d of days) {
    if (!carriesRoutingRange(d) || !isBuiltInDayKey(d.key)) continue;
    // assigning through the existing property keeps the document's key order
    d.weekdays = [canonicalWeekday(d.key)];
    changed = true;
  }
  return changed;
}

/**
 * READ-TIME REPAIR of a document saved half-way out of the routing map (a
 * fourth day added by a build that did not collapse the ranges yet). The tell
 * is TWO OR MORE built-in days still carrying their whole ranges in a plan
 * that is not the map: nobody schedules A on Sun+Mon AND C on Thu+Fri+Sat by
 * hand. One lone range is left alone — it may be a deliberate schedule. The
 * weekly target is re-derived when the repair changes anything, because the
 * saved one was derived from the seven-day misreading.
 */
function repairRoutingRanges(days: PlanDay[]): boolean {
  if (isBuiltInWeekdayMap(days)) return false;
  if (days.filter(carriesRoutingRange).length < 2) return false;
  return collapseRoutingRanges(days);
}

/**
 * THE rule that turns a weekday assignment into a weekly training target — the
 * number the streak judges a "perfect week" by. One rule, one place: the editor
 * displays it and writes it into the draft, and nothing else derives its own.
 *
 *   * days with weekdays assigned  -> the count of DISTINCT weekdays claimed.
 *     Chips are exclusive (a weekday belongs to at most one day), so this is
 *     literally "how many times a week does this plan send me to the gym". An
 *     A/B split trained Sun+Wed / Tue+Thu is two days and a target of four.
 *   * nothing assigned at all      -> `min(days.length, DEFAULT_WEEKLY_TARGET)`.
 *     A plan with no schedule still has to say something; one workout per day of
 *     the plan is the honest reading, capped at the built-in three so a seven-day
 *     plan does not silently demand a perfect attendance record.
 *   * the built-in A/B/C map       -> the same fallback (i.e. three). It covers
 *     all seven weekdays with three workouts because it is a routing map (see
 *     `isBuiltInWeekdayMap`); counting it would turn "open the editor and save"
 *     into a jump from three to seven.
 *
 * Always inside 1–7.
 */
export function deriveWeeklyTarget(days: readonly PlanDay[]): number {
  const assigned = assignedWeekdays(days);
  if (assigned.length === 0 || isBuiltInWeekdayMap(days)) {
    return clampWeeklyTarget(Math.min(days.length, DEFAULT_WEEKLY_TARGET));
  }
  return clampWeeklyTarget(assigned.length);
}

/** Deep copy — the editor mutates a draft that must not touch the saved doc. */
export function clonePlanDoc(doc: PlanDoc): PlanDoc {
  return {
    version: PLAN_DOC_VERSION,
    rev: doc.rev,
    days: doc.days.map((d) => cloneDay(d)),
    weeklyTarget: doc.weeklyTarget,
    customExercises: doc.customExercises.map((c) => cloneCustom(c)),
  };
}

function cloneDay(d: PlanDay): PlanDay {
  return makePlanDay(
    d.key,
    d.label,
    d.weekdays ?? [],
    d.exercises.map((r) => ({ ...r })),
    supersetPairs(d).map(([a, b]) => [a, b] as SupersetPair),
  );
}

/** One day of a document by key, or `null` — days are an ARRAY from v2 on. */
export function planDay(doc: PlanDoc | null, key: DayKey): PlanDay | null {
  return doc?.days.find((d) => d.key === key) ?? null;
}

/** Rows of one day of a document (empty when there is no such day). */
export function planRows(doc: PlanDoc | null, key: DayKey): PlanExercise[] {
  return planDay(doc, key)?.exercises ?? [];
}

function cloneCustom(c: CustomExercise): CustomExercise {
  const out: CustomExercise = {
    id: c.id,
    he: c.he,
    en: c.en,
    bodyPart: c.bodyPart,
    unit: c.unit,
    equip: [...c.equip],
    muscle: c.muscle,
  };
  if (c.split) out.split = { ...c.split };
  return out;
}

/* --------------------------------------------------------- normalisation */

function normalizeSplit(raw: unknown): BodyPartSplit | null {
  if (!isRecord(raw)) return null;
  const out: BodyPartSplit = {};
  let count = 0;
  for (const part of BODY_PARTS) {
    const w = raw[part];
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
      out[part] = w;
      count += 1;
    }
  }
  return count >= 2 ? out : null;
}

function normalizeCustom(raw: unknown): CustomExercise | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']).trim();
  const he = str(raw['he']).trim().slice(0, PLAN_LIMITS.maxNameLength);
  // A nameless or id-less exercise cannot be shown or referenced — drop it.
  if (!id || !he) return null;
  const bodyPart: BodyPart = isBodyPart(raw['bodyPart']) ? raw['bodyPart'] : 'chest';
  const equipRaw = Array.isArray(raw['equip']) ? raw['equip'] : [];
  const equip = [...new Set(equipRaw.filter(isEquipmentKey))];
  const unit = str(raw['unit']).trim() || 'חזרות';
  const muscle = str(raw['muscle']).trim().slice(0, PLAN_LIMITS.maxNameLength) || BODY_PART_HE[bodyPart];
  const out: CustomExercise = {
    id,
    he,
    en: str(raw['en']).trim().slice(0, PLAN_LIMITS.maxNameLength),
    bodyPart,
    unit,
    equip: equip.length > 0 ? equip : ['Bodyweight'],
    muscle,
  };
  const split = normalizeSplit(raw['split']);
  if (split) out.split = split;
  return out;
}

function normalizeRow(raw: unknown, known: (id: string) => Exercise | null): PlanExercise | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']).trim();
  if (!id) return null;
  const def = known(id);
  // A row pointing at nothing (built-in removed from the code, custom deleted
  // from the doc) cannot be rendered or granted XP for — drop it.
  if (!def) return null;
  const reps = str(raw['reps']).trim().slice(0, PLAN_LIMITS.maxRepsLength) || def.reps;
  return {
    id,
    sets: clampInt(raw['sets'], PLAN_LIMITS.minSets, maxSetsOf(def), def.sets),
    reps,
    rest: clampInt(raw['rest'], PLAN_LIMITS.minRest, PLAN_LIMITS.maxRest, def.rest),
  };
}

/** The rows of one day, deduplicated, capped, and each one repaired or dropped. */
function normalizeRows(raw: unknown, known: (id: string) => Exercise | null): PlanExercise[] {
  const list = isRecord(raw) && Array.isArray(raw['exercises']) ? raw['exercises'] : [];
  const rows: PlanExercise[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (rows.length >= PLAN_LIMITS.maxExercisesPerDay) break;
    const row = normalizeRow(r, known);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

/** Weekdays of a day: integers 0–6, deduplicated and ascending. */
function normalizeWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const n = Math.trunc(v);
    if (n >= 0 && n <= 6) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Migrate the v1 `days` record (the fixed A/B/C skeleton) into the v2 array.
 *
 * The migrated plan is behaviourally IDENTICAL to what v1 rendered: the same
 * three keys, the same labels, and the weekday ranges the app has always used to
 * pick the default tab — so nobody's app moves under them on a Wednesday.
 */
function migrateV1Days(raw: unknown, known: (id: string) => Exercise | null): PlanDay[] {
  const daysRaw = isRecord(raw) ? raw : {};
  return DAY_ORDER.map((k) => {
    const rows = normalizeRows(daysRaw[k], known);
    // An empty / unusable day falls back to the built-in day, never to nothing.
    return builtInPlanDay(k, rows.length > 0 ? rows : builtInRows(k));
  });
}

/** One day of a v2 document, or `null` when it cannot be made sense of. */
function normalizeV2Day(raw: unknown, known: (id: string) => Exercise | null): PlanDay | null {
  if (!isRecord(raw)) return null;
  const key = str(raw['key']).trim();
  if (!isPlanDayKey(key)) return null;
  const rows = normalizeRows(raw, known);
  const exercises = rows.length > 0 ? rows : isBuiltInDayKey(key) ? builtInRows(key) : [];
  // A day nothing can be rendered for is worse than no day at all.
  if (exercises.length === 0) return null;
  const fallbackLabel = isBuiltInDayKey(key) ? PROGRAM[key].label : key;
  const label = str(raw['label']).trim().slice(0, PLAN_LIMITS.maxNameLength) || fallbackLabel;
  // `makePlanDay` drops any pair the (possibly repaired) row list no longer
  // supports — an id that vanished with its row, or a pair torn apart by it.
  return makePlanDay(key, label, normalizeWeekdays(raw['weekdays']), exercises, rawPairs(raw['supersets']));
}

/**
 * Route ANY persisted / received plan blob to a valid `PlanDoc`, or to `null`
 * (which every consumer reads as "the built-in program"). Never throws.
 *
 * Accepts BOTH document versions: a v1 blob (from this device's storage, or from
 * a `plan_updated` event an older client wrote) is migrated to v2 on the way in
 * and is never written back in v1 form. A version we do not know is refused, so
 * a document from a FUTURE build falls back to the built-in program rather than
 * being silently mangled.
 *
 * Repairs rather than rejects wherever it can: out-of-range numbers are clamped,
 * unknown body parts fall back, unresolvable rows are dropped, a day left empty
 * by that dropping falls back to the built-in day (or, for a day the user
 * invented, is removed). A document left with no days at all becomes the
 * built-in three, so a corrupt blob can never produce an empty workout screen.
 */
export function normalizePlanDoc(raw: unknown): PlanDoc | null {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(raw)) return null;
  const version = raw['version'];
  const isV1 = version === undefined || version === PLAN_DOC_VERSION_V1;
  if (!isV1 && version !== PLAN_DOC_VERSION) return null;

  const customs: CustomExercise[] = [];
  const seenCustom = new Set<string>();
  const customsRaw = Array.isArray(raw['customExercises']) ? raw['customExercises'] : [];
  for (const c of customsRaw) {
    const norm = normalizeCustom(c);
    if (!norm || seenCustom.has(norm.id)) continue;
    seenCustom.add(norm.id);
    customs.push(norm);
  }
  const customById = new Map(customs.map((c) => [c.id, customToExercise(c)] as const));
  const known = (id: string): Exercise | null => findExercise(id) ?? customById.get(id) ?? null;

  let days: PlanDay[];
  if (isV1) {
    days = migrateV1Days(raw['days'], known);
  } else {
    days = [];
    const seenKey = new Set<string>();
    const list = Array.isArray(raw['days']) ? raw['days'] : [];
    for (const d of list) {
      if (days.length >= PLAN_LIMITS.maxDays) break;
      const day = normalizeV2Day(d, known);
      if (!day || seenKey.has(day.key)) continue;
      seenKey.add(day.key);
      days.push(day);
    }
    if (days.length === 0) days = defaultPlanDoc().days;
  }
  // A document saved half-way out of the routing map is read the way the
  // editor would have written it — and its target re-derived to match.
  const repaired = !isV1 && repairRoutingRanges(days);

  // Keep only the customs some day actually references, so a doc cannot grow
  // an unbounded graveyard of exercises the user deleted long ago.
  const referenced = new Set<string>();
  for (const day of days) for (const r of day.exercises) referenced.add(r.id);

  return {
    version: PLAN_DOC_VERSION,
    rev: Math.max(0, clampInt(raw['rev'], 0, Number.MAX_SAFE_INTEGER, 0)),
    days,
    // v1 knew nothing about a target: it always meant three days a week.
    weeklyTarget: isV1
      ? DEFAULT_WEEKLY_TARGET
      : repaired
        ? deriveWeeklyTarget(days)
        : clampWeeklyTarget(raw['weeklyTarget']),
    customExercises: customs.filter((c) => referenced.has(c.id)),
  };
}

/* ---------------------------------------------------------- resolution */

/** A custom exercise as a full `Exercise` — with NO coaching copy (by design). */
export function customToExercise(c: CustomExercise): Exercise {
  const base = {
    id: c.id,
    he: c.he,
    en: c.en,
    equip: c.equip.length > 0 ? [...c.equip] : (['Bodyweight'] as EquipmentKey[]),
    muscle: c.muscle || BODY_PART_HE[c.bodyPart],
    sets: NEW_ROW_DEFAULTS.sets,
    reps: NEW_ROW_DEFAULTS.reps,
    rest: NEW_ROW_DEFAULTS.rest,
    unit: c.unit || 'חזרות',
    steps: [] as readonly string[],
    cue: '',
    mistake: '',
    bodyPart: c.bodyPart,
  };
  return c.split ? { ...base, split: { ...c.split } } : base;
}

/**
 * Estimated duration of a day: every set costs its rest plus ~a minute of work.
 * A cardio stage IS its "rest" (the stage timer), with no work on top.
 */
function estimateDuration(exercises: readonly Exercise[]): string {
  let seconds = 0;
  for (const ex of exercises) seconds += isCardio(ex) ? ex.sets * ex.rest : ex.sets * (ex.rest + 60);
  const minutes = Math.max(5, Math.round(seconds / 60 / 5) * 5);
  return `~${minutes} דק׳`;
}

/**
 * Focus line of an edited day: the distinct muscle labels of its exercises.
 * Capped at five so the header stays one or two lines on a phone; anything
 * beyond that is summarised rather than dropped silently.
 */
const FOCUS_MAX = 5;

function focusOf(exercises: readonly Exercise[], fallback: string): string {
  const seen: string[] = [];
  for (const ex of exercises) {
    const m = ex.muscle.trim();
    if (m && !seen.includes(m)) seen.push(m);
  }
  if (seen.length === 0) return fallback;
  const head = seen.slice(0, FOCUS_MAX).join(' · ');
  return seen.length > FOCUS_MAX ? `${head} ועוד` : head;
}

function sameAsBuiltIn(rows: readonly PlanExercise[], base: Day): boolean {
  if (rows.length !== base.exercises.length) return false;
  return rows.every((r, i) => {
    const ex = base.exercises[i];
    return !!ex && ex.id === r.id && ex.sets === r.sets && ex.reps === r.reps && ex.rest === r.rest;
  });
}

/** True when a plan day is the built-in day, down to its name and weekdays. */
function isUntouchedBuiltInDay(pd: PlanDay, base: Day): boolean {
  if (pd.label !== base.label) return false;
  const key = pd.key;
  if (!isBuiltInDayKey(key)) return false;
  const weekdays = pd.weekdays ?? [];
  const builtIn = BUILTIN_WEEKDAYS[key];
  if (weekdays.length !== builtIn.length || weekdays.some((w, i) => w !== builtIn[i])) return false;
  return sameAsBuiltIn(pd.exercises, base);
}

/**
 * A plan document as the ordered `ResolvedProgram` every screen renders.
 *
 * `null` hands back `BUILTIN_PROGRAM` ITSELF (same object reference), whose days
 * are the `PROGRAM` objects themselves — the zero-change guarantee. An
 * unmodified day inside a real plan likewise hands back the built-in `Day`
 * object, so only genuinely edited days differ from today's app.
 */
export function resolveProgram(plan: PlanDoc | null): ResolvedProgram {
  if (!plan) return BUILTIN_PROGRAM;

  const customById = new Map(plan.customExercises.map((c) => [c.id, customToExercise(c)] as const));
  const days: ProgramDay[] = plan.days.map((pd) => {
    const base = isBuiltInDayKey(pd.key) ? PROGRAM[pd.key] : null;
    const weekdays = pd.weekdays ?? [];
    if (base && isUntouchedBuiltInDay(pd, base)) {
      return { key: pd.key, label: base.label, weekdays, day: base };
    }
    const exercises: Exercise[] = [];
    for (const row of pd.exercises) {
      const def = findExercise(row.id) ?? customById.get(row.id) ?? null;
      if (!def) continue; // unknown id — skip, never render a blank card
      exercises.push({ ...def, sets: row.sets, reps: row.reps, rest: row.rest });
    }
    const label = pd.label || base?.label || pd.key;
    const day: Day = {
      day: weekdayCaption(weekdays, base?.day ?? label),
      label,
      dur: estimateDuration(exercises),
      focus: focusOf(exercises, base?.focus ?? label),
      exercises,
    };
    return { key: pd.key, label, weekdays, day };
  });

  return { days, weeklyTarget: clampWeeklyTarget(plan.weeklyTarget) };
}

/**
 * The day the app should open on for a plan: the day assigned to today's
 * weekday, or the plan's FIRST day when nothing claims it.
 *
 * For `null` (the built-in program) this is exactly the legacy mapping:
 * Sun/Mon → A, Tue/Wed → B, Thu–Sat → C.
 */
export function defaultDay(plan: PlanDoc | null, now: Date = new Date()): DayKey {
  return defaultDayOf(resolveProgram(plan), now);
}

/* ------------------------------------------------------- the schedule tabs */

/**
 * Separator between a day key and ONE occurrence of that day in the week.
 *
 * `d_alef@3` = "חלק א' as trained on Wednesday". It is not a new kind of day and
 * it never reaches storage: `viewDayKey` strips it before anything touches a
 * session, an event payload or the XP engine (see `ui/app.ts`, which is the only
 * module that ever holds the composed form).
 *
 * `@` is deliberately outside `isPlanDayKey`'s alphabet, so a composed view id
 * can never collide with a day key a plan minted.
 */
export const VIEW_OCCURRENCE_SEP = '@';

/**
 * ONE tab of the day area.
 *
 * A tab is an OCCURRENCE of a workout, not a workout: an A/B split trained on
 * four weekdays shows four tabs over two days, because that is the week the user
 * actually walks into the gym for, and a written schedule ("ראשון — חלק א'")
 * should be readable straight off the tab bar.
 */
export interface ScheduleTab {
  /** What `UiState.view` stores: `dayKey`, or `dayKey@weekday` when it expands. */
  readonly viewId: string;
  /** The day this tab trains — what sessions, events and XP are keyed by. */
  readonly dayKey: DayKey;
  /** The weekday of this occurrence, or `null` for an unscheduled/routing tab. */
  readonly weekday: number | null;
  /** Big line: the weekday name for an occurrence, the day's caption otherwise. */
  readonly title: string;
  /** Small line: the workout's own name. */
  readonly subtitle: string;
}

/**
 * THE ordered tab list of the day area — the single source of what the tab bar
 * renders, what `UiState.view` may hold, and which tab today opens on.
 *
 * Two shapes, decided by the weekday assignment itself:
 *
 *   * a ROUTING map (the built-in `[0,1] / [2,3] / [4,5,6]`, which every
 *     v1-migrated plan inherits) or a day with no weekdays at all -> ONE tab per
 *     day, titled exactly as before. Expanding a routing map would turn the
 *     three-day program into seven tabs, which is the same lie
 *     `deriveWeeklyTarget` refuses to tell about the weekly target.
 *   * a real SCHEDULE -> one tab per (weekday, day) pair, ascending by weekday,
 *     titled with the weekday name. Days with no weekdays keep their single tab
 *     and are appended, in the plan's own order, after the scheduled ones.
 */
export function scheduleTabs(program: ResolvedProgram): ScheduleTab[] {
  const routing = isBuiltInWeekdayMap(program.days);
  const scheduled: ScheduleTab[] = [];
  const unscheduled: ScheduleTab[] = [];

  for (const d of program.days) {
    const weekdays = routing ? [] : d.weekdays;
    if (weekdays.length === 0) {
      // Exactly today's tab: the day's own caption over its label.
      unscheduled.push({ viewId: d.key, dayKey: d.key, weekday: null, title: d.day.day, subtitle: d.label });
      continue;
    }
    // A day trained once a week keeps its PLAIN key as the view id — there is
    // only one occurrence of it, so there is nothing to disambiguate.
    const expands = weekdays.length > 1;
    for (const w of weekdays) {
      scheduled.push({
        viewId: expands ? `${d.key}${VIEW_OCCURRENCE_SEP}${w}` : d.key,
        dayKey: d.key,
        weekday: w,
        title: WEEKDAY_HE[w] ?? d.day.day,
        subtitle: d.label,
      });
    }
  }

  // Stable sort: two days claiming the same weekday (which the editor prevents,
  // but a document from another device may still carry) stay in plan order.
  scheduled.sort((a, b) => (a.weekday ?? 0) - (b.weekday ?? 0));
  return [...scheduled, ...unscheduled];
}

/**
 * The DAY KEY behind a view id — `d_alef@3` -> `d_alef`, `A` -> `A`.
 *
 * Everything below the UI (sessions, `set_*` payloads, XP grants, history) is
 * keyed by the day, never by the occurrence: two tabs of the same workout are
 * one workout logged on two dates. This is the one function that drops the
 * occurrence, and it is called before any of that machinery is touched.
 */
export function viewDayKey(view: string): DayKey {
  const i = view.indexOf(VIEW_OCCURRENCE_SEP);
  return i < 0 ? view : view.slice(0, i);
}

/**
 * The tab a stored view refers to, or `null` when nothing in the program does.
 *
 * Accepts both forms, which is what keeps every persisted view valid across this
 * change: an exact tab id wins, and a bare day key (what every install stored
 * before schedule-expanded tabs existed) resolves to that day's occurrence for
 * TODAY, or to its first one.
 */
export function resolveTab(program: ResolvedProgram, view: string, now: Date = new Date()): ScheduleTab | null {
  const tabs = scheduleTabs(program);
  const exact = tabs.find((t) => t.viewId === view);
  if (exact) return exact;
  const key = viewDayKey(view);
  const mine = tabs.filter((t) => t.dayKey === key);
  if (mine.length === 0) return null;
  return mine.find((t) => t.weekday === now.getDay()) ?? mine[0] ?? null;
}

/**
 * True for a view a plan can still make sense of: an exact tab id, or the bare
 * key of a day it defines. A weekday the day is NOT trained on (`d_alef@6`) is
 * refused — it would highlight no tab — and falls back to the default.
 */
export function isTabView(program: ResolvedProgram, view: unknown): boolean {
  if (typeof view !== 'string' || view === '') return false;
  const tabs = scheduleTabs(program);
  return tabs.some((t) => t.viewId === view || t.dayKey === view);
}

/**
 * The tab the app opens on: the one scheduled for TODAY's weekday, else the tab
 * of the day `defaultDayOf` picks (which is the legacy Sun/Mon -> A mapping for
 * the built-in program, and the plan's first day when nothing claims today).
 */
export function defaultTab(program: ResolvedProgram, now: Date = new Date()): ScheduleTab | null {
  const tabs = scheduleTabs(program);
  const today = tabs.find((t) => t.weekday === now.getDay());
  if (today) return today;
  const key = defaultDayOf(program, now);
  return tabs.find((t) => t.dayKey === key) ?? tabs[0] ?? null;
}

/** The view id the app boots on — `defaultTab` as `UiState.view` stores it. */
export function defaultTabView(plan: PlanDoc | null, now: Date = new Date()): string {
  const program = resolveProgram(plan);
  return defaultTab(program, now)?.viewId ?? defaultDayOf(program, now);
}

/**
 * Exercise lookup that also knows the plan's custom exercises.
 *
 * Built-ins win, then customs — the `cx_` prefix makes a collision impossible
 * anyway, and the ordering means a built-in can never be shadowed. Screens that
 * show HISTORY (history list, feed, previous-performance) must use this, since
 * they display exercises by id long after a plan changed.
 */
export function makeResolver(plan: PlanDoc | null): ExerciseResolver {
  if (!plan) return findExercise;
  const customById = new Map(plan.customExercises.map((c) => [c.id, customToExercise(c)] as const));
  return (exId: string): Exercise | null => findExercise(exId) ?? customById.get(exId) ?? null;
}

/* ---------------------------------------------------------- validation */

/**
 * Validate a document the user is trying to save. Returns Hebrew messages —
 * the editor shows the first one in a toast. An empty array means "saveable".
 */
export function validatePlanDoc(doc: PlanDoc): string[] {
  const errors: string[] = [];
  const resolve = makeResolver(doc);

  for (const c of doc.customExercises) {
    if (!c.he.trim()) errors.push('לתרגיל מותאם אישית חייב להיות שם בעברית');
    if (c.he.length > PLAN_LIMITS.maxNameLength) errors.push(`שם התרגיל ארוך מדי (עד ${PLAN_LIMITS.maxNameLength} תווים)`);
  }

  if (doc.days.length < PLAN_LIMITS.minDays) errors.push('התוכנית חייבת לכלול לפחות יום אימון אחד');
  if (doc.days.length > PLAN_LIMITS.maxDays) errors.push(`עד ${PLAN_LIMITS.maxDays} ימי אימון בתוכנית`);
  if (
    !Number.isInteger(doc.weeklyTarget) ||
    doc.weeklyTarget < MIN_WEEKLY_TARGET ||
    doc.weeklyTarget > MAX_WEEKLY_TARGET
  ) {
    errors.push(`יעד האימונים השבועי חייב להיות בין ${MIN_WEEKLY_TARGET} ל־${MAX_WEEKLY_TARGET}`);
  }

  const seenKeys = new Set<string>();
  for (const day of doc.days) {
    const rows = day.exercises;
    const label = day.label || day.key;
    if (!isPlanDayKey(day.key)) errors.push(`${label}: מזהה יום לא תקין`);
    else if (seenKeys.has(day.key)) errors.push(`${label}: מזהה היום מופיע פעמיים`);
    seenKeys.add(day.key);
    if (!day.label.trim()) errors.push('לכל יום אימון חייב להיות שם');
    if (day.label.length > PLAN_LIMITS.maxNameLength) {
      errors.push(`שם היום ארוך מדי (עד ${PLAN_LIMITS.maxNameLength} תווים)`);
    }
    for (const w of day.weekdays ?? []) {
      if (!Number.isInteger(w) || w < 0 || w > 6) errors.push(`${label}: יום בשבוע לא תקין`);
    }
    if (rows.length === 0) {
      errors.push(`${label}: יש להשאיר לפחות תרגיל אחד ביום`);
      continue;
    }
    if (rows.length > PLAN_LIMITS.maxExercisesPerDay) {
      errors.push(`${label}: עד ${PLAN_LIMITS.maxExercisesPerDay} תרגילים ליום`);
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const def = resolve(row.id);
      const name = def ? def.he : row.id;
      if (!def) {
        errors.push(`${label}: תרגיל לא מוכר (${row.id})`);
        continue;
      }
      if (seen.has(row.id)) errors.push(`${label}: ${name} מופיע פעמיים`);
      seen.add(row.id);
      const maxSets = maxSetsOf(def);
      if (!Number.isInteger(row.sets) || row.sets < PLAN_LIMITS.minSets || row.sets > maxSets) {
        errors.push(`${name}: מספר ${isCardio(def) ? 'השלבים' : 'הסטים'} חייב להיות בין ${PLAN_LIMITS.minSets} ל־${maxSets}`);
      }
      if (!row.reps.trim()) errors.push(`${name}: יש למלא טווח חזרות`);
      if (!Number.isFinite(row.rest) || row.rest < PLAN_LIMITS.minRest || row.rest > PLAN_LIMITS.maxRest) {
        errors.push(`${name}: זמן המנוחה חייב להיות בין ${PLAN_LIMITS.minRest} ל־${PLAN_LIMITS.maxRest} שניות`);
      }
    }
    errors.push(...supersetErrors(day, resolve));
  }
  return errors;
}

/**
 * The superset half of `validatePlanDoc`, in Hebrew: a pair must name two
 * exercises OF THIS DAY that stand next to each other, and no exercise may be
 * linked twice. `normalizePlanDoc` silently drops such pairs (a document from
 * elsewhere still has to open); a save from the editor is refused instead, so a
 * bug in the editor can never quietly delete the user's link.
 */
function supersetErrors(day: PlanDay, resolve: ExerciseResolver): string[] {
  const errors: string[] = [];
  const label = day.label || day.key;
  const named = (id: string): string => resolve(id)?.he ?? id;
  const index = new Map<string, number>();
  day.exercises.forEach((r, i) => index.set(r.id, i));
  const claimed = new Set<string>();
  for (const pair of supersetPairs(day)) {
    const [a, b] = pair;
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined) {
      errors.push(`${label}: סופר־סט מפנה לתרגיל שאינו ביום הזה`);
      continue;
    }
    if (ib !== ia + 1) {
      errors.push(`${label}: סופר־סט אפשרי רק בין שני תרגילים סמוכים (${named(a)} ו${named(b)})`);
      continue;
    }
    if (claimed.has(a) || claimed.has(b)) {
      errors.push(`${label}: תרגיל יכול להשתתף רק בסופר־סט אחד`);
      continue;
    }
    claimed.add(a);
    claimed.add(b);
  }
  return errors;
}

/* ------------------------------------------------------------- the fold */

/** The plan document as the JSON record a `plan_updated` payload carries. */
export function planToRecord(doc: PlanDoc): Record<string, unknown> {
  return {
    version: doc.version,
    rev: doc.rev,
    days: doc.days,
    weeklyTarget: doc.weeklyTarget,
    customExercises: doc.customExercises,
  };
}

/**
 * Fold the plan out of an event log: LAST `plan_updated` in the total
 * `(ts, id)` order wins, `data_cleared` resets to `null`.
 *
 * That is the whole conflict resolution story for plans across devices, and it
 * is deterministic from the event SET alone — merging two logs in either
 * direction lands on the same document.
 */
export function planFromEvents(events: readonly AppEvent[]): PlanDoc | null {
  let plan: PlanDoc | null = null;
  for (const ev of [...events].sort(compareEvents)) {
    if (ev.type === 'plan_updated') plan = normalizePlanDoc(ev.payload['plan']);
    else if (ev.type === 'data_cleared') plan = null;
  }
  return plan;
}

/* --------------------------------------------------------------- saving */

export interface SavePlanOk {
  ok: true;
  /** The stored document — `null` when the user reset to the built-in program. */
  plan: PlanDoc | null;
  event: AppEvent;
}

export interface SavePlanFailed {
  ok: false;
  errors: string[];
}

export type SavePlanResult = SavePlanOk | SavePlanFailed;

/**
 * Persist a plan: validate, append exactly ONE `plan_updated` event, mirror the
 * result into `state.plan`.
 *
 * `doc === null` is the "reset to the built-in program" save — it is a real
 * event too (a device that only pulls the log must learn about the reset), it
 * simply carries `plan: null`.
 *
 * The event is appended BEFORE the state mirror, exactly like `core/game.ts`
 * does for XP, so "live state === rebuildFromEvents(log)" stays true even if the
 * process dies between the two writes.
 *
 * The streak is re-derived in the same update: a plan carries the WEEKLY TARGET,
 * so saving one can change what a perfect week means from this moment on, and
 * `rebuildFromEvents` of the very same log would say so immediately.
 */
export function savePlan(store: DataStore, doc: PlanDoc | null, now: number = Date.now()): SavePlanResult {
  const current = store.getState().plan;
  const date = todayISO(new Date(now));

  if (doc === null) {
    const payload: PlanUpdatedPayload = { plan: null, revision: (current?.rev ?? 0) + 1, date };
    const event = store.append('plan_updated', payload);
    store.update((draft) => {
      draft.plan = null;
      refinalize(draft, store, now);
    });
    return { ok: true, plan: null, event };
  }

  const errors = validatePlanDoc(doc);
  if (errors.length > 0) return { ok: false, errors };

  const normalized = normalizePlanDoc(planToRecord(doc));
  if (!normalized) return { ok: false, errors: ['התוכנית אינה תקינה'] };
  normalized.rev = Math.max(doc.rev, current?.rev ?? 0) + 1;

  const payload: PlanUpdatedPayload = { plan: planToRecord(normalized), revision: normalized.rev, date };
  const event = store.append('plan_updated', payload);
  store.update((draft) => {
    draft.plan = normalized;
    refinalize(draft, store, now);
  });
  return { ok: true, plan: normalized, event };
}

/** Re-derive the streak against the plan history the log now holds. */
function refinalize(draft: AppState, store: DataStore, now: number): void {
  if (!draft.game) return;
  finalizeGame(draft.game, todayISO(new Date(now)), weeklyTargetsFromEvents(store.getEvents()));
}

/** True when `doc` differs from what is currently stored (drives the save hint). */
export function planIsDirty(doc: PlanDoc, stored: PlanDoc | null): boolean {
  const base = stored ?? defaultPlanDoc();
  return JSON.stringify(planToRecord({ ...doc, rev: 0 })) !== JSON.stringify(planToRecord({ ...base, rev: 0 }));
}

/** True when a saved plan is materially the built-in program (nothing edited). */
export function isDefaultPlan(doc: PlanDoc | null): boolean {
  if (!doc) return true;
  return !planIsDirty(doc, defaultPlanDoc());
}

/* -------------------------------------------------- the user's own presets */

/**
 * Read a `plan_preset_saved` payload into a valid `UserPreset`, or `null` when
 * it is not one (bad id, empty name, a plan that does not survive
 * normalisation). Used by the fold, by `normalizeUserPresets` (a stored blob is
 * just as untrusted) and by the live driver — ONE reader, three doors, exactly
 * the `mealRecordOf` idiom.
 */
export function userPresetOf(payload: Record<string, unknown>): { id: string; preset: UserPreset } | null {
  const id = payload['presetId'];
  if (!isUserPresetId(id)) return null;
  const name = typeof payload['name'] === 'string' ? payload['name'].trim().slice(0, PLAN_LIMITS.maxNameLength) : '';
  if (!name) return null;
  const plan = normalizePlanDoc(payload['plan']);
  if (!plan) return null;
  // The stored document is a TEMPLATE, not a live plan: its revision counter is
  // meaningless, so it is pinned to 0 and the same preset saved from two
  // different plan revisions still compares equal.
  plan.rev = 0;
  return { id, preset: { name, plan } };
}

/**
 * THE fold of the user's presets — shared verbatim by the live write path and by
 * `rebuildFromEvents`, the same contract `applyNutritionEvent` keeps for meals.
 *
 * `plan_preset_saved` upserts its id (LWW under the caller's `(ts, id)` order),
 * `plan_preset_deleted` removes it, and anything malformed folds to nothing.
 * `data_cleared` is the caller's business, like it is for sessions and the plan.
 */
export function applyPlanPresetEvent(
  presets: Record<string, UserPreset>,
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (type === 'plan_preset_saved') {
    const read = userPresetOf(payload);
    if (read) presets[read.id] = read.preset;
  } else if (type === 'plan_preset_deleted') {
    const id = payload['presetId'];
    if (isUserPresetId(id)) delete presets[id];
  }
}

/** Route ANY persisted presets blob to a valid map. Never throws. */
export function normalizeUserPresets(raw: unknown): Record<string, UserPreset> {
  const out: Record<string, UserPreset> = {};
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(raw)) {
    const entry = raw[key];
    if (!isRecord(entry)) continue;
    const read = userPresetOf({ presetId: key, name: entry['name'], plan: entry['plan'] });
    if (read) out[key] = read.preset;
  }
  return out;
}

/**
 * The presets in the order the sheet lists them: the fold's own insertion order,
 * which IS the `(ts, id)` order of their first save — oldest first, like a
 * shelf that grows at the far end.
 */
export function userPresetList(state: AppState): Array<{ id: string; preset: UserPreset }> {
  return Object.entries(state.planPresets).map(([id, preset]) => ({ id, preset }));
}

/**
 * A fresh document from a saved preset — what the editor loads into the draft.
 *
 * Day keys are MINTED PER APPLICATION, exactly like `PlanPreset.build()` and for
 * the same reasons: sessions logged under the preset's original days keep
 * pointing at the original keys (the history screen resolves those through
 * `dayLabelOf`), and two devices that both apply it do not silently merge their
 * days into one. Everything else — labels, weekdays, rows, supersets, custom
 * exercises — is carried over verbatim; custom-exercise ids deliberately KEEP
 * their `cx_` ids, so re-applying the preset reattaches their history and PRs.
 */
export function instantiateUserPreset(preset: UserPreset): PlanDoc {
  const doc = clonePlanDoc(preset.plan);
  doc.rev = 0;
  doc.days = doc.days.map((d) =>
    makePlanDay(newDayKey(), d.label, d.weekdays ?? [], d.exercises, supersetPairs(d)),
  );
  return doc;
}

export interface SaveUserPresetOk {
  ok: true;
  presetId: string;
  preset: UserPreset;
  event: AppEvent;
}

export interface SaveUserPresetFailed {
  ok: false;
  error: string;
}

export type SaveUserPresetResult = SaveUserPresetOk | SaveUserPresetFailed;

/**
 * Freeze a plan under a name: validate, append exactly ONE `plan_preset_saved`
 * event, mirror it into `state.planPresets` — append before mirror, the
 * `savePlan` contract, so "live state === rebuildFromEvents(log)" survives a
 * crash between the two writes.
 *
 * The cap is enforced HERE and only here: it is a UX guard against an unbounded
 * shelf, not an invariant — the fold accepts whatever a merged log carries, so
 * two capped devices that merge may legitimately hold more than the cap.
 */
export function saveUserPreset(
  store: DataStore,
  name: string,
  doc: PlanDoc,
  now: number = Date.now(),
): SaveUserPresetResult {
  const trimmed = name.trim().slice(0, PLAN_LIMITS.maxNameLength);
  if (!trimmed) return { ok: false, error: 'לתוכנית שמורה צריך שם. ✏️' };
  if (Object.keys(store.getState().planPresets).length >= MAX_USER_PRESETS) {
    return { ok: false, error: `אפשר לשמור עד ${MAX_USER_PRESETS} תוכניות — מחקו אחת ישנה קודם.` };
  }
  const errors = validatePlanDoc(doc);
  if (errors.length > 0) return { ok: false, error: errors[0] ?? 'התוכנית אינה תקינה' };
  const normalized = normalizePlanDoc(planToRecord(doc));
  if (!normalized) return { ok: false, error: 'התוכנית אינה תקינה' };
  normalized.rev = 0;

  const payload: PlanPresetSavedPayload = {
    presetId: newUserPresetId(),
    name: trimmed,
    plan: planToRecord(normalized),
    date: todayISO(new Date(now)),
  };
  const event = store.append('plan_preset_saved', payload);
  store.update((draft) => {
    applyPlanPresetEvent(draft.planPresets, 'plan_preset_saved', payload);
  });
  return { ok: true, presetId: payload.presetId, preset: { name: trimmed, plan: normalized }, event };
}

/**
 * Delete one saved preset. Returns false (and appends nothing) for an id the
 * state does not hold — a double-tap must not write a second event.
 */
export function deleteUserPreset(store: DataStore, presetId: string, now: number = Date.now()): boolean {
  if (!isUserPresetId(presetId) || !store.getState().planPresets[presetId]) return false;
  const payload: PlanPresetDeletedPayload = { presetId, date: todayISO(new Date(now)) };
  store.append('plan_preset_deleted', payload);
  store.update((draft) => {
    applyPlanPresetEvent(draft.planPresets, 'plan_preset_deleted', payload);
  });
  return true;
}

/** Every exercise the library offers for a day: built-ins first, then customs. */
export function libraryExercises(plan: PlanDoc | null): Exercise[] {
  const out: Exercise[] = builtInExercises();
  if (plan) for (const c of plan.customExercises) out.push(customToExercise(c));
  return out;
}

/** Day key of a `PlanDoc`'s day, guarded for untrusted input. */
export function planDayKey(v: unknown): DayKey | null {
  return isPlanDayKey(v) ? v : null;
}
