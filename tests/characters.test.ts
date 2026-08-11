/**
 * characters.test.ts — the cosmetic character roster (body × skin).
 *
 * Four things are proved here, in this order:
 *   1. the DATA is sane (a full matrix, unique ids, two free base bodies,
 *      cosmetic-only across every combination);
 *   2. the REDUCER is merge-safe (a purchase pays once however many semantically
 *      duplicate events arrive, an unaffordable purchase is never written, an
 *      unknown/unowned selection is ignored, `data_cleared` resets) — and it
 *      still folds every id the SINGLE-BODY roster ever wrote;
 *   3. one purchase unlocks a skin on BOTH bodies, and switching body is free;
 *   4. the whole thing REPLAYS and CONVERGES — the roster is folded from the
 *      event log exactly like everything else, so two devices agree.
 */
import { describe, expect, it } from 'vitest';

import {
  buyCharacter,
  buyItem,
  gameOf,
  onSetCompleted,
  onWaveCleared,
  selectBody,
  selectCharacter,
} from '../src/core/game.ts';
import {
  applyGameEvent,
  availableCharacters,
  availableSkins,
  buildBodySelect,
  buildCharacterPurchase,
  buildCharacterSelect,
  compareEvents,
  emptyCharacters,
  emptyGame,
  ownsCharacter,
  ownsSkin,
  rebuildGame,
  selectedBody,
  selectedCharacter,
  statsOfGame,
} from '../src/core/xp.ts';
import {
  BASE_CHARACTERS,
  BODY_GEOMETRIES,
  CHARACTERS,
  CHARACTER_SKINS,
  DEFAULT_CHARACTER_ID,
  SKINS,
  characterById,
  characterId,
  defaultCharacter,
  isBaseCharacter,
  isBaseSkin,
  resolveCharacterId,
  skinById,
  skinOf,
} from '../src/data/characters.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { buildFeed } from '../src/ui/feed.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { GAME_STATE_VERSION, type AppEvent, type AppState } from '../src/storage/DataStore.ts';
import { migrateState, normalizeGame, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';

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

const TODAY = '2025-05-04';
const NOW = Date.parse('2025-05-04T18:00:00.000Z');

/** A store with `coins` in the purse, paid the only way coins are ever paid. */
function richStore(coins: number): LocalStore {
  const store = new LocalStore(fakeStorage());
  onSetCompleted(store, { date: TODAY, day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
  onWaveCleared(store, {
    world: 1,
    wave: 1,
    miniBoss: false,
    enemyId: 'w1_rat',
    coins,
    energySpent: 0,
    seed: 1,
    durationMs: 1000,
  });
  return store;
}

/** Run `fn` with a frozen clock — the store stamps `ts` from `Date.now()`. */
function withClock<T>(at: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => at;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

/** A second install that starts from the same history (a deep copy, not a view). */
function cloneInto(store: LocalStore, from: LocalStore): void {
  store.replaceAll(JSON.parse(JSON.stringify(from.getState())) as AppState, from.getEvents());
}

/** The cheapest purchasable SKIN — every purchase test uses it. */
const SKIN = CHARACTER_SKINS[0] as (typeof CHARACTER_SKINS)[number];

/* ------------------------------------------------------------------ data */

describe('the character roster', () => {
  it('is a full body × skin matrix with unique ids', () => {
    expect(CHARACTERS).toHaveLength(SKINS.length * BODY_GEOMETRIES.length);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    // every skin exists on every body, at the same price and with the same palette
    for (const skin of SKINS) {
      for (const body of BODY_GEOMETRIES) {
        const def = characterById(characterId(skin.id, body));
        expect(def, `${skin.id} is missing on ${body}`).toBeDefined();
        expect(def?.geometry).toBe(body);
        expect(def?.skin).toBe(skin.id);
        expect(def?.cost).toBe(skin.cost);
        expect(def?.palette).toEqual(skin.palette);
      }
    }
  });

  it('keeps exactly two free base bodies — the free skin on both silhouettes', () => {
    expect(BASE_CHARACTERS).toHaveLength(2);
    expect(BASE_CHARACTERS.map((c) => c.id)).toEqual(['hero_m', 'hero_f']);
    for (const base of BASE_CHARACTERS) expect(base.cost).toBe(0);
    // the default is a base body, and it is the original male hero
    expect(DEFAULT_CHARACTER_ID).toBe('hero_m');
    expect(defaultCharacter().id).toBe('hero_m');
    expect(defaultCharacter().geometry).toBe('male');
    expect(isBaseCharacter('hero_m')).toBe(true);
    expect(isBaseCharacter('hero_f')).toBe(true);
    expect(isBaseSkin('hero')).toBe(true);
    // …and the second free body is the female geometry
    expect(characterById('hero_f')?.geometry).toBe('female');
  });

  it('offers 2–4 purchasable skins, priced inside the coin economy', () => {
    expect(CHARACTER_SKINS.length).toBeGreaterThanOrEqual(2);
    expect(CHARACTER_SKINS.length).toBeLessThanOrEqual(4);
    for (const skin of CHARACTER_SKINS) {
      expect(skin.cost, `${skin.id} must cost coins`).toBeGreaterThan(0);
      expect(isBaseSkin(skin.id)).toBe(false);
    }
    // prices rise along the roster, so the strip reads as a ladder
    for (let i = 1; i < CHARACTER_SKINS.length; i += 1) {
      const prev = CHARACTER_SKINS[i - 1] as (typeof CHARACTER_SKINS)[number];
      const cur = CHARACTER_SKINS[i] as (typeof CHARACTER_SKINS)[number];
      expect(cur.cost).toBeGreaterThan(prev.cost);
    }
  });

  it('describes every entry in Hebrew, with a full palette and a known body', () => {
    const hex = /^#[0-9A-Fa-f]{6}$/;
    for (const c of CHARACTERS) {
      expect(c.id).toMatch(/^[a-z][a-z0-9_]*_[mf]$/);
      expect(c.he.length, `${c.id} has no Hebrew name`).toBeGreaterThan(1);
      expect(c.note.length, `${c.id} has no flavour line`).toBeGreaterThan(4);
      expect(['male', 'female']).toContain(c.geometry);
      for (const [key, value] of Object.entries(c.palette)) {
        expect(value, `${c.id}.palette.${key}`).toMatch(hex);
      }
      expect(c.decor.main).toMatch(hex);
      expect(c.decor.accent).toMatch(hex);
      expect(c.hair.main).toMatch(hex);
      expect(c.hair.accent).toMatch(hex);
    }
    // the skin cards carry their own short Hebrew label + flavour line
    for (const s of SKINS) {
      expect(s.he.length, `${s.id} has no card label`).toBeGreaterThan(1);
      expect(s.note.length).toBeGreaterThan(4);
      expect(['male', 'female']).toContain(s.nativeBody);
    }
  });

  it('is COSMETIC ONLY — no body × skin combination changes a single stat', () => {
    // The stat sheet is a function of levels + streak + equipment. Selecting or
    // owning any combination must leave it byte-identical.
    const before = statsOfGame(emptyGame());
    for (const c of CHARACTERS) {
      const game = emptyGame();
      game.characters.owned = c.cost > 0 ? [c.skin] : [];
      game.characters.selected = c.id;
      expect(statsOfGame(game), `${c.id} moved a stat`).toEqual(before);
    }
    // …and no definition even carries a field that could become a bonus.
    for (const c of CHARACTERS) {
      expect(Object.keys(c).sort()).toEqual(
        ['cost', 'decor', 'en', 'geometry', 'hair', 'he', 'id', 'note', 'palette', 'skin'].sort(),
      );
    }
  });
});

/* --------------------------------------------------- the legacy id bridge */

describe('ids written by the single-body roster', () => {
  it('maps every one of them onto the combination it always meant', () => {
    // the two base bodies WERE combination ids already
    expect(resolveCharacterId('hero_m')).toBe('hero_m');
    expect(resolveCharacterId('hero_f')).toBe('hero_f');
    // a bare skin id lands on the body that skin used to be sold on
    expect(resolveCharacterId('robot')).toBe('robot_m');
    expect(resolveCharacterId('spartan')).toBe('spartan_m');
    expect(resolveCharacterId('zombie')).toBe('zombie_m');
    expect(resolveCharacterId('ninja')).toBe('ninja_f');
    // …and a new-style id is simply itself
    expect(resolveCharacterId('ninja_m')).toBe('ninja_m');
    expect(resolveCharacterId('ghost')).toBeUndefined();
  });

  it('reduces any ownership-shaped id to its skin', () => {
    expect(skinOf('ninja')?.id).toBe('ninja');
    expect(skinOf('ninja_m')?.id).toBe('ninja');
    expect(skinOf('ninja_f')?.id).toBe('ninja');
    expect(skinOf('hero_f')?.id).toBe('hero');
    expect(skinOf('ghost')).toBeUndefined();
    expect(skinById('robot')?.cost).toBe(400);
  });
});

/* --------------------------------------------------------------- ownership */

describe('ownership rules', () => {
  it('counts both base bodies as owned without a single event', () => {
    const game = emptyGame();
    expect(game.characters).toEqual(emptyCharacters());
    expect(game.characters.owned).toEqual([]);
    expect(ownsCharacter(game, 'hero_m')).toBe(true);
    expect(ownsCharacter(game, 'hero_f')).toBe(true);
    expect(ownsSkin(game, 'hero')).toBe(true);
    expect(ownsSkin(game, SKIN.id)).toBe(false);
    expect(ownsCharacter(game, `${SKIN.id}_m`)).toBe(false);
    expect(ownsCharacter(game, 'nope')).toBe(false);
    expect(availableCharacters(game).map((c) => c.id)).toEqual(['hero_m', 'hero_f']);
    expect(availableSkins(game).map((s) => s.id)).toEqual(['hero']);
    expect(selectedCharacter(game).id).toBe('hero_m');
    expect(selectedBody(game)).toBe('male');
  });

  it('unlocks a skin on BOTH bodies from one purchase', () => {
    const game = emptyGame();
    game.characters.owned = [SKIN.id];
    for (const body of BODY_GEOMETRIES) {
      expect(ownsCharacter(game, characterId(SKIN.id, body)), `${SKIN.id} on ${body}`).toBe(true);
    }
    expect(availableCharacters(game).map((c) => c.id)).toEqual([
      'hero_m',
      'hero_f',
      `${SKIN.id}_m`,
      `${SKIN.id}_f`,
    ]);
    expect(availableSkins(game).map((s) => s.id)).toEqual(['hero', SKIN.id]);
  });

  it('falls back to the default when the selected id is not playable', () => {
    const game = emptyGame();
    game.characters.selected = `${SKIN.id}_f`; // never bought (e.g. a hand-edited blob)
    expect(selectedCharacter(game).id).toBe('hero_m');
    game.characters.selected = 'ghost';
    expect(selectedCharacter(game).id).toBe('hero_m');
    // a legacy id, on the other hand, is still perfectly playable
    game.characters.selected = 'hero_f';
    expect(selectedCharacter(game).id).toBe('hero_f');
    expect(selectedBody(game)).toBe('female');
  });
});

/* ---------------------------------------------------------------- reducer */

describe('the roster reducer', () => {
  const buy = { date: TODAY, characterId: SKIN.id, cost: SKIN.cost };

  it('pays for a skin exactly once, however many duplicates arrive', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost * 3;
    applyGameEvent(game, 'character_purchased', buy);
    // the SAME purchase from another device: different event id, same meaning
    applyGameEvent(game, 'character_purchased', { ...buy });
    applyGameEvent(game, 'character_purchased', { ...buy, cost: SKIN.cost });

    expect(game.characters.owned).toEqual([SKIN.id]);
    expect(game.battle.coins).toBe(SKIN.cost * 2);
  });

  it('unlocks BOTH bodies from that one purchase event', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost;
    applyGameEvent(game, 'character_purchased', buy);
    expect(game.characters.owned).toEqual([SKIN.id]); // a SKIN id, never a combination
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: `${SKIN.id}_f` });
    expect(game.characters.selected).toBe(`${SKIN.id}_f`);
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: `${SKIN.id}_m` });
    expect(game.characters.selected).toBe(`${SKIN.id}_m`);
  });

  it('accepts a combination id in a purchase and still owns the SKIN', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost * 2;
    applyGameEvent(game, 'character_purchased', { ...buy, characterId: `${SKIN.id}_f` });
    expect(game.characters.owned).toEqual([SKIN.id]);
    // …and the same purchase in its skin-id shape is a duplicate, not a second charge
    applyGameEvent(game, 'character_purchased', buy);
    expect(game.battle.coins).toBe(SKIN.cost);
  });

  it('never lets a purchase drive the purse negative, and ignores unknown ids', () => {
    const game = emptyGame();
    game.battle.coins = 10;
    applyGameEvent(game, 'character_purchased', { ...buy, cost: 999 });
    expect(game.battle.coins).toBe(0);

    applyGameEvent(game, 'character_purchased', { date: TODAY, characterId: 'ghost', cost: 50 });
    expect(game.characters.owned).toEqual([SKIN.id]);
  });

  it('refuses to charge for the FREE skin, even from a crafted event', () => {
    const game = emptyGame();
    game.battle.coins = 500;
    for (const id of ['hero', 'hero_f', 'hero_m']) {
      applyGameEvent(game, 'character_purchased', { date: TODAY, characterId: id, cost: 500 });
    }
    expect(game.battle.coins).toBe(500);
    expect(game.characters.owned).toEqual([]);
    expect(ownsCharacter(game, 'hero_f')).toBe(true); // owned anyway — it is free
  });

  it('selects only what the save owns, and ignores everything else', () => {
    const game = emptyGame();
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: 'hero_f' });
    expect(game.characters.selected).toBe('hero_f');

    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: `${SKIN.id}_f` }); // unowned
    expect(game.characters.selected).toBe('hero_f');
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: 'ghost' }); // unknown
    expect(game.characters.selected).toBe('hero_f');
    applyGameEvent(game, 'character_selected', { date: TODAY }); // malformed
    expect(game.characters.selected).toBe('hero_f');

    game.battle.coins = SKIN.cost;
    applyGameEvent(game, 'character_purchased', buy);
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: `${SKIN.id}_f` });
    expect(game.characters.selected).toBe(`${SKIN.id}_f`);
  });

  /**
   * THE COMPATIBILITY CONTRACT. These are the exact ids a build that only knew
   * one body per skin wrote into the log, and they have to keep folding into the
   * thing the player was looking at when they were written.
   */
  it('folds every id the single-body roster ever wrote', () => {
    const fold = (events: Array<[string, Record<string, unknown>]>): ReturnType<typeof emptyGame> => {
      const game = emptyGame();
      game.battle.coins = 10_000;
      for (const [type, payload] of events) {
        applyGameEvent(game, type as 'character_purchased', payload);
      }
      return game;
    };

    // `character_purchased 'ninja'` -> the ninja SKIN, owned on both bodies
    const bought = fold([['character_purchased', { date: TODAY, characterId: 'ninja', cost: 1800 }]]);
    expect(bought.characters.owned).toEqual(['ninja']);
    expect(ownsCharacter(bought, 'ninja_m')).toBe(true);
    expect(ownsCharacter(bought, 'ninja_f')).toBe(true);
    expect(bought.battle.coins).toBe(8200);

    // `character_selected 'hero_f'` -> female body + hero skin
    const female = fold([['character_selected', { date: TODAY, characterId: 'hero_f' }]]);
    expect(female.characters.selected).toBe('hero_f');
    expect(selectedCharacter(female).geometry).toBe('female');
    expect(selectedCharacter(female).skin).toBe('hero');

    // `'robot'` -> the male robot: it was male-only, so that IS what was on screen
    const robot = fold([
      ['character_purchased', { date: TODAY, characterId: 'robot', cost: 400 }],
      ['character_selected', { date: TODAY, characterId: 'robot' }],
    ]);
    expect(robot.characters.selected).toBe('robot_m');
    expect(selectedCharacter(robot).geometry).toBe('male');

    // …and the female-only ninja lands on the female body for the same reason
    const ninja = fold([
      ['character_purchased', { date: TODAY, characterId: 'ninja', cost: 1800 }],
      ['character_selected', { date: TODAY, characterId: 'ninja' }],
    ]);
    expect(ninja.characters.selected).toBe('ninja_f');
    expect(selectedCharacter(ninja).geometry).toBe('female');

    // a legacy selection of a skin that was never bought is still ignored
    const broke = fold([['character_selected', { date: TODAY, characterId: 'zombie' }]]);
    expect(broke.characters.selected).toBe('hero_m');
  });

  it('resets the whole roster on data_cleared', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost;
    applyGameEvent(game, 'character_purchased', buy);
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: `${SKIN.id}_f` });
    applyGameEvent(game, 'data_cleared', {});
    expect(game.characters).toEqual(emptyCharacters());
    expect(selectedCharacter(game).id).toBe('hero_m');
    expect(selectedBody(game)).toBe('male');
  });

  it('is last-write-wins in the (ts, id) total order', () => {
    const evt = (id: string, ts: number, characterId: string): AppEvent => ({
      id,
      ts,
      type: 'character_selected',
      payload: { date: TODAY, characterId },
    });
    // Same millisecond, different ids: the HIGHER id folds last and wins.
    const a = evt('aaa', 5000, 'hero_f');
    const b = evt('bbb', 5000, 'hero_m');
    expect(compareEvents(a, b)).toBeLessThan(0);
    expect(rebuildGame([a, b], TODAY).characters.selected).toBe('hero_m');
    expect(rebuildGame([b, a], TODAY).characters.selected).toBe('hero_m');
    // A later ts always wins, whatever the ids are.
    expect(rebuildGame([evt('zzz', 1, 'hero_m'), evt('aaa', 2, 'hero_f')], TODAY).characters.selected).toBe(
      'hero_f',
    );
    // …and a body switch is exactly the same event, so it converges the same way
    expect(rebuildGame([evt('aaa', 9, 'hero_f'), evt('bbb', 9, 'hero_m')], TODAY).characters.selected).toBe(
      'hero_m',
    );
  });
});

/* ------------------------------------------------------------- purchasing */

describe('buying a character through the store', () => {
  it('spends the coins, owns it forever and plays it immediately', () => {
    const store = richStore(SKIN.cost + 40);
    expect(buyCharacter(store, SKIN.id, new Date(NOW))).toEqual({ ok: true });

    const game = gameOf(store);
    expect(game.characters.owned).toEqual([SKIN.id]);
    // worn on the body already being played, and unlocked on the other one too
    expect(game.characters.selected).toBe(`${SKIN.id}_m`);
    expect(ownsCharacter(game, `${SKIN.id}_f`)).toBe(true);
    expect(game.battle.coins).toBe(40);
    expect(store.getEvents().filter((e) => e.type === 'character_purchased')).toHaveLength(1);
    expect(store.getEvents().filter((e) => e.type === 'character_selected')).toHaveLength(1);
  });

  it('buys onto the body the player is ALREADY playing', () => {
    const store = richStore(SKIN.cost);
    expect(selectBody(store, 'female')).toBe(true);
    expect(buyCharacter(store, SKIN.id, new Date(NOW))).toEqual({ ok: true });
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_f`);
    // and one purchase paid for both bodies: switching back costs nothing
    expect(selectBody(store, 'male')).toBe(true);
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_m`);
    expect(gameOf(store).battle.coins).toBe(0);
    expect(store.getEvents().filter((e) => e.type === 'character_purchased')).toHaveLength(1);
  });

  it('writes NOTHING when the player cannot afford it', () => {
    const store = richStore(SKIN.cost - 1);
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: false, error: 'insufficient_coins' });
    expect(gameOf(store).characters.owned).toEqual([]);
    expect(gameOf(store).battle.coins).toBe(SKIN.cost - 1);
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
  });

  it('refuses an unknown id, the free skin and a second purchase', () => {
    const store = richStore(SKIN.cost * 2);
    expect(buyCharacter(store, 'ghost')).toEqual({ ok: false, error: 'unknown_character' });
    expect(buyCharacter(store, 'hero')).toEqual({ ok: false, error: 'already_owned' });
    expect(buyCharacter(store, 'hero_f')).toEqual({ ok: false, error: 'already_owned' });
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: true });
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: false, error: 'already_owned' });
    // …and buying "the other body" of an owned skin is not a thing you can do
    expect(buyCharacter(store, `${SKIN.id}_f`)).toEqual({ ok: false, error: 'already_owned' });
    expect(gameOf(store).battle.coins).toBe(SKIN.cost);
  });

  it('switches between the two free bodies with no purchase at all', () => {
    const store = new LocalStore(fakeStorage());
    expect(gameOf(store).characters.selected).toBe('hero_m');
    expect(selectBody(store, 'female')).toBe(true);
    expect(gameOf(store).characters.selected).toBe('hero_f');
    // re-selecting the same one is a no-op: no event, no log noise
    expect(selectBody(store, 'female')).toBe(false);
    expect(selectCharacter(store, 'hero_f')).toBe(false);
    expect(store.getEvents().filter((e) => e.type === 'character_selected')).toHaveLength(1);
    // an unowned skin cannot be selected on either body without buying it
    expect(selectCharacter(store, `${SKIN.id}_f`)).toBe(false);
    expect(selectCharacter(store, `${SKIN.id}_m`)).toBe(false);
    expect(gameOf(store).characters.selected).toBe('hero_f');
    // no coins were ever involved
    expect(gameOf(store).battle.coins).toBe(0);
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
  });

  it('plans a purchase without spending anything (pure builder)', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost;
    const plan = buildCharacterPurchase(game, SKIN.id, TODAY, 1000);
    expect(plan.ok).toBe(true);
    expect(plan.events.map((e) => e.type)).toEqual(['character_purchased', 'character_selected']);
    // the purchase names the SKIN, the selection names the combination
    expect(plan.events[0]?.payload['characterId']).toBe(SKIN.id);
    expect(plan.events[1]?.payload['characterId']).toBe(`${SKIN.id}_m`);
    expect(game.battle.coins).toBe(SKIN.cost); // the builder decides, it does not spend
    expect(buildCharacterSelect(game, `${SKIN.id}_f`, TODAY, 1000)).toEqual([]); // not owned yet
  });

  it('plans a body switch as one plain character_selected', () => {
    const game = emptyGame();
    const pending = buildBodySelect(game, 'female', TODAY, 1000);
    expect(pending.map((e) => e.type)).toEqual(['character_selected']);
    expect(pending[0]?.payload['characterId']).toBe('hero_f');
    // the body already being played plans nothing at all
    expect(buildBodySelect(game, 'male', TODAY, 1000)).toEqual([]);
    // …and the skin rides along: an owned skin stays on, only the body changes
    game.characters.owned = [SKIN.id];
    game.characters.selected = `${SKIN.id}_m`;
    expect(buildBodySelect(game, 'female', TODAY, 1000)[0]?.payload['characterId']).toBe(`${SKIN.id}_f`);
  });
});

/* -------------------------------------------------------- replay & merge */

describe('the roster replays and converges', () => {
  it('is a pure function of the log (live state === rebuildGame)', () => {
    const store = richStore(SKIN.cost + 100);
    buyCharacter(store, SKIN.id);
    selectCharacter(store, 'hero_f');
    selectBody(store, 'male');
    selectCharacter(store, `${SKIN.id}_f`);

    const replayed = rebuildGame(store.getEvents(), TODAY);
    expect(replayed.characters).toEqual(gameOf(store).characters);
    expect(replayed.battle.coins).toBe(gameOf(store).battle.coins);
  });

  it('converges when two devices buy the SAME skin offline (different uuids)', () => {
    // The whole scenario runs on a frozen clock: `LocalStore` stamps ts itself
    // and clamps it to be strictly increasing, so the history has to predate the
    // two offline actions for their order to mean anything.
    const a = withClock(NOW - 100_000, () => richStore(SKIN.cost + 100));
    const b = new LocalStore(fakeStorage());
    // device B holds the same coin history, then buys the same skin on its own
    cloneInto(b, a);
    withClock(NOW, () => buyCharacter(a, SKIN.id, new Date(NOW)));
    withClock(NOW + 60_000, () => buyCharacter(b, SKIN.id, new Date(NOW + 60_000)));

    const byId = new Map<string, AppEvent>();
    for (const ev of [...a.getEvents(), ...b.getEvents()]) if (!byId.has(ev.id)) byId.set(ev.id, ev);
    const union = [...byId.values()];

    const forward = rebuildFromEvents(union, NOW + 120_000);
    const backward = rebuildFromEvents([...union].reverse(), NOW + 120_000);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    // charged ONCE, even though two purchase events exist
    expect(union.filter((e) => e.type === 'character_purchased')).toHaveLength(2);
    expect(forward.game?.characters.owned).toEqual([SKIN.id]);
    expect(forward.game?.battle.coins).toBe(100);
  });

  it('lands both devices on the character that was chosen LAST', () => {
    const a = withClock(NOW - 100_000, () => richStore(SKIN.cost + 100));
    const b = new LocalStore(fakeStorage());
    cloneInto(b, a);

    withClock(NOW, () => buyCharacter(a, SKIN.id, new Date(NOW))); // A ends up on the skin
    withClock(NOW + 5_000, () => selectBody(b, 'female', new Date(NOW + 5_000))); // …B switched later

    const union = [...a.getEvents(), ...b.getEvents()];
    const merged = rebuildFromEvents(union, NOW + 60_000);
    const other = rebuildFromEvents([...union].reverse(), NOW + 60_000);
    expect(merged.game?.characters.selected).toBe('hero_f');
    expect(JSON.stringify(merged)).toBe(JSON.stringify(other));
    // the skin is still owned — a switch never gives a purchase back
    expect(merged.game?.characters.owned).toEqual([SKIN.id]);
  });

  /**
   * The one genuinely new merge shape: two devices moving along DIFFERENT axes
   * of the matrix. Because body and skin ride in ONE `character_selected`, the
   * later event simply wins whole — there is no way to end up half-merged
   * (male body + a skin the other device picked) and no second reducer to keep
   * in step.
   */
  it('converges when one device changes body and the other changes skin', () => {
    const a = withClock(NOW - 100_000, () => richStore(SKIN.cost + 100));
    const b = new LocalStore(fakeStorage());
    cloneInto(b, a);

    withClock(NOW, () => selectBody(a, 'female', new Date(NOW)));
    withClock(NOW + 5_000, () => buyCharacter(b, SKIN.id, new Date(NOW + 5_000)));

    const byId = new Map<string, AppEvent>();
    for (const ev of [...a.getEvents(), ...b.getEvents()]) if (!byId.has(ev.id)) byId.set(ev.id, ev);
    const union = [...byId.values()];
    const forward = rebuildFromEvents(union, NOW + 60_000);
    const backward = rebuildFromEvents([...union].reverse(), NOW + 60_000);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    // B bought later, on ITS body (male) — that whole combination wins
    expect(forward.game?.characters.selected).toBe(`${SKIN.id}_m`);
    expect(forward.game?.characters.owned).toEqual([SKIN.id]);
    // …and the female variant of that skin is unlocked all the same
    expect(ownsCharacter(forward.game as ReturnType<typeof emptyGame>, `${SKIN.id}_f`)).toBe(true);
  });

  it('converges on a log that mixes legacy ids with new ones', () => {
    // A device still running the single-body build wrote `'ninja'`; this one
    // writes `'ninja_m'`. The union has to fold to one drawing, either way round.
    const legacy: AppEvent[] = [
      { id: 'e1', ts: 1_000, type: 'wave_cleared', payload: { world: 1, wave: 1, coins: 5_000 } },
      { id: 'e2', ts: 2_000, type: 'character_purchased', payload: { characterId: 'ninja', cost: 1800 } },
      { id: 'e3', ts: 3_000, type: 'character_selected', payload: { characterId: 'ninja' } },
    ];
    const modern: AppEvent[] = [
      { id: 'e4', ts: 4_000, type: 'character_selected', payload: { characterId: 'ninja_m' } },
    ];
    const union = [...legacy, ...modern];
    const forward = rebuildFromEvents(union, NOW);
    const backward = rebuildFromEvents([...union].reverse(), NOW);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
    expect(forward.game?.characters.owned).toEqual(['ninja']);
    expect(forward.game?.characters.selected).toBe('ninja_m'); // the later event wins
    expect(forward.game?.battle.coins).toBe(3200); // charged exactly once
  });

  it('keeps equipment and the roster independent', () => {
    const store = richStore(SKIN.cost + 200);
    buyItem(store, 'belt_1');
    buyCharacter(store, SKIN.id);
    const game = gameOf(store);
    expect(game.equipment.owned).toEqual(['belt_1']);
    expect(game.characters.owned).toEqual([SKIN.id]);
    expect(rebuildGame(store.getEvents(), TODAY).equipment).toEqual(game.equipment);
  });
});

/* ------------------------------------------------------------------ feed */

describe('the adventure feed', () => {
  it('reports a bought character, and stays quiet about switching', () => {
    const store = richStore(SKIN.cost + 50);
    buyCharacter(store, SKIN.id);
    selectCharacter(store, 'hero_f');

    const items = buildFeed(store.getEvents());
    const bought = items.filter((i) => i.text.includes(SKIN.he));
    expect(bought).toHaveLength(1);
    expect(bought[0]?.icon).toBe('🎭');
    expect(bought[0]?.text).toContain(String(SKIN.cost));
    // switching body or skin is free and reversible — it is not news
    expect(items.some((i) => i.text.includes('לוחמת המכון'))).toBe(false);
  });
});

/* ------------------------------------------------------- the version bump */

describe('the game blob version', () => {
  it('carries the roster at the CURRENT version', () => {
    // v6 introduced the roster; v7 (equipment upgrades) rides on the same blob.
    expect(GAME_STATE_VERSION).toBe(7);
    expect(emptyGame().version).toBe(7);
    expect(emptyGame().characters).toEqual({ owned: [], selected: 'hero_m' });
  });

  it('rejects a v5 blob so it is rebuilt from the log', () => {
    // v5 stored the SELECTED skin id in `owned` and a possibly-bare id in
    // `selected` — the same field names, different meanings. Sniffing that is a
    // trap; the version number is the answer, and the log is the migration.
    const old = { ...emptyGame(), version: 5, characters: { owned: ['robot'], selected: 'robot' } };
    expect(normalizeGame(old as unknown as Record<string, unknown>)).toBeNull();
    const older = { ...emptyGame(), version: 4 } as unknown as Record<string, unknown>;
    delete older['characters'];
    expect(normalizeGame(older)).toBeNull();
  });

  it('drops unknown/free ids and an unplayable selection from a stored blob', () => {
    const blob = {
      ...emptyGame(),
      characters: { owned: [SKIN.id, 'hero', 'hero_f', 'ghost', SKIN.id], selected: 'ghost' },
    };
    const game = normalizeGame(blob);
    expect(game?.characters.owned).toEqual([SKIN.id]); // free skin + junk dropped, deduped
    expect(game?.characters.selected).toBe('hero_m'); // unplayable -> the default

    const kept = normalizeGame({ ...blob, characters: { owned: [SKIN.id], selected: `${SKIN.id}_f` } });
    expect(kept?.characters.selected).toBe(`${SKIN.id}_f`);
    const free = normalizeGame({ ...blob, characters: { owned: [], selected: 'hero_f' } });
    expect(free?.characters.selected).toBe('hero_f'); // always playable, never "owned"

    // both id shapes are tolerated on the way in: a combination id in `owned`
    // is reduced to its skin, and a legacy selection is resolved to a body.
    const mixed = normalizeGame({ ...blob, characters: { owned: [`${SKIN.id}_f`], selected: SKIN.id } });
    expect(mixed?.characters.owned).toEqual([SKIN.id]);
    expect(mixed?.characters.selected).toBe(`${SKIN.id}_${skinById(SKIN.id)?.nativeBody === 'female' ? 'f' : 'm'}`);
  });

  it('rebuilds the roster when a state blob arrives from an older version', () => {
    const store = richStore(SKIN.cost + 10);
    buyCharacter(store, SKIN.id);
    const raw = JSON.parse(JSON.stringify(store.getState())) as Record<string, unknown>;
    (raw['game'] as Record<string, unknown>)['version'] = 5; // pretend it is old
    const migrated = migrateState(raw, NOW);
    expect(migrated.game).toBeNull(); // …and `ensureGameState` replays the log

    const rebuilt = rebuildFromEvents(store.getEvents(), NOW);
    expect(rebuilt.game?.characters.selected).toBe(`${SKIN.id}_m`);
    expect(rebuilt.game?.characters.owned).toEqual([SKIN.id]);
    expect(rebuilt.game?.version).toBe(GAME_STATE_VERSION);
  });

  /**
   * The full v5 -> v6 story, end to end: a save whose blob AND log were written
   * by the single-body build. The blob is rejected, the log is replayed, and the
   * player lands on exactly the character they were playing — now with the other
   * body of that skin unlocked for free.
   */
  it('migrates a v5 save by replaying its log, landing on the same drawing', () => {
    const events: AppEvent[] = [
      { id: 'a', ts: 1_000, type: 'wave_cleared', payload: { world: 1, wave: 1, coins: 2_000 } },
      { id: 'b', ts: 2_000, type: 'character_purchased', payload: { characterId: 'robot', cost: 400 } },
      { id: 'c', ts: 3_000, type: 'character_selected', payload: { characterId: 'robot' } },
    ];
    const v5Blob = {
      schemaVersion: 4,
      sessions: {},
      ui: { view: 'CH', open: {} },
      game: { ...emptyGame(), version: 5, characters: { owned: ['robot'], selected: 'robot' } },
      plan: null,
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    };
    expect(migrateState(JSON.parse(JSON.stringify(v5Blob)) as Record<string, unknown>, NOW).game).toBeNull();

    const rebuilt = rebuildFromEvents(events, NOW);
    expect(rebuilt.game?.version).toBe(GAME_STATE_VERSION);
    expect(rebuilt.game?.characters).toEqual({ owned: ['robot'], selected: 'robot_m' });
    expect(rebuilt.game?.battle.coins).toBe(1600);
    // the robot now exists on the female body too, at no extra cost
    expect(ownsCharacter(rebuilt.game as ReturnType<typeof emptyGame>, 'robot_f')).toBe(true);
  });
});
