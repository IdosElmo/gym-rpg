/**
 * data/presets.ts — ready-made plans ("תוכניות מוכנות").
 *
 * A preset is a COMPLETE `PlanDoc`, not a template: picking one in the editor
 * replaces the draft outright, and saving it is an ordinary `plan_updated`
 * event. There is no third kind of plan in the model — a preset is simply a
 * document somebody already filled in.
 *
 * DAY KEYS ARE MINTED PER PICK
 * ----------------------------
 * `build()` calls `newDayKey()`, so two users who pick the same preset get two
 * different day keys, and picking it twice on two devices does not silently
 * merge the two into one day. It also means a preset never RE-USES `A`/`B`/`C`:
 * sessions logged under the old days keep pointing at the old keys, and the
 * history screen resolves those through `dayLabelOf` instead of being relabelled
 * under a program the user did not train them with.
 *
 * The rows point at BUILT-IN exercise ids only (`data/program.ts`, program +
 * library), so a preset carries no custom exercises and inherits every future
 * improvement to the coaching copy.
 */

import { defaultPlanDoc, deriveWeeklyTarget, makePlanDay, newDayKey } from '../core/plan.ts';
import { PLAN_DOC_VERSION, type PlanDay, type PlanDoc, type PlanExercise } from './planTypes.ts';

/** One entry of the "תוכניות מוכנות" sheet. */
export interface PlanPreset {
  /** Stable id — what the picker's button carries. */
  readonly id: string;
  /** Hebrew name shown in the sheet. */
  readonly name: string;
  /** One line: who it is for and how it is trained. */
  readonly description: string;
  /** Number of workout days, for the card. Asserted against `build()` in tests. */
  readonly days: number;
  /** A fresh, complete document — safe to hand straight to the draft. */
  readonly build: () => PlanDoc;
}

/** Rest, in seconds: compounds get the long rest, isolation the short one. */
const COMPOUND_REST = 90;
const ISOLATION_REST = 60;

function row(id: string, sets: number, reps: string, rest: number): PlanExercise {
  return { id, sets, reps, rest };
}

function day(label: string, weekdays: number[], exercises: PlanExercise[]): PlanDay {
  // Built through THE day constructor, because `planIsDirty` compares documents
  // as JSON and JSON keeps insertion order — a day assembled here by hand would
  // serialise differently from the same day after a save round-trip.
  return makePlanDay(newDayKey(), label, weekdays, exercises);
}

/** Wrap days into a document, with the target DERIVED from the weekday map. */
function docOf(days: PlanDay[]): PlanDoc {
  return {
    version: PLAN_DOC_VERSION,
    rev: 0,
    days,
    weeklyTarget: deriveWeeklyTarget(days),
    customExercises: [],
  };
}

/**
 * The user's own A/B split: two workouts alternated over four weekdays.
 * ראשון + רביעי = חלק א׳, שלישי + חמישי = חלק ב׳ — hence a weekly target of 4
 * from two days, which is exactly what PlanDoc v2 exists to express.
 */
function abFourDays(): PlanDoc {
  return docOf([
    day('חלק א׳ — רגליים, חזה, כתפיים ויד אחורית', [0, 3], [
      row('x1', 4, '8–10', COMPOUND_REST), // סקוואט בסמית׳
      row('c2', 4, '10', COMPOUND_REST), // דדליפט רומני
      row('x2', 4, '10–12', ISOLATION_REST), // פשיטת ברכיים
      row('x3', 4, '12', ISOLATION_REST), // כפיפת ברכיים
      row('b1', 4, '10', COMPOUND_REST), // לחיצת חזה שטוחה
      row('c3', 4, '8–10', COMPOUND_REST), // לחיצת כתפיים בישיבה
      row('x4', 3, '12', ISOLATION_REST), // הרחקה לצדדים
      row('x5', 4, '12', ISOLATION_REST), // פשיטת מרפקים בפולי
    ]),
    day('חלק ב׳ — גב ויד קדמית', [2, 4], [
      row('b2', 4, '12', COMPOUND_REST), // פולי עליון רחב
      row('x6', 4, '10', COMPOUND_REST), // פולי עליון אחיזה צרה
      row('b4', 4, '10', COMPOUND_REST), // חתירה בסמית׳ / משקולות
      row('a2', 3, '12', COMPOUND_REST), // חתירה חד־זרועית
      row('x7', 3, '15', ISOLATION_REST), // פייס פול
      row('x8', 3, '15–20', ISOLATION_REST), // הרמת שכמות
      row('a5', 3, '12', ISOLATION_REST), // כפיפת מרפקים
      row('x9', 3, '10', ISOLATION_REST), // פטישים
    ]),
  ]);
}

export const PLAN_PRESETS: readonly PlanPreset[] = [
  {
    id: 'builtin3',
    name: 'היפרטרופיה 3 ימים',
    description: 'התוכנית המקורית של האפליקציה: A/B/C, כל הגוף על פני שלושה אימונים בשבוע.',
    days: 3,
    build: defaultPlanDoc,
  },
  {
    id: 'ab4',
    name: 'תוכנית A/B — 4 ימים',
    description: 'שני אימונים שמתחלפים על פני ארבעה ימים: ראשון ורביעי חלק א׳, שלישי וחמישי חלק ב׳.',
    days: 2,
    build: abFourDays,
  },
];

export function presetById(id: string): PlanPreset | null {
  return PLAN_PRESETS.find((p) => p.id === id) ?? null;
}
