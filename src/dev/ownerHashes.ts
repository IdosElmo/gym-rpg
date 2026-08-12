/**
 * dev/ownerHashes.ts — WHO may open the dev panel.
 *
 * THIS REPOSITORY IS PUBLIC, so the answer is not written down here. What is
 * written down is a SHA-256 digest of the address, in lowercase hex: the app
 * hashes the address of whoever is signed in and compares. A digest tells a
 * reader nothing except "this is 32 bytes"; it cannot be turned back into an
 * address, and it is not an email harvester's dinner.
 *
 * It is deliberately NOT a secret and does not pretend to be one. Anyone can
 * read this file, and anyone who already knows the address can confirm it is
 * this one. What the digest actually buys is that the address is not PUBLISHED —
 * not scraped out of a public repo, not sitting in a bundle that is handed
 * around as a single file. The gate itself is not a security boundary either:
 * everything the panel does is a normal event on the user's OWN save, so the
 * worst case of a defeated gate is that somebody hands themselves coins in their
 * own game. Real permissions live in the database (`supabase/schema.sql`), where
 * every policy is scoped to `auth.uid()` and none of them has ever heard of this
 * file.
 *
 * TO ADD SOMEBODY (or to move the panel to another account):
 *
 *     node -e "console.log(require('crypto').createHash('sha256')
 *       .update('THE.ADDRESS@example.com'.trim().toLowerCase(),'utf8')
 *       .digest('hex'))"
 *
 * and paste the 64 hex characters below. Normalisation (trim + lowercase) must
 * match `normalizeEmail` in `gate.ts` — it does, and a test pins both.
 *
 * INVARIANT, enforced by `tests/dev.test.ts`: this file contains 64-character
 * lowercase hex strings and no address, ever.
 */
export const OWNER_EMAIL_HASHES: readonly string[] = [
  'f2cabeb2c0ad4150f3e5e713e00a1cb57341820dbddc0004c0de73bb42421a60',
];
