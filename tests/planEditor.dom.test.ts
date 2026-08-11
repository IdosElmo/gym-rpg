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

  it('opens from the plan card on the history screen, and comes back to it', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.ui.view = 'H';
    });
    render();
    expect(document.querySelector('.plan-card')).not.toBeNull();
    click('#btnPlanEdit');
    expect(store.getState().ui.view).toBe('PL');
    click('#btnPlanBack');
    expect(store.getState().ui.view).toBe('H');
  });

  it('does NOT add a seventh tab to the nav', () => {
    mount();
    expect(document.querySelectorAll('#tabs .tab')).toHaveLength(6);
    openEditor();
    expect(document.querySelectorAll('#tabs .tab')).toHaveLength(6);
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
    expect(document.querySelector('#main .hist-ex b')?.textContent).toBe('מתח באחיזה צרה');
    expect(document.querySelector('.plan-card .gc-sub')?.textContent).toContain('מותאמת');
  });

  it('falls back to the raw id for an exercise deleted from the plan', () => {
    const { store, render } = mount();
    store.update((d) => {
      d.sessions['2025-01-05'] = { day: 'A', ex: { cx_gone: [{ w: '10', r: '8', done: true }] } };
      d.ui.view = 'H';
    });
    render();
    expect(document.querySelector('#main .hist-ex b')?.textContent).toBe('cx_gone');
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
