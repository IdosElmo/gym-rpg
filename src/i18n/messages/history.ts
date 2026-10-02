/**
 * i18n/messages/history.ts — the היסטוריה screen: the logged-workout pane
 * (date bubbles and the day card each one opens). The adventure feed above it
 * is `ui/feed.ts`'s own.
 *
 * Every Hebrew value is the exact string the screen printed before i18n.
 */

import type { Catalog } from '../locale.ts';

const he = {
  empty: 'עדיין אין אימונים מתועדים.<br>סמנו סטים באחד מימי האימון והם יופיעו כאן. 💪',
  bubblesLabel: 'ימי אימון מתועדים',
  panelLabel: 'פירוט האימון',
  heading: 'אימונים מתועדים',
  hint: 'בחרו תאריך',
  /** Appended to a bubble's accessible name when every set was ticked. */
  done: ' · הושלם',
  /** After the day's label in its card's title: " (יום ראשון)". */
  dayOf: (caption: string) => ` (יום ${caption})`,
  /** After a cardio stage's minutes ("3%×5 דק׳"). */
  minSuffix: ' דק׳',
};

const en: typeof he = {
  empty: 'No workouts logged yet.<br>Tick sets on one of your workout days and they will show up here. 💪',
  bubblesLabel: 'Logged workout days',
  panelLabel: 'Workout details',
  heading: 'Logged workouts',
  hint: 'pick a date',
  done: ' · completed',
  dayOf: (caption: string) => ` (${caption})`,
  minSuffix: ' min',
};

export const history: Catalog<typeof he> = { he, en };
