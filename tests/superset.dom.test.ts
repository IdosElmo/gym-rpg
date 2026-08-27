/**
 * @vitest-environment jsdom
 *
 * superset.dom.test.ts — one ✓, two exercises.
 *
 * A superset is a PLAN fact with exactly two consequences on the workout
 * screen: the two cards render as one violet group with ONE shared rest, and a
 * tap on either checkbox completes the same set on both. Everything underneath
 * stays what it was — which is the property this file is really about:
 *
 *   * the tap appends the two ORDINARY `set_completed` events the two
 *     checkboxes would have appended on their own, each with its OWN logged
 *     weight and reps, so history, PRs and the league see nothing new;
 *   * XP is granted for BOTH exercises, each to its own body parts;
 *   * the rest timer starts ONCE — that is the whole point of a superset;
 *   * `workout_finished` still fires exactly once for the day.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlanDoc, savePlan } from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import type { PlanDoc } from '../src/data/planTypes.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
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

/* ------------------------------------------------------------------ setup */

/** Day A: לחיצת חזה (chest) + סקוואט (legs) LINKED, then a third, plain card. */
const PAIR: readonly [string, string] = ['a1', 'a3'];

function planWithPair(): PlanDoc {
  const doc = defaultPlanDoc();
  const day = doc.days.find((d) => d.key === 'A');
  if (!day) throw new Error('no day A');
  day.exercises = [
    { id: 'a1', sets: 2, reps: '8–10', rest: 90 },
    { id: 'a3', sets: 2, reps: '10–12', rest: 90 },
    { id: 'a6', sets: 1, reps: '12–15', rest: 60 },
  ];
  day.supersets = [PAIR];
  return doc;
}

interface Mounted {
  store: LocalStore;
  timer: RestTimer;
  starts: () => { seconds: number; label: string }[];
}

function mount(plan: PlanDoc | null = planWithPair()): Mounted {
  const store = new LocalStore(fakeStorage());
  if (plan) {
    const res = savePlan(store, plan);
    if (!res.ok) throw new Error(res.errors.join(', '));
  }
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
  const spy = vi.spyOn(timer, 'start');
  const app = createApp(store, timer);
  app.render();
  // The boot tab follows the real weekday; these tests are about day A, so
  // they go there explicitly and stay green on any day of the week.
  click('#tabs .tab[data-view="A"]');
  spy.mockClear();
  return {
    store,
    timer,
    starts: () => spy.mock.calls.map((c) => ({ seconds: c[0], label: c[1] ?? '' })),
  };
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function chk(exId: string, set: number): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`#main .chk[data-ex="${exId}"][data-set="${set}"]`);
  if (!el) throw new Error(`no checkbox ${exId}/${set}`);
  return el;
}

function tap(exId: string, set: number): void {
  chk(exId, set).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function typeInto(exId: string, set: number, field: 'w' | 'r', value: string): void {
  const el = document.querySelector<HTMLInputElement>(
    `#main .inp[data-ex="${exId}"][data-set="${set}"][data-f="${field}"]`,
  );
  if (!el) throw new Error(`no ${field} input for ${exId}/${set}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function setEvents(store: LocalStore, type: AppEvent['type']): AppEvent[] {
  return store.getEvents().filter((e) => e.type === type);
}

function today(store: LocalStore): string {
  return Object.keys(store.getState().sessions)[0] ?? '';
}

/* --------------------------------------------------------------- rendering */

describe('the superset group on the workout screen', () => {
  it('welds the two cards into one group, with one chip, one joint and one rest', () => {
    mount();
    const group = document.querySelector('#main .ss-group');
    expect(group).not.toBeNull();
    expect(group?.id).toBe('ss-a1');
    expect([...(group?.querySelectorAll('.ex-card') ?? [])].map((c) => c.id)).toEqual(['card-a1', 'card-a3']);
    expect(group?.querySelector('.ss-chip')?.textContent).toContain('סופר־סט');
    expect(group?.querySelector('.ss-joint span')?.textContent).toContain('בלי מנוחה');
    expect(group?.querySelector('.ss-rest')?.textContent).toContain('מנוחה משותפת: 90 שניות');
    // the pair's own rest hints are gone — the group's single line replaced them
    expect(group?.querySelectorAll('.rest-hint')).toHaveLength(0);
    // …and the third, unlinked card still has its own
    expect(document.querySelector('#card-a6 .rest-hint')?.textContent).toContain('מנוחה מומלצת');
    expect(document.querySelectorAll('#main .ss-group')).toHaveLength(1);
  });

  it('names the partner on each card and keeps the true order numbers', () => {
    mount();
    const badges = [...document.querySelectorAll<HTMLElement>('#main .badge.superset')].map((b) => b.textContent ?? '');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toContain('סופר־סט עם');
    expect(badges[1]).toContain('סופר־סט עם');
    const orders = [...document.querySelectorAll<HTMLElement>('#main .ex-order')].map((o) => o.textContent);
    expect(orders).toEqual(['תרגיל 1 / 3', 'תרגיל 2 / 3', 'תרגיל 3 / 3']);
  });

  it('renders no group at all for the built-in program', () => {
    mount(null);
    expect(document.querySelector('#main .ss-group')).toBeNull();
    expect(document.querySelector('#main .badge.superset')).toBeNull();
    expect(document.querySelectorAll('#main .rest-hint').length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------- one ✓ tap */

describe('one ✓ completes both halves', () => {
  it('appends two ordinary set_completed events, each with its own numbers', () => {
    const { store } = mount();
    typeInto('a1', 0, 'w', '60');
    typeInto('a1', 0, 'r', '9');
    typeInto('a3', 0, 'w', '80');
    typeInto('a3', 0, 'r', '12');

    tap('a1', 0);

    const done = setEvents(store, 'set_completed');
    expect(done).toHaveLength(2);
    expect(done.map((e) => e.payload['exId'])).toEqual(['a1', 'a3']); // card order
    for (const e of done) {
      expect(e.payload['setIndex']).toBe(0);
      expect(e.payload['day']).toBe('A');
    }
    expect(done[0]?.payload).toMatchObject({ exId: 'a1', w: '60', r: '9' });
    expect(done[1]?.payload).toMatchObject({ exId: 'a3', w: '80', r: '12' });

    // the session says the same thing, for both exercises
    const session = store.getState().sessions[today(store)];
    expect(session?.ex['a1']?.[0]).toEqual({ w: '60', r: '9', done: true });
    expect(session?.ex['a3']?.[0]).toEqual({ w: '80', r: '12', done: true });
  });

  it('turns both checkboxes on and marks the one the finger did not touch', () => {
    mount();
    tap('a1', 0);
    expect(chk('a1', 0).classList.contains('on')).toBe(true);
    expect(chk('a3', 0).classList.contains('on')).toBe(true);
    expect(chk('a1', 0).querySelector('.twin')).toBeNull();
    expect(chk('a3', 0).querySelector('.twin')?.textContent).toBe('🔗');
    // both rows read as checked, and the untouched set 2 is still open
    expect(chk('a3', 0).closest('.log-row')?.classList.contains('checked')).toBe(true);
    expect(chk('a3', 1).classList.contains('on')).toBe(false);
  });

  it('works from either side — tapping the second card marks the first', () => {
    const { store } = mount();
    tap('a3', 1);
    expect(chk('a1', 1).classList.contains('on')).toBe(true);
    expect(chk('a1', 1).querySelector('.twin')?.textContent).toBe('🔗');
    expect(chk('a3', 1).querySelector('.twin')).toBeNull();
    // the events stay in CARD order whichever box was tapped
    expect(setEvents(store, 'set_completed').map((e) => e.payload['exId'])).toEqual(['a1', 'a3']);
  });

  it('grants XP for BOTH exercises, each to its own body parts', () => {
    const { store } = mount();
    tap('a1', 0);
    const parts = store.getState().game?.parts;
    if (!parts) throw new Error('no game state');
    // a1 is chest (80/20 with arms), a3 is legs — and nothing else in this day
    // has been touched, so legs XP can ONLY have come from the partner.
    expect(parts.chest.xp).toBeGreaterThan(0);
    expect(parts.legs.xp).toBeGreaterThan(0);
    expect(parts.arms.xp).toBeGreaterThan(0);
    expect(parts.core.xp).toBe(0);
    // one grant per exercise, and the anti-farm ledger knows about both sets
    const granted = store.getState().game?.granted ?? {};
    const date = today(store);
    expect(granted[`${date}|a1|0`]).toBe(true);
    expect(granted[`${date}|a3|0`]).toBe(true);
  });

  it('starts ONE rest timer for the pair, with the shared rest', () => {
    const { starts } = mount();
    tap('a1', 0);
    expect(starts()).toHaveLength(1);
    expect(starts()[0]?.seconds).toBe(90);
    expect(starts()[0]?.label).toContain('סופר־סט');
    expect(document.getElementById('timerBar')?.classList.contains('show')).toBe(true);
  });

  it('leaves an unlinked exercise exactly as it was: one event, one plain timer', () => {
    const { store, starts } = mount();
    tap('a6', 0);
    expect(starts()).toHaveLength(1);
    expect(starts()[0]?.seconds).toBe(60);
    expect(starts()[0]?.label).not.toContain('סופר־סט');
    const done = setEvents(store, 'set_completed');
    expect(done).toHaveLength(1);
    expect(done[0]?.payload['exId']).toBe('a6');
  });

  it('flies the partner XP up in its own colour', () => {
    mount();
    tap('a1', 0);
    const flies = [...document.querySelectorAll('.xp-fly')];
    expect(flies.length).toBeGreaterThanOrEqual(2);
    expect(flies.some((f) => !f.classList.contains('ss'))).toBe(true);
    expect(flies.some((f) => f.classList.contains('ss'))).toBe(true);
  });
});

/* ------------------------------------------------------------- unchecking */

describe('unchecking a superset', () => {
  it('reverts both halves with two set_uncompleted events and no timer', () => {
    const { store, starts } = mount();
    tap('a1', 0);
    tap('a3', 0); // the partner's box — unchecks the pair it just checked

    const undone = setEvents(store, 'set_uncompleted');
    expect(undone).toHaveLength(2);
    expect(undone.map((e) => e.payload['exId'])).toEqual(['a1', 'a3']);
    expect(chk('a1', 0).classList.contains('on')).toBe(false);
    expect(chk('a3', 0).classList.contains('on')).toBe(false);
    expect(chk('a1', 0).querySelector('.twin')).toBeNull();
    expect(chk('a3', 0).querySelector('.twin')).toBeNull();
    expect(chk('a1', 0).closest('.log-row')?.classList.contains('checked')).toBe(false);
    // only the CHECK started a timer
    expect(starts()).toHaveLength(1);
    const session = store.getState().sessions[today(store)];
    expect(session?.ex['a1']?.[0]?.done).toBe(false);
    expect(session?.ex['a3']?.[0]?.done).toBe(false);
  });
});

/* ------------------------------------------------------------- completion */

describe('finishing a superset and the day', () => {
  it('greens the group only once every set of BOTH exercises is done', () => {
    mount();
    const group = (): HTMLElement => document.querySelector<HTMLElement>('#main .ss-group') as HTMLElement;
    tap('a1', 0);
    expect(group().classList.contains('done-all')).toBe(false);
    expect(document.getElementById('card-a1')?.classList.contains('done-all')).toBe(false);
    tap('a1', 1);
    expect(group().classList.contains('done-all')).toBe(true);
    // both inner cards keep their own done-all, exactly as before
    expect(document.getElementById('card-a1')?.classList.contains('done-all')).toBe(true);
    expect(document.getElementById('card-a3')?.classList.contains('done-all')).toBe(true);
  });

  it('fires workout_finished exactly once when the whole day is done', () => {
    const { store } = mount();
    tap('a1', 0);
    tap('a1', 1);
    tap('a6', 0);
    expect(setEvents(store, 'workout_finished')).toHaveLength(1);
    expect(setEvents(store, 'set_completed')).toHaveLength(5); // 2 + 2 + 1
    // …and tapping around some more never pays a second time
    tap('a6', 0);
    tap('a6', 0);
    expect(setEvents(store, 'workout_finished')).toHaveLength(1);
  });

  it('re-renders from the log with both halves checked (the 🔗 mark is live-only)', () => {
    const { store } = mount();
    tap('a1', 0);
    click('#tabs .tab[data-view="B"]');
    click('#tabs .tab[data-view="A"]');
    expect(chk('a1', 0).classList.contains('on')).toBe(true);
    expect(chk('a3', 0).classList.contains('on')).toBe(true);
    expect(store.getState().sessions[today(store)]?.ex['a3']?.[0]?.done).toBe(true);
  });
});
