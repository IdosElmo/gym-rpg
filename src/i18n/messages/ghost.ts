/**
 * i18n/messages/ghost.ts — the ⚔️ ghost-duel card on the קרב screen
 * (ui/ghost.ts) and the lookup errors the arena puts on it.
 *
 * Every Hebrew value is the exact string the card printed before i18n (the DOM
 * tests pin them). A ghost's NAME is user content — the handle they chose — and
 * is never translated.
 */

import type { Catalog } from '../locale.ts';

const he = {
  figureLabel: (name: string) => `הדמות של ${name}`,
  level: (lvl: number) => `רמה ${lvl}`,
  streak: (tier: number) => ` · 🔥 רצף ${tier}`,
  gear: (n: number) => ` · ${n} פריטי ציוד`,
  /** `tally` is already-escaped HTML. */
  record: (tally: string) => `מאזן מולו: <b>${tally}</b>`,
  neverMet: 'עוד לא נפגשתם',
  chip: '⚔️ דו־קרב רפאים',
  overall: (tally: string) => `מאזן כללי ${tally}`,
  /** `handle` is already-escaped HTML. */
  me: (handle: string) => `אתם: <b>${handle}</b>`,
  handleLabel: 'שם הלוחם של היריב',
  placeholder: 'לדוגמה: יוסי',
  searching: '⏳ מחפש…',
  search: '🔍 חיפוש',
  ghostFell: 'הרוח נפלה!',
  inProgress: 'הקרב בעיצומו',
  liveNote: 'יציאה מהזירה עכשיו נחשבת הפסד — הדו־קרב של היום מול היריב הזה כבר נספר.',
  idleNote:
    'בקשו מהיריב את "שם הלוחם" שלו (מסך ההגדרות), הקלידו אותו כאן — ותילחמו בדמות האמיתית שלו: הרמות, הרצף והציוד שלו.',
  cardLabel: 'דו־קרב רפאים',
  foot: (fee: number, win: number, loss: number) =>
    `${fee} ⚡ לדו־קרב · ניצחון ${win} 🪙, הפסד ${loss} 🪙 · דו־קרב אחד ליום מול כל יריב.`,
  won: '🏆 ניצחתם',
  lost: '💀 הפסדתם',
  doneNote: (coins: number) => `‏+${coins} 🪙 · הדו־קרב של היום מולו כבר נוצל — מחר אפשר שוב.`,
  lockedBtn: (fee: number) => `🔒 חסרה אנרגיה · ${fee} ⚡`,
  lockedNote: (have: string, fee: number, perSet: number) =>
    `יש לכם ${have} ⚡ מתוך ${fee}. לכו להתאמן — כל סט מסומן שווה ${perSet} ⚡.`,
  go: (fee: number) => `⚔️ צאו לדו־קרב · ${fee} ⚡`,
  dev: 'הדמות הזו קיבלה הענקות במצב מפתח (לא רק אימונים אמיתיים)',
  missing: (handle: string) =>
    `לא נמצא לוחם בשם "${handle}". בדקו את האיות — היריב רואה את השם שלו במסך ההגדרות.`,
  lookupFailed: 'החיפוש נכשל — בדקו את החיבור לאינטרנט ונסו שוב.',
  badPayload: 'הנתונים של היריב לא נקראים — אולי הוא משתמש בגרסה אחרת של האפליקציה.',
  noHandle: 'עדיין אין לכם שם לוחם — קבעו אחד במסך ההגדרות כדי להילחם.',
};

const en: typeof he = {
  figureLabel: (name: string) => `${name}'s hero`,
  level: (lvl: number) => `Level ${lvl}`,
  streak: (tier: number) => ` · 🔥 streak ${tier}`,
  gear: (n: number) => ` · ${n} gear`,
  record: (tally: string) => `Your record vs them: <b>${tally}</b>`,
  neverMet: "You haven't met yet",
  chip: '⚔️ Ghost duel',
  overall: (tally: string) => `Overall ${tally}`,
  me: (handle: string) => `You: <b>${handle}</b>`,
  handleLabel: "Opponent's fighter name",
  placeholder: 'e.g. Alex',
  searching: '⏳ Searching…',
  search: '🔍 Search',
  ghostFell: 'The ghost fell!',
  inProgress: 'Fight in progress',
  liveNote: "Leaving the arena now counts as a loss — today's duel with this opponent is already counted.",
  idleNote:
    'Ask your opponent for their "fighter name" (on their Settings screen), type it here — and fight their real hero: their levels, streak and gear.',
  cardLabel: 'Ghost duel',
  foot: (fee: number, win: number, loss: number) =>
    `${fee} ⚡ per duel · win ${win} 🪙, loss ${loss} 🪙 · one duel a day per opponent.`,
  won: '🏆 You won',
  lost: '💀 You lost',
  doneNote: (coins: number) => `+${coins} 🪙 · today's duel with them is used — again tomorrow.`,
  lockedBtn: (fee: number) => `🔒 Not enough energy · ${fee} ⚡`,
  lockedNote: (have: string, fee: number, perSet: number) =>
    `You have ${have} ⚡ of ${fee}. Go train — every logged set is worth ${perSet} ⚡.`,
  go: (fee: number) => `⚔️ Start the duel · ${fee} ⚡`,
  dev: 'This hero got dev-mode grants (not only real training)',
  missing: (handle: string) =>
    `No fighter named "${handle}". Check the spelling — your opponent can see their name in Settings.`,
  lookupFailed: 'Search failed — check your internet connection and try again.',
  badPayload: "Can't read this opponent's data — they may be on another version of the app.",
  noHandle: "You don't have a fighter name yet — set one in Settings to fight.",
};

export const ghost: Catalog<typeof he> = { he, en };
