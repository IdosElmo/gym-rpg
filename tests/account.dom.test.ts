/**
 * @vitest-environment jsdom
 *
 * account.dom.test.ts — the account card, and the two things that CHANGE
 * MEANING once there is an account behind the app.
 *
 * No engine, no Supabase, no network: the card is driven by a hand-written
 * `SyncStatus` and a fake `AccountDeps`, which is the whole point of keeping
 * `sync/account.ts` free of both. What is worth asserting here is not markup
 * but promises made to the user in Hebrew:
 *
 *   - an unconfigured build shows NOTHING about a cloud;
 *   - "התנתקות" says the data stays on the device, and only acts if confirmed;
 *   - "מחיקה" warns about the whole ACCOUNT once signed in;
 *   - "ייבוא" adds to the account instead of replacing it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalStore } from '../src/storage/LocalStore.ts';
import { buildExport } from '../src/storage/migrate.ts';
import type { StorageLike } from '../src/storage/migrate.ts';
import {
  ACCOUNT_CARD_ID,
  isSignedIn,
  refreshAccountCard,
  renderAccountCard,
  type AccountDeps,
} from '../src/sync/account.ts';
import type { SyncStatus } from '../src/sync/engine.ts';
import { createApp } from '../src/ui/app.ts';
import { CLEAR_CONFIRM_ACCOUNT, CLEAR_CONFIRM_LOCAL, initImportInput } from '../src/ui/settings.ts';
import { RestTimer } from '../src/ui/timer.ts';

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SHELL = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<\/body>/i.exec(SHELL)?.[1] ?? '';
const NOW = Date.parse('2025-05-04T18:00:00.000Z');

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.confirm = () => true;
});

/* -------------------------------------------------------------- fixtures */

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return { kind: 'idle', pending: 0, lastSyncAt: null, ...over };
}

interface FakeAccount extends AccountDeps {
  signedIn: number;
  signedOut: number;
  state: SyncStatus;
  email: string | null;
}

function fakeAccount(initial: SyncStatus = status()): FakeAccount {
  const acc: FakeAccount = {
    signedIn: 0,
    signedOut: 0,
    state: initial,
    email: 'lifter@example.com',
    getStatus: () => acc.state,
    getEmail: () => acc.email,
    signIn: () => void (acc.signedIn += 1),
    signOut: () => void (acc.signedOut += 1),
    now: () => NOW,
  };
  return acc;
}

interface Mounted {
  store: LocalStore;
  render: () => void;
  account: FakeAccount;
  merges: number;
}

function mount(account: FakeAccount, store: LocalStore = new LocalStore(fakeStorage())): Mounted {
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
  const mounted: Mounted = { store, render: () => undefined, account, merges: 0 };
  const app = createApp(store, timer, {
    settings: {
      account,
      isSignedIn: () => isSignedIn(account.state),
      onLocalMerge: () => void (mounted.merges += 1),
    },
  });
  mounted.render = app.render;
  // The card lives on the הגדרות inner tab of the settings hub (view `ST`).
  store.update((d) => {
    d.ui.view = 'ST';
  });
  app.render();
  return mounted;
}

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function cardText(): string {
  return document.getElementById(ACCOUNT_CARD_ID)?.textContent ?? '';
}

/* --------------------------------------------------- the שם לוחם editor */

describe('the שם לוחם editor', () => {
  /** An account that also has ghost duels — i.e. a handle it can rename. */
  function withHandle(taken: readonly string[] = []): FakeAccount & { handle: string; saves: string[] } {
    const acc = fakeAccount() as FakeAccount & { handle: string; saves: string[] };
    acc.handle = 'rotem';
    acc.saves = [];
    acc.getHandle = () => acc.handle;
    acc.setHandle = async (handle: string) => {
      acc.saves.push(handle);
      if (taken.includes(handle)) return false;
      acc.handle = handle;
      return true;
    };
    return acc;
  }

  const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('#ghostHandle');
  const msg = (): string => document.getElementById('handleMsg')?.textContent ?? '';
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it('is absent on a build without ghost duels, and while signed out', () => {
    mount(fakeAccount());
    expect(field()).toBeNull();
    document.body.innerHTML = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');
    const acc = withHandle();
    acc.state = status({ kind: 'signedOut' });
    mount(acc);
    expect(field()).toBeNull();
  });

  it('shows the current name and saves a new one', async () => {
    const acc = withHandle();
    mount(acc);
    expect(field()?.value).toBe('rotem');

    const input = field() as HTMLInputElement;
    input.value = '  Dana  ';
    click('#btnSaveHandle');
    await settle();
    // Canonicalised before it ever leaves the screen.
    expect(acc.saves).toEqual(['dana']);
    expect(msg()).toContain('נשמר');
    expect(msg()).toContain('dana');
  });

  it('refuses an impossible name locally, without asking the server', async () => {
    const acc = withHandle();
    mount(acc);
    const input = field() as HTMLInputElement;

    input.value = 'x';
    click('#btnSaveHandle');
    await settle();
    expect(msg()).toContain('3 תווים');

    input.value = 'dana🔥';
    click('#btnSaveHandle');
    await settle();
    expect(msg()).toContain('אותיות');

    input.value = 'a'.repeat(30);
    click('#btnSaveHandle');
    await settle();
    expect(msg()).toContain('20 תווים');

    expect(acc.saves).toEqual([]);
  });

  it('says so in Hebrew when the name is taken, and keeps the old one', async () => {
    const acc = withHandle(['yossi']);
    mount(acc);
    const input = field() as HTMLInputElement;
    input.value = 'yossi';
    click('#btnSaveHandle');
    await settle();
    expect(acc.saves).toEqual(['yossi']);
    expect(msg()).toContain('תפוס');
    expect(acc.handle).toBe('rotem');
  });
});

/* ------------------------------------------------------------ card states */

describe('the account card', () => {
  it('does not exist at all when sync is unconfigured', () => {
    const acc = fakeAccount(status({ kind: 'disabled' }));
    expect(renderAccountCard(acc)).toBe('');
    mount(acc);
    expect(document.getElementById(ACCOUNT_CARD_ID)).toBeNull();
    // …and nothing on the screen so much as mentions a cloud.
    expect(document.getElementById('main')?.textContent ?? '').not.toContain('סנכרון בענן');
  });

  it('invites a sign-in when signed out, promising the app still works without it', () => {
    const acc = fakeAccount(status({ kind: 'signedOut' }));
    mount(acc);
    const text = cardText();
    expect(text).toContain('סנכרון בענן');
    expect(text).toContain('לגבות את האימונים');
    expect(document.querySelector('#btnSignIn')?.textContent).toBe('התחברות עם Google');
    expect(document.querySelector('#btnSignOut')).toBeNull();

    click('#btnSignIn');
    expect(acc.signedIn).toBe(1);
  });

  it('shows who you are, when it last synced and what is still waiting', () => {
    const acc = fakeAccount(status({ kind: 'idle', pending: 3, lastSyncAt: NOW - 5 * 60_000 }));
    mount(acc);
    const text = cardText();
    expect(text).toContain('מחובר כ־');
    expect(text).toContain('lifter@example.com');
    expect(text).toContain('3 פעולות ממתינות לגיבוי');
    expect(text).toContain('סונכרן לפני 5 דקות');
    expect(document.querySelector('#btnSignOut')?.textContent).toBe('התנתקות');
  });

  it('says everything is backed up when nothing is pending', () => {
    const acc = fakeAccount(status({ kind: 'idle', lastSyncAt: NOW - 10_000 }));
    mount(acc);
    expect(cardText()).toContain('הכל מגובה');
    expect(cardText()).toContain('סונכרן זה עתה');
  });

  it('explains an offline stretch instead of showing an error', () => {
    const acc = fakeAccount(status({ kind: 'offline', pending: 2, lastSyncAt: NOW - 60_000 }));
    mount(acc);
    expect(cardText()).toContain('אין חיבור');
    expect(cardText()).toContain('2 פעולות ממתינות לגיבוי');
  });

  it('asks for a fresh sign-in when the session expired, and reassures about the data', () => {
    const acc = fakeAccount(status({ kind: 'reauth' }));
    mount(acc);
    expect(cardText()).toContain('פג תוקף החיבור — נדרשת התחברות מחדש');
    expect(cardText()).toContain('הנתונים במכשיר לא נפגעו');
    expect(document.querySelector('#btnSignIn')).not.toBeNull();
    // `reauth` is NOT a signed-in state: the data buttons go back to local
    // meanings while there is no working session.
    expect(isSignedIn(acc.state)).toBe(false);
  });

  it('signs out only after a confirm that promises the data stays', () => {
    const acc = fakeAccount(status({ kind: 'idle' }));
    mount(acc);
    let asked = '';
    window.confirm = (msg?: string) => {
      asked = msg ?? '';
      return false;
    };
    click('#btnSignOut');
    expect(asked).toContain('הנתונים יישארו במכשיר');
    expect(asked).toContain('הסנכרון ייפסק');
    expect(acc.signedOut).toBe(0); // declined → nothing happened

    window.confirm = () => true;
    click('#btnSignOut');
    expect(acc.signedOut).toBe(1);
  });

  it('repaints in place when the status changes, without touching the rest of the screen', () => {
    const acc = fakeAccount(status({ kind: 'syncing', pending: 1 }));
    mount(acc);
    expect(cardText()).toContain('מסנכרן');
    const planCard = document.querySelector('.plan-card');

    acc.state = status({ kind: 'idle', pending: 0, lastSyncAt: NOW });
    expect(refreshAccountCard(acc)).toBe(true);
    expect(cardText()).toContain('הכל מגובה');
    expect(document.querySelector('.plan-card')).toBe(planCard); // same DOM node

    // …and the swapped-in card is live again
    click('#btnSignOut');
    expect(acc.signedOut).toBe(1);
  });
});

/* --------------------------------------------- signed-in data semantics */

describe('what the data buttons mean once there is an account', () => {
  it('warns that מחיקה wipes the account and every device', () => {
    const acc = fakeAccount(status({ kind: 'idle' }));
    const m = mount(acc);
    m.store.append('set_completed', { date: '2025-05-04', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '10' });
    m.render();

    let asked = '';
    window.confirm = (msg?: string) => {
      asked = msg ?? '';
      return false;
    };
    click('#btnClear');
    expect(asked).toBe(CLEAR_CONFIRM_ACCOUNT);
    expect(asked).toContain('מכל המכשירים');
  });

  it('keeps the single-device wording when signed out', () => {
    const acc = fakeAccount(status({ kind: 'signedOut' }));
    mount(acc);
    let asked = '';
    window.confirm = (msg?: string) => {
      asked = msg ?? '';
      return false;
    };
    click('#btnClear');
    expect(asked).toBe(CLEAR_CONFIRM_LOCAL);
    expect(asked).not.toContain('מכל המכשירים');
  });
});

/* ---------------------------------------------------------------- import */

/**
 * Drive the hidden file input exactly like a real file pick, then wait for the
 * import to land (`FileReader` is async even for a string blob).
 */
async function importFile(text: string, done: () => boolean): Promise<void> {
  const input = document.getElementById('importFile') as HTMLInputElement;
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 200 && !done(); i += 1) await new Promise((r) => setTimeout(r, 2));
  if (!done()) throw new Error('the import never completed');
}

/** A backup file written by "another device". */
function backupBlob(): string {
  const other = new LocalStore(fakeStorage());
  other.append('set_completed', { date: '2025-04-01', day: 'B', exId: 'b1', setIndex: 0, w: '60', r: '8' });
  other.update((d) => {
    d.sessions['2025-04-01'] = { day: 'B', ex: { b1: [{ w: '60', r: '8', done: true }] } };
  });
  return JSON.stringify(buildExport(other.getState(), other.getEvents()));
}

describe('importing a backup', () => {
  it('is ADDITIVE while signed in: the local log survives and gains the file', async () => {
    const acc = fakeAccount(status({ kind: 'idle' }));
    const m = mount(acc);
    const mine = m.store.append('set_completed', {
      date: '2025-05-04',
      day: 'A',
      exId: 'a1',
      setIndex: 0,
      w: '40',
      r: '10',
    });
    const replaceAll = vi.spyOn(m.store, 'replaceAll');
    initImportInput(m.store, m.render, {
      isSignedIn: () => isSignedIn(acc.state),
      onLocalMerge: () => void (m.merges += 1),
    });

    await importFile(backupBlob(), () => m.store.getEvents().some((e) => e.type === 'data_merged'));

    const ids = m.store.getEvents().map((e) => e.id);
    // The device's own history is still there — a replace would have lost it.
    expect(ids).toContain(mine.id);
    expect(m.store.getState().sessions['2025-04-01']).toBeDefined();
    expect(m.store.getState().sessions['2025-05-04']).toBeDefined();
    // A `data_merged` marker explains the jump, and no destructive
    // `data_imported` was written.
    const types = m.store.getEvents().map((e) => e.type);
    expect(types).toContain('data_merged');
    expect(types).not.toContain('data_imported');
    // `replaceAll` is still HOW the union lands — but with the union in it.
    expect(replaceAll).toHaveBeenCalledTimes(1);
    const passed = replaceAll.mock.calls[0]?.[1] ?? [];
    expect(passed.some((e) => e.id === mine.id)).toBe(true);
    // …and the engine was told there is something new to upload.
    expect(m.merges).toBe(1);
  });

  it('is DESTRUCTIVE while signed out: the file replaces the device', async () => {
    const acc = fakeAccount(status({ kind: 'signedOut' }));
    const m = mount(acc);
    const mine = m.store.append('set_completed', {
      date: '2025-05-04',
      day: 'A',
      exId: 'a1',
      setIndex: 0,
      w: '40',
      r: '10',
    });
    initImportInput(m.store, m.render, {
      isSignedIn: () => isSignedIn(acc.state),
      onLocalMerge: () => void (m.merges += 1),
    });

    await importFile(backupBlob(), () => m.store.getEvents().some((e) => e.type === 'data_imported'));

    const ids = m.store.getEvents().map((e) => e.id);
    expect(ids).not.toContain(mine.id);
    expect(m.store.getEvents().map((e) => e.type)).toContain('data_imported');
    expect(m.merges).toBe(0);
  });
});
