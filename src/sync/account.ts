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

import { checkHandle, type HandleError } from '../core/handle.ts';
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

  /* -------------------------------------------------------- ghost duels */
  /**
   * The שם לוחם this account publishes under (`''` when none is known yet).
   * Absent (with `setHandle`) means this build has no ghost duels, and the
   * editor below is not rendered at all.
   */
  getHandle?: () => string;
  /**
   * Claim a handle. Resolves false when somebody else already owns it — the
   * card then says so in Hebrew and keeps the old name, because the only thing
   * a failed rename may not do is leave the user nameless.
   */
  setHandle?: (handle: string) => Promise<boolean>;
  /** Repaint after an async rename settles. */
  refresh?: () => void;
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
    ${handleEditor(deps)}
    <button class="action-btn" id="btnSignOut">התנתקות</button>
  </section>`;
}

/* ---------------------------------------------------------- שם לוחם */

/** Hebrew for every way a typed handle can be refused. */
const HANDLE_ERROR_HE: Readonly<Record<HandleError, string>> = {
  empty: 'צריך שם.',
  too_short: 'לפחות 3 תווים.',
  too_long: 'עד 20 תווים.',
  bad_chars: 'אותיות בעברית או באנגלית, ספרות ו־ _ . - בלבד.',
};

/** Hebrew for "somebody else got there first" — the only server-side refusal. */
export const HANDLE_TAKEN_HE = 'השם הזה כבר תפוס — נסו שם אחר.';

/**
 * The שם לוחם editor, or `''` on a build without ghost duels.
 *
 * It sits inside the account card because that is what it IS: the public half
 * of the same account. The name is device-local bookkeeping (see
 * `sync/meta.ts`), not an event, so changing it rewrites no history — it simply
 * republishes the snapshot under the new name.
 */
function handleEditor(deps: AccountDeps): string {
  if (!deps.getHandle || !deps.setHandle) return '';
  const handle = deps.getHandle();
  return `
    <div class="handle-editor">
      <label class="gc-note" for="ghostHandle">שם לוחם <span class="dim">— השם שיריבים מקלידים כדי להילחם בכם</span></label>
      <div class="handle-row">
        <input class="handle-input" id="ghostHandle" type="text" maxlength="20" autocomplete="off"
          value="${esc(handle)}" placeholder="לדוגמה: יוסי" aria-label="שם לוחם">
        <button class="action-btn" id="btnSaveHandle" type="button">שמירה</button>
      </div>
      <p class="gc-note dim" id="handleMsg" role="status"></p>
    </div>`;
}

/* ----------------------------------------------------------------- bind */

/** Wire the card's buttons. Call after every render of the card. */
export function bindAccountCard(root: ParentNode, deps: AccountDeps): void {
  root.querySelector<HTMLButtonElement>('#btnSignIn')?.addEventListener('click', () => deps.signIn());
  bindHandleEditor(root, deps);
  root.querySelector<HTMLButtonElement>('#btnSignOut')?.addEventListener('click', () => {
    // The wording is the whole point of the confirm: people expect "sign out"
    // to mean "delete my stuff off this phone", and here it emphatically does
    // not. Saying so is cheaper than an undo.
    if (confirm('להתנתק מהחשבון? הנתונים יישארו במכשיר; הסנכרון ייפסק.')) deps.signOut();
  });
}

/**
 * Wire the שם לוחם editor: validate locally first (so an obviously bad name
 * never reaches the network), then let the backend have the last word on
 * uniqueness. Every outcome is one Hebrew line under the field.
 */
function bindHandleEditor(root: ParentNode, deps: AccountDeps): void {
  const input = root.querySelector<HTMLInputElement>('#ghostHandle');
  const btn = root.querySelector<HTMLButtonElement>('#btnSaveHandle');
  const msg = root.querySelector<HTMLElement>('#handleMsg');
  const save = deps.setHandle;
  if (!input || !btn || !save) return;

  btn.addEventListener('click', () => {
    const check = checkHandle(input.value);
    if (!check.ok) {
      if (msg) msg.textContent = HANDLE_ERROR_HE[check.error ?? 'empty'];
      return;
    }
    btn.disabled = true;
    if (msg) msg.textContent = 'שומר…';
    void save(check.handle).then(
      (ok) => {
        btn.disabled = false;
        if (msg) msg.textContent = ok ? `נשמר ✓ יריבים יכולים להילחם ב"${check.handle}"` : HANDLE_TAKEN_HE;
        if (ok) deps.refresh?.();
      },
      () => {
        btn.disabled = false;
        if (msg) msg.textContent = HANDLE_TAKEN_HE;
      },
    );
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
