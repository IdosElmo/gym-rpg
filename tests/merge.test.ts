/**
 * merge.test.ts — the convergence properties multi-device sync will rest on.
 *
 * Sync is defined as "union of event sets, then deterministic replay". Nothing
 * here talks to a network or to the sync engine (that is `sync.engine.test.ts`
 * above it, and `e2e.sync.test.ts` around both): the tests simulate two
 * independent installs by driving two `LocalStore`s and folding the union of
 * their logs. What must hold is:
 *
 *   1. TOTAL ORDER — the fold order is a function of the event SET alone, so
 *      merging in either direction (or in any shuffled order) gives byte-
 *      identical state. Ties on `ts` are broken by `id`.
 *   2. IDEMPOTENCE — semantically duplicate grants (same date/exercise/set,
 *      DIFFERENT uuids, e.g. two devices that each imported the same legacy
 *      file) pay exactly once. Id-dedupe alone cannot catch those.
 *   3. A `data_cleared` in the middle of a union still wipes what precedes it
 *      and keeps what follows it, in both merge directions.
 */
import { describe, expect, it } from 'vitest';

import { buyCharacter, onSetCompleted, onWaveCleared, onWorkoutFinished, selectBody } from '../src/core/game.ts';
import { compareEvents } from '../src/core/xp.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { mergeIntoStore } from '../src/storage/merge.ts';
import type { AppEvent, AppState } from '../src/storage/DataStore.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { LEGACY_KEY, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

/* --------------------------------------------------------------- fixtures */

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function ex(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
}

const TODAY = '2025-05-04';
/** Fixed replay clock so `finalizeGame`'s streak math is comparable. */
const NOW = Date.parse('2025-05-04T18:00:00.000Z');

const LEGACY_BLOB = {
  sessions: {
    '2025-01-05': {
      day: 'A',
      ex: {
        a1: [
          { w: '40', r: '10', done: true },
          { w: '45', r: '10', done: true },
        ],
        a5: [{ w: '12', r: '12', done: true }],
      },
    },
    '2025-01-07': { day: 'B', ex: { b1: [{ w: '50', r: '10', done: true }] } },
  },
};

/** What a server holds: the union of two event sets, deduped by id. */
function union(...logs: ReadonlyArray<readonly AppEvent[]>): AppEvent[] {
  const byId = new Map<string, AppEvent>();
  for (const log of logs) for (const ev of log) if (!byId.has(ev.id)) byId.set(ev.id, ev);
  return [...byId.values()];
}

/** Deterministic shuffle (LCG) — no test flakiness, full order coverage. */
function shuffle(list: readonly AppEvent[], seed: number): AppEvent[] {
  const out = [...list];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    const j = s % (i + 1);
    const a = out[i] as AppEvent;
    const b = out[j] as AppEvent;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function fold(events: readonly AppEvent[]): AppState {
  return rebuildFromEvents(events, NOW);
}

/** Byte-identical, not merely deep-equal: key ORDER has to converge too. */
function bytes(state: AppState): string {
  return JSON.stringify(state);
}

/**
 * Log one set exactly like the UI does: the session event first, then the XP
 * grant. Both halves have to survive a merge, and they exercise the two folds
 * (`rebuildFromEvents` for the sessions, `rebuildGame` for the game layer).
 */
function logSet(store: LocalStore, exId: string, setIndex: number, w: string, r: string): void {
  store.append('set_completed', { date: TODAY, day: 'A', exId, setIndex, w, r });
  onSetCompleted(store, { date: TODAY, day: 'A', ex: ex(exId), setIndex, w, r });
}

/* ------------------------------------------------------------ the devices */

/** Run `fn` with a frozen clock, so two devices provably collide on the ms. */
function withClock<T>(at: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => at;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

/**
 * Two installs that share a prefix and then diverge offline.
 *
 * `shared` is the history both of them have (device B "was" device A up to that
 * point — it pulled those exact events, ids and all); afterwards each logs its
 * own workout without ever seeing the other's.
 *
 * The clock is frozen for the whole scenario: both devices stamp overlapping
 * timestamps, which is the interesting case — the merge order is then decided
 * entirely by the id tie-break.
 */
function divergentDevices(): { shared: AppEvent[]; a: AppEvent[]; b: AppEvent[] } {
  return withClock(1_700_000_000_000, () => divergentDevicesInner());
}

function divergentDevicesInner(): { shared: AppEvent[]; a: AppEvent[]; b: AppEvent[] } {
  const deviceA = new LocalStore(fakeStorage());
  logSet(deviceA, 'a1', 0, '40', '10');
  const shared = [...deviceA.getEvents()];

  // device B starts from the same shared prefix, then goes its own way
  const deviceB = new LocalStore(fakeStorage());
  deviceB.replaceAll(fold(shared), shared);
  logSet(deviceB, 'a2', 0, '30', '12');
  logSet(deviceB, 'a3', 0, '60', '8');

  // ...while device A logs a PR on the exercise it already knows
  logSet(deviceA, 'a1', 1, '50', '10');
  onWorkoutFinished(deviceA, { date: TODAY, day: 'A' });

  return { shared, a: [...deviceA.getEvents()], b: [...deviceB.getEvents()] };
}

/* ------------------------------------------------------------ convergence */

describe('union merge converges', () => {
  it('folds A∪B and B∪A to byte-identical state', () => {
    const { a, b } = divergentDevices();
    const ab = fold(union(a, b));
    const ba = fold(union(b, a));

    expect(bytes(ba)).toBe(bytes(ab));
    // and the merge really did carry both sides' work
    expect(Object.keys(ab.sessions)).toEqual([TODAY]);
    expect(ab.game?.totalXp).toBeGreaterThan((fold(a).game?.totalXp ?? 0));
    expect(ab.game?.totalXp).toBeGreaterThan((fold(b).game?.totalXp ?? 0));
  });

  it('is insensitive to the order the events arrive in', () => {
    const { a, b } = divergentDevices();
    const merged = union(a, b);
    const reference = bytes(fold(merged));
    for (const seed of [1, 7, 42, 1337, 99_991]) {
      expect(bytes(fold(shuffle(merged, seed)))).toBe(reference);
    }
  });

  it('re-merging an already-merged log changes nothing (idempotent)', () => {
    const { a, b } = divergentDevices();
    const merged = union(a, b);
    expect(bytes(fold(union(merged, a, b, merged)))).toBe(bytes(fold(merged)));
    expect(union(merged, a, b)).toHaveLength(merged.length);
  });

  it('orders same-millisecond events from different devices by id', () => {
    const { a, b } = divergentDevices();
    const merged = union(a, b);
    const ordered = [...merged].sort(compareEvents);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1] as AppEvent;
      const cur = ordered[i] as AppEvent;
      expect(prev.ts <= cur.ts).toBe(true);
      if (prev.ts === cur.ts) expect(prev.id < cur.id).toBe(true);
    }
    // Every device's OWN events keep a strictly increasing ts, so the id
    // tie-break is only ever consulted between events of different devices —
    // which are genuinely concurrent, and where any total order will do.
    const byDevice = new Map<string, number[]>();
    for (const ev of merged) {
      if (ev.device === undefined) continue;
      const list = byDevice.get(ev.device) ?? [];
      list.push(ev.ts);
      byDevice.set(ev.device, list);
    }
    expect(byDevice.size).toBe(2);
    for (const tss of byDevice.values()) expect([...new Set(tss)]).toHaveLength(tss.length);
    // ...and the two devices really did collide on at least one millisecond,
    // i.e. this test is not vacuous.
    const allTs = merged.map((e) => e.ts);
    expect(new Set(allTs).size).toBeLessThan(allTs.length);
  });

  it('never loses an event: the merged log is the union of the two sets', () => {
    const { a, b } = divergentDevices();
    const merged = union(a, b);
    const ids = new Set(merged.map((e) => e.id));
    for (const ev of [...a, ...b]) expect(ids.has(ev.id)).toBe(true);
  });
});

/* ---------------------------------------------------- semantic duplicates */

/* ------------------------------------------------- the roster (body × skin) */

/**
 * The roster is folded from the same log as everything else, so it inherits
 * these properties for free — but it is the one part of the state whose ids
 * changed shape (a purchase names a SKIN, a selection names a body × skin
 * combination, and a pre-matrix log names neither exactly). This drives the real
 * `mergeIntoStore` path across that boundary.
 */
describe('the roster converges through a real merge', () => {
  it('charges one skin once and lands both devices on the last choice', () => {
    // A frozen clock throughout: `LocalStore` stamps `ts` itself, and the whole
    // point of the scenario is that B acted LATER.
    const a = withClock(NOW - 100_000, () => {
      const store = new LocalStore(fakeStorage());
      onWaveCleared(store, {
        world: 1,
        wave: 1,
        miniBoss: false,
        enemyId: 'w1_rat',
        coins: 3000,
        energySpent: 0,
        seed: 1,
        durationMs: 10,
      });
      return store;
    });
    const b = new LocalStore(fakeStorage());
    b.replaceAll(JSON.parse(JSON.stringify(a.getState())) as AppState, a.getEvents());

    // both devices buy the same skin offline (different uuids)…
    withClock(NOW, () => buyCharacter(a, 'robot', new Date(NOW)));
    withClock(NOW + 10_000, () => buyCharacter(b, 'robot', new Date(NOW + 10_000)));
    // …and B then switches body, later
    withClock(NOW + 20_000, () => selectBody(b, 'female', new Date(NOW + 20_000)));

    mergeIntoStore(a, b.getEvents(), NOW + 60_000);
    mergeIntoStore(b, a.getEvents(), NOW + 60_000);

    expect(a.getState().game?.characters).toEqual(b.getState().game?.characters);
    expect(a.getState().game?.characters.owned).toEqual(['robot']);
    expect(a.getState().game?.characters.selected).toBe('robot_f');
    expect(a.getState().game?.battle.coins).toBe(2600); // 3000 − 400, once
    expect(JSON.stringify(a.getState().game)).toBe(JSON.stringify(b.getState().game));
  });

  it('merges a single-body device\'s log into a body × skin one', () => {
    const modern = new LocalStore(fakeStorage());
    // events exactly as the single-body build wrote them
    const legacy: AppEvent[] = [
      { id: 'L1', ts: NOW - 9_000, type: 'wave_cleared', payload: { world: 1, wave: 1, coins: 2500 } },
      { id: 'L2', ts: NOW - 8_000, type: 'character_purchased', payload: { characterId: 'ninja', cost: 1800 } },
      { id: 'L3', ts: NOW - 7_000, type: 'character_selected', payload: { characterId: 'ninja' } },
    ];
    mergeIntoStore(modern, legacy, NOW);
    expect(modern.getState().game?.characters).toEqual({ owned: ['ninja'], selected: 'ninja_f' });

    // this device now switches the ninja onto the male body — free
    expect(selectBody(modern, 'male')).toBe(true);
    expect(modern.getState().game?.characters.selected).toBe('ninja_m');
    expect(modern.getState().game?.battle.coins).toBe(700);

    // and the merged log still folds the same way from either direction
    const union = modern.getEvents();
    const forward = rebuildFromEvents(union, NOW);
    const backward = rebuildFromEvents([...union].reverse(), NOW);
    expect(JSON.stringify(forward.game)).toBe(JSON.stringify(backward.game));
  });
});

describe('semantic duplicates never double-pay', () => {
  /** Two installs that each imported the same legacy backup, independently. */
  function twoLegacyImports(): { a: AppEvent[]; b: AppEvent[] } {
    const raw = JSON.stringify(LEGACY_BLOB);
    const a = new LocalStore(fakeStorage({ [LEGACY_KEY]: raw }));
    const b = new LocalStore(fakeStorage({ [LEGACY_KEY]: raw }));
    return { a: [...a.getEvents()], b: [...b.getEvents()] };
  }

  it('two devices retro-granting the same history merge to a single payout', () => {
    const { a, b } = twoLegacyImports();

    // the two logs are semantically identical but share NOT ONE id: id-based
    // dedupe is powerless here, only the reducer's grant keys save us.
    const idsA = new Set(a.map((e) => e.id));
    expect(b.some((e) => idsA.has(e.id))).toBe(false);
    const grantsA = a.filter((e) => e.type === 'xp_gained');
    expect(grantsA.length).toBeGreaterThan(0);
    expect(b.filter((e) => e.type === 'xp_gained')).toHaveLength(grantsA.length);

    const alone = fold(a);
    const merged = fold(union(a, b));
    expect(merged.game?.totalXp).toBe(alone.game?.totalXp);
    expect(merged.game?.parts.chest.xp).toBe(alone.game?.parts.chest.xp);
    expect(merged.game?.prCount).toBe(alone.game?.prCount);
    expect(merged.game?.energy).toBe(alone.game?.energy);
    expect(merged.sessions).toEqual(alone.sessions);
    // ...in both directions
    expect(bytes(fold(union(b, a)))).toBe(bytes(merged));
  });

  it('duplicated live grants pay once for XP, energy and PRs alike', () => {
    const store = new LocalStore(fakeStorage());
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 1, w: '50', r: '10' }); // PR
    onWorkoutFinished(store, { date: TODAY, day: 'A' });
    const log = [...store.getEvents()];

    // the same events re-created by a second device: same payloads + ts, new ids
    const clone = log.map((e, i) => ({ ...e, id: `clone-${i}`, device: 'other-device' }));
    const once = fold(log);
    const merged = fold(union(log, clone));

    expect(merged.game?.totalXp).toBe(once.game?.totalXp);
    expect(merged.game?.energy).toBe(once.game?.energy);
    expect(merged.game?.energyEarned).toBe(once.game?.energyEarned);
    expect(merged.game?.prCount).toBe(once.game?.prCount);
    expect(merged.game?.best).toEqual(once.game?.best);
    expect(merged.game?.workoutDays).toEqual(once.game?.workoutDays);
  });

  it('an unkeyed (pre-v4) energy event is the one documented exception', () => {
    // Logs written before the `key` field cannot be guarded — they replay
    // exactly as they always did, which is right for a single device and is
    // the accepted caveat when such a log is merged with a copy of itself.
    const legacyEnergy: AppEvent[] = [
      { id: 'e1', ts: 10, type: 'energy_gained', payload: { date: TODAY, amount: 2, source: 'set', retro: false } },
    ];
    const clone: AppEvent[] = [{ ...(legacyEnergy[0] as AppEvent), id: 'e2' }];
    expect(fold(legacyEnergy).game?.energy).toBe(2);
    expect(fold(union(legacyEnergy, clone)).game?.energy).toBe(4);
  });
});

/* ------------------------------------------------------- clear in a union */

describe('data_cleared inside a union', () => {
  it('wipes what precedes it and keeps what follows, in either merge order', () => {
    // A hand-driven clock: "before" and "after" the wipe must be unambiguous,
    // otherwise the two devices are concurrent and either outcome is legal.
    const realNow = Date.now;
    let clock = 1_700_000_000_000;
    Date.now = () => clock;
    let beforeClear: AppEvent[] = [];
    let bEarly: AppEvent[] = [];
    let clearMarker: AppEvent[] = [];
    let bLate: AppEvent[] = [];
    try {
      const deviceA = new LocalStore(fakeStorage());
      logSet(deviceA, 'a1', 0, '40', '10');
      beforeClear = [...deviceA.getEvents()];

      // device B mirrors that prefix and keeps training while A wipes itself
      clock += 1_000;
      const deviceB = new LocalStore(fakeStorage());
      deviceB.replaceAll(fold(beforeClear), beforeClear);
      logSet(deviceB, 'a2', 0, '30', '12');
      bEarly = [...deviceB.getEvents()];

      clock += 1_000;
      deviceA.clear();
      clearMarker = [...deviceA.getEvents()];
      expect(clearMarker.map((e) => e.type)).toEqual(['data_cleared']);

      // ...and B logs one more set AFTER the wipe happened
      clock += 1_000;
      logSet(deviceB, 'a4', 0, '20', '10');
      bLate = deviceB.getEvents().filter((e) => !bEarly.some((x) => x.id === e.id));
      expect(bLate.length).toBeGreaterThan(0);
    } finally {
      Date.now = realNow;
    }

    const logA = [...beforeClear, ...clearMarker];
    const logB = [...bEarly, ...bLate];
    const ab = fold(union(logA, logB));
    const ba = fold(union(logB, logA));
    expect(bytes(ba)).toBe(bytes(ab));

    // the wipe erased the sessions logged before it; the post-wipe set remains
    const sets = ab.sessions[TODAY]?.ex ?? {};
    expect(Object.keys(sets)).toEqual(['a4']);
    // XP is likewise only what was earned after the wipe
    const afterOnly = fold(bLate);
    expect(ab.game?.totalXp).toBe(afterOnly.game?.totalXp);
    expect(ab.game?.energy).toBe(afterOnly.game?.energy);
  });

  it('a wipe that is the newest event in the union clears everything', () => {
    const { a, b } = divergentDevices();
    const latest = Math.max(...[...a, ...b].map((e) => e.ts));
    const wipe: AppEvent = { id: 'zzz-wipe', ts: latest + 1, type: 'data_cleared', payload: {}, device: 'a' };
    const merged = fold(union(a, b, [wipe]));
    expect(merged.sessions).toEqual({});
    expect(merged.game?.totalXp).toBe(0);
    expect(merged.game?.energy).toBe(0);
    expect(merged.game?.granted).toEqual({});
    expect(merged.game?.energyGranted).toEqual({});
  });
});

/* ------------------------------------------------- what a merge must NOT do */

describe('a merge folds the account, not this install', () => {
  /**
   * `meta.legacyImported` is not account data — it is this device's note that
   * it has already scanned its own `hyp3_data_v1`. Replaying the log cannot
   * know that (a wipe leaves a log with nothing but the marker), so
   * `mergeIntoStore` has to carry it across exactly like `meta.createdAt`.
   *
   * Without that, the sequence below resurrects deleted data: wipe the account,
   * pull anything at all, reload — and the legacy blob is imported all over
   * again, back into the account this time.
   */
  it('keeps the legacy import remembered, so a wipe survives a reload', () => {
    const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB) });
    const store = new LocalStore(storage);
    expect(Object.keys(store.getState().sessions)).toContain('2025-01-05');
    expect(store.getState().meta.legacyImported).toBe(true);

    store.clear();
    expect(store.getState().sessions).toEqual({});
    expect(store.getState().meta.legacyImported).toBe(true);

    // Something arrives from another device (a cloud pull, or an additive
    // import): the state is rebuilt from the union of the logs.
    const foreign: AppEvent = {
      id: 'zzz-foreign',
      ts: Date.now() + 5_000,
      type: 'set_completed',
      payload: { date: TODAY, day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' },
      device: 'other-device',
    };
    expect(mergeIntoStore(store, [foreign]).added).toBe(1);
    expect(store.getState().meta.legacyImported).toBe(true);

    // The proof: the next boot does not bring the wiped history back.
    const reloaded = new LocalStore(storage);
    expect(reloaded.getState().sessions['2025-01-05']).toBeUndefined();
    expect(Object.keys(reloaded.getState().sessions)).toEqual([TODAY]);
  });
});
