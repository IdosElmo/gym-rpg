/**
 * The goal-based plan library: 30 templates (days 2–6 × gym / home with
 * dumbbells / no equipment × men's / women's variation), the modifiers a
 * profile applies when a plan is built, and the recommendation that maps a
 * questionnaire onto a template.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPOUND_IDS,
  LIBRARY_DAYS,
  LIBRARY_LOCATIONS,
  LIBRARY_SEXES,
  LIBRARY_WEEKDAYS,
  PLAN_TEMPLATES,
  equipAllowed,
  libraryId,
  templateById,
  templateFor,
  type LibraryDays,
  type PlanTemplate,
} from '../src/data/planLibrary.ts';
import {
  BEGINNER_MAX_EXERCISES,
  INJURY_AVOID,
  INJURY_SWAPS,
  applyExperience,
  applyGoal,
  applyInjuries,
  applySessionLength,
  buildLibraryPlan,
  isCompound,
  libraryRows,
  maxExercisesFor,
  planOptionsOf,
  trimRows,
  withReps,
  type LibraryRowDraft,
} from '../src/core/planLibrary.ts';
import { ALL_PRESETS, LIBRARY_PRESETS, PLAN_PRESETS, buildPresetFor, presetById } from '../src/data/presets.ts';
import { BODY_PARTS, findExercise, isCardio, type BodyPart } from '../src/data/program.ts';
import { defaultPlanDoc, deriveWeeklyTarget, normalizePlanDoc, planToRecord, validatePlanDoc } from '../src/core/plan.ts';
import { INJURIES, onWeekdays, recommendPreset, type Location, type Profile, type Sex } from '../src/core/profile.ts';
import { setLocale } from '../src/i18n/locale.ts';
import { finishOnboarding } from '../src/core/onboarding.ts';
import { startPreset } from '../src/ui/planChoice.ts';
import { setProfile } from '../src/core/profile.ts';
import { LocalStore } from '../src/storage/LocalStore.ts';
import { rebuildFromEvents, type StorageLike } from '../src/storage/migrate.ts';
import type { PlanDoc, PlanExercise } from '../src/data/planTypes.ts';

afterEach(() => setLocale('he'));

const HEBREW = /[֐-׿]/;
const ALL_IDS = ALL_PRESETS.map((p) => p.id);

/** Weighted sets per body part over a week of rows (the XP engine's own split). */
function volume(days: readonly (readonly PlanExercise[])[]): Record<BodyPart, number> {
  const acc = Object.fromEntries(BODY_PARTS.map((b) => [b, 0])) as Record<BodyPart, number>;
  for (const rows of days) {
    for (const r of rows) {
      const ex = findExercise(r.id);
      if (!ex) throw new Error(`unknown ${r.id}`);
      const split = ex.split ?? { [ex.bodyPart]: 1 };
      for (const [bp, w] of Object.entries(split)) acc[bp as BodyPart] += r.sets * (w ?? 0);
    }
  }
  return acc;
}

const authoredRows = (t: PlanTemplate): PlanExercise[][] =>
  t.week.map((d) => d.rows.map(([id, sets, reps, rest]) => ({ id, sets, reps, rest })));

/** A plan's documents compared without the minted day keys. */
const keyless = (doc: PlanDoc): unknown => ({ ...doc, days: doc.days.map(({ key: _k, ...rest }) => rest) });

const draftRows = (...rows: Array<[string, number, string, number]>): LibraryRowDraft[] =>
  rows.map(([id, sets, reps, rest]) => ({ id, sets, reps, rest }));

/* ================================================================ data */

describe('the 30 templates', () => {
  it('cover days 2–6 × three locations × two variations, once each, by stable id', () => {
    expect(PLAN_TEMPLATES).toHaveLength(30);
    expect(new Set(PLAN_TEMPLATES.map((t) => t.id)).size).toBe(30);
    for (const days of LIBRARY_DAYS) {
      for (const loc of LIBRARY_LOCATIONS) {
        for (const sex of LIBRARY_SEXES) {
          const t = templateFor(days, loc, sex);
          expect(t.id).toBe(`lib_${days}_${loc}_${sex}`);
          expect(templateById(t.id)).toBe(t);
          expect([t.days, t.location, t.sex]).toEqual([days, loc, sex]);
        }
      }
    }
    expect(templateById('lib_7_gym_m')).toBeNull();
  });

  it('have the split their day count promises, labelled in Hebrew and English', () => {
    const expected: Record<LibraryDays, { he: string[]; en: string[] }> = {
      2: { he: ['פול באדי A', 'פול באדי B'], en: ['Full Body A', 'Full Body B'] },
      3: { he: ['פול באדי A', 'פול באדי B', 'פול באדי C'], en: ['Full Body A', 'Full Body B', 'Full Body C'] },
      4: { he: ['עליון A', 'תחתון A', 'עליון B', 'תחתון B'], en: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] },
      5: { he: ['עליון', 'תחתון', 'דחיפה', 'משיכה', 'רגליים'], en: ['Upper', 'Lower', 'Push', 'Pull', 'Legs'] },
      6: {
        he: ['דחיפה A', 'משיכה A', 'רגליים A', 'דחיפה B', 'משיכה B', 'רגליים B'],
        en: ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'],
      },
    };
    for (const t of PLAN_TEMPLATES) {
      expect(t.week).toHaveLength(t.days);
      expect(t.week.map((d) => d.he)).toEqual(expected[t.days].he);
      expect(t.week.map((d) => d.en)).toEqual(expected[t.days].en);
      for (const d of t.week) {
        expect(d.he).toMatch(HEBREW);
        expect(d.en).not.toMatch(HEBREW);
      }
    }
  });

  it('name only built-in exercises, each obeying the location’s equipment rule', () => {
    for (const t of PLAN_TEMPLATES) {
      for (const d of t.week) {
        for (const [id] of d.rows) {
          const ex = findExercise(id);
          expect(ex, `${t.id}: ${id}`).not.toBeNull();
          if (!ex) continue;
          expect(equipAllowed(t.location, ex.equip), `${t.id}: ${id} (${ex.equip.join('/')})`).toBe(true);
          if (t.location === 'home_none') expect(ex.equip).toContain('Bodyweight');
          expect(isCardio(ex)).toBe(false);
        }
      }
    }
  });

  it('author 5–7 exercises a day, compounds first, sensible sets / reps / rest, no repeats in a day', () => {
    for (const t of PLAN_TEMPLATES) {
      for (const d of t.week) {
        expect(d.rows.length, `${t.id} ${d.en}`).toBeGreaterThanOrEqual(5);
        expect(d.rows.length, `${t.id} ${d.en}`).toBeLessThanOrEqual(7);
        const ids = d.rows.map((r) => r[0]);
        expect(new Set(ids).size).toBe(ids.length);
        const firstIso = d.rows.findIndex(([id]) => !COMPOUND_IDS.has(id));
        const lastCompound = d.rows.map(([id]) => COMPOUND_IDS.has(id)).lastIndexOf(true);
        expect(lastCompound, `${t.id} ${d.en}: a compound after an isolation`).toBeLessThan(firstIso === -1 ? Infinity : firstIso);
        expect(COMPOUND_IDS.has(d.rows[0]?.[0] ?? '')).toBe(true);
        for (const [id, sets, reps, rest] of d.rows) {
          expect(sets).toBeGreaterThanOrEqual(3);
          expect(sets).toBeLessThanOrEqual(4);
          expect(reps).toMatch(/^\d/);
          if (COMPOUND_IDS.has(id)) expect(rest, `${t.id} ${id}`).toBeGreaterThanOrEqual(60);
          else expect(rest, `${t.id} ${id}`).toBeLessThanOrEqual(60);
          if (reps.includes('שנ׳')) expect(findExercise(id)?.unit).toBe('שניות');
        }
      }
    }
  });

  it('train every body part every week', () => {
    for (const t of PLAN_TEMPLATES) {
      const v = volume(authoredRows(t));
      for (const bp of BODY_PARTS) expect(v[bp], `${t.id} ${bp}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('the women’s variation differs and carries more legs / glutes; the men’s more chest, shoulders and arms', () => {
    for (const days of LIBRARY_DAYS) {
      for (const loc of LIBRARY_LOCATIONS) {
        const m = templateFor(days, loc, 'm');
        const f = templateFor(days, loc, 'f');
        expect(JSON.stringify(f.week)).not.toBe(JSON.stringify(m.week));
        expect(f.week.map((d) => d.en)).toEqual(m.week.map((d) => d.en)); // same skeleton
        const vm = volume(authoredRows(m));
        const vf = volume(authoredRows(f));
        expect(vf.legs, `${days} ${loc}`).toBeGreaterThan(vm.legs);
        expect(vm.chest + vm.shoulders + vm.arms, `${days} ${loc}`).toBeGreaterThan(vf.chest + vf.shoulders + vf.arms);
        // the glute work the women's version is about
        const glute = ['g6', 'g11', 'g12', 'h5', 'h12', 'w3'];
        const gluteSets = (t: PlanTemplate): number =>
          t.week.flatMap((d) => d.rows).reduce((s, [id, sets]) => s + (glute.includes(id) ? sets : 0), 0);
        expect(gluteSets(f), `${days} ${loc}`).toBeGreaterThan(gluteSets(m));
      }
    }
  });
});

/* ============================================================ building */

describe('buildLibraryPlan', () => {
  it('builds every template into a valid, normalisation-stable document', () => {
    for (const t of PLAN_TEMPLATES) {
      const doc = buildLibraryPlan(t.id);
      expect(validatePlanDoc(doc), t.id).toEqual([]);
      expect(normalizePlanDoc(JSON.parse(JSON.stringify(planToRecord(doc))))).toEqual(doc);
      expect(doc.days).toHaveLength(t.days);
      expect(doc.weeklyTarget).toBe(t.days);
      expect(doc.weeklyTarget).toBe(deriveWeeklyTarget(doc.days));
      expect(doc.days.map((d) => d.weekdays)).toEqual(LIBRARY_WEEKDAYS[t.days].map((w) => [w]));
      expect(doc.customExercises).toEqual([]);
      expect(new Set(doc.days.map((d) => d.key)).size).toBe(t.days);
      for (const d of doc.days) expect(d.key).toMatch(/^d_[0-9a-f]{8}$/);
    }
  });

  it('as authored (build muscle, intermediate, no limits) it is the template, row for row', () => {
    for (const t of PLAN_TEMPLATES) {
      const doc = buildLibraryPlan(t.id, { goal: 'build_muscle', experience: 'intermediate' });
      expect(doc.days.map((d) => d.exercises)).toEqual(authoredRows(t));
    }
  });

  it('builds the day labels in the language on screen — Hebrew by default, English in English', () => {
    expect(buildLibraryPlan('lib_4_gym_f').days.map((d) => d.label)).toEqual(['עליון A', 'תחתון A', 'עליון B', 'תחתון B']);
    setLocale('en');
    expect(buildLibraryPlan('lib_4_gym_f').days.map((d) => d.label)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(buildLibraryPlan('lib_6_home_none_m').days.map((d) => d.label)).toEqual([
      'Push A',
      'Pull A',
      'Legs A',
      'Push B',
      'Pull B',
      'Legs B',
    ]);
    // the rows (and their Hebrew scheme words) are the same in either language
    setLocale('he');
    const he = buildLibraryPlan('lib_3_home_dumbbells_f').days.map((d) => d.exercises);
    setLocale('en');
    expect(buildLibraryPlan('lib_3_home_dumbbells_f').days.map((d) => d.exercises)).toEqual(he);
  });

  it('lays the days on the user’s own weekdays when given', () => {
    const doc = buildLibraryPlan('lib_3_gym_m', { weekdays: [1, 3, 5] });
    expect(doc.days.map((d) => d.weekdays)).toEqual([[1], [3], [5]]);
    expect(doc.weeklyTarget).toBe(3);
    const one = buildLibraryPlan('lib_2_gym_m', { weekdays: [4] });
    expect(one.days.flatMap((d) => d.weekdays ?? [])).toEqual([4]);
    expect(one.weeklyTarget).toBe(1);
    const seven = buildLibraryPlan('lib_6_gym_m', { weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(seven.days.flatMap((d) => d.weekdays ?? []).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(seven.weeklyTarget).toBe(7);
    expect(validatePlanDoc(seven)).toEqual([]);
  });

  it('every combination of profile options still builds a valid plan inside the location’s equipment', () => {
    const goals = ['lose_fat', 'build_muscle', 'recomp', 'strength', 'general', 'other', undefined] as const;
    const exps = ['beginner', 'intermediate', 'advanced', undefined] as const;
    for (const t of PLAN_TEMPLATES) {
      for (const goal of goals) {
        for (const experience of exps) {
          for (const sessionMinutes of [30, 60, undefined]) {
            for (const injuries of [[], ['back', 'knees', 'shoulders']] as const) {
              const opts = {
                ...(goal ? { goal } : {}),
                ...(experience ? { experience } : {}),
                ...(sessionMinutes ? { sessionMinutes } : {}),
                injuries,
              };
              const rows = libraryRows(t, opts);
              for (const day of rows) {
                expect(day.length).toBeGreaterThanOrEqual(4);
                for (const r of day) {
                  const ex = findExercise(r.id);
                  expect(ex).not.toBeNull();
                  if (ex && !r.finisher) expect(equipAllowed(t.location, ex.equip), `${t.id} ${r.id}`).toBe(true);
                  if (ex && r.finisher) expect(t.location === 'gym' || ex.equip.includes('Bodyweight')).toBe(true);
                }
                expect(new Set(day.map((r) => r.id)).size).toBe(day.length);
              }
            }
          }
        }
      }
      const doc = buildLibraryPlan(t.id, {
        goal: 'lose_fat',
        experience: 'advanced',
        sessionMinutes: 45,
        injuries: ['back', 'knees', 'shoulders'],
      });
      expect(validatePlanDoc(doc), t.id).toEqual([]);
    }
  });
});

/* ============================================================ modifiers */

describe('goal modifiers', () => {
  const gymDay = (): LibraryRowDraft[] =>
    draftRows(['g1', 4, '6–8', 120], ['x28', 3, '8–10 לרגל', 90], ['g7', 3, '10–12', 90], ['x3', 3, '10–12', 60], ['b5', 3, '45–60 שנ׳', 60]);

  it('strength: the first two compounds go to 4–6 reps, 150 s, one set more; the rest is untouched', () => {
    const out = applyGoal(gymDay(), 'strength', { location: 'gym', dayIndex: 0 });
    expect(out).toEqual(
      draftRows(['g1', 5, '4–6', 150], ['x28', 4, '4–6 לרגל', 150], ['g7', 3, '10–12', 90], ['x3', 3, '10–12', 60], ['b5', 3, '45–60 שנ׳', 60]),
    );
  });

  it('strength: a bodyweight-only compound keeps its reps and earns the set only; pull-ups and dips go heavy', () => {
    const out = applyGoal(draftRows(['x30', 4, '10–15', 60], ['b2', 3, '8–10', 90], ['w6', 3, '8–12', 75]), 'strength', {
      location: 'home_none',
      dayIndex: 0,
    });
    expect(out).toEqual(draftRows(['x30', 5, '10–15', 60], ['b2', 4, '4–6', 150], ['w6', 3, '8–12', 75]));
  });

  it('withReps swaps the number range and keeps the unit words', () => {
    expect(withReps('8–10', '4–6')).toBe('4–6');
    expect(withReps('10 לרגל', '4–6')).toBe('4–6 לרגל');
    expect(withReps('10–12 לצד', '4–6')).toBe('4–6 לצד');
    expect(withReps('עד כשל', '4–6')).toBe('4–6');
  });

  it('lose fat / recomp: isolation rests −15 s (never below 45), compounds untouched, a treadmill finisher at the gym', () => {
    for (const goal of ['lose_fat', 'recomp'] as const) {
      const out = applyGoal(gymDay(), goal, { location: 'gym', dayIndex: 0 });
      expect(out.slice(0, 3)).toEqual(gymDay().slice(0, 3));
      expect(out[3]?.rest).toBe(45);
      expect(out[4]?.rest).toBe(45);
      const fin = out[5];
      expect(out).toHaveLength(6);
      expect(fin).toEqual({ id: 'x21', sets: 3, reps: '5 דק׳', rest: 300, finisher: true });
      // the cardio row keeps its own semantics: stages, and rest = stage length in seconds
      expect(isCardio(findExercise('x21'))).toBe(true);
      expect(fin?.rest).toBe(findExercise('x21')?.rest);
    }
    const kept = applyGoal(draftRows(['g1', 3, '6–8', 120], ['w10', 3, '45–60 שנ׳', 45]), 'lose_fat', { location: 'gym', dayIndex: 0 });
    expect(kept[1]?.rest).toBe(45);
  });

  it('lose fat at home: jumping jacks and mountain climbers alternate, 3 × 30–45 s; sore knees get no jumps', () => {
    const day = draftRows(['w1', 3, '15–20', 60], ['w3', 3, '15–20', 45]);
    const fin = (dayIndex: number, injuries: ('knees' | 'back')[] = []): LibraryRowDraft | undefined =>
      applyGoal(day, 'lose_fat', { location: 'home_none', dayIndex, injuries }).at(-1);
    expect(fin(0)).toEqual({ id: 'w10', sets: 3, reps: '30–45 שנ׳', rest: 30, finisher: true });
    expect(fin(1)?.id).toBe('w8');
    expect(fin(2)?.id).toBe('w10');
    expect(fin(0, ['knees'])?.id).toBe('w8');
    expect(fin(0, ['back'])?.id).toBe('w10');
    expect(applyGoal(day, 'recomp', { location: 'home_dumbbells', dayIndex: 1 }).at(-1)?.id).toBe('w8');
    // an exercise already in the day is never added twice
    const withW10 = draftRows(['w1', 3, '15–20', 60], ['w10', 3, '45–60 שנ׳', 45]);
    expect(applyGoal(withW10, 'lose_fat', { location: 'home_none', dayIndex: 0 }).at(-1)?.id).toBe('w8');
  });

  it('general / other: isolations lose a set (never below 2); compounds keep theirs', () => {
    for (const goal of ['general', 'other'] as const) {
      const out = applyGoal(draftRows(['g1', 4, '6–8', 120], ['x3', 3, '10–12', 60], ['x13', 2, '30–45 שנ׳', 60]), goal, {
        location: 'gym',
        dayIndex: 0,
      });
      expect(out.map((r) => r.sets)).toEqual([4, 2, 2]);
    }
  });

  it('build muscle (and no goal) leaves the day as authored', () => {
    expect(applyGoal(gymDay(), 'build_muscle', { location: 'gym', dayIndex: 0 })).toEqual(gymDay());
    expect(applyGoal(gymDay(), undefined, { location: 'gym', dayIndex: 0 })).toEqual(gymDay());
  });
});

describe('experience modifiers', () => {
  const seven = (): LibraryRowDraft[] =>
    draftRows(
      ['g1', 4, '6–8', 120],
      ['g3', 4, '6–8', 120],
      ['x15', 3, '8–10', 90],
      ['x4', 3, '12–15', 60],
      ['x3', 3, '10–12', 60],
      ['g7', 3, '10–12', 90],
      ['a6', 3, '10–12', 60],
    );

  it('beginner: every row at most 3 sets, at most 5 exercises — trailing isolations go first', () => {
    const out = applyExperience(seven(), 'beginner');
    expect(out.map((r) => r.id)).toEqual(['g1', 'g3', 'x15', 'x4', 'g7']);
    expect(out.every((r) => r.sets <= 3)).toBe(true);
  });

  it('beginner: the finisher is never dropped', () => {
    const fin: LibraryRowDraft = { id: 'x21', sets: 3, reps: '5 דק׳', rest: 300, finisher: true };
    const out = applyExperience([...seven(), fin], 'beginner');
    expect(out).toHaveLength(BEGINNER_MAX_EXERCISES);
    expect(out.at(-1)).toEqual(fin);
  });

  it('advanced: one more set on the day’s first compound only', () => {
    const out = applyExperience(draftRows(['x4', 3, '12–15', 60], ['g1', 4, '6–8', 120], ['g3', 4, '6–8', 120]), 'advanced');
    expect(out.map((r) => r.sets)).toEqual([3, 5, 4]);
    expect(applyExperience(seven(), 'intermediate')).toEqual(seven());
  });
});

describe('session length', () => {
  it('30 → 4, 45 → 5, 60 → 6, 75 → 7, 90 → 8 exercises', () => {
    expect([30, 45, 60, 75, 90].map(maxExercisesFor)).toEqual([4, 5, 6, 7, 8]);
    expect(maxExercisesFor(20)).toBe(4);
    expect(maxExercisesFor(120)).toBe(8);
    expect(maxExercisesFor(undefined)).toBe(Infinity);
  });

  it('caps every day of a built plan, the finisher counting and kept', () => {
    for (const t of PLAN_TEMPLATES) {
      for (const [minutes, cap] of [[30, 4], [45, 5], [60, 6]] as const) {
        const rows = libraryRows(t, { goal: 'lose_fat', sessionMinutes: minutes });
        for (const day of rows) {
          expect(day.length).toBeLessThanOrEqual(cap);
          expect(day.at(-1)?.finisher).toBe(true);
        }
      }
    }
  });

  it('drops the last isolation first, then the last compound', () => {
    const rows = draftRows(['g1', 3, '6–8', 120], ['x3', 3, '10–12', 60], ['g3', 3, '6–8', 120], ['x4', 3, '12–15', 60]);
    expect(trimRows(rows, 3).map((r) => r.id)).toEqual(['g1', 'x3', 'g3']);
    expect(trimRows(rows, 2).map((r) => r.id)).toEqual(['g1', 'g3']);
    expect(trimRows(rows, 1).map((r) => r.id)).toEqual(['g1']);
    expect(applySessionLength(rows, undefined)).toEqual(rows);
  });
});

describe('injuries', () => {
  it('the substitution table only offers exercises the location allows, never a flagged one', () => {
    const flagged = new Set(Object.values(INJURY_AVOID).flat());
    for (const loc of LIBRARY_LOCATIONS) {
      for (const id of flagged) {
        const cands = INJURY_SWAPS[loc][id];
        expect(cands?.length, `${loc}: ${id}`).toBeGreaterThan(0);
        for (const c of cands ?? []) {
          const ex = findExercise(c);
          expect(ex, c).not.toBeNull();
          if (ex) expect(equipAllowed(loc, ex.equip), `${loc}: ${id} → ${c}`).toBe(true);
          expect(flagged.has(c), `${loc}: ${id} → ${c} is itself flagged`).toBe(false);
        }
      }
    }
  });

  it('every template, every injury: the flagged exercises are gone, the equipment rule holds, the day keeps its size', () => {
    for (const t of PLAN_TEMPLATES) {
      for (const injury of INJURIES) {
        const rows = libraryRows(t, { injuries: [injury] });
        rows.forEach((day, i) => {
          for (const r of day) {
            expect(INJURY_AVOID[injury]).not.toContain(r.id);
            const ex = findExercise(r.id);
            if (ex) expect(equipAllowed(t.location, ex.equip)).toBe(true);
          }
          expect(day.length, `${t.id} ${injury}`).toBe(t.week[i]?.rows.length);
        });
      }
      const all = libraryRows(t, { injuries: ['back', 'knees', 'shoulders'] }).flat();
      const flagged = new Set(Object.values(INJURY_AVOID).flat());
      expect(all.some((r) => flagged.has(r.id))).toBe(false);
    }
  });

  it('swaps in the first acceptable alternative, keeping the set count and taking the exercise’s own scheme', () => {
    const back = applyInjuries(draftRows(['g2', 3, '6–8', 120], ['g4', 4, '8–10', 120], ['g6', 3, '8–12', 90]), 'gym', ['back']);
    // g2 → g6 is taken by the day already, so the leg press; g4 → chest-supported row
    expect(back.map((r) => r.id)).toEqual(['g7', 'x18', 'g6']);
    expect(back[0]).toEqual({ id: 'g7', sets: 3, reps: findExercise('g7')?.reps, rest: findExercise('g7')?.rest });
    expect(back[1]?.sets).toBe(4);

    const knees = applyInjuries(draftRows(['w2', 3, '10 לרגל', 75], ['x28', 3, '8–10 לרגל', 90]), 'home_none', ['knees']);
    expect(knees.map((r) => r.id)).toEqual(['w3', 'w13']);

    const shoulders = applyInjuries(draftRows(['c3', 3, '10–12', 90], ['b3', 3, '8–12', 90]), 'gym', ['shoulders']);
    expect(shoulders.map((r) => r.id)).toEqual(['g8', 'x12']);
    const homeShoulders = applyInjuries(draftRows(['h2', 3, '8–10', 90], ['w7', 3, '10–15', 60]), 'home_dumbbells', ['shoulders']);
    expect(homeShoulders.map((r) => r.id)).toEqual(['x4', 'h8']);

    expect(applyInjuries(draftRows(['g2', 3, '6–8', 120]), 'gym', [])).toEqual(draftRows(['g2', 3, '6–8', 120]));
  });

  it('removes from the built plan exactly what was flagged', () => {
    const doc = buildLibraryPlan('lib_4_gym_m', { injuries: ['back'] });
    const ids = doc.days.flatMap((d) => d.exercises.map((r) => r.id));
    expect(ids).not.toContain('g2');
    expect(ids).not.toContain('g4');
    expect(ids).toContain('x18');
  });
});

describe('modifier order', () => {
  it('goal, then experience, then session length — a strength beginner keeps ≤ 3 sets', () => {
    const rows = libraryRows(templateFor(3, 'gym', 'm'), { goal: 'strength', experience: 'beginner' });
    for (const day of rows) {
      expect(day.length).toBeLessThanOrEqual(5);
      expect(day.every((r) => r.sets <= 3)).toBe(true);
      expect(day[0]?.reps).toBe('4–6');
      expect(day[0]?.rest).toBe(150);
    }
  });

  it('isCompound agrees with the data', () => {
    expect(isCompound('g1')).toBe(true);
    expect(isCompound('x4')).toBe(false);
  });

  it('planOptionsOf reads only what a plan needs', () => {
    const p: Profile = {
      name: 'נועה',
      sex: 'female',
      goal: 'lose_fat',
      experience: 'beginner',
      sessionMinutes: 45,
      injuries: ['knees'],
      weekdays: [0, 2, 4],
      location: 'gym',
      daysPerWeek: 3,
    };
    expect(planOptionsOf(p)).toEqual({ goal: 'lose_fat', experience: 'beginner', sessionMinutes: 45, injuries: ['knees'], weekdays: [0, 2, 4] });
    expect(planOptionsOf(null)).toEqual({});
    expect(planOptionsOf({ skipped: true })).toEqual({});
  });
});

/* ======================================================== the presets */

describe('the library as presets', () => {
  it('the originals stay first and unchanged; every template is a preset, findable by id', () => {
    expect(PLAN_PRESETS.map((p) => p.id)).toEqual(['builtin3', 'ab4']);
    expect(ALL_PRESETS.slice(0, 2)).toEqual([...PLAN_PRESETS]);
    expect(ALL_PRESETS).toHaveLength(32);
    expect(LIBRARY_PRESETS.map((p) => p.id)).toEqual(PLAN_TEMPLATES.map((t) => t.id));
    for (const p of ALL_PRESETS) expect(presetById(p.id)).toBe(p);
    for (const p of LIBRARY_PRESETS) {
      expect(p.days).toBe(p.build().days.length);
      expect(p.library).toBeDefined();
    }
  });

  it('names and describes every template in both languages, all 30 names distinct', () => {
    const he = LIBRARY_PRESETS.map((p) => [p.name, p.description]);
    expect(new Set(he.map(([n]) => n)).size).toBe(30);
    for (const [n, d] of he) {
      expect(n).toMatch(HEBREW);
      expect(d).toMatch(HEBREW);
    }
    expect(presetById('lib_3_gym_f')?.name).toBe('פול באדי · 3 ימים · חדר כושר · נשים');
    setLocale('en');
    expect(presetById('lib_3_gym_f')?.name).toBe('Full Body · 3 days · Gym · Women');
    for (const p of LIBRARY_PRESETS) {
      expect(p.name).not.toMatch(HEBREW);
      expect(p.description).not.toMatch(HEBREW);
    }
  });

  it('builtin3 and ab4 build byte-identically, whatever options they are handed', () => {
    const b3 = presetById('builtin3');
    const ab = presetById('ab4');
    if (!b3 || !ab) throw new Error('missing original preset');
    const opts = { goal: 'strength', experience: 'beginner', sessionMinutes: 30, injuries: ['back', 'knees', 'shoulders'] } as const;
    expect(b3.build()).toEqual(defaultPlanDoc());
    expect(b3.build(opts)).toEqual(defaultPlanDoc());
    expect(JSON.stringify(keyless(ab.build(opts)))).toBe(JSON.stringify(keyless(ab.build())));
    // built "for" a profile they are only laid on its weekdays
    const profile: Profile = { goal: 'lose_fat', experience: 'beginner', injuries: ['back'], weekdays: [1, 3, 5] };
    expect(buildPresetFor(b3, profile)).toEqual(onWeekdays(defaultPlanDoc(), [1, 3, 5]));
    expect(buildPresetFor(b3, null)).toEqual(defaultPlanDoc());
  });

  it('a library preset built for a profile takes its goal, experience, session length, injuries and weekdays', () => {
    const p = presetById('lib_3_gym_f');
    if (!p) throw new Error('no lib_3_gym_f');
    const doc = buildPresetFor(p, {
      sex: 'female',
      goal: 'lose_fat',
      experience: 'beginner',
      sessionMinutes: 45,
      injuries: ['knees'],
      weekdays: [1, 3, 5],
      location: 'gym',
      daysPerWeek: 3,
    });
    expect(validatePlanDoc(doc)).toEqual([]);
    expect(doc.days.map((d) => d.weekdays)).toEqual([[1], [3], [5]]);
    for (const d of doc.days) {
      expect(d.exercises.length).toBeLessThanOrEqual(5);
      expect(d.exercises.at(-1)?.id).toBe('x21');
      for (const r of d.exercises) {
        expect(r.sets).toBeLessThanOrEqual(3);
        expect(INJURY_AVOID.knees).not.toContain(r.id);
      }
    }
  });
});

/* ================================================== the recommendation */

describe('recommendPreset over the library', () => {
  const SEX_CASES: Array<Sex | undefined> = ['male', 'female', 'other', undefined];
  const LOC_CASES: Array<Location | undefined> = ['gym', 'home_dumbbells', 'home_none', undefined];

  it('maps every days × location × sex profile onto its template, with sensible alternatives', () => {
    for (let days = 1; days <= 7; days++) {
      for (const location of LOC_CASES) {
        for (const sex of SEX_CASES) {
          const profile: Profile = { daysPerWeek: days, ...(location ? { location } : {}), ...(sex ? { sex } : {}) };
          const d = Math.min(6, Math.max(2, days)) as LibraryDays;
          const loc = location ?? 'gym';
          const s = sex === 'female' ? 'f' : 'm';
          const rec = recommendPreset(profile, ALL_IDS);
          expect(rec.id, JSON.stringify(profile)).toBe(libraryId(d, loc, s));
          expect(rec.alternatives).not.toContain(rec.id);
          expect(new Set(rec.alternatives).size).toBe(rec.alternatives.length);
          for (const a of rec.alternatives) expect(presetById(a)).not.toBeNull();
          expect(rec.alternatives[0]).toBe(libraryId(d, loc, s === 'f' ? 'm' : 'f'));
          if (d > 2) expect(rec.alternatives).toContain(libraryId((d - 1) as LibraryDays, loc, s));
          if (d < 6) expect(rec.alternatives).toContain(libraryId((d + 1) as LibraryDays, loc, s));
          expect(rec.alternatives.includes('builtin3')).toBe(loc === 'gym' && d === 3);
          expect(rec.alternatives.includes('ab4')).toBe(loc === 'gym' && d === 4);
        }
      }
    }
  });

  it('reads the day count from the weekdays when there is no count', () => {
    expect(recommendPreset({ weekdays: [0, 2, 4, 6], location: 'home_none', sex: 'female' }, ALL_IDS).id).toBe('lib_4_home_none_f');
    expect(recommendPreset({ location: 'home_dumbbells' }, ALL_IDS).id).toBe('lib_3_home_dumbbells_m');
  });

  it('a profile with nothing a plan depends on (a skipped questionnaire) gets the original plan', () => {
    expect(recommendPreset({ skipped: true }, ALL_IDS)).toEqual({ id: 'builtin3', alternatives: ['ab4', 'lib_3_gym_m', 'lib_3_gym_f'] });
    expect(recommendPreset({ sex: 'female', goal: 'general' }, ALL_IDS).id).toBe('builtin3');
  });

  it('without the library in the list, the old two-plan rule still answers', () => {
    const ids = ['builtin3', 'ab4'];
    expect(recommendPreset({ daysPerWeek: 3, location: 'gym' }, ids).id).toBe('builtin3');
    expect(recommendPreset({ daysPerWeek: 5, location: 'gym' }, ids)).toEqual({ id: 'ab4', alternatives: ['builtin3'] });
  });
});

/* ======================================================== the callers */

describe('the callers build for the profile', () => {
  function store(): LocalStore {
    const map = new Map<string, string>();
    const s: StorageLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
    return new LocalStore(s);
  }
  const PROFILE: Profile = {
    sex: 'male',
    goal: 'lose_fat',
    experience: 'beginner',
    daysPerWeek: 3,
    weekdays: [1, 3, 5],
    location: 'home_none',
    sessionMinutes: 45,
  };

  it('finishing the questionnaire with a library plan saves it built for the answers', () => {
    const st = store();
    const rec = recommendPreset(PROFILE, ALL_IDS);
    expect(rec.id).toBe('lib_3_home_none_m');
    finishOnboarding(st, { profile: PROFILE }, { preset: rec.id }, {
      date: '2026-10-03',
      time: '08:30',
      weightId: 'w1',
      year: 2026,
      now: new Date(2026, 9, 3, 8, 30),
    });
    const plan = st.getState().plan;
    if (!plan) throw new Error('no plan saved');
    expect(plan.days.map((d) => d.label)).toEqual(['פול באדי A', 'פול באדי B', 'פול באדי C']);
    expect(plan.days.map((d) => d.weekdays)).toEqual([[1], [3], [5]]);
    for (const [i, d] of plan.days.entries()) {
      expect(d.exercises.length).toBeLessThanOrEqual(5);
      expect(d.exercises.at(-1)?.id).toBe(i % 2 === 0 ? 'w10' : 'w8');
      expect(d.exercises.every((r) => r.sets <= 3)).toBe(true);
    }
    expect(rebuildFromEvents(st.getEvents()).plan).toEqual(plan);
  });

  it('the empty-plan picker starts a library plan for the stored profile', () => {
    const st = store();
    setProfile(st, { ...PROFILE, goal: 'strength', experience: 'advanced', location: 'gym', sessionMinutes: 90 }, '2026-10-03');
    const p = startPreset(st, 'lib_3_gym_m', 1_000);
    expect(p?.id).toBe('lib_3_gym_m');
    const plan = st.getState().plan;
    expect(plan?.days[0]?.exercises[0]).toEqual({ id: 'g1', sets: 6, reps: '4–6', rest: 150 });
  });
});
