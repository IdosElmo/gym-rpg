/**
 * The Gemini estimation seam — tested WITHOUT a network and WITHOUT a fetch
 * mock, per the repo's rule: the pure halves (`parseEstimate`,
 * `mapInvokeError`) are plain functions, and the edge port runs over an
 * in-memory `invoke`, exactly the sync engine's MemoryBackend move.
 */
import { describe, expect, it } from 'vitest';

import { mapInvokeError, parseEstimate } from '../src/nutrition/aiPort.ts';
import { createEdgeAiPort } from '../src/nutrition/edgePort.ts';

const GOOD = { calories: 550, protein_g: 45.4, items: ['אורז', 'חזה עוף'], confidence: 'high' };

describe('parseEstimate', () => {
  it('reads a well-formed answer, rounding the protein', () => {
    expect(parseEstimate(GOOD)).toEqual({ calories: 550, proteinG: 45, items: ['אורז', 'חזה עוף'], confidence: 'high' });
  });

  it('clamps hostile numbers and defaults a junk confidence to low', () => {
    const est = parseEstimate({ calories: 1e9, protein_g: -5, items: 'lots', confidence: 'certain!' });
    expect(est).toEqual({ calories: 10000, proteinG: 0, items: [], confidence: 'low' });
  });

  it('caps and trims the items list', () => {
    const est = parseEstimate({ ...GOOD, items: Array.from({ length: 20 }, (_, i) => `  פריט ${i}  `) });
    expect(est?.items).toHaveLength(10);
    expect(est?.items[0]).toBe('פריט 0');
  });

  it('carries a reason only when one was given, trimmed and capped', () => {
    expect(parseEstimate({ ...GOOD, confidence: 'low', reason: '  הכמות לא ברורה  ' })?.reason).toBe('הכמות לא ברורה');
    expect(parseEstimate({ ...GOOD, reason: 'א'.repeat(500) })?.reason).toHaveLength(200);
    // no reason / empty / non-string -> the key is simply absent
    expect('reason' in (parseEstimate(GOOD) ?? {})).toBe(false);
    expect('reason' in (parseEstimate({ ...GOOD, reason: '   ' }) ?? {})).toBe(false);
    expect('reason' in (parseEstimate({ ...GOOD, reason: 42 }) ?? {})).toBe(false);
  });

  it('returns null for anything that is not an estimate', () => {
    expect(parseEstimate(null)).toBeNull();
    expect(parseEstimate('550 קלוריות')).toBeNull();
    expect(parseEstimate({ calories: 'הרבה', protein_g: 4 })).toBeNull();
    expect(parseEstimate({ calories: 550 })).toBeNull();
  });
});

describe('mapInvokeError', () => {
  it('classifies every status the function can answer with', () => {
    expect(mapInvokeError(401)).toBe('signed_out');
    expect(mapInvokeError(403)).toBe('signed_out');
    expect(mapInvokeError(429)).toBe('rate_limited');
    expect(mapInvokeError(500)).toBe('http');
    expect(mapInvokeError(502)).toBe('http');
    expect(mapInvokeError(413)).toBe('http');
  });
});

describe('createEdgeAiPort', () => {
  it('short-circuits signed_out without spending a request', async () => {
    let calls = 0;
    const port = createEdgeAiPort({
      invoke: () => {
        calls += 1;
        return Promise.resolve({ ok: true, data: GOOD });
      },
      isSignedIn: () => false,
    });
    expect(port.configured()).toBe(false);
    expect(await port.estimate({ text: 'סלט' })).toEqual({ ok: false, error: 'signed_out' });
    expect(calls).toBe(0);
  });

  it('passes text and photo through and parses the answer', async () => {
    const bodies: Record<string, unknown>[] = [];
    const port = createEdgeAiPort({
      invoke: (body) => {
        bodies.push(body);
        return Promise.resolve({ ok: true, data: GOOD });
      },
      isSignedIn: () => true,
    });
    expect(port.configured()).toBe(true);
    const res = await port.estimate({ text: 'אורז עם עוף', photo: { mimeType: 'image/jpeg', base64: 'aGk=' } });
    expect(res).toEqual({ ok: true, estimate: { calories: 550, proteinG: 45, items: ['אורז', 'חזה עוף'], confidence: 'high' } });
    expect(bodies).toEqual([{ text: 'אורז עם עוף', photo: { mimeType: 'image/jpeg', base64: 'aGk=' } }]);
    // no photo -> no photo key at all (the function treats absence as text-only)
    await port.estimate({ text: 'סלט' });
    expect(bodies[1]).toEqual({ text: 'סלט' });
  });

  it('maps the failure statuses onto the error vocabulary', async () => {
    const of = async (status: number) => {
      const port = createEdgeAiPort({ invoke: () => Promise.resolve({ ok: false, status }), isSignedIn: () => true });
      const res = await port.estimate({ text: 'סלט' });
      return res.ok ? 'ok' : res.error;
    };
    expect(await of(0)).toBe('offline');
    expect(await of(401)).toBe('signed_out');
    expect(await of(429)).toBe('rate_limited');
    expect(await of(502)).toBe('http');
  });

  it('reports an unreadable answer as unparseable', async () => {
    const port = createEdgeAiPort({
      invoke: () => Promise.resolve({ ok: true, data: { unexpected: true } }),
      isSignedIn: () => true,
    });
    expect(await port.estimate({ text: 'סלט' })).toEqual({ ok: false, error: 'unparseable' });
  });
});
