/**
 * core/combat.ts — battle loop, energy, waves, bosses. Pure logic, no DOM.
 *
 * PHASE 0 PLACEHOLDER — types only, no logic yet.
 * Phase 2 implements a DETERMINISTIC simulation: the RNG is seeded from a seed
 * stored in the event log, so a battle can be replayed and unit-tested exactly.
 */

export interface CombatStats {
  /** from chest */ atk: number;
  /** from back */ def: number;
  /** from legs */ maxHp: number;
  /** from shoulders — ms between auto attacks */ attackIntervalMs: number;
  /** from arms */ critChance: number;
  /** from arms */ critMultiplier: number;
  /** from core — hp per tick */ regen: number;
}

export interface EnemyState {
  id: string;
  hp: number;
  maxHp: number;
  atk: number;
}

export interface BattleState {
  seed: number;
  world: number;
  wave: number;
  energy: number;
  playerHp: number;
  enemy: EnemyState | null;
  superMeter: number;
}

// TODO(phase 2): createBattle(seed, stats), tick(state, dtMs), tapAttack(state),
// nextWave(state), isBossWave(wave), rng(seed) — all deterministic & pure.
export {};
