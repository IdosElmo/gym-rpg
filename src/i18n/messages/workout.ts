/**
 * i18n/messages/workout.ts — the workout day screen (exercise cards, set
 * logging, supersets, cardio stages, hold timers, notes) and the coach demo
 * drawer.
 *
 * Every Hebrew value is the exact string the screen printed before i18n (the
 * DOM tests pin them). Exercise copy itself (names, steps, cues…) is NOT here:
 * it comes through the accessors of `i18n/content.ts`.
 */

import type { Catalog } from '../locale.ts';

const he = {
  missingDay: 'יום האימון הזה כבר לא קיים בתוכנית. בחרו יום אחר או ערכו את התוכנית. 🛠',
  order: (n: number, total: number) => `תרגיל ${n} / ${total}`,
  supersetWith: (name: string) => `🔗 סופר־סט עם ${name}`,
  sets: 'סטים',
  stages: 'שלבים',
  set: 'סט',
  stage: 'שלב',
  weightCol: (unit: string) => `משקל (${unit})`,
  prev: 'אימון קודם: ',
  /** Appended to a cardio stage's minutes ("5 דק׳"). */
  minSuffix: ' דק׳',
  checkSet: (n: number) => `סמן סט ${n} כהושלם`,
  guide: {
    toggle: 'הסבר ודגשי ביצוע',
    steps: 'שלבי ביצוע',
    cue: 'דגש:',
  },
  notes: {
    toggle: '📝 הערות לתרגיל',
    placeholder: 'למשל: גובה מושב 4, אחיזה רחבה, להתחיל קל יותר…',
    label: (name: string) => `הערות לתרגיל ${name}`,
    hint: 'נשמר אוטומטית · ההערה נשארת עם התרגיל בכל אימון',
  },
  restHint: (sec: number) => `⏱ מנוחה מומלצת: ${sec} שניות (מתחיל אוטומטית בסימון סט)`,
  stageHint: (clock: string) => `⏱ כל שלב ${clock} דק׳ · סימון ✓ בסוף שלב מפעיל את הטיימר של השלב הבא`,
  superset: {
    chip: '🔗 סופר־סט',
    sub: 'שני התרגילים — ✓ אחד · מנוחה אחת',
    joint: '🔗 בלי מנוחה — ישר לתרגיל הבא',
    rest: (sec: number) => `⏱ מנוחה משותפת: ${sec} שניות — טיימר אחד, מתחיל בסימון הזוג`,
    timer: (n: number) => `🔗 סופר־סט · סט ${n} הושלם`,
  },
  setDoneTimer: (name: string, n: number) => `${name} · סט ${n} הושלם`,
  stageTimer: {
    button: (n: number, total: number) => `▶ טיימר לשלב ${n} מתוך ${total}`,
    at: (label: string, load: string, unit: string) => ` · ${label} ${load}${unit}`,
    label: (n: number, total: number, at: string) => `🏃 שלב ${n}/${total}${at}`,
    sub: 'טיימר שלב',
    raise: (label: string) => `והעלו ${label}!`,
    keep: 'והמשיכו לשלב הבא!',
    lastDone: 'השלב האחרון הסתיים — סמנו ✓ 🏁',
    done: (n: number, next: string) => `שלב ${n} הסתיים — סמנו ✓ ${next} 💪`,
  },
  holdTimer: {
    button: (n: number, total: number, clock: string) => `▶ טיימר החזקה לסט ${n} מתוך ${total} · ${clock}`,
    label: (name: string, n: number, total: number) => `⏱ ${name} · סט ${n}/${total}`,
    sub: 'טיימר החזקה',
    done: (n: number) => `סט ${n} הסתיים — סמנו ✓ 💪`,
  },
  xp: {
    part: (xp: string, part: string) => `+${xp} XP ${part}!`,
    pr: (name: string) => `🏆 שיא חדש ב${name} · XP כפול!`,
    levelUp: (part: string, to: number) => `🎉 ${part} עלה לרמה ${to}!`,
    finishedFly: (xp: string) => `אימון הושלם! +${xp} XP לכל הגוף`,
    finishedToast: (xp: string, energy: string) =>
      `💪 אימון הושלם! +${xp} XP לכל חלקי הגוף · +${energy} ⚡ אנרגיית קרב`,
  },
  demo: {
    label: 'הדגמת ביצוע',
    labelOf: (name: string) => `הדגמת ביצוע: ${name}`,
  },
};

const en: typeof he = {
  missingDay: 'This workout day is no longer in your plan. Pick another day or edit the plan. 🛠',
  order: (n: number, total: number) => `Exercise ${n} / ${total}`,
  supersetWith: (name: string) => `🔗 Superset with ${name}`,
  sets: 'sets',
  stages: 'stages',
  set: 'Set',
  stage: 'Stage',
  weightCol: (unit: string) => `Weight (${unit})`,
  prev: 'Last time: ',
  minSuffix: ' min',
  checkSet: (n: number) => `Mark set ${n} as done`,
  guide: {
    toggle: 'How to do it',
    steps: 'Steps',
    cue: 'Cue:',
  },
  notes: {
    toggle: '📝 Exercise notes',
    placeholder: 'e.g. seat height 4, wide grip, start lighter…',
    label: (name: string) => `Notes for ${name}`,
    hint: 'Saved automatically · the note stays with this exercise every workout',
  },
  restHint: (sec: number) => `⏱ Suggested rest: ${sec} seconds (starts automatically when you tick a set)`,
  stageHint: (clock: string) => `⏱ Each stage ${clock} min · ticking ✓ at the end of a stage starts the next stage’s timer`,
  superset: {
    chip: '🔗 Superset',
    sub: 'Both exercises — one ✓ · one rest',
    joint: '🔗 No rest — straight into the next exercise',
    rest: (sec: number) => `⏱ Shared rest: ${sec} seconds — one timer, starts when you tick the pair`,
    timer: (n: number) => `🔗 Superset · set ${n} done`,
  },
  setDoneTimer: (name: string, n: number) => `${name} · set ${n} done`,
  stageTimer: {
    button: (n: number, total: number) => `▶ Timer for stage ${n} of ${total}`,
    at: (label: string, load: string, unit: string) => ` · ${label} ${load}${unit}`,
    label: (n: number, total: number, at: string) => `🏃 Stage ${n}/${total}${at}`,
    sub: 'Stage timer',
    raise: (label: string) => `then raise the ${label.toLowerCase()}!`,
    keep: 'then on to the next stage!',
    lastDone: 'Last stage done — tick ✓ 🏁',
    done: (n: number, next: string) => `Stage ${n} done — tick ✓ ${next} 💪`,
  },
  holdTimer: {
    button: (n: number, total: number, clock: string) => `▶ Hold timer for set ${n} of ${total} · ${clock}`,
    label: (name: string, n: number, total: number) => `⏱ ${name} · set ${n}/${total}`,
    sub: 'Hold timer',
    done: (n: number) => `Set ${n} done — tick ✓ 💪`,
  },
  xp: {
    part: (xp: string, part: string) => `+${xp} XP ${part}!`,
    pr: (name: string) => `🏆 New record on ${name} · double XP!`,
    levelUp: (part: string, to: number) => `🎉 ${part} reached level ${to}!`,
    finishedFly: (xp: string) => `Workout complete! +${xp} XP to your whole body`,
    finishedToast: (xp: string, energy: string) =>
      `💪 Workout complete! +${xp} XP to every body part · +${energy} ⚡ battle energy`,
  },
  demo: {
    label: 'Exercise demo',
    labelOf: (name: string) => `Exercise demo: ${name}`,
  },
};

export const workout: Catalog<typeof he> = { he, en };

/**
 * The tiny caption under each picture of a two-way demo, keyed by the Hebrew
 * caption `data/exercisePoses.ts` carries (that file is data; its captions
 * stay Hebrew and the tests pin them). A caption missing here shows as-is.
 */
export const DEMO_CAPTION_EN: Readonly<Record<string, string>> = {
  'סמית׳': 'Smith machine',
  'משקולות': 'Dumbbells',
  'בתלייה': 'Hanging',
  'בשכיבה': 'Lying',
  'פולי עליון': 'Lat pulldown',
  'מתח': 'Pull-up',
  'על מזרן': 'On a mat',
  'בשיפוע': 'Decline bench',
};
