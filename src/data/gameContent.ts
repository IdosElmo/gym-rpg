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
 * PHASE 3 hooks (deliberately left thin):
 *   - `WORLD_BOSSES` has one stub boss per world with a body-part `requires`
 *     gate; `bossGateStatus()` already reports met/unmet per part so the gate
 *     card can be rendered. Phase 3 fleshes out stats, sprites and rewards.
 *   - `EQUIPMENT` is still empty — the shop is Phase 3.
 */

import type { BodyPart } from './program.ts';

/* ------------------------------------------------------------------ worlds */

export interface WorldDef {
  readonly id: number;
  readonly he: string;
  readonly en: string;
  /** One-line Hebrew flavour, shown under the world name in the arena. */
  readonly tagline: string;
  /** Accent colour of the arena backdrop — extends, never replaces, the palette. */
  readonly accent: string;
  /** Two stops for the arena's radial background. */
  readonly bg: readonly [string, string];
}

/** The four launch worlds, per the brief. */
export const WORLDS: readonly WorldDef[] = [
  {
    id: 1,
    he: 'חדר כושר נטוש',
    en: 'Abandoned Gym',
    tagline: 'ברזל חלוד, אבק ומכונות ששכחו מזמן',
    accent: '#3B82F6',
    bg: ['#24304A', '#151E2E'],
  },
  {
    id: 2,
    he: 'הרחוב',
    en: 'The Street',
    tagline: 'אספלט, ניאון וכלבים שלא אוהבים זרים',
    accent: '#10B981',
    bg: ['#1E3A34', '#141E22'],
  },
  {
    id: 3,
    he: 'הזירה',
    en: 'The Arena',
    tagline: 'חול, קהל צמא דם והרבה מאוד רעש',
    accent: '#F59E0B',
    bg: ['#3A2C1B', '#1F1810'],
  },
  {
    id: 4,
    he: 'הר האולימפוס',
    en: 'Mount Olympus',
    tagline: 'מעל העננים נלחמים רק אלה שהתאמנו באמת',
    accent: '#A78BFA',
    bg: ['#312A55', '#191428'],
  },
] as const;

export function worldById(id: number): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? (WORLDS[0] as WorldDef);
}

/** Total number of worlds — Phase 3 grows this list, nothing else changes. */
export const WORLD_COUNT = WORLDS.length;

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
  /** Inline SVG markup for the sprite (no external files — offline rule). */
  readonly svg: string;
}

export interface BossDef extends EnemyDef {
  readonly kind: 'boss';
  /** Body-part levels required to challenge this boss. */
  readonly requires: Partial<Record<BodyPart, number>>;
}

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

/* --------------------------------------------------------------- rosters */

const ROSTERS: Readonly<Record<number, { regular: readonly EnemyDef[]; mini: EnemyDef }>> = {
  1: { regular: W1, mini: W1_MINI },
  2: { regular: W2, mini: W2_MINI },
  3: { regular: W3, mini: W3_MINI },
  4: { regular: W4, mini: W4_MINI },
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

/* ---------------------------------------------------- world bosses (stub) */

/**
 * PHASE 3 STUB — one boss per world with its body-part gate. The gate numbers
 * are already meaningful (they rise with the world); the fights, rewards and
 * trophies are Phase 3's job.
 */
export const WORLD_BOSSES: readonly BossDef[] = [
  {
    id: 'boss_w1',
    he: 'מאמן הצללים',
    en: 'Shadow Coach',
    world: 1,
    kind: 'boss',
    requires: { chest: 5, legs: 4 },
    hpMult: 6,
    atkMult: 2,
    svg: sprite(`
      <path d="M30 104 V50 a30 30 0 0 1 60 0 v54 Z" fill="#1F2937" stroke="#0B0F19" stroke-width="3"/>
      <circle cx="60" cy="36" r="18" fill="#111827"/>
      ${eyes(53, 67, 36, 4, '#EF4444')}
      <path d="M26 60 l-14 10 M94 60 l14 10" stroke="#374151" stroke-width="7" stroke-linecap="round"/>`),
  },
  {
    id: 'boss_w2',
    he: 'שליט הרחוב',
    en: 'Street Overlord',
    world: 2,
    kind: 'boss',
    requires: { back: 6, arms: 5 },
    hpMult: 7,
    atkMult: 2.2,
    svg: sprite(`
      <path d="M28 104 V54 a32 32 0 0 1 64 0 v50 Z" fill="#064E3B" stroke="#022C22" stroke-width="3"/>
      <circle cx="60" cy="36" r="19" fill="#C79B75"/>
      ${eyes(52, 68, 34, 4, '#10B981')}
      <path d="M38 22 h44 v8 h-44 Z" fill="#0F766E"/>`),
  },
  {
    id: 'boss_w3',
    he: 'אלוף האלופים',
    en: 'Champion of Champions',
    world: 3,
    kind: 'boss',
    requires: { shoulders: 7, core: 6 },
    hpMult: 8,
    atkMult: 2.4,
    svg: sprite(`
      <path d="M26 104 V54 a34 34 0 0 1 68 0 v50 Z" fill="#7C2D12" stroke="#431407" stroke-width="3"/>
      <circle cx="60" cy="34" r="20" fill="#F59E0B"/>
      ${eyes(52, 68, 34, 4, '#1B2438')}
      <path d="M60 6 v10 M40 12 l6 10 M80 12 l-6 10" stroke="#FBBF24" stroke-width="5" stroke-linecap="round"/>`),
  },
  {
    id: 'boss_w4',
    he: 'זאוס',
    en: 'Zeus',
    world: 4,
    kind: 'boss',
    requires: { chest: 8, back: 8, legs: 8, shoulders: 8, arms: 8, core: 8 },
    hpMult: 10,
    atkMult: 2.8,
    svg: sprite(`
      <path d="M24 104 V54 a36 36 0 0 1 72 0 v50 Z" fill="#312E81" stroke="#1E1B4B" stroke-width="3"/>
      <circle cx="60" cy="32" r="21" fill="#E9D5FF"/>
      ${eyes(52, 68, 32, 4, '#312E81')}
      <path d="M60 2 l-10 20 h12 l-8 18 22 -22 h-12 Z" fill="#F59E0B"/>`),
  },
] as const;

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

/* ------------------------------------------------------- equipment (P3) */

export type EquipmentSlot = 'gloves' | 'belt' | 'shoes' | 'cape';

export interface EquipmentDef {
  readonly id: string;
  readonly he: string;
  readonly slot: EquipmentSlot;
  readonly cost: number;
  readonly svg: string;
}

/** TODO(phase 3): the coin shop. Coins are already earned + persisted. */
export const EQUIPMENT: readonly EquipmentDef[] = [];
