/**
 * @vitest-environment jsdom
 *
 * Smoke test for the ported UI: mounts the real screens into the real
 * index.html shell and checks that the 1:1 port renders, logs and persists.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { PROGRAM, isBuiltInDayKey, type BuiltInDayKey } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { savePlan } from '../src/core/plan.ts';
import { presetById } from '../src/data/presets.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';
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
  // jsdom logs "Not implemented" for scrollTo — stub it to keep output clean.
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

function mount(store: LocalStore = new LocalStore(fakeStorage())): { store: LocalStore; render: () => void } {
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
  const app = createApp(store, timer);
  app.render();
  return { store, render: app.render };
}

/** The day tab the app booted on — always one of the built-in three here. */
function currentDay(store: LocalStore): BuiltInDayKey {
  const view = store.getState().ui.view;
  if (!isBuiltInDayKey(view)) throw new Error(`unexpected default view: ${view}`);
  return view;
}

describe('workout screen', () => {
  it('renders the 6 tabs (3 days + דמות + קרב + היסטוריה) and the day exercise cards', () => {
    const { store } = mount();
    expect(document.querySelectorAll('#tabs .tab')).toHaveLength(6);
    const view = currentDay(store);
    expect(document.querySelectorAll('#main .ex-card')).toHaveLength(PROGRAM[view].exercises.length);
    expect(document.querySelector('.ex-title')?.textContent).toBe(PROGRAM[view].exercises[0]?.he);
    // steps, cue and mistake blocks all ported
    expect(document.querySelectorAll('#main .form-panel ol li').length).toBeGreaterThan(0);
    expect(document.querySelector('#main .cue')).not.toBeNull();
    expect(document.querySelector('#main .mistake')).not.toBeNull();
    expect(document.querySelector('#header .app-title')?.textContent).toContain(PROGRAM[view].label);
  });

  it('logs a weight, checks a set, starts the rest timer and records events', () => {
    const { store } = mount();
    const view = currentDay(store);
    const ex = PROGRAM[view].exercises[0];
    if (!ex) throw new Error('no exercise');

    const input = document.querySelector<HTMLInputElement>(`.inp[data-ex="${ex.id}"][data-set="0"][data-f="w"]`);
    expect(input).not.toBeNull();
    input!.value = '42.5';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const chk = document.querySelector<HTMLButtonElement>(`.chk[data-ex="${ex.id}"][data-set="0"]`);
    chk!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const date = Object.keys(store.getState().sessions)[0];
    expect(store.getState().sessions[date!]?.ex[ex.id]?.[0]).toEqual({ w: '42.5', r: '', done: true });
    expect(chk!.classList.contains('on')).toBe(true);
    expect(document.getElementById('timerBar')?.classList.contains('show')).toBe(true);
    expect(document.getElementById('tTime')?.textContent).toBe('1:30');
    expect(document.getElementById('tTitle')?.textContent).toContain(ex.he);

    const types = store.getEvents().map((e) => e.type);
    expect(types).toContain('set_logged');
    expect(types).toContain('set_completed');
  });

  it('marks a card done-all once every set is checked', () => {
    const { store } = mount();
    const view = currentDay(store);
    const ex = PROGRAM[view].exercises[0];
    if (!ex) throw new Error('no exercise');
    for (let i = 0; i < ex.sets; i++) {
      document
        .querySelector<HTMLButtonElement>(`.chk[data-ex="${ex.id}"][data-set="${i}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    expect(document.getElementById(`card-${ex.id}`)?.classList.contains('done-all')).toBe(true);
  });

  it('shows the previous performance hint from an earlier session', () => {
    const store = new LocalStore(fakeStorage());
    const view = currentDay(store);
    const ex = PROGRAM[view].exercises[0];
    if (!ex) throw new Error('no exercise');
    store.update((d) => {
      d.sessions['2020-01-01'] = { day: view, ex: { [ex.id]: [{ w: '60', r: '9', done: true }] } };
    });
    mount(store);
    const prev = document.querySelector('#main .prev')?.textContent ?? '';
    expect(prev).toContain('אימון קודם');
    expect(prev).toContain('60');
    expect(prev).toContain('9');
  });

  it('toggles the collapsible form panel and remembers it in the store', () => {
    const { store } = mount();
    const view = currentDay(store);
    const ex = PROGRAM[view].exercises[0];
    if (!ex) throw new Error('no exercise');
    const toggle = document.querySelector<HTMLButtonElement>(`.form-toggle[data-toggle="${ex.id}"]`);
    toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.open[ex.id]).toBe(true);
    expect(document.getElementById(`card-${ex.id}`)?.classList.contains('open')).toBe(true);
  });
});

/* ---------------------------------------------------------- schedule tabs */

/**
 * A plan whose days are trained on several weekdays shows one tab per TRAINING
 * DAY OF THE WEEK, so the bar reads like the written schedule: ראשון(א),
 * שלישי(ב), רביעי(א), חמישי(ב). Two tabs of the same workout are still ONE
 * workout: the occurrence lives only in the view id, and is stripped before
 * anything reaches a session or an event.
 */
describe('schedule-expanded day tabs', () => {
  /** The app with the A/B preset saved, and the day keys the preset minted. */
  function mountAb(): { store: LocalStore; alef: string; bet: string } {
    const store = new LocalStore(fakeStorage());
    const preset = presetById('ab4');
    if (!preset) throw new Error('no ab4 preset');
    const res = savePlan(store, preset.build());
    if (!res.ok) throw new Error(res.errors.join(', '));
    const days = store.getState().plan?.days ?? [];
    const alef = days[0]?.key;
    const bet = days[1]?.key;
    if (!alef || !bet) throw new Error('preset lost a day');
    mount(store);
    return { store, alef, bet };
  }

  function tabs(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('#tabs .tab')];
  }

  function clickTab(viewId: string): void {
    const el = document.querySelector<HTMLElement>(`#tabs .tab[data-view="${viewId}"]`);
    if (!el) throw new Error(`no tab ${viewId}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  function cardIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>('#main .ex-card')].map((c) => c.id);
  }

  it('renders four workout tabs for the two-day A/B plan, in weekday order', () => {
    const { alef, bet } = mountAb();
    expect(tabs()).toHaveLength(7); // 4 workout occurrences + דמות + קרב + היסטוריה
    expect(tabs().slice(0, 4).map((t) => t.dataset['view'])).toEqual([
      `${alef}@0`,
      `${bet}@2`,
      `${alef}@3`,
      `${bet}@4`,
    ]);
    expect(tabs().slice(0, 4).map((t) => t.querySelector('.d')?.textContent)).toEqual([
      'ראשון',
      'שלישי',
      'רביעי',
      'חמישי',
    ]);
    // the workout's own name is the small line, so a tab reads "רביעי / חלק א׳"
    expect(tabs()[2]?.querySelector('.w')?.textContent).toContain('חלק א׳');
    // seven tabs no longer fit a phone row: the bar scrolls instead of squeezing
    expect(document.getElementById('tabs')?.classList.contains('scroll')).toBe(true);
  });

  it('keeps the six-tab bar of the built-in program unscrolled', () => {
    mount();
    expect(tabs()).toHaveLength(6);
    expect(document.getElementById('tabs')?.classList.contains('scroll')).toBe(false);
  });

  it('shows the right workout per tab, with ONLY the tapped tab active', () => {
    const { store, alef, bet } = mountAb();
    const active = (): (string | undefined)[] =>
      tabs().filter((t) => t.classList.contains('active')).map((t) => t.dataset['view']);

    clickTab(`${alef}@3`);
    expect(store.getState().ui.view).toBe(`${alef}@3`);
    expect(cardIds()).toContain('card-x1'); // סקוואט — חלק א׳
    expect(cardIds()).not.toContain('card-b2');
    expect(document.querySelector('#header .app-title')?.textContent).toContain('יום רביעי · חלק א׳');
    // the sibling occurrence of the SAME workout must not light up too
    expect(active()).toEqual([`${alef}@3`]);

    clickTab(`${alef}@0`);
    expect(active()).toEqual([`${alef}@0`]);
    expect(document.querySelector('#header .app-title')?.textContent).toContain('יום ראשון · חלק א׳');
    expect(cardIds()).toContain('card-x1');

    clickTab(`${bet}@4`);
    expect(active()).toEqual([`${bet}@4`]);
    expect(document.querySelector('#header .app-title')?.textContent).toContain('יום חמישי · חלק ב׳');
    expect(cardIds()).toContain('card-b2'); // פולי עליון — חלק ב׳
    expect(cardIds()).not.toContain('card-x1');
  });

  it('logs from an occurrence tab under the BARE day key, into one session', () => {
    const { store, alef } = mountAb();
    clickTab(`${alef}@3`); // the רביעי occurrence of חלק א׳
    document
      .querySelector<HTMLButtonElement>('#main .chk[data-ex="x1"][data-set="0"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const date = Object.keys(store.getState().sessions)[0] ?? '';
    // no `@` anywhere below the UI: the session, the event and the XP grant all
    // carry the plain day key, exactly as the base tab would have written them
    expect(store.getState().sessions[date]?.day).toBe(alef);
    const logged = store.getEvents().filter((e) => e.payload['day'] !== undefined);
    expect(logged.length).toBeGreaterThan(0);
    for (const e of logged) expect(e.payload['day']).toBe(alef);
    expect(JSON.stringify(store.getState().sessions)).not.toContain('@');

    // …and the ראשון tab of the same workout shows that very set
    clickTab(`${alef}@0`);
    expect(document.querySelector<HTMLButtonElement>('#main .chk[data-ex="x1"][data-set="0"]')?.classList.contains('on')).toBe(true);
  });

  it('lands back on a valid occurrence tab when the editor is closed', () => {
    const { store, alef } = mountAb();
    clickTab(`${alef}@3`);
    document.getElementById('btnEditPlan')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe('PL');
    document.getElementById('btnPlanBack')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe(`${alef}@3`);
    expect(tabs().filter((t) => t.classList.contains('active'))).toHaveLength(1);
    expect(cardIds()).toContain('card-x1');
  });

  it('canonicalises a view stored before schedule tabs existed', () => {
    // An install that was left on `d_alef` (the shape every version until now
    // wrote) must still highlight exactly one tab — today's occurrence of it.
    const store = new LocalStore(fakeStorage());
    const preset = presetById('ab4');
    if (!preset) throw new Error('no ab4 preset');
    const res = savePlan(store, preset.build());
    if (!res.ok) throw new Error(res.errors.join(', '));
    const alef = store.getState().plan?.days[0]?.key ?? '';
    store.update((d) => {
      d.ui.view = alef;
    });
    mount(store);
    const active = tabs().filter((t) => t.classList.contains('active'));
    expect(active).toHaveLength(1);
    expect(active[0]?.dataset['view']?.startsWith(alef)).toBe(true);
    expect(cardIds()).toContain('card-x1');
  });
});

describe('history screen', () => {
  it('shows the empty state, then a logged day after data exists', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.ui.view = 'H';
    });
    render();
    expect(document.querySelector('#main .empty')).not.toBeNull();
    expect(document.getElementById('btnExport')).not.toBeNull();
    expect(document.getElementById('btnImport')).not.toBeNull();
    expect(document.getElementById('btnClear')).not.toBeNull();

    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    });
    render();
    expect(document.querySelector('#main .hist-day h3')?.textContent).toContain('05.01.2025');
    expect(document.querySelector('#main .hist-sets')?.textContent).toContain('40kg×10✓');
  });
});
