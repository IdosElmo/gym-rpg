/**
 * sync/backend.ts — THE SEAM between the sync engine and the outside world.
 *
 * The engine (`sync/engine.ts`) knows nothing about Supabase, HTTP, PostgREST or
 * OAuth: it talks to these two tiny interfaces. `sync/supabaseBackend.ts`
 * implements them for real; `tests/sync.engine.test.ts` implements them with a
 * `Map`. That is the whole reason the engine is testable without a network — and
 * the reason `@supabase/supabase-js` is imported from exactly one module.
 *
 * Both interfaces are deliberately minimal. Everything the engine needs is:
 * "put these events somewhere" and "give me what I haven't seen yet".
 */

import type { LeagueWeekUpload } from '../core/leagueSync.ts';
import type { AppEvent, Unsubscribe } from '../storage/DataStore.ts';

/** One page of remote events, in ascending server order. */
export interface PullPage {
  /** The events themselves, already validated by the backend adapter. */
  events: AppEvent[];
  /**
   * Cursor to resume from: the `seq` of the last row in `events`, or the
   * `afterSeq` that was passed in when the page came back empty. The engine
   * stores this verbatim and never invents a cursor of its own.
   */
  lastSeq: number;
}

/**
 * One row of the `ghosts` table — another account's published character.
 *
 * `payload` is deliberately typed as a bare record: the backend is a dumb pipe
 * and must NOT understand what it carries. Every field is untrusted input
 * written by another client, and `core/ghost.ts` (`normalizeGhost`) is the one
 * place it is allowed to become numbers.
 */
export interface GhostRow {
  handle: string;
  payload: Record<string, unknown>;
  /** ms epoch of the last publish, when the backend knows it. */
  updatedAt: number | null;
}

/**
 * One row of the `league_weeks` table, VERBATIM as the database handed it over.
 *
 * A bare record for the same reason `GhostRow.payload` is one: the backend is a
 * dumb pipe and must not understand what it carries. It does not even rename the
 * columns — `core/leagueSync.ts` (`normalizeLeagueRow`) reads `week_key` and
 * `weekKey` alike, and it is the one place these values are allowed to become
 * numbers.
 */
export type LeagueRawRow = Record<string, unknown>;

export interface SyncBackend {
  /**
   * Store events for `userId`. MUST be idempotent per event id — the engine
   * retries freely after a network failure and cannot know whether the failed
   * request reached the server. Resolving means "all of these are durable"; the
   * engine then drops them from its outbox.
   */
  pushEvents(userId: string, events: readonly AppEvent[]): Promise<void>;
  /**
   * Fetch at most `limit` events with a server sequence greater than
   * `afterSeq`, oldest first. A full page means "there may be more".
   */
  pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage>;

  /**
   * Upsert THIS user's ghost row (their handle + character snapshot).
   *
   * A ghost is presence data, not history: it is a side-channel snapshot that
   * lives beside the log and is overwritten in place, never appended to. The
   * event log stays the single source of truth for the account's OWN state —
   * nothing about a ghost is ever folded back into it, on this device or any
   * other, which is why publishing can fail forever without costing the user
   * anything but visibility.
   *
   * Rejecting because the handle is taken by somebody else is a normal outcome:
   * the caller surfaces it in Hebrew. Anything else is a network problem.
   */
  publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void>;

  /**
   * Look up a ghost by EXACT handle (already canonical — see `core/handle.ts`),
   * or `null` when nobody answers to it. This is the whole discovery surface:
   * there is no listing, no search and no way to enumerate accounts.
   */
  fetchGhost(handle: string): Promise<GhostRow | null>;

  /**
   * Upsert MY closed league weeks under `handle`, keyed `(user_id, week_key)`.
   *
   * IDEMPOTENT BY CONSTRUCTION: publishing the same week twice overwrites one
   * row rather than adding a second, so the engine may retry a batch freely and
   * a rename simply rewrites the rows it owns under the new name.
   *
   * Like a ghost, a league row is a side channel beside the log and never in it
   * (`core/leagueSync.ts`): failing forever costs the user visibility on the
   * leaderboard and nothing else, which is why the engine swallows the error.
   */
  publishLeagueWeeks(userId: string, handle: string, rows: readonly LeagueWeekUpload[]): Promise<void>;

  /**
   * Every row somebody published for ONE month under an EXACT handle (already
   * canonical — see `core/handle.ts`). Four or five rows; an empty array means
   * "that name has published nothing for that month", which is an ordinary
   * answer and not a failure.
   *
   * The rows are UNTRUSTED input written by another client: they are only ever
   * read through `normalizeLeagueRow`.
   */
  fetchLeagueMonth(handle: string, monthKey: string): Promise<LeagueRawRow[]>;
}

/**
 * Thrown by `publishGhost` when the handle belongs to somebody else. It is a
 * user-fixable conflict (pick another name), never a reason to retry.
 */
export class GhostHandleTakenError extends Error {
  constructor(message = 'handle taken') {
    super(message);
    this.name = 'GhostHandleTakenError';
  }
}

/** True for "that name is taken", as opposed to "the network failed". */
export function isHandleTaken(err: unknown): boolean {
  return err instanceof GhostHandleTakenError;
}

/** The signed-in identity, as little of it as the UI needs. */
export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthPort {
  /** The current session's user, or `null` when signed out. */
  getUser(): Promise<AuthUser | null>;
  /** Start the Google OAuth flow. Usually navigates away and never resolves. */
  signInWithGoogle(): Promise<void>;
  /** End the session. Local app data is untouched — that is the engine's job. */
  signOut(): Promise<void>;
  /** Subscribe to sign-in / sign-out, including the session restored on load. */
  onChange(cb: (user: AuthUser | null) => void): Unsubscribe;
}

/**
 * Thrown by a backend when the SESSION is the problem (expired/revoked token,
 * RLS rejection) rather than the network. The engine treats it specially: it
 * stops retrying and reports `reauth`, because retrying a dead token forever
 * only burns battery and never succeeds.
 */
export class SyncAuthError extends Error {
  constructor(message = 'auth expired') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

/** True for errors that mean "sign in again", not "try again later". */
export function isAuthError(err: unknown): boolean {
  return err instanceof SyncAuthError;
}
