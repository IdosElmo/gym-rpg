/**
 * @vitest-environment jsdom
 *
 * The היסטוריה screen (`ui/history.ts`) after the two-pane rework:
 *
 *  - the adventure feed scrolls inside its own fixed-height pane, under a card
 *    header that stays put;
 *  - the training log is a wrap of DATE BUBBLES, newest first, and the day you
 *    tap expands into the very same `.hist-day` card the screen used to list —
 *    one panel at a time, in its own pane.
 *
 * The panel's data rendering is deliberately untouched, so the assertions on
 * exercise names and set lines below are the same ones the old list satisfied.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { PROGRAM } from '../src/data/program.ts';
import { renderHistory } from '../src/ui/history.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function main(): HTMLElement {
  const el = document.getElementById('main');
  if (!el) throw new Error('no #main');
  return el;
}

function render(store: LocalStore): void {
  renderHistory(main(), { store });
}

function bubbles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#main .day-bubble')];
}

function bubble(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`#main .day-bubble[data-date="${date}"]`);
  if (!el) throw new Error(`no bubble for ${date}`);
  return el;
}

function tap(date: string): void {
  bubble(date).dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function panelText(): string {
  return document.querySelector<HTMLElement>('#main #histDayPanel')?.textContent ?? '';
}

/** A store with three logged days, one of them all-empty sets. */
function loggedStore(): LocalStore {
  const store = new LocalStore(fakeStorage());
  store.update((d) => {
    d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    d.sessions['2025-01-12'] = { day: 'B', ex: { b1: [{ w: '55', r: '8', done: true }] } };
    // logged nothing at all — the old list dropped it, and so does the bubble row
    d.sessions['2025-02-03'] = { day: 'A', ex: { a1: [{ w: '', r: '', done: false }] } };
  });
  return store;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="main"></main>';
});

describe('the adventure feed pane', () => {
  it('scrolls inside its own pane, with the card header left outside it', () => {
    const store = new LocalStore(fakeStorage());
    store.append('workout_finished', { date: '2025-01-05', day: 'A' });
    render(store);

    const pane = document.querySelector<HTMLElement>('#main .game-card .scroll-pane.feed-scroll');
    expect(pane).not.toBeNull();
    // the lines are INSIDE the pane…
    expect(pane?.querySelector('ul.feed .feed-item')).not.toBeNull();
    // …and the header that counts them is not
    const title = document.querySelector<HTMLElement>('#main .game-card .gc-title');
    expect(title?.textContent).toContain('יומן הרפתקה');
    expect(title?.closest('.scroll-pane')).toBeNull();
  });

  it('keeps an empty feed as a plain note, with no pane to scroll', () => {
    render(new LocalStore(fakeStorage()));
    expect(document.querySelector('#main .feed-scroll')).toBeNull();
    expect(document.querySelector('#main .gc-note')?.textContent).toContain('עדיין אין אירועים');
  });
});

describe('the training-log bubbles', () => {
  it('draws one bubble per logged day, newest first, dated d.m', () => {
    render(loggedStore());
    expect(bubbles()).toHaveLength(2); // the all-empty day gets none
    expect(bubbles().map((b) => b.dataset['date'])).toEqual(['2025-01-12', '2025-01-05']);
    expect(bubbles().map((b) => b.querySelector('.db-date')?.textContent)).toEqual(['12.1', '5.1']);
    // the label is abbreviated on the bubble and complete in its accessible name
    expect(bubbles()[0]?.querySelector('.db-chip')?.textContent).toBe('B');
    expect(bubbles()[0]?.getAttribute('aria-label')).toContain(PROGRAM.B.label);
    expect(bubbles()[0]?.getAttribute('aria-label')).toContain('12.01.2025');
  });

  it('gives the whole log its own scroll pane, bubbles and panel inside it', () => {
    render(loggedStore());
    const pane = document.querySelector<HTMLElement>('#main .scroll-pane.log-scroll');
    expect(pane).not.toBeNull();
    expect(pane?.querySelector('.day-bubbles .day-bubble')).not.toBeNull();
    expect(pane?.querySelector('#histDayPanel')).not.toBeNull();
    expect(document.querySelector('#main .hist-heading')?.textContent).toContain('אימונים מתועדים');
  });

  it('starts with every bubble closed and no panel content', () => {
    render(loggedStore());
    expect(panelText()).toBe('');
    expect(document.querySelector('#main .day-bubble.open')).toBeNull();
    expect(bubbles().every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
  });

  it('expands the tapped day — its name, its exercises and its sets', () => {
    render(loggedStore());
    tap('2025-01-05');

    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain('05.01.2025');
    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain(PROGRAM.A.label);
    expect(document.querySelector('#main .hist-ex b')?.textContent).toBe('לחיצת חזה בשיפוע חיובי');
    expect(document.querySelector('#main .hist-sets')?.textContent).toContain('40kg×10✓');
    expect(bubble('2025-01-05').classList.contains('open')).toBe(true);
    expect(bubble('2025-01-05').getAttribute('aria-expanded')).toBe('true');
  });

  it('switches to another day on a second bubble, and never opens two', () => {
    render(loggedStore());
    tap('2025-01-05');
    tap('2025-01-12');

    expect(document.querySelectorAll('#main .hist-day')).toHaveLength(1);
    expect(document.querySelectorAll('#main .day-bubble.open')).toHaveLength(1);
    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain('12.01.2025');
    expect(document.querySelector('#main .hist-ex b')?.textContent).toBe('לחיצת חזה בשכיבה שטוחה בסמית׳');
    expect(document.querySelector('#main .hist-sets')?.textContent).toContain('55kg×8✓');
    expect(bubble('2025-01-05').classList.contains('open')).toBe(false);
    expect(bubble('2025-01-05').getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses when the open bubble is tapped again', () => {
    render(loggedStore());
    tap('2025-01-05');
    expect(panelText()).not.toBe('');
    tap('2025-01-05');

    expect(panelText()).toBe('');
    expect(document.querySelector('#main .hist-day')).toBeNull();
    expect(document.querySelector('#main .day-bubble.open')).toBeNull();
    expect(bubble('2025-01-05').getAttribute('aria-expanded')).toBe('false');
  });

  it('re-rendering the screen starts closed again (the open day is not state)', () => {
    const store = loggedStore();
    render(store);
    tap('2025-01-05');
    expect(panelText()).not.toBe('');

    render(store);
    expect(panelText()).toBe('');
    expect(document.querySelector('#main .day-bubble.open')).toBeNull();
    // …and the freshly drawn bubbles still work
    tap('2025-01-12');
    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain('12.01.2025');
  });

  it('marks a fully completed workout, and only that one', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      const full: Record<string, { w: string; r: string; done: boolean }[]> = {};
      for (const ex of PROGRAM.A.exercises) {
        full[ex.id] = Array.from({ length: ex.sets }, () => ({ w: '40', r: '10', done: true }));
      }
      d.sessions['2025-01-05'] = { day: 'A', ex: full };
      d.sessions['2025-01-06'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    });
    render(store);

    expect(bubble('2025-01-05').classList.contains('done')).toBe(true);
    expect(bubble('2025-01-05').querySelector('.db-tick')?.textContent).toBe('✓');
    expect(bubble('2025-01-06').classList.contains('done')).toBe(false);
    expect(bubble('2025-01-06').querySelector('.db-tick')).toBeNull();
  });

  it('keeps the friendly empty state when nothing was ever logged', () => {
    render(new LocalStore(fakeStorage()));
    expect(document.querySelector('#main .empty')?.textContent).toContain('עדיין אין אימונים מתועדים');
    expect(document.querySelector('#main .log-scroll')).toBeNull();
    expect(bubbles()).toHaveLength(0);
  });

  it('toggles instantly under prefers-reduced-motion (nothing waits on an animation)', () => {
    // The expand/collapse is a class flip plus an innerHTML swap — there is no
    // transitionend, no rAF and no timer anywhere in the path, so a reduced
    // motion session (where responsive.css kills every transition) behaves
    // exactly like any other one: synchronous, and complete on the next line.
    const reduced = (q: string): MediaQueryList =>
      ({ matches: q.includes('reduce'), media: q, addEventListener: () => undefined }) as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', { value: reduced, configurable: true, writable: true });
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);

    render(loggedStore());
    tap('2025-01-12');
    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain('12.01.2025');
    tap('2025-01-12');
    expect(document.querySelector('#main .hist-day')).toBeNull();
  });
});
