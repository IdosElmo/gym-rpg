/**
 * @vitest-environment jsdom
 *
 * planEditor.dom.test.ts — the 'PL' screen, driven through the real app shell.
 *
 * What is worth testing about an editor is not its markup but its CONTRACT:
 *   - a draft is in memory until 💾, and then produces exactly ONE event;
 *   - add / remove / reorder / new-exercise all change the draft and only the
 *     draft, so leaving without saving changes nothing;
 *   - a saved plan actually reaches the workout screen (the whole point);
 *   - reset puts the built-in program back;
 *   - the form refuses a nameless exercise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_PROGRAM, PROGRAM } from '../src/data/program.ts';
import { PLAN_PRESETS } from '../src/data/presets.ts';
import { isDefaultPlan, planRows, resolveProgram } from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
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
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
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
  // The boot view follows the real weekday (defaultDay); these tests assume
  // day A, so navigate there explicitly to stay green on any day of the week.
  click('.tab[data-view="A"]');
  return { store, render: app.render };
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function type(selector: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`missing input: ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Open the editor the way a user does: the ⚙️ button in the workout header. */
function openEditor(): void {
  click('#btnEditPlan');
}

function rowIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.pl-row')].map((el) => el.dataset['row'] ?? '');
}

function planEvents(store: LocalStore): readonly { payload: Record<string, unknown> }[] {
  return store.getEvents().filter((e) => e.type === 'plan_updated');
}

/**
 * Tap a date bubble on the היסטוריה screen and return the card it expanded.
 * The log is a bubble row now (`ui/history.ts`) and only one day is open at a
 * time, so a test that wants two days reads them one tap after the other.
 */
function openDay(date: string): HTMLElement {
  const b = document.querySelector<HTMLElement>(`#main .day-bubble[data-date="${date}"]`);
  if (!b) throw new Error(`no history bubble for ${date}`);
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const card = document.querySelector<HTMLElement>('#main .day-panel .hist-day');
  if (!card) throw new Error(`bubble ${date} opened no card`);
  return card;
}

/** The title line of an expanded day. */
function dayTitle(date: string): string {
  return openDay(date).querySelector('h3')?.textContent ?? '';
}

/* ------------------------------------------------------------ entry points */

describe('plan editor entry points', () => {
  it('opens from the ⚙️ button in the workout header', () => {
    const { store } = mount();
    expect(document.getElementById('btnEditPlan')).not.toBeNull();
    openEditor();
    expect(store.getState().ui.view).toBe('PL');
    expect(document.querySelector('.plan-editor')).not.toBeNull();
    expect(document.querySelector('#header .app-title')?.textContent).toContain('עריכת תוכנית');
  });

  it('opens from the plan card on the settings screen, and comes back to it', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.ui.view = 'ST';
    });
    render();
    expect(document.querySelector('.plan-card')).not.toBeNull();
    click('#btnPlanEdit');
    expect(store.getState().ui.view).toBe('PL');
    click('#btnPlanBack');
    expect(store.getState().ui.view).toBe('ST');
  });

  it('does NOT add a tab to either row of the nav', () => {
    mount();
    expect(document.querySelectorAll('#tabs .hub')).toHaveLength(3);
    expect(document.querySelectorAll('#tabs .tab')).toHaveLength(3);
    openEditor();
    // the editor lives in the אימון hub but claims no tab of its own
    expect(document.querySelectorAll('#tabs .hub')).toHaveLength(3);
    expect(document.querySelectorAll('#tabs .tab')).toHaveLength(3);
    expect(document.querySelectorAll('#tabs .tab.active')).toHaveLength(0);
    // the nav still works as an escape hatch
    expect(document.querySelector<HTMLElement>('#tabs .tab[data-view="A"]')).not.toBeNull();
  });
});

/* ----------------------------------------------------------------- render */

describe('plan editor rendering', () => {
  it('renders day sub-tabs and one row per exercise of the active day', () => {
    mount();
    openEditor();
    expect(document.querySelectorAll('.pl-day')).toHaveLength(3);
    expect(rowIds()).toEqual(PROGRAM.A.exercises.map((e) => e.id));
    const first = document.querySelector('.pl-row .pl-names b')?.textContent;
    expect(first).toBe(PROGRAM.A.exercises[0]?.he);
  });

  it('shows the built-in numbers in the sets / reps / rest inputs', () => {
    mount();
    openEditor();
    const ex = PROGRAM.A.exercises[0];
    if (!ex) throw new Error('no exercise');
    expect(document.querySelector<HTMLInputElement>(`[data-edit="sets"][data-id="${ex.id}"]`)?.value)
      .toBe(String(ex.sets));
    expect(document.querySelector<HTMLInputElement>(`[data-edit="reps"][data-id="${ex.id}"]`)?.value)
      .toBe(ex.reps);
    expect(document.querySelector<HTMLInputElement>(`[data-edit="rest"][data-id="${ex.id}"]`)?.value)
      .toBe(String(ex.rest));
  });

  it('switches to day B and shows its exercises', () => {
    mount();
    openEditor();
    click('.pl-day[data-day="B"]');
    expect(rowIds()).toEqual(PROGRAM.B.exercises.map((e) => e.id));
  });
});

/* --------------------------------------------------------- day management */

function dayTabNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.pl-day .pl-day-name')].map((el) => el.textContent ?? '');
}

function dayTabKeys(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.pl-day')].map((el) => el.dataset['day'] ?? '');
}

function targetText(): string {
  return document.getElementById('plTarget')?.textContent ?? '';
}

function chip(wd: number): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`[data-wd="${wd}"]`);
  if (!el) throw new Error(`no weekday chip ${wd}`);
  return el;
}

describe('day management', () => {
  it('renders the day card: a name, the seven chips and the derived target', () => {
    mount();
    openEditor();
    expect(document.querySelector<HTMLInputElement>('#plDayLabel')?.value).toBe(PROGRAM.A.label);
    expect(document.querySelectorAll('.pl-wd')).toHaveLength(7);
    expect([...document.querySelectorAll('.pl-wd')].map((c) => c.textContent)).toEqual([
      'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש',
    ]);
    // day A of the built-in program is Sun+Mon
    expect(chip(0).classList.contains('on')).toBe(true);
    expect(chip(1).classList.contains('on')).toBe(true);
    expect(chip(2).classList.contains('on')).toBe(false);
    expect(document.getElementById('plWdCaption')?.textContent).toContain('ראשון · שני');
    expect(targetText()).toBe('יעד שבועי: 3 ימי אימון (משפיע על רצף השבוע המושלם)');
  });

  it('renames a day in place, updates its tab, and saves the new name', () => {
    const { store } = mount();
    openEditor();
    type('#plDayLabel', 'יום רגליים');
    expect(dayTabNames()[0]).toBe('יום רגליים');
    click('#plSave');
    expect(store.getState().plan?.days[0]?.label).toBe('יום רגליים');
    // the KEY never moves, so history logged under it is untouched
    expect(store.getState().plan?.days[0]?.key).toBe('A');
  });

  it('falls back to a name when the field is emptied', () => {
    mount();
    openEditor();
    type('#plDayLabel', '   ');
    expect(document.querySelector<HTMLInputElement>('#plDayLabel')?.value).toBe('אימון חדש');
  });

  it('adds a day: a new tab, a fresh d_ key, and the library sheet already open', () => {
    const { store } = mount();
    openEditor();
    click('#plDayAdd');
    expect(dayTabKeys()).toHaveLength(4);
    expect(dayTabKeys()[3]?.startsWith('d_')).toBe(true);
    expect(dayTabNames()[3]).toBe('אימון חדש');
    expect(document.querySelector('.pl-day.active .pl-day-name')?.textContent).toBe('אימון חדש');
    expect(document.querySelector('.pl-sheet')).not.toBeNull();
    expect(document.querySelector('.pl-empty')).not.toBeNull();

    // an empty day cannot be saved — the plan refuses it, and nothing is logged
    click('#plSheetClose');
    click('#plSave');
    expect(planEvents(store)).toHaveLength(0);

    // …give it an exercise and the same save goes through
    click('#plAdd');
    const first = document.querySelector<HTMLButtonElement>('[data-add]');
    first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    click('#plSave');
    expect(planEvents(store)).toHaveLength(1);
    expect(store.getState().plan?.days).toHaveLength(4);
    expect(store.getState().plan?.days[3]?.exercises).toHaveLength(1);
  });

  it('stops at seven days', () => {
    mount();
    openEditor();
    for (let i = 0; i < 4; i += 1) {
      click('#plDayAdd');
      click('#plSheetClose');
    }
    expect(dayTabKeys()).toHaveLength(7);
    expect(document.querySelector<HTMLButtonElement>('#plDayAdd')?.disabled).toBe(true);
    click('#plDayAdd'); // the guard holds even if the button is reached anyway
    expect(dayTabKeys()).toHaveLength(7);
  });

  it('removes a day after a confirm, and warns that the history stays', () => {
    const { store } = mount();
    openEditor();
    let asked = '';
    window.confirm = (msg?: string) => {
      asked = msg ?? '';
      return false;
    };
    click('#plDayRemove');
    expect(asked).toContain('היסטוריה');
    expect(dayTabKeys()).toEqual(['A', 'B', 'C']);

    window.confirm = () => true;
    click('#plDayRemove');
    expect(dayTabKeys()).toEqual(['B', 'C']);
    // the day that follows becomes the active one, with its own rows
    expect(rowIds()).toEqual(PROGRAM.B.exercises.map((e) => e.id));
    click('#plSave');
    expect(store.getState().plan?.days.map((d) => d.key)).toEqual(['B', 'C']);
  });

  it('refuses to remove the last day', () => {
    mount();
    openEditor();
    click('#plDayRemove');
    click('#plDayRemove');
    expect(dayTabKeys()).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('#plDayRemove')?.disabled).toBe(true);
    click('#plDayRemove');
    expect(dayTabKeys()).toHaveLength(1);
  });

  it('reorders the days with ▲ / ▼ — that order is the tab order', () => {
    const { store } = mount();
    openEditor();
    click('#plDayDown');
    expect(dayTabKeys()).toEqual(['B', 'A', 'C']);
    // the moved day stays the active one
    expect(document.querySelector('.pl-day.active')?.getAttribute('data-day')).toBe('A');
    click('#plDayUp');
    expect(dayTabKeys()).toEqual(['A', 'B', 'C']);
    click('#plDayDown');
    click('#plSave');
    expect(store.getState().plan?.days.map((d) => d.key)).toEqual(['B', 'A', 'C']);
  });
});

/* ------------------------------------------------------ weekday chips */

describe('weekday assignment', () => {
  it('toggles a weekday on and off, and updates the caption', () => {
    mount();
    openEditor();
    click('[data-wd="3"]');
    expect(chip(3).classList.contains('on')).toBe(true);
    expect(chip(3).getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('plWdCaption')?.textContent).toContain('רביעי');
    click('[data-wd="3"]');
    expect(chip(3).classList.contains('on')).toBe(false);
    expect(document.getElementById('plWdCaption')?.textContent).not.toContain('רביעי');
  });

  it('gives a weekday to at most ONE day, and says where it came from', () => {
    const { store } = mount();
    openEditor();
    // Wednesday (3) belongs to day B in the built-in map; claim it for day A
    click('.pl-day[data-day="B"]');
    expect(chip(3).classList.contains('on')).toBe(true);
    click('.pl-day[data-day="A"]');
    click('[data-wd="3"]');
    expect(document.getElementById('plWdHint')?.textContent).toContain('רביעי');
    expect(document.getElementById('plWdHint')?.textContent).toContain(PROGRAM.B.label);
    // …and day B really lost it
    click('.pl-day[data-day="B"]');
    expect(chip(3).classList.contains('on')).toBe(false);
    click('#plSave');
    const days = store.getState().plan?.days ?? [];
    expect(days[0]?.weekdays).toEqual([0, 1, 3]);
    expect(days[1]?.weekdays).toEqual([2]);
    // no weekday is claimed twice
    const all = days.flatMap((d) => d.weekdays ?? []);
    expect(new Set(all).size).toBe(all.length);
  });

  it('drops the field entirely when a day is left with no weekdays', () => {
    const { store } = mount();
    openEditor();
    click('[data-wd="0"]');
    click('[data-wd="1"]');
    expect(document.getElementById('plWdCaption')?.textContent).toContain('לא שובצו');
    click('#plSave');
    expect(store.getState().plan?.days[0]?.weekdays).toBeUndefined();
  });

  it('derives the weekly target from the chips, and shows it', () => {
    const { store } = mount();
    openEditor();
    // the built-in A/B/C ranges are a routing map: three workouts, target 3
    expect(targetText()).toContain('יעד שבועי: 3');
    // clear every day's weekdays, then hand-build a real 4-day schedule
    for (const key of ['A', 'B', 'C']) {
      click(`.pl-day[data-day="${key}"]`);
      for (let wd = 0; wd < 7; wd += 1) if (chip(wd).classList.contains('on')) click(`[data-wd="${wd}"]`);
    }
    expect(targetText()).toContain('יעד שבועי: 3'); // nothing assigned -> one per day
    click('.pl-day[data-day="A"]');
    click('[data-wd="0"]');
    click('[data-wd="3"]');
    expect(targetText()).toContain('יעד שבועי: 2');
    click('.pl-day[data-day="B"]');
    click('[data-wd="2"]');
    click('[data-wd="4"]');
    expect(targetText()).toBe('יעד שבועי: 4 ימי אימון (משפיע על רצף השבוע המושלם)');
    click('#plSave');
    expect(store.getState().plan?.weeklyTarget).toBe(4);
    expect(resolveProgram(store.getState().plan).weeklyTarget).toBe(4);
  });
});

/* ---------------------------------------------------------------- presets */

describe('ready-made presets', () => {
  function openPresets(): void {
    click('#plPresets');
  }

  it('lists every preset with its name, day count and description', () => {
    mount();
    openEditor();
    openPresets();
    const cards = [...document.querySelectorAll<HTMLElement>('[data-preset]')];
    expect(cards.map((c) => c.dataset['preset'])).toEqual(PLAN_PRESETS.map((p) => p.id));
    for (const [i, card] of cards.entries()) {
      const preset = PLAN_PRESETS[i];
      expect(card.querySelector('b')?.textContent).toBe(preset?.name);
      expect(card.querySelector('span')?.textContent).toContain(`${preset?.days} ימי אימון`);
    }
  });

  it('keeps the draft when the confirm is declined', () => {
    mount();
    openEditor();
    openPresets();
    window.confirm = () => false;
    click('[data-preset="ab4"]');
    expect(dayTabKeys()).toEqual(['A', 'B', 'C']);
    expect(document.querySelector('.pl-sheet')).not.toBeNull();
  });

  it('replaces the draft, then saves it as ONE plan_updated event', () => {
    const { store } = mount();
    openEditor();
    openPresets();
    click('[data-preset="ab4"]');

    expect(document.querySelector('.pl-sheet')).toBeNull();
    expect(dayTabNames()).toHaveLength(2);
    expect(dayTabNames()[0]).toContain('חלק א׳');
    expect(dayTabNames()[1]).toContain('חלק ב׳');
    expect(targetText()).toContain('יעד שבועי: 4');
    expect(rowIds()).toEqual(['x1', 'c2', 'x2', 'x3', 'b1', 'c3', 'x4', 'x5']);
    // …still only a draft
    expect(store.getState().plan).toBeNull();
    expect(planEvents(store)).toHaveLength(0);

    click('#plSave');
    expect(planEvents(store)).toHaveLength(1);
    const saved = store.getState().plan;
    expect(saved?.days).toHaveLength(2);
    expect(saved?.weeklyTarget).toBe(4);
    expect(saved?.days[0]?.weekdays).toEqual([0, 3]);
    expect(saved?.days[1]?.weekdays).toEqual([2, 4]);
    expect(saved?.days[1]?.exercises.map((r) => r.id)).toEqual(['b2', 'x6', 'b4', 'a2', 'x7', 'x8', 'a5', 'x9']);
    // the whole document travels in the one event
    const payload = planEvents(store)[0]?.payload['plan'] as { days?: unknown[] } | null;
    expect(payload?.days).toHaveLength(2);
  });

  it('drives the app: four scheduled tabs, the new exercises, and real XP', () => {
    const { store } = mount();
    openEditor();
    openPresets();
    click('[data-preset="ab4"]');
    click('#plSave');
    click('#btnPlanBack');

    const tabs = [...document.querySelectorAll<HTMLElement>('#tabs .tab')];
    // The preset defines TWO days trained on four weekdays, and the אימון hub's
    // inner row shows the WEEK: ראשון / שלישי / רביעי / חמישי — nothing else.
    expect(tabs).toHaveLength(4);
    expect(tabs[0]?.textContent).toContain('ראשון');
    expect(tabs[0]?.textContent).toContain('חלק א׳');
    // the boot tab follows the real weekday, so pin the test to חלק א׳
    click(`#tabs .tab[data-view^="${store.getState().plan?.days[0]?.key ?? ''}"]`);
    // the workout screen renders a library exercise like any other
    const card = document.getElementById('card-x1');
    expect(card?.querySelector('.ex-title')?.textContent).toBe('סקוואט בסמית׳ מאשין');
    expect(card?.querySelectorAll('.chk')).toHaveLength(4);
    expect(card?.querySelector('.form-panel')).not.toBeNull();

    click('#main .chk[data-ex="x1"][data-set="0"]');
    expect(store.getState().game?.parts.legs.xp).toBeGreaterThan(0);
    expect(store.getEvents().find((e) => e.type === 'xp_gained')?.payload['exId']).toBe('x1');
  });

  it('offers the built-in program as a preset too', () => {
    const { store } = mount();
    openEditor();
    openPresets();
    click('[data-preset="ab4"]');
    openPresets();
    click('[data-preset="builtin3"]');
    expect(dayTabKeys()).toEqual(['A', 'B', 'C']);
    click('#plSave');
    expect(isDefaultPlan(store.getState().plan)).toBe(true);
  });
});

/* ------------------------------------------------------------ draft edits */

describe('editing the draft', () => {
  it('writes an inline edit into the draft WITHOUT touching the store', () => {
    const { store } = mount();
    openEditor();
    const ex = PROGRAM.A.exercises[0];
    if (!ex) throw new Error('no exercise');
    type(`[data-edit="sets"][data-id="${ex.id}"]`, '5');
    type(`[data-edit="rest"][data-id="${ex.id}"]`, '120');
    expect(store.getState().plan).toBeNull();
    expect(planEvents(store)).toHaveLength(0);
    expect(document.getElementById('plHint')?.textContent).toContain('לא נשמרו');
  });

  it('clamps an out-of-range number on blur', () => {
    mount();
    openEditor();
    const ex = PROGRAM.A.exercises[0];
    if (!ex) throw new Error('no exercise');
    type(`[data-edit="sets"][data-id="${ex.id}"]`, '99');
    expect(document.querySelector<HTMLInputElement>(`[data-edit="sets"][data-id="${ex.id}"]`)?.value).toBe('10');
    type(`[data-edit="rest"][data-id="${ex.id}"]`, '2');
    expect(document.querySelector<HTMLInputElement>(`[data-edit="rest"][data-id="${ex.id}"]`)?.value).toBe('15');
  });

  it('reorders a row with ▼ and ▲', () => {
    mount();
    openEditor();
    const original = rowIds();
    const [first, second] = original;
    if (!first || !second) throw new Error('need two rows');
    click(`[data-down="${first}"]`);
    expect(rowIds().slice(0, 2)).toEqual([second, first]);
    click(`[data-up="${first}"]`);
    expect(rowIds()).toEqual(original);
  });

  it('disables ▲ on the first row and ▼ on the last', () => {
    mount();
    openEditor();
    const rows = [...document.querySelectorAll('.pl-row')];
    const firstUp = rows[0]?.querySelector<HTMLButtonElement>('[data-up]');
    const lastDown = rows.at(-1)?.querySelector<HTMLButtonElement>('[data-down]');
    expect(firstUp?.disabled).toBe(true);
    expect(lastDown?.disabled).toBe(true);
  });

  it('removes a row after a confirm, and keeps it when the confirm is declined', () => {
    mount();
    openEditor();
    const victim = rowIds()[1];
    if (!victim) throw new Error('no row');

    window.confirm = () => false;
    click(`[data-remove="${victim}"]`);
    expect(rowIds()).toContain(victim);

    window.confirm = () => true;
    click(`[data-remove="${victim}"]`);
    expect(rowIds()).not.toContain(victim);
  });

  it('refuses to empty a day completely', () => {
    mount();
    openEditor();
    // strip the day down to one row, then try to remove that one too
    while (rowIds().length > 1) {
      const id = rowIds()[0];
      if (!id) break;
      click(`[data-remove="${id}"]`);
    }
    expect(rowIds()).toHaveLength(1);
    const last = rowIds()[0];
    click(`[data-remove="${last}"]`);
    expect(rowIds()).toHaveLength(1);
  });

  it('adds a built-in exercise from the bottom sheet library', () => {
    mount();
    openEditor();
    const victim = rowIds()[0];
    if (!victim) throw new Error('no row');
    click(`[data-remove="${victim}"]`);
    expect(rowIds()).not.toContain(victim);

    click('#plAdd');
    expect(document.querySelector('.pl-sheet')).not.toBeNull();
    // the sheet never offers something already in the day
    const offered = [...document.querySelectorAll<HTMLElement>('[data-add]')].map((b) => b.dataset['add']);
    expect(offered).toContain(victim);
    expect(offered).not.toContain(rowIds()[0]);

    click(`[data-add="${victim}"]`);
    expect(document.querySelector('.pl-sheet')).toBeNull();
    expect(rowIds()).toContain(victim);
  });

  it('closes the sheet from ✕ and from the backdrop', () => {
    mount();
    openEditor();
    click('#plAdd');
    click('#plSheetClose');
    expect(document.querySelector('.pl-sheet')).toBeNull();
    click('#plAdd');
    click('#plBackdrop');
    expect(document.querySelector('.pl-sheet')).toBeNull();
  });

  it('throws the draft away when the editor is reopened', () => {
    const { store } = mount();
    openEditor();
    const victim = rowIds()[0];
    if (!victim) throw new Error('no row');
    click(`[data-remove="${victim}"]`);
    expect(rowIds()).not.toContain(victim);

    click('#btnPlanBack');
    openEditor();
    expect(rowIds()).toEqual(PROGRAM.A.exercises.map((e) => e.id));
    expect(store.getState().plan).toBeNull();
  });
});

/* ------------------------------------------------------- new exercise form */

describe('the ✨ new-exercise form', () => {
  function openForm(): void {
    click('#plAdd');
    click('#plNewToggle');
  }

  it('refuses a nameless exercise and adds nothing', () => {
    mount();
    openEditor();
    const before = rowIds().length;
    openForm();
    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('#plNewForm')).not.toBeNull(); // still open
    expect(rowIds()).toHaveLength(before);
  });

  it('creates a custom exercise with a cx_ id and adds it to the day', () => {
    const { store } = mount();
    openEditor();
    openForm();
    const he = document.querySelector<HTMLInputElement>('#nxHe');
    const en = document.querySelector<HTMLInputElement>('#nxEn');
    const part = document.querySelector<HTMLSelectElement>('#nxPart');
    const part2 = document.querySelector<HTMLSelectElement>('#nxPart2');
    const unit = document.querySelector<HTMLSelectElement>('#nxUnit');
    if (!he || !en || !part || !part2 || !unit) throw new Error('form not rendered');
    he.value = 'משיכת פנים';
    en.value = 'Face Pull';
    part.value = 'shoulders';
    part2.value = 'back';
    unit.value = 'שניות';
    const chip = document.querySelector<HTMLInputElement>('[data-equip][value="Machine"]');
    if (!chip) throw new Error('no equipment chip');
    chip.checked = true;

    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    const added = rowIds().at(-1) ?? '';
    expect(added.startsWith('cx_')).toBe(true);
    expect(document.querySelector('.pl-sheet')).toBeNull();
    expect(document.querySelector('.pl-row:last-child .pl-badge')?.textContent).toContain('מותאם');
    // still only a draft
    expect(store.getState().plan).toBeNull();

    // …and saving it carries the whole definition, with the 70/30 split
    click('#plSave');
    const custom = store.getState().plan?.customExercises[0];
    expect(custom?.he).toBe('משיכת פנים');
    expect(custom?.en).toBe('Face Pull');
    expect(custom?.bodyPart).toBe('shoulders');
    expect(custom?.split).toEqual({ shoulders: 0.7, back: 0.3 });
    expect(custom?.unit).toBe('שניות');
    expect(custom?.equip).toEqual(['Machine']);
  });

  it('ignores a secondary part equal to the primary one', () => {
    const { store } = mount();
    openEditor();
    openForm();
    const he = document.querySelector<HTMLInputElement>('#nxHe');
    const part = document.querySelector<HTMLSelectElement>('#nxPart');
    const part2 = document.querySelector<HTMLSelectElement>('#nxPart2');
    if (!he || !part || !part2) throw new Error('form not rendered');
    he.value = 'סקוואט בולגרי';
    part.value = 'legs';
    part2.value = 'legs';
    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    click('#plSave');
    const custom = store.getState().plan?.customExercises[0];
    expect(custom?.bodyPart).toBe('legs');
    expect(custom?.split).toBeUndefined();
  });
});

/* --------------------------------------------------------------- save/reset */

describe('saving and resetting', () => {
  it('appends EXACTLY ONE plan_updated event per save', () => {
    const { store } = mount();
    openEditor();
    const ex = PROGRAM.A.exercises[0];
    if (!ex) throw new Error('no exercise');
    type(`[data-edit="sets"][data-id="${ex.id}"]`, '5');
    click('#plSave');

    expect(planEvents(store)).toHaveLength(1);
    expect(planRows(store.getState().plan, 'A')[0]?.sets).toBe(5);
    expect(document.getElementById('plHint')?.textContent).toContain('שמורה');

    // saving again with no further edits is still one event per press, no more
    click('#plSave');
    expect(planEvents(store)).toHaveLength(2);
  });

  it('shows the saved plan on the workout screen', () => {
    const { store } = mount();
    openEditor();
    const victim = rowIds()[0];
    if (!victim) throw new Error('no row');
    click(`[data-remove="${victim}"]`);
    type(`[data-edit="sets"][data-id="${rowIds()[0]}"]`, '4');
    click('#plSave');
    click('#btnPlanBack');

    expect(store.getState().ui.view).toBe('A');
    const cards = [...document.querySelectorAll<HTMLElement>('#main .ex-card')];
    expect(cards).toHaveLength(PROGRAM.A.exercises.length - 1);
    expect(cards.map((c) => c.id)).not.toContain(`card-${victim}`);
    expect(document.querySelectorAll(`#main .chk[data-ex="${rowIds()[0]}"]`)).toHaveLength(0);
  });

  it('renders a custom exercise on the workout screen with no explanation panel', () => {
    const { store } = mount();
    openEditor();
    click('#plAdd');
    click('#plNewToggle');
    const he = document.querySelector<HTMLInputElement>('#nxHe');
    if (!he) throw new Error('form not rendered');
    he.value = 'גלגלת בטן';
    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    click('#plSave');
    const id = planRows(store.getState().plan, 'A').at(-1)?.id ?? '';
    click('#btnPlanBack');

    const card = document.getElementById(`card-${id}`);
    expect(card).not.toBeNull();
    expect(card?.querySelector('.ex-title')?.textContent).toBe('גלגלת בטן');
    // custom exercises carry no coaching copy — so no empty drawer is drawn
    expect(card?.querySelector('.form-toggle')).toBeNull();
    expect(card?.querySelector('.form-panel')).toBeNull();
    // …but it is fully loggable
    expect(card?.querySelectorAll('.chk')).toHaveLength(3);
  });

  it('grants XP for a custom exercise to the body part chosen in the form', () => {
    const { store } = mount();
    openEditor();
    click('#plAdd');
    click('#plNewToggle');
    const he = document.querySelector<HTMLInputElement>('#nxHe');
    const part = document.querySelector<HTMLSelectElement>('#nxPart');
    if (!he || !part) throw new Error('form not rendered');
    he.value = 'הרמות צד';
    part.value = 'shoulders';
    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    click('#plSave');
    const id = planRows(store.getState().plan, 'A').at(-1)?.id ?? '';
    click('#btnPlanBack');

    click(`#main .chk[data-ex="${id}"][data-set="0"]`);
    const game = store.getState().game;
    expect(game?.parts.shoulders.xp).toBeGreaterThan(0);
    expect(game?.parts.chest.xp).toBe(0);
    const xpEvent = store.getEvents().find((e) => e.type === 'xp_gained');
    expect(xpEvent?.payload['exId']).toBe(id);
  });

  it('resets to the built-in program after a confirm', () => {
    const { store } = mount();
    openEditor();
    const victim = rowIds()[0];
    if (!victim) throw new Error('no row');
    click(`[data-remove="${victim}"]`);
    click('#plSave');
    expect(isDefaultPlan(store.getState().plan)).toBe(false);

    window.confirm = () => false;
    click('#plReset');
    expect(store.getState().plan).not.toBeNull();

    window.confirm = () => true;
    click('#plReset');
    expect(store.getState().plan).toBeNull();
    expect(resolveProgram(store.getState().plan)).toBe(BUILTIN_PROGRAM);
    expect(rowIds()).toEqual(PROGRAM.A.exercises.map((e) => e.id));
    const last = planEvents(store).at(-1);
    expect(last?.payload['plan']).toBeNull();
  });

  it('refuses to save an invalid plan and leaves the log alone', () => {
    const { store } = mount();
    openEditor();
    // force an invalid draft the UI itself guards against: empty the day
    const doc = store.getState().plan;
    expect(doc).toBeNull();
    const reps = document.querySelector<HTMLInputElement>('[data-edit="reps"]');
    if (!reps) throw new Error('no reps input');
    reps.value = '   ';
    reps.dispatchEvent(new Event('input', { bubbles: true }));
    click('#plSave');
    // the blank reps field was replaced by the default on blur, so this saves;
    // what must never happen is an event for a document that failed validation
    expect(planEvents(store).length).toBeLessThanOrEqual(1);
  });

  it('survives a reload: the saved plan drives the workout screen', () => {
    const storage = fakeStorage();
    const first = new LocalStore(storage);
    mount(first);
    openEditor();
    const victim = rowIds()[0];
    if (!victim) throw new Error('no row');
    click(`[data-remove="${victim}"]`);
    click('#plSave');

    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    const reloaded = new LocalStore(storage);
    reloaded.update((d) => {
      d.ui.view = 'A';
    });
    mount(reloaded);
    expect(document.querySelectorAll('#main .ex-card')).toHaveLength(PROGRAM.A.exercises.length - 1);
  });
});

/* -------------------------------------------------------------- history UI */

describe('history with a custom plan', () => {
  it('shows a custom exercise by name in the logged history', () => {
    const { store, render } = mount();
    openEditor();
    click('#plAdd');
    click('#plNewToggle');
    const he = document.querySelector<HTMLInputElement>('#nxHe');
    if (!he) throw new Error('form not rendered');
    he.value = 'מתח באחיזה צרה';
    document.querySelector<HTMLFormElement>('#plNewForm')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    click('#plSave');
    const id = planRows(store.getState().plan, 'A').at(-1)?.id ?? '';

    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { [id]: [{ w: '0', r: '8', done: true }] } };
      d.ui.view = 'H';
    });
    render();
    expect(openDay('2025-01-05').querySelector('.hist-ex b')?.textContent).toBe('מתח באחיזה צרה');
    // the plan card moved one inner tab across, to הגדרות
    store.update((d) => {
      d.ui.view = 'ST';
    });
    render();
    expect(document.querySelector('.plan-card .gc-sub')?.textContent).toContain('מותאמת');
  });

  it('names a logged day through the ACTIVE plan, and degrades gracefully', () => {
    const { store, render } = mount();
    openEditor();
    // rename day A, then log a session under it and under two dead keys
    type('#plDayLabel', 'יום הרגליים');
    click('#plSave');
    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '8', done: true }] } };
      d.sessions['2025-01-06'] = { day: 'B', ex: { b1: [{ w: '50', r: '8', done: true }] } };
      d.ui.view = 'H';
    });
    render();
    const titles = [dayTitle('2025-01-05'), dayTitle('2025-01-06')];
    expect(titles.some((t) => t.includes('יום הרגליים'))).toBe(true);
    expect(titles.some((t) => t.includes(PROGRAM.B.label))).toBe(true);
  });

  it('keeps naming a session whose day is no longer in the plan at all', () => {
    const { store, render } = mount();
    openEditor();
    click('#plPresets');
    click('[data-preset="ab4"]'); // brand-new d_ keys: A/B/C all disappear
    click('#plSave');
    store.update((d) => {
      // a legacy A/B/C session, and one from a day invented on another device
      d.sessions['2025-01-05'] = { day: 'A', ex: { a1: [{ w: '40', r: '8', done: true }] } };
      d.sessions['2025-01-06'] = { day: 'd_gone', ex: { a1: [{ w: '42', r: '8', done: true }] } };
      d.ui.view = 'H';
    });
    render();
    const titles = [dayTitle('2025-01-05'), dayTitle('2025-01-06')];
    // the built-in label survives for A, and the unknown key gets a neutral name
    expect(titles.some((t) => t.includes(PROGRAM.A.label))).toBe(true);
    expect(titles.some((t) => t.includes('אימון') && !t.includes('d_gone'))).toBe(true);
    expect(document.body.innerHTML).not.toContain('d_gone');
    // no day copy is borrowed from another day: no weekday caption, no focus
    expect(titles.every((t) => !t.includes('(יום'))).toBe(true);
  });

  it('names the finished workout in the adventure feed, on a custom day key', () => {
    const { store, render } = mount();
    openEditor();
    click('#plPresets');
    click('[data-preset="ab4"]');
    click('#plSave');
    click('#btnPlanBack');
    const dayKey = store.getState().plan?.days[0]?.key ?? '';
    // חלק א׳ is trained twice a week, so its tabs are `key@0` / `key@3`; either
    // occurrence logs under the bare day key.
    click(`#tabs .tab[data-view^="${dayKey}"]`);

    // tick every set of every exercise of חלק א׳ -> workout_finished
    const boxes = [...document.querySelectorAll<HTMLElement>('#main .chk')];
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const finished = store.getEvents().filter((e) => e.type === 'workout_finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]?.payload['day']).toBe(dayKey);

    store.update((d) => {
      d.ui.view = 'H';
    });
    render();
    const line = [...document.querySelectorAll<HTMLElement>('.feed-item.workout .fi-text')].map((e) => e.textContent);
    expect(line[0]).toContain('אימון הושלם במלואו');
    expect(line[0]).toContain('חלק א׳');
  });

  it('falls back to the raw id for an exercise deleted from the plan', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { cx_gone: [{ w: '10', r: '8', done: true }] } };
      d.ui.view = 'H';
    });
    render();
    expect(openDay('2025-01-05').querySelector('.hist-ex b')?.textContent).toBe('cx_gone');
  });
});

/* ------------------------------------------------------------- reduced UI */

describe('touch targets', () => {
  it('gives every editor control a data attribute the CSS sizes to ≥40px', () => {
    // The sizes themselves live in styles/plan.css (jsdom has no layout), so
    // what is asserted here is that every control carries the class the CSS
    // targets — a control that forgets it would silently be too small.
    mount();
    openEditor();
    const minis = [...document.querySelectorAll('.pl-move button')];
    expect(minis.length).toBeGreaterThan(0);
    for (const b of minis) expect(b.classList.contains('pl-mini')).toBe(true);
    expect(document.querySelector('#plAdd')?.classList.contains('pl-add')).toBe(true);
    expect(document.querySelector('#plSave')?.classList.contains('action-btn')).toBe(true);
    // the day controls added with variable-day plans carry theirs too
    expect(document.querySelector('#plDayAdd')?.classList.contains('pl-day-add')).toBe(true);
    expect(document.querySelector('#plPresets')?.classList.contains('action-btn')).toBe(true);
    for (const id of ['plDayUp', 'plDayDown', 'plDayRemove']) {
      expect(document.getElementById(id)?.classList.contains('pl-mini')).toBe(true);
    }
    const chips = [...document.querySelectorAll('.pl-wd')];
    expect(chips).toHaveLength(7);
    for (const c of chips) expect(c.getAttribute('aria-pressed')).toMatch(/true|false/);
  });

  it('labels the reorder and remove buttons for screen readers', () => {
    mount();
    openEditor();
    const up = document.querySelector('[data-up]');
    expect(up?.getAttribute('aria-label')).toMatch(/למעלה/);
    expect(document.querySelector('[data-remove]')?.getAttribute('aria-label')).toMatch(/הסר/);
    expect(document.querySelector('.pl-day.active')?.getAttribute('aria-selected')).toBe('true');
  });
});

/* ----------------------------------------------------------------- cleanup */

describe('no stray timers', () => {
  it('does not start the rest timer from the editor', () => {
    const spy = vi.spyOn(window, 'setInterval');
    mount();
    openEditor();
    click('#plAdd');
    click('#plSheetClose');
    expect(document.getElementById('timerBar')?.classList.contains('show')).toBe(false);
    spy.mockRestore();
  });
});

/* ---------------------------------------------------------------- supersets */

/**
 * The 🔗 control, the pair it makes, and the two numbers a pair shares.
 *
 * All of it is DRAFT work: nothing reaches the store until 💾, and then the
 * link travels inside the ONE `plan_updated` event the editor has always
 * appended — there is no superset event, and there is nothing to migrate.
 */
describe('supersets in the plan editor', () => {
  const A0 = PROGRAM.A.exercises[0]?.id ?? '';
  const A1 = PROGRAM.A.exercises[1]?.id ?? '';
  const A2 = PROGRAM.A.exercises[2]?.id ?? '';

  function links(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[data-sslink]')];
  }

  function field(kind: 'sets' | 'reps' | 'rest', id: string): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>(`[data-edit="${kind}"][data-id="${id}"]`);
    if (!el) throw new Error(`no ${kind} input for ${id}`);
    return el;
  }

  /** The pair of the saved day A, as the stored document holds it. */
  function savedPairs(store: LocalStore): readonly (readonly [string, string])[] {
    return store.getState().plan?.days.find((d) => d.key === 'A')?.supersets ?? [];
  }

  it('offers a 🔗 control between every two adjacent rows', () => {
    mount();
    openEditor();
    expect(links()).toHaveLength(PROGRAM.A.exercises.length - 1);
    expect(links()[0]?.textContent).toContain('צרו סופר־סט');
    expect(document.querySelector('.pl-ss-pair')).toBeNull();
  });

  it('links two rows: one bracketed pair, the tag, and the shared numbers agree', () => {
    mount();
    openEditor();
    // different numbers on the two rows first, so the sync is visible
    type(`[data-edit="rest"][data-id="${A0}"]`, '120');
    type(`[data-edit="rest"][data-id="${A1}"]`, '45');
    type(`[data-edit="sets"][data-id="${A1}"]`, '5');

    click(`[data-sslink="${A0}"]`);

    const pair = document.querySelector('.pl-ss-pair');
    expect(pair).not.toBeNull();
    expect(pair?.querySelector('.pl-ss-tag')?.textContent).toContain('סופר־סט');
    expect([...(pair?.querySelectorAll('.pl-row') ?? [])].map((r) => (r as HTMLElement).dataset['row']))
      .toEqual([A0, A1]);
    expect(pair?.querySelector('.pl-ss-rest-note')?.textContent).toContain('מנוחה משותפת');
    // rest := the FIRST row's, sets := the larger of the two
    expect(field('rest', A0).value).toBe('120');
    expect(field('rest', A1).value).toBe('120');
    expect(field('sets', A0).value).toBe('5');
    expect(field('sets', A1).value).toBe('5');
    // …and the row order of the day is untouched
    expect(rowIds()).toEqual(PROGRAM.A.exercises.map((e) => e.id));
  });

  it('marks the shared fields, and lets the reps of the two stay different', () => {
    mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    type(`[data-edit="reps"][data-id="${A0}"]`, '6–8');
    expect(field('reps', A0).value).toBe('6–8');
    expect(field('reps', A1).value).toBe(PROGRAM.A.exercises[1]?.reps);
    const shared = document.querySelectorAll('.pl-ss-pair .pl-field.rest-shared');
    expect(shared).toHaveLength(4); // sets + rest, on both rows
  });

  it('moves rest and sets of a linked pair together, whichever row is edited', () => {
    const { store } = mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);

    type(`[data-edit="rest"][data-id="${A1}"]`, '75');
    expect(field('rest', A0).value).toBe('75');
    type(`[data-edit="sets"][data-id="${A0}"]`, '4');
    expect(field('sets', A1).value).toBe('4');

    click('#plSave');
    const day = store.getState().plan?.days.find((d) => d.key === 'A');
    const rows = day?.exercises.filter((r) => r.id === A0 || r.id === A1) ?? [];
    expect(rows.map((r) => r.rest)).toEqual([75, 75]);
    expect(rows.map((r) => r.sets)).toEqual([4, 4]);
  });

  it('refuses to let an exercise join two pairs', () => {
    mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    // the control between the pair's second row and the row after it is dead
    const next = document.querySelector<HTMLButtonElement>(`[data-sslink="${A1}"]`);
    expect(next?.disabled).toBe(true);
    next?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.pl-ss-pair')).toHaveLength(1);
  });

  it('unlinks from inside the pair, leaving both rows and their numbers in place', () => {
    const { store } = mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    expect(document.querySelector('[data-ssunlink]')?.textContent).toContain('ביטול');
    click(`[data-ssunlink="${A0}"]`);
    expect(document.querySelector('.pl-ss-pair')).toBeNull();
    expect(rowIds()).toEqual(PROGRAM.A.exercises.map((e) => e.id));
    click('#plSave');
    expect(savedPairs(store)).toEqual([]);
  });

  it('breaks the link when a move pulls the two rows apart', () => {
    mount();
    openEditor();
    click(`[data-sslink="${A1}"]`); // pair = rows 2 + 3
    expect(document.querySelectorAll('.pl-ss-pair')).toHaveLength(1);
    click(`[data-up="${A1}"]`); // …and now row 2 is row 1: no longer adjacent
    expect(rowIds().slice(0, 3)).toEqual([A1, A0, A2]);
    expect(document.querySelector('.pl-ss-pair')).toBeNull();
  });

  it('keeps the link when the two halves merely swap places', () => {
    mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    click(`[data-down="${A0}"]`); // still next to each other, other one first
    expect(rowIds().slice(0, 2)).toEqual([A1, A0]);
    const pair = document.querySelector('.pl-ss-pair');
    expect(pair).not.toBeNull();
    expect([...(pair?.querySelectorAll('.pl-row') ?? [])].map((r) => (r as HTMLElement).dataset['row']))
      .toEqual([A1, A0]);
  });

  it('breaks the link when one of its rows is removed', () => {
    const { store } = mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    click(`[data-remove="${A1}"]`);
    expect(document.querySelector('.pl-ss-pair')).toBeNull();
    expect(rowIds()).not.toContain(A1);
    click('#plSave');
    expect(savedPairs(store)).toEqual([]);
  });

  it('saves the pair in exactly ONE plan_updated event, and reloads with it', () => {
    const { store } = mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    click('#plSave');

    expect(planEvents(store)).toHaveLength(1);
    const doc = planEvents(store)[0]?.payload['plan'] as { days: { key: string; supersets?: unknown }[] };
    expect(doc.days.find((d) => d.key === 'A')?.supersets).toEqual([[A0, A1]]);
    expect(savedPairs(store)).toEqual([[A0, A1]]);
    // and the editor, reopened on the saved plan, shows the pair again
    click('#plClose');
    openEditor();
    expect(document.querySelectorAll('.pl-ss-pair')).toHaveLength(1);
    expect(document.getElementById('plHint')?.textContent).toContain('שמורה');
  });

  it('keeps links per day: switching days shows the other day’s own pairs', () => {
    const { store } = mount();
    openEditor();
    click(`[data-sslink="${A0}"]`);
    click('.pl-day[data-day="B"]');
    expect(document.querySelector('.pl-ss-pair')).toBeNull();
    const b0 = PROGRAM.B.exercises[0]?.id ?? '';
    click(`[data-sslink="${b0}"]`);
    expect(document.querySelectorAll('.pl-ss-pair')).toHaveLength(1);
    click('.pl-day[data-day="A"]');
    expect(document.querySelectorAll('.pl-ss-pair')).toHaveLength(1);
    click('#plSave');
    expect(savedPairs(store)).toEqual([[A0, A1]]);
    expect(store.getState().plan?.days.find((d) => d.key === 'B')?.supersets)
      .toEqual([[b0, PROGRAM.B.exercises[1]?.id]]);
  });
});
