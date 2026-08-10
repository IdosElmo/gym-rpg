/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the דמות screen and the workout-screen game feedback:
 * the tab renders, the SVG proportions actually follow the body-part levels,
 * and checking a set produces an XP fly-up + an updated energy counter.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { gameOf } from '../src/core/game.ts';
import { emptyGame } from '../src/core/xp.ts';
import { BODY_PART_HE, PROGRAM } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { characterGeometry, characterSvg, growth } from '../src/ui/characterSvg.ts';
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

/* --------------------------------------------------------- SVG geometry */

describe('character SVG', () => {
  it('grows a body part only when its own level rises', () => {
    const base = characterGeometry(emptyGame().parts);
    const parts = emptyGame().parts;
    parts.chest.level = 12;
    const chesty = characterGeometry(parts);

    expect(chesty.chestHalf).toBeGreaterThan(base.chestHalf);
    expect(chesty.pecRx).toBeGreaterThan(base.pecRx);
    expect(chesty.thighW).toBe(base.thighW); // legs untouched
  });

  it('maps every part to the proportion the brief asks for', () => {
    const grow = (mut: (p: ReturnType<typeof emptyGame>['parts']) => void) => {
      const parts = emptyGame().parts;
      mut(parts);
      return characterGeometry(parts);
    };
    const base = characterGeometry(emptyGame().parts);

    expect(grow((p) => (p.shoulders.level = 12)).shoulderHalf).toBeGreaterThan(base.shoulderHalf);
    expect(grow((p) => (p.arms.level = 12)).armW).toBeGreaterThan(base.armW);
    expect(grow((p) => (p.legs.level = 12)).thighW).toBeGreaterThan(base.thighW);
    expect(grow((p) => (p.back.level = 12)).latFlare).toBeGreaterThan(base.latFlare);
    // core TIGHTENS the waist and sharpens the abs
    expect(grow((p) => (p.core.level = 12)).waistHalf).toBeLessThan(base.waistHalf);
    expect(grow((p) => (p.core.level = 12)).absOpacity).toBeGreaterThan(base.absOpacity);
  });

  it('clamps growth so a very high level stays charming', () => {
    expect(growth(1)).toBe(0);
    expect(growth(99)).toBe(1);
    const capped = emptyGame().parts;
    capped.chest.level = 99;
    const maxed = emptyGame().parts;
    maxed.chest.level = 15;
    expect(characterGeometry(capped).chestHalf).toBe(characterGeometry(maxed).chestHalf);
  });

  it('renders one labelled layer per body part plus the equipment slots', () => {
    const svg = characterSvg(emptyGame().parts, { pulse: ['chest'] });
    for (const part of ['chest', 'back', 'legs', 'shoulders', 'arms', 'core']) {
      expect(svg).toContain(`data-part="${part}"`);
    }
    for (const slot of ['cape', 'belt', 'gloves', 'shoes']) {
      expect(svg).toContain(`data-slot="${slot}"`);
    }
    expect(svg).toContain('ch-part pulse');
    expect(svg).not.toContain('NaN');
  });
});

/* ------------------------------------------------------- character screen */

describe('דמות screen', () => {
  it('is reachable from the nav and renders the character + six part bars', () => {
    const store = new LocalStore(fakeStorage());
    mount(store);

    const tab = document.querySelector<HTMLButtonElement>('.tab[data-view="CH"]');
    expect(tab?.textContent).toContain('דמות');
    tab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(store.getState().ui.view).toBe('CH');
    expect(document.querySelector('#main .ch-svg')).not.toBeNull();
    expect(document.querySelectorAll('#main .part-row')).toHaveLength(6);
    for (const he of Object.values(BODY_PART_HE)) {
      expect(document.querySelector('#main .parts')?.textContent).toContain(he);
    }
    // headline level + streak + the Phase 3 cards (shop + trophies), now real
    expect(document.querySelector('#main .char-level .cl-num')?.textContent).toBe('1');
    expect(document.querySelector('#main .streak-tier b')?.textContent).toBe('0');
    expect(document.querySelectorAll('#main .game-card.locked')).toHaveLength(0);
    expect(document.getElementById('shopCard')).not.toBeNull();
    expect(document.querySelectorAll('#main .eq-slot')).toHaveLength(4);
    expect(document.getElementById('header')?.textContent).toContain('הדמות שלי');
  });

  it('reflects earned XP in the bars and the headline level', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      const g = emptyGame();
      g.parts.chest.xp = 260; // level 3
      g.energy = 120;
      d.game = g;
      d.ui.view = 'CH';
    });
    mount(store);

    const chest = document.querySelector('#main .part-row[data-part="chest"]');
    expect(chest?.querySelector('.part-level')?.textContent).toBe('רמה 3');
    expect(chest?.querySelector<HTMLElement>('.part-bar span')?.style.width).not.toBe('0%');
    expect(document.querySelector('.energy-pill')?.textContent).toContain('120');
  });
});

/* ------------------------------------------------- workout screen feedback */

describe('workout screen XP feedback', () => {
  it('flies up an XP label per body part and bumps the energy counter', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.view = 'A';
    });
    mount(store);

    const exercise = PROGRAM.A.exercises[0];
    if (!exercise) throw new Error('no exercise');
    const chk = document.querySelector<HTMLButtonElement>(`.chk[data-ex="${exercise.id}"][data-set="0"]`);
    chk!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const flies = [...document.querySelectorAll('.xp-fly')].map((e) => e.textContent ?? '');
    expect(flies).toHaveLength(2); // chest 80% + arms 20%
    expect(flies[0]).toContain('XP');
    expect(flies[0]).toContain(BODY_PART_HE.chest);
    expect(document.querySelector('.energy-pill')?.textContent).toContain('10');
    expect(gameOf(store).totalXp).toBeGreaterThan(0);
  });

  it('does not fly up (or pay) again when a set is unchecked and re-checked', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.view = 'A';
    });
    mount(store);

    const exercise = PROGRAM.A.exercises[0];
    if (!exercise) throw new Error('no exercise');
    const chk = document.querySelector<HTMLButtonElement>(`.chk[data-ex="${exercise.id}"][data-set="0"]`);
    chk!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // check
    const xp = gameOf(store).totalXp;
    document.querySelectorAll('.xp-fly').forEach((e) => e.remove());

    chk!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // uncheck
    chk!.dispatchEvent(new MouseEvent('click', { bubbles: true })); // re-check

    expect(document.querySelectorAll('.xp-fly')).toHaveLength(0);
    expect(gameOf(store).totalXp).toBe(xp);
  });
});
