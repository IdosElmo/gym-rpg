/**
 * core/xp.ts — XP formulas, body-part levels, streaks and the game reducer.
 *
 * Everything here is PURE: no DOM, no storage, no `Date.now()`. The current
 * date is always passed in, so live state and replayed state are byte-identical.
 *
 * DESIGN — event sourcing
 * ----------------------
 * `GameState` is a CACHE. The append-only log is the source of truth:
 *   grant builders (`buildSetGrant`, `buildWorkoutCompletionGrant`) look at the
 *   current game state and RETURN the events to append; `applyGameEvent` folds
 *   an event into the state. The live app and `rebuildGame()` run the exact same
 *   reducer over the exact same events, which is what makes replay provably
 *   equivalent (see tests/xp.test.ts + tests/game.test.ts).
 *
 * DESIGN — no XP farming
 * ----------------------
 * XP/energy are granted ONCE per (date, exercise, set index), recorded in
 * `game.granted`. Unchecking a set does NOT refund XP, and re-checking it grants
 * nothing new — so the check button can never be used as an XP faucet. Same idea
 * for the workout-completion bonus, guarded once per date via `game.bonusDays`.
 *
 * DESIGN — retroactive history
 * ----------------------------
 * Sessions that predate the game layer (legacy import, JSON import, or workouts
 * logged under Phase 0) are granted XP with `retro: true`. Retro grants pay XP
 * and PRs, but deliberately NOT battle energy and NOT streak days — the streak
 * starts at 0 for imported history, per the brief.
 */

import {
  BODY_PARTS,
  PROGRAM,
  bodyPartWeights,
  findExercise,
  type BodyPart,
  type DayKey,
  type Exercise,
} from '../data/program.ts';
import { BALANCE } from './balance.ts';
import {
  EQUIPMENT_SLOTS,
  equipmentById,
  sumEquipBonus,
  zeroBonus,
  type EquipmentSlot,
  type ResolvedBonus,
} from '../data/gameContent.ts';
import {
  GAME_STATE_VERSION,
  type AppEvent,
  type BattleProgress,
  type EquipmentState,
  type EventType,
  type GameState,
  type PartsProgress,
  type Session,
  type SetEntry,
  type StreakState,
} from '../storage/DataStore.ts';

/* ------------------------------------------------------------- primitives */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to 2 decimals — keeps the event log tidy and float noise out of tests. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Parse a logged string field ("42.5", "", "abc") into a non-negative number. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------ level curve */

/** XP needed to go FROM level `n` to level `n+1` — `100 × 1.35^(n−1)`. */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return BALANCE.xp.levelBase * Math.pow(BALANCE.xp.levelGrowth, n - 1);
}

/** Cumulative XP needed to REACH level `n` (level 1 costs nothing). */
export function totalXpToReach(level: number): number {
  const n = Math.max(1, Math.floor(level));
  const g = BALANCE.xp.levelGrowth;
  return (BALANCE.xp.levelBase * (Math.pow(g, n - 1) - 1)) / (g - 1);
}

/** Level for a total XP pool. Levels start at 1 and are capped by balance. */
export function levelForXp(totalXp: number): number {
  let remaining = Math.max(0, totalXp);
  let level = 1;
  while (level < BALANCE.xp.maxLevel) {
    const need = xpForLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP accumulated inside the current level. */
  into: number;
  /** XP the current level needs in total. */
  need: number;
  /** `into / need`, clamped to 0..1 — the progress-bar width. */
  ratio: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const level = levelForXp(totalXp);
  const into = Math.max(0, totalXp - totalXpToReach(level));
  const need = xpForLevel(level);
  return { level, into: round2(into), need: round2(need), ratio: clamp(need > 0 ? into / need : 1, 0, 1) };
}

/** Headline character level = floor(average of the six body-part levels). */
export function characterLevel(parts: PartsProgress): number {
  let sum = 0;
  for (const part of BODY_PARTS) sum += parts[part].level;
  return Math.max(1, Math.floor(sum / BODY_PARTS.length));
}

/* ---------------------------------------------------------------- volume */

/**
 * Volume of one logged set.
 * - weighted sets: `weight × reps`
 * - bodyweight / timed sets (no weight): the reps or seconds value alone
 * - a weight with no reps: the weight alone (partial log, better than 0)
 */
export function setVolume(w: string, r: string): number {
  const weight = toNumber(w);
  const reps = toNumber(r);
  if (weight > 0 && reps > 0) return round2(weight * reps);
  if (reps > 0) return reps;
  if (weight > 0) return weight;
  return 0;
}

/** `clamp(volume / previousBest, 0.5, 1.5)`; 1 when there is nothing to compare. */
export function volumeFactor(volume: number, previousBest: number): number {
  if (!(volume > 0) || !(previousBest > 0)) return 1;
  return clamp(volume / previousBest, BALANCE.xp.volumeFactorMin, BALANCE.xp.volumeFactorMax);
}

/**
 * A PR needs a previous best to beat: the very first set of an exercise
 * ESTABLISHES the baseline rather than being celebrated as a record.
 */
export function isPersonalRecord(volume: number, previousBest: number): boolean {
  return volume > 0 && previousBest > 0 && volume > previousBest;
}

export interface SetXpResult {
  xp: number;
  factor: number;
  pr: boolean;
  volume: number;
}

/** `baseXP × volumeFactor`, doubled on a new personal record. */
export function xpForSet(volume: number, previousBest: number): SetXpResult {
  const factor = volumeFactor(volume, previousBest);
  const pr = isPersonalRecord(volume, previousBest);
  const xp = round2(BALANCE.xp.baseSetXp * factor * (pr ? BALANCE.xp.prMultiplier : 1));
  return { xp, factor: round2(factor), pr, volume };
}

/** Split a set's XP across the exercise's body parts (weights always sum to 1). */
export function splitXp(xp: number, ex: Exercise): Partial<Record<BodyPart, number>> {
  const weights = bodyPartWeights(ex);
  const out: Partial<Record<BodyPart, number>> = {};
  for (const part of BODY_PARTS) {
    const w = weights[part];
    if (w > 0) out[part] = round2(xp * w);
  }
  return out;
}

/** The workout-completion bonus: a flat amount to EVERY body part. */
export function completionSplit(): Partial<Record<BodyPart, number>> {
  const out: Partial<Record<BodyPart, number>> = {};
  for (const part of BODY_PARTS) out[part] = BALANCE.xp.workoutCompletionBonus;
  return out;
}

/* ---------------------------------------------------------------- streaks */

const DAY_MS = 86_400_000;

/** ISO date -> epoch ms at 00:00 UTC (deterministic, DST-free date math). */
export function isoToTs(date: string): number {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(t) ? 0 : t;
}

export function tsToIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return tsToIso(isoToTs(date) + days * DAY_MS);
}

/** Sunday that starts the calendar week containing `date` (Sun–Sat weeks). */
export function weekStartISO(date: string): string {
  const ts = isoToTs(date);
  const dow = new Date(ts).getUTCDay(); // 0 = Sunday
  return tsToIso(ts - dow * DAY_MS);
}

/**
 * Streak tier from the distinct LIVE workout days.
 *
 * Every calendar week that has already CLOSED (i.e. every week before the one
 * containing `today`), starting from the week of the first workout, is judged:
 * ≥3 distinct workout days → tier +1, otherwise tier −1 (floor 0). The week in
 * progress is never judged. Levels and XP are never touched by a tier drop.
 */
export function computeStreak(days: readonly string[], today: string): StreakState {
  const needed = BALANCE.streak.daysPerWeek;
  const currentWeek = weekStartISO(today);
  const unique = [...new Set(days)].sort();
  const first = unique[0];
  if (first === undefined) {
    return { tier: 0, weekStart: currentWeek, daysThisWeek: 0, needed };
  }

  let tier = 0;
  let week = weekStartISO(first);
  // Guard against a corrupt far-past date turning this into an infinite loop.
  for (let guard = 0; week < currentWeek && guard < 5200; guard += 1) {
    const end = addDays(week, 7);
    const count = unique.filter((d) => d >= week && d < end).length;
    tier = count >= needed ? tier + 1 : Math.max(0, tier - 1);
    week = end;
  }

  const weekEnd = addDays(currentWeek, 7);
  const daysThisWeek = unique.filter((d) => d >= currentWeek && d < weekEnd).length;
  return { tier, weekStart: currentWeek, daysThisWeek, needed };
}

/** The permanent stacking buff multiplier: `1 + 0.1 × tier`. */
export function streakMultiplier(tier: number): number {
  return 1 + BALANCE.streak.buffPerTier * Math.max(0, tier);
}

/* ------------------------------------------------------------ game state */

export function emptyParts(): PartsProgress {
  return {
    chest: { xp: 0, level: 1 },
    back: { xp: 0, level: 1 },
    legs: { xp: 0, level: 1 },
    shoulders: { xp: 0, level: 1 },
    arms: { xp: 0, level: 1 },
    core: { xp: 0, level: 1 },
  };
}

export function emptyGame(): GameState {
  return {
    version: GAME_STATE_VERSION,
    parts: emptyParts(),
    level: 1,
    totalXp: 0,
    energy: 0,
    energyEarned: 0,
    prCount: 0,
    best: {},
    granted: {},
    bonusDays: {},
    energyGranted: {},
    prKeys: {},
    workoutDays: [],
    streak: { tier: 0, weekStart: null, daysThisWeek: 0, needed: BALANCE.streak.daysPerWeek },
    battle: emptyBattle(),
    equipment: emptyEquipment(),
  };
}

/** A fresh battle progress: world 1, wave 1, no coins, no trophies. */
export function emptyBattle(): BattleProgress {
  return { world: 1, wave: 1, coins: 0, wavesCleared: 0, miniBossesCleared: 0, bossesDefeated: [] };
}

/** A fresh wardrobe: nothing owned, nothing worn. */
export function emptyEquipment(): EquipmentState {
  return { owned: [], equipped: {} };
}

/** Key of one payout slot — the anti-farming guard. */
export function grantKey(date: string, exId: string, setIndex: number): string {
  return `${date}|${exId}|${setIndex}`;
}

/** Idempotency key of the energy paid for the completion bonus of a date. */
export function bonusEnergyKey(date: string): string {
  return `bonus|${date}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBodyPart(v: string): v is BodyPart {
  return (BODY_PARTS as readonly string[]).includes(v);
}

function isEquipmentSlot(v: string): v is EquipmentSlot {
  return (EQUIPMENT_SLOTS as readonly string[]).includes(v);
}

/**
 * Fold ONE event into the game state (in place).
 *
 * Only the "authoritative" events change state: `xp_gained`, `energy_gained`,
 * `pr_achieved` (a counter) and `data_cleared` (a reset). `level_up` and
 * `streak_changed` are informational — levels and tiers are DERIVED, so folding
 * them would be double bookkeeping; they exist for the history feed and the UI.
 *
 * IDEMPOTENCY (merge safety)
 * --------------------------
 * The reducer is idempotent per SEMANTIC key, not per event id. Two devices that
 * imported the same legacy file each generated their own retro grants: identical
 * meaning, different uuids. Folding the union of both logs must pay exactly
 * once, so every paying branch checks its ledger BEFORE it adds anything:
 *   `xp_gained` set   -> game.granted[date|exId|setIndex]
 *   `xp_gained` bonus -> game.bonusDays[date]
 *   `pr_achieved`     -> game.prKeys[date|exId|setIndex]
 *   `energy_gained`   -> game.energyGranted[payload.key]
 * An `energy_gained` without a `key` predates v4 and is applied unguarded — old
 * single-device logs replay exactly as they always did.
 */
export function applyGameEvent(game: GameState, type: EventType, payload: Record<string, unknown>): void {
  switch (type) {
    case 'xp_gained': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const exId = typeof payload['exId'] === 'string' ? payload['exId'] : '';
      const setIndex = typeof payload['setIndex'] === 'number' ? payload['setIndex'] : -1;
      const key = date && exId && setIndex >= 0 ? grantKey(date, exId, setIndex) : '';
      const bonus = payload['source'] === 'workout_complete';

      // Already paid for this slot / this date: a duplicate from another device.
      if (key && game.granted[key]) break;
      if (bonus && date && game.bonusDays[date]) break;

      const parts = payload['parts'];
      if (isRecord(parts)) {
        for (const part of Object.keys(parts)) {
          if (!isBodyPart(part)) continue;
          const amount = toNumber(parts[part]);
          if (amount <= 0) continue;
          game.parts[part].xp = round2(game.parts[part].xp + amount);
          game.totalXp = round2(game.totalXp + amount);
        }
      }
      if (key) game.granted[key] = true;

      const volume = toNumber(payload['volume']);
      if (exId && volume > 0) game.best[exId] = Math.max(game.best[exId] ?? 0, volume);

      if (bonus && date) game.bonusDays[date] = true;
      if (payload['retro'] !== true && date && !game.workoutDays.includes(date)) {
        game.workoutDays.push(date);
        game.workoutDays.sort();
      }
      break;
    }
    case 'energy_gained': {
      const key = typeof payload['key'] === 'string' ? payload['key'] : '';
      if (key) {
        if (game.energyGranted[key]) break;
        game.energyGranted[key] = true;
      }
      const amount = toNumber(payload['amount']);
      if (amount > 0) {
        game.energy = round2(game.energy + amount);
        game.energyEarned = round2(game.energyEarned + amount);
      }
      break;
    }
    case 'pr_achieved': {
      const date = typeof payload['date'] === 'string' ? payload['date'] : '';
      const exId = typeof payload['exId'] === 'string' ? payload['exId'] : '';
      const setIndex = typeof payload['setIndex'] === 'number' ? payload['setIndex'] : -1;
      if (date && exId && setIndex >= 0) {
        const key = grantKey(date, exId, setIndex);
        if (game.prKeys[key]) break;
        game.prKeys[key] = true;
      }
      game.prCount += 1;
      break;
    }
    /**
     * One cleared wave: charge the energy, pay the coins, move the marker.
     * The wave/world in the payload is authoritative (the log is the source of
     * truth), so a replay lands on exactly the same spot as the live battle.
     */
    case 'wave_cleared': {
      const b = game.battle;
      const world = Math.max(1, Math.floor(toNumber(payload['world']) || b.world));
      const wave = Math.max(1, Math.floor(toNumber(payload['wave']) || b.wave));
      const spent = Math.max(0, toNumber(payload['energySpent']));
      const coins = Math.max(0, toNumber(payload['coins']));

      game.energy = round2(Math.max(0, game.energy - spent));
      b.coins = round2(b.coins + coins);
      b.wavesCleared += 1;
      if (payload['miniBoss'] === true) b.miniBossesCleared += 1;
      b.world = world;
      b.wave = wave + 1;
      break;
    }
    /**
     * A world boss fell. Same contract as `wave_cleared`: the payload is
     * authoritative, so `nextWorld`/`nextWave` decide where the player lands and
     * an old log keeps replaying identically even if the unlock rule changes.
     * The boss id is recorded once — it is the permanent trophy.
     */
    case 'boss_defeated': {
      const b = game.battle;
      const bossId = typeof payload['bossId'] === 'string' ? payload['bossId'] : '';
      const spent = Math.max(0, toNumber(payload['energySpent']));
      const coins = Math.max(0, toNumber(payload['coins']));

      game.energy = round2(Math.max(0, game.energy - spent));
      b.coins = round2(b.coins + coins);
      if (bossId && !b.bossesDefeated.includes(bossId)) b.bossesDefeated.push(bossId);
      b.world = Math.max(1, Math.floor(toNumber(payload['nextWorld']) || b.world));
      b.wave = Math.max(1, Math.floor(toNumber(payload['nextWave']) || 1));
      break;
    }
    /**
     * A shop purchase. Coins are debited and the item joins `owned` forever —
     * there is no sell-back, so replay is a pure accumulation.
     */
    case 'coins_spent': {
      const b = game.battle;
      const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'] : '';
      const cost = Math.max(0, toNumber(payload['cost']));
      b.coins = round2(Math.max(0, b.coins - cost));
      if (itemId && !game.equipment.owned.includes(itemId)) game.equipment.owned.push(itemId);
      break;
    }
    /** Put an item on, or (with `itemId: null`) take the slot's item off. */
    case 'item_equipped': {
      const slot = typeof payload['slot'] === 'string' ? payload['slot'] : '';
      if (!isEquipmentSlot(slot)) break;
      const itemId = typeof payload['itemId'] === 'string' ? payload['itemId'] : null;
      if (itemId === null) delete game.equipment.equipped[slot];
      else game.equipment.equipped[slot] = itemId;
      break;
    }
    case 'data_cleared': {
      const fresh = emptyGame();
      Object.assign(game, fresh);
      break;
    }
    // Derived / not owned by the game state — see the doc comment above.
    default:
      break;
  }
}

/** Recompute every derived field (levels, headline level, streak). */
export function finalizeGame(game: GameState, today: string): void {
  for (const part of BODY_PARTS) {
    game.parts[part].level = levelForXp(game.parts[part].xp);
  }
  game.level = characterLevel(game.parts);
  game.streak = computeStreak(game.workoutDays, today);
}

/**
 * THE total order of the event log: `ts` ascending, ties broken by `id`.
 *
 * The id tie-break is what makes the order a property of the event SET rather
 * than of the insertion order, so two devices that hold the same events fold
 * them identically no matter how or when each of them received them.
 */
export function compareEvents(a: AppEvent, b: AppEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Deterministically rebuild the whole game layer from the event log. */
export function rebuildGame(events: readonly AppEvent[], today: string): GameState {
  const game = emptyGame();
  const ordered = [...events].sort(compareEvents);
  for (const ev of ordered) applyGameEvent(game, ev.type, ev.payload);
  finalizeGame(game, today);
  return game;
}

/* --------------------------------------------------------- grant builders */

/** An event that is about to be appended: `{type, payload}` plus its timestamp. */
export interface PendingEvent {
  type: EventType;
  payload: Record<string, unknown>;
  ts: number;
}

function levelUpEvents(
  before: PartsProgress,
  parts: Partial<Record<BodyPart, number>>,
  meta: { date: string; retro: boolean; ts: number },
): PendingEvent[] {
  const out: PendingEvent[] = [];
  let offset = 0;
  for (const part of BODY_PARTS) {
    const gain = parts[part];
    if (!gain || gain <= 0) continue;
    const from = levelForXp(before[part].xp);
    const to = levelForXp(before[part].xp + gain);
    if (to > from) {
      out.push({
        type: 'level_up',
        payload: { date: meta.date, part, from, to, retro: meta.retro },
        ts: meta.ts + offset,
      });
      offset += 1;
    }
  }
  return out;
}

export interface SetGrantArgs {
  date: string;
  day: DayKey;
  ex: Exercise;
  setIndex: number;
  w: string;
  r: string;
  /** Retro grants pay XP + PRs but no energy and no streak day. */
  retro: boolean;
  /** Timestamp of the first emitted event (siblings get +1ms each). */
  ts: number;
}

/**
 * Events for completing ONE set. Returns `[]` when this exact
 * (date, exercise, set) already paid out — the anti-farming guard.
 */
export function buildSetGrant(game: GameState, a: SetGrantArgs): PendingEvent[] {
  if (game.granted[grantKey(a.date, a.ex.id, a.setIndex)]) return [];

  const volume = setVolume(a.w, a.r);
  const previousBest = game.best[a.ex.id] ?? 0;
  const res = xpForSet(volume, previousBest);
  const parts = splitXp(res.xp, a.ex);

  const events: PendingEvent[] = [
    {
      type: 'xp_gained',
      payload: {
        date: a.date,
        day: a.day,
        exId: a.ex.id,
        setIndex: a.setIndex,
        source: 'set',
        parts,
        total: res.xp,
        volume,
        factor: res.factor,
        pr: res.pr,
        retro: a.retro,
      },
      ts: a.ts,
    },
  ];
  if (res.pr) {
    events.push({
      type: 'pr_achieved',
      payload: {
        date: a.date,
        exId: a.ex.id,
        setIndex: a.setIndex,
        volume,
        previousBest,
        retro: a.retro,
      },
      ts: a.ts + 1,
    });
  }
  if (!a.retro) {
    events.push({
      type: 'energy_gained',
      payload: {
        date: a.date,
        amount: BALANCE.energy.perSet,
        source: 'set',
        retro: false,
        key: grantKey(a.date, a.ex.id, a.setIndex),
      },
      ts: a.ts + 2,
    });
  }
  events.push(...levelUpEvents(game.parts, parts, { date: a.date, retro: a.retro, ts: a.ts + 3 }));
  return events;
}

export interface WorkoutGrantArgs {
  date: string;
  day: DayKey;
  retro: boolean;
  ts: number;
}

/**
 * Events for finishing every set of every exercise of a day: a flat XP bonus to
 * EVERY body part plus bonus battle energy. Guarded once per date.
 */
export function buildWorkoutCompletionGrant(game: GameState, a: WorkoutGrantArgs): PendingEvent[] {
  if (game.bonusDays[a.date]) return [];
  const parts = completionSplit();
  let total = 0;
  for (const part of BODY_PARTS) total = round2(total + (parts[part] ?? 0));

  const events: PendingEvent[] = [
    {
      type: 'xp_gained',
      payload: {
        date: a.date,
        day: a.day,
        source: 'workout_complete',
        parts,
        total,
        retro: a.retro,
      },
      ts: a.ts,
    },
  ];
  if (!a.retro) {
    events.push({
      type: 'energy_gained',
      payload: {
        date: a.date,
        amount: BALANCE.energy.perWorkout,
        source: 'workout_complete',
        retro: false,
        key: bonusEnergyKey(a.date),
      },
      ts: a.ts + 1,
    });
  }
  events.push(...levelUpEvents(game.parts, parts, { date: a.date, retro: a.retro, ts: a.ts + 2 }));
  return events;
}

/** Apply a batch of pending events to a game state (used by both paths). */
export function applyPending(game: GameState, events: readonly PendingEvent[]): void {
  for (const e of events) applyGameEvent(game, e.type, e.payload);
}

/* ----------------------------------------------------- retroactive grants */

function doneSetsOf(arr: readonly (SetEntry | null)[] | undefined): number[] {
  if (!arr) return [];
  const out: number[] = [];
  arr.forEach((s, i) => {
    if (s?.done) out.push(i);
  });
  return out;
}

function sessionComplete(session: Session): boolean {
  const program = PROGRAM[session.day];
  return program.exercises.every((ex) => doneSetsOf(session.ex[ex.id]).length >= ex.sets);
}

/** Program order first (stable + meaningful), then any unknown ids, sorted. */
function exerciseOrder(session: Session): string[] {
  const inProgram = PROGRAM[session.day].exercises.map((e) => e.id).filter((id) => session.ex[id]);
  const rest = Object.keys(session.ex)
    .filter((id) => !inProgram.includes(id))
    .sort();
  return [...inProgram, ...rest];
}

/**
 * Generate the XP grants for history that never went through the game layer
 * (legacy import, JSON import, or workouts logged under Phase 0).
 *
 * Deterministic: dates ascending, exercises in program order, sets by index.
 * Each event is stamped at its own workout date (00:00 UTC + a per-event offset)
 * so the log stays chronological and `best`/PR detection replays correctly.
 * Already-granted sets are skipped, so running this twice is a no-op.
 */
export function buildRetroactiveGrants(
  sessions: Readonly<Record<string, Session>>,
  existing: readonly AppEvent[],
  today: string,
): PendingEvent[] {
  const scratch = rebuildGame(existing, today);
  const out: PendingEvent[] = [];

  for (const date of Object.keys(sessions).sort()) {
    const session = sessions[date];
    if (!session) continue;
    let offset = 0;
    const baseTs = isoToTs(date);

    for (const exId of exerciseOrder(session)) {
      const ex = findExercise(exId);
      if (!ex) continue; // an exercise the program no longer has — no XP mapping
      for (const setIndex of doneSetsOf(session.ex[exId])) {
        const entry = session.ex[exId]?.[setIndex];
        if (!entry) continue;
        const events = buildSetGrant(scratch, {
          date,
          day: session.day,
          ex,
          setIndex,
          w: entry.w,
          r: entry.r,
          retro: true,
          ts: baseTs + offset,
        });
        if (events.length === 0) continue;
        offset += 10;
        applyPending(scratch, events);
        out.push(...events);
      }
    }

    if (sessionComplete(session)) {
      const bonus = buildWorkoutCompletionGrant(scratch, {
        date,
        day: session.day,
        retro: true,
        ts: baseTs + offset,
      });
      if (bonus.length > 0) {
        applyPending(scratch, bonus);
        out.push(...bonus);
      }
    }
  }

  return out;
}

/* ------------------------------------------------------- derived stats */

/**
 * PROVISIONAL combat stats derived from the six part levels + the streak buff.
 * Phase 1 only DISPLAYS these; Phase 2 (`core/combat.ts`) consumes them.
 */
export interface CharacterStats {
  /** chest */ atk: number;
  /** back */ def: number;
  /** legs */ maxHp: number;
  /** shoulders — ms between auto attacks (lower is faster) */ attackIntervalMs: number;
  /** arms */ critChance: number;
  /** arms */ critMultiplier: number;
  /** core — hp per tick */ regen: number;
  /** `1 + 0.1 × streak tier`, already applied to the numbers above. */
  buff: number;
}

/**
 * The six part levels + the streak buff + (Phase 3) the equipped gear.
 *
 * ORDER MATTERS and is deliberate: the gear bonus is added to the level-derived
 * value and the streak buff multiplies the SUM, so a perfect week makes your
 * equipment better too. Equipment can never carry the character on its own —
 * the level term is always the dominant one.
 */
export function deriveStats(
  parts: PartsProgress,
  streakTier: number,
  bonus: ResolvedBonus = zeroBonus(),
): CharacterStats {
  const s = BALANCE.stats;
  const buff = streakMultiplier(streakTier);
  const lv = (p: BodyPart): number => Math.max(0, parts[p].level - 1);
  return {
    atk: round2((s.atkBase + s.atkPerLevel * lv('chest') + bonus.atk) * buff),
    def: round2((s.defBase + s.defPerLevel * lv('back') + bonus.def) * buff),
    maxHp: Math.round((s.hpBase + s.hpPerLevel * lv('legs') + bonus.hp) * buff),
    attackIntervalMs: Math.round(
      Math.max(
        s.attackIntervalMinMs,
        s.attackIntervalBaseMs + bonus.attackIntervalMs - s.attackIntervalPerLevelMs * lv('shoulders') * buff,
      ),
    ),
    critChance: round2(
      Math.min(s.critChanceMax, (s.critChanceBase + s.critChancePerLevel * lv('arms') + bonus.critChance) * buff),
    ),
    critMultiplier: round2((s.critMultiplierBase + s.critMultiplierPerLevel * lv('arms') + bonus.critMultiplier) * buff),
    regen: round2((s.regenBase + s.regenPerLevel * lv('core') + bonus.regen) * buff),
    buff: round2(buff),
  };
}

/** The item ids actually worn right now (a slot may be empty). */
export function equippedIds(game: GameState): string[] {
  const out: string[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const id = game.equipment.equipped[slot];
    if (id && equipmentById(id)) out.push(id);
  }
  return out;
}

/** The summed bonus of everything currently worn. */
export function equippedBonus(game: GameState): ResolvedBonus {
  return sumEquipBonus(equippedIds(game));
}

/** THE stat function the UI and the battle engine both call. */
export function statsOfGame(game: GameState): CharacterStats {
  return deriveStats(game.parts, game.streak.tier, equippedBonus(game));
}

/* ------------------------------------------------------------- shop rules */

/** Why a purchase was refused — the UI turns this into Hebrew. */
export type PurchaseError = 'unknown_item' | 'already_owned' | 'insufficient_coins';

export interface PurchasePlan {
  ok: boolean;
  error?: PurchaseError;
  events: PendingEvent[];
}

/**
 * Plan a shop purchase. PURE: it decides, it does not spend. The coin check
 * lives here (not in the UI) so a replay of the log can never produce a negative
 * purse and a crafted click cannot buy something the player cannot afford.
 */
export function buildPurchase(game: GameState, itemId: string, date: string, ts: number): PurchasePlan {
  const def = equipmentById(itemId);
  if (!def) return { ok: false, error: 'unknown_item', events: [] };
  if (game.equipment.owned.includes(itemId)) return { ok: false, error: 'already_owned', events: [] };
  if (game.battle.coins < def.cost) return { ok: false, error: 'insufficient_coins', events: [] };
  return {
    ok: true,
    events: [
      { type: 'coins_spent', payload: { date, itemId, slot: def.slot, cost: def.cost }, ts },
      // Buying always equips: one tap, one obvious result.
      { type: 'item_equipped', payload: { date, slot: def.slot, itemId }, ts: ts + 1 },
    ],
  };
}

/**
 * Plan an equip (`itemId`) or unequip (`null`). Only OWNED items can be worn,
 * and re-equipping what is already on is a no-op (no event, no log noise).
 */
export function buildEquip(
  game: GameState,
  slot: EquipmentSlot,
  itemId: string | null,
  date: string,
  ts: number,
): PendingEvent[] {
  if (itemId !== null) {
    const def = equipmentById(itemId);
    if (!def || def.slot !== slot || !game.equipment.owned.includes(itemId)) return [];
  }
  const current = game.equipment.equipped[slot] ?? null;
  if (current === itemId) return [];
  return [{ type: 'item_equipped', payload: { date, slot, itemId }, ts }];
}
