/**
 * core/handle.ts — the שם לוחם: an account's public name, and the ledger key it
 * forms.
 *
 * A LEAF module on purpose (it imports nothing): both `core/ghost.ts`, which
 * builds and reads ghost snapshots, and `core/xp.ts`, whose reducer keys the
 * duel ledger by `(date, opponent)`, need these rules, and neither may end up
 * importing the other.
 *
 * WHY A HANDLE AT ALL. A ghost duel needs a way to say "fight THAT character"
 * out loud, in a household, without exchanging email addresses or user ids. The
 * handle is that: short, typed by a human, and the only thing about an account
 * that another account can look up.
 *
 * CANONICAL FORM. Lookup is an exact match in the database, so publishing and
 * looking up must agree byte for byte on what a typed name means:
 * `normalizeHandle` trims, collapses inner whitespace and lower-cases Latin
 * letters — and every path (publish, fetch, ledger key, seed) goes through it.
 */

/** Shortest / longest a handle may be, in characters, after normalisation. */
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/**
 * The characters a handle may contain: Hebrew letters, Latin letters, digits
 * and three quiet separators.
 *
 * Deliberately narrow. The other player types this by hand from a screenshot or
 * across a kitchen table, so anything easy to get subtly wrong — look-alike
 * punctuation, emoji, invisible direction marks — is simply not part of a name.
 */
const HANDLE_CHARS = /^[א-ת A-Za-z0-9_.-]+$/;

/** Trim, collapse inner whitespace, lower-case Latin, cap the length. */
export function normalizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, HANDLE_MAX);
}

/** Why a handle was refused — the settings card turns this into Hebrew. */
export type HandleError = 'empty' | 'too_short' | 'too_long' | 'bad_chars';

export interface HandleCheck {
  ok: boolean;
  /** The canonical form (what would be published), even when it is refused. */
  handle: string;
  error?: HandleError;
}

/** Validate a typed handle. PURE — it decides, it does not store. */
export function checkHandle(raw: unknown): HandleCheck {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) return { ok: false, handle: '', error: 'empty' };
  if (trimmed.length > HANDLE_MAX) return { ok: false, handle: normalizeHandle(trimmed), error: 'too_long' };
  if (trimmed.length < HANDLE_MIN) return { ok: false, handle: normalizeHandle(trimmed), error: 'too_short' };
  if (!HANDLE_CHARS.test(trimmed)) return { ok: false, handle: normalizeHandle(trimmed), error: 'bad_chars' };
  return { ok: true, handle: normalizeHandle(trimmed) };
}

/**
 * A handle to start from, derived from the account.
 *
 * The email's LOCAL PART when it survives the character rules (that is the name
 * a household already calls each other by), and `לוחם-<short id>` otherwise. The
 * address itself never appears: only the part before the `@`, stripped of
 * everything a handle may not contain — and the user can rename it anyway.
 */
export function defaultHandle(email: string | null | undefined, userId = ''): string {
  const local = typeof email === 'string' ? (email.split('@')[0] ?? '') : '';
  const cleaned = normalizeHandle(local.replace(/[^א-תA-Za-z0-9_.-]/g, ''));
  if (checkHandle(cleaned).ok) return cleaned;
  const short = userId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toLowerCase();
  return normalizeHandle(`לוחם-${short || '000000'}`);
}

/**
 * THE ledger key of one duel: the date and the opponent, nothing else.
 *
 * One duel per opponent per day — the same idiom as the daily challenge's date
 * key, one field wider. Because it is derived from the payload (never carried in
 * it), two devices that both fought the same opponent on the same day converge
 * on one record whichever order the events merge in.
 */
export function duelKey(date: string, opponentHandle: string): string {
  return `${date}|${normalizeHandle(opponentHandle)}`;
}
