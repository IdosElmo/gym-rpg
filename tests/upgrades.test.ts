/**
 * upgrades.test.ts — the equipment UPGRADE economy (+1 / +2 / +3).
 *
 * Three things are proved here, in this order:
 *
 *   1. THE CURVES. Cost and power both come from `BALANCE.upgrades`, relative to
 *      the item itself, so one rule prices and powers all twelve pieces — and
 *      the two ways to spend a purse (upgrade what you own vs. buy the next
 *      tier) stay comparable per coin. That relationship is PINNED, because it
 *      is the whole design of the feature and a retune must notice it moved.
 *
 *   2. THE REDUCER. An upgrade charges exactly once, converges under a union
 *      merge in either direction, and can never be written without the coins.
 *      The convergence rule is: the event names the level it REACHES
 *      (`toLevel`), the reducer applies it only while the item is BELOW that
 *      level, and charges the event's own `cost` only when it applies — so the
 *      level is a high-water mark and the purse is charged per APPLIED step.
 *
 *   3. THE PLUMBING. Upgraded bonuses flow through `equippedBonus` →
 *      `deriveStats`, so combat and the six body-part skills inherit them for
 *      free; and the whole thing is a pure function of the event log, including
 *      across the v6 → v7 blob bump.
 */
import { describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { buyItem, equipItem, gameOf, onSetCompleted, onWaveCleared, upgradeItem } from '../src/core/game.ts';
import {
  MAX_UPGRADE_LEVEL,
  UPGRADE_LEVELS,
  clampUpgradeLevel,
  nextUpgradeCost,
  upgradeLabel,
  upgradeLevelOf,
  upgradeMultiplier,
  upgradeStars,
  upgradeStepCost,
  upgradeTotalCost,
  upgradedBonus,
} from '../src/core/upgrades.ts';
import {
  applyGameEvent,
  buildUpgrade,
  deriveStats,
  emptyGame,
  equippedBonus,
  rebuildGame,
  statsOfGame,
} from '../src/core/xp.ts';
import {
  EQUIPMENT,
  EQUIPMENT_SLOTS,
  equipmentById,
  equipmentForSlot,
  scaleBonus,
  sumEquipBonus,
  zeroBonus,
  type EquipmentDef,
} from '../src/data/gameContent.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { GAME_STATE_VERSION, type AppEvent } from '../src/storage/DataStore.ts';
import {
  buildExport,
  migrateState,
  normalizeGame,
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
  });
  return store;
}

function item(id: string): EquipmentDef {
  const def = equipmentById(id);
  if (!def) throw new Error(`no item ${id}`);
  return def;
}

/** The item's headline stat — the one number a slot is really about. */
function headline(b: ReturnType<typeof zeroBonus>, def: EquipmentDef): number {
  switch (def.slot) {
    case 'gloves':
      return b.atk;
    case 'belt':
      return b.def;
    case 'shoes':
      return -b.attackIntervalMs;
    case 'cape':
      return b.regen;
  }
}

/* ------------------------------------------------------------- the curves */

describe('the upgrade curves (balance.ts)', () => {
  it('derives every price from the item and the cumulative curve', () => {
    expect(MAX_UPGRADE_LEVEL).toBe(3);
    expect(UPGRADE_LEVELS).toEqual([0, 1, 2, 3]);
    for (const def of EQUIPMENT) {
      expect(upgradeTotalCost(def.cost, 0)).toBe(0);
      expect(upgradeStepCost(def.cost, 0)).toBe(0);
      let sum = 0;
      for (const level of [1, 2, 3]) {
        const share = BALANCE.upgrades.costCurve[level] ?? 0;
        const step = upgradeStepCost(def.cost, level);
        sum += step;
        // the formula, spelled out: total to reach +N is `cost × costCurve[N]`
        expect(upgradeTotalCost(def.cost, level)).toBe(Math.round(def.cost * share));
        // …and the STEPS always add up to it exactly (no drift, by construction)
        expect(sum).toBe(upgradeTotalCost(def.cost, level));
        expect(step).toBeGreaterThan(0);
      }
      // a full +3 is twice the item's price, and each step is more than the last
      expect(sum).toBe(Math.round(def.cost * 2));
      expect(upgradeStepCost(def.cost, 3)).toBeGreaterThan(upgradeStepCost(def.cost, 1));
      // nothing is priced beyond the cap
      expect(upgradeStepCost(def.cost, 4)).toBe(upgradeStepCost(def.cost, 3));
      expect(nextUpgradeCost(def.id, MAX_UPGRADE_LEVEL)).toBe(0);
      expect(nextUpgradeCost(def.id, 0)).toBe(upgradeStepCost(def.cost, 1));
    }
    expect(nextUpgradeCost('not_an_item', 0)).toBe(0);
  });

  it('multiplies the item\'s OWN bonus, and never invents a stat it lacks', () => {
    expect(upgradeMultiplier(0)).toBe(1);
    for (const def of EQUIPMENT) {
      const keys = Object.keys(def.bonus).sort();
      for (const level of UPGRADE_LEVELS) {
        const b = upgradedBonus(def, level);
        expect(Object.keys(b).sort(), `${def.id} @+${level}`).toEqual(keys);
        for (const key of keys as Array<keyof typeof b>) {
          const base = def.bonus[key] ?? 0;
          expect(b[key]).toBeCloseTo(base * upgradeMultiplier(level), 2);
        }
      }
      // monotone: every level is strictly better than the one below it
      const at = (l: number): number => headline(sumEquipBonus([def.id], () => upgradeMultiplier(l)), def);
      expect(at(1)).toBeGreaterThan(at(0));
      expect(at(2)).toBeGreaterThan(at(1));
      expect(at(3)).toBeGreaterThan(at(2));
    }
    expect(scaleBonus({ atk: 3 }, 1)).toEqual({ atk: 3 });
  });

  it('clamps anything a payload, a blob or a click can carry', () => {
    for (const [raw, want] of [
      [0, 0],
      [2, 2],
      [3.9, 3],
      [9, 3],
      [-4, 0],
      [Number.NaN, 0],
      ['2', 0],
      [undefined, 0],
    ] as Array<[unknown, number]>) {
      expect(clampUpgradeLevel(raw), String(raw)).toBe(want);
    }
    expect(upgradeLabel(2)).toBe('+2');
    expect(upgradeLabel(99)).toBe('+3');
    expect(upgradeStars(0)).toBe('');
    expect(upgradeStars(3)).toBe('⭐⭐⭐');
  });

  /**
   * THE PINNED RELATIONSHIP. A fully upgraded tier-1 piece has to be a real
   * alternative to buying the tier above it — not a trap, not a shortcut.
   * It lands BETWEEN the two tiers in power, costs LESS in total than the tier
   * jump, and buys stats at within ±20% of the same rate. If a retune moves
   * either curve, this is the test that should go red.
   */
  it('makes a +3 tier-1 rival a +0 tier-2, in power and in coins per point', () => {
    for (const slot of EQUIPMENT_SLOTS) {
      const [t1, t2] = equipmentForSlot(slot);
      if (!t1 || !t2) throw new Error(`slot ${slot} needs two tiers`);

      const t1Base = headline(sumEquipBonus([t1.id]), t1);
      const t1Max = headline(sumEquipBonus([t1.id], () => upgradeMultiplier(MAX_UPGRADE_LEVEL)), t1);
      const t2Base = headline(sumEquipBonus([t2.id]), t2);

      // strictly between the two tiers…
      expect(t1Max, `${slot}: +3 tier 1 must beat +0 tier 1`).toBeGreaterThan(t1Base);
      expect(t1Max, `${slot}: +3 tier 1 must not eclipse tier 2`).toBeLessThan(t2Base);
      expect(t1Max / t2Base, `${slot}: +3 tier 1 is a real alternative`).toBeGreaterThan(0.6);

      // …for less money than the tier jump…
      const t1Spend = t1.cost + upgradeTotalCost(t1.cost, MAX_UPGRADE_LEVEL);
      expect(t1Spend, `${slot}: the upgrade path is the cheaper one`).toBeLessThan(t2.cost);

      // …at within ±20% of the same coins-per-point rate.
      const ratio = t1Max / t1Spend / (t2Base / t2.cost);
      expect(ratio, `${slot}: value per coin (${ratio.toFixed(2)})`).toBeGreaterThan(0.8);
      expect(ratio, `${slot}: value per coin (${ratio.toFixed(2)})`).toBeLessThan(1.2);
    }
  });
});

/* ------------------------------------------------------------ the reducer */

describe('buying an upgrade', () => {
  it('charges the step once, records the level and reports it', () => {
    const gloves = item('gloves_1');
    const store = richStore(gloves.cost + 1000);
    buyItem(store, gloves.id);
    const before = gameOf(store).battle.coins;

    const res = upgradeItem(store, gloves.id);
    expect(res).toEqual({ ok: true, toLevel: 1, cost: upgradeStepCost(gloves.cost, 1) });
    const game = gameOf(store);
    expect(game.equipment.upgrades).toEqual({ [gloves.id]: 1 });
    expect(game.battle.coins).toBe(before - upgradeStepCost(gloves.cost, 1));

    // …and the ladder climbs one rung at a time, to the cap and no further
    expect(upgradeItem(store, gloves.id).toLevel).toBe(2);
    expect(upgradeItem(store, gloves.id).toLevel).toBe(3);
    expect(upgradeItem(store, gloves.id)).toEqual({ ok: false, error: 'max_level', toLevel: 0, cost: 0 });
    expect(gameOf(store).equipment.upgrades[gloves.id]).toBe(3);
    expect(gameOf(store).battle.coins).toBe(before - upgradeTotalCost(gloves.cost, 3));
    expect(store.getEvents().filter((e) => e.type === 'item_upgraded')).toHaveLength(3);
  });

  it('REFUSES an upgrade the player cannot afford, and writes nothing at all', () => {
    const belt = item('belt_2');
    const store = richStore(belt.cost + upgradeStepCost(belt.cost, 1) - 1);
    buyItem(store, belt.id);
    const coins = gameOf(store).battle.coins;
    const events = store.getEvents().length;

    expect(upgradeItem(store, belt.id)).toEqual({
      ok: false,
      error: 'insufficient_coins',
      toLevel: 0,
      cost: 0,
    });
    expect(gameOf(store).battle.coins).toBe(coins);
    expect(gameOf(store).equipment.upgrades).toEqual({});
    expect(store.getEvents()).toHaveLength(events);
  });

  it('refuses an item that was never bought, and an unknown id', () => {
    const store = richStore(9000);
    expect(upgradeItem(store, 'cape_3').error).toBe('not_owned');
    expect(upgradeItem(store, 'nope').error).toBe('unknown_item');
    expect(store.getEvents().some((e) => e.type === 'item_upgraded')).toBe(false);
  });

  it('plans purely — buildUpgrade never touches the state it reads', () => {
    const game = emptyGame();
    game.battle.coins = 5000;
    game.equipment.owned.push('shoes_1');
    const plan = buildUpgrade(game, 'shoes_1', '2025-05-04', 100);
    expect(plan.ok).toBe(true);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]?.payload).toEqual({
      date: '2025-05-04',
      itemId: 'shoes_1',
      slot: 'shoes',
      toLevel: 1,
      cost: upgradeStepCost(item('shoes_1').cost, 1),
    });
    expect(game.battle.coins).toBe(5000); // untouched
    expect(game.equipment.upgrades).toEqual({});
  });

  it('ignores hand-crafted events: unknown items, bad levels, no free coins back', () => {
    const game = emptyGame();
    game.battle.coins = 100;
    applyGameEvent(game, 'item_upgraded', { itemId: 'ghost', toLevel: 1, cost: 10 });
    applyGameEvent(game, 'item_upgraded', { itemId: 'belt_1', toLevel: 0, cost: 10 });
    applyGameEvent(game, 'item_upgraded', { itemId: 'belt_1', toLevel: -2, cost: 10 });
    expect(game.equipment.upgrades).toEqual({});
    expect(game.battle.coins).toBe(100);

    // a level beyond the cap is clamped rather than stored, and the purse floors
    applyGameEvent(game, 'item_upgraded', { itemId: 'belt_1', toLevel: 99, cost: 9999 });
    expect(game.equipment.upgrades).toEqual({ belt_1: MAX_UPGRADE_LEVEL });
    expect(game.battle.coins).toBe(0);
  });
});

/* -------------------------------------------------------- idempotence */

describe('the high-water-mark rule', () => {
  /** Two events, same meaning, different uuids — what a merge produces. */
  function twin(itemId: string, toLevel: number, cost: number, ts: number, id: string): AppEvent {
    return { id, ts, type: 'item_upgraded', payload: { date: '2025-05-04', itemId, toLevel, cost } };
  }

  it('applies an upgrade to a level already reached exactly ONCE', () => {
    const game = emptyGame();
    game.battle.coins = 1000;
    game.equipment.owned.push('gloves_1');
    const cost = upgradeStepCost(item('gloves_1').cost, 1);

    for (let i = 0; i < 4; i += 1) {
      applyGameEvent(game, 'item_upgraded', { itemId: 'gloves_1', toLevel: 1, cost });
    }
    expect(game.equipment.upgrades['gloves_1']).toBe(1);
    expect(game.battle.coins).toBe(1000 - cost); // charged once, not four times
  });

  it('converges on the same level AND the same purse from any fold order', () => {
    const cost1 = upgradeStepCost(item('belt_1').cost, 1);
    const cost2 = upgradeStepCost(item('belt_1').cost, 2);
    // device A got to +2 offline; device B independently bought its own +1
    const log: AppEvent[] = [
      { id: 'w', ts: 500, type: 'wave_cleared', payload: { world: 1, wave: 1, coins: 1_000 } },
      { id: 'p', ts: 1_000, type: 'coins_spent', payload: { itemId: 'belt_1', slot: 'belt', cost: 0 } },
      twin('belt_1', 1, cost1, 2_000, 'a1'),
      twin('belt_1', 2, cost2, 3_000, 'a2'),
      twin('belt_1', 1, cost1, 2_500, 'b1'),
    ];

    const forward = rebuildGame(log, '2025-05-04');
    const backward = rebuildGame([...log].reverse(), '2025-05-04');
    const shuffled = rebuildGame([log[3]!, log[0]!, log[4]!, log[1]!, log[2]!], '2025-05-04');

    for (const g of [forward, backward, shuffled]) {
      expect(g.equipment.upgrades).toEqual({ belt_1: 2 });
      // B's duplicate +1 is skipped: the purse paid for +1 and +2, once each
      expect(g.battle.coins).toBe(1_000 - cost1 - cost2);
    }
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
  });

  it('never rolls a level BACK when an older step arrives late', () => {
    const game = emptyGame();
    game.battle.coins = 5000;
    game.equipment.owned.push('cape_2');
    applyGameEvent(game, 'item_upgraded', { itemId: 'cape_2', toLevel: 3, cost: 100 });
    const coins = game.battle.coins;
    applyGameEvent(game, 'item_upgraded', { itemId: 'cape_2', toLevel: 1, cost: 100 });
    applyGameEvent(game, 'item_upgraded', { itemId: 'cape_2', toLevel: 2, cost: 100 });
    expect(game.equipment.upgrades['cape_2']).toBe(3);
    expect(game.battle.coins).toBe(coins); // and no coins were taken for them
  });
});

/* ---------------------------------------------------------------- stats */

describe('upgraded gear in the stat sheet', () => {
  it('flows through equippedBonus into deriveStats, and the streak still multiplies it', () => {
    const store = richStore(20_000);
    buyItem(store, 'gloves_3');
    const bare = statsOfGame(gameOf(store));
    upgradeItem(store, 'gloves_3');
    upgradeItem(store, 'gloves_3');
    const geared = statsOfGame(gameOf(store));

    const gloves = item('gloves_3');
    const gain = (gloves.bonus.atk ?? 0) * (upgradeMultiplier(2) - 1);
    expect(geared.atk - bare.atk).toBeCloseTo(gain, 2);
    expect(geared.critChance).toBeGreaterThan(bare.critChance);
    expect(equippedBonus(gameOf(store)).atk).toBeCloseTo((gloves.bonus.atk ?? 0) * upgradeMultiplier(2), 2);

    // the buff multiplies the SUM, so a streak amplifies the upgrade too
    const parts = emptyGame().parts;
    const plain = deriveStats(parts, 3, sumEquipBonus(['gloves_3']));
    const upgraded = deriveStats(parts, 3, sumEquipBonus(['gloves_3'], () => upgradeMultiplier(2)));
    expect(upgraded.atk - plain.atk).toBeCloseTo(gain * 1.3, 2);
  });

  it('pays only for what is WORN — an upgraded item in the drawer is inert', () => {
    const store = richStore(20_000);
    buyItem(store, 'belt_1');
    buyItem(store, 'belt_2'); // buying equips, so belt_1 comes off
    upgradeItem(store, 'belt_1');
    upgradeItem(store, 'belt_1');
    upgradeItem(store, 'belt_1');

    const worn2 = statsOfGame(gameOf(store));
    expect(gameOf(store).equipment.upgrades['belt_1']).toBe(3);
    expect(equippedBonus(gameOf(store)).def).toBeCloseTo(item('belt_2').bonus.def ?? 0, 2);

    // …and it wakes up the moment it is worn, at the level it was left at
    equipItem(store, 'belt', 'belt_1');
    const worn1 = statsOfGame(gameOf(store));
    expect(equippedBonus(gameOf(store)).def).toBeCloseTo(
      (item('belt_1').bonus.def ?? 0) * upgradeMultiplier(3),
      2,
    );
    expect(worn1.def).not.toBe(worn2.def);
  });

  it('keeps the engine floor: even a +3 speed set cannot outrun it', () => {
    const parts = emptyGame().parts;
    for (const p of Object.keys(parts) as Array<keyof typeof parts>) parts[p].level = 99;
    const s = deriveStats(parts, 9, sumEquipBonus(['shoes_3'], () => upgradeMultiplier(3)));
    expect(s.attackIntervalMs).toBeGreaterThanOrEqual(BALANCE.stats.attackIntervalMinMs);
  });
});

/* ---------------------------------------------------------------- replay */

describe('upgrades are a pure function of the log', () => {
  it('rebuildFromEvents reproduces every level and the purse', () => {
    const store = richStore(20_000);
    buyItem(store, 'gloves_1');
    buyItem(store, 'cape_2');
    upgradeItem(store, 'gloves_1');
    upgradeItem(store, 'cape_2');
    upgradeItem(store, 'cape_2');
    equipItem(store, 'gloves', null);

    const live = gameOf(store);
    const replayed = rebuildFromEvents(store.getEvents());
    expect(replayed.game?.equipment).toEqual(live.equipment);
    expect(replayed.game?.equipment.upgrades).toEqual({ gloves_1: 1, cape_2: 2 });
    expect(replayed.game).toEqual(live);
  });

  it('survives a JSON export/import round-trip, stats included', () => {
    const store = richStore(20_000);
    buyItem(store, 'shoes_2');
    upgradeItem(store, 'shoes_2');
    const live = gameOf(store);

    const parsed = parseImport(JSON.stringify(buildExport(store.getState(), store.getEvents(), 1000)));
    expect(parsed?.state.game?.equipment.upgrades).toEqual({ shoes_2: 1 });

    const restored = new LocalStore(fakeStorage());
    restored.replaceAll(parsed!.state, parsed!.events);
    expect(statsOfGame(gameOf(restored))).toEqual(statsOfGame(live));
  });

  it('data_cleared wipes every upgrade with everything else', () => {
    const store = richStore(20_000);
    buyItem(store, 'belt_3');
    upgradeItem(store, 'belt_3');
    upgradeItem(store, 'belt_3');
    expect(gameOf(store).equipment.upgrades['belt_3']).toBe(2);

    store.clear();
    expect(gameOf(store).equipment).toEqual({ owned: [], equipped: {}, upgrades: {} });
    expect(statsOfGame(gameOf(store))).toEqual(statsOfGame(emptyGame()));

    // and a wipe folded from the LOG says the same thing
    const wiped = rebuildGame(
      [
        { id: 'a', ts: 1, type: 'coins_spent', payload: { itemId: 'belt_3', slot: 'belt', cost: 0 } },
        { id: 'b', ts: 2, type: 'item_upgraded', payload: { itemId: 'belt_3', toLevel: 2, cost: 0 } },
        { id: 'c', ts: 3, type: 'data_cleared', payload: {} },
      ],
      '2025-05-04',
    );
    expect(wiped.equipment.upgrades).toEqual({});
  });
});

/* --------------------------------------------------------- the v7 blob */

describe('the v6 -> v7 blob bump', () => {
  it('reports the current version and starts with an empty upgrade ledger', () => {
    expect(GAME_STATE_VERSION).toBe(9);
    expect(emptyGame().equipment).toEqual({ owned: [], equipped: {}, upgrades: {} });
  });

  it('rejects a v6 blob so the levels are replayed rather than invented', () => {
    // A v6 blob has no `upgrades` field at all. Defaulting it to `{}` would
    // silently ERASE levels that are sitting in the log — so the blob is
    // rejected, and `ensureGameState` rebuilds from the log instead.
    const old = { ...emptyGame(), version: 6 } as unknown as Record<string, unknown>;
    delete (old['equipment'] as Record<string, unknown>)['upgrades'];
    expect(normalizeGame(old)).toBeNull();
  });

  it('replays a v6 save\'s log and lands on exactly the same character', () => {
    const store = richStore(20_000);
    buyItem(store, 'cape_3');
    upgradeItem(store, 'cape_3');
    upgradeItem(store, 'cape_3');
    const live = gameOf(store);

    // the save as a v6 build would have persisted it: right log, stale blob
    const raw = JSON.parse(JSON.stringify(store.getState())) as Record<string, unknown>;
    const blob = raw['game'] as Record<string, unknown>;
    blob['version'] = 6;
    delete (blob['equipment'] as Record<string, unknown>)['upgrades'];
    expect(migrateState(raw).game).toBeNull(); // …so it is rebuilt

    const rebuilt = rebuildFromEvents(store.getEvents());
    expect(rebuilt.game?.version).toBe(GAME_STATE_VERSION);
    expect(rebuilt.game?.equipment.upgrades).toEqual({ cape_3: 2 });
    expect(statsOfGame(rebuilt.game!)).toEqual(statsOfGame(live));
  });

  it('drops levels on ids the roster lost, and clamps a hand-edited blob', () => {
    const store = richStore(20_000);
    buyItem(store, 'belt_1');
    upgradeItem(store, 'belt_1');
    const raw = JSON.parse(JSON.stringify(store.getState())) as {
      game: { equipment: Record<string, unknown> };
    };
    raw.game.equipment['upgrades'] = { belt_1: 9, ghost_item: 2, gloves_1: 0, cape_1: -3 };

    const migrated = migrateState(JSON.stringify(raw));
    expect(migrated.game?.equipment.upgrades).toEqual({ belt_1: MAX_UPGRADE_LEVEL });
    expect(upgradeLevelOf(migrated.game!.equipment, 'ghost_item')).toBe(0);
  });
});
