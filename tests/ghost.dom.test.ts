/**
 * @vitest-environment jsdom
 *
 * The ghost duel ON SCREEN: the card's states, the lookup, the preview, the
 * fight, the result — and the one state that matters most, ABSENT, because
 * there is no account behind the app.
 *
 * NOTHING HERE TOUCHES A NETWORK. The `GhostDuelDeps` port is implemented over
 * a `Map`, exactly the way `main.ts` implements it over the sync engine, so the
 * whole flow runs against the real screens with no client, no fetch and no
 * timers of anyone else's.
 *
 * DRIVING A WHOLE DUEL, like the daily-challenge tests: the rAF is taken away
 * so the arena loop falls back to `setTimeout`, and fake timers feed the
 * simulation one fixed tick per callback.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { buildGhost, ghostHash, type GhostPayload } from '../src/core/ghost.ts';
import { gameOf, onSetCompleted } from '../src/core/game.ts';
import { todayISO } from '../src/core/workout.ts';
import { emptyGame, totalXpToReach } from '../src/core/xp.ts';
import { BODY_PARTS, findExercise, type BodyPart, type Exercise } from '../src/data/program.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, GameState } from '../src/storage/DataStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import type { GhostDuelDeps, GhostLookupRow } from '../src/ui/ghost.ts';
import { RestTimer } from '../src/ui/timer.ts';

const FEE = BALANCE.duel.entryEnergy;
const FOE = 'yossi';

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
  delete rafHost.requestAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  rafHost.requestAnimationFrame = realRaf;
});

/* ------------------------------------------------------------- the port */

/** The `ghosts` table plus the device-local bookkeeping, in ten lines. */
class FakeGhosts implements GhostDuelDeps {
  readonly rows = new Map<string, Record<string, unknown>>();
  readonly remembered: string[] = [];
  signedInNow = true;
  handle = 'rotem';
  lookups: string[] = [];
  /** Set to make the next lookup reject, like a dead connection. */
  failNext = false;

  signedIn(): boolean {
    return this.signedInNow;
  }
  myHandle(): string {
    return this.signedInNow ? this.handle : '';
  }
  recent(): readonly string[] {
    return this.remembered;
  }
  remember(handle: string): void {
    if (!this.remembered.includes(handle)) this.remembered.unshift(handle);
  }
  async fetch(handle: string): Promise<GhostLookupRow | null> {
    this.lookups.push(handle);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('offline');
    }
    const payload = this.rows.get(handle);
    return payload ? { handle, payload } : null;
  }
  /** Publish somebody, the way their own device would have. */
  publish(handle: string, ghost: GhostPayload): void {
    this.rows.set(handle, ghost as unknown as Record<string, unknown>);
  }
}

/* ---------------------------------------------------------------- mount */

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

/** A store on the קרב tab with `sets × 10` ⚡ in the bank, at part level `level`. */
function battleStore(sets = 6, level = 1): LocalStore {
  const store = new LocalStore(fakeStorage());
  for (let i = 0; i < sets; i += 1) {
    onSetCompleted(store, { date: '2025-05-04', day: 'A', ex: ex('a1'), setIndex: i, w: '40', r: '10' });
  }
  store.update((d) => {
    d.ui.view = 'BT';
    if (level > 1) {
      const g = d.game ?? emptyGame();
      for (const p of BODY_PARTS) {
        g.parts[p as BodyPart].xp = totalXpToReach(level) + 1;
        g.parts[p as BodyPart].level = level;
      }
      d.game = g;
    }
  });
  return store;
}

/** A ghost of a character at `level`, as their device would have published it. */
function ghostAt(level: number, name = FOE): GhostPayload {
  const game: GameState = emptyGame();
  for (const p of BODY_PARTS) {
    game.parts[p].xp = totalXpToReach(level) + 1;
    game.parts[p].level = level;
  }
  return buildGhost(game, name);
}

const card = (): HTMLElement | null => document.querySelector<HTMLElement>('#btGhost .gd');
const cardState = (): string => card()?.dataset['state'] ?? '';
const input = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('#gdHandle');
const findBtn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('#gdFind');
const fightBtn = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('#gdFight');
const click = (el: Element | null): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const duelEvents = (store: LocalStore): readonly AppEvent[] =>
  store.getEvents().filter((e) => e.type === 'ghost_duel');

/** Let the lookup's promise chain settle (microtasks only — no real waiting). */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/** Type a handle and press the search button. */
async function search(handle: string): Promise<void> {
  const field = input();
  if (field) {
    field.value = handle;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  click(findBtn());
  await settle();
}

/** Drive the loop until the duel is over, and no further. */
function advanceUntilDone(limitMs = 300_000): void {
  for (let t = 0; t < limitMs && cardState() === 'live'; t += 2_000) vi.advanceTimersByTime(2_000);
  expect(cardState()).not.toBe('live');
}

/* ------------------------------------------------------------- the card */

describe('the ghost duel card', () => {
  it('does not exist at all without an account', () => {
    // The offline app: no port at all.
    mount(battleStore());
    expect(card()).toBeNull();
    expect(document.getElementById('btGhost')?.innerHTML).toBe('');

    // Configured, but signed out: still absent, not disabled.
    const port = new FakeGhosts();
    port.signedInNow = false;
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    mount(battleStore(), port);
    expect(card()).toBeNull();
  });

  it('sits under the daily card and invites a lookup', () => {
    mount(battleStore(), new FakeGhosts());
    expect(cardState()).toBe('idle');
    expect(card()?.textContent).toContain('דו־קרב רפאים');
    // My own name is on the card, so it can be read out to the other player.
    expect(card()?.textContent).toContain('rotem');
    expect(input()?.tagName).toBe('INPUT');
    expect(findBtn()?.tagName).toBe('BUTTON');
    expect(card()?.textContent).toContain(`${FEE} ⚡`);
    // The duel card comes after the daily one, both above the arena.
    const kids = [...(document.querySelector('.bt-card')?.children ?? [])].map((c) => c.className.split(' ')[0]);
    expect(kids.indexOf('gd-slot')).toBe(kids.indexOf('dc-slot') + 1);
  });

  it('says so in Hebrew when nobody answers to that name', async () => {
    mount(battleStore(), new FakeGhosts());
    await search('nobody');
    expect(cardState()).toBe('missing');
    expect(card()?.textContent).toContain('לא נמצא לוחם');
    expect(card()?.textContent).toContain('nobody');
    expect(fightBtn()).toBeNull();
  });

  it('refuses an impossible name before it ever asks the server', async () => {
    const port = new FakeGhosts();
    mount(battleStore(), port);
    await search('x');
    expect(cardState()).toBe('missing');
    expect(card()?.textContent).toContain('3 תווים');
    await search('yossi🔥');
    expect(card()?.textContent).toContain('אותיות');
    // …and refuses to fight yourself.
    await search('rotem');
    expect(card()?.textContent).toContain('זה אתם');
    expect(port.lookups).toEqual([]);
  });

  it('explains a failed lookup without pretending nobody is there', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(5));
    port.failNext = true;
    mount(battleStore(), port);
    await search(FOE);
    expect(cardState()).toBe('missing');
    expect(card()?.textContent).toContain('החיפוש נכשל');
  });

  it('refuses a payload it cannot read', async () => {
    const port = new FakeGhosts();
    port.rows.set(FOE, { v: 99, name: FOE });
    mount(battleStore(), port);
    await search(FOE);
    expect(cardState()).toBe('missing');
    expect(card()?.textContent).toContain('גרסה אחרת');
  });

  it('previews the opponent: their character, level and the record so far', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(7));
    mount(battleStore(6, 5), port);
    await search(' YOSSI ');

    expect(cardState()).toBe('ready');
    expect(card()?.textContent).toContain(FOE);
    expect(card()?.textContent).toContain('רמה 7');
    expect(card()?.textContent).toContain('עוד לא נפגשתם');
    // Their actual character is drawn — a real SVG, not a sprite.
    const figure = document.querySelector('#btGhost .gd-figure svg');
    expect(figure).not.toBeNull();
    expect(figure?.getAttribute('data-character')).toBe('hero_m');
    expect(fightBtn()?.textContent).toContain(`${FEE} ⚡`);
    // The name was canonicalised before the lookup, and remembered after it.
    expect(port.lookups).toEqual([FOE]);
    expect(port.recent()).toEqual([FOE]);
  });

  it('locks when the ⚡ is short, and writes nothing when tapped', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(3));
    const store = battleStore(1); // 10 ⚡, the fee is 20
    mount(store, port);
    await search(FOE);

    expect(cardState()).toBe('locked');
    expect(fightBtn()?.textContent).toContain('🔒');
    click(fightBtn());
    expect(document.getElementById('toast')?.textContent).toContain('אנרגיה');
    expect(duelEvents(store)).toHaveLength(0);
    expect(document.getElementById('btArena')?.classList.contains('duel')).toBe(false);
  });
});

/* ------------------------------------------------------------ the fight */

describe('fighting a ghost', () => {
  it('frames the arena in violet, names both bars and mirrors the opponent', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(6));
    mount(battleStore(6, 6), port);
    await search(FOE);
    click(fightBtn());

    expect(cardState()).toBe('live');
    expect(document.querySelector('.bt-card')?.classList.contains('duel')).toBe(true);
    expect(document.getElementById('btArena')?.classList.contains('duel')).toBe(true);
    // …and not the daily challenge's amber frame.
    expect(document.getElementById('btArena')?.classList.contains('challenge')).toBe(false);
    expect(document.getElementById('btEnemySprite')?.classList.contains('ghost')).toBe(true);
    expect(document.getElementById('btFoeName')?.textContent).toContain(FOE);
    expect(document.getElementById('btHeroName')?.textContent).toBe('אתם');
    expect(document.getElementById('btWave')?.textContent).toBe('⚔️');
    const status = document.getElementById('btStatus');
    expect(status?.textContent).toContain('דו־קרב');
    expect(status?.classList.contains('duel')).toBe(true);
    // The opponent on screen is a CHARACTER, drawn from their own snapshot.
    expect(document.querySelector('#btEnemySprite svg')?.getAttribute('data-character')).toBe('hero_m');
  });

  it('records ONE event when it ends, charges the fee and pays no coins', async () => {
    vi.useFakeTimers();
    const port = new FakeGhosts();
    const ghost = ghostAt(2);
    port.publish(FOE, ghost);
    const store = battleStore(6, 8); // strong enough to win
    mount(store, port);
    await search(FOE);
    const energyBefore = gameOf(store).energy;
    const coinsBefore = gameOf(store).battle.coins;
    click(fightBtn());
    advanceUntilDone();

    const events = duelEvents(store);
    expect(events).toHaveLength(1);
    const p = events[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(
      [
        'date',
        'durationMs',
        'energySpent',
        'opponentHandle',
        'opponentName',
        'outcome',
        'score',
        'seed',
        'snapshotHash',
        'tiebreak',
        'won',
      ].sort(),
    );
    expect(p['date']).toBe(todayISO());
    expect(p['opponentHandle']).toBe(FOE);
    expect(p['won']).toBe(true);
    expect(p['energySpent']).toBe(FEE);
    // The snapshot that was actually fought is named in the record.
    expect(p['snapshotHash']).toBe(ghostHash(ghost));

    const game = gameOf(store);
    expect(game.energy).toBe(energyBefore - FEE);
    expect(game.battle.coins).toBe(coinsBefore);
    expect(game.duels.wins).toBe(1);
    expect(game.duels.byOpponent[FOE]).toEqual({ wins: 1, losses: 0, duels: 1 });
    // The campaign was not touched.
    expect(game.battle.wavesCleared).toBe(0);
    expect(store.getEvents().some((e) => e.type === 'wave_cleared')).toBe(false);

    // The card shows the verdict…
    expect(cardState()).toBe('done');
    expect(card()?.textContent).toContain('ניצחתם');
    expect(card()?.textContent).toContain('מחר');
    expect(document.getElementById('toast')?.textContent).toContain('ניצחתם');
    expect(fightBtn()).toBeNull();
    // …and a beat later the arena is the ordinary battle again.
    vi.advanceTimersByTime(4_000);
    expect(document.getElementById('btArena')?.classList.contains('duel')).toBe(false);
    expect(document.getElementById('btHeroName')?.textContent).toBe('');
  });

  it('records a LOSS the same way when the ghost wins', async () => {
    vi.useFakeTimers();
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(14));
    const store = battleStore(6, 3);
    mount(store, port);
    await search(FOE);
    click(fightBtn());
    advanceUntilDone();

    const p = duelEvents(store)[0]?.payload ?? {};
    expect(p['won']).toBe(false);
    expect(p['outcome']).toBe('defeated');
    expect(gameOf(store).duels.losses).toBe(1);
    expect(gameOf(store).battle.coins).toBe(0);
    expect(card()?.textContent).toContain('הפסדתם');
  });

  it('refuses a second duel with the same opponent today, and says why', async () => {
    vi.useFakeTimers();
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(2));
    const store = battleStore(12, 8);
    mount(store, port);
    await search(FOE);
    click(fightBtn());
    advanceUntilDone();
    vi.advanceTimersByTime(4_000);

    // Re-mounting the screen and looking them up again shows the verdict, not
    // another button.
    const render = mount(store, port);
    render();
    await search(FOE);
    expect(cardState()).toBe('done');
    expect(fightBtn()).toBeNull();
    expect(duelEvents(store)).toHaveLength(1);
    expect(gameOf(store).duels.duels).toBe(1);
  });

  it('counts leaving the arena mid-duel as a loss — once', async () => {
    vi.useFakeTimers();
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(10));
    const store = battleStore(6, 6);
    mount(store, port);
    await search(FOE);
    click(fightBtn());
    vi.advanceTimersByTime(2_000);
    expect(cardState()).toBe('live');
    expect(duelEvents(store)).toHaveLength(0);

    click(document.querySelector('#tabs .tab[data-view="CH"]'));
    const events = duelEvents(store);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload['outcome']).toBe('forfeit');
    expect(events[0]?.payload['won']).toBe(false);
    expect(events[0]?.payload['energySpent']).toBe(FEE);
    expect(gameOf(store).duels.losses).toBe(1);
    expect(gameOf(store).battle.coins).toBe(0);

    // And the duel is spent: coming back offers no rematch today.
    click(document.querySelector('#tabs .tab[data-view="BT"]'));
    await search(FOE);
    expect(cardState()).toBe('done');
    expect(duelEvents(store)).toHaveLength(1);
  });

  it('keeps the two challenge cards apart: one arena, one fight', async () => {
    vi.useFakeTimers();
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(6));
    const store = battleStore(12, 6); // enough ⚡ for both fees
    mount(store, port);
    await search(FOE);
    click(fightBtn());
    vi.advanceTimersByTime(2_000);

    // The daily card must NOT read the duel as its own live run.
    const daily = document.querySelector<HTMLElement>('#btDaily .dc');
    expect(daily?.dataset['state']).not.toBe('live');
    // …and the daily challenge cannot start on top of a duel.
    click(document.querySelector('#btDailyGo'));
    expect(document.getElementById('toast')?.textContent).toContain('דו־קרב');
    expect(store.getEvents().filter((e) => e.type === 'daily_challenge')).toHaveLength(0);
    expect(cardState()).toBe('live');
  });

  it('remembers recent opponents for next time', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, ghostAt(4));
    port.publish('dana', ghostAt(4, 'dana'));
    mount(battleStore(6, 5), port);
    await search(FOE);
    await search('dana');
    expect(port.recent()).toEqual(['dana', FOE]);
    // The shortlist is on the card as a datalist, not as a leaderboard.
    const options = [...document.querySelectorAll('#gdRecent option')].map((o) => o.getAttribute('value'));
    expect(options).toContain(FOE);
  });
});

/* ------------------------------------------------------------- both kits */

/**
 * A DUEL IS TWO DRESSED CHARACTERS.
 *
 * The player's half is the same `#btHeroSprite` every other mode uses (drawn
 * from `game.equipment` — swept in `tests/arena.dom.test.ts`), so what is worth
 * pinning here is that a duel does not undress either side: MY gear is on me,
 * THEIR gear — from their published snapshot, not from my save — is on them, in
 * the preview card and in the arena, and a hostile row's invented items put
 * nothing on anybody.
 */
describe('a duel dresses both fighters', () => {
  /** Publish a ghost wearing `equipped`, at the given upgrade levels. */
  function dressedGhost(level: number, equipped: Record<string, string>, upgrades: Record<string, number> = {}): GhostPayload {
    const game: GameState = emptyGame();
    for (const p of BODY_PARTS) {
      game.parts[p].xp = totalXpToReach(level) + 1;
      game.parts[p].level = level;
    }
    game.equipment = {
      owned: Object.values(equipped),
      equipped: equipped as GameState['equipment']['equipped'],
      upgrades,
    };
    return buildGhost(game, FOE);
  }

  /** Put gear on MY character. */
  function wear(store: LocalStore, equipped: Record<string, string>, upgrades: Record<string, number> = {}): void {
    store.update((d) => {
      const g = d.game ?? emptyGame();
      g.equipment = {
        owned: Object.values(equipped),
        equipped: equipped as GameState['equipment']['equipped'],
        upgrades,
      };
      d.game = g;
    });
  }

  const group = (host: string, slot: string): Element | null =>
    document.querySelector(`${host} .ch-equip[data-slot="${slot}"]`);

  it('shows the opponent’s items on the preview card — theirs, not mine', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, dressedGhost(7, { gloves: 'gloves_3', cape: 'cape_1' }, { gloves_3: 2 }));
    const store = battleStore(6, 5);
    wear(store, { belt: 'belt_1' });
    mount(store, port);
    await search(FOE);

    expect(cardState()).toBe('ready');
    expect(group('#btGhost .gd-figure', 'gloves')?.childElementCount).toBeGreaterThan(0);
    expect(group('#btGhost .gd-figure', 'cape')?.childElementCount).toBeGreaterThan(0);
    // MY belt is not on THEIR body: the drawing reads their snapshot only.
    expect(group('#btGhost .gd-figure', 'belt')?.childElementCount).toBe(0);
    // Their +2 gloves glow on the card, with the item's own accent.
    const gloves = group('#btGhost .gd-figure', 'gloves');
    expect(gloves?.classList.contains('up-2')).toBe(true);
    expect(gloves?.querySelector('.ch-spark')).not.toBeNull();
    // The card counts the pieces it drew, so the two agree.
    expect(card()?.textContent).toContain('2 פריטי ציוד');
  });

  it('puts both kits in the arena: mine on me, theirs on them', async () => {
    const port = new FakeGhosts();
    port.publish(FOE, dressedGhost(6, { shoes: 'shoes_2' }, { shoes_2: 3 }));
    const store = battleStore(6, 6);
    wear(store, { belt: 'belt_3', gloves: 'gloves_1' }, { belt_3: 1 });
    mount(store, port);
    await search(FOE);
    click(fightBtn());

    expect(cardState()).toBe('live');
    // MY half of the arena.
    expect(group('#btHeroSprite', 'belt')?.childElementCount).toBeGreaterThan(0);
    expect(group('#btHeroSprite', 'gloves')?.childElementCount).toBeGreaterThan(0);
    expect(group('#btHeroSprite', 'belt')?.classList.contains('up-1')).toBe(true);
    expect(group('#btHeroSprite', 'shoes')?.childElementCount).toBe(0);
    // THEIR half — their shoes, at their +3, and none of my belt or gloves.
    expect(group('#btEnemySprite', 'shoes')?.childElementCount).toBeGreaterThan(0);
    expect(group('#btEnemySprite', 'shoes')?.classList.contains('up-3')).toBe(true);
    expect(group('#btEnemySprite', 'shoes')?.querySelector('.ch-up-badge')).not.toBeNull();
    expect(group('#btEnemySprite', 'belt')?.childElementCount).toBe(0);
    expect(group('#btEnemySprite', 'gloves')?.childElementCount).toBe(0);
    // Both fighters are drawn on the same stage — the arena only scales them.
    for (const host of ['#btHeroSprite', '#btEnemySprite']) {
      expect(document.querySelector(`${host} svg.ch-svg`)?.getAttribute('viewBox')).toBe('0 0 200 320');
    }
  });

  it('draws no phantom gear for a hostile row’s invented items', async () => {
    const port = new FakeGhosts();
    const honest = dressedGhost(6, { belt: 'belt_1' });
    // A row can say anything: an unknown id, a number, and — the interesting
    // one — a real item worn in the WRONG slot.
    port.rows.set(FOE, {
      ...honest,
      equipped: { cape: 'gloves_1', belt: 'belt_9000', gloves: 42, shoes: '' },
      upgrades: { belt_9000: 99, gloves_1: 7 },
    } as unknown as Record<string, unknown>);
    mount(battleStore(6, 6), port);
    await search(FOE);

    expect(cardState()).toBe('ready');
    for (const slot of ['cape', 'belt', 'gloves', 'shoes']) {
      expect(group('#btGhost .gd-figure', slot)?.childElementCount).toBe(0);
      expect(group('#btGhost .gd-figure', slot)?.classList.contains('upgraded')).toBe(false);
    }
    // …and the card says so: nothing was worn, so nothing is counted.
    expect(card()?.textContent).not.toContain('פריטי ציוד');

    // The same is true once the fight starts.
    click(fightBtn());
    for (const slot of ['cape', 'belt', 'gloves', 'shoes']) {
      expect(group('#btEnemySprite', slot)?.childElementCount).toBe(0);
    }
  });
});
