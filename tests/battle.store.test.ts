/**
 * Battle persistence: event granularity and replay equivalence. The rule under
 * test is the one the whole architecture rests on — "live state ===
 * rebuildFromEvents(log)" — now including battle progress.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createBattle, type CombatStats, type WaveResult } from '../src/core/combat.ts';
import { gameOf, onSetCompleted, onWaveCleared } from '../src/core/game.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import {
  buildExport,
  parseImport,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

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

function statsAt(level: number): CombatStats {
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

/** Play a real battle through the store, exactly like the UI does. */
function playBattle(store: LocalStore, ms: number, level = 6): WaveResult[] {
  const stats = statsAt(level);
  const g = gameOf(store);
  const state = createBattle({
    seed: 9001,
    world: g.battle.world,
    wave: g.battle.wave,
    energy: g.energy,
    stats,
  });
  const results: WaveResult[] = [];
  for (let t = 0; t < ms; t += BALANCE.combat.tickMs) {
    for (const ev of advance(state, BALANCE.combat.tickMs, stats)) {
      if (ev.kind !== 'wave_cleared') continue;
      results.push(ev.result);
      onWaveCleared(store, ev.result);
      state.energy = gameOf(store).energy;
    }
  }
  return results;
}

/** A store with enough energy to fight: a few logged sets. */
function trainedStore(sets = 30): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, {
      date: '2025-05-04',
      day: 'A',
      ex: ex('a1'),
      setIndex: i,
      w: '40',
      r: '10',
    });
  }
  return store;
}

describe('wave_cleared events', () => {
  it('writes exactly ONE event per cleared wave (never per attack)', () => {
    const store = trainedStore();
    const results = playBattle(store, 120_000);
    expect(results.length).toBeGreaterThan(2);
    const waveEvents = store.getEvents().filter((e) => e.type === 'wave_cleared');
    expect(waveEvents).toHaveLength(results.length);
    // the payload carries everything a replay needs
    const p = waveEvents[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(
      ['coins', 'date', 'durationMs', 'enemyId', 'energySpent', 'miniBoss', 'seed', 'wave', 'world'].sort(),
    );
  });

  it('charges energy, pays coins and moves the wave marker', () => {
    const store = trainedStore();
    const before = gameOf(store);
    const startEnergy = before.energy;
    expect(before.battle).toEqual({ world: 1, wave: 1, coins: 0, wavesCleared: 0, miniBossesCleared: 0 });

    const results = playBattle(store, 120_000);
    const game = gameOf(store);
    const coins = results.reduce((a, r) => a + r.coins, 0);

    expect(game.battle.wavesCleared).toBe(results.length);
    expect(game.battle.wave).toBe(results.length + 1);
    expect(game.battle.coins).toBe(coins);
    expect(game.energy).toBe(startEnergy - results.length * BALANCE.combat.energyPerWave);
  });

  it('counts mini-bosses separately', () => {
    const store = trainedStore(200);
    playBattle(store, 600_000, 8);
    const game = gameOf(store);
    expect(game.battle.wavesCleared).toBeGreaterThan(BALANCE.combat.miniBossEvery);
    expect(game.battle.miniBossesCleared).toBe(
      Math.floor(game.battle.wavesCleared / BALANCE.combat.miniBossEvery),
    );
  });
});

describe('replay', () => {
  it('rebuildFromEvents reproduces the battle progress exactly', () => {
    const store = trainedStore();
    playBattle(store, 180_000);
    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents());
    expect(replayed.game?.battle).toEqual(live.battle);
    expect(replayed.game?.energy).toBe(live.energy);
    expect(replayed.game).toEqual(live);
  });

  it('survives a JSON export/import round-trip', () => {
    const store = trainedStore();
    playBattle(store, 180_000);
    const live = gameOf(store);

    const blob = buildExport(store.getState(), store.getEvents(), 1000);
    const parsed = parseImport(JSON.stringify(blob));
    expect(parsed?.state.game?.battle).toEqual(live.battle);
    expect(parsed?.state.game?.energy).toBe(live.energy);

    const restored = new LocalStore(fakeStorage());
    restored.replaceAll(parsed!.state, parsed!.events);
    expect(gameOf(restored).battle).toEqual(live.battle);
  });

  it('a wipe resets the battle too', () => {
    const store = trainedStore();
    playBattle(store, 120_000);
    expect(gameOf(store).battle.wavesCleared).toBeGreaterThan(0);
    store.clear();
    expect(gameOf(store).battle).toEqual(emptyGame().battle);
    expect(rebuildFromEvents(store.getEvents()).game?.battle).toEqual(emptyGame().battle);
  });
});
