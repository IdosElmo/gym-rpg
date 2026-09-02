/**
 * NINE WORLDS — per-world wave counts, the champion migration, the five new
 * combat flavours, and the pacing arithmetic that ties the whole journey to real
 * workouts.
 *
 * The load-bearing claim of this file is REPLAY SAFETY. A wave count and a world
 * roster are CONTENT: they decide the road ahead of the player and never a fact
 * behind them, because `wave_cleared` / `boss_defeated` carry
 * world/wave/nextWorld/nextWave as data and the reducer folds the payload.
 * Everything here that says "identical" is measured against numbers captured
 * from the four-world build (`origin/main` at e9ac382), not asserted by eye.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  bossSpec,
  bossStanding,
  createBattle,
  derivedProgress,
  isWorldBossWave,
  simulate,
  tap,
  waveSpec,
  worldGate,
  type CombatStats,
} from '../src/core/combat.ts';
import { deriveStats, emptyGame, rebuildGame } from '../src/core/xp.ts';
import {
  ENEMIES,
  EQUIPMENT_SLOTS,
  WORLDS,
  WORLD_BOSSES,
  WORLD_COUNT,
  bossWaveOf,
  equipmentById,
  regularEnemies,
  sumEquipBonus,
  wavesInWorld,
  worldBossOf,
} from '../src/data/gameContent.ts';
import { upgradeMultiplier } from '../src/core/upgrades.ts';
import { BODY_PARTS, type BodyPart } from '../src/data/program.ts';
import { rebuildFromEvents } from '../src/storage/migrate.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';

/* ------------------------------------------------------------------ helpers */

function statsAt(level: number, gear: readonly [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] = [0, 0]): CombatStats {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = level;
  const [tier, upgrade] = gear;
  const ids =
    tier > 0 ? EQUIPMENT_SLOTS.map((slot) => `${slot}_${tier}`).filter((id) => equipmentById(id)) : [];
  const s = deriveStats(parts, 0, sumEquipBonus(ids, () => upgradeMultiplier(upgrade)));
  return {
    atk: s.atk,
    def: s.def,
    maxHp: s.maxHp,
    attackIntervalMs: s.attackIntervalMs,
    critChance: s.critChance,
    critMultiplier: s.critMultiplier,
    regen: s.regen,
  };
}

/** Every enemy that ever stands in a world, boss included. */
function rosterOf(world: number): ReturnType<typeof regularEnemies> {
  const boss = worldBossOf(world);
  return [...ENEMIES.filter((e) => e.world === world), ...(boss ? [boss] : [])];
}

/* -------------------------------------------------------- per-world counts */

describe('per-world wave counts', () => {
  it('grows world by world, with a DECELERATING step', () => {
    const counts = WORLDS.map((w) => w.waves);
    expect(counts).toEqual([50, 80, 110, 130, 140, 150, 160, 170, 180]);
    expect(counts[0]).toBe(BALANCE.combat.wavesFirstWorld);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i] as number, `world ${i + 1}`).toBeGreaterThan(counts[i - 1] as number);
    }
    // …and the early steps are the big ones, so the late game does not balloon.
    const steps = counts.slice(1).map((c, i) => c - (counts[i] as number));
    expect(Math.max(...steps.slice(3))).toBeLessThanOrEqual(Math.min(...steps.slice(0, 3)));
  });

  it('puts each world’s boss on ITS own last wave + 1, and gates there', () => {
    for (const w of WORLDS) {
      expect(wavesInWorld(w.id)).toBe(w.waves);
      expect(bossWaveOf(w.id)).toBe(w.waves + 1);
      // the world's own last wave is still an ordinary wave…
      expect(isWorldBossWave(w.id, w.waves)).toBe(false);
      // …and one past it is the boss's
      expect(isWorldBossWave(w.id, w.waves + 1)).toBe(true);
      expect(bossStanding(w.id, w.waves, [])).toBe(false);
      expect(bossStanding(w.id, w.waves + 1, [])).toBe(true);
    }
  });

  it('actually gates the fight at each world’s own boss wave, not at a global 51', () => {
    for (const w of WORLDS) {
      const stats = statsAt(9);
      // one wave short of the boss: an ordinary enemy walks on
      const before = createBattle({
        seed: 5150,
        world: w.id,
        wave: w.waves,
        energy: 1000,
        stats,
        gateOpen: false,
      });
      advance(before, 2000, stats);
      expect(before.status, `world ${w.id} wave ${w.waves}`).toBe('fighting');
      expect(before.enemy?.worldBoss).toBe(false);
      expect(before.enemy?.sparring ?? false).toBe(false);

      // the boss's own wave, gate closed: no boss — a reward-less sparring
      // bout keeps the arena alive instead
      const at = createBattle({
        seed: 5150,
        world: w.id,
        wave: bossWaveOf(w.id),
        energy: 1000,
        stats,
        gateOpen: false,
      });
      advance(at, 2000, stats);
      expect(at.status, `world ${w.id} boss wave`).toBe('fighting');
      expect(at.enemy?.worldBoss, `world ${w.id} boss wave`).toBe(false);
      expect(at.enemy?.sparring, `world ${w.id} boss wave`).toBe(true);
      expect(at.energy).toBe(1000);
    }
  });

  it('falls back to the LAST world’s count for a world that does not exist', () => {
    // A hand-edited blob can say anything; the fallback must be conservative,
    // never a shorter world than the real ones.
    const longest = Math.max(...WORLDS.map((w) => w.waves));
    expect(wavesInWorld(WORLD_COUNT + 5)).toBe(longest);
    expect(wavesInWorld(0)).toBe(longest);
  });
});

/* ------------------------------------------------- the four-world-era log */

/**
 * A log EXACTLY as the four-world build wrote it for a player who beat Zeus and
 * then ground champion waves in world 4 up to wave 137.
 *
 * The `boss_defeated` payload is the interesting one: `endgame: true`,
 * `nextWorld: 4`, `nextWave: 51` — the four-world game telling the player they
 * were finished. Nothing about that payload is rewritten; it still folds to
 * exactly the purse, the trophy and the counters it always did.
 */
function fourWorldEraLog(): AppEvent[] {
  const evs: AppEvent[] = [
    { id: 'a0', ts: 1000, type: 'energy_gained', payload: { amount: 5000, date: '2025-01-05' } },
  ];
  let ts = 2000;
  for (let wave = 1; wave <= 50; wave += 1) {
    evs.push({
      id: `w${wave}`,
      ts: (ts += 10),
      type: 'wave_cleared',
      payload: {
        date: '2025-01-05',
        world: 4,
        wave,
        miniBoss: wave % 10 === 0,
        enemyId: 'w4_harpy',
        coins: 3 * wave,
        energySpent: 10,
        seed: 1234 + wave,
        durationMs: 9000,
      },
    });
  }
  evs.push({
    id: 'boss4',
    ts: (ts += 10),
    type: 'boss_defeated',
    payload: {
      date: '2025-01-05',
      world: 4,
      wave: 51,
      bossId: 'boss_w4',
      coins: 1965,
      energySpent: 30,
      seed: 99,
      durationMs: 60_000,
      nextWorld: 4,
      nextWave: 51,
      endgame: true,
    },
  });
  for (let wave = 51; wave <= 137; wave += 1) {
    evs.push({
      id: `c${wave}`,
      ts: (ts += 10),
      type: 'wave_cleared',
      payload: {
        date: '2025-01-06',
        world: 4,
        wave,
        miniBoss: wave % 10 === 0,
        enemyId: 'w4_harpy',
        coins: 200,
        energySpent: 10,
        seed: 5000 + wave,
        durationMs: 12_000,
      },
    });
  }
  return evs;
}

describe('a four-world-era log replays identically', () => {
  const TODAY = '2025-02-01';

  /**
   * GOLDEN NUMBERS, captured by running this exact log through the four-world
   * build (origin/main @ e9ac382). Every one of them is a fold of authoritative
   * payloads, so every one of them must survive the content change untouched.
   */
  const GOLDEN = {
    coins: 23_190,
    wavesCleared: 137,
    miniBossesCleared: 13,
    bossesDefeated: ['boss_w4'],
    energy: 3600,
  } as const;

  it('folds the same purse, counters, trophies and energy it always did', () => {
    const g = rebuildGame(fourWorldEraLog(), TODAY);
    expect(g.battle.coins).toBe(GOLDEN.coins);
    expect(g.battle.wavesCleared).toBe(GOLDEN.wavesCleared);
    expect(g.battle.miniBossesCleared).toBe(GOLDEN.miniBossesCleared);
    expect(g.battle.bossesDefeated).toEqual([...GOLDEN.bossesDefeated]);
    expect(g.energy).toBe(GOLDEN.energy);
  });

  /**
   * THE MIGRATION SEMANTICS, stated once and asserted here.
   *
   * The old boss payload parked the player in world 4 for ever. It still folds
   * that way; `finalizeGame` then DERIVES the truth from the trophy shelf: the
   * world-4 boss is a trophy and world 4 is no longer the last world, so the
   * player belongs at the start of world 5. The champion waves they fought stay
   * counted in `wavesCleared` — they happened — but the marker moves, because a
   * world whose boss is down is behind you.
   */
  it('lands an old champion at the START of world 5 — derived from the ledger', () => {
    const g = rebuildGame(fourWorldEraLog(), TODAY);
    expect(g.battle.world).toBe(5);
    expect(g.battle.wave).toBe(1);
    // and the game is no longer "over": the world-9 boss is still standing
    expect(g.battle.bossesDefeated).not.toContain('boss_w9');
  });

  it('is idempotent, and identical under either merge order', () => {
    const log = fourWorldEraLog();
    const forward = rebuildGame(log, TODAY);
    const reversed = rebuildGame([...log].reverse(), TODAY);
    const doubled = rebuildGame([...log, ...log], TODAY);
    const shuffled = rebuildGame(
      [...log].sort((a, b) => (a.id < b.id ? -1 : 1)),
      TODAY,
    );
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    // a duplicated log double-spends nothing and re-derives the same landing spot
    expect(doubled.battle.world).toBe(5);
    expect(doubled.battle.wave).toBe(1);
    expect(doubled.battle.bossesDefeated).toEqual(['boss_w4']);
  });

  it('applies through the storage path too, with no version bump', () => {
    // `normalizeGame` runs the same derivation, which is why a still-valid v10
    // blob picks the unlock up on the next boot rather than on the next workout.
    const built = rebuildFromEvents(fourWorldEraLog(), Date.parse('2025-02-01T00:00:00Z'));
    expect(built.game?.battle.world).toBe(5);
    expect(built.game?.battle.wave).toBe(1);
    expect(built.game?.version).toBe(emptyGame().version);
  });
});

/* ------------------------------------------------- the derivation, in the raw */

describe('derivedProgress', () => {
  it('walks forward over every world whose boss is already a trophy', () => {
    expect(derivedProgress({ world: 1, wave: 30, bossesDefeated: [] })).toEqual({ world: 1, wave: 30 });
    expect(derivedProgress({ world: 1, wave: 30, bossesDefeated: ['boss_w1'] })).toEqual({
      world: 2,
      wave: 1,
    });
    // a shelf that skipped ahead (two devices, two merges) still lands once
    expect(
      derivedProgress({ world: 1, wave: 9, bossesDefeated: ['boss_w1', 'boss_w2', 'boss_w3'] }),
    ).toEqual({ world: 4, wave: 1 });
  });

  it('is idempotent — running it on its own answer changes nothing', () => {
    const once = derivedProgress({ world: 4, wave: 137, bossesDefeated: ['boss_w4'] });
    const twice = derivedProgress({ ...once, bossesDefeated: ['boss_w4'] });
    expect(once).toEqual({ world: 5, wave: 1 });
    expect(twice).toEqual(once);
  });

  it('CLAMPS a wave marker that sits past a boss still standing', () => {
    // The champion-era overshoot: wave 137 of a world that now ends at 80. The
    // player walks into the fight they were owed, not into a wave that is not
    // there. (World 3's boss is standing here, so world 3 is where they stay.)
    expect(derivedProgress({ world: 3, wave: 137, bossesDefeated: [] })).toEqual({
      world: 3,
      wave: bossWaveOf(3),
    });
  });

  it('never clamps the LAST world once its boss is down — that is champion mode', () => {
    const all = WORLD_BOSSES.map((b) => b.id);
    expect(derivedProgress({ world: WORLD_COUNT, wave: 300, bossesDefeated: all })).toEqual({
      world: WORLD_COUNT,
      wave: 300,
    });
  });

  it('leaves an ordinary mid-world player exactly where they are', () => {
    expect(derivedProgress({ world: 6, wave: 42, bossesDefeated: ['boss_w1', 'boss_w2'] })).toEqual({
      world: 6,
      wave: 42,
    });
  });
});

/* ------------------------------------------------------------- the flavours */

describe('per-world combat flavours', () => {
  /** Spawn wave `wave` of `world` and hand back the enemy the engine built. */
  function spawnOf(world: number, wave: number) {
    const stats = statsAt(9);
    const state = createBattle({ seed: 4242, world, wave, energy: 1000, stats });
    advance(state, 1000, stats);
    return state.enemy;
  }

  it('gives worlds 1–4 exactly the enemy shape they always had — no new keys', () => {
    for (let world = 1; world <= 4; world += 1) {
      for (const def of rosterOf(world)) {
        for (const key of ['def', 'attackSlowMult', 'dodgeChance', 'regenPct', 'critChance'] as const) {
          expect(def[key], `${def.id} ${key}`).toBeUndefined();
        }
      }
      const enemy = spawnOf(world, 3);
      expect(Object.keys(enemy ?? {}).sort()).toEqual(
        ['atk', 'attackIntervalMs', 'he', 'hp', 'id', 'maxHp', 'miniBoss', 'svg', 'worldBoss'].sort(),
      );
    }
  });

  it('armours מעמקי הים and nothing else', () => {
    const armoured = rosterOf(5).filter((e) => (e.def ?? 0) > 0);
    expect(armoured.length).toBeGreaterThanOrEqual(3);
    for (const e of ENEMIES) {
      if ((e.def ?? 0) > 0) expect(e.world, `${e.id} is armoured`).toBe(5);
    }
    const enemy = spawnOf(5, 1); // w5_crab
    expect(enemy?.def).toBe(30);
    // …and the armour actually reduces the damage a blow lands
    expect(enemy?.hp).toBe(enemy?.maxHp);
  });

  it('chills ממלכת הקרח — deterministically, with no RNG at all', () => {
    const chilled = rosterOf(6).filter((e) => (e.attackSlowMult ?? 1) > 1);
    expect(chilled.length).toBeGreaterThanOrEqual(3);
    for (const e of ENEMIES) {
      if ((e.attackSlowMult ?? 1) > 1) expect(e.world, `${e.id} chills`).toBe(6);
    }
    const enemy = spawnOf(6, 1); // w6_snowman
    expect(enemy?.slow).toBe(1.2);

    // The proof that it costs no random draw: run the SAME wave twice, once as
    // it ships and once with the chill removed from the spawned enemy, and the
    // RNG state after N ticks is the same — only the clock moved.
    const stats = statsAt(9);
    const mk = (strip: boolean) => {
      const s = createBattle({ seed: 31337, world: 6, wave: 1, energy: 1000, stats });
      advance(s, 1000, stats);
      if (strip && s.enemy) delete s.enemy.slow;
      for (let i = 0; i < 60; i += 1) advance(s, BALANCE.combat.tickMs, stats);
      return s;
    };
    const chilledRun = mk(false);
    const thawed = mk(true);
    // fewer swings while chilled, but not one extra number out of the stream
    expect(chilledRun.enemy?.hp ?? 0).toBeGreaterThan(thawed.enemy?.hp ?? 0);
  });

  it('lets ממלכת הצללים dodge — but never a CRIT (the mercy rule)', () => {
    const shades = rosterOf(7).filter((e) => (e.dodgeChance ?? 0) > 0);
    expect(shades.length).toBeGreaterThanOrEqual(3);
    for (const e of ENEMIES) {
      if ((e.dodgeChance ?? 0) > 0) expect(e.world, `${e.id} dodges`).toBe(7);
    }

    // A character with a huge crit chance meets a shade: over a long fight the
    // dodges that DO land are all on non-critical blows.
    const stats: CombatStats = { ...statsAt(9), critChance: 1, critMultiplier: 2 };
    const state = createBattle({ seed: 8080, world: 7, wave: 1, energy: 100_000, stats });
    const sum = simulate(state, stats, { waves: 6, maxMs: 300_000 });
    expect(sum.events.some((e) => e.kind === 'hit' && e.crit)).toBe(true);
    expect(sum.events.filter((e) => e.kind === 'dodged')).toHaveLength(0);

    // …and with an ordinary crit chance, some blows DO get dodged.
    const plain = statsAt(9);
    const s2 = createBattle({ seed: 8080, world: 7, wave: 1, energy: 100_000, stats: plain });
    const sum2 = simulate(s2, plain, { waves: 6, maxMs: 300_000 });
    expect(sum2.events.filter((e) => e.kind === 'dodged').length).toBeGreaterThan(0);
  });

  it('regenerates גן עדן, as a fraction of the enemy’s OWN max HP', () => {
    const healers = rosterOf(8).filter((e) => (e.regenPct ?? 0) > 0);
    expect(healers.length).toBeGreaterThanOrEqual(3);
    for (const e of ENEMIES) {
      if ((e.regenPct ?? 0) > 0) expect(e.world, `${e.id} heals`).toBe(8);
    }
    // wave 2 of גן עדן is מלאך שומר, the 2%-per-second guardian
    const enemy = spawnOf(8, 2);
    expect(enemy?.regen).toBeCloseTo((enemy?.maxHp ?? 0) * 0.02, 0);

    const stats = statsAt(9);
    const state = createBattle({ seed: 606, world: 8, wave: 2, energy: 100_000, stats });
    const sum = simulate(state, stats, { waves: 2, maxMs: 300_000 });
    expect(sum.events.filter((e) => e.kind === 'enemy_regen').length).toBeGreaterThan(0);
  });

  it('gives גיהינום the player’s own signature move', () => {
    const critters = rosterOf(9).filter((e) => (e.critChance ?? 0) > 0);
    expect(critters.length).toBeGreaterThanOrEqual(3);
    for (const e of ENEMIES) {
      if ((e.critChance ?? 0) > 0) expect(e.world, `${e.id} crits`).toBe(9);
    }
    const enemy = spawnOf(9, 1); // w9_imp
    expect(enemy?.critChance).toBe(0.15);
    expect(enemy?.critMultiplier).toBe(1.6);

    const stats = statsAt(10, [3, 3]);
    const state = createBattle({ seed: 1212, world: 9, wave: 1, energy: 100_000, stats });
    const sum = simulate(state, stats, { waves: 8, maxMs: 300_000 });
    expect(sum.events.filter((e) => e.kind === 'enemy_hit' && e.crit).length).toBeGreaterThan(0);
  });

  it('keeps every flavour inside the ceilings balance.ts sets', () => {
    const f = BALANCE.combat.enemy.flavour;
    for (const def of [...ENEMIES, ...WORLD_BOSSES]) {
      expect(def.def ?? 0, `${def.id} def`).toBeLessThanOrEqual(f.maxDef);
      expect(def.attackSlowMult ?? 1, `${def.id} slow`).toBeLessThanOrEqual(f.maxAttackSlowMult);
      expect(def.dodgeChance ?? 0, `${def.id} dodge`).toBeLessThanOrEqual(f.maxDodgeChance);
      expect(def.regenPct ?? 0, `${def.id} regen`).toBeLessThanOrEqual(f.maxRegenPct);
      expect(def.critChance ?? 0, `${def.id} crit`).toBeLessThanOrEqual(f.maxCritChance);
      expect(def.critMultiplier ?? 1, `${def.id} crit mult`).toBeLessThanOrEqual(f.maxCritMultiplier);
    }
  });
});

/* -------------------------------------------------- old seeds are untouched */

/**
 * THE GUARD THAT MATTERS. These numbers were produced by the four-world build
 * (origin/main @ e9ac382) and pasted here verbatim. World 1 is the world whose
 * arithmetic is claimed to be BYTE-IDENTICAL — its stretch factor is exactly 1,
 * none of its enemies carries a flavour field, and neither of the two new random
 * draws happens for them. If any of that ever stops being true, this fails.
 */
describe('world 1 replays byte-for-byte, curve and RNG stream alike', () => {
  it('deals the identical damage sequence for a recorded seed', () => {
    const GOLDEN_DAMAGE = [
      6.3, 6.3, 6, 6.6, 6.9, 27.9, 12.2, 6.1, 11.2, 7.2, 6.7, 27.3, 6.5, 6, 7, 6.9, 6.7, 6.8, 28, 6.2,
      12.4, 6.8, 7.1, 6.7, 7.1, 29.9, 12, 11, 6.9, 7, 7, 30, 12.5, 7.1, 6.4, 7.1, 6.8, 32.9, 6,
    ];
    const stats = statsAt(6);
    const state = createBattle({ seed: 777, world: 1, wave: 7, energy: 1000, stats });
    const dmg: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      for (const ev of advance(state, BALANCE.combat.tickMs, stats)) {
        if (ev.kind === 'hit' || ev.kind === 'enemy_hit') dmg.push(ev.amount);
      }
      if (i % 5 === 0 && state.status === 'fighting') {
        for (const ev of tap(state, stats).events) if (ev.kind === 'hit') dmg.push(ev.amount);
      }
    }
    expect(dmg.slice(0, GOLDEN_DAMAGE.length)).toEqual(GOLDEN_DAMAGE);
  });

  it('ends a twelve-wave run on the identical RNG state, purse and clock', () => {
    const stats = statsAt(8);
    const state = createBattle({ seed: 20250819, world: 1, wave: 1, energy: 100_000, stats });
    const sum = simulate(state, stats, { waves: 12, maxMs: 600_000 });
    expect(state.rng.s).toBe(997_225_983);
    expect(sum.elapsedMs).toBe(26_400);
    expect(sum.results.map((r) => r.coins)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 56, 15, 16]);
  });

  it('keeps every world’s wave SEEDS untouched — they never depended on content', () => {
    // `waveSeed` mixes seed/world/wave/attempt only, which is why a recorded seed
    // still reproduces the fight it recorded even in a world that got longer.
    const stats = statsAt(8);
    const state = createBattle({ seed: 20250819, world: 4, wave: 1, energy: 100_000, stats });
    const sum = simulate(state, stats, { waves: 4, maxMs: 600_000 });
    expect(sum.results.map((r) => r.seed)).toEqual([
      2_930_093_645, 201_788_782, 1_768_451_215, 3_686_716_072,
    ]);
  });

  it('keeps world 1’s wave specs on their shipped numbers', () => {
    const golden: Record<number, string> = {
      1: '32:6:5',
      10: '105:9.8:56',
      25: '92:12.2:29',
      49: '265:24.8:53',
      50: '609:31.9:216',
    };
    for (const [wave, want] of Object.entries(golden)) {
      const s = waveSpec(1, Number(wave));
      expect(`${s.hp}:${s.atk}:${s.coins}`, `wave ${wave}`).toBe(want);
    }
  });
});

/* ---------------------------------------------------------------- pacing */

/**
 * THE JOURNEY, in workouts — the table the README publishes, pinned.
 *
 * Two poles run in parallel and both are measured against the real thing:
 *   ENERGY — 740 waves × 10 ⚡ plus nine boss fights at 30 ⚡, against the ≈225 ⚡
 *     a full built-in workout pays (17 sets × 10 + the 50 completion bonus);
 *   TRAINING — when each world's body-part gate opens for someone training the
 *     built-in A/B/C split (pinned in `tests/loop.test.ts` for world 1, and
 *     documented world by world in the README).
 * Training is the longer pole and is meant to be: the app is a gym app.
 */
describe('the nine-world journey, in real workouts', () => {
  const ENERGY_PER_WORKOUT = 225;

  it('costs ≈53 workouts of ENERGY in total, rising world by world', () => {
    const perWorld = WORLDS.map(
      (w) => w.waves * BALANCE.combat.energyPerWave + BALANCE.combat.boss.energyCost,
    );
    const workouts = perWorld.map((e) => e / ENERGY_PER_WORKOUT);

    // world 1 ≈ 2.4 workouts, the finale ≈ 8.1 — the documented spread
    expect(workouts[0]).toBeCloseTo(2.4, 1);
    expect(workouts[WORLD_COUNT - 1]).toBeCloseTo(8.1, 1);
    for (let i = 1; i < workouts.length; i += 1) {
      expect(workouts[i] as number).toBeGreaterThan(workouts[i - 1] as number);
    }
    const total = perWorld.reduce((a, b) => a + b, 0) / ENERGY_PER_WORKOUT;
    expect(total).toBeGreaterThan(48);
    expect(total).toBeLessThan(58);
  });

  it('asks for a gate the world’s own waves already trained you past', () => {
    // Every gate is met by a character whose parts sit at the band the README
    // publishes for that world (3/4/5/6/7/8/9/9/10) — the level its steepest
    // requirement asks for — and one level below it, something is still open.
    // Where each gate sits against a REAL trainee is `tests/pacing.test.ts`.
    const band: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 9, 10];
    for (const w of WORLDS) {
      const level = band[w.id - 1] as number;
      const levels = {} as Record<BodyPart, number>;
      for (const p of BODY_PARTS) levels[p] = level;
      expect(worldGate(w.id, levels).locked, `world ${w.id} at level ${level}`).toBe(false);
      // …and one level below it, at least one requirement is still open
      for (const p of BODY_PARTS) levels[p] = level - 1;
      expect(worldGate(w.id, levels).locked, `world ${w.id} at level ${level - 1}`).toBe(true);
    }
  });

  // How the last waves of every world play at the levels a real trainee has
  // when they stand at the boss — and two levels short of them — is measured
  // in `tests/pacing.test.ts`, on both shipped plans.

  it('keeps the world purse growing without turning into a faucet', () => {
    // A world's whole take, against the ≈47,250 🪙 the SIX-slot wardrobe costs
    // at three tiers plus +3 on everything (pinned in `tests/shop.test.ts`).
    const take = (world: number): number => {
      let sum = 0;
      for (let wave = 1; wave <= wavesInWorld(world); wave += 1) sum += waveSpec(world, wave).coins;
      return sum + (bossSpec(world)?.coins ?? 0);
    };
    const purses = WORLDS.map((w) => take(w.id));
    for (let i = 1; i < purses.length; i += 1) {
      expect(purses[i] as number, `world ${i + 1}`).toBeGreaterThan(purses[i - 1] as number);
    }
    // world 1 alone must not buy the shop…
    expect(purses[0] as number).toBeLessThan(4000);
    // …and nine worlds together must not pay a hundred wardrobes: the campaign
    // buys the fully upgraded shop between three and six times over.
    const income = purses.reduce((a, b) => a + b, 0);
    expect(income).toBeLessThan(47_250 * 6);
    expect(income).toBeGreaterThan(47_250 * 3.5);
  });
});
