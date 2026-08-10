/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the קרב screen: the tab exists between דמות and היסטוריה, the
 * arena renders (character vs enemy, both HP bars, energy, wave, super meter,
 * world name), tapping the enemy hurts it, and leaving the tab stops the loop.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { gameOf, onSetCompleted } from '../src/core/game.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { ENEMIES, WORLDS, WORLD_BOSSES } from '../src/data/gameContent.ts';
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
function battleStore(sets = 12): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  store.update((d) => {
    d.ui.view = 'BT';
  });
  return store;
}

describe('battle tab', () => {
  it('sits between דמות and היסטוריה in the nav', () => {
    mount(new LocalStore(fakeStorage()));
    const views = [...document.querySelectorAll<HTMLElement>('#tabs .tab')].map((t) => t.dataset['view']);
    expect(views).toEqual(['A', 'B', 'C', 'CH', 'BT', 'H']);
    const battleTab = document.querySelector('#tabs .tab[data-view="BT"]');
    expect(battleTab?.textContent).toContain('קרב');
    expect(battleTab?.classList.contains('active')).toBe(false);
  });

  it('switches to the arena when the tab is clicked', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);
    document
      .querySelector<HTMLButtonElement>('#tabs .tab[data-view="BT"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.getState().ui.view).toBe('BT');
    expect(document.getElementById('btArena')).not.toBeNull();
  });

  it('renders the arena: hero, enemy, both HP bars, energy, wave, super meter, world', () => {
    const store = battleStore();
    mount(store);

    expect(document.querySelector('#btArena .bt-sprite.hero .ch-svg')).not.toBeNull();
    expect(document.querySelector('#btEnemySprite svg')).not.toBeNull();
    expect(document.getElementById('btHeroHp')).not.toBeNull();
    expect(document.getElementById('btFoeHp')).not.toBeNull();
    expect(document.getElementById('btSuperBar')).not.toBeNull();
    expect(document.getElementById('btEnergyBar')).not.toBeNull();
    expect(document.getElementById('btWave')?.textContent).toBe('1');
    expect(document.getElementById('btEnergy')?.textContent).toBe(
      String(gameOf(store).energy),
    );
    expect(document.querySelector('.bt-world b')?.textContent).toBe(WORLDS[0]?.he);
    // the header follows the battle too
    expect(document.querySelector('#header .app-title')?.textContent).toContain('קרב');
    // touch target for the enemy button
    expect(document.getElementById('btEnemy')?.tagName).toBe('BUTTON');
  });

  it('hurts the enemy when it is tapped and charges the super meter', () => {
    mount(battleStore());
    const foeBar = document.getElementById('btFoeHp') as HTMLElement;
    expect(foeBar.style.width).toBe('100%');
    document.getElementById('btEnemy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(parseFloat(foeBar.style.width)).toBeLessThan(100);
    expect(document.getElementById('btSuperPct')?.textContent).toBe(
      `${Math.round(BALANCE.combat.tap.superPerTap * 100)}%`,
    );
    expect(document.querySelector('#btFx .bt-float')).not.toBeNull();
  });

  it('tells the player to go and train when the energy runs out', () => {
    mount(battleStore(0));
    const status = document.getElementById('btStatus');
    expect(status?.textContent).toContain('אין מספיק אנרגיה');
    expect(status?.textContent).toContain('להתאמן');
    expect(status?.classList.contains('rest')).toBe(true);
  });

  it('shows the world-boss gate with its unmet training requirements', () => {
    mount(battleStore(0));
    const gate = document.querySelector('.bt-gate');
    expect(gate?.classList.contains('locked')).toBe(true);
    expect(document.querySelectorAll('.bt-reqs li.unmet').length).toBeGreaterThan(0);
    expect(gate?.textContent).toContain('חזה');
  });

  it('has a well-formed, self-contained SVG sprite for every enemy and boss', () => {
    const parser = new DOMParser();
    for (const def of [...ENEMIES, ...WORLD_BOSSES]) {
      const doc = parser.parseFromString(def.svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror'), `${def.id} sprite is not valid XML`).toBeNull();
      expect(doc.documentElement.tagName).toBe('svg');
      expect(def.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // offline rule
      expect(def.he.length).toBeGreaterThan(1);
    }
  });

  it('stops the loop when another tab is opened', () => {
    const store = battleStore();
    const render = mount(store);
    // the visibility listener is the loop's lifeline; after leaving the tab the
    // screen is gone and no further battle DOM exists to update
    store.update((d) => {
      d.ui.view = 'CH';
    });
    render();
    expect(document.getElementById('btArena')).toBeNull();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.getElementById('btArena')).toBeNull();
  });
});
