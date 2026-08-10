/**
 * LocalStore — the localStorage implementation of `DataStore`.
 *
 * The only module in the app that is allowed to name `localStorage`.
 * Writes are debounced-free (they're tiny) but wrapped in try/catch so a full
 * or disabled storage never breaks the workout in the middle of a set.
 */

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

  constructor(storage: StorageLike = resolveStorage(), now: number = Date.now()) {
    this.storage = storage;
    const boot = bootstrap(this.storage, now);
    this.state = boot.state;
    this.events = [...boot.events];
    if (boot.dirty) {
      this.persistState();
      this.persistEvents();
    }
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
    const ev = makeEvent(type, payload);
    this.events.push(ev);
    this.persistEvents();
    return ev;
  }

  subscribe(listener: (state: AppState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  replaceAll(state: AppState, events: readonly AppEvent[]): void {
    this.state = state;
    this.events = [...events];
    this.persistState();
    this.persistEvents();
    this.emit();
  }

  clear(): void {
    const now = Date.now();
    this.state = emptyState(now);
    // Legacy data was already imported once; don't resurrect it after a wipe.
    this.state.meta.legacyImported = true;
    this.events = [makeEvent('data_cleared', {}, now)];
    this.persistState();
    this.persistEvents();
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
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
