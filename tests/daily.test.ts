/**
 * daily.test.ts — THE DAILY CHALLENGE, from the seed to the ledger.
 *
 * Five properties matter here, and each has its own block below:
 *
 *   1. THE SAME GAUNTLET EVERYWHERE. The seed is a hash of the date STRING, so
 *      two "devices" that ask for the same day get byte-identical waves, and
 *      different days differ.
 *   2. ONE ATTEMPT PER DATE. The reducer is idempotent on the DATE, not on the
 *      event id: two devices that both played the same day's challenge offline
 *      converge — in BOTH merge orders — on one counted run, one fee and one
 *      payout.
 *   3. THE FEE IS REAL AND IS CHARGED ONCE, and an attempt that cannot be paid
 *      for is refused BEFORE anything is written.
 *   4. A CHALLENGE IS NOT THE CAMPAIGN. No `wave_cleared` is emitted while one
 *      is running, world/wave progress does not move, and abandoning a run
 *      leaks nothing.
 *   5. THE BALANCE. Measured against the real engine with the same skill pilot
 *      the Phase-4 tests use: a level 5–6 character clears several waves, a
 *      level 9+ one finishes.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  advance,
  createChallengeBattle,
  forfeitChallenge,
  simulate,
  type ChallengeResult,
  type CombatStats,
} from '../src/core/combat.ts';
import {
  bestDailyStreak,
  dailyChallenge,
  dailyRun,
  dailySeed,
  dailyStreak,
  dailyWorldOf,
} from '../src/core/daily.ts';
import { dailyStatus, gameOf, onDailyChallenge, onSetCompleted } from '../src/core/game.ts';
import {
  applyGameEvent,
  compareEvents,
  dailyEntryStatus,
  deriveStats,
  emptyDaily,
  emptyGame,
  rebuildGame,
} from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { ENEMIES, WORLD_COUNT } from '../src/data/gameContent.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { GAME_STATE_VERSION, type AppEvent, type GameState } from '../src/storage/DataStore.ts';
import { makeEvent, normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { buildFeed } from '../src/ui/feed.ts';

/* --------------------------------------------------------------- fixtures */

const DATE = '2025-05-04';
const NOW = Date.parse('2025-05-04T18:00:00.000Z');
const WAVES = BALANCE.daily.waves;
const FEE = BALANCE.daily.entryEnergy;

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

function levelsAt(level: number): Record<BodyPart, number> {
  const out = {} as Record<BodyPart, number>;
  for (const p of BODY_PARTS) out[p] = level;
  return out;
}

/** A store with `sets` logged sets — i.e. `sets × 10` ⚡ in the bank. */
function trainedStore(sets = 6): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  return store;
}

/** Play a whole daily run at `level`, exactly the way the arena drives it. */
function playDaily(level: number, date = DATE): { result: ChallengeResult; cleared: number } {
  const stats = statsAt(level);
  const state = createChallengeBattle({ run: dailyRun(date), stats });
  const sum = simulate(state, stats, {
    waves: WAVES + 1,
    maxMs: 900_000,
    pilot: { levels: levelsAt(level) },
  });
  const result = sum.challenge;
  if (!result) throw new Error('the run never ended');
  return { result, cleared: sum.challengeWaves };
}

/** The one event a finished run writes, as another device would have sent it. */
function dailyEvent(result: ChallengeResult, ts: number, id: string): AppEvent {
  return {
    id,
    ts,
    type: 'daily_challenge',
    payload: {
      date: result.date,
      seed: result.seed,
      wavesCleared: result.wavesCleared,
      score: result.score,
      tiebreak: result.tiebreak,
      coins: result.coins,
      energySpent: result.energySpent,
      complete: result.complete,
      outcome: result.outcome,
      durationMs: result.durationMs,
    },
  };
}

/* ------------------------------------------------------------ determinism */

describe('one gauntlet per calendar date', () => {
  it('gives two devices the same waves for the same date', () => {
    const deviceA = dailyChallenge(DATE);
    const deviceB = dailyChallenge(DATE);
    expect(JSON.stringify(deviceB)).toBe(JSON.stringify(deviceA));
    expect(deviceB.seed).toBe(dailySeed(DATE));
  });

  it('gives different dates different gauntlets', () => {
    const dates = ['2025-05-04', '2025-05-05', '2025-06-01', '2025-12-31', '2026-01-01'];
    const seeds = new Set(dates.map((d) => dailySeed(d)));
    expect(seeds.size).toBe(dates.length);
    // Not merely different seeds: a different ROSTER, most days.
    const rosters = new Set(dates.map((d) => dailyChallenge(d).waves.map((w) => w.enemyId).join(',')));
    expect(rosters.size).toBeGreaterThan(1);
  });

  it('depends on the date STRING and nothing else', () => {
    // No clock, no progress, no device: the same call a year apart is the same
    // gauntlet, which is what makes two accounts comparable.
    expect(dailySeed('2025-05-04')).toBe(dailySeed('2025-05-04'));
    expect(dailySeed('2025-05-04')).not.toBe(dailySeed('2025-05-14'));
  });

  it('tours all four worlds and ends on a mini-boss', () => {
    const g = dailyChallenge(DATE);
    expect(g.waves).toHaveLength(WAVES);
    expect(g.waves.map((w) => w.index)).toEqual([...Array(WAVES).keys()].map((i) => i + 1));
    expect(new Set(g.waves.map((w) => w.world))).toEqual(new Set([1, 2, 3, 4]));
    // Escalating, never going back a world.
    const worlds = g.waves.map((w) => w.world);
    expect([...worlds].sort((a, b) => a - b)).toEqual(worlds);
    expect(dailyWorldOf(1)).toBe(1);
    expect(dailyWorldOf(WAVES)).toBe(WORLD_COUNT);
    // The finale, and only the finale, is a mini-boss.
    expect(g.waves.filter((w) => w.miniBoss).map((w) => w.index)).toEqual([WAVES]);
  });

  it('is a real roster with real numbers, growing wave by wave', () => {
    const g = dailyChallenge(DATE);
    const known = new Set(ENEMIES.map((e) => e.id));
    for (const w of g.waves) {
      expect(known.has(w.enemyId), `${w.enemyId} is not in the roster`).toBe(true);
      expect(w.he.length).toBeGreaterThan(1);
      expect(w.svg).toContain('<svg');
      expect(w.hp).toBeGreaterThan(0);
      expect(w.atk).toBeGreaterThan(0);
    }
    expect(g.waves[WAVES - 1]?.hp ?? 0).toBeGreaterThan((g.waves[0]?.hp ?? 0) * 5);
    // Coins rise with the wave, and the advertised maximum is the real total.
    expect(g.maxCoins).toBe(g.waves.reduce((a, w) => a + w.coins, 0) + g.completionBonus);
  });

  it('does not depend on the player at all', () => {
    // The campaign's own world/wave curve is untouched by this feature, and the
    // gauntlet is the same for a beginner and for a champion: it is a test of
    // stats, not a continuation of progress.
    const beginner = dailyChallenge(DATE);
    const champion = dailyChallenge(DATE);
    expect(champion.waves).toEqual(beginner.waves);
  });
});

/* ----------------------------------------------------- the run, in combat */

describe('a challenge run', () => {
  it('never emits wave_cleared and never moves the campaign', () => {
    const store = trainedStore(20);
    const before = gameOf(store).battle;
    const stats = statsAt(8);
    const state = createChallengeBattle({ run: dailyRun(DATE), stats });
    const sum = simulate(state, stats, { waves: WAVES + 1, maxMs: 900_000 });

    expect(sum.events.some((e) => e.kind === 'wave_cleared')).toBe(false);
    expect(sum.events.filter((e) => e.kind === 'challenge_wave').length).toBeGreaterThan(0);
    expect(sum.events.filter((e) => e.kind === 'challenge_over')).toHaveLength(1);
    // The store was never touched by the fight itself.
    expect(store.getEvents().some((e) => e.type === 'wave_cleared')).toBe(false);
    expect(gameOf(store).battle).toEqual(before);
  });

  it('ends at 0 HP with no retry, and scores what was cleared', () => {
    const { result, cleared } = playDaily(3);
    expect(result.outcome).toBe('defeated');
    expect(result.complete).toBe(false);
    expect(result.wavesCleared).toBe(cleared);
    expect(result.score).toBe(cleared);
    expect(result.tiebreak).toBe(0); // knocked out — no health left to tie-break on
    expect(result.wavesCleared).toBeLessThan(WAVES);
  });

  it('pays the completion bonus only for a full clear, and tiebreaks on health', () => {
    const { result } = playDaily(12);
    const g = dailyChallenge(DATE);
    expect(result.complete).toBe(true);
    expect(result.wavesCleared).toBe(WAVES);
    expect(result.coins).toBe(g.maxCoins);
    expect(result.tiebreak).toBeGreaterThan(0);
    expect(result.tiebreak).toBeLessThanOrEqual(100);
    // A stronger character finishes with more health left — that is the whole
    // point of the tiebreak.
    const stronger = playDaily(15).result;
    expect(stronger.tiebreak).toBeGreaterThanOrEqual(result.tiebreak);
  });

  it('charges the fee once, whatever the score', () => {
    for (const level of [3, 6, 12]) {
      expect(playDaily(level).result.energySpent).toBe(FEE);
    }
  });

  it('forfeits mid-run without paying for waves that were not cleared', () => {
    const stats = statsAt(8);
    const state = createChallengeBattle({ run: dailyRun(DATE), stats });
    // Fight for a while, then walk away.
    for (let t = 0; t < 40_000; t += BALANCE.combat.tickMs) advance(state, BALANCE.combat.tickMs, stats);
    const cleared = state.challenge?.cleared ?? 0;
    expect(cleared).toBeGreaterThan(0);
    expect(cleared).toBeLessThan(WAVES);

    const result = forfeitChallenge(state);
    expect(result?.outcome).toBe('forfeit');
    expect(result?.wavesCleared).toBe(cleared);
    expect(result?.complete).toBe(false);
    const g = dailyChallenge(DATE);
    const earned = g.waves.slice(0, cleared).reduce((a, w) => a + w.coins, 0);
    expect(result?.coins).toBe(earned); // exactly the cleared waves, no bonus
    // The run is over for good: a second forfeit cannot mint a second record.
    expect(forfeitChallenge(state)).toBeNull();
    expect(state.status).toBe('finished');
  });

  it('is inert once it is over — no further waves, no further events', () => {
    const stats = statsAt(3);
    const state = createChallengeBattle({ run: dailyRun(DATE), stats });
    simulate(state, stats, { waves: WAVES + 1, maxMs: 900_000 });
    expect(state.status).toBe('finished');
    const after = advance(state, 10_000, stats);
    expect(after).toEqual([]);
  });
});

/* ------------------------------------------------------------- the ledger */

describe('one attempt per date', () => {
  it('records the run, charges the fee and pays the coins exactly once', () => {
    const store = trainedStore(6); // 60 ⚡
    const energyBefore = gameOf(store).energy;
    const { result } = playDaily(6);

    const save = onDailyChallenge(store, result, new Date(NOW));
    expect(save.ok).toBe(true);
    const game = gameOf(store);
    expect(game.energy).toBe(energyBefore - FEE);
    expect(game.battle.coins).toBe(result.coins);
    expect(game.daily.runs[DATE]).toEqual({
      score: result.score,
      tiebreak: result.tiebreak,
      coins: result.coins,
      complete: result.complete,
    });
    expect(store.getEvents().filter((e) => e.type === 'daily_challenge')).toHaveLength(1);
  });

  it('refuses a second attempt on the same date, before writing anything', () => {
    const store = trainedStore(10);
    const { result } = playDaily(6);
    onDailyChallenge(store, result, new Date(NOW));
    const events = store.getEvents().length;
    const coins = gameOf(store).battle.coins;
    const energy = gameOf(store).energy;

    expect(dailyStatus(store, DATE).ok).toBe(false);
    expect(dailyStatus(store, DATE).error).toBe('already_played');
    // Even if the UI asked anyway, nothing is written and nothing is paid.
    const second = onDailyChallenge(store, playDaily(12).result, new Date(NOW + 1000));
    expect(second.duplicate).toBe(true);
    expect(store.getEvents()).toHaveLength(events);
    expect(gameOf(store).battle.coins).toBe(coins);
    expect(gameOf(store).energy).toBe(energy);
  });

  it('opens again tomorrow', () => {
    const store = trainedStore(10);
    onDailyChallenge(store, playDaily(6).result, new Date(NOW));
    expect(dailyStatus(store, DATE).ok).toBe(false);
    expect(dailyStatus(store, '2025-05-05').ok).toBe(true);
  });

  it('refuses an attempt that cannot pay the fee — with nothing written', () => {
    const store = trainedStore(2); // 20 ⚡, the fee is 30
    const status = dailyStatus(store, DATE);
    expect(status.ok).toBe(false);
    expect(status.error).toBe('insufficient_energy');
    expect(status.energyCost).toBe(FEE);
    expect(store.getEvents().some((e) => e.type === 'daily_challenge')).toBe(false);
    // The pure rule agrees with the store-level one.
    expect(dailyEntryStatus(gameOf(store), DATE).error).toBe('insufficient_energy');
  });

  /**
   * THE convergence case. Two devices each played the day's challenge offline
   * and wrote their own event with its own uuid. The union must count ONE run,
   * charge ONE fee and pay ONE purse — in either merge order.
   */
  it('converges to ONE counted attempt from two devices, in both merge orders', () => {
    const a = dailyEvent(playDaily(6).result, 1_000, 'aaaa');
    const b = dailyEvent(playDaily(12).result, 2_000, 'bbbb');
    const energy = makeEvent('energy_gained', { date: DATE, amount: 100, source: 'set', key: 'e1' }, 500);

    const forward = rebuildGame([energy, a, b], DATE);
    const backward = rebuildGame([energy, b, a], DATE);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));

    // The FIRST event in the (ts, id) order is the one that counted.
    const first = [a, b].sort(compareEvents)[0] as AppEvent;
    expect(forward.daily.runs[DATE]?.score).toBe(first.payload['score']);
    expect(forward.battle.coins).toBe(first.payload['coins']);
    expect(forward.energy).toBe(100 - FEE); // one fee, not two
    expect(forward.daily.attempts).toBe(1);
  });

  it('converges when the two events collide on the millisecond too', () => {
    const a = dailyEvent(playDaily(6).result, 5_000, 'zzzz');
    const b = dailyEvent(playDaily(12).result, 5_000, 'aaaa');
    const forward = rebuildGame([a, b], DATE);
    const backward = rebuildGame([b, a], DATE);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    // `id` breaks the tie, so the SECOND-written run is the one that counts.
    expect(forward.daily.runs[DATE]?.score).toBe(b.payload['score']);
  });

  it('is a no-op for a plain duplicate of the same event', () => {
    const one = dailyEvent(playDaily(6).result, 1_000, 'aaaa');
    const single = rebuildGame([one], DATE);
    const twice = rebuildGame([one, { ...one, id: 'copy' }], DATE);
    expect(twice.battle.coins).toBe(single.battle.coins);
    expect(twice.energy).toBe(single.energy);
    expect(twice.daily).toEqual(single.daily);
  });

  it('counts two different DATES as two attempts', () => {
    const a = dailyEvent(playDaily(6, '2025-05-04').result, 1_000, 'aaaa');
    const b = dailyEvent(playDaily(6, '2025-05-05').result, 2_000, 'bbbb');
    const game = rebuildGame([a, b], '2025-05-05');
    expect(game.daily.attempts).toBe(2);
    expect(Object.keys(game.daily.runs)).toEqual(['2025-05-04', '2025-05-05']);
    expect(game.battle.coins).toBe(Number(a.payload['coins']) + Number(b.payload['coins']));
  });

  it('ignores an event with no date at all', () => {
    const game = emptyGame();
    applyGameEvent(game, 'daily_challenge', { score: 10, coins: 999, energySpent: 0 });
    expect(game.battle.coins).toBe(0);
    expect(game.daily.runs).toEqual({});
  });

  it('never drives the purse or the energy negative', () => {
    const game = emptyGame();
    applyGameEvent(game, 'daily_challenge', { date: DATE, score: 0, coins: 0, energySpent: 999 });
    expect(game.energy).toBe(0);
  });
});

/* ------------------------------------------------------ the derived stats */

describe('lifetime challenge stats', () => {
  const run = (date: string, score: number, tiebreak: number, complete = false): AppEvent =>
    makeEvent(
      'daily_challenge',
      { date, seed: 1, score, wavesCleared: score, tiebreak, coins: 10, energySpent: FEE, complete, outcome: 'defeated' },
      Date.parse(`${date}T12:00:00.000Z`),
    );

  it('derives attempts, completions and the record from the ledger', () => {
    const game = rebuildGame(
      [run('2025-05-01', 4, 10), run('2025-05-02', WAVES, 60, true), run('2025-05-03', 7, 90)],
      '2025-05-03',
    );
    expect(game.daily.attempts).toBe(3);
    expect(game.daily.completed).toBe(1);
    expect(game.daily.bestScore).toBe(WAVES);
    expect(game.daily.bestTiebreak).toBe(60);
    expect(game.daily.bestDate).toBe('2025-05-02');
  });

  it('breaks a tie on the score with the health the run ended on', () => {
    const game = rebuildGame([run('2025-05-01', 8, 12), run('2025-05-02', 8, 44)], '2025-05-02');
    expect(game.daily.bestScore).toBe(8);
    expect(game.daily.bestTiebreak).toBe(44);
    expect(game.daily.bestDate).toBe('2025-05-02');
  });

  it('derives the streak from the dates alone (so a merge cannot break it)', () => {
    const dates = ['2025-05-01', '2025-05-02', '2025-05-03'];
    expect(dailyStreak(dates, '2025-05-03')).toBe(3);
    // Today is still open — yesterday keeps the streak alive.
    expect(dailyStreak(dates, '2025-05-04')).toBe(3);
    // A whole missed day ends it.
    expect(dailyStreak(dates, '2025-05-05')).toBe(0);
    expect(dailyStreak([], '2025-05-05')).toBe(0);
    expect(bestDailyStreak([...dates, '2025-06-01', '2025-06-02'])).toBe(3);

    const events = dates.map((d, i) => run(d, i + 1, 0));
    const forward = rebuildGame(events, '2025-05-03');
    const shuffled = rebuildGame([...events].reverse(), '2025-05-03');
    expect(forward.daily.streak).toBe(3);
    expect(forward.daily.bestStreak).toBe(3);
    expect(JSON.stringify(shuffled.daily)).toBe(JSON.stringify(forward.daily));
  });

  it('is wiped by data_cleared like everything else', () => {
    const store = trainedStore(10);
    onDailyChallenge(store, playDaily(6).result, new Date(NOW));
    expect(gameOf(store).daily.attempts).toBe(1);
    store.clear();
    expect(gameOf(store).daily).toEqual(emptyDaily());
    expect(rebuildFromEvents(store.getEvents(), NOW).game?.daily).toEqual(emptyDaily());
  });
});

/* ---------------------------------------------------------- the v8 blob */

describe('the v7 -> v8 blob bump', () => {
  it('reports the current version and starts with an empty ledger', () => {
    // The daily ledger arrived in v8; v9 (ghost duels) rides on the same blob.
    expect(GAME_STATE_VERSION).toBe(9);
    expect(emptyGame().daily).toEqual(emptyDaily());
  });

  it('rejects a v7 blob so the runs are replayed rather than forgotten', () => {
    // Defaulting `daily` to "nothing was ever played" would hand back an attempt
    // the log says was spent — so the blob is rebuilt from the log instead.
    const old: Record<string, unknown> = { ...emptyGame(), version: 7 };
    delete old['daily'];
    expect(normalizeGame(old)).toBeNull();
  });

  it('replays a v7 save into a v8 one with its runs intact', () => {
    const store = trainedStore(10);
    onDailyChallenge(store, playDaily(6).result, new Date(NOW));
    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents(), NOW).game as GameState;
    expect(replayed.daily).toEqual(live.daily);
    expect(replayed.battle.coins).toBe(live.battle.coins);
    expect(replayed.energy).toBe(live.energy);
    expect(replayed).toEqual(live);
  });

  it('keeps only well-formed ledger entries out of a hand-edited blob', () => {
    const blob = {
      ...emptyGame(),
      daily: {
        runs: {
          [DATE]: { score: 99, tiebreak: 500, coins: -5, complete: true },
          'not-a-date': { score: 3, tiebreak: 3, coins: 3, complete: false },
        },
        attempts: 99,
        completed: 99,
        bestScore: 99,
        bestTiebreak: 99,
        bestDate: 'nonsense',
        streak: 99,
        bestStreak: 99,
      },
    };
    const clean = normalizeGame(blob as unknown as Record<string, unknown>);
    expect(Object.keys(clean?.daily.runs ?? {})).toEqual([DATE]);
    expect(clean?.daily.runs[DATE]).toEqual({ score: WAVES, tiebreak: 100, coins: 0, complete: true });
    // Every total is DERIVED from the ledger, so the invented ones are simply
    // not read: the blob can claim a record it cannot back up, and be ignored.
    expect(clean?.daily.attempts).toBe(0);
    expect(clean?.daily.bestScore).toBe(0);
    expect(clean?.daily.bestDate).toBeNull();
    expect(clean?.daily.streak).toBe(0);
  });
});

/* ------------------------------------------------------------------- feed */

describe('the adventure log', () => {
  it('gives every run one line, with the score and the purse', () => {
    const store = trainedStore(10);
    const { result } = playDaily(6);
    onDailyChallenge(store, result, new Date(NOW));

    const items = buildFeed(store.getEvents());
    const line = items.find((i) => i.cls === 'daily');
    expect(line).toBeDefined();
    expect(line?.icon).toBe('🎲');
    expect(line?.text).toBe(`אתגר יומי: ${result.score}/${WAVES} · +${result.coins} 🪙`);
    expect(line?.date).toBe(DATE);
    expect(items.filter((i) => i.cls === 'daily')).toHaveLength(1);
  });

  it('crowns a full clear', () => {
    const store = trainedStore(10);
    const { result } = playDaily(12);
    onDailyChallenge(store, result, new Date(NOW));
    const line = buildFeed(store.getEvents()).find((i) => i.cls === 'daily');
    expect(line?.icon).toBe('🏅');
    expect(line?.text).toContain('גאונטלט מלא');
    expect(line?.text).toContain(`${WAVES}/${WAVES}`);
  });
});

/* ---------------------------------------------------------------- balance */

/**
 * The pacing promise of `BALANCE.daily`, measured against the real engine with
 * the same auto-pilot the skill tests use (all six skills the moment they are
 * ready) and NO tapping — the conservative floor, since a real player taps.
 */
describe('balance', () => {
  const DATES = ['2025-05-04', '2025-06-01', '2025-12-31'];

  it('lets a mid-level character (part level 5–6) clear several waves, not all', () => {
    for (const date of DATES) {
      for (const level of [5, 6]) {
        const { result } = playDaily(level, date);
        expect(result.wavesCleared, `L${level} on ${date}`).toBeGreaterThanOrEqual(5);
        expect(result.wavesCleared, `L${level} on ${date}`).toBeLessThanOrEqual(8);
        expect(result.complete).toBe(false);
      }
    }
  });

  it('lets a strong character (part level 9+) finish the gauntlet', () => {
    for (const date of DATES) {
      for (const level of [9, 12]) {
        const { result } = playDaily(level, date);
        expect(result.wavesCleared, `L${level} on ${date}`).toBe(WAVES);
        expect(result.complete).toBe(true);
      }
    }
  });

  it('is out of reach for a beginner, and never a coin faucet for one', () => {
    const { result } = playDaily(3);
    expect(result.wavesCleared).toBeLessThanOrEqual(5);
    expect(result.coins).toBeLessThan(dailyChallenge(DATE).maxCoins / 3);
  });

  it('runs in a couple of minutes, not a session', () => {
    const stats = statsAt(9);
    const state = createChallengeBattle({ run: dailyRun(DATE), stats });
    const sum = simulate(state, stats, { waves: WAVES + 1, maxMs: 900_000, pilot: { levels: levelsAt(9) } });
    expect(sum.elapsedMs).toBeLessThan(240_000);
  });

  it('prices the entry at three ordinary waves and pays like a boss purse', () => {
    expect(FEE).toBe(3 * BALANCE.combat.energyPerWave);
    const g = dailyChallenge(DATE);
    expect(g.maxCoins).toBeGreaterThan(BALANCE.combat.boss.coinsBase);
    expect(g.maxCoins).toBeLessThan(BALANCE.combat.boss.coinsBase * 3);
  });
});
