/**
 * i18n/messages/plan.ts — the plan editor (screen 'PL'), the plan model's
 * user-facing messages (`core/plan.ts`: validation errors, the header lines of
 * an edited day) and the ready-made presets (`data/presets.ts`).
 *
 * Every Hebrew value is the exact string the app printed before i18n (the DOM
 * and model tests pin them).
 *
 * TWO KINDS OF STRING LIVE HERE. Most are presentation and are read at render
 * time. A few are CONTENT a plan is born with — a new day's name, the day
 * labels a preset builds — and are frozen into the user's plan in whatever
 * language was showing when it was saved, like anything else the user types.
 */

import type { Catalog } from '../locale.ts';

const he = {
  /** The name a freshly added day is born with (user content once saved). */
  newDayLabel: 'אימון חדש',
  /**
   * A built-in day's name when the content overlay has none ("אימון A" — the
   * Hebrew is the program's own label, so this is a fallback for other locales).
   */
  builtInLabel: (key: string) => `אימון ${key}`,
  days: {
    tabsLabel: 'ימי האימון',
    exercises: (n: number) => `${n} תרגילים`,
    add: 'הוספת יום אימון',
    max: (n: number) => `עד ${n} ימי אימון`,
    maxToast: (n: number) => `עד ${n} ימי אימון בתוכנית.`,
    nameField: 'שם היום',
    nameLabel: 'שם יום האימון',
    up: (label: string) => `העבר את ${label} קדימה`,
    down: (label: string) => `העבר את ${label} אחורה`,
    remove: (label: string) => `הסרת ${label} מהתוכנית`,
    weekdaysOf: (label: string) => `ימי השבוע של ${label}`,
    assigned: ' — משובץ',
    caption: (days: string) => `ימי אימון: ${days}`,
    unscheduled: 'לא שובצו ימים בשבוע — היום הזה לא ייפתח אוטומטית',
    moved: (weekday: string, from: string) => `${weekday} הועבר מ${from}`,
    target: (n: number) => `יעד שבועי: ${n} ימי אימון (משפיע על רצף השבוע המושלם)`,
    minToast: 'התוכנית חייבת לכלול לפחות יום אימון אחד. 🗓',
    removeConfirm: (label: string) =>
      `להסיר את ${label} מהתוכנית? אימונים שכבר תועדו ביום הזה יישארו בהיסטוריה — רק היום עצמו יורד מהתוכנית.`,
    removed: (label: string) => `${label} הוסר מהתוכנית`,
  },
  row: {
    custom: 'מותאם אישית',
    cardio: 'קרדיו',
    up: (name: string) => `העבר את ${name} למעלה`,
    down: (name: string) => `העבר את ${name} למטה`,
    remove: (name: string) => `הסר את ${name} מהתוכנית`,
    sets: 'סטים',
    stages: 'שלבים',
    rest: 'מנוחה (שנ׳)',
    stageLength: 'אורך שלב (שנ׳)',
    minToast: 'חייב להישאר לפחות תרגיל אחד ביום. 🏋️',
    removeConfirm: (name: string, day: string) => `להסיר את ${name} מ${day}?`,
    maxToast: (n: number) => `עד ${n} תרגילים ליום.`,
  },
  superset: {
    taken: 'התרגיל כבר משובץ בסופר־סט אחר',
    link: (a: string, b: string) => `קישור ${a} ו${b} לסופר־סט`,
    linkBtn: '🔗 צרו סופר־סט',
    tag: '🔗 סופר־סט',
    unlink: (a: string, b: string) => `ביטול הסופר־סט בין ${a} ל${b}`,
    unlinkBtn: '🔗 מקושר · ביטול',
    restNote: '⏱ מנוחה משותפת — נספרת פעם אחת, אחרי שני התרגילים',
  },
  sheet: {
    newTitle: 'תרגיל חדש',
    presetsTitle: 'תוכניות מוכנות',
    addTitle: (day: string) => `הוספת תרגיל · ${day}`,
    addLabel: 'הוספת תרגיל',
    close: 'סגירת החלון',
  },
  presets: {
    days: (n: number) => `${n} ימי אימון`,
    mine: 'תוכנית ששמרתם בעצמכם',
    remove: (name: string) => `מחיקת ${name}`,
    mineTitle: '⭐ התוכניות שלי',
    saveCurrent: '⭐ שמירת התוכנית הנוכחית כתוכנית מוכנה',
    note: 'בחירה בתוכנית מוכנה מחליפה את הטיוטה הנוכחית. שום דבר לא נשמר עד לחיצה על 💾 שמירה, וההיסטוריה נשמרת בכל מקרה. שמירת תוכנית ⭐ מקפיאה את התוכנית שבעריכה כמו שהיא — אפשר לחזור אליה מכאן בכל רגע, גם ממכשיר אחר.',
    replaceConfirm: (name: string) => `להחליף את התוכנית שבעריכה ב"${name}"? כל שינוי שלא נשמר יאבד.`,
    loaded: (name: string) => `${name} נטענה — לחצו 💾 שמירה כדי להחיל אותה`,
    namePrompt: 'איך לקרוא לתוכנית השמורה?',
    nameDefault: 'התוכנית שלי',
    saved: (name: string) => `"${name}" נשמרה לתוכניות המוכנות ⭐`,
    deleteConfirm: (name: string) => `למחוק את "${name}" מהתוכניות השמורות? התוכנית הפעילה וההיסטוריה לא מושפעות.`,
    deleted: (name: string) => `"${name}" נמחקה`,
  },
  library: {
    allIn: 'כל התרגילים כבר נמצאים ביום הזה. אפשר ליצור תרגיל חדש. ✨',
    newBtn: '✨ יצירת תרגיל חדש',
    stages: (n: number, reps: string) => `${n} שלבים × ${reps}`,
    noDemo: 'לתרגיל מותאם אישית אין הדגמה — הוא נראה כמו שאתם מבצעים אותו.',
    add: '➕ הוספה ליום',
    closePreview: 'סגירת התצוגה המקדימה',
  },
  form: {
    name: 'שם התרגיל (עברית) *',
    second: 'שם באנגלית (רשות)',
    part: 'חלק גוף עיקרי',
    part2: 'חלק גוף משני (רשות)',
    none: 'ללא',
    unit: 'יחידת מדידה',
    equip: 'ציוד',
    note: 'חלק גוף משני מחלק את ה־XP ביחס 70/30 — בדיוק כמו בתרגילי התוכנית המקורית.',
    submit: '✨ הוספה לתוכנית',
    cancel: 'ביטול',
    nameMissing: 'צריך שם בעברית לתרגיל החדש.',
    added: (name: string, day: string) => `${name} נוסף ל${day} ✨`,
  },
  editor: {
    empty: 'היום עדיין ריק — הוסיפו לפחות תרגיל אחד לפני השמירה. 🏋️',
    add: '+ הוספת תרגיל',
    save: '💾 שמירה',
    close: 'סגירה',
    presets: '📋 תוכניות מוכנות',
    reset: 'איפוס לתוכנית המקורית',
    note: 'שינוי התוכנית לא נוגע בהיסטוריה, ב־XP או בשיאים: כל אלה נשמרים לפי מזהה התרגיל, כך שאפשר לסדר מחדש, להסיר ולהחזיר תרגילים בלי לאבד כלום.',
    dirty: '⚠️ יש שינויים שלא נשמרו — לחצו על 💾 שמירה.',
    original: 'התוכנית זהה לתוכנית המקורית.',
    saved: 'התוכנית שמורה. ✓',
    savedToast: 'התוכנית נשמרה ✓',
    resetConfirm: 'לאפס את התוכנית חזרה לתוכנית המקורית? התרגילים המותאמים אישית יוסרו מהתוכנית (ההיסטוריה נשמרת).',
    resetToast: 'התוכנית אופסה לתוכנית המקורית ✓',
  },
  /** `core/plan.ts` — why a document cannot be saved. */
  validate: {
    invalid: 'התוכנית אינה תקינה',
    customName: 'לתרגיל מותאם אישית חייב להיות שם בעברית',
    nameTooLong: (max: number) => `שם התרגיל ארוך מדי (עד ${max} תווים)`,
    minDays: 'התוכנית חייבת לכלול לפחות יום אימון אחד',
    maxDays: (max: number) => `עד ${max} ימי אימון בתוכנית`,
    target: (lo: number, hi: number) => `יעד האימונים השבועי חייב להיות בין ${lo} ל־${hi}`,
    dayKey: (label: string) => `${label}: מזהה יום לא תקין`,
    dayKeyTwice: (label: string) => `${label}: מזהה היום מופיע פעמיים`,
    dayName: 'לכל יום אימון חייב להיות שם',
    dayNameTooLong: (max: number) => `שם היום ארוך מדי (עד ${max} תווים)`,
    weekday: (label: string) => `${label}: יום בשבוע לא תקין`,
    emptyDay: (label: string) => `${label}: יש להשאיר לפחות תרגיל אחד ביום`,
    maxExercises: (label: string, max: number) => `${label}: עד ${max} תרגילים ליום`,
    unknown: (label: string, id: string) => `${label}: תרגיל לא מוכר (${id})`,
    twice: (label: string, name: string) => `${label}: ${name} מופיע פעמיים`,
    sets: (name: string, cardio: boolean, lo: number, hi: number) =>
      `${name}: מספר ${cardio ? 'השלבים' : 'הסטים'} חייב להיות בין ${lo} ל־${hi}`,
    reps: (name: string) => `${name}: יש למלא טווח חזרות`,
    rest: (name: string, lo: number, hi: number) => `${name}: זמן המנוחה חייב להיות בין ${lo} ל־${hi} שניות`,
    ssMissing: (label: string) => `${label}: סופר־סט מפנה לתרגיל שאינו ביום הזה`,
    ssAdjacent: (label: string, a: string, b: string) =>
      `${label}: סופר־סט אפשרי רק בין שני תרגילים סמוכים (${a} ו${b})`,
    ssOnce: (label: string) => `${label}: תרגיל יכול להשתתף רק בסופר־סט אחד`,
    presetName: 'לתוכנית שמורה צריך שם. ✏️',
    presetMax: (max: number) => `אפשר לשמור עד ${max} תוכניות — מחקו אחת ישנה קודם.`,
  },
  /** `core/plan.ts` — the header lines of an edited day. */
  day: {
    duration: (minutes: number) => `~${minutes} דק׳`,
    more: (head: string) => `${head} ועוד`,
  },
  /** `data/presets.ts` — the picker's cards, and the labels a preset builds. */
  preset: {
    builtin3: {
      name: 'היפרטרופיה 3 ימים',
      description: 'התוכנית המקורית של האפליקציה: A/B/C, כל הגוף על פני שלושה אימונים בשבוע.',
    },
    ab4: {
      name: 'תוכנית A/B — 4 ימים',
      description:
        'ארבעה ימים, שלושה אימונים: ראשון ורביעי אימון A (רגליים ודחיפה), שלישי אימון B1 וחמישי אימון B2 (גב ומשיכה).',
      dayA: 'אימון A — רגליים, דחיפה ודקומפרסיה',
      dayB1: 'אימון B1 — גב ומשיכה · כוח למתח',
      dayB2: 'אימון B2 — גב ומשיכה · שליליות',
    },
  },
};

const en: typeof he = {
  newDayLabel: 'New workout',
  builtInLabel: (key: string) => `Workout ${key}`,
  days: {
    tabsLabel: 'Workout days',
    exercises: (n: number) => (n === 1 ? '1 exercise' : `${n} exercises`),
    add: 'Add a workout day',
    max: (n: number) => `Up to ${n} workout days`,
    maxToast: (n: number) => `A plan can have up to ${n} workout days.`,
    nameField: 'Day name',
    nameLabel: 'Workout day name',
    up: (label: string) => `Move ${label} earlier`,
    down: (label: string) => `Move ${label} later`,
    remove: (label: string) => `Remove ${label} from the plan`,
    weekdaysOf: (label: string) => `Weekdays of ${label}`,
    assigned: ' — scheduled',
    caption: (days: string) => `Training days: ${days}`,
    unscheduled: 'No weekdays assigned — this day will not open automatically',
    moved: (weekday: string, from: string) => `${weekday} moved from ${from}`,
    target: (n: number) =>
      `Weekly target: ${n === 1 ? '1 workout day' : `${n} workout days`} (counts toward your perfect-week streak)`,
    minToast: 'The plan needs at least one workout day. 🗓',
    removeConfirm: (label: string) =>
      `Remove ${label} from the plan? Workouts already logged on this day stay in your history — only the day itself leaves the plan.`,
    removed: (label: string) => `${label} removed from the plan`,
  },
  row: {
    custom: 'Custom',
    cardio: 'Cardio',
    up: (name: string) => `Move ${name} up`,
    down: (name: string) => `Move ${name} down`,
    remove: (name: string) => `Remove ${name} from the plan`,
    sets: 'Sets',
    stages: 'Stages',
    rest: 'Rest (sec)',
    stageLength: 'Stage length (sec)',
    minToast: 'Each day needs at least one exercise. 🏋️',
    removeConfirm: (name: string, day: string) => `Remove ${name} from ${day}?`,
    maxToast: (n: number) => `Up to ${n} exercises per day.`,
  },
  superset: {
    taken: 'This exercise is already in another superset',
    link: (a: string, b: string) => `Link ${a} and ${b} into a superset`,
    linkBtn: '🔗 Make a superset',
    tag: '🔗 Superset',
    unlink: (a: string, b: string) => `Undo the superset of ${a} and ${b}`,
    unlinkBtn: '🔗 Linked · undo',
    restNote: '⏱ Shared rest — counted once, after both exercises',
  },
  sheet: {
    newTitle: 'New exercise',
    presetsTitle: 'Ready-made plans',
    addTitle: (day: string) => `Add an exercise · ${day}`,
    addLabel: 'Add an exercise',
    close: 'Close',
  },
  presets: {
    days: (n: number) => (n === 1 ? '1 workout day' : `${n} workout days`),
    mine: 'a plan you saved yourself',
    remove: (name: string) => `Delete ${name}`,
    mineTitle: '⭐ My plans',
    saveCurrent: '⭐ Save the current plan as a ready-made plan',
    note: 'Picking a ready-made plan replaces the current draft. Nothing is saved until you tap 💾 Save, and your history is kept either way. Saving a plan with ⭐ freezes the plan you are editing as it is — you can come back to it from here at any time, even from another device.',
    replaceConfirm: (name: string) => `Replace the plan you are editing with "${name}"? Any unsaved changes will be lost.`,
    loaded: (name: string) => `${name} loaded — tap 💾 Save to apply it`,
    namePrompt: 'What should this saved plan be called?',
    nameDefault: 'My plan',
    saved: (name: string) => `"${name}" saved to your ready-made plans ⭐`,
    deleteConfirm: (name: string) =>
      `Delete "${name}" from your saved plans? Your active plan and your history are not affected.`,
    deleted: (name: string) => `"${name}" deleted`,
  },
  library: {
    allIn: 'Every exercise is already in this day. You can create a new one. ✨',
    newBtn: '✨ Create a new exercise',
    stages: (n: number, reps: string) => `${n} stages × ${reps}`,
    noDemo: 'Custom exercises have no demo — they look the way you do them.',
    add: '➕ Add to day',
    closePreview: 'Close the preview',
  },
  form: {
    name: 'Exercise name *',
    second: 'Name in Hebrew (optional)',
    part: 'Main body part',
    part2: 'Secondary body part (optional)',
    none: 'None',
    unit: 'Unit',
    equip: 'Equipment',
    note: 'A secondary body part splits the XP 70/30 — exactly like the original plan’s exercises.',
    submit: '✨ Add to plan',
    cancel: 'Cancel',
    nameMissing: 'The new exercise needs a name.',
    added: (name: string, day: string) => `${name} added to ${day} ✨`,
  },
  editor: {
    empty: 'This day is still empty — add at least one exercise before saving. 🏋️',
    add: '+ Add exercise',
    save: '💾 Save',
    close: 'Close',
    presets: '📋 Ready-made plans',
    reset: 'Reset to the original plan',
    note: 'Changing the plan never touches your history, XP or records: they are all kept by exercise, so you can reorder, remove and bring back exercises without losing anything.',
    dirty: '⚠️ You have unsaved changes — tap 💾 Save.',
    original: 'This plan is the original plan.',
    saved: 'Plan saved. ✓',
    savedToast: 'Plan saved ✓',
    resetConfirm: 'Reset to the original plan? Custom exercises will be removed from the plan (your history is kept).',
    resetToast: 'Plan reset to the original ✓',
  },
  validate: {
    invalid: 'The plan is not valid',
    customName: 'A custom exercise needs a name',
    nameTooLong: (max: number) => `Exercise name is too long (up to ${max} characters)`,
    minDays: 'The plan needs at least one workout day',
    maxDays: (max: number) => `Up to ${max} workout days in a plan`,
    target: (lo: number, hi: number) => `The weekly workout target must be between ${lo} and ${hi}`,
    dayKey: (label: string) => `${label}: invalid day id`,
    dayKeyTwice: (label: string) => `${label}: the day id appears twice`,
    dayName: 'Every workout day needs a name',
    dayNameTooLong: (max: number) => `Day name is too long (up to ${max} characters)`,
    weekday: (label: string) => `${label}: invalid weekday`,
    emptyDay: (label: string) => `${label}: keep at least one exercise in the day`,
    maxExercises: (label: string, max: number) => `${label}: up to ${max} exercises per day`,
    unknown: (label: string, id: string) => `${label}: unknown exercise (${id})`,
    twice: (label: string, name: string) => `${label}: ${name} appears twice`,
    sets: (name: string, cardio: boolean, lo: number, hi: number) =>
      `${name}: the number of ${cardio ? 'stages' : 'sets'} must be between ${lo} and ${hi}`,
    reps: (name: string) => `${name}: fill in a rep range`,
    rest: (name: string, lo: number, hi: number) => `${name}: rest must be between ${lo} and ${hi} seconds`,
    ssMissing: (label: string) => `${label}: a superset points at an exercise that is not in this day`,
    ssAdjacent: (label: string, a: string, b: string) =>
      `${label}: a superset only works between two neighbouring exercises (${a} and ${b})`,
    ssOnce: (label: string) => `${label}: an exercise can only be in one superset`,
    presetName: 'A saved plan needs a name. ✏️',
    presetMax: (max: number) => `You can save up to ${max} plans — delete an old one first.`,
  },
  day: {
    duration: (minutes: number) => `~${minutes} min`,
    more: (head: string) => `${head} and more`,
  },
  preset: {
    builtin3: {
      name: '3-Day Hypertrophy',
      description: 'The app’s original plan: A/B/C, the whole body over three workouts a week.',
    },
    ab4: {
      name: 'A/B plan — 4 days',
      description:
        'Four days, three workouts: Sunday and Wednesday workout A (legs and pushing), Tuesday workout B1 and Thursday workout B2 (back and pulling).',
      dayA: 'Workout A — legs, pushing & decompression',
      dayB1: 'Workout B1 — back & pulling · pull-up strength',
      dayB2: 'Workout B2 — back & pulling · negatives',
    },
  },
};

export const plan: Catalog<typeof he> = { he, en };
