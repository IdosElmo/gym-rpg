/**
 * @vitest-environment jsdom
 *
 * cardio.dom.test.ts — a treadmill day on the workout screen.
 *
 * The cardio exercise (`x21`, the incline walk) is a ladder of timed stages
 * logged through the SAME set rows as everything else. What this file proves
 * is the reading of those rows, and nothing underneath them:
 *
 *   * the columns are שלב · שיפוע (%) · דקות, and an untouched stage prefills
 *     from the ladder (1%, 2%, 3%… × 5 דק׳) — dimmed, adopted by ✓;
 *   * ✓ on stage N appends an ORDINARY `set_completed` (w = incline, r = minutes),
 *     pays XP to legs and core, and starts the NEXT stage's timer with the new
 *     incline on the label; the last ✓ starts none and finishes the workout;
 *   * ▶ times the first stage that is not ✓'d yet, and hides when all are;
 *   * the timer's chime says "raise the incline", and goes back to being a rest
 *     timer for the next lift;
 *   * history prints `1%×5 דק׳✓`, never kilograms.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlanDoc, deriveWeeklyTarget, makePlanDay, newDayKey, savePlan } from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { renderHistory } from '../src/ui/history.ts';
import { RestTimer, type StartOptions } from '../src/ui/timer.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import type { PlanDoc } from '../src/data/planTypes.ts';
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

/** The built-in three days plus a fourth: the treadmill, three stages, on Wednesdays. */
function cardioPlan(stages = 3): { doc: PlanDoc; key: string } {
  const doc = defaultPlanDoc();
  const key = newDayKey();
  doc.days.push(makePlanDay(key, 'קרדיו — הליכון', [3], [{ id: 'x21', sets: stages, reps: '5 דק׳', rest: 300 }]));
  doc.weeklyTarget = deriveWeeklyTarget(doc.days);
  return { doc, key };
}

interface Mounted {
  store: LocalStore;
  timer: RestTimer;
  key: string;
  starts: () => { seconds: number; label: string; opts: StartOptions }[];
}

function mount(stages = 3): Mounted {
  const store = new LocalStore(fakeStorage());
  const { doc, key } = cardioPlan(stages);
  const res = savePlan(store, doc);
  if (!res.ok) throw new Error(res.errors.join(', '));
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
  click(`#tabs .tab[data-view="${key}"]`);
  spy.mockClear();
  return {
    store,
    timer,
    key,
    starts: () => spy.mock.calls.map((c) => ({ seconds: c[0], label: c[1] ?? '', opts: c[2] ?? {} })),
  };
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function input(set: number, field: 'w' | 'r'): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`#main .inp[data-ex="x21"][data-set="${set}"][data-f="${field}"]`);
  if (!el) throw new Error(`no ${field} input for stage ${set}`);
  return el;
}

function tap(set: number): void {
  click(`#main .chk[data-ex="x21"][data-set="${set}"]`);
}

function typeInto(set: number, field: 'w' | 'r', value: string): void {
  const el = input(set, field);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function events(store: LocalStore, type: AppEvent['type']): AppEvent[] {
  return store.getEvents().filter((e) => e.type === type);
}

function stageButton(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('#main .stage-start[data-stage="x21"]');
  if (!el) throw new Error('no stage button');
  return el;
}

function text(selector: string): string {
  return document.querySelector<HTMLElement>(selector)?.textContent ?? '';
}

/* -------------------------------------------------------------- rendering */

describe('the treadmill card', () => {
  it('renames the columns to stage / incline / minutes and counts stages, not sets', () => {
    mount();
    const heads = [...document.querySelectorAll<HTMLElement>('#card-x21 .log-row.head div')].map((d) => d.textContent);
    expect(heads).toEqual(['שלב', 'שיפוע (%)', 'דקות', '✓']);
    expect(text('#card-x21 .badge.scheme')).toBe('3 שלבים × 5 דק׳');
    expect(text('#card-x21 .badge.muscle')).toContain('קרדיו');
    expect(text('#card-x21 .rest-hint')).toContain('כל שלב 5:00');
    expect(text('#card-x21 .rest-hint')).not.toContain('מנוחה');
    expect(input(0, 'w').placeholder).toBe('%');
    expect(input(0, 'r').placeholder).toBe('דקות');
    // a strength card on the same install is untouched (day A's tab carries a
    // `A@weekday` view id once a plan schedules it — any instance will do)
    click('#tabs .tab[data-view^="A"]');
    const a = [...document.querySelectorAll<HTMLElement>('#card-a1 .log-row.head div')].map((d) => d.textContent);
    expect(a).toEqual(['סט', 'משקל (ק"ג)', 'חזרות', '✓']);
    expect(document.querySelector('#card-a1 .stage-start')).toBeNull();
  });

  it('prefills an untouched stage from the ladder — 1%, 2%, 3% for 5 minutes — as a dimmed suggestion', () => {
    mount();
    expect([0, 1, 2].map((i) => input(i, 'w').value)).toEqual(['1', '2', '3']);
    expect([0, 1, 2].map((i) => input(i, 'r').value)).toEqual(['5', '5', '5']);
    for (let i = 0; i < 3; i += 1) {
      expect(input(i, 'w').classList.contains('prefill')).toBe(true);
      expect(input(i, 'r').classList.contains('prefill')).toBe(true);
    }
  });

  it('a suggestion is not data: nothing reaches the store until ✓ or typing', () => {
    const m = mount();
    expect(Object.keys(m.store.getState().sessions)).toHaveLength(0);
    expect(m.store.getEvents().filter((e) => e.type === 'set_logged')).toHaveLength(0);
    typeInto(1, 'r', '6');
    expect(m.store.getState().sessions[Object.keys(m.store.getState().sessions)[0] ?? '']?.ex['x21']?.[1]).toMatchObject({ w: '', r: '6' });
  });

  it('offers a ▶ for the first stage, and the ✓ hint says the next timer follows', () => {
    mount();
    expect(stageButton().hidden).toBe(false);
    expect(stageButton().textContent).toBe('▶ טיימר לשלב 1 מתוך 3');
  });
});


/* ------------------------------------------------------------------ timing */

describe('the stage timer', () => {
  it('▶ times stage 1 for its 5 minutes, with the incline on the label and "טיימר שלב" below it', () => {
    const m = mount();
    click('#main .stage-start[data-stage="x21"]');
    expect(m.starts()).toEqual([
      { seconds: 300, label: '🏃 שלב 1/3 · שיפוע 1%', opts: { sub: 'טיימר שלב', doneLabel: 'שלב 1 הסתיים — סמנו ✓ והעלו שיפוע! 💪' } },
    ]);
    expect(text('#tTitle')).toBe('🏃 שלב 1/3 · שיפוע 1%');
    expect(text('#tSub')).toBe('טיימר שלב');
    expect(document.getElementById('timerBar')?.classList.contains('show')).toBe(true);
  });

  it('✓ on a stage starts the NEXT stage with its new incline, and the last ✓ starts nothing', () => {
    const m = mount();
    tap(0);
    expect(m.starts()).toHaveLength(1);
    expect(m.starts()[0]).toMatchObject({ seconds: 300, label: '🏃 שלב 2/3 · שיפוע 2%' });
    expect(stageButton().textContent).toBe('▶ טיימר לשלב 2 מתוך 3');
    tap(1);
    expect(m.starts()).toHaveLength(2);
    expect(m.starts()[1]).toMatchObject({
      label: '🏃 שלב 3/3 · שיפוע 3%',
      opts: { sub: 'טיימר שלב', doneLabel: 'השלב האחרון הסתיים — סמנו ✓ 🏁' },
    });
    tap(2);
    // nothing comes after the last stage — no timer, and the ▶ is gone
    expect(m.starts()).toHaveLength(2);
    expect(stageButton().hidden).toBe(true);
    expect(document.getElementById('card-x21')?.classList.contains('done-all')).toBe(true);
  });

  it('▶ picks the first stage not yet ✓’d, with whatever incline its row shows', () => {
    const m = mount();
    tap(0); // the ✓ started stage 2's timer — say the user closed it
    typeInto(1, 'w', '2.5');
    click('#main .stage-start[data-stage="x21"]');
    expect(m.starts()[1]).toMatchObject({ seconds: 300, label: '🏃 שלב 2/3 · שיפוע 2.5%' });
  });

  it('chimes "raise the incline", then is a rest timer again for the next lift', () => {
    vi.useFakeTimers();
    const m = mount();
    m.timer.start(1, '🏃 שלב 1/3', { sub: 'טיימר שלב', doneLabel: 'שלב 1 הסתיים — סמנו ✓ והעלו שיפוע! 💪' });
    vi.advanceTimersByTime(1600);
    expect(text('#tTitle')).toBe('שלב 1 הסתיים — סמנו ✓ והעלו שיפוע! 💪');
    expect(text('#tSub')).toBe('טיימר שלב');
    m.timer.start(1, 'לחיצת חזה · סט 1 הושלם');
    expect(text('#tSub')).toBe('טיימר מנוחה');
    vi.advanceTimersByTime(1600);
    expect(text('#tTitle')).toBe('המנוחה הסתיימה — לסט הבא! 💪');
  });
});

/* ---------------------------------------------------------------- logging */

describe('what a stage logs', () => {
  it('✓ adopts the suggested incline and minutes into an ordinary set_completed, and pays legs + core', () => {
    const m = mount();
    tap(0);
    const done = events(m.store, 'set_completed');
    expect(done).toHaveLength(1);
    expect(done[0]?.payload).toMatchObject({ day: m.key, exId: 'x21', setIndex: 0, w: '1', r: '5' });
    expect(input(0, 'w').classList.contains('prefill')).toBe(false);
    const xp = events(m.store, 'xp_gained');
    expect(xp).toHaveLength(1);
    const parts = xp[0]?.payload['parts'] as Record<string, number>;
    expect(Object.keys(parts).sort()).toEqual(['core', 'legs']);
    expect(parts['legs']).toBeGreaterThan(parts['core'] ?? 0);
    // volume is incline × minutes — the number a later, steeper stage beats
    expect(xp[0]?.payload['volume']).toBe(5);
  });

  it('a typed incline replaces the suggestion, and the steeper stage is the PR', () => {
    const m = mount();
    typeInto(0, 'w', '4');
    tap(0);
    expect(events(m.store, 'set_completed')[0]?.payload).toMatchObject({ w: '4', r: '5' });
    tap(1); // 2% × 5 = 10 < 20: no record
    expect(events(m.store, 'pr_achieved')).toHaveLength(0);
    typeInto(2, 'w', '5');
    tap(2); // 5% × 5 = 25 > 20: the record
    expect(events(m.store, 'pr_achieved')).toHaveLength(1);
    expect(events(m.store, 'pr_achieved')[0]?.payload).toMatchObject({ exId: 'x21', volume: 25, previousBest: 20 });
  });

  it('finishing every stage finishes the workout — once', () => {
    const m = mount();
    tap(0);
    tap(1);
    expect(events(m.store, 'workout_finished')).toHaveLength(0);
    tap(2);
    expect(events(m.store, 'workout_finished')).toHaveLength(1);
    expect(events(m.store, 'workout_finished')[0]?.payload).toMatchObject({ day: m.key });
    // un-✓ and ✓ again: still one
    tap(2);
    tap(2);
    expect(events(m.store, 'workout_finished')).toHaveLength(1);
  });

  it('shows up in history as incline × minutes, never as kilograms', () => {
    const m = mount();
    tap(0);
    tap(1);
    const date = Object.keys(m.store.getState().sessions)[0] ?? '';
    const main = document.getElementById('main') as HTMLElement;
    renderHistory(main, { store: m.store });
    click(`#main .day-bubble[data-date="${date}"]`);
    const panel = text('#main #histDayPanel');
    expect(panel).toContain('הליכה על הליכון בשיפוע');
    expect(panel).toContain('1%×5 דק׳✓');
    expect(panel).toContain('2%×5 דק׳✓');
    expect(panel).not.toContain('kg');
  });
});
