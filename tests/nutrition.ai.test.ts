/**
 * The Gemini estimation seam — tested WITHOUT a network and WITHOUT a fetch
 * mock, per the repo's rule: the pure halves (`parseEstimate`,
 * `mapInvokeError`) are plain functions, and the edge port runs over an
 * in-memory `invoke`, exactly the sync engine's MemoryBackend move.
 */
import { describe, expect, it } from 'vitest';

import { capConfidence, mapInvokeError, parseEstimate, totalsOf, type EstimateItem } from '../src/nutrition/aiPort.ts';
import { createEdgeAiPort } from '../src/nutrition/edgePort.ts';

const GOOD = { calories: 550, protein_g: 45.4, items: ['אורז', 'חזה עוף'], confidence: 'high' };

/** A name-only line, as parsed from an older function build. */
const named = (name: string): EstimateItem => ({ name, quantity: '', grams: null, kcal: null, proteinG: null, assumed: false });
/** What the itemized function returns for one line. */
const line = (name: string, quantity: string, grams: number, kcal: number, protein_g: number, assumed = false) => ({
  name,
  quantity,
  grams,
  kcal,
  protein_g,
  assumed,
});

const ITEMIZED = {
  calories: 999, // deliberately WRONG: the client must trust the breakdown, not this
  protein_g: 999,
  items: [line('דף אורז', '4 דפים', 36, 119, 1), line('ביצה', '2 יחידות', 110, 157, 14), line('אבוקדו', 'חצי קטן', 60, 96, 1)],
  confidence: 'high',
  reason: '',
};

describe('parseEstimate — the legacy name-only answer', () => {
  it('reads it, rounding the protein and lifting names into number-less lines', () => {
    expect(parseEstimate(GOOD)).toEqual({
      calories: 550,
      proteinG: 45,
      items: [named('אורז'), named('חזה עוף')],
      confidence: 'high',
    });
  });

  it('clamps hostile numbers and defaults a junk confidence to low', () => {
    const est = parseEstimate({ calories: 1e9, protein_g: -5, items: 'lots', confidence: 'certain!' });
    expect(est).toEqual({ calories: 10000, proteinG: 0, items: [], confidence: 'low' });
  });

  it('caps and trims the items list', () => {
    const est = parseEstimate({ ...GOOD, items: Array.from({ length: 30 }, (_, i) => `  פריט ${i}  `) });
    expect(est?.items).toHaveLength(20);
    expect(est?.items[0]?.name).toBe('פריט 0');
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

describe('parseEstimate — the itemized answer', () => {
  it('sums the breakdown itself and ignores the server totals', () => {
    const est = parseEstimate(ITEMIZED);
    expect(est?.calories).toBe(119 + 157 + 96);
    expect(est?.proteinG).toBe(1 + 14 + 1);
    expect(est?.items[0]).toEqual({ name: 'דף אורז', quantity: '4 דפים', grams: 36, kcal: 119, proteinG: 1, assumed: false });
    expect(est?.confidence).toBe('high');
  });

  it('accepts a breakdown even when the server totals are missing', () => {
    const { calories: _c, protein_g: _p, ...noTotals } = ITEMIZED;
    expect(parseEstimate(noTotals)?.calories).toBe(372);
  });

  it('falls back to the server totals when a line has no numbers', () => {
    const est = parseEstimate({ ...ITEMIZED, calories: 500, protein_g: 40, items: [...ITEMIZED.items, 'מלח'] });
    expect(est?.calories).toBe(500);
    expect(est?.items).toHaveLength(4);
    expect(est?.items[3]).toEqual(named('מלח'));
  });

  it('clamps each line and drops nameless ones', () => {
    const est = parseEstimate({
      ...ITEMIZED,
      items: [line('שמן', 'הרבה', 1e9, -4, 5), { grams: 10, kcal: 10, protein_g: 1 }, 7],
    });
    expect(est?.items).toHaveLength(1);
    expect(est?.items[0]).toEqual({ name: 'שמן', quantity: 'הרבה', grams: 2000, kcal: 0, proteinG: 5, assumed: false });
  });

  it('caps the confidence by the assumed lines whatever the model claimed', () => {
    const one = parseEstimate({ ...ITEMIZED, items: [ITEMIZED.items[0], ITEMIZED.items[1], line('סלט', 'קערה', 150, 33, 2, true)] });
    expect(one?.confidence).toBe('medium');
    const half = parseEstimate({ ...ITEMIZED, items: [ITEMIZED.items[0], line('סלט', 'קערה', 150, 33, 2, true)] });
    expect(half?.confidence).toBe('low');
    const weightless = parseEstimate({ ...ITEMIZED, items: [ITEMIZED.items[0], line('רוטב', '', 0, 0, 0)] });
    expect(weightless?.confidence).toBe('low');
    // …and the model's own word can still lower it
    expect(parseEstimate({ ...ITEMIZED, confidence: 'low' })?.confidence).toBe('low');
  });
});

describe('totalsOf / capConfidence', () => {
  it('totalsOf is null for an empty or partly priced breakdown', () => {
    expect(totalsOf([])).toBeNull();
    expect(totalsOf([named('x')])).toBeNull();
    expect(totalsOf([{ ...named('x'), kcal: 5, proteinG: 1 }, named('y')])).toBeNull();
    expect(totalsOf([{ ...named('x'), kcal: 5, proteinG: 1 }, { ...named('y'), kcal: 7, proteinG: 2 }])).toEqual({
      calories: 12,
      proteinG: 3,
    });
  });

  it('capConfidence leaves a name-only breakdown to the model', () => {
    expect(capConfidence([named('x'), named('y')], 'high')).toBe('high');
    expect(capConfidence([], 'medium')).toBe('medium');
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
    expect(res).toEqual({ ok: true, estimate: { calories: 550, proteinG: 45, items: [named('אורז'), named('חזה עוף')], confidence: 'high' } });
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
