/**
 * Guards the "ported VERBATIM" claim: extracts the PROGRAM literal straight out
 * of legacy/index.html and deep-compares it with src/data/program.ts, ignoring
 * only the fields Phase 0 deliberately ADDED (`bodyPart` / `split`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BODY_PARTS,
  BUILTIN_PROGRAM,
  BUILTIN_WEEKDAYS,
  DAY_NAMES,
  DAY_ORDER,
  DEFAULT_WEEKLY_TARGET,
  PROGRAM,
  RESERVED_VIEW_KEYS,
  bodyPartWeights,
  dayOf,
  equipHe,
  findExercise,
  isDayKey,
  isPlanDayKey,
  programDayKeys,
  weekdayCaption,
  weekdaysCaption,
  type BodyPart,
  type BuiltInDayKey,
} from '../src/data/program.ts';
import { BALANCE } from '../src/core/balance.ts';

function legacyProgram(): Record<string, unknown> {
  const html = readFileSync(resolve(process.cwd(), 'legacy/index.html'), 'utf8');
  const start = html.indexOf('const PROGRAM = ');
  const end = html.indexOf('const DAY_ORDER', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const literal = html.slice(start + 'const PROGRAM = '.length, end).trim().replace(/;$/, '');
  return new Function(`return ${literal}`)() as Record<string, unknown>;
}

/** Strip the fields Phase 0 added so the comparison is apples-to-apples. */
function withoutAdded(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (key, value: unknown) => (key === 'bodyPart' || key === 'split' ? undefined : value)),
  ) as unknown;
}

describe('program data', () => {
  it('matches the legacy PROGRAM byte-for-byte (minus the added bodyPart fields)', () => {
    expect(withoutAdded(PROGRAM)).toEqual(legacyProgram());
  });

  it('keeps the legacy day order, names and equipment labels', () => {
    expect(DAY_ORDER).toEqual(['A', 'B', 'C']);
    expect(DAY_NAMES).toEqual({ A: 'ראשון', B: 'שלישי', C: 'חמישי' });
    expect(equipHe('Smith Machine')).toBe('סמית׳');
    expect(equipHe('Dumbbells')).toBe('משקולות');
    expect(equipHe('Bodyweight')).toBe('משקל גוף');
    expect(equipHe('Machine')).toBe('מכונה');
    expect(equipHe('Unknown')).toBe('Unknown');
  });

  it('gives every exercise a valid body part, and every part is trained', () => {
    const seen = new Set<BodyPart>();
    for (const day of DAY_ORDER) {
      for (const ex of PROGRAM[day].exercises) {
        expect(BODY_PARTS).toContain(ex.bodyPart);
        const weights = bodyPartWeights(ex);
        const sum = BODY_PARTS.reduce((acc, p) => acc + weights[p], 0);
        expect(sum).toBeCloseTo(1, 10);
        expect(weights[ex.bodyPart]).toBeGreaterThan(0);
        for (const p of BODY_PARTS) if (weights[p] > 0) seen.add(p);
      }
    }
    expect([...seen].sort()).toEqual([...BODY_PARTS].sort());
  });

  it('splits dips 70/30 between chest and arms, per the brief', () => {
    const dips = findExercise('b3');
    expect(dips?.en).toBe('Dips');
    const w = bodyPartWeights(dips!);
    expect(w.chest).toBeCloseTo(0.7, 10);
    expect(w.arms).toBeCloseTo(0.3, 10);
  });

  it('falls back to a single body part when no split is declared', () => {
    const lunges = findExercise('a3');
    expect(bodyPartWeights(lunges!).legs).toBe(1);
  });

  it('has unique exercise ids that findExercise can resolve', () => {
    const ids = DAY_ORDER.flatMap((d: BuiltInDayKey) => PROGRAM[d].exercises.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findExercise(id)?.id).toBe(id);
    expect(findExercise('nope')).toBeNull();
  });

  it('exposes the built-in program in the shape the app renders', () => {
    expect(programDayKeys(BUILTIN_PROGRAM)).toEqual(['A', 'B', 'C']);
    // the resolved days are the PROGRAM objects THEMSELVES, not copies
    for (const k of DAY_ORDER) expect(dayOf(BUILTIN_PROGRAM, k)).toBe(PROGRAM[k]);
    expect(dayOf(BUILTIN_PROGRAM, 'nope')).toBeNull();
    expect(BUILTIN_PROGRAM.days.map((d) => d.label)).toEqual(DAY_ORDER.map((k) => PROGRAM[k].label));
    expect(BUILTIN_PROGRAM.weeklyTarget).toBe(DEFAULT_WEEKLY_TARGET);
  });

  it('keeps the weekday mapping the legacy default-tab rule used', () => {
    // Sun/Mon -> A, Tue/Wed -> B, Thu/Fri/Sat -> C: every weekday claimed once.
    expect(BUILTIN_WEEKDAYS).toEqual({ A: [0, 1], B: [2, 3], C: [4, 5, 6] });
    const all = DAY_ORDER.flatMap((k) => [...BUILTIN_WEEKDAYS[k]]).sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // …and a day is NAMED after the first weekday it is trained on, which is
    // exactly what DAY_NAMES already said.
    for (const k of DAY_ORDER) expect(weekdayCaption(BUILTIN_WEEKDAYS[k], '')).toBe(DAY_NAMES[k]);
    expect(weekdaysCaption([0, 3])).toBe('ראשון · רביעי');
    expect(weekdayCaption([], 'גיבוי')).toBe('גיבוי');
  });

  it('agrees with the balance sheet on what a perfect week is', () => {
    expect(DEFAULT_WEEKLY_TARGET).toBe(BALANCE.streak.daysPerWeek);
  });

  it('accepts any plausible day key and refuses the reserved view keys', () => {
    for (const k of ['A', 'B', 'C', 'd_abc123', 'anything']) expect(isDayKey(k)).toBe(true);
    for (const k of RESERVED_VIEW_KEYS) expect(isDayKey(k)).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(7)).toBe(false);
    expect(isDayKey('x'.repeat(41))).toBe(false);
    // a key a PLAN may mint is stricter: it has to survive a data attribute
    expect(isPlanDayKey('d_abc123')).toBe(true);
    expect(isPlanDayKey('a b')).toBe(false);
    expect(isPlanDayKey('"><script>')).toBe(false);
  });
});
