/**
 * core/combat.ts — the idle auto-battle simulation. PURE logic, no DOM, no
 * `Date.now()`, no `Math.random()`. The UI drives it with elapsed milliseconds
 * and renders the effects it returns.
 *
 * DETERMINISM
 * -----------
 * Every random draw comes from a seeded mulberry32 PRNG carried inside the
 * battle state. Two things make a run reproducible:
 *   1. a FIXED timestep — `advance()` accumulates real time and only ever runs
 *      whole `BALANCE.combat.tickMs` ticks, so frame jitter cannot change the
 *      outcome; and
 *   2. a PER-WAVE seed — every spawn reseeds the PRNG with
 *      `waveSeed(baseSeed, world, wave, attempt)`, so one wave can be replayed
 *      (and unit-tested) in isolation, and a retry after a knock-out is not a
 *      byte-identical rerun of the fight you just lost.
 * The seed actually used is recorded in the `wave_cleared` event.
 *
 * EVENT GRANULARITY (important)
 * -----------------------------
 * Attack ticks are NOT events — they would flood the log with thousands of
 * entries per workout and are fully derivable from the seed anyway. The only
 * battle fact worth persisting is a CLEARED WAVE, which is emitted once, with
 * the seed, wave, coins and energy spent. That single event is enough for
 * `rebuildFromEvents` to reproduce world/wave/energy/coins exactly.
 *
 * ENERGY
 * ------
 * Energy is charged when a wave is CLEARED, never when it starts — so being
 * knocked out costs time, not the player's real workout. A wave can only start
 * when there is enough energy for it; at 0 the battle goes to `resting` and the
 * UI tells the player, in Hebrew, to go and train.
 */

import { BALANCE } from './balance.ts';
import {
  WORLD_COUNT,
  enemyForWave,
  worldBossOf,
  bossGateStatus,
  type BossDef,
  type EnemyDef,
  type GateStatus,
} from '../data/gameContent.ts';
import type { BodyPart } from '../data/program.ts';

/* --------------------------------------------------------------- the RNG */

/** Serializable PRNG state — a plain object so a battle can be snapshotted. */
export interface Rng {
  s: number;
}

/** Force any number into the uint32 range mulberry32 expects. */
function toSeed(n: number): number {
  return (Math.floor(n) >>> 0) || 0x9e3779b9;
}

export function makeRng(seed: number): Rng {
  return { s: toSeed(seed) };
}

/** mulberry32 — small, fast, good enough, and identical on every engine. */
export function nextFloat(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Mix any number of integers into one uint32 seed (FNV-ish, stable). */
export function hashSeed(...parts: readonly number[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    let v = Math.floor(p) >>> 0;
    for (let i = 0; i < 4; i += 1) {
      h = Math.imul(h ^ (v & 0xff), 16777619) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/** The seed of one wave attempt — this is the number stored in the event. */
export function waveSeed(baseSeed: number, world: number, wave: number, attempt: number): number {
  return hashSeed(toSeed(baseSeed), world, wave, attempt);
}

/* -------------------------------------------------------------- the stats */

export interface CombatStats {
  /** from chest */ atk: number;
  /** from back */ def: number;
  /** from legs */ maxHp: number;
  /** from shoulders — ms between auto attacks */ attackIntervalMs: number;
  /** from arms */ critChance: number;
  /** from arms */ critMultiplier: number;
  /** from core — hp per second */ regen: number;
}

/** Incoming-damage multiplier: `defK / (defK + DEF)` — soft cap, never zero. */
export function mitigation(def: number): number {
  const k = BALANCE.combat.defK;
  return k / (k + Math.max(0, def));
}

/** `value × (1 ± variance)`, one RNG draw. */
function varied(value: number, rng: Rng): number {
  const v = BALANCE.combat.damageVariance;
  return value * (1 + (nextFloat(rng) * 2 - 1) * v);
}

/* --------------------------------------------------------------- the waves */

export function isMiniBossWave(wave: number): boolean {
  const every = BALANCE.combat.miniBossEvery;
  return wave > 0 && wave % every === 0;
}

/**
 * True once a world's waves are exhausted — this is where the world boss waits.
 * Whether the fight actually STARTS additionally depends on the body-part gate
 * (`worldGate`) and on whether that boss has already fallen (see `bossStanding`).
 */
export function isWorldBossWave(wave: number): boolean {
  return wave > BALANCE.combat.wavesPerWorld;
}

/**
 * Is a world boss still standing at this wave?
 *
 * False either because the world still has ordinary waves left, or because the
 * boss is already a trophy — which only ever happens in the LAST world, where
 * `boss_defeated` keeps the player in place instead of promoting them. That is
 * the endless "champion" endgame: waves keep counting past 50 and keep scaling.
 */
export function bossStanding(world: number, wave: number, defeated: readonly string[]): boolean {
  if (!isWorldBossWave(wave)) return false;
  const boss = worldBossOf(world);
  return boss !== undefined && !defeated.includes(boss.id);
}

/** True once the final world's boss is down — world 4 becomes endless. */
export function isEndgame(defeated: readonly string[]): boolean {
  const last = worldBossOf(WORLD_COUNT);
  return last !== undefined && defeated.includes(last.id);
}

export interface BossSpec {
  world: number;
  wave: number;
  boss: BossDef;
  hp: number;
  atk: number;
  attackIntervalMs: number;
  coins: number;
  energyCost: number;
  /** Where the player lands after the kill (next world, or endless mode). */
  nextWorld: number;
  nextWave: number;
  /** True when this is the last world's boss. */
  endgame: boolean;
}

/**
 * Everything about a world-boss fight, derived from the world alone.
 *
 * The boss stands on the wave-scaling curve at `wavesPerWorld + 1` and then
 * multiplies it by its own `hpMult`/`atkMult`, so it is always meaningfully
 * bigger than the wave-50 enemy the player just beat.
 */
export function bossSpec(world: number): BossSpec | null {
  const boss = worldBossOf(world);
  if (!boss) return null;
  const c = BALANCE.combat;
  const e = c.enemy;
  const wave = c.wavesPerWorld + 1;
  const worldStep = Math.max(0, world - 1);
  const waveStep = wave - 1;

  const hp =
    e.hpBase * Math.pow(e.hpGrowth, waveStep) * Math.pow(e.worldHpMult, worldStep) * (boss.hpMult ?? 1);
  const atk =
    e.atkBase * Math.pow(e.atkGrowth, waveStep) * Math.pow(e.worldAtkMult, worldStep) * (boss.atkMult ?? 1);
  const endgame = world >= WORLD_COUNT;

  return {
    world,
    wave,
    boss,
    hp: Math.max(1, Math.round(hp)),
    atk: Math.max(1, Math.round(atk * 10) / 10),
    attackIntervalMs: c.boss.attackIntervalMs,
    coins: Math.round(c.boss.coinsBase * Math.pow(c.boss.coinsWorldMult, worldStep)),
    energyCost: c.boss.energyCost,
    // Beating the last boss does NOT reset progress: the player stays in world 4
    // and the waves simply keep going (and keep scaling) from here.
    nextWorld: endgame ? world : world + 1,
    nextWave: endgame ? wave : 1,
    endgame,
  };
}

export interface WaveSpec {
  world: number;
  wave: number;
  miniBoss: boolean;
  enemy: EnemyDef;
  hp: number;
  atk: number;
  attackIntervalMs: number;
  coins: number;
  energyCost: number;
}

/** Everything about a wave, derived from its number alone (no RNG). */
export function waveSpec(world: number, wave: number): WaveSpec {
  const c = BALANCE.combat;
  const e = c.enemy;
  const miniBoss = isMiniBossWave(wave);
  const enemy = enemyForWave(world, wave, miniBoss);
  const worldStep = Math.max(0, world - 1);
  const waveStep = Math.max(0, wave - 1);

  const hp =
    e.hpBase *
    Math.pow(e.hpGrowth, waveStep) *
    Math.pow(e.worldHpMult, worldStep) *
    (miniBoss ? e.miniBossHpMult : 1) *
    (enemy.hpMult ?? 1);
  const atk =
    e.atkBase *
    Math.pow(e.atkGrowth, waveStep) *
    Math.pow(e.worldAtkMult, worldStep) *
    (miniBoss ? e.miniBossAtkMult : 1) *
    (enemy.atkMult ?? 1);

  const coins = Math.round(
    (c.coins.base + c.coins.perWave * waveStep) *
      Math.pow(c.coins.worldMult, worldStep) *
      (miniBoss ? c.coins.miniBossMult : 1),
  );

  return {
    world,
    wave,
    miniBoss,
    enemy,
    hp: Math.max(1, Math.round(hp)),
    atk: Math.max(1, Math.round(atk * 10) / 10),
    attackIntervalMs: miniBoss ? e.miniBossAttackIntervalMs : e.attackIntervalMs,
    coins,
    energyCost: c.energyPerWave,
  };
}

/** The gate at the end of a world (Phase 3 fights it; Phase 2 reports it). */
export function worldGate(world: number, levels: Readonly<Record<BodyPart, number>>): GateStatus {
  return bossGateStatus(worldBossOf(world), levels);
}

/* -------------------------------------------------------------- the state */

export interface EnemyState {
  id: string;
  he: string;
  hp: number;
  maxHp: number;
  atk: number;
  attackIntervalMs: number;
  miniBoss: boolean;
  /** True while the world boss itself is on screen. */
  worldBoss: boolean;
  svg: string;
}

export type BattleStatus =
  /** between waves (spawn delay) */
  | 'idle'
  /** an enemy is up */
  | 'fighting'
  /** knocked out, getting back up */
  | 'recovering'
  /** out of energy — go train */
  | 'resting'
  /** the world boss is here but its body-part requirements are not met */
  | 'gated';

export interface BattleState {
  /** Base seed of this battle session; per-wave seeds derive from it. */
  seed: number;
  rng: Rng;
  world: number;
  wave: number;
  /** Attempt number of the CURRENT wave (grows on every knock-out). */
  attempt: number;
  /**
   * Whether the current world's boss gate is OPEN (all body-part requirements
   * met). The UI keeps this in sync with the character's levels — a level-up
   * mid-session unlocks the boss without a reload.
   */
  gateOpen: boolean;
  /** Ids of bosses already defeated — drives the endless endgame. */
  defeatedBosses: readonly string[];
  energy: number;
  playerHp: number;
  maxHp: number;
  enemy: EnemyState | null;
  /** 0..1 — full means the super move is ready. */
  superMeter: number;
  status: BattleStatus;
  /** Leftover time smaller than one tick, carried to the next `advance`. */
  acc: number;
  /** Simulated time since the battle started (ms) — drives the tap rate cap. */
  elapsedMs: number;
  playerCd: number;
  enemyCd: number;
  regenCd: number;
  spawnCd: number;
  lastTapMs: number;
  /** Session counters (display only — the log owns the persistent ones). */
  wavesCleared: number;
  coinsEarned: number;
  defeats: number;
  /** Defeats since the last cleared wave — drives the "go train" hint. */
  streakDefeats: number;
  waveElapsedMs: number;
}

/** The persistent record of one cleared wave — this becomes the event payload. */
export interface WaveResult {
  world: number;
  wave: number;
  miniBoss: boolean;
  enemyId: string;
  coins: number;
  energySpent: number;
  /** The exact seed the cleared attempt ran with. */
  seed: number;
  durationMs: number;
}

/** The persistent record of a world boss going down (the `boss_defeated` payload). */
export interface BossResult {
  world: number;
  wave: number;
  bossId: string;
  coins: number;
  energySpent: number;
  seed: number;
  durationMs: number;
  nextWorld: number;
  nextWave: number;
  endgame: boolean;
}

export type CombatEvent =
  | { kind: 'spawn'; enemy: EnemyState; spec: WaveSpec }
  | { kind: 'boss_spawn'; enemy: EnemyState; spec: BossSpec }
  | { kind: 'hit'; source: 'auto' | 'tap' | 'super'; amount: number; crit: boolean; enemyHp: number }
  | { kind: 'enemy_hit'; amount: number; playerHp: number }
  | { kind: 'regen'; amount: number; playerHp: number }
  | { kind: 'wave_cleared'; result: WaveResult }
  | { kind: 'boss_defeated'; result: BossResult }
  | { kind: 'defeat'; wave: number; streakDefeats: number }
  | { kind: 'super_ready' }
  | { kind: 'resting' }
  | { kind: 'gated'; world: number };

export interface CreateBattleArgs {
  seed: number;
  world: number;
  wave: number;
  energy: number;
  stats: CombatStats;
  /** Body-part gate of the current world's boss — defaults to closed. */
  gateOpen?: boolean;
  /** Bosses already defeated (from `game.battle.bossesDefeated`). */
  defeatedBosses?: readonly string[];
}

export function createBattle(a: CreateBattleArgs): BattleState {
  const world = Math.max(1, Math.floor(a.world));
  const wave = Math.max(1, Math.floor(a.wave));
  return {
    seed: toSeed(a.seed),
    rng: makeRng(waveSeed(a.seed, world, wave, 0)),
    world,
    wave,
    attempt: 0,
    gateOpen: a.gateOpen === true,
    defeatedBosses: [...(a.defeatedBosses ?? [])],
    energy: Math.max(0, a.energy),
    playerHp: a.stats.maxHp,
    maxHp: a.stats.maxHp,
    enemy: null,
    superMeter: 0,
    status: 'idle',
    acc: 0,
    elapsedMs: 0,
    playerCd: a.stats.attackIntervalMs,
    enemyCd: 0,
    regenCd: 0,
    spawnCd: 0,
    lastTapMs: -Infinity,
    wavesCleared: 0,
    coinsEarned: 0,
    defeats: 0,
    streakDefeats: 0,
    waveElapsedMs: 0,
  };
}

/**
 * Keep the state in sync with stats that changed under it (a level-up while the
 * tab is open, or the streak buff refreshing). Max HP grows without healing.
 */
export function syncStats(state: BattleState, stats: CombatStats): void {
  if (stats.maxHp !== state.maxHp) {
    const grew = stats.maxHp - state.maxHp;
    state.maxHp = stats.maxHp;
    if (grew > 0) state.playerHp = Math.min(state.maxHp, state.playerHp + grew);
    else state.playerHp = Math.min(state.playerHp, state.maxHp);
  }
}

/** Top the battle's energy up from the store (a set was logged in another tab). */
export function setEnergy(state: BattleState, energy: number): void {
  state.energy = Math.max(0, energy);
  if (state.status === 'resting' && state.energy >= BALANCE.combat.energyPerWave) {
    state.status = 'idle';
    state.spawnCd = 0;
  }
}

/**
 * Keep the boss gate in sync with the character's levels while the tab is open.
 * Opening the gate immediately releases a `gated` battle into the boss fight —
 * levelling up on the workout screen unlocks the boss without a reload.
 */
export function setGate(state: BattleState, gateOpen: boolean, defeated?: readonly string[]): void {
  state.gateOpen = gateOpen;
  if (defeated) state.defeatedBosses = [...defeated];
  if (state.status === 'gated' && (gateOpen || !bossStanding(state.world, state.wave, state.defeatedBosses))) {
    state.status = 'idle';
    state.spawnCd = 0;
  }
}

/* ------------------------------------------------------------- the engine */

/** Shared tail of both spawns: arm the timers and start the fight. */
function beginFight(state: BattleState, enemy: EnemyState): void {
  state.enemy = enemy;
  state.status = 'fighting';
  state.rng = makeRng(waveSeed(state.seed, state.world, state.wave, state.attempt));
  state.enemyCd = enemy.attackIntervalMs;
  state.regenCd = BALANCE.combat.regenIntervalMs;
  state.waveElapsedMs = 0;
}

function spawn(state: BattleState, out: CombatEvent[]): void {
  // The world boss stands where the ordinary waves end — unless it has already
  // fallen, in which case (last world only) the waves simply keep coming.
  if (bossStanding(state.world, state.wave, state.defeatedBosses)) {
    if (!state.gateOpen) {
      if (state.status !== 'gated') {
        state.status = 'gated';
        out.push({ kind: 'gated', world: state.world });
      }
      return;
    }
    const spec = bossSpec(state.world);
    if (!spec) return;
    if (state.energy < spec.energyCost) {
      if (state.status !== 'resting') {
        state.status = 'resting';
        out.push({ kind: 'resting' });
      }
      return;
    }
    beginFight(state, {
      id: spec.boss.id,
      he: spec.boss.he,
      hp: spec.hp,
      maxHp: spec.hp,
      atk: spec.atk,
      attackIntervalMs: spec.attackIntervalMs,
      miniBoss: false,
      worldBoss: true,
      svg: spec.boss.svg,
    });
    out.push({ kind: 'boss_spawn', enemy: state.enemy as EnemyState, spec });
    return;
  }

  if (state.energy < BALANCE.combat.energyPerWave) {
    if (state.status !== 'resting') {
      state.status = 'resting';
      out.push({ kind: 'resting' });
    }
    return;
  }

  const spec = waveSpec(state.world, state.wave);
  beginFight(state, {
    id: spec.enemy.id,
    he: spec.enemy.he,
    hp: spec.hp,
    maxHp: spec.hp,
    atk: spec.atk,
    attackIntervalMs: spec.attackIntervalMs,
    miniBoss: spec.miniBoss,
    worldBoss: false,
    svg: spec.enemy.svg,
  });
  out.push({ kind: 'spawn', enemy: state.enemy as EnemyState, spec });
}

function damageEnemy(
  state: BattleState,
  amount: number,
  source: 'auto' | 'tap' | 'super',
  crit: boolean,
  out: CombatEvent[],
): void {
  const enemy = state.enemy;
  if (!enemy) return;
  const dealt = Math.max(1, Math.round(amount * 10) / 10);
  enemy.hp = Math.max(0, Math.round((enemy.hp - dealt) * 10) / 10);
  out.push({ kind: 'hit', source, amount: dealt, crit, enemyHp: enemy.hp });
  if (enemy.hp <= 0) {
    if (enemy.worldBoss) killBoss(state, out);
    else clearWave(state, out);
  }
}

/**
 * The world boss went down: pay the purse, charge the (bigger) energy cost and
 * move the player on. In the last world "moving on" means STAYING — the wave
 * counter just keeps climbing, which is the endless champion endgame.
 */
function killBoss(state: BattleState, out: CombatEvent[]): void {
  const c = BALANCE.combat;
  const spec = bossSpec(state.world);
  if (!spec) return;
  const result: BossResult = {
    world: state.world,
    wave: state.wave,
    bossId: spec.boss.id,
    coins: spec.coins,
    energySpent: Math.min(state.energy, spec.energyCost),
    seed: waveSeed(state.seed, state.world, state.wave, state.attempt),
    durationMs: Math.round(state.waveElapsedMs),
    nextWorld: spec.nextWorld,
    nextWave: spec.nextWave,
    endgame: spec.endgame,
  };

  state.energy = Math.max(0, Math.round((state.energy - result.energySpent) * 100) / 100);
  state.coinsEarned += result.coins;
  state.streakDefeats = 0;
  state.enemy = null;
  state.attempt = 0;
  state.defeatedBosses = [...state.defeatedBosses, spec.boss.id];
  state.world = result.nextWorld;
  state.wave = result.nextWave;
  // A new world's gate is a different gate — the UI re-opens it if it is met.
  state.gateOpen = false;
  state.playerHp = state.maxHp;
  state.status = 'idle';
  state.spawnCd = c.spawnDelayMs * 3;
  out.push({ kind: 'boss_defeated', result });
}

function clearWave(state: BattleState, out: CombatEvent[]): void {
  const c = BALANCE.combat;
  const spec = waveSpec(state.world, state.wave);
  const result: WaveResult = {
    world: state.world,
    wave: state.wave,
    miniBoss: spec.miniBoss,
    enemyId: spec.enemy.id,
    coins: spec.coins,
    energySpent: Math.min(state.energy, spec.energyCost),
    seed: waveSeed(state.seed, state.world, state.wave, state.attempt),
    durationMs: Math.round(state.waveElapsedMs),
  };

  state.energy = Math.max(0, Math.round((state.energy - result.energySpent) * 100) / 100);
  state.coinsEarned += result.coins;
  state.wavesCleared += 1;
  state.streakDefeats = 0;
  state.enemy = null;
  state.attempt = 0;
  state.wave += 1;
  state.playerHp = Math.min(state.maxHp, state.playerHp + state.maxHp * c.healOnWaveClear);
  state.status = 'idle';
  state.spawnCd = c.spawnDelayMs;
  out.push({ kind: 'wave_cleared', result });
}

function knockOut(state: BattleState, out: CombatEvent[]): void {
  state.defeats += 1;
  state.streakDefeats += 1;
  state.attempt += 1;
  state.enemy = null;
  state.playerHp = 0;
  state.superMeter = 0;
  state.status = 'recovering';
  state.spawnCd = BALANCE.combat.recoverMs;
  out.push({ kind: 'defeat', wave: state.wave, streakDefeats: state.streakDefeats });
}

/** One fixed simulation tick. Order is fixed, which is half of determinism. */
function step(state: BattleState, dt: number, stats: CombatStats, out: CombatEvent[]): void {
  state.elapsedMs += dt;

  if (state.status === 'gated') return;

  if (state.status === 'resting') {
    if (state.energy >= BALANCE.combat.energyPerWave) {
      state.status = 'idle';
      state.spawnCd = 0;
    }
    return;
  }

  if (state.status === 'recovering') {
    state.spawnCd -= dt;
    if (state.spawnCd <= 0) {
      state.playerHp = state.maxHp;
      state.playerCd = stats.attackIntervalMs;
      state.status = 'idle';
      state.spawnCd = 0;
    }
    return;
  }

  if (state.status === 'idle') {
    state.spawnCd -= dt;
    if (state.spawnCd <= 0) spawn(state, out);
    // `spawn` mutates `status`; TS cannot see through the call.
    if ((state.status as BattleStatus) !== 'fighting') return;
  }

  const enemy = state.enemy;
  if (!enemy) return;
  state.waveElapsedMs += dt;

  // 1. regen (Core)
  state.regenCd -= dt;
  if (state.regenCd <= 0) {
    state.regenCd += BALANCE.combat.regenIntervalMs;
    if (state.playerHp < state.maxHp && stats.regen > 0) {
      const before = state.playerHp;
      state.playerHp = Math.min(state.maxHp, state.playerHp + stats.regen);
      out.push({
        kind: 'regen',
        amount: Math.round((state.playerHp - before) * 10) / 10,
        playerHp: state.playerHp,
      });
    }
  }

  // 2. the character attacks (Chest damage, Shoulders speed, Arms crit)
  state.playerCd -= dt;
  if (state.playerCd <= 0) {
    state.playerCd += Math.max(BALANCE.combat.tickMs, stats.attackIntervalMs);
    const raw = varied(stats.atk, state.rng);
    const crit = nextFloat(state.rng) < stats.critChance;
    damageEnemy(state, crit ? raw * stats.critMultiplier : raw, 'auto', crit, out);
    if (!state.enemy) return; // wave cleared by this hit
  }

  // 3. the enemy attacks back (reduced by Back/DEF, absorbed by Legs/HP)
  state.enemyCd -= dt;
  if (state.enemyCd <= 0) {
    state.enemyCd += enemy.attackIntervalMs;
    const dealt = Math.max(1, Math.round(varied(enemy.atk, state.rng) * mitigation(stats.def) * 10) / 10);
    state.playerHp = Math.max(0, Math.round((state.playerHp - dealt) * 10) / 10);
    out.push({ kind: 'enemy_hit', amount: dealt, playerHp: state.playerHp });
    if (state.playerHp <= 0) knockOut(state, out);
  }
}

/** A backgrounded tab must never "bank" time — cap the catch-up at 1s. */
const MAX_CATCHUP_MS = 1000;
const MAX_TICKS_PER_ADVANCE = 200;

/**
 * Advance the battle by `dtMs` of real time and return what happened.
 *
 * Only whole ticks are simulated; the remainder is carried in `state.acc`, so
 * the result depends on elapsed time and seed, never on the frame rate. A very
 * large `dtMs` (a backgrounded tab) is clamped — battles never run offline.
 */
export function advance(state: BattleState, dtMs: number, stats: CombatStats): CombatEvent[] {
  const out: CombatEvent[] = [];
  if (!(dtMs > 0)) return out;
  syncStats(state, stats);

  const tick = BALANCE.combat.tickMs;
  state.acc += Math.min(dtMs, MAX_CATCHUP_MS);
  let guard = 0;
  while (state.acc >= tick && guard < MAX_TICKS_PER_ADVANCE) {
    state.acc -= tick;
    guard += 1;
    step(state, tick, stats, out);
  }
  if (guard >= MAX_TICKS_PER_ADVANCE) state.acc = 0;
  return out;
}

/* ------------------------------------------------------------ tap & super */

export interface TapResult {
  events: CombatEvent[];
  /** False when the tap was ignored (rate cap, or nothing to hit). */
  accepted: boolean;
}

/**
 * A player tap on the enemy: a bonus hit plus super-meter charge.
 * Rate-capped in the CORE (not just the UI) so a macro cannot out-tap the cap.
 */
export function tap(state: BattleState, stats: CombatStats): TapResult {
  const out: CombatEvent[] = [];
  if (state.status !== 'fighting' || !state.enemy) return { events: out, accepted: false };
  if (state.elapsedMs - state.lastTapMs < BALANCE.combat.tap.minIntervalMs) {
    return { events: out, accepted: false };
  }
  state.lastTapMs = state.elapsedMs;

  const wasFull = state.superMeter >= 1;
  state.superMeter = Math.min(1, state.superMeter + BALANCE.combat.tap.superPerTap);
  if (!wasFull && state.superMeter >= 1) out.push({ kind: 'super_ready' });

  const raw = varied(stats.atk * BALANCE.combat.tap.damageFactor, state.rng);
  const crit = nextFloat(state.rng) < stats.critChance;
  damageEnemy(state, crit ? raw * stats.critMultiplier : raw, 'tap', crit, out);
  return { events: out, accepted: true };
}

export function superReady(state: BattleState): boolean {
  return state.superMeter >= 1;
}

/** Fire the charged super move — the big hit the screen shake belongs to. */
export function useSuper(state: BattleState, stats: CombatStats): TapResult {
  const out: CombatEvent[] = [];
  if (state.status !== 'fighting' || !state.enemy || !superReady(state)) {
    return { events: out, accepted: false };
  }
  state.superMeter = 0;
  const raw = varied(stats.atk * BALANCE.combat.tap.superDamageMult, state.rng);
  damageEnemy(state, raw, 'super', true, out);
  return { events: out, accepted: true };
}

/* ----------------------------------------------------------- test helpers */

export interface SimulationSummary {
  cleared: boolean;
  events: CombatEvent[];
  results: WaveResult[];
  bosses: BossResult[];
  elapsedMs: number;
  defeats: number;
  playerHp: number;
  status: BattleStatus;
}

/**
 * Run a battle forward in fixed steps until `waves` waves are cleared or the
 * time budget runs out. Used by the tests (and handy for balance spreadsheets).
 */
export function simulate(
  state: BattleState,
  stats: CombatStats,
  opts: { waves?: number; maxMs?: number; stepMs?: number } = {},
): SimulationSummary {
  const waves = opts.waves ?? 1;
  const maxMs = opts.maxMs ?? 10 * 60_000;
  const stepMs = opts.stepMs ?? BALANCE.combat.tickMs;
  const events: CombatEvent[] = [];
  const results: WaveResult[] = [];
  const bosses: BossResult[] = [];
  let elapsed = 0;

  while (elapsed < maxMs && results.length + bosses.length < waves) {
    for (const ev of advance(state, stepMs, stats)) {
      events.push(ev);
      if (ev.kind === 'wave_cleared') results.push(ev.result);
      else if (ev.kind === 'boss_defeated') bosses.push(ev.result);
    }
    elapsed += stepMs;
    if (state.status === 'resting' || state.status === 'gated') break;
  }

  return {
    cleared: results.length + bosses.length >= waves,
    events,
    results,
    bosses,
    elapsedMs: elapsed,
    defeats: state.defeats,
    playerHp: state.playerHp,
    status: state.status,
  };
}
