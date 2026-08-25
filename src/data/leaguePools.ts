/**
 * data/leaguePools.ts — הליגה's twelve monthly pools.
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

/** Month number (1–12) of a `'YYYY-MM'` key; 0 when it is not one. */
function monthNumber(monthKey: string): number {
  const m = /^\d{4}-(\d{2})$/.exec(monthKey);
  const n = m?.[1] !== undefined ? Number(m[1]) : 0;
  return n >= 1 && n <= 12 ? n : 0;
}

/**
 * The pool of a `'YYYY-MM'` month key.
 *
 * A pure function of the month NUMBER, so every year offers the same twelve
 * pools and two accounts always see the same one. A key that is not a month at
 * all falls back to January's pool rather than to nothing: a screen with the
 * wrong pool is a smaller bug than a screen with none.
 */
// The couple's base pool leads every month; the seasonal items follow. Built
// once so `poolOfMonth` stays referentially stable — same month, same object.
const MERGED_POOLS: readonly LeaguePool[] = LEAGUE_POOLS.map((pool) => ({
  ...pool,
  rewards: [...BASE_REWARDS, ...pool.rewards],
}));

export function poolOfMonth(monthKey: string): LeaguePool {
  const n = monthNumber(monthKey);
  return (MERGED_POOLS[(n > 0 ? n : 1) - 1] ?? MERGED_POOLS[0]) as LeaguePool;
}

/** Every item of every pool, in pool order — the id index is built from this. */
export function allLeagueItems(): LeagueItem[] {
  const out: LeagueItem[] = [...BASE_REWARDS];
  for (const pool of LEAGUE_POOLS) out.push(...pool.rewards, ...pool.challenges);
  return out;
}

const BY_ID = new Map<string, LeagueItem>(allLeagueItems().map((i) => [i.id, i] as const));

/** One item by id, whatever month it belongs to — `null` for an unknown id. */
export function leagueItemById(id: string): LeagueItem | null {
  return BY_ID.get(id) ?? null;
}

/** True when `id` is an item of THAT month's pool — the redemption rule. */
export function itemInMonth(monthKey: string, id: string): boolean {
  const pool = poolOfMonth(monthKey);
  return pool.rewards.some((i) => i.id === id) || pool.challenges.some((i) => i.id === id);
}
