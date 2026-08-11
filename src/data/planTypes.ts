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
 * SKELETON — the three days A/B/C are fixed (the user-approved scope): a plan
 * edits what is INSIDE a day, never how many days there are.
 *
 * `null` (no plan at all) is a first-class value everywhere and means "the
 * built-in PROGRAM": `resolveProgram(null)` hands back the PROGRAM object
 * itself, so a user who never opened the editor runs byte-identical code paths.
 */

import type { BodyPart, BodyPartSplit, DayKey, EquipmentKey } from './program.ts';

/** Current on-disk version of a plan document. */
export const PLAN_DOC_VERSION = 1;

/** Prefix of every custom-exercise id — the only thing that distinguishes them. */
export const CUSTOM_ID_PREFIX = 'cx_';

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

export interface PlanDay {
  exercises: PlanExercise[];
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
  days: Record<DayKey, PlanDay>;
  customExercises: CustomExercise[];
}

/** True for an id minted by the plan editor (as opposed to a built-in one). */
export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}
