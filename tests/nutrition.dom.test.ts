/**
 * @vitest-environment jsdom
 *
 * The 🍽️ תזונה screen in the real shell: logging, deleting, targets — and the
 * two Gemini laws: the ✨ button is ABSENT (not disabled) without a configured
 * port, and an estimate only PREFILLS the form (no event until הוספה).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import type { EstimateResult, NutritionAiPort } from '../src/nutrition/aiPort.ts';
import { createApp, type AppHooks } from '../src/ui/app.ts';
import { ESTIMATE_ERROR_HE, resetNutritionScreen } from '../src/ui/nutrition.ts';
import { RestTimer } from '../src/ui/timer.ts';

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

function mount(hooks: AppHooks = {}): { store: LocalStore; render: () => void } {
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
  const app = createApp(store, timer, hooks);
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

function openNutrition(): void {
  click('#tabs .hub[data-hub="NU"]');
}

function fakePort(result: EstimateResult, configured = true): { port: NutritionAiPort; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    port: {
      configured: () => configured,
      estimate: () => {
        calls.push(1);
        return Promise.resolve(result);
      },
    },
  };
}

const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('the תזונה screen', () => {
  it('opens from the 🍽️ hub with header totals and an empty day', () => {
    const { store } = mount();
    openNutrition();
    expect(store.getState().ui.view).toBe('NT');
    expect(document.querySelector('#header .app-title')?.textContent).toContain('תזונה');
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('0');
    expect(document.querySelector('#main .empty')).not.toBeNull();
    // manual logging needs no cloud: the form is there, the ✨ button is not
    expect(document.querySelector('#ntAdd')).not.toBeNull();
  });

  it('logs a meal manually: exactly one meal_logged, row + totals update', () => {
    const { store } = mount();
    openNutrition();
    type('#ntName', 'חזה עוף עם אורז');
    type('#ntCal', '550');
    type('#ntProt', '45');
    click('#ntAdd');

    const events = store.getEvents().filter((e) => e.type === 'meal_logged');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload['name']).toBe('חזה עוף עם אורז');
    expect(events[0]?.payload['source']).toBe('manual');
    expect(document.querySelector('.nt-meal-name')?.textContent).toBe('חזה עוף עם אורז');
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('550');
    // the form was re-rendered clean for the next meal
    expect(document.querySelector<HTMLInputElement>('#ntName')?.value).toBe('');
  });

  it('refuses a meal without a name and appends nothing', () => {
    const { store } = mount();
    openNutrition();
    type('#ntCal', '300');
    click('#ntAdd');
    expect(store.getEvents().filter((e) => e.type === 'meal_logged')).toHaveLength(0);
    expect(document.querySelector('#ntAddMsg')?.textContent).toContain('תיאור');
  });

  it('deletes a meal through its 🗑 (tombstone event, row gone, totals back to 0)', () => {
    const { store } = mount();
    openNutrition();
    type('#ntName', 'שייק');
    type('#ntCal', '300');
    click('#ntAdd');
    click('.nt-del');
    expect(store.getEvents().filter((e) => e.type === 'meal_deleted')).toHaveLength(1);
    expect(document.querySelector('.nt-meal')).toBeNull();
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('0');
  });

  it('saves daily targets and draws the progress bars', () => {
    const { store } = mount();
    openNutrition();
    type('#ntTgtCal', '2000');
    type('#ntTgtProt', '150');
    click('#ntTgtSave');
    expect(store.getState().nutrition.targets).toEqual({ calories: 2000, protein: 150 });
    expect(store.getEvents().filter((e) => e.type === 'nutrition_targets_set')).toHaveLength(1);
    expect(document.querySelectorAll('.nt-bar')).toHaveLength(2);
  });

  it('walks a day back and still offers the add form — a forgotten dinner lands on yesterday', () => {
    const { store } = mount();
    openNutrition();
    click('#ntPrev');
    expect(document.querySelector<HTMLButtonElement>('#ntNext')?.disabled).toBe(false);
    // the card says where the meal will land
    expect(document.querySelector('.nt-add .gc-title')?.textContent).toContain('ליום');

    type('#ntName', 'ארוחת ערב של אתמול');
    type('#ntCal', '700');
    click('#ntAdd');
    const ev = store.getEvents().find((e) => e.type === 'meal_logged');
    const today = new Date().toISOString().slice(0, 10);
    expect(ev?.payload['date']).not.toBe(today);
    expect(String(ev?.payload['date']) < today).toBe(true);
    // "now" would be a lie on a past day — no time unless the user typed one
    expect(ev?.payload['time']).toBe('');
    // the meal renders on the past day's list, and today stays empty
    expect(document.querySelector('.nt-meal-name')?.textContent).toBe('ארוחת ערב של אתמול');
    click('#ntNext');
    expect(document.querySelector('.nt-meal')).toBeNull();
    expect(document.querySelector('.nt-add .gc-title')?.textContent).not.toContain('ליום');
  });

  it('stamps a meal logged today with the current time when none was typed', () => {
    const { store } = mount();
    openNutrition();
    type('#ntName', 'שייק');
    type('#ntCal', '300');
    click('#ntAdd');
    const ev = store.getEvents().find((e) => e.type === 'meal_logged');
    expect(ev?.payload['time']).toMatch(/^\d{2}:\d{2}$/);
  });

  it('keeps a typed time over the current-time default', () => {
    const { store } = mount();
    openNutrition();
    type('#ntName', 'בוקר');
    type('#ntCal', '250');
    const timeInp = document.querySelector<HTMLInputElement>('#ntTime');
    if (!timeInp) throw new Error('no time input');
    timeInp.value = '07:15';
    click('#ntAdd');
    const ev = store.getEvents().find((e) => e.type === 'meal_logged');
    expect(ev?.payload['time']).toBe('07:15');
  });

  it('renders NO estimate button without an ai port — absent, not disabled', () => {
    mount();
    openNutrition();
    expect(document.querySelector('#ntEst')).toBeNull();
    expect(document.querySelector('#ntPhotoBtn')).toBeNull();
  });

  it('renders NO estimate button while the port says not configured (signed out)', () => {
    const { port } = fakePort({ ok: true, estimate: { calories: 1, proteinG: 1, items: [], confidence: 'low' } }, false);
    mount({ nutrition: { ai: port } });
    openNutrition();
    expect(document.querySelector('#ntEst')).toBeNull();
  });

  it('an estimate PREFILLS the fields and appends no event until הוספה', async () => {
    const { port, calls } = fakePort({
      ok: true,
      estimate: { calories: 620, proteinG: 42, items: ['אורז', 'חזה עוף'], confidence: 'medium' },
    });
    const { store } = mount({ nutrition: { ai: port } });
    openNutrition();
    type('#ntName', 'אורז עם עוף');
    click('#ntEst');
    await flush();
    await flush();

    expect(calls).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('#ntCal')?.value).toBe('620');
    expect(document.querySelector<HTMLInputElement>('#ntProt')?.value).toBe('42');
    expect(document.querySelector('#ntEstMsg')?.textContent).toContain('אורז');
    expect(document.querySelector('#ntEstMsg')?.textContent).toContain('בינוני');
    expect(store.getEvents().filter((e) => e.type === 'meal_logged')).toHaveLength(0);

    // …and the save stamps the meal as the model's (numbers untouched)
    click('#ntAdd');
    const ev = store.getEvents().find((e) => e.type === 'meal_logged');
    expect(ev?.payload['source']).toBe('gemini_text');
    expect((ev?.payload['ai'] as { confidence?: string } | undefined)?.confidence).toBe('medium');
  });

  it('a corrected estimate saves as manual again', async () => {
    const { port } = fakePort({
      ok: true,
      estimate: { calories: 620, proteinG: 42, items: [], confidence: 'high' },
    });
    const { store } = mount({ nutrition: { ai: port } });
    openNutrition();
    type('#ntName', 'אורז עם עוף');
    click('#ntEst');
    await flush();
    await flush();
    type('#ntCal', '500'); // the user knows better
    click('#ntAdd');
    const ev = store.getEvents().find((e) => e.type === 'meal_logged');
    expect(ev?.payload['source']).toBe('manual');
    expect(ev?.payload['ai']).toBeUndefined();
  });

  it('explains WHY when confidence is below high, and stays quiet when it is high', async () => {
    const low = fakePort({
      ok: true,
      estimate: { calories: 400, proteinG: 20, items: ['טוסט'], confidence: 'medium', reason: 'כמות הגבינה לא ברורה' },
    });
    mount({ nutrition: { ai: low.port } });
    openNutrition();
    type('#ntName', 'טוסט גבינה');
    click('#ntEst');
    await flush();
    await flush();
    const msg = document.querySelector('#ntEstMsg')?.textContent ?? '';
    expect(msg).toContain('בינוני');
    expect(msg).toContain('(כמות הגבינה לא ברורה)');

    resetNutritionScreen();
    const high = fakePort({
      ok: true,
      estimate: { calories: 400, proteinG: 20, items: [], confidence: 'high', reason: 'לא אמור להופיע' },
    });
    mount({ nutrition: { ai: high.port } });
    openNutrition();
    type('#ntName', 'טוסט גבינה');
    click('#ntEst');
    await flush();
    await flush();
    expect(document.querySelector('#ntEstMsg')?.textContent).not.toContain('לא אמור להופיע');
  });

  it('takes the description from a multi-line box and stores it as one line', () => {
    const { store } = mount();
    openNutrition();
    expect(document.querySelector('#ntName')?.tagName).toBe('TEXTAREA');
    type('#ntName', 'טוסט\nעם 2 פרוסות גבינה');
    type('#ntCal', '400');
    click('#ntAdd');
    expect(store.getState().nutrition.meals[Object.keys(store.getState().nutrition.meals)[0] ?? '']?.name).toBe(
      'טוסט עם 2 פרוסות גבינה',
    );
  });

  it('speaks every estimate failure in Hebrew, verbatim from the map', async () => {
    for (const error of ['signed_out', 'offline', 'rate_limited', 'http', 'unparseable'] as const) {
      resetNutritionScreen();
      const { port } = fakePort({ ok: false, error });
      mount({ nutrition: { ai: port } });
      openNutrition();
      type('#ntName', 'סלט');
      click('#ntEst');
      await flush();
      await flush();
      expect(document.querySelector('#ntEstMsg')?.textContent).toBe(ESTIMATE_ERROR_HE[error]);
    }
  });
});
