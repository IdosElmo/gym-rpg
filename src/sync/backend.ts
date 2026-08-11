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
