/**
 * @vitest-environment jsdom
 *
 * ui/exerciseDemo.ts — the demo's LIFE, and where it lands on the workout card.
 *
 * DRIVING TIME. The interpolator is a `requestAnimationFrame` loop, so the
 * tests here do what the arena tests do: stub `requestAnimationFrame` with a
 * queue we pump by hand, and check the loop's book-keeping instead of waiting
 * for real frames. `renderAt(ms)` covers the painting itself with no clock at
 * all.
 *
 * THE THREE STATES the loop can be in are all asserted:
 *   - animating (a frame is scheduled, the moving group repaints);
 *   - still, because `prefers-reduced-motion` is on or there is no rAF in this
 *     host — the mid-rep pose is painted once and NOTHING is scheduled;
 *   - gone, because the drawer was closed or the screen re-rendered — the
 *     element is removed and the pending frame is cancelled.
 *
 * WHAT COUNTS AS "PAINTED" is the volumetric figure: the moving group carries a
 * `cd-figure` wrapper, a torso clip path rebuilt on every frame because the
 * torso deforms, and a `cd-hi` muscle patch. Those are the markers asserted
 * here, in place of the stick renderer's ones.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { demoFor } from '../src/data/exercisePoses.ts';
import { PROGRAM, isBuiltInDayKey, type BuiltInDayKey } from '../src/data/program.ts';
import { CUSTOM_ID_PREFIX, type PlanDoc } from '../src/data/planTypes.ts';
import { defaultPlanDoc, makePlanDay, savePlan } from '../src/core/plan.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { createApp } from '../src/ui/app.ts';
import { clipIdOf, mountExerciseDemo, poseAt, stillPose } from '../src/ui/exerciseDemo.ts';
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

/* ------------------------------------------------------- a hand-pumped rAF */

interface Raf {
  frames: Array<(t: number) => void>;
  cancelled: number[];
  scheduled: number;
}

let raf: Raf;

function installRaf(): void {
  raf = { frames: [], cancelled: [], scheduled: 0 };
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void): number => {
    raf.frames.push(cb);
    raf.scheduled++;
    return raf.frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    raf.cancelled.push(id);
  });
}

/** Run whatever is queued, once, at `t` ms. */
function pump(t: number): void {
  const queued = raf.frames.splice(0, raf.frames.length);
  for (const cb of queued) cb(t);
}

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  installRaf();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------- the loop */

describe('mounting a demo', () => {
  it('renders the exercise into a host, once, with the static props separated', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a1');
    expect(h).not.toBeNull();

    const svg = host.querySelector('svg.cd-svg');
    expect(svg).not.toBeNull();
    // the camera is per-demo now: a1 crops the stage around the bench
    expect(svg?.getAttribute('viewBox')).toBe('26 32 100 75');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('data-view')).toBe('side');
    expect(host.querySelector('.ex-demo')?.getAttribute('data-demo')).toBe('a1');
    // props painted once into their own group, the volumetric figure into the
    // live one, with its muscle patch and its own torso clip
    const live = svg?.querySelector('.cd-live')?.innerHTML ?? '';
    expect(svg?.querySelector('.cd-static')?.innerHTML).toContain('cd-arc');
    expect(live).toContain('cd-figure');
    expect(live).toContain('cd-hi');
    expect(live).toContain(`<clipPath id="${clipIdOf(demoFor('a1')!)}">`);
    h?.destroy();
  });

  it('names the working muscle under the picture', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'c2');
    const chip = host.querySelector('.cd-legend .cd-chip');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('ירך אחורית · ישבן');
    expect(chip?.textContent).toContain('זוקפי גב');
    // the chip is OUTSIDE the svg — it is text, and a screen reader should read
    // it as text rather than as part of the picture's label
    expect(host.querySelector('svg .cd-legend')).toBeNull();
    h?.destroy();
  });

  it('gives a custom exercise NOTHING — no element, no placeholder', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(mountExerciseDemo(host, `${CUSTOM_ID_PREFIX}abcd`)).toBeNull();
    expect(host.innerHTML).toBe('');
    expect(host.children).toHaveLength(0);
  });

  it('labels itself for a screen reader', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'b1', { label: 'הדגמת ביצוע: לחיצת חזה' });
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('הדגמת ביצוע: לחיצת חזה');
    h?.destroy();
  });
});

describe('the animation loop', () => {
  it('schedules frames, repaints the MOVING group only, and never the props', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a3');
    expect(h?.running()).toBe(true);

    const statics = host.querySelector('.cd-static')?.innerHTML ?? '';
    const first = host.querySelector('.cd-live')?.innerHTML ?? '';
    pump(0);
    pump(700); // a quarter of the way into the loop
    const later = host.querySelector('.cd-live')?.innerHTML ?? '';

    expect(later).not.toBe(first);
    expect(host.querySelector('.cd-static')?.innerHTML).toBe(statics);
    expect(h?.running()).toBe(true);
    h?.destroy();
  });

  it('caps the repaint rate instead of redrawing on every frame', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a3');
    pump(0);
    const painted = host.querySelector('.cd-live')?.innerHTML ?? '';
    pump(5); // 5ms later — below the 1/30s budget, so nothing is redrawn
    expect(host.querySelector('.cd-live')?.innerHTML).toBe(painted);
    pump(60);
    expect(host.querySelector('.cd-live')?.innerHTML).not.toBe(painted);
    h?.destroy();
  });

  it('cancels its pending frame and removes itself on destroy — no leak', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'b1');
    pump(0);
    expect(raf.frames.length).toBe(1); // one always in flight

    const before = raf.scheduled;
    h?.destroy();
    expect(raf.cancelled.length).toBe(1);
    expect(host.querySelector('.ex-demo')).toBeNull();
    expect(h?.running()).toBe(false);

    pump(100); // whatever was already queued must not reschedule
    expect(raf.scheduled).toBe(before);
  });

  it('is safe to destroy twice', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'b1');
    h?.destroy();
    h?.destroy();
    expect(raf.cancelled.length).toBeLessThanOrEqual(1);
  });

  it('lets go completely when its element leaves the document', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'b1');
    pump(0);
    const before = raf.scheduled;

    host.innerHTML = ''; // exactly what a screen re-render does
    pump(50);
    expect(raf.scheduled).toBe(before); // the loop stopped rather than spinning
    expect(h?.running()).toBe(false);
  });

  it('parks while the tab is hidden and picks the clock up again after', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'b1');
    pump(0);
    const painted = host.querySelector('.cd-live')?.innerHTML ?? '';

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h?.running()).toBe(false);
    pump(400);
    expect(host.querySelector('.cd-live')?.innerHTML).toBe(painted); // nothing moved

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h?.running()).toBe(true);
    h?.destroy();
  });
});

describe('the still', () => {
  it('paints the mid-rep pose and starts NO loop under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a3');
    expect(h).not.toBeNull();
    expect(h?.running()).toBe(false);
    expect(raf.scheduled).toBe(0);

    // …and what it shows is the far end of the rep, not the start
    const d = demoFor('a3');
    expect(d).not.toBeNull();
    const still = stillPose(d!);
    expect(still.y).toBeGreaterThan((d!.frames[0]?.y ?? 0) + 4);
    expect(host.querySelector('.cd-live')?.innerHTML).toContain('cd-figure');
    h?.destroy();
  });

  it('paints the same still when the host has no requestAnimationFrame at all', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a3');
    expect(h?.running()).toBe(false);
    expect(host.querySelector('.cd-live')?.innerHTML).toContain('cd-figure');
    h?.start(); // even asked directly, a still stays a still
    expect(h?.running()).toBe(false);
    h?.destroy();
  });

  it('survives a host whose matchMedia throws', () => {
    vi.stubGlobal('matchMedia', (() => {
      throw new Error('nope');
    }) as unknown as typeof window.matchMedia);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountExerciseDemo(host, 'a3');
    expect(h).not.toBeNull();
    h?.destroy();
  });
});

describe('the tempo', () => {
  it('lands exactly on the authored ends, and turns at forwardShare', () => {
    const d = demoFor('a3');
    expect(d).not.toBeNull();
    const last = (d!.frames.length - 1) as number;
    const start = poseAt(d!, 0);
    const turn = poseAt(d!, d!.loopMs * d!.forwardShare);
    expect(start.y).toBeCloseTo(d!.frames[0]?.y ?? 0, 6);
    expect(turn.y).toBeCloseTo(d!.frames[last]?.y ?? 0, 6);
    // and it wraps: a whole loop later is the same pose again
    expect(poseAt(d!, d!.loopMs).y).toBeCloseTo(start.y, 6);
    expect(poseAt(d!, -d!.loopMs).y).toBeCloseTo(start.y, 6);
  });

  it('gives the two halves of the rep DIFFERENT amounts of the clock', () => {
    // an RDL lowers slowly and drives up, so the bottom of the hinge arrives at
    // 60% of the loop and NOT at halfway — which is exactly what a symmetric
    // yoyo could never say.
    const d = demoFor('c2');
    expect(d).not.toBeNull();
    expect(d!.forwardShare).toBe(0.6);
    const bottom = d!.frames[d!.frames.length - 1]?.torso ?? 0;
    expect(poseAt(d!, d!.loopMs * 0.6).torso).toBeCloseTo(bottom, 6);
    expect(poseAt(d!, d!.loopMs * 0.5).torso).not.toBeCloseTo(bottom, 1);
    // …and a press is the other way round: it snaps up and lowers slowly
    const p = demoFor('a1');
    expect(p!.forwardShare).toBeLessThan(0.5);
    const top = p!.frames[p!.frames.length - 1]?.arm[0] ?? 0;
    expect(poseAt(p!, p!.loopMs * p!.forwardShare).arm[0]).toBeCloseTo(top, 6);
    expect(poseAt(p!, p!.loopMs * 0.5).arm[0]).not.toBeCloseTo(top, 1);
  });

  it('shows the MIDDLE of the movement when it cannot animate', () => {
    for (const id of ['a1', 'c2', 'c6']) {
      const d = demoFor(id);
      const still = stillPose(d!);
      const mid = Math.floor((d!.frames.length - 1) / 2);
      // three keyframes: the still IS the middle one
      if (d!.frames.length === 3) expect(still.torso).toBeCloseTo(d!.frames[mid]?.torso ?? 0, 6);
      // two keyframes: half way between them, never either end
      else {
        expect(still.torso).not.toBe(d!.frames[0]?.torso);
        expect(still.torso).not.toBe(d!.frames[1]?.torso);
      }
    }
  });
});

/* ---------------------------------------------------------- on the screen */

function mount(store: LocalStore): void {
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
}

function currentDay(store: LocalStore): BuiltInDayKey {
  const view = store.getState().ui.view;
  if (!isBuiltInDayKey(view)) throw new Error(`unexpected default view: ${view}`);
  return view;
}

function toggle(exId: string): void {
  document
    .querySelector<HTMLButtonElement>(`.form-toggle[data-toggle="${exId}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('the workout card', () => {
  it('shows no demo while the drawer is closed', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(0);
  });

  it('shows THIS exercise’s demo when its drawer opens, at the top of the panel', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);
    const view = currentDay(store);
    const ex = PROGRAM[view].exercises[1];
    if (!ex) throw new Error('no exercise');

    toggle(ex.id);
    const card = document.getElementById(`card-${ex.id}`);
    const demo = card?.querySelector('.ex-demo');
    expect(demo).not.toBeNull();
    expect(demo?.getAttribute('data-demo')).toBe(ex.id);
    // it is the FIRST thing in the drawer — picture, then the numbered steps
    expect(card?.querySelector('.form-panel')?.firstElementChild).toBe(demo);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(1);
  });

  it('takes the demo away again when the drawer closes', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);
    const ex = PROGRAM[currentDay(store)].exercises[0];
    if (!ex) throw new Error('no exercise');

    toggle(ex.id);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(1);
    const cancelled = raf.cancelled.length;
    toggle(ex.id);
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(0);
    expect(raf.cancelled.length).toBeGreaterThan(cancelled); // …and its loop with it
  });

  it('restores the demo of a drawer that was left open, on the next render', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);
    const ex = PROGRAM[currentDay(store)].exercises[0];
    if (!ex) throw new Error('no exercise');
    toggle(ex.id);
    expect(store.getState().ui.open[ex.id]).toBe(true);

    // re-mount the whole app onto the same store, exactly like a reload would
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    mount(store);
    expect(document.querySelector(`#card-${ex.id} .ex-demo`)).not.toBeNull();
  });

  it('gives a custom exercise no drawer and therefore no demo', () => {
    const store = new LocalStore(fakeStorage());
    const doc: PlanDoc = defaultPlanDoc();
    const customId = `${CUSTOM_ID_PREFIX}test01`;
    doc.customExercises = [
      { id: customId, he: 'גלגלת בטן', en: 'Ab wheel', equip: ['Bodyweight'], muscle: '', unit: 'חזרות', bodyPart: 'core' },
    ];
    doc.days = [makePlanDay('A', 'אימון A', [0, 1, 2, 3, 4, 5, 6], [{ id: customId, sets: 3, reps: '10', rest: 60 }])];
    const res = savePlan(store, doc);
    expect(res.ok).toBe(true);
    mount(store);

    const card = document.getElementById(`card-${customId}`);
    expect(card).not.toBeNull();
    expect(card?.querySelector('.form-toggle')).toBeNull();
    expect(card?.querySelector('.ex-demo')).toBeNull();
    expect(document.querySelectorAll('#main .ex-demo')).toHaveLength(0);
  });
});
