/**
 * i18n/messages/league.ts — the 🏆 ליגה screen's chrome (ui/league.ts): the
 * live week, the monthly race, the shop around the prize pool, the history and
 * every refusal and toast.
 *
 * The prize pool ITSELF (titles and details of gifts, experiences and
 * challenges, `data/leaguePools.ts`) is content and is not in this catalog.
 */

import type { LeagueSpendError } from '../../core/league.ts';
import type { HandleError } from '../../core/handle.ts';
import type { Catalog } from '../locale.ts';

const ERRORS_HE: Readonly<Record<LeagueSpendError, string>> = {
  unknown_item: 'הפריט הזה לא קיים בליגה.',
  wrong_month: 'הפריט הזה לא שייך לחנות של החודש הזה.',
  already_redeemed: 'הפריט הזה כבר נפדה החודש — אחד לכל חודש.',
  challenge_already_set: 'כבר בחרתם אתגר לחודש הזה — אחד בלבד.',
  no_challenge: 'לא בחרתם אתגר לחודש הזה.',
  already_completed: 'האתגר הזה כבר סומן כהושלם.',
  insufficient_coins: 'אין מספיק 🔵 — כל שבוע מלא מזכה במטבע אחד.',
};
const HANDLE_ERRORS_HE: Readonly<Record<HandleError, string>> = {
  empty: 'הקלידו את שם הלוחם של היריב.',
  too_short: 'שם לוחם הוא לפחות 3 תווים.',
  too_long: 'שם לוחם הוא עד 20 תווים.',
  bad_chars: 'שם לוחם יכול לכלול אותיות בעברית או באנגלית, ספרות ו־ _ . -',
};


const he = {
  errors: ERRORS_HE,
  handleErrors: HANDLE_ERRORS_HE,
  self: 'זה אתם — חפשו את השם של מישהו אחר.',
  missing: (handle: string) =>
    `לא נמצאו שבועות בשם "${handle}". בדקו את האיות — היריב רואה את השם שלו במסך ההגדרות.`,
  dev: 'החשבון הזה קיבל הענקות במצב מפתח (לא רק אימונים אמיתיים)',
  honor: 'הזוכה החודשי קונה — כבוד המשחק!',
  behind: 'אתם מפגרים החודש. אפשר לפדות — האפליקציה לא חוסמת — אבל הכבוד אומר לחכות לסיום החודש.',
  comp: { c: 'עקביות', q: 'השלמה', l: 'עומס', p: 'שיאים' },
  live: {
    days: (days: number, target: number) => `${days} מתוך ${target} ימים`,
    sets: (done: number, planned: number) => `${done} מתוך ${planned} סטים`,
    load: (volume: string, baseline: string) => `${volume} מול בסיס ${baseline}`,
    firstWeek: 'שבוע ראשון — אין בסיס להשוואה',
    noLoad: 'עדיין בלי עומס',
    prs: (prs: number, target: number) => `${prs} מתוך ${target} שיאים`,
  },
  record: {
    days: (days: number) => `${days} ימי אימון`,
    points: (volume: string) => `${volume} נק׳`,
    prs: (prs: number) => `${prs} שיאים`,
  },
  gate: {
    earned: '🔵 השבוע הזה כבר מזכה במטבע ✓',
    notStarted: (days: number) => `כדי לזכות ב־🔵 השבוע: עוד ${days} ימי אימון — עדיין לא התאמנתם.`,
    days: (n: number) => (n === 1 ? 'עוד יום אימון אחד' : `עוד ${n} ימי אימון`),
    sets: (n: number) => (n === 1 ? 'עוד סט אחד' : `עוד ${n} סטים`),
    finish: 'כדי לזכות ב־🔵 השבוע: השלימו את הסטים של הימים שנותרו.',
    need: (parts: readonly string[]) => `כדי לזכות ב־🔵 השבוע: ${parts.join(' ו')}.`,
  },
  stale: (day: string, time: string) => `נכון ל־${day}, ${time} — לא הצלחנו לרענן עכשיו.`,
  /** Month names by number (1 = January); Hebrew reads them off the pool instead. */
  months: [] as readonly string[],
  liveCard: {
    title: 'השבוע שלי',
    points: 'נקודות · מתוך 100',
    note: 'השבוע נסגר במוצאי שבת ונרשם ליומן. עד אז הציון זז עם כל סט.',
  },
  noWeek: 'אין שבוע',
  inProgress: 'בהתהוות',
  leader: {
    tie: (score: string) => `תיקו — ${score} נקודות לכל אחד.`,
    mine: (diff: string) => `אתם מובילים ב־${diff} נקודות.`,
    theirs: (name: string, diff: string) => `${name} מוביל/ה ב־${diff} נקודות.`,
  },
  race: {
    title: 'המרוץ החודשי',
    you: (handle: string) => `🏁 אתם: <b>${handle}</b>`,
    label: 'שם הלוחם של היריב/ה',
    placeholder: 'לדוגמה: יוסי',
    aria: 'שם הלוחם של היריב',
    loading: '⏳ טוען…',
    search: '🔍 חיפוש',
    invite:
      'בקשו מהיריב/ה את "שם הלוחם" (מסך ההגדרות), הקלידו אותו כאן — והחודש שלכם יעמוד מול החודש שלו/ה, שבוע מול שבוע.',
    me: 'אני',
    total: 'סה״כ',
    liveTotal: (score: string) => `‎+${score} בהתהוות`,
    closedOnly: 'הסה״כ סופר שבועות סגורים בלבד — משני הצדדים. השבוע שבהתהוות ייכנס כשייסגר.',
  },
  item: {
    bonus: (n: number) => ` · בונוס ${n} 🔵`,
    completed: 'הושלם',
    redeemed: 'נפדה',
    stake: (price: number) => `⚔️ הימור · 🔵 ${price}`,
    redeem: (price: number) => `פדיון · 🔵 ${price}`,
  },
  sheet: {
    aria: 'אישור הוצאה',
    price: (cost: number, coins: number) => `מחיר: <b>🔵 ${cost}</b> · יש לכם: <b>🔵 ${coins}</b>`,
    missing: (n: number) => `חסרים ${n}`,
    stakeNote: (cost: number, bonus: number) =>
      `הימור: ${cost} 🔵 עכשיו, ${bonus} 🔵 בחזרה כשמסמנים "השלמתי". אתגר אחד לחודש.`,
    redeemNote: (honor: string) => `${honor} הפדיון נרשם ביומן ולא ניתן לביטול.`,
    confirmStake: '⚔️ אני מהמר/ת',
    confirmRedeem: '🔵 פדיון',
    cancel: 'ביטול',
  },
  shop: {
    title: 'חנות החודש',
    stakedPrice: (cost: number, bonus: number) => `הימור 🔵 ${cost} · בונוס ${bonus} 🔵`,
    done: 'השלמתי ✓',
    completed: 'הושלם',
    purse: (earned: number, spent: number) => `מטבעות ליגה · ${earned} נצברו · ${spent} הוצאו`,
    rewards: '🎁 מתנות · 🌄 חוויות',
    challenge: '⚔️ אתגר החודש',
    activeStake: 'הימור פעיל',
    oneAMonth: 'אחד לחודש, מוחזר עם בונוס',
  },
  history: {
    aria: 'היסטוריית הליגה',
    title: 'היסטוריה',
    sub: 'חודשים שנסגרו',
    empty: 'עוד אין חודשים סגורים. החודש הראשון ייכנס לכאן ברגע שיתחלף.',
    points: 'נק׳',
    weeks: (n: number) => `${n} שבועות`,
  },
  toast: {
    redeemed: (cost: number) => `נפדה! 🔵 ${cost} ירדו מהארנק.`,
    staked: 'ההימור נרשם — בהצלחה! ⚔️',
    completed: 'כל הכבוד! הבונוס נכנס לארנק 🔵',
  },
};

const en: typeof he = {
  errors: {
    unknown_item: "This item doesn't exist in the league.",
    wrong_month: "This item isn't in this month's shop.",
    already_redeemed: 'Already redeemed this month — one per month.',
    challenge_already_set: "You've already picked a challenge this month — just one.",
    no_challenge: "You haven't picked a challenge this month.",
    already_completed: 'This challenge is already marked as done.',
    insufficient_coins: 'Not enough 🔵 — every full week earns one coin.',
  },
  handleErrors: {
    empty: "Type your rival's warrior name.",
    too_short: 'A warrior name is at least 3 characters.',
    too_long: 'A warrior name is at most 20 characters.',
    bad_chars: 'A warrior name may use Hebrew or English letters, digits and _ . -',
  },
  self: "That's you — search for someone else's name.",
  missing: (handle: string) =>
    `No weeks found for "${handle}". Check the spelling — your rival can see their name on the Settings screen.`,
  dev: 'This account received dev-mode grants (not only real training)',
  honor: "The month's winner buys — that's the game's honor!",
  behind:
    "You're behind this month. You can still redeem — the app won't stop you — but honor says wait for the month to end.",
  comp: { c: 'Consistency', q: 'Completion', l: 'Load', p: 'Records' },
  live: {
    days: (days: number, target: number) => `${days} of ${target} days`,
    sets: (done: number, planned: number) => `${done} of ${planned} sets`,
    load: (volume: string, baseline: string) => `${volume} vs. baseline ${baseline}`,
    firstWeek: 'first week — no baseline yet',
    noLoad: 'no load yet',
    prs: (prs: number, target: number) => `${prs} of ${target} records`,
  },
  record: {
    days: (days: number) => `${days} training ${days === 1 ? 'day' : 'days'}`,
    points: (volume: string) => `${volume} pts`,
    prs: (prs: number) => `${prs} ${prs === 1 ? 'record' : 'records'}`,
  },
  gate: {
    earned: '🔵 This week already earns a coin ✓',
    notStarted: (days: number) =>
      `To earn 🔵 this week: ${days} more training ${days === 1 ? 'day' : 'days'} — you haven't trained yet.`,
    days: (n: number) => (n === 1 ? '1 more training day' : `${n} more training days`),
    sets: (n: number) => (n === 1 ? '1 more set' : `${n} more sets`),
    finish: 'To earn 🔵 this week: finish the sets of the days left.',
    need: (parts: readonly string[]) => `To earn 🔵 this week: ${parts.join(' and ')}.`,
  },
  stale: (day: string, time: string) => `As of ${day}, ${time} — couldn't refresh just now.`,
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  liveCard: {
    title: 'My week',
    points: 'points · out of 100',
    note: 'The week closes on Saturday night and goes into the log. Until then the score moves with every set.',
  },
  noWeek: 'no week',
  inProgress: 'in progress',
  leader: {
    tie: (score: string) => `Tied — ${score} points each.`,
    mine: (diff: string) => `You lead by ${diff} points.`,
    theirs: (name: string, diff: string) => `${name} leads by ${diff} points.`,
  },
  race: {
    title: 'The monthly race',
    you: (handle: string) => `🏁 You: <b>${handle}</b>`,
    label: "Rival's warrior name",
    placeholder: 'e.g. alex',
    aria: "Rival's warrior name",
    loading: '⏳ Loading…',
    search: '🔍 Search',
    invite:
      'Ask your rival for their "warrior name" (on the Settings screen) and type it here — your month goes up against theirs, week by week.',
    me: 'Me',
    total: 'Total',
    liveTotal: (score: string) => `+${score} in progress`,
    closedOnly: 'The total counts closed weeks only — on both sides. The week in progress counts once it closes.',
  },
  item: {
    bonus: (n: number) => ` · bonus ${n} 🔵`,
    completed: 'completed',
    redeemed: 'redeemed',
    stake: (price: number) => `⚔️ Stake · 🔵 ${price}`,
    redeem: (price: number) => `Redeem · 🔵 ${price}`,
  },
  sheet: {
    aria: 'Confirm spending',
    price: (cost: number, coins: number) => `Price: <b>🔵 ${cost}</b> · You have: <b>🔵 ${coins}</b>`,
    missing: (n: number) => `${n} short`,
    stakeNote: (cost: number, bonus: number) =>
      `Stake: ${cost} 🔵 now, ${bonus} 🔵 back when you mark it "Done". One challenge a month.`,
    redeemNote: (honor: string) => `${honor} A redemption goes into the log and can't be undone.`,
    confirmStake: "⚔️ I'm in",
    confirmRedeem: '🔵 Redeem',
    cancel: 'Cancel',
  },
  shop: {
    title: "This month's shop",
    stakedPrice: (cost: number, bonus: number) => `Stake 🔵 ${cost} · bonus ${bonus} 🔵`,
    done: 'Done ✓',
    completed: 'Completed',
    purse: (earned: number, spent: number) => `league coins · ${earned} earned · ${spent} spent`,
    rewards: '🎁 Gifts · 🌄 Experiences',
    challenge: "⚔️ This month's challenge",
    activeStake: 'active stake',
    oneAMonth: 'one a month, returned with a bonus',
  },
  history: {
    aria: 'League history',
    title: 'History',
    sub: 'settled months',
    empty: 'No settled months yet. The first one lands here as soon as the month turns.',
    points: 'pts',
    weeks: (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`,
  },
  toast: {
    redeemed: (cost: number) => `Redeemed! 🔵 ${cost} left your purse.`,
    staked: 'Stake placed — good luck! ⚔️',
    completed: 'Well done! The bonus is in your purse 🔵',
  },
};

export const league: Catalog<typeof he> = { he, en };
