/**
 * tests/helpers/trainee.ts — A SIMULATED TRAINEE, driven through the real
 * write path, for the pacing tests.
 *
 * Every pacing number the README publishes is measured here rather than
 * estimated: the trainee logs every set of every exercise of the plan's day
 * through `onSetCompleted` (the same call the workout screen makes), finishes
 * the day through `onWorkoutFinished`, and the levels and energy that come out
 * are whatever the reducer says. Two plans are simulated, because the two poles
 * of the journey (energy vs. levels) move differently on different splits:
 *
 *   builtin — the A/B/C hypertrophy split, 3×/week (Sun/Tue/Thu);
 *   ab4     — the "תוכנית A/B — 4 ימים" preset, 4×/week (Sun+Wed / Tue / Thu),
 *             which is chest-light and back-heavy, so it earns ⚡ faster than the
 *             built-in split and levels its chest slower.
 *
 * The weight rises 2.5 kg every third session of an exercise, so personal
 * records land at a realistic rate (about one per exercise per week) rather
 * than on every set or never.
 */
import { BALANCE } from '../../src/core/balance.ts';
import {
  advance,
  createBattle,
  superReady,
  tap,
  useSkill,
  useSuper,
  worldGate,
  type BattleState,
  type CombatStats,
} from '../../src/core/combat.ts';
import { gameOf, onSetCompleted, onWorkoutFinished } from '../../src/core/game.ts';
import { upgradeMultiplier } from '../../src/core/upgrades.ts';
import { deriveStats, emptyGame } from '../../src/core/xp.ts';
import {
  EQUIPMENT_SLOTS,
  WORLDS,
  equipmentById,
  sumEquipBonus,
  worldBossOf,
} from '../../src/data/gameContent.ts';
import { PLAN_PRESETS } from '../../src/data/presets.ts';
import { BODY_PARTS, PROGRAM, findExercise, type BodyPart, type Exercise } from '../../src/data/program.ts';
import { SKILL_IDS } from '../../src/data/gameContent.ts';
import { LocalStore } from '../../src/storage/LocalStore.ts';
import type { StorageLike } from '../../src/storage/migrate.ts';

export type PartLevels = Record<BodyPart, number>;

export interface PlanDay {
  key: string;
  /** JS weekdays (0 = Sunday) the day is trained on. */
  weekdays: readonly number[];
  exercises: ReadonlyArray<{ ex: Exercise; sets: number }>;
}

export type PlanId = 'builtin' | 'ab4';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** The plan's days, as the simulation trains them. */
export function planDays(plan: PlanId): PlanDay[] {
  if (plan === 'builtin') {
    const weekdays: Record<'A' | 'B' | 'C', number[]> = { A: [0], B: [2], C: [4] };
    return (['A', 'B', 'C'] as const).map((k) => ({
      key: k,
      weekdays: weekdays[k],
      exercises: PROGRAM[k].exercises.map((e) => ({ ex: e, sets: e.sets })),
    }));
  }
  const preset = PLAN_PRESETS.find((p) => p.id === 'ab4');
  if (!preset) throw new Error('the ab4 preset is gone');
  const doc = preset.build();
  return doc.days.map((d) => ({
    key: d.key,
    weekdays: d.weekdays ?? [],
    exercises: d.exercises.map((row) => {
      const ex = findExercise(row.id);
      if (!ex) throw new Error(`ab4 preset names an unknown exercise ${row.id}`);
      return { ex, sets: row.sets };
    }),
  }));
}

export interface TraineeRun {
  plan: PlanId;
  /** Body-part levels after workout `i + 1`. */
  levelsAt: PartLevels[];
  /** Cumulative ⚡ earned after workout `i + 1`. */
  energyAt: number[];
}

/**
 * Train `workouts` workouts on a plan, from a fresh account, and record the
 * levels and the energy after each one. ≈5 s for 90 workouts.
 */
export function trainee(plan: PlanId, workouts = 90): TraineeRun {
  const days = planDays(plan);
  const store = new LocalStore(fakeStorage());
  const sessions: Record<string, number> = {};
  const levelsAt: PartLevels[] = [];
  const energyAt: number[] = [];
  let done = 0;
  let energy = 0;
  const start = Date.parse('2025-01-05T10:00:00Z'); // a Sunday
  for (let dayIdx = 0; dayIdx < 700 && done < workouts; dayIdx += 1) {
    const ts = start + dayIdx * 86_400_000;
    const now = new Date(ts);
    const date = now.toISOString().slice(0, 10);
    const day = days.find((d) => d.weekdays.includes(now.getUTCDay()));
    if (!day) continue;
    for (const { ex, sets } of day.exercises) {
      const n = (sessions[ex.id] = (sessions[ex.id] ?? 0) + 1);
      const w = String(40 + Math.floor(n / 3) * 2.5);
      for (let i = 0; i < sets; i += 1) {
        energy += onSetCompleted(store, { date, day: day.key, ex, setIndex: i, w, r: '10' }, now).energy;
      }
    }
    store.append('workout_finished', { date, day: day.key });
    energy += onWorkoutFinished(store, { date, day: day.key }, now).energy;
    done += 1;
    const g = gameOf(store);
    const levels = {} as PartLevels;
    for (const p of BODY_PARTS) levels[p] = g.parts[p].level;
    levelsAt.push(levels);
    energyAt.push(energy);
  }
  return { plan, levelsAt, energyAt };
}

/** ⚡ a world costs in full: every wave plus the boss. */
export function worldEnergyCost(world: number): number {
  const w = WORLDS.find((x) => x.id === world);
  if (!w) return 0;
  return w.waves * BALANCE.combat.energyPerWave + BALANCE.combat.boss.energyCost;
}

/**
 * THE ENERGY POLE of a world: the first workout after which the trainee has
 * earned enough ⚡ to have cleared every wave up to and including this world.
 * `Infinity` when the run never gets there.
 */
export function wavesRunOut(run: TraineeRun, world: number): number {
  let need = 0;
  for (let w = 1; w <= world; w += 1) need += worldEnergyCost(w);
  const i = run.energyAt.findIndex((e) => e >= need);
  return i < 0 ? Infinity : i + 1;
}

/** THE GATE POLE: the first workout after which the world's boss gate is open. */
export function gateOpens(run: TraineeRun, world: number): number {
  const i = run.levelsAt.findIndex((levels) => !worldGate(world, levels).locked);
  return i < 0 ? Infinity : i + 1;
}

/**
 * The levels the trainee has when they STAND AT the boss: the later of the two
 * poles (waves gone AND gate open). Falls back to the last workout simulated.
 */
export function levelsAtBoss(run: TraineeRun, world: number): PartLevels {
  const at = Math.max(wavesRunOut(run, world), gateOpens(run, world));
  const i = Number.isFinite(at) ? Math.min(at, run.levelsAt.length) - 1 : run.levelsAt.length - 1;
  return run.levelsAt[i] as PartLevels;
}

/** Every part shifted by `delta` levels (floored at 1). */
export function shiftLevels(levels: PartLevels, delta: number): PartLevels {
  const out = {} as PartLevels;
  for (const p of BODY_PARTS) out[p] = Math.max(1, levels[p] + delta);
  return out;
}

export type Gear = readonly [tier: 0 | 1 | 2 | 3, upgrade: 0 | 1 | 2 | 3];

/**
 * THE ERA LADDER — which shop kit a player plausibly wears when they reach each
 * world's boss, as `[tier, upgradeLevel]`, every slot at that tier. Derived from
 * the coin economy: every world's purse comfortably funds the next rung, so this
 * is "spent your winnings", not "ground for gear".
 */
export const ERA_GEAR: Readonly<Record<number, Gear>> = {
  1: [0, 0],
  2: [1, 0],
  3: [1, 1],
  4: [2, 0],
  5: [2, 2],
  6: [3, 0],
  7: [3, 1],
  8: [3, 2],
  9: [3, 3],
  10: [3, 3],
  11: [3, 3],
};

/** Combat stats of a character at these levels in this kit (no streak buff). */
export function statsFor(levels: PartLevels, gear: Gear = [0, 0]): CombatStats {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = levels[p];
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

export interface FightSummary {
  /** Waves (or bosses) cleared. */
  cleared: number;
  ms: number;
  defeats: number;
}

/**
 * Drive a battle the way an ENGAGED player does — auto attacks, taps, the super
 * on cooldown and all six skills the moment they are ready. The campaign is
 * tuned for this; a pure-idle run is the conservative floor the daily-challenge
 * tests use instead.
 */
export function playActively(
  state: BattleState,
  stats: CombatStats,
  levels: PartLevels,
  waves: number,
  maxMs = 400_000,
): FightSummary {
  const tick = BALANCE.combat.tickMs;
  let cleared = 0;
  let sinceTap = 0;
  let ms = 0;
  const count = (events: ReadonlyArray<{ kind: string }>): void => {
    for (const ev of events) if (ev.kind === 'wave_cleared' || ev.kind === 'boss_defeated') cleared += 1;
  };
  while (ms < maxMs && cleared < waves) {
    for (const id of SKILL_IDS) count(useSkill(state, id, stats, levels).events);
    count(advance(state, tick, stats));
    ms += tick;
    sinceTap += tick;
    if (state.status === 'fighting') {
      if (superReady(state)) count(useSuper(state, stats).events);
      if (sinceTap >= BALANCE.combat.tap.minIntervalMs * 1.5) {
        sinceTap = 0;
        count(tap(state, stats).events);
      }
    }
    if (state.status === 'resting') break;
  }
  return { cleared, ms, defeats: state.defeats };
}

/** The world's last `n` ORDINARY waves (the final mini-boss excluded). */
export function fightLateWaves(world: number, levels: PartLevels, gear: Gear, n = 5): FightSummary {
  const w = WORLDS.find((x) => x.id === world);
  if (!w) throw new Error(`no world ${world}`);
  const stats = statsFor(levels, gear);
  const state = createBattle({ seed: 424_242, world, wave: w.waves - n, energy: 100_000, stats });
  return playActively(state, stats, levels, n);
}

/** The world's FINAL wave — its last mini-boss, the top of the ramp. */
export function fightFinalWave(world: number, levels: PartLevels, gear: Gear, maxMs = 300_000): FightSummary {
  const w = WORLDS.find((x) => x.id === world);
  if (!w) throw new Error(`no world ${world}`);
  const stats = statsFor(levels, gear);
  const state = createBattle({ seed: 424_242, world, wave: w.waves, energy: 100_000, stats });
  return playActively(state, stats, levels, 1, maxMs);
}

/** The world boss, button already pressed — strengthened by `deficit` when given (the EARLY challenge). */
export function fightBoss(
  world: number,
  levels: PartLevels,
  gear: Gear,
  maxMs = 600_000,
  deficit = 0,
): FightSummary {
  const w = WORLDS.find((x) => x.id === world);
  if (!w || !worldBossOf(world)) throw new Error(`no boss for world ${world}`);
  const stats = statsFor(levels, gear);
  const state = createBattle({
    seed: 7,
    world,
    wave: w.waves + 1,
    energy: 100_000,
    stats,
    gateOpen: deficit <= 0,
    gateDeficit: deficit,
    bossRequested: true,
  });
  return playActively(state, stats, levels, 1, maxMs);
}
