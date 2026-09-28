/**
 * 🔔 Meal reminders: what the app uploads (the schedule, from the catalog),
 * what the server decides with it (the `meal-reminders` function's pure
 * halves — imported straight from the Deno file, whose server starts only
 * under Deno), and the subscription port over in-memory browser seams.
 */
import { describe, expect, it } from 'vitest';

import { reminderSchedule, suggestionsFor } from '../src/core/reminders.ts';
import { FOODS } from '../src/data/foods.ts';
import {
  createWebPushPort,
  subscriptionRow,
  vapidKeyBytes,
  type PushRegistrationLike,
  type PushSubLike,
  type WebPushDeps,
} from '../src/nutrition/push.ts';
import type { PushSubscriptionRow } from '../src/sync/supabaseBackend.ts';
import {
  dueWindow,
  localClock,
  readSchedule,
  reminderMessage,
  slotLogged,
} from '../supabase/functions/meal-reminders/index.ts';

describe('the schedule the app uploads', () => {
  it('is the five windowed meals, in order, with the owner\'s hours', () => {
    expect(reminderSchedule().map((w) => [w.slot, w.from, w.to])).toEqual([
      ['breakfast', '08:00', '10:00'],
      ['snack_am', '10:00', '12:00'],
      ['lunch', '12:00', '16:00'],
      ['snack_pm', '16:00', '18:00'],
      ['dinner', '18:00', '21:00'],
    ]);
  });

  it('suggests the fixed meals where there are some, else foods — never an add-on, never nothing', () => {
    expect(suggestionsFor('breakfast')).toEqual(['שיבולת שועל', 'ביצים עם סלט', 'חביתה עם סלט']);
    expect(suggestionsFor('dinner')).toEqual(['שיבולת שועל', 'ביצים עם סלט', 'חביתה עם סלט']);
    const addOns = FOODS.filter((f) => f.addOn).map((f) => f.name);
    expect(addOns).toEqual(expect.arrayContaining(['שמן זית', 'ספריי שמן', 'טחינה גולמית']));
    for (const w of reminderSchedule()) {
      expect(w.suggestions.length).toBeGreaterThan(0);
      for (const a of addOns) expect(w.suggestions).not.toContain(a);
    }
    expect(suggestionsFor('lunch')).toContain('חזה עוף צלוי');
    expect(suggestionsFor('snack_pm')).toContain('תפוח');
  });

  it('passes through the server\'s reader unchanged — the upload contract', () => {
    const uploaded = JSON.parse(JSON.stringify(reminderSchedule())) as unknown;
    expect(readSchedule(uploaded)).toEqual(reminderSchedule());
  });
});

describe('the server\'s decisions (meal-reminders)', () => {
  it('reads a schedule defensively', () => {
    expect(readSchedule('junk')).toEqual([]);
    expect(
      readSchedule([
        { slot: 'lunch', label: 'צהריים', from: '12:00', to: '16:00', suggestions: ['עוף', 7, ''] },
        { slot: 'x', label: 'y', from: '8', to: '10:00' },
        null,
      ]),
    ).toEqual([{ slot: 'lunch', label: 'צהריים', from: '12:00', to: '16:00', suggestions: ['עוף'] }]);
  });

  it('reads the hour in the device\'s zone — summer, winter, and past midnight', () => {
    // Israel: UTC+3 in September, UTC+2 in December
    expect(localClock(new Date('2026-09-28T05:00:00Z'), 'Asia/Jerusalem')).toEqual({ date: '2026-09-28', hour: '08' });
    expect(localClock(new Date('2026-12-01T06:00:00Z'), 'Asia/Jerusalem')).toEqual({ date: '2026-12-01', hour: '08' });
    expect(localClock(new Date('2026-09-28T22:30:00Z'), 'Asia/Jerusalem')).toEqual({ date: '2026-09-29', hour: '01' });
    // a garbage zone falls back to Israel rather than throwing
    expect(localClock(new Date('2026-09-28T05:00:00Z'), 'Not/AZone').hour).toBe('08');
  });

  it('fires only in the hour a window starts', () => {
    const sched = readSchedule(reminderSchedule());
    expect(dueWindow(sched, '08')?.slot).toBe('breakfast');
    expect(dueWindow(sched, '12')?.slot).toBe('lunch');
    expect(dueWindow(sched, '18')?.slot).toBe('dinner');
    expect(dueWindow(sched, '09')).toBeNull();
    expect(dueWindow(sched, '13')).toBeNull();
    expect(dueWindow(sched, '21')).toBeNull();
  });

  it('skips a meal already logged — unless that entry was deleted, or was another meal or day', () => {
    const logged = (id: string, date: string, slot: string) => ({ type: 'meal_logged', payload: { id, date, slot } });
    const del = (id: string) => ({ type: 'meal_deleted', payload: { id } });
    expect(slotLogged([logged('a', '2026-09-28', 'breakfast')], '2026-09-28', 'breakfast')).toBe(true);
    expect(slotLogged([logged('a', '2026-09-28', 'breakfast'), del('a')], '2026-09-28', 'breakfast')).toBe(false);
    expect(slotLogged([logged('a', '2026-09-28', 'lunch')], '2026-09-28', 'breakfast')).toBe(false);
    expect(slotLogged([logged('a', '2026-09-27', 'breakfast')], '2026-09-28', 'breakfast')).toBe(false);
    expect(
      slotLogged([logged('a', '2026-09-28', 'breakfast'), del('a'), logged('b', '2026-09-28', 'breakfast')], '2026-09-28', 'breakfast'),
    ).toBe(true);
  });

  it('says the meal, until when, and one suggestion', () => {
    const win = { slot: 'breakfast', label: 'ארוחת בוקר', from: '08:00', to: '10:00', suggestions: ['א', 'ב', 'ג'] };
    expect(reminderMessage(win, 0)).toEqual({
      title: '🍽️ ארוחת בוקר',
      body: 'החלון פתוח עד 10:00 · הצעה מהתפריט: א',
      tag: 'meal-breakfast',
    });
    expect(reminderMessage(win, 0.99).body).toContain('ג');
    expect(reminderMessage({ ...win, suggestions: [] }, 0.5).body).toBe('החלון פתוח עד 10:00');
  });
});

/* ------------------------------------------------------------ the port */

function fakeBrowser(opts: { permission?: NotificationPermission | 'unsupported'; grant?: NotificationPermission; noSw?: boolean } = {}) {
  let permission = opts.permission ?? 'default';
  let sub: PushSubLike | null = null;
  const subscribeKeys: ArrayBuffer[] = [];
  const saved: PushSubscriptionRow[] = [];
  const removed: string[] = [];
  let unsubscribed = 0;
  let signedIn = true;
  let saveOk = true;
  let removeOk = true;
  const reg: PushRegistrationLike = {
    pushManager: {
      getSubscription: () => Promise.resolve(sub),
      subscribe: (o) => {
        subscribeKeys.push(o.applicationServerKey);
        sub = {
          endpoint: 'https://push.example/abc',
          toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }),
          unsubscribe: () => {
            unsubscribed += 1;
            sub = null;
            return Promise.resolve(true);
          },
        };
        return Promise.resolve(sub);
      },
    },
  };
  const deps: WebPushDeps = {
    vapidPublicKey: 'AQID',
    registration: () => Promise.resolve(opts.noSw ? null : reg),
    permission: () => permission,
    requestPermission: () => {
      permission = opts.grant ?? 'granted';
      return Promise.resolve(permission);
    },
    timeZone: () => 'Asia/Jerusalem',
    isSignedIn: () => signedIn,
    schedule: () => [{ slot: 'breakfast' }],
    save: (row) => {
      saved.push(row);
      return Promise.resolve(saveOk);
    },
    remove: (endpoint) => {
      removed.push(endpoint);
      return Promise.resolve(removeOk);
    },
  };
  return {
    port: createWebPushPort(deps),
    saved,
    removed,
    subscribeKeys,
    get unsubscribed() {
      return unsubscribed;
    },
    signOut: () => (signedIn = false),
    failSave: () => (saveOk = false),
    failRemove: () => (removeOk = false),
  };
}

describe('the subscription port', () => {
  it('decodes a base64url VAPID key', () => {
    expect([...new Uint8Array(vapidKeyBytes('AQID'))]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(vapidKeyBytes('-_8'))]).toEqual([251, 255]);
  });

  it('builds a row only when the browser gave keys', () => {
    const sub = (keys: Record<string, string>): PushSubLike => ({
      endpoint: 'e',
      toJSON: () => ({ keys }),
      unsubscribe: () => Promise.resolve(true),
    });
    expect(subscriptionRow(sub({ p256dh: 'p', auth: 'a' }), [], '')).toEqual({
      endpoint: 'e',
      p256dh: 'p',
      auth: 'a',
      tz: 'Asia/Jerusalem',
      schedule: [],
    });
    expect(subscriptionRow(sub({ p256dh: 'p' }), [], 'UTC')).toBeNull();
  });

  it('turns on: asks permission, subscribes with the key, uploads the row with the schedule', async () => {
    const b = fakeBrowser();
    expect(await b.port.status()).toBe('off');
    expect(await b.port.enable()).toBe('on');
    expect([...new Uint8Array(b.subscribeKeys[0]!)]).toEqual([1, 2, 3]);
    expect(b.saved).toEqual([
      { endpoint: 'https://push.example/abc', p256dh: 'P', auth: 'A', tz: 'Asia/Jerusalem', schedule: [{ slot: 'breakfast' }] },
    ]);
    expect(await b.port.status()).toBe('on');
    // boot refresh re-uploads, and enabling again reuses the subscription
    await b.port.refresh();
    expect(await b.port.enable()).toBe('on');
    expect(b.saved).toHaveLength(3);
    expect(b.subscribeKeys).toHaveLength(1);
  });

  it('turns off: the row first, then the browser subscription', async () => {
    const b = fakeBrowser();
    await b.port.enable();
    expect(await b.port.disable()).toBe('off');
    expect(b.removed).toEqual(['https://push.example/abc']);
    expect(b.unsubscribed).toBe(1);
    expect(await b.port.status()).toBe('off');
    await b.port.refresh();
    expect(b.saved).toHaveLength(1);
  });

  it('keeps the device subscribed when the row could not be deleted', async () => {
    const b = fakeBrowser();
    await b.port.enable();
    b.failRemove();
    expect(await b.port.disable()).toBe('failed');
    expect(b.unsubscribed).toBe(0);
    expect(await b.port.status()).toBe('on');
  });

  it('reports what stands in the way: denied, signed out, no service worker, no Notification API, a failed save', async () => {
    const denied = fakeBrowser({ grant: 'denied' });
    expect(await denied.port.enable()).toBe('denied');
    expect(await denied.port.status()).toBe('denied');
    expect(denied.saved).toHaveLength(0);

    const out = fakeBrowser();
    out.signOut();
    expect(await out.port.status()).toBe('signed_out');
    expect(await out.port.enable()).toBe('signed_out');

    expect(await fakeBrowser({ noSw: true }).port.status()).toBe('unsupported');
    expect(await fakeBrowser({ permission: 'unsupported' }).port.enable()).toBe('unsupported');

    const flaky = fakeBrowser();
    flaky.failSave();
    expect(await flaky.port.enable()).toBe('failed');
  });
});
