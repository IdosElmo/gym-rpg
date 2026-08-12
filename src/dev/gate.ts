/**
 * dev/gate.ts — is the dev panel allowed to exist on this page, right now?
 *
 * ONE QUESTION, THREE ANSWERS THAT ARE ALL "NO". Signed out, signed in as
 * somebody else, or running from `file://` — in every one of those the panel is
 * ABSENT: no card in the settings screen, no `window.gymDev`, nothing in the
 * DOM to find. Not disabled, not hidden behind a password prompt. That is the
 * same rule the account card and the duel card already follow, for the same
 * reason: a feature you cannot have should not be visible at all.
 *
 * HOW IT DECIDES. The signed-in address is normalised (trim + lowercase),
 * hashed with SHA-256 through WebCrypto and compared against
 * `OWNER_EMAIL_HASHES`. The hash is the whole point — the address itself is
 * never in the committed source (this repo is public), and see `ownerHashes.ts`
 * for what that does and does not buy.
 *
 * WHY IT IS ASYNC. `crypto.subtle.digest` returns a promise and exists only in a
 * secure context, which is exactly the shape of the answer we want: outside one
 * (an insecure origin, an old WebView, the `file://` bundle) there is no hasher,
 * so the gate cannot open. The hasher is INJECTABLE so the tests can drive every
 * branch with a fake address and a fake digest, and so jsdom — which has no
 * `subtle` — is a fall-through to "closed" rather than a crash.
 */

import { OWNER_EMAIL_HASHES } from './ownerHashes.ts';

/** Hash one string to lowercase hex, or `null` when this host cannot. */
export type EmailHasher = (text: string) => Promise<string | null>;

/**
 * The canonical form of an address: trimmed, lowercased.
 *
 * The SAME normalisation produced the constants in `ownerHashes.ts`, which is
 * the only reason a comparison of digests can mean a comparison of addresses.
 * Nothing cleverer (no dots stripped, no `+tag` removed): a normalisation that
 * guesses at a provider's rules would be a rule this file cannot verify.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Lowercase hex of a byte buffer. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * THE real hasher: WebCrypto's SHA-256, or `null` where there is no `subtle`
 * (an insecure context, jsdom, an ancient WebView). A missing hasher is not an
 * error — it is a closed gate.
 */
export const sha256Hex: EmailHasher = async (text: string): Promise<string | null> => {
  const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  try {
    return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  } catch {
    return null;
  }
};

export interface DevGateInput {
  /** The signed-in address, or `null` when nobody is. */
  email: string | null | undefined;
  /**
   * The page's protocol (`location.protocol`). `file:` is refused outright:
   * that build is the one that gets handed around as a single file, and it has
   * no account behind it anyway.
   */
  protocol?: string;
  /** Injected by the tests; the app uses WebCrypto. */
  hasher?: EmailHasher;
  /** Injected by the tests; the app uses the committed constants. */
  hashes?: readonly string[];
}

/**
 * May this page have a dev panel? Resolves false for every reason, quietly.
 *
 * Never throws and never rejects: a gate that could fail loudly would be a way
 * to ask "is this the owner?" and get an answer other than silence.
 */
export async function devGateOpen(input: DevGateInput): Promise<boolean> {
  const protocol = input.protocol ?? '';
  if (protocol === 'file:') return false;

  const email = normalizeEmail(input.email);
  if (!email) return false;

  const hashes = input.hashes ?? OWNER_EMAIL_HASHES;
  if (hashes.length === 0) return false;

  const hasher = input.hasher ?? sha256Hex;
  let digest: string | null = null;
  try {
    digest = await hasher(email);
  } catch {
    return false;
  }
  if (!digest) return false;
  const hex = digest.trim().toLowerCase();
  return hashes.some((h) => h.trim().toLowerCase() === hex);
}
