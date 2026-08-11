/**
 * The 3-day hypertrophy program.
 *
 * Ported VERBATIM from the legacy `legacy/index.html` PROGRAM object — every
 * Hebrew string, step, cue, mistake, rest time and unit is byte-identical.
 *
 * The only ADDITION is the `bodyPart` / `split` metadata (see BodyPart below),
 * which Phase 1 (XP + character) consumes. It changes no existing behaviour.
 */

/** The six trainable body parts of the RPG character. */
export type BodyPart = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';

export const BODY_PARTS: readonly BodyPart[] = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'] as const;

/** Hebrew labels for the body parts (used by the character screen in Phase 1). */
export const BODY_PART_HE: Readonly<Record<BodyPart, string>> = {
  chest: 'חזה',
  back: 'גב',
  legs: 'רגליים',
  shoulders: 'כתפיים',
  arms: 'ידיים',
  core: 'ליבה',
};

/**
 * XP split for exercises that meaningfully hit two parts.
 * Weights are fractions of the set's XP and always sum to 1.
 */
export type BodyPartSplit = Partial<Record<BodyPart, number>>;

export type EquipmentKey = 'Smith Machine' | 'Dumbbells' | 'Bodyweight' | 'Machine';

export interface Exercise {
  readonly id: string;
  /** Hebrew name (primary UI copy). */
  readonly he: string;
  /** English subtitle. */
  readonly en: string;
  readonly equip: readonly EquipmentKey[];
  readonly muscle: string;
  readonly sets: number;
  readonly reps: string;
  /** Recommended rest in seconds — drives the auto rest timer. */
  readonly rest: number;
  /** Unit of the second logged field ("חזרות" / "שניות" / "חזרות/רגל"). */
  readonly unit: string;
  readonly steps: readonly string[];
  readonly cue: string;
  readonly mistake: string;
  /** Primary body part fed by this exercise. */
  readonly bodyPart: BodyPart;
  /** Optional secondary split; when present it INCLUDES the primary part. */
  readonly split?: BodyPartSplit;
}

export type DayKey = 'A' | 'B' | 'C';

export interface Day {
  readonly day: string;
  readonly label: string;
  readonly dur: string;
  readonly focus: string;
  readonly exercises: readonly Exercise[];
}

/**
 * The three-day skeleton, resolved. `PROGRAM` is the built-in instance;
 * `core/plan.ts` produces another one from a user's `PlanDoc`. Every consumer
 * that used to reach for `PROGRAM` directly now takes one of these, defaulted
 * to `PROGRAM` so nothing changes until a plan exists.
 */
export type ProgramMap = Readonly<Record<DayKey, Day>>;

/**
 * Exercise lookup by id — `findExercise` for the built-ins, or a plan-aware
 * resolver (`makeResolver`) that also knows the user's custom exercises.
 * History and the feed need it because they show exercises by id, long after
 * the plan that contained them may have changed.
 */
export type ExerciseResolver = (exId: string) => Exercise | null;

export const PROGRAM: ProgramMap = {
  A: {
    day: 'ראשון',
    label: 'אימון A',
    dur: '~50 דק׳',
    focus: 'חזה עליון · גב רחב · רגליים · יד קדמית · בטן תחתונה',
    exercises: [
      {
        id: 'a1',
        he: 'לחיצת חזה בשיפוע חיובי',
        en: 'Incline Smith / Dumbbell Press',
        equip: ['Smith Machine', 'Dumbbells'],
        muscle: 'חזה עליון',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'כוונו ספסל לזווית ‎30°‎.',
          'כווצו שכמות לאחור והצמידו לספסל.',
          'הורידו את המוט/משקולות באיטיות (2–3 שניות) אל החזה העליון.',
          'דחפו בפיצוץ למעלה מבלי לנעול מרפקים.',
        ],
        cue: 'דחפו מרפקים מעט פנימה בדרך למעלה; שלטו במתיחה בתחתית.',
        mistake: 'טעות נפוצה: קשת גב מוגזמת או הורדת המוט לכיוון הבטן במקום לחזה העליון.',
        bodyPart: 'chest',
        split: { chest: 0.8, arms: 0.2 },
      },
      {
        id: 'a2',
        he: 'חתירה חד־זרועית (Hand Row)',
        en: 'One-Arm Dumbbell Row',
        equip: ['Dumbbells'],
        muscle: 'גב רחב ועובי גב',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'הניחו ברך ויד על ספסל שטוח.',
          'שמרו על גב ישר ומקביל לרצפה.',
          'משכו את המשקולת אל כיס המכנס (ירך).',
          'הורידו באיטיות עד מתיחה מלאה.',
        ],
        cue: 'משכו עם המרפק ולא עם היד הקדמית; הגו נשאר יציב לחלוטין.',
        mistake: "טעות נפוצה: סיבוב הגו כלפי מעלה כדי 'לעזור' למשיכה.",
        bodyPart: 'back',
        split: { back: 0.8, arms: 0.2 },
      },
      {
        id: 'a3',
        he: 'לאנג׳ים / מכרעים נייחים',
        en: 'Stationary Lunges / Split Squats',
        equip: ['Dumbbells'],
        muscle: 'ארבע־ראשי וישבן',
        sets: 3,
        reps: '10–12 לרגל',
        rest: 90,
        unit: 'חזרות/רגל',
        steps: [
          'החזיקו משקולות לצידי הגוף.',
          'צעד קדימה ועמידה יציבה.',
          'רדו אנכית עד שהברך האחורית כמעט נוגעת ברצפה.',
          'דחפו דרך העקב הקדמי חזרה למעלה.',
        ],
        cue: '‎70%‎ ממשקל הגוף על הרגל הקדמית; חזה זקוף לאורך כל התנועה.',
        mistake: 'טעות נפוצה: ברך קדמית קורסת פנימה או רכינה של הגו קדימה.',
        bodyPart: 'legs',
      },
      {
        id: 'a4',
        he: 'פרפר בשכיבה עם משקולות',
        en: 'Dumbbell Chest Flyes',
        equip: ['Dumbbells'],
        muscle: 'בידוד ומתיחת חזה',
        sets: 2,
        reps: '12–15',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'שכבו על ספסל שטוח, כיפוף קל במרפקים.',
          'פתחו ידיים לצדדים בקשת רחבה.',
          'עצרו כשמורגשת מתיחה בחזה — ללא כאב בכתף.',
          'כווצו את החזה והחזירו בקשת.',
        ],
        cue: 'דמיינו שאתם מחבקים גזע עץ רחב; מתיחה עמוקה בלי כאב בכתפיים.',
        mistake: 'טעות נפוצה: יישור המרפקים והפיכת התרגיל ללחיצה.',
        bodyPart: 'chest',
      },
      {
        id: 'a5',
        he: 'כפיפת מרפקים עם משקולות',
        en: 'Dumbbell Bicep Curls',
        equip: ['Dumbbells'],
        muscle: 'יד קדמית',
        sets: 3,
        reps: '10–12',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'בעמידה או בישיבה, מרפקים צמודים לצלעות.',
          'גלגלו את המשקולת מעלה בתנועה חלקה.',
          'סובבו את כף היד (סופינציה) תוך כדי עלייה.',
          'הורידו לאט ובשליטה מלאה.',
        ],
        cue: 'אפס נדנוד גוף; כווצו את היד הקדמית חזק בנקודה העליונה.',
        mistake: 'טעות נפוצה: נדנוד הגו ושימוש בתנופה במקום בשריר.',
        bodyPart: 'arms',
      },
      {
        id: 'a6',
        he: 'הרמות רגליים/ברכיים בתלייה או בשכיבה',
        en: 'Hanging / Lying Leg & Knee Raises',
        equip: ['Bodyweight'],
        muscle: 'בטן תחתונה',
        sets: 3,
        reps: '12–15',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'היתלו על מוט מתח או שכבו על ספסל.',
          'הרימו ברכיים/רגליים אל החזה.',
          'גלגלו את האגן מעט מעלה בסוף התנועה.',
          'הורידו לאט ללא נדנוד.',
        ],
        cue: 'גלגלו את האגן לכיוון החזה בנקודה העליונה של התנועה.',
        mistake: 'טעות נפוצה: נדנוד רגליים בתנופה במקום כפיפה מבוקרת של הבטן.',
        bodyPart: 'core',
      },
    ],
  },
  B: {
    day: 'שלישי',
    label: 'אימון B',
    dur: '~50 דק׳',
    focus: 'חזה מרכזי ותחתון · רוחב גב · עובי גב · ליבה עמוקה',
    exercises: [
      {
        id: 'b1',
        he: 'לחיצת חזה בשכיבה שטוחה בסמית׳',
        en: 'Flat Smith Bench Press',
        equip: ['Smith Machine'],
        muscle: 'חזה מרכזי',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'שכבו מתחת למכונת הסמית׳.',
          'שחררו את המוט והורידו בשליטה לאמצע עצם החזה.',
          'עצרו קלות ולחצו חזק למעלה.',
          'שמרו על כפות רגליים נטועות ברצפה.',
        ],
        cue: 'שכמות צמודות למטה ולאחור לאורך כל הסט.',
        mistake: 'טעות נפוצה: הקפצת המוט מהחזה או ניתוק שכמות מהספסל.',
        bodyPart: 'chest',
        split: { chest: 0.8, arms: 0.2 },
      },
      {
        id: 'b2',
        he: 'פולי עליון / מתח',
        en: 'Lat Pulldown / Pull-ups',
        equip: ['Bodyweight', 'Machine'],
        muscle: 'רוחב גב · V-Taper',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'אחיזה רחבה על המוט.',
          'משכו את המוט אל החזה העליון.',
          'הובילו את המרפקים מטה ולאחור.',
          'עלייה איטית חזרה עד מתיחה מלאה.',
        ],
        cue: 'הובילו עם המרפקים; החזה עולה לפגוש את המוט.',
        mistake: 'טעות נפוצה: משיכה עם הידיים הקדמיות ורכינה מוגזמת לאחור.',
        bodyPart: 'back',
        split: { back: 0.8, arms: 0.2 },
      },
      {
        id: 'b3',
        he: 'מקבילים',
        en: 'Dips',
        equip: ['Bodyweight'],
        muscle: 'חזה תחתון ויד אחורית',
        sets: 3,
        reps: 'עד כשל / RIR 1–2',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'תמכו את משקל הגוף על מוטות המקבילים.',
          'הטו את הגו קדימה כ־‎30°‎ לדגש חזה.',
          'רדו עד כיפוף ‎90°‎ במרפקים.',
          'דחפו חזרה למעלה בכוח.',
        ],
        cue: 'רכינה קדימה = דגש חזה; גו אנכי = דגש יד אחורית.',
        mistake: 'טעות נפוצה: ירידה עמוקה מדי שמעמיסה על הכתפיים.',
        bodyPart: 'chest',
        split: { chest: 0.7, arms: 0.3 },
      },
      {
        id: 'b4',
        he: 'חתירה בסמית׳ / משקולות',
        en: 'Smith Machine / Dumbbell Row',
        equip: ['Smith Machine', 'Dumbbells'],
        muscle: 'עובי גב עליון',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'כופפו ברכיים מעט והטו אגן לאחור לזווית ‎45°‎.',
          'גב ישר לחלוטין.',
          'משכו את המוט/משקולות אל הבטן התחתונה.',
          'הורידו באיטיות ובשליטה.',
        ],
        cue: 'כווצו את השכמות זו לזו בשיא הכיווץ.',
        mistake: 'טעות נפוצה: עיגול הגב התחתון או משיכה גבוהה מדי לחזה.',
        bodyPart: 'back',
        split: { back: 0.8, arms: 0.2 },
      },
      {
        id: 'b5',
        he: 'פלאנק (עם/בלי משקל)',
        en: 'Weighted / Bodyweight Plank',
        equip: ['Bodyweight'],
        muscle: 'ליבה עמוקה',
        sets: 3,
        reps: '45–60 שנ׳',
        rest: 60,
        unit: 'שניות',
        steps: [
          'אמות על המזרן, גוף בקו ישר אחד.',
          'כווצו ישבן חזק.',
          'משכו את הטבור פנימה לכיוון עמוד השדרה.',
          'נשמו באופן סדיר לאורך ההחזקה.',
        ],
        cue: 'אל תתנו לגב התחתון לשקוע; שמרו על גשר קשיח.',
        mistake: 'טעות נפוצה: הרמת ישבן גבוה מדי או שקיעת אגן.',
        bodyPart: 'core',
      },
    ],
  },
  C: {
    day: 'חמישי',
    label: 'אימון C',
    dur: '~50 דק׳',
    focus: 'חזה עליון (טווח מלא) · שרשרת אחורית · כתפיים · יד אחורית · בטן עליונה',
    exercises: [
      {
        id: 'c1',
        he: 'לחיצת חזה בשיפוע עם משקולות',
        en: 'Incline Dumbbell Bench Press',
        equip: ['Dumbbells'],
        muscle: 'חזה עליון · טווח תנועה מלא',
        sets: 3,
        reps: '10–12',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'ספסל בשיפוע ‎30°‎.',
          'הורידו משקולות עמוק — מתיחה גדולה יותר מהמוט.',
          'לחצו מעלה ומעט פנימה.',
          'שמרו על כתפיים משוכות לאחור.',
        ],
        cue: 'מתיחה מלאה בתחתית מבלי שהכתפיים מתגלגלות קדימה.',
        mistake: 'טעות נפוצה: הצמדת המשקולות בכוח למעלה ואיבוד מתח מהחזה.',
        bodyPart: 'chest',
        split: { chest: 0.8, arms: 0.2 },
      },
      {
        id: 'c2',
        he: 'דדליפט רומני (RDL)',
        en: 'Dumbbell / Smith Romanian Deadlift',
        equip: ['Dumbbells', 'Smith Machine'],
        muscle: 'ירך אחורית · ישבן · זוקפי גב',
        sets: 3,
        reps: '8–10',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'כיפוף קל וקבוע בברכיים.',
          'הטו אגן לאחור, גב שטוח לחלוטין.',
          'המשקולות צמודות לשוקיים לאורך הירידה.',
          'דחפו אגן קדימה לעמידה זקופה.',
        ],
        cue: 'דחפו את הישבן אחורה אל הקיר שמאחוריכם; עמוד שדרה ניטרלי לחלוטין.',
        mistake: 'טעות נפוצה: עיגול הגב או כיפוף ברכיים שהופך את התרגיל לסקוואט.',
        bodyPart: 'legs',
        split: { legs: 0.7, back: 0.3 },
      },
      {
        id: 'c3',
        he: 'לחיצת כתפיים בישיבה',
        en: 'Seated Dumbbell Shoulder Press',
        equip: ['Dumbbells'],
        muscle: 'כתף קדמית וצידית',
        sets: 3,
        reps: '10–12',
        rest: 90,
        unit: 'חזרות',
        steps: [
          'ספסל בזווית גבוהה ‎80–85°‎.',
          'התחילו עם המשקולות בגובה האוזניים.',
          'לחצו מעלה עד יישור ידיים מלא.',
          'הורידו בשליטה חזרה לגובה האוזניים.',
        ],
        cue: 'ליבה מכווצת; אל תקשתו את הגב התחתון מהספסל.',
        mistake: 'טעות נפוצה: קשת גב מוגזמת שהופכת את הלחיצה ללחיצת חזה עליון.',
        bodyPart: 'shoulders',
        split: { shoulders: 0.8, arms: 0.2 },
      },
      {
        id: 'c4',
        he: 'פשיטת מרפקים מעל הראש',
        en: 'Overhead Dumbbell Tricep Extension',
        equip: ['Dumbbells'],
        muscle: 'יד אחורית · הראש הארוך',
        sets: 3,
        reps: '10–12',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'בישיבה/עמידה, החזיקו משקולת אחת כבדה בשתי ידיים מעל הראש.',
          'כופפו מרפקים והורידו את המשקולת מאחורי הראש.',
          'פשטו את הידיים ישר למעלה.',
          'שמרו על מרפקים יציבים.',
        ],
        cue: 'מרפקים אסופים ופונים קדימה — לא נפתחים לצדדים.',
        mistake: 'טעות נפוצה: פתיחת מרפקים לצדדים והורדת עומס מהראש הארוך.',
        bodyPart: 'arms',
      },
      {
        id: 'c5',
        he: 'כפיפות בטן בשיפוע / עם משקל',
        en: 'Weighted / Incline Crunches',
        equip: ['Bodyweight', 'Dumbbells'],
        muscle: 'בטן עליונה',
        sets: 3,
        reps: '12–15',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'ספסל בשיפוע שלילי או מזרן, משקל קל על החזה.',
          'כופפו את עמוד השדרה — צלעות מתקרבות לאגן.',
          'עצרו בכיווץ מלא לשנייה.',
          'רדו לאט ובשליטה.',
        ],
        cue: 'תנועת גלגול של עמוד השדרה — לא משיכה עם הצוואר או כופפי הירך.',
        mistake: 'טעות נפוצה: משיכת הראש עם הידיים או עליית כל הגו ישר.',
        bodyPart: 'core',
      },
    ],
  },
};

export const DAY_ORDER: readonly DayKey[] = ['A', 'B', 'C'] as const;

export const DAY_NAMES: Readonly<Record<DayKey, string>> = {
  A: 'ראשון',
  B: 'שלישי',
  C: 'חמישי',
};

const EQUIP_HE: Readonly<Record<string, string>> = {
  'Smith Machine': 'סמית׳',
  Dumbbells: 'משקולות',
  Bodyweight: 'משקל גוף',
  Machine: 'מכונה',
};

/** Hebrew label for an equipment key (1:1 with the legacy `equipHe`). */
export function equipHe(e: string): string {
  return EQUIP_HE[e] ?? e;
}

export function isDayKey(v: unknown): v is DayKey {
  return v === 'A' || v === 'B' || v === 'C';
}

/** Find an exercise definition by id across all days (legacy history lookup). */
export function findExercise(exId: string): Exercise | null {
  for (const k of DAY_ORDER) {
    const found = PROGRAM[k].exercises.find((e) => e.id === exId);
    if (found) return found;
  }
  return null;
}

/**
 * Normalised body-part XP weights for an exercise: always sums to 1.
 * Phase 1 (`core/xp.ts`) multiplies a set's XP by these weights.
 */
export function bodyPartWeights(ex: Exercise): Readonly<Record<BodyPart, number>> {
  const out: Record<BodyPart, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0, core: 0 };
  if (ex.split) {
    let total = 0;
    for (const part of BODY_PARTS) {
      const w = ex.split[part];
      if (typeof w === 'number' && w > 0) {
        out[part] = w;
        total += w;
      }
    }
    if (total > 0) {
      for (const part of BODY_PARTS) out[part] = out[part] / total;
      return out;
    }
  }
  out[ex.bodyPart] = 1;
  return out;
}
