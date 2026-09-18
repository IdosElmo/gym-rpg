/**
 * @vitest-environment jsdom
 *
 * notes.dom.test.ts — the 📝 drawer on every exercise card.
 *
 *   * every card of the day (plain, superset half, cardio, hold) ends with a
 *     notes toggle and a box, collapsed when the exercise has no note;
 *   * typing is saved automatically — ONE `exercise_note_set` per pause in
 *     typing, at once on blur, and never one per keystroke;
 *   * a card with a note renders with the drawer OPEN and the note in the box,
 *     on this and every later workout;
 *   * clearing the box clears the note.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPlanDoc, savePlan } from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import { NOTE_COMMIT_DELAY_MS, flushNoteEdits } from '../src/ui/workout.ts';
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
  vi.useFakeTimers();
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
});

afterEach(() => {
  flushNoteEdits();
  vi.useRealTimers();
});

/** Day A: a superset pair, a plain card, the treadmill ladder and a plank. */
function plan(): PlanDoc {
  const doc = defaultPlanDoc();
  const day = doc.days.find((d) => d.key === 'A');
  if (!day) throw new Error('no day A');
  day.exercises = [
    { id: 'a1', sets: 2, reps: '8–10', rest: 90 },
    { id: 'a3', sets: 2, reps: '10–12', rest: 90 },
    { id: 'a6', sets: 1, reps: '12–15', rest: 60 },
    { id: 'x21', sets: 2, reps: '5', rest: 300 },
    { id: 'c1', sets: 1, reps: '45–60 שנ׳', rest: 60 },
  ];
  day.supersets = [['a1', 'a3']];
  return doc;
}

function mount(storage: StorageLike = fakeStorage()): LocalStore {
  const store = new LocalStore(storage);
  if (!store.getState().plan) {
    const res = savePlan(store, plan());
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
  createApp(store, timer).render();
  click('#tabs .tab[data-view="A"]');
  return store;
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function drawer(exId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`#main .ex-notes[data-notes-of="${exId}"]`);
  if (!el) throw new Error(`no notes drawer for ${exId}`);
  return el;
}

function box(exId: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(`#main .notes-inp[data-note="${exId}"]`);
  if (!el) throw new Error(`no notes box for ${exId}`);
  return el;
}

function type(exId: string, value: string): void {
  const el = box(exId);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function noteEvents(store: LocalStore): AppEvent[] {
  return store.getEvents().filter((e) => e.type === 'exercise_note_set');
}

describe('the notes drawer on the workout screen', () => {
  it('every card gets a collapsed 📝 toggle and a box, whatever kind of card it is', () => {
    mount();
    const cards = [...document.querySelectorAll('#main .ex-card')];
    expect(cards.map((c) => c.id)).toEqual(['card-a1', 'card-a3', 'card-a6', 'card-x21', 'card-c1']);
    for (const card of cards) {
      const d = card.querySelector('.ex-notes');
      expect(d, card.id).not.toBeNull();
      expect(d?.classList.contains('open')).toBe(false);
      expect(d?.classList.contains('has-note')).toBe(false);
      expect(d?.querySelector('.notes-toggle')?.textContent).toContain('הערות לתרגיל');
      expect(d?.querySelector('.notes-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(d?.querySelector<HTMLTextAreaElement>('.notes-inp')?.value).toBe('');
      // the drawer is the LAST thing on the card — under the rows and the buttons
      expect(card.lastElementChild).toBe(d);
    }
    // the box names its exercise for a screen reader
    expect(box('a1').getAttribute('aria-label')).toContain('הערות לתרגיל');
  });

  it('the toggle opens and closes the drawer', () => {
    mount();
    click('#main .notes-toggle[data-notes="a6"]');
    expect(drawer('a6').classList.contains('open')).toBe(true);
    expect(document.querySelector('#main .notes-toggle[data-notes="a6"]')?.getAttribute('aria-expanded')).toBe('true');
    click('#main .notes-toggle[data-notes="a6"]');
    expect(drawer('a6').classList.contains('open')).toBe(false);
    // no event for opening a drawer — nothing was written
    expect(document.querySelectorAll('#main .ex-notes.open')).toHaveLength(0);
  });

  it('typing saves ONE event per pause, not one per keystroke', () => {
    const store = mount();
    click('#main .notes-toggle[data-notes="a6"]');
    type('a6', 'ג');
    type('a6', 'גובה');
    type('a6', 'גובה מושב 4');
    expect(noteEvents(store)).toHaveLength(0);
    vi.advanceTimersByTime(NOTE_COMMIT_DELAY_MS + 1);
    const evs = noteEvents(store);
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload['exId']).toBe('a6');
    expect(evs[0]?.payload['note']).toBe('גובה מושב 4');
    expect(store.getState().exerciseNotes).toEqual({ a6: 'גובה מושב 4' });
    expect(drawer('a6').classList.contains('has-note')).toBe(true);
  });

  it('blur saves at once and drops the timer, so nothing is written twice', () => {
    const store = mount();
    type('a1', 'אחיזה רחבה');
    box('a1').dispatchEvent(new Event('blur'));
    expect(noteEvents(store)).toHaveLength(1);
    vi.advanceTimersByTime(NOTE_COMMIT_DELAY_MS * 2);
    expect(noteEvents(store)).toHaveLength(1);
    // a blur after no edit writes nothing either
    box('a1').dispatchEvent(new Event('blur'));
    expect(noteEvents(store)).toHaveLength(1);
  });

  it('a card with a note renders with the drawer open and the note in the box — next time too', () => {
    const storage = fakeStorage();
    const store = mount(storage);
    type('x21', 'להתחיל בשיפוע 2');
    box('x21').dispatchEvent(new Event('blur'));
    // re-render this screen: the drawer is open, the box says the note
    click('#tabs .tab[data-view="A"]');
    expect(drawer('x21').classList.contains('open')).toBe(true);
    expect(drawer('x21').classList.contains('has-note')).toBe(true);
    expect(box('x21').value).toBe('להתחיל בשיפוע 2');
    // the others stayed collapsed
    expect(drawer('a1').classList.contains('open')).toBe(false);
    // a fresh boot over the same storage (a new workout day) shows it again
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    const again = mount(storage);
    expect(again.getState().exerciseNotes).toEqual(store.getState().exerciseNotes);
    expect(box('x21').value).toBe('להתחיל בשיפוע 2');
    expect(drawer('x21').classList.contains('open')).toBe(true);
  });

  it('a re-render flushes a note still on its timer, so nothing typed is lost', () => {
    const store = mount();
    type('c1', 'לנשום');
    click('#tabs .tab[data-view="A"]');
    expect(noteEvents(store)).toHaveLength(1);
    expect(box('c1').value).toBe('לנשום');
  });

  it('clearing the box clears the note', () => {
    const store = mount();
    type('a3', 'x');
    box('a3').dispatchEvent(new Event('blur'));
    type('a3', '');
    box('a3').dispatchEvent(new Event('blur'));
    expect(noteEvents(store)).toHaveLength(2);
    expect(store.getState().exerciseNotes).toEqual({});
    expect(drawer('a3').classList.contains('has-note')).toBe(false);
  });

  it('a hidden page flushes what was typed', () => {
    const store = mount();
    type('a6', 'לפני שהטלפון נכבה');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(noteEvents(store)).toHaveLength(1);
  });
});
