/**
 * core/notes.ts — 📝 per-exercise notes: the fold, the driver, the selector.
 *
 * DESIGN — a memo on the exercise, not on the session
 * ----------------------------------------------------
 * A note belongs to an EXERCISE ("seat height 4", "wide grip", "start lighter
 * than it feels") and follows it from workout to workout: the card shows the
 * same text next week, edited in place. That is what a note on a card is for —
 * the numbers of a session already live in its rows.
 *
 * Notes grant NOTHING: no XP, no energy, no coins. `applyGameEvent` never sees
 * `exercise_note_set` (unknown types fall to its `default:`), so the notes live
 * beside `sessions` and `plan` on `AppState`, not inside `GameState` — and
 * `GAME_STATE_VERSION` does not move for them.
 *
 * Like `plan`, `state.exerciseNotes` is a CACHE of the log. The ONE fold below
 * (`applyExerciseNoteEvent`) is shared by the live write path (append then
 * mirror, the same trick `savePlan` uses) and by `rebuildFromEvents`, which is
 * what makes replay provably equivalent to live state.
 *
 * MERGE SEMANTICS (order-free under the `(ts, id)` total order):
 *   exercise_note_set -> the whole note travels in the payload, last writer
 *                        wins per exercise id — byte-for-byte the
 *                        `plan_updated` rule. An EMPTY note deletes the key, so
 *                        "cleared" and "never written" are the same state and
 *                        two devices that merge cannot disagree on a blank.
 *   data_cleared      -> resets the map (handled by the caller's switch, like
 *                        `sessions`/`plan`).
 */

import type { AppState, DataStore, EventType } from '../storage/DataStore.ts';
import { todayISO } from './workout.ts';

/** The longest note a card keeps — a memo, not a training diary. */
export const MAX_EXERCISE_NOTE_LENGTH = 500;

export interface ExerciseNoteSetPayload extends Record<string, unknown> {
  exId: string;
  /** The whole note; `''` clears it. */
  note: string;
  /** ISO date of the edit (bookkeeping only — the order is `(ts, id)`). */
  date: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The note a payload (or a blob) actually carries: a string, trimmed at the
 * ends, capped at the limit. Anything else reads as "no note".
 */
export function normalizeNote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_EXERCISE_NOTE_LENGTH);
}

/**
 * THE fold of the notes — shared verbatim by the live write path and by
 * `rebuildFromEvents`, the same contract `applyPlanPresetEvent` keeps.
 *
 * LWW per exercise id under the caller's `(ts, id)` order; an empty note
 * removes the key; anything malformed folds to nothing.
 */
export function applyExerciseNoteEvent(
  notes: Record<string, string>,
  type: EventType,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (type !== 'exercise_note_set') return;
  const exId = payload['exId'];
  if (typeof exId !== 'string' || exId === '') return;
  const note = normalizeNote(payload['note']);
  if (note === '') delete notes[exId];
  else notes[exId] = note;
}

/** Route ANY persisted notes blob to a valid map. Never throws. */
export function normalizeExerciseNotes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const key of Object.keys(raw)) {
    if (key === '') continue;
    const note = normalizeNote(raw[key]);
    if (note !== '') out[key] = note;
  }
  return out;
}

/** The note of one exercise, `''` when there is none. */
export function exerciseNote(state: AppState, exId: string): string {
  return state.exerciseNotes[exId] ?? '';
}

/**
 * Write one exercise's note: append exactly ONE `exercise_note_set` event and
 * mirror it into `state.exerciseNotes` — append before mirror, the `savePlan`
 * contract, so "live state === rebuildFromEvents(log)" survives a crash between
 * the two writes.
 *
 * Returns false (and appends nothing) when the normalized note already equals
 * what the state holds — a blur after no edit must not write a second event.
 */
export function setExerciseNote(store: DataStore, exId: string, note: string, now: number = Date.now()): boolean {
  if (exId === '') return false;
  const next = normalizeNote(note);
  if (next === exerciseNote(store.getState(), exId)) return false;
  const payload: ExerciseNoteSetPayload = { exId, note: next, date: todayISO(new Date(now)) };
  store.append('exercise_note_set', payload);
  store.update((draft) => {
    applyExerciseNoteEvent(draft.exerciseNotes, 'exercise_note_set', payload);
  });
  return true;
}
