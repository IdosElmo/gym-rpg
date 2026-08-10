/**
 * core/game.ts — the thin driver that connects the pure XP engine (core/xp.ts)
 * to the `DataStore`. No DOM here either; the UI only consumes the results.
 *
 * Every mutation follows the same two steps, in this order:
 *   1. append the authoritative events to the append-only log;
 *   2. fold those same events into `state.game` with the same reducer replay
 *      uses, then re-derive levels/streak.
 * That ordering is what keeps "live state === rebuildFromEvents(log)" true.
 */

import type { BodyPart, DayKey, Exercise } from '../data/program.ts';
import type {
  AppEvent,
  BattleProgress,
  DataStore,
  GameState,
  WaveClearedPayload,
} from '../storage/DataStore.ts';
import type { WaveResult } from './combat.ts';
import { todayISO } from './workout.ts';
import {
  applyGameEvent,
  buildSetGrant,
  buildWorkoutCompletionGrant,
  computeStreak,
  emptyGame,
  finalizeGame,
  type PendingEvent,
} from './xp.ts';

/** The game state of a store, never null (an absent blob reads as a fresh one). */
export function gameOf(store: DataStore): GameState {
  return store.getState().game ?? emptyGame();
}

export interface LevelUpInfo {
  part: BodyPart;
  from: number;
  to: number;
}

/** What the UI needs in order to celebrate a grant. */
export interface GrantResult {
  /** Total XP granted (already split across the parts below). */
  xp: number;
  parts: Array<{ part: BodyPart; amount: number }>;
  energy: number;
  pr: boolean;
  levelUps: LevelUpInfo[];
}

const EMPTY_RESULT: GrantResult = { xp: 0, parts: [], energy: 0, pr: false, levelUps: [] };

/** Append `pending` to the log and fold it into `state.game`. */
function commit(store: DataStore, pending: readonly PendingEvent[], now: Date): AppEvent[] {
  const appended = pending.map((p) => store.append(p.type, p.payload));
  store.update((draft) => {
    const game = draft.game ?? emptyGame();
    for (const p of pending) applyGameEvent(game, p.type, p.payload);
    finalizeGame(game, todayISO(now));
    draft.game = game;
  });
  return appended;
}

function summarize(pending: readonly PendingEvent[]): GrantResult {
  const parts: Array<{ part: BodyPart; amount: number }> = [];
  const levelUps: LevelUpInfo[] = [];
  let xp = 0;
  let energy = 0;
  let pr = false;

  for (const e of pending) {
    if (e.type === 'xp_gained') {
      xp += typeof e.payload['total'] === 'number' ? e.payload['total'] : 0;
      const p = e.payload['parts'];
      if (p && typeof p === 'object') {
        for (const [part, amount] of Object.entries(p as Record<string, unknown>)) {
          if (typeof amount === 'number' && amount > 0) {
            parts.push({ part: part as BodyPart, amount });
          }
        }
      }
    } else if (e.type === 'energy_gained') {
      energy += typeof e.payload['amount'] === 'number' ? e.payload['amount'] : 0;
    } else if (e.type === 'pr_achieved') {
      pr = true;
    } else if (e.type === 'level_up') {
      levelUps.push({
        part: e.payload['part'] as BodyPart,
        from: Number(e.payload['from']),
        to: Number(e.payload['to']),
      });
    }
  }
  parts.sort((a, b) => b.amount - a.amount);
  return { xp: Math.round(xp * 100) / 100, parts, energy, pr, levelUps };
}

export interface SetCompletedArgs {
  date: string;
  day: DayKey;
  ex: Exercise;
  setIndex: number;
  w: string;
  r: string;
}

/**
 * Grant XP + energy for a set the user just checked.
 *
 * Returns a zeroed result when this set already paid out today — unchecking and
 * re-checking a set can never farm XP (see the guard in core/xp.ts).
 */
export function onSetCompleted(store: DataStore, a: SetCompletedArgs, now: Date = new Date()): GrantResult {
  const pending = buildSetGrant(gameOf(store), { ...a, retro: false, ts: now.getTime() });
  if (pending.length === 0) return EMPTY_RESULT;
  commit(store, pending, now);
  return summarize(pending);
}

/** Grant the flat all-parts bonus + bonus energy for finishing a whole workout. */
export function onWorkoutFinished(
  store: DataStore,
  a: { date: string; day: DayKey },
  now: Date = new Date(),
): GrantResult {
  const pending = buildWorkoutCompletionGrant(gameOf(store), { ...a, retro: false, ts: now.getTime() });
  if (pending.length === 0) return EMPTY_RESULT;
  commit(store, pending, now);
  return summarize(pending);
}

/* ---------------------------------------------------------------- battle */

/**
 * Persist ONE cleared wave.
 *
 * This is the only battle write in the whole app: `core/combat.ts` simulates,
 * the UI renders, and exactly one `wave_cleared` event per cleared wave lands in
 * the log (never per attack tick). Energy is charged and coins are paid by the
 * same reducer `rebuildFromEvents` uses, so replay reproduces battle progress.
 */
export function onWaveCleared(store: DataStore, r: WaveResult, now: Date = new Date()): BattleProgress {
  const payload: WaveClearedPayload = {
    date: todayISO(now),
    world: r.world,
    wave: r.wave,
    miniBoss: r.miniBoss,
    enemyId: r.enemyId,
    coins: r.coins,
    energySpent: r.energySpent,
    seed: r.seed,
    durationMs: r.durationMs,
  };
  commit(store, [{ type: 'wave_cleared', payload, ts: now.getTime() }], now);
  return gameOf(store).battle;
}

export interface StreakRefresh {
  tier: number;
  previous: number;
  changed: boolean;
}

/**
 * Re-evaluate the streak for "now" and record a `streak_changed` event when the
 * tier moved. Called on boot and after every workout: weeks close by the passing
 * of time, not by a user action, so something has to notice.
 */
export function refreshStreak(store: DataStore, now: Date = new Date()): StreakRefresh {
  const game = gameOf(store);
  const previous = game.streak.tier;
  const next = computeStreak(game.workoutDays, todayISO(now));
  const changed = next.tier !== previous || next.weekStart !== game.streak.weekStart;

  if (changed) {
    if (next.tier !== previous) {
      store.append('streak_changed', { from: previous, to: next.tier, weekStart: next.weekStart });
    }
    store.update((draft) => {
      const g = draft.game ?? emptyGame();
      finalizeGame(g, todayISO(now));
      draft.game = g;
    });
  }
  return { tier: next.tier, previous, changed: next.tier !== previous };
}
