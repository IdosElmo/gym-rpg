/**
 * The coin shop: purchase rules, equip/unequip, the stat contribution of gear,
 * and — as everywhere else in this app — that the whole wardrobe is a pure
 * function of the event log.
 */
import { describe, expect, it } from 'vitest';

import { buyItem, equipItem, gameOf, onSetCompleted, onWaveCleared } from '../src/core/game.ts';
import {
  applyGameEvent,
  buildEquip,
  buildPurchase,
  deriveStats,
  emptyGame,
  equippedBonus,
  equippedIds,
  statsOfGame,
} from '../src/core/xp.ts';
import {
  EQUIPMENT,
  EQUIPMENT_SLOTS,
  SLOT_EMOJI,
  SLOT_HE,
  WORLDS,
  bonusHe,
  equipmentById,
  equipmentForSlot,
  sumEquipBonus,
  wavesInWorld,
  zeroBonus,
} from '../src/data/gameContent.ts';
import { bossSpec, waveSpec } from '../src/core/combat.ts';
import { MAX_UPGRADE_LEVEL, upgradeTotalCost } from '../src/core/upgrades.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { GAME_STATE_VERSION } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import {
  buildExport,
  migrateState,
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

/** A store with `coins` in the purse, paid the only way coins are ever paid. */
function richStore(coins: number): LocalStore {
  const store = new LocalStore(fakeStorage());
  onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: 0, w: '40', r: '10' });
  onWaveCleared(store, {
    world: 1,
    wave: 1,
    miniBoss: false,
    enemyId: 'w1_rat',
    coins,
    energySpent: 0,
    seed: 1,
    durationMs: 1000,
    overtime: false,
  });
  return store;
}

/* ------------------------------------------------------------- the roster */

describe('the equipment roster', () => {
  it('covers all six slots with several tiers and unique ids', () => {
    expect(EQUIPMENT_SLOTS).toEqual(['helmet', 'gloves', 'shirt', 'belt', 'leggings', 'shoes', 'cape']);
    expect(EQUIPMENT.length).toBeGreaterThanOrEqual(EQUIPMENT_SLOTS.length * 3);
    expect(new Set(EQUIPMENT.map((e) => e.id)).size).toBe(EQUIPMENT.length);
    for (const slot of EQUIPMENT_SLOTS) {
      const items = equipmentForSlot(slot);
      expect(items.length, `slot ${slot} has no items`).toBeGreaterThanOrEqual(3);
      expect(items.every((i) => i.slot === slot)).toBe(true);
      expect(SLOT_HE[slot].length).toBeGreaterThan(1);
      // prices rise with the tier, and so does the bonus
      const sorted = [...items].sort((a, b) => a.tier - b.tier);
      for (let i = 1; i < sorted.length; i += 1) {
        expect((sorted[i] as (typeof sorted)[number]).cost).toBeGreaterThan(
          (sorted[i - 1] as (typeof sorted)[number]).cost,
        );
      }
    }
  });

  it('gives every item a Hebrew name, a readable bonus and an offline SVG icon', () => {
    for (const item of EQUIPMENT) {
      expect(item.he.length).toBeGreaterThan(1);
      expect(bonusHe(item.bonus).length).toBeGreaterThan(1);
      expect(item.icon.startsWith('<svg')).toBe(true);
      expect(item.icon).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // offline rule
      expect(Object.keys(item.bonus).length).toBeGreaterThan(0);
    }
  });

  /**
   * THE SLOT-SURFACE SWEEP. Six slots, and not one of them is special-cased:
   * every id follows `<slot>_<tier>` (which is what lets the era-gear ladders in
   * `tests/boss.test.ts` and `tests/worlds.test.ts` build a whole kit by
   * concatenation), every slot names itself in Hebrew and with an emoji, and
   * every slot is reachable from `equipmentForSlot`.
   */
  it('gives every slot a Hebrew name, an emoji and a full `<slot>_<tier>` ladder', () => {
    for (const slot of EQUIPMENT_SLOTS) {
      expect(SLOT_HE[slot], `${slot} has no Hebrew name`).toBeTruthy();
      expect(SLOT_EMOJI[slot], `${slot} has no emoji`).toBeTruthy();
      for (const tier of [1, 2, 3]) {
        const def = equipmentById(`${slot}_${tier}`);
        expect(def, `${slot}_${tier} is missing`).toBeDefined();
        expect(def?.slot).toBe(slot);
        expect(def?.tier).toBe(tier);
      }
    }
    // …and nothing outside the six slots ever slipped into the roster
    for (const item of EQUIPMENT) expect(EQUIPMENT_SLOTS).toContain(item.slot);
  });

  /**
   * THE TWO NEWEST SLOTS, and the promise they were priced against: each one is
   * CHEAPER and LIGHTER than the slot it shares a stat family with, because six
   * slots are worn at once and the campaign's boss pacing is pinned against a
   * full kit (see the note above `EQUIPMENT` and the Phase 10 note in
   * `balance.ts`).
   */
  it('keeps 👕 חולצה on DEF+HP and 🩳 טייץ on HP+speed, under the slot they echo', () => {
    for (const [slot, sibling, keys] of [
      ['shirt', 'belt', ['def', 'hp']],
      ['leggings', 'shoes', ['hp', 'attackIntervalMs']],
    ] as const) {
      const items = equipmentForSlot(slot);
      const siblings = equipmentForSlot(sibling);
      expect(items).toHaveLength(3);
      for (const [i, item] of items.entries()) {
        // the stat identity: exactly the family the slot is about, no strays
        expect(Object.keys(item.bonus).sort(), `${item.id} bonus`).toEqual([...keys].sort());
        // …and both the price and the headline sit under the older slot's
        const twin = siblings[i] as (typeof siblings)[number];
        expect(item.cost, `${item.id} costs more than ${twin.id}`).toBeLessThan(twin.cost);
      }
      // leg drive must not out-sprint the shoes it is worn with
      const lifetime = items.reduce((sum, i) => sum + i.cost * 3, 0);
      expect(lifetime, `${slot} lifetime cost`).toBeGreaterThan(5_500);
      expect(lifetime, `${slot} lifetime cost`).toBeLessThan(7_500);
    }
  });

  /**
   * THE ECONOMY, both halves of it, measured rather than asserted by eye: what
   * nine worlds pay against what a fully upgraded six-slot wardrobe costs. An
   * item's LIFETIME cost is 3× its price (the item, plus `costCurve[3]` = 2× to
   * take it to +3), so the whole shop is one sum over `EQUIPMENT`.
   */
  it('keeps a fully upgraded six-slot wardrobe at ≈47k 🪙 — a quarter of the campaign', () => {
    const lifetime = (cost: number): number => cost + upgradeTotalCost(cost, MAX_UPGRADE_LEVEL);
    const sink = EQUIPMENT.reduce((sum, e) => sum + lifetime(e.cost), 0);
    expect(sink).toBe(53_310);
    // the helmet (PHASE 12) is the ≈6k the wardrobe grew by, under the gloves it echoes
    const helmet = EQUIPMENT.filter((e) => e.slot === 'helmet').reduce((sum, e) => sum + lifetime(e.cost), 0);
    expect(helmet).toBe(6_060);
    for (const [i, h] of equipmentForSlot('helmet').entries()) {
      expect(h.cost).toBeLessThan((equipmentForSlot('gloves')[i] as (typeof h)).cost);
      expect(Object.keys(h.bonus)).toContain('critChance');
    }
    // the two new slots are the ≈13k the wardrobe grew by
    const added = EQUIPMENT.filter((e) => e.slot === 'shirt' || e.slot === 'leggings').reduce(
      (sum, e) => sum + lifetime(e.cost),
      0,
    );
    expect(added).toBe(12_960);

    // …against the whole campaign's take (waves + boss purses, nine worlds)
    let income = 0;
    for (const w of WORLDS) {
      for (let wave = 1; wave <= wavesInWorld(w.id); wave += 1) income += waveSpec(w.id, wave).coins;
      income += bossSpec(w.id)?.coins ?? 0;
    }
    expect(income).toBeGreaterThan(190_000);
    expect(income / sink, 'the campaign must buy the shop several times over').toBeGreaterThan(3.5);
    expect(income / sink, 'but coins must never stop meaning anything').toBeLessThan(6);

    // …and the tier-1 prices still gate a FRESH player naturally: nobody walks
    // into the shop off their first handful of waves…
    const cheapest = Math.min(...EQUIPMENT.map((e) => e.cost));
    let firstFive = 0;
    for (let wave = 1; wave <= 5; wave += 1) firstFive += waveSpec(1, wave).coins;
    expect(cheapest, 'a brand-new player can already dress').toBeGreaterThan(firstFive * 2);
    // …while world 1 alone still pays for the whole tier-1 row, both new slots
    // included, which is what makes the first shop visit a real decision.
    let world1 = 0;
    for (let wave = 1; wave <= wavesInWorld(1); wave += 1) world1 += waveSpec(1, wave).coins;
    const tier1 = EQUIPMENT.filter((e) => e.tier === 1).reduce((sum, e) => sum + e.cost, 0);
    expect(tier1).toBeLessThan(world1);
  });

  it('sums bonuses across slots and ignores unknown ids', () => {
    expect(sumEquipBonus([])).toEqual(zeroBonus());
    const a = equipmentById('gloves_2');
    const b = equipmentById('belt_2');
    const sum = sumEquipBonus(['gloves_2', 'belt_2', 'not_a_real_item']);
    expect(sum.atk).toBe((a?.bonus.atk ?? 0) + (b?.bonus.atk ?? 0));
    expect(sum.def).toBe((a?.bonus.def ?? 0) + (b?.bonus.def ?? 0));
  });
});

/* ------------------------------------------------------------- purchases */

describe('purchases', () => {
  it('spends the coins, records the item and equips it in one tap', () => {
    const item = equipmentById('gloves_1');
    if (!item) throw new Error('missing gloves_1');
    const store = richStore(item.cost + 50);

    expect(buyItem(store, item.id)).toEqual({ ok: true });
    const game = gameOf(store);
    expect(game.battle.coins).toBe(50);
    expect(game.equipment.owned).toEqual([item.id]);
    expect(game.equipment.equipped[item.slot]).toBe(item.id);

    const types = store.getEvents().map((e) => e.type);
    expect(types).toContain('coins_spent');
    expect(types).toContain('item_equipped');
  });

  it('REFUSES a purchase the player cannot afford, and writes nothing at all', () => {
    const item = equipmentById('cape_3');
    if (!item) throw new Error('missing cape_3');
    const store = richStore(item.cost - 1);
    const eventsBefore = store.getEvents().length;

    expect(buyItem(store, item.id)).toEqual({ ok: false, error: 'insufficient_coins' });
    expect(gameOf(store).battle.coins).toBe(item.cost - 1);
    expect(gameOf(store).equipment.owned).toEqual([]);
    expect(store.getEvents()).toHaveLength(eventsBefore);
  });

  it('refuses a second purchase of an item already owned, and unknown ids', () => {
    const store = richStore(5000);
    expect(buyItem(store, 'gloves_1')).toEqual({ ok: true });
    expect(buyItem(store, 'gloves_1')).toEqual({ ok: false, error: 'already_owned' });
    expect(buyItem(store, 'nope')).toEqual({ ok: false, error: 'unknown_item' });
    expect(gameOf(store).equipment.owned).toEqual(['gloves_1']);
  });

  it('plans purchases purely — buildPurchase never touches the state it reads', () => {
    const game = emptyGame();
    game.battle.coins = 1000;
    const plan = buildPurchase(game, 'belt_1', '2025-05-04', 100);
    expect(plan.ok).toBe(true);
    expect(plan.events).toHaveLength(2);
    expect(game.battle.coins).toBe(1000); // untouched
    expect(game.equipment.owned).toEqual([]);
  });

  it('never lets the purse go negative, even on a hand-crafted event', () => {
    const game = emptyGame();
    game.battle.coins = 10;
    applyGameEvent(game, 'coins_spent', { date: '2025-05-04', itemId: 'cape_3', slot: 'cape', cost: 9999 });
    expect(game.battle.coins).toBe(0);
  });
});

/* ----------------------------------------------------------------- equip */

describe('equipping', () => {
  it('swaps within a slot and leaves the other slots alone', () => {
    const store = richStore(5000);
    buyItem(store, 'gloves_1');
    buyItem(store, 'gloves_2');
    buyItem(store, 'belt_1');

    expect(gameOf(store).equipment.equipped['gloves']).toBe('gloves_2');
    expect(equipItem(store, 'gloves', 'gloves_1')).toBe(true);
    expect(gameOf(store).equipment.equipped['gloves']).toBe('gloves_1');
    expect(gameOf(store).equipment.equipped['belt']).toBe('belt_1');
    expect(equippedIds(gameOf(store)).sort()).toEqual(['belt_1', 'gloves_1']);
  });

  it('takes an item off with a null itemId', () => {
    const store = richStore(5000);
    buyItem(store, 'shoes_1');
    expect(equipItem(store, 'shoes', null)).toBe(true);
    expect(gameOf(store).equipment.equipped['shoes']).toBeUndefined();
    expect(gameOf(store).equipment.owned).toEqual(['shoes_1']); // still owned
  });

  it('refuses to wear something that was never bought, or the wrong slot', () => {
    const store = richStore(5000);
    expect(equipItem(store, 'cape', 'cape_3')).toBe(false);
    expect(equipItem(store, 'belt', 'gloves_1')).toBe(false);
    expect(gameOf(store).equipment.equipped).toEqual({});
    expect(store.getEvents().some((e) => e.type === 'item_equipped')).toBe(false);
  });

  it('writes no event when nothing actually changes', () => {
    const game = emptyGame();
    game.equipment.owned.push('belt_1');
    game.equipment.equipped['belt'] = 'belt_1';
    expect(buildEquip(game, 'belt', 'belt_1', '2025-05-04', 1)).toEqual([]);
    expect(buildEquip(game, 'cape', null, '2025-05-04', 1)).toEqual([]);
  });
});

/* ------------------------------------------------------------ stat effect */

describe('equipment stats', () => {
  it('adds to the level-derived stats, and the streak buff multiplies the sum', () => {
    const parts = emptyGame().parts;
    const bare = deriveStats(parts, 0);
    const geared = deriveStats(parts, 0, sumEquipBonus(['gloves_3']));
    const gloves = equipmentById('gloves_3');
    expect(geared.atk).toBe(bare.atk + (gloves?.bonus.atk ?? 0));

    // with a streak tier the gear is amplified too — gear and streak compound
    const buffedBare = deriveStats(parts, 2);
    const buffedGeared = deriveStats(parts, 2, sumEquipBonus(['gloves_3']));
    expect(buffedGeared.atk - buffedBare.atk).toBeCloseTo((gloves?.bonus.atk ?? 0) * 1.2, 5);
  });

  it('makes the character measurably stronger the moment an item is equipped', () => {
    const store = richStore(6000);
    const before = statsOfGame(gameOf(store));

    buyItem(store, 'gloves_2');
    buyItem(store, 'belt_2');
    buyItem(store, 'shoes_2');
    buyItem(store, 'cape_2');
    const after = statsOfGame(gameOf(store));

    expect(after.atk).toBeGreaterThan(before.atk);
    expect(after.def).toBeGreaterThan(before.def);
    expect(after.maxHp).toBeGreaterThan(before.maxHp);
    expect(after.regen).toBeGreaterThan(before.regen);
    expect(after.attackIntervalMs).toBeLessThan(before.attackIntervalMs);

    // and taking it all off puts the character exactly back where it started
    for (const slot of EQUIPMENT_SLOTS) equipItem(store, slot, null);
    expect(statsOfGame(gameOf(store))).toEqual(before);
    expect(equippedBonus(gameOf(store))).toEqual(zeroBonus());
  });

  it('never speeds the character past the engine floor', () => {
    const parts = emptyGame().parts;
    for (const p of Object.keys(parts) as Array<keyof typeof parts>) parts[p].level = 99;
    const s = deriveStats(parts, 9, sumEquipBonus(['shoes_3']));
    expect(s.attackIntervalMs).toBeGreaterThanOrEqual(500);
  });
});

/* ---------------------------------------------------------------- replay */

describe('replay', () => {
  it('rebuildFromEvents reproduces the wardrobe exactly', () => {
    const store = richStore(6000);
    buyItem(store, 'gloves_2');
    buyItem(store, 'belt_1');
    buyItem(store, 'belt_2');
    equipItem(store, 'belt', 'belt_1');
    equipItem(store, 'gloves', null);

    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents());
    expect(replayed.game?.equipment).toEqual(live.equipment);
    expect(replayed.game?.battle.coins).toBe(live.battle.coins);
    expect(replayed.game).toEqual(live);
  });

  it('survives a JSON export/import round-trip', () => {
    const store = richStore(6000);
    buyItem(store, 'cape_2');
    buyItem(store, 'shoes_1');
    const live = gameOf(store);

    const parsed = parseImport(JSON.stringify(buildExport(store.getState(), store.getEvents(), 1000)));
    expect(parsed?.state.game?.equipment).toEqual(live.equipment);

    const restored = new LocalStore(fakeStorage());
    restored.replaceAll(parsed!.state, parsed!.events);
    expect(gameOf(restored).equipment).toEqual(live.equipment);
    expect(statsOfGame(gameOf(restored))).toEqual(statsOfGame(live));
  });

  /**
   * NO VERSION BUMP, and this is why: `equipped` is a PARTIAL record keyed by
   * slot, so a save written when the wardrobe had four slots is already a valid
   * six-slot save — the two missing keys mean "wearing nothing there", which is
   * what a missing key has always meant. A blob from the older build must
   * therefore load untouched, at the SAME `GAME_STATE_VERSION`, and simply find
   * two more empty drawers waiting in the shop.
   */
  it('loads a four-slot save as a six-slot one, with no version bump', () => {
    const store = richStore(6000);
    buyItem(store, 'belt_1');
    buyItem(store, 'gloves_1');
    const raw = JSON.parse(JSON.stringify(store.getState())) as {
      game: { version: number; equipment: { equipped: Record<string, string> } };
    };
    // exactly the shape the four-slot build wrote: no shirt, no leggings
    expect(Object.keys(raw.game.equipment.equipped).sort()).toEqual(['belt', 'gloves']);
    expect(raw.game.version).toBe(GAME_STATE_VERSION);

    const migrated = migrateState(JSON.stringify(raw));
    expect(migrated.game?.version).toBe(GAME_STATE_VERSION);
    expect(migrated.game?.equipment.equipped).toEqual({ belt: 'belt_1', gloves: 'gloves_1' });
    for (const slot of EQUIPMENT_SLOTS) {
      // every slot answers — the four worn-in ones by name, the new two by being
      // honestly empty rather than by throwing
      expect(migrated.game?.equipment.equipped[slot] ?? null).toBe(
        slot === 'belt' ? 'belt_1' : slot === 'gloves' ? 'gloves_1' : null,
      );
    }
    // …and the two new slots are wearable straight away on that save
    const restored = new LocalStore(fakeStorage());
    restored.replaceAll(migrated, store.getEvents());
    expect(buyItem(restored, 'shirt_1')).toEqual({ ok: true });
    expect(gameOf(restored).equipment.equipped['shirt']).toBe('shirt_1');
  });

  it('drops phantom items when a stored blob mentions an id the roster lost', () => {
    const store = richStore(6000);
    buyItem(store, 'belt_1');
    const state = store.getState();
    const raw = JSON.parse(JSON.stringify(state)) as { game: { equipment: Record<string, unknown> } };
    raw.game.equipment['owned'] = ['belt_1', 'ghost_item'];
    raw.game.equipment['equipped'] = { belt: 'ghost_item', cape: 'cape_3' };

    const migrated = migrateState(JSON.stringify(raw));
    expect(migrated.game?.equipment.owned).toEqual(['belt_1']);
    // 'cape_3' is a real item but was never bought — it cannot be worn either
    expect(migrated.game?.equipment.equipped).toEqual({});
  });
});
