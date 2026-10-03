/**
 * @vitest-environment jsdom
 *
 * tests/league.invite.test.ts — THE RIVAL IS CHOSEN, NEVER ASSIGNED.
 *
 *   1. `parseRivalHash` / `inviteLink` — the pure halves of an invitation link.
 *   2. No auto-rival: a duel opponent on the recent list is a SUGGESTION in the
 *      datalist, the card is an invitation, and nothing is fetched.
 *   3. A chosen rival (typed, or accepted) is remembered on the device and the
 *      screen reopens on it; the one migration keeps a rival this device has
 *      already raced (rows in the cache).
 *   4. `#rival=<handle>` routes to 🏆, asks first, and a yes goes through the
 *      SAME `findRival` checks as typing (not yourself, well-formed, exists);
 *      the hash leaves the address bar.
 *   5. Signed out, an invitation is a "sign in to accept" note — the race card
 *      itself stays absent.
 *   6. 📨 shares, or copies, and always leaves a selectable fallback.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { opponentMonth } from '../src/core/leagueSync.ts';
import { setLocale } from '../src/i18n/locale.ts';
import type { AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { makeEvent, rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import { createApp } from '../src/ui/app.ts';
import {
  captureRivalInvite,
  inviteLink,
  parseRivalHash,
  renderLeague,
  resetLeagueScreen,
  type InviteWindow,
  type LeagueCloudDeps,
  type LeagueMonthSnapshot,
} from '../src/ui/league.ts';
import { RestTimer } from '../src/ui/timer.ts';

/* --------------------------------------------------------------- fixtures */

const TODAY = '2026-07-13';
const MONTH = '2026-07';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A store with a few closed league weeks — a person who has been training. */
function trainedStore(): LocalStore {
  const events: AppEvent[] = ['2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28', '2026-07-05'].map((weekKey, i) =>
    makeEvent('league_week_closed', { weekKey, date: TODAY, score: 80, c: 1, q: 1, l: 0.5, p: 0, coin: true }, 1_000 + i),
  );
  const store = new LocalStore(fakeStorage());
  store.replaceAll(rebuildFromEvents(events, Date.parse(`${TODAY}T12:00:00.000Z`)), events);
  return store;
}

/** A closed week as `league_weeks` would hold it for the rival (score = 100 × (0.4 + 0.3 + 0.2·l)). */
function rivalRow(handle: string, weekKey: string, l: number): Record<string, unknown> {
  const score = Math.round(100 * (0.4 + 0.3 + 0.2 * l) * 10) / 10;
  return { handle, week_key: weekKey, month_key: MONTH, score, c: 1, q: 1, l, p: 0, volume: 1000, days: 4, prs: 0 };
}

/** The league port over plain lists — no network. */
class FakeCloud implements LeagueCloudDeps {
  signedInNow = true;
  handle = 'rotem';
  /** handle -> the rows the server holds for them. */
  server = new Map<string, unknown[]>();
  /** handle -> rows already cached on this device (a race seen before). */
  cache = new Map<string, unknown[]>();
  recentList: string[] = [];
  remembered: string[] = [];
  loads: string[] = [];

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
    const rows = this.cache.get(handle) ?? [];
    return { handle, monthKey, month: opponentMonth(rows, monthKey), fetchedAt: null, stale: true };
  }
  async load(handle: string, monthKey: string): Promise<LeagueMonthSnapshot> {
    this.loads.push(handle);
    const rows = this.server.get(handle);
    if (!rows) return this.cached(handle, monthKey);
    this.cache.set(handle, rows);
    return { handle, monthKey, month: opponentMonth(rows, monthKey), fetchedAt: Date.parse(`${TODAY}T09:00:00Z`), stale: false };
  }
}

function cloudWithYossi(): FakeCloud {
  const cloud = new FakeCloud();
  cloud.server.set('yossi', [rivalRow('yossi', '2026-06-28', 0.5), rivalRow('yossi', '2026-07-05', 0)]);
  return cloud;
}

const SHELL = readFileSync(resolvePath(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.history.replaceState(null, '', '/');
  resetLeagueScreen();
});

afterEach(() => {
  setLocale('he');
  vi.unstubAllGlobals();
});

const main = (): HTMLElement => document.getElementById('main') as HTMLElement;

function paint(store: LocalStore, cloud?: LeagueCloudDeps): void {
  renderLeague(main(), { store, today: TODAY, ...(cloud ? { cloud } : {}) });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function click(sel: string): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no element ${sel}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function text(sel: string): string {
  return (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function mountApp(store: LocalStore, league: LeagueCloudDeps): void {
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
  createApp(store, timer, { league }).render();
}

/* ======================================================= 1. the pure parts */

describe('parseRivalHash / inviteLink', () => {
  it('reads #rival=<handle>, percent-decoded and trimmed', () => {
    expect(parseRivalHash('#rival=yossi')).toBe('yossi');
    expect(parseRivalHash('rival=yossi')).toBe('yossi');
    expect(parseRivalHash(`#rival=${encodeURIComponent('דנה_כהן')}`)).toBe('דנה_כהן');
    expect(parseRivalHash('#rival=%20dana%20')).toBe('dana');
    expect(parseRivalHash('#x=1&rival=dana')).toBe('dana');
  });

  it('is null for anything that is not an invitation', () => {
    expect(parseRivalHash('')).toBeNull();
    expect(parseRivalHash('#')).toBeNull();
    expect(parseRivalHash('#rival=')).toBeNull();
    expect(parseRivalHash('#rival=%20%20')).toBeNull();
    expect(parseRivalHash('#access_token=abc&type=recovery')).toBeNull();
    expect(parseRivalHash(`#rival=${'x'.repeat(41)}`)).toBeNull();
    expect(() => parseRivalHash('#rival=%E0%A4%A')).not.toThrow();
  });

  it('builds a link whose hash parses back to the same handle', () => {
    for (const handle of ['yossi', 'דנה', 'a.b-c_d']) {
      const link = inviteLink('https://gym.example', '/app/', handle);
      expect(link.startsWith('https://gym.example/app/#rival=')).toBe(true);
      expect(parseRivalHash(new URL(link).hash)).toBe(handle);
    }
  });
});

describe('captureRivalInvite', () => {
  function fakeWindow(hash: string): InviteWindow & { replaced: string[] } {
    const replaced: string[] = [];
    return {
      replaced,
      location: { hash, pathname: '/app/', search: '?pwa=1' },
      history: { replaceState: (_d: unknown, _u: string, url?: string) => void replaced.push(url ?? '') },
    };
  }

  it('stores the invitation, routes to the league and clears the hash', () => {
    const store = new LocalStore(fakeStorage());
    const win = fakeWindow('#rival=yossi');
    expect(captureRivalInvite(store, win)).toBe(true);
    expect(store.getState().ui.invite).toBe('yossi');
    expect(store.getState().ui.view).toBe('LG');
    expect(win.replaced).toEqual(['/app/?pwa=1']);
    // Nothing is decided yet: no rival, and no event.
    expect(store.getState().ui.rival).toBeUndefined();
    expect(store.getEvents()).toHaveLength(0);
  });

  it('leaves any other hash — and the store — alone', () => {
    const store = new LocalStore(fakeStorage());
    const before = store.getState().ui.view;
    const win = fakeWindow('#access_token=abc');
    expect(captureRivalInvite(store, win)).toBe(false);
    expect(win.replaced).toEqual([]);
    expect(store.getState().ui.invite).toBeUndefined();
    expect(store.getState().ui.view).toBe(before);
  });
});

/* ============================================== 2. no rival until chosen */

describe('no automatic rival', () => {
  it('treats a recent duel opponent as a suggestion, never as the rival', async () => {
    const cloud = cloudWithYossi();
    cloud.recentList = ['yossi']; // fought their ghost once — never agreed to race
    paint(trainedStore(), cloud);
    await settle();

    expect(cloud.loads).toEqual([]);
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('idle');
    expect(main().querySelector('#lgRivals option[value="yossi"]')).not.toBeNull();
    expect((main().querySelector('#lgHandle') as HTMLInputElement).value).toBe('');
    // The empty state IS the invitation: my name, and the 📨 button.
    expect(text('.lg-race-head')).toContain('rotem');
    expect(text('#lgInvite')).toBe('📨 הזמנת יריב/ה');
    // …and the shop is not dimmed against a race nobody chose.
    expect(main().querySelector('.lg-shop')?.getAttribute('data-behind')).toBe('0');
  });

  it('remembers a typed rival on the device and reopens on it', async () => {
    const store = trainedStore();
    const cloud = cloudWithYossi();
    paint(store, cloud);
    const input = document.querySelector('#lgHandle') as HTMLInputElement;
    input.value = 'yossi';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click('#lgFind');
    await settle();
    expect(store.getState().ui.rival).toBe('yossi');
    expect(store.getEvents().some((e) => JSON.stringify(e.payload).includes('yossi'))).toBe(false);

    // A reload: the module state is gone, the device's choice is not.
    resetLeagueScreen();
    cloud.loads = [];
    paint(store, cloud);
    await settle();
    expect(cloud.loads).toEqual(['yossi']);
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('ready');
  });

  it('keeps a rival this device has already raced (the one migration)', async () => {
    const store = trainedStore();
    const cloud = cloudWithYossi();
    cloud.recentList = ['yossi'];
    cloud.cache.set('yossi', cloud.server.get('yossi') ?? []); // their month is already cached here
    paint(store, cloud);
    await settle();
    expect(cloud.loads).toEqual(['yossi']);
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('ready');
    // …and from now on it is a recorded choice like any other.
    expect(store.getState().ui.rival).toBe('yossi');
  });
});

/* =============================================== 3. the invitation flow */

describe('#rival=<handle> — asked, then checked like a typed name', () => {
  it('routes the app to 🏆, asks, and clears the hash', () => {
    window.history.replaceState(null, '', '/#rival=yossi');
    expect(window.location.hash).toBe('#rival=yossi');
    const store = trainedStore();
    mountApp(store, cloudWithYossi());

    expect(store.getState().ui.view).toBe('LG');
    expect(window.location.hash).toBe('');
    expect(text('.lg-invite-q')).toBe('להתחרות מול yossi?');
    expect(document.querySelector('[data-invite-accept]')).not.toBeNull();
  });

  it('a yes sets the rival through findRival — fetched, remembered, asked no more', async () => {
    const store = trainedStore();
    store.update((d) => {
      d.ui.invite = 'yossi';
    });
    const cloud = cloudWithYossi();
    paint(store, cloud);
    await settle();
    expect(cloud.loads).toEqual([]); // nothing before the answer

    click('[data-invite-accept]');
    await settle();
    expect(cloud.loads).toEqual(['yossi']);
    expect(cloud.remembered).toEqual(['yossi']);
    expect(store.getState().ui.rival).toBe('yossi');
    expect(store.getState().ui.invite).toBeUndefined();
    expect(main().querySelector('.lg-race')?.getAttribute('data-state')).toBe('ready');
    expect(main().querySelector('[data-invite-ask]')).toBeNull();
  });

  it('refuses my own link, a malformed name and a name nobody answers to', async () => {
    const cases: Array<[string, string]> = [
      ['rotem', 'זה אתם'],
      ['x', 'שם לוחם הוא לפחות 3 תווים.'],
      ['nobody', 'לא נמצאו שבועות בשם "nobody"'],
    ];
    for (const [handle, says] of cases) {
      resetLeagueScreen();
      const store = trainedStore();
      store.update((d) => {
        d.ui.invite = handle;
      });
      const cloud = cloudWithYossi();
      paint(store, cloud);
      click('[data-invite-accept]');
      await settle();
      expect(text('.lg-race .lg-note.warn')).toContain(says);
      expect(store.getState().ui.rival).toBeUndefined();
      expect(store.getState().ui.invite).toBeUndefined();
      expect(cloud.remembered).toEqual([]);
    }
  });

  it('a no forgets the invitation and fetches nothing', async () => {
    const store = trainedStore();
    store.update((d) => {
      d.ui.invite = 'yossi';
    });
    const cloud = cloudWithYossi();
    paint(store, cloud);
    click('[data-invite-decline]');
    await settle();
    expect(store.getState().ui.invite).toBeUndefined();
    expect(cloud.loads).toEqual([]);
    expect(main().querySelector('[data-invite-ask]')).toBeNull();
  });

  it('signed out: a "sign in to accept" note instead of the absent race card', async () => {
    const store = trainedStore();
    store.update((d) => {
      d.ui.invite = 'yossi';
    });
    const cloud = cloudWithYossi();
    cloud.signedInNow = false;
    paint(store, cloud);
    await settle();
    expect(text('[data-invite-signin]')).toContain('התחברו');
    expect(text('[data-invite-signin]')).toContain('yossi');
    expect(main().querySelector('#lgHandle')).toBeNull();
    expect(main().querySelector('[data-invite-accept]')).toBeNull();

    // After signing in (the invitation survived in the store) it is asked.
    cloud.signedInNow = true;
    paint(store, cloud);
    expect(text('.lg-invite-q')).toContain('yossi');
    // Without an invitation, signed out is still the old absent card.
    store.update((d) => {
      delete d.ui.invite;
    });
    cloud.signedInNow = false;
    paint(store, cloud);
    expect(main().querySelector('.lg-race')).toBeNull();
  });

  it('asks in English too', () => {
    setLocale('en');
    const store = trainedStore();
    store.update((d) => {
      d.ui.invite = 'yossi';
    });
    paint(store, cloudWithYossi());
    expect(text('.lg-invite-q')).toBe('Race against yossi?');
    expect(text('[data-invite-accept]')).toBe("⚔️ Yes, let's race");
    expect(text('#lgInvite')).toBe('📨 Invite a rival');
  });
});

/* ===================================================== 4. 📨 the button */

describe('📨 sending an invitation', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async (_data: { title?: string; text?: string; url?: string }) => undefined);
    vi.stubGlobal('navigator', { ...navigator, share });
    paint(trainedStore(), cloudWithYossi());
    click('#lgInvite');
    await settle();
    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0]?.[0] as { url: string; text: string } | undefined;
    expect(parseRivalHash(new URL(data?.url ?? 'x:').hash)).toBe('rotem');
    expect(data?.text).toContain('rotem');
    expect(main().querySelector('#lgInviteText')).toBeNull();
  });

  it('copies to the clipboard otherwise — and still shows the text to copy by hand', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    paint(trainedStore(), cloudWithYossi());
    click('#lgInvite');
    await settle();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String((writeText.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
    expect(copied).toContain('#rival=rotem');
    const field = main().querySelector<HTMLTextAreaElement>('#lgInviteText');
    expect(field?.readOnly).toBe(true);
    expect(field?.value).toBe(copied);
  });

  it('falls back to the selectable field when neither exists', async () => {
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: undefined });
    paint(trainedStore(), cloudWithYossi());
    click('#lgInvite');
    await settle();
    expect(main().querySelector<HTMLTextAreaElement>('#lgInviteText')?.value).toContain('#rival=rotem');
  });
});
