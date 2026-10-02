/**
 * @vitest-environment jsdom
 *
 * English on the league (LG), stats (SS) and history-feed (H) screens, the
 * account card and the 🛠 dev card: their chrome speaks English with no Hebrew
 * letter left in it, time charts run left to right, and the stats screen's
 * weights follow the units preference (kilograms stored, pounds shown).
 *
 * Allowed Hebrew: the league's prize pool (`data/leaguePools.ts`, content that
 * is rewritten separately) and stored user content (none is seeded here).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onSetCompleted } from '../src/core/game.ts';
import { todayISO } from '../src/core/workout.ts';
import { addDays } from '../src/core/xp.ts';
import { findExercise, type Exercise } from '../src/data/program.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { KG_PER_LB, setUnits, type UnitSystem } from '../src/i18n/units.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import { renderAccountCard } from '../src/sync/account.ts';
import type { SyncStatus } from '../src/sync/engine.ts';
import { createApp } from '../src/ui/app.ts';
import { devPanelCard } from '../src/ui/devPanel.ts';
import { renderLeague, resetLeagueScreen, type LeagueCloudDeps, type LeagueMonthSnapshot } from '../src/ui/league.ts';
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

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  document.documentElement.setAttribute('lang', 'he');
  document.documentElement.setAttribute('dir', 'rtl');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  resetLeagueScreen();
});

afterEach(() => {
  setLocale('he');
  setUnits('metric');
  resetLeagueScreen();
});

function ex(id: string): Exercise {
  const e = findExercise(id);
  if (!e) throw new Error(`no exercise ${id}`);
  return e;
}

/** Two logged workouts a week apart, through the real set path (XP, level-ups, PRs). */
function seed(store: LocalStore): void {
  const today = todayISO();
  const plan: Array<[string, string, string]> = [
    ['a1', '40', '10'],
    ['a1', '45', '8'],
    ['a5', '12', '12'],
    ['b5', '', '45'],
  ];
  for (const [n, date] of [addDays(today, -8), addDays(today, -1)].entries()) {
    const now = new Date(`${date}T12:00:00.000Z`);
    store.update((d) => {
      d.sessions[date] = {
        day: 'A',
        ex: Object.fromEntries(
          plan.map(([id, w, r]) => [id, [{ w: n > 0 && w ? String(Number(w) + 5) : w, r, done: true }]]),
        ),
      };
    });
    plan.forEach(([id, w, r], i) => {
      onSetCompleted(store, { date, day: 'A', ex: ex(id), setIndex: i, w: n > 0 && w ? String(Number(w) + 5) : w, r }, now);
    });
    store.append('wave_cleared', { world: 1, wave: n + 1, coins: 2, date });
  }
}

function mount(view: 'LG' | 'SS' | 'H', units: UnitSystem = 'metric'): LocalStore {
  const store = new LocalStore(fakeStorage());
  seed(store);
  const el = (id: string) => document.getElementById(id) as HTMLElement;
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
  store.update((d) => {
    d.ui.locale = 'en';
    d.ui.units = units;
    d.ui.view = view;
  });
  app.render();
  return store;
}

/** Every Hebrew run in an element's text AND its labelling attributes. */
function hebrewIn(root: Element): string[] {
  const found: string[] = [];
  const text = root.textContent ?? '';
  if (HEBREW.test(text)) found.push(...(text.match(/[֐-׿][֐-׿\s״׳־]*/g) ?? []));
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v && HEBREW.test(v)) found.push(`${attr}=${v}`);
    }
  }
  // SVG <title> children are covered by textContent.
  return found;
}

const main = (): HTMLElement => document.getElementById('main') as HTMLElement;

describe('🏆 league in English', () => {
  it('speaks English everywhere but the prize pool', () => {
    mount('LG');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    const text = main().textContent ?? '';
    expect(text).toContain('My week');
    expect(text).toContain('points · out of 100');
    expect(text).toContain('Consistency');
    expect(text).toContain("This month's shop");
    expect(text).toContain("The month's winner buys");
    expect(text).toMatch(/[A-Z][a-z]+ \d{4}/); // "October 2026"
    expect(text).toContain('History');

    // The prize pool is content in Hebrew for now; strip it, and nothing Hebrew may remain.
    const clone = main().cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.li-head b, .li-detail, .ls-head').forEach((e) => e.remove());
    expect(hebrewIn(clone)).toEqual([]);
  });

  it('the race card and its states are English too', async () => {
    const store = new LocalStore(fakeStorage());
    seed(store);
    setLocale('en');
    const today = todayISO();
    const monthKey = today.slice(0, 7);
    const snap = (fetchedAt: number | null): LeagueMonthSnapshot => ({
      handle: 'dana',
      monthKey,
      month: { weeks: {}, monthlyScore: 42, coins: 1, rejected: 0 },
      fetchedAt,
      stale: true,
    });
    const cloud: LeagueCloudDeps = {
      signedIn: () => true,
      myHandle: () => 'me',
      recent: () => ['dana'],
      remember: () => undefined,
      cached: () => snap(null),
      load: async () => snap(Date.parse(`${today}T09:05:00.000Z`)),
    };
    const host = document.createElement('div');
    renderLeague(host, { store, today, cloud });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const race = host.querySelector('.lg-race');
    expect(race?.getAttribute('data-state')).toBe('ready');
    expect(race?.textContent).toContain('The monthly race');
    expect(race?.textContent).toContain('🏁 You:');
    expect(race?.textContent).toContain('dana leads by');
    expect(race?.querySelector('[data-stale]')?.textContent).toContain("couldn't refresh");
    expect(host.querySelector('#lgHandle')?.getAttribute('placeholder')).toBe('e.g. alex');
    expect(hebrewIn(race as Element)).toEqual([]);

    // A typo is reported in English.
    const input = host.querySelector<HTMLInputElement>('#lgHandle');
    if (!input) throw new Error('no handle input');
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('#lgFind')?.click();
    expect(host.querySelector('.lg-race .lg-note.warn')?.textContent).toBe('A warrior name is at least 3 characters.');
  });
});

describe('📊 stats in English', () => {
  it('speaks English, with no Hebrew letter in the chrome', () => {
    mount('SS');
    const text = main().textContent ?? '';
    expect(text).toContain('💪 Total lifted');
    expect(text).toContain('📈 Weekly tonnage');
    expect(text).toContain('🗓 Training calendar');
    expect(text).toContain('⚖️ Body-part balance');
    expect(text).toContain('🥇 Your records');
    expect(text).toContain('🎲 Weird stats');
    expect(main().querySelector('.hero-unit')?.textContent).toBe('kg');
    expect(hebrewIn(main())).toEqual([]);
  });

  it('draws time left to right: oldest week at the left, labels left of the grid', () => {
    mount('SS');
    const xs = [...main().querySelectorAll('.spark .sp-hit')].map((c) => Number(c.getAttribute('cx')));
    expect(xs.length).toBeGreaterThan(2);
    expect(xs[0]).toBeLessThan(xs[xs.length - 1] as number);
    const labels = [...main().querySelectorAll('.heat .hm-day')];
    expect(labels.map((l) => l.textContent)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
    expect(labels[0]?.getAttribute('x')).toBe('0');
    const cellXs = [...main().querySelectorAll('.heat .hm-cell')].map((c) => Number(c.getAttribute('x')));
    expect(Math.min(...cellXs)).toBeGreaterThan(0);
  });

  it('shows tonnage, records and the heaviest set in pounds when imperial', () => {
    mount('SS', 'metric');
    const kg = Number(main().querySelector('.hero-num b')?.textContent?.replace(/,/g, ''));
    expect(kg).toBeGreaterThan(0);

    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    mount('SS', 'imperial');
    expect(main().querySelector('.hero-unit')?.textContent).toBe('lb');
    const lb = Number(main().querySelector('.hero-num b')?.textContent?.replace(/,/g, ''));
    expect(Math.abs(lb - kg / KG_PER_LB)).toBeLessThanOrEqual(1);
    const table = main().querySelector('.stats-table')?.textContent ?? '';
    expect(table).toContain('lb ×');
    expect(table).not.toContain('kg');
    expect(main().querySelector('.odd-list')?.textContent).toContain('lb × ');
    expect(hebrewIn(main())).toEqual([]);
  });
});

describe('📜 history feed in English', () => {
  it('the adventure log speaks English', () => {
    const store = mount('H');
    store.append('level_up', { part: 'chest', to: 2, date: todayISO() });
    store.append('streak_changed', { from: 0, to: 1 });
    // re-render through the shell (tapping the active tab repaints it)
    document.querySelector<HTMLElement>('#tabs .tab[data-view="H"]')?.click();
    const card = [...main().querySelectorAll('.game-card')].find((c) => c.querySelector('.feed'));
    if (!card) throw new Error('no feed card');
    const text = card.textContent ?? '';
    expect(text).toContain('Adventure log');
    expect(text).toContain('cleared in Abandoned Gym');
    expect(text).toContain('Chest reached level 2');
    expect(text).toContain('Perfect week! Streak tier 1');
    expect(text).toContain('Personal record in');
    expect(hebrewIn(card)).toEqual([]);
  });
});

describe('☁️ account and 🛠 dev cards in English', () => {
  it('every account state is English', () => {
    setLocale('en');
    const now = Date.parse('2026-01-01T12:00:00Z');
    const kinds: Array<Partial<SyncStatus>> = [
      { kind: 'signedOut' },
      { kind: 'reauth' },
      { kind: 'idle', pending: 0, lastSyncAt: now - 120_000 },
      { kind: 'syncing', pending: 2, lastSyncAt: null },
      { kind: 'offline', pending: 1, lastSyncAt: null },
    ];
    for (const s of kinds) {
      const html = renderAccountCard({
        getStatus: () => ({ pending: 0, lastSyncAt: null, ...s }) as SyncStatus,
        getEmail: () => null,
        signIn: () => undefined,
        signOut: () => undefined,
        now: () => now,
        getHandle: () => 'me',
        setHandle: async () => true,
      });
      const host = document.createElement('div');
      host.innerHTML = html;
      expect(host.textContent).toContain('Cloud sync');
      expect(hebrewIn(host)).toEqual([]);
    }
  });

  it('the dev card is English', () => {
    setLocale('en');
    const host = document.createElement('div');
    host.innerHTML = devPanelCard();
    expect(host.textContent).toContain('🛠 Dev mode');
    expect(hebrewIn(host)).toEqual([]);
  });
});
