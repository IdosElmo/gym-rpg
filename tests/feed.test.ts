/**
 * The game-event feed of the history screen (`ui/feed.ts`) — a pure projection
 * of the append-only log into compact Hebrew lines.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createBattle, type CombatStats, type WaveResult } from '../src/core/combat.ts';
import { buyItem, equipItem, gameOf, onSetCompleted, onWaveCleared } from '../src/core/game.ts';
import { deriveStats, emptyGame } from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { WORLD_BOSSES } from '../src/data/gameContent.ts';
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

  it('tells the story of a world boss, including the world it unlocked', () => {
    const store = trainedStore();
    store.append('boss_defeated', {
      date: '2025-05-04',
      world: 1,
      wave: 51,
      bossId: 'boss_w1',
      coins: 400,
      energySpent: 30,
      seed: 1,
      durationMs: 30_000,
      nextWorld: 2,
      nextWave: 1,
      endgame: false,
    });
    const line = buildFeed(store.getEvents()).find((i) => i.cls === 'boss');
    expect(line?.icon).toBe('🏛');
    expect(line?.text).toContain(WORLD_BOSSES[0]?.he ?? '');
    expect(line?.text).toContain('חדר כושר נטוש');
    expect(line?.text).toContain('עולם 2');
    expect(line?.text).toContain('400');
  });

  it('crowns the endgame when the final boss falls', () => {
    const store = trainedStore();
    store.append('boss_defeated', {
      date: '2025-05-04',
      world: 4,
      wave: 51,
      bossId: 'boss_w4',
      coins: 1965,
      energySpent: 30,
      seed: 1,
      durationMs: 60_000,
      nextWorld: 4,
      nextWave: 51,
      endgame: true,
    });
    const line = buildFeed(store.getEvents()).find((i) => i.cls === 'boss');
    expect(line?.icon).toBe('👑');
    expect(line?.text).toContain('מצב אלוף');
  });

  it('records shop purchases and equipment changes', () => {
    const store = trainedStore();
    onWaveCleared(store, {
      world: 1,
      wave: 1,
      miniBoss: false,
      enemyId: 'w1_rat',
      coins: 2000,
      energySpent: 0,
      seed: 1,
      durationMs: 100,
      overtime: false,
    });
    buyItem(store, 'gloves_1');
    equipItem(store, 'gloves', null);

    const shop = buildFeed(store.getEvents()).filter((i) => i.cls === 'shop');
    expect(shop.some((i) => i.text.includes('נרכש'))).toBe(true);
    expect(shop.some((i) => i.text.includes('כפפות'))).toBe(true);
    expect(shop.some((i) => i.text.includes('הוסרה'))).toBe(true);
  });

  it('explains an additive JSON import — and stays quiet about cloud merges', () => {
    const store = new LocalStore(fakeStorage());
    store.append('data_merged', { source: 'json_import', added: 42 });
    const line = buildFeed(store.getEvents()).find((i) => i.cls === 'import');
    expect(line?.icon).toBe('⬆');
    expect(line?.text).toBe('יובאו נתונים מקובץ (42 אירועים)');

    // The engine never writes one of these for a pull (it would ping-pong
    // between devices); if a marker with another source ever shows up it is
    // folded as the no-op it is, without inventing a file that never existed.
    const quiet = new LocalStore(fakeStorage());
    quiet.append('data_merged', { source: 'sync', added: 7 });
    expect(buildFeed(quiet.getEvents())).toHaveLength(0);
  });

  it('names a finished workout only when the caller can name the day', () => {
    const store = new LocalStore(fakeStorage());
    store.append('workout_finished', { date: '2025-05-04', day: 'd_alef' });
    // the log alone does not know which plan is active -> no name, no raw key
    const bare = buildFeed(store.getEvents())[0];
    expect(bare?.text).toBe('אימון הושלם במלואו');
    expect(bare?.text).not.toContain('d_alef');
    // a screen that knows the plan passes the label in
    const named = buildFeed(store.getEvents(), 40, findExercise, (k) => (k === 'd_alef' ? 'חלק א׳' : ''))[0];
    expect(named?.text).toBe('אימון הושלם במלואו · חלק א׳');
    // …and the label is escaped like every other piece of user text
    const evil = buildFeed(store.getEvents(), 40, findExercise, () => '<b>x</b>')[0];
    expect(evil?.text).not.toContain('<b>');
  });

  it('escapes nothing dangerous into the markup', () => {
    const store = new LocalStore(fakeStorage());
    store.append('boss_defeated', { bossId: '<img src=x onerror=alert(1)>', date: '2025-05-04' });
    const feed = buildFeed(store.getEvents());
    expect(feed[0]?.text).not.toContain('<img');
    expect(feed[0]?.text).toContain('&lt;img');
  });
});
