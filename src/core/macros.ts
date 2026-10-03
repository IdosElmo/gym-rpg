/**
 * core/macros.ts — the daily carbs and fat targets, explicit or derived.
 *
 * The questionnaire (core/profile.ts) sets calories and protein. Carbs and fat
 * follow from them unless the user sets them in the targets card: fat is 30%
 * of the calories (÷ 9 kcal/g), and carbs are what is LEFT after protein and
 * fat (÷ 4 kcal/g), never negative. An explicit fat target feeds the carbs
 * remainder in its place, so the three always add up to the calories.
 *
 * Pure: no store, no clock, no locale — the screen asks, this answers.
 */

import type { NutritionTargets } from '../storage/DataStore.ts';

/** The share of the day's calories the default split gives to fat. */
export const DEFAULT_FAT_SHARE = 0.3;
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** The default split for a calorie + protein target: fat 30% ÷ 9, carbs the remainder ÷ 4 (≥ 0). */
export function defaultSplit(calories: number, protein: number, fat?: number): { carbs: number; fat: number } {
  const f = fat ?? Math.round((calories * DEFAULT_FAT_SHARE) / KCAL_PER_G.fat);
  const rest = calories - protein * KCAL_PER_G.protein - f * KCAL_PER_G.fat;
  return { carbs: Math.max(0, Math.round(rest / KCAL_PER_G.carbs)), fat: f };
}

export interface MacroTargets {
  carbs: number | null;
  fat: number | null;
  /** True where the number is the default split, not one the user set. */
  derived: { carbs: boolean; fat: boolean };
}

/**
 * The carbs and fat the day's bars fill toward. An explicit target always
 * wins; a missing one is derived only when BOTH calories and protein are set
 * (otherwise there is nothing to split), else `null` — no target.
 */
export function macroTargets(t: NutritionTargets): MacroTargets {
  const canDerive = t.calories !== null && t.calories > 0 && t.protein !== null;
  const split = canDerive ? defaultSplit(t.calories as number, t.protein as number, t.fat) : null;
  const carbs = t.carbs ?? split?.carbs ?? null;
  const fat = t.fat ?? split?.fat ?? null;
  return { carbs, fat, derived: { carbs: t.carbs === undefined && carbs !== null, fat: t.fat === undefined && fat !== null } };
}
