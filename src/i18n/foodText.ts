/**
 * i18n/foodText.ts — the food catalog's names in the reader's language.
 *
 * data/foods.ts is Hebrew (and pinned by tests/catalog.test.ts); English lives
 * beside it in `content/foods.en.ts`, keyed by the stable food / unit / meal
 * ids. Everything the screen renders FROM THE CATALOG goes through here: the
 * pick list, the unit picker, the live price preview.
 *
 * What a logged meal stored — its name and its priced lines, frozen into the
 * `meal_logged` payload — is user data and stays as stored. But a CATALOG
 * pick also stored its ids (entry, unit, quantity), so an English reader can
 * see it named from them (`loggedMealName`, `loggedLines`) — only while the
 * stored name is still the catalog's own Hebrew name for that pick; a renamed
 * saved meal ("הארוחות שלי") or a changed catalog falls back to the stored text.
 */

import { catalogEntry, catalogName, fmtQty, priceCatalog, unitsOf, type CatalogNames } from '../core/catalog.ts';
import type { CatalogEntry, CatalogFood, CatalogMeal, FoodUnit } from '../data/foods.ts';
import type { MealAiItem, MealCatalogInfo, MealTemplatePick } from '../storage/DataStore.ts';
import { FOODS_EN, MEALS_EN, PORTION_EN } from './content/foods.en.ts';
import { locale } from './locale.ts';

const en = (): boolean => locale() === 'en';

export function foodName(food: CatalogFood): string {
  return (en() && FOODS_EN[food.id]?.name) || food.name;
}

export function mealName(meal: CatalogMeal): string {
  return (en() && MEALS_EN[meal.id]) || meal.name;
}

/** A catalog entry's name, food or fixed meal. */
export function entryName(entry: CatalogEntry): string {
  return entry.kind === 'meal' ? mealName(entry) : foodName(entry);
}

/**
 * A unit's label for the entry it belongs to: unit ids repeat across foods
 * with different labels ("unit" is a "pc" of apple, a "medium" sweet potato),
 * so the food is part of the key. A fixed meal's one unit is the portion.
 */
export function unitLabel(entry: CatalogEntry, unit: FoodUnit): string {
  if (!en()) return unit.label;
  if (entry.kind === 'meal') return PORTION_EN;
  return FOODS_EN[entry.id]?.units[unit.id] || unit.label;
}

/** The names `priceCatalog` puts on its lines, for a breakdown rendered live from the catalog. */
export const displayNames: CatalogNames = {
  food: (f) => foodName(f),
  unit: (f, u) => unitLabel(f, u),
};

/** A pick's name in the reader's language — `catalogName` (the stored Hebrew) re-said through the overlay. */
export function pickName(entry: CatalogEntry, unit: FoodUnit, qty: number): string {
  if (!en()) return catalogName(entry, unit, qty);
  if (entry.kind === 'meal') {
    if (qty === 1) return mealName(entry);
    return `${fmtQty(qty)} ${qty <= 1 ? PORTION_EN : `${PORTION_EN}s`} · ${mealName(entry)}`;
  }
  return `${fmtQty(qty)} ${unitLabel(entry, unit)} ${foodName(entry)}`;
}

/**
 * The name to SHOW for something that stored a pick and a name (a logged
 * catalog meal, a saved meal): in English, re-said from the pick's ids while
 * the stored name is still the catalog's own Hebrew one; otherwise as stored.
 */
export function storedPickName(stored: string, pick: Pick<MealTemplatePick, 'id' | 'unit' | 'qty'> | undefined): string {
  if (!en() || !pick) return stored;
  const entry = catalogEntry(pick.id);
  const unit = entry ? unitsOf(entry).find((u) => u.id === pick.unit) : undefined;
  if (!entry || !unit || catalogName(entry, unit, pick.qty) !== stored) return stored;
  return pickName(entry, unit, pick.qty);
}

/** A logged meal's name in the reader's language (see `storedPickName`). */
export function loggedMealName(meal: { name: string; catalog?: MealCatalogInfo }): string {
  return storedPickName(meal.name, meal.catalog);
}

/**
 * A logged catalog meal's breakdown lines: the STORED numbers always, with the
 * names / quantities re-said in English when the pick still prices to the
 * same lines (same count, same foods); otherwise the stored lines as they are.
 */
export function loggedLines(cat: MealCatalogInfo): MealAiItem[] {
  if (!en()) return cat.lines;
  const he = priceCatalog(cat.id, cat.unit, cat.qty);
  const shown = priceCatalog(cat.id, cat.unit, cat.qty, displayNames);
  if (!he || !shown || he.lines.length !== cat.lines.length) return cat.lines;
  return cat.lines.map((line, i) => {
    const h = he.lines[i];
    const s = shown.lines[i];
    if (!h || !s || h.name !== line.name || h.quantity !== line.quantity) return line;
    return { ...line, name: s.name, quantity: s.quantity };
  });
}
