/**
 * core/xp.ts — XP formulas, levels, streaks.
 *
 * PHASE 0 PLACEHOLDER — types only, no logic yet.
 * Phase 1 implements these as PURE functions (no DOM, no storage) plus Vitest
 * coverage for: the level curve, volumeFactor clamping, PR detection (×2 XP +
 * `pr_achieved` event), workout-completion bonus and the Sun–Sat streak tiers.
 *
 * Inputs it will consume, already available in Phase 0:
 *   - `bodyPartWeights(exercise)` from `data/program.ts` (incl. 70/30 splits)
 *   - `session_imported` events from `storage/migrate.ts` for retroactive XP
 *   - tuning constants from `core/balance.ts`
 */

import type { BodyPart } from '../data/program.ts';

/** XP pool of one body part. */
export interface PartProgress {
  xp: number;
  level: number;
}

export type PartsProgress = Record<BodyPart, PartProgress>;

export interface StreakState {
  /** Permanent stacking tier; +10% all stats per tier. */
  tier: number;
  /** ISO date (Sunday) of the last week that was evaluated. */
  lastWeekStart: string | null;
}

export interface CharacterState {
  parts: PartsProgress;
  streak: StreakState;
  /** Headline level, derived from the part levels. */
  level: number;
}

// TODO(phase 1): xpForLevel(n), levelForXp(xp), volumeOf(set, exercise),
// volumeFactor(volume, previousBest), xpForSet(...), applyWorkoutCompletion(...),
// evaluateStreak(sessionDates, week), grantRetroactiveXp(events).
export {};
