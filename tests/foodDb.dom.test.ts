/**
 * @vitest-environment jsdom
 *
 * Stage ז on the 🍽️ screen, in the real shell: the protein / carbs / fat bars
 * (default split "≈", lower bound "≥"), the ready-meals group in the picker,
 * "⭐ הארוחות שלי" (save with ☆ or from the form, one-tap log, delete), the
 * "🍱 תפריט לדוגמה" card (closest to the target, pick another, one-tap log
 * as a normal catalog pick), explicit carbs / fat targets — and a logged
 * catalog meal read in English from its ids.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogMealInput } from '../src/core/catalog.ts';
import { logMeal, saveTemplate, setTargets } from '../src/core/nutrition.ts';
import { todayISO } from '../src/core/workout.ts';
import { READY_MEALS } from '../src/data/foods.ts';
import { MEALS_EN } from '../src/i18n/content/foods.en.ts';
import { entryName } from '../src/i18n/foodText.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { macroRowHtml, resetNutritionScreen } from '../src/ui/nutrition.ts';
import { RestTimer } from '../src/ui/timer.ts';

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
  resetNutritionScreen();
});

afterEach(() => setLocale('he'));

function mount(): { store: LocalStore; render: () => void } {
  const store = new LocalStore(fakeStorage());
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
  const app = createApp(store, timer);
  app.render();
  return { store, render: app.render };
}

function click(sel: string): void {
  const b = document.querySelector<HTMLElement>(sel);
  if (!b) throw new Error(`no element ${sel}`);
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function type(sel: string, value: string): void {
  const inp = document.querySelector<HTMLInputElement>(sel);
  if (!inp) throw new Error(`no input ${sel}`);
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

function choose(sel: string, value: string): void {
  const el = document.querySelector<HTMLSelectElement | HTMLInputElement>(sel);
  if (!el) throw new Error(`no field ${sel}`);
  if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value === 'on';
  else el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const open = (): void => click('#tabs .hub[data-hub="NU"]');
const bar = (key: string): Element | null => document.querySelector(`.nt-macro[data-macro="${key}"]`);
const logged = (store: LocalStore) => store.getEvents().filter((e) => e.type === 'meal_logged');

describe('the macro bars', () => {
  it('shows protein, carbs and fat; carbs / fat fill toward the default split, drawn "≈"', () => {
    const { store, render } = mount();
    setTargets(store, { calories: 2000, protein: 150 });
    logMeal(store, catalogMealInput({ id: 'meal_chicken_rice_salad', unit: 'portion', qty: 1, date: todayISO(), slot: 'lunch', time: '13:00' })!, 'm1');
    render();
    open();
    expect([...document.querySelectorAll('.nt-macro')].map((e) => e.getAttribute('data-macro'))).toEqual(['protein', 'carbs', 'fat']);
    expect(bar('carbs')?.classList.contains('has-target')).toBe(true);
    expect(bar('carbs')?.querySelector('.nt-macro-val')?.textContent).toContain('51 / ≈199');
    expect(bar('fat')?.querySelector('.nt-macro-val')?.textContent).toContain('14 / ≈67');
    expect(bar('fat')?.querySelector('.nt-ring-sub')?.textContent).toContain('נותרו 53');
    expect(bar('protein')?.querySelector('.nt-macro-val')?.textContent).toContain('52 / 150');
  });

  it('a day with a meal that has no carbs / fat reads "≥" and says how many lack it', () => {
    const { store, render } = mount();
    const today = todayISO();
    logMeal(store, { date: today, name: 'ישן', calories: 300, protein: 10, time: '', source: 'manual', slot: 'lunch' }, 'old');
    logMeal(store, { date: today, name: 'חדש', calories: 300, protein: 10, carbs: 40, time: '', source: 'manual', slot: 'lunch' }, 'new');
    render();
    open();
    expect(bar('carbs')?.querySelector('.nt-macro-val')?.textContent).toContain('≥40');
    expect(bar('carbs')?.querySelector('.nt-ring-sub')?.textContent).toBe('חסר נתון ב־ארוחה אחת');
    expect(bar('fat')?.querySelector('.nt-macro-val')?.textContent).toContain('≥0');
    expect(bar('fat')?.querySelector('.nt-ring-sub')?.textContent).toBe('חסר נתון ב־2 ארוחות');
  });

  it('the protein row\'s markup is unchanged for a spec without the new fields', () => {
    const html = macroRowHtml({ key: 'protein', label: 'חלבון', value: 112, target: 150 });
    expect(html).toContain('<bdi dir="ltr">112 / 150</bdi> ג׳');
    expect(html).not.toContain('≈');
    expect(html).not.toContain('≥');
  });

  it('sets explicit carbs / fat targets; empty fields show the automatic split', () => {
    const { store, render } = mount();
    setTargets(store, { calories: 2000, protein: 150 });
    render();
    open();
    expect(document.querySelector<HTMLInputElement>('#ntTgtCarbs')?.placeholder).toBe('אוטומטי: 199');
    expect(document.querySelector<HTMLInputElement>('#ntTgtFat')?.placeholder).toBe('אוטומטי: 67');
    type('#ntTgtCarbs', '250');
    click('#ntTgtSave');
    expect(store.getState().nutrition.targets).toEqual({ calories: 2000, protein: 150, carbs: 250 });
    expect(bar('carbs')?.querySelector('.nt-macro-val')?.textContent).toContain('0 / 250');
    expect(bar('fat')?.querySelector('.nt-macro-val')?.textContent).toContain('≈67');
    type('#ntTgtFat', 'abc');
    click('#ntTgtSave');
    expect(document.querySelector('#ntTgtMsg')?.textContent).toContain('מספרים');
  });
});

describe('the catalog picker', () => {
  it('lists the ready meals in their own group, and logs one priced in code', () => {
    const { store } = mount();
    open();
    click('[data-slot="breakfast"]');
    const groups = [...document.querySelectorAll('#ntCatItem optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['ארוחות מוכנות', 'מאכלים']);
    const ready = [...document.querySelectorAll<HTMLOptionElement>('#ntCatItem optgroup[label="ארוחות מוכנות"] option')].map((o) => o.value);
    expect(ready).toContain('meal_israeli_breakfast');
    expect(ready).not.toContain('meal_chicken_rice_salad');
    choose('#ntCatItem', 'meal_shakshuka_bread');
    expect(document.querySelector('#ntCatPreview')?.textContent).toContain('445');
    expect(document.querySelector('#ntCatPreview .nt-cat-macros')?.textContent).toContain('פחמימות 30 ג׳');
    click('#ntCatAdd');
    expect(logged(store)[0]?.payload).toMatchObject({
      name: 'שקשוקה עם לחם',
      calories: 445,
      carbs: 30,
      fat: 27,
      source: 'catalog',
      slot: 'breakfast',
      catalog: { id: 'meal_shakshuka_bread', unit: 'portion', qty: 1 },
    });
  });
});

describe('⭐ my meals', () => {
  it('☆ saves a logged meal as my own; it then logs with one tap into the chosen meal', () => {
    const { store } = mount();
    open();
    click('[data-slot="lunch"]');
    click('[data-mode="text"]');
    type('#ntName', 'סלט של אמא');
    type('#ntCal', '420');
    type('#ntProt', '12');
    type('#ntFat', '30');
    click('#ntAdd');
    expect(logged(store)[0]?.payload).toMatchObject({ calories: 420, protein: 12, fat: 30 });
    expect('carbs' in (logged(store)[0]?.payload ?? {})).toBe(false);
    expect(document.querySelector('.nt-meal .nt-cf')?.textContent).toBe('שומן 30 ג׳');

    click('[data-save-tpl]');
    const saves = store.getEvents().filter((e) => e.type === 'meal_template_saved');
    expect(saves).toHaveLength(1);
    expect(saves[0]?.payload).toMatchObject({ name: 'סלט של אמא', calories: 420, protein: 12, fat: 30 });
    // the star is now filled, and saving again appends nothing
    expect(document.querySelector('[data-save-tpl]')).toBeNull();
    expect(document.querySelector('.nt-star.saved')).not.toBeNull();

    click('[data-slot="dinner"]');
    click('[data-mine-tpl]');
    const evs = logged(store);
    expect(evs).toHaveLength(2);
    expect(evs[1]?.payload).toMatchObject({ name: 'סלט של אמא', calories: 420, fat: 30, slot: 'dinner', source: 'manual' });
  });

  it('the form\'s "save to my meals" box saves the meal as it logs it; 🗑 removes a saved meal', () => {
    const { store } = mount();
    open();
    expect(document.querySelector('#ntMine')?.textContent).toContain('שומרים ארוחה בכפתור ☆');
    click('[data-slot="snack_pm"]');
    click('[data-mode="text"]');
    type('#ntName', 'שייק');
    type('#ntCal', '250');
    type('#ntProt', '25');
    type('#ntCarbs', '20');
    choose('#ntSaveMine', 'on');
    click('#ntAdd');
    expect(store.getEvents().filter((e) => e.type === 'meal_template_saved')).toHaveLength(1);
    expect(document.querySelectorAll('#ntMine .nt-mine-row')).toHaveLength(1);
    expect(document.querySelector('#ntMine .nt-mine-name')?.textContent).toBe('שייק');
    click('[data-tpl-del]');
    expect(store.getEvents().filter((e) => e.type === 'meal_template_deleted')).toHaveLength(1);
    expect(document.querySelectorAll('#ntMine .nt-mine-row')).toHaveLength(0);
  });

  it('a saved catalog pick re-prices from the catalog when logged', () => {
    const { store, render } = mount();
    saveTemplate(store, { name: '2 יחידה פיתה', calories: 1, protein: 1, pick: { id: 'pita', unit: 'unit', qty: 2 } }, 't1');
    render();
    open();
    // the strip already shows the catalog's price, not the stale stored one
    expect(document.querySelector('#ntMine .nt-mine-nums')?.textContent).toContain('495');
    click('[data-slot="lunch"]');
    click('[data-mine-tpl="t1"]');
    expect(logged(store)[0]?.payload).toMatchObject({ calories: 495, carbs: 100, source: 'catalog', slot: 'lunch' });
  });
});

describe('🍱 the sample menu', () => {
  it('shows the menu closest to the calorie target, switches on request, and logs a meal with one tap', () => {
    const { store, render } = mount();
    setTargets(store, { calories: 2150, protein: 140 });
    render();
    open();
    expect(document.querySelector('#ntMenu .nt-seg.active')?.getAttribute('data-menu')).toBe('menu_2200');
    expect(document.querySelectorAll('#ntMenu .nt-menu-row')).toHaveLength(5);
    expect(document.querySelector('#ntMenu .nt-menu-total')?.textContent).toContain('2239');

    click('[data-menu="menu_1500"]');
    expect(document.querySelector('#ntMenu .gc-sub')?.textContent).toContain('1500');
    click('[data-menu-slot="lunch"] [data-menu-log]');
    expect(logged(store)[0]?.payload).toMatchObject({
      name: 'חזה עוף, אורז וסלט',
      calories: 555,
      source: 'catalog',
      slot: 'lunch',
      catalog: { id: 'meal_chicken_rice_salad', unit: 'portion', qty: 1 },
    });
    // logged: the row says so instead of offering it again
    expect(document.querySelector('[data-menu-slot="lunch"] [data-menu-log]')).toBeNull();
    expect(document.querySelector('[data-menu-slot="lunch"] .nt-menu-done')).not.toBeNull();
  });

  it('without a calorie target it shows the default day; a closed day is read-only', () => {
    const { store, render } = mount();
    open();
    expect(document.querySelector('#ntMenu .nt-seg.active')?.getAttribute('data-menu')).toBe('menu_1800');
    click('[data-menu-slot="breakfast"] [data-menu-log]');
    click('#ntClose');
    expect(store.getEvents().filter((e) => e.type === 'nutrition_day_closed')).toHaveLength(1);
    render();
    expect(document.querySelector('#ntMenu [data-menu-log]')).toBeNull();
  });
});

describe('in English', () => {
  it('every ready meal has an English name', () => {
    setLocale('en');
    for (const m of READY_MEALS) {
      expect(MEALS_EN[m.id], m.id).toBeTruthy();
      expect(entryName(m)).not.toMatch(HEBREW);
    }
  });

  it('a logged catalog meal and its lines read in English from their ids; a renamed one keeps its name', () => {
    const { store, render } = mount();
    const today = todayISO();
    logMeal(store, catalogMealInput({ id: 'meal_tuna_pita', unit: 'portion', qty: 1, date: today, slot: 'lunch', time: '13:00' })!, 'c1');
    logMeal(store, catalogMealInput({ id: 'pita', unit: 'unit', qty: 0.5, date: today, slot: 'dinner', time: '19:00' })!, 'c2');
    logMeal(store, { ...catalogMealInput({ id: 'egg', unit: 'unit', qty: 2, date: today, slot: 'breakfast', time: '08:00' })!, name: 'הביצים שלי' }, 'c3');
    store.update((d) => {
      d.ui.locale = 'en';
    });
    render();
    open();
    const names = [...document.querySelectorAll('.nt-meal-name')].map((e) => e.textContent ?? '');
    expect(names.some((t) => t.startsWith('Tuna in pita'))).toBe(true);
    expect(names.some((t) => t.startsWith('½ pc Pita'))).toBe(true);
    expect(names.some((t) => t.startsWith('הביצים שלי'))).toBe(true);
    const lines = [...document.querySelectorAll('[data-slot-sec="lunch"] .nt-bd-name')].map((e) => e.textContent ?? '');
    expect(lines.length).toBe(5);
    for (const l of lines) expect(l).not.toMatch(HEBREW);
    // the menu card and the strip speak English too
    expect(document.querySelector('#ntMenu')?.textContent ?? '').not.toMatch(HEBREW);
    expect(document.querySelector('#ntMine')?.textContent ?? '').not.toMatch(HEBREW);
    // the payload stays Hebrew data
    expect(store.getState().nutrition.meals['c1']?.name).toBe('טונה בפיתה');
  });
});
