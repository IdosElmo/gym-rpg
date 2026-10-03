/**
 * @vitest-environment jsdom
 *
 * tests/league.prizes.test.ts — PERSONAL OR COUPLE PRIZES.
 *
 *   1. `prizeModeOf` — an install with a league past keeps the couple's shop,
 *      a fresh one gets personal prizes, `UiState.prizes` wins, and the boot
 *      pins the answer so a fresh install does not drift as it trains.
 *   2. The personal pools mirror the couple's pins: twelve months, 3 gifts +
 *      2 experiences + 3 challenges, a 7-item base leading every month, stable
 *      `p_` ids, prices by kind, bounded bonuses.
 *   3. Every item of BOTH modes has English, read through `i18n/leagueText.ts`.
 *   4. The toggle switches the pool on screen; a personal redemption folds like
 *      any other; validation follows the mode; the mode never enters the log.
 *   5. `prizes` is a device preference: kept by clear() and replaceAll(), and
 *      read back from storage.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { gameOf, redeemLeagueReward } from '../src/core/game.ts';
import { buildLeagueChallengeSet, buildLeagueRedemption, prizeModeOf } from '../src/core/league.ts';
import {
  LEAGUE_POOLS,
  PERSONAL_POOLS,
  allLeagueItems,
  itemInMonth,
  leagueItemById,
  poolOfMonth,
  priceOf,
  prizeModeOfItem,
  type PrizeMode,
} from '../src/data/leaguePools.ts';
import { LEAGUE_ITEMS_EN } from '../src/i18n/content/leaguePools.en.ts';
import { leagueItemDetail, leagueItemName } from '../src/i18n/leagueText.ts';
import { setLocale } from '../src/i18n/locale.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { makeEvent, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { renderLeague, resetLeagueScreen } from '../src/ui/league.ts';
import { RestTimer } from '../src/ui/timer.ts';

const TODAY = '2026-07-13';
const MONTH = '2026-07';
const NOW = new Date(`${TODAY}T12:00:00.000Z`);
const HEBREW = /[֐-׿]/;

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Five closed, coin-minting weeks: 🔵 5 in the purse. */
function fundedEvents(): AppEvent[] {
  return ['2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28', '2026-07-05'].map((weekKey, i) =>
    makeEvent('league_week_closed', { weekKey, date: TODAY, score: 80, c: 1, q: 1, l: 0.5, p: 0, coin: true }, 1_000 + i),
  );
}

function storeOf(events: AppEvent[], prizes?: PrizeMode, storage: StorageLike = fakeStorage()): LocalStore {
  const store = new LocalStore(storage);
  store.replaceAll(rebuildFromEvents(events, NOW.getTime()), events);
  if (prizes) {
    store.update((d) => {
      d.ui.prizes = prizes;
    });
  }
  return store;
}

const SHELL = readFileSync(resolvePath(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  resetLeagueScreen();
});

afterEach(() => {
  setLocale('he');
});

const main = (): HTMLElement => document.getElementById('main') as HTMLElement;

function paint(store: LocalStore): void {
  renderLeague(main(), { store, today: TODAY });
}

function click(sel: string): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no element ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function shownIds(): string[] {
  return [...main().querySelectorAll('.lg-item')].map((e) => e.getAttribute('data-item') ?? '');
}

/* ======================================================== 1. resolution */

describe('prizeModeOf — who the prizes are for', () => {
  it('gives a fresh install personal prizes', () => {
    expect(prizeModeOf(new LocalStore(fakeStorage()).getState())).toBe('personal');
  });

  it('keeps the couple’s shop for an install with a league past', () => {
    // Closed weeks…
    expect(prizeModeOf(storeOf(fundedEvents()).getState())).toBe('couple');
    // …or merely logged training (every such install was shown only the couple's pools)…
    const trained = new LocalStore(fakeStorage());
    trained.update((d) => {
      d.sessions['2026-07-01'] = { day: 'A', ex: {} };
    });
    expect(prizeModeOf(trained.getState())).toBe('couple');
    // …or a couple redemption.
    const spent = storeOf(fundedEvents());
    expect(redeemLeagueReward(spent, MONTH, 'base_1', NOW).ok).toBe(true);
    expect(prizeModeOf(spent.getState())).toBe('couple');
  });

  it('is never flipped back by the history a personal shop built', () => {
    const store = storeOf(fundedEvents());
    expect(redeemLeagueReward(store, MONTH, 'p_base_1', NOW, 'personal').ok).toBe(true);
    // The preference itself is absent here — the personal spend answers.
    expect(store.getState().ui.prizes).toBeUndefined();
    expect(prizeModeOf(store.getState())).toBe('personal');
  });

  it('lets the device preference win', () => {
    expect(prizeModeOf(storeOf(fundedEvents(), 'personal').getState())).toBe('personal');
    const fresh = new LocalStore(fakeStorage());
    fresh.update((d) => {
      d.ui.prizes = 'couple';
    });
    expect(prizeModeOf(fresh.getState())).toBe('couple');
  });

  it('is pinned on boot, so a fresh install stays personal as it trains', () => {
    const mount = (store: LocalStore): void => {
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
      createApp(store, timer);
    };
    const fresh = new LocalStore(fakeStorage());
    mount(fresh);
    expect(fresh.getState().ui.prizes).toBe('personal');
    fresh.update((d) => {
      d.sessions['2026-07-01'] = { day: 'A', ex: {} };
    });
    expect(prizeModeOf(fresh.getState())).toBe('personal');

    const couple = storeOf(fundedEvents());
    mount(couple);
    expect(couple.getState().ui.prizes).toBe('couple');
  });
});

/* =================================================== 2. the personal pools */

describe('the twelve personal pools', () => {
  it('offers one pool per calendar month, in order, shaped like the couple’s', () => {
    expect(PERSONAL_POOLS).toHaveLength(12);
    PERSONAL_POOLS.forEach((pool, i) => {
      expect(pool.month).toBe(i + 1);
      expect(pool.he).toBe(LEAGUE_POOLS[i]?.he);
      expect(pool.rewards.filter((r) => r.kind === 'gift')).toHaveLength(3);
      expect(pool.rewards.filter((r) => r.kind === 'experience')).toHaveLength(2);
      expect(pool.challenges).toHaveLength(3);
      const mm = String(i + 1).padStart(2, '0');
      expect(pool.rewards.map((r) => r.id)).toEqual([
        `p_gift_${mm}_1`,
        `p_gift_${mm}_2`,
        `p_gift_${mm}_3`,
        `p_exp_${mm}_1`,
        `p_exp_${mm}_2`,
      ]);
      expect(pool.challenges.map((r) => r.id)).toEqual([`p_chl_${mm}_1`, `p_chl_${mm}_2`, `p_chl_${mm}_3`]);
    });
  });

  it('leads every month with the personal base pool, and rotates by month number', () => {
    const baseIds = ['p_base_1', 'p_base_2', 'p_base_3', 'p_base_4', 'p_base_5', 'p_base_6', 'p_base_7'];
    for (let m = 1; m <= 12; m++) {
      const pool = poolOfMonth(`2026-${String(m).padStart(2, '0')}`, 'personal');
      expect(pool.month).toBe(m);
      expect(pool.rewards.slice(0, 7).map((i) => i.id)).toEqual(baseIds);
    }
    expect(poolOfMonth('2030-08', 'personal')).toBe(poolOfMonth('2026-08', 'personal'));
    expect(poolOfMonth('2026-13', 'personal').month).toBe(1);
    expect(itemInMonth('2026-08', 'p_gift_08_1', 'personal')).toBe(true);
    expect(itemInMonth('2026-07', 'p_gift_08_1', 'personal')).toBe(false);
    expect(itemInMonth('2026-08', 'p_base_1', 'personal')).toBe(true);
    // The modes do not mix.
    expect(itemInMonth('2026-08', 'p_base_1')).toBe(false);
    expect(itemInMonth('2026-08', 'base_1', 'personal')).toBe(false);
    // Without a mode, the couple's pool — exactly as before.
    expect(poolOfMonth('2026-08')).toBe(poolOfMonth('2026-08', 'couple'));
  });

  it('gives every item a unique id, Hebrew copy and an emoji — and both modes resolve', () => {
    const personal = allLeagueItems('personal');
    const couple = allLeagueItems();
    expect(personal).toHaveLength(7 + 12 * 8);
    expect(couple).toHaveLength(7 + 12 * 8);
    const ids = new Set([...personal, ...couple].map((i) => i.id));
    expect(ids.size).toBe(personal.length + couple.length);
    for (const item of personal) {
      expect(item.id.startsWith('p_')).toBe(true);
      expect(leagueItemById(item.id)).toBe(item);
      expect(prizeModeOfItem(item.id)).toBe('personal');
      expect(HEBREW.test(item.he)).toBe(true);
      expect(HEBREW.test(item.detail)).toBe(true);
      expect(item.emoji.length).toBeGreaterThan(0);
    }
    for (const item of couple) {
      expect(leagueItemById(item.id)).toBe(item);
      expect(prizeModeOfItem(item.id)).toBe('couple');
    }
    expect(prizeModeOfItem('nope')).toBeNull();
  });

  it('prices every personal item from the balance, by kind', () => {
    for (const item of allLeagueItems('personal')) {
      expect(priceOf(item.kind)).toBe(BALANCE.league.prices[item.kind]);
      if (item.kind === 'challenge') {
        expect(item.bonus).toBeGreaterThan(0);
        expect(item.bonus).toBeLessThanOrEqual(BALANCE.league.maxBonus);
      } else {
        expect(item.bonus).toBe(0);
      }
    }
  });
});

/* ======================================================== 3. English */

describe('every league item speaks English', () => {
  const all = [...allLeagueItems('couple'), ...allLeagueItems('personal')];

  it('has an English name and detail for every id of both modes, and nothing extra', () => {
    for (const item of all) {
      const en = LEAGUE_ITEMS_EN[item.id];
      expect(en, item.id).toBeDefined();
      expect(en?.name.trim().length).toBeGreaterThan(0);
      expect(en?.detail.trim().length).toBeGreaterThan(0);
      expect(HEBREW.test(`${en?.name ?? ''} ${en?.detail ?? ''}`), item.id).toBe(false);
    }
    expect(Object.keys(LEAGUE_ITEMS_EN).sort()).toEqual(all.map((i) => i.id).sort());
  });

  it('reads the Hebrew original in Hebrew and the overlay in English', () => {
    const item = leagueItemById('base_4');
    if (!item) throw new Error('no base_4');
    expect(leagueItemName(item)).toBe(item.he);
    expect(leagueItemDetail(item)).toBe(item.detail);
    setLocale('en');
    expect(leagueItemName(item)).toBe('A back massage');
    expect(leagueItemDetail(item)).toBe(LEAGUE_ITEMS_EN['base_4']?.detail);
  });

  it('draws the personal shop in English with no Hebrew left in it', () => {
    setLocale('en');
    paint(storeOf(fundedEvents(), 'personal'));
    const shop = main().querySelector('.lg-shop') as HTMLElement;
    expect(shop.textContent).toContain('A cheat meal');
    expect(shop.textContent).toContain('Prizes:');
    const hebrew = (shop.textContent ?? '').match(/[֐-׿]+/g) ?? [];
    expect(hebrew).toEqual([]);
  });
});

/* ======================================================= 4. on screen */

describe('the toggle, the shop and the log', () => {
  it('switches the pool on screen — a preference, not an event', () => {
    const store = storeOf(fundedEvents(), 'personal');
    const before = store.getEvents().length;
    paint(store);
    expect(shownIds()).toContain('p_base_1');
    expect(shownIds()).not.toContain('base_1');
    expect(main().querySelector('[data-prizes="personal"]')?.getAttribute('aria-pressed')).toBe('true');
    // Personal prizes are owed to nobody: no winner-buys line.
    expect(main().querySelector('[data-honor]')).toBeNull();
    expect(main().querySelector('[data-self-reward]')).not.toBeNull();

    click('[data-prizes="couple"]');
    expect(store.getState().ui.prizes).toBe('couple');
    expect(shownIds()).toContain('base_1');
    expect(shownIds()).not.toContain('p_base_1');
    expect(main().querySelector('[data-prizes="couple"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(main().querySelector('[data-honor]')).not.toBeNull();
    expect(store.getEvents().length).toBe(before);
  });

  it('redeems a personal item through the sheet and folds it like any other', () => {
    const store = storeOf(fundedEvents(), 'personal');
    const coins = gameOf(store).league.coins;
    paint(store);
    click('[data-redeem="p_base_5"]');
    expect(main().querySelector('#lgSheet')?.textContent).toContain('עיסוי מקצועי');
    click('[data-confirm]');

    const written = store.getEvents().filter((e) => e.type === 'league_reward_redeemed');
    expect(written).toHaveLength(1);
    expect(written[0]?.payload).toMatchObject({ month: MONTH, itemId: 'p_base_5', kind: 'experience', cost: priceOf('experience') });
    expect(gameOf(store).league.coins).toBe(coins - priceOf('experience'));
    expect(main().querySelector('.lg-item[data-item="p_base_5"]')?.getAttribute('data-state')).toBe('claimed');

    // Replay: the same ledger, in either order.
    const forward = rebuildFromEvents(store.getEvents(), NOW.getTime()).game?.league;
    const backward = rebuildFromEvents([...store.getEvents()].reverse(), NOW.getTime()).game?.league;
    expect(forward).toEqual(gameOf(store).league);
    expect(backward).toEqual(forward);

    // Switching shops does not un-redeem anything: the ledger keys by id.
    click('[data-prizes="couple"]');
    click('[data-prizes="personal"]');
    expect(main().querySelector('.lg-item[data-item="p_base_5"]')?.getAttribute('data-state')).toBe('claimed');
  });

  it('validates against the pool of the mode the shop is in', () => {
    const game = gameOf(storeOf(fundedEvents()));
    const ts = NOW.getTime();
    expect(buildLeagueRedemption(game, MONTH, 'p_base_1', TODAY, ts).error).toBe('wrong_month');
    expect(buildLeagueRedemption(game, MONTH, 'p_base_1', TODAY, ts, 'personal').ok).toBe(true);
    expect(buildLeagueRedemption(game, MONTH, 'base_1', TODAY, ts, 'personal').error).toBe('wrong_month');
    expect(buildLeagueRedemption(game, MONTH, 'p_gift_08_1', TODAY, ts, 'personal').error).toBe('wrong_month');
    expect(buildLeagueChallengeSet(game, MONTH, 'p_chl_07_1', TODAY, ts, 'personal').ok).toBe(true);
    expect(buildLeagueChallengeSet(game, MONTH, 'p_chl_07_1', TODAY, ts).error).toBe('wrong_month');
  });

  it('stakes and completes a personal challenge', () => {
    const store = storeOf(fundedEvents(), 'personal');
    paint(store);
    const challenge = poolOfMonth(MONTH, 'personal').challenges[0];
    if (!challenge) throw new Error('no challenge');
    click(`[data-stake="${challenge.id}"]`);
    click('[data-confirm]');
    expect(gameOf(store).league.challenges[MONTH]?.challengeId).toBe(challenge.id);
    expect(main().querySelector('.lg-item.staked')?.textContent).toContain(challenge.he);
    click('[data-complete]');
    expect(gameOf(store).league.completions[`${MONTH}|${challenge.id}`]).toBe(challenge.bonus);
  });

  it('never writes the mode into the log', () => {
    const store = storeOf(fundedEvents(), 'personal');
    paint(store);
    click('[data-redeem="p_base_1"]');
    click('[data-confirm]');
    click('[data-prizes="couple"]');
    click('[data-stake="chl_07_1"]'); // 🔵 2 of the 2 left
    click('[data-confirm]');
    const log = JSON.stringify(store.getEvents());
    expect(log).toContain('"p_base_1"');
    expect(log).toContain('"chl_07_1"');
    expect(log).not.toMatch(/prizes|personal|couple/);
  });
});

/* ======================================== 5. a device preference */

describe('prizes is a device preference', () => {
  it('survives "delete all data", a restore/merge, and a reload', () => {
    const storage = fakeStorage();
    const store = storeOf(fundedEvents(), 'personal', storage);
    store.replaceAll(rebuildFromEvents(fundedEvents(), NOW.getTime()), fundedEvents());
    expect(store.getState().ui.prizes).toBe('personal');
    expect(new LocalStore(storage).getState().ui.prizes).toBe('personal');
    store.clear();
    expect(store.getState().ui.prizes).toBe('personal');
  });

  it('drops a junk value on load', () => {
    const storage = fakeStorage();
    const store = new LocalStore(storage);
    store.update((d) => {
      (d.ui as unknown as Record<string, unknown>)['prizes'] = 'both';
    });
    expect(new LocalStore(storage).getState().ui.prizes).toBeUndefined();
  });
});
