/**
 * @vitest-environment jsdom
 *
 * The 🍽️ hub in English: the meal tracker (NT), the weight log (WT) and the
 * progress photos (PH) speak English with no Hebrew left in their chrome, time
 * axes run left to right, the food catalog reads through its English overlay
 * while logged meals keep the name they stored — and the weight log works in
 * pounds while storing kilograms.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogMealInput, unitsOf } from '../src/core/catalog.ts';
import { logMeal } from '../src/core/nutrition.ts';
import { recordPhoto } from '../src/core/photos.ts';
import { logWeight, movingAverage, setWeightTarget, weightEntries } from '../src/core/weight.ts';
import { FIXED_MEALS, FOODS } from '../src/data/foods.ts';
import { FOODS_EN, MEALS_EN } from '../src/i18n/content/foods.en.ts';
import { entryName, unitLabel } from '../src/i18n/foodText.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { setUnits } from '../src/i18n/units.ts';
import { nutrition as NM } from '../src/i18n/messages/nutrition.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { MemoryBlobStore } from '../src/storage/MemoryBlobStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import type { NutritionAiPort } from '../src/nutrition/aiPort.ts';
import type { PushPort } from '../src/nutrition/push.ts';
import { createApp } from '../src/ui/app.ts';
import { intakeChartSvg, resetNutritionScreen } from '../src/ui/nutrition.ts';
import { resetPhotosScreen } from '../src/ui/photos.ts';
import { RestTimer } from '../src/ui/timer.ts';
import { resetWeightScreen, weightChartSvg } from '../src/ui/weight.ts';

const HEBREW = /[֐-׿]/;

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  vi.stubGlobal('confirm', () => true);
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:fake';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  resetNutritionScreen();
  resetWeightScreen();
  resetPhotosScreen();
});

afterEach(() => {
  setLocale('he');
  setUnits('metric');
});

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);
const ai: NutritionAiPort = { configured: () => true, estimate: () => never() };
const push: PushPort = {
  status: () => Promise.resolve('off'),
  enable: () => never(),
  disable: () => never(),
  refresh: () => Promise.resolve(),
};

function mount(units: 'metric' | 'imperial' = 'metric'): { store: LocalStore; blobs: MemoryBlobStore; render: () => void } {
  const store = new LocalStore(fakeStorage());
  const blobs = new MemoryBlobStore();
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const timer = new RestTimer({
    bar: el('timerBar'),
    time: el('tTime'),
    prog: el('tProg'),
    title: el('tTitle'),
    plus: el('tPlus'),
    minus: el('tMinus'),
    pause: el('tPause'),
    reset: el('tReset'),
    close: el('tClose'),
  });
  store.update((d) => {
    d.ui.locale = 'en';
    d.ui.units = units;
  });
  const app = createApp(store, timer, {
    nutrition: { ai, push },
    photos: { blobs, prepare: (file: File) => Promise.resolve({ blob: file, width: 600, height: 800 }) },
  });
  app.render();
  return { store, blobs, render: app.render };
}

function click(sel: string): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function type(sel: string, value: string): void {
  const inp = document.querySelector<HTMLInputElement>(sel);
  if (!inp) throw new Error(`no input ${sel}`);
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

function open(view: 'NT' | 'WT' | 'PH'): void {
  click('#tabs .hub[data-hub="NU"]');
  click(`#tabs .tab[data-view="${view}"]`);
}

/** Visible text plus every attribute a reader or a screen reader meets. */
function chrome(sel: string): string {
  const root = document.querySelector(sel);
  if (!root) throw new Error(`no ${sel}`);
  const attrs = [...root.querySelectorAll('*')].flatMap((e) =>
    ['aria-label', 'title', 'placeholder', 'alt', 'label'].map((a) => e.getAttribute(a) ?? ''),
  );
  return `${root.textContent ?? ''}\n${attrs.join('\n')}`;
}

function iso(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the 🍽️ hub in English', () => {
  it('the meal tracker speaks English, with no Hebrew in its chrome', async () => {
    const { store } = mount();
    logMeal(store, { date: iso(0), name: 'Chicken and rice', calories: 600, protein: 45, time: '13:00', source: 'manual', slot: 'lunch' }, 'm1');
    logMeal(store, { date: iso(-1), name: 'Oats', calories: 400, protein: 20, time: '08:00', source: 'manual', slot: 'breakfast' }, 'm2');
    store.update((d) => {
      d.nutrition.targets = { calories: 2000, protein: 150 };
    });
    open('NT');
    await flush();
    const text = chrome('#main');
    expect(text).toContain("Today's summary");
    expect(text).toContain("The day's meals");
    expect(text).toContain('Lunch');
    expect(text).toContain('✅ Close the day');
    expect(text).toContain('📊 Intake over time');
    expect(text).toContain('Daily targets');
    expect(text).toContain('🔔 Meal reminders');
    expect(text).toContain('← Previous day');
    expect(text).toContain('Next day →');
    expect(document.querySelector('#ntRemindState')?.textContent).toBe(NM.en.pushState.off);
    expect(text).not.toMatch(HEBREW);
    expect(chrome('#header')).not.toMatch(HEBREW);

    // the free-text form and the ✨ row
    click('[data-mode="text"]');
    expect(chrome('#main')).toContain('✨ Estimate with Gemini');
    expect(chrome('#main')).not.toMatch(HEBREW);

    // the chart's other lenses, and a closed day
    click('[data-metric="protein"]');
    click('[data-days="closed"]');
    expect(chrome('#main')).not.toMatch(HEBREW);
    click('[data-metric="calories"]');
    click('[data-margin="20"]');
    click('#ntClose');
    const closed = chrome('#main');
    expect(closed).toContain('✅ Today is closed');
    expect(closed).toContain('🔓 Reopen to add');
    expect(closed).not.toMatch(HEBREW);
  });

  it('the catalog picker reads the English overlay; a logged pick keeps its stored name', () => {
    const { store, render } = mount();
    // "My meals" are the fixed meals this user has eaten before (core/catalog.ts#myFixedMeals).
    const seed = catalogMealInput({ id: 'oatmeal', unit: 'portion', qty: 1, date: '2025-01-01', slot: 'breakfast', time: '08:00' });
    if (seed) logMeal(store, seed, 'seed-oatmeal');
    render();
    open('NT');
    click('[data-slot="breakfast"]');
    const select = document.querySelector<HTMLSelectElement>('#ntCatItem');
    if (!select) throw new Error('no picker');
    const options = [...select.querySelectorAll('option, optgroup')].map((o) => o.textContent + (o.getAttribute('label') ?? '')).join('\n');
    expect(options).not.toMatch(HEBREW);
    select.value = 'oats_fine';
    select.dispatchEvent(new Event('change'));
    const units = [...document.querySelectorAll('#ntCatUnit option')].map((o) => o.textContent);
    expect(units).toEqual(['cup', 'tbsp', '100 g']);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    const again = document.querySelector<HTMLSelectElement>('#ntCatItem');
    if (!again) throw new Error('no picker');
    again.value = 'oatmeal';
    again.dispatchEvent(new Event('change'));
    const preview = document.querySelector('#ntCatPreview')?.textContent ?? '';
    expect(preview).toContain('Quick oats');
    expect(preview).toContain('½ cup');
    expect(preview).not.toMatch(HEBREW);

    // A pick is priced and stored in the catalog's own (Hebrew) words — the
    // payload never depends on the reader's language.
    const pick = catalogMealInput({ id: 'oatmeal', unit: 'portion', qty: 1, date: iso(0), slot: 'breakfast', time: '08:00' });
    if (!pick) throw new Error('no pick');
    logMeal(store, pick, 'c1');
    expect(store.getState().nutrition.meals['c1']?.name).toBe('שיבולת שועל');
  });

  it('every catalog food, unit and fixed meal has an English name', () => {
    setLocale('en');
    for (const f of FOODS) {
      expect(FOODS_EN[f.id]?.name, f.id).toBeTruthy();
      for (const u of f.units) expect(FOODS_EN[f.id]?.units[u.id], `${f.id}.${u.id}`).toBeTruthy();
    }
    for (const m of FIXED_MEALS) expect(MEALS_EN[m.id], m.id).toBeTruthy();
    for (const e of [...FOODS, ...FIXED_MEALS]) {
      expect(entryName(e)).not.toMatch(HEBREW);
      for (const u of unitsOf(e)) expect(unitLabel(e, u)).not.toMatch(HEBREW);
    }
    setLocale('he');
    expect(entryName(FIXED_MEALS[0]!)).toBe(FIXED_MEALS[0]!.name);
  });

  it('the weight log speaks English', () => {
    const { store } = mount();
    for (let i = 0; i < 5; i += 1) logWeight(store, { date: iso(-10 + i * 2), time: '07:00', kg: 84 - i * 0.4, note: '' }, `w${i}`);
    setWeightTarget(store, 80);
    open('WT');
    const text = chrome('#main');
    expect(text).toContain('My weight');
    expect(text).toContain('📈 Weight trend');
    expect(text).toContain('Log a weigh-in');
    expect(text).toContain('Weight (kg)');
    expect(text).toContain('Goal weight');
    expect(text).toContain('Time runs left to right');
    expect(text).not.toMatch(HEBREW);
    expect(document.querySelector('#header .day-meta')?.textContent).toMatch(/^Latest: 82\.4 kg · /);
    expect(chrome('#header')).not.toMatch(HEBREW);
  });

  it('logging 180 lb stores ~81.65 kg and shows 180 lb', () => {
    const { store } = mount('imperial');
    open('WT');
    expect(chrome('#main')).toContain('Weight (lb)');
    type('#wtKg', '180');
    click('#wtAdd');
    const rows = weightEntries(store.getState().nutrition);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kg).toBeCloseTo(81.65, 2);
    expect(document.querySelector('.wt-current')?.textContent).toBe('180.0 lb');
    expect(document.querySelector('.wt-row-kg')?.textContent).toBe('180.0');
    expect(document.querySelector('#header .day-meta')?.textContent).toBe('Latest: 180.0 lb');

    // the bounds hold in kilograms after conversion: 40 lb ≈ 18 kg is refused
    type('#wtKg', '40');
    click('#wtAdd');
    expect(document.querySelector('#wtAddMsg')?.textContent).toBe('Weight must be a number between 45 and 881 lb.');
    expect(weightEntries(store.getState().nutrition)).toHaveLength(1);

    // the goal goes through the same conversion, and prefills in pounds
    type('#wtTgt', '170');
    click('#wtTgtSave');
    expect(store.getState().nutrition.weightTarget).toBeCloseTo(77.11, 2);
    expect(document.querySelector<HTMLInputElement>('#wtTgt')?.value).toBe('170.0');
    expect(chrome('#main')).not.toMatch(HEBREW);
  });

  it('the photo screen speaks English', async () => {
    const { store, blobs } = mount();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await recordPhoto(store, blobs, { date: iso(-30), time: '07:00', pose: 'front', width: 600, height: 800, note: '' }, blob, 'p1');
    await recordPhoto(store, blobs, { date: iso(-1), time: '07:00', pose: 'front', width: 600, height: 800, note: '' }, blob, 'p2');
    logWeight(store, { date: iso(-30), time: '07:00', kg: 84, note: '' }, 'w1');
    open('PH');
    let text = chrome('#main');
    expect(text).toContain('New photo');
    expect(text).toContain('Gallery');
    expect(text).toContain('Photo backup');
    expect(text).toContain('Front');
    expect(text).toContain('84.0 kg');
    expect(text).not.toMatch(HEBREW);
    expect(document.querySelector('#header .day-meta')?.textContent).toMatch(/^2 photos · latest /);
    click('#phSuggest');
    text = chrome('#main');
    expect(text).toContain('Before');
    expect(text).toContain('After');
    expect(text).not.toMatch(HEBREW);
    // the wipe puts the OLDER photo on the left in English
    click('[data-mode="wipe"]');
    const over = document.querySelector('.ph-cmp-wipe .ph-cmp-over');
    expect(over?.getAttribute('data-blob')).toBe('p1');
    expect(chrome('#main')).not.toMatch(HEBREW);
    click('[data-open="p2"]');
    expect(chrome('#main')).toContain('Progress photo from');
    expect(chrome('#main')).not.toMatch(HEBREW);
  });
});

describe('time axes follow the reading direction', () => {
  const rows = [84, 83, 82].map((kg, i) => ({ id: `r${i}`, date: `2026-03-0${i + 1}`, time: '', kg, note: '' }));

  it('weight: oldest on the right in Hebrew, on the left in English', () => {
    const xs = (svg: string): number[] =>
      [...svg.matchAll(/class="wt-pt" cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const he = xs(weightChartSvg(rows, movingAverage(rows), null));
    setLocale('en');
    const en = xs(weightChartSvg(rows, movingAverage(rows), null));
    expect(he[0]).toBeGreaterThan(he[2]!);
    expect(en[0]).toBeLessThan(en[2]!);
  });

  it('intake: today on the left in Hebrew, on the right in English', () => {
    const days = ['2026-03-01', '2026-03-02', '2026-03-03'].map((date) => ({ date, calories: 1500, protein: 100, meals: 2, closed: true }));
    const today = (svg: string): number => Number(/class="nt-xlab today" x="([\d.]+)"/.exec(svg)?.[1]);
    const first = (svg: string): number => Number(/class="nt-xlab " x="([\d.]+)"/.exec(svg)?.[1]);
    const he = intakeChartSvg(days, 'calories', 1500, null, '2026-03-03');
    setLocale('en');
    const en = intakeChartSvg(days, 'calories', 1500, null, '2026-03-03');
    expect(today(he)).toBeLessThan(first(he));
    expect(today(en)).toBeGreaterThan(first(en));
    expect(en).not.toMatch(HEBREW);
  });
});
