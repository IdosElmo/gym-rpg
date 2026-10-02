/**
 * i18n/messages/weight.ts — the ⚖️ weight screen (view `WT`).
 *
 * Every Hebrew value is the exact string ui/weight.ts printed before i18n (the
 * DOM tests pin them). Weights arrive already formatted (`w`) together with
 * their unit (`u`) — kilograms or pounds is the units module's business, not
 * the catalog's.
 */

import type { Catalog } from '../locale.ts';

const he = {
  /** The body-weight unit in Hebrew copy (gershayim, as the screen always printed it). */
  kg: 'ק״ג',
  ranges: { 10: '10 אחרונות', 30: '30 אחרונות', all: 'הכל' },
  headlineEmpty: 'עוד לא נרשמה שקילה — הראשונה נרשמת במסך הזה',
  headline: (w: string, u: string, change: string) => `אחרון: ${w} ${u}${change}`,
  headlineChange: (delta: string) => ` · ${delta} מהשקילה הקודמת`,
  chartAria: (n: number, lo: string, hi: string, u: string) =>
    `משקל ב־${n} השקילות האחרונות, מ־${lo} עד ${hi} ${u}`,
  ring: {
    ofTheWay: 'מהדרך',
    sinceStart: 'מההתחלה',
    goal: (w: string, u: string) => `🎯 יעד ${w} ${u}`,
    count: (n: number) => `⚖️ ${n} שקילות`,
    noGoal: 'ללא יעד',
    reached: 'היעד הושג ✓',
    left: (w: string, u: string) => `נותרו ${w} ${u}`,
    ariaGoal: (pct: string, w: string, u: string) => `${pct} מהדרך ליעד ${w} ${u}`,
    ariaNoGoal: (n: number) => `${n} שקילות, ללא יעד`,
  },
  summary: {
    title: 'המשקל שלי',
    empty: 'עוד לא נרשמה שקילה — הראשונה נרשמת למטה 👇',
    goalHint: 'הגדירו משקל יעד למטה — והעיגול יראה כמה מהדרך כבר מאחוריכם.',
    goalReached: (w: string, u: string) => `🎯 היעד הושג — ${w} ${u}!`,
    goalLeft: (w: string, u: string) => `🎯 עוד ${w} ${u} ליעד`,
    trend: (w: string, u: string) => `מגמה ${w} ${u}`,
    /** `range` is markup (an LTR span). */
    range: (range: string, u: string) => `טווח ${range} ${u}`,
    sincePrev: 'מהקודמת',
    days7: '7 ימים',
    days30: '30 ימים',
    sinceFirst: 'מההתחלה',
  },
  chart: {
    rangeAria: 'טווח הגרף',
    goalOff: (w: string, u: string) => `יעד ${w} ${u} — מחוץ לטווח הגרף`,
    /** `w` is markup (`<b>…</b>`). */
    goal: (w: string) => `יעד ${w}`,
    title: '📈 מגמת המשקל',
    count: (n: number) => `${n} שקילות`,
    weight: 'משקל',
    avg: (n: number) => `ממוצע ${n} שקילות`,
    note: 'הזמן זורם מימין לשמאל — השקילה האחרונה בקצה השמאלי. כל נקודה היא שקילה אחת.',
  },
  add: {
    title: 'רישום שקילה',
    weight: (u: string) => `משקל (${u})`,
    date: 'תאריך',
    time: 'שעה',
    note: 'הערה',
    optional: 'לא חובה',
    notePlaceholder: 'למשל: בבוקר, אחרי אימון',
    submit: 'רישום',
    tip: 'הכי מדויק: אותה שעה, אותם תנאים — למשל כל בוקר לפני הארוחה.',
  },
  history: {
    title: 'השקילות שלי',
    deleteAria: (date: string) => `מחיקת השקילה מ־${date}`,
    posTitle: 'בין הקל ביותר לכבד ביותר',
    more: (shown: number, all: number) => `מוצגות ${shown} השקילות האחרונות מתוך ${all} — גוללים בתוך הרשימה.`,
    scroll: 'גוללים בתוך הרשימה לשקילות ישנות יותר.',
  },
  target: {
    title: 'משקל יעד',
    optional: 'לא חובה',
    field: (u: string) => `יעד (${u})`,
    save: 'שמירת יעד',
    note: 'היעד מצויר כקו על הגרף. ריק = בלי יעד.',
  },
  confirmDelete: 'למחוק את השקילה? הנקודה תוסר מהגרף.',
  err: {
    weight: (min: string, max: string, u: string) => `המשקל צריך להיות מספר בין ${min} ל־${max} ${u}.`,
    date: 'התאריך לא תקין — ושקילה לא יכולה להיות בעתיד.',
    failed: 'לא הצלחנו לרשום את השקילה — בדקו את הפרטים.',
    target: (min: string, max: string, u: string) => `היעד צריך להיות מספר בין ${min} ל־${max} ${u} (או ריק).`,
  },
  toast: {
    logged: 'השקילה נרשמה ⚖️',
    targetCleared: 'היעד הוסר',
    targetSaved: 'היעד נשמר 🎯',
  },
};

const weighIns = (n: number): string => `${n} ${n === 1 ? 'weigh-in' : 'weigh-ins'}`;

const en: typeof he = {
  kg: 'kg',
  ranges: { 10: 'Last 10', 30: 'Last 30', all: 'All' },
  headlineEmpty: 'No weigh-ins yet — log your first one on this screen',
  headline: (w: string, u: string, change: string) => `Latest: ${w} ${u}${change}`,
  headlineChange: (delta: string) => ` · ${delta} since the previous weigh-in`,
  chartAria: (n: number, lo: string, hi: string, u: string) =>
    `Weight over the last ${weighIns(n)}, from ${lo} to ${hi} ${u}`,
  ring: {
    ofTheWay: 'of the way',
    sinceStart: 'since start',
    goal: (w: string, u: string) => `🎯 Goal ${w} ${u}`,
    count: (n: number) => `⚖️ ${weighIns(n)}`,
    noGoal: 'No goal',
    reached: 'Goal reached ✓',
    left: (w: string, u: string) => `${w} ${u} to go`,
    ariaGoal: (pct: string, w: string, u: string) => `${pct} of the way to the ${w} ${u} goal`,
    ariaNoGoal: (n: number) => `${weighIns(n)}, no goal`,
  },
  summary: {
    title: 'My weight',
    empty: 'No weigh-ins yet — log your first one below 👇',
    goalHint: 'Set a goal weight below — the ring will show how much of the way is behind you.',
    goalReached: (w: string, u: string) => `🎯 Goal reached — ${w} ${u}!`,
    goalLeft: (w: string, u: string) => `🎯 ${w} ${u} to your goal`,
    trend: (w: string, u: string) => `Trend ${w} ${u}`,
    range: (range: string, u: string) => `Range ${range} ${u}`,
    sincePrev: 'vs. last',
    days7: '7 days',
    days30: '30 days',
    sinceFirst: 'since start',
  },
  chart: {
    rangeAria: 'Chart range',
    goalOff: (w: string, u: string) => `Goal ${w} ${u} — outside the chart's range`,
    goal: (w: string) => `Goal ${w}`,
    title: '📈 Weight trend',
    count: (n: number) => weighIns(n),
    weight: 'Weight',
    avg: (n: number) => `${n}-weigh-in average`,
    note: 'Time runs left to right — the latest weigh-in is at the right edge. Each dot is one weigh-in.',
  },
  add: {
    title: 'Log a weigh-in',
    weight: (u: string) => `Weight (${u})`,
    date: 'Date',
    time: 'Time',
    note: 'Note',
    optional: 'optional',
    notePlaceholder: 'e.g. morning, after training',
    submit: 'Log',
    tip: 'Most accurate: same time, same conditions — e.g. every morning before breakfast.',
  },
  history: {
    title: 'My weigh-ins',
    deleteAria: (date: string) => `Delete the weigh-in from ${date}`,
    posTitle: 'Between your lightest and heaviest',
    more: (shown: number, all: number) => `Showing the latest ${shown} of ${all} weigh-ins — scroll inside the list.`,
    scroll: 'Scroll inside the list for older weigh-ins.',
  },
  target: {
    title: 'Goal weight',
    optional: 'optional',
    field: (u: string) => `Goal (${u})`,
    save: 'Save goal',
    note: 'The goal is drawn as a line on the chart. Empty = no goal.',
  },
  confirmDelete: 'Delete this weigh-in? Its point will be removed from the chart.',
  err: {
    weight: (min: string, max: string, u: string) => `Weight must be a number between ${min} and ${max} ${u}.`,
    date: "That date isn't valid — and a weigh-in can't be in the future.",
    failed: "Couldn't log the weigh-in — check the details.",
    target: (min: string, max: string, u: string) => `The goal must be a number between ${min} and ${max} ${u} (or empty).`,
  },
  toast: {
    logged: 'Weigh-in logged ⚖️',
    targetCleared: 'Goal removed',
    targetSaved: 'Goal saved 🎯',
  },
};

export const weight: Catalog<typeof he> = { he, en };
