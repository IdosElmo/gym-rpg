/**
 * i18n/locale.ts — which language the app is speaking right now.
 *
 * ONE PIECE OF MODULE STATE. The shell (`ui/app.ts`) sets it from
 * `UiState.locale` at the top of every render, so every template string built
 * during that render reads the same language, and a fresh store (every test)
 * renders Hebrew exactly as the app always has. Nothing else may call
 * `setLocale` — a screen that switched language mid-render would paint half a
 * page in each.
 *
 * Language is PRESENTATION, never data. No reducer, no event payload and no
 * game rule may read it: two devices of one account in two languages replay the
 * same log to the same state. (A string the USER saves — a plan's day label, a
 * custom exercise — is stored in whatever language it was typed in, like any
 * other user content.)
 *
 * CATALOGS. Copy lives in `i18n/messages/*.ts`, one module per area, each
 * exporting `he` and `en` objects of the SAME type (`en: typeof he`), so tsc
 * refuses an English catalog with a missing key or a different signature.
 * `tr(catalog)` hands back the half for the current locale. A third language is
 * one more object per module plus one entry in `LOCALES`.
 */

export type Locale = 'he' | 'en';

/** Every locale the app ships, in the order the settings picker lists them. */
export const LOCALES: readonly Locale[] = ['he', 'en'] as const;

/** The language a store that never chose one renders in — the app's original. */
export const DEFAULT_LOCALE: Locale = 'he';

/** Each language's name in ITSELF — what the picker shows. */
export const LOCALE_NATIVE_NAME: Readonly<Record<Locale, string>> = {
  he: 'עברית',
  en: 'English',
};

/** BCP-47 tag handed to `Intl` for formatting. */
export const LOCALE_TAG: Readonly<Record<Locale, string>> = {
  he: 'he-IL',
  en: 'en-US',
};

let current: Locale = DEFAULT_LOCALE;

export function locale(): Locale {
  return current;
}

/** Shell-only: see the module comment. */
export function setLocale(l: Locale): void {
  current = l;
}

export function isLocale(v: unknown): v is Locale {
  return v === 'he' || v === 'en';
}

export function dirOf(l: Locale = current): 'rtl' | 'ltr' {
  return l === 'he' ? 'rtl' : 'ltr';
}

export function isRtl(): boolean {
  return dirOf() === 'rtl';
}

/**
 * The locale a FRESH install should start in, from the browser's language list
 * (`navigator.languages`). Hebrew (`he`, and the pre-2009 code `iw`) anywhere in
 * the list wins — an Israeli phone set to English usually still lists Hebrew —
 * and everything else gets English, the one other language there is.
 */
export function detectLocale(langs: readonly string[]): Locale {
  for (const raw of langs) {
    const tag = raw.toLowerCase();
    if (tag === 'he' || tag === 'iw' || tag.startsWith('he-') || tag.startsWith('iw-')) return 'he';
  }
  return 'en';
}

/** A message catalog: the Hebrew original, and every other locale with the SAME shape. */
export type Catalog<T> = { readonly he: T } & { readonly [L in Exclude<Locale, 'he'>]: T };

/** The current locale's half of a catalog. */
export function tr<T>(cat: Catalog<T>): T {
  return cat[current];
}

/**
 * The reader's half of a content object that already carries both names —
 * worlds, enemies and equipment have `he` + `en` side by side. An empty English
 * name falls back to the Hebrew one.
 */
export function pick(o: { readonly he: string; readonly en: string }): string {
  return current === 'en' && o.en.trim() !== '' ? o.en : o.he;
}
