import { describe, expect, it } from 'vitest';

import { emptyGame } from '../src/core/xp.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, EventType, Session } from '../src/storage/DataStore.ts';
import {
  CURRENT_EVENTLOG_VERSION,
  CURRENT_STATE_VERSION,
  DEVICE_KEY,
  EVENTS_KEY,
  EXPORT_FORMAT,
  LEGACY_KEY,
  LEGACY_UI_KEY,
  STATE_KEY,
  bootstrap,
  buildExport,
  emptyState,
  importLegacy,
  migrateEventLog,
  migrateState,
  parseImport,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

/* --------------------------------------------------------------- fixtures */

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

/** A realistic legacy `hyp3_data_v1` blob, including a sparse set array. */
const LEGACY_BLOB = {
  sessions: {
    '2025-01-05': {
      day: 'A',
      ex: {
        a1: [
          { w: '40', r: '10', done: true },
          { w: '42.5', r: '8', done: true },
          { w: '42.5', r: '7', done: false },
        ],
        a5: [{ w: '12', r: '12', done: true }],
      },
    },
    '2025-01-07': {
      day: 'B',
      ex: {
        b1: [
          { w: '50', r: '10', done: true },
          { w: '', r: '', done: false },
        ],
        // sparse: index 0 was never created, JSON serialises the hole as null
        b5: [null, { w: '', r: '50', done: true }],
      },
    },
    '2025-01-09': {
      day: 'C',
      ex: {
        c2: [{ w: '60', r: '8', done: true }],
      },
    },
  },
};

/* ------------------------------------------------------- version routing */

describe('version routing', () => {
  it('gives an empty, current-version state for missing/garbage blobs', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', 42, { nope: true }]) {
      const s = migrateState(raw as unknown);
      expect(s.schemaVersion).toBe(CURRENT_STATE_VERSION);
      expect(s.sessions).toEqual({});
      expect(s.game).toBeNull();
    }
  });

  it('upgrades an unversioned (v0) blob into the current envelope', () => {
    const v0 = { sessions: LEGACY_BLOB.sessions };
    const s = migrateState(v0);
    expect(s.schemaVersion).toBe(CURRENT_STATE_VERSION);
    expect(Object.keys(s.sessions).sort()).toEqual(['2025-01-05', '2025-01-07', '2025-01-09']);
    expect(s.meta.legacyImported).toBe(false);
  });

  it('passes a current-version blob through unchanged', () => {
    const state = emptyState(1000);
    state.sessions['2025-02-01'] = { day: 'A', ex: { a1: [{ w: '1', r: '2', done: true }] } };
    state.meta.legacyImported = true;
    const round = migrateState(JSON.stringify(state));
    expect(round.sessions).toEqual(state.sessions);
    expect(round.meta.legacyImported).toBe(true);
    expect(round.schemaVersion).toBe(CURRENT_STATE_VERSION);
  });

  it('does not crash on a blob from a FUTURE schema version', () => {
    const future = { schemaVersion: 999, sessions: LEGACY_BLOB.sessions, ui: { view: 'H', open: {} } };
    const s = migrateState(future);
    expect(s.schemaVersion).toBe(CURRENT_STATE_VERSION);
    expect(Object.keys(s.sessions)).toHaveLength(3);
    expect(s.ui.view).toBe('H');
  });

  it('routes the event log through its own version chain', () => {
    const bare = [{ id: 'x', ts: 5, type: 'set_logged', payload: { a: 1 } }];
    const log = migrateEventLog(bare);
    expect(log.schemaVersion).toBe(CURRENT_EVENTLOG_VERSION);
    expect(log.events).toHaveLength(1);
    expect(log.events[0]?.type).toBe('set_logged');

    const versioned = migrateEventLog({ schemaVersion: 1, events: bare });
    expect(versioned.events).toHaveLength(1);

    expect(migrateEventLog('garbage').events).toEqual([]);
    expect(migrateEventLog(null).events).toEqual([]);
  });

  it('upgrades a v1 event log to v2 without touching a single event', () => {
    expect(CURRENT_EVENTLOG_VERSION).toBe(2);
    const events = [
      { id: 'a', ts: 5, type: 'set_logged', payload: { n: 1 } },
      { id: 'b', ts: 6, type: 'set_completed', payload: { n: 2 } },
    ];
    const upgraded = migrateEventLog({ schemaVersion: 1, events });
    expect(upgraded.schemaVersion).toBe(2);
    // 1 -> 2 is an identity step: `device` is additive, nothing is rewritten
    expect(upgraded.events).toEqual(events.map((e) => ({ ...e, type: e.type })));
    // ...and a v1 event simply has no device stamp
    expect(upgraded.events.every((e) => e.device === undefined)).toBe(true);
  });

  it('preserves the device stamp through normalisation (and drops a bogus one)', () => {
    const log = migrateEventLog({
      schemaVersion: 2,
      events: [
        { id: 'a', ts: 1, type: 'set_logged', payload: {}, device: 'dev-1' },
        { id: 'b', ts: 2, type: 'set_logged', payload: {}, device: 42 },
        { id: 'c', ts: 3, type: 'set_logged', payload: {}, device: '' },
      ],
    });
    expect(log.events[0]?.device).toBe('dev-1');
    expect(log.events[1]?.device).toBeUndefined();
    expect(log.events[2]?.device).toBeUndefined();
    // an unstamped event must not serialise a `device: undefined` key
    expect(Object.keys(log.events[1] ?? {}).includes('device')).toBe(false);
  });

  it('drops malformed events but keeps the good ones', () => {
    const log = migrateEventLog({ schemaVersion: 1, events: [null, 3, { type: 'set_logged' }, { nope: 1 }] });
    expect(log.events).toHaveLength(1);
    expect(log.events[0]?.ts).toBe(0);
    expect(log.events[0]?.id).toBeTruthy();
  });
});

/* -------------------------------------------------------- legacy import */

describe('legacy hyp3_data_v1 import', () => {
  it('preserves every session losslessly', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB, null, 1_700_000_000_000);
    expect(res.imported).toBe(true);
    expect(res.sessionCount).toBe(3);
    // every date, day letter, exercise id, set slot and value survives
    expect(res.state.sessions).toEqual(LEGACY_BLOB.sessions as unknown as Record<string, Session>);
    expect(res.state.meta.legacyImported).toBe(true);
    expect(res.state.meta.legacyImportedAt).toBe(1_700_000_000_000);
  });

  it('keeps sparse null holes in set arrays', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB);
    expect(res.state.sessions['2025-01-07']?.ex['b5']?.[0]).toBeNull();
    expect(res.state.sessions['2025-01-07']?.ex['b5']?.[1]).toEqual({ w: '', r: '50', done: true });
  });

  it('coerces numeric legacy weights to strings without losing meaning', () => {
    const res = importLegacy(emptyState(0), {
      sessions: { '2024-12-01': { day: 'A', ex: { a1: [{ w: 40, r: 10, done: true }] } } },
    });
    expect(res.state.sessions['2024-12-01']?.ex['a1']?.[0]).toEqual({ w: '40', r: '10', done: true });
  });

  it('emits one session_imported event per session plus a legacy_import summary', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB, null, 999);
    const sessionEvents = res.events.filter((e) => e.type === 'session_imported');
    const summary = res.events.filter((e) => e.type === 'legacy_import');
    expect(sessionEvents).toHaveLength(3);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.payload['sessionCount']).toBe(3);
    expect(summary[0]?.payload['key']).toBe(LEGACY_KEY);

    // events carry the full set data + a date-derived ts, so Phase 1 can grant
    // retroactive XP chronologically straight from the log.
    const first = sessionEvents[0];
    expect(first?.payload['date']).toBe('2025-01-05');
    expect(first?.payload['source']).toBe('legacy_v1');
    expect(first?.ts).toBe(Date.parse('2025-01-05T00:00:00.000Z'));
    expect(first?.payload['ex']).toEqual(LEGACY_BLOB.sessions['2025-01-05'].ex);
    const tss = sessionEvents.map((e) => e.ts);
    expect(tss).toEqual([...tss].sort((a, b) => a - b));

    // every event has an id and a numeric ts
    for (const e of res.events) {
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(Number.isFinite(e.ts)).toBe(true);
    }
  });

  it('adopts the legacy UI state (hyp3_ui_v1)', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB, { view: 'B', open: { a1: true, a2: false } });
    expect(res.state.ui.view).toBe('B');
    expect(res.state.ui.open).toEqual({ a1: true, a2: false });
  });

  it('never clobbers existing dates', () => {
    const base = emptyState(0);
    base.sessions['2025-01-05'] = { day: 'C', ex: { c1: [{ w: '99', r: '1', done: true }] } };
    const res = importLegacy(base, LEGACY_BLOB);
    expect(res.state.sessions['2025-01-05']?.ex['c1']).toBeDefined();
    expect(res.state.sessions['2025-01-05']?.ex['a1']).toBeUndefined();
    expect(Object.keys(res.state.sessions)).toHaveLength(3);
  });

  it('ignores blobs that are not legacy data', () => {
    expect(importLegacy(emptyState(0), 'nope').imported).toBe(false);
    expect(importLegacy(emptyState(0), { nothing: true }).imported).toBe(false);
  });
});

/* ----------------------------------------------------------- bootstrap */

describe('bootstrap (first load)', () => {
  it('imports legacy data on first run and marks it done', () => {
    const storage = fakeStorage({
      [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB),
      [LEGACY_UI_KEY]: JSON.stringify({ view: 'C', open: {} }),
    });
    const boot = bootstrap(storage, 1234);
    expect(boot.dirty).toBe(true);
    expect(Object.keys(boot.state.sessions)).toHaveLength(3);
    expect(boot.state.ui.view).toBe('C');
    expect(boot.events.some((e) => e.type === 'legacy_import')).toBe(true);
    // legacy keys are intentionally kept as a safety net
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('does not re-import on the second load', () => {
    const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB) });
    const first = bootstrap(storage, 1);
    storage.setItem(STATE_KEY, JSON.stringify(first.state));
    storage.setItem(EVENTS_KEY, JSON.stringify({ schemaVersion: 1, events: first.events }));

    const second = bootstrap(storage, 2);
    expect(second.dirty).toBe(false);
    expect(second.events).toHaveLength(first.events.length);
    expect(second.events.filter((e) => e.type === 'legacy_import')).toHaveLength(1);
    expect(second.state.sessions).toEqual(first.state.sessions);
  });

  it('starts clean when there is nothing at all', () => {
    const boot = bootstrap(fakeStorage(), 7);
    expect(boot.state.sessions).toEqual({});
    expect(boot.events).toEqual([]);
    expect(boot.state.meta.legacyImported).toBe(true);
  });
});

/* ------------------------------------------------------- event log append */

describe('append-only event log', () => {
  it('appends events with uuid + ts and persists them versioned', () => {
    const storage = fakeStorage();
    const store = new LocalStore(storage, 100);
    const a = store.append('set_logged', { date: '2025-05-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    const b = store.append('set_completed', { date: '2025-05-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });

    expect(store.getEvents()).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(a.ts).toBeGreaterThan(0);

    const persisted = migrateEventLog(storage.getItem(EVENTS_KEY));
    expect(persisted.schemaVersion).toBe(CURRENT_EVENTLOG_VERSION);
    expect(persisted.events.map((e) => e.type)).toEqual(['set_logged', 'set_completed']);
  });

  it('stamps a stable per-install device id and never repeats a timestamp', () => {
    const storage = fakeStorage();
    const store = new LocalStore(storage, 100);
    const a = store.append('set_logged', { n: 1 });
    const b = store.append('set_logged', { n: 2 });

    const device = storage.getItem(DEVICE_KEY);
    expect(device).toBeTruthy();
    expect(a.device).toBe(device);
    expect(b.device).toBe(device);
    // strictly increasing: the (ts, id) order must never have to break a tie
    // between two events of the SAME device, whose insertion order is real.
    expect(b.ts).toBeGreaterThan(a.ts);

    // the id survives a reopen — and a wipe
    const reopened = new LocalStore(storage, 200);
    expect(reopened.append('set_logged', {}).device).toBe(device);
    reopened.clear();
    expect(storage.getItem(DEVICE_KEY)).toBe(device);
    expect(reopened.getEvents()[0]?.device).toBe(device);
  });

  it('clamps the timestamp when the clock jumps backwards', () => {
    const store = new LocalStore(fakeStorage(), 100);
    const real = Date.now;
    try {
      Date.now = () => 5_000_000;
      const first = store.append('set_logged', { n: 1 });
      // the user "fixes" their timezone: the clock loses an hour
      Date.now = () => 5_000_000 - 3_600_000;
      const second = store.append('set_logged', { n: 2 });
      expect(first.ts).toBe(5_000_000);
      expect(second.ts).toBe(5_000_001);
    } finally {
      Date.now = real;
    }
  });

  it('notifies subscribeEvents on every append and on the clear() marker', () => {
    const store = new LocalStore(fakeStorage(), 100);
    const seen: string[] = [];
    const off = store.subscribeEvents((ev) => void seen.push(ev.type));

    const appended = store.append('set_logged', { n: 1 });
    expect(seen).toEqual(['set_logged']);
    // the listener receives the STORED event, ids and all
    let last: AppEvent | null = null;
    const off2 = store.subscribeEvents((ev) => void (last = ev));
    const second = store.append('set_completed', { n: 2 });
    expect(last).toEqual(second);
    expect(appended.id).not.toBe(second.id);
    off2();

    store.clear();
    expect(seen).toEqual(['set_logged', 'set_completed', 'data_cleared']);

    off();
    store.append('set_logged', { n: 3 });
    expect(seen).toHaveLength(3);
  });

  it('is append-only: earlier events are never rewritten', () => {
    const store = new LocalStore(fakeStorage(), 100);
    const first = store.append('set_logged', { n: 1 });
    store.append('set_completed', { n: 2 });
    store.append('workout_finished', { n: 3 });
    const snapshot = store.getEvents();
    expect(snapshot[0]).toEqual(first);
    expect(snapshot.map((e) => e.payload['n'])).toEqual([1, 2, 3]);
  });

  it('reloads the log through migration on the next boot', () => {
    const storage = fakeStorage();
    const store = new LocalStore(storage, 100);
    store.append('set_logged', { date: '2025-05-01' });
    const reopened = new LocalStore(storage, 200);
    expect(reopened.getEvents()).toHaveLength(1);
    expect(reopened.getEvents()[0]?.type).toBe('set_logged');
  });

  it('clear() wipes state and leaves a data_cleared marker', () => {
    const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB) });
    const store = new LocalStore(storage, 100);
    expect(Object.keys(store.getState().sessions)).toHaveLength(3);
    store.clear();
    expect(store.getState().sessions).toEqual({});
    expect(store.getEvents().map((e) => e.type)).toEqual(['data_cleared']);
    // and a subsequent boot must not resurrect the legacy blob
    const reopened = new LocalStore(storage, 300);
    expect(reopened.getState().sessions).toEqual({});
  });

  it('notifies subscribers on update', () => {
    const store = new LocalStore(fakeStorage(), 100);
    let calls = 0;
    const off = store.subscribe(() => void calls++);
    store.update((d) => {
      d.ui.view = 'H';
    });
    expect(calls).toBe(1);
    off();
    store.update((d) => {
      d.ui.view = 'A';
    });
    expect(calls).toBe(1);
  });
});

/* --------------------------------------------------------- import formats */

describe('JSON import — both formats', () => {
  it('accepts the legacy {sessions:{…}} backup file', () => {
    const parsed = parseImport(JSON.stringify(LEGACY_BLOB));
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('legacy');
    expect(parsed?.state.sessions).toEqual(LEGACY_BLOB.sessions as unknown as Record<string, Session>);
    expect(parsed?.events.filter((e) => e.type === 'session_imported')).toHaveLength(3);
    expect(parsed?.events.find((e) => e.type === 'session_imported')?.payload['source']).toBe('json_import');
  });

  it('accepts the new gym-rpg export blob, including the game slot', () => {
    const state = emptyState(500);
    state.sessions['2025-03-03'] = { day: 'A', ex: { a1: [{ w: '30', r: '12', done: true }] } };
    // a fully-formed game blob round-trips byte for byte (no re-grant)
    const game = emptyGame();
    game.parts.chest.xp = 250;
    game.energy = 70;
    game.granted['2025-03-03|a1|0'] = true;
    game.best['a1'] = 360;
    state.game = game;
    const events: AppEvent[] = [{ id: 'e1', ts: 10, type: 'set_completed', payload: { date: '2025-03-03' } }];
    const blob = buildExport(state, events, 600);

    expect(blob.format).toBe(EXPORT_FORMAT);
    // the mirror keeps old importers (and the legacy app) working
    expect(blob.sessions).toEqual(state.sessions);

    const parsed = parseImport(JSON.stringify(blob));
    expect(parsed?.source).toBe('gym-rpg');
    expect(parsed?.state.sessions).toEqual(state.sessions);
    expect(parsed?.state.game).toEqual(game);
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events[0]?.type).toBe('set_completed');
  });

  it('prefers the new format when a blob has both `state` and `sessions`', () => {
    const state = emptyState(0);
    state.sessions['2030-01-01'] = { day: 'B', ex: { b1: [{ w: '1', r: '1', done: true }] } };
    const blob = buildExport(state, [], 0);
    // sabotage the mirror: the parser must read `state`, not `sessions`
    (blob as { sessions: unknown }).sessions = { '1999-01-01': { day: 'A', ex: {} } };
    const parsed = parseImport(blob);
    expect(parsed?.source).toBe('gym-rpg');
    expect(Object.keys(parsed?.state.sessions ?? {})).toEqual(['2030-01-01']);
  });

  it('rejects junk files', () => {
    expect(parseImport('not json')).toBeNull();
    expect(parseImport('[1,2,3]')).toBeNull();
    expect(parseImport(JSON.stringify({ hello: 'world' }))).toBeNull();
    expect(parseImport(null)).toBeNull();
  });

  it('round-trips export -> import with no loss', () => {
    const imported = importLegacy(emptyState(0), LEGACY_BLOB, null, 42);
    const blob = buildExport(imported.state, imported.events, 43);
    const back = parseImport(JSON.parse(JSON.stringify(blob)) as unknown);
    expect(back?.state.sessions).toEqual(imported.state.sessions);
    // every original event survives, in order; the import may APPEND the Phase 1
    // retroactive XP grants for a file that predates the game layer.
    const ids = back?.events.map((e) => e.id) ?? [];
    expect(ids.slice(0, imported.events.length)).toEqual(imported.events.map((e) => e.id));
    expect(back?.state.game?.totalXp ?? 0).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- replay */

describe('rebuildFromEvents', () => {
  it('rebuilds imported legacy sessions from the log alone', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB, null, 1000);
    const rebuilt = rebuildFromEvents(res.events);
    expect(rebuilt.sessions).toEqual(res.state.sessions);
    expect(rebuilt.meta.legacyImported).toBe(true);
  });

  it('replays set_logged / set_completed / set_uncompleted deterministically', () => {
    const events: AppEvent[] = [
      { id: '1', ts: 1, type: 'set_logged', payload: { date: '2025-06-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '' } },
      { id: '2', ts: 2, type: 'set_logged', payload: { date: '2025-06-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' } },
      { id: '3', ts: 3, type: 'set_completed', payload: { date: '2025-06-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' } },
      { id: '4', ts: 4, type: 'set_completed', payload: { date: '2025-06-01', day: 'A', exId: 'a1', setIndex: 2, w: '45', r: '8' } },
      { id: '5', ts: 5, type: 'set_uncompleted', payload: { date: '2025-06-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' } },
    ];
    const a = rebuildFromEvents(events);
    // shuffled input must produce the same state (events are ts-ordered)
    const b = rebuildFromEvents([...events].reverse());
    expect(b.sessions).toEqual(a.sessions);

    const sets = a.sessions['2025-06-01']?.ex['a1'];
    expect(sets).toHaveLength(3);
    expect(sets?.[0]).toEqual({ w: '40', r: '10', done: false });
    expect(sets?.[1]).toBeNull();
    expect(sets?.[2]).toEqual({ w: '45', r: '8', done: true });
  });

  it('honours data_cleared', () => {
    const res = importLegacy(emptyState(0), LEGACY_BLOB, null, 1000);
    const events: AppEvent[] = [
      ...res.events,
      { id: 'z', ts: 9_999_999_999_999, type: 'data_cleared', payload: {} },
    ];
    expect(rebuildFromEvents(events).sessions).toEqual({});
  });

  it('breaks ts ties by id, so the order is a property of the event SET', () => {
    // three events in the SAME millisecond — exactly what two devices produce
    // when they both fold the same imported day. Only the id can order them.
    const same = (id: string, w: string): AppEvent => ({
      id,
      ts: 1_000,
      type: 'set_logged',
      payload: { date: '2025-08-01', day: 'A', exId: 'a1', setIndex: 0, w, r: '10' },
    });
    const events = [same('c', '30'), same('a', '10'), same('b', '20')];

    // id order is a|b|c, so the LAST write is 'c' -> w: '30', whatever the
    // insertion order was.
    for (const perm of [events, [...events].reverse(), [events[1]!, events[0]!, events[2]!]]) {
      const s = rebuildFromEvents(perm);
      expect(s.sessions['2025-08-01']?.ex['a1']?.[0]?.w).toBe('30');
    }
  });

  it('merges data_imported per date instead of replacing the map', () => {
    // device B logged a workout; a JSON import (from device A) lands after it.
    // The import may only ADD dates — it can never erase what is already there.
    const events: AppEvent[] = [
      {
        id: 'own',
        ts: 10,
        type: 'set_completed',
        payload: { date: '2025-09-02', day: 'B', exId: 'b1', setIndex: 0, w: '80', r: '5' },
      },
      {
        id: 'imp',
        ts: 20,
        type: 'data_imported',
        payload: {
          source: 'gym-rpg',
          sessions: {
            '2025-09-01': { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } },
            // the same date as the live workout, with different content
            '2025-09-02': { day: 'C', ex: { c2: [{ w: '1', r: '1', done: true }] } },
          },
        },
      },
    ];

    const s = rebuildFromEvents(events);
    expect(Object.keys(s.sessions).sort()).toEqual(['2025-09-01', '2025-09-02']);
    // first-wins: the already-folded date keeps its own content
    expect(s.sessions['2025-09-02']?.day).toBe('B');
    expect(s.sessions['2025-09-02']?.ex['b1']?.[0]?.w).toBe('80');
    expect(s.sessions['2025-09-01']?.ex['a1']?.[0]).toEqual({ w: '40', r: '10', done: true });
  });

  it('still replays a single-device import exactly (the snapshot is a superset)', () => {
    // On one device the folded dates are always a subset of the snapshot the
    // import carried, so first-wins merging is indistinguishable from replacing.
    const imported = importLegacy(emptyState(0), LEGACY_BLOB, null, 1000);
    const events: AppEvent[] = [
      ...imported.events,
      { id: 'zz', ts: 2_000_000, type: 'data_imported', payload: { source: 'gym-rpg', sessions: imported.state.sessions } },
    ];
    expect(rebuildFromEvents(events).sessions).toEqual(imported.state.sessions);
  });

  it('ignores unknown / future event types', () => {
    const events: AppEvent[] = [
      { id: 'a', ts: 1, type: 'set_completed', payload: { date: '2025-07-01', day: 'A', exId: 'a1', setIndex: 0, w: '1', r: '1' } },
      { id: 'b', ts: 2, type: 'boss_defeated', payload: { boss: 'x' } },
      { id: 'c', ts: 3, type: 'level_up', payload: { part: 'chest' } },
      // declared-but-not-yet-folded types: a build that predates them must be
      // able to replay a log that contains them without losing anything.
      { id: 'd', ts: 4, type: 'plan_updated', payload: { plan: { days: {} } } },
      { id: 'e', ts: 5, type: 'data_merged', payload: { source: 'sync', added: 3 } },
      { id: 'f', ts: 6, type: 'totally_unknown' as EventType, payload: {} },
    ];
    const s = rebuildFromEvents(events);
    expect(Object.keys(s.sessions)).toEqual(['2025-07-01']);
    expect(s.game).toEqual(rebuildFromEvents(events.slice(0, 1)).game);
  });
});

/* ------------------------------------------------- unknown day keys (v2) */

describe('unknown day keys are DATA, not errors', () => {
  it('preserves a session day this build has never heard of', () => {
    // A plan on another device defines `d_alef`; this device pulls the workout
    // long before (or without ever) learning about that plan. Rewriting the day
    // to 'A' would silently re-file the user's workout under the wrong day.
    const s = migrateState({
      schemaVersion: CURRENT_STATE_VERSION,
      sessions: { '2025-05-01': { day: 'd_alef', ex: { a1: [{ w: '40', r: '10', done: true }] } } },
      ui: { view: 'H', open: {} },
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    });
    expect(s.sessions['2025-05-01']?.day).toBe('d_alef');
  });

  it('only falls back to A for a day that is not a key at all', () => {
    const of = (day: unknown): string | undefined =>
      migrateState({
        schemaVersion: CURRENT_STATE_VERSION,
        sessions: { '2025-05-01': { day, ex: {} } },
        meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
      }).sessions['2025-05-01']?.day;
    expect(of('d_alef')).toBe('d_alef');
    expect(of('A')).toBe('A');
    expect(of(42)).toBe('A');
    expect(of('')).toBe('A');
    // a reserved view key would make the session claim a screen, not a day
    expect(of('H')).toBe('A');
  });

  it('replays set events of an unknown day key verbatim', () => {
    const events: AppEvent[] = [
      { id: '1', ts: 1, type: 'set_completed', payload: { date: '2025-06-01', day: 'd_bet', exId: 'b1', setIndex: 0, w: '60', r: '8' } },
      { id: '2', ts: 2, type: 'set_logged', payload: { date: '2025-06-01', day: 'd_bet', exId: 'b1', setIndex: 1, w: '62', r: '8' } },
    ];
    const s = rebuildFromEvents(events);
    expect(s.sessions['2025-06-01']?.day).toBe('d_bet');
    expect(s.sessions['2025-06-01']?.ex['b1']?.[0]).toEqual({ w: '60', r: '8', done: true });
    // and the XP the events paid is unaffected by the day being unknown
    expect(rebuildFromEvents(events).sessions).toEqual(s.sessions);
  });

  it('keeps a session_imported day key through the import round-trip', () => {
    const res = importLegacy(emptyState(0), {
      sessions: { '2025-01-05': { day: 'd_custom1', ex: { a1: [{ w: '1', r: '1', done: true }] } } },
    });
    expect(res.state.sessions['2025-01-05']?.day).toBe('d_custom1');
    expect(res.events[0]?.payload['day']).toBe('d_custom1');
    expect(rebuildFromEvents(res.events).sessions['2025-01-05']?.day).toBe('d_custom1');
  });

  it('drops a stored UI view that no plan day answers to', () => {
    // The tab the app was left on is gone (a day deleted on another device):
    // open on the default day instead of on a tab that renders nothing.
    const s = migrateState(
      {
        schemaVersion: CURRENT_STATE_VERSION,
        sessions: {},
        ui: { view: 'd_gone', open: {} },
        meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
      },
      Date.parse('2025-01-05T12:00:00Z'), // a Sunday -> day A of the built-in program
    );
    expect(s.ui.view).toBe('A');
  });

  it('keeps a stored UI view that the saved plan DOES define', () => {
    const plan = {
      version: 2,
      rev: 1,
      days: [{ key: 'd_alef', label: "חלק א'", weekdays: [0, 3], exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] }],
      weeklyTarget: 4,
      customExercises: [],
    };
    const s = migrateState({
      schemaVersion: CURRENT_STATE_VERSION,
      sessions: {},
      ui: { view: 'd_alef', open: {} },
      plan,
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    });
    expect(s.ui.view).toBe('d_alef');
    // …and the four reserved screens are always legal, plan or no plan
    for (const view of ['CH', 'BT', 'H', 'PL']) {
      const withView = migrateState({
        schemaVersion: CURRENT_STATE_VERSION,
        sessions: {},
        ui: { view, open: {} },
        plan,
        meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
      });
      expect(withView.ui.view).toBe(view);
    }
  });

  it('accepts an occurrence view (`dayKey@weekday`) and refuses a bogus one', () => {
    // A day trained on two weekdays shows two tabs, and the tab the app was left
    // on is stored as `d_alef@3`. Both that shape and the bare key it replaced
    // survive a reload; a weekday the day is NOT trained on cannot highlight a
    // tab, so it falls back to the default tab for `now`.
    const plan = {
      version: 2,
      rev: 1,
      days: [
        { key: 'd_alef', label: "חלק א'", weekdays: [0, 3], exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] },
        { key: 'd_bet', label: "חלק ב'", weekdays: [2, 4], exercises: [{ id: 'b1', sets: 3, reps: '8', rest: 60 }] },
      ],
      weeklyTarget: 4,
      customExercises: [],
    };
    const viewOf = (view: unknown, now = Date.parse('2025-01-05T12:00:00Z')): string =>
      migrateState(
        {
          schemaVersion: CURRENT_STATE_VERSION,
          sessions: {},
          ui: { view, open: {} },
          plan,
          meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
        },
        now,
      ).ui.view;

    expect(viewOf('d_alef@3')).toBe('d_alef@3');
    expect(viewOf('d_bet@2')).toBe('d_bet@2');
    expect(viewOf('d_alef')).toBe('d_alef'); // stored before schedule tabs existed
    // 2025-01-05 is a Sunday, which חלק א׳ is trained on -> that occurrence
    expect(viewOf('d_alef@6')).toBe('d_alef@0');
    expect(viewOf('d_gone@0')).toBe('d_alef@0');
    expect(viewOf('@0')).toBe('d_alef@0');
    expect(viewOf(42)).toBe('d_alef@0');
    // …and a fresh install opens on the occurrence scheduled for today
    expect(viewOf(undefined, Date.parse('2025-01-08T12:00:00Z'))).toBe('d_alef@3'); // Wednesday
    expect(viewOf(undefined, Date.parse('2025-01-09T12:00:00Z'))).toBe('d_bet@4'); // Thursday
  });
});
