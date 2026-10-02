/**
 * i18n/messages/feed.ts — the adventure feed of the היסטוריה screen
 * (ui/feed.ts).
 *
 * The feed is built from the event log AT RENDER TIME — presentation, never
 * stored — so its lines are translated like any other copy. Names inside them
 * (worlds, bosses, items, exercises, body parts) arrive already in the
 * reader's language and already escaped; numbers arrive as numbers.
 */

import type { EquipmentSlot } from '../../data/gameContent.ts';
import type { Catalog } from '../locale.ts';

const he = {
  devParts: {
    one: (part: string) => `ל${part}`,
    all: 'לכל חלקי הגוף',
    some: (n: number) => `ל־${n} חלקי גוף`,
  },
  waves: {
    one: (n: number) => `גל ${n}`,
    range: (from: number, to: number) => `גלים ${from}–${to}`,
    cleared: (span: string, world: string, coins: number) => `${span} ב${world} נוצחו · +${coins} 🪙`,
    miniBoss: (overtime: boolean, wave: number, world: string, coins: number) =>
      `מיני־בוס ב${overtime ? 'גל הארכה' : 'גל'} ${wave} (${world}) הופל! +${coins} 🪙`,
  },
  levelUp: (part: string, to: number, retro: boolean) => `${part} עלה לרמה ${to}${retro ? ' (מהיסטוריה)' : ''}`,
  pr: (name: string, volume: number, previous: number) => `שיא אישי ב${name} · ${volume} (קודם ${previous})`,
  workout: 'אימון הושלם במלואו',
  workoutDay: (label: string) => `אימון הושלם במלואו · ${label}`,
  streakUp: (to: number, pct: number) => `שבוע מושלם! דרגת רצף ${to} · בונוס +${pct}% לכל הסטטיסטיקות`,
  streakDown: (to: number, pct: number) => `דרגת רצף ירדה ל־${to} · הבונוס עכשיו +${pct}%`,
  boss: {
    early: (deficit: number) => ` ⚔️ קרב מוקדם, ${deficit} רמות מתחת למומלץ`,
    endgame: (name: string, coins: number, early: string) => `${name} הובס — מצב אלוף נפתח! +${coins} 🪙${early}`,
    world: (name: string, world: string, next: number, coins: number, early: string) =>
      `בוס העולם ${name} (${world}) הובס! עולם ${next} נפתח · +${coins} 🪙${early}`,
  },
  daily: (score: number, waves: number, coins: number, complete: boolean) =>
    `אתגר יומי: ${score}/${waves} · +${coins} 🪙${complete ? ' · גאונטלט מלא' : ''}`,
  duel: (won: boolean, who: string, coins: number) =>
    `${won ? `ניצחון על ${who}!` : `הפסד מול ${who}`} ‏+${coins} 🪙`,
  dev: {
    energy: (n: number) => `אנרגיה: +${n} ⚡ (מצב מפתח)`,
    xp: (n: number, parts: string) => `XP: +${n} ${parts} (מצב מפתח)`,
    coins: (n: number) => `מטבעות: +${n} 🪙 (מצב מפתח)`,
    resetDuels: `דו־קרבות היום אופסו — אפשר להילחם שוב (מצב מפתח)`,
    resetDaily: `האתגר היומי אופס — אפשר לשחק שוב (מצב מפתח)`,
    purge: 'הענקות מצב המפתח בוטלו — הדמות חזרה לאימונים האמיתיים בלבד',
  },
  bought: (item: string, cost: number) => `${item} נרכש בחנות · −${cost} 🪙`,
  imported: (n: number) => `יובאו נתונים מקובץ (${n} אירועים)`,
  skin: (skin: string, cost: number) => `דמות ${skin} נרכשה · −${cost} 🪙`,
  upgraded: (item: string, level: string, cost: number) => `שודרג: ${item} ${level} · −${cost} 🪙`,
  equipped: (item: string, slot: string) => `${item} הוצמד (${slot})`,
  unequipped: (slot: string) => `${slot} הוסרה`,
  /** Slot names in the reader's language (Hebrew reads `SLOT_HE` directly). */
  slots: null as Readonly<Record<EquipmentSlot, string>> | null,
  card: {
    title: 'יומן הרפתקה',
    emptySub: 'אירועי המשחק',
    empty: 'עדיין אין אירועים. סמנו סטים כדי להעלות רמות ופתחו את לשונית הקרב. ⚔️',
    sub: (n: number) => `${n} אירועים אחרונים`,
  },
};

const en: typeof he = {
  devParts: {
    one: (part: string) => `to ${part}`,
    all: 'to every body part',
    some: (n: number) => `to ${n} body parts`,
  },
  waves: {
    one: (n: number) => `Wave ${n}`,
    range: (from: number, to: number) => `Waves ${from}–${to}`,
    cleared: (span: string, world: string, coins: number) => `${span} cleared in ${world} · +${coins} 🪙`,
    miniBoss: (overtime: boolean, wave: number, world: string, coins: number) =>
      `Mini-boss of ${overtime ? 'overtime wave' : 'wave'} ${wave} (${world}) down! +${coins} 🪙`,
  },
  levelUp: (part: string, to: number, retro: boolean) => `${part} reached level ${to}${retro ? ' (from history)' : ''}`,
  pr: (name: string, volume: number, previous: number) => `Personal record in ${name} · ${volume} (was ${previous})`,
  workout: 'Workout fully completed',
  workoutDay: (label: string) => `Workout fully completed · ${label}`,
  streakUp: (to: number, pct: number) => `Perfect week! Streak tier ${to} · +${pct}% bonus to every stat`,
  streakDown: (to: number, pct: number) => `Streak tier dropped to ${to} · the bonus is now +${pct}%`,
  boss: {
    early: (deficit: number) => ` ⚔️ early fight, ${deficit} ${deficit === 1 ? 'level' : 'levels'} below recommended`,
    endgame: (name: string, coins: number, early: string) =>
      `${name} defeated — Champion mode unlocked! +${coins} 🪙${early}`,
    world: (name: string, world: string, next: number, coins: number, early: string) =>
      `World boss ${name} (${world}) defeated! World ${next} unlocked · +${coins} 🪙${early}`,
  },
  daily: (score: number, waves: number, coins: number, complete: boolean) =>
    `Daily challenge: ${score}/${waves} · +${coins} 🪙${complete ? ' · full gauntlet' : ''}`,
  duel: (won: boolean, who: string, coins: number) => `${won ? `Victory over ${who}!` : `Lost to ${who}`} ‎+${coins} 🪙`,
  dev: {
    energy: (n: number) => `Energy: +${n} ⚡ (dev mode)`,
    xp: (n: number, parts: string) => `XP: +${n} ${parts} (dev mode)`,
    coins: (n: number) => `Coins: +${n} 🪙 (dev mode)`,
    resetDuels: "Today's duels reset — you can fight again (dev mode)",
    resetDaily: "Today's daily challenge reset — you can play again (dev mode)",
    purge: 'Dev-mode grants revoked — the hero is back to real training only',
  },
  bought: (item: string, cost: number) => `Bought ${item} in the shop · −${cost} 🪙`,
  imported: (n: number) => `Imported data from a file (${n} events)`,
  skin: (skin: string, cost: number) => `Unlocked the ${skin} look · −${cost} 🪙`,
  upgraded: (item: string, level: string, cost: number) => `Upgraded: ${item} ${level} · −${cost} 🪙`,
  equipped: (item: string, slot: string) => `Equipped ${item} (${slot})`,
  unequipped: (slot: string) => `${slot} removed`,
  slots: {
    helmet: 'Helmet',
    gloves: 'Gloves',
    shirt: 'Shirt',
    belt: 'Belt',
    leggings: 'Leggings',
    shoes: 'Shoes',
    cape: 'Cape',
  },
  card: {
    title: 'Adventure log',
    emptySub: 'game events',
    empty: 'No events yet. Check off sets to level up, then open the Battle tab. ⚔️',
    sub: (n: number) => `${n} latest events`,
  },
};

export const feed: Catalog<typeof he> = { he, en };
