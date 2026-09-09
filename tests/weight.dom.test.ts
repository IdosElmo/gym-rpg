/**
 * @vitest-environment jsdom
 *
 * The ⚖️ משקל screen in the real shell: the second inner tab of the 🍽️ hub,
 * logging, deleting, the goal, the chart — and the pure HTML of the chart
 * itself (entries on x, oldest on the RIGHT; kg on y, never from zero).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyNutritionEvent, emptyNutrition } from '../src/core/nutrition.ts';
import { logWeight, movingAverage, weightEntries } from '../src/core/weight.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { chartRange, fmtDelta, renderWeight, resetWeightScreen, weightChartSvg, weightHeadline } from '../src/ui/weight.ts';
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
  resetWeightScreen();
});

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
  const app = createApp(store, timer, {});
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

function openWeight(): void {
  click('#tabs .hub[data-hub="NU"]');
  click('#tabs .tab[data-view="WT"]');
}

function weigh(store: LocalStore, date: string, kg: number, id = `w-${date}-${kg}`): void {
  logWeight(store, { date, time: '07:00', kg, note: '' }, id);
}

describe('the ⚖️ משקל screen', () => {
  it('is the second inner tab of the 🍽️ hub, with its own header line and an empty state', () => {
    const { store } = mount();
    openWeight();
    expect(store.getState().ui.view).toBe('WT');
    expect(document.querySelector('#header .app-title')?.textContent).toContain('משקל');
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('עוד לא נרשמה שקילה');
    expect(document.querySelector('#main .empty')).not.toBeNull();
    // no chart, no history without a single entry — but the form and the goal card are there
    expect(document.querySelector('.wt-chart')).toBeNull();
    expect(document.querySelector('.wt-list')).toBeNull();
    expect(document.querySelector('#wtAdd')).not.toBeNull();
    expect(document.querySelector('#wtTgtSave')).not.toBeNull();
    // the date field defaults to today and refuses the future
    const date = document.querySelector<HTMLInputElement>('#wtDate');
    expect(date?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date?.max).toBe(date?.value);
  });

  it('logs a weigh-in: exactly one weight_logged, the header, summary and chart update', () => {
    const { store } = mount();
    openWeight();
    type('#wtKg', '82,4'); // a decimal comma reads as a decimal point
    type('#wtNote', 'בבוקר');
    click('#wtAdd');

    const events = store.getEvents().filter((e) => e.type === 'weight_logged');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload['kg']).toBe(82.4);
    expect(events[0]?.payload['note']).toBe('בבוקר');
    // today's weigh-in is stamped with the current time
    expect(events[0]?.payload['time']).toMatch(/^\d{2}:\d{2}$/);
    expect(document.querySelector('#header .day-meta')?.textContent).toContain('82.4');
    expect(document.querySelector('.wt-current b')?.textContent).toBe('82.4');
    expect(document.querySelector('.wt-chart')).not.toBeNull();
    expect(document.querySelectorAll('.wt-list .wt-row')).toHaveLength(1);
    // the form was re-rendered clean for the next weigh-in
    expect(document.querySelector<HTMLInputElement>('#wtKg')?.value).toBe('');
  });

  it('refuses a weight outside the human range, or a future date, and appends nothing', () => {
    const { store } = mount();
    openWeight();
    type('#wtKg', '8');
    click('#wtAdd');
    expect(document.querySelector('#wtAddMsg')?.textContent).toContain('בין 20 ל־400');
    type('#wtKg', 'abc');
    click('#wtAdd');
    expect(document.querySelector('#wtAddMsg')?.textContent).toContain('בין 20 ל־400');
    type('#wtKg', '82');
    type('#wtDate', '2999-01-01');
    click('#wtAdd');
    expect(document.querySelector('#wtAddMsg')?.textContent).toContain('בעתיד');
    expect(store.getEvents().filter((e) => e.type === 'weight_logged')).toHaveLength(0);
  });

  it('a past weigh-in keeps an empty time unless one was typed', () => {
    const { store } = mount();
    openWeight();
    type('#wtKg', '83');
    type('#wtDate', '2026-01-05');
    click('#wtAdd');
    type('#wtKg', '83.5');
    type('#wtDate', '2026-01-06');
    type('#wtTime', '21:15');
    click('#wtAdd');
    const [a, b] = store.getEvents().filter((e) => e.type === 'weight_logged');
    expect(a?.payload['time']).toBe('');
    expect(b?.payload['time']).toBe('21:15');
  });

  it('deletes an entry through its 🗑 (tombstone event, point gone from the chart)', () => {
    const { store } = mount();
    weigh(store, '2026-01-01', 84);
    weigh(store, '2026-01-02', 83.5);
    openWeight();
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(2);
    click('.wt-list [data-del]'); // newest first: deletes the 83.5
    expect(store.getEvents().filter((e) => e.type === 'weight_deleted')).toHaveLength(1);
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(1);
    expect(document.querySelector('.wt-current b')?.textContent).toBe('84.0');
  });

  it('saves, draws and clears the goal weight', () => {
    const { store } = mount();
    weigh(store, '2026-01-01', 84);
    weigh(store, '2026-01-02', 83.5);
    openWeight();
    type('#wtTgt', '83');
    click('#wtTgtSave');
    expect(store.getState().nutrition.weightTarget).toBe(83);
    // 83 sits inside the plotted range (83.5 ± air) — the line is drawn
    expect(document.querySelector('.wt-chart .wt-goal')).not.toBeNull();
    expect(document.querySelector('.wt-goal-note')?.textContent).toContain('עוד 0.5');

    type('#wtTgt', '60');
    click('#wtTgtSave');
    // far below the range: no line, and the legend says so
    expect(document.querySelector('.wt-chart .wt-goal')).toBeNull();
    expect(document.querySelector('.chart-legend')?.textContent).toContain('מחוץ לטווח');

    type('#wtTgt', '');
    click('#wtTgtSave');
    expect(store.getState().nutrition.weightTarget).toBeNull();
    expect(document.querySelector('.wt-goal-note')).toBeNull();

    type('#wtTgt', '5');
    click('#wtTgtSave');
    expect(document.querySelector('#wtTgtMsg')?.textContent).toContain('בין 20 ל־400');
  });

  it('celebrates a reached goal', () => {
    const { store } = mount();
    weigh(store, '2026-01-01', 84);
    weigh(store, '2026-01-20', 79.9);
    openWeight();
    type('#wtTgt', '80');
    click('#wtTgtSave');
    expect(document.querySelector('.wt-goal-note.ok')?.textContent).toContain('היעד הושג');
  });

  it('ranges the chart to the last 10 / 30 / all entries', () => {
    const { store } = mount();
    for (let i = 1; i <= 40; i += 1) {
      const date = i <= 31 ? `2026-03-${String(i).padStart(2, '0')}` : `2026-04-${String(i - 31).padStart(2, '0')}`;
      weigh(store, date, 80 + (i % 5) / 10, `w${i}`);
    }
    openWeight();
    // 30 is the default
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(30);
    expect(document.querySelector('.wt-seg[data-range="30"]')?.getAttribute('aria-pressed')).toBe('true');
    click('.wt-seg[data-range="10"]');
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(10);
    click('.wt-seg[data-range="all"]');
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(40);
    expect(document.querySelector('.wt-seg[data-range="all"]')?.getAttribute('aria-pressed')).toBe('true');
    // the range survives a re-render (it is screen state, like the meal day)
    click('.wt-list [data-del]');
    expect(document.querySelectorAll('.wt-chart .wt-hit')).toHaveLength(39);
  });

  it('renders standalone with an injected today', () => {
    const store = new LocalStore(fakeStorage());
    const main = document.createElement('main');
    renderWeight(main, { store, today: '2026-02-02' });
    expect(main.querySelector<HTMLInputElement>('#wtDate')?.value).toBe('2026-02-02');
    const kg = main.querySelector<HTMLInputElement>('#wtKg');
    if (kg) kg.value = '70';
    main.querySelector<HTMLElement>('#wtAdd')?.dispatchEvent(new MouseEvent('click'));
    expect(weightEntries(store.getState().nutrition).map((r) => r.date)).toEqual(['2026-02-02']);
  });
});

describe('the chart, as pure HTML', () => {
  function rows(kgs: readonly number[]): ReturnType<typeof weightEntries> {
    const n = emptyNutrition();
    kgs.forEach((kg, i) =>
      applyNutritionEvent(n, 'weight_logged', { id: `w${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, time: '', kg, note: '' }),
    );
    return weightEntries(n);
  }

  it('puts the OLDEST entry at the right edge and the newest at the left', () => {
    const svg = weightChartSvg(rows([84, 83, 82]), movingAverage(rows([84, 83, 82])), null);
    const xs = [...svg.matchAll(/<circle class="wt-hit" cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeGreaterThan(xs[2] ?? 0);
    // the newest entry carries the ringed end marker
    const dot = /<circle class="wt-dot" cx="([\d.]+)"/.exec(svg);
    expect(Number(dot?.[1])).toBe(xs[2]);
    // every point names its date and weight for the tooltip
    expect(svg).toContain('01.01.2026 · 84.0 ק״ג');
  });

  it('scales y to the entries own range with air, never from zero', () => {
    // a 2 kg span gets the half-kilo minimum of air; a 10 kg span gets 15% of itself
    expect(chartRange(rows([82, 83, 84]))).toEqual({ lo: 81.5, hi: 84.5 });
    expect(chartRange(rows([80, 90]))).toEqual({ lo: 78.5, hi: 91.5 });
    // a NEAR goal stretches the range so its line is on the chart…
    expect(chartRange(rows([82, 83, 84]), 80)).toEqual({ lo: 79.4, hi: 84.6 });
    expect(chartRange(rows([82, 83, 84]), 87)).toEqual({ lo: 81.3, hi: 87.8 });
    // …a FAR one (beyond 3 kg and beyond the data's own span) does not
    expect(chartRange(rows([82, 83, 84]), 70)).toEqual({ lo: 81.5, hi: 84.5 });
    expect(chartRange(rows([80, 90]), 65)).toEqual({ lo: 78.5, hi: 91.5 });
    // on a wide span the reach IS the span: 8 kg away from a 10 kg span is still drawn
    expect(chartRange(rows([80, 90]), 72)).toEqual({ lo: 69.3, hi: 92.7 });
    // a flat log still gets half a kilo of air each way
    expect(chartRange(rows([80, 80]))).toEqual({ lo: 79.5, hi: 80.5 });
    expect(chartRange([])).toEqual({ lo: 0, hi: 1 });
    const svg = weightChartSvg(rows([82, 83, 84]), [], null);
    // lighter is LOWER on the page (bigger y)
    const ys = [...svg.matchAll(/<circle class="wt-hit" cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[2] ?? 0);
    // the three gridline labels are the range's top, middle and bottom
    expect(svg).toContain('>84.5<');
    expect(svg).toContain('>83.0<');
    expect(svg).toContain('>81.5<');
  });

  it('draws the trend only from three entries and the goal only inside the range', () => {
    const two = rows([82, 83]);
    expect(weightChartSvg(two, movingAverage(two), null)).not.toContain('wt-trend');
    const three = rows([82, 83, 84]);
    expect(weightChartSvg(three, movingAverage(three), null)).toContain('wt-trend');
    expect(weightChartSvg(three, movingAverage(three), 83)).toContain('wt-goal');
    expect(weightChartSvg(three, movingAverage(three), 80)).toContain('wt-goal');
    expect(weightChartSvg(three, movingAverage(three), 70)).not.toContain('wt-goal');
    // one entry: a point, no line, no area
    const one = weightChartSvg(rows([82]), [82], null);
    expect(one).toContain('wt-hit');
    expect(one).not.toContain('wt-line');
    expect(one).not.toContain('wt-area');
    expect(weightChartSvg([], [], null)).toBe('');
  });

  it('formats deltas as one LTR run with a real minus sign', () => {
    expect(fmtDelta(0.4)).toContain('>+0.4<');
    expect(fmtDelta(-0.6)).toContain('>−0.6<');
    expect(fmtDelta(0)).toContain('>±0.0<');
    expect(fmtDelta(-0.6)).toContain('dir="ltr"');
  });

  it('the header line names the latest weight and the change since the one before', () => {
    const n = emptyNutrition();
    expect(weightHeadline(n)).toContain('עוד לא נרשמה שקילה');
    applyNutritionEvent(n, 'weight_logged', { id: 'a', date: '2026-01-01', time: '', kg: 84, note: '' });
    expect(weightHeadline(n)).toBe('אחרון: 84.0 ק״ג');
    applyNutritionEvent(n, 'weight_logged', { id: 'b', date: '2026-01-02', time: '', kg: 83.4, note: '' });
    expect(weightHeadline(n)).toContain('83.4 ק״ג');
    expect(weightHeadline(n)).toContain('−0.6');
  });
});
