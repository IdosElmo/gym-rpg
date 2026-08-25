/**
 * ui/coachFigure.ts — the articulated "coach" demonstrator and its props.
 *
 * ORIGINAL ART. Every shape in this file is authored here from numbers; no
 * image, frame, trace or path is derived from any third-party media. The figure
 * is deliberately NOT the RPG character (`ui/characterSvg.ts`): that one scales
 * its muscles with your levels and would turn a technique demo into a progress
 * display. This is a neutral demonstrator — one bold stick silhouette, the same
 * on every device and at every level.
 *
 * THE RIG is a 2D skeleton with fixed bone lengths (`RIG`) and a pose that is
 * nothing but a root position plus a handful of ABSOLUTE segment angles. Angles
 * are degrees in SVG's own orientation:
 *
 *        -90 (up)
 *          │
 *   180 ───┼─── 0   (+x, to the right)
 *          │
 *         90 (down)
 *
 * i.e. positive rotates clockwise on screen, exactly like `rotate()`. Every
 * angle is the segment's own direction in world space — never a joint-relative
 * one — which makes forward kinematics a two-line function and makes a pose
 * readable on the page: `arm: [90, 90]` is an arm hanging straight down, and
 * `torso: -90` is an upright spine.
 *
 * THREE VIEWS share the one rig:
 *   - `side` — both limb pairs hang off the same shoulder/hip point, the far
 *     one nudged by `DEPTH` and drawn dimmer. This is the sagittal plane, where
 *     presses, hinges, curls and squats live.
 *   - `front` — the shoulders and hips spread to ±`shoulderHalf` / ±`hipHalf`
 *     and the FAR side's angles are mirrored automatically, so a symmetric
 *     front pose is authored once and copied. This is the plane where a lateral
 *     raise, a shrug or a cable crossover is actually legible.
 *   - `threeQuarter` — the same spread, taken at an angle: narrower across (`Q.
 *     spread`), pushed apart along a depth diagonal (`Q.near` / `Q.far`), and
 *     with the far side's bones drawn shorter (`Q.foreshorten`). It is the view
 *     for a movement that is two-handed AND happens in front of the body, where
 *     the side camera stacks the two hands into one and the front one flattens
 *     all the depth out of them — a face pull, a flye.
 *
 * FORWARD KINEMATICS IS THE SOURCE OF TRUTH for the equipment too: a dumbbell
 * sits at the hand because `holdSvg` reads `joints.near.grip`, a machine roller
 * rides the ankle because it reads `joints.near.ankle`, and a cable is a line
 * to a pulley the props declared. Nothing is positioned twice, so a pose can
 * never drift away from the weight it is supposed to be moving.
 *
 * Everything here is a PURE function of numbers to an SVG string — no DOM, no
 * clock, no randomness — which is what lets `tests/coachFigure.test.ts` assert
 * the geometry of every keyframe of every exercise.
 */

/* ------------------------------------------------------------------ types */

/**
 * Which plane the camera is on. `threeQuarter` is the turned one — see `Q` — and
 * it exists for the movements that are two-handed AND happen in front of the
 * body, where `side` stacks the two hands into one and `front` flattens the
 * depth out of them.
 */
export type View = 'side' | 'front' | 'threeQuarter';

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** Near/far arm: [upper-arm angle, forearm angle]. */
export type ArmAngles = readonly [number, number];
/** Near/far leg: [thigh angle, shin angle, foot angle]. */
export type LegAngles = readonly [number, number, number];

export interface Pose {
  /** Pelvis (the root of the whole chain). */
  readonly x: number;
  readonly y: number;
  /** Pelvis → shoulder centre. `-90` is an upright spine. */
  readonly torso: number;
  /** Shoulder centre → head centre. Usually tracks `torso`. */
  readonly head: number;
  readonly arm: ArmAngles;
  readonly armF: ArmAngles;
  readonly leg: LegAngles;
  readonly legF: LegAngles;
  /** FRONT view only: shoulder-line roll, i.e. how far the torso has twisted. */
  readonly roll?: number;
  /** Shoulder elevation along the spine (a shrug). Positive = shoulders up. */
  readonly shrug?: number;
}

export interface SideJoints {
  readonly shoulder: Vec;
  readonly elbow: Vec;
  readonly wrist: Vec;
  /** Where the hand actually holds something — a little past the wrist. */
  readonly grip: Vec;
  readonly hip: Vec;
  readonly knee: Vec;
  readonly ankle: Vec;
  readonly toe: Vec;
}

export interface Joints {
  readonly pelvis: Vec;
  /** Top of the spine, before any shrug. */
  readonly neck: Vec;
  /** Shoulder centre the arms hang from (the neck, plus the shrug). */
  readonly shoulders: Vec;
  readonly head: Vec;
  readonly near: SideJoints;
  readonly far: SideJoints;
}

/** Bone lengths, in viewBox units. One rig, one set of proportions. */
export const RIG = {
  headR: 6.5,
  /** Shoulder centre → head centre. */
  neck: 11,
  /** Pelvis → shoulder centre. */
  torso: 24,
  upperArm: 13.5,
  forearm: 12,
  /** Wrist → grip point. */
  hand: 3.5,
  thigh: 17,
  shin: 16,
  foot: 6,
  /** Half the shoulder span, front view. */
  shoulderHalf: 9,
  /** Half the hip span, front view. */
  hipHalf: 5.5,
  /** Half-thickness of the torso silhouette at the shoulders / at the hips. */
  chestHalf: 5.5,
  waistHalf: 4.5,
} as const;

/** How far the FAR limbs sit from the near ones in the side view. */
const DEPTH: Vec = { x: -2.6, y: 0 };

/**
 * THE THREE-QUARTER CHEAT, in four numbers.
 *
 * A body turned ~45° to the camera is not something a 2D rig can compute, but it
 * is something a 2D rig can FAKE honestly, and the fake is worth having: it is
 * the only view in which a two-handed movement shows two hands AND a depth
 * order. Three things happen to the body at once, and each gets one number:
 *
 *   `spread`      the shoulder and hip spans are seen at an angle, so what
 *                 survives in the picture is the cosine of the turn. 0.62 of the
 *                 full span is a turn of about 52°.
 *   `near`/`far`  what that cosine COST goes into instead: depth. The far side
 *                 is pushed up-and-left and the near side down-and-right along
 *                 one diagonal, which is what makes the torso a parallelogram
 *                 rather than a flat plate and tells the eye which shoulder is
 *                 closer.
 *   `foreshorten` the far side is further from the camera, so its bones are
 *                 drawn a little shorter. It is not perspective — it is the one
 *                 cue that stops a mirrored far arm reading as a second near
 *                 arm pasted on at an offset.
 *
 * Everything else is unchanged: the far side's angles are still mirrored, so a
 * symmetric pose is still authored once, and the far limbs still take the dim
 * stroke that is this renderer's only other depth cue.
 */
const Q = {
  spread: 0.62,
  near: { x: 2, y: 1.7 } as Vec,
  far: { x: -2, y: -1.7 } as Vec,
  foreshorten: 0.85,
} as const;

/** The stage every demo is drawn on. Wider than tall: half the lifts lie down. */
export const STAGE = { w: 160, h: 120, floorY: 102 } as const;

const D2R = Math.PI / 180;

/* --------------------------------------------------------------- geometry */

/** One bone: walk `len` from `p` in direction `deg`. */
export function step(p: Vec, deg: number, len: number): Vec {
  const a = deg * D2R;
  return { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Absolute angle of the segment a→b, in the rig's own convention. */
export function angleOf(a: Vec, b: Vec): number {
  return Math.atan2(b.y - a.y, b.x - a.x) / D2R;
}

/**
 * How far a joint is BENT, 0–180: 0 is a straight limb, 90 a right angle.
 * Both bones are absolute angles, so this is just the turn between them.
 */
export function flexion(first: number, second: number): number {
  const d = (((second - first) % 360) + 540) % 360 - 180;
  return Math.abs(d);
}

function armChain(shoulder: Vec, a: ArmAngles, mirror: 1 | -1, k: number): Pick<SideJoints, 'shoulder' | 'elbow' | 'wrist' | 'grip'> {
  const u = mirror === 1 ? a[0] : 180 - a[0];
  const f = mirror === 1 ? a[1] : 180 - a[1];
  const elbow = step(shoulder, u, RIG.upperArm * k);
  const wrist = step(elbow, f, RIG.forearm * k);
  return { shoulder, elbow, wrist, grip: step(wrist, f, RIG.hand * k) };
}

function legChain(hip: Vec, l: LegAngles, mirror: 1 | -1, k: number): Pick<SideJoints, 'hip' | 'knee' | 'ankle' | 'toe'> {
  const t = mirror === 1 ? l[0] : 180 - l[0];
  const s = mirror === 1 ? l[1] : 180 - l[1];
  const f = mirror === 1 ? l[2] : 180 - l[2];
  const knee = step(hip, t, RIG.thigh * k);
  const ankle = step(knee, s, RIG.shin * k);
  return { hip, knee, ankle, toe: step(ankle, f, RIG.foot * k) };
}

function side(shoulder: Vec, hip: Vec, a: ArmAngles, l: LegAngles, mirror: 1 | -1, k = 1): SideJoints {
  return { ...armChain(shoulder, a, mirror, k), ...legChain(hip, l, mirror, k) };
}

/** Pose → every joint position. The one place the skeleton is assembled. */
export function forwardKinematics(pose: Pose, view: View = 'side'): Joints {
  const pelvis: Vec = { x: pose.x, y: pose.y };
  const neck = step(pelvis, pose.torso, RIG.torso);
  const shrug = pose.shrug ?? 0;
  const shoulders = shrug === 0 ? neck : step(neck, pose.torso, shrug);
  // The head hangs off the NECK, not off the shrugged shoulder line: a shrug
  // must raise the traps towards the ears, never carry the skull up with them.
  const head = step(neck, pose.head, RIG.neck);

  if (view === 'front' || view === 'threeQuarter') {
    const roll = pose.roll ?? 0;
    const q = view === 'threeQuarter';
    const spread = q ? Q.spread : 1;
    const scale = q ? Q.foreshorten : 1;
    const on = (p: Vec, d: Vec): Vec => (q ? { x: p.x + d.x, y: p.y + d.y } : p);
    return {
      pelvis,
      neck,
      shoulders,
      head,
      near: side(
        on(step(shoulders, roll, RIG.shoulderHalf * spread), Q.near),
        on(q ? step(pelvis, roll, RIG.hipHalf * spread) : { x: pelvis.x + RIG.hipHalf, y: pelvis.y }, Q.near),
        pose.arm,
        pose.leg,
        1,
      ),
      far: side(
        on(step(shoulders, roll + 180, RIG.shoulderHalf * spread), Q.far),
        on(q ? step(pelvis, roll + 180, RIG.hipHalf * spread) : { x: pelvis.x - RIG.hipHalf, y: pelvis.y }, Q.far),
        pose.armF,
        pose.legF,
        -1,
        scale,
      ),
    };
  }

  const back = (p: Vec): Vec => ({ x: p.x + DEPTH.x, y: p.y + DEPTH.y });
  return {
    pelvis,
    neck,
    shoulders,
    head,
    near: side(shoulders, pelvis, pose.arm, pose.leg, 1),
    far: side(back(shoulders), back(pelvis), pose.armF, pose.legF, 1),
  };
}

/* ------------------------------------------------------------ interpolation */

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixArm(a: ArmAngles, b: ArmAngles, t: number): ArmAngles {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t)];
}

function mixLeg(a: LegAngles, b: LegAngles, t: number): LegAngles {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/**
 * Blend two keyframes. Every field is a plain number, so this is a straight
 * lerp — the keyframes are authored inside one continuous angular range, so
 * there is no ±180° seam to wrap around.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    x: mix(a.x, b.x, t),
    y: mix(a.y, b.y, t),
    torso: mix(a.torso, b.torso, t),
    head: mix(a.head, b.head, t),
    arm: mixArm(a.arm, b.arm, t),
    armF: mixArm(a.armF, b.armF, t),
    leg: mixLeg(a.leg, b.leg, t),
    legF: mixLeg(a.legF, b.legF, t),
    roll: mix(a.roll ?? 0, b.roll ?? 0, t),
    shrug: mix(a.shrug ?? 0, b.shrug ?? 0, t),
  };
}

/** Fallback for an empty frame list — a figure standing to attention. */
const FALLBACK: Pose = {
  x: 80, y: 66, torso: -90, head: -90,
  arm: [90, 90], armF: [90, 90], leg: [90, 90, 20], legF: [90, 90, 20],
};

/**
 * The pose `u` (0–1) of the way ALONG the authored keyframes — two, three or
 * more, walked at a constant rate and blended pairwise. This is the movement
 * itself; how much of the clock each direction gets is the caller's business
 * (`ui/exerciseDemo.ts`).
 */
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

/** Cosine ease-in-out: a rep starts and ends slow, like a controlled one. */
export function ease(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(c * Math.PI);
}

/* ---------------------------------------------------------------- drawing */

/** Round to 1 decimal — keeps the markup small and the tests readable. */
export function n(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function line(a: Vec, b: Vec): string {
  return `M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}`;
}

function poly(pts: readonly Vec[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${n(p.x)} ${n(p.y)}`).join(' ') + ' Z';
}

function limbPath(s: SideJoints, cls: string): string {
  return (
    `<path class="cd-limb ${cls}" d="${line(s.hip, s.knee)} ${line(s.knee, s.ankle)} ${line(s.ankle, s.toe)}"/>` +
    `<path class="cd-limb ${cls}" d="${line(s.shoulder, s.elbow)} ${line(s.elbow, s.wrist)}"/>`
  );
}

function torsoPath(j: Joints, view: View): string {
  // both spread views build the torso from the rig's own four points, so a roll
  // (or the three-quarter diagonal) shapes it for free
  if (view !== 'side') {
    return poly([j.near.shoulder, j.far.shoulder, j.far.hip, j.near.hip]);
  }
  const perp = angleOf(j.pelvis, j.shoulders) + 90;
  return poly([
    step(j.pelvis, perp, RIG.waistHalf),
    step(j.shoulders, perp, RIG.chestHalf),
    step(j.shoulders, perp + 180, RIG.chestHalf),
    step(j.pelvis, perp + 180, RIG.waistHalf),
  ]);
}

function dot(p: Vec): string {
  return `<circle class="cd-joint" cx="${n(p.x)}" cy="${n(p.y)}" r="1.8"/>`;
}

/**
 * The figure itself. Draw order is depth order: the far limbs, then the solid
 * torso + head, then the near limbs on top, then the accent joints.
 */
export function figureSvg(j: Joints, view: View): string {
  return (
    `<g class="cd-figure">` +
    limbPath(j.far, 'far') +
    `<path class="cd-torso" d="${torsoPath(j, view)}"/>` +
    `<path class="cd-neck" d="${line(j.shoulders, j.head)}"/>` +
    `<circle class="cd-head" cx="${n(j.head.x)}" cy="${n(j.head.y)}" r="${RIG.headR}"/>` +
    limbPath(j.near, 'near') +
    dot(j.near.shoulder) +
    dot(j.near.elbow) +
    dot(j.near.hip) +
    dot(j.near.knee) +
    `</g>`
  );
}

/* -------------------------------------------------------------- equipment */

/**
 * A padded bench. `(x, y)` is the LOW (hip) end of the pad, `angle` its rise
 * (0 flat, negative = the head end climbs to the right), `len` its length.
 * Legs drop from both ends to the floor, so an incline bench reads as a bench
 * and not as a floating slab.
 */
export function benchProp(o: {
  x: number;
  y: number;
  len: number;
  angle?: number;
  floorY?: number;
  /** A horizontal seat pad extending backwards from the low end. */
  seat?: number;
}): string {
  const a = o.angle ?? 0;
  const lo: Vec = { x: o.x, y: o.y };
  const hi = step(lo, a, o.len);
  const floorY = o.floorY ?? STAGE.floorY;
  const seat: Vec | null = o.seat ? { x: o.x - o.seat, y: o.y } : null;
  const foot = (p: Vec): string => `<path class="cd-frame" d="${line(p, { x: p.x, y: floorY })}"/>`;
  return (
    (seat ? padProp(seat, lo) + foot(seat) : '') +
    padProp(lo, hi) +
    foot(lo) +
    foot(hi) +
    `<path class="cd-frame" d="${line({ x: (seat ?? lo).x, y: floorY }, { x: hi.x, y: floorY })}"/>`
  );
}

/** A bare padded surface — a bench top, a thigh pad, a machine backrest. */
export function padProp(a: Vec, b: Vec): string {
  return `<path class="cd-pad" d="${line(a, b)}"/>`;
}

/**
 * A FLAT BENCH SEEN AT THREE QUARTERS: the pad is a PARALLELOGRAM — its long
 * axis `a`→`b` running head-to-foot under the lifter, its width along `dep`, the
 * same depth diagonal the rig spreads the body on — with a leg dropped from each
 * end of the near edge. `a` is the head end, and it gets the cushion seam, which
 * is the one mark that says which end of a slab the skull belongs on.
 */
export function benchDiagProp(o: { a: Vec; b: Vec; dep: Vec; floorY?: number }): string {
  const floorY = o.floorY ?? STAGE.floorY;
  const at = (p: Vec, k: number): Vec => ({ x: p.x + o.dep.x * k, y: p.y + o.dep.y * k });
  const along = (k: number): Vec => ({ x: o.a.x + (o.b.x - o.a.x) * k, y: o.a.y + (o.b.y - o.a.y) * k });
  const nearA = at(along(0.1), 1);
  const nearB = at(along(0.9), 1);
  const leg = (p: Vec): string => `<path class="cd-frame" d="${line(p, { x: p.x, y: floorY })}"/>`;
  const seam = along(0.22);
  return (
    leg(nearA) +
    leg(nearB) +
    `<path class="cd-frame" d="${line({ x: nearA.x, y: floorY }, { x: nearB.x, y: floorY })}"/>` +
    `<path class="cd-slab" d="${poly([at(o.a, -1), at(o.b, -1), at(o.b, 1), at(o.a, 1)])}"/>` +
    `<path class="cd-frame" d="${line(at(o.a, -1), at(o.b, -1))}"/>` +
    `<path class="cd-pad" d="${line(at(o.a, 1), at(o.b, 1))}"/>` +
    `<path class="cd-frame" d="${line(at(seam, 0.92), at(seam, -0.92))}"/>`
  );
}

/** A machine's rotation axis, drawn where the joint it tracks actually sits. */
export function pivotProp(x: number, y: number): string {
  return `<circle class="cd-frame cd-wheel" cx="${n(x)}" cy="${n(y)}" r="3"/>`;
}

/** A mat: the thin pad the floor work happens on. */
export function matProp(x1: number, x2: number, y: number): string {
  return `<rect class="cd-mat" x="${n(Math.min(x1, x2))}" y="${n(y)}" width="${n(Math.abs(x2 - x1))}" height="3.4" rx="1.7"/>`;
}

/** The floor line. */
export function floorProp(x1: number, x2: number, y: number = STAGE.floorY): string {
  return `<path class="cd-floor" d="${line({ x: x1, y }, { x: x2, y })}"/>`;
}

/**
 * A Smith machine rail: one guided vertical track with catch notches. The whole
 * point of the machine is that the bar CANNOT leave this line, so the rail is
 * drawn through the full travel and the bar is always painted on it.
 */
export function railProp(x: number, y1: number, y2: number): string {
  const notches: string[] = [];
  for (let y = y1 + 8; y < y2 - 4; y += 9) {
    notches.push(`<path class="cd-frame" d="${line({ x, y }, { x: x + 4, y })}"/>`);
  }
  return `<path class="cd-frame cd-rail" d="${line({ x, y: y1 }, { x, y: y2 })}"/>` + notches.join('');
}

/**
 * A cable pulley: the wheel the cable leaves from, on its upright.
 *
 * `postX` moves the UPRIGHT away from the wheel and hangs the wheel off a top
 * beam instead. A lat pulldown is the reason it exists: the wheel has to be
 * directly above the seat or the cable comes down at an angle no station ever
 * does, and the mast that carries it has to be behind the lifter's back rather
 * than through his thighs.
 */
export function pulleyProp(
  x: number,
  y: number,
  o: { top?: number; post?: number; stack?: boolean; postX?: number } = {},
): string {
  const top = o.top ?? 8;
  const post = o.post ?? 40;
  const px = o.postX ?? x;
  const stack = o.stack
    ? `<rect class="cd-mat" x="${n(px - 5)}" y="${n(y + 14)}" width="10" height="26" rx="2"/>` +
      `<path class="cd-frame" d="${line({ x: px - 5, y: y + 22 }, { x: px + 5, y: y + 22 })} ${line({ x: px - 5, y: y + 30 }, { x: px + 5, y: y + 30 })}"/>`
    : '';
  const beam = px === x ? '' : `<path class="cd-frame" d="${line({ x: px, y: top }, { x, y: top })}"/>`;
  return (
    `<path class="cd-frame" d="${line({ x: px, y: top }, { x: px, y: y + post })}"/>` +
    beam +
    (px === x ? '' : `<path class="cd-frame" d="${line({ x, y: top }, { x, y })}"/>`) +
    `<circle class="cd-frame cd-wheel" cx="${n(x)}" cy="${n(y)}" r="3.2"/>` +
    stack
  );
}

/** A pull-up / hanging bar, hung from the top of the stage. */
export function barProp(x1: number, x2: number, y: number, top = 8): string {
  return (
    `<path class="cd-iron cd-bar" d="${line({ x: x1, y }, { x: x2, y })}"/>` +
    `<path class="cd-frame" d="${line({ x: x1 + 3, y }, { x: x1 + 3, y: top })} ${line({ x: x2 - 3, y }, { x: x2 - 3, y: top })}"/>`
  );
}

/** Parallel (dip) bars: the bar the hands sit on, on its uprights. */
export function dipBarsProp(x1: number, x2: number, y: number, floorY = STAGE.floorY): string {
  return (
    `<path class="cd-iron cd-bar" d="${line({ x: x1, y }, { x: x2, y })}"/>` +
    `<path class="cd-frame" d="${line({ x: x1 + 2, y }, { x: x1 + 2, y: floorY })} ${line({ x: x2 - 2, y }, { x: x2 - 2, y: floorY })}"/>` +
    floorProp(x1 - 14, x2 + 14, floorY)
  );
}

/** A machine frame: an upright with a foot, the skeleton every station shares. */
export function frameProp(x: number, y1: number, y2: number): string {
  return `<path class="cd-frame" d="${line({ x, y: y1 }, { x, y: y2 })}"/>`;
}

/** One weight plate seen edge-on — how a loaded bar reads from the side. */
function plateSvg(p: Vec, r = 5.6): string {
  return (
    `<circle class="cd-iron-fill" cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}"/>` +
    `<circle class="cd-hub" cx="${n(p.x)}" cy="${n(p.y)}" r="1.5"/>`
  );
}

/** A dumbbell: a short handle with a block at each end. */
function dumbbellSvg(p: Vec, deg: number, len = 5.2): string {
  const a = step(p, deg, len);
  const b = step(p, deg + 180, len);
  return (
    `<path class="cd-iron" d="${line(a, b)}"/>` +
    `<path class="cd-iron cd-bell" d="${line(step(a, deg + 90, 3), step(a, deg - 90, 3))} ${line(step(b, deg + 90, 3), step(b, deg - 90, 3))}"/>`
  );
}

/** A machine roller pad — the thing a leg curl / extension pushes against. */
function rollerSvg(p: Vec): string {
  return `<circle class="cd-roller" cx="${n(p.x)}" cy="${n(p.y)}" r="4.4"/>`;
}

function cableSvg(from: Vec, to: Vec): string {
  return `<path class="cd-cable" d="${line(from, to)}"/>`;
}

/* ----------------------------------------------------------- what is held */

/**
 * What the hands are on. Every variant is positioned from the FK output, so the
 * weight can only ever be exactly where the hands are.
 */
export type Hold =
  | { readonly k: 'none' }
  /** One dumbbell per hand. `axis` is the bar's direction: across the forearm
   *  (a normal grip, seen from the side) or along it (a neutral/hammer grip
   *  seen from the front). */
  | { readonly k: 'db'; readonly axis?: 'cross' | 'along' }
  /** One dumbbell, near hand only (the one-arm row). */
  | { readonly k: 'dbNear' }
  /** One weight in BOTH hands — held at the midpoint of the two grips. */
  | { readonly k: 'plate'; readonly r?: number }
  /** A loaded bar seen end-on: the plate disc at the hands. */
  | { readonly k: 'bar' }
  /** A bar resting across the shoulders (a squat). */
  | { readonly k: 'barBack' }
  /** A rope on a cable from `from` — the two ends splay out of the fists. */
  | { readonly k: 'rope'; readonly from: readonly [number, number] }
  /** A handle on a cable from `from`; `wide` draws a lat bar, else a close grip. */
  | { readonly k: 'handle'; readonly from: readonly [number, number]; readonly wide?: boolean }
  /** One cable per hand, from two anchors (a crossover). */
  | { readonly k: 'cables'; readonly from: readonly (readonly [number, number])[] }
  /** A padded roller riding a joint of the near leg. */
  | { readonly k: 'roller'; readonly joint: 'ankle' | 'knee' };

function mid(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function forearmAngle(s: SideJoints): number {
  return angleOf(s.elbow, s.wrist);
}

/**
 * WHERE a hold sits, as points — the same numbers `holdSvg` draws with, exposed
 * so the pose tests can assert that the iron is anchored to the right joint.
 */
export function holdAnchors(hold: Hold, j: Joints): Vec[] {
  switch (hold.k) {
    case 'none':
      return [];
    case 'db':
      return [j.near.grip, j.far.grip];
    case 'dbNear':
      return [j.near.grip];
    case 'plate':
      return [mid(j.near.grip, j.far.grip)];
    case 'bar':
      return [j.near.grip];
    case 'barBack':
      return [j.near.shoulder];
    // a rope has TWO ends and they are held in two fists — which is the whole
    // point of a face pull, and invisible if the anchor is their midpoint
    case 'rope':
      return [j.near.grip, j.far.grip];
    case 'handle':
      return [mid(j.near.grip, j.far.grip)];
    case 'cables':
      return [j.near.grip, j.far.grip];
    case 'roller':
      return [hold.joint === 'ankle' ? j.near.ankle : j.near.knee];
  }
}

/** The one hold whose two halves live on two sides of the body: the rope. */
function ropeParts(hold: { readonly from: readonly [number, number] }, j: Joints) {
  const from: Vec = { x: hold.from[0] ?? 0, y: hold.from[1] ?? 0 };
  const hands = mid(j.near.grip, j.far.grip);
  const clip = step(hands, angleOf(hands, from), 7);
  return {
    from,
    clip,
    strand: (g: Vec): string =>
      `<path class="cd-rope" d="${line(clip, g)} ${line(g, step(g, angleOf(clip, g), 5))}"/>`,
  };
}

/**
 * THE PART OF THE LOAD THAT IS BEHIND THE BODY, painted before the figure is.
 *
 * Almost nothing is: a dumbbell is in a hand and a bar is in front of the chest.
 * A ROPE is the exception, and it is the reason this function exists. Pulled to
 * the face, the two ends straddle the skull — one passes the near ear and one
 * the far one — so drawing both in front puts a stripe across the face, which is
 * exactly what the review called out. The far strand belongs behind the head,
 * and the head is a filled circle, so putting it in this layer is the whole fix.
 */
export function holdBackSvg(hold: Hold, j: Joints): string {
  if (hold.k !== 'rope') return '';
  return ropeParts(hold, j).strand(j.far.grip);
}

export function holdSvg(hold: Hold, j: Joints): string {
  switch (hold.k) {
    case 'none':
      return '';
    case 'db': {
      const along = hold.axis === 'along';
      return (
        dumbbellSvg(j.far.grip, forearmAngle(j.far) + (along ? 0 : 90), 4.6) +
        dumbbellSvg(j.near.grip, forearmAngle(j.near) + (along ? 0 : 90))
      );
    }
    case 'dbNear':
      return dumbbellSvg(j.near.grip, forearmAngle(j.near) + 90);
    case 'plate':
      return plateSvg(mid(j.near.grip, j.far.grip), hold.r ?? 5.6);
    case 'bar':
      return plateSvg(j.near.grip);
    case 'barBack': {
      const a = angleOf(j.far.shoulder, j.near.shoulder);
      return plateSvg(step(j.near.shoulder, a, 1.5), 5);
    }
    case 'rope': {
      // A ROPE HAS TWO ENDS, AND THEY ARRIVE IN TWO FISTS — but it is not two
      // cables. What hangs off the machine is ONE cable ending in a clip, and
      // the rope's two halves run from that clip to the two hands. Drawing two
      // full-length strands back to the pulley made a face pull read as a rake:
      // both lines left the same wheel at almost the same angle and merged into
      // one bar across the top of the picture. The clip is what breaks them
      // apart — it sits a rope's length in front of the hands, so the two ends
      // leave it at a wide angle.
      //
      // Only the NEAR end is drawn here. The far one is behind the body — see
      // `holdBackSvg`.
      const rope = ropeParts(hold, j);
      return (
        cableSvg(rope.from, rope.clip) +
        rope.strand(j.near.grip) +
        `<circle class="cd-clip" cx="${n(rope.clip.x)}" cy="${n(rope.clip.y)}" r="1.9"/>`
      );
    }
    case 'handle': {
      const from: Vec = { x: hold.from[0] ?? 0, y: hold.from[1] ?? 0 };
      const hands = mid(j.near.grip, j.far.grip);
      const a = angleOf(from, hands);
      const bar = hold.wide
        ? `<path class="cd-iron cd-bar" d="${line(step(hands, a + 90, 13), step(hands, a - 90, 13))}"/>`
        : `<path class="cd-iron cd-bar" d="${line(step(hands, a + 90, 5), step(hands, a - 90, 5))}"/>`;
      return cableSvg(from, hands) + bar;
    }
    case 'cables': {
      const a = hold.from[0];
      const b = hold.from[1];
      return (
        (a ? cableSvg({ x: a[0], y: a[1] }, j.far.grip) : '') +
        (b ? cableSvg({ x: b[0], y: b[1] }, j.near.grip) : '') +
        `<circle class="cd-hub" cx="${n(j.far.grip.x)}" cy="${n(j.far.grip.y)}" r="2.2"/>` +
        `<circle class="cd-hub" cx="${n(j.near.grip.x)}" cy="${n(j.near.grip.y)}" r="2.2"/>`
      );
    }
    case 'roller':
      return rollerSvg(hold.joint === 'ankle' ? j.near.ankle : j.near.knee);
  }
}
