/**
 * core/workout.ts must keep the legacy semantics of getSession / getSetData /
 * prevPerf / lastLoggedDate.
 */
import { describe, expect, it } from 'vitest';

import {
  doneCount,
  fmtDate,
  getSession,
  getSetData,
  isSetFilled,
  isWorkoutComplete,
  lastLoggedDate,
  prevPerf,
  todayISO,
  totalDoneSets,
} from '../src/core/workout.ts';
import { PROGRAM } from '../src/data/program.ts';
import { emptyState } from '../src/storage/migrate.ts';

const TODAY = '2025-05-10';

describe('dates', () => {
  it('formats ISO dates like the legacy app', () => {
    expect(fmtDate('2025-01-05')).toBe('05.01.2025');
    expect(todayISO(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(todayISO(new Date(2025, 11, 31))).toBe('2025-12-31');
  });
});

describe('getSession / getSetData', () => {
  it('creates on demand only when asked', () => {
    const s = emptyState(0);
    expect(getSession(s, 'A', false, TODAY)).toBeNull();
    expect(getSetData(s, 'A', 'a1', 0, false, TODAY)).toBeNull();
    expect(s.sessions[TODAY]).toBeUndefined();

    const created = getSession(s, 'A', true, TODAY);
    expect(created.day).toBe('A');
    expect(s.sessions[TODAY]).toBeDefined();
  });

  it('lets the last edited day win for the label', () => {
    const s = emptyState(0);
    getSession(s, 'A', true, TODAY);
    getSession(s, 'C', true, TODAY);
    expect(s.sessions[TODAY]?.day).toBe('C');
  });

  it('pads earlier slots with null when a later set is logged first', () => {
    const s = emptyState(0);
    const d = getSetData(s, 'A', 'a1', 2, true, TODAY);
    d!.w = '50';
    const arr = s.sessions[TODAY]?.ex['a1'];
    expect(arr).toHaveLength(3);
    expect(arr?.[0]).toBeNull();
    expect(arr?.[1]).toBeNull();
    expect(arr?.[2]).toEqual({ w: '50', r: '', done: false });
  });
});

describe('prevPerf', () => {
  it('returns the most recent session strictly before today', () => {
    const s = emptyState(0);
    s.sessions['2025-04-01'] = { day: 'A', ex: { a1: [{ w: '30', r: '10', done: true }] } };
    s.sessions['2025-05-01'] = { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } };
    s.sessions[TODAY] = { day: 'A', ex: { a1: [{ w: '45', r: '9', done: true }] } };
    expect(prevPerf(s, 'a1', TODAY)?.date).toBe('2025-05-01');
  });

  it('skips sessions where the exercise has no filled sets', () => {
    const s = emptyState(0);
    s.sessions['2025-04-01'] = { day: 'A', ex: { a1: [{ w: '30', r: '10', done: true }] } };
    s.sessions['2025-05-01'] = { day: 'A', ex: { a1: [{ w: '', r: '', done: false }, null] } };
    expect(prevPerf(s, 'a1', TODAY)?.date).toBe('2025-04-01');
    expect(prevPerf(s, 'zz', TODAY)).toBeNull();
  });

  it('counts a checked-but-blank set as filled (legacy rule)', () => {
    expect(isSetFilled({ w: '', r: '', done: true })).toBe(true);
    expect(isSetFilled({ w: '', r: '', done: false })).toBe(false);
    expect(isSetFilled(null)).toBe(false);
  });
});

describe('lastLoggedDate', () => {
  it('matches on the day letter or on any exercise of that day', () => {
    const s = emptyState(0);
    s.sessions['2025-03-01'] = { day: 'C', ex: { a1: [{ w: '1', r: '1', done: true }] } };
    s.sessions['2025-03-05'] = { day: 'B', ex: { b1: [{ w: '1', r: '1', done: true }] } };
    expect(lastLoggedDate(s, 'B')).toBe('2025-03-05');
    // day letter says C, but it holds an A exercise -> counts for A too
    expect(lastLoggedDate(s, 'A')).toBe('2025-03-01');
    expect(lastLoggedDate(s, 'C')).toBe('2025-03-01');
  });

  it('returns null when nothing was ever logged', () => {
    expect(lastLoggedDate(emptyState(0), 'A')).toBeNull();
  });
});

describe('completion helpers', () => {
  it('detects a fully completed workout day', () => {
    const s = emptyState(0);
    for (const ex of PROGRAM.B.exercises) {
      for (let i = 0; i < ex.sets; i++) {
        const d = getSetData(s, 'B', ex.id, i, true, TODAY);
        d!.done = true;
      }
    }
    expect(isWorkoutComplete(s, 'B', TODAY)).toBe(true);
    expect(doneCount(s, 'b1', TODAY)).toBe(3);
    const expected = PROGRAM.B.exercises.reduce((n, ex) => n + ex.sets, 0);
    expect(totalDoneSets(s, TODAY)).toBe(expected);

    const first = PROGRAM.B.exercises[0]!;
    getSetData(s, 'B', first.id, 0, true, TODAY)!.done = false;
    expect(isWorkoutComplete(s, 'B', TODAY)).toBe(false);
  });
});
