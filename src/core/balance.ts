/**
 * balance.ts — SINGLE source of tuning constants for the game layer.
 *
 * Phase 1 filled in the XP/level/streak/energy numbers; Phase 2 owns `combat`
 * and retuned `stats` around it.
 * Rule: no magic numbers anywhere else in `core/` — everything tunable is here.
 *
 * PACING (the numbers below are chosen for this, keep it true when retuning):
 *   one full workout ≈ 225 ⚡ (≈17 sets × 10 + 50 completion) and a wave costs
 *   10 ⚡ → ≈22 waves per workout, inside the brief's 15–25 target.
 *   The FIRST world is 50 waves → ≈2.4 workouts of ENERGY; every later world is
 *   longer (see `WORLDS[].waves`), up to 110 waves ≈ 5.0 workouts for the last.
 *
 * PHASE 3 retune — `enemy.worldHpMult` / `worldAtkMult`.
 *   Phase 2 shipped 4× / 2.2× per world. Simulated against the real engine that
 *   made world 3 unreachable below part level 12 and world 4 unreachable at any
 *   level a real trainee could reach, which would have made the world bosses
 *   decorative. They are now 1.6× / 1.25×, which puts "the LAST wave of world N
 *   is clearable" at part level ≈3 / 5 / 7 / 9 with active tapping — i.e. the
 *   levels a 3×/week trainee reaches after ≈4 / 9 / 19 / 36 workouts. Training,
 *   not grinding, is the pacer; the boss gates in `data/gameContent.ts` are set
 *   to those same levels.
 *
 * PHASE 9 — PER-WORLD WAVE COUNTS, and why the two multipliers did NOT move.
 *   Worlds are no longer 50 waves each: they run 50 / 60 / 70 / 80 / 85 / 90 /
 *   95 / 100 / 110 (the count lives on the `WorldDef`, so it is content). A
 *   longer world on an unchanged per-wave exponential would make its LATE waves
 *   far harder than the old wave 50 at the same world multiplier — world 9 would
 *   have ended 4× above where the curve was ever tuned.
 *
 *   The fix is a STRETCH, not a retune: the wave exponent is measured in
 *   "fiftieths of a world" rather than in waves —
 *
 *     waveStep = (wave − 1) × (wavesFirstWorld − 1) / (waves(world) − 1)
 *
 *   so every world spans exactly the same difficulty RANGE it always did (it
 *   starts at `worldHpMult^(world−1)` × base and ENDS on precisely the value the
 *   old 50-wave curve produced at wave 50 of that world — 0% drift, pinned in
 *   `tests/enemies.test.ts`), just drawn out over more waves. World 1 is
 *   arithmetically untouched (49/49 = 1). The extra waves therefore buy TIME and
 *   ENERGY, never a difficulty spike, which is exactly the pacing the per-world
 *   counts were added for. Coins ride the same `waveStep`, so a world's last
 *   wave still pays what wave 50 used to pay.
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

  /* ------------------------------------------------------------- upgrades */
  /**
   * EQUIPMENT UPGRADES — per-item levels (+1/+2/+3) bought with coins, on top
   * of the three TIERS the shop already sells as separate items.
   *
   * Two curves, both expressed relative to the item itself, so one rule prices
   * and powers all twelve pieces and a new item needs no new numbers:
   *   cost  = `item.cost × costCurve[N]` spent in total to reach +N
   *   bonus = `item.bonus × statCurve[N]` once it is there
   *
   * PACING. A full +3 costs 2× the item's price and pays 1.8× its bonus, so the
   * two ways to spend a purse stay comparable per coin — buying the next TIER is
   * one big jump (≈2.5–3× the bonus for ≈4× the price), upgrading is the same
   * value in affordable steps, on gear you already own and already like. A +3
   * tier‑1 piece therefore lands between tier 1 and tier 2 at a price between
   * them too (`tests/upgrades.test.ts` pins that relationship), which keeps the
   * early game moving without making the tier ladder pointless — and, because
   * the curve is relative, a +3 tier‑3 piece is a genuine endgame coin sink.
   */
  upgrades: {
    /** Highest upgrade level any item can reach. */
    maxLevel: 3,
    /**
     * CUMULATIVE share of the item's base price to REACH +N (index = N), so one
     * step costs `cost × (costCurve[N] − costCurve[N−1])` = 60% · 60% · 80%.
     */
    costCurve: [0, 0.6, 1.2, 2] as readonly number[],
    /** Multiplier on the item's OWN bonus at +N (index = N). */
    statCurve: [1, 1.25, 1.5, 1.8] as readonly number[],
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
    /**
     * Waves in the FIRST world, and the yardstick the wave curve is drawn on.
     *
     * Every world carries its OWN count (`WorldDef.waves`, see
     * `data/gameContent.ts`) — clearing them all opens that world's boss gate.
     * This number stays the reference length: a world of `n` waves compresses the
     * same `wavesFirstWorld`-long curve into `n` steps (see the PHASE 9 note at
     * the top of this file), which is why growing a world never makes its late
     * waves harder than they were tuned to be.
     */
    wavesFirstWorld: 50,
    /** Every Nth wave is a mini-boss. */
    miniBossEvery: 10,
    /** Consecutive defeats after which the UI nudges the player to go train. */
    defeatsBeforeHint: 3,
    enemy: {
      /** hp = hpBase × hpGrowth^(wave−1) × worldHpMult^(world−1). */
      hpBase: 32, hpGrowth: 1.045,
      atkBase: 6, atkGrowth: 1.03,
      /**
       * A new world RESETS the difficulty far below its predecessor's last wave
       * (1.6× the first wave, against 9× at the last one) — entering a world is
       * a reward, and the 9× ramp inside it is what sends you back to the gym.
       * See the PHASE 3 retune note at the top of this file.
       */
      worldHpMult: 1.6, worldAtkMult: 1.25,
      /**
       * THE LATE-WORLD TAPER — and why the 1.6× step could not simply continue.
       *
       * `worldHpMult^(world−1)` compounds: over nine worlds a flat 1.6 would be
       * 43× at the last one. The PLAYER does not grow 43×. Their gate levels are
       * deliberately compressed in the late game (an all-six level-13 gate costs
       * ~180 workouts on the 1.35 XP curve — see `data/gameContent.ts`), so from
       * world 4's gate to world 9's a fully-geared character gains roughly 3×
       * damage and 3.5× survivability, not ten times that.
       *
       * So the step TAPERS: worlds 1–4 keep the shipped 1.6× / 1.25× exactly —
       * nothing about the existing campaign moves — and every world from
       * `lateWorldFrom` on multiplies by the gentler pair below, which is a
       * little steeper than the player's own curve. The result, pinned by the
       * simulations in `tests/enemies.test.ts` and `tests/boss.test.ts`: with
       * era-appropriate gear a late world's last waves still run ≈12–25 s and
       * its boss ≈30–75 s, exactly like world 4's always did.
       */
      lateWorldFrom: 5,
      lateWorldHpMult: 1.45, lateWorldAtkMult: 1.18,
      attackIntervalMs: 1800,
      miniBossHpMult: 2.2, miniBossAtkMult: 1.25, miniBossAttackIntervalMs: 1500,
      /**
       * FLAVOUR CEILINGS for the five per-world combat mechanics an `EnemyDef`
       * may opt into (`def` / `attackSlowMult` / `dodgeChance` / `regenPct` /
       * `critChance`). None of them is ON by default: every rule in
       * `core/combat.ts` is skipped when its field is absent or zero, which is
       * what keeps worlds 1–4 — and every seed ever recorded in them — moving
       * through the identical RNG stream. `tests/enemies.test.ts` pins the caps.
       */
      flavour: {
        /** מעמקי הים — flat DEF on the soft-cap curve (`mitigation`). */
        maxDef: 34,
        /** ממלכת הקרח — multiplier on the PLAYER's attack interval. No RNG. */
        maxAttackSlowMult: 1.3,
        /** ממלכת הצללים — chance a non-critical blow is dodged outright. */
        maxDodgeChance: 0.24,
        /** גן עדן — fraction of MAX HP the enemy heals per second. */
        maxRegenPct: 0.03,
        /** גיהינום — the enemy's own crit. */
        maxCritChance: 0.22, maxCritMultiplier: 1.9,
      },
    },
    /**
     * World bosses. These sit on top of the wave scaling at the wave AFTER the
     * world's last one, multiplied by the boss's own `hpMult`/`atkMult` from
     * `data/gameContent.ts`. A boss is a SPONGE with heavy, slow hits: the fight
     * lasts ≈40–90 s of active play for a character that just meets the gate.
     */
    boss: {
      /** ⚡ charged when the boss falls (≈3 ordinary waves). */
      energyCost: 30,
      /**
       * coins = coinsBase × the world's coin factor — a real payday. The factor
       * tapers from `coinsLateWorldMult` on, for the same reason the wave purse
       * does: a flat 1.7× compounded over nine worlds would hand 28,000 🪙 for a
       * single kill, which is the entire wardrobe twice over.
       */
      coinsBase: 400, coinsWorldMult: 1.7, coinsLateWorldMult: 1.35,
      /** Bosses swing slowly and hard. */
      attackIntervalMs: 2400,
    },
    coins: {
      /**
       * coins = (base + perWave × waveStep) × worldFactor × bossMult, where
       * `waveStep` is the STRETCHED wave index — so a world's last wave always
       * pays what wave 50 used to pay, however many waves it took to get there.
       *
       * The world factor tapers exactly like the difficulty does (worlds 1–4
       * keep 1.6×, later worlds step by `lateWorldMult`), because a purse that
       * kept compounding at 1.6× would pay ~2,300 🪙 for a single world-9 wave —
       * a quarter of the whole shop, per wave. As tapered, the nine worlds pay
       * ≈130,000 🪙 against ≈25,500 🪙 of sinks (three tiers × four slots, each
       * taken to +3), which is deliberately generous: the late worlds are meant
       * to be fought in fully upgraded tier-3 gear, and there is room left for
       * the slots the wardrobe is about to grow.
       */
      base: 5, perWave: 1, worldMult: 1.6, lateWorldMult: 1.25, miniBossMult: 4,
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

  /* ----------------------------------------------------- daily challenge */
  /**
   * DAILY CHALLENGE — one seeded gauntlet per calendar date, the same one for
   * every account on that date (the seed is a hash of the date string alone).
   *
   * It is a SKILL/STATS TEST, not progression: the waves are drawn from all four
   * worlds regardless of where the player actually is, and they scale on the
   * curve below — which is deliberately independent of `combat.enemy`, so
   * retuning the campaign can never quietly retune the challenge (and the other
   * way round).
   *
   * PACING (pinned by `tests/daily.test.ts`, measured with the same skill pilot
   * the Phase-4 balance tests use and NO tapping — i.e. the conservative floor):
   *   part level 5–6  → 5–8 waves,   part level 9+ → all ten.
   * The run is ONE life: there is no retry, the only healing between waves is
   * `healOnWaveClear` plus the Core regen, so surviving is half the test.
   *
   * ECONOMY. The entry fee is `entryEnergy` ⚡ — three ordinary waves' worth,
   * charged ONCE per attempt (never per wave), so a training day still gates the
   * challenge exactly like everything else in the game. A full clear pays
   * `coins.base…` per wave plus `coins.completionBonus`, which is roughly what
   * the same 30 ⚡ buys a late-world player in ordinary waves — generous early,
   * fair later, and capped at one attempt a day either way.
   */
  daily: {
    /** Waves in one gauntlet. The LAST one is the finale mini-boss. */
    waves: 10,
    /** ⚡ charged once per attempt, when the run is recorded. */
    entryEnergy: 30,
    /** The gauntlet's own curve: `hp = hpBase × hpGrowth^(wave−1)`, etc. */
    enemy: {
      hpBase: 130, hpGrowth: 1.34,
      atkBase: 9, atkGrowth: 1.24,
      attackIntervalMs: 1700,
      /** The wave-10 finale, on top of the curve. */
      miniBossHpMult: 1.5, miniBossAtkMult: 1.05, miniBossAttackIntervalMs: 1500,
    },
    /** Fraction of max HP healed when a gauntlet wave is cleared. */
    healOnWaveClear: 0.18,
    /** Breather between two gauntlet waves. */
    spawnDelayMs: 400,
    /** coins = base + perWave × (wave−1); the bonus is paid for a full clear. */
    coins: { base: 20, perWave: 5, completionBonus: 250 },
  },

  /* ------------------------------------------------------------ ghost duel */
  /**
   * GHOST DUEL — one fight against another account's character (`core/ghost.ts`).
   *
   * ECONOMY, in one line: it costs ⚡, a win pays `winCoins` and even a loss pays
   * `lossCoins` — showing up is worth something, winning is worth much more.
   *
   * WHY THIS IS NOT A FAUCET. The bound is not the price, it is the LEDGER: one
   * counted duel per (date, opponent), enforced by the reducer's idempotency key
   * and not by the UI. Two accounts in one household can therefore trade at most
   * one duel a day, for 20 ⚡ each — energy that only real training produces —
   * so the ceiling on "farming" is one `winCoins` per day per person you know,
   * which is deliberately less than a single daily-challenge run pays:
   *
   *   perfect daily gauntlet   675 🪙 for 30 ⚡   (22.5 🪙 per ⚡)
   *   duel won                 150 🪙 for 20 ⚡   ( 7.5 🪙 per ⚡)
   *   duel lost                 30 🪙 for 20 ⚡   ( 1.5 🪙 per ⚡)
   *
   * The reducer additionally CLAMPS whatever a `ghost_duel` event claims to
   * `max(winCoins, lossCoins)`, so a crafted or replayed event cannot overpay
   * however it was written — the payload is authoritative about the RESULT, the
   * balance is authoritative about the CEILING.
   *
   * DIFFICULTY is not tuned here at all, and that is the point: the opponent's
   * numbers come from `deriveStats` over ITS OWN levels, streak and gear, the
   * same function the player's numbers come from. A duel is therefore a straight
   * comparison of two training histories, with the live player's skills, taps
   * and super move as the handicap that makes an uphill fight winnable.
   *
   * The two clamps below are SECURITY, not balance: a ghost row is written by
   * another client and can say anything, so `core/ghost.ts` folds it into these
   * bounds before a single number is derived from it.
   */
  duel: {
    /** ⚡ charged once per duel, when the result is recorded. */
    entryEnergy: 20,
    /** Coins for putting the opponent's ghost down. */
    winCoins: 150,
    /** Coins for turning up and losing (a forfeit is a loss — see `core/xp.ts`). */
    lossCoins: 30,
    /** Breather before the opponent walks on (the arena's own beat). */
    spawnDelayMs: 400,
    /** Hard ceiling on a FETCHED streak tier (≈4 years of perfect weeks). */
    maxStreakTier: 200,
  },

  /* --------------------------------------------------------------- skills */
  /**
   * BODY-PART SKILLS — six active abilities, one per body part, unlocked by
   * that part's LEVEL and scaled by it forever after.
   *
   * Nothing here is persisted: a skill is unlocked because the part is at
   * `unlockLevel`, which is derived from the event log like every other level,
   * and an activation is within-battle tactics (like a tap), so no event is
   * written. Cooldowns and buff windows live in `BattleState` in ms.
   *
   * POWER. Every magnitude below is multiplied by
   *   `power = 1 + min(powerMaxBonus, powerPerLevel × (partLevel − unlockLevel))`
   * so the skill keeps getting better as the player keeps training — gently,
   * and with a ceiling, so a skill can never eclipse the stats it rides on.
   * Cooldowns deliberately do NOT scale: the rhythm of the fight stays readable.
   *
   * PACING. At part level 5–6 firing all six on cooldown clears waves ≈25–35%
   * faster than pure idling (pinned by the simulation tests in tests/skills.*),
   * which is meaningful without making the idle loop pointless.
   */
  skills: {
    /** Part level at which that part's skill unlocks. */
    unlockLevel: 5,
    /** Power gained per part level above the unlock. */
    powerPerLevel: 0.03,
    /** Ceiling of that bonus (+60% ⇒ reached at part level 25). */
    powerMaxBonus: 0.6,

    /** חזה — מכת מחץ: one heavy blow. */
    smash: { cooldownMs: 20_000, atkMult: 4 },
    /** גב — עמידת ברזל: a window where incoming damage is cut hard. */
    guard: {
      cooldownMs: 30_000,
      durationMs: 6000,
      /** Incoming damage multiplier at power 1 (on TOP of DEF mitigation). */
      damageTaken: 0.45,
      /** Floor, so a fully trained back is never immune. */
      minDamageTaken: 0.2,
    },
    /** רגליים — רעידת אדמה: damage plus a short stun (the enemy's swing is pushed back). */
    quake: { cooldownMs: 25_000, atkMult: 1.2, stunMs: 1500 },
    /** כתפיים — סערת מהלומות: the attack interval is halved for a few seconds. */
    flurry: { cooldownMs: 30_000, durationMs: 5000, intervalFactor: 0.5 },
    /** ידיים — מכה מדויקת: the next AUTO attack is a guaranteed, bigger crit. */
    focus: { cooldownMs: 15_000, critMultiplierBonus: 0.5 },
    /** ליבה — נשימה עמוקה: instant heal + a short regen burst. */
    breath: { cooldownMs: 35_000, healPct: 0.25, durationMs: 4000, regenMult: 5 },
  },
} as const;

export type Balance = typeof BALANCE;
