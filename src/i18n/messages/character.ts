/**
 * i18n/messages/character.ts — the דמות screen: the stage, the roster of
 * skins, the stat grid, the body-part bars, the weekly streak, the coin shop
 * and the trophy shelf — plus the two strings the character DRAWING carries
 * (its default aria-label and a trophy medallion's).
 *
 * `stats` is shared with the arena's combat-power card (ui/battle.ts), which
 * shows the same six numbers under the same six names.
 *
 * Every Hebrew value is the exact string the screen printed before i18n,
 * whitespace included (the DOM tests pin them).
 */

import type { BodyPart } from '../../data/program.ts';
import type { Catalog } from '../locale.ts';

const he = {
  stats: {
    atk: 'התקפה',
    def: 'הגנה',
    hp: 'חיים',
    speed: 'מהירות',
    crit: 'קריטי',
    regen: 'התאוששות',
  },
  partRole: {
    chest: 'כוח התקפה',
    back: 'הגנה',
    legs: 'נקודות חיים',
    shoulders: 'מהירות התקפה',
    arms: 'מכה קריטית',
    core: 'התאוששות',
  } as Readonly<Record<BodyPart, string>>,
  svg: {
    label: 'הדמות שלך',
    trophy: (boss: string, world: string) => `גביע: ${boss}, ${world}`,
  },
  shop: {
    max: '⭐ מקסימלי',
    upgradeLabel: (label: string) => `שדרוג ל־${label}`,
    missing: (n: number) => `חסרים 🪙 ${n}`,
    upgrade: (cost: number) => `⬆ שדרוג · 🪙 ${cost}`,
    unequip: 'הסר',
    equip: 'הצטייד',
    tier: (n: number) => `דרגה ${n}`,
    empty: 'ריק',
    title: 'חנות הציוד',
    sub: (coins: string, worn: number, slots: number) => `🪙 ${coins} · ${worn}/${slots} מצויד`,
    note: 'מטבעות נצברים מגלים, ממיני־בוסים ובעיקר מבוסי עולם. הציוד מתווסף לסטטיסטיקות לפני בונוס הרצף — כך שגם הרצף מגביר אותו.',
    upgradeNote: (max: string, mult: number) =>
      `כל פריט שבבעלותכם ניתן לשדרוג עד <b>${max}</b>: כל דרגת שדרוג מכפילה את בונוס הפריט עצמו (עד ×${mult}) ומוסיפה לו נצנוץ, זוהר וכוכב על הדמות.`,
  },
  roster: {
    previewing: '👁 בתצוגה',
    selected: '● נבחרה',
    unlocked: '✓ נפתחה',
    costAria: (cost: number) => ` · ${cost} מטבעות`,
    title: 'דמויות',
    sub: (unlocked: number, total: number, coins: string) => `${unlocked}/${total} נפתחו · 🪙 ${coins}`,
    bodiesLabel: 'בחירת גוף',
    note: `שני הגופים פתוחים תמיד וללא עלות, ו<b>כל מראה שנרכש נפתח בשניהם</b>.
    כל הדמויות הן <b>קוסמטיקה בלבד</b> — הן לא משנות אף סטטיסטיקה, רק את המראה.
    כל דמות גדלה מאותן שש רמות גוף ולובשת את אותו ציוד.`,
  },
  sheet: {
    label: 'אישור רכישת דמות',
    price: (cost: number, coins: string) => `מחיר: <b>🪙 ${cost}</b> · יש לכם: <b>🪙 ${coins}</b>`,
    back: '↩ חזרה לדמות שלי',
    preview: '👁 תצוגה מקדימה',
    previewNote: 'התצוגה המקדימה מלבישה את המראה הזה על הגוף, הרמות והציוד שלכם — בלי לרכוש ובלי לשנות דבר.',
    buy: (cost: number) => `🪙 ${cost} · קנייה`,
    missing: (n: number) => `חסרים 🪙 ${n}`,
    cancel: 'ביטול',
    buyNote: 'המראה ייפתח לתמיד — בשני הגופים — וייבחר מיד. אין לכך שום השפעה על הסטטיסטיקות.',
    missingNote: (n: number) => `חסרים ${n} 🪙 — נצחו עוד גלים או בוס עולם ותחזרו.`,
  },
  trophies: {
    title: 'גביעים',
    sub: (bosses: number, minis: number) => `${bosses} בוסי עולם · ${minis} מיני־בוסים`,
    empty: 'עדיין לא הפלתם בוס עולם. כל בוס שתפילו ישאיר כאן גביע קבוע — ומדליה על החזה של הדמות. 🏆',
    minis: 'מיני־בוסים',
    waves: 'גלים',
    bosses: 'בוסי עולם',
  },
  stage: {
    previewLabel: (name: string) => `תצוגה מקדימה: ${name}`,
    levelLabel: 'רמת דמות',
    level: 'רמה',
    streakChip: (tier: number, pct: number) => `🔥 דרגה ${tier} · +${pct}%`,
    previewChip: '👁 תצוגה מקדימה — לא נרכש',
    totalXp: 'סה״כ XP',
    energy: 'אנרגיית קרב',
    coins: 'מטבעות',
    prs: 'שיאים אישיים',
  },
  power: {
    title: 'כוח לחימה',
    sub: 'רמות גוף + ציוד + רצף',
    note: (world: string, wave: number, cleared: number) =>
      `אלה הסטטיסטיקות שמפעילות את לשונית 🎮 קרב · ${world} · גל ${wave} · ${cleared} גלים נוצחו`,
  },
  parts: {
    title: 'חלקי גוף',
    sub: 'כל תרגיל מזין חלק אחר',
    level: (n: number) => `רמה ${n}`,
  },
  streak: {
    title: 'רצף שבועי',
    sub: (n: number) => `${n} ימי אימון בשבוע`,
    tier: 'דרגת רצף',
    week: (done: number, needed: number, pct: number) => `השבוע: <b>${done}/${needed}</b> ימי אימון ·
          בונוס קבוע: <b>+${pct}%</b> לכל הסטטיסטיקות`,
    rule: (needed: number) =>
      `שבוע מושלם מוסיף דרגה · שבוע עם פחות מ־${needed} אימונים מוריד דרגה אחת (אף פעם לא מתחת ל־0, ורמות לעולם לא נלקחות).`,
  },
  toast: {
    heroFallback: 'הדמות',
    itemFallback: 'הפריט',
    selected: (name: string) => `${name} נכנסה לזירה! ✨`,
    noCoins: 'אין מספיק מטבעות — נצחו עוד גלים או בוס עולם. 🪙',
    cannotBuyCharacter: 'לא ניתן לרכוש את הדמות הזו.',
    boughtCharacter: (name: string) => `${name} נרכשה — בשני הגופים! 🎭`,
    cannotBuyItem: 'לא ניתן לקנות את הפריט הזה.',
    boughtItem: (name: string) => `${name} נרכש והוצמד! ✨`,
    noCoinsUpgrade: 'אין מספיק מטבעות לשדרוג — נצחו עוד גלים או בוס עולם. 🪙',
    maxed: 'הפריט כבר בשדרוג המקסימלי. ⭐',
    cannotUpgrade: 'לא ניתן לשדרג את הפריט הזה.',
    upgraded: (name: string, label: string) => `${name} שודרג ל־${label}! ⬆`,
  },
};

const en: typeof he = {
  stats: {
    atk: 'Attack',
    def: 'Defense',
    hp: 'HP',
    speed: 'Speed',
    crit: 'Crit',
    regen: 'Regen',
  },
  partRole: {
    chest: 'Attack power',
    back: 'Defense',
    legs: 'Hit points',
    shoulders: 'Attack speed',
    arms: 'Critical hits',
    core: 'Recovery',
  },
  svg: {
    label: 'Your hero',
    trophy: (boss: string, world: string) => `Trophy: ${boss}, ${world}`,
  },
  shop: {
    max: '⭐ Maxed',
    upgradeLabel: (label: string) => `Upgrade to ${label}`,
    missing: (n: number) => `Need 🪙 ${n} more`,
    upgrade: (cost: number) => `⬆ Upgrade · 🪙 ${cost}`,
    unequip: 'Remove',
    equip: 'Equip',
    tier: (n: number) => `Tier ${n}`,
    empty: 'Empty',
    title: 'Gear shop',
    sub: (coins: string, worn: number, slots: number) => `🪙 ${coins} · ${worn}/${slots} equipped`,
    note: 'Coins come from waves, mini-bosses and above all world bosses. Gear adds to your stats before the streak bonus — so your streak boosts it too.',
    upgradeNote: (max: string, mult: number) =>
      `Every item you own can be upgraded up to <b>${max}</b>: each upgrade multiplies the item's own bonus (up to ×${mult}) and adds sparkle, glow and a star on your hero.`,
  },
  roster: {
    previewing: '👁 Previewing',
    selected: '● Selected',
    unlocked: '✓ Unlocked',
    costAria: (cost: number) => ` · ${cost} coins`,
    title: 'Characters',
    sub: (unlocked: number, total: number, coins: string) => `${unlocked}/${total} unlocked · 🪙 ${coins}`,
    bodiesLabel: 'Choose a body',
    note: `Both bodies are always free, and <b>every look you buy unlocks on both</b>.
    All characters are <b>cosmetic only</b> — they change no stat, just the look.
    Every character grows from the same six body levels and wears the same gear.`,
  },
  sheet: {
    label: 'Confirm character purchase',
    price: (cost: number, coins: string) => `Price: <b>🪙 ${cost}</b> · You have: <b>🪙 ${coins}</b>`,
    back: '↩ Back to my hero',
    preview: '👁 Preview',
    previewNote: 'The preview puts this look on your body, levels and gear — nothing is bought, nothing changes.',
    buy: (cost: number) => `🪙 ${cost} · Buy`,
    missing: (n: number) => `Need 🪙 ${n} more`,
    cancel: 'Cancel',
    buyNote: 'The look unlocks for good — on both bodies — and is selected right away. It has no effect on stats.',
    missingNote: (n: number) => `${n} 🪙 short — win more waves or a world boss and come back.`,
  },
  trophies: {
    title: 'Trophies',
    sub: (bosses: number, minis: number) => `${bosses} world bosses · ${minis} mini-bosses`,
    empty: "No world boss down yet. Every boss you defeat leaves a trophy here for good — and a medal on your hero's chest. 🏆",
    minis: 'Mini-bosses',
    waves: 'Waves',
    bosses: 'World bosses',
  },
  stage: {
    previewLabel: (name: string) => `Preview: ${name}`,
    levelLabel: 'Hero level',
    level: 'Level',
    streakChip: (tier: number, pct: number) => `🔥 Tier ${tier} · +${pct}%`,
    previewChip: '👁 Preview — not owned',
    totalXp: 'Total XP',
    energy: 'Battle energy',
    coins: 'Coins',
    prs: 'Personal records',
  },
  power: {
    title: 'Combat power',
    sub: 'Body levels + gear + streak',
    note: (world: string, wave: number, cleared: number) =>
      `These stats drive the 🎮 Battle tab · ${world} · Wave ${wave} · ${cleared} waves won`,
  },
  parts: {
    title: 'Body parts',
    sub: 'Every exercise feeds a different part',
    level: (n: number) => `Level ${n}`,
  },
  streak: {
    title: 'Weekly streak',
    sub: (n: number) => `${n} training days a week`,
    tier: 'Streak tier',
    week: (done: number, needed: number, pct: number) => `This week: <b>${done}/${needed}</b> training days ·
          permanent bonus: <b>+${pct}%</b> to all stats`,
    rule: (needed: number) =>
      `A perfect week adds a tier · a week with fewer than ${needed} workouts drops one (never below 0, and levels are never taken away).`,
  },
  toast: {
    heroFallback: 'Your hero',
    itemFallback: 'The item',
    selected: (name: string) => `${name} enters the arena! ✨`,
    noCoins: 'Not enough coins — win more waves or a world boss. 🪙',
    cannotBuyCharacter: "This character can't be bought.",
    boughtCharacter: (name: string) => `${name} unlocked — on both bodies! 🎭`,
    cannotBuyItem: "This item can't be bought.",
    boughtItem: (name: string) => `${name} bought and equipped! ✨`,
    noCoinsUpgrade: 'Not enough coins to upgrade — win more waves or a world boss. 🪙',
    maxed: 'This item is already fully upgraded. ⭐',
    cannotUpgrade: "This item can't be upgraded.",
    upgraded: (name: string, label: string) => `${name} upgraded to ${label}! ⬆`,
  },
};

export const character: Catalog<typeof he> = { he, en };
