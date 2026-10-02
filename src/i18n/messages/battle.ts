/**
 * i18n/messages/battle.ts — the קרב screen (ui/battle.ts): the world bar and
 * progress strip, the arena, the meters and skill bar, the daily-challenge
 * card, the boss gate and its coaching, the status line and every toast.
 *
 * Every Hebrew value is the exact string the arena printed before i18n,
 * whitespace and invisible marks included (the DOM tests pin them). Values
 * that are interpolated as HTML (`<b>…</b>`) are passed in already escaped.
 * Content names (worlds, enemies, skills, body parts) arrive already in the
 * reader's language — see `i18n/gameText.ts`.
 */

import type { Catalog } from '../locale.ts';

const he = {
  world: {
    of: (id: number, count: number) => `עולם ${id}/${count}`,
    championTagline: 'מצב אלוף — הגלים ממשיכים בלי סוף',
    waveLabel: 'גל',
  },
  arena: {
    heroLabel: 'הדמות שלך בקרב',
    attack: 'תקוף את האויב',
    bossFight: '🏛 קרב בוס',
    energy: '⚡ אנרגיה',
    energyFoot: (perWave: number) => `${perWave} ⚡ לכל גל · אנרגיה נצברת רק מאימון אמיתי`,
    super: '💥 מהלך על',
    superFoot: 'כל הקשה על האויב טוענת את המד',
    superBtn: '💥 שחרר מהלך על',
    coins: 'מטבעות',
    waves: 'גלים שנוצחו',
    minis: 'מיני־בוסים',
    bosses: 'בוסי עולם',
    coinsNote: 'המטבעות נקנים לציוד בלשונית 🦸 דמות — הציוד מתווסף לסטטיסטיקות ונראה על הדמות, גם כאן בזירה.',
    powerTitle: 'כוח לחימה',
    powerSub: 'נגזר מרמות הגוף',
    regen: (r: number) => `${r}/ש׳`,
    offlineNote: 'הקרב רץ רק כשלשונית הקרב פתוחה — אין רווחים אופליין.',
    miss: 'החמיץ!',
    you: 'אתם',
    overtimeWave: (n: number) => `הארכה ${n}`,
  },
  /** "חזה רמה 5" — a body part at a level (skill hints, gate rows, missing lists). */
  partLevel: (part: string, level: number) => `${part} רמה ${level}`,
  skills: {
    ready: 'מוכן',
    label: (name: string, summary: string) => `${name} — ${summary}`,
    lockedLabel: (name: string, hint: string) => `${name} — נעול. ${hint}`,
    group: 'מיומנויות גוף',
    foot: (need: number) => `כל חלק גוף פותח מיומנות ברמה ${need} — והיא מתחזקת עם כל רמה נוספת.`,
  },
  daily: {
    foeTitle: (wave: number, name: string) => `גל ${wave} · ${name}`,
    best: (score: number, total: number) => `שיא ${score}/${total}`,
    completed: (n: number) => `${n} ניצחונות מלאים`,
    streak: (n: number) => `🔥 ${n} ימים ברצף`,
    liveCount: (at: number, total: number) => `גל ${at}/${total}`,
    liveNote: 'ריצה אחת, בלי החייאות. יציאה מהזירה עכשיו = ויתור על הריצה של היום.',
    full: '🏅 גאונטלט מלא',
    doneToday: 'הושלם היום',
    doneNote: 'מחר יש אתגר חדש — אותו גאונטלט לכולם, נבנה מהתאריך עצמו.',
    lockedBtn: (fee: number) => `🔒 חסרה אנרגיה · ${fee} ⚡`,
    lockedNote: (have: string, fee: number, perSet: number) =>
      `יש לכם ${have} ⚡ מתוך ${fee}. לכו להתאמן — כל סט מסומן שווה ${perSet} ⚡.`,
    go: (fee: number) => `⚔️ התחילו את האתגר · ${fee} ⚡`,
    goNote: (total: number) => `${total} גלים מכל העולמות, ריצה אחת ליום, בלי החייאות. הניקוד = גלים שנוקו.`,
    label: 'אתגר יומי',
    chip: '🎲 אתגר יומי',
  },
  strip: {
    wave: (n: number) => `גל ${n}`,
    bossFight: 'קרב בוס',
    waveOf: (n: number, of: number) => `גל ${n}/${of}`,
    done: 'הושלם',
    locked: 'נעול',
    bossEarly: ' · הבוס פתוח לקרב מוקדם',
    bossOpen: ' · הבוס פתוח',
    label: 'התקדמות בעולמות',
    toastDone: (world: string) => `🏆 ${world} — הושלם.`,
    toastLocked: (world: string, prev: string) => `🔒 ${world} עדיין נעול — הפילו קודם את בוס ${prev}.`,
    toastChampion: (world: string) => `👑 מצב אלוף — הגלים ב${world} ממשיכים בלי סוף.`,
    toastGated: (missing: string, pct: number) =>
      `⚔️ לרמות המומלצות חסר: ${missing} — אפשר להילחם כבר עכשיו, הבוס מחוזק ב־${pct}%.`,
    toastOpen: (world: string, wave: number) => `✓ בוס ${world} פתוח — הגיעו לגל ${wave}.`,
  },
  gate: {
    championTitle: (boss: string) => `👑 ${boss} הובס`,
    championSub: 'מצב אלוף',
    championNote: `העולם הזה כבר שלכם. הגלים ממשיכים להגיע ולהתחזק בלי גבול — כל גל נוסף הוא שיא אישי חדש,
          והגביע מחכה לכם בלשונית 🦸 דמות.`,
    now: (have: number) => `(כרגע ${have})`,
    title: (boss: string) => `בוס העולם: ${boss}`,
    wavesLeft: (n: number) => `עוד ${n} גלים`,
    waiting: 'מחכה לכם',
    lockedNote: (missing: string, wave: number, hpPct: number, atkPct: number) =>
      `לרמות המומלצות חסר לכם: <b>${missing}</b>. אפשר להילחם כבר עכשיו — ״⚔️ קרב בוס מוקדם״ בגל ${wave}: הבוס יהיה מחוזק ב־<b>${hpPct}%</b> חיים ו־${atkPct}% נזק, וכל רמה שתעלו בחלקים האלה מחלישה אותו. בינתיים הזירה ממשיכה בקרבות אימון — בלי מטבעות ובלי התקדמות.`,
    openNote: (wave: number, cost: { energy: number; coins: number } | null) =>
      `כל הדרישות הושלמו! כפתור ״🏛 קרב בוס״ מחכה לכם בזירה בגל ${wave}${
        cost ? ` · עולה ${cost.energy} ⚡ · מזכה ב־${cost.coins} 🪙` : ''
      }.`,
  },
  coach: {
    noPace: 'עוד אין קצב למדוד לפיו — אחרי כמה אימונים נגיד לכם כמה נשאר.',
    eta: (over: number, left: number) =>
      `בקצב שלכם (${over} אימונים ב־4 השבועות האחרונים) הרמות המומלצות יושגו בעוד <b>~${left}</b> אימונים.`,
    left: (n: number) => ` · עוד ~${n} אימונים`,
    add: (list: string) => `הוסיפו: ${list}`,
    sets: (n: number, left: string) => `${n} סטים בשבוע בתוכנית${left}`,
    editPlan: '✏️ לעורך התוכנית',
  },
  status: {
    duelWon: (name: string, coins: number) => `🏆 ניצחתם את ${name}! הדו־קרב נרשם · ‏+${coins} 🪙`,
    duelLost: (name: string, coins: number) => `💀 ${name} ניצח הפעם — מחר יש הזדמנות חדשה · ‏+${coins} 🪙`,
    duelLive: (name: string) => `⚔️ דו־קרב מול ${name} — הוא נלחם בסטטיסטיקות האמיתיות שלו. הקישו ושחררו מיומנויות!`,
    dailyFull: (cleared: number, total: number) => `🏅 גאונטלט מלא! ${cleared}/${total} · חוזרים לזירה הרגילה…`,
    dailyOver: (cleared: number, total: number) => `🎲 האתגר היומי הסתיים — ${cleared}/${total} גלים. מחר יש חדש!`,
    dailyLive: (at: number, total: number) =>
      `🎲 אתגר יומי — גל ${at}/${total}. ריצה אחת, בלי החייאות: הקישו ושחררו מיומנויות.`,
    resting: (perSet: number, perWorkout: number) =>
      `😴 אין מספיק אנרגיה — הדמות נחה. לכו להתאמן! כל סט מסומן שווה ${perSet} ⚡ וסיום אימון עוד ${perWorkout} ⚡.`,
    recovering: (wave: number) => `💀 הופלתם בגל ${wave} — הדמות קמה ומנסה שוב.`,
    boss: (name: string) => `🏛 קרב בוס! ${name} — הקישו בלי הפסקה ושחררו כל מהלך על.`,
    overtimeOpen: (k: number, perWave: number, bossFee: number) =>
      `⏱ גל הארכה ${k} — הבוס מחכה לכפתור. משלם חצי מטבעות, עולה ${perWave} ⚡; דמי הבוס (${bossFee} ⚡) שמורים.`,
    overtimeGated: (k: number, missing: string, perWave: number) =>
      `⏱ גל הארכה ${k} — מטבעות לציוד בזמן שמתאמנים לרמות המומלצות (חסר: ${missing}), או לקרב מוקדם. עולה ${perWave} ⚡; דמי הבוס שמורים.`,
    sparringGated: (pct: number, missing: string) =>
      `🥊 קרב אימון — בלי מטבעות ובלי התקדמות. הבוס פתוח לקרב מוקדם (מחוזק ב־${pct}%); לרמות המומלצות חסר: ${missing}.`,
    sparringOpen: '🥊 קרב אימון — בלי מטבעות ובלי התקדמות. הבוס מוכן: לחצו על ״🏛 קרב בוס״ כשתרצו להתחיל.',
    tooStrong: '⚠️ האויב חזק מדי. לכו להתאמן כדי להעלות רמות — הסטטיסטיקות הן ההבדל.',
    tap: 'הקישו על האויב כדי לתקוף ולטעון את מד מהלך העל.',
    /** Stands in for an empty "missing" list. */
    training: 'אימון',
  },
  bossBtn: {
    early: (boss: string | null, pct: number, cost: number | null) =>
      `⚔️ קרב בוס מוקדם${boss ? `: ${boss}` : ''} · מחוזק +${pct}%${cost !== null ? ` · ${cost} ⚡` : ''}`,
    ready: (boss: string | null, cost: number | null) =>
      `🏛 קרב בוס${boss ? `: ${boss}` : ''}${cost !== null ? ` · ${cost} ⚡` : ''}`,
  },
  handleError: {
    empty: 'הקלידו את שם הלוחם של היריב.',
    too_short: 'שם לוחם הוא לפחות 3 תווים.',
    too_long: 'שם לוחם הוא עד 20 תווים.',
    bad_chars: 'שם לוחם יכול לכלול אותיות בעברית או באנגלית, ספרות ו־ _ . -',
    self: 'זה אתם — חפשו את השם של מישהו אחר.',
  },
  toast: {
    finishDuel: '⚔️ סיימו קודם את הדו־קרב — זירה אחת, קרב אחד.',
    finishDaily: '🎲 סיימו קודם את האתגר היומי — זירה אחת, קרב אחד.',
    dailyUsed: (score: number, waves: number) => `🎲 האתגר של היום כבר נוצל — ${score}/${waves}. מחר יש אתגר חדש!`,
    dailyNoEnergy: (cost: number) => `⚡ צריך ${cost} אנרגיה כדי להיכנס לאתגר היומי. לכו להתאמן!`,
    dailyStart: (waves: number) => `🎲 אתגר יומי — ${waves} גלים, ריצה אחת. בהצלחה!`,
    dailyDuplicate: '🎲 האתגר של היום כבר נרשם — אין תשלום כפול.',
    dailyResult: (score: number, waves: number, coins: number, complete: boolean) =>
      `🎲 אתגר יומי: ${score}/${waves} · +${coins} 🪙${complete ? ' · גאונטלט מלא! 🏅' : ''}`,
    alreadyDueled: (name: string, won: boolean) =>
      `⚔️ כבר נלחמתם היום מול ${name} — ${won ? 'ניצחתם' : 'הפסדתם'}. מחר אפשר שוב!`,
    duelNoEnergy: (cost: number) => `⚡ צריך ${cost} אנרגיה לדו־קרב. לכו להתאמן!`,
    duelStart: (name: string) => `⚔️ דו־קרב מול ${name} — בהצלחה!`,
    duelDuplicate: '⚔️ הדו־קרב הזה כבר נרשם היום — אין תשלום כפול.',
    duelWon: (name: string, coins: number) => `⚔️ ניצחון על ${name}! ‏+${coins} 🪙`,
    duelLost: (name: string, coins: number) => `💀 ${name} ניצח הפעם · ‏+${coins} 🪙. מחר יש הזדמנות חדשה.`,
    bossSpawn: (name: string) => `🏛 בוס העולם ${name} הופיע!`,
    endgame: '👑 זאוס הובס! נפתח מצב אלוף — הגלים ממשיכים בלי סוף.',
    bossDown: (next: number) => `🏛 בוס העולם הובס! עולם ${next} נפתח.`,
    skillLocked: (name: string, part: string, need: number, have: number, desc: string) =>
      `🔒 ${name} — נפתחת ב${part} רמה ${need} (כרגע ${have}). ${desc}`,
    skillCooldown: (name: string, secs: number) => `⏳ ${name} עוד ${secs} שניות.`,
    skillNoEnemy: (icon: string, name: string) => `${icon} ${name} — אין אויב על המסך כרגע.`,
    bossNoEnergy: (cost: number, have: string) => `⚡ צריך ${cost} אנרגיה לקרב הבוס — יש לכם ${have}. לכו להתאמן!`,
    earlyFight: (pct: number) => `⚔️ קרב מוקדם! הבוס מחוזק ב־${pct}% — כל רמה שתעלו תחליש אותו.`,
  },
};

const en: typeof he = {
  world: {
    of: (id: number, count: number) => `World ${id}/${count}`,
    championTagline: 'Champion mode — the waves never end',
    waveLabel: 'Wave',
  },
  arena: {
    heroLabel: 'Your hero in battle',
    attack: 'Attack the enemy',
    bossFight: '🏛 Boss fight',
    energy: '⚡ Energy',
    energyFoot: (perWave: number) => `${perWave} ⚡ per wave · energy comes only from real training`,
    super: '💥 Super move',
    superFoot: 'Every tap on the enemy charges the meter',
    superBtn: '💥 Unleash super move',
    coins: 'Coins',
    waves: 'Waves won',
    minis: 'Mini-bosses',
    bosses: 'World bosses',
    coinsNote: 'Spend coins on gear in the 🦸 Hero tab — gear adds to your stats and shows on your hero, here in the arena too.',
    powerTitle: 'Combat power',
    powerSub: 'Derived from your body levels',
    regen: (r: number) => `${r}/s`,
    offlineNote: 'The battle runs only while the Battle tab is open — no offline earnings.',
    miss: 'Miss!',
    you: 'You',
    overtimeWave: (n: number) => `OT ${n}`,
  },
  partLevel: (part: string, level: number) => `${part} Lv ${level}`,
  skills: {
    ready: 'Ready',
    label: (name: string, summary: string) => `${name} — ${summary}`,
    lockedLabel: (name: string, hint: string) => `${name} — locked. ${hint}`,
    group: 'Body skills',
    foot: (need: number) => `Each body part unlocks a skill at level ${need} — and it grows stronger with every level after.`,
  },
  daily: {
    foeTitle: (wave: number, name: string) => `Wave ${wave} · ${name}`,
    best: (score: number, total: number) => `Best ${score}/${total}`,
    completed: (n: number) => `${n} full ${n === 1 ? 'clear' : 'clears'}`,
    streak: (n: number) => `🔥 ${n}-day streak`,
    liveCount: (at: number, total: number) => `Wave ${at}/${total}`,
    liveNote: "One run, no revives. Leaving the arena now forfeits today's run.",
    full: '🏅 Full gauntlet',
    doneToday: 'Done for today',
    doneNote: 'A new challenge tomorrow — the same gauntlet for everyone, built from the date itself.',
    lockedBtn: (fee: number) => `🔒 Not enough energy · ${fee} ⚡`,
    lockedNote: (have: string, fee: number, perSet: number) =>
      `You have ${have} ⚡ of ${fee}. Go train — every logged set is worth ${perSet} ⚡.`,
    go: (fee: number) => `⚔️ Start the challenge · ${fee} ⚡`,
    goNote: (total: number) => `${total} waves from every world, one run a day, no revives. Score = waves cleared.`,
    label: 'Daily challenge',
    chip: '🎲 Daily challenge',
  },
  strip: {
    wave: (n: number) => `Wave ${n}`,
    bossFight: 'Boss fight',
    waveOf: (n: number, of: number) => `Wave ${n}/${of}`,
    done: 'Cleared',
    locked: 'Locked',
    bossEarly: ' · boss open for an early fight',
    bossOpen: ' · boss open',
    label: 'World progress',
    toastDone: (world: string) => `🏆 ${world} — cleared.`,
    toastLocked: (world: string, prev: string) => `🔒 ${world} is still locked — defeat the boss of ${prev} first.`,
    toastChampion: (world: string) => `👑 Champion mode — the waves in ${world} never end.`,
    toastGated: (missing: string, pct: number) =>
      `⚔️ Recommended levels missing: ${missing} — you can fight now, the boss is ${pct}% stronger.`,
    toastOpen: (world: string, wave: number) => `✓ ${world}: the boss is open — reach wave ${wave}.`,
  },
  gate: {
    championTitle: (boss: string) => `👑 ${boss} defeated`,
    championSub: 'Champion mode',
    championNote: `This world is yours. The waves keep coming and growing without limit — every extra wave is a new personal best,
          and your trophy waits in the 🦸 Hero tab.`,
    now: (have: number) => `(now ${have})`,
    title: (boss: string) => `World boss: ${boss}`,
    wavesLeft: (n: number) => `${n} ${n === 1 ? 'wave' : 'waves'} to go`,
    waiting: 'Waiting for you',
    lockedNote: (missing: string, wave: number, hpPct: number, atkPct: number) =>
      `Recommended levels still missing: <b>${missing}</b>. You can fight now — “⚔️ Early boss fight” at wave ${wave}: the boss gets <b>+${hpPct}%</b> HP and +${atkPct}% damage, and every level you gain in these parts weakens it. Meanwhile the arena keeps sparring — no coins, no progress.`,
    openNote: (wave: number, cost: { energy: number; coins: number } | null) =>
      `All requirements met! The “🏛 Boss fight” button waits for you in the arena at wave ${wave}${
        cost ? ` · costs ${cost.energy} ⚡ · pays ${cost.coins} 🪙` : ''
      }.`,
  },
  coach: {
    noPace: "No pace to measure yet — after a few workouts we'll tell you how far you are.",
    eta: (over: number, left: number) =>
      `At your pace (${over} ${over === 1 ? 'workout' : 'workouts'} in the last 4 weeks) you'll reach the recommended levels in <b>~${left}</b> workouts.`,
    left: (n: number) => ` · ~${n} more workouts`,
    add: (list: string) => `Add: ${list}`,
    sets: (n: number, left: string) => `${n} sets a week in your plan${left}`,
    editPlan: '✏️ Open the plan editor',
  },
  status: {
    duelWon: (name: string, coins: number) => `🏆 You beat ${name}! Duel recorded · +${coins} 🪙`,
    duelLost: (name: string, coins: number) => `💀 ${name} won this time — another chance tomorrow · +${coins} 🪙`,
    duelLive: (name: string) => `⚔️ Duel vs ${name} — they fight with their real stats. Tap and unleash skills!`,
    dailyFull: (cleared: number, total: number) => `🏅 Full gauntlet! ${cleared}/${total} · back to the arena…`,
    dailyOver: (cleared: number, total: number) => `🎲 Daily challenge over — ${cleared}/${total} waves. New one tomorrow!`,
    dailyLive: (at: number, total: number) =>
      `🎲 Daily challenge — wave ${at}/${total}. One run, no revives: tap and unleash skills.`,
    resting: (perSet: number, perWorkout: number) =>
      `😴 Out of energy — your hero is resting. Go train! Every logged set is worth ${perSet} ⚡, finishing a workout another ${perWorkout} ⚡.`,
    recovering: (wave: number) => `💀 Knocked out on wave ${wave} — your hero gets up and tries again.`,
    boss: (name: string) => `🏛 Boss fight! ${name} — tap nonstop and unleash every super move.`,
    overtimeOpen: (k: number, perWave: number, bossFee: number) =>
      `⏱ Overtime wave ${k} — the boss waits for your call. Pays half coins, costs ${perWave} ⚡; the boss fee (${bossFee} ⚡) is reserved.`,
    overtimeGated: (k: number, missing: string, perWave: number) =>
      `⏱ Overtime wave ${k} — coins for gear while you train to the recommended levels (missing: ${missing}), or fight early. Costs ${perWave} ⚡; the boss fee is reserved.`,
    sparringGated: (pct: number, missing: string) =>
      `🥊 Sparring — no coins, no progress. The boss is open for an early fight (+${pct}% stronger); recommended levels missing: ${missing}.`,
    sparringOpen: '🥊 Sparring — no coins, no progress. The boss is ready: tap “🏛 Boss fight” whenever you are.',
    tooStrong: '⚠️ This enemy is too strong. Go train to level up — your stats make the difference.',
    tap: 'Tap the enemy to attack and charge your super meter.',
    training: 'training',
  },
  bossBtn: {
    early: (boss: string | null, pct: number, cost: number | null) =>
      `⚔️ Early boss fight${boss ? `: ${boss}` : ''} · +${pct}% stronger${cost !== null ? ` · ${cost} ⚡` : ''}`,
    ready: (boss: string | null, cost: number | null) =>
      `🏛 Boss fight${boss ? `: ${boss}` : ''}${cost !== null ? ` · ${cost} ⚡` : ''}`,
  },
  handleError: {
    empty: "Type your opponent's fighter name.",
    too_short: 'A fighter name has at least 3 characters.',
    too_long: 'A fighter name has at most 20 characters.',
    bad_chars: 'A fighter name can use Hebrew or English letters, digits and _ . -',
    self: "That's you — search for someone else's name.",
  },
  toast: {
    finishDuel: '⚔️ Finish the duel first — one arena, one fight.',
    finishDaily: '🎲 Finish the daily challenge first — one arena, one fight.',
    dailyUsed: (score: number, waves: number) => `🎲 Today's challenge is used up — ${score}/${waves}. New one tomorrow!`,
    dailyNoEnergy: (cost: number) => `⚡ You need ${cost} energy for the daily challenge. Go train!`,
    dailyStart: (waves: number) => `🎲 Daily challenge — ${waves} waves, one run. Good luck!`,
    dailyDuplicate: "🎲 Today's challenge is already recorded — no double pay.",
    dailyResult: (score: number, waves: number, coins: number, complete: boolean) =>
      `🎲 Daily challenge: ${score}/${waves} · +${coins} 🪙${complete ? ' · Full gauntlet! 🏅' : ''}`,
    alreadyDueled: (name: string, won: boolean) =>
      `⚔️ You already fought ${name} today — ${won ? 'you won' : 'you lost'}. Again tomorrow!`,
    duelNoEnergy: (cost: number) => `⚡ You need ${cost} energy for a duel. Go train!`,
    duelStart: (name: string) => `⚔️ Duel vs ${name} — good luck!`,
    duelDuplicate: '⚔️ This duel is already recorded today — no double pay.',
    duelWon: (name: string, coins: number) => `⚔️ Victory over ${name}! +${coins} 🪙`,
    duelLost: (name: string, coins: number) => `💀 ${name} won this time · +${coins} 🪙. Another chance tomorrow.`,
    bossSpawn: (name: string) => `🏛 World boss ${name} appears!`,
    endgame: '👑 Zeus has fallen! Champion mode unlocked — the waves never end.',
    bossDown: (next: number) => `🏛 World boss defeated! World ${next} unlocked.`,
    skillLocked: (name: string, part: string, need: number, have: number, desc: string) =>
      `🔒 ${name} — unlocks at ${part} Lv ${need} (now ${have}). ${desc}`,
    skillCooldown: (name: string, secs: number) => `⏳ ${name}: ${secs}s left.`,
    skillNoEnemy: (icon: string, name: string) => `${icon} ${name} — no enemy on screen right now.`,
    bossNoEnergy: (cost: number, have: string) => `⚡ The boss fight needs ${cost} energy — you have ${have}. Go train!`,
    earlyFight: (pct: number) => `⚔️ Early fight! The boss is ${pct}% stronger — every level you gain weakens it.`,
  },
};

export const battle: Catalog<typeof he> = { he, en };
