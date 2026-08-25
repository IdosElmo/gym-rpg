/**
 * sync/meta.ts — the sync engine's own little persisted notebook.
 *
 * It lives in its OWN storage key (`gymrpg_sync_v1`), next to the state and the
 * event log rather than inside either of them, and that separation is load
 * bearing:
 *
 *  - the state blob is rebuilt wholesale by `replaceAll` on every merge, which
 *    would throw a cursor away exactly when it matters most;
 *  - an export must NOT carry a cursor or an outbox — importing a backup on a
 *    second device would make it claim to have already pulled another device's
 *    history, and it would then never pull it;
 *  - `clear()` wipes app data but the sync bookkeeping has to survive it, or a
 *    cleared device would re-download everything it just deliberately erased.
 *
 * Nothing here is authoritative: every field can be rebuilt (at the cost of one
 * full re-push / re-pull), so a corrupt or missing blob is simply reset.
 */

import { normalizeLeagueRow, type LeagueWeekRow } from '../core/leagueSync.ts';
import type { StorageLike } from '../storage/migrate.ts';

export const SYNC_META_KEY = 'gymrpg_sync_v1';

/** Bump when the shape below changes; an unknown version resets to defaults. */
export const SYNC_META_VERSION = 1;

export interface SyncMeta {
  v: typeof SYNC_META_VERSION;
  /** The install id (mirrors `gymrpg_device_v1`); handy when debugging a log. */
  deviceId: string;
  /** Highest server `seq` this device has pulled. 0 = "I have nothing yet". */
  cursor: number;
  /**
   * Ids of local events that are not known to be on the server yet, in the
   * order they were produced. Ids, not events: the log is the single copy of
   * every payload, and an outbox that duplicated them could disagree with it.
   */
  outbox: string[];
  /** Whose data the cursor/outbox belong to. `null` = signed out. */
  userId: string | null;
  /** ms epoch of the last fully successful cycle, for the account card. */
  lastSyncAt: number | null;

  /* ------------------------------------------------------- ghost duels */
  /**
   * THE שם לוחם this device publishes under, or `null` for "not chosen yet"
   * (the engine then derives one from the account).
   *
   * DEVICE-LOCAL ON PURPOSE, and this is the load-bearing part of the whole
   * ghost design: a ghost is EPHEMERAL PRESENCE DATA — a snapshot that is
   * overwritten in place and means nothing after it is replaced — while the
   * event log is the single source of truth for the account's own state.
   * Putting the handle in the log would make a cosmetic, revocable, externally
   * unique name a permanent historical fact that every device must replay and
   * agree on, for something no game rule ever reads. It lives here instead, next
   * to the cursor, where a lost blob costs one re-publish and nothing else.
   */
  ghostHandle: string | null;
  /**
   * Fingerprint (`ghostHash`) of the snapshot that was last published. The
   * publisher compares against it and uploads nothing when it matches, so an
   * ordinary sync cycle on an unchanged character makes no ghost request at all.
   */
  ghostHash: string | null;
  /** Handles fought recently, newest first — the duel card's shortlist. */
  ghostRecent: string[];

  /* ------------------------------------------------------------- הליגה */
  /**
   * The handle this device's PUBLISHED league weeks were published under.
   *
   * Kept beside the set below rather than assumed to equal `ghostHandle`: a
   * rename changes the name a row must carry, so the publisher compares this
   * with the handle in force and, when they differ, treats everything as
   * unpublished and rewrites the window under the new name — exactly what the
   * ghost publisher does when its fingerprint no longer matches.
   */
  leagueHandle: string | null;
  /**
   * Week keys already published under `leagueHandle`, pruned to the publish
   * window (the current + previous month — see `publishableWeeks`).
   *
   * PURELY AN OPTIMISATION, and that is what makes it safe: the truth is the
   * ledger in the event log, and every cycle diffs the ledger's closed weeks in
   * the window against this set. Losing the notebook re-publishes at most a
   * couple of months of rows, over a primary key, which changes nothing.
   */
  leagueWeeks: string[];
  /**
   * weekKey -> `leagueRowFingerprint` of the row that was published for it.
   *
   * The companion to the list above, and for one reason: a closed week can be
   * RE-GRADED (a week closed before the first pull landed is corrected when the
   * sessions arrive — `core/league.ts`), so "this week has been published" is
   * not the same question as "the published row still says what the ledger
   * says". A week whose fingerprint is missing or has moved is re-uploaded.
   *
   * Purely an optimisation, exactly like the list: a missing entry means "no
   * idea", which costs one upsert over a primary key. That is also what makes it
   * safe to read a notebook written before this field existed — every week in it
   * is simply republished once.
   */
  leagueHashes: Record<string, string>;
  /**
   * The last opponent month that was fetched, cached so the screen has
   * something to show when the network does not.
   *
   * ONE SLOT: the league is two people, and the UI asks for one (handle, month)
   * at a time — a fetch for a different pair replaces this one rather than
   * accumulating. See `SyncEngine.loadLeagueMonth` for the staleness rules.
   */
  leagueMonth: CachedLeagueMonth | null;
}

/**
 * An opponent's month as it was last read from the server.
 *
 * The rows are stored ALREADY NORMALIZED (they passed `normalizeLeagueRow` when
 * they arrived) and are normalized AGAIN on read: this blob is ordinary browser
 * storage, so it is no more trusted on the way out than the network was on the
 * way in, and the boundary is idempotent.
 */
export interface CachedLeagueMonth {
  handle: string;
  monthKey: string;
  /** ms epoch of the fetch these rows came from. */
  fetchedAt: number;
  rows: LeagueWeekRow[];
}

/** How many opponents the duel card remembers. */
export const GHOST_RECENT_MAX = 6;

export function emptySyncMeta(deviceId = ''): SyncMeta {
  return {
    v: SYNC_META_VERSION,
    deviceId,
    cursor: 0,
    outbox: [],
    userId: null,
    lastSyncAt: null,
    ghostHandle: null,
    ghostHash: null,
    ghostRecent: [],
    leagueHandle: null,
    leagueWeeks: [],
    leagueHashes: {},
    leagueMonth: null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Route any stored blob (any version, or garbage) to a valid `SyncMeta`. */
export function normalizeSyncMeta(raw: unknown, deviceId = ''): SyncMeta {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return emptySyncMeta(deviceId);
    }
  }
  if (!isRecord(raw)) return emptySyncMeta(deviceId);
  if (numOr(raw['v'], 0) !== SYNC_META_VERSION) return emptySyncMeta(deviceId);

  const outbox = Array.isArray(raw['outbox'])
    ? raw['outbox'].filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const storedDevice = typeof raw['deviceId'] === 'string' ? raw['deviceId'] : '';
  // The three ghost fields are read TOLERANTLY rather than behind a version
  // bump: a blob written before ghost duels existed simply has none of them, and
  // "no handle, nothing published yet, no recent opponents" is exactly the right
  // reading of that. Resetting the whole notebook (and with it the cursor and
  // the outbox) to add three optional fields would have been a real cost — a
  // full re-push and re-pull — for no gain.
  const recent = Array.isArray(raw['ghostRecent'])
    ? raw['ghostRecent'].filter((h): h is string => typeof h === 'string' && h.length > 0)
    : [];
  // The three league fields are read the same TOLERANT way, for the same reason:
  // a notebook written before the league existed simply has none of them, and
  // "nothing published yet, nothing cached" is the right reading of that. It
  // must not cost the cursor and the outbox — a version bump here would mean a
  // full re-push and re-pull for three optional fields.
  const leagueWeeks = Array.isArray(raw['leagueWeeks'])
    ? raw['leagueWeeks'].filter((w): w is string => typeof w === 'string' && w.length > 0)
    : [];
  const hashesRaw = raw['leagueHashes'];
  const leagueHashes: Record<string, string> = {};
  if (isRecord(hashesRaw)) {
    for (const week of leagueWeeks) {
      const hash = hashesRaw[week];
      if (typeof hash === 'string' && hash) leagueHashes[week] = hash;
    }
  }
  return {
    v: SYNC_META_VERSION,
    deviceId: storedDevice || deviceId,
    cursor: Math.max(0, Math.floor(numOr(raw['cursor'], 0))),
    // Dedupe defensively: a double-append would make the same event push twice.
    outbox: [...new Set(outbox)],
    userId: typeof raw['userId'] === 'string' && raw['userId'] ? raw['userId'] : null,
    lastSyncAt: typeof raw['lastSyncAt'] === 'number' && Number.isFinite(raw['lastSyncAt'])
      ? raw['lastSyncAt']
      : null,
    ghostHandle: typeof raw['ghostHandle'] === 'string' && raw['ghostHandle'] ? raw['ghostHandle'] : null,
    ghostHash: typeof raw['ghostHash'] === 'string' && raw['ghostHash'] ? raw['ghostHash'] : null,
    ghostRecent: [...new Set(recent)].slice(0, GHOST_RECENT_MAX),
    leagueHandle: typeof raw['leagueHandle'] === 'string' && raw['leagueHandle'] ? raw['leagueHandle'] : null,
    leagueWeeks: [...new Set(leagueWeeks)],
    leagueHashes,
    leagueMonth: normalizeCachedMonth(raw['leagueMonth']),
  };
}

/** The cached opponent month, re-checked on the way out of storage. */
function normalizeCachedMonth(raw: unknown): CachedLeagueMonth | null {
  if (!isRecord(raw)) return null;
  const handle = typeof raw['handle'] === 'string' ? raw['handle'] : '';
  const monthKey = typeof raw['monthKey'] === 'string' ? raw['monthKey'] : '';
  if (!handle || !monthKey) return null;
  const fetchedAt = numOr(raw['fetchedAt'], 0);
  const rows: LeagueWeekRow[] = [];
  if (Array.isArray(raw['rows'])) {
    for (const row of raw['rows']) {
      const normalized = normalizeLeagueRow(row, monthKey);
      if (normalized) rows.push(normalized);
    }
  }
  return { handle, monthKey, fetchedAt, rows };
}

export function readSyncMeta(storage: StorageLike, deviceId = ''): SyncMeta {
  try {
    return normalizeSyncMeta(storage.getItem(SYNC_META_KEY), deviceId);
  } catch {
    return emptySyncMeta(deviceId);
  }
}

export function writeSyncMeta(storage: StorageLike, meta: SyncMeta): void {
  try {
    storage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    /* quota / private mode — the engine keeps working from memory this session */
  }
}

/**
 * Forget everything about the cloud (sign-out). App data is NOT touched: the
 * user keeps every workout, they simply stop being backed up.
 */
export function clearSyncMeta(storage: StorageLike): void {
  try {
    storage.removeItem(SYNC_META_KEY);
  } catch {
    /* ignore */
  }
}
