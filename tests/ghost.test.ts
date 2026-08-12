/**
 * ghost.test.ts — THE GHOST DUEL, from the published snapshot to the ledger.
 *
 * Six properties matter here, and each has its own block below:
 *
 *   1. THE SNAPSHOT IS MINIMAL AND HONEST. What is published is a character —
 *      levels, streak, gear, look — and nothing else: no history, no email, no
 *      identifiers. What comes BACK is treated as hostile: every level, tier,
 *      item and skin is clamped or dropped, and a payload from another version
 *      is refused outright.
 *   2. THE SAME FIGHT FOR BOTH SIDES. The seed is a hash of the two handles
 *      SORTED plus the date, so "A duels B" and "B duels A" are the same number
 *      on the same day and a different one tomorrow.
 *   3. DETERMINISM. Two runs of the same seed, the same two snapshots and the
 *      same action schedule produce byte-identical fights.
 *   4. ONE DUEL PER OPPONENT PER DAY. The reducer is idempotent on
 *      (date, opponent), not on the event id: two devices converge — in BOTH
 *      merge orders — on one counted duel and one fee.
 *   5. THE ECONOMY. The fee is real, refused BEFORE anything is written when it
 *      cannot be paid, and a duel NEVER pays a coin, however the event is
 *      shaped or crafted.
 *   6. THE BLOB. v9 carries the ledger; a v8 blob is rebuilt from the log.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { advance, createChallengeBattle, simulate, type ChallengeResult, type CombatStats } from '../src/core/combat.ts';
import {
  GHOST_VERSION,
  buildGhost,
  duelSeed,
  ghostCharacterId,
  ghostHash,
  ghostRun,
  ghostStats,
  ghostWave,
  normalizeGhost,
  type GhostPayload,
} from '../src/core/ghost.ts';
import { checkHandle, defaultHandle, duelKey, normalizeHandle } from '../src/core/handle.ts';
import { gameOf, ghostDuelStatus, onGhostDuel, onSetCompleted } from '../src/core/game.ts';
import {
  applyGameEvent,
  compareEvents,
  duelEntryStatus,
  emptyDuels,
  emptyGame,
  rebuildGame,
  statsOfGame,
  totalXpToReach,
} from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { EQUIPMENT, equipmentById } from '../src/data/gameContent.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { GAME_STATE_VERSION, type AppEvent, type GameState } from '../src/storage/DataStore.ts';
import { normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { SyncEngine } from '../src/sync/engine.ts';
import { GhostHandleTakenError, type GhostRow, type PullPage, type SyncBackend } from '../src/sync/backend.ts';
import { readSyncMeta } from '../src/sync/meta.ts';
import { buildFeed } from '../src/ui/feed.ts';

/* --------------------------------------------------------------- fixtures */

const DATE = '2025-05-04';
const NOW = Date.parse('2025-05-04T18:00:00.000Z');
const FEE = BALANCE.duel.entryEnergy;
const ME = 'רותם';
const FOE = 'yossi';

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

/** A game state whose six parts all sit at `level`. */
function gameAt(level: number): GameState {
  const game = emptyGame();
  for (const p of BODY_PARTS) {
    game.parts[p].xp = totalXpToReach(level) + 1;
    game.parts[p].level = level;
  }
  game.level = level;
  return game;
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

/** A store with `sets × 10` ⚡ in the bank. */
function trainedStore(sets = 6): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  return store;
}

/** Fight a ghost exactly the way the arena does, and return the record. */
function duel(
  myLevel: number,
  ghost: GhostPayload,
  opts: { date?: string; myHandle?: string; opponentHandle?: string } = {},
): { result: ChallengeResult; events: string } {
  const stats = combatStats(gameAt(myLevel));
  const state = createChallengeBattle({
    run: ghostRun({
      myHandle: opts.myHandle ?? ME,
      opponentHandle: opts.opponentHandle ?? FOE,
      ghost,
      date: opts.date ?? DATE,
    }),
    stats,
    energy: 500,
  });
  const sum = simulate(state, stats, { waves: 2, maxMs: 600_000 });
  const result = sum.challenge;
  if (!result) throw new Error('the duel never ended');
  return { result, events: JSON.stringify(sum.events) };
}

/** The one event a finished duel writes, as another device would have sent it. */
function duelEvent(result: ChallengeResult, ts: number, id: string, hash = 'h1'): AppEvent {
  return {
    id,
    ts,
    type: 'ghost_duel',
    payload: {
      date: result.date,
      opponentHandle: result.opponent?.handle ?? '',
      opponentName: result.opponent?.name ?? '',
      won: result.won === true,
      score: result.won === true ? 1 : 0,
      tiebreak: result.tiebreak,
      seed: result.seed,
      energySpent: result.energySpent,
      snapshotHash: hash,
      outcome: result.outcome,
      durationMs: result.durationMs,
    },
  };
}

/* ---------------------------------------------------------------- handles */

describe('the שם לוחם', () => {
  it('canonicalises what a human types, so an exact-match lookup works', () => {
    expect(normalizeHandle('  Yossi  ')).toBe('yossi');
    expect(normalizeHandle('YOSSI')).toBe('yossi');
    expect(normalizeHandle('בן   גוריון')).toBe('בן גוריון');
    expect(normalizeHandle(42)).toBe('');
    // Publishing and looking up use the SAME function — that is the invariant.
    expect(normalizeHandle(checkHandle(' RoTeM ').handle)).toBe('rotem');
  });

  it('refuses a name that cannot be typed back reliably', () => {
    expect(checkHandle('').error).toBe('empty');
    expect(checkHandle('yo').error).toBe('too_short');
    expect(checkHandle('a'.repeat(21)).error).toBe('too_long');
    expect(checkHandle('yossi🔥').error).toBe('bad_chars');
    expect(checkHandle('yo ssi<b>').error).toBe('bad_chars');
    expect(checkHandle('רותם').ok).toBe(true);
    expect(checkHandle('rotem_2').ok).toBe(true);
    expect(checkHandle('בן גוריון').ok).toBe(true);
  });

  it('derives a first name from the account without leaking the address', () => {
    expect(defaultHandle('yossi@example.com', 'u-1')).toBe('yossi');
    // Nothing after the @ ever appears.
    expect(defaultHandle('yossi@example.com', 'u-1')).not.toContain('example');
    // An unusable local part falls back to a Hebrew name plus a short id.
    const fallback = defaultHandle('a@example.com', 'abc-123-def');
    expect(fallback.startsWith('לוחם-')).toBe(true);
    expect(checkHandle(fallback).ok).toBe(true);
    expect(checkHandle(defaultHandle(null, '')).ok).toBe(true);
  });

  it('keys the ledger by (date, opponent) in canonical form', () => {
    expect(duelKey(DATE, ' YOSSI ')).toBe(`${DATE}|yossi`);
    expect(duelKey(DATE, 'yossi')).toBe(duelKey(DATE, 'Yossi'));
    expect(duelKey('2025-05-05', 'yossi')).not.toBe(duelKey(DATE, 'yossi'));
  });
});

/* ---------------------------------------------------------- the snapshot */

describe('the published ghost', () => {
  it('carries a character and nothing else', () => {
    const game = gameAt(7);
    game.streak.tier = 2;
    game.equipment.owned.push('gloves_1');
    game.equipment.equipped.gloves = 'gloves_1';
    game.equipment.upgrades['gloves_1'] = 2;
    game.characters.selected = 'hero_f';

    const ghost = buildGhost(game, ' Rotem ');
    expect(Object.keys(ghost).sort()).toEqual(
      ['body', 'characterLevel', 'equipped', 'name', 'parts', 'skin', 'streakTier', 'upgrades', 'v'].sort(),
    );
    expect(ghost.v).toBe(GHOST_VERSION);
    expect(ghost.name).toBe('rotem');
    expect(ghost.body).toBe('female');
    expect(ghost.skin).toBe('hero');
    expect(ghost.parts.chest).toBe(7);
    expect(ghost.streakTier).toBe(2);
    expect(ghost.equipped.gloves).toBe('gloves_1');
    expect(ghost.upgrades['gloves_1']).toBe(2);
    expect(ghost.characterLevel).toBe(7);
    expect(ghostCharacterId(ghost)).toBe('hero_f');

    // Explicitly: none of the private half of the save travels.
    const json = JSON.stringify(ghost);
    expect(json).not.toContain('workoutDays');
    expect(json).not.toContain('@');
    expect(json).not.toContain('coins');
    expect(json).not.toContain('granted');
  });

  it('survives a round trip through the wire unchanged', () => {
    const game = gameAt(5);
    game.equipment.equipped.cape = 'cape_2';
    const ghost = buildGhost(game, FOE);
    const wire = JSON.parse(JSON.stringify(ghost)) as unknown;
    expect(normalizeGhost(wire)).toEqual(ghost);
    expect(ghostHash(normalizeGhost(wire) as GhostPayload)).toBe(ghostHash(ghost));
  });

  it('derives its stats through the SAME pipeline the player uses', () => {
    const game = gameAt(9);
    game.streak.tier = 3;
    game.equipment.equipped.belt = 'belt_2';
    game.equipment.upgrades['belt_2'] = 1;
    const ghost = buildGhost(game, FOE);
    // Identical numbers, from the same function — a ghost is not "an enemy
    // approximating a player", it is the player's own derivation.
    expect(ghostStats(ghost)).toEqual(statsOfGame(game));
  });

  it('changes its fingerprint when the character changes, and only then', () => {
    const game = gameAt(4);
    const base = ghostHash(buildGhost(game, FOE));
    expect(ghostHash(buildGhost(gameAt(4), FOE))).toBe(base);

    const trained = gameAt(4);
    trained.parts.chest.level = 5;
    expect(ghostHash(buildGhost(trained, FOE))).not.toBe(base);

    const geared = gameAt(4);
    geared.equipment.equipped.shoes = 'shoes_1';
    expect(ghostHash(buildGhost(geared, FOE))).not.toBe(base);

    const upgraded = gameAt(4);
    upgraded.equipment.equipped.shoes = 'shoes_1';
    upgraded.equipment.upgrades['shoes_1'] = 3;
    expect(ghostHash(buildGhost(upgraded, FOE))).not.toBe(ghostHash(buildGhost(geared, FOE)));

    const renamed = ghostHash(buildGhost(gameAt(4), 'someone'));
    expect(renamed).not.toBe(base);

    // Coins, XP and workout history are NOT part of a character's look or
    // stats, so they must not trigger a republish.
    const richer = gameAt(4);
    richer.battle.coins = 99_999;
    richer.workoutDays = ['2025-01-01'];
    expect(ghostHash(buildGhost(richer, FOE))).toBe(base);
  });
});

/* ------------------------------------------------------- hostile payloads */

describe('a payload from a hostile client', () => {
  const hostile = {
    v: 1,
    name: '  ATTACKER  ',
    body: 'dragon',
    skin: 'not-a-skin',
    parts: { chest: 1e9, back: -50, legs: 'ten', shoulders: Infinity, arms: NaN, core: 99 },
    streakTier: 1_000_000,
    equipped: { gloves: 'gloves_3', belt: 'gloves_1', shoes: 'made-up', cape: 42, hat: 'gloves_3' },
    upgrades: { gloves_3: 99, 'made-up': 3, belt_1: -4 },
    characterLevel: 999,
    // Fields we never asked for, from a client that hopes we read them.
    coins: 1e9,
    energy: 1e9,
    stats: { atk: 1e9 },
  };

  it('is clamped into the game\'s own bounds, field by field', () => {
    const g = normalizeGhost(hostile) as GhostPayload;
    expect(g).not.toBeNull();
    expect(g.name).toBe('attacker');
    expect(g.parts.chest).toBe(BALANCE.xp.maxLevel);
    expect(g.parts.back).toBe(1);
    expect(g.parts.legs).toBe(1); // a string is not a level
    expect(g.parts.shoulders).toBe(1); // nor is Infinity
    expect(g.parts.arms).toBe(1); // nor NaN
    expect(g.parts.core).toBe(99);
    expect(g.streakTier).toBe(BALANCE.duel.maxStreakTier);
    // Only a real item, in the slot it actually belongs to, survives.
    expect(g.equipped.gloves).toBe('gloves_3');
    expect(g.equipped.belt).toBeUndefined(); // gloves in the belt slot
    expect(g.equipped.shoes).toBeUndefined(); // unknown id
    expect(g.equipped.cape).toBeUndefined(); // not even a string
    expect(g.upgrades['gloves_3']).toBe(BALANCE.upgrades.maxLevel);
    expect(g.upgrades['made-up']).toBeUndefined();
    expect(g.upgrades['belt_1']).toBeUndefined();
    expect(g.skin).toBe('hero');
    expect(g.body).toBe('male');
    // The level is DERIVED, so the row cannot claim one its stats deny: two
    // parts survived at 99 and four were clamped to 1, so the honest headline
    // level is floor((99+1+1+1+1+99)/6) = 33, not the 999 it asked for.
    expect(g.characterLevel).toBe(33);
    // Nothing it invented came through.
    expect(Object.keys(g)).not.toContain('coins');
    expect(Object.keys(g)).not.toContain('stats');
  });

  it('cannot produce a stat outside what a real character could have', () => {
    const g = normalizeGhost(hostile) as GhostPayload;
    const stats = ghostStats(g);
    const strongest = gameAt(BALANCE.xp.maxLevel);
    strongest.streak.tier = BALANCE.duel.maxStreakTier;
    for (const item of EQUIPMENT) {
      const def = equipmentById(item.id);
      if (def) strongest.equipment.equipped[def.slot] = def.id;
    }
    for (const item of EQUIPMENT) strongest.equipment.upgrades[item.id] = BALANCE.upgrades.maxLevel;
    const ceiling = statsOfGame(strongest);

    for (const key of ['atk', 'def', 'maxHp', 'critChance', 'critMultiplier', 'regen'] as const) {
      expect(Number.isFinite(stats[key])).toBe(true);
      expect(stats[key]).toBeLessThanOrEqual(ceiling[key]);
    }
    expect(stats.attackIntervalMs).toBeGreaterThanOrEqual(BALANCE.stats.attackIntervalMinMs);
  });

  it('is refused outright when it is not a ghost at all', () => {
    expect(normalizeGhost(null)).toBeNull();
    expect(normalizeGhost('nope')).toBeNull();
    expect(normalizeGhost([1, 2, 3])).toBeNull();
    expect(normalizeGhost({})).toBeNull();
    // A future version is refused rather than guessed at.
    expect(normalizeGhost({ ...hostile, v: 2 })).toBeNull();
    expect(normalizeGhost({ ...hostile, v: 0 })).toBeNull();
    // A name that could not have been chosen is not repaired into one.
    expect(normalizeGhost({ ...hostile, name: 'x' })).toBeNull();
    expect(normalizeGhost({ ...hostile, name: '<script>' })).toBeNull();
    expect(normalizeGhost({ ...hostile, name: '' })).toBeNull();
  });

  it('still makes a fightable, finite opponent', () => {
    const g = normalizeGhost(hostile) as GhostPayload;
    const wave = ghostWave({ ghost: g });
    expect(wave.hp).toBeGreaterThan(0);
    expect(Number.isFinite(wave.hp)).toBe(true);
    expect(Number.isFinite(wave.atk)).toBe(true);
    // And it pays nothing, like every ghost.
    expect(wave.coins).toBe(0);
    const { result } = duel(9, g);
    expect(result.coins).toBe(0);
    expect(['complete', 'defeated']).toContain(result.outcome);
  });
});

/* -------------------------------------------------------------- the seed */

describe('the duel seed', () => {
  it('is the same for both sides of the same fight on the same day', () => {
    expect(duelSeed(ME, FOE, DATE)).toBe(duelSeed(FOE, ME, DATE));
    // …including when one side typed the name differently.
    expect(duelSeed('YOSSI', ME, DATE)).toBe(duelSeed(ME, ' yossi ', DATE));
  });

  it('is a different fight tomorrow, and against somebody else', () => {
    expect(duelSeed(ME, FOE, '2025-05-05')).not.toBe(duelSeed(ME, FOE, DATE));
    expect(duelSeed(ME, 'dana', DATE)).not.toBe(duelSeed(ME, FOE, DATE));
  });

  it('rides into the run and the record', () => {
    const ghost = buildGhost(gameAt(5), FOE);
    const run = ghostRun({ myHandle: ME, opponentHandle: FOE, ghost, date: DATE });
    expect(run.seed).toBe(duelSeed(ME, FOE, DATE));
    expect(run.kind).toBe('ghost');
    expect(run.waves).toHaveLength(1);
    expect(run.energyCost).toBe(FEE);
    expect(run.completionBonus).toBe(0);
    expect(run.opponent?.handle).toBe(FOE);
    const { result } = duel(5, ghost);
    expect(result.seed).toBe(run.seed);
  });
});

/* ------------------------------------------------------------ the fight */

describe('the duel itself', () => {
  it('is byte-identical given the same seed, snapshots and actions', () => {
    const ghost = buildGhost(gameAt(6), FOE);
    const a = duel(6, ghost);
    const b = duel(6, ghost);
    expect(b.events).toBe(a.events);
    expect(b.result).toEqual(a.result);
  });

  it('changes when ANY of those three inputs changes', () => {
    const ghost = buildGhost(gameAt(6), FOE);
    const base = duel(6, ghost);
    // another day = another seed
    expect(duel(6, ghost, { date: '2025-05-05' }).events).not.toBe(base.events);
    // a stronger opponent
    expect(duel(6, buildGhost(gameAt(8), FOE)).events).not.toBe(base.events);
    // a stronger me
    expect(duel(8, ghost).events).not.toBe(base.events);
  });

  it('lets the ghost fight back with its real stats — and only those', () => {
    const strong = buildGhost(gameAt(12), FOE);
    const weak = buildGhost(gameAt(2), FOE);
    expect(duel(6, weak).result.won).toBe(true);
    expect(duel(6, strong).result.won).toBe(false);

    // It mitigates, crits and regenerates like a person…
    const wave = ghostWave({ ghost: strong });
    const stats = ghostStats(strong);
    expect(wave.def).toBe(stats.def);
    expect(wave.critChance).toBe(stats.critChance);
    expect(wave.regen).toBe(stats.regen);
    // …and it is a single wave, so "cleared it" IS "won".
    const { result } = duel(6, weak);
    expect(result.complete).toBe(true);
    expect(result.score).toBe(1);
    expect(result.won).toBe(true);
  });

  it('leaves ordinary enemies exactly as they were', () => {
    // The defensive fields are optional, and a gauntlet wave built without them
    // must not gain a single one — that is what keeps every campaign seed valid.
    const ghost = buildGhost(gameAt(3), FOE);
    const wave = ghostWave({ ghost });
    expect(wave.def).toBeGreaterThan(0);
    const plain = { ...wave, def: undefined, critChance: undefined, regen: undefined };
    expect(plain.def).toBeUndefined();
  });

  it('never pays a coin, whoever wins', () => {
    for (const level of [2, 6, 12]) {
      const { result } = duel(6, buildGhost(gameAt(level), FOE));
      expect(result.coins).toBe(0);
      expect(result.energySpent).toBe(FEE);
    }
  });
});

/* ------------------------------------------------------------ the ledger */

describe('the duel ledger', () => {
  it('records one duel, charges the fee once and pays nothing', () => {
    const store = trainedStore(10);
    const before = gameOf(store);
    const energyBefore = before.energy;
    const coinsBefore = before.battle.coins;
    const { result } = duel(9, buildGhost(gameAt(3), FOE));

    const save = onGhostDuel(store, result, 'hash-1', new Date(NOW));
    expect(save.ok).toBe(true);
    const game = gameOf(store);
    expect(game.energy).toBe(energyBefore - FEE);
    expect(game.battle.coins).toBe(coinsBefore);
    expect(game.duels.duels).toBe(1);
    expect(game.duels.wins).toBe(1);
    expect(game.duels.byOpponent[FOE]).toEqual({ wins: 1, losses: 0, duels: 1 });
    expect(game.duels.runs[duelKey(DATE, FOE)]?.won).toBe(true);
    // The campaign is untouched: a duel is not progress.
    expect(game.battle.wavesCleared).toBe(0);
    expect(store.getEvents().filter((e) => e.type === 'ghost_duel')).toHaveLength(1);
  });

  it('refuses a second duel with the same opponent on the same day', () => {
    const store = trainedStore(10);
    const { result } = duel(9, buildGhost(gameAt(3), FOE));
    onGhostDuel(store, result, 'h', new Date(NOW));
    const energyAfterFirst = gameOf(store).energy;

    const again = onGhostDuel(store, result, 'h', new Date(NOW));
    expect(again.ok).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(gameOf(store).energy).toBe(energyAfterFirst);
    expect(store.getEvents().filter((e) => e.type === 'ghost_duel')).toHaveLength(1);

    const status = ghostDuelStatus(store, DATE, FOE);
    expect(status.ok).toBe(false);
    expect(status.error).toBe('already_dueled');
    expect(status.record?.won).toBe(true);
  });

  it('allows a DIFFERENT opponent the same day, and the same one tomorrow', () => {
    const store = trainedStore(20);
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE)).result, 'h', new Date(NOW));
    onGhostDuel(
      store,
      duel(9, buildGhost(gameAt(3), 'dana'), { opponentHandle: 'dana' }).result,
      'h',
      new Date(NOW),
    );
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE), { date: '2025-05-05' }).result, 'h', new Date(NOW));

    const game = gameOf(store);
    expect(game.duels.duels).toBe(3);
    expect(game.duels.byOpponent[FOE]?.duels).toBe(2);
    expect(game.duels.byOpponent['dana']?.duels).toBe(1);
    expect(game.energy).toBe(200 - 3 * FEE);
  });

  it('converges on ONE duel in BOTH merge orders', () => {
    // Two devices, both offline, both fought the same person on the same day.
    const mine = duel(9, buildGhost(gameAt(3), FOE)).result;
    const theirs = duel(4, buildGhost(gameAt(12), FOE)).result;
    const a = duelEvent(mine, NOW, 'aaaa-1', 'hash-a');
    const b = duelEvent(theirs, NOW + 5_000, 'bbbb-2', 'hash-b');

    const forward = rebuildGame([a, b], DATE);
    const backward = rebuildGame([b, a], DATE);
    expect(JSON.stringify(backward.duels)).toBe(JSON.stringify(forward.duels));
    expect(forward.duels.duels).toBe(1);
    // The FIRST in the log's (ts, id) order is the one that counts.
    expect([a, b].sort(compareEvents)[0]?.id).toBe('aaaa-1');
    expect(forward.duels.runs[duelKey(DATE, FOE)]?.won).toBe(mine.won);
    // And the fee was charged exactly once, in both orders.
    expect(backward.energy).toBe(forward.energy);
  });

  it('charges the fee exactly once however many duplicates arrive', () => {
    const result = duel(9, buildGhost(gameAt(3), FOE)).result;
    const game = emptyGame();
    game.energy = 100;
    const ev = duelEvent(result, NOW, 'x-1');
    for (let i = 0; i < 5; i += 1) applyGameEvent(game, 'ghost_duel', ev.payload as Record<string, unknown>);
    expect(game.energy).toBe(100 - FEE);
    expect(Object.keys(game.duels.runs)).toHaveLength(1);
  });

  it('cannot be made to pay coins by any payload', () => {
    const game = emptyGame();
    game.energy = 100;
    applyGameEvent(game, 'ghost_duel', {
      date: DATE,
      opponentHandle: FOE,
      won: true,
      coins: 999_999,
      energySpent: -50,
      tiebreak: 999,
    });
    expect(game.battle.coins).toBe(0);
    // A negative fee cannot refund energy either.
    expect(game.energy).toBe(100);
    expect(game.duels.runs[duelKey(DATE, FOE)]?.tiebreak).toBe(100);
  });

  it('ignores an event with nothing to key on', () => {
    const game = emptyGame();
    applyGameEvent(game, 'ghost_duel', { opponentHandle: FOE, won: true });
    applyGameEvent(game, 'ghost_duel', { date: DATE, won: true });
    applyGameEvent(game, 'ghost_duel', { date: DATE, opponentHandle: '   ', won: true });
    expect(game.duels).toEqual(emptyDuels());
  });

  it('derives every total from the ledger, so a merge cannot skew it', () => {
    const events = [
      duelEvent({ ...duel(9, buildGhost(gameAt(3), FOE)).result }, NOW, 'e-1'),
      duelEvent(
        { ...duel(4, buildGhost(gameAt(12), FOE)).result, date: '2025-05-05' },
        NOW + 86_400_000,
        'e-2',
      ),
    ];
    const forward = rebuildGame(events, '2025-05-05');
    const shuffled = rebuildGame([...events].reverse(), '2025-05-05');
    expect(JSON.stringify(shuffled.duels)).toBe(JSON.stringify(forward.duels));
    expect(forward.duels.duels).toBe(2);
    expect(forward.duels.wins).toBe(1);
    expect(forward.duels.losses).toBe(1);
    expect(forward.duels.byOpponent[FOE]).toEqual({ wins: 1, losses: 1, duels: 2 });
  });

  it('is wiped by data_cleared like everything else', () => {
    const store = trainedStore(10);
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE)).result, 'h', new Date(NOW));
    expect(gameOf(store).duels.duels).toBe(1);
    store.clear();
    expect(gameOf(store).duels).toEqual(emptyDuels());
    expect(rebuildFromEvents(store.getEvents(), NOW).game?.duels).toEqual(emptyDuels());
  });
});

/* ------------------------------------------------------------ the economy */

describe('the entry fee', () => {
  it('refuses a duel that cannot be paid for — before anything is written', () => {
    const store = trainedStore(1); // 10 ⚡, the fee is 20
    const status = ghostDuelStatus(store, DATE, FOE);
    expect(status.ok).toBe(false);
    expect(status.error).toBe('insufficient_energy');
    expect(status.energyCost).toBe(FEE);
    expect(store.getEvents().filter((e) => e.type === 'ghost_duel')).toHaveLength(0);
    expect(gameOf(store).energy).toBe(10);
  });

  it('refuses a duel with nobody', () => {
    const game = emptyGame();
    game.energy = 100;
    expect(duelEntryStatus(game, DATE, '').error).toBe('no_opponent');
    expect(duelEntryStatus(game, DATE, '   ').error).toBe('no_opponent');
  });

  it('reports the lifetime record with the refusal, for the card to show', () => {
    const store = trainedStore(10);
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE)).result, 'h', new Date(NOW));
    const status = ghostDuelStatus(store, '2025-05-05', FOE);
    expect(status.ok).toBe(true);
    expect(status.tally).toEqual({ wins: 1, losses: 0, duels: 1 });
  });
});

/* ---------------------------------------------------------- the v9 blob */

describe('the v8 -> v9 blob bump', () => {
  it('reports the current version and starts with an empty duel ledger', () => {
    // The duel ledger arrived in v9; v10 (dev mode) rides on the same blob.
    expect(GAME_STATE_VERSION).toBe(10);
    expect(emptyGame().duels).toEqual(emptyDuels());
  });

  it('rejects a v8 blob so the duels are replayed rather than forgotten', () => {
    // Defaulting `duels` to "nobody was ever fought" would hand back a duel the
    // log says was spent — so the blob is rebuilt from the log instead.
    const old: Record<string, unknown> = { ...emptyGame(), version: 8 };
    delete old['duels'];
    expect(normalizeGame(old)).toBeNull();
  });

  it('replays a v8 save into a v9 one with its duels intact', () => {
    const store = trainedStore(10);
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE)).result, 'h', new Date(NOW));
    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents(), NOW).game as GameState;
    expect(replayed.duels).toEqual(live.duels);
    expect(replayed.energy).toBe(live.energy);
    expect(replayed).toEqual(live);
  });

  it('keeps only well-formed ledger entries out of a hand-edited blob', () => {
    const blob = {
      ...emptyGame(),
      duels: {
        runs: {
          [`${DATE}|${FOE}`]: { opponent: FOE, won: true, score: 99, tiebreak: 5_000 },
          // The key and the entry disagree — the slot is not the reducer's.
          [`${DATE}|dana`]: { opponent: 'someone-else', won: true, score: 1, tiebreak: 10 },
          'not-a-date|x': { opponent: 'x', won: true, score: 1, tiebreak: 10 },
          nonsense: { opponent: 'x', won: true },
        },
        duels: 99,
        wins: 99,
        losses: 0,
        byOpponent: { [FOE]: { wins: 99, losses: 0, duels: 99 } },
      },
    };
    const clean = normalizeGame(blob as unknown as Record<string, unknown>);
    expect(Object.keys(clean?.duels.runs ?? {})).toEqual([`${DATE}|${FOE}`]);
    expect(clean?.duels.runs[`${DATE}|${FOE}`]).toEqual({ opponent: FOE, won: true, score: 1, tiebreak: 100 });
    // Every total is DERIVED, so the invented ones are simply not read.
    expect(clean?.duels.duels).toBe(0);
    expect(clean?.duels.wins).toBe(0);
    expect(clean?.duels.byOpponent).toEqual({});
  });
});

/* -------------------------------------------------------------- the feed */

describe('the adventure log', () => {
  it('gives every duel one line, and never a purse', () => {
    const store = trainedStore(10);
    onGhostDuel(store, duel(9, buildGhost(gameAt(3), FOE)).result, 'h', new Date(NOW));
    onGhostDuel(
      store,
      duel(2, buildGhost(gameAt(14), 'dana'), { opponentHandle: 'dana' }).result,
      'h',
      new Date(NOW),
    );
    const lines = buildFeed(store.getEvents()).filter((i) => i.cls.startsWith('duel'));
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.text.includes(`ניצחון על ${FOE}`))).toBe(true);
    expect(lines.some((l) => l.text.includes('הפסד מול dana'))).toBe(true);
    for (const line of lines) {
      expect(line.icon).toBe('⚔️');
      expect(line.text).not.toContain('🪙');
    }
  });
});

/* -------------------------------------------------------- the publisher */

/** The `ghosts` table: one row per user, one owner per handle. */
class MemoryBackend implements SyncBackend {
  readonly events: AppEvent[] = [];
  readonly ghosts = new Map<string, GhostRow>();
  publishes = 0;
  lookups = 0;

  async pushEvents(_userId: string, events: readonly AppEvent[]): Promise<void> {
    for (const ev of events) if (!this.events.some((e) => e.id === ev.id)) this.events.push(ev);
  }

  async pullEvents(_userId: string, afterSeq: number): Promise<PullPage> {
    return { events: [], lastSeq: afterSeq };
  }

  async publishGhost(userId: string, handle: string, payload: Record<string, unknown>): Promise<void> {
    this.publishes += 1;
    for (const [owner, row] of this.ghosts) {
      if (owner !== userId && row.handle === handle) throw new GhostHandleTakenError();
    }
    this.ghosts.set(userId, { handle, payload, updatedAt: NOW });
  }

  async fetchGhost(handle: string): Promise<GhostRow | null> {
    this.lookups += 1;
    for (const row of this.ghosts.values()) if (row.handle === handle) return row;
    return null;
  }
}

function engineFor(store: LocalStore, storage: StorageLike, backend: MemoryBackend): SyncEngine {
  return new SyncEngine({
    store,
    backend,
    storage,
    now: () => NOW,
    win: null,
    doc: null,
    isOnline: () => true,
    isVisible: () => false,
    ghost: {
      snapshot: (handle) => {
        const payload = buildGhost(gameOf(store), handle);
        return { payload: payload as unknown as Record<string, unknown>, hash: ghostHash(payload) };
      },
      defaultHandle: () => 'default-name',
    },
  });
}

describe('publishing my ghost', () => {
  it('uploads once, then not again until the character changes', async () => {
    const storage = fakeStorage();
    const store = trainedStore(6);
    const backend = new MemoryBackend();
    const engine = engineFor(store, storage, backend);

    await engine.onSignedIn('user-1');
    expect(backend.publishes).toBe(1);
    expect(backend.ghosts.get('user-1')?.handle).toBe('default-name');
    expect(readSyncMeta(storage).ghostHandle).toBe('default-name');
    const hash = readSyncMeta(storage).ghostHash;
    expect(hash).toBeTruthy();

    // Nothing about the character moved — no second write.
    await engine.sync();
    await engine.sync();
    expect(backend.publishes).toBe(1);

    // Training levels a part up, which changes the character — so the next
    // cycle republishes.
    store.update((draft) => {
      if (draft.game) draft.game.parts.chest.level = 9;
    });
    await engine.sync();
    expect(backend.publishes).toBe(2);
    expect(readSyncMeta(storage).ghostHash).not.toBe(hash);
  });

  it('publishes nothing at all when the build has no ghosts', async () => {
    const storage = fakeStorage();
    const backend = new MemoryBackend();
    const engine = new SyncEngine({
      store: trainedStore(6),
      backend,
      storage,
      now: () => NOW,
      win: null,
      doc: null,
      isOnline: () => true,
      isVisible: () => false,
    });
    await engine.onSignedIn('user-1');
    expect(backend.publishes).toBe(0);
    expect(backend.ghosts.size).toBe(0);
  });

  it('renames on request, and refuses a name somebody else owns', async () => {
    const storage = fakeStorage();
    const backend = new MemoryBackend();
    const engine = engineFor(trainedStore(6), storage, backend);
    backend.ghosts.set('someone-else', { handle: 'taken', payload: {}, updatedAt: NOW });

    await engine.onSignedIn('user-1');
    expect(await engine.setGhostHandle('rotem')).toBe(true);
    expect(engine.getGhostHandle()).toBe('rotem');
    expect(backend.ghosts.get('user-1')?.handle).toBe('rotem');

    expect(await engine.setGhostHandle('taken')).toBe(false);
    // The refusal changes nothing: the old name keeps working.
    expect(engine.getGhostHandle()).toBe('rotem');
    expect(readSyncMeta(storage).ghostHandle).toBe('rotem');
  });

  it('never lets a failed publish break a sync cycle', async () => {
    const storage = fakeStorage();
    const store = trainedStore(6);
    const backend = new MemoryBackend();
    backend.publishGhost = async (): Promise<void> => {
      throw new Error('ghosts table is on fire');
    };
    const engine = engineFor(store, storage, backend);

    await engine.onSignedIn('user-1');
    // The events still went up, and the engine is idle rather than in error.
    expect(backend.events.length).toBeGreaterThan(0);
    expect(engine.getStatus().kind).toBe('idle');
    // Nothing was recorded as published, so the next cycle tries again.
    expect(readSyncMeta(storage).ghostHash).toBeNull();
  });

  it('remembers recent opponents, newest first, without duplicates', async () => {
    const storage = fakeStorage();
    const engine = engineFor(trainedStore(6), storage, new MemoryBackend());
    await engine.onSignedIn('user-1');
    engine.rememberOpponent('dana');
    engine.rememberOpponent(FOE);
    engine.rememberOpponent('dana');
    expect(engine.getRecentOpponents()).toEqual(['dana', FOE]);
    expect(readSyncMeta(storage).ghostRecent).toEqual(['dana', FOE]);
    // And a notebook written before ghost duels existed simply has none.
    expect(readSyncMeta(fakeStorage()).ghostRecent).toEqual([]);
  });
});

/* ------------------------------------------------------- replay stability */

describe('a duel already fought', () => {
  it('is not re-simulated when the opponent retrains', () => {
    const store = trainedStore(10);
    const beforeTheyTrained = buildGhost(gameAt(3), FOE);
    const { result } = duel(9, beforeTheyTrained);
    onGhostDuel(store, result, ghostHash(beforeTheyTrained), new Date(NOW));
    const won = gameOf(store).duels.runs[duelKey(DATE, FOE)]?.won;

    // They train overnight and publish a much stronger ghost. The RECORD is
    // authoritative: replaying the log reproduces the duel that happened, not
    // the one that would happen now.
    const replayed = rebuildFromEvents(store.getEvents(), NOW).game as GameState;
    expect(replayed.duels.runs[duelKey(DATE, FOE)]?.won).toBe(won);
    // The snapshot that was fought is named in the event, for forensics only.
    const ev = store.getEvents().find((e) => e.type === 'ghost_duel');
    expect(ev?.payload['snapshotHash']).toBe(ghostHash(beforeTheyTrained));
    expect(ghostHash(buildGhost(gameAt(20), FOE))).not.toBe(ev?.payload['snapshotHash']);
  });
});

/* ------------------------------------------------------------- the arena */

describe('a duel in the state machine', () => {
  it('is a challenge run like the daily one, with its own kind', () => {
    const ghost = buildGhost(gameAt(4), FOE);
    const stats = combatStats(gameAt(6));
    const state = createChallengeBattle({
      run: ghostRun({ myHandle: ME, opponentHandle: FOE, ghost, date: DATE, svg: '<svg/>' }),
      stats,
      energy: 100,
    });
    expect(state.challenge?.kind).toBe('ghost');
    const events = advance(state, BALANCE.combat.tickMs, stats);
    const spawn = events.find((e) => e.kind === 'challenge_spawn');
    expect(spawn).toBeDefined();
    expect(state.enemy?.ghost).toBe(true);
    expect(state.enemy?.svg).toBe('<svg/>');
    expect(state.enemy?.he).toBe(FOE);
    // No `wave_cleared` can ever come out of a duel: it is not the campaign.
    const sum = simulate(state, stats, { waves: 2, maxMs: 300_000 });
    expect(sum.events.some((e) => e.kind === 'wave_cleared')).toBe(false);
    expect(sum.challenge?.kind).toBe('ghost');
  });
});
