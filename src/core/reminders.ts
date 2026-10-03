/**
 * core/reminders.ts — the 🔔 meal-reminder schedule, as the app hands it over.
 *
 * The reminders are SENT by the server (the `meal-reminders` Edge Function, on
 * an hourly cron) — a phone's browser cannot wake itself on a clock. But what
 * they say is decided HERE, from the same `MEAL_SLOTS` windows and the same
 * food catalog the screen uses, and uploaded with the device's push
 * subscription. So the server hardcodes nothing: a new window or a new catalog
 * reaches it the next time the app opens.
 *
 * A window's suggestions are the user's fixed meals that fit it; a window
 * with none suggests the READY meals that fit it ("ארוחות מוכנות" — whole
 * meals, not ingredients), and only a window with neither falls back to its
 * foods — never an add-on (oil, spray, tahini…), which is not a meal on its
 * own. At most `SUGGESTIONS_MAX` per window: the server keeps no more.
 */

import { FIXED_MEALS, FOODS, READY_MEALS, type CatalogMeal } from '../data/foods.ts';
import type { MealSlot } from '../storage/DataStore.ts';
import { MEAL_SLOTS } from './nutrition.ts';

export interface ReminderWindow {
  slot: MealSlot;
  /** The meal's heading ("ארוחת בוקר"). */
  label: string;
  /** 'HH:MM' — the reminder fires at the start of this hour. */
  from: string;
  to: string;
  /** What to suggest, one picked at random per reminder. Never empty. */
  suggestions: string[];
}

/** The meal-reminders function reads at most this many suggestions per window. */
export const SUGGESTIONS_MAX = 40;

/** What the catalog suggests for one meal of the day. */
export function suggestionsFor(slot: MealSlot, mine: readonly CatalogMeal[] = FIXED_MEALS): string[] {
  const meals = mine.filter((m) => m.slots.includes(slot)).map((m) => m.name);
  if (meals.length > 0) return meals.slice(0, SUGGESTIONS_MAX);
  const ready = READY_MEALS.filter((m) => m.slots.includes(slot)).map((m) => m.name);
  if (ready.length > 0) return ready.slice(0, SUGGESTIONS_MAX);
  return FOODS.filter((f) => f.slots.includes(slot) && !f.addOn)
    .map((f) => f.name)
    .slice(0, SUGGESTIONS_MAX);
}

/** Every windowed meal (not נשנושים / אחר) with its suggestions. */
export function reminderSchedule(mine: readonly CatalogMeal[] = FIXED_MEALS): ReminderWindow[] {
  const out: ReminderWindow[] = [];
  for (const s of MEAL_SLOTS) {
    if (s.from === null || s.to === null) continue;
    out.push({ slot: s.key, label: s.label, from: s.from, to: s.to, suggestions: suggestionsFor(s.key, mine) });
  }
  return out;
}
