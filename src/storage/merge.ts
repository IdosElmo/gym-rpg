/**
 * storage/merge.ts — folding a FOREIGN set of events into this device's log.
 *
 * Two callers, one operation:
 *   - the sync engine, when a pull brings events from another device;
 *   - the history screen, when a signed-in user imports a JSON backup (which is
 *     additive: the account already holds data that a destructive replace would
 *     silently delete from every other device too).
 *
 * The operation is exactly the definition of sync used everywhere in this app:
 *
 *      union the event sets → replay → that IS the merged state
 *
 * There is no conflict resolution because there are no conflicts: the fold order
 * `(ts, id)` is a property of the event SET, so both devices reach byte-identical
 * state regardless of who saw what first (see `tests/merge.test.ts`).
 *
 * Three things are carried over from the live state rather than replayed,
 * because none of them is in the log — they describe THIS INSTALL, not the
 * account:
 *   - `ui` — which tab you are on is not other devices' business;
 *   - `meta.createdAt` — when this install was created;
 *   - `meta.legacyImported` — whether this install already scanned its own
 *     `hyp3_data_v1`. It is a latch: replaying can only ever re-derive it from
 *     import events, and a wipe leaves a log that has none, so a merge after a
 *     `clear()` would otherwise un-remember it and the next boot would import
 *     the legacy blob all over again — resurrecting deleted data into the
 *     account (`tests/merge.test.ts`).
 */

import { compareEvents } from '../core/xp.ts';
import { rebuildFromEvents, type ParsedImport } from './migrate.ts';
import type { AppEvent, DataStore } from './DataStore.ts';

export interface MergeResult {
  /** How many events the merge actually added (already deduped by id). */
  added: number;
  /** Size of the log afterwards. */
  total: number;
}

/**
 * Union `incoming` into the store's log and rebuild the state from the result.
 *
 * Returns `{added: 0}` and touches NOTHING when every incoming event is already
 * known — an important property for the sync engine, which pulls on a timer and
 * must not rebuild (or repaint) the app 60 times an hour for nothing.
 */
export function mergeIntoStore(
  store: DataStore,
  incoming: readonly AppEvent[],
  now: number = Date.now(),
): MergeResult {
  const local = store.getEvents();
  const known = new Set(local.map((e) => e.id));
  const fresh = incoming.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return { added: 0, total: local.length };

  // Kept sorted on disk: the fold sorts internally anyway, but the history feed
  // and the export read the log as-is, and both want it chronological.
  const merged = [...local, ...fresh].sort(compareEvents);
  const before = store.getState();
  const next = rebuildFromEvents(merged, now);
  next.ui = before.ui;
  next.meta.createdAt = before.meta.createdAt;
  if (before.meta.legacyImported) {
    next.meta.legacyImported = true;
    if (before.meta.legacyImportedAt !== undefined) {
      next.meta.legacyImportedAt = before.meta.legacyImportedAt;
    }
  }
  store.replaceAll(next, merged);
  return { added: fresh.length, total: merged.length };
}

/**
 * ADDITIVE import — the signed-in variant of "⬆ ייבוא JSON".
 *
 * Signed out, an import replaces everything (`replaceAll`), which is what a
 * restore means on a single device. Signed in it must not: the file is one
 * device's history, the account holds all of them, and a replace would push a
 * `data_cleared`-shaped truth onto every other device. So the file's events are
 * unioned in instead, and a `data_merged` marker records that it happened (the
 * history feed uses it to explain a sudden jump in XP).
 *
 * The marker is appended through `store.append`, i.e. it is a normal local
 * event and it syncs. That is deliberate and it does NOT loop: the engine never
 * appends anything of its own when IT merges, so nothing here can echo between
 * devices.
 */
export function mergeImport(
  store: DataStore,
  parsed: ParsedImport,
  now: number = Date.now(),
): MergeResult {
  const res = mergeIntoStore(store, parsed.events, now);
  store.append('data_merged', { source: 'json_import', added: res.added });
  return res;
}
