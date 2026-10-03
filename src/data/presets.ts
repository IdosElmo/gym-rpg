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
 *
 * LANGUAGE. A preset's name and description are presentation, read from the
 * catalog (`i18n/messages/plan.ts`) every time the picker draws them. The day
 * LABELS a preset builds are different: they become the user's plan the moment
 * it is saved, so they are built in the language on screen at the time of the
 * pick and are user content from then on (Hebrew is byte-identical to what
 * this file always built). The rep schemes stay the program's own Hebrew
 * words, like every built-in row: `repsText` renders them in either language,
 * so they keep translating after a later language switch. `builtin3` builds
 * `defaultPlanDoc` untouched — the original plan, whose built-in day names are
 * localized on display (`displayDayLabel`) — so picking it still IS the
 * original plan.
 */

import { defaultPlanDoc, deriveWeeklyTarget, makePlanDay, newDayKey } from '../core/plan.ts';
import { buildLibraryPlan, planOptionsOf, type LibraryBuildOptions } from '../core/planLibrary.ts';
import { onWeekdays, type Location, type Profile } from '../core/profile.ts';
import { PLAN_DOC_VERSION, type PlanDay, type PlanDoc, type PlanExercise } from './planTypes.ts';
import { PLAN_TEMPLATES, type LibraryDays, type LibrarySex, type PlanTemplate } from './planLibrary.ts';
import { tr } from '../i18n/locale.ts';
import { plan as P } from '../i18n/messages/plan.ts';
import { planLibrary as PL } from '../i18n/messages/planLibrary.ts';

/** One entry of the "תוכניות מוכנות" sheet. */
export interface PlanPreset {
  /** Stable id — what the picker's button carries. */
  readonly id: string;
  /** Name shown in the sheet, in the reader's language. */
  readonly name: string;
  /** One line: who it is for and how it is trained. */
  readonly description: string;
  /** Number of workout days, for the card. Asserted against `build()` in tests. */
  readonly days: number;
  /**
   * A fresh, complete document — safe to hand straight to the draft.
   *
   * A LIBRARY preset (`library` set) is built for the profile it is given:
   * goal, experience, session length, injuries and weekdays (see
   * core/planLibrary.ts). The two original plans ignore the options — they are
   * exactly what they always were.
   */
  readonly build: (opts?: LibraryBuildOptions) => PlanDoc;
  /** Where a library template sits in the grid; absent on the original plans. */
  readonly library?: { readonly days: LibraryDays; readonly location: Location; readonly sex: LibrarySex };
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
  const L = tr(P).preset.ab4;
  return docOf([
    day(L.dayA, [0, 3], [
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
    day(L.dayB1, [2], [
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
    day(L.dayB2, [4], [
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

// `name` / `description` are GETTERS: the catalog is read when the picker asks,
// so the sheet speaks whatever language is on screen (see docs/i18n.md).
export const PLAN_PRESETS: readonly PlanPreset[] = [
  {
    id: 'builtin3',
    get name() {
      return tr(P).preset.builtin3.name;
    },
    get description() {
      return tr(P).preset.builtin3.description;
    },
    days: 3,
    build: defaultPlanDoc,
  },
  {
    id: 'ab4',
    get name() {
      return tr(P).preset.ab4.name;
    },
    get description() {
      return tr(P).preset.ab4.description;
    },
    days: 3,
    build: abFourDays,
  },
];

/** One library template as a preset: name and description generated in the reader's language. */
function libraryPreset(t: PlanTemplate): PlanPreset {
  return {
    id: t.id,
    get name() {
      const L = tr(PL);
      return L.name(L.split[t.days], t.days, L.location[t.location], L.sex[t.sex]);
    },
    get description() {
      const L = tr(PL);
      return `${L.splitDesc[t.days]} ${L.locationDesc[t.location]} ${L.sexDesc[t.sex]}`;
    },
    days: t.week.length,
    build: (opts?: LibraryBuildOptions) => buildLibraryPlan(t.id, opts),
    library: { days: t.days, location: t.location, sex: t.sex },
  };
}

/**
 * The goal-based library (`data/planLibrary.ts`): 30 templates, days 2–6 ×
 * gym / home with dumbbells / no equipment × men's / women's variation.
 */
export const LIBRARY_PRESETS: readonly PlanPreset[] = PLAN_TEMPLATES.map(libraryPreset);

/**
 * EVERY ready-made plan: the two originals first, unchanged, then the library.
 * `PLAN_PRESETS` stays the originals only — the sheet's first group, and the
 * list the original plans' tests pin.
 */
export const ALL_PRESETS: readonly PlanPreset[] = [...PLAN_PRESETS, ...LIBRARY_PRESETS];

export function presetById(id: string): PlanPreset | null {
  return ALL_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Build `preset` for a user: a library plan with the profile's options (its
 * weekdays included); an original plan as it is, re-laid on the profile's
 * weekdays when they gave some.
 */
export function buildPresetFor(preset: PlanPreset, profile: Profile | null | undefined): PlanDoc {
  const opts = planOptionsOf(profile);
  if (preset.library) return preset.build(opts);
  const doc = preset.build();
  return opts.weekdays && opts.weekdays.length > 0 ? onWeekdays(doc, opts.weekdays) : doc;
}
