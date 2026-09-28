/**
 * meal-reminders — the 🔔 push reminders of the 🍽️ nutrition tracker.
 *
 * WHY A SERVER AT ALL: a phone's browser cannot wake a closed web app on a
 * clock; only a Web Push message from a server can. So once an hour a pg_cron
 * job POSTs this function (see `supabase/reminders.sql`), and the function
 * walks every stored push subscription:
 *
 *   1. what time is it THERE (the subscription's own IANA time zone — so
 *      daylight saving is the time zone's problem, not ours);
 *   2. does one of that device's meal windows start this hour;
 *   3. did the user already log something in that meal today (the synced
 *      `events` table) — then stay quiet;
 *   4. otherwise push "🍽️ ארוחת בוקר · עד 10:00 · הצעה: שיבולת שועל", the
 *      suggestion drawn at random from the window's list.
 *
 * THE APP DECIDES THE CONTENT. Each subscription row carries its `schedule`
 * (windows + suggestions), uploaded by the app from its own catalog every
 * time it opens — this function hardcodes no meal, no hour, no food.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY — `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT   — `mailto:you@example.com` (who the push services may contact)
 *   CRON_SECRET     — any long random string; the cron job sends it back
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
 *
 * Deploy with JWT verification OFF (the caller is pg_cron, not a user); the
 * `x-cron-secret` header is the lock instead. POST `{ "test": true }` with the
 * same header to push a test reminder to every subscription right now.
 *
 * DENO code, paste-deployed like estimate-meal — not part of the app bundle.
 * The pure helpers are exported (and the server starts only under Deno), so
 * the app's test suite pins them.
 */

/* ------------------------------------------------------------ pure halves */

export interface Win {
  slot: string;
  label: string;
  from: string;
  to: string;
  suggestions: string[];
}

const HHMM = /^\d{2}:\d{2}$/;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Read a stored schedule — client input, so every field is checked. */
export function readSchedule(raw: unknown): Win[] {
  if (!Array.isArray(raw)) return [];
  const out: Win[] = [];
  for (const w of raw.slice(0, 12)) {
    if (typeof w !== 'object' || w === null) continue;
    const r = w as Record<string, unknown>;
    const slot = str(r.slot, 20);
    const label = str(r.label, 40);
    const from = str(r.from, 5);
    const to = str(r.to, 5);
    if (!slot || !label || !HHMM.test(from) || !HHMM.test(to)) continue;
    const suggestions = Array.isArray(r.suggestions)
      ? r.suggestions.map((s) => str(s, 60)).filter(Boolean).slice(0, 40)
      : [];
    out.push({ slot, label, from, to, suggestions });
  }
  return out;
}

/** The wall clock in `tz`: its date ('YYYY-MM-DD') and hour ('HH'). */
export function localClock(now: Date, tz: string): { date: string; hour: string } {
  let zone = tz;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    zone = 'Asia/Jerusalem';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: get('hour') };
}

/** The window that starts in this hour, if any. The cron runs on the hour. */
export function dueWindow(schedule: readonly Win[], hour: string): Win | null {
  return schedule.find((w) => w.from.slice(0, 2) === hour) ?? null;
}

/**
 * Did the user already log a live meal in this slot on this date? `events` are
 * the user's `meal_logged` rows for the date plus their `meal_deleted` rows —
 * a deleted meal does not count.
 */
export function slotLogged(
  events: readonly { type: string; payload: Record<string, unknown> }[],
  date: string,
  slot: string,
): boolean {
  const deleted = new Set(
    events.filter((e) => e.type === 'meal_deleted').map((e) => String(e.payload.id ?? '')),
  );
  return events.some(
    (e) =>
      e.type === 'meal_logged' &&
      e.payload.date === date &&
      e.payload.slot === slot &&
      !deleted.has(String(e.payload.id ?? '')),
  );
}

/** "8:00" from "08:00". */
function hourText(hhmm: string): string {
  return hhmm.startsWith('0') ? hhmm.slice(1) : hhmm;
}

/** The notification, with one suggestion drawn by `rand` (0 ≤ rand < 1). */
export function reminderMessage(win: Win, rand: number): { title: string; body: string; tag: string } {
  const pick = win.suggestions.length > 0 ? win.suggestions[Math.floor(rand * win.suggestions.length)] : '';
  return {
    title: `🍽️ ${win.label}`,
    body: `החלון פתוח עד ${hourText(win.to)}${pick ? ` · הצעה מהתפריט: ${pick}` : ''}`,
    tag: `meal-${win.slot}`,
  };
}

/* ----------------------------------------------------------------- server */

interface SubRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  tz: string;
  schedule: unknown;
}

/** Deno's global, looked up rather than declared — absent under the app's tests. */
interface DenoLike {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
}
const DENO = (globalThis as unknown as { Deno?: DenoLike }).Deno;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  const env = (k: string): string => DENO?.env.get(k) ?? '';
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'unauthorized' });
  const publicKey = env('VAPID_PUBLIC_KEY');
  const privateKey = env('VAPID_PRIVATE_KEY');
  const subject = env('VAPID_SUBJECT');
  const url = env('SUPABASE_URL');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!publicKey || !privateKey || !subject || !url || !service) return json(500, { error: 'secrets missing' });

  let test = false;
  try {
    test = ((await req.json()) as Record<string, unknown>)?.test === true;
  } catch {
    /* an empty body is the cron's normal call */
  }

  const rest = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });

  const subsRes = await rest('push_subscriptions?select=endpoint,user_id,p256dh,auth,tz,schedule');
  if (!subsRes.ok) return json(502, { error: `subscriptions ${subsRes.status}` });
  const subs = (await subsRes.json()) as SubRow[];

  // web-push is loaded lazily so the pure halves above import anywhere.
  // @ts-ignore — a Deno `npm:` specifier; the app's tsc (which reaches this
  // file through the tests) cannot resolve it, and Deno does not need the hint.
  const webpush = (await import('npm:web-push@3.6.7')).default;
  webpush.setVapidDetails(subject, publicKey, privateKey);

  /** One query per (user, date, slot), however many devices the user has. */
  const loggedCache = new Map<string, Promise<boolean>>();
  const logged = (user: string, date: string, slot: string): Promise<boolean> => {
    const key = `${user}|${date}|${slot}`;
    let hit = loggedCache.get(key);
    if (!hit) {
      hit = (async () => {
        const q =
          `events?select=type,payload&user_id=eq.${user}&type=eq.meal_logged` +
          `&payload->>date=eq.${date}&payload->>slot=eq.${encodeURIComponent(slot)}`;
        const res = await rest(q);
        if (!res.ok) return false; // unknown: remind rather than stay silent
        const meals = (await res.json()) as { type: string; payload: Record<string, unknown> }[];
        if (meals.length === 0) return false;
        const ids = meals.map((m) => String(m.payload.id ?? '')).filter(Boolean);
        const del = await rest(
          `events?select=type,payload&user_id=eq.${user}&type=eq.meal_deleted&payload->>id=in.(${ids.join(',')})`,
        );
        const tombs = del.ok ? ((await del.json()) as { type: string; payload: Record<string, unknown> }[]) : [];
        return slotLogged([...meals, ...tombs], date, slot);
      })();
      loggedCache.set(key, hit);
    }
    return hit;
  };

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let removed = 0;
  for (const sub of subs) {
    const schedule = readSchedule(sub.schedule);
    const clock = localClock(now, sub.tz || 'Asia/Jerusalem');
    const win = test ? (schedule[0] ?? null) : dueWindow(schedule, clock.hour);
    if (!win) continue;
    if (!test && (await logged(sub.user_id, clock.date, win.slot))) {
      skipped += 1;
      continue;
    }
    const msg = reminderMessage(win, Math.random());
    const payload = test ? { ...msg, title: `🔔 בדיקה · ${msg.title}` } : msg;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      // 404/410: the browser dropped this subscription — forget it.
      if (status === 404 || status === 410) {
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' });
        removed += 1;
      }
    }
  }
  return json(200, { sent, skipped, removed, test });
}

if (DENO) DENO.serve(handle);
