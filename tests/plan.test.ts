/**
 * plan.test.ts — the headless plan model.
 *
 * The properties that matter, in order of importance:
 *
 *   1. ZERO CHANGE until a plan exists. `resolveProgram(null)` must hand back
 *      the built-in PROGRAM object ITSELF, and a saved-but-unmodified plan must
 *      still resolve to the very same `Day` objects.
 *   2. RESOLUTION. Rows override sets/reps/rest of built-ins, custom exercises
 *      resolve to real `Exercise`s (with no coaching copy), unknown ids vanish.
 *   3. XP. A custom exercise with a secondary body part splits its XP 70/30
 *      through the same `bodyPartWeights` the built-ins use — including for
 *      RETROACTIVE grants, which is the only path that needs a resolver.
 *   4. THE FOLD. `plan_updated` is last-writer-wins in the `(ts, id)` total
 *      order, `data_cleared` resets to the built-in program, and the fold is a
 *      function of the event SET (shuffling the log changes nothing).
 *   5. TOLERANCE. Old blobs, future blobs and corrupt blobs all resolve to
 *      something usable rather than to a broken workout screen.
 */
import { describe, expect, it } from 'vitest';

import {
  DAY_ORDER,
  PROGRAM,
  bodyPartWeights,
  findExercise,
  type DayKey,
} from '../src/data/program.ts';
import type { CustomExercise, PlanDoc } from '../src/data/planTypes.ts';
import {
  clonePlanDoc,
  customToExercise,
  defaultPlanDoc,
  isDefaultPlan,
  libraryExercises,
  makeResolver,
  newCustomId,
  normalizePlanDoc,
  planFromEvents,
  planIsDirty,
  planToRecord,
  resolveProgram,
  savePlan,
  validatePlanDoc,
} from '../src/core/plan.ts';
import { buildRetroactiveGrants } from '../src/core/xp.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, Session } from '../src/storage/DataStore.ts';
import {
  CURRENT_STATE_VERSION,
  STATE_KEY,
  migrateState,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

/* --------------------------------------------------------------- fixtures */

function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const CUSTOM: CustomExercise = {
  id: 'cx_test000001',
  he: 'משיכת פנים בכבל',
  en: 'Face Pull',
  bodyPart: 'shoulders',
  split: { shoulders: 0.7, back: 0.3 },
  unit: 'חזרות',
  equip: ['Machine'],
  muscle: 'כתף אחורית',
};

/** A plan that edits day A: a3 removed, a1 re-numbered, one custom appended. */
function editedPlan(): PlanDoc {
  const doc = defaultPlanDoc();
  const a = doc.days.A;
  a.exercises = a.exercises.filter((r) => r.id !== 'a3');
  const first = a.exercises[0];
  if (!first) throw new Error('no rows');
  first.sets = 5;
  first.reps = '6–8';
  first.rest = 120;
  doc.customExercises.push({ ...CUSTOM, split: { ...CUSTOM.split } });
  a.exercises.push({ id: CUSTOM.id, sets: 3, reps: '12–15', rest: 45 });
  return doc;
}

function eventOf(type: AppEvent['type'], ts: number, id: string, payload: Record<string, unknown>): AppEvent {
  return { id, ts, type, payload };
}

/* ---------------------------------------------------------------- default */

describe('defaultPlanDoc', () => {
  it('mirrors PROGRAM exactly — same days, ids, order, sets, reps and rest', () => {
    const doc = defaultPlanDoc();
    expect(doc.version).toBe(1);
    expect(doc.rev).toBe(0);
    expect(doc.customExercises).toEqual([]);
    for (const k of DAY_ORDER) {
      expect(doc.days[k].exercises).toEqual(
        PROGRAM[k].exercises.map((ex) => ({ id: ex.id, sets: ex.sets, reps: ex.reps, rest: ex.rest })),
      );
    }
  });

  it('counts as "the built-in program" and is never dirty against itself', () => {
    expect(isDefaultPlan(null)).toBe(true);
    expect(isDefaultPlan(defaultPlanDoc())).toBe(true);
    expect(planIsDirty(defaultPlanDoc(), null)).toBe(false);
    expect(planIsDirty(editedPlan(), null)).toBe(true);
  });

  it('clones deeply — mutating a clone never touches the original', () => {
    const a = defaultPlanDoc();
    const b = clonePlanDoc(a);
    const row = b.days.A.exercises[0];
    if (!row) throw new Error('no rows');
    row.sets = 9;
    expect(a.days.A.exercises[0]?.sets).not.toBe(9);
  });
});

/* -------------------------------------------------------------- resolution */

describe('resolveProgram', () => {
  it('returns the built-in PROGRAM object REFERENCE-identically for null', () => {
    // The zero-behaviour-change guarantee of the whole feature.
    expect(resolveProgram(null)).toBe(PROGRAM);
  });

  it('returns the built-in Day objects for a plan that changed nothing', () => {
    const resolved = resolveProgram(defaultPlanDoc());
    for (const k of DAY_ORDER) expect(resolved[k]).toBe(PROGRAM[k]);
  });

  it('overrides sets / reps / rest of a built-in exercise but keeps its copy', () => {
    const resolved = resolveProgram(editedPlan());
    const first = resolved.A.exercises[0];
    const builtin = PROGRAM.A.exercises[0];
    if (!first || !builtin) throw new Error('missing exercise');
    expect(first.id).toBe(builtin.id);
    expect(first.sets).toBe(5);
    expect(first.reps).toBe('6–8');
    expect(first.rest).toBe(120);
    // coaching copy still comes from the CODE, not from the saved document
    expect(first.steps).toEqual(builtin.steps);
    expect(first.cue).toBe(builtin.cue);
    expect(first.bodyPart).toBe(builtin.bodyPart);
  });

  it('drops a removed exercise and appends the custom one, with empty copy', () => {
    const resolved = resolveProgram(editedPlan());
    expect(resolved.A.exercises.map((e) => e.id)).not.toContain('a3');
    const custom = resolved.A.exercises.at(-1);
    if (!custom) throw new Error('no custom');
    expect(custom.id).toBe(CUSTOM.id);
    expect(custom.he).toBe(CUSTOM.he);
    expect(custom.sets).toBe(3);
    expect(custom.rest).toBe(45);
    // no steps / cue / mistake — the workout screen hides the panel for these
    expect(custom.steps).toEqual([]);
    expect(custom.cue).toBe('');
    expect(custom.mistake).toBe('');
  });

  it('skips rows whose id resolves to nothing at all', () => {
    const doc = defaultPlanDoc();
    // Bypass normalisation: this is the shape a stale/foreign document can have.
    doc.days.B.exercises.push({ id: 'ghost_exercise', sets: 3, reps: '10', rest: 60 });
    const resolved = resolveProgram(doc);
    expect(resolved.B.exercises.map((e) => e.id)).not.toContain('ghost_exercise');
    expect(resolved.B.exercises).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('re-derives the day meta (duration + focus) only for an edited day', () => {
    const resolved = resolveProgram(editedPlan());
    expect(resolved.A.focus).not.toBe(PROGRAM.A.focus);
    // six distinct muscles, capped at five plus a summary word
    expect(resolved.A.focus.endsWith(' ועוד')).toBe(true);
    expect(resolved.A.dur).toMatch(/^~\d+ דק׳$/);
    // untouched days keep the hand-written copy, character for character
    expect(resolved.B).toBe(PROGRAM.B);
    expect(resolved.C).toBe(PROGRAM.C);
  });

  it('names a short custom day after the muscles it actually trains', () => {
    const doc = defaultPlanDoc();
    doc.customExercises.push({ ...CUSTOM, split: { ...CUSTOM.split } });
    doc.days.C.exercises = [{ id: CUSTOM.id, sets: 3, reps: '12', rest: 60 }];
    const resolved = resolveProgram(doc);
    expect(resolved.C.focus).toBe(CUSTOM.muscle);
    expect(resolved.C.exercises).toHaveLength(1);
  });

  it('keeps the fixed A/B/C skeleton and the day names', () => {
    const resolved = resolveProgram(editedPlan());
    expect(Object.keys(resolved).sort()).toEqual(['A', 'B', 'C']);
    expect(resolved.A.day).toBe(PROGRAM.A.day);
    expect(resolved.A.label).toBe(PROGRAM.A.label);
  });
});

describe('makeResolver', () => {
  it('is findExercise itself when there is no plan', () => {
    expect(makeResolver(null)).toBe(findExercise);
  });

  it('resolves both built-ins and custom exercises', () => {
    const resolve = makeResolver(editedPlan());
    expect(resolve('a1')?.he).toBe(PROGRAM.A.exercises[0]?.he);
    expect(resolve(CUSTOM.id)?.he).toBe(CUSTOM.he);
    expect(resolve('nope')).toBeNull();
  });

  it('still resolves an exercise that was REMOVED from every day', () => {
    // History shows exercises by id forever — a removed built-in must not turn
    // into a raw id string in the history list.
    const doc = editedPlan();
    const resolve = makeResolver(doc);
    expect(doc.days.A.exercises.map((r) => r.id)).not.toContain('a3');
    expect(resolve('a3')?.he).toBe(findExercise('a3')?.he);
  });

  it('offers every built-in plus the customs in the add-exercise library', () => {
    const lib = libraryExercises(editedPlan()).map((e) => e.id);
    const builtinCount = DAY_ORDER.reduce((n, k) => n + PROGRAM[k].exercises.length, 0);
    expect(lib).toHaveLength(builtinCount + 1);
    expect(lib).toContain('a3');
    expect(lib).toContain(CUSTOM.id);
  });

  it('mints custom ids with the cx_ prefix and no collisions', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCustomId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith('cx_')).toBe(true);
  });
});

/* ---------------------------------------------------------------- XP split */

describe('custom exercises in the XP engine', () => {
  it('splits XP 70/30 through the same bodyPartWeights the built-ins use', () => {
    const ex = customToExercise(CUSTOM);
    const w = bodyPartWeights(ex);
    expect(w.shoulders).toBeCloseTo(0.7, 6);
    expect(w.back).toBeCloseTo(0.3, 6);
    expect(w.chest).toBe(0);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('gives a single-part custom exercise 100% of the XP', () => {
    const { split: _drop, ...single } = CUSTOM;
    const w = bodyPartWeights(customToExercise(single));
    expect(w.shoulders).toBe(1);
  });

  it('maps RETROACTIVE grants of a custom exercise to the right body parts', () => {
    const plan = editedPlan();
    const sessions: Readonly<Record<string, Session>> = {
      '2025-03-02': { day: 'A', ex: { [CUSTOM.id]: [{ w: '30', r: '12', done: true }] } },
    };

    // Without a plan-aware resolver the set is simply skipped (today's behaviour
    // for an unknown id) — that is exactly why ensureGameState folds the plan first.
    expect(buildRetroactiveGrants(sessions, [], '2025-03-10')).toEqual([]);

    const grants = buildRetroactiveGrants(sessions, [], '2025-03-10', {
      resolve: makeResolver(plan),
      program: resolveProgram(plan),
    });
    const xp = grants.find((g) => g.type === 'xp_gained');
    expect(xp).toBeDefined();
    const parts = xp?.payload['parts'] as Record<string, number>;
    const shoulders = parts['shoulders'] ?? 0;
    const back = parts['back'] ?? 0;
    expect(shoulders).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
    expect(shoulders / back).toBeCloseTo(7 / 3, 3);
    // retro grants never pay energy
    expect(grants.some((g) => g.type === 'energy_gained')).toBe(false);
  });
});

/* -------------------------------------------------------------- validation */

describe('validatePlanDoc', () => {
  it('accepts the default plan and an ordinary edit', () => {
    expect(validatePlanDoc(defaultPlanDoc())).toEqual([]);
    expect(validatePlanDoc(editedPlan())).toEqual([]);
  });

  it('rejects an empty day', () => {
    const doc = defaultPlanDoc();
    doc.days.C.exercises = [];
    expect(validatePlanDoc(doc).join(' ')).toContain('לפחות תרגיל אחד');
  });

  it('rejects sets outside 1–10 and rest outside 15–600', () => {
    const doc = defaultPlanDoc();
    const row = doc.days.A.exercises[0];
    if (!row) throw new Error('no row');
    row.sets = 11;
    expect(validatePlanDoc(doc).join(' ')).toContain('הסטים');
    row.sets = 3;
    row.rest = 5;
    expect(validatePlanDoc(doc).join(' ')).toContain('המנוחה');
    row.rest = 900;
    expect(validatePlanDoc(doc).join(' ')).toContain('המנוחה');
  });

  it('rejects an empty reps field, a duplicate row and a nameless custom', () => {
    const doc = defaultPlanDoc();
    const row = doc.days.A.exercises[0];
    if (!row) throw new Error('no row');
    row.reps = '   ';
    expect(validatePlanDoc(doc).join(' ')).toContain('טווח חזרות');

    const dup = defaultPlanDoc();
    const head = dup.days.B.exercises[0];
    if (!head) throw new Error('no row');
    dup.days.B.exercises.push({ ...head });
    expect(validatePlanDoc(dup).join(' ')).toContain('פעמיים');

    const nameless = editedPlan();
    const custom = nameless.customExercises[0];
    if (!custom) throw new Error('no custom');
    custom.he = '';
    expect(validatePlanDoc(nameless).join(' ')).toContain('שם בעברית');
  });

  it('refuses to SAVE an invalid document and appends no event', () => {
    const store = new LocalStore(fakeStorage());
    const before = store.getEvents().length;
    const doc = defaultPlanDoc();
    doc.days.A.exercises = [];
    const res = savePlan(store, doc);
    expect(res.ok).toBe(false);
    expect(store.getEvents()).toHaveLength(before);
    expect(store.getState().plan).toBeNull();
  });
});

/* ------------------------------------------------------------ normalisation */

describe('normalizePlanDoc', () => {
  it('returns null for junk, for null and for a FUTURE document version', () => {
    expect(normalizePlanDoc(null)).toBeNull();
    expect(normalizePlanDoc(42)).toBeNull();
    expect(normalizePlanDoc('not json')).toBeNull();
    expect(normalizePlanDoc({ version: 99, days: {} })).toBeNull();
  });

  it('accepts the JSON round-trip of a real document unchanged', () => {
    const doc = editedPlan();
    const round = normalizePlanDoc(JSON.parse(JSON.stringify(planToRecord(doc))));
    expect(round).toEqual(doc);
  });

  it('clamps out-of-range numbers instead of rejecting the document', () => {
    const doc = defaultPlanDoc();
    const row = doc.days.A.exercises[0];
    if (!row) throw new Error('no row');
    row.sets = 99;
    row.rest = 1;
    const norm = normalizePlanDoc(planToRecord(doc));
    expect(norm?.days.A.exercises[0]?.sets).toBe(10);
    expect(norm?.days.A.exercises[0]?.rest).toBe(15);
  });

  it('drops unresolvable rows, deduplicates, and falls back to the built-in day', () => {
    const norm = normalizePlanDoc({
      version: 1,
      rev: 3,
      days: {
        A: { exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }, { id: 'a1', sets: 4, reps: '8', rest: 60 }, { id: 'ghost', sets: 3, reps: '8', rest: 60 }] },
        B: { exercises: [] },
        C: 'nonsense',
      },
      customExercises: [{ id: 'cx_1', he: '', bodyPart: 'core' }],
    });
    expect(norm?.days.A.exercises).toHaveLength(1);
    // an empty / unusable day falls back to the built-in day, never to nothing
    expect(norm?.days.B.exercises).toHaveLength(PROGRAM.B.exercises.length);
    expect(norm?.days.C.exercises).toHaveLength(PROGRAM.C.exercises.length);
    expect(norm?.customExercises).toEqual([]);
    expect(norm?.rev).toBe(3);
  });

  it('repairs a custom exercise with a bad body part and no equipment', () => {
    const norm = normalizePlanDoc({
      version: 1,
      days: {
        A: { exercises: [{ id: 'cx_x', sets: 3, reps: '10', rest: 60 }] },
        B: { exercises: [] },
        C: { exercises: [] },
      },
      customExercises: [{ id: 'cx_x', he: 'תרגיל', bodyPart: 'wings', equip: ['Jetpack'], split: { legs: 1 } }],
    });
    const custom = norm?.customExercises[0];
    expect(custom?.bodyPart).toBe('chest');
    expect(custom?.equip).toEqual(['Bodyweight']);
    expect(custom?.unit).toBe('חזרות');
    expect(custom?.muscle).toBe('חזה');
    // a one-sided "split" is not a split at all — it is dropped
    expect(custom?.split).toBeUndefined();
  });

  it('forgets custom exercises no day references any more', () => {
    const doc = editedPlan();
    doc.days.A.exercises = doc.days.A.exercises.filter((r) => r.id !== CUSTOM.id);
    const norm = normalizePlanDoc(planToRecord(doc));
    expect(norm?.customExercises).toEqual([]);
  });
});

/* ---------------------------------------------------------------- the fold */

describe('the plan_updated fold', () => {
  it('appends exactly ONE event per save and mirrors it into state.plan', () => {
    const store = new LocalStore(fakeStorage());
    const doc = editedPlan();
    const res = savePlan(store, doc);
    expect(res.ok).toBe(true);

    const planEvents = store.getEvents().filter((e) => e.type === 'plan_updated');
    expect(planEvents).toHaveLength(1);
    const payload = planEvents[0]?.payload;
    expect(payload?.['revision']).toBe(1);
    expect(typeof payload?.['date']).toBe('string');
    expect(store.getState().plan?.rev).toBe(1);
    expect(store.getState().plan?.days.A.exercises.map((r) => r.id)).toEqual(
      doc.days.A.exercises.map((r) => r.id),
    );
  });

  it('bumps the revision on every save', () => {
    const store = new LocalStore(fakeStorage());
    savePlan(store, editedPlan());
    const second = savePlan(store, store.getState().plan ?? editedPlan());
    expect(second.ok && second.plan?.rev).toBe(2);
    expect(store.getEvents().filter((e) => e.type === 'plan_updated')).toHaveLength(2);
  });

  it('is LAST-WRITER-WINS in the (ts, id) order, whatever order the log is in', () => {
    const older = editedPlan();
    const newer = defaultPlanDoc();
    newer.days.C.exercises = newer.days.C.exercises.slice(0, 2);

    const a = eventOf('plan_updated', 1000, 'aaa', { plan: planToRecord(older), revision: 1 });
    const b = eventOf('plan_updated', 2000, 'bbb', { plan: planToRecord(newer), revision: 2 });

    for (const log of [[a, b], [b, a]]) {
      const folded = planFromEvents(log);
      expect(folded?.days.C.exercises).toHaveLength(2);
      expect(folded?.days.A.exercises).toHaveLength(PROGRAM.A.exercises.length);
    }
  });

  it('breaks a ts TIE by event id, identically in both merge directions', () => {
    const first = editedPlan();
    const second = defaultPlanDoc();
    second.days.B.exercises = second.days.B.exercises.slice(0, 1);
    // same ts: the id decides, and 'zzz' > 'aaa'
    const a = eventOf('plan_updated', 5000, 'aaa', { plan: planToRecord(first), revision: 9 });
    const z = eventOf('plan_updated', 5000, 'zzz', { plan: planToRecord(second), revision: 1 });

    for (const log of [[a, z], [z, a]]) {
      expect(planFromEvents(log)?.days.B.exercises).toHaveLength(1);
    }
  });

  it('resets to the built-in program on data_cleared, and again after a null save', () => {
    const doc = editedPlan();
    const saved = eventOf('plan_updated', 1000, 'aaa', { plan: planToRecord(doc), revision: 1 });
    const cleared = eventOf('data_cleared', 2000, 'bbb', {});
    const reset = eventOf('plan_updated', 3000, 'ccc', { plan: null, revision: 2 });

    expect(planFromEvents([saved])).not.toBeNull();
    expect(planFromEvents([saved, cleared])).toBeNull();
    expect(planFromEvents([saved, cleared, reset])).toBeNull();
    // a save AFTER the clear survives it
    const after = eventOf('plan_updated', 4000, 'ddd', { plan: planToRecord(doc), revision: 3 });
    expect(planFromEvents([saved, cleared, after])).not.toBeNull();
  });

  it('rebuildFromEvents folds the plan exactly like planFromEvents', () => {
    const doc = editedPlan();
    const log = [
      eventOf('plan_updated', 1000, 'aaa', { plan: planToRecord(doc), revision: 1 }),
      eventOf('set_logged', 1500, 'bbb', { date: '2025-05-01', day: 'A', exId: 'a1', setIndex: 0, w: '40', r: '8' }),
    ];
    const state = rebuildFromEvents(log, Date.parse('2025-05-02T10:00:00Z'));
    expect(state.plan).toEqual(planFromEvents(log));
    expect(state.plan?.days.A.exercises.at(-1)?.id).toBe(CUSTOM.id);
  });

  it('a data_cleared in the log wipes the plan on replay too', () => {
    const doc = editedPlan();
    const log = [
      eventOf('plan_updated', 1000, 'aaa', { plan: planToRecord(doc), revision: 1 }),
      eventOf('data_cleared', 2000, 'bbb', {}),
    ];
    expect(rebuildFromEvents(log, Date.parse('2025-05-02T10:00:00Z')).plan).toBeNull();
  });

  it('a live store round-trips: save → replay the log → same plan', () => {
    const store = new LocalStore(fakeStorage());
    savePlan(store, editedPlan());
    const replayed = rebuildFromEvents(store.getEvents(), Date.now());
    expect(replayed.plan).toEqual(store.getState().plan);
  });

  it('clear() drops the plan from state and from the log', () => {
    const store = new LocalStore(fakeStorage());
    savePlan(store, editedPlan());
    expect(store.getState().plan).not.toBeNull();
    store.clear();
    expect(store.getState().plan).toBeNull();
    expect(planFromEvents(store.getEvents())).toBeNull();
  });

  it('saving null is a real event that resets the plan', () => {
    const store = new LocalStore(fakeStorage());
    savePlan(store, editedPlan());
    const res = savePlan(store, null);
    expect(res.ok && res.plan).toBeNull();
    expect(store.getState().plan).toBeNull();
    const last = store.getEvents().filter((e) => e.type === 'plan_updated').at(-1);
    expect(last?.payload['plan']).toBeNull();
    expect(last?.payload['revision']).toBe(2);
    expect(rebuildFromEvents(store.getEvents(), Date.now()).plan).toBeNull();
  });
});

/* ------------------------------------------------------------- persistence */

describe('state schema v3', () => {
  it('is at version 3 and carries a plan slot', () => {
    expect(CURRENT_STATE_VERSION).toBe(3);
    const store = new LocalStore(fakeStorage());
    expect(store.getState().plan).toBeNull();
    expect(store.getState().schemaVersion).toBe(3);
  });

  it('migrates an old v2 blob (no plan field) to v3 with plan: null', () => {
    const v2 = {
      schemaVersion: 2,
      sessions: { '2025-01-05': { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } } },
      ui: { view: 'A', open: {} },
      game: null,
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    };
    const state = migrateState(v2, Date.parse('2025-05-02T10:00:00Z'));
    expect(state.schemaVersion).toBe(3);
    expect(state.plan).toBeNull();
    expect(state.sessions['2025-01-05']).toBeDefined();
  });

  it('validates a persisted plan through normalizePlanDoc instead of trusting it', () => {
    const state = migrateState(
      {
        schemaVersion: 3,
        sessions: {},
        ui: { view: 'A', open: {} },
        game: null,
        plan: { version: 1, rev: 2, days: { A: { exercises: [{ id: 'a1', sets: 999, reps: '8', rest: 60 }] } }, customExercises: [] },
        meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
      },
      Date.now(),
    );
    expect(state.plan?.days.A.exercises[0]?.sets).toBe(10);
    expect(state.plan?.days.B.exercises).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('survives a reload: the plan comes back from storage', () => {
    const storage = fakeStorage();
    const first = new LocalStore(storage);
    savePlan(first, editedPlan());
    const reloaded = new LocalStore(storage);
    expect(reloaded.getState().plan?.rev).toBe(1);
    expect(reloaded.getState().plan?.days.A.exercises.at(-1)?.id).toBe(CUSTOM.id);
    expect(resolveProgram(reloaded.getState().plan).A.exercises.at(-1)?.he).toBe(CUSTOM.he);
  });

  it('rebuilds the plan from the LOG when the game blob is stale', () => {
    // A device whose `game` blob is from an older version rebuilds everything
    // from the log — the plan has to come back with it, and the retro grants
    // that rebuild triggers must see the custom exercises.
    const storage = fakeStorage();
    const seed = new LocalStore(storage);
    savePlan(seed, editedPlan());
    seed.update((d) => {
      d.sessions['2025-03-02'] = { day: 'A', ex: { [CUSTOM.id]: [{ w: '30', r: '12', done: true }] } };
      if (d.game) d.game.version = 1; // pretend it is an old blob
    });
    // drop the game blob exactly like an old build would have left it
    const raw = JSON.parse(storage.getItem(STATE_KEY) ?? '{}') as Record<string, unknown>;
    raw['game'] = null;
    storage.setItem(STATE_KEY, JSON.stringify(raw));

    const reloaded = new LocalStore(storage);
    expect(reloaded.getState().plan?.days.A.exercises.at(-1)?.id).toBe(CUSTOM.id);
    const game = reloaded.getState().game;
    expect(game).not.toBeNull();
    // the custom exercise paid XP into its two body parts, 70/30
    expect(game?.parts.shoulders.xp).toBeGreaterThan(0);
    expect(game?.parts.back.xp).toBeGreaterThan(0);
    expect((game?.parts.shoulders.xp ?? 0) / (game?.parts.back.xp ?? 1)).toBeCloseTo(7 / 3, 2);
  });
});

/* ------------------------------------------------------- day key coverage */

describe('plan days', () => {
  it('always has all three days, whatever the input', () => {
    const days: DayKey[] = ['A', 'B', 'C'];
    const norm = normalizePlanDoc({ version: 1, days: {}, customExercises: [] });
    for (const d of days) expect(norm?.days[d].exercises.length).toBeGreaterThan(0);
  });
});
