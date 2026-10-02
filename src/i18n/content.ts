/**
 * i18n/content.ts — the built-in CONTENT in the reader's language: exercise
 * names and coaching copy, the built-in days' header lines, body parts,
 * equipment, units and rep schemes.
 *
 * THE DATA FILES STAY HEBREW. `data/program.ts` is the verbatim port of the
 * legacy app, guarded byte-for-byte by tests/program.test.ts, so a translation
 * may not live inside it. It lives BESIDE it, as an overlay keyed by the same
 * stable ids (`content/program.en.ts`), and every screen reads exercise copy
 * through the accessors below instead of off the object. In Hebrew each
 * accessor returns the field itself, so nothing a Hebrew user sees moves; in
 * English it returns the overlay's text, and falls back to the Hebrew original
 * only for an id the overlay does not (yet) cover — a gap is visible, never
 * blank.
 *
 * A CUSTOM exercise (`cx_…`) is user content: its own `he` / `en` names are
 * whatever the user typed. Its unit and muscle came from the editor's pickers,
 * which offer the program's own Hebrew words, so they go through the same
 * word-level maps as the built-ins.
 */

import type { BodyPart, Day, Exercise } from '../data/program.ts';
import { DAY_EN, EXERCISE_EN, MUSCLE_EN } from './content/program.en.ts';
import { locale } from './locale.ts';

/** The translatable fields of one exercise. Every field optional: a gap falls back. */
export interface ExerciseCopy {
  readonly name?: string;
  readonly muscle?: string;
  readonly steps?: readonly string[];
  readonly cue?: string;
  readonly mistake?: string;
  /** Cardio only: the load column's name ("Incline"). */
  readonly loadLabel?: string;
  /** Cardio only: the load's short unit when it is a word ("level"). */
  readonly loadUnit?: string;
}

/** The translatable header lines of one built-in day. */
export interface DayCopy {
  readonly day?: string;
  readonly label?: string;
  readonly dur?: string;
  readonly focus?: string;
}

const isEn = (): boolean => locale() === 'en';

function copyOf(ex: Exercise): ExerciseCopy | undefined {
  return EXERCISE_EN[ex.id];
}

/** The exercise's name as the main line of a card. */
export function exName(ex: Exercise): string {
  if (!isEn()) return ex.he;
  return copyOf(ex)?.name ?? (ex.en.trim() !== '' ? ex.en : ex.he);
}

/**
 * The small second line under the name — the English name under the Hebrew one,
 * as the app has always shown it. English has no second language to show, so
 * it is `''` there (callers drop the element).
 */
export function exSubName(ex: Exercise): string {
  return isEn() ? '' : ex.en;
}

/** The 🎯 muscle badge. */
export function exMuscle(ex: Exercise): string {
  if (!isEn()) return ex.muscle;
  return copyOf(ex)?.muscle ?? MUSCLE_EN[ex.muscle] ?? ex.muscle;
}

export function exSteps(ex: Exercise): readonly string[] {
  if (!isEn()) return ex.steps;
  return copyOf(ex)?.steps ?? ex.steps;
}

export function exCue(ex: Exercise): string {
  if (!isEn()) return ex.cue;
  return copyOf(ex)?.cue ?? ex.cue;
}

export function exMistake(ex: Exercise): string {
  if (!isEn()) return ex.mistake;
  return copyOf(ex)?.mistake ?? ex.mistake;
}

/** Cardio: the load column's name ("שיפוע" / "Incline"). `''` for a strength exercise. */
export function exLoadLabel(ex: Exercise): string {
  const c = ex.cardio;
  if (!c) return '';
  if (!isEn()) return c.loadLabel;
  return copyOf(ex)?.loadLabel ?? c.loadLabel;
}

/** Cardio: the load's short unit ("%", "W", "רמה" / "level"). */
export function exLoadUnit(ex: Exercise): string {
  const c = ex.cardio;
  if (!c) return '';
  if (!isEn()) return c.loadUnit;
  return copyOf(ex)?.loadUnit ?? c.loadUnit;
}

const UNIT_EN: Readonly<Record<string, string>> = {
  'חזרות': 'reps',
  'חזרות/צד': 'reps/side',
  'חזרות/רגל': 'reps/leg',
  'שניות': 'seconds',
  'דקות': 'minutes',
};

/** The second logged field's unit ("חזרות" / "reps"). */
export function exUnit(ex: Exercise): string {
  return isEn() ? (UNIT_EN[ex.unit] ?? ex.unit) : ex.unit;
}

/** A unit word on its own (custom-exercise picker options). */
export function unitWord(heUnit: string): string {
  return isEn() ? (UNIT_EN[heUnit] ?? heUnit) : heUnit;
}

/**
 * A rep scheme in the reader's language. Rep schemes are free text, copied
 * from the program into every plan, so English rewrites the handful of Hebrew
 * WORDS the program uses ("לצד", "שנ׳", "עד כשל"…) and leaves the numbers —
 * and anything a user typed that is not one of those words — untouched.
 */
export function repsText(reps: string): string {
  if (!isEn()) return reps;
  return reps
    .replace(/עד כשל/g, 'to failure')
    .replace(/\(\s*(\d+)\s*לצד\s*\)/g, '($1 per side)')
    .replace(/לצד/g, 'per side')
    .replace(/לרגל/g, 'per leg')
    .replace(/שנ׳/g, 's')
    .replace(/דק׳/g, 'min');
}

const BODY_PART: Readonly<Record<'he' | 'en', Readonly<Record<BodyPart, string>>>> = {
  he: { chest: 'חזה', back: 'גב', legs: 'רגליים', shoulders: 'כתפיים', arms: 'ידיים', core: 'ליבה' },
  en: { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', arms: 'Arms', core: 'Core' },
};

/** A body part's name ("חזה" / "Chest"). */
export function bodyPartName(bp: BodyPart): string {
  return BODY_PART[isEn() ? 'en' : 'he'][bp];
}

const EQUIP: Readonly<Record<'he' | 'en', Readonly<Record<string, string>>>> = {
  he: { 'Smith Machine': 'סמית׳', Dumbbells: 'משקולות', Bodyweight: 'משקל גוף', Machine: 'מכונה' },
  en: { 'Smith Machine': 'Smith machine', Dumbbells: 'Dumbbells', Bodyweight: 'Bodyweight', Machine: 'Machine' },
};

/** An equipment key's label ("משקולות" / "Dumbbells"). Unknown keys pass through. */
export function equipName(key: string): string {
  return EQUIP[isEn() ? 'en' : 'he'][key] ?? key;
}

/** A built-in day's header copy in the reader's language (custom days pass through). */
export function localizeDay(key: string, day: Day): Day {
  if (!isEn()) return day;
  const c = (DAY_EN as Readonly<Record<string, DayCopy | undefined>>)[key];
  if (!c) return day;
  return {
    ...day,
    day: c.day ?? day.day,
    label: c.label ?? day.label,
    dur: c.dur ?? day.dur,
    focus: c.focus ?? day.focus,
  };
}
