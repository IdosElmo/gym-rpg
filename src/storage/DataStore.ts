/**
 * DataStore — the ONLY way the app is allowed to touch persistence.
 *
 * UI code must never read/write `localStorage` directly. Everything goes through
 * this interface so that a cloud backend (Supabase, …) can be dropped in later
 * without touching the UI: implement `DataStore` and swap it in `main.ts`.
 *
 * Two things are persisted side by side:
 *   1. the current state snapshot (`AppState`) — fast reads for rendering;
 *   2. an append-only `EventLog` — the source of truth for future sync/merge.
 * Both blobs carry a `schemaVersion` and are read through `storage/migrate.ts`.
 */

import type { BodyPart, DayKey } from '../data/program.ts';

/* ------------------------------------------------------------------ state */

/** One logged set. Values stay STRINGS, exactly like the legacy app. */
export interface SetEntry {
  w: string;
  r: string;
  done: boolean;
}

/**
 * A day's session. Arrays are sparse-tolerant (`null` holes) because the legacy
 * format created set slots on demand — kept as-is so imports are lossless.
 */
export interface Session {
  day: DayKey;
  ex: Record<string, (SetEntry | null)[]>;
}

/** `A|B|C` = workout days, `CH` = דמות, `BT` = קרב (battle), `H` = היסטוריה. */
export type ViewKey = DayKey | 'CH' | 'BT' | 'H';

export interface UiState {
  view: ViewKey;
  open: Record<string, boolean>;
}

/* -------------------------------------------------------------- game state */

/**
 * Version of the `GameState` blob. Bump it when the shape below changes and add
 * a step to `GAME_MIGRATIONS` in `storage/migrate.ts` — an unrecognised version
 * is simply rebuilt from the event log, which is always the source of truth.
 */
export const GAME_STATE_VERSION = 2;

/** XP pool of one body part. `level` is DERIVED from `xp` (see core/xp.ts). */
export interface PartProgress {
  xp: number;
  level: number;
}

export type PartsProgress = Record<BodyPart, PartProgress>;

export interface StreakState {
  /** Permanent stacking tier; +10% all stats per tier. */
  tier: number;
  /** ISO date (Sunday) of the week currently in progress. */
  weekStart: string | null;
  /** Distinct workout days logged so far in the current week. */
  daysThisWeek: number;
  /** Days needed for a "perfect week". */
  needed: number;
}

/**
 * Battle progress (Phase 2). Every field is folded from `wave_cleared` events,
 * so it replays exactly like the rest of the game state.
 *
 * There is deliberately NO RNG state here: a battle session is seeded when the
 * קרב tab opens and each cleared wave records the seed it ran with, which keeps
 * "live state === rebuildFromEvents(log)" trivially true.
 */
export interface BattleProgress {
  /** Current world (1-based, see WORLDS in data/gameContent.ts). */
  world: number;
  /** Next wave to fight inside that world (1-based). */
  wave: number;
  /** Coins earned from waves — the Phase 3 shop spends them. */
  coins: number;
  /** Lifetime counters, for the history feed and future trophies. */
  wavesCleared: number;
  miniBossesCleared: number;
}

/**
 * The whole game layer. Every field is deterministically derivable by replaying
 * the event log (`rebuildGame` in `core/xp.ts`), so this blob is a cache — if it
 * is ever missing or from an unknown version it is simply rebuilt.
 */
export interface GameState {
  version: number;
  parts: PartsProgress;
  /** Headline character level = floor(average of the six part levels). */
  level: number;
  totalXp: number;
  /** Battle energy available to spend (Phase 2 consumes it). */
  energy: number;
  /** Lifetime energy earned — never spent, for stats/achievements. */
  energyEarned: number;
  prCount: number;
  /** exerciseId -> best volume (weight×reps) ever granted, for PR + volumeFactor. */
  best: Record<string, number>;
  /** "date|exId|setIndex" of every set that already paid out — the anti-farm guard. */
  granted: Record<string, true>;
  /** Dates that already received the workout-completion bonus. */
  bonusDays: Record<string, true>;
  /** Distinct dates of LIVE (non-retroactive) training — the streak source. */
  workoutDays: string[];
  streak: StreakState;
  /** Phase 2 — battle progress (world / wave / coins). */
  battle: BattleProgress;
}

export interface AppMeta {
  /** Whether the legacy `hyp3_data_v1` blob was already imported. */
  legacyImported: boolean;
  /** ms epoch of the legacy import, if it happened. */
  legacyImportedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppState {
  schemaVersion: number;
  sessions: Record<string, Session>;
  ui: UiState;
  game: GameState | null;
  meta: AppMeta;
}

/* ------------------------------------------------------------------ events */

/**
 * Append-only event types. Phase 0 emits the workout + import ones; the game
 * phases add their own without changing the log format.
 */
export type EventType =
  // Phase 0 — workout & data lifecycle
  | 'set_logged'
  | 'set_completed'
  | 'set_uncompleted'
  | 'workout_finished'
  | 'legacy_import'
  | 'session_imported'
  | 'data_imported'
  | 'data_cleared'
  // Phase 1 — game layer (XP / levels / streak)
  | 'xp_gained'
  | 'energy_gained'
  | 'level_up'
  | 'pr_achieved'
  | 'streak_changed'
  // Phase 2 — battle. ONE event per cleared wave; attack ticks are never events.
  | 'wave_cleared'
  // Phase 3 — reserved
  | 'boss_defeated'
  | 'item_equipped';

export interface AppEvent {
  readonly id: string;
  /** epoch ms */
  readonly ts: number;
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventLog {
  schemaVersion: number;
  events: AppEvent[];
}

/** Payload shapes emitted by Phase 0 (documented for downstream phases). */
export interface SetEventPayload extends Record<string, unknown> {
  date: string;
  day: DayKey;
  exId: string;
  setIndex: number;
  w: string;
  r: string;
}

export interface SessionImportedPayload extends Record<string, unknown> {
  date: string;
  day: DayKey;
  ex: Record<string, (SetEntry | null)[]>;
  source: 'legacy_v1' | 'json_import' | 'recovered';
}

/* ------------------------------------------------ Phase 1 game payloads */

/** Where an XP grant came from. */
export type XpSource = 'set' | 'workout_complete';

/**
 * THE authoritative XP record: replaying these rebuilds `GameState` exactly.
 * `retro: true` marks XP granted for history that predates the game layer —
 * it pays XP but never energy and never feeds the streak.
 */
export interface XpGainedPayload extends Record<string, unknown> {
  date: string;
  day?: DayKey;
  exId?: string;
  setIndex?: number;
  source: XpSource;
  /** part -> xp; the parts always come from `bodyPartWeights(exercise)`. */
  parts: Partial<Record<BodyPart, number>>;
  total: number;
  /** weight×reps of the set (0 for the completion bonus) — feeds `best`. */
  volume?: number;
  factor?: number;
  pr?: boolean;
  retro: boolean;
}

export interface EnergyGainedPayload extends Record<string, unknown> {
  date: string;
  amount: number;
  source: XpSource;
  retro: boolean;
}

export interface PrAchievedPayload extends Record<string, unknown> {
  date: string;
  exId: string;
  setIndex: number;
  volume: number;
  previousBest: number;
  retro: boolean;
}

export interface LevelUpPayload extends Record<string, unknown> {
  date: string;
  part: BodyPart;
  from: number;
  to: number;
  retro: boolean;
}

export interface StreakChangedPayload extends Record<string, unknown> {
  from: number;
  to: number;
  weekStart: string | null;
}

/* ----------------------------------------------- Phase 2 battle payloads */

/**
 * THE battle record — emitted once per cleared wave and nothing else.
 *
 * Individual attacks are NOT events: they are a deterministic function of
 * `seed` (see core/combat.ts) and logging them would bloat the log by three
 * orders of magnitude. This one payload carries everything the state needs:
 * where the player is, what it cost and what it paid.
 */
export interface WaveClearedPayload extends Record<string, unknown> {
  date: string;
  world: number;
  wave: number;
  miniBoss: boolean;
  enemyId: string;
  coins: number;
  /** ⚡ charged for this wave (charged on CLEAR, never on a defeat). */
  energySpent: number;
  /** Seed the cleared attempt ran with — makes the fight replayable. */
  seed: number;
  durationMs: number;
}

/* ------------------------------------------------------------------ store */

export type Unsubscribe = () => void;

export interface DataStore {
  /** Current state snapshot (already migrated). */
  getState(): AppState;
  /** Persist a whole new state and notify subscribers. */
  save(next: AppState): void;
  /** Mutate the state in place and persist + notify. Returns the new state. */
  update(mutate: (draft: AppState) => void): AppState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: AppState) => void): Unsubscribe;
  /** Append one event to the log. Returns the stored event (id + ts filled). */
  append(type: EventType, payload?: Record<string, unknown>): AppEvent;
  /** The whole append-only log, oldest first. */
  getEvents(): readonly AppEvent[];
  /** Replace both state and log (used by JSON import). */
  replaceAll(state: AppState, events: readonly AppEvent[]): void;
  /** Wipe everything (keeps a `data_cleared` event in the fresh log). */
  clear(): void;
}
