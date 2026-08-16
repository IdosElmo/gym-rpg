/**
 * ui/characterSvg.ts — the layered inline SVG character.
 *
 * PURE string builder (no DOM), so the geometry is unit-testable: every
 * proportion is a clamped function of a body-part level.
 *
 *   chest     -> pec/bust mass + upper-torso width
 *   back      -> lat flare, i.e. the whole upper silhouette gets wider
 *   shoulders -> shoulder span + deltoid caps
 *   arms      -> arm thickness + bicep bulge
 *   legs      -> thigh/calf thickness + hip width
 *   core      -> waist tightens (V-taper) and the abs get more defined
 *
 * Growth is clamped at `BALANCE.character.visualMaxLevel`, so a very high level
 * stays a charming cartoon rather than a blob.
 *
 * THE ROSTER (`data/characters.ts`) is a body × skin matrix, and it rides on
 * exactly three knobs:
 *   - `geometry` picks the BODY the proportions above are drawn on (`male` —
 *     the original hero — or `female`). Both bodies read the same six levels and
 *     expose the same `characterAnchors`, so every equipment layer fits either
 *     one without a second set of shapes;
 *   - `palette` recolours that body — one palette per skin, both bodies;
 *   - `decor` + `hair` redecorate the head. They are TWO layers on purpose: the
 *     covering (helmet, visor, wrap) is the skin's and is identical on both
 *     bodies, while the hair underneath is chosen per body, which is what lets
 *     one purchase dress a male AND a female character convincingly.
 * A skin never touches a proportion, and no character touches a stat: the
 * roster is cosmetic, full stop. The default (`hero_m`) renders exactly what it
 * always did — the palette below is the same one `styles/character.css` declares.
 *
 * LAYERS (draw order) — equipment hangs off the anchors in `characterAnchors`:
 *   shadow · [cape] · hair cascade · legs · lats · torso · pecs · abs · arms ·
 *   deltoids · head (hair · helmet/visor/wrap) · [shoes · belt · gloves] ·
 *   trophy medals
 * The cape and the long hair's cascade are the two layers drawn BEFORE the body:
 * a cape hangs behind everything, and long hair falls behind the torso — but in
 * front of the cape, because hair rests on a cape rather than vanishing under it.
 * The cape is the one piece drawn BEFORE the body (it hangs behind it); every
 * other slot is worn on top. Every body group carries `data-part`, which is all
 * the level-up pulse and any part-targeted effect needs.
 */

import { BALANCE } from '../core/balance.ts';
import { clampUpgradeLevel } from '../core/upgrades.ts';
import { clamp } from '../core/xp.ts';
import {
  characterByAnyId,
  defaultCharacter,
  type BodyGeometry,
  type CharacterDecor,
  type CharacterDef,
  type CharacterHair,
} from '../data/characters.ts';
import {
  EQUIPMENT_SLOTS,
  equipmentById,
  type BossDef,
  type EquipmentDef,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { BODY_PARTS, type BodyPart } from '../data/program.ts';
import type { PartsProgress } from '../storage/DataStore.ts';

/* ------------------------------------------------------------- geometry */

const CX = 100;
const HEAD_CY = 42;
const SHOULDER_Y = 84;
const CHEST_Y = 108;
const WAIST_Y = 152;
const HIP_Y = 172;
const KNEE_Y = 236;
const ANKLE_Y = 292;
const ELBOW_Y = 146;
const HAND_Y = 194;

/** 0 at level 1, 1 at the visual cap — the single knob every proportion uses. */
export function growth(level: number): number {
  const max = Math.max(2, BALANCE.character.visualMaxLevel);
  return clamp((level - 1) / (max - 1), 0, 1);
}

export interface CharacterGeometry {
  headR: number;
  neckHalf: number;
  shoulderHalf: number;
  deltoidR: number;
  chestHalf: number;
  waistHalf: number;
  hipHalf: number;
  latFlare: number;
  pecRx: number;
  pecRy: number;
  /** Vertical centre of the pec/bust pair (a female bust sits a little lower). */
  pecY: number;
  /** How far apart the pair sits, as a fraction of `chestHalf`. */
  pecSpread: number;
  armW: number;
  bicepR: number;
  thighW: number;
  calfW: number;
  /** Multiplier on how far the legs stand from the centre line. */
  legSpread: number;
  absOpacity: number;
}

/**
 * ONE body's proportion table: every number the geometry above is built from.
 *
 * The `male` row IS the original hero, digit for digit — the variant table was
 * introduced by extracting those constants, not by re-tuning them, so the
 * default drawing is unchanged. `female` is a genuinely different silhouette
 * (narrower shoulders, wider hips, a tighter waist, a rounder and slightly lower
 * bust, lighter limbs) that reads from exactly the same six levels: training
 * chest still grows the chest, training legs still thickens the thighs.
 */
interface BodySpec {
  headR: number;
  neck: readonly [base: number, perShoulders: number];
  shoulder: readonly [base: number, perShoulders: number, perBack: number];
  deltoid: readonly [base: number, perShoulders: number];
  chest: readonly [base: number, perChest: number, perBack: number];
  waist: readonly [base: number, perCore: number, perChest: number, perBack: number];
  waistClamp: readonly [min: number, max: number];
  hip: readonly [base: number, perLegs: number];
  lat: readonly [base: number, perBack: number];
  pecRx: readonly [base: number, perChest: number];
  pecRy: readonly [base: number, perChest: number];
  /** Pixels the bust sits below `CHEST_Y`, and its spread as a share of chestHalf. */
  pecDrop: number;
  pecSpread: number;
  arm: readonly [base: number, perArms: number, perShoulders: number];
  bicep: readonly [base: number, perArms: number];
  thigh: readonly [base: number, perLegs: number];
  calf: readonly [base: number, perLegs: number];
  legSpread: number;
  abs: readonly [base: number, perCore: number];
}

const BODIES: Readonly<Record<BodyGeometry, BodySpec>> = {
  male: {
    headR: 18,
    neck: [8, 3],
    shoulder: [30, 15, 7],
    deltoid: [10, 7],
    chest: [26, 13, 7],
    waist: [25, 7, 3, 2],
    waistClamp: [15, 34],
    hip: [25, 4],
    lat: [4, 16],
    pecRx: [10, 6],
    pecRy: [6, 3.5],
    pecDrop: 0,
    pecSpread: 0.44,
    arm: [10, 9, 2],
    bicep: [5, 4.5],
    thigh: [16, 10],
    calf: [11, 6],
    legSpread: 1,
    abs: [0.18, 0.62],
  },
  female: {
    headR: 17,
    neck: [6.5, 2.5],
    shoulder: [26, 12, 6],
    deltoid: [8.5, 6],
    chest: [24, 11, 6],
    waist: [21, 6, 2.5, 1.8],
    waistClamp: [13, 30],
    // Hips are WIDER than the shoulder base — that inversion is the silhouette.
    hip: [30, 4.5],
    lat: [3.5, 13],
    pecRx: [8.5, 4.5],
    pecRy: [7.5, 4],
    pecDrop: 4,
    pecSpread: 0.5,
    arm: [8.5, 7.5, 1.8],
    bicep: [4, 4],
    thigh: [15, 9.5],
    calf: [10, 5.5],
    // Wider hips must not splay the legs — they stay under the body.
    legSpread: 0.85,
    abs: [0.16, 0.6],
  },
};

/**
 * Turn the six part levels into the drawing's proportions.
 *
 * `body` picks the silhouette (`'male'` — the default and the original — or
 * `'female'`); every proportion still comes from the levels alone.
 */
export function characterGeometry(parts: PartsProgress, body: BodyGeometry = 'male'): CharacterGeometry {
  const s = BODIES[body];
  const g: Record<BodyPart, number> = {
    chest: growth(parts.chest.level),
    back: growth(parts.back.level),
    legs: growth(parts.legs.level),
    shoulders: growth(parts.shoulders.level),
    arms: growth(parts.arms.level),
    core: growth(parts.core.level),
  };

  const shoulderHalf = s.shoulder[0] + s.shoulder[1] * g.shoulders + s.shoulder[2] * g.back;
  const chestHalf = s.chest[0] + s.chest[1] * g.chest + s.chest[2] * g.back;
  // Core tightens the waist; chest/back mass pushes it back out a little.
  const waistHalf = clamp(
    s.waist[0] - s.waist[1] * g.core + s.waist[2] * g.chest + s.waist[3] * g.back,
    s.waistClamp[0],
    s.waistClamp[1],
  );

  return {
    headR: s.headR,
    neckHalf: s.neck[0] + s.neck[1] * g.shoulders,
    shoulderHalf,
    deltoidR: s.deltoid[0] + s.deltoid[1] * g.shoulders,
    chestHalf,
    waistHalf,
    hipHalf: s.hip[0] + s.hip[1] * g.legs,
    latFlare: s.lat[0] + s.lat[1] * g.back,
    pecRx: s.pecRx[0] + s.pecRx[1] * g.chest,
    pecRy: s.pecRy[0] + s.pecRy[1] * g.chest,
    pecY: CHEST_Y + s.pecDrop,
    pecSpread: s.pecSpread,
    armW: s.arm[0] + s.arm[1] * g.arms + s.arm[2] * g.shoulders,
    bicepR: s.bicep[0] + s.bicep[1] * g.arms,
    thighW: s.thigh[0] + s.thigh[1] * g.legs,
    calfW: s.calf[0] + s.calf[1] * g.legs,
    legSpread: s.legSpread,
    absOpacity: s.abs[0] + s.abs[1] * g.core,
  };
}

/**
 * Anchor points for equipment layers (Phase 3 renders gloves/belt/shoes/cape
 * here). Exported so the shop items can be authored against stable coordinates.
 */
export interface CharacterAnchors {
  belt: { x: number; y: number; halfWidth: number };
  gloves: Array<{ x: number; y: number; r: number }>;
  shoes: Array<{ x: number; y: number; halfWidth: number }>;
  cape: { x: number; y: number; halfWidth: number };
}

export function characterAnchors(geo: CharacterGeometry): CharacterAnchors {
  const armX = CX + geo.shoulderHalf - 2;
  const legX = CX + geo.hipHalf * 0.55 * geo.legSpread;
  return {
    belt: { x: CX, y: HIP_Y - 8, halfWidth: geo.waistHalf + 2 },
    gloves: [
      { x: CX * 2 - armX - 2, y: HAND_Y, r: geo.armW * 0.55 },
      { x: armX + 2, y: HAND_Y, r: geo.armW * 0.55 },
    ],
    shoes: [
      { x: CX * 2 - legX, y: ANKLE_Y + 6, halfWidth: geo.calfW * 0.8 },
      { x: legX, y: ANKLE_Y + 6, halfWidth: geo.calfW * 0.8 },
    ],
    cape: { x: CX, y: SHOULDER_Y - 4, halfWidth: geo.shoulderHalf },
  };
}

/* ------------------------------------------------------------ equipment */

/**
 * Equipment layers.
 *
 * The shapes are built from the SAME anchors the body uses, so a piece of gear
 * always fits the character it is worn by: a wider back widens the cape, thicker
 * legs widen the shoes, a tighter core narrows the belt. Only the two colours
 * and the tier come from the item definition — the geometry is the character's.
 *
 * READABILITY AT TWO SCALES: the character SVG is drawn at ~220px on the דמות
 * screen and at ~90px inside the battle arena, so every piece uses one bold
 * silhouette plus at most one accent detail. Nothing here relies on a stroke
 * thinner than 2 user units (≈0.9px at arena scale).
 */

function capeLayer(_geo: CharacterGeometry, a: CharacterAnchors, item: EquipmentDef): string {
  const { x, y } = a.cape;
  const top = a.cape.halfWidth;
  if (item.tier === 1) {
    // A towel, not a cape: slung over one shoulder.
    const sx = x + top * 0.35;
    return `<path d="M ${n(sx - 13)} ${n(y - 4)} h 26 l -3 ${n(46)} l -7 -6 -6 6 -7 -6 Z"
      fill="${item.color}" stroke="${item.accent}" stroke-width="2.5" stroke-linejoin="round"/>`;
  }
  const half = top + (item.tier === 3 ? 12 : 6);
  const hem = KNEE_Y - (item.tier === 3 ? 6 : 24);
  const collar = `<path d="M ${n(x - top - 2)} ${n(y)} Q ${n(x)} ${n(y - 13)} ${n(x + top + 2)} ${n(y)}
    Q ${n(x)} ${n(y + 8)} ${n(x - top - 2)} ${n(y)} Z" fill="${item.accent}"/>`;
  return `<path d="M ${n(x - top)} ${n(y)}
      C ${n(x - half - 6)} ${n(y + 60)} ${n(x - half)} ${n(hem - 30)} ${n(x - half)} ${n(hem)}
      l ${n(half * 0.5)} -9 l ${n(half * 0.5)} 9 l ${n(half * 0.5)} -9 l ${n(half * 0.5)} 9
      C ${n(x + half)} ${n(hem - 30)} ${n(x + half + 6)} ${n(y + 60)} ${n(x + top)} ${n(y)} Z"
      fill="${item.color}" stroke="${item.accent}" stroke-width="2.5" stroke-linejoin="round"/>${collar}`;
}

function beltLayer(_geo: CharacterGeometry, a: CharacterAnchors, item: EquipmentDef): string {
  const { x, y, halfWidth } = a.belt;
  const h = 8 + item.tier * 2;
  const strap = `<rect x="${n(x - halfWidth)}" y="${n(y - h / 2)}" width="${n(halfWidth * 2)}" height="${n(h)}"
    rx="${n(h / 2.6)}" fill="${item.color}" stroke="${item.accent}" stroke-width="2"/>`;
  if (item.tier === 1) {
    return `${strap}<rect x="${n(x - 6)}" y="${n(y - h / 2 - 2)}" width="12" height="${n(h + 4)}" rx="3" fill="${item.accent}"/>`;
  }
  if (item.tier === 2) {
    return `${strap}<rect x="${n(x - 8)}" y="${n(y - h / 2 - 3)}" width="16" height="${n(h + 6)}" rx="4"
      fill="${item.accent}"/><circle cx="${n(x)}" cy="${n(y)}" r="3" fill="${item.color}"/>`;
  }
  // Tier 3: a title belt — the buckle is the whole point.
  return `${strap}<path d="M ${n(x)} ${n(y - 13)} l 12 7 v 12 l -12 7 -12 -7 v -12 Z"
    fill="${item.accent}" stroke="${item.color}" stroke-width="2"/>
    <circle cx="${n(x)}" cy="${n(y)}" r="4.5" fill="${item.color}"/>`;
}

function glovesLayer(_geo: CharacterGeometry, a: CharacterAnchors, item: EquipmentDef): string {
  return a.gloves
    .map((g) => {
      const r = Math.max(6.5, g.r + 1.5 + item.tier * 0.7);
      const cuff = `<rect x="${n(g.x - r * 0.95)}" y="${n(g.y - r - 7)}" width="${n(r * 1.9)}" height="8" rx="3"
        fill="${item.accent}"/>`;
      const mitt = `<circle cx="${n(g.x)}" cy="${n(g.y)}" r="${n(r)}" fill="${item.color}"
        stroke="${item.accent}" stroke-width="2"/>`;
      const detail =
        item.tier === 3
          ? `<path d="M ${n(g.x)} ${n(g.y - 3.5)} l 2.6 5.4 -5.2 0 Z" fill="${item.accent}"/>`
          : item.tier === 2
            ? `<circle cx="${n(g.x)}" cy="${n(g.y)}" r="2.4" fill="${item.accent}"/>`
            : '';
      return `${cuff}${mitt}${detail}`;
    })
    .join('');
}

function shoesLayer(_geo: CharacterGeometry, a: CharacterAnchors, item: EquipmentDef): string {
  return a.shoes
    .map((s, i) => {
      const side = i === 0 ? -1 : 1;
      const w = s.halfWidth + 2 + item.tier;
      const toe = side * (w * 0.9);
      const body = `<path d="M ${n(s.x - w)} ${n(s.y - 8)} h ${n(w * 2)} q ${n(toe)} 3 ${n(toe)} 9
        h ${n(-w * 2 - Math.abs(toe))} Z" fill="${item.color}" stroke="${item.accent}" stroke-width="2"
        stroke-linejoin="round"/>`;
      const sole = `<rect x="${n(Math.min(s.x - w, s.x - w + toe))}" y="${n(s.y + 1)}"
        width="${n(w * 2 + Math.abs(toe))}" height="4" rx="2" fill="${item.accent}"/>`;
      const wing =
        item.tier === 3
          ? `<path d="M ${n(s.x - side * w * 0.6)} ${n(s.y - 9)} q ${n(-side * 9)} -8 ${n(-side * 2)} -10
             q 1 7 ${n(side * 8)} 8 Z" fill="${item.accent}"/>`
          : '';
      return `${body}${sole}${wing}`;
    })
    .join('');
}

const SLOT_DRAW: Readonly<
  Record<EquipmentSlot, (geo: CharacterGeometry, a: CharacterAnchors, item: EquipmentDef) => string>
> = {
  cape: capeLayer,
  belt: beltLayer,
  gloves: glovesLayer,
  shoes: shoesLayer,
};

/* ------------------------------------------------------- upgrade flair */

/**
 * WHERE an upgrade's flair sits on each slot: the points that read as "the
 * item", at any body size.
 *
 * Derived from the same anchors the item itself is drawn from, so the flair
 * follows the gear on every body × skin combination and at every level — there
 * is no second set of coordinates to keep in sync, and nothing bespoke per item.
 */
function flairSpots(slot: EquipmentSlot, a: CharacterAnchors): Array<{ x: number; y: number; r: number }> {
  switch (slot) {
    case 'gloves':
      return a.gloves.map((g) => ({ x: g.x, y: g.y, r: Math.max(7, g.r + 2) }));
    case 'shoes':
      return a.shoes.map((s) => ({ x: s.x, y: s.y - 3, r: Math.max(7, s.halfWidth + 2) }));
    case 'belt':
      return [{ x: a.belt.x, y: a.belt.y, r: 8 }];
    case 'cape':
      return [{ x: a.cape.x, y: a.cape.y + 5, r: 9 }];
  }
}

/** A four-point sparkle centred on (x, y) — concave, so it reads as a glint. */
function spark(x: number, y: number, r: number, fill: string): string {
  return `<path class="ch-spark" d="M ${n(x)} ${n(y - r)} Q ${n(x)} ${n(y)} ${n(x + r)} ${n(y)}
    Q ${n(x)} ${n(y)} ${n(x)} ${n(y + r)} Q ${n(x)} ${n(y)} ${n(x - r)} ${n(y)}
    Q ${n(x)} ${n(y)} ${n(x)} ${n(y - r)} Z" fill="${fill}"/>`;
}

/** A five-point star badge — the +3 mark, pinned beside the item. */
function starBadge(x: number, y: number, r: number, fill: string, stroke: string): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${n(x + Math.cos(a) * rad)} ${n(y + Math.sin(a) * rad)}`;
  });
  return `<g class="ch-up-badge"><circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 1.15)}" fill="${stroke}" opacity="0.55"/>
    <path d="M ${pts.join(' L ')} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/></g>`;
}

/**
 * THE GLOW, and why it is an SVG filter rather than a CSS one.
 *
 * It used to be `filter:drop-shadow(0 0 Npx var(--up-glow))` in
 * `styles/character.css`, with the colour handed over as a custom property.
 * Two things about that are unsafe outside a desktop Chrome, and a Galaxy S24
 * showed both at once: a `var()` inside a `filter` function is resolved by a
 * path Samsung's renderer gets wrong on SVG children — an unresolved colour
 * falls back to BLACK, which is exactly the dark blob the screenshot showed
 * under an upgraded shoe — and the +3 rule stacked TWO drop-shadows, which
 * compound into a floodlight rather than reading as a glint.
 *
 * So: one `<feDropShadow>` per upgraded item, with the item's own accent baked
 * in as an explicit `flood-color` (it is known at render time — there is
 * nothing to resolve), a small `stdDeviation` and a bounded `flood-opacity`.
 * One filter per group, never two, so nothing compounds; and because the id is
 * derived from the item and its level, the same definition emitted twice on a
 * page (the roster strip and the stage draw the same character) is
 * byte-identical, which is the one case where a repeated id is harmless.
 *
 * The blur is in USER UNITS — the stage is 200×320 — so the glow is the same
 * fraction of the drawing at 220px (דמות), 90px (arena) and 62px (a card).
 */
const GLOW: Readonly<Record<number, { readonly blur: number; readonly opacity: number }>> = {
  2: { blur: 1.1, opacity: 0.5 },
  3: { blur: 1.7, opacity: 0.68 },
};

/** Deterministic id, so two copies of one item on a page share one definition. */
function glowId(itemId: string, level: number): string {
  return `chUp-${itemId}-${level}`;
}

/** The `<filter>` for one upgraded item ('' below +2, where nothing glows). */
function glowFilter(item: EquipmentDef, level: number): string {
  const g = GLOW[level];
  if (!g) return '';
  // A generous filter region: the default (-10%…120%) clips a glow off a thin
  // shape such as a belt strap, and a clipped glow reads as a hard edge.
  return `<filter id="${glowId(item.id, level)}" x="-35%" y="-35%" width="170%" height="170%"
      color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="0" stdDeviation="${n(g.blur)}" flood-color="${item.accent}"
        flood-opacity="${g.opacity}"/>
    </filter>`;
}

/**
 * The visual treatment of an upgrade — SYSTEMATIC, one rule for all 12 items:
 *   +1  one glint on the item's primary point (subtle: nothing else changes);
 *   +2  a glint on EVERY point of the item, plus a coloured glow (the SVG
 *       filter above, always in the item's own accent);
 *   +3  the same glints with a slightly stronger glow, plus a small star badge
 *       pinned just outside the item.
 *
 * Everything is placed from `flairSpots`, i.e. from the character's own anchors,
 * so it fits every body × skin pair and every level without a special case. The
 * badge is pushed OUTWARD from the centre line and stays inside the 200×320
 * stage even on the widest possible body (swept in `tests/upgrades.dom.test.ts`).
 */
function upgradeFlair(slot: EquipmentSlot, a: CharacterAnchors, item: EquipmentDef, level: number): string {
  const lv = clampUpgradeLevel(level);
  if (lv < 1) return '';
  const spots = flairSpots(slot, a);
  if (spots.length === 0) return '';
  // The "primary" point is the outermost one on the right — the side the badge
  // is pinned to, so it never lands on top of the body.
  const primary = spots.reduce((best, s) => (s.x >= best.x ? s : best), spots[0] as (typeof spots)[number]);
  const lit = lv >= 2 ? spots : [primary];
  const glints = lit
    .map((s) => {
      const side = s.x >= CX ? 1 : -1;
      return spark(s.x + side * s.r * 0.72, s.y - s.r * 0.78, 3.4 + lv * 0.5, item.accent);
    })
    .join('');
  const badge =
    lv >= 3
      ? starBadge(primary.x + primary.r + 4.5, primary.y - primary.r - 1, 5.4, item.accent, item.color)
      : '';
  return `${glints}${badge}`;
}

/** Markup for one slot's group contents ('' when the slot is empty). */
export function equipmentLayer(
  slot: EquipmentSlot,
  geo: CharacterGeometry,
  equipped: Partial<Record<EquipmentSlot, string>>,
  upgrades: Readonly<Record<string, number>> = {},
): string {
  const id = equipped[slot];
  if (!id) return '';
  const item = equipmentById(id);
  if (!item || item.slot !== slot) return '';
  const anchors = characterAnchors(geo);
  return SLOT_DRAW[slot](geo, anchors, item) + upgradeFlair(slot, anchors, item, upgrades[id] ?? 0);
}

/** The worn item of a slot and the upgrade level it is actually at (0 = none). */
function wornUpgrade(
  slot: EquipmentSlot,
  equipment: EquipmentView | undefined,
): { item: EquipmentDef; level: number } | null {
  const id = equipment?.equipped?.[slot];
  const item = id ? equipmentById(id) : undefined;
  if (!item || item.slot !== slot) return null;
  return { item, level: clampUpgradeLevel(equipment?.upgrades?.[item.id] ?? 0) };
}

/**
 * One whole equipment `<g>`, upgrade flair included.
 *
 * A slot that is empty or at +0 renders EXACTLY the group it always did
 * (`<g class="ch-equip" data-slot="…">`), so nothing about an un-upgraded
 * character's markup changes. An upgraded one additionally carries
 * `upgraded up-N` + `data-upgrade="N"` — the hooks the shop and the tests read
 * — and, from +2 up, a `filter` pointing at its own `<feDropShadow>` (see
 * {@link glowFilter}; the definitions are collected into the drawing's single
 * `<defs>` by {@link upgradeGlowDefs}).
 */
export function equipmentGroup(
  slot: EquipmentSlot,
  geo: CharacterGeometry,
  equipment: EquipmentView | undefined,
): string {
  const worn = wornUpgrade(slot, equipment);
  const lv = worn?.level ?? 0;
  const glow = worn && GLOW[lv] ? ` filter="url(#${glowId(worn.item.id, lv)})"` : '';
  const attrs =
    lv > 0 ? ` upgraded up-${lv}" data-slot="${slot}" data-upgrade="${lv}"${glow}` : `" data-slot="${slot}"`;
  const contents = equipmentLayer(slot, geo, equipment?.equipped ?? {}, equipment?.upgrades ?? {});
  return `<g class="ch-equip${attrs}>${contents}</g>`;
}

/**
 * Every glow definition the drawing needs, in slot order — '' when nothing worn
 * is upgraded past +1, which is the overwhelmingly common case.
 */
export function upgradeGlowDefs(equipment: EquipmentView | undefined): string {
  return EQUIPMENT_SLOTS.map((slot) => {
    const worn = wornUpgrade(slot, equipment);
    return worn ? glowFilter(worn.item, worn.level) : '';
  }).join('');
}

/* -------------------------------------------------------------- trophies */

/**
 * The medal ribbons pinned to the character's chest — one per world boss,
 * gold and tiny, in the order the bosses fell.
 */
function trophyPins(geo: CharacterGeometry, count: number): string {
  if (count <= 0) return '';
  const startX = CX - geo.chestHalf * 0.62;
  return Array.from({ length: Math.min(count, 6) }, (_, i) => {
    const x = startX + i * 10;
    const y = SHOULDER_Y + 12;
    return `<g class="ch-medal"><rect x="${n(x - 2.5)}" y="${n(y - 5)}" width="5" height="5" fill="#B91C1C"/>
      <circle cx="${n(x)}" cy="${n(y + 2.5)}" r="4" fill="#FBBF24" stroke="#B45309" stroke-width="1.2"/></g>`;
  }).join('');
}

/**
 * A standalone trophy medallion for the character screen's shelf.
 * Self-contained SVG so it can be dropped anywhere in the page.
 */
export function trophyMedallion(boss: BossDef, worldHe: string): string {
  return `<svg class="tr-svg" viewBox="0 0 72 84" xmlns="http://www.w3.org/2000/svg" role="img"
    aria-label="גביע: ${boss.he}, ${worldHe}">
    <path d="M22 4 h28 l-8 22 h-12 Z" fill="#B91C1C"/>
    <path d="M14 4 h16 l-6 20 h-14 Z" fill="#7F1D1D"/>
    <circle cx="36" cy="52" r="26" fill="#FBBF24" stroke="#B45309" stroke-width="3"/>
    <circle cx="36" cy="52" r="19" fill="#F59E0B"/>
    <path d="M36 38 l4.6 9.6 10.4 1.4 -7.6 7.4 1.9 10.6 -9.3 -5.1 -9.3 5.1 1.9 -10.6 -7.6 -7.4 10.4 -1.4 Z"
      fill="#FDE68A"/>
  </svg>`;
}

/* -------------------------------------------------------------- drawing */

/** Round to 1 decimal — keeps the markup small and the tests readable. */
function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function torsoPath(geo: CharacterGeometry): string {
  const sh = geo.shoulderHalf;
  const ch = geo.chestHalf;
  const wa = geo.waistHalf;
  const hp = geo.hipHalf;
  return [
    `M ${n(CX - sh)} ${n(SHOULDER_Y)}`,
    `C ${n(CX - ch)} ${n(CHEST_Y - 10)} ${n(CX - ch)} ${n(CHEST_Y + 12)} ${n(CX - wa)} ${n(WAIST_Y)}`,
    `L ${n(CX - hp)} ${n(HIP_Y)}`,
    `Q ${n(CX)} ${n(HIP_Y + 10)} ${n(CX + hp)} ${n(HIP_Y)}`,
    `L ${n(CX + wa)} ${n(WAIST_Y)}`,
    `C ${n(CX + ch)} ${n(CHEST_Y + 12)} ${n(CX + ch)} ${n(CHEST_Y - 10)} ${n(CX + sh)} ${n(SHOULDER_Y)}`,
    `Q ${n(CX)} ${n(SHOULDER_Y - 12)} ${n(CX - sh)} ${n(SHOULDER_Y)}`,
    'Z',
  ].join(' ');
}

function latPath(geo: CharacterGeometry, side: 1 | -1): string {
  const x = (v: number): number => CX + side * v;
  return [
    `M ${n(x(geo.shoulderHalf - 3))} ${n(SHOULDER_Y + 4)}`,
    `Q ${n(x(geo.chestHalf + geo.latFlare))} ${n(CHEST_Y + 16)} ${n(x(geo.waistHalf))} ${n(WAIST_Y - 2)}`,
    `L ${n(x(geo.waistHalf - 6))} ${n(CHEST_Y)}`,
    'Z',
  ].join(' ');
}

function armGroup(geo: CharacterGeometry, side: 1 | -1): string {
  const x = (v: number): number => CX + side * v;
  const shoulderX = x(geo.shoulderHalf - 1);
  const elbowX = x(geo.shoulderHalf + 5);
  const handX = x(geo.shoulderHalf + 3);
  const bicepX = (shoulderX + elbowX) / 2;
  return `
      <path class="ch-limb" d="M ${n(shoulderX)} ${n(SHOULDER_Y + 4)} Q ${n(elbowX + side * 3)} ${n(CHEST_Y + 10)} ${n(elbowX)} ${n(ELBOW_Y)} L ${n(handX)} ${n(HAND_Y)}"
        stroke-width="${n(geo.armW)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <ellipse class="ch-shade" cx="${n(bicepX + side * 1.5)}" cy="${n(CHEST_Y + 8)}" rx="${n(geo.bicepR)}" ry="${n(geo.bicepR * 1.3)}"/>`;
}

function legGroup(geo: CharacterGeometry, side: 1 | -1): string {
  const x = (v: number): number => CX + side * v * geo.legSpread;
  const hipX = x(geo.hipHalf * 0.52);
  const kneeX = x(geo.hipHalf * 0.62);
  const ankleX = x(geo.hipHalf * 0.58);
  return `
      <path class="ch-limb" d="M ${n(hipX)} ${n(HIP_Y - 6)} L ${n(kneeX)} ${n(KNEE_Y)}"
        stroke-width="${n(geo.thighW)}" stroke-linecap="round" fill="none"/>
      <path class="ch-limb" d="M ${n(kneeX)} ${n(KNEE_Y)} L ${n(ankleX)} ${n(ANKLE_Y)}"
        stroke-width="${n(geo.calfW)}" stroke-linecap="round" fill="none"/>
      <ellipse class="ch-foot" cx="${n(ankleX + side * 3)}" cy="${n(ANKLE_Y + 6)}" rx="${n(geo.calfW * 0.85)}" ry="4.5"/>`;
}

function absGroup(geo: CharacterGeometry): string {
  const rows = 3;
  const rw = Math.max(5, geo.waistHalf * 0.42);
  const rh = 7;
  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = CHEST_Y + 16 + row * (rh + 3.5);
    for (const side of [-1, 1] as const) {
      cells.push(
        `<rect x="${n(CX + side * 1.6 - (side < 0 ? rw : 0))}" y="${n(y)}" width="${n(rw)}" height="${n(rh)}" rx="2.5"/>`,
      );
    }
  }
  return `<g class="ch-abs" opacity="${n(geo.absOpacity)}">${cells.join('')}</g>`;
}

/* ------------------------------------------------------------------ head */

/**
 * A skin's head decoration.
 *
 * Everything is expressed in units of the head radius, so the same shape reads
 * correctly on either body and at either scale (220px on the דמות screen, 90px
 * in the arena) — and, since the two bodies differ ONLY in that radius (both
 * heads are centred on `HEAD_CY`), the very same descriptor fits a male skull
 * and a female one without a second set of numbers. That is what makes every
 * skin wearable on both bodies: the ninja wrap lands on the male head, the
 * spartan helmet on the female one.
 *
 * `behind` is drawn before the head circle, `front` after it; a decoration may
 * also hide the default eyes or mouth when it covers them (a visor, a mask).
 */
interface DecorLayers {
  behind: string;
  front: string;
  hideEyes?: boolean;
  hideMouth?: boolean;
}

/**
 * Hair is its own layer, so a covering and a hairstyle COMPOSE: a spartan helmet
 * can sit on a braid, a zombie can keep tattered curls under its stitches.
 *
 * `cascade` is the one part of a drawing that is not in the head group at all —
 * long hair falls past the shoulders, and the masses that fall down the BACK
 * have to be drawn before the torso (see `characterSvg`'s layer list).
 */
interface HairLayers extends DecorLayers {
  cascade: string;
}

const EMPTY_HAIR: HairLayers = { behind: '', front: '', cascade: '' };

/**
 * LONG CURLY hair — the free female body's look (and, thinned, the undead one).
 *
 * A cloud of overlapping curls, built from one ellipse (the crown mass) plus
 * rings and columns of circles, every radius and offset a multiple of the head
 * radius so the same silhouette reads at 220px (the דמות stage), 90px (the
 * arena) and 62px (a roster card).
 *
 * THREE LAYERS, because the hair is longer than the head:
 *   1. `behind` — the crown: a mass whose curls bite past the skull's outline
 *      plus two puffs at ear height that give the cloud its width. Drawn inside
 *      the head group, behind the skull.
 *   2. `cascade` — the length: two outer columns falling to about chest height
 *      and a narrower pair behind the neck. Drawn BEFORE the body, so the mass
 *      sits behind the torso (and over a cape, which is drawn before it —
 *      hair rests on a cape, it does not vanish under one).
 *   3. `front` — the hairline that frames the face, its two accent highlights,
 *      and one strand per side falling over the shoulder. Drawn last of all, so
 *      the hair still reads at any level: a very wide back can swallow the
 *      cascade, it can never swallow these.
 *
 * TWO KEEP-OUTS, both learned from a real screenshot (a Galaxy S24 at a high
 * level, where the hair had eaten the character):
 *
 *   - THE FACE. Every curl of the `front` layer clears a circle around the
 *     features — the hairline frames the face from outside it, and no side curl
 *     may sit on a cheek or an eye. (The `behind` crown may overlap freely: it
 *     is drawn under the skull.)
 *   - THE CHEST. The `front` strands STOP at the shoulder line. They used to
 *     fall to y≈118 at a fixed x, which is inside the torso from about level 5
 *     up — a dark bib straight across both pecs. The LENGTH of this hair is the
 *     `cascade`, and the cascade is drawn BEFORE the body, so the length can
 *     never land on the chest no matter how wide the character grows.
 *
 * The strand tip is the one part of the cloud that reads the geometry: it tracks
 * the shoulder point, landing just inside the deltoid cap, so the strands HUG
 * the silhouette at every level instead of crossing it (a fixed tip stops
 * hugging anything the moment the shoulders outgrow it). It is CLAMPED to
 * [1.05·r, 2.2·r], which is what keeps the old "no level can push a curl off
 * the 200×320 stage" property true: the widest curl is ≈2.4·r from the centre
 * line and the lowest ≈5.0·r below the head centre, at every level.
 */
function curlCloudLayers(
  cy: number,
  r: number,
  h: CharacterHair,
  geo: CharacterGeometry,
  tattered = false,
): HairLayers {
  const curl = (x: number, y: number, rad: number, fill: string): string =>
    `<circle class="ch-curl" cx="${n(x)}" cy="${n(y)}" r="${n(rad)}" fill="${fill}"/>`;
  // Tattered hair is the same cloud with pieces missing and thinner curls — the
  // gaps are what make it read as "this hair has been dead for a while".
  const gone = (i: number): boolean => tattered && i % 3 === 2;
  const thin = tattered ? 0.86 : 1;

  /** `count` curls spread along the arc `from`°→`to`°, angles measured with y UP. */
  const ring = (ringR: number, curlR: number, from: number, to: number, count: number, fill: string): string =>
    Array.from({ length: count }, (_, i) => {
      if (gone(i)) return '';
      const t = count === 1 ? 0.5 : i / (count - 1);
      const a = ((from + (to - from) * t) * Math.PI) / 180;
      return curl(CX + Math.cos(a) * ringR, cy - Math.sin(a) * ringR, curlR * thin, fill);
    }).join('');

  /**
   * One falling column of curls, mirrored on both sides: `x`/`y` are travelled
   * as fractions of the head radius from `[0]` to `[1]`, the radius shrinks
   * along the way so the lock tapers to a tip.
   */
  const column = (
    count: number,
    x: readonly [number, number],
    y: readonly [number, number],
    rad: readonly [number, number],
    fill: string,
  ): string =>
    [-1, 1]
      .flatMap((side) =>
        Array.from({ length: count }, (_, i) => {
          if (gone(i)) return '';
          const t = count === 1 ? 0 : i / (count - 1);
          const lerp = (p: readonly [number, number]): number => p[0] + (p[1] - p[0]) * t;
          return curl(CX + side * r * lerp(x), cy + r * lerp(y), r * lerp(rad) * thin, fill);
        }),
      )
      .join('');

  const behind =
    `<ellipse cx="${n(CX)}" cy="${n(cy - r * 0.1)}" rx="${n(r * 1.28)}" ry="${n(r * 1.22)}" fill="${h.main}"/>` +
    ring(r * 1.1, r * 0.44, 196, -16, 9, h.main) +
    curl(CX - r * 1.14, cy + r * 0.42, r * 0.46 * thin, h.main) +
    curl(CX + r * 1.14, cy + r * 0.42, r * 0.46 * thin, h.main);

  const cascade =
    // the outer fall — the widest part of the silhouette, ending at chest height
    column(6, [1.12, 1.58], [0.78, 4.68], [0.46, 0.33], h.main) +
    // …and a narrower pair right behind the neck, so the mass is not a ring
    column(5, [0.42, 0.76], [1.05, 4.2], [0.52, 0.42], h.main) +
    // two highlight curls high on the fall keep it from reading as one flat blob
    column(2, [1.0, 1.2], [1.5, 2.35], [0.2, 0.17], h.accent);

  // WHERE THE FRONT STRANDS END: on the shoulder, just inside the deltoid cap,
  // and never below it. Clamped, so the widest body cannot drag a curl off the
  // stage and the narrowest cannot pull one onto the face.
  const tipX = clamp(geo.shoulderHalf - geo.deltoidR * 0.45, r * 1.05, r * 2.2) / r;
  const tipY = (SHOULDER_Y + 4 - cy) / r;

  // The hairline frames the face from OUTSIDE it: it rides a wider ring than the
  // skull and stops short of the temples, so no curl reaches an eye or a cheek.
  const front =
    ring(r * 0.94, r * 0.29, 158, 22, 6, h.main) +
    ring(r * 1.02, r * 0.18, 142, 116, 2, h.accent) +
    // the strands worn over the shoulders — always visible, at every level
    column(5, [1.02, tipX], [0.55, tipY], [0.33, 0.19], h.main);

  return { behind, front, cascade };
}

/** Tied-back hair: a mass behind the head, a tail, and a fringe on top. */
function tiedHairLayers(cy: number, r: number, h: CharacterHair): HairLayers {
  const behind =
    `<ellipse cx="${n(CX)}" cy="${n(cy + r * 0.16)}" rx="${n(r + 3.5)}" ry="${n(r + 2)}" fill="${h.main}"/>` +
    `<path d="M ${n(CX + r * 0.7)} ${n(cy + r * 0.2)} q ${n(r * 1.5)} ${n(r * 0.8)} ${n(r * 0.35)} ${n(r * 2.4)}
       q ${n(-r * 0.55)} ${n(-r * 0.25)} ${n(-r * 0.95)} ${n(-r * 1.15)} Z" fill="${h.main}"/>`;
  const front = `<path d="M ${n(CX - r)} ${n(cy - r * 0.1)} a ${n(r)} ${n(r)} 0 0 1 ${n(r * 2)} 0
      q ${n(-r * 0.5)} ${n(-r * 0.45)} ${n(-r)} ${n(-r * 0.1)}
      q ${n(-r * 0.5)} ${n(-r * 0.35)} ${n(-r)} ${n(r * 0.1)} Z" fill="${h.main}"/>`;
  return { behind, front, cascade: '' };
}

const HAIR_DRAW: Readonly<
  Record<CharacterHair['kind'], (cy: number, r: number, h: CharacterHair, geo: CharacterGeometry) => HairLayers>
> = {
  none: () => EMPTY_HAIR,
  curls: (cy, r, h, geo) => curlCloudLayers(cy, r, h, geo),
  /** The undead cloud: same curls, a third of them torn away. */
  ragged: (cy, r, h, geo) => curlCloudLayers(cy, r, h, geo, true),
  tied: (cy, r, h) => tiedHairLayers(cy, r, h),
};

const DECOR_DRAW: Readonly<Record<CharacterDecor['kind'], (cy: number, r: number, d: CharacterDecor) => DecorLayers>> = {
  none: () => ({ behind: '', front: '' }),

  /** A visor band instead of a face, an antenna on top, a speaker-grille mouth. */
  visor: (cy, r, d) => ({
    behind: `<path d="M ${n(CX)} ${n(cy - r)} v ${n(-r * 0.55)}" stroke="${d.main}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${n(CX)}" cy="${n(cy - r * 1.68)}" r="${n(r * 0.2)}" fill="${d.accent}"/>`,
    front:
      `<rect x="${n(CX - r * 0.95)}" y="${n(cy - r * 0.5)}" width="${n(r * 1.9)}" height="${n(r * 0.66)}"
        rx="${n(r * 0.18)}" fill="${d.main}"/>` +
      `<rect x="${n(CX - r * 0.74)}" y="${n(cy - r * 0.34)}" width="${n(r * 1.48)}" height="${n(r * 0.3)}"
        rx="${n(r * 0.15)}" fill="${d.accent}"/>` +
      `<path d="M ${n(CX - r * 0.42)} ${n(cy + r * 0.52)} h ${n(r * 0.84)}" stroke="${d.main}"
        stroke-width="2.4" stroke-linecap="round"/>`,
    hideEyes: true,
    hideMouth: true,
  }),

  /** Crested helmet with a nose guard — the eyes stay visible under the brim. */
  helmet: (cy, r, d) => ({
    behind: '',
    front:
      `<path d="M ${n(CX - r - 1)} ${n(cy - r * 0.42)} a ${n(r + 1)} ${n(r + 1)} 0 0 1 ${n(r * 2 + 2)} 0
        v ${n(r * 0.16)} h ${n(-r * 2 - 2)} Z" fill="${d.main}"/>` +
      `<rect x="${n(CX - 1.8)}" y="${n(cy - r * 0.42)}" width="3.6" height="${n(r * 0.95)}" rx="1.6" fill="${d.main}"/>` +
      `<path d="M ${n(CX - r * 0.55)} ${n(cy - r * 1.02)} q ${n(r * 0.55)} ${n(-r * 0.8)} ${n(r * 1.1)} 0
        q ${n(-r * 0.55)} ${n(-r * 0.28)} ${n(-r * 1.1)} 0 Z" fill="${d.accent}"/>`,
  }),

  /** Stitched scalp and a tuft of hair that has seen better decades. */
  undead: (cy, r, d) => ({
    behind: '',
    front:
      // The tuft's base line stays ON the skull (a hair that floats above the
      // head is the classic bug here), so only the spikes leave the circle.
      `<path d="M ${n(CX - r * 0.72)} ${n(cy - r * 0.66)} l ${n(r * 0.26)} ${n(-r * 0.62)}
        l ${n(r * 0.24)} ${n(r * 0.34)} l ${n(r * 0.3)} ${n(-r * 0.62)} l ${n(r * 0.32)} ${n(r * 0.6)} Z"
        fill="${d.main}"/>` +
      `<path d="M ${n(CX - r * 0.8)} ${n(cy - r * 0.5)} h ${n(r * 1.6)}" stroke="${d.accent}" stroke-width="2"
        stroke-linecap="round"/>` +
      `<path d="M ${n(CX - r * 0.5)} ${n(cy - r * 0.66)} v ${n(r * 0.32)} M ${n(CX)} ${n(cy - r * 0.66)} v ${n(r * 0.32)}
        M ${n(CX + r * 0.5)} ${n(cy - r * 0.66)} v ${n(r * 0.32)}" stroke="${d.accent}" stroke-width="2"
        stroke-linecap="round"/>`,
  }),

  /**
   * Full head wrap: only the eyes show, and a headband trails behind. The hair
   * that goes with it is declared by the skin (`hair: 'tied'` on BOTH bodies) —
   * a loose cloud would push out past the wrap and break its silhouette.
   */
  mask: (cy, r, d) => {
    return {
      behind: '',
      front:
        `<path d="M ${n(CX - r)} ${n(cy - r * 0.26)} a ${n(r)} ${n(r)} 0 0 1 ${n(r * 2)} 0 Z" fill="${d.main}"/>` +
        `<path d="M ${n(CX - r * 0.98)} ${n(cy + r * 0.12)} a ${n(r)} ${n(r)} 0 0 0 ${n(r * 1.96)} 0 Z" fill="${d.main}"/>` +
        `<path d="M ${n(CX - r * 0.95)} ${n(cy - r * 0.3)} h ${n(r * 1.9)}" stroke="${d.accent}"
          stroke-width="${n(r * 0.17)}" stroke-linecap="round"/>` +
        `<path d="M ${n(CX - r * 0.9)} ${n(cy - r * 0.28)} q ${n(-r * 0.85)} ${n(r * 0.35)} ${n(-r * 1.25)} ${n(r * 1.15)}
          l ${n(r * 0.5)} ${n(-r * 0.18)} q ${n(r * 0.3)} ${n(-r * 0.5)} ${n(r * 0.85)} ${n(-r * 0.62)} Z"
          fill="${d.accent}"/>`,
      hideMouth: true,
    };
  },
};

/**
 * The whole look of one character's head: hair FIRST, covering ON TOP.
 *
 * That order is the entire trick behind "every skin on both bodies" — the two
 * descriptors are independent, so a body picks the hair that suits it (the
 * female spartan's braid, the female zombie's tattered curls) while the skin
 * keeps one covering for both.
 */
function lookLayers(geo: CharacterGeometry, char: CharacterDef): HairLayers {
  const r = geo.headR;
  const hair = HAIR_DRAW[char.hair.kind](HEAD_CY, r, char.hair, geo);
  const decor = DECOR_DRAW[char.decor.kind](HEAD_CY, r, char.decor);
  const out: HairLayers = {
    behind: hair.behind + decor.behind,
    front: hair.front + decor.front,
    cascade: hair.cascade,
  };
  if (decor.hideEyes === true) out.hideEyes = true;
  if (decor.hideMouth === true) out.hideMouth = true;
  return out;
}

/**
 * The head: skull, decoration, eyes and mouth.
 *
 * Every feature is placed as a fraction of the head radius (the male values are
 * the literals this was extracted from: r=18 ⇒ eyes at ±7, mouth at +7/+12), so
 * a smaller head keeps its face proportional instead of drifting.
 */
function headGroup(geo: CharacterGeometry, d: HairLayers): string {
  const r = geo.headR;
  const cy = HEAD_CY;
  const dx = r * (7 / 18);
  const eyeY = cy - r * (2 / 18);
  const eyeR = r * (2.2 / 18);
  const mouthY = cy + r * (7 / 18);
  const mouthDip = cy + r * (12 / 18);
  const eyes = d.hideEyes
    ? ''
    : `
    <circle class="ch-eye" cx="${n(CX - dx)}" cy="${n(eyeY)}" r="${n(eyeR)}"/>
    <circle class="ch-eye" cx="${n(CX + dx)}" cy="${n(eyeY)}" r="${n(eyeR)}"/>`;
  const mouth = d.hideMouth
    ? ''
    : `
    <path class="ch-mouth" d="M ${n(CX - dx)} ${n(mouthY)} Q ${n(CX)} ${n(mouthDip)} ${n(CX + dx)} ${n(mouthY)}" fill="none" stroke-linecap="round"/>`;

  return `<g class="ch-head">${d.behind ? `\n    <g class="ch-decor back">${d.behind}</g>` : ''}
    <circle class="ch-skin" cx="${n(CX)}" cy="${n(cy)}" r="${n(r)}"/>${
      d.front ? `\n    <g class="ch-decor front">${d.front}</g>` : ''
    }${eyes}${mouth}
  </g>`;
}

/**
 * What the drawing needs to know about a wardrobe: what is WORN and at what
 * upgrade level. `GameState['equipment']` satisfies it; so does a bare
 * `{ equipped }` literal, which is what keeps the artwork sweeps terse.
 */
export interface EquipmentView {
  owned?: readonly string[];
  equipped: Partial<Record<EquipmentSlot, string>>;
  /** item id -> +0…+3. Absent means "nothing is upgraded". */
  upgrades?: Readonly<Record<string, number>>;
}

export interface CharacterSvgOptions {
  /** Parts to pulse right now (level-up celebration). */
  pulse?: readonly BodyPart[];
  /** Accessible label; a sensible Hebrew default is used when omitted. */
  label?: string;
  /** Owned/equipped/upgraded shop items — only what is WORN is drawn. */
  equipment?: EquipmentView;
  /** How many world-boss medals to pin on the chest. */
  trophies?: number;
  /**
   * WHO is being drawn: a roster id or the definition itself. Unknown ids fall
   * back to the default hero, so a save from a newer build (or a skin that was
   * removed) still renders a character rather than nothing.
   */
  character?: string | CharacterDef;
}

/**
 * Resolve the `character` option to a definition (never undefined).
 *
 * Ids are resolved through `characterByAnyId`, so a legacy id from an old save
 * or an old event (`'robot'`, `'ninja'`) still draws the combination it always
 * meant instead of silently falling back to the default hero.
 */
export function resolveCharacter(character?: string | CharacterDef): CharacterDef {
  if (!character) return defaultCharacter();
  if (typeof character !== 'string') return character;
  return characterByAnyId(character) ?? defaultCharacter();
}

/**
 * Build the whole character. Returns SVG markup — colours live in
 * `styles/character.css` so the palette stays in one place.
 */
export function characterSvg(parts: PartsProgress, opts: CharacterSvgOptions = {}): string {
  const char = resolveCharacter(opts.character);
  const p = char.palette;
  const geo = characterGeometry(parts, char.geometry);
  const pulse = new Set<BodyPart>(opts.pulse ?? []);
  const cls = (part: BodyPart): string => `ch-part${pulse.has(part) ? ' pulse' : ''}`;
  const label = opts.label ?? 'הדמות שלך';
  const pecOffset = geo.chestHalf * geo.pecSpread;
  const group = (slot: EquipmentSlot): string => equipmentGroup(slot, geo, opts.equipment);
  const look = lookLayers(geo, char);
  // One gradient per character id: several characters share a page (the roster
  // strip draws them all), and two <defs> with the same id would make every
  // torso take the first one's colours.
  const grad = `chBody-${char.id}`;
  // The palette rides on custom properties, so `styles/character.css` stays THE
  // place colours are declared and a skin only overrides the values.
  const vars =
    `--ch-body:${p.body};--ch-body-2:${p.bodyDark};--ch-shade:${p.shade};` +
    `--ch-skin:${p.skin};--ch-line:${p.line};--ch-eye:${p.eye}`;

  return `<svg class="ch-svg" viewBox="0 0 200 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" data-character="${char.id}" data-skin="${char.skin}" data-body="${char.geometry}" style="${vars}">
  <defs>
    <linearGradient id="${grad}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.torsoTop}"/>
      <stop offset="100%" stop-color="${p.torsoBottom}"/>
    </linearGradient>${upgradeGlowDefs(opts.equipment)}
  </defs>
  <ellipse class="ch-shadow" cx="100" cy="306" rx="${n(geo.hipHalf + 16)}" ry="7"/>

  <!-- The cape hangs BEHIND the body, so it is the only equipment layer drawn
       before the character rather than after it. -->
  ${group('cape')}

  <!-- LONG HAIR, the part that falls past the shoulders: behind the torso (so
       the body reads first) but over the cape (hair rests on a cape). Empty for
       every short hairstyle, so nothing changes for the skins without one. -->
  ${look.cascade ? `<g class="ch-hair back">${look.cascade}</g>` : '<g class="ch-hair back"></g>'}

  <g class="${cls('legs')}" data-part="legs">${legGroup(geo, -1)}${legGroup(geo, 1)}</g>

  <g class="${cls('back')}" data-part="back">
    <path class="ch-lat" d="${latPath(geo, -1)}"/>
    <path class="ch-lat" d="${latPath(geo, 1)}"/>
  </g>

  <g class="ch-torso-group">
    <rect class="ch-limb-fill" x="${n(CX - geo.neckHalf)}" y="60" width="${n(geo.neckHalf * 2)}" height="30" rx="6"/>
    <path class="ch-torso" style="fill:url(#${grad})" d="${torsoPath(geo)}"/>
  </g>

  <g class="${cls('chest')}" data-part="chest">
    <ellipse class="ch-pec" cx="${n(CX - pecOffset)}" cy="${n(geo.pecY)}" rx="${n(geo.pecRx)}" ry="${n(geo.pecRy)}"/>
    <ellipse class="ch-pec" cx="${n(CX + pecOffset)}" cy="${n(geo.pecY)}" rx="${n(geo.pecRx)}" ry="${n(geo.pecRy)}"/>
  </g>

  <g class="${cls('core')}" data-part="core">${absGroup(geo)}</g>

  <g class="${cls('arms')}" data-part="arms">${armGroup(geo, -1)}${armGroup(geo, 1)}</g>

  <g class="${cls('shoulders')}" data-part="shoulders">
    <circle class="ch-delt" cx="${n(CX - geo.shoulderHalf)}" cy="${n(SHOULDER_Y + 2)}" r="${n(geo.deltoidR)}"/>
    <circle class="ch-delt" cx="${n(CX + geo.shoulderHalf)}" cy="${n(SHOULDER_Y + 2)}" r="${n(geo.deltoidR)}"/>
  </g>

  ${headGroup(geo, look)}

  <!-- Equipment layers worn ON TOP of the body (see characterAnchors). -->
  ${group('shoes')}
  ${group('belt')}
  ${group('gloves')}
  <g class="ch-trophies">${trophyPins(geo, opts.trophies ?? 0)}</g>
</svg>`;
}

/** Parts whose level differs between two snapshots — drives the pulse. */
export function grownParts(before: PartsProgress, after: PartsProgress): BodyPart[] {
  return BODY_PARTS.filter((p) => after[p].level > before[p].level);
}
