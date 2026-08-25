/**
 * @vitest-environment jsdom
 *
 * tests/league.dom.test.ts — 🏆 הליגה ON SCREEN.
 *
 * Stage 1 proved the formula and stage 2 proved the wire; this file proves the
 * only thing left, which is that a person can SEE both and act on them:
 *
 *   1. THE TAB — third in the 🎮 hub, after קרב and דמות, and `hubOf('LG')`
 *      agrees with the row that renders it.
 *   2. THE LIVE WEEK — the four bars carry the CONCRETE numbers ("2 מתוך 4
 *      ימים", "18 מתוך 24 סטים"), not just percentages, and the 🔵 line says
 *      either "earned" or exactly what is still missing, counted in days and
 *      sets a person can go and do.
 *   3. THE RACE — my weeks and the rival's are drawn by the SAME bar component
 *      from the SAME record type, the totals are the two `monthlyScore`s, and
 *      the staleness line obeys stage 2's contract to the letter (fresh: say
 *      nothing; cached: "נכון ל…"; never read: still nothing).
 *   4. THE SHOP — this month's pool at its 🔵 prices, a redemption that appends
 *      exactly one event and comes back as claimed, a refusal that appends NONE
 *      and explains itself in Hebrew, and the challenge stake → "השלמתי ✓" loop.
 *   5. THE DARK STATES — signed out, the race is ABSENT (not disabled), while
 *      the shop keeps working: it spends a LOCAL ledger on a pool that is a pure
 *      function of the month, so it needs no account and no network.
 *
 * NOTHING HERE TOUCHES A NETWORK. `LeagueCloudDeps` is implemented over a list
 * of rows — the same rows `publishableWeeks` would have uploaded — exactly the
 * way `main.ts` implements it over the sync engine.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { BALANCE } from '../src/core/balance.ts';
import { closeDueWeeks, gameOf } from '../src/core/game.ts';
import { buildGhost } from '../src/core/ghost.ts';
import { opponentMonth, publishableWeeks } from '../src/core/leagueSync.ts';
import { planToRecord } from '../src/core/plan.ts';
import { fmtDate, todayISO } from '../src/core/workout.ts';
import { poolOfMonth, priceOf } from '../src/data/leaguePools.ts';
import { PLAN_DOC_VERSION, type PlanDoc, type PlanExercise } from '../src/data/planTypes.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, Session, SetEntry } from '../src/storage/DataStore.ts';
import { makeEvent, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import { hubOf, GAME_TABS } from '../src/ui/nav.ts';
import {
  LEAGUE_BEHIND_HE,
  LEAGUE_ERROR_HE,
  LEAGUE_HONOR_HE,
  renderLeague,
  resetLeagueScreen,
  type LeagueCloudDeps,
  type LeagueGhostRow,
  type LeagueMonthSnapshot,
} from '../src/ui/league.ts';
import { RestTimer } from '../src/ui/timer.ts';

/* --------------------------------------------------------------- calendar */

/** Sundays. `LIVE` is the week in progress on `TODAY` (a Monday). */
const W1 = '2026-06-07';
const W2 = '2026-06-14';
const W3 = '2026-06-21';
const W4 = '2026-06-28';
const W5 = '2026-07-05';
const LIVE = '2026-07-12';
const TODAY = '2026-07-13';
const MONTH = '2026-07';
/** July 2026's four weeks — the weeks whose SATURDAY falls in July. */
const JULY_WEEKS = [W4, W5, LIVE, '2026-07-19'];
const NOW = new Date(Date.parse(`${TODAY}T12:00:00.000Z`));

/* --------------------------------------------------------------- fixtures */

const DAY_MS = 86_400_000;

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function iso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function tsOf(date: string): number {
  return Date.parse(`${date}T12:00:00.000Z`);
}

function set(w: string, r: string): SetEntry {
  return { w, r, done: true };
}

/** A session: `ids` exercises × `sets` completed sets each, all at 20 kg × 10. */
function session(day: string, ids: readonly string[], sets: number): Session {
  const ex: Record<string, (SetEntry | null)[]> = {};
  for (const id of ids) ex[id] = Array.from({ length: sets }, () => set('20', '10'));
  return { day, ex };
}

function rows(ids: readonly string[], sets: number): PlanExercise[] {
  return ids.map((id) => ({ id, sets, reps: '8–10', rest: 90 }));
}

/** Four training days a week, three exercises × four sets each = 12 sets a day. */
const DAYS = [
  { key: 'A', label: 'א', weekdays: [0], ids: ['a1', 'a2', 'a3'] },
  { key: 'B', label: 'ב', weekdays: [1], ids: ['b1', 'b2', 'b3'] },
  { key: 'C', label: 'ג', weekdays: [2], ids: ['c1', 'c2', 'c3'] },
  { key: 'd_d', label: 'ד', weekdays: [3], ids: ['x1', 'x2', 'x3'] },
];
const SETS_PER_EXERCISE = 4;
/** 3 exercises × 4 sets. */
const PLANNED_PER_DAY = 12;
const WEEKLY_TARGET = 4;

const PLAN: PlanDoc = {
  version: PLAN_DOC_VERSION,
  rev: 1,
  days: DAYS.map((d) => ({
    key: d.key,
    label: d.label,
    weekdays: d.weekdays,
    exercises: rows(d.ids, SETS_PER_EXERCISE),
  })),
  weeklyTarget: WEEKLY_TARGET,
  customExercises: [],
};

/** A full week: all four days, every planned set done. */
function fullWeek(sessions: Record<string, Session>, weekStart: string): Record<string, Session> {
  for (let i = 0; i < DAYS.length; i += 1) {
    const day = DAYS[i] as (typeof DAYS)[number];
    sessions[iso(weekStart, i)] = session(day.key, day.ids, SETS_PER_EXERCISE);
  }
  return sessions;
}

/** Four steady weeks (W1…W4) plus W5 — every one of them mints its 🔵. */
function steady(): Record<string, Session> {
  const sessions: Record<string, Session> = {};
  for (const week of [W1, W2, W3, W4, W5]) fullWeek(sessions, week);
  return sessions;
}

/**
 * A store built the way a real one is: a LOG, replayed into state (the events
 * are stamped at their own dates, so the plan is in force for the weeks it
 * grades).
 */
function storeWith(sessions: Record<string, Session>): LocalStore {
  const events: AppEvent[] = [
    makeEvent(
      'plan_updated',
      { plan: planToRecord(PLAN), revision: 1, date: '2026-01-01' },
      Date.parse('2026-01-01T00:00:00.000Z'),
    ),
  ];
  for (const date of Object.keys(sessions).sort()) {
    const s = sessions[date] as Session;
    events.push(makeEvent('session_imported', { date, day: s.day, ex: s.ex, source: 'json_import' }, tsOf(date)));
  }
  const store = new LocalStore(fakeStorage());
  store.replaceAll(rebuildFromEvents(events, tsOf(TODAY)), events);
  return store;
}

/** A closed-and-funded store: five perfect weeks, five 🔵 in the purse. */
function fundedStore(): LocalStore {
  const store = storeWith(steady());
  closeDueWeeks(store, NOW);
  return store;
}

/* ------------------------------------------------------------- the shell */

const SHELL = readFileSync(resolvePath(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';
const LEAGUE_CSS = readFileSync(resolvePath(process.cwd(), 'styles/league.css'), 'utf8');

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  resetLeagueScreen();
});

function mountShell(store: LocalStore): void {
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
  createApp(store, timer).render();
}

const main = (): HTMLElement => document.getElementById('main') as HTMLElement;

/** Render the league screen straight into #main with a pinned calendar. */
function paint(store: LocalStore, cloud?: LeagueCloudDeps): void {
  renderLeague(main(), { store, today: TODAY, ...(cloud ? { cloud } : {}) });
}

/** Let the rival's fetch (and the ghost's) settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function click(sel: string): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no element ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function text(sel: string): string {
  return (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The caption under one component bar, inside one cell. */
function caption(scope: string, comp: string): string {
  return text(`${scope} .lg-bar[data-comp="${comp}"] .lb-v`);
}

/* ------------------------------------------------------------ the port */

/** `league_weeks` + the device-local bookkeeping, in twenty lines. */
class FakeCloud implements LeagueCloudDeps {
  signedInNow = true;
  handle = 'rotem';
  rivalRows: unknown[] = [];
  recentList: string[] = [];
  remembered: string[] = [];
  ghosts = new Map<string, Record<string, unknown>>();
  loads: string[] = [];
  /** What the next `load` reports — a failed fetch returns the CACHE. */
  nextStale = false;
  /** Local time on purpose: the "נכון ל…" line is rendered in the reader's. */
  nextFetchedAt: number | null = new Date(2026, 6, 13, 9, 30).getTime();

  signedIn(): boolean {
    return this.signedInNow;
  }
  myHandle(): string {
    return this.signedInNow ? this.handle : '';
  }
  recent(): readonly string[] {
    return this.recentList;
  }
  remember(handle: string): void {
    if (!this.remembered.includes(handle)) this.remembered.unshift(handle);
  }
  cached(handle: string, monthKey: string): LeagueMonthSnapshot {
    return { handle, monthKey, month: opponentMonth(this.rivalRows, monthKey), fetchedAt: null, stale: true };
  }
  async load(handle: string, monthKey: string): Promise<LeagueMonthSnapshot> {
    this.loads.push(handle);
    return {
      handle,
      monthKey,
      month: opponentMonth(this.rivalRows, monthKey),
      fetchedAt: this.nextFetchedAt,
      stale: this.nextStale,
    };
  }
  async fetchGhost(handle: string): Promise<LeagueGhostRow | null> {
    const payload = this.ghosts.get(handle);
    return payload ? { handle, payload } : null;
  }
}

/** A rival whose closed weeks are exactly the rows their device would publish. */
function rivalRowsFrom(store: LocalStore): unknown[] {
  return publishableWeeks(gameOf(store).league.weeks, TODAY) as unknown[];
}

/* ==================================================== 1. the tab and hub */

describe('the 🏆 ליגה tab', () => {
  it('is the third inner tab of the game hub, after קרב and דמות', () => {
    expect(GAME_TABS.map((t) => t.viewId)).toEqual(['BT', 'CH', 'LG']);
    expect(hubOf('LG')).toBe('GM');

    mountShell(new LocalStore(fakeStorage()));
    click('#tabs .hub[data-hub="GM"]');
    const views = [...document.querySelectorAll<HTMLElement>('#tabs .tab')].map((t) => t.dataset['view']);
    expect(views).toEqual(['BT', 'CH', 'LG']);
    expect(document.querySelector('#tabs .tab[data-view="LG"]')?.textContent).toContain('ליגה');
  });

  it('opens the screen, lights its tab and puts the purse in the header', () => {
    const store = fundedStore();
    mountShell(store);
    click('#tabs .hub[data-hub="GM"]');
    click('#tabs .tab[data-view="LG"]');

    expect(store.getState().ui.view).toBe('LG');
    expect(document.querySelector('#tabs .tab[data-view="LG"]')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('#tabs .hub[data-hub="GM"]')?.classList.contains('active')).toBe(true);
    expect(text('#header .app-title')).toContain('הליגה');
    expect(text('#header .day-meta')).toContain(`🔵 ${gameOf(store).league.coins}`);
    // All four sections are on screen, in order.
    expect([...main().querySelectorAll('.lg-card')].map((s) => s.className.split(' ')[1])).toEqual([
      'lg-live',
      'lg-shop',
      'lg-history',
    ]); // no account ⇒ no race section
  });

  it('survives a reload left on the league screen — `LG` is a reserved view', () => {
    const store = fundedStore();
    store.update((d) => {
      d.ui.view = 'LG';
    });
    mountShell(store);
    expect(store.getState().ui.view).toBe('LG');
    expect(main().querySelector('.lg-live')).not.toBeNull();
  });
});

/* ================================================== 2. השבוע שלי — live */

describe('השבוע שלי — the live week', () => {
  /** Sunday full (12 sets), Monday half (6 of 12): 2 of 4 days, 18 of 24 sets. */
  function partialLiveWeek(): Record<string, Session> {
    const sessions = steady();
    sessions[LIVE] = session('A', ['a1', 'a2', 'a3'], SETS_PER_EXERCISE);
    sessions[iso(LIVE, 1)] = session('B', ['b1', 'b2', 'b3'], 2);
    return sessions;
  }

  it('renders the four components as bars carrying their concrete numbers', () => {
    const store = storeWith(partialLiveWeek());
    closeDueWeeks(store, NOW);
    paint(store);

    expect(main().querySelectorAll('.lg-live .lg-bar')).toHaveLength(4);
    expect(caption('.lg-live', 'c')).toBe(`2 מתוך ${WEEKLY_TARGET} ימים`);
    expect(caption('.lg-live', 'q')).toBe(`18 מתוך ${2 * PLANNED_PER_DAY} סטים`);
    expect(caption('.lg-live', 'p')).toBe(`0 מתוך ${BALANCE.league.prTarget} שיאים`);
    // L is a ratio against the player's OWN four steady weeks, so the caption
    // names both sides of it.
    expect(caption('.lg-live', 'l')).toContain('מול בסיס');

    // …and the bars are drawn at exactly those fractions: C = 2/4, Q = 18/24.
    const width = (comp: string): string =>
      (document.querySelector(`.lg-live .lg-bar[data-comp="${comp}"] .lb-track i`) as HTMLElement).style.width;
    expect(width('c')).toBe('50%');
    expect(width('q')).toBe('75%');
  });

  it('says exactly what is missing for the 🔵 — in days and sets, not percentages', () => {
    const store = storeWith(partialLiveWeek());
    closeDueWeeks(store, NOW);
    paint(store);

    const line = document.querySelector('.lg-coin');
    expect(line?.getAttribute('data-coin')).toBe('missing');
    // C needs 2 more days; Q needs ceil(0.8 × 24) − 18 = 2 more sets.
    expect(text('.lg-coin')).toBe('כדי לזכות ב־🔵 השבוע: עוד 2 ימי אימון ועוד 2 סטים.');
  });

  it('says so plainly once the week has earned its 🔵', () => {
    const sessions = steady();
    fullWeek(sessions, LIVE);
    const store = storeWith(sessions);
    closeDueWeeks(store, NOW);
    paint(store);

    expect(document.querySelector('.lg-coin')?.getAttribute('data-coin')).toBe('earned');
    expect(text('.lg-coin')).toContain('כבר מזכה במטבע');
    // 80 is a PERFECT ordinary week: C = Q = 1, L = 0.5 (exactly on my own
    // rolling baseline — there is deliberate head-room above a steady week).
    expect(text('.lg-live .lg-score b')).toBe('80');
    expect(text('.lg-live .lg-score span')).toBe('נקודות · מתוך 100');
  });

  it('opens on a week with no training at all without pretending anything', () => {
    const store = storeWith(steady());
    closeDueWeeks(store, NOW);
    paint(store);
    expect(caption('.lg-live', 'c')).toBe(`0 מתוך ${WEEKLY_TARGET} ימים`);
    expect(text('.lg-coin')).toContain('עדיין לא התאמנתם');
  });
});

/* ================================================ 3. המרוץ החודשי — race */

describe('המרוץ החודשי — my month against the rival’s', () => {
  it('draws both columns from the same records, totals them and names the leader', async () => {
    const me = fundedStore();
    // The rival trained three weeks of four days and skipped W5 entirely.
    const rivalSessions: Record<string, Session> = {};
    for (const week of [W1, W2, W3, W4]) fullWeek(rivalSessions, week);
    const rival = storeWith(rivalSessions);
    closeDueWeeks(rival, NOW);

    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(rival);
    cloud.recentList = ['yossi'];
    paint(me, cloud);
    await settle();

    expect(cloud.loads).toEqual(['yossi']);
    const section = main().querySelector('.lg-race');
    expect(section?.getAttribute('data-state')).toBe('ready');

    // One row per week of July, plus the totals row.
    const weeks = [...main().querySelectorAll('.lg-week:not(.total)')].map((w) => w.getAttribute('data-week'));
    expect(weeks).toEqual(JULY_WEEKS);

    // My W4 and the rival's W4 are drawn by the SAME bar component — four bars
    // each, same markup, from the same `LeagueWeekRecord` shape.
    const scope = `.lg-week[data-week="${W4}"]`;
    expect(document.querySelectorAll(`${scope} .lg-cell.mine .lg-bar`)).toHaveLength(4);
    expect(document.querySelectorAll(`${scope} .lg-cell.theirs .lg-bar`)).toHaveLength(4);
    expect(text(`${scope} .lg-cell.mine .lg-cell-score`)).toBe(text(`${scope} .lg-cell.theirs .lg-cell-score`));

    // W5: I trained, they did not — a CLOSED week of theirs, honestly graded 0.
    expect(text(`.lg-week[data-week="${W5}"] .lg-cell.theirs .lg-cell-score`)).toBe('0');
    // …while mine took the week AND its 🔵, which the score line says out loud.
    expect(text(`.lg-week[data-week="${W5}"] .lg-cell.mine .lg-cell-score`)).toBe('80 🔵');
    // A week nobody has reached yet is a DASH on both sides, never a zero.
    expect(text('.lg-week[data-week="2026-07-19"] .lg-cell.mine')).toBe('—');
    expect(text('.lg-week[data-week="2026-07-19"] .lg-cell.theirs')).toBe('—');
    // The live week is marked as still moving.
    expect(text(`.lg-week[data-week="${LIVE}"] .lg-cell.mine`)).toContain('בהתהוות');

    // The totals are the two `monthlyScore`s, and I am ahead by W5's score.
    const mine = Number(text('[data-total="mine"]'));
    const theirs = Number(text('[data-total="theirs"]'));
    expect(theirs).toBeGreaterThan(0);
    expect(mine).toBeGreaterThan(theirs);
    expect(text('.lg-leader')).toContain('אתם מובילים');
  });

  it('says nothing about freshness when the rows were just read', async () => {
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(fundedStore());
    cloud.recentList = ['yossi'];
    cloud.nextStale = false;
    paint(fundedStore(), cloud);
    await settle();

    expect(main().querySelector('.lg-race')).not.toBeNull();
    expect(main().querySelector('[data-stale]')).toBeNull();
  });

  it('dates the numbers when they came from the cache instead', async () => {
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(fundedStore());
    cloud.recentList = ['yossi'];
    cloud.nextStale = true; // a failed fetch returns the cached rows
    paint(fundedStore(), cloud);
    await settle();

    expect(text('[data-stale]')).toContain('נכון ל־13.07.2026');
    expect(text('[data-stale]')).toContain('לא הצלחנו לרענן');
  });

  it('shows NOTHING at all when nothing was ever read', async () => {
    const cloud = new FakeCloud();
    cloud.rivalRows = [];
    cloud.recentList = ['yossi'];
    cloud.nextStale = true;
    cloud.nextFetchedAt = null;
    paint(fundedStore(), cloud);
    await settle();

    // No rows, never read: the rival is reported as missing rather than as 0.
    expect(main().querySelector('[data-stale]')).toBeNull();
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('idle');
  });

  it('marks a rival whose ghost carries a 🛠 dev grant', async () => {
    const rival = fundedStore();
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(rival);
    cloud.recentList = ['yossi'];
    const ghost = buildGhost(gameOf(rival), 'yossi');
    cloud.ghosts.set('yossi', { ...(ghost as unknown as Record<string, unknown>), dev: true });
    paint(fundedStore(), cloud);
    await settle();

    expect(main().querySelector('.lg-dev')?.textContent).toBe('🛠');
    expect(main().querySelector('.lg-dev')?.getAttribute('title')).toContain('מצב מפתח');
  });

  it('leaves an honestly-trained rival unmarked', async () => {
    const rival = fundedStore();
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(rival);
    cloud.recentList = ['yossi'];
    cloud.ghosts.set('yossi', buildGhost(gameOf(rival), 'yossi') as unknown as Record<string, unknown>);
    paint(fundedStore(), cloud);
    await settle();

    expect(main().querySelector('.lg-dev')).toBeNull();
  });

  it('looks a rival up by hand and remembers them for the duel card too', async () => {
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(fundedStore());
    paint(fundedStore(), cloud);
    await settle();
    // Nobody remembered yet ⇒ nothing was fetched and the card invites a name.
    expect(cloud.loads).toEqual([]);
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('idle');

    const input = document.querySelector('#lgHandle') as HTMLInputElement;
    input.value = 'yossi';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click('#lgFind');
    await settle();

    expect(cloud.loads).toEqual(['yossi']);
    expect(cloud.remembered).toEqual(['yossi']); // the duel card's own list
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('ready');
  });

  it('refuses my own name, and a name nobody answers to, in Hebrew', async () => {
    const cloud = new FakeCloud();
    paint(fundedStore(), cloud);

    const type = (value: string): void => {
      const input = document.querySelector('#lgHandle') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      click('#lgFind');
    };

    type(cloud.handle);
    await settle();
    expect(text('.lg-race .lg-note.warn')).toContain('זה אתם');

    cloud.rivalRows = [];
    cloud.nextFetchedAt = null;
    type('nobody');
    await settle();
    expect(text('.lg-race .lg-note.warn')).toContain('לא נמצאו שבועות בשם "nobody"');
    expect(cloud.remembered).toEqual([]);
  });

  it('is ABSENT — not disabled — with no account behind the app', async () => {
    const cloud = new FakeCloud();
    cloud.signedInNow = false;
    cloud.recentList = ['yossi'];
    paint(fundedStore(), cloud);
    await settle();

    expect(main().querySelector('.lg-race')).toBeNull();
    expect(main().querySelector('#lgHandle')).toBeNull();
    expect(cloud.loads).toEqual([]);
    // …and the offline build, which has no port at all, is the same screen.
    paint(fundedStore());
    expect(main().querySelector('.lg-race')).toBeNull();
    expect(main().querySelector('.lg-shop')).not.toBeNull();
  });
});

/* ================================================= 4. חנות החודש — spend */

describe('חנות החודש — the pool and the 🔵', () => {
  const POOL = poolOfMonth(MONTH);
  const GIFT = POOL.rewards[0]!;
  const CHALLENGE = POOL.challenges[0]!;

  it('renders this month’s pool at its prices, with the purse', () => {
    const store = fundedStore();
    paint(store);

    expect(text('.lg-shop .lg-title')).toContain(POOL.he);
    expect(text('[data-purse]')).toBe(`🔵 ${gameOf(store).league.coins}`);
    for (const item of POOL.rewards) {
      const card = document.querySelector(`.lg-item[data-item="${item.id}"]`);
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain(item.he);
      expect(card?.querySelector('.li-price')?.textContent).toContain(String(priceOf(item.kind)));
    }
    for (const item of POOL.challenges) {
      expect(document.querySelector(`.lg-item[data-item="${item.id}"]`)).not.toBeNull();
    }
    // The social contract is on the card, in words.
    expect(text('[data-honor]')).toBe(LEAGUE_HONOR_HE);
  });

  it('redeems on confirmation: one event, a lighter purse, a claimed card', () => {
    const store = fundedStore();
    const before = store.getEvents().length;
    const coins = gameOf(store).league.coins;
    paint(store);

    click(`[data-redeem="${GIFT.id}"]`);
    expect(document.querySelector('#lgSheet')).not.toBeNull(); // never on the first tap
    expect(store.getEvents().length).toBe(before);

    click('[data-confirm]');
    const written = store.getEvents().slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]?.type).toBe('league_reward_redeemed');
    expect(written[0]?.payload['itemId']).toBe(GIFT.id);
    expect(gameOf(store).league.coins).toBe(coins - priceOf('gift'));

    expect(document.querySelector(`.lg-item[data-item="${GIFT.id}"]`)?.getAttribute('data-state')).toBe('claimed');
    expect(text(`.lg-item[data-item="${GIFT.id}"] [data-claimed]`)).toContain(fmtDate(todayISO(new Date())));
    expect(document.querySelector('#lgSheet')).toBeNull();
  });

  it('refuses a redemption the purse cannot cover — in Hebrew, and without an event', () => {
    const store = storeWith(fullWeek({}, W5)); // one week, nothing closed, 0 🔵
    const before = store.getEvents().length;
    paint(store);
    expect(gameOf(store).league.coins).toBe(0);

    click(`[data-redeem="${GIFT.id}"]`);
    click('[data-confirm]');

    expect(text('[data-error]')).toBe(LEAGUE_ERROR_HE.insufficient_coins);
    expect(store.getEvents().length).toBe(before);
    expect(document.querySelector(`.lg-item[data-item="${GIFT.id}"]`)?.getAttribute('data-state')).toBe('open');
  });

  it('refuses a second redemption of the same item that month', () => {
    const store = fundedStore();
    paint(store);
    click(`[data-redeem="${GIFT.id}"]`);
    click('[data-confirm]');
    // The claimed card has no button at all — the ledger is also the UI.
    expect(document.querySelector(`[data-redeem="${GIFT.id}"]`)).toBeNull();
  });

  it('stakes a challenge and pays its bonus back on "השלמתי ✓"', () => {
    const store = fundedStore();
    paint(store);
    const coins = gameOf(store).league.coins;

    click(`[data-stake="${CHALLENGE.id}"]`);
    click('[data-confirm]');
    expect(gameOf(store).league.challenges[MONTH]?.challengeId).toBe(CHALLENGE.id);
    expect(gameOf(store).league.coins).toBe(coins - priceOf('challenge'));

    // The staked challenge replaces the three choices, and shows its bonus.
    expect(document.querySelectorAll('.lg-pool.challenges .lg-item')).toHaveLength(1);
    expect(text('.lg-item.staked .li-price')).toContain(`בונוס ${CHALLENGE.bonus}`);

    click('[data-complete]');
    expect(gameOf(store).league.completions[`${MONTH}|${CHALLENGE.id}`]).toBe(CHALLENGE.bonus);
    expect(gameOf(store).league.coins).toBe(coins - priceOf('challenge') + CHALLENGE.bonus);
    expect(document.querySelector('.lg-item.staked')?.getAttribute('data-state')).toBe('done');
    expect(document.querySelector('[data-complete]')).toBeNull();
    expect(text('.lg-item.staked [data-claimed]')).toContain(`+${CHALLENGE.bonus}`);
  });

  it('spends a LOCAL ledger — the shop works signed out and offline', () => {
    const store = fundedStore();
    const cloud = new FakeCloud();
    cloud.signedInNow = false;
    paint(store, cloud);

    expect(main().querySelector('.lg-race')).toBeNull();
    click(`[data-redeem="${GIFT.id}"]`);
    click('[data-confirm]');
    expect(gameOf(store).league.redemptions[`${MONTH}|${GIFT.id}`]?.itemId).toBe(GIFT.id);
  });

  it('de-emphasises spending while behind — and blocks nothing', async () => {
    // The rival closed five perfect weeks; I closed none.
    const rival = fundedStore();
    const me = storeWith(fullWeek({}, LIVE));
    const cloud = new FakeCloud();
    cloud.rivalRows = rivalRowsFrom(rival);
    cloud.recentList = ['yossi'];
    paint(me, cloud);
    await settle();

    const shop = main().querySelector('.lg-shop');
    expect(shop?.getAttribute('data-behind')).toBe('1');
    expect(shop?.classList.contains('behind')).toBe(true);
    expect(text('[data-behind-note]')).toBe(LEAGUE_BEHIND_HE);
    // Dimmed, never disabled: the button is still a live button.
    expect(document.querySelector<HTMLButtonElement>(`[data-redeem="${GIFT.id}"]`)?.disabled).toBe(false);
    // …and while ahead nothing is dimmed at all.
    paint(fundedStore());
    expect(main().querySelector('.lg-shop')?.getAttribute('data-behind')).toBe('0');
    expect(main().querySelector('[data-behind-note]')).toBeNull();
  });
});

/* ==================================================== 5. היסטוריה + CSS */

describe('היסטוריה — the months already settled', () => {
  it('lists past months with their score, weeks and 🔵 — never the live one', () => {
    const store = fundedStore();
    paint(store);

    const months = [...main().querySelectorAll('.lg-month')].map((m) => m.getAttribute('data-month'));
    expect(months).toContain('2026-06');
    expect(months).not.toContain(MONTH); // the month in progress is the RACE, not history
    const june = gameOf(store).league.months['2026-06'];
    expect(text('.lg-month[data-month="2026-06"]')).toContain(`🔵 ${june?.coins ?? 0}`);
    expect(text('.lg-month[data-month="2026-06"]')).toContain(`${june?.weeks ?? 0} שבועות`);
  });

  it('says so when there is nothing to look back on yet', () => {
    paint(storeWith({}));
    expect(main().querySelectorAll('.lg-month')).toHaveLength(0);
    expect(text('.lg-history .lg-note')).toContain('עוד אין חודשים סגורים');
  });
});

describe('the screen obeys the app’s house rules', () => {
  it('keeps every control at ≥44px and switches the bar motion off on request', () => {
    const css = LEAGUE_CSS.replace(/\s+/g, '');
    for (const rule of ['.lg-btn{', '.lg-input{', '.lg-find{']) {
      const block = css.slice(css.indexOf(rule), css.indexOf(rule) + 220);
      expect(block).toContain('min-height:44px');
    }
    // The only motion on the screen is a bar growing to its width…
    expect(css).toContain('.lb-tracki{');
    expect(/\.lb-tracki\{[^}]*transition:width/.test(css)).toBe(true);
    // …and it is explicitly switched off under prefers-reduced-motion, because
    // the global rule in responsive.css kills animations, not transitions.
    const reduce = css.slice(css.indexOf('@media(prefers-reduced-motion:reduce)'));
    expect(reduce).toContain('.lb-tracki{transition:none}');
  });

  it('paints every bar at its resting (final) width, so nothing depends on motion', () => {
    const store = fundedStore();
    paint(store);
    const bars = [...main().querySelectorAll<HTMLElement>('.lg-live .lb-track i')];
    expect(bars).toHaveLength(4);
    for (const bar of bars) expect(bar.style.width).toMatch(/^\d+%$/);
  });
});
