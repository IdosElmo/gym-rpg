/**
 * The game-event feed of the history screen (`ui/feed.ts`) — a pure projection
 * of the append-only log into compact Hebrew lines.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createBattle, type CombatStats, type WaveResult } from '../src/core/combat.ts';
import { gameOf, onSetCompleted, onWaveCleared } from '../src/core/game.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
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

describe('history feed', () => {
  it('collapses a run of waves into one line and keeps mini-bosses separate', () => {
    const store = trainedStore(200);
    playBattle(store, 600_000, 8);
    const feed = buildFeed(store.getEvents(), 50);

    const waves = feed.filter((i) => i.cls === 'wave');
    const bosses = feed.filter((i) => i.cls === 'boss');
    const cleared = gameOf(store).battle.wavesCleared;
    expect(bosses.length).toBe(gameOf(store).battle.miniBossesCleared);
    expect(bosses.length).toBeGreaterThan(0);
    // far fewer lines than waves — that is the whole point
    expect(waves.length).toBeLessThan(cleared);
    expect(waves[0]?.text).toContain('חדר כושר נטוש');
    expect(bosses[0]?.text).toContain('מיני־בוס');
  });

  it('shows level-ups and personal records, newest first', () => {
    const store = new LocalStore(fakeStorage());
    for (let i = 0; i < 20; i += 1) {
      onSetCompleted(store, {
        date: '2025-05-04',
        day: 'A',
        ex: ex('a1'),
        setIndex: i,
        w: String(40 + i), // a heavier set every time → personal records
        r: '10',
      });
    }
    const feed = buildFeed(store.getEvents());
    expect(feed.some((i) => i.cls === 'level')).toBe(true);
    expect(feed.some((i) => i.cls === 'pr')).toBe(true);
    for (let i = 1; i < feed.length; i += 1) {
      expect(feed[i - 1]!.ts).toBeGreaterThanOrEqual(feed[i]!.ts);
    }
  });

  it('escapes nothing dangerous into the markup', () => {
    const store = new LocalStore(fakeStorage());
    store.append('boss_defeated', { bossId: '<img src=x onerror=alert(1)>', date: '2025-05-04' });
    const feed = buildFeed(store.getEvents());
    expect(feed[0]?.text).not.toContain('<img');
    expect(feed[0]?.text).toContain('&lt;img');
  });
});
