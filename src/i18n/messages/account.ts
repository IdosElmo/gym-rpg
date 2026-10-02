/**
 * i18n/messages/account.ts — the ☁️ account card (sync/account.ts): sign-in,
 * sync status, the pending count and the שם לוחם (warrior name) editor.
 */

import type { HandleError } from '../../core/handle.ts';
import type { Catalog } from '../locale.ts';

const HANDLE_ERRORS_HE: Readonly<Record<HandleError, string>> = {
  empty: 'צריך שם.',
  too_short: 'לפחות 3 תווים.',
  too_long: 'עד 20 תווים.',
  bad_chars: 'אותיות בעברית או באנגלית, ספרות ו־ _ . - בלבד.',
};

const he = {
  ago: {
    never: 'עדיין לא סונכרן',
    now: 'סונכרן זה עתה',
    minutes: (n: number) => `סונכרן לפני ${n} דקות`,
    hours: (n: number) => `סונכרן לפני ${n} שעות`,
    days: (n: number) => `סונכרן לפני ${n} ימים`,
  },
  syncing: 'מסנכרן…',
  offline: 'אין חיבור — הנתונים יסונכרנו כשהחיבור יחזור',
  error: 'הסנכרון נכשל — ננסה שוב אוטומטית',
  allBackedUp: 'הכל מגובה ✓',
  pending: (n: number) => `${n} פעולות ממתינות לגיבוי`,
  title: '☁️ סנכרון בענן',
  actionNeeded: 'נדרשת פעולה',
  reauth: 'פג תוקף החיבור — נדרשת התחברות מחדש. הנתונים במכשיר לא נפגעו.',
  signIn: 'התחברות עם Google',
  optional: 'אופציונלי',
  invite: 'התחברו כדי לגבות את האימונים ולסנכרן בין מכשירים. בלי התחברות הכל ממשיך לעבוד מקומית, בדיוק כמו היום.',
  signedInAs: (who: string) => `מחובר כ־<b>${who}</b>`,
  googleUser: 'משתמש Google',
  signOut: 'התנתקות',
  signOutConfirm: 'להתנתק מהחשבון? הנתונים יישארו במכשיר; הסנכרון ייפסק.',
  handle: {
    label: 'שם לוחם',
    hint: '— השם שיריבים מקלידים כדי להילחם בכם',
    placeholder: 'לדוגמה: יוסי',
    save: 'שמירה',
    saving: 'שומר…',
    saved: (handle: string) => `נשמר ✓ יריבים יכולים להילחם ב"${handle}"`,
    taken: 'השם הזה כבר תפוס — נסו שם אחר.',
    errors: HANDLE_ERRORS_HE,
  },
};

const en: typeof he = {
  ago: {
    never: 'Not synced yet',
    now: 'Synced just now',
    minutes: (n: number) => `Synced ${n} ${n === 1 ? 'minute' : 'minutes'} ago`,
    hours: (n: number) => `Synced ${n} ${n === 1 ? 'hour' : 'hours'} ago`,
    days: (n: number) => `Synced ${n} ${n === 1 ? 'day' : 'days'} ago`,
  },
  syncing: 'Syncing…',
  offline: "Offline — your data will sync when you're back online",
  error: 'Sync failed — retrying automatically',
  allBackedUp: 'Everything is backed up ✓',
  pending: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'} waiting to back up`,
  title: '☁️ Cloud sync',
  actionNeeded: 'action needed',
  reauth: 'Your session expired — please sign in again. The data on this device is safe.',
  signIn: 'Sign in with Google',
  optional: 'optional',
  invite:
    'Sign in to back up your workouts and sync them across devices. Without signing in, everything keeps working locally, just like now.',
  signedInAs: (who: string) => `Signed in as <b>${who}</b>`,
  googleUser: 'Google user',
  signOut: 'Sign out',
  signOutConfirm: 'Sign out? Your data stays on this device; syncing stops.',
  handle: {
    label: 'Warrior name',
    hint: '— the name rivals type to fight you',
    placeholder: 'e.g. alex',
    save: 'Save',
    saving: 'Saving…',
    saved: (handle: string) => `Saved ✓ rivals can now fight "${handle}"`,
    taken: 'That name is taken — try another one.',
    errors: {
      empty: 'A name is required.',
      too_short: 'At least 3 characters.',
      too_long: 'At most 20 characters.',
      bad_chars: 'Hebrew or English letters, digits and _ . - only.',
    },
  },
};

export const account: Catalog<typeof he> = { he, en };
