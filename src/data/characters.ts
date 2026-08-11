/**
 * data/characters.ts — the character roster (the "who am I playing" layer).
 *
 * A character is PURE COSMETICS. It carries no bonus, no stat, no gate: the only
 * thing that ever makes the player stronger is training, and the only thing that
 * makes the drawing bigger is a body-part level. A character therefore declares
 * exactly two things:
 *
 *   1. `geometry` — WHICH body the level-driven proportions are drawn on
 *      (`male` = the original hero, `female` = a distinct silhouette). Both
 *      bodies scale from the same six part levels and expose the same equipment
 *      anchors, so gear fits either one.
 *   2. `palette` + `decor` — HOW that body is coloured and decorated.
 *
 * TWO BASE BODIES ARE FREE, FOREVER (`cost: 0`): representation is not a
 * purchase. Everything else is a skin bought with battle coins in the same
 * economy as the equipment shop (`data/gameContent.ts`).
 *
 * OFFLINE RULE, as everywhere else: no files, no fetches — the drawing itself is
 * built in `ui/characterSvg.ts` from these numbers.
 */

/** Which body the level-driven geometry is drawn on. */
export type BodyGeometry = 'male' | 'female';

/**
 * Head/face decoration of a skin. The geometry stays the body's; this is only
 * what is drawn on and around the head (plus, for `mask`, what is hidden).
 */
export type DecorKind = 'none' | 'ponytail' | 'visor' | 'helmet' | 'undead' | 'mask';

/**
 * Every colour the character drawing uses. The default body's values are
 * identical to the CSS custom properties in `styles/character.css`, so the
 * original hero renders exactly as it always did.
 */
export interface CharacterPalette {
  /** Torso gradient, top and bottom stop. */
  readonly torsoTop: string;
  readonly torsoBottom: string;
  /** Limbs + neck. */
  readonly body: string;
  /** Lats (the wide back shape behind the torso). */
  readonly bodyDark: string;
  /** Pecs/bust + deltoid caps. */
  readonly shade: string;
  /** Outlines, abs and feet. */
  readonly line: string;
  /** Head. */
  readonly skin: string;
  /** Eyes + mouth. */
  readonly eye: string;
}

export interface CharacterDecor {
  readonly kind: DecorKind;
  /** Main decoration colour (hair, helmet, visor housing…). */
  readonly main: string;
  /** Accent (crest, glow, headband…). */
  readonly accent: string;
}

export interface CharacterDef {
  readonly id: string;
  readonly he: string;
  readonly en: string;
  /** One-line Hebrew flavour for the roster card. */
  readonly note: string;
  /** Price in 🪙. **0 means a free base body** — never purchasable, always owned. */
  readonly cost: number;
  readonly geometry: BodyGeometry;
  readonly palette: CharacterPalette;
  readonly decor: CharacterDecor;
}

/** The original hero's palette — byte-identical to the CSS defaults. */
const CLASSIC: CharacterPalette = {
  torsoTop: '#5A76AE',
  torsoBottom: '#3B4E76',
  body: '#4A5F8C',
  bodyDark: '#3B4E76',
  shade: '#5C77B0',
  line: '#22304C',
  skin: '#C79B75',
  eye: '#1B2438',
};

/**
 * THE roster.
 *
 * PRICE TUNING — the same purse the equipment shop spends (world 1's fifty waves
 * pay ≈1 800 🪙). A skin is deliberately priced BESIDE the gear rather than
 * above it: the robot lands in world 1, the ninja around world 2–3, so choosing
 * "look" over "stats" is a real choice and never a wall. Nothing here changes a
 * single number in `deriveStats` — skins are pure cosmetics.
 */
export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'hero_m',
    he: 'לוחם המכון',
    en: 'Gym Warrior',
    note: 'הקלאסי. ברזל, זיעה והתמדה.',
    cost: 0,
    geometry: 'male',
    palette: CLASSIC,
    decor: { kind: 'none', main: '#2A3350', accent: '#5C77B0' },
  },
  {
    id: 'hero_f',
    he: 'לוחמת המכון',
    en: 'Gym Warrior (F)',
    note: 'אותו כוח, סילואט אחר. חינם, תמיד.',
    cost: 0,
    geometry: 'female',
    palette: CLASSIC,
    decor: { kind: 'ponytail', main: '#6B3A2E', accent: '#8C4E3C' },
  },
  {
    id: 'robot',
    he: 'רובוט מתאמן',
    en: 'Training Robot',
    note: 'לא נושם, לא מתלונן. הסוללה עוד לא נגמרה.',
    cost: 400,
    geometry: 'male',
    palette: {
      torsoTop: '#8695A8',
      torsoBottom: '#4E5B6E',
      body: '#6B7A90',
      bodyDark: '#4E5B6E',
      shade: '#94A3B8',
      line: '#2A3444',
      skin: '#B9C4D4',
      eye: '#22D3EE',
    },
    decor: { kind: 'visor', main: '#2A3444', accent: '#22D3EE' },
  },
  {
    id: 'spartan',
    he: 'לוחם עתיק',
    en: 'Ancient Warrior',
    note: 'ברונזה, קסדה, וקרב אחד ארוך מאוד.',
    cost: 900,
    geometry: 'male',
    palette: {
      torsoTop: '#C1794A',
      torsoBottom: '#8A4F2C',
      body: '#A9663C',
      bodyDark: '#8A4F2C',
      shade: '#C68A5C',
      line: '#4A2413',
      skin: '#C79B75',
      eye: '#1B2438',
    },
    decor: { kind: 'helmet', main: '#B08D57', accent: '#B91C1C' },
  },
  {
    id: 'zombie',
    he: 'זומבי מתאמן',
    en: 'Gym Zombie',
    note: 'כבר מת בסט האחרון. עדיין מסיים את התוכנית.',
    cost: 1400,
    geometry: 'male',
    palette: {
      torsoTop: '#6E8F5E',
      torsoBottom: '#47603C',
      body: '#5E7C50',
      bodyDark: '#47603C',
      shade: '#7FA36A',
      line: '#26331F',
      skin: '#8FAE74',
      eye: '#FDE68A',
    },
    decor: { kind: 'undead', main: '#3B4A2C', accent: '#26331F' },
  },
  {
    id: 'ninja',
    he: 'נינג׳ת צללים',
    en: 'Shadow Ninja',
    note: 'מרימה כבד בשקט מוחלט. לא רואים אותה מגיעה.',
    cost: 1800,
    geometry: 'female',
    palette: {
      torsoTop: '#3B4152',
      torsoBottom: '#23283A',
      body: '#2F3444',
      bodyDark: '#23283A',
      shade: '#454B60',
      line: '#14161F',
      skin: '#C79B75',
      eye: '#F1F5F9',
    },
    decor: { kind: 'mask', main: '#14161F', accent: '#EF4444' },
  },
] as const;

/** The character every fresh install plays — the original hero. */
export const DEFAULT_CHARACTER_ID = 'hero_m';

export function characterById(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/** The default definition, never undefined (the roster is code, not data). */
export function defaultCharacter(): CharacterDef {
  return characterById(DEFAULT_CHARACTER_ID) ?? (CHARACTERS[0] as CharacterDef);
}

/** A free base body: always owned, never purchasable. */
export function isBaseCharacter(id: string): boolean {
  const def = characterById(id);
  return def !== undefined && def.cost === 0;
}

/** The two free bodies, in roster order. */
export const BASE_CHARACTERS: readonly CharacterDef[] = CHARACTERS.filter((c) => c.cost === 0);

/** The purchasable skins, in roster (= price) order. */
export const CHARACTER_SKINS: readonly CharacterDef[] = CHARACTERS.filter((c) => c.cost > 0);
