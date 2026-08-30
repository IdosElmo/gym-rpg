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
 * The user's own 4-day split: THREE workouts over four weekdays. אימון A
 * (legs, pushing and spinal decompression) is trained twice — ראשון ורביעי —
 * and the two back/pull days split the pull-up work between them: B1 (שלישי)
 * builds pull-up strength with assistance, B2 (חמישי) with slow negatives.
 * Hence a weekly target of 4 from three days, which is exactly what PlanDoc v2
 * exists to express.
 */
function abFourDays(): PlanDoc {
  return docOf([
    day('אימון A — רגליים, דחיפה ודקומפרסיה', [0, 3], [
      row('x11', 3, '8–10', COMPOUND_REST), // סקוואט גובלט
      row('c2', 3, '8–10', COMPOUND_REST), // דדליפט רומני
      row('x12', 3, '8–10', COMPOUND_REST), // לחיצת חזה עם משקולות
      row('c3', 3, '8–10', COMPOUND_REST), // לחיצת כתפיים בישיבה
      row('x2', 3, '10–12', ISOLATION_REST), // פשיטת ברכיים
      row('x3', 3, '10–12', ISOLATION_REST), // כפיפת ברכיים
      row('x4', 3, '12–15', ISOLATION_REST), // הרחקה לצדדים
      row('x5', 3, '10–12', ISOLATION_REST), // פשיטת מרפקים בפולי
      row('a6', 3, '10–12', ISOLATION_REST), // הרמות ברכיים בתלייה
      row('x13', 2, '30–45 שנ׳', ISOLATION_REST), // תלייה פסיבית
    ]),
    day('אימון B1 — גב ומשיכה · כוח למתח', [2], [
      row('x14', 4, '5–8', COMPOUND_REST), // מתח עם גומייה / גרביטון
      row('x15', 3, '8–10', COMPOUND_REST), // חתירה בפולי בישיבה
      row('b2', 3, '10–12', COMPOUND_REST), // פולי עליון אחיזה רחבה
      row('a2', 3, '10–12 לצד', COMPOUND_REST), // חתירה חד־זרועית עם משקולת
      row('x7', 3, '12–15', ISOLATION_REST), // פייס פול
      row('a5', 3, '10–12', ISOLATION_REST), // כפיפת מרפקים בסופינציה
      row('x9', 3, '10–12', ISOLATION_REST), // פטישים
      row('x16', 3, '10–12 לצד', ISOLATION_REST), // פאלוף פרס
      row('x13', 2, '30–45 שנ׳', ISOLATION_REST), // תלייה פסיבית
    ]),
    day('אימון B2 — גב ומשיכה · שליליות', [4], [
      row('x17', 4, '3–5', COMPOUND_REST), // מתח שלילי
      row('x18', 3, '8–10', COMPOUND_REST), // חתירה עם תמיכת חזה
      row('x19', 3, '10–12', COMPOUND_REST), // פולי עליון אחיזה רגילה
      row('x20', 3, '10–12 לצד', COMPOUND_REST), // חתירה חד־זרועית בפולי
      row('x7', 3, '12–15', ISOLATION_REST), // פייס פול עם רוטציה חיצונית
      row('a5', 3, '10–12', ISOLATION_REST), // כפיפת מרפקים
      row('x9', 3, '10–12', ISOLATION_REST), // פטישים
      row('b5', 3, '45–60 שנ׳', ISOLATION_REST), // פלאנק
      row('x13', 2, '30–45 שנ׳', ISOLATION_REST), // תלייה פסיבית
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
    description: 'ארבעה ימים, שלושה אימונים: ראשון ורביעי אימון A (רגליים ודחיפה), שלישי אימון B1 וחמישי אימון B2 (גב ומשיכה).',
    days: 3,
    build: abFourDays,
  },
];

export function presetById(id: string): PlanPreset | null {
  return PLAN_PRESETS.find((p) => p.id === id) ?? null;
}
