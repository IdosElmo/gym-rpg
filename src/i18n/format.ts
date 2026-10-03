/**
 * i18n/format.ts — locale-aware formatting that is not a sentence: weekday
 * names, dates, numbers, plurals and the order a week is DRAWN in.
 *
 * Hebrew output is byte-identical to what the app printed before i18n existed
 * (the DOM tests pin it), so the Hebrew branches below are the old code paths
 * verbatim, and only the English branches are new.
 */

import { LOCALE_TAG, locale, type Locale } from './locale.ts';

const WEEKDAY: Readonly<Record<Locale, readonly string[]>> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

/** One- or two-letter names for chips too narrow for a whole word. */
const WEEKDAY_SHORT: Readonly<Record<Locale, readonly string[]>> = {
  he: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

/** Three-letter names, for compact captions ("Sun · Wed"). */
const WEEKDAY_ABBR: Readonly<Record<Locale, readonly string[]>> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Weekday name, indexed like `Date#getDay()` (0 = Sunday). `''` out of range. */
export function weekdayName(i: number): string {
  return WEEKDAY[locale()][i] ?? '';
}

/** One/two-letter weekday name (plan editor chips). */
export function weekdayShort(i: number): string {
  return WEEKDAY_SHORT[locale()][i] ?? '';
}

/** Compact weekday name for captions — the full word in Hebrew, "Wed" in English. */
export function weekdayAbbr(i: number): string {
  return WEEKDAY_ABBR[locale()][i] ?? '';
}

/**
 * The weekday a week is DRAWN from: Sunday in Hebrew, Monday in English.
 *
 * DISPLAY ONLY. The game's week (the streak, the league, the 🔵 grading —
 * `weekStartISO` in core/xp.ts) stays Sunday–Saturday for everyone: it is folded
 * from the event log and compared across accounts on the server, so it may not
 * depend on a device preference. This only reorders calendars and pickers.
 */
export function weekStartDay(): number {
  return locale() === 'he' ? 0 : 1;
}

/** The seven weekday indexes in display order (`[0..6]` or `[1..6, 0]`). */
export function weekdayOrder(): number[] {
  const s = weekStartDay();
  return Array.from({ length: 7 }, (_, i) => (s + i) % 7);
}

/**
 * "2025-03-07" -> "07.03.2025" in Hebrew (the legacy format, unchanged) and
 * "Mar 7, 2025" in English, where a dotted day-first date reads as March 7th
 * to half the audience and July 3rd to the other half.
 */
export function fmtDateISO(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (locale() === 'he') return `${d}.${m}.${y}`;
  const mi = Number(m) - 1;
  const month = MONTH_SHORT_EN[mi];
  if (month === undefined || !y || !d) return `${d}.${m}.${y}`;
  return `${month} ${Number(d)}, ${y}`;
}

/** "Mar 7" / "07.03" — a date inside the current year, where the year is noise. */
export function fmtDayMonth(iso: string): string {
  const [, m, d] = iso.split('-');
  if (locale() === 'he') return `${d}.${m}`;
  const month = MONTH_SHORT_EN[Number(m) - 1];
  return month === undefined ? `${d}.${m}` : `${month} ${Number(d)}`;
}

/** A number with the locale's grouping ("12,345"); `maxFrac` decimals at most. */
export function fmtNum(n: number, maxFrac = 0): string {
  return n.toLocaleString(LOCALE_TAG[locale()], { maximumFractionDigits: maxFrac });
}

/**
 * Plural selection by the locale's CLDR rules. Hebrew has a dedicated `two`
 * ("יומיים", "שבועיים"), English does not — so `two` is optional and falls back
 * to `other`; `one` falls back to `other` too.
 */
export function plural(n: number, forms: { one?: string; two?: string; other: string }): string {
  const cat = new Intl.PluralRules(LOCALE_TAG[locale()]).select(n);
  if (cat === 'one' && forms.one !== undefined) return forms.one;
  if (cat === 'two' && forms.two !== undefined) return forms.two;
  return forms.other;
}
