/**
 * ui/characterSvg.ts — the layered inline SVG character.
 *
 * PURE string builder (no DOM), so the geometry is unit-testable: every
 * proportion is a clamped function of a body-part level.
 *
 *   chest     -> pec mass + upper-torso width
 *   back      -> lat flare, i.e. the whole upper silhouette gets wider
 *   shoulders -> shoulder span + deltoid caps
 *   arms      -> arm thickness + bicep bulge
 *   legs      -> thigh/calf thickness + hip width
 *   core      -> waist tightens (V-taper) and the abs get more defined
 *
 * Growth is clamped at `BALANCE.character.visualMaxLevel`, so a very high level
 * stays a charming cartoon rather than a blob.
 *
 * LAYERS (draw order) — equipment hangs off the anchors in `characterAnchors`:
 *   shadow · [cape] · legs · lats · torso · pecs · abs · arms · deltoids ·
 *   head · [shoes · belt · gloves] · trophy medals
 * The cape is the one piece drawn BEFORE the body (it hangs behind it); every
 * other slot is worn on top. Every body group carries `data-part`, which is all
 * the level-up pulse and any part-targeted effect needs.
 */

import { BALANCE } from '../core/balance.ts';
import { clamp } from '../core/xp.ts';
import {
  equipmentById,
  type BossDef,
  type EquipmentDef,
  type EquipmentSlot,
} from '../data/gameContent.ts';
import { BODY_PARTS, type BodyPart } from '../data/program.ts';
import type { EquipmentState, PartsProgress } from '../storage/DataStore.ts';

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
  armW: number;
  bicepR: number;
  thighW: number;
  calfW: number;
  absOpacity: number;
}

/** Turn the six part levels into the drawing's proportions. */
export function characterGeometry(parts: PartsProgress): CharacterGeometry {
  const g: Record<BodyPart, number> = {
    chest: growth(parts.chest.level),
    back: growth(parts.back.level),
    legs: growth(parts.legs.level),
    shoulders: growth(parts.shoulders.level),
    arms: growth(parts.arms.level),
    core: growth(parts.core.level),
  };

  const shoulderHalf = 30 + 15 * g.shoulders + 7 * g.back;
  const chestHalf = 26 + 13 * g.chest + 7 * g.back;
  // Core tightens the waist; chest/back mass pushes it back out a little.
  const waistHalf = clamp(25 - 7 * g.core + 3 * g.chest + 2 * g.back, 15, 34);

  return {
    headR: 18,
    neckHalf: 8 + 3 * g.shoulders,
    shoulderHalf,
    deltoidR: 10 + 7 * g.shoulders,
    chestHalf,
    waistHalf,
    hipHalf: 25 + 4 * g.legs,
    latFlare: 4 + 16 * g.back,
    pecRx: 10 + 6 * g.chest,
    pecRy: 6 + 3.5 * g.chest,
    armW: 10 + 9 * g.arms + 2 * g.shoulders,
    bicepR: 5 + 4.5 * g.arms,
    thighW: 16 + 10 * g.legs,
    calfW: 11 + 6 * g.legs,
    absOpacity: 0.18 + 0.62 * g.core,
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
  const legX = CX + geo.hipHalf * 0.55;
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

/** Markup for one slot's group contents ('' when the slot is empty). */
export function equipmentLayer(
  slot: EquipmentSlot,
  geo: CharacterGeometry,
  equipped: Partial<Record<EquipmentSlot, string>>,
): string {
  const id = equipped[slot];
  if (!id) return '';
  const item = equipmentById(id);
  if (!item || item.slot !== slot) return '';
  return SLOT_DRAW[slot](geo, characterAnchors(geo), item);
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
  const x = (v: number): number => CX + side * v;
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

export interface CharacterSvgOptions {
  /** Parts to pulse right now (level-up celebration). */
  pulse?: readonly BodyPart[];
  /** Accessible label; a sensible Hebrew default is used when omitted. */
  label?: string;
  /** Owned/equipped shop items — only `equipped` is drawn. */
  equipment?: EquipmentState;
  /** How many world-boss medals to pin on the chest. */
  trophies?: number;
}

/**
 * Build the whole character. Returns SVG markup — colours live in
 * `styles/character.css` so the palette stays in one place.
 */
export function characterSvg(parts: PartsProgress, opts: CharacterSvgOptions = {}): string {
  const geo = characterGeometry(parts);
  const pulse = new Set<BodyPart>(opts.pulse ?? []);
  const cls = (part: BodyPart): string => `ch-part${pulse.has(part) ? ' pulse' : ''}`;
  const label = opts.label ?? 'הדמות שלך';
  const pecOffset = geo.chestHalf * 0.44;
  const equipped = opts.equipment?.equipped ?? {};
  const layer = (slot: EquipmentSlot): string => equipmentLayer(slot, geo, equipped);

  return `<svg class="ch-svg" viewBox="0 0 200 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="chBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5A76AE"/>
      <stop offset="100%" stop-color="#3B4E76"/>
    </linearGradient>
  </defs>
  <ellipse class="ch-shadow" cx="100" cy="306" rx="${n(geo.hipHalf + 16)}" ry="7"/>

  <!-- The cape hangs BEHIND the body, so it is the only equipment layer drawn
       before the character rather than after it. -->
  <g class="ch-equip" data-slot="cape">${layer('cape')}</g>

  <g class="${cls('legs')}" data-part="legs">${legGroup(geo, -1)}${legGroup(geo, 1)}</g>

  <g class="${cls('back')}" data-part="back">
    <path class="ch-lat" d="${latPath(geo, -1)}"/>
    <path class="ch-lat" d="${latPath(geo, 1)}"/>
  </g>

  <g class="ch-torso-group">
    <rect class="ch-limb-fill" x="${n(CX - geo.neckHalf)}" y="60" width="${n(geo.neckHalf * 2)}" height="30" rx="6"/>
    <path class="ch-torso" d="${torsoPath(geo)}"/>
  </g>

  <g class="${cls('chest')}" data-part="chest">
    <ellipse class="ch-pec" cx="${n(CX - pecOffset)}" cy="${n(CHEST_Y)}" rx="${n(geo.pecRx)}" ry="${n(geo.pecRy)}"/>
    <ellipse class="ch-pec" cx="${n(CX + pecOffset)}" cy="${n(CHEST_Y)}" rx="${n(geo.pecRx)}" ry="${n(geo.pecRy)}"/>
  </g>

  <g class="${cls('core')}" data-part="core">${absGroup(geo)}</g>

  <g class="${cls('arms')}" data-part="arms">${armGroup(geo, -1)}${armGroup(geo, 1)}</g>

  <g class="${cls('shoulders')}" data-part="shoulders">
    <circle class="ch-delt" cx="${n(CX - geo.shoulderHalf)}" cy="${n(SHOULDER_Y + 2)}" r="${n(geo.deltoidR)}"/>
    <circle class="ch-delt" cx="${n(CX + geo.shoulderHalf)}" cy="${n(SHOULDER_Y + 2)}" r="${n(geo.deltoidR)}"/>
  </g>

  <g class="ch-head">
    <circle class="ch-skin" cx="100" cy="${n(HEAD_CY)}" r="${n(geo.headR)}"/>
    <circle class="ch-eye" cx="93" cy="40" r="2.2"/>
    <circle class="ch-eye" cx="107" cy="40" r="2.2"/>
    <path class="ch-mouth" d="M 93 49 Q 100 54 107 49" fill="none" stroke-linecap="round"/>
  </g>

  <!-- Equipment layers worn ON TOP of the body (see characterAnchors). -->
  <g class="ch-equip" data-slot="shoes">${layer('shoes')}</g>
  <g class="ch-equip" data-slot="belt">${layer('belt')}</g>
  <g class="ch-equip" data-slot="gloves">${layer('gloves')}</g>
  <g class="ch-trophies">${trophyPins(geo, opts.trophies ?? 0)}</g>
</svg>`;
}

/** Parts whose level differs between two snapshots — drives the pulse. */
export function grownParts(before: PartsProgress, after: PartsProgress): BodyPart[] {
  return BODY_PARTS.filter((p) => after[p].level > before[p].level);
}
