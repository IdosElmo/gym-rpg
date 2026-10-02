/**
 * i18n/content/program.en.ts — the English overlay of data/program.ts.
 *
 * Keyed by the program's stable ids. `data/program.ts` itself is never edited
 * for a translation (the legacy parity test pins it byte-for-byte); every
 * screen reads exercise copy through `i18n/content.ts`, which consults this
 * map in English and falls back to the Hebrew original for anything missing.
 *
 * Voice: second person, imperative, short — the same coaching voice as the
 * Hebrew ("Set the bench to 30°.", "Common mistake: …").
 */

import type { BuiltInDayKey } from '../../data/program.ts';
import type { DayCopy, ExerciseCopy } from '../content.ts';

export const EXERCISE_EN: Readonly<Record<string, ExerciseCopy>> = {};

/** The built-in days' header lines. */
export const DAY_EN: Readonly<Partial<Record<BuiltInDayKey, DayCopy>>> = {};

/**
 * Word-level map for the 🎯 muscle badge, keyed by the exact Hebrew string the
 * program (and the custom-exercise picker) uses. Consulted when an exercise
 * has no `muscle` of its own in `EXERCISE_EN` — i.e. for custom exercises.
 */
export const MUSCLE_EN: Readonly<Record<string, string>> = {};
