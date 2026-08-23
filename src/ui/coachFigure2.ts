/**
 * ui/coachFigure2.ts — PROTOTYPE: a volumetric coach over the v1 skeleton.
 *
 * ORIGINAL ART. Every shape here is authored from numbers in this file. Nothing
 * is traced, copied or derived from any third-party image, GIF or video; the
 * only thing borrowed from the reference material we looked at is its
 * INFORMATION DESIGN — a solid human, one clearly marked working muscle, solid
 * equipment, and the path the load travels.
 *
 * WHY A SECOND RENDERER AND NOT A REWRITE. `ui/coachFigure.ts` is a rig (bone
 * lengths + absolute segment angles) and a renderer (bold strokes) fused into
 * one module. The rig is fine — `data/exercisePoses.ts` is 28 exercises' worth
 * of hand-solved angles riding on it — but the renderer draws a stick figure,
 * and a stick figure cannot say "this is your upper chest and it is under load
 * right now". So this module keeps `RIG`, `forwardKinematics`, `lerpPose` and
 * `ease` exactly as they are and replaces only the paint:
 *
 *   v1  one stroke per bone, one flat torso quad, a circle for a head
 *   v2  tapered capsules with real volume, a shaped torso, shorts, a profile
 *       head, gripping hands, shoes — plus a MUSCLE HIGHLIGHT layer and solid
 *       equipment with cushions and plates
 *
 * EVERY COLOUR IS INLINE, not a CSS class. v1 takes its palette from
 * `styles/coach.css`; this prototype ships its own so a single `demo2Svg()`
 * string is a complete picture in any host (the review page, a canvas, an
 * `<img src="data:image/svg+xml…">`). Integration can move it into tokens later.
 *
 * THE HIGHLIGHT IS GEOMETRY, NOT A DECAL. There is no second sprite pinned onto
 * the figure: `musclePatches()` is called from inside `figure2Svg()` with the
 * SAME `Joints` the limbs are drawn from, so a pec patch is an ellipse in the
 * torso's own local frame, a biceps patch is a short capsule slid onto the front
 * of the shoulder→elbow bone, and a hamstring patch is the same thing on the
 * back of the hip→knee bone. Repaint the figure
 * and the highlight has already moved with it — it cannot drift, because it is
 * not a separate thing that could drift.
 *
 * THE FIGURE HAS A FACING. v1 never needed one: a stroke has no front. A
 * volumetric torso does — the chest curve, the pec patch, the shorts and the
 * face all sit on one side of the spine — and the rig cannot infer it (both
 * sample exercises stand the pelvis at the same angle and face opposite ways).
 * So a v2 demo declares `facing: 1 | -1` and every local frame is built from it.
 *
 * Pure functions of numbers to SVG strings: no DOM, no clock, no randomness.
 */

import {
  RIG,
  STAGE,
  angleOf,
  dist,
  ease,
  forwardKinematics,
  lerpPose,
  n,
  step,
  type Joints,
  type Pose,
  type SideJoints,
  type Vec,
  type View,
} from './coachFigure.ts';

const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ colour */

/** Mix `hex` towards `to` by `f` (0 = unchanged, 1 = `to`). */
export function mixHex(hex: string, to: string, f: number): string {
  const a = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const b = /^#([0-9a-f]{6})$/i.exec(to.trim());
  if (!a || !b) return hex;
  const va = Number.parseInt(a[1] as string, 16);
  const vb = Number.parseInt(b[1] as string, 16);
  const k = Math.min(1, Math.max(0, f));
  const ch = (shift: number): string => {
    const ca = (va >> shift) & 0xff;
    const cb = (vb >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * k)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/**
 * THE PALETTE. Cool body, warm load, warmer muscle.
 *
 * The skin, shirt, shorts and outline are the RPG hero's family
 * (`data/characters.ts` CLASSIC: body `#4A5F8C`, shade `#5C77B0`, skin
 * `#C79B75`, line `#22304C`) pushed one step brighter, because this figure is
 * drawn at 160 units on a dark stage rather than at 200 on a lit one. The stage,
 * card and accent colours are the app's own tokens (`styles/tokens.css`). The
 * two highlight colours are the danger/warn tokens — the same red→amber the app
 * already uses for "this is the thing to look at".
 */
export const PAL = {
  /* ground */
  stage1: '#25314C',
  stage2: '#151D2E',
  ink: '#131A29',
  /* the body */
  skin: '#D9A377',
  skinShade: '#B37F57',
  shirt: '#4A5F8C',
  shirtShade: '#3A4D75',
  shorts: '#2C3B5E',
  hair: '#232D46',
  shoe: '#1E293E',
  shoeSole: '#8B96AB',
  line: '#161E30',
  /* the station */
  pad: '#5A6E96',
  padLight: '#7C8FB6',
  padDark: '#3D4C6E',
  frame: '#46587D',
  frameDark: '#2C3A55',
  /* the iron */
  iron: '#5A6C90',
  ironDark: '#33405C',
  plate: '#8FA2C6',
  /* the working muscle */
  hot1: '#EF4444',
  hot2: '#F59E0B',
} as const;

/** How far a far-side part is pushed into the background. */
const FAR_MIX = 0.44;

/** The far side of the body, one step towards the stage's own dark. */
function far(hex: string): string {
  return mixHex(hex, PAL.stage2, FAR_MIX);
}

/* ---------------------------------------------------------------- geometry */

/**
 * A TAPERED CAPSULE — the one shape this whole figure is built from.
 *
 * Two round caps of radius `ra` / `rb` at `a` / `b`, joined by their tangents
 * (approximated by the perpendiculars, which at these radii is invisible and
 * keeps the path four commands long). An upper arm is a fat cap at the shoulder
 * and a slim one at the elbow; the forearm carries on from that slim end, so a
 * limb reads as one continuous piece of muscle rather than two sticks.
 */
export function capsule(a: Vec, b: Vec, ra: number, rb: number): string {
  const ang = angleOf(a, b);
  const p1 = step(a, ang + 90, ra);
  const p2 = step(b, ang + 90, rb);
  const p3 = step(b, ang - 90, rb);
  const p4 = step(a, ang - 90, ra);
  return (
    `M ${n(p1.x)} ${n(p1.y)} L ${n(p2.x)} ${n(p2.y)} ` +
    `A ${n(rb)} ${n(rb)} 0 0 0 ${n(p3.x)} ${n(p3.y)} ` +
    `L ${n(p4.x)} ${n(p4.y)} ` +
    `A ${n(ra)} ${n(ra)} 0 0 0 ${n(p1.x)} ${n(p1.y)} Z`
  );
}

function ell(c: Vec, rx: number, ry: number, rot: number, fill: string, extra = ''): string {
  return (
    `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(rx)}" ry="${n(ry)}" ` +
    `transform="rotate(${n(rot)} ${n(c.x)} ${n(c.y)})" fill="${fill}"${extra ? ' ' + extra : ''}/>`
  );
}

function circ(c: Vec, r: number, fill: string, extra = ''): string {
  return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
}

/** Fill + hairline outline — the cartoon look every part of the body shares. */
function inked(d: string, fill: string, w = 1.2, stroke: string = PAL.line): string {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}" stroke-linejoin="round"/>`;
}

/**
 * THE TORSO'S LOCAL FRAME: origin at the pelvis, `up` towards the shoulders,
 * `front` the perpendicular the chest faces. Everything torso-shaped — the
 * silhouette, the shorts, the pec/ab/back patches — is authored in `(t, off)`
 * here and therefore rotates and translates with the pose for free.
 */
export interface BodyFrame {
  readonly origin: Vec;
  readonly len: number;
  readonly up: number;
  readonly front: number;
}

function frontOf(axis: number, facing: 1 | -1): number {
  const a = axis + 90;
  const b = axis - 90;
  return Math.cos(a * D2R) * facing >= Math.cos(b * D2R) * facing ? a : b;
}

export function bodyFrame(j: Joints, facing: 1 | -1): BodyFrame {
  const up = angleOf(j.pelvis, j.shoulders);
  return { origin: j.pelvis, len: Math.max(1, dist(j.pelvis, j.shoulders)), up, front: frontOf(up, facing) };
}

/** A point `t` of the way up the spine and `off` in front of it (negative = behind). */
function tp(f: BodyFrame, t: number, off: number): Vec {
  return step(step(f.origin, f.up, t * f.len), f.front, off);
}

/* ------------------------------------------------------------------ torso */

/**
 * The torso silhouette, seen from the side: a chest that swells forward above
 * the sternum, a waist that draws in, a seat that rounds off behind the hips,
 * and a shoulder crown that is the widest thing on the figure. Authored as one
 * closed bezier in the body frame so it deforms with the spine.
 */
export function torsoOutline(f: BodyFrame): string {
  const p = (t: number, o: number): string => {
    const v = tp(f, t, o);
    return `${n(v.x)} ${n(v.y)}`;
  };
  return (
    `M ${p(-0.08, -5.8)} ` +
    `C ${p(0.22, -6.0)} ${p(0.62, -6.1)} ${p(1.02, -6.9)} ` +
    `Q ${p(1.24, -5.4)} ${p(1.2, 0.4)} ` +
    `C ${p(1.16, 5.6)} ${p(1.02, 7.4)} ${p(0.8, 7.9)} ` +
    `C ${p(0.62, 7.4)} ${p(0.52, 5.8)} ${p(0.36, 5.2)} ` +
    `C ${p(0.2, 5.4)} ${p(0.0, 5.8)} ${p(-0.08, 6.0)} ` +
    `Q ${p(-0.24, 0.1)} ${p(-0.08, -5.8)} Z`
  );
}

/* --------------------------------------------------------- muscle highlight */

export type MuscleRegion = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core';

/** The Hebrew name each region is chipped with, when a demo does not override it. */
export const MUSCLE_HE: Record<MuscleRegion, string> = {
  chest: 'חזה',
  back: 'גב',
  shoulders: 'כתפיים',
  arms: 'זרועות',
  legs: 'ירך אחורית וישבן',
  core: 'ליבה',
};

/**
 * A region resolved onto ONE side of the body: what it paints on the torso, what
 * it paints on a limb, and — the part that matters — WHICH limb, so the arm
 * layer never paints the thigh's patch (from the side, a hanging arm and a
 * standing thigh occupy the very same rectangle, and drawing the patch in both
 * layers puts a hamstring on a forearm).
 */
interface MusclePatch {
  readonly onTorso: string;
  /** Painted on the SHORTS instead — the glute is under them, not above them. */
  readonly onShorts?: string;
  readonly loose: string;
  readonly limb: 'arm' | 'leg' | null;
}

/**
 * WHERE A REGION LIVES ON THE BODY, as shapes in the pose's own coordinates.
 *
 * `onTorso` (and `onShorts`) shapes are clipped to the garment they are painted
 * on, so a pec patch can never spill past the chest; `loose` shapes ride a bone
 * and are drawn narrower and shorter than the limb itself, which is what leaves
 * a rim of skin around them and keeps a highlight from reading as a paint job.
 */
function musclePatches(
  region: MuscleRegion,
  f: BodyFrame,
  s: SideJoints,
  scale: number,
  facing: 1 | -1,
): MusclePatch {
  const k = (v: number): number => v * scale;
  const hot = (d: string): string => `<path d="${d}" fill="url(#HOT)"/>`;
  /** A muscle BELLY on a bone: shorter than the bone and slid to one face of it. */
  const belly = (
    a: Vec,
    b: Vec,
    trim: readonly [number, number],
    r: readonly [number, number],
    side: 'front' | 'back',
    off: number,
  ): string => {
    const ang = angleOf(a, b);
    const face = side === 'front' ? frontOf(ang, facing) : frontOf(ang, facing) + 180;
    const p = step(step(a, ang, k(trim[0])), face, k(off));
    const q = step(step(b, ang, -k(trim[1])), face, k(off * 0.7));
    return hot(capsule(p, q, k(r[0]), k(r[1])));
  };
  switch (region) {
    case 'chest':
      // The pec sits high and forward — between the sternum and the shoulder —
      // and is clipped by the torso, so it can bulge without leaking.
      return {
        onTorso:
          ell(tp(f, 0.8, 3.4), k(6.0), k(4.6), f.up + 90, 'url(#HOT)') +
          ell(tp(f, 0.58, 3.6), k(4.6), k(3.4), f.up + 90, 'url(#HOT)', 'opacity=".8"'),
        loose: '',
        limb: null,
      };
    case 'back':
      return {
        onTorso:
          ell(tp(f, 0.72, -3.2), k(6.6), k(4.2), f.up + 90, 'url(#HOT)') +
          ell(tp(f, 0.34, -3.4), k(4.8), k(3.0), f.up + 90, 'url(#HOT)', 'opacity=".85"'),
        loose: '',
        limb: null,
      };
    case 'core':
      return { onTorso: ell(tp(f, 0.38, 2.2), k(5.2), k(5.0), f.up + 90, 'url(#HOT)'), loose: '', limb: null };
    case 'shoulders':
      return { onTorso: '', loose: circ(s.shoulder, k(4.6), 'url(#HOT)'), limb: 'arm' };
    case 'arms':
      return { onTorso: '', loose: belly(s.shoulder, s.elbow, [2.6, 1.4], [3.6, 2.8], 'front', 0.6), limb: 'arm' };
    case 'legs':
      // Hamstring + glute: the BACK of the thigh (a hinge is not felt in the
      // quad) plus the seat of the pelvis, which the shorts cover.
      return {
        onTorso: '',
        onShorts: ell(tp(f, -0.06, -2.6), k(4.6), k(3.6), f.up + 90, 'url(#HOT)'),
        loose: belly(s.hip, s.knee, [1.8, 1.2], [4.3, 3.2], 'back', 0.9),
        limb: 'leg',
      };
  }
}

/* ------------------------------------------------------------------- limbs */

interface Skin {
  readonly skin: string;
  readonly skinShade: string;
  readonly shorts: string;
  readonly shirt: string;
  readonly shoe: string;
  readonly sole: string;
  readonly line: string;
  readonly iron: string;
  readonly ironDark: string;
  readonly plate: string;
  readonly w: number;
}

const NEAR_SKIN: Skin = {
  skin: PAL.skin,
  skinShade: PAL.skinShade,
  shorts: PAL.shorts,
  shirt: PAL.shirt,
  shoe: PAL.shoe,
  sole: PAL.shoeSole,
  line: PAL.line,
  iron: PAL.iron,
  ironDark: PAL.ironDark,
  plate: PAL.plate,
  w: 1.2,
};

const FAR_SKIN: Skin = {
  skin: far(PAL.skin),
  skinShade: far(PAL.skinShade),
  shorts: far(PAL.shorts),
  shirt: far(PAL.shirt),
  shoe: far(PAL.shoe),
  sole: far(PAL.shoeSole),
  line: mixHex(PAL.line, PAL.stage2, 0.3),
  iron: far(PAL.iron),
  ironDark: far(PAL.ironDark),
  plate: far(PAL.plate),
  w: 1.0,
};

/** The far side is drawn a touch slimmer as well as dimmer — cheap perspective. */
const FAR_SCALE = 0.9;

/**
 * THE ROUNDING SHADE: a slim darker capsule laid along one edge of a limb, so a
 * flat fill reads as a cylinder. It goes on the BACK edge of the limb (the side
 * away from the light, which this stage puts up and in front), which is also
 * why it needs the figure's facing.
 */
function limbShade(a: Vec, b: Vec, ra: number, rb: number, facing: 1 | -1, col: string): string {
  const ang = angleOf(a, b);
  const back = frontOf(ang, facing) + 180;
  const p = step(a, back, ra * 0.5);
  const q = step(b, back, rb * 0.5);
  return `<path d="${capsule(p, q, ra * 0.44, rb * 0.44)}" fill="${col}" opacity=".33"/>`;
}

/**
 * A leg: thigh (fat at the hip, slimmer at the knee), shin (slimmer again), a
 * knee cap that hides the seam, a shoe, and the short leg of the shorts on top.
 */
function legSvg(s: SideJoints, sk: Skin, scale: number, hi: string, facing: 1 | -1): string {
  const k = (v: number): number => v * scale;
  const shoeAng = angleOf(s.ankle, s.toe);
  const heel = step(s.ankle, shoeAng + 180, k(1.6));
  const toeTip = step(s.toe, shoeAng, k(0.6));
  return (
    inked(capsule(s.hip, s.knee, k(5.6), k(4.2)), sk.skin, sk.w, sk.line) +
    inked(capsule(s.knee, s.ankle, k(4.2), k(2.9)), sk.skin, sk.w, sk.line) +
    circ(s.knee, k(4.0), sk.skin) +
    limbShade(s.hip, s.knee, k(5.6), k(4.2), facing, sk.skinShade) +
    limbShade(s.knee, s.ankle, k(4.2), k(2.9), facing, sk.skinShade) +
    hi +
    // the shoe: a wedge with a pale sole line, so a foot has a front and a back
    inked(capsule(heel, toeTip, k(3.3), k(2.4)), sk.shoe, sk.w, sk.line) +
    `<path d="${capsule(step(heel, shoeAng + 90, k(2.6)), step(toeTip, shoeAng + 90, k(1.9)), k(0.55), k(0.5))}" fill="${sk.sole}" opacity=".7"/>` +
    // the shorts' leg, drawn last so it sits ON the thigh
    inked(capsule(s.hip, step(s.hip, angleOf(s.hip, s.knee), k(3.2)), k(5.9), k(4.9)), sk.shorts, sk.w, sk.line)
  );
}

/**
 * An arm: a deltoid cap over the shoulder seam, upper arm, forearm, elbow cap,
 * and the palm. The palm sits a little short of the grip point so that whatever
 * `hold2Svg` draws at the grip lands INSIDE the hand rather than beyond it.
 */
function armSvg(s: SideJoints, sk: Skin, scale: number, hi: string, facing: 1 | -1): string {
  const k = (v: number): number => v * scale;
  const fa = angleOf(s.elbow, s.wrist);
  const ua = angleOf(s.shoulder, s.elbow);
  return (
    inked(capsule(s.shoulder, s.elbow, k(4.6), k(3.4)), sk.skin, sk.w, sk.line) +
    inked(capsule(s.elbow, s.wrist, k(3.4), k(2.5)), sk.skin, sk.w, sk.line) +
    circ(s.elbow, k(3.2), sk.skin) +
    limbShade(s.shoulder, s.elbow, k(4.6), k(3.4), facing, sk.skinShade) +
    limbShade(s.elbow, s.wrist, k(3.4), k(2.5), facing, sk.skinShade) +
    hi +
    // THE SLEEVE. Seen from the side a hanging arm sits square on top of the
    // torso and, skin on skin, the two merge into one column. A shirt sleeve
    // over the top third of the upper arm is what tells them apart — and it is
    // what makes this figure read as dressed rather than as a mannequin.
    inked(
      capsule(step(s.shoulder, ua, k(-1.2)), step(s.shoulder, ua, k(4.4)), k(4.8), k(4.2)),
      sk.shirt,
      sk.w,
      sk.line,
    ) +
    `<path d="${capsule(step(step(s.shoulder, ua, k(-1.0)), frontOf(ua, facing) + 180, k(2.2)), step(step(s.shoulder, ua, k(4.2)), frontOf(ua, facing) + 180, k(1.8)), k(1.9), k(1.7))}" fill="${PAL.ink}" opacity=".22"/>` +
    inked(capsule(step(s.wrist, fa, k(0.6)), step(s.wrist, fa, k(2.6)), k(2.9), k(2.6)), sk.skin, sk.w, sk.line)
  );
}

/* ------------------------------------------------------------------ the head */

/**
 * A PROFILE, not a ball. Hair is a disc pushed back, the skull a disc pushed
 * forward, and the crescent where they differ is the hairline. On top of that:
 * a brow, an eye, a nose wedge, a mouth and an ear — six marks, which is all it
 * takes for a 7-unit head to have a direction at 320px and still read as a head
 * at 180px.
 */
function headSvg(j: Joints, f: BodyFrame, sk: Skin, scale: number): string {
  // 0.87: the rig's `headR` was sized for a stick figure's ball head. A drawn
  // skull with hair on it reads BIGGER than the circle it replaces, so it is
  // taken in until the figure is about six heads tall — cartoon, not chibi.
  const k = (v: number): number => v * scale * 0.87;
  const c = j.head;
  const crown = angleOf(j.neck, j.head);
  const front = frontOf(crown, Math.cos(f.front * D2R) >= 0 ? 1 : -1);
  /** A point in HEAD coordinates: `fv` forward of the face, `uv` up the crown. */
  const at = (fv: number, uv: number): Vec => step(step(c, front, k(fv)), crown, k(uv));
  const P = (fv: number, uv: number): string => {
    const v = at(fv, uv);
    return `${n(v.x)} ${n(v.y)}`;
  };
  const line = (a: Vec, b: Vec, w: number, col: string, op = 1): string =>
    `<path d="M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}" stroke="${col}" stroke-width="${n(w)}" ` +
    `stroke-linecap="round" fill="none"${op < 1 ? ` opacity="${op}"` : ''}/>`;

  // THE PROFILE, as one closed outline: crown, forehead, brow, nose, lip, chin,
  // jaw, back of the skull. Every landmark is in head units, so it survives the
  // head rotating with the spine and shrinking to 180px.
  const profile =
    `M ${P(-5.6, 2.8)} ` +
    `C ${P(-5.4, 6.0)} ${P(-1.6, 6.4)} ${P(2.2, 5.4)} ` +
    `C ${P(4.6, 4.6)} ${P(5.4, 3.0)} ${P(5.2, 1.2)} ` +
    `C ${P(5.6, 0.4)} ${P(7.2, -0.2)} ${P(6.9, -1.4)} ` +
    `C ${P(6.6, -2.1)} ${P(5.6, -2.1)} ${P(4.9, -2.4)} ` +
    `C ${P(5.4, -2.9)} ${P(5.1, -3.4)} ${P(4.4, -4.2)} ` +
    `C ${P(3.0, -5.6)} ${P(-1.4, -5.6)} ${P(-3.8, -4.0)} ` +
    `C ${P(-5.6, -2.6)} ${P(-6.0, 0.2)} ${P(-5.6, 2.8)} Z`;

  // The hair sits ON that skull: over the crown and down the back, stopping at
  // the temple so the face stays a face.
  const hair =
    `M ${P(3.4, 4.6)} ` +
    `C ${P(1.0, 7.2)} ${P(-4.4, 7.4)} ${P(-6.4, 3.6)} ` +
    `C ${P(-7.2, 1.0)} ${P(-6.8, -1.8)} ${P(-5.6, -3.4)} ` +
    `C ${P(-5.6, -1.0)} ${P(-5.2, 1.6)} ${P(-3.8, 3.0)} ` +
    `C ${P(-2.0, 4.8)} ${P(1.0, 5.0)} ${P(3.4, 4.6)} Z`;

  const hairCol = sk.skin === PAL.skin ? PAL.hair : far(PAL.hair);
  return (
    inked(profile, sk.skin, sk.w * 0.95, sk.line) +
    inked(hair, hairCol, sk.w, sk.line) +
    // ear: quiet, one shade down, no outline of its own
    `<path d="${capsule(at(-2.9, 0.2), at(-2.6, -0.8), k(0.9), k(0.85))}" fill="${sk.skinShade}" opacity=".55"/>` +
    circ(at(3.0, 1.2), k(0.85), PAL.ink) +
    line(at(2.0, 2.8), at(4.2, 2.4), k(0.8), PAL.ink, 0.8) +
    line(at(4.1, -3.1), at(2.9, -3.4), k(0.7), PAL.ink, 0.7)
  );
}

/* -------------------------------------------------------------- the iron */

export type HoldV2 = { readonly k: 'none' } | { readonly k: 'db' };

/**
 * One dumbbell at a grip point: a handle with a plate stack on each end.
 *
 * FORESHORTENED ON PURPOSE. Both sample lifts are drawn from the side, where a
 * normally-gripped dumbbell points straight at the camera and its honest
 * projection is a bare disc — unreadable as a dumbbell. So the bell is drawn at
 * roughly 60% of its length, the three-quarter view every equipment diagram
 * uses: you get the handle AND the plates, and it still cannot reach across the
 * body and collide with a shin.
 *
 * It is drawn BEFORE the hand's finger wrap (`handWrap`), so the hand closes
 * over the handle instead of floating beside it.
 */
function dumbbell2(p: Vec, axis: number, sk: Skin, scale: number): { behind: string; front: string } {
  const k = (v: number): number => v * scale;
  const plate = (c: Vec, r: number, dim: number): string =>
    circ(c, r, dim > 0 ? mixHex(sk.iron, PAL.stage2, dim) : sk.iron, `stroke="${sk.line}" stroke-width="${n(sk.w * 1.15)}"`) +
    circ(c, r * 0.3, sk.plate, `opacity="${n(0.5 - dim * 0.4)}"`) +
    `<path d="${capsule(step(c, axis + 116, r * 0.72), step(c, axis + 186, r * 0.72), k(0.5), k(0.5))}" fill="#C9D4E8" opacity="${n(0.4 - dim * 0.3)}"/>`;
  return {
    // the FAR plate and the handle go behind the fist…
    behind:
      plate(step(p, axis + 180, k(3.2)), k(2.7), 0.35) +
      inked(capsule(step(p, axis, k(3.4)), step(p, axis + 180, k(3.4)), k(1.35), k(1.35)), sk.ironDark, sk.w, sk.line),
    // …and the NEAR plate in front of it, bigger, because it is closer to the
    // camera. That asymmetry is the whole reason this reads as one dumbbell in
    // three-quarter view rather than as a symmetrical ring.
    front: plate(step(p, axis, k(2.9)), k(3.7), 0),
  };
}

/** The fingers, closed over whatever is at the grip point. */
function handWrap(s: SideJoints, sk: Skin, scale: number): string {
  const k = (v: number): number => v * scale;
  const fa = angleOf(s.elbow, s.wrist);
  return (
    inked(capsule(step(s.grip, fa, k(-1.9)), step(s.grip, fa, k(0.9)), k(2.7), k(2.3)), sk.skin, sk.w, sk.line) +
    // the thumb, a short bar across the handle
    `<path d="${capsule(step(s.grip, fa + 70, k(1.4)), step(s.grip, fa - 70, k(1.4)), k(1.0), k(1.0))}" fill="${sk.skinShade}" opacity=".95"/>`
  );
}

/** What one side's hand is holding, with the fist closed between its plates. */
function hold2Svg(hold: HoldV2, s: SideJoints, sk: Skin, scale: number): string {
  if (hold.k === 'none') return '';
  const db = dumbbell2(s.grip, angleOf(s.elbow, s.wrist) + 90, sk, scale);
  return db.behind + handWrap(s, sk, scale) + db.front;
}

/* ------------------------------------------------------------------ figure */

export type Layer = 'farLeg' | 'farArm' | 'body' | 'nearLeg' | 'nearArm';

export interface FigureStyle {
  readonly facing: 1 | -1;
  /** Back to front. Which side's arm hides behind the torso is per-exercise. */
  readonly order: readonly Layer[];
  readonly primary: MuscleRegion;
  readonly secondary?: MuscleRegion;
  readonly hold: HoldV2;
}

/**
 * Opacity of the primary / secondary highlight, and how far the far side's copy
 * of it is faded. The primary is deliberately BELOW 1: the muscle has to look
 * painted onto a body that is still visible underneath it, not like a neon
 * cut-out pasted over the limb.
 */
const HI_MAIN = 0.8;
const HI_SECOND = 0.45;
const HI_FAR = 0.42;

function highlightGroup(body: string, glow: boolean, opacity: number): string {
  if (!body) return '';
  const soft = glow ? `<g filter="url(#GLOW)" opacity=".4">${body}</g>` : '';
  return `<g opacity="${n(opacity)}">${soft}${body}</g>`;
}

/**
 * THE WHOLE FIGURE at one pose. Draw order is depth order, and the caller
 * declares it: a lying press wants the far arm behind the torso and the near
 * leg in front of it; a standing hinge wants the far leg first and both arms in
 * front of everything.
 *
 * `clipId` must be unique per mounted demo — the torso clip path is rebuilt on
 * every frame because the torso itself is.
 */
export function figure2Svg(j: Joints, style: FigureStyle, clipId: string): string {
  const f = bodyFrame(j, style.facing);
  const torso = torsoOutline(f);

  const sidePatches = (s: SideJoints, scale: number): { main: MusclePatch; second: MusclePatch | null } => ({
    main: musclePatches(style.primary, f, s, scale, style.facing),
    second: style.secondary ? musclePatches(style.secondary, f, s, scale, style.facing) : null,
  });
  const nearP = sidePatches(j.near, 1);
  const farP = sidePatches(j.far, FAR_SCALE);

  /**
   * The highlight ONE limb layer gets: only the regions that live on that limb.
   * This is the guard that keeps a hamstring off a forearm — from the side, a
   * hanging arm and a standing thigh cover the same patch of stage.
   */
  const limbHi = (p: { main: MusclePatch; second: MusclePatch | null }, limb: 'arm' | 'leg', dim: number): string =>
    (p.main.limb === limb ? highlightGroup(p.main.loose, dim === 1, HI_MAIN * dim) : '') +
    (p.second && p.second.limb === limb ? highlightGroup(p.second.loose, false, HI_SECOND * dim) : '');

  const torsoHi =
    highlightGroup(nearP.main.onTorso, true, HI_MAIN) +
    (nearP.second ? highlightGroup(nearP.second.onTorso, false, HI_SECOND) : '');
  const shortsPath = capsule(tp(f, 0.16, 0.2), tp(f, -0.28, 0.2), 5.3, 5.5);
  const shorts = inked(shortsPath, PAL.shorts, 1.3);
  const shortsHi =
    highlightGroup(nearP.main.onShorts ?? '', true, HI_MAIN) +
    (nearP.second ? highlightGroup(nearP.second.onShorts ?? '', false, HI_SECOND) : '');

  const layers: Record<Layer, string> = {
    farLeg: legSvg(j.far, FAR_SKIN, FAR_SCALE, limbHi(farP, 'leg', HI_FAR), style.facing),
    farArm:
      armSvg(j.far, FAR_SKIN, FAR_SCALE, limbHi(farP, 'arm', HI_FAR), style.facing) +
      hold2Svg(style.hold, j.far, FAR_SKIN, FAR_SCALE),
    body:
      // neck first (it tucks under the collar), then the torso, then everything
      // painted ON the torso, then the shorts block, then the head.
      inked(capsule(j.shoulders, step(j.head, angleOf(j.head, j.neck), 3.6), 3.6, 3.1), PAL.skinShade, 1.2) +
      inked(torso, PAL.shirt, 1.5) +
      `<clipPath id="${clipId}"><path d="${torso}"/></clipPath>` +
      `<g clip-path="url(#${clipId})">` +
      `<path d="${capsule(tp(f, 0.98, -2.6), tp(f, 0.02, -2.4), 3.4, 3.6)}" fill="${PAL.shirtShade}" opacity=".7"/>` +
      torsoHi +
      // the shirt's own tailoring — a hem at the waist, a collar at the throat
      `<path d="${capsule(tp(f, 0.3, -6.4), tp(f, 0.26, 6.4), 0.7, 0.7)}" fill="${PAL.line}" opacity=".45"/>` +
      `<path d="${capsule(tp(f, 1.02, -3.4), tp(f, 0.92, 3.0), 0.8, 0.8)}" fill="${PAL.line}" opacity=".4"/>` +
      `</g>` +
      shorts +
      `<clipPath id="${clipId}-s"><path d="${shortsPath}"/></clipPath>` +
      `<g clip-path="url(#${clipId}-s)">${shortsHi}</g>` +
      headSvg(j, f, NEAR_SKIN, 1),
    nearLeg: legSvg(j.near, NEAR_SKIN, 1, limbHi(nearP, 'leg', 1), style.facing),
    nearArm:
      armSvg(j.near, NEAR_SKIN, 1, limbHi(nearP, 'arm', 1), style.facing) +
      hold2Svg(style.hold, j.near, NEAR_SKIN, 1),
  };

  return `<g>${style.order.map((l) => layers[l]).join('')}</g>`;
}

/* --------------------------------------------------------------- equipment */

/** The floor: a band with a lit edge, so the figure stands ON something. */
export function floor2(x1: number, x2: number, y: number = STAGE.floorY): string {
  return (
    `<rect x="${n(x1)}" y="${n(y)}" width="${n(x2 - x1)}" height="${n(STAGE.h - y)}" fill="${PAL.frameDark}" opacity=".55"/>` +
    `<path d="M ${n(x1)} ${n(y)} L ${n(x2)} ${n(y)}" stroke="${PAL.frame}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`
  );
}

/** The soft shadow a body throws on that floor. */
export function shadow2(cx: number, rx: number, y: number = STAGE.floorY): string {
  return ell({ x: cx, y: y + 0.6 }, rx, 2.6, 0, PAL.ink, 'opacity=".45"');
}

/** One padded slab: `a`→`b` is its TOP surface, and it is `th` thick under it. */
export function padSlab(a: Vec, b: Vec, th: number): string {
  const ang = angleOf(a, b);
  const down = ang + 90;
  const r = th / 2;
  const ca = step(a, down, r);
  const cb = step(b, down, r);
  return (
    inked(capsule(ca, cb, r, r), PAL.pad, 1.3) +
    `<path d="${capsule(step(a, down, r * 0.55), step(b, down, r * 0.55), r * 0.42, r * 0.42)}" fill="${PAL.padLight}" opacity=".5"/>`
  );
}

/** A frame member: a solid post or strut of width `w`. */
export function strut(a: Vec, b: Vec, w = 3.2): string {
  return inked(capsule(a, b, w / 2, w / 2), PAL.frame, 1.2);
}

/**
 * AN INCLINE BENCH, drawn as a bench: a back pad on its rise, a seat pad at the
 * bottom of it, a post under each, and a base on the floor. `(x, y)` is the
 * HINGE — where the two pads meet — and `angle` the rise of the back pad.
 */
export function inclineBench2(o: {
  x: number;
  y: number;
  len: number;
  angle: number;
  seat: number;
  floorY?: number;
}): string {
  const floorY = o.floorY ?? STAGE.floorY;
  const hinge: Vec = { x: o.x, y: o.y };
  const top = step(hinge, o.angle, o.len);
  const seatEnd: Vec = { x: o.x - o.seat, y: o.y + 1.2 };
  const post = (p: Vec, w: number): string => strut({ x: p.x, y: p.y + 2 }, { x: p.x, y: floorY }, w);
  return (
    // base first, then the posts, then the pads on top of them
    strut({ x: seatEnd.x - 3, y: floorY - 1.4 }, { x: top.x + 2, y: floorY - 1.4 }, 3.4) +
    post({ x: seatEnd.x + 2, y: seatEnd.y }, 3.4) +
    post({ x: top.x - 1.5, y: top.y }, 3.4) +
    strut({ x: top.x - 1.5, y: top.y + 6 }, { x: hinge.x + 4, y: floorY - 2 }, 2.6) +
    padSlab(seatEnd, hinge, 6.4) +
    padSlab(hinge, top, 7.2)
  );
}

/* ------------------------------------------------------------------ tempo */

const FALLBACK: Pose = {
  x: 80,
  y: 60,
  torso: -90,
  head: -90,
  arm: [90, 90],
  armF: [90, 90],
  leg: [90, 90, 0],
  legF: [90, 90, 0],
};

/** The pose `u` (0→1) of the way through the FORWARD pass of the keyframes. */
export function frameAt(frames: readonly Pose[], u: number): Pose {
  const last = frames.length - 1;
  const first = frames[0] ?? FALLBACK;
  if (last <= 0) return first;
  const p = Math.min(1, Math.max(0, u)) * last;
  const i = Math.min(last - 1, Math.floor(p));
  const a = frames[i] ?? first;
  const b = frames[i + 1] ?? first;
  return lerpPose(a, b, p - i);
}

/* ------------------------------------------------------------ the demo type */

export interface DemoV2 {
  readonly id: string;
  readonly he: string;
  readonly en: string;
  readonly view: View;
  readonly facing: 1 | -1;
  readonly loopMs: number;
  /**
   * How much of the loop the FORWARD pass gets. A rep is not symmetric — the
   * eccentric is the slow half — so a press (frames = bottom→top, i.e. forward
   * is the concentric) asks for less than half, and a hinge (frames =
   * standing→bottom, forward is the eccentric) asks for more.
   */
  readonly forwardShare: number;
  readonly frames: readonly Pose[];
  readonly order: readonly Layer[];
  readonly props: () => string;
  readonly hold: HoldV2;
  readonly primary: MuscleRegion;
  readonly secondary?: MuscleRegion;
  /** Hebrew muscle names for the legend chip, primary first. */
  readonly muscles: readonly string[];
  /**
   * THE CAMERA: `[x, y, w, h]` of the stage this demo is cropped to.
   *
   * v1 drew every exercise on the whole 160×120 stage because a stick figure
   * survives being small. A volumetric one does not — a face, a grip and a
   * muscle patch all want pixels — and a lying press and a standing hinge do
   * not occupy remotely the same rectangle. So each demo frames itself, which
   * costs four numbers and buys ~1.5× on the figure at the same card width.
   */
  readonly frame: readonly [number, number, number, number];
  /**
   * Nudge for the movement-path guide, `[dx, dy]`.
   *
   * The path is sampled from the grip, so by construction it runs THROUGH the
   * arms that carry the load — and in a standing lift the arm hangs over it for
   * most of the rep, leaving the guide invisible. A few units of clearance in
   * front of the body keeps the shape (which is the information) and buys back
   * the visibility. Omit it wherever the load already travels through open air.
   */
  readonly arcShift?: readonly [number, number];
}

/**
 * The pose `ms` into the loop. Same cosine ease as v1, but applied to each half
 * of the yoyo separately with its own share of the clock, which is the cheapest
 * honest tempo: the lift snaps, the lowering takes its time.
 */
export function poseAt2(cfg: DemoV2, ms: number): Pose {
  const cycle = cfg.loopMs > 0 ? cfg.loopMs : 1;
  const t = (((ms % cycle) + cycle) % cycle) / cycle;
  const fs = Math.min(0.85, Math.max(0.15, cfg.forwardShare));
  const u = t < fs ? ease(t / fs) : 1 - ease((t - fs) / (1 - fs));
  return frameAt(cfg.frames, u);
}

/* ------------------------------------------------------------ movement path */

/**
 * THE PATH THE LOAD TRAVELS, sampled from the same forward kinematics that put
 * the dumbbell in the hand: 24 grip positions across the forward pass, drawn
 * once as a dashed guide with an arrowhead at the finish. It is static because
 * it is a fact about the movement, not about this frame.
 */
export function motionPathSvg(cfg: DemoV2): string {
  const pts: Vec[] = [];
  const samples = 24;
  const [dx, dy] = cfg.arcShift ?? [0, 0];
  for (let i = 0; i <= samples; i++) {
    const g = forwardKinematics(frameAt(cfg.frames, i / samples), cfg.view).near.grip;
    pts.push({ x: g.x + dx, y: g.y + dy });
  }
  const head = pts[pts.length - 1] as Vec;
  const prev = pts[pts.length - 3] ?? head;
  const travel = dist(pts[0] as Vec, head);
  if (travel < 6) return '';
  const a = angleOf(prev, head);
  const tip = step(head, a, 3.4);
  const l = step(head, a + 132, 3.6);
  const r = step(head, a - 132, 3.6);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ');
  return (
    `<g opacity=".55">` +
    `<path d="${d}" fill="none" stroke="${PAL.hot2}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3.2 3.4"/>` +
    `<path d="M ${n(tip.x)} ${n(tip.y)} L ${n(l.x)} ${n(l.y)} L ${n(r.x)} ${n(r.y)} Z" fill="${PAL.hot2}"/>` +
    `</g>`
  );
}

/* ------------------------------------------------------------------ the SVG */

/**
 * The defs every stage needs: the muscle gradient, its glow, and the stage's
 * own vignette. IDs are global on purpose — two demos on one page share one
 * gradient, and the only per-instance id is the torso clip path.
 */
export function defs2Svg(): string {
  return (
    `<defs>` +
    `<linearGradient id="HOT" x1="0" y1="1" x2="0.6" y2="0">` +
    `<stop offset="0" stop-color="${PAL.hot1}"/><stop offset="1" stop-color="${PAL.hot2}"/>` +
    `</linearGradient>` +
    `<filter id="GLOW" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="2.4"/>` +
    `</filter>` +
    `<radialGradient id="STAGE" cx="0.5" cy="0.4" r="0.75">` +
    `<stop offset="0" stop-color="${PAL.stage1}"/><stop offset="1" stop-color="${PAL.stage2}"/>` +
    `</radialGradient>` +
    `</defs>`
  );
}

function styleOf(cfg: DemoV2): FigureStyle {
  return cfg.secondary === undefined
    ? { facing: cfg.facing, order: cfg.order, primary: cfg.primary, hold: cfg.hold }
    : { facing: cfg.facing, order: cfg.order, primary: cfg.primary, secondary: cfg.secondary, hold: cfg.hold };
}

/**
 * The id of a demo's torso clip path. The clip is rebuilt on every repaint (the
 * torso deforms), so a host that repaints the live group itself needs the same
 * id `demo2Svg` used.
 */
export function clipIdOf(cfg: DemoV2): string {
  return `cd2-${cfg.id}-torso`;
}

/** The moving half of the picture — what a repaint replaces. */
export function live2Svg(cfg: DemoV2, pose: Pose, clipId: string): string {
  return figure2Svg(forwardKinematics(pose, cfg.view), styleOf(cfg), clipId);
}

/** The complete markup of a v2 demo at one pose. */
export function demo2Svg(cfg: DemoV2, pose: Pose, label: string): string {
  const clipId = clipIdOf(cfg);
  const [fx, fy, fw, fh] = cfg.frame;
  return (
    `<svg class="cd2-svg" viewBox="${n(fx)} ${n(fy)} ${n(fw)} ${n(fh)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">` +
    defs2Svg() +
    `<rect x="${n(fx)}" y="${n(fy)}" width="${n(fw)}" height="${n(fh)}" fill="url(#STAGE)"/>` +
    `<g class="cd2-static">${cfg.props()}${motionPathSvg(cfg)}</g>` +
    `<g class="cd2-live">${live2Svg(cfg, pose, clipId)}</g>` +
    `</svg>`
  );
}

/** The legend chip: 🎯 plus the muscles this demo is highlighting. */
export function legend2Html(cfg: DemoV2): string {
  const names = cfg.muscles.length > 0 ? cfg.muscles : [MUSCLE_HE[cfg.primary]];
  const main = names[0] ?? '';
  const rest = names.slice(1).join(' · ');
  return (
    `<span class="cd2-chip" style="display:inline-flex;gap:6px;align-items:center;` +
    `background:${PAL.hot1}1F;border:1px solid ${PAL.hot1}66;color:${PAL.hot2};` +
    `border-radius:99px;padding:4px 11px;font-size:12px;font-weight:700">` +
    `<span aria-hidden="true">🎯</span><span>${main}</span>` +
    (rest ? `<span style="opacity:.62;font-weight:600">${rest}</span>` : '') +
    `</span>`
  );
}

/** `RIG` is re-exported so a v2 caller never has to import both modules. */
export { RIG, STAGE };
