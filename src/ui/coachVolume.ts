/**
 * ui/coachVolume.ts — the coach, drawn with volume.
 *
 * ORIGINAL ART. Every shape here is authored from numbers in this file. Nothing
 * is traced, copied or derived from any third-party image, GIF or video; the
 * only thing borrowed from the reference material we looked at is its
 * INFORMATION DESIGN — a solid human, one clearly marked working muscle, solid
 * equipment, and the path the load travels.
 *
 * ONE RENDERER, ONE RIG. `ui/coachFigure.ts` is the rig: bone lengths, absolute
 * segment angles, forward kinematics, and 28 exercises' worth of hand-solved
 * poses in `data/exercisePoses.ts` riding on it. This module is the only thing
 * that turns those joints into a picture. It replaced a stick figure, which was
 * legible but could never say WHICH muscle is working, never showed solid
 * equipment, and never showed where the weight travels.
 *
 *   the rig   →  joint positions (pure geometry, unchanged)
 *   this file →  tapered capsules with a rounding shade, a shaped torso in a
 *                shirt, shorts, a head with a face, gripping fists, shoes —
 *                plus a MUSCLE HIGHLIGHT layer and solid iron
 *
 * THE HIGHLIGHT IS GEOMETRY, NOT A DECAL. There is no second sprite pinned onto
 * the figure: `musclePatches()` is called from inside `figureSvg()` with the
 * SAME `Joints` the limbs are drawn from, so a pec patch is an ellipse in the
 * torso's own local frame, a biceps patch is a short capsule slid onto the front
 * of the shoulder→elbow bone, and a hamstring patch is the same thing on the
 * back of the hip→knee bone. Repaint the figure and the highlight has already
 * moved with it — it cannot drift, because it is not a separate thing that could
 * drift.
 *
 * THE FIGURE HAS A FACING. A stroke has no front; a filled torso does — the
 * chest curve, the pec patch, the shorts and the face all sit on one side of the
 * spine — and the rig cannot infer it (two exercises can stand the pelvis at the
 * same angle and face opposite ways). So a demo declares `facing: 1 | -1` and
 * every local frame is built from it.
 *
 * TWO VIEWS, TWO SILHOUETTES. The sagittal figure is a profile: one shoulder in
 * front of the other, a face with a nose, a shoe seen from the side. The four
 * frontal-plane lifts (`x4`, `x8`, `b6`, `c6`) need the OTHER silhouette — a
 * symmetric torso between two shoulders, a face with two eyes, shoes pointing at
 * the camera — and they need both sides painted at full strength, because in the
 * frontal plane neither side is "far". Both silhouettes are in here; `view`
 * picks between them and the rig mirrors the limbs for free.
 *
 * Pure functions of numbers to SVG strings: no DOM, no clock, no randomness,
 * which is what lets the tests assert the geometry of every keyframe.
 */

import {
  RIG,
  STAGE,
  angleOf,
  dist,
  forwardKinematics,
  holdAnchors,
  lerpPose,
  n,
  step,
  type Hold,
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
 * drawn small on a dark stage rather than large on a lit one. The stage, card
 * and accent colours are the app's own tokens (`styles/tokens.css`). The two
 * highlight colours are the danger/warn tokens — the same red→amber the app
 * already uses for "this is the thing to look at".
 *
 * THIS TABLE IS THE SOURCE OF TRUTH, and `styles/coach.css` mirrors it as
 * `--cd-*` custom properties so the demo's CARD, its legend chip and its border
 * can be styled in CSS against the same colours. `tests/coachVolume.test.ts`
 * parses that stylesheet and fails if the two ever drift apart. The figure
 * itself paints hex directly: a repaint is one `innerHTML` of a few kB at 30
 * fps, and `var(--cd-shirt, #4A5F8C)` in every fill would triple it.
 */
export const PAL = {
  /* ground */
  stage1: '#25314c',
  stage2: '#151d2e',
  ink: '#131a29',
  /* the body */
  skin: '#d9a377',
  skinShade: '#b37f57',
  shirt: '#4a5f8c',
  shirtShade: '#3a4d75',
  shorts: '#2c3b5e',
  hair: '#232d46',
  shoe: '#1e293e',
  shoeSole: '#8b96ab',
  line: '#161e30',
  /* the station */
  pad: '#5a6e96',
  padLight: '#7c8fb6',
  padDark: '#3d4c6e',
  frame: '#46587d',
  frameDark: '#2c3a55',
  /* the iron */
  iron: '#5a6c90',
  ironDark: '#33405c',
  plate: '#8fa2c6',
  /* the working muscle */
  hot1: '#ef4444',
  hot2: '#f59e0b',
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

export function ell(c: Vec, rx: number, ry: number, rot: number, fill: string, extra = ''): string {
  return (
    `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(rx)}" ry="${n(ry)}" ` +
    `transform="rotate(${n(rot)} ${n(c.x)} ${n(c.y)})" fill="${fill}"${extra ? ' ' + extra : ''}/>`
  );
}

export function circ(c: Vec, r: number, fill: string, extra = ''): string {
  return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
}

/** Fill + hairline outline — the cartoon look every part of the body shares. */
export function inked(d: string, fill: string, w = 1.2, stroke: string = PAL.line): string {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}" stroke-linejoin="round"/>`;
}

/**
 * THE TORSO'S LOCAL FRAME: origin at the pelvis, `up` towards the shoulders,
 * `front` the perpendicular the chest faces. Everything torso-shaped — the
 * silhouette, the shorts, the pec/ab/back patches — is authored in `(t, off)`
 * here and therefore rotates and translates with the pose for free.
 *
 * In the FRONT view the same frame is reused with `front` reading as "towards
 * the figure's right on screen", which is what makes a symmetric pair of pecs
 * or traps one expression in `±off`.
 */
export interface BodyFrame {
  readonly origin: Vec;
  readonly len: number;
  readonly up: number;
  readonly front: number;
}

/**
 * The front of a LIMB: whichever perpendicular of the bone points the way the
 * figure faces. A hanging arm on a figure facing right has its front to the
 * right; a horizontal bone's two perpendiculars are both vertical, and the tie
 * is broken upwards, towards the light.
 */
function frontOf(axis: number, facing: 1 | -1): number {
  const a = axis + 90;
  const b = axis - 90;
  const ca = Math.cos(a * D2R) * facing;
  const cb = Math.cos(b * D2R) * facing;
  if (Math.abs(ca - cb) < 1e-9) return Math.sin(a * D2R) <= Math.sin(b * D2R) ? a : b;
  return ca > cb ? a : b;
}

/**
 * THE TORSO'S FACING IS A SIGN, not a search: the chest sits exactly 90° from
 * the spine, and `facing` says which way round. For an upright figure `+1` faces
 * screen-right and `-1` screen-left; for a figure lying on its back (`torso: 0`,
 * spine pointing along +x) `-1` is the one that puts the chest UP.
 *
 * A perpendicular chosen by "which one points more towards +x" — the rule a limb
 * uses — cannot answer that: for a horizontal spine both perpendiculars are
 * equally far from +x, and a bench press would have to guess. A sign always
 * knows.
 */
export function bodyFrame(j: Joints, facing: 1 | -1): BodyFrame {
  const up = angleOf(j.pelvis, j.shoulders);
  return {
    origin: j.pelvis,
    len: Math.max(1, dist(j.pelvis, j.shoulders)),
    up,
    front: up + 90 * facing,
  };
}

/** A point `t` of the way up the spine and `off` in front of it (negative = behind). */
function tp(f: BodyFrame, t: number, off: number): Vec {
  return step(step(f.origin, f.up, t * f.len), f.front, off);
}

/* ------------------------------------------------------------------ torso */

/**
 * The torso silhouette SEEN FROM THE SIDE: a chest that swells forward above the
 * sternum, a waist that draws in, a seat that rounds off behind the hips, and a
 * shoulder crown that is the widest thing on the figure. Authored as one closed
 * bezier in the body frame, so it deforms with the spine.
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

/**
 * The torso silhouette SEEN FROM THE FRONT — a V, not a slab.
 *
 * It is built from the four points the rig actually produces (`near`/`far`
 * shoulder and hip), not from the body frame's own width, which is the whole
 * reason a russian twist works: when `roll` turns the shoulder line, the near
 * shoulder rises and the span foreshortens, and the outline follows because the
 * outline IS those points. The waist is interpolated between them and pulled in,
 * which is what turns a quadrilateral into a torso.
 */
export function torsoOutlineFront(j: Joints, f: BodyFrame): string {
  const ns = j.near.shoulder;
  const fs = j.far.shoulder;
  const nh = j.near.hip;
  const fh = j.far.hip;
  /** A point on one side, `t` up from hip to shoulder, `out` further outboard. */
  const side = (hip: Vec, sh: Vec, t: number, out: number): Vec => {
    const base: Vec = { x: hip.x + (sh.x - hip.x) * t, y: hip.y + (sh.y - hip.y) * t };
    const lateral = angleOf({ x: (fh.x + fs.x) / 2, y: (fh.y + fs.y) / 2 }, { x: (nh.x + ns.x) / 2, y: (nh.y + ns.y) / 2 });
    const sign = hip === nh ? 1 : -1;
    return step(base, lateral, out * sign);
  };
  const P = (v: Vec): string => `${n(v.x)} ${n(v.y)}`;
  // crown of each deltoid, a pinched waist, and hips that flare back out
  const nTop = step(ns, f.up, 2.6);
  const fTop = step(fs, f.up, 2.6);
  return (
    `M ${P(step(nh, f.up, -1.4))} ` +
    `C ${P(side(nh, ns, 0.16, 2.2))} ${P(side(nh, ns, 0.4, -0.6))} ${P(side(nh, ns, 0.62, 1.4))} ` +
    `C ${P(side(nh, ns, 0.86, 3.6))} ${P(step(nTop, f.front, 3.2))} ${P(nTop)} ` +
    `C ${P(step(nTop, f.front, -2.4))} ${P(step(fTop, f.front, 2.4))} ${P(fTop)} ` +
    `C ${P(step(fTop, f.front, -3.2))} ${P(side(fh, fs, 0.86, 3.6))} ${P(side(fh, fs, 0.62, 1.4))} ` +
    `C ${P(side(fh, fs, 0.4, -0.6))} ${P(side(fh, fs, 0.16, 2.2))} ${P(step(fh, f.up, -1.4))} Z`
  );
}

/* --------------------------------------------------------- muscle highlight */

/** The six regions the game already scores — `data/program.ts`'s `BodyPart`. */
export type MuscleRegion = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core';

export const MUSCLE_REGIONS: readonly MuscleRegion[] = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'legs',
  'core',
];

/**
 * WHICH FACE OF A LIMB the working belly sits on. The same bone carries two
 * muscles: a curl is the front of the upper arm and a pushdown its back, an RDL
 * is the back of the thigh and a squat its front.
 */
export type LimbFace = 'front' | 'back';

/** The Hebrew name each region is chipped with, when a demo does not override it. */
export const MUSCLE_HE: Record<MuscleRegion, string> = {
  chest: 'חזה',
  back: 'גב',
  shoulders: 'כתפיים',
  arms: 'זרועות',
  legs: 'רגליים',
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
 *
 * THE VIEW CHANGES WHAT A REGION *IS*. From the side, "chest" is one pec seen
 * edge-on and "back" is the erector column behind the spine. From the front,
 * "chest" is a symmetric pair either side of the sternum, and "back" is what a
 * back actually shows from the front: the upper traps, which is exactly the
 * muscle a shrug (`x8`) is for. Same for the legs — a hinge is felt in the
 * hamstring, drawn on the back of the thigh; from the front the thigh only has
 * a front, so the patch is centred on the bone.
 */
function musclePatches(
  region: MuscleRegion,
  f: BodyFrame,
  s: SideJoints,
  scale: number,
  facing: 1 | -1,
  view: View,
  limbFace: LimbFace | undefined,
): MusclePatch {
  const k = (v: number): number => v * scale;
  const hot = (d: string): string => `<path d="${d}" fill="url(#cdHot)"/>`;
  /** A muscle BELLY on a bone: shorter than the bone and slid to one face of it. */
  const belly = (
    a: Vec,
    b: Vec,
    trim: readonly [number, number],
    r: readonly [number, number],
    side: 'front' | 'back' | 'centre',
    off: number,
  ): string => {
    const ang = angleOf(a, b);
    const face = side === 'front' ? frontOf(ang, facing) : frontOf(ang, facing) + 180;
    const o = side === 'centre' ? 0 : off;
    const p = step(step(a, ang, k(trim[0])), face, k(o));
    const q = step(step(b, ang, -k(trim[1])), face, k(o * 0.7));
    return hot(capsule(p, q, k(r[0]), k(r[1])));
  };
  const front = view === 'front';
  /** Which face of a limb this demo's working belly is on. */
  const on = (fallback: 'front' | 'back'): 'front' | 'back' | 'centre' =>
    front ? 'centre' : (limbFace ?? fallback);
  switch (region) {
    case 'chest':
      // Side: the pec sits high and forward, between the sternum and the
      // shoulder. Front: the same muscle, but there are two of them.
      return front
        ? {
            onTorso:
              ell(tp(f, 0.78, 4.4), k(4.4), k(3.4), f.up + 90, 'url(#cdHot)') +
              ell(tp(f, 0.78, -4.4), k(4.4), k(3.4), f.up + 90, 'url(#cdHot)'),
            loose: '',
            limb: null,
          }
        : {
            onTorso:
              ell(tp(f, 0.8, 3.4), k(6.0), k(4.6), f.up + 90, 'url(#cdHot)') +
              ell(tp(f, 0.58, 3.6), k(4.6), k(3.4), f.up + 90, 'url(#cdHot)', 'opacity=".8"'),
            loose: '',
            limb: null,
          };
    case 'back':
      // Side: the erector column behind the spine. Front: the upper traps, the
      // slope from the neck out to each shoulder — a shrug's whole story.
      return front
        ? {
            onTorso:
              ell(tp(f, 0.98, 4.6), k(4.8), k(2.6), f.up + 66, 'url(#cdHot)') +
              ell(tp(f, 0.98, -4.6), k(4.8), k(2.6), f.up + 114, 'url(#cdHot)'),
            loose: '',
            limb: null,
          }
        : {
            onTorso:
              ell(tp(f, 0.72, -3.2), k(6.6), k(4.2), f.up + 90, 'url(#cdHot)') +
              ell(tp(f, 0.34, -3.4), k(4.8), k(3.0), f.up + 90, 'url(#cdHot)', 'opacity=".85"'),
            loose: '',
            limb: null,
          };
    case 'core':
      // A column, not a belt: the rectus runs UP the trunk, and an ellipse as
      // wide as the torso is deep gets clipped into a waistband.
      return front
        ? {
            onTorso:
              ell(tp(f, 0.58, 0), k(4.4), k(5.2), f.up + 90, 'url(#cdHot)') +
              ell(tp(f, 0.34, 0), k(3.8), k(3.4), f.up + 90, 'url(#cdHot)', 'opacity=".85"'),
            loose: '',
            limb: null,
          }
        : {
            onTorso: ell(tp(f, 0.4, 2.4), k(4.4), k(6.4), f.up + 90, 'url(#cdHot)'),
            loose: '',
            limb: null,
          };
    case 'shoulders':
      return { onTorso: '', loose: circ(s.shoulder, k(4.6), 'url(#cdHot)'), limb: 'arm' };
    case 'arms':
      // Front of the upper arm is the biceps, back of it the triceps — a curl
      // and a pushdown are the same bone and opposite muscles, so the demo says
      // which face it means and the default is the flexor.
      return {
        onTorso: '',
        loose: belly(s.shoulder, s.elbow, [2.6, 1.4], [3.6, 2.8], on('front'), 0.6),
        limb: 'arm',
      };
    case 'legs':
      // Hamstring + glute on the BACK of the thigh for a hinge; quad on the
      // FRONT for a squat or an extension. The glute rides the shorts either
      // way, because it works in both. From the front there is no back of the
      // thigh to paint, so the belly is centred and the shorts keep out of it.
      return front
        ? { onTorso: '', loose: belly(s.hip, s.knee, [1.6, 1.2], [4.0, 3.0], 'centre', 0), limb: 'leg' }
        : {
            onTorso: '',
            onShorts: ell(tp(f, -0.06, -2.6), k(4.6), k(3.6), f.up + 90, 'url(#cdHot)'),
            loose: belly(s.hip, s.knee, [1.8, 1.2], [4.3, 3.2], on('back'), 0.9),
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
 * ONE SIDE'S DRAWING STYLE: its palette, its scale, and where its shading edge
 * is. In the sagittal view the far side recedes (dimmer, slimmer, its highlight
 * faded); in the frontal view NEITHER side is far — they are both square to the
 * camera — so both get the near palette and the shading simply runs down the
 * outboard edge of each limb.
 */
interface SideStyle {
  readonly sk: Skin;
  readonly scale: number;
  /** Absolute direction the rounding shade is laid along, given a bone angle. */
  readonly shade: (boneAngle: number) => number;
  /** How strongly this side's muscle highlight is painted. */
  readonly hi: number;
}

/**
 * THE ROUNDING SHADE: a slim darker capsule laid along one edge of a limb, so a
 * flat fill reads as a cylinder. It goes on the edge away from the light, which
 * this stage puts up and in front.
 */
function limbShade(a: Vec, b: Vec, ra: number, rb: number, dir: number, col: string): string {
  const p = step(a, dir, ra * 0.5);
  const q = step(b, dir, rb * 0.5);
  return `<path d="${capsule(p, q, ra * 0.44, rb * 0.44)}" fill="${col}" opacity=".33"/>`;
}

/** The shoe, seen from the side: a wedge with a pale sole, so a foot has a front. */
function shoeSide(s: SideJoints, sk: Skin, k: (v: number) => number): string {
  const ang = angleOf(s.ankle, s.toe);
  const heel = step(s.ankle, ang + 180, k(1.6));
  const toeTip = step(s.toe, ang, k(0.6));
  return (
    inked(capsule(heel, toeTip, k(3.3), k(2.4)), sk.shoe, sk.w, sk.line) +
    `<path d="${capsule(step(heel, ang + 90, k(2.6)), step(toeTip, ang + 90, k(1.9)), k(0.55), k(0.5))}" ` +
    `fill="${sk.sole}" opacity=".7"/>`
  );
}

/**
 * The shoe, seen from the FRONT: a toe box, not a wedge. A foot pointing at the
 * camera is short and wide, so the shoe is drawn about half the length of the
 * side view's and a third wider, with the sole as a bar across the bottom rather
 * than a stripe along the side.
 */
function shoeFront(s: SideJoints, sk: Skin, k: (v: number) => number): string {
  const ang = angleOf(s.ankle, s.toe);
  const top = step(s.ankle, ang, k(-0.4));
  const tip = step(s.ankle, ang, k(3.6));
  return (
    inked(capsule(top, tip, k(3.0), k(3.9)), sk.shoe, sk.w, sk.line) +
    `<path d="${capsule(step(tip, ang + 90, k(2.4)), step(tip, ang - 90, k(2.4)), k(1.1), k(1.1))}" ` +
    `fill="${sk.sole}" opacity=".75"/>`
  );
}

/**
 * A leg: thigh (fat at the hip, slimmer at the knee), shin (slimmer again), a
 * knee cap that hides the seam, a shoe, and the short leg of the shorts on top.
 */
function legSvg(s: SideJoints, st: SideStyle, hi: string, view: View): string {
  const sk = st.sk;
  const k = (v: number): number => v * st.scale;
  const thighA = angleOf(s.hip, s.knee);
  const shinA = angleOf(s.knee, s.ankle);
  return (
    inked(capsule(s.hip, s.knee, k(5.6), k(4.2)), sk.skin, sk.w, sk.line) +
    inked(capsule(s.knee, s.ankle, k(4.2), k(2.9)), sk.skin, sk.w, sk.line) +
    circ(s.knee, k(4.0), sk.skin) +
    limbShade(s.hip, s.knee, k(5.6), k(4.2), st.shade(thighA), sk.skinShade) +
    limbShade(s.knee, s.ankle, k(4.2), k(2.9), st.shade(shinA), sk.skinShade) +
    hi +
    (view === 'front' ? shoeFront(s, sk, k) : shoeSide(s, sk, k)) +
    // the shorts' leg, drawn last so it sits ON the thigh
    inked(capsule(s.hip, step(s.hip, thighA, k(3.2)), k(5.9), k(4.9)), sk.shorts, sk.w, sk.line)
  );
}

/**
 * An arm: a deltoid cap over the shoulder seam, upper arm, forearm, elbow cap,
 * and the palm. The palm sits a little short of the grip point so that whatever
 * the hold draws at the grip lands INSIDE the hand rather than beyond it.
 */
function armSvg(s: SideJoints, st: SideStyle, hi: string): string {
  const sk = st.sk;
  const k = (v: number): number => v * st.scale;
  const fa = angleOf(s.elbow, s.wrist);
  const ua = angleOf(s.shoulder, s.elbow);
  const sleeveShade = st.shade(ua);
  return (
    inked(capsule(s.shoulder, s.elbow, k(4.6), k(3.4)), sk.skin, sk.w, sk.line) +
    inked(capsule(s.elbow, s.wrist, k(3.4), k(2.5)), sk.skin, sk.w, sk.line) +
    circ(s.elbow, k(3.2), sk.skin) +
    limbShade(s.shoulder, s.elbow, k(4.6), k(3.4), sleeveShade, sk.skinShade) +
    limbShade(s.elbow, s.wrist, k(3.4), k(2.5), st.shade(fa), sk.skinShade) +
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
    `<path d="${capsule(
      step(step(s.shoulder, ua, k(-1.0)), sleeveShade, k(2.2)),
      step(step(s.shoulder, ua, k(4.2)), sleeveShade, k(1.8)),
      k(1.9),
      k(1.7),
    )}" fill="${PAL.ink}" opacity=".22"/>` +
    inked(capsule(step(s.wrist, fa, k(0.6)), step(s.wrist, fa, k(2.6)), k(2.9), k(2.6)), sk.skin, sk.w, sk.line)
  );
}

/* ------------------------------------------------------------------ the head */

// 0.87: the rig's `headR` was sized for a stick figure's ball head. A drawn
// skull with hair on it reads BIGGER than the circle it replaces, so it is taken
// in until the figure is about six heads tall — cartoon, not chibi.
const HEAD_K = 0.87;

/**
 * A PROFILE, not a ball. Hair is a shape over the crown and down the back, the
 * skull a closed outline with a brow, a nose wedge, a lip and a chin. On top of
 * that: an eye, a brow line, a mouth and an ear — six marks, which is all it
 * takes for a 7-unit head to have a direction at 320px and still read as a head
 * at 180px.
 */
function headProfileSvg(j: Joints, facing: 1 | -1, sk: Skin, scale: number): string {
  const k = (v: number): number => v * scale * HEAD_K;
  const c = j.head;
  const crown = angleOf(j.neck, j.head);
  // The face looks the way the CHEST looks, and for the same reason the torso
  // uses a sign rather than a search: a figure lying face down has a horizontal
  // neck, and "whichever perpendicular points more towards +x" would happily
  // give it a face pointing at the ceiling.
  const front = crown + 90 * facing;
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

/**
 * THE HEAD SEEN FROM THE FRONT — the other silhouette.
 *
 * Same construction, different landmarks: an oval skull that narrows to a chin
 * rather than a profile with a nose, a fringe instead of a hairline crescent,
 * and the face marks doubled and mirrored across the centre line. Authored in
 * `(lat, up)` where `lat` is positive towards the figure's screen-right, so the
 * whole face turns with the neck for free.
 */
function headFrontSvg(j: Joints, sk: Skin, scale: number): string {
  const k = (v: number): number => v * scale * HEAD_K;
  const c = j.head;
  const crown = angleOf(j.neck, j.head);
  const lat = crown + 90;
  const at = (lx: number, uy: number): Vec => step(step(c, lat, k(lx)), crown, k(uy));
  const P = (lx: number, uy: number): string => {
    const v = at(lx, uy);
    return `${n(v.x)} ${n(v.y)}`;
  };
  const skull =
    `M ${P(0, 6.2)} ` +
    `C ${P(3.6, 6.1)} ${P(5.4, 4.2)} ${P(5.4, 1.2)} ` +
    `C ${P(5.4, -1.8)} ${P(3.4, -5.4)} ${P(0, -5.6)} ` +
    `C ${P(-3.4, -5.4)} ${P(-5.4, -1.8)} ${P(-5.4, 1.2)} ` +
    `C ${P(-5.4, 4.2)} ${P(-3.6, 6.1)} ${P(0, 6.2)} Z`;
  // the fringe: a cap over the top of the skull, dipping to a parting
  const hair =
    `M ${P(-5.6, 1.4)} ` +
    `C ${P(-5.8, 5.2)} ${P(-3.2, 7.4)} ${P(0, 7.4)} ` +
    `C ${P(3.2, 7.4)} ${P(5.8, 5.2)} ${P(5.6, 1.4)} ` +
    `C ${P(4.6, 3.0)} ${P(3.0, 2.4)} ${P(1.2, 2.6)} ` +
    `C ${P(-1.4, 2.9)} ${P(-3.8, 3.4)} ${P(-5.6, 1.4)} Z`;
  const hairCol = sk.skin === PAL.skin ? PAL.hair : far(PAL.hair);
  const eye = (lx: number): string => circ(at(lx, 0.6), k(0.8), PAL.ink);
  const brow = (lx: number): string =>
    `<path d="${capsule(at(lx - 1.2, 2.4), at(lx + 1.2, 2.6), k(0.42), k(0.42))}" fill="${PAL.ink}" opacity=".8"/>`;
  const ear = (lx: number): string =>
    `<path d="${capsule(at(lx, 1.2), at(lx, -0.2), k(0.95), k(0.9))}" fill="${sk.skinShade}" opacity=".6"/>`;
  return (
    ear(-5.7) +
    ear(5.7) +
    inked(skull, sk.skin, sk.w * 0.95, sk.line) +
    inked(hair, hairCol, sk.w, sk.line) +
    eye(-2.2) +
    eye(2.2) +
    brow(-2.2) +
    brow(2.2) +
    `<path d="${capsule(at(-1.2, -3.2), at(1.2, -3.2), k(0.42), k(0.42))}" fill="${PAL.ink}" opacity=".7"/>`
  );
}

/* -------------------------------------------------------------- the iron */

/**
 * One dumbbell at a grip point: a handle with a plate stack on each end.
 *
 * FORESHORTENED ON PURPOSE when the bar runs ACROSS the forearm. That is the
 * normal grip seen from the side, where the bell points straight at the camera
 * and its honest projection is a bare disc — unreadable as a dumbbell. So it is
 * drawn at roughly 60% of its length, the three-quarter view every equipment
 * diagram uses: you get the handle AND the plates, and it still cannot reach
 * across the body and collide with a shin. A NEUTRAL grip (`axis: 'along'`, the
 * hammer curl) genuinely is broadside to the camera, so it is drawn at full
 * length with two equal plates.
 *
 * It is drawn BEFORE the hand's finger wrap, so the hand closes over the handle
 * instead of floating beside it.
 */
function dumbbell(
  p: Vec,
  axis: number,
  sk: Skin,
  scale: number,
  broadside: boolean,
): { behind: string; front: string } {
  const k = (v: number): number => v * scale;
  const plate = (c: Vec, r: number, dim: number): string =>
    circ(c, r, dim > 0 ? mixHex(sk.iron, PAL.stage2, dim) : sk.iron, `stroke="${sk.line}" stroke-width="${n(sk.w * 1.15)}"`) +
    circ(c, r * 0.3, sk.plate, `opacity="${n(0.5 - dim * 0.4)}"`) +
    `<path d="${capsule(step(c, axis + 116, r * 0.72), step(c, axis + 186, r * 0.72), k(0.5), k(0.5))}" ` +
    `fill="#c9d4e8" opacity="${n(0.4 - dim * 0.3)}"/>`;
  if (broadside) {
    // seen from the side of the bar: handle across, an equal plate at each end
    const a = step(p, axis, k(5.4));
    const b = step(p, axis + 180, k(5.4));
    return {
      behind:
        inked(capsule(step(p, axis, k(4.6)), step(p, axis + 180, k(4.6)), k(1.35), k(1.35)), sk.ironDark, sk.w, sk.line) +
        plate(a, k(3.2), 0) +
        plate(b, k(3.2), 0),
      front: '',
    };
  }
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
    `<path d="${capsule(step(s.grip, fa + 70, k(1.4)), step(s.grip, fa - 70, k(1.4)), k(1.0), k(1.0))}" ` +
    `fill="${sk.skinShade}" opacity=".95"/>`
  );
}

/**
 * WHERE A BACK-SQUAT BAR ACTUALLY IS: on the traps, BEHIND the neck.
 *
 * Anchoring it at the shoulder joint was fine for a stick figure, whose torso
 * had no thickness. Give the torso volume and the same anchor puts a loaded
 * plate through the lifter's chest, because the shoulder joint is in the middle
 * of the body and the plate is drawn on the side the chest is on. So the bar is
 * carried a torso-width BEHIND the spine and a little up it, which is the shelf
 * the traps actually make, and it is painted between the torso and the head so
 * the skull passes in front of it.
 */
export function barBackAnchor(j: Joints, facing: 1 | -1): Vec {
  const up = angleOf(j.pelvis, j.shoulders);
  return step(step(j.shoulders, up + 90 * facing + 180, 5.4), up, 3.5);
}

/**
 * A LOADED BAR SEEN END-ON — the Smith bar and the barbell across the traps.
 * What you actually see is the plate: a big disc with a rim, a collar in front
 * of it and the sleeve poking through. Drawn as one solid so it cannot be
 * mistaken for the pulley wheels elsewhere on the stage.
 */
function barEnd(p: Vec, sk: Skin, r: number): string {
  // A LIGHT rim over a dark face. The plate has to read against the dark stage
  // AND against the shirt it rests on in a back squat, and a mid-tone disc on a
  // mid-tone torso is simply invisible.
  return (
    circ(p, r, sk.plate, `stroke="${sk.line}" stroke-width="1.3"`) +
    circ(p, r * 0.78, sk.ironDark, '') +
    circ(p, r * 0.24, sk.plate, 'opacity=".9"') +
    `<path d="${capsule(step(p, -132, r * 0.9), step(p, -58, r * 0.9), 0.55, 0.55)}" fill="#c9d4e8" opacity=".45"/>`
  );
}

/** A cable: two hairlines so it reads as a braided steel rope, not a pen stroke. */
export function cable(from: Vec, to: Vec): string {
  return (
    `<path d="M ${n(from.x)} ${n(from.y)} L ${n(to.x)} ${n(to.y)}" stroke="${PAL.frameDark}" ` +
    `stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
    `<path d="M ${n(from.x)} ${n(from.y)} L ${n(to.x)} ${n(to.y)}" stroke="${PAL.plate}" ` +
    `stroke-width="0.8" stroke-linecap="round" fill="none" opacity=".55"/>`
  );
}

function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * A PADDED ROLLER riding a joint — what a leg curl or a leg extension pushes
 * against. Two cushions on a short axle, drawn as overlapping capsules so the
 * pair reads as a roller rather than as a ball.
 */
export function roller(p: Vec, axis: number, r = 4.6): string {
  const a = step(p, axis, r * 0.85);
  const b = step(p, axis + 180, r * 0.85);
  return (
    inked(capsule(a, b, r, r), PAL.pad, 1.3) +
    `<path d="${capsule(step(a, axis + 90, r * 0.42), step(b, axis + 90, r * 0.42), r * 0.36, r * 0.36)}" ` +
    `fill="${PAL.padLight}" opacity=".55"/>` +
    `<path d="M ${n(p.x)} ${n(p.y)} L ${n(step(p, axis, r * 0.1).x)} ${n(step(p, axis, r * 0.1).y)}" ` +
    `stroke="${PAL.frameDark}" stroke-width="1.4" stroke-linecap="round"/>`
  );
}

/**
 * WHAT ONE SIDE'S HANDS ARE ON, split into the part that goes BEHIND the fist
 * and the part that goes in front of it. Everything is positioned from the FK
 * output, so the iron can only ever be exactly where the hands are.
 */
function holdSvg(
  hold: Hold,
  j: Joints,
  which: 'near' | 'far',
  sk: Skin,
  scale: number,
  facing: 1 | -1,
): string {
  const s = which === 'near' ? j.near : j.far;
  const fa = angleOf(s.elbow, s.wrist);
  const wrap = handWrap(s, sk, scale);
  switch (hold.k) {
    case 'none':
      return wrap;
    case 'db': {
      const along = hold.axis === 'along';
      const db = dumbbell(s.grip, along ? fa : fa + 90, sk, scale, along);
      return db.behind + wrap + db.front;
    }
    case 'dbNear': {
      if (which === 'far') return wrap;
      const db = dumbbell(s.grip, fa + 90, sk, scale, false);
      return db.behind + wrap + db.front;
    }
    case 'plate': {
      // ONE weight in both hands: it lives at the midpoint of the two grips, so
      // it is drawn once, with the NEAR layer, and the far fist just wraps.
      if (which === 'far') return wrap;
      const c = mid(j.near.grip, j.far.grip);
      const db = dumbbell(c, fa + 90, sk, scale, true);
      return db.behind + handWrap(j.far, FAR_SKIN, FAR_SCALE) + wrap + db.front;
    }
    case 'bar':
      return which === 'far' ? wrap : wrap + barEnd(s.grip, sk, 6.4);
    case 'barBack': {
      // Across the traps and seen end-on: the bar points at the camera, so what
      // there is to draw is the plate, plus a stub of sleeve either side of it.
      if (which === 'far') return '';
      const c = barBackAnchor(j, facing);
      const axis = angleOf(j.far.shoulder, j.near.shoulder);
      return (
        `<g class="cd-bar">` +
        inked(capsule(step(c, axis, -8), step(c, axis, 8), 1.8, 1.8), PAL.ironDark, 1.2) +
        barEnd(c, sk, 6.2) +
        `</g>`
      );
    }
    case 'rope': {
      // A ROPE HAS TWO ENDS, AND TWO HANDS. Drawn as one strand to a midpoint
      // with a pair of tails hanging off it, a face pull reads as two fists
      // stacked on one side of a stick — which is exactly what it looked like.
      // So the cable stops at a SPLIT, and from there a strand runs to each fist
      // and past it: whatever the pose does with the two grips, the V follows.
      if (which === 'far') return wrap;
      const from: Vec = { x: hold.from[0] ?? 0, y: hold.from[1] ?? 0 };
      const hands = mid(j.near.grip, j.far.grip);
      const run = dist(from, hands);
      const split = step(from, angleOf(from, hands), Math.max(run * 0.45, run - 11));
      const strand = (g: Vec): string => {
        const a = angleOf(split, g);
        return (
          inked(capsule(split, g, 1.6, 2.1), PAL.frameDark, 1.1) +
          inked(capsule(g, step(g, a, 5.5), 2.1, 1.7), PAL.frameDark, 1.1) +
          circ(step(g, a, 6.2), 2.1, PAL.pad, `stroke="${PAL.line}" stroke-width="1"`)
        );
      };
      return (
        cable(from, split) +
        strand(j.far.grip) +
        handWrap(j.far, FAR_SKIN, FAR_SCALE) +
        strand(j.near.grip) +
        wrap
      );
    }
    case 'handle': {
      if (which === 'far') return wrap;
      const from: Vec = { x: hold.from[0] ?? 0, y: hold.from[1] ?? 0 };
      const hands = mid(j.near.grip, j.far.grip);
      const a = angleOf(from, hands);
      const half = hold.wide === true ? 14 : 5.5;
      const l = step(hands, a + 90, half);
      const r = step(hands, a - 90, half);
      return (
        cable(from, hands) +
        inked(capsule(l, r, 1.7, 1.7), PAL.iron, 1.2) +
        circ(l, 2.1, PAL.ironDark) +
        circ(r, 2.1, PAL.ironDark) +
        handWrap(j.far, FAR_SKIN, FAR_SCALE) +
        wrap
      );
    }
    case 'cables': {
      const idx = which === 'far' ? 0 : 1;
      const a = hold.from[idx];
      const anchor: Vec = { x: a?.[0] ?? 0, y: a?.[1] ?? 0 };
      // a D-handle: a short grip bar with a stirrup back to the cable
      const ang = angleOf(anchor, s.grip);
      return (
        cable(anchor, s.grip) +
        inked(capsule(step(s.grip, ang + 90, 3), step(s.grip, ang - 90, 3), 1.6, 1.6), PAL.iron, 1.1) +
        wrap
      );
    }
    case 'roller': {
      if (which === 'far') return wrap;
      const p = hold.joint === 'ankle' ? j.near.ankle : j.near.knee;
      const along = hold.joint === 'ankle' ? angleOf(j.near.knee, j.near.ankle) : angleOf(j.near.hip, j.near.knee);
      return wrap + roller(p, along + 90);
    }
  }
}

/** Which layer a hold is painted with — the fists always ride their own arm. */
function holdOnArm(hold: Hold): boolean {
  return hold.k !== 'barBack';
}

/* ------------------------------------------------------------------ figure */

export type Layer = 'farLeg' | 'farArm' | 'body' | 'nearLeg' | 'nearArm';

/** Every layer, back to front — the default depth order and the test's checklist. */
export const LAYERS: readonly Layer[] = ['farLeg', 'farArm', 'body', 'nearLeg', 'nearArm'];

export interface FigureStyle {
  readonly view: View;
  readonly facing: 1 | -1;
  /** Back to front. Which side's arm hides behind the torso is per-exercise. */
  readonly order: readonly Layer[];
  readonly primary: MuscleRegion;
  readonly secondary?: MuscleRegion;
  /** Which face of the working limb the belly sits on; see `LimbFace`. */
  readonly face?: LimbFace;
  readonly hold: Hold;
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
  const soft = glow ? `<g filter="url(#cdGlow)" opacity=".4">${body}</g>` : '';
  return `<g class="cd-hi" opacity="${n(opacity)}">${soft}${body}</g>`;
}

/**
 * THE WHOLE FIGURE at one pose. Draw order is depth order, and the caller
 * declares it: a lying press wants the far arm behind the torso and the near leg
 * in front of it; a standing hinge wants the far leg first and both arms in
 * front of everything.
 *
 * `clipId` must be unique per mounted demo — the torso clip path is rebuilt on
 * every frame, because the torso itself is.
 */
export function figureSvg(j: Joints, style: FigureStyle, clipId: string): string {
  const front = style.view === 'front';
  const f = bodyFrame(j, style.facing);
  const torso = front ? torsoOutlineFront(j, f) : torsoOutline(f);

  /**
   * The shading edge of a bone. Sagittal: away from the light, which sits up and
   * in front of the figure. Frontal: down the outboard edge of each limb, which
   * is the same cue read from the other camera.
   */
  const nearShade = front
    ? (a: number): number => a - 90
    : (a: number): number => frontOf(a, style.facing) + 180;
  const farShade = front
    ? (a: number): number => a + 90
    : (a: number): number => frontOf(a, style.facing) + 180;

  const nearStyle: SideStyle = { sk: NEAR_SKIN, scale: 1, shade: nearShade, hi: 1 };
  const farStyle: SideStyle = front
    ? { sk: NEAR_SKIN, scale: 1, shade: farShade, hi: 1 }
    : { sk: FAR_SKIN, scale: FAR_SCALE, shade: farShade, hi: HI_FAR };

  const patchesFor = (s: SideJoints, scale: number): { main: MusclePatch; second: MusclePatch | null } => ({
    main: musclePatches(style.primary, f, s, scale, style.facing, style.view, style.face),
    second: style.secondary
      ? musclePatches(style.secondary, f, s, scale, style.facing, style.view, style.face)
      : null,
  });
  const nearP = patchesFor(j.near, nearStyle.scale);
  const farP = patchesFor(j.far, farStyle.scale);

  /**
   * The highlight ONE limb layer gets: only the regions that live on that limb.
   * This is the guard that keeps a hamstring off a forearm — from the side, a
   * hanging arm and a standing thigh cover the same patch of stage.
   */
  const limbHi = (
    p: { main: MusclePatch; second: MusclePatch | null },
    limb: 'arm' | 'leg',
    dim: number,
  ): string =>
    (p.main.limb === limb ? highlightGroup(p.main.loose, dim === 1, HI_MAIN * dim) : '') +
    (p.second && p.second.limb === limb ? highlightGroup(p.second.loose, false, HI_SECOND * dim) : '');

  const torsoHi =
    highlightGroup(nearP.main.onTorso, true, HI_MAIN) +
    (nearP.second ? highlightGroup(nearP.second.onTorso, false, HI_SECOND) : '');
  // Seen from the side the shorts are a block along the spine; seen from the
  // front they are a band ACROSS the hips. Drawn the other way round, a front
  // view gets a tall pill down the middle of the figure that reads as a nappy.
  const shortsPath = front
    ? capsule(tp(f, 0.02, -5.2), tp(f, 0.02, 5.2), 6.2, 6.2)
    : capsule(tp(f, 0.16, 0.2), tp(f, -0.28, 0.2), 5.3, 5.5);
  const shorts = inked(shortsPath, PAL.shorts, 1.3);
  const shortsHi =
    highlightGroup(nearP.main.onShorts ?? '', true, HI_MAIN) +
    (nearP.second ? highlightGroup(nearP.second.onShorts ?? '', false, HI_SECOND) : '');

  const nearHold = holdOnArm(style.hold) ? holdSvg(style.hold, j, 'near', NEAR_SKIN, 1, style.facing) : '';
  const farHold = holdOnArm(style.hold)
    ? holdSvg(style.hold, j, 'far', farStyle.sk, farStyle.scale, style.facing)
    : '';
  const bodyHold = holdOnArm(style.hold) ? '' : holdSvg(style.hold, j, 'near', NEAR_SKIN, 1, style.facing);

  const layers: Record<Layer, string> = {
    farLeg: legSvg(j.far, farStyle, limbHi(farP, 'leg', farStyle.hi), style.view),
    farArm: armSvg(j.far, farStyle, limbHi(farP, 'arm', farStyle.hi)) + farHold,
    body:
      // neck first (it tucks under the collar), then the torso, then everything
      // painted ON the torso, then the shorts block, then the head, then
      // whatever the body itself carries (a bar across the traps).
      inked(capsule(j.shoulders, step(j.head, angleOf(j.head, j.neck), 3.6), 3.6, 3.1), PAL.skinShade, 1.2) +
      inked(torso, PAL.shirt, 1.5) +
      `<clipPath id="${clipId}"><path d="${torso}"/></clipPath>` +
      `<g clip-path="url(#${clipId})">` +
      (front
        ? `<path d="${capsule(tp(f, 1.0, -3.4), tp(f, 0.02, -2.8), 3.0, 3.4)}" fill="${PAL.shirtShade}" opacity=".55"/>`
        : `<path d="${capsule(tp(f, 0.98, -2.6), tp(f, 0.02, -2.4), 3.4, 3.6)}" fill="${PAL.shirtShade}" opacity=".7"/>`) +
      torsoHi +
      // the shirt's own tailoring — a hem at the waist, a collar at the throat
      (front
        ? `<path d="${capsule(tp(f, 0.24, -8.0), tp(f, 0.24, 8.0), 0.7, 0.7)}" fill="${PAL.line}" opacity=".45"/>` +
          `<path d="${capsule(tp(f, 1.02, -3.0), tp(f, 1.02, 3.0), 0.9, 0.9)}" fill="${PAL.line}" opacity=".4"/>`
        : `<path d="${capsule(tp(f, 0.3, -6.4), tp(f, 0.26, 6.4), 0.7, 0.7)}" fill="${PAL.line}" opacity=".45"/>` +
          `<path d="${capsule(tp(f, 1.02, -3.4), tp(f, 0.92, 3.0), 0.8, 0.8)}" fill="${PAL.line}" opacity=".4"/>`) +
      `</g>` +
      shorts +
      `<clipPath id="${clipId}-s"><path d="${shortsPath}"/></clipPath>` +
      `<g clip-path="url(#${clipId}-s)">${shortsHi}</g>` +
      // whatever the BODY itself carries goes on before the head, so a bar
      // racked behind the neck is behind the neck
      bodyHold +
      `<g class="cd-head">` +
      (front ? headFrontSvg(j, NEAR_SKIN, 1) : headProfileSvg(j, style.facing, NEAR_SKIN, 1)) +
      `</g>`,
    nearLeg: legSvg(j.near, nearStyle, limbHi(nearP, 'leg', 1), style.view),
    nearArm: armSvg(j.near, nearStyle, limbHi(nearP, 'arm', 1)) + nearHold,
  };

  return `<g class="cd-figure">${style.order.map((l) => layers[l]).join('')}</g>`;
}

/* ------------------------------------------------------------ the demo type */

/**
 * A DEMO'S RENDERING CONFIG — the three things a volumetric figure needs that a
 * stick figure never asked for, plus the two the highlight needs.
 *
 * It lives beside the keyframes in `data/exercisePoses.ts`; this is only the
 * shape the renderer reads.
 */
export interface DemoLook {
  readonly view: View;
  readonly facing: 1 | -1;
  readonly order: readonly Layer[];
  readonly hold: Hold;
  readonly primary: MuscleRegion;
  readonly secondary?: MuscleRegion;
  readonly face?: LimbFace;
  readonly frames: readonly Pose[];
  /** `[x, y, w, h]` of the stage this demo is cropped to. */
  readonly camera: readonly [number, number, number, number];
  /** Which point the load-path guide is sampled from. */
  readonly arcFrom?: ArcFrom;
  readonly arcShift?: readonly [number, number];
}

export type ArcFrom = 'load' | 'hip' | 'knee' | 'ankle' | 'head' | 'none';

export function styleOf(look: DemoLook): FigureStyle {
  const base = {
    view: look.view,
    facing: look.facing,
    order: look.order,
    primary: look.primary,
    hold: look.hold,
  };
  const withFace = look.face === undefined ? base : { ...base, face: look.face };
  return look.secondary === undefined ? withFace : { ...withFace, secondary: look.secondary };
}

/* ------------------------------------------------------------ movement path */

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

/**
 * WHERE THE LOAD IS, for the path guide: the thing the exercise actually moves.
 * Usually the weight itself, but a bodyweight lift moves the BODY, and which
 * part of it is the point of the movement is per-exercise (a pull-up moves the
 * head to the bar; a hanging knee raise moves the knees).
 */
function arcPoint(look: DemoLook, j: Joints): Vec | null {
  const from = look.arcFrom ?? 'load';
  switch (from) {
    case 'none':
      return null;
    case 'hip':
      return j.pelvis;
    case 'knee':
      return j.near.knee;
    case 'ankle':
      return j.near.ankle;
    case 'head':
      return j.head;
    case 'load':
      return holdAnchors(look.hold, j)[0] ?? null;
  }
}

/**
 * THE PATH THE LOAD TRAVELS, sampled from the same forward kinematics that put
 * the dumbbell in the hand: 24 positions across the forward pass, drawn once as
 * a dashed guide with an arrowhead at the finish. It is static because it is a
 * fact about the movement, not about this frame.
 *
 * `arcShift` buys clearance: the path runs THROUGH the limb that carries the
 * load, and in a standing lift the arm hangs over it for most of the rep. A few
 * units in front of the body keeps the SHAPE (which is the information) and buys
 * back the visibility.
 */
export function motionPathSvg(look: DemoLook): string {
  const pts: Vec[] = [];
  const samples = 24;
  const [dx, dy] = look.arcShift ?? [0, 0];
  for (let i = 0; i <= samples; i++) {
    const g = arcPoint(look, forwardKinematics(frameAt(look.frames, i / samples), look.view));
    if (!g) return '';
    pts.push({ x: g.x + dx, y: g.y + dy });
  }
  const head = pts[pts.length - 1] as Vec;
  const prev = pts[pts.length - 3] ?? head;
  if (dist(pts[0] as Vec, head) < 6) return '';
  const a = angleOf(prev, head);
  const tip = step(head, a, 3.4);
  const l = step(head, a + 132, 3.6);
  const r = step(head, a - 132, 3.6);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ');
  return (
    `<g class="cd-arc" opacity=".55">` +
    `<path d="${d}" fill="none" stroke="${PAL.hot2}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3.2 3.4"/>` +
    `<path d="M ${n(tip.x)} ${n(tip.y)} L ${n(l.x)} ${n(l.y)} L ${n(r.x)} ${n(r.y)} Z" fill="${PAL.hot2}"/>` +
    `</g>`
  );
}

/* ------------------------------------------------------------------ the defs */

/**
 * The defs every stage needs: the muscle gradient, its glow, and the stage's own
 * vignette. IDs are global on purpose — two demos on one page share one
 * gradient, and the only per-instance id is the torso clip path.
 */
export function defsSvg(): string {
  return (
    `<defs>` +
    `<linearGradient id="cdHot" x1="0" y1="1" x2="0.6" y2="0">` +
    `<stop offset="0" stop-color="${PAL.hot1}"/><stop offset="1" stop-color="${PAL.hot2}"/>` +
    `</linearGradient>` +
    `<filter id="cdGlow" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="2.4"/>` +
    `</filter>` +
    `<radialGradient id="cdStage" cx="0.5" cy="0.4" r="0.75">` +
    `<stop offset="0" stop-color="${PAL.stage1}"/><stop offset="1" stop-color="${PAL.stage2}"/>` +
    `</radialGradient>` +
    `</defs>`
  );
}

/** `RIG` and `STAGE` are re-exported so a caller never has to import both files. */
export { RIG, STAGE };
