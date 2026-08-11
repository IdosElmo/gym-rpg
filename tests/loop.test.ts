/**
 * THE core loop, end to end, through the real modules and the real store:
 *
 *   log sets -> XP + ⚡ -> battle waves -> the boss gate BLOCKS -> more training
 *   meets the gate -> the boss dies -> world 2 unlocks -> buy + equip gear ->
 *   the stats change -> export -> wipe -> import -> byte-identical state.
 *
 * `rebuildFromEvents(log)` is asserted to equal the live state at EVERY step, so
 * the whole run doubles as a proof that the append-only log stays the source of
 * truth through the Phase 3 features.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  createBattle,
  setEnergy,
  setGate,
  superReady,
  tap,
  useSuper,
  worldGate,
  type BattleState,
  type CombatStats,
} from '../src/core/combat.ts';
import {
  buyItem,
  equipItem,
  gameOf,
  onBossDefeated,
  onSetCompleted,
  onWaveCleared,
  onWorkoutFinished,
} from '../src/core/game.ts';
import { computeStreak, statsOfGame, tsToIso } from '../src/core/xp.ts';
import { worldBossOf } from '../src/data/gameContent.ts';
import { BODY_PARTS, PROGRAM, type BodyPart, type BuiltInDayKey } from '../src/data/program.ts';
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

const BOSS_WAVE = BALANCE.combat.wavesPerWorld + 1;
const DAYS: readonly BuiltInDayKey[] = ['A', 'B', 'C'];

function levelsOf(store: LocalStore): Record<BodyPart, number> {
  const game = gameOf(store);
  const out = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) out[p] = game.parts[p].level;
  return out;
}

function combatStats(store: LocalStore): CombatStats {
  const s = statsOfGame(gameOf(store));
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
 * Log one FULL workout day, set by set and then the completion bonus — exactly
 * the two calls `ui/workout.ts` makes when the last checkbox is ticked.
 */
function logWorkout(store: LocalStore, date: string, day: BuiltInDayKey): void {
  const now = new Date(`${date}T10:00:00Z`);
  for (const exercise of PROGRAM[day].exercises) {
    for (let i = 0; i < exercise.sets; i += 1) {
      onSetCompleted(store, { date, day, ex: exercise, setIndex: i, w: '40', r: '10' }, now);
    }
  }
  store.append('workout_finished', { date, day });
  onWorkoutFinished(store, { date, day }, now);
}

/**
 * The live state must always equal a replay of the log. Asserted everywhere.
 *
 * `streak` is deliberately compared on its own: it is the one field that is a
 * function of TODAY as well as of the log (a week closes by the calendar, not by
 * an action), so the replay is checked against the same `today` it was given.
 */
function expectReplayEquivalence(store: LocalStore, today: number): void {
  const live = gameOf(store);
  const replayed = rebuildFromEvents(store.getEvents(), today).game;
  expect(replayed).not.toBeNull();
  expect({ ...replayed, streak: null }).toEqual({ ...live, streak: null });
  expect(replayed?.streak).toEqual(computeStreak(live.workoutDays, tsToIso(today)));
}

/** Drive the arena the way an engaged player does, persisting every clear. */
function playUntil(
  store: LocalStore,
  state: BattleState,
  stop: (s: BattleState) => boolean,
  maxMs = 900_000,
): void {
  const tick = BALANCE.combat.tickMs;
  let sinceTap = 0;
  for (let ms = 0; ms < maxMs && !stop(state); ms += tick) {
    const stats = combatStats(store);
    const events = [...advance(state, tick, stats)];
    if (state.status === 'fighting') {
      if (superReady(state)) events.push(...useSuper(state, stats).events);
      sinceTap += tick;
      if (sinceTap >= BALANCE.combat.tap.minIntervalMs * 1.5) {
        sinceTap = 0;
        events.push(...tap(state, stats).events);
      }
    }
    for (const ev of events) {
      if (ev.kind === 'wave_cleared') {
        onWaveCleared(store, ev.result, new Date('2025-06-01T10:00:00Z'));
        setEnergy(state, gameOf(store).energy);
      } else if (ev.kind === 'boss_defeated') {
        onBossDefeated(store, ev.result, new Date('2025-06-01T10:00:00Z'));
        const g = gameOf(store);
        setEnergy(state, g.energy);
        setGate(state, !worldGate(g.battle.world, levelsOf(store)).locked, g.battle.bossesDefeated);
      }
    }
    if (state.status === 'gated' || state.status === 'resting') break;
  }
}

describe('the core loop, end to end', () => {
  it('trains, fights, is gated, trains again, kills the boss, shops and round-trips', () => {
    const today = Date.parse('2025-06-30T00:00:00Z');
    const store = new LocalStore(fakeStorage());

    /* -- 1. real training pays XP and battle energy ------------------------ */

    logWorkout(store, '2025-06-02', 'A');
    const afterOne = gameOf(store);
    expect(afterOne.totalXp).toBeGreaterThan(0);
    expect(afterOne.energy).toBeGreaterThan(0);
    expect(afterOne.parts.chest.xp).toBeGreaterThan(0);
    expect(afterOne.workoutDays).toEqual(['2025-06-02']);
    expectReplayEquivalence(store, today);

    /* -- 2. the world-1 boss gate is CLOSED after one workout -------------- */

    const boss1 = worldBossOf(1);
    expect(worldGate(1, levelsOf(store)).locked).toBe(true);

    const blocked = createBattle({
      seed: 2024,
      world: 1,
      wave: BOSS_WAVE,
      energy: gameOf(store).energy,
      stats: combatStats(store),
      gateOpen: false,
    });
    advance(blocked, 2000, combatStats(store));
    expect(blocked.status).toBe('gated');
    expect(blocked.enemy).toBeNull();
    // and the UI is told exactly which parts are missing, in Hebrew-ready shape
    const missing = worldGate(1, levelsOf(store)).requirements.filter((r) => !r.met);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((r) => r.have < r.need)).toBe(true);

    /* -- 3. keep training until the requirements are met ------------------- */

    let workouts = 1;
    while (worldGate(1, levelsOf(store)).locked && workouts < 40) {
      const date = `2025-06-${String(2 + workouts).padStart(2, '0')}`;
      logWorkout(store, date, DAYS[workouts % DAYS.length] as BuiltInDayKey);
      workouts += 1;
    }
    expect(worldGate(1, levelsOf(store)).locked).toBe(false);
    // "a consistent trainee" — the gate must not take a whole season to open
    expect(workouts).toBeLessThanOrEqual(8);
    expectReplayEquivalence(store, today);

    /* -- 4. clear the world's waves, then the boss ------------------------- */

    const state = createBattle({
      seed: 2024,
      world: gameOf(store).battle.world,
      wave: gameOf(store).battle.wave,
      energy: gameOf(store).energy,
      stats: combatStats(store),
      gateOpen: !worldGate(1, levelsOf(store)).locked,
      defeatedBosses: gameOf(store).battle.bossesDefeated,
    });

    // energy is the only fuel: top it up with real workouts whenever it runs out
    for (let round = 0; round < 12 && gameOf(store).battle.bossesDefeated.length === 0; round += 1) {
      playUntil(store, state, (s) => s.world > 1);
      if (gameOf(store).battle.bossesDefeated.length > 0) break;
      const date = `2025-06-${String(11 + round).padStart(2, '0')}`;
      logWorkout(store, date, DAYS[round % DAYS.length] as BuiltInDayKey);
      setEnergy(state, gameOf(store).energy);
      setGate(
        state,
        !worldGate(state.world, levelsOf(store)).locked,
        gameOf(store).battle.bossesDefeated,
      );
    }

    const afterBoss = gameOf(store);
    expect(afterBoss.battle.wavesCleared).toBeGreaterThanOrEqual(BALANCE.combat.wavesPerWorld);
    expect(afterBoss.battle.miniBossesCleared).toBeGreaterThan(0);
    expect(afterBoss.battle.bossesDefeated).toEqual([boss1?.id]);
    expect(afterBoss.battle.world).toBe(2); // world 2 unlocked
    expect(afterBoss.battle.wave).toBe(1);
    expect(afterBoss.battle.coins).toBeGreaterThan(0);
    expectReplayEquivalence(store, today);

    /* -- 5. spend the coins: buy + equip, and watch the stats move --------- */

    const beforeGear = statsOfGame(gameOf(store));
    const purse = gameOf(store).battle.coins;
    expect(buyItem(store, 'gloves_1')).toEqual({ ok: true });
    expect(buyItem(store, 'belt_1')).toEqual({ ok: true });

    const geared = gameOf(store);
    expect(geared.battle.coins).toBeLessThan(purse);
    expect([...geared.equipment.owned].sort()).toEqual(['belt_1', 'gloves_1']);
    expect(geared.equipment.equipped).toEqual({ gloves: 'gloves_1', belt: 'belt_1' });

    const afterGear = statsOfGame(geared);
    expect(afterGear.atk).toBeGreaterThan(beforeGear.atk);
    expect(afterGear.def).toBeGreaterThan(beforeGear.def);

    // a wildly overpriced item is simply refused — no coins, no event
    const eventsBefore = store.getEvents().length;
    expect(buyItem(store, 'cape_3').error).toBe('insufficient_coins');
    expect(store.getEvents()).toHaveLength(eventsBefore);

    equipItem(store, 'gloves', null);
    expect(statsOfGame(gameOf(store)).atk).toBeLessThan(afterGear.atk);
    equipItem(store, 'gloves', 'gloves_1');
    expectReplayEquivalence(store, today);

    /* -- 6. export -> wipe -> import lands on the identical state ---------- */

    const live = gameOf(store);
    const liveSessions = store.getState().sessions;
    const blob = JSON.stringify(buildExport(store.getState(), store.getEvents(), today));

    store.clear();
    expect(gameOf(store).battle.bossesDefeated).toEqual([]);
    expect(gameOf(store).equipment.owned).toEqual([]);
    expect(gameOf(store).totalXp).toBe(0);

    const parsed = parseImport(blob, today);
    expect(parsed).not.toBeNull();
    store.replaceAll(parsed!.state, parsed!.events);

    const restored = gameOf(store);
    expect(restored.battle).toEqual(live.battle);
    expect(restored.equipment).toEqual(live.equipment);
    expect(restored.parts).toEqual(live.parts);
    expect(restored.energy).toBe(live.energy);
    expect(statsOfGame(restored)).toEqual(statsOfGame(live));
    expect(store.getState().sessions).toEqual(liveSessions);
    expectReplayEquivalence(store, today);
  }, 60_000);
});
