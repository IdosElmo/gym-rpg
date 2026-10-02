/**
 * i18n/foodText.ts — the food catalog's names in the reader's language.
 *
 * data/foods.ts is Hebrew (and pinned by tests/catalog.test.ts); English lives
 * beside it in `content/foods.en.ts`, keyed by the stable food / unit / meal
 * ids. Everything the screen renders FROM THE CATALOG goes through here: the
 * pick list, the unit picker, the live price preview.
 *
 * What a logged meal stored — its name and its priced lines, frozen into the
 * `meal_logged` payload — is user data and is shown as stored; this module is
 * never applied to it.
 */

import type { CatalogNames } from '../core/catalog.ts';
import type { CatalogEntry, CatalogFood, CatalogMeal, FoodUnit } from '../data/foods.ts';
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
