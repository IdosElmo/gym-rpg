/**
 * @vitest-environment jsdom
 *
 * hold.dom.test.ts — the ▶ hold timer on a plank's card.
 *
 * An exercise logged in SECONDS (b5 the plank, x13 the dead hang, a custom
 * "עד כישלון" hold) gets one button under its rows that starts the floating
 * timer for the next set not yet ✓'d — so nobody reaches for a stopwatch app
 * mid-plank. What this file proves is the reading of that button and nothing
 * underneath it:
 *
 *   * it exists on a seconds card and on no other — not on a press, not on the
 *     treadmill (which has its own stage clock);
 *   * the seconds it counts are what the row visibly shows — last session's
 *     number, or what was typed — else the scheme's own target ("45–60 שנ׳" →
 *     45), else a round half minute for a scheme with no number in it;
 *   * the chime says "mark the ✓", and the small line says it is a hold, not a
 *     rest; ✓ afterwards starts the ordinary rest timer exactly as before;
 *   * the button follows the ✓s — set 2 after the first, hidden after the last,
 *     back after an un-✓ — and the timer itself logs nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlanDoc, makePlanDay, newDayKey, savePlan } from '../src/core/plan.ts';
import { CUSTOM_ID_PREFIX, type PlanDoc } from '../src/data/planTypes.ts';
import { findExercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer, type StartOptions } from '../src/ui/timer.ts';
import { DEFAULT_HOLD_SECONDS, holdSeconds } from '../src/ui/workout.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
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

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ setup */

const HANG = `${CUSTOM_ID_PREFIX}hang01`;
const WHEEL = `${CUSTOM_ID_PREFIX}wheel1`;

/** The built-in three days plus a fourth of custom exercises: a timed hold with no number in its scheme, and a rep exercise. */
function customPlan(): { doc: PlanDoc; key: string } {
  const doc = defaultPlanDoc();
  const key = newDayKey();
  doc.customExercises = [
    { id: HANG, he: 'תלייה עד כישלון', en: 'Hang to failure', equip: ['Bodyweight'], muscle: '', unit: 'שניות', bodyPart: 'back' },
    { id: WHEEL, he: 'גלגלת בטן', en: 'Ab wheel', equip: ['Bodyweight'], muscle: '', unit: 'חזרות', bodyPart: 'core' },
  ];
  doc.days.push(
    makePlanDay(key, 'יום מותאם', [3], [
      { id: HANG, sets: 2, reps: 'עד כישלון', rest: 90 },
      { id: WHEEL, sets: 2, reps: '10', rest: 60 },
    ]),
  );
  return { doc, key };
}

/** The built-in program with day B's row and plank linked as a superset. */
function supersetPlan(): PlanDoc {
  const doc = defaultPlanDoc();
  const b = doc.days.find((d) => d.key === 'B');
  if (!b) throw new Error('no day B');
  b.supersets = [['b4', 'b5']];
  return doc;
}

interface Mounted {
  store: LocalStore;
  timer: RestTimer;
  starts: () => { seconds: number; label: string; opts: StartOptions }[];
}

function mount(o: { plan?: PlanDoc; view?: string; seed?: (store: LocalStore) => void } = {}): Mounted {
  const store = new LocalStore(fakeStorage());
  if (o.plan) {
    const res = savePlan(store, o.plan);
    if (!res.ok) throw new Error(res.errors.join(', '));
  }
  o.seed?.(store);
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
    sub: el('tSub'),
  });
  const spy = vi.spyOn(timer, 'start');
  const app = createApp(store, timer);
  app.render();
  // The boot tab follows the real weekday; the plank lives on day B.
  click(`#tabs .tab[data-view="${o.view ?? 'B'}"]`);
  spy.mockClear();
  return {
    store,
    timer,
    starts: () => spy.mock.calls.map((c) => ({ seconds: c[0], label: c[1] ?? '', opts: c[2] ?? {} })),
  };
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function holdButton(exId = 'b5'): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`#main .hold-start[data-hold="${exId}"]`);
}

function need(exId = 'b5'): HTMLButtonElement {
  const b = holdButton(exId);
  if (!b) throw new Error(`no hold button on ${exId}`);
  return b;
}

function input(exId: string, set: number, field: 'w' | 'r'): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`#main .inp[data-ex="${exId}"][data-set="${set}"][data-f="${field}"]`);
  if (!el) throw new Error(`no ${field} input for ${exId} set ${set}`);
  return el;
}

function typeInto(exId: string, set: number, field: 'w' | 'r', value: string): void {
  const el = input(exId, set, field);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function tap(exId: string, set: number): void {
  click(`#main .chk[data-ex="${exId}"][data-set="${set}"]`);
}

function events(store: LocalStore, type: AppEvent['type']): AppEvent[] {
  return store.getEvents().filter((e) => e.type === type);
}

/* ---------------------------------------------------------- where it shows */

describe('which cards get a hold timer', () => {
  it('the plank does, the presses and rows do not', () => {
    mount();
    expect(holdButton('b5')).not.toBeNull();
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b6']) expect(holdButton(id), id).toBeNull();
    // it sits under the rest hint, inside the log, as a full-width target
    const btn = need();
    expect(btn.closest('.log')).not.toBeNull();
    expect(btn.closest('#card-b5')).not.toBeNull();
    expect(btn.hidden).toBe(false);
  });

  it('a custom exercise logged in seconds gets one; a custom rep exercise does not', () => {
    const { doc, key } = customPlan();
    mount({ plan: doc, view: key });
    expect(holdButton(HANG)).not.toBeNull();
    expect(holdButton(WHEEL)).toBeNull();
  });

  it('the treadmill keeps its own stage clock and gets no hold button', () => {
    const doc = defaultPlanDoc();
    const key = newDayKey();
    doc.days.push(makePlanDay(key, 'קרדיו', [3], [{ id: 'x21', sets: 3, reps: '5 דק׳', rest: 300 }]));
    mount({ plan: doc, view: key });
    expect(holdButton('x21')).toBeNull();
    expect(document.querySelector('#main .stage-start[data-stage="x21"]')).not.toBeNull();
  });

  it('stays on the plank inside a superset — the pair shares the rest, not the hold', () => {
    mount({ plan: supersetPlan() });
    expect(document.getElementById('ss-b4')).not.toBeNull();
    expect(holdButton('b5')).not.toBeNull();
    expect(holdButton('b4')).toBeNull();
  });
});

/* ----------------------------------------------------------- the seconds */

describe('how many seconds it counts', () => {
  it('the scheme’s target when nothing is logged: "45–60 שנ׳" → 45, on the caption too', () => {
    const m = mount();
    const btn = need();
    expect(btn.textContent).toBe('▶ טיימר החזקה לסט 1 מתוך 3 · 0:45');
    btn.click();
    const [s] = m.starts();
    expect(s?.seconds).toBe(45);
    expect(s?.label).toContain('פלאנק');
    expect(s?.label).toContain('סט 1/3');
    expect(s?.opts.sub).toBe('טיימר החזקה');
    expect(s?.opts.doneLabel).toContain('✓');
    // the bar reads as a HOLD, not a rest
    expect(document.getElementById('tSub')?.textContent).toBe('טיימר החזקה');
    // …and starting it logged nothing: the set is done when the ✓ says so
    expect(events(m.store, 'set_completed')).toHaveLength(0);
    expect(events(m.store, 'set_logged')).toHaveLength(0);
  });

  it('what was typed into the row, the moment it is typed', () => {
    const m = mount();
    typeInto('b5', 0, 'r', '50');
    expect(need().textContent).toContain('0:50');
    need().click();
    expect(m.starts()[0]?.seconds).toBe(50);
    // a number typed into ANOTHER set does not move set 1's clock
    typeInto('b5', 1, 'r', '90');
    expect(need().textContent).toContain('0:50');
    // clearing the row falls back to the scheme
    typeInto('b5', 0, 'r', '');
    expect(need().textContent).toContain('0:45');
  });

  it('last session’s seconds when the row is prefilled from it', () => {
    const m = mount({
      seed: (store) =>
        store.update((d) => {
          d.sessions['2020-01-01'] = { day: 'B', ex: { b5: [{ w: '', r: '70', done: true }] } };
        }),
    });
    expect(input('b5', 0, 'r').value).toBe('70');
    expect(input('b5', 0, 'r').classList.contains('prefill')).toBe(true);
    expect(need().textContent).toContain('1:10');
    need().click();
    expect(m.starts()[0]?.seconds).toBe(70);
  });

  it('a round half minute for a scheme with no number in it', () => {
    const { doc, key } = customPlan();
    const m = mount({ plan: doc, view: key });
    expect(need(HANG).textContent).toContain('0:30');
    need(HANG).click();
    expect(m.starts()[0]?.seconds).toBe(DEFAULT_HOLD_SECONDS);
  });

  it('holdSeconds: the row first, then the scheme’s first number, then the default', () => {
    const plank = findExercise('b5');
    const hang = findExercise('x13');
    if (!plank || !hang) throw new Error('missing exercises');
    expect(holdSeconds(plank, '')).toBe(45);
    expect(holdSeconds(plank, '  ')).toBe(45);
    expect(holdSeconds(plank, '52')).toBe(52);
    expect(holdSeconds(plank, '52.4')).toBe(52);
    expect(holdSeconds(plank, '0')).toBe(45); // zero is not a hold
    expect(holdSeconds(plank, '-5')).toBe(45);
    expect(holdSeconds(plank, 'abc')).toBe(45);
    expect(holdSeconds(hang, '')).toBe(30); // "30–45 שנ׳"
    expect(holdSeconds({ ...plank, reps: 'עד כישלון' }, '')).toBe(DEFAULT_HOLD_SECONDS);
  });
});

/* ------------------------------------------------------- following the ✓s */

describe('the button follows the sets', () => {
  it('moves to the next set after ✓, hides after the last, and comes back on an un-✓', () => {
    const m = mount();
    expect(need().textContent).toContain('סט 1 מתוך 3');
    tap('b5', 0);
    // ✓ starts the ORDINARY rest, exactly as before — the hold's clock is the button's
    const [rest] = m.starts();
    expect(rest?.seconds).toBe(60);
    expect(rest?.opts.sub).toBeUndefined();
    expect(need().hidden).toBe(false);
    expect(need().textContent).toContain('סט 2 מתוך 3');
    // set 2's row is what the button quotes now
    typeInto('b5', 1, 'r', '55');
    expect(need().textContent).toContain('0:55');
    tap('b5', 1);
    expect(need().textContent).toContain('סט 3 מתוך 3');
    tap('b5', 2);
    expect(need().hidden).toBe(true);
    expect(document.getElementById('card-b5')?.classList.contains('done-all')).toBe(true);
    // un-✓ the last set: the button is back, for that set
    tap('b5', 2);
    expect(need().hidden).toBe(false);
    expect(need().textContent).toContain('סט 3 מתוך 3');
  });

  it('times the first set not yet ✓’d, whichever order the ✓s came in', () => {
    const m = mount();
    tap('b5', 0);
    tap('b5', 1);
    expect(m.starts()).toHaveLength(2); // the two rests
    need().click();
    const last = m.starts().at(-1);
    expect(last?.label).toContain('סט 3/3');
    expect(last?.seconds).toBe(45);
  });

  it('a superset ✓ moves the plank’s button along with its twin', () => {
    const m = mount({ plan: supersetPlan() });
    tap('b4', 0);
    expect(events(m.store, 'set_completed').map((e) => e.payload['exId'])).toEqual(['b4', 'b5']);
    expect(need().textContent).toContain('סט 2 מתוך 3');
  });
});
