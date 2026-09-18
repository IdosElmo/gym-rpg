/**
 * 📝 Per-exercise notes: the fold, the driver, the selector — and the MERGE
 * laws. A note lives in `state.exerciseNotes` beside sessions/plan (never in
 * `GameState`), so everything here goes through `rebuildFromEvents` and must
 * converge whichever order two devices' logs are merged in.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_EXERCISE_NOTE_LENGTH,
  applyExerciseNoteEvent,
  exerciseNote,
  normalizeExerciseNotes,
  normalizeNote,
  setExerciseNote,
} from '../src/core/notes.ts';
import { GAME_STATE_VERSION, type AppEvent } from '../src/storage/DataStore.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { CURRENT_STATE_VERSION, migrateState, rebuildFromEvents } from '../src/storage/migrate.ts';
import type { StorageLike } from '../src/storage/migrate.ts';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = Date.UTC(2026, 8, 18, 10, 0, 0);

function ev(id: string, ts: number, exId: string, note: string): AppEvent {
  return { id, ts, type: 'exercise_note_set', payload: { exId, note, date: '2026-09-18' } };
}

describe('normalizeNote', () => {
  it('trims, caps at the limit, and reads anything else as no note', () => {
    expect(normalizeNote('  גובה מושב 4  ')).toBe('גובה מושב 4');
    expect(normalizeNote('x'.repeat(MAX_EXERCISE_NOTE_LENGTH + 50))).toHaveLength(MAX_EXERCISE_NOTE_LENGTH);
    expect(normalizeNote(42)).toBe('');
    expect(normalizeNote(null)).toBe('');
    expect(normalizeNote(undefined)).toBe('');
  });
});

describe('applyExerciseNoteEvent — the fold', () => {
  it('sets, overwrites, and an empty note deletes the key', () => {
    const notes: Record<string, string> = {};
    applyExerciseNoteEvent(notes, 'exercise_note_set', { exId: 'a1', note: 'אחיזה רחבה' });
    expect(notes).toEqual({ a1: 'אחיזה רחבה' });
    applyExerciseNoteEvent(notes, 'exercise_note_set', { exId: 'a1', note: 'אחיזה צרה' });
    expect(notes).toEqual({ a1: 'אחיזה צרה' });
    applyExerciseNoteEvent(notes, 'exercise_note_set', { exId: 'a1', note: '   ' });
    expect(notes).toEqual({});
  });

  it('ignores malformed payloads and other event types', () => {
    const notes: Record<string, string> = { a1: 'x' };
    applyExerciseNoteEvent(notes, 'exercise_note_set', { note: 'no id' });
    applyExerciseNoteEvent(notes, 'exercise_note_set', { exId: '', note: 'blank id' });
    applyExerciseNoteEvent(notes, 'exercise_note_set', { exId: 7, note: 'numeric id' });
    applyExerciseNoteEvent(notes, 'set_logged', { exId: 'a1', note: 'wrong type' });
    expect(notes).toEqual({ a1: 'x' });
  });
});

describe('normalizeExerciseNotes', () => {
  it('routes any blob to a valid map', () => {
    expect(normalizeExerciseNotes(null)).toEqual({});
    expect(normalizeExerciseNotes([])).toEqual({});
    expect(normalizeExerciseNotes({ a1: ' ok ', a2: '', a3: 5, '': 'blank key' })).toEqual({ a1: 'ok' });
  });
});

describe('rebuildFromEvents', () => {
  it('folds notes LWW per exercise in the (ts, id) order, both merge orders alike', () => {
    const events = [
      ev('e1', 100, 'a1', 'ראשון'),
      ev('e2', 200, 'a1', 'שני'),
      ev('e3', 150, 'a2', 'אחר'),
      ev('e4', 300, 'a2', ''),
    ];
    const forward = rebuildFromEvents(events, NOW).exerciseNotes;
    const backward = rebuildFromEvents([...events].reverse(), NOW).exerciseNotes;
    expect(forward).toEqual({ a1: 'שני' });
    expect(backward).toEqual(forward);
  });

  it('same ts: the id breaks the tie, so two devices agree', () => {
    const a = ev('aaa', 100, 'a1', 'מהמכשיר a');
    const b = ev('bbb', 100, 'a1', 'מהמכשיר b');
    expect(rebuildFromEvents([a, b], NOW).exerciseNotes).toEqual({ a1: 'מהמכשיר b' });
    expect(rebuildFromEvents([b, a], NOW).exerciseNotes).toEqual({ a1: 'מהמכשיר b' });
  });

  it('data_cleared wipes the notes', () => {
    const events: AppEvent[] = [ev('e1', 100, 'a1', 'x'), { id: 'w', ts: 200, type: 'data_cleared', payload: {} }];
    expect(rebuildFromEvents(events, NOW).exerciseNotes).toEqual({});
  });
});

describe('setExerciseNote — the driver', () => {
  it('appends ONE event, mirrors it, and the live state equals a replay of the log', () => {
    const store = new LocalStore(fakeStorage());
    expect(setExerciseNote(store, 'a1', '  גובה מושב 4 ', NOW)).toBe(true);
    const notes = store.getEvents().filter((e) => e.type === 'exercise_note_set');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.payload).toEqual({ exId: 'a1', note: 'גובה מושב 4', date: '2026-09-18' });
    expect(exerciseNote(store.getState(), 'a1')).toBe('גובה מושב 4');
    expect(rebuildFromEvents(store.getEvents(), NOW).exerciseNotes).toEqual(store.getState().exerciseNotes);
  });

  it('an unchanged note appends nothing — a blur after no edit is free', () => {
    const store = new LocalStore(fakeStorage());
    setExerciseNote(store, 'a1', 'x', NOW);
    const before = store.getEvents().length;
    expect(setExerciseNote(store, 'a1', ' x ', NOW)).toBe(false);
    expect(setExerciseNote(store, 'a2', '', NOW)).toBe(false);
    expect(setExerciseNote(store, '', 'y', NOW)).toBe(false);
    expect(store.getEvents()).toHaveLength(before);
  });

  it('an empty note clears it, in the state and in a replay', () => {
    const store = new LocalStore(fakeStorage());
    setExerciseNote(store, 'a1', 'x', NOW);
    expect(setExerciseNote(store, 'a1', '', NOW)).toBe(true);
    expect(store.getState().exerciseNotes).toEqual({});
    expect(rebuildFromEvents(store.getEvents(), NOW).exerciseNotes).toEqual({});
  });

  it('never touches the game: no XP, no version bump', () => {
    const store = new LocalStore(fakeStorage());
    const game = JSON.stringify(store.getState().game);
    setExerciseNote(store, 'a1', 'x', NOW);
    expect(JSON.stringify(store.getState().game)).toBe(game);
    expect(store.getState().game?.version).toBe(GAME_STATE_VERSION);
  });

  it('a wipe drops the notes with everything else', () => {
    const store = new LocalStore(fakeStorage());
    setExerciseNote(store, 'a1', 'x', NOW);
    store.clear();
    expect(store.getState().exerciseNotes).toEqual({});
  });
});

describe('state migration', () => {
  it('a v7 state blob migrates to v8 with an empty notes map', () => {
    const v7 = {
      schemaVersion: 7,
      sessions: {},
      ui: { view: 'A', open: {} },
      game: null,
      plan: null,
      planPresets: {},
      nutrition: { meals: {}, deleted: {}, targets: {}, weights: {}, weightDeleted: {}, weightTarget: null },
      meta: { legacyImported: false, createdAt: NOW, updatedAt: NOW },
    };
    const s = migrateState(v7, NOW);
    expect(CURRENT_STATE_VERSION).toBe(8);
    expect(s.schemaVersion).toBe(8);
    expect(s.exerciseNotes).toEqual({});
    expect(s.ui.view).toBe('A');
  });

  it('a current blob keeps its notes, validated rather than trusted', () => {
    const s = migrateState({ ...migrateState({}, NOW), exerciseNotes: { a1: ' ok ', a2: 3 } }, NOW);
    expect(s.exerciseNotes).toEqual({ a1: 'ok' });
  });
});
