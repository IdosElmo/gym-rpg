/**
 * Store-level tests for the game layer: live grants through the DataStore, the
 * anti-farming guard, event-replay equivalence, and every path that has to hand
 * out RETROACTIVE XP (fresh legacy import, a Phase-0 user with no game state,
 * a log-less state blob, and JSON import/export round-trips).
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { gameOf, onSetCompleted, onWorkoutFinished, refreshStreak } from '../src/core/game.ts';
import { emptyGame } from '../src/core/xp.ts';
import { PROGRAM, findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, GameState, Session } from '../src/storage/DataStore.ts';
import {
  EVENTS_KEY,
  STATE_KEY,
  LEGACY_KEY,
  buildExport,
  emptyState,
  makeEvent,
  parseImport,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

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

/** A day where every set of every exercise is checked. */
function fullDayA(): Session['ex'] {
  return Object.fromEntries(
    PROGRAM.A.exercises.map((e) => [e.id, Array.from({ length: e.sets }, () => ({ w: '20', r: '10', done: true }))]),
  );
}

/* --------------------------------------------------------- live grants */

describe('live XP grants through the store', () => {
  it('grants XP + energy for a completed set and writes both to the log', () => {
    const store = new LocalStore(fakeStorage());
    const grant = onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });

    expect(grant.xp).toBeCloseTo(BALANCE.xp.baseSetXp, 6);
    expect(grant.energy).toBe(BALANCE.energy.perSet);
    expect(grant.parts.map((p) => p.part)).toEqual(['chest', 'arms']); // sorted by amount

    const game = gameOf(store);
    expect(game.parts.chest.xp).toBeCloseTo(8, 6);
    expect(game.parts.arms.xp).toBeCloseTo(2, 6);
    expect(game.energy).toBe(BALANCE.energy.perSet);
    expect(game.workoutDays).toEqual([TODAY]);

    const types = store.getEvents().map((e) => e.type);
    expect(types).toEqual(['xp_gained', 'energy_gained']);
  });

  it('cannot be farmed by unchecking and re-checking a set', () => {
    const store = new LocalStore(fakeStorage());
    const args = { date: TODAY, day: 'A' as const, ex: ex('a1'), setIndex: 0, w: '40', r: '10' };
    onSetCompleted(store, args);
    const before = gameOf(store);
    const xpBefore = before.totalXp;
    const energyBefore = before.energy;
    const eventsBefore = store.getEvents().length;

    // the user unchecks (no XP is ever refunded) and checks again, twice
    const again = onSetCompleted(store, args);
    const third = onSetCompleted(store, { ...args, w: '999', r: '999' });

    expect(again.xp).toBe(0);
    expect(third.xp).toBe(0);
    expect(gameOf(store).totalXp).toBe(xpBefore);
    expect(gameOf(store).energy).toBe(energyBefore);
    expect(store.getEvents()).toHaveLength(eventsBefore);
  });

  it('pays the workout-completion bonus exactly once per date', () => {
    const store = new LocalStore(fakeStorage());
    const first = onWorkoutFinished(store, { date: TODAY, day: 'A' });
    expect(first.xp).toBe(BALANCE.xp.workoutCompletionBonus * 6);
    expect(first.energy).toBe(BALANCE.energy.perWorkout);
    expect(gameOf(store).parts.core.xp).toBe(BALANCE.xp.workoutCompletionBonus);

    const second = onWorkoutFinished(store, { date: TODAY, day: 'A' });
    expect(second.xp).toBe(0);
    expect(gameOf(store).parts.core.xp).toBe(BALANCE.xp.workoutCompletionBonus);
  });

  it('reports level-ups so the UI can celebrate them', () => {
    const store = new LocalStore(fakeStorage());
    // 11 sets of a legs-only exercise: 10 XP each -> crosses 100 XP
    let levelUps = 0;
    for (let i = 0; i < 11; i += 1) {
      const grant = onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a3'), setIndex: i, w: '20', r: '10' });
      levelUps += grant.levelUps.length;
    }
    expect(levelUps).toBe(1);
    expect(gameOf(store).parts.legs.level).toBe(2);
    expect(store.getEvents().filter((e) => e.type === 'level_up')).toHaveLength(1);
  });

  it('records a streak_changed event when a tier moves', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      const g = emptyGame();
      g.workoutDays = ['2025-01-05', '2025-01-07', '2025-01-09'];
      d.game = g;
    });
    const res = refreshStreak(store, new Date('2025-01-13T09:00:00Z'));
    expect(res.previous).toBe(0);
    expect(res.tier).toBe(1);
    expect(gameOf(store).streak.tier).toBe(1);
    expect(store.getEvents().filter((e) => e.type === 'streak_changed')).toHaveLength(1);
  });
});

/* ------------------------------------------------------ replay equality */

describe('event replay rebuilds the live game state', () => {
  it('matches after a realistic session (sets, a PR, a completion bonus)', () => {
    const store = new LocalStore(fakeStorage());
    const now = Date.now();

    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 1, w: '45', r: '10' }); // PR
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a3'), setIndex: 0, w: '20', r: '12' });
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a6'), setIndex: 0, w: '', r: '15' });
    onWorkoutFinished(store, { date: TODAY, day: 'A' });

    const replayed = rebuildFromEvents(store.getEvents(), now);
    expect(replayed.game).toEqual(gameOf(store));
    expect(replayed.game?.prCount).toBe(1);
  });

  it('is order-independent: shuffled events replay to the same state', () => {
    const store = new LocalStore(fakeStorage());
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a2'), setIndex: 0, w: '30', r: '10' });
    const now = Date.now();

    const straight = rebuildFromEvents(store.getEvents(), now).game;
    const shuffled = rebuildFromEvents([...store.getEvents()].reverse(), now).game;
    expect(shuffled).toEqual(straight);
  });

  it('replays a wipe: data_cleared resets the character too', () => {
    const store = new LocalStore(fakeStorage());
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
    const events: AppEvent[] = [...store.getEvents(), makeEvent('data_cleared', {}, Date.now() + 1000)];
    const replayed = rebuildFromEvents(events);
    expect(replayed.game?.totalXp).toBe(0);
    expect(replayed.game?.energy).toBe(0);
  });
});

/* ----------------------------------------------------- retroactive paths */

describe('retroactive XP on first Phase 1 load', () => {
  it('grants XP for a legacy hyp3_data_v1 import (streak stays 0, no energy)', () => {
    const store = new LocalStore(fakeStorage({ [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB) }));
    const game = gameOf(store);

    expect(game.totalXp).toBeGreaterThan(0);
    expect(game.parts.chest.xp).toBeGreaterThan(0);
    expect(game.energy).toBe(0);
    expect(game.streak.tier).toBe(0);
    expect(game.workoutDays).toEqual([]);
    // the grants are in the log, so they replay
    expect(store.getEvents().some((e) => e.type === 'xp_gained')).toBe(true);
    expect(rebuildFromEvents(store.getEvents()).game).toEqual(game);
  });

  it('grants XP to a user who ALREADY imported under Phase 0 (game === null)', () => {
    // exactly what Phase 0 persisted: v1 state with game:null + session_imported events
    const phase0State = {
      schemaVersion: 1,
      sessions: LEGACY_BLOB.sessions,
      ui: { view: 'A', open: {} },
      game: null,
      meta: { legacyImported: true, legacyImportedAt: 1, createdAt: 1, updatedAt: 1 },
    };
    const phase0Events = Object.entries(LEGACY_BLOB.sessions).map(([date, s]) =>
      makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'legacy_v1' }, Date.parse(`${date}T00:00:00Z`)),
    );
    const storage = fakeStorage({
      [STATE_KEY]: JSON.stringify(phase0State),
      [EVENTS_KEY]: JSON.stringify({ schemaVersion: 1, events: phase0Events }),
    });

    const store = new LocalStore(storage);
    const game = gameOf(store);
    expect(game.version).toBe(emptyGame().version);
    expect(game.totalXp).toBeGreaterThan(0);
    expect(game.streak.tier).toBe(0);
    expect(game.energy).toBe(0);

    // and it is written back, so the next boot is a no-op
    const reopened = new LocalStore(storage);
    expect(gameOf(reopened)).toEqual(game);
    expect(reopened.getEvents()).toHaveLength(store.getEvents().length);
  });

  it('recovers sessions that the event log never knew about', () => {
    // a state blob with history but an EMPTY log (worst case) still pays out
    const orphan = {
      schemaVersion: 1,
      sessions: LEGACY_BLOB.sessions,
      ui: { view: 'A', open: {} },
      game: null,
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    };
    const store = new LocalStore(fakeStorage({ [STATE_KEY]: JSON.stringify(orphan) }));

    expect(gameOf(store).totalXp).toBeGreaterThan(0);
    // the recovery is expressed as events, so replay still reproduces it
    expect(store.getEvents().some((e) => e.payload['source'] === 'recovered')).toBe(true);
    expect(rebuildFromEvents(store.getEvents()).game).toEqual(gameOf(store));
  });

  it('does not re-grant on every boot', () => {
    const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify(LEGACY_BLOB) });
    const first = new LocalStore(storage);
    const xp = gameOf(first).totalXp;
    const count = first.getEvents().length;

    const second = new LocalStore(storage);
    expect(gameOf(second).totalXp).toBe(xp);
    expect(second.getEvents()).toHaveLength(count);
  });

  it('grants XP for a completed imported day, including its bonus', () => {
    const blob = { sessions: { '2025-01-05': { day: 'A', ex: fullDayA() } } };
    const store = new LocalStore(fakeStorage({ [LEGACY_KEY]: JSON.stringify(blob) }));
    const game = gameOf(store);
    expect(game.parts.core.xp).toBeGreaterThanOrEqual(BALANCE.xp.workoutCompletionBonus);
    // retro completion pays XP but still no energy
    expect(game.energy).toBe(0);
  });
});

/* ------------------------------------------------------- export / import */

describe('export / import carries the game state', () => {
  it('round-trips a Phase 1 game blob unchanged', () => {
    const store = new LocalStore(fakeStorage());
    onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
    store.update((d) => {
      d.sessions[TODAY] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    });

    const blob = buildExport(store.getState(), store.getEvents());
    const parsed = parseImport(JSON.parse(JSON.stringify(blob)) as unknown);

    expect(parsed?.state.game).toEqual(gameOf(store));
    expect(parsed?.events).toHaveLength(store.getEvents().length);

    const restored = new LocalStore(fakeStorage());
    restored.replaceAll(parsed!.state, parsed!.events);
    expect(gameOf(restored).totalXp).toBe(gameOf(store).totalXp);
  });

  it('grants retroactive XP when importing a Phase 0 export (game === null)', () => {
    const state = emptyState(1000);
    state.sessions['2025-01-05'] = LEGACY_BLOB.sessions['2025-01-05'] as Session;
    const blob = { ...buildExport(state, [], 1000), state: { ...state, game: null } };

    const parsed = parseImport(JSON.parse(JSON.stringify(blob)) as unknown);
    const game = parsed?.state.game as GameState;
    expect(game.totalXp).toBeGreaterThan(0);
    expect(game.energy).toBe(0);
    expect(parsed?.events.some((e) => e.type === 'xp_gained')).toBe(true);
  });

  it('grants retroactive XP when importing a legacy backup file', () => {
    const parsed = parseImport(JSON.stringify(LEGACY_BLOB));
    expect(parsed?.source).toBe('legacy');
    expect((parsed?.state.game as GameState).totalXp).toBeGreaterThan(0);
    expect((parsed?.state.game as GameState).streak.tier).toBe(0);
  });
});
