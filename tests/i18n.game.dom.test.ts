/**
 * @vitest-environment jsdom
 *
 * The game screens in English: the קרב arena (world bar, progress strip, daily
 * card, skill bar, meters, gate card, status line, toasts, the ghost-duel card)
 * and the דמות screen (roster, stat grid, body parts, streak, shop, trophies)
 * render without a Hebrew letter — only user content (a ghost's handle) may be
 * in any language. Switching back to Hebrew restores the original names, and
 * the language never reaches the event log.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGhost } from '../src/core/ghost.ts';
import { onSetCompleted } from '../src/core/game.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { ENEMIES, EQUIPMENT, WORLDS, WORLD_BOSSES, bossWaveOf } from '../src/data/gameContent.ts';
import { BODY_PARTS, findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { setUnits } from '../src/i18n/units.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { GameState } from '../src/storage/DataStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { resetCharacterSheet } from '../src/ui/character.ts';
import type { GhostDuelDeps, GhostLookupRow } from '../src/ui/ghost.ts';
import { RestTimer } from '../src/ui/timer.ts';

const HEBREW = /[֐-׿]/;

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
  // The arena loop falls back to setTimeout, which fake timers can drive.
  delete rafHost.requestAnimationFrame;
  resetCharacterSheet();
});

afterEach(() => {
  vi.useRealTimers();
  rafHost.requestAnimationFrame = realRaf;
  setLocale('he');
  setUnits('metric');
});

/** A signed-in duel port over a Map — no network, like tests/ghost.dom.test.ts. */
class FakeGhosts implements GhostDuelDeps {
  readonly rows = new Map<string, Record<string, unknown>>();
  signedIn(): boolean {
    return true;
  }
  myHandle(): string {
    return 'rotem';
  }
  recent(): readonly string[] {
    return [];
  }
  remember(): void {}
  async fetch(handle: string): Promise<GhostLookupRow | null> {
    const payload = this.rows.get(handle);
    return payload ? { handle, payload } : null;
  }
}

function mount(store: LocalStore, ghost?: GhostDuelDeps): () => void {
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
  const app = createApp(store, timer, ghost ? { ghost } : {});
  app.render();
  return app.render;
}

function levelUp(g: GameState, level: number): void {
  for (const p of BODY_PARTS) {
    g.parts[p as BodyPart].xp = totalXpToReach(level) + 1;
    g.parts[p as BodyPart].level = level;
  }
}

/** A store with `sets` logged sets of ⚡, on `view`, speaking English. */
function englishStore(view: 'BT' | 'CH', sets = 12, mut?: (g: GameState) => void): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  store.update((d) => {
    d.ui.view = view;
    d.ui.locale = 'en';
    if (mut) {
      const g = d.game ?? emptyGame();
      mut(g);
      d.game = g;
    }
  });
  return store;
}

const text = (sel: string): string => document.querySelector(sel)?.textContent ?? '';
const click = (sel: string | Element | null): void => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
/** The shop drawer state outlives a render (module state) — open it only if shut. */
const openCape = (): void => {
  if (!document.querySelector('[data-item="cape_1"]')) click('[data-slot-toggle="cape"]');
};
/** Every aria-label / title / placeholder on the screen. */
const attrs = (root: Element): string[] =>
  [...root.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((e) =>
    ['aria-label', 'title', 'placeholder'].map((a) => e.getAttribute(a) ?? ''),
  );

describe('the arena in English', () => {
  it('speaks English everywhere: header, world bar, strip, daily card, arena, meters, skills, gate', () => {
    mount(englishStore('BT'));
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(text('#header .app-title')).toBe('Battle');
    expect(text('.bt-world b')).toBe('Abandoned Gym');
    expect(text('.bt-world span')).toContain('World 1/');
    expect(text('.bt-world span')).toContain('Rusted iron');
    expect(text('.bt-wave span')).toBe('Wave');
    expect(text('#btFoeName')).toBe(ENEMIES[0]?.en);
    expect(text('.dc-chip')).toBe('🎲 Daily challenge');
    expect(text('#btDailyGo')).toContain('Start the challenge');
    expect(text('#btStatus')).toBe('Tap the enemy to attack and charge your super meter.');
    expect(text('#btSuper')).toBe('💥 Unleash super move');
    expect(text('.bt-skill[data-skill="smash"] .sk-name')).toBe('Crushing Blow');
    expect(text('.bt-skill[data-skill="smash"] .sk-sub')).toBe('Chest Lv 5');
    expect(text('.bt-gate .gc-title')).toContain(`World boss: ${WORLD_BOSSES[0]?.en}`);
    expect(text('.bt-gate')).toContain('Chest Lv 3');
    expect(text('.bt-gate .bt-coach')).toContain('sets a week in your plan');
    expect(text('.wp-node[data-current="1"] .wp-meta')).toBe(`Wave 1/${WORLDS[0]?.waves}`);

    const main = document.getElementById('main') as HTMLElement;
    expect(main.textContent).not.toMatch(HEBREW);
    expect(text('#header')).not.toMatch(HEBREW);
    for (const a of attrs(main)) expect(a, a).not.toMatch(HEBREW);
  });

  it('explains a locked skill, a locked world and the gate in English toasts', () => {
    mount(englishStore('BT'));
    click('.bt-skill[data-skill="smash"]');
    expect(text('#toast')).toBe(
      '🔒 Crushing Blow — unlocks at Chest Lv 5 (now 1). One heavy blow that smashes the enemy.',
    );
    click('.wp-btn[data-world="2"]');
    expect(text('#toast')).toBe('🔒 The Street is still locked — defeat the boss of Abandoned Gym first.');
    click('.wp-btn[data-world="1"]');
    expect(text('#toast')).toContain('Recommended levels missing: Chest Lv 3');
    expect(text('#toast')).not.toMatch(HEBREW);
  });

  it('labels overtime, the early-boss button and the boss itself in English', () => {
    vi.useFakeTimers();
    mount(
      englishStore('BT', 12, (g) => {
        g.battle.wave = bossWaveOf(g.battle.world);
      }),
    );
    expect(text('#btWave')).toBe('OT 1');
    expect(text('#btStatus')).toContain('Overtime wave 1');
    const btn = document.getElementById('btBossFight') as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toMatch(/^⚔️ Early boss fight: Shadow Coach · \+\d+% stronger · \d+ ⚡$/);
    click(btn);
    expect(text('#btFoeName')).toBe(`🏛 ${WORLD_BOSSES[0]?.en}`);
    expect(text('#btStatus')).toContain('Boss fight! Shadow Coach');
    expect(text('#toast')).toBe('🏛 World boss Shadow Coach appears!');
    expect(document.getElementById('main')?.textContent).not.toMatch(HEBREW);
  });

  it('says champion mode in English once the last boss is a trophy', () => {
    mount(
      englishStore('BT', 12, (g) => {
        g.battle.world = WORLDS.length;
        g.battle.wave = bossWaveOf(g.battle.world) + 2;
        g.battle.bossesDefeated = WORLD_BOSSES.map((b) => b.id);
      }),
    );
    expect(text('.bt-world')).toContain('Champion mode');
    expect(text('.bt-gate .gc-title')).toContain('defeated');
    expect(document.getElementById('main')?.textContent).not.toMatch(HEBREW);
  });

  it('runs the daily challenge in English — and writes no English into the log', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-04T10:00:00Z'));
    const store = englishStore('BT', 60, (g) => levelUp(g, 12));
    mount(store);
    click('#btDailyGo');
    expect(text('#toast')).toBe('🎲 Daily challenge — 10 waves, one run. Good luck!');
    expect(text('.dc-count')).toMatch(/^Wave \d+\/10$/);
    expect(text('#btStatus')).toContain('Daily challenge — wave');
    for (let i = 0; i < 300; i += 1) vi.advanceTimersByTime(500);
    expect(text('#toast')).toMatch(/^🎲 Daily challenge: \d+\/10 · \+\d+ 🪙/);
    expect(document.querySelector('.dc')?.getAttribute('data-state')).toBe('done');
    expect(text('.dc')).not.toMatch(HEBREW);

    // Language is presentation: no English content name in any payload.
    const log = JSON.stringify(store.getEvents());
    for (const name of [...ENEMIES, ...WORLD_BOSSES].map((e) => e.en)) expect(log).not.toContain(name);
    expect(log).not.toContain('Daily challenge');
  });

  it('renders the ghost-duel card in English; the opponent keeps their own name', async () => {
    const port = new FakeGhosts();
    const foe = emptyGame();
    levelUp(foe, 3);
    port.rows.set('yossi', buildGhost(foe, 'yossi') as unknown as Record<string, unknown>);
    mount(englishStore('BT', 30), port);
    const input = document.querySelector<HTMLInputElement>('#gdHandle');
    expect(input?.getAttribute('placeholder')).toBe('e.g. Alex');
    expect(text('.gd-chip')).toBe('⚔️ Ghost duel');

    const search = async (h: string): Promise<void> => {
      const field = document.querySelector<HTMLInputElement>('#gdHandle');
      if (field) {
        field.value = h;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      click('#gdFind');
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    };
    await search('nobody');
    expect(text('.gd .gd-note')).toBe(
      'No fighter named "nobody". Check the spelling — your opponent can see their name in Settings.',
    );
    await search('yossi');
    expect(text('.gd-name')).toBe('yossi');
    expect(text('.gd-level')).toBe('Level 3');
    expect(text('#gdFight')).toContain('Start the duel');
    const card = document.querySelector('.gd') as HTMLElement;
    expect(card.textContent).not.toMatch(HEBREW);
    for (const a of attrs(card)) expect(a, a).not.toMatch(HEBREW);
  });
});

describe('the character screen in English', () => {
  it('speaks English: stage, roster, stats, body parts, streak, shop and trophies', () => {
    mount(
      englishStore('CH', 12, (g) => {
        g.battle.coins = 5000;
        g.battle.bossesDefeated = ['boss_w1'];
        g.streak.tier = 1;
        levelUp(g, 4);
      }),
    );
    expect(text('#header .app-title')).toBe('My hero');
    expect(text('.cl-lbl')).toBe('Level');
    expect(text('#charRoster .gc-title')).toContain('Characters');
    expect([...document.querySelectorAll('.chr-body')].map((b) => b.textContent?.trim())).toEqual([
      '🧔 Male',
      '👩 Female',
    ]);
    expect(text('.chr-card[data-skin="robot"] .chr-name')).toBe('Training Robot');
    expect(text('.part-row[data-part="chest"] .part-name')).toContain('Chest');
    expect(text('.part-row[data-part="chest"] .part-level')).toBe('Level 4');
    expect(text('.part-row[data-part="chest"] .part-role')).toBe('Attack power');
    expect(text('#shopCard .gc-title')).toContain('Gear shop');
    expect(text('[data-slot-toggle="helmet"]')).toContain('Helmet');
    expect(text('.trophy b')).toBe(WORLD_BOSSES[0]?.en);
    expect(document.querySelector('.trophy .tr-svg')?.getAttribute('aria-label')).toBe(
      `Trophy: ${WORLD_BOSSES[0]?.en}, ${WORLDS[0]?.en}`,
    );

    // Open a drawer: names, bonus lines and notes of real items.
    openCape();
    const towel = EQUIPMENT.find((e) => e.id === 'cape_1');
    expect(text('.eq-item[data-item="cape_1"] b')).toContain(towel?.en ?? '?');
    expect(text('.eq-item[data-item="cape_1"] .eq-bonus')).toContain('regen');
    expect(text('.eq-item[data-item="cape_1"] .eq-note')).toBe('Not a cape. Still helps you recover.');

    const main = document.getElementById('main') as HTMLElement;
    expect(main.textContent).not.toMatch(HEBREW);
    for (const a of attrs(main)) expect(a, a).not.toMatch(HEBREW);
  });

  it('buys, upgrades and opens the skin sheet with English toasts and copy', () => {
    mount(englishStore('CH', 0, (g) => (g.battle.coins = 5000)));
    openCape();
    click('[data-buy="cape_1"]');
    expect(text('#toast')).toBe(`${EQUIPMENT.find((e) => e.id === 'cape_1')?.en} bought and equipped! ✨`);
    click('[data-upgrade="cape_1"]');
    expect(text('#toast')).toMatch(/upgraded to \+1! ⬆$/);

    click('.chr-card[data-skin="robot"]');
    expect(text('#chrBuy')).toContain('Price:');
    expect(text('#chrBuy')).toContain("Doesn't breathe");
    click('[data-preview-character="robot"]');
    expect(text('.cp-chip')).toBe('👁 Preview — not owned');
    click('[data-buy-character="robot"]');
    expect(text('#toast')).toBe('Training Robot unlocked — on both bodies! 🎭');
    expect(document.getElementById('main')?.textContent).not.toMatch(HEBREW);
  });

  it('switching back to Hebrew restores the Hebrew names', () => {
    const store = englishStore('CH');
    const render = mount(store);
    expect(text('#shopCard .gc-title')).toContain('Gear shop');
    store.update((d) => {
      d.ui.locale = 'he';
    });
    render();
    expect(text('#shopCard .gc-title')).toContain('חנות הציוד');
    expect(text('[data-slot-toggle="helmet"]')).toContain('קסדה');
  });
});
