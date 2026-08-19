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

import { buyItem, gameOf } from '../src/core/game.ts';
import { emptyGame } from '../src/core/xp.ts';
import { BODY_PART_HE, PROGRAM } from '../src/data/program.ts';
import {
  EQUIPMENT_SLOTS,
  SLOT_EMOJI,
  SLOT_HE,
  WORLDS,
  WORLD_BOSSES,
  equipmentById,
} from '../src/data/gameContent.ts';
import { upgradeStepCost } from '../src/core/upgrades.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { queuePartPulse } from '../src/ui/character.ts';
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
    for (const slot of EQUIPMENT_SLOTS) {
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

    // דמות is the second tab of the 🎮 hub, so getting there is hub → tab.
    document
      .querySelector<HTMLButtonElement>('#tabs .hub[data-hub="GM"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    expect(document.querySelectorAll('#main .eq-slot')).toHaveLength(EQUIPMENT_SLOTS.length);
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

/* ------------------------------------------------------- shop & trophies */

describe('the coin shop on the דמות screen', () => {
  /** A character screen with `coins` in the purse. */
  function shopStore(coins: number, bosses: string[] = []): LocalStore {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      const g = emptyGame();
      g.battle.coins = coins;
      g.battle.bossesDefeated = [...bosses];
      g.battle.miniBossesCleared = 4;
      d.game = g;
      d.ui.view = 'CH';
    });
    return store;
  }

  function openSlot(slot: string): void {
    document
      .querySelector<HTMLButtonElement>(`[data-slot-toggle="${slot}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('shows one collapsible card per slot, with ≥40px controls', () => {
    mount(shopStore(0));
    const heads = [...document.querySelectorAll<HTMLElement>('.eq-head')];
    expect(heads).toHaveLength(EQUIPMENT_SLOTS.length);
    for (const slot of EQUIPMENT_SLOTS) {
      expect(document.querySelector(`[data-slot-toggle="${slot}"]`)?.textContent).toContain(SLOT_HE[slot]);
    }
    // the drawer starts closed; opening it lists the slot's items
    expect(document.querySelectorAll('.eq-item')).toHaveLength(0);
    openSlot('gloves');
    expect(document.querySelectorAll('.eq-item').length).toBeGreaterThanOrEqual(3);
  });

  it('buys an item, equips it, and shows it on the character SVG', () => {
    const item = equipmentById('belt_1');
    if (!item) throw new Error('missing belt_1');
    const store = shopStore(item.cost);
    mount(store);
    openSlot('belt');

    expect(document.querySelector('[data-slot="belt"]')?.innerHTML).toBe('');
    document
      .querySelector<HTMLButtonElement>('[data-buy="belt_1"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(gameOf(store).equipment.equipped['belt']).toBe('belt_1');
    expect(gameOf(store).battle.coins).toBe(0);
    // the SVG layer is now populated, at both scales the same builder is used
    expect(document.querySelector('[data-slot="belt"]')?.innerHTML).not.toBe('');
    expect(document.querySelector('[data-unequip="belt"]')).not.toBeNull();
  });

  it('disables what the player cannot afford and refuses the purchase', () => {
    const store = shopStore(0);
    mount(store);
    openSlot('cape');
    const btn = document.querySelector<HTMLButtonElement>('[data-buy="cape_1"]');
    expect(btn?.disabled).toBe(true);
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(gameOf(store).equipment.owned).toEqual([]);
    expect(store.getEvents().some((e) => e.type === 'coins_spent')).toBe(false);
  });

  /**
   * THE TWO SLOTS THE SHOP GREW BY, through the same drawer the other four use.
   * There is no bespoke code behind either of them — `shopCard` iterates
   * `EQUIPMENT_SLOTS` — so this walks the whole flow once per new slot to prove
   * the generic path really does cover them: open, buy, wear, draw, upgrade.
   */
  it('buys, wears, draws and upgrades a 👕 and a 🩳 through the ordinary drawer', () => {
    for (const [slot, id] of [
      ['shirt', 'shirt_1'],
      ['leggings', 'leggings_1'],
    ] as const) {
      const item = equipmentById(id);
      if (!item) throw new Error(`missing ${id}`);
      const store = shopStore(item.cost + upgradeStepCost(item.cost, 1));
      mount(store);
      // which drawer is open is view state that survives a re-render (and the
      // previous case), so ask rather than blind-click
      const head = document.querySelector<HTMLButtonElement>(`[data-slot-toggle="${slot}"]`);
      if (head?.getAttribute('aria-expanded') !== 'true') {
        head?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }

      // the drawer is titled in Hebrew and lists the slot's three tiers
      expect(document.querySelector(`[data-slot-toggle="${slot}"]`)?.textContent).toContain(SLOT_HE[slot]);
      expect(document.querySelector(`[data-slot-toggle="${slot}"]`)?.textContent).toContain(SLOT_EMOJI[slot]);
      expect(document.querySelectorAll('.eq-item')).toHaveLength(3);
      expect(document.querySelector(`[data-slot="${slot}"]`)?.innerHTML).toBe('');

      document
        .querySelector<HTMLButtonElement>(`[data-buy="${id}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(gameOf(store).equipment.equipped[slot]).toBe(id);
      expect(document.querySelector(`[data-slot="${slot}"]`)?.innerHTML).not.toBe('');
      expect(document.querySelector(`[data-unequip="${slot}"]`)).not.toBeNull();

      // …and the upgrade ladder is on it too, flair and all
      document
        .querySelector<HTMLButtonElement>(`[data-upgrade="${id}"]`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(gameOf(store).equipment.upgrades[id]).toBe(1);
      const worn = document.querySelector(`.char-stage [data-slot="${slot}"]`);
      expect(worn?.getAttribute('data-upgrade')).toBe('1');
      expect(worn?.querySelectorAll('.ch-spark').length ?? 0).toBeGreaterThan(0);
    }
  });

  it('counts all six slots in the shop header', () => {
    const store = shopStore(50_000);
    for (const slot of EQUIPMENT_SLOTS) buyItem(store, `${slot}_1`);
    mount(store);
    expect(document.querySelector('#shopCard .gc-sub')?.textContent).toContain(
      `${EQUIPMENT_SLOTS.length}/${EQUIPMENT_SLOTS.length}`,
    );
  });

  it('shows the trophy shelf with Hebrew boss and world names', () => {
    mount(shopStore(0, ['boss_w1', 'boss_w2']));
    const shelf = document.querySelector('.trophy-shelf');
    expect(shelf).not.toBeNull();
    expect(document.querySelectorAll('.trophy')).toHaveLength(2);
    expect(shelf?.textContent).toContain(WORLD_BOSSES[0]?.he ?? '');
    expect(shelf?.textContent).toContain(WORLDS[1]?.he ?? '');
    expect(document.querySelectorAll('.trophy .tr-svg')).toHaveLength(2);
    // the mini-boss count rides along, and medals appear on the character
    expect(document.querySelector('.game-card:last-of-type')?.textContent).toContain('4');
    expect(document.querySelectorAll('#main .ch-trophies .ch-medal')).toHaveLength(2);
  });
});

/* --------------------------------------------------- level-up celebration */

/**
 * The level-up celebration is two layers: the per-part `.pulse` the SVG builder
 * already emits, and a golden `drop-shadow` wash over the whole drawing that the
 * screen adds when there is something to celebrate. It is a FILTER, never a
 * palette change — `--ch-body` and friends are what a skin overrides, so writing
 * to them here would snap a robot or a ninja back to the default hero's blue.
 */
describe('level-up glow', () => {
  it('is absent on an ordinary visit to the דמות screen', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.view = 'CH';
    });
    mount(store);
    expect(document.querySelector('.char-stage .ch-svg.leveled')).toBeNull();
  });

  it('layers a glow on the drawing when a part levelled up, once', () => {
    const store = new LocalStore(fakeStorage());
    store.update((d) => {
      d.ui.view = 'CH';
    });
    const render = mount(store);

    queuePartPulse('chest');
    render();
    const svg = document.querySelector('.char-stage .ch-svg');
    expect(svg?.classList.contains('leveled')).toBe(true);
    // the part pulse still does its own thing, in the accent colour
    expect(document.querySelector('.char-stage [data-part="chest"]')?.classList).toContain('pulse');
    // …and the character's own palette is untouched by the celebration
    expect(svg?.getAttribute('style')).toContain('--ch-body:');

    // A celebration is a one-off: the next render is calm again.
    render();
    expect(document.querySelector('.char-stage .ch-svg.leveled')).toBeNull();
  });
});
