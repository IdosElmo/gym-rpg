/**
 * core/coaching.ts — WHAT TO TRAIN for a boss gate, and WHEN it will open.
 *
 * The gate card used to say "חסר: ליבה רמה 5" and stop. That is a fact, not
 * advice: the player's plan decides how fast each part levels (the A/B 4-day
 * preset gives chest 2.4 set-equivalents per cycle against 30 for back), and a
 * gate that names a part the plan barely trains is a wall nobody can see the
 * shape of. This module turns the requirement into three numbers a trainee
 * can act on, all PURE functions of `(game, plan, events, today)`:
 *
 *   1. how many sets per week the ACTIVE plan actually gives the part;
 *   2. which library exercises (not yet in the plan) feed it;
 *   3. at the recent XP rate, how many workouts until the part gets there.
 *
 * Nothing here is stored or folded; it is derived on render, like the gate.
 */

import type { GateStatus } from '../data/gameContent.ts';
import {
  BODY_PARTS,
  BUILTIN_PROGRAM,
  EXTRA_EXERCISES,
  bodyPartWeights,
  isCardio,
  type BodyPart,
  type Exercise,
  type ResolvedProgram,
} from '../data/program.ts';
import type { AppEvent, GameState } from '../storage/DataStore.ts';
import { isoToTs, liveEvents, totalXpToReach } from './xp.ts';

/**
 * Weighted sets per WEEK the plan gives each body part: every day's sets, split
 * by `bodyPartWeights` (the same split the XP engine pays by), times the number
 * of weekdays the day is scheduled on. A day with no weekday counts once — it
 * is still a workout the plan expects, just an unscheduled one.
 */
export function partSetsPerWeek(program: ResolvedProgram): Record<BodyPart, number> {
  const out: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  for (const day of program.days) {
    const times = Math.max(1, day.weekdays.length);
    for (const ex of day.day.exercises) {
      if (isCardio(ex)) continue;
      const weights = bodyPartWeights(ex);
      for (const part of BODY_PARTS) {
        const w = weights[part];
        if (w > 0) out[part] += w * ex.sets * times;
      }
    }
  }
  for (const part of BODY_PARTS) out[part] = Math.round(out[part] * 10) / 10;
  return out;
}

/** Every exercise the app ships, built-in days first, library after. */
function libraryExercises(): Exercise[] {
  const seen = new Set<string>();
  const out: Exercise[] = [];
  for (const day of BUILTIN_PROGRAM.days) {
    for (const ex of day.day.exercises) {
      if (!seen.has(ex.id)) {
        seen.add(ex.id);
        out.push(ex);
      }
    }
  }
  for (const ex of EXTRA_EXERCISES) {
    if (!seen.has(ex.id)) {
      seen.add(ex.id);
      out.push(ex);
    }
  }
  return out;
}

/**
 * Library exercises that feed `part` and are NOT already in the plan, the ones
 * that feed it most first (a pure-part exercise before a split one), at most
 * `max`. Cardio never qualifies — it pays no body-part XP.
 */
export function suggestExercises(program: ResolvedProgram, part: BodyPart, max = 3): Exercise[] {
  const inPlan = new Set<string>();
  for (const day of program.days) for (const ex of day.day.exercises) inPlan.add(ex.id);
  const scored = libraryExercises()
    .filter((ex) => !inPlan.has(ex.id) && !isCardio(ex))
    .map((ex) => ({ ex, w: bodyPartWeights(ex)[part] }))
    .filter((c) => c.w >= 0.5);
  // stable sort: heaviest weight first, library order within a weight
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, Math.max(0, max)).map((c) => c.ex);
}

export interface XpRate {
  /** XP each part gained per WORKOUT DAY inside the window. */
  perWorkout: Record<BodyPart, number>;
  /** Distinct workout days inside the window that paid XP. */
  workouts: number;
}

/**
 * The recent XP rate per body part: every LIVE, non-retro, non-dev `xp_gained`
 * inside the last `windowDays` days, summed per part and divided by the number
 * of distinct days that paid anything. Dev grants are excluded like everywhere
 * else in the stats (`liveEvents` drops purged ones, the `dev` flag the rest),
 * and retro grants are excluded because imported history says nothing about
 * the pace the trainee is on NOW.
 */
export function xpRate(events: readonly AppEvent[], today: string, windowDays = 28): XpRate {
  const perWorkout: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  const from = isoToTs(today) - Math.max(1, Math.floor(windowDays)) * 86_400_000;
  const days = new Set<string>();
  for (const ev of liveEvents(events)) {
    if (ev.type !== 'xp_gained') continue;
    const p = ev.payload;
    if (p['dev'] === true || p['retro'] === true) continue;
    const date = typeof p['date'] === 'string' ? p['date'] : '';
    if (!date || isoToTs(date) < from || isoToTs(date) > isoToTs(today)) continue;
    const parts = p['parts'];
    if (!parts || typeof parts !== 'object') continue;
    let paid = false;
    for (const part of BODY_PARTS) {
      const v = (parts as Record<string, unknown>)[part];
      if (typeof v === 'number' && v > 0) {
        perWorkout[part] += v;
        paid = true;
      }
    }
    if (paid) days.add(date);
  }
  const n = days.size;
  for (const part of BODY_PARTS) perWorkout[part] = n > 0 ? Math.round((perWorkout[part] / n) * 10) / 10 : 0;
  return { perWorkout, workouts: n };
}

export interface PartCoaching {
  part: BodyPart;
  need: number;
  have: number;
  /** Weighted sets per week the active plan gives this part. */
  setsPerWeek: number;
  /** Library exercises that would feed it, best first (empty when the plan has them all). */
  suggestions: Exercise[];
  /** XP still missing to reach `need`. */
  xpMissing: number;
  /** Recent XP per workout for this part (0 when there is no recent training). */
  xpPerWorkout: number;
  /** Workouts to `need` at that rate — `null` while there is no rate to go on. */
  workoutsLeft: number | null;
}

export interface GateCoaching {
  /** One entry per UNMET requirement, the slowest part first. */
  parts: PartCoaching[];
  /** Workouts until the whole gate is met — the slowest part — or `null` when unknown. */
  workoutsLeft: number | null;
  /** Distinct recent workout days the rate was measured over. */
  measuredOver: number;
}

/**
 * The coaching behind a gate: for every unmet requirement, what the plan gives
 * the part, what could be added, and how far away it is at the recent pace.
 */
export function gateCoaching(
  game: GameState,
  gate: GateStatus,
  program: ResolvedProgram,
  events: readonly AppEvent[],
  today: string,
): GateCoaching {
  const sets = partSetsPerWeek(program);
  const rate = xpRate(events, today);
  const parts: PartCoaching[] = [];
  for (const r of gate.requirements) {
    if (r.met) continue;
    const xpMissing = Math.max(0, Math.round((totalXpToReach(r.need) - (game.parts[r.part]?.xp ?? 0)) * 10) / 10);
    const perWorkout = rate.perWorkout[r.part];
    parts.push({
      part: r.part,
      need: r.need,
      have: r.have,
      setsPerWeek: sets[r.part],
      suggestions: suggestExercises(program, r.part),
      xpMissing,
      xpPerWorkout: perWorkout,
      workoutsLeft: perWorkout > 0 ? Math.max(1, Math.ceil(xpMissing / perWorkout)) : null,
    });
  }
  // slowest first — the part that decides when the gate opens leads the list
  parts.sort((a, b) => (b.workoutsLeft ?? Infinity) - (a.workoutsLeft ?? Infinity) || b.xpMissing - a.xpMissing);
  const unknown = parts.some((p) => p.workoutsLeft === null);
  const workoutsLeft = parts.length === 0 ? 0 : unknown ? null : Math.max(...parts.map((p) => p.workoutsLeft ?? 0));
  return { parts, workoutsLeft, measuredOver: rate.workouts };
}
