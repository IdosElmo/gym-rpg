/**
 * i18n/content/foods.en.ts — the English overlay of data/foods.ts.
 *
 * Keyed by the catalog's STABLE ids (food id → its name and its units by unit
 * id; fixed-meal id → its name). data/foods.ts stays Hebrew and untouched —
 * tests/catalog.test.ts pins it. Read through `i18n/foodText.ts`, never
 * directly; a missing entry falls back to the Hebrew original.
 *
 * Display only: a logged pick freezes its (Hebrew) name and priced lines into
 * its `meal_logged` payload, and that stored text is shown as stored.
 * Unit labels read after a number ("½ cup", "2 pc"), like the Hebrew ones.
 */

export interface FoodEn {
  name: string;
  units: Readonly<Record<string, string>>;
}

export const FOODS_EN: Readonly<Record<string, FoodEn>> = {
  oats_fine: { name: 'Quick oats', units: { cup: 'cup', tbsp: 'tbsp', g100: '100 g' } },
  soy_milk: { name: 'Unsweetened soy milk', units: { cup: 'cup', g100: '100 ml' } },
  chia: { name: 'Chia seeds', units: { tbsp: 'tbsp', tsp: 'tsp' } },
  whey: { name: 'Protein powder', units: { scoop: 'scoop' } },
  egg: { name: 'Egg', units: { unit: 'pc' } },
  salad: { name: 'Raw vegetable salad (no oil)', units: { bowl: 'bowl', serving: 'small serving' } },
  olive_oil: { name: 'Olive oil', units: { tsp: 'tsp', tbsp: 'tbsp' } },
  oil_spray: { name: 'Cooking spray', units: { spray: 'pan spray' } },
  tahini: { name: 'Raw tahini', units: { tbsp: 'tbsp', tsp: 'tsp' } },
  bread_whole: { name: 'Whole-wheat bread', units: { slice: 'slice' } },
  cottage5: { name: 'Cottage cheese 5%', units: { tbsp: 'tbsp', container: 'tub' } },
  protein_yogurt: { name: 'Protein yogurt 0%', units: { container: 'cup' } },
  chicken_breast: { name: 'Grilled chicken breast', units: { serving: 'serving', g100: '100 g' } },
  tuna_water: { name: 'Tuna in water (drained)', units: { can: 'can' } },
  salmon: { name: 'Baked salmon', units: { serving: 'serving' } },
  rice_cooked: { name: 'Cooked white rice', units: { cup: 'cup', tbsp: 'tbsp' } },
  lentils: { name: 'Cooked lentils', units: { cup: 'cup' } },
  sweet_potato: { name: 'Baked sweet potato', units: { unit: 'medium' } },
  apple: { name: 'Apple', units: { unit: 'pc' } },
  banana: { name: 'Banana', units: { unit: 'pc' } },
  almonds: { name: 'Almonds', units: { unit: 'almond', handful: 'handful' } },
  rice_cake: { name: 'Rice cake', units: { unit: 'pc' } },
};

export const MEALS_EN: Readonly<Record<string, string>> = {
  oatmeal: 'Oatmeal',
  eggs_salad: 'Eggs with salad',
  omelette_salad: 'Omelette with salad',
};

/** A fixed meal's one unit (core/catalog.ts `PORTION`). */
export const PORTION_EN = 'serving';
