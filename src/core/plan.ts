/**
 * core/plan.ts — the headless plan model.
 *
 * THE contract of this module is one sentence: **`resolveProgram(null)` returns
 * the built-in `PROGRAM` object itself**. A user who never opened the plan
 * editor has `state.plan === null`, so every screen keeps reading the exact same
 * frozen program it read before this feature existed — no copy, no re-derivation,
 * no behavioural drift. Everything else here only matters once a plan is saved.
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
  DAY_ORDER,
  PROGRAM,
  findExercise,
  isDayKey,
  type BodyPart,
  type BodyPartSplit,
  type Day,
  type DayKey,
  type EquipmentKey,
  type Exercise,
  type ExerciseResolver,
  type ProgramMap,
} from '../data/program.ts';
import {
  CUSTOM_ID_PREFIX,
  PLAN_DOC_VERSION,
  type CustomExercise,
  type PlanDay,
  type PlanDoc,
  type PlanExercise,
} from '../data/planTypes.ts';
import { uuid } from '../util/uuid.ts';
import { compareEvents } from './xp.ts';
import { todayISO } from './workout.ts';
import type { AppEvent, DataStore, PlanUpdatedPayload } from '../storage/DataStore.ts';

/* ----------------------------------------------------------------- limits */

/** The editable ranges. The editor clamps to them and `savePlan` enforces them. */
export const PLAN_LIMITS = {
  minSets: 1,
  maxSets: 10,
  minRest: 15,
  maxRest: 600,
  maxExercisesPerDay: 20,
  maxNameLength: 60,
  maxRepsLength: 24,
} as const;

/** Defaults a freshly added row starts with. */
export const NEW_ROW_DEFAULTS = { sets: 3, reps: '10–12', rest: 90 } as const;

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

/* ------------------------------------------------------------- the default */

/**
 * The built-in program expressed AS a plan document — the starting point of
 * every edit session. Resolving it yields days that are `===` the PROGRAM days
 * (see `resolveProgram`), so "open the editor and save without changing
 * anything" is a genuine no-op for every screen.
 */
export function defaultPlanDoc(program: ProgramMap = PROGRAM): PlanDoc {
  const days = {} as Record<DayKey, PlanDay>;
  for (const k of DAY_ORDER) {
    days[k] = {
      exercises: program[k].exercises.map((ex) => ({
        id: ex.id,
        sets: ex.sets,
        reps: ex.reps,
        rest: ex.rest,
      })),
    };
  }
  return { version: PLAN_DOC_VERSION, rev: 0, days, customExercises: [] };
}

/** Deep copy — the editor mutates a draft that must not touch the saved doc. */
export function clonePlanDoc(doc: PlanDoc): PlanDoc {
  const days = {} as Record<DayKey, PlanDay>;
  for (const k of DAY_ORDER) {
    days[k] = { exercises: (doc.days[k]?.exercises ?? []).map((r) => ({ ...r })) };
  }
  return {
    version: PLAN_DOC_VERSION,
    rev: doc.rev,
    days,
    customExercises: doc.customExercises.map((c) => cloneCustom(c)),
  };
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
    sets: clampInt(raw['sets'], PLAN_LIMITS.minSets, PLAN_LIMITS.maxSets, def.sets),
    reps,
    rest: clampInt(raw['rest'], PLAN_LIMITS.minRest, PLAN_LIMITS.maxRest, def.rest),
  };
}

/**
 * Route ANY persisted / received plan blob to a valid `PlanDoc`, or to `null`
 * (which every consumer reads as "the built-in program"). Never throws.
 *
 * Repairs rather than rejects wherever it can: out-of-range numbers are clamped,
 * unknown body parts fall back, unresolvable rows are dropped. A day left empty
 * by that dropping falls back to the built-in day, so a corrupt blob can never
 * produce a workout screen with nothing on it.
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
  // A document from a FUTURE version is not ours to guess at — fall back to the
  // built-in program rather than silently mangling it.
  const version = raw['version'];
  if (version !== undefined && version !== PLAN_DOC_VERSION) return null;

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

  const fallback = defaultPlanDoc();
  const daysRaw = isRecord(raw['days']) ? raw['days'] : {};
  const days = {} as Record<DayKey, PlanDay>;
  for (const k of DAY_ORDER) {
    const dayRaw = daysRaw[k];
    const list = isRecord(dayRaw) && Array.isArray(dayRaw['exercises']) ? dayRaw['exercises'] : [];
    const rows: PlanExercise[] = [];
    const seen = new Set<string>();
    for (const r of list) {
      if (rows.length >= PLAN_LIMITS.maxExercisesPerDay) break;
      const row = normalizeRow(r, known);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    days[k] = { exercises: rows.length > 0 ? rows : (fallback.days[k]?.exercises ?? []) };
  }

  // Keep only the customs some day actually references, so a doc cannot grow
  // an unbounded graveyard of exercises the user deleted long ago.
  const referenced = new Set<string>();
  for (const k of DAY_ORDER) for (const r of days[k].exercises) referenced.add(r.id);

  return {
    version: PLAN_DOC_VERSION,
    rev: Math.max(0, clampInt(raw['rev'], 0, Number.MAX_SAFE_INTEGER, 0)),
    days,
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

/** Estimated duration of a day: every set costs its rest plus ~a minute of work. */
function estimateDuration(exercises: readonly Exercise[]): string {
  let seconds = 0;
  for (const ex of exercises) seconds += ex.sets * (ex.rest + 60);
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

/**
 * A plan document as the `ProgramMap` every screen renders.
 *
 * `null` hands back `PROGRAM` ITSELF (same object reference) — the zero-change
 * guarantee. An unmodified day inside a real plan likewise hands back the
 * built-in `Day` object, so only genuinely edited days differ from today's app.
 */
export function resolveProgram(plan: PlanDoc | null, program: ProgramMap = PROGRAM): ProgramMap {
  if (!plan) return program;

  const customById = new Map(plan.customExercises.map((c) => [c.id, customToExercise(c)] as const));
  const days = {} as Record<DayKey, Day>;
  for (const k of DAY_ORDER) {
    const base = program[k];
    const rows = plan.days[k]?.exercises ?? [];
    if (sameAsBuiltIn(rows, base)) {
      days[k] = base;
      continue;
    }
    const exercises: Exercise[] = [];
    for (const row of rows) {
      const def = findExercise(row.id) ?? customById.get(row.id) ?? null;
      if (!def) continue; // unknown id — skip, never render a blank card
      exercises.push({ ...def, sets: row.sets, reps: row.reps, rest: row.rest });
    }
    days[k] = {
      day: base.day,
      label: base.label,
      dur: estimateDuration(exercises),
      focus: focusOf(exercises, base.focus),
      exercises,
    };
  }
  return days;
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

  for (const k of DAY_ORDER) {
    const rows = doc.days[k]?.exercises ?? [];
    const label = PROGRAM[k].label;
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
      if (!Number.isInteger(row.sets) || row.sets < PLAN_LIMITS.minSets || row.sets > PLAN_LIMITS.maxSets) {
        errors.push(`${name}: מספר הסטים חייב להיות בין ${PLAN_LIMITS.minSets} ל־${PLAN_LIMITS.maxSets}`);
      }
      if (!row.reps.trim()) errors.push(`${name}: יש למלא טווח חזרות`);
      if (!Number.isFinite(row.rest) || row.rest < PLAN_LIMITS.minRest || row.rest > PLAN_LIMITS.maxRest) {
        errors.push(`${name}: זמן המנוחה חייב להיות בין ${PLAN_LIMITS.minRest} ל־${PLAN_LIMITS.maxRest} שניות`);
      }
    }
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
 */
export function savePlan(store: DataStore, doc: PlanDoc | null, now: number = Date.now()): SavePlanResult {
  const current = store.getState().plan;
  const date = todayISO(new Date(now));

  if (doc === null) {
    const payload: PlanUpdatedPayload = { plan: null, revision: (current?.rev ?? 0) + 1, date };
    const event = store.append('plan_updated', payload);
    store.update((draft) => {
      draft.plan = null;
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
  });
  return { ok: true, plan: normalized, event };
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

/** Every exercise the library offers for a day: built-ins first, then customs. */
export function libraryExercises(plan: PlanDoc | null): Exercise[] {
  const out: Exercise[] = [];
  for (const k of DAY_ORDER) {
    for (const ex of PROGRAM[k].exercises) if (!out.some((e) => e.id === ex.id)) out.push(ex);
  }
  if (plan) for (const c of plan.customExercises) out.push(customToExercise(c));
  return out;
}

/** Day key of a `PlanDoc`'s day, guarded for untrusted input. */
export function planDayKey(v: unknown): DayKey | null {
  return isDayKey(v) ? v : null;
}
