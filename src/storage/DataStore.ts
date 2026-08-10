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

import type { DayKey } from '../data/program.ts';

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

export type ViewKey = DayKey | 'H';

export interface UiState {
  view: ViewKey;
  open: Record<string, boolean>;
}

/**
 * Game state slot. Phase 1 (XP/character) and Phase 2+ (battle) fill this in.
 * Deliberately opaque for now: Phase 0 only guarantees it round-trips through
 * save/load/export/import untouched.
 */
export interface GameState {
  readonly [key: string]: unknown;
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
  // Phase 1+ — game layer (reserved)
  | 'xp_gained'
  | 'level_up'
  | 'pr_achieved'
  | 'streak_changed'
  | 'battle_won'
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
  source: 'legacy_v1' | 'json_import';
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
