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
}

export function emptySyncMeta(deviceId = ''): SyncMeta {
  return { v: SYNC_META_VERSION, deviceId, cursor: 0, outbox: [], userId: null, lastSyncAt: null };
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
  };
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
