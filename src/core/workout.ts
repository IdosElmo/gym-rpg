/**
 * core/workout.ts — session state + previous-performance lookup.
 *
 * Semantics are 1:1 with the legacy `getSession` / `getSetData` / `prevPerf` /
 * `lastLoggedDate` helpers; the only change is that the state is passed in
 * instead of read from a module-level `DB` global.
 *
 * Mutating helpers (`create = true`) are meant to be called inside
 * `DataStore.update()` so persistence + notification happen exactly once.
 */

import { PROGRAM, type DayKey } from '../data/program.ts';
import type { AppState, Session, SetEntry } from '../storage/DataStore.ts';

export function todayISO(d: Date = new Date()): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** "2025-03-07" -> "07.03.2025" (legacy `fmtDate`). */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export const EMPTY_SET: Readonly<SetEntry> = { w: '', r: '', done: false };

/** A set counts as "logged" if it has a weight, reps, or is checked. */
export function isSetFilled(s: SetEntry | null | undefined): boolean {
  return !!s && (s.w !== '' || s.r !== '' || s.done);
}

export function getSession(state: AppState, dayKey: DayKey, create: false, date?: string): Session | null;
export function getSession(state: AppState, dayKey: DayKey, create: true, date?: string): Session;
export function getSession(
  state: AppState,
  dayKey: DayKey,
  create: boolean,
  date: string = todayISO(),
): Session | null {
  let s = state.sessions[date];
  if (!s && create) {
    s = { day: dayKey, ex: {} };
    state.sessions[date] = s;
  }
  // last edited day wins for the label (legacy behaviour)
  if (s && create && s.day !== dayKey) s.day = dayKey;
  return s ?? null;
}

export function getSetData(
  state: AppState,
  dayKey: DayKey,
  exId: string,
  i: number,
  create: boolean,
  date: string = todayISO(),
): SetEntry | null {
  const s = create
    ? getSession(state, dayKey, true, date)
    : getSession(state, dayKey, false, date);
  if (!s) return null;
  let arr = s.ex[exId];
  if (!arr) {
    if (!create) return null;
    arr = [];
    s.ex[exId] = arr;
  }
  let entry = arr[i];
  if (!entry) {
    if (!create) return null;
    while (arr.length < i) arr.push(null);
    entry = { w: '', r: '', done: false };
    arr[i] = entry;
  }
  return entry;
}

export interface PrevPerf {
  date: string;
  sets: (SetEntry | null)[];
}

/** Most recent performance of an exercise strictly BEFORE `today`. */
export function prevPerf(state: AppState, exId: string, today: string = todayISO()): PrevPerf | null {
  const dates = Object.keys(state.sessions)
    .filter((d) => d < today)
    .sort()
    .reverse();
  for (const d of dates) {
    const session = state.sessions[d];
    const ex = session?.ex[exId];
    if (ex && ex.some((s) => isSetFilled(s))) return { date: d, sets: ex };
  }
  return null;
}

/** Latest date that looks like a log of `dayKey` (legacy `lastLoggedDate`). */
export function lastLoggedDate(state: AppState, dayKey: DayKey): string | null {
  const dates = Object.keys(state.sessions).sort().reverse();
  for (const d of dates) {
    const s = state.sessions[d];
    if (!s) continue;
    if (s.day === dayKey || PROGRAM[dayKey].exercises.some((e) => s.ex[e.id])) return d;
  }
  return null;
}

/** How many sets of `exId` are checked in today's session. */
export function doneCount(state: AppState, exId: string, date: string = todayISO()): number {
  const arr = state.sessions[date]?.ex[exId];
  if (!arr) return 0;
  return arr.filter((s) => !!s && s.done).length;
}

/** True when every set of every exercise of the day is checked. */
export function isWorkoutComplete(state: AppState, dayKey: DayKey, date: string = todayISO()): boolean {
  return PROGRAM[dayKey].exercises.every((ex) => doneCount(state, ex.id, date) >= ex.sets);
}

/** Total number of checked sets in a session (used by Phase 1 for XP/energy). */
export function totalDoneSets(state: AppState, date: string = todayISO()): number {
  const s = state.sessions[date];
  if (!s) return 0;
  let n = 0;
  for (const exId of Object.keys(s.ex)) {
    const arr = s.ex[exId];
    if (!arr) continue;
    for (const set of arr) if (set?.done) n += 1;
  }
  return n;
}
