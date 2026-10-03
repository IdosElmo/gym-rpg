/**
 * i18n/messages/shell.ts — the app shell: the nav, the screen headers, the
 * static parts of index.html (rest-timer bar, document title) and the
 * language/units card of the settings screen.
 *
 * Every Hebrew value here is the exact string the shell printed before i18n
 * (the DOM tests pin them). `sub` is the small English subtitle the Hebrew
 * headers have always carried; English has no second language to show, so its
 * `sub` values are `''` and the shell omits the element.
 */

import type { Catalog } from '../locale.ts';

const he = {
  doc: {
    title: 'היפרטרופיה 3 ימים · חזה וליבה',
  },
  timer: {
    title: 'מנוחה',
    sub: 'טיימר מנוחה',
    done: 'המנוחה הסתיימה — לסט הבא! 💪',
    pause: 'השהה',
    resume: 'המשך',
    reset: 'איפוס',
    close: 'סגירה',
  },
  nav: {
    mainLabel: 'ניווט ראשי',
    hubs: {
      TR: { title: 'אימון', inner: 'ימי האימון' },
      NU: { title: 'תזונה', inner: 'מעקב תזונה' },
      GM: { title: 'הרפתקה', inner: 'מסכי המשחק' },
      PR: { title: 'התקדמות', inner: 'מסכי ההתקדמות' },
      SE: { title: 'פרופיל', inner: 'פרופיל והגדרות' },
    },
    tabs: {
      BT: 'קרב',
      CH: 'דמות',
      LG: 'ליגה',
      ST: 'הגדרות',
      H: 'היסטוריה',
      SS: 'סטטיסטיקות',
      NT: 'תזונה',
      WT: 'משקל',
      PH: 'תמונות',
    },
  },
  header: {
    energyTitle: 'אנרגיית קרב — נצברת מאימונים אמיתיים',
    /** The eyebrow over a workout / the meals: today's weekday and date. */
    today: (weekday: string, date: string) => `היום · יום ${weekday} ${date}`,
    level: (n: string) => `רמה ${n}`,
    levelTitle: 'רמת הדמות — הממוצע של שש קבוצות השריר',
    /** The thin bar under the header: how far the character is into its level. */
    toNext: (pct: string, next: string) => `${pct}% לרמה ${next}`,
    maxLevel: 'רמה מקסימלית',
    ST: { title: 'הגדרות', sub: 'Settings', meta: 'חשבון, תוכנית האימונים וניהול הנתונים' },
    H: { title: 'היסטוריית אימונים', sub: 'History', meta: 'כל אימון שתועד, והחדש ביותר למעלה' },
    SS: { title: 'סטטיסטיקות', sub: 'Stats', meta: 'כל מה שהאימונים שלכם מסתכמים אליו' },
    NT: {
      title: 'תזונה',
      sub: 'Nutrition',
      meta: (cal: string, protein: string) => `היום: ${cal} קלוריות · ${protein} גרם חלבון`,
    },
    WT: { title: 'משקל', sub: 'Weight' },
    PH: { title: 'תמונות', sub: 'Progress' },
    PL: {
      title: 'עריכת תוכנית',
      sub: 'Plan',
      custom: 'תוכנית מותאמת אישית',
      original: 'התוכנית המקורית',
      saveHint: 'שינויים נשמרים רק בלחיצה על 💾',
      back: 'חזרה',
    },
    CH: {
      title: 'הדמות שלי',
      sub: 'Character',
      meta: (level: string) => `רמה ${level} · כל סט אמיתי מחזק חלק אחר בגוף`,
    },
    LG: {
      title: 'הליגה',
      sub: 'League',
      meta: (coins: string) => `🔵 ${coins} מטבעות ליגה · שבוע מלא = מטבע`,
    },
    BT: {
      title: 'מצב קרב',
      sub: 'Battle',
      meta: (world: string, wave: string, level: string) => `${world} · גל ${wave} · רמה ${level}`,
    },
    workout: {
      fallbackTitle: 'אימון',
      fallbackSub: 'Workout',
      title: (caption: string, name: string) => `יום ${caption} · ${name}`,
      sub: 'Hypertrophy',
      lastLogged: 'אימון אחרון שתועד:',
      never: '— עדיין לא תועד',
      editPlan: 'עריכת תוכנית',
      editPlanLabel: 'עריכת תוכנית האימונים',
    },
  },
  prefs: {
    title: '🌐 שפה, יחידות ומראה',
    language: 'שפה',
    appearance: 'מראה',
    dark: 'כהה',
    light: 'בהיר',
    units: 'יחידות משקל',
    metric: 'ק"ג',
    imperial: 'lb',
    note: 'הנתונים נשמרים תמיד בק"ג — מעבר בין יחידות לא משנה שום דבר מהיסטוריה.',
  },
};

const en: typeof he = {
  doc: {
    title: 'Gym RPG',
  },
  timer: {
    title: 'Rest',
    sub: 'Rest timer',
    done: 'Rest is over — next set! 💪',
    pause: 'Pause',
    resume: 'Resume',
    reset: 'Reset',
    close: 'Close',
  },
  nav: {
    mainLabel: 'Main navigation',
    hubs: {
      TR: { title: 'Train', inner: 'Workout days' },
      NU: { title: 'Nutrition', inner: 'Nutrition tracking' },
      GM: { title: 'Quest', inner: 'Game screens' },
      PR: { title: 'Progress', inner: 'Progress screens' },
      SE: { title: 'Profile', inner: 'Profile and settings' },
    },
    tabs: {
      BT: 'Battle',
      CH: 'Hero',
      LG: 'League',
      ST: 'Settings',
      H: 'History',
      SS: 'Stats',
      NT: 'Meals',
      WT: 'Weight',
      PH: 'Photos',
    },
  },
  header: {
    energyTitle: 'Battle energy — earned only by real training',
    today: (weekday: string, date: string) => `Today · ${weekday}, ${date}`,
    level: (n: string) => `Lvl ${n}`,
    levelTitle: 'Character level — the average of your six muscle groups',
    toNext: (pct: string, next: string) => `${pct}% to Lvl ${next}`,
    maxLevel: 'Max level',
    ST: { title: 'Settings', sub: '', meta: 'Account, training plan and your data' },
    H: { title: 'Workout history', sub: '', meta: 'Every logged workout, newest first' },
    SS: { title: 'Stats', sub: '', meta: 'What all your training adds up to' },
    NT: {
      title: 'Nutrition',
      sub: '',
      meta: (cal: string, protein: string) => `Today: ${cal} kcal · ${protein} g protein`,
    },
    WT: { title: 'Weight', sub: '' },
    PH: { title: 'Progress photos', sub: '' },
    PL: {
      title: 'Edit plan',
      sub: '',
      custom: 'Custom plan',
      original: 'The original plan',
      saveHint: 'tap 💾 to save',
      back: 'Back',
    },
    CH: {
      title: 'My hero',
      sub: '',
      meta: (level: string) => `Level ${level} · every real set strengthens a body part`,
    },
    LG: {
      title: 'The League',
      sub: '',
      meta: (coins: string) => `🔵 ${coins} league coins · a full week = a coin`,
    },
    BT: {
      title: 'Battle',
      sub: '',
      meta: (world: string, wave: string, level: string) => `${world} · Wave ${wave} · Level ${level}`,
    },
    workout: {
      fallbackTitle: 'Workout',
      fallbackSub: '',
      title: (caption: string, name: string) => `${caption} · ${name}`,
      sub: '',
      lastLogged: 'Last logged:',
      never: '— not logged yet',
      editPlan: 'Edit plan',
      editPlanLabel: 'Edit the training plan',
    },
  },
  prefs: {
    title: '🌐 Language, units & look',
    language: 'Language',
    appearance: 'Appearance',
    dark: 'Dark',
    light: 'Light',
    units: 'Weight units',
    metric: 'kg',
    imperial: 'lb',
    note: 'Data is always stored in kg — switching units never changes your history.',
  },
};

export const shell: Catalog<typeof he> = { he, en };
