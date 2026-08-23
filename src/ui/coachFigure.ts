/**
 * ui/coachFigure.ts — the RIG the "coach" demonstrator is built on.
 *
 * This file is the skeleton and nothing else: bone lengths, poses, forward
 * kinematics, interpolation, and the declaration of what the hands are holding.
 * The picture is drawn by `ui/coachVolume.ts` (the body) and `ui/coachProps.ts`
 * (the station); the demonstrator is deliberately NOT the RPG character
 * (`ui/characterSvg.ts`), which scales its muscles with your levels and would
 * turn a technique demo into a progress display.
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
 * TWO VIEWS share the one rig:
 *   - `side` — both limb pairs hang off the same shoulder/hip point, the far
 *     one nudged by `DEPTH` and drawn dimmer. This is the sagittal plane, where
 *     presses, hinges, curls and squats live.
 *   - `front` — the shoulders and hips spread to ±`shoulderHalf` / ±`hipHalf`
 *     and the FAR side's angles are mirrored automatically, so a symmetric
 *     front pose is authored once and copied. This is the plane where a lateral
 *     raise, a shrug or a cable crossover is actually legible.
 *
 * FORWARD KINEMATICS IS THE SOURCE OF TRUTH for the equipment too: a dumbbell
 * sits at the hand because the renderer reads `joints.near.grip`, a machine
 * roller rides the ankle because it reads `joints.near.ankle`, and a cable is a
 * line to a pulley the props declared. `holdAnchors` is that promise made
 * explicit — one function saying where every load actually is, which both the
 * renderer and the tests read. Nothing is positioned twice, so a pose can never
 * drift away from the weight it is supposed to be moving.
 *
 * Everything here is a PURE function of numbers — no DOM, no clock, no
 * randomness — which is what lets `tests/coachFigure.test.ts` assert the
 * geometry of every keyframe of every exercise.
 */

/* ------------------------------------------------------------------ types */

export type View = 'side' | 'front';

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
} as const;

/** How far the FAR limbs sit from the near ones in the side view. */
const DEPTH: Vec = { x: -2.6, y: 0 };

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

function armChain(shoulder: Vec, a: ArmAngles, mirror: 1 | -1): Pick<SideJoints, 'shoulder' | 'elbow' | 'wrist' | 'grip'> {
  const u = mirror === 1 ? a[0] : 180 - a[0];
  const f = mirror === 1 ? a[1] : 180 - a[1];
  const elbow = step(shoulder, u, RIG.upperArm);
  const wrist = step(elbow, f, RIG.forearm);
  return { shoulder, elbow, wrist, grip: step(wrist, f, RIG.hand) };
}

function legChain(hip: Vec, l: LegAngles, mirror: 1 | -1): Pick<SideJoints, 'hip' | 'knee' | 'ankle' | 'toe'> {
  const t = mirror === 1 ? l[0] : 180 - l[0];
  const s = mirror === 1 ? l[1] : 180 - l[1];
  const f = mirror === 1 ? l[2] : 180 - l[2];
  const knee = step(hip, t, RIG.thigh);
  const ankle = step(knee, s, RIG.shin);
  return { hip, knee, ankle, toe: step(ankle, f, RIG.foot) };
}

function side(shoulder: Vec, hip: Vec, a: ArmAngles, l: LegAngles, mirror: 1 | -1): SideJoints {
  return { ...armChain(shoulder, a, mirror), ...legChain(hip, l, mirror) };
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

  if (view === 'front') {
    const roll = pose.roll ?? 0;
    return {
      pelvis,
      neck,
      shoulders,
      head,
      near: side(
        step(shoulders, roll, RIG.shoulderHalf),
        { x: pelvis.x + RIG.hipHalf, y: pelvis.y },
        pose.arm,
        pose.leg,
        1,
      ),
      far: side(
        step(shoulders, roll + 180, RIG.shoulderHalf),
        { x: pelvis.x - RIG.hipHalf, y: pelvis.y },
        pose.armF,
        pose.legF,
        -1,
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

/** Cosine ease-in-out: a rep starts and ends slow, like a controlled one. */
export function ease(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(c * Math.PI);
}

/* ----------------------------------------------------------------- output */

/** Round to 1 decimal — keeps the markup small and the tests readable. */
export function n(v: number): string {
  return String(Math.round(v * 10) / 10);
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
  | {
      readonly k: 'db';
      readonly axis?: 'cross' | 'along';
      /**
       * Seen BROADSIDE rather than three-quarter. A normally-gripped dumbbell
       * points at the camera in the sagittal plane, so it is drawn foreshortened
       * — but looking DOWN on a lifter lying on a bench, the same bar lies flat
       * across the frame and the whole bell is visible.
       */
      readonly broad?: boolean;
    }
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

/**
 * WHERE a hold sits, as points — the same numbers the renderer draws with,
 * exposed so the pose tests can assert that the iron is anchored to the right
 * joint, and so the load-path guide can be sampled from the load itself.
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
    case 'rope':
    case 'handle':
      return [mid(j.near.grip, j.far.grip)];
    case 'cables':
      return [j.near.grip, j.far.grip];
    case 'roller':
      return [hold.joint === 'ankle' ? j.near.ankle : j.near.knee];
  }
}
