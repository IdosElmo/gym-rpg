/**
 * e2e.duel.test.ts — TWO ACCOUNTS, ONE HOUSEHOLD, ONE DUEL.
 *
 * `e2e.sync.test.ts` plays one account across two devices. This one plays TWO
 * ACCOUNTS against each other through a single in-memory backend: two stores,
 * two sync engines, two ghost publishers, one `ghosts` table and one `events`
 * table partitioned by user — the same shape `supabase/schema.sql` describes,
 * including the part that makes the feature possible at all (a row in `ghosts`
 * is readable by everyone, a row in `events` only by its owner).
 *
 * NOTHING HERE TOUCHES A NETWORK.
 *
 * What it asserts, end to end:
 *   1. A publishes a ghost by simply syncing; B can look it up by handle.
 *   2. B fights the real character: the numbers come from A's own levels, gear
 *      and streak through the same `deriveStats` A's screen uses.
 *   3. The duel is recorded once, on B's log only — A's account is untouched,
 *      because a ghost is presence data and never an event.
 *   4. B's second device converges on the same record, in both merge orders,
 *      and the fee is charged exactly once.
 *   5. Nobody earns a coin.
 *   6. The seed is symmetric: A fighting B on the same day is the same fight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { createChallengeBattle, simulate, type ChallengeResult, type CombatStats } from '../src/core/combat.ts';
import { buildGhost, duelSeed, ghostHash, ghostRun, ghostStats, normalizeGhost } from '../src/core/ghost.ts';
import { duelKey } from '../src/core/handle.ts';
import { gameOf, ghostDuelStatus, onGhostDuel, onSetCompleted } from '../src/core/game.ts';
import { statsOfGame } from '../src/core/xp.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, GameState } from '../src/storage/DataStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { GhostHandleTakenError, type GhostRow, type PullPage, type SyncBackend } from '../src/sync/backend.ts';
import { SyncEngine } from '../src/sync/engine.ts';

/* --------------------------------------------------------------- fixtures */

const DATE = '2025-05-04';
const START = Date.parse('2025-05-04T09:00:00.000Z');
const FEE = BALANCE.duel.entryEnergy;
const LOSS_COINS = BALANCE.duel.lossCoins;

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
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

interface Row {
  seq: number;
  ev: AppEvent;
}

/**
 * The server. `events` is partitioned per user (nobody can read anybody else's
 * — the parameter is the partition); `ghosts` is ONE row per user with a unique
 * handle and is readable by everyone. That asymmetry is the entire ghost-duel
 * security model, so the fake reproduces it rather than glossing over it.
 */
class MemoryBackend implements SyncBackend {
  private readonly rows = new Map<string, Row[]>();
  private readonly seqs = new Map<string, number>();
  readonly ghosts = new Map<string, GhostRow>();
  publishes = 0;

  private listOf(userId: string): Row[] {
    const list = this.rows.get(userId) ?? [];
    this.rows.set(userId, list);
    return list;
  }

  async pushEvents(userId: string, events: readonly AppEvent[]): Promise<void> {
    const list = this.listOf(userId);
    for (const ev of events) {
      if (list.some((r) => r.ev.id === ev.id)) continue;
      const seq = (this.seqs.get(userId) ?? 0) + 1;
      this.seqs.set(userId, seq);
      list.push({ seq, ev });
    }
  }

  async pullEvents(userId: string, afterSeq: number, limit: number): Promise<PullPage> {
    const page = this.listOf(userId)
      .filter((r) => r.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    const last = page[page.length - 1];
    return { events: page.map((r) => r.ev), lastSeq: last ? last.seq : afterSeq };
  }

  async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
    this.publishes += 1;
    for (const [owner, row] of this.ghosts) {
      if (owner !== userId && row.handle === handle) throw new GhostHandleTakenError();
    }
    this.ghosts.set(userId, { handle, payload, updatedAt: START });
  }

  async fetchGhost(handle: string): Promise<GhostRow | null> {
    for (const row of this.ghosts.values()) if (row.handle === handle) return row;
    return null;
  }

  eventsOf(userId: string): AppEvent[] {
    return this.listOf(userId).map((r) => r.ev);
  }
}

/* ---------------------------------------------------------------- people */

interface Person {
  readonly userId: string;
  readonly handle: string;
  readonly storage: StorageLike;
  readonly store: LocalStore;
  readonly engine: SyncEngine;
}

function makePerson(userId: string, handle: string, backend: MemoryBackend, sets: number): Person {
  const storage = fakeStorage();
  const store = new LocalStore(storage);
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '60', r: '12' });
  }
  const engine = new SyncEngine({
    store,
    backend,
    storage,
    now: () => Date.now(),
    win: null,
    doc: null,
    isOnline: () => true,
    isVisible: () => false,
    ghost: {
      snapshot: (h) => {
        const payload = buildGhost(gameOf(store), h);
        return { payload: payload as unknown as Record<string, unknown>, hash: ghostHash(payload) };
      },
      defaultHandle: () => handle,
    },
  });
  // `start()` is what subscribes the engine to local writes — without it a duel
  // recorded here would sit in the log and never be uploaded.
  engine.start();
  return { userId, handle, storage, store, engine };
}

function combatStats(game: GameState): CombatStats {
  const s = statsOfGame(game);
  return {
    atk: s.atk,
    def: s.def,
    maxHp: s.maxHp,
    attackIntervalMs: s.attackIntervalMs,
    critChance: s.critChance,
    critMultiplier: s.critMultiplier,
    regen: s.regen,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------ the story */

describe('two accounts, one duel', () => {
  it('publishes, looks up, fights and records — one fee, one purse', async () => {
    const backend = new MemoryBackend();
    // Rotem has trained a lot more than Yossi.
    const rotem = makePerson('user-rotem', 'rotem', backend, 24);
    const yossi = makePerson('user-yossi', 'yossi', backend, 6);

    /* 1. Both sign in. Their logs go up; so, once each, do their ghosts. */
    await rotem.engine.onSignedIn(rotem.userId);
    await yossi.engine.onSignedIn(yossi.userId);
    expect(backend.publishes).toBe(2);
    expect(backend.ghosts.get('user-rotem')?.handle).toBe('rotem');

    // The event logs stayed private and separate — a ghost is NOT an event.
    expect(backend.eventsOf('user-rotem').every((e) => e.type !== 'ghost_duel')).toBe(true);
    expect(backend.eventsOf('user-rotem').length).toBeGreaterThan(0);
    expect(backend.eventsOf('user-yossi').length).toBeGreaterThan(0);

    /* 2. Yossi looks Rotem up by handle and gets a real character back. */
    const row = await backend.fetchGhost('rotem');
    expect(row).not.toBeNull();
    const ghost = normalizeGhost(row?.payload);
    expect(ghost).not.toBeNull();
    if (!ghost) throw new Error('unreachable');
    expect(ghost.name).toBe('rotem');
    // What he sees is exactly what Rotem's own character screen shows.
    expect(ghostStats(ghost)).toEqual(statsOfGame(gameOf(rotem.store)));
    // …and nothing else about her.
    const wire = JSON.stringify(row?.payload);
    expect(wire).not.toContain('user-rotem');
    expect(wire).not.toContain('workoutDays');

    /* 3. Yossi fights it. */
    const status = ghostDuelStatus(yossi.store, DATE, 'rotem');
    expect(status.ok).toBe(true);
    const stats = combatStats(gameOf(yossi.store));
    const state = createChallengeBattle({
      run: ghostRun({ myHandle: 'yossi', opponentHandle: 'rotem', ghost, date: DATE }),
      stats,
      energy: gameOf(yossi.store).energy,
    });
    const sum = simulate(state, stats, { waves: 2, maxMs: 600_000 });
    const result = sum.challenge as ChallengeResult | null;
    if (!result) throw new Error('the duel never ended');
    // Rotem trained four times as much: the ghost wins, as it should.
    expect(result.won).toBe(false);

    const energyBefore = gameOf(yossi.store).energy;
    const save = onGhostDuel(yossi.store, result, ghostHash(ghost));
    expect(save.ok).toBe(true);

    /* 4. Exactly one record, one fee, one purse — and only on Yossi's side. */
    const yossiGame = gameOf(yossi.store);
    expect(yossiGame.duels.duels).toBe(1);
    expect(yossiGame.duels.losses).toBe(1);
    expect(yossiGame.duels.byOpponent['rotem']).toEqual({ wins: 0, losses: 1, duels: 1 });
    expect(yossiGame.energy).toBe(energyBefore - FEE);
    // He lost, and losing still pays — once, from HIS event.
    expect(yossiGame.battle.coins).toBe(LOSS_COINS);

    await yossi.engine.sync();
    await rotem.engine.sync();
    // Rotem's account knows nothing about it: no event of his reached her log,
    // she paid nothing and gained nothing. A duel is one player's record.
    expect(gameOf(rotem.store).duels.duels).toBe(0);
    expect(gameOf(rotem.store).battle.coins).toBe(0);
    expect(backend.eventsOf('user-rotem').some((e) => e.type === 'ghost_duel')).toBe(false);
    expect(backend.eventsOf('user-yossi').filter((e) => e.type === 'ghost_duel')).toHaveLength(1);

    /* 5. Yossi's second device pulls the duel and agrees, exactly. */
    const second = new LocalStore(fakeStorage());
    const secondEngine = new SyncEngine({
      store: second,
      backend,
      storage: fakeStorage(),
      now: () => Date.now(),
      win: null,
      doc: null,
      isOnline: () => true,
      isVisible: () => false,
    });
    secondEngine.start();
    await secondEngine.onSignedIn(yossi.userId);
    expect(gameOf(second).duels).toEqual(gameOf(yossi.store).duels);
    expect(gameOf(second).energy).toBe(gameOf(yossi.store).energy);

    /* 6. And the log still folds to exactly what is on screen. */
    const replayed = rebuildFromEvents(yossi.store.getEvents(), Date.now()).game as GameState;
    expect(replayed.duels).toEqual(yossiGame.duels);
  });

  it('converges when two devices of one account fought the same person offline', async () => {
    const backend = new MemoryBackend();
    const rotem = makePerson('user-rotem', 'rotem', backend, 24);
    const yossi = makePerson('user-yossi', 'yossi', backend, 20);
    await rotem.engine.onSignedIn(rotem.userId);
    await yossi.engine.onSignedIn(yossi.userId);

    const ghost = normalizeGhost((await backend.fetchGhost('rotem'))?.payload);
    if (!ghost) throw new Error('no ghost');

    // Two devices of Yossi's, both offline, both fight Rotem the same day. The
    // second store is a fresh install of the same account.
    const other = new LocalStore(fakeStorage());
    for (let i = 0; i < 20; i += 1) {
      onSetCompleted(other, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '60', r: '12' });
    }

    const fight = (store: LocalStore): ChallengeResult => {
      const stats = combatStats(gameOf(store));
      const state = createChallengeBattle({
        run: ghostRun({ myHandle: 'yossi', opponentHandle: 'rotem', ghost, date: DATE }),
        stats,
        energy: gameOf(store).energy,
      });
      const sum = simulate(state, stats, { waves: 2, maxMs: 600_000 });
      const res = sum.challenge as ChallengeResult | null;
      if (!res) throw new Error('the duel never ended');
      return res;
    };

    onGhostDuel(yossi.store, fight(yossi.store), ghostHash(ghost), new Date(START));
    onGhostDuel(other, fight(other), ghostHash(ghost), new Date(START + 60_000));

    const events = [
      ...yossi.store.getEvents().filter((e) => e.type === 'ghost_duel'),
      ...other.getEvents().filter((e) => e.type === 'ghost_duel'),
    ];
    expect(events).toHaveLength(2);

    // Both merge orders keep ONE duel and charge ONE fee.
    const forward = rebuildFromEvents([...yossi.store.getEvents(), ...events], Date.now()).game as GameState;
    const backward = rebuildFromEvents(
      [...events.reverse(), ...yossi.store.getEvents()],
      Date.now(),
    ).game as GameState;
    expect(forward.duels.duels).toBe(1);
    expect(JSON.stringify(backward.duels)).toBe(JSON.stringify(forward.duels));
    expect(backward.energy).toBe(forward.energy);
    expect(forward.duels.runs[duelKey(DATE, 'rotem')]).toBeDefined();
    // …and ONE purse: the union of two devices' duels pays exactly what the one
    // device that recorded it already paid, in either order.
    expect(forward.battle.coins).toBe(gameOf(yossi.store).battle.coins);
    expect(backward.battle.coins).toBe(forward.battle.coins);
  });

  it('gives both sides the same fight, whoever starts it', async () => {
    const backend = new MemoryBackend();
    const rotem = makePerson('user-rotem', 'rotem', backend, 20);
    const yossi = makePerson('user-yossi', 'yossi', backend, 20);
    await rotem.engine.onSignedIn(rotem.userId);
    await yossi.engine.onSignedIn(yossi.userId);

    const hers = normalizeGhost((await backend.fetchGhost('rotem'))?.payload);
    const his = normalizeGhost((await backend.fetchGhost('yossi'))?.payload);
    if (!hers || !his) throw new Error('no ghosts');

    const mine = ghostRun({ myHandle: 'yossi', opponentHandle: 'rotem', ghost: hers, date: DATE });
    const theirs = ghostRun({ myHandle: 'rotem', opponentHandle: 'yossi', ghost: his, date: DATE });
    expect(mine.seed).toBe(theirs.seed);
    expect(mine.seed).toBe(duelSeed('rotem', 'yossi', DATE));
    // Tomorrow is a different fight.
    expect(ghostRun({ ...mine, myHandle: 'yossi', opponentHandle: 'rotem', ghost: hers, date: '2025-05-05' }).seed)
      .not.toBe(mine.seed);
  });
});
