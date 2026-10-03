/**
 * The i18n core: locale/units detection, the metric-storage round trip,
 * locale-aware formatting, rep-scheme translation, and the rule that a
 * device's language and units are PREFERENCES — they survive normalisation,
 * "delete all data" and a restored backup, and no event ever records them.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { detectLocale, setLocale, tr, type Catalog } from '../src/i18n/locale.ts';
import { detectUnits, fromInputLoad, setUnits, toDisplayLoad, weightUnit } from '../src/i18n/units.ts';
import { fmtDateISO, plural, weekdayName, weekdayOrder } from '../src/i18n/format.ts';
import { repsText } from '../src/i18n/content.ts';
import { fmtDate } from '../src/core/workout.ts';
import { weekdaysCaption } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { STATE_KEY, type StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

afterEach(() => {
  setLocale('he');
  setUnits('metric');
});

describe('detection', () => {
  it('Hebrew anywhere in the browser list wins; everything else is English', () => {
    expect(detectLocale(['he-IL'])).toBe('he');
    expect(detectLocale(['en-US', 'he'])).toBe('he');
    expect(detectLocale(['iw'])).toBe('he');
    expect(detectLocale(['en-GB', 'fr'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('pounds only for a pound country', () => {
    expect(detectUnits(['en-US'])).toBe('imperial');
    expect(detectUnits(['en-GB'])).toBe('metric');
    expect(detectUnits(['he-IL', 'en-US'])).toBe('metric');
    expect(detectUnits([])).toBe('metric');
  });
});

describe('catalogs', () => {
  it('tr hands back the current locale half', () => {
    const cat: Catalog<{ hi: string }> = { he: { hi: 'שלום' }, en: { hi: 'Hello' } };
    expect(tr(cat).hi).toBe('שלום');
    setLocale('en');
    expect(tr(cat).hi).toBe('Hello');
  });
});

describe('units — storage is always kilograms', () => {
  it('metric is the identity on the typed string (the original behaviour)', () => {
    expect(fromInputLoad('62.5')).toBe('62.5');
    expect(toDisplayLoad('62.5')).toBe('62.5');
    expect(fromInputLoad('')).toBe('');
    expect(weightUnit()).toBe('ק"ג');
  });

  it('pounds are stored as kilograms and read back as the pounds typed', () => {
    setUnits('imperial');
    const stored = fromInputLoad('135');
    expect(stored).toBe('61.235');
    expect(toDisplayLoad(stored)).toBe('135');
    expect(toDisplayLoad('60')).toBe('132.3');
    expect(fromInputLoad('')).toBe('');
    expect(toDisplayLoad('')).toBe('');
    expect(weightUnit()).toBe('lb');
  });

  it('every whole pound from 1 to 500 round-trips exactly', () => {
    setUnits('imperial');
    for (let lb = 1; lb <= 500; lb++) expect(toDisplayLoad(fromInputLoad(String(lb)))).toBe(String(lb));
  });
});

describe('formatting', () => {
  it('Hebrew dates keep the legacy DD.MM.YYYY; English spells the month', () => {
    expect(fmtDate('2025-03-07')).toBe('07.03.2025');
    setLocale('en');
    expect(fmtDateISO('2025-03-07')).toBe('Mar 7, 2025');
    expect(fmtDate('2025-03-07')).toBe('Mar 7, 2025');
  });

  it('weekday captions follow the locale', () => {
    expect(weekdaysCaption([0, 3])).toBe('ראשון · רביעי');
    setLocale('en');
    expect(weekdaysCaption([0, 3])).toBe('Sunday · Wednesday');
    expect(weekdayName(6)).toBe('Saturday');
  });

  it('the DRAWN week starts Sunday in Hebrew and Monday in English', () => {
    expect(weekdayOrder()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    setLocale('en');
    expect(weekdayOrder()).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('plural picks Hebrew "two" and falls back to other', () => {
    const forms = { one: 'יום', two: 'יומיים', other: 'ימים' };
    expect(plural(1, forms)).toBe('יום');
    expect(plural(2, forms)).toBe('יומיים');
    expect(plural(5, forms)).toBe('ימים');
    setLocale('en');
    expect(plural(2, { one: 'day', other: 'days' })).toBe('days');
    expect(plural(1, { one: 'day', other: 'days' })).toBe('day');
  });

  it('rep schemes translate their Hebrew words and keep the numbers', () => {
    expect(repsText('10–12 לצד')).toBe('10–12 לצד');
    setLocale('en');
    expect(repsText('10–12 לצד')).toBe('10–12 per side');
    expect(repsText('20 (10 לצד)')).toBe('20 (10 per side)');
    expect(repsText('30–45 שנ׳')).toBe('30–45 s');
    expect(repsText('עד כשל / RIR 1–2')).toBe('to failure / RIR 1–2');
    expect(repsText('8 לרגל')).toBe('8 per leg');
    expect(repsText('5 דק׳')).toBe('5 min');
    expect(repsText('8–10')).toBe('8–10');
  });
});

describe('language and units are device preferences', () => {
  it('survive a reload, and an invalid value is dropped', () => {
    const storage = fakeStorage();
    const store = new LocalStore(storage);
    store.update((d) => {
      d.ui.locale = 'en';
      d.ui.units = 'imperial';
    });
    const reloaded = new LocalStore(storage);
    expect(reloaded.getState().ui.locale).toBe('en');
    expect(reloaded.getState().ui.units).toBe('imperial');

    const raw = JSON.parse(storage.map.get(STATE_KEY) ?? '{}');
    raw.ui.locale = 'klingon';
    const bad = fakeStorage(Object.fromEntries(storage.map));
    bad.map.set(STATE_KEY, JSON.stringify(raw));
    const fromBad = new LocalStore(bad);
    expect(fromBad.getState().ui.locale).toBeUndefined();
    expect(fromBad.getState().ui.units).toBe('imperial');
  });

  it('survive "delete all data"', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.locale = 'en';
      d.ui.units = 'imperial';
    });
    store.update((d) => {
      d.ui.theme = 'light';
    });
    store.clear();
    expect(store.getState().ui.theme).toBe('light');
    expect(store.getState().ui.locale).toBe('en');
    expect(store.getState().ui.units).toBe('imperial');
  });

  it('survive a restore from a backup that predates them', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.locale = 'en';
    });
    const other = new LocalStore(fakeStorage());
    other.append('set_completed', { date: '2025-01-05', dayKey: 'A', exId: 'a1', idx: 0, w: '40', r: '10' });
    store.replaceAll(other.getState(), other.getEvents());
    expect(store.getState().ui.locale).toBe('en');
  });

  it('are never written to the event log', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.locale = 'en';
      d.ui.units = 'imperial';
    });
    expect(JSON.stringify(store.getEvents())).not.toContain('imperial');
  });
});
