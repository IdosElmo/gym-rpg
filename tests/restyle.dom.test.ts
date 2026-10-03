/**
 * @vitest-environment jsdom
 *
 * The restyled workout day and meal-tracker summary: the hooks the new markup
 * adds and keeps in step WITHOUT a re-render — the day's progress strip, the
 * "you are here" set badge, the demo thumbnail that opens the drawer — and the
 * day's calorie ring + macro bars with the +10%/+20% fold.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROGRAM } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { heroRingHtml, macroRowHtml, resetNutritionScreen } from '../src/ui/nutrition.ts';
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

function mount(): LocalStore {
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
  createApp(store, timer).render();
  return store;
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

const DAY = PROGRAM.A.exercises;
const first = DAY[0]!;

const segs = (): string[] =>
  [...document.querySelectorAll('#main .wk-strip .wk-seg')].map((s) =>
    s.classList.contains('done') ? 'done' : s.classList.contains('cur') ? 'cur' : '',
  );
const currentRows = (exId: string): number[] =>
  [...document.querySelectorAll(`#card-${exId} .log-row:not(.head)`)]
    .map((r, i) => (r.classList.contains('current') ? i : -1))
    .filter((i) => i >= 0);

describe('the workout day', () => {
  it('draws one strip segment per exercise and moves it as sets are ticked', () => {
    mount();
    click('#tabs .tab[data-view^="A"]');
    expect(segs()).toEqual(DAY.map((_, i) => (i === 0 ? 'cur' : '')));
    expect(currentRows(first.id)).toEqual([0]);

    for (let i = 0; i < first.sets; i += 1) {
      type(`.inp[data-ex="${first.id}"][data-set="${i}"][data-f="w"]`, '50');
      type(`.inp[data-ex="${first.id}"][data-set="${i}"][data-f="r"]`, '8');
      click(`.chk[data-ex="${first.id}"][data-set="${i}"]`);
      // the badge walks to the next set still to do (none once all are ✓'d)
      expect(currentRows(first.id)).toEqual(i + 1 < first.sets ? [i + 1] : []);
    }
    expect(segs().slice(0, 2)).toEqual(['done', 'cur']);
    expect(document.querySelector('#main .wk-strip')?.getAttribute('aria-label')).toContain(`1 מתוך ${DAY.length}`);

    // un-ticking brings the exercise back to "current"
    click(`.chk[data-ex="${first.id}"][data-set="0"]`);
    expect(segs()[0]).toBe('cur');
    expect(currentRows(first.id)).toEqual([0]);
  });

  it('keeps "last time" under the inputs and puts the rest on the target line', () => {
    mount();
    click('#tabs .tab[data-view^="A"]');
    const card = document.getElementById(`card-${first.id}`);
    expect(card?.querySelector('.ex-target .badge.scheme')).not.toBeNull();
    expect(card?.querySelector('.ex-target .ex-rest')?.textContent).toContain('מנוחה');
    // every input still sits in its own wrap with its .prev slot beside it
    expect(card?.querySelectorAll('.log-row:not(.head) .inp-wrap > .prev')).toHaveLength(first.sets * 2);
  });

  it('the demo thumbnail opens and closes the "how to do it" drawer', () => {
    const store = mount();
    click('#tabs .tab[data-view^="A"]');
    const thumb = document.querySelector<HTMLButtonElement>(`#card-${first.id} .ex-thumb`);
    expect(thumb?.querySelector('svg.cd-svg')).not.toBeNull();
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(0);
    click(`#card-${first.id} .ex-thumb`);
    expect(document.getElementById(`card-${first.id}`)?.classList.contains('open')).toBe(true);
    expect(store.getState().ui.open[first.id]).toBe(true);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(1);
    click(`#card-${first.id} .ex-thumb`);
    expect(document.getElementById(`card-${first.id}`)?.classList.contains('open')).toBe(false);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(0);
  });
});

describe('the day summary', () => {
  it('says what is left in the ring, over by how much, or what was eaten without a target', () => {
    const left = document.createElement('div');
    left.innerHTML = heroRingHtml(1420, 2150);
    expect(left.querySelector('.nt-hero-num')?.textContent).toBe('730');
    expect(left.querySelector('.nt-hero-of')?.textContent).toBe('1420 / 2150');
    expect(left.querySelector('.nt-ring-pct')?.textContent).toBe('66%');

    const over = document.createElement('div');
    over.innerHTML = heroRingHtml(2400, 2150);
    expect(over.querySelector('.nt-ring')?.classList.contains('over')).toBe(true);
    expect(over.querySelector('.nt-hero-num')?.textContent).toBe('+250');

    const none = document.createElement('div');
    none.innerHTML = heroRingHtml(900, null);
    expect(none.querySelector('.nt-hero-num')?.textContent).toBe('900');
    expect(none.querySelector('.nt-ring-fill')).toBeNull();
    expect(none.querySelector('.nt-hero-of')?.textContent).toBe('ללא יעד');
  });

  it('draws a macro as a bar toward its target, capped at full', () => {
    const el = document.createElement('div');
    el.innerHTML = macroRowHtml({ key: 'protein', label: 'חלבון', value: 112, target: 150 });
    expect((el.querySelector('.nt-ring-fill') as HTMLElement | null)?.style.inlineSize).toBe('74.7%');
    expect(el.querySelector('.nt-ring-sub')?.textContent).toContain('נותרו 38');
    el.innerHTML = macroRowHtml({ key: 'protein', label: 'חלבון', value: 200, target: 150 });
    expect((el.querySelector('.nt-ring-fill') as HTMLElement | null)?.style.inlineSize).toBe('100%');
  });

  it('folds the +10%/+20% rings under a toggle that survives a re-render', () => {
    mount();
    click('#tabs .hub[data-hub="NU"]');
    const fold = (): HTMLDetailsElement | null => document.querySelector<HTMLDetailsElement>('#ntMargins');
    expect(fold()?.open).toBe(false);
    expect(fold()?.querySelectorAll('.nt-ring.margin')).toHaveLength(2);
    const d = fold();
    if (!d) throw new Error('no fold');
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
    // any re-render (here: saving targets) keeps it open
    type('#ntTgtCal', '2000');
    click('#ntTgtSave');
    expect(fold()?.open).toBe(true);
  });

  it('shows an empty meal as a dashed add card, a filled one as a card of its items', () => {
    mount();
    click('#tabs .hub[data-hub="NU"]');
    click('[data-mode="text"]');
    click('[data-slot="lunch"]');
    type('#ntName', 'שקשוקה');
    type('#ntCal', '430');
    type('#ntProt', '22');
    click('#ntAdd');
    const lunch = document.querySelector('[data-slot-sec="lunch"]');
    expect(lunch?.classList.contains('empty')).toBe(false);
    expect(lunch?.querySelector('.nt-meal-name')?.textContent).toBe('שקשוקה');
    const dinner = document.querySelector('[data-slot-sec="dinner"]');
    expect(dinner?.classList.contains('empty')).toBe(true);
    expect(dinner?.querySelector('button.nt-slot-addcard[data-slot-add="dinner"]')).not.toBeNull();
  });
});
