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
  DailyChallengeState,
  DataStore,
  GameState,
  GhostDuelState,
  LeagueState,
  WaveClearedPayload,
} from '../storage/DataStore.ts';
import type { BossResult, ChallengeResult, WaveResult } from './combat.ts';
import { BALANCE } from './balance.ts';
import {
  buildLeagueChallengeComplete,
  buildLeagueChallengeSet,
  buildLeagueRedemption,
  buildWeekCloses,
  leagueContext,
  type LeagueContext,
  type LeagueInput,
  type LeagueSpendError,
  type LeagueSpendPlan,
} from './league.ts';
import { todayISO } from './workout.ts';
import type { BodyGeometry } from '../data/characters.ts';
import {
  applyGameEvent,
  buildBodySelect,
  buildCharacterPurchase,
  buildCharacterSelect,
  buildDailyChallenge,
  buildEquip,
  buildGhostDuel,
  buildPurchase,
  buildSetGrant,
  buildUpgrade,
  buildWorkoutCompletionGrant,
  computeStreak,
  dailyEntryStatus,
  duelEntryStatus,
  emptyGame,
  finalizeGame,
  rebuildGame,
  weeklyTargetsFromEvents,
  type CharacterPurchaseError,
  type DailyEntryStatus,
  type DuelEntryStatus,
  type PendingEvent,
  type PurchaseError,
  type UpgradeError,
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
 *
 * EXPORTED because it is THE write path: the dev grants (`dev/actions.ts`) go
 * through this same function rather than round their own way to the store, which
 * is what makes a dev grant an ordinary event in an ordinary log.
 */
export function commit(store: DataStore, pending: readonly PendingEvent[], now: Date = new Date()): AppEvent[] {
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

/**
 * Append `pending` and then REBUILD the game state from the whole log.
 *
 * The incremental path above can only ADD an event's effect, which is exactly
 * right for every event that grants something — and exactly wrong for
 * `dev_purge`, whose effect is that a set of events already folded must now be
 * unfolded. Un-applying them one by one would mean writing a second, inverse
 * reducer and keeping the two in step for ever; replaying instead reuses the one
 * reducer we already trust, and lands on the same state a fresh device would
 * reach from the same log. It is the identical move `ensureGameState` makes when
 * the cached blob cannot be trusted: the log is the source of truth, so when in
 * doubt, ask it.
 *
 * The cost is a full fold of the log — a few milliseconds, on a button that is
 * pressed by hand and re-renders the screen anyway.
 */
export function commitRebuild(store: DataStore, pending: readonly PendingEvent[], now: Date = new Date()): AppEvent[] {
  const appended = pending.map((p) => store.append(p.type, p.payload));
  const rebuilt = rebuildGame(store.getEvents(), todayISO(now));
  store.update((draft) => {
    draft.game = rebuilt;
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

/* ------------------------------------------------------- daily challenge */

export interface DailyChallengeSave {
  ok: boolean;
  /** Set when nothing was written: the date already had a counted attempt. */
  duplicate: boolean;
  /** The daily state after the write (or as it already was). */
  daily: DailyChallengeState;
}

/**
 * Persist ONE finished daily-challenge run — the only write the feature makes.
 *
 * Called for every ending: a full clear, a knock-out, and a forfeit when the
 * player leaves the arena mid-run. All three are real attempts, and all three
 * pay for exactly the waves that were cleared, so there is no path on which
 * partial coins can leak or a fee can be charged twice: `buildDailyChallenge`
 * returns nothing once the date has a record, and the reducer refuses again.
 *
 * The date in the payload is the CHALLENGE's date (the one the gauntlet was
 * generated from), not "now" — a run started a minute before midnight belongs to
 * the challenge it was actually playing.
 */
export function onDailyChallenge(
  store: DataStore,
  result: ChallengeResult,
  now: Date = new Date(),
): DailyChallengeSave {
  const pending = buildDailyChallenge(gameOf(store), result, now.getTime());
  if (pending.length === 0) return { ok: false, duplicate: true, daily: gameOf(store).daily };
  commit(store, pending, now);
  return { ok: true, duplicate: false, daily: gameOf(store).daily };
}

/**
 * Can today's challenge be entered? A thin store-level wrapper over the pure
 * rule in `core/xp.ts` — the UI asks this BEFORE it creates a run, so a refused
 * attempt writes nothing at all.
 */
export function dailyStatus(store: DataStore, date: string): DailyEntryStatus {
  return dailyEntryStatus(gameOf(store), date);
}

/* ------------------------------------------------------------ ghost duel */

export interface GhostDuelSave {
  ok: boolean;
  /** Set when nothing was written: that opponent was already fought today. */
  duplicate: boolean;
  duels: GhostDuelState;
}

/**
 * Persist ONE finished ghost duel — the only write the feature makes.
 *
 * Called for every ending, exactly like the daily challenge: the ghost went
 * down, the player was knocked out, or the player walked out of the arena
 * mid-duel (a forfeit, which counts as a loss — leaving is not a draw). All
 * three spend the fee and none of them pays a single coin.
 *
 * `snapshotHash` is the fingerprint of the ghost that was actually fought, so
 * the record says WHICH version of that character this was, and a replay never
 * has to go and look at today's version of them.
 */
export function onGhostDuel(
  store: DataStore,
  result: ChallengeResult,
  snapshotHash: string,
  now: Date = new Date(),
): GhostDuelSave {
  const pending = buildGhostDuel(gameOf(store), result, snapshotHash, now.getTime());
  if (pending.length === 0) return { ok: false, duplicate: true, duels: gameOf(store).duels };
  commit(store, pending, now);
  return { ok: true, duplicate: false, duels: gameOf(store).duels };
}

/**
 * Can this opponent be fought on this date? A thin store-level wrapper over the
 * pure rule in `core/xp.ts` — the UI asks BEFORE it creates a run, so a refused
 * duel writes nothing at all.
 */
export function ghostDuelStatus(store: DataStore, date: string, opponentHandle: string): DuelEntryStatus {
  return duelEntryStatus(gameOf(store), date, opponentHandle);
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

export interface UpgradeResult {
  ok: boolean;
  error?: UpgradeError;
  /** The level reached (0 when refused) — the toast and the feed quote it. */
  toLevel: number;
  /** Coins charged for this step (0 when refused). */
  cost: number;
}

/**
 * Upgrade an OWNED item by one level (+1 → +2 → +3), paid in battle coins.
 *
 * Same shape as `buyItem`: `core/xp.ts` decides (ownership, the cap, the purse)
 * BEFORE anything is appended, so a refused upgrade leaves no trace in the log.
 * The stat grid follows for free — every stat reads `equippedBonus`, which reads
 * the level this writes.
 */
export function upgradeItem(store: DataStore, itemId: string, now: Date = new Date()): UpgradeResult {
  const plan = buildUpgrade(gameOf(store), itemId, todayISO(now), now.getTime());
  if (!plan.ok) {
    const out: UpgradeResult = { ok: false, toLevel: 0, cost: 0 };
    if (plan.error) out.error = plan.error;
    return out;
  }
  commit(store, plan.events, now);
  return { ok: true, toLevel: plan.toLevel, cost: plan.cost };
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

/* ---------------------------------------------------------------- הליגה */

/** The league's inputs as this store holds them — sessions plus the whole log. */
export function leagueInputOf(store: DataStore): LeagueInput {
  return { sessions: store.getState().sessions, events: store.getEvents() };
}

/** The grading context of this store — pure, and cheap enough to rebuild. */
export function leagueContextOf(store: DataStore): LeagueContext {
  return leagueContext(leagueInputOf(store));
}

export interface WeekCloseResult {
  /** Week keys closed by this call, oldest first (empty when nothing was due). */
  closed: string[];
  /** 🔵 those weeks minted. */
  coins: number;
  league: LeagueState;
}

/**
 * CLOSE EVERY FINISHED WEEK THE LOG HAS NOT GRADED YET.
 *
 * The league's counterpart to `refreshStreak`, and for the same reason: weeks
 * end by the passing of time, not by anything the user does, so something has to
 * notice. Called on boot and after a workout.
 *
 * LAZY, DETERMINISTIC AND BOUNDED. Each due week is graded from the log alone
 * (`buildWeekCloses`), so a device that has been offline for a month writes the
 * same four events another device would have written week by week — and the
 * reducer's per-week ledger means the union of the two logs still holds ONE
 * grade and ONE 🔵 per week, in either merge order. The backfill reaches at most
 * `BALANCE.league.backfillWeeks` weeks, so a long-dormant install cannot dump a
 * year of events into the log on its next boot.
 */
export function closeDueWeeks(store: DataStore, now: Date = new Date()): WeekCloseResult {
  const pending = buildWeekCloses(leagueInputOf(store), gameOf(store).league, todayISO(now), now.getTime());
  if (pending.length === 0) return { closed: [], coins: 0, league: gameOf(store).league };
  commit(store, pending, now);
  const league = gameOf(store).league;
  const closed = pending.map((p) => String(p.payload['weekKey']));
  return {
    closed,
    coins: closed.reduce((sum, week) => sum + (league.weeks[week]?.coin ? BALANCE.league.coinPerWeek : 0), 0),
    league,
  };
}

export interface LeagueSpendResult {
  ok: boolean;
  error?: LeagueSpendError;
  /** 🔵 charged (0 when refused, and 0 for a challenge completion — it PAYS). */
  cost: number;
  league: LeagueState;
}

function spend(store: DataStore, plan: LeagueSpendPlan, now: Date): LeagueSpendResult {
  if (!plan.ok) {
    const out: LeagueSpendResult = { ok: false, cost: 0, league: gameOf(store).league };
    if (plan.error) out.error = plan.error;
    return out;
  }
  commit(store, plan.events, now);
  return { ok: true, cost: plan.cost, league: gameOf(store).league };
}

/**
 * Redeem one item of a month's pool for 🔵.
 *
 * Same contract as `buyItem`: `core/league.ts` decides (the item, the month, the
 * ledger, the purse) BEFORE anything is appended, so a refused redemption leaves
 * no trace in the log at all.
 */
export function redeemLeagueReward(
  store: DataStore,
  month: string,
  itemId: string,
  now: Date = new Date(),
): LeagueSpendResult {
  return spend(store, buildLeagueRedemption(gameOf(store), month, itemId, todayISO(now), now.getTime()), now);
}

/** Stake this month's challenge (one slot per month, paid for up front). */
export function setLeagueChallenge(
  store: DataStore,
  month: string,
  challengeId: string,
  now: Date = new Date(),
): LeagueSpendResult {
  return spend(
    store,
    buildLeagueChallengeSet(gameOf(store), month, challengeId, todayISO(now), now.getTime()),
    now,
  );
}

/** Claim the month's staked challenge as done — self-reported, pays its bonus. */
export function completeLeagueChallenge(
  store: DataStore,
  month: string,
  now: Date = new Date(),
): LeagueSpendResult {
  return spend(store, buildLeagueChallengeComplete(gameOf(store), month, todayISO(now), now.getTime()), now);
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
