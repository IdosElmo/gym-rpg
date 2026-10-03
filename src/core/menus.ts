/**
 * core/menus.ts — "תפריט לדוגמה": which sample day to show, and what it adds up to.
 *
 * The menus are data (data/foods.ts `DAILY_MENUS`): a calorie level and one
 * ready meal per meal of the day. This module only CHOOSES and PRICES — the
 * menu closest to the user's calorie target, and each item's numbers from
 * the catalog (`priceCatalog`), so a menu's total is always the sum of what
 * one tap on each of its meals would log. Pure: no store, no clock, no locale.
 */

import { DAILY_MENUS, type DailyMenu, type MenuItem } from '../data/foods.ts';
import { PORTION, priceCatalog, type CatalogPrice } from './catalog.ts';

/** The level shown before any calorie target is set — a middle-of-the-road day. */
export const DEFAULT_MENU_KCAL = 1800;

export function menuById(id: string, menus: readonly DailyMenu[] = DAILY_MENUS): DailyMenu | null {
  return menus.find((m) => m.id === id) ?? null;
}

/**
 * The menu closest to `target` kcal (no target: `DEFAULT_MENU_KCAL`), among
 * the vegetarian menus or the others. A tie goes to the LOWER level — a
 * sample day that undershoots is the safer suggestion.
 */
export function menuFor(
  target: number | null,
  vegetarian = false,
  menus: readonly DailyMenu[] = DAILY_MENUS,
): DailyMenu | null {
  const want = target !== null && target > 0 ? target : DEFAULT_MENU_KCAL;
  const pool = menus.filter((m) => (m.vegetarian === true) === vegetarian);
  let best: DailyMenu | null = null;
  for (const m of pool) {
    if (!best) {
      best = m;
      continue;
    }
    const d = Math.abs(m.kcal - want);
    const bd = Math.abs(best.kcal - want);
    if (d < bd || (d === bd && m.kcal < best.kcal)) best = m;
  }
  return best;
}

/** One item of a menu with its price (one portion of its ready meal), or `null` if it does not price. */
export function priceItem(item: MenuItem): CatalogPrice | null {
  return priceCatalog(item.meal, PORTION.id, 1);
}

export interface MenuTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** A menu's day: the sum of its items' (rounded) prices — exactly what logging every item adds. */
export function menuTotals(menu: DailyMenu): MenuTotals {
  const t: MenuTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const it of menu.items) {
    const p = priceItem(it);
    if (!p) continue;
    t.calories += p.calories;
    t.protein += p.protein;
    t.carbs += p.carbs;
    t.fat += p.fat;
  }
  return t;
}
