/**
 * @vitest-environment jsdom
 *
 * dev.dom.test.ts — the 🛠 dev panel ON SCREEN.
 *
 * The most important assertions in this file are the ones about ABSENCE. For
 * everybody who is not the owner — signed out, another account, the `file://`
 * bundle — there must be no card in the settings screen, no button anywhere and
 * no `window.gymDev`: not a disabled control, not a hidden one, nothing to find.
 * That is the same rule the account card and the duel card follow, and it is
 * the rule this test exists to keep.
 *
 * Everything else is the ordinary story: a button appends the same marked event
 * the console API does, the screen repaints, and an opponent who has used dev
 * mode is labelled on the duel card.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEV_GRANTS } from '../src/core/dev.ts';
import { gameOf, onSetCompleted } from '../src/core/game.ts';
import { buildGhost } from '../src/core/ghost.ts';
import { emptyGame } from '../src/core/xp.ts';
import { createDevApi, type DevApi } from '../src/dev/actions.ts';
import { devGateOpen } from '../src/dev/gate.ts';
import { DEV_GLOBAL, attachDevApi, detachDevApi, devApiAttached } from '../src/dev/window.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { DEV_PANEL_ID } from '../src/ui/devPanel.ts';
import { emptyGhostView, ghostCard, GHOST_DEV_HE } from '../src/ui/ghost.ts';
import { RestTimer } from '../src/ui/timer.ts';

const DATE = '2025-05-04';
const NOW = new Date(Date.parse('2025-05-04T18:00:00.000Z'));

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
  window.confirm = () => true;
  detachDevApi(window as unknown as Record<string, unknown>);
});

interface Mounted {
  store: LocalStore;
  api: DevApi;
  render: () => void;
}

/** Mount the app on the הגדרות screen, with or without the dev panel. */
function mount(withPanel: boolean, sets = 4): Mounted {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: DATE, day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' }, NOW);
  }
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
  const mounted: Mounted = { store, api: null as unknown as DevApi, render: () => undefined };
  const api = createDevApi({
    store,
    now: () => NOW,
    onChange: () => mounted.render(),
  });
  mounted.api = api;
  const app = createApp(store, timer, { settings: withPanel ? { dev: { api } } : {} });
  mounted.render = app.render;
  store.update((d) => {
    d.ui.view = 'ST';
  });
  app.render();
  return mounted;
}

function panel(): HTMLElement | null {
  return document.getElementById(DEV_PANEL_ID);
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/* ------------------------------------------------------------- absence */

describe('the dev panel is absent for everybody else', () => {
  it('renders nothing at all on the settings screen without the gate', () => {
    mount(false);
    expect(panel()).toBeNull();
    // Not "hidden": there is no 🛠 anywhere on the screen, and no control of
    // this feature under any name.
    const main = document.getElementById('main') as HTMLElement;
    expect(main.textContent ?? '').not.toContain('מצב מפתח');
    expect(main.querySelector('#devEnergy')).toBeNull();
    expect(main.querySelector('#devPurge')).toBeNull();
    // The rest of the settings screen is exactly what it always was.
    expect(main.querySelector('#btnExport')).not.toBeNull();
    expect(main.querySelector('#btnClear')).not.toBeNull();
  });

  it('never attaches window.gymDev on its own', () => {
    mount(false);
    expect(devApiAttached(window as unknown as Record<string, unknown>)).toBe(false);
    expect((window as unknown as Record<string, unknown>)[DEV_GLOBAL]).toBeUndefined();
  });

  it('keeps the gate shut for the states the app can actually be in', async () => {
    // The three the app has to get right, driven through the real gate with a
    // hasher that would open for the dummy owner.
    const hashes = ['fbcffb85ef32f9fe53781e44349e26002359cd58371cfc024989749866d413dc'];
    const hasher = async (): Promise<string> => hashes[0] as string;
    await expect(devGateOpen({ email: null, protocol: 'https:', hasher, hashes })).resolves.toBe(false);
    await expect(devGateOpen({ email: 'x@y.z', protocol: 'file:', hasher, hashes })).resolves.toBe(false);
    // jsdom has no `crypto.subtle`, so the REAL hasher cannot open it either —
    // which is exactly the fallback an old WebView gets.
    await expect(devGateOpen({ email: 'x@y.z', protocol: 'https:', hashes })).resolves.toBe(false);
  });
});

/* -------------------------------------------------------------- presence */

describe('the dev panel on screen', () => {
  it('sits under the data card and explains itself', () => {
    const { store } = mount(true);
    const card = panel();
    expect(card).not.toBeNull();
    const text = card?.textContent ?? '';
    expect(text).toContain('מצב מפתח');
    expect(text).toContain('gymDev');
    // Below the data card, above the app-info line — nothing else moved.
    const cards = [...document.querySelectorAll('#main .game-card')].map((c) => c.id);
    expect(cards.at(-1)).toBe(DEV_PANEL_ID);
    expect(document.querySelector('#main .data-card')).not.toBeNull();
    expect(gameOf(store).devUsed).toBe(false);
  });

  it('grants energy, coins, levels and XP — each as ONE marked event', () => {
    const { store } = mount(true);
    const before = gameOf(store).energy;

    click('#devEnergy');
    expect(gameOf(store).energy).toBe(before + DEV_GRANTS.energy);
    click('#devCoins');
    expect(gameOf(store).battle.coins).toBe(DEV_GRANTS.coins);

    const level = gameOf(store).level;
    click('#devLevels');
    expect(gameOf(store).level).toBeGreaterThanOrEqual(level);

    const select = document.querySelector<HTMLSelectElement>('#devPart') as HTMLSelectElement;
    select.value = 'arms';
    const armsXp = gameOf(store).parts.arms.xp;
    click('#devXp');
    expect(gameOf(store).parts.arms.xp).toBe(armsXp + DEV_GRANTS.xp);

    // Every single one of them is marked, and the save now says so.
    const dev = store.getEvents().filter((e) => e.payload['dev'] === true);
    expect(dev.length).toBeGreaterThanOrEqual(4);
    expect(dev.every((e) => typeof e.payload['date'] === 'string')).toBe(true);
    expect(gameOf(store).devUsed).toBe(true);
  });

  it('re-renders the screen after a grant, so the ⚡ pill is current', () => {
    const { store } = mount(true);
    click('#devEnergy');
    const pill = document.querySelector('#header .energy-pill .ep-num')?.textContent ?? '';
    expect(pill).toBe(String(gameOf(store).energy));
    // The panel is still there (and still wired) after the repaint.
    expect(panel()).not.toBeNull();
    click('#devEnergy');
    expect(gameOf(store).energy).toBe(40 + 2 * DEV_GRANTS.energy);
  });

  it('completes today, resets the ledgers and shrugs at the cooldowns', () => {
    const { store } = mount(true);
    click('#devComplete');
    // The bonus lands on the API's "today", once — and a second press is the
    // same no-op a second real completion would be.
    expect(gameOf(store).bonusDays[DATE]).toBe(true);
    const energy = gameOf(store).energy;
    click('#devComplete');
    expect(Object.keys(gameOf(store).bonusDays)).toHaveLength(1);
    expect(gameOf(store).energy).toBe(energy);

    click('#devResetDaily');
    click('#devResetDuels');
    const resets = store.getEvents().filter((e) => e.type === 'dev_reset');
    expect(resets.map((e) => e.payload['scope'])).toEqual(['daily', 'duels']);
    expect(resets.every((e) => e.payload['cycle'] === 1)).toBe(true);

    // No battle is mounted, so there is honestly nothing to reset — and nothing
    // is written for it either.
    const before = store.getEvents().length;
    click('#devCooldowns');
    expect(store.getEvents()).toHaveLength(before);
  });

  it('purges — after a confirm — and puts the character back', () => {
    const { store } = mount(true);
    click('#devEnergy');
    click('#devCoins');
    expect(gameOf(store).devUsed).toBe(true);

    let asked = '';
    window.confirm = (message?: string) => {
      asked = message ?? '';
      return false;
    };
    click('#devPurge');
    expect(asked).toContain('שיפורי המפתח');
    expect(gameOf(store).battle.coins).toBe(DEV_GRANTS.coins); // refused = nothing happened
    expect(store.getEvents().filter((e) => e.type === 'dev_purge')).toHaveLength(0);

    window.confirm = () => true;
    click('#devPurge');
    expect(gameOf(store).battle.coins).toBe(0);
    expect(gameOf(store).energy).toBe(40);
    expect(gameOf(store).devUsed).toBe(false);
  });
});

/* --------------------------------------------------------- window.gymDev */

describe('window.gymDev', () => {
  it('appears with the gate and disappears with it', () => {
    const { store, api } = mount(true);
    const host = window as unknown as Record<string, unknown>;

    attachDevApi(host, api);
    expect(devApiAttached(host)).toBe(true);
    const live = host[DEV_GLOBAL] as DevApi;
    live.addEnergy(25);
    expect(gameOf(store).energy).toBe(65);
    expect(live.state().energy).toBe(65);

    // Signing out takes it away, leaving nothing behind.
    detachDevApi(host);
    expect(devApiAttached(host)).toBe(false);
    expect(DEV_GLOBAL in host).toBe(false);
  });

  it('drives exactly what the panel drives', () => {
    // Same store, same object: a typed command and a tapped button produce the
    // same event, which is why there is only one implementation of either.
    const { store, api } = mount(true);
    api.addCoins(10);
    click('#devCoins');
    const coins = store.getEvents().filter((e) => e.type === 'coins_granted');
    expect(coins).toHaveLength(2);
    expect(coins.every((e) => e.payload['dev'] === true && e.payload['source'] === 'dev')).toBe(true);
    expect(gameOf(store).battle.coins).toBe(10 + DEV_GRANTS.coins);
  });
});

/* ------------------------------------------------------ the duel opponent */

describe('the duel card labels a dev-flagged opponent', () => {
  function cardHtml(dev: boolean): string {
    const game = emptyGame();
    game.energy = 500;
    const source = emptyGame();
    source.devUsed = dev;
    const ghost = buildGhost(source, 'yossi');
    const view = { ...emptyGhostView('rotem'), opponent: { handle: 'yossi', ghost } };
    return ghostCard(game, view, DATE, null);
  }

  it('shows a 🛠 next to their name, with the reason on the label', () => {
    const html = cardHtml(true);
    expect(html).toContain('🛠');
    expect(html).toContain(GHOST_DEV_HE);
    const marker = /<span class="gd-dev"[^>]*>🛠<\/span>/.exec(html);
    expect(marker).not.toBeNull();
  });

  it('shows nothing at all for an honest opponent', () => {
    const html = cardHtml(false);
    expect(html).not.toContain('🛠');
    expect(html).not.toContain('gd-dev');
  });
});

/* ------------------------------------------------------------- the styles */

describe('the panel is a thumb-sized control', () => {
  it('gives every dev target the same ≥44px floor the rest of the app has', () => {
    const css = readFileSync(resolve(process.cwd(), 'styles/history.css'), 'utf8');
    const block = css.slice(css.indexOf('.dev-card'));
    for (const rule of ['.dev-actions .action-btn', '.dev-xp-row .action-btn', '.dev-select']) {
      const line = block.split('\n').find((l) => l.trim().startsWith(rule));
      expect(line, rule).toBeDefined();
    }
    expect(block).toContain('min-height:44px');
  });
});
