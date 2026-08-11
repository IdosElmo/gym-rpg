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

import type { EquipmentSlot } from '../data/gameContent.ts';
import type { BodyPart, DayKey, Exercise } from '../data/program.ts';
import type {
  AppEvent,
  BattleProgress,
  BossDefeatedPayload,
  DataStore,
  GameState,
  WaveClearedPayload,
} from '../storage/DataStore.ts';
import type { BossResult, WaveResult } from './combat.ts';
import { todayISO } from './workout.ts';
import type { BodyGeometry } from '../data/characters.ts';
import {
  applyGameEvent,
  buildBodySelect,
  buildCharacterPurchase,
  buildCharacterSelect,
  buildEquip,
  buildPurchase,
  buildSetGrant,
  buildWorkoutCompletionGrant,
  computeStreak,
  emptyGame,
  finalizeGame,
  weeklyTargetsFromEvents,
  type CharacterPurchaseError,
  type PendingEvent,
  type PurchaseError,
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

/**
 * Append `pending` to the log and fold it into `state.game`.
 *
 * The streak is re-derived against the plan history the LOG holds (the events
 * were appended a line above, so the log is already current) — exactly what
 * `rebuildGame` does for the same log. That is what keeps a plan's weekly target
 * meaning the same thing live and on replay.
 */
function commit(store: DataStore, pending: readonly PendingEvent[], now: Date): AppEvent[] {
  const appended = pending.map((p) => store.append(p.type, p.payload));
  const targets = weeklyTargetsFromEvents(store.getEvents());
  store.update((draft) => {
    const game = draft.game ?? emptyGame();
    for (const p of pending) applyGameEvent(game, p.type, p.payload);
    finalizeGame(game, todayISO(now), targets);
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

/**
 * Persist a world-boss kill: the trophy, the purse, the energy and the unlock.
 *
 * Exactly one `boss_defeated` event per boss. The payload carries the landing
 * spot (`nextWorld`/`nextWave`), so replay reproduces the unlock without having
 * to know today's unlock rule.
 */
export function onBossDefeated(store: DataStore, r: BossResult, now: Date = new Date()): BattleProgress {
  const payload: BossDefeatedPayload = {
    date: todayISO(now),
    world: r.world,
    wave: r.wave,
    bossId: r.bossId,
    coins: r.coins,
    energySpent: r.energySpent,
    seed: r.seed,
    durationMs: r.durationMs,
    nextWorld: r.nextWorld,
    nextWave: r.nextWave,
    endgame: r.endgame,
  };
  commit(store, [{ type: 'boss_defeated', payload, ts: now.getTime() }], now);
  return gameOf(store).battle;
}

/* ------------------------------------------------------------------ shop */

export interface PurchaseResult {
  ok: boolean;
  error?: PurchaseError;
}

/**
 * Buy a shop item with battle coins (and put it on immediately).
 *
 * The affordability check lives in `core/xp.ts` and runs BEFORE anything is
 * appended, so a refused purchase leaves no trace in the log at all.
 */
export function buyItem(store: DataStore, itemId: string, now: Date = new Date()): PurchaseResult {
  const plan = buildPurchase(gameOf(store), itemId, todayISO(now), now.getTime());
  if (!plan.ok) {
    const out: PurchaseResult = { ok: false };
    if (plan.error) out.error = plan.error;
    return out;
  }
  commit(store, plan.events, now);
  return { ok: true };
}

/** Wear an owned item, or pass `null` to take the slot's item off. */
export function equipItem(
  store: DataStore,
  slot: EquipmentSlot,
  itemId: string | null,
  now: Date = new Date(),
): boolean {
  const pending = buildEquip(gameOf(store), slot, itemId, todayISO(now), now.getTime());
  if (pending.length === 0) return false;
  commit(store, pending, now);
  return true;
}

/* ------------------------------------------------------------- characters */

export interface CharacterPurchaseResult {
  ok: boolean;
  error?: CharacterPurchaseError;
}

/**
 * Buy a cosmetic character SKIN with battle coins (and wear it immediately).
 *
 * Same contract as `buyItem`: the decision is made in `core/xp.ts` BEFORE
 * anything is appended, so a refused purchase leaves no trace in the log.
 * One purchase unlocks the skin on BOTH bodies, and skins change nothing but
 * the drawing — no stat, anywhere, ever.
 */
export function buyCharacter(store: DataStore, skinId: string, now: Date = new Date()): CharacterPurchaseResult {
  const plan = buildCharacterPurchase(gameOf(store), skinId, todayISO(now), now.getTime());
  if (!plan.ok) {
    const out: CharacterPurchaseResult = { ok: false };
    if (plan.error) out.error = plan.error;
    return out;
  }
  commit(store, plan.events, now);
  return { ok: true };
}

/**
 * Play an owned body × skin combination (`'robot_f'`; a legacy id such as
 * `'robot'` is accepted and resolved). False when there was nothing to change.
 */
export function selectCharacter(store: DataStore, characterId: string, now: Date = new Date()): boolean {
  const pending = buildCharacterSelect(gameOf(store), characterId, todayISO(now), now.getTime());
  if (pending.length === 0) return false;
  commit(store, pending, now);
  return true;
}

/** Switch body, keeping the skin. False when that body is already being played. */
export function selectBody(store: DataStore, body: BodyGeometry, now: Date = new Date()): boolean {
  const pending = buildBodySelect(gameOf(store), body, todayISO(now), now.getTime());
  if (pending.length === 0) return false;
  commit(store, pending, now);
  return true;
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
  const targets = weeklyTargetsFromEvents(store.getEvents());
  const next = computeStreak(game.workoutDays, todayISO(now), targets);
  const changed =
    next.tier !== previous || next.weekStart !== game.streak.weekStart || next.needed !== game.streak.needed;

  if (changed) {
    if (next.tier !== previous) {
      store.append('streak_changed', { from: previous, to: next.tier, weekStart: next.weekStart });
    }
    store.update((draft) => {
      const g = draft.game ?? emptyGame();
      // `store.append` above may have added an event — read the log again.
      finalizeGame(g, todayISO(now), weeklyTargetsFromEvents(store.getEvents()));
      draft.game = g;
    });
  }
  return { tier: next.tier, previous, changed: next.tier !== previous };
}
