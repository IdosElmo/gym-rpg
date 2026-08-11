/**
 * @vitest-environment jsdom
 *
 * The roster on screen: the דמויות strip, switching character, the purchase
 * sheet (happy + broke paths) and the arena fighting as whoever is selected.
 *
 * Plus the artwork sweep this app applies to every drawing it ships: each roster
 * entry has to be valid, self-contained SVG at every level profile and with any
 * equipment on, on BOTH body geometries.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { buyCharacter, gameOf, selectCharacter } from '../src/core/game.ts';
import { emptyGame } from '../src/core/xp.ts';
import { CHARACTERS, CHARACTER_SKINS, characterById } from '../src/data/characters.ts';
import { EQUIPMENT } from '../src/data/gameContent.ts';
import type { BodyPart } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { characterGeometry, characterSvg, resolveCharacter } from '../src/ui/characterSvg.ts';
import { resetCharacterSheet } from '../src/ui/character.ts';
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
  resetCharacterSheet();
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

/** A דמות screen with `coins` in the purse. */
function charStore(coins = 0, view = 'CH'): LocalStore {
  const store = new LocalStore(fakeStorage());
  store.update((d) => {
    const g = emptyGame();
    g.battle.coins = coins;
    d.game = g;
    d.ui.view = view as typeof d.ui.view;
  });
  return store;
}

const SKIN = CHARACTER_SKINS[0] as (typeof CHARACTER_SKINS)[number];

function click(el: Element | null): void {
  if (!el) throw new Error('missing element');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/* -------------------------------------------------------------- the artwork */

describe('roster artwork', () => {
  const parser = new DOMParser();

  /** Parts at one uniform level — the sweep's "level profile". */
  function partsAt(level: number): ReturnType<typeof emptyGame>['parts'] {
    const parts = emptyGame().parts;
    for (const p of Object.keys(parts) as BodyPart[]) parts[p].level = level;
    return parts;
  }

  it('draws every character as valid, self-contained SVG at every level', () => {
    for (const c of CHARACTERS) {
      for (const level of [1, 5, 12, 99]) {
        const svg = characterSvg(partsAt(level), { character: c.id, trophies: 3 });
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        expect(doc.querySelector('parsererror'), `${c.id} @L${level} is not valid XML`).toBeNull();
        expect(doc.documentElement.tagName).toBe('svg');
        expect(svg, `${c.id} @L${level}`).not.toContain('NaN');
        expect(svg).not.toContain('undefined');
        expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // offline rule
        // the level-driven anatomy survives every skin
        for (const part of ['chest', 'back', 'legs', 'shoulders', 'arms', 'core']) {
          expect(doc.querySelector(`[data-part="${part}"]`), `${c.id} lost ${part}`).not.toBeNull();
        }
        expect(doc.documentElement.getAttribute('data-character')).toBe(c.id);
        expect(doc.documentElement.getAttribute('data-body')).toBe(c.geometry);
      }
    }
  });

  it('keeps every equipment slot anchored on both body geometries', () => {
    for (const c of CHARACTERS) {
      for (const item of EQUIPMENT) {
        const svg = characterSvg(partsAt(9), {
          character: c.id,
          equipment: { owned: [item.id], equipped: { [item.slot]: item.id } },
        });
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        expect(doc.querySelector('parsererror'), `${c.id} + ${item.id} is not valid XML`).toBeNull();
        expect(
          doc.querySelector(`[data-slot="${item.slot}"]`)?.childElementCount ?? 0,
          `${c.id} does not wear ${item.id}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every drawn coordinate inside the 200×320 stage', () => {
    // A skin that drew outside the viewBox would be clipped in the arena, where
    // the same markup is scaled to ~90px. Only GEOMETRY is scanned (colours and
    // the xmlns carry digits of their own).
    const geoAttrs = ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'd'];
    for (const c of CHARACTERS) {
      const doc = parser.parseFromString(characterSvg(partsAt(99), { character: c.id }), 'image/svg+xml');
      for (const el of doc.querySelectorAll('*')) {
        for (const attr of geoAttrs) {
          const raw = el.getAttribute(attr);
          if (raw === null || raw.includes('%') || raw.startsWith('url(')) continue;
          for (const token of raw.match(/-?\d+(\.\d+)?/g) ?? []) {
            const v = Number(token);
            expect(Number.isFinite(v), `${c.id} <${el.tagName} ${attr}>`).toBe(true);
            expect(v, `${c.id} draws at ${v} (<${el.tagName} ${attr}>)`).toBeGreaterThan(-60);
            expect(v, `${c.id} draws at ${v} (<${el.tagName} ${attr}>)`).toBeLessThan(400);
          }
        }
      }
    }
  });

  it('leaves the default hero exactly where it was', () => {
    const parts = partsAt(6);
    // no `character` option === the original male hero
    expect(characterSvg(parts)).toBe(characterSvg(parts, { character: 'hero_m' }));
    // an unknown id (a save from a newer build) falls back to it rather than failing
    expect(resolveCharacter('nope').id).toBe('hero_m');
    expect(characterSvg(parts, { character: 'nope' })).toBe(characterSvg(parts, { character: 'hero_m' }));
    // and the male proportions are untouched by the variant table
    const geo = characterGeometry(emptyGame().parts);
    expect(geo).toMatchObject({ headR: 18, shoulderHalf: 30, chestHalf: 26, hipHalf: 25, legSpread: 1 });
  });

  it('gives the female body a genuinely different silhouette', () => {
    const parts = partsAt(7);
    const m = characterGeometry(parts, 'male');
    const f = characterGeometry(parts, 'female');
    expect(f.shoulderHalf).toBeLessThan(m.shoulderHalf);
    expect(f.waistHalf).toBeLessThan(m.waistHalf);
    expect(f.hipHalf).toBeGreaterThan(m.hipHalf);
    // The hips carry more of the silhouette than they ever do on the male body —
    // at rest they are the widest point outright, and training shoulders still
    // widens them (levels always win, on both bodies).
    const base = characterGeometry(emptyGame().parts, 'female');
    expect(base.hipHalf).toBeGreaterThan(base.shoulderHalf);
    expect(f.hipHalf / f.shoulderHalf).toBeGreaterThan(m.hipHalf / m.shoulderHalf);
    expect(f.pecRy).toBeGreaterThan(m.pecRy); // a bust, not pecs
    expect(f.pecY).toBeGreaterThan(m.pecY);
    expect(f.armW).toBeLessThan(m.armW);
    expect(f.headR).toBeLessThan(m.headR);

    // …and it still grows from the SAME six levels
    const bigger = characterGeometry(partsAt(12), 'female');
    expect(bigger.chestHalf).toBeGreaterThan(f.chestHalf);
    expect(bigger.thighW).toBeGreaterThan(f.thighW);
    expect(bigger.shoulderHalf).toBeGreaterThan(f.shoulderHalf);
  });

  it('crowns the free female body with a cloud of curls, at every level', () => {
    const hero = characterById('hero_f');
    if (!hero) throw new Error('no hero_f');
    expect(hero.decor.kind).toBe('curls');
    const geo = characterGeometry(emptyGame().parts, 'female');

    for (const level of [1, 5, 12, 99]) {
      const doc = parser.parseFromString(characterSvg(partsAt(level), { character: 'hero_f' }), 'image/svg+xml');
      const curls = [...doc.querySelectorAll('.ch-curl')];
      // a BOLD silhouette: enough overlapping curls to read as one cloud
      expect(curls.length, `L${level}`).toBeGreaterThanOrEqual(12);
      // layered like the tied hair was: bulk behind the skull, hairline in front
      expect(doc.querySelectorAll('.ch-decor.back .ch-curl').length).toBeGreaterThanOrEqual(9);
      expect(doc.querySelectorAll('.ch-decor.front .ch-curl').length).toBeGreaterThanOrEqual(4);
      expect(doc.querySelector('.ch-decor.back ellipse')).not.toBeNull(); // the mass

      for (const c of curls) {
        const cx = Number(c.getAttribute('cx'));
        const cy = Number(c.getAttribute('cy'));
        const r = Number(c.getAttribute('r'));
        // every curl is a real, visible circle in the hair's own colours…
        expect(r).toBeGreaterThan(2);
        expect([hero.decor.main, hero.decor.accent]).toContain(c.getAttribute('fill'));
        // …hugging the head rather than floating off it (the classic hair bug)
        expect(Math.hypot(cx - 100, cy - 42)).toBeLessThan(geo.headR * 1.7);
      }
      // the face is never covered by the hairline
      expect(doc.querySelectorAll('.ch-eye')).toHaveLength(2);
      expect(doc.querySelector('.ch-mouth')).not.toBeNull();
    }

    // the curls belong to hero_f alone — the ninja keeps its own wrapped head,
    // and no skin inherits another character's decoration.
    expect(characterById('ninja')?.decor.kind).toBe('mask');
    for (const c of CHARACTERS) {
      const svg = characterSvg(partsAt(6), { character: c.id });
      expect(svg.includes('ch-curl'), `${c.id}`).toBe(c.id === 'hero_f');
    }
  });

  it('recolours a skin without touching its geometry', () => {
    const parts = partsAt(6);
    const robot = characterById('robot');
    if (!robot) throw new Error('no robot');
    expect(robot.geometry).toBe('male');
    const skinSvg = characterSvg(parts, { character: 'robot' });
    // same body, different palette + decoration
    expect(skinSvg).toContain(`--ch-body:${robot.palette.body}`);
    expect(skinSvg).toContain(robot.decor.accent);
    expect(characterGeometry(parts, robot.geometry)).toEqual(characterGeometry(parts, 'male'));
    // every character owns its gradient id — several are drawn on one page
    const ids = CHARACTERS.map((c) => {
      const m = /<linearGradient id="([^"]+)"/.exec(characterSvg(parts, { character: c.id }));
      return m?.[1] ?? '';
    });
    expect(new Set(ids).size).toBe(CHARACTERS.length);
  });
});

/* ------------------------------------------------------------- the strip */

describe('the דמויות strip', () => {
  it('renders one card per roster entry, with prices and the selected mark', () => {
    mount(charStore(0));
    const cards = [...document.querySelectorAll<HTMLButtonElement>('#charRoster .chr-card')];
    expect(cards).toHaveLength(CHARACTERS.length);
    expect(document.querySelector('#charRoster .gc-title')?.textContent).toContain('דמויות');

    for (const c of CHARACTERS) {
      const card = document.querySelector(`.chr-card[data-character="${c.id}"]`);
      expect(card, `${c.id} has no card`).not.toBeNull();
      expect(card?.textContent).toContain(c.he);
      // every card previews the player's OWN body, drawn as that character
      expect(card?.querySelector(`.ch-svg[data-character="${c.id}"]`)).not.toBeNull();
      if (c.cost > 0) expect(card?.textContent).toContain(String(c.cost));
    }
    // the default hero starts selected; the second free body is already unlocked
    expect(document.querySelector('.chr-card[data-character="hero_m"]')?.className).toContain('selected');
    expect(document.querySelector('.chr-card[data-character="hero_f"]')?.className).toContain('owned');
    expect(document.querySelector(`.chr-card[data-character="${SKIN.id}"]`)?.className).toContain('locked');
    // …and the roster note states the rule the whole feature rests on
    expect(document.getElementById('charRoster')?.textContent).toContain('קוסמטיקה בלבד');
  });

  it('switches to the free female body with one tap, and redraws the character', () => {
    const store = charStore(0);
    mount(store);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe('hero_m');

    click(document.querySelector('.chr-card[data-character="hero_f"]'));

    expect(gameOf(store).characters.selected).toBe('hero_f');
    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe('hero_f');
    expect(big?.getAttribute('data-body')).toBe('female'); // the skin-distinguishing mark
    expect(document.querySelector('.chr-card[data-character="hero_f"]')?.className).toContain('selected');
    // switching bodies is free: coins untouched, and no purchase in the log
    expect(gameOf(store).battle.coins).toBe(0);
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
  });

  it('reads the same curls at card size and at stage size', () => {
    mount(charStore(0));
    const card = document.querySelector('.chr-card[data-character="hero_f"] .ch-svg');
    const onCard = card?.querySelectorAll('.ch-curl').length ?? 0;
    expect(onCard).toBeGreaterThanOrEqual(12);

    click(document.querySelector('.chr-card[data-character="hero_f"]'));
    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe('hero_f');
    // one drawing, two sizes — the strip's 62px preview is the 220px character
    expect(big?.querySelectorAll('.ch-curl').length).toBe(onCard);
  });

  it('asks before buying a skin, then buys it and plays it', () => {
    const store = charStore(SKIN.cost + 25);
    mount(store);

    // one tap on a locked card only OPENS the sheet — it never spends
    click(document.querySelector(`.chr-card[data-character="${SKIN.id}"]`));
    const sheet = document.getElementById('chrBuy');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain(SKIN.he);
    expect(sheet?.textContent).toContain(String(SKIN.cost));
    expect(gameOf(store).characters.owned).toEqual([]);

    const buy = document.querySelector<HTMLButtonElement>(`[data-buy-character="${SKIN.id}"]`);
    expect(buy?.disabled).toBe(false);
    click(buy);

    expect(gameOf(store).characters.owned).toEqual([SKIN.id]);
    expect(gameOf(store).characters.selected).toBe(SKIN.id);
    expect(gameOf(store).battle.coins).toBe(25);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe(SKIN.id);
    expect(document.getElementById('chrBuy')).toBeNull(); // the sheet closed itself
    expect(document.querySelector(`.chr-card[data-character="${SKIN.id}"]`)?.className).toContain('selected');
  });

  it('disables the purchase when the purse is short, and writes nothing', () => {
    const store = charStore(SKIN.cost - 30);
    mount(store);
    click(document.querySelector(`.chr-card[data-character="${SKIN.id}"]`));

    const buy = document.querySelector<HTMLButtonElement>(`[data-buy-character="${SKIN.id}"]`);
    expect(buy?.disabled).toBe(true);
    expect(buy?.textContent).toContain('30'); // exactly how many coins are missing
    click(buy);

    expect(gameOf(store).characters.owned).toEqual([]);
    expect(gameOf(store).characters.selected).toBe('hero_m');
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);

    // …and the sheet can be dismissed without buying anything
    click(document.querySelector('[data-cancel-character]'));
    expect(document.getElementById('chrBuy')).toBeNull();
  });

  it('keeps every roster control comfortably tappable', () => {
    mount(charStore(SKIN.cost));
    for (const card of document.querySelectorAll<HTMLElement>('.chr-card')) {
      expect(card.tagName).toBe('BUTTON');
    }
    click(document.querySelector(`.chr-card[data-character="${SKIN.id}"]`));
    // the two sheet actions are real buttons with the shop's ≥40px sizing class
    expect(document.querySelectorAll('#chrBuy .eq-btn')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------- the arena */

describe('the arena', () => {
  it('fights as the selected character', () => {
    const store = charStore(SKIN.cost, 'BT');
    mount(store);
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe('hero_m');

    selectCharacter(store, 'hero_f');
    mount(store);
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-body')).toBe('female');

    buyCharacter(store, SKIN.id);
    mount(store);
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe(SKIN.id);
  });

  it('survives a save that names a character it cannot play', () => {
    const store = charStore(0, 'BT');
    store.update((d) => {
      if (d.game) d.game.characters.selected = 'ghost';
    });
    mount(store);
    // the arena still draws SOMEBODY — the default hero
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe('hero_m');
  });
});
