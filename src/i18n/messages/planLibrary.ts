/**
 * i18n/messages/planLibrary.ts — the goal-based plan library
 * (`data/planLibrary.ts`): the names and descriptions of its 30 templates,
 * generated from days × location × variation, and the plan editor's grouping
 * of the "תוכניות מוכנות" sheet.
 *
 * Presentation only: a template's name and description are read every time a
 * picker draws them. The DAY LABELS a template builds live beside its data
 * (he + en) and become the user's content once saved.
 */

import type { Catalog } from '../locale.ts';
import type { Location } from '../../core/profile.ts';

type Days = 2 | 3 | 4 | 5 | 6;
type Sex = 'm' | 'f';

const he = {
  split: {
    2: 'פול באדי',
    3: 'פול באדי',
    4: 'עליון/תחתון',
    5: 'עליון/תחתון + דחיפה/משיכה/רגליים',
    6: 'דחיפה/משיכה/רגליים',
  } as Readonly<Record<Days, string>>,
  location: {
    gym: 'חדר כושר',
    home_dumbbells: 'בית, משקולות',
    home_none: 'בלי ציוד',
  } as Readonly<Record<Location, string>>,
  sex: { m: 'גברים', f: 'נשים' } as Readonly<Record<Sex, string>>,
  name: (split: string, days: number, location: string, sex: string) => `${split} · ${days} ימים · ${location} · ${sex}`,
  splitDesc: {
    2: 'שני אימוני כל־הגוף בשבוע, לסירוגין.',
    3: 'שלושה אימוני כל־הגוף שונים בשבוע.',
    4: 'ארבעה אימונים: פלג גוף עליון ותחתון לסירוגין — כל שריר פעמיים בשבוע.',
    5: 'חמישה אימונים: עליון ותחתון, ואחריהם דחיפה, משיכה ורגליים.',
    6: 'שישה אימונים: דחיפה, משיכה ורגליים — פעמיים בשבוע.',
  } as Readonly<Record<Days, string>>,
  locationDesc: {
    gym: 'מוטות, כבלים ומכונות.',
    home_dumbbells: 'בבית, עם משקולות יד וגומיות.',
    home_none: 'בבית או בפארק — ספסל ומוט נמוך מספיקים.',
  } as Readonly<Record<Location, string>>,
  sexDesc: {
    m: 'קצת יותר נפח לחזה, לכתפיים ולידיים.',
    f: 'דגש נוסף על ישבן ורגליים.',
  } as Readonly<Record<Sex, string>>,
  /** The editor's presets sheet. */
  sheet: {
    original: 'התוכניות המקוריות',
    forYou: 'מתאימות לך',
    forYouNote: 'לפי השאלון — נבנות עם המטרה, הניסיון, אורך האימון והמגבלות שלך.',
    byLocation: (location: string) => `ספריית התוכניות · ${location}`,
    count: (n: number) => `${n} תוכניות`,
    recommended: 'מומלצת',
  },
};

const en: typeof he = {
  split: {
    2: 'Full Body',
    3: 'Full Body',
    4: 'Upper/Lower',
    5: 'Upper/Lower + Push/Pull/Legs',
    6: 'Push/Pull/Legs',
  },
  location: {
    gym: 'Gym',
    home_dumbbells: 'Home, dumbbells',
    home_none: 'No equipment',
  },
  sex: { m: 'Men', f: 'Women' },
  name: (split: string, days: number, location: string, sex: string) => `${split} · ${days} days · ${location} · ${sex}`,
  splitDesc: {
    2: 'Two full-body workouts a week, alternating.',
    3: 'Three different full-body workouts a week.',
    4: 'Four workouts: upper and lower body alternating — every muscle twice a week.',
    5: 'Five workouts: upper and lower, then push, pull and legs.',
    6: 'Six workouts: push, pull and legs — twice a week.',
  },
  locationDesc: {
    gym: 'Barbells, cables and machines.',
    home_dumbbells: 'At home, with dumbbells and bands.',
    home_none: 'At home or in the park — a bench and a low bar are enough.',
  },
  sexDesc: {
    m: 'A little more chest, shoulder and arm volume.',
    f: 'Extra emphasis on glutes and legs.',
  },
  sheet: {
    original: 'The original plans',
    forYou: 'Plans for you',
    forYouNote: 'From your questionnaire — built with your goal, experience, session length and limitations.',
    byLocation: (location: string) => `Plan library · ${location}`,
    count: (n: number) => `${n} plans`,
    recommended: 'Recommended',
  },
};

export const planLibrary: Catalog<typeof he> = { he, en };
