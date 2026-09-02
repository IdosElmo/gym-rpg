/**
 * OVERTIME WAVES (גלי הארכה) — the paid waves the arena runs while a world's
 * boss stands unfought: how they fold, how they merge, how they migrate.
 *
 * The engine side (spawning, pricing, the reserved boss fee) is pinned in
 * `tests/combat.test.ts`; this file is about the LOG: an overtime clear is a
 * `wave_cleared{overtime:true}` event that pays and charges like any wave and
 * never moves the world/wave marker, on the live path and on replay alike.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createBattle, overtimeSpec, simulate, waveSpec } from '../src/core/combat.ts';
import { gameOf, onSetCompleted, onWaveCleared } from '../src/core/game.ts';
import { applyGameEvent, deriveStats, emptyGame, rebuildGame } from '../src/core/xp.ts';
import { bossWaveOf, wavesInWorld } from '../src/data/gameContent.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { GAME_STATE_VERSION, type AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { buildFeed } from '../src/ui/feed.ts';

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

function statsAt(level: number) {
  const parts = emptyGame().parts;
  for (const p of BODY_PARTS) parts[p].level = level;
  const s = deriveStats(parts, 0);
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

/**
 * A store with plenty of ⚡ and the battle parked at world 1's boss wave — by
 * EVENTS (free, zero-⚡ clears of every ordinary wave), so the live state and a
 * replay of the log agree, exactly as they must in the app.
 */
function armedStore(sets = 40): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  for (let wave = 1; wave <= wavesInWorld(1); wave += 1) {
    store.append('wave_cleared', {
      date: '2025-05-04',
      world: 1,
      wave,
      miniBoss: false,
      enemyId: waveSpec(1, wave).enemy.id,
      coins: 0,
      energySpent: 0,
      seed: 1,
      durationMs: 1,
    });
  }
  store.update((d) => {
    d.game = rebuildFromEvents(store.getEvents(), Date.now()).game;
  });
  expect(gameOf(store).battle.wave).toBe(bossWaveOf(1));
  return store;
}

const overtimeEvent = (k: number, ts: number, id: string, world = 1): AppEvent => ({
  id,
  ts,
  type: 'wave_cleared',
  payload: {
    date: '2025-05-04',
    world,
    wave: wavesInWorld(world) + k,
    miniBoss: (wavesInWorld(world) + k) % BALANCE.combat.miniBossEvery === 0,
    enemyId: overtimeSpec(world, k).enemy.id,
    coins: overtimeSpec(world, k).coins,
    energySpent: BALANCE.combat.energyPerWave,
    seed: 1,
    durationMs: 100,
    overtime: true,
  },
});

describe('the fold', () => {
  it('bumps the shape version: v13 carries battle.overtime', () => {
    expect(GAME_STATE_VERSION).toBe(13);
    expect(emptyGame().battle.overtime).toEqual({});
  });

  it('pays, charges and counts an overtime clear — and leaves the marker where it was', () => {
    const game = emptyGame();
    game.energy = 100;
    game.battle.world = 2;
    game.battle.wave = bossWaveOf(2);
    const ev = overtimeEvent(1, 1, 'o1', 2);
    applyGameEvent(game, ev.type, ev.payload);
    expect(game.battle.world).toBe(2);
    expect(game.battle.wave).toBe(bossWaveOf(2));
    expect(game.battle.coins).toBe(overtimeSpec(2, 1).coins);
    expect(game.energy).toBe(100 - BALANCE.combat.energyPerWave);
    expect(game.battle.wavesCleared).toBe(1);
    expect(game.battle.overtime).toEqual({ '2': 1 });
    // an ordinary clear still moves the marker, exactly as before
    const plain = { ...overtimeEvent(1, 2, 'p1', 2).payload, wave: 5, overtime: false };
    applyGameEvent(game, 'wave_cleared', plain);
    expect(game.battle.wave).toBe(6);
    expect(game.battle.overtime).toEqual({ '2': 1 });
  });

  it('reads an older event without the flag as an ordinary wave', () => {
    const game = emptyGame();
    const { overtime: _flag, ...older } = overtimeEvent(1, 1, 'old').payload;
    applyGameEvent(game, 'wave_cleared', { ...older, wave: 3 });
    expect(game.battle.wave).toBe(4);
    expect(game.battle.overtime).toEqual({});
  });

  it('converges under either merge order, per world', () => {
    const a = [overtimeEvent(1, 10, 'a1'), overtimeEvent(2, 20, 'a2'), overtimeEvent(1, 30, 'b1', 3)];
    const b = [overtimeEvent(3, 15, 'c3'), overtimeEvent(2, 25, 'c2', 3)];
    const ab = rebuildGame([...a, ...b], '2025-05-10');
    const ba = rebuildGame([...b, ...a], '2025-05-10');
    expect({ ...ab, streak: null }).toEqual({ ...ba, streak: null });
    expect(ab.battle.overtime).toEqual({ '1': 3, '3': 2 });
    expect(ab.battle.wavesCleared).toBe(5);
    expect(ab.battle.coins).toBe(a.concat(b).reduce((s, e) => s + Number(e.payload['coins']), 0));
  });
});

describe('the live path', () => {
  it('persists an overtime clear from the arena and replays to the same state', () => {
    const store = armedStore();
    const g0 = gameOf(store);
    const energy0 = g0.energy;
    const coins0 = g0.battle.coins;
    const stats = statsAt(30);
    const state = createBattle({
      seed: 4,
      world: 1,
      wave: g0.battle.wave,
      energy: g0.energy,
      stats,
      gateOpen: false,
      overtime: g0.battle.overtime['1'] ?? 0,
    });
    const summary = simulate(state, stats, { waves: 3, maxMs: 300_000 });
    expect(summary.results).toHaveLength(3);
    for (const r of summary.results) {
      expect(r.overtime).toBe(true);
      onWaveCleared(store, r, new Date('2025-05-04T12:00:00Z'));
    }
    const g = gameOf(store);
    expect(g.battle.wave).toBe(bossWaveOf(1));
    expect(g.battle.world).toBe(1);
    expect(g.battle.overtime).toEqual({ '1': 3 });
    expect(g.battle.wavesCleared).toBe(wavesInWorld(1) + 3);
    expect(g.energy).toBe(energy0 - 3 * BALANCE.combat.energyPerWave);
    expect(g.battle.coins).toBe(coins0 + summary.results.reduce((s, r) => s + r.coins, 0));
    const events = store.getEvents().filter((e) => e.type === 'wave_cleared' && e.payload['overtime'] === true);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload['wave'])).toEqual([wavesInWorld(1) + 1, wavesInWorld(1) + 2, wavesInWorld(1) + 3]);

    const replayed = rebuildFromEvents(store.getEvents(), Date.now()).game;
    expect(replayed?.battle).toEqual(g.battle);
    expect(replayed?.version).toBe(GAME_STATE_VERSION);
  });

  it('resumes the overtime count from the store, so the next wave is the next number', () => {
    const store = armedStore();
    for (const ev of [overtimeEvent(1, 1, 'x1'), overtimeEvent(2, 2, 'x2')]) store.append(ev.type, ev.payload);
    const g = rebuildFromEvents(store.getEvents(), Date.now()).game;
    expect(g?.battle.overtime['1']).toBe(2);
    const stats = statsAt(30);
    const state = createBattle({
      seed: 4,
      world: 1,
      wave: bossWaveOf(1),
      energy: 1000,
      stats,
      overtime: g?.battle.overtime['1'] ?? 0,
    });
    // a level-30 character flattens a world-1 enemy inside the first ticks, so
    // read the SPAWN rather than the enemy that may already be gone
    const spawn = advance(state, 2000, stats).find((e) => e.kind === 'spawn');
    expect(spawn?.kind).toBe('spawn');
    if (spawn?.kind !== 'spawn') return;
    expect(spawn.spec.overtime).toBe(true);
    expect(spawn.spec.wave).toBe(wavesInWorld(1) + 3);
    expect(spawn.spec.hp).toBe(overtimeSpec(1, 3).hp);
    expect(spawn.spec.enemy.id).toBe(waveSpec(1, wavesInWorld(1) + 3).enemy.id);
  });
});

describe('migration', () => {
  it('normalises battle.overtime and drops garbage', () => {
    const raw = JSON.parse(JSON.stringify(emptyGame())) as { battle: { overtime: unknown } };
    raw.battle.overtime = { '1': 4, '2': '3', x: 5, '0': 2, '4': -1, '5': 0 };
    expect(normalizeGame(raw)?.battle.overtime).toEqual({ '1': 4 });
    // an older blob (no version bump) is rejected — and rebuilt from the log
    const old = JSON.parse(JSON.stringify(emptyGame())) as { version: number; battle: Record<string, unknown> };
    old.version = GAME_STATE_VERSION - 1;
    delete old.battle['overtime'];
    expect(normalizeGame(old)).toBeNull();
  });
});

describe('the feed', () => {
  it('names an overtime mini-boss as one', () => {
    const k = BALANCE.combat.miniBossEvery - (wavesInWorld(1) % BALANCE.combat.miniBossEvery);
    const items = buildFeed([overtimeEvent(k, 1, 'm')]);
    expect(items[0]?.text).toContain('גל הארכה');
    expect(items[0]?.text).toContain('מיני־בוס');
  });
});
