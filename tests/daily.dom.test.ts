/**
 * @vitest-environment jsdom
 *
 * The daily challenge ON SCREEN: the card's four states, the framing of a live
 * run, the result flow, and the two ways a run can end without the player
 * winning — a knock-out and walking out of the arena.
 *
 * DRIVING A WHOLE RUN. The arena loop uses `requestAnimationFrame` when there is
 * one and falls back to `setTimeout` otherwise — so these tests take the rAF
 * away (see `beforeEach`) and drive the fallback with fake timers: every
 * callback feeds the simulation exactly one fixed tick, which is what a real
 * frame does. That makes a two-minute gauntlet a few milliseconds of test, with
 * the real engine, the real UI and no shortcuts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { dailyChallenge } from '../src/core/daily.ts';
import { gameOf, onSetCompleted } from '../src/core/game.ts';
import { todayISO } from '../src/core/workout.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';

const WAVES = BALANCE.daily.waves;
const FEE = BALANCE.daily.entryEnergy;

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

type Raf = typeof globalThis.requestAnimationFrame;
const realRaf: Raf = globalThis.requestAnimationFrame;
const rafHost = globalThis as { requestAnimationFrame?: Raf };

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  // jsdom's rAF runs on real time and would ignore the fake clock; without it
  // the loop takes the `setTimeout` path, which the fake timers own.
  delete rafHost.requestAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  rafHost.requestAnimationFrame = realRaf;
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

/** A store on the קרב tab with `sets × 10` ⚡ in the bank, at part level `level`. */
function battleStore(sets = 6, level = 1): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  store.update((d) => {
    d.ui.view = 'BT';
    if (level > 1) {
      const g = d.game ?? emptyGame();
      for (const p of BODY_PARTS) {
        g.parts[p as BodyPart].xp = totalXpToReach(level) + 1;
        g.parts[p as BodyPart].level = level;
      }
      d.game = g;
    }
  });
  return store;
}

const card = (): HTMLElement | null => document.querySelector<HTMLElement>('#btDaily .dc');
const cardState = (): string => card()?.dataset['state'] ?? '';
const goBtn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('#btDailyGo');
const click = (el: Element | null): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const dailyEvents = (store: LocalStore): readonly AppEvent[] =>
  store.getEvents().filter((e) => e.type === 'daily_challenge');

/**
 * Drive the loop until the run has ended, and no further: the ordinary battle
 * takes the arena back a beat later, and it would spend energy of its own.
 */
function advanceUntilDone(limitMs = 600_000): void {
  for (let t = 0; t < limitMs && cardState() === 'live'; t += 2_000) vi.advanceTimersByTime(2_000);
  expect(cardState()).toBe('done');
}

describe('the daily challenge card', () => {
  it('sits under the world strip and advertises today’s gauntlet', () => {
    mount(battleStore());
    const el = card();
    expect(el).not.toBeNull();
    expect(cardState()).toBe('available');
    expect(el?.textContent).toContain('אתגר יומי');
    // The preview shows real sprites from the real gauntlet of today.
    const foes = document.querySelectorAll('#btDaily .dc-foe svg');
    expect(foes.length).toBe(WAVES / 2);
    expect(document.querySelector('#btDaily .dc-foe.mini')).not.toBeNull();
    // The fee is stated on the button itself, and the button is a real target.
    const btn = goBtn();
    expect(btn?.textContent).toContain(`${FEE} ⚡`);
    expect(btn?.tagName).toBe('BUTTON');
    expect(el?.textContent).toContain(`${WAVES} גלים`);
  });

  it('locks — and explains what to train — when the energy is short', () => {
    const store = battleStore(2); // 20 ⚡, the fee is 30
    mount(store);
    expect(cardState()).toBe('locked');
    expect(card()?.textContent).toContain('להתאמן');
    expect(goBtn()?.textContent).toContain('🔒');

    click(goBtn());
    expect(document.getElementById('toast')?.textContent).toContain('אנרגיה');
    // Nothing was written and no run started.
    expect(dailyEvents(store)).toHaveLength(0);
    expect(document.getElementById('btArena')?.classList.contains('challenge')).toBe(false);
  });

  it('frames the run in amber, counts the waves and emits no wave_cleared', () => {
    const store = battleStore(6, 6);
    mount(store);
    click(goBtn());

    expect(cardState()).toBe('live');
    expect(document.querySelector('.bt-card')?.classList.contains('challenge')).toBe(true);
    expect(document.getElementById('btArena')?.classList.contains('challenge')).toBe(true);
    expect(document.getElementById('btWave')?.textContent).toBe(`1/${WAVES}`);
    expect(card()?.textContent).toContain(`גל 1/${WAVES}`);
    const status = document.getElementById('btStatus');
    expect(status?.textContent).toContain('אתגר יומי');
    expect(status?.classList.contains('daily')).toBe(true);
    // A real enemy from the gauntlet is up.
    const gauntlet = dailyChallenge(todayISO());
    expect(document.getElementById('btFoeName')?.textContent).toContain(gauntlet.waves[0]?.he ?? '');
    // The fight itself writes nothing — not even the wave it just cleared.
    expect(store.getEvents().some((e) => e.type === 'wave_cleared')).toBe(false);
    expect(dailyEvents(store)).toHaveLength(0);
  });

  it('records ONE event when the run ends, pays once and flips the card to done', () => {
    vi.useFakeTimers();
    const store = battleStore(6, 4); // enough ⚡, too weak to finish
    mount(store);
    const energyBefore = gameOf(store).energy;
    click(goBtn());
    advanceUntilDone();

    const events = dailyEvents(store);
    expect(events).toHaveLength(1);
    const p = events[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(
      ['complete', 'coins', 'date', 'durationMs', 'energySpent', 'outcome', 'score', 'seed', 'tiebreak', 'wavesCleared'].sort(),
    );
    expect(p['date']).toBe(todayISO());
    expect(p['outcome']).toBe('defeated');
    expect(p['energySpent']).toBe(FEE);

    const game = gameOf(store);
    expect(game.energy).toBe(energyBefore - FEE);
    expect(game.battle.coins).toBe(Number(p['coins']));
    expect(game.daily.attempts).toBe(1);
    // The campaign was not touched by the run.
    expect(game.battle.wavesCleared).toBe(0);
    expect(game.battle.wave).toBe(1);

    // The card now says "done", with the score and the purse…
    expect(card()?.textContent).toContain(`${Number(p['score'])}/${WAVES}`);
    expect(card()?.textContent).toContain(`+${Number(p['coins'])} 🪙`);
    expect(card()?.textContent).toContain('מחר יש אתגר חדש');
    expect(goBtn()).toBeNull();
    // …and a beat later the arena is the ordinary battle again: no amber frame,
    // and a plain world wave counter instead of the gauntlet's "3/10".
    vi.advanceTimersByTime(4_000);
    expect(document.getElementById('btArena')?.classList.contains('challenge')).toBe(false);
    expect(document.querySelector('.bt-card')?.classList.contains('challenge')).toBe(false);
    expect(document.getElementById('btWave')?.textContent).not.toContain('/');
  });

  it('shows the toast with the score and the coins', () => {
    vi.useFakeTimers();
    const store = battleStore(6, 4);
    mount(store);
    click(goBtn());
    advanceUntilDone();
    const score = Number(dailyEvents(store)[0]?.payload['score']);
    expect(document.getElementById('toast')?.textContent).toContain(`${score}/${WAVES}`);
    expect(document.getElementById('toast')?.textContent).toContain('🪙');
  });

  it('refuses a second run on the same day, and says why', () => {
    vi.useFakeTimers();
    const store = battleStore(12, 4);
    mount(store);
    click(goBtn());
    advanceUntilDone();

    // Re-mounting the screen must not offer the challenge again.
    const render = mount(store);
    render();
    expect(cardState()).toBe('done');
    expect(goBtn()).toBeNull();
    expect(dailyEvents(store)).toHaveLength(1);
  });

  it('forfeits — once — when the player leaves the arena mid-run', () => {
    vi.useFakeTimers();
    const store = battleStore(6, 6);
    mount(store);
    click(goBtn());
    vi.advanceTimersByTime(30_000);
    expect(cardState()).toBe('live');
    expect(dailyEvents(store)).toHaveLength(0);

    // Leaving the arena is the forfeit.
    click(document.querySelector('#tabs .tab[data-view="CH"]'));
    const events = dailyEvents(store);
    expect(events).toHaveLength(1);
    const p = events[0]?.payload ?? {};
    expect(p['outcome']).toBe('forfeit');
    expect(p['complete']).toBe(false);
    expect(p['energySpent']).toBe(FEE);

    // Exactly the waves that were cleared were paid — never the bonus.
    const gauntlet = dailyChallenge(todayISO());
    const cleared = Number(p['wavesCleared']);
    const earned = gauntlet.waves.slice(0, cleared).reduce((a, w) => a + w.coins, 0);
    expect(Number(p['coins'])).toBe(earned);
    expect(Number(p['coins'])).toBeLessThan(gauntlet.maxCoins);
    expect(gameOf(store).battle.coins).toBe(earned);

    // And the attempt is spent: going back to the arena shows the done card.
    click(document.querySelector('#tabs .tab[data-view="BT"]'));
    expect(cardState()).toBe('done');
    expect(dailyEvents(store)).toHaveLength(1);
  });

  it('leaks nothing when the tab is merely backgrounded mid-run', () => {
    vi.useFakeTimers();
    const store = battleStore(6, 6);
    mount(store);
    click(goBtn());
    vi.advanceTimersByTime(20_000);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(20_000);
    // Backgrounding pauses; it does not forfeit and it does not pay.
    expect(dailyEvents(store)).toHaveLength(0);
    expect(gameOf(store).battle.coins).toBe(0);
    expect(cardState()).toBe('live');
  });
});
