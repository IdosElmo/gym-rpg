/**
 * DataStore — the ONLY way the app is allowed to touch persistence.
 *
 * UI code must never read/write `localStorage` directly. Everything goes through
 * this interface so that a cloud backend (Supabase, …) can be dropped in later
 * without touching the UI: implement `DataStore` and swap it in `main.ts`.
 *
 * Two things are persisted side by side:
 *   1. the current state snapshot (`AppState`) — fast reads for rendering;
 *   2. an append-only `EventLog` — the source of truth, and what cloud sync
 *      merges (`storage/merge.ts`, `sync/engine.ts`).
 * Both blobs carry a `schemaVersion` and are read through `storage/migrate.ts`.
 */

import type { EquipmentSlot } from '../data/gameContent.ts';
import type { PlanDoc } from '../data/planTypes.ts';
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

/**
 * `A|B|C` = workout days, `CH` = דמות, `BT` = קרב (battle), `H` = היסטוריה,
 * `PL` = תוכנית (the plan editor).
 *
 * `PL` deliberately has NO tab in the main nav: six tabs is already the limit
 * of what stays tappable one-handed on a phone. It is reached from the ⚙️
 * button in the workout header and from the plan card on the history screen.
 */
export type ViewKey = DayKey | 'CH' | 'BT' | 'H' | 'PL';

export interface UiState {
  view: ViewKey;
  open: Record<string, boolean>;
}

/* -------------------------------------------------------------- game state */

/**
 * Version of the `GameState` blob. Bump it when the shape below changes — an
 * unrecognised version is rejected by `normalizeGame` and simply REBUILT from
 * the event log, which is always the source of truth. That rebuild is the
 * sanctioned migration path for this blob (see `ensureGameState`).
 *
 * v4 (merge-safe core) added the idempotency ledgers `energyGranted` + `prKeys`.
 */
export const GAME_STATE_VERSION = 4;

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
  /** Coins earned from waves and bosses — the shop spends them. */
  coins: number;
  /** Lifetime counters, for the history feed and the trophy shelf. */
  wavesCleared: number;
  miniBossesCleared: number;
  /**
   * Ids of the world bosses already defeated, in the order they fell. Each one
   * is a permanent trophy on the character screen, and the LAST world's boss
   * additionally switches world 4 into its endless "champion" mode.
   */
  bossesDefeated: string[];
}

/** Owned + equipped shop items. Both are folded from the event log. */
export interface EquipmentState {
  /** Every item id ever bought (purchases are permanent). */
  owned: string[];
  /** slot -> item id currently worn. A missing slot means "nothing worn". */
  equipped: Partial<Record<EquipmentSlot, string>>;
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
  /**
   * Keys of every `energy_gained` event that was already paid (`key` field of
   * the payload: the grant key for a set, `bonus|<date>` for a completion).
   * Merging two devices' logs can produce semantically duplicate grants with
   * DIFFERENT event ids; this ledger is what stops them paying twice.
   * Events WITHOUT a `key` (logs written before v4) apply unguarded.
   */
  energyGranted: Record<string, true>;
  /** "date|exId|setIndex" of every `pr_achieved` already counted (same reason). */
  prKeys: Record<string, true>;
  /** Distinct dates of LIVE (non-retroactive) training — the streak source. */
  workoutDays: string[];
  streak: StreakState;
  /** Phase 2 — battle progress (world / wave / coins / bosses). */
  battle: BattleProgress;
  /** Phase 3 — the coin shop's owned + equipped items. */
  equipment: EquipmentState;
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
  /**
   * The user's edited training plan, or `null` for "the built-in program".
   *
   * Like `game`, this is a CACHE of the log: it is folded from `plan_updated`
   * events (last one in the `(ts, id)` order wins) by `rebuildFromEvents`.
   * `null` is not an error state — it is the normal state of anyone who never
   * opened the plan editor, and `resolveProgram(null)` returns the built-in
   * `PROGRAM` object itself, so nothing about the app changes until a save.
   */
  plan: PlanDoc | null;
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
  // Phase 3 — world bosses and the coin shop
  | 'boss_defeated'
  | 'coins_spent'
  | 'item_equipped'
  // Phase 4 — editable plans and multi-device merges (declared here so an older
  // build can already round-trip them; both reducers ignore what they don't know)
  | 'plan_updated'
  | 'data_merged';

export interface AppEvent {
  readonly id: string;
  /** epoch ms */
  readonly ts: number;
  readonly type: EventType;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Id of the install that created the event (`LocalStore` stamps it). Optional:
   * events written before the device id existed simply have none. It is never
   * used for ordering — the total order is `(ts, id)` — only for bookkeeping
   * (e.g. "which of my own events may I clamp a clock against").
   */
  readonly device?: string;
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
  /**
   * Idempotency key: `date|exId|setIndex` for a set, `bonus|<date>` for the
   * workout-completion bonus. Optional ONLY for backward compatibility with
   * logs written before v4 — every new event carries one.
   */
  key?: string;
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

/* ------------------------------------------- Phase 3 boss / shop payloads */

/**
 * A world boss went down. Like `wave_cleared`, the payload is AUTHORITATIVE:
 * `nextWorld`/`nextWave` say exactly where the player lands, so a replay never
 * has to re-derive the unlock rule (and old logs keep replaying if it changes).
 */
export interface BossDefeatedPayload extends Record<string, unknown> {
  date: string;
  world: number;
  wave: number;
  bossId: string;
  coins: number;
  energySpent: number;
  seed: number;
  durationMs: number;
  /** Where the battle continues: the next world at wave 1, or endless mode. */
  nextWorld: number;
  nextWave: number;
  /** True when this was the LAST world's boss — world 4 turns endless. */
  endgame: boolean;
}

/** A shop purchase. Coins leave the purse and the item joins `owned`. */
export interface CoinsSpentPayload extends Record<string, unknown> {
  date: string;
  itemId: string;
  slot: EquipmentSlot;
  cost: number;
}

/** An item was put on (`itemId`) or taken off (`itemId: null`). */
export interface ItemEquippedPayload extends Record<string, unknown> {
  date: string;
  slot: EquipmentSlot;
  itemId: string | null;
}

/* ------------------------------------------- Phase 4 plan / merge payloads */

/**
 * A saved training plan — LWW by fold order: the LAST `plan_updated` in the
 * total `(ts, id)` order wins, and `data_cleared` resets the plan to `null`.
 * `plan: null` means "the built-in program", so a client that has never edited
 * anything (or that reset) is byte-identical to the original app.
 *
 * The document is carried WHOLE on purpose: a merge then has nothing to
 * reconcile field by field, and an old client that doesn't know the type simply
 * ignores the event (both reducers `default: break`).
 *
 * `plan` is deliberately typed as a plain JSON record rather than as `PlanDoc`:
 * this is the WIRE shape, and a payload that arrived from another device (or
 * from a newer app version) is untrusted until `normalizePlanDoc` has seen it.
 */
export interface PlanUpdatedPayload extends Record<string, unknown> {
  plan: Readonly<Record<string, unknown>> | null;
  /**
   * Bumped on every save (`max(local, incoming) + 1`). Bookkeeping only — the
   * authoritative order is the log's, never this number.
   */
  revision: number;
  /** ISO date of the save, like every other payload in the log. */
  date: string;
}

/**
 * A bookkeeping marker written when a foreign event set was folded into this
 * device's log (cloud pull, or an additive JSON import). DECLARED ONLY: it
 * changes no state, it exists so the history feed can explain a jump in XP.
 */
export interface DataMergedPayload extends Record<string, unknown> {
  source: 'sync' | 'json_import';
  /** How many events the merge actually added (already deduped by id). */
  added: number;
  /** Device the events came from, when they all share one. */
  from?: string;
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
  /**
   * Subscribe to every event the store APPENDS (including the synthetic
   * `data_cleared` of `clear()`). This is the sync engine's tap into the write
   * path — it never fires for events that arrived from elsewhere via
   * `replaceAll`, so a merged-in event can't be pushed back as if it were local.
   */
  subscribeEvents(listener: (ev: AppEvent) => void): Unsubscribe;
  /** Append one event to the log. Returns the stored event (id + ts filled). */
  append(type: EventType, payload?: Record<string, unknown>): AppEvent;
  /** The whole append-only log, oldest first. */
  getEvents(): readonly AppEvent[];
  /** Replace both state and log (JSON import, and every cloud merge). */
  replaceAll(state: AppState, events: readonly AppEvent[]): void;
  /** Wipe everything (keeps a `data_cleared` event in the fresh log). */
  clear(): void;
}
