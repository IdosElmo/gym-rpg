/**
 * @vitest-environment jsdom
 *
 * The equipment upgrades ON SCREEN: the shop row's +N badge and ⬆ שדרוג button
 * (happy · broke · maxed), the stat grid moving the instant a level is bought,
 * the feed line — and the artwork sweep this app applies to everything it ships:
 * every flair level, on every item, on every body × skin combination, has to be
 * valid, self-contained, in-stage SVG.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { buyItem, gameOf, upgradeItem } from '../src/core/game.ts';
import { emptyGame, statsOfGame } from '../src/core/xp.ts';
import { MAX_UPGRADE_LEVEL, upgradeStepCost, upgradeTotalCost } from '../src/core/upgrades.ts';
import { CHARACTERS } from '../src/data/characters.ts';
import { EQUIPMENT, equipmentById } from '../src/data/gameContent.ts';
import type { BodyPart } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { characterSvg } from '../src/ui/characterSvg.ts';
import { buildFeed } from '../src/ui/feed.ts';
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

/** A דמות screen with `coins` in the purse and `owned` already bought+worn. */
function shopStore(coins: number, owned: string[] = []): LocalStore {
  const store = new LocalStore(fakeStorage());
  store.update((d) => {
    const g = emptyGame();
    g.battle.coins = coins;
    d.game = g;
    d.ui.view = 'CH';
  });
  for (const id of owned) buyItem(store, id);
  return store;
}

function click(el: Element | null): void {
  if (!el) throw new Error('missing element');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Open a slot's drawer. Which drawer is open is view state that deliberately
 * survives a re-render (`ui/character.ts`), and therefore also survives from one
 * test to the next — so this asks whether it is already open instead of
 * blind-clicking, which would close it.
 */
function openSlot(slot: string): void {
  const head = document.querySelector<HTMLButtonElement>(`[data-slot-toggle="${slot}"]`);
  if (!head) throw new Error(`no slot ${slot}`);
  if (head.getAttribute('aria-expanded') !== 'true') click(head);
}

/** The stat grid's six numbers, as they read on screen right now. */
function statValues(): string[] {
  return [...document.querySelectorAll('.stat-grid .stat b')].map((b) => b.textContent?.trim() ?? '');
}

/* ---------------------------------------------------------- the artwork */

describe('upgrade flair on the character', () => {
  const parser = new DOMParser();

  function partsAt(level: number): ReturnType<typeof emptyGame>['parts'] {
    const parts = emptyGame().parts;
    for (const p of Object.keys(parts) as BodyPart[]) parts[p].level = level;
    return parts;
  }

  function draw(characterId: string, itemId: string, level: number, bodyLevel: number): string {
    const item = equipmentById(itemId);
    if (!item) throw new Error(`no item ${itemId}`);
    return characterSvg(partsAt(bodyLevel), {
      character: characterId,
      equipment: { owned: [itemId], equipped: { [item.slot]: itemId }, upgrades: { [itemId]: level } },
    });
  }

  /**
   * THE SWEEP. The flair is placed from the character's own anchors, so it has
   * to fit all ten body × skin combinations, all twelve items and every level —
   * at the two extremes of the growth curve, which is where a hand-placed
   * ornament would drift off the body or out of the stage.
   */
  it('draws every level of every item on every body × skin as valid SVG', () => {
    for (const c of CHARACTERS) {
      for (const item of EQUIPMENT) {
        for (const level of [1, MAX_UPGRADE_LEVEL]) {
          for (const bodyLevel of [1, 99]) {
            const svg = draw(c.id, item.id, level, bodyLevel);
            const doc = parser.parseFromString(svg, 'image/svg+xml');
            expect(
              doc.querySelector('parsererror'),
              `${c.id} + ${item.id} +${level} @L${bodyLevel} is not valid XML`,
            ).toBeNull();
            expect(svg, `${c.id} + ${item.id} +${level}`).not.toContain('NaN');
            expect(svg).not.toContain('undefined');
            expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // offline rule
            const worn = doc.querySelector(`[data-slot="${item.slot}"]`);
            expect(worn?.getAttribute('data-upgrade'), `${c.id} + ${item.id}`).toBe(String(level));
            expect(worn?.classList.contains(`up-${level}`)).toBe(true);
            expect(worn?.querySelectorAll('.ch-spark').length ?? 0).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('keeps every flair coordinate inside the 200×320 stage', () => {
    const geoAttrs = ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'd'];
    for (const c of CHARACTERS) {
      for (const item of EQUIPMENT) {
        for (const bodyLevel of [1, 99]) {
          const doc = parser.parseFromString(
            draw(c.id, item.id, MAX_UPGRADE_LEVEL, bodyLevel),
            'image/svg+xml',
          );
          for (const el of doc.querySelectorAll('.ch-spark, .ch-up-badge *')) {
            for (const attr of geoAttrs) {
              const raw = el.getAttribute(attr);
              if (raw === null) continue;
              for (const token of raw.match(/-?\d+(\.\d+)?/g) ?? []) {
                const v = Number(token);
                expect(Number.isFinite(v), `${c.id} ${item.id} <${el.tagName} ${attr}>`).toBe(true);
                expect(v, `${c.id} ${item.id} flair at ${v}`).toBeGreaterThan(-10);
                expect(v, `${c.id} ${item.id} flair at ${v}`).toBeLessThan(340);
              }
            }
          }
        }
      }
    }
  });

  /**
   * The treatment is a LADDER, not three drawings: +1 is one glint, +2 lights
   * every point of the item and turns the glow on, +3 adds the star badge.
   */
  it('escalates the treatment level by level, and adds the badge only at +3', () => {
    for (const item of EQUIPMENT) {
      const sparks = (level: number): number => {
        const doc = parser.parseFromString(draw('hero_m', item.id, level, 8), 'image/svg+xml');
        return doc.querySelectorAll(`[data-slot="${item.slot}"] .ch-spark`).length;
      };
      const badges = (level: number): number => {
        const doc = parser.parseFromString(draw('hero_m', item.id, level, 8), 'image/svg+xml');
        return doc.querySelectorAll(`[data-slot="${item.slot}"] .ch-up-badge`).length;
      };
      expect(sparks(1), `${item.id} +1`).toBe(1);
      expect(sparks(2), `${item.id} +2`).toBeGreaterThanOrEqual(sparks(1));
      expect(badges(1)).toBe(0);
      expect(badges(2)).toBe(0);
      expect(badges(3), `${item.id} +3 badge`).toBe(1);
    }
  });

  /**
   * THE GLOW IS SVG, NOT CSS — and this is the test that keeps it that way.
   *
   * It used to be `filter:drop-shadow(0 0 Npx var(--up-glow))` in
   * `styles/character.css`. On a Galaxy S24 that rendered as a black blob: a
   * `var()` inside a `filter` function is not reliably resolved there, and an
   * unresolved colour falls back to black. So the colour is now baked into an
   * `<feDropShadow>` at render time — the item's accent, spelled out — and the
   * assertions below are exactly the three properties that bug violated:
   * an explicit colour, ONE shadow per item (two compound into a floodlight),
   * and a small radius.
   */
  it('glows from an SVG filter in the ITEM\'s own accent, and only from +2 up', () => {
    for (const item of EQUIPMENT) {
      const doc = (level: number): Document =>
        parser.parseFromString(draw('hero_f', item.id, level, 6), 'image/svg+xml');
      const group = (level: number): Element | null =>
        doc(level).querySelector(`[data-slot="${item.slot}"]`);

      // +1 is the bare glint: nothing is filtered at all.
      expect(group(1)?.getAttribute('filter'), `${item.id} +1`).toBeNull();
      expect(draw('hero_f', item.id, 1, 6)).not.toContain('feDropShadow');

      for (const level of [2, 3]) {
        const d = doc(level);
        const worn = d.querySelector(`[data-slot="${item.slot}"]`);
        expect(worn?.classList.contains(`up-${level}`), `${item.id} +${level}`).toBe(true);
        const ref = worn?.getAttribute('filter') ?? '';
        expect(ref, `${item.id} +${level} filter`).toMatch(/^url\(#[\w-]+\)$/);
        expect(ref).not.toContain('var(');

        // …and the reference resolves, inside this very drawing, to ONE shadow
        // whose colour is the item's accent spelled out in full.
        const id = ref.slice(5, -1);
        const filter = d.getElementById(id) ?? d.querySelector(`filter[id="${id}"]`);
        expect(filter, `${item.id} +${level}: no <filter id="${id}">`).not.toBeNull();
        const shadows = [...(filter?.children ?? [])];
        expect(shadows).toHaveLength(1); // never stacked — a glint, not a floodlight
        expect(shadows[0]?.tagName).toBe('feDropShadow');
        expect(shadows[0]?.getAttribute('flood-color')).toBe(item.accent);
        expect(shadows[0]?.getAttribute('flood-color')).not.toContain('var(');
        // bounded: a small blur in user units, at a moderate opacity
        expect(Number(shadows[0]?.getAttribute('stdDeviation'))).toBeGreaterThan(0);
        expect(Number(shadows[0]?.getAttribute('stdDeviation'))).toBeLessThanOrEqual(2);
        expect(Number(shadows[0]?.getAttribute('flood-opacity'))).toBeLessThanOrEqual(0.7);
      }

      // The stronger level is stronger — but only by a little.
      const blur = (level: number): number =>
        Number(doc(level).querySelector('feDropShadow')?.getAttribute('stdDeviation'));
      expect(blur(3)).toBeGreaterThan(blur(2));
      expect(blur(3)).toBeLessThan(blur(2) * 2);

      // …and the whole drawing still carries no absolute pixel: the glow is in
      // user units, so it is the same fraction of the body at 220px and at 62px.
      expect(draw('hero_f', item.id, 3, 6)).not.toMatch(/\d(px|pt|em)/);
    }
  });

  /** Two upgraded slots are two groups, so nothing can compound into a blob. */
  it('gives each upgraded slot its own bounded filter, never a shared stack', () => {
    const svg = characterSvg(partsAt(9), {
      equipment: {
        owned: ['belt_3', 'gloves_2', 'shoes_1'],
        equipped: { belt: 'belt_3', gloves: 'gloves_2', shoes: 'shoes_1' },
        upgrades: { belt_3: 3, gloves_2: 2, shoes_1: 1 },
      },
    });
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const refs = [...doc.querySelectorAll('[data-slot]')].map((g) => g.getAttribute('filter'));
    expect(refs.filter(Boolean)).toHaveLength(2); // +3 and +2; the +1 shoe glows not
    expect(new Set(refs.filter(Boolean)).size).toBe(2); // and never the same one twice
    expect(doc.querySelectorAll('feDropShadow')).toHaveLength(2);
    // every definition lives in the drawing's single <defs>, next to the gradient
    expect(doc.querySelectorAll('defs')).toHaveLength(1);
    expect(doc.querySelectorAll('defs feDropShadow')).toHaveLength(2);
  });

  it('leaves an un-upgraded character byte-identical to what it always drew', () => {
    const parts = partsAt(7);
    const worn = { owned: ['belt_2'], equipped: { belt: 'belt_2' } };
    const plain = characterSvg(parts, { equipment: worn });
    expect(characterSvg(parts, { equipment: { ...worn, upgrades: {} } })).toBe(plain);
    expect(characterSvg(parts, { equipment: { ...worn, upgrades: { belt_2: 0 } } })).toBe(plain);
    // an upgrade on an item that is NOT worn changes nothing either
    expect(characterSvg(parts, { equipment: { ...worn, upgrades: { gloves_3: 3 } } })).toBe(plain);
    expect(plain).not.toContain('upgraded');
    expect(plain).not.toContain('ch-spark');
  });
});

/* ------------------------------------------------------------- the shop */

describe('the upgrade control in the shop', () => {
  it('shows +0 on an owned item and buys a level for its listed price', () => {
    const gloves = equipmentById('gloves_1');
    if (!gloves) throw new Error('missing gloves_1');
    const store = shopStore(gloves.cost + 5_000, [gloves.id]);
    mount(store);
    openSlot('gloves');

    const badge = document.querySelector('[data-level="gloves_1"]');
    expect(badge?.textContent?.trim()).toBe('+0');
    const btn = document.querySelector<HTMLButtonElement>('[data-upgrade="gloves_1"]');
    expect(btn?.disabled).toBe(false);
    expect(btn?.textContent).toContain('שדרוג');
    expect(btn?.textContent).toContain(String(upgradeStepCost(gloves.cost, 1)));

    const coins = gameOf(store).battle.coins;
    click(btn);

    expect(gameOf(store).equipment.upgrades).toEqual({ gloves_1: 1 });
    expect(gameOf(store).battle.coins).toBe(coins - upgradeStepCost(gloves.cost, 1));
    // the drawer stays open across the re-render, and the badge moved
    expect(document.querySelector('[data-level="gloves_1"]')?.textContent).toContain('+1');
    expect(document.querySelector('[data-level="gloves_1"]')?.textContent).toContain('⭐');
    // the worn line in the slot header quotes the level too
    expect(document.querySelector('[data-slot-toggle="gloves"] .eq-worn')?.textContent).toContain('+1');
  });

  it('moves the stat grid and the drawing in the same render', () => {
    const store = shopStore(9_000, ['gloves_2']);
    mount(store);
    openSlot('gloves');
    const before = statValues();
    const atkBefore = statsOfGame(gameOf(store)).atk;
    expect(document.querySelector('[data-slot="gloves"]')?.getAttribute('data-upgrade')).toBeNull();

    click(document.querySelector('[data-upgrade="gloves_2"]'));

    expect(statsOfGame(gameOf(store)).atk).toBeGreaterThan(atkBefore);
    expect(statValues()).not.toEqual(before); // the grid re-rendered with it
    expect(statValues()[0]).toBe(String(statsOfGame(gameOf(store)).atk));
    // …and the character is now wearing the flair
    const worn = document.querySelector('.char-stage [data-slot="gloves"]');
    expect(worn?.getAttribute('data-upgrade')).toBe('1');
    expect(worn?.querySelectorAll('.ch-spark').length ?? 0).toBeGreaterThan(0);
  });

  it('disables the upgrade when the purse is short, says how much, and writes nothing', () => {
    const cape = equipmentById('cape_2');
    if (!cape) throw new Error('missing cape_2');
    const short = 40;
    const store = shopStore(cape.cost + upgradeStepCost(cape.cost, 1) - short, [cape.id]);
    mount(store);
    openSlot('cape');

    const btn = document.querySelector<HTMLButtonElement>('[data-upgrade="cape_2"]');
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toContain(String(short)); // exactly what is missing
    click(btn);

    expect(gameOf(store).equipment.upgrades).toEqual({});
    expect(store.getEvents().some((e) => e.type === 'item_upgraded')).toBe(false);
  });

  it('replaces the button with ⭐ מקסימלי at +3, and nothing can be spent after', () => {
    const belt = equipmentById('belt_1');
    if (!belt) throw new Error('missing belt_1');
    const store = shopStore(belt.cost + upgradeTotalCost(belt.cost, 3) + 500, [belt.id]);
    mount(store);
    openSlot('belt');
    for (let i = 0; i < MAX_UPGRADE_LEVEL; i += 1) click(document.querySelector('[data-upgrade="belt_1"]'));

    expect(gameOf(store).equipment.upgrades['belt_1']).toBe(MAX_UPGRADE_LEVEL);
    expect(document.querySelector('[data-upgrade="belt_1"]')).toBeNull();
    const maxed = document.querySelector('[data-maxed="belt_1"]');
    expect(maxed?.textContent).toContain('מקסימלי');
    expect(document.querySelector('[data-level="belt_1"]')?.textContent).toContain('+3');
    expect(document.querySelector('.eq-item[data-item="belt_1"]')?.classList.contains('up-3')).toBe(true);
    expect(gameOf(store).battle.coins).toBe(500);
  });

  it('never offers an upgrade on something that is not owned', () => {
    const store = shopStore(50_000);
    mount(store);
    openSlot('shoes');
    expect(document.querySelectorAll('.eq-item').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll('[data-upgrade]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-level]')).toHaveLength(0);
  });

  it('keeps both actions of an owned row comfortably tappable', () => {
    const store = shopStore(9_000, ['shoes_1']);
    mount(store);
    openSlot('shoes');
    const row = document.querySelector('.eq-item[data-item="shoes_1"]');
    const actions = row?.querySelectorAll('.eq-actions .eq-btn') ?? [];
    expect(actions).toHaveLength(2); // הסר · ⬆ שדרוג
    for (const btn of actions) expect(btn.tagName).toBe('BUTTON');
  });
});

/* -------------------------------------------------------------- the feed */

describe('the adventure feed', () => {
  it('gets one ⬆ line per upgrade, naming the item and the level', () => {
    const store = shopStore(20_000, ['gloves_3']);
    upgradeItem(store, 'gloves_3');
    upgradeItem(store, 'gloves_3');

    const lines = buildFeed(store.getEvents()).filter((i) => i.icon === '⬆');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toContain('שודרג');
    expect(lines[0]?.text).toContain(equipmentById('gloves_3')?.he ?? '');
    expect(lines[0]?.text).toContain('+2'); // newest first
    expect(lines[1]?.text).toContain('+1');
    expect(lines[0]?.text).toContain(String(upgradeStepCost(equipmentById('gloves_3')?.cost ?? 0, 2)));
  });
});
