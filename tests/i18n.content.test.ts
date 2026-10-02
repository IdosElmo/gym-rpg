/**
 * The English overlay of the built-in program (`i18n/content/program.en.ts`):
 * every built-in exercise is covered field by field, step counts match the
 * Hebrew coaching copy, no Hebrew leaks into the English, every muscle string
 * the program (or the custom-exercise picker) can produce has a word-level
 * entry, and the accessors switch between the overlay and the original with
 * the locale.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  BODY_PART_HE,
  PROGRAM,
  builtInExercises,
  type BuiltInDayKey,
} from '../src/data/program.ts';
import {
  exCue,
  exLoadLabel,
  exLoadUnit,
  exMistake,
  exMuscle,
  exName,
  exSteps,
  exSubName,
  localizeDay,
} from '../src/i18n/content.ts';
import { DAY_EN, EXERCISE_EN, MUSCLE_EN } from '../src/i18n/content/program.en.ts';
import { setLocale } from '../src/i18n/locale.ts';

const HEBREW = /[֐-׿]/;
const BUILT_INS = builtInExercises();
const DAY_KEYS: readonly BuiltInDayKey[] = ['A', 'B', 'C'];

/** Every string value inside a (possibly nested) object. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

afterEach(() => {
  setLocale('he');
});

describe('EXERCISE_EN coverage', () => {
  it('lists the 53 built-in exercises', () => {
    expect(BUILT_INS.length).toBe(53);
  });

  it.each(BUILT_INS.map((ex) => [ex.id, ex] as const))('%s has every field, step for step', (_id, ex) => {
    const c = EXERCISE_EN[ex.id];
    expect(c, ex.id).toBeDefined();
    if (!c) return;
    expect(c.name?.trim()).toBeTruthy();
    expect(c.muscle?.trim()).toBeTruthy();
    expect(c.cue?.trim()).toBeTruthy();
    expect(c.mistake?.trim()).toBeTruthy();
    expect(c.steps?.length).toBe(ex.steps.length);
    for (const s of c.steps ?? []) expect(s.trim()).not.toBe('');
    if (ex.mistake.startsWith('טעות נפוצה:')) expect(c.mistake).toMatch(/^Common mistake: /);
    if (ex.cardio) expect(c.loadLabel?.trim()).toBeTruthy();
    else {
      expect(c.loadLabel).toBeUndefined();
      expect(c.loadUnit).toBeUndefined();
    }
  });

  it('a cardio unit that is a Hebrew word has an English unit; a symbol needs none', () => {
    for (const ex of BUILT_INS) {
      if (!ex.cardio) continue;
      if (HEBREW.test(ex.cardio.loadUnit)) expect(EXERCISE_EN[ex.id]?.loadUnit, ex.id).toBeTruthy();
    }
  });

  it('has no id that is not a built-in exercise', () => {
    const ids = new Set(BUILT_INS.map((e) => e.id));
    expect(Object.keys(EXERCISE_EN).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('carries no Hebrew letters', () => {
    const leaks = Object.entries(EXERCISE_EN).flatMap(([id, c]) =>
      strings(c).filter((s) => HEBREW.test(s)).map((s) => `${id}: ${s}`),
    );
    expect(leaks).toEqual([]);
  });
});

describe('DAY_EN', () => {
  it('covers the built-in days with English header lines', () => {
    for (const key of DAY_KEYS) {
      const c = DAY_EN[key];
      expect(c, key).toBeDefined();
      expect(c?.day?.trim()).toBeTruthy();
      expect(c?.label?.trim()).toBeTruthy();
      expect(c?.dur?.trim()).toBeTruthy();
      expect(c?.focus?.trim()).toBeTruthy();
      // Same number of "·"-separated focus items as the Hebrew.
      expect(c?.focus?.split('·').length).toBe(PROGRAM[key].focus.split('·').length);
    }
    expect(strings(DAY_EN).filter((s) => HEBREW.test(s))).toEqual([]);
  });
});

describe('MUSCLE_EN', () => {
  it('has an entry for every muscle string in the program and the custom-exercise picker', () => {
    const needed = new Set([...BUILT_INS.map((e) => e.muscle), ...Object.values(BODY_PART_HE)]);
    expect([...needed].filter((m) => !MUSCLE_EN[m])).toEqual([]);
  });

  it('values are English', () => {
    expect(Object.values(MUSCLE_EN).filter((s) => HEBREW.test(s) || s.trim() === '')).toEqual([]);
  });

  it('agrees with each exercise\'s own muscle line', () => {
    for (const ex of BUILT_INS) expect(EXERCISE_EN[ex.id]?.muscle, ex.id).toBe(MUSCLE_EN[ex.muscle]);
  });
});

describe('accessors follow the locale', () => {
  it('English reads the overlay', () => {
    setLocale('en');
    for (const ex of BUILT_INS) {
      const c = EXERCISE_EN[ex.id];
      expect(exName(ex)).toBe(c?.name);
      expect(exSubName(ex)).toBe('');
      expect(exMuscle(ex)).toBe(c?.muscle);
      expect(exSteps(ex)).toEqual(c?.steps);
      expect(exCue(ex)).toBe(c?.cue);
      expect(exMistake(ex)).toBe(c?.mistake);
      if (ex.cardio) {
        expect(exLoadLabel(ex)).toBe(c?.loadLabel);
        expect(exLoadUnit(ex)).toBe(c?.loadUnit ?? ex.cardio.loadUnit);
      } else {
        expect(exLoadLabel(ex)).toBe('');
        expect(exLoadUnit(ex)).toBe('');
      }
    }
    for (const key of DAY_KEYS) {
      const d = localizeDay(key, PROGRAM[key]);
      expect(d.label).toBe(DAY_EN[key]?.label);
      expect(d.focus).toBe(DAY_EN[key]?.focus);
      expect(d.exercises).toBe(PROGRAM[key].exercises);
    }
  });

  it('Hebrew reads the original, untouched', () => {
    setLocale('he');
    for (const ex of BUILT_INS) {
      expect(exName(ex)).toBe(ex.he);
      expect(exSubName(ex)).toBe(ex.en);
      expect(exMuscle(ex)).toBe(ex.muscle);
      expect(exSteps(ex)).toBe(ex.steps);
      expect(exCue(ex)).toBe(ex.cue);
      expect(exMistake(ex)).toBe(ex.mistake);
      expect(exLoadLabel(ex)).toBe(ex.cardio?.loadLabel ?? '');
      expect(exLoadUnit(ex)).toBe(ex.cardio?.loadUnit ?? '');
    }
    for (const key of DAY_KEYS) expect(localizeDay(key, PROGRAM[key])).toBe(PROGRAM[key]);
  });
});
