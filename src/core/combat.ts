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
 * SKILLS (Phase 4)
 * ----------------
 * Six active abilities, one per body part, unlocked at that part's level and
 * scaled by it. They are part of THIS state machine: `useSkill()` mutates the
 * same `BattleState`, cooldowns and buff windows count down on the same fixed
 * tick, and every random draw still comes from the same seeded stream. So a
 * replay of the same seed with the same activation TICKS is byte-identical.
 *
 * Nothing about them is persisted. Unlocks are derived from part levels (which
 * the event log already owns), and an activation is within-battle tactics —
 * exactly like a tap — so `wave_cleared` remains the only battle event and
 * there is nothing to migrate.
 *
 * CHALLENGE RUNS (Phase 7)
 * ------------------------
 * The daily challenge fights inside THIS state machine, in a separate CONTEXT:
 * `BattleState.challenge` holds the scripted gauntlet (`GauntletWave[]`, built
 * by `core/daily.ts`) and switches exactly three rules — the waves come from the
 * script, clearing one emits `challenge_wave` instead of `wave_cleared`, and a
 * knock-out ENDS the run. Taps, the super move, the six skills, the stats, the
 * fixed tick and the seeded RNG are all unchanged, which is why a challenge is
 * as reproducible as a campaign wave and needs no second engine.
 *
 * The run writes NOTHING per wave: its coins live in `ChallengeRun.coins` until
 * the run ends, and the single `daily_challenge` event carries the whole story.
 * That is what makes "abandoning a run leaks no coins" structural.
 *
 * GHOST DUELS (Phase 8) reuse that context unchanged — `kind: 'ghost'`, one
 * wave, `coins: 0` — and add exactly one thing to the machine: a gauntlet wave
 * MAY carry the defensive half of a character (`def` / `critChance` /
 * `critMultiplier` / `regen`), because the opponent is another player's
 * character rather than a monster. Every one of those fields is optional and
 * skipped when absent, and `mitigation(0)` is 1, so an ordinary fight is
 * byte-identical to what it always was — the RNG stream included, since the
 * enemy's crit draw only happens when it HAS a crit chance.
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
  SKILLS,
  SKILL_IDS,
  WORLD_COUNT,
  enemyForWave,
  skillById,
  worldBossOf,
  bossGateStatus,
  type BossDef,
  type EnemyDef,
  type GateStatus,
  type SkillDef,
  type SkillId,
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

/* -------------------------------------------------------------- the skills */

/** Body-part levels — the ONLY input a skill's unlock and power depend on. */
export type PartLevels = Readonly<Record<BodyPart, number>>;

function skillDef(skill: SkillDef | SkillId): SkillDef | undefined {
  return typeof skill === 'string' ? skillById(skill) : skill;
}

/** The level a part needs before its skill appears. Same for all six. */
export function skillUnlockLevel(): number {
  return BALANCE.skills.unlockLevel;
}

/**
 * Is this skill unlocked? DERIVED from the part level — there is no unlock flag
 * anywhere in the state, so nothing can drift and nothing needs migrating.
 */
export function skillUnlocked(skill: SkillDef | SkillId, levels: PartLevels): boolean {
  const def = skillDef(skill);
  if (!def) return false;
  return (levels[def.part] ?? 1) >= BALANCE.skills.unlockLevel;
}

/**
 * How hard the skill hits, as a multiplier on its tuned magnitude.
 *
 * `1` at the unlock level, `+powerPerLevel` for every part level above it, and
 * capped at `1 + powerMaxBonus`. Training the part therefore keeps paying long
 * after the unlock, without ever letting a skill outgrow the stats.
 */
export function skillPower(skill: SkillDef | SkillId, levels: PartLevels): number {
  const def = skillDef(skill);
  if (!def) return 1;
  const s = BALANCE.skills;
  const over = Math.max(0, (levels[def.part] ?? 1) - s.unlockLevel);
  return 1 + Math.min(s.powerMaxBonus, over * s.powerPerLevel);
}

/** Per-skill runtime: cooldowns and the resolved magnitude of every live buff. */
export interface SkillRuntime {
  /** ms of cooldown left per skill (0 = ready). */
  cd: Record<SkillId, number>;
  /** עמידת ברזל — ms left, and the incoming-damage multiplier it resolved to. */
  guardMs: number;
  guardTaken: number;
  /** סערת מהלומות — ms left, and the attack-interval factor it resolved to. */
  flurryMs: number;
  flurryFactor: number;
  /** נשימה עמוקה — ms left of the regen burst, and its regen multiplier. */
  breathMs: number;
  breathRegen: number;
  /** מכה מדויקת — crit-multiplier bonus armed for the next auto attack (0 = unarmed). */
  focusBonus: number;
  /** רעידת אדמה — ms of stun left. The delay itself is already on `enemyCd`. */
  stunMs: number;
}

export function emptySkillRuntime(): SkillRuntime {
  const cd = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) cd[id] = 0;
  return {
    cd,
    guardMs: 0,
    guardTaken: 1,
    flurryMs: 0,
    flurryFactor: 1,
    breathMs: 0,
    breathRegen: 1,
    focusBonus: 0,
    stunMs: 0,
  };
}

/** Everything the skill bar needs about one skill, right now. */
export interface SkillView {
  def: SkillDef;
  unlocked: boolean;
  /** Part level required, and the level the character actually has. */
  need: number;
  have: number;
  /** ms of cooldown left, and the same as a 0..1 fraction of the full cooldown. */
  cooldownMs: number;
  cooldownRatio: number;
  ready: boolean;
  /** ms left of this skill's buff window (0 when it has none, or it is over). */
  activeMs: number;
  power: number;
}

/** ms left of a skill's own buff window — 0 for the instant ones. */
function activeMsOf(state: BattleState, id: SkillId): number {
  const s = state.skills;
  switch (id) {
    case 'guard':
      return s.guardMs;
    case 'flurry':
      return s.flurryMs;
    case 'breath':
      return s.breathMs;
    case 'quake':
      return s.stunMs;
    case 'focus':
      return s.focusBonus > 0 ? 1 : 0;
    default:
      return 0;
  }
}

/** The six skills as the UI wants them — pure, so the bar has no rules of its own. */
export function skillViews(state: BattleState, levels: PartLevels): SkillView[] {
  return SKILLS.map((def) => {
    const full = BALANCE.skills[def.id].cooldownMs;
    const cooldownMs = state.skills.cd[def.id] ?? 0;
    const unlocked = skillUnlocked(def, levels);
    return {
      def,
      unlocked,
      need: BALANCE.skills.unlockLevel,
      have: levels[def.part] ?? 1,
      cooldownMs,
      cooldownRatio: full > 0 ? Math.min(1, Math.max(0, cooldownMs / full)) : 0,
      ready: unlocked && cooldownMs <= 0,
      activeMs: activeMsOf(state, def.id),
      power: skillPower(def, levels),
    };
  });
}

/**
 * The Hebrew sentence for a skill, with its numbers resolved at `power`.
 * Lives here (not in `data/`) because every number in it comes from BALANCE.
 */
export function skillSummaryHe(skill: SkillDef | SkillId, power = 1): string {
  const def = skillDef(skill);
  if (!def) return '';
  const B = BALANCE.skills;
  const secs = (ms: number): string => `${Math.round(ms / 100) / 10}`.replace(/\.0$/, '');
  switch (def.id) {
    case 'smash':
      return `נזק פי ${Math.round(B.smash.atkMult * power * 10) / 10} מההתקפה, מכה אחת.`;
    case 'guard': {
      const taken = Math.max(B.guard.minDamageTaken, 1 - (1 - B.guard.damageTaken) * power);
      return `${secs(B.guard.durationMs)} שניות של הגנה — הנזק הנכנס יורד ב־${Math.round((1 - taken) * 100)}%.`;
    }
    case 'quake':
      return `נזק פי ${Math.round(B.quake.atkMult * power * 10) / 10} ועצירת האויב ל־${secs(B.quake.stunMs * power)} שניות.`;
    case 'flurry':
      return `${secs(B.flurry.durationMs * power)} שניות של קצב התקפה כפול.`;
    case 'focus':
      return `ההתקפה הבאה קריטית מובטחת, עם +${Math.round(B.focus.critMultiplierBonus * power * 100)}% נזק קריטי.`;
    case 'breath':
      return `ריפוי מיידי של ${Math.round(B.breath.healPct * power * 100)}% מהחיים ועוד ${secs(B.breath.durationMs)} שניות של התאוששות מוגברת.`;
  }
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
  /**
   * A GHOST's defensive stats (see `GauntletWave`). Absent for every ordinary
   * enemy, and every rule below is skipped when they are — so nothing about an
   * ordinary fight changes, down to the order of the RNG draws.
   */
  def?: number;
  critChance?: number;
  critMultiplier?: number;
  regen?: number;
  /** True while another account's character is the opponent (drives the UI). */
  ghost?: boolean;
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
  | 'gated'
  /** a CHALLENGE run is over (cleared, knocked out or forfeited) — nothing more happens */
  | 'finished';

/* ------------------------------------------------------------- gauntlets */

/**
 * ONE wave of a scripted gauntlet — a battle that is not world progress.
 *
 * A gauntlet wave carries its own numbers (hp/atk/interval/coins) instead of
 * deriving them from `world`+`wave`, which is what makes a challenge run a pure
 * function of its own script: the caller builds the list (see `core/daily.ts`),
 * the state machine below only fights it. `world` is kept for the SPRITE and the
 * backdrop — it says which world the enemy is visiting from, nothing more.
 */
export interface GauntletWave {
  /** 1-based position in the gauntlet. */
  index: number;
  /** The world the enemy is drawn from (cosmetic: sprite + accent). */
  world: number;
  miniBoss: boolean;
  enemyId: string;
  he: string;
  svg: string;
  hp: number;
  atk: number;
  attackIntervalMs: number;
  /** Coins this wave pays when it is cleared. */
  coins: number;
  /**
   * THE DEFENSIVE HALF OF A CHARACTER — optional, and absent for every ordinary
   * enemy in the game (a monster is a hit-point bag with a fist).
   *
   * A GHOST (`core/ghost.ts`) is a person: it mitigates with its Back, crits
   * with its Arms and regenerates with its Core, because those are the stats its
   * owner trained. Each one is skipped entirely when it is absent or zero, and
   * `mitigation(0)` is exactly 1, so a wave without them is byte-for-byte the
   * fight it has always been — RNG stream included, which is what keeps every
   * existing determinism test true.
   */
  def?: number;
  critChance?: number;
  critMultiplier?: number;
  /** HP per second, paid on the same clock as the player's regen. */
  regen?: number;
}

/** How a challenge run ended. `running` means it has not. */
export type ChallengeOutcome = 'running' | 'complete' | 'defeated' | 'forfeit';

/**
 * A challenge run — the SEPARATE battle context.
 *
 * When this is present the state machine changes three rules and nothing else:
 *   1. waves come from `waves`, not from `waveSpec(world, wave)`;
 *   2. clearing one emits `challenge_wave`, **never** `wave_cleared` — the whole
 *      run is recorded by exactly ONE event, written when it ends;
 *   3. a knock-out ENDS the run (no retry, no recovery) — the score is whatever
 *      was cleared.
 * Energy is not touched here at all: the entry fee is charged once, by the
 * single event, which is also why no partial coins can ever leak.
 */
/**
 * The other side of a GHOST DUEL — display data, carried through the run so the
 * arena and the result can name it.
 *
 * Structural on purpose: `core/ghost.ts` builds it, and this module never
 * imports that one (the state machine has no idea what a ghost is beyond "a
 * gauntlet wave that hits back with real stats").
 */
export interface ChallengeOpponent {
  /** The handle that was looked up — half of the duel's ledger key. */
  handle: string;
  /** Display name (the handle in its canonical form). */
  name: string;
  /** Roster id (`'robot_f'`) — what the arena draws, mirrored. */
  characterId: string;
  level: number;
}

export interface ChallengeRun {
  /**
   * Which kind of gauntlet this is: the DAILY challenge (ten scripted waves) or
   * a GHOST duel (one wave that is another account's character). The engine
   * treats them identically; the kind only decides which event the caller
   * writes when the run ends, and how the screen frames it.
   */
  kind: 'daily' | 'ghost';
  /** Calendar date of the challenge (YYYY-MM-DD) — its idempotency key. */
  date: string;
  /** Seed the gauntlet was generated from — recorded in the event. */
  seed: number;
  waves: readonly GauntletWave[];
  /** 0-based index of the wave being fought (or about to spawn). */
  index: number;
  cleared: number;
  coins: number;
  /** ⚡ the attempt costs, carried here so the result can quote it. */
  energyCost: number;
  /** Coins added on top for clearing every wave. */
  completionBonus: number;
  /**
   * Coins paid when the run ended SHORT — the duel's "showing up pays something"
   * rule, expressed as data so the state machine still has no idea what a duel
   * is. Zero for the daily gauntlet, whose partial runs are already paid wave by
   * wave; a duel's single wave banks nothing, so its whole payout is this field
   * or `completionBonus`, never both.
   */
  consolationCoins: number;
  healOnWaveClear: number;
  spawnDelayMs: number;
  outcome: ChallengeOutcome;
  /** GHOST duels only: who is on the other side. */
  opponent?: ChallengeOpponent;
}

/** The persistent record of ONE challenge run — the `daily_challenge` payload. */
export interface ChallengeResult {
  kind: 'daily' | 'ghost';
  date: string;
  seed: number;
  /** Waves fully cleared, 0…`waves.length`. This IS the score. */
  wavesCleared: number;
  score: number;
  /** Tiebreak: remaining HP as a percentage (0 after a knock-out). */
  tiebreak: number;
  /** Wave coins + the completion bonus when every wave fell. */
  coins: number;
  energySpent: number;
  complete: boolean;
  outcome: Exclude<ChallengeOutcome, 'running'>;
  durationMs: number;
  /** GHOST duels only: the opponent, and whether the ghost went down. */
  opponent?: ChallengeOpponent;
  won?: boolean;
}

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
  /**
   * Skill cooldowns and live buff windows. IN-MEMORY ONLY: nothing persists a
   * `BattleState`, so this shape is free to change without a migration.
   */
  skills: SkillRuntime;
  /**
   * The CHALLENGE context, or `null` for an ordinary campaign battle. Its
   * presence is the one flag that switches the three rules documented on
   * `ChallengeRun` — everything else (taps, super, skills, stats, the fixed
   * tick, the seeded RNG) is byte-for-byte the same machine.
   */
  challenge: ChallengeRun | null;
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
  /** A gauntlet wave came up (the challenge's own spawn). */
  | { kind: 'challenge_spawn'; enemy: EnemyState; wave: GauntletWave; run: ChallengeRun }
  /** A gauntlet wave fell. NOT `wave_cleared` — nothing is written per wave. */
  | { kind: 'challenge_wave'; wave: GauntletWave; cleared: number; coins: number }
  /** The run is over — this carries the ONE fact that gets persisted. */
  | { kind: 'challenge_over'; result: ChallengeResult }
  | { kind: 'hit'; source: 'auto' | 'tap' | 'super' | 'skill'; amount: number; crit: boolean; enemyHp: number }
  /** `crit` is only ever set by a GHOST, which is the only enemy with crit stats. */
  | { kind: 'enemy_hit'; amount: number; playerHp: number; crit?: boolean }
  | { kind: 'regen'; amount: number; playerHp: number }
  /** A ghost healed itself from its own Core. Never fires for an ordinary enemy. */
  | { kind: 'enemy_regen'; amount: number; enemyHp: number }
  /** A skill went off. Not an event-log event — the UI's cue to play it. */
  | { kind: 'skill_used'; skillId: SkillId; part: BodyPart; power: number; durationMs: number }
  /** A timed skill window closed (the hero's buff chip comes off). */
  | { kind: 'skill_expired'; skillId: SkillId }
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
    skills: emptySkillRuntime(),
    challenge: null,
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

export interface CreateChallengeArgs {
  /** The gauntlet script — `dailyChallenge(date)` in `core/daily.ts` builds it. */
  run: Omit<ChallengeRun, 'index' | 'cleared' | 'coins' | 'outcome'>;
  stats: CombatStats;
  /**
   * The player's ⚡, for DISPLAY only: a challenge never spends energy per wave
   * and never rests, so nothing in the run reads this.
   */
  energy?: number;
}

/**
 * Start a CHALLENGE battle: the same state machine, a different context.
 *
 * The base seed is the challenge's own seed, so the whole run — every damage
 * roll of every wave — is a deterministic function of the date, exactly like the
 * roster it fights. No energy is passed in: the fee is charged once by the event
 * this run eventually writes, never wave by wave.
 */
export function createChallengeBattle(a: CreateChallengeArgs): BattleState {
  const first = a.run.waves[0];
  const state = createBattle({
    seed: a.run.seed,
    world: first?.world ?? 1,
    wave: 1,
    // Energy is not a per-wave resource here; the entry fee is paid by the event.
    energy: Math.max(0, a.energy ?? 0),
    stats: a.stats,
  });
  state.challenge = { ...a.run, index: 0, cleared: 0, coins: 0, outcome: 'running' };
  return state;
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

/* ------------------------------------------------------- challenge waves */

/**
 * Spawn the next gauntlet wave, or end the run when the script is exhausted.
 *
 * The per-wave seed is `waveSeed(challengeSeed, world, index, attempt)` with
 * `attempt` always 0 — there are no retries in a challenge — so wave N of a
 * given date is the same fight on every device that plays it.
 */
function spawnChallenge(state: BattleState, run: ChallengeRun, out: CombatEvent[]): void {
  const wave = run.waves[run.index];
  if (!wave) {
    finishChallenge(state, 'complete', out);
    return;
  }
  state.world = wave.world;
  state.wave = wave.index;
  beginFight(state, {
    id: wave.enemyId,
    he: wave.he,
    hp: wave.hp,
    maxHp: wave.hp,
    atk: wave.atk,
    attackIntervalMs: wave.attackIntervalMs,
    miniBoss: wave.miniBoss,
    worldBoss: false,
    svg: wave.svg,
    // A ghost carries the defensive half of a character; an ordinary gauntlet
    // wave carries none of it and behaves exactly as it always did.
    ...(wave.def === undefined ? {} : { def: wave.def }),
    ...(wave.critChance === undefined ? {} : { critChance: wave.critChance }),
    ...(wave.critMultiplier === undefined ? {} : { critMultiplier: wave.critMultiplier }),
    ...(wave.regen === undefined ? {} : { regen: wave.regen }),
    ...(run.kind === 'ghost' ? { ghost: true } : {}),
  });
  out.push({ kind: 'challenge_spawn', enemy: state.enemy as EnemyState, wave, run });
}

/**
 * One gauntlet wave fell: bank its coins IN MEMORY and move on.
 *
 * Nothing is persisted here — no `wave_cleared`, no energy, no coins in the
 * purse. The run's whole payout rides on the single `daily_challenge` /
 * `ghost_duel` event written when it ends, which is what makes "leaving mid-run
 * leaks no coins" a property of the design rather than of the UI.
 */
function clearChallengeWave(state: BattleState, run: ChallengeRun, out: CombatEvent[]): void {
  const wave = run.waves[run.index] as GauntletWave;
  run.cleared += 1;
  run.coins += wave.coins;
  run.index += 1;
  state.wavesCleared += 1;
  state.coinsEarned += wave.coins;
  state.streakDefeats = 0;
  state.enemy = null;
  state.attempt = 0;
  state.playerHp = Math.min(state.maxHp, state.playerHp + state.maxHp * run.healOnWaveClear);
  out.push({ kind: 'challenge_wave', wave, cleared: run.cleared, coins: wave.coins });

  if (run.index >= run.waves.length) {
    finishChallenge(state, 'complete', out);
    return;
  }
  state.status = 'idle';
  state.spawnCd = run.spawnDelayMs;
}

/**
 * End the run and emit the ONE record of it.
 *
 * Idempotent by construction: the first call parks the battle in `finished` and
 * every later call is a no-op, so a forfeit that races the finale cannot produce
 * two results (and therefore cannot pay twice).
 */
function finishChallenge(
  state: BattleState,
  outcome: Exclude<ChallengeOutcome, 'running'>,
  out: CombatEvent[],
): ChallengeResult | null {
  const run = state.challenge;
  if (!run || run.outcome !== 'running') return null;
  run.outcome = outcome;
  const complete = run.cleared >= run.waves.length;
  const result: ChallengeResult = {
    kind: run.kind,
    date: run.date,
    seed: run.seed,
    wavesCleared: run.cleared,
    score: run.cleared,
    // The tiebreak is the health the run ENDED on — 0 after a knock-out, which
    // is exactly the honest reading of "how comfortably did you get here".
    tiebreak: state.maxHp > 0 ? Math.round(Math.max(0, state.playerHp / state.maxHp) * 100) : 0,
    coins: run.coins + (complete ? run.completionBonus : run.consolationCoins),
    energySpent: run.energyCost,
    complete,
    outcome,
    durationMs: Math.round(state.elapsedMs),
    // A duel has exactly one wave, so "cleared every wave" IS "the ghost went
    // down" — there is no third outcome to invent.
    ...(run.opponent ? { opponent: run.opponent, won: complete } : {}),
  };
  state.enemy = null;
  state.status = 'finished';
  state.spawnCd = 0;
  out.push({ kind: 'challenge_over', result });
  return result;
}

/**
 * Give up the run that is on screen (the player left the arena).
 *
 * Returns the result to persist, or `null` when there is nothing to give up.
 * The caller writes it exactly like a finished run — the attempt is spent and
 * the waves that WERE cleared are paid; nothing else changes.
 */
export function forfeitChallenge(state: BattleState): ChallengeResult | null {
  const out: CombatEvent[] = [];
  return finishChallenge(state, 'forfeit', out);
}

/** The gauntlet wave on screen (or about to be), for the UI's counters. */
export function challengeWave(state: BattleState): GauntletWave | null {
  const run = state.challenge;
  if (!run) return null;
  return run.waves[Math.min(run.index, run.waves.length - 1)] ?? null;
}

function spawn(state: BattleState, out: CombatEvent[]): void {
  const run = state.challenge;
  if (run) {
    spawnChallenge(state, run, out);
    return;
  }
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
  source: 'auto' | 'tap' | 'super' | 'skill',
  crit: boolean,
  out: CombatEvent[],
): void {
  const enemy = state.enemy;
  if (!enemy) return;
  // The enemy's own DEF, on the same soft-cap curve the player's is on. It is 0
  // for every ordinary enemy and `mitigation(0)` is exactly 1, so this line
  // changes nothing outside a ghost duel.
  const dealt = Math.max(1, Math.round(amount * mitigation(enemy.def ?? 0) * 10) / 10);
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
  const run = state.challenge;
  if (run) {
    clearChallengeWave(state, run, out);
    return;
  }
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
  // In a CHALLENGE there is no getting back up: the run ends here and the score
  // is whatever was already cleared.
  if (state.challenge) {
    clearSkillBuffs(state, out);
    out.push({ kind: 'defeat', wave: state.wave, streakDefeats: state.streakDefeats });
    finishChallenge(state, 'defeated', out);
    return;
  }
  // The buffs die with the attempt; the COOLDOWNS keep running, so being knocked
  // out is never a way to refresh a skill.
  clearSkillBuffs(state, out);
  state.status = 'recovering';
  state.spawnCd = BALANCE.combat.recoverMs;
  out.push({ kind: 'defeat', wave: state.wave, streakDefeats: state.streakDefeats });
}

/**
 * Count the skill clocks down by one tick.
 *
 * Runs in EVERY status (even between waves and while resting), so a cooldown
 * that started in one wave is honestly spent by the time the next one spawns.
 * Buff windows only ever start inside a fight, so they can only run there.
 */
function tickSkills(state: BattleState, dt: number, out: CombatEvent[]): void {
  const s = state.skills;
  for (const id of SKILL_IDS) {
    if (s.cd[id] > 0) s.cd[id] = Math.max(0, s.cd[id] - dt);
  }
  if (s.guardMs > 0) {
    s.guardMs = Math.max(0, s.guardMs - dt);
    if (s.guardMs === 0) {
      s.guardTaken = 1;
      out.push({ kind: 'skill_expired', skillId: 'guard' });
    }
  }
  if (s.flurryMs > 0) {
    s.flurryMs = Math.max(0, s.flurryMs - dt);
    if (s.flurryMs === 0) {
      s.flurryFactor = 1;
      out.push({ kind: 'skill_expired', skillId: 'flurry' });
    }
  }
  if (s.breathMs > 0) {
    s.breathMs = Math.max(0, s.breathMs - dt);
    if (s.breathMs === 0) {
      s.breathRegen = 1;
      out.push({ kind: 'skill_expired', skillId: 'breath' });
    }
  }
  if (s.stunMs > 0) {
    s.stunMs = Math.max(0, s.stunMs - dt);
    if (s.stunMs === 0) out.push({ kind: 'skill_expired', skillId: 'quake' });
  }
}

/** Drop every live buff (a knock-out), leaving the cooldowns alone. */
function clearSkillBuffs(state: BattleState, out: CombatEvent[]): void {
  const s = state.skills;
  for (const id of ['guard', 'flurry', 'breath', 'quake'] as const) {
    if (activeMsOf(state, id) > 0) out.push({ kind: 'skill_expired', skillId: id });
  }
  if (s.focusBonus > 0) out.push({ kind: 'skill_expired', skillId: 'focus' });
  s.guardMs = 0;
  s.guardTaken = 1;
  s.flurryMs = 0;
  s.flurryFactor = 1;
  s.breathMs = 0;
  s.breathRegen = 1;
  s.focusBonus = 0;
  s.stunMs = 0;
}

/** One fixed simulation tick. Order is fixed, which is half of determinism. */
function step(state: BattleState, dt: number, stats: CombatStats, out: CombatEvent[]): void {
  state.elapsedMs += dt;
  tickSkills(state, dt, out);

  if (state.status === 'gated') return;
  // A finished challenge run is inert: the record is written, nothing may move.
  if (state.status === 'finished') return;

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

  // 1. regen (Core) — multiplied while נשימה עמוקה is burning.
  state.regenCd -= dt;
  if (state.regenCd <= 0) {
    state.regenCd += BALANCE.combat.regenIntervalMs;
    const regen = stats.regen * (state.skills.breathMs > 0 ? state.skills.breathRegen : 1);
    if (state.playerHp < state.maxHp && regen > 0) {
      const before = state.playerHp;
      state.playerHp = Math.min(state.maxHp, state.playerHp + regen);
      out.push({
        kind: 'regen',
        amount: Math.round((state.playerHp - before) * 10) / 10,
        playerHp: state.playerHp,
      });
    }
    // A GHOST recovers too, on the same clock and from its own Core. Nothing
    // happens for an ordinary enemy, which has no `regen` at all.
    const foeRegen = enemy.regen ?? 0;
    if (foeRegen > 0 && enemy.hp > 0 && enemy.hp < enemy.maxHp) {
      const before = enemy.hp;
      enemy.hp = Math.min(enemy.maxHp, Math.round((enemy.hp + foeRegen) * 10) / 10);
      out.push({
        kind: 'enemy_regen',
        amount: Math.round((enemy.hp - before) * 10) / 10,
        enemyHp: enemy.hp,
      });
    }
  }

  // 2. the character attacks (Chest damage, Shoulders speed, Arms crit).
  //    סערת מהלומות shortens the interval; מכה מדויקת forces the next crit —
  //    the crit DRAW still happens either way, so the RNG stream is unchanged.
  state.playerCd -= dt;
  if (state.playerCd <= 0) {
    const interval = stats.attackIntervalMs * (state.skills.flurryMs > 0 ? state.skills.flurryFactor : 1);
    state.playerCd += Math.max(BALANCE.combat.tickMs, interval);
    const raw = varied(stats.atk, state.rng);
    const rolled = nextFloat(state.rng) < stats.critChance;
    const focus = state.skills.focusBonus;
    const crit = rolled || focus > 0;
    const critMult = stats.critMultiplier + (focus > 0 ? focus : 0);
    if (focus > 0) {
      state.skills.focusBonus = 0;
      out.push({ kind: 'skill_expired', skillId: 'focus' });
    }
    damageEnemy(state, crit ? raw * critMult : raw, 'auto', crit, out);
    if (!state.enemy) return; // wave cleared by this hit
  }

  // 3. the enemy attacks back (reduced by Back/DEF, absorbed by Legs/HP, and cut
  //    further while עמידת ברזל holds).
  state.enemyCd -= dt;
  if (state.enemyCd <= 0) {
    state.enemyCd += enemy.attackIntervalMs;
    const guard = state.skills.guardMs > 0 ? state.skills.guardTaken : 1;
    let raw = varied(enemy.atk, state.rng);
    // A GHOST crits with the Arms its owner trained. The draw is INSIDE the
    // guard, so an enemy without a crit chance takes no number out of the
    // stream and every existing seed replays exactly as before.
    let crit = false;
    const foeCrit = enemy.critChance ?? 0;
    if (foeCrit > 0) {
      crit = nextFloat(state.rng) < foeCrit;
      if (crit) raw *= enemy.critMultiplier ?? 1;
    }
    const dealt = Math.max(1, Math.round(raw * mitigation(stats.def) * guard * 10) / 10);
    state.playerHp = Math.max(0, Math.round((state.playerHp - dealt) * 10) / 10);
    out.push({ kind: 'enemy_hit', amount: dealt, playerHp: state.playerHp, ...(crit ? { crit } : {}) });
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

/* ---------------------------------------------------------------- skills */

/** Why a skill activation was refused — the UI turns this into Hebrew. */
export type SkillRefusal = 'unknown' | 'locked' | 'cooldown' | 'idle';

export interface SkillResult {
  events: CombatEvent[];
  accepted: boolean;
  /** Only set when `accepted` is false. */
  reason?: SkillRefusal;
}

/**
 * Fire a body-part skill.
 *
 * Everything it needs is passed in: the stats it scales off, and the part levels
 * that decide whether it is unlocked at all and how hard it lands. The MAGNITUDE
 * is resolved here, at activation, and stored in the state — so the tick loop
 * never needs to know about levels and a level-up mid-buff cannot retroactively
 * change a window that is already running.
 *
 * A locked skill is a NO-OP: no cooldown is started, no RNG is drawn, nothing in
 * the state moves. Same for one that is still cooling down, or one fired while
 * there is no enemy on screen.
 */
export function useSkill(
  state: BattleState,
  skillId: SkillId,
  stats: CombatStats,
  levels: PartLevels,
): SkillResult {
  const out: CombatEvent[] = [];
  const def = skillById(skillId);
  if (!def) return { events: out, accepted: false, reason: 'unknown' };
  if (!skillUnlocked(def, levels)) return { events: out, accepted: false, reason: 'locked' };
  if (state.status !== 'fighting' || !state.enemy) return { events: out, accepted: false, reason: 'idle' };
  if ((state.skills.cd[skillId] ?? 0) > 0) return { events: out, accepted: false, reason: 'cooldown' };

  const B = BALANCE.skills;
  const s = state.skills;
  const power = skillPower(def, levels);
  s.cd[skillId] = B[skillId].cooldownMs;

  // The duration is known before the effect lands, so the UI gets one event it
  // can hang both the flash AND the buff chip on.
  const durationMs =
    skillId === 'guard'
      ? B.guard.durationMs
      : skillId === 'flurry'
        ? Math.round(B.flurry.durationMs * power)
        : skillId === 'breath'
          ? B.breath.durationMs
          : skillId === 'quake'
            ? Math.round(B.quake.stunMs * power)
            : 0;
  out.push({ kind: 'skill_used', skillId, part: def.part, power, durationMs });

  switch (skillId) {
    case 'smash':
      damageEnemy(state, varied(stats.atk * B.smash.atkMult * power, state.rng), 'skill', true, out);
      break;

    case 'guard':
      s.guardMs = durationMs;
      s.guardTaken = Math.max(B.guard.minDamageTaken, 1 - (1 - B.guard.damageTaken) * power);
      break;

    case 'quake': {
      // The stun IS the enemy's swing pushed back: its cooldown gains the whole
      // window, and `stunMs` counts the same window down for the UI.
      s.stunMs = durationMs;
      state.enemyCd += durationMs;
      damageEnemy(state, varied(stats.atk * B.quake.atkMult * power, state.rng), 'skill', false, out);
      break;
    }

    case 'flurry':
      s.flurryMs = durationMs;
      s.flurryFactor = B.flurry.intervalFactor;
      // Shorten the swing already in flight too, or the first "faster" attack
      // would still arrive at the old pace.
      state.playerCd = Math.max(0, state.playerCd * s.flurryFactor);
      break;

    case 'focus':
      s.focusBonus = B.focus.critMultiplierBonus * power;
      break;

    case 'breath': {
      s.breathMs = durationMs;
      s.breathRegen = B.breath.regenMult;
      const before = state.playerHp;
      state.playerHp = Math.min(state.maxHp, state.playerHp + state.maxHp * B.breath.healPct * power);
      out.push({
        kind: 'regen',
        amount: Math.round((state.playerHp - before) * 10) / 10,
        playerHp: state.playerHp,
      });
      break;
    }
  }

  return { events: out, accepted: true };
}

/* ----------------------------------------------------------- test helpers */

export interface SimulationSummary {
  cleared: boolean;
  events: CombatEvent[];
  results: WaveResult[];
  bosses: BossResult[];
  /** Gauntlet waves cleared, and the run's record once it ended (challenge only). */
  challengeWaves: number;
  challenge: ChallengeResult | null;
  elapsedMs: number;
  defeats: number;
  playerHp: number;
  status: BattleStatus;
}

/**
 * An auto-pilot for the simulation: fire these skills the moment they are ready.
 *
 * The order is fixed (the roster order) and the attempt happens once per step,
 * so a simulated run with skills is exactly as reproducible as one without —
 * which is what lets the balance tests compare the two.
 */
export interface SkillPilot {
  levels: PartLevels;
  /** Defaults to all six. */
  ids?: readonly SkillId[];
}

/**
 * Run a battle forward in fixed steps until `waves` waves are cleared or the
 * time budget runs out. Used by the tests (and handy for balance spreadsheets).
 */
export function simulate(
  state: BattleState,
  stats: CombatStats,
  opts: { waves?: number; maxMs?: number; stepMs?: number; pilot?: SkillPilot } = {},
): SimulationSummary {
  const waves = opts.waves ?? 1;
  const maxMs = opts.maxMs ?? 10 * 60_000;
  const stepMs = opts.stepMs ?? BALANCE.combat.tickMs;
  const pilotIds = opts.pilot ? (opts.pilot.ids ?? SKILL_IDS) : [];
  const events: CombatEvent[] = [];
  const results: WaveResult[] = [];
  const bosses: BossResult[] = [];
  let challengeWaves = 0;
  let challenge: ChallengeResult | null = null;
  let elapsed = 0;

  const collect = (ev: CombatEvent): void => {
    events.push(ev);
    if (ev.kind === 'wave_cleared') results.push(ev.result);
    else if (ev.kind === 'boss_defeated') bosses.push(ev.result);
    else if (ev.kind === 'challenge_wave') challengeWaves += 1;
    else if (ev.kind === 'challenge_over') challenge = ev.result;
  };

  while (elapsed < maxMs && results.length + bosses.length + challengeWaves < waves) {
    if (opts.pilot) {
      for (const id of pilotIds) {
        for (const ev of useSkill(state, id, stats, opts.pilot.levels).events) collect(ev);
      }
    }
    for (const ev of advance(state, stepMs, stats)) collect(ev);
    elapsed += stepMs;
    if (state.status === 'resting' || state.status === 'gated' || state.status === 'finished') break;
  }

  return {
    cleared: results.length + bosses.length + challengeWaves >= waves,
    events,
    results,
    bosses,
    challengeWaves,
    challenge,
    elapsedMs: elapsed,
    defeats: state.defeats,
    playerHp: state.playerHp,
    status: state.status,
  };
}
