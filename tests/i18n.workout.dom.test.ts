/**
 * @vitest-environment jsdom
 *
 * The training screens in English: the workout day, the plan editor and the
 * history pane speak English chrome, the built-in days carry English captions,
 * presets build their days in the language on screen — and in imperial the
 * set inputs show pounds while the store keeps kilograms.
 *
 * Exercise COACHING copy (names, muscles, steps…) comes from the English
 * overlay another change fills in; until it does it falls back to Hebrew, so
 * the "no Hebrew" sweeps below only look at the chrome this area owns, never
 * at an element whose text comes from an exercise-copy accessor.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROGRAM } from '../src/data/program.ts';
import { defaultPlanDoc, deriveWeeklyTarget, makePlanDay, newDayKey, resolveProgram, savePlan, scheduleTabs } from '../src/core/plan.ts';
import { BUILTIN_PROGRAM } from '../src/data/program.ts';
import { todayISO } from '../src/core/workout.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { setUnits } from '../src/i18n/units.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

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
const HEBREW = /[֐-׿]/;

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
});

afterEach(() => {
  setLocale('he');
  setUnits('metric');
});

interface Mounted {
  store: LocalStore;
  render: () => void;
}

function mount(opts: { units?: 'metric' | 'imperial'; seed?: (s: LocalStore) => void } = {}): Mounted {
  const store = new LocalStore(fakeStorage());
  store.update((d) => {
    d.ui.locale = 'en';
    d.ui.units = opts.units ?? 'metric';
  });
  opts.seed?.(store);
  const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
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

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function typeInto(selector: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`missing input: ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const texts = (selector: string): string[] =>
  [...document.querySelectorAll<HTMLElement>(selector)].map((e) => e.textContent ?? '');
const attrs = (selector: string, name: string): string[] =>
  [...document.querySelectorAll<HTMLElement>(selector)].map((e) => e.getAttribute(name) ?? '');

/** Every string must be free of Hebrew letters — reported one by one on failure. */
function expectNoHebrew(strings: readonly string[], where: string): void {
  const bad = strings.filter((s) => HEBREW.test(s));
  expect(bad, where).toEqual([]);
}

const A1 = PROGRAM.A.exercises[0]!;
const wInput = (exId: string, set: number): string => `#main .inp[data-ex="${exId}"][data-set="${set}"][data-f="w"]`;

/* ------------------------------------------------------------ the workout */

describe('the workout day in English', () => {
  it('speaks English chrome on every built-in day', () => {
    mount();
    for (const k of ['A', 'B', 'C'] as const) {
      click(`#tabs .tab[data-view="${k}"]`);
      const n = PROGRAM[k].exercises.length;
      expect(texts('#main .ex-order')[0]).toBe(`Exercise 1 / ${n}`);
      expect(texts('#main .log-row.head')[0]).toContain('Set');
      expect(texts('#main .log-row.head')[0]).toContain('Weight (kg)');
      expect(texts('#main .notes-toggle')[0]).toContain('Exercise notes');
      expect(attrs('#main .chk', 'aria-label')[0]).toBe('Mark set 1 as done');
      // English has no second language to put under the name
      expect(document.querySelector('#main .ex-title-en')).toBeNull();
      expectNoHebrew(
        [
          ...texts('#main .ex-order'),
          ...texts('#main .log-row.head'),
          ...texts('#main .rest-hint'),
          ...texts('#main .hold-start'),
          ...texts('#main .notes-toggle'),
          ...texts('#main .notes-hint'),
          ...texts('#main .form-toggle'),
          ...texts('#main .badge.scheme'),
          ...texts('#main .badge.equip'),
          ...attrs('#main .chk', 'aria-label'),
          ...attrs('#main .inp', 'placeholder'),
          ...attrs('#main .notes-inp', 'placeholder'),
          ...texts('#main .form-panel h4'),
        ],
        `day ${k}`,
      );
    }
  });

  it('shows English captions and names on the built-in day tabs', () => {
    mount();
    const tabs = texts('#tabs .tab');
    expect(tabs).toHaveLength(3);
    expectNoHebrew(tabs, 'tabs');
    expect(tabs[0]).toContain('Sunday');
    // …and the header's duration line
    expect(document.querySelector('#header .day-meta b')?.textContent).toMatch(/min/);
  });

  it('keeps the Hebrew program object itself in Hebrew, and a localized copy in English', () => {
    setLocale('he');
    expect(resolveProgram(null)).toBe(BUILTIN_PROGRAM);
    setLocale('en');
    const en = resolveProgram(null);
    expect(en).not.toBe(BUILTIN_PROGRAM);
    expect(resolveProgram(null)).toBe(en); // memoized
    // the same exercises — only words differ
    expect(en.days.map((d) => d.day.exercises)).toEqual(BUILTIN_PROGRAM.days.map((d) => d.day.exercises));
    expect(en.days[0]?.day.exercises).toBe(PROGRAM.A.exercises);
    expectNoHebrew(
      scheduleTabs(en).flatMap((t) => [t.title, t.subtitle]),
      'schedule tabs',
    );
    expect(en.days.map((d) => d.day.dur)).toEqual(['~50 min', '~50 min', '~50 min']);
  });

  it('localizes a superset group and its rest line', () => {
    const doc = defaultPlanDoc();
    const a = doc.days[0]!;
    a.supersets = [[a.exercises[0]!.id, a.exercises[1]!.id]];
    mount({
      seed: (s) => {
        const res = savePlan(s, doc);
        if (!res.ok) throw new Error(res.errors.join());
      },
    });
    click('#tabs .tab[data-view="A"]');
    expect(document.querySelector('#main .ss-chip')?.textContent).toBe('🔗 Superset');
    expect(document.querySelector('#main .ss-rest')?.textContent).toContain('Shared rest');
    expect(document.querySelector('#main .badge.superset')?.textContent).toContain('Superset with');
  });
});

/* ----------------------------------------------------------------- units */

describe('the workout day in pounds', () => {
  it('typing 135 lb stores 61.235 kg, and the row shows 135 again', () => {
    const { store, render } = mount({ units: 'imperial' });
    click('#tabs .tab[data-view="A"]');
    expect(texts('#main .log-row.head')[0]).toContain('Weight (lb)');
    expect(document.querySelector(wInput(A1.id, 0))?.getAttribute('placeholder')).toBe('lb');

    typeInto(wInput(A1.id, 0), '135');
    const today = todayISO();
    expect(store.getState().sessions[today]?.ex[A1.id]?.[0]?.w).toBe('61.235');
    const logged = store.getEvents().filter((e) => e.type === 'set_logged');
    expect(logged.at(-1)?.payload['w']).toBe('61.235');

    render();
    expect(document.querySelector<HTMLInputElement>(wInput(A1.id, 0))?.value).toBe('135');
  });

  it('shows last time in pounds, and a ✓ on the suggestion adopts the kilograms behind it', () => {
    const { store } = mount({
      units: 'imperial',
      seed: (s) =>
        s.update((d) => {
          d.sessions['2025-01-05'] = { day: 'A', ex: { [A1.id]: [{ w: '100', r: '10', done: true }] } };
        }),
    });
    click('#tabs .tab[data-view="A"]');
    const inp = document.querySelector<HTMLInputElement>(wInput(A1.id, 0));
    expect(inp?.value).toBe('220.5');
    expect(inp?.classList.contains('prefill')).toBe(true);
    expect(inp?.closest('.inp-wrap')?.querySelector('.prev')?.textContent).toBe('Last time: 220.5 lb × 10');

    click(`#main .chk[data-ex="${A1.id}"][data-set="0"]`);
    expect(store.getState().sessions[todayISO()]?.ex[A1.id]?.[0]).toMatchObject({ w: '100', r: '10', done: true });
  });

  it('metric English is the stored string itself, and kg on the column', () => {
    const { store } = mount();
    click('#tabs .tab[data-view="A"]');
    typeInto(wInput(A1.id, 0), '62.5');
    expect(store.getState().sessions[todayISO()]?.ex[A1.id]?.[0]?.w).toBe('62.5');
    expect(document.querySelector(wInput(A1.id, 0))?.hasAttribute('data-kg')).toBe(false);
  });

  it('never converts a cardio load: an incline stays a percent in imperial', () => {
    const doc = defaultPlanDoc();
    const key = newDayKey();
    doc.days.push(makePlanDay(key, 'Cardio', [3], [{ id: 'x21', sets: 3, reps: '5 דק׳', rest: 300 }]));
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    const { store } = mount({
      units: 'imperial',
      seed: (s) => {
        const res = savePlan(s, doc);
        if (!res.ok) throw new Error(res.errors.join());
      },
    });
    click(`#tabs .tab[data-view="${key}"]`);
    const head = texts('#main .log-row.head')[0] ?? '';
    expect(head).toContain('Stage');
    expect(head).toContain('(%)');
    expect(head).not.toContain('lb');
    expect(document.querySelector<HTMLInputElement>(wInput('x21', 0))?.value).toBe('1');
    typeInto(wInput('x21', 0), '3');
    expect(store.getState().sessions[todayISO()]?.ex['x21']?.[0]?.w).toBe('3');
    expect(texts('#main .badge.scheme')[0]).toBe('3 stages × 5 min');
  });
});

/* ---------------------------------------------------------- plan editor */

describe('the plan editor in English', () => {
  function openEditor(): void {
    click('#tabs .tab[data-view="A"]');
    click('#btnEditPlan');
  }

  it('speaks English, with the built-in days named in English and Monday first', () => {
    mount();
    openEditor();
    expectNoHebrew(texts('#main .pl-day-name'), 'day tabs');
    expect(texts('#main .pl-day-sub')[0]).toBe(`${PROGRAM.A.exercises.length} exercises`);
    expect(document.querySelector<HTMLInputElement>('#plDayLabel')?.value).not.toMatch(HEBREW);
    expect(texts('#main .pl-wd')).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    expect(attrs('#main .pl-wd', 'data-wd')).toEqual(['1', '2', '3', '4', '5', '6', '0']);
    expect(document.querySelector('#plWdCaption')?.textContent).toBe('Training days: Sunday · Monday');
    expect(document.querySelector('#plTarget')?.textContent).toContain('Weekly target: 3 workout days');
    expect(document.querySelector('#plSave')?.textContent).toBe('💾 Save');
    expect(document.querySelector('#plHint')?.textContent).toBe('This plan is the original plan.');
    expectNoHebrew(
      [
        ...texts('#main .pl-field > span'),
        ...attrs('#main [data-edit="reps"]', 'value'),
        ...texts('#main .pl-sslink'),
        ...texts('#main .pl-actions'),
        ...texts('#main .gc-note'),
        ...attrs('#main .pl-mini', 'aria-label'),
        ...texts('#main .pl-add'),
        ...texts('#main .pl-presets'),
        ...texts('#main .pl-reset'),
      ],
      'editor chrome',
    );
  });

  it('a weekday chip still writes the Sunday-based index', () => {
    const { store } = mount();
    openEditor();
    click('#main .pl-wd[data-wd="3"]'); // Wednesday
    click('#plSave');
    const a = store.getState().plan?.days.find((d) => d.key === 'A');
    expect(a?.weekdays).toEqual([0, 3]);
  });

  it('lists the presets in English, and a preset builds its days in English', () => {
    const { store } = mount();
    openEditor();
    click('#plPresets');
    expect(document.querySelector('.pl-sheet h3')?.textContent).toBe('Ready-made plans');
    expect(document.querySelector('[data-preset="ab4"] b')?.textContent).toBe('A/B plan — 4 days');
    expect(document.querySelector('[data-preset="ab4"] span')?.textContent).toContain('3 workout days · ');
    expectNoHebrew(texts('.pl-sheet'), 'presets sheet');

    click('[data-preset="ab4"]');
    click('#plSave');
    const labels = store.getState().plan?.days.map((d) => d.label) ?? [];
    expect(labels).toEqual([
      'Workout A — legs, pushing & decompression',
      'Workout B1 — back & pulling · pull-up strength',
      'Workout B2 — back & pulling · negatives',
    ]);
  });

  it('the built-in preset is still the original plan', () => {
    const { store } = mount();
    openEditor();
    click('#plPresets');
    click('[data-preset="builtin3"]');
    click('#plSave');
    expect(store.getState().plan?.days.map((d) => d.label)).toEqual(['A', 'B', 'C'].map((k) => PROGRAM[k as 'A'].label));
  });

  it('the library and the new-exercise form speak English, and the name typed is the English name', () => {
    const { store } = mount();
    openEditor();
    click('#plAdd');
    expect(document.querySelector('#plNewToggle')?.textContent).toBe('✨ Create a new exercise');
    click('#plNewToggle');
    expectNoHebrew(
      [...texts('#plNewForm label > span'), ...texts('#plNewForm option'), ...texts('#plNewForm legend'), ...texts('#plNewForm button')],
      'new exercise form',
    );
    typeInto('#nxHe', 'Cable curl');
    document.querySelector('#plNewForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    click('#plSave');
    const custom = store.getState().plan?.customExercises[0];
    expect(custom).toMatchObject({ he: 'Cable curl', en: 'Cable curl', unit: 'חזרות' });
    expect(texts('#main .pl-names b')).toContain('Cable curl');
  });

  it('refuses a nameless exercise in English', () => {
    mount();
    openEditor();
    click('#plAdd');
    click('#plNewToggle');
    document.querySelector('#plNewForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.toast, #toast')?.textContent ?? '').toContain('needs a name');
  });
});

/* -------------------------------------------------------------- history */

describe('the history pane in English', () => {
  function seed(s: LocalStore): void {
    s.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { [A1.id]: [{ w: '100', r: '10', done: true }] } };
    });
  }

  function openHistory(store: LocalStore, render: () => void): void {
    store.update((d) => {
      d.ui.view = 'H';
    });
    render();
  }

  it('speaks English, dates its bubbles "Jan 5", and lists kilograms in metric', () => {
    const { store, render } = mount({ seed });
    openHistory(store, render);
    expect(document.querySelector('#main .hist-heading')?.textContent).toBe('Logged workouts pick a date');
    const bubble = document.querySelector<HTMLElement>('#main .day-bubble');
    expect(bubble?.querySelector('.db-date')?.textContent).toBe('Jan 5');
    expect(bubble?.getAttribute('aria-label')).toMatch(/^Jan 5, 2025 · /);
    expect(bubble?.getAttribute('aria-label')).not.toMatch(HEBREW);
    bubble?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const panel = document.querySelector('#histDayPanel')?.textContent ?? '';
    expect(panel).toContain('100kg×10✓');
    expect(panel).toContain('(Sunday)');
  });

  it('shows the same set in pounds in imperial', () => {
    const { store, render } = mount({ units: 'imperial', seed });
    openHistory(store, render);
    document.querySelector<HTMLElement>('#main .day-bubble')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#histDayPanel')?.textContent).toContain('220.5lb×10✓');
  });

  it('says so in English when nothing is logged', () => {
    const { store, render } = mount();
    openHistory(store, render);
    expect(document.querySelector('#main .empty')?.textContent).toContain('No workouts logged yet.');
  });
});
