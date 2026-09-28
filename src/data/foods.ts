/**
 * data/foods.ts — the built-in food catalog of the 🍽️ tracker.
 *
 * PROVISIONAL. This is a starter catalog — the owner's two fixed meals plus
 * common deficit-friendly staples — to be replaced by the owner's own list.
 * The catalog ships IN THE BUNDLE, so both partners' devices carry the same
 * one after an update; nothing about it is stored in the event log (a logged
 * pick freezes its numbers into its own `meal_logged` payload).
 *
 * THE ONE BASIS: every food is priced per 100 g AS EATEN (`kcal100`,
 * `protein100`), and every unit is a weight in grams — "כוס" of oats is 80 g,
 * a "סקופ" is 30 g. A liquid's unit is its volume in ml, read as grams (the
 * density of milk-like drinks is ~1). Mixed sources (a label's per-unit
 * numbers, a table's per-100 g) all reduce to this one shape.
 *
 * A FIXED MEAL is a list of components (food + unit + quantity) for ONE
 * portion; it is priced from its foods, so correcting a food corrects every
 * meal that uses it. Values: USDA FoodData Central / Israeli labels, rounded.
 */

import type { MealSlot } from '../storage/DataStore.ts';

export interface FoodUnit {
  /** Stable id — stored on logged meals, never renamed. */
  id: string;
  /** Hebrew unit name ("כוס", "כף"). */
  label: string;
  /** The unit's weight in grams (ml for a liquid). */
  grams: number;
}

export interface CatalogFood {
  kind: 'food';
  /** Stable id — stored on logged meals, never renamed. */
  id: string;
  name: string;
  /** The meals it fits; the add form lists it there first. */
  slots: readonly MealSlot[];
  /** Per 100 g as eaten. */
  kcal100: number;
  protein100: number;
  units: readonly FoodUnit[];
}

export interface MealComponent {
  food: string;
  unit: string;
  qty: number;
}

export interface CatalogMeal {
  kind: 'meal';
  id: string;
  name: string;
  slots: readonly MealSlot[];
  /** ONE portion. */
  components: readonly MealComponent[];
}

export type CatalogEntry = CatalogFood | CatalogMeal;

const G100: FoodUnit = { id: 'g100', label: '100 ג׳', grams: 100 };
const ML100: FoodUnit = { id: 'g100', label: '100 מ״ל', grams: 100 };

const ALL_DAY: readonly MealSlot[] = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'other'];
const SNACKS: readonly MealSlot[] = ['snack_am', 'snack_pm', 'other'];

export const FOODS: readonly CatalogFood[] = [
  // — the fixed meals' ingredients —
  {
    kind: 'food', id: 'oats_fine', name: 'שיבולת שועל דקה', slots: ['breakfast', 'dinner'],
    kcal100: 379, protein100: 13.2,
    units: [{ id: 'cup', label: 'כוס', grams: 80 }, { id: 'tbsp', label: 'כף', grams: 8 }, G100],
  },
  {
    kind: 'food', id: 'soy_milk', name: 'חלב סויה ללא סוכר', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner'],
    kcal100: 33, protein100: 3,
    units: [{ id: 'cup', label: 'כוס', grams: 240 }, ML100],
  },
  {
    kind: 'food', id: 'chia', name: 'זרעי צ׳יה', slots: ['breakfast', 'dinner', 'snack_am', 'snack_pm'],
    kcal100: 486, protein100: 16.5,
    units: [{ id: 'tbsp', label: 'כף', grams: 12 }, { id: 'tsp', label: 'כפית', grams: 4 }],
  },
  {
    kind: 'food', id: 'whey', name: 'אבקת חלבון', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner', 'other'],
    kcal100: 380, protein100: 75,
    units: [{ id: 'scoop', label: 'סקופ', grams: 30 }],
  },
  {
    kind: 'food', id: 'egg', name: 'ביצה', slots: ['breakfast', 'dinner'],
    kcal100: 143, protein100: 12.6,
    units: [{ id: 'unit', label: 'יחידה', grams: 55 }],
  },
  {
    kind: 'food', id: 'salad', name: 'סלט ירקות חי (בלי שמן)', slots: ['breakfast', 'lunch', 'dinner'],
    kcal100: 20, protein100: 0.9,
    units: [{ id: 'bowl', label: 'קערה', grams: 250 }, { id: 'serving', label: 'מנה קטנה', grams: 150 }],
  },
  // — fats and spreads: the calories estimates miss most —
  {
    kind: 'food', id: 'olive_oil', name: 'שמן זית', slots: ALL_DAY,
    kcal100: 884, protein100: 0,
    units: [{ id: 'tsp', label: 'כפית', grams: 4.5 }, { id: 'tbsp', label: 'כף', grams: 13.5 }],
  },
  {
    // A pan's worth of spray — about a second, ~1 g. The label's "0 kcal" is a
    // ⅓-second serving; what actually coats a pan is several of those.
    kind: 'food', id: 'oil_spray', name: 'ספריי שמן', slots: ALL_DAY,
    kcal100: 884, protein100: 0,
    units: [{ id: 'spray', label: 'ריסוס למחבת', grams: 1 }],
  },
  {
    kind: 'food', id: 'tahini', name: 'טחינה גולמית', slots: ['lunch', 'dinner'],
    kcal100: 600, protein100: 17,
    units: [{ id: 'tbsp', label: 'כף', grams: 15 }, { id: 'tsp', label: 'כפית', grams: 5 }],
  },
  // — breakfast / dinner —
  {
    kind: 'food', id: 'bread_whole', name: 'לחם מלא', slots: ['breakfast', 'dinner'],
    kcal100: 250, protein100: 9,
    units: [{ id: 'slice', label: 'פרוסה', grams: 35 }],
  },
  {
    kind: 'food', id: 'cottage5', name: 'קוטג׳ 5%', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner'],
    kcal100: 95, protein100: 11,
    units: [{ id: 'tbsp', label: 'כף', grams: 30 }, { id: 'container', label: 'גביע', grams: 250 }],
  },
  {
    kind: 'food', id: 'protein_yogurt', name: 'יוגורט חלבון 0%', slots: ['breakfast', ...SNACKS],
    kcal100: 62, protein100: 10,
    units: [{ id: 'container', label: 'גביע', grams: 200 }],
  },
  // — lunch —
  {
    kind: 'food', id: 'chicken_breast', name: 'חזה עוף צלוי', slots: ['lunch', 'dinner'],
    kcal100: 165, protein100: 31,
    units: [{ id: 'serving', label: 'מנה', grams: 150 }, G100],
  },
  {
    kind: 'food', id: 'tuna_water', name: 'טונה במים (מסוננת)', slots: ['lunch', 'dinner'],
    kcal100: 116, protein100: 26,
    units: [{ id: 'can', label: 'קופסה', grams: 110 }],
  },
  {
    kind: 'food', id: 'salmon', name: 'סלמון אפוי', slots: ['lunch', 'dinner'],
    kcal100: 206, protein100: 22,
    units: [{ id: 'serving', label: 'מנה', grams: 130 }],
  },
  {
    kind: 'food', id: 'rice_cooked', name: 'אורז לבן מבושל', slots: ['lunch'],
    kcal100: 130, protein100: 2.7,
    units: [{ id: 'cup', label: 'כוס', grams: 160 }, { id: 'tbsp', label: 'כף', grams: 20 }],
  },
  {
    kind: 'food', id: 'lentils', name: 'עדשים מבושלות', slots: ['lunch'],
    kcal100: 116, protein100: 9,
    units: [{ id: 'cup', label: 'כוס', grams: 200 }],
  },
  {
    kind: 'food', id: 'sweet_potato', name: 'בטטה אפויה', slots: ['lunch', 'dinner'],
    kcal100: 90, protein100: 2,
    units: [{ id: 'unit', label: 'יחידה בינונית', grams: 150 }],
  },
  // — between meals —
  {
    kind: 'food', id: 'apple', name: 'תפוח', slots: SNACKS,
    kcal100: 52, protein100: 0.3,
    units: [{ id: 'unit', label: 'יחידה', grams: 180 }],
  },
  {
    kind: 'food', id: 'banana', name: 'בננה', slots: ['breakfast', ...SNACKS],
    kcal100: 89, protein100: 1.1,
    units: [{ id: 'unit', label: 'יחידה', grams: 120 }],
  },
  {
    kind: 'food', id: 'almonds', name: 'שקדים', slots: SNACKS,
    kcal100: 580, protein100: 21,
    units: [{ id: 'unit', label: 'שקד', grams: 1.2 }, { id: 'handful', label: 'חופן', grams: 30 }],
  },
  {
    kind: 'food', id: 'rice_cake', name: 'פריכית אורז', slots: SNACKS,
    kcal100: 387, protein100: 8,
    units: [{ id: 'unit', label: 'יחידה', grams: 9 }],
  },
];

/**
 * The owner's fixed meals, ONE portion each. The eggs in "ביצים עם סלט" are
 * hard-boiled, no oil; the omelette is made with spray.
 */
export const FIXED_MEALS: readonly CatalogMeal[] = [
  {
    kind: 'meal', id: 'oatmeal', name: 'שיבולת שועל', slots: ['breakfast', 'dinner'],
    components: [
      { food: 'oats_fine', unit: 'cup', qty: 0.5 },
      { food: 'soy_milk', unit: 'cup', qty: 0.75 },
      { food: 'chia', unit: 'tbsp', qty: 1 },
      { food: 'whey', unit: 'scoop', qty: 1 },
    ],
  },
  {
    kind: 'meal', id: 'eggs_salad', name: 'ביצים עם סלט', slots: ['dinner', 'breakfast'],
    components: [
      { food: 'egg', unit: 'unit', qty: 2 },
      { food: 'salad', unit: 'bowl', qty: 1 },
    ],
  },
  {
    kind: 'meal', id: 'omelette_salad', name: 'חביתה עם סלט', slots: ['dinner', 'breakfast'],
    components: [
      { food: 'egg', unit: 'unit', qty: 2 },
      { food: 'oil_spray', unit: 'spray', qty: 1 },
      { food: 'salad', unit: 'bowl', qty: 1 },
    ],
  },
];
