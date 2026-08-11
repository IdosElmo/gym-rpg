/**
 * World bosses: the body-part gate, the fight, the world unlock and the endless
 * endgame — plus the rule the whole architecture rests on, that replaying the
 * log reproduces every one of those facts exactly.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  bossSpec,
  bossStanding,
  createBattle,
  isEndgame,
  isWorldBossWave,
  setGate,
  superReady,
  tap,
  useSuper,
  waveSpec,
  worldGate,
  type BattleState,
  type BossResult,
  type CombatStats,
} from '../src/core/combat.ts';
import { gameOf, onBossDefeated, onSetCompleted } from '../src/core/game.ts';
import { applyGameEvent, deriveStats, emptyGame, rebuildGame } from '../src/core/xp.ts';
import {
  WORLD_BOSSES,
  WORLD_COUNT,
  bossGateStatus,
  worldBossOf,
} from '../src/data/gameContent.ts';
import { BODY_PARTS, findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function ex(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
}

function levelsAt(level: number): Record<BodyPart, number> {
  const out = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) out[p] = level;
  return out;
}

function statsAt(level: number): CombatStats {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = level;
  const s = deriveStats(parts, 0);
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

const BOSS_WAVE = BALANCE.combat.wavesPerWorld + 1;

/** Run the battle like an ENGAGED player: auto attacks + taps + supers. */
export function fight(
  state: BattleState,
  stats: CombatStats,
  maxMs = 240_000,
): { bosses: BossResult[]; waves: number; defeats: number; ms: number } {
  const tick = BALANCE.combat.tickMs;
  const bosses: BossResult[] = [];
  let waves = 0;
  let defeats = 0;
  let sinceTap = 0;
  let ms = 0;

  // Taps and supers deal damage too, so their events must be collected exactly
  // like the loop's — a kill landed by a tap is still a kill.
  const collect = (events: readonly { kind: string }[]): void => {
    for (const ev of events as ReadonlyArray<ReturnType<typeof advance>[number]>) {
      if (ev.kind === 'boss_defeated') bosses.push(ev.result);
      else if (ev.kind === 'wave_cleared') waves += 1;
      else if (ev.kind === 'defeat') defeats += 1;
    }
  };

  while (ms < maxMs) {
    collect(advance(state, tick, stats));
    ms += tick;
    sinceTap += tick;
    if (state.status === 'fighting') {
      if (superReady(state)) collect(useSuper(state, stats).events);
      if (sinceTap >= BALANCE.combat.tap.minIntervalMs * 1.5) {
        sinceTap = 0;
        collect(tap(state, stats).events);
      }
    }
    if (state.status === 'gated' || state.status === 'resting') break;
    if (bosses.length > 0) break; // one boss per call — that is what we measure
  }
  return { bosses, waves, defeats, ms };
}

/* ------------------------------------------------------------------ gates */

describe('boss gates', () => {
  it('gives every world exactly one boss with a body-part requirement', () => {
    expect(WORLD_BOSSES).toHaveLength(WORLD_COUNT);
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const boss = worldBossOf(world);
      expect(boss, `world ${world} has no boss`).toBeDefined();
      expect(boss?.kind).toBe('boss');
      expect(Object.keys(boss?.requires ?? {}).length).toBeGreaterThan(0);
      expect(boss?.he.length).toBeGreaterThan(1);
    }
  });

  it('escalates the requirements world by world, and asks for the whole body last', () => {
    const total = (world: number): number =>
      Object.values(worldBossOf(world)?.requires ?? {}).reduce((a, b) => a + b, 0);
    for (let world = 2; world <= WORLD_COUNT; world += 1) {
      expect(total(world), `world ${world} is not harder than ${world - 1}`).toBeGreaterThan(total(world - 1));
    }
    // the final boss demands every body part
    expect(Object.keys(worldBossOf(WORLD_COUNT)?.requires ?? {}).sort()).toEqual([...BODY_PARTS].sort());
  });

  it('reports exactly which parts are missing, with have/need for each', () => {
    const boss = worldBossOf(1);
    const status = bossGateStatus(boss, levelsAt(1));
    expect(status.locked).toBe(true);
    expect(status.requirements.length).toBeGreaterThan(0);
    for (const r of status.requirements) {
      expect(r.have).toBe(1);
      expect(r.need).toBeGreaterThan(1);
      expect(r.met).toBe(false);
      expect(BODY_PARTS).toContain(r.part);
    }
  });

  it('opens only when EVERY requirement is met — one short still locks it', () => {
    const boss = worldBossOf(1);
    const required = Object.entries(boss?.requires ?? {}) as Array<[BodyPart, number]>;
    const levels = levelsAt(1);
    for (const [part, need] of required) levels[part] = need;
    expect(bossGateStatus(boss, levels).locked).toBe(false);

    const firstPart = required[0]?.[0] as BodyPart;
    levels[firstPart] -= 1;
    const short = bossGateStatus(boss, levels);
    expect(short.locked).toBe(true);
    expect(short.requirements.filter((r) => !r.met).map((r) => r.part)).toEqual([firstPart]);
  });

  it('is reachable by a consistent trainee at roughly the same pace as the waves', () => {
    // Sanity guard on the tuning: every gate must sit within the level band the
    // combat curve needs anyway (see the note in balance.ts).
    const expected: Record<number, number> = { 1: 3, 2: 5, 3: 7, 4: 9 };
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const needs = Object.values(worldBossOf(world)?.requires ?? {});
      expect(Math.max(...needs)).toBeLessThanOrEqual(expected[world] as number);
      expect(Math.max(...needs)).toBeGreaterThanOrEqual((expected[world] as number) - 2);
    }
  });

  it('blocks the fight while the gate is locked, and releases it the moment it opens', () => {
    const stats = statsAt(6);
    const state = createBattle({
      seed: 77,
      world: 1,
      wave: BOSS_WAVE,
      energy: 1000,
      stats,
      gateOpen: false,
    });
    advance(state, 2000, stats);
    expect(state.status).toBe('gated');
    expect(state.enemy).toBeNull();

    // a level-up mid-session opens the gate without a reload
    setGate(state, true);
    expect(state.status).toBe('idle');
    advance(state, 2000, stats);
    expect(state.status).toBe('fighting');
    expect(state.enemy?.worldBoss).toBe(true);
    expect(state.enemy?.id).toBe(worldBossOf(1)?.id);
  });
});

/* ------------------------------------------------------------- boss specs */

describe('boss specs', () => {
  it('is far bigger than the wave-50 enemy it stands behind', () => {
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const spec = bossSpec(world);
      // wave 50 is itself a mini-boss, so compare against the last ORDINARY wave
      const last = waveSpec(world, BALANCE.combat.wavesPerWorld - 1);
      expect(spec).not.toBeNull();
      expect(spec?.hp ?? 0).toBeGreaterThan(last.hp * 3);
      expect(spec?.coins ?? 0).toBeGreaterThan(last.coins * 5);
      expect(spec?.energyCost).toBe(BALANCE.combat.boss.energyCost);
    }
    expect(bossSpec(WORLD_COUNT + 1)).toBeNull();
  });

  it('sends the player to the next world — except the last one, which turns endless', () => {
    for (let world = 1; world < WORLD_COUNT; world += 1) {
      const spec = bossSpec(world);
      expect(spec?.endgame).toBe(false);
      expect(spec?.nextWorld).toBe(world + 1);
      expect(spec?.nextWave).toBe(1);
    }
    const last = bossSpec(WORLD_COUNT);
    expect(last?.endgame).toBe(true);
    expect(last?.nextWorld).toBe(WORLD_COUNT);
    expect(last?.nextWave).toBe(BOSS_WAVE);
  });

  it('can be beaten by a character that exactly meets the gate', () => {
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const boss = worldBossOf(world);
      const parts = emptyGame().parts;
      // exactly the gate, nothing more, and nothing bought in the shop
      const needs = Object.values(boss?.requires ?? {});
      const floor = Math.min(...needs) - 1;
      for (const p of BODY_PARTS) parts[p].level = Math.max(1, floor);
      for (const [part, need] of Object.entries(boss?.requires ?? {})) {
        parts[part as BodyPart].level = need;
      }
      const s = deriveStats(parts, 0);
      const stats: CombatStats = {
        atk: s.atk,
        def: s.def,
        maxHp: s.maxHp,
        attackIntervalMs: s.attackIntervalMs,
        critChance: s.critChance,
        critMultiplier: s.critMultiplier,
        regen: s.regen,
      };
      const state = createBattle({
        seed: 4242,
        world,
        wave: BOSS_WAVE,
        energy: 1000,
        stats,
        gateOpen: true,
      });
      const res = fight(state, stats);
      expect(res.bosses, `world ${world} boss is unbeatable at its own gate`).toHaveLength(1);
      // climactic: much longer than an ordinary wave, but not a war of attrition
      expect(res.ms).toBeGreaterThan(8_000);
      expect(res.ms).toBeLessThan(150_000);
    }
  });
});

/* ------------------------------------------------------------- the unlock */

describe('boss_defeated', () => {
  /** A store with energy in the bank and the battle parked at the boss wave. */
  function armedStore(sets = 80): LocalStore {
    const store = new LocalStore(fakeStorage());
    for (let i = 0; i < sets; i += 1) {
      onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
    }
    return store;
  }

  function killBoss(store: LocalStore, world: number, level = 12): BossResult {
    const stats = statsAt(level);
    const state = createBattle({
      seed: 31337,
      world,
      wave: BOSS_WAVE,
      energy: gameOf(store).energy,
      stats,
      gateOpen: true,
      defeatedBosses: gameOf(store).battle.bossesDefeated,
    });
    const res = fight(state, stats);
    const boss = res.bosses[0];
    if (!boss) throw new Error(`boss of world ${world} was not defeated`);
    onBossDefeated(store, boss);
    return boss;
  }

  it('unlocks the next world, resets the wave and pays a big purse', () => {
    const store = armedStore();
    const energyBefore = gameOf(store).energy;
    const coinsBefore = gameOf(store).battle.coins;

    const result = killBoss(store, 1);
    const battle = gameOf(store).battle;

    expect(battle.world).toBe(2);
    expect(battle.wave).toBe(1);
    expect(battle.bossesDefeated).toEqual(['boss_w1']);
    expect(battle.coins).toBe(coinsBefore + result.coins);
    expect(gameOf(store).energy).toBe(energyBefore - BALANCE.combat.boss.energyCost);
    expect(store.getEvents().filter((e) => e.type === 'boss_defeated')).toHaveLength(1);
  });

  it('the last boss keeps the player in world 4, with the waves running on', () => {
    const store = armedStore(400);
    for (let world = 1; world <= WORLD_COUNT; world += 1) killBoss(store, world);

    const battle = gameOf(store).battle;
    expect(battle.bossesDefeated).toEqual(WORLD_BOSSES.map((b) => b.id));
    expect(battle.world).toBe(WORLD_COUNT);
    expect(battle.wave).toBe(BOSS_WAVE);
    expect(isEndgame(battle.bossesDefeated)).toBe(true);
    // the boss wave is no longer a wall — the world simply keeps going
    expect(isWorldBossWave(battle.wave)).toBe(true);
    expect(bossStanding(battle.world, battle.wave, battle.bossesDefeated)).toBe(false);
  });

  it('spawns ordinary (scaling) waves again once the final boss is a trophy', () => {
    const stats = statsAt(14);
    const state = createBattle({
      seed: 5,
      world: WORLD_COUNT,
      wave: BOSS_WAVE,
      energy: 1000,
      stats,
      gateOpen: true,
      defeatedBosses: WORLD_BOSSES.map((b) => b.id),
    });
    advance(state, 2000, stats);
    expect(state.status).toBe('fighting');
    expect(state.enemy?.worldBoss).toBe(false);
    // and the scaling keeps climbing past the old world end
    expect(waveSpec(WORLD_COUNT, BOSS_WAVE + 10).hp).toBeGreaterThan(waveSpec(WORLD_COUNT, BOSS_WAVE).hp);
  });

  it('is idempotent under replay: rebuildFromEvents reproduces the trophies', () => {
    const store = armedStore(400);
    killBoss(store, 1);
    killBoss(store, 2);
    const live = gameOf(store);

    const replayed = rebuildFromEvents(store.getEvents());
    expect(replayed.game?.battle).toEqual(live.battle);
    expect(replayed.game).toEqual(live);

    // replaying the same log twice never double-counts a trophy
    const twice = rebuildGame([...store.getEvents(), ...store.getEvents()], '2025-05-04');
    expect(twice.battle.bossesDefeated).toEqual(['boss_w1', 'boss_w2']);
  });

  it('is wiped by data_cleared, trophies and all', () => {
    const store = armedStore();
    killBoss(store, 1);
    expect(gameOf(store).battle.bossesDefeated).toHaveLength(1);
    store.clear();
    expect(gameOf(store).battle).toEqual(emptyGame().battle);
    expect(rebuildFromEvents(store.getEvents()).game?.battle.bossesDefeated).toEqual([]);
  });
});

/* ------------------------------------------------------------- trophies */

describe('trophy derivation', () => {
  it('records each boss once, in the order they fell, straight from the reducer', () => {
    const game = emptyGame();
    game.energy = 500;
    const kill = (bossId: string, world: number): void => {
      applyGameEvent(game, 'boss_defeated', {
        date: '2025-05-04',
        world,
        wave: BOSS_WAVE,
        bossId,
        coins: 100,
        energySpent: BALANCE.combat.boss.energyCost,
        seed: 1,
        durationMs: 1000,
        nextWorld: world + 1,
        nextWave: 1,
        endgame: false,
      });
    };
    kill('boss_w1', 1);
    kill('boss_w2', 2);
    kill('boss_w1', 1); // a duplicated/replayed event never mints a second trophy
    expect(game.battle.bossesDefeated).toEqual(['boss_w1', 'boss_w2']);
    expect(game.battle.coins).toBe(300);
    expect(game.energy).toBe(500 - 3 * BALANCE.combat.boss.energyCost);
  });

  it('worldGate answers for the world the player is standing in', () => {
    const maxed = levelsAt(99);
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      expect(worldGate(world, maxed).locked).toBe(false);
      expect(worldGate(world, levelsAt(1)).locked).toBe(true);
    }
  });
});
