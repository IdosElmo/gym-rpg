/**
 * sync/account.ts — the account card at the top of the היסטוריה screen.
 *
 * The ENTIRE user-visible surface of cloud sync is this one card. There is no
 * settings screen, no sync button and no progress bar anywhere else, because
 * sync is not a feature you operate — it is a thing that either quietly works
 * or quietly waits. The card exists to answer three questions and nothing more:
 * am I backed up, as whom, and is anything still waiting.
 *
 * When sync is not configured (`syncConfigured()` false — placeholder config, or
 * the single-file build opened from `file://`) the card renders as the empty
 * string: not a disabled state, not an explanation, simply absent. Someone using
 * the offline app must never be shown a cloud feature they cannot have.
 *
 * The module is pure string + DOM: it holds no state, owns no engine and knows
 * nothing about Supabase. It reads a `SyncStatus` and calls back.
 */

import { esc } from '../ui/dom.ts';
import type { SyncStatus } from './engine.ts';

export const ACCOUNT_CARD_ID = 'accountCard';

export interface AccountDeps {
  /** Live status from the engine (`disabled` when there is no engine at all). */
  getStatus(): SyncStatus;
  /** The signed-in address, when known. */
  getEmail(): string | null;
  signIn(): void;
  signOut(): void;
  /** Injected for tests; the card shows relative times. */
  now?: () => number;
}

/** Kinds that mean "there is a session": everything except these three. */
export function isSignedIn(status: SyncStatus): boolean {
  return status.kind !== 'disabled' && status.kind !== 'signedOut' && status.kind !== 'reauth';
}

/* ----------------------------------------------------------------- copy */

function fmtAgo(then: number | null, now: number): string {
  if (then === null) return 'עדיין לא סונכרן';
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return 'סונכרן זה עתה';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `סונכרן לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `סונכרן לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `סונכרן לפני ${days} ימים`;
}

/** One short line describing what the engine is doing right now. */
function stateLine(status: SyncStatus, now: number): string {
  switch (status.kind) {
    case 'syncing':
      return 'מסנכרן…';
    case 'offline':
      return 'אין חיבור — הנתונים יסונכרנו כשהחיבור יחזור';
    case 'error':
      return 'הסנכרון נכשל — ננסה שוב אוטומטית';
    default:
      return fmtAgo(status.lastSyncAt, now);
  }
}

function pendingLine(status: SyncStatus): string {
  if (status.pending <= 0) return 'הכל מגובה ✓';
  return `${status.pending} פעולות ממתינות לגיבוי`;
}

/* --------------------------------------------------------------- render */

/**
 * The card's markup, or `''` when sync does not exist on this build.
 *
 * Three shapes, one per thing the user can do about it:
 *   signed out → invite to sign in;
 *   reauth     → the session died, sign in again (data is safe meanwhile);
 *   signed in  → who, when, how much is waiting, and the way out.
 */
export function renderAccountCard(deps: AccountDeps): string {
  const status = deps.getStatus();
  if (status.kind === 'disabled') return '';
  const now = deps.now ? deps.now() : Date.now();

  if (status.kind === 'reauth') {
    return `
  <section class="game-card account-card" id="${ACCOUNT_CARD_ID}">
    <h3 class="gc-title">☁️ סנכרון בענן <span class="gc-sub warn">נדרשת פעולה</span></h3>
    <p class="gc-note">פג תוקף החיבור — נדרשת התחברות מחדש. הנתונים במכשיר לא נפגעו.</p>
    <button class="action-btn" id="btnSignIn">התחברות עם Google</button>
  </section>`;
  }

  if (!isSignedIn(status)) {
    return `
  <section class="game-card account-card" id="${ACCOUNT_CARD_ID}">
    <h3 class="gc-title">☁️ סנכרון בענן <span class="gc-sub">אופציונלי</span></h3>
    <p class="gc-note">התחברו כדי לגבות את האימונים ולסנכרן בין מכשירים. בלי התחברות הכל ממשיך לעבוד מקומית, בדיוק כמו היום.</p>
    <button class="action-btn" id="btnSignIn">התחברות עם Google</button>
  </section>`;
  }

  const email = deps.getEmail();
  return `
  <section class="game-card account-card" id="${ACCOUNT_CARD_ID}">
    <h3 class="gc-title">☁️ סנכרון בענן <span class="gc-sub">${esc(pendingLine(status))}</span></h3>
    <p class="gc-note">מחובר כ־<b>${esc(email ?? 'משתמש Google')}</b></p>
    <p class="gc-note dim">${esc(stateLine(status, now))}</p>
    <button class="action-btn" id="btnSignOut">התנתקות</button>
  </section>`;
}

/* ----------------------------------------------------------------- bind */

/** Wire the card's buttons. Call after every render of the card. */
export function bindAccountCard(root: ParentNode, deps: AccountDeps): void {
  root.querySelector<HTMLButtonElement>('#btnSignIn')?.addEventListener('click', () => deps.signIn());
  root.querySelector<HTMLButtonElement>('#btnSignOut')?.addEventListener('click', () => {
    // The wording is the whole point of the confirm: people expect "sign out"
    // to mean "delete my stuff off this phone", and here it emphatically does
    // not. Saying so is cheaper than an undo.
    if (confirm('להתנתק מהחשבון? הנתונים יישארו במכשיר; הסנכרון ייפסק.')) deps.signOut();
  });
}

/**
 * Repaint JUST the card, in place, wherever it currently is.
 *
 * The status changes on a timer (syncing → idle, pending counts ticking down)
 * and re-rendering the whole history screen for that would scroll the user back
 * to the top mid-read. Returns false when the card is not on screen — which is
 * the normal case, since it only exists on the היסטוריה tab.
 */
export function refreshAccountCard(deps: AccountDeps, doc: Document = document): boolean {
  const el = doc.getElementById(ACCOUNT_CARD_ID);
  if (!el) return false;
  const html = renderAccountCard(deps);
  if (!html) {
    el.remove();
    return true;
  }
  // The rendered string is a whole <section>; swap the element for the new one.
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  const next = holder.firstElementChild;
  if (!next) return false;
  el.replaceWith(next);
  bindAccountCard(next, deps);
  return true;
}
