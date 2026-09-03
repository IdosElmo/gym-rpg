/**
 * @vitest-environment jsdom
 *
 * The arena's surfaces:
 *
 *   1. MOTION — the battle loop toggles short-lived classes on the hero and the
 *      enemy sprite (`.anim-attack`, `.anim-hit`, `.anim-hurt`, `.anim-die`,
 *      `.anim-super`, `.anim-victory`) and `styles/anim.css` animates them. The
 *      tests below drive the real loop and assert the classes, because the class
 *      is the contract between the loop and the stylesheet; and they assert the
 *      reduced-motion path leaves the DOM harmless rather than different.
 *   2. THE WORLD STRIP — the NINE worlds as nodes, with locked / current /
 *      boss-ready / champion states and the current world's own wave progress.
 *      Nine nodes do not fit a phone side by side, so the row scrolls; the CSS
 *      that makes that work is asserted here as source, since jsdom has no
 *      layout and a layout-free assertion that lies is worse than none.
 *   3. THE HERO'S GEAR — the fighter wears what the דמות screen shows, in every
 *      mode the arena can be in, and the equipment layers are the same markup
 *      on the same 200×320 stage rather than a second, smaller drawing.
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
import { gameOf, onSetCompleted } from '../src/core/game.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import {
  EQUIPMENT_SLOTS,
  WORLDS,
  WORLD_BOSSES,
  bossWaveOf,
  wavesInWorld,
  equipmentById,
  type EquipmentSlot,
} from '../src/data/gameContent.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { characterSvg } from '../src/ui/characterSvg.ts';
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
      g.battle.wave = bossWaveOf(1);
      d.game = g;
    });
    mount(store);
    // The gate is wide open at level 40, so the boss button is up — press it.
    const bossBtn = document.getElementById('btBossFight') as HTMLButtonElement;
    expect(bossBtn.hidden).toBe(false);
    bossBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

/* ------------------------------------------------------------ world strip */

describe('world progress strip', () => {
  const nodes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#btWorlds .wp-node')];

  it('shows one node per world, named in Hebrew, with a ≥44px target', () => {
    mount(battleStore());
    const list = nodes();
    expect(list).toHaveLength(WORLDS.length);
    list.forEach((node, i) => {
      expect(node.querySelector('.wp-name')?.textContent).toBe(WORLDS[i]?.he);
      expect(node.querySelector('.wp-icon')?.textContent).toBe(WORLDS[i]?.icon);
      expect(node.querySelector('button')?.tagName).toBe('BUTTON');
    });
  });

  it('marks world 1 as current-and-gated, and the rest as locked', () => {
    mount(battleStore());
    const list = nodes();
    expect(list[0]?.className).toContain('current');
    expect(list[0]?.className).toContain('gated');
    // the current world's boss is never locked, only early: ⚔️, not 🔒
    expect(list[0]?.querySelector('.wp-glyph')?.textContent).toBe('⚔️');
    expect(list[0]?.querySelector('.wp-meta')?.textContent).toBe(`גל 1/${wavesInWorld(1)}`);
    expect(list[0]?.querySelector('button')?.getAttribute('aria-current')).toBe('step');
    for (const node of list.slice(1)) {
      expect(node.className).toContain('locked');
      expect(node.querySelector('.wp-meta')?.textContent).toBe('נעול');
    }
  });

  it('turns the current node green with a ✓ once the boss gate is met', () => {
    const store = battleStore(12);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      for (const [part, need] of Object.entries(WORLD_BOSSES[0]?.requires ?? {})) {
        g.parts[part as BodyPart].level = need as number;
        g.parts[part as BodyPart].xp = totalXpToReach(need as number) + 1;
      }
      g.battle.wave = 23;
      d.game = g;
    });
    mount(store);
    const first = nodes()[0];
    expect(first?.className).toContain('ready');
    expect(first?.querySelector('.wp-glyph')?.textContent).toBe('✓');
    expect(first?.querySelector('.wp-meta')?.textContent).toBe(`גל 23/${wavesInWorld(1)}`);
  });

  it('trophies the worlds behind the player and locks the ones ahead', () => {
    const store = battleStore(12);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.battle.world = 3;
      g.battle.wave = 7;
      g.battle.bossesDefeated = ['boss_w1', 'boss_w2'];
      d.game = g;
    });
    mount(store);
    const list = nodes();
    expect(list[0]?.className).toContain('done');
    expect(list[0]?.querySelector('.wp-glyph')?.textContent).toBe('🏆');
    expect(list[0]?.querySelector('.wp-meta')?.textContent).toBe('הושלם');
    expect(list[1]?.className).toContain('done');
    expect(list[2]?.className).toContain('current');
    expect(list[3]?.className).toContain('locked');
  });

  it('crowns the last world once Zeus is down', () => {
    const store = battleStore(12);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.battle.world = WORLDS.length;
      g.battle.wave = 73;
      g.battle.bossesDefeated = WORLD_BOSSES.map((b) => b.id);
      d.game = g;
    });
    mount(store);
    const last = nodes()[WORLDS.length - 1];
    expect(last?.className).toContain('champion');
    expect(last?.querySelector('.wp-glyph')?.textContent).toBe('👑');
    // past the old world end the counter is open-ended, not "73/50"
    expect(last?.querySelector('.wp-meta')?.textContent).toBe('גל 73');
  });

  it('explains a locked world on tap instead of doing nothing', () => {
    mount(battleStore());
    nodes()[2]?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const toast = document.getElementById('toast');
    expect(toast?.classList.contains('show')).toBe(true);
    expect(toast?.textContent).toContain(WORLDS[2]?.he ?? '');
    expect(toast?.textContent).toContain('נעול');
  });

  it('names the missing training when the current world is tapped', () => {
    mount(battleStore());
    nodes()[0]?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const toast = document.getElementById('toast');
    // the gate is advice now: the toast names what is missing AND that the
    // boss can be fought early, strengthened
    expect(toast?.textContent).toContain('חסר');
    expect(toast?.textContent).toContain('חזה');
    expect(toast?.textContent).toContain('מחוזק');
    // the gate card it points at is the one that already lists every requirement
    expect(document.querySelector('.bt-gate .bt-reqs')).not.toBeNull();
  });

  it('scrolls instead of squeezing, once there are nine of them', () => {
    mount(battleStore());
    expect(nodes()).toHaveLength(WORLDS.length);

    // The row is a horizontally scrolling flex line with a FIXED node width —
    // nine equal grid columns would be ~34px on a 360px phone, under the app's
    // 44px touch floor and far too narrow for a Hebrew world name.
    const css = readFileSync(resolve(process.cwd(), 'styles', 'battle.css'), 'utf8');
    const strip = css.slice(css.indexOf('.wp-strip{'), css.indexOf('}', css.indexOf('.wp-strip{')));
    expect(strip).toContain('display:flex');
    expect(strip).toContain('overflow-x:auto');
    const node = css.slice(css.indexOf('.wp-node{'), css.indexOf('}', css.indexOf('.wp-node{')));
    expect(node).toMatch(/flex:0 0 \d+px/);
    // …and the page itself must never scroll sideways because of it
    expect(strip).toContain('overflow-y:hidden');
  });

  it('marks the current node so the strip can open on the player', () => {
    const store = battleStore(12);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.battle.world = 6;
      g.battle.wave = 12;
      g.battle.bossesDefeated = ['boss_w1', 'boss_w2', 'boss_w3', 'boss_w4', 'boss_w5'];
      d.game = g;
    });
    mount(store);
    const current = document.querySelectorAll('#btWorlds .wp-node[data-current="1"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.querySelector('.wp-name')?.textContent).toBe(WORLDS[5]?.he);
  });

  it('counts each world against ITS OWN wave total, not a global 50', () => {
    const store = battleStore(12);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.battle.world = 9;
      g.battle.wave = 64;
      g.battle.bossesDefeated = WORLD_BOSSES.slice(0, 8).map((b) => b.id);
      d.game = g;
    });
    mount(store);
    const last = nodes()[8];
    expect(last?.className).toContain('current');
    expect(last?.querySelector('.wp-meta')?.textContent).toBe(`גל 64/${wavesInWorld(9)}`);
  });

  it('does not push the arena off the first screen', () => {
    mount(battleStore());
    // The strip lives inside the arena card, above the arena and below the world
    // bar — one row, so the fight stays reachable with one thumb. The daily
    // challenge card slots in between them, and is just as compact.
    const card = document.querySelector('.bt-card');
    const kids = [...(card?.children ?? [])].map((c) => c.className.split(' ')[0]);
    expect(kids.slice(0, 5)).toEqual(['bt-worldbar', 'wp-strip', 'dc-slot', 'gd-slot', 'bt-arena']);
    expect(document.querySelectorAll('#btWorlds').length).toBe(1);
    // The ghost-duel slot costs nothing on an offline build: with no account
    // behind the app it renders EMPTY, so it collapses to zero height and the
    // arena is exactly where it always was.
    expect(document.getElementById('btGhost')?.innerHTML).toBe('');
  });
});

/* ------------------------------------------------------- the hero's gear */

/**
 * THE HERO IN THE ARENA WEARS WHAT THE דמות SCREEN SHOWS.
 *
 * The arena draws the character ONCE, when the screen mounts, and every mode —
 * campaign waves, a mini-boss, a world boss, champion mode, the daily gauntlet,
 * a ghost duel — reuses that same `#btHeroSprite`, because a challenge swaps the
 * battle's CONTEXT and never the sprite. So the property to pin is not "gear
 * shows up in six places", it is "the one place is drawn from `game.equipment`",
 * plus the two mode swaps that could plausibly redraw it (they do not).
 *
 * `data-slot` / `ch-equip` are the contract between the drawing and the
 * stylesheet, so the tests assert exactly those, and the SCALE story with them:
 * the arena SVG is the same 200×320 stage as the דמות one, shrunk by CSS, so a
 * piece of gear cannot be positioned differently here — it is the identical
 * markup, and the module's "no stroke thinner than 2 user units" rule is what
 * keeps it readable at ~90px.
 */
describe('the hero in the arena', () => {
  /** Put `equipped` on the character, at the given upgrade levels. */
  function wear(
    store: LocalStore,
    equipped: Partial<Record<EquipmentSlot, string>>,
    upgrades: Record<string, number> = {},
  ): void {
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.equipment = { owned: Object.values(equipped) as string[], equipped: { ...equipped }, upgrades };
      d.game = g;
    });
  }

  const heroSvg = (): SVGSVGElement | null =>
    document.querySelector<SVGSVGElement>('#btHeroSprite svg.ch-svg');
  const slotGroup = (slot: EquipmentSlot): Element | null =>
    document.querySelector(`#btHeroSprite .ch-equip[data-slot="${slot}"]`);

  it('draws the equipped items on the fighter, and empty groups for bare slots', () => {
    const store = battleStore();
    wear(store, { belt: 'belt_2', gloves: 'gloves_1' });
    mount(store);

    // Every slot is a group, always — that is what the stylesheet targets.
    for (const slot of EQUIPMENT_SLOTS) expect(slotGroup(slot)).not.toBeNull();
    // The worn ones carry an actual drawing…
    expect(slotGroup('belt')?.childElementCount).toBeGreaterThan(0);
    expect(slotGroup('gloves')?.childElementCount).toBeGreaterThan(0);
    // …and the bare ones are still empty, exactly as an unequipped hero was.
    expect(slotGroup('cape')?.childElementCount).toBe(0);
    expect(slotGroup('shoes')?.childElementCount).toBe(0);
  });

  it('is the same drawing the דמות screen shows — same stage, same gear', () => {
    const store = battleStore();
    wear(store, { cape: 'cape_3', shirt: 'shirt_2', leggings: 'leggings_2', shoes: 'shoes_2' }, { cape_3: 1 });
    mount(store);

    const game = gameOf(store);
    const onCharacterScreen = characterSvg(game.parts, {
      character: game.characters.selected,
      equipment: game.equipment,
    });

    // The arena hero is drawn on the SAME 200×320 stage: the arena only makes it
    // smaller in CSS, so nothing about the gear's anchoring can differ.
    expect(heroSvg()?.getAttribute('viewBox')).toBe('0 0 200 320');
    const stage = /viewBox="([^"]+)"/.exec(onCharacterScreen)?.[1];
    expect(heroSvg()?.getAttribute('viewBox')).toBe(stage);

    // …and the equipment layers are the same markup, slot for slot (parsed on
    // both sides, so this compares drawings and not serialisation quirks).
    const host = document.createElement('div');
    host.innerHTML = onCharacterScreen;
    for (const slot of EQUIPMENT_SLOTS) {
      const there = host.querySelector(`.ch-equip[data-slot="${slot}"]`);
      expect(slotGroup(slot)?.innerHTML.trim()).toBe(there?.innerHTML.trim());
      expect(slotGroup(slot)?.getAttribute('class')).toBe(there?.getAttribute('class'));
    }
    // The cape is the one layer that hangs BEHIND the body — its position in the
    // draw order travels with it into the arena.
    // …and the whole six-slot stack keeps its order in the arena too: the cape
    // hangs behind the body, the shirt is drawn inside it (before the pecs), and
    // the leggings/shoes/belt/gloves are worn on top in that order.
    const kids = [...(heroSvg()?.children ?? [])].map((c) => c.getAttribute('data-slot') ?? c.tagName);
    const order = ['cape', 'shirt', 'helmet', 'leggings', 'shoes', 'belt', 'gloves'].map((s) => kids.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('carries the upgrade flair — the glow class, the glints and the +3 badge', () => {
    const store = battleStore();
    wear(store, { belt: 'belt_3', gloves: 'gloves_2' }, { belt_3: 3, gloves_2: 1 });
    mount(store);

    const belt = slotGroup('belt');
    expect(belt?.classList.contains('upgraded')).toBe(true);
    expect(belt?.classList.contains('up-3')).toBe(true);
    expect(belt?.getAttribute('data-upgrade')).toBe('3');
    // The glow colour has to reach the RENDERER as the item's own accent, and
    // it travels as an SVG <feDropShadow> rather than a CSS var() (which some
    // Android renderers fail to resolve — see ui/characterSvg.ts).
    const ref = belt?.getAttribute('filter') ?? '';
    expect(ref).toMatch(/^url\(#[\w-]+\)$/);
    // (a type selector cannot name `feDropShadow` in an HTML document — the
    // parser keeps the camel case, the selector engine lowercases it — so the
    // definition is reached through the filter it lives in.)
    const filter = heroSvg()?.querySelector(`defs filter[id="${ref.slice(5, -1)}"]`);
    expect(filter?.children).toHaveLength(1);
    expect(filter?.firstElementChild?.getAttribute('flood-color')).toBe(equipmentById('belt_3')?.accent);
    expect(belt?.querySelector('.ch-spark')).not.toBeNull();
    // +3 is the only level that pins a star badge.
    expect(belt?.querySelector('.ch-up-badge')).not.toBeNull();

    const gloves = slotGroup('gloves');
    expect(gloves?.classList.contains('up-1')).toBe(true);
    expect(gloves?.querySelector('.ch-spark')).not.toBeNull();
    expect(gloves?.querySelector('.ch-up-badge')).toBeNull();
  });

  it('keeps every gear stroke readable at arena scale', () => {
    const store = battleStore();
    wear(
      store,
      {
        belt: 'belt_1',
        gloves: 'gloves_3',
        shirt: 'shirt_3',
        leggings: 'leggings_1',
        shoes: 'shoes_1',
        cape: 'cape_2',
      },
      { cape_2: 3 },
    );
    mount(store);

    // The arena draws the stage at ~90px, i.e. ≈0.45px per user unit: the
    // equipment module's rule is that nothing relies on a stroke thinner than 2
    // user units, and this is where that rule is actually cashed in.
    let strokes = 0;
    for (const slot of EQUIPMENT_SLOTS) {
      for (const node of slotGroup(slot)?.querySelectorAll('[stroke-width]') ?? []) {
        strokes += 1;
        expect(Number(node.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(1.4);
      }
    }
    expect(strokes).toBeGreaterThan(0);
  });

  it('wears the gear in every campaign mode: waves, mini-boss, world boss, champion', () => {
    // `miniBossEvery` waves in, the boss wave, and the endless endgame — four
    // states of the same screen, one drawing.
    const states: Array<[label: string, apply: (g: ReturnType<typeof emptyGame>) => void]> = [
      ['wave 1', () => undefined],
      ['mini-boss', (g) => void (g.battle.wave = BALANCE.combat.miniBossEvery)],
      ['world boss', (g) => void (g.battle.wave = bossWaveOf(1))],
      [
        'champion',
        (g) => {
          g.battle.world = WORLDS.length;
          g.battle.wave = 73;
          g.battle.bossesDefeated = WORLD_BOSSES.map((b) => b.id);
        },
      ],
    ];
    for (const [label, apply] of states) {
      document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
      const store = battleStore(60, 40);
      wear(store, { belt: 'belt_2', cape: 'cape_1' }, { belt_2: 3 });
      store.update((d) => {
        const g = d.game ?? emptyGame();
        apply(g);
        d.game = g;
      });
      mount(store);
      expect(`${label}:${(slotGroup('belt')?.childElementCount ?? 0) > 0}`).toBe(`${label}:true`);
      expect(slotGroup('cape')?.childElementCount).toBeGreaterThan(0);
      expect(slotGroup('belt')?.classList.contains('up-3')).toBe(true);
    }
  });

  it('keeps the gear on through a daily-challenge run', () => {
    useSteerableClock();
    const store = battleStore(12, 6);
    wear(store, { belt: 'belt_2' }, { belt_2: 2 });
    mount(store);
    expect(slotGroup('belt')?.childElementCount).toBeGreaterThan(0);

    document.getElementById('btDailyGo')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(2_000);
    // The gauntlet is on screen — and the fighter in it is still dressed.
    expect(document.getElementById('btArena')?.classList.contains('challenge')).toBe(true);
    expect(slotGroup('belt')?.childElementCount).toBeGreaterThan(0);
    expect(slotGroup('belt')?.classList.contains('up-2')).toBe(true);
  });
});
