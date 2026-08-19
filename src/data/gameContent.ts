/**
 * data/gameContent.ts — worlds, enemies, mini-bosses, world bosses, equipment.
 *
 * Content only: no balance numbers live here. An enemy's HP/ATK come from the
 * wave scaling in `BALANCE.combat` (see `core/combat.ts`); a definition only
 * carries identity, Hebrew copy, an inline SVG sprite and optional per-enemy
 * flavour multipliers.
 *
 * OFFLINE RULE: sprites are inline SVG strings — no files, no fetches, ever.
 *
 * PHASE 3 lives here too:
 *   - `WORLD_BOSSES` — one boss per world with its body-part `requires` gate;
 *     `bossGateStatus()` reports met/unmet per part so the gate card can render
 *     exactly what training is missing.
 *   - `EQUIPMENT` — the coin shop's roster. An item carries its Hebrew name,
 *     price, stat bonus, a shop icon and the two colours the character SVG uses
 *     to draw it (the drawing itself lives in `ui/characterSvg.ts`, because it
 *     depends on the character's level-driven geometry).
 */

import type { BodyPart } from './program.ts';

/* ------------------------------------------------------------------ worlds */

export interface WorldDef {
  readonly id: number;
  readonly he: string;
  readonly en: string;
  /** One-line Hebrew flavour, shown under the world name in the arena. */
  readonly tagline: string;
  /** One emoji — the world's node on the arena's progress strip. */
  readonly icon: string;
  /** Accent colour of the arena backdrop — extends, never replaces, the palette. */
  readonly accent: string;
  /** Two stops for the arena's radial background. */
  readonly bg: readonly [string, string];
  /**
   * How many ordinary waves this world holds. The world BOSS stands on
   * `waves + 1`, so this is also the gate's wave number minus one.
   *
   * PER-WORLD ON PURPOSE. The counts grow — and the growth DECELERATES — so the
   * journey lengthens without the late game ballooning:
   *
   *   50 · 60 · 70 · 80 · 85 · 90 · 95 · 100 · 110   (740 waves ≈ 34 workouts of ⚡)
   *
   * The difficulty curve is stretched to fit (see the PHASE 9 note in
   * `core/balance.ts`), so a longer world is longer, never harder at the end.
   *
   * REPLAY. Nothing in the log is re-derived from this number: `wave_cleared`
   * and `boss_defeated` carry `world`/`wave`/`nextWorld`/`nextWave` as data and
   * the reducer folds the payload, so changing a count moves the road AHEAD of
   * the player and never a single fact behind them.
   */
  readonly waves: number;
}

/** The nine worlds: the four launch ones, then the five-world late campaign. */
export const WORLDS: readonly WorldDef[] = [
  {
    id: 1,
    he: 'חדר כושר נטוש',
    en: 'Abandoned Gym',
    tagline: 'ברזל חלוד, אבק ומכונות ששכחו מזמן',
    icon: '🏚',
    accent: '#3B82F6',
    bg: ['#24304A', '#151E2E'],
    waves: 50,
  },
  {
    id: 2,
    he: 'הרחוב',
    en: 'The Street',
    tagline: 'אספלט, ניאון וכלבים שלא אוהבים זרים',
    icon: '🌆',
    accent: '#10B981',
    bg: ['#1E3A34', '#141E22'],
    waves: 60,
  },
  {
    id: 3,
    he: 'הזירה',
    en: 'The Arena',
    tagline: 'חול, קהל צמא דם והרבה מאוד רעש',
    icon: '🏟',
    accent: '#F59E0B',
    bg: ['#3A2C1B', '#1F1810'],
    waves: 70,
  },
  {
    id: 4,
    he: 'הר האולימפוס',
    en: 'Mount Olympus',
    tagline: 'מעל העננים נלחמים רק אלה שהתאמנו באמת',
    icon: '⛰',
    accent: '#A78BFA',
    bg: ['#312A55', '#191428'],
    waves: 80,
  },
  {
    id: 5,
    he: 'מעמקי הים',
    en: 'Ocean Depths',
    tagline: 'לחץ, חושך ושריון שנבנה על ידי מיליון שנות אבולוציה',
    icon: '🌊',
    accent: '#22D3EE',
    bg: ['#0E3A4A', '#0A1A24'],
    waves: 85,
  },
  {
    id: 6,
    he: 'ממלכת הקרח',
    en: 'Frozen Realm',
    tagline: 'הקור מאט את הידיים — רק כתפיים מאומנות שוברות אותו',
    icon: '❄️',
    accent: '#93C5FD',
    bg: ['#20344F', '#101A28'],
    waves: 90,
  },
  {
    id: 7,
    he: 'ממלכת הצללים',
    en: 'Shadow Realm',
    tagline: 'מה שאין לו גוף גם קשה לפגוע בו — כוונו למכה מדויקת',
    icon: '🌑',
    accent: '#C084FC',
    bg: ['#2A2140', '#140F1E'],
    waves: 95,
  },
  {
    id: 8,
    he: 'גן עדן',
    en: 'Heaven',
    tagline: 'מעל הכול, ומרפא את עצמו מהר משתספיקו להתלונן',
    icon: '☁️',
    accent: '#FDE68A',
    bg: ['#3E3A26', '#1C1A12'],
    waves: 100,
  },
  {
    id: 9,
    he: 'גיהינום',
    en: 'Hell',
    tagline: 'הסוף. כאן כל מכה יכולה להיות קריטית — שלהם',
    icon: '🔥',
    accent: '#F87171',
    bg: ['#4A1B18', '#200C0B'],
    waves: 110,
  },
] as const;

export function worldById(id: number): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? (WORLDS[0] as WorldDef);
}

/** Total number of worlds — Phase 3 grows this list, nothing else changes. */
export const WORLD_COUNT = WORLDS.length;

/**
 * How many ordinary waves a world holds — the ONE place the answer comes from.
 *
 * An unknown world (champion mode never leaves the roster, but a hand-edited
 * blob can say anything) falls back to the LAST world's count, which is the
 * longest: it can only ever be conservative about where a boss stands.
 */
export function wavesInWorld(world: number): number {
  return WORLDS.find((w) => w.id === world)?.waves ?? (WORLDS[WORLDS.length - 1] as WorldDef).waves;
}

/** The wave the world's boss stands on — one past its last ordinary wave. */
export function bossWaveOf(world: number): number {
  return wavesInWorld(world) + 1;
}

/* ----------------------------------------------------------------- sprites */

/** Wrap sprite markup in a square SVG element. Keeps every sprite consistent. */
function sprite(inner: string): string {
  return `<svg class="en-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${inner}</svg>`;
}

/** Two eyes at (x1|x2, y) — every enemy has them, it makes them read as alive. */
function eyes(x1: number, x2: number, y: number, r = 4, fill = '#0B0F19'): string {
  return `<circle cx="${x1}" cy="${y}" r="${r}" fill="${fill}"/><circle cx="${x2}" cy="${y}" r="${r}" fill="${fill}"/>`;
}

/* ----------------------------------------------------------------- enemies */

export type EnemyKind = 'regular' | 'mini' | 'boss';

export interface EnemyDef {
  readonly id: string;
  readonly he: string;
  readonly en: string;
  readonly world: number;
  readonly kind: EnemyKind;
  /** Flavour multipliers on top of the wave scaling (default 1). */
  readonly hpMult?: number;
  readonly atkMult?: number;
  /**
   * PER-WORLD COMBAT MECHANICS — all optional, all off by default.
   *
   * Each one is a rule `core/combat.ts` already knows (the ghost-duel work gave
   * the engine `def` / `critChance` / `critMultiplier` / `regen`; the frozen and
   * shadow worlds added the two below). An enemy OPTS IN by naming the field;
   * every rule is skipped when the field is absent or zero, and — critically —
   * the two that need a random draw (`dodgeChance`, `critChance`) draw INSIDE
   * that guard. An enemy without them therefore takes no number out of the
   * seeded stream, which is what makes every wave of worlds 1–4 byte-identical
   * to what it was before these fields existed (pinned in `tests/enemies.test.ts`).
   *
   * The ceilings live in `BALANCE.combat.enemy.flavour`.
   */
  /** מעמקי הים — flat DEF; incoming damage is cut by `defK/(defK+def)`. */
  readonly def?: number;
  /** ממלכת הקרח — multiplies the PLAYER's attack interval while this enemy lives. */
  readonly attackSlowMult?: number;
  /** ממלכת הצללים — chance a NON-critical blow misses entirely. */
  readonly dodgeChance?: number;
  /** גן עדן — fraction of its own MAX HP the enemy heals per second. */
  readonly regenPct?: number;
  /** גיהינום — the enemy's own crit chance / multiplier. */
  readonly critChance?: number;
  readonly critMultiplier?: number;
  /** Inline SVG markup for the sprite (no external files — offline rule). */
  readonly svg: string;
}

export interface BossDef extends EnemyDef {
  readonly kind: 'boss';
  /** Body-part levels required to challenge this boss. */
  readonly requires: Partial<Record<BodyPart, number>>;
}

/**
 * FLAVOUR ARCHETYPES — the only two knobs a regular enemy has.
 *
 * `hpMult`/`atkMult` sit ON TOP of the wave scaling in `BALANCE.combat.enemy`,
 * which stays authoritative: the curve decides how hard wave N is, an enemy only
 * decides what KIND of hard. Three archetypes repeat in every world so the
 * vocabulary is learnable — a player who met the nimble one in the gym knows
 * what the alley cat will do:
 *
 *   זריז   (nimble)  — low HP, high ATK: dies fast, but stings while it lives.
 *   עמיד   (tank)    — high HP, low ATK: a wall you have to chew through.
 *   מוחץ   (bruiser) — a bit of both, the middle of the road.
 *
 * BALANCE INVARIANT (asserted in `tests/enemies.test.ts`): each world's six
 * regulars average ≈1.0 on both multipliers, so the flavours cancel out over a
 * cycle of six waves and the tuned wave curve — not the roster — sets the pace.
 */
/* --- world 1 — חדר כושר נטוש ------------------------------------------- */

const W1: readonly EnemyDef[] = [
  {
    id: 'w1_dumbbell',
    he: 'משקולת חלודה',
    en: 'Rusty Dumbbell',
    world: 1,
    kind: 'regular',
    svg: sprite(`
      <rect x="26" y="52" width="68" height="16" rx="8" fill="#7A6A55"/>
      <rect x="14" y="36" width="20" height="48" rx="7" fill="#948068"/>
      <rect x="86" y="36" width="20" height="48" rx="7" fill="#948068"/>
      <rect x="4" y="44" width="12" height="32" rx="5" fill="#6E5C48"/>
      <rect x="104" y="44" width="12" height="32" rx="5" fill="#6E5C48"/>
      ${eyes(48, 72, 58, 4.5, '#1B2438')}
      <path d="M46 70 Q60 78 74 70" stroke="#1B2438" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w1_rat',
    he: 'חולדת מחסן',
    en: 'Storage Rat',
    world: 1,
    kind: 'regular',
    hpMult: 0.85,
    atkMult: 1.1,
    svg: sprite(`
      <path d="M18 84 Q4 80 10 66" stroke="#8A93A8" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="58" cy="74" rx="36" ry="22" fill="#6C7689"/>
      <circle cx="88" cy="58" r="20" fill="#7C8699"/>
      <circle cx="80" cy="38" r="9" fill="#5B6478"/>
      <circle cx="98" cy="40" r="8" fill="#5B6478"/>
      ${eyes(88, 100, 55, 3.5, '#F87171')}
      <path d="M106 62 h10" stroke="#D8DEE9" stroke-width="3" stroke-linecap="round"/>`),
  },
  {
    id: 'w1_towel',
    he: 'מגבת רפאים',
    en: 'Ghost Towel',
    world: 1,
    kind: 'regular',
    hpMult: 1.1,
    svg: sprite(`
      <path d="M28 96 V52 a32 32 0 0 1 64 0 V96 l-11-10 -11 10 -11-10 -11 10 -10-10 Z" fill="#D6DEEA" opacity=".9"/>
      ${eyes(48, 74, 56, 5, '#2C3A55')}
      <ellipse cx="61" cy="72" rx="7" ry="5" fill="#2C3A55" opacity=".8"/>`),
  },
  {
    id: 'w1_treadmill',
    he: 'הליכון משתולל',
    en: 'Runaway Treadmill',
    world: 1,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M8 100 h80 l14 -20 h-80 Z" fill="#4E5C78" stroke="#22304C" stroke-width="3"/>
      <path d="M20 96 h62 l9 -13 h-62 Z" fill="#232D42"/>
      <path d="M26 90 h50 M32 84 h46" stroke="#8FA1C4" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="88" y="40" width="9" height="42" rx="4" fill="#5C6C8C"/>
      <rect x="64" y="12" width="48" height="30" rx="9" fill="#3B4E76" stroke="#22304C" stroke-width="3"/>
      ${eyes(78, 98, 25, 4.5, '#67E8F9')}
      <path d="M76 34 h24" stroke="#0B0F19" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="18" cy="106" r="7" fill="#8B96AB"/><circle cx="94" cy="106" r="7" fill="#8B96AB"/>`),
  },
  {
    id: 'w1_sandbag',
    he: 'שק חול קרוע',
    en: 'Torn Sandbag',
    world: 1,
    kind: 'regular',
    /* tank */ hpMult: 1.35,
    atkMult: 0.75,
    svg: sprite(`
      <path d="M60 4 v14" stroke="#8B96AB" stroke-width="4" stroke-linecap="round"/>
      <rect x="46" y="16" width="28" height="10" rx="4" fill="#6B7689"/>
      <rect x="34" y="26" width="52" height="80" rx="20" fill="#7C4A2A" stroke="#4A2A16" stroke-width="3"/>
      <path d="M34 46 h52 M34 86 h52" stroke="#4A2A16" stroke-width="3"/>
      ${eyes(50, 70, 62, 5, '#FDE68A')}
      <path d="M50 78 q10 8 20 0" stroke="#FDE68A" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M86 58 l14 8 -12 4 10 8" stroke="#D6BFA0" stroke-width="3.5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>`),
  },
  {
    id: 'w1_kettlebell',
    he: 'קטלבל נוקם',
    en: 'Vengeful Kettlebell',
    world: 1,
    kind: 'regular',
    /* bruiser */ hpMult: 1.1,
    atkMult: 1.05,
    svg: sprite(`
      <path d="M40 46 a20 20 0 0 1 40 0" stroke="#8B96AB" stroke-width="12" fill="none" stroke-linecap="round"/>
      <circle cx="60" cy="76" r="32" fill="#2F3A52" stroke="#1B2438" stroke-width="3"/>
      <path d="M32 60 h56" stroke="#4E5C78" stroke-width="7" stroke-linecap="round"/>
      ${eyes(50, 70, 74, 5, '#F87171')}
      <path d="M48 92 q12 -9 24 0" stroke="#F87171" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
];

const W1_MINI: EnemyDef = {
  id: 'w1_smith',
  he: "מכונת סמית' זועמת",
  en: 'Furious Smith Machine',
  world: 1,
  kind: 'mini',
  svg: sprite(`
    <rect x="16" y="14" width="12" height="92" rx="5" fill="#4E5C78"/>
    <rect x="92" y="14" width="12" height="92" rx="5" fill="#4E5C78"/>
    <rect x="16" y="40" width="88" height="14" rx="7" fill="#8FA1C4"/>
    <rect x="30" y="62" width="60" height="34" rx="10" fill="#3B4E76" stroke="#22304C" stroke-width="3"/>
    ${eyes(48, 72, 78, 5.5, '#F59E0B')}
    <path d="M44 92 h32" stroke="#0B0F19" stroke-width="4" stroke-linecap="round"/>
    <path d="M36 30 l10 10 M84 30 l-10 10" stroke="#F59E0B" stroke-width="4" stroke-linecap="round"/>`),
};

/* --- world 2 — הרחוב ---------------------------------------------------- */

const W2: readonly EnemyDef[] = [
  {
    id: 'w2_dog',
    he: 'כלב רחוב',
    en: 'Street Dog',
    world: 2,
    kind: 'regular',
    atkMult: 1.15,
    svg: sprite(`
      <ellipse cx="54" cy="76" rx="38" ry="20" fill="#8A6A4A"/>
      <rect x="30" y="88" width="9" height="18" rx="4" fill="#75593E"/>
      <rect x="68" y="88" width="9" height="18" rx="4" fill="#75593E"/>
      <circle cx="90" cy="52" r="20" fill="#9C7A56"/>
      <path d="M76 36 l-6 -16 14 8 Z" fill="#75593E"/>
      <path d="M104 36 l6 -16 -14 8 Z" fill="#75593E"/>
      ${eyes(84, 100, 50, 3.5, '#1B2438')}
      <path d="M104 62 q8 2 6 8" stroke="#1B2438" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M18 70 q-10 -10 -2 -20" stroke="#75593E" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w2_bin',
    he: 'פח מתגלגל',
    en: 'Rolling Bin',
    world: 2,
    kind: 'regular',
    hpMult: 1.2,
    atkMult: 0.9,
    svg: sprite(`
      <rect x="26" y="34" width="68" height="12" rx="6" fill="#4B6455"/>
      <path d="M30 46 h60 l-6 56 h-48 Z" fill="#3E5648" stroke="#2A3B31" stroke-width="3"/>
      ${eyes(48, 72, 66, 5, '#A7F3D0')}
      <path d="M46 84 q14 10 28 0" stroke="#A7F3D0" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M52 26 h16 v8 h-16 Z" fill="#4B6455"/>`),
  },
  {
    id: 'w2_racer',
    he: 'רוכב סקייטבורד',
    en: 'Skate Punk',
    world: 2,
    kind: 'regular',
    svg: sprite(`
      <rect x="24" y="98" width="72" height="8" rx="4" fill="#2C3A55"/>
      <circle cx="38" cy="110" r="6" fill="#8B96AB"/><circle cx="82" cy="110" r="6" fill="#8B96AB"/>
      <rect x="46" y="52" width="28" height="46" rx="12" fill="#2563EB"/>
      <circle cx="60" cy="36" r="18" fill="#C79B75"/>
      <path d="M42 32 a18 18 0 0 1 36 0 Z" fill="#EF4444"/>
      ${eyes(53, 68, 38, 3, '#1B2438')}
      <path d="M74 62 l22 -10" stroke="#C79B75" stroke-width="8" stroke-linecap="round"/>`),
  },
  {
    id: 'w2_cat',
    he: 'חתול סמטאות',
    en: 'Alley Cat',
    world: 2,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M22 86 q-14 -6 -10 -22" stroke="#4B5563" stroke-width="6" fill="none" stroke-linecap="round"/>
      <ellipse cx="56" cy="80" rx="32" ry="18" fill="#4B5563"/>
      <rect x="36" y="92" width="8" height="16" rx="4" fill="#374151"/>
      <rect x="68" y="92" width="8" height="16" rx="4" fill="#374151"/>
      <circle cx="86" cy="54" r="19" fill="#586274"/>
      <path d="M72 40 l-2 -18 15 9 Z" fill="#374151"/>
      <path d="M100 40 l3 -18 -15 9 Z" fill="#374151"/>
      ${eyes(80, 96, 52, 3.6, '#A7F3D0')}
      <path d="M82 62 q6 6 12 0" stroke="#111827" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M102 58 h14 M102 66 h13" stroke="#E2E8F0" stroke-width="2.4" stroke-linecap="round"/>`),
  },
  {
    id: 'w2_hydrant',
    he: 'הידרנט מתפוצץ',
    en: 'Bursting Hydrant',
    world: 2,
    kind: 'regular',
    /* tank */ hpMult: 1.25,
    atkMult: 0.8,
    svg: sprite(`
      <rect x="54" y="12" width="12" height="14" rx="5" fill="#7F1D1D"/>
      <path d="M42 34 a18 18 0 0 1 36 0 Z" fill="#DC2626" stroke="#7F1D1D" stroke-width="3"/>
      <path d="M40 34 h40 v56 a10 10 0 0 1 -10 10 h-20 a10 10 0 0 1 -10 -10 Z"
        fill="#B91C1C" stroke="#7F1D1D" stroke-width="3"/>
      <rect x="30" y="100" width="60" height="11" rx="5" fill="#7F1D1D"/>
      <rect x="18" y="52" width="18" height="15" rx="6" fill="#7F1D1D"/>
      <rect x="84" y="52" width="18" height="15" rx="6" fill="#7F1D1D"/>
      ${eyes(50, 70, 56, 4.5, '#FDE68A')}
      <path d="M50 74 h20" stroke="#FDE68A" stroke-width="3" stroke-linecap="round"/>
      <path d="M104 44 q10 -10 8 -24 M110 60 q10 -6 8 -16" stroke="#93C5FD" stroke-width="4"
        fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w2_bouncer',
    he: 'סדרן מועדון',
    en: 'Club Bouncer',
    world: 2,
    kind: 'regular',
    /* bruiser */ hpMult: 1.0,
    atkMult: 1.05,
    svg: sprite(`
      <circle cx="60" cy="30" r="17" fill="#8A6244"/>
      <path d="M43 26 a17 17 0 0 1 34 0 Z" fill="#1B2438"/>
      <rect x="45" y="25" width="30" height="9" rx="4" fill="#0B0F19"/>
      ${eyes(53, 67, 29.5, 2.6, '#10B981')}
      <path d="M52 42 q8 5 16 0" stroke="#4A2A16" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M30 56 h60 l6 50 h-72 Z" fill="#1F2937" stroke="#0B0F19" stroke-width="3"/>
      <path d="M60 58 v46" stroke="#374151" stroke-width="3"/>
      <rect x="24" y="70" width="72" height="13" rx="6" fill="#8A6244" stroke="#4A2A16" stroke-width="2"/>
      <rect x="34" y="96" width="52" height="8" rx="4" fill="#DC2626"/>`),
  },
];

const W2_MINI: EnemyDef = {
  id: 'w2_king',
  he: 'מלך הסמטה',
  en: 'Alley King',
  world: 2,
  kind: 'mini',
  svg: sprite(`
    <path d="M34 30 l8 -18 10 12 8 -18 8 18 10 -12 8 18 Z" fill="#F59E0B"/>
    <circle cx="60" cy="48" r="20" fill="#C79B75"/>
    ${eyes(52, 68, 46, 3.5, '#1B2438')}
    <path d="M50 58 q10 8 20 0" stroke="#1B2438" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M36 70 h48 l8 36 h-64 Z" fill="#166534" stroke="#0E4429" stroke-width="3"/>
    <path d="M28 76 l-14 22" stroke="#C79B75" stroke-width="10" stroke-linecap="round"/>
    <path d="M92 76 l14 22" stroke="#C79B75" stroke-width="10" stroke-linecap="round"/>`),
};

/* --- world 3 — הזירה ---------------------------------------------------- */

const W3: readonly EnemyDef[] = [
  {
    id: 'w3_rookie',
    he: 'גלדיאטור מתחיל',
    en: 'Rookie Gladiator',
    world: 3,
    kind: 'regular',
    svg: sprite(`
      <circle cx="60" cy="34" r="17" fill="#C79B75"/>
      <path d="M43 32 a17 17 0 0 1 34 0 Z" fill="#94A3B8"/>
      ${eyes(53, 67, 36, 3, '#1B2438')}
      <path d="M40 54 h40 l6 46 h-52 Z" fill="#B45309" stroke="#7C3D06" stroke-width="3"/>
      <rect x="84" y="46" width="10" height="52" rx="4" fill="#94A3B8"/>
      <path d="M26 56 l-10 26 20 6 Z" fill="#78350F"/>`),
  },
  {
    id: 'w3_lion',
    he: 'אריה הזירה',
    en: 'Arena Lion',
    world: 3,
    kind: 'regular',
    atkMult: 1.2,
    hpMult: 0.95,
    svg: sprite(`
      <ellipse cx="50" cy="80" rx="34" ry="19" fill="#D97706"/>
      <circle cx="82" cy="52" r="28" fill="#B45309"/>
      <circle cx="82" cy="52" r="18" fill="#F59E0B"/>
      ${eyes(75, 91, 48, 3.5, '#1B2438')}
      <path d="M74 60 q8 8 16 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M18 88 q-10 -6 -6 -16" stroke="#D97706" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w3_shield',
    he: 'לוחם מגן',
    en: 'Shield Warden',
    world: 3,
    kind: 'regular',
    hpMult: 1.35,
    atkMult: 0.85,
    svg: sprite(`
      <circle cx="60" cy="30" r="15" fill="#C79B75"/>
      ${eyes(54, 66, 30, 3, '#1B2438')}
      <path d="M42 48 h36 l6 52 h-48 Z" fill="#475569"/>
      <path d="M26 40 h34 v40 q0 14 -17 20 -17 -6 -17 -20 Z" fill="#64748B" stroke="#334155" stroke-width="3"/>
      <path d="M43 48 v40" stroke="#F59E0B" stroke-width="4"/>`),
  },
  {
    id: 'w3_retiarius',
    he: 'לוחם הרשת',
    en: 'Retiarius',
    world: 3,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M14 44 q20 16 12 44 q-18 -12 -12 -44 Z" fill="#67E8F9" opacity=".3"
        stroke="#67E8F9" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M18 54 q10 12 8 26 M26 48 q8 14 4 30" stroke="#67E8F9" stroke-width="2" fill="none"/>
      <circle cx="52" cy="32" r="16" fill="#C79B75"/>
      <path d="M36 30 a16 16 0 0 1 32 0 l-5 -7 h-22 Z" fill="#7C2D12"/>
      ${eyes(46, 58, 32, 3, '#1B2438')}
      <path d="M34 52 h36 l5 50 h-46 Z" fill="#0E7490" stroke="#155E75" stroke-width="3"/>
      <path d="M84 22 v82" stroke="#94A3B8" stroke-width="5" stroke-linecap="round"/>
      <path d="M74 26 v-14 M84 22 v-16 M94 26 v-14" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>`),
  },
  {
    id: 'w3_bull',
    he: 'שור הזירה',
    en: 'Arena Bull',
    world: 3,
    kind: 'regular',
    /* tank */ hpMult: 1.2,
    atkMult: 0.8,
    svg: sprite(`
      <path d="M16 74 q-10 -8 -4 -18" stroke="#4A2E22" stroke-width="6" fill="none" stroke-linecap="round"/>
      <ellipse cx="52" cy="82" rx="38" ry="22" fill="#4A2E22"/>
      <rect x="28" y="98" width="11" height="16" rx="5" fill="#3A231A"/>
      <rect x="64" y="98" width="11" height="16" rx="5" fill="#3A231A"/>
      <circle cx="88" cy="52" r="24" fill="#5C3A2A"/>
      <path d="M70 36 q-18 -12 -28 -2 q14 0 22 12 Z" fill="#E2E8F0"/>
      <path d="M106 36 q14 -14 4 -22 q-2 12 -14 16 Z" fill="#E2E8F0"/>
      ${eyes(80, 98, 48, 3.5, '#F87171')}
      <ellipse cx="92" cy="66" rx="14" ry="9" fill="#7C4A38"/>
      <circle cx="87" cy="66" r="2.6" fill="#1B2438"/><circle cx="97" cy="66" r="2.6" fill="#1B2438"/>`),
  },
  {
    id: 'w3_archer',
    he: 'קשתית הזירה',
    en: 'Arena Archer',
    world: 3,
    kind: 'regular',
    /* bruiser */ hpMult: 0.95,
    atkMult: 1.1,
    svg: sprite(`
      <path d="M86 20 a42 42 0 0 1 0 80" stroke="#A16207" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M86 20 V100" stroke="#E2E8F0" stroke-width="2"/>
      <circle cx="50" cy="30" r="15" fill="#C79B75"/>
      <path d="M35 28 a15 15 0 0 1 30 0 Z" fill="#4C1D95"/>
      ${eyes(44, 56, 30, 3, '#1B2438')}
      <path d="M34 48 h34 l6 54 h-46 Z" fill="#7C2D12" stroke="#4A1A08" stroke-width="3"/>
      <path d="M52 60 h40" stroke="#94A3B8" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M98 60 l-10 -6 v12 Z" fill="#E2E8F0"/>`),
  },
];

const W3_MINI: EnemyDef = {
  id: 'w3_champion',
  he: 'אלוף הזירה',
  en: 'Arena Champion',
  world: 3,
  kind: 'mini',
  svg: sprite(`
    <circle cx="58" cy="30" r="18" fill="#C79B75"/>
    <path d="M40 28 a18 18 0 0 1 36 0 Z" fill="#F59E0B"/>
    <path d="M58 8 v10" stroke="#EF4444" stroke-width="5" stroke-linecap="round"/>
    ${eyes(51, 65, 32, 3.5, '#1B2438')}
    <path d="M34 52 h48 l8 50 h-64 Z" fill="#7C2D12" stroke="#4A1A08" stroke-width="3"/>
    <path d="M88 44 l18 -18 6 6 -18 18 Z" fill="#E2E8F0"/>
    <path d="M84 48 l10 10" stroke="#94A3B8" stroke-width="7" stroke-linecap="round"/>`),
};

/* --- world 4 — הר האולימפוס -------------------------------------------- */

const W4: readonly EnemyDef[] = [
  {
    id: 'w4_harpy',
    he: 'הרפייה',
    en: 'Harpy',
    world: 4,
    kind: 'regular',
    atkMult: 1.25,
    hpMult: 0.9,
    svg: sprite(`
      <path d="M60 60 q-40 -22 -52 4 q26 10 52 6 Z" fill="#A78BFA"/>
      <path d="M60 60 q40 -22 52 4 q-26 10 -52 6 Z" fill="#A78BFA"/>
      <ellipse cx="60" cy="70" rx="18" ry="24" fill="#8B5CF6"/>
      <circle cx="60" cy="38" r="15" fill="#DDD6FE"/>
      ${eyes(54, 66, 36, 3, '#312E81')}
      <path d="M60 44 l6 6 -12 0 Z" fill="#F59E0B"/>`),
  },
  {
    id: 'w4_golem',
    he: 'גולם שיש',
    en: 'Marble Golem',
    world: 4,
    kind: 'regular',
    hpMult: 1.4,
    atkMult: 0.9,
    svg: sprite(`
      <rect x="34" y="44" width="52" height="56" rx="10" fill="#E2E8F0" stroke="#94A3B8" stroke-width="3"/>
      <rect x="44" y="18" width="32" height="26" rx="8" fill="#F1F5F9" stroke="#94A3B8" stroke-width="3"/>
      ${eyes(53, 67, 30, 3.5, '#64748B')}
      <rect x="14" y="50" width="18" height="40" rx="8" fill="#CBD5E1"/>
      <rect x="88" y="50" width="18" height="40" rx="8" fill="#CBD5E1"/>
      <path d="M46 68 h28 M46 82 h28" stroke="#94A3B8" stroke-width="3"/>`),
  },
  {
    id: 'w4_cyclops',
    he: 'קיקלופ',
    en: 'Cyclops',
    world: 4,
    kind: 'regular',
    hpMult: 1.15,
    atkMult: 1.1,
    svg: sprite(`
      <ellipse cx="60" cy="74" rx="34" ry="30" fill="#6D8B74"/>
      <circle cx="60" cy="38" r="24" fill="#7FA087"/>
      <circle cx="60" cy="36" r="11" fill="#FEF3C7"/>
      <circle cx="60" cy="36" r="5" fill="#1B2438"/>
      <path d="M48 56 q12 10 24 0" stroke="#2F4034" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="16" y="66" width="16" height="34" rx="8" fill="#5E7A65"/>
      <rect x="88" y="66" width="16" height="34" rx="8" fill="#5E7A65"/>`),
  },
  {
    id: 'w4_siren',
    he: 'סירנה',
    en: 'Siren',
    world: 4,
    kind: 'regular',
    /* nimble */ hpMult: 0.75,
    atkMult: 1.1,
    svg: sprite(`
      <ellipse cx="60" cy="110" rx="34" ry="8" fill="#0EA5E9" opacity=".3"/>
      <path d="M44 40 q16 -24 32 0 q8 26 -14 32 q-22 -6 -18 -32 Z" fill="#155E75"/>
      <circle cx="60" cy="40" r="16" fill="#F5D0B0"/>
      ${eyes(53, 67, 37, 3, '#0F172A')}
      <ellipse cx="60" cy="47" rx="4" ry="5.5" fill="#0F172A"/>
      <path d="M44 58 h32 l-4 30 h-24 Z" fill="#0E7490"/>
      <path d="M48 86 q12 16 24 0 q5 20 -12 26 -17 -6 -12 -26 Z" fill="#0891B2" stroke="#155E75" stroke-width="2"/>
      <path d="M38 112 q22 10 44 0 q-22 -14 -44 0 Z" fill="#22D3EE"/>
      <path d="M92 32 q10 10 0 20 M102 24 q18 18 0 36" stroke="#67E8F9" stroke-width="3"
        fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w4_hydra',
    he: 'הידרה',
    en: 'Hydra',
    world: 4,
    kind: 'regular',
    /* tank */ hpMult: 1.15,
    atkMult: 0.7,
    svg: sprite(`
      <ellipse cx="60" cy="98" rx="38" ry="18" fill="#166534"/>
      <path d="M40 94 q-14 -30 -18 -46" stroke="#15803D" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M60 92 v-52" stroke="#15803D" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M80 94 q14 -30 18 -46" stroke="#15803D" stroke-width="12" fill="none" stroke-linecap="round"/>
      <circle cx="22" cy="42" r="12" fill="#22C55E"/>
      <circle cx="60" cy="32" r="14" fill="#22C55E"/>
      <circle cx="98" cy="42" r="12" fill="#22C55E"/>
      ${eyes(18, 27, 40, 2.6, '#0B0F19')}
      ${eyes(55, 66, 30, 2.8, '#0B0F19')}
      ${eyes(93, 102, 40, 2.6, '#0B0F19')}
      <path d="M16 50 h12 M54 40 h13 M92 50 h12" stroke="#052E16" stroke-width="2.5" stroke-linecap="round"/>`),
  },
  {
    id: 'w4_minotaur',
    he: 'מינוטאורוס',
    en: 'Minotaur',
    world: 4,
    kind: 'regular',
    /* bruiser */ hpMult: 0.9,
    atkMult: 1.15,
    svg: sprite(`
      <path d="M28 110 q4 -38 20 -48 h24 q16 10 20 48 Z" fill="#7C2D12" stroke="#431407" stroke-width="3"/>
      <path d="M14 78 l-8 -12 M106 78 l8 -12" stroke="#5C3A2A" stroke-width="9" stroke-linecap="round"/>
      <circle cx="60" cy="40" r="21" fill="#5C3A2A"/>
      <path d="M40 32 q-18 -12 -28 0 q16 0 22 12 Z" fill="#E2E8F0"/>
      <path d="M80 32 q18 -12 28 0 q-16 0 -22 12 Z" fill="#E2E8F0"/>
      ${eyes(52, 68, 36, 3.6, '#F59E0B')}
      <ellipse cx="60" cy="52" rx="12" ry="8" fill="#7C4A38"/>
      <circle cx="55" cy="52" r="2.4" fill="#1B2438"/><circle cx="65" cy="52" r="2.4" fill="#1B2438"/>
      <path d="M46 80 h28" stroke="#B45309" stroke-width="5" stroke-linecap="round"/>`),
  },
];

const W4_MINI: EnemyDef = {
  id: 'w4_titan',
  he: 'טיטאן',
  en: 'Titan',
  world: 4,
  kind: 'mini',
  svg: sprite(`
    <path d="M28 104 V52 a32 32 0 0 1 64 0 v52 Z" fill="#4C1D95" stroke="#2E1065" stroke-width="3"/>
    <circle cx="60" cy="34" r="20" fill="#DDD6FE"/>
    ${eyes(52, 68, 32, 4, '#4C1D95')}
    <path d="M40 18 l6 -12 6 10 8 -14 8 14 6 -10 6 12 Z" fill="#F59E0B"/>
    <path d="M14 60 l14 -8 M106 60 l-14 -8" stroke="#A78BFA" stroke-width="6" stroke-linecap="round"/>
    <path d="M48 76 h24" stroke="#A78BFA" stroke-width="4" stroke-linecap="round"/>`),
};

/* --- world 5 — מעמקי הים ------------------------------------------------ */

/**
 * THE ARMOUR WORLD. Half this roster carries `def`, which sits on the same soft
 * cap the player's Back does (`mitigation`), so a shelled crab is not a bigger
 * hit-point bag — it is a wall that shrugs off small blows and folds to big
 * ones. That makes Chest (raw ATK) and the super move the answer here, and it is
 * why the armoured ones are given LOWER `hpMult`: armour is their hit points.
 */
const W5: readonly EnemyDef[] = [
  {
    id: 'w5_crab',
    he: 'סרטן שריון',
    en: 'Armored Crab',
    world: 5,
    kind: 'regular',
    /* tank */ hpMult: 1.25,
    atkMult: 0.8,
    def: 30,
    svg: sprite(`
      <path d="M10 84 l-8 14 M110 84 l8 14" stroke="#0E7490" stroke-width="6" stroke-linecap="round"/>
      <path d="M18 72 q42 -40 84 0 q-6 30 -42 30 q-36 0 -42 -30 Z" fill="#DC2626" stroke="#7F1D1D" stroke-width="3"/>
      <path d="M28 62 q32 -20 64 0" stroke="#7F1D1D" stroke-width="3" fill="none"/>
      <path d="M14 54 q-12 -14 2 -22 q10 12 20 6 q-8 12 -22 16 Z" fill="#EF4444" stroke="#7F1D1D" stroke-width="3"/>
      <path d="M106 54 q12 -14 -2 -22 q-10 12 -20 6 q8 12 22 16 Z" fill="#EF4444" stroke="#7F1D1D" stroke-width="3"/>
      <rect x="24" y="98" width="12" height="14" rx="5" fill="#B91C1C"/>
      <rect x="84" y="98" width="12" height="14" rx="5" fill="#B91C1C"/>
      ${eyes(46, 74, 60, 6, '#FDE68A')}
      <circle cx="46" cy="60" r="2.6" fill="#0B0F19"/><circle cx="74" cy="60" r="2.6" fill="#0B0F19"/>
      <path d="M48 80 q12 8 24 0" stroke="#7F1D1D" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w5_jelly',
    he: 'מדוזת ברקים',
    en: 'Lightning Jelly',
    world: 5,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M22 62 a38 34 0 0 1 76 0 q-38 16 -76 0 Z" fill="#A5F3FC" opacity=".92" stroke="#22D3EE" stroke-width="3"/>
      <path d="M30 66 q4 26 -6 42" stroke="#67E8F9" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M48 68 q2 30 -4 44" stroke="#67E8F9" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M72 68 q-2 30 4 44" stroke="#67E8F9" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M90 66 q-4 26 6 42" stroke="#67E8F9" stroke-width="5" fill="none" stroke-linecap="round"/>
      ${eyes(48, 72, 50, 5, '#155E75')}
      <path d="M52 62 q8 6 16 0" stroke="#155E75" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M60 12 l-10 18 h9 l-7 16 18 -20 h-9 Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/>`),
  },
  {
    id: 'w5_seasnake',
    he: 'נחש ים',
    en: 'Sea Serpent',
    world: 5,
    kind: 'regular',
    hpMult: 0.95,
    atkMult: 1.15,
    svg: sprite(`
      <path d="M6 104 q22 -18 34 -2 q12 16 30 -2 q16 -16 30 -2" stroke="#047857" stroke-width="13"
        fill="none" stroke-linecap="round"/>
      <path d="M6 104 q22 -18 34 -2 q12 16 30 -2 q16 -16 30 -2" stroke="#10B981" stroke-width="6"
        fill="none" stroke-linecap="round"/>
      <path d="M84 52 q22 -18 30 6 q-6 22 -28 14 q-14 -8 -2 -20 Z" fill="#059669" stroke="#022C22" stroke-width="3"/>
      <path d="M92 34 l-6 -16 12 10 Z" fill="#34D399"/>
      <path d="M108 34 l8 -14 -2 16 Z" fill="#34D399"/>
      ${eyes(94, 110, 54, 4, '#FDE68A')}
      <circle cx="94" cy="54" r="1.8" fill="#0B0F19"/><circle cx="110" cy="54" r="1.8" fill="#0B0F19"/>
      <path d="M86 70 l-14 6 8 2 -10 6" stroke="#F87171" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w5_eel',
    he: 'צלופח חשמלי',
    en: 'Electric Eel',
    world: 5,
    kind: 'regular',
    hpMult: 0.85,
    atkMult: 1.15,
    svg: sprite(`
      <path d="M8 40 q30 12 26 34 q-4 22 26 26 q26 4 52 -6" stroke="#4C1D95" stroke-width="16"
        fill="none" stroke-linecap="round"/>
      <path d="M8 40 q30 12 26 34 q-4 22 26 26 q26 4 52 -6" stroke="#7C3AED" stroke-width="7"
        fill="none" stroke-linecap="round"/>
      <ellipse cx="100" cy="90" rx="18" ry="14" fill="#5B21B6" stroke="#2E1065" stroke-width="3"/>
      ${eyes(96, 110, 86, 4, '#FDE68A')}
      <path d="M92 98 q10 6 20 0" stroke="#FDE68A" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M30 16 l-8 18 h10 l-8 16 20 -22 h-10 Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/>
      <path d="M62 8 l-6 14 h8 l-6 12 15 -17 h-8 Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/>`),
  },
  {
    id: 'w5_turtle',
    he: 'צב מצולות',
    en: 'Abyss Turtle',
    world: 5,
    kind: 'regular',
    /* tank */ hpMult: 1.2,
    atkMult: 0.8,
    def: 34,
    svg: sprite(`
      <path d="M18 88 q42 -60 84 0 Z" fill="#166534" stroke="#052E16" stroke-width="4"/>
      <path d="M40 84 q8 -26 20 -30 q12 4 20 30 Z" fill="#22C55E" stroke="#052E16" stroke-width="2.5"/>
      <path d="M22 84 q6 -20 16 -26 M98 84 q-6 -20 -16 -26" stroke="#052E16" stroke-width="2.5" fill="none"/>
      <rect x="14" y="86" width="20" height="16" rx="7" fill="#4D7C0F"/>
      <rect x="86" y="86" width="20" height="16" rx="7" fill="#4D7C0F"/>
      <ellipse cx="60" cy="98" rx="20" ry="14" fill="#65A30D" stroke="#3F6212" stroke-width="3"/>
      ${eyes(52, 68, 96, 4, '#0B0F19')}
      <path d="M52 106 q8 5 16 0" stroke="#3F6212" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w5_angler',
    he: 'דג פנס',
    en: 'Anglerfish',
    world: 5,
    kind: 'regular',
    hpMult: 1.05,
    atkMult: 0.95,
    def: 18,
    svg: sprite(`
      <path d="M20 70 q26 -34 60 -20 q26 10 22 32 q-4 24 -30 26 q-38 4 -52 -18 Z"
        fill="#1E3A5F" stroke="#0B1B30" stroke-width="3"/>
      <path d="M100 74 l16 -16 v40 Z" fill="#2C5282" stroke="#0B1B30" stroke-width="3"/>
      <path d="M42 88 q10 -8 20 0 q10 -8 20 0 q-10 10 -20 2 q-10 8 -20 -2 Z" fill="#E2E8F0"/>
      <path d="M46 44 q-4 -24 14 -30" stroke="#93C5FD" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="62" cy="12" r="10" fill="#FDE68A"/>
      <circle cx="62" cy="12" r="16" fill="#FDE68A" opacity=".22"/>
      ${eyes(44, 66, 62, 5, '#F87171')}
      <circle cx="44" cy="62" r="2" fill="#0B0F19"/><circle cx="66" cy="62" r="2" fill="#0B0F19"/>`),
  },
];

const W5_MINI: EnemyDef = {
  id: 'w5_warden',
  he: 'שומר המצולות',
  en: 'Deep Warden',
  world: 5,
  kind: 'mini',
  def: 26,
  svg: sprite(`
    <path d="M24 108 q0 -52 36 -60 q36 8 36 60 Z" fill="#0E7490" stroke="#083344" stroke-width="4"/>
    <path d="M34 92 q26 -12 52 0 M34 76 q26 -12 52 0" stroke="#22D3EE" stroke-width="3" fill="none"/>
    <circle cx="60" cy="40" r="24" fill="#155E75" stroke="#083344" stroke-width="4"/>
    <path d="M36 26 l-14 -14 22 6 Z" fill="#0891B2"/>
    <path d="M84 26 l14 -14 -22 6 Z" fill="#0891B2"/>
    ${eyes(50, 70, 38, 6, '#A5F3FC')}
    <circle cx="50" cy="38" r="2.6" fill="#0B0F19"/><circle cx="70" cy="38" r="2.6" fill="#0B0F19"/>
    <path d="M48 54 q12 8 24 0" stroke="#A5F3FC" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M8 70 l14 -10 M112 70 l-14 -10" stroke="#0891B2" stroke-width="7" stroke-linecap="round"/>`),
};

/* --- world 6 — ממלכת הקרח ----------------------------------------------- */

/**
 * THE CHILL WORLD. `attackSlowMult` multiplies the PLAYER's attack interval for
 * as long as that enemy is standing — a pure, RNG-free multiplication applied in
 * the same line that already handles סערת מהלומות. It is the one mechanic in the
 * game that attacks a STAT rather than the health bar, and the stat it attacks is
 * Shoulders, so a frozen world is where shoulder training suddenly pays.
 */
const W6: readonly EnemyDef[] = [
  {
    id: 'w6_snowman',
    he: 'איש שלג זועם',
    en: 'Angry Snowman',
    world: 6,
    kind: 'regular',
    /* tank */ hpMult: 1.3,
    atkMult: 0.78,
    attackSlowMult: 1.2,
    svg: sprite(`
      <circle cx="60" cy="88" r="26" fill="#F1F5F9" stroke="#94A3B8" stroke-width="3"/>
      <circle cx="60" cy="52" r="19" fill="#F8FAFC" stroke="#94A3B8" stroke-width="3"/>
      <circle cx="60" cy="24" r="14" fill="#F8FAFC" stroke="#94A3B8" stroke-width="3"/>
      <path d="M14 60 l26 -6 M106 60 l-26 -6" stroke="#78350F" stroke-width="5" stroke-linecap="round"/>
      <path d="M44 12 h32 v-8 h-32 Z" fill="#1F2937"/>
      <rect x="40" y="10" width="40" height="6" rx="2" fill="#111827"/>
      ${eyes(54, 66, 22, 3.4, '#0B0F19')}
      <path d="M60 26 l14 4 -14 4 Z" fill="#F97316"/>
      <path d="M50 34 q10 8 20 0" stroke="#0B0F19" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle cx="60" cy="46" r="3.4" fill="#334155"/><circle cx="60" cy="58" r="3.4" fill="#334155"/>`),
  },
  {
    id: 'w6_icewolf',
    he: 'זאב קרח',
    en: 'Ice Wolf',
    world: 6,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.22,
    svg: sprite(`
      <path d="M14 66 q-12 -12 -4 -24 q10 10 16 8 Z" fill="#93C5FD"/>
      <ellipse cx="54" cy="78" rx="38" ry="21" fill="#BFDBFE" stroke="#3B82F6" stroke-width="3"/>
      <rect x="28" y="94" width="10" height="18" rx="4" fill="#93C5FD"/>
      <rect x="70" y="94" width="10" height="18" rx="4" fill="#93C5FD"/>
      <circle cx="90" cy="52" r="21" fill="#DBEAFE" stroke="#3B82F6" stroke-width="3"/>
      <path d="M76 34 l-4 -18 16 10 Z" fill="#93C5FD"/>
      <path d="M104 34 l6 -17 -16 9 Z" fill="#93C5FD"/>
      ${eyes(84, 102, 48, 4, '#1D4ED8')}
      <path d="M100 62 q10 2 12 8" stroke="#1E3A8A" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M86 64 l4 8 6 -8" stroke="#F8FAFC" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w6_glacier',
    he: 'גולם קרחון',
    en: 'Glacier Golem',
    world: 6,
    kind: 'regular',
    /* tank */ hpMult: 1.2,
    atkMult: 0.85,
    attackSlowMult: 1.25,
    svg: sprite(`
      <path d="M30 110 l-6 -54 18 -22 h36 l18 22 -6 54 Z" fill="#7DD3FC" stroke="#0369A1" stroke-width="4"/>
      <path d="M42 34 l18 -22 18 22 Z" fill="#BAE6FD" stroke="#0369A1" stroke-width="3"/>
      <path d="M34 60 l20 12 -14 16" stroke="#E0F2FE" stroke-width="3" fill="none"/>
      <path d="M86 60 l-20 12 14 16" stroke="#E0F2FE" stroke-width="3" fill="none"/>
      <path d="M6 68 l16 6 -14 12" stroke="#7DD3FC" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M114 68 l-16 6 14 12" stroke="#7DD3FC" stroke-width="7" fill="none" stroke-linecap="round"/>
      ${eyes(48, 72, 54, 6, '#0C4A6E')}
      <path d="M46 78 h28" stroke="#0C4A6E" stroke-width="4" stroke-linecap="round"/>`),
  },
  {
    id: 'w6_frostwind',
    he: 'רוח כפור',
    en: 'Frost Wind',
    world: 6,
    kind: 'regular',
    /* nimble */ hpMult: 0.82,
    atkMult: 1.18,
    attackSlowMult: 1.15,
    svg: sprite(`
      <path d="M24 92 q-14 -34 12 -52 q28 -20 54 2 q22 22 4 50 q-36 18 -70 0 Z"
        fill="#E0F2FE" opacity=".85" stroke="#93C5FD" stroke-width="3"/>
      <path d="M14 46 q22 -10 40 0 M12 62 q26 -10 46 0" stroke="#BFDBFE" stroke-width="4"
        fill="none" stroke-linecap="round"/>
      <path d="M70 100 q20 6 36 -4" stroke="#BFDBFE" stroke-width="4" fill="none" stroke-linecap="round"/>
      ${eyes(48, 74, 56, 6, '#1D4ED8')}
      <path d="M46 76 q14 12 28 0" stroke="#1D4ED8" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M100 18 v22 M90 24 l20 10 M110 24 l-20 10" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>`),
  },
  {
    id: 'w6_icicle',
    he: 'חוד קרח',
    en: 'Icicle Spike',
    world: 6,
    kind: 'regular',
    hpMult: 0.9,
    atkMult: 1.12,
    svg: sprite(`
      <path d="M60 116 l-24 -66 24 -38 24 38 Z" fill="#BAE6FD" stroke="#0284C7" stroke-width="4"/>
      <path d="M60 12 l-10 40 10 -8 10 8 Z" fill="#F0F9FF"/>
      <path d="M36 50 h48" stroke="#0284C7" stroke-width="3"/>
      <path d="M22 78 l14 -14 4 18 Z" fill="#7DD3FC" stroke="#0284C7" stroke-width="2.5"/>
      <path d="M98 78 l-14 -14 -4 18 Z" fill="#7DD3FC" stroke="#0284C7" stroke-width="2.5"/>
      ${eyes(52, 68, 66, 4.6, '#0C4A6E')}
      <path d="M52 80 q8 7 16 0" stroke="#0C4A6E" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w6_yeti',
    he: 'יטי הפסגות',
    en: 'Summit Yeti',
    world: 6,
    kind: 'regular',
    hpMult: 1.05,
    atkMult: 0.95,
    svg: sprite(`
      <path d="M26 112 q2 -44 20 -54 h28 q18 10 20 54 Z" fill="#F1F5F9" stroke="#64748B" stroke-width="3"/>
      <path d="M40 74 q20 14 40 0 q-4 22 -20 22 -16 0 -20 -22 Z" fill="#CBD5E1"/>
      <circle cx="60" cy="38" r="23" fill="#F8FAFC" stroke="#64748B" stroke-width="3"/>
      <path d="M40 22 q20 -14 40 0 q-8 -16 -20 -16 -12 0 -20 16 Z" fill="#E2E8F0"/>
      ${eyes(51, 69, 36, 4.4, '#1E293B')}
      <ellipse cx="60" cy="48" rx="9" ry="6" fill="#94A3B8"/>
      <path d="M50 56 q10 8 20 0" stroke="#1E293B" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M12 76 q-6 16 6 26 M108 76 q6 16 -6 26" stroke="#E2E8F0" stroke-width="12"
        fill="none" stroke-linecap="round"/>`),
  },
];

const W6_MINI: EnemyDef = {
  id: 'w6_frostking',
  he: 'מלך הכפור',
  en: 'Frost King',
  world: 6,
  kind: 'mini',
  attackSlowMult: 1.2,
  svg: sprite(`
    <path d="M22 110 q4 -48 22 -58 h32 q18 10 22 58 Z" fill="#1D4ED8" stroke="#172554" stroke-width="4"/>
    <path d="M38 62 q22 14 44 0 l-4 20 q-18 10 -36 0 Z" fill="#3B82F6"/>
    <circle cx="60" cy="38" r="21" fill="#DBEAFE" stroke="#1E3A8A" stroke-width="3"/>
    <path d="M36 24 l4 -18 8 12 12 -16 12 16 8 -12 4 18 Z" fill="#7DD3FC" stroke="#1E3A8A" stroke-width="2.5"/>
    ${eyes(52, 68, 38, 4.4, '#1E3A8A')}
    <path d="M50 50 q10 7 20 0" stroke="#1E3A8A" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M104 42 v56" stroke="#93C5FD" stroke-width="6" stroke-linecap="round"/>
    <path d="M104 30 l-12 16 h24 Z" fill="#BAE6FD" stroke="#1E3A8A" stroke-width="2.5"/>
    <path d="M10 78 l14 8 -14 10" stroke="#3B82F6" stroke-width="6" fill="none" stroke-linecap="round"/>`),
};

/* --- world 7 — ממלכת הצללים --------------------------------------------- */

/**
 * THE DODGE WORLD. `dodgeChance` lets a shade slip an incoming blow entirely.
 *
 * THE MERCY RULE, and it is deliberate: **a CRITICAL hit can never be dodged.**
 * A shade only fades away from ordinary blows, so the counter-play is a stat the
 * player already trains (Arms → crit) plus מכה מדויקת, whose guaranteed crit is
 * therefore also a guaranteed LANDED hit. Taps and the super move roll the same
 * way as an auto attack, so nothing here is a hidden tax on tapping — and, since
 * the draw only happens when `dodgeChance > 0`, no other world's seed moves.
 */
const W7: readonly EnemyDef[] = [
  {
    id: 'w7_wanderer',
    he: 'צל נודד',
    en: 'Wandering Shade',
    world: 7,
    kind: 'regular',
    hpMult: 0.85,
    atkMult: 1.15,
    dodgeChance: 0.18,
    svg: sprite(`
      <path d="M30 100 V54 a30 30 0 0 1 60 0 v46 l-10 -10 -10 10 -10 -10 -10 10 -10 -10 Z"
        fill="#3B2A5A" opacity=".92" stroke="#1E1233" stroke-width="3"/>
      <path d="M38 52 a22 22 0 0 1 44 0 q-22 10 -44 0 Z" fill="#241640"/>
      ${eyes(48, 74, 58, 6, '#C084FC')}
      <circle cx="48" cy="58" r="10" fill="#C084FC" opacity=".2"/>
      <circle cx="74" cy="58" r="10" fill="#C084FC" opacity=".2"/>
      <path d="M50 78 q12 8 24 0" stroke="#C084FC" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M14 84 q10 -14 20 -6 M106 84 q-10 -14 -20 -6" stroke="#4C1D95" stroke-width="6"
        fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w7_mute',
    he: 'רפאים אילם',
    en: 'Mute Wraith',
    world: 7,
    kind: 'regular',
    hpMult: 1.1,
    atkMult: 0.95,
    dodgeChance: 0.2,
    svg: sprite(`
      <path d="M26 108 q-6 -50 14 -66 q20 -16 40 0 q20 16 14 66 q-34 -14 -68 0 Z"
        fill="#4C1D95" opacity=".9" stroke="#2E1065" stroke-width="3"/>
      <path d="M40 46 q20 -14 40 0 q-4 26 -20 30 -16 -4 -20 -30 Z" fill="#1E1B4B"/>
      ${eyes(50, 70, 50, 5, '#A78BFA')}
      <rect x="46" y="64" width="28" height="7" rx="3" fill="#A78BFA"/>
      <path d="M50 68 h24" stroke="#1E1B4B" stroke-width="2.5"/>
      <path d="M18 66 q-10 12 0 24 M102 66 q10 12 0 24" stroke="#6D28D9" stroke-width="7"
        fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w7_reaper',
    he: 'קוצר האפלה',
    en: 'Dark Reaper',
    world: 7,
    kind: 'regular',
    hpMult: 0.95,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M28 110 q2 -46 20 -56 h24 q18 10 20 56 Z" fill="#18122B" stroke="#0B0715" stroke-width="3"/>
      <path d="M60 14 a24 24 0 0 1 24 28 q-24 12 -48 0 A24 24 0 0 1 60 14 Z" fill="#0B0715"/>
      <ellipse cx="60" cy="44" rx="15" ry="13" fill="#2A2140"/>
      ${eyes(53, 67, 44, 4.4, '#F0ABFC')}
      <path d="M52 58 h16" stroke="#F0ABFC" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M100 8 v100" stroke="#57534E" stroke-width="5" stroke-linecap="round"/>
      <path d="M100 14 q-30 2 -40 24 q26 -8 40 4 Z" fill="#D6D3D1" stroke="#57534E" stroke-width="3"/>
      <path d="M20 78 q-8 14 4 22" stroke="#2A2140" stroke-width="8" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w7_veil',
    he: 'מסך אפלה',
    en: 'Veil of Dark',
    world: 7,
    kind: 'regular',
    /* tank */ hpMult: 1.3,
    atkMult: 0.8,
    svg: sprite(`
      <path d="M16 112 q-4 -62 20 -78 q24 -14 48 0 q24 16 20 78 Z" fill="#221B3A" stroke="#100B1E" stroke-width="4"/>
      <path d="M30 40 q30 -18 60 0 q-6 -22 -30 -22 -24 0 -30 22 Z" fill="#2E2450"/>
      <path d="M28 96 q32 -14 64 0" stroke="#4C1D95" stroke-width="4" fill="none"/>
      <path d="M28 78 q32 -14 64 0" stroke="#4C1D95" stroke-width="4" fill="none"/>
      ${eyes(46, 74, 56, 7, '#8B5CF6')}
      <circle cx="46" cy="56" r="3" fill="#0B0715"/><circle cx="74" cy="56" r="3" fill="#0B0715"/>
      <path d="M48 72 q12 6 24 0" stroke="#8B5CF6" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w7_phantom',
    he: 'פנטום מרצד',
    en: 'Flickering Phantom',
    world: 7,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    dodgeChance: 0.22,
    svg: sprite(`
      <path d="M34 98 V52 a26 26 0 0 1 52 0 v46 q-26 -12 -52 0 Z" fill="#A78BFA" opacity=".35"/>
      <path d="M28 104 V56 a32 32 0 0 1 64 0 v48 l-11 -12 -11 12 -10 -12 -11 12 -11 -12 Z"
        fill="#C4B5FD" opacity=".7" stroke="#7C3AED" stroke-width="3"/>
      ${eyes(48, 74, 58, 5.5, '#4C1D95')}
      <ellipse cx="61" cy="76" rx="8" ry="6" fill="#4C1D95" opacity=".85"/>
      <path d="M12 52 q10 -10 20 -4 M108 52 q-10 -10 -20 -4" stroke="#A78BFA" stroke-width="5"
        fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w7_grudge',
    he: 'טינה קדומה',
    en: 'Ancient Grudge',
    world: 7,
    kind: 'regular',
    hpMult: 1.05,
    atkMult: 0.75,
    svg: sprite(`
      <path d="M24 106 q-2 -46 18 -58 q18 -10 36 0 q20 12 18 58 Z" fill="#312E52" stroke="#141229" stroke-width="3"/>
      <path d="M40 60 h40 v10 h-40 Z" fill="#4C1D95"/>
      <circle cx="60" cy="40" r="20" fill="#463C6E" stroke="#141229" stroke-width="3"/>
      <path d="M42 30 l14 6 M78 30 l-14 6" stroke="#0B0715" stroke-width="3.5" stroke-linecap="round"/>
      ${eyes(52, 68, 40, 4.4, '#FB7185')}
      <path d="M50 52 q10 -7 20 0" stroke="#FB7185" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M14 84 q6 -16 18 -14 M106 84 q-6 -16 -18 -14" stroke="#463C6E" stroke-width="7"
        fill="none" stroke-linecap="round"/>`),
  },
];

const W7_MINI: EnemyDef = {
  id: 'w7_nightmare',
  he: 'סיוט',
  en: 'Nightmare',
  world: 7,
  kind: 'mini',
  dodgeChance: 0.2,
  svg: sprite(`
    <path d="M18 112 q-6 -58 20 -74 q22 -14 44 0 q26 16 20 74 Z" fill="#1A1030" stroke="#0A0518" stroke-width="4"/>
    <path d="M30 44 q30 -22 60 0 q-8 -26 -30 -26 -22 0 -30 26 Z" fill="#2B1A4D"/>
    <path d="M28 20 l10 20 M92 20 l-10 20" stroke="#7C3AED" stroke-width="5" stroke-linecap="round"/>
    ${eyes(46, 74, 54, 8, '#F0ABFC')}
    <circle cx="46" cy="54" r="3.2" fill="#0A0518"/><circle cx="74" cy="54" r="3.2" fill="#0A0518"/>
    <path d="M42 78 l10 8 8 -8 8 8 10 -8" stroke="#F0ABFC" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
    <path d="M8 70 q-4 16 8 26 M112 70 q4 16 -8 26" stroke="#4C1D95" stroke-width="8"
      fill="none" stroke-linecap="round"/>`),
};

/* --- world 8 — גן עדן --------------------------------------------------- */

/**
 * THE REGEN WORLD. `regenPct` heals the enemy by a fraction of its OWN max HP
 * every second, paid on exactly the clock the player's Core regen is paid on.
 * It converts a fight into a race: chip damage stops being enough, and burst —
 * the super move, מכת מחץ, a tap streak — becomes the only way through. It is
 * the mirror image of the Core stat the player has been training all game.
 */
const W8: readonly EnemyDef[] = [
  {
    id: 'w8_cherub',
    he: 'כרוב זעפן',
    en: 'Grumpy Cherub',
    world: 8,
    kind: 'regular',
    /* nimble */ hpMult: 0.8,
    atkMult: 1.2,
    svg: sprite(`
      <path d="M18 66 q-14 -22 6 -30 q16 -6 22 12 q-12 14 -28 18 Z" fill="#FEF3C7" stroke="#F59E0B" stroke-width="3"/>
      <path d="M102 66 q14 -22 -6 -30 q-16 -6 -22 12 q12 14 28 18 Z" fill="#FEF3C7" stroke="#F59E0B" stroke-width="3"/>
      <ellipse cx="60" cy="84" rx="24" ry="22" fill="#FDE7CE" stroke="#D9A066" stroke-width="3"/>
      <circle cx="60" cy="48" r="21" fill="#FDE7CE" stroke="#D9A066" stroke-width="3"/>
      <path d="M40 38 q20 -18 40 0 q-8 -14 -20 -14 -12 0 -20 14 Z" fill="#FBBF24"/>
      <ellipse cx="60" cy="18" rx="17" ry="5" fill="none" stroke="#FBBF24" stroke-width="4"/>
      ${eyes(52, 68, 48, 4.2, '#1B2438')}
      <path d="M50 60 q10 -8 20 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M46 40 l10 -4 M74 40 l-10 -4" stroke="#7C2D12" stroke-width="3" stroke-linecap="round"/>`),
  },
  {
    id: 'w8_guardian',
    he: 'מלאך שומר',
    en: 'Guardian Angel',
    world: 8,
    kind: 'regular',
    /* tank */ hpMult: 1.35,
    atkMult: 0.75,
    regenPct: 0.02,
    svg: sprite(`
      <path d="M22 100 q-16 -34 4 -52 q10 22 22 30 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
      <path d="M98 100 q16 -34 -4 -52 q-10 22 -22 30 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
      <path d="M32 112 q2 -50 28 -58 q26 8 28 58 Z" fill="#E2E8F0" stroke="#94A3B8" stroke-width="3"/>
      <path d="M44 70 h32 v34 h-32 Z" fill="#FBBF24" opacity=".55"/>
      <circle cx="60" cy="40" r="20" fill="#FDE7CE" stroke="#D9A066" stroke-width="3"/>
      <ellipse cx="60" cy="12" rx="16" ry="5" fill="none" stroke="#FBBF24" stroke-width="4"/>
      ${eyes(52, 68, 40, 4, '#1B2438')}
      <path d="M52 52 h16" stroke="#7C2D12" stroke-width="3" stroke-linecap="round"/>
      <path d="M60 68 v40 M46 82 h28" stroke="#FBBF24" stroke-width="5" stroke-linecap="round"/>`),
  },
  {
    id: 'w8_harp',
    he: 'נבל שמימי',
    en: 'Celestial Harp',
    world: 8,
    kind: 'regular',
    hpMult: 1.1,
    atkMult: 0.95,
    regenPct: 0.025,
    svg: sprite(`
      <path d="M28 110 q-6 -66 30 -96 q26 12 30 44" fill="none" stroke="#FBBF24" stroke-width="9" stroke-linecap="round"/>
      <path d="M28 110 h62" stroke="#B45309" stroke-width="8" stroke-linecap="round"/>
      <path d="M44 104 V44 M56 104 V36 M68 104 V40 M80 104 V52" stroke="#FEF3C7" stroke-width="3"/>
      <circle cx="88" cy="58" r="9" fill="#FDE68A" stroke="#B45309" stroke-width="2.5"/>
      ${eyes(50, 68, 76, 5, '#7C2D12')}
      <path d="M50 90 q10 8 18 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="24" r="4" fill="#FEF3C7"/><circle cx="96" cy="26" r="3.5" fill="#FEF3C7"/>`),
  },
  {
    id: 'w8_thundercloud',
    he: 'ענן רעם',
    en: 'Thundercloud',
    world: 8,
    kind: 'regular',
    hpMult: 0.85,
    atkMult: 1.15,
    svg: sprite(`
      <path d="M26 74 a20 20 0 0 1 4 -38 a26 26 0 0 1 50 -6 a20 20 0 0 1 14 44 Z"
        fill="#E2E8F0" stroke="#94A3B8" stroke-width="3"/>
      <path d="M30 74 a18 18 0 0 0 60 0 Z" fill="#CBD5E1"/>
      ${eyes(48, 74, 44, 5.5, '#334155')}
      <path d="M48 60 q13 10 26 0" stroke="#334155" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M52 78 l-10 20 h12 l-8 18 22 -26 h-12 Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2.5"/>
      <path d="M84 80 l-6 14 h8 l-6 12 14 -18 h-8 Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="2"/>`),
  },
  {
    id: 'w8_seraph',
    he: 'שרף בוער',
    en: 'Burning Seraph',
    world: 8,
    kind: 'regular',
    hpMult: 1.05,
    atkMult: 1.1,
    svg: sprite(`
      <path d="M16 58 q-10 -20 8 -26 q12 16 26 20 Z" fill="#FDBA74" stroke="#EA580C" stroke-width="2.5"/>
      <path d="M104 58 q10 -20 -8 -26 q-12 16 -26 20 Z" fill="#FDBA74" stroke="#EA580C" stroke-width="2.5"/>
      <path d="M20 92 q-8 -18 8 -24 q12 14 24 18 Z" fill="#FDBA74" stroke="#EA580C" stroke-width="2.5"/>
      <path d="M100 92 q8 -18 -8 -24 q-12 14 -24 18 Z" fill="#FDBA74" stroke="#EA580C" stroke-width="2.5"/>
      <path d="M40 110 q0 -48 20 -60 q20 12 20 60 Z" fill="#F97316" stroke="#9A3412" stroke-width="3"/>
      <circle cx="60" cy="36" r="19" fill="#FED7AA" stroke="#EA580C" stroke-width="3"/>
      ${eyes(52, 68, 36, 4, '#7C2D12')}
      <path d="M50 48 q10 8 20 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M60 6 l-8 12 h16 Z" fill="#FDE68A"/>`),
  },
  {
    id: 'w8_wheel',
    he: 'גלגל אש',
    en: 'Wheel of Fire',
    world: 8,
    kind: 'regular',
    hpMult: 0.95,
    atkMult: 0.9,
    regenPct: 0.015,
    svg: sprite(`
      <circle cx="60" cy="60" r="46" fill="none" stroke="#F59E0B" stroke-width="8"/>
      <circle cx="60" cy="60" r="30" fill="none" stroke="#FDE68A" stroke-width="6"/>
      <path d="M60 14 v92 M14 60 h92 M27 27 l66 66 M93 27 l-66 66" stroke="#FBBF24" stroke-width="4"/>
      <circle cx="60" cy="60" r="18" fill="#FEF3C7" stroke="#B45309" stroke-width="3"/>
      ${eyes(53, 67, 57, 4, '#7C2D12')}
      <path d="M53 68 q7 6 14 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  },
];

const W8_MINI: EnemyDef = {
  id: 'w8_gatewarden',
  he: 'שוער השערים',
  en: 'Gate Warden',
  world: 8,
  kind: 'mini',
  regenPct: 0.02,
  svg: sprite(`
    <path d="M14 104 q-14 -36 4 -56 q12 24 26 34 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
    <path d="M106 104 q14 -36 -4 -56 q-12 24 -26 34 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
    <path d="M30 112 q4 -54 30 -62 q26 8 30 62 Z" fill="#FDE68A" stroke="#B45309" stroke-width="4"/>
    <path d="M46 66 h28 v40 h-28 Z" fill="#FBBF24"/>
    <circle cx="60" cy="34" r="21" fill="#FDE7CE" stroke="#D9A066" stroke-width="3"/>
    <ellipse cx="60" cy="6" rx="18" ry="5" fill="none" stroke="#FBBF24" stroke-width="4"/>
    ${eyes(51, 69, 34, 4.6, '#1B2438')}
    <path d="M50 46 h20" stroke="#7C2D12" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M100 40 v70" stroke="#B45309" stroke-width="6" stroke-linecap="round"/>
    <path d="M100 22 l-12 20 h24 Z" fill="#FEF3C7" stroke="#B45309" stroke-width="3"/>`),
};

/* --- world 9 — גיהינום -------------------------------------------------- */

/**
 * THE CRIT WORLD — the finale. `critChance`/`critMultiplier` give the enemy the
 * player's own signature move, so incoming damage stops being a flat drip and
 * starts having SPIKES. The counter-play is Back (mitigation cuts a crit exactly
 * as hard as a normal blow), עמידת ברזל timed over the spike, and the Core regen
 * that has to out-heal a worst case rather than an average.
 */
const W9: readonly EnemyDef[] = [
  {
    id: 'w9_imp',
    he: 'שדון להבה',
    en: 'Flame Imp',
    world: 9,
    kind: 'regular',
    /* nimble */ hpMult: 0.78,
    atkMult: 1.22,
    critChance: 0.15,
    critMultiplier: 1.6,
    svg: sprite(`
      <path d="M36 108 q0 -34 24 -42 q24 8 24 42 Z" fill="#DC2626" stroke="#7F1D1D" stroke-width="3"/>
      <circle cx="60" cy="44" r="22" fill="#EF4444" stroke="#7F1D1D" stroke-width="3"/>
      <path d="M40 26 l-8 -18 20 8 Z" fill="#991B1B"/>
      <path d="M80 26 l8 -18 -20 8 Z" fill="#991B1B"/>
      ${eyes(51, 69, 42, 4.4, '#FDE68A')}
      <circle cx="51" cy="42" r="2" fill="#0B0F19"/><circle cx="69" cy="42" r="2" fill="#0B0F19"/>
      <path d="M48 56 l6 6 6 -6 6 6 6 -6" stroke="#FDE68A" stroke-width="3" fill="none" stroke-linejoin="round"/>
      <path d="M92 78 q16 6 12 24 q-10 -10 -18 -8 Z" fill="#7F1D1D"/>
      <path d="M18 84 l-12 -8 14 -4" stroke="#F97316" stroke-width="5" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w9_hound',
    he: 'כלב גיהינום',
    en: 'Hellhound',
    world: 9,
    kind: 'regular',
    hpMult: 0.9,
    atkMult: 1.15,
    critChance: 0.12,
    critMultiplier: 1.5,
    svg: sprite(`
      <ellipse cx="52" cy="78" rx="38" ry="21" fill="#1F2937" stroke="#0B0F19" stroke-width="3"/>
      <rect x="28" y="94" width="10" height="18" rx="4" fill="#111827"/>
      <rect x="66" y="94" width="10" height="18" rx="4" fill="#111827"/>
      <circle cx="90" cy="52" r="21" fill="#374151" stroke="#0B0F19" stroke-width="3"/>
      <path d="M76 34 l-4 -18 16 10 Z" fill="#111827"/>
      <path d="M104 34 l6 -17 -16 9 Z" fill="#111827"/>
      ${eyes(84, 102, 48, 4.4, '#F97316')}
      <circle cx="84" cy="48" r="8" fill="#F97316" opacity=".22"/>
      <circle cx="102" cy="48" r="8" fill="#F97316" opacity=".22"/>
      <path d="M84 62 l5 8 6 -8 5 8" stroke="#F8FAFC" stroke-width="3" fill="none" stroke-linejoin="round"/>
      <path d="M16 68 q-12 -14 -2 -24 q6 16 18 18 Z" fill="#EA580C"/>`),
  },
  {
    id: 'w9_tormentor',
    he: 'מענה נשמות',
    en: 'Soul Tormentor',
    world: 9,
    kind: 'regular',
    hpMult: 1.1,
    atkMult: 1,
    critChance: 0.18,
    critMultiplier: 1.7,
    svg: sprite(`
      <path d="M26 110 q2 -46 20 -56 h28 q18 10 20 56 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="3"/>
      <path d="M42 66 q18 12 36 0 l-4 18 q-14 8 -28 0 Z" fill="#991B1B"/>
      <circle cx="60" cy="38" r="21" fill="#B91C1C" stroke="#450A0A" stroke-width="3"/>
      <path d="M38 24 l6 -16 6 12 M82 24 l-6 -16 -6 12" stroke="#450A0A" stroke-width="4"
        fill="none" stroke-linecap="round"/>
      ${eyes(52, 68, 36, 4.4, '#FDE68A')}
      <path d="M48 50 l6 6 6 -6 6 6 6 -6" stroke="#FDE68A" stroke-width="3" fill="none" stroke-linejoin="round"/>
      <path d="M100 26 v78" stroke="#78350F" stroke-width="5" stroke-linecap="round"/>
      <path d="M92 26 h16 M100 26 v-10" stroke="#F97316" stroke-width="4" stroke-linecap="round"/>
      <path d="M14 74 q-8 14 2 24" stroke="#991B1B" stroke-width="8" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'w9_abaddon',
    he: 'אבדון',
    en: 'Abaddon',
    world: 9,
    kind: 'regular',
    /* tank */ hpMult: 1.4,
    atkMult: 0.72,
    svg: sprite(`
      <path d="M18 114 q-4 -56 22 -70 h40 q26 14 22 70 Z" fill="#292524" stroke="#0C0A09" stroke-width="4"/>
      <path d="M34 70 h52 v14 h-52 Z" fill="#57534E"/>
      <path d="M34 92 h52 v10 h-52 Z" fill="#44403C"/>
      <circle cx="60" cy="34" r="22" fill="#44403C" stroke="#0C0A09" stroke-width="3"/>
      <path d="M34 20 q-14 -14 -6 -18 q12 4 16 16 Z" fill="#78350F"/>
      <path d="M86 20 q14 -14 6 -18 q-12 4 -16 16 Z" fill="#78350F"/>
      ${eyes(51, 69, 34, 5, '#EF4444')}
      <path d="M48 48 h24" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>
      <path d="M10 84 l12 -8 M110 84 l-12 -8" stroke="#57534E" stroke-width="8" stroke-linecap="round"/>`),
  },
  {
    id: 'w9_archdemon',
    he: 'שד בכיר',
    en: 'Arch Demon',
    world: 9,
    kind: 'regular',
    hpMult: 1.15,
    atkMult: 1.05,
    critChance: 0.1,
    critMultiplier: 1.5,
    svg: sprite(`
      <path d="M14 84 q-10 -34 12 -46 q4 24 20 34 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="3"/>
      <path d="M106 84 q10 -34 -12 -46 q-4 24 -20 34 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="3"/>
      <path d="M30 112 q2 -50 30 -58 q28 8 30 58 Z" fill="#991B1B" stroke="#450A0A" stroke-width="3"/>
      <circle cx="60" cy="38" r="22" fill="#DC2626" stroke="#450A0A" stroke-width="3"/>
      <path d="M38 22 q-14 -16 -4 -20 q12 6 14 18 Z" fill="#450A0A"/>
      <path d="M82 22 q14 -16 4 -20 q-12 6 -14 18 Z" fill="#450A0A"/>
      ${eyes(51, 69, 36, 4.6, '#FDE68A')}
      <path d="M48 52 q12 8 24 0" stroke="#450A0A" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <path d="M52 52 l3 6 M60 54 l0 7 M68 52 l-3 6" stroke="#FEF3C7" stroke-width="2.5" stroke-linecap="round"/>`),
  },
  {
    id: 'w9_golem',
    he: 'גולם גופרית',
    en: 'Sulphur Golem',
    world: 9,
    kind: 'regular',
    hpMult: 1.05,
    atkMult: 0.88,
    svg: sprite(`
      <path d="M28 112 l-4 -52 16 -18 h40 l16 18 -4 52 Z" fill="#78350F" stroke="#431407" stroke-width="4"/>
      <path d="M40 66 l16 10 -10 14 M84 66 l-16 10 10 14" stroke="#F59E0B" stroke-width="4" fill="none"/>
      <path d="M42 42 h36 v14 h-36 Z" fill="#92400E"/>
      <path d="M46 24 l14 -14 14 14 Z" fill="#B45309" stroke="#431407" stroke-width="3"/>
      ${eyes(48, 72, 48, 5.5, '#FDE68A')}
      <path d="M48 60 h24" stroke="#FDE68A" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M8 74 l14 6 -12 12" stroke="#92400E" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M112 74 l-14 6 12 12" stroke="#92400E" stroke-width="8" fill="none" stroke-linecap="round"/>`),
  },
];

const W9_MINI: EnemyDef = {
  id: 'w9_warlord',
  he: 'מצביא הלהבות',
  en: 'Flame Warlord',
  world: 9,
  kind: 'mini',
  critChance: 0.2,
  critMultiplier: 1.8,
  svg: sprite(`
    <path d="M22 112 q2 -54 26 -64 h24 q24 10 26 64 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="4"/>
    <path d="M38 62 q22 14 44 0 l-4 22 q-18 10 -36 0 Z" fill="#B91C1C"/>
    <circle cx="60" cy="36" r="23" fill="#450A0A" stroke="#1C0505" stroke-width="3"/>
    <path d="M30 18 l-8 -16 22 8 Z" fill="#991B1B"/>
    <path d="M90 18 l8 -16 -22 8 Z" fill="#991B1B"/>
    ${eyes(50, 70, 34, 5.5, '#F97316')}
    <circle cx="50" cy="34" r="10" fill="#F97316" opacity=".2"/>
    <circle cx="70" cy="34" r="10" fill="#F97316" opacity=".2"/>
    <path d="M46 50 l7 7 7 -7 7 7 7 -7" stroke="#FDE68A" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
    <path d="M104 20 v88" stroke="#57534E" stroke-width="6" stroke-linecap="round"/>
    <path d="M104 8 l-14 24 h28 Z" fill="#F97316" stroke="#7C2D12" stroke-width="3"/>`),
};

/* --------------------------------------------------------------- rosters */

const ROSTERS: Readonly<Record<number, { regular: readonly EnemyDef[]; mini: EnemyDef }>> = {
  1: { regular: W1, mini: W1_MINI },
  2: { regular: W2, mini: W2_MINI },
  3: { regular: W3, mini: W3_MINI },
  4: { regular: W4, mini: W4_MINI },
  5: { regular: W5, mini: W5_MINI },
  6: { regular: W6, mini: W6_MINI },
  7: { regular: W7, mini: W7_MINI },
  8: { regular: W8, mini: W8_MINI },
  9: { regular: W9, mini: W9_MINI },
};

/** Every regular enemy + mini-boss, flattened (used by tests and the codex UI). */
export const ENEMIES: readonly EnemyDef[] = WORLDS.flatMap((w) => {
  const roster = ROSTERS[w.id];
  return roster ? [...roster.regular, roster.mini] : [];
});

export function regularEnemies(world: number): readonly EnemyDef[] {
  return ROSTERS[world]?.regular ?? W1;
}

export function miniBossOf(world: number): EnemyDef {
  return ROSTERS[world]?.mini ?? W1_MINI;
}

/**
 * The enemy of a given wave — deterministic, so a wave always looks the same.
 * Mini-boss cadence itself lives in `core/combat.ts` (`isMiniBossWave`).
 *
 * ROSTER SIZE AND REPLAY. The pick is `roster[(wave − 1) mod roster.length]`, so
 * GROWING a world's roster does change which sprite a future wave shows (waves
 * 1–3 keep their old enemy; wave 4 used to wrap back to the first one and now
 * meets the fourth). That is safe, and deliberately so:
 *
 *   - nothing in the persisted state is re-derived from this function. The
 *     `wave_cleared` payload carries `enemyId`, `coins`, `energySpent`, `world`,
 *     `wave` and `miniBoss` as DATA, and the reducer in `core/xp.ts` reads only
 *     the last five. Wave fights are never re-simulated on replay, so
 *     `rebuildFromEvents` on an old log is byte-identical before and after the
 *     roster grew (asserted in `tests/enemies.test.ts`);
 *   - `coins` never depended on the enemy in the first place (wave, world and
 *     the mini-boss flag decide it), so even a hypothetical re-derivation of the
 *     purse would be stable;
 *   - `waveSeed()` mixes seed/world/wave/attempt only — never the roster — so a
 *     recorded seed still reproduces the RNG stream it recorded.
 * What DOES change is the live fight ahead of the player: from wave 4 on, a
 * different sprite with a different flavour multiplier. That is content, not
 * history.
 */
export function enemyForWave(world: number, wave: number, miniBoss: boolean): EnemyDef {
  if (miniBoss) return miniBossOf(world);
  const roster = regularEnemies(world);
  const idx = ((Math.max(1, Math.floor(wave)) - 1) % roster.length + roster.length) % roster.length;
  return roster[idx] as EnemyDef;
}

export function enemyById(id: string): EnemyDef | undefined {
  return ENEMIES.find((e) => e.id === id) ?? WORLD_BOSSES.find((b) => b.id === id);
}

/* ---------------------------------------------------------- world bosses */

/**
 * One boss per world, standing at the wave AFTER the world's last one.
 *
 * GATE TUNING (see README + `docs` in balance.ts). The numbers are derived from
 * two independent pacing curves that were made to meet:
 *   - COMBAT: with active tapping and era-appropriate gear, the LAST wave of
 *     world N is clearable at roughly part level 3 / 5 / 7 / 8 / 9 / 9 / 9 / 10
 *     / 10;
 *   - TRAINING: a consistent 3–4×/week trainee reaches min-part level 3 after
 *     ~5 workouts, 5 after ~12, 7 after ~26, 8 after ~36, 9 after ~50 and 10
 *     after ~65 (measured against the real `onSetCompleted` path, see README).
 * Each gate is therefore set at (or one notch above) the level the player needs
 * anyway, and it always lands about one extra workout after they run out of
 * waves — so the gate asks for training, never for grinding.
 *
 * THE LATE LADDER IS COMPRESSED ON PURPOSE. `xpForLevel` is 100 × 1.35^(n−1),
 * so the cumulative cost of a part level roughly doubles every two levels: an
 * all-six gate at level 13 would want ~180 workouts on its own, which would put
 * the finale a year out. The five late worlds therefore escalate mostly by
 * BREADTH (which parts, and how many of them, are asked at all) and only gently
 * by height, which keeps the whole nine-world journey inside ~50 workouts while
 * the requirement SUM still rises strictly world over world.
 *
 * `hpMult`/`atkMult` sit on top of the wave scaling: bosses are damage SPONGES
 * with heavy but slow hits (`BALANCE.combat.boss.attackIntervalMs`), so the
 * fight is long and tense rather than a one-shot wipe.
 */
export const WORLD_BOSSES: readonly BossDef[] = [
  {
    id: 'boss_w1',
    he: 'מאמן הצללים',
    en: 'Shadow Coach',
    world: 1,
    kind: 'boss',
    requires: { chest: 3, arms: 3, legs: 3 },
    hpMult: 5,
    atkMult: 0.85,
    svg: sprite(`
      <path d="M18 108 q6 -34 20 -44 h44 q14 10 20 44 Z" fill="#1F2937" stroke="#0B0F19" stroke-width="3"/>
      <path d="M32 64 q28 -16 56 0 l-6 -14 q-22 -12 -44 0 Z" fill="#111827"/>
      <path d="M60 12 a26 26 0 0 1 26 30 q-26 12 -52 0 A26 26 0 0 1 60 12 Z" fill="#0B0F19"/>
      <ellipse cx="60" cy="44" rx="17" ry="14" fill="#161E2E"/>
      ${eyes(52, 68, 44, 4.5, '#EF4444')}
      <circle cx="52" cy="44" r="8" fill="#EF4444" opacity=".18"/>
      <circle cx="68" cy="44" r="8" fill="#EF4444" opacity=".18"/>
      <path d="M46 84 h28 v18 h-28 Z" fill="#374151" stroke="#0B0F19" stroke-width="2"/>
      <path d="M50 90 h20 M50 96 h14" stroke="#9CA3AF" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="86" cy="70" r="7" fill="#F59E0B"/>
      <path d="M86 70 l14 -12" stroke="#9CA3AF" stroke-width="3" stroke-linecap="round"/>
      <path d="M14 74 l-10 -8 M106 74 l10 -8" stroke="#374151" stroke-width="7" stroke-linecap="round"/>`),
  },
  {
    id: 'boss_w2',
    he: 'שליט הרחוב',
    en: 'Street Overlord',
    world: 2,
    kind: 'boss',
    requires: { chest: 5, back: 5, arms: 5 },
    hpMult: 5.5,
    atkMult: 0.9,
    svg: sprite(`
      <path d="M16 110 q4 -36 22 -46 h44 q18 10 22 46 Z" fill="#065F46" stroke="#022C22" stroke-width="3"/>
      <path d="M38 64 h44 v12 h-44 Z" fill="#047857"/>
      <circle cx="60" cy="38" r="20" fill="#C79B75"/>
      <path d="M40 34 a20 20 0 0 1 40 0 l-4 -8 a20 20 0 0 0 -32 0 Z" fill="#7F1D1D"/>
      <path d="M40 32 h40 v6 h-40 Z" fill="#DC2626"/>
      ${eyes(52, 68, 40, 3.8, '#10B981')}
      <path d="M50 50 q10 6 20 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M46 66 q14 22 28 0" stroke="#FBBF24" stroke-width="4" fill="none"/>
      <circle cx="60" cy="80" r="6" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
      <path d="M14 78 q-6 12 2 22" stroke="#C79B75" stroke-width="11" fill="none" stroke-linecap="round"/>
      <path d="M106 78 q6 12 -2 22" stroke="#C79B75" stroke-width="11" fill="none" stroke-linecap="round"/>
      <rect x="96" y="92" width="14" height="20" rx="4" fill="#A78BFA" stroke="#5B21B6" stroke-width="2"/>`),
  },
  {
    id: 'boss_w3',
    he: 'אלוף האלופים',
    en: 'Champion of Champions',
    world: 3,
    kind: 'boss',
    requires: { back: 7, core: 7, legs: 6, shoulders: 6 },
    hpMult: 6,
    atkMult: 1,
    svg: sprite(`
      <path d="M18 110 q4 -34 20 -44 h44 q16 10 20 44 Z" fill="#7C2D12" stroke="#431407" stroke-width="3"/>
      <path d="M40 70 h40 v10 h-40 Z" fill="#B45309"/>
      <path d="M44 84 h32 v8 h-32 Z" fill="#B45309" opacity=".7"/>
      <circle cx="60" cy="36" r="19" fill="#C79B75"/>
      ${eyes(52, 68, 36, 3.8, '#1B2438')}
      <path d="M50 48 q10 7 20 0" stroke="#7C2D12" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M38 30 q22 -22 44 0 q-6 -22 -22 -22 q-16 0 -22 22 Z" fill="#16A34A"/>
      <circle cx="38" cy="30" r="5" fill="#22C55E"/><circle cx="82" cy="30" r="5" fill="#22C55E"/>
      <path d="M100 16 v76" stroke="#94A3B8" stroke-width="5" stroke-linecap="round"/>
      <path d="M90 20 v-12 M100 16 v-14 M110 20 v-12" stroke="#E2E8F0" stroke-width="4" stroke-linecap="round"/>
      <path d="M12 62 a20 20 0 0 0 0 40 Z" fill="#94A3B8" stroke="#475569" stroke-width="3"/>`),
  },
  {
    id: 'boss_w4',
    he: 'זאוס',
    en: 'Zeus',
    world: 4,
    kind: 'boss',
    requires: { chest: 8, back: 8, legs: 8, shoulders: 8, arms: 8, core: 8 },
    hpMult: 7,
    atkMult: 0.9,
    svg: sprite(`
      <ellipse cx="60" cy="106" rx="46" ry="12" fill="#DDD6FE" opacity=".35"/>
      <path d="M16 106 q6 -40 22 -50 h44 q16 10 22 50 Z" fill="#EDE9FE" stroke="#A78BFA" stroke-width="3"/>
      <path d="M38 56 l22 26 22 -26 -6 -8 h-32 Z" fill="#C4B5FD"/>
      <circle cx="60" cy="34" r="20" fill="#F5D0B0"/>
      ${eyes(52, 68, 32, 3.8, '#312E81')}
      <path d="M40 42 q20 32 40 0 q-4 26 -20 26 -16 0 -20 -26 Z" fill="#F1F5F9"/>
      <path d="M38 26 q22 -20 44 0 q-4 -20 -22 -20 -18 0 -22 20 Z" fill="#E2E8F0"/>
      <path d="M36 22 q24 -14 48 0" stroke="#FBBF24" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M104 30 l-16 26 h12 l-12 26 26 -32 h-12 Z" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
      <path d="M12 66 q-8 14 4 24" stroke="#F5D0B0" stroke-width="11" fill="none" stroke-linecap="round"/>
      <circle cx="16" cy="94" r="9" fill="#FDE68A" opacity=".9"/>`),
  },
  {
    id: 'boss_w5',
    he: 'לוויתן המצולות',
    en: 'Abyssal Leviathan',
    world: 5,
    kind: 'boss',
    requires: { chest: 9, back: 8, legs: 8, shoulders: 8, arms: 9, core: 8 },
    hpMult: 5,
    atkMult: 0.9,
    def: 26,
    svg: sprite(`
      <path d="M4 96 q26 -14 40 -2 q16 14 34 0 q18 -14 38 -2" stroke="#0E7490" stroke-width="10"
        fill="none" stroke-linecap="round"/>
      <path d="M12 70 q22 -46 60 -44 q40 2 40 40 q0 34 -38 36 q-42 2 -62 -32 Z"
        fill="#155E75" stroke="#083344" stroke-width="4"/>
      <path d="M22 66 q26 -30 56 -24 q24 6 26 26 q-26 -18 -50 -12 -20 4 -32 10 Z" fill="#0E7490"/>
      <path d="M52 12 l6 -12 8 14 8 -12 4 16 Z" fill="#22D3EE" stroke="#083344" stroke-width="2.5"/>
      <path d="M28 88 q22 12 46 4 q-8 14 -26 14 -14 0 -20 -18 Z" fill="#E2E8F0"/>
      <path d="M32 90 l6 12 M46 94 l4 12 M62 94 l2 12 M76 88 l-2 12" stroke="#083344" stroke-width="2.5"/>
      ${eyes(44, 84, 54, 8, '#FDE68A')}
      <circle cx="44" cy="54" r="3.4" fill="#0B0F19"/><circle cx="84" cy="54" r="3.4" fill="#0B0F19"/>
      <path d="M112 40 q10 -10 6 -22 q-12 8 -18 14 Z" fill="#22D3EE"/>
      <circle cx="24" cy="30" r="5" fill="#A5F3FC" opacity=".8"/>
      <circle cx="38" cy="18" r="3.5" fill="#A5F3FC" opacity=".7"/>`),
  },
  {
    id: 'boss_w6',
    he: 'מלכת הכפור',
    en: 'Frost Queen',
    world: 6,
    kind: 'boss',
    requires: { chest: 9, back: 9, legs: 8, shoulders: 9, arms: 9, core: 8 },
    hpMult: 6.3,
    atkMult: 0.9,
    attackSlowMult: 1.2,
    svg: sprite(`
      <ellipse cx="60" cy="110" rx="44" ry="10" fill="#BAE6FD" opacity=".35"/>
      <path d="M20 110 q6 -56 26 -66 h28 q20 10 26 66 Z" fill="#DBEAFE" stroke="#60A5FA" stroke-width="4"/>
      <path d="M40 64 q20 16 40 0 l-6 30 q-14 10 -28 0 Z" fill="#93C5FD"/>
      <path d="M46 94 q14 8 28 0" stroke="#3B82F6" stroke-width="3" fill="none"/>
      <circle cx="60" cy="36" r="21" fill="#EFF6FF" stroke="#60A5FA" stroke-width="3"/>
      <path d="M34 24 l4 -20 8 14 14 -20 14 20 8 -14 4 20 Z" fill="#7DD3FC" stroke="#1D4ED8" stroke-width="2.5"/>
      ${eyes(51, 69, 36, 4.6, '#1D4ED8')}
      <path d="M50 48 q10 8 20 0" stroke="#1D4ED8" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M108 26 v78" stroke="#93C5FD" stroke-width="6" stroke-linecap="round"/>
      <path d="M108 14 v-12 M98 20 l20 12 M118 20 l-20 12" stroke="#E0F2FE" stroke-width="4" stroke-linecap="round"/>
      <path d="M10 62 q-10 16 2 30" stroke="#DBEAFE" stroke-width="11" fill="none" stroke-linecap="round"/>
      <circle cx="14" cy="98" r="7" fill="#7DD3FC"/>`),
  },
  {
    id: 'boss_w7',
    he: 'אדון הצללים',
    en: 'Shadow Lord',
    world: 7,
    kind: 'boss',
    requires: { chest: 9, back: 9, legs: 9, shoulders: 9, arms: 9, core: 9 },
    hpMult: 5.2,
    atkMult: 0.9,
    dodgeChance: 0.15,
    svg: sprite(`
      <ellipse cx="60" cy="112" rx="46" ry="8" fill="#7C3AED" opacity=".25"/>
      <path d="M14 112 q-6 -64 24 -80 q22 -14 44 0 q30 16 24 80 Z" fill="#1A1030" stroke="#08040F" stroke-width="4"/>
      <path d="M30 44 q30 -22 60 0 q-8 -28 -30 -28 -22 0 -30 28 Z" fill="#2E1F52"/>
      <ellipse cx="60" cy="48" rx="20" ry="17" fill="#120A24"/>
      ${eyes(50, 70, 48, 6, '#C084FC')}
      <circle cx="50" cy="48" r="12" fill="#C084FC" opacity=".18"/>
      <circle cx="70" cy="48" r="12" fill="#C084FC" opacity=".18"/>
      <path d="M44 68 l8 8 8 -8 8 8 8 -8" stroke="#C084FC" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
      <path d="M28 96 q32 -16 64 0" stroke="#6D28D9" stroke-width="4" fill="none"/>
      <path d="M104 18 v92" stroke="#3F3F46" stroke-width="5" stroke-linecap="round"/>
      <path d="M104 24 q-34 0 -46 26 q30 -12 46 2 Z" fill="#A78BFA" stroke="#4C1D95" stroke-width="3"/>
      <path d="M12 70 q-10 16 2 28" stroke="#2E1F52" stroke-width="10" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'boss_w8',
    he: 'מלאך הדין',
    en: 'Angel of Judgement',
    world: 8,
    kind: 'boss',
    requires: { chest: 10, back: 9, legs: 9, shoulders: 10, arms: 10, core: 9 },
    hpMult: 4,
    atkMult: 0.9,
    regenPct: 0.004,
    svg: sprite(`
      <ellipse cx="60" cy="112" rx="46" ry="9" fill="#FDE68A" opacity=".3"/>
      <path d="M8 100 q-14 -46 10 -66 q10 32 30 44 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
      <path d="M112 100 q14 -46 -10 -66 q-10 32 -30 44 Z" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="3"/>
      <path d="M26 112 q4 -58 34 -66 q30 8 34 66 Z" fill="#F1F5F9" stroke="#B45309" stroke-width="4"/>
      <path d="M44 62 h32 v46 h-32 Z" fill="#FDE68A"/>
      <path d="M48 74 h24 M48 88 h24" stroke="#B45309" stroke-width="3"/>
      <circle cx="60" cy="32" r="22" fill="#FDE7CE" stroke="#D9A066" stroke-width="3"/>
      <ellipse cx="60" cy="2" rx="19" ry="5" fill="none" stroke="#FBBF24" stroke-width="5"/>
      ${eyes(51, 69, 32, 5, '#FDE68A')}
      <circle cx="51" cy="32" r="2.4" fill="#0B0F19"/><circle cx="69" cy="32" r="2.4" fill="#0B0F19"/>
      <path d="M50 46 h20" stroke="#7C2D12" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M106 26 v84" stroke="#B45309" stroke-width="6" stroke-linecap="round"/>
      <path d="M106 8 l-14 22 h28 Z" fill="#FEF3C7" stroke="#B45309" stroke-width="3"/>
      <path d="M14 66 q-10 14 0 26" stroke="#FDE7CE" stroke-width="11" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'boss_w9',
    he: 'שר הגיהינום',
    en: 'Lord of Hell',
    world: 9,
    kind: 'boss',
    requires: { chest: 10, back: 10, legs: 9, shoulders: 10, arms: 10, core: 10 },
    hpMult: 4.2,
    atkMult: 0.85,
    critChance: 0.15,
    critMultiplier: 1.7,
    svg: sprite(`
      <ellipse cx="60" cy="112" rx="48" ry="9" fill="#F97316" opacity=".3"/>
      <path d="M6 88 q-12 -38 10 -54 q6 30 28 42 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="3"/>
      <path d="M114 88 q12 -38 -10 -54 q-6 30 -28 42 Z" fill="#7F1D1D" stroke="#450A0A" stroke-width="3"/>
      <path d="M22 112 q2 -58 32 -68 h12 q30 10 32 68 Z" fill="#991B1B" stroke="#450A0A" stroke-width="4"/>
      <path d="M40 60 q20 16 40 0 l-6 30 q-14 10 -28 0 Z" fill="#450A0A"/>
      <path d="M46 86 l7 8 7 -8 7 8 7 -8" stroke="#F97316" stroke-width="3" fill="none" stroke-linejoin="round"/>
      <circle cx="60" cy="32" r="23" fill="#DC2626" stroke="#450A0A" stroke-width="4"/>
      <path d="M32 16 q-18 -18 -8 -22 q16 6 20 20 Z" fill="#450A0A"/>
      <path d="M88 16 q18 -18 8 -22 q-16 6 -20 20 Z" fill="#450A0A"/>
      ${eyes(50, 70, 30, 6, '#FDE68A')}
      <circle cx="50" cy="30" r="12" fill="#F97316" opacity=".22"/>
      <circle cx="70" cy="30" r="12" fill="#F97316" opacity=".22"/>
      <path d="M46 46 l7 8 7 -8 7 8 7 -8" stroke="#FDE68A" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
      <path d="M108 22 v88" stroke="#292524" stroke-width="7" stroke-linecap="round"/>
      <path d="M108 6 l-16 26 h32 Z" fill="#F97316" stroke="#7C2D12" stroke-width="3"/>
      <path d="M10 66 q-10 16 2 28" stroke="#991B1B" stroke-width="11" fill="none" stroke-linecap="round"/>`),
  },
] as const;

/** Every boss id, oldest world first — the trophy shelf's order. */
export const BOSS_IDS: readonly string[] = WORLD_BOSSES.map((b) => b.id);

export function bossById(id: string): BossDef | undefined {
  return WORLD_BOSSES.find((b) => b.id === id);
}

export function worldBossOf(world: number): BossDef | undefined {
  return WORLD_BOSSES.find((b) => b.world === world);
}

export interface GateRequirement {
  readonly part: BodyPart;
  readonly need: number;
  readonly have: number;
  readonly met: boolean;
}

export interface GateStatus {
  readonly locked: boolean;
  readonly requirements: readonly GateRequirement[];
}

/**
 * Met/unmet state of a boss's body-part gate. Pure — the UI just renders it.
 * Phase 3 uses the same function for the world-boss screen.
 */
export function bossGateStatus(
  boss: BossDef | undefined,
  levels: Readonly<Record<BodyPart, number>>,
): GateStatus {
  if (!boss) return { locked: true, requirements: [] };
  const requirements: GateRequirement[] = [];
  for (const key of Object.keys(boss.requires) as BodyPart[]) {
    const need = boss.requires[key] ?? 0;
    if (need <= 0) continue;
    const have = levels[key] ?? 1;
    requirements.push({ part: key, need, have, met: have >= need });
  }
  return { locked: requirements.some((r) => !r.met), requirements };
}

/* ------------------------------------------------------------- equipment */

export type EquipmentSlot = 'gloves' | 'belt' | 'shoes' | 'cape';

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['gloves', 'belt', 'shoes', 'cape'] as const;

export const SLOT_HE: Readonly<Record<EquipmentSlot, string>> = {
  gloves: 'כפפות',
  belt: 'חגורה',
  shoes: 'נעליים',
  cape: 'גלימה',
};

export const SLOT_EMOJI: Readonly<Record<EquipmentSlot, string>> = {
  gloves: '🥊',
  belt: '🎗',
  shoes: '👟',
  cape: '🧣',
};

/**
 * A flat stat bonus. Added to the level-derived stat BEFORE the streak buff, so
 * gear and streak compound the way a player expects (see `deriveStats`).
 * `attackIntervalMs` is negative for "faster".
 */
export interface EquipBonus {
  readonly atk?: number;
  readonly def?: number;
  readonly hp?: number;
  readonly attackIntervalMs?: number;
  readonly critChance?: number;
  readonly critMultiplier?: number;
  readonly regen?: number;
}

export interface EquipmentDef {
  readonly id: string;
  readonly he: string;
  readonly en: string;
  readonly slot: EquipmentSlot;
  /** 1..3 — drives both the price band and how ornate the SVG layer is. */
  readonly tier: 1 | 2 | 3;
  /** Price in 🪙. */
  readonly cost: number;
  readonly bonus: EquipBonus;
  /** Main + accent colour, used by `ui/characterSvg.ts` to draw the layer. */
  readonly color: string;
  readonly accent: string;
  /** One-line Hebrew flavour for the shop card. */
  readonly note: string;
  /** 48×48 shop icon (inline SVG — offline rule). */
  readonly icon: string;
}

/** Wrap an icon's markup in a small square SVG. */
function icon(inner: string): string {
  return `<svg class="eq-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${inner}</svg>`;
}

/**
 * The shop roster: four slots × three tiers.
 *
 * PRICE TUNING — world 1's fifty waves pay ≈1 800 🪙 and each world multiplies
 * the payout by `BALANCE.combat.coins.worldMult`, on top of a large boss purse.
 * So tier 1 is affordable in the first world, tier 2 around its boss, and tier 3
 * during worlds 2–3. Each slot leans on a different stat family so that the four
 * pieces together cover the whole stat sheet.
 */
export const EQUIPMENT: readonly EquipmentDef[] = [
  /* --- gloves: attack & crit ------------------------------------------- */
  {
    id: 'gloves_1',
    he: 'כפפות אימון',
    en: 'Training Gloves',
    slot: 'gloves',
    tier: 1,
    cost: 120,
    bonus: { atk: 4 },
    color: '#475569',
    accent: '#94A3B8',
    note: 'אחיזה יציבה, אגרוף כבד יותר.',
    icon: icon(`<path d="M14 30 v-14 a4 4 0 0 1 8 0 v-4 a4 4 0 0 1 8 0 v4 a4 4 0 0 1 8 0 v16 a10 10 0 0 1 -10 10 h-8 a10 10 0 0 1 -10 -10 Z" fill="#475569" stroke="#94A3B8" stroke-width="2"/><path d="M14 26 h24" stroke="#94A3B8" stroke-width="2"/>`),
  },
  {
    id: 'gloves_2',
    he: 'כפפות עור',
    en: 'Leather Gloves',
    slot: 'gloves',
    tier: 2,
    cost: 520,
    bonus: { atk: 11, critChance: 0.03 },
    color: '#7C2D12',
    accent: '#F59E0B',
    note: 'עור אמיתי — ומכה שמרגישים.',
    icon: icon(`<path d="M14 30 v-14 a4 4 0 0 1 8 0 v-4 a4 4 0 0 1 8 0 v4 a4 4 0 0 1 8 0 v16 a10 10 0 0 1 -10 10 h-8 a10 10 0 0 1 -10 -10 Z" fill="#7C2D12" stroke="#F59E0B" stroke-width="2"/><path d="M14 26 h24" stroke="#F59E0B" stroke-width="2"/><circle cx="26" cy="33" r="3" fill="#F59E0B"/>`),
  },
  {
    id: 'gloves_3',
    he: 'כפפות האלופים',
    en: "Champions' Gloves",
    slot: 'gloves',
    tier: 3,
    cost: 1900,
    bonus: { atk: 26, critChance: 0.07, critMultiplier: 0.2 },
    color: '#B91C1C',
    accent: '#FDE68A',
    note: 'זהב על העור. כל מכה היא הצהרה.',
    icon: icon(`<path d="M14 30 v-14 a4 4 0 0 1 8 0 v-4 a4 4 0 0 1 8 0 v4 a4 4 0 0 1 8 0 v16 a10 10 0 0 1 -10 10 h-8 a10 10 0 0 1 -10 -10 Z" fill="#B91C1C" stroke="#FDE68A" stroke-width="2"/><path d="M14 26 h24" stroke="#FDE68A" stroke-width="2.5"/><path d="M26 29 l3 6 -6 0 Z" fill="#FDE68A"/>`),
  },

  /* --- belt: defence & HP ---------------------------------------------- */
  {
    id: 'belt_1',
    he: 'חגורת בד',
    en: 'Cloth Belt',
    slot: 'belt',
    tier: 1,
    cost: 120,
    bonus: { def: 4, hp: 15 },
    color: '#3F3F46',
    accent: '#A1A1AA',
    note: 'פשוטה, אבל הליבה מודה לה.',
    icon: icon(`<rect x="4" y="18" width="40" height="12" rx="3" fill="#3F3F46" stroke="#A1A1AA" stroke-width="2"/><rect x="18" y="14" width="12" height="20" rx="3" fill="#A1A1AA"/>`),
  },
  {
    id: 'belt_2',
    he: 'חגורת כוח',
    en: 'Power Belt',
    slot: 'belt',
    tier: 2,
    cost: 560,
    bonus: { def: 11, hp: 45 },
    color: '#1D4ED8',
    accent: '#93C5FD',
    note: 'עור עבה לסקוואט כבד.',
    icon: icon(`<rect x="4" y="16" width="40" height="16" rx="4" fill="#1D4ED8" stroke="#93C5FD" stroke-width="2"/><rect x="17" y="12" width="14" height="24" rx="4" fill="#93C5FD"/><circle cx="24" cy="24" r="3" fill="#1D4ED8"/>`),
  },
  {
    id: 'belt_3',
    he: 'חגורת אלוף עולם',
    en: 'World Champion Belt',
    slot: 'belt',
    tier: 3,
    cost: 2000,
    bonus: { def: 27, hp: 120 },
    color: '#78350F',
    accent: '#FBBF24',
    note: 'האבזם לבדו שוקל יותר מהמתחרים.',
    icon: icon(`<rect x="2" y="18" width="44" height="12" rx="3" fill="#78350F" stroke="#FBBF24" stroke-width="2"/><path d="M24 8 l14 8 v16 l-14 8 -14 -8 v-16 Z" fill="#FBBF24" stroke="#78350F" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#78350F"/>`),
  },

  /* --- shoes: attack speed & HP ---------------------------------------- */
  {
    id: 'shoes_1',
    he: 'נעלי ריצה',
    en: 'Running Shoes',
    slot: 'shoes',
    tier: 1,
    cost: 140,
    bonus: { attackIntervalMs: -70 },
    color: '#0E7490',
    accent: '#67E8F9',
    note: 'קלות. אתם פשוט מהירים יותר.',
    icon: icon(`<path d="M6 32 h20 l10 -10 q8 4 8 10 v4 h-38 Z" fill="#0E7490" stroke="#67E8F9" stroke-width="2"/><path d="M12 26 l6 6 M20 22 l6 6" stroke="#67E8F9" stroke-width="2" stroke-linecap="round"/>`),
  },
  {
    id: 'shoes_2',
    he: 'נעלי הרמה',
    en: 'Lifting Shoes',
    slot: 'shoes',
    tier: 2,
    cost: 620,
    bonus: { attackIntervalMs: -160, hp: 40 },
    color: '#166534',
    accent: '#86EFAC',
    note: 'עקב קשיח — יציבות שמתורגמת לקצב.',
    icon: icon(`<path d="M4 34 h22 l10 -12 q10 4 10 12 v4 h-42 Z" fill="#166534" stroke="#86EFAC" stroke-width="2"/><rect x="4" y="34" width="42" height="5" rx="2" fill="#86EFAC"/><path d="M14 28 l6 6 M22 24 l6 6" stroke="#86EFAC" stroke-width="2" stroke-linecap="round"/>`),
  },
  {
    id: 'shoes_3',
    he: 'כנפי הרמס',
    en: 'Hermes Wings',
    slot: 'shoes',
    tier: 3,
    cost: 2200,
    bonus: { attackIntervalMs: -300, hp: 90, regen: 2 },
    color: '#7C3AED',
    accent: '#FDE68A',
    note: 'האולימפוס משאיל לכם קצת מהירות.',
    icon: icon(`<path d="M6 34 h22 l10 -12 q10 4 10 12 v4 h-42 Z" fill="#7C3AED" stroke="#FDE68A" stroke-width="2"/><path d="M8 22 q-6 -8 2 -10 q2 8 10 8 Z" fill="#FDE68A"/><path d="M40 22 q6 -8 -2 -10 q-2 8 -10 8 Z" fill="#FDE68A"/>`),
  },

  /* --- cape: regen & all-round ----------------------------------------- */
  {
    id: 'cape_1',
    he: 'מגבת אימון',
    en: 'Gym Towel',
    slot: 'cape',
    tier: 1,
    cost: 150,
    bonus: { regen: 2 },
    color: '#0F766E',
    accent: '#5EEAD4',
    note: 'לא גלימה. עדיין עוזרת להתאושש.',
    icon: icon(`<path d="M12 8 h24 v26 l-6 -5 -6 5 -6 -5 -6 5 Z" fill="#0F766E" stroke="#5EEAD4" stroke-width="2"/><path d="M12 16 h24" stroke="#5EEAD4" stroke-width="2"/>`),
  },
  {
    id: 'cape_2',
    he: 'גלימת הרחוב',
    en: 'Street Cape',
    slot: 'cape',
    tier: 2,
    cost: 700,
    bonus: { regen: 5, atk: 6, def: 4 },
    color: '#9F1239',
    accent: '#FDA4AF',
    note: 'מתנפנפת גם כשאין רוח.',
    icon: icon(`<path d="M10 8 q14 8 28 0 v22 q-6 10 -14 10 -8 0 -14 -10 Z" fill="#9F1239" stroke="#FDA4AF" stroke-width="2"/><path d="M24 12 v28" stroke="#FDA4AF" stroke-width="2"/>`),
  },
  {
    id: 'cape_3',
    he: 'גלימת האולימפוס',
    en: 'Olympus Cloak',
    slot: 'cape',
    tier: 3,
    cost: 2400,
    bonus: { regen: 10, atk: 15, def: 15, hp: 60 },
    color: '#4C1D95',
    accent: '#FDE68A',
    note: 'נטווית מעננים. הבוסים מזהים אותה.',
    icon: icon(`<path d="M10 8 q14 8 28 0 v22 q-6 10 -14 10 -8 0 -14 -10 Z" fill="#4C1D95" stroke="#FDE68A" stroke-width="2"/><path d="M24 14 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" fill="#FDE68A"/>`),
  },
] as const;

export function equipmentById(id: string): EquipmentDef | undefined {
  return EQUIPMENT.find((e) => e.id === id);
}

export function equipmentForSlot(slot: EquipmentSlot): readonly EquipmentDef[] {
  return EQUIPMENT.filter((e) => e.slot === slot);
}

/** Every bonus field, resolved — the shape `deriveStats` consumes. */
export interface ResolvedBonus {
  atk: number;
  def: number;
  hp: number;
  attackIntervalMs: number;
  critChance: number;
  critMultiplier: number;
  regen: number;
}

export function zeroBonus(): ResolvedBonus {
  return { atk: 0, def: 0, hp: 0, attackIntervalMs: 0, critChance: 0, critMultiplier: 0, regen: 0 };
}

/**
 * Round to 4 decimals — enough to keep float noise out of a scaled bonus, and
 * fine enough not to distort the small ones: a crit chance is a fraction
 * (`0.03`), so rounding to 2 decimals would turn a +2 upgrade of it into a +3.
 */
function r4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * Every present field of a bonus, multiplied by `mult`.
 *
 * This is the one shape an equipment UPGRADE takes: an upgraded item is its own
 * bonus, scaled. Absent fields stay absent (a `+3` pair of shoes never sprouts a
 * crit chance it never had), so an item's identity — which stats it is about —
 * survives every upgrade level. The multiplier itself is balance, and comes from
 * `BALANCE.upgrades` via `core/upgrades.ts`; this file stays content-only.
 */
export function scaleBonus(b: EquipBonus, mult: number): EquipBonus {
  if (mult === 1) return b;
  const out: { -readonly [K in keyof EquipBonus]: number } = {};
  for (const key of Object.keys(b) as Array<keyof EquipBonus>) {
    const v = b[key];
    if (typeof v === 'number') out[key] = r4(v * mult);
  }
  return out;
}

/**
 * Sum the bonuses of a set of equipped item ids. Unknown ids are ignored.
 *
 * `mult` is the UPGRADE multiplier of one item (default: everything at +0, i.e.
 * exactly what this function always returned).
 */
export function sumEquipBonus(ids: Iterable<string>, mult: (itemId: string) => number = () => 1): ResolvedBonus {
  const out = zeroBonus();
  for (const id of ids) {
    const def = equipmentById(id);
    if (!def) continue;
    const b = scaleBonus(def.bonus, mult(id));
    out.atk += b.atk ?? 0;
    out.def += b.def ?? 0;
    out.hp += b.hp ?? 0;
    out.attackIntervalMs += b.attackIntervalMs ?? 0;
    out.critChance += b.critChance ?? 0;
    out.critMultiplier += b.critMultiplier ?? 0;
    out.regen += b.regen ?? 0;
  }
  return out;
}

/** Hebrew one-liner for an item's bonus, e.g. "+11 התקפה · +3% קריטי". */
export function bonusHe(b: EquipBonus): string {
  const parts: string[] = [];
  if (b.atk) parts.push(`+${b.atk} התקפה`);
  if (b.def) parts.push(`+${b.def} הגנה`);
  if (b.hp) parts.push(`+${b.hp} חיים`);
  if (b.attackIntervalMs) parts.push(`${b.attackIntervalMs < 0 ? '−' : '+'}${Math.abs(b.attackIntervalMs) / 1000}s מהירות`);
  if (b.critChance) parts.push(`+${Math.round(b.critChance * 100)}% קריטי`);
  if (b.critMultiplier) parts.push(`+${Math.round(b.critMultiplier * 100)}% נזק קריטי`);
  if (b.regen) parts.push(`+${b.regen} התאוששות`);
  return parts.join(' · ');
}

/* -------------------------------------------------- body-part skills (Phase 4) */

/**
 * The six ACTIVE abilities, one per body part.
 *
 * Content only, exactly like the rest of this file: identity, Hebrew copy and an
 * icon. Every number (unlock level, cooldown, multiplier, duration) lives in
 * `BALANCE.skills`, and the Hebrew sentence that quotes those numbers is built
 * by `skillSummaryHe()` in `core/combat.ts` — so a retune is one edit, and this
 * roster can never drift from the simulation.
 *
 * The order is the body-part order (`BODY_PARTS`), which is also the order the
 * skill bar renders in and the order an auto-pilot fires them in.
 */
export type SkillId = 'smash' | 'guard' | 'quake' | 'flurry' | 'focus' | 'breath';

export interface SkillDef {
  readonly id: SkillId;
  /** The body part whose level unlocks AND scales this skill. */
  readonly part: BodyPart;
  readonly he: string;
  readonly icon: string;
  /** Flavour, without numbers — the numbers come from BALANCE at render time. */
  readonly desc: string;
}

export const SKILLS: readonly SkillDef[] = [
  { id: 'smash', part: 'chest', he: 'מכת מחץ', icon: '🔨', desc: 'מכה אחת כבדה שמרסקת את האויב.' },
  { id: 'guard', part: 'back', he: 'עמידת ברזל', icon: '🛡️', desc: 'עמידה איתנה — הנזק הנכנס מצטמצם בחדות.' },
  { id: 'quake', part: 'legs', he: 'רעידת אדמה', icon: '🌋', desc: 'הקרקע רועדת: נזק ועצירה קצרה של האויב.' },
  { id: 'flurry', part: 'shoulders', he: 'סערת מהלומות', icon: '🌀', desc: 'רצף מהלומות — קצב ההתקפה מוכפל.' },
  { id: 'focus', part: 'arms', he: 'מכה מדויקת', icon: '🎯', desc: 'ההתקפה הבאה קריטית מובטחת, עם נזק מוגבר.' },
  { id: 'breath', part: 'core', he: 'נשימה עמוקה', icon: '🌬️', desc: 'ריפוי מיידי ועוד רגע של התאוששות מוגברת.' },
] as const;

export const SKILL_IDS: readonly SkillId[] = SKILLS.map((s) => s.id);

export function skillById(id: string): SkillDef | undefined {
  return SKILLS.find((s) => s.id === id);
}

/** The skill a body part owns (every part owns exactly one). */
export function skillForPart(part: BodyPart): SkillDef | undefined {
  return SKILLS.find((s) => s.part === part);
}
