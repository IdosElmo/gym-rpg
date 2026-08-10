/**
 * balance.ts — SINGLE source of tuning constants for the game layer.
 *
 * Phase 1 filled in the XP/level/streak/energy numbers; Phase 2 owns `combat`
 * and retuned `stats` around it.
 * Rule: no magic numbers anywhere else in `core/` — everything tunable is here.
 *
 * PACING (the numbers below are chosen for this, keep it true when retuning):
 *   one full workout ≈ 207 ⚡ (≈16 sets × 10 + 50 completion) and a wave costs
 *   10 ⚡ → ≈20 waves per workout, inside the brief's 15–25 target.
 *   50 waves per world → a world is ≈2.5 workouts ≈ one training week.
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
   * Stat derivation — each stat is driven by exactly one body part, per the
   * brief's table. Consumed by `core/combat.ts`; shown on the character screen.
   */
  stats: {
    /** chest -> ATK */ atkBase: 10, atkPerLevel: 4,
    /** back -> DEF (mitigation is `defK / (defK + def)`, see combat.defK) */
    defBase: 5, defPerLevel: 4,
    /** legs -> max HP */ hpBase: 100, hpPerLevel: 25,
    /** shoulders -> attack speed (ms between auto attacks) */
    attackIntervalBaseMs: 1500, attackIntervalPerLevelMs: 45, attackIntervalMinMs: 500,
    /** arms -> crit */ critChanceBase: 0.05, critChancePerLevel: 0.015, critChanceMax: 0.6,
    critMultiplierBase: 1.5, critMultiplierPerLevel: 0.05,
    /** core -> hp regen per second in battle */ regenBase: 1, regenPerLevel: 1.2,
  },
  character: {
    /** Body-part level at which the SVG stops growing (keeps it charming). */
    visualMaxLevel: 15,
  },

  /* --------------------------------------------------------------- combat */
  combat: {
    /**
     * FIXED simulation step. `advance()` accumulates real time and runs whole
     * ticks only, so the outcome depends on elapsed time and the seed — never on
     * the frame rate. Do not change it without re-tuning the numbers below.
     */
    tickMs: 50,
    /** `damage = ATK × (1 ± variance)`. */
    damageVariance: 0.1,
    /** Incoming damage is multiplied by `defK / (defK + DEF)` — soft cap, never 0. */
    defK: 60,
    /** How often the Core regen stat is paid out. */
    regenIntervalMs: 1000,
    /** Fraction of max HP healed when a wave is cleared. */
    healOnWaveClear: 0.12,
    /** Knock-out recovery: the wave restarts after this pause, at full HP. */
    recoverMs: 1600,
    /** Breather between a cleared wave and the next spawn (lets the UI breathe). */
    spawnDelayMs: 400,
    /** ⚡ charged per cleared wave. Charged on CLEAR, so a defeat costs nothing. */
    energyPerWave: 10,
    /** Waves in a world; clearing them all opens the world-boss gate (Phase 3). */
    wavesPerWorld: 50,
    /** Every Nth wave is a mini-boss. */
    miniBossEvery: 10,
    /** Consecutive defeats after which the UI nudges the player to go train. */
    defeatsBeforeHint: 3,
    enemy: {
      /** hp = hpBase × hpGrowth^(wave−1) × worldHpMult^(world−1). */
      hpBase: 32, hpGrowth: 1.045,
      atkBase: 6, atkGrowth: 1.03,
      /**
       * A new world RESETS the difficulty to roughly its predecessor's midpoint
       * (4× the first wave, against 8.6× at the last one) — entering a world is
       * a reward, and the ramp inside it is what sends you back to the gym.
       */
      worldHpMult: 4, worldAtkMult: 2.2,
      attackIntervalMs: 1800,
      miniBossHpMult: 2.2, miniBossAtkMult: 1.25, miniBossAttackIntervalMs: 1500,
    },
    coins: {
      /** coins = (base + perWave × (wave−1)) × worldMult^(world−1) × bossMult. */
      base: 5, perWave: 1, worldMult: 1.6, miniBossMult: 4,
    },
    tap: {
      /** Tap damage as a fraction of ATK. */
      damageFactor: 0.22,
      /** Rate cap — taps closer together than this are ignored (anti-macro). */
      minIntervalMs: 160,
      /** Super meter charged per tap (1 = full). */
      superPerTap: 0.06,
      /** Super move damage as a multiple of ATK. */
      superDamageMult: 6,
    },
  },
} as const;

export type Balance = typeof BALANCE;
