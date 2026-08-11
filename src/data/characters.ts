/**
 * data/characters.ts — the character roster (the "who am I playing" layer).
 *
 * A character is PURE COSMETICS. It carries no bonus, no stat, no gate: the only
 * thing that ever makes the player stronger is training, and the only thing that
 * makes the drawing bigger is a body-part level.
 *
 * THE MODEL IS A MATRIX: **body × skin**.
 *
 *   - a BODY (`male` | `female`) is the silhouette the level-driven proportions
 *     are drawn on. Both bodies scale from the same six part levels and expose
 *     the same equipment anchors, so gear fits either one. Bodies are FREE and
 *     always available — representation is not a purchase;
 *   - a SKIN (`hero`, `robot`, `spartan`, `zombie`, `ninja`) is a palette plus a
 *     per-body look (head decor + hair). **One purchase unlocks the skin on BOTH
 *     bodies** — you buy the look, not the body wearing it.
 *
 * Every playable combination is a `CharacterDef` with the composite id
 * `<skin>_<m|f>` (`hero_m`, `hero_f`, `robot_m`, `robot_f`, …). Those two first
 * ids are byte-identical to the ones the single-body roster shipped, which is
 * why an old `character_selected` event still names something real; the four
 * bare skin ids the old roster used (`robot`, `spartan`, `zombie`, `ninja`) are
 * mapped onto the body each of them was authored for (`nativeBody`) — see
 * `resolveCharacterId`.
 *
 * OFFLINE RULE, as everywhere else: no files, no fetches — the drawing itself is
 * built in `ui/characterSvg.ts` from these numbers.
 */

/** Which body the level-driven geometry is drawn on. */
export type BodyGeometry = 'male' | 'female';

/** The two bodies, in toggle order. */
export const BODY_GEOMETRIES: readonly BodyGeometry[] = ['male', 'female'];

/** Hebrew label of a body, for the דמות screen's toggle. */
export const BODY_HE: Readonly<Record<BodyGeometry, string>> = { male: 'גבר', female: 'אישה' };

/** One-glyph mark of a body — the toggle reads at a glance before the word does. */
export const BODY_EMOJI: Readonly<Record<BodyGeometry, string>> = { male: '🧔', female: '👩' };

/** The body a fresh install plays (the original hero's). */
export const DEFAULT_BODY: BodyGeometry = 'male';

/**
 * The head COVERING of a skin — helmet, visor, wrap. Drawn over the skull (and,
 * for `mask`/`visor`, hiding the face features it covers).
 */
export type DecorKind = 'none' | 'visor' | 'helmet' | 'undead' | 'mask';

/**
 * The HAIR under that covering, drawn as its own layer so the two compose:
 * a spartan helmet can sit on a braid, a zombie can keep tattered curls.
 *
 *   `curls`  — the long cascading curl cloud (the female base look)
 *   `ragged` — the same cloud, thinned and torn (the undead one)
 *   `tied`   — pulled back into a tail (fits under a wrap or a helmet)
 */
export type HairKind = 'none' | 'curls' | 'ragged' | 'tied';

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
  /** Main decoration colour (helmet, visor housing…). */
  readonly main: string;
  /** Accent (crest, glow, headband…). */
  readonly accent: string;
}

export interface CharacterHair {
  readonly kind: HairKind;
  /** Main hair colour. */
  readonly main: string;
  /** Highlight curls / ribbon. */
  readonly accent: string;
}

/** How one skin looks on ONE body: its Hebrew name, its covering and its hair. */
export interface SkinLook {
  /** Gendered Hebrew name of this combination ("לוחמת המכון", "זומבי מתאמן"…). */
  readonly he: string;
  readonly decor: CharacterDecor;
  readonly hair: CharacterHair;
}

/**
 * A SKIN — the purchasable unit. One price, both bodies.
 *
 * `palette` is body-independent (a robot is steel on either silhouette); only
 * the head look changes, because a helmet on a smaller skull and a curl cloud
 * under a wrap are genuinely different drawings.
 */
export interface SkinDef {
  readonly id: string;
  /** Short label for the skin card ("רובוט", "לוחם עתיק"). */
  readonly he: string;
  readonly en: string;
  /** One-line Hebrew flavour for the card and the purchase sheet. */
  readonly note: string;
  /** Price in 🪙. **0 means the free base skin** — never purchasable. */
  readonly cost: number;
  /**
   * The body this skin was SOLD ON before the roster went dual-body. Used for
   * exactly one thing: mapping a legacy `character_selected: 'ninja'` onto the
   * combination the player was actually looking at back then.
   */
  readonly nativeBody: BodyGeometry;
  readonly palette: CharacterPalette;
  readonly look: Readonly<Record<BodyGeometry, SkinLook>>;
}

/** ONE playable combination: a body wearing a skin. */
export interface CharacterDef {
  /** `<skin>_<m|f>` — `hero_m`, `robot_f`, … */
  readonly id: string;
  /** Which skin this is a combination of (the ownership unit). */
  readonly skin: string;
  readonly he: string;
  readonly en: string;
  readonly note: string;
  /** The skin's price — identical on both bodies. */
  readonly cost: number;
  readonly geometry: BodyGeometry;
  readonly palette: CharacterPalette;
  readonly decor: CharacterDecor;
  readonly hair: CharacterHair;
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

const NO_DECOR: CharacterDecor = { kind: 'none', main: '#2A3350', accent: '#5C77B0' };
const NO_HAIR: CharacterHair = { kind: 'none', main: '#2A3350', accent: '#5C77B0' };

/**
 * THE roster, as skins.
 *
 * PRICE TUNING — the same purse the equipment shop spends (world 1's fifty waves
 * pay ≈1 800 🪙). A skin is deliberately priced BESIDE the gear rather than
 * above it: the robot lands in world 1, the ninja around world 2–3, so choosing
 * "look" over "stats" is a real choice and never a wall. Nothing here changes a
 * single number in `deriveStats` — skins are pure cosmetics.
 *
 * PER-BODY LOOK CHOICES (the interesting column below):
 *   hero    — male: bare head, as it always was. female: the long curl cloud.
 *   robot   — a chassis has no hair on either body; the silhouette does the
 *             talking, the visor and antenna are identical.
 *   spartan — the helmet covers the crown, so the male keeps a bare nape and the
 *             female gets a tied braid escaping behind it (the helmet would hide
 *             a curl cloud entirely and the silhouette would lose the body).
 *   zombie  — male keeps the stitched scalp + tuft; the female adds RAGGED
 *             curls: the same cloud, thinned and torn.
 *   ninja   — the wrap needs the hair pulled back on BOTH bodies (a loose cloud
 *             would push out past the mask and break its silhouette), so both
 *             wear the tied tail the ninja always had.
 */
export const SKINS: readonly SkinDef[] = [
  {
    id: 'hero',
    he: 'הבסיס',
    en: 'Gym Warrior',
    note: 'הקלאסי. ברזל, זיעה והתמדה.',
    cost: 0,
    nativeBody: 'male',
    palette: CLASSIC,
    look: {
      male: { he: 'לוחם המכון', decor: NO_DECOR, hair: NO_HAIR },
      female: {
        he: 'לוחמת המכון',
        decor: NO_DECOR,
        hair: { kind: 'curls', main: '#6B3A2E', accent: '#A9613F' },
      },
    },
  },
  {
    id: 'robot',
    he: 'רובוט',
    en: 'Training Robot',
    note: 'לא נושם, לא מתלונן. הסוללה עוד לא נגמרה.',
    cost: 400,
    nativeBody: 'male',
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
    look: {
      male: {
        he: 'רובוט מתאמן',
        decor: { kind: 'visor', main: '#2A3444', accent: '#22D3EE' },
        hair: NO_HAIR,
      },
      female: {
        he: 'רובוטית מתאמנת',
        decor: { kind: 'visor', main: '#2A3444', accent: '#22D3EE' },
        hair: NO_HAIR,
      },
    },
  },
  {
    id: 'spartan',
    he: 'לוחם עתיק',
    en: 'Ancient Warrior',
    note: 'ברונזה, קסדה, וקרב אחד ארוך מאוד.',
    cost: 900,
    nativeBody: 'male',
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
    look: {
      male: {
        he: 'לוחם עתיק',
        decor: { kind: 'helmet', main: '#B08D57', accent: '#B91C1C' },
        hair: NO_HAIR,
      },
      female: {
        he: 'לוחמת עתיקה',
        decor: { kind: 'helmet', main: '#B08D57', accent: '#B91C1C' },
        hair: { kind: 'tied', main: '#4A2413', accent: '#7A4526' },
      },
    },
  },
  {
    id: 'zombie',
    he: 'זומבי',
    en: 'Gym Zombie',
    note: 'כבר מת בסט האחרון. עדיין מסיים את התוכנית.',
    cost: 1400,
    nativeBody: 'male',
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
    look: {
      male: {
        he: 'זומבי מתאמן',
        decor: { kind: 'undead', main: '#3B4A2C', accent: '#26331F' },
        hair: NO_HAIR,
      },
      female: {
        he: 'זומבית מתאמנת',
        decor: { kind: 'undead', main: '#3B4A2C', accent: '#26331F' },
        hair: { kind: 'ragged', main: '#3B4A2C', accent: '#7FA36A' },
      },
    },
  },
  {
    id: 'ninja',
    he: 'נינג׳ה',
    en: 'Shadow Ninja',
    note: 'מרים כבד בשקט מוחלט. לא רואים אותו מגיע.',
    cost: 1800,
    nativeBody: 'female',
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
    look: {
      male: {
        he: 'נינג׳ת צללים',
        decor: { kind: 'mask', main: '#14161F', accent: '#EF4444' },
        hair: { kind: 'tied', main: '#14161F', accent: '#454B60' },
      },
      female: {
        he: 'נינג׳ת צללים',
        decor: { kind: 'mask', main: '#14161F', accent: '#EF4444' },
        hair: { kind: 'tied', main: '#14161F', accent: '#454B60' },
      },
    },
  },
] as const;

/** The free skin every install starts with. */
export const DEFAULT_SKIN_ID = 'hero';

/** The character every fresh install plays — the original hero. */
export const DEFAULT_CHARACTER_ID = 'hero_m';

/** Short body tag used inside a composite id. */
function bodyTag(body: BodyGeometry): string {
  return body === 'female' ? 'f' : 'm';
}

/** The composite id of one combination (`characterId('robot', 'female')` → `robot_f`). */
export function characterId(skinId: string, body: BodyGeometry): string {
  return `${skinId}_${bodyTag(body)}`;
}

export function skinById(id: string): SkinDef | undefined {
  return SKINS.find((s) => s.id === id);
}

/**
 * Every playable combination, skin-major (so the roster reads as a price ladder
 * and each body's variants stay adjacent).
 */
export const CHARACTERS: readonly CharacterDef[] = SKINS.flatMap((skin) =>
  BODY_GEOMETRIES.map((body): CharacterDef => {
    const look = skin.look[body];
    return {
      id: characterId(skin.id, body),
      skin: skin.id,
      he: look.he,
      en: `${skin.en}${body === 'female' ? ' (F)' : ''}`,
      note: skin.note,
      cost: skin.cost,
      geometry: body,
      palette: skin.palette,
      decor: look.decor,
      hair: look.hair,
    };
  }),
);

export function characterById(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/**
 * LEGACY BRIDGE — turn any id an event or a stored blob may hold into a
 * canonical composite id.
 *
 * Three shapes arrive here:
 *   1. a composite id (`hero_f`, `robot_m`) — used as-is;
 *   2. `hero_m` / `hero_f`, which the single-body roster already wrote and which
 *      happen to BE composite ids: female base body → female body + hero skin;
 *   3. a bare skin id (`robot`, `spartan`, `zombie`, `ninja`), which the
 *      single-body roster used for a skin that existed on exactly ONE body. It
 *      maps to that body (`nativeBody`) — the least surprising reading, because
 *      it is literally the drawing the player was looking at when the event was
 *      written: `robot` → `robot_m`, `ninja` → `ninja_f`.
 *
 * Anything else returns `undefined` — the caller falls back to the default hero.
 */
export function resolveCharacterId(id: string): string | undefined {
  if (characterById(id)) return id;
  const skin = skinById(id);
  return skin ? characterId(skin.id, skin.nativeBody) : undefined;
}

/** `characterById`, but tolerant of every legacy id shape. */
export function characterByAnyId(id: string): CharacterDef | undefined {
  const resolved = resolveCharacterId(id);
  return resolved === undefined ? undefined : characterById(resolved);
}

/**
 * The SKIN an ownership-shaped id refers to.
 *
 * A `character_purchased` payload holds a skin id (`robot`) — that is what the
 * old roster wrote and what the new one writes, so old logs need no rewriting.
 * A composite id is accepted too and reduced to its skin, so a purchase minted
 * by any build of the app unlocks the same thing.
 */
export function skinOf(id: string): SkinDef | undefined {
  return skinById(id) ?? skinById(characterById(id)?.skin ?? '');
}

/** The default definition, never undefined (the roster is code, not data). */
export function defaultCharacter(): CharacterDef {
  return characterById(DEFAULT_CHARACTER_ID) ?? (CHARACTERS[0] as CharacterDef);
}

/** A free skin: always owned, never purchasable. */
export function isBaseSkin(id: string): boolean {
  const skin = skinById(id);
  return skin !== undefined && skin.cost === 0;
}

/** A free combination: always playable (both bodies of the free skin). */
export function isBaseCharacter(id: string): boolean {
  const def = characterById(id);
  return def !== undefined && def.cost === 0;
}

/** The free combinations, in roster order — the two base bodies. */
export const BASE_CHARACTERS: readonly CharacterDef[] = CHARACTERS.filter((c) => c.cost === 0);

/** The purchasable SKINS, in roster (= price) order. */
export const CHARACTER_SKINS: readonly SkinDef[] = SKINS.filter((s) => s.cost > 0);
