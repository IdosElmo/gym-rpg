/**
 * i18n/messages/stats.ts — the 📊 סטטיסטיקות screen (ui/stats.ts): the cards,
 * the chart labels and tooltips, the weird-stats lines and the "elephants and
 * buses" tonnage ladder.
 *
 * Values that carry a weight take the unit as an argument (`unit`): the screen
 * shows kilograms or pounds (`i18n/units.ts`), and the Hebrew kilogram label
 * here is the gershayim form `ק״ג` the screen has always printed.
 */

import type { Equivalent } from '../../core/stats.ts';
import type { Catalog } from '../locale.ts';

/** English names of the tonnage ladder, keyed by `Equivalent.id`. */
const EQ_EN: Readonly<Record<string, { one: string; other: string; a: string }>> = {
  gorilla: { one: 'mountain gorilla', other: 'mountain gorillas', a: 'a mountain gorilla' },
  cow: { one: 'cow', other: 'cows', a: 'a cow' },
  car: { one: 'family car', other: 'family cars', a: 'a family car' },
  elephant: { one: 'African elephant', other: 'African elephants', a: 'an African elephant' },
  bus: { one: 'bus', other: 'buses', a: 'a bus' },
  whale: { one: 'blue whale', other: 'blue whales', a: 'a blue whale' },
  eiffel: { one: 'Eiffel Tower', other: 'Eiffel Towers', a: 'the Eiffel Tower' },
};

const s = (n: number, one: string, other: string): string => (n === 1 ? one : other);

const he = {
  kg: 'ק״ג',
  dur: {
    seconds: (n: number) => `${n} שניות`,
    minutes: (n: number) => `${n} דקות`,
    hours: (n: number, txt: string) => (n === 1 ? 'שעה אחת' : `${txt} שעות`),
    hoursMinutes: (hours: string, minutes: number) => `${hours} ו‑${minutes} דקות`,
  },
  set: {
    cardio: (load: string, unit: string, minutes: string) => `${load}${unit} × ${minutes} דק׳`,
    timed: (seconds: string) => `${seconds} שנ׳`,
    reps: (reps: string) => `${reps} חזרות`,
  },
  /** An equivalent's name for a count line ("פילים אפריקאיים"). */
  eqCount: (eq: Equivalent, _n: number) => eq.plural,
  /** An equivalent as the next goal ("ל" + "פיל אפריקאי"). */
  eqGoal: (eq: Equivalent) => eq.he,
  hero: {
    title: '💪 סה״כ הרמתם',
    sub: 'כל הסטים שסומנו ✓',
    eq: (emoji: string, count: string, name: string) => `${emoji} זה <b>${count}</b> ${name}!`,
    first: 'כל ק״ג נספר — גם הראשון. 💪',
    next: (amount: string, goal: string, emoji: string) => `עוד <b>${amount}</b> ל${goal} ${emoji}`,
    top: 'הרמתם יותר ממגדל אייפל. אין לנו יחידות מידה גדולות יותר. 🗼',
  },
  basics: {
    title: '📋 המספרים היבשים',
    since: (date: string) => `מאז ${date}`,
    notYet: 'עדיין לא התחלנו',
    workouts: 'אימונים',
    sets: 'סטים',
    reps: 'חזרות',
    plankSeconds: 'שניות פלאנק',
    cardioMinutes: 'דקות קרדיו',
    prs: 'שיאים אישיים',
    perWeek: 'אימונים לשבוע',
    streak: 'דרגת רצף',
    bestStreak: 'שיא רצף',
    topDay: 'היום החזק',
  },
  spark: {
    point: (date: string, tonnage: string, sets: string, _n: number) => `${date} · ${tonnage} · ${sets} סטים`,
    aria: (n: number) => `טונאז׳ שבועי ב־${n} השבועות האחרונים`,
  },
  weekly: {
    title: '📈 טונאז׳ שבועי',
    sub: (n: number) => `${n} שבועות אחרונים`,
    live: 'השבוע (חי): ',
    peak: 'שיא: ',
    low: 'נמוך: ',
    direction: 'הזמן זורם מימין לשמאל — השבוע הנוכחי בקצה השמאלי.',
  },
  heat: {
    future: (date: string) => `${date} · עוד לא היה`,
    day: (date: string, sets: number, tonnage: string) => `${date} · ${sets} סטים${tonnage ? ` · ${tonnage}` : ''}`,
    aria: (n: number) => `לוח אימונים של ${n} השבועות האחרונים`,
    title: '🗓 לוח האימונים',
    sub: (weeks: number, days: number) => `${weeks} שבועות · ${days} ימי אימון`,
    scale: (swatches: string) => `פחות ${swatches} יותר`,
    now: 'העמודה השמאלית — השבוע הזה',
  },
  balance: {
    most: 'הכי חזק',
    least: 'הכי מוזנח',
    points: (n: string) => `${n} נק׳ עומס`,
    bodyweight: 'משקל גוף',
    title: '⚖️ איזון בין חלקי הגוף',
    sub: 'נקודות עומס לפי החלוקה של מנוע ה‑XP',
    note: (most: string, least: string) =>
      `הכי הרבה עבודה נכנסה ל<b>${most}</b>, והכי מעט ל<b>${least}</b> — שווה סט או שניים נוספים.`,
    empty: 'סמנו עוד סטים כדי לראות איפה הגוף מקבל יותר עבודה ואיפה פחות.',
    definition:
      'נקודת עומס = ק״ג×חזרות בתרגיל עם משקל, וחזרות או שניות בתרגיל משקל גוף — כדי שפלאנק ולחיצת חזה ימדדו על אותו סרגל.',
  },
  bests: {
    sub: (sets: string, sessions: string) => `${sets} סטים · ${sessions} אימונים`,
    growth: (pct: string) => `צמיחה: ${pct}`,
    title: '🥇 השיאים שלכם',
    count: (n: number) => `${n} התרגילים הכי נטענים`,
    exercise: 'תרגיל',
    best: 'הסט הכי טוב',
    first: 'הסט הראשון',
    change: 'שינוי',
  },
  game: {
    waves: 'גלים',
    miniBosses: 'מיני־בוסים',
    worldBosses: 'בוסי עולם',
    dailies: 'אתגרים הושלמו',
    dailyBest: 'שיא אתגר',
    duels: 'דו־קרבות',
    coinsEarned: 'מטבעות שנצברו',
    coinsSpent: 'מטבעות שהוצאו',
    energy: 'אנרגיה שיוצרה',
    title: '🎮 שכבת המשחק',
    sub: 'רק ממה שקרה באמת',
    phone: (energy: string, charges: string) =>
      `⚡ ${energy} אנרגיה — מספיק להטעין טלפון <b>${charges}</b> פעמים.`,
  },
  odd: {
    rest: '⏱ מתחת לטיימר המנוחה',
    restNote: 'הערכה: כל סט שסומן × זמן המנוחה של התרגיל שלו',
    heaviest: '🏋️ הסט הכבד ביותר אי פעם',
    xp: '✨ יעילות XP',
    xpPerTon: (n: string) => `${n} XP לכל טונה`,
    xpPerThousand: (n: string, unit: string) => `${n} XP לכל 1,000 ${unit}`,
    xpNote: (unit: string) => `כמה ניסיון הרווחתם על כל 1,000 ${unit} שהזזתם`,
    loyal: '🤝 התרגיל הכי נאמן',
    loyalNote: (n: string) => `הופיע ב‑${n} אימונים שונים`,
    gap: '🛌 ההפסקה הארוכה ששרדתם',
    gapDays: (n: string) => `${n} ימים`,
    gapNote: (from: string, to: string) => `${from} ← ${to} · וחזרתם 💪`,
    title: '🎲 סטטיסטיקות מוזרות',
    sub: 'כי למה לא',
  },
  empty: {
    title: '📊 עוד אין מה לספור',
    sub: 'בינתיים',
    note: `סמנו ✓ על הסט הראשון שלכם, וכאן יתחילו להצטבר: כמה ק״ג הרמתם בסך הכול
      (ובכמה פילים זה מסתכם), טונאז׳ שבועי, לוח אימונים, איזון בין חלקי הגוף והשיאים בכל תרגיל.`,
    local: 'הכול מחושב מהאימונים שלכם במכשיר — שום דבר לא נשלח לשום מקום.',
  },
};

const en: typeof he = {
  kg: 'kg',
  dur: {
    seconds: (n: number) => `${n} ${s(n, 'second', 'seconds')}`,
    minutes: (n: number) => `${n} ${s(n, 'minute', 'minutes')}`,
    hours: (n: number, txt: string) => (n === 1 ? '1 hour' : `${txt} hours`),
    hoursMinutes: (hours: string, minutes: number) => `${hours} and ${minutes} ${s(minutes, 'minute', 'minutes')}`,
  },
  set: {
    cardio: (load: string, unit: string, minutes: string) => `${load}${unit} × ${minutes} min`,
    timed: (seconds: string) => `${seconds} s`,
    reps: (reps: string) => `${reps} reps`,
  },
  eqCount: (eq: Equivalent, n: number) => {
    const name = EQ_EN[eq.id];
    return name ? (n === 1 ? name.one : name.other) : eq.plural;
  },
  eqGoal: (eq: Equivalent) => EQ_EN[eq.id]?.a ?? eq.he,
  hero: {
    title: '💪 Total lifted',
    sub: 'every set checked ✓',
    eq: (emoji: string, count: string, name: string) => `${emoji} That's <b>${count}</b> ${name}!`,
    first: 'Every rep counts — the first one too. 💪',
    next: (amount: string, goal: string, emoji: string) => `<b>${amount}</b> more to lift ${goal} ${emoji}`,
    top: "You've lifted more than the Eiffel Tower. We have no bigger units. 🗼",
  },
  basics: {
    title: '📋 The raw numbers',
    since: (date: string) => `since ${date}`,
    notYet: 'not started yet',
    workouts: 'Workouts',
    sets: 'Sets',
    reps: 'Reps',
    plankSeconds: 'Plank seconds',
    cardioMinutes: 'Cardio minutes',
    prs: 'Personal records',
    perWeek: 'Workouts / week',
    streak: 'Streak tier',
    bestStreak: 'Best streak',
    topDay: 'Strongest day',
  },
  spark: {
    point: (date: string, tonnage: string, sets: string, n: number) => `${date} · ${tonnage} · ${sets} ${s(n, 'set', 'sets')}`,
    aria: (n: number) => `Weekly tonnage over the last ${n} weeks`,
  },
  weekly: {
    title: '📈 Weekly tonnage',
    sub: (n: number) => `last ${n} weeks`,
    live: 'This week (live): ',
    peak: 'Peak: ',
    low: 'Low: ',
    direction: 'Time runs left to right — this week is at the right edge.',
  },
  heat: {
    future: (date: string) => `${date} · not yet`,
    day: (date: string, sets: number, tonnage: string) =>
      `${date} · ${sets} ${s(sets, 'set', 'sets')}${tonnage ? ` · ${tonnage}` : ''}`,
    aria: (n: number) => `Training calendar of the last ${n} weeks`,
    title: '🗓 Training calendar',
    sub: (weeks: number, days: number) => `${weeks} weeks · ${days} training ${s(days, 'day', 'days')}`,
    scale: (swatches: string) => `Less ${swatches} More`,
    now: 'Rightmost column — this week',
  },
  balance: {
    most: 'strongest',
    least: 'most neglected',
    points: (n: string) => `${n} load pts`,
    bodyweight: 'bodyweight',
    title: '⚖️ Body-part balance',
    sub: 'load points, split the way the XP engine splits them',
    note: (most: string, least: string) =>
      `Most of the work went into <b>${most}</b> and the least into <b>${least}</b> — worth a set or two more.`,
    empty: 'Check off more sets to see where your body gets more work and where it gets less.',
    definition:
      'One load point = kg × reps on a weighted exercise, and reps or seconds on a bodyweight one — so a plank and a bench press are measured on the same ruler.',
  },
  bests: {
    sub: (sets: string, sessions: string) => `${sets} sets · ${sessions} workouts`,
    growth: (pct: string) => `Growth: ${pct}`,
    title: '🥇 Your records',
    count: (n: number) => `your ${n} most-loaded exercises`,
    exercise: 'Exercise',
    best: 'Best set',
    first: 'First set',
    change: 'Change',
  },
  game: {
    waves: 'Waves',
    miniBosses: 'Mini-bosses',
    worldBosses: 'World bosses',
    dailies: 'Challenges completed',
    dailyBest: 'Best challenge',
    duels: 'Duels (W‑L)',
    coinsEarned: 'Coins earned',
    coinsSpent: 'Coins spent',
    energy: 'Energy generated',
    title: '🎮 The game layer',
    sub: 'only from what really happened',
    phone: (energy: string, charges: string) =>
      `⚡ ${energy} energy — enough to charge a phone <b>${charges}</b> times.`,
  },
  odd: {
    rest: '⏱ Under the rest timer',
    restNote: "estimate: every checked set × its exercise's rest time",
    heaviest: '🏋️ Heaviest set ever',
    xp: '✨ XP efficiency',
    xpPerTon: (n: string) => `${n} XP per tonne`,
    xpPerThousand: (n: string, unit: string) => `${n} XP per 1,000 ${unit}`,
    xpNote: (unit: string) => `XP earned for every 1,000 ${unit} you moved`,
    loyal: '🤝 Most loyal exercise',
    loyalNote: (n: string) => `showed up in ${n} different workouts`,
    gap: '🛌 Longest break you survived',
    gapDays: (n: string) => `${n} days`,
    gapNote: (from: string, to: string) => `${from} → ${to} · and you came back 💪`,
    title: '🎲 Weird stats',
    sub: 'because why not',
  },
  empty: {
    title: '📊 Nothing to count yet',
    sub: 'for now',
    note: `Check ✓ your first set and this is where it adds up: how much you've lifted in total
      (and how many elephants that comes to), weekly tonnage, a training calendar, body-part balance and your best in every exercise.`,
    local: 'Everything is computed from your workouts on this device — nothing is sent anywhere.',
  },
};

export const stats: Catalog<typeof he> = { he, en };
