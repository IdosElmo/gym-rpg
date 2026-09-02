/**
 * The 3-day hypertrophy program.
 *
 * Ported from the legacy `legacy/index.html` PROGRAM object. The port was
 * VERBATIM; since then two kinds of deliberate changes exist, both guarded by
 * `tests/program.test.ts`:
 *   - APPENDED exercises (b6, c6) — the legacy exercises keep their order.
 *   - AMENDED coaching copy on a few legacy exercises (grip width on a1/b1,
 *     plank elbow position on b5, the curl's starting grip on a5, the row's
 *     bar path on b4) — technical fixes from an instruction audit against the
 *     MIT-licensed exercises-dataset; every amended field is enumerated in the
 *     test so nothing else can drift silently.
 *
 * The `bodyPart` / `split` metadata is an addition the game layer consumes.
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
  /**
   * Present on a CARDIO exercise — one whose "sets" are timed STAGES. Absent
   * (the overwhelming default) on every strength exercise. See `CardioSpec`.
   */
  readonly cardio?: CardioSpec;
}

/**
 * A CARDIO exercise, in the same row shape as everything else.
 *
 * The treadmill walk is the reason this exists: "every 5 minutes raise the
 * incline by one" is a ladder of equal stages, and a stage maps 1:1 onto what
 * the app already calls a set — a row with two numbers and a ✓. So a cardio
 * exercise changes NOTHING underneath: the same `set_completed` event, the same
 * XP grant, the same idempotency key and the same merge. What changes is what
 * the two numbers MEAN, and that is all this spec says:
 *
 *   - `sets`  → the number of stages;
 *   - `w`     → the stage's LOAD (incline %, level, speed…) instead of kilograms;
 *   - `r`     → the stage's LENGTH in minutes instead of repetitions;
 *   - `rest`  → the stage length in SECONDS: the timer that starts on ✓ counts
 *               the NEXT stage down — so the load goes up when it chimes — and
 *               the minutes field prefills from it.
 *
 * `setVolume` is unchanged, so a stage's volume is `load × minutes`: a higher
 * incline for the same five minutes IS the personal record, and the volume
 * factor rewards the ladder's top rung exactly the way it rewards a top set.
 * What a stage is NOT is tonnage — `core/stats.ts` keeps incline-minutes out
 * of the kilograms, because "you lifted 30 kg" would be a lie.
 */
export interface CardioSpec {
  /** Hebrew name of the load field — the column header, e.g. "שיפוע". */
  readonly loadLabel: string;
  /** Short unit of the load, printed right after the number: "%", "רמה", "קמ״ש". */
  readonly loadUnit: string;
  /** Load of the FIRST stage — what stage 1 prefills with when there is no history. */
  readonly loadStart: number;
  /** Load added per stage: stage `i` (0-based) suggests `loadStart + loadStep × i`. */
  readonly loadStep: number;
}

/**
 * Key of ONE workout day.
 *
 * It used to be the compile-time union `'A' | 'B' | 'C'` — the app had exactly
 * three days and nothing else was expressible. A plan now defines its OWN days
 * (1–7 of them), so the key is a plain string: `'A' | 'B' | 'C'` for the
 * built-in program (and for every plan document migrated from v1), `'d_' + a
 * uuid slice` for a day the user created.
 *
 * Persisted data therefore keeps working unchanged: an old `Session.day: 'A'`
 * or an old `set_completed` payload is still a perfectly valid day key. Nothing
 * anywhere may COERCE an unknown key back into 'A' — the string is the user's
 * data, and a screen that cannot resolve it degrades gracefully instead.
 */
export type DayKey = string;

/** The three days of the built-in program — the only keys that exist in CODE. */
export type BuiltInDayKey = 'A' | 'B' | 'C';

/**
 * View keys that are NOT workout days: דמות, קרב, ליגה, הגדרות, היסטוריה,
 * סטטיסטיקות, תזונה and the plan editor. They are reserved: a plan may not name
 * a day after one of them, or tapping the day would open the wrong screen.
 *
 * The list only ever GROWS. `NT` (🍽️ תזונה, the meal tracker and the first view
 * to bring a whole hub with it) is the newest entry — `LG` (🏆 הליגה) was the
 * one before it — and adding it takes nothing away: every key a build has ever
 * persisted is still exactly as valid as it was, and a plan that had already
 * minted a day called `NT` is impossible — `isDayKey` has refused reserved keys
 * since day one, and a key that arrives from another device is tolerated rather
 * than coerced (see below).
 */
export const RESERVED_VIEW_KEYS: readonly string[] = ['CH', 'BT', 'H', 'PL', 'ST', 'SS', 'LG', 'NT'] as const;

/** Longest day key we accept — long enough for `d_` + a uuid slice. */
export const MAX_DAY_KEY_LENGTH = 40;

export interface Day {
  readonly day: string;
  readonly label: string;
  readonly dur: string;
  readonly focus: string;
  readonly exercises: readonly Exercise[];
}

/**
 * ONE day of a resolved program: its stable key, its Hebrew label, the weekdays
 * it is trained on, and the fully resolved `Day` the workout screen renders.
 */
export interface ProgramDay {
  /** Stable key — what `Session.day`, the events and `UiState.view` carry. */
  readonly key: DayKey;
  /** Hebrew workout name, e.g. "אימון A" / "חלק א'". Mirrors `day.label`. */
  readonly label: string;
  /** Weekdays this day is trained on (0 = Sunday … 6 = Saturday). May be empty. */
  readonly weekdays: readonly number[];
  /** The resolved day: exercises + the header copy. */
  readonly day: Day;
}

/**
 * A program the app can render: an ORDERED list of days (that order IS the tab
 * order) plus the weekly training target the streak judges a week by.
 *
 * `PROGRAM` is the raw built-in data; `BUILTIN_PROGRAM` is it in this shape, and
 * `core/plan.ts#resolveProgram` produces one from a user's `PlanDoc`. Consumers
 * take a `ResolvedProgram` and look a day up with `dayOf` / `programDay`, which
 * both return `null` for a key the program does not have.
 */
export interface ResolvedProgram {
  readonly days: readonly ProgramDay[];
  /** Distinct training days per week that make a "perfect week" (1–7). */
  readonly weeklyTarget: number;
}

/**
 * Exercise lookup by id — `findExercise` for the built-ins, or a plan-aware
 * resolver (`makeResolver`) that also knows the user's custom exercises.
 * History and the feed need it because they show exercises by id, long after
 * the plan that contained them may have changed.
 */
export type ExerciseResolver = (exId: string) => Exercise | null;

/** The raw built-in data, by day letter. `BUILTIN_PROGRAM` wraps it for the app. */
export type BuiltInProgram = Readonly<Record<BuiltInDayKey, Day>>;

export const PROGRAM: BuiltInProgram = {
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
          'כווצו שכמות לאחור והצמידו לספסל; אחיזה מעט רחבה מרוחב הכתפיים.',
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
          'בעמידה או בישיבה, מרפקים צמודים לצלעות ואחיזה ניטרלית (אגודלים כלפי מעלה).',
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
          'שכבו מתחת למכונת הסמית׳ ואחזו את המוט מעט רחב מרוחב הכתפיים.',
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
          'משכו את המוט/משקולות אל תחתית עצם החזה, מרפקים בזווית ‎45°‎ מהגוף.',
          'הורידו באיטיות ובשליטה.',
        ],
        cue: 'כווצו את השכמות זו לזו בשיא הכיווץ.',
        mistake: 'טעות נפוצה: עיגול הגב התחתון או משיכה עם הידיים במקום עם המרפקים.',
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
          'אמות על המזרן, מרפקים בדיוק מתחת לכתפיים, גוף בקו ישר אחד.',
          'כווצו ישבן חזק.',
          'משכו את הטבור פנימה לכיוון עמוד השדרה.',
          'נשמו באופן סדיר לאורך ההחזקה.',
        ],
        cue: 'אל תתנו לגב התחתון לשקוע; שמרו על גשר קשיח.',
        mistake: 'טעות נפוצה: הרמת ישבן גבוה מדי או שקיעת אגן.',
        bodyPart: 'core',
      },
      {
        id: 'b6',
        he: 'קרוס־אובר בפולי',
        en: 'Cable Crossover',
        equip: ['Machine'],
        muscle: 'חזה מרכזי ותחתון · בידוד',
        sets: 3,
        reps: '12–15',
        rest: 60,
        unit: 'חזרות',
        steps: [
          'אחזו בידיות הפולי הגבוה, צעד קטן קדימה וגו נטוי מעט.',
          'כיפוף קל וקבוע במרפקים לאורך כל התנועה.',
          'הביאו את הידיים בקשת רחבה עד שהן נפגשות מול הבטן.',
          'החזירו לאט עד מתיחה מלאה בחזה.',
        ],
        cue: 'כווצו את החזה חזק בנקודת המפגש ועצרו לשנייה.',
        mistake: 'טעות נפוצה: כיפוף המרפקים והפיכת התרגיל ללחיצה במקום קשת.',
        bodyPart: 'chest',
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
      {
        id: 'c6',
        he: 'טוויסט רוסי עם משקל',
        en: 'Weighted Russian Twist',
        equip: ['Bodyweight', 'Dumbbells'],
        muscle: 'אלכסוני הבטן · חיטוב המותן',
        sets: 3,
        reps: '12–15 לצד',
        rest: 60,
        unit: 'חזרות/צד',
        steps: [
          'שבו על המזרן, ברכיים כפופות ועקבים קרובים לרצפה.',
          'הטו את הגו לאחור כ־45° ושמרו על גב ישר.',
          'החזיקו משקולת בשתי ידיים וסובבו את הגו מצד לצד.',
          'הובילו את הסיבוב מהצלעות — לא מהידיים.',
        ],
        cue: 'הצמידו סנטר קלות והביטו בעקבות הידיים; הסיבוב איטי ומבוקר.',
        mistake: 'טעות נפוצה: סיבוב מהיר עם הידיים בלבד בלי סיבוב אמיתי של הגו.',
        bodyPart: 'core',
      },
    ],
  },
};

/**
 * The exercise LIBRARY beyond the three built-in days.
 *
 * These are first-class built-in exercises — same shape, same coaching copy,
 * same `bodyPart` / `split` metadata — that simply do not appear in the default
 * A/B/C program. They exist so the plan editor (and the ready-made presets in
 * `data/presets.ts`) can offer a gym's usual machines without forcing the user
 * to re-type them as custom exercises, and so their XP, PRs and history behave
 * exactly like a program exercise's.
 *
 * They are kept OUT of `PROGRAM` on purpose: `tests/program.test.ts` diffs
 * `PROGRAM` against the legacy `legacy/index.html` literal byte for byte, and
 * that guarantee is worth more than the convenience of one flat object.
 * `findExercise` searches both, which is what makes an id here resolvable
 * everywhere (workout screen, previous performance, history, feed, XP).
 */
export const EXTRA_EXERCISES: readonly Exercise[] = [
  {
    id: 'x1',
    he: 'סקוואט בסמית׳ מאשין',
    en: 'Smith Machine Squat',
    equip: ['Smith Machine'],
    muscle: 'ארבע־ראשי · ישבן',
    sets: 4,
    reps: '8–10',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'הניחו את המוט על הטרפזים ועמדו ברוחב אגן.',
      'הציבו את כפות הרגליים מעט לפנים מקו המוט.',
      'רדו באיטיות עד שהירכיים מקבילות לרצפה.',
      'דחפו דרך אמצע כף הרגל חזרה למעלה בלי לנעול ברכיים.',
    ],
    cue: 'ברכיים בכיוון קצות האצבעות; חזה פתוח לאורך כל הירידה.',
    mistake: 'טעות נפוצה: קפיצה מהתחתית או הרמת עקבים מהרצפה.',
    bodyPart: 'legs',
  },
  {
    id: 'x2',
    he: 'פשיטת ברכיים במכשיר',
    en: 'Leg Extension Machine',
    equip: ['Machine'],
    muscle: 'ארבע־ראשי (בידוד)',
    sets: 4,
    reps: '10–12',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'כווננו את משענת הגב כך שהברך תשב על ציר המכשיר.',
      'אחזו בידיות והצמידו את הגב למשענת.',
      'פשטו את הברכיים עד יישור כמעט מלא.',
      'עצרו שנייה בכיווץ והורידו לאט.',
    ],
    cue: 'עצירה קצרה למעלה — שם הארבע־ראשי עובד הכי חזק.',
    mistake: 'טעות נפוצה: זריקת המשקל בתנופה והרמת הישבן מהמושב.',
    bodyPart: 'legs',
  },
  {
    id: 'x3',
    he: 'כפיפת ברכיים במכשיר',
    en: 'Leg Curl Machine',
    equip: ['Machine'],
    muscle: 'ירך אחורית',
    sets: 4,
    reps: '12',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'שכבו או שבו במכשיר כשהכרית מונחת מעל גיד אכילס.',
      'אחזו בידיות ושמרו על האגן צמוד לכרית.',
      'כופפו את הברכיים בכוח עד סוף הטווח.',
      'החזירו לאט ובשליטה בלי להרפות את המתח.',
    ],
    cue: 'האגן נשאר מוצמד — רק הברך זזה.',
    mistake: 'טעות נפוצה: הרמת האגן מהכרית כדי לסייע לתנועה.',
    bodyPart: 'legs',
  },
  {
    id: 'x4',
    he: 'הרחקה לצדדים עם משקולות',
    en: 'Dumbbell Lateral Raises',
    equip: ['Dumbbells'],
    muscle: 'כתף צידית',
    sets: 3,
    reps: '12–15',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'עמדו עם משקולות קלות לצידי הגוף, כיפוף קל במרפקים.',
      'הרימו את הידיים לצדדים עד גובה הכתפיים.',
      'הובילו עם המרפקים ולא עם כפות הידיים.',
      'הורידו לאט ובשליטה מלאה.',
    ],
    cue: 'דמיינו שאתם שופכים מים מקנקן קטן בסוף התנועה.',
    mistake: 'טעות נפוצה: נדנוד גוף ומשקל כבד שמעביר את העבודה לטרפז.',
    bodyPart: 'shoulders',
  },
  {
    id: 'x5',
    he: 'פשיטת מרפקים בפולי (חבל)',
    en: 'Cable Rope Pushdown',
    equip: ['Machine'],
    muscle: 'יד אחורית',
    sets: 4,
    reps: '12',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'אחזו בחבל בפולי עליון, מרפקים צמודים לצלעות.',
      'הטו את הגו קלות קדימה ונעלו את המרפקים במקומם.',
      'פשטו את המרפקים ופתחו את קצות החבל לצדדים.',
      'חזרו לאט עד כיפוף מלא.',
    ],
    cue: 'רק האמה זזה — המרפק נשאר מסומר לצלעות.',
    mistake: 'טעות נפוצה: רכינה עם כל הגוף כדי לדחוף משקל כבד מדי.',
    bodyPart: 'arms',
  },
  {
    id: 'x6',
    he: 'פולי עליון אחיזה צרה',
    en: 'Close-Grip Lat Pulldown',
    equip: ['Machine'],
    muscle: 'רוחב גב · יד קדמית',
    sets: 4,
    reps: '10–12',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'אחזו בידית משולשת באחיזה ניטרלית וצרה.',
      'שבו זקופים והצמידו את הברכיים מתחת לכרית.',
      'משכו את הידית אל אמצע החזה, מרפקים לאחור.',
      'עלו לאט עד מתיחה מלאה של הרחבים.',
    ],
    cue: 'משכו את המרפקים אל הכיסים; החזה עולה לפגוש את הידית.',
    mistake: 'טעות נפוצה: רכינה גדולה לאחור שהופכת את התרגיל לחתירה.',
    bodyPart: 'back',
    split: { back: 0.7, arms: 0.3 },
  },
  {
    id: 'x7',
    he: 'פייס פול בפולי',
    en: 'Cable Face Pull',
    equip: ['Machine'],
    muscle: 'כתף אחורית · טרפז אמצעי',
    sets: 3,
    reps: '15',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'כווננו את הפולי לגובה הפנים ואחזו בחבל בשתי ידיים.',
      'צעדו אחורה עד שהכבל במתח והידיים מושטות.',
      'משכו את החבל אל המצח כשהמרפקים גבוהים.',
      'סובבו את כפות הידיים החוצה וכווצו שכמות.',
    ],
    cue: 'המרפקים גבוהים מכפות הידיים לאורך כל המשיכה.',
    mistake: 'טעות נפוצה: משקל כבד שמוריד את המרפקים והופך את התרגיל לחתירה.',
    bodyPart: 'shoulders',
    split: { shoulders: 0.6, back: 0.4 },
  },
  {
    id: 'x8',
    he: 'הרמת שכמות עם משקולות',
    en: 'Dumbbell Shrugs',
    equip: ['Dumbbells'],
    muscle: 'טרפז עליון',
    sets: 3,
    reps: '15–20',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'עמדו עם משקולות לצידי הגוף וידיים ישרות.',
      'הרימו את הכתפיים ישר למעלה לכיוון האוזניים.',
      'עצרו שנייה בכיווץ העליון.',
      'הורידו לאט עד מתיחה מלאה של הטרפז.',
    ],
    cue: 'תנועה אנכית בלבד — בלי סיבוב כתפיים.',
    mistake: 'טעות נפוצה: כיפוף מרפקים שהופך את התרגיל לחתירה זקופה.',
    bodyPart: 'back',
  },
  {
    id: 'x9',
    he: 'פטישים עם משקולות',
    en: 'Hammer Curls',
    equip: ['Dumbbells'],
    muscle: 'יד קדמית · ברכיורדיאליס',
    sets: 3,
    reps: '10–12',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'עמדו עם משקולות באחיזה ניטרלית (אגודלים כלפי מעלה).',
      'שמרו על מרפקים צמודים לצלעות.',
      'כופפו מרפקים עד גובה הכתף בלי לסובב את כף היד.',
      'הורידו לאט ובשליטה מלאה.',
    ],
    cue: 'אחיזת פטיש קבועה — כף היד לא מסתובבת בכלל.',
    mistake: 'טעות נפוצה: נדנוד הגו והנפת המשקולות בתנופה.',
    bodyPart: 'arms',
  },
  {
    id: 'x10',
    he: 'פולאובר עם משקולת',
    en: 'Dumbbell Pullover',
    equip: ['Dumbbells'],
    muscle: 'חזה ורחב גבי · הרחבת בית החזה',
    sets: 3,
    reps: '10–12',
    rest: 60,
    unit: 'חזרות',
    steps: [
      'שכבו על ספסל שטוח, אחזו משקולת אחת בשתי ידיים מעל החזה.',
      'כיפוף קל וקבוע במרפקים לאורך כל התנועה.',
      'הורידו את המשקולת בקשת רחבה מאחורי הראש עד מתיחה מלאה.',
      'החזירו בקשת מעל החזה בכיווץ חזה ורחב גבי.',
    ],
    cue: 'האגן נשאר למטה והצלעות סגורות — המתיחה בחזה וברחב הגבי, לא בגב התחתון.',
    mistake: 'טעות נפוצה: כיפוף המרפקים בירידה שהופך את התרגיל לפשיטת מרפקים.',
    bodyPart: 'chest',
    split: { chest: 0.6, back: 0.4 },
  },
  {
    id: 'x11',
    he: 'סקוואט גובלט עם משקולת',
    en: 'Goblet / Dumbbell Squat',
    equip: ['Dumbbells'],
    muscle: 'ארבע־ראשי · ישבן',
    sets: 3,
    reps: '8–10',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'החזיקו משקולת אחת אנכית בשתי ידיים, צמוד לחזה ומתחת לסנטר.',
      'עמדו ברוחב כתפיים, כפות רגליים פונות מעט החוצה.',
      'רדו באיטיות עד שהירכיים מקבילות לרצפה, חזה זקוף לאורך כל הירידה.',
      'דחפו דרך אמצע כף הרגל חזרה למעלה בלי לנעול ברכיים.',
    ],
    cue: 'המשקולת נשארת צמודה לחזה והמרפקים יורדים בין הברכיים.',
    mistake: 'טעות נפוצה: עקבים שעולים מהרצפה או רכינה קדימה שמרחיקה את המשקולת מהגוף.',
    bodyPart: 'legs',
  },
  {
    id: 'x12',
    he: 'לחיצת חזה עם משקולות על ספסל',
    en: 'Flat Dumbbell Bench Press',
    equip: ['Dumbbells'],
    muscle: 'חזה מרכזי',
    sets: 3,
    reps: '8–10',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'שכבו על ספסל שטוח, משקולת בכל יד בגובה החזה.',
      'כווצו שכמות לאחור והצמידו אותן לספסל.',
      'לחצו את המשקולות מעלה ומעט פנימה עד כמעט נעילה.',
      'הורידו באיטיות (2–3 שניות) עד מתיחה נוחה בחזה.',
    ],
    cue: 'כפות רגליים נטועות ברצפה; המשקולות נעות בקו ישר מעל החזה.',
    mistake: 'טעות נפוצה: קשת גב מוגזמת או הקפצת המשקולות למעלה ואיבוד המתח מהחזה.',
    bodyPart: 'chest',
    split: { chest: 0.8, arms: 0.2 },
  },
  {
    id: 'x13',
    he: 'תלייה פסיבית על מתח (Dead Hang)',
    en: 'Dead Hang',
    equip: ['Bodyweight'],
    muscle: 'אחיזה · שחרור עמוד השדרה',
    sets: 2,
    reps: '30–45 שנ׳',
    rest: 60,
    unit: 'שניות',
    steps: [
      'אחזו במוט המתח באחיזה מעט רחבה מרוחב הכתפיים.',
      'הרפו את הגוף לגמרי ותנו למשקל למתוח את עמוד השדרה מטה.',
      'נשמו באופן סדיר ואיטי לאורך כל ההחזקה.',
      'בסוף הזמן רדו בעדינות על הרגליים — בלי לקפוץ.',
    ],
    cue: 'כתפיים רפויות עד האוזניים — זו תלייה פסיבית לשחרור, לא משיכה.',
    mistake: 'טעות נפוצה: כיווץ הכתפיים והחזקת מתח בגוף במקום הרפיה מלאה.',
    bodyPart: 'back',
  },
  {
    id: 'x14',
    he: 'מתח עם גומייה / גרביטון',
    en: 'Assisted Pull-up (Band / Machine)',
    equip: ['Bodyweight', 'Machine'],
    muscle: 'רוחב גב',
    sets: 4,
    reps: '5–8',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'עגנו גומייה על המוט והכניסו אליה ברך או כף רגל, או כוונו משקל נגדי בגרביטון.',
      'אחזו במוט מעט רחב מהכתפיים וכווצו שכמות מטה לפני המשיכה.',
      'משכו את הסנטר מעל המוט בתנועה איטית ומבוקרת.',
      'רדו לאט עד יישור כמעט מלא של הידיים.',
    ],
    cue: 'הובילו עם המרפקים מטה; החזה עולה לפגוש את המוט.',
    mistake: 'טעות נפוצה: עזרה גדולה מדי מהגומייה וחזרות מהירות בלי שליטה בירידה.',
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    id: 'x15',
    he: 'חתירה בפולי בישיבה',
    en: 'Seated Cable Row',
    equip: ['Machine'],
    muscle: 'עובי גב · טרפז אמצעי',
    sets: 3,
    reps: '8–10',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'שבו מול הפולי התחתון, רגליים על המשענות וברכיים מעט כפופות.',
      'אחזו בידית (ניטרלית או רחבה) עם גב ישר וחזה פתוח.',
      'משכו את הידית אל הבטן התחתונה וקרבו את השכמות זו לזו עד הסוף.',
      'החזירו לאט עד מתיחה מלאה בלי לעגל את הגב.',
    ],
    cue: 'הוציאו חזה וכווצו את השכמות למקסימום בסוף כל משיכה.',
    mistake: 'טעות נפוצה: נדנוד הגו לאחור ומשיכה עם הידיים במקום עם הגב.',
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    id: 'x16',
    he: 'פאלוף פרס (לחיצה נגד פיתול)',
    en: 'Pallof Press',
    equip: ['Machine'],
    muscle: 'ליבה · ייצוב נגד פיתול',
    sets: 3,
    reps: '10–12 לצד',
    rest: 60,
    unit: 'חזרות/צד',
    steps: [
      'עמדו כשצידכם אל הפולי, הכבל בגובה החזה, ואחזו בידית בשתי ידיים מול עצם החזה.',
      'צעדו הצידה עד שהכבל נמתח; רגליים ברוחב כתפיים וליבה מכווצת.',
      'לחצו את הידיים ישר קדימה מהחזה — בלי לתת לגו להסתובב לכיוון המכשיר.',
      'החזירו לאט אל החזה, כשהאגן והכתפיים נשארים ישרים קדימה.',
    ],
    cue: 'הידיים נעות — הגו נשאר סטטי לחלוטין; זו כל המהות של התרגיל.',
    mistake: 'טעות נפוצה: סיבוב הכתפיים או האגן אחרי הידיים במקום להתנגד למשיכה.',
    bodyPart: 'core',
  },
  {
    id: 'x17',
    he: 'מתח שלילי (ירידות איטיות)',
    en: 'Negative Pull-ups',
    equip: ['Bodyweight'],
    muscle: 'רוחב גב',
    sets: 4,
    reps: '3–5',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'עלו בקפיצה (או בעזרת ספסל) לעמדה העליונה — סנטר מעל המוט.',
      'החזיקו שנייה למעלה עם שכמות מכווצות.',
      'רדו באיטיות מרבית — 4–5 שניות לאורך כל הטווח.',
      'הגיעו ליישור כמעט מלא, שחררו, ועלו שוב לחזרה הבאה.',
    ],
    cue: 'הירידה היא התרגיל: להילחם בכל סנטימטר בדרך מטה.',
    mistake: 'טעות נפוצה: נפילה חופשית במחצית התחתונה במקום ירידה מבוקרת עד הסוף.',
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    id: 'x18',
    he: 'חתירה עם תמיכת חזה על ספסל',
    en: 'Chest-Supported Dumbbell Row',
    equip: ['Dumbbells'],
    muscle: 'גב עליון · ללא עומס על הגב התחתון',
    sets: 3,
    reps: '8–10',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'כוונו ספסל לשיפוע ‎30–45°‎ ושכבו עליו על הבטן, החזה נתמך בקצה הכרית.',
      'הניחו את כפות הרגליים על הרצפה ותנו לידיים להשתלשל עם המשקולות.',
      'משכו את המשקולות אל הצלעות, מרפקים קרובים לגוף ושכמות מתכווצות.',
      'הורידו לאט עד מתיחה מלאה בלי להרים את החזה מהכרית.',
    ],
    cue: 'החזה נשאר צמוד לכרית — כך הגב התחתון נשאר מחוץ למשוואה.',
    mistake: "טעות נפוצה: הרמת הגו מהספסל בסוף המשיכה כדי 'לעזור' בתנופה.",
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    id: 'x19',
    he: 'פולי עליון אחיזה רגילה',
    en: 'Medium-Grip Lat Pulldown',
    equip: ['Machine'],
    muscle: 'רוחב גב',
    sets: 3,
    reps: '10–12',
    rest: 90,
    unit: 'חזרות',
    steps: [
      'אחזו במוט ברוחב הכתפיים או מעט מעבר, כפות ידיים קדימה.',
      'שבו זקופים עם הברכיים מתחת לכרית.',
      'משכו את המוט אל עצם החזה העליונה, מרפקים מטה ולאחור.',
      'עלו לאט חזרה עד מתיחה מלאה של הרחבים.',
    ],
    cue: 'רכינה קלה בלבד לאחור — המשיכה מתחילה מהמרפקים, לא מהאמות.',
    mistake: 'טעות נפוצה: רכינה גדולה לאחור ומשיכת המוט אל הבטן.',
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    id: 'x20',
    he: 'חתירה חד־זרועית בפולי',
    en: 'One-Arm Cable Row',
    equip: ['Machine'],
    muscle: 'עובי גב · איזון בין הצדדים',
    sets: 3,
    reps: '10–12 לצד',
    rest: 90,
    unit: 'חזרות/צד',
    steps: [
      'עמדו מול פולי בגובה הבטן ואחזו בידית ביד אחת, אחיזה ניטרלית.',
      'היד החופשית נתמכת על הירך; גב ישר וחזה פתוח.',
      'משכו את הידית אל הצלעות והובילו את המרפק צמוד לגוף לאחור.',
      'החזירו לאט עד מתיחה מלאה, בלי לסובב את הגו.',
    ],
    cue: 'השכמה מתחילה את המשיכה; הגו יציב ופונה קדימה כל הזמן.',
    mistake: 'טעות נפוצה: פיתול הגו לאחור יחד עם המשיכה במקום עבודה נקייה של הגב.',
    bodyPart: 'back',
    split: { back: 0.8, arms: 0.2 },
  },
  {
    // THE CARDIO DAY. A treadmill walk climbed as a ladder: six stages of five
    // minutes, the incline up by one point at every ✓. `sets` is the number of
    // stages, `rest` the length of one (the stage timer), and the two logged
    // numbers are incline % and minutes — see `CardioSpec`.
    id: 'x21',
    he: 'הליכה על הליכון בשיפוע',
    en: 'Treadmill Incline Walk',
    equip: ['Machine'],
    muscle: 'קרדיו · ישבן ושוקיים',
    sets: 6,
    reps: '5 דק׳',
    rest: 300,
    unit: 'דקות',
    steps: [
      'התחילו בהליכה נוחה (5–6 קמ״ש) בשיפוע 1%, בלי לאחוז במעקה.',
      'כל 5 דקות העלו את השיפוע בנקודה אחת — הקצב נשאר אותו קצב.',
      'סמנו ✓ בסוף כל שלב: הטיימר של השלב הבא מתחיל לבד, ואיתו השיפוע החדש.',
      'צעד מלא מהעקב לבוהן, גו זקוף ומבט קדימה — לא אל הצג.',
    ],
    cue: 'דחפו מהישבן בכל צעד; אם צריך את המעקה כדי להחזיק את הקצב — השיפוע גבוה מדי.',
    mistake: 'טעות נפוצה: להיתלות על המעקה ולהישען לאחור — זה מבטל את השיפוע שבשבילו באתם.',
    bodyPart: 'legs',
    split: { legs: 0.8, core: 0.2 },
    cardio: { loadLabel: 'שיפוע', loadUnit: '%', loadStart: 1, loadStep: 1 },
  },
];

export const DAY_ORDER: readonly BuiltInDayKey[] = ['A', 'B', 'C'] as const;

export const DAY_NAMES: Readonly<Record<BuiltInDayKey, string>> = {
  A: 'ראשון',
  B: 'שלישי',
  C: 'חמישי',
};

/** Hebrew weekday names, indexed the way `Date#getDay()` counts (0 = Sunday). */
export const WEEKDAY_HE: readonly string[] = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
] as const;

/**
 * One-letter weekday names, same indexing as `WEEKDAY_HE`. Used by the plan
 * editor's toggle chips, where seven full names would never fit a phone row.
 */
export const WEEKDAY_SHORT_HE: readonly string[] = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] as const;

/**
 * Weekdays each built-in day is trained on — the exact mapping the app has
 * always used to pick the default tab (Sun/Mon → A, Tue/Wed → B, Thu–Sat → C).
 * A plan migrated from v1 inherits these, so the default tab never moves under
 * anyone who already saved a plan.
 *
 * The FIRST weekday of each range is what names the day (`DAY_NAMES`), which is
 * why `weekdayCaption` reads only that one.
 */
export const BUILTIN_WEEKDAYS: Readonly<Record<BuiltInDayKey, readonly number[]>> = {
  A: [0, 1],
  B: [2, 3],
  C: [4, 5, 6],
};

/**
 * Training days per week that make a "perfect week" for the built-in program.
 * Mirrors `BALANCE.streak.daysPerWeek` (asserted in tests/program.test.ts); it
 * lives here because it is a property of a PROGRAM, and a plan overrides it.
 */
export const DEFAULT_WEEKLY_TARGET = 3;

/** Smallest / largest number of workout days a plan may define. */
export const MIN_PLAN_DAYS = 1;
export const MAX_PLAN_DAYS = 7;

/** Smallest / largest "perfect week" target a plan may ask for. */
export const MIN_WEEKLY_TARGET = 1;
export const MAX_WEEKLY_TARGET = 7;

/** The built-in program in the shape every screen consumes. */
export const BUILTIN_PROGRAM: ResolvedProgram = {
  days: DAY_ORDER.map((k) => ({
    key: k,
    label: PROGRAM[k].label,
    weekdays: BUILTIN_WEEKDAYS[k],
    day: PROGRAM[k],
  })),
  weeklyTarget: DEFAULT_WEEKLY_TARGET,
};

/** One day of a resolved program by key, or `null` when it has no such day. */
export function programDay(program: ResolvedProgram, key: DayKey): ProgramDay | null {
  return program.days.find((d) => d.key === key) ?? null;
}

/** The renderable `Day` of a key, or `null` — the safe replacement of `p[key]`. */
export function dayOf(program: ResolvedProgram, key: DayKey): Day | null {
  return programDay(program, key)?.day ?? null;
}

/** What a day key is called when nothing in the app can resolve it any more. */
export const UNKNOWN_DAY_LABEL = 'אימון';

/**
 * The Hebrew label of a day key, for screens that show HISTORY.
 *
 * A logged session carries the day key it was trained under, and that key may
 * have been renamed, removed from the plan, or invented on another device. The
 * ladder is therefore: the plan's own label → the built-in label when the key is
 * still one of `A`/`B`/`C` (a session from before the user ever edited the plan)
 * → a neutral "אימון". A stored key is the user's DATA: it is never coerced into
 * another day, and it never renders as a raw `d_…` string either.
 */
export function dayLabelOf(program: ResolvedProgram, key: DayKey): string {
  const found = programDay(program, key);
  if (found) return found.label;
  if (isBuiltInDayKey(key)) return PROGRAM[key].label;
  return UNKNOWN_DAY_LABEL;
}

/** The day keys in tab order. */
export function programDayKeys(program: ResolvedProgram): DayKey[] {
  return program.days.map((d) => d.key);
}

/**
 * The day the app opens on: the plan day assigned to today's weekday, or the
 * FIRST day when no day claims it. For the built-in program this reproduces the
 * legacy `defaultDay()` exactly (Sun/Mon → A, Tue/Wed → B, Thu–Sat → C).
 */
export function defaultDayOf(program: ResolvedProgram, now: Date = new Date()): DayKey {
  const wd = now.getDay(); // 0 = Sunday
  const match = program.days.find((d) => d.weekdays.includes(wd));
  return (match ?? program.days[0])?.key ?? 'A';
}

/** Hebrew caption of a set of weekdays, e.g. `[0, 3]` -> "ראשון · רביעי". */
export function weekdaysCaption(weekdays: readonly number[]): string {
  return weekdays
    .map((w) => WEEKDAY_HE[w] ?? '')
    .filter((s) => s !== '')
    .join(' · ');
}

/**
 * The single weekday name a day is CALLED after: the first weekday it is
 * trained on. `[0, 1]` -> "ראשון", which is exactly what `DAY_NAMES` said for
 * the built-in day A — the reason a migrated v1 plan looks unchanged.
 */
export function weekdayCaption(weekdays: readonly number[], fallback: string): string {
  const first = weekdays[0];
  return first === undefined ? fallback : (WEEKDAY_HE[first] ?? fallback);
}

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

/** True for one of the reserved (non-day) view keys. */
export function isReservedViewKey(v: unknown): boolean {
  return typeof v === 'string' && RESERVED_VIEW_KEYS.includes(v);
}

/**
 * True for anything that MAY be a day key.
 *
 * Deliberately permissive: this guards untrusted persisted data (`Session.day`,
 * event payloads), and a day key from another device's plan is a string this
 * build has never seen. Rejecting it would rewrite the user's history; the
 * screens fall back gracefully instead.
 */
export function isDayKey(v: unknown): v is DayKey {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_DAY_KEY_LENGTH && !isReservedViewKey(v);
}

/** True for a key of the built-in program. */
export function isBuiltInDayKey(v: unknown): v is BuiltInDayKey {
  return v === 'A' || v === 'B' || v === 'C';
}

/**
 * Stricter rule for a key a PLAN may MINT: url/attribute-safe characters only,
 * so a key can be dropped into `data-day="…"` and a CSS selector unescaped.
 */
export function isPlanDayKey(v: unknown): v is DayKey {
  return isDayKey(v) && /^[A-Za-z0-9_-]+$/.test(v);
}

/**
 * Every built-in exercise the app knows: the program's own, in day order, then
 * the library additions. Deduplicated by id, so an exercise that appears in two
 * days is listed once — this is the list the editor's add-sheet offers.
 */
export function builtInExercises(): Exercise[] {
  const out: Exercise[] = [];
  for (const k of DAY_ORDER) {
    for (const ex of PROGRAM[k].exercises) if (!out.some((e) => e.id === ex.id)) out.push(ex);
  }
  for (const ex of EXTRA_EXERCISES) if (!out.some((e) => e.id === ex.id)) out.push(ex);
  return out;
}

/**
 * Find an exercise definition by id across the program AND the library (legacy
 * history lookup). A row, a session or an event may point at either.
 */
export function findExercise(exId: string): Exercise | null {
  for (const k of DAY_ORDER) {
    const found = PROGRAM[k].exercises.find((e) => e.id === exId);
    if (found) return found;
  }
  return EXTRA_EXERCISES.find((e) => e.id === exId) ?? null;
}

/** True for a cardio exercise — one whose sets are timed stages (see `CardioSpec`). */
export function isCardio(ex: Exercise | null | undefined): ex is Exercise & { readonly cardio: CardioSpec } {
  return !!ex && ex.cardio !== undefined;
}

/**
 * The load a cardio exercise SUGGESTS for stage `i` (0-based): the ladder the
 * spec describes, `loadStart + loadStep × i`. It is the prefill of a stage with
 * no history behind it — a suggestion, never data (see the workout screen).
 */
export function stageLoad(ex: Exercise, i: number): number {
  const c = ex.cardio;
  if (!c) return 0;
  return Math.round((c.loadStart + c.loadStep * Math.max(0, i)) * 100) / 100;
}

/**
 * Length of one stage of a cardio exercise in MINUTES — its `rest`, which is
 * the stage timer in seconds, to one decimal (a 90-second stage is 1.5).
 */
export function stageMinutes(ex: Exercise): number {
  return Math.max(0.1, Math.round(ex.rest / 6) / 10);
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
