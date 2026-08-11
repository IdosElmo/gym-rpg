/**
 * characters.test.ts — the cosmetic character roster.
 *
 * Three things are proved here, in this order:
 *   1. the DATA is sane (unique ids, two free base bodies, cosmetic-only);
 *   2. the REDUCER is merge-safe (a purchase pays once however many semantically
 *      duplicate events arrive, an unaffordable purchase is never written, an
 *      unknown/unowned selection is ignored, `data_cleared` resets);
 *   3. the whole thing REPLAYS and CONVERGES — the roster is folded from the
 *      event log exactly like everything else, so two devices agree.
 */
import { describe, expect, it } from 'vitest';

import {
  buyCharacter,
  buyItem,
  gameOf,
  onSetCompleted,
  onWaveCleared,
  selectCharacter,
} from '../src/core/game.ts';
import {
  applyGameEvent,
  availableCharacters,
  buildCharacterPurchase,
  buildCharacterSelect,
  compareEvents,
  emptyCharacters,
  emptyGame,
  ownsCharacter,
  rebuildGame,
  selectedCharacter,
  statsOfGame,
} from '../src/core/xp.ts';
import {
  BASE_CHARACTERS,
  CHARACTERS,
  CHARACTER_SKINS,
  DEFAULT_CHARACTER_ID,
  characterById,
  defaultCharacter,
  isBaseCharacter,
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

/** The cheapest skin — every purchase test uses it. */
const SKIN = CHARACTER_SKINS[0] as (typeof CHARACTER_SKINS)[number];

/* ------------------------------------------------------------------ data */

describe('the character roster', () => {
  it('has unique ids and exactly two free base bodies', () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    expect(BASE_CHARACTERS).toHaveLength(2);
    for (const base of BASE_CHARACTERS) expect(base.cost).toBe(0);
    // the default is a base body, and it is the original male hero
    expect(DEFAULT_CHARACTER_ID).toBe('hero_m');
    expect(defaultCharacter().id).toBe('hero_m');
    expect(defaultCharacter().geometry).toBe('male');
    expect(isBaseCharacter('hero_m')).toBe(true);
    expect(isBaseCharacter('hero_f')).toBe(true);
    // …and the second free body is the NEW female geometry
    expect(characterById('hero_f')?.geometry).toBe('female');
  });

  it('offers 2–4 purchasable skins, priced inside the coin economy', () => {
    expect(CHARACTER_SKINS.length).toBeGreaterThanOrEqual(2);
    expect(CHARACTER_SKINS.length).toBeLessThanOrEqual(4);
    for (const skin of CHARACTER_SKINS) {
      expect(skin.cost, `${skin.id} must cost coins`).toBeGreaterThan(0);
      expect(isBaseCharacter(skin.id)).toBe(false);
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
      expect(c.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c.he.length, `${c.id} has no Hebrew name`).toBeGreaterThan(1);
      expect(c.note.length, `${c.id} has no flavour line`).toBeGreaterThan(4);
      expect(['male', 'female']).toContain(c.geometry);
      for (const [key, value] of Object.entries(c.palette)) {
        expect(value, `${c.id}.palette.${key}`).toMatch(hex);
      }
      expect(c.decor.main).toMatch(hex);
      expect(c.decor.accent).toMatch(hex);
    }
  });

  it('is COSMETIC ONLY — no character changes a single stat', () => {
    // The stat sheet is a function of levels + streak + equipment. Selecting or
    // owning any character must leave it byte-identical.
    const base = emptyGame();
    const before = statsOfGame(base);
    for (const c of CHARACTERS) {
      const game = emptyGame();
      game.characters.owned = c.cost > 0 ? [c.id] : [];
      game.characters.selected = c.id;
      expect(statsOfGame(game)).toEqual(before);
    }
    // …and no definition even carries a field that could become a bonus.
    for (const c of CHARACTERS) {
      expect(Object.keys(c).sort()).toEqual(
        ['cost', 'decor', 'en', 'geometry', 'he', 'id', 'note', 'palette'].sort(),
      );
    }
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
    expect(ownsCharacter(game, SKIN.id)).toBe(false);
    expect(ownsCharacter(game, 'nope')).toBe(false);
    expect(availableCharacters(game).map((c) => c.id)).toEqual(['hero_m', 'hero_f']);
    expect(selectedCharacter(game).id).toBe('hero_m');
  });

  it('falls back to the default when the selected id is not playable', () => {
    const game = emptyGame();
    game.characters.selected = SKIN.id; // never bought (e.g. a hand-edited blob)
    expect(selectedCharacter(game).id).toBe('hero_m');
    game.characters.selected = 'ghost';
    expect(selectedCharacter(game).id).toBe('hero_m');
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

  it('never lets a purchase drive the purse negative, and ignores unknown ids', () => {
    const game = emptyGame();
    game.battle.coins = 10;
    applyGameEvent(game, 'character_purchased', { ...buy, cost: 999 });
    expect(game.battle.coins).toBe(0);

    applyGameEvent(game, 'character_purchased', { date: TODAY, characterId: 'ghost', cost: 50 });
    expect(game.characters.owned).toEqual([SKIN.id]);
  });

  it('refuses to charge for a FREE base body, even from a crafted event', () => {
    const game = emptyGame();
    game.battle.coins = 500;
    applyGameEvent(game, 'character_purchased', { date: TODAY, characterId: 'hero_f', cost: 500 });
    expect(game.battle.coins).toBe(500);
    expect(game.characters.owned).toEqual([]);
    expect(ownsCharacter(game, 'hero_f')).toBe(true); // owned anyway — it is free
  });

  it('selects only what the save owns, and ignores everything else', () => {
    const game = emptyGame();
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: 'hero_f' });
    expect(game.characters.selected).toBe('hero_f');

    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: SKIN.id }); // unowned
    expect(game.characters.selected).toBe('hero_f');
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: 'ghost' }); // unknown
    expect(game.characters.selected).toBe('hero_f');
    applyGameEvent(game, 'character_selected', { date: TODAY }); // malformed
    expect(game.characters.selected).toBe('hero_f');

    game.battle.coins = SKIN.cost;
    applyGameEvent(game, 'character_purchased', buy);
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: SKIN.id });
    expect(game.characters.selected).toBe(SKIN.id);
  });

  it('resets the whole roster on data_cleared', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost;
    applyGameEvent(game, 'character_purchased', buy);
    applyGameEvent(game, 'character_selected', { date: TODAY, characterId: SKIN.id });
    applyGameEvent(game, 'data_cleared', {});
    expect(game.characters).toEqual(emptyCharacters());
    expect(selectedCharacter(game).id).toBe('hero_m');
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
  });
});

/* ------------------------------------------------------------- purchasing */

describe('buying a character through the store', () => {
  it('spends the coins, owns it forever and plays it immediately', () => {
    const store = richStore(SKIN.cost + 40);
    expect(buyCharacter(store, SKIN.id, new Date(NOW))).toEqual({ ok: true });

    const game = gameOf(store);
    expect(game.characters.owned).toEqual([SKIN.id]);
    expect(game.characters.selected).toBe(SKIN.id);
    expect(game.battle.coins).toBe(40);
    expect(store.getEvents().filter((e) => e.type === 'character_purchased')).toHaveLength(1);
    expect(store.getEvents().filter((e) => e.type === 'character_selected')).toHaveLength(1);
  });

  it('writes NOTHING when the player cannot afford it', () => {
    const store = richStore(SKIN.cost - 1);
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: false, error: 'insufficient_coins' });
    expect(gameOf(store).characters.owned).toEqual([]);
    expect(gameOf(store).battle.coins).toBe(SKIN.cost - 1);
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
  });

  it('refuses an unknown id, a free body and a second purchase', () => {
    const store = richStore(SKIN.cost * 2);
    expect(buyCharacter(store, 'ghost')).toEqual({ ok: false, error: 'unknown_character' });
    expect(buyCharacter(store, 'hero_f')).toEqual({ ok: false, error: 'already_owned' });
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: true });
    expect(buyCharacter(store, SKIN.id)).toEqual({ ok: false, error: 'already_owned' });
    expect(gameOf(store).battle.coins).toBe(SKIN.cost);
  });

  it('switches between the two free bodies with no purchase at all', () => {
    const store = new LocalStore(fakeStorage());
    expect(gameOf(store).characters.selected).toBe('hero_m');
    expect(selectCharacter(store, 'hero_f')).toBe(true);
    expect(gameOf(store).characters.selected).toBe('hero_f');
    // re-selecting the same one is a no-op: no event, no log noise
    expect(selectCharacter(store, 'hero_f')).toBe(false);
    expect(store.getEvents().filter((e) => e.type === 'character_selected')).toHaveLength(1);
    // an unowned skin cannot be selected without buying it
    expect(selectCharacter(store, SKIN.id)).toBe(false);
    expect(gameOf(store).characters.selected).toBe('hero_f');
  });

  it('plans a purchase without spending anything (pure builder)', () => {
    const game = emptyGame();
    game.battle.coins = SKIN.cost;
    const plan = buildCharacterPurchase(game, SKIN.id, TODAY, 1000);
    expect(plan.ok).toBe(true);
    expect(plan.events.map((e) => e.type)).toEqual(['character_purchased', 'character_selected']);
    expect(game.battle.coins).toBe(SKIN.cost); // the builder decides, it does not spend
    expect(buildCharacterSelect(game, SKIN.id, TODAY, 1000)).toEqual([]); // not owned yet
  });
});

/* -------------------------------------------------------- replay & merge */

describe('the roster replays and converges', () => {
  it('is a pure function of the log (live state === rebuildGame)', () => {
    const store = richStore(SKIN.cost + 100);
    buyCharacter(store, SKIN.id);
    selectCharacter(store, 'hero_f');
    selectCharacter(store, SKIN.id);

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
    withClock(NOW + 5_000, () => selectCharacter(b, 'hero_f', new Date(NOW + 5_000))); // …B switched later

    const union = [...a.getEvents(), ...b.getEvents()];
    const merged = rebuildFromEvents(union, NOW + 60_000);
    const other = rebuildFromEvents([...union].reverse(), NOW + 60_000);
    expect(merged.game?.characters.selected).toBe('hero_f');
    expect(JSON.stringify(merged)).toBe(JSON.stringify(other));
    // the skin is still owned — a switch never gives a purchase back
    expect(merged.game?.characters.owned).toEqual([SKIN.id]);
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
    // switching character is free and reversible — it is not news
    expect(items.some((i) => i.text.includes('לוחמת המכון'))).toBe(false);
  });
});

/* ------------------------------------------------------- the version bump */

describe('the v5 game blob', () => {
  it('reports version 5 and carries the roster', () => {
    expect(GAME_STATE_VERSION).toBe(5);
    expect(emptyGame().version).toBe(5);
    expect(emptyGame().characters).toEqual({ owned: [], selected: 'hero_m' });
  });

  it('rejects a v4 blob so it is rebuilt from the log', () => {
    const old = { ...emptyGame(), version: 4 } as unknown as Record<string, unknown>;
    delete old['characters'];
    expect(normalizeGame(old)).toBeNull();
  });

  it('drops unknown/base ids and an unplayable selection from a stored blob', () => {
    const blob = {
      ...emptyGame(),
      characters: { owned: [SKIN.id, 'hero_f', 'ghost', SKIN.id], selected: 'ghost' },
    };
    const game = normalizeGame(blob);
    expect(game?.characters.owned).toEqual([SKIN.id]); // base body + junk dropped, deduped
    expect(game?.characters.selected).toBe('hero_m'); // unplayable -> the default

    const kept = normalizeGame({ ...blob, characters: { owned: [SKIN.id], selected: SKIN.id } });
    expect(kept?.characters.selected).toBe(SKIN.id);
    const free = normalizeGame({ ...blob, characters: { owned: [], selected: 'hero_f' } });
    expect(free?.characters.selected).toBe('hero_f'); // always playable, never "owned"
  });

  it('rebuilds the roster when a state blob arrives without one', () => {
    const store = richStore(SKIN.cost + 10);
    buyCharacter(store, SKIN.id);
    const raw = JSON.parse(JSON.stringify(store.getState())) as Record<string, unknown>;
    (raw['game'] as Record<string, unknown>)['version'] = 4; // pretend it is old
    const migrated = migrateState(raw, NOW);
    expect(migrated.game).toBeNull(); // …and `ensureGameState` replays the log

    const rebuilt = rebuildFromEvents(store.getEvents(), NOW);
    expect(rebuilt.game?.characters.selected).toBe(SKIN.id);
    expect(rebuilt.game?.characters.owned).toEqual([SKIN.id]);
  });
});
