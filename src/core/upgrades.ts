/**
 * core/upgrades.ts — the equipment UPGRADE economy.
 *
 * The shop sells three TIERS per slot as separate items; an upgrade is the other
 * axis: +1/+2/+3 bought with coins on an item you already own, multiplying that
 * item's own bonus and adding flair to the drawing.
 *
 * Everything here is PURE arithmetic over two curves in `BALANCE.upgrades`, both
 * expressed relative to the item itself:
 *
 *   cost to REACH +N  = `item.cost × costCurve[N]`   (60% / 120% / 200%)
 *   bonus at +N       = `item.bonus × statCurve[N]`  (×1.25 / ×1.5 / ×1.8)
 *
 * One rule prices and powers all twelve items, so adding a thirteenth needs no
 * new numbers — and retuning the economy is one edit in `balance.ts`.
 *
 * WHY A RELATIVE CURVE. It keeps the two ways to spend a purse comparable per
 * coin (a tier jump is ≈2.5–3× the bonus for ≈4× the price; a full +3 is 1.8×
 * the bonus for 2× the price) while making them feel different: the tier ladder
 * is a big saved-up jump, the upgrade ladder is small affordable steps on gear
 * you already like. It also makes a +3 on a tier‑3 item an endgame coin sink
 * without a single bespoke number.
 *
 * The LEVEL itself is not stored here — it lives in `GameState.equipment.upgrades`
 * and is folded from `item_upgraded` events like everything else.
 */

import {
  equipmentById,
  scaleBonus,
  type EquipBonus,
  type EquipmentDef,
} from '../data/gameContent.ts';
import type { EquipmentState } from '../storage/DataStore.ts';
import { BALANCE } from './balance.ts';

/** The highest upgrade level any item can reach (+3). */
export const MAX_UPGRADE_LEVEL: number = BALANCE.upgrades.maxLevel;

/** Every legal upgrade level, `[0, 1, 2, 3]` — the sweeps iterate this. */
export const UPGRADE_LEVELS: readonly number[] = Array.from({ length: MAX_UPGRADE_LEVEL + 1 }, (_, i) => i);

/** Clamp anything (a payload number, a stored blob, a click) into 0…max. */
export function clampUpgradeLevel(level: unknown): number {
  const n = typeof level === 'number' && Number.isFinite(level) ? Math.floor(level) : 0;
  return n < 0 ? 0 : n > MAX_UPGRADE_LEVEL ? MAX_UPGRADE_LEVEL : n;
}

/** Multiplier applied to an item's OWN bonus at `level` (1 at +0). */
export function upgradeMultiplier(level: number): number {
  return BALANCE.upgrades.statCurve[clampUpgradeLevel(level)] ?? 1;
}

/** Total coins spent to reach `level` from +0 — the cumulative curve. */
export function upgradeTotalCost(baseCost: number, level: number): number {
  const share = BALANCE.upgrades.costCurve[clampUpgradeLevel(level)] ?? 0;
  return Math.round(Math.max(0, baseCost) * share);
}

/**
 * Price of the ONE step `level − 1 → level`, 0 outside 1…max.
 *
 * Derived from the cumulative curve rather than listed separately, so the two
 * can never drift: the sum of the steps IS the total, by construction.
 */
export function upgradeStepCost(baseCost: number, level: number): number {
  const l = clampUpgradeLevel(level);
  if (l < 1) return 0;
  return upgradeTotalCost(baseCost, l) - upgradeTotalCost(baseCost, l - 1);
}

/** The stored upgrade level of one item (0 when it has none, or is unknown). */
export function upgradeLevelOf(equipment: Pick<EquipmentState, 'upgrades'>, itemId: string): number {
  return clampUpgradeLevel(equipment.upgrades[itemId]);
}

/** An item's bonus AT a level — what the stat grid and the battle engine see. */
export function upgradedBonus(def: EquipmentDef, level: number): EquipBonus {
  return scaleBonus(def.bonus, upgradeMultiplier(level));
}

/** Price of the next step for an item, or 0 when it is already maxed/unknown. */
export function nextUpgradeCost(itemId: string, currentLevel: number): number {
  const def = equipmentById(itemId);
  if (!def) return 0;
  const next = clampUpgradeLevel(currentLevel) + 1;
  if (next > MAX_UPGRADE_LEVEL) return 0;
  return upgradeStepCost(def.cost, next);
}

/** `'+2'` — the badge every card, feed line and drawing labels a level with. */
export function upgradeLabel(level: number): string {
  return `+${clampUpgradeLevel(level)}`;
}

/** `'⭐⭐'` — the same level, as stars. Empty at +0. */
export function upgradeStars(level: number): string {
  return '⭐'.repeat(clampUpgradeLevel(level));
}
