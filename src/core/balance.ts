/**
 * balance.ts — SINGLE source of tuning constants for the game layer.
 *
 * Phase 0 placeholder: only the values Phase 0 already implies are here.
 * Phases 1–3 add XP/combat/economy numbers. Rule for later phases: no magic
 * numbers anywhere else in `core/` — everything tunable lives in this file.
 */

export const BALANCE = {
  xp: {
    /** Base XP for completing one set. */
    baseSetXp: 10,
    /** volumeFactor = clamp(volume / previousBest, min, max). */
    volumeFactorMin: 0.5,
    volumeFactorMax: 1.5,
    /** New personal record multiplier. */
    prMultiplier: 2,
    /** Flat bonus to EVERY body part for finishing a whole day's workout. */
    workoutCompletionBonus: 50,
    /** xpForLevel(n) = levelBase * levelGrowth^(n-1). */
    levelBase: 100,
    levelGrowth: 1.35,
  },
  streak: {
    /** Distinct workout days within a Sun–Sat week needed for a "perfect week". */
    daysPerWeek: 3,
    /** Permanent stacking buff per streak tier. */
    buffPerTier: 0.1,
  },
  energy: {
    /** Battle energy granted per completed set. */
    perSet: 10,
    /** Bonus energy for completing a full workout. */
    perWorkout: 50,
  },
  // TODO(phase 2): combat constants — damage variance, crit, attack interval,
  // HP/DEF/regen scaling, wave/boss pacing, coin rewards.
} as const;

export type Balance = typeof BALANCE;
