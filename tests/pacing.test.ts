/**
 * THE TWO POLES OF THE JOURNEY, measured against the real engine.
 *
 * A world ends twice: when its waves run out of ⚡ (the ENERGY pole) and when
 * its boss gate opens (the LEVEL pole). Both are paid by the same workouts, and
 * the whole point of the PHASE 11 retune is that they land TOGETHER: a player
 * who has just spent the last of a world's waves should find the boss open, or
 * a workout or two away — never a month of reward-less sparring away.
 *
 * Everything here is driven through the real write path by a simulated trainee
 * (`tests/helpers/trainee.ts`) on the two shipped plans, so the numbers the
 * README publishes are measured, not estimated. If a future change to XP, ⚡,
 * wave counts, spans, gates or gear moves either pole, this file is what says so.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { bossSpec, waveSpec, worldGate } from '../src/core/combat.ts';
import { WORLDS, WORLD_COUNT, worldBossOf } from '../src/data/gameContent.ts';
import { BODY_PARTS, type BodyPart } from '../src/data/program.ts';
import {
  ERA_GEAR,
  fightBoss,
  fightFinalWave,
  fightLateWaves,
  gateOpens,
  levelsAtBoss,
  shiftLevels,
  trainee,
  wavesRunOut,
  type PartLevels,
  type PlanId,
  type TraineeRun,
} from './helpers/trainee.ts';

const PLANS: readonly PlanId[] = ['builtin', 'ab4'];
const runs: Record<PlanId, TraineeRun> = {
  builtin: trainee('builtin'),
  ab4: trainee('ab4'),
};

describe('the two poles land together', () => {
  it('opens every boss gate no later than three workouts after its waves run out, on both plans', () => {
    for (const plan of PLANS) {
      const run = runs[plan];
      for (const w of WORLDS) {
        const energy = wavesRunOut(run, w.id);
        const gate = gateOpens(run, w.id);
        expect(Number.isFinite(energy), `${plan}: world ${w.id} never runs out of waves`).toBe(true);
        expect(Number.isFinite(gate), `${plan}: world ${w.id} never opens`).toBe(true);
        // The gate may open a little EARLY (the ramp of the waves is then the
        // pacer, which is what it is for) but never long after the waves are gone.
        expect(gate - energy, `${plan}: world ${w.id} gate opens ${gate - energy} workouts after the waves`).toBeLessThanOrEqual(3);
        expect(gate - energy, `${plan}: world ${w.id} gate opens far too early`).toBeGreaterThanOrEqual(-6);
      }
    }
  });

  it('keeps the campaign inside a season of training, and energy as the floor', () => {
    // ≈53 workouts of ⚡ on the built-in split (3×/week → four months), less on a
    // split that logs more sets. The energy pole is the floor nobody can dig
    // under with a strong character: every wave still costs ⚡.
    const total = WORLDS.reduce(
      (sum, w) => sum + w.waves * BALANCE.combat.energyPerWave + BALANCE.combat.boss.energyCost,
      0,
    );
    expect(total / 225).toBeGreaterThan(45);
    expect(total / 225).toBeLessThan(60);
    expect(wavesRunOut(runs.builtin, WORLD_COUNT)).toBeGreaterThan(45);
    expect(wavesRunOut(runs.builtin, WORLD_COUNT)).toBeLessThan(60);
    expect(wavesRunOut(runs.ab4, WORLD_COUNT)).toBeGreaterThan(30);
  });

  it('asks every gate for levels a trainee on either plan actually has by then', () => {
    // No gate may ask a part for more than that part reaches on the SLOWER plan
    // for that part within three workouts of the energy pole — the chest-light
    // ab4 split is what makes this a real constraint.
    for (const w of WORLDS) {
      const boss = worldBossOf(w.id);
      for (const plan of PLANS) {
        const run = runs[plan];
        const at = Math.min(run.levelsAt.length, wavesRunOut(run, w.id) + 3);
        const have = run.levelsAt[at - 1];
        for (const [part, need] of Object.entries(boss?.requires ?? {})) {
          expect(have?.[part as keyof typeof have] ?? 0, `${plan}: world ${w.id} wants ${part} ${need}`).toBeGreaterThanOrEqual(need as number);
        }
      }
    }
  });
});

describe('the ramp is the pacer', () => {
  // Measured at the levels a trainee has when they STAND at the boss — the
  // later of the two poles — in that era's gear, playing actively with skills.
  it('lets a player at the boss clear the last ordinary waves briskly and the final wave cleanly', () => {
    for (const plan of PLANS) {
      for (const w of WORLDS) {
        // World 1 is the deliberate exception: its final mini-boss is the
        // game's first "go and train" wall, met a workout or two after its
        // gate opens (the gate asks for three parts at level 3; the wave wants
        // the whole body there). Measured two workouts past the boss instead.
        const run = runs[plan];
        const levels =
          w.id === 1
            ? (run.levelsAt[Math.max(wavesRunOut(run, 1), gateOpens(run, 1)) + 1] ?? levelsAtBoss(run, 1))
            : levelsAtBoss(run, w.id);
        const gear = ERA_GEAR[w.id] as (typeof ERA_GEAR)[number];
        const late = fightLateWaves(w.id, levels, gear);
        expect(late.cleared, `${plan}: world ${w.id} late waves stall`).toBe(5);
        expect(late.ms / 5, `${plan}: world ${w.id} late waves are a slog`).toBeLessThan(30_000);
        expect(late.defeats, `${plan}: world ${w.id} late waves are a wall`).toBeLessThanOrEqual(1);
        const final = fightFinalWave(w.id, levels, gear);
        expect(final.cleared, `${plan}: world ${w.id} final wave stalls`).toBe(1);
        expect(final.ms, `${plan}: world ${w.id} final wave is a slog`).toBeLessThan(90_000);
        expect(final.defeats, `${plan}: world ${w.id} final wave is a wall`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('makes the final wave a real test two levels lower — the ramp, not the gate, sends you to the gym', () => {
    // For a character two levels short on every part the final mini-boss is an
    // outright wall in the first five worlds (knocked out, or three defeats
    // before it falls). In the tier-3 late game the kit deliberately carries
    // more of the power curve than a couple of levels do (see the ERA ladder),
    // so the test there is three levels short and TIME: at least a fifth
    // longer, or a wall.
    // The LAST world is exempt: after its boss it turns endless, and its ramp
    // simply keeps climbing — that endless scaling, not its final wave, is
    // where world 9 sends a fully kitted character back to the gym.
    for (const w of WORLDS.filter((x) => x.id < WORLD_COUNT)) {
      const levels = levelsAtBoss(runs.ab4, w.id);
      const gear = ERA_GEAR[w.id] as (typeof ERA_GEAR)[number];
      const at = fightFinalWave(w.id, levels, gear);
      const late = w.id > 5;
      const short = fightFinalWave(w.id, shiftLevels(levels, late ? -3 : -2), gear);
      const wall = !short.cleared || short.defeats >= 3;
      if (!late) expect(wall, `world ${w.id}: two levels short should be a wall`).toBe(true);
      else expect(wall || short.ms >= at.ms * 1.2, `world ${w.id}: three levels short is no harder`).toBe(true);
    }
  });

  it('keeps every boss a 25–90 s climax for whoever reaches it, on either plan', () => {
    for (const plan of PLANS) {
      for (const w of WORLDS) {
        const res = fightBoss(w.id, levelsAtBoss(runs[plan], w.id), ERA_GEAR[w.id] as (typeof ERA_GEAR)[number]);
        expect(res.cleared, `${plan}: world ${w.id} boss is unbeatable`).toBe(1);
        expect(res.defeats, `${plan}: world ${w.id} boss knocks the player out`).toBeLessThanOrEqual(1);
        expect(res.ms, `${plan}: world ${w.id} boss is a pushover`).toBeGreaterThanOrEqual(25_000);
        expect(res.ms, `${plan}: world ${w.id} boss is a war of attrition`).toBeLessThanOrEqual(90_000);
      }
    }
  });
});

describe('the early challenge', () => {
  /** The trainee's levels with every REQUIRED part `by` levels under the gate. */
  function underGate(world: number, levels: PartLevels, by: number): PartLevels {
    const out = { ...levels };
    for (const [part, need] of Object.entries(worldBossOf(world)?.requires ?? {})) {
      out[part as BodyPart] = Math.max(1, (need as number) - by);
    }
    return out;
  }

  it('is a long but winnable fight one level short on every part, from world 4 on', () => {
    // In worlds 1–3 there is no gear to carry a missing level, and a level is a
    // fifth of the character: one short on every required part is a wall with
    // or without the handicap (the handicap is not what makes it one). From
    // world 4 the kit carries it: a tense fight, at most one knock-out.
    for (const w of WORLDS.filter((x) => x.id >= 4)) {
      const levels = underGate(w.id, levelsAtBoss(runs.ab4, w.id), 1);
      const deficit = worldGate(w.id, levels).deficit;
      expect(deficit).toBeGreaterThan(0);
      const res = fightBoss(w.id, levels, ERA_GEAR[w.id] as (typeof ERA_GEAR)[number], 300_000, deficit);
      expect(res.cleared, `world ${w.id}: one level short is unwinnable`).toBe(1);
      expect(res.defeats, `world ${w.id}: one level short knocks the player out repeatedly`).toBeLessThanOrEqual(1);
      expect(res.ms, `world ${w.id}: one level short is not a real fight`).toBeGreaterThan(90_000);
      expect(res.ms, `world ${w.id}: one level short is a war of attrition`).toBeLessThan(240_000);
    }
  });

  it('is a loss — or at least two and a half times the fight — three levels short on every part', () => {
    for (const w of WORLDS) {
      const at = fightBoss(w.id, levelsAtBoss(runs.ab4, w.id), ERA_GEAR[w.id] as (typeof ERA_GEAR)[number]);
      const levels = underGate(w.id, levelsAtBoss(runs.ab4, w.id), 3);
      const deficit = worldGate(w.id, levels).deficit;
      const res = fightBoss(w.id, levels, ERA_GEAR[w.id] as (typeof ERA_GEAR)[number], 400_000, deficit);
      const wall = res.cleared === 0 || res.defeats >= 3;
      expect(wall || res.ms >= at.ms * 2.5, `world ${w.id}: three levels short is too easy`).toBe(true);
    }
  });
});

describe('the journey table', () => {
  it('prints the numbers the README publishes (pinned loosely, printed exactly)', () => {
    const rows = WORLDS.map((w) => {
      let purse = 0;
      for (let wave = 1; wave <= w.waves; wave += 1) purse += waveSpec(w.id, wave).coins;
      purse += bossSpec(w.id)?.coins ?? 0;
      return {
        world: w.id,
        waves: w.waves,
        span: w.span ?? BALANCE.combat.wavesFirstWorld - 1,
        energy: w.waves * BALANCE.combat.energyPerWave + BALANCE.combat.boss.energyCost,
        gate: Object.entries(worldBossOf(w.id)?.requires ?? {}).map(([p, n]) => `${p} ${n}`).join(' · '),
        builtin: `${wavesRunOut(runs.builtin, w.id)} / ${gateOpens(runs.builtin, w.id)}`,
        ab4: `${wavesRunOut(runs.ab4, w.id)} / ${gateOpens(runs.ab4, w.id)}`,
        levelsBuiltin: BODY_PARTS.map((p) => levelsAtBoss(runs.builtin, w.id)[p]).join('/'),
        levelsAb4: BODY_PARTS.map((p) => levelsAtBoss(runs.ab4, w.id)[p]).join('/'),
        purse: Math.round(purse),
      };
    });
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows).toHaveLength(WORLD_COUNT);
  });
});
