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
