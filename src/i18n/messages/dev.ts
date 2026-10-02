/**
 * i18n/messages/dev.ts — the owner's 🛠 dev mode: the card at the bottom of
 * ⚙️ הגדרות (ui/devPanel.ts), its toasts and confirm, and the console help
 * that `gymDev.help()` prints (dev/actions.ts).
 */

import type { Catalog } from '../locale.ts';

const he = {
  purgeConfirm:
    'לנקות את כל שיפורי המפתח? האנרגיה, המטבעות, ה־XP והאיפוסים שניתנו במצב מפתח יבוטלו, ' +
    'והדמות תחזור למצב שנובע מהאימונים האמיתיים בלבד. אימונים, קרבות ורכישות אמיתיים נשארים.',
  title: '🛠 מצב מפתח',
  sub: 'חשבון הבעלים בלבד',
  note: `בדיקת יכולות בלי להתאמן. כל הענקה נרשמת ביומן כאירוע אמיתי מסומן 🛠,
      מסתנכרנת לכל המכשירים, ומופיעה גם ליריבים בדו־קרב.`,
  energy: (n: number) => `⚡ +${n} אנרגיה`,
  coins: (n: number) => `🪙 +${n} מטבעות`,
  levels: (n: number) => `⬆ +${n} רמה לכל חלקי הגוף`,
  complete: '💪 השלמת אימון היום',
  resetDaily: '🎲 איפוס אתגר יומי',
  resetDuels: '⚔️ איפוס דו־קרבות היום',
  cooldowns: '⏳ איפוס זמני קירור',
  xpLabel: (n: number) => `+${n} XP לחלק גוף`,
  part: 'חלק גוף',
  grant: '✨ הענקה',
  purge: '🧹 ניקוי שיפורי מפתח',
  console: 'אותן פעולות זמינות בקונסולה דרך <b>gymDev</b> — הקלידו <b>gymDev.help()</b>.',
  toast: {
    energy: (n: number, total: number) => `🛠 +${n} ⚡ · סה״כ ${total} ⚡`,
    coins: (n: number, total: number) => `🛠 +${n} 🪙 · סה״כ ${total} 🪙`,
    levels: (n: number, level: number) => `🛠 +${n} רמה לכל חלקי הגוף · רמה ${level}`,
    completed: '🛠 בונוס סיום האימון של היום ניתן',
    alreadyCompleted: '🛠 הבונוס של היום כבר ניתן',
    dailyReset: '🛠 האתגר היומי נפתח מחדש',
    duelsReset: '🛠 דו־קרבות היום נפתחו מחדש',
    cooldowns: '🛠 זמני הקירור אופסו',
    noBattle: '🛠 אין קרב פעיל — הקירורים מתאפסים ממילא בכניסה לזירה',
    unknownPart: '🛠 חלק גוף לא מוכר',
    xp: (n: number, part: string) => `🛠 +${n} XP ל${part}`,
    purged: '🛠 שיפורי המפתח נוקו — הדמות חזרה לאימונים האמיתיים',
  },
  /** `gymDev.help()` — Hebrew with an English gloss on every line, as always. */
  help: (g: { energy: number; coins: number; xp: number; levels: number; parts: string }) =>
    [
      '🛠 מצב מפתח — window.gymDev',
      '',
      `gymDev.addEnergy(n = ${g.energy})    ⚡ הענקת אנרגיה  · grant battle energy`,
      `gymDev.addCoins(n = ${g.coins})     🪙 הענקת מטבעות  · grant coins`,
      `gymDev.addXp(part, n = ${g.xp})   ✨ XP לחלק גוף     · grant XP to one body part`,
      `     part: ${g.parts}`,
      `gymDev.levelAllParts(n = ${g.levels})    ⬆ רמה לכל חלקי הגוף · +n levels everywhere`,
      "gymDev.completeToday()      💪 בונוס סיום אימון להיום · today's completion bonus",
      "gymDev.resetDaily()         🎲 פתיחת האתגר היומי מחדש · replay today's challenge",
      "gymDev.resetDuels()         ⚔️ פתיחת דו־קרבות היום מחדש · replay today's duels",
      'gymDev.resetCooldowns()     ⏳ איפוס זמני קירור (רק בקרב פעיל) · live battle only',
      'gymDev.purge()              🧹 ביטול כל הענקות המפתח · undo every dev grant',
      'gymDev.state()              📋 תצלום קפוא של מצב המשחק · frozen game state',
      '',
      'כל הענקה היא אירוע אמיתי ביומן, מסומן 🛠, ומסתנכרנת לכל המכשירים.',
      'Every grant is a real, 🛠-marked event in the log and syncs across devices.',
    ].join('\n'),
};

const en: typeof he = {
  purgeConfirm:
    'Clear every dev-mode boost? The energy, coins, XP and resets granted in dev mode are revoked, ' +
    'and the hero returns to what real training alone has earned. Real workouts, battles and purchases stay.',
  title: '🛠 Dev mode',
  sub: 'owner account only',
  note: `Try things out without training. Every grant is logged as a real 🛠-marked event,
      syncs to every device, and shows to duel opponents too.`,
  energy: (n: number) => `⚡ +${n} energy`,
  coins: (n: number) => `🪙 +${n} coins`,
  levels: (n: number) => `⬆ +${n} level to every body part`,
  complete: "💪 Complete today's workout",
  resetDaily: '🎲 Reset daily challenge',
  resetDuels: "⚔️ Reset today's duels",
  cooldowns: '⏳ Reset cooldowns',
  xpLabel: (n: number) => `+${n} XP to one body part`,
  part: 'Body part',
  grant: '✨ Grant',
  purge: '🧹 Clear dev boosts',
  console: 'The same actions are available in the console via <b>gymDev</b> — type <b>gymDev.help()</b>.',
  toast: {
    energy: (n: number, total: number) => `🛠 +${n} ⚡ · total ${total} ⚡`,
    coins: (n: number, total: number) => `🛠 +${n} 🪙 · total ${total} 🪙`,
    levels: (n: number, level: number) => `🛠 +${n} level to every body part · level ${level}`,
    completed: "🛠 Today's workout-completion bonus granted",
    alreadyCompleted: "🛠 Today's bonus was already granted",
    dailyReset: "🛠 Today's daily challenge is open again",
    duelsReset: "🛠 Today's duels are open again",
    cooldowns: '🛠 Cooldowns reset',
    noBattle: '🛠 No battle running — cooldowns reset anyway when you enter the arena',
    unknownPart: '🛠 Unknown body part',
    xp: (n: number, part: string) => `🛠 +${n} XP to ${part}`,
    purged: '🛠 Dev boosts cleared — the hero is back to real training',
  },
  help: (g: { energy: number; coins: number; xp: number; levels: number; parts: string }) =>
    [
      '🛠 Dev mode — window.gymDev',
      '',
      `gymDev.addEnergy(n = ${g.energy})    ⚡ grant battle energy`,
      `gymDev.addCoins(n = ${g.coins})     🪙 grant coins`,
      `gymDev.addXp(part, n = ${g.xp})   ✨ grant XP to one body part`,
      `     part: ${g.parts}`,
      `gymDev.levelAllParts(n = ${g.levels})    ⬆ +n levels to every body part`,
      "gymDev.completeToday()      💪 today's workout-completion bonus",
      "gymDev.resetDaily()         🎲 replay today's daily challenge",
      "gymDev.resetDuels()         ⚔️ replay today's duels",
      'gymDev.resetCooldowns()     ⏳ reset cooldowns (live battle only)',
      'gymDev.purge()              🧹 undo every dev grant',
      'gymDev.state()              📋 frozen snapshot of the game state',
      '',
      'Every grant is a real, 🛠-marked event in the log and syncs across devices.',
    ].join('\n'),
};

export const dev: Catalog<typeof he> = { he, en };
