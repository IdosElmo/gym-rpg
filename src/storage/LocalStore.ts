/**
 * LocalStore — the localStorage implementation of `DataStore`.
 *
 * The only module in the app that is allowed to name `localStorage`.
 * Writes are debounced-free (they're tiny) but wrapped in try/catch so a full
 * or disabled storage never breaks the workout in the middle of a set.
 */

import { emptyGame } from '../core/xp.ts';
import type {
  AppEvent,
  AppState,
  DataStore,
  EventType,
  Unsubscribe,
} from './DataStore.ts';
import {
  EVENTS_KEY,
  STATE_KEY,
  bootstrap,
  emptyState,
  ensureDeviceId,
  makeEvent,
  CURRENT_EVENTLOG_VERSION,
  type StorageLike,
} from './migrate.ts';

/** In-memory fallback so the app still runs with storage disabled/blocked. */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function resolveStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memoryStorage();
    const probe = '__gymrpg_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryStorage();
  }
}

export class LocalStore implements DataStore {
  private readonly storage: StorageLike;
  private state: AppState;
  private events: AppEvent[];
  private readonly listeners = new Set<(s: AppState) => void>();
  private readonly eventListeners = new Set<(ev: AppEvent) => void>();
  /** This install's id — stamped on every event this device writes. */
  private readonly deviceId: string;
  /** Highest ts THIS device has written; the monotonic clamp's watermark. */
  private lastTs: number;

  constructor(storage: StorageLike = resolveStorage(), now: number = Date.now()) {
    this.storage = storage;
    this.deviceId = ensureDeviceId(this.storage);
    const boot = bootstrap(this.storage, now);
    this.state = boot.state;
    this.events = [...boot.events];
    this.lastTs = this.ownWatermark();
    if (boot.dirty) {
      this.persistState();
      this.persistEvents();
    }
  }

  /** The device id this store stamps on its events. */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Highest ts among the events this device itself wrote (an unstamped event is
   * treated as ours — it predates the stamp, so it can only be local). Foreign
   * events are deliberately ignored: a peer with a fast clock must not drag our
   * own timestamps into the future.
   */
  private ownWatermark(): number {
    let max = 0;
    for (const ev of this.events) {
      if (ev.device !== undefined && ev.device !== this.deviceId) continue;
      if (ev.ts > max) max = ev.ts;
    }
    return max;
  }

  /**
   * Timestamp for a new event: `max(now, lastTs + 1)` — clamped AND strictly
   * increasing within this device.
   *
   * Clamping is the obvious half: a clock that jumps backwards (timezone fix,
   * NTP correction, manual change) would otherwise write events that sort
   * BEFORE ones this device already wrote, silently reordering its own history.
   *
   * The `+ 1` is the non-obvious half, and it is required by the new total
   * order. Ties are broken by event id, i.e. by a random uuid — fine between
   * two DEVICES (those events are genuinely concurrent) but destructive within
   * one, where insertion order is real information and some events do not
   * commute (`wave_cleared` moves a marker, `set_logged` overwrites a field).
   * Giving every event of this device its own ts means the id tie-break is only
   * ever consulted for events that really are concurrent.
   */
  private nextTs(): number {
    const ts = Math.max(Date.now(), this.lastTs + 1);
    this.lastTs = ts;
    return ts;
  }

  getState(): AppState {
    return this.state;
  }

  getEvents(): readonly AppEvent[] {
    return this.events;
  }

  save(next: AppState): void {
    this.state = { ...next, schemaVersion: this.state.schemaVersion, meta: { ...next.meta, updatedAt: Date.now() } };
    this.persistState();
    this.emit();
  }

  update(mutate: (draft: AppState) => void): AppState {
    mutate(this.state);
    this.state.meta.updatedAt = Date.now();
    this.persistState();
    this.emit();
    return this.state;
  }

  append(type: EventType, payload: Record<string, unknown> = {}): AppEvent {
    const ev = makeEvent(type, payload, this.nextTs(), this.deviceId);
    this.events.push(ev);
    this.persistEvents();
    this.emitEvent(ev);
    return ev;
  }

  subscribe(listener: (state: AppState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  subscribeEvents(listener: (ev: AppEvent) => void): Unsubscribe {
    this.eventListeners.add(listener);
    return () => void this.eventListeners.delete(listener);
  }

  replaceAll(state: AppState, events: readonly AppEvent[]): void {
    this.state = state;
    this.events = [...events];
    this.lastTs = this.ownWatermark();
    this.persistState();
    this.persistEvents();
    this.emit();
  }

  clear(): void {
    const now = Date.now();
    this.state = emptyState(now);
    // Legacy data was already imported once; don't resurrect it after a wipe.
    this.state.meta.legacyImported = true;
    // A wipe resets the character too — `data_cleared` replays to the same state.
    this.state.game = emptyGame();
    const marker = makeEvent('data_cleared', {}, this.nextTs(), this.deviceId);
    this.events = [marker];
    this.persistState();
    this.persistEvents();
    this.emit();
    // The wipe itself is an event like any other: subscribers (the sync engine)
    // must see it, or a cleared device would silently re-pull everything back.
    this.emitEvent(marker);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  private emitEvent(ev: AppEvent): void {
    for (const l of this.eventListeners) l(ev);
  }

  private persistState(): void {
    try {
      this.storage.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      /* quota / private mode — keep going, state stays in memory */
    }
  }

  private persistEvents(): void {
    try {
      this.storage.setItem(
        EVENTS_KEY,
        JSON.stringify({ schemaVersion: CURRENT_EVENTLOG_VERSION, events: this.events }),
      );
    } catch {
      /* ignore */
    }
  }
}
