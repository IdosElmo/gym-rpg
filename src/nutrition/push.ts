/**
 * nutrition/push.ts — the 🔔 meal-reminder subscription seam.
 *
 * The same move as aiPort/edgePort: the screen talks to a small `PushPort`,
 * tests implement the browser in memory, and the real browser APIs
 * (`Notification`, the service worker's `pushManager`) enter only through
 * `browserPushSeams()`, wired from main.ts. The server half is the
 * `meal-reminders` Edge Function; this file only turns the device's push
 * subscription ON (permission → subscribe → upsert the row with the schedule)
 * and OFF (delete the row → unsubscribe), and re-uploads the schedule on boot
 * so a catalog change reaches the server without anyone touching it.
 */

import type { PushSubscriptionRow } from '../sync/supabaseBackend.ts';

/** Where the device stands. `on` = subscribed here (the row is refreshed on boot). */
export type PushStatus = 'unsupported' | 'signed_out' | 'denied' | 'off' | 'on';
export type PushResult = PushStatus | 'failed';

export interface PushPort {
  status(): Promise<PushStatus>;
  enable(): Promise<PushResult>;
  disable(): Promise<PushResult>;
  /** Re-upload the schedule when already subscribed; a no-op otherwise. */
  refresh(): Promise<void>;
}

/** The slice of `PushSubscription` this module uses. */
export interface PushSubLike {
  endpoint: string;
  toJSON(): { keys?: Record<string, string | undefined> };
  unsubscribe(): Promise<boolean>;
}

/** The slice of `ServiceWorkerRegistration` this module uses. */
export interface PushRegistrationLike {
  pushManager: {
    getSubscription(): Promise<PushSubLike | null>;
    subscribe(opts: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer }): Promise<PushSubLike>;
  };
}

export interface BrowserPushSeams {
  /** The app's service-worker registration, or `null` (none, or no Push API). */
  registration(): Promise<PushRegistrationLike | null>;
  permission(): NotificationPermission | 'unsupported';
  requestPermission(): Promise<NotificationPermission>;
  timeZone(): string;
}

export interface WebPushDeps extends BrowserPushSeams {
  vapidPublicKey: string;
  isSignedIn(): boolean;
  /** What the reminders say — `reminderSchedule()`, uploaded with the row. */
  schedule(): unknown;
  save(row: PushSubscriptionRow): Promise<boolean>;
  remove(endpoint: string): Promise<boolean>;
}

/* ------------------------------------------------------------ pure halves */

/** A VAPID key (base64url, as `web-push` prints it) → the bytes `subscribe` wants. */
export function vapidKeyBytes(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** The row for a subscription, or `null` when the browser gave no keys. */
export function subscriptionRow(sub: PushSubLike, schedule: unknown, tz: string): PushSubscriptionRow | null {
  const keys = sub.toJSON().keys ?? {};
  const p256dh = keys['p256dh'];
  const auth = keys['auth'];
  if (!sub.endpoint || !p256dh || !auth) return null;
  return { endpoint: sub.endpoint, p256dh, auth, tz: tz || 'Asia/Jerusalem', schedule };
}

/* ------------------------------------------------------------------ port */

export function createWebPushPort(deps: WebPushDeps): PushPort {
  async function current(): Promise<{ reg: PushRegistrationLike; sub: PushSubLike | null } | null> {
    const reg = await deps.registration();
    if (!reg) return null;
    return { reg, sub: await reg.pushManager.getSubscription() };
  }

  async function upload(sub: PushSubLike): Promise<boolean> {
    const row = subscriptionRow(sub, deps.schedule(), deps.timeZone());
    return row ? deps.save(row) : false;
  }

  return {
    async status(): Promise<PushStatus> {
      if (deps.permission() === 'unsupported') return 'unsupported';
      const cur = await current();
      if (!cur) return 'unsupported';
      if (!deps.isSignedIn()) return 'signed_out';
      if (deps.permission() === 'denied') return 'denied';
      return cur.sub && deps.permission() === 'granted' ? 'on' : 'off';
    },

    async enable(): Promise<PushResult> {
      if (deps.permission() === 'unsupported') return 'unsupported';
      if (!deps.isSignedIn()) return 'signed_out';
      const cur = await current();
      if (!cur) return 'unsupported';
      const perm = deps.permission() === 'granted' ? 'granted' : await deps.requestPermission();
      if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
      try {
        const sub =
          cur.sub ??
          (await cur.reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes(deps.vapidPublicKey),
          }));
        return (await upload(sub)) ? 'on' : 'failed';
      } catch {
        return 'failed';
      }
    },

    async disable(): Promise<PushResult> {
      const cur = await current();
      if (!cur) return 'unsupported';
      if (!cur.sub) return 'off';
      // The row first: a device that stays subscribed but has no row gets
      // nothing, while the reverse would keep pushing to a dead endpoint.
      if (!(await deps.remove(cur.sub.endpoint))) return 'failed';
      try {
        await cur.sub.unsubscribe();
      } catch {
        /* the row is gone — the server will not push to it any more */
      }
      return 'off';
    },

    async refresh(): Promise<void> {
      if (!deps.isSignedIn() || deps.permission() !== 'granted') return;
      const cur = await current();
      if (cur?.sub) await upload(cur.sub);
    },
  };
}

/* ------------------------------------------------------- the real browser */

/** The real browser APIs — main.ts only; tests pass their own seams. */
export function browserPushSeams(): BrowserPushSeams {
  const hasNotification = typeof Notification !== 'undefined';
  return {
    async registration(): Promise<PushRegistrationLike | null> {
      if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return null;
      // `getRegistration`, not `ready`: `ready` never settles when no worker
      // was registered (a file:// copy), and the screen must not hang on it.
      const reg = await navigator.serviceWorker.getRegistration();
      return (reg as unknown as PushRegistrationLike | undefined) ?? null;
    },
    permission: () => (hasNotification ? Notification.permission : 'unsupported'),
    requestPermission: () => (hasNotification ? Notification.requestPermission() : Promise.resolve('denied')),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem',
  };
}
