/**
 * core/daily.ts — THE DAILY CHALLENGE: one seeded gauntlet per calendar date.
 *
 * PURE, like every other module in `core/`: no DOM, no storage, and above all no
 * `Date.now()` — the date is always a parameter (`'2025-05-04'`), because that is
 * what makes the gauntlet a value rather than an accident of when it was asked
 * for.
 *
 * SAME DAY, SAME GAUNTLET
 * -----------------------
 * The seed is `FNV-1a('daily|<date>')` — a hash of the date STRING and nothing
 * else. It does not read the player's world, level, progress or device, so two
 * accounts that open the app on the same calendar day face byte-identical waves,
 * and tomorrow's are already computable today. Everything downstream (which
 * enemy shows up in which wave, and every damage roll of the fight, via
 * `waveSeed(seed, …)` in `core/combat.ts`) derives from that one number.
 *
 * NOT PROGRESSION
 * ---------------
 * The waves are drawn from ALL FOUR worlds regardless of where the player
 * actually is — worlds escalate across the ten waves and the finale is a
 * mini-boss — and they scale on `BALANCE.daily`, a curve of its own. So the
 * challenge measures the character's stats and the player's hands, never how far
 * the campaign got; and retuning the campaign cannot silently retune it.
 *
 * ONE ATTEMPT A DAY
 * -----------------
 * There is no personal best per date, because there is only ever one run: entry
 * costs `BALANCE.daily.entryEnergy` ⚡ and the date itself is the idempotency key
 * of the `daily_challenge` event (see `core/xp.ts`). This module owns the
 * gauntlet; the reducer owns the "one attempt" rule.
 */

import { BALANCE } from './balance.ts';
import { hashSeed, makeRng, nextFloat, type GauntletWave } from './combat.ts';
import {
  WORLD_COUNT,
  miniBossOf,
  regularEnemies,
  type EnemyDef,
} from '../data/gameContent.ts';

/** FNV-1a over a string — the same mixer the rest of the game uses, on text. */
export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ (text.charCodeAt(i) & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ ((text.charCodeAt(i) >>> 8) & 0xff), 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * THE seed of a date's gauntlet. A pure function of the date string, so it is
 * the same number on every device, in every timezone, for ever.
 */
export function dailySeed(date: string): number {
  return hashSeed(hashString(`daily|${date}`));
}

/**
 * The world wave `index` (1-based) visits.
 *
 * The ten waves walk from world 1 to world 4 — a tour, not a ladder: a player
 * who has never left the abandoned gym still meets Olympus at the end, which is
 * the whole point of a challenge that ignores progression.
 */
export function dailyWorldOf(index: number, waves: number = BALANCE.daily.waves): number {
  const i = Math.min(Math.max(1, Math.floor(index)), waves);
  return Math.min(WORLD_COUNT, Math.max(1, Math.ceil((i * WORLD_COUNT) / waves)));
}

/** Coins one gauntlet wave pays. */
export function dailyWaveCoins(index: number): number {
  const c = BALANCE.daily.coins;
  return Math.round(c.base + c.perWave * Math.max(0, Math.floor(index) - 1));
}

export interface DailyChallenge {
  date: string;
  seed: number;
  waves: readonly GauntletWave[];
  /** ⚡ the attempt costs (charged once, when the run is recorded). */
  energyCost: number;
  /** Coins for clearing every wave, on top of the per-wave payouts. */
  completionBonus: number;
  /** Every wave's coins + the bonus — the maximum a perfect run can pay. */
  maxCoins: number;
  healOnWaveClear: number;
  spawnDelayMs: number;
}

/**
 * Build the whole gauntlet of a date.
 *
 * Deterministic in every detail: the enemy of each wave is drawn from that
 * wave's world roster with a seeded stream (`hashSeed(seed, index)`, one draw
 * per wave, so adding a wave later cannot shift the enemies of the ones before
 * it), and the numbers come from `BALANCE.daily` alone.
 */
export function dailyChallenge(date: string): DailyChallenge {
  const B = BALANCE.daily;
  const e = B.enemy;
  const seed = dailySeed(date);
  const waves: GauntletWave[] = [];

  for (let index = 1; index <= B.waves; index += 1) {
    const world = dailyWorldOf(index, B.waves);
    const miniBoss = index === B.waves;
    const enemy = miniBoss ? miniBossOf(world) : pickEnemy(world, seed, index);
    const step = index - 1;

    const hp =
      e.hpBase * Math.pow(e.hpGrowth, step) * (miniBoss ? e.miniBossHpMult : 1) * (enemy.hpMult ?? 1);
    const atk =
      e.atkBase * Math.pow(e.atkGrowth, step) * (miniBoss ? e.miniBossAtkMult : 1) * (enemy.atkMult ?? 1);

    waves.push({
      index,
      world,
      miniBoss,
      enemyId: enemy.id,
      he: enemy.he,
      svg: enemy.svg,
      hp: Math.max(1, Math.round(hp)),
      atk: Math.max(1, Math.round(atk * 10) / 10),
      attackIntervalMs: miniBoss ? e.miniBossAttackIntervalMs : e.attackIntervalMs,
      coins: dailyWaveCoins(index),
    });
  }

  const waveCoins = waves.reduce((sum, w) => sum + w.coins, 0);
  return {
    date,
    seed,
    waves,
    energyCost: B.entryEnergy,
    completionBonus: B.coins.completionBonus,
    maxCoins: waveCoins + B.coins.completionBonus,
    healOnWaveClear: B.healOnWaveClear,
    spawnDelayMs: B.spawnDelayMs,
  };
}

/** One seeded draw from a world's regular roster. */
function pickEnemy(world: number, seed: number, index: number): EnemyDef {
  const roster = regularEnemies(world);
  const rng = makeRng(hashSeed(seed, index));
  const i = Math.min(roster.length - 1, Math.floor(nextFloat(rng) * roster.length));
  return roster[i] as EnemyDef;
}

/**
 * The shape `createChallengeBattle` wants — the gauntlet as a battle context.
 * Kept here so the UI (and the tests) never assemble it by hand.
 */
export function dailyRun(date: string): {
  kind: 'daily';
  date: string;
  seed: number;
  waves: readonly GauntletWave[];
  energyCost: number;
  completionBonus: number;
  healOnWaveClear: number;
  spawnDelayMs: number;
} {
  const g = dailyChallenge(date);
  return {
    kind: 'daily',
    date: g.date,
    seed: g.seed,
    waves: g.waves,
    energyCost: g.energyCost,
    completionBonus: g.completionBonus,
    healOnWaveClear: g.healOnWaveClear,
    spawnDelayMs: g.spawnDelayMs,
  };
}

/**
 * "Yesterday" for a YYYY-MM-DD date, in UTC date math (no DST, no clocks).
 * Local dates are compared as STRINGS everywhere in this app, so shifting one by
 * a day is pure text arithmetic.
 */
function shiftDate(date: string, days: number): string {
  const ts = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ts)) return date;
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The current daily-challenge streak: consecutive calendar days ATTEMPTED,
 * counted back from today.
 *
 * DERIVED, never folded — exactly like body-part levels and the weekly streak.
 * It is a pure function of the SET of attempted dates, so two devices that merge
 * their logs always agree on it, whatever order the events arrived in. Today
 * does not have to be one of them: a streak stays alive until a whole day is
 * missed, so it is counted from today when today was played and from yesterday
 * otherwise.
 */
export function dailyStreak(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : shiftDate(today, -1);
  let streak = 0;
  // 3650 = ten years; a corrupt date can never turn this into an endless loop.
  while (set.has(cursor) && streak < 3650) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive attempted days ever — same derivation rule. */
export function bestDailyStreak(dates: readonly string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous !== null && shiftDate(previous, 1) === date ? run + 1 : 1;
    previous = date;
    if (run > best) best = run;
  }
  return best;
}
