/**
 * data/foods.ts — the built-in food catalog of the 🍽️ tracker.
 *
 * Three lists, one basis:
 *   FOODS        ~220 generic foods (no brands): Israeli everyday staples and
 *                international ones — proteins, carbs, dairy, vegetables,
 *                fruits, fats and spreads, common dishes, snacks, drinks.
 *   FIXED_MEALS  the original owners' own breakfasts. Offered only to an
 *                account that has eaten them before ("הארוחות שלי",
 *                `core/catalog.ts#myFixedMeals`) — a new user never sees
 *                somebody else's breakfast.
 *   READY_MEALS  everyday meals for EVERYONE ("ארוחות מוכנות"), built from
 *                FOODS; and DAILY_MENUS, whole days built from them.
 * The catalog ships IN THE BUNDLE; nothing about it is stored in the event log
 * (a logged pick freezes its numbers into its own `meal_logged` payload).
 *
 * THE ONE BASIS: every food is priced per 100 g AS EATEN (`kcal100`,
 * `protein100`, `carbs100`, `fat100`), and every unit is a weight in grams —
 * "כוס" of oats is 80 g, a "סקופ" is 30 g. A liquid's unit is its volume in
 * ml, read as grams (the density of milk-like drinks is ~1). Mixed sources (a
 * label's per-unit numbers, a table's per-100 g) all reduce to this one shape.
 * `catalogProblems()` checks every food's energy against its macros (4/4/9,
 * plus 7 per gram of `alcohol100`), so a typo cannot hide.
 *
 * A MEAL (fixed or ready) is a list of components (food + unit + quantity) for
 * ONE portion; it is priced from its foods, so correcting a food corrects every
 * meal that uses it. Values: USDA FoodData Central / the Israeli Ministry of
 * Health food tables / generic Israeli labels, rounded. Ids are stable
 * snake_case English — they are stored on logged meals, never renamed.
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
  /** Per 100 g as eaten (grams of each macro). */
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  /** Grams of alcohol per 100 g (drinks) — only the energy check reads it. */
  alcohol100?: number;
  units: readonly FoodUnit[];
  /**
   * An ingredient or add-on (oil, spray, tahini, chia, milk for the oats) —
   * logged like any food, but never offered on its own as a meal reminder's
   * suggestion.
   */
  addOn?: true;
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
  /** A ready meal without meat or fish (eggs and dairy allowed) — the vegetarian menus draw on these. */
  vegetarian?: true;
}

export type CatalogEntry = CatalogFood | CatalogMeal;

const G100: FoodUnit = { id: 'g100', label: '100 ג׳', grams: 100 };
const ML100: FoodUnit = { id: 'g100', label: '100 מ״ל', grams: 100 };

const ALL_DAY: readonly MealSlot[] = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner', 'other'];
const SNACKS: readonly MealSlot[] = ['snack_am', 'snack_pm', 'other'];
const BD: readonly MealSlot[] = ['breakfast', 'dinner'];
const LD: readonly MealSlot[] = ['lunch', 'dinner'];
const MAIN: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const BS: readonly MealSlot[] = ['breakfast', ...SNACKS];
const BDS: readonly MealSlot[] = ['breakfast', 'dinner', ...SNACKS];

const u = (id: string, label: string, grams: number): FoodUnit => ({ id, label, grams });

/** kcal, protein, carbs, fat — per 100 g as eaten. */
type Per100 = readonly [number, number, number, number];

/** The database's compact row: the same `CatalogFood`, one line per food. */
function food(
  id: string,
  name: string,
  slots: readonly MealSlot[],
  v: Per100,
  units: readonly FoodUnit[],
  extra: { addOn?: true; alcohol100?: number } = {},
): CatalogFood {
  return { kind: 'food', id, name, slots, kcal100: v[0], protein100: v[1], carbs100: v[2], fat100: v[3], units, ...extra };
}

export const FOODS: readonly CatalogFood[] = [
  // — the fixed meals' ingredients —
  {
    kind: 'food', id: 'oats_fine', name: 'שיבולת שועל דקה', slots: ['breakfast', 'dinner'],
    kcal100: 379, protein100: 13.2, carbs100: 67.7, fat100: 6.5,
    units: [{ id: 'cup', label: 'כוס', grams: 80 }, { id: 'tbsp', label: 'כף', grams: 8 }, G100],
  },
  {
    kind: 'food', id: 'soy_milk', name: 'חלב סויה ללא סוכר', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner'],
    kcal100: 33, protein100: 3, carbs100: 1.2, fat100: 1.8,
    addOn: true,
    units: [{ id: 'cup', label: 'כוס', grams: 240 }, ML100],
  },
  {
    kind: 'food', id: 'chia', name: 'זרעי צ׳יה', slots: ['breakfast', 'dinner', 'snack_am', 'snack_pm'],
    kcal100: 486, protein100: 16.5, carbs100: 42.1, fat100: 30.7,
    addOn: true,
    units: [{ id: 'tbsp', label: 'כף', grams: 12 }, { id: 'tsp', label: 'כפית', grams: 4 }],
  },
  {
    kind: 'food', id: 'whey', name: 'אבקת חלבון', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner', 'other'],
    kcal100: 380, protein100: 75, carbs100: 8, fat100: 6,
    units: [{ id: 'scoop', label: 'סקופ', grams: 30 }],
  },
  {
    kind: 'food', id: 'egg', name: 'ביצה', slots: ['breakfast', 'dinner'],
    kcal100: 143, protein100: 12.6, carbs100: 0.7, fat100: 9.5,
    units: [{ id: 'unit', label: 'יחידה', grams: 55 }],
  },
  {
    kind: 'food', id: 'salad', name: 'סלט ירקות חי (בלי שמן)', slots: ['breakfast', 'lunch', 'dinner'],
    kcal100: 20, protein100: 0.9, carbs100: 3.9, fat100: 0.2,
    units: [{ id: 'bowl', label: 'קערה', grams: 250 }, { id: 'serving', label: 'מנה קטנה', grams: 150 }],
  },
  // — fats and spreads: the calories estimates miss most —
  {
    kind: 'food', id: 'olive_oil', name: 'שמן זית', slots: ALL_DAY,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100,
    addOn: true,
    units: [{ id: 'tsp', label: 'כפית', grams: 4.5 }, { id: 'tbsp', label: 'כף', grams: 13.5 }],
  },
  {
    // A pan's worth of spray — about a second, ~1 g. The label's "0 kcal" is a
    // ⅓-second serving; what actually coats a pan is several of those.
    kind: 'food', id: 'oil_spray', name: 'ספריי שמן', slots: ALL_DAY,
    kcal100: 884, protein100: 0, carbs100: 0, fat100: 100,
    addOn: true,
    units: [{ id: 'spray', label: 'ריסוס למחבת', grams: 1 }],
  },
  {
    kind: 'food', id: 'tahini', name: 'טחינה גולמית', slots: ['lunch', 'dinner'],
    kcal100: 600, protein100: 17, carbs100: 21, fat100: 54,
    addOn: true,
    units: [{ id: 'tbsp', label: 'כף', grams: 15 }, { id: 'tsp', label: 'כפית', grams: 5 }],
  },
  // — breakfast / dinner —
  {
    kind: 'food', id: 'bread_whole', name: 'לחם מלא', slots: ['breakfast', 'dinner'],
    kcal100: 250, protein100: 9, carbs100: 43, fat100: 3.5,
    units: [{ id: 'slice', label: 'פרוסה', grams: 35 }],
  },
  {
    kind: 'food', id: 'cottage5', name: 'קוטג׳ 5%', slots: ['breakfast', 'snack_am', 'snack_pm', 'dinner'],
    kcal100: 95, protein100: 11, carbs100: 1.5, fat100: 5,
    units: [{ id: 'tbsp', label: 'כף', grams: 30 }, { id: 'container', label: 'גביע', grams: 250 }],
  },
  {
    kind: 'food', id: 'protein_yogurt', name: 'יוגורט חלבון 0%', slots: ['breakfast', ...SNACKS],
    kcal100: 62, protein100: 10, carbs100: 5.2, fat100: 0.2,
    units: [{ id: 'container', label: 'גביע', grams: 200 }],
  },
  // — lunch —
  {
    kind: 'food', id: 'chicken_breast', name: 'חזה עוף צלוי', slots: ['lunch', 'dinner'],
    kcal100: 165, protein100: 31, carbs100: 0, fat100: 3.6,
    units: [{ id: 'serving', label: 'מנה', grams: 150 }, G100],
  },
  {
    kind: 'food', id: 'tuna_water', name: 'טונה במים (מסוננת)', slots: ['lunch', 'dinner'],
    kcal100: 116, protein100: 26, carbs100: 0, fat100: 0.8,
    units: [{ id: 'can', label: 'קופסה', grams: 110 }],
  },
  {
    kind: 'food', id: 'salmon', name: 'סלמון אפוי', slots: ['lunch', 'dinner'],
    kcal100: 206, protein100: 22, carbs100: 0, fat100: 12.4,
    units: [{ id: 'serving', label: 'מנה', grams: 130 }],
  },
  {
    kind: 'food', id: 'rice_cooked', name: 'אורז לבן מבושל', slots: ['lunch'],
    kcal100: 130, protein100: 2.7, carbs100: 28.2, fat100: 0.3,
    units: [{ id: 'cup', label: 'כוס', grams: 160 }, { id: 'tbsp', label: 'כף', grams: 20 }],
  },
  {
    kind: 'food', id: 'lentils', name: 'עדשים מבושלות', slots: ['lunch'],
    kcal100: 116, protein100: 9, carbs100: 20.1, fat100: 0.4,
    units: [{ id: 'cup', label: 'כוס', grams: 200 }],
  },
  {
    kind: 'food', id: 'sweet_potato', name: 'בטטה אפויה', slots: ['lunch', 'dinner'],
    kcal100: 90, protein100: 2, carbs100: 20.7, fat100: 0.2,
    units: [{ id: 'unit', label: 'יחידה בינונית', grams: 150 }],
  },
  // — between meals —
  {
    kind: 'food', id: 'apple', name: 'תפוח', slots: SNACKS,
    kcal100: 52, protein100: 0.3, carbs100: 13.8, fat100: 0.2,
    units: [{ id: 'unit', label: 'יחידה', grams: 180 }],
  },
  {
    kind: 'food', id: 'banana', name: 'בננה', slots: ['breakfast', ...SNACKS],
    kcal100: 89, protein100: 1.1, carbs100: 22.8, fat100: 0.3,
    units: [{ id: 'unit', label: 'יחידה', grams: 120 }],
  },
  {
    kind: 'food', id: 'almonds', name: 'שקדים', slots: SNACKS,
    kcal100: 580, protein100: 21, carbs100: 21.6, fat100: 49.9,
    units: [{ id: 'unit', label: 'שקד', grams: 1.2 }, { id: 'handful', label: 'חופן', grams: 30 }],
  },
  {
    kind: 'food', id: 'rice_cake', name: 'פריכית אורז', slots: SNACKS,
    kcal100: 387, protein100: 8, carbs100: 81.5, fat100: 2.8,
    units: [{ id: 'unit', label: 'יחידה', grams: 9 }],
  },
  // ———————————————— the database (stage ז) — generic foods, no brands ————————————————
  // — poultry and meat —
  food('chicken_thigh', 'פרגית צלויה (ירך עוף בלי עור)', LD, [209, 26, 0, 10.9], [u('unit', 'ירך (בלי עצם)', 100), u('serving', 'מנה', 150), G100]),
  food('chicken_roast', 'עוף צלוי עם עור', LD, [239, 27.3, 0, 13.6], [u('quarter', 'רבע עוף (נטו, בלי עצמות)', 180), G100]),
  food('chicken_drumstick', 'שוק עוף צלוי עם עור', LD, [216, 27, 0, 11.2], [u('unit', 'שוק (נטו)', 75)]),
  food('chicken_liver', 'כבד עוף מוקפץ', LD, [167, 24.5, 0.9, 6.5], [u('serving', 'מנה', 100)]),
  food('turkey_breast', 'חזה הודו צלוי', LD, [147, 30, 0, 2], [u('serving', 'מנה', 150), G100]),
  food('turkey_deli', 'פסטרמה / נקניק הודו', MAIN, [104, 17, 3, 2.5], [u('slice', 'פרוסה', 15)]),
  food('shawarma_meat', 'שווארמה עוף (הבשר בלבד)', LD, [212, 24, 2, 12], [u('serving', 'מנה', 150), G100]),
  food('ground_beef', 'בקר טחון / קציצת המבורגר צלויה', LD, [250, 26, 0, 15.4], [u('patty', 'קציצת המבורגר', 120), G100]),
  food('beef_steak', 'סטייק אנטריקוט צלוי', LD, [280, 24, 0, 20], [u('serving', 'סטייק', 200), G100]),
  food('beef_fillet', 'פילה בקר צלוי', LD, [218, 30, 0, 10], [u('serving', 'מנה', 180), G100]),
  food('kebab', 'קבב צלוי', LD, [260, 17, 3, 20], [u('unit', 'יחידה', 60)]),
  food('meatballs_sauce', 'קציצות בשר ברוטב עגבניות', LD, [180, 12, 8, 11], [u('unit', 'קציצה עם רוטב', 80), u('serving', 'מנה', 250)]),
  food('hot_dog', 'נקניקייה', LD, [290, 11, 3, 26], [u('unit', 'יחידה', 50)]),
  // — fish and seafood —
  food('tilapia', 'אמנון (מושט) אפוי', LD, [128, 26, 0, 2.7], [u('unit', 'פילה', 120), G100]),
  food('white_fish', 'דג לבן אפוי (הייק / בקלה)', LD, [100, 23, 0, 0.9], [u('serving', 'מנה', 150), G100]),
  food('sea_bream', 'דניס צלוי', LD, [150, 24, 0, 6], [u('unit', 'דג שלם (נטו)', 200), G100]),
  food('tuna_oil', 'טונה בשמן (מסוננת)', LD, [198, 29, 0, 8.2], [u('can', 'קופסה', 110)]),
  food('sardines', 'סרדינים בשמן (מסוננים)', LD, [208, 25, 0, 11.5], [u('can', 'קופסה', 90)]),
  food('smoked_salmon', 'סלמון מעושן', BD, [117, 18.3, 0, 4.3], [u('slice', 'פרוסה', 20)]),
  food('pickled_herring', 'הרינג כבוש', BD, [262, 14.2, 9.6, 18], [u('unit', 'חתיכה', 30)]),
  food('shrimp', 'שרימפס מבושלים', LD, [99, 24, 0.2, 0.3], [u('serving', 'מנה', 100)]),
  // — eggs —
  food('egg_white', 'חלבון ביצה', BD, [52, 10.9, 0.7, 0.2], [u('unit', 'חלבון מביצה אחת', 33)]),
  food('omelette', 'חביתה מטוגנת', MAIN, [200, 11.5, 0.7, 17], [u('one', 'חביתה מביצה אחת', 60), u('two', 'חביתה משתי ביצים', 115)]),
  food('egg_fried', 'ביצת עין', BD, [196, 13.6, 0.8, 14.8], [u('unit', 'יחידה', 46)]),
  // — plant protein and legumes —
  food('tofu', 'טופו קשה', LD, [144, 17, 3, 8.7], [u('serving', 'מנה', 120), G100]),
  food('chickpeas', 'גרגירי חומוס מבושלים', LD, [164, 8.9, 27.4, 2.6], [u('cup', 'כוס', 165), u('tbsp', 'כף', 15)]),
  food('white_beans', 'שעועית לבנה מבושלת', LD, [139, 9.7, 25, 0.4], [u('cup', 'כוס', 180)]),
  food('ful', 'פול מבושל', MAIN, [110, 7.6, 19.7, 0.4], [u('cup', 'כוס', 170)]),
  food('edamame', 'אדממה', ['lunch', 'dinner', ...SNACKS], [121, 11.9, 8.9, 5.2], [u('cup', 'כוס', 155)]),
  food('veggie_schnitzel', 'שניצל צמחי', LD, [230, 12, 20, 11], [u('unit', 'יחידה', 80)]),
  food('falafel', 'פלאפל (כדורים)', LD, [333, 13.3, 31.8, 17.8], [u('unit', 'כדור', 17), u('serving', 'מנה (6 כדורים)', 100)]),
  // — breads —
  food('bread_white', 'לחם לבן', BD, [266, 8.9, 49, 3.3], [u('slice', 'פרוסה', 30)]),
  food('bread_rye', 'לחם שיפון', BD, [259, 8.5, 48, 3.3], [u('slice', 'פרוסה', 32)]),
  food('bread_light', 'לחם קל', BD, [186, 12, 30, 2], [u('slice', 'פרוסה', 24)]),
  food('pita', 'פיתה', MAIN, [275, 9.1, 55.7, 1.2], [u('unit', 'יחידה', 90), u('half', 'חצי', 45)]),
  food('pita_whole', 'פיתה מקמח מלא', MAIN, [262, 9.8, 55, 2.6], [u('unit', 'יחידה', 80), u('half', 'חצי', 40)]),
  food('lafa', 'לאפה', LD, [270, 8.5, 53, 2.5], [u('unit', 'יחידה', 120), u('half', 'חצי', 60)]),
  food('challah', 'חלה', BD, [287, 9.5, 47.8, 6], [u('slice', 'פרוסה', 40)]),
  food('baguette', 'באגט', MAIN, [272, 10.8, 51.9, 2.4], [u('slice', 'פרוסה', 40), u('half', 'חצי באגט', 125)]),
  food('roll', 'לחמנייה', MAIN, [276, 9, 50, 4.5], [u('unit', 'יחידה', 80)]),
  food('burger_bun', 'לחמניית המבורגר', LD, [273, 9.5, 49, 4.3], [u('unit', 'יחידה', 60)]),
  food('bagel', 'בייגל', BD, [257, 10, 50.5, 1.6], [u('unit', 'יחידה', 100)]),
  food('croissant', 'קרואסון חמאה', ['breakfast', ...SNACKS], [406, 8.2, 45.8, 21], [u('unit', 'יחידה', 60)]),
  food('tortilla', 'טורטייה', MAIN, [304, 8, 50, 8], [u('unit', 'יחידה', 60)]),
  food('matzah', 'מצה', BD, [395, 10, 84, 1.4], [u('unit', 'יחידה', 30)]),
  food('crackers', 'קרקרים מלוחים', ['breakfast', 'dinner', ...SNACKS], [420, 9, 70, 11], [u('unit', 'יחידה', 5)]),
  // — grains, pasta, potatoes —
  food('rice_brown', 'אורז מלא מבושל', LD, [123, 2.7, 25.6, 1], [u('cup', 'כוס', 160), u('tbsp', 'כף', 20)]),
  food('pasta_cooked', 'פסטה מבושלת', LD, [158, 5.8, 30.9, 0.9], [u('cup', 'כוס', 140), u('serving', 'מנה', 200)]),
  food('pasta_whole', 'פסטה מחיטה מלאה מבושלת', LD, [149, 6, 30, 1.7], [u('cup', 'כוס', 140), u('serving', 'מנה', 200)]),
  food('couscous', 'קוסקוס מבושל', LD, [112, 3.8, 23.2, 0.2], [u('cup', 'כוס', 160)]),
  food('ptitim', 'פתיתים מבושלים', LD, [149, 5, 30, 1], [u('cup', 'כוס', 160)]),
  food('bulgur', 'בורגול מבושל', LD, [83, 3.1, 18.6, 0.2], [u('cup', 'כוס', 180)]),
  food('quinoa', 'קינואה מבושלת', LD, [120, 4.4, 21.3, 1.9], [u('cup', 'כוס', 185)]),
  food('buckwheat', 'כוסמת מבושלת', LD, [92, 3.4, 20, 0.6], [u('cup', 'כוס', 170)]),
  food('rice_noodles', 'אטריות אורז מבושלות', LD, [108, 1.8, 24, 0.2], [u('cup', 'כוס', 175)]),
  food('potato_boiled', 'תפוח אדמה מבושל', LD, [87, 1.9, 20, 0.1], [u('unit', 'יחידה בינונית', 150)]),
  food('potato_baked', 'תפוח אדמה אפוי', LD, [93, 2.5, 21, 0.1], [u('unit', 'יחידה בינונית', 170)]),
  food('potato_roasted', 'תפוחי אדמה בתנור (עם שמן)', LD, [150, 2.5, 22, 6], [u('serving', 'מנה', 200)]),
  food('mashed_potato', 'פירה', LD, [113, 1.9, 17, 4.2], [u('cup', 'כוס', 210)]),
  food('fries', 'צ׳יפס', LD, [312, 3.4, 41, 15], [u('serving', 'מנה', 150), u('small', 'מנה קטנה', 100)]),
  food('corn', 'תירס מבושל', LD, [96, 3.4, 19, 1.5], [u('unit', 'קלח (גרעינים)', 100), u('cup', 'כוס גרעינים', 150)]),
  // — breakfast cereals —
  food('granola', 'גרנולה', BS, [471, 10, 64, 20], [u('tbsp', 'כף', 10), u('cup', 'כוס', 110)]),
  food('cornflakes', 'קורנפלקס', ['breakfast'], [357, 7.5, 84, 0.4], [u('cup', 'כוס', 30)]),
  food('muesli', 'מוזלי ללא תוספת סוכר', ['breakfast'], [358, 10, 66, 6], [u('cup', 'כוס', 90)]),
  food('cereal_choc', 'דגני בוקר שוקו (כריות)', ['breakfast'], [401, 8, 72, 9], [u('cup', 'כוס', 35)]),
  food('pancake', 'פנקייק', ['breakfast'], [227, 6.4, 28, 9.7], [u('unit', 'יחידה', 40)]),
  // — dairy —
  food('cottage3', 'קוטג׳ 3%', BDS, [77, 11, 1.5, 3], [u('tbsp', 'כף', 30), u('container', 'גביע', 250)]),
  food('white_cheese5', 'גבינה לבנה 5%', BDS, [95, 8.5, 4, 5], [u('tbsp', 'כף', 30), u('container', 'גביע', 250)]),
  food('labneh', 'לבנה 5%', BD, [97, 8, 4, 5.5], [u('tbsp', 'כף', 30)]),
  food('bulgarian5', 'גבינה בולגרית 5%', BD, [117, 17, 1, 5], [u('slice', 'פרוסה', 30), G100]),
  food('bulgarian16', 'גבינה בולגרית / פטה 16%', BD, [225, 16, 1, 17.5], [u('slice', 'פרוסה', 30), G100]),
  food('yellow_cheese', 'גבינה צהובה 28%', BD, [356, 26, 0.5, 28], [u('slice', 'פרוסה', 20)]),
  food('yellow_cheese_light', 'גבינה צהובה 9%', BD, [205, 30, 1, 9], [u('slice', 'פרוסה', 20)]),
  food('mozzarella', 'מוצרלה', BD, [300, 22, 2.2, 22], [u('slice', 'פרוסה', 25), G100]),
  food('parmesan', 'פרמזן מגורד', LD, [431, 38, 4, 29], [u('tbsp', 'כף', 5)], { addOn: true }),
  food('cream_cheese', 'גבינת שמנת', BD, [328, 6, 4, 32], [u('tbsp', 'כף', 20)], { addOn: true }),
  food('milk3', 'חלב 3%', BDS, [60, 3.3, 4.7, 3], [u('cup', 'כוס', 240), ML100]),
  food('milk1', 'חלב 1%', BDS, [42, 3.3, 4.8, 1], [u('cup', 'כוס', 240), ML100]),
  food('chocolate_milk', 'שוקו', BS, [71, 3.3, 11, 1.5], [u('cup', 'כוס', 240), u('bottle', 'בקבוק / שקית', 250)]),
  food('yogurt_plain', 'יוגורט 3%', BS, [61, 3.5, 4.7, 3.3], [u('container', 'גביע', 200)]),
  food('yogurt_greek', 'יוגורט יווני 2%', BS, [73, 10, 4, 2], [u('container', 'גביע', 150)]),
  food('yogurt_fruit', 'יוגורט פירות', BS, [95, 3.3, 15, 2.5], [u('container', 'גביע', 150)]),
  food('pudding', 'מעדן שוקולד עם קצפת', SNACKS, [150, 3, 20, 6.5], [u('container', 'גביע', 125)]),
  food('butter', 'חמאה', BD, [717, 0.9, 0.1, 81], [u('tsp', 'כפית', 5), u('tbsp', 'כף', 14)], { addOn: true }),
  food('cream32', 'שמנת מתוקה 32%', ALL_DAY, [308, 2, 3, 32], [u('tbsp', 'כף', 15)], { addOn: true }),
  // — vegetables —
  food('tomato', 'עגבנייה', MAIN, [18, 0.9, 3.9, 0.2], [u('unit', 'יחידה', 120)]),
  food('cucumber', 'מלפפון', ['breakfast', 'lunch', 'dinner', ...SNACKS], [15, 0.7, 3.6, 0.1], [u('unit', 'יחידה', 100)]),
  food('bell_pepper', 'פלפל אדום', ['breakfast', 'lunch', 'dinner', ...SNACKS], [31, 1, 6, 0.3], [u('unit', 'יחידה', 150)]),
  food('carrot', 'גזר', ['lunch', 'dinner', ...SNACKS], [41, 0.9, 9.6, 0.2], [u('unit', 'יחידה', 70)]),
  food('lettuce', 'חסה', MAIN, [15, 1.4, 2.9, 0.2], [u('cup', 'כוס קצוצה', 50)]),
  food('cabbage', 'כרוב', LD, [25, 1.3, 5.8, 0.1], [u('cup', 'כוס קצוצה', 90)]),
  food('broccoli', 'ברוקולי מאודה', LD, [35, 2.4, 7.2, 0.4], [u('cup', 'כוס', 155)]),
  food('cauliflower', 'כרובית מאודה', LD, [23, 1.8, 4.1, 0.5], [u('cup', 'כוס', 125)]),
  food('zucchini', 'קישוא מבושל', LD, [17, 1.2, 3.1, 0.3], [u('unit', 'יחידה', 150)]),
  food('eggplant_roasted', 'חציל קלוי (בלי שמן)', LD, [35, 0.8, 8.7, 0.2], [u('half', 'חצי חציל', 120)]),
  food('eggplant_fried', 'חציל מטוגן', LD, [203, 1.2, 9, 18], [u('slice', 'פרוסה', 30)]),
  food('onion', 'בצל', LD, [40, 1.1, 9.3, 0.1], [u('unit', 'יחידה', 110)]),
  food('mushrooms', 'פטריות', LD, [22, 3.1, 3.3, 0.3], [u('cup', 'כוס', 70)]),
  food('spinach', 'תרד', LD, [23, 2.9, 3.6, 0.4], [u('cup', 'כוס', 30)]),
  food('green_beans', 'שעועית ירוקה מבושלת', LD, [35, 1.9, 7.9, 0.3], [u('cup', 'כוס', 125)]),
  food('peas', 'אפונה ירוקה', LD, [78, 5.2, 14.3, 0.3], [u('cup', 'כוס', 160)]),
  food('beet', 'סלק מבושל', LD, [44, 1.7, 10, 0.2], [u('unit', 'יחידה', 100)]),
  food('pumpkin', 'דלעת אפויה', LD, [26, 1, 6.5, 0.1], [u('serving', 'מנה', 150)]),
  food('veg_cooked', 'ירקות מבושלים / מאודים', LD, [52, 2.5, 10, 0.2], [u('cup', 'כוס', 150)]),
  food('pickle', 'מלפפון חמוץ', ALL_DAY, [12, 0.3, 2.3, 0.2], [u('unit', 'יחידה', 60)]),
  // — fruit —
  food('orange', 'תפוז', BS, [47, 0.9, 11.8, 0.1], [u('unit', 'יחידה', 160)]),
  food('clementine', 'קלמנטינה', BS, [53, 0.8, 13.3, 0.3], [u('unit', 'יחידה', 75)]),
  food('grapefruit', 'אשכולית', BS, [42, 0.8, 10.7, 0.1], [u('half', 'חצי', 130)]),
  food('pear', 'אגס', BS, [57, 0.4, 15.2, 0.1], [u('unit', 'יחידה', 170)]),
  food('peach', 'אפרסק', BS, [39, 0.9, 9.5, 0.3], [u('unit', 'יחידה', 150)]),
  food('plum', 'שזיף', BS, [46, 0.7, 11.4, 0.3], [u('unit', 'יחידה', 65)]),
  food('apricot', 'משמש', BS, [48, 1.4, 11.1, 0.4], [u('unit', 'יחידה', 35)]),
  food('grapes', 'ענבים', BS, [69, 0.7, 18.1, 0.2], [u('cup', 'כוס', 150)]),
  food('watermelon', 'אבטיח', BS, [30, 0.6, 7.6, 0.2], [u('slice', 'פלח', 280), u('cup', 'כוס קוביות', 150)]),
  food('melon', 'מלון', BS, [34, 0.8, 8.2, 0.2], [u('slice', 'פלח', 160), u('cup', 'כוס קוביות', 160)]),
  food('strawberries', 'תותים', BS, [32, 0.7, 7.7, 0.3], [u('cup', 'כוס', 150), u('unit', 'יחידה', 12)]),
  food('blueberries', 'אוכמניות', BS, [57, 0.7, 14.5, 0.3], [u('cup', 'כוס', 145)]),
  food('mango', 'מנגו', BS, [60, 0.8, 15, 0.4], [u('unit', 'יחידה (נטו)', 200), u('cup', 'כוס קוביות', 165)]),
  food('pineapple', 'אננס', BS, [50, 0.5, 13.1, 0.1], [u('cup', 'כוס קוביות', 165)]),
  food('kiwi', 'קיווי', BS, [61, 1.1, 14.7, 0.5], [u('unit', 'יחידה', 75)]),
  food('pomegranate', 'רימון (גרגירים)', BS, [83, 1.7, 18.7, 1.2], [u('cup', 'כוס', 150)]),
  food('persimmon', 'אפרסמון', BS, [70, 0.6, 18.6, 0.2], [u('unit', 'יחידה', 170)]),
  food('figs', 'תאנה', BS, [74, 0.8, 19.2, 0.3], [u('unit', 'יחידה', 50)]),
  food('cherries', 'דובדבנים', BS, [63, 1.1, 16, 0.2], [u('cup', 'כוס', 140)]),
  food('fruit_salad', 'סלט פירות', BS, [50, 0.6, 12.5, 0.2], [u('cup', 'כוס', 160)]),
  food('dates', 'תמר מג׳הול', BS, [277, 1.8, 75, 0.2], [u('unit', 'יחידה', 24)]),
  food('dried_apricot', 'משמש מיובש', BS, [241, 3.4, 62.6, 0.5], [u('unit', 'יחידה', 8)]),
  food('raisins', 'צימוקים', BS, [299, 3.1, 79.2, 0.5], [u('tbsp', 'כף', 10), u('handful', 'חופן', 30)]),
  // — fats, spreads, nuts and seeds —
  food('avocado', 'אבוקדו', MAIN, [160, 2, 8.5, 14.7], [u('half', 'חצי (נטו)', 75), u('tbsp', 'כף', 15)]),
  food('hummus', 'חומוס (ממרח)', MAIN, [250, 8, 14, 18], [u('tbsp', 'כף', 25), u('plate', 'צלחת', 200)]),
  food('tahini_sauce', 'סלט טחינה (מוכן)', LD, [300, 8.5, 10.5, 27], [u('tbsp', 'כף', 20)], { addOn: true }),
  food('peanut_butter', 'חמאת בוטנים', ['breakfast', ...SNACKS], [588, 25, 20, 50], [u('tbsp', 'כף', 16), u('tsp', 'כפית', 5)], { addOn: true }),
  food('walnuts', 'אגוזי מלך', SNACKS, [654, 15.2, 13.7, 65.2], [u('unit', 'יחידה', 4), u('handful', 'חופן', 30)]),
  food('cashews', 'קשיו', SNACKS, [553, 18.2, 30.2, 43.9], [u('handful', 'חופן', 30)]),
  food('peanuts', 'בוטנים קלויים', SNACKS, [585, 23.7, 21.5, 49.7], [u('handful', 'חופן', 30)]),
  food('pistachios', 'פיסטוקים (קלופים)', SNACKS, [562, 20.2, 27.2, 45.3], [u('handful', 'חופן', 30)]),
  food('sunflower_seeds', 'גרעיני חמנייה (קלופים)', SNACKS, [584, 20.8, 20, 51.5], [u('tbsp', 'כף', 9), u('handful', 'חופן', 30)]),
  food('pumpkin_seeds', 'גרעיני דלעת (קלופים)', SNACKS, [559, 30, 10.7, 49], [u('tbsp', 'כף', 9), u('handful', 'חופן', 30)]),
  food('flaxseed', 'זרעי פשתן טחונים', BD, [534, 18.3, 28.9, 42.2], [u('tbsp', 'כף', 7)], { addOn: true }),
  food('trail_mix', 'מיקס אגוזים ופירות יבשים', SNACKS, [480, 13, 45, 29], [u('handful', 'חופן', 30)]),
  food('olives', 'זיתים', MAIN, [115, 0.8, 6.3, 10.7], [u('unit', 'יחידה', 4), u('handful', 'חופן (10 זיתים)', 40)]),
  food('canola_oil', 'שמן קנולה / צמחי', ALL_DAY, [884, 0, 0, 100], [u('tsp', 'כפית', 4.5), u('tbsp', 'כף', 13.5)], { addOn: true }),
  food('mayonnaise', 'מיונז', ALL_DAY, [680, 1, 0.6, 75], [u('tsp', 'כפית', 5), u('tbsp', 'כף', 14)], { addOn: true }),
  food('ketchup', 'קטשופ', ALL_DAY, [101, 1, 27, 0.1], [u('tbsp', 'כף', 17)], { addOn: true }),
  food('honey', 'דבש', ALL_DAY, [304, 0.3, 82.4, 0], [u('tsp', 'כפית', 7), u('tbsp', 'כף', 21)], { addOn: true }),
  food('silan', 'סילאן (דבש תמרים)', ALL_DAY, [298, 1.5, 73, 0.2], [u('tbsp', 'כף', 20)], { addOn: true }),
  food('jam', 'ריבה', ALL_DAY, [278, 0.4, 69, 0.1], [u('tsp', 'כפית', 7), u('tbsp', 'כף', 20)], { addOn: true }),
  food('sugar', 'סוכר', ALL_DAY, [387, 0, 100, 0], [u('tsp', 'כפית', 4)], { addOn: true }),
  food('choc_spread', 'ממרח שוקולד-אגוזים', ALL_DAY, [539, 6.3, 57.5, 30.9], [u('tsp', 'כפית', 7), u('tbsp', 'כף', 18)], { addOn: true }),
  // — dishes —
  food('shakshuka', 'שקשוקה', MAIN, [110, 5.3, 3.7, 8.2], [u('pan', 'מחבת (2 ביצים)', 300), G100]),
  food('schnitzel', 'שניצל עוף מטוגן', LD, [263, 20, 12, 15], [u('unit', 'יחידה', 130)]),
  food('schnitzel_baked', 'שניצל עוף אפוי בתנור', LD, [198, 24, 12, 6], [u('unit', 'יחידה', 130)]),
  food('shawarma_pita', 'שווארמה בפיתה', LD, [182, 11.6, 15.5, 8.2], [u('unit', 'פיתה מלאה', 380)]),
  food('shawarma_lafa', 'שווארמה בלאפה', LD, [180, 11.8, 15.2, 7.9], [u('unit', 'לאפה מלאה', 480)]),
  food('falafel_pita', 'פלאפל בפיתה', LD, [225, 8, 29.1, 8.5], [u('unit', 'פיתה מלאה', 285)]),
  food('sabich', 'סביח בפיתה', LD, [172, 5.3, 20.2, 7.8], [u('unit', 'פיתה מלאה', 365)]),
  food('majadra', 'מג׳דרה', LD, [150, 5, 24, 3.8], [u('cup', 'כוס', 200)]),
  food('pizza', 'פיצה (גבינה)', LD, [266, 11.4, 33, 9.7], [u('slice', 'משולש', 110)]),
  food('sushi', 'סושי (רול דג וירקות)', LD, [140, 5.5, 25, 2], [u('unit', 'חתיכה', 30), u('roll', 'רול (8 חתיכות)', 220)]),
  food('burger', 'המבורגר בלחמנייה', LD, [225, 15.7, 14.9, 11.3], [u('unit', 'יחידה', 235)]),
  food('chicken_soup', 'מרק עוף עם ירקות', LD, [40, 3.5, 3, 1.5], [u('bowl', 'קערה', 350)]),
  food('lentil_soup', 'מרק עדשים', LD, [70, 4, 10, 1.5], [u('bowl', 'קערה', 350)]),
  food('veg_soup', 'מרק ירקות', LD, [30, 1, 5, 0.6], [u('bowl', 'קערה', 350)]),
  food('israeli_salad', 'סלט ישראלי (עם שמן זית)', MAIN, [66, 0.8, 3.6, 5.5], [u('bowl', 'קערה', 250), u('serving', 'מנה קטנה', 150)]),
  food('tabbouleh', 'טבולה', LD, [122, 2.5, 13, 6.7], [u('serving', 'מנה', 150)]),
  food('coleslaw', 'סלט כרוב במיונז', LD, [152, 1, 10, 12], [u('serving', 'מנה', 100)]),
  food('egg_salad', 'סלט ביצים', BD, [210, 9, 2, 18.5], [u('tbsp', 'כף', 30)]),
  food('tuna_salad', 'סלט טונה (במיונז)', MAIN, [194, 15, 2, 14], [u('tbsp', 'כף', 30)]),
  food('eggplant_mayo', 'סלט חצילים במיונז', MAIN, [221, 1, 6, 21.5], [u('tbsp', 'כף', 30)]),
  food('matbucha', 'מטבוחה', MAIN, [100, 1.5, 9, 6.5], [u('tbsp', 'כף', 30)]),
  food('potato_salad', 'סלט תפוחי אדמה במיונז', LD, [163, 2, 14, 11], [u('serving', 'מנה', 150)]),
  food('chicken_stirfry', 'מוקפץ עוף וירקות', LD, [117, 12, 6, 5], [u('serving', 'מנה', 300)]),
  food('noodles_chicken', 'נודלס מוקפץ עם עוף', LD, [170, 8, 22, 5.5], [u('serving', 'מנה', 350)]),
  food('pasta_tomato', 'פסטה ברוטב עגבניות', LD, [132, 4.5, 24, 2], [u('serving', 'מנה', 300)]),
  food('pasta_cream', 'פסטה ברוטב שמנת', LD, [202, 5, 24, 9.5], [u('serving', 'מנה', 300)]),
  food('lasagna', 'לזניה בשר', LD, [140, 8, 14, 5.8], [u('serving', 'מנה', 250)]),
  food('toast_cheese', 'טוסט גבינה צהובה', MAIN, [289, 13, 30, 13], [u('unit', 'יחידה', 150)]),
  food('bourekas', 'בורקס גבינה', ['breakfast', 'lunch', ...SNACKS], [332, 9, 29, 20], [u('unit', 'יחידה', 100)]),
  food('malawach', 'מלאווח', ['breakfast', 'lunch'], [326, 6, 35, 18], [u('unit', 'יחידה', 120)]),
  food('quiche', 'פשטידת גבינה וירקות', MAIN, [180, 8, 10, 12], [u('slice', 'משולש', 150)]),
  food('stuffed_pepper', 'פלפל ממולא (אורז ובשר)', LD, [109, 5, 12, 4.5], [u('unit', 'יחידה', 250)]),
  food('kubbeh', 'קובה מטוגנת', LD, [270, 10, 25, 14.5], [u('unit', 'יחידה', 60)]),
  food('cholent', 'חמין', LD, [159, 9, 15, 7], [u('serving', 'מנה', 350)]),
  // — snacks and sweets —
  food('bamba', 'במבה', SNACKS, [534, 14.5, 41, 34.7], [u('small', 'שקית קטנה', 25), u('bag', 'שקית', 80)]),
  food('bisli', 'ביסלי', SNACKS, [486, 10, 62, 22], [u('small', 'שקית קטנה', 35), u('bag', 'שקית', 70)]),
  food('potato_chips', 'צ׳יפס בשקית (תפוצ׳יפס)', SNACKS, [536, 7, 53, 34], [u('bag', 'שקית', 50)]),
  food('popcorn', 'פופקורן', SNACKS, [500, 8, 58, 26], [u('cup', 'כוס', 8), u('bag', 'שקית מיקרוגל', 85)]),
  food('pretzels', 'בייגלה', SNACKS, [387, 10, 80, 3], [u('handful', 'חופן', 30)]),
  food('corn_cake', 'פריכית תירס', SNACKS, [379, 8, 80, 3], [u('unit', 'יחידה', 6)]),
  food('dark_chocolate', 'שוקולד מריר 70%', SNACKS, [600, 7.8, 46, 43], [u('square', 'קובייה', 5), u('bar', 'חפיסה', 100)]),
  food('milk_chocolate', 'שוקולד חלב', SNACKS, [535, 7.6, 59.4, 29.7], [u('square', 'קובייה', 5), u('bar', 'חפיסה', 100)]),
  food('chocolate_bar', 'חטיף שוקולד (קרמל ובוטנים)', SNACKS, [480, 7, 60, 23], [u('unit', 'יחידה', 50)]),
  food('wafers', 'ופלים', SNACKS, [500, 5, 65, 24.5], [u('unit', 'יחידה', 10)]),
  food('cookies', 'עוגיות חמאה', SNACKS, [477, 6, 66, 21], [u('unit', 'יחידה', 10)]),
  food('petit_beurre', 'ביסקוויט פתי בר', SNACKS, [438, 7.5, 75, 12], [u('unit', 'יחידה', 6)]),
  food('rugelach', 'רוגלך שוקולד', SNACKS, [433, 6, 55, 21], [u('unit', 'יחידה', 25)]),
  food('yeast_cake', 'עוגת שמרים', SNACKS, [381, 7, 50, 17], [u('slice', 'פרוסה', 60)]),
  food('cheesecake', 'עוגת גבינה אפויה', SNACKS, [262, 9, 25, 14], [u('slice', 'פרוסה', 100)]),
  food('sufganiya', 'סופגנייה', SNACKS, [401, 6, 47, 21], [u('unit', 'יחידה', 80)]),
  food('halva', 'חלווה', SNACKS, [469, 12, 60, 21.5], [u('unit', 'חתיכה', 30)]),
  food('ice_cream', 'גלידה', SNACKS, [209, 3.5, 24, 11], [u('scoop', 'כדור', 65)]),
  food('protein_bar', 'חטיף חלבון', SNACKS, [370, 30, 35, 12], [u('unit', 'יחידה', 55)]),
  food('granola_bar', 'חטיף דגנים', SNACKS, [412, 6, 70, 12], [u('unit', 'יחידה', 30)]),
  // — drinks —
  food('coffee_milk', 'קפה הפוך', ALL_DAY, [47, 2.5, 3.8, 2.4], [u('cup', 'כוס', 250), u('large', 'כוס גדולה', 350)]),
  food('coffee_black', 'קפה שחור / אספרסו', ALL_DAY, [2, 0.1, 0.3, 0], [u('cup', 'כוס', 240)]),
  food('tea', 'תה בלי סוכר', ALL_DAY, [1, 0, 0.2, 0], [u('cup', 'כוס', 240)]),
  food('iced_coffee', 'אייס קפה', SNACKS, [71, 1.5, 14, 1], [u('cup', 'כוס', 350)]),
  food('orange_juice', 'מיץ תפוזים', ALL_DAY, [45, 0.7, 10.4, 0.2], [u('cup', 'כוס', 240)]),
  food('apple_juice', 'מיץ תפוחים', ALL_DAY, [46, 0.1, 11.3, 0.1], [u('cup', 'כוס', 240)]),
  food('smoothie', 'שייק פירות', ALL_DAY, [62, 0.8, 14, 0.3], [u('cup', 'כוס גדולה', 300)]),
  food('soda', 'משקה מוגז ממותק', ALL_DAY, [42, 0, 10.6, 0], [u('can', 'פחית', 330), u('cup', 'כוס', 240)]),
  food('soda_diet', 'משקה מוגז דיאט', ALL_DAY, [1, 0, 0, 0], [u('can', 'פחית', 330), u('cup', 'כוס', 240)]),
  food('beer', 'בירה', ALL_DAY, [43, 0.5, 3.6, 0], [u('bottle', 'בקבוק', 330), u('pint', 'חצי ליטר', 500)], { alcohol100: 3.9 }),
  food('wine_red', 'יין אדום', ALL_DAY, [85, 0.1, 2.6, 0], [u('glass', 'כוס', 150)], { alcohol100: 10.6 }),
  food('wine_white', 'יין לבן', ALL_DAY, [82, 0.1, 2.6, 0], [u('glass', 'כוס', 150)], { alcohol100: 10.3 }),
  food('spirits', 'משקה חריף (ערק / וודקה)', ALL_DAY, [231, 0, 0, 0], [u('shot', 'כוסית', 30)], { alcohol100: 33 }),
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

/* ------------------------------------------------------------ ready meals */

const c = (food: string, unit: string, qty: number): MealComponent => ({ food, unit, qty });
function meal(id: string, name: string, slots: readonly MealSlot[], components: readonly MealComponent[], veg?: 'veg'): CatalogMeal {
  return { kind: 'meal', id, name, slots, components, ...(veg ? { vegetarian: true as const } : {}) };
}

/**
 * "ארוחות מוכנות" — everyday meals for EVERYONE, ONE portion each, built from
 * FOODS (so they price, and re-price, from the same numbers). Israeli
 * everyday plates and simple healthy options, spread over the meals of the
 * day. `vegetarian` marks the ones the meat-free menus may use (eggs and
 * dairy allowed).
 */
export const READY_MEALS: readonly CatalogMeal[] = [
  // — breakfast —
  meal('meal_omelette_salad_slice', 'חביתה, סלט ופרוסה', BD, [c('omelette', 'two', 1), c('salad', 'serving', 1), c('bread_whole', 'slice', 1)], 'veg'),
  meal('meal_israeli_breakfast', 'ארוחת בוקר ישראלית', ['breakfast'], [c('omelette', 'two', 1), c('israeli_salad', 'serving', 1), c('white_cheese5', 'tbsp', 2), c('bread_whole', 'slice', 2), c('olives', 'unit', 5)], 'veg'),
  meal('meal_shakshuka_bread', 'שקשוקה עם לחם', MAIN, [c('shakshuka', 'pan', 1), c('challah', 'slice', 1)], 'veg'),
  meal('meal_cottage_rice_cakes', 'קוטג׳ עם פריכיות', BDS, [c('cottage5', 'tbsp', 4), c('rice_cake', 'unit', 3), c('tomato', 'unit', 1)], 'veg'),
  meal('meal_yogurt_granola_fruit', 'יוגורט עם גרנולה ופרי', BS, [c('yogurt_greek', 'container', 1), c('granola', 'tbsp', 3), c('blueberries', 'cup', 0.5)], 'veg'),
  meal('meal_oat_porridge', 'דייסת שיבולת שועל עם חלב ובננה', ['breakfast'], [c('oats_fine', 'cup', 0.5), c('milk1', 'cup', 1), c('banana', 'unit', 1), c('honey', 'tsp', 1)], 'veg'),
  meal('meal_avocado_toast_egg', 'טוסט אבוקדו עם ביצה', BD, [c('bread_whole', 'slice', 2), c('avocado', 'half', 1), c('egg', 'unit', 1)], 'veg'),
  meal('meal_white_cheese_sandwich', 'כריך גבינה לבנה וירקות', BD, [c('bread_whole', 'slice', 2), c('white_cheese5', 'tbsp', 2), c('cucumber', 'unit', 0.5), c('tomato', 'unit', 0.5)], 'veg'),
  meal('meal_toast_veg', 'טוסט גבינה צהובה עם ירקות', BD, [c('toast_cheese', 'unit', 1), c('cucumber', 'unit', 1), c('bell_pepper', 'unit', 0.5)], 'veg'),
  meal('meal_protein_shake', 'שייק חלבון עם חלב ובננה', BS, [c('whey', 'scoop', 1), c('milk1', 'cup', 1), c('banana', 'unit', 1)], 'veg'),
  meal('meal_muesli_milk', 'מוזלי עם חלב ותפוח', ['breakfast'], [c('muesli', 'cup', 0.5), c('milk1', 'cup', 1), c('apple', 'unit', 0.5)], 'veg'),
  meal('meal_labneh_pita', 'פיתה מלאה עם לבנה, זיתים וירקות', BD, [c('pita_whole', 'unit', 1), c('labneh', 'tbsp', 3), c('olives', 'unit', 5), c('olive_oil', 'tsp', 1), c('cucumber', 'unit', 1)], 'veg'),
  // — lunch —
  meal('meal_chicken_rice_salad', 'חזה עוף, אורז וסלט', LD, [c('chicken_breast', 'serving', 1), c('rice_cooked', 'cup', 1), c('israeli_salad', 'serving', 1)]),
  meal('meal_salmon_sweet_potato', 'סלמון עם בטטה וברוקולי', LD, [c('salmon', 'serving', 1), c('sweet_potato', 'unit', 1), c('broccoli', 'cup', 1)]),
  meal('meal_tuna_pita', 'טונה בפיתה', LD, [c('pita', 'unit', 1), c('tuna_water', 'can', 1), c('mayonnaise', 'tsp', 1), c('tomato', 'unit', 1), c('cucumber', 'unit', 1)]),
  meal('meal_schnitzel_mash', 'שניצל, פירה וסלט', ['lunch'], [c('schnitzel', 'unit', 1), c('mashed_potato', 'cup', 0.75), c('israeli_salad', 'serving', 1)]),
  meal('meal_schnitzel_baked_rice', 'שניצל אפוי, אורז מלא וירקות', LD, [c('schnitzel_baked', 'unit', 1), c('rice_brown', 'cup', 1), c('veg_cooked', 'cup', 1)]),
  meal('meal_majadra_yogurt', 'מג׳דרה עם יוגורט וסלט', LD, [c('majadra', 'cup', 1.5), c('yogurt_plain', 'container', 0.5), c('salad', 'serving', 1)], 'veg'),
  meal('meal_meatballs_bulgur', 'קציצות ברוטב עם בורגול', LD, [c('meatballs_sauce', 'serving', 1), c('bulgur', 'cup', 1)]),
  meal('meal_turkey_quinoa', 'חזה הודו, קינואה וירקות', LD, [c('turkey_breast', 'serving', 1), c('quinoa', 'cup', 1), c('veg_cooked', 'cup', 1)]),
  meal('meal_thigh_couscous', 'פרגית עם קוסקוס וירקות', LD, [c('chicken_thigh', 'unit', 1.5), c('couscous', 'cup', 1), c('veg_cooked', 'cup', 1)]),
  meal('meal_fish_potatoes', 'דג לבן, תפוחי אדמה וסלט', LD, [c('white_fish', 'serving', 1), c('potato_boiled', 'unit', 1), c('salad', 'serving', 1), c('olive_oil', 'tsp', 1)]),
  meal('meal_fillet_potato', 'פילה בקר, תפוח אדמה אפוי וסלט', LD, [c('beef_fillet', 'serving', 1), c('potato_baked', 'unit', 1), c('salad', 'serving', 1)]),
  meal('meal_pasta_tuna', 'פסטה ברוטב עגבניות וטונה', LD, [c('pasta_tomato', 'serving', 1), c('tuna_water', 'can', 1), c('parmesan', 'tbsp', 1)]),
  meal('meal_tofu_rice', 'טופו מוקפץ עם ירקות ואורז מלא', LD, [c('tofu', 'serving', 1), c('veg_cooked', 'cup', 1), c('rice_brown', 'cup', 1), c('canola_oil', 'tsp', 2)], 'veg'),
  meal('meal_chickpea_salad', 'סלט גרגירי חומוס, ירקות וטחינה', LD, [c('chickpeas', 'cup', 1), c('salad', 'bowl', 1), c('tahini', 'tbsp', 1)], 'veg'),
  meal('meal_lentil_soup_bread', 'מרק עדשים עם לחם', LD, [c('lentil_soup', 'bowl', 1), c('bread_whole', 'slice', 2)], 'veg'),
  meal('meal_chicken_soup_challah', 'מרק עוף עם חלה', LD, [c('chicken_soup', 'bowl', 1), c('challah', 'slice', 1)]),
  meal('meal_hummus_plate', 'צלחת חומוס עם ביצה ופיתה', ['lunch'], [c('hummus', 'tbsp', 4), c('egg', 'unit', 1), c('pita', 'unit', 1), c('pickle', 'unit', 1)], 'veg'),
  // — dinner —
  meal('meal_eggs_cheese_salad', 'ביצים, גבינה בולגרית וסלט', BD, [c('egg', 'unit', 2), c('bulgarian5', 'slice', 1), c('salad', 'bowl', 1), c('bread_whole', 'slice', 1)], 'veg'),
  meal('meal_tuna_salad_rice_cakes', 'טונה, סלט ופריכיות', LD, [c('tuna_water', 'can', 1), c('salad', 'serving', 1), c('rice_cake', 'unit', 3)]),
  meal('meal_turkey_sandwich', 'כריך פסטרמה הודו', ['lunch', 'dinner'], [c('bread_whole', 'slice', 2), c('turkey_deli', 'slice', 4), c('tomato', 'unit', 0.5), c('lettuce', 'cup', 0.5)]),
  meal('meal_pizza_salad', 'שני משולשי פיצה וסלט', LD, [c('pizza', 'slice', 2), c('salad', 'bowl', 1)], 'veg'),
  meal('meal_sushi_edamame', 'רול סושי ואדממה', LD, [c('sushi', 'roll', 1), c('edamame', 'cup', 0.5)]),
  meal('meal_burger_salad', 'המבורגר וסלט', LD, [c('burger', 'unit', 1), c('salad', 'serving', 1)]),
  meal('meal_cottage_bread_veg', 'קוטג׳, פרוסות לחם וירקות', BD, [c('cottage5', 'container', 0.5), c('bread_whole', 'slice', 2), c('cucumber', 'unit', 1), c('bell_pepper', 'unit', 0.5)], 'veg'),
  // — between meals —
  meal('meal_apple_pb', 'תפוח עם חמאת בוטנים', SNACKS, [c('apple', 'unit', 1), c('peanut_butter', 'tbsp', 1)], 'veg'),
  meal('meal_fruit_almonds', 'תפוז וחופן שקדים', SNACKS, [c('orange', 'unit', 1), c('almonds', 'handful', 0.5)], 'veg'),
  meal('meal_yogurt_walnuts', 'יוגורט חלבון עם אגוזי מלך', SNACKS, [c('protein_yogurt', 'container', 1), c('walnuts', 'unit', 4)], 'veg'),
  meal('meal_rice_cakes_pb_banana', 'פריכיות עם חמאת בוטנים ובננה', SNACKS, [c('rice_cake', 'unit', 2), c('peanut_butter', 'tbsp', 1), c('banana', 'unit', 0.5)], 'veg'),
  meal('meal_veg_hummus', 'ירקות חתוכים עם חומוס', SNACKS, [c('carrot', 'unit', 1), c('cucumber', 'unit', 1), c('bell_pepper', 'unit', 0.5), c('hummus', 'tbsp', 2)], 'veg'),
  meal('meal_cottage_fruit', 'קוטג׳ עם אננס', SNACKS, [c('cottage5', 'container', 0.5), c('pineapple', 'cup', 0.5)], 'veg'),
  meal('meal_dates_walnuts', 'תמרים ואגוזי מלך', SNACKS, [c('dates', 'unit', 2), c('walnuts', 'unit', 3)], 'veg'),
  meal('meal_coffee_cookies', 'קפה הפוך ושתי עוגיות', SNACKS, [c('coffee_milk', 'cup', 1), c('cookies', 'unit', 2)], 'veg'),
  meal('meal_crackers_cheese', 'קרקרים עם גבינה צהובה', SNACKS, [c('crackers', 'unit', 6), c('yellow_cheese_light', 'slice', 2)], 'veg'),
];

/* ----------------------------------------------------------- daily menus */

/** One meal of a sample day: which ready meal, in which meal of the day. */
export interface MenuItem {
  slot: MealSlot;
  /** A `READY_MEALS` id. */
  meal: string;
}

/**
 * A sample day ("תפריט לדוגמה") around a calorie level. `kcal` is the level
 * it is built for — the priced day lands within a few percent of it
 * (tests/menus.test.ts pins how close). `vegetarian` days use only
 * vegetarian ready meals.
 */
export interface DailyMenu {
  id: string;
  kcal: number;
  vegetarian?: true;
  items: readonly MenuItem[];
}

const day = (id: string, kcal: number, items: readonly [MealSlot, string][], vegetarian?: 'veg'): DailyMenu => ({
  id,
  kcal,
  ...(vegetarian ? { vegetarian: true as const } : {}),
  items: items.map(([slot, m]) => ({ slot, meal: m })),
});

export const DAILY_MENUS: readonly DailyMenu[] = [
  day('menu_1500', 1500, [
    ['breakfast', 'meal_omelette_salad_slice'],
    ['snack_am', 'meal_fruit_almonds'],
    ['lunch', 'meal_chicken_rice_salad'],
    ['snack_pm', 'meal_yogurt_walnuts'],
    ['dinner', 'meal_tuna_salad_rice_cakes'],
  ]),
  day('menu_1800', 1800, [
    ['breakfast', 'meal_israeli_breakfast'],
    ['snack_am', 'meal_fruit_almonds'],
    ['lunch', 'meal_salmon_sweet_potato'],
    ['snack_pm', 'meal_yogurt_walnuts'],
    ['dinner', 'meal_eggs_cheese_salad'],
  ]),
  day('menu_2200', 2200, [
    ['breakfast', 'meal_israeli_breakfast'],
    ['snack_am', 'meal_protein_shake'],
    ['lunch', 'meal_thigh_couscous'],
    ['snack_pm', 'meal_rice_cakes_pb_banana'],
    ['dinner', 'meal_pasta_tuna'],
  ]),
  day('menu_2600', 2600, [
    ['breakfast', 'meal_israeli_breakfast'],
    ['snack_am', 'meal_protein_shake'],
    ['lunch', 'meal_meatballs_bulgur'],
    ['snack_pm', 'meal_rice_cakes_pb_banana'],
    ['dinner', 'meal_pizza_salad'],
    ['other', 'meal_dates_walnuts'],
  ]),
  day(
    'menu_veg_1800',
    1800,
    [
      ['breakfast', 'meal_avocado_toast_egg'],
      ['snack_am', 'meal_yogurt_walnuts'],
      ['lunch', 'meal_majadra_yogurt'],
      ['snack_pm', 'meal_cottage_fruit'],
      ['dinner', 'meal_shakshuka_bread'],
    ],
    'veg',
  ),
  day(
    'menu_veg_2200',
    2200,
    [
      ['breakfast', 'meal_oat_porridge'],
      ['snack_am', 'meal_protein_shake'],
      ['lunch', 'meal_tofu_rice'],
      ['snack_pm', 'meal_veg_hummus'],
      ['dinner', 'meal_pizza_salad'],
      ['other', 'meal_dates_walnuts'],
    ],
    'veg',
  ),
];
