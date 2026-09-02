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
 *   6. VARIABLE DAYS (v2). A document defines its OWN days — 1 to 7 of them,
 *      each with a stable key, a Hebrew label and the weekdays it is trained on
 *      — plus the weekly target the streak judges a week by. A v1 document
 *      migrates into that shape without changing a single thing the user sees.
 */
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_PROGRAM,
  BUILTIN_WEEKDAYS,
  DAY_ORDER,
  EXTRA_EXERCISES,
  PROGRAM,
  bodyPartWeights,
  dayOf,
  findExercise,
  programDayKeys,
  type Day,
  type DayKey,
  type ResolvedProgram,
} from '../src/data/program.ts';
import {
  MAX_USER_PRESETS,
  isUserPresetId,
  type CustomExercise,
  type PlanDay,
  type PlanDoc,
  type UserPreset,
} from '../src/data/planTypes.ts';
import {
  applyPlanPresetEvent,
  assignedWeekdays,
  clonePlanDoc,
  collapseRoutingRanges,
  customToExercise,
  defaultPlanDoc,
  defaultTabView,
  deleteUserPreset,
  deriveWeeklyTarget,
  instantiateUserPreset,
  isBuiltInWeekdayMap,
  isDefaultPlan,
  isSuperset,
  isTabView,
  legalPairs,
  libraryExercises,
  defaultDay,
  makeResolver,
  maxSetsOf,
  newCustomId,
  newDayKey,
  normalizePlanDoc,
  normalizeUserPresets,
  planDay,
  planFromEvents,
  planIsDirty,
  planRows,
  planToRecord,
  resolveProgram,
  resolveTab,
  savePlan,
  saveUserPreset,
  scheduleTabs,
  supersetPairOf,
  supersetPairs,
  supersetPartner,
  userPresetList,
  validatePlanDoc,
  viewDayKey,
} from '../src/core/plan.ts';
import { presetById } from '../src/data/presets.ts';
import { buildRetroactiveGrants } from '../src/core/xp.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import type { AppEvent, Session } from '../src/storage/DataStore.ts';
import {
  CURRENT_STATE_VERSION,
  STATE_KEY,
  makeEvent,
  migrateState,
  rebuildFromEvents,
  type StorageLike,
} from '../src/storage/migrate.ts';

/* --------------------------------------------------------------- fixtures */

/**
 * `days` is an ORDERED ARRAY from PlanDoc v2 on, so a test that wants "day A"
 * looks it up by key. Both helpers throw rather than return undefined: a missing
 * day is always a test bug, never something to assert around.
 */
function pday(doc: PlanDoc, key: DayKey): PlanDay {
  const day = planDay(doc, key);
  if (!day) throw new Error(`plan has no day ${key}`);
  return day;
}

/** The resolved `Day` of a program, by key. */
function rday(program: ResolvedProgram, key: DayKey): Day {
  const day = dayOf(program, key);
  if (!day) throw new Error(`program has no day ${key}`);
  return day;
}

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
  const a = pday(doc, 'A');
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
    expect(doc.version).toBe(2);
    expect(doc.rev).toBe(0);
    expect(doc.weeklyTarget).toBe(3);
    expect(doc.customExercises).toEqual([]);
    expect(doc.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
    expect(doc.days.map((d) => d.label)).toEqual(DAY_ORDER.map((k) => PROGRAM[k].label));
    expect(doc.days.map((d) => d.weekdays)).toEqual(DAY_ORDER.map((k) => [...BUILTIN_WEEKDAYS[k]]));
    for (const k of DAY_ORDER) {
      expect(planRows(doc, k)).toEqual(
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
    const row = pday(b, 'A').exercises[0];
    if (!row) throw new Error('no rows');
    row.sets = 9;
    expect(pday(a, 'A').exercises[0]?.sets).not.toBe(9);
  });
});

/* -------------------------------------------------------------- resolution */

describe('resolveProgram', () => {
  it('returns the built-in program REFERENCE-identically for null', () => {
    // The zero-behaviour-change guarantee of the whole feature: the same object,
    // whose days are the PROGRAM day objects themselves.
    expect(resolveProgram(null)).toBe(BUILTIN_PROGRAM);
    expect(resolveProgram(null).days.map((d) => d.day)).toEqual(DAY_ORDER.map((k) => PROGRAM[k]));
    expect(resolveProgram(null).weeklyTarget).toBe(3);
  });

  it('returns the built-in Day objects for a plan that changed nothing', () => {
    const resolved = resolveProgram(defaultPlanDoc());
    for (const k of DAY_ORDER) expect(rday(resolved, k)).toBe(PROGRAM[k]);
  });

  it('overrides sets / reps / rest of a built-in exercise but keeps its copy', () => {
    const resolved = resolveProgram(editedPlan());
    const first = rday(resolved, 'A').exercises[0];
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
    expect(rday(resolved, 'A').exercises.map((e) => e.id)).not.toContain('a3');
    const custom = rday(resolved, 'A').exercises.at(-1);
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
    pday(doc, 'B').exercises.push({ id: 'ghost_exercise', sets: 3, reps: '10', rest: 60 });
    const resolved = resolveProgram(doc);
    expect(rday(resolved, 'B').exercises.map((e) => e.id)).not.toContain('ghost_exercise');
    expect(rday(resolved, 'B').exercises).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('re-derives the day meta (duration + focus) only for an edited day', () => {
    const resolved = resolveProgram(editedPlan());
    expect(rday(resolved, 'A').focus).not.toBe(PROGRAM.A.focus);
    // six distinct muscles, capped at five plus a summary word
    expect(rday(resolved, 'A').focus.endsWith(' ועוד')).toBe(true);
    expect(rday(resolved, 'A').dur).toMatch(/^~\d+ דק׳$/);
    // untouched days keep the hand-written copy, character for character
    expect(rday(resolved, 'B')).toBe(PROGRAM.B);
    expect(rday(resolved, 'C')).toBe(PROGRAM.C);
  });

  it('names a short custom day after the muscles it actually trains', () => {
    const doc = defaultPlanDoc();
    doc.customExercises.push({ ...CUSTOM, split: { ...CUSTOM.split } });
    pday(doc, 'C').exercises = [{ id: CUSTOM.id, sets: 3, reps: '12', rest: 60 }];
    const resolved = resolveProgram(doc);
    expect(rday(resolved, 'C').focus).toBe(CUSTOM.muscle);
    expect(rday(resolved, 'C').exercises).toHaveLength(1);
  });

  it('keeps the A/B/C skeleton and the day names of a migrated plan', () => {
    const resolved = resolveProgram(editedPlan());
    expect(programDayKeys(resolved)).toEqual(['A', 'B', 'C']);
    expect(rday(resolved, 'A').day).toBe(PROGRAM.A.day);
    expect(rday(resolved, 'A').label).toBe(PROGRAM.A.label);
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
    expect(pday(doc, 'A').exercises.map((r) => r.id)).not.toContain('a3');
    expect(resolve('a3')?.he).toBe(findExercise('a3')?.he);
  });

  it('offers every built-in plus the customs in the add-exercise library', () => {
    const lib = libraryExercises(editedPlan()).map((e) => e.id);
    const builtinCount = DAY_ORDER.reduce((n, k) => n + PROGRAM[k].exercises.length, 0);
    // the program's own exercises, the library additions, then the customs
    expect(lib).toHaveLength(builtinCount + EXTRA_EXERCISES.length + 1);
    expect(lib).toContain('a3');
    expect(lib).toContain(EXTRA_EXERCISES[0]?.id);
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
    pday(doc, 'C').exercises = [];
    expect(validatePlanDoc(doc).join(' ')).toContain('לפחות תרגיל אחד');
  });

  it('rejects sets outside 1–10 and rest outside 15–600', () => {
    const doc = defaultPlanDoc();
    const row = pday(doc, 'A').exercises[0];
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
    const row = pday(doc, 'A').exercises[0];
    if (!row) throw new Error('no row');
    row.reps = '   ';
    expect(validatePlanDoc(doc).join(' ')).toContain('טווח חזרות');

    const dup = defaultPlanDoc();
    const head = pday(dup, 'B').exercises[0];
    if (!head) throw new Error('no row');
    pday(dup, 'B').exercises.push({ ...head });
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
    pday(doc, 'A').exercises = [];
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
    const row = pday(doc, 'A').exercises[0];
    if (!row) throw new Error('no row');
    row.sets = 99;
    row.rest = 1;
    const norm = normalizePlanDoc(planToRecord(doc));
    expect(planRows(norm, 'A')[0]?.sets).toBe(10);
    expect(planRows(norm, 'A')[0]?.rest).toBe(15);
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
    expect(planRows(norm, 'A')).toHaveLength(1);
    // an empty / unusable day falls back to the built-in day, never to nothing
    expect(planRows(norm, 'B')).toHaveLength(PROGRAM.B.exercises.length);
    expect(planRows(norm, 'C')).toHaveLength(PROGRAM.C.exercises.length);
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
    pday(doc, 'A').exercises = pday(doc, 'A').exercises.filter((r) => r.id !== CUSTOM.id);
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
    expect(planRows(store.getState().plan, 'A').map((r) => r.id)).toEqual(
      pday(doc, 'A').exercises.map((r) => r.id),
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
    pday(newer, 'C').exercises = pday(newer, 'C').exercises.slice(0, 2);

    const a = eventOf('plan_updated', 1000, 'aaa', { plan: planToRecord(older), revision: 1 });
    const b = eventOf('plan_updated', 2000, 'bbb', { plan: planToRecord(newer), revision: 2 });

    for (const log of [[a, b], [b, a]]) {
      const folded = planFromEvents(log);
      expect(planRows(folded, 'C')).toHaveLength(2);
      expect(planRows(folded, 'A')).toHaveLength(PROGRAM.A.exercises.length);
    }
  });

  it('breaks a ts TIE by event id, identically in both merge directions', () => {
    const first = editedPlan();
    const second = defaultPlanDoc();
    pday(second, 'B').exercises = pday(second, 'B').exercises.slice(0, 1);
    // same ts: the id decides, and 'zzz' > 'aaa'
    const a = eventOf('plan_updated', 5000, 'aaa', { plan: planToRecord(first), revision: 9 });
    const z = eventOf('plan_updated', 5000, 'zzz', { plan: planToRecord(second), revision: 1 });

    for (const log of [[a, z], [z, a]]) {
      expect(planRows(planFromEvents(log), 'B')).toHaveLength(1);
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
    expect(planRows(state.plan, 'A').at(-1)?.id).toBe(CUSTOM.id);
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

describe('state schema v6', () => {
  it('is at version 6 and carries a plan slot and an empty preset shelf', () => {
    expect(CURRENT_STATE_VERSION).toBe(6);
    const store = new LocalStore(fakeStorage());
    expect(store.getState().plan).toBeNull();
    expect(store.getState().planPresets).toEqual({});
    expect(store.getState().schemaVersion).toBe(6);
  });

  it('migrates an old v2 blob (no plan field) to the current version with plan: null', () => {
    const v2 = {
      schemaVersion: 2,
      sessions: { '2025-01-05': { day: 'A', ex: { a1: [{ w: '40', r: '10', done: true }] } } },
      ui: { view: 'A', open: {} },
      game: null,
      meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
    };
    const state = migrateState(v2, Date.parse('2025-05-02T10:00:00Z'));
    expect(state.schemaVersion).toBe(CURRENT_STATE_VERSION);
    expect(state.plan).toBeNull();
    expect(state.sessions['2025-01-05']).toBeDefined();
  });

  it('validates a persisted plan through normalizePlanDoc instead of trusting it', () => {
    const state = migrateState(
      {
        schemaVersion: 4,
        sessions: {},
        ui: { view: 'A', open: {} },
        game: null,
        plan: { version: 1, rev: 2, days: { A: { exercises: [{ id: 'a1', sets: 999, reps: '8', rest: 60 }] } }, customExercises: [] },
        meta: { legacyImported: true, createdAt: 1, updatedAt: 1 },
      },
      Date.now(),
    );
    expect(planRows(state.plan, 'A')[0]?.sets).toBe(10);
    expect(planRows(state.plan, 'B')).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('survives a reload: the plan comes back from storage', () => {
    const storage = fakeStorage();
    const first = new LocalStore(storage);
    savePlan(first, editedPlan());
    const reloaded = new LocalStore(storage);
    expect(reloaded.getState().plan?.rev).toBe(1);
    expect(planRows(reloaded.getState().plan, 'A').at(-1)?.id).toBe(CUSTOM.id);
    expect(rday(resolveProgram(reloaded.getState().plan), 'A').exercises.at(-1)?.he).toBe(CUSTOM.he);
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
    expect(planRows(reloaded.getState().plan, 'A').at(-1)?.id).toBe(CUSTOM.id);
    const game = reloaded.getState().game;
    expect(game).not.toBeNull();
    // the custom exercise paid XP into its two body parts, 70/30
    expect(game?.parts.shoulders.xp).toBeGreaterThan(0);
    expect(game?.parts.back.xp).toBeGreaterThan(0);
    expect((game?.parts.shoulders.xp ?? 0) / (game?.parts.back.xp ?? 1)).toBeCloseTo(7 / 3, 2);
  });
});

/* ------------------------------------------------------- day key coverage */

describe('user-saved presets ("התוכניות שלי")', () => {
  /** A plan worth freezing: edited numbers, a custom exercise, a superset. */
  function myPlan(): PlanDoc {
    const doc = defaultPlanDoc();
    const custom: CustomExercise = {
      id: newCustomId(),
      he: 'תרגיל שלי',
      en: 'My Move',
      bodyPart: 'legs',
      unit: 'חזרות',
      equip: ['Dumbbells'],
      muscle: 'רגליים',
    };
    doc.customExercises.push(custom);
    const a = pday(doc, 'A');
    a.exercises = [
      { id: 'a1', sets: 5, reps: '6', rest: 120 },
      { id: 'a2', sets: 3, reps: '10', rest: 60 },
      { id: custom.id, sets: 3, reps: '12', rest: 60 },
    ];
    a.supersets = [['a1', 'a2']];
    a.weekdays = [0, 3];
    return doc;
  }

  it('saves the plan as ONE event and mirrors it into state, replay-equal', () => {
    const store = new LocalStore(fakeStorage());
    const res = saveUserPreset(store, '  התוכנית של אידו  ', myPlan());
    if (!res.ok) throw new Error(res.error);
    expect(isUserPresetId(res.presetId)).toBe(true);
    expect(res.preset.name).toBe('התוכנית של אידו'); // trimmed
    expect(res.preset.plan.rev).toBe(0);

    const saved = store.getEvents().filter((e) => e.type === 'plan_preset_saved');
    expect(saved).toHaveLength(1);
    const shelf = store.getState().planPresets;
    expect(Object.keys(shelf)).toEqual([res.presetId]);
    expect(shelf[res.presetId]?.plan.customExercises).toHaveLength(1);
    // the frozen document is a real, valid plan — supersets and all
    expect(validatePlanDoc(shelf[res.presetId]!.plan)).toEqual([]);
    expect(supersetPairs(pday(shelf[res.presetId]!.plan, 'A'))).toEqual([['a1', 'a2']]);
    // live state === replay of the log
    expect(rebuildFromEvents(store.getEvents(), Date.now()).planPresets).toEqual(shelf);
    // …and the ACTIVE plan was never touched: freezing is not saving the plan
    expect(store.getState().plan).toBeNull();
  });

  it('refuses an empty name and an invalid document, appending nothing', () => {
    const store = new LocalStore(fakeStorage());
    expect(saveUserPreset(store, '   ', myPlan()).ok).toBe(false);
    const broken = myPlan();
    pday(broken, 'A').exercises = []; // a day with no rows fails validation
    expect(saveUserPreset(store, 'שם', broken).ok).toBe(false);
    expect(store.getEvents().filter((e) => e.type === 'plan_preset_saved')).toHaveLength(0);
    expect(store.getState().planPresets).toEqual({});
  });

  it('caps the shelf, and delete frees a slot', () => {
    const store = new LocalStore(fakeStorage());
    const ids: string[] = [];
    for (let i = 0; i < MAX_USER_PRESETS; i++) {
      const res = saveUserPreset(store, `תוכנית ${i}`, defaultPlanDoc());
      if (!res.ok) throw new Error(res.error);
      ids.push(res.presetId);
    }
    expect(saveUserPreset(store, 'אחת יותר מדי', defaultPlanDoc()).ok).toBe(false);
    expect(deleteUserPreset(store, ids[0] ?? '')).toBe(true);
    expect(saveUserPreset(store, 'עכשיו יש מקום', defaultPlanDoc()).ok).toBe(true);
    // the shelf lists in fold order: oldest first, the new one at the far end
    const names = userPresetList(store.getState()).map((p) => p.preset.name);
    expect(names[0]).toBe('תוכנית 1');
    expect(names[names.length - 1]).toBe('עכשיו יש מקום');
  });

  it('deletes exactly what exists, exactly once', () => {
    const store = new LocalStore(fakeStorage());
    const res = saveUserPreset(store, 'למחיקה', defaultPlanDoc());
    if (!res.ok) throw new Error(res.error);
    expect(deleteUserPreset(store, res.presetId)).toBe(true);
    expect(store.getState().planPresets).toEqual({});
    // a double-tap and a junk id append no second event
    expect(deleteUserPreset(store, res.presetId)).toBe(false);
    expect(deleteUserPreset(store, 'up_nope!')).toBe(false);
    expect(store.getEvents().filter((e) => e.type === 'plan_preset_deleted')).toHaveLength(1);
    expect(rebuildFromEvents(store.getEvents(), Date.now()).planPresets).toEqual({});
  });

  it('folds LWW per id and converges in either merge order', () => {
    const planRec = planToRecord(defaultPlanDoc());
    const id1 = 'up_aaaaaaaaaaaa';
    const id2 = 'up_bbbbbbbbbbbb';
    const events = [
      makeEvent('plan_preset_saved', { presetId: id1, name: 'ראשונה', plan: planRec, date: '2025-01-01' }, 100),
      makeEvent('plan_preset_saved', { presetId: id2, name: 'שנייה', plan: planRec, date: '2025-01-01' }, 150),
      // a re-save of id1 later in the order wins…
      makeEvent('plan_preset_saved', { presetId: id1, name: 'ראשונה מעודכנת', plan: planRec, date: '2025-01-02' }, 200),
      // …and id2 is deleted after its save
      makeEvent('plan_preset_deleted', { presetId: id2, date: '2025-01-03' }, 300),
      // a delete that sorts BEFORE a save of a fresh id kills nothing
      makeEvent('plan_preset_deleted', { presetId: 'up_cccccccccccc', date: '2025-01-01' }, 120),
      makeEvent('plan_preset_saved', { presetId: 'up_cccccccccccc', name: 'שלישית', plan: planRec, date: '2025-01-02' }, 250),
    ];
    const forward = rebuildFromEvents(events, Date.now()).planPresets;
    const backward = rebuildFromEvents([...events].reverse(), Date.now()).planPresets;
    expect(backward).toEqual(forward);
    expect(Object.keys(forward).sort()).toEqual([id1, 'up_cccccccccccc']);
    expect(forward[id1]?.name).toBe('ראשונה מעודכנת');
  });

  it('folds malformed payloads to nothing, and data_cleared wipes the shelf', () => {
    const planRec = planToRecord(defaultPlanDoc());
    const junk = [
      makeEvent('plan_preset_saved', { presetId: 'not-a-preset', name: 'x', plan: planRec, date: 'd' }, 10),
      makeEvent('plan_preset_saved', { presetId: 'up_dddddddddddd', name: '   ', plan: planRec, date: 'd' }, 20),
      makeEvent('plan_preset_saved', { presetId: 'up_eeeeeeeeeeee', name: 'שם', plan: { version: 99 }, date: 'd' }, 30),
    ];
    expect(rebuildFromEvents(junk, Date.now()).planPresets).toEqual({});

    const wiped = [
      makeEvent('plan_preset_saved', { presetId: 'up_ffffffffffff', name: 'שם', plan: planRec, date: 'd' }, 10),
      makeEvent('data_cleared', {}, 20),
    ];
    expect(rebuildFromEvents(wiped, Date.now()).planPresets).toEqual({});

    // the shared fold shrugs at unrelated event types
    const shelf: Record<string, UserPreset> = {};
    applyPlanPresetEvent(shelf, 'plan_updated', { presetId: 'up_ffffffffffff' });
    expect(shelf).toEqual({});
  });

  it('instantiates with FRESH day keys and everything else verbatim', () => {
    const store = new LocalStore(fakeStorage());
    const res = saveUserPreset(store, 'שלי', myPlan());
    if (!res.ok) throw new Error(res.error);

    const inst = instantiateUserPreset(res.preset);
    expect(validatePlanDoc(inst)).toEqual([]);
    const originalKeys = res.preset.plan.days.map((d) => d.key);
    const newKeys = inst.days.map((d) => d.key);
    for (const k of newKeys) {
      expect(k.startsWith('d_')).toBe(true);
      expect(originalKeys).not.toContain(k);
    }
    // a second application mints ANOTHER set of days — no silent merging
    expect(instantiateUserPreset(res.preset).days.map((d) => d.key)).not.toEqual(newKeys);
    // labels, weekdays, rows, supersets and the custom exercise all carry over
    expect(inst.days.map((d) => d.label)).toEqual(res.preset.plan.days.map((d) => d.label));
    expect(inst.days[0]?.weekdays).toEqual([0, 3]);
    expect(inst.days.map((d) => d.exercises)).toEqual(res.preset.plan.days.map((d) => d.exercises));
    expect(supersetPairs(inst.days[0] as PlanDay)).toEqual([['a1', 'a2']]);
    expect(inst.customExercises).toEqual(res.preset.plan.customExercises);
    // …and the instantiated document SAVES like any plan
    const savedPlan = savePlan(store, inst);
    expect(savedPlan.ok).toBe(true);
  });

  it('normalizeUserPresets keeps valid entries and drops junk', () => {
    const good = { name: 'שלי', plan: planToRecord(defaultPlanDoc()) };
    const out = normalizeUserPresets({
      up_abcd1234abcd: good,
      'not-an-id': good,
      up_ffffffffffff: { name: '', plan: planToRecord(defaultPlanDoc()) },
      up_eeeeeeeeeeee: { name: 'שם', plan: 'garbage' },
      up_dddddddddddd: 42,
    });
    expect(Object.keys(out)).toEqual(['up_abcd1234abcd']);
    expect(out['up_abcd1234abcd']?.name).toBe('שלי');
    expect(normalizeUserPresets(null)).toEqual({});
    // …and a state blob round-trips through migrateState with the shelf intact
    const store = new LocalStore(fakeStorage());
    const res = saveUserPreset(store, 'שלי', myPlan());
    if (!res.ok) throw new Error(res.error);
    const reread = migrateState(JSON.parse(JSON.stringify(store.getState())), Date.now());
    expect(reread.planPresets).toEqual(store.getState().planPresets);
  });
});

describe('plan days', () => {
  it('always has all three days when a v1 document brought none', () => {
    const days: DayKey[] = ['A', 'B', 'C'];
    const norm = normalizePlanDoc({ version: 1, days: {}, customExercises: [] });
    for (const d of days) expect(planRows(norm, d).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------ PlanDoc v1 -> v2 */

/** Exactly what a v1 client persisted (and what its `plan_updated` carried). */
function v1Doc(days: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, rev: 4, days, customExercises: [] };
}

/** The motivating case: two workouts, four training days, א/ב alternating. */
function abPlan(): PlanDoc {
  return {
    version: 2,
    rev: 0,
    days: [
      {
        key: 'd_alef',
        label: "חלק א'",
        weekdays: [0, 3],
        exercises: [
          { id: 'a1', sets: 3, reps: '8–10', rest: 90 },
          { id: 'a2', sets: 3, reps: '8–10', rest: 90 },
        ],
      },
      {
        key: 'd_bet',
        label: "חלק ב'",
        weekdays: [2, 4],
        exercises: [{ id: 'b1', sets: 3, reps: '8–10', rest: 90 }],
      },
    ],
    weeklyTarget: 4,
    customExercises: [],
  };
}

describe('PlanDoc v1 -> v2 migration', () => {
  it('turns the fixed A/B/C record into the ordered array, losing nothing', () => {
    const doc = normalizePlanDoc(v1Doc({ A: { exercises: [{ id: 'a1', sets: 4, reps: '6', rest: 100 }] } }));
    expect(doc?.version).toBe(2);
    expect(doc?.rev).toBe(4);
    expect(doc?.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
    // the one edited day keeps its edit…
    expect(planRows(doc, 'A')).toEqual([{ id: 'a1', sets: 4, reps: '6', rest: 100 }]);
    // …and the days it said nothing about fall back to the built-in ones
    expect(planRows(doc, 'B')).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('gives every migrated day the built-in label, weekdays and weekly target', () => {
    const doc = normalizePlanDoc(v1Doc());
    for (const k of DAY_ORDER) {
      const day = pday(doc as PlanDoc, k);
      expect(day.label).toBe(PROGRAM[k].label);
      expect(day.weekdays).toEqual([...BUILTIN_WEEKDAYS[k]]);
    }
    // v1 had no target — it always meant three days a week.
    expect(doc?.weeklyTarget).toBe(3);
  });

  it('treats a document with NO version as v1 (the oldest blobs had none)', () => {
    const doc = normalizePlanDoc({ days: { A: { exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] } } });
    expect(doc?.version).toBe(2);
    expect(doc?.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
  });

  it('changes NOTHING a v1 user could see: it resolves to the built-in days', () => {
    // The whole point of the migration: same day objects, same tab order, same
    // default tab on every weekday.
    const migrated = normalizePlanDoc(planToRecord(defaultPlanDoc()) as unknown as Record<string, unknown>);
    const fromV1 = normalizePlanDoc({ ...v1Doc(), rev: 0 });
    expect(fromV1).toEqual(migrated);
    const resolved = resolveProgram(fromV1);
    expect(programDayKeys(resolved)).toEqual(['A', 'B', 'C']);
    for (const k of DAY_ORDER) expect(rday(resolved, k)).toBe(PROGRAM[k]);
    for (let wd = 0; wd < 7; wd += 1) {
      const day = new Date(Date.UTC(2025, 0, 5 + wd, 12));
      expect(defaultDay(fromV1, day)).toBe(defaultDay(null, day));
    }
  });

  it('accepts a v2 document unchanged and refuses a FUTURE one', () => {
    const doc = abPlan();
    expect(normalizePlanDoc(JSON.parse(JSON.stringify(planToRecord(doc))))).toEqual(doc);
    expect(normalizePlanDoc({ ...planToRecord(doc), version: 3 })).toBeNull();
    expect(normalizePlanDoc({ version: 99, days: [] })).toBeNull();
  });

  it('clamps the weekly target into 1–7 and defaults it to 3', () => {
    const of = (weeklyTarget: unknown): number | undefined =>
      normalizePlanDoc({ ...planToRecord(abPlan()), weeklyTarget })?.weeklyTarget;
    expect(of(4)).toBe(4);
    expect(of(0)).toBe(1);
    expect(of(99)).toBe(7);
    expect(of(2.6)).toBe(3);
    expect(of('nope')).toBe(3);
    expect(of(undefined)).toBe(3);
  });

  it('repairs the day list: bad keys, duplicates, reserved keys and overflow', () => {
    const doc = normalizePlanDoc({
      version: 2,
      days: [
        { key: 'd_ok', label: 'יום', exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] },
        // a reserved view key would hijack a tab — refused
        { key: 'H', label: 'היסטוריה', exercises: [{ id: 'a2', sets: 3, reps: '8', rest: 60 }] },
        // a duplicate key would make two tabs the same day — first one wins
        { key: 'd_ok', label: 'שוב', exercises: [{ id: 'a3', sets: 3, reps: '8', rest: 60 }] },
        // no resolvable exercise at all, and not a built-in day — dropped
        { key: 'd_ghost', label: 'רוח', exercises: [{ id: 'nope', sets: 3, reps: '8', rest: 60 }] },
        // a key that could not be put in a data attribute
        { key: 'a b', label: 'רווח', exercises: [{ id: 'a4', sets: 3, reps: '8', rest: 60 }] },
      ],
      weeklyTarget: 2,
      customExercises: [],
    });
    expect(doc?.days.map((d) => d.key)).toEqual(['d_ok']);
    expect(planRows(doc, 'd_ok').map((r) => r.id)).toEqual(['a1']);
  });

  it('caps a document at seven days', () => {
    const days = Array.from({ length: 12 }, (_, i) => ({
      key: `d_${i}`,
      label: `יום ${i}`,
      exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }],
    }));
    const doc = normalizePlanDoc({ version: 2, days, weeklyTarget: 7, customExercises: [] });
    expect(doc?.days).toHaveLength(7);
  });

  it('falls back to the built-in days when a v2 document has none left', () => {
    const doc = normalizePlanDoc({ version: 2, days: [{ key: 'PL', label: 'x', exercises: [] }], customExercises: [] });
    expect(doc?.days.map((d) => d.key)).toEqual(['A', 'B', 'C']);
  });

  it('keeps a built-in day that lost all its rows, exactly like v1 did', () => {
    const doc = normalizePlanDoc({
      version: 2,
      days: [{ key: 'B', label: 'אימון B', weekdays: [2], exercises: [{ id: 'ghost', sets: 3, reps: '8', rest: 60 }] }],
      weeklyTarget: 1,
      customExercises: [],
    });
    expect(doc?.days.map((d) => d.key)).toEqual(['B']);
    expect(planRows(doc, 'B')).toHaveLength(PROGRAM.B.exercises.length);
  });

  it('repairs weekdays: out of range, duplicated and unsorted', () => {
    const doc = normalizePlanDoc({
      version: 2,
      days: [{ key: 'd_x', label: 'יום', weekdays: [6, 0, 0, 9, -1, 2.7], exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }] }],
      weeklyTarget: 2,
      customExercises: [],
    });
    expect(pday(doc as PlanDoc, 'd_x').weekdays).toEqual([0, 2, 6]);
  });

  it('mints day keys with the d_ prefix and no collisions', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newDayKey()));
    expect(keys.size).toBe(50);
    for (const k of keys) expect(k.startsWith('d_')).toBe(true);
  });
});

/* -------------------------------------------------------- variable days */

describe('a plan with its own days', () => {
  it('renders two tabs, in the plan order, with the plan labels', () => {
    const resolved = resolveProgram(abPlan());
    expect(programDayKeys(resolved)).toEqual(['d_alef', 'd_bet']);
    expect(resolved.days.map((d) => d.label)).toEqual(["חלק א'", "חלק ב'"]);
    expect(resolved.weeklyTarget).toBe(4);
    // the header caption is the weekday the day is named after
    expect(rday(resolved, 'd_alef').day).toBe('ראשון');
    expect(rday(resolved, 'd_bet').day).toBe('שלישי');
    expect(rday(resolved, 'd_alef').exercises.map((e) => e.id)).toEqual(['a1', 'a2']);
  });

  it('validates, saves and replays with non-A/B/C day keys', () => {
    const store = new LocalStore(fakeStorage());
    expect(validatePlanDoc(abPlan())).toEqual([]);
    expect(savePlan(store, abPlan()).ok).toBe(true);
    const saved = store.getState().plan;
    expect(saved?.days.map((d) => d.key)).toEqual(['d_alef', 'd_bet']);
    expect(saved?.weeklyTarget).toBe(4);
    expect(rebuildFromEvents(store.getEvents(), Date.now()).plan).toEqual(saved);
  });

  it('refuses a day list that is empty, over-long or keyed on a reserved view', () => {
    const empty = { ...abPlan(), days: [] };
    expect(validatePlanDoc(empty).join(' ')).toContain('לפחות יום אימון אחד');

    const reserved = abPlan();
    const first = reserved.days[0];
    if (!first) throw new Error('no day');
    first.key = 'BT';
    expect(validatePlanDoc(reserved).join(' ')).toContain('מזהה יום לא תקין');

    const nameless = abPlan();
    const head = nameless.days[0];
    if (!head) throw new Error('no day');
    head.label = '  ';
    expect(validatePlanDoc(nameless).join(' ')).toContain('שם');

    const target = { ...abPlan(), weeklyTarget: 9 };
    expect(validatePlanDoc(target).join(' ')).toContain('יעד האימונים השבועי');
  });

  it('is dirty against the built-in program and is not the default plan', () => {
    expect(isDefaultPlan(abPlan())).toBe(false);
    expect(planIsDirty(abPlan(), null)).toBe(true);
    expect(clonePlanDoc(abPlan())).toEqual(abPlan());
  });

  it('compares documents by VALUE, whichever path built them', () => {
    // `planIsDirty` compares JSON, and JSON keeps insertion order — so a day
    // that came back from `normalizePlanDoc` has to be built exactly like one
    // that came from `defaultPlanDoc`, or the editor would claim unsaved changes
    // on a plan nobody touched.
    const round = normalizePlanDoc(planToRecord(defaultPlanDoc()));
    expect(isDefaultPlan(round)).toBe(true);
    expect(planIsDirty(clonePlanDoc(defaultPlanDoc()), round)).toBe(false);
    expect(planIsDirty(clonePlanDoc(abPlan()), normalizePlanDoc(planToRecord(abPlan())))).toBe(false);
    // and a save of an untouched plan still reads as "the original program"
    const store = new LocalStore(fakeStorage());
    savePlan(store, clonePlanDoc(defaultPlanDoc()));
    expect(isDefaultPlan(store.getState().plan)).toBe(true);
  });
});

/* ------------------------------------------------------------- defaultDay */

describe('defaultDay', () => {
  /** Noon UTC on the Sunday..Saturday of one week, so no timezone can shift it. */
  function weekday(wd: number): Date {
    const d = new Date(Date.UTC(2025, 0, 5 + wd, 12));
    expect(d.getDay()).toBe(wd);
    return d;
  }

  it('reproduces the legacy mapping for the built-in program', () => {
    // Sun/Mon -> A, Tue/Wed -> B, Thu/Fri/Sat -> C, exactly as before.
    const expected = ['A', 'A', 'B', 'B', 'C', 'C', 'C'];
    for (let wd = 0; wd < 7; wd += 1) expect(defaultDay(null, weekday(wd))).toBe(expected[wd]);
  });

  it('follows the plan weekday map, and falls back to the FIRST day', () => {
    const plan = abPlan(); // א on Sun+Wed, ב on Tue+Thu
    expect(defaultDay(plan, weekday(0))).toBe('d_alef');
    expect(defaultDay(plan, weekday(3))).toBe('d_alef');
    expect(defaultDay(plan, weekday(2))).toBe('d_bet');
    expect(defaultDay(plan, weekday(4))).toBe('d_bet');
    // rest days: nothing claims them, so the app opens on the first day
    for (const wd of [1, 5, 6]) expect(defaultDay(plan, weekday(wd))).toBe('d_alef');
  });

  it('falls back to the first day when a plan assigns no weekdays at all', () => {
    const plan = abPlan();
    for (const d of plan.days) delete d.weekdays;
    for (let wd = 0; wd < 7; wd += 1) expect(defaultDay(plan, weekday(wd))).toBe('d_alef');
  });
});

/* ----------------------------------------------------------- schedule tabs */

/**
 * The tab bar shows the WEEK, not the plan's day list: an A/B split trained on
 * four weekdays is four tabs over two workouts. The one exception is the
 * built-in `[0,1] / [2,3] / [4,5,6]` map, which is a ROUTING map (every weekday
 * must open some tab) and therefore stays three tabs — the same exception
 * `deriveWeeklyTarget` makes for the weekly target, through the same predicate.
 */
describe('scheduleTabs', () => {
  function tabsOf(plan: PlanDoc | null): ReturnType<typeof scheduleTabs> {
    return scheduleTabs(resolveProgram(plan));
  }

  it('expands the A/B preset into the four days of the week, in weekday order', () => {
    const preset = presetById('ab4');
    if (!preset) throw new Error('no ab4 preset');
    const plan = preset.build();
    const [alef, bet1, bet2] = plan.days;
    if (!alef || !bet1 || !bet2) throw new Error('preset lost a day');

    const tabs = tabsOf(plan);
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.title)).toEqual(['ראשון', 'שלישי', 'רביעי', 'חמישי']);
    expect(tabs.map((t) => t.weekday)).toEqual([0, 2, 3, 4]);
    // ראשון + רביעי are אימון A; שלישי is B1 and חמישי is B2 — three workouts,
    // four days of the week
    expect(tabs.map((t) => t.dayKey)).toEqual([alef.key, bet1.key, alef.key, bet2.key]);
    expect(tabs.map((t) => t.subtitle)).toEqual([alef.label, bet1.label, alef.label, bet2.label]);
    // …and each occurrence of אימון A carries its own stable view id, while the
    // once-a-week days keep their PLAIN key (nothing to disambiguate)
    expect(tabs.map((t) => t.viewId)).toEqual([
      `${alef.key}@0`,
      bet1.key,
      `${alef.key}@3`,
      bet2.key,
    ]);
    // the day itself is untouched: the `@` is a label, and it strips back off
    expect(tabs.map((t) => viewDayKey(t.viewId))).toEqual([alef.key, bet1.key, alef.key, bet2.key]);
  });

  it('leaves the built-in program at its three tabs, exactly as before', () => {
    for (const plan of [null, defaultPlanDoc(), normalizePlanDoc(planToRecord(defaultPlanDoc()))]) {
      const tabs = tabsOf(plan);
      expect(tabs).toHaveLength(3);
      expect(tabs.map((t) => t.viewId)).toEqual(['A', 'B', 'C']);
      expect(tabs.map((t) => t.dayKey)).toEqual(['A', 'B', 'C']);
      // the caption the tab bar has always shown, over the day's own label
      expect(tabs.map((t) => t.title)).toEqual(DAY_ORDER.map((k) => PROGRAM[k].day));
      expect(tabs.map((t) => t.subtitle)).toEqual(DAY_ORDER.map((k) => PROGRAM[k].label));
      expect(tabs.map((t) => t.weekday)).toEqual([null, null, null]);
    }
  });

  it('keeps a v1-migrated plan at three tabs too (it inherits the routing map)', () => {
    const v1 = { version: 1, rev: 3, days: { A: PROGRAM.A, B: PROGRAM.B, C: PROGRAM.C } };
    const tabs = tabsOf(normalizePlanDoc(v1));
    expect(tabs.map((t) => t.viewId)).toEqual(['A', 'B', 'C']);
    expect(tabs.map((t) => t.title)).toEqual(['ראשון', 'שלישי', 'חמישי']);
  });

  it('gives a day with no weekdays one tab, titled by its own caption', () => {
    const plan = abPlan();
    for (const d of plan.days) delete d.weekdays;
    const tabs = tabsOf(plan);
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.viewId)).toEqual(['d_alef', 'd_bet']);
    expect(tabs.map((t) => t.title)).toEqual(["חלק א'", "חלק ב'"]);
    expect(tabs.map((t) => t.weekday)).toEqual([null, null]);
  });

  it('mixes scheduled and unscheduled days: the week first, the rest after it', () => {
    const plan = abPlan();
    plan.days[0]!.weekdays = [2, 4];
    delete plan.days[1]!.weekdays;
    const tabs = tabsOf(plan);
    expect(tabs.map((t) => t.viewId)).toEqual(['d_alef@2', 'd_alef@4', 'd_bet']);
    expect(tabs.map((t) => t.title)).toEqual(['שלישי', 'חמישי', "חלק ב'"]);
  });

  it('keeps the PLAIN day key for a day trained once a week', () => {
    const plan = abPlan();
    plan.days[0]!.weekdays = [1];
    plan.days[1]!.weekdays = [5];
    const tabs = tabsOf(plan);
    // one occurrence each — nothing to disambiguate, so no `@` is minted…
    expect(tabs.map((t) => t.viewId)).toEqual(['d_alef', 'd_bet']);
    // …but the tab is still titled by its weekday, because this IS a schedule
    expect(tabs.map((t) => t.title)).toEqual(['שני', 'שישי']);
  });

  it('reuses the routing-map predicate rather than a second notion of it', () => {
    expect(isBuiltInWeekdayMap(defaultPlanDoc().days)).toBe(true);
    expect(isBuiltInWeekdayMap(resolveProgram(null).days)).toBe(true);
    expect(isBuiltInWeekdayMap(abPlan().days)).toBe(false);
    // the moment a user edits the built-in map, it is a real schedule again
    const edited = defaultPlanDoc();
    edited.days[0]!.weekdays = [0];
    expect(isBuiltInWeekdayMap(edited.days)).toBe(false);
    expect(scheduleTabs(resolveProgram(edited))).toHaveLength(6);
  });
});

describe('view ids', () => {
  function weekday(wd: number): Date {
    const d = new Date(Date.UTC(2025, 0, 5 + wd, 12));
    expect(d.getDay()).toBe(wd);
    return d;
  }

  it('strips the occurrence off any view id', () => {
    expect(viewDayKey('A')).toBe('A');
    expect(viewDayKey('d_alef')).toBe('d_alef');
    expect(viewDayKey('d_alef@3')).toBe('d_alef');
    expect(viewDayKey('d_alef@')).toBe('d_alef');
  });

  it('accepts both shapes a stored view has ever had, and refuses the rest', () => {
    const program = resolveProgram(abPlan());
    expect(isTabView(program, 'd_alef@0')).toBe(true);
    expect(isTabView(program, 'd_alef')).toBe(true); // stored before this feature
    expect(isTabView(program, 'd_gone')).toBe(false);
    expect(isTabView(program, 'd_alef@6')).toBe(false); // not a weekday it trains
    expect(isTabView(program, '')).toBe(false);
    expect(isTabView(program, 42)).toBe(false);
    // the built-in program answers to its three keys and to nothing composed
    expect(isTabView(resolveProgram(null), 'A')).toBe(true);
    expect(isTabView(resolveProgram(null), 'A@0')).toBe(false);
  });

  it('resolves a bare day key onto TODAY’s occurrence of that day', () => {
    const program = resolveProgram(abPlan());
    expect(resolveTab(program, 'd_alef', weekday(3))?.viewId).toBe('d_alef@3');
    expect(resolveTab(program, 'd_alef', weekday(2))?.viewId).toBe('d_alef@0'); // first one
    expect(resolveTab(program, 'd_alef@0', weekday(3))?.viewId).toBe('d_alef@0'); // exact wins
    expect(resolveTab(program, 'd_gone', weekday(0))).toBeNull();
  });
});

describe('defaultTabView', () => {
  function weekday(wd: number): Date {
    const d = new Date(Date.UTC(2025, 0, 5 + wd, 12));
    expect(d.getDay()).toBe(wd);
    return d;
  }

  it('reproduces the legacy mapping for the built-in program', () => {
    const expected = ['A', 'A', 'B', 'B', 'C', 'C', 'C'];
    for (let wd = 0; wd < 7; wd += 1) expect(defaultTabView(null, weekday(wd))).toBe(expected[wd]);
  });

  it('opens on the occurrence scheduled for today', () => {
    const plan = abPlan(); // א on Sun+Wed, ב on Tue+Thu
    expect(defaultTabView(plan, weekday(0))).toBe('d_alef@0');
    expect(defaultTabView(plan, weekday(3))).toBe('d_alef@3');
    expect(defaultTabView(plan, weekday(2))).toBe('d_bet@2');
    expect(defaultTabView(plan, weekday(4))).toBe('d_bet@4');
    // rest days: nothing is scheduled, so the app opens on the first tab
    for (const wd of [1, 5, 6]) expect(defaultTabView(plan, weekday(wd))).toBe('d_alef@0');
  });

  it('follows the plan day when there is no schedule to follow', () => {
    const plan = abPlan();
    for (const d of plan.days) delete d.weekdays;
    for (let wd = 0; wd < 7; wd += 1) expect(defaultTabView(plan, weekday(wd))).toBe('d_alef');
  });
});

/* -------------------------------------------------- leaving the routing map */

describe('leaving the routing map — the A/B/C ranges collapse to the weekdays that name them', () => {
  /** The built-in plan plus a treadmill day on Wednesday — exactly the user's plan. */
  function withCardioDay(): PlanDoc {
    const doc = defaultPlanDoc();
    doc.days.push({
      key: 'd_cardio',
      label: 'אירובי',
      weekdays: [3],
      exercises: [{ id: 'x21', sets: 12, reps: '5 דק׳', rest: 300 }],
    });
    return doc;
  }

  it('collapseRoutingRanges: A → ראשון, B → שלישי, C → חמישי; nothing else is touched', () => {
    const doc = withCardioDay();
    expect(collapseRoutingRanges(doc.days)).toBe(true);
    expect(doc.days.map((d) => d.weekdays)).toEqual([[0], [2], [4], [3]]);
    // idempotent
    expect(collapseRoutingRanges(doc.days)).toBe(false);
    // a built-in day already on a schedule of its own is not a range any more
    const own = defaultPlanDoc();
    own.days[0]!.weekdays = [0, 5];
    expect(collapseRoutingRanges(own.days)).toBe(true); // B and C collapsed…
    expect(own.days[0]!.weekdays).toEqual([0, 5]); // …A kept what the user set
    // a user-minted day is never a range, whatever weekdays it carries
    const ab = abPlan();
    expect(collapseRoutingRanges(ab.days)).toBe(false);
  });

  it('turns four days into four tabs and a target of four — not seven', () => {
    const doc = withCardioDay();
    // the misreading this fixes: the raw ranges taken literally — seven
    // weekdays, and eight tabs, since B's range and the new day both claim רביעי
    expect(deriveWeeklyTarget(doc.days)).toBe(7);
    expect(scheduleTabs(resolveProgram(doc))).toHaveLength(8);
    collapseRoutingRanges(doc.days);
    doc.weeklyTarget = deriveWeeklyTarget(doc.days);
    expect(doc.weeklyTarget).toBe(4);
    const tabs = scheduleTabs(resolveProgram(doc));
    expect(tabs.map((t) => [t.viewId, t.title])).toEqual([
      ['A', 'ראשון'],
      ['B', 'שלישי'],
      ['d_cardio', 'רביעי'],
      ['C', 'חמישי'],
    ]);
  });

  it('normalizePlanDoc repairs a document saved half-way out of the map, target included', () => {
    const doc = withCardioDay();
    doc.weeklyTarget = 7; // what the old build derived and saved
    const read = normalizePlanDoc(JSON.parse(JSON.stringify(doc)));
    expect(read?.days.map((d) => d.weekdays)).toEqual([[0], [2], [4], [3]]);
    expect(read?.weeklyTarget).toBe(4);
    expect(read?.days[3]?.exercises[0]?.sets).toBe(12);
    // …and a plan that IS the routing map is read back byte for byte
    const plain = normalizePlanDoc(JSON.parse(JSON.stringify(defaultPlanDoc())));
    expect(plain).toEqual(defaultPlanDoc());
    expect(isBuiltInWeekdayMap(plain?.days ?? [])).toBe(true);
  });

  it('leaves ONE lone range alone — it may be a schedule the user meant', () => {
    const doc = withCardioDay();
    doc.days[1]!.weekdays = [2];
    doc.days[2]!.weekdays = [5];
    doc.weeklyTarget = 5;
    const read = normalizePlanDoc(JSON.parse(JSON.stringify(doc)));
    expect(read?.days[0]?.weekdays).toEqual([0, 1]);
    expect(read?.weeklyTarget).toBe(5);
  });
});

/* ------------------------------------------------------------ the stage cap */

describe('maxSetsOf — a cardio ladder counts stages, and needs more than ten', () => {
  it('caps a lift at 10 and a cardio exercise at 24', () => {
    expect(maxSetsOf(findExercise('a1'))).toBe(10);
    expect(maxSetsOf(findExercise('x21'))).toBe(24);
    expect(maxSetsOf(null)).toBe(10);
  });

  it('normalizePlanDoc keeps 12 stages, clamps 30 to 24, and still clamps a lift to 10', () => {
    const doc = defaultPlanDoc();
    doc.days[0]!.exercises[0]!.sets = 12; // a1
    doc.days.push({
      key: 'd_c',
      label: 'קרדיו',
      exercises: [{ id: 'x21', sets: 12, reps: '5 דק׳', rest: 300 }],
    });
    doc.days.push({
      key: 'd_d',
      label: 'קרדיו ארוך',
      exercises: [{ id: 'x21', sets: 30, reps: '5 דק׳', rest: 300 }],
    });
    const read = normalizePlanDoc(JSON.parse(JSON.stringify(doc)));
    expect(read?.days[0]?.exercises[0]?.sets).toBe(10);
    expect(read?.days[3]?.exercises[0]?.sets).toBe(12);
    expect(read?.days[4]?.exercises[0]?.sets).toBe(24);
  });

  it('validatePlanDoc accepts 24 stages and refuses 25, naming stages rather than sets', () => {
    const doc = defaultPlanDoc();
    doc.days.push({ key: 'd_c', label: 'קרדיו', exercises: [{ id: 'x21', sets: 24, reps: '5 דק׳', rest: 300 }] });
    expect(validatePlanDoc(doc)).toEqual([]);
    doc.days[3]!.exercises[0]!.sets = 25;
    const errors = validatePlanDoc(doc);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('השלבים');
    expect(errors[0]).toContain('24');
    // a lift still says sets, and still stops at ten
    doc.days[3]!.exercises[0]!.sets = 6;
    doc.days[0]!.exercises[0]!.sets = 11;
    expect(validatePlanDoc(doc)[0]).toContain('הסטים');
  });
});

/* -------------------------------------------------- the derived weekly target */

describe('deriveWeeklyTarget', () => {
  function withWeekdays(...map: number[][]): PlanDay[] {
    return map.map((weekdays, i) => ({
      key: `d_${i}`,
      label: `יום ${i}`,
      weekdays,
      exercises: [{ id: 'a1', sets: 3, reps: '8', rest: 60 }],
    }));
  }

  it('counts the DISTINCT weekdays a plan claims', () => {
    // the A/B split this feature exists for: two days, four weekdays, target 4
    expect(deriveWeeklyTarget(withWeekdays([0, 3], [2, 4]))).toBe(4);
    expect(assignedWeekdays(withWeekdays([0, 3], [2, 4]))).toEqual([0, 2, 3, 4]);
    expect(deriveWeeklyTarget(withWeekdays([1], [3], [5]))).toBe(3);
    expect(deriveWeeklyTarget(withWeekdays([0, 1, 2, 3, 4, 5, 6]))).toBe(7);
  });

  it('falls back to one workout per day, capped at three, with no schedule', () => {
    expect(deriveWeeklyTarget(withWeekdays([]))).toBe(1);
    expect(deriveWeeklyTarget(withWeekdays([], []))).toBe(2);
    expect(deriveWeeklyTarget(withWeekdays([], [], []))).toBe(3);
    // a six-day plan with no weekdays assigned still asks for three, not six
    expect(deriveWeeklyTarget(withWeekdays([], [], [], [], [], []))).toBe(3);
  });

  it('reads the built-in A/B/C ranges as ROUTING, not as seven training days', () => {
    // [0,1] / [2,3] / [4,5,6] covers the whole week with three workouts — it is
    // the map that picks the default tab, and it must keep meaning "3".
    const doc = defaultPlanDoc();
    expect(assignedWeekdays(doc.days)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(deriveWeeklyTarget(doc.days)).toBe(3);
    expect(doc.weeklyTarget).toBe(3);
    // …but the moment the user edits that map it is a real schedule again
    const edited = clonePlanDoc(doc);
    edited.days[0]!.weekdays = [0];
    expect(deriveWeeklyTarget(edited.days)).toBe(6);
  });

  it('always lands inside 1–7 and ignores junk weekdays', () => {
    const days = withWeekdays([0, 0, 9, -2, 3]);
    expect(deriveWeeklyTarget(days)).toBe(2);
    expect(assignedWeekdays(days)).toEqual([0, 3]);
    expect(deriveWeeklyTarget([])).toBe(1);
  });
});

/* -------------------------------------------------------------- supersets */

/**
 * SUPERSETS live in the PLAN and nowhere else.
 *
 * The properties that matter here are the ones the workout screen and the
 * merge rest on: a pair is two ADJACENT exercises of the same day, an exercise
 * belongs to at most one pair, an illegal pair is DROPPED on the way in (a
 * document from another device must still open) and REFUSED on the way out (a
 * save from the editor must never silently lose a link), and a payload written
 * before the field existed still folds — which is what makes the whole feature
 * additive: no new event type, no state version.
 */
describe('supersets', () => {
  /** Day A of the built-in program with its first two exercises linked. */
  function paired(): { doc: PlanDoc; day: PlanDay; a: string; b: string; c: string } {
    const doc = defaultPlanDoc();
    const day = pday(doc, 'A');
    const a = day.exercises[0]?.id ?? '';
    const b = day.exercises[1]?.id ?? '';
    const c = day.exercises[2]?.id ?? '';
    day.supersets = [[a, b]];
    return { doc, day, a, b, c };
  }

  it('is absent by default — the built-in program has no supersets at all', () => {
    const doc = defaultPlanDoc();
    for (const day of doc.days) {
      expect(day.supersets).toBeUndefined();
      expect(supersetPairs(day)).toEqual([]);
    }
    expect(JSON.stringify(planToRecord(doc))).not.toContain('supersets');
  });

  it('answers the two questions the workout screen asks: pairs, and who is my partner', () => {
    const { day, a, b, c } = paired();
    expect(supersetPairs(day)).toEqual([[a, b]]);
    expect(supersetPartner(day, a)).toBe(b);
    expect(supersetPartner(day, b)).toBe(a);
    expect(supersetPartner(day, c)).toBeNull();
    expect(supersetPartner(null, a)).toBeNull();
    expect(supersetPairOf(day, b)).toEqual([a, b]);
    expect(supersetPairOf(day, c)).toBeNull();
    expect(isSuperset(day, a)).toBe(true);
    expect(isSuperset(day, c)).toBe(false);
  });

  it('keeps only pairs that are adjacent, present, in order and unclaimed', () => {
    const rows = ['x1', 'x2', 'x3', 'x4'].map((id) => ({ id, sets: 3, reps: '10', rest: 90 }));
    expect(legalPairs([['x1', 'x2']], rows)).toEqual([['x1', 'x2']]);
    expect(legalPairs([['x1', 'x2'], ['x3', 'x4']], rows)).toEqual([['x1', 'x2'], ['x3', 'x4']]);
    // not adjacent
    expect(legalPairs([['x1', 'x3']], rows)).toEqual([]);
    // adjacent but backwards — the pair is ORDERED, first then second
    expect(legalPairs([['x2', 'x1']], rows)).toEqual([]);
    // an id this day does not have
    expect(legalPairs([['x1', 'nope']], rows)).toEqual([]);
    // one exercise cannot be in two pairs: the first claim wins, the rest go
    expect(legalPairs([['x1', 'x2'], ['x2', 'x3']], rows)).toEqual([['x1', 'x2']]);
    // junk of every shape
    expect(legalPairs([['x1', 'x1']], rows)).toEqual([]);
    expect(legalPairs(undefined, rows)).toEqual([]);
    expect(legalPairs([['x1'] as unknown as readonly [string, string]], rows)).toEqual([]);
  });

  it('survives the JSON round trip of a real document, pair and all', () => {
    const { doc, a, b } = paired();
    const back = normalizePlanDoc(JSON.parse(JSON.stringify(planToRecord(doc))) as unknown);
    expect(back).not.toBeNull();
    expect(supersetPairs(pday(back as PlanDoc, 'A'))).toEqual([[a, b]]);
  });

  it('DROPS an illegal pair on the way in instead of refusing the document', () => {
    const { doc, a, c } = paired();
    // a document from another device (or a hand-edited blob) claiming a pair
    // across a gap: the plan still opens, it simply has no link.
    pday(doc, 'A').supersets = [[a, c]];
    const back = normalizePlanDoc(planToRecord(doc));
    expect(back).not.toBeNull();
    expect(pday(back as PlanDoc, 'A').supersets).toBeUndefined();
    expect(pday(back as PlanDoc, 'A').exercises).toHaveLength(pday(doc, 'A').exercises.length);
  });

  it('drops a pair whose row was removed, and keeps the surviving half', () => {
    const { doc, a, b } = paired();
    const day = pday(doc, 'A');
    day.exercises = day.exercises.filter((r) => r.id !== b);
    const back = normalizePlanDoc(planToRecord(doc));
    expect(pday(back as PlanDoc, 'A').supersets).toBeUndefined();
    expect(pday(back as PlanDoc, 'A').exercises.some((r) => r.id === a)).toBe(true);
  });

  it('folds a payload that predates the field — no supersets, no key', () => {
    const raw = planToRecord(defaultPlanDoc()) as { days: unknown[] };
    // exactly what an older client wrote: days with no `supersets` at all
    expect(JSON.stringify(raw)).not.toContain('supersets');
    const back = normalizePlanDoc(raw);
    expect(back).not.toBeNull();
    for (const day of (back as PlanDoc).days) expect(day.supersets).toBeUndefined();
  });

  it('clones deeply — a pair of the clone is not a pair of the original', () => {
    const { doc, a, b } = paired();
    const copy = clonePlanDoc(doc);
    expect(supersetPairs(pday(copy, 'A'))).toEqual([[a, b]]);
    pday(copy, 'A').supersets = [];
    expect(supersetPairs(pday(doc, 'A'))).toEqual([[a, b]]);
  });

  it('counts as an unsaved change, and stops counting once saved', () => {
    const { doc } = paired();
    expect(planIsDirty(doc, null)).toBe(true);
    const store = new LocalStore(fakeStorage());
    const res = savePlan(store, doc);
    expect(res.ok).toBe(true);
    // the key ORDER has to round-trip too: `planIsDirty` compares JSON
    expect(planIsDirty(store.getState().plan as PlanDoc, store.getState().plan)).toBe(false);
  });

  /* ------------------------------------------------------------ validation */

  it('validates an adjacent pair and refuses every other kind', () => {
    const { doc, a, b, c } = paired();
    expect(validatePlanDoc(doc)).toEqual([]);

    const gap = clonePlanDoc(doc);
    pday(gap, 'A').supersets = [[a, c]];
    expect(validatePlanDoc(gap).join(' ')).toContain('סמוכים');

    const missing = clonePlanDoc(doc);
    pday(missing, 'A').supersets = [[a, 'nope']];
    expect(validatePlanDoc(missing).join(' ')).toContain('שאינו ביום הזה');

    const twice = clonePlanDoc(doc);
    pday(twice, 'A').supersets = [[a, b], [b, c]];
    expect(validatePlanDoc(twice).join(' ')).toContain('סופר־סט אחד');
  });

  it('refuses to SAVE an invalid pair and appends no event', () => {
    const { doc, a, c } = paired();
    pday(doc, 'A').supersets = [[a, c]];
    const store = new LocalStore(fakeStorage());
    const res = savePlan(store, doc);
    expect(res.ok).toBe(false);
    expect(store.getEvents().filter((e) => e.type === 'plan_updated')).toHaveLength(0);
    expect(store.getState().plan).toBeNull();
  });

  /* ------------------------------------------------------------- the fold */

  it('travels in the plan_updated payload and folds back out of the log', () => {
    const { doc, a, b } = paired();
    const store = new LocalStore(fakeStorage());
    const res = savePlan(store, doc);
    expect(res.ok).toBe(true);
    expect(supersetPairs(pday(store.getState().plan as PlanDoc, 'A'))).toEqual([[a, b]]);

    const folded = planFromEvents(store.getEvents());
    expect(supersetPairs(pday(folded as PlanDoc, 'A'))).toEqual([[a, b]]);
    // …and the generic replay agrees with the plan-only fold, as always
    const replayed = rebuildFromEvents(store.getEvents());
    expect(JSON.stringify(replayed.plan)).toBe(JSON.stringify(store.getState().plan));
  });

  it('is last-writer-wins like any other plan edit, in both merge orders', () => {
    const { doc, a, b } = paired();
    const linked = eventOf('plan_updated', 1000, 'e1', { plan: planToRecord(doc) });
    const unlinked = eventOf('plan_updated', 2000, 'e2', { plan: planToRecord(defaultPlanDoc()) });
    expect(pday(planFromEvents([linked, unlinked]) as PlanDoc, 'A').supersets).toBeUndefined();
    expect(pday(planFromEvents([unlinked, linked]) as PlanDoc, 'A').supersets).toBeUndefined();
    // the other way round, the link is what stands
    const later = eventOf('plan_updated', 3000, 'e3', { plan: planToRecord(doc) });
    for (const log of [[unlinked, later], [later, unlinked]]) {
      expect(supersetPairs(pday(planFromEvents(log) as PlanDoc, 'A'))).toEqual([[a, b]]);
    }
  });

  it('reaches the workout screen through resolveProgram unchanged', () => {
    // The resolved program is exercises only — the linkage stays in the plan,
    // which is exactly why the built-in program can never have one.
    const { doc, a, b } = paired();
    const program = resolveProgram(doc);
    const day = rday(program, 'A');
    expect(day.exercises[0]?.id).toBe(a);
    expect(day.exercises[1]?.id).toBe(b);
    expect(supersetPairs(planDay(doc, 'A'))).toEqual([[a, b]]);
    expect(supersetPairs(planDay(null, 'A'))).toEqual([]);
  });
});
