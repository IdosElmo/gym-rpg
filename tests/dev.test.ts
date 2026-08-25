/**
 * dev.test.ts — DEV MODE (מצב מפתח): the owner gate, the grants, the resets and
 * the purge.
 *
 * The feature's promise is unusual for this app: it hands out things nobody
 * earned. Everything worth asserting follows from that:
 *
 *   THE GATE   — it opens for exactly one hashed address, and for nobody else,
 *                and never at all from `file://` or while signed out. The
 *                address itself is not in the repository and this file must not
 *                put it there either: it uses a DUMMY address and its own
 *                digest, and pins that the committed constants are 64 hex
 *                characters and nothing else.
 *   THE GRANTS — real events through the real pipeline: they replay, they
 *                merge, and each one pays EXACTLY ONCE however many copies of
 *                it arrive. A grant that could double-pay after a merge would
 *                be a bug the ordinary game could catch us with too.
 *   THE RESETS — "one attempt per day" becomes "one attempt per RESET CYCLE",
 *                and two devices that both press reset open ONE cycle, not two.
 *   THE PURGE  — the undo is EXACT: the state after a purge is deep-equal to
 *                the state of a log that never had the grants at all. That is
 *                the assertion this whole design was chosen for.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import {
  DEV_GRANTS,
  buildDevCoins,
  buildDevComplete,
  buildDevEnergy,
  buildDevLevels,
  buildDevPartXp,
  buildDevPurge,
  buildDevReset,
  devKey,
  devResetCycle,
} from '../src/core/dev.ts';
import { commit, commitRebuild, dailyStatus, gameOf, ghostDuelStatus, onSetCompleted } from '../src/core/game.ts';
import { buildGhost, ghostHash, normalizeGhost } from '../src/core/ghost.ts';
import {
  applyGameEvent,
  compareEvents,
  emptyGame,
  levelForXp,
  liveEvents,
  rebuildGame,
  type PendingEvent,
} from '../src/core/xp.ts';
import { todayISO } from '../src/core/workout.ts';
import { createDevApi } from '../src/dev/actions.ts';
import { devGateOpen, normalizeEmail, sha256Hex } from '../src/dev/gate.ts';
import { OWNER_EMAIL_HASHES } from '../src/dev/ownerHashes.ts';
import { BODY_PARTS, findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { GAME_STATE_VERSION, type AppEvent, type GameState } from '../src/storage/DataStore.ts';
import { mergeIntoStore } from '../src/storage/merge.ts';
import { normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { buildFeed } from '../src/ui/feed.ts';

/* --------------------------------------------------------------- fixtures */

const DATE = '2025-05-04';
const NOW = Date.parse('2025-05-04T18:00:00.000Z');

/**
 * A stand-in owner. It is NOT the real address (that one is only ever a digest,
 * see `src/dev/ownerHashes.ts`) — the gate is a pure function of an address and
 * a list of digests, so a dummy pair proves exactly as much.
 */
const DUMMY_EMAIL = 'dev.tester@example.com';
const DUMMY_HASH = 'fbcffb85ef32f9fe53781e44349e26002359cd58371cfc024989749866d413dc';

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

/** A store with some REAL training in it — the thing a purge must not touch. */
function trainedStore(sets = 6): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' }, new Date(NOW));
  }
  return store;
}

/** The dev API over a store, with everything nondeterministic pinned. */
function devApiFor(store: LocalStore, ids: string[] = []): ReturnType<typeof createDevApi> {
  let n = 0;
  return createDevApi({
    store,
    now: () => new Date(NOW),
    id: () => ids[n++] ?? `id-${n}`,
  });
}

/** Turn pending events into logged ones, so a fold can be driven by hand. */
function materialize(pending: readonly PendingEvent[], idPrefix: string): AppEvent[] {
  return pending.map((p, i) => ({ id: `${idPrefix}-${i}`, ts: p.ts, type: p.type, payload: p.payload }));
}

/**
 * A DETACHED copy of the game state.
 *
 * `gameOf` hands back the live object the reducer mutates in place, so a "before"
 * captured with it would quietly become an "after".
 */
function snap(store: LocalStore): GameState {
  return JSON.parse(JSON.stringify(gameOf(store))) as GameState;
}

/**
 * A timestamp strictly after everything in the log.
 *
 * `LocalStore` stamps its own events with the real clock, so a hand-written
 * event has to be placed relative to them rather than at a fixed 2025 instant —
 * the fold order is `(ts, id)`, and half of these tests are about that order.
 */
function nextTs(store: LocalStore, offset = 1_000): number {
  return store.getEvents().reduce((max, e) => Math.max(max, e.ts), 0) + offset;
}

/** Put hand-written events into a store, state and log in step. */
function seed(store: LocalStore, extra: readonly AppEvent[]): void {
  const log = [...store.getEvents(), ...extra];
  store.replaceAll(rebuildFromEvents(log, Date.now()), log);
}

/* ------------------------------------------------------------------ gate */

describe('the owner gate', () => {
  it('opens for the hashed address, with the injected hasher', async () => {
    const hasher = async (text: string): Promise<string> =>
      createHash('sha256').update(text, 'utf8').digest('hex');
    await expect(
      devGateOpen({ email: DUMMY_EMAIL, protocol: 'https:', hasher, hashes: [DUMMY_HASH] }),
    ).resolves.toBe(true);
    // Normalisation is part of the promise: a pasted address with stray spaces
    // or capitals is the same person.
    await expect(
      devGateOpen({ email: '  Dev.Tester@Example.com  ', protocol: 'https:', hasher, hashes: [DUMMY_HASH] }),
    ).resolves.toBe(true);
  });

  it('stays shut for everybody and everything else', async () => {
    const hasher = async (text: string): Promise<string> =>
      createHash('sha256').update(text, 'utf8').digest('hex');
    const shut = [
      { email: null, protocol: 'https:' }, // signed out
      { email: '', protocol: 'https:' },
      { email: '   ', protocol: 'https:' },
      { email: 'someone.else@example.com', protocol: 'https:' }, // another account
      { email: DUMMY_EMAIL, protocol: 'file:' }, // the single-file build
    ];
    for (const input of shut) {
      await expect(devGateOpen({ ...input, hasher, hashes: [DUMMY_HASH] })).resolves.toBe(false);
    }
    // No hashes configured at all, and a host without WebCrypto: both closed.
    await expect(
      devGateOpen({ email: DUMMY_EMAIL, protocol: 'https:', hasher, hashes: [] }),
    ).resolves.toBe(false);
    await expect(
      devGateOpen({ email: DUMMY_EMAIL, protocol: 'https:', hasher: async () => null, hashes: [DUMMY_HASH] }),
    ).resolves.toBe(false);
  });

  it('never throws, whatever the hasher does', async () => {
    await expect(
      devGateOpen({
        email: DUMMY_EMAIL,
        protocol: 'https:',
        hasher: () => Promise.reject(new Error('no crypto here')),
        hashes: [DUMMY_HASH],
      }),
    ).resolves.toBe(false);
  });

  it('hashes at runtime exactly as the constants were authored', async () => {
    // The digests in `ownerHashes.ts` are produced by node's crypto at
    // authoring time and compared against WebCrypto's at runtime. If those two
    // ever disagreed the panel would silently never appear — so pin them
    // against each other on the dummy pair.
    expect(createHash('sha256').update(DUMMY_EMAIL, 'utf8').digest('hex')).toBe(DUMMY_HASH);
    await expect(sha256Hex(DUMMY_EMAIL)).resolves.toBe(DUMMY_HASH);
    expect(normalizeEmail('  A@B.C ')).toBe('a@b.c');
  });

  it('keeps the address out of the repository', () => {
    // The exported list may hold 64-char lowercase hex strings and nothing else.
    const source = readFileSync(resolve(process.cwd(), 'src/dev/ownerHashes.ts'), 'utf8');
    const list = /OWNER_EMAIL_HASHES[^=]*=\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
    expect(list.trim().length).toBeGreaterThan(0);
    const literals = [...list.matchAll(/'([^']*)'/g)].map(([, l]) => l);
    expect(literals.length).toBe(OWNER_EMAIL_HASHES.length);
    for (const literal of literals) expect(literal).toMatch(/^[0-9a-f]{64}$/);
    for (const hash of OWNER_EMAIL_HASHES) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(OWNER_EMAIL_HASHES.length).toBeGreaterThan(0);

    // …and no module anywhere in `src/` carries an address-shaped literal
    // except that same documented example.
    const files = listSources(resolve(process.cwd(), 'src'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [match] of text.matchAll(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi)) {
        expect(match.endsWith('@example.com')).toBe(true);
      }
    }
  });
});

/** Every `.ts` file under a directory, recursively. */
function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/* ---------------------------------------------------------------- grants */

describe('dev grants', () => {
  it('gives energy, coins and XP through the ordinary pipeline', () => {
    const store = trainedStore(2);
    const before = snap(store);
    const api = devApiFor(store);

    expect(api.addEnergy()).toBe(before.energy + DEV_GRANTS.energy);
    expect(api.addCoins()).toBe(before.battle.coins + DEV_GRANTS.coins);
    expect(api.addXp('chest')).toBe(true);

    const game = gameOf(store);
    expect(game.parts.chest.xp).toBe(before.parts.chest.xp + DEV_GRANTS.xp);
    // Every one of them is a MARKED event in the log, and every one replays.
    const dev = store.getEvents().filter((e) => e.payload['dev'] === true);
    expect(dev.map((e) => e.type)).toEqual(['energy_gained', 'coins_granted', 'xp_gained', 'level_up']);
    expect(rebuildFromEvents(store.getEvents(), NOW).game).toEqual(game);
  });

  it('refuses an XP grant to something that is not a body part', () => {
    const store = trainedStore(1);
    const before = store.getEvents().length;
    expect(devApiFor(store).addXp('elbows')).toBe(false);
    expect(store.getEvents()).toHaveLength(before);
  });

  it('raises every body part by exactly one level, from any starting point', () => {
    const store = trainedStore(4);
    const api = devApiFor(store);
    // Uneven starting points: one part is mid-level, another is at a boundary.
    api.addXp('chest', 37);
    api.addXp('back', 100);

    const before = snap(store);
    api.levelAllParts();
    const after = gameOf(store);
    for (const part of BODY_PARTS) {
      expect(after.parts[part].level).toBe(before.parts[part].level + 1);
    }
    // Twice more, to be sure the second step is not paid from the first's change.
    api.levelAllParts(2);
    for (const part of BODY_PARTS) {
      expect(gameOf(store).parts[part].level).toBe(before.parts[part].level + 3);
    }
  });

  it('grants today\'s completion bonus once and only once', () => {
    const store = trainedStore(1);
    const api = devApiFor(store);
    const before = snap(store);

    expect(api.completeToday()).toBe(true);
    const after = snap(store);
    expect(after.energy).toBe(before.energy + BALANCE.energy.perWorkout);
    for (const part of BODY_PARTS) {
      expect(after.parts[part].xp).toBe(before.parts[part].xp + BALANCE.xp.workoutCompletionBonus);
    }
    // The second press is refused by the SAME per-date guard a real workout
    // uses — the dev grant is the real bonus, only labelled.
    expect(api.completeToday()).toBe(false);
    expect(gameOf(store).energy).toBe(after.energy);
  });

  it('never counts as a training day', () => {
    // The streak is the one number a dev panel must not be able to fake.
    const store = new LocalStore(fakeStorage());
    const api = devApiFor(store);
    api.addXp('chest', 5_000);
    api.levelAllParts(3);
    api.completeToday();
    expect(gameOf(store).workoutDays).toEqual([]);
    expect(gameOf(store).streak.tier).toBe(0);
  });

  it('pays exactly once however many duplicates a merge brings', () => {
    const game = emptyGame();
    const energy = buildDevEnergy(100, { date: DATE, ts: NOW, id: 'e1' });
    const coins = buildDevCoins(500, { date: DATE, ts: NOW, id: 'c1' });
    const xp = buildDevPartXp(game, 'chest', 250, { date: DATE, ts: NOW, id: 'x1' });

    for (let i = 0; i < 5; i += 1) {
      for (const e of [...energy, ...coins, ...xp]) applyGameEvent(game, e.type, e.payload);
    }
    expect(game.energy).toBe(100);
    expect(game.battle.coins).toBe(500);
    expect(game.parts.chest.xp).toBe(250);
    expect(game.devUsed).toBe(true);
  });

  it('converges in BOTH merge orders when two devices grant at once', () => {
    // Same grant kind, different devices, different ids: both must be paid, and
    // the order they arrive in must not change the total.
    const a = materialize(buildDevEnergy(100, { date: DATE, ts: NOW, id: 'aaa' }), 'a');
    const b = materialize(buildDevEnergy(100, { date: DATE, ts: NOW + 1_000, id: 'bbb' }), 'b');
    const c = materialize(buildDevCoins(500, { date: DATE, ts: NOW + 2_000, id: 'ccc' }), 'c');

    const forward = rebuildGame([...a, ...b, ...c], DATE);
    const backward = rebuildGame([...c, ...b, ...a], DATE);
    expect(forward).toEqual(backward);
    expect(forward.energy).toBe(200);
    expect(forward.battle.coins).toBe(500);
    // And a re-delivery of the same events changes nothing at all.
    expect(rebuildGame([...a, ...b, ...c, ...a, ...c], DATE)).toEqual(forward);
  });

  it('refuses to pay coins for an unkeyed grant', () => {
    // Without a key there is no idempotency, so a merge would double-pay. The
    // reducer would rather pay nothing.
    const game = emptyGame();
    applyGameEvent(game, 'coins_granted', { date: DATE, amount: 500, source: 'dev', dev: true });
    expect(game.battle.coins).toBe(0);
  });

  it('marks the save, and a wipe unmarks it', () => {
    const store = trainedStore(1);
    expect(gameOf(store).devUsed).toBe(false);
    devApiFor(store).addEnergy();
    expect(gameOf(store).devUsed).toBe(true);

    const wiped = rebuildGame(
      [...store.getEvents(), { id: 'z', ts: nextTs(store), type: 'data_cleared', payload: {} }],
      DATE,
    );
    expect(wiped.devUsed).toBe(false);
    expect(wiped.devKeys).toEqual({});
  });
});

/* ---------------------------------------------------------------- resets */

describe('dev resets', () => {
  /** Record one daily-challenge run by hand, at `ts`. */
  function dailyRun(ts: number, id: string): AppEvent {
    return {
      id,
      ts,
      type: 'daily_challenge',
      payload: {
        date: DATE,
        seed: 1,
        wavesCleared: 3,
        score: 3,
        tiebreak: 40,
        coins: 12,
        energySpent: BALANCE.daily.entryEnergy,
        complete: false,
        outcome: 'defeated',
        durationMs: 1_000,
      },
    };
  }

  function duelRun(ts: number, id: string, opponent = 'yossi'): AppEvent {
    return {
      id,
      ts,
      type: 'ghost_duel',
      payload: {
        date: DATE,
        opponentHandle: opponent,
        opponentName: opponent,
        won: true,
        score: 1,
        tiebreak: 50,
        seed: 2,
        energySpent: BALANCE.duel.entryEnergy,
        snapshotHash: 'h',
        outcome: 'complete',
        durationMs: 1_000,
      },
    };
  }

  it('re-opens today\'s challenge, and the one-attempt rule holds per cycle', () => {
    const store = trainedStore(30);
    seed(store, [dailyRun(nextTs(store), 'run-1')]);
    expect(dailyStatus(store, DATE).ok).toBe(false);

    devApiFor(store).resetDaily();
    expect(dailyStatus(store, DATE).ok).toBe(true);
    expect(gameOf(store).daily.runs[DATE]).toBeUndefined();

    // Play again: the slot fills, and it stays full until the NEXT reset.
    const log = [...store.getEvents(), dailyRun(nextTs(store), 'run-2')];
    const replayed = rebuildGame(log, DATE);
    expect(replayed.daily.runs[DATE]?.score).toBe(3);
    expect(replayed.devCycles[`daily|${DATE}`]).toBe(1);
  });

  it('re-opens today\'s duels, and only today\'s', () => {
    const store = trainedStore(30);
    const base = nextTs(store);
    seed(store, [
      duelRun(base, 'd-1'),
      duelRun(base + 1, 'd-2', 'dana'),
      {
        id: 'd-3',
        ts: base + 2,
        type: 'ghost_duel' as const,
        payload: { ...duelRun(base + 2, 'x').payload, date: '2025-05-03' },
      },
    ]);
    expect(ghostDuelStatus(store, DATE, 'yossi').ok).toBe(false);

    devApiFor(store).resetDuels();
    const game = gameOf(store);
    expect(ghostDuelStatus(store, DATE, 'yossi').ok).toBe(true);
    expect(ghostDuelStatus(store, DATE, 'dana').ok).toBe(true);
    // Yesterday's duel is history, not an attempt — it stays.
    expect(game.duels.runs[`2025-05-03|yossi`]).toBeDefined();
  });

  it('opens ONE cycle when two devices both reset, in both merge orders', () => {
    // Both devices see cycle 0 and write "open cycle 1". Folding both must not
    // hand out two extra attempts — the cycle is a high-water mark.
    const base = rebuildGame([dailyRun(NOW, 'run-1')], DATE);
    const a = materialize(buildDevReset(base, 'daily', { date: DATE, ts: NOW + 1_000, id: 'ra' }), 'ra');
    const b = materialize(buildDevReset(base, 'daily', { date: DATE, ts: NOW + 2_000, id: 'rb' }), 'rb');
    const second = dailyRun(NOW + 3_000, 'run-2');

    const forward = rebuildGame([dailyRun(NOW, 'run-1'), ...a, ...b, second], DATE);
    const backward = rebuildGame([second, ...b, ...a, dailyRun(NOW, 'run-1')], DATE);
    expect(forward).toEqual(backward);
    expect(forward.devCycles[`daily|${DATE}`]).toBe(1);
    // One reset, one replay: the second run occupies the slot and a third
    // attempt would need another reset.
    expect(forward.daily.attempts).toBe(1);
    expect(forward.energy).toBe(backward.energy);
  });

  it('counts the cycles up, so a second reset really is a second chance', () => {
    const store = trainedStore(30);
    const api = devApiFor(store);
    api.resetDaily();
    expect(devResetCycle(gameOf(store), 'daily', todayISO(new Date(NOW)))).toBe(2);
    api.resetDaily();
    expect(gameOf(store).devCycles[`daily|${todayISO(new Date(NOW))}`]).toBe(2);
  });

  it('ignores a reset with a nonsense scope or cycle', () => {
    const game = rebuildGame([], DATE);
    applyGameEvent(game, 'dev_reset', { date: DATE, scope: 'everything', cycle: 1, dev: true });
    applyGameEvent(game, 'dev_reset', { date: DATE, scope: 'daily', cycle: 0, dev: true });
    applyGameEvent(game, 'dev_reset', { date: '', scope: 'daily', cycle: 1, dev: true });
    expect(game.devCycles).toEqual({});
  });
});

/* ----------------------------------------------------------------- purge */

describe('the purge', () => {
  /** The same store, trained identically, with and without the dev grants. */
  function boostedAndControl(): { boosted: LocalStore; controlLog: AppEvent[] } {
    const boosted = trainedStore(6);
    const realOnly = [...boosted.getEvents()];
    const api = devApiFor(boosted);
    api.addEnergy();
    api.addCoins();
    api.addXp('legs');
    api.levelAllParts();
    api.completeToday();
    api.resetDaily();
    return { boosted, controlLog: realOnly };
  }

  it('lands EXACTLY where a log without the grants would have', () => {
    const { boosted, controlLog } = boostedAndControl();
    expect(gameOf(boosted).devUsed).toBe(true);

    devApiFor(boosted).purge();

    // The control: the same real events, replayed, with no dev event ever
    // written. Deep equality is the whole point — not "about the same".
    const control = rebuildGame(controlLog, todayISO(new Date(NOW)));
    expect(gameOf(boosted)).toEqual(control);
    expect(gameOf(boosted).devUsed).toBe(false);
    // The live state and a fresh replay of the log still agree, which is the
    // invariant the whole app rests on.
    expect(rebuildFromEvents(boosted.getEvents(), NOW).game).toEqual(gameOf(boosted));
  });

  it('keeps every REAL event, including ones earned while boosted', () => {
    // Coins won in a battle that dev energy paid for are still won: a purge
    // reverts grants, not history.
    const store = trainedStore(2);
    devApiFor(store).addEnergy();
    const wave: AppEvent = {
      id: 'w-1',
      ts: nextTs(store),
      type: 'wave_cleared',
      payload: {
        date: DATE,
        world: 1,
        wave: 1,
        miniBoss: false,
        enemyId: 'e',
        coins: 7,
        energySpent: BALANCE.combat.energyPerWave,
        seed: 1,
        durationMs: 100,
      },
    };
    seed(store, [wave]);

    devApiFor(store).purge();
    const game = gameOf(store);
    expect(game.battle.coins).toBe(7);
    expect(game.battle.wavesCleared).toBe(1);
    // The energy the wave spent is still spent — it was a real fight.
    expect(game.energy).toBe(20 - BALANCE.combat.energyPerWave);
  });

  it('lets dev mode carry on afterwards, and is idempotent', () => {
    const store = trainedStore(2);
    const api = devApiFor(store);
    api.addEnergy();
    api.purge();
    const purged = gameOf(store);

    api.purge();
    expect(gameOf(store)).toEqual(purged); // a second purge covers the same nothing

    api.addCoins();
    expect(gameOf(store).battle.coins).toBe(DEV_GRANTS.coins);
    expect(gameOf(store).devUsed).toBe(true);

    api.purge();
    expect(gameOf(store).battle.coins).toBe(0);
    expect(gameOf(store).devUsed).toBe(false);
  });

  it('converges in both merge orders — a grant on A, a purge on B', () => {
    const real = trainedStore(2).getEvents();
    const grant = materialize(buildDevEnergy(100, { date: DATE, ts: NOW + 1_000, id: 'g1' }), 'g');
    const early = materialize(buildDevPurge({ date: DATE, ts: NOW + 500, id: 'p1' }), 'pe');
    const late = materialize(buildDevPurge({ date: DATE, ts: NOW + 2_000, id: 'p2' }), 'pl');

    // The grant sorts AFTER the purge: it survives, in either arrival order.
    expect(rebuildGame([...real, ...grant, ...early], DATE)).toEqual(
      rebuildGame([...early, ...grant, ...real], DATE),
    );
    expect(rebuildGame([...real, ...grant, ...early], DATE).energy).toBe(20 + 100);

    // The grant sorts BEFORE the purge: it is covered, in either arrival order.
    expect(rebuildGame([...real, ...grant, ...late], DATE)).toEqual(
      rebuildGame([...late, ...grant, ...real], DATE),
    );
    expect(rebuildGame([...real, ...grant, ...late], DATE).energy).toBe(20);
  });

  it('survives a real cloud merge, in both directions', () => {
    // Device A granted twice while offline; device B purged in between. The two
    // logs meet through the REAL merge (union + replay), and both devices must
    // land on the same state — with the grant that sorts before the purge gone
    // and the one after it intact.
    const real = trainedStore(2).getEvents();
    const base = real.reduce((max, e) => Math.max(max, e.ts), 0);
    const early = materialize(buildDevEnergy(100, { date: DATE, ts: base + 1_000, id: 'g-early' }), 'ge');
    const purge = materialize(buildDevPurge({ date: DATE, ts: base + 2_000, id: 'p' }), 'p');
    const late = materialize(buildDevCoins(500, { date: DATE, ts: base + 3_000, id: 'g-late' }), 'gl');

    const a = new LocalStore(fakeStorage());
    const logA = [...real, ...early, ...late];
    a.replaceAll(rebuildFromEvents(logA, Date.now()), logA);
    const b = new LocalStore(fakeStorage());
    const logB = [...real, ...purge];
    b.replaceAll(rebuildFromEvents(logB, Date.now()), logB);

    mergeIntoStore(a, b.getEvents());
    mergeIntoStore(b, a.getEvents());
    expect(gameOf(a)).toEqual(gameOf(b));
    expect(gameOf(a).energy).toBe(20);
    expect(gameOf(a).battle.coins).toBe(500);
    expect(gameOf(a).devUsed).toBe(true); // the LATE grant is still in force
  });

  it('skips exactly the covered dev events and nothing else', () => {
    const real = trainedStore(1).getEvents();
    const grant = materialize(buildDevEnergy(100, { date: DATE, ts: NOW + 1_000, id: 'g' }), 'g');
    const purge = materialize(buildDevPurge({ date: DATE, ts: NOW + 2_000, id: 'p' }), 'p');
    const live = liveEvents([...real, ...grant, ...purge]);
    expect(live.filter((e) => e.payload['dev'] === true && e.type !== 'dev_purge')).toEqual([]);
    expect(live.filter((e) => e.type !== 'dev_purge')).toEqual([...real].sort(compareEvents));
  });
});

/* ------------------------------------------------------------ the ghost */

describe('the ghost carries the 🛠 flag', () => {
  it('declares dev mode only while grants are in force', () => {
    const store = trainedStore(2);
    const clean = buildGhost(gameOf(store), 'rotem');
    expect(clean.dev).toBeUndefined();

    devApiFor(store).addEnergy();
    const flagged = buildGhost(gameOf(store), 'rotem');
    expect(flagged.dev).toBe(true);
    // The fingerprint moved, so the snapshot is republished rather than left
    // advertising yesterday's label.
    expect(ghostHash(flagged)).not.toBe(ghostHash(clean));

    devApiFor(store).purge();
    expect(buildGhost(gameOf(store), 'rotem').dev).toBeUndefined();
    expect(ghostHash(buildGhost(gameOf(store), 'rotem'))).toBe(ghostHash(clean));
  });

  it('reads the flag off a fetched row, and only as a flag', () => {
    const flagged = normalizeGhost({ ...buildGhost(emptyGame(), 'yossi'), dev: true });
    expect(flagged?.dev).toBe(true);
    // Anything other than `true` is simply absent — no third state.
    expect(normalizeGhost({ ...buildGhost(emptyGame(), 'yossi'), dev: 'yes' })?.dev).toBeUndefined();
    expect(normalizeGhost(buildGhost(emptyGame(), 'yossi'))?.dev).toBeUndefined();
  });
});

/* -------------------------------------------------------------- the feed */

describe('the feed marks every dev line', () => {
  it('names each grant, each reset and the purge', () => {
    const store = trainedStore(2);
    const api = devApiFor(store);
    api.addEnergy();
    api.addCoins();
    api.addXp('chest');
    api.levelAllParts();
    api.resetDaily();
    api.resetDuels();
    api.purge();

    const dev = buildFeed(store.getEvents(), 60).filter((i) => i.cls === 'dev');
    const text = dev.map((i) => i.text).join('\n');
    expect(dev.every((i) => i.icon === '🛠')).toBe(true);
    expect(text).toContain(`אנרגיה: +${DEV_GRANTS.energy}`);
    expect(text).toContain(`מטבעות: +${DEV_GRANTS.coins}`);
    expect(text).toContain(`XP: +${DEV_GRANTS.xp} לחזה`);
    expect(text).toContain('לכל חלקי הגוף');
    expect(text).toContain('האתגר היומי אופס');
    expect(text).toContain('דו־קרבות היום אופסו');
    expect(text).toContain('הענקות מצב המפתח בוטלו');
    expect(text.split('\n').every((line) => line.includes('מצב מפתח') || line.includes('המפתח'))).toBe(true);
  });

  it('leaves ordinary training out of it, exactly as before', () => {
    const store = trainedStore(3);
    expect(buildFeed(store.getEvents(), 60).filter((i) => i.cls === 'dev')).toEqual([]);
  });
});

/* ------------------------------------------------------------ the v10 blob */

describe('the v9 -> v10 blob bump', () => {
  it('reports the current version and starts with no dev history', () => {
    // The dev ledgers arrived in v10; v11 (הליגה) rides on the same blob.
    expect(GAME_STATE_VERSION).toBe(11);
    const fresh = emptyGame();
    expect(fresh.devUsed).toBe(false);
    expect(fresh.devKeys).toEqual({});
    expect(fresh.devCycles).toEqual({});
  });

  it('rejects a v9 blob so the dev history is replayed rather than invented', () => {
    // An empty default would say "this account never used a dev grant" — which
    // would drop the 🛠 off the ghost and hand back a reset cycle the log
    // already opened. Rejected, and rebuilt from the log.
    const old: Record<string, unknown> = { ...emptyGame(), version: 9 };
    delete old['devUsed'];
    delete old['devKeys'];
    delete old['devCycles'];
    expect(normalizeGame(old)).toBeNull();
  });

  it('replays a v9 save into a v10 one with its grants intact', () => {
    const store = trainedStore(4);
    devApiFor(store).addCoins();
    devApiFor(store).resetDaily();
    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents(), NOW).game as GameState;
    expect(replayed).toEqual(live);
    expect(replayed.devUsed).toBe(true);
  });

  it('keeps only well-formed cycles out of a hand-edited blob', () => {
    const blob = {
      ...emptyGame(),
      devUsed: 'yes',
      devKeys: { [devKey('a')]: true, [devKey('b')]: 'nope' },
      devCycles: { 'daily|2025-05-04': 2, 'duels|2025-05-04': 0, junk: 'x' },
    };
    const game = normalizeGame(blob as unknown as Record<string, unknown>) as GameState;
    expect(game.devUsed).toBe(false);
    expect(game.devKeys).toEqual({ [devKey('a')]: true });
    expect(game.devCycles).toEqual({ 'daily|2025-05-04': 2 });
  });
});

/* ------------------------------------------------------------- the shapes */

describe('the grant builders', () => {
  it('refuse to emit an empty grant', () => {
    const game = emptyGame();
    expect(buildDevEnergy(0, { date: DATE, ts: NOW, id: 'a' })).toEqual([]);
    expect(buildDevEnergy(-5, { date: DATE, ts: NOW, id: 'a' })).toEqual([]);
    expect(buildDevCoins(0, { date: DATE, ts: NOW, id: 'a' })).toEqual([]);
    expect(buildDevPartXp(game, 'chest', 0, { date: DATE, ts: NOW, id: 'a' })).toEqual([]);
  });

  it('key every grant uniquely, under one namespace', () => {
    const game = emptyGame();
    const events = [
      ...buildDevEnergy(1, { date: DATE, ts: NOW, id: 'k1' }),
      ...buildDevCoins(1, { date: DATE, ts: NOW, id: 'k2' }),
      ...buildDevPartXp(game, 'arms', 1, { date: DATE, ts: NOW, id: 'k3' }),
      ...buildDevReset(game, 'daily', { date: DATE, ts: NOW, id: 'k4' }),
    ];
    const keys = events.map((e) => e.payload['key']).filter((k): k is string => typeof k === 'string');
    expect(keys).toEqual([devKey('k1'), devKey('k2'), devKey('k3'), devKey('k4')]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(events.every((e) => e.payload['dev'] === true)).toBe(true);
  });

  it('express a level grant as XP, never as a level', () => {
    // Levels are DERIVED everywhere in this app; an event that set one directly
    // would be the one fact a replay could not re-derive.
    const game = emptyGame();
    const events = buildDevLevels(game, 2, { date: DATE, ts: NOW, id: 'lv' });
    expect(events[0]?.type).toBe('xp_gained');
    for (const e of events.slice(1)) expect(e.type).toBe('level_up');
    for (const e of events) applyGameEvent(game, e.type, e.payload);
    for (const part of BODY_PARTS) expect(levelForXp(game.parts[part].xp)).toBe(3);
  });

  it('stamp the completion grant without touching its own guards', () => {
    // The dev completion is the REAL bonus, labelled — same date guard, same
    // `bonus|<date>` energy key, so it can never pay twice.
    const events = buildDevComplete(emptyGame(), 'A', { date: DATE, ts: NOW, id: 'c' });
    const energy = events.find((e) => e.type === 'energy_gained');
    expect(energy?.payload['key']).toBe(`bonus|${DATE}`);
    expect(events.every((e) => e.payload['dev'] === true)).toBe(true);
  });
});

/* ------------------------------------------------------------ the console */

describe('the console API', () => {
  it('is the same object the panel drives', () => {
    const store = trainedStore(2);
    const api = devApiFor(store);
    // Every method the README documents, present and callable.
    for (const name of [
      'addEnergy',
      'addCoins',
      'addXp',
      'levelAllParts',
      'completeToday',
      'resetDaily',
      'resetDuels',
      'resetCooldowns',
      'purge',
      'state',
      'help',
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[name]).toBe('function');
    }
    expect(api.help()).toContain('gymDev');
    // Cooldowns are session-local: with no battle on screen there is honestly
    // nothing to do, and nothing is written.
    const before = store.getEvents().length;
    expect(api.resetCooldowns()).toBe(false);
    expect(store.getEvents()).toHaveLength(before);
  });

  it('hands out a frozen snapshot, not the live state', () => {
    const store = trainedStore(2);
    const api = devApiFor(store);
    const snapshot = api.state();
    expect(snapshot.energy).toBe(gameOf(store).energy);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.parts.chest)).toBe(true);
    expect(() => {
      (snapshot as unknown as { energy: number }).energy = 9_999;
    }).toThrow();
    // …and it does not move when the game does.
    api.addEnergy();
    expect(snapshot.energy).not.toBe(gameOf(store).energy);
  });
});

/* --------------------------------------------------------------- plumbing */

describe('the commit paths', () => {
  it('rebuilds rather than folds when a purge is written', () => {
    // `commitRebuild` is the sound implementation of an event whose effect is
    // that other events must stop counting. Assert it lands exactly where a
    // fresh device replaying the same log would.
    const store = trainedStore(3);
    devApiFor(store).addEnergy();
    commitRebuild(store, buildDevPurge({ date: DATE, ts: nextTs(store), id: 'p' }), new Date(NOW));
    expect(gameOf(store)).toEqual(rebuildGame(store.getEvents(), todayISO(new Date(NOW))));
  });

  it('appends through the same commit every real grant uses', () => {
    const store = trainedStore(1);
    const appended = commit(store, buildDevEnergy(10, { date: DATE, ts: NOW, id: 'q' }), new Date(NOW));
    expect(appended).toHaveLength(1);
    expect(store.getEvents().at(-1)?.id).toBe(appended[0]?.id);
    expect(gameOf(store).energy).toBe(20);
  });
});
