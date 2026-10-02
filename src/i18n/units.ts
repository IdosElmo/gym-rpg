/**
 * i18n/units.ts — metric or imperial, for DISPLAY and INPUT only.
 *
 * STORAGE IS ALWAYS METRIC. A set's `w`, a weigh-in's `kg`, every tonnage and
 * every XP formula stay in kilograms whatever the user reads on screen, so a
 * log written in pounds on one phone and read in kilograms on another is the
 * same log, and no reducer ever has to know a unit exists. The conversion
 * happens at the two edges of the UI and nowhere else:
 *
 *   - `toDisplayLoad(kg)`  — stored kilograms -> the number shown / prefilled;
 *   - `fromInputLoad(txt)` — what the user typed -> the kilograms to store.
 *
 * A pound value is stored to three decimals of a kilogram (135 lb -> "61.235"),
 * which round-trips back to the exact pound figure the user typed at the one
 * decimal the screen shows. In METRIC both functions are the identity on the
 * string — the app's original behaviour, byte for byte.
 *
 * Like the locale, the unit system is shell-set module state (`setUnits` from
 * `UiState.units` at the top of every render).
 */

import { locale } from './locale.ts';

export type UnitSystem = 'metric' | 'imperial';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'] as const;

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

let current: UnitSystem = 'metric';

export function units(): UnitSystem {
  return current;
}

/** Shell-only, like `setLocale`. */
export function setUnits(u: UnitSystem): void {
  current = u;
}

export function isUnitSystem(v: unknown): v is UnitSystem {
  return v === 'metric' || v === 'imperial';
}

/**
 * The unit system a fresh install starts in: imperial only where the browser
 * says the user lives in a pound country (US, Liberia, Myanmar). Everyone
 * else — including English speakers in the UK, Canada and Australia, whose gyms
 * are metric — gets kilograms.
 */
export function detectUnits(langs: readonly string[]): UnitSystem {
  const first = (langs[0] ?? '').toLowerCase();
  return /-(us|lr|mm)$/.test(first) ? 'imperial' : 'metric';
}

/** Round to `d` decimals and drop trailing zeros: 61.2349 -> "61.235", 60 -> "60". */
function trim(n: number, d: number): string {
  const f = 10 ** d;
  return String(Math.round(n * f) / f);
}

/** Short unit of a LOAD or a BODY WEIGHT: ק"ג / kg / lb. */
export function weightUnit(): string {
  if (current === 'imperial') return 'lb';
  return locale() === 'he' ? 'ק"ג' : 'kg';
}

/** Stored kilograms -> what the screen shows. Metric: the stored string as-is. */
export function toDisplayLoad(kg: string | number): string {
  if (current === 'metric') return typeof kg === 'number' ? String(kg) : kg;
  const n = typeof kg === 'number' ? kg : Number(kg);
  if (typeof kg === 'string' && kg.trim() === '') return '';
  if (!Number.isFinite(n)) return String(kg);
  return trim(n / KG_PER_LB, 1);
}

/** What the user typed -> the kilograms to store. Metric: the typed string as-is. */
export function fromInputLoad(text: string): string {
  if (current === 'metric') return text;
  const t = text.trim();
  if (t === '') return '';
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return text;
  return trim(n * KG_PER_LB, 3);
}

/** A kilogram NUMBER in the display unit (charts, totals, deltas). */
export function kgToDisplay(kg: number): number {
  return current === 'metric' ? kg : kg / KG_PER_LB;
}

/** A display-unit NUMBER back to kilograms. */
export function displayToKg(v: number): number {
  return current === 'metric' ? v : v * KG_PER_LB;
}

/** Centimetres -> "180 ס״מ" / "180 cm" / "5′11″". */
export function fmtHeight(cm: number): string {
  if (current === 'imperial') {
    const totalIn = Math.round(cm / CM_PER_IN);
    return `${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
  }
  return `${Math.round(cm)} ${locale() === 'he' ? 'ס״מ' : 'cm'}`;
}

/** Feet + inches -> centimetres (one decimal). */
export function ftInToCm(ft: number, inches: number): number {
  return Math.round((ft * 12 + inches) * CM_PER_IN * 10) / 10;
}
