/**
 * nutrition/aiAccess.ts — WHO gets the ✨ meal estimator.
 *
 * The estimator spends a paid Gemini key that belongs to the app's owner. Until
 * there is a subscription to pay for it, it is a perk of an ALLOWLIST: the same
 * email-digest mechanism as the 🛠 dev panel (`dev/gate.ts`, see
 * `dev/ownerHashes.ts` for why a digest and never an address), with a list of
 * its own. Everybody else simply has no ✨ button — manual logging and the
 * catalog work exactly the same.
 *
 * This is the app half. The server half is the real boundary:
 * `supabase/functions/estimate-meal` verifies the caller with Supabase Auth and
 * checks the same digests (its `AI_ALLOWED_EMAIL_HASHES` secret), so a stranger
 * who flips this check in their own copy of the page still gets a 403.
 *
 * TO ADD SOMEBODY: compute the digest (command in `dev/ownerHashes.ts`), add it
 * below AND to the function's `AI_ALLOWED_EMAIL_HASHES` secret.
 * INVARIANT (tests/aiAccess.test.ts): 64-char lowercase hex only, no address.
 */

import { devGateOpen, type EmailHasher } from '../dev/gate.ts';
import { OWNER_EMAIL_HASHES } from '../dev/ownerHashes.ts';

export const AI_EMAIL_HASHES: readonly string[] = [...OWNER_EMAIL_HASHES];

/** May this signed-in account use the ✨ estimator? Quietly false for every reason. */
export function aiAccessOpen(input: {
  email: string | null | undefined;
  protocol?: string;
  hasher?: EmailHasher;
  hashes?: readonly string[];
}): Promise<boolean> {
  return devGateOpen({ ...input, hashes: input.hashes ?? AI_EMAIL_HASHES });
}
