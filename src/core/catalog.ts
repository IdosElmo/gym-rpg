/**
 * core/catalog.ts — pricing a catalog pick, in code.
 *
 * A pick from the built-in catalog (data/foods.ts) is priced HERE, at log
 * time: grams = unit weight × quantity, calories = grams × kcal/100 g, summed
 * over a fixed meal's components. No model, no network, no clock — the same
 * pick always prices the same, which is the whole point of the catalog. The
 * result becomes an ordinary `meal_logged` (source `catalog`) whose payload
 * carries the numbers AND the priced lines, frozen: correcting the catalog
 * later never rewrites what was logged.
 *
 * The catalog also rides along with every ✨ estimate as HINTS
 * (`catalogHints`): the estimator uses a catalog value when an ingredient
 * clearly is that food, and prices everything else on its own.
 *
 * Carbs and fat are priced exactly like protein (stage ז). The ready meals
 * (`READY_MEALS`) are catalog entries like the fixed meals, offered to
 * everyone in their own group; the user's own saved meals ("הארוחות שלי",
 * `state.nutrition.templates`) log through `templateMealInput` — a saved pick
 * re-prices from here, a saved free-text meal keeps its own numbers.
 */

import {
  DAILY_MENUS,
  FIXED_MEALS,
  FOODS,
  READY_MEALS,
  type CatalogEntry,
  type CatalogFood,
  type CatalogMeal,
  type FoodUnit,
} from '../data/foods.ts';
import type { MealAiItem, MealSlot, MealTemplatePick, NutritionState } from '../storage/DataStore.ts';
import { CATALOG_MAX_QTY, MEAL_SLOTS, type MealInput, type MealRow, type TemplateInput, type TemplateRow } from './nutrition.ts';

/** A fixed meal's one unit. */
export const PORTION: FoodUnit = { id: 'portion', label: 'מנה', grams: 0 };

const BY_ID: ReadonlyMap<string, CatalogEntry> = new Map<string, CatalogEntry>(
  [...FIXED_MEALS, ...READY_MEALS, ...FOODS].map((e) => [e.id, e]),
);

export function catalogEntry(id: string): CatalogEntry | null {
  return BY_ID.get(id) ?? null;
}

export function unitsOf(entry: CatalogEntry): readonly FoodUnit[] {
  return entry.kind === 'meal' ? [PORTION] : entry.units;
}

/**
 * "הארוחות שלי" — the fixed meals THIS user has: the ones they have logged
 * from the catalog at least once.
 *
 * The fixed meals in `data/foods.ts` are the original owners' own breakfasts
 * (oats with soy milk and whey, eggs with salad). Shown to everyone, they read
 * as somebody else's diary; shown to nobody, the two people who eat them every
 * morning lose a one-tap pick. Deriving them from the log does both without a
 * migration or a new event: whoever has eaten one keeps it, a stranger never
 * sees it. (The user's OWN saved meals are templates — `state.nutrition.templates`.)
 * Order: catalog order. Deleted meals still count — having eaten it is enough.
 */
export function myFixedMeals(nutrition: Pick<NutritionState, 'meals'>): CatalogMeal[] {
  const logged = new Set<string>();
  for (const rec of Object.values(nutrition.meals)) {
    if (rec.source === 'catalog' && rec.catalog) logged.add(rec.catalog.id);
  }
  return FIXED_MEALS.filter((m) => logged.has(m.id));
}

/**
 * What the add form lists for a meal: the user's fixed meals first, then
 * foods, each in catalog order. With `all`, the rest of the catalog follows
 * the fitting ones. `mine` defaults to every fixed meal (the catalog as data).
 */
export function entriesForSlot(
  slot: MealSlot,
  all: boolean,
  mine: readonly CatalogMeal[] = FIXED_MEALS,
): { fits: CatalogEntry[]; rest: CatalogEntry[] } {
  const every: CatalogEntry[] = [...mine, ...FOODS];
  const fits = every.filter((e) => e.slots.includes(slot));
  const rest = all ? every.filter((e) => !e.slots.includes(slot)) : [];
  return { fits, rest };
}

/**
 * "ארוחות מוכנות" for a meal of the day — everyone's, in catalog order: the
 * ones that fit, then (with `all`) the rest. A separate list from
 * `entriesForSlot`, so the picker can give them their own group.
 */
export function readyForSlot(slot: MealSlot | null, all: boolean): { fits: CatalogMeal[]; rest: CatalogMeal[] } {
  if (slot === null) return { fits: [...READY_MEALS], rest: [] };
  const fits = READY_MEALS.filter((m) => m.slots.includes(slot));
  const rest = all ? READY_MEALS.filter((m) => !m.slots.includes(slot)) : [];
  return { fits, rest };
}

/* ------------------------------------------------------------ quantities */

const FRACTIONS: Readonly<Record<string, number>> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const GLYPHS: readonly [number, string][] = [
  [0.25, '¼'],
  [0.5, '½'],
  [0.75, '¾'],
];

/**
 * Read a typed quantity: "1", "0.5", "0,5", "1/2", "1 1/2", "½", "1½".
 * `null` for anything else, zero, or more than `CATALOG_MAX_QTY`.
 */
export function parseQty(raw: string): number | null {
  let t = raw.trim().replace(',', '.');
  if (!t) return null;
  let whole = 0;
  const glyph = t.slice(-1);
  const frac = FRACTIONS[glyph];
  if (frac !== undefined) {
    const head = t.slice(0, -1).trim();
    whole = head === '' ? 0 : Number(head);
    if (!Number.isFinite(whole) || whole < 0 || !/^\d*$/.test(head)) return null;
    return finish(whole + frac);
  }
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return finish(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]));
  const simple = /^(\d+)\/(\d+)$/.exec(t);
  if (simple) return finish(Number(simple[1]) / Number(simple[2]));
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  t = t.startsWith('.') ? `0${t}` : t;
  return finish(Number(t));
}

function finish(q: number): number | null {
  if (!Number.isFinite(q) || q <= 0 || q > CATALOG_MAX_QTY) return null;
  return Math.round(q * 100) / 100;
}

/** 0.5 → "½", 1.5 → "1½", 0.3 → "0.3" — how a quantity reads in a name. */
export function fmtQty(q: number): string {
  const whole = Math.floor(q);
  const rest = Math.round((q - whole) * 100) / 100;
  const glyph = GLYPHS.find(([v]) => v === rest)?.[1];
  if (rest === 0) return String(whole);
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  return String(Math.round(q * 100) / 100);
}

/* --------------------------------------------------------------- pricing */

export interface CatalogPrice {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** One line per food (one for a food, one per component for a meal). */
  lines: MealAiItem[];
}

interface Exact {
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

function exactOf(food: CatalogFood, unit: FoodUnit, qty: number): Exact {
  const grams = unit.grams * qty;
  return {
    grams,
    kcal: (grams * food.kcal100) / 100,
    protein: (grams * food.protein100) / 100,
    carbs: (grams * food.carbs100) / 100,
    fat: (grams * food.fat100) / 100,
  };
}

/**
 * The names a priced line carries. The default is the catalog's own (Hebrew)
 * text — what a logged pick freezes into its payload. A screen that renders a
 * price LIVE from the catalog may pass the reader's language instead
 * (i18n/foodText.ts); this module never reads the locale itself.
 */
export interface CatalogNames {
  food: (food: CatalogFood) => string;
  unit: (food: CatalogFood, unit: FoodUnit) => string;
}

const STORED_NAMES: CatalogNames = { food: (f) => f.name, unit: (_f, u) => u.label };

function lineOf(food: CatalogFood, unit: FoodUnit, qty: number, e: Exact, names: CatalogNames): MealAiItem {
  return {
    name: names.food(food),
    quantity: `${fmtQty(qty)} ${names.unit(food, unit)}`,
    grams: Math.round(e.grams),
    kcal: Math.round(e.kcal),
    proteinG: Math.round(e.protein),
    assumed: false,
  };
}

/**
 * Price `qty` units of a catalog entry, or `null` for an unknown entry, unit
 * or a bad quantity. Totals are rounded ONCE, from the exact sums — not the
 * sum of the rounded lines.
 */
export function priceCatalog(
  id: string,
  unitId: string,
  qty: number,
  names: CatalogNames = STORED_NAMES,
): CatalogPrice | null {
  const entry = catalogEntry(id);
  if (!entry || !Number.isFinite(qty) || qty <= 0 || qty > CATALOG_MAX_QTY) return null;
  const parts: { food: CatalogFood; unit: FoodUnit; qty: number }[] = [];
  if (entry.kind === 'food') {
    const unit = entry.units.find((u) => u.id === unitId);
    if (!unit) return null;
    parts.push({ food: entry, unit, qty });
  } else {
    if (unitId !== PORTION.id) return null;
    for (const c of entry.components) {
      const food = catalogEntry(c.food);
      const unit = food?.kind === 'food' ? food.units.find((u) => u.id === c.unit) : undefined;
      if (!food || food.kind !== 'food' || !unit) return null;
      parts.push({ food, unit, qty: c.qty * qty });
    }
  }
  let kcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  const lines: MealAiItem[] = [];
  for (const p of parts) {
    const e = exactOf(p.food, p.unit, p.qty);
    kcal += e.kcal;
    protein += e.protein;
    carbs += e.carbs;
    fat += e.fat;
    lines.push(lineOf(p.food, p.unit, p.qty, e, names));
  }
  return {
    calories: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    lines,
  };
}

/** How a pick reads in the meal list: "½ כוס שיבולת שועל דקה", "שיבולת שועל", "2 מנות · שיבולת שועל". */
export function catalogName(entry: CatalogEntry, unit: FoodUnit, qty: number): string {
  if (entry.kind === 'meal') {
    if (qty === 1) return entry.name;
    return `${fmtQty(qty)} ${qty < 1 ? 'מנה' : 'מנות'} · ${entry.name}`;
  }
  return `${fmtQty(qty)} ${unit.label} ${entry.name}`;
}

export interface CatalogPick {
  id: string;
  unit: string;
  qty: number;
  date: string;
  slot: MealSlot;
  /** 'HH:MM' or ''. */
  time: string;
}

/** The `MealInput` for a catalog pick, or `null` when it does not price. */
export function catalogMealInput(pick: CatalogPick): MealInput | null {
  const entry = catalogEntry(pick.id);
  const price = priceCatalog(pick.id, pick.unit, pick.qty);
  const unit = entry ? unitsOf(entry).find((u) => u.id === pick.unit) : undefined;
  if (!entry || !price || !unit) return null;
  return {
    date: pick.date,
    name: catalogName(entry, unit, pick.qty),
    calories: price.calories,
    protein: price.protein,
    carbs: price.carbs,
    fat: price.fat,
    time: pick.time,
    source: 'catalog',
    slot: pick.slot,
    catalog: { id: entry.id, unit: unit.id, qty: pick.qty, lines: price.lines },
  };
}

/* ------------------------------------------------------- my saved meals */

/**
 * What "שמירת ארוחה משלי" stores for a logged meal: its name and numbers, and —
 * for a catalog pick — the pick itself, so the saved meal re-prices from the
 * catalog every time it is logged.
 */
export function templateFromMeal(row: Pick<MealRow, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'catalog'>): TemplateInput {
  const pick: MealTemplatePick | undefined = row.catalog
    ? { id: row.catalog.id, unit: row.catalog.unit, qty: row.catalog.qty }
    : undefined;
  return {
    name: row.name,
    calories: row.calories,
    protein: row.protein,
    ...(row.carbs !== undefined ? { carbs: row.carbs } : {}),
    ...(row.fat !== undefined ? { fat: row.fat } : {}),
    ...(pick ? { pick } : {}),
  };
}

/**
 * The `MealInput` for logging a saved meal into a day's slot. A saved catalog
 * pick is priced afresh (a `catalog` meal under the template's name); one
 * whose pick no longer prices, or a free-text one, is logged with its own
 * numbers as a `manual` meal.
 */
export function templateMealInput(
  tpl: TemplateRow,
  at: { date: string; slot: MealSlot; time: string },
): MealInput {
  const fromCatalog = tpl.pick ? catalogMealInput({ ...tpl.pick, ...at }) : null;
  if (fromCatalog) return { ...fromCatalog, name: tpl.name };
  return {
    date: at.date,
    name: tpl.name,
    calories: tpl.calories,
    protein: tpl.protein,
    ...(tpl.carbs !== undefined ? { carbs: tpl.carbs } : {}),
    ...(tpl.fat !== undefined ? { fat: tpl.fat } : {}),
    time: at.time,
    source: 'manual',
    slot: at.slot,
  };
}

/* ----------------------------------------------------------------- hints */

/** Trim a per-100 g value for a prompt: 13.2 stays, 884.0 → 884. */
function num(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * How many hint lines one request carries — the estimate-meal function reads
 * at most this many (its `MAX_CATALOG_LINES`) and drops the rest.
 */
export const HINT_MAX_LINES = 120;

/**
 * The catalog as prompt lines for the estimator — one per fixed meal of the
 * user's (its components) and one per food (units in grams, values per
 * 100 g), in that order, capped at `HINT_MAX_LINES`: the user's own meals
 * first, then the foods in catalog order (staples before dishes and sweets).
 * The estimate-meal function treats them as HINTS: a clear match uses them,
 * no match is priced as usual.
 */
export function catalogHints(mine: readonly CatalogMeal[] = FIXED_MEALS): string[] {
  const foods = FOODS.map((f) => {
    const units = f.units.map((u) => `${u.label}=${num(u.grams)} ג׳`).join(', ');
    return `${f.name}: ${units}; ${num(f.kcal100)} קק״ל ו-${num(f.protein100)} ג׳ חלבון ל-100 ג׳`;
  });
  const meals = mine.map((m) => {
    const parts = m.components
      .map((c) => {
        const food = catalogEntry(c.food);
        const unit = food?.kind === 'food' ? food.units.find((u) => u.id === c.unit) : undefined;
        return food && unit ? `${fmtQty(c.qty)} ${unit.label} ${food.name}` : '';
      })
      .filter(Boolean)
      .join(' + ');
    return `ארוחה קבועה "${m.name}" (מנה אחת) = ${parts}`;
  });
  return [...meals, ...foods].slice(0, HINT_MAX_LINES);
}

/* ------------------------------------------------------------- integrity */

/** How far a food's stated kcal may sit from its macros' 4/4/9 (+7 alcohol) energy. */
const ENERGY_TOLERANCE = 0.12;
const ENERGY_SLACK_KCAL = 12;

/**
 * Everything that would make the catalog lie, as Hebrew-free test messages:
 * duplicate ids, a food without units or values, macros that do not add up to
 * the calories, a meal naming a missing food or unit, an unknown meal slot, a
 * daily menu naming a missing ready meal or a meal that does not fit its slot.
 * The catalog test pins this to `[]`.
 */
export function catalogProblems(): string[] {
  const out: string[] = [];
  const slots = new Set<string>(MEAL_SLOTS.map((s) => s.key));
  const seen = new Set<string>();
  for (const e of [...FIXED_MEALS, ...READY_MEALS, ...FOODS]) {
    if (seen.has(e.id)) out.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!e.name.trim()) out.push(`${e.id}: no name`);
    if (e.slots.length === 0) out.push(`${e.id}: no slots`);
    for (const s of e.slots) if (!slots.has(s)) out.push(`${e.id}: unknown slot ${s}`);
    if (e.kind === 'food') {
      if (!(e.kcal100 >= 0 && e.kcal100 <= 900)) out.push(`${e.id}: kcal100 out of range`);
      if (!(e.protein100 >= 0 && e.protein100 <= 100)) out.push(`${e.id}: protein100 out of range`);
      if (!(e.carbs100 >= 0 && e.carbs100 <= 100)) out.push(`${e.id}: carbs100 out of range`);
      if (!(e.fat100 >= 0 && e.fat100 <= 100)) out.push(`${e.id}: fat100 out of range`);
      const alcohol = e.alcohol100 ?? 0;
      if (e.protein100 + e.carbs100 + e.fat100 + alcohol > 100) out.push(`${e.id}: macros exceed 100 g`);
      const energy = 4 * e.protein100 + 4 * e.carbs100 + 9 * e.fat100 + 7 * alcohol;
      if (Math.abs(energy - e.kcal100) > Math.max(e.kcal100 * ENERGY_TOLERANCE, ENERGY_SLACK_KCAL)) {
        out.push(`${e.id}: kcal100 ${e.kcal100} vs macros ${Math.round(energy)}`);
      }
      if (e.units.length === 0) out.push(`${e.id}: no units`);
      const uids = new Set<string>();
      for (const u of e.units) {
        if (uids.has(u.id)) out.push(`${e.id}: duplicate unit ${u.id}`);
        uids.add(u.id);
        if (!(u.grams > 0)) out.push(`${e.id}.${u.id}: grams must be positive`);
      }
    } else {
      if (e.components.length === 0) out.push(`${e.id}: no components`);
      for (const c of e.components) {
        const food = BY_ID.get(c.food);
        if (!food || food.kind !== 'food') out.push(`${e.id}: unknown food ${c.food}`);
        else if (!food.units.some((u) => u.id === c.unit)) out.push(`${e.id}: ${c.food} has no unit ${c.unit}`);
        if (!(c.qty > 0)) out.push(`${e.id}: ${c.food} qty must be positive`);
      }
    }
  }
  const ready = new Map<string, CatalogMeal>(READY_MEALS.map((m) => [m.id, m]));
  const menuIds = new Set<string>();
  for (const menu of DAILY_MENUS) {
    if (menuIds.has(menu.id)) out.push(`duplicate menu ${menu.id}`);
    menuIds.add(menu.id);
    if (menu.items.length === 0) out.push(`${menu.id}: no meals`);
    for (const it of menu.items) {
      const m = ready.get(it.meal);
      if (!m) out.push(`${menu.id}: unknown ready meal ${it.meal}`);
      else {
        if (!m.slots.includes(it.slot)) out.push(`${menu.id}: ${it.meal} does not fit ${it.slot}`);
        if (menu.vegetarian && !m.vegetarian) out.push(`${menu.id}: ${it.meal} is not vegetarian`);
      }
    }
  }
  return out;
}
