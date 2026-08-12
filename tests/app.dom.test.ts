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
import { defaultPlanDoc, makePlanDay, savePlan } from '../src/core/plan.ts';
import { HUBS, hubOf } from '../src/ui/nav.ts';
import { APP_VERSION } from '../src/ui/settings.ts';
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

/** The three main tabs, in order. */
function hubs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#tabs .hub-row .hub')];
}

/** The inner tabs of whichever hub is open. */
function innerTabs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#tabs .sub-row .tab')];
}

function clickHub(id: string): void {
  const el = document.querySelector<HTMLElement>(`#tabs .hub[data-hub="${id}"]`);
  if (!el) throw new Error(`no hub ${id}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clickView(viewId: string): void {
  const el = document.querySelector<HTMLElement>(`#tabs .tab[data-view="${viewId}"]`);
  if (!el) throw new Error(`no tab ${viewId}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Tap a date bubble on the היסטוריה screen and return the card it expanded.
 * The log is a bubble row now (`ui/history.ts`), so the day's details exist
 * only while its bubble is open — everything inside the card is unchanged.
 */
function openDay(date: string): HTMLElement {
  const b = document.querySelector<HTMLElement>(`#main .day-bubble[data-date="${date}"]`);
  if (!b) throw new Error(`no history bubble for ${date}`);
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const card = document.querySelector<HTMLElement>('#main .day-panel .hist-day');
  if (!card) throw new Error(`bubble ${date} opened no card`);
  return card;
}

describe('workout screen', () => {
  it('renders the 3 hubs + the 3 day tabs of the built-in plan, and the day exercise cards', () => {
    const { store } = mount();
    expect(hubs()).toHaveLength(3);
    expect(innerTabs()).toHaveLength(3);
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

  const tabs = innerTabs;
  const clickTab = clickView;

  function cardIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>('#main .ex-card')].map((c) => c.id);
  }

  it('renders four workout tabs for the two-day A/B plan, in weekday order', () => {
    const { alef, bet } = mountAb();
    // The four occurrences are the WHOLE inner row now: דמות/קרב/היסטוריה moved
    // into their own hubs, so a four-day split no longer overflows anything.
    expect(tabs()).toHaveLength(4);
    expect(hubs()).toHaveLength(3);
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
    // four inner tabs still fit a phone row — nothing scrolls, and the main bar
    // never can (it is always the same three hubs).
    expect(document.querySelector('#tabs .sub-row')?.classList.contains('scroll')).toBe(false);
  });

  it('keeps the three-tab inner row of the built-in program unscrolled', () => {
    mount();
    expect(tabs()).toHaveLength(3);
    expect(document.querySelector('#tabs .sub-row')?.classList.contains('scroll')).toBe(false);
  });

  it('scrolls the inner row only once a plan defines more days than fit', () => {
    const store = new LocalStore(fakeStorage());
    // Six days, one weekday each: six inner tabs, which is past the four a
    // phone row fits.
    const doc = defaultPlanDoc();
    doc.days = [0, 1, 2, 3, 4, 5].map((w) =>
      makePlanDay(`d_day${w}`, `יום ${w}`, [w], [{ id: 'a1', sets: 3, reps: '10', rest: 90 }]),
    );
    const res = savePlan(store, doc);
    if (!res.ok) throw new Error(res.errors.join(', '));
    mount(store);
    expect(tabs()).toHaveLength(6);
    expect(hubs()).toHaveLength(3);
    expect(document.querySelector('#tabs .sub-row')?.classList.contains('scroll')).toBe(true);
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

    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    });
    render();
    // one bubble for the logged day, and the day itself behind a tap
    expect(document.querySelector('#main .day-bubble .db-date')?.textContent).toBe('5.1');
    const card = openDay('2025-01-05');
    expect(card.querySelector('h3')?.textContent).toContain('05.01.2025');
    expect(card.querySelector('.hist-sets')?.textContent).toContain('40kg×10✓');
  });
});

/* ------------------------------------------------------ two-level navigation */

/**
 * The main bar is exactly three hubs — אימון / קרב / הגדרות — and the second
 * row is whatever that hub contains. The hub is DERIVED from `ui.view`, so no
 * stored view had to move for this: every id the app ever persisted still names
 * the same screen, and now also names the hub that screen lives in.
 */
describe('the three-hub navigation', () => {
  function hubIds(): (string | undefined)[] {
    return hubs().map((h) => h.dataset['hub']);
  }

  function activeHub(): string | undefined {
    return hubs().find((h) => h.classList.contains('active'))?.dataset['hub'];
  }

  it('always shows exactly three main tabs, whatever screen is open', () => {
    const { store, render } = mount();
    for (const view of ['A', 'B', 'C', 'CH', 'BT', 'H', 'ST', 'PL']) {
      store.update((d) => {
        d.ui.view = view;
      });
      render();
      expect(hubIds()).toEqual(['TR', 'GM', 'SE']);
      expect(hubs().filter((h) => h.classList.contains('active'))).toHaveLength(1);
    }
    expect(HUBS.map((h) => h.title)).toEqual(['אימון', 'קרב', 'הגדרות']);
  });

  it('derives the hub from every view id the store can hold', () => {
    expect(hubOf('A')).toBe('TR');
    expect(hubOf('d_alef')).toBe('TR');
    expect(hubOf('d_alef@3')).toBe('TR');
    expect(hubOf('PL')).toBe('TR');
    expect(hubOf('BT')).toBe('GM');
    expect(hubOf('CH')).toBe('GM');
    expect(hubOf('ST')).toBe('SE');
    expect(hubOf('H')).toBe('SE');
    // a day key minted by a plan on another device is still a workout day
    expect(hubOf('d_whatever')).toBe('TR');
  });

  it('lights the hub that owns the open screen, editor included', () => {
    const { store, render } = mount();
    const of = (view: string): string | undefined => {
      store.update((d) => {
        d.ui.view = view;
      });
      render();
      return activeHub();
    };
    expect(of('A')).toBe('TR');
    expect(of('PL')).toBe('TR'); // the editor belongs to the training hub…
    expect(innerTabs().every((t) => !t.classList.contains('active'))).toBe(true); // …but to no tab of it
    expect(of('BT')).toBe('GM');
    expect(of('CH')).toBe('GM');
    expect(of('ST')).toBe('SE');
    expect(of('H')).toBe('SE');
    expect(of('SS')).toBe('SE');
  });

  it('gives each hub its own inner tabs', () => {
    mount();
    expect(innerTabs().map((t) => t.dataset['view'])).toEqual(['A', 'B', 'C']);

    clickHub('GM');
    expect(innerTabs().map((t) => t.dataset['view'])).toEqual(['BT', 'CH']);
    expect(innerTabs()[0]?.textContent).toContain('קרב');
    expect(innerTabs()[1]?.textContent).toContain('דמות');

    clickHub('SE');
    expect(innerTabs().map((t) => t.dataset['view'])).toEqual(['ST', 'H', 'SS']);
    expect(innerTabs()[0]?.textContent).toContain('הגדרות');
    expect(innerTabs()[1]?.textContent).toContain('היסטוריה');
    expect(innerTabs()[2]?.textContent).toContain('סטטיסטיקות');
  });

  it('opens each hub on its home screen and remembers the inner tab per hub', () => {
    const { store } = mount();
    clickView('B');
    expect(store.getState().ui.view).toBe('B');

    clickHub('GM');
    expect(store.getState().ui.view).toBe('BT'); // the arena is the game hub's home
    clickView('CH');
    expect(store.getState().ui.view).toBe('CH');

    clickHub('SE');
    expect(store.getState().ui.view).toBe('ST'); // settings-first, not history
    clickView('H');
    expect(store.getState().ui.view).toBe('H');

    // …and every hub comes back to where it was left
    clickHub('TR');
    expect(store.getState().ui.view).toBe('B');
    clickHub('GM');
    expect(store.getState().ui.view).toBe('CH');
    clickHub('SE');
    expect(store.getState().ui.view).toBe('H');
  });

  it('does not remember the plan editor as the training hub’s inner tab', () => {
    const { store } = mount();
    clickView('C');
    document.getElementById('btnEditPlan')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe('PL');
    clickHub('GM');
    clickHub('TR');
    // back to the workout that was open, not back into the editor
    expect(store.getState().ui.view).toBe('C');
  });

  it('opens an install left on the old היסטוריה view inside the settings hub', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.view = 'H';
    });
    mount(store);
    expect(activeHub()).toBe('SE');
    expect(store.getState().ui.view).toBe('H');
    expect(innerTabs().find((t) => t.classList.contains('active'))?.dataset['view']).toBe('H');
    expect(document.querySelector('#main .empty')).not.toBeNull();
    // …and its hub-mate is one tap away
    clickView('ST');
    expect(document.getElementById('btnExport')).not.toBeNull();
  });
});

/* -------------------------------------------------------------- settings hub */

describe('the settings hub', () => {
  it('splits pressable settings from browsable history', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
      d.ui.view = 'ST';
    });
    render();

    // הגדרות: the plan card, the data actions and the app-info line…
    expect(document.querySelector('#main .plan-card')).not.toBeNull();
    expect(document.getElementById('btnExport')).not.toBeNull();
    expect(document.getElementById('btnImport')).not.toBeNull();
    expect(document.getElementById('btnClear')).not.toBeNull();
    expect(document.getElementById('btnPlanEdit')).not.toBeNull();
    expect(document.querySelector('#main .app-info')?.textContent).toContain('אופליין');
    // …and none of the log
    expect(document.querySelector('#main .day-bubble')).toBeNull();
    expect(document.querySelector('#main .hist-day')).toBeNull();
    expect(document.querySelector('#main .feed')).toBeNull();

    clickView('H');
    // היסטוריה: the log and the adventure feed, and none of the buttons
    expect(openDay('2025-01-05').querySelector('h3')?.textContent).toContain('05.01.2025');
    expect(document.querySelector('#main .hist-heading')?.textContent).toContain('אימונים מתועדים');
    expect(document.getElementById('btnExport')).toBeNull();
    expect(document.getElementById('btnClear')).toBeNull();
    expect(document.querySelector('#main .plan-card')).toBeNull();
  });

  it('shows the app version the package actually declares', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    // The version is a constant rather than a build-time define (the bundle is
    // a plain single-file build with nothing injected), so this test is what
    // keeps it honest.
    expect(APP_VERSION).toBe(pkg.version);
    const { store, render } = mount();
    store.update((d) => {
      d.ui.view = 'ST';
    });
    render();
    expect(document.querySelector('#main .app-info')?.textContent).toContain(pkg.version);
  });

  it('keeps the ⚙️ plan editor reachable from the settings screen', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.ui.view = 'ST';
    });
    render();
    document.getElementById('btnPlanEdit')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe('PL');
    // the editor belongs to the training hub, and ← returns to where it opened
    expect(hubs().find((h) => h.classList.contains('active'))?.dataset['hub']).toBe('TR');
    document.getElementById('btnPlanBack')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe('ST');
  });
});
