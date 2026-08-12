/**
 * @vitest-environment jsdom
 *
 * tests/stats.dom.test.ts — the 📊 סטטיסטיקות screen: its place in the settings
 * hub, and the markup of the two charts this app now draws by hand.
 *
 * The rendering is a pure function of the computed stats (`statsHtml`), so most
 * of the file needs no store at all — only the tab tests mount the real shell.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { findExercise, type Exercise } from '../src/data/program.ts';
import { addDays, weekStartISO } from '../src/core/xp.ts';
import { fmtDate, todayISO } from '../src/core/workout.ts';
import { computeStats } from '../src/core/stats.ts';
import { fmtDuration, fmtInt, fmtNum, statsHtml } from '../src/ui/stats.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
import type { AppEvent, Session, SetEntry } from '../src/storage/DataStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

const resolveEx = (id: string): Exercise | null => findExercise(id);

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolvePath(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

function mount(store: LocalStore = new LocalStore(fakeStorage())): LocalStore {
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
  createApp(store, timer).render();
  return store;
}

function clickHub(id: string): void {
  document.querySelector<HTMLElement>(`#tabs .hub[data-hub="${id}"]`)?.dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  );
}

function clickView(viewId: string): void {
  const el = document.querySelector<HTMLElement>(`#tabs .tab[data-view="${viewId}"]`);
  if (!el) throw new Error(`no tab ${viewId}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function set(w: string, r: string, done = true): SetEntry {
  return { w, r, done };
}

/** Render the screen into a detached element and hand back its root. */
function render(sessions: Record<string, Session>, events: readonly AppEvent[] = [], today = '2025-03-05'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = statsHtml(computeStats({ sessions, events, resolve: resolveEx, today }));
  return host;
}

const TODAY = '2025-03-05'; // a Wednesday; its week starts on 2025-03-02

const SESSIONS: Record<string, Session> = {
  '2025-02-19': { day: 'A', ex: { a1: [set('40', '10')] } },
  '2025-03-03': {
    day: 'A',
    ex: {
      a1: [set('50', '10'), set('50', '10'), set('55', '8')],
      a5: [set('12', '12')],
      b5: [set('', '60')],
      a6: [set('', '15'), set('', '15', false)],
    },
  },
  '2025-03-05': { day: 'B', ex: { a1: [set('60', '5')] } },
};

/* ------------------------------------------------------------ the tab */

describe('the 📊 tab in the settings hub', () => {
  it('is the settings hub third inner tab and renders the screen when tapped', () => {
    const store = mount();
    clickHub('SE');
    const tabs = [...document.querySelectorAll<HTMLElement>('#tabs .sub-row .tab')];
    expect(tabs.map((t) => t.dataset['view'])).toEqual(['ST', 'H', 'SS']);
    expect(tabs[2]?.textContent).toContain('סטטיסטיקות');

    clickView('SS');
    expect(store.getState().ui.view).toBe('SS');
    expect(document.querySelector('#header .app-title')?.textContent).toContain('סטטיסטיקות');
    expect(document.querySelector('#tabs .tab[data-view="SS"]')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('#main .game-card')).not.toBeNull();
  });

  it('still remembers the last inner tab of each hub — now including 📊', () => {
    const store = mount();
    clickHub('SE');
    clickView('SS');
    clickHub('GM');
    expect(store.getState().ui.view).toBe('BT');
    clickHub('SE');
    expect(store.getState().ui.view).toBe('SS'); // came back to where it was left
    clickHub('TR');
    clickHub('SE');
    expect(store.getState().ui.view).toBe('SS');
  });

  it('boots straight onto the screen when it is the persisted view', () => {
    const store = mount();
    store.update((draft) => {
      draft.ui.view = 'SS';
    });
    mount(store);
    expect(store.getState().ui.view).toBe('SS');
    expect(document.querySelector('#main .stats-empty')).not.toBeNull();
  });

  it('renders real numbers from the store, not a placeholder', () => {
    const store = mount();
    const date = todayISO();
    store.update((draft) => {
      draft.sessions[date] = { day: 'A', ex: { a1: [set('100', '10')] } };
    });
    clickHub('SE');
    clickView('SS');
    expect(document.querySelector('#main .hero-num')?.textContent).toContain('1,000');
  });
});

/* -------------------------------------------------------- the headline */

describe('the headline number', () => {
  it('shows the total tonnage with thousands separators and the fun equivalent', () => {
    const root = render(SESSIONS, [], TODAY);
    const hero = root.querySelector('.hero-num');
    // 400 + (500 + 500 + 440) + 144 + 300 = 2,284 kg
    expect(hero?.textContent).toContain('2,284');
    expect(hero?.textContent).toContain('ק״ג');
    expect(root.querySelector('.hero-eq')?.textContent).toContain('מכוניות'); // 2,284 kg > one car
    expect(root.querySelector('.stats-hero .gc-note')?.textContent).toContain('עוד');
    expect(root.querySelectorAll('.eq-list .eq')).toHaveLength(7);
    expect(root.querySelectorAll('.eq-list .eq.on')).toHaveLength(3); // gorilla, cow, car
  });

  it('formats numbers the way the screen promises', () => {
    expect(fmtInt(1234.6)).toBe('1,235');
    expect(fmtNum(12.34)).toBe('12.3');
    expect(fmtNum(12345.6)).toBe('12,346');
    expect(fmtDuration(45)).toBe('45 שניות');
    expect(fmtDuration(600)).toBe('10 דקות');
    expect(fmtDuration(3600)).toBe('שעה אחת');
    expect(fmtDuration(3600 * 3 + 720)).toBe('3 שעות ו‑12 דקות');
  });

  it('counts only the sets that were checked', () => {
    const half: Record<string, Session> = {
      '2025-03-03': { day: 'A', ex: { a1: [set('50', '10'), set('50', '10', false)] } },
    };
    expect(render(half, [], TODAY).querySelector('.hero-num')?.textContent).toContain('500');
  });

  it('never lets a 🛠 dev grant touch it', () => {
    const dev: AppEvent[] = [
      { id: 'd1', ts: 1, type: 'xp_gained', payload: { date: TODAY, source: 'dev', total: 5000, parts: {}, dev: true, key: 'dev|1' } },
      { id: 'd2', ts: 2, type: 'coins_granted', payload: { date: TODAY, amount: 9999, key: 'dev|2', source: 'dev', dev: true } },
    ];
    const root = render(SESSIONS, dev, TODAY);
    expect(root.querySelector('.hero-num')?.textContent).toContain('2,284');
    const game = [...root.querySelectorAll('.stat')].map((s) => s.textContent ?? '');
    expect(game.find((t) => t.includes('מטבעות שנצברו'))).toContain('0');
  });
});

/* ------------------------------------------------------- the sparkline */

describe('the weekly sparkline', () => {
  it('draws one area, one line, one live end marker and a point per week', () => {
    const root = render(SESSIONS, [], TODAY);
    const svg = root.querySelector('svg.spark');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 320 96');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.querySelectorAll('path.sp-area')).toHaveLength(1);
    expect(svg?.querySelectorAll('path.sp-line')).toHaveLength(1);
    expect(svg?.querySelectorAll('circle.sp-dot')).toHaveLength(1);
    expect(svg?.querySelectorAll('circle.sp-hit')).toHaveLength(12);
    expect(svg?.querySelector('circle.sp-hit title')?.textContent).toContain('סטים');
  });

  it('runs oldest → newest from RIGHT to LEFT, with the live week at the left edge', () => {
    const root = render(SESSIONS, [], TODAY);
    const hits = [...(root.querySelectorAll<SVGCircleElement>('svg.spark circle.sp-hit') ?? [])];
    const xs = hits.map((c) => Number(c.getAttribute('cx')));
    expect(xs[0]).toBeGreaterThan(xs[xs.length - 1] ?? 0); // the oldest week sits further right
    const dot = root.querySelector('svg.spark circle.sp-dot');
    expect(Number(dot?.getAttribute('cx'))).toBe(xs[xs.length - 1]);
    // and the last point IS this week
    expect(hits[hits.length - 1]?.querySelector('title')?.textContent).toContain(fmtDate('2025-03-02'));
  });

  it('captions the live week, the peak and the low without drawing an axis', () => {
    const root = render(SESSIONS, [], TODAY);
    const legend = root.querySelector('.chart-legend')?.textContent ?? '';
    expect(legend).toContain('השבוע (חי)');
    expect(legend).toContain('שיא');
    expect(legend).toContain('נמוך');
    expect(root.querySelectorAll('svg.spark text')).toHaveLength(0);
  });

  it('survives a log with no tonnage at all — a flat line, not a crash', () => {
    const bodyweight: Record<string, Session> = {
      '2025-03-03': { day: 'A', ex: { b5: [set('', '60')] } },
    };
    const svg = render(bodyweight, [], TODAY).querySelector('svg.spark');
    expect(svg?.querySelector('path.sp-line')?.getAttribute('d')).toMatch(/^M[\d., L]+$/);
  });
});

/* --------------------------------------------------------- the heatmap */

describe('the calendar heatmap', () => {
  it('draws 16 weeks × 7 days as bordless cells with a title each', () => {
    const root = render(SESSIONS, [], TODAY);
    const svg = root.querySelector('svg.heat');
    expect(svg).not.toBeNull();
    const cells = [...(svg?.querySelectorAll('rect.hm-cell') ?? [])];
    expect(cells).toHaveLength(16 * 7);
    expect(cells.every((c) => c.querySelector('title') !== null)).toBe(true);
    expect(svg?.querySelectorAll('text.hm-day')).toHaveLength(7);
  });

  it('puts THIS week in the leftmost column and the oldest week on the right', () => {
    const root = render(SESSIONS, [], TODAY);
    const cells = [...(root.querySelectorAll<SVGRectElement>('svg.heat rect.hm-cell') ?? [])];
    const first = cells.slice(0, 7);
    expect(first.every((c) => c.getAttribute('x') === '0')).toBe(true);
    // Column 0, row 0 = the Sunday that opens the current week.
    expect(first[0]?.querySelector('title')?.textContent).toContain(fmtDate('2025-03-02'));
    // ...and the last column is the oldest week, at the largest x.
    const last = cells[cells.length - 1];
    expect(Number(last?.getAttribute('x'))).toBe(15 * 16);
    expect(last?.querySelector('title')?.textContent).toContain(fmtDate(addDays('2025-03-02', -15 * 7 + 6)));
  });

  it('paints intensity with one hue and marks the days that have not happened yet', () => {
    const root = render(SESSIONS, [], TODAY);
    const cells = [...(root.querySelectorAll<SVGRectElement>('svg.heat rect.hm-cell') ?? [])];
    const byDate = new Map(cells.map((c) => [c.querySelector('title')?.textContent ?? '', c]));
    const trained = [...byDate.entries()].find(([t]) => t.startsWith(fmtDate('2025-03-03')))?.[1];
    // six completed sets that day -> the second of the five intensity steps
    expect(trained?.getAttribute('class')).toContain('l2');
    const future = [...byDate.entries()].find(([t]) => t.includes('עוד לא היה'));
    expect(future?.[1].getAttribute('class')).toContain('future');
    // Five steps, one hue: no cell ever carries more than one level class.
    expect(cells.every((c) => (c.getAttribute('class') ?? '').match(/\bl\d/g)?.length === 1)).toBe(true);
  });

  it('labels the weekdays א–ש on the reading side of the grid', () => {
    const root = render(SESSIONS, [], TODAY);
    const labels = [...(root.querySelectorAll('svg.heat text.hm-day') ?? [])];
    expect(labels.map((l) => l.textContent)).toEqual(['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']);
    const gridRight = 16 * 16 - 3;
    expect(Number(labels[0]?.getAttribute('x'))).toBeGreaterThanOrEqual(gridRight);
  });
});

/* --------------------------------------------------- the other cards */

describe('the remaining cards', () => {
  it('draws six body-part bars and names the strongest and the weakest', () => {
    const root = render(SESSIONS, [], TODAY);
    const rows = [...root.querySelectorAll('.bal-row')];
    expect(rows).toHaveLength(6);
    expect(root.querySelector('.bal-tag.most')).not.toBeNull();
    expect(root.querySelector('.bal-tag.least')).not.toBeNull();
    const widths = [...root.querySelectorAll<HTMLElement>('.bal-row .part-bar span')].map((s) => s.style.width);
    expect(widths.some((w) => w === '100%')).toBe(true);
  });

  it('lists the per-exercise bests with a growth percentage', () => {
    const root = render(SESSIONS, [], TODAY);
    const rows = [...root.querySelectorAll('.stats-table tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.textContent).toContain('לחיצת חזה בשיפוע חיובי');
    expect(rows[0]?.textContent).toContain('צמיחה: +25%'); // 400 → 500
  });

  it('shows the game card with the energy conversion', () => {
    const events: AppEvent[] = [
      { id: 'g1', ts: 1, type: 'wave_cleared', payload: { date: TODAY, world: 1, wave: 1, coins: 5 } },
      { id: 'g2', ts: 2, type: 'energy_gained', payload: { date: TODAY, amount: 500, source: 'set', key: 'k' } },
    ];
    const text = render(SESSIONS, events, TODAY).textContent ?? '';
    expect(text).toContain('מספיק להטעין טלפון');
    expect(text).toContain('2'); // 500 ⚡ / 250 = 2 charges
  });

  it('shows the oddballs, including the heaviest set ever and the longest gap', () => {
    const text = render(SESSIONS, [], TODAY).textContent ?? '';
    expect(text).toContain('הסט הכבד ביותר אי פעם');
    expect(text).toContain('60 ק״ג × 5');
    expect(text).toContain('ההפסקה הארוכה ששרדתם');
    expect(text).toContain('12 ימים'); // 2025-02-19 → 2025-03-03
    expect(text).toContain('מתחת לטיימר המנוחה');
  });
});

/* ------------------------------------------------------- empty state */

describe('the empty state', () => {
  it('says something friendly and draws no charts at all', () => {
    const root = render({}, [], TODAY);
    expect(root.querySelector('.stats-empty')).not.toBeNull();
    expect(root.textContent).toContain('עוד אין מה לספור');
    expect(root.querySelector('svg.spark')).toBeNull();
    expect(root.querySelector('svg.heat')).toBeNull();
    expect(root.querySelector('.stats-table')).toBeNull();
  });

  it('still shows the game card, because the arena may have a story of its own', () => {
    const events: AppEvent[] = [
      { id: 'g1', ts: 1, type: 'wave_cleared', payload: { date: TODAY, world: 1, wave: 1, coins: 5 } },
    ];
    const root = render({}, events, TODAY);
    expect(root.textContent).toContain('שכבת המשחק');
  });

  it('handles a session that holds nothing but empty rows', () => {
    const blank: Record<string, Session> = {
      '2025-03-03': { day: 'A', ex: { a1: [null, { w: '', r: '', done: false }] } },
    };
    const root = render(blank, [], TODAY);
    expect(root.querySelector('.stats-empty')).not.toBeNull();
  });

  it('never breaks on a week boundary — a set logged on the last day of the window', () => {
    const edge: Record<string, Session> = {
      [weekStartISO(TODAY)]: { day: 'A', ex: { a1: [set('20', '10')] } },
    };
    const root = render(edge, [], TODAY);
    expect(root.querySelector('.hero-num')?.textContent).toContain('200');
    expect(root.querySelectorAll('svg.heat rect.hm-cell')).toHaveLength(112);
  });
});
