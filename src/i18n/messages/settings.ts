/**
 * i18n/messages/settings.ts — the הגדרות screen (plan card, data card, the
 * clear/import/export flows and the app-info line).
 */

import type { Catalog } from '../locale.ts';

const he = {
  plan: {
    title: 'תוכנית האימונים',
    custom: (rev: number) => `מותאמת אישית · גרסה ${rev}`,
    original: 'התוכנית המקורית',
    edit: '⚙️ עריכת התוכנית',
  },
  data: {
    title: 'הנתונים שלי',
    sub: 'גיבוי מקומי',
    note: 'כל הנתונים נשמרים במכשיר · ניתן לגבות ולשחזר כקובץ JSON',
    export: '⬇ ייצוא JSON',
    import: '⬆ ייבוא JSON',
    clear: '🗑 מחיקה',
  },
  info: (version: string) =>
    `Gym RPG · גרסה ${version}<br>💪 האפליקציה עובדת 100% אופליין · הנתונים נשמרים במכשיר בלבד`,
  clearConfirmLocal: 'למחוק את כל היסטוריית האימונים? פעולה זו אינה הפיכה.',
  clearConfirmAccount: 'למחוק את כל הנתונים מהחשבון ומכל המכשירים? פעולה זו אינה הפיכה.',
  toast: {
    cleared: 'כל הנתונים נמחקו',
    exported: 'קובץ הגיבוי ירד למכשיר',
    badFile: 'קובץ לא תקין — הייבוא בוטל',
    merged: (n: number) => `נוספו ${n} רשומות מהגיבוי ✓`,
    alreadyThere: 'הגיבוי כבר קיים בחשבון',
    restored: 'הנתונים שוחזרו בהצלחה ✓',
  },
};

const en: typeof he = {
  plan: {
    title: 'Training plan',
    custom: (rev: number) => `Custom · version ${rev}`,
    original: 'The original plan',
    edit: '⚙️ Edit plan',
  },
  data: {
    title: 'My data',
    sub: 'Local backup',
    note: 'Everything is stored on this device · back it up and restore it as a JSON file',
    export: '⬇ Export JSON',
    import: '⬆ Import JSON',
    clear: '🗑 Delete',
  },
  info: (version: string) => `Gym RPG · version ${version}<br>💪 Works 100% offline · your data stays on this device`,
  clearConfirmLocal: 'Delete your entire workout history? This cannot be undone.',
  clearConfirmAccount: 'Delete all data from your account and every device? This cannot be undone.',
  toast: {
    cleared: 'All data deleted',
    exported: 'Backup file downloaded',
    badFile: 'Invalid file — import cancelled',
    merged: (n: number) => `Added ${n} records from the backup ✓`,
    alreadyThere: 'This backup is already in your account',
    restored: 'Data restored ✓',
  },
};

export const settings: Catalog<typeof he> = { he, en };
