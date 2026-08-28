/**
 * Unit tests for the battle engine (`core/combat.ts`).
 *
 * The two properties everything else rests on:
 *   1. DETERMINISM — same seed + same inputs => byte-identical run, at any frame
 *      rate; and
 *   2. STATS MATTER — every one of the six body-part stats measurably changes
 *      the outcome, which is what makes real training the only progression.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  createBattle,
  hashSeed,
  isMiniBossWave,
  isWorldBossWave,
  makeRng,
  mitigation,
  nextFloat,
  setEnergy,
  simulate,
  superReady,
  tap,
  useSuper,
  waveSeed,
  waveSpec,
  worldGate,
  type BattleState,
  type CombatEvent,
  type CombatStats,
} from '../src/core/combat.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import { BODY_PARTS, type BodyPart } from '../src/data/program.ts';
import { WORLDS, wavesInWorld } from '../src/data/gameContent.ts';

const TICK = BALANCE.combat.tickMs;

/** Stats of a character whose six parts are all at `level`. */
function statsAt(level: number, tier = 0): CombatStats {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = level;
  const s = deriveStats(parts, tier);
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

const BASE = statsAt(1);

function battle(over: Partial<Parameters<typeof createBattle>[0]> = {}): BattleState {
  return createBattle({ seed: 4242, world: 1, wave: 1, energy: 1000, stats: BASE, ...over });
}

/** Run `ms` of battle in `stepMs` slices and collect every effect. */
function run(state: BattleState, stats: CombatStats, ms: number, stepMs: number = TICK): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (let t = 0; t < ms; t += stepMs) out.push(...advance(state, stepMs, stats));
  return out;
}

/* ------------------------------------------------------------------- RNG */

describe('seeded RNG', () => {
  it('is a pure function of the seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const c = makeRng(12346);
    const seqA = Array.from({ length: 8 }, () => nextFloat(a));
    const seqB = Array.from({ length: 8 }, () => nextFloat(b));
    const seqC = Array.from({ length: 8 }, () => nextFloat(c));
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gives every (world, wave, attempt) its own reproducible seed', () => {
    expect(waveSeed(7, 1, 1, 0)).toBe(waveSeed(7, 1, 1, 0));
    expect(waveSeed(7, 1, 1, 0)).not.toBe(waveSeed(7, 1, 2, 0));
    expect(waveSeed(7, 1, 1, 0)).not.toBe(waveSeed(7, 2, 1, 0));
    // a retry after a knock-out is NOT a byte-identical rerun of the lost fight
    expect(waveSeed(7, 1, 1, 0)).not.toBe(waveSeed(7, 1, 1, 1));
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
  });
});

/* ----------------------------------------------------------------- waves */

describe('wave scaling', () => {
  it('makes enemies harder every wave and every world', () => {
    const w1 = waveSpec(1, 1);
    const w9 = waveSpec(1, 9);
    const w2_1 = waveSpec(2, 1);
    expect(w9.hp).toBeGreaterThan(w1.hp);
    expect(w9.atk).toBeGreaterThan(w1.atk);
    expect(w2_1.hp).toBeGreaterThan(w1.hp);
    expect(w2_1.atk).toBeGreaterThan(w1.atk);
    // the underlying curve is monotonic across a whole world (per-enemy
    // flavour multipliers are divided out — they wobble it on purpose)
    let prev = 0;
    for (let wave = 1; wave <= wavesInWorld(1); wave += 1) {
      const spec = waveSpec(1, wave);
      const hp =
        spec.hp /
        ((spec.enemy.hpMult ?? 1) * (spec.miniBoss ? BALANCE.combat.enemy.miniBossHpMult : 1));
      expect(hp).toBeGreaterThan(prev);
      prev = hp;
    }
  });

  it('puts a mini-boss on every 10th wave, and only there', () => {
    for (let wave = 1; wave <= 40; wave += 1) {
      expect(isMiniBossWave(wave)).toBe(wave % BALANCE.combat.miniBossEvery === 0);
      expect(waveSpec(1, wave).miniBoss).toBe(wave % 10 === 0);
    }
    expect(waveSpec(1, 10).enemy.kind).toBe('mini');
    expect(waveSpec(1, 9).enemy.kind).toBe('regular');
  });

  it('pays more coins for later waves and much more for a mini-boss', () => {
    expect(waveSpec(1, 20).coins).toBeGreaterThan(waveSpec(1, 2).coins);
    expect(waveSpec(2, 5).coins).toBeGreaterThan(waveSpec(1, 5).coins);
    expect(waveSpec(1, 10).coins).toBeGreaterThan(waveSpec(1, 11).coins);
  });

  it('spars for nothing at the boss wave while the gate is locked', () => {
    expect(isWorldBossWave(1, wavesInWorld(1))).toBe(false);
    expect(isWorldBossWave(1, wavesInWorld(1) + 1)).toBe(true);

    // Gate closed: the arena keeps FIGHTING — sparring bouts, not a dead stop.
    const stats = statsAt(20);
    const state = battle({ wave: wavesInWorld(1) + 1, stats });
    const events = run(state, stats, 120_000);
    expect(events.some((e) => e.kind === 'spawn')).toBe(true);
    expect(events.some((e) => e.kind === 'sparring_cleared')).toBe(true);
    // …but a sparring bout pays NOTHING: no boss, no wave event, no coins, no
    // energy, and the wave marker never moves off the boss wave.
    expect(events.some((e) => e.kind === 'boss_spawn')).toBe(false);
    expect(events.some((e) => e.kind === 'wave_cleared')).toBe(false);
    expect(state.wave).toBe(wavesInWorld(1) + 1);
    expect(state.energy).toBe(1000);
    expect(state.coinsEarned).toBe(0);
    expect(state.wavesCleared).toBe(0);
  });

  it('spars too when the gate is OPEN but the boss button was not pressed', () => {
    const stats = statsAt(20);
    const state = battle({ wave: wavesInWorld(1) + 1, stats, gateOpen: true });
    const events = run(state, stats, 60_000);
    expect(events.some((e) => e.kind === 'boss_spawn')).toBe(false);
    expect(events.some((e) => e.kind === 'spawn')).toBe(true);
    expect(state.enemy?.worldBoss ?? false).toBe(false);
    // pressing the button (bossRequested) is what actually starts the fight
    const armed = battle({ wave: wavesInWorld(1) + 1, stats, gateOpen: true, bossRequested: true });
    const bossEvents = run(armed, stats, 2000);
    expect(bossEvents.some((e) => e.kind === 'boss_spawn')).toBe(true);
    expect(armed.enemy?.worldBoss).toBe(true);
  });

  it('reports the boss gate requirements with met/unmet states', () => {
    const levels = {} as Record<BodyPart, number>;
    for (const p of BODY_PARTS) levels[p] = 1;
    const locked = worldGate(1, levels);
    expect(locked.locked).toBe(true);
    expect(locked.requirements.length).toBeGreaterThan(0);
    expect(locked.requirements.every((r) => !r.met)).toBe(true);

    for (const p of BODY_PARTS) levels[p] = 99;
    expect(worldGate(1, levels).locked).toBe(false);
  });

  it('has a roster (and a mini-boss) for every world', () => {
    for (const w of WORLDS) {
      expect(waveSpec(w.id, 1).enemy.world).toBe(w.id);
      expect(waveSpec(w.id, 10).enemy.kind).toBe('mini');
      expect(waveSpec(w.id, 1).enemy.svg).toContain('<svg');
    }
  });
});

/* ---------------------------------------------------------- determinism */

describe('determinism', () => {
  it('replays a battle exactly from the same seed', () => {
    const a = run(battle(), BASE, 60_000);
    const b = run(battle(), BASE, 60_000);
    expect(a).toEqual(b);
    expect(a.filter((e) => e.kind === 'wave_cleared').length).toBeGreaterThan(3);
  });

  it('produces a different battle from a different seed', () => {
    const a = run(battle({ seed: 1 }), BASE, 30_000);
    const b = run(battle({ seed: 2 }), BASE, 30_000);
    expect(a).not.toEqual(b);
  });

  it('does not depend on the frame rate (fixed timestep)', () => {
    const fine = battle();
    const coarse = battle();
    const a = run(fine, BASE, 30_000, TICK);
    const b = run(coarse, BASE, 30_000, TICK * 4);
    expect(a).toEqual(b);
    expect(fine.wave).toBe(coarse.wave);
    expect(fine.playerHp).toBe(coarse.playerHp);
  });

  it('never banks time from a backgrounded tab', () => {
    const paused = battle();
    // one enormous frame (a tab that was hidden for an hour)
    advance(paused, 60 * 60_000, BASE);
    const honest = battle();
    run(honest, BASE, 1000);
    expect(paused.wavesCleared).toBeLessThanOrEqual(honest.wavesCleared + 1);
    expect(paused.wavesCleared).toBeLessThan(5);
  });

  it('records the exact seed of every cleared wave in its result', () => {
    const state = battle();
    const events = run(state, BASE, 30_000);
    const cleared = events.filter((e) => e.kind === 'wave_cleared');
    expect(cleared.length).toBeGreaterThan(0);
    for (const ev of cleared) {
      if (ev.kind !== 'wave_cleared') continue;
      expect(ev.result.seed).toBe(waveSeed(state.seed, ev.result.world, ev.result.wave, 0));
    }
  });
});

/* --------------------------------------------------------- stats matter */

describe('every body-part stat changes the outcome', () => {
  it('chest (ATK): more damage clears a wave faster', () => {
    const weak = simulate(battle({ wave: 12 }), { ...BASE }, { waves: 1, maxMs: 300_000 });
    const strong = simulate(
      battle({ wave: 12, stats: { ...BASE, atk: BASE.atk * 3 } }),
      { ...BASE, atk: BASE.atk * 3 },
      { waves: 1, maxMs: 300_000 },
    );
    expect(strong.elapsedMs).toBeLessThan(weak.elapsedMs);
  });

  it('back (DEF): more defence means fewer knock-outs', () => {
    const hard = { world: 1, wave: 30, energy: 100_000 };
    const squishy = statsAt(3);
    const armoured: CombatStats = { ...squishy, def: squishy.def * 6 };
    const a = simulate(battle({ ...hard, stats: squishy }), squishy, { waves: 99, maxMs: 120_000 });
    const b = simulate(battle({ ...hard, stats: armoured }), armoured, { waves: 99, maxMs: 120_000 });
    expect(b.defeats).toBeLessThan(a.defeats);
    expect(mitigation(0)).toBe(1);
    expect(mitigation(60)).toBeCloseTo(0.5, 6);
    expect(mitigation(1e9)).toBeGreaterThan(0); // never fully immune
  });

  it('legs (max HP): more HP survives longer against the same enemy', () => {
    const small = statsAt(2);
    const big: CombatStats = { ...small, maxHp: small.maxHp * 4 };
    const a = simulate(battle({ wave: 30, stats: small }), small, { waves: 99, maxMs: 60_000 });
    const b = simulate(battle({ wave: 30, stats: big }), big, { waves: 99, maxMs: 60_000 });
    expect(b.defeats).toBeLessThan(a.defeats);
  });

  it('shoulders (attack speed): a shorter interval lands more auto attacks', () => {
    const slow = { ...BASE, atk: 0.01 }; // scratch damage, so the wave never ends
    const fast = { ...slow, attackIntervalMs: slow.attackIntervalMs / 3 };
    const countHits = (stats: CombatStats): number =>
      run(battle(), stats, 20_000).filter((e) => e.kind === 'hit' && e.source === 'auto').length;
    expect(countHits(fast)).toBeGreaterThan(countHits(slow) * 2);
  });

  it('arms (crit): more crit chance means more critical hits and more damage', () => {
    const plain = { ...BASE, atk: 0.01, critChance: 0 };
    const critty = { ...plain, critChance: 0.9, critMultiplier: 3 };
    const crits = (stats: CombatStats): number =>
      run(battle(), stats, 30_000).filter((e) => e.kind === 'hit' && e.crit).length;
    expect(crits(plain)).toBe(0);
    expect(crits(critty)).toBeGreaterThan(5);
  });

  it('core (regen): regen heals between the enemy hits', () => {
    const none = { ...statsAt(2), regen: 0 };
    const healer = { ...none, regen: 40 };
    const a = battle({ wave: 25, stats: none });
    const b = battle({ wave: 25, stats: healer });
    run(a, none, 20_000);
    run(b, healer, 20_000);
    expect(b.defeats).toBeLessThanOrEqual(a.defeats);
    const heals = run(b, healer, 5000).filter((e) => e.kind === 'regen');
    expect(heals.length).toBeGreaterThan(0);
  });

  it('the streak buff makes the same character strictly stronger', () => {
    const plain = statsAt(4, 0);
    const buffed = statsAt(4, 3);
    expect(buffed.atk).toBeGreaterThan(plain.atk);
    expect(buffed.maxHp).toBeGreaterThan(plain.maxHp);
    const a = simulate(battle({ wave: 25, stats: plain }), plain, { waves: 3, maxMs: 300_000 });
    const b = simulate(battle({ wave: 25, stats: buffed }), buffed, { waves: 3, maxMs: 300_000 });
    expect(b.elapsedMs).toBeLessThanOrEqual(a.elapsedMs);
  });
});

/* --------------------------------------------------------------- energy */

describe('energy economy', () => {
  it('charges energy per cleared wave and rests at zero', () => {
    const cost = BALANCE.combat.energyPerWave;
    const state = battle({ energy: cost * 2 });
    const events = run(state, BASE, 120_000);
    const cleared = events.filter((e) => e.kind === 'wave_cleared');
    expect(cleared).toHaveLength(2);
    expect(state.energy).toBe(0);
    expect(state.status).toBe('resting');
    expect(events.some((e) => e.kind === 'resting')).toBe(true);
    // and it stays paused, no matter how long the tab is left open
    run(state, BASE, 120_000);
    expect(state.wavesCleared).toBe(2);
  });

  it('never starts a wave it cannot pay for', () => {
    const state = battle({ energy: BALANCE.combat.energyPerWave - 1 });
    run(state, BASE, 5000);
    expect(state.status).toBe('resting');
    expect(state.enemy).toBeNull();
    expect(state.wavesCleared).toBe(0);
  });

  it('resumes as soon as a real workout tops the energy up', () => {
    const state = battle({ energy: 0 });
    run(state, BASE, 2000);
    expect(state.status).toBe('resting');
    setEnergy(state, 50);
    run(state, BASE, 30_000);
    expect(state.wavesCleared).toBeGreaterThan(0);
    expect(state.status).not.toBe('resting');
  });

  it('charges nothing for a defeat — being knocked out costs time, not energy', () => {
    const stats = statsAt(1);
    const state = battle({ wave: 40, energy: 100, stats });
    run(state, stats, 90_000);
    expect(state.defeats).toBeGreaterThan(0);
    expect(state.wavesCleared).toBe(0);
    expect(state.energy).toBe(100);
  });

  it('one workout of energy is worth 15–25 waves (the brief target)', () => {
    // one workout ≈ 16 sets × 10 ⚡ + 50 ⚡ completion
    const perWorkout = 16 * BALANCE.energy.perSet + BALANCE.energy.perWorkout;
    const waves = Math.floor(perWorkout / BALANCE.combat.energyPerWave);
    expect(waves).toBeGreaterThanOrEqual(15);
    expect(waves).toBeLessThanOrEqual(25);
  });
});

/* --------------------------------------------------- progress & defeats */

describe('progression', () => {
  it('advances one wave per clear and keeps the mini-boss cadence', () => {
    const stats = statsAt(6);
    const state = battle({ energy: 100_000, stats });
    const summary = simulate(state, stats, { waves: 12, maxMs: 600_000 });
    expect(summary.results.map((r) => r.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(summary.results.filter((r) => r.miniBoss).map((r) => r.wave)).toEqual([10]);
    expect(state.wave).toBe(13);
  });

  it('restarts the same wave after a knock-out, at full HP', () => {
    const stats = statsAt(1);
    const state = battle({ wave: 45, stats });
    run(state, stats, 60_000);
    expect(state.defeats).toBeGreaterThan(0);
    expect(state.wave).toBe(45); // no progress lost, no progress gained
    expect(state.attempt).toBeGreaterThan(0);
    expect(state.streakDefeats).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------ tap/super */

describe('tap and super move', () => {
  it('adds a bonus hit and charges the super meter', () => {
    const state = battle();
    run(state, BASE, 200); // get an enemy on screen
    const hpBefore = state.enemy?.hp ?? 0;
    const res = tap(state, BASE);
    expect(res.accepted).toBe(true);
    expect(res.events.some((e) => e.kind === 'hit' && e.source === 'tap')).toBe(true);
    expect(state.enemy?.hp ?? 0).toBeLessThan(hpBefore);
    expect(state.superMeter).toBeCloseTo(BALANCE.combat.tap.superPerTap, 6);
  });

  it('caps the tap rate so a macro cannot out-tap a human', () => {
    const state = battle();
    run(state, BASE, 200);
    expect(tap(state, BASE).accepted).toBe(true);
    expect(tap(state, BASE).accepted).toBe(false); // same instant
    run(state, BASE, BALANCE.combat.tap.minIntervalMs + TICK);
    expect(tap(state, BASE).accepted).toBe(true);
  });

  it('fills the meter, fires a big hit and resets', () => {
    const stats = { ...BASE, atk: 1, critChance: 0 };
    const state = battle({ stats });
    run(state, stats, 200);
    expect(useSuper(state, stats).accepted).toBe(false); // not charged yet

    const taps = Math.ceil(1 / BALANCE.combat.tap.superPerTap);
    let ready = false;
    for (let i = 0; i < taps; i += 1) {
      const res = tap(state, stats);
      ready = ready || res.events.some((e) => e.kind === 'super_ready');
      run(state, stats, BALANCE.combat.tap.minIntervalMs + TICK);
    }
    expect(ready).toBe(true);
    expect(superReady(state)).toBe(true);

    const before = state.enemy?.hp ?? 0;
    const fired = useSuper(state, stats);
    expect(fired.accepted).toBe(true);
    const hit = fired.events.find((e) => e.kind === 'hit');
    expect(hit && hit.kind === 'hit' ? hit.amount : 0).toBeGreaterThan(stats.atk * 3);
    expect(state.enemy === null || state.enemy.hp < before).toBe(true);
    expect(state.superMeter).toBe(0);
  });

  it('ignores taps while resting or between waves', () => {
    const idle = battle({ energy: 0 });
    run(idle, BASE, 1000);
    expect(tap(idle, BASE).accepted).toBe(false);
    expect(useSuper(idle, BASE).accepted).toBe(false);
  });
});
