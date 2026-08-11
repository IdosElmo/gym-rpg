/**
 * @vitest-environment jsdom
 *
 * The skill bar on the קרב screen.
 *
 * The contract this file pins down:
 *   - six slots, in body-part order, rendered from the PART LEVELS (a locked one
 *     names the training that opens it, in Hebrew, and is still a real button);
 *   - a tap on an unlocked slot goes through `useSkill` in the core — the arena
 *     never invents an effect of its own;
 *   - the cooldown UI is driven by the core's own cooldown (the `--cd` custom
 *     property the CSS sweep reads), and a live buff shows a chip on the hero;
 *   - levelling up while the arena is open unlocks the slot with no reload;
 *   - firing skills writes NOTHING to the event log; and
 *   - under `prefers-reduced-motion` the screen does not move and the skill
 *     still works.
 *
 * Time is driven exactly like tests/arena.dom.test.ts: rAF is removed so the
 * loop takes its `setTimeout` branch, and vitest's fake timers push it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { onSetCompleted } from '../src/core/game.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { SKILLS } from '../src/data/gameContent.ts';
import { BODY_PARTS, BODY_PART_HE, findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { RestTimer } from '../src/ui/timer.ts';

const S = BALANCE.skills;

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
const BATTLE_CSS = readFileSync(resolve(process.cwd(), 'styles/battle.css'), 'utf8');

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

/** Energy in the bank, the קרב tab selected, and every part at `level`. */
function battleStore(level = 1, wave = 1, sets = 24): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  store.update((d) => {
    const g = d.game ?? emptyGame();
    for (const p of BODY_PARTS) {
      g.parts[p].level = level;
      g.parts[p].xp = totalXpToReach(level) + 1;
    }
    g.battle.wave = wave;
    d.game = g;
    d.ui.view = 'BT';
  });
  return store;
}

function useSteerableClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-05-04T09:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', undefined);
}

const slots = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>('#btSkills .bt-skill'),
];
const slotOf = (id: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`.bt-skill[data-skill="${id}"]`) as HTMLButtonElement;
const click = (el: Element | null): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const chips = (): string[] =>
  [...document.querySelectorAll('#btBuffs .bt-chip')].map((c) => c.className);

/* ------------------------------------------------------------- the bar */

describe('the skill bar', () => {
  it('renders six slots in body-part order, above the super move', () => {
    mount(battleStore());
    const bar = document.getElementById('btSkills');
    expect(bar).not.toBeNull();
    expect(slots()).toHaveLength(6);
    expect(slots().map((b) => b.dataset['skill'])).toEqual(SKILLS.map((s) => s.id));
    expect(slots().map((b) => b.querySelector('.sk-name')?.textContent)).toEqual(
      SKILLS.map((s) => s.he),
    );
    // …and the parts are the six body parts, in the character-screen order
    expect(SKILLS.map((s) => s.part)).toEqual([...BODY_PARTS]);

    // the bar sits directly above the super-move button
    const card = document.querySelector('.bt-card');
    const kids = [...(card?.children ?? [])].map((c) => c.id || c.className.split(' ')[0]);
    expect(kids.indexOf('btSkills')).toBeLessThan(kids.indexOf('btSuper'));
    expect(kids.indexOf('btSkills')).toBeGreaterThan(-1);
  });

  it('gives every slot a ≥44px touch target', () => {
    mount(battleStore());
    for (const btn of slots()) expect(btn.tagName).toBe('BUTTON');
    // jsdom has no layout, so the floor is asserted where it is declared
    const rule = /\.bt-skill\{[^}]*min-height:(\d+)px/.exec(BATTLE_CSS.replace(/\s+/g, ''));
    expect(Number(rule?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
  });

  it('locks every slot at level 1 and names the training that opens it', () => {
    mount(battleStore(1));
    for (const def of SKILLS) {
      const btn = slotOf(def.id);
      expect(btn.classList.contains('locked')).toBe(true);
      expect(btn.querySelector('.sk-glyph')?.textContent).toBe('🔒');
      expect(btn.querySelector('.sk-sub')?.textContent).toBe(
        `${BODY_PART_HE[def.part]} רמה ${S.unlockLevel}`,
      );
      expect(btn.getAttribute('aria-label')).toContain('נעול');
    }
    // the exact wording the design asked for, on the chest slot
    expect(slotOf('smash').querySelector('.sk-sub')?.textContent).toBe(`חזה רמה ${S.unlockLevel}`);
  });

  it('unlocks a slot as soon as ITS part reaches the threshold, and no sooner', () => {
    const store = battleStore(1);
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.parts['chest'].level = S.unlockLevel;
      g.parts['back'].level = S.unlockLevel - 1;
      d.game = g;
    });
    mount(store);

    expect(slotOf('smash').classList.contains('locked')).toBe(false);
    expect(slotOf('smash').querySelector('.sk-glyph')?.textContent).toBe(
      SKILLS.find((s) => s.id === 'smash')?.icon,
    );
    expect(slotOf('guard').classList.contains('locked')).toBe(true);
    expect(slotOf('quake').classList.contains('locked')).toBe(true);
  });

  it('explains a locked slot in Hebrew on tap, and fires nothing', () => {
    mount(battleStore(1));
    const foe = document.getElementById('btFoeHp') as HTMLElement;
    const before = foe.style.width;

    click(slotOf('smash'));
    const toast = document.getElementById('toast');
    expect(toast?.classList.contains('show')).toBe(true);
    expect(toast?.textContent).toContain('מכת מחץ');
    expect(toast?.textContent).toContain(`חזה רמה ${S.unlockLevel}`);
    // nothing happened to the fight, and no cooldown was started
    expect(foe.style.width).toBe(before);
    expect(slotOf('smash').classList.contains('cooling')).toBe(false);
  });
});

/* ------------------------------------------------------- firing a skill */

describe('firing a skill', () => {
  it('hurts the enemy through the core and puts the slot on cooldown', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 30));
    const foe = document.getElementById('btFoeHp') as HTMLElement;
    expect(parseFloat(foe.style.width)).toBe(100);

    click(slotOf('smash'));
    expect(parseFloat(foe.style.width)).toBeLessThan(100);
    const btn = slotOf('smash');
    expect(btn.classList.contains('cooling')).toBe(true);
    expect(btn.classList.contains('ready')).toBe(false);
    expect(Number(btn.style.getPropertyValue('--cd'))).toBeCloseTo(1, 2);
    expect(btn.querySelector('.sk-sub')?.textContent).toBe(`${S.smash.cooldownMs / 1000}s`);
    // a big number floated over the arena
    expect(document.querySelector('#btFx .bt-float.super')).not.toBeNull();
  });

  it('refuses a second activation and says how long is left', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 30));
    click(slotOf('smash'));
    vi.advanceTimersByTime(2000);

    click(slotOf('smash'));
    const toast = document.getElementById('toast');
    expect(toast?.textContent).toContain('מכת מחץ');
    expect(toast?.textContent).toContain('שניות');
  });

  it('unwinds the cooldown sweep as time passes, then comes back ready', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 30));
    click(slotOf('focus')); // the shortest cooldown in the set
    const btn = slotOf('focus');
    const start = Number(btn.style.getPropertyValue('--cd'));

    vi.advanceTimersByTime(S.focus.cooldownMs / 2);
    const half = Number(slotOf('focus').style.getPropertyValue('--cd'));
    expect(half).toBeLessThan(start);
    expect(half).toBeGreaterThan(0);

    vi.advanceTimersByTime(S.focus.cooldownMs / 2 + 500);
    const done = slotOf('focus');
    expect(done.classList.contains('cooling')).toBe(false);
    expect(done.classList.contains('ready')).toBe(true);
    expect(done.querySelector('.sk-sub')?.textContent).toBe('מוכן');
  });

  it('shows a buff chip on the hero for a timed skill, and takes it off again', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 30));
    expect(chips()).toHaveLength(0);

    click(slotOf('guard'));
    expect(chips().some((c) => c.includes('sk-guard'))).toBe(true);
    expect(slotOf('guard').classList.contains('live')).toBe(true);

    vi.advanceTimersByTime(S.guard.durationMs + 1000);
    expect(chips().some((c) => c.includes('sk-guard'))).toBe(false);
    expect(slotOf('guard').classList.contains('live')).toBe(false);
  });

  it('heals the hero with נשימה עמוקה', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 40));
    const hpBar = document.getElementById('btHeroHp') as HTMLElement;
    // take some damage first
    vi.advanceTimersByTime(9000);
    const hurt = parseFloat(hpBar.style.width);
    expect(hurt).toBeLessThan(100);

    click(slotOf('breath'));
    expect(parseFloat(hpBar.style.width)).toBeGreaterThan(hurt);
    expect(document.querySelector('#btFx .bt-float.heal')).not.toBeNull();
  });

  it('poses the hero and flexes the trained body part', () => {
    useSteerableClock();
    mount(battleStore(S.unlockLevel, 30));
    const hero = document.getElementById('btHeroSprite') as HTMLElement;

    click(slotOf('smash'));
    expect(hero.classList.contains('anim-skill')).toBe(true);
    expect(hero.classList.contains('sk-chest')).toBe(true);
    expect(document.getElementById('btFx')?.classList.contains('fx-smash')).toBe(true);

    // and the markers come off again, so nothing is left mid-pose
    vi.advanceTimersByTime(1200);
    expect(hero.classList.contains('anim-skill')).toBe(false);
    expect(hero.classList.contains('sk-chest')).toBe(false);
  });

  it('unlocks a slot mid-battle when the part levels up — no reload', () => {
    useSteerableClock();
    const store = battleStore(S.unlockLevel - 1, 30);
    mount(store);
    expect(slotOf('smash').classList.contains('locked')).toBe(true);

    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.parts['chest'].level = S.unlockLevel;
      g.parts['chest'].xp = totalXpToReach(S.unlockLevel) + 1;
      d.game = g;
    });
    vi.advanceTimersByTime(200); // one loop frame re-reads the levels

    expect(slotOf('smash').classList.contains('locked')).toBe(false);
    expect(slotOf('guard').classList.contains('locked')).toBe(true);
  });

  it('writes nothing to the event log — a skill is tactics, not history', () => {
    useSteerableClock();
    const store = battleStore(S.unlockLevel, 30);
    mount(store);
    const before = store.getEvents().length;
    const kindsBefore = new Set(store.getEvents().map((e) => e.type));

    for (const def of SKILLS) click(slotOf(def.id));
    vi.advanceTimersByTime(1000);

    const after = store.getEvents();
    expect(after.length).toBe(before); // no wave was cleared in that second
    for (const ev of after) expect(kindsBefore.has(ev.type)).toBe(true);
    expect(after.some((e) => String(e.type).includes('skill'))).toBe(false);
  });
});

/* ------------------------------------------------------- reduced motion */

describe('reduced motion', () => {
  it('skips the screen shake but keeps the skill working', () => {
    vi.stubGlobal('matchMedia', ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia);

    mount(battleStore(S.unlockLevel, 30));
    const foe = document.getElementById('btFoeHp') as HTMLElement;
    click(slotOf('smash'));

    // the shake is the one thing guarded in JS…
    const arena = document.getElementById('btArena');
    expect(arena?.classList.contains('shake')).toBe(false);
    expect(arena?.classList.contains('shake-strong')).toBe(false);
    // …everything else is a marker whose keyframes the global rule switches off
    expect(document.getElementById('btHeroSprite')?.classList.contains('anim-skill')).toBe(true);
    // and the skill itself did its job
    expect(parseFloat(foe.style.width)).toBeLessThan(100);
    expect(slotOf('smash').classList.contains('cooling')).toBe(true);
    expect(document.querySelector('#btHeroSprite .ch-svg')).not.toBeNull();
  });
});
