/**
 * @vitest-environment jsdom
 *
 * The arena's two new surfaces:
 *
 *   1. MOTION — the battle loop toggles short-lived classes on the hero and the
 *      enemy sprite (`.anim-attack`, `.anim-hit`, `.anim-hurt`, `.anim-die`,
 *      `.anim-super`, `.anim-victory`) and `styles/anim.css` animates them. The
 *      tests below drive the real loop and assert the classes, because the class
 *      is the contract between the loop and the stylesheet; and they assert the
 *      reduced-motion path leaves the DOM harmless rather than different.
 *   2. THE WORLD STRIP — the four worlds as nodes, with locked / current /
 *      boss-ready / champion states and the current world's wave progress.
 *
 * DRIVING TIME. The loop prefers `requestAnimationFrame` and falls back to
 * `setTimeout(…, tickMs)`. These tests delete rAF so the timer path runs, then
 * push time with vitest's fake timers — which is also what makes `Date.now()`
 * (the battle's session seed) deterministic here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { onSetCompleted } from '../src/core/game.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function ex(id: string): Exercise {
  const found = findExercise(id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(store: LocalStore): () => void {
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
  const app = createApp(store, timer);
  app.render();
  return app.render;
}

/** A store with energy in the bank and the קרב tab selected. */
function battleStore(sets = 12, level = 0): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  if (level > 0) {
    store.update((d) => {
      const g = d.game ?? emptyGame();
      for (const p of Object.keys(g.parts) as BodyPart[]) {
        g.parts[p].level = level;
        g.parts[p].xp = totalXpToReach(level) + 1;
      }
      d.game = g;
    });
  }
  store.update((d) => {
    d.ui.view = 'BT';
  });
  return store;
}

/** Take the setTimeout branch of the loop, and make time fake and steerable. */
function useSteerableClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-05-04T09:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', undefined);
}

const tap = (): void => {
  document.getElementById('btEnemy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const has = (id: string, cls: string): boolean =>
  document.getElementById(id)?.classList.contains(cls) === true;

/**
 * Push `ms` of fake time in small slices, reporting whether `cls` was ever on
 * `id`. The animation classes are removed again after a couple of hundred ms, so
 * a single long jump would step straight over them.
 */
function seenDuring(ms: number, id: string, cls: string, slice = 50): boolean {
  let seen = false;
  for (let t = 0; t < ms; t += slice) {
    vi.advanceTimersByTime(slice);
    if (has(id, cls)) seen = true;
  }
  return seen;
}

/* ------------------------------------------------------------------ motion */

describe('battle animations', () => {
  it('lunges the hero and flashes the enemy on every attack', () => {
    mount(battleStore());
    expect(has('btHeroSprite', 'anim-attack')).toBe(false);

    tap();
    expect(has('btHeroSprite', 'anim-attack')).toBe(true);
    expect(has('btEnemySprite', 'anim-hit')).toBe(true);
  });

  it('takes the animation classes off again, so nothing is left mid-pose', () => {
    useSteerableClock();
    mount(battleStore());
    tap();
    expect(has('btEnemySprite', 'anim-hit')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(has('btHeroSprite', 'anim-attack')).toBe(false);
    expect(has('btEnemySprite', 'anim-hit')).toBe(false);
  });

  it('restarts the class on a second hit instead of swallowing it', () => {
    useSteerableClock();
    mount(battleStore());
    tap();
    vi.advanceTimersByTime(BALANCE.combat.tap.minIntervalMs + 100);
    tap();
    expect(has('btEnemySprite', 'anim-hit')).toBe(true);
  });

  it('flinches the hero when the enemy lands a hit', () => {
    useSteerableClock();
    mount(battleStore());
    // The world-1 enemy swings every 1800ms — a few seconds is several hits.
    expect(seenDuring(5000, 'btHeroSprite', 'anim-hurt')).toBe(true);
  });

  it('lunges the enemy when it attacks', () => {
    useSteerableClock();
    mount(battleStore());
    expect(seenDuring(5000, 'btEnemySprite', 'anim-attack')).toBe(true);
  });

  it('collapses the enemy on a cleared wave, and the next one spawns clean', () => {
    useSteerableClock();
    // A very strong character one-shots the wave-1 enemy with a single tap.
    mount(battleStore(24, 40));
    tap();
    expect(has('btEnemySprite', 'anim-die')).toBe(true);

    // The collapse has to be over before the successor takes the same node.
    expect(BALANCE.combat.spawnDelayMs).toBeGreaterThan(360);
    vi.advanceTimersByTime(BALANCE.combat.spawnDelayMs + 200);
    expect(has('btEnemySprite', 'anim-die')).toBe(false);
    expect(document.querySelector('#btEnemySprite svg')).not.toBeNull();
  });

  it('poses the hero when the super move is released', () => {
    useSteerableClock();
    mount(battleStore(60, 6));
    const superBtn = document.getElementById('btSuper') as HTMLButtonElement;
    // Tap until the meter is full AND an enemy is actually up: a tap that lands
    // in the spawn gap between waves is refused, so the count is a floor.
    for (let i = 0; i < 60 && superBtn.disabled; i += 1) {
      tap();
      vi.advanceTimersByTime(BALANCE.combat.tap.minIntervalMs + 100);
    }
    expect(superBtn.disabled).toBe(false);

    superBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(has('btHeroSprite', 'anim-super')).toBe(true);
  });

  it('flexes the hero when a world boss falls', () => {
    useSteerableClock();
    const store = battleStore(60, 40);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.battle.wave = BALANCE.combat.wavesPerWorld + 1;
      d.game = g;
    });
    mount(store);
    // The gate is wide open at level 40, so the boss fight starts by itself.
    expect(document.getElementById('btArena')?.classList.contains('boss-fight')).toBe(true);
    expect(seenDuring(30_000, 'btHeroSprite', 'anim-victory', 100)).toBe(true);
  });
});

describe('reduced motion', () => {
  it('skips the screen shake but leaves the animation classes harmless', () => {
    vi.stubGlobal('matchMedia', ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia);

    mount(battleStore());
    tap();
    // The shake is guarded in JS (it moves the whole card, not one sprite)…
    expect(document.getElementById('btArena')?.classList.contains('shake')).toBe(false);
    // …while the sprite markers still go on: the global
    // `prefers-reduced-motion` rule switches their keyframes off, and every one
    // of them rests at the identity transform, so the DOM is merely labelled.
    expect(has('btHeroSprite', 'anim-attack')).toBe(true);
    expect(has('btEnemySprite', 'anim-hit')).toBe(true);
    // and the hero is still drawn, not hidden by a suppressed animation
    expect(document.querySelector('#btHeroSprite .ch-svg')).not.toBeNull();
  });
});
