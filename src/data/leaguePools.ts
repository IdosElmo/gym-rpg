/**
 * data/leaguePools.ts — הליגה's twelve monthly pools, in two prize modes.
 *
 * TWO SETS OF POOLS. `LEAGUE_POOLS` + `BASE_REWARDS` are the COUPLE's (the
 * month's winner is treated by the loser) and are pinned by tests/league.test.ts
 * — ids, Hebrew and order. `PERSONAL_POOLS` + `PERSONAL_BASE_REWARDS` are the
 * same shape for one person rewarding themself (`p_`-prefixed ids). Which one
 * the shop shows is a device preference (`PrizeMode`); every id resolves in
 * `leagueItemById` whichever is on. English for every item lives beside this
 * file in `i18n/content/leaguePools.en.ts` and is read through
 * `i18n/leagueText.ts` — the Hebrew here stays the original.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER COPY — EDIT FREELY.
 * Every Hebrew string below is content, not mechanics: the two people playing
 * this league are meant to rewrite the gifts, the experiences and the challenge
 * targets to things THEY actually want. Nothing in `core/` reads any of this
 * text; the ledger only ever stores an ID, a kind and a price. Changing the copy
 * of an item therefore never rewrites history — and changing an item's ID does,
 * which is why the ids below are opaque (`gift_03_2`) rather than descriptive.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHY A POOL PER MONTH. A single global list would be shopped once and then
 * ignored; twelve small pools that rotate with the calendar keep the prize
 * always slightly out of reach and always slightly new — and they let the copy
 * be seasonal (a winter month can offer soup, a summer month a beach day).
 * `poolOfMonth('2026-08')` is a pure function of the month NUMBER, so both
 * accounts in the league always see exactly the same pool, offline, for ever.
 *
 * PRICES come from `BALANCE.league.prices` by KIND — never typed per item — so
 * the economy is tuned in one place and no pool can quietly inflate.
 *
 * CHALLENGES are a stake, not a purchase: setting one costs `prices.challenge`
 * 🔵 and completing it pays `bonus` 🔵 back. Completion is SELF-REPORTED (the UI
 * stage adds the button); the event only records what was claimed, which is the
 * right level of trust for a two-person league that shares a kitchen.
 */

import { BALANCE } from '../core/balance.ts';

/** What kind of thing a pool item is — also what it costs. */
export type LeagueItemKind = 'gift' | 'experience' | 'challenge';

/**
 * WHO THE PRIZES ARE FOR. `couple` — the original league: two people who share
 * a kitchen, and the month's winner is treated by the loser (every pool above
 * `PERSONAL_POOLS`). `personal` — a reward a person buys THEMSELF for training
 * consistently, whoever they race or do not race.
 *
 * A DEVICE PREFERENCE (`UiState.prizes`), like the language: it chooses which
 * shop is on screen and nothing else. It never enters an event — a redemption
 * stores an item id, and every id resolves in `leagueItemById` whichever mode
 * the screen is in, so history reads the same in both.
 */
export type PrizeMode = 'personal' | 'couple';

export const PRIZE_MODES: readonly PrizeMode[] = ['personal', 'couple'] as const;

export function isPrizeMode(v: unknown): v is PrizeMode {
  return v === 'personal' || v === 'couple';
}

/** ONE item of a monthly pool. */
export interface LeagueItem {
  /** Stable, opaque, globally unique — the ledger key, so it must never move. */
  readonly id: string;
  readonly kind: LeagueItemKind;
  /** Hebrew title — the line the card shows. */
  readonly he: string;
  /** One Hebrew line of detail: what exactly is promised, or demanded. */
  readonly detail: string;
  readonly emoji: string;
  /**
   * 🔵 a completed CHALLENGE pays back. Always 0 for a gift or an experience —
   * those are spent, not staked.
   */
  readonly bonus: number;
}

/** One calendar month's offering. */
export interface LeaguePool {
  /** 1 = January … 12 = December. */
  readonly month: number;
  readonly he: string;
  /** Three gifts 🎁 and two experiences 🌄 — what a won month buys. */
  readonly rewards: readonly LeagueItem[];
  /** Three challenges ⚔️ — concrete, measurable, done by the end of the month. */
  readonly challenges: readonly LeagueItem[];
}

function gift(id: string, he: string, detail: string): LeagueItem {
  return { id, kind: 'gift', he, detail, emoji: '🎁', bonus: 0 };
}

function experience(id: string, he: string, detail: string): LeagueItem {
  return { id, kind: 'experience', he, detail, emoji: '🌄', bonus: 0 };
}

function challenge(id: string, he: string, detail: string, bonus: number): LeagueItem {
  return { id, kind: 'challenge', he, detail, emoji: '⚔️', bonus };
}


/**
 * THE COUPLE'S BASE POOL — the prizes that are ALWAYS on offer, every month,
 * ahead of the rotating seasonal items. These are the real stakes this league
 * is played for; the once-per-month redemption ledger makes each of them
 * re-earnable monthly (a foot massage redeemed in August does not consume
 * September's). Ids are permanent — the copy is yours to tune.
 */
const BASE_REWARDS: readonly LeagueItem[] = [
  { id: 'base_1', kind: 'gift', he: 'יומיים חופש מכלים', detail: 'המפסיד/ה שוטף/ת את כל הכלים יומיים ברצף.', emoji: '🍽️', bonus: 0 },
  { id: 'base_3', kind: 'gift', he: 'עיסוי כפות רגליים', detail: 'עיסוי כפות רגליים מסור, עשרים דקות לפחות.', emoji: '🦶', bonus: 0 },
  { id: 'base_4', kind: 'gift', he: 'עיסוי גב', detail: 'עיסוי גב מלא, שמן לבחירת הזוכה.', emoji: '💆', bonus: 0 },
  { id: 'base_5', kind: 'gift', he: 'משלוח קפה מארומה', detail: 'הקפה הקבוע של הזוכה, עד הבית, על חשבון המפסיד/ה.', emoji: '☕', bonus: 0 },
  { id: 'base_2', kind: 'experience', he: 'דייט הפתעה', detail: 'המפסיד/ה מארגן/ת דייט הפתעה עד סוף החודש — היעד סודי עד הרגע האחרון.', emoji: '💘', bonus: 0 },
  { id: 'base_6', kind: 'experience', he: 'זמן איכות מבן/בת הזוג', detail: 'הזוכה מגדיר/ה, המפסיד/ה מפנק/ת. בלי שאלות.', emoji: '😏', bonus: 0 },
  { id: 'base_7', kind: 'experience', he: 'טונגה לאירוע', detail: 'המפסיד/ה מגיע/ה עם טונגה לאירוע הקרוב. כבוד המשחק מחייב.', emoji: '👙', bonus: 0 },
];

/** 🔵 price of an item — always derived from its kind, never stored per item. */
export function priceOf(kind: LeagueItemKind): number {
  return BALANCE.league.prices[kind];
}

/**
 * THE TWELVE POOLS. Placeholder copy — see the header.
 *
 * Ids are `<kind>_<month>_<n>` and are the ONLY thing the ledger remembers.
 */
export const LEAGUE_POOLS: readonly LeaguePool[] = [
  {
    month: 1,
    he: 'ינואר',
    rewards: [
      gift('gift_01_1', 'ארוחת בוקר על המפסיד', 'בית קפה לבחירת המנצח/ת, בשבת הראשונה של החודש'),
      gift('gift_01_2', 'שבוע בלי תורנות מטבח', 'המפסיד/ה שוטף/ת כלים כל ערב, שבוע שלם'),
      gift('gift_01_3', 'ערב סרט בבחירת המנצח/ת', 'כולל פופקורן, בלי תלונות ובלי טלפון'),
      experience('exp_01_1', 'טיול זריחה', 'יציאה לפני אור ראשון, קפה בתרמוס, מסלול קצר'),
      experience('exp_01_2', 'ערב חמאם או ספא', 'שעתיים בלי שעון, על חשבון המפסיד/ה'),
    ],
    challenges: [
      challenge('chl_01_1', '10 עליות מתח ברצף', 'סט אחד נקי של 10 חזרות עד סוף החודש', 3),
      challenge('chl_01_2', 'פלאנק 3 דקות', 'החזקה אחת רצופה, בלי לרדת', 2),
      challenge('chl_01_3', '12 אימונים בחודש', 'שנים־עשר ימי אימון מתועדים, לא משנה איך התחלקו', 2),
    ],
  },
  {
    month: 2,
    he: 'פברואר',
    rewards: [
      gift('gift_02_1', 'ארוחת ערב במסעדה', 'המפסיד/ה מזמין/ה, המנצח/ת בוחר/ת מקום'),
      gift('gift_02_2', 'עיסוי גב של עשר דקות', 'כל ערב, שבוע שלם'),
      gift('gift_02_3', 'קינוח מהמאפייה הטובה', 'בדרך הביתה מהאימון האחרון של החודש'),
      experience('exp_02_1', 'יום בלי מסכים', 'שבת שלמה בלי טלפון, בתכנון המנצח/ת'),
      experience('exp_02_2', 'שיעור ניסיון בספורט חדש', 'טיפוס, ריקוד, אגרוף — מה שהמנצח/ת יבחר/תבחר'),
    ],
    challenges: [
      challenge('chl_02_1', 'סקוואט במשקל גוף', 'סט של 5 חזרות עם משקל שווה למשקל הגוף', 3),
      challenge('chl_02_2', '100 שכיבות שמיכה ביום אחד', 'מותר לפרק לסטים לאורך היום', 2),
      challenge('chl_02_3', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 3),
    ],
  },
  {
    month: 3,
    he: 'מרץ',
    rewards: [
      gift('gift_03_1', 'ארוחת בוקר על המפסיד', 'שקשוקה, לחם טרי, בלי למהר'),
      gift('gift_03_2', 'זוג גרבי אימון חדשות', 'המפסיד/ה קונה, המנצח/ת בוחר/ת צבע'),
      gift('gift_03_3', 'בחירת המוזיקה באימון', 'שבועיים, בלי זכות ערעור'),
      experience('exp_03_1', 'פיקניק פריחה', 'שמיכה, סלסלה והליכה של שעה לפני'),
      experience('exp_03_2', 'יציאה לאימון משותף בחוץ', 'פארק, אחרי העבודה, בבחירת המנצח/ת'),
    ],
    challenges: [
      challenge('chl_03_1', 'ריצת 5 ק״מ', 'ריצה רצופה, בלי הליכה באמצע', 3),
      challenge('chl_03_2', '15 מכרעים לכל רגל', 'סט רצוף של 15 לכל רגל', 1),
      challenge('chl_03_3', '14 אימונים בחודש', 'ארבעה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 4,
    he: 'אפריל',
    rewards: [
      gift('gift_04_1', 'ארוחת בוקר על המפסיד', 'בחוץ, בשמש, אחרי אימון בוקר'),
      gift('gift_04_2', 'ניקוי אביב של הבית', 'המפסיד/ה עושה את הסבב הגדול לבד'),
      gift('gift_04_3', 'בקבוק מים חדש', 'הגדול והיפה, בצבע של המנצח/ת'),
      experience('exp_04_1', 'טיול יום בטבע', 'מסלול של חמש שעות, המפסיד/ה נושא/ת את התיק'),
      experience('exp_04_2', 'ערב על הגג', 'אוכל, שמיכות ושתי שעות בלי לדבר על עבודה'),
    ],
    challenges: [
      challenge('chl_04_1', 'טיפוס 100 קומות מדרגות', 'מצטבר לאורך החודש, ברגל בלבד', 2),
      challenge('chl_04_2', '20 מתח באימון אחד', 'מותר בכמה סטים, באותו אימון', 3),
      challenge('chl_04_3', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
    ],
  },
  {
    month: 5,
    he: 'מאי',
    rewards: [
      gift('gift_05_1', 'ארוחת בוקר על המפסיד', 'עם קפה טוב, לא מהמכונה'),
      gift('gift_05_2', 'חולצת אימון חדשה', 'המפסיד/ה קונה, בלי לשאול מחיר'),
      gift('gift_05_3', 'שבוע של הכנת ארוחות', 'המפסיד/ה מבשל/ת לשניים כל ערב'),
      experience('exp_05_1', 'יום ים', 'מוקדם בבוקר, לפני שהחוף מתמלא'),
      experience('exp_05_2', 'ערב בישול משותף', 'מתכון חדש, המפסיד/ה קונה את החומרים'),
    ],
    challenges: [
      challenge('chl_05_1', 'לחיצת חזה 1.25 ממשקל הגוף', 'חזרה אחת נקייה, עם משגיח/ה', 3),
      challenge('chl_05_2', '200 כפיפות בטן בשבוע', 'מצטבר, בכל צורה', 1),
      challenge('chl_05_3', '16 אימונים בחודש', 'שישה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 6,
    he: 'יוני',
    rewards: [
      gift('gift_06_1', 'גלידה על המפסיד', 'הגדולה, עם התוספות'),
      gift('gift_06_2', 'ארוחת בוקר על המפסיד', 'ליד הים, מוקדם בבוקר'),
      gift('gift_06_3', 'משמרת קניות שלמה', 'המפסיד/ה עושה סופר לשבוע'),
      experience('exp_06_1', 'לילה מחוץ לעיר', 'צימר או אוהל, בבחירת המנצח/ת'),
      experience('exp_06_2', 'שקיעה על החוף', 'יציאה מוקדמת, בלי לוח זמנים'),
    ],
    challenges: [
      challenge('chl_06_1', 'שחייה 500 מטר', 'רצוף, בבריכה או בים', 2),
      challenge('chl_06_2', '50 בורפי ברצף', 'בלי הפסקה, בזמן חופשי', 3),
      challenge('chl_06_3', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 2),
    ],
  },
  {
    month: 7,
    he: 'יולי',
    rewards: [
      gift('gift_07_1', 'ארוחת בוקר על המפסיד', 'אחרי אימון של שישי בבוקר'),
      gift('gift_07_2', 'שייק חלבון לכל השבוע', 'המפסיד/ה מכין/ה ומביא/ה'),
      gift('gift_07_3', 'כפכפים חדשים', 'לקיץ, על חשבון המפסיד/ה'),
      experience('exp_07_1', 'יום בריכה', 'כיסא, צל וארוחת צהריים על המפסיד/ה'),
      experience('exp_07_2', 'סרט בקולנוע פתוח', 'כרטיסים ופיצוחים על המפסיד/ה'),
    ],
    challenges: [
      challenge('chl_07_1', '10,000 צעדים ב־20 ימים', 'עשרים ימים בחודש, לא חייבים ברצף', 2),
      challenge('chl_07_2', 'דדליפט 1.5 ממשקל הגוף', 'חזרה אחת נקייה, גב ישר', 3),
      challenge('chl_07_3', '14 אימונים בחודש', 'ארבעה־עשר ימי אימון מתועדים, גם בחום', 3),
    ],
  },
  {
    month: 8,
    he: 'אוגוסט',
    rewards: [
      gift('gift_08_1', 'ארוחת בוקר על המפסיד', 'ממוזג, ארוך, בלי לוח זמנים'),
      gift('gift_08_2', 'מגבת אימון חדשה', 'הגדולה והרכה, בבחירת המנצח/ת'),
      gift('gift_08_3', 'שבוע בלי הוצאת זבל', 'המפסיד/ה לוקח/ת הכול'),
      experience('exp_08_1', 'יום כיף במים', 'פארק מים או קיאקים, על חשבון המפסיד/ה'),
      experience('exp_08_2', 'ערב כוכבים', 'נסיעה מחוץ לעיר, שמיכה ושעתיים שקט'),
    ],
    challenges: [
      challenge('chl_08_1', '12 מתח ברצף', 'סט אחד נקי של 12 חזרות', 3),
      challenge('chl_08_2', 'פלאנק צד 90 שניות לכל צד', 'שני הצדדים, באותו אימון', 2),
      challenge('chl_08_3', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
    ],
  },
  {
    month: 9,
    he: 'ספטמבר',
    rewards: [
      gift('gift_09_1', 'ארוחת בוקר על המפסיד', 'חגיגית, לכבוד תחילת השנה'),
      gift('gift_09_2', 'ספר בבחירת המנצח/ת', 'המפסיד/ה קונה ומביא/ה'),
      gift('gift_09_3', 'שבוע של קפה בוקר במיטה', 'המפסיד/ה מכין/ה ומגיש/ה'),
      experience('exp_09_1', 'טיול סוף שבוע בצפון', 'לילה אחד, המפסיד/ה מתכנן/ת הכול'),
      experience('exp_09_2', 'ארוחת חג משותפת', 'בישול לשניים, בלי אורחים'),
    ],
    challenges: [
      challenge('chl_09_1', 'ריצת 10 ק״מ', 'רצוף, בקצב חופשי', 3),
      challenge('chl_09_2', '300 שכיבות שמיכה בשבוע', 'מצטבר לאורך שבוע אחד', 2),
      challenge('chl_09_3', '16 אימונים בחודש', 'שישה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 10,
    he: 'אוקטובר',
    rewards: [
      gift('gift_10_1', 'ארוחת בוקר על המפסיד', 'בחוץ, עם הסוודר הראשון של הסתיו'),
      gift('gift_10_2', 'כפפות אימון חדשות', 'על חשבון המפסיד/ה'),
      gift('gift_10_3', 'ערב בלי מסכים', 'המפסיד/ה מארגן/ת משחק, אוכל ושקט'),
      experience('exp_10_1', 'טיול אופניים', 'שלושים ק״מ, קפה באמצע'),
      experience('exp_10_2', 'ביקור במוזיאון או תערוכה', 'בבחירת המנצח/ת, כרטיסים על המפסיד/ה'),
    ],
    challenges: [
      challenge('chl_10_1', 'סקוואט 1.25 ממשקל הגוף', 'חזרה אחת נקייה, עומק מלא', 3),
      challenge('chl_10_2', '1000 מטר חתירה מתחת ל־4 דקות', 'מכונת חתירה, ניסיון אחד', 2),
      challenge('chl_10_3', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 2),
    ],
  },
  {
    month: 11,
    he: 'נובמבר',
    rewards: [
      gift('gift_11_1', 'ארוחת בוקר על המפסיד', 'חמה, עם מרק אם צריך'),
      gift('gift_11_2', 'גרביים חמות ומגבת', 'ערכת חורף על חשבון המפסיד/ה'),
      gift('gift_11_3', 'שבוע בלי כביסה', 'המפסיד/ה מקפל/ת הכול'),
      experience('exp_11_1', 'ערב מרק ומשחקים', 'המפסיד/ה מבשל/ת, המנצח/ת בוחר/ת משחק'),
      experience('exp_11_2', 'הליכה בגשם הראשון', 'שעה בחוץ, ואז שוקו חם על המפסיד/ה'),
    ],
    challenges: [
      challenge('chl_11_1', '15 מקבילים ברצף', 'סט אחד נקי של 15 חזרות', 2),
      challenge('chl_11_2', '20 ימי תנועה', 'עשרים ימים בחודש עם אימון או הליכה מתועדים', 3),
      challenge('chl_11_3', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
    ],
  },
  {
    month: 12,
    he: 'דצמבר',
    rewards: [
      gift('gift_12_1', 'ארוחת בוקר על המפסיד', 'הגדולה של סוף השנה'),
      gift('gift_12_2', 'מתנת סוף שנה', 'עד תקציב שסוכם מראש, בבחירת המנצח/ת'),
      gift('gift_12_3', 'שבוע של בחירת התפריט', 'המנצח/ת מחליט/ה מה אוכלים כל ערב'),
      experience('exp_12_1', 'סוף שבוע חופשי', 'יומיים בלי מטלות, המפסיד/ה מכסה הכול'),
      experience('exp_12_2', 'ערב סיכום שנה', 'יין, תמונות מהשנה ותכנון השנה הבאה'),
    ],
    challenges: [
      challenge('chl_12_1', 'שלושה שיאים אישיים חדשים', 'שלושה תרגילים שונים עד סוף החודש', 3),
      challenge('chl_12_2', 'אימון בכל ימי השבוע', 'שבעה ימי שבוע שונים לאורך החודש', 2),
      challenge('chl_12_3', '18 אימונים בחודש', 'שמונה־עשר ימי אימון מתועדים', 3),
    ],
  },
];

/**
 * THE PERSONAL BASE POOL — the self-rewards on offer every month, ahead of the
 * month's seasonal ones. Same shape as the couple's (four gifts, three
 * experiences, once per month each); the difference is who pays and who
 * enjoys it: you, both times. Ids are permanent — the copy is yours to tune.
 */
const PERSONAL_BASE_REWARDS: readonly LeagueItem[] = [
  { id: 'p_base_1', kind: 'gift', he: 'ארוחת צ׳יט', detail: 'ארוחה אחת בלי לספור — מה שבא לכם, בלי רגשות אשם.', emoji: '🍕', bonus: 0 },
  { id: 'p_base_2', kind: 'gift', he: 'הקפה הטוב', detail: 'קפה מהמקום הכי טוב בסביבה, בלי להסתכל על המחיר.', emoji: '☕', bonus: 0 },
  { id: 'p_base_3', kind: 'gift', he: 'פריט ציוד קטן', detail: 'גרביים, רצועות, בקבוק — משהו קטן שישמח את האימון הבא.', emoji: '🛍️', bonus: 0 },
  { id: 'p_base_4', kind: 'gift', he: 'ערב פינוק בבית', detail: 'אמבטיה, מסכה, סדרה — ערב אחד רק בשבילכם.', emoji: '🛁', bonus: 0 },
  { id: 'p_base_5', kind: 'experience', he: 'עיסוי מקצועי', detail: 'שעה אצל מעסה — השרירים הרוויחו את זה.', emoji: '💆', bonus: 0 },
  { id: 'p_base_6', kind: 'experience', he: 'בוקר בלי שעון מעורר', detail: 'בוקר אחד שמתחיל מתי שהגוף מחליט, ובלי תוכניות עד הצהריים.', emoji: '😴', bonus: 0 },
  { id: 'p_base_7', kind: 'experience', he: 'יציאה לבד', detail: 'סרט, הופעה או משחק — כרטיס אחד, והבחירה כולה שלכם.', emoji: '🎟️', bonus: 0 },
];

/**
 * THE TWELVE PERSONAL POOLS — the same calendar, the same prices, the same
 * three-gifts-two-experiences-three-challenges shape as `LEAGUE_POOLS`, written
 * for one person treating themself. Ids are `p_<kind>_<month>_<n>`.
 */
export const PERSONAL_POOLS: readonly LeaguePool[] = [
  {
    month: 1,
    he: 'ינואר',
    rewards: [
      gift('p_gift_01_1', 'יומן אימונים חדש', 'מחברת יפה לשנה החדשה — למטרות ולשיאים'),
      gift('p_gift_01_2', 'כובע גרב לאימוני חוץ', 'חם, נעים, ובצבע שאתם אוהבים'),
      gift('p_gift_01_3', 'מרק מהמקום הטוב', 'קערה חמה אחרי האימון הקר של השבוע'),
      experience('p_exp_01_1', 'סאונה אחרי אימון', 'שעה של חום אחרי האימון הכבד של השבוע'),
      experience('p_exp_01_2', 'שיעור ניסיון', 'יוגה, פילאטיס או אגרוף — משהו שתמיד רציתם לנסות'),
    ],
    challenges: [
      challenge('p_chl_01_1', 'פלאנק 2 דקות', 'החזקה אחת רצופה עד סוף החודש', 2),
      challenge('p_chl_01_2', '12 אימונים בחודש', 'שנים־עשר ימי אימון מתועדים, לא משנה איך התחלקו', 2),
      challenge('p_chl_01_3', 'שבוע בלי מתוקים', 'שבעה ימים רצופים בלי קינוחים', 2),
    ],
  },
  {
    month: 2,
    he: 'פברואר',
    rewards: [
      gift('p_gift_02_1', 'תרמוס', 'משקה חם שמחכה בסוף אימון הבוקר'),
      gift('p_gift_02_2', 'ארוחת בוקר בחוץ', 'בית קפה, ספר טוב ובלי למהר'),
      gift('p_gift_02_3', 'גליל עיסוי', 'לשחרר את הרגליים אחרי יום רגליים'),
      experience('p_exp_02_1', 'ערב ספא', 'שעתיים של בריכה חמה וג׳קוזי'),
      experience('p_exp_02_2', 'יום בלי מסכים', 'יום חופש שלם בלי טלפון — הליכה, ספר, תנומה'),
    ],
    challenges: [
      challenge('p_chl_02_1', '30 שכיבות שמיכה ברצף', 'סט אחד, בלי לעצור', 3),
      challenge('p_chl_02_2', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 3),
      challenge('p_chl_02_3', 'שמונה שעות שינה', 'עשרה לילות בחודש עם שמונה שעות שינה לפחות', 1),
    ],
  },
  {
    month: 3,
    he: 'מרץ',
    rewards: [
      gift('p_gift_03_1', 'גרבי ריצה טובות', 'מהסוג שלא משאיר שלפוחיות'),
      gift('p_gift_03_2', 'צמח לבית', 'משהו ירוק שיגדל יחד איתכם'),
      gift('p_gift_03_3', 'שייק פירות גדול', 'אחרי האימון, עם כל התוספות'),
      experience('p_exp_03_1', 'פיקניק פריחה', 'שמיכה, אוכל טוב ושעה בפארק בין הפרחים'),
      experience('p_exp_03_2', 'מסלול הליכה חדש', 'בוקר שלם במסלול שעוד לא הכרתם'),
    ],
    challenges: [
      challenge('p_chl_03_1', 'ריצת 5 ק״מ', 'ריצה רצופה, בלי הליכה באמצע', 3),
      challenge('p_chl_03_2', '20 סקוואטים בקפיצה', 'סט אחד רצוף', 1),
      challenge('p_chl_03_3', '14 אימונים בחודש', 'ארבעה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 4,
    he: 'אפריל',
    rewards: [
      gift('p_gift_04_1', 'בקבוק מים חדש', 'הגדול, שמזכיר לשתות כל היום'),
      gift('p_gift_04_2', 'אוזניות ספורט', 'עד תקציב שקבעתם מראש'),
      gift('p_gift_04_3', 'ארוחה במסעדה שאתם אוהבים', 'לבד או עם חברים — אתם מזמינים את עצמכם'),
      experience('p_exp_04_1', 'טיול יום בטבע', 'מסלול ארוך, תיק קל ובלי לוח זמנים'),
      experience('p_exp_04_2', 'שעת טיפוס', 'קיר טיפוס, שעה אחת, אמות שורפות'),
    ],
    challenges: [
      challenge('p_chl_04_1', '5 מתח ברצף', 'סט אחד נקי של חמש חזרות', 3),
      challenge('p_chl_04_2', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
      challenge('p_chl_04_3', '10,000 צעדים ב־15 ימים', 'חמישה־עשר ימים בחודש, לא חייבים ברצף', 2),
    ],
  },
  {
    month: 5,
    he: 'מאי',
    rewards: [
      gift('p_gift_05_1', 'חולצת אימון חדשה', 'נושמת, נוחה, ובצבע שעושה חשק להתאמן'),
      gift('p_gift_05_2', 'ארגז פירות העונה', 'פירות טריים מהשוק, רק בשבילכם'),
      gift('p_gift_05_3', 'משקפי שמש לריצה', 'קלים, ולא זזים באמצע'),
      experience('p_exp_05_1', 'יוגה של בוקר בחוץ', 'שיעור בפארק או ליד המים'),
      experience('p_exp_05_2', 'ערב בישול לעצמכם', 'מתכון חדש וחומרים טובים — ארוחה רק בשבילכם'),
    ],
    challenges: [
      challenge('p_chl_05_1', '200 שכיבות שמיכה בשבוע', 'מצטבר לאורך שבוע אחד', 2),
      challenge('p_chl_05_2', 'מתיחות כל יום', 'עשר דקות מתיחות בעשרים ימים בחודש', 2),
      challenge('p_chl_05_3', '16 אימונים בחודש', 'שישה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 6,
    he: 'יוני',
    rewards: [
      gift('p_gift_06_1', 'גלידה גדולה', 'הכדורים שבחרתם, עם כל התוספות'),
      gift('p_gift_06_2', 'כובע ריצה', 'מצחייה טובה לשמש של הקיץ'),
      gift('p_gift_06_3', 'בגד ים חדש', 'לקיץ שהרווחתם'),
      experience('p_exp_06_1', 'יום ים או אגם', 'מוקדם בבוקר, לפני שכולם מגיעים'),
      experience('p_exp_06_2', 'שקיעה מנקודת תצפית', 'עלייה ברגל למקום גבוה, ושעה של שקט'),
    ],
    challenges: [
      challenge('p_chl_06_1', 'שחייה 500 מטר', 'רצוף, בבריכה או במים פתוחים', 2),
      challenge('p_chl_06_2', '30 בורפי ברצף', 'בלי הפסקה, בזמן חופשי', 3),
      challenge('p_chl_06_3', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 2),
    ],
  },
  {
    month: 7,
    he: 'יולי',
    rewards: [
      gift('p_gift_07_1', 'מגבת קירור', 'לאימונים בחום של אמצע הקיץ'),
      gift('p_gift_07_2', 'אבקת חלבון בטעם חדש', 'השקית שתמיד רציתם לנסות'),
      gift('p_gift_07_3', 'כפכפים נוחים', 'להחליף אליהם מיד אחרי האימון'),
      experience('p_exp_07_1', 'יום בריכה', 'כיסא, צל וספר טוב — יום שלם'),
      experience('p_exp_07_2', 'קולנוע באוויר הפתוח', 'סרט תחת הכוכבים, עם פופקורן'),
    ],
    challenges: [
      challenge('p_chl_07_1', '10,000 צעדים ב־20 ימים', 'עשרים ימים בחודש, לא חייבים ברצף', 2),
      challenge('p_chl_07_2', 'ציפורי בוקר', 'ארבעה אימונים שמתחילים לפני שבע בבוקר', 2),
      challenge('p_chl_07_3', '14 אימונים בחודש', 'ארבעה־עשר ימי אימון מתועדים, גם בחום', 3),
    ],
  },
  {
    month: 8,
    he: 'אוגוסט',
    rewards: [
      gift('p_gift_08_1', 'מגבת אימון חדשה', 'הגדולה והרכה'),
      gift('p_gift_08_2', 'שייק קר אחרי כל אימון', 'שבוע שלם'),
      gift('p_gift_08_3', 'בקבוק שומר קור', 'מים קרים גם אחרי שעתיים בשמש'),
      experience('p_exp_08_1', 'יום על המים', 'קיאק, סאפ או פארק מים — מה שבא לכם'),
      experience('p_exp_08_2', 'לילה תחת הכוכבים', 'נסיעה מחוץ לעיר, שמיכה ושקט'),
    ],
    challenges: [
      challenge('p_chl_08_1', 'פלאנק צד דקה לכל צד', 'שני הצדדים, באותו אימון', 2),
      challenge('p_chl_08_2', '8 מתח ברצף', 'סט אחד נקי של שמונה חזרות', 3),
      challenge('p_chl_08_3', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
    ],
  },
  {
    month: 9,
    he: 'ספטמבר',
    rewards: [
      gift('p_gift_09_1', 'ספר חדש', 'ספר שבחרתם, לקרוא אחרי האימון'),
      gift('p_gift_09_2', 'תיק אימון חדש', 'עם תא לנעליים ומקום לכל השאר'),
      gift('p_gift_09_3', 'ארוחת בוקר חגיגית', 'לכבוד עונה חדשה — בחוץ, בלי למהר'),
      experience('p_exp_09_1', 'סוף שבוע קצר מחוץ לעיר', 'לילה אחד, תיק קטן ומסלול הליכה בבוקר'),
      experience('p_exp_09_2', 'סדנה חדשה', 'בישול, צילום או קרמיקה — ערב אחד ללמוד משהו'),
    ],
    challenges: [
      challenge('p_chl_09_1', 'ריצת 10 ק״מ', 'רצוף, בקצב חופשי', 3),
      challenge('p_chl_09_2', '300 שכיבות שמיכה בשבוע', 'מצטבר לאורך שבוע אחד', 2),
      challenge('p_chl_09_3', '16 אימונים בחודש', 'שישה־עשר ימי אימון מתועדים', 3),
    ],
  },
  {
    month: 10,
    he: 'אוקטובר',
    rewards: [
      gift('p_gift_10_1', 'כפפות אימון חדשות', 'אחיזה טובה לעונה הקרה'),
      gift('p_gift_10_2', 'סווטשירט חם', 'לאימוני החוץ של הסתיו'),
      gift('p_gift_10_3', 'ערב בלי מסכים', 'משחק, ספר ותה — ערב אחד של שקט'),
      experience('p_exp_10_1', 'רכיבת אופניים ארוכה', 'שלושים ק״מ, קפה באמצע'),
      experience('p_exp_10_2', 'מוזיאון או תערוכה', 'אחר צהריים שלם, בקצב שלכם'),
    ],
    challenges: [
      challenge('p_chl_10_1', 'סקוואט במשקל הגוף', 'חזרה אחת נקייה, עומק מלא', 3),
      challenge('p_chl_10_2', '1000 מטר חתירה', 'מתחת ל־4:30 דקות, ניסיון אחד', 2),
      challenge('p_chl_10_3', 'שלושה שבועות מושלמים', 'שלושה שבועות בחודש שמזכים ב־🔵', 2),
    ],
  },
  {
    month: 11,
    he: 'נובמבר',
    rewards: [
      gift('p_gift_11_1', 'גרביים חמות', 'ערכת חורף קטנה לרגליים שעבדו קשה'),
      gift('p_gift_11_2', 'מעיל רוח לריצה', 'קל, מתקפל ועומד בגשם'),
      gift('p_gift_11_3', 'שוקו חם מהמקום הטוב', 'אחרי אימון בגשם'),
      experience('p_exp_11_1', 'ערב מרק וסרט', 'סיר מרק גדול, שמיכה וסרט שבחרתם'),
      experience('p_exp_11_2', 'הליכה בגשם הראשון', 'שעה בחוץ עם מעיל טוב, ואז מקלחת חמה'),
    ],
    challenges: [
      challenge('p_chl_11_1', '10 מקבילים ברצף', 'סט אחד נקי של עשר חזרות', 2),
      challenge('p_chl_11_2', '20 ימי תנועה', 'עשרים ימים בחודש עם אימון או הליכה מתועדים', 3),
      challenge('p_chl_11_3', 'ארבעה שבועות רצופים', 'ארבעה שבועות עם 🔵, בלי החמצה', 3),
    ],
  },
  {
    month: 12,
    he: 'דצמבר',
    rewards: [
      gift('p_gift_12_1', 'מתנת סוף שנה לעצמכם', 'עד תקציב שקבעתם מראש — משהו שבאמת רציתם'),
      gift('p_gift_12_2', 'נעלי אימון חדשות', 'הזוג הישן עשה את שלו'),
      gift('p_gift_12_3', 'ארוחת חג כמו שאתם אוהבים', 'בלי לספור ובלי להתנצל'),
      experience('p_exp_12_1', 'יומיים חופש', 'סוף שבוע בלי מטלות ובלי שעון מעורר'),
      experience('p_exp_12_2', 'ערב סיכום שנה', 'תמונות מהשנה, השיאים שלכם ומטרות לשנה הבאה'),
    ],
    challenges: [
      challenge('p_chl_12_1', 'שלושה שיאים אישיים חדשים', 'שלושה תרגילים שונים עד סוף החודש', 3),
      challenge('p_chl_12_2', 'אימון בכל ימי השבוע', 'שבעה ימי שבוע שונים לאורך החודש', 2),
      challenge('p_chl_12_3', '18 אימונים בחודש', 'שמונה־עשר ימי אימון מתועדים', 3),
    ],
  },
];

/** Month number (1–12) of a `'YYYY-MM'` key; 0 when it is not one. */
function monthNumber(monthKey: string): number {
  const m = /^\d{4}-(\d{2})$/.exec(monthKey);
  const n = m?.[1] !== undefined ? Number(m[1]) : 0;
  return n >= 1 && n <= 12 ? n : 0;
}

/**
 * The pool of a `'YYYY-MM'` month key, in the prize mode the screen shows.
 *
 * A pure function of the month NUMBER (and the mode), so every year offers the
 * same twelve pools and two accounts in the same mode always see the same one.
 * A key that is not a month at all falls back to January's pool rather than to
 * nothing: a screen with the wrong pool is a smaller bug than a screen with
 * none. Without a mode it is the COUPLE's pool — the league as it always was.
 */
// Each mode's base pool leads every month; the seasonal items follow. Built
// once so `poolOfMonth` stays referentially stable — same month, same object.
const MERGED_POOLS: Readonly<Record<PrizeMode, readonly LeaguePool[]>> = {
  couple: LEAGUE_POOLS.map((pool) => ({ ...pool, rewards: [...BASE_REWARDS, ...pool.rewards] })),
  personal: PERSONAL_POOLS.map((pool) => ({ ...pool, rewards: [...PERSONAL_BASE_REWARDS, ...pool.rewards] })),
};

export function poolOfMonth(monthKey: string, mode: PrizeMode = 'couple'): LeaguePool {
  const pools = MERGED_POOLS[mode];
  const n = monthNumber(monthKey);
  return (pools[(n > 0 ? n : 1) - 1] ?? pools[0]) as LeaguePool;
}

/**
 * Every item of one mode's pools, in pool order (its base pool once, then the
 * twelve seasonal pools). Without a mode: the couple's, as it always was.
 */
export function allLeagueItems(mode: PrizeMode = 'couple'): LeagueItem[] {
  const out: LeagueItem[] = [...(mode === 'couple' ? BASE_REWARDS : PERSONAL_BASE_REWARDS)];
  for (const pool of mode === 'couple' ? LEAGUE_POOLS : PERSONAL_POOLS) out.push(...pool.rewards, ...pool.challenges);
  return out;
}

/** Id -> item and id -> the mode it was written for, over BOTH modes. */
const BY_ID = new Map<string, LeagueItem>();
const MODE_BY_ID = new Map<string, PrizeMode>();
for (const mode of PRIZE_MODES) {
  for (const item of allLeagueItems(mode)) {
    BY_ID.set(item.id, item);
    MODE_BY_ID.set(item.id, mode);
  }
}

/**
 * One item by id, whatever month — and whatever MODE — it belongs to; `null`
 * for an unknown id. Both modes resolve, always: an item redeemed in one mode
 * is still that item after the screen switches to the other.
 */
export function leagueItemById(id: string): LeagueItem | null {
  return BY_ID.get(id) ?? null;
}

/** The prize mode an item id belongs to; `null` for an unknown id. */
export function prizeModeOfItem(id: string): PrizeMode | null {
  return MODE_BY_ID.get(id) ?? null;
}

/** True when `id` is an item of THAT month's pool in that mode — the redemption rule. */
export function itemInMonth(monthKey: string, id: string, mode: PrizeMode = 'couple'): boolean {
  const pool = poolOfMonth(monthKey, mode);
  return pool.rewards.some((i) => i.id === id) || pool.challenges.some((i) => i.id === id);
}
