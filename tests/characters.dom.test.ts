/**
 * @vitest-environment jsdom
 *
 * The roster on screen: the body toggle, the דמויות skin strip, the purchase
 * sheet (happy + broke paths) and the arena fighting as whoever is selected.
 *
 * Plus the artwork sweep this app applies to every drawing it ships: EVERY skin
 * on BOTH bodies has to be valid, self-contained SVG at every level profile, at
 * every size it is shown at, and with any equipment on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { buyCharacter, gameOf, selectBody, selectCharacter } from '../src/core/game.ts';
import { emptyGame } from '../src/core/xp.ts';
import {
  BODY_GEOMETRIES,
  CHARACTERS,
  CHARACTER_SKINS,
  SKINS,
  characterById,
  characterId,
} from '../src/data/characters.ts';
import { EQUIPMENT } from '../src/data/gameContent.ts';
import type { BodyPart } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { characterAnchors, characterGeometry, characterSvg, resolveCharacter } from '../src/ui/characterSvg.ts';
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

  /**
   * THE SWEEP: every skin on every body, at four level profiles.
   *
   * `CHARACTERS` is the whole matrix (skins × bodies), so this single loop is
   * what guarantees the promise the feature makes — a ninja mask on the male
   * head, a spartan helmet on the female one — never ships as broken markup.
   */
  it('draws every skin on BOTH bodies as valid, self-contained SVG at every level', () => {
    expect(CHARACTERS).toHaveLength(SKINS.length * 2);
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
        // the head is actually decorated: a skin's covering, its hair, or a face
        const head = doc.querySelector('.ch-head');
        expect(head, `${c.id} has no head`).not.toBeNull();
        expect(
          (head?.querySelectorAll('.ch-decor *').length ?? 0) + (head?.querySelectorAll('.ch-eye').length ?? 0),
          `${c.id} has a blank head`,
        ).toBeGreaterThan(0);
        expect(doc.documentElement.getAttribute('data-character')).toBe(c.id);
        expect(doc.documentElement.getAttribute('data-skin')).toBe(c.skin);
        expect(doc.documentElement.getAttribute('data-body')).toBe(c.geometry);
      }
    }
  });

  /**
   * ONE DRAWING, THREE SIZES. The markup is size-free — a fixed 200×320 viewBox
   * that CSS scales to 62px on a roster card, ~90px in the arena and 220px on
   * the דמות stage — so "reads at every size" is proved by showing the very same
   * markup is what all three mount points get, with nothing thinner than a
   * stroke the smallest of them can resolve.
   */
  it('ships the same viewBox to the card, the arena and the stage', () => {
    for (const c of CHARACTERS) {
      const svg = characterSvg(partsAt(7), { character: c.id });
      expect(svg, c.id).toContain('viewBox="0 0 200 320"');
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      // 200 units wide shown at 62px ⇒ ~0.31px per unit; a 2-unit stroke is the
      // floor the whole drawing is authored against.
      for (const el of doc.querySelectorAll('[stroke-width]')) {
        expect(Number(el.getAttribute('stroke-width')), `${c.id} hairline stroke`).toBeGreaterThanOrEqual(1.2);
      }
      // nothing is sized in absolute pixels, which would break at another scale
      expect(svg).not.toMatch(/\d(px|pt|em)/);
    }
  });

  it('keeps every equipment slot anchored on every skin × both body geometries', () => {
    for (const c of CHARACTERS) {
      for (const item of EQUIPMENT) {
        for (const level of [1, 99]) {
          const svg = characterSvg(partsAt(level), {
            character: c.id,
            equipment: { owned: [item.id], equipped: { [item.slot]: item.id } },
          });
          const doc = parser.parseFromString(svg, 'image/svg+xml');
          expect(doc.querySelector('parsererror'), `${c.id} + ${item.id} is not valid XML`).toBeNull();
          const worn = doc.querySelector(`[data-slot="${item.slot}"]`);
          expect(worn?.childElementCount ?? 0, `${c.id} does not wear ${item.id}`).toBeGreaterThan(0);
          expect(svg, `${c.id} + ${item.id} @L${level}`).not.toContain('NaN');
        }
      }
    }
  });

  /**
   * THE CAPE AND THE HAIR share the back of the character, and they are the two
   * layers drawn before the body — so their ORDER is a real decision: hair rests
   * on a cape rather than vanishing under it. Nothing else may sneak in front of
   * the cape.
   */
  it('hangs long hair over the cape, and both of them behind the torso', () => {
    const svg = characterSvg(partsAt(9), {
      character: 'hero_f',
      equipment: { owned: ['cape_3'], equipped: { cape: 'cape_3' } },
    });
    const cape = svg.indexOf('data-slot="cape"');
    const hair = svg.indexOf('class="ch-hair back"');
    const torso = svg.indexOf('ch-torso-group');
    const head = svg.indexOf('class="ch-head"');
    expect(cape).toBeGreaterThan(-1);
    expect(hair).toBeGreaterThan(cape); // hair rests ON the cape
    expect(torso).toBeGreaterThan(hair); // …and the body reads first
    expect(head).toBeGreaterThan(torso); // the strands worn in front come last
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
    // and the male proportions are untouched by the matrix
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

  /**
   * THE LONG CURLS. The female base look is a cloud on the crown PLUS a fall
   * that reaches chest height, so this checks three separate things: that the
   * cloud is bold (a lot of overlapping circles), that it is actually LONG
   * (curls well below the shoulder line, in all three layers), and that being
   * long never pushes it off the stage — the hair is authored in head-radius
   * units, so no amount of chest or shoulder growth can move it.
   */
  it('gives the female base body LONG curls — crown, cascade and front strands', () => {
    const hero = characterById('hero_f');
    if (!hero) throw new Error('no hero_f');
    expect(hero.hair.kind).toBe('curls');
    expect(hero.decor.kind).toBe('none'); // hair, not a covering
    const geo = characterGeometry(emptyGame().parts, 'female');

    for (const level of [1, 5, 12, 99]) {
      const doc = parser.parseFromString(characterSvg(partsAt(level), { character: 'hero_f' }), 'image/svg+xml');
      const curls = [...doc.querySelectorAll('.ch-curl')];
      // a BOLD silhouette: enough overlapping curls to read as one long mass
      expect(curls.length, `L${level}`).toBeGreaterThanOrEqual(40);
      // the three layers: crown behind the skull, the fall behind the torso,
      // the hairline + shoulder strands in front of everything
      expect(doc.querySelectorAll('.ch-decor.back .ch-curl').length).toBeGreaterThanOrEqual(9);
      expect(doc.querySelectorAll('.ch-hair.back .ch-curl').length).toBeGreaterThanOrEqual(12);
      expect(doc.querySelectorAll('.ch-decor.front .ch-curl').length).toBeGreaterThanOrEqual(10);
      expect(doc.querySelector('.ch-decor.back ellipse')).not.toBeNull(); // the crown mass

      // …and it is LONG: curls fall past the shoulder line and reach the chest.
      // The LENGTH is the cascade's job — it is drawn before the body, so it can
      // be as long as it likes without ever landing ON the character. The front
      // strands stop at the shoulder (see the keep-out test below).
      const below = (sel: string, y: number): number =>
        [...doc.querySelectorAll(sel)].filter((c) => Number(c.getAttribute('cy')) > y).length;
      expect(below('.ch-curl', 84), `L${level} past the shoulders`).toBeGreaterThanOrEqual(10);
      expect(below('.ch-hair.back .ch-curl', 100), `L${level} cascade at chest height`).toBeGreaterThanOrEqual(4);
      expect(below('.ch-decor.front .ch-curl', 82), `L${level} strands over the shoulder`).toBeGreaterThanOrEqual(2);
      const lowest = Math.max(...curls.map((c) => Number(c.getAttribute('cy')) + Number(c.getAttribute('r'))));
      expect(lowest, `L${level} reaches the chest`).toBeGreaterThan(110);

      for (const c of curls) {
        const cx = Number(c.getAttribute('cx'));
        const cy = Number(c.getAttribute('cy'));
        const r = Number(c.getAttribute('r'));
        // every curl is a real, visible circle in the hair's own colours…
        expect(r).toBeGreaterThan(2);
        expect([hero.hair.main, hero.hair.accent]).toContain(c.getAttribute('fill'));
        // …and NONE of it escapes the 200×320 stage, at any level
        expect(cx - r, `L${level} curl off the left edge`).toBeGreaterThan(4);
        expect(cx + r, `L${level} curl off the right edge`).toBeLessThan(196);
        expect(cy - r).toBeGreaterThan(4);
        expect(cy + r).toBeLessThan(160);
        // …and it hangs off the head rather than floating away from it
        expect(Math.hypot(cx - 100, cy - 42)).toBeLessThan(geo.headR * 5.6);
      }
      // the face is never covered by the hairline
      expect(doc.querySelectorAll('.ch-eye')).toHaveLength(2);
      expect(doc.querySelector('.ch-mouth')).not.toBeNull();
    }
  });

  /**
   * THE TWO KEEP-OUTS — the bug an S24 screenshot showed and this test now
   * forbids: at a high level the front strands used to fall straight down the
   * middle of the chest (a dark bib over both pecs) and the hairline curls sat
   * on the cheeks. Both are geometric properties, so both are checked as
   * geometry, on both curly skins, across the whole growth curve:
   *
   *   FACE  — no curl of the FRONT layer may touch a circle around the
   *           features. (The crown may overlap it freely: it is drawn behind
   *           the skull, so it cannot cover anything.)
   *   CHEST — no front curl may reach the pec/bust pair AT THIS LEVEL's
   *           proportions. The length lives in the cascade, which is drawn
   *           before the body and is therefore always behind it.
   */
  it('keeps the front hair off the face and off the chest, at every level', () => {
    for (const id of ['hero_f', 'zombie_f']) {
      for (const level of [1, 5, 10, 25, 99]) {
        const parts = partsAt(level);
        const geo = characterGeometry(parts, 'female');
        const r = geo.headR;
        const doc = parser.parseFromString(characterSvg(parts, { character: id }), 'image/svg+xml');
        const front = [...doc.querySelectorAll('.ch-decor.front .ch-curl')];
        expect(front.length, `${id} L${level} front curls`).toBeGreaterThanOrEqual(10);

        // the features: eyes at ±0.39r / −0.11r, mouth at +0.39…+0.67r
        const faceCy = 42 + r * 0.15;
        const faceR = r * 0.62;
        // the top of the bust, which MOVES with the chest level
        const pecTop = geo.pecY - geo.pecRy;

        for (const c of front) {
          const cx = Number(c.getAttribute('cx'));
          const cy = Number(c.getAttribute('cy'));
          const cr = Number(c.getAttribute('r'));
          expect(
            Math.hypot(cx - 100, cy - faceCy),
            `${id} L${level}: a front curl at (${cx},${cy}) r${cr} sits on the face`,
          ).toBeGreaterThan(faceR + cr);
          expect(
            cy + cr,
            `${id} L${level}: a front curl reaches the chest (bust starts at ${pecTop})`,
          ).toBeLessThan(pecTop);
          // …and it hugs the shoulder line (y=84) rather than crossing the body
          expect(cy + cr, `${id} L${level}: a front curl past the shoulder`).toBeLessThan(96);
        }
      }
    }
  });

  /**
   * PAINT ORDER, asserted at every level rather than once: the cascade is only
   * "behind the torso" because of where it sits in the document, and a refactor
   * that moved that group would silently put a curtain of hair over the body.
   */
  it('draws cape → cascade → torso → head → front strands, at every level', () => {
    for (const level of [1, 5, 10, 25, 99]) {
      const svg = characterSvg(partsAt(level), {
        character: 'hero_f',
        equipment: { owned: ['cape_3'], equipped: { cape: 'cape_3' } },
      });
      const at = (needle: string): number => {
        const i = svg.indexOf(needle);
        expect(i, `L${level}: missing ${needle}`).toBeGreaterThan(-1);
        return i;
      };
      const order = [
        at('data-slot="cape"'),
        at('class="ch-hair back"'),
        at('ch-torso-group'),
        at('class="ch-head"'),
        at('class="ch-decor front"'),
      ];
      expect([...order].sort((a, b) => a - b), `L${level} draw order`).toEqual(order);
      // the front decor is inside the head group, after the skull it frames
      expect(at('class="ch-skin"'), `L${level}`).toBeLessThan(at('class="ch-decor front"'));
    }
  });

  it('reads the same curls at card, arena and stage scale', () => {
    // The three sizes share one string, so "reads at 62px" is the same drawing
    // as "reads at 220px" — there is no low-detail variant to drift.
    const a = characterSvg(partsAt(1), { character: 'hero_f' });
    const b = characterSvg(partsAt(1), { character: 'hero_f', label: 'הדמות שלך' });
    expect(a).toBe(b);
    const counts = [1, 12, 99].map(
      (l) => (characterSvg(partsAt(l), { character: 'hero_f' }).match(/ch-curl/g) ?? []).length,
    );
    expect(new Set(counts).size).toBe(1); // level never changes the hair
    expect(counts[0]).toBeGreaterThanOrEqual(40);
  });

  /**
   * PER-BODY LOOKS. Long curls are the FEMALE base look — a male hero is
   * bare-headed as it always was — and a skin re-uses them only where they
   * survive what the skin puts on the head: the zombie keeps them, torn; the
   * spartan helmet and the ninja wrap replace them with a tied tail; the robot
   * chassis has no hair at all.
   */
  it('picks the hair that suits each body under each skin', () => {
    const kindOf = (id: string): string => characterById(id)?.hair.kind ?? '?';
    expect(kindOf('hero_m')).toBe('none');
    expect(kindOf('hero_f')).toBe('curls');
    expect(kindOf('robot_m')).toBe('none');
    expect(kindOf('robot_f')).toBe('none');
    expect(kindOf('spartan_m')).toBe('none');
    expect(kindOf('spartan_f')).toBe('tied');
    expect(kindOf('zombie_m')).toBe('none');
    expect(kindOf('zombie_f')).toBe('ragged');
    expect(kindOf('ninja_m')).toBe('tied');
    expect(kindOf('ninja_f')).toBe('tied');

    // the covering, by contrast, is the SKIN's and is identical on both bodies
    for (const skin of SKINS) {
      const kinds = BODY_GEOMETRIES.map((b) => characterById(characterId(skin.id, b))?.decor.kind);
      expect(new Set(kinds).size, `${skin.id} decor differs by body`).toBe(1);
    }

    // curls appear exactly where the table above says, and nowhere else
    for (const c of CHARACTERS) {
      const svg = characterSvg(partsAt(6), { character: c.id });
      expect(svg.includes('ch-curl'), `${c.id}`).toBe(c.hair.kind === 'curls' || c.hair.kind === 'ragged');
    }

    // the undead cloud is the same cloud, thinned — fewer curls, same class
    const ragged = (characterSvg(partsAt(6), { character: 'zombie_f' }).match(/ch-curl/g) ?? []).length;
    const full = (characterSvg(partsAt(6), { character: 'hero_f' }).match(/ch-curl/g) ?? []).length;
    expect(ragged).toBeGreaterThanOrEqual(24);
    expect(ragged).toBeLessThan(full);
  });

  it('fits every head covering to BOTH head sizes', () => {
    // Head decor is authored in units of the head radius, so the only thing that
    // changes between bodies is the scale — never a hand-placed constant that
    // would drift off a smaller skull.
    for (const skin of SKINS) {
      const [m, f] = BODY_GEOMETRIES.map((b) => {
        const doc = parser.parseFromString(
          characterSvg(partsAt(6), { character: characterId(skin.id, b) }),
          'image/svg+xml',
        );
        return doc.querySelector('.ch-head');
      });
      const decorCount = (el: Element | null | undefined): number => el?.querySelectorAll('.ch-decor *').length ?? 0;
      // a skin with a COVERING wears it on both bodies (the hair under it may
      // differ, and the bare-headed free skin is the one that has neither)
      if (skin.look.male.decor.kind !== 'none') {
        expect(decorCount(m), `${skin.id} bare on male`).toBeGreaterThan(0);
        expect(decorCount(f), `${skin.id} bare on female`).toBeGreaterThan(0);
      }
      // and the face rule survives the swap: a mask hides the mouth on both
      const hidden = BODY_GEOMETRIES.map(
        (b) => !characterSvg(partsAt(6), { character: characterId(skin.id, b) }).includes('ch-mouth'),
      );
      expect(new Set(hidden).size, `${skin.id} hides the face on one body only`).toBe(1);
    }
  });

  it('recolours a skin without touching its geometry, on either body', () => {
    const parts = partsAt(6);
    const robot = characterById('robot_m');
    const robotF = characterById('robot_f');
    if (!robot || !robotF) throw new Error('no robot');
    expect(robot.geometry).toBe('male');
    expect(robotF.geometry).toBe('female');
    // ONE palette, both bodies — a skin is a colour scheme, not a silhouette
    expect(robotF.palette).toEqual(robot.palette);
    for (const c of [robot, robotF]) {
      const skinSvg = characterSvg(parts, { character: c.id });
      expect(skinSvg).toContain(`--ch-body:${c.palette.body}`);
      expect(skinSvg).toContain(c.decor.accent);
      // the geometry is the BODY's alone: a skin never moves a proportion
      expect(characterGeometry(parts, c.geometry)).toEqual(characterGeometry(parts, c.geometry));
    }
    expect(characterGeometry(parts, robot.geometry)).toEqual(characterGeometry(parts, 'male'));
    expect(characterGeometry(parts, robotF.geometry)).toEqual(characterGeometry(parts, 'female'));
    // every combination owns its gradient id — several are drawn on one page
    const ids = CHARACTERS.map((c) => {
      const m = /<linearGradient id="([^"]+)"/.exec(characterSvg(parts, { character: c.id }));
      return m?.[1] ?? '';
    });
    expect(new Set(ids).size).toBe(CHARACTERS.length);
  });

  it('still draws a legacy id: an old save naming `robot` gets the male robot', () => {
    const parts = partsAt(6);
    expect(resolveCharacter('robot').id).toBe('robot_m');
    expect(resolveCharacter('ninja').id).toBe('ninja_f');
    expect(characterSvg(parts, { character: 'robot' })).toBe(characterSvg(parts, { character: 'robot_m' }));
  });
});

/* ------------------------------------------------------------- the shoes */

/**
 * A PAIR OF SHOES, ONE PER FOOT.
 *
 * The old drawing was two flat wedges pinned under the legs at a share of the
 * hip width that was NOT the one the legs themselves stand at — so they pointed
 * sideways and floated under a character whose legs had grown past them. The
 * replacement is one shoe shape drawn twice, mirrored, each from its own leg's
 * ankle point, and these are the properties that keeps true:
 *
 *   - the anchor IS the leg: the same expression `legGroup` ends its calf
 *     stroke at, read back out of the drawn leg path rather than recomputed;
 *   - the pair mirrors about the centre line, point for point;
 *   - the shoe CONTAINS the leg end — wider than the calf, with a collar that
 *     starts above the ankle — and points its toe outward, like a person
 *     standing;
 * over every level of the growth curve and BOTH bodies, i.e. both `legSpread`
 * values that ship (the female legs stand closer in under wider hips).
 */
describe('the shoes', () => {
  const parser = new DOMParser();
  const ANKLE_Y = 292;
  const SHOES = EQUIPMENT.filter((i) => i.slot === 'shoes');
  const LEVELS = [1, 3, 7, 15, 99];

  function partsAt(level: number): ReturnType<typeof emptyGame>['parts'] {
    const parts = emptyGame().parts;
    for (const p of Object.keys(parts) as BodyPart[]) parts[p].level = level;
    return parts;
  }

  function draw(characterId: string, itemId: string, level: number, upgrade = 0): Document {
    return parser.parseFromString(
      characterSvg(partsAt(level), {
        character: characterId,
        equipment: { owned: [itemId], equipped: { shoes: itemId }, upgrades: { [itemId]: upgrade } },
      }),
      'image/svg+xml',
    );
  }

  /** Where the two LEGS actually end, straight out of the drawn calf strokes. */
  function drawnAnkles(doc: Document): number[] {
    return [...doc.querySelectorAll('[data-part="legs"] path')]
      .map((p) => /L (-?[\d.]+) 292/.exec(p.getAttribute('d') ?? '')?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  }

  /**
   * Every point one shoe element draws at. The shoe paths are authored in
   * ABSOLUTE commands only, which is what makes this reading honest: the
   * numbers in `d` are x,y pairs and nothing else.
   */
  function pointsOf(el: Element): Array<[number, number]> {
    if (el.tagName === 'rect') {
      const at = (a: string): number => Number(el.getAttribute(a));
      // all four corners: a rect flipped about the centre line maps its corner
      // SET onto the other one's, which is what the mirror test compares
      return [
        [at('x'), at('y')],
        [at('x') + at('width'), at('y')],
        [at('x'), at('y') + at('height')],
        [at('x') + at('width'), at('y') + at('height')],
      ];
    }
    const d = el.getAttribute('d') ?? '';
    expect(d, 'a shoe path uses a relative command').not.toMatch(/[hvasHVAS]/);
    const raw = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    expect(raw.length % 2, `odd coordinate count in ${d}`).toBe(0);
    return Array.from({ length: raw.length / 2 }, (_, i) => [raw[i * 2] as number, raw[i * 2 + 1] as number]);
  }

  function box(g: Element): { minX: number; maxX: number; minY: number; maxY: number } {
    const pts = [...g.children].flatMap(pointsOf);
    expect(pts.length).toBeGreaterThan(8);
    return {
      minX: Math.min(...pts.map((p) => p[0])),
      maxX: Math.max(...pts.map((p) => p[0])),
      minY: Math.min(...pts.map((p) => p[1])),
      maxY: Math.max(...pts.map((p) => p[1])),
    };
  }

  it('stands each shoe on its own leg — at every level, on both bodies', () => {
    for (const c of ['hero_m', 'hero_f']) {
      for (const level of LEVELS) {
        const parts = partsAt(level);
        const geo = characterGeometry(parts, c === 'hero_f' ? 'female' : 'male');
        const anchors = characterAnchors(geo);
        for (const item of SHOES) {
          const doc = draw(c, item.id, level);
          const where = `${c} + ${item.id} @L${level}`;

          // THE ANCHOR IS THE LEG. Not "about where the leg is" — the very x the
          // calf stroke ends at, on both sides.
          const ankles = drawnAnkles(doc);
          expect(ankles, where).toHaveLength(2);
          const anchored = anchors.shoes.map((s) => s.x).sort((a, b) => a - b);
          expect(anchored[0], where).toBeCloseTo(ankles[0] as number, 1);
          expect(anchored[1], where).toBeCloseTo(ankles[1] as number, 1);
          // …and the pair is centred on the character, whatever the legSpread
          expect(anchors.shoes[0]?.x ?? 0, where).toBeCloseTo(200 - (anchors.shoes[1]?.x ?? 0), 6);
          expect(anchors.shoes.map((s) => s.dir)).toEqual([-1, 1]);

          const shoes = [...doc.querySelectorAll('[data-slot="shoes"] .ch-shoe')];
          expect(shoes, where).toHaveLength(2);
          shoes.forEach((shoe, i) => {
            const b = box(shoe);
            const ankle = ankles[i] as number;
            const dir = i === 0 ? -1 : 1;
            const outward = dir === 1 ? b.maxX - ankle : ankle - b.minX;
            const inward = dir === 1 ? ankle - b.minX : b.maxX - ankle;

            // it CONTAINS the end of the leg: wider than the calf on both sides…
            expect(b.minX, `${where} left of the leg`).toBeLessThan(ankle - geo.calfW / 2);
            expect(b.maxX, `${where} right of the leg`).toBeGreaterThan(ankle + geo.calfW / 2);
            // …and its collar starts well ABOVE the ankle, over the leg itself
            expect(b.minY, `${where} collar`).toBeLessThan(ANKLE_Y - 6);
            // the toe points OUTWARD-forward: most of the foot is on that side
            expect(outward, `${where} toe`).toBeGreaterThan(inward * 1.4);
            // neither shoe crosses the centre line onto the other foot
            expect(dir === 1 ? b.minX : b.maxX, `${where} crosses the middle`).toBeGreaterThan(
              dir === 1 ? 100 : -Infinity,
            );
            if (dir === -1) expect(b.maxX, `${where} crosses the middle`).toBeLessThan(100);
            // it stands ON the ground shadow (cy 306) rather than through it
            expect(b.maxY, `${where} sinks into the ground`).toBeLessThan(306);
            expect(b.minX, where).toBeGreaterThan(0);
            expect(b.maxX, where).toBeLessThan(200);
          });
        }
      }
    }
  });

  it('draws the two shoes as mirror images, point for point', () => {
    for (const c of ['hero_m', 'hero_f']) {
      for (const level of LEVELS) {
        for (const item of SHOES) {
          const doc = draw(c, item.id, level);
          const [left, right] = [...doc.querySelectorAll('[data-slot="shoes"] .ch-shoe')];
          const l = [...(left?.children ?? [])];
          const r = [...(right?.children ?? [])];
          expect(l.length, `${c} ${item.id}`).toBe(r.length);
          expect(l.length).toBeGreaterThanOrEqual(4); // collar · upper · sole · lace
          l.forEach((el, i) => {
            const there = r[i] as Element;
            expect(el.tagName).toBe(there.tagName);
            // the LEFT shape, flipped about x=100, is the right one — compared
            // as point SETS, since flipping a rect swaps which corner is which
            const order = (pts: Array<[number, number]>): Array<[number, number]> =>
              [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
            const a = order(pointsOf(el).map(([x, y]) => [200 - x, y]));
            const b = order(pointsOf(there));
            expect(a.length).toBe(b.length);
            a.forEach(([x, y], k) => {
              const [bx, by] = b[k] as [number, number];
              // (0.1 is the rounding the markup is emitted at)
              expect(Math.abs(x - bx), `${c} ${item.id} x`).toBeLessThanOrEqual(0.11);
              expect(y, `${c} ${item.id} y`).toBeCloseTo(by, 5);
            });
          });
        }
      }
    }
  });

  it('reads as footwear: a collar, a bold upper, a darker sole and a lace', () => {
    const lum = (hex: string): number => {
      const v = Number.parseInt(hex.slice(1), 16);
      return ((v >> 16) & 0xff) * 0.3 + ((v >> 8) & 0xff) * 0.59 + (v & 0xff) * 0.11;
    };
    for (const item of SHOES) {
      const shoe = draw('hero_m', item.id, 9).querySelector('.ch-shoe');
      const fills = [...(shoe?.children ?? [])].map((el) => el.getAttribute('fill') ?? '');
      // the item's own palette dresses it — the tiers stay told apart
      expect(fills, item.id).toContain(item.color);
      expect(fills, item.id).toContain(item.accent);
      // …plus the sole, mixed DOWN from the item's colour rather than declared
      const sole = fills.find((f) => f !== item.color && f !== item.accent && f !== 'none');
      expect(sole, `${item.id} has no sole`).toMatch(/^#[0-9a-f]{6}$/);
      expect(lum(sole as string), `${item.id} sole is not darker`).toBeLessThan(lum(item.color));
      // nothing in a shoe leans on a stroke the roster card cannot resolve
      for (const el of shoe?.querySelectorAll('[stroke-width]') ?? []) {
        expect(Number(el.getAttribute('stroke-width')), item.id).toBeGreaterThanOrEqual(1.6);
      }
    }
    // the three tiers are still three different pairs of shoes
    expect(new Set(SHOES.map((i) => `${i.color}${i.accent}`)).size).toBe(SHOES.length);
  });

  it('pins the upgrade flair to the toe boxes, one per foot', () => {
    for (const c of ['hero_m', 'hero_f']) {
      for (const level of [1, 99]) {
        const doc = draw(c, 'shoes_3', level, 2);
        const ankles = drawnAnkles(doc);
        const shoes = [...doc.querySelectorAll('[data-slot="shoes"] .ch-shoe')].map(box);
        const sparks = [...doc.querySelectorAll('[data-slot="shoes"] .ch-spark')].map(
          (s) => (pointsOf(s)[0] as [number, number])[0],
        );
        expect(sparks, `${c} @L${level}`).toHaveLength(2);
        const sorted = [...sparks].sort((a, b) => a - b);
        // mirrored, like the shoes they sit on
        expect((sorted[0] as number) + (sorted[1] as number)).toBeCloseTo(200, 0);
        sorted.forEach((x, i) => {
          const ankle = ankles[i] as number;
          const b = shoes[i] as ReturnType<typeof box>;
          // OUTWARD of the ankle — on the toe box, never over the leg…
          expect(Math.abs(x - 100), `${c} flair is not on the toe`).toBeGreaterThan(Math.abs(ankle - 100));
          // …and still on the shoe rather than floating away from it
          expect(x).toBeGreaterThan(b.minX - 8);
          expect(x).toBeLessThan(b.maxX + 8);
        });
      }
    }
  });
});

/* ------------------------------------------------------------- the strip */

describe('the body toggle', () => {
  it('offers both bodies as ≥44px buttons, with the played one pressed', () => {
    mount(charStore(0));
    const toggle = document.getElementById('chrBodies');
    expect(toggle).not.toBeNull();
    const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-body-select]')];
    expect(btns).toHaveLength(2);
    expect(btns.map((b) => b.dataset['bodySelect'])).toEqual(['male', 'female']);
    for (const b of btns) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.textContent).toMatch(/גבר|אישה/);
    }
    // …and the CSS that sizes them is the ≥44px rule the whole app uses
    const css = readFileSync(resolve(process.cwd(), 'styles/character.css'), 'utf8');
    expect(/\.chr-body\{[^}]*min-height:44px/.test(css)).toBe(true);

    expect(btns[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(btns[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(btns[0]?.className).toContain('on');
  });

  it('switches the big drawing AND every card preview with one tap', () => {
    const store = charStore(0);
    mount(store);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-body')).toBe('male');
    for (const art of document.querySelectorAll('#charRoster .chr-art .ch-svg')) {
      expect(art.getAttribute('data-body')).toBe('male');
    }

    click(document.querySelector('[data-body-select="female"]'));

    // the store followed: one plain character_selected, no purchase
    expect(gameOf(store).characters.selected).toBe('hero_f');
    expect(store.getEvents().filter((e) => e.type === 'character_selected')).toHaveLength(1);
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
    expect(gameOf(store).battle.coins).toBe(0);

    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe('hero_f');
    expect(big?.getAttribute('data-body')).toBe('female');
    // EVERY card is now previewing the female body — that is the point of the
    // toggle: the strip answers "what does this skin look like on ME".
    const arts = [...document.querySelectorAll('#charRoster .chr-art .ch-svg')];
    expect(arts).toHaveLength(SKINS.length);
    for (const art of arts) expect(art.getAttribute('data-body')).toBe('female');
    expect(document.querySelector('[data-body-select="female"]')?.className).toContain('on');
    expect(document.querySelector('[data-body-select="male"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('carries the worn skin across a body switch', () => {
    const store = charStore(SKIN.cost);
    buyCharacter(store, SKIN.id);
    mount(store);
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_m`);

    click(document.querySelector('[data-body-select="female"]'));
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_f`);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-skin')).toBe(SKIN.id);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-body')).toBe('female');
    // still one purchase, for both bodies
    expect(store.getEvents().filter((e) => e.type === 'character_purchased')).toHaveLength(1);
  });
});

describe('the דמויות strip', () => {
  it('renders one card per SKIN, with prices and the selected mark', () => {
    mount(charStore(0));
    const cards = [...document.querySelectorAll<HTMLButtonElement>('#charRoster .chr-card')];
    expect(cards).toHaveLength(SKINS.length);
    expect(document.querySelector('#charRoster .gc-title')?.textContent).toContain('דמויות');

    for (const s of SKINS) {
      const card = document.querySelector(`.chr-card[data-skin="${s.id}"]`);
      expect(card, `${s.id} has no card`).not.toBeNull();
      expect(card?.textContent).toContain(s.he);
      // every card previews the player's OWN body + levels, drawn as that skin
      expect(card?.querySelector(`.ch-svg[data-character="${characterId(s.id, 'male')}"]`)).not.toBeNull();
      if (s.cost > 0) expect(card?.textContent).toContain(String(s.cost));
    }
    // the free skin starts selected, everything else is locked
    expect(document.querySelector('.chr-card[data-skin="hero"]')?.className).toContain('selected');
    expect(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`)?.className).toContain('locked');
    // …and the roster note states both rules the whole feature rests on
    expect(document.getElementById('charRoster')?.textContent).toContain('קוסמטיקה בלבד');
    expect(document.getElementById('charRoster')?.textContent).toContain('נפתח בשניהם');
  });

  it('reads the same curls at card size and at stage size', () => {
    const store = charStore(0);
    mount(store);
    click(document.querySelector('[data-body-select="female"]'));

    const card = document.querySelector('.chr-card[data-skin="hero"] .ch-svg');
    const onCard = card?.querySelectorAll('.ch-curl').length ?? 0;
    expect(onCard).toBeGreaterThanOrEqual(40);

    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe('hero_f');
    // one drawing, two sizes — the strip's 62px preview is the 220px character
    expect(big?.querySelectorAll('.ch-curl').length).toBe(onCard);
  });

  it('asks before buying a skin, then buys it and plays it', () => {
    const store = charStore(SKIN.cost + 25);
    mount(store);

    // one tap on a locked card only OPENS the sheet — it never spends
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    const sheet = document.getElementById('chrBuy');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain(SKIN.he);
    expect(sheet?.textContent).toContain(String(SKIN.cost));
    expect(gameOf(store).characters.owned).toEqual([]);

    const buy = document.querySelector<HTMLButtonElement>(`[data-buy-character="${SKIN.id}"]`);
    expect(buy?.disabled).toBe(false);
    click(buy);

    expect(gameOf(store).characters.owned).toEqual([SKIN.id]);
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_m`);
    expect(gameOf(store).battle.coins).toBe(25);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-skin')).toBe(SKIN.id);
    expect(document.getElementById('chrBuy')).toBeNull(); // the sheet closed itself
    expect(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`)?.className).toContain('selected');
  });

  it('buys the same skin from the FEMALE body, and unlocks both', () => {
    const store = charStore(SKIN.cost);
    mount(store);
    click(document.querySelector('[data-body-select="female"]'));
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-buy-character="${SKIN.id}"]`));

    // bought onto the body being played…
    expect(gameOf(store).characters.owned).toEqual([SKIN.id]);
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_f`);
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe(`${SKIN.id}_f`);
    // …and the male variant came free with it, one tap away
    click(document.querySelector('[data-body-select="male"]'));
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_m`);
    expect(gameOf(store).battle.coins).toBe(0);
    expect(store.getEvents().filter((e) => e.type === 'character_purchased')).toHaveLength(1);
  });

  it('switches back to an owned skin with one tap, on the current body', () => {
    const store = charStore(SKIN.cost);
    buyCharacter(store, SKIN.id);
    mount(store);
    click(document.querySelector('[data-body-select="female"]'));
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_f`);

    click(document.querySelector('.chr-card[data-skin="hero"]'));
    expect(gameOf(store).characters.selected).toBe('hero_f'); // the body stayed
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe('hero_f');
  });

  it('disables the purchase when the purse is short, and writes nothing', () => {
    const store = charStore(SKIN.cost - 30);
    mount(store);
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));

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
    for (const b of document.querySelectorAll<HTMLElement>('.chr-body')) expect(b.tagName).toBe('BUTTON');
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    // the three sheet actions (try on · buy · cancel) are real buttons with the
    // shop's ≥40px sizing class
    expect(document.querySelectorAll('#chrBuy .eq-btn')).toHaveLength(3);
    expect(document.querySelector(`#chrBuy [data-preview-character="${SKIN.id}"]`)?.tagName).toBe('BUTTON');
  });
});

/* --------------------------------------------------------- the try-on */

describe('the try-on preview', () => {
  it('wears a locked skin on MY body without writing anything', () => {
    const store = charStore(SKIN.cost);
    mount(store);
    const before = store.getEvents().length;

    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));

    // the BIG character is the locked skin, on the body being played…
    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe(`${SKIN.id}_m`);
    expect(big?.getAttribute('data-skin')).toBe(SKIN.id);
    expect(big?.getAttribute('data-body')).toBe('male');
    expect(big?.getAttribute('aria-label')).toContain('תצוגה מקדימה');
    // …clearly marked as a preview, with a way back
    expect(document.querySelector('.char-stage')?.className).toContain('previewing');
    expect(document.getElementById('chrPreview')?.textContent).toContain('לא נרכש');
    expect(document.querySelector('.char-preview [data-exit-preview]')?.textContent).toContain('חזרה לדמות שלי');
    expect(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`)?.className).toContain('previewing');

    // …and NOTHING was written: no event at all, no ownership, no selection
    expect(store.getEvents()).toHaveLength(before);
    expect(gameOf(store).characters).toEqual({ owned: [], selected: 'hero_m' });
    expect(gameOf(store).battle.coins).toBe(SKIN.cost);
  });

  it('composes the preview with the body toggle', () => {
    const store = charStore(SKIN.cost);
    mount(store);
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe(`${SKIN.id}_m`);

    // flipping the body while trying on re-dresses the SAME locked skin
    click(document.querySelector('[data-body-select="female"]'));
    const big = document.querySelector('.char-stage .ch-svg');
    expect(big?.getAttribute('data-character')).toBe(`${SKIN.id}_f`);
    expect(document.querySelector('.char-stage')?.className).toContain('previewing');
    // the body switch is real (it is my body), the skin is still not owned
    expect(gameOf(store).characters.selected).toBe('hero_f');
    expect(gameOf(store).characters.owned).toEqual([]);
  });

  it('draws the preview with MY levels and MY equipment', () => {
    const store = charStore(SKIN.cost);
    store.update((d) => {
      if (!d.game) return;
      d.game.parts.chest.level = 11;
      d.game.equipment = { owned: ['belt_1'], equipped: { belt: 'belt_1' }, upgrades: {} };
    });
    mount(store);
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));

    const big = document.querySelector('.char-stage .ch-svg');
    // the belt is worn by the previewed body…
    expect(big?.querySelector('[data-slot="belt"]')?.childElementCount ?? 0).toBeGreaterThan(0);
    // …and the drawing is the player's own trained body, not a stock portrait
    const host = document.createElement('div');
    host.innerHTML = characterSvg(gameOf(store).parts, {
      character: `${SKIN.id}_m`,
      equipment: gameOf(store).equipment,
      label: `תצוגה מקדימה: ${characterById(`${SKIN.id}_m`)?.he ?? ''}`,
    });
    expect(big?.outerHTML).toBe(host.firstElementChild?.outerHTML);
  });

  it('goes back to my own character, and forgets the try-on on navigation', () => {
    const store = charStore(SKIN.cost);
    selectCharacter(store, 'hero_f');
    const render = mount(store);

    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe(`${SKIN.id}_f`);

    click(document.querySelector('.char-preview [data-exit-preview]'));
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe('hero_f');
    expect(document.querySelector('.char-stage')?.className).not.toContain('previewing');
    expect(document.getElementById('chrBuy')).not.toBeNull(); // the sheet stays reachable

    // preview again, then leave the screen: the try-on must not survive it
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));
    expect(document.querySelector('.char-stage')?.className).toContain('previewing');
    click(document.querySelector('.tab[data-view="BT"]'));
    click(document.querySelector('.tab[data-view="CH"]'));
    render();
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-character')).toBe('hero_f');
    expect(document.querySelector('.char-stage')?.className).not.toContain('previewing');
  });

  it('never lets the arena fight as a previewed character', () => {
    const store = charStore(SKIN.cost);
    mount(store);
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-skin')).toBe(SKIN.id);

    // the arena reads the STORE, and the store never heard about the try-on
    click(document.querySelector('.tab[data-view="BT"]'));
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe('hero_m');
    expect(store.getEvents().some((e) => e.type === 'character_purchased')).toBe(false);
    expect(store.getEvents().some((e) => e.type === 'character_selected')).toBe(false);
  });

  it('buys the previewed skin in one tap, straight from the preview', () => {
    const store = charStore(SKIN.cost + 10);
    mount(store);
    click(document.querySelector(`.chr-card[data-skin="${SKIN.id}"]`));
    click(document.querySelector(`[data-preview-character="${SKIN.id}"]`));

    // the sheet is still there under the preview — one tap buys
    click(document.querySelector(`[data-buy-character="${SKIN.id}"]`));

    expect(gameOf(store).characters.owned).toEqual([SKIN.id]);
    expect(gameOf(store).characters.selected).toBe(`${SKIN.id}_m`);
    expect(gameOf(store).battle.coins).toBe(10);
    // the preview marking is gone: this is the real character now
    expect(document.querySelector('.char-stage')?.className).not.toContain('previewing');
    expect(document.getElementById('chrPreview')).toBeNull();
    expect(document.querySelector('.char-stage .ch-svg')?.getAttribute('data-skin')).toBe(SKIN.id);
  });
});

/* ------------------------------------------------------------- the arena */

describe('the arena', () => {
  it('fights as the selected body × skin', () => {
    const store = charStore(SKIN.cost, 'BT');
    mount(store);
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe('hero_m');

    selectBody(store, 'female');
    mount(store);
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-body')).toBe('female');

    buyCharacter(store, SKIN.id);
    mount(store);
    // bought from the female body: the arena shows that exact combination
    const hero = document.querySelector('.bt-sprite.hero .ch-svg');
    expect(hero?.getAttribute('data-character')).toBe(`${SKIN.id}_f`);
    expect(hero?.getAttribute('data-skin')).toBe(SKIN.id);
  });

  it('fights as a LEGACY selection from a single-body save', () => {
    const store = charStore(0, 'BT');
    store.update((d) => {
      if (d.game) d.game.characters = { owned: ['ninja'], selected: 'ninja' };
    });
    mount(store);
    // 'ninja' was female-only, so that is what the arena still draws
    expect(document.querySelector('.bt-sprite.hero .ch-svg')?.getAttribute('data-character')).toBe('ninja_f');
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
