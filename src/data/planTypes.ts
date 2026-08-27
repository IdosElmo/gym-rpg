/**
 * data/planTypes.ts — the shape of a USER-EDITED training plan.
 *
 * A `PlanDoc` is the whole plan in one JSON-serialisable object: it is what the
 * editor edits, what a `plan_updated` event carries, and what `AppState.plan`
 * caches. It deliberately does NOT contain the coaching copy (steps / cue /
 * mistake) of the built-in exercises — a plan row that points at a built-in id
 * only overrides the numbers, so improving the program text in a later release
 * automatically improves an existing user's plan too.
 *
 * SKELETON (v2) — a plan defines its OWN days.
 * v1 had exactly three days, A/B/C, fixed at compile time: a plan could edit
 * what was INSIDE a day but never how many days there were. v2 makes `days` an
 * ORDERED ARRAY of 1–7 `PlanDay`s, each with a stable `key`, a Hebrew `label`
 * and the `weekdays` it is trained on, plus a `weeklyTarget` that tells the
 * streak how many training days make a perfect week. A 4-days-a-week A/B split
 * is then two days trained on four weekdays with `weeklyTarget: 4`.
 *
 * `null` (no plan at all) is a first-class value everywhere and means "the
 * built-in PROGRAM": `resolveProgram(null)` hands back `BUILTIN_PROGRAM`
 * itself, so a user who never opened the editor runs byte-identical code paths.
 */

import {
  DEFAULT_WEEKLY_TARGET,
  MAX_WEEKLY_TARGET,
  MIN_WEEKLY_TARGET,
  type BodyPart,
  type BodyPartSplit,
  type DayKey,
  type EquipmentKey,
} from './program.ts';

/**
 * Current on-disk version of a plan document.
 *
 * v1 -> v2: `days` became an ordered array of self-describing days and
 * `weeklyTarget` joined the document. `normalizePlanDoc` migrates a v1 blob (and
 * a v1 `plan_updated` payload from an older client) on the way in; it is never
 * written back in v1 form.
 */
export const PLAN_DOC_VERSION = 2;

/** The version this document shape replaced — still accepted on read. */
export const PLAN_DOC_VERSION_V1 = 1;

/** Prefix of every custom-exercise id — the only thing that distinguishes them. */
export const CUSTOM_ID_PREFIX = 'cx_';

/** Prefix of every day key the editor MINTS (built-in days keep 'A'/'B'/'C'). */
export const DAY_ID_PREFIX = 'd_';

/**
 * One row of a day: WHICH exercise, and the numbers the user chose for it.
 *
 * `id` points either at a built-in exercise (`a1`, `b3`, …) or at a
 * `CustomExercise` of the same document (`cx_…`). Everything else about the
 * exercise (name, steps, body part) comes from that definition.
 */
export interface PlanExercise {
  id: string;
  sets: number;
  /** Free text, exactly like the program's own scheme ("8–10", "עד כשל"). */
  reps: string;
  /** Rest in seconds — drives the auto rest timer. */
  rest: number;
}

/**
 * ONE workout day of a plan.
 *
 * `key` is STABLE and is what everything else in the app refers to: sessions,
 * event payloads and the selected tab all carry it. Renaming a day (`label`) or
 * moving it in the array therefore never orphans a logged workout.
 */
export interface PlanDay {
  /** `'A' | 'B' | 'C'` for a day migrated from v1, `'d_' + uuid slice` for a new one. */
  key: DayKey;
  /** Hebrew workout name, e.g. "אימון A" / "חלק א'". */
  label: string;
  /**
   * Weekdays this day is trained on (0 = Sunday … 6 = Saturday), ascending and
   * deduplicated. Optional: a day with none is simply never auto-selected.
   */
  weekdays?: number[];
  exercises: PlanExercise[];
  /**
   * SUPERSETS — pairs of exercises performed back to back, with ONE rest.
   *
   * Each pair is `[first, second]` and both ids must belong to this day and be
   * ADJACENT in `exercises` (`first` immediately before `second`); an id may
   * appear in at most one pair. The field is optional and additive on purpose:
   * a `plan_updated` payload written before supersets existed simply has none,
   * and an older client that reads a payload WITH them ignores the key instead
   * of rejecting the document (which is why the document version stays at 2).
   *
   * The linkage lives here and only here. It changes how the workout screen
   * renders and what one ✓ tap does — it never adds an event type: a superset
   * tap appends the same two ordinary `set_completed` events the two checkboxes
   * would have appended on their own.
   */
  supersets?: readonly (readonly [string, string])[];
}

/**
 * An exercise the user invented. It carries just enough metadata to be a
 * first-class citizen of the XP engine (`bodyPart` + optional `split` feed
 * `bodyPartWeights`), and nothing else: there is no coaching copy, so the
 * workout screen hides the "הסבר ודגשי ביצוע" panel for it.
 */
export interface CustomExercise {
  /** `cx_` + a uuid slice — globally unique, so two devices never collide. */
  id: string;
  he: string;
  en: string;
  bodyPart: BodyPart;
  /** Optional secondary split; when present it INCLUDES the primary part. */
  split?: BodyPartSplit;
  /** Unit of the second logged field ("חזרות" / "שניות"). */
  unit: string;
  equip: EquipmentKey[];
  /** Short Hebrew muscle label for the 🎯 badge. */
  muscle: string;
}

/**
 * THE plan document.
 *
 * `rev` is bumped on every save. It is bookkeeping for humans and for the
 * history feed — the authoritative conflict rule is the fold order of the event
 * log (`(ts, id)`, last `plan_updated` wins), never this number.
 */
export interface PlanDoc {
  version: typeof PLAN_DOC_VERSION;
  rev: number;
  /** Ordered — this order IS the tab order. 1–7 days, keys unique. */
  days: PlanDay[];
  /**
   * Distinct training days per week that make a "perfect week" for the streak.
   * Independent of `days.length`: two workouts alternated over four weekdays is
   * `days.length === 2` and `weeklyTarget === 4`.
   */
  weeklyTarget: number;
  customExercises: CustomExercise[];
}

/** True for an id minted by the plan editor (as opposed to a built-in one). */
export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

/** Round + clamp any input into a legal weekly target (1–7). */
export function clampWeeklyTarget(v: unknown, fallback: number = DEFAULT_WEEKLY_TARGET): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return n < MIN_WEEKLY_TARGET ? MIN_WEEKLY_TARGET : n > MAX_WEEKLY_TARGET ? MAX_WEEKLY_TARGET : n;
}

/**
 * The weekly target carried by a RAW `plan_updated` payload, without building
 * the whole document.
 *
 * The streak needs this and only this while it replays the log (see
 * `weeklyTargetsFromEvents` in core/xp.ts), and reading it here — next to the
 * document shape it belongs to — is what keeps the XP engine free of any import
 * from the plan model.
 *
 *   `null` / junk / a FUTURE version -> the built-in target (the same fallback
 *   `normalizePlanDoc` applies when it rejects a document);
 *   a v1 payload                     -> the built-in target (v1 had no field);
 *   a v2 payload                     -> its own target, clamped to 1–7.
 */
export function weeklyTargetOfPlanPayload(raw: unknown): number {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return DEFAULT_WEEKLY_TARGET;
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_WEEKLY_TARGET;
  const doc = raw as Record<string, unknown>;
  const version = doc['version'];
  if (version !== PLAN_DOC_VERSION) return DEFAULT_WEEKLY_TARGET;
  return clampWeeklyTarget(doc['weeklyTarget']);
}
