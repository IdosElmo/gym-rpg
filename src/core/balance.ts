/**
 * balance.ts — SINGLE source of tuning constants for the game layer.
 *
 * Phase 1 fills in the XP/level/streak/energy numbers and a PROVISIONAL stat
 * derivation (Phase 2 owns the combat side and may retune `stats`).
 * Rule: no magic numbers anywhere else in `core/` — everything tunable is here.
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
    /** Hard cap so the level loop always terminates. */
    maxLevel: 99,
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
  /**
   * PROVISIONAL stat derivation (Phase 1 shows these on the character screen;
   * Phase 2 consumes them in `core/combat.ts` and may retune every number).
   * Each stat is driven by exactly one body part, per the brief's table.
   */
  stats: {
    /** chest -> ATK */ atkBase: 10, atkPerLevel: 4,
    /** back -> DEF */ defBase: 5, defPerLevel: 3,
    /** legs -> max HP */ hpBase: 100, hpPerLevel: 25,
    /** shoulders -> attack speed (ms between auto attacks) */
    attackIntervalBaseMs: 1500, attackIntervalPerLevelMs: 45, attackIntervalMinMs: 500,
    /** arms -> crit */ critChanceBase: 0.05, critChancePerLevel: 0.015, critChanceMax: 0.6,
    critMultiplierBase: 1.5, critMultiplierPerLevel: 0.05,
    /** core -> hp regen per tick */ regenBase: 0.5, regenPerLevel: 0.6,
  },
  character: {
    /** Body-part level at which the SVG stops growing (keeps it charming). */
    visualMaxLevel: 15,
  },
  // TODO(phase 2): combat constants — damage variance, wave/boss pacing, coins.
} as const;

export type Balance = typeof BALANCE;
