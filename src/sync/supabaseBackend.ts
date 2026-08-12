/**
 * sync/supabaseBackend.ts — the ONE module that knows Supabase exists.
 *
 * Everything else in `src/sync/` talks to the two interfaces in `backend.ts`.
 * This file is the single place `@supabase/supabase-js` is imported, and it is
 * wired in from `main.ts` alone — which is why the jsdom tests (which mount the
 * real screens) never pull an OAuth client, a fetch polyfill or a WebSocket
 * shim into a test process, and why replacing the backend one day means
 * replacing this file and nothing else.
 *
 * WHAT IT IMPLEMENTS
 *   push — `upsert(rows, {onConflict: 'user_id,id', ignoreDuplicates: true})`,
 *          i.e. `insert … on conflict do nothing`: retrying a batch is free.
 *   pull — `seq > cursor order by seq asc limit n`, the cursor the schema's
 *          counter trigger makes safe (see `supabase/schema.sql`).
 *   auth — Google OAuth over PKCE, which is the flow for a static site with no
 *          server and therefore no client secret to keep.
 *   ghosts — upsert MY one row (`user_id` primary key) and look somebody else
 *          up by EXACT handle. That table is the ghost-duel sharing mechanism:
 *          readable by every signed-in user, writable only by its owner, and it
 *          carries a display name plus game stats — no email, no history.
 *
 * The client is created LAZILY and only when `syncConfigured()` is true: with
 * the placeholder config (or on `file://`) not one line below ever runs, and
 * the app is the offline app it has always been.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AppEvent, Unsubscribe } from '../storage/DataStore.ts';
import { normalizeEvent, type StorageLike } from '../storage/migrate.ts';
import {
  GhostHandleTakenError,
  SyncAuthError,
  type AuthPort,
  type AuthUser,
  type GhostRow,
  type PullPage,
  type SyncBackend,
} from './backend.ts';
import { SYNC_CONFIG, syncConfigured, type SyncConfig } from './config.ts';

/** The table every event lands in (see `supabase/schema.sql`). */
const EVENTS_TABLE = 'events';

/** Columns the client reads. `seq` is the cursor; the rest is the event. */
const PULL_COLUMNS = 'id,ts,device,type,payload,seq';

/** The ghost-duel presence table — one row per user (see `supabase/schema.sql`). */
const GHOSTS_TABLE = 'ghosts';

/**
 * Columns a LOOKUP reads. Deliberately without `user_id`: a handle lookup hands
 * back a character and a name, never an account identifier.
 */
const GHOST_COLUMNS = 'handle,payload,updated_at';

export interface SupabaseSyncOptions {
  /** Where the auth session is persisted (the app's own `localStorage`). */
  storage: StorageLike;
  config?: SyncConfig;
  /**
   * Where Google sends the user back. Defaults to this exact page, WITHOUT the
   * query string or hash: `origin + pathname` works identically for
   * `https://user.github.io/gym-rpg/` and `http://localhost:5173/`, and both
   * must be registered in Supabase → Auth → URL configuration.
   */
  redirectTo?: string;
}

export interface SupabaseSync {
  backend: SyncBackend;
  auth: AuthPort;
}

/* --------------------------------------------------------------- helpers */

function defaultRedirect(): string {
  const loc: Location | undefined = globalThis.location;
  if (!loc) return '';
  return `${loc.origin}${loc.pathname}`;
}

interface RemoteError {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

/**
 * Is this "your session is dead" or "the network hiccuped"?
 *
 * The distinction decides whether the engine keeps retrying with backoff or
 * parks on `reauth` and asks the user to sign in again — retrying an expired
 * JWT forever only drains the battery. PostgREST reports it as 401/403 or the
 * `PGRST301` code; the auth endpoints say so in the message.
 */
function toSyncError(raw: unknown, fallback: string): Error {
  const err = (raw ?? {}) as RemoteError;
  const message = typeof err.message === 'string' && err.message ? err.message : fallback;
  const code = typeof err.code === 'string' ? err.code : '';
  const status = typeof err.status === 'number' ? err.status : 0;
  if (status === 401 || status === 403 || code === 'PGRST301' || /jwt|token|not authenticated/i.test(message)) {
    return new SyncAuthError(message);
  }
  return new Error(message);
}

/** One database row -> one `AppEvent`, or `null` if the row is unusable. */
function rowToEvent(raw: unknown): AppEvent | null {
  // Remote rows are UNTRUSTED input like any other: they go through the same
  // normalizer the stored log does, so a malformed row can never enter the fold.
  return normalizeEvent(raw);
}

/* ---------------------------------------------------------------- factory */

/**
 * Build the real backend + auth port, or `null` when sync is not configured.
 * Callers treat `null` as "the feature does not exist".
 */
export function createSupabaseSync(opts: SupabaseSyncOptions): SupabaseSync | null {
  const config = opts.config ?? SYNC_CONFIG;
  if (!syncConfigured(config)) return null;

  const redirectTo = opts.redirectTo ?? defaultRedirect();
  let client: SupabaseClient | null = null;

  function db(): SupabaseClient {
    if (client) return client;
    client = createClient(config.url.trim(), config.anonKey.trim(), {
      auth: {
        // PKCE: the only OAuth flow that is safe without a server to hold a
        // client secret. The code verifier lives in `storage` below.
        flowType: 'pkce',
        // The redirect comes back with `?code=…`; the client swaps it for a
        // session and cleans the URL up on its own.
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storage: opts.storage,
      },
    });
    return client;
  }

  const backend: SyncBackend = {
    async pushEvents(userId: string, events: readonly AppEvent[]): Promise<void> {
      if (events.length === 0) return;
      const rows = events.map((ev) => ({
        user_id: userId,
        id: ev.id,
        ts: ev.ts,
        device: ev.device ?? null,
        type: ev.type,
        payload: ev.payload,
      }));
      const { error } = await db()
        .from(EVENTS_TABLE)
        // `ignoreDuplicates` is what makes a retry free: a row we already sent
        // is skipped by the primary key instead of rewriting history.
        .upsert(rows, { onConflict: 'user_id,id', ignoreDuplicates: true });
      if (error) throw toSyncError(error, 'push failed');
    },

    async pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage> {
      const { data, error } = await db()
        .from(EVENTS_TABLE)
        .select(PULL_COLUMNS)
        .eq('user_id', userId)
        .gt('seq', afterSeq)
        .order('seq', { ascending: true })
        .limit(limit);
      if (error) throw toSyncError(error, 'pull failed');

      const rows: unknown[] = Array.isArray(data) ? (data as unknown[]) : [];
      const events: AppEvent[] = [];
      let lastSeq = afterSeq;
      for (const row of rows) {
        const ev = rowToEvent(row);
        if (ev) events.push(ev);
        // The cursor advances over EVERY row read, including one we had to drop
        // as malformed — otherwise a single bad row would wedge the cursor and
        // the device would re-download the same page forever.
        const seq = (row as { seq?: unknown }).seq;
        if (typeof seq === 'number' && seq > lastSeq) lastSeq = seq;
      }
      return { events, lastSeq };
    },

    /**
     * Upsert MY ghost row. `onConflict: 'user_id'` makes it "insert or replace
     * my own row" — the primary key is the user, so a person has exactly one
     * ghost and publishing again overwrites it rather than accumulating.
     *
     * The `handle` column is UNIQUE, so two accounts cannot claim one name; the
     * database says so with `23505` and we turn that into the one error the UI
     * can actually act on.
     */
    async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
      const { error } = await db()
        .from(GHOSTS_TABLE)
        .upsert({ user_id: userId, handle, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (!error) return;
      const code = typeof (error as RemoteError).code === 'string' ? (error as RemoteError).code : '';
      const message = typeof error.message === 'string' ? error.message : '';
      if (code === '23505' || /duplicate key|ghosts_handle/i.test(message)) {
        throw new GhostHandleTakenError(message || 'handle taken');
      }
      throw toSyncError(error, 'ghost publish failed');
    },

    /**
     * Look somebody up by exact handle. `maybeSingle()` returns `null` rather
     * than throwing when nobody answers — "not found" is an ordinary answer
     * here, not a failure.
     *
     * Only the three columns below are selected: there is no `user_id` in the
     * result, so a lookup cannot be turned into an account enumeration even by
     * a client that asks nicely (the RLS policy allows the select, the query
     * simply never carries the id out).
     */
    async fetchGhost(handle: string): Promise<GhostRow | null> {
      const { data, error } = await db()
        .from(GHOSTS_TABLE)
        .select(GHOST_COLUMNS)
        .eq('handle', handle)
        .maybeSingle();
      if (error) throw toSyncError(error, 'ghost lookup failed');
      const row = data as { handle?: unknown; payload?: unknown; updated_at?: unknown } | null;
      if (!row || typeof row.handle !== 'string') return null;
      const payload =
        typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};
      const updatedAt = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN;
      return {
        handle: row.handle,
        payload,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
      };
    },
  };

  function toUser(raw: { id?: unknown; email?: unknown } | null | undefined): AuthUser | null {
    if (!raw || typeof raw.id !== 'string') return null;
    return { id: raw.id, email: typeof raw.email === 'string' ? raw.email : null };
  }

  const auth: AuthPort = {
    async getUser(): Promise<AuthUser | null> {
      // `getSession` reads the persisted session (and finishes the redirect
      // exchange) without a round trip; `getUser` would hit the network on a
      // cold, offline start.
      const { data } = await db().auth.getSession();
      return toUser(data.session?.user ?? null);
    },

    async signInWithGoogle(): Promise<void> {
      const { error } = await db().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      // Normally unreachable: the call navigates away. It resolves with an
      // error when the provider is not enabled on the project.
      if (error) throw toSyncError(error, 'sign-in failed');
    },

    async signOut(): Promise<void> {
      // 'local' only: signing out of THIS browser must not kill the session on
      // the user's other devices, which are still happily syncing.
      const { error } = await db().auth.signOut({ scope: 'local' });
      if (error) throw toSyncError(error, 'sign-out failed');
    },

    onChange(cb: (user: AuthUser | null) => void): Unsubscribe {
      const { data } = db().auth.onAuthStateChange((_event, session) => {
        cb(toUser(session?.user ?? null));
      });
      return () => data.subscription.unsubscribe();
    },
  };

  return { backend, auth };
}
