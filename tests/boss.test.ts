/**
 * World bosses: the body-part gate, the fight, the world unlock and the endless
 * endgame — plus the rule the whole architecture rests on, that replaying the
 * log reproduces every one of those facts exactly.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  bossHandicap,
  bossSpec,
  bossStanding,
  createBattle,
  isEndgame,
  isWorldBossWave,
  requestBossFight,
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
  EQUIPMENT_SLOTS,
  WORLDS,
  WORLD_BOSSES,
  WORLD_COUNT,
  bossGateStatus,
  bossWaveOf,
  equipmentById,
  wavesInWorld,
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

const BOSS_WAVE = bossWaveOf(1);

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
    if (state.status === 'resting') break;
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
    //
    // The late ladder is deliberately COMPRESSED in height and escalated in
    // BREADTH instead — `xpForLevel` is 100 × 1.35^(n−1), so an all-six gate at
    // level 13 alone would want ~180 workouts and put the finale a year out.
    // The requirement SUM still rises strictly world over world (asserted
    // above); it is the peak that flattens.
    // PHASE 11: the band is the level each world's STEEPEST requirement asks
    // for, and it is set where a trainee actually is when the world's waves run
    // out (`tests/pacing.test.ts` measures that on both shipped plans).
    const expected: Record<number, number> = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 9, 9: 10 };
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const needs = Object.values(worldBossOf(world)?.requires ?? {});
      expect(Math.max(...needs)).toBeLessThanOrEqual(expected[world] as number);
      expect(Math.max(...needs)).toBeGreaterThanOrEqual((expected[world] as number) - 2);
    }
  });

  it('spars while the gate is unmet, and starts the boss only when the button is pressed', () => {
    const stats = statsAt(6);
    const state = createBattle({
      seed: 77,
      world: 1,
      wave: BOSS_WAVE,
      energy: 1000,
      stats,
      gateOpen: false,
      gateDeficit: 2,
    });
    advance(state, 2000, stats);
    // the gate does not stop the arena: a paid OVERTIME wave is on
    expect(state.status).toBe('fighting');
    expect(state.enemy?.worldBoss).toBe(false);
    expect(state.enemy?.overtime).toBe(true);
    expect(state.gateDeficit).toBe(2);

    // a level-up mid-session meets the gate without a reload, and the deficit
    // goes with it…
    setGate(state, true);
    expect(state.gateDeficit).toBe(0);
    // …but nothing starts by itself: still sparring, until the player presses
    advance(state, 2000, stats);
    expect(state.enemy?.worldBoss ?? false).toBe(false);

    expect(requestBossFight(state)).toEqual({ ok: true });
    advance(state, 2000, stats);
    expect(state.status).toBe('fighting');
    expect(state.enemy?.worldBoss).toBe(true);
    expect(state.enemy?.id).toBe(worldBossOf(1)?.id);
  });

  it('refuses the boss button without the energy for the fight', () => {
    const stats = statsAt(6);
    const state = createBattle({
      seed: 77,
      world: 1,
      wave: BOSS_WAVE,
      energy: BALANCE.combat.boss.energyCost - 1,
      stats,
      gateOpen: true,
    });
    advance(state, 2000, stats);
    expect(requestBossFight(state)).toEqual({ ok: false, reason: 'no_energy' });
    // sparring is free, so an exhausted player still has something on screen
    expect(state.status).toBe('fighting');
    expect(state.enemy?.sparring).toBe(true);
  });

  it('refuses the boss button away from the boss wave', () => {
    const stats = statsAt(6);
    const state = createBattle({ seed: 77, world: 1, wave: 3, energy: 1000, stats, gateOpen: true });
    advance(state, 2000, stats);
    expect(requestBossFight(state)).toEqual({ ok: false, reason: 'not_at_boss' });
  });
});

/* ------------------------------------------------------------- boss specs */

describe('boss specs', () => {
  it('is far bigger than the last enemies it stands behind', () => {
    for (let world = 1; world <= WORLD_COUNT; world += 1) {
      const spec = bossSpec(world);
      // the final wave is itself a mini-boss, so compare against the last
      // ORDINARY wave — and against that mini-boss too
      const last = waveSpec(world, wavesInWorld(world) - 1);
      const final = waveSpec(world, wavesInWorld(world));
      expect(spec).not.toBeNull();
      expect(spec?.hp ?? 0, `world ${world} vs its last ordinary wave`).toBeGreaterThan(last.hp * 2.5);
      expect(spec?.hp ?? 0, `world ${world} vs its final mini-boss`).toBeGreaterThan(final.hp * 1.25);
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
    expect(last?.nextWave).toBe(bossWaveOf(WORLD_COUNT));
  });

  it('stands each boss on ITS world’s own last wave, not on a global 51', () => {
    for (const w of WORLDS) {
      expect(bossSpec(w.id)?.wave, `world ${w.id}`).toBe(w.waves + 1);
    }
  });

  /**
   * HOW EACH BOSS FIGHTS — measured in `tests/pacing.test.ts`, against the
   * levels a REAL trainee has when they stand at the boss (on both shipped
   * plans) in that era's kit: a 25–90 s climax, at most one knock-out. The
   * ERA ladder itself lives in `tests/helpers/trainee.ts`. Here only the
   * content the retune enumerated is pinned, so a stray edit shows up by name.
   */
  it('wears every slot in an era kit, and pins the nine boss multipliers', () => {
    // the kit really is the whole wardrobe — this is what makes the ladder
    // self-maintaining when a slot is added
    for (const tier of [1, 2, 3]) {
      const ids = EQUIPMENT_SLOTS.map((slot) => `${slot}_${tier}`);
      expect(ids.filter((id) => equipmentById(id))).toHaveLength(EQUIPMENT_SLOTS.length);
    }
    // PHASE 11: worlds 1–4 keep the multipliers they shipped with; the five
    // late bosses came DOWN because their worlds' ramps went up (`span`).
    const hp = (world: number): number => worldBossOf(world)?.hpMult ?? 0;
    expect([1, 2, 3, 4].map(hp)).toEqual([5, 5.5, 6, 7]);
    expect([5, 6, 7, 8, 9].map(hp)).toEqual([3.8, 3.9, 3.7, 3.4, 2.95]);
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

  function killBoss(store: LocalStore, world: number, level = 30): BossResult {
    const stats = statsAt(level);
    const state = createBattle({
      seed: 31337,
      world,
      wave: bossWaveOf(world),
      energy: gameOf(store).energy,
      stats,
      gateOpen: true,
      bossRequested: true,
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

  it('the last boss keeps the player in the LAST world, with the waves running on', () => {
    const store = armedStore(400);
    for (let world = 1; world <= WORLD_COUNT; world += 1) killBoss(store, world);

    const battle = gameOf(store).battle;
    expect(battle.bossesDefeated).toEqual(WORLD_BOSSES.map((b) => b.id));
    expect(battle.world).toBe(WORLD_COUNT);
    expect(battle.wave).toBe(bossWaveOf(WORLD_COUNT));
    expect(isEndgame(battle.bossesDefeated)).toBe(true);
    // the boss wave is no longer a wall — the world simply keeps going
    expect(isWorldBossWave(battle.world, battle.wave)).toBe(true);
    expect(bossStanding(battle.world, battle.wave, battle.bossesDefeated)).toBe(false);
  });

  it('spawns ordinary (scaling) waves again once the final boss is a trophy', () => {
    const stats = statsAt(14);
    const state = createBattle({
      seed: 5,
      world: WORLD_COUNT,
      wave: bossWaveOf(WORLD_COUNT),
      energy: 1000,
      stats,
      gateOpen: true,
      defeatedBosses: WORLD_BOSSES.map((b) => b.id),
    });
    advance(state, 2000, stats);
    expect(state.status).toBe('fighting');
    expect(state.enemy?.worldBoss).toBe(false);
    // and the scaling keeps climbing past the world's own end (the roster's
    // flavour multipliers wobble wave to wave, so compare a full lap apart)
    const endWave = bossWaveOf(WORLD_COUNT);
    expect(waveSpec(WORLD_COUNT, endWave + 12).hp).toBeGreaterThan(waveSpec(WORLD_COUNT, endWave).hp);
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

/* ------------------------------------------------------ the early challenge */

describe('the early challenge (PHASE 11)', () => {
  it('measures the deficit as the sum of the missing levels, and nothing when met', () => {
    const boss = worldBossOf(4);
    const levels = levelsAt(1);
    const need = Object.values(boss?.requires ?? {}).reduce((a, b) => a + b, 0);
    expect(bossGateStatus(boss, levels).deficit).toBe(need - 6);
    for (const [part, n] of Object.entries(boss?.requires ?? {})) levels[part as BodyPart] = n as number;
    expect(bossGateStatus(boss, levels).deficit).toBe(0);
    // over-levelled parts do not offset short ones
    levels.chest += 5;
    levels.legs -= 1;
    expect(bossGateStatus(boss, levels).deficit).toBe(1);
    expect(bossGateStatus(boss, levels).locked).toBe(true);
  });

  it('scales the handicap per missing level, exactly 1 at the gate, and caps it', () => {
    const h = BALANCE.combat.boss.handicap;
    expect(bossHandicap(0)).toEqual({ deficit: 0, hp: 1, atk: 1 });
    expect(bossHandicap(-3)).toEqual({ deficit: 0, hp: 1, atk: 1 });
    expect(bossHandicap(1).hp).toBeCloseTo(1 + h.hpPerLevel, 6);
    expect(bossHandicap(1).atk).toBeCloseTo(1 + h.atkPerLevel, 6);
    expect(bossHandicap(4).hp).toBeCloseTo(1 + 4 * h.hpPerLevel, 6);
    expect(bossHandicap(h.maxLevels + 10)).toEqual(bossHandicap(h.maxLevels));
    for (let d = 1; d <= h.maxLevels; d += 1) {
      expect(bossHandicap(d).hp).toBeGreaterThan(bossHandicap(d - 1).hp);
      expect(bossHandicap(d).atk).toBeGreaterThan(bossHandicap(d - 1).atk);
    }
  });

  it('spawns the boss strengthened by the deficit, and records it on the kill', () => {
    const stats = statsAt(40);
    const early = createBattle({
      seed: 77,
      world: 2,
      wave: bossWaveOf(2),
      energy: 1000,
      stats,
      gateOpen: false,
      gateDeficit: 3,
      bossRequested: true,
    });
    advance(early, 2000, stats);
    expect(early.enemy?.worldBoss).toBe(true);
    const plain = bossSpec(2);
    const spec = bossSpec(2, 3);
    expect(spec?.handicap).toEqual(bossHandicap(3));
    expect(early.enemy?.maxHp).toBe(spec?.hp);
    expect(spec?.hp ?? 0).toBeGreaterThan(plain?.hp ?? 0);
    expect(spec?.atk ?? 0).toBeGreaterThan(plain?.atk ?? 0);
    // same purse, same fee: the handicap is the price
    expect(spec?.coins).toBe(plain?.coins);
    expect(spec?.energyCost).toBe(plain?.energyCost);

    const res = fight(early, stats);
    expect(res.bosses).toHaveLength(1);
    expect(res.bosses[0]?.deficit).toBe(3);
    expect(res.bosses[0]?.nextWorld).toBe(3);

    // …and the gate being MET afterwards does not change what was recorded
    const store = new LocalStore(fakeStorage());
    for (let i = 0; i < 20; i += 1) {
      onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
    }
    onBossDefeated(store, res.bosses[0] as BossResult);
    const ev = store.getEvents().find((e) => e.type === 'boss_defeated');
    expect(ev?.payload['deficit']).toBe(3);
    expect(gameOf(store).battle.world).toBe(3);
    const replayed = rebuildFromEvents(store.getEvents(), Date.now()).game;
    expect(replayed?.battle).toEqual(gameOf(store).battle);
  });

  it('keeps the handicap the boss on screen spawned with, even if the gate moves under it', () => {
    const stats = statsAt(6);
    const state = createBattle({
      seed: 77,
      world: 1,
      wave: BOSS_WAVE,
      energy: 1000,
      stats,
      gateOpen: false,
      gateDeficit: 2,
      bossRequested: true,
    });
    advance(state, 2000, stats);
    const hp = state.enemy?.maxHp;
    setGate(state, true);
    advance(state, 500, stats);
    expect(state.enemy?.worldBoss).toBe(true);
    expect(state.enemy?.maxHp).toBe(hp);
    // a boolean-only call keeps the deficit it does not know about
    const other = createBattle({ seed: 1, world: 1, wave: BOSS_WAVE, energy: 1000, stats, gateDeficit: 4 });
    setGate(other, false);
    expect(other.gateDeficit).toBe(4);
    setGate(other, false, [], 1);
    expect(other.gateDeficit).toBe(1);
  });
});
