/**
 * The ✨ estimator allowlist: digests only, the owner is on it, a stranger is
 * not, and the port hides the button for anybody off the list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AI_EMAIL_HASHES, aiAccessOpen } from '../src/nutrition/aiAccess.ts';
import { OWNER_EMAIL_HASHES } from '../src/dev/ownerHashes.ts';
import { createEdgeAiPort } from '../src/nutrition/edgePort.ts';

const fakeHash = (map: Record<string, string>) => async (t: string) => map[t] ?? 'f'.repeat(64);

describe('the ✨ allowlist', () => {
  it('holds 64-char lowercase hex digests only — never an address', () => {
    for (const h of AI_EMAIL_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    const src = readFileSync(resolve(process.cwd(), 'src/nutrition/aiAccess.ts'), 'utf8');
    expect(src).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });

  it('includes the owner', () => {
    for (const h of OWNER_EMAIL_HASHES) expect(AI_EMAIL_HASHES).toContain(h);
  });

  it('opens for a listed account, stays shut for a stranger, signed out and file://', async () => {
    const hashes = ['a'.repeat(64)];
    const hasher = fakeHash({ 'me@x.io': 'a'.repeat(64) });
    expect(await aiAccessOpen({ email: ' Me@X.io ', hasher, hashes })).toBe(true);
    expect(await aiAccessOpen({ email: 'stranger@x.io', hasher, hashes })).toBe(false);
    expect(await aiAccessOpen({ email: null, hasher, hashes })).toBe(false);
    expect(await aiAccessOpen({ email: 'me@x.io', protocol: 'file:', hasher, hashes })).toBe(false);
  });

  it('the port is unconfigured, and refuses locally, for an account off the list', async () => {
    let calls = 0;
    const port = createEdgeAiPort({
      invoke: async () => {
        calls++;
        return { ok: true, data: {} };
      },
      isSignedIn: () => true,
      isAllowed: () => false,
    });
    expect(port.configured()).toBe(false);
    expect(await port.estimate({ text: 'שקשוקה' })).toEqual({ ok: false, error: 'signed_out' });
    expect(calls).toBe(0);
  });

  it('the server function verifies the caller and fails closed without the secret', () => {
    const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/estimate-meal/index.ts'), 'utf8');
    expect(fn).toContain('/auth/v1/user');
    expect(fn).toContain('AI_ALLOWED_EMAIL_HASHES');
    expect(fn).toMatch(/if \(list\.length === 0\) return false;/);
  });
});
